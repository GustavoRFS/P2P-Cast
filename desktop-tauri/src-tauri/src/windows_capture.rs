use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

const FRAME_MAGIC: u32 = 0x50434652;
const MAX_FRAME_BYTES: usize = 256 * 1024 * 1024;

#[derive(Default)]
pub struct VideoCaptures {
    next_id: AtomicU64,
    captures: Mutex<HashMap<String, Capture>>,
}

struct Capture {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
    acknowledge: SyncSender<()>,
    waiting_ack: Option<Receiver<()>>,
    stopped: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperDescriptor {
    width: u32,
    height: u32,
    format: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoCaptureDescriptor {
    capture_id: String,
    width: u32,
    height: u32,
    format: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoCaptureSettings {
    fps: u32,
    cursor: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VideoErrorEvent {
    capture_id: String,
    message: String,
}

fn helper_path(app: &AppHandle) -> Result<PathBuf, String> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Could not locate Tauri resources: {error}"))?
        .join("p2pcast-wgc-capture.exe");
    if packaged.is_file() {
        return Ok(packaged);
    }
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../desktop/resources/p2pcast-wgc-capture.exe");
    if development.is_file() {
        return Ok(development);
    }
    Err(
        "The Windows Graphics Capture helper is missing. Build the Windows native helpers first."
            .to_string(),
    )
}

impl VideoCaptures {
    pub fn is_available(app: &AppHandle) -> bool {
        helper_path(app).is_ok()
    }
}

fn emit_video_error(app: &AppHandle, capture_id: &str, message: impl Into<String>) {
    let _ = app.emit(
        "desktop-video-error",
        VideoErrorEvent {
            capture_id: capture_id.to_string(),
            message: message.into(),
        },
    );
}

pub fn start(
    app: AppHandle,
    captures: &VideoCaptures,
    source_id: String,
    settings: VideoCaptureSettings,
) -> Result<VideoCaptureDescriptor, String> {
    if !(15..=240).contains(&settings.fps) {
        return Err("Requested capture frame rate is out of bounds.".to_string());
    }
    let (kind, raw_handle) = source_id
        .split_once(':')
        .ok_or_else(|| "Invalid Windows capture target.".to_string())?;
    if !matches!(kind, "window" | "monitor")
        || raw_handle.is_empty()
        || raw_handle.len() > 16
        || !raw_handle.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("Invalid Windows capture target.".to_string());
    }
    let cursor = match settings.cursor.as_str() {
        "never" => "0",
        "always" | "motion" => "1",
        _ => return Err("Invalid cursor capture setting.".to_string()),
    };

    let mut child = Command::new(helper_path(&app)?)
        .arg(kind)
        .arg(raw_handle)
        .arg(settings.fps.to_string())
        .arg(cursor)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not start Windows Graphics Capture: {error}"))?;
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        return Err("Could not read from the Windows capture helper.".to_string());
    };
    let Some(stdin) = child.stdin.take() else {
        let _ = child.kill();
        return Err("Could not send acknowledgements to the Windows capture helper.".to_string());
    };
    let mut stdout = BufReader::new(stdout);
    let mut handshake = Vec::new();
    if let Err(error) = stdout.read_until(b'\n', &mut handshake) {
        let _ = child.kill();
        return Err(format!(
            "Could not initialize the Windows capture helper: {error}"
        ));
    }
    let descriptor: HelperDescriptor = match serde_json::from_slice(&handshake) {
        Ok(value) => value,
        Err(error) => {
            let _ = child.kill();
            return Err(format!(
                "Windows capture helper did not initialize: {error}"
            ));
        }
    };
    if descriptor.width == 0
        || descriptor.height == 0
        || descriptor.width > 16_384
        || descriptor.height > 16_384
        || (descriptor.width as usize)
            .checked_mul(descriptor.height as usize)
            .and_then(|pixels| pixels.checked_mul(4))
            .map_or(true, |length| length > MAX_FRAME_BYTES)
        || descriptor.format != "rgba8"
    {
        let _ = child.kill();
        return Err(
            "Windows capture helper returned unsupported video dimensions or format.".to_string(),
        );
    }

    let capture_id = format!(
        "tauri-video-{}",
        captures.next_id.fetch_add(1, Ordering::Relaxed) + 1
    );
    let (acknowledge, waiting_ack) = mpsc::sync_channel(1);
    let mut active_captures = match captures.captures.lock() {
        Ok(active_captures) => active_captures,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Video capture state is unavailable.".to_string());
        }
    };
    active_captures.insert(
        capture_id.clone(),
        Capture {
            child,
            stdin: Some(stdin),
            stdout: Some(stdout),
            acknowledge,
            waiting_ack: Some(waiting_ack),
            stopped: Arc::new(AtomicBool::new(false)),
            worker: None,
        },
    );

