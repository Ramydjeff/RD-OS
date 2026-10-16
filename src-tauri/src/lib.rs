pub mod commands;
pub mod error;
pub mod fsops;
pub mod location;
pub mod logging;
pub mod monitor;
pub mod proc;
pub mod pty;
pub mod settings;
pub mod templates;
pub mod wsl;

use std::sync::Arc;

use tauri::{Manager, RunEvent};

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let log_dir = app.path().app_local_data_dir()?.join("logs");
            let log_path = logging::init(&log_dir);
            logging::info("app", &format!("starting RYCOS Dev Environment {}", env!("CARGO_PKG_VERSION")));
            app.manage(Arc::new(AppState {
                sessions: pty::SessionManager::new(),
                store: settings::Store::new(config_dir),
                monitor: monitor::HostMonitor::new(),
                log_path,
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::app_log,
            commands::wsl_detect,
            commands::wsl_start_distro,
            commands::wsl_terminate_distro,
            commands::wsl_linux_home,
            commands::wsl_to_linux_path,
            commands::env_diagnostics,
            commands::terminal_open,
            commands::terminal_write,
            commands::terminal_write_bytes,
            commands::terminal_resize,
            commands::terminal_ack,
            commands::terminal_close,
            commands::terminal_busy_check,
            commands::terminal_list,
            commands::fs_resolve_location,
            commands::fs_list_dir,
            commands::fs_browse_dirs,
            commands::fs_create,
            commands::fs_rename,
            commands::fs_delete,
            commands::project_templates,
            commands::project_create,
            commands::settings_load,
            commands::settings_save,
            commands::settings_reset,
            commands::state_load,
            commands::state_save,
            commands::monitor_sample_host,
            commands::monitor_sample_wsl,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the application");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            // Every terminal owned by this app is closed; nothing else is touched.
            if let Some(state) = handle.try_state::<Arc<AppState>>() {
                state.sessions.shutdown_all();
            }
            logging::info("app", "exited");
        }
    });
}
