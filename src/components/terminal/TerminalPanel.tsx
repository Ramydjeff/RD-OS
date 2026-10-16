import { LoaderCircle } from "lucide-react";
import { SplitView, paneCount } from "@/components/terminal/SplitView";
import { TerminalTabs } from "@/components/terminal/TerminalTabs";
import { TerminalToolbar } from "@/components/terminal/TerminalToolbar";
import { RaimyIcon } from "@/components/ui/RaimyLogo";
import { Button } from "@/components/ui/Button";
import { openTerminal } from "@/features/terminalActions";
import { useTerminals } from "@/store/terminals";
import { useWsl } from "@/store/wsl";
import { useWorkspace } from "@/store/workspace";

export function TerminalPanel() {
  const tabs = useTerminals((s) => s.tabs);
  const activeTabId = useTerminals((s) => s.activeTabId);

  return (
    <section aria-label="Terminal" className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-8 shrink-0 items-stretch justify-between border-b border-line bg-surface">
        <TerminalTabs />
        <TerminalToolbar />
      </div>
      <div className="relative min-h-0 flex-1 bg-bg">
        {tabs.length === 0 && <EmptyState />}
        {tabs.map((tab) => (
          <div key={tab.id} className="absolute inset-0" style={{ visibility: tab.id === activeTabId ? "visible" : "hidden" }}>
            <SplitView node={tab.root} tabId={tab.id} tabActive={tab.id === activeTabId} multi={paneCount(tab.root) > 1} />
          </div>
        ))}
      </div>
    </section>
  );
}

function EmptyState() {
  const status = useWsl((s) => s.status);
  const loading = useWsl((s) => s.loading);
  const error = useWsl((s) => s.error);
  const setView = useWorkspace((s) => s.setView);
  const problem = status?.problem ?? null;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      {loading && !status ? (
        <p className="flex items-center gap-2 text-muted">
          <LoaderCircle size={15} className="animate-spin text-accent" /> Initializing WSL 2 Subsystem...
        </p>
      ) : problem || error ? (
        <>
          <p className="max-w-md text-[13px] text-warn">{problem?.message ?? error}</p>
          {problem && <p className="max-w-md text-xs text-muted">{problem.hint}</p>}
          <Button onClick={() => setView("environments")}>Open Environments</Button>
        </>
      ) : (
        <>
          <RaimyIcon size={38} animated={false} className="opacity-80" />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-fg">Terminal Standby</p>
            <p className="text-[11px] text-muted max-w-xs">Connect to your Linux visual computing environment</p>
          </div>
          <Button
            variant="primary"
            size="md"
            className="shadow-[0_2px_12px_rgba(214,48,58,0.35)]"
            onClick={() => void openTerminal()}
          >
            Launch Terminal Session
          </Button>
        </>
      )}
    </div>
  );
}
