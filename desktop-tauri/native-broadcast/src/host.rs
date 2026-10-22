//! The broadcaster's side of PeerJS: one RTCPeerConnection per viewer call (media) and per chat
//! connection (data), the way the web broadcaster gets a MediaConnection or DataConnection per
//! caller. Every viewer is fed the same encoded frames; only the RTP packets are per viewer.

use crate::audio::{EncodedAudio, FRAME_SAMPLES, SAMPLE_RATE};
use crate::chat::{self, ChatMessage, Incoming, Serialization, CHAT_CONNECTION_ROLE};
use crate::signaling::{Inbound, Outbound};
use crate::video::EncodedFrame;
use crate::{BroadcastEvent, EventSink};
use bytes::{Bytes, BytesMut};
use rtc::interceptor::{Attribute, Interceptor, Packet, Slot, StreamInfo, TaggedPacket};
use rtc::media_stream::MediaStreamTrack;
use rtc::peer_connection::configuration::interceptor_registry::{register_default_interceptors, Registry};
use rtc::peer_connection::configuration::media_engine::{MediaEngine, MIME_TYPE_H264, MIME_TYPE_OPUS};
use rtc::rtcp::payload_feedbacks::full_intra_request::FullIntraRequest;
use rtc::rtcp::payload_feedbacks::picture_loss_indication::PictureLossIndication;
use rtc::rtp_transceiver::rtp_sender::{
    RTCPFeedback, RTCRtpCodec, RTCRtpCodecParameters, RTCRtpCodingParameters, RTCRtpEncodingParameters, RtpCodecKind,
};
use rtc::rtp_transceiver::RTCRtpTransceiverDirection;
use rtc::sansio::Protocol;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, watch};
use tokio::task::JoinHandle;
use webrtc::data_channel::{DataChannel, DataChannelEvent};
use webrtc::media_stream::track_local::static_rtp::TrackLocalStaticRTP;
use webrtc::media_stream::track_local::{TrackLocal, TrackLocalEvent};
use webrtc::media_stream::track_remote::TrackRemote;
use webrtc::peer_connection::{
    PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCConfigurationBuilder, RTCIceCandidate,
    RTCIceCandidateInit, RTCIceServer, RTCPeerConnectionIceEvent, RTCPeerConnectionState, RTCSessionDescription,
    SettingEngineBuilder,
};
use webrtc::rtp_transceiver::RtpSender;

const MAX_MEDIA_CONNECTIONS_PER_SESSION: usize = 2;
const RTP_MTU: usize = 1200;
const VIDEO_CLOCK_RATE: f64 = 90_000.0;
// Constrained Baseline is what every viewer can decode; level-asymmetry lets the stream go above
// the offered level (1080p60 needs 4.2).
const H264_FMTP: &str = "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f";
const OPUS_FMTP: &str = "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1";
// A viewer that closes its tab sends nothing; ICE consent then fails after this long.
const ICE_DISCONNECTED_TIMEOUT: Duration = Duration::from_secs(4);
const ICE_FAILED_TIMEOUT: Duration = Duration::from_secs(10);
const ICE_KEEPALIVE: Duration = Duration::from_secs(2);

fn feedback(typ: &str, parameter: &str) -> RTCPFeedback {
    RTCPFeedback { typ: typ.to_string(), parameter: parameter.to_string() }
}

fn h264_codec() -> RTCRtpCodec {
    RTCRtpCodec {
        mime_type: MIME_TYPE_H264.to_string(),
        clock_rate: 90_000,
        channels: 0,
        sdp_fmtp_line: H264_FMTP.to_string(),
        rtcp_feedback: vec![feedback("nack", ""), feedback("nack", "pli"), feedback("ccm", "fir")],
    }
}

fn opus_codec() -> RTCRtpCodec {
    RTCRtpCodec {
        mime_type: MIME_TYPE_OPUS.to_string(),
        clock_rate: SAMPLE_RATE,
        channels: 2,
        sdp_fmtp_line: OPUS_FMTP.to_string(),
        rtcp_feedback: vec![],
    }
}

fn random_u32() -> u32 {
    uuid::Uuid::new_v4().as_u128() as u32
}

#[derive(Clone, Copy, PartialEq)]
enum LinkKind {
    Media,
    Chat(Serialization),
}

impl LinkKind {
    fn wire_name(self) -> &'static str {
        match self {
            LinkKind::Media => "media",
            LinkKind::Chat(_) => "data",
        }
    }
}

