#[allow(unused_imports)]
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, webview::PageLoadEvent, window::Color};

mod fonts;
mod storage;
mod update;

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
            storage::storage_watch,
            storage::storage_unwatch,
            storage::export_save_file,
            fonts::system_font_index,
            fonts::system_font_file,
            update::update_channel,
            #[cfg(target_os = "android")]
            update::android_update_check,
            #[cfg(target_os = "android")]
            update::android_update_download,
            #[cfg(target_os = "android")]
            update::android_update_can_install,
            #[cfg(target_os = "android")]
            update::android_update_request_permission,
            #[cfg(target_os = "android")]
            update::android_update_install,
            #[cfg(target_os = "android")]
            update::android_play_update_check,
            #[cfg(target_os = "android")]
            update::android_play_update_start,
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

    #[cfg(target_os = "android")]
    {
        builder = builder.plugin(update::init());
    }

    // #[cfg(any(debug_assertions, feature = "devtools"))]
    // let builder = builder
    //     .plugin(tauri_plugin_devtools::init())
    //     .plugin(tauri_plugin_devtools_app::init());

    builder
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            app.manage(storage::StorageState::load(app.handle())?);
            app.manage(storage::WatchState::default());

            let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default());

            #[cfg(mobile)]
            let win_builder = win_builder.transparent(true);

            #[cfg(desktop)]
            let win_builder = win_builder
                // .background_color(Color::from_str("#f5efe6").unwrap())
                .title("Typbase")
                .on_document_title_changed(|window, title| {
                    if !title.is_empty() {
                        let _ = window.set_title(&title);
                    }
                })
                // .inner_size(896.0, 672.0)
                .visible(false)
                .on_page_load(|window, payload| {
                    if payload.event() == PageLoadEvent::Finished {
                        let _ = window.show();
                    }
                });

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
