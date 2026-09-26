//! Update channel reporting and the Android sideload updater.
//!
//! Desktop installs check through `tauri-plugin-updater` from the frontend; this
//! module only reports which update path an install should use. Sideloaded
//! Android builds cannot use that plugin (it is desktop-only), so the manifest
//! fetch, APK download, checksum, and installer handoff live here behind app
//! commands. Play-installed builds delegate to Play Core through the same
//! Kotlin plugin.
//!
//! The app commands are registered on the main builder, not as plugin commands,
//! so they need no capability entry (same pattern as `storage.rs`).

#[cfg(target_os = "android")]
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::Manager;
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "android")]
use std::collections::BTreeMap;

#[cfg(target_os = "android")]
use futures_util::StreamExt;
#[cfg(target_os = "android")]
use sha2::{Digest, Sha256};
#[cfg(target_os = "android")]
use tauri::ipc::Channel;
#[cfg(target_os = "android")]
use tauri::plugin::{Builder as PluginBuilder, PluginHandle, TauriPlugin};
#[cfg(target_os = "android")]
use tokio::io::AsyncWriteExt;

/// Release manifest attached to every GitHub release as `android.json`.
#[cfg(target_os = "android")]
const ANDROID_MANIFEST_URL: &str =
    "https://github.com/lemueldls/typbase/releases/latest/download/android.json";

#[cfg(target_os = "android")]
const GOOGLE_PLAY_INSTALLER: &str = "com.android.vending";

#[cfg(target_os = "android")]
const USER_AGENT: &str = concat!("Typbase/", env!("CARGO_PKG_VERSION"));

/// The Kotlin plugin handle. Registered in [`init`] and read by the commands.
#[cfg(target_os = "android")]
pub struct AndroidUpdater<R: Runtime>(PluginHandle<R>);

/// Update paths reported to the frontend.
#[cfg(target_os = "android")]
pub const CHANNEL_ANDROID_PLAY: &str = "android-play";
#[cfg(target_os = "android")]
pub const CHANNEL_ANDROID_SIDELOAD: &str = "android-sideload";
#[cfg(desktop)]
const CHANNEL_DESKTOP: &str = "desktop";
#[cfg(desktop)]
const CHANNEL_DESKTOP_PACKAGE_MANAGED: &str = "desktop-package-managed";
#[cfg(not(any(target_os = "android", desktop)))]
const CHANNEL_UNSUPPORTED: &str = "unsupported";

/// Registers the Kotlin `UpdaterPlugin` that owns the installer intent, the
/// install-unknown-apps settings flow, and the Play Core update. Android only;
/// there is no Kotlin half on other targets.
#[cfg(target_os = "android")]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("update")
        .setup(|app, api| {
            let handle = api.register_android_plugin("at.typbase.app", "UpdaterPlugin")?;
            app.manage(AndroidUpdater(handle));

            Ok(())
        })
        .build()
}

/// Which updater the running install should use.
#[tauri::command]
pub async fn update_channel<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        return android_channel(&app);
    }

    #[cfg(desktop)]
    {
        return Ok(desktop_channel(&app));
    }

    #[cfg(not(any(target_os = "android", desktop)))]
    {
        let _ = app;

        Ok(CHANNEL_UNSUPPORTED.into())
    }
}

/// Distro packages built from `tauri.package.conf.json` blank the updater
/// endpoints, so they report as package-managed instead of self-updating.
#[cfg(desktop)]
fn desktop_channel<R: Runtime>(app: &AppHandle<R>) -> String {
    let has_endpoints = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|value| value.get("endpoints"))
        .and_then(|value| value.as_array())
        .is_some_and(|endpoints| !endpoints.is_empty());

    if has_endpoints {
        CHANNEL_DESKTOP.into()
    } else {
        CHANNEL_DESKTOP_PACKAGE_MANAGED.into()
    }
}

/// Installs from Google Play get Play Core updates; everything else (direct APK,
/// sideload managers like Obtainium) gets the manifest-driven updater.
#[cfg(target_os = "android")]
fn android_channel<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let installer = {
        let updater = app.state::<AndroidUpdater<R>>();
        updater
            .0
            .run_mobile_plugin::<InstallerSource>("installerSource", ())
            .map_err(plugin_error)?
            .installer
    };

    Ok(if installer.as_deref() == Some(GOOGLE_PLAY_INSTALLER) {
        CHANNEL_ANDROID_PLAY.into()
    } else {
        CHANNEL_ANDROID_SIDELOAD.into()
    })
}

