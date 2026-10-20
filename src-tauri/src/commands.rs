//! Tauri commands. This is the only surface the frontend can reach, and each
//! command is individually granted in `capabilities/default.json`.
//!
//! Commands never accept a command line. They take typed, validated values and
//! the backend decides which processes to start.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::agent::{self, AgentState, AgentStatus, CommandResult, ConfigureRequest, TurnRequest};
use crate::desktop::{self, HostPlaces, WinApp};
use crate::error::{AppError, AppResult};
use crate::fsops::{self, CreateKind, DirListing, ResolvedLocation};
use crate::location::Location;
use crate::logging;
use crate::monitor::{HostMonitor, HostSample};
use crate::pty::{BusyInfo, OpenParams, SessionManager, SessionSummary, Sink, TerminalMsg};
use crate::settings::{Loaded, Settings, Store, WorkspaceState};
use crate::templates::{self, CreateProjectRequest, CreateProjectResult, TemplateInfo};
use crate::wsl::{self, Diagnostics, WslMetrics, WslStatus};

pub struct AppState {
    pub sessions: SessionManager,
    pub icons: crate::icons::IconCache,
    pub store: Store,
    pub monitor: HostMonitor,
    pub agent: AgentState,
    pub log_path: Option<std::path::PathBuf>,
}

type Shared<'a> = State<'a, Arc<AppState>>;

/// Runs blocking work (process spawns, filesystem access) off the async runtime.
async fn blocking<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Process(format!("background task failed: {e}")))?
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub config_dir: String,
    pub log_path: Option<String>,
    pub elevated: bool,
    pub wsl_installed: bool,
}

