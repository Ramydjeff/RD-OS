// The taskbar: start, search, pinned and running apps, and the system tray.
// Empty space drags the OS window when it is not maximized.

import { useEffect, useState } from "react";
import { Bot, Pin, PinOff, Search, SlidersHorizontal, SquarePlus, X } from "lucide-react";
import { AppIcon, WinAppIcon } from "@/components/desktop/AppIcon";
import { APPS } from "@/components/desktop/apps";
import { ContextMenu, type MenuItem } from "@/components/ui/ContextMenu";
import { RaimyIcon } from "@/components/ui/RaimyLogo";
import { launchWinApp } from "@/features/desktopActions";
import { cn } from "@/lib/cn";
import { useDesktop, pinKey, type AppId, type PinnedItem } from "@/store/desktop";
import { useMonitor } from "@/store/monitor";
import { chooseDistro, useWsl } from "@/store/wsl";

export function useClock(stepMs = 10_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}

function TaskButton({
  label,
  active,
  running,
  focused,
  onClick,
  onContextMenu,
  children,
}: {
  label: string;
  active?: boolean;
  running: number;
  focused: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "group tile-host relative flex h-11 w-11 items-center justify-center rounded-xl transition-[background-color] duration-150",
        focused ? "bg-glass-hover" : "hover:bg-glass",
      )}
    >
      {children}
      <span role="tooltip" className="task-tip os-glass-strong pointer-events-none absolute bottom-[calc(100%+12px)] left-1/2 rounded-lg px-2.5 py-1 text-[11.5px] font-medium whitespace-nowrap text-fg shadow-[var(--shadow)]">
        {label}
      </span>
      {running > 0 && (
        <span
          aria-hidden
          className={cn(
            "task-dot absolute bottom-0.5 h-[3px] rounded-full",
            focused ? "w-4 bg-accent shadow-[0_0_8px_var(--accent)]" : "w-1.5 bg-muted",
          )}
        />
      )}
    </button>
  );
}

