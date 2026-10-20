import { LoaderCircle, SquareTerminal } from "lucide-react";
import { SplitView, paneCount } from "@/components/terminal/SplitView";
import { TerminalTabs } from "@/components/terminal/TerminalTabs";
import { TerminalToolbar } from "@/components/terminal/TerminalToolbar";
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
      <div className="flex h-9 shrink-0 items-stretch justify-between border-b border-line bg-surface">
        <TerminalTabs />
        <TerminalToolbar />
      </div>
      <div className="relative min-h-0 flex-1 bg-term">
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
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      {loading && !status ? (
        <p className="flex items-center gap-2 text-[12.5px] text-muted">
          <LoaderCircle size={15} className="animate-spin text-accent" /> Connexion à WSL 2…
        </p>
      ) : problem || error ? (
        <>
          <p className="max-w-md text-[13px] text-warn">{problem?.message ?? error}</p>
          {problem && <p className="max-w-md text-[12px] text-muted">{problem.hint}</p>}
          <Button onClick={() => setView("environments")}>Ouvrir les environnements</Button>
        </>
      ) : (
        <>
          <div className="space-y-1">
            <p className="font-display text-[15px] font-semibold text-fg">Aucun terminal ouvert</p>
            <p className="text-[12.5px] text-muted">Un shell Linux s'ouvre dans votre distribution WSL, dans le dossier du projet.</p>
          </div>
          <Button variant="primary" onClick={() => void openTerminal()}>
            <SquareTerminal size={14} /> Ouvrir un terminal
          </Button>
        </>
      )}
    </div>
  );
}