/// True when the process runs with a High integrity token (started as administrator).
fn is_elevated() -> bool {
    let mut cmd = std::process::Command::new("whoami");
    cmd.args(["/groups", "/fo", "csv", "/nh"]);
    match crate::proc::run_capture(cmd, std::time::Duration::from_secs(10)) {
        Ok(out) => String::from_utf8_lossy(&out.stdout).contains("S-1-16-12288"),
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn app_info(state: Shared<'_>) -> AppResult<AppInfo> {
    let s = state.inner().clone();
    blocking(move || {
        Ok(AppInfo {
            name: "RYCOS Dev Environment",
            version: env!("CARGO_PKG_VERSION"),
            config_dir: s.store.dir().display().to_string(),
            log_path: s.log_path.as_ref().map(|p| p.display().to_string()),
            elevated: is_elevated(),
            wsl_installed: wsl::wsl_installed(),
        })
    })
    .await
}

#[tauri::command]
pub async fn app_log(level: String, source: String, message: String) -> AppResult<()> {
    let source: String = source.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(24).collect();
    logging::log(logging::Level::parse(&level), &format!("ui:{source}"), &message);
    Ok(())
}

// ---------------------------------------------------------------------------
// WSL
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn wsl_detect() -> AppResult<WslStatus> {
    blocking(|| Ok(wsl::detect())).await
}

#[tauri::command]
pub async fn wsl_start_distro(name: String) -> AppResult<()> {
    blocking(move || wsl::start_distro(&name)).await
}

#[tauri::command]
pub async fn wsl_terminate_distro(name: String) -> AppResult<()> {
    blocking(move || wsl::terminate_distro(&name)).await
}

#[tauri::command]
pub async fn wsl_linux_home(distro: String) -> AppResult<String> {
    blocking(move || wsl::linux_home(&distro)).await
}

#[tauri::command]
pub async fn wsl_to_linux_path(distro: String, windows_path: String) -> AppResult<String> {
    blocking(move || wsl::to_linux_path(&distro, &windows_path)).await
}

#[tauri::command]
pub async fn env_diagnostics(distro: String) -> AppResult<Diagnostics> {
    blocking(move || wsl::diagnostics(&distro)).await
}

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    pub session_id: String,
    pub distro: Option<String>,
    /// Starting directory. `None` means the Linux home directory.
    pub cwd: Option<Location>,
    pub cols: u16,
    pub rows: u16,
}

#[tauri::command]
pub async fn terminal_open(
    state: Shared<'_>,
    req: OpenRequest,
    on_event: Channel<InvokeResponseBody>,
) -> AppResult<SessionSummary> {
    let s = state.inner().clone();
    blocking(move || {
        let requested = match (&req.distro, &req.cwd) {
            (Some(d), Some(Location::Linux { distro, .. })) if !d.eq_ignore_ascii_case(distro) => {
                return Err(AppError::InvalidInput("the working directory belongs to a different distribution".into()))
            }
            (Some(d), _) => Some(d.clone()),
            (None, Some(Location::Linux { distro, .. })) => Some(distro.clone()),
            (None, _) => None,
        };
        let preferred = match requested {
            Some(d) => Some(d),
            None => s.store.load_settings().value.default_distro,
        };
        // Resolve, validate, and reject managed distributions.
        let distro = wsl::ensure_usable_distro(&wsl::pick_default_distro(preferred.as_deref())?)?;
        let cwd = match &req.cwd {
            Some(loc) => loc.terminal_cwd()?,
            None => "~".to_string(),
        };

        let sink: Sink = Arc::new(move |msg| match msg {
            TerminalMsg::Output(bytes) => on_event.send(InvokeResponseBody::Raw(bytes)).is_ok(),
            TerminalMsg::Exit { code } => on_event
                .send(InvokeResponseBody::Json(serde_json::json!({ "type": "exit", "code": code }).to_string()))
                .is_ok(),
        });
        s.sessions.open(
            OpenParams {
                id: req.session_id,
                distro: distro.name,
                cwd,
                cols: req.cols,
                rows: req.rows,
            },
            sink,
        )
    })
    .await
}

#[tauri::command]
pub async fn terminal_write(state: Shared<'_>, session_id: String, data: String) -> AppResult<()> {
    state.sessions.write(&session_id, data.into_bytes())
}

#[tauri::command]
pub async fn terminal_write_bytes(state: Shared<'_>, session_id: String, data: Vec<u8>) -> AppResult<()> {
    state.sessions.write(&session_id, data)
}

#[tauri::command]
pub async fn terminal_resize(state: Shared<'_>, session_id: String, cols: u16, rows: u16) -> AppResult<()> {
    state.sessions.resize(&session_id, cols, rows)
}

#[tauri::command]
pub async fn terminal_ack(state: Shared<'_>, session_id: String, bytes: usize) -> AppResult<()> {
    state.sessions.ack(&session_id, bytes)
}

#[tauri::command]
pub async fn terminal_close(state: Shared<'_>, session_id: String) -> AppResult<()> {
    let s = state.inner().clone();
    blocking(move || s.sessions.close(&session_id)).await
}

#[tauri::command]
pub async fn terminal_busy_check(state: Shared<'_>, session_id: String) -> AppResult<BusyInfo> {
    let s = state.inner().clone();
    blocking(move || s.sessions.busy_check(&session_id)).await
}

#[tauri::command]
pub async fn terminal_list(state: Shared<'_>) -> AppResult<Vec<SessionSummary>> {
    Ok(state.sessions.list())
}

// ---------------------------------------------------------------------------
// Files and projects
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn fs_resolve_location(input: String, default_distro: Option<String>) -> AppResult<ResolvedLocation> {
    blocking(move || {
        let loc = Location::parse_user_input(&input, default_distro.as_deref())?;
        fsops::resolve_location(&loc)
    })
    .await
}

#[tauri::command]
pub async fn fs_list_dir(root: Location, rel: String, show_hidden: bool) -> AppResult<DirListing> {
    blocking(move || fsops::list_dir(&root, &rel, show_hidden)).await
}

#[tauri::command]
pub async fn fs_browse_dirs(location: Location, show_hidden: bool) -> AppResult<DirListing> {
    blocking(move || fsops::browse_dirs(&location, show_hidden)).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NewEntryKind {
    File,
    Dir,
}

#[tauri::command]
pub async fn fs_create(root: Location, rel_parent: String, name: String, kind: NewEntryKind) -> AppResult<()> {
    blocking(move || {
        let kind = match kind {
            NewEntryKind::File => CreateKind::File,
            NewEntryKind::Dir => CreateKind::Dir,
        };
        fsops::create_entry(&root, &rel_parent, &name, kind)
    })
    .await
}

#[tauri::command]
pub async fn fs_rename(root: Location, rel: String, new_name: String) -> AppResult<()> {
    blocking(move || fsops::rename_entry(&root, &rel, &new_name)).await
}

#[tauri::command]
pub async fn fs_delete(root: Location, rel: String) -> AppResult<()> {
    blocking(move || {
        logging::info("fs", &format!("delete requested in {}", root.display()));
        fsops::delete_entry(&root, &rel)
    })
    .await
}

#[tauri::command]
pub async fn fs_read_file(root: Location, rel: String) -> AppResult<String> {
    blocking(move || fsops::read_file(&root, &rel)).await
}

#[tauri::command]
pub async fn fs_write_file(root: Location, rel: String, content: String) -> AppResult<()> {
    blocking(move || fsops::write_file(&root, &rel, &content)).await
}

#[tauri::command]
pub async fn project_templates() -> AppResult<Vec<TemplateInfo>> {
    Ok(templates::list_templates())
}

#[tauri::command]
pub async fn project_create(req: CreateProjectRequest) -> AppResult<CreateProjectResult> {
    blocking(move || {
        let r = templates::create_project(&req)?;
        logging::info("project", &format!("created '{}' from template {}", req.name, req.template));
        Ok(r)
    })
    .await
}

// ---------------------------------------------------------------------------
// Settings and workspace state
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn settings_load(state: Shared<'_>) -> AppResult<Loaded<Settings>> {
    let s = state.inner().clone();
    blocking(move || Ok(s.store.load_settings())).await
}

#[tauri::command]
pub async fn settings_save(state: Shared<'_>, settings: Settings) -> AppResult<()> {
    let s = state.inner().clone();
    blocking(move || s.store.save_settings(&settings)).await
}

#[tauri::command]
pub async fn settings_reset(state: Shared<'_>) -> AppResult<Settings> {
    let s = state.inner().clone();
    blocking(move || s.store.reset_settings()).await
}

#[tauri::command]
pub async fn state_load(state: Shared<'_>) -> AppResult<Loaded<WorkspaceState>> {
    let s = state.inner().clone();
    blocking(move || Ok(s.store.load_state())).await
}

#[tauri::command]
pub async fn state_save(state: Shared<'_>, workspace: WorkspaceState) -> AppResult<()> {
    let s = state.inner().clone();
    blocking(move || s.store.save_state(workspace)).await
}

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostReport {
    #[serde(flatten)]
    pub sample: HostSample,
    pub sessions: usize,
    pub active_sessions: usize,
}

#[tauri::command]
pub async fn monitor_sample_host(state: Shared<'_>) -> AppResult<HostReport> {
    let s = state.inner().clone();
    blocking(move || {
        let sample = s.monitor.sample().map_err(AppError::Process)?;
        Ok(HostReport {
            sample,
            sessions: s.sessions.count(),
            active_sessions: s.sessions.active_count(),
        })
    })
    .await
}

#[tauri::command]
pub async fn monitor_sample_wsl(distro: String) -> AppResult<WslMetrics> {
    blocking(move || wsl::sample_metrics(&distro)).await
}

// ---------------------------------------------------------------------------
// rAImy Agent
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn agent_status(state: Shared<'_>) -> AppResult<AgentStatus> {
    Ok(state.agent.status())
}

#[tauri::command]
pub async fn agent_configure(state: Shared<'_>, req: ConfigureRequest) -> AppResult<AgentStatus> {
    let s = state.inner().clone();
    blocking(move || s.agent.configure(req)).await
}

/// Streams one model turn. Every server-sent event is forwarded as JSON; the
/// promise resolves with `true` when the answer completed, `false` if cancelled.
#[tauri::command]
pub async fn agent_stream(state: Shared<'_>, req: TurnRequest, on_event: Channel<serde_json::Value>) -> AppResult<bool> {
    let s = state.inner().clone();
    blocking(move || s.agent.stream_turn(req, &|event| on_event.send(event).is_ok())).await
}

#[tauri::command]
pub async fn agent_cancel(state: Shared<'_>, request_id: String) -> AppResult<()> {
    state.agent.cancel(&request_id);
    Ok(())
}

/// Runs a command the user approved in the agent panel (never called without approval).
#[tauri::command]
pub async fn agent_run_command(distro: String, cwd: Option<String>, command: String) -> AppResult<CommandResult> {
    blocking(move || agent::run_command(&distro, cwd.as_deref(), &command)).await
}

// ---------------------------------------------------------------------------
// Desktop shell
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn desktop_places() -> AppResult<HostPlaces> {
    blocking(|| Ok(desktop::places())).await
}

#[tauri::command]
pub async fn desktop_win_apps() -> AppResult<Vec<WinApp>> {
    blocking(|| Ok(desktop::list_apps())).await
}

#[tauri::command]
pub async fn desktop_icons(state: Shared<'_>, paths: Vec<String>) -> AppResult<Vec<Option<String>>> {
    if paths.len() > crate::icons::MAX_BATCH {
        return Err(AppError::InvalidInput(format!("at most {} icons per request", crate::icons::MAX_BATCH)));
    }
    let s = state.inner().clone();
    blocking(move || Ok(s.icons.data_urls(&paths))).await
}

#[tauri::command]
pub async fn desktop_open(location: Location, reveal: bool) -> AppResult<()> {
    blocking(move || desktop::open(&location, reveal)).await
}

#[tauri::command]
pub async fn desktop_state_load(state: Shared<'_>) -> AppResult<Loaded<serde_json::Value>> {
    let s = state.inner().clone();
    blocking(move || Ok(desktop::load_state(s.store.dir()))).await
}

#[tauri::command]
pub async fn desktop_state_save(state: Shared<'_>, value: serde_json::Value) -> AppResult<()> {
    let s = state.inner().clone();
    blocking(move || desktop::save_state(s.store.dir(), &value)).await
}
