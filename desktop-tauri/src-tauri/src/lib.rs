use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;
use url::Url;

mod windows_audio;
#[cfg(windows)]
mod windows_capture;
#[cfg(not(windows))]
#[path = "windows_capture_stub.rs"]
mod windows_capture;
#[cfg(windows)]
mod windows_targets;

const KEYRING_SERVICE: &str = "com.p2pcast.desktop.tauri";
const SESSION_KEY: &str = "discord-session";
const LOGIN_VERIFIER_KEY: &str = "discord-login-verifier";
const LOGIN_VERIFIER_TTL_MS: u64 = 10 * 60 * 1000;

fn environment_value(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct UserConfig {
    backend_url: Option<String>,
    web_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopConfig {
    backend_url: String,
    web_url: String,
    isolated_audio_available: bool,
    direct_video_capture_available: bool,
    capture_picker: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCaptureTarget {
    id: String,
    selector: String,
    kind: String,
    name: String,
    process_id: Option<u32>,
    thumbnail_data_url: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountProfile {
    id: String,
    username: String,
    avatar: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountSession {
    token: String,
    user: AccountProfile,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginVerifier {
    verifier: String,
    saved_at: u64,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = environment_value("P2PCAST_CONFIG_PATH") {
        return Ok(PathBuf::from(path));
    }
    #[cfg(debug_assertions)]
    {
        let development_config = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../config.json");
        if development_config.exists() {
            return Ok(development_config);
        }
    }
    app.path()
        .app_config_dir()
        .map(|path| path.join("config.json"))
        .map_err(|error| format!("Could not resolve app config directory: {error}"))
}

fn read_user_config(app: &AppHandle) -> Result<UserConfig, String> {
    let path = config_path(app)?;
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|error| format!("Could not parse desktop config.json: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            serde_json::from_str(include_str!("../../config.example.json")).map_err(|parse_error| {
                format!("Could not parse bundled example config: {parse_error}")
            })
        }
        Err(error) => Err(format!("Could not read desktop config.json: {error}")),
    }
}

fn normalized_origin(raw: &str, name: &str) -> Result<String, String> {
    let parsed = Url::parse(raw).map_err(|error| format!("{name} is not a valid URL: {error}"))?;
    let host = parsed.host_str().unwrap_or_default();
    let local_http = parsed.scheme() == "http" && matches!(host, "localhost" | "127.0.0.1" | "::1");
    if parsed.scheme() != "https" && !local_http {
        return Err(format!("{name} must use HTTPS outside localhost"));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(format!("{name} must not contain a username or password"));
    }
    Ok(parsed.origin().ascii_serialization())
}

/// Kills a helper process and folds whatever it wrote to stderr into the message, so the UI can
/// show the real reason instead of a generic failure.
pub(crate) fn helper_failure(child: &mut std::process::Child, message: &str) -> String {
    use std::io::Read;

    let _ = child.kill();
    let mut detail = String::new();
    if let Some(mut stderr) = child.stderr.take() {
        let _ = stderr.read_to_string(&mut detail);
    }
    let detail = detail.trim();
    if detail.is_empty() {
        message.to_string()
    } else {
        format!("{message} ({detail})")
    }
}

fn get_desktop_config(app: &AppHandle) -> Result<DesktopConfig, String> {
    let file = read_user_config(app)?;
    let backend_raw = environment_value("P2PCAST_BACKEND_URL")
        .or(file.backend_url)
        .unwrap_or_else(|| "http://localhost:3001".to_string());
    let web_raw = environment_value("P2PCAST_WEB_URL")
        .or(file.web_url)
        .unwrap_or_else(|| "https://live.ligmacharl.es".to_string());

    Ok(DesktopConfig {
        backend_url: normalized_origin(&backend_raw, "backendUrl")?,
        web_url: normalized_origin(&web_raw, "webUrl")?,
        isolated_audio_available: windows_audio::AudioCaptures::is_available(app),
        direct_video_capture_available: windows_capture::VideoCaptures::is_available(app),
        capture_picker: "system-window",
    })
}

#[tauri::command]
fn desktop_config(app: AppHandle) -> Result<DesktopConfig, String> {
    get_desktop_config(&app)
}

#[tauri::command]
fn list_capture_targets() -> Result<Vec<DesktopCaptureTarget>, String> {
    #[cfg(windows)]
    {
        windows_targets::list()
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

#[tauri::command]
fn resolve_capture_target(selector: String) -> Result<Option<DesktopCaptureTarget>, String> {
    if selector.is_empty() || selector.len() > 2048 {
        return Err("Invalid capture target selector".to_string());
    }
    #[cfg(windows)]
    {
        windows_targets::resolve(&selector)
    }
    #[cfg(not(windows))]
    {
        let _ = selector;
        Ok(None)
    }
}

#[tauri::command]
fn start_application_audio(
    app: AppHandle,
    captures: tauri::State<'_, windows_audio::AudioCaptures>,
    source_id: String,
) -> Result<windows_audio::AudioStarted, String> {
    windows_audio::start(app, &captures, source_id)
}

#[tauri::command]
fn resume_application_audio(
    app: AppHandle,
    captures: tauri::State<'_, windows_audio::AudioCaptures>,
    capture_id: String,
) -> Result<(), String> {
    windows_audio::resume(&captures, &capture_id, &app)
}

#[tauri::command]
fn stop_application_audio(
    captures: tauri::State<'_, windows_audio::AudioCaptures>,
    capture_id: String,
) -> Result<(), String> {
    windows_audio::stop(&captures, &capture_id)
}

#[tauri::command]
fn start_direct_video_capture(
    app: AppHandle,
    captures: tauri::State<'_, windows_capture::VideoCaptures>,
    source_id: String,
    settings: windows_capture::VideoCaptureSettings,
) -> Result<windows_capture::VideoCaptureDescriptor, String> {
    windows_capture::start(app, &captures, source_id, settings)
}

#[tauri::command]
fn resume_direct_video_capture(
    app: AppHandle,
    captures: tauri::State<'_, windows_capture::VideoCaptures>,
    capture_id: String,
) -> Result<(), String> {
    windows_capture::resume(app, &captures, &capture_id)
}

#[tauri::command]
fn acknowledge_direct_video_frame(
    captures: tauri::State<'_, windows_capture::VideoCaptures>,
    capture_id: String,
) -> Result<(), String> {
    windows_capture::acknowledge(&captures, &capture_id)
}

#[tauri::command]
fn stop_direct_video_capture(
    captures: tauri::State<'_, windows_capture::VideoCaptures>,
    capture_id: String,
) -> Result<(), String> {
    windows_capture::stop(&captures, &capture_id)
}

fn valid_secret(value: &str) -> bool {
    !value.is_empty() && value.len() <= 8192
}

fn credential_entry(name: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, name)
        .map_err(|error| format!("Could not access the OS credential store: {error}"))
}

fn read_credential(name: &str) -> Result<Option<String>, String> {
    let entry = credential_entry(name)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read the OS credential store: {error}")),
    }
}

fn delete_credential(name: &str) -> Result<(), String> {
    let entry = credential_entry(name)?;
    match entry.get_password() {
        Ok(_) => entry
            .delete_credential()
            .map_err(|error| format!("Could not clear the OS credential store: {error}")),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not access the OS credential store: {error}")),
    }
}

#[tauri::command]
fn get_saved_session() -> Result<Option<AccountSession>, String> {
    let Some(value) = read_credential(SESSION_KEY)? else {
        return Ok(None);
    };
    let session: AccountSession = serde_json::from_str(&value)
        .map_err(|error| format!("The saved Discord session is invalid: {error}"))?;
    if !valid_secret(&session.token)
        || session.user.id.is_empty()
        || session.user.id.len() > 128
        || session.user.username.is_empty()
        || session.user.username.len() > 128
    {
        return Ok(None);
    }
    Ok(Some(session))
}

#[tauri::command]
fn save_session(session: AccountSession) -> Result<(), String> {
    if !valid_secret(&session.token)
        || session.user.id.is_empty()
        || session.user.id.len() > 128
        || session.user.username.is_empty()
        || session.user.username.len() > 128
        || session
            .user
            .avatar
            .as_ref()
            .is_some_and(|avatar| avatar.len() > 512)
    {
        return Err("Invalid account session".to_string());
    }
    let serialized = serde_json::to_string(&session)
        .map_err(|error| format!("Could not serialize Discord session: {error}"))?;
    credential_entry(SESSION_KEY)?
        .set_password(&serialized)
        .map_err(|error| {
            format!("Could not save Discord session in the OS credential store: {error}")
        })
}

#[tauri::command]
fn clear_session() -> Result<(), String> {
    delete_credential(SESSION_KEY)
}

fn valid_verifier(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn now_ms() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| format!("System clock is before Unix epoch: {error}"))
}

#[tauri::command]
fn get_login_verifier() -> Result<Option<String>, String> {
    let Some(value) = read_credential(LOGIN_VERIFIER_KEY)? else {
        return Ok(None);
    };
    let stored: LoginVerifier = match serde_json::from_str(&value) {
        Ok(stored) => stored,
        Err(_) => {
            delete_credential(LOGIN_VERIFIER_KEY)?;
            return Ok(None);
        }
    };
    let current = now_ms()?;
    if !valid_verifier(&stored.verifier)
        || stored.saved_at > current
        || current - stored.saved_at >= LOGIN_VERIFIER_TTL_MS
    {
        delete_credential(LOGIN_VERIFIER_KEY)?;
        return Ok(None);
    }
    Ok(Some(stored.verifier))
}

#[tauri::command]
fn cleanup_login_verifier() -> Result<(), String> {
    let _ = get_login_verifier()?;
    Ok(())
}

#[tauri::command]
fn save_login_verifier(verifier: String) -> Result<(), String> {
    if !valid_verifier(&verifier) {
        return Err("Invalid login verifier".to_string());
    }
    let stored = LoginVerifier {
        verifier,
        saved_at: now_ms()?,
    };
    let serialized = serde_json::to_string(&stored)
        .map_err(|error| format!("Could not serialize Discord login verifier: {error}"))?;
    credential_entry(LOGIN_VERIFIER_KEY)?
        .set_password(&serialized)
        .map_err(|error| {
            format!("Could not save Discord login verifier in the OS credential store: {error}")
        })
}

#[tauri::command]
fn clear_login_verifier() -> Result<(), String> {
    delete_credential(LOGIN_VERIFIER_KEY)
}

#[tauri::command]
async fn open_discord_login(app: AppHandle, code_challenge: String) -> Result<(), String> {
    if !valid_verifier(&code_challenge) {
        return Err("Invalid login challenge".to_string());
    }
    let config = get_desktop_config(&app)?;
    let mut url = Url::parse(&format!("{}/auth/discord", config.backend_url))
        .map_err(|error| format!("Could not build Discord login URL: {error}"))?;
    url.query_pairs_mut()
        .append_pair("code_challenge", &code_challenge)
        .append_pair("host", "tauri");
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|error| format!("Could not open Discord login: {error}"))
}

/// Puts the freshly started broadcast link on the clipboard. This runs in Rust because the webview
/// cannot write to the clipboard when the live starts from a global shortcut: the document is not
/// focused, and Chromium rejects the write.
#[tauri::command]
fn copy_share_link(app: AppHandle, link: String) -> Result<(), String> {
    if link.len() > 2048 {
        return Err("The broadcast link is too long to copy.".to_string());
    }
    let parsed = Url::parse(&link).map_err(|error| format!("Invalid broadcast link: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only http(s) broadcast links can be copied.".to_string());
    }
    app.clipboard()
        .write_text(link)
        .map_err(|error| format!("Could not copy the broadcast link: {error}"))
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Mostrar P2P-Cast", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("P2P-Cast")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }
    tray.build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(windows_audio::AudioCaptures::default())
        .manage(windows_capture::VideoCaptures::default())
        .invoke_handler(tauri::generate_handler![
            desktop_config,
            list_capture_targets,
            resolve_capture_target,
            start_application_audio,
            resume_application_audio,
            stop_application_audio,
            start_direct_video_capture,
            resume_direct_video_capture,
            acknowledge_direct_video_frame,
            stop_direct_video_capture,
            get_saved_session,
            save_session,
            clear_session,
            get_login_verifier,
            cleanup_login_verifier,
            save_login_verifier,
            clear_login_verifier,
            open_discord_login,
            copy_share_link,
        ])
        .on_window_event(|window, event| {
            // Closing the window would end the process and unregister the shortcuts; keep the app
            // in the tray instead, and quit only from the tray menu.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            app.deep_link().register_all()?;
            build_tray(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running P2P-Cast Tauri");
}
