import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Activity, Minus, Square, TerminalSquare, X } from "lucide-react";
import { RaimyLogo } from "@/components/ui/RaimyLogo";
import { locationName } from "@/lib/paths";
import { formatShortcut, resolveBindings } from "@/lib/shortcuts";
import { useMonitor } from "@/store/monitor";
import { useSettings } from "@/store/settings";
import { useWorkspace } from "@/store/workspace";
import { chooseDistro, usableDistros, useWsl } from "@/store/wsl";
import { cn } from "@/lib/cn";

export function TitleBar() {
  const project = useWorkspace((s) => s.project);
  const activeView = useWorkspace((s) => s.activeView);
  const panelVisible = useWorkspace((s) => s.panelVisible);
  const togglePanel = useWorkspace((s) => s.togglePanel);
  const setView = useWorkspace((s) => s.setView);
  const shortcuts = useSettings((s) => s.settings.shortcuts);
  const keys = resolveBindings(shortcuts);

  const status = useWsl((s) => s.status);
  const selectedDistro = useWorkspace((s) => s.selectedDistro);
  const distros = usableDistros(status);
  const activeDistroName = selectedDistro && distros.some((d) => d.name === selectedDistro)
    ? selectedDistro
    : chooseDistro(status);

  const host = useMonitor((s) => s.host);
  const [isMaximized, setIsMaximized] = useState(false);

  // Monitor window maximize state in Tauri
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    async function watchMaximize() {
      try {
        const win = getCurrentWindow();
        if (typeof win?.isMaximized === "function") {
          setIsMaximized(await win.isMaximized());
        }
        if (typeof win?.onResized === "function") {
          unlisten = await win.onResized(async () => {
            if (typeof win?.isMaximized === "function") {
              setIsMaximized(await win.isMaximized());
            }
          });
        }
      } catch {
        /* Not running inside Tauri window */
      }
    }
    void watchMaximize();
    return () => unlisten?.();
  }, []);

  const handleMinimize = async () => {
    try {
      const win = getCurrentWindow();
      if (typeof win?.minimize === "function") await win.minimize();
    } catch {
      /* browser environment */
    }
  };

  const handleMaximize = async () => {
    try {
      const win = getCurrentWindow();
      if (typeof win?.toggleMaximize === "function") {
        await win.toggleMaximize();
        if (typeof win?.isMaximized === "function") {
          setIsMaximized(await win.isMaximized());
        }
      }
    } catch {
      /* browser environment */
    }
  };

  const handleClose = async () => {
    try {
      const win = getCurrentWindow();
      if (typeof win?.close === "function") await win.close();
    } catch {
      /* browser environment */
    }
  };

  return (
    <header
      data-tauri-drag-region
      className="flex h-9 w-full shrink-0 items-center justify-between border-b border-line bg-[#0C0E0B] select-none text-xs"
    >
      {/* Left: Brand Identity */}
      <div className="flex items-center gap-3 pl-3 pointer-events-auto">
        <button
          type="button"
          onClick={() => setView("explorer")}
          className="flex items-center gap-2 hover:opacity-90 transition-opacity focus:outline-none"
          title="rAImy Solutions — Home"
        >
          <RaimyLogo size="sm" layout="horizontal" withTagline={false} />
        </button>
        <span className="hidden lg:inline-block h-3.5 w-px bg-line/80" />
        <span className="hidden lg:inline-block text-[10px] font-medium tracking-wider text-[#D6E7F3]/70 uppercase">
          Visual Computing &amp; Intelligent Hardware
        </span>
      </div>

      {/* Middle: Draggable center with project title */}
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 items-center justify-center px-4 text-center cursor-default"
      >
        <div data-tauri-drag-region className="flex items-center gap-2 truncate text-muted text-[11px]">
          {project ? (
            <>
              <span className="text-fg font-medium truncate">{locationName(project)}</span>
              <span className="text-line">•</span>
              <span className="font-mono text-[10px] text-muted/80 truncate">
                {project.kind === "linux" ? `${project.distro}:${project.path}` : project.path}
              </span>
            </>
          ) : (
            <span className="font-medium tracking-wide text-muted/90">
              {activeView === "processes"
                ? "Simulateur de Processus UNIX"
                : activeView === "environments"
                ? "Environnements & Diagnostics"
                : activeView === "settings"
                ? "Paramètres"
                : "Workspace Dashboard"}
            </span>
          )}
        </div>
      </div>

      {/* Right: Telemetry pill + Terminal toggle + Window controls */}
      <div className="flex items-center gap-1.5 pr-1 pointer-events-auto">
        {/* WSL Status Pill */}
        <button
          type="button"
          onClick={() => setView("environments")}
          title={`WSL Subsystem: ${activeDistroName ?? "No distro detected"}. Click to configure environments.`}
          className="hidden sm:flex items-center gap-1.5 rounded-[4px] border border-line bg-surface/80 px-2 py-0.5 text-[11px] text-[#D6E7F3] hover:border-accent/50 hover:bg-elevated transition-colors"
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              status?.available ? "bg-[#4ADE80] shadow-[0_0_6px_#4ADE80]" : "bg-warn shadow-[0_0_6px_#F59E0B]",
            )}
          />
          <span className="font-mono text-[10px] tracking-tight">
            {activeDistroName ? `WSL • ${activeDistroName}` : "WSL Standby"}
          </span>
        </button>

        {/* CPU/Memory Telemetry chip */}
        {host && (
          <button
            type="button"
            onClick={() => setView("processes")}
            title={`Host CPU: ${host.appCpuPercent.toFixed(1)}% | RAM: ${(host.appMemoryBytes / 1024 / 1024).toFixed(0)} MB. Click for process manager.`}
            className="hidden md:flex items-center gap-1.5 rounded-[4px] border border-line bg-surface/80 px-2 py-0.5 text-[11px] text-muted hover:border-accent/50 hover:text-fg transition-colors"
          >
            <Activity size={12} className="text-accent" />
            <span className="font-mono text-[10px]">
              {host.appCpuPercent.toFixed(0)}% CPU
            </span>
          </button>
        )}

        {/* Quick terminal toggle */}
        <button
          type="button"
          onClick={togglePanel}
          title={`Toggle Terminal (${formatShortcut(keys.get("view.togglePanel") ?? "Ctrl+Backquote")})`}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-[4px] transition-colors",
            panelVisible ? "bg-accent/15 text-accent" : "text-muted hover:bg-hover hover:text-fg",
          )}
        >
          <TerminalSquare size={14} />
        </button>

        <span className="mx-1 h-3.5 w-px bg-line/80" />

        {/* Window Controls */}
        <div className="flex items-center">
          <button
            type="button"
            onClick={handleMinimize}
            aria-label="Minimize"
            className="flex h-7 w-8 items-center justify-center text-muted hover:bg-hover hover:text-fg transition-colors"
          >
            <Minus size={12} />
          </button>
          <button
            type="button"
            onClick={handleMaximize}
            aria-label={isMaximized ? "Restore" : "Maximize"}
            className="flex h-7 w-8 items-center justify-center text-muted hover:bg-hover hover:text-fg transition-colors"
          >
            <Square size={10} className={isMaximized ? "scale-90" : undefined} />
          </button>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="flex h-7 w-8 items-center justify-center text-muted hover:bg-[#D6303A] hover:text-white transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </header>
  );
}