    Ok(VideoCaptureDescriptor {
        capture_id,
        width: descriptor.width,
        height: descriptor.height,
        format: "rgba8",
    })
}

pub fn resume(app: AppHandle, captures: &VideoCaptures, capture_id: &str) -> Result<(), String> {
    let mut captures = captures
        .captures
        .lock()
        .map_err(|_| "Video capture state is unavailable.".to_string())?;
    let capture = captures
        .get_mut(capture_id)
        .ok_or_else(|| "Video capture was not found.".to_string())?;
    if capture.worker.is_some() {
        return Ok(());
    }
    let mut stdout = capture
        .stdout
        .take()
        .ok_or_else(|| "Video capture output was already consumed.".to_string())?;
    let mut stdin = capture
        .stdin
        .take()
        .ok_or_else(|| "Video capture acknowledgements were already consumed.".to_string())?;
    let waiting_ack = capture
        .waiting_ack
        .take()
        .ok_or_else(|| "Video capture acknowledgements are unavailable.".to_string())?;
    let stopped = capture.stopped.clone();
    let worker_capture_id = capture_id.to_string();
    capture.worker = Some(thread::spawn(move || {
        let mut header_bytes = [0u8; 16];
        loop {
            if stopped.load(Ordering::Acquire) {
                break;
            }
            if let Err(error) = stdout.read_exact(&mut header_bytes) {
                if !stopped.load(Ordering::Acquire) {
                    emit_video_error(
                        &app,
                        &worker_capture_id,
                        format!("Video capture stopped: {error}"),
                    );
                }
                break;
            }
            let magic = u32::from_le_bytes(header_bytes[0..4].try_into().unwrap());
            let width = u32::from_le_bytes(header_bytes[4..8].try_into().unwrap());
            let height = u32::from_le_bytes(header_bytes[8..12].try_into().unwrap());
            let byte_length = u32::from_le_bytes(header_bytes[12..16].try_into().unwrap()) as usize;
            let expected_length = (width as usize)
                .checked_mul(height as usize)
                .and_then(|pixels| pixels.checked_mul(4));
            if magic != FRAME_MAGIC
                || width == 0
                || height == 0
                || expected_length != Some(byte_length)
                || byte_length > MAX_FRAME_BYTES
            {
                emit_video_error(
                    &app,
                    &worker_capture_id,
                    "The WGC helper returned an invalid frame.",
                );
                break;
            }
            let mut frame = vec![0u8; byte_length];
            if let Err(error) = stdout.read_exact(&mut frame) {
                if !stopped.load(Ordering::Acquire) {
                    emit_video_error(
                        &app,
                        &worker_capture_id,
                        format!("Could not read a captured frame: {error}"),
                    );
                }
                break;
            }
            if let Err(error) = post_shared_frame(&app, &worker_capture_id, width, height, frame) {
                emit_video_error(&app, &worker_capture_id, error);
                break;
            }
            match waiting_ack.recv_timeout(Duration::from_secs(4)) {
                Ok(()) => {
                    if let Err(error) = stdin.write_all(&[1]).and_then(|()| stdin.flush()) {
                        if !stopped.load(Ordering::Acquire) {
                            emit_video_error(
                                &app,
                                &worker_capture_id,
                                format!("Could not resume the WGC helper: {error}"),
                            );
                        }
                        break;
                    }
                }
                Err(_) if stopped.load(Ordering::Acquire) => break,
                Err(_) => {
                    emit_video_error(
                        &app,
                        &worker_capture_id,
                        "The renderer stopped consuming WGC frames.",
                    );
                    break;
                }
            }
        }
    }));
    Ok(())
}

