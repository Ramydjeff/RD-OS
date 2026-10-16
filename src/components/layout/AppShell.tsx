// AppShell — the root layout: sidebar + main content area + terminal panel.
// Handles sidebar/panel resizing and routes activeView to the right page.

import { useCallback, useRef } from "react";
import {
  Activity,
  Boxes,
  FolderOpen,
  GitFork,
  Settings,
  TerminalSquare,
} from "lucide-react";
import { EnvironmentPage } from "@/components/environment/EnvironmentPage";
import { Explorer } from "@/components/explorer/Explorer";
import { FolderPicker } from "@/components/explorer/FolderPicker";
import { NewProjectDialog } from "@/components/explorer/NewProjectDialog";
import { ProcessesPage } from "@/components/processes/ProcessesPage";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { TitleBar } from "@/components/layout/TitleBar";
import { WorkspaceDashboard } from "@/components/layout/WorkspaceDashboard";
import { RaimyLogo } from "@/components/ui/RaimyLogo";
import { IconButton } from "@/components/ui/Button";
import { DialogHost } from "@/components/ui/DialogHost";
import { useShortcuts } from "@/hooks/useShortcuts";
import { useMonitorLoop } from "@/hooks/useMonitorLoop";
import { cn } from "@/lib/cn";
import { resolveBindings, formatShortcut } from "@/lib/shortcuts";
import { useSettings } from "@/store/settings";
import { useUi } from "@/store/ui";
import { useWorkspace, SIDEBAR_MIN, SIDEBAR_MAX, PANEL_MIN } from "@/store/workspace";
import type { ActiveView } from "@/types/ipc";

// ─── Activity bar ─────────────────────────────────────────────────────────────

interface NavItem {
  view: ActiveView;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { view: "explorer", label: "Explorer", icon: <FolderOpen size={20} /> },
  { view: "environments", label: "Environments", icon: <Boxes size={20} /> },
  { view: "processes", label: "Processus & Simulation", icon: <GitFork size={20} /> },
];

