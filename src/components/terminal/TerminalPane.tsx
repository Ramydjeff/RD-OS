import { useEffect, useRef } from "react";
import { RotateCcw } from "lucide-react";
import { getController } from "@/components/terminal/registry";
import { SearchBar } from "@/components/terminal/SearchBar";
import { Button } from "@/components/ui/Button";
import { restartTerminal } from "@/features/terminalActions";
import { cn } from "@/lib/cn";
import { useTerminals } from "@/store/terminals";
import { useWorkspace } from "@/store/workspace";

interface Props {
  terminalId: string;
  paneId: string;
  tabId: string;
  tabActive: boolean;
  /** More than one pane in the tab: show which one has focus. */
  showFocus: boolean;
}

export function TerminalPane({ terminalId, paneId, tabId, tabActive, showFocus }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const meta = useTerminals((s) => s.meta[terminalId]);
  const isActivePane = useTerminals((s) => s.tabs.find((t) => t.id === tabId)?.activePaneId === paneId);
  const searchOpen = useTerminals((s) => s.searchFor === terminalId);
  const panelVisible = useWorkspace((s) => s.panelVisible);
  const view = useWorkspace((s) => s.activeView);

  useEffect(() => {
    const c = getController(terminalId);
    const host = hostRef.current;
    if (!c || !host) return;
    c.mount(host);
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => c.fit());
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [terminalId]);

  const visible = tabActive && panelVisible;
  useEffect(() => {
    getController(terminalId)?.setVisible(visible);
  }, [terminalId, visible]);

  // Give the terminal keyboard focus when it becomes the active pane, but never
  // steal it from a dialog or a text field elsewhere in the app.
  useEffect(() => {
    if (!visible || !isActivePane) return;
    const a = document.activeElement;
    const editing =
      (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement) &&
      !a.closest("[data-terminal-id]");
    if (editing || document.querySelector('[role="dialog"]')) return;
    getController(terminalId)?.focus();
  }, [terminalId, visible, isActivePane, view]);

  const ended = meta?.state === "exited" || meta?.state === "failed";

  return (
    <div className={cn("relative h-full w-full bg-bg", showFocus && "border-t-2", showFocus && (isActivePane ? "border-accent/70" : "border-transparent"))}>
      <div ref={hostRef} className="absolute inset-0" />
      {searchOpen && <SearchBar terminalId={terminalId} />}
      {ended && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-line bg-elevated/95 px-3 py-1.5">
          <span className="selectable min-w-0 truncate text-xs text-muted">
            {meta?.state === "failed"
              ? (meta.error ?? "The terminal could not be started.")
              : meta?.exitCode == null
                ? "Session terminated."
                : `Session ended with exit code ${meta.exitCode}.`}
          </span>
          <Button size="sm" variant="primary" onClick={() => void restartTerminal(terminalId)}>
            <RotateCcw size={12} /> Restart
          </Button>
        </div>
      )}
    </div>
  );
}
