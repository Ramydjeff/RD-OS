// AppShell — title bar, activity bar, explorer sidebar, main view, terminal
// panel and status bar. Heavy views are loaded on first use.

import { lazy, Suspense, useCallback, useMemo } from "react";
import { Boxes, Files, GitFork, LoaderCircle, Settings, SquareTerminal } from "lucide-react";
import { Explorer } from "@/components/explorer/Explorer";
import { EditorArea } from "@/components/explorer/FileEditor";
import { FolderPicker } from "@/components/explorer/FolderPicker";
import { NewProjectDialog } from "@/components/explorer/NewProjectDialog";
import { StatusBar } from "@/components/layout/StatusBar";
import { TitleBar } from "@/components/layout/TitleBar";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { DialogHost } from "@/components/ui/DialogHost";
import { useMonitorLoop } from "@/hooks/useMonitorLoop";
import { useShortcuts } from "@/hooks/useShortcuts";
import { cn } from "@/lib/cn";
import { formatShortcut, resolveBindings } from "@/lib/shortcuts";
import { useSettings } from "@/store/settings";
import { useUi } from "@/store/ui";
import { PANEL_MIN, SIDEBAR_MAX, SIDEBAR_MIN, useWorkspace } from "@/store/workspace";
import type { ActiveView } from "@/types/ipc";

const ProcessesPage = lazy(() => import("@/components/processes/ProcessesPage").then((m) => ({ default: m.ProcessesPage })));
const EnvironmentPage = lazy(() => import("@/components/environment/EnvironmentPage").then((m) => ({ default: m.EnvironmentPage })));
const SettingsPage = lazy(() => import("@/components/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));

// ─── Activity bar ─────────────────────────────────────────────────────────────

interface NavItem {
  view: ActiveView;
  label: string;
  title: string;
  Icon: typeof Files;
}

const NAV_ITEMS: NavItem[] = [
  { view: "explorer", label: "Fichiers", title: "Explorateur de fichiers", Icon: Files },
  { view: "processes", label: "Processus", title: "Simulateur de processus et fichiers C", Icon: GitFork },
  { view: "environments", label: "WSL", title: "Environnements WSL et diagnostic", Icon: Boxes },
];

function NavButton({
  label,
  title,
  Icon,
  active,
  toggle = false,
  onClick,
}: {
  label: string;
  title: string;
  Icon: typeof Files;
  active: boolean;
  /** A switch (terminal panel), not a view: no "current page" marker. */
  toggle?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-current={active && !toggle ? "page" : undefined}
      aria-pressed={toggle ? active : undefined}
      className={cn(
        "group relative flex h-[50px] w-[56px] flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] transition-colors duration-150",
        active ? "text-fg" : "text-muted hover:bg-hover hover:text-fg",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute -left-[6px] top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-accent transition-opacity duration-150",
          active && !toggle ? "opacity-100" : "opacity-0",
        )}
      />
      <Icon size={19} strokeWidth={active ? 2 : 1.75} className={active && !toggle ? "text-accent" : undefined} />
      <span className="text-[10px] font-medium leading-none tracking-[0.01em]">{label}</span>
    </button>
  );
}

function ActivityBar() {
  const activeView = useWorkspace((s) => s.activeView);
  const setView = useWorkspace((s) => s.setView);
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar);
  const panelVisible = useWorkspace((s) => s.panelVisible);
  const togglePanel = useWorkspace((s) => s.togglePanel);
  const shortcuts = useSettings((s) => s.settings.shortcuts);
  const keys = useMemo(() => resolveBindings(shortcuts), [shortcuts]);

  return (
    <nav aria-label="Navigation principale" className="flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-2">
      {NAV_ITEMS.map(({ view, label, title, Icon }) => (
        <NavButton
          key={view}
          label={label}
          title={title}
          Icon={Icon}
          active={activeView === view}
          onClick={() => {
            // A second click on "Fichiers" folds the sidebar away, like in VS Code
            // (setView always shows it again).
            if (view === "explorer" && activeView === "explorer") toggleSidebar();
            else setView(view);
          }}
        />
      ))}
      <div className="flex-1" />
      <NavButton
        label="Terminal"
        title={`Afficher ou masquer le terminal (${formatShortcut(keys.get("view.togglePanel") ?? "Ctrl+Backquote")})`}
        Icon={SquareTerminal}
        active={panelVisible}
        toggle
        onClick={togglePanel}
      />
      <NavButton
        label="Réglages"
        title={`Paramètres (${formatShortcut(keys.get("settings.open") ?? "Ctrl+Comma")})`}
        Icon={Settings}
        active={activeView === "settings"}
        onClick={() => setView("settings")}
      />
    </nav>
  );
}

// ─── Resizing ─────────────────────────────────────────────────────────────────

/** Drag helper: one store update per animation frame, whatever the mouse rate. */
function useDrag(onDelta: (start: number, delta: number) => void, axis: "x" | "y", start: () => number) {
  return useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      const origin = axis === "x" ? e.clientX : e.clientY;
      const initial = start();
      let raf = 0;
      let last = origin;
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      const move = (ev: PointerEvent) => {
        last = axis === "x" ? ev.clientX : ev.clientY;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          onDelta(initial, last - origin);
        });
      };
      const up = (ev: PointerEvent) => {
        cancelAnimationFrame(raf);
        onDelta(initial, last - origin);
        target.releasePointerCapture(ev.pointerId);
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", up);
    },
    [onDelta, axis, start],
  );
}

