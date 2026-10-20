// Fichiers: a file manager for Windows drives and the WSL Linux filesystem.
// Folders navigate, source files open in Code Studio, everything else
// (.exe, .pdf, .docx...) opens with its Windows program.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bot,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Home,
  Image,
  LayoutGrid,
  List,
  Monitor,
  Music,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Server,
  TerminalSquare,
  Trash2,
  FileText,
  ExternalLink,
} from "lucide-react";
import { useWindow } from "@/components/desktop/windowContext";
import { FileIcon } from "@/components/explorer/fileIcons";
import { ContextMenu, type MenuItem } from "@/components/ui/ContextMenu";
import { currentDistro, linuxHome } from "@/features/agent/tools";
import { openInStudio, openLocation, revealInExplorer, runInTerminal } from "@/features/desktopActions";
import { openTerminal } from "@/features/terminalActions";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { fileKind, formatSize, isEditable, kindLabel, runCommand, runLang } from "@/lib/fileTypes";
import { fold } from "@/lib/fuzzy";
import { ipc } from "@/lib/ipc";
import { childLocation, locationDisplay, locationKey, locationName, parentLocation, sameLocation, validateEntryName } from "@/lib/paths";
import { askAgent } from "@/store/agent";
import { useDesktop } from "@/store/desktop";
import { useStudio } from "@/store/studio";
import { confirmDialog, promptDialog, toast } from "@/store/ui";
import { useWinApps } from "@/store/winapps";
import { useWorkspace } from "@/store/workspace";
import { usableDistros, useWsl } from "@/store/wsl";
import type { FsEntry, Location } from "@/types/ipc";

type SortKey = "name" | "modified" | "size";

const FOLDER_ICONS: Record<string, React.ReactNode> = {
  home: <Home size={15} />,
  desktop: <Monitor size={15} />,
  documents: <FileText size={15} />,
  downloads: <Download size={15} />,
  pictures: <Image size={15} />,
  music: <Music size={15} />,
};

function BigFolder({ size = 44 }: { size?: number }) {
  return <Folder size={size} strokeWidth={1.4} className="text-[#e9a23b]" fill="rgb(247 195 91 / 0.85)" aria-hidden />;
}

function crumbs(loc: Location): { label: string; loc: Location }[] {
  const out: { label: string; loc: Location }[] = [];
  let cur: Location | null = loc;
  while (cur) {
    const label =
      cur.kind === "linux" && cur.path === "/" ? cur.distro : cur.kind === "windows" && /^[A-Za-z]:\\?$/.test(cur.path) ? cur.path.slice(0, 2) : locationName(cur);
    out.unshift({ label, loc: cur });
    cur = parentLocation(cur);
  }
  return out;
}