struct Link {
    kind: LinkKind,
    remote: String,
    pc: Option<Arc<dyn PeerConnection>>,
    remote_described: bool,
    pending_candidates: Vec<RTCIceCandidateInit>,
    channel: Option<Arc<dyn DataChannel>>,
    connected: watch::Sender<bool>,
    tasks: Vec<JoinHandle<()>>,
}

impl Link {
    fn new(kind: LinkKind, remote: String) -> Self {
        Self {
            kind,
            remote,
            pc: None,
            remote_described: false,
            pending_candidates: Vec::new(),
            channel: None,
            connected: watch::channel(false).0,
            tasks: Vec::new(),
        }
    }
}

struct Reservation {
    viewer: String,
    session: String,
}

#[derive(Default)]
struct State {
    links: HashMap<String, Link>,
    reservations: HashMap<String, Reservation>,
    viewer_count: usize,
}

impl State {
    /// Reserves a media connection, or returns `None` when it is refused. A viewer's newest
    /// session wins: one that left (or reloaded) and comes back must not be locked out by old
    /// connections that WebRTC takes a while to report closed. Returns the evicted connections.
    fn reserve(&mut self, connection_id: &str, viewer: &str, session: &str) -> Option<Vec<String>> {
        if self.reservations.contains_key(connection_id) {
            return None;
        }
        let evicted: Vec<String> = self
            .reservations
            .iter()
            .filter(|(_, reservation)| reservation.viewer == viewer && reservation.session != session)
            .map(|(id, _)| id.clone())
            .collect();
        evicted.iter().for_each(|id| {
            self.reservations.remove(id);
        });
        let same_session = self
            .reservations
            .values()
            .filter(|reservation| reservation.viewer == viewer && reservation.session == session)
            .count();
        if same_session >= MAX_MEDIA_CONNECTIONS_PER_SESSION {
            return None;
        }
        self.reservations.insert(
            connection_id.to_string(),
            Reservation { viewer: viewer.to_string(), session: session.to_string() },
        );
        Some(evicted)
    }
}

pub(crate) struct Host {
    // Spawns from any thread: the app calls in from outside the runtime's tasks.
    runtime: tokio::runtime::Handle,
    ice_servers: Vec<String>,
    outbound: Mutex<Option<Outbound>>,
    state: Mutex<State>,
    video: broadcast::Sender<Arc<EncodedFrame>>,
    audio: broadcast::Sender<Arc<EncodedAudio>>,
    request_keyframe: Arc<dyn Fn() + Send + Sync>,
    events: EventSink,
    chat_index: AtomicUsize,
    stopped: AtomicBool,
}

fn metadata_id(metadata: Option<&Value>, key: &str) -> Option<String> {
    metadata
        .and_then(|metadata| metadata.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty() && id.len() <= 128)
        .map(str::to_string)
}

impl Host {
    pub fn new(
        ice_servers: Vec<String>,
        video: broadcast::Sender<Arc<EncodedFrame>>,
        audio: broadcast::Sender<Arc<EncodedAudio>>,
        request_keyframe: Arc<dyn Fn() + Send + Sync>,
        events: EventSink,
    ) -> Arc<Self> {
        Arc::new(Self {
            runtime: tokio::runtime::Handle::current(),
            ice_servers,
            outbound: Mutex::new(None),
            state: Mutex::new(State::default()),
            video,
            audio,
            request_keyframe,
            events,
            chat_index: AtomicUsize::new(0),
            stopped: AtomicBool::new(false),
        })
    }

    pub fn set_outbound(&self, outbound: Option<Outbound>) {
        if let Ok(mut current) = self.outbound.lock() {
            *current = outbound;
        }
    }

    fn signal(&self, kind: &str, dst: &str, payload: Value) {
        if let Some(outbound) = self.outbound.lock().ok().and_then(|outbound| outbound.clone()) {
            outbound.signal(kind, dst, payload);
        }
    }

    fn send_leave(&self, dst: &str) {
        if let Some(outbound) = self.outbound.lock().ok().and_then(|outbound| outbound.clone()) {
            outbound.leave(dst);
        }
    }

    pub fn handle(self: &Arc<Self>, inbound: Inbound) {
        if self.stopped.load(Ordering::Acquire) {
            return;
        }
        match inbound {
            Inbound::Offer { src, payload } => self.accept_offer(src, payload),
            Inbound::Candidate { payload } => self.accept_candidate(&payload),
            Inbound::Leave { src } | Inbound::Expire { src } => self.remove_peer(&src),
            _ => {}
        }
    }

