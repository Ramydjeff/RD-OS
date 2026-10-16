import { create } from "zustand";
import { ipc } from "@/lib/ipc";
import { locationKey, locationName } from "@/lib/paths";
import type { ActiveView, Location, RecentProject, WorkspaceState } from "@/types/ipc";

const MAX_RECENT = 12;

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 560;
export const PANEL_MIN = 140;

interface WorkspaceStore {
  loaded: boolean;
  warning: string | null;
  activeView: ActiveView;
  sidebarVisible: boolean;
  sidebarWidth: number;
  panelVisible: boolean;
  panelHeight: number;
  /** Terminal panel fills the main area. Not persisted. */
  panelMaximized: boolean;
  project: Location | null;
  recentProjects: RecentProject[];
  selectedDistro: string | null;
  showHiddenFiles: boolean;

  load: () => Promise<void>;
  setView: (v: ActiveView) => void;
  toggleSidebar: () => void;
  setSidebarVisible: (v: boolean) => void;
  setSidebarWidth: (w: number) => void;
  togglePanel: () => void;
  setPanelVisible: (v: boolean) => void;
  setPanelHeight: (h: number) => void;
  toggleMaximize: () => void;
  openProject: (loc: Location) => void;
  closeProject: () => void;
  forgetRecent: (loc: Location) => void;
  setSelectedDistro: (name: string | null) => void;
  toggleHidden: () => void;
}

export const useWorkspace = create<WorkspaceStore>((set, get) => ({
  loaded: false,
  warning: null,
  activeView: "explorer",
  sidebarVisible: true,
  sidebarWidth: 280,
  panelVisible: true,
  panelHeight: 340,
  panelMaximized: false,
  project: null,
  recentProjects: [],
  selectedDistro: null,
  showHiddenFiles: false,

  load: async () => {
    try {
      const { value, warning } = await ipc.stateLoad();
      const view = value.layout.activeView === "terminal" ? "explorer" : value.layout.activeView;
      set({
        loaded: true,
        warning,
        activeView: view,
        sidebarVisible: value.layout.sidebarVisible,
        sidebarWidth: value.layout.sidebarWidth,
        panelVisible: value.layout.panelVisible,
        panelHeight: value.layout.panelHeight,
        recentProjects: value.recentProjects,
        project: null,
        selectedDistro: value.selectedDistro,
        showHiddenFiles: value.showHiddenFiles,
      });
      // `lastProject` is only restored when the startup setting asks for it.
      lastProjectFromDisk = value.lastProject;
    } catch {
      set({ loaded: true });
    }
  },
  setView: (activeView) => set({ activeView, sidebarVisible: true }),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible }),
  setSidebarWidth: (w) => set({ sidebarWidth: Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w))) }),
  togglePanel: () => set((s) => ({ panelVisible: !s.panelVisible, panelMaximized: s.panelVisible ? false : s.panelMaximized })),
  setPanelVisible: (panelVisible) => set({ panelVisible }),
  setPanelHeight: (h) => set({ panelHeight: Math.round(Math.max(PANEL_MIN, h)) }),
  toggleMaximize: () => set((s) => ({ panelMaximized: !s.panelMaximized, panelVisible: true })),
  openProject: (loc) => {
    const entry: RecentProject = { location: loc, name: locationName(loc), openedAt: Date.now() };
    const key = locationKey(loc);
    const recents = [entry, ...get().recentProjects.filter((r) => locationKey(r.location) !== key)].slice(0, MAX_RECENT);
    set({
      project: loc,
      recentProjects: recents,
      activeView: "explorer",
      sidebarVisible: true,
      selectedDistro: loc.kind === "linux" ? loc.distro : get().selectedDistro,
    });
  },
  closeProject: () => set({ project: null }),
  forgetRecent: (loc) => {
    const key = locationKey(loc);
    set((s) => ({ recentProjects: s.recentProjects.filter((r) => locationKey(r.location) !== key) }));
  },
  setSelectedDistro: (selectedDistro) => set({ selectedDistro }),
  toggleHidden: () => set((s) => ({ showHiddenFiles: !s.showHiddenFiles })),
}));

let lastProjectFromDisk: Location | null = null;
export function takeLastProject(): Location | null {
  const p = lastProjectFromDisk;
  lastProjectFromDisk = null;
  return p;
}

function snapshot(): WorkspaceState {
  const s = useWorkspace.getState();
  return {
    layout: {
      sidebarVisible: s.sidebarVisible,
      sidebarWidth: s.sidebarWidth,
      panelVisible: s.panelVisible,
      panelHeight: s.panelHeight,
      activeView: s.activeView,
    },
    recentProjects: s.recentProjects,
    lastProject: s.project,
    selectedDistro: s.selectedDistro,
    showHiddenFiles: s.showHiddenFiles,
  };
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Persists layout and recents shortly after they change. Call once at startup. */
export function startWorkspacePersistence(): () => void {
  return useWorkspace.subscribe((state, prev) => {
    if (!state.loaded) return;
    const changed =
      state.sidebarVisible !== prev.sidebarVisible ||
      state.sidebarWidth !== prev.sidebarWidth ||
      state.panelVisible !== prev.panelVisible ||
      state.panelHeight !== prev.panelHeight ||
      state.activeView !== prev.activeView ||
      state.recentProjects !== prev.recentProjects ||
      state.project !== prev.project ||
      state.selectedDistro !== prev.selectedDistro ||
      state.showHiddenFiles !== prev.showHiddenFiles;
    if (!changed) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void ipc.stateSave(snapshot()).catch(() => undefined);
    }, 400);
  });
}
