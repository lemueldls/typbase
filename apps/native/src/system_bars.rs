//! System bar icon tint for Android.
//!
//! `enableEdgeToEdge()` picks the status and navigation icon tint from the
//! system dark mode, so a light workspace on a dark phone drew white icons
//! over the white app surface. The web layer reports its resolved theme
//! through this app command (registered on the main builder, so it needs no
//! capability entry, same as `storage.rs`), and the Kotlin `SystemBarsPlugin`
//! flips the icon appearance. The bars themselves stay transparent; the app
//! paints under them.

#[cfg(target_os = "android")]
use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use tauri::plugin::{Builder as PluginBuilder, PluginHandle, TauriPlugin};
#[cfg(target_os = "android")]
use tauri::{AppHandle, Manager, Runtime};

/// The Kotlin plugin handle. Registered in [`init`] and read by the command.
#[cfg(target_os = "android")]
pub struct AndroidSystemBars<R: Runtime>(PluginHandle<R>);

#[cfg(target_os = "android")]
#[derive(Debug, Serialize, Deserialize)]
struct SetLightArgs {
    light: bool,
}

/// Registers the Kotlin `SystemBarsPlugin`. Android only; there is no Kotlin
/// half on other targets.
#[cfg(target_os = "android")]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("system-bars")
        .setup(|app, api| {
            let handle = api.register_android_plugin("at.typbase.app", "SystemBarsPlugin")?;
            app.manage(AndroidSystemBars(handle));

            Ok(())
        })
        .build()
}

/// Tints the system bar icons for the resolved app theme. `light` means a
/// light app surface, which needs dark icons.
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn system_bars_light<R: Runtime>(app: AppHandle<R>, light: bool) -> Result<(), String> {
    let bars = app.state::<AndroidSystemBars<R>>();
    bars.0
        .run_mobile_plugin::<serde_json::Value>("setLight", SetLightArgs { light })
        .map(|_| ())
        .map_err(|error| error.to_string())
}
