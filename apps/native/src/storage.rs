//! Real filesystem storage for the `TauriBackend` in @typbase/storage.
//!
//! The webview never sees an absolute path: every command takes a path
//! relative to the active root and resolves it under that root, rejecting
//! `..`, absolute paths, and Windows prefixes. The root itself is chosen on
//! first run (app data, device documents, or a picked folder) and remembered
//! in a small config file in the app config dir, so a broken custom root is
//! recoverable by picking another location in the setup screen.
//!
//! Writes go through a temp file and a rename, so a crash mid-snapshot leaves
//! the previous file intact instead of a torn Loro document.

// `#[tauri::command]` hands `State` and argument strings over by value; the
// macro needs that signature shape, so the pedantic lint does not apply here.
#![allow(clippy::needless_pass_by_value)]

use std::{
    fs,
    io::{ErrorKind, Write as _},
    path::{Component, Path, PathBuf},
    sync::{
        Mutex, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard,
        atomic::{AtomicU64, Ordering},
    },
    time::UNIX_EPOCH,
};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher as _};
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, State,
    ipc::{InvokeBody, Request, Response},
};

/// Subdirectory of the app data dir used for `App` mode.
const STORAGE_DIR: &str = "storage";
/// Folder created in the platform documents dir for `Device` mode.
const DEVICE_DIR: &str = "Typbase";
/// Root choice, kept outside the storage root itself.
const CONFIG_FILE: &str = "storage.json";

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StorageMode {
    App,
    Device,
    Custom,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageConfig {
    mode: StorageMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    path: Option<PathBuf>,
}

#[derive(Debug)]
struct Active {
    mode: StorageMode,
    root: PathBuf,
    configured: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStateInfo {
    mode: StorageMode,
    root: String,
    app_root: String,
    device_root: Option<String>,
    configured: bool,
    /// Desktop can open a native folder picker; mobile cannot reach arbitrary
    /// folders without SAF/bookmarks, so Device mode stays app-scoped there.
    can_pick_folder: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageEntryStat {
    kind: &'static str,
    size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    modified_at: Option<u64>,
}

pub struct StorageState {
    config_file: PathBuf,
    app_root: PathBuf,
    device_root: Option<PathBuf>,
    active: RwLock<Active>,
}

impl StorageState {
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> Result<Self, std::io::Error> {
        let config_file = app
            .path()
            .app_config_dir()
            .map_err(|error| io_error(format!("no app config dir: {error}")))?
            .join(CONFIG_FILE);
        let app_root = app
            .path()
            .app_data_dir()
            .map_err(|error| io_error(format!("no app data dir: {error}")))?
            .join(STORAGE_DIR);
        // `document_dir` is unavailable on Android when external storage is not
        // mounted; Device mode is then offered as unusable in the setup screen.
        let device_root = app
            .path()
            .document_dir()
            .ok()
            .map(|dir| dir.join(DEVICE_DIR));

        let stored = read_config(&config_file);
        let has_config = stored.is_some();
        let (mode, root) = match stored {
            Some(config) => {
                let root = match config.mode {
                    StorageMode::App => app_root.clone(),
                    StorageMode::Device => device_root.clone().unwrap_or_else(|| app_root.clone()),
                    StorageMode::Custom => config
                        .path
                        .filter(|path| path.is_absolute())
                        .unwrap_or_else(|| app_root.clone()),
                };
                (config.mode, root)
            }
            None => (StorageMode::App, app_root.clone()),
        };

        // A missing root we cannot recreate (unplugged drive, revoked folder)
        // drops back to the setup screen instead of failing app startup.
        let usable = fs::create_dir_all(&root).is_ok();

        Ok(Self {
            config_file,
            app_root,
            device_root,
            active: RwLock::new(Active {
                mode,
                root,
                configured: has_config && usable,
            }),
        })
    }

    fn active(&self) -> RwLockReadGuard<'_, Active> {
        self.active.read().unwrap_or_else(PoisonError::into_inner)
    }

    fn active_mut(&self) -> RwLockWriteGuard<'_, Active> {
        self.active.write().unwrap_or_else(PoisonError::into_inner)
    }

    fn info(&self) -> StorageStateInfo {
        let active = self.active();

        StorageStateInfo {
            mode: active.mode,
            root: active.root.to_string_lossy().into_owned(),
            app_root: self.app_root.to_string_lossy().into_owned(),
            device_root: self
                .device_root
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            configured: active.configured,
            can_pick_folder: cfg!(desktop),
        }
    }

    fn configure(
        &self,
        mode: StorageMode,
        path: Option<String>,
    ) -> Result<StorageStateInfo, String> {
        let custom_path = match (mode, path) {
            (StorageMode::Custom, Some(path)) => {
                let path = PathBuf::from(path);
                if !path.is_absolute() {
                    return Err("custom storage path must be absolute".into());
                }
                Some(path)
            }
            (StorageMode::Custom, None) => return Err("custom storage mode needs a path".into()),
            (_, Some(_)) => return Err("a path is only valid for custom storage".into()),
            (_, None) => None,
        };

        let root = match mode {
            StorageMode::App => self.app_root.clone(),
            StorageMode::Device => self
                .device_root
                .clone()
                .ok_or("this device has no documents directory")?,
            StorageMode::Custom => custom_path.clone().unwrap(),
        };

        fs::create_dir_all(&root)
            .map_err(|error| format!("failed to create {}: {error}", root.display()))?;

        write_config(
            &self.config_file,
            &StorageConfig {
                mode,
                path: custom_path,
            },
        )?;

        *self.active_mut() = Active {
            mode,
            root,
            configured: true,
        };

        Ok(self.info())
    }

    fn resolve(&self, raw: &str) -> Result<PathBuf, String> {
        Ok(self.active().root.join(safe_relative(raw)?))
    }

    /// Like `resolve`, but `""` addresses the root. Listing and stat are the
    /// only operations that make sense on the root itself.
    fn resolve_maybe_root(&self, raw: &str) -> Result<PathBuf, String> {
        if raw.is_empty() {
            return Ok(self.active().root.clone());
        }

        self.resolve(raw)
    }
}

#[tauri::command]
pub fn storage_state(state: State<'_, StorageState>) -> StorageStateInfo {
    state.info()
}

#[tauri::command]
pub fn storage_configure(
    state: State<'_, StorageState>,
    mode: StorageMode,
    path: Option<String>,
) -> Result<StorageStateInfo, String> {
    state.configure(mode, path)
}

/// Opens the native folder picker on desktop. Returns null when cancelled.
///
/// The dialog plugin is called from Rust, so no `dialog:*` capability is
/// needed; the JS side never reaches the plugin directly.
#[cfg(desktop)]
#[tauri::command]
pub async fn storage_pick_directory<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt as _;

    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Choose where Typbase keeps its workspaces")
            .blocking_pick_folder()
            .and_then(|path| path.into_path().ok())
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| format!("folder picker failed: {error}"))
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn storage_pick_directory() -> Result<Option<String>, String> {
    Err("this platform has no folder picker; use app or device storage".into())
}

