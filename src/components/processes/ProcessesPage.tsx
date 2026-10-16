import { useEffect, useState } from "react";
import {
  Activity,
  Clock,
  Cpu,
  GitFork,
  HardDrive,
  LoaderCircle,
  MemoryStick,
  RefreshCw,
  TerminalSquare,
} from "lucide-react";
import { ProcessSimulator } from "@/components/processes/ProcessSimulator";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useMonitor } from "@/store/monitor";
import { useTerminals } from "@/store/terminals";
import { useWorkspace } from "@/store/workspace";
import type { SessionSummary } from "@/types/ipc";

function fmt(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function pct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

function Bar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
      <div
        className={cn(
          "h-full rounded-full transition-[width]",
          value >= 90 ? "bg-danger" : value >= 70 ? "bg-warn" : "bg-accent",
        )}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function MetricCard({ icon, label, value, sub, bar }: { icon: React.ReactNode; label: string; value: string; sub?: string; bar?: number }) {
  return (
    <div className="rounded-md border border-line bg-surface p-3 space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="shrink-0">{icon}</span>
        {label}
      </div>
      <p className="text-[15px] font-semibold">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
      {bar !== undefined && <Bar value={bar} />}
    </div>
  );
}

function SessionRow({ session }: { session: SessionSummary }) {
  const meta = useTerminals((s) => s.meta[session.id]);
  const elapsed = Math.round((Date.now() - session.startedMs) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const uptime = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <tr className="border-b border-line last:border-0 text-[13px]">
      <td className="py-2 pr-4 font-mono text-xs text-muted">{session.id.slice(0, 8)}</td>
      <td className="py-2 pr-4 font-medium">{meta?.distro ?? session.distro}</td>
      <td className="py-2 pr-4 truncate max-w-[200px] font-mono text-xs text-muted" title={session.cwd}>
        {session.cwd}
      </td>
      <td className="py-2 pr-4 text-xs">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            session.exited ? "bg-line text-muted" : "bg-accent/15 text-accent",
          )}
        >
          {session.exited ? "exited" : "running"}
        </span>
      </td>
      <td className="py-2 pr-4 text-xs text-muted">{session.pid ?? "—"}</td>
      <td className="py-2 text-xs text-muted">{uptime}</td>
    </tr>
  );
}