    // Runs before any await, so candidates that follow the offer on the socket find its link.
    fn accept_offer(self: &Arc<Self>, src: String, payload: Value) {
        let Some(connection_id) = payload.get("connectionId").and_then(Value::as_str).map(str::to_string) else {
            return;
        };
        let Some(sdp) = payload.pointer("/sdp/sdp").and_then(Value::as_str).map(str::to_string) else {
            return;
        };
        let metadata = payload.get("metadata");
        match payload.get("type").and_then(Value::as_str) {
            Some("media") => {
                // There is no camera here. Like the web broadcaster, the camera call is left
                // unanswered and the viewer shows the screen alone.
                if metadata.and_then(|metadata| metadata.get("source")).and_then(Value::as_str) == Some("camera") {
                    return;
                }
                let viewer = metadata_id(metadata, "viewerId").map_or_else(|| format!("peer:{src}"), |id| format!("viewer:{id}"));
                let session =
                    metadata_id(metadata, "viewerSessionId").map_or_else(|| format!("peer:{src}"), |id| format!("session:{id}"));
                let evicted = {
                    let Ok(mut state) = self.state.lock() else { return };
                    match state.reserve(&connection_id, &viewer, &session) {
                        Some(evicted) => {
                            state.links.insert(connection_id.clone(), Link::new(LinkKind::Media, src.clone()));
                            evicted
                        }
                        None => {
                            drop(state);
                            self.send_leave(&src);
                            return;
                        }
                    }
                };
                evicted.iter().for_each(|stale| self.close_link(stale));
                self.update_viewer_count();
                let host = self.clone();
                self.runtime.spawn(async move {
                    if let Err(error) = host.answer_media(&connection_id, &src, sdp).await {
                        log::warn!("could not answer viewer {src}: {error}");
                        host.close_link(&connection_id);
                    }
                });
            }
            Some("data") => {
                if metadata.and_then(|metadata| metadata.get("role")).and_then(Value::as_str) != Some(CHAT_CONNECTION_ROLE) {
                    return;
                }
                let serialization = Serialization::from_offer(payload.get("serialization").and_then(Value::as_str));
                if let Ok(mut state) = self.state.lock() {
                    state.links.insert(connection_id.clone(), Link::new(LinkKind::Chat(serialization), src.clone()));
                }
                let host = self.clone();
                self.runtime.spawn(async move {
                    if let Err(error) = host.answer_chat(&connection_id, &src, sdp).await {
                        log::warn!("could not answer chat {src}: {error}");
                        host.close_link(&connection_id);
                    }
                });
            }
            _ => {}
        }
    }

    fn accept_candidate(self: &Arc<Self>, payload: &Value) {
        let Some(connection_id) = payload.get("connectionId").and_then(Value::as_str) else { return };
        let Some(candidate) = payload.get("candidate") else { return };
        let init = RTCIceCandidateInit {
            candidate: candidate.get("candidate").and_then(Value::as_str).unwrap_or_default().to_string(),
            sdp_mid: candidate.get("sdpMid").and_then(Value::as_str).map(str::to_string),
            sdp_mline_index: candidate.get("sdpMLineIndex").and_then(Value::as_u64).map(|index| index as u16),
            username_fragment: candidate.get("usernameFragment").and_then(Value::as_str).map(str::to_string),
            url: None,
        };
        if init.candidate.is_empty() {
            return;
        }
        let pc = {
            let Ok(mut state) = self.state.lock() else { return };
            let Some(link) = state.links.get_mut(connection_id) else { return };
            match (&link.pc, link.remote_described) {
                (Some(pc), true) => pc.clone(),
                _ => {
                    link.pending_candidates.push(init);
                    return;
                }
            }
        };
        self.runtime.spawn(async move {
            if let Err(error) = pc.add_ice_candidate(init).await {
                log::debug!("ignored a remote candidate: {error}");
            }
        });
    }