/// Desktop export: asks where to save a copy of one storage file. Returns the
/// destination path, or null when the dialog was cancelled.
#[cfg(desktop)]
#[tauri::command]
pub async fn storage_export<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, StorageState>,
    path: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt as _;

    let target = state.resolve(&path)?;
    let bytes = fs::read(&target)
        .map_err(|error| format!("failed to read {}: {error}", target.display()))?;
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "export".to_string());

    tauri::async_runtime::spawn_blocking(move || {
        let Some(destination) = app
            .dialog()
            .file()
            .set_file_name(name)
            .blocking_save_file()
            .and_then(|file| file.into_path().ok())
        else {
            return Ok(None);
        };

        fs::write(&destination, bytes)
            .map_err(|error| format!("failed to write {}: {error}", destination.display()))?;

        Ok(Some(destination.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| format!("save dialog failed: {error}"))?
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn storage_export(path: String) -> Result<Option<String>, String> {
    let _ = path;
    Err("exporting files needs the desktop app; use the browser download".into())
}

/// Saves arbitrary bytes through the native save dialog. Returns the chosen
/// path, or null when cancelled. The suggested file name rides in a header
/// because a raw-bytes invoke cannot carry named arguments.
#[cfg(desktop)]
#[tauri::command]
pub async fn export_save_file<R: Runtime>(
    app: AppHandle<R>,
    request: Request<'_>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt as _;

    let raw = request
        .headers()
        .get("name")
        .and_then(|value| value.to_str().ok())
        .ok_or("export_save_file needs a name header")?;
    let name = percent_decode_str(raw)
        .decode_utf8()
        .map_err(|_| "export file name is not valid UTF-8")?
        .into_owned();
    let data = request_bytes(request.body())?;

    tauri::async_runtime::spawn_blocking(move || {
        let Some(destination) = app
            .dialog()
            .file()
            .set_file_name(name)
            .blocking_save_file()
            .and_then(|file| file.into_path().ok())
        else {
            return Ok(None);
        };

        atomic_write(&destination, &data)?;

        Ok(Some(destination.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| format!("save dialog failed: {error}"))?
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn export_save_file(_request: Request<'_>) -> Result<Option<String>, String> {
    Err("saving files needs the desktop app".into())
}

#[tauri::command]
pub fn storage_read(state: State<'_, StorageState>, path: String) -> Result<Response, String> {
    let target = state.resolve(&path)?;

    match fs::read(&target) {
        Ok(bytes) => Ok(Response::new(bytes)),
        // JSON null maps to the backend's "missing" result.
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(Response::new("null".to_string())),
        Err(error) => Err(format!("failed to read {}: {error}", target.display())),
    }
}

#[tauri::command]
pub fn storage_write(state: State<'_, StorageState>, request: Request<'_>) -> Result<(), String> {
    let raw = request
        .headers()
        .get("path")
        .and_then(|value| value.to_str().ok())
        .ok_or("storage_write needs a path header")?;
    let path = percent_decode_str(raw)
        .decode_utf8()
        .map_err(|_| "storage path is not valid UTF-8")?;
    let target = state.resolve(&path)?;
    let data = request_bytes(request.body())?;

    atomic_write(&target, &data)
}

#[tauri::command]
pub fn storage_delete(state: State<'_, StorageState>, path: String) -> Result<(), String> {
    let target = state.resolve(&path)?;

    match fs::symlink_metadata(&target) {
        Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(&target)
            .map_err(|error| format!("failed to delete {}: {error}", target.display())),
        Ok(_) => fs::remove_file(&target)
            .map_err(|error| format!("failed to delete {}: {error}", target.display())),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to stat {}: {error}", target.display())),
    }
}

#[tauri::command]
pub fn storage_list(state: State<'_, StorageState>, path: String) -> Result<Vec<String>, String> {
    let target = state.resolve_maybe_root(&path)?;

    match fs::read_dir(&target) {
        Ok(entries) => {
            let mut names: Vec<String> = entries
                .filter_map(Result::ok)
                .filter_map(|entry| entry.file_name().into_string().ok())
                .collect();
            names.sort();

            Ok(names)
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("failed to list {}: {error}", target.display())),
    }
}

#[tauri::command]
pub fn storage_stat(
    state: State<'_, StorageState>,
    path: String,
) -> Result<Option<StorageEntryStat>, String> {
    let target = state.resolve_maybe_root(&path)?;
    let metadata = match fs::metadata(&target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("failed to stat {}: {error}", target.display())),
    };

    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX));

    Ok(Some(if metadata.is_dir() {
        StorageEntryStat {
            kind: "directory",
            size: 0,
            modified_at,
        }
    } else {
        StorageEntryStat {
            kind: "file",
            size: metadata.len(),
            modified_at,
        }
    }))
}

/// Change event payload for `storage-source-change`.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceChange {
    root: String,
    relative: String,
}

/// One active source watcher. Replacing it drops the previous watch, and the
/// stored path lets a late `storage_unwatch` from a switched workspace be
/// ignored instead of clearing the new watcher.
struct SourceWatch {
    path: String,
    _watcher: RecommendedWatcher,
}

/// Watcher slot for the active workspace's page tree.
#[derive(Default)]
pub struct WatchState(Mutex<Option<SourceWatch>>);

/// Starts (or replaces) the source watcher for one directory under the active
/// root. Filtering happens here so the webview only hears about page sources
/// and never about the app's own `state/` snapshots.
#[tauri::command]
pub fn storage_watch<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, StorageState>,
    watch: State<'_, WatchState>,
    path: String,
) -> Result<(), String> {
    let root = state.resolve(&path)?;
    // A fresh workspace may not have flushed its first snapshot yet; the
    // watcher owns the directory from here on.
    if let Err(error) = fs::create_dir_all(&root) {
        return Err(format!("failed to create {}: {error}", root.display()));
    }

    let base = root.clone();
    let watched = path.clone();
    let mut handle = notify::recommended_watcher(move |result: notify::Result<Event>| {
        let Ok(event) = result else { return };
        if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
            return;
        }

        for changed in event.paths {
            let Ok(relative) = changed.strip_prefix(&base) else {
                continue;
            };
            let relative = relative.to_string_lossy().replace('\\', "/");
            if !is_source_change(&relative) {
                continue;
            }

            let _ = app.emit(
                "storage-source-change",
                SourceChange {
                    root: watched.clone(),
                    relative,
                },
            );
        }
    })
    .map_err(|error| format!("failed to start the source watcher: {error}"))?;

    handle
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|error| format!("failed to watch {}: {error}", root.display()))?;

    *watch.0.lock().unwrap_or_else(PoisonError::into_inner) = Some(SourceWatch {
        path,
        _watcher: handle,
    });

    Ok(())
}