export function ProcessesPage() {
  const [tab, setTab] = useState<"simulator" | "metrics">("simulator");
  const host = useMonitor((s) => s.host);
  const hostError = useMonitor((s) => s.hostError);
  const wsl = useMonitor((s) => s.wsl);
  const wslError = useMonitor((s) => s.wslError);
  const sessions = useMonitor((s) => s.backendSessions);
  const selectedDistro = useWorkspace((s) => s.selectedDistro);

  const { refreshHost, refreshWsl, refreshSessions } = useMonitor.getState();

  function refresh() {
    void refreshHost();
    void refreshWsl(selectedDistro);
    void refreshSessions();
  }

  // Force a snapshot on mount.
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const memPct = host ? pct(host.systemMemoryUsed, host.systemMemoryTotal) : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      {/* ── Minimalist Segmented Tab Switcher ─────────────────────────── */}
      <div className="flex items-center justify-between border-b border-line/60 pb-2">
        <div className="inline-flex items-center rounded-md border border-line bg-surface p-0.5">
          <button
            type="button"
            onClick={() => setTab("simulator")}
            className={cn(
              "flex items-center gap-1.5 rounded px-3 py-1 text-xs font-semibold transition-all",
              tab === "simulator"
                ? "bg-[#D6303A] text-white shadow-sm"
                : "text-muted hover:text-fg",
            )}
          >
            <GitFork size={13} /> Simulateur de Processus (fork, wait, sleep)
          </button>
          <button
            type="button"
            onClick={() => setTab("metrics")}
            className={cn(
              "flex items-center gap-1.5 rounded px-3 py-1 text-xs font-semibold transition-all",
              tab === "metrics"
                ? "bg-[#D6303A] text-white shadow-sm"
                : "text-muted hover:text-fg",
            )}
          >
            <Activity size={13} /> Métriques Système
          </button>
        </div>

        {tab === "metrics" && (
          <Button size="sm" onClick={refresh}>
            <RefreshCw size={12} /> Rafraîchir
          </Button>
        )}
      </div>

      {/* ── Tab Content: Process Simulator ────────────────────────── */}
      {tab === "simulator" ? (
        <ProcessSimulator />
      ) : (
        <>
          <header className="flex items-center justify-between">
            <div>
              <h1 className="text-base font-semibold">Processes &amp; Resources</h1>
              <p className="text-xs text-muted">Live metrics for this machine and your terminal sessions.</p>
            </div>
          </header>

      {/* ── Host metrics ─────────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Host (Windows)</h2>
        {hostError && <p className="text-xs text-danger">{hostError}</p>}
        {!host && !hostError && (
          <p className="flex items-center gap-2 text-xs text-muted">
            <LoaderCircle size={13} className="animate-spin" /> Sampling…
          </p>
        )}
        {host && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard
              icon={<Cpu size={13} />}
              label="App CPU"
              value={`${host.appCpuPercent.toFixed(1)} %`}
              sub={`${host.logicalCpus} logical CPUs`}
            />
            <MetricCard
              icon={<MemoryStick size={13} />}
              label="App Memory"
              value={fmt(host.appMemoryBytes)}
            />
            <MetricCard
              icon={<HardDrive size={13} />}
              label="System Memory"
              value={`${memPct} %`}
              sub={`${fmt(host.systemMemoryUsed)} / ${fmt(host.systemMemoryTotal)}`}
              bar={memPct}
            />
            <MetricCard
              icon={<Activity size={13} />}
              label="Terminal sessions"
              value={`${host.activeSessions} / ${host.sessions}`}
              sub="active / total"
            />
          </div>
        )}
      </section>

      {/* ── WSL metrics ──────────────────────────────────────────── */}
      {(wsl || wslError) && (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Linux ({wsl?.distro ?? selectedDistro ?? "—"})
          </h2>
          {wslError && <p className="text-xs text-danger">{wslError}</p>}
          {wsl && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {wsl.load1 !== null && (
                <MetricCard icon={<Cpu size={13} />} label="Load (1 min)" value={wsl.load1.toFixed(2)} />
              )}
              {wsl.load5 !== null && (
                <MetricCard icon={<Cpu size={13} />} label="Load (5 min)" value={wsl.load5.toFixed(2)} />
              )}
              {wsl.memTotalKb !== null && wsl.memAvailableKb !== null && (
                <MetricCard
                  icon={<MemoryStick size={13} />}
                  label="WSL Memory"
                  value={`${pct(wsl.memTotalKb - wsl.memAvailableKb, wsl.memTotalKb)} %`}
                  sub={`${fmt((wsl.memTotalKb - wsl.memAvailableKb) * 1024)} / ${fmt(wsl.memTotalKb * 1024)}`}
                  bar={pct(wsl.memTotalKb - wsl.memAvailableKb, wsl.memTotalKb)}
                />
              )}
              {wsl.uptimeSecs !== null && (
                <MetricCard
                  icon={<Clock size={13} />}
                  label="Uptime"
                  value={`${Math.floor(wsl.uptimeSecs / 3600)}h ${Math.floor((wsl.uptimeSecs % 3600) / 60)}m`}
                />
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Sessions table ───────────────────────────────────────── */}
      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Terminal sessions</h2>
        {sessions.length === 0 ? (
          <p className="flex items-center gap-2 text-xs text-muted">
            <TerminalSquare size={13} /> No active sessions.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <th className="px-0 py-2 pr-4 text-left">ID</th>
                  <th className="py-2 pr-4 text-left">Distro</th>
                  <th className="py-2 pr-4 text-left">CWD</th>
                  <th className="py-2 pr-4 text-left">State</th>
                  <th className="py-2 pr-4 text-left">PID</th>
                  <th className="py-2 text-left">Uptime</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <SessionRow key={s.id} session={s} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )}
</div>
  );
}
