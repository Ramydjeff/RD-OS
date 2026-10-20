import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Keyboard hint shown on the right, e.g. "F2". */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface Props {
  x: number;
  y: number;
  items: (MenuItem | "separator")[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Keep the menu on screen.
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
    el.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const away = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", away, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("blur", onClose);
    };
  }, [x, y, onClose]);

  function onKeyDown(e: React.KeyboardEvent) {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      buttons[(i + 1) % buttons.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
    }
  }

  // Rendered on <body>: inside a desktop window (`contain: paint`) a fixed
  // element would be placed relative to the window instead of the screen.
  return createPortal(
    <div
      ref={ref}
      role="menu"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: x, top: y }}
      className="pop-in fixed z-[55] min-w-52 rounded-[var(--radius-md)] border border-line bg-elevated p-1 shadow-[var(--shadow)]"
    >
      {items.map((item, idx) =>
        item === "separator" ? (
          <div key={`sep-${idx}`} role="separator" className="mx-2 my-1 h-px bg-line" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={cn(
              "flex h-7 w-full items-center gap-2.5 rounded-[5px] px-2 text-left text-[12.5px] text-fg",
              "hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:opacity-40",
              item.danger && "text-danger",
            )}
          >
            <span className={cn("flex w-4 shrink-0 justify-center", item.danger ? "text-danger" : "text-muted")}>{item.icon}</span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.hint && <span className="shrink-0 pl-4 font-mono text-[10.5px] text-faint">{item.hint}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
