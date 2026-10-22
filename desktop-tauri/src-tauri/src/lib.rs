use std::{
    fs,
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;
use url::Url;

mod app_log;
mod native_broadcast;
mod updates;
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
    /// Direct captures can be encoded and sent by the app itself (native-broadcast) instead of
    /// the webview.
    native_broadcast_available: bool,
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
        native_broadcast_available: windows_capture::VideoCaptures::is_available(app),
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
    let port = start_login_listener(app.clone())?;
    let mut url = Url::parse(&format!("{}/auth/discord", config.backend_url))
        .map_err(|error| format!("Could not build Discord login URL: {error}"))?;
    // Backends that do not know `port` ignore it and fall back to the p2pcast-tauri:// link.
    url.query_pairs_mut()
        .append_pair("code_challenge", &code_challenge)
        .append_pair("host", "tauri")
        .append_pair("port", &port.to_string());
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|error| format!("Could not open Discord login: {error}"))
}

const LOGIN_LISTENER_TIMEOUT: Duration = Duration::from_secs(5 * 60);

const LOGIN_DONE_PAGE: &str = "<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\"><title>Login concluído</title>\
<body style=\"font:16px system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem;background:#07111f;color:#edf5ff\">\
<h1>Login concluído</h1><p>Pode fechar esta aba e voltar ao P2P-Cast.</p></body></html>";

/// One-shot loopback listener for the Discord OAuth code (RFC 8252, section 7.3). The backend sends
/// the browser to http://127.0.0.1:<port>/auth/callback?code=…, a plain HTTP navigation, so the login
/// no longer depends on the browser agreeing to launch p2pcast-tauri://. The code alone is useless:
/// exchanging it needs the PKCE verifier only this app holds.
fn start_login_listener(app: AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("Could not open the login listener: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Could not read the login listener port: {error}"))?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Could not configure the login listener: {error}"))?;

    thread::spawn(move || {
        let deadline = Instant::now() + LOGIN_LISTENER_TIMEOUT;
        while Instant::now() < deadline {
            match listener.accept() {
                Ok((stream, _)) => {
                    if let Some(code) = answer_login_request(stream) {
                        let _ = app.emit("desktop-auth-code", code);
                        show_main_window(&app);
                        return;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(150));
                }
                Err(_) => return,
            }
        }
    });
    Ok(port)
}

/// Answers one browser request and returns the code when it is the OAuth callback.
fn answer_login_request(mut stream: TcpStream) -> Option<String> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut request_line = String::new();
    BufReader::new(&stream).read_line(&mut request_line).ok()?;

    // "GET /auth/callback?code=… HTTP/1.1". Codes have the verifier's 43-char base64url shape.
    let code = request_line
        .split_whitespace()
        .nth(1)
        .and_then(|target| target.strip_prefix("/auth/callback?"))
        .and_then(|query| query.split('&').find_map(|pair| pair.strip_prefix("code=")))
        .filter(|code| valid_verifier(code))
        .map(str::to_string);

    let (status, body) = if code.is_some() { ("200 OK", LOGIN_DONE_PAGE) } else { ("404 Not Found", "") };
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len(),
    );
    let _ = stream.flush();
    code
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

const TOAST_WINDOW: &str = "toast";
const TOAST_WIDTH: f64 = 380.0;
// One card of the stack and the space around it, as the toast page lays them out (h-[84px],
// gap-2, p-2): the window is exactly as tall as the cards it shows, so it never covers more of the
// screen (or a game) than they do.
const TOAST_CARD_HEIGHT: f64 = 84.0;
const TOAST_GAP: f64 = 8.0;
const TOAST_PADDING: f64 = 8.0;
const MAX_TOASTS: u32 = 4;
const TOAST_MARGIN: f64 = 16.0;
// How many cards the toast page shows; 0 while the window is hidden.
static TOAST_STACK: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
const TOAST_CORNERS: [&str; 4] = ["top-right", "bottom-right", "top-left", "bottom-left"];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveToast {
    id: u64,
    user_id: String,
    username: String,
    avatar: Option<String>,
    peer_id: String,
    corner: String,
    /// The "Prever notificação" button: same card, but a click only dismisses it.
    #[serde(default)]
    preview: bool,
    /// An app message (updates) instead of a live: `username` is its title, the card shows the app
    /// icon, and a click only dismisses it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

/// The latest toast, kept until the toast page takes it or the toast hides: the first one can
/// arrive before that page has started listening.
#[derive(Default)]
struct PendingLiveToast(Mutex<Option<LiveToast>>);

fn valid_peer_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

/// Steam-style notification window: borderless, transparent, always on top and never focusable,
/// so it shows over a game without taking the focus. It is created hidden at startup so its page is
/// already loaded when the first live starts.
fn ensure_toast_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(TOAST_WINDOW) {
        return Ok(window);
    }
    // The app's own page (dev server or bundled assets), which renders only the toast for this
    // query. The main window's URL is still about:blank while setup runs, so it cannot be the base.
    let mut builder = WebviewWindowBuilder::new(app, TOAST_WINDOW, WebviewUrl::App("?window=toast".into()));
    // WebView2 refuses a second webview in the same data folder whose browser arguments differ from
    // the first one's, so the toast copies whatever the main window is configured with.
    if let Some(arguments) = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .and_then(|window| window.additional_browser_args.clone())
    {
        builder = builder.additional_browser_args(&arguments);
    }
    let window = builder
        .title("P2P-Cast")
        .inner_size(TOAST_WIDTH, TOAST_PADDING * 2.0 + TOAST_CARD_HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|error| format!("Could not create the notification window: {error}"))?;
    #[cfg(windows)]
    set_toast_styles(&window)?;
    Ok(window)
}

