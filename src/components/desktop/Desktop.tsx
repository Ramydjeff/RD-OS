// rAImy OS: the desktop shell. Layers, bottom to top: wallpaper, icons,
// windows, taskbar, tray panels / start menu / launcher, dialogs and toasts.

import { useEffect, useState } from "react";
import { DesktopClock } from "@/components/desktop/DesktopClock";
import { DesktopIcons } from "@/components/desktop/DesktopIcons";
import { Launcher } from "@/components/desktop/Launcher";
import { StartMenu } from "@/components/desktop/StartMenu";
import { Taskbar } from "@/components/desktop/Taskbar";
import { CalendarPanel, QuickSettings } from "@/components/desktop/TrayPanels";
import { Wallpaper } from "@/components/desktop/Wallpaper";
import { SnapPreview, WindowFrame } from "@/components/desktop/WindowFrame";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { DialogHost } from "@/components/ui/DialogHost";
import { RaimyIcon, RaimyWordmark } from "@/components/ui/RaimyLogo";
import { toggleFullscreen } from "@/features/desktopActions";
import { openTerminal } from "@/features/terminalActions";
import { useMonitorLoop } from "@/hooks/useMonitorLoop";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useAgent } from "@/store/agent";
import { TASKBAR_HEIGHT, useDesktop, type AppId } from "@/store/desktop";
import { useTerminals } from "@/store/terminals";
import { useUi } from "@/store/ui";
import { useWinApps } from "@/store/winapps";
import { useWorkspace } from "@/store/workspace";
import "@/styles/desktop.css";

const VIEW_TO_APP: Partial<Record<string, AppId>> = {
  environments: "environments",
  processes: "simulator",
  settings: "settings",
};

/**
 * The existing pages navigate with `useWorkspace` (setView, panel toggles).
 * On the desktop those calls open or hide the matching windows instead.
 */
function useWorkspaceBridge() {
  useEffect(() => {
    const d = () => useDesktop.getState();
    const terminalWindow = () => d().windows.find((w) => w.app === "terminal" && w.phase !== "closing");

    const offWs = useWorkspace.subscribe((s, p) => {
      if (s.activeView !== p.activeView) {
        const app = VIEW_TO_APP[s.activeView];
        if (app) d().openApp(app);
      }
      if (s.panelVisible !== p.panelVisible) {
        const w = terminalWindow();
        if (s.panelVisible && (!w || w.minimized)) d().openApp("terminal");
        if (!s.panelVisible && w && !w.minimized) d().minimize(w.id);
      }
    });
    // A new terminal tab (from anywhere) brings the Terminal window forward.
    const offTerm = useTerminals.subscribe((s, p) => {
      if (s.tabs.length > p.tabs.length) d().openApp("terminal");
    });
    // The terminal panel is "visible" exactly when its window is on screen.
    const offDesk = useDesktop.subscribe((s) => {
      const w = s.windows.find((x) => x.app === "terminal" && x.phase !== "closing");
      const visible = !!w && !w.minimized;
      if (useWorkspace.getState().panelVisible !== visible) useWorkspace.getState().setPanelVisible(visible);
    });
    return () => {
      offWs();
      offTerm();
      offDesk();
    };
  }, []);
}

