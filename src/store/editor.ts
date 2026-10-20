// Files opened from the explorer: one tab each, VS Code style. A single click
// opens a "preview" tab that the next single click reuses; editing the file or
// double-clicking it keeps the tab.

import { create } from "zustand";
import { toAppError } from "@/lib/errors";
import { formatBytes } from "@/lib/format";
import { ipc } from "@/lib/ipc";
import { baseName, locationKey } from "@/lib/paths";
import { confirmDialog, toast } from "@/store/ui";
import type { Location } from "@/types/ipc";

/** Same limit as the backend (fsops::read_file). */
export const MAX_EDIT_BYTES = 2 * 1024 * 1024;

const BINARY_EXT = new Set(
  `png jpg jpeg gif webp bmp ico icns tif tiff psd avif heic mp3 wav ogg flac mp4 mkv mov avi webm zip gz tgz bz2 xz 7z rar
  tar jar war exe dll so o a obj lib bin dat iso img pdf doc docx xls xlsx ppt pptx odt woff woff2 ttf otf eot class pyc
  pyd whl db sqlite sqlite3 onnx pt pth h5 tflite engine npy npz pkl`.split(/\s+/),
);

export function isProbablyBinary(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && BINARY_EXT.has(name.slice(dot + 1).toLowerCase());
}

export interface OpenFile {
  key: string;
  root: Location;
  rel: string;
  name: string;
  content: string;
  /** Content as last read from or written to disk. */
  saved: string;
  status: "loading" | "ready" | "error";
  error?: string;
  preview: boolean;
  savedAt?: number;
}

export function fileKey(root: Location, rel: string): string {
  return `${locationKey(root)}|${rel}`;
}

export const isDirty = (f: OpenFile) => f.status === "ready" && f.content !== f.saved;

/** Backend errors in plain French. */
function readError(e: unknown): string {
  const err = toAppError(e);
  if (/binary/i.test(err.message)) return "Fichier binaire : il ne peut pas être affiché comme du texte.";
  if (/too large/i.test(err.message)) return "Fichier trop volumineux pour l'éditeur (limite : 2 Mo).";
  if (/UTF-8/i.test(err.message)) return "Ce fichier n'est pas encodé en UTF-8 : il ne peut pas être affiché.";
  if (err.kind === "not_found") return "Ce fichier n'existe plus.";
  if (err.kind === "denied") return "Accès refusé à ce fichier.";
  return err.message;
}

interface OpenOptions {
  preview?: boolean;
  /** Size from the directory listing, to refuse big files without reading them. */
  size?: number;
}

interface EditorStore {
  files: OpenFile[];
  activeKey: string | null;
  open: (root: Location, rel: string, opts?: OpenOptions) => Promise<void>;
  setActive: (key: string | null) => void;
  pin: (key: string) => void;
  setContent: (key: string, content: string) => void;
  save: (key: string) => Promise<boolean>;
  close: (key: string) => Promise<boolean>;
  /** Keeps tabs in step with renames and deletions done in the explorer. */
  pathRenamed: (root: Location, oldRel: string, newRel: string) => void;
  pathDeleted: (root: Location, rel: string) => void;
  closeProject: (root: Location) => Promise<boolean>;
}