/// The sideload manifest entry for the device's best ABI, if it is newer than
/// the installed version.
#[cfg(target_os = "android")]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SideloadUpdate {
    current_version: String,
    version: String,
    abi: String,
    url: String,
    sha256: String,
    size: u64,
    notes: Option<String>,
    published_at: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AndroidManifest {
    version: String,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    abis: BTreeMap<String, AndroidAbiEntry>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
struct AndroidAbiEntry {
    url: String,
    sha256: String,
    size: u64,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
struct InstallerSource {
    installer: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
struct AbiList {
    abis: Vec<String>,
}

/// Registers the download progress reported over the command channel.
#[cfg(target_os = "android")]
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum DownloadEvent {
    Started { total: Option<u64> },
    Progress { downloaded: u64, total: Option<u64> },
    Finished { total: Option<u64> },
}

/// Fetches the release manifest and returns the entry for this device, or
/// `None` when the installed version is current or no ABI matches.
#[tauri::command]
#[cfg(target_os = "android")]
pub async fn android_update_check<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<SideloadUpdate>, String> {
    let result = check_sideload_update(&app).await;
    if let Err(cause) = &result {
        eprintln!("[update] check failed: {cause}");
    }

    result
}

#[cfg(target_os = "android")]
async fn check_sideload_update<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<SideloadUpdate>, String> {
    let abis = {
        let updater = app.state::<AndroidUpdater<R>>();
        updater
            .0
            .run_mobile_plugin::<AbiList>("abi", ())
            .map_err(plugin_error)?
            .abis
    };

    let manifest: AndroidManifest = http_client()?
        .get(ANDROID_MANIFEST_URL)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|cause| format!("update check failed: {cause}"))?
        .error_for_status()
        .map_err(|cause| format!("update check failed: {cause}"))?
        .json()
        .await
        .map_err(|cause| format!("update manifest is not readable: {cause}"))?;

    let current = app.package_info().version.clone();
    let latest = semver::Version::parse(manifest.version.trim().trim_start_matches('v'))
        .map_err(|cause| format!("update manifest version is not semver: {cause}"))?;
    if latest <= current {
        return Ok(None);
    }

    let Some(abi) = abis
        .into_iter()
        .find(|candidate| manifest.abis.contains_key(candidate))
    else {
        return Ok(None);
    };

    let entry = manifest
        .abis
        .get(&abi)
        .expect("abi picked from the manifest keys");

    Ok(Some(SideloadUpdate {
        current_version: current.to_string(),
        version: manifest.version,
        abi,
        url: entry.url.clone(),
        sha256: entry.sha256.clone(),
        size: entry.size,
        notes: manifest.notes,
        published_at: manifest.published_at,
    }))
}

/// Streams the APK into the app cache and verifies its SHA-256 before handing
/// the path back. The file lands inside the existing `${applicationId}.fileprovider`
/// `cache-path` root, so the installer intent can share it.
#[tauri::command]
#[cfg(target_os = "android")]
pub async fn android_update_download<R: Runtime>(
    app: AppHandle<R>,
    url: String,
    sha256: String,
    on_event: Channel<DownloadEvent>,
) -> Result<String, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|cause| format!("no cache directory: {cause}"))?;
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|cause| format!("could not create the cache directory: {cause}"))?;
    let path = directory.join("typbase-update.apk");

    let response = http_client()?
        .get(&url)
        .timeout(std::time::Duration::from_secs(900))
        .send()
        .await
        .map_err(|cause| format!("download failed: {cause}"))?
        .error_for_status()
        .map_err(|cause| format!("download failed: {cause}"))?;

    let total = response.content_length();
    let _ = on_event.send(DownloadEvent::Started { total });

    let mut file = tokio::fs::File::create(&path)
        .await
        .map_err(|cause| format!("could not write the update: {cause}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|cause| format!("download failed: {cause}"))?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        file.write_all(&chunk)
            .await
            .map_err(|cause| format!("could not write the update: {cause}"))?;
        let _ = on_event.send(DownloadEvent::Progress { downloaded, total });
    }

    file.flush()
        .await
        .map_err(|cause| format!("could not write the update: {cause}"))?;
    drop(file);

    let digest = hex::encode(hasher.finalize());
    if !digest.eq_ignore_ascii_case(sha256.trim()) {
        let _ = tokio::fs::remove_file(&path).await;
        return Err("the downloaded update failed its checksum".into());
    }

    let _ = on_event.send(DownloadEvent::Finished { total });

    Ok(path.to_string_lossy().into_owned())
}

