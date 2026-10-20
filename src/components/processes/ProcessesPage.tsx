import { useEffect } from "react";
import { Activity, FileCode2, GitFork, LoaderCircle, RefreshCw } from "lucide-react";
import { CFileManager } from "@/components/processes/CFileManager";
import { ProcessSimulator } from "@/components/processes/ProcessSimulator";
import { Button } from "@/components/ui/Button";
import { useWslMetrics } from "@/hooks/useMonitorLoop";
import { cn } from "@/lib/cn";
import { formatBytes, formatDuration } from "@/lib/format";
import { useMonitor } from "@/store/monitor";
import { simulateSource, useProcessesView, type ProcessesTab } from "@/store/processesView";
import { useTerminals } from "@/store/terminals";
import { useWorkspace } from "@/store/workspace";
import type { SessionSummary } from "@/types/ipc";

const TABS: { id: ProcessesTab; label: string; hint: string; Icon: typeof Activity }[] = [
  { id: "cfiles", label: "Mes fichiers C", hint: "Écrire et organiser vos programmes", Icon: FileCode2 },
  { id: "simulator", label: "Simulation", hint: "fork, wait, exit, sleep pas à pas", Icon: GitFork },
  { id: "metrics", label: "Ressources", hint: "Mémoire, CPU et sessions", Icon: Activity },
];

function pct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

function Stat({ label, value, sub, bar }: { label: string; value: string; sub?: string; bar?: number }) {
  return (
    <div className="min-w-0 border-l border-line pl-4">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-1 font-display text-[22px] font-semibold tracking-[-0.01em] text-fg tabular">{value}</p>
      {sub && <p className="text-[11.5px] text-faint tabular">{sub}</p>}
      {bar !== undefined && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", bar >= 90 ? "bg-danger" : bar >= 70 ? "bg-warn" : "bg-accent")}
            style={{ width: `${bar}%` }}
          />
        </div>
      )}
    </div>
  );
}

function SessionRow({ session }: { session: SessionSummary }) {
  const meta = useTerminals((s) => s.meta[session.id]);
  const elapsed = Math.round((Date.now() - session.startedMs) / 1000);
  return (
    <tr className="border-b border-line text-[12.5px] last:border-0">
      <td className="py-2 pr-4 font-mono text-[11.5px] text-muted">{session.id.slice(0, 8)}</td>
      <td className="py-2 pr-4 text-fg">{meta?.distro ?? session.distro}</td>
      <td className="max-w-[260px] truncate py-2 pr-4 font-mono text-[11.5px] text-fg2" title={session.cwd}>
        {session.cwd}
      </td>
      <td className="py-2 pr-4">
        <span className={cn("inline-flex items-center gap-1.5 text-[12px]", session.exited ? "text-muted" : "text-fg")}>
          <span className={cn("h-1.5 w-1.5 rounded-full", session.exited ? "bg-faint" : "bg-ok")} />
          {session.exited ? "terminée" : "en cours"}
        </span>
      </td>
      <td className="py-2 pr-4 font-mono text-[11.5px] text-muted">{session.pid ?? "—"}</td>
      <td className="py-2 text-[12px] text-muted tabular">{formatDuration(elapsed)}</td>
    </tr>
  );
}