export function Taskbar() {
  const pinned = useDesktop((s) => s.pinned);
  const windows = useDesktop((s) => s.windows);
  const focusedId = useDesktop((s) => s.focusedId);
  const overlay = useDesktop((s) => s.overlay);
  const toggleOverlay = useDesktop((s) => s.toggleOverlay);
  const [menu, setMenu] = useState<{ x: number; y: number; items: (MenuItem | "separator")[] } | null>(null);

  const live = windows.filter((w) => w.phase !== "closing");
  const focusedApp = live.find((w) => w.id === focusedId && !w.minimized)?.app ?? null;
  const entries: PinnedItem[] = [...pinned];
  for (const w of live) {
    if (!entries.some((p) => p.kind === "app" && p.app === w.app)) entries.push({ kind: "app", app: w.app });
  }

  function clickApp(app: AppId) {
    const d = useDesktop.getState();
    const mine = live.filter((w) => w.app === app).sort((a, b) => b.z - a.z);
    if (mine.length === 0) return void d.openApp(app);
    if (mine.length === 1) return d.toggleMinimize(mine[0]!.id);
    // Several windows: bring the next one forward each click.
    if (focusedApp === app) d.focus(mine[mine.length - 1]!.id);
    else d.focus(mine[0]!.id);
  }

  function entryMenu(e: React.MouseEvent, item: PinnedItem) {
    e.preventDefault();
    const d = useDesktop.getState();
    const isPinned = pinned.some((p) => pinKey(p) === pinKey(item));
    const items: (MenuItem | "separator")[] = [];
    if (item.kind === "app") {
      const meta = APPS[item.app];
      items.push({
        id: "new",
        label: item.app === "files" ? "Nouvelle fenêtre" : `Ouvrir ${meta.name}`,
        icon: <SquarePlus size={13} />,
        onSelect: () => d.openApp(item.app, { newWindow: true }),
      });
    }
    items.push({
      id: "pin",
      label: isPinned ? "Désépingler de la barre des tâches" : "Épingler à la barre des tâches",
      icon: isPinned ? <PinOff size={13} /> : <Pin size={13} />,
      onSelect: () => (isPinned ? d.unpin(item) : d.pin(item)),
    });
    if (item.kind === "app" && live.some((w) => w.app === item.app)) {
      items.push("separator", {
        id: "close",
        label: live.filter((w) => w.app === item.app).length > 1 ? "Fermer toutes les fenêtres" : "Fermer la fenêtre",
        icon: <X size={13} />,
        danger: true,
        onSelect: () => d.closeApp(item.app),
      });
    }
    setMenu({ x: e.clientX, y: e.clientY - 8, items });
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-2 pb-1.5">
      <nav
        aria-label="Barre des tâches"
        data-tauri-drag-region
        className="os-glass-strong pointer-events-auto grid h-[50px] w-full grid-cols-[1fr_auto_1fr] items-center rounded-2xl px-1.5 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.6)]"
      >
        {/* Start + search */}
        <div className="flex items-center gap-1.5" data-tauri-drag-region>
          <button
            type="button"
            aria-label="Démarrer"
            title="Démarrer"
            aria-expanded={overlay === "start"}
            onClick={() => toggleOverlay("start")}
            className={cn(
              "group flex h-11 w-11 items-center justify-center rounded-xl transition-[background-color,transform] active:scale-90",
              overlay === "start" ? "bg-glass-hover" : "hover:bg-glass",
            )}
          >
            <RaimyIcon size={22} className="transition-[filter,transform] duration-300 group-hover:scale-110 group-hover:drop-shadow-[0_0_10px_rgb(244_63_82/0.55)]" />
          </button>
          <button
            type="button"
            onClick={() => useDesktop.getState().openLauncher()}
            className="hidden h-9 w-60 items-center gap-2 rounded-xl border border-glass-line bg-glass px-3 text-left text-[12.5px] text-muted transition-colors hover:bg-glass-hover hover:text-fg md:flex"
          >
            <Search size={14} />
            <span className="flex-1 truncate">Rechercher…</span>
            <kbd className="rounded border border-glass-line px-1 font-mono text-[10px] text-faint">Ctrl ⇧ Espace</kbd>
          </button>
        </div>

        {/* Apps */}
        <div className="flex items-center gap-1">
          {entries.map((item) => {
            if (item.kind === "app") {
              const count = live.filter((w) => w.app === item.app).length;
              return (
                <TaskButton
                  key={pinKey(item)}
                  label={APPS[item.app].name}
                  running={count}
                  focused={focusedApp === item.app}
                  onClick={() => clickApp(item.app)}
                  onContextMenu={(e) => entryMenu(e, item)}
                >
                  <AppIcon app={item.app} size={30} />
                </TaskButton>
              );
            }
            return (
              <TaskButton
                key={pinKey(item)}
                label={item.name}
                running={0}
                focused={false}
                onClick={() => void launchWinApp(item.path, item.name)}
                onContextMenu={(e) => entryMenu(e, item)}
              >
                <WinAppIcon path={item.path} name={item.name} size={30} />
              </TaskButton>
            );
          })}
        </div>

        {/* Tray */}
        <Tray />
      </nav>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function Tray() {
  const status = useWsl((s) => s.status);
  const host = useMonitor((s) => s.host);
  const overlay = useDesktop((s) => s.overlay);
  const toggleOverlay = useDesktop((s) => s.toggleOverlay);
  const openApp = useDesktop((s) => s.openApp);
  const now = useClock();
  const distro = chooseDistro(status);
  const ramPct = host && host.systemMemoryTotal > 0 ? Math.round((host.systemMemoryUsed / host.systemMemoryTotal) * 100) : null;

  return (
    <div className="flex items-center justify-end gap-1" data-tauri-drag-region>
      <button
        type="button"
        onClick={() => openApp("environments")}
        title={status?.available ? `WSL : ${distro ?? "aucune distribution"}` : (status?.problem?.message ?? "WSL non détecté")}
        className="hidden h-8 items-center gap-1.5 rounded-lg px-2 text-[11.5px] text-fg2 transition-colors hover:bg-glass lg:flex"
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            status?.available && distro ? "bg-ok shadow-[0_0_6px_var(--ok)]" : status ? "bg-warn" : "bg-faint",
          )}
        />
        <span className="max-w-28 truncate font-mono text-[10.5px]">{distro ?? "WSL"}</span>
      </button>
      {ramPct !== null && (
        <button
          type="button"
          onClick={() => openApp("monitor")}
          title="Mémoire utilisée — ouvrir le Moniteur"
          className="hidden h-8 items-center gap-1.5 rounded-lg px-2 transition-colors hover:bg-glass xl:flex"
        >
          <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-glass-hover">
            <span
              className={cn("absolute inset-y-0 left-0 rounded-full", ramPct > 85 ? "bg-danger" : ramPct > 70 ? "bg-warn" : "bg-ok")}
              style={{ width: `${ramPct}%` }}
            />
          </span>
          <span className="font-mono text-[10.5px] text-muted">RAM {ramPct}%</span>
        </button>
      )}
      <button
        type="button"
        aria-label="Demander à rAImy"
        title="Demander à rAImy (Ctrl+Shift+A)"
        onClick={() => openApp("agent")}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-accent transition-colors hover:bg-glass"
      >
        <Bot size={16} />
      </button>
      <button
        type="button"
        aria-label="Réglages rapides"
        title="Réglages rapides"
        aria-expanded={overlay === "quick"}
        onClick={() => toggleOverlay("quick")}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg text-fg2 transition-colors",
          overlay === "quick" ? "bg-glass-hover" : "hover:bg-glass",
        )}
      >
        <SlidersHorizontal size={15} />
      </button>
      <button
        type="button"
        onClick={() => toggleOverlay("calendar")}
        aria-expanded={overlay === "calendar"}
        className={cn(
          "flex h-10 flex-col items-end justify-center rounded-lg px-2 leading-tight transition-colors",
          overlay === "calendar" ? "bg-glass-hover" : "hover:bg-glass",
        )}
      >
        <span className="font-mono text-[12px] font-medium text-fg tabular-nums">
          {now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className="text-[10.5px] text-muted tabular-nums">{now.toLocaleDateString("fr-FR")}</span>
      </button>
      <button
        type="button"
        aria-label="Afficher le bureau"
        title="Afficher le bureau (Ctrl+Alt+D)"
        onClick={() => useDesktop.getState().showDesktop()}
        className="ml-0.5 h-9 w-1.5 rounded-full border-l border-glass-line transition-colors hover:bg-glass-hover"
      />
    </div>
  );
}