/// Makes the toast a frameless popup tool window that never activates. Tiling window managers
/// decide from the style a window has when it appears: komorebi tiles anything with WS_CAPTION and
/// WS_EX_WINDOWEDGE, which tao keeps on undecorated windows, and the WS_EX_LAYERED that would make
/// it skip the toast only shows up later, with the transparency. So the frame styles go before the
/// toast is ever shown, and every show re-checks them.
#[cfg(windows)]
fn set_toast_styles(window: &WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, GWL_STYLE, SWP_FRAMECHANGED,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_CLIPCHILDREN, WS_CLIPSIBLINGS,
        WS_EX_APPWINDOW, WS_EX_CLIENTEDGE, WS_EX_DLGMODALFRAME, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        WS_EX_WINDOWEDGE, WS_POPUP, WS_VISIBLE,
    };

    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as _;
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        let wanted_style = WS_POPUP | (style & (WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN));
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let frame = WS_EX_APPWINDOW | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_DLGMODALFRAME;
        let wanted_ex_style = (ex_style | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) & !frame;
        if wanted_style == style && wanted_ex_style == ex_style {
            return Ok(());
        }
        SetWindowLongPtrW(hwnd, GWL_STYLE, wanted_style as i32 as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, wanted_ex_style as i32 as isize);
        let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED;
        SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, 0, 0, flags);
    }
    Ok(())
}

/// The toast's physical rect (x, y, width, height) in a corner of the primary monitor's work area,
/// clear of the taskbar.
/// Where a stack of `count` cards goes: against the corner, growing away from it.
fn toast_rect(window: &WebviewWindow, corner: &str, count: u32) -> Result<(i32, i32, i32, i32), String> {
    let monitor = match window.primary_monitor().map_err(|error| error.to_string())? {
        Some(monitor) => monitor,
        None => window
            .current_monitor()
            .map_err(|error| error.to_string())?
            .ok_or("No monitor to show the notification on")?,
    };
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let width = (TOAST_WIDTH * scale).round() as i32;
    let cards = count.clamp(1, MAX_TOASTS) as f64;
    let logical_height = TOAST_PADDING * 2.0 + cards * TOAST_CARD_HEIGHT + (cards - 1.0) * TOAST_GAP;
    let height = (logical_height * scale).round() as i32;
    let margin = (TOAST_MARGIN * scale).round() as i32;
    let x = if corner.ends_with("left") {
        area.position.x + margin
    } else {
        area.position.x + area.size.width as i32 - width - margin
    };
    let y = if corner.starts_with("top") {
        area.position.y + margin
    } else {
        area.position.y + area.size.height as i32 - height - margin
    };
    Ok((x, y, width, height))
}

/// Shows the toast without activating it. tao's show() uses SW_SHOW (which takes the focus) and
/// rewrites the styles, so on Windows this goes straight to Win32: a topmost popup tool window, out
/// of the taskbar and Alt+Tab and ignored by tiling window managers such as komorebi.
#[cfg(windows)]
fn show_toast_window(window: &WebviewWindow, (x, y, width, height): (i32, i32, i32, i32)) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_SHOWWINDOW,
    };

    set_toast_styles(window)?;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as _;
    let shown = unsafe { SetWindowPos(hwnd, HWND_TOPMOST, x, y, width, height, SWP_NOACTIVATE | SWP_SHOWWINDOW) };
    if shown == 0 {
        return Err("Could not show the notification".to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
fn show_toast_window(window: &WebviewWindow, (x, y, width, height): (i32, i32, i32, i32)) -> Result<(), String> {
    window
        .set_size(tauri::PhysicalSize::new(width as u32, height as u32))
        .and_then(|_| window.set_position(tauri::PhysicalPosition::new(x, y)))
        .and_then(|_| window.show())
        .map_err(|error| format!("Could not show the notification: {error}"))
}

/// Hidden the same way it is shown, so tao never re-applies its own styles to the toast.
fn hide_toast_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(TOAST_WINDOW) else {
        return;
    };
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                ShowWindow(hwnd.0 as _, SW_HIDE);
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = window.hide();
    }
}