/// Stops the watcher when it still belongs to `path`.
#[tauri::command]
pub fn storage_unwatch(watch: State<'_, WatchState>, path: String) {
    let mut current = watch.0.lock().unwrap_or_else(PoisonError::into_inner);
    if current.as_ref().is_some_and(|watcher| watcher.path == path) {
        *current = None;
    }
}

/// Page-source filter for watcher events: visible `.typ` files outside the
/// app-owned roots. Kept in step with `RESERVED_ROOTS`/`isSourceChange` in
/// `packages/storage/src/workspace.ts`.
#[allow(clippy::case_sensitive_file_extension_comparisons)] // both sides match lowercase `.typ`
fn is_source_change(relative: &str) -> bool {
    let parts: Vec<&str> = relative.split('/').collect();
    if parts.iter().any(|part| part.starts_with('.')) {
        return false;
    }
    if matches!(
        parts.first(),
        Some(&"state" | &"typbase" | &"blobs" | &"artifacts")
    ) {
        return false;
    }

    relative.ends_with(".typ")
}

/// Validates a storage-relative path: segments only, no roots or `..`.
fn safe_relative(raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() {
        return Err("empty storage path".into());
    }

    let mut out = PathBuf::new();
    for component in Path::new(raw).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("invalid storage path `{raw}`"));
            }
        }
    }

    if out.as_os_str().is_empty() {
        return Err(format!("invalid storage path `{raw}`"));
    }

    Ok(out)
}

