use serde::Serialize;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read},
    path::PathBuf,
    process::{Child, ChildStdout, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct AudioCaptures {
    next_id: AtomicU64,
    captures: Arc<Mutex<HashMap<String, Capture>>>,
}

impl AudioCaptures {
    pub fn is_available(app: &AppHandle) -> bool {
        #[cfg(windows)]
        {
            helper_path(app).is_ok()
        }
        #[cfg(not(windows))]
        {
            let _ = app;
            false
        }
    }

    pub fn is_active(&self) -> bool {
        self.captures.lock().map_or(true, |captures| !captures.is_empty())
    }
}

struct Capture {
    child: Child,
    resumed: bool,
    pending: Vec<Vec<u8>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFormat {
    sample_rate: u32,
    channels: u8,
    format: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStarted {
    capture_id: String,
    format: AudioFormat,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioDataEvent {
    capture_id: String,
    chunk: Vec<u8>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioErrorEvent {
    capture_id: String,
    message: String,
}

fn helper_path(app: &AppHandle) -> Result<PathBuf, String> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Could not locate Tauri resources: {error}"))?
        .join("p2pcast-process-audio.exe");
    if packaged.is_file() {
        return Ok(packaged);
    }
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../desktop/resources/p2pcast-process-audio.exe");
    if development.is_file() {
        return Ok(development);
    }
    Err("The Windows isolated-audio helper is missing. Build the desktop Windows audio helper first.".to_string())
}

fn emit_audio(app: &AppHandle, capture_id: &str, chunk: Vec<u8>) {
    let _ = app.emit(
        "desktop-audio-data",
        AudioDataEvent {
            capture_id: capture_id.to_string(),
            chunk,
        },
    );
}

const SYSTEM_AUDIO_SOURCE: &str = "system";

/// Starts the audio helper for a source and checks the format it announces.
fn spawn_helper(app: &AppHandle, source_id: &str) -> Result<(Child, BufReader<ChildStdout>), String> {
    // "system" is a whole monitor: every sound on the PC except Discord (see the helper).
    let helper_argument = if source_id == SYSTEM_AUDIO_SOURCE {
        "--system".to_string()
    } else {
        let Some(raw_handle) = source_id.strip_prefix("window:") else {
            return Err("Select a running application window as the audio source.".to_string());
        };
        if raw_handle.is_empty()
            || raw_handle.len() > 32
            || !raw_handle.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("Invalid Windows application handle.".to_string());
        }
        format!("0x{raw_handle}")
    };

    let mut command = Command::new(helper_path(app)?);
    command
        .arg(helper_argument)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // The helper is a console program: started from the windowless app it would open a terminal.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start isolated application audio: {error}"))?;
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        return Err("Could not open the audio helper output.".to_string());
    };
    let mut reader = BufReader::new(stdout);
    let mut header = Vec::new();
    let header_bytes = match reader.read_until(b'\n', &mut header) {
        Ok(bytes) => bytes,
        Err(error) => {
            return Err(crate::helper_failure(
                &mut child,
                &format!("Could not read the audio helper format: {error}"),
            ));
        }
    };
    if header_bytes == 0 {
        return Err(crate::helper_failure(
            &mut child,
            "The isolated-audio helper failed before opening the audio device.",
        ));
    }
    let format: serde_json::Value = match serde_json::from_slice(&header) {
        Ok(format) => format,
        Err(error) => {
            return Err(crate::helper_failure(
                &mut child,
                &format!("Invalid audio helper format: {error}"),
            ));
        }
    };
    if format.get("sampleRate").and_then(|v| v.as_u64()) != Some(48_000)
        || format.get("channels").and_then(|v| v.as_u64()) != Some(2)
        || format.get("format").and_then(|v| v.as_str()) != Some("f32le")
    {
        return Err(crate::helper_failure(
            &mut child,
            "The audio helper returned an unsupported audio format.",
        ));
    }
    Ok((child, reader))
}

pub fn start(
    app: AppHandle,
    state: &AudioCaptures,
    source_id: String,
) -> Result<AudioStarted, String> {
    let (child, reader) = spawn_helper(&app, &source_id)?;
    let capture_id = format!(
        "tauri-audio-{}",
        state.next_id.fetch_add(1, Ordering::Relaxed) + 1
    );
    state
        .captures
        .lock()
        .map_err(|_| "Audio capture state is unavailable".to_string())?
        .insert(
            capture_id.clone(),
            Capture {
                child,
                resumed: false,
                pending: Vec::new(),
            },
        );

    let app_for_reader = app.clone();
    let state_captures = state.captures.clone();
    let reader_capture_id = capture_id.clone();
    thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = vec![0u8; 16 * 1024];
        let mut remainder = Vec::new();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    remainder.extend_from_slice(&buffer[..count]);
                    let aligned = remainder.len() - (remainder.len() % 8);
                    let chunk = remainder[..aligned].to_vec();
                    remainder.drain(..aligned);
                    if chunk.is_empty() {
                        continue;
                    }
                    let mut captures = match state_captures.lock() {
                        Ok(captures) => captures,
                        Err(_) => break,
                    };
                    if let Some(capture) = captures.get_mut(&reader_capture_id) {
                        if capture.resumed {
                            drop(captures);
                            emit_audio(&app_for_reader, &reader_capture_id, chunk);
                        } else {
                            capture.pending.push(chunk);
                        }
                    } else {
                        break;
                    }
                }
                Err(error) => {
                    let _ = app_for_reader.emit(
                        "desktop-audio-error",
                        AudioErrorEvent {
                            capture_id: reader_capture_id.clone(),
                            message: format!("Audio capture failed: {error}"),
                        },
                    );
                    return;
                }
            }
        }
        let _ = app_for_reader.emit(
            "desktop-audio-error",
            AudioErrorEvent {
                capture_id: reader_capture_id,
                message: "The selected application's audio capture ended.".to_string(),
            },
        );
    });

    Ok(AudioStarted {
        capture_id,
        format: AudioFormat {
            sample_rate: 48_000,
            channels: 2,
            format: "f32le",
        },
    })
}

