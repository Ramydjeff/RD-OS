import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
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

  return (
    <div
      ref={ref}
      role="menu"
      onKeyDown={onKeyDown}
      style={{ left: x, top: y }}
      className="fade-in fixed z-[55] min-w-48 rounded-md border border-line bg-elevated py-1 shadow-[var(--shadow)]"
    >
      {items.map((item, idx) =>
        item === "separator" ? (
          <div key={`sep-${idx}`} role="separator" className="my-1 h-px bg-line" />
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
              "flex w-full items-center gap-2 px-3 py-1 text-left text-[13px] hover:bg-hover focus-visible:bg-hover disabled:opacity-40",
              item.danger && "text-danger",
            )}
          >
            <span className="w-4 shrink-0">{item.icon}</span>
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