/// Whether "install unknown apps" is granted. Android 8+ gates it per app.
#[tauri::command]
#[cfg(target_os = "android")]
pub async fn android_update_can_install<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let updater = app.state::<AndroidUpdater<R>>();
    updater
        .0
        .run_mobile_plugin::<CanInstallResponse>("canInstall", ())
        .map_err(plugin_error)
        .map(|response| response.can_install)
}

/// Opens the "install unknown apps" settings screen for Typbase. Resolves when
/// the user comes back; re-check `android_update_can_install` after it.
#[tauri::command]
#[cfg(target_os = "android")]
pub async fn android_update_request_permission<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(), String> {
    let updater = app.state::<AndroidUpdater<R>>();
    updater
        .0
        .run_mobile_plugin::<serde_json::Value>("requestInstallPermission", ())
        .map_err(plugin_error)?;

    Ok(())
}

/// Hands the cached APK to the system installer. The process is replaced once
/// the user confirms, so this may never resolve on success.
#[tauri::command]
#[cfg(target_os = "android")]
pub async fn android_update_install<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<(), String> {
    let updater = app.state::<AndroidUpdater<R>>();
    updater
        .0
        .run_mobile_plugin::<serde_json::Value>("install", InstallArgs { path })
        .map_err(plugin_error)?;

    Ok(())
}

/// Whether Play has an update for a Play-installed build.
#[tauri::command]
#[cfg(target_os = "android")]
pub async fn android_play_update_check<R: Runtime>(
    app: AppHandle<R>,
) -> Result<PlayUpdate, String> {
    let updater = app.state::<AndroidUpdater<R>>();
    updater
        .0
        .run_mobile_plugin::<PlayUpdate>("playCheck", ())
        .map_err(plugin_error)
}

/// Starts Play's update flow. Immediate updates replace the screen with Play's
/// own UI; the result reports whether the user completed it.
#[tauri::command]
#[cfg(target_os = "android")]
pub async fn android_play_update_start<R: Runtime>(
    app: AppHandle<R>,
) -> Result<PlayResult, String> {
    let updater = app.state::<AndroidUpdater<R>>();
    updater
        .0
        .run_mobile_plugin::<PlayResult>("playStart", ())
        .map_err(plugin_error)
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
struct CanInstallResponse {
    #[serde(rename = "canInstall")]
    can_install: bool,
}

#[cfg(target_os = "android")]
#[derive(Debug, Serialize, Deserialize)]
struct InstallArgs {
    path: String,
}

#[cfg(target_os = "android")]
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayUpdate {
    available: bool,
    #[serde(default)]
    version_code: i64,
    #[serde(default)]
    priority: i32,
}

#[cfg(target_os = "android")]
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayResult {
    status: String,
    #[serde(default)]
    code: i32,
}

#[cfg(target_os = "android")]
fn plugin_error(cause: tauri::plugin::mobile::PluginInvokeError) -> String {
    cause.to_string()
}

/// reqwest's rustls backend has no bundled provider; Tauri and the updater
/// plugin install `ring` on first use, so do the same before the first request.
///
/// The Android platform verifier needs a JNI context that is only set up by the
/// hosting runtime, and panics without one. Use Mozilla's compiled-in roots
/// instead: the only hosts this client talks to are GitHub release URLs.
#[cfg(target_os = "android")]
fn http_client() -> Result<reqwest::Client, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

    let mut roots = rustls::RootCertStore::empty();
    roots.add_parsable_certificates(webpki_root_certs::TLS_SERVER_ROOT_CERTS.iter().cloned());
    let tls = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();

    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(std::time::Duration::from_secs(15))
        .tls_backend_preconfigured(tls)
        .build()
        .map_err(|cause| format!("could not build the HTTP client: {cause}"))
}
