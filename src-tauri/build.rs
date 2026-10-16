// Every backend command is registered in the app manifest so that each one gets
// its own `allow-<command>` permission. The window capability then lists exactly
// the commands the frontend may call (see capabilities/default.json).
const COMMANDS: &[&str] = &[
    "app_info",
    "app_log",
    "wsl_detect",
    "wsl_start_distro",
    "wsl_terminate_distro",
    "wsl_linux_home",
    "wsl_to_linux_path",
    "env_diagnostics",
    "terminal_open",
    "terminal_write",
    "terminal_write_bytes",
    "terminal_resize",
    "terminal_ack",
    "terminal_close",
    "terminal_busy_check",
    "terminal_list",
    "fs_resolve_location",
    "fs_list_dir",
    "fs_browse_dirs",
    "fs_create",
    "fs_rename",
    "fs_delete",
    "project_templates",
    "project_create",
    "settings_load",
    "settings_save",
    "settings_reset",
    "state_load",
    "state_save",
    "monitor_sample_host",
    "monitor_sample_wsl",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
