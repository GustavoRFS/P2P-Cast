//! Silent signed self-updates through tauri-plugin-updater, from the feed in tauri.conf.json
//! (latest.json on the GitHub release, published by scripts/release.mjs). The app checks when it
//! starts, every ten minutes after that, and when the user picks "Verificar atualizações" in the
//! tray. A downloaded update installs right away with no window at all (NSIS in quiet mode, which
//! reopens the app; its window too if it was open) unless the user is broadcasting or watching a
//! live: then it waits, and the next check installs it once both have stopped. Failures show up as
//! the app's own notices, without repeating the same one over and over.

use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::{native_broadcast::NativeBroadcasts, windows_audio::AudioCaptures, windows_capture::VideoCaptures};

const STARTUP_CHECK_DELAY: Duration = Duration::from_secs(15);
const CHECK_INTERVAL: Duration = Duration::from_secs(10 * 60);
// The same failure is noticed again only after this long.
const NOTICE_REPEAT_AFTER: Duration = Duration::from_secs(60 * 60);
// A check that fails right after boot is usually the network not being up yet: only a failure in
// a row this many times is worth a notice.
const CHECK_FAILURES_BEFORE_NOTICE: u32 = 2;
// Written before a silent install while the window is open, so the restarted app opens it again.
const REOPEN_MARKER: &str = "reopen-after-update";

/// One check at a time: the periodic one and a tray click can overlap.
static CHECKING: AtomicBool = AtomicBool::new(false);
/// A live is on screen in this app (the page reports it through `set_watching`).
static WATCHING: AtomicBool = AtomicBool::new(false);
static CHECK_FAILURES: AtomicU32 = AtomicU32::new(0);
static LAST_ERROR_NOTICE: Mutex<Option<(String, Instant)>> = Mutex::new(None);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    notes: Option<String>,
}

/// A message for the toast window; the main page shows it in the user's chosen corner.
#[derive(Clone, Serialize)]
struct UpdateNotice {
    title: String,
    message: String,
}

struct ReadyUpdate {
    update: Update,
    bytes: Vec<u8>,
}

impl ReadyUpdate {
    fn info(&self) -> UpdateInfo {
        UpdateInfo {
            version: self.update.version.clone(),
            notes: self.update.body.clone(),
        }
    }
}

/// The downloaded, signature-checked installer waiting for the user to stop broadcasting/watching.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<ReadyUpdate>>);

/// The update entry of the tray menu.
pub enum TrayItem {
    Check,
    Checking,
    Downloading(String),
    Ready(String),
}

impl TrayItem {
    pub fn label(&self) -> String {
        match self {
            Self::Check => "Verificar atualizações".to_string(),
            Self::Checking => "Verificando atualizações…".to_string(),
            Self::Downloading(version) => format!("Baixando a versão {version}…"),
            Self::Ready(version) => format!("Atualizar para a {version} e reiniciar"),
        }
    }

