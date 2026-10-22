//! The native sender (p2pcast-native-broadcast) inside the app: the WGC and WASAPI helpers feed it
//! directly and it serves every viewer, so frames and audio never cross into the webview. The page
//! keeps the UI, the share link and the presence; it hears from the sender on "native-broadcast".

use crate::{windows_audio, windows_capture};
use p2pcast_native_broadcast::{
    BroadcastConfig, BroadcastEvent, ChatMessage, EncoderPreference, EventSink, NativeBroadcast, VideoSettings,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

const EVENT: &str = "native-broadcast";
// WebRTC viewers render at most 60 fps; capturing more only costs CPU next to the game.
const MAX_FPS: u32 = 60;

struct Running {
    broadcast: Arc<NativeBroadcast>,
    video: windows_capture::NativeVideoCapture,
    audio: Option<windows_audio::NativeAudioCapture>,
    events: EventSink,
}

impl Running {
    fn stop(&mut self) {
        self.video.stop();
        if let Some(audio) = self.audio.as_mut() {
            audio.stop();
        }
        self.broadcast.stop();
    }
}

#[derive(Default)]
pub struct NativeBroadcasts(Mutex<Option<Running>>);

impl NativeBroadcasts {
    pub fn is_active(&self) -> bool {
        self.0.lock().map_or(true, |running| running.is_some())
    }

    fn current(&self) -> Option<Arc<NativeBroadcast>> {
        self.0.lock().ok()?.as_ref().map(|running| running.broadcast.clone())
    }
}

impl Drop for NativeBroadcasts {
    fn drop(&mut self) {
        if let Ok(running) = self.0.get_mut() {
            if let Some(running) = running.as_mut() {
                running.stop();
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartNativeBroadcast {
    peer_id: Option<String>,
    video_source_id: String,
    audio_source_id: Option<String>,
    fps: u32,
    cursor: String,
    /// The profile's resolution as a bounding box; 0 keeps the window's size.
    max_width: u32,
    max_height: u32,
    bitrate: Option<u32>,
    #[serde(default)]
    software_encoder: bool,
}

fn on_error(events: &EventSink) -> Box<dyn Fn(String) + Send> {
    let events = events.clone();
    Box::new(move |message| events(BroadcastEvent::Fatal { message }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBroadcastStarted {
    peer_id: String,
}

#[tauri::command]
pub async fn start_native_broadcast(
    app: AppHandle,
    state: State<'_, NativeBroadcasts>,
    request: StartNativeBroadcast,
) -> Result<NativeBroadcastStarted, String> {
    if state.is_active() {
        return Err("Já existe uma transmissão ativa.".to_string());
    }
    let events: EventSink = {
        let app = app.clone();
        Arc::new(move |event: BroadcastEvent| {
            let _ = app.emit(EVENT, &event);
        })
    };
    let fps = request.fps.clamp(15, MAX_FPS);
    let config = BroadcastConfig::p2pcast(
        request.peer_id,
        VideoSettings {
            max_width: request.max_width,
            max_height: request.max_height,
            fps,
            bitrate: request.bitrate,
            encoder: if request.software_encoder { EncoderPreference::Software } else { EncoderPreference::Auto },
        },
    );
    log::info!(
        "starting native broadcast: video {}, audio {:?}, {fps} fps, max {}x{}, bitrate {:?}",
        request.video_source_id,
        request.audio_source_id,
        request.max_width,
        request.max_height,
        request.bitrate
    );
    let broadcast = match NativeBroadcast::start(config, events.clone()).await {
        Ok(broadcast) => Arc::new(broadcast),
        Err(error) => {
            log::error!("native broadcast did not start: {error}");
            return Err(error);
        }
    };

    let settings = windows_capture::VideoCaptureSettings::new(fps, request.cursor);
    let video = match windows_capture::start_native(
        &app,
        &request.video_source_id,
        &settings,
        broadcast.video_input(),
        on_error(&events),
    ) {
        Ok(video) => video,
        Err(error) => {
            log::error!("native capture did not start: {error}");
            broadcast.stop();
            return Err(error);
        }
    };
    let audio = match request.audio_source_id.as_deref() {
        Some(source) => match windows_audio::start_native(&app, source, broadcast.audio_input(), on_error(&events)) {
            Ok(audio) => Some(audio),
            Err(error) => {
                log::error!("native audio capture did not start: {error}");
                let mut running = Running { broadcast, video, audio: None, events };
                running.stop();
                return Err(error);
            }
        },
        None => None,
    };

    let peer_id = broadcast.peer_id().to_string();
    log::info!("native broadcast live as {peer_id}");
    match state.0.lock() {
        Ok(mut current) => *current = Some(Running { broadcast, video, audio, events }),
        Err(_) => {
            Running { broadcast, video, audio, events }.stop();
            return Err("O estado da transmissão está indisponível.".to_string());
        }
    }
    Ok(NativeBroadcastStarted { peer_id })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchNativeCapture {
    video_source_id: String,
    audio_source_id: Option<String>,
    fps: u32,
    cursor: String,
    max_width: u32,
    max_height: u32,
    bitrate: Option<u32>,
}

/// Moves the running live to another capture and settings (another shortcut profile). The new
/// picture starts before the old one stops, so a capture that cannot start leaves the live as it
/// was; viewers stay connected throughout. A switch whose new audio did not start still happened:
/// it resolves with that warning.
#[tauri::command]
pub async fn switch_native_capture(
    app: AppHandle,
    state: State<'_, NativeBroadcasts>,
    request: SwitchNativeCapture,
) -> Result<Option<String>, String> {
    let running = state
        .0
        .lock()
        .map_err(|_| "O estado da transmissão está indisponível.".to_string())?
        .take()
        .ok_or_else(|| "Nenhuma transmissão ativa.".to_string())?;
    log::info!(
        "switching native capture to video {}, audio {:?}, {} fps, max {}x{}, bitrate {:?}",
        request.video_source_id,
        request.audio_source_id,
        request.fps,
        request.max_width,
        request.max_height,
        request.bitrate
    );
    let (running, outcome) = tauri::async_runtime::spawn_blocking(move || {
        let mut running = running;
        let fps = request.fps.clamp(15, MAX_FPS);
        let settings = windows_capture::VideoCaptureSettings::new(fps, request.cursor);
        let video = match windows_capture::start_native(
            &app,
            &request.video_source_id,
            &settings,
            running.broadcast.video_input(),
            on_error(&running.events),
        ) {
            Ok(video) => video,
            Err(error) => {
                log::error!("the new capture did not start, keeping the current one: {error}");
                return (running, Err(error));
            }
        };
        running.broadcast.update_video_settings(VideoSettings {
            max_width: request.max_width,
            max_height: request.max_height,
            fps,
            bitrate: request.bitrate,
            encoder: EncoderPreference::Auto,
        });
        let mut previous = std::mem::replace(&mut running.video, video);
        previous.stop();
        if let Some(mut audio) = running.audio.take() {
            audio.stop();
        }
        let mut outcome = Ok(None);
        if let Some(source) = request.audio_source_id.as_deref() {
            match windows_audio::start_native(&app, source, running.broadcast.audio_input(), on_error(&running.events)) {
                Ok(audio) => running.audio = Some(audio),
                Err(error) => {
                    log::error!("the new audio capture did not start: {error}");
                    outcome = Ok(Some(error));
                }
            }
        }
        (running, outcome)
    })
    .await
    .map_err(|error| error.to_string())?;
    if let Ok(mut current) = state.0.lock() {
        *current = Some(running);
    }
    outcome
}

#[tauri::command]
pub async fn stop_native_broadcast(state: State<'_, NativeBroadcasts>) -> Result<(), String> {
    let running = state.0.lock().ok().and_then(|mut current| current.take());
    if let Some(mut running) = running {
        log::info!("stopping native broadcast");
        // Joins the helpers' readers and the encoder thread.
        tauri::async_runtime::spawn_blocking(move || running.stop())
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn send_native_chat(state: State<'_, NativeBroadcasts>, message: ChatMessage) -> Result<(), String> {
    if let Some(broadcast) = state.current() {
        broadcast.send_chat(&message);
    }
    Ok(())
}

#[tauri::command]
pub fn set_native_audio_muted(state: State<'_, NativeBroadcasts>, muted: bool) {
    if let Some(broadcast) = state.current() {
        broadcast.set_audio_muted(muted);
    }
}
