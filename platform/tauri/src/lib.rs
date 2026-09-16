use std::str::FromStr;

#[allow(unused_imports)]
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, window::Color};

mod fonts;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            storage::storage_state,
            storage::storage_configure,
            storage::storage_pick_directory,
            storage::storage_export,
            storage::storage_read,
            storage::storage_write,
            storage::storage_delete,
            storage::storage_list,
            storage::storage_stat,
            fonts::system_font_index,
            fonts::system_font_file,
        ]);

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_cli::init())
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                let _ = app
                    .get_webview_window("main")
                    .expect("no main window")
                    .set_focus();
            }))
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    // #[cfg(any(debug_assertions, feature = "devtools"))]
    // let builder = builder
    //     .plugin(tauri_plugin_devtools::init())
    //     .plugin(tauri_plugin_devtools_app::init());

    builder
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // Storage roots must be resolved before the webview can ask for
            // them; `load` never fails on a broken root (the setup screen
            // takes over), only on a missing platform config dir.
            app.manage(storage::StorageState::load(app.handle())?);

            let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .background_color(Color::from_str("#f5efe6").unwrap());

            #[cfg(desktop)]
            let win_builder = win_builder.title("Typbase").inner_size(896.0, 672.0);

            #[cfg(target_os = "macos")]
            let win_builder = win_builder.title_bar_style(tauri::TitleBarStyle::Transparent);
            // #[cfg(target_os = "linux")]
            // let win_builder = win_builder.decorations(false);

            win_builder.build().unwrap();

            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            Ok(())
        })
        // .runtime(tauri_runtime_cef::Cef::default())
        .runtime(tauri_runtime_wry::Wry::default())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
