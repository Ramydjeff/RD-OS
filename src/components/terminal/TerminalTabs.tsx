import { Plus, X } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { closeTab, openTerminal } from "@/features/terminalActions";
import { cn } from "@/lib/cn";
import { collectLeaves } from "@/lib/layoutTree";
import { useTerminals, type TermTab } from "@/store/terminals";
import type { ControllerMeta } from "@/components/terminal/controller";

const STATE_DOT: Record<ControllerMeta["state"], string> = {
  starting: "bg-warn",
  running: "bg-accent",
  exited: "bg-muted",
  failed: "bg-danger",
};

/** Shell titles look like "user@host: ~/dir"; show the useful tail. */
export function tabLabel(meta: ControllerMeta | undefined): string {
  if (!meta) return "Terminal";
  const title = meta.title.trim();
  if (title) {
    const idx = title.lastIndexOf(": ");
    const tail = idx >= 0 ? title.slice(idx + 2) : title;
    return tail.length > 28 ? `...${tail.slice(-26)}` : tail;
  }
  return meta.distro ?? "Terminal";
}

function Tab({ tab, active }: { tab: TermTab; active: boolean }) {
  const setActiveTab = useTerminals((s) => s.setActiveTab);
  const leaves = collectLeaves(tab.root);
  const focusLeaf = leaves.find((l) => l.id === tab.activePaneId) ?? leaves[0];
  const meta = useTerminals((s) => (focusLeaf ? s.meta[focusLeaf.terminalId] : undefined));
  const label = tabLabel(meta);
  const full = [meta?.title, meta?.distro && `distribution: ${meta.distro}`].filter(Boolean).join("\n");

  return (
    <div
      role="presentation"
      className={cn(
        "group flex h-full max-w-48 items-center gap-1.5 border-r border-line pl-2.5 pr-1",
        active ? "bg-bg text-fg shadow-[inset_0_-2px_0_var(--accent)]" : "text-muted hover:bg-hover hover:text-fg",
      )}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          void closeTab(tab.id);
        }
      }}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        title={full || label}
        onClick={() => setActiveTab(tab.id)}
        className="flex min-w-0 items-center gap-1.5 text-xs"
      >
        <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATE_DOT[meta?.state ?? "starting"])} />
        <span className="truncate">{label}</span>
        {leaves.length > 1 && <span className="shrink-0 rounded-[3px] bg-elevated px-1 text-[10px] text-muted">{leaves.length}</span>}
      </button>
      <IconButton
        size="sm"
        label={`Close ${label}`}
        icon={<X size={12} />}
        className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        onClick={() => void closeTab(tab.id)}
      />
    </div>
  );
}

export function TerminalTabs() {
  const tabs = useTerminals((s) => s.tabs);
  const activeTabId = useTerminals((s) => s.activeTabId);
  return (
    <div className="flex h-full min-w-0 items-stretch">
      <div role="tablist" aria-label="Terminals" className="flex min-w-0 items-stretch overflow-x-auto">
        {tabs.map((t) => (
          <Tab key={t.id} tab={t} active={t.id === activeTabId} />
        ))}
      </div>
      <div className="flex items-center px-1">
        <IconButton label="New terminal" icon={<Plus size={15} />} onClick={() => void openTerminal()} />
      </div>
    </div>
  );
}
