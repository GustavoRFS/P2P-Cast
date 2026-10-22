use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Default)]
pub struct VideoCaptures(Mutex<()>);

impl VideoCaptures {
    pub fn is_available(_app: &tauri::AppHandle) -> bool {
        false
    }

    pub fn is_active(&self) -> bool {
        false
    }
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

pub fn start(
    _app: tauri::AppHandle,
    _captures: &VideoCaptures,
    _source_id: String,
    _settings: VideoCaptureSettings,
) -> Result<VideoCaptureDescriptor, String> {
    Err("Direct Windows Graphics Capture is only available on Windows.".to_string())
}

pub fn resume(
    _app: tauri::AppHandle,
    _captures: &VideoCaptures,
    _capture_id: &str,
) -> Result<(), String> {
    Err("Direct Windows Graphics Capture is only available on Windows.".to_string())
}

pub fn acknowledge(_captures: &VideoCaptures, _capture_id: &str) -> Result<(), String> {
    Err("Direct Windows Graphics Capture is only available on Windows.".to_string())
}

pub fn stop(_captures: &VideoCaptures, _capture_id: &str) -> Result<(), String> {
    Ok(())
}

impl VideoCaptureSettings {
    pub fn new(fps: u32, cursor: String) -> Self {
        Self { fps, cursor }
    }
}

pub struct NativeVideoCapture;

impl NativeVideoCapture {
    pub fn stop(&mut self) {}
}

pub fn start_native(
    _app: &tauri::AppHandle,
    _source_id: &str,
    _settings: &VideoCaptureSettings,
    _input: p2pcast_native_broadcast::VideoInput,
    _on_error: Box<dyn Fn(String) + Send>,
) -> Result<NativeVideoCapture, String> {
    Err("Direct Windows Graphics Capture is only available on Windows.".to_string())
}