function useDesktopKeys() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.type !== "keydown" || e.isComposing) return;
      const d = useDesktop.getState();
      const focused = d.windows.find((w) => w.id === d.focusedId);
      const ctrlAlt = e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey;
      const ctrlShift = e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey;
      let handled = true;
      if (ctrlShift && e.code === "Space") {
        if (d.overlay === "launcher") d.setOverlay(null);
        else d.openLauncher();
      } else if (ctrlShift && e.code === "KeyA") d.openApp("agent");
      else if (ctrlAlt && e.code === "KeyT") {
        const hasTabs = useTerminals.getState().tabs.length > 0;
        d.openApp("terminal");
        if (!hasTabs) void openTerminal();
      } else if (ctrlAlt && e.code === "KeyE") d.openApp("files", { newWindow: true });
      else if (ctrlAlt && e.code === "KeyC") d.openApp("studio");
      else if (ctrlAlt && e.code === "KeyG") d.openApp("guide");
      else if (ctrlAlt && e.code === "KeyD") d.showDesktop();
      else if (ctrlAlt && e.code === "KeyW" && focused) d.close(focused.id);
      else if (ctrlAlt && e.code === "ArrowLeft" && focused) d.setMode(focused.id, "left");
      else if (ctrlAlt && e.code === "ArrowRight" && focused) d.setMode(focused.id, "right");
      else if (ctrlAlt && e.code === "ArrowUp" && focused) d.setMode(focused.id, "maximized");
      else if (ctrlAlt && e.code === "ArrowDown" && focused) {
        if (focused.mode !== "normal") d.setMode(focused.id, "normal");
        else d.minimize(focused.id);
      } else if (ctrlAlt && e.code === "PageDown") d.cycle(1);
      else if (ctrlAlt && e.code === "PageUp") d.cycle(-1);
      else if (!e.ctrlKey && !e.altKey && !e.shiftKey && e.code === "F11") void toggleFullscreen();
      else if (e.code === "Escape" && d.overlay && !document.querySelector('[role="dialog"][aria-modal="true"]')) d.setOverlay(null);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);
}

function useArea() {
  useEffect(() => {
    const update = () => useDesktop.getState().setArea({ w: window.innerWidth, h: Math.max(320, window.innerHeight - TASKBAR_HEIGHT) });
    update();
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
}

function BootSplash() {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGone(true), 1400);
    return () => clearTimeout(t);
  }, []);
  if (gone) return null;
  return (
    <div className="boot pointer-events-none absolute inset-0 z-[80] flex flex-col items-center justify-center gap-6 bg-[#0c0e0b]">
      <div className="boot-mark flex flex-col items-center gap-5">
        <RaimyIcon size={84} />
        <RaimyWordmark className="text-[30px]" />
      </div>
      <div className="boot-bar h-[3px] w-44 overflow-hidden rounded-full bg-white/10">
        <span className="block h-full origin-left rounded-full bg-[#f43f52]" />
      </div>
      <p className="font-mono text-[10.5px] uppercase tracking-[0.3em] text-white/40">rAImy OS</p>
    </div>
  );
}

export function Desktop() {
  useShortcuts();
  useMonitorLoop();
  useWorkspaceBridge();
  useDesktopKeys();
  useArea();

  const windows = useDesktop((s) => s.windows);
  const overlay = useDesktop((s) => s.overlay);
  const wallpaper = useDesktop((s) => s.wallpaper);
  const onboarded = useDesktop((s) => s.onboarded);
  const showClock = useDesktop((s) => s.showClock);

  useEffect(() => {
    void useWinApps.getState().ensure();
    void useAgent.getState().loadStatus();
    // The command palette's "open" flag is shared with Workspace mode.
    useUi.getState().setPaletteOpen(false);
  }, []);

  // First start: open the welcome guide once.
  useEffect(() => {
    if (onboarded) return;
    const t = setTimeout(() => {
      useDesktop.getState().openApp("guide", { args: { section: "bienvenue" } });
      useDesktop.getState().setOnboarded();
    }, 1500);
    return () => clearTimeout(t);
  }, [onboarded]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg text-fg" style={{ ["--taskbar-h" as string]: `${TASKBAR_HEIGHT}px` }}>
      <Wallpaper id={wallpaper} />
      {showClock && <DesktopClock />}
      <DesktopIcons />

      {/* Windows: their own stacking context, so z-indexes never reach the menus above. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 isolate z-10" style={{ bottom: TASKBAR_HEIGHT }}>
        <SnapPreview />
        {windows.map((w) => (
          <WindowFrame key={w.id} win={w} />
        ))}
      </div>

      {overlay && overlay !== "launcher" && (
        <div className="absolute inset-x-0 top-0 z-[35]" style={{ bottom: TASKBAR_HEIGHT }} onPointerDown={() => useDesktop.getState().setOverlay(null)} />
      )}
      <Taskbar />
      {overlay === "start" && <StartMenu />}
      {overlay === "quick" && <QuickSettings />}
      {overlay === "calendar" && <CalendarPanel />}
      {overlay === "launcher" && <Launcher />}

      <CommandPalette />
      <DialogHost />
      <BootSplash />
    </div>
  );
}
