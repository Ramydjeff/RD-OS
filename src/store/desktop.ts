// rAImy OS desktop: windows, taskbar pins, desktop icons and overlays.
//
// Window geometry lives here as plain data; components read it and, while a
// window is dragged or resized, move the DOM directly and commit the final
// rect once, so nothing re-renders on every pointer move.

import { create } from "zustand";
import { ipc } from "@/lib/ipc";
import { cascadeRect, clampRect, type Area, type Rect, type WinMode } from "@/lib/windowing";
import type { Location } from "@/types/ipc";

export type AppId =
  | "files"
  | "studio"
  | "terminal"
  | "agent"
  | "guide"
  | "apps"
  | "monitor"
  | "environments"
  | "simulator"
  | "settings";

export const APP_IDS: AppId[] = [
  "files",
  "studio",
  "terminal",
  "agent",
  "guide",
  "apps",
  "monitor",
  "environments",
  "simulator",
  "settings",
];

export type ShellMode = "desktop" | "workspace";
export type WallpaperId = "signature" | "aurora" | "obsidian" | "circuit" | "horizon" | "paper";
export const WALLPAPERS: WallpaperId[] = ["signature", "aurora", "obsidian", "circuit", "horizon", "paper"];
export type IconStyle = "signature" | "color";

export type Overlay = "start" | "launcher" | "quick" | "calendar" | null;

const DEFAULT_SIZE: Record<AppId, { w: number; h: number }> = {
  files: { w: 1000, h: 640 },
  studio: { w: 1180, h: 760 },
  terminal: { w: 920, h: 560 },
  agent: { w: 760, h: 760 },
  guide: { w: 1060, h: 740 },
  apps: { w: 900, h: 620 },
  monitor: { w: 860, h: 600 },
  environments: { w: 1040, h: 720 },
  simulator: { w: 1280, h: 800 },
  settings: { w: 980, h: 700 },
};

/** Apps that can have several windows; every other app focuses its one window. */
const MULTI_INSTANCE = new Set<AppId>(["files"]);

export interface DesktopWindow {
  id: string;
  app: AppId;
  /** Shown instead of the app name (a file name, a folder). */
  title: string | null;
  /** Geometry in "normal" mode; kept while maximized or snapped. */
  rect: Rect;
  mode: WinMode;
  minimized: boolean;
  z: number;
  phase: "opening" | "open" | "closing";
  /** Launch arguments; `nonce` changes each time the app is asked to act on them. */
  args: Record<string, unknown> & { nonce: number };
}

export type DesktopItem =
  | { id: string; kind: "app"; app: AppId }
  | { id: string; kind: "winapp"; name: string; path: string }
  | { id: string; kind: "location"; name: string; location: Location; isDir: boolean };

export type PinnedItem =
  | { kind: "app"; app: AppId }
  | { kind: "winapp"; name: string; path: string };

export interface IconPos {
  col: number;
  row: number;
}

const DEFAULT_ITEMS: DesktopItem[] = (
  ["files", "studio", "terminal", "agent", "guide", "apps", "simulator", "monitor", "environments", "settings"] as AppId[]
).map((app) => ({ id: `app:${app}`, kind: "app", app }));

const DEFAULT_PINNED: PinnedItem[] = (["files", "studio", "terminal", "agent", "guide"] as AppId[]).map((app) => ({
  kind: "app",
  app,
}));

interface DesktopStore {
  loaded: boolean;
  shellMode: ShellMode;
  area: Area;
  windows: DesktopWindow[];
  focusedId: string | null;
  zTop: number;
  overlay: Overlay;
  launcherQuery: string;
  /** Windows hidden by "show desktop", restored by the second press. */
  peeked: string[];

  // Persisted
  wallpaper: WallpaperId;
  iconStyle: IconStyle;
  showClock: boolean;
  userName: string;
  items: DesktopItem[];
  icons: Record<string, IconPos>;
  pinned: PinnedItem[];
  rects: Partial<Record<AppId, Rect>>;
  onboarded: boolean;

  load: () => Promise<void>;
  setShellMode: (mode: ShellMode) => void;
  setArea: (area: Area) => void;

  openApp: (app: AppId, opts?: { args?: Record<string, unknown>; title?: string; newWindow?: boolean }) => string;
  focus: (id: string) => void;
  close: (id: string) => void;
  closeApp: (app: AppId) => void;
  minimize: (id: string) => void;
  toggleMinimize: (id: string) => void;
  setMode: (id: string, mode: WinMode) => void;
  toggleMaximize: (id: string) => void;
  commitRect: (id: string, rect: Rect) => void;
  setTitle: (id: string, title: string | null) => void;
  showDesktop: () => void;
  cycle: (dir: 1 | -1) => void;

