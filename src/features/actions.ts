// The single list of things a user can do. Shortcuts, the command palette and
// toolbars all dispatch through here so they can never drift apart.

import {
  activeController,
  closeActive,
  closeTab,
  openSearch,
  openTerminal,
  reportError,
  restartTerminal,
  terminateTerminal,
} from "@/features/terminalActions";
import { activeLeaf, activeTab, activeTerminalId, useTerminals } from "@/store/terminals";
import { useSettings } from "@/store/settings";
import { useTheme } from "@/store/theme";
import { toast, useUi } from "@/store/ui";
import { usableDistros, useWsl } from "@/store/wsl";
import { useWorkspace } from "@/store/workspace";

export interface AppAction {
  id: string;
  title: string;
  group: string;
  /** Id in the shortcut table, when the action has a configurable binding. */
  shortcutId?: string;
  keywords?: string;
  enabled: boolean;
  run: () => void | Promise<void>;
}

function hasTerminal(): boolean {
  return activeLeaf() !== null;
}

function activeIsRunning(): boolean {
  const id = activeTerminalId();
  return id ? useTerminals.getState().meta[id]?.state === "running" : false;
}

export function refreshEnvironment(): void {
  void useWsl
    .getState()
    .refresh()
    .then((s) => {
      if (s?.problem) toast("error", s.problem.message);
      else if (s) toast("success", `Found ${s.distros.length} WSL distribution${s.distros.length === 1 ? "" : "s"}.`);
    });
}

export function toggleTheme(): void {
  const current = useTheme.getState().resolved;
  void useSettings
    .getState()
    .update((s) => ({ ...s, theme: current === "dark" ? "light" : "dark" }))
    .then((err) => {
      if (err) toast("error", err);
      else useTheme.getState().setSetting(useSettings.getState().settings.theme);
    });
}

export function buildActions(): AppAction[] {
  const ws = useWorkspace.getState();
  const wslStatus = useWsl.getState().status;
  const distros = usableDistros(wslStatus);
  const project = ws.project;
  const running = activeIsRunning();
  const term = hasTerminal();

  const actions: AppAction[] = [
    { id: "terminal.new", title: "New terminal", group: "Terminal", shortcutId: "terminal.new", enabled: true, run: () => void openTerminal() },
    {
      id: "terminal.newHome",
      title: "New terminal in Linux home",
      group: "Terminal",
      enabled: true,
      run: () => void openTerminal({ cwd: null }),
    },
    {
      id: "terminal.newInProject",
      title: "Open project in terminal",
      group: "Terminal",
      keywords: "project folder directory",
      enabled: project !== null,
      run: () => void openTerminal({ cwd: project }),
    },
    {
      id: "terminal.splitRight",
      title: "Split terminal side by side",
      group: "Terminal",
      enabled: term,
      run: () => void openTerminal({ split: "row" }),
    },
    {
      id: "terminal.splitDown",
      title: "Split terminal stacked",
      group: "Terminal",
      enabled: term,
      run: () => void openTerminal({ split: "col" }),
    },
    { id: "terminal.close", title: "Close active terminal", group: "Terminal", shortcutId: "terminal.close", enabled: term, run: () => void closeActive() },
    {
      id: "terminal.closeTab",
      title: "Close terminal tab",
      group: "Terminal",
      enabled: activeTab() !== null,
      run: () => {
        const t = activeTab();
        if (t) void closeTab(t.id);
      },
    },
    { id: "terminal.search", title: "Search terminal output", group: "Terminal", shortcutId: "terminal.search", enabled: term, run: () => openSearch() },
    {
      id: "terminal.clear",
      title: "Clear visible terminal",
      group: "Terminal",
      shortcutId: "terminal.clear",
      enabled: term,
      run: () => activeController()?.clear(),
    },
    {
      id: "terminal.restart",
      title: "Restart terminal session",
      group: "Terminal",
      enabled: term,
      run: () => {
        const id = activeTerminalId();
        if (id) void restartTerminal(id);
      },
    },
    {
      id: "terminal.terminate",
      title: "Terminate terminal session",
      group: "Terminal",
      enabled: running,
      run: () => {
        const id = activeTerminalId();
        if (id) void terminateTerminal(id);
      },
    },
    {
      id: "view.maximizePanel",
      title: ws.panelMaximized ? "Restore terminal panel size" : "Maximize terminal panel",
      group: "View",
      shortcutId: "view.maximizePanel",
      enabled: true,
      run: () => useWorkspace.getState().toggleMaximize(),
    },
    { id: "view.togglePanel", title: "Toggle terminal panel", group: "View", shortcutId: "view.togglePanel", enabled: true, run: () => useWorkspace.getState().togglePanel() },
    { id: "view.toggleSidebar", title: "Toggle sidebar", group: "View", shortcutId: "view.toggleSidebar", enabled: true, run: () => useWorkspace.getState().toggleSidebar() },
    { id: "view.explorer", title: "Show explorer", group: "View", enabled: true, run: () => useWorkspace.getState().setView("explorer") },
    { id: "view.environments", title: "Show environments", group: "View", enabled: true, run: () => useWorkspace.getState().setView("environments") },
    { id: "view.processes", title: "Show processes and resources", group: "View", enabled: true, run: () => useWorkspace.getState().setView("processes") },
    { id: "settings.open", title: "Open settings", group: "View", shortcutId: "settings.open", enabled: true, run: () => useWorkspace.getState().setView("settings") },
    { id: "theme.toggle", title: "Toggle light/dark theme", group: "View", keywords: "appearance", enabled: true, run: () => toggleTheme() },
    { id: "palette.open", title: "Command palette", group: "View", shortcutId: "palette.open", enabled: false, run: () => undefined },
    {
      id: "project.open",
      title: "Open project...",
      group: "Project",
      keywords: "folder directory",
      enabled: true,
      run: () => useUi.getState().setOpenProjectOpen(true),
    },
    {
      id: "project.new",
      title: "New project from template...",
      group: "Project",
      keywords: "python cpp node opencv",
      enabled: true,
      run: () => useUi.getState().setNewProjectOpen(true),
    },
    {
      id: "project.close",
      title: "Close project",
      group: "Project",
      enabled: project !== null,
      run: () => useWorkspace.getState().closeProject(),
    },
    { id: "env.refresh", title: "Refresh environment status", group: "Environment", keywords: "wsl distributions", enabled: true, run: () => refreshEnvironment() },
  ];

  for (const d of distros) {
    actions.push({
      id: `env.use.${d.name}`,
      title: `Use distribution: ${d.name}`,
      group: "Environment",
      enabled: ws.selectedDistro !== d.name,
      run: () => {
        useWorkspace.getState().setSelectedDistro(d.name);
        toast("info", `New terminals will open in ${d.name}.`);
      },
    });
    actions.push({
      id: `terminal.newIn.${d.name}`,
      title: `New terminal in ${d.name}`,
      group: "Terminal",
      enabled: true,
      run: () => void openTerminal({ distro: d.name, cwd: project?.kind === "linux" && project.distro !== d.name ? null : undefined }),
    });
  }
  return actions;
}

export function runAction(id: string): void {
  const action = buildActions().find((a) => a.id === id);
  if (!action || !action.enabled) return;
  if (id === "palette.open") {
    const ui = useUi.getState();
    ui.setPaletteOpen(!ui.paletteOpen);
    return;
  }
  try {
    const r = action.run();
    if (r instanceof Promise) r.catch((e) => void reportError(action.title, e));
  } catch (e) {
    void reportError(action.title, e);
  }
}
