use crate::DesktopCaptureTarget;
use std::{mem::size_of, ptr::null_mut};
use windows_sys::core::BOOL;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, RECT, TRUE},
    Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
    },
    System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
    },
};

fn process_image_path(process_id: u32) -> Option<String> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        if process.is_null() {
            return None;
        }
        let mut buffer = vec![0u16; 32768];
        let mut length = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length);
        windows_sys::Win32::Foundation::CloseHandle(process);
        if ok == 0 || length == 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buffer[..length as usize]))
    }
}

unsafe extern "system" fn collect_window(hwnd: HWND, context: LPARAM) -> BOOL {
    if IsWindowVisible(hwnd) == 0 {
        return TRUE;
    }
    let mut title = vec![0u16; 1024];
    let title_len = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32);
    if title_len <= 0 {
        return TRUE;
    }
    let title = String::from_utf16_lossy(&title[..title_len as usize])
        .trim()
        .to_string();
    if title.is_empty() {
        return TRUE;
    }
    let mut process_id = 0u32;
    GetWindowThreadProcessId(hwnd, &mut process_id);
    if process_id == 0 || process_id == std::process::id() {
        return TRUE;
    }
    let Some(image_path) = process_image_path(process_id) else {
        return TRUE;
    };
    let selector = format!(
        "window:{}#{}",
        image_path.to_lowercase(),
        title.to_lowercase()
    );
    let targets = &mut *(context as *mut Vec<DesktopCaptureTarget>);
    targets.push(DesktopCaptureTarget {
        id: format!("window:{:x}", hwnd as usize),
        selector,
        kind: "window".to_string(),
        name: title,
        process_id: Some(process_id),
        thumbnail_data_url: String::new(),
    });
    TRUE
}

unsafe extern "system" fn collect_monitor(
    monitor: HMONITOR,
    _dc: HDC,
    _rect: *mut RECT,
    context: LPARAM,
) -> BOOL {
    let mut info: MONITORINFOEXW = std::mem::zeroed();
    info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
    if GetMonitorInfoW(monitor, &mut info.monitorInfo as *mut MONITORINFO) == 0 {
        return TRUE;
    }
    let device_len = info
        .szDevice
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(info.szDevice.len());
    let device = String::from_utf16_lossy(&info.szDevice[..device_len]);
    if device.is_empty() {
        return TRUE;
    }
    let targets = &mut *(context as *mut Vec<DesktopCaptureTarget>);
    targets.push(DesktopCaptureTarget {
        id: format!("monitor:{:x}", monitor as usize),
        selector: format!("monitor:{}", device.to_lowercase()),
        kind: "monitor".to_string(),
        name: format!("Tela inteira — {device}"),
        process_id: None,
        thumbnail_data_url: String::new(),
    });
    TRUE
}

pub fn list() -> Result<Vec<DesktopCaptureTarget>, String> {
    let mut targets = Vec::new();
    unsafe {
        if EnumWindows(Some(collect_window), &mut targets as *mut _ as LPARAM) == 0 {
            return Err("Could not enumerate application windows".to_string());
        }
        if EnumDisplayMonitors(
            null_mut(),
            null_mut(),
            Some(collect_monitor),
            &mut targets as *mut _ as LPARAM,
        ) == 0
        {
            return Err("Could not enumerate displays".to_string());
        }
    }
    Ok(targets)
}

pub fn resolve(selector: &str) -> Result<Option<DesktopCaptureTarget>, String> {
    let matches = list()?
        .into_iter()
        .filter(|target| target.selector == selector)
        .collect::<Vec<_>>();
    Ok(if matches.len() == 1 {
        matches.into_iter().next()
    } else {
        None
    })
}
