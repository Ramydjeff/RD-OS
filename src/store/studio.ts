// Code Studio: open files, unsaved edits, recent files and run options.

import { create } from "zustand";
import { templateFor } from "@/components/apps/studio/templates";
import { errorMessage } from "@/lib/errors";
import { DEFAULT_RUN_OPTIONS, type RunOptions } from "@/lib/fileTypes";
import { ipc } from "@/lib/ipc";
import { locationKey, parentLocation, sameLocation } from "@/lib/paths";
import type { Location } from "@/types/ipc";

export interface StudioTab {
  id: string;
  name: string;
  /** Where the file lives; null until an untitled file is saved. */
  location: Location | null;
  content: string;
  saved: string;
}

export interface RecentFile {
  name: string;
  location: Location;
  openedAt: number;
}

interface StudioStore {
  tabs: StudioTab[];
  activeId: string | null;
  recents: RecentFile[];
  runOptions: RunOptions;
  /** Last build/run failure, offered to the agent for "Corriger". */
  lastError: { tabId: string; text: string } | null;

  openFile: (loc: Location) => Promise<string | null>;
  newFile: (templateId: string) => string;
  newFromText: (name: string, content: string) => string;
  setActive: (id: string) => void;
  update: (id: string, content: string) => void;
  /** Saves to the tab's location. Returns an error message or null. */
  save: (id: string) => Promise<string | null>;
  saveAs: (id: string, dir: Location, name: string) => Promise<string | null>;
  closeTab: (id: string) => void;
  setRunOptions: (patch: Partial<RunOptions>) => void;
  setLastError: (e: { tabId: string; text: string } | null) => void;
}

const RECENTS_KEY = "raimy.studio.recents";
const OPTIONS_KEY = "raimy.studio.runOptions";
const MAX_RECENTS = 14;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: recents simply are not kept */
  }
}

/** Last path segment of a file location. */
export function fileName(loc: Location): string {
  const sep = loc.kind === "linux" ? "/" : "\\";
  const parts = loc.path.split(sep).filter(Boolean);
  return parts[parts.length - 1] ?? loc.path;
}

export function childOf(dir: Location, name: string): Location {
  if (dir.kind === "linux") return { kind: "linux", distro: dir.distro, path: `${dir.path.replace(/\/+$/, "")}/${name}` };
  return { kind: "windows", path: `${dir.path.replace(/\\+$/, "")}\\${name}` };
}

function uniqueUntitled(tabs: StudioTab[], name: string): string {
  if (!tabs.some((t) => t.name === name && !t.location)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; ; i++) {
    const candidate = `${stem}${i}${ext}`;
    if (!tabs.some((t) => t.name === candidate)) return candidate;
  }
}

function remember(recents: RecentFile[], name: string, location: Location): RecentFile[] {
  const key = locationKey(location);
  const next = [{ name, location, openedAt: Date.now() }, ...recents.filter((r) => locationKey(r.location) !== key)].slice(
    0,
    MAX_RECENTS,
  );
  writeJson(RECENTS_KEY, next);
  return next;
}

export const useStudio = create<StudioStore>((set, get) => ({
  tabs: [],
  activeId: null,
  recents: readJson<RecentFile[]>(RECENTS_KEY, []).filter((r) => r && r.location && typeof r.name === "string"),
  runOptions: { ...DEFAULT_RUN_OPTIONS, ...readJson<Partial<RunOptions>>(OPTIONS_KEY, {}) },
  lastError: null,

  openFile: async (loc) => {
    const open = get().tabs.find((t) => sameLocation(t.location, loc));
    if (open) {
      set({ activeId: open.id });
      return open.id;
    }
    const parent = parentLocation(loc);
    const name = fileName(loc);
    if (!parent) throw new Error("Impossible d'ouvrir ce chemin.");
    const content = await ipc.fsReadFile(parent, name);
    const id = crypto.randomUUID();
    set((s) => ({
      tabs: [...s.tabs, { id, name, location: loc, content, saved: content }],
      activeId: id,
      recents: remember(s.recents, name, loc),
    }));
    return id;
  },

  newFile: (templateId) => {
    const t = templateFor(templateId);
    return get().newFromText(t.fileName, t.content);
  },

  newFromText: (name, content) => {
    const id = crypto.randomUUID();
    set((s) => ({
      tabs: [...s.tabs, { id, name: uniqueUntitled(s.tabs, name), location: null, content, saved: "" }],
      activeId: id,
    }));
    return id;
  },

  setActive: (activeId) => set({ activeId }),

  update: (id, content) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, content } : t)) })),

  save: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab?.location) return "Choisissez d'abord un emplacement (Enregistrer sous).";
    const parent = parentLocation(tab.location);
    if (!parent) return "Emplacement invalide.";
    const content = tab.content;
    try {
      await ipc.fsWriteFile(parent, tab.name, content);
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, saved: content } : t)) }));
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  },

  saveAs: async (id, dir, name) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return "Onglet introuvable.";
    const content = tab.content;
    try {
      await ipc.fsWriteFile(dir, name, content);
      const location = childOf(dir, name);
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, name, location, saved: content } : t)),
        recents: remember(s.recents, name, location),
      }));
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  },

  closeTab: (id) =>
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeId = s.activeId === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : s.activeId;
      return { tabs, activeId };
    }),

  setRunOptions: (patch) => {
    const runOptions = { ...get().runOptions, ...patch };
    writeJson(OPTIONS_KEY, runOptions);
    set({ runOptions });
  },

  setLastError: (lastError) => set({ lastError }),
}));

export function isDirty(t: StudioTab): boolean {
  return t.location === null ? t.content.trim().length > 0 : t.content !== t.saved;
}
