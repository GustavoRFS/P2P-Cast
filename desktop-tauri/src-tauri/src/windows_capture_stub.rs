use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Default)]
pub struct VideoCaptures(Mutex<()>);

impl VideoCaptures {
    pub fn is_available(_app: &tauri::AppHandle) -> bool {
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