export const useEditor = create<EditorStore>((set, get) => ({
  files: [],
  activeKey: null,

  open: async (root, rel, opts = {}) => {
    const key = fileKey(root, rel);
    const existing = get().files.find((f) => f.key === key);
    if (existing) {
      set((s) => ({
        activeKey: key,
        files: opts.preview === false ? s.files.map((f) => (f.key === key ? { ...f, preview: false } : f)) : s.files,
      }));
      return;
    }
    const name = baseName(rel);
    const file: OpenFile = { key, root, rel, name, content: "", saved: "", status: "loading", preview: opts.preview ?? false };
    if (isProbablyBinary(name)) {
      Object.assign(file, { status: "error", error: "Fichier binaire : il ne peut pas être affiché comme du texte." });
    } else if (opts.size !== undefined && opts.size > MAX_EDIT_BYTES) {
      Object.assign(file, { status: "error", error: `Fichier trop volumineux pour l'éditeur (${formatBytes(opts.size)}, limite : 2 Mo).` });
    }
    set((s) => {
      // A clean preview tab is replaced instead of piling up tabs.
      const reuse = file.preview ? s.files.findIndex((f) => f.preview && !isDirty(f)) : -1;
      const files = [...s.files];
      if (reuse >= 0) files[reuse] = file;
      else {
        const at = s.files.findIndex((f) => f.key === s.activeKey);
        files.splice(at < 0 ? files.length : at + 1, 0, file);
      }
      return { files, activeKey: key };
    });
    if (file.status !== "loading") return;
    try {
      const content = await ipc.fsReadFile(root, rel);
      set((s) => ({ files: s.files.map((f) => (f.key === key ? { ...f, content, saved: content, status: "ready" } : f)) }));
    } catch (e) {
      set((s) => ({ files: s.files.map((f) => (f.key === key ? { ...f, status: "error", error: readError(e) } : f)) }));
    }
  },

  setActive: (activeKey) => set({ activeKey }),

  pin: (key) => set((s) => ({ files: s.files.map((f) => (f.key === key ? { ...f, preview: false } : f)) })),

  setContent: (key, content) =>
    set((s) => ({ files: s.files.map((f) => (f.key === key ? { ...f, content, preview: false } : f)) })),

  save: async (key) => {
    const f = get().files.find((x) => x.key === key);
    if (!f || f.status !== "ready") return false;
    const content = f.content;
    try {
      await ipc.fsWriteFile(f.root, f.rel, content);
      set((s) => ({ files: s.files.map((x) => (x.key === key ? { ...x, saved: content, savedAt: Date.now() } : x)) }));
      return true;
    } catch (e) {
      toast("error", `Impossible d'enregistrer ${f.name} : ${toAppError(e).message}`);
      return false;
    }
  },

  close: async (key) => {
    const f = get().files.find((x) => x.key === key);
    if (!f) return true;
    if (isDirty(f)) {
      const ok = await confirmDialog({
        title: `Fermer ${f.name} ?`,
        message: "Les modifications de ce fichier ne sont pas enregistrées. Elles seront perdues.",
        confirmLabel: "Fermer sans enregistrer",
        danger: true,
      });
      if (!ok) return false;
    }
    set((s) => {
      const i = s.files.findIndex((x) => x.key === key);
      const files = s.files.filter((x) => x.key !== key);
      const activeKey = s.activeKey === key ? (files[Math.min(i, files.length - 1)]?.key ?? null) : s.activeKey;
      return { files, activeKey };
    });
    return true;
  },

  pathRenamed: (root, oldRel, newRel) => {
    const rootKey = locationKey(root);
    set((s) => {
      let activeKey = s.activeKey;
      const files = s.files.map((f) => {
        if (locationKey(f.root) !== rootKey) return f;
        if (f.rel !== oldRel && !f.rel.startsWith(`${oldRel}/`)) return f;
        const rel = newRel + f.rel.slice(oldRel.length);
        const key = fileKey(root, rel);
        if (activeKey === f.key) activeKey = key;
        return { ...f, rel, key, name: baseName(rel) };
      });
      return { files, activeKey };
    });
  },

  pathDeleted: (root, rel) => {
    const rootKey = locationKey(root);
    const gone = (f: OpenFile) => locationKey(f.root) === rootKey && (f.rel === rel || f.rel.startsWith(`${rel}/`));
    set((s) => {
      const files = s.files.filter((f) => !gone(f));
      const activeKey = files.some((f) => f.key === s.activeKey) ? s.activeKey : (files[files.length - 1]?.key ?? null);
      return { files, activeKey };
    });
  },

  closeProject: async (root) => {
    const rootKey = locationKey(root);
    const mine = get().files.filter((f) => locationKey(f.root) === rootKey);
    const dirty = mine.filter(isDirty);
    if (dirty.length > 0) {
      const ok = await confirmDialog({
        title: "Fermer le projet ?",
        message: `${dirty.length} fichier${dirty.length > 1 ? "s ont" : " a"} des modifications non enregistrées. Elles seront perdues.`,
        detail: dirty.map((f) => f.rel).join("\n"),
        confirmLabel: "Fermer sans enregistrer",
        danger: true,
      });
      if (!ok) return false;
    }
    set((s) => {
      const files = s.files.filter((f) => locationKey(f.root) !== rootKey);
      return { files, activeKey: files.some((f) => f.key === s.activeKey) ? s.activeKey : null };
    });
    return true;
  },
}));
