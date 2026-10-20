// One desktop window: title bar, controls, drag, resize and edge snapping.
//
// While the pointer moves, the frame is moved with a CSS transform (or its
// size set directly) and React is not involved; the final rect is committed to
// the store once, on release.

import { Component, Suspense, useMemo, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { Copy, LoaderCircle, Minus, Square, X } from "lucide-react";
import { AppIcon } from "@/components/desktop/AppIcon";
import { APPS } from "@/components/desktop/apps";
import { WindowContext } from "@/components/desktop/windowContext";
import { ContextMenu, type MenuItem } from "@/components/ui/ContextMenu";
import { cn } from "@/lib/cn";
import { clampRect, modeRect, resizeRect, snapZoneAt, type Rect, type ResizeEdge, type WinMode } from "@/lib/windowing";
import { useDesktop, type DesktopWindow } from "@/store/desktop";

// ─── Snap preview (shared by all windows, drawn once by the desktop) ─────────

export const useSnapPreview = create<{ rect: Rect | null }>(() => ({ rect: null }));

export function SnapPreview() {
  const rect = useSnapPreview((s) => s.rect);
  if (!rect) return null;
  return (
    <div
      aria-hidden
      className="snap-preview pointer-events-none absolute rounded-xl"
      style={{ left: rect.x + 6, top: rect.y + 6, width: rect.w - 12, height: rect.h - 12 }}
    />
  );
}

// ─── Error boundary: a crashing app never takes the desktop down ────────────

class AppBoundary extends Component<{ children: ReactNode; name: string }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-semibold text-fg">{this.props.name} a rencontré une erreur.</p>
        <pre className="selectable max-h-40 max-w-lg overflow-auto rounded-md bg-raised p-3 text-left font-mono text-xs text-muted">
          {this.state.error.message}
        </pre>
        <button
          type="button"
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-onaccent hover:bg-accent-hover"
          onClick={() => this.setState({ error: null })}
        >
          Relancer l'application
        </button>
      </div>
    );
  }
}

function Loading({ app }: { app: DesktopWindow["app"] }) {
  return (
    <div className="flex h-full items-center justify-center gap-3 text-muted">
      <AppIcon app={app} size={34} />
      <LoaderCircle size={16} className="animate-spin" />
    </div>
  );
}

// ─── Frame ───────────────────────────────────────────────────────────────────

const EDGES: { edge: ResizeEdge; className: string }[] = [
  { edge: "n", className: "top-0 left-3 right-3 h-1.5 cursor-ns-resize" },
  { edge: "s", className: "bottom-0 left-3 right-3 h-1.5 cursor-ns-resize" },
  { edge: "w", className: "left-0 top-3 bottom-3 w-1.5 cursor-ew-resize" },
  { edge: "e", className: "right-0 top-3 bottom-3 w-1.5 cursor-ew-resize" },
  { edge: "nw", className: "left-0 top-0 h-3 w-3 cursor-nwse-resize" },
  { edge: "ne", className: "right-0 top-0 h-3 w-3 cursor-nesw-resize" },
  { edge: "sw", className: "left-0 bottom-0 h-3 w-3 cursor-nesw-resize" },
  { edge: "se", className: "right-0 bottom-0 h-3 w-3 cursor-nwse-resize" },
];

