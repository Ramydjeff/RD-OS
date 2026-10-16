import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/Button";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  title: string;
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
export function Modal({ title, onClose, children, footer, width = "max-w-lg", hideClose }: ModalProps) {
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--overlay)] px-4 pt-[12vh]"
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
          "fade-in flex max-h-[76vh] w-full flex-col rounded-md border border-line bg-surface shadow-[var(--shadow)]",
          width,
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 id={titleId} className="text-[13px] font-semibold">
            {title}
          </h2>
          {!hideClose && <IconButton label="Close" size="sm" icon={<X size={14} />} onClick={() => closeRef.current()} />}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  );
}
