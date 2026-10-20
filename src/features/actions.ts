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
import { useDesktop } from "@/store/desktop";
import { useEditor } from "@/store/editor";
import { activeLeaf, activeTab, activeTerminalId, useTerminals } from "@/store/terminals";
import { useSettings } from "@/store/settings";
import { useProcessesView } from "@/store/processesView";
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
      else if (s) toast("success", `${s.distros.length} distribution${s.distros.length > 1 ? "s" : ""} WSL détectée${s.distros.length > 1 ? "s" : ""}.`);
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

function showProcesses(tab: "cfiles" | "simulator" | "metrics") {
  useProcessesView.getState().setTab(tab);
  useWorkspace.getState().setView("processes");
}

export function buildActions(): AppAction[] {
  const ws = useWorkspace.getState();
  const wslStatus = useWsl.getState().status;
  const distros = usableDistros(wslStatus);
  const project = ws.project;
  const running = activeIsRunning();
  const term = hasTerminal();
  const editor = useEditor.getState();
  const activeFile = editor.files.find((f) => f.key === editor.activeKey);

  const actions: AppAction[] = [
    { id: "terminal.new", title: "Nouveau terminal", group: "Terminal", shortcutId: "terminal.new", enabled: true, run: () => void openTerminal() },
    {
      id: "terminal.newHome",
      title: "Nouveau terminal dans le dossier personnel Linux",
      group: "Terminal",
      keywords: "home",
      enabled: true,
      run: () => void openTerminal({ cwd: null }),
    },
    {
      id: "terminal.newInProject",
      title: "Ouvrir le projet dans un terminal",
      group: "Terminal",
      keywords: "projet dossier",
      enabled: project !== null,
      run: () => void openTerminal({ cwd: project }),
    },
    {
      id: "terminal.splitRight",
      title: "Diviser le terminal côte à côte",
      group: "Terminal",
      keywords: "split",
      enabled: term,
      run: () => void openTerminal({ split: "row" }),
    },
    {
      id: "terminal.splitDown",
      title: "Diviser le terminal en hauteur",
      group: "Terminal",
      keywords: "split",
      enabled: term,
      run: () => void openTerminal({ split: "col" }),
    },
    { id: "terminal.close", title: "Fermer le terminal actif", group: "Terminal", shortcutId: "terminal.close", enabled: term, run: () => void closeActive() },
    {
      id: "terminal.closeTab",
      title: "Fermer l'onglet de terminal",
      group: "Terminal",
      enabled: activeTab() !== null,
      run: () => {
        const t = activeTab();
        if (t) void closeTab(t.id);
      },
    },
    { id: "terminal.search", title: "Rechercher dans la sortie du terminal", group: "Terminal", shortcutId: "terminal.search", enabled: term, run: () => openSearch() },
    {
      id: "terminal.clear",
      title: "Effacer le terminal",
      group: "Terminal",
      shortcutId: "terminal.clear",
      keywords: "clear",
      enabled: term,
      run: () => activeController()?.clear(),
    },
    {
      id: "terminal.restart",
      title: "Redémarrer la session du terminal",
      group: "Terminal",
      enabled: term,
      run: () => {
        const id = activeTerminalId();
        if (id) void restartTerminal(id);
      },
    },
    {
      id: "terminal.terminate",
      title: "Arrêter la session du terminal",
      group: "Terminal",
      keywords: "kill",
      enabled: running,
      run: () => {
        const id = activeTerminalId();
        if (id) void terminateTerminal(id);
      },
    },
    {
      id: "file.save",
      title: activeFile ? `Enregistrer ${activeFile.name}` : "Enregistrer le fichier",
      group: "Fichier",
      enabled: !!activeFile && activeFile.status === "ready" && activeFile.content !== activeFile.saved,
      run: () => {
        if (activeFile) void editor.save(activeFile.key);
      },
    },
    {
      id: "file.close",
      title: activeFile ? `Fermer ${activeFile.name}` : "Fermer le fichier",
      group: "Fichier",
      enabled: !!activeFile,
      run: () => {
        if (activeFile) void editor.close(activeFile.key);
      },
    },
    { id: "view.home", title: "Accueil", group: "Affichage", keywords: "home tableau de bord", enabled: true, run: () => {
      useEditor.getState().setActive(null);
      useWorkspace.getState().setView("explorer");
    } },
    { id: "view.explorer", title: "Afficher l'explorateur", group: "Affichage", keywords: "fichiers", enabled: true, run: () => useWorkspace.getState().setView("explorer") },
    { id: "view.simulator", title: "Simulateur de processus", group: "Affichage", keywords: "fork wait processus c", enabled: true, run: () => showProcesses("simulator") },
    { id: "view.cfiles", title: "Mes fichiers C", group: "Affichage", keywords: "c programmes tp", enabled: true, run: () => showProcesses("cfiles") },
    { id: "view.metrics", title: "Ressources système", group: "Affichage", keywords: "cpu mémoire métriques", enabled: true, run: () => showProcesses("metrics") },
    { id: "view.environments", title: "Environnements WSL", group: "Affichage", keywords: "wsl distributions diagnostic", enabled: true, run: () => useWorkspace.getState().setView("environments") },
    { id: "settings.open", title: "Paramètres", group: "Affichage", shortcutId: "settings.open", keywords: "preferences options", enabled: true, run: () => useWorkspace.getState().setView("settings") },
    { id: "view.togglePanel", title: "Afficher ou masquer le terminal", group: "Affichage", shortcutId: "view.togglePanel", enabled: true, run: () => useWorkspace.getState().togglePanel() },
    {
      id: "view.maximizePanel",
      title: ws.panelMaximized ? "Restaurer la taille du terminal" : "Agrandir le terminal",
      group: "Affichage",
      shortcutId: "view.maximizePanel",
      enabled: true,
      run: () => useWorkspace.getState().toggleMaximize(),
    },
    { id: "view.toggleSidebar", title: "Afficher ou masquer la barre latérale", group: "Affichage", shortcutId: "view.toggleSidebar", enabled: true, run: () => useWorkspace.getState().toggleSidebar() },
    { id: "theme.toggle", title: "Basculer thème clair / sombre", group: "Affichage", keywords: "apparence dark light", enabled: true, run: () => toggleTheme() },
    { id: "desktop.show", title: "Revenir au bureau rAImy OS", group: "Affichage", keywords: "desktop bureau", enabled: true, run: () => useDesktop.getState().setShellMode("desktop") },
    { id: "palette.open", title: "Palette de commandes", group: "Affichage", shortcutId: "palette.open", enabled: true, run: () => undefined },
    {
      id: "project.open",
      title: "Ouvrir un dossier…",
      group: "Projet",
      keywords: "projet folder directory",
      enabled: true,
      run: () => useUi.getState().setOpenProjectOpen(true),
    },
    {
      id: "project.new",
      title: "Nouveau projet à partir d'un modèle…",
      group: "Projet",
      keywords: "python cpp node opencv template",
      enabled: true,
      run: () => useUi.getState().setNewProjectOpen(true),
    },
    {
      id: "project.close",
      title: "Fermer le projet",
      group: "Projet",
      enabled: project !== null,
      run: () => {
        if (project) void useEditor.getState().closeProject(project).then((ok) => ok && useWorkspace.getState().closeProject());
      },
    },
    { id: "env.refresh", title: "Actualiser l'état de WSL", group: "Environnement", keywords: "wsl distributions", enabled: true, run: () => refreshEnvironment() },
  ];

  for (const d of distros) {
    actions.push({
      id: `env.use.${d.name}`,
      title: `Utiliser la distribution ${d.name}`,
      group: "Environnement",
      enabled: ws.selectedDistro !== d.name,
      run: () => {
        useWorkspace.getState().setSelectedDistro(d.name);
        toast("info", `Les nouveaux terminaux s'ouvriront dans ${d.name}.`);
      },
    });
    actions.push({
      id: `terminal.newIn.${d.name}`,
      title: `Nouveau terminal dans ${d.name}`,
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
