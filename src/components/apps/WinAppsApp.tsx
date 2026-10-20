// Applications: every Windows program from the Start Menu and the Windows
// desktop, searchable, launchable and pinnable to rAImy OS.

import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, LayoutGrid, List, Monitor, Pin, PinOff, Plus, RefreshCw, Search } from "lucide-react";
import { WinAppIcon } from "@/components/desktop/AppIcon";
import { ContextMenu, type MenuItem } from "@/components/ui/ContextMenu";
import { launchWinApp, revealInExplorer } from "@/features/desktopActions";
import { cn } from "@/lib/cn";
import { score } from "@/lib/fuzzy";
import { useDesktop } from "@/store/desktop";
import { toast } from "@/store/ui";
import { useWinApps } from "@/store/winapps";
import type { WinApp } from "@/types/ipc";

export default function WinAppsApp() {
  const apps = useWinApps((s) => s.apps);
  const loading = useWinApps((s) => s.loading);
  const error = useWinApps((s) => s.error);
  const pinned = useDesktop((s) => s.pinned);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [menu, setMenu] = useState<{ x: number; y: number; items: (MenuItem | "separator")[] } | null>(null);

  useEffect(() => {
    void useWinApps.getState().ensure();
  }, []);

  const shown = useMemo(() => {
    if (!query.trim()) return apps;
    return apps
      .map((a) => ({ a, s: score(query, a.name, a.group) }))
      .filter((x): x is { a: WinApp; s: number } => x.s !== null)
      .sort((x, y) => y.s - x.s)
      .map((x) => x.a);
  }, [apps, query]);

  function isPinned(a: WinApp) {
    return pinned.some((p) => p.kind === "winapp" && p.path.toLowerCase() === a.path.toLowerCase());
  }

  function showMenu(e: React.MouseEvent, a: WinApp) {
    e.preventDefault();
    const d = useDesktop.getState();
    const pin = { kind: "winapp" as const, name: a.name, path: a.path };
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { id: "open", label: "Lancer", onSelect: () => void launchWinApp(a.path, a.name) },
        isPinned(a)
          ? { id: "unpin", label: "Désépingler de la barre des tâches", icon: <PinOff size={13} />, onSelect: () => d.unpin(pin) }
          : { id: "pin", label: "Épingler à la barre des tâches", icon: <Pin size={13} />, onSelect: () => d.pin(pin) },
        {
          id: "desk",
          label: "Ajouter au bureau rAImy",
          icon: <Monitor size={13} />,
          onSelect: () => {
            d.addItem({ id: `win:${a.path.toLowerCase()}`, kind: "winapp", name: a.name, path: a.path });
            toast("success", `${a.name} est sur le bureau.`);
          },
        },
        "separator",
        { id: "reveal", label: "Ouvrir l'emplacement", icon: <FolderOpen size={13} />, onSelect: () => void revealInExplorer({ kind: "windows", path: a.path }) },
      ],
    });
  }

  async function addProgram() {
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        title: "Choisir un programme",
        filters: [{ name: "Programmes", extensions: ["exe", "lnk", "bat", "cmd", "msi", "url"] }],
      });
      if (typeof picked !== "string") return;
      const name = picked.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
      const d = useDesktop.getState();
      d.addItem({ id: `win:${picked.toLowerCase()}`, kind: "winapp", name, path: picked });
      d.pin({ kind: "winapp", name, path: picked });
      toast("success", `${name} a été ajouté au bureau et à la barre des tâches.`);
    } catch {
      toast("error", "Le sélecteur de fichiers n'est disponible que dans l'application de bureau.");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-4 py-3">
        <label className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-line bg-bg px-3 focus-within:border-accent/60">
          <Search size={14} className="text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Rechercher parmi ${apps.length} programmes…`}
            className="h-full flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
            onKeyDown={(e) => {
              if (e.key === "Enter" && shown[0]) void launchWinApp(shown[0].path, shown[0].name);
            }}
          />
        </label>
        <div className="flex rounded-lg border border-line p-0.5">
          <button type="button" aria-label="Grille" onClick={() => setView("grid")} className={cn("rounded-md p-1.5", view === "grid" ? "bg-active text-fg" : "text-muted")}>
            <LayoutGrid size={14} />
          </button>
          <button type="button" aria-label="Liste" onClick={() => setView("list")} className={cn("rounded-md p-1.5", view === "list" ? "bg-active text-fg" : "text-muted")}>
            <List size={14} />
          </button>
        </div>
        <button type="button" title="Actualiser" onClick={() => void useWinApps.getState().refresh()} className="rounded-lg border border-line p-2 text-muted hover:bg-hover hover:text-fg">
          <RefreshCw size={14} className={cn(loading && "animate-spin")} />
        </button>
        <button type="button" onClick={() => void addProgram()} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-semibold text-onaccent hover:bg-accent-hover">
          <Plus size={14} /> Ajouter un .exe
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error && <p className="m-3 rounded-lg border border-line bg-surface p-3 text-[12.5px] text-warn">{error}</p>}
        {!loading && shown.length === 0 && !error && <p className="p-8 text-center text-[13px] text-muted">Aucun programme trouvé.</p>}
        {view === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-1">
            {shown.map((a) => (
              <button
                key={a.path}
                type="button"
                title={a.path}
                onClick={() => void launchWinApp(a.path, a.name)}
                onContextMenu={(e) => showMenu(e, a)}
                className="tile-host flex flex-col items-center gap-2 rounded-xl px-2 py-3 transition-colors hover:bg-hover"
              >
                <WinAppIcon path={a.path} name={a.name} size={44} />
                <span className="line-clamp-2 text-center text-[11.5px] leading-tight text-fg2">{a.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-line rounded-xl border border-line bg-surface">
            {shown.map((a) => (
              <button
                key={a.path}
                type="button"
                onClick={() => void launchWinApp(a.path, a.name)}
                onContextMenu={(e) => showMenu(e, a)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-hover"
              >
                <WinAppIcon path={a.path} name={a.name} size={28} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{a.name}</span>
                <span className="truncate text-[11px] text-faint">{a.group || (a.source === "desktop" ? "Bureau" : "Menu Démarrer")}</span>
                {isPinned(a) && <Pin size={12} className="text-accent" />}
              </button>
            ))}
          </div>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