pub fn resume(state: &AudioCaptures, capture_id: &str, app: &AppHandle) -> Result<(), String> {
    let pending = {
        let mut captures = state
            .captures
            .lock()
            .map_err(|_| "Audio capture state is unavailable".to_string())?;
        let capture = captures
            .get_mut(capture_id)
            .ok_or_else(|| "Audio capture was not found.".to_string())?;
        capture.resumed = true;
        std::mem::take(&mut capture.pending)
    };
    for chunk in pending {
        emit_audio(app, capture_id, chunk);
    }
    Ok(())
}

pub fn stop(state: &AudioCaptures, capture_id: &str) -> Result<(), String> {
    let Some(mut capture) = state
        .captures
        .lock()
        .map_err(|_| "Audio capture state is unavailable".to_string())?
        .remove(capture_id)
    else {
        return Ok(());
    };
    let _ = capture.child.kill();
    let _ = capture.child.wait();
    Ok(())
}

/// The audio helper feeding the native sender's Opus encoder directly.
pub struct NativeAudioCapture {
    child: Child,
    stopped: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

pub fn start_native(
    app: &AppHandle,
    source_id: &str,
    input: p2pcast_native_broadcast::AudioInput,
    on_error: Box<dyn Fn(String) + Send>,
) -> Result<NativeAudioCapture, String> {
    let (child, mut reader) = spawn_helper(app, source_id)?;
    let stopped = Arc::new(AtomicBool::new(false));
    let worker_stopped = stopped.clone();
    let worker = thread::spawn(move || {
        let mut buffer = vec![0u8; 16 * 1024];
        let mut remainder = Vec::new();
        let mut samples = Vec::new();
        let failure = loop {
            match reader.read(&mut buffer) {
                Ok(0) => break "A captura de áudio terminou.".to_string(),
                Ok(count) => {
                    remainder.extend_from_slice(&buffer[..count]);
                    // Whole stereo frames only: two little-endian f32 each.
                    let aligned = remainder.len() - remainder.len() % 8;
                    samples.clear();
                    samples.extend(
                        remainder[..aligned]
                            .chunks_exact(4)
                            .map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])),
                    );
                    remainder.drain(..aligned);
                    input.push_interleaved(&samples);
                }
                Err(error) => break format!("A captura de áudio falhou: {error}"),
            }
        };
        if !worker_stopped.load(Ordering::Acquire) {
            on_error(failure);
        }
    });
    Ok(NativeAudioCapture {
        child,
        stopped,
        worker: Some(worker),
    })
}

impl NativeAudioCapture {
    pub fn stop(&mut self) {
        self.stopped.store(true, Ordering::Release);
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for NativeAudioCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

impl Drop for AudioCaptures {
    fn drop(&mut self) {
        if let Ok(mut captures) = self.captures.lock() {
            for capture in captures.values_mut() {
                let _ = capture.child.kill();
            }
        }
    }
}
