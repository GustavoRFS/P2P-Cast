//! Signed self-updates through tauri-plugin-updater. Release builds ask the feed in tauri.conf.json
//! (latest.json on the GitHub release, published by scripts/release.mjs) at startup and every few
//! hours, download and verify the installer in the background, and only run it while nothing is
//! being broadcast: right away when the app has just started in the tray (at login, usually),
//! otherwise when the user picks "Atualizar" in the app or in the tray. On Windows the NSIS
//! installer runs passive and reopens the app when it is done.

use std::{sync::Mutex, thread, time::Duration};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::{windows_audio::AudioCaptures, windows_capture::VideoCaptures};

const FIRST_CHECK_DELAY: Duration = Duration::from_secs(15);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    notes: Option<String>,
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

pub fn start(app: &AppHandle) {
    // A dev build would replace itself with the published installer; opt in to test the flow.
    if cfg!(debug_assertions) && std::env::var_os("P2PCAST_UPDATER_DEV").is_none() {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(FIRST_CHECK_DELAY);
        let mut just_started = true;
        loop {
            match tauri::async_runtime::block_on(download(&app)) {
                Ok(Some(info)) => {
                    let idle_in_tray = !main_window_visible(&app) && !broadcasting(&app);
                    // A dev build only announces it: installing would swap it for the release.
                    if just_started && idle_in_tray && !cfg!(debug_assertions) {
                        if let Err(error) = install(&app) {
                            eprintln!("{error}");
                        }
                    }
                    announce(&app, &info);
                }
                Ok(None) => {}
                Err(error) => eprintln!("{error}"),
            }
            just_started = false;
            thread::sleep(CHECK_INTERVAL);
        }
    });
}

async fn download(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app
        .updater()
        .map_err(|error| format!("The updater is unavailable: {error}"))?
        .check()
        .await
        .map_err(|error| format!("Could not check for updates: {error}"))?;
    let Some(update) = update else {
        return Ok(None);
    };
    let pending = app.state::<PendingUpdate>();
    if let Some(ready) = pending.0.lock().ok().as_deref().and_then(Option::as_ref) {
        if ready.update.version == update.version {
            return Ok(Some(ready.info()));
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
    Ok(Some(info))
}

fn announce(app: &AppHandle, info: &UpdateInfo) {
    let _ = app.emit_to("main", "update-ready", info);
    if let Err(error) = crate::refresh_tray_menu(app, Some(&info.version)) {
        eprintln!("Could not add the update to the tray menu: {error}");
    }
}

fn main_window_visible(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

fn broadcasting(app: &AppHandle) -> bool {
    app.state::<VideoCaptures>().is_active() || app.state::<AudioCaptures>().is_active()
}

/// Runs the downloaded installer. On Windows this ends the process (the installer reopens it).
pub fn install(app: &AppHandle) -> Result<(), String> {
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
