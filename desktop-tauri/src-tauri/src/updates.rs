//! Signed self-updates through tauri-plugin-updater, from the feed in tauri.conf.json (latest.json
//! on the GitHub release, published by scripts/release.mjs). There are two moments only: once when
//! the app starts, and when the user picks "Verificar atualizações" in the tray. Nothing is ever
//! installed during a broadcast; an update that has to wait shows up in the app and in the tray.
//! On Windows the NSIS installer runs passive and reopens the app when it is done.

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::{native_broadcast::NativeBroadcasts, windows_audio::AudioCaptures, windows_capture::VideoCaptures};

const STARTUP_CHECK_DELAY: Duration = Duration::from_secs(15);

/// One check at a time: the startup one and a tray click can overlap.
static CHECKING: AtomicBool = AtomicBool::new(false);

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

/// The downloaded, signature-checked installer waiting for a moment without a broadcast.
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
    Startup,
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
        run(&app, Trigger::Startup);
    });
}

/// The tray entry: installs an update that is already waiting, otherwise checks for one.
pub fn tray_clicked(app: &AppHandle) {
    let app = app.clone();
    // Off the main thread: checking and downloading block, and the tray must stay responsive.
    thread::spawn(move || {
        if pending_info(&app).is_some() {
            install_or_explain(&app);
        } else {
            run(&app, Trigger::Tray);
        }
    });
}

fn run(app: &AppHandle, trigger: Trigger) {
    if CHECKING.swap(true, Ordering::SeqCst) {
        return;
    }
    let tray = trigger == Trigger::Tray;
    set_tray(app, TrayItem::Checking);
    let found = tauri::async_runtime::block_on(find(app));
    let result = match found {
        Ok(Some(update)) => {
            set_tray(app, TrayItem::Downloading(update.version.clone()));
            if tray {
                let message = if broadcasting(app) {
                    "Baixando agora."
                } else {
                    "Baixando agora. O app reinicia sozinho quando terminar."
                };
                notify(app, &format!("Versão {} encontrada", update.version), message);
            }
            tauri::async_runtime::block_on(download(app, update)).map(Some)
        }
        Ok(None) => Ok(None),
        Err(error) => Err(error),
    };
    CHECKING.store(false, Ordering::SeqCst);

    match result {
        Ok(Some(info)) => {
            // At startup only when the app is sitting in the tray; from the tray it was asked for.
            let idle = !broadcasting(app) && (tray || !main_window_visible(app));
            if idle {
                install_or_explain(app);
            } else {
                announce(app, &info);
                if tray {
                    notify(
                        app,
                        &format!("Versão {} pronta", info.version),
                        "Encerre a transmissão e escolha \"Atualizar\" no tray.",
                    );
                }
            }
        }
        Ok(None) => {
            set_tray(app, TrayItem::Check);
            if tray {
                let current = app.package_info().version.to_string();
                notify(app, "Nenhuma atualização", &format!("Você já está na versão {current}."));
            }
        }
        Err(error) => {
            eprintln!("{error}");
            set_tray(app, TrayItem::Check);
            if tray {
                notify(app, "Não deu para verificar", "Confira a conexão e tente de novo.");
            }
        }
    }
}

async fn find(app: &AppHandle) -> Result<Option<Update>, String> {
    app.updater()
        .map_err(|error| format!("The updater is unavailable: {error}"))?
        .check()
        .await
        .map_err(|error| format!("Could not check for updates: {error}"))
}

async fn download(app: &AppHandle, update: Update) -> Result<UpdateInfo, String> {
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
        .map_err(|error| format!("Could not download the update: {error}"))?;
    let ready = ReadyUpdate { update, bytes };
    let info = ready.info();
    *pending
        .0
        .lock()
        .map_err(|_| "Update state is unavailable".to_string())? = Some(ready);
    Ok(info)
}

fn install_or_explain(app: &AppHandle) {
    let Some(info) = pending_info(app) else {
        return;
    };
    if let Err(error) = install(app) {
        eprintln!("{error}");
        announce(app, &info);
        let message = if broadcasting(app) {
            "Encerre a transmissão e escolha \"Atualizar\" no tray."
        } else {
            "Tente de novo pelo tray."
        };
        notify(app, &format!("Versão {} pronta", info.version), message);
    }
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

fn set_tray(app: &AppHandle, item: TrayItem) {
    if let Err(error) = crate::refresh_tray_menu(app, &item) {
        eprintln!("Could not update the tray menu: {error}");
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
    ready
        .update
        .install(&ready.bytes)
        .map_err(|error| format!("Could not install the update: {error}"))?;
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
