//! Native sender for P2P-Cast lives. The desktop app hands it captured frames and PCM; it encodes
//! them once (H.264 on the GPU when Media Foundation has an encoder, openh264 otherwise; Opus) and
//! serves every viewer itself over the same PeerJS signaling and WebRTC the browsers speak, so
//! viewers (web, desktop, Android) need no change.

mod audio;
mod binarypack;
mod chat;
mod host;
mod signaling;
mod video;

pub use audio::AudioInput;
pub use chat::ChatMessage;
pub use video::{auto_bitrate, target_size, EncoderInfo, EncoderPreference, VideoInput, VideoSettings};

use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast;

pub const P2PCAST_SIGNALING_SERVER: &str = "wss://peerjs.ligmacharl.es:443/peerjs/peerjs";
pub const P2PCAST_ICE_SERVERS: &[&str] = &["stun:stun.l.google.com:19302"];

// Two seconds of video at 60 fps: a viewer further behind than that restarts from a keyframe.
const VIDEO_QUEUE: usize = 120;
const AUDIO_QUEUE: usize = 250;

#[derive(Debug, Clone)]
pub struct BroadcastConfig {
    /// The saved broadcast id, so links shared earlier keep working; a new one when `None`.
    pub peer_id: Option<String>,
    pub signaling_server: String,
    pub ice_servers: Vec<String>,
    pub video: VideoSettings,
}

impl BroadcastConfig {
    pub fn p2pcast(peer_id: Option<String>, video: VideoSettings) -> Self {
        Self {
            peer_id,
            signaling_server: P2PCAST_SIGNALING_SERVER.to_string(),
            ice_servers: P2PCAST_ICE_SERVERS.iter().map(|url| url.to_string()).collect(),
            video,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum BroadcastEvent {
    Viewers { count: usize },
    Chat { message: ChatMessage },
    Encoder { name: String, hardware: bool, width: u32, height: u32, fps: u32, bitrate: u32 },
    /// The signaling socket dropped: current viewers keep watching, new ones cannot join until
    /// `SignalingRestored`.
    SignalingLost,
    SignalingRestored,
    /// The live cannot go on.
    Fatal { message: String },
}

pub type EventSink = Arc<dyn Fn(BroadcastEvent) + Send + Sync>;

pub struct NativeBroadcast {
    peer_id: String,
    host: Arc<host::Host>,
    pipeline: Mutex<Option<video::VideoPipeline>>,
    video_input: VideoInput,
    audio_input: AudioInput,
    signaling_task: tokio::task::JoinHandle<()>,
}

fn install_crypto_provider() {
    // Another crate may have installed one already; either is fine.
    let _ = rustls::crypto::ring::default_provider().install_default();
}

/// Connects and waits for the server to accept the id.
async fn open_signaling(
    server: &str,
    peer_id: &str,
) -> Result<(signaling::Outbound, tokio::sync::mpsc::UnboundedReceiver<signaling::Inbound>), String> {
    let (outbound, mut inbound) = signaling::connect(server, peer_id).await?;
    let opened = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            match inbound.recv().await {
                Some(signaling::Inbound::Open) => return Ok(()),
                Some(signaling::Inbound::IdTaken) => {
                    return Err("Este link de transmissão já está em uso. Feche a outra transmissão e tente de novo.".to_string())
                }
                Some(signaling::Inbound::Error(message)) => return Err(format!("A sinalização recusou a conexão: {message}")),
                Some(signaling::Inbound::Closed) | None => return Err("A sinalização fechou a conexão.".to_string()),
                Some(_) => continue,
            }
        }
    })
    .await
    .map_err(|_| "O servidor de sinalização não confirmou a conexão.".to_string())?;
    match opened {
        Ok(()) => Ok((outbound, inbound)),
        Err(error) => {
            outbound.close();
            Err(error)
        }
    }
}