function ActivityBar() {
  const activeView = useWorkspace((s) => s.activeView);
  const setView = useWorkspace((s) => s.setView);
  const sidebarVisible = useWorkspace((s) => s.sidebarVisible);
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar);
  const panelVisible = useWorkspace((s) => s.panelVisible);
  const togglePanel = useWorkspace((s) => s.togglePanel);
  const shortcuts = useSettings((s) => s.settings.shortcuts);
  const keys = resolveBindings(shortcuts);

  return (
    <nav
      aria-label="Main navigation"
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-2"
    >
      {/* Brand Icon at the very top of ActivityBar */}
      <button
        type="button"
        onClick={() => {
          if (!sidebarVisible) toggleSidebar();
          setView("explorer");
        }}
        title="rAImy Solutions"
        className="mb-2 flex h-9 w-9 items-center justify-center rounded-md hover:bg-hover transition-colors focus:outline-none"
      >
        <RaimyLogo size="sm" layout="icon" animated={true} />
      </button>

      {NAV_ITEMS.map(({ view, label, icon }) => (
        <IconButton
          key={view}
          label={label}
          icon={icon}
          active={activeView === view}
          onClick={() => {
            if (view === "explorer" && !sidebarVisible) toggleSidebar();
            setView(view);
          }}
          className={cn(
            "h-10 w-10 relative transition-all",
            activeView === view && "text-[#D6303A] bg-active shadow-[inset_2px_0_0_#D6303A]",
          )}
        />
      ))}
      <span aria-hidden className="mx-auto my-1 w-6 border-t border-line" />
      <IconButton
        label={`Toggle terminal panel (${formatShortcut(keys.get("view.togglePanel") ?? "Ctrl+Backquote")})`}
        icon={<TerminalSquare size={20} />}
        active={panelVisible}
        onClick={togglePanel}
        className={cn("h-10 w-10", panelVisible && "text-[#D6303A]")}
      />
      <div className="flex-1" />
      <IconButton
        label={`Settings (${formatShortcut(keys.get("settings.open") ?? "Ctrl+Comma")})`}
        icon={<Settings size={20} />}
        active={activeView === "settings"}
        onClick={() => setView("settings")}
        className={cn(
          "h-10 w-10",
          activeView === "settings" && "text-[#D6303A] bg-active shadow-[inset_2px_0_0_#D6303A]",
        )}
      />
    </nav>
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
  const setSidebarWidth = useWorkspace((s) => s.setSidebarWidth);
  const panelVisible = useWorkspace((s) => s.panelVisible);
  const panelMaximized = useWorkspace((s) => s.panelMaximized);
  const panelHeight = useWorkspace((s) => s.panelHeight);
  const setPanelHeight = useWorkspace((s) => s.setPanelHeight);
  const openProject = useWorkspace((s) => s.openProject);

  const openProjectOpen = useUi((s) => s.openProjectOpen);
  const newProjectOpen = useUi((s) => s.newProjectOpen);
  const setOpenProjectOpen = useUi((s) => s.setOpenProjectOpen);
  const setNewProjectOpen = useUi((s) => s.setNewProjectOpen);

  // ── Sidebar drag ─────────────────────────────────────
  const sidebarDragging = useRef(false);
  const onSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sidebarDragging.current = true;
    const startX = e.clientX;
    const startW = useWorkspace.getState().sidebarWidth;

    function onMove(ev: MouseEvent) {
      if (!sidebarDragging.current) return;
      setSidebarWidth(startW + ev.clientX - startX);
    }
    function onUp() {
      sidebarDragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [setSidebarWidth]);

  // ── Panel drag ───────────────────────────────────────
  const panelDragging = useRef(false);
  const onPanelMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    panelDragging.current = true;
    const startY = e.clientY;
    const startH = useWorkspace.getState().panelHeight;

    function onMove(ev: MouseEvent) {
      if (!panelDragging.current) return;
      setPanelHeight(startH + startY - ev.clientY);
    }
    function onUp() {
      panelDragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [setPanelHeight]);

  const isExplorer = activeView === "explorer";
  const showSidebar = sidebarVisible && isExplorer && !panelMaximized;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg text-fg">
      {/* ── Custom Window Titlebar ────────────────────────── */}
      <TitleBar />

      {/* ── Main Workspace Content ────────────────────────── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Activity bar */}
        <ActivityBar />

        {/* Sidebar: only displayed for file tree / explorer */}
        {showSidebar && (
          <>
            <div
              className="flex min-h-0 flex-col overflow-hidden bg-surface"
              style={{ width: sidebarWidth, minWidth: SIDEBAR_MIN, maxWidth: SIDEBAR_MAX }}
            >
              <div className="min-h-0 flex-1 overflow-auto">
                <Explorer />
              </div>
            </div>

            {/* Sidebar resize handle */}
            <div
              role="separator"
              aria-label="Resize sidebar"
              aria-orientation="vertical"
              className="w-1 shrink-0 cursor-col-resize bg-line/0 hover:bg-accent/40 active:bg-accent/60 transition-colors"
              onMouseDown={onSidebarMouseDown}
            />
          </>
        )}

        {/* Main area: Full view for active feature + Terminal Panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Main workspace view */}
          {!panelMaximized && (
            <div className="min-h-0 flex-1 overflow-y-auto bg-bg order-1">
              {activeView === "explorer" && <WorkspaceDashboard />}
              {activeView === "processes" && <ProcessesPage />}
              {activeView === "environments" && <EnvironmentPage />}
              {activeView === "settings" && <SettingsPage />}
            </div>
          )}

          {/* Panel resize handle */}
          {panelVisible && !panelMaximized && (
            <div
              role="separator"
              aria-label="Resize terminal panel"
              aria-orientation="horizontal"
              className={cn(
                "h-1 shrink-0 cursor-row-resize bg-line/30 hover:bg-accent active:bg-accent transition-colors order-2",
              )}
              onMouseDown={onPanelMouseDown}
            />
          )}

          {/* Terminal panel */}
          {panelVisible && (
            <div
              className={cn("shrink-0 border-t border-line order-3", panelMaximized && "flex-1")}
              style={panelMaximized ? undefined : { height: Math.max(PANEL_MIN, panelHeight) }}
            >
              <TerminalPanel />
            </div>
          )}
        </div>
      </div>

      {/* Dialogs & Toasts */}
      <DialogHost />

      {openProjectOpen && (
        <FolderPicker
          title="Open project"
          confirmLabel="Open project"
          onClose={() => setOpenProjectOpen(false)}
          onSelect={(loc) => {
            openProject(loc);
            setOpenProjectOpen(false);
          }}
        />
      )}

      {newProjectOpen && (
        <NewProjectDialog onClose={() => setNewProjectOpen(false)} />
      )}
    </div>
  );
}
