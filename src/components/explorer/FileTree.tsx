// Project file tree. Only the visible rows are rendered, so folders with
// thousands of entries scroll smoothly. Rename and creation happen in place,
// the expanded folders survive view switches, and the tree refreshes itself
// when the window gets the focus back.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ChevronRight,
  ClipboardCopy,
  ClipboardPaste,
  Cpu,
  ExternalLink,
  FilePlus,
  FileText,
  FolderPlus,
  Link2,
  LoaderCircle,
  Pencil,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { FileIcon, FolderIcon } from "@/components/explorer/fileIcons";
import { ContextMenu, type MenuItem } from "@/components/ui/ContextMenu";
import { insertIntoActive, openTerminal, reportError } from "@/features/terminalActions";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { baseName, childLocation, hostPathOf, joinRel, locationKey, parentRel, validateEntryName } from "@/lib/paths";
import { useEditor } from "@/store/editor";
import { useSettings } from "@/store/settings";
import { simulateSource } from "@/store/processesView";
import { confirmDialog, toast } from "@/store/ui";
import { useWorkspace } from "@/store/workspace";
import type { EntryKind, FsEntry, Location } from "@/types/ipc";

const ROW_H = 24;
const INDENT = 12;
const OVERSCAN = 12;

interface DirState {
  status: "loading" | "ready" | "error";
  entries: FsEntry[];
  error?: string;
  truncated?: boolean;
}

interface Row {
  rel: string;
  name: string;
  kind: EntryKind;
  depth: number;
  symlink: boolean;
  hidden: boolean;
  size: number;
  /** Pseudo-rows: messages under a folder, or the inline "new item" input. */
  note?: "error" | "empty" | "more" | "create";
}

type Editing = { mode: "rename"; rel: string } | { mode: "create"; parent: string; kind: "file" | "dir" } | null;

export interface FileTreeHandle {
  refresh: () => void;
  newEntry: (kind: "file" | "dir") => void;
  collapseAll: () => void;
  focus: () => void;
}

interface Props {
  root: Location;
  showHidden: boolean;
  /** Case-insensitive filter over the folders already loaded. */
  filter: string;
}

/** Wraps a path for safe insertion into a POSIX shell command line. */
export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/** Tree state per project, so switching views or projects is instant and keeps the context. */
interface Memory {
  expanded: Set<string>;
  selected: string | null;
  scrollTop: number;
  dirs: Record<string, DirState>;
  showHidden: boolean;
}
const memory = new Map<string, Memory>();
const MEMORY_MAX = 8;

function remember(key: string, m: Memory) {
  memory.delete(key);
  memory.set(key, m);
  if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value!);
}

function copy(text: string, what: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast("success", `${what} copié.`),
    () => toast("error", "Le presse-papiers n'est pas accessible."),
  );
}