    async fn build_peer_connection(self: &Arc<Self>, connection_id: &str, media: bool) -> Result<Arc<dyn PeerConnection>, String> {
        let mut media_engine = MediaEngine::default();
        if media {
            media_engine
                .register_codec(
                    RTCRtpCodecParameters { rtp_codec: h264_codec(), payload_type: 102, ..Default::default() },
                    RtpCodecKind::Video,
                )
                .map_err(|error| error.to_string())?;
            media_engine
                .register_codec(
                    RTCRtpCodecParameters { rtp_codec: opus_codec(), payload_type: 111, ..Default::default() },
                    RtpCodecKind::Audio,
                )
                .map_err(|error| error.to_string())?;
        }
        let registry = register_default_interceptors(Registry::new(), &mut media_engine).map_err(|error| error.to_string())?;
        // Application-most, so the NACK responder and reports have seen the RTCP first.
        let registry = registry.with(Slot::from(14_000), KeyframeRequestForwarder::default());
        let config = RTCConfigurationBuilder::new()
            .with_ice_servers(vec![RTCIceServer { urls: self.ice_servers.clone(), ..Default::default() }])
            .build();
        let handler = Arc::new(LinkHandler { host: Arc::downgrade(self), connection_id: connection_id.to_string() });
        let settings = SettingEngineBuilder::new()
            .with_ice_timeouts(Some(ICE_DISCONNECTED_TIMEOUT), Some(ICE_FAILED_TIMEOUT), Some(ICE_KEEPALIVE))
            .build();
        let pc = PeerConnectionBuilder::new()
            .with_configuration(config)
            .with_setting_engine(settings)
            .with_media_engine(media_engine)
            .with_interceptor_registry(registry)
            .with_handler(handler)
            .with_udp_addrs(vec!["0.0.0.0:0".to_string()])
            .build()
            .await
            .map_err(|error| error.to_string())?;
        let pc: Arc<dyn PeerConnection> = Arc::new(pc);
        let stored = self
            .state
            .lock()
            .ok()
            .and_then(|mut state| state.links.get_mut(connection_id).map(|link| link.pc = Some(pc.clone())))
            .is_some();
        if !stored {
            let _ = pc.close().await;
            return Err("the viewer left during negotiation".to_string());
        }
        Ok(pc)
    }

    /// Applies the offer and the candidates that arrived before it.
    async fn describe_remote(&self, connection_id: &str, pc: &Arc<dyn PeerConnection>, sdp: String) -> Result<(), String> {
        let offer = RTCSessionDescription::offer(sdp).map_err(|error| error.to_string())?;
        pc.set_remote_description(offer).await.map_err(|error| error.to_string())?;
        let pending = self
            .state
            .lock()
            .ok()
            .and_then(|mut state| {
                state.links.get_mut(connection_id).map(|link| {
                    link.remote_described = true;
                    std::mem::take(&mut link.pending_candidates)
                })
            })
            .unwrap_or_default();
        for candidate in pending {
            let _ = pc.add_ice_candidate(candidate).await;
        }
        Ok(())
    }

    async fn send_answer(&self, pc: &Arc<dyn PeerConnection>, connection_id: &str, src: &str, kind: LinkKind) -> Result<(), String> {
        let answer = pc.create_answer(None).await.map_err(|error| error.to_string())?;
        pc.set_local_description(answer).await.map_err(|error| error.to_string())?;
        let local = pc.local_description().await.ok_or("no local description")?;
        self.signal(
            "ANSWER",
            src,
            json!({
                "sdp": { "type": "answer", "sdp": local.sdp },
                "type": kind.wire_name(),
                "connectionId": connection_id,
            }),
        );
        Ok(())
    }

