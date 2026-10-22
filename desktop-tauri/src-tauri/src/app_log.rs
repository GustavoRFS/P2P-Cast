//! A log file for looking into a live after the fact: info from the app and the native sender,
//! errors from everything else. In the app's log folder (%LOCALAPPDATA%\com.p2pcast.desktop.tauri\
//! logs on Windows) as p2pcast.log, with the previous run kept as p2pcast.old.log.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

// A runaway loop must not fill the disk; a normal live writes a few lines a minute.
const MAX_BYTES: u64 = 8 * 1024 * 1024;

struct FileLogger {
    file: Mutex<(File, u64)>,
    started: Instant,
}

fn ours(target: &str) -> bool {
    target.starts_with("p2pcast_native_broadcast") || target.starts_with("p2p_cast_desktop_tauri")
}

impl log::Log for FileLogger {
    fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
        metadata.level() <= if ours(metadata.target()) { log::Level::Info } else { log::Level::Error }
    }

    fn log(&self, record: &log::Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let Ok(mut guard) = self.file.lock() else { return };
        let (file, written) = &mut *guard;
        if *written > MAX_BYTES {
            return;
        }
        let line = format!(
            "[{:>9.3}] {:<5} {}: {}\n",
            self.started.elapsed().as_secs_f64(),
            record.level(),
            record.target(),
            record.args()
        );
        if file.write_all(line.as_bytes()).is_ok() {
            *written += line.len() as u64;
        }
    }

    fn flush(&self) {
        if let Ok(mut guard) = self.file.lock() {
            let _ = guard.0.flush();
        }
    }
}

pub fn init(app: &AppHandle) {
    let Ok(dir) = app.path().app_log_dir() else { return };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("p2pcast.log");
    let _ = fs::rename(&path, dir.join("p2pcast.old.log"));
    let Ok(mut file) = OpenOptions::new().create(true).write(true).truncate(true).open(&path) else {
        return;
    };
    let unix = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_secs());
    let _ = writeln!(file, "P2P-Cast {} started at unix time {unix}", app.package_info().version);
    let logger = FileLogger { file: Mutex::new((file, 0)), started: Instant::now() };
    if log::set_boxed_logger(Box::new(logger)).is_ok() {
        log::set_max_level(log::LevelFilter::Info);
    }
}
