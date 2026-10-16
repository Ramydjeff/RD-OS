// Shapes exchanged with the Rust backend. They mirror the serde definitions in
// src-tauri/src (camelCase on the wire).

export type Location =
  | { kind: "linux"; distro: string; path: string }
  | { kind: "windows"; path: string };

export interface AppErrorShape {
  kind: string;
  message: string;
}

export interface Distro {
  name: string;
  state: string;
  running: boolean;
  version: number;
  isDefault: boolean;
  /** Owned by another product (e.g. docker-desktop): shown, never controlled. */
  managed: boolean;
}

export interface WslProblem {
  code: string;
  message: string;
  hint: string;
}

export interface WslStatus {
  available: boolean;
  wslPath: string | null;
  versionText: string | null;
  wslVersion: string | null;
  statusText: string | null;
  defaultDistro: string | null;
  distros: Distro[];
  problem: WslProblem | null;
}

export type EntryKind = "dir" | "file" | "other";

export interface FsEntry {
  name: string;
  kind: EntryKind;
  size: number;
  modifiedMs: number | null;
  hidden: boolean;
  symlink: boolean;
}

export interface DirListing {
  entries: FsEntry[];
  truncated: boolean;
}

export interface ResolvedLocation {
  location: Location;
  hostPath: string;
  display: string;
  exists: boolean;
  isDir: boolean;
  tooBroadForWrites: boolean;
}

export interface SessionSummary {
  id: string;
  distro: string;
  cwd: string;
  pid: number | null;
  startedMs: number;
  exited: boolean;
  exitCode: number | null;
  unackedBytes: number;
}

export interface BusyInfo {
  busy: boolean;
  unknown: boolean;
  jobs: string[];
}

export interface ToolCheck {
  command: string;
  label: string;
  found: boolean;
  version: string | null;
  detail: string | null;
}

export interface OsRelease {
  prettyName: string | null;
  name: string | null;
  versionId: string | null;
}

export interface Diagnostics {
  distro: string;
  uname: string | null;
  osRelease: OsRelease;
  tools: ToolCheck[];
  errors: string[];
}

export interface WslMetrics {
  distro: string;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  memTotalKb: number | null;
  memAvailableKb: number | null;
  uptimeSecs: number | null;
}

export interface HostReport {
  appPid: number;
  appCpuPercent: number;
  appMemoryBytes: number;
  systemMemoryTotal: number;
  systemMemoryUsed: number;
  logicalCpus: number;
  sessions: number;
  activeSessions: number;
}

export interface AppInfo {
  name: string;
  version: string;
  configDir: string;
  logPath: string | null;
  elevated: boolean;
  wslInstalled: boolean;
}

export interface TemplateInfo {
  id: string;
  label: string;
  description: string;
  files: string[];
}

export interface CreateProjectRequest {
  parent: Location;
  name: string;
  template: string;
  allowExisting: boolean;
  createVenv: boolean;
}

export interface CreateProjectResult {
  location: Location;
  created: string[];
  skipped: string[];
  venv: { ok: boolean; message: string } | null;
}

export type ThemeSetting = "dark" | "light" | "system";
export type CursorStyle = "block" | "underline" | "bar";
export type StartupBehavior = "open_terminal" | "empty" | "restore_project";

export interface Settings {
  version: number;
  theme: ThemeSetting;
  terminal: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    cursorStyle: CursorStyle;
    cursorBlink: boolean;
    scrollback: number;
    copyOnSelect: boolean;
  };
  defaultDistro: string | null;
  defaultProjectDir: Location | null;
  startup: StartupBehavior;
  shortcuts: Record<string, string>;
  confirmations: {
    deleteEntries: boolean;
    closeBusyTerminal: boolean;
    closeAppWithSessions: boolean;
    terminateDistro: boolean;
  };
  monitor: { enabled: boolean; intervalSecs: number };
}

export type ActiveView = "explorer" | "environments" | "processes" | "settings";

export interface LayoutState {
  sidebarVisible: boolean;
  sidebarWidth: number;
  panelVisible: boolean;
  panelHeight: number;
  activeView: ActiveView | "terminal";
}

export interface RecentProject {
  location: Location;
  name: string;
  openedAt: number;
}

export interface WorkspaceState {
  layout: LayoutState;
  recentProjects: RecentProject[];
  lastProject: Location | null;
  selectedDistro: string | null;
  showHiddenFiles: boolean;
}

export interface Loaded<T> {
  value: T;
  warning: string | null;
}

/** Control messages sent through a terminal channel (output arrives as raw bytes). */
export type TerminalControl = { type: "exit"; code: number | null };
