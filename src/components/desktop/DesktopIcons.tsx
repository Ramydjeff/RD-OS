// Desktop icons on a grid: click to select (Ctrl to add), drag to move, drag
// on empty space to select several, double-click or Enter to open.

import { useMemo, useRef, useState } from "react";
import {
  ArrowDownUp,
  Clock,
  Code2,
  ExternalLink,
  FileCode2,
  FolderOpen,
  Image,
  Pin,
  PinOff,
  RefreshCw,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { AppIcon, GlyphTile, Tile, WinAppIcon } from "@/components/desktop/AppIcon";
import { APPS } from "@/components/desktop/apps";
import { WALLPAPER_LABELS } from "@/components/desktop/Wallpaper";
import { FileIcon } from "@/components/explorer/fileIcons";
import { ContextMenu, type MenuItem } from "@/components/ui/ContextMenu";
import { newCodeFile, openDesktopItem, revealInExplorer } from "@/features/desktopActions";
import { openTerminal } from "@/features/terminalActions";
import { cn } from "@/lib/cn";
import { useDesktop, WALLPAPERS, type DesktopItem, type IconPos, type PinnedItem } from "@/store/desktop";
import { hasOwnIcon } from "@/store/winicons";

const CELL_W = 96;
const CELL_H = 102;
const ORIGIN = 12;

function itemLabel(item: DesktopItem): string {
  if (item.kind === "app") return APPS[item.app].name;
  return item.name;
}

function ItemGlyph({ item, size = 46 }: { item: DesktopItem; size?: number }) {
  if (item.kind === "app") return <AppIcon app={item.app} size={size} />;
  if (item.kind === "winapp") return <WinAppIcon path={item.path} name={item.name} size={size} />;
  if (item.location.kind === "windows" && hasOwnIcon(item.location.path))
    return <WinAppIcon path={item.location.path} name={item.name} size={size} />;
  if (item.isDir) return <GlyphTile tone="amber" glyph="folder" size={size} />;
  return (
    <Tile tone="mist" size={size} variant="signature">
      <FileIcon name={item.name} size={Math.round(size * 0.5)} />
    </Tile>
  );
}

function asPin(item: DesktopItem): PinnedItem | null {
  if (item.kind === "app") return { kind: "app", app: item.app };
  if (item.kind === "winapp") return { kind: "winapp", name: item.name, path: item.path };
  return null;
}

/** Positions for every item: saved ones first, the rest fill free cells column by column. */
export function layoutIcons(items: DesktopItem[], saved: Record<string, IconPos>, rows: number): Map<string, IconPos> {
  const out = new Map<string, IconPos>();
  const taken = new Set<string>();
  for (const it of items) {
    const p = saved[it.id];
    if (p && p.row < rows && !taken.has(`${p.col}:${p.row}`)) {
      out.set(it.id, p);
      taken.add(`${p.col}:${p.row}`);
    }
  }
  let col = 0;
  let row = 0;
  for (const it of items) {
    if (out.has(it.id)) continue;
    while (taken.has(`${col}:${row}`)) {
      row++;
      if (row >= rows) {
        row = 0;
        col++;
      }
    }
    out.set(it.id, { col, row });
    taken.add(`${col}:${row}`);
  }
  return out;
}

export function DesktopIcons() {
  const items = useDesktop((s) => s.items);
  const icons = useDesktop((s) => s.icons);
  const area = useDesktop((s) => s.area);
  const wallpaper = useDesktop((s) => s.wallpaper);
  const pinned = useDesktop((s) => s.pinned);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: (MenuItem | "separator")[] } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const rows = Math.max(1, Math.floor((area.h - ORIGIN) / CELL_H));
  const cols = Math.max(1, Math.floor((area.w - ORIGIN) / CELL_W));
  const positions = useMemo(() => layoutIcons(items, icons, rows), [items, icons, rows]);

  function cellAt(x: number, y: number): IconPos {
    return {
      col: Math.min(cols - 1, Math.max(0, Math.round((x - ORIGIN) / CELL_W))),
      row: Math.min(rows - 1, Math.max(0, Math.round((y - ORIGIN) / CELL_H))),
    };
  }

  function onIconPointerDown(e: React.PointerEvent<HTMLButtonElement>, item: DesktopItem) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const el = e.currentTarget;
    const start = positions.get(item.id)!;
    const sx = e.clientX;
    const sy = e.clientY;
    if (e.ctrlKey) {
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(item.id)) n.delete(item.id);
        else n.add(item.id);
        return n;
      });
      return;
    }
    if (!selected.has(item.id)) setSelected(new Set([item.id]));
    el.setPointerCapture(e.pointerId);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true;
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      el.style.zIndex = "5";
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.style.transform = "";
      el.style.zIndex = "";
      if (!moved) return;
      const target = cellAt(ORIGIN + start.col * CELL_W + ev.clientX - sx, ORIGIN + start.row * CELL_H + ev.clientY - sy);
      const occupant = items.find((it) => {
        const p = positions.get(it.id);
        return it.id !== item.id && p?.col === target.col && p?.row === target.row;
      });
      const { setIcon } = useDesktop.getState();
      if (occupant) setIcon(occupant.id, start);
      setIcon(item.id, target);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  function onBackgroundPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    useDesktop.getState().setOverlay(null);
    setSelected(new Set());
    const root = e.currentTarget;
    root.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const r = { x: Math.min(sx, ev.clientX), y: Math.min(sy, ev.clientY), w: Math.abs(ev.clientX - sx), h: Math.abs(ev.clientY - sy) };
      if (r.w < 3 && r.h < 3) return;
      setMarquee(r);
      const hit = new Set<string>();
      for (const it of items) {
        const p = positions.get(it.id)!;
        const ix = ORIGIN + p.col * CELL_W;
        const iy = ORIGIN + p.row * CELL_H;
        if (ix < r.x + r.w && ix + CELL_W - 8 > r.x && iy < r.y + r.h && iy + CELL_H - 8 > r.y) hit.add(it.id);
      }
      setSelected(hit);
    };
    const up = () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
      root.removeEventListener("pointercancel", up);
      setMarquee(null);
    };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", up);
  }

  function iconMenu(item: DesktopItem): (MenuItem | "separator")[] {
    const d = useDesktop.getState();
    const pin = asPin(item);
    const isPinned = pin ? pinned.some((p) => JSON.stringify(p) === JSON.stringify(pin)) : false;
    const list: (MenuItem | "separator")[] = [
      { id: "open", label: "Ouvrir", icon: <ExternalLink size={13} />, onSelect: () => openDesktopItem(item) },
    ];
    if (item.kind === "location") {
      if (item.isDir) {
        list.push({
          id: "term",
          label: "Ouvrir un terminal ici",
          icon: <TerminalSquare size={13} />,
          onSelect: () => {
            d.openApp("terminal");
            void openTerminal({ cwd: item.location });
          },
        });
      }
      list.push({ id: "reveal", label: "Afficher dans l'Explorateur Windows", icon: <FolderOpen size={13} />, onSelect: () => void revealInExplorer(item.location) });
    }
    if (pin) {
      list.push({
        id: "pin",
        label: isPinned ? "Désépingler de la barre des tâches" : "Épingler à la barre des tâches",
        icon: isPinned ? <PinOff size={13} /> : <Pin size={13} />,
        onSelect: () => (isPinned ? d.unpin(pin) : d.pin(pin)),
      });
    }
    list.push("separator", {
      id: "remove",
      label: selected.size > 1 && selected.has(item.id) ? `Retirer ${selected.size} icônes du bureau` : "Retirer du bureau",
      icon: <Trash2 size={13} />,
      danger: true,
      onSelect: () => {
        const ids = selected.size > 1 && selected.has(item.id) ? [...selected] : [item.id];
        for (const id of ids) d.removeItem(id);
        setSelected(new Set());
      },
    });
    return list;
  }

  function backgroundMenu(): (MenuItem | "separator")[] {
    const d = useDesktop.getState();
    const nextWp = WALLPAPERS[(WALLPAPERS.indexOf(wallpaper) + 1) % WALLPAPERS.length]!;
    return [
      { id: "py", label: "Nouveau fichier Python", icon: <FileCode2 size={13} />, onSelect: () => newCodeFile("python") },
      { id: "c", label: "Nouveau fichier C", icon: <FileCode2 size={13} />, onSelect: () => newCodeFile("c") },
      { id: "cpp", label: "Nouveau fichier C++", icon: <Code2 size={13} />, onSelect: () => newCodeFile("cpp") },
      "separator",
      {
        id: "term",
        label: "Ouvrir le terminal",
        icon: <TerminalSquare size={13} />,
        onSelect: () => {
          d.openApp("terminal");
          void openTerminal({ cwd: null });
        },
      },
      { id: "files", label: "Ouvrir Fichiers", icon: <FolderOpen size={13} />, onSelect: () => d.openApp("files", { newWindow: true }) },
      "separator",
      { id: "wp", label: `Fond d'écran : ${WALLPAPER_LABELS[nextWp]}`, icon: <Image size={13} />, onSelect: () => d.setWallpaper(nextWp) },
      { id: "arrange", label: "Réorganiser les icônes", icon: <ArrowDownUp size={13} />, onSelect: () => d.resetIcons() },
      {
        id: "clock",
        label: d.showClock ? "Masquer l'horloge du bureau" : "Afficher l'horloge du bureau",
        icon: <Clock size={13} />,
        onSelect: () => d.setShowClock(!d.showClock),
      },
      {
        id: "restore",
        label: "Restaurer les icônes par défaut",
        icon: <RefreshCw size={13} />,
        onSelect: () => {
          for (const app of Object.keys(APPS)) d.addItem({ id: `app:${app}`, kind: "app", app: app as keyof typeof APPS });
          d.resetIcons();
        },
      },
      { id: "personalize", label: "Personnaliser…", onSelect: () => d.openApp("settings", { args: { tab: "desktop" } }) },
    ];
  }

  return (
    <div
      ref={rootRef}
      className={cn("absolute inset-x-0 top-0", wallpaper === "paper" && "wp-paper-active")}
      style={{ height: area.h }}
      onPointerDown={onBackgroundPointerDown}
      onContextMenu={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, items: backgroundMenu() });
      }}
    >
      {items.map((item) => {
        const p = positions.get(item.id)!;
        const isSel = selected.has(item.id);
        return (
          <button
            key={item.id}
            type="button"
            data-selected={isSel}
            className={cn(
              "desk-icon tile-host absolute flex w-[92px] flex-col items-center gap-2 rounded-xl px-1 pt-2.5 pb-1.5 outline-none transition-[background-color] focus-visible:ring-2 focus-visible:ring-accent/70",
              wallpaper === "paper" ? "text-fg" : "text-white",
            )}
            style={{ left: ORIGIN + p.col * CELL_W, top: ORIGIN + p.row * CELL_H }}
            onPointerDown={(e) => onIconPointerDown(e, item)}
            onDoubleClick={() => openDesktopItem(item)}
            onKeyDown={(e) => {
              if (e.key === "Enter") openDesktopItem(item);
              if (e.key === "Delete") useDesktop.getState().removeItem(item.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!selected.has(item.id)) setSelected(new Set([item.id]));
              setMenu({ x: e.clientX, y: e.clientY, items: iconMenu(item) });
            }}
            title={item.kind === "location" ? (item.location.kind === "linux" ? item.location.path : item.location.path) : undefined}
          >
            <ItemGlyph item={item} />
            <span className={cn("desk-label max-w-full px-1 py-px text-center text-[11.5px] font-medium leading-tight", isSel ? "line-clamp-none" : "line-clamp-2")}>
              {itemLabel(item)}
            </span>
          </button>
        );
      })}
      {marquee && (
        <div
          aria-hidden
          className="desk-marquee pointer-events-none fixed rounded-sm"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