function ViewFallback() {
  return (
    <div className="flex h-full items-center justify-center text-muted">
      <LoaderCircle size={18} className="animate-spin" />
    </div>
  );
}

// ─── App shell ────────────────────────────────────────────────────────────────

export function AppShell() {
  // Global hooks wired once here.
  useShortcuts();
  useMonitorLoop();

  const activeView = useWorkspace((s) => s.activeView);
  const sidebarVisible = useWorkspace((s) => s.sidebarVisible);
  const sidebarWidth = useWorkspace((s) => s.sidebarWidth);
  const panelVisible = useWorkspace((s) => s.panelVisible);
  const panelMaximized = useWorkspace((s) => s.panelMaximized);
  const panelHeight = useWorkspace((s) => s.panelHeight);
  const openProject = useWorkspace((s) => s.openProject);

  const openProjectOpen = useUi((s) => s.openProjectOpen);
  const newProjectOpen = useUi((s) => s.newProjectOpen);
  const setOpenProjectOpen = useUi((s) => s.setOpenProjectOpen);
  const setNewProjectOpen = useUi((s) => s.setNewProjectOpen);

  const onSidebarDrag = useDrag(
    useCallback((start, d) => useWorkspace.getState().setSidebarWidth(start + d), []),
    "x",
    useCallback(() => useWorkspace.getState().sidebarWidth, []),
  );
  const onPanelDrag = useDrag(
    useCallback((start, d) => useWorkspace.getState().setPanelHeight(start - d), []),
    "y",
    useCallback(() => useWorkspace.getState().panelHeight, []),
  );

  const showSidebar = sidebarVisible && activeView === "explorer" && !panelMaximized;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg text-fg">
      <TitleBar />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ActivityBar />

        {showSidebar && (
          <>
            <aside
              aria-label="Explorateur"
              className="flex min-h-0 shrink-0 flex-col overflow-hidden bg-surface"
              style={{ width: sidebarWidth, minWidth: SIDEBAR_MIN, maxWidth: SIDEBAR_MAX }}
            >
              <Explorer />
            </aside>
            <div className="relative w-px shrink-0 bg-line">
              <div
                role="separator"
                aria-label="Redimensionner la barre latérale"
                aria-orientation="vertical"
                onPointerDown={onSidebarDrag}
                className="absolute inset-y-0 -left-[3px] z-10 w-[7px] cursor-col-resize transition-colors hover:bg-accent/30 active:bg-accent/50"
              />
            </div>
          </>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          {!panelMaximized && (
            <div className="min-h-0 flex-1 overflow-hidden">
              {activeView === "explorer" ? (
                <EditorArea />
              ) : (
                <div className="h-full overflow-y-auto">
                  <Suspense fallback={<ViewFallback />}>
                    {activeView === "processes" && <ProcessesPage />}
                    {activeView === "environments" && <EnvironmentPage />}
                    {activeView === "settings" && <SettingsPage />}
                  </Suspense>
                </div>
              )}
            </div>
          )}

          {panelVisible && !panelMaximized && (
            <div className="relative h-px shrink-0 bg-line">
              <div
                role="separator"
                aria-label="Redimensionner le terminal"
                aria-orientation="horizontal"
                onPointerDown={onPanelDrag}
                className="absolute inset-x-0 -top-[3px] z-10 h-[7px] cursor-row-resize transition-colors hover:bg-accent/30 active:bg-accent/50"
              />
            </div>
          )}

          {panelVisible && (
            <div
              className={cn("shrink-0", panelMaximized && "flex-1")}
              style={panelMaximized ? undefined : { height: Math.max(PANEL_MIN, panelHeight) }}
            >
              <TerminalPanel />
            </div>
          )}
        </main>
      </div>

      <StatusBar />

      <DialogHost />
      <CommandPalette />

      {openProjectOpen && (
        <FolderPicker
          title="Ouvrir un dossier"
          confirmLabel="Ouvrir ce dossier"
          onClose={() => setOpenProjectOpen(false)}
          onSelect={(loc) => {
            openProject(loc);
            setOpenProjectOpen(false);
          }}
        />
      )}

      {newProjectOpen && <NewProjectDialog onClose={() => setNewProjectOpen(false)} />}
    </div>
  );
}