    pub fn enabled(&self) -> bool {
        matches!(self, Self::Check | Self::Ready(_))
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Trigger {
    Background,
    Tray,
}

pub fn start(app: &AppHandle) {
    // A dev build would offer the published installer; opt in to test the flow.
    if cfg!(debug_assertions) && std::env::var_os("P2PCAST_UPDATER_DEV").is_none() {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(STARTUP_CHECK_DELAY);
        loop {
            run(&app, Trigger::Background);
            thread::sleep(CHECK_INTERVAL);
        }
    });
}

/// The tray entry: installs an update that is already waiting, otherwise checks for one.
pub fn tray_clicked(app: &AppHandle) {
    let app = app.clone();
    // Off the main thread: checking and downloading block, and the tray must stay responsive.
    thread::spawn(move || {
        if pending_info(&app).is_some() {
            if let Err(error) = install(&app) {
                log::error!("{error}");
                notify(&app, "Não deu para atualizar", &install_failure_message(&app));
            }
        } else {
            run(&app, Trigger::Tray);
        }
    });
}

/// Broadcasting or watching: the moments an update must not interrupt.
fn busy(app: &AppHandle) -> bool {
    broadcasting(app) || WATCHING.load(Ordering::SeqCst)
}

fn run(app: &AppHandle, trigger: Trigger) {
    if CHECKING.swap(true, Ordering::SeqCst) {
        return;
    }
    let tray = trigger == Trigger::Tray;
    // An update that waited for the user to stop goes in as soon as they have.
    if let Some(info) = pending_info(app) {
        CHECKING.store(false, Ordering::SeqCst);
        if !busy(app) {
            log::info!("installing the waiting update {}", info.version);
            if let Err(error) = install(app) {
                log::error!("{error}");
                notify_error(app, "Não deu para atualizar", &install_failure_message(app));
            }
        }
        return;
    }
    if tray {
        set_tray(app, TrayItem::Checking);
    }
    let found = tauri::async_runtime::block_on(find(app));
    let result = match found {
        Ok(Some(update)) => {
            CHECK_FAILURES.store(0, Ordering::SeqCst);
            log::info!("update {} found, downloading", update.version);
            set_tray(app, TrayItem::Downloading(update.version.clone()));
            tauri::async_runtime::block_on(download(app, update)).map(Some)
        }
        Ok(None) => {
            CHECK_FAILURES.store(0, Ordering::SeqCst);
            Ok(None)
        }
        Err(error) => {
            let failures = CHECK_FAILURES.fetch_add(1, Ordering::SeqCst) + 1;
            Err((error, failures))
        }
    };
    CHECKING.store(false, Ordering::SeqCst);

    match result {
        Ok(Some(info)) => {
            if busy(app) {
                // Installs at the next check after the live (broadcast or watched) is over.
                log::info!("update {} waits for the live to end", info.version);
                announce(app, &info);
                if tray {
                    notify(
                        app,
                        &format!("Versão {} baixada", info.version),
                        "Ela entra sozinha quando você parar de transmitir e de assistir.",
                    );
                }
            } else if let Err(error) = install(app) {
                log::error!("{error}");
                announce(app, &info);
                notify_error(app, "Não deu para atualizar", &install_failure_message(app));
            }
        }
        Ok(None) => {
            set_tray(app, TrayItem::Check);
            if tray {
                let current = app.package_info().version.to_string();
                notify(app, "Nenhuma atualização", &format!("Você já está na versão {current}."));
            }
        }
        Err((error, failures)) => {
            log::error!("{error}");
            set_tray(app, TrayItem::Check);
            if tray {
                notify(app, "Não deu para verificar", "Confira a conexão e tente de novo.");
            } else if error.starts_with("Could not download") {
                notify_error(app, "Não deu para atualizar", "O download da atualização falhou. O app tenta de novo daqui a pouco.");
            } else if failures >= CHECK_FAILURES_BEFORE_NOTICE {
                notify_error(app, "Não deu para procurar atualizações", "Confira a conexão. O app tenta de novo a cada 10 minutos.");
            }
        }
    }
}

fn install_failure_message(app: &AppHandle) -> String {
    if broadcasting(app) {
        "Ela entra sozinha quando a transmissão terminar.".to_string()
    } else {
        "O app tenta de novo daqui a pouco, ou pelo tray.".to_string()
    }
}

async fn find(app: &AppHandle) -> Result<Option<Update>, String> {
    app.updater()
        .map_err(|error| format!("The updater is unavailable: {error}"))?
        .check()
        .await
        .map_err(|error| format!("Could not check for updates: {error}"))
}

async fn download(app: &AppHandle, update: Update) -> Result<UpdateInfo, (String, u32)> {
    let pending = app.state::<PendingUpdate>();
    if let Some(ready) = pending.0.lock().ok().as_deref().and_then(Option::as_ref) {
        if ready.update.version == update.version {
            return Ok(ready.info());
        }
    }
    // download() checks the signature against the public key in tauri.conf.json.
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|error| (format!("Could not download the update: {error}"), 1))?;
    let ready = ReadyUpdate { update, bytes };
    let info = ready.info();
    *pending
        .0
        .lock()
        .map_err(|_| ("Could not download the update: state is unavailable".to_string(), 1))? = Some(ready);
    Ok(info)
}