    async fn answer_media(self: &Arc<Self>, connection_id: &str, src: &str, sdp: String) -> Result<(), String> {
        let pc = self.build_peer_connection(connection_id, true).await?;
        // One stream id for both tracks: PeerJS reads `event.streams[0]` and the viewer gets them
        // as one MediaStream.
        let stream_id = format!("p2pcast_{connection_id}");
        let video_ssrc = random_u32();
        let audio_ssrc = random_u32();
        let track = |kind: RtpCodecKind, ssrc: u32, codec: RTCRtpCodec, name: &str| {
            Arc::new(TrackLocalStaticRTP::new(MediaStreamTrack::new(
                stream_id.clone(),
                format!("{name}_{connection_id}"),
                format!("p2pcast-{name}"),
                kind,
                vec![RTCRtpEncodingParameters {
                    rtp_coding_parameters: RTCRtpCodingParameters { ssrc: Some(ssrc), ..Default::default() },
                    codec,
                    ..Default::default()
                }],
            )))
        };
        let video_track = track(RtpCodecKind::Video, video_ssrc, h264_codec(), "video");
        let audio_track = track(RtpCodecKind::Audio, audio_ssrc, opus_codec(), "audio");
        let video_sender = pc.add_track(video_track.clone() as Arc<dyn TrackLocal>).await.map_err(|error| error.to_string())?;
        let audio_sender = pc.add_track(audio_track.clone() as Arc<dyn TrackLocal>).await.map_err(|error| error.to_string())?;

        self.describe_remote(connection_id, &pc, sdp).await?;
        // The viewer's offer also sends (a PeerJS call needs a local stream); answering sendonly
        // stops that useless upload.
        for transceiver in pc.get_transceivers().await {
            if transceiver.direction().await.ok() == Some(RTCRtpTransceiverDirection::Sendrecv) {
                let _ = transceiver.set_direction(RTCRtpTransceiverDirection::Sendonly).await;
            }
        }
        self.send_answer(&pc, connection_id, src, LinkKind::Media).await?;

        let video_payload_type = negotiated_payload_type(&video_sender)
            .await
            .ok_or("the viewer cannot decode H.264")?;
        let audio_payload_type = negotiated_payload_type(&audio_sender).await;
        let connected = self
            .state
            .lock()
            .ok()
            .and_then(|state| state.links.get(connection_id).map(|link| link.connected.subscribe()))
            .ok_or("the viewer left during negotiation")?;

        let mut tasks = vec![self.runtime.spawn(send_video(
            RtpWriter::new(video_track.clone(), video_ssrc, video_payload_type, &h264_codec(), true)?,
            self.video.subscribe(),
            connected.clone(),
            self.request_keyframe.clone(),
        ))];
        if let Some(payload_type) = audio_payload_type {
            tasks.push(self.runtime.spawn(send_audio(
                RtpWriter::new(audio_track.clone(), audio_ssrc, payload_type, &opus_codec(), false)?,
                self.audio.subscribe(),
                connected,
            )));
        }
        let request_keyframe = self.request_keyframe.clone();
        tasks.push(self.runtime.spawn(async move {
            // PLI/FIR from this viewer: its decoder lost the picture.
            while let Some(event) = video_track.poll().await {
                if matches!(event, TrackLocalEvent::OnRtcpPacket(_)) {
                    request_keyframe();
                }
            }
        }));
        self.adopt_tasks(connection_id, tasks);
        Ok(())
    }

    async fn answer_chat(self: &Arc<Self>, connection_id: &str, src: &str, sdp: String) -> Result<(), String> {
        let pc = self.build_peer_connection(connection_id, false).await?;
        self.describe_remote(connection_id, &pc, sdp).await?;
        let kind = self
            .state
            .lock()
            .ok()
            .and_then(|state| state.links.get(connection_id).map(|link| link.kind))
            .ok_or("the viewer left during negotiation")?;
        self.send_answer(&pc, connection_id, src, kind).await
    }

    fn adopt_tasks(&self, connection_id: &str, tasks: Vec<JoinHandle<()>>) {
        let leftover = match self.state.lock() {
            Ok(mut state) => match state.links.get_mut(connection_id) {
                Some(link) => {
                    link.tasks.extend(tasks);
                    return;
                }
                None => tasks,
            },
            Err(_) => tasks,
        };
        leftover.iter().for_each(JoinHandle::abort);
    }

    fn send_local_candidate(&self, connection_id: &str, candidate: &RTCIceCandidate) {
        let Ok(init) = candidate.to_json() else { return };
        let Some((remote, kind)) = self
            .state
            .lock()
            .ok()
            .and_then(|state| state.links.get(connection_id).map(|link| (link.remote.clone(), link.kind)))
        else {
            return;
        };
        self.signal(
            "CANDIDATE",
            &remote,
            json!({
                // Everything is bundled on the first m-line.
                "candidate": { "candidate": init.candidate, "sdpMid": "0", "sdpMLineIndex": 0 },
                "type": kind.wire_name(),
                "connectionId": connection_id,
            }),
        );
    }

    fn on_connection_state(self: &Arc<Self>, connection_id: &str, state: RTCPeerConnectionState) {
        match state {
            RTCPeerConnectionState::Connected => {
                if let Ok(state) = self.state.lock() {
                    if let Some(link) = state.links.get(connection_id) {
                        let _ = link.connected.send(true);
                    }
                }
            }
            RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed => self.close_link(connection_id),
            _ => {}
        }
    }