export const FileTree = forwardRef<FileTreeHandle, Props>(function FileTree({ root, showHidden, filter }, ref) {
  const rootKey = locationKey(root);
  const [remembered] = useState(() => memory.get(rootKey));
  const [dirs, setDirs] = useState<Record<string, DirState>>(() =>
    remembered && remembered.showHidden === showHidden ? remembered.dirs : {},
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => remembered?.expanded ?? new Set([""]));
  const [selected, setSelected] = useState<string | null>(remembered?.selected ?? null);
  const [editing, setEditing] = useState<Editing>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; rel: string; kind: EntryKind } | null>(null);
  const [view, setView] = useState({ top: remembered?.scrollTop ?? 0, height: 400 });
  const confirmDelete = useSettings((s) => s.settings.confirmations.deleteEntries);
  // The key only (not the file object, which changes on every keystroke in the editor).
  const activeKey = useEditor((s) => s.activeKey);
  const boxRef = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const typeahead = useRef({ text: "", at: 0 });
  /** Root + hidden flag the current `dirs` were listed for. */
  const listedFor = useRef(Object.keys(dirs).length > 0 ? `${rootKey}|${showHidden}` : null);

  /** `quiet`: a background refresh keeps showing the current entries until the new ones arrive. */
  const load = useCallback(
    async (rel: string, quiet = false) => {
      const gen = generation.current;
      setDirs((d) => (quiet && d[rel]?.status === "ready" ? d : { ...d, [rel]: { status: "loading", entries: d[rel]?.entries ?? [] } }));
      try {
        const listing = await ipc.fsListDir(root, rel, showHidden);
        if (gen !== generation.current) return;
        setDirs((d) => ({ ...d, [rel]: { status: "ready", entries: listing.entries, truncated: listing.truncated } }));
      } catch (e) {
        if (gen !== generation.current) return;
        setDirs((d) => ({ ...d, [rel]: { status: "error", entries: [], error: errorMessage(e) } }));
      }
    },
    [root, showHidden],
  );

  const refresh = useCallback(() => {
    for (const rel of expandedRef.current) void load(rel, true);
  }, [load]);

  // New root or hidden-files toggle: reload what was open (the expansion is kept).
  // A tree restored from memory is shown at once and refreshed in the background.
  useEffect(() => {
    generation.current += 1;
    const sig = `${rootKey}|${showHidden}`;
    const same = listedFor.current === sig;
    listedFor.current = sig;
    if (!same) setDirs({});
    for (const rel of expandedRef.current) void load(rel, same);
  }, [load, rootKey, showHidden]);

  // Remember the state for the next mount, and restore the scroll position.
  useEffect(() => {
    remember(rootKey, { expanded, selected, scrollTop: view.top, dirs, showHidden });
  }, [rootKey, expanded, selected, view.top, dirs, showHidden]);
  useLayoutEffect(() => {
    if (boxRef.current && remembered) boxRef.current.scrollTop = remembered.scrollTop;
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Files may change outside the app (terminal, git...): refresh on focus, at most every 3 s.
  useEffect(() => {
    let last = Date.now();
    const onFocus = () => {
      if (Date.now() - last < 3000) return;
      last = Date.now();
      refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(() => setView((v) => ({ ...v, height: box.clientHeight })));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const query = filter.trim().toLowerCase();

  const rows = useMemo(() => {
    const out: Row[] = [];
    const base = { symlink: false, hidden: false, size: 0, kind: "other" as EntryKind };
    // While filtering: does this folder (as loaded) contain a match?
    const matchMemo = new Map<string, boolean>();
    const hasMatch = (rel: string): boolean => {
      const cached = matchMemo.get(rel);
      if (cached !== undefined) return cached;
      const st = dirs[rel];
      const found = !!st?.entries.some((e) => e.name.toLowerCase().includes(query) || (e.kind === "dir" && hasMatch(joinRel(rel, e.name))));
      matchMemo.set(rel, found);
      return found;
    };
    const walk = (rel: string, depth: number) => {
      const state = dirs[rel];
      if (editing?.mode === "create" && editing.parent === rel) {
        out.push({ ...base, rel: `${rel}/\u0000create`, name: "", kind: editing.kind, depth, note: "create" });
      }
      if (!state) return;
      if (state.status === "error") {
        out.push({ ...base, rel: `${rel}/\u0000error`, name: state.error ?? "Dossier illisible.", depth, note: "error" });
        return;
      }
      if (state.status === "ready" && state.entries.length === 0 && rel !== "" && !query) {
        out.push({ ...base, rel: `${rel}/\u0000empty`, name: "Dossier vide", depth, note: "empty" });
      }
      for (const e of state.entries) {
        const child = joinRel(rel, e.name);
        const isDir = e.kind === "dir";
        if (query && !e.name.toLowerCase().includes(query) && !(isDir && hasMatch(child))) continue;
        out.push({ rel: child, name: e.name, kind: e.kind, depth, symlink: e.symlink, hidden: e.hidden, size: e.size });
        if (isDir && (query ? hasMatch(child) : expanded.has(child))) walk(child, depth + 1);
      }
      if (state.truncated) {
        out.push({ ...base, rel: `${rel}/\u0000more`, name: "Seules les 5 000 premières entrées sont affichées.", depth, note: "more" });
      }
    };
    walk("", 0);
    return out;
  }, [dirs, expanded, editing, query]);

  const real = useMemo(() => rows.filter((r) => !r.note), [rows]);

  const toggle = useCallback(
    (rel: string, open?: boolean) => {
      setExpanded((prev) => {
        const isOpen = prev.has(rel);
        if (open === isOpen) return prev;
        const next = new Set(prev);
        if (isOpen) next.delete(rel);
        else {
          next.add(rel);
          void load(rel);
        }
        return next;
      });
    },
    [load],
  );

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  /** Selects a row and scrolls it into view once it is rendered (it may have just been created). */
  const select = useCallback((rel: string | null) => {
    setSelected(rel);
    if (rel === null) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const box = boxRef.current;
        const idx = rowsRef.current.findIndex((r) => r.rel === rel);
        if (!box || idx < 0) return;
        const top = idx * ROW_H + 4;
        if (top < box.scrollTop) box.scrollTop = top - 4;
        else if (top + ROW_H > box.scrollTop + box.clientHeight) box.scrollTop = top + ROW_H - box.clientHeight + 4;
      }),
    );
  }, []);

  /** Folder that new items go into: the selection if it is a folder, else its parent. */
  const targetDir = useCallback((): string => {
    if (!selected) return "";
    const row = real.find((r) => r.rel === selected);
    return row?.kind === "dir" ? selected : parentRel(selected);
  }, [selected, real]);

  const startCreate = useCallback(
    (kind: "file" | "dir", parent = targetDir()) => {
      if (parent && !expandedRef.current.has(parent)) toggle(parent, true);
      setEditing({ mode: "create", parent, kind });
    },
    [targetDir, toggle],
  );

  const openFile = useCallback(
    (row: Row, pinned: boolean) => {
      void useEditor.getState().open(root, row.rel, { preview: !pinned, size: row.size });
    },
    [root],
  );

  const commitEdit = useCallback(
    async (value: string) => {
      const e = editing;
      if (!e) return;
      const name = value.trim();
      if (e.mode === "rename") {
        const oldName = baseName(e.rel);
        if (!name || name === oldName || validateEntryName(name)) {
          setEditing(null);
          return;
        }
        try {
          await ipc.fsRename(root, e.rel, name);
          const parent = parentRel(e.rel);
          const newRel = joinRel(parent, name);
          setExpanded((prev) => {
            const next = new Set<string>();
            for (const r of prev) next.add(r === e.rel || r.startsWith(`${e.rel}/`) ? newRel + r.slice(e.rel.length) : r);
            return next;
          });
          useEditor.getState().pathRenamed(root, e.rel, newRel);
          setEditing(null);
          await load(parent);
          select(newRel);
        } catch (err) {
          setEditing(null);
          void reportError("Impossible de renommer", err);
        }
        return;
      }
      if (!name || validateEntryName(name)) {
        setEditing(null);
        return;
      }
      try {
        await ipc.fsCreate(root, e.parent, name, e.kind);
        setEditing(null);
        if (e.parent) toggle(e.parent, true);
        await load(e.parent);
        const rel = joinRel(e.parent, name);
        select(rel);
        if (e.kind === "file") void useEditor.getState().open(root, rel, { preview: false });
      } catch (err) {
        setEditing(null);
        void reportError("Impossible de créer l'élément", err);
      }
    },
    [editing, root, load, toggle, select],
  );

  const deleteEntry = useCallback(
    async (rel: string, kind: EntryKind) => {
      const name = baseName(rel);
      if (confirmDelete) {
        const ok = await confirmDialog({
          title: kind === "dir" ? "Supprimer ce dossier ?" : "Supprimer ce fichier ?",
          message:
            kind === "dir"
              ? `« ${name} » et tout son contenu seront supprimés définitivement. Cette action est irréversible.`
              : `« ${name} » sera supprimé définitivement. Cette action est irréversible.`,
          detail: rel,
          confirmLabel: "Supprimer définitivement",
          danger: true,
        });
        if (!ok) return;
      }
      try {
        await ipc.fsDelete(root, rel);
        useEditor.getState().pathDeleted(root, rel);
        toast("success", `« ${name} » supprimé.`);
        const parent = parentRel(rel);
        setExpanded((prev) => new Set([...prev].filter((r) => r !== rel && !r.startsWith(`${rel}/`))));
        setSelected(parent || null);
        await load(parent);
      } catch (e) {
        void reportError("Impossible de supprimer", e);
      }
    },
    [root, load, confirmDelete],
  );

  const insertPath = useCallback(
    async (rel: string) => {
      try {
        const loc = childLocation(root, rel);
        let linuxPath: string;
        if (loc.kind === "linux") {
          linuxPath = loc.path;
        } else {
          // Windows path: let the distribution's own wslpath translate it.
          const distro = useWorkspace.getState().selectedDistro;
          if (!distro) throw new Error("Choisissez d'abord une distribution (vue Environnements).");
          linuxPath = await ipc.wslToLinuxPath(distro, loc.path);
        }
        insertIntoActive(shellQuote(linuxPath) + " ");
      } catch (e) {
        void reportError("Impossible d'insérer le chemin", e);
      }
    },
    [root],
  );

  const simulate = useCallback(
    async (rel: string) => {
      try {
        const code = await ipc.fsReadFile(root, rel);
        await simulateSource(code, baseName(rel));
        useWorkspace.getState().setView("processes");
      } catch (e) {
        void reportError("Impossible de lire le fichier", e);
      }
    },
    [root],
  );

  useImperativeHandle(
    ref,
    () => ({
      refresh,
      newEntry: (kind) => startCreate(kind),
      collapseAll: () => setExpanded(new Set([""])),
      focus: () => boxRef.current?.focus(),
    }),
    [refresh, startCreate],
  );

  const menuItems = useMemo((): (MenuItem | "separator")[] => {
    if (!menu) return [];
    const isDir = menu.kind === "dir";
    const isRoot = menu.rel === "";
    const inDir = isDir ? menu.rel : parentRel(menu.rel);
    const loc = childLocation(root, menu.rel);
    const items: (MenuItem | "separator")[] = [];
    if (!isDir) {
      const row = real.find((r) => r.rel === menu.rel);
      items.push({ id: "open", label: "Ouvrir", icon: <FileText size={14} />, hint: "Entrée", onSelect: () => row && openFile(row, true) });
      if (/\.c$/i.test(menu.rel)) {
        items.push({ id: "simulate", label: "Simuler les processus", icon: <Cpu size={14} />, onSelect: () => void simulate(menu.rel) });
      }
      items.push("separator");
    }
    items.push(
      { id: "new-file", label: "Nouveau fichier", icon: <FilePlus size={14} />, onSelect: () => startCreate("file", inDir) },
      { id: "new-folder", label: "Nouveau dossier", icon: <FolderPlus size={14} />, onSelect: () => startCreate("dir", inDir) },
      "separator",
      { id: "copy-path", label: "Copier le chemin", icon: <ClipboardCopy size={14} />, onSelect: () => copy(loc.path, "Chemin") },
    );
    if (!isRoot) {
      items.push({ id: "copy-rel", label: "Copier le chemin relatif", icon: <Link2 size={14} />, onSelect: () => copy(menu.rel, "Chemin relatif") });
    }
    items.push(
      {
        id: "reveal",
        label: "Afficher dans l'Explorateur Windows",
        icon: <ExternalLink size={14} />,
        onSelect: () => void revealItemInDir(hostPathOf(loc)).catch((e) => reportError("Impossible d'ouvrir l'Explorateur", e)),
      },
      "separator",
      {
        id: "terminal",
        label: "Ouvrir dans le terminal",
        icon: <SquareTerminal size={14} />,
        onSelect: () => void openTerminal({ cwd: childLocation(root, inDir) }),
      },
      { id: "insert", label: "Insérer le chemin dans le terminal", icon: <ClipboardPaste size={14} />, onSelect: () => void insertPath(menu.rel) },
    );
    if (!isRoot) {
      items.push(
        "separator",
        { id: "rename", label: "Renommer", icon: <Pencil size={14} />, hint: "F2", onSelect: () => setEditing({ mode: "rename", rel: menu.rel }) },
        { id: "delete", label: "Supprimer", icon: <Trash2 size={14} />, hint: "Suppr", danger: true, onSelect: () => void deleteEntry(menu.rel, menu.kind) },
      );
    }
    return items;
  }, [menu, root, real, openFile, simulate, startCreate, insertPath, deleteEntry]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (editing) return;
    const idx = selected !== null ? real.findIndex((r) => r.rel === selected) : -1;
    const cur = idx >= 0 ? real[idx] : undefined;
    const go = (i: number) => {
      const r = real[Math.max(0, Math.min(real.length - 1, i))];
      if (r) select(r.rel);
    };
    const page = Math.max(1, Math.floor((boxRef.current?.clientHeight ?? 300) / ROW_H) - 1);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        go(idx + 1);
        return;
      case "ArrowUp":
        e.preventDefault();
        go(idx < 0 ? 0 : idx - 1);
        return;
      case "PageDown":
        e.preventDefault();
        go(idx + page);
        return;
      case "PageUp":
        e.preventDefault();
        go(idx - page);
        return;
      case "Home":
        e.preventDefault();
        go(0);
        return;
      case "End":
        e.preventDefault();
        go(real.length - 1);
        return;
      case "ArrowRight":
        if (cur?.kind === "dir") {
          e.preventDefault();
          if (!expanded.has(cur.rel) && !query) toggle(cur.rel, true);
          else go(idx + 1);
        }
        return;
      case "ArrowLeft":
        if (cur) {
          e.preventDefault();
          if (cur.kind === "dir" && expanded.has(cur.rel) && !query) toggle(cur.rel, false);
          else if (parentRel(cur.rel) !== cur.rel && cur.rel.includes("/")) select(parentRel(cur.rel));
        }
        return;
      case "Enter":
        if (cur) {
          e.preventDefault();
          if (cur.kind === "dir") toggle(cur.rel);
          else openFile(cur, true);
        }
        return;
      case "F2":
        if (cur) {
          e.preventDefault();
          setEditing({ mode: "rename", rel: cur.rel });
        }
        return;
      case "Delete":
        if (cur) {
          e.preventDefault();
          void deleteEntry(cur.rel, cur.kind);
        }
        return;
      case "ContextMenu":
      case "F10":
        if (cur && (e.key === "ContextMenu" || e.shiftKey)) {
          e.preventDefault();
          const el = boxRef.current?.querySelector<HTMLElement>(`[data-rel="${CSS.escape(cur.rel)}"]`);
          const r = el?.getBoundingClientRect();
          setMenu({ x: (r?.left ?? 100) + 24, y: (r?.bottom ?? 100) + 2, rel: cur.rel, kind: cur.kind });
        }
        return;
    }
    // Type-ahead: letters jump to the next entry starting with what was typed.
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && e.key !== " ") {
      const now = Date.now();
      const t = typeahead.current;
      t.text = now - t.at > 700 ? e.key.toLowerCase() : t.text + e.key.toLowerCase();
      t.at = now;
      const start = t.text.length === 1 ? idx + 1 : Math.max(0, idx);
      for (let k = 0; k < real.length; k++) {
        const r = real[(start + k) % real.length]!;
        if (r.name.toLowerCase().startsWith(t.text)) {
          select(r.rel);
          break;
        }
      }
    }
  }

  const first = Math.max(0, Math.floor(view.top / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((view.top + view.height) / ROW_H) + OVERSCAN);
  const visible = rows.slice(first, last);
  const activeRel = activeKey?.startsWith(`${rootKey}|`) ? activeKey.slice(rootKey.length + 1) : null;

  return (
    <>
      <div
        ref={boxRef}
        role="tree"
        aria-label="Fichiers du projet"
        tabIndex={0}
        aria-activedescendant={selected !== null ? `tree-${selected}` : undefined}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          const top = e.currentTarget.scrollTop;
          setView((v) => (v.top === top ? v : { ...v, top }));
        }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest("[data-rel]")) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, rel: "", kind: "dir" });
        }}
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:outline-offset-[-2px]"
      >
        <div style={{ height: rows.length * ROW_H + 8, position: "relative" }}>
          <div style={{ transform: `translateY(${first * ROW_H + 4}px)` }}>
            {visible.map((r) => {
              const pad = 10 + r.depth * INDENT;
              const guides = Array.from({ length: r.depth }, (_, d) => (
                <span key={d} aria-hidden className="absolute inset-y-0 w-px bg-line/80" style={{ left: 10 + d * INDENT + 7 }} />
              ));
              if (r.note === "create" || (editing?.mode === "rename" && editing.rel === r.rel)) {
                const renaming = r.note !== "create";
                return (
                  <div key={r.rel} className="relative flex items-center gap-1.5 pr-2" style={{ height: ROW_H, paddingLeft: pad }}>
                    {guides}
                    <span className="w-4 shrink-0" />
                    {r.kind === "dir" ? <FolderIcon name={r.name} open={false} /> : <FileIcon name={r.name || "fichier"} />}
                    <InlineName
                      initial={renaming ? r.name : ""}
                      placeholder={r.kind === "dir" ? "Nom du dossier" : "Nom du fichier"}
                      onCommit={(v) => void commitEdit(v)}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                );
              }
              if (r.note) {
                return (
                  <div
                    key={r.rel}
                    style={{ height: ROW_H, paddingLeft: pad + 22 }}
                    className={cn("relative flex items-center gap-1.5 pr-2 text-[12px] italic", r.note === "error" ? "text-danger" : "text-faint")}
                  >
                    {guides}
                    <span className="selectable truncate" title={r.name}>
                      {r.name}
                    </span>
                  </div>
                );
              }
              const isDir = r.kind === "dir";
              const isOpen = isDir && (query ? true : expanded.has(r.rel));
              const isSel = selected === r.rel;
              const loading = isDir && isOpen && dirs[r.rel]?.status === "loading";
              return (
                <div
                  key={r.rel}
                  id={`tree-${r.rel}`}
                  data-rel={r.rel}
                  role="treeitem"
                  aria-level={r.depth + 1}
                  aria-expanded={isDir ? isOpen : undefined}
                  aria-selected={isSel}
                  title={r.rel}
                  style={{ height: ROW_H, paddingLeft: pad }}
                  onClick={() => {
                    setSelected(r.rel);
                    if (isDir) toggle(r.rel);
                    else openFile(r, false);
                  }}
                  onDoubleClick={() => !isDir && openFile(r, true)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSelected(r.rel);
                    setMenu({ x: e.clientX, y: e.clientY, rel: r.rel, kind: r.kind });
                  }}
                  className={cn(
                    "group relative flex cursor-default items-center gap-1.5 pr-2 text-[13px]",
                    isSel ? "bg-active text-fg" : activeRel === r.rel ? "bg-hover text-fg" : "text-fg2 hover:bg-hover hover:text-fg",
                    r.hidden && "opacity-55",
                  )}
                >
                  {guides}
                  {isSel && <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-accent" />}
                  <span className="flex w-4 shrink-0 justify-center text-muted">
                    {loading ? (
                      <LoaderCircle size={12} className="animate-spin" />
                    ) : isDir ? (
                      <ChevronRight size={13} className={cn("transition-transform duration-150", isOpen && "rotate-90")} />
                    ) : null}
                  </span>
                  {isDir ? <FolderIcon name={r.name} open={isOpen} /> : <FileIcon name={r.name} />}
                  <span className="truncate">
                    <Highlighted text={r.name} query={query} />
                  </span>
                  {r.symlink && <Link2 size={11} className="shrink-0 text-faint" aria-label="lien symbolique" />}
                </div>
              );
            })}
          </div>
        </div>
        {query && real.length === 0 && (
          <p className="px-4 py-3 text-[12px] text-muted">Aucun élément chargé ne correspond à « {filter.trim()} ».</p>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </>
  );
});

function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[2px] bg-accent/25 text-fg">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

/** In-place name editor: Enter or leaving the field commits, Escape cancels. */
function InlineName({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  const error = value.trim() && value !== initial ? validateEntryName(value.trim()) : null;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Select the name without its extension, like every file manager.
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit && !error) onCommit(value);
    else onCancel();
  };

  return (
    <span className="relative min-w-0 flex-1">
      <input
        ref={ref}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        aria-invalid={!!error}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") finish(true);
          else if (e.key === "Escape") finish(false);
        }}
        onBlur={() => finish(true)}
        className={cn(
          "h-[20px] w-full rounded-[3px] border bg-bg px-1.5 text-[13px] text-fg outline-none placeholder:text-faint",
          error ? "border-danger" : "border-accent",
        )}
      />
      {error && (
        <span role="alert" className="absolute left-0 top-[22px] z-10 w-max max-w-64 rounded-[4px] border border-danger/60 bg-elevated px-2 py-1 text-[11.5px] text-danger shadow-[var(--shadow)]">
          {error}
        </span>
      )}
    </span>
  );
}