function applyRect(el: HTMLElement, r: Rect) {
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

export function WindowFrame({ win }: { win: DesktopWindow }) {
  const area = useDesktop((s) => s.area);
  const focused = useDesktop((s) => s.focusedId === win.id);
  const focus = useDesktop((s) => s.focus);
  const close = useDesktop((s) => s.close);
  const minimize = useDesktop((s) => s.minimize);
  const toggleMaximize = useDesktop((s) => s.toggleMaximize);
  const setMode = useDesktop((s) => s.setMode);
  const commitRect = useDesktop((s) => s.commitRect);
  const ref = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const meta = APPS[win.app];
  const AppComponent = meta.component;
  const rect = modeRect(win.mode, win.rect, area);
  const edgeToEdge = win.mode !== "normal";
  const visible = !win.minimized;
  const ctx = useMemo(() => ({ win, focused, visible }), [win, focused, visible]);

  function onTitlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const el = ref.current;
    if (!el) return;
    focus(win.id);
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    let base: Rect = rect;
    let moved = false;
    let zone: Exclude<WinMode, "normal"> | null = null;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved) {
        if (Math.hypot(dx, dy) < 4) return;
        moved = true;
        el.dataset.dragging = "true";
        if (win.mode !== "normal") {
          // Leaving a maximized/snapped state: restore the normal size under the pointer.
          const rel = (startX - rect.x) / rect.w;
          base = { x: Math.round(startX - rel * win.rect.w), y: Math.max(0, startY - 18), w: win.rect.w, h: win.rect.h };
          applyRect(el, base);
          el.style.borderRadius = "";
        }
      }
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      zone = snapZoneAt(ev.clientX, ev.clientY, area);
      useSnapPreview.setState({ rect: zone ? modeRect(zone, base, area) : null });
    };
    const onUp = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      useSnapPreview.setState({ rect: null });
      if (!moved) return;
      // Pin the frame where it was dropped (no transition yet), then commit.
      const dropped = clampRect({ ...base, x: base.x + ev.clientX - startX, y: base.y + ev.clientY - startY }, area);
      el.style.transform = "";
      applyRect(el, dropped);
      if (zone) {
        const target = modeRect(zone, base, area);
        commitRect(win.id, base);
        setMode(win.id, zone);
        // Animate from the drop point into the snapped slot.
        requestAnimationFrame(() => {
          delete el.dataset.dragging;
          requestAnimationFrame(() => applyRect(el, target));
        });
      } else {
        commitRect(win.id, dropped);
        requestAnimationFrame(() => {
          delete el.dataset.dragging;
        });
      }
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  function onResizePointerDown(e: React.PointerEvent<HTMLDivElement>, edge: ResizeEdge) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    focus(win.id);
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const start = rect;
    let last = start;
    el.dataset.dragging = "true";
    const onMove = (ev: PointerEvent) => {
      last = resizeRect(start, edge, ev.clientX - startX, ev.clientY - startY);
      applyRect(el, last);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      last = clampRect(last, area);
      applyRect(el, last);
      commitRect(win.id, last);
      requestAnimationFrame(() => {
        delete el.dataset.dragging;
      });
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  const menuItems: (MenuItem | "separator")[] = [
    { id: "min", label: "Réduire", icon: <Minus size={13} />, onSelect: () => minimize(win.id) },
    {
      id: "max",
      label: win.mode === "maximized" ? "Restaurer" : "Agrandir",
      icon: win.mode === "maximized" ? <Copy size={12} /> : <Square size={11} />,
      onSelect: () => toggleMaximize(win.id),
    },
    { id: "left", label: "Ancrer à gauche", onSelect: () => setMode(win.id, "left") },
    { id: "right", label: "Ancrer à droite", onSelect: () => setMode(win.id, "right") },
    "separator",
    { id: "close", label: "Fermer", icon: <X size={13} />, danger: true, onSelect: () => close(win.id) },
  ];

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={win.title ? `${meta.name} — ${win.title}` : meta.name}
      data-window-id={win.id}
      data-focused={focused}
      data-minimized={win.minimized}
      data-phase={win.phase}
      onPointerDownCapture={() => {
        if (!focused) focus(win.id);
      }}
      className={cn(
        "os-window pointer-events-auto absolute flex flex-col overflow-hidden border border-line bg-surface",
        edgeToEdge ? "rounded-none" : "rounded-xl",
      )}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: win.z }}
    >
      <div
        className="os-titlebar flex h-10 shrink-0 select-none items-center gap-2.5 border-b border-line bg-elevated/80 pl-3"
        data-focused={focused}
        onPointerDown={onTitlePointerDown}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest("button")) toggleMaximize(win.id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <AppIcon app={win.app} size={20} />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate text-[12.5px] font-semibold text-fg">{meta.name}</span>
          {win.title && <span className="truncate text-xs text-muted">{win.title}</span>}
        </div>
        <div className="flex h-full items-stretch">
          <TitleButton label="Réduire" onClick={() => minimize(win.id)}>
            <Minus size={14} />
          </TitleButton>
          <TitleButton label={win.mode === "maximized" ? "Restaurer" : "Agrandir"} onClick={() => toggleMaximize(win.id)}>
            {win.mode === "maximized" ? <Copy size={12} className="-scale-x-100" /> : <Square size={11} />}
          </TitleButton>
          <TitleButton label="Fermer" danger onClick={() => close(win.id)}>
            <X size={15} />
          </TitleButton>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-bg">
        <WindowContext.Provider value={ctx}>
          <AppBoundary name={meta.name}>
            <Suspense fallback={<Loading app={win.app} />}>
              <AppComponent />
            </Suspense>
          </AppBoundary>
        </WindowContext.Provider>
      </div>

      {win.mode === "normal" &&
        EDGES.map(({ edge, className }) => (
          <div
            key={edge}
            aria-hidden
            className={cn("absolute z-10", className)}
            onPointerDown={(e) => onResizePointerDown(e, edge)}
          />
        ))}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
}

function TitleButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex w-11 items-center justify-center text-muted transition-colors",
        danger ? "hover:bg-[#e5323f] hover:text-white" : "hover:bg-hover hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