function Metrics() {
  useWslMetrics();
  const host = useMonitor((s) => s.host);
  const hostError = useMonitor((s) => s.hostError);
  const wsl = useMonitor((s) => s.wsl);
  const wslError = useMonitor((s) => s.wslError);
  const sessions = useMonitor((s) => s.backendSessions);
  const selectedDistro = useWorkspace((s) => s.selectedDistro);
  const { refreshHost, refreshWsl, refreshSessions } = useMonitor.getState();

  function refresh() {
    void refreshHost();
    void refreshWsl(wsl?.distro ?? selectedDistro);
    void refreshSessions();
  }
  useEffect(() => {
    void refreshHost();
    void refreshSessions();
  }, [refreshHost, refreshSessions]);

  const memPct = host ? pct(host.systemMemoryUsed, host.systemMemoryTotal) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="font-display text-[20px] font-semibold tracking-[-0.01em] text-fg">Ressources</h2>
          <p className="text-[12.5px] text-muted">Mesures réelles de cette machine et de vos sessions de terminal.</p>
        </div>
        <Button size="sm" onClick={refresh}>
          <RefreshCw size={12} /> Actualiser
        </Button>
      </div>

      <section>
        <h3 className="eyebrow mb-4">Windows</h3>
        {hostError && <p className="text-[12.5px] text-danger">{hostError}</p>}
        {!host && !hostError && (
          <p className="flex items-center gap-2 text-[12.5px] text-muted">
            <LoaderCircle size={13} className="animate-spin" /> Mesure en cours…
          </p>
        )}
        {host && (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <Stat label="Processeur (application)" value={`${host.appCpuPercent.toFixed(1).replace(".", ",")} %`} sub={`${host.logicalCpus} processeurs logiques`} />
            <Stat label="Mémoire (application)" value={formatBytes(host.appMemoryBytes)} />
            <Stat label="Mémoire système" value={`${memPct} %`} sub={`${formatBytes(host.systemMemoryUsed)} / ${formatBytes(host.systemMemoryTotal)}`} bar={memPct} />
            <Stat label="Sessions de terminal" value={`${host.activeSessions} / ${host.sessions}`} sub="actives / total" />
          </div>
        )}
      </section>

      <section>
        <h3 className="eyebrow mb-4">Linux {wsl?.distro ?? selectedDistro ? `· ${wsl?.distro ?? selectedDistro}` : ""}</h3>
        {wslError && !wsl && <p className="text-[12.5px] text-muted">{/not running/i.test(wslError) ? "La distribution est arrêtée : ouvrez un terminal pour la démarrer." : wslError}</p>}
        {wsl && (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {wsl.load1 !== null && <Stat label="Charge (1 min)" value={wsl.load1.toFixed(2).replace(".", ",")} />}
            {wsl.load5 !== null && <Stat label="Charge (5 min)" value={wsl.load5.toFixed(2).replace(".", ",")} />}
            {wsl.memTotalKb !== null && wsl.memAvailableKb !== null && (
              <Stat
                label="Mémoire Linux"
                value={`${pct(wsl.memTotalKb - wsl.memAvailableKb, wsl.memTotalKb)} %`}
                sub={`${formatBytes((wsl.memTotalKb - wsl.memAvailableKb) * 1024)} / ${formatBytes(wsl.memTotalKb * 1024)}`}
                bar={pct(wsl.memTotalKb - wsl.memAvailableKb, wsl.memTotalKb)}
              />
            )}
            {wsl.uptimeSecs !== null && <Stat label="Démarré depuis" value={formatDuration(wsl.uptimeSecs)} />}
          </div>
        )}
      </section>

      <section>
        <h3 className="eyebrow mb-3">Sessions de terminal</h3>
        {sessions.length === 0 ? (
          <p className="text-[12.5px] text-muted">Aucune session ouverte.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-medium text-muted">
                <th className="py-2 pr-4 font-medium">Identifiant</th>
                <th className="py-2 pr-4 font-medium">Distribution</th>
                <th className="py-2 pr-4 font-medium">Dossier</th>
                <th className="py-2 pr-4 font-medium">État</th>
                <th className="py-2 pr-4 font-medium">PID</th>
                <th className="py-2 font-medium">Durée</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <SessionRow key={s.id} session={s} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/** The page's view switch: a compact segmented control. */
function ViewSwitch({ tabs, current, onChange }: { tabs: typeof TABS; current: ProcessesTab; onChange: (t: ProcessesTab) => void }) {
  return (
    <div role="tablist" aria-label="Simulateur UNIX" className="flex shrink-0 items-center rounded-lg border border-line bg-bg p-0.5">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={current === t.id}
          title={t.hint}
          onClick={() => onChange(t.id)}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors",
            current === t.id ? "bg-elevated text-fg shadow-[inset_0_0_0_1px_var(--line-strong)]" : "text-muted hover:text-fg2",
          )}
        >
          <t.Icon size={13} className={current === t.id ? "text-accent" : undefined} />
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** `showMetrics` is off on the desktop, where the Moniteur app shows them. */
export function ProcessesPage({ showMetrics = true }: { showMetrics?: boolean }) {
  const stored = useProcessesView((s) => s.tab);
  const setTab = useProcessesView((s) => s.setTab);
  const tabs = showMetrics ? TABS : TABS.filter((t) => t.id !== "metrics");
  const tab = !showMetrics && stored === "metrics" ? "cfiles" : stored;
  const nav = <ViewSwitch tabs={tabs} current={tab} onChange={setTab} />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {tab !== "simulator" && <div className="flex h-12 shrink-0 items-center border-b border-line px-3">{nav}</div>}

      <div className="min-h-0 flex-1">
        {tab === "cfiles" && (
          <div className="h-full p-3">
            <CFileManager onLaunchSimulation={(code, fileName, fileId) => void simulateSource(code, fileName, fileId)} />
          </div>
        )}
        {tab === "simulator" && <ProcessSimulator nav={nav} onOpenFileManager={() => setTab("cfiles")} />}
        {tab === "metrics" && (
          <div className="h-full overflow-y-auto">
            <Metrics />
          </div>
        )}
      </div>
    </div>
  );
}