function formatDate(ms: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return `${d.toLocaleDateString("fr-FR")} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

export default function FilesApp() {
  const { win, focused } = useWindow();
  const places = useWinApps((s) => s.places);
  const projects = useWorkspace((s) => s.recentProjects);
  const status = useWsl((s) => s.status);
  const [loc, setLoc] = useState<Location | null>(null);
  const [back, setBack] = useState<Location[]>([]);
  const [fwd, setFwd] = useState<Location[]>([]);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "name", desc: false });
  const [hidden, setHidden] = useState(false);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: (MenuItem | "separator")[] } | null>(null);
  const [linuxHomeLoc, setLinuxHomeLoc] = useState<Location | null>(null);
  const [homeTried, setHomeTried] = useState(false);
  const placesLoaded = useWinApps((s) => s.loaded);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void useWinApps.getState().ensure();
  }, []);

  // Linux home of the current distribution, for the sidebar and as the start folder.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const distro = await currentDistro();
        const home = await linuxHome(distro);
        if (alive) setLinuxHomeLoc({ kind: "linux", distro, path: home });
      } catch {
        /* WSL not available: Windows folders only */
      } finally {
        if (alive) setHomeTried(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [status]);

  const locRef = useRef<Location | null>(null);
  const navigate = useCallback((next: Location, mode: "push" | "back" | "fwd" | "replace" = "push") => {
    const cur = locRef.current;
    if (cur && sameLocation(cur, next)) return;
    if (cur && mode === "push") {
      setBack((b) => [...b, cur].slice(-50));
      setFwd([]);
    }
    locRef.current = next;
    setLoc(next);
    setSelected(new Set());
    setFilter("");
  }, []);

  // Start folder: launch argument, else Linux home, else Windows home.
  useEffect(() => {
    const arg = win.args.location as Location | undefined;
    if (arg) navigate(arg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.args.nonce]);
  useEffect(() => {
    if (loc) return;
    if (linuxHomeLoc) navigate(linuxHomeLoc, "replace");
    else if (places?.home) navigate({ kind: "windows", path: places.home }, "replace");
  }, [loc, linuxHomeLoc, places, navigate]);

  // Listings arrive out of order (a WSL folder lists slower than a Windows one):
  // only the latest request counts, and entries remember which folder they describe.
  const requestId = useRef(0);
  const [entriesFor, setEntriesFor] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!loc) return;
    const id = ++requestId.current;
    const key = locationKey(loc);
    setLoading(true);
    setError(null);
    try {
      const listing = await ipc.fsListDir(loc, "", hidden);
      if (id !== requestId.current) return;
      setEntries(listing.entries);
      setEntriesFor(key);
    } catch (e) {
      if (id !== requestId.current) return;
      setEntries([]);
      setEntriesFor(key);
      setError(errorMessage(e));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [loc, hidden]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (loc) useDesktop.getState().setTitle(win.id, locationName(loc));
  }, [loc, win.id]);

  const current = loc && entriesFor === locationKey(loc) ? entries : null;
  const shown = useMemo(() => {
    if (!current) return [];
    const f = fold(filter.trim());
    const list = f ? current.filter((e) => fold(e.name).includes(f)) : [...current];
    const dir = sort.desc ? -1 : 1;
    list.sort((a, b) => {
      if ((a.kind === "dir") !== (b.kind === "dir")) return a.kind === "dir" ? -1 : 1;
      if (sort.key === "size") return (a.size - b.size) * dir;
      if (sort.key === "modified") return ((a.modifiedMs ?? 0) - (b.modifiedMs ?? 0)) * dir;
      return a.name.localeCompare(b.name, "fr", { numeric: true, sensitivity: "base" }) * dir;
    });
    return list;
  }, [current, filter, sort]);

  if (!loc) {
    const stuck = homeTried && placesLoaded && !linuxHomeLoc && !places?.home;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-[13px] text-muted">
        {stuck ? (
          <>
            <p className="text-fg2">Aucun dossier n'est accessible pour le moment.</p>
            <p className="max-w-sm text-[12px]">Fichiers fonctionne dans l'application de bureau rAImy OS, avec WSL ou vos dossiers Windows.</p>
          </>
        ) : (
          "Chargement…"
        )}
      </div>
    );
  }
  const here: Location = loc;

  const childOf = (e: FsEntry) => childLocation(here, e.name);

  async function openEntry(e: FsEntry) {
    if (e.kind === "dir") navigate(childOf(e));
    else await openLocation(childOf(e), false);
  }

  function goBack() {
    const prev = back[back.length - 1];
    if (!prev) return;
    setBack((b) => b.slice(0, -1));
    setFwd((f) => [here, ...f]);
    navigate(prev, "back");
  }
  function goFwd() {
    const next = fwd[0];
    if (!next) return;
    setFwd((f) => f.slice(1));
    setBack((b) => [...b, here]);
    navigate(next, "fwd");
  }
  function goUp() {
    const p = parentLocation(here);
    if (p) navigate(p);
  }

  async function createEntry(kind: "file" | "dir") {
    const name = await promptDialog({
      title: kind === "dir" ? "Nouveau dossier" : "Nouveau fichier",
      label: "Nom",
      initial: kind === "dir" ? "nouveau-dossier" : "main.c",
      confirmLabel: "Créer",
      validate: (v) => validateEntryName(v) ?? (entries.some((e) => e.name === v) ? "Ce nom existe déjà." : null),
    });
    if (!name) return;
    try {
      await ipc.fsCreate(here, "", name, kind);
      await load();
      setSelected(new Set([name]));
      if (kind === "file" && isEditable(name)) void openInStudio(childLocation(here, name));
    } catch (e) {
      toast("error", errorMessage(e));
    }
  }

  async function rename(e: FsEntry) {
    const name = await promptDialog({
      title: "Renommer",
      label: "Nouveau nom",
      initial: e.name,
      confirmLabel: "Renommer",
      validate: (v) => validateEntryName(v) ?? (v !== e.name && entries.some((x) => x.name === v) ? "Ce nom existe déjà." : null),
    });
    if (!name || name === e.name) return;
    try {
      await ipc.fsRename(here, e.name, name);
      await load();
      setSelected(new Set([name]));
    } catch (err) {
      toast("error", errorMessage(err));
    }
  }

  async function remove(list: FsEntry[]) {
    if (list.length === 0) return;
    const ok = await confirmDialog({
      title: list.length === 1 ? `Supprimer « ${list[0]!.name} » ?` : `Supprimer ${list.length} éléments ?`,
      message: "La suppression est définitive : les éléments ne vont pas dans la corbeille.",
      detail: list.map((e) => e.name).join("\n"),
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    for (const e of list) {
      try {
        await ipc.fsDelete(here, e.name);
      } catch (err) {
        toast("error", `${e.name} : ${errorMessage(err)}`);
      }
    }
    setSelected(new Set());
    await load();
  }

  function pinToDesktop(target: Location, name: string, isDir: boolean) {
    useDesktop.getState().addItem({ id: `loc:${locationKey(target)}`, kind: "location", name, location: target, isDir });
    toast("success", `${name} est épinglé sur le bureau.`);
  }

  function entryMenu(e: FsEntry): (MenuItem | "separator")[] {
    const target = childOf(e);
    const lang = e.kind === "file" ? runLang(e.name) : null;
    const multi = selected.size > 1 && selected.has(e.name) ? shown.filter((x) => selected.has(x.name)) : [e];
    const items: (MenuItem | "separator")[] = [
      { id: "open", label: "Ouvrir", icon: <ExternalLink size={13} />, onSelect: () => void openEntry(e) },
    ];
    if (e.kind === "dir") {
      items.push(
        { id: "newwin", label: "Ouvrir dans une nouvelle fenêtre", icon: <FolderOpen size={13} />, onSelect: () => useDesktop.getState().openApp("files", { args: { location: target }, newWindow: true }) },
        { id: "term", label: "Ouvrir un terminal ici", icon: <TerminalSquare size={13} />, onSelect: () => void openTerminal({ cwd: target }) },
        { id: "project", label: "Ouvrir comme projet (Workspace)", icon: <Code2 size={13} />, onSelect: () => useWorkspace.getState().openProject(target) },
      );
    } else {
      if (isEditable(e.name)) items.push({ id: "studio", label: "Ouvrir dans Code Studio", icon: <Code2 size={13} />, onSelect: () => void openInStudio(target) });
      if (lang)
        items.push({
          id: "run",
          label: lang === "c" || lang === "cpp" ? "Compiler et exécuter" : "Exécuter",
          icon: <Play size={13} />,
          onSelect: () => void runInTerminal(runCommand(e.name, lang, useStudio.getState().runOptions), here),
        });
      if (isEditable(e.name))
        items.push({
          id: "ask",
          label: "Expliquer avec rAImy",
          icon: <Bot size={13} />,
          onSelect: () => askAgent(`Explique-moi ce que fait le fichier ${locationDisplay(target)} (lis-le d'abord).`, { fresh: true }),
        });
    }
    items.push(
      "separator",
      { id: "pin", label: "Épingler au bureau", icon: <Monitor size={13} />, onSelect: () => pinToDesktop(target, e.name, e.kind === "dir") },
      {
        id: "copy",
        label: "Copier le chemin",
        icon: <Copy size={13} />,
        onSelect: () => void navigator.clipboard.writeText(target.kind === "linux" ? target.path : target.path).then(() => toast("info", "Chemin copié.")),
      },
      { id: "reveal", label: "Afficher dans l'Explorateur Windows", icon: <FolderOpen size={13} />, onSelect: () => void revealInExplorer(target) },
      "separator",
      { id: "rename", label: "Renommer", icon: <Pencil size={13} />, disabled: multi.length > 1, onSelect: () => void rename(e) },
      { id: "delete", label: multi.length > 1 ? `Supprimer ${multi.length} éléments` : "Supprimer", icon: <Trash2 size={13} />, danger: true, onSelect: () => void remove(multi) },
    );
    return items;
  }

  function backgroundMenu(): (MenuItem | "separator")[] {
    return [
      { id: "nd", label: "Nouveau dossier", icon: <FolderPlus size={13} />, onSelect: () => void createEntry("dir") },
      { id: "nf", label: "Nouveau fichier", icon: <FilePlus2 size={13} />, onSelect: () => void createEntry("file") },
      "separator",
      { id: "term", label: "Ouvrir un terminal ici", icon: <TerminalSquare size={13} />, onSelect: () => void openTerminal({ cwd: here }) },
      { id: "pin", label: "Épingler ce dossier au bureau", icon: <Monitor size={13} />, onSelect: () => pinToDesktop(here, locationName(here), true) },
      { id: "reveal", label: "Ouvrir dans l'Explorateur Windows", icon: <FolderOpen size={13} />, onSelect: () => void revealInExplorer(here) },
      { id: "refresh", label: "Actualiser", icon: <RefreshCw size={13} />, onSelect: () => void load() },
    ];
  }

  function onKeyDown(ev: React.KeyboardEvent) {
    if ((ev.target as HTMLElement).tagName === "INPUT") return;
    const sel = shown.filter((e) => selected.has(e.name));
    if (ev.key === "Enter" && sel[0]) void openEntry(sel[0]);
    else if (ev.key === "F2" && sel[0]) void rename(sel[0]);
    else if (ev.key === "Delete" && sel.length) void remove(sel);
    else if (ev.key === "Backspace" || (ev.altKey && ev.key === "ArrowLeft")) goBack();
    else if (ev.altKey && ev.key === "ArrowRight") goFwd();
    else if (ev.altKey && ev.key === "ArrowUp") goUp();
    else if (ev.ctrlKey && ev.key.toLowerCase() === "a") setSelected(new Set(shown.map((e) => e.name)));
    else if (ev.ctrlKey && ev.key.toLowerCase() === "l") setEditing(locationDisplay(here));
    else if (ev.key === "F5") void load();
    else return;
    ev.preventDefault();
  }

  function select(ev: React.MouseEvent, e: FsEntry) {
    ev.stopPropagation();
    setSelected((s) => {
      if (ev.ctrlKey) {
        const n = new Set(s);
        if (n.has(e.name)) n.delete(e.name);
        else n.add(e.name);
        return n;
      }
      if (ev.shiftKey && s.size) {
        const names = shown.map((x) => x.name);
        const last = names.indexOf([...s][s.size - 1]!);
        const cur = names.indexOf(e.name);
        return new Set(names.slice(Math.min(last, cur), Math.max(last, cur) + 1));
      }
      return new Set([e.name]);
    });
  }

  const sidebarLinux = usableDistros(status);
  const selEntries = shown.filter((e) => selected.has(e.name));
  const selSize = selEntries.reduce((n, e) => n + (e.kind === "file" ? e.size : 0), 0);

  return (
    <div ref={rootRef} className="flex h-full outline-none" tabIndex={-1} onKeyDown={onKeyDown}>
      {/* Sidebar */}
      <aside className="w-52 shrink-0 overflow-y-auto border-r border-line bg-surface px-2 py-3">
        <SideGroup title="Accès rapide">
          {linuxHomeLoc && <SideItem icon={<Home size={15} className="text-[#f2733b]" />} label="Accueil Linux" active={sameLocation(here, linuxHomeLoc)} onClick={() => navigate(linuxHomeLoc)} />}
          {places?.folders.map((f) => (
            <SideItem
              key={f.id}
              icon={FOLDER_ICONS[f.id] ?? <Folder size={15} />}
              label={f.label}
              active={here.kind === "windows" && here.path.toLowerCase() === f.path.toLowerCase()}
              onClick={() => navigate({ kind: "windows", path: f.path })}
            />
          ))}
        </SideGroup>
        {projects.length > 0 && (
          <SideGroup title="Projets récents">
            {projects.slice(0, 5).map((p) => (
              <SideItem key={locationKey(p.location)} icon={<Folder size={15} className="text-[#e9a23b]" />} label={p.name} active={sameLocation(here, p.location)} onClick={() => navigate(p.location)} />
            ))}
          </SideGroup>
        )}
        <SideGroup title="Ce PC">
          {places?.drives.map((d) => (
            <SideItem key={d} icon={<HardDrive size={15} />} label={`Disque (${d.slice(0, 2)})`} active={here.kind === "windows" && here.path.toLowerCase() === d.toLowerCase()} onClick={() => navigate({ kind: "windows", path: d })} />
          ))}
          {sidebarLinux.map((d) => (
            <SideItem
              key={d.name}
              icon={<Server size={15} className="text-[#f2733b]" />}
              label={`Linux · ${d.name}`}
              active={here.kind === "linux" && here.distro === d.name && here.path === "/"}
              onClick={() => navigate({ kind: "linux", distro: d.name, path: "/" })}
            />
          ))}
        </SideGroup>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b border-line bg-surface px-2 py-1.5">
          <NavButton label="Précédent (Alt+←)" disabled={back.length === 0} onClick={goBack}>
            <ArrowLeft size={15} />
          </NavButton>
          <NavButton label="Suivant (Alt+→)" disabled={fwd.length === 0} onClick={goFwd}>
            <ArrowRight size={15} />
          </NavButton>
          <NavButton label="Dossier parent (Alt+↑)" disabled={!parentLocation(here)} onClick={goUp}>
            <ArrowUp size={15} />
          </NavButton>
          <NavButton label="Actualiser (F5)" onClick={() => void load()}>
            <RefreshCw size={14} className={cn(loading && "animate-spin")} />
          </NavButton>

          {/* Address bar */}
          <div className="mx-1 flex h-8 min-w-0 flex-1 items-center rounded-lg border border-line bg-bg px-1">
            {editing !== null ? (
              <input
                autoFocus
                value={editing}
                onChange={(e) => setEditing(e.target.value)}
                onBlur={() => setEditing(null)}
                onKeyDown={async (e) => {
                  if (e.key === "Escape") setEditing(null);
                  if (e.key === "Enter") {
                    try {
                      const r = await ipc.fsResolveLocation(editing, here.kind === "linux" ? here.distro : await currentDistro().catch(() => null));
                      if (!r.exists) toast("error", `${r.display} n'existe pas.`);
                      else if (r.isDir) navigate(r.location);
                      else void openLocation(r.location, false);
                      setEditing(null);
                    } catch (err) {
                      toast("error", errorMessage(err));
                    }
                  }
                }}
                className="selectable h-full w-full bg-transparent px-2 font-mono text-[12px] outline-none"
              />
            ) : (
              <div className="flex min-w-0 flex-1 items-center overflow-hidden" onClick={() => setEditing(locationDisplay(here))}>
                {crumbs(here).map((c, i, all) => (
                  <span key={locationKey(c.loc)} className="flex shrink-0 items-center last:shrink">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(c.loc);
                      }}
                      className={cn("truncate rounded-md px-1.5 py-0.5 text-[12px] hover:bg-hover", i === all.length - 1 ? "text-fg" : "text-muted")}
                    >
                      {c.label}
                    </button>
                    {i < all.length - 1 && <ChevronRight size={12} className="text-faint" />}
                  </span>
                ))}
                <span className="h-full flex-1 cursor-text" />
              </div>
            )}
          </div>

          <label className="flex h-8 w-44 items-center gap-1.5 rounded-lg border border-line bg-bg px-2 focus-within:border-accent/60">
            <Search size={13} className="text-muted" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrer" className="h-full min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-faint" />
          </label>
        </div>

        <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1">
          <ToolButton icon={<FolderPlus size={14} />} label="Nouveau dossier" onClick={() => void createEntry("dir")} />
          <ToolButton icon={<FilePlus2 size={14} />} label="Nouveau fichier" onClick={() => void createEntry("file")} />
          <span className="mx-1 h-4 w-px bg-line" />
          <ToolButton icon={<TerminalSquare size={14} />} label="Terminal ici" onClick={() => void openTerminal({ cwd: here })} />
          <ToolButton icon={<FolderOpen size={14} />} label="Explorateur Windows" onClick={() => void revealInExplorer(here)} />
          <div className="flex-1" />
          <select
            value={`${sort.key}:${sort.desc ? "d" : "a"}`}
            onChange={(e) => {
              const [k, d] = e.target.value.split(":");
              setSort({ key: k as SortKey, desc: d === "d" });
            }}
            className="h-7 rounded-md border border-line bg-bg px-1.5 text-[11.5px] text-fg2 outline-none"
          >
            <option value="name:a">Nom (A→Z)</option>
            <option value="name:d">Nom (Z→A)</option>
            <option value="modified:d">Plus récents</option>
            <option value="modified:a">Plus anciens</option>
            <option value="size:d">Plus gros</option>
          </select>
          <NavButton label={hidden ? "Masquer les fichiers cachés" : "Afficher les fichiers cachés"} onClick={() => setHidden((h) => !h)}>
            {hidden ? <Eye size={14} /> : <EyeOff size={14} />}
          </NavButton>
          <NavButton label="Grille" active={view === "grid"} onClick={() => setView("grid")}>
            <LayoutGrid size={14} />
          </NavButton>
          <NavButton label="Détails" active={view === "list"} onClick={() => setView("list")}>
            <List size={14} />
          </NavButton>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto p-2"
          onClick={() => setSelected(new Set())}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, items: backgroundMenu() });
          }}
        >
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <p className="text-[13px] text-warn">{error}</p>
              <button type="button" onClick={goUp} className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-fg2 hover:bg-hover">
                Revenir au dossier parent
              </button>
            </div>
          ) : shown.length === 0 && !loading && current ? (
            <p className="p-10 text-center text-[13px] text-muted">{filter ? "Aucun élément ne correspond au filtre." : "Ce dossier est vide."}</p>
          ) : view === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1">
              {shown.map((e) => {
                const sel = selected.has(e.name);
                return (
                  <button
                    key={e.name}
                    type="button"
                    title={`${e.name}\n${kindLabel(fileKind(e.name, e.kind === "dir"))}${e.kind === "file" ? ` · ${formatSize(e.size)}` : ""}`}
                    onClick={(ev) => select(ev, e)}
                    onDoubleClick={() => void openEntry(e)}
                    onContextMenu={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      if (!selected.has(e.name)) setSelected(new Set([e.name]));
                      setMenu({ x: ev.clientX, y: ev.clientY, items: entryMenu(e) });
                    }}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg px-1.5 py-2.5 transition-colors",
                      sel ? "bg-active ring-1 ring-accent/50" : "hover:bg-hover",
                      e.hidden && "opacity-60",
                    )}
                  >
                    <span className="flex h-11 items-center justify-center">{e.kind === "dir" ? <BigFolder /> : <FileIcon name={e.name} size={34} />}</span>
                    <span className="line-clamp-2 w-full break-all text-center text-[11.5px] leading-tight text-fg2">{e.name}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 bg-bg text-[11px] text-muted">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Nom</th>
                  <th className="px-2 py-1.5 font-medium">Modifié le</th>
                  <th className="px-2 py-1.5 font-medium">Type</th>
                  <th className="px-2 py-1.5 text-right font-medium">Taille</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr
                    key={e.name}
                    onClick={(ev) => select(ev, e)}
                    onDoubleClick={() => void openEntry(e)}
                    onContextMenu={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      if (!selected.has(e.name)) setSelected(new Set([e.name]));
                      setMenu({ x: ev.clientX, y: ev.clientY, items: entryMenu(e) });
                    }}
                    className={cn("cursor-default", selected.has(e.name) ? "bg-active" : "hover:bg-hover", e.hidden && "opacity-60")}
                  >
                    <td className="flex items-center gap-2 px-2 py-1.5 text-fg">
                      {e.kind === "dir" ? <BigFolder size={16} /> : <FileIcon name={e.name} size={16} />}
                      <span className="truncate">{e.name}</span>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[11px] text-muted">{formatDate(e.modifiedMs)}</td>
                    <td className="px-2 py-1.5 text-muted">{kindLabel(fileKind(e.name, e.kind === "dir"))}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-[11px] text-muted">{e.kind === "file" ? formatSize(e.size) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={cn("flex shrink-0 items-center justify-between border-t border-line px-3 py-1 text-[11px] text-muted", !focused && "opacity-80")}>
          <span>
            {shown.length} élément{shown.length > 1 ? "s" : ""}
            {selEntries.length > 0 && ` · ${selEntries.length} sélectionné${selEntries.length > 1 ? "s" : ""}${selSize ? ` (${formatSize(selSize)})` : ""}`}
          </span>
          <span className="truncate font-mono text-faint">{locationDisplay(here)}</span>
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function SideGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function SideItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors", active ? "bg-active text-fg" : "text-fg2 hover:bg-hover")}
    >
      <span className="shrink-0 text-muted">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function NavButton({ label, disabled, active, onClick, children }: { label: string; disabled?: boolean; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn("flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent", active && "bg-active text-fg")}
    >
      {children}
    </button>
  );
}

function ToolButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-fg2 transition-colors hover:bg-hover hover:text-fg">
      {icon}
      {label}
    </button>
  );
}