    fn attach_chat_channel(self: &Arc<Self>, connection_id: &str, channel: Arc<dyn DataChannel>) {
        let kind = {
            let Ok(mut state) = self.state.lock() else { return };
            let Some(link) = state.links.get_mut(connection_id) else { return };
            link.channel = Some(channel.clone());
            link.kind
        };
        let LinkKind::Chat(serialization) = kind else { return };
        let host = self.clone();
        let id = connection_id.to_string();
        let task = self.runtime.spawn(async move {
            loop {
                match channel.poll().await {
                    Some(DataChannelEvent::OnMessage(message)) => match chat::decode(serialization, &message.data) {
                        Incoming::Message { text, name } => host.receive_chat(&id, &text, name.as_deref()),
                        Incoming::Close => break,
                        Incoming::Ignored => {}
                    },
                    Some(DataChannelEvent::OnClose) | None => break,
                    Some(_) => {}
                }
            }
            host.close_link(&id);
        });
        self.adopt_tasks(connection_id, vec![task]);
    }

    fn receive_chat(&self, connection_id: &str, text: &str, name: Option<&str>) {
        let text = chat::sanitize_text(text);
        if text.is_empty() {
            return;
        }
        let index = self.chat_index.fetch_add(1, Ordering::Relaxed) + 1;
        let message = ChatMessage::new(text, chat::resolve_author_name(name, index), false);
        (self.events)(BroadcastEvent::Chat { message: message.clone() });
        self.relay_chat(&message, Some(connection_id));
    }

    /// Sends a message to every chat connection except `except`.
    pub fn relay_chat(&self, message: &ChatMessage, except: Option<&str>) {
        let channels: Vec<(Arc<dyn DataChannel>, Serialization)> = match self.state.lock() {
            Ok(state) => state
                .links
                .iter()
                .filter(|(id, _)| Some(id.as_str()) != except)
                .filter_map(|(_, link)| match (link.kind, &link.channel) {
                    (LinkKind::Chat(serialization), Some(channel)) => Some((channel.clone(), serialization)),
                    _ => None,
                })
                .collect(),
            Err(_) => return,
        };
        for (channel, serialization) in channels {
            let bytes = BytesMut::from(&chat::encode(serialization, message)[..]);
            self.runtime.spawn(async move {
                let _ = channel.send(bytes).await;
            });
        }
    }

    fn remove_peer(&self, remote: &str) {
        let ids: Vec<String> = match self.state.lock() {
            Ok(state) => state.links.iter().filter(|(_, link)| link.remote == remote).map(|(id, _)| id.clone()).collect(),
            Err(_) => return,
        };
        ids.iter().for_each(|id| self.close_link(id));
    }

    fn close_link(&self, connection_id: &str) {
        let link = match self.state.lock() {
            Ok(mut state) => {
                state.reservations.remove(connection_id);
                state.links.remove(connection_id)
            }
            Err(_) => None,
        };
        let Some(link) = link else { return };
        link.tasks.iter().for_each(JoinHandle::abort);
        let (pc, channel) = (link.pc, link.channel);
        self.runtime.spawn(async move {
            if let Some(channel) = channel {
                let _ = channel.close().await;
            }
            if let Some(pc) = pc {
                let _ = pc.close().await;
            }
        });
        self.update_viewer_count();
    }

    fn update_viewer_count(&self) {
        let changed = match self.state.lock() {
            Ok(mut state) => {
                let count = state
                    .links
                    .values()
                    .filter(|link| link.kind == LinkKind::Media)
                    .map(|link| link.remote.as_str())
                    .collect::<HashSet<_>>()
                    .len();
                (count != state.viewer_count).then(|| {
                    state.viewer_count = count;
                    count
                })
            }
            Err(_) => None,
        };
        if let Some(count) = changed {
            (self.events)(BroadcastEvent::Viewers { count });
        }
    }

    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        let ids: Vec<String> = self.state.lock().map(|state| state.links.keys().cloned().collect()).unwrap_or_default();
        ids.iter().for_each(|id| self.close_link(id));
        if let Some(outbound) = self.outbound.lock().ok().and_then(|mut outbound| outbound.take()) {
            outbound.close();
        }
    }
}

async fn negotiated_payload_type(sender: &Arc<dyn RtpSender>) -> Option<u8> {
    sender.get_parameters().await.ok()?.rtp_parameters.codecs.first().map(|codec| codec.payload_type)
}

struct LinkHandler {
    host: Weak<Host>,
    connection_id: String,
}