fn post_shared_frame(
    app: &AppHandle,
    capture_id: &str,
    width: u32,
    height: u32,
    pixels: Vec<u8>,
) -> Result<(), String> {
    use tauri::webview::PlatformWebview;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment12, ICoreWebView2_17, COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY,
    };
    use windows::core::{Interface, PCWSTR};

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "The Tauri main webview is unavailable.".to_string())?;
    let (sender, receiver) = mpsc::sync_channel(1);
    let capture_id = capture_id.to_string();
    window
        .with_webview(move |webview: PlatformWebview| {
            let result = (|| -> Result<(), String> {
                unsafe {
                    let environment = webview
                        .environment()
                        .cast::<ICoreWebView2Environment12>()
                        .map_err(|error| format!("WebView2 shared buffers are unavailable: {error}"))?;
                    let core = webview
                        .controller()
                        .CoreWebView2()
                        .map_err(|error| format!("Could not access the WebView2 controller: {error}"))?;
                    let core = core
                        .cast::<ICoreWebView2_17>()
                        .map_err(|error| format!("WebView2 runtime does not support shared video buffers: {error}"))?;
                    let buffer = environment
                        .CreateSharedBuffer(pixels.len() as u64)
                        .map_err(|error| format!("Could not allocate a shared video frame: {error}"))?;
                    let mut destination = std::ptr::null_mut();
                    buffer
                        .Buffer(&mut destination)
                        .map_err(|error| format!("Could not map a shared video frame: {error}"))?;
                    if destination.is_null() {
                        let _ = buffer.Close();
                        return Err("WebView2 returned an empty shared video buffer.".to_string());
                    }
                    std::ptr::copy_nonoverlapping(pixels.as_ptr(), destination, pixels.len());
                    let metadata = format!(
                        "{{\"type\":\"p2pcast-frame\",\"captureId\":\"{capture_id}\",\"width\":{width},\"height\":{height}}}"
                    );
                    let metadata_wide = metadata.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
                    let post_result = core.PostSharedBufferToScript(
                        &buffer,
                        COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY,
                        PCWSTR(metadata_wide.as_ptr()),
                    );
                    let _ = buffer.Close();
                    post_result.map_err(|error| format!("Could not post a shared WGC frame: {error}"))
                }
            })();
            let _ = sender.send(result);
        })
        .map_err(|error| format!("Could not enter the WebView2 thread: {error}"))?;
    receiver
        .recv_timeout(Duration::from_secs(4))
        .map_err(|_| "Timed out posting a shared frame to WebView2.".to_string())?
}

pub fn acknowledge(captures: &VideoCaptures, capture_id: &str) -> Result<(), String> {
    let captures = captures
        .captures
        .lock()
        .map_err(|_| "Video capture state is unavailable.".to_string())?;
    let capture = captures
        .get(capture_id)
        .ok_or_else(|| "Video capture was not found.".to_string())?;
    let _ = capture.acknowledge.try_send(());
    Ok(())
}

pub fn stop(captures: &VideoCaptures, capture_id: &str) -> Result<(), String> {
    let Some(mut capture) = captures
        .captures
        .lock()
        .map_err(|_| "Video capture state is unavailable.".to_string())?
        .remove(capture_id)
    else {
        return Ok(());
    };
    capture.stopped.store(true, Ordering::Release);
    let _ = capture.acknowledge.try_send(());
    let _ = capture.child.kill();
    if let Some(worker) = capture.worker.take() {
        let _ = worker.join();
    }
    let _ = capture.child.wait();
    Ok(())
}

impl Drop for VideoCaptures {
    fn drop(&mut self) {
        if let Ok(captures) = self.captures.get_mut() {
            for capture in captures.values_mut() {
                capture.stopped.store(true, Ordering::Release);
                let _ = capture.acknowledge.try_send(());
                let _ = capture.child.kill();
            }
        }
    }
}