fn announce(app: &AppHandle, info: &UpdateInfo) {
    let _ = app.emit_to("main", "update-ready", info);
    set_tray(app, TrayItem::Ready(info.version.clone()));
}

fn notify(app: &AppHandle, title: &str, message: &str) {
    let notice = UpdateNotice {
        title: title.to_string(),
        message: message.to_string(),
    };
    let _ = app.emit_to("main", "update-notice", notice);
}

/// A failure nobody asked about: noticed once, then again only after a while.
fn notify_error(app: &AppHandle, title: &str, message: &str) {
    let key = format!("{title}|{message}");
    if let Ok(mut last) = LAST_ERROR_NOTICE.lock() {
        if last.as_ref().is_some_and(|(previous, at)| *previous == key && at.elapsed() < NOTICE_REPEAT_AFTER) {
            return;
        }
        *last = Some((key, Instant::now()));
    }
    notify(app, title, message);
}

fn set_tray(app: &AppHandle, item: TrayItem) {
    if let Err(error) = crate::refresh_tray_menu(app, &item) {
        log::warn!("Could not update the tray menu: {error}");
    }
}

fn pending_info(app: &AppHandle) -> Option<UpdateInfo> {
    app.state::<PendingUpdate>()
        .0
        .lock()
        .ok()
        .and_then(|slot| slot.as_ref().map(ReadyUpdate::info))
}

fn main_window_visible(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

fn broadcasting(app: &AppHandle) -> bool {
    app.state::<VideoCaptures>().is_active()
        || app.state::<AudioCaptures>().is_active()
        || app.state::<NativeBroadcasts>().is_active()
}

fn reopen_marker(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join(REOPEN_MARKER))
}

/// At startup: an app restarted by a silent update while its window was open opens it again.
pub fn reopen_window_after_update(app: &AppHandle) -> bool {
    let Some(marker) = reopen_marker(app) else { return false };
    if fs::remove_file(&marker).is_ok() {
        log::info!("reopening the window after an update");
        return true;
    }
    false
}

/// Runs the downloaded installer. On Windows this ends the process (the installer reopens it).
pub fn install(app: &AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) {
        // Installing would swap the dev build for the release one.
        return Err("A development build does not install updates".to_string());
    }
    if broadcasting(app) {
        return Err("Stop the broadcast before updating".to_string());
    }
    let pending = app.state::<PendingUpdate>();
    let slot = pending
        .0
        .lock()
        .map_err(|_| "Update state is unavailable".to_string())?;
    let ready = slot.as_ref().ok_or("No update has been downloaded")?;
    if main_window_visible(app) {
        if let Some(marker) = reopen_marker(app) {
            let _ = marker.parent().map(fs::create_dir_all);
            let _ = fs::write(&marker, b"");
        }
    }
    log::info!("installing update {} silently", ready.update.version);
    log::logger().flush();
    let result = ready.update.install(&ready.bytes);
    if let Err(error) = result {
        if let Some(marker) = reopen_marker(app) {
            let _ = fs::remove_file(marker);
        }
        return Err(format!("Could not install the update: {error}"));
    }
    drop(slot);
    // macOS and Linux replace the app in place and need the restart themselves.
    app.restart()
}

#[tauri::command]
pub fn get_ready_update(pending: State<'_, PendingUpdate>) -> Option<UpdateInfo> {
    pending
        .0
        .lock()
        .ok()
        .and_then(|slot| slot.as_ref().map(ReadyUpdate::info))
}

#[tauri::command]
pub fn install_ready_update(app: AppHandle) -> Result<(), String> {
    install(&app)
}

/// The page has a live on screen (or no longer does): an update waits while it does.
#[tauri::command]
pub fn set_watching(watching: bool) {
    WATCHING.store(watching, Ordering::SeqCst);
}