  setOverlay: (o: Overlay) => void;
  toggleOverlay: (o: Exclude<Overlay, null>) => void;
  openLauncher: (query?: string) => void;
  setLauncherQuery: (q: string) => void;

  setWallpaper: (w: WallpaperId) => void;
  setIconStyle: (style: IconStyle) => void;
  setShowClock: (show: boolean) => void;
  setUserName: (name: string) => void;
  setIcon: (itemId: string, pos: IconPos) => void;
  resetIcons: () => void;
  addItem: (item: DesktopItem) => void;
  removeItem: (itemId: string) => void;
  pin: (item: PinnedItem) => void;
  unpin: (item: PinnedItem) => void;
  isPinned: (item: PinnedItem) => boolean;
  setOnboarded: () => void;
}

export function pinKey(p: PinnedItem): string {
  return p.kind === "app" ? `app:${p.app}` : `win:${p.path.toLowerCase()}`;
}

let nonce = 1;
const OPEN_MS = 200;
const CLOSE_MS = 170;

function topVisible(windows: DesktopWindow[], except?: string): string | null {
  let best: DesktopWindow | null = null;
  for (const w of windows) {
    if (w.id === except || w.minimized || w.phase === "closing") continue;
    if (!best || w.z > best.z) best = w;
  }
  return best?.id ?? null;
}

function initialArea(): Area {
  if (typeof window === "undefined") return { w: 1280, h: 744 };
  return { w: window.innerWidth, h: Math.max(320, window.innerHeight - TASKBAR_HEIGHT) };
}

/** Height reserved at the bottom of the screen for the taskbar. */
export const TASKBAR_HEIGHT = 58;

