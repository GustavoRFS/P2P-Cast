//! Video: the newest captured frame is converted and encoded to H.264 once, on its own thread, and
//! the encoded frames go to every viewer. Frames that arrive while one is being encoded replace
//! each other, so a slow moment never builds a queue (and delay).

mod convert;
#[cfg(windows)]
mod media_foundation;
mod openh264_encoder;

use convert::{Converter, YuvFrame, YuvLayout};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub use convert::target_size;

/// WGC reports a frame only when the window changes; a still picture is sent again this often so
/// new viewers, and viewers that lost a packet, are never left without one.
const STILL_REFRESH: Duration = Duration::from_secs(1);
/// Keyframes are large; many viewers asking at once (or one lossy link asking repeatedly) get one
/// per this interval.
const MIN_KEYFRAME_GAP: Duration = Duration::from_millis(500);

#[derive(Debug, Clone)]
pub struct VideoSettings {
    /// The profile's resolution as a bounding box; 0 keeps the window's own size.
    pub max_width: u32,
    pub max_height: u32,
    pub fps: u32,
    /// Bits per second; `None` picks one from the resolution and frame rate.
    pub bitrate: Option<u32>,
    pub encoder: EncoderPreference,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncoderPreference {
    /// The GPU encoder when Media Foundation finds one, else openh264.
    Auto,
    Software,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EncoderInfo {
    pub name: String,
    pub hardware: bool,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate: u32,
}

pub(crate) struct EncodedFrame {
    /// Annex B H.264 access unit.
    pub data: bytes::Bytes,
    pub keyframe: bool,
    pub captured_at: Instant,
}

pub(crate) type FrameSink = Arc<dyn Fn(EncodedFrame) + Send + Sync>;

pub(crate) trait H264Encoder: Send {
    fn info(&self) -> EncoderInfo;
    fn layout(&self) -> YuvLayout;
    /// Encodes one frame. Its output reaches the sink now, or a little later for the asynchronous
    /// hardware encoders.
    fn encode(&mut self, frame: &YuvFrame, captured_at: Instant, keyframe: bool) -> Result<(), String>;
}

/// Bits per second for a resolution and frame rate when the profile says "automático".
pub fn auto_bitrate(width: u32, height: u32, fps: u32) -> u32 {
    let bits = width as f64 * height as f64 * fps.min(60) as f64 * 0.07;
    bits.clamp(1_500_000.0, 12_000_000.0) as u32
}

struct RawFrame {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    captured_at: Instant,
}

#[derive(Default)]
struct State {
    frame: Option<RawFrame>,
    spare: Vec<Vec<u8>>,
    keyframe: bool,
    stopped: bool,
}

#[derive(Default)]
struct Shared {
    state: Mutex<State>,
    wake: Condvar,
}

/// Where the capture hands its frames to the encoder.
#[derive(Clone)]
pub struct VideoInput(Arc<Shared>);

impl VideoInput {
    /// A buffer of `length` bytes to read the next frame into, recycled from earlier frames.
    pub fn buffer(&self, length: usize) -> Vec<u8> {
        let mut buffer = self.0.state.lock().ok().and_then(|mut state| state.spare.pop()).unwrap_or_default();
        buffer.resize(length, 0);
        buffer
    }

    /// Hands over an RGBA frame; it replaces one the encoder has not taken yet.
    pub fn push_rgba(&self, width: u32, height: u32, rgba: Vec<u8>) {
        let Ok(mut state) = self.0.state.lock() else { return };
        let frame = RawFrame { width, height, rgba, captured_at: Instant::now() };
        if let Some(replaced) = state.frame.replace(frame) {
            recycle(&mut state, replaced.rgba);
        }
        self.0.wake.notify_one();
    }

    /// Asks for a keyframe: a viewer joined or lost the picture.
    pub(crate) fn request_keyframe(&self) {
        if let Ok(mut state) = self.0.state.lock() {
            state.keyframe = true;
            self.0.wake.notify_one();
        }
    }
}

fn recycle(state: &mut State, buffer: Vec<u8>) {
    if state.spare.len() < 3 {
        state.spare.push(buffer);
    }
}

pub(crate) struct VideoPipeline {
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}

impl VideoPipeline {
    pub fn start(
        settings: VideoSettings,
        sink: FrameSink,
        on_encoder: Arc<dyn Fn(EncoderInfo) + Send + Sync>,
        on_fatal: Arc<dyn Fn(String) + Send + Sync>,
    ) -> Self {
        let shared = Arc::new(Shared::default());
        let thread_shared = shared.clone();
        let thread = std::thread::Builder::new()
            .name("p2pcast-video-encoder".to_string())
            .spawn(move || run(thread_shared, settings, sink, on_encoder, on_fatal))
            .ok();
        Self { shared, thread }
    }

    pub fn input(&self) -> VideoInput {
        VideoInput(self.shared.clone())
    }

    pub fn stop(&mut self) {
        if let Ok(mut state) = self.shared.state.lock() {
            state.stopped = true;
            self.shared.wake.notify_one();
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for VideoPipeline {
    fn drop(&mut self) {
        self.stop();
    }
}

fn create_encoder(
    software_only: bool,
    width: u32,
    height: u32,
    settings: &VideoSettings,
    sink: &FrameSink,
) -> Result<Box<dyn H264Encoder>, String> {
    let fps = settings.fps.clamp(1, 60);
    let bitrate = settings.bitrate.unwrap_or_else(|| auto_bitrate(width, height, fps));
    #[cfg(windows)]
    if !software_only {
        match media_foundation::MediaFoundationEncoder::new(width, height, fps, bitrate, sink.clone()) {
            Ok(encoder) => return Ok(Box::new(encoder)),
            Err(error) => log::warn!("no Media Foundation H.264 encoder, using openh264: {error}"),
        }
    }
    let _ = software_only;
    Ok(Box::new(openh264_encoder::OpenH264::new(width, height, fps, bitrate, sink.clone())?))
}

fn run(
    shared: Arc<Shared>,
    settings: VideoSettings,
    sink: FrameSink,
    on_encoder: Arc<dyn Fn(EncoderInfo) + Send + Sync>,
    on_fatal: Arc<dyn Fn(String) + Send + Sync>,
) {
    let mut software_only = settings.encoder == EncoderPreference::Software;
    let mut encoder: Option<Box<dyn H264Encoder>> = None;
    let mut converter = Converter::default();
    let mut picture: Option<YuvFrame> = None;
    let mut last_encode = Instant::now();
    let mut last_keyframe: Option<Instant> = None;
    let mut keyframe_pending = true;

    loop {
        let (frame, keyframe_requested) = {
            let Ok(mut state) = shared.state.lock() else { return };
            loop {
                if state.stopped {
                    return;
                }
                if state.frame.is_some() || state.keyframe {
                    break;
                }
                if picture.is_none() {
                    state = match shared.wake.wait(state) {
                        Ok(state) => state,
                        Err(_) => return,
                    };
                    continue;
                }
                // A still picture: wake to send it again, or for a keyframe held back by the gap.
                let mut deadline = last_encode + STILL_REFRESH;
                if keyframe_pending {
                    let allowed = last_keyframe.map_or(Instant::now(), |at| at + MIN_KEYFRAME_GAP);
                    deadline = deadline.min(allowed);
                }
                let now = Instant::now();
                if now >= deadline {
                    break;
                }
                state = match shared.wake.wait_timeout(state, deadline - now) {
                    Ok((state, _)) => state,
                    Err(_) => return,
                };
            }
            let frame = state.frame.take();
            let requested = std::mem::take(&mut state.keyframe);
            (frame, requested)
        };
        keyframe_pending |= keyframe_requested;

        let captured_at = match frame {
            Some(frame) => {
                let (width, height) = target_size(frame.width, frame.height, settings.max_width, settings.max_height);
                let current = encoder.as_ref().map(|encoder| encoder.info());
                if current.as_ref().map_or(true, |info| (info.width, info.height) != (width, height)) {
                    match create_encoder(software_only, width, height, &settings, &sink) {
                        Ok(created) => {
                            on_encoder(created.info());
                            picture = Some(YuvFrame::new(width, height, created.layout()));
                            encoder = Some(created);
                            keyframe_pending = true;
                        }
                        Err(error) => {
                            on_fatal(format!("Não foi possível iniciar o codificador de vídeo: {error}"));
                            return;
                        }
                    }
                }
                let target = picture.as_mut().expect("a picture exists once an encoder does");
                if let Err(error) = converter.convert(&frame.rgba, frame.width, frame.height, target) {
                    log::warn!("dropped a frame: {error}");
                }
                let captured_at = frame.captured_at;
                if let Ok(mut state) = shared.state.lock() {
                    recycle(&mut state, frame.rgba);
                }
                captured_at
            }
            // A repeat of the still picture, stamped now so viewers see time moving on.
            None if picture.is_some() => Instant::now(),
            None => continue,
        };

        let force = keyframe_pending && last_keyframe.map_or(true, |at| at.elapsed() >= MIN_KEYFRAME_GAP);
        let (Some(active), Some(target)) = (encoder.as_mut(), picture.as_ref()) else { continue };
        match active.encode(target, captured_at, force) {
            Ok(()) => {
                last_encode = Instant::now();
                if force {
                    keyframe_pending = false;
                    last_keyframe = Some(last_encode);
                }
            }
            Err(error) if active.info().hardware => {
                log::warn!("hardware encoder failed, switching to openh264: {error}");
                software_only = true;
                let (width, height) = (target.width, target.height);
                match create_encoder(true, width, height, &settings, &sink) {
                    Ok(created) => {
                        on_encoder(created.info());
                        let layout = created.layout();
                        encoder = Some(created);
                        keyframe_pending = true;
                        // The picture was laid out for the old encoder; the next frame rebuilds it.
                        if picture.as_ref().is_some_and(|picture| picture.layout != layout) {
                            picture = Some(YuvFrame::new(width, height, layout));
                        }
                    }
                    Err(error) => {
                        on_fatal(format!("O codificador de vídeo parou: {error}"));
                        return;
                    }
                }
            }
            Err(error) => {
                on_fatal(format!("O codificador de vídeo parou: {error}"));
                return;
            }
        }
    }
}
