import { create } from "zustand";
import type { ControllerMeta } from "@/components/terminal/controller";
import {
  collectLeaves,
  makeLeaf,
  removeLeaf,
  setRatio,
  splitLeaf,
  type Leaf,
  type PaneNode,
  type SplitDirection,
} from "@/lib/layoutTree";

export interface TermTab {
  id: string;
  root: PaneNode;
  activePaneId: string;
}

interface TerminalsStore {
  tabs: TermTab[];
  activeTabId: string | null;
  /** Serializable view of each controller (keyed by terminal id). */
  meta: Record<string, ControllerMeta>;
  /** Terminal whose search bar is open. */
  searchFor: string | null;

  addTab: (terminalId: string) => string;
  splitPane: (tabId: string, paneId: string, dir: SplitDirection, terminalId: string) => void;
  removePane: (tabId: string, paneId: string) => void;
  setActiveTab: (tabId: string) => void;
  setActivePane: (tabId: string, paneId: string) => void;
  setSplitRatio: (tabId: string, splitId: string, ratio: number) => void;
  patchMeta: (terminalId: string, patch: Partial<ControllerMeta>) => void;
  dropMeta: (terminalId: string) => void;
  setSearchFor: (terminalId: string | null) => void;
}

const INITIAL_META: ControllerMeta = {
  state: "starting",
  exitCode: null,
  backendId: null,
  title: "",
  cwdHint: null,
  startedAt: null,
  error: null,
  distro: null,
};

export const useTerminals = create<TerminalsStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  meta: {},
  searchFor: null,

  addTab: (terminalId) => {
    const leaf = makeLeaf(terminalId);
    const tab: TermTab = { id: `tab-${crypto.randomUUID()}`, root: leaf, activePaneId: leaf.id };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      meta: { ...s.meta, [terminalId]: s.meta[terminalId] ?? INITIAL_META },
    }));
    return tab.id;
  },

  splitPane: (tabId, paneId, dir, terminalId) => {
    const fresh = makeLeaf(terminalId);
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, root: splitLeaf(t.root, paneId, dir, fresh), activePaneId: fresh.id } : t,
      ),
      meta: { ...s.meta, [terminalId]: s.meta[terminalId] ?? INITIAL_META },
    }));
  },

  removePane: (tabId, paneId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const root = removeLeaf(tab.root, paneId);
    set((s) => {
      if (!root) {
        const tabs = s.tabs.filter((t) => t.id !== tabId);
        const idx = s.tabs.findIndex((t) => t.id === tabId);
        const activeTabId =
          s.activeTabId === tabId ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null) : s.activeTabId;
        return { tabs, activeTabId };
      }
      const leaves = collectLeaves(root);
      const activePaneId = leaves.some((l) => l.id === tab.activePaneId) ? tab.activePaneId : (leaves[0] as Leaf).id;
      return { tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, root, activePaneId } : t)) };
    });
  },

  setActiveTab: (activeTabId) => set({ activeTabId }),
  setActivePane: (tabId, paneId) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId && t.activePaneId !== paneId ? { ...t, activePaneId: paneId } : t)) })),
  setSplitRatio: (tabId, splitId, ratio) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, root: setRatio(t.root, splitId, ratio) } : t)) })),
  patchMeta: (terminalId, patch) =>
    set((s) => ({ meta: { ...s.meta, [terminalId]: { ...(s.meta[terminalId] ?? INITIAL_META), ...patch } } })),
  dropMeta: (terminalId) =>
    set((s) => {
      const meta = { ...s.meta };
      delete meta[terminalId];
      return { meta, searchFor: s.searchFor === terminalId ? null : s.searchFor };
    }),
  setSearchFor: (searchFor) => set({ searchFor }),
}));

export function activeTab(): TermTab | null {
  const { tabs, activeTabId } = useTerminals.getState();
  return tabs.find((t) => t.id === activeTabId) ?? null;
}

/** The leaf that currently has focus in the active tab. */
export function activeLeaf(): { tab: TermTab; leaf: Leaf } | null {
  const tab = activeTab();
  if (!tab) return null;
  const leaf = collectLeaves(tab.root).find((l) => l.id === tab.activePaneId) ?? collectLeaves(tab.root)[0];
  return leaf ? { tab, leaf } : null;
}

export function activeTerminalId(): string | null {
  return activeLeaf()?.leaf.terminalId ?? null;
}