/// Accepts both the desktop raw body and Android's JSON byte-array fallback.
fn request_bytes(body: &InvokeBody) -> Result<Vec<u8>, String> {
    match body {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(serde_json::Value::Array(values)) => values
            .iter()
            .map(|value| {
                value
                    .as_u64()
                    .and_then(|byte| u8::try_from(byte).ok())
                    .ok_or_else(|| "storage_write received a non-byte value".to_string())
            })
            .collect(),
        InvokeBody::Json(_) => Err("storage_write received an unsupported body".into()),
    }
}

/// Write to a sibling temp file, sync, then rename over the target.
fn atomic_write(target: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }

    let name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("entry");
    let temp = target.with_file_name(format!(
        ".{name}.tmp-{}-{}",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));

    let result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(data)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, target)
    })();

    if let Err(error) = result {
        let _ = fs::remove_file(&temp);

        return Err(format!("failed to write {}: {error}", target.display()));
    }

    Ok(())
}

fn read_config(path: &Path) -> Option<StorageConfig> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn write_config(path: &Path, config: &StorageConfig) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(config)
        .map_err(|error| format!("failed to encode storage config: {error}"))?;

    atomic_write(path, &bytes)
}

fn io_error(message: String) -> std::io::Error {
    std::io::Error::other(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "typbase-storage-test-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn rejects_paths_outside_the_root() {
        for rejected in ["", ".", "..", "../x", "a/../b", "/etc/passwd", "./../x"] {
            assert!(
                safe_relative(rejected).is_err(),
                "`{rejected}` should be rejected"
            );
        }
    }

    #[test]
    fn keeps_relative_nested_paths() {
        assert_eq!(
            safe_relative("workspaces/local/workspace.loro").unwrap(),
            PathBuf::from("workspaces/local/workspace.loro")
        );
        assert_eq!(safe_relative("./a//b").unwrap(), PathBuf::from("a/b"));
    }

    #[test]
    fn root_listing_only_for_list_and_stat() {
        let dir = temp_dir();
        let root = dir.join("app");
        let state = StorageState {
            config_file: dir.join("storage.json"),
            app_root: root.clone(),
            device_root: None,
            active: RwLock::new(Active {
                mode: StorageMode::App,
                root: root.clone(),
                configured: true,
            }),
        };

        assert_eq!(state.resolve_maybe_root("").unwrap(), root);
        assert!(state.resolve("").is_err());
        assert_eq!(
            state.resolve("workspaces/x").unwrap(),
            root.join("workspaces/x")
        );
    }

    #[test]
    fn request_bytes_accepts_raw_and_json_bodies() {
        assert_eq!(
            request_bytes(&InvokeBody::Raw(vec![1, 2, 3])).unwrap(),
            vec![1, 2, 3]
        );
        assert_eq!(
            request_bytes(&InvokeBody::Json(serde_json::json!([4, 5, 6]))).unwrap(),
            vec![4, 5, 6]
        );
        assert!(request_bytes(&InvokeBody::Json(serde_json::json!({ "0": 1 }))).is_err());
        assert!(request_bytes(&InvokeBody::Json(serde_json::json!([256]))).is_err());
    }

    #[test]
    fn source_change_filter_keeps_only_page_sources() {
        for accepted in ["pages/foo.typ", "daily/2026-09-22.typ", "a/b/c.typ"] {
            assert!(is_source_change(accepted), "`{accepted}` should sync");
        }

        for rejected in [
            "",
            "state/workspace.loro",
            "typbase/entries/pages/foo.typ",
            "blobs/abc.png",
            "artifacts/pages/foo.typ",
            "pages/foo.txt",
            "pages/.hidden.typ",
            ".git/objects/foo.typ",
            ".notes/foo.typ",
        ] {
            assert!(!is_source_change(rejected), "`{rejected}` should not sync");
        }
    }

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp() {
        let dir = temp_dir();
        let target = dir.join("workspaces/x/workspace.loro");

        atomic_write(&target, b"first").unwrap();
        atomic_write(&target, b"second").unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"second");
        let siblings: Vec<_> = fs::read_dir(target.parent().unwrap())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(siblings, vec![std::ffi::OsString::from("workspace.loro")]);

        fs::remove_dir_all(&dir).unwrap();
    }
}