#[async_trait::async_trait]
impl PeerConnectionEventHandler for LinkHandler {
    async fn on_ice_candidate(&self, event: RTCPeerConnectionIceEvent) {
        if let Some(host) = self.host.upgrade() {
            host.send_local_candidate(&self.connection_id, &event.candidate);
        }
    }

    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        if let Some(host) = self.host.upgrade() {
            host.on_connection_state(&self.connection_id, state);
        }
    }

    async fn on_data_channel(&self, data_channel: Arc<dyn DataChannel>) {
        if let Some(host) = self.host.upgrade() {
            host.attach_chat_channel(&self.connection_id, data_channel);
        }
    }

    // Nothing is received; drain what an old viewer may still send so its queue never fills.
    async fn on_track(&self, track: Arc<dyn TrackRemote>) {
        if let Some(host) = self.host.upgrade() {
            host.runtime.spawn(async move { while track.poll().await.is_some() {} });
        }
    }
}

/// Packetizes one viewer's copy of a stream. The RTP timestamp comes from when the frame was
/// captured (or, for audio, its sample position), not from frame durations: after a still
/// picture the next frame must not look late to the viewer's jitter buffer.
struct RtpWriter {
    track: Arc<TrackLocalStaticRTP>,
    ssrc: u32,
    payload_type: u8,
    payloader: Box<dyn rtc::rtp::packetizer::Payloader>,
    sequence: u16,
    timestamp_base: u32,
    marker_on_last: bool,
}

impl RtpWriter {
    fn new(
        track: Arc<TrackLocalStaticRTP>,
        ssrc: u32,
        payload_type: u8,
        codec: &RTCRtpCodec,
        marker_on_last: bool,
    ) -> Result<Self, String> {
        Ok(Self {
            track,
            ssrc,
            payload_type,
            payloader: codec.payloader().map_err(|error| error.to_string())?,
            sequence: random_u32() as u16,
            timestamp_base: random_u32(),
            marker_on_last,
        })
    }

    async fn write(&mut self, payload: &Bytes, timestamp: u32) -> Result<(), String> {
        let chunks = self.payloader.payload(RTP_MTU - 12, payload).map_err(|error| error.to_string())?;
        let last = chunks.len().saturating_sub(1);
        for (index, chunk) in chunks.into_iter().enumerate() {
            let packet = rtc::rtp::Packet {
                header: rtc::rtp::Header {
                    version: 2,
                    marker: self.marker_on_last && index == last,
                    payload_type: self.payload_type,
                    sequence_number: self.sequence,
                    timestamp: self.timestamp_base.wrapping_add(timestamp),
                    ssrc: self.ssrc,
                    ..Default::default()
                },
                payload: chunk,
            };
            self.sequence = self.sequence.wrapping_add(1);
            self.track.write_rtp(packet).await.map_err(|error| error.to_string())?;
        }
        Ok(())
    }
}

async fn wait_connected(connected: &mut watch::Receiver<bool>) -> bool {
    while !*connected.borrow() {
        if connected.changed().await.is_err() {
            return false;
        }
    }
    true
}

async fn send_video(
    mut writer: RtpWriter,
    mut frames: broadcast::Receiver<Arc<EncodedFrame>>,
    mut connected: watch::Receiver<bool>,
    request_keyframe: Arc<dyn Fn() + Send + Sync>,
) {
    if !wait_connected(&mut connected).await {
        return;
    }
    // A viewer's decoder can start only from a keyframe.
    frames = frames.resubscribe();
    request_keyframe();
    let mut origin: Option<Instant> = None;
    loop {
        match frames.recv().await {
            Ok(frame) => {
                if origin.is_none() && !frame.keyframe {
                    continue;
                }
                let start = *origin.get_or_insert(frame.captured_at);
                let elapsed = frame.captured_at.saturating_duration_since(start).as_secs_f64();
                let timestamp = (elapsed * VIDEO_CLOCK_RATE) as u64 as u32;
                if let Err(error) = writer.write(&frame.data, timestamp).await {
                    log::debug!("video write failed: {error}");
                }
            }
            Err(broadcast::error::RecvError::Lagged(_)) => {
                // Frames were skipped: the next ones would not decode. Start over from a keyframe,
                // keeping the timeline.
                let resume_at = origin;
                origin = None;
                request_keyframe();
                while let Ok(frame) = frames.recv().await {
                    if frame.keyframe {
                        origin = resume_at;
                        let start = *origin.get_or_insert(frame.captured_at);
                        let elapsed = frame.captured_at.saturating_duration_since(start).as_secs_f64();
                        let _ = writer.write(&frame.data, (elapsed * VIDEO_CLOCK_RATE) as u64 as u32).await;
                        break;
                    }
                }
            }
            Err(broadcast::error::RecvError::Closed) => return,
        }
    }
}

