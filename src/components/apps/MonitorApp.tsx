// Moniteur: memory and CPU over time, WSL load, and the open terminal sessions.

import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { Cpu, MemoryStick, RefreshCw, Server, TerminalSquare, Timer } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMonitor } from "@/store/monitor";
import { useTerminals } from "@/store/terminals";
import { chooseDistro, useWsl } from "@/store/wsl";

interface Sample {
  at: number;
  ram: number;
  cpu: number;
}

const MAX_SAMPLES = 90;

const useHistory = create<{ samples: Sample[] }>(() => ({ samples: [] }));

// Collect every host sample the monitor loop takes, from the first time this app loads.
useMonitor.subscribe((s, p) => {
  if (!s.host || s.hostAt === p.hostAt) return;
  const ram = s.host.systemMemoryTotal > 0 ? (s.host.systemMemoryUsed / s.host.systemMemoryTotal) * 100 : 0;
  useHistory.setState((h) => ({ samples: [...h.samples, { at: s.hostAt ?? Date.now(), ram, cpu: s.host!.appCpuPercent }].slice(-MAX_SAMPLES) }));
});

function Sparkline({ samples, pick, label, unit, max = 100 }: { samples: Sample[]; pick: (s: Sample) => number; label: string; unit: string; max?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 520;
  const H = 96;
  const pts = samples.map((s, i) => ({
    x: samples.length < 2 ? W : (i / (samples.length - 1)) * W,
    y: H - 4 - (Math.min(max, pick(s)) / max) * (H - 10),
    s,
  }));
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = pts.length ? `${path} L${W},${H} L0,${H} Z` : "";
  const current = samples.length ? pick(samples[samples.length - 1]!) : null;
  const h = hover !== null ? pts[hover] : null;

  return (
    <figure className="rounded-xl border border-line bg-surface p-4">
      <figcaption className="mb-3 flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-fg2">{label}</span>
        <span className="font-display text-[22px] font-light tabular-nums text-fg">
          {current === null ? "—" : `${current.toFixed(current < 10 ? 1 : 0)} ${unit}`}
        </span>
      </figcaption>
      {samples.length < 2 ? (
        <p className="flex h-24 items-center justify-center text-[12px] text-muted">Collecte des mesures…</p>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-24 w-full overflow-visible"
            role="img"
            aria-label={`${label} : ${current?.toFixed(0)} ${unit}`}
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const x = ((e.clientX - r.left) / r.width) * W;
              let best = 0;
              pts.forEach((p, i) => {
                if (Math.abs(p.x - x) < Math.abs(pts[best]!.x - x)) best = i;
              });
              setHover(best);
            }}
            onPointerLeave={() => setHover(null)}
          >
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} x1={0} x2={W} y1={H - 4 - f * (H - 10)} y2={H - 4 - f * (H - 10)} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <path d={area} fill="var(--accent)" opacity={0.1} />
            <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {h && <line x1={h.x} x2={h.x} y1={0} y2={H} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
          </svg>
          {h && (
            <div
              className="pointer-events-none absolute -top-2 rounded-md border border-line bg-elevated px-2 py-1 text-[11px] shadow-[var(--shadow)]"
              style={{ left: `clamp(0px, calc(${(h.x / W) * 100}% - 50px), calc(100% - 100px))` }}
            >
              <span className="font-mono tabular-nums text-fg">{pick(h.s).toFixed(1)} {unit}</span>
              <span className="ml-1.5 text-muted">{new Date(h.s.at).toLocaleTimeString("fr-FR")}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between text-[10px] text-faint">
            <span>{new Date(samples[0]!.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
            <span>maintenant</span>
          </div>
        </div>
      )}
    </figure>
  );
}

function Tile({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="flex items-center gap-2 text-[11.5px] text-muted">
        {icon}
        {label}
      </p>
      <p className="mt-2 font-display text-[22px] font-light tabular-nums text-fg">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-faint">{hint}</p>}
    </div>
  );
}

function uptime(secs: number | null): string {
  if (secs === null) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return d ? `${d} j ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

export default function MonitorApp() {
  const samples = useHistory((s) => s.samples);
  const host = useMonitor((s) => s.host);
  const wsl = useMonitor((s) => s.wsl);
  const wslError = useMonitor((s) => s.wslError);
  const status = useWsl((s) => s.status);
  const meta = useTerminals((s) => s.meta);
  const distro = chooseDistro(status);
  const [spin, setSpin] = useState(false);

  const refresh = async () => {
    setSpin(true);
    await Promise.all([useMonitor.getState().refreshHost(), useMonitor.getState().refreshWsl(distro), useMonitor.getState().refreshSessions()]);
    setSpin(false);
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distro]);

  const sessions = useMemo(() => Object.entries(meta).filter(([, m]) => m.state === "running" || m.state === "starting"), [meta]);
  const wslMemPct =
    wsl?.memTotalKb && wsl.memAvailableKb !== null ? ((wsl.memTotalKb - wsl.memAvailableKb) / wsl.memTotalKb) * 100 : null;

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-[18px] font-semibold text-fg">Moniteur système</h2>
          <p className="text-[12px] text-muted">
            Windows · {host?.logicalCpus ?? "?"} cœurs logiques · WSL {distro ?? "non détecté"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] text-fg2 hover:bg-hover"
        >
          <RefreshCw size={13} className={cn(spin && "animate-spin")} /> Actualiser
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Sparkline samples={samples} pick={(s) => s.ram} label="Mémoire Windows utilisée" unit="%" />
        <Sparkline samples={samples} pick={(s) => s.cpu} label="CPU de rAImy OS" unit="%" />
      </div>

      <h3 className="mt-6 mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Ubuntu (WSL)</h3>
      {wslError && !wsl ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-[12.5px] text-muted">{wslError}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile icon={<Cpu size={13} />} label="Charge (1 min)" value={wsl?.load1?.toFixed(2) ?? "—"} hint={wsl?.load5 != null ? `5 min : ${wsl.load5.toFixed(2)}` : undefined} />
          <Tile
            icon={<MemoryStick size={13} />}
            label="Mémoire Linux"
            value={wslMemPct === null ? "—" : `${wslMemPct.toFixed(0)} %`}
            hint={wsl?.memTotalKb ? `${(wsl.memTotalKb / 1024 ** 2).toFixed(1)} Go alloués à WSL` : undefined}
          />
          <Tile icon={<Timer size={13} />} label="Démarrée depuis" value={uptime(wsl?.uptimeSecs ?? null)} />
          <Tile icon={<Server size={13} />} label="Distribution" value={distro ?? "—"} />
        </div>
      )}

      <h3 className="mt-6 mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Sessions de terminal</h3>
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {sessions.length === 0 ? (
          <p className="p-4 text-[12.5px] text-muted">Aucune session ouverte.</p>
        ) : (
          <table className="w-full text-left text-[12px]">
            <thead className="text-[11px] text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Session</th>
                <th className="px-4 py-2 font-medium">Distribution</th>
                <th className="px-4 py-2 font-medium">État</th>
                <th className="px-4 py-2 font-medium">Ouverte</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(([id, m]) => (
                <tr key={id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 text-fg">
                    <span className="flex items-center gap-2">
                      <TerminalSquare size={13} className="text-muted" />
                      {m.title || "bash"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-fg2">{m.distro ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-1.5 text-fg2">
                      <span className={cn("h-1.5 w-1.5 rounded-full", m.state === "running" ? "bg-ok" : "bg-warn")} />
                      {m.state === "running" ? "Active" : "Démarrage"}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px] text-muted">
                    {m.startedAt ? new Date(m.startedAt).toLocaleTimeString("fr-FR") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
