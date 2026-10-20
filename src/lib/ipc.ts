// Typed wrappers around the Tauri commands. This is the only module that
// calls `invoke`; the frontend never builds command lines or spawns processes.

import { Channel, invoke } from "@tauri-apps/api/core";
import { toAppError } from "@/lib/errors";
import type {
  AgentCommandResult,
  AgentConfigureRequest,
  AgentStatus,
  AgentTurnRequest,
  AppInfo,
  BusyInfo,
  CreateProjectRequest,
  CreateProjectResult,
  DirListing,
  Diagnostics,
  HostPlaces,
  HostReport,
  Loaded,
  Location,
  ResolvedLocation,
  SessionSummary,
  Settings,
  TemplateInfo,
  TerminalControl,
  WinApp,
  WorkspaceState,
  WslMetrics,
  WslStatus,
} from "@/types/ipc";

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    throw toAppError(e);
  }
}

export type TerminalChannelMessage = ArrayBuffer | Uint8Array | number[] | TerminalControl;

export interface OpenTerminalRequest {
  sessionId: string;
  distro: string | null;
  cwd: Location | null;
  cols: number;
  rows: number;
}

export const ipc = {
  appInfo: () => call<AppInfo>("app_info"),
  log: (level: "info" | "warn" | "error", source: string, message: string) =>
    call<void>("app_log", { level, source, message }).catch(() => undefined),

  wslDetect: () => call<WslStatus>("wsl_detect"),
  wslStartDistro: (name: string) => call<void>("wsl_start_distro", { name }),
  wslTerminateDistro: (name: string) => call<void>("wsl_terminate_distro", { name }),
  wslLinuxHome: (distro: string) => call<string>("wsl_linux_home", { distro }),
  wslToLinuxPath: (distro: string, windowsPath: string) =>
    call<string>("wsl_to_linux_path", { distro, windowsPath }),
  envDiagnostics: (distro: string) => call<Diagnostics>("env_diagnostics", { distro }),

  terminalOpen: (req: OpenTerminalRequest, channel: Channel<TerminalChannelMessage>) =>
    call<SessionSummary>("terminal_open", { req, onEvent: channel }),
  terminalWrite: (sessionId: string, data: string) => call<void>("terminal_write", { sessionId, data }),
  terminalWriteBytes: (sessionId: string, data: number[]) =>
    call<void>("terminal_write_bytes", { sessionId, data }),
  terminalResize: (sessionId: string, cols: number, rows: number) =>
    call<void>("terminal_resize", { sessionId, cols, rows }),
  terminalAck: (sessionId: string, bytes: number) => call<void>("terminal_ack", { sessionId, bytes }),
  terminalClose: (sessionId: string) => call<void>("terminal_close", { sessionId }),
  terminalBusyCheck: (sessionId: string) => call<BusyInfo>("terminal_busy_check", { sessionId }),
  terminalList: () => call<SessionSummary[]>("terminal_list"),

  fsResolveLocation: (input: string, defaultDistro: string | null) =>
    call<ResolvedLocation>("fs_resolve_location", { input, defaultDistro }),
  fsListDir: (root: Location, rel: string, showHidden: boolean) =>
    call<DirListing>("fs_list_dir", { root, rel, showHidden }),
  fsBrowseDirs: (location: Location, showHidden: boolean) =>
    call<DirListing>("fs_browse_dirs", { location, showHidden }),
  fsCreate: (root: Location, relParent: string, name: string, kind: "file" | "dir") =>
    call<void>("fs_create", { root, relParent, name, kind }),
  fsRename: (root: Location, rel: string, newName: string) =>
    call<void>("fs_rename", { root, rel, newName }),
  fsDelete: (root: Location, rel: string) => call<void>("fs_delete", { root, rel }),
  fsReadFile: (root: Location, rel: string) => call<string>("fs_read_file", { root, rel }),
  fsWriteFile: (root: Location, rel: string, content: string) =>
    call<void>("fs_write_file", { root, rel, content }),

  projectTemplates: () => call<TemplateInfo[]>("project_templates"),
  projectCreate: (req: CreateProjectRequest) => call<CreateProjectResult>("project_create", { req }),

  settingsLoad: () => call<Loaded<Settings>>("settings_load"),
  settingsSave: (settings: Settings) => call<void>("settings_save", { settings }),
  settingsReset: () => call<Settings>("settings_reset"),
  stateLoad: () => call<Loaded<WorkspaceState>>("state_load"),
  stateSave: (workspace: WorkspaceState) => call<void>("state_save", { workspace }),

  monitorHost: () => call<HostReport>("monitor_sample_host"),
  monitorWsl: (distro: string) => call<WslMetrics>("monitor_sample_wsl", { distro }),

  agentStatus: () => call<AgentStatus>("agent_status"),
  agentConfigure: (req: AgentConfigureRequest) => call<AgentStatus>("agent_configure", { req }),
  /** Resolves `true` when the turn completed, `false` when it was cancelled. */
  agentStream: (req: AgentTurnRequest, channel: Channel<Record<string, unknown>>) =>
    call<boolean>("agent_stream", { req, onEvent: channel }),
  agentCancel: (requestId: string) => call<void>("agent_cancel", { requestId }),
  agentRunCommand: (distro: string, cwd: string | null, command: string) =>
    call<AgentCommandResult>("agent_run_command", { distro, cwd, command }),

  desktopPlaces: () => call<HostPlaces>("desktop_places"),
  desktopWinApps: () => call<WinApp[]>("desktop_win_apps"),
  /** Real Windows icons as PNG data URLs (null when there is none), at most 64 paths per call. */
  desktopIcons: (paths: string[]) => call<(string | null)[]>("desktop_icons", { paths }),
  desktopOpen: (location: Location, reveal = false) => call<void>("desktop_open", { location, reveal }),
  desktopStateLoad: () => call<Loaded<Record<string, unknown>>>("desktop_state_load"),
  desktopStateSave: (value: Record<string, unknown>) => call<void>("desktop_state_save", { value }),
};

export { Channel };
