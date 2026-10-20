import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/Button";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  title: string;
  /** One line under the title. */
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  /** Hide the close (X) button for dialogs that must be answered explicitly. */
  hideClose?: boolean;
}

/**
 * Accessible modal: labelled, traps Tab, closes on Escape, and returns focus to
 * whatever had it before (usually the terminal) when it goes away.
 */
export function Modal({ title, description, onClose, children, footer, width = "max-w-lg", hideClose }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => previous?.focus?.();
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeRef.current();
      return;
    }
    if (e.key !== "Tab") return;
    const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
      (n) => n.offsetParent !== null,
    );
    if (nodes.length === 0) return;
    const firstNode = nodes[0]!;
    const lastNode = nodes[nodes.length - 1]!;
    if (e.shiftKey && document.activeElement === firstNode) {
      e.preventDefault();
      lastNode.focus();
    } else if (!e.shiftKey && document.activeElement === lastNode) {
      e.preventDefault();
      firstNode.focus();
    }
  }

  return (
    <div
      className="fade-in fixed inset-0 z-50 flex items-start justify-center bg-[var(--overlay)] px-4 pt-[11vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeRef.current();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className={cn(
          "pop-in flex max-h-[78vh] w-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-elevated shadow-[var(--shadow)]",
          width,
        )}
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-[16px] font-semibold tracking-[-0.01em] text-fg">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
          </div>
          {!hideClose && (
            <IconButton label="Fermer" size="sm" icon={<X size={15} />} className="-mr-1.5 mt-0.5" onClick={() => closeRef.current()} />
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 pb-4 pt-2">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-surface/60 px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}