async fn send_audio(
    mut writer: RtpWriter,
    mut packets: broadcast::Receiver<Arc<EncodedAudio>>,
    mut connected: watch::Receiver<bool>,
) {
    if !wait_connected(&mut connected).await {
        return;
    }
    packets = packets.resubscribe();
    let mut first_index: Option<u64> = None;
    loop {
        match packets.recv().await {
            Ok(packet) => {
                let first = *first_index.get_or_insert(packet.sample_index);
                let timestamp = packet.sample_index.saturating_sub(first) as u32;
                if let Err(error) = writer.write(&packet.data, timestamp).await {
                    log::debug!("audio write failed: {error}");
                }
            }
            // A gap: the timestamps already say how much is missing.
            Err(broadcast::error::RecvError::Lagged(_)) => {}
            Err(broadcast::error::RecvError::Closed) => return,
        }
    }
}

// Keeps the compiler honest about the audio frame size the writer assumes.
const _: () = assert!(FRAME_SAMPLES == 960);

/// Hands inbound keyframe requests (PLI, FIR) to the application and drops the rest of the inbound
/// RTCP, which the other interceptors have already used. See webrtc's rtcp-processing example.
#[derive(Default)]
struct KeyframeRequestForwarder {
    read_queue: VecDeque<TaggedPacket>,
    write_queue: VecDeque<TaggedPacket>,
}

fn is_keyframe_request(packet: &Box<dyn rtc::rtcp::Packet>) -> bool {
    let payload = packet.as_any();
    payload.is::<PictureLossIndication>() || payload.is::<FullIntraRequest>()
}

impl Protocol<TaggedPacket, TaggedPacket, ()> for KeyframeRequestForwarder {
    type Rout = TaggedPacket;
    type Wout = TaggedPacket;
    type Eout = ();
    type Error = rtc::shared::error::Error;
    type Time = Instant;

    fn handle_read(&mut self, mut message: TaggedPacket) -> Result<(), Self::Error> {
        if let Packet::Rtcp(packets) = &message.message.packet {
            let requests: Vec<Box<dyn rtc::rtcp::Packet>> =
                packets.iter().filter(|packet| is_keyframe_request(packet)).cloned().collect();
            if requests.is_empty() {
                return Ok(());
            }
            message.message.packet = Packet::Rtcp(requests);
            message.message.add(Attribute::DeliverToApplication);
        }
        self.read_queue.push_back(message);
        Ok(())
    }

    fn poll_read(&mut self) -> Option<Self::Rout> {
        self.read_queue.pop_front()
    }

    fn handle_write(&mut self, message: TaggedPacket) -> Result<(), Self::Error> {
        self.write_queue.push_back(message);
        Ok(())
    }

    fn poll_write(&mut self) -> Option<Self::Wout> {
        self.write_queue.pop_front()
    }
}

impl Interceptor for KeyframeRequestForwarder {
    fn bind_local_stream(&mut self, _info: &StreamInfo) {}
    fn unbind_local_stream(&mut self, _info: &StreamInfo) {}
    fn bind_remote_stream(&mut self, _info: &StreamInfo) {}
    fn unbind_remote_stream(&mut self, _info: &StreamInfo) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newest_session_of_a_viewer_wins() {
        let mut state = State::default();
        assert_eq!(state.reserve("mc_1", "viewer:a", "session:1"), Some(vec![]));
        assert_eq!(state.reserve("mc_1", "viewer:a", "session:1"), None);
        // The same viewer comes back with a new session: the old one is evicted.
        assert_eq!(state.reserve("mc_2", "viewer:a", "session:2"), Some(vec!["mc_1".to_string()]));
        // A second call of that session is fine; a third is refused.
        assert_eq!(state.reserve("mc_3", "viewer:a", "session:2"), Some(vec![]));
        assert_eq!(state.reserve("mc_4", "viewer:a", "session:2"), None);
        // Other viewers are independent.
        assert_eq!(state.reserve("mc_5", "viewer:b", "session:9"), Some(vec![]));
    }
}
