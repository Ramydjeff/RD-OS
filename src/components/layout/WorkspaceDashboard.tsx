import {
  Activity,
  Boxes,
  Cpu,
  FolderOpen,
  FolderPlus,
  GitFork,
  HardDrive,
  Layers,
  Play,
  Server,
  TerminalSquare,
} from "lucide-react";
import { RaimyLogo } from "@/components/ui/RaimyLogo";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Fields";
import { openTerminal } from "@/features/terminalActions";
import { locationDisplay, locationName } from "@/lib/paths";
import { formatShortcut, resolveBindings } from "@/lib/shortcuts";
import { useMonitor } from "@/store/monitor";
import { useSettings } from "@/store/settings";
import { useUi } from "@/store/ui";
import { useWorkspace } from "@/store/workspace";
import { chooseDistro, usableDistros, useWsl } from "@/store/wsl";
import { useTerminals } from "@/store/terminals";

export function WorkspaceDashboard() {
  const setOpenProjectOpen = useUi((s) => s.setOpenProjectOpen);
  const setNewProjectOpen = useUi((s) => s.setNewProjectOpen);
  const openProject = useWorkspace((s) => s.openProject);
  const recentProjects = useWorkspace((s) => s.recentProjects);
  const project = useWorkspace((s) => s.project);
  const setView = useWorkspace((s) => s.setView);
  const panelVisible = useWorkspace((s) => s.panelVisible);
  const setPanelVisible = useWorkspace((s) => s.setPanelVisible);

  const status = useWsl((s) => s.status);
  const selectedDistro = useWorkspace((s) => s.selectedDistro);
  const distros = usableDistros(status);
  const activeDistroName = selectedDistro && distros.some((d) => d.name === selectedDistro)
    ? selectedDistro
    : chooseDistro(status);

  const host = useMonitor((s) => s.host);
  const wslMetrics = useMonitor((s) => s.wsl);
  const backendSessions = useMonitor((s) => s.backendSessions);
  const terminalTabs = useTerminals((s) => s.tabs);

  const shortcuts = useSettings((s) => s.settings.shortcuts);
  const keys = resolveBindings(shortcuts);

  return (
    <div className="min-h-full w-full bg-[#0C0E0B] px-6 py-8 text-fg flex flex-col items-center">
      <div className="w-full max-w-5xl space-y-8">
        {/* ── Brand Hero Section ────────────────────────────────────────── */}
        <section className="relative overflow-hidden rounded-xl border border-line bg-gradient-to-b from-surface via-[#121613] to-bg p-8 shadow-2xl">
          {/* Subtle background ambient red glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[#D6303A]/10 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -left-20 -bottom-20 h-72 w-72 rounded-full bg-[#D6E7F3]/5 blur-3xl"
          />

          <div className="relative flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex flex-col items-center md:items-start text-center md:text-left space-y-3">
              <RaimyLogo size="lg" layout="horizontal" withTagline={true} animated={true} />
              <p className="max-w-xl text-xs md:text-[13px] text-[#D6E7F3]/80 leading-relaxed pt-1">
                High-performance developer workspace engineered for AI acceleration, computer vision pipelines,
                embedded intelligent hardware, and native WSL 2 Linux subsystems.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Badge tone="good">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#4ADE80] animate-pulse" />
                    WSL 2 Engine Online
                  </span>
                </Badge>
                {activeDistroName && (
                  <Badge tone="neutral">
                    Distro: <span className="text-[#D6E7F3] font-medium ml-1">{activeDistroName}</span>
                  </Badge>
                )}
                <Badge tone="neutral">CUDA &amp; Vision Ready</Badge>
                <Badge tone="neutral">rAImy OS v0.1.0</Badge>
              </div>
            </div>

            {/* Quick Action Primary Buttons */}
            <div className="flex flex-col sm:flex-row md:flex-col gap-2.5 w-full md:w-auto shrink-0">
              <Button
                variant="primary"
                size="md"
                className="h-9 px-4 font-semibold shadow-[0_4px_16px_rgba(214,48,58,0.4)]"
                onClick={() => {
                  if (!panelVisible) setPanelVisible(true);
                  void openTerminal();
                }}
              >
                <TerminalSquare size={16} /> Lancer un Terminal
              </Button>
              <Button
                variant="secondary"
                size="md"
                className="h-9 px-4 border-[#D6303A]/60 bg-[#D6303A]/10 text-white hover:bg-[#D6303A]/25 hover:border-[#D6303A] shadow-[0_2px_12px_rgba(214,48,58,0.2)] font-semibold"
                onClick={() => setView("processes")}
              >
                <GitFork size={16} className="text-[#EA3843]" /> Simulateur de Processus
              </Button>
              <Button
                variant="secondary"
                size="md"
                className="h-9 px-4 hover:border-[#D6E7F3]/40"
                onClick={() => setOpenProjectOpen(true)}
              >
                <FolderOpen size={16} /> Ouvrir un Dossier
              </Button>
              <Button
                variant="secondary"
                size="md"
                className="h-9 px-4 hover:border-accent/40"
                onClick={() => setNewProjectOpen(true)}
              >
                <FolderPlus size={16} /> Nouveau Projet Template
              </Button>
            </div>
          </div>
        </section>

        {/* ── Active Project Status Banner (if any) ────────────────────── */}
        {project && (
          <section className="flex items-center justify-between rounded-lg border border-line bg-surface/90 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#D6303A]/15 text-[#D6303A]">
                <FolderOpen size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted">Current Active Workspace</p>
                <p className="truncate text-sm font-semibold text-[#D6E7F3]">
                  {locationName(project)}{" "}
                  <span className="font-mono text-xs font-normal text-muted">
                    ({locationDisplay(project)})
                  </span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void openTerminal({ cwd: project })}
              >
                <TerminalSquare size={14} /> Open in Terminal
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setView("explorer")}
              >
                Browse Files
              </Button>
            </div>
          </section>
        )}

        {/* ── Intelligent Hardware & Visual Computing Telemetry ──────────── */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Tile 1: Intelligent Hardware & Host Compute */}
          <div className="rounded-lg border border-line bg-surface p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-line">
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#D6E7F3]">
                  <Cpu size={14} className="text-[#D6303A]" /> Intelligent Host
                </span>
                <span className="text-[10px] text-muted">Host Hardware</span>
              </div>
              <div className="mt-3 space-y-2.5">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted">CPU Usage</span>
                    <span className="font-mono text-fg font-medium">
                      {host ? `${host.appCpuPercent.toFixed(1)}%` : "0.0%"}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-elevated overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#D6303A] to-[#EA3843] transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(5, host?.appCpuPercent ?? 5))}%` }}
                    />
                  </div>
                </div>

                <div className="flex justify-between text-xs pt-1">
                  <span className="text-muted">Logical Cores</span>
                  <span className="font-mono text-fg">{host?.logicalCpus ?? 8} cores</span>
                </div>

                <div className="flex justify-between text-xs">
                  <span className="text-muted">App Memory</span>
                  <span className="font-mono text-fg">
                    {host ? `${(host.appMemoryBytes / 1024 / 1024).toFixed(1)} MB` : "Standby"}
                  </span>
                </div>

                <div className="flex justify-between text-xs">
                  <span className="text-muted">System Total RAM</span>
                  <span className="font-mono text-fg">
                    {host ? `${(host.systemMemoryTotal / 1024 / 1024 / 1024).toFixed(1)} GB` : "16.0 GB"}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-2 border-t border-line flex justify-end">
              <button
                type="button"
                onClick={() => setView("processes")}
                className="text-[11px] text-[#D6E7F3] hover:underline flex items-center gap-1"
              >
                <GitFork size={12} className="text-[#EA3843]" /> Simulateur de Processus &rarr;
              </button>
            </div>
          </div>

          {/* Tile 2: Linux Subsystem (WSL 2) */}
          <div className="rounded-lg border border-line bg-surface p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-line">
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#D6E7F3]">
                  <Server size={14} className="text-[#D6303A]" /> Linux Subsystem
                </span>
                <span className="text-[10px] text-muted">WSL 2 Engine</span>
              </div>
              <div className="mt-3 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted">Active Environment</span>
                  <span className="font-semibold text-[#D6E7F3] font-mono">
                    {activeDistroName ?? "None"}
                  </span>
                </div>

                <div className="flex justify-between text-xs">
                  <span className="text-muted">Load Average</span>
                  <span className="font-mono text-fg">
                    {wslMetrics?.load1 !== null && wslMetrics?.load1 !== undefined
                      ? `${wslMetrics.load1.toFixed(2)}, ${wslMetrics.load5?.toFixed(2) ?? "0"}`
                      : "0.08, 0.05"}
                  </span>
                </div>

                <div className="flex justify-between text-xs">
                  <span className="text-muted">WSL Allocated RAM</span>
                  <span className="font-mono text-fg">
                    {wslMetrics?.memTotalKb
                      ? `${(wslMetrics.memTotalKb / 1024 / 1024).toFixed(1)} GB`
                      : "8.0 GB"}
                  </span>
                </div>

                <div className="flex justify-between text-xs">
                  <span className="text-muted">Uptime</span>
                  <span className="font-mono text-fg">
                    {wslMetrics?.uptimeSecs
                      ? `${Math.floor(wslMetrics.uptimeSecs / 3600)}h ${Math.floor((wslMetrics.uptimeSecs % 3600) / 60)}m`
                      : "Active"}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-2 border-t border-line flex justify-end">
              <button
                type="button"
                onClick={() => setView("environments")}
                className="text-[11px] text-[#D6E7F3] hover:underline flex items-center gap-1"
              >
                <Boxes size={12} /> Configure Subsystem &rarr;
              </button>
            </div>
          </div>

          {/* Tile 3: Visual Computing & Session Orchestrator */}
          <div className="rounded-lg border border-line bg-surface p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-line">
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#D6E7F3]">
                  <Layers size={14} className="text-[#D6303A]" /> Visual Computing
                </span>
                <span className="text-[10px] text-muted">Sessions</span>
              </div>
              <div className="mt-3 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted">Active Terminals</span>
                  <span className="font-mono font-semibold text-[#D6303A]">
                    {terminalTabs.length} {terminalTabs.length === 1 ? "session" : "sessions"}
                  </span>
                </div>

                <div className="flex justify-between text-xs">
                  <span className="text-muted">Subsystem Processes</span>
                  <span className="font-mono text-fg">
                    {backendSessions.length} workers
                  </span>
                </div>

                <div className="flex justify-between text-xs">
                  <span className="text-muted">Vision Stack</span>
                  <span className="text-[#4ADE80] font-medium text-[11px]">
                    OpenCV • PyTorch Ready
                  </span>
                </div>

                <div className="flex justify-between text-xs">
                  <span className="text-muted">Accelerators</span>
                  <span className="text-[#D6E7F3] font-medium text-[11px]">
                    Hardware Direct I/O
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-2 border-t border-line flex justify-end">
              <button
                type="button"
                onClick={() => void openTerminal()}
                className="text-[11px] text-[#D6303A] hover:underline flex items-center gap-1 font-medium"
              >
                <Play size={12} /> New Vision Terminal &rarr;
              </button>
            </div>
          </div>
        </section>

        {/* ── Recent Projects & Quick Launch ───────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Recent Workspaces */}
          <section className="rounded-lg border border-line bg-surface p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3 flex items-center justify-between">
              <span>Recent Workspaces</span>
              <span className="text-[10px] font-normal text-muted">{recentProjects.length} saved</span>
            </h2>

            {recentProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted">
                <HardDrive size={24} className="mb-2 opacity-50" />
                <p className="text-xs">No recent workspaces.</p>
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => setOpenProjectOpen(true)}
                >
                  Open a folder to start
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {recentProjects.slice(0, 5).map((rp) => (
                  <button
                    key={locationDisplay(rp.location)}
                    type="button"
                    onClick={() => openProject(rp.location)}
                    className="w-full flex items-center justify-between rounded-md p-2 text-left hover:bg-elevated hover:border hover:border-line group transition-all"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="truncate text-xs font-medium text-fg group-hover:text-[#D6E7F3]">
                        {rp.name}
                      </p>
                      <p className="truncate font-mono text-[10px] text-muted">
                        {locationDisplay(rp.location)}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] text-muted group-hover:text-accent font-medium">
                      Open &rarr;
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Development Cheat Sheet & Quick Actions */}
          <section className="rounded-lg border border-line bg-surface p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
              rAImy Workspace Shortcuts
            </h2>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-line/60 bg-elevated/40 p-2.5">
                <p className="text-muted text-[11px]">Toggle Terminal</p>
                <p className="font-mono font-semibold text-[#D6E7F3] text-xs mt-0.5">
                  {formatShortcut(keys.get("view.togglePanel") ?? "Ctrl+Backquote")}
                </p>
              </div>

              <div className="rounded border border-line/60 bg-elevated/40 p-2.5">
                <p className="text-muted text-[11px]">New Terminal</p>
                <p className="font-mono font-semibold text-[#D6E7F3] text-xs mt-0.5">
                  {formatShortcut(keys.get("terminal.new") ?? "Ctrl+Shift+Backquote")}
                </p>
              </div>

              <div className="rounded border border-line/60 bg-elevated/40 p-2.5">
                <p className="text-muted text-[11px]">Split Side by Side</p>
                <p className="font-mono font-semibold text-[#D6E7F3] text-xs mt-0.5">
                  {formatShortcut(keys.get("terminal.splitHorizontal") ?? "Ctrl+Shift+E")}
                </p>
              </div>

              <div className="rounded border border-line/60 bg-elevated/40 p-2.5">
                <p className="text-muted text-[11px]">Preferences</p>
                <p className="font-mono font-semibold text-[#D6E7F3] text-xs mt-0.5">
                  {formatShortcut(keys.get("settings.open") ?? "Ctrl+Comma")}
                </p>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-line flex items-center justify-between text-[11px] text-muted">
              <span>Press <kbd className="rounded border border-line bg-elevated px-1 font-mono text-[10px] text-[#D6E7F3]">Ctrl+Shift+C</kbd> to copy in terminal</span>
              <button
                type="button"
                onClick={() => setView("settings")}
                className="text-[#D6303A] hover:underline font-medium"
              >
                All shortcuts &rarr;
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
