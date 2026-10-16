import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from "react";
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Link2,
  Pencil,
  TerminalSquare,
  Trash2,
  LoaderCircle,
  ClipboardPaste,
} from "lucide-react";
import { ContextMenu, type MenuItem } from "@/components/ui/ContextMenu";
import { insertIntoActive, openTerminal, reportError } from "@/features/terminalActions";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { baseName, childLocation, joinRel, parentRel, validateEntryName } from "@/lib/paths";
import { useSettings } from "@/store/settings";
import { confirmDialog, promptDialog, toast } from "@/store/ui";
import { useWorkspace } from "@/store/workspace";
import type { EntryKind, FsEntry, Location } from "@/types/ipc";

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
  /** Pseudo-rows for loading/error/empty states under a directory. */
  note?: string;
}

export interface FileTreeHandle {
  refresh: () => void;
  newEntry: (kind: "file" | "dir") => void;
}

interface Props {
  root: Location;
  showHidden: boolean;
  onSelectionChange?: (sel: { rel: string; kind: EntryKind } | null) => void;
}

/** Wraps a path for safe insertion into a POSIX shell command line. */
export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

export const FileTree = forwardRef<FileTreeHandle, Props>(function FileTree({ root, showHidden, onSelectionChange }, ref) {
  const [dirs, setDirs] = useState<Record<string, DirState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [selected, setSelected] = useState<{ rel: string; kind: EntryKind } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; rel: string; kind: EntryKind } | null>(null);
  const confirmDelete = useSettings((s) => s.settings.confirmations.deleteEntries);
  const treeRef = useRef<HTMLDivElement>(null);
  const generation = useRef(0);

  const load = useCallback(
    async (rel: string) => {
      const gen = generation.current;
      setDirs((d) => ({ ...d, [rel]: { status: "loading", entries: d[rel]?.entries ?? [] } }));
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

  // New root or hidden-files toggle: start over.
  useEffect(() => {
    generation.current += 1;
    setDirs({});
    setExpanded(new Set([""]));
    setSelected(null);
    void load("");
  }, [load]);

  useEffect(() => onSelectionChange?.(selected), [selected, onSelectionChange]);

  const refresh = useCallback(() => {
    for (const rel of expanded) void load(rel);
  }, [expanded, load]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (rel: string, depth: number) => {
      const state = dirs[rel];
      if (!state) return;
      if (state.status === "loading" && state.entries.length === 0) {
        out.push({ rel: `${rel}/\u0000loading`, name: "Loading...", kind: "other", depth, symlink: false, hidden: false, note: "loading" });
        return;
      }
      if (state.status === "error") {
        out.push({ rel: `${rel}/\u0000error`, name: state.error ?? "Could not read this folder.", kind: "other", depth, symlink: false, hidden: false, note: "error" });
        return;
      }
      if (state.status === "ready" && state.entries.length === 0 && rel !== "") {
        out.push({ rel: `${rel}/\u0000empty`, name: "Empty folder", kind: "other", depth, symlink: false, hidden: false, note: "empty" });
      }
      for (const e of state.entries) {
        const child = joinRel(rel, e.name);
        out.push({ rel: child, name: e.name, kind: e.kind, depth, symlink: e.symlink, hidden: e.hidden });
        if (e.kind === "dir" && expanded.has(child)) walk(child, depth + 1);
      }
      if (state.truncated) {
        out.push({ rel: `${rel}/\u0000more`, name: "Only the first entries are shown.", kind: "other", depth, symlink: false, hidden: false, note: "empty" });
      }
    };
    walk("", 0);
    return out;
  }, [dirs, expanded]);

  const toggle = useCallback(
    (rel: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(rel)) next.delete(rel);
        else {
          next.add(rel);
          void load(rel);
        }
        return next;
      });
    },
    [load],
  );

  /** Directory that new items go into: the selection if it is a folder, else its parent. */
  const targetDir = useCallback((): string => {
    if (!selected) return "";
    return selected.kind === "dir" ? selected.rel : parentRel(selected.rel);
  }, [selected]);

  const createEntry = useCallback(
    async (kind: "file" | "dir", parent = targetDir()) => {
      const name = await promptDialog({
        title: kind === "file" ? "New file" : "New folder",
        label: `Name (in ${parent || "project root"})`,
        validate: validateEntryName,
        confirmLabel: "Create",
      });
      if (!name) return;
      try {
        await ipc.fsCreate(root, parent, name.trim(), kind);
        setExpanded((p) => new Set(p).add(parent));
        await load(parent);
        setSelected({ rel: joinRel(parent, name.trim()), kind: kind === "dir" ? "dir" : "file" });
      } catch (e) {
        void reportError("Could not create it", e);
      }
    },
    [root, load, targetDir],
  );

  const renameEntry = useCallback(
    async (rel: string) => {
      const oldName = baseName(rel);
      const name = await promptDialog({
        title: "Rename",
        label: "New name",
        initial: oldName,
        validate: (v) => (v === oldName ? "Choose a different name." : validateEntryName(v)),
        confirmLabel: "Rename",
      });
      if (!name) return;
      try {
        await ipc.fsRename(root, rel, name.trim());
        const parent = parentRel(rel);
        await load(parent);
        setSelected((s) => (s && s.rel === rel ? { rel: joinRel(parent, name.trim()), kind: s.kind } : s));
      } catch (e) {
        void reportError("Could not rename it", e);
      }
    },
    [root, load],
  );

  const deleteEntry = useCallback(
    async (rel: string, kind: EntryKind) => {
      const name = baseName(rel);
      if (confirmDelete) {
        const ok = await confirmDialog({
          title: kind === "dir" ? "Delete folder?" : "Delete file?",
          message:
            kind === "dir"
              ? `"${name}" and everything inside it will be permanently deleted. This cannot be undone.`
              : `"${name}" will be permanently deleted. This cannot be undone.`,
          detail: rel,
          confirmLabel: "Delete permanently",
          danger: true,
        });
        if (!ok) return;
      }
      try {
        await ipc.fsDelete(root, rel);
        toast("success", `Deleted ${name}.`);
        setSelected(null);
        await load(parentRel(rel));
      } catch (e) {
        void reportError("Could not delete it", e);
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
          if (!distro) throw new Error("Choose a distribution first (Environments view).");
          linuxPath = await ipc.wslToLinuxPath(distro, loc.path);
        }
        insertIntoActive(shellQuote(linuxPath) + " ");
      } catch (e) {
        void reportError("Could not insert the path", e);
      }
    },
    [root],
  );

  useImperativeHandle(ref, () => ({ refresh, newEntry: (kind) => void createEntry(kind) }), [refresh, createEntry]);

  const menuItems = useMemo((): (MenuItem | "separator")[] => {
    if (!menu) return [];
    const isDir = menu.kind === "dir";
    const inDir = isDir ? menu.rel : parentRel(menu.rel);
    return [
      { id: "new-file", label: "New file...", icon: <FilePlus size={14} />, onSelect: () => void createEntry("file", inDir) },
      { id: "new-folder", label: "New folder...", icon: <FolderPlus size={14} />, onSelect: () => void createEntry("dir", inDir) },
      "separator",
      {
        id: "terminal",
        label: "Open in terminal",
        icon: <TerminalSquare size={14} />,
        onSelect: () => void openTerminal({ cwd: childLocation(root, inDir) }),
      },
      { id: "insert", label: "Insert path in terminal", icon: <ClipboardPaste size={14} />, onSelect: () => void insertPath(menu.rel) },
      "separator",
      { id: "rename", label: "Rename...", icon: <Pencil size={14} />, onSelect: () => void renameEntry(menu.rel) },
      { id: "delete", label: "Delete...", icon: <Trash2 size={14} />, danger: true, onSelect: () => void deleteEntry(menu.rel, menu.kind) },
    ];
  }, [menu, root, createEntry, renameEntry, deleteEntry, insertPath]);

  const real = rows.filter((r) => !r.note);
  function onKeyDown(e: React.KeyboardEvent) {
    const idx = selected ? real.findIndex((r) => r.rel === selected.rel) : -1;
    const cur = idx >= 0 ? real[idx] : undefined;
    const select = (r?: Row) => r && setSelected({ rel: r.rel, kind: r.kind });
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        select(real[Math.min(real.length - 1, idx + 1)]);
        break;
      case "ArrowUp":
        e.preventDefault();
        select(real[Math.max(0, idx - 1)]);
        break;
      case "ArrowRight":
        if (cur?.kind === "dir") {
          e.preventDefault();
          if (!expanded.has(cur.rel)) toggle(cur.rel);
          else select(real[idx + 1]);
        }
        break;
      case "ArrowLeft":
        if (cur) {
          e.preventDefault();
          if (cur.kind === "dir" && expanded.has(cur.rel)) toggle(cur.rel);
          else select(real.find((r) => r.rel === parentRel(cur.rel)));
        }
        break;
      case "Enter":
        if (cur?.kind === "dir") {
          e.preventDefault();
          toggle(cur.rel);
        }
        break;
      case "F2":
        if (cur) {
          e.preventDefault();
          void renameEntry(cur.rel);
        }
        break;
      case "Delete":
        if (cur) {
          e.preventDefault();
          void deleteEntry(cur.rel, cur.kind);
        }
        break;
      case "ContextMenu":
      case "F10":
        if (cur && (e.key === "ContextMenu" || e.shiftKey)) {
          e.preventDefault();
          const el = treeRef.current?.querySelector<HTMLElement>(`[data-rel="${CSS.escape(cur.rel)}"]`);
          const r = el?.getBoundingClientRect();
          setMenu({ x: (r?.left ?? 100) + 24, y: (r?.bottom ?? 100) + 2, rel: cur.rel, kind: cur.kind });
        }
        break;
    }
  }

  const activeId = selected ? `tree-${selected.rel}` : undefined;

  return (
    <>
      <div
        ref={treeRef}
        role="tree"
        aria-label="Project files"
        tabIndex={0}
        aria-activedescendant={activeId}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest("[data-rel]")) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, rel: "", kind: "dir" });
        }}
        className="min-h-0 flex-1 overflow-auto py-1 outline-none focus-visible:outline-offset-[-2px]"
      >
        {rows.map((r) => {
          if (r.note) {
            return (
              <div
                key={r.rel}
                style={{ paddingLeft: 8 + r.depth * 14 + 18 }}
                className={cn("flex items-center gap-1.5 py-0.5 pr-2 text-xs", r.note === "error" ? "text-danger" : "text-muted")}
              >
                {r.note === "loading" && <LoaderCircle size={12} className="animate-spin" />}
                <span className="selectable truncate">{r.name}</span>
              </div>
            );
          }
          const isDir = r.kind === "dir";
          const isOpen = isDir && expanded.has(r.rel);
          const isSel = selected?.rel === r.rel;
          return (
            <div
              key={r.rel}
              id={`tree-${r.rel}`}
              data-rel={r.rel}
              role="treeitem"
              aria-level={r.depth + 1}
              aria-expanded={isDir ? isOpen : undefined}
              aria-selected={isSel}
              style={{ paddingLeft: 8 + r.depth * 14 }}
              onClick={() => {
                setSelected({ rel: r.rel, kind: r.kind });
                if (isDir) toggle(r.rel);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setSelected({ rel: r.rel, kind: r.kind });
                setMenu({ x: e.clientX, y: e.clientY, rel: r.rel, kind: r.kind });
              }}
              className={cn(
                "flex h-[22px] cursor-default items-center gap-1 pr-2 text-[13px]",
                isSel ? "bg-active" : "hover:bg-hover",
                r.hidden && "opacity-60",
              )}
            >
              <span className="flex w-3.5 shrink-0 justify-center text-muted">
                {isDir ? isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
              </span>
              {isDir ? (
                isOpen ? <FolderOpen size={14} className="shrink-0 text-accent2" /> : <Folder size={14} className="shrink-0 text-accent2" />
              ) : (
                <FileIcon size={14} className="shrink-0 text-muted" />
              )}
              <span className="truncate">{r.name}</span>
              {r.symlink && <Link2 size={11} className="shrink-0 text-muted" aria-label="symbolic link" />}
            </div>
          );
        })}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </>
  );
});