export const useDesktop = create<DesktopStore>((set, get) => ({
  loaded: false,
  shellMode: "desktop",
  area: initialArea(),
  windows: [],
  focusedId: null,
  zTop: 10,
  overlay: null,
  launcherQuery: "",
  peeked: [],

  wallpaper: "signature",
  iconStyle: "signature",
  showClock: true,
  userName: "",
  items: DEFAULT_ITEMS,
  icons: {},
  pinned: DEFAULT_PINNED,
  rects: {},
  onboarded: false,

  load: async () => {
    try {
      const { value } = await ipc.desktopStateLoad();
      set({ ...sanitize(value), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  setShellMode: (shellMode) => set({ shellMode, overlay: null }),
  setArea: (area) => {
    // Keep normal windows reachable when the screen shrinks.
    set((s) => ({
      area,
      windows: s.windows.map((w) => ({ ...w, rect: clampRect(w.rect, area) })),
    }));
  },

  openApp: (app, opts = {}) => {
    const s = get();
    const args = { ...(opts.args ?? {}), nonce: nonce++ };
    if (!MULTI_INSTANCE.has(app) || !opts.newWindow) {
      const existing = s.windows.find((w) => w.app === app && w.phase !== "closing");
      if (existing && (!MULTI_INSTANCE.has(app) || !opts.args)) {
        const z = s.zTop + 1;
        set({
          zTop: z,
          focusedId: existing.id,
          overlay: null,
          windows: s.windows.map((w) =>
            w.id === existing.id
              ? { ...w, minimized: false, z, args: opts.args ? args : w.args, title: opts.title ?? w.title }
              : w,
          ),
        });
        return existing.id;
      }
    }
    const id = `${app}-${crypto.randomUUID().slice(0, 8)}`;
    const count = s.windows.filter((w) => w.phase !== "closing").length;
    const remembered = s.rects[app];
    const rect = remembered && count === 0 ? clampRect(remembered, s.area) : cascadeRect(remembered ?? DEFAULT_SIZE[app], s.area, count);
    const z = s.zTop + 1;
    const win: DesktopWindow = {
      id,
      app,
      title: opts.title ?? null,
      rect,
      mode: s.area.w < 900 ? "maximized" : "normal",
      minimized: false,
      z,
      phase: "opening",
      args,
    };
    set({ windows: [...s.windows, win], zTop: z, focusedId: id, overlay: null, peeked: [] });
    setTimeout(() => {
      set((st) => ({ windows: st.windows.map((w) => (w.id === id && w.phase === "opening" ? { ...w, phase: "open" } : w)) }));
    }, OPEN_MS);
    return id;
  },

  focus: (id) => {
    const s = get();
    const w = s.windows.find((x) => x.id === id);
    if (!w) return;
    if (s.focusedId === id && !w.minimized && w.z === s.zTop) return;
    const z = s.zTop + 1;
    set({
      zTop: z,
      focusedId: id,
      windows: s.windows.map((x) => (x.id === id ? { ...x, z, minimized: false } : x)),
    });
  },

  close: (id) => {
    const s = get();
    const w = s.windows.find((x) => x.id === id);
    if (!w || w.phase === "closing") return;
    set({
      windows: s.windows.map((x) => (x.id === id ? { ...x, phase: "closing" } : x)),
      focusedId: s.focusedId === id ? topVisible(s.windows, id) : s.focusedId,
      rects: { ...s.rects, [w.app]: w.rect },
    });
    setTimeout(() => set((st) => ({ windows: st.windows.filter((x) => x.id !== id) })), CLOSE_MS);
  },

  closeApp: (app) => {
    for (const w of get().windows) if (w.app === app) get().close(w.id);
  },

  minimize: (id) => {
    const s = get();
    set({
      windows: s.windows.map((x) => (x.id === id ? { ...x, minimized: true } : x)),
      focusedId: s.focusedId === id ? topVisible(s.windows, id) : s.focusedId,
    });
  },

  toggleMinimize: (id) => {
    const s = get();
    const w = s.windows.find((x) => x.id === id);
    if (!w) return;
    if (w.minimized || s.focusedId !== id) s.focus(id);
    else s.minimize(id);
  },

  setMode: (id, mode) => {
    set((s) => ({ windows: s.windows.map((x) => (x.id === id ? { ...x, mode, minimized: false } : x)) }));
    get().focus(id);
  },

  toggleMaximize: (id) => {
    const w = get().windows.find((x) => x.id === id);
    if (w) get().setMode(id, w.mode === "normal" ? "maximized" : "normal");
  },

  commitRect: (id, rect) => {
    const s = get();
    const w = s.windows.find((x) => x.id === id);
    if (!w) return;
    const r = clampRect(rect, s.area);
    set({
      windows: s.windows.map((x) => (x.id === id ? { ...x, rect: r, mode: "normal" } : x)),
      rects: { ...s.rects, [w.app]: r },
    });
  },

  setTitle: (id, title) => {
    set((s) => ({ windows: s.windows.map((x) => (x.id === id && x.title !== title ? { ...x, title } : x)) }));
  },

  showDesktop: () => {
    const s = get();
    if (s.peeked.length > 0) {
      const ids = new Set(s.peeked);
      set({ windows: s.windows.map((w) => (ids.has(w.id) ? { ...w, minimized: false } : w)), peeked: [] });
      const top = topVisible(get().windows);
      if (top) get().focus(top);
      return;
    }
    const visible = s.windows.filter((w) => !w.minimized && w.phase !== "closing").map((w) => w.id);
    if (visible.length === 0) return;
    set({
      windows: s.windows.map((w) => (visible.includes(w.id) ? { ...w, minimized: true } : w)),
      peeked: visible,
      focusedId: null,
      overlay: null,
    });
  },

  cycle: (dir) => {
    const s = get();
    const order = s.windows.filter((w) => w.phase !== "closing").sort((a, b) => a.z - b.z);
    if (order.length === 0) return;
    const i = order.findIndex((w) => w.id === s.focusedId);
    const next = order[(i + (dir === 1 ? -1 : 1) + order.length) % order.length];
    if (next) s.focus(next.id);
  },

  setOverlay: (overlay) => set({ overlay }),
  toggleOverlay: (o) => set((s) => ({ overlay: s.overlay === o ? null : o })),
  openLauncher: (query = "") => set({ overlay: "launcher", launcherQuery: query }),
  setLauncherQuery: (launcherQuery) => set({ launcherQuery }),

  setWallpaper: (wallpaper) => set({ wallpaper }),
  setIconStyle: (iconStyle) => set({ iconStyle }),
  setShowClock: (showClock) => set({ showClock }),
  setUserName: (userName) => set({ userName: userName.slice(0, 40) }),
  setIcon: (itemId, pos) => set((s) => ({ icons: { ...s.icons, [itemId]: pos } })),
  resetIcons: () => set({ icons: {} }),
  addItem: (item) =>
    set((s) => (s.items.some((i) => i.id === item.id) ? s : { items: [...s.items, item] })),
  removeItem: (itemId) =>
    set((s) => {
      const icons = { ...s.icons };
      delete icons[itemId];
      return { items: s.items.filter((i) => i.id !== itemId), icons };
    }),
  pin: (item) => set((s) => (s.pinned.some((p) => pinKey(p) === pinKey(item)) ? s : { pinned: [...s.pinned, item] })),
  unpin: (item) => set((s) => ({ pinned: s.pinned.filter((p) => pinKey(p) !== pinKey(item)) })),
  isPinned: (item) => get().pinned.some((p) => pinKey(p) === pinKey(item)),
  setOnboarded: () => set({ onboarded: true }),
}));

// ─── Persistence ─────────────────────────────────────────────────────────────

interface Persisted {
  version: 1;
  shellMode: ShellMode;
  wallpaper: WallpaperId;
  iconStyle: IconStyle;
  showClock: boolean;
  userName: string;
  items: DesktopItem[];
  icons: Record<string, IconPos>;
  pinned: PinnedItem[];
  rects: Partial<Record<AppId, Rect>>;
  onboarded: boolean;
}

function isApp(v: unknown): v is AppId {
  return typeof v === "string" && (APP_IDS as string[]).includes(v);
}

function isRect(v: unknown): v is Rect {
  const r = v as Rect;
  return !!r && [r.x, r.y, r.w, r.h].every((n) => typeof n === "number" && Number.isFinite(n));
}

function isLocation(v: unknown): v is Location {
  const l = v as Location;
  if (!l || typeof l.path !== "string") return false;
  return l.kind === "windows" || (l.kind === "linux" && typeof (l as { distro?: unknown }).distro === "string");
}

/** Accepts whatever was on disk and keeps only well-formed parts. */
export function sanitize(raw: Record<string, unknown>): Partial<Persisted> {
  const out: Partial<Persisted> = {};
  if (raw.shellMode === "desktop" || raw.shellMode === "workspace") out.shellMode = raw.shellMode;
  if (typeof raw.wallpaper === "string" && (WALLPAPERS as string[]).includes(raw.wallpaper)) out.wallpaper = raw.wallpaper as WallpaperId;
  if (raw.iconStyle === "signature" || raw.iconStyle === "color") out.iconStyle = raw.iconStyle;
  if (typeof raw.showClock === "boolean") out.showClock = raw.showClock;
  if (typeof raw.userName === "string") out.userName = raw.userName.slice(0, 40);
  if (typeof raw.onboarded === "boolean") out.onboarded = raw.onboarded;
  if (Array.isArray(raw.items)) {
    const items: DesktopItem[] = [];
    for (const it of raw.items as Record<string, unknown>[]) {
      if (!it || typeof it.id !== "string") continue;
      if (it.kind === "app" && isApp(it.app)) items.push({ id: it.id, kind: "app", app: it.app });
      else if (it.kind === "winapp" && typeof it.name === "string" && typeof it.path === "string")
        items.push({ id: it.id, kind: "winapp", name: it.name, path: it.path });
      else if (it.kind === "location" && typeof it.name === "string" && isLocation(it.location))
        items.push({ id: it.id, kind: "location", name: it.name, location: it.location, isDir: it.isDir === true });
    }
    out.items = items;
  }
  if (raw.icons && typeof raw.icons === "object") {
    const icons: Record<string, IconPos> = {};
    for (const [k, v] of Object.entries(raw.icons as Record<string, IconPos>)) {
      if (v && Number.isInteger(v.col) && Number.isInteger(v.row) && v.col >= 0 && v.row >= 0) icons[k] = { col: v.col, row: v.row };
    }
    out.icons = icons;
  }
  if (Array.isArray(raw.pinned)) {
    const pinned: PinnedItem[] = [];
    for (const p of raw.pinned as Record<string, unknown>[]) {
      if (p?.kind === "app" && isApp(p.app)) pinned.push({ kind: "app", app: p.app });
      else if (p?.kind === "winapp" && typeof p.name === "string" && typeof p.path === "string")
        pinned.push({ kind: "winapp", name: p.name, path: p.path });
    }
    out.pinned = pinned;
  }
  if (raw.rects && typeof raw.rects === "object") {
    const rects: Partial<Record<AppId, Rect>> = {};
    for (const [k, v] of Object.entries(raw.rects as Record<string, unknown>)) if (isApp(k) && isRect(v)) rects[k] = v;
    out.rects = rects;
  }
  return out;
}

function snapshot(): Persisted {
  const s = useDesktop.getState();
  return {
    version: 1,
    shellMode: s.shellMode,
    wallpaper: s.wallpaper,
    iconStyle: s.iconStyle,
    showClock: s.showClock,
    userName: s.userName,
    items: s.items,
    icons: s.icons,
    pinned: s.pinned,
    rects: s.rects,
    onboarded: s.onboarded,
  };
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Saves the persisted part of the desktop shortly after it changes. Call once. */
export function startDesktopPersistence(): () => void {
  return useDesktop.subscribe((s, p) => {
    if (!s.loaded) return;
    const changed =
      s.shellMode !== p.shellMode ||
      s.wallpaper !== p.wallpaper ||
      s.iconStyle !== p.iconStyle ||
      s.showClock !== p.showClock ||
      s.userName !== p.userName ||
      s.items !== p.items ||
      s.icons !== p.icons ||
      s.pinned !== p.pinned ||
      s.rects !== p.rects ||
      s.onboarded !== p.onboarded;
    if (!changed) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void ipc.desktopStateSave(snapshot() as unknown as Record<string, unknown>).catch(() => undefined);
    }, 500);
  });
}