impl NativeBroadcast {
    /// Starts encoding and opens the live; returns once viewers can join.
    pub async fn start(config: BroadcastConfig, events: EventSink) -> Result<Self, String> {
        install_crypto_provider();
        let peer_id = config
            .peer_id
            .clone()
            .filter(|id| !id.is_empty() && id.len() <= 64 && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'))
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let (outbound, inbound) = open_signaling(&config.signaling_server, &peer_id).await?;

        let (video_tx, _) = broadcast::channel::<Arc<video::EncodedFrame>>(VIDEO_QUEUE);
        let (audio_tx, _) = broadcast::channel::<Arc<audio::EncodedAudio>>(AUDIO_QUEUE);
        let video_sink: video::FrameSink = {
            let video_tx = video_tx.clone();
            Arc::new(move |frame| {
                let _ = video_tx.send(Arc::new(frame));
            })
        };
        let audio_sink: audio::AudioSink = {
            let audio_tx = audio_tx.clone();
            Arc::new(move |packet| {
                let _ = audio_tx.send(Arc::new(packet));
            })
        };
        let audio_input = match AudioInput::new(audio_sink) {
            Ok(input) => input,
            Err(error) => {
                outbound.close();
                return Err(error);
            }
        };
        let on_encoder: Arc<dyn Fn(EncoderInfo) + Send + Sync> = {
            let events = events.clone();
            Arc::new(move |info: EncoderInfo| {
                events(BroadcastEvent::Encoder {
                    name: info.name,
                    hardware: info.hardware,
                    width: info.width,
                    height: info.height,
                    fps: info.fps,
                    bitrate: info.bitrate,
                })
            })
        };
        let on_fatal: Arc<dyn Fn(String) + Send + Sync> = {
            let events = events.clone();
            Arc::new(move |message| events(BroadcastEvent::Fatal { message }))
        };
        let pipeline = video::VideoPipeline::start(config.video.clone(), video_sink, on_encoder, on_fatal);
        let video_input = pipeline.input();
        let request_keyframe: Arc<dyn Fn() + Send + Sync> = {
            let input = video_input.clone();
            Arc::new(move || input.request_keyframe())
        };

        let host = host::Host::new(config.ice_servers.clone(), video_tx, audio_tx, request_keyframe, events.clone());
        host.set_outbound(Some(outbound));
        let signaling_task = tokio::runtime::Handle::current().spawn(run_signaling(host.clone(), inbound, config.signaling_server.clone(), peer_id.clone(), events));

        Ok(Self {
            peer_id,
            host,
            pipeline: Mutex::new(Some(pipeline)),
            video_input,
            audio_input,
            signaling_task,
        })
    }

    pub fn peer_id(&self) -> &str {
        &self.peer_id
    }

    pub fn video_input(&self) -> VideoInput {
        self.video_input.clone()
    }

    pub fn audio_input(&self) -> AudioInput {
        self.audio_input.clone()
    }

    pub fn set_audio_muted(&self, muted: bool) {
        self.audio_input.set_muted(muted);
    }

    /// Sends the broadcaster's own message to every viewer.
    pub fn send_chat(&self, message: &ChatMessage) {
        self.host.relay_chat(message, None);
    }

    /// Ends the live: viewers are dropped, the id is released and the encoder thread is joined.
    pub fn stop(&self) {
        self.signaling_task.abort();
        self.host.stop();
        if let Some(mut pipeline) = self.pipeline.lock().ok().and_then(|mut pipeline| pipeline.take()) {
            pipeline.stop();
        }
    }
}

impl Drop for NativeBroadcast {
    fn drop(&mut self) {
        self.stop();
    }
}

async fn run_signaling(
    host: Arc<host::Host>,
    mut inbound: tokio::sync::mpsc::UnboundedReceiver<signaling::Inbound>,
    server: String,
    peer_id: String,
    events: EventSink,
) {
    loop {
        while let Some(message) = inbound.recv().await {
            if matches!(message, signaling::Inbound::Closed) {
                break;
            }
            host.handle(message);
        }
        host.set_outbound(None);
        log::warn!("signaling connection lost; reconnecting as {peer_id}");
        events(BroadcastEvent::SignalingLost);
        // The server keeps a dead socket's id for a while, so ID-TAKEN here just means "not yet".
        let mut delay = Duration::from_secs(1);
        loop {
            tokio::time::sleep(delay).await;
            if let Ok((outbound, next)) = open_signaling(&server, &peer_id).await {
                host.set_outbound(Some(outbound));
                inbound = next;
                log::info!("signaling connection restored");
                events(BroadcastEvent::SignalingRestored);
                break;
            }
            delay = (delay * 2).min(Duration::from_secs(20));
        }
    }
}
