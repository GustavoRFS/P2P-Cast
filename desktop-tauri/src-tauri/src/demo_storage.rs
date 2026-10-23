use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

const RETENTION_MS: u128 = 24 * 60 * 60 * 1000;
const MANIFEST_NAME: &str = "demos.json";
static NEXT_FILE_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DemoRecord {
    file_name: String,
    match_id: String,
    completed_at_unix_ms: u128,
}

pub struct DemoStorage {
    directory: PathBuf,
    records: Mutex<Vec<DemoRecord>>,
}

impl DemoStorage {
    pub fn new(directory: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&directory)
            .map_err(|error| format!("Não consegui criar a pasta temporária das demos: {error}"))?;
        let manifest = directory.join(MANIFEST_NAME);
        let records = match fs::read(&manifest) {
            Ok(bytes) => match serde_json::from_slice::<Vec<DemoRecord>>(&bytes) {
                Ok(records) => records,
                Err(error) => {
                    log::error!("GC demo manifest is invalid; rebuilding its index: {error}");
                    Vec::new()
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => {
                return Err(format!(
                    "Não consegui ler o registro local das demos: {error}"
                ))
            }
        };
        let storage = Self {
            directory,
            records: Mutex::new(records),
        };
        let removed = storage.cleanup_expired()?;
        log::info!("GC demo storage ready; startup cleanup removed {removed} expired file(s)");
        Ok(storage)
    }

    pub fn new_download_paths(&self, match_id: &str) -> Result<(PathBuf, PathBuf), String> {
        if !valid_match_id(match_id) {
            return Err("O identificador da partida é inválido.".to_string());
        }
        let timestamp = now_unix_ms();
        let sequence = NEXT_FILE_ID.fetch_add(1, Ordering::Relaxed);
        let base_name = format!("gc-{match_id}-{timestamp}-{sequence}");
        Ok((
            self.directory.join(format!("{base_name}.dem.part")),
            self.directory.join(format!("{base_name}.dem")),
        ))
    }

    pub fn store_completed(
        &self,
        partial_path: &Path,
        completed_path: &Path,
        match_id: &str,
    ) -> Result<PathBuf, String> {
        if !self.is_direct_child(partial_path) || !self.is_direct_child(completed_path) {
            return Err(
                "O caminho temporário da demo não pertence ao armazenamento do app.".to_string(),
            );
        }
        if !valid_match_id(match_id) {
            return Err("O identificador da partida é inválido.".to_string());
        }
        let metadata = fs::metadata(partial_path)
            .map_err(|error| format!("Não consegui validar a demo baixada: {error}"))?;
        if !metadata.is_file() || metadata.len() == 0 {
            return Err("A GC retornou um arquivo de demo vazio.".to_string());
        }
        fs::rename(partial_path, completed_path)
            .map_err(|error| format!("Não consegui finalizar o arquivo da demo: {error}"))?;

        let file_name = completed_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "O nome temporário da demo é inválido.".to_string())?
            .to_string();
        let file_name_for_rollback = file_name.clone();
        let record = DemoRecord {
            file_name,
            match_id: match_id.to_string(),
            completed_at_unix_ms: now_unix_ms(),
        };

        let mut records = self
            .records
            .lock()
            .map_err(|_| "O registro local das demos está indisponível.".to_string())?;
        records.retain(|existing| existing.file_name != record.file_name);
        records.push(record);
        if let Err(error) = self.write_manifest(&records) {
            records.retain(|existing| existing.file_name != file_name_for_rollback);
            let _ = fs::remove_file(completed_path);
            return Err(error);
        }
        log::info!("GC demo stored and indexed for match {match_id}");
        Ok(completed_path.to_path_buf())
    }

    pub fn cleanup_expired(&self) -> Result<usize, String> {
        let now = now_unix_ms();
        let mut removed = 0usize;
        let mut records = self
            .records
            .lock()
            .map_err(|_| "O registro local das demos está indisponível.".to_string())?;
        let mut retained = Vec::with_capacity(records.len());
        for record in records.iter() {
            if !valid_record_name(&record.file_name) {
                log::error!("Ignoring invalid filename in GC demo manifest");
                continue;
            }
            if now.saturating_sub(record.completed_at_unix_ms) < RETENTION_MS {
                retained.push(record.clone());
                continue;
            }
            let path = self.directory.join(&record.file_name);
            match fs::remove_file(&path) {
                Ok(()) => {
                    removed += 1;
                    log::info!("Expired GC demo removed for match {}", record.match_id);
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    log::warn!("Could not remove an expired GC demo; cleanup will retry: {error}");
                    retained.push(record.clone());
                }
            }
        }

        let indexed_names = retained
            .iter()
            .map(|record| record.file_name.as_str())
            .collect::<std::collections::HashSet<_>>();
        for entry in fs::read_dir(&self.directory).map_err(|error| {
            format!("Não consegui verificar a pasta temporária das demos: {error}")
        })? {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    log::warn!("Could not inspect a GC demo cache entry: {error}");
                    continue;
                }
            };
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let is_demo = name.to_ascii_lowercase().ends_with(".dem");
            let is_partial = name.to_ascii_lowercase().ends_with(".dem.part");
            if (!is_demo && !is_partial) || indexed_names.contains(name.as_str()) {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            let Ok(modified) = metadata.modified() else {
                continue;
            };
            let age_ms = SystemTime::now()
                .duration_since(modified)
                .map_or(0, |age| age.as_millis());
            if age_ms >= RETENTION_MS && fs::remove_file(entry.path()).is_ok() {
                removed += 1;
            }
        }

        *records = retained;
        self.write_manifest(&records)?;
        Ok(removed)
    }

    fn is_direct_child(&self, path: &Path) -> bool {
        path.parent() == Some(self.directory.as_path())
    }

    fn write_manifest(&self, records: &[DemoRecord]) -> Result<(), String> {
        let contents = serde_json::to_vec_pretty(records)
            .map_err(|error| format!("Não consegui serializar o registro das demos: {error}"))?;
        let temporary = self.directory.join("demos.json.tmp");
        let manifest = self.directory.join(MANIFEST_NAME);
        fs::write(&temporary, contents)
            .map_err(|error| format!("Não consegui salvar o registro local das demos: {error}"))?;
        if manifest.exists() {
            fs::remove_file(&manifest).map_err(|error| {
                format!("Não consegui atualizar o registro local das demos: {error}")
            })?;
        }
        fs::rename(&temporary, &manifest)
            .map_err(|error| format!("Não consegui finalizar o registro local das demos: {error}"))
    }
}

fn valid_match_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn valid_record_name(value: &str) -> bool {
    let path = Path::new(value);
    path.file_name().and_then(|name| name.to_str()) == Some(value)
        && value.to_ascii_lowercase().ends_with(".dem")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis())
}