#[tauri::command]
fn show_live_toast(
    app: AppHandle,
    pending: State<'_, PendingLiveToast>,
    toast: LiveToast,
) -> Result<(), String> {
    let valid_avatar = toast
        .avatar
        .as_deref()
        .map_or(true, |avatar| avatar.starts_with("https://") && avatar.len() <= 512);
    if !TOAST_CORNERS.contains(&toast.corner.as_str())
        || !valid_peer_id(&toast.peer_id)
        || toast.username.trim().is_empty()
        || toast.username.len() > 100
        || !valid_avatar
        || toast.message.as_ref().is_some_and(|message| message.len() > 200)
    {
        return Err("Invalid live notification".to_string());
    }
    let window = ensure_toast_window(&app)?;
    *pending
        .0
        .lock()
        .map_err(|_| "Notification state is unavailable".to_string())? = Some(toast.clone());
    app.emit_to(TOAST_WINDOW, "live-toast", &toast)
        .map_err(|error| format!("Could not send the notification: {error}"))?;
    // The page sizes the window for its stack (layout_live_toasts); the first card shows it now.
    // Shown without activation, so the game keeps the keyboard and mouse.
    if TOAST_STACK.load(std::sync::atomic::Ordering::Acquire) == 0 {
        show_toast_window(&window, toast_rect(&window, &toast.corner, 1)?)?;
    }
    Ok(())
}

/// The toast page's stack changed: fit the window to its cards, or hide it when there are none.
#[tauri::command]
fn layout_live_toasts(
    app: AppHandle,
    pending: State<'_, PendingLiveToast>,
    count: u32,
    corner: String,
) -> Result<(), String> {
    if count == 0 {
        if let Ok(mut slot) = pending.0.lock() {
            *slot = None;
        }
        TOAST_STACK.store(0, std::sync::atomic::Ordering::Release);
        hide_toast_window(&app);
        return Ok(());
    }
    if count > MAX_TOASTS || !TOAST_CORNERS.contains(&corner.as_str()) {
        return Err("Invalid notification layout".to_string());
    }
    let window = ensure_toast_window(&app)?;
    let rect = toast_rect(&window, &corner, count)?;
    TOAST_STACK.store(count, std::sync::atomic::Ordering::Release);
    show_toast_window(&window, rect)
}

#[tauri::command]
fn take_pending_live_toast(pending: State<'_, PendingLiveToast>) -> Option<LiveToast> {
    pending.0.lock().ok().and_then(|mut slot| slot.take())
}

#[tauri::command]
fn hide_live_toast(app: AppHandle, pending: State<'_, PendingLiveToast>) {
    if let Ok(mut slot) = pending.0.lock() {
        *slot = None;
    }
    TOAST_STACK.store(0, std::sync::atomic::Ordering::Release);
    hide_toast_window(&app);
}

/// A click on the toast: bring the app up and open that live.
#[tauri::command]
fn open_live_from_toast(app: AppHandle, peer_id: String) -> Result<(), String> {
    if !valid_peer_id(&peer_id) {
        return Err("Invalid live".to_string());
    }
    TOAST_STACK.store(0, std::sync::atomic::Ordering::Release);
    hide_toast_window(&app);
    show_main_window(&app);
    app.emit_to("main", "open-live", peer_id)
        .map_err(|error| format!("Could not open the live: {error}"))
}

/// The tray menu; its update entry follows the updater ("Verificar atualizações", then progress,
/// then "Atualizar para a X" when an update has to wait).
fn tray_menu(app: &AppHandle, update: &updates::TrayItem) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(app, "show", "Mostrar P2P-Cast", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "update", update.label(), update.enabled(), None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?)?;
    Ok(menu)
}

pub(crate) fn refresh_tray_menu(app: &AppHandle, update: &updates::TrayItem) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(tray_menu(app, update)?))?;
    }
    Ok(())
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("P2P-Cast")
        .menu(&tray_menu(app, &updates::TrayItem::Check)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "update" => updates::tray_clicked(app),
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(windows_audio::AudioCaptures::default())
        .manage(windows_capture::VideoCaptures::default())
        .manage(native_broadcast::NativeBroadcasts::default())
        .manage(PendingLiveToast::default())
        .manage(updates::PendingUpdate::default())
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
            native_broadcast::start_native_broadcast,
            native_broadcast::stop_native_broadcast,
            native_broadcast::switch_native_capture,
            native_broadcast::send_native_chat,
            native_broadcast::set_native_audio_muted,
            get_saved_session,
            save_session,
            clear_session,
            get_login_verifier,
            cleanup_login_verifier,
            save_login_verifier,
            clear_login_verifier,
            open_discord_login,
            copy_share_link,
            show_live_toast,
            take_pending_live_toast,
            hide_live_toast,
            layout_live_toasts,
            open_live_from_toast,
            updates::get_ready_update,
            updates::install_ready_update,
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
            app_log::init(app.handle());
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            app.deep_link().register_all()?;
            build_tray(app.handle())?;
            if let Err(error) = ensure_toast_window(app.handle()) {
                eprintln!("{error}");
            }
            updates::start(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running P2P-Cast Tauri");
}
