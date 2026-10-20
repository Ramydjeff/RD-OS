import { useEffect, useMemo, useRef, useState } from "react";
import type { ProcView, StepMark } from "@/components/processes/engine";
import { STATE_META, StateBadge, procExitText } from "@/components/processes/simStyle";
import { cn } from "@/lib/cn";

interface ProcessTreeGraphProps {
  procs: ProcView[];
  activePid: number | null;
  selectedPid: number | null;
  onSelectProcess: (pid: number) => void;
  /** Line of the fork() that created each process. */
  forkLines: Map<number, number>;
  /** Marks of the current step (fork / reap / exit / signal) to highlight. */
  marks: StepMark[];
  /** Step index, used to flag processes created during the current step. */
  stepIndex: number;
}

const W = 168;
const H = 74;
const GAP_X = 16;
const GAP_Y = 42;
const TOP = 34;
const PAD = 12;

interface Placed {
  p: ProcView;
  x: number;
  y: number;
}

function layout(procs: ProcView[]) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const kids = new Map<number, ProcView[]>();
  const roots: ProcView[] = [];
  for (const p of procs) {
    if (p.parent !== null && byPid.has(p.parent)) {
      const list = kids.get(p.parent) ?? [];
      list.push(p);
      kids.set(p.parent, list);
    } else {
      roots.push(p);
    }
  }
  const widthCache = new Map<number, number>();
  const width = (pid: number): number => {
    const cached = widthCache.get(pid);
    if (cached !== undefined) return cached;
    const ch = kids.get(pid) ?? [];
    const w = ch.length === 0 ? W : Math.max(W, ch.reduce((s, c) => s + width(c.pid), 0) + GAP_X * (ch.length - 1));
    widthCache.set(pid, w);
    return w;
  };
  const placed: Placed[] = [];
  let maxDepth = 0;
  const place = (p: ProcView, x0: number, depth: number) => {
    const w = width(p.pid);
    maxDepth = Math.max(maxDepth, depth);
    placed.push({ p, x: x0 + (w - W) / 2, y: TOP + depth * (H + GAP_Y) });
    const ch = kids.get(p.pid) ?? [];
    const total = ch.reduce((s, c) => s + width(c.pid), 0) + GAP_X * Math.max(0, ch.length - 1);
    let x = x0 + (w - total) / 2;
    for (const c of ch) {
      place(c, x, depth + 1);
      x += width(c.pid) + GAP_X;
    }
  };
  let x = PAD;
  for (const r of roots) {
    place(r, x, 0);
    x += width(r.pid) + GAP_X;
  }
  const totalW = Math.max(W + PAD * 2, x - GAP_X + PAD);
  const totalH = TOP + (maxDepth + 1) * (H + GAP_Y) - GAP_Y + PAD;
  return { placed, totalW, totalH };
}

export function ProcessTreeGraph({ procs, activePid, selectedPid, onSelectProcess, forkLines, marks, stepIndex }: ProcessTreeGraphProps) {
  const { placed, totalW, totalH } = useMemo(() => layout(procs), [procs]);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(600);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const scale = Math.max(0.6, Math.min(1, (boxW - 8) / totalW));
  const pos = new Map(placed.map((n) => [n.p.pid, n]));
  const forkNow = new Set(marks.filter((m) => m.type === "fork").map((m) => (m as { to: number }).to));
  const reapNow = new Set(marks.filter((m) => m.type === "reap").map((m) => (m as { child: number }).child));
  const signalNow = new Set(marks.filter((m) => m.type === "signal").map((m) => (m as { to: number }).to));
  const root = placed.find((n) => n.p.parent === null);

  return (
    <div ref={boxRef} className="h-full w-full overflow-auto">
      <div style={{ width: totalW * scale, height: totalH * scale }} className="relative mx-auto">
        <div style={{ width: totalW, height: totalH, transform: `scale(${scale})`, transformOrigin: "0 0" }} className="absolute left-0 top-0 select-none">
          <svg className="pointer-events-none absolute inset-0" width={totalW} height={totalH} aria-hidden>
            {root && (
              <g>
                <line x1={root.x + W / 2} y1={18} x2={root.x + W / 2} y2={root.y} stroke="var(--line)" strokeWidth={1.5} strokeDasharray="3 3" />
              </g>
            )}
            {placed.map(({ p, x, y }) => {
              if (p.parent === null) return null;
              const par = pos.get(p.parent);
              if (!par) return null;
              const x1 = par.x + W / 2;
              const y1 = par.y + H;
              const x2 = x + W / 2;
              const y2 = y;
              const midY = (y1 + y2) / 2;
              const fresh = forkNow.has(p.pid);
              const reaped = reapNow.has(p.pid);
              const dead = p.state === "TERMINATED";
              const zombie = p.state === "ZOMBIE";
              const stroke = fresh || reaped ? "var(--accent)" : dead ? "var(--line)" : "var(--muted)";
              const line = forkLines.get(p.pid);
              return (
                <g key={p.pid}>
                  <path
                    d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={fresh || reaped ? 2 : 1.5}
                    strokeDasharray={dead || zombie || reaped ? "4 3" : undefined}
                    opacity={dead && !reaped ? 0.6 : 1}
                  />
                  {line !== undefined && (
                    <text x={(x1 + x2) / 2 + (x2 >= x1 ? 6 : -6)} y={midY - 3} textAnchor={x2 >= x1 ? "start" : "end"} fontSize={10} fill="var(--muted)" fontFamily="var(--font-mono)">
                      fork() l.{line}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {root && (
            <div
              className="absolute flex items-center gap-1 rounded-full border border-dashed border-line bg-surface px-2 text-[10px] text-muted"
              style={{ left: root.x + W / 2 - 56, top: 4, width: 112, height: 16, justifyContent: "center" }}
              title="Le shell qui a lancé le programme : c'est le père du processus principal"
            >
              bash · PID 2000
            </div>
          )}

          {placed.map(({ p, x, y }) => {
            const meta = STATE_META[p.state];
            const isActive = p.pid === activePid;
            const isSelected = p.pid === selectedPid;
            const dead = p.state === "TERMINATED";
            const born = p.bornStep === stepIndex && p.parent !== null;
            let detail: string;
            if (p.external) detail = `exec → ${p.external}`;
            else if (p.state === "ZOMBIE") detail = `${procExitText(p)} · attend wait()`;
            else if (dead) detail = `${procExitText(p)}${p.reapedBy === 1 ? " · récupéré par init" : p.reapedBy === 2000 ? " · récupéré par bash" : ""}`;
            else if (p.blockedOn) detail = p.blockedOn;
            else detail = `${p.func}() · ligne ${p.line}`;
            return (
              <button
                key={p.pid}
                type="button"
                onClick={() => onSelectProcess(p.pid)}
                style={{ left: x, top: y, width: W, height: H, borderColor: isActive ? "var(--accent)" : `color-mix(in srgb, ${meta.color} 60%, var(--line))` }}
                className={cn(
                  "absolute flex flex-col justify-between rounded-md border bg-surface px-2 py-1.5 text-left transition-[opacity,box-shadow] duration-200",
                  p.state === "ZOMBIE" && "border-dashed",
                  dead && "opacity-55",
                  isActive && "sim-active border-2",
                  isSelected && "ring-2 ring-accent2/70",
                  born && "sim-flash",
                  !isActive && "hover:bg-elevated",
                )}
                title={`${p.label} — PID ${p.pid}, PPID ${p.ppid} — ${meta.label} : ${meta.desc}`}
              >
                <span className="flex items-center justify-between gap-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={cn("rounded px-1 font-mono text-[10px] font-bold leading-4", isActive ? "bg-accent text-white" : "bg-elevated text-fg")}>
                      {p.short}
                    </span>
                    <span className="truncate text-[11px] font-semibold text-fg">{p.label}</span>
                  </span>
                  <StateBadge state={p.state} />
                </span>
                <span className="flex items-center justify-between gap-2 whitespace-nowrap font-mono text-[10px] text-muted">
                  <span>
                    PID <span className="font-semibold text-fg">{p.pid}</span>
                  </span>
                  {signalNow.has(p.pid) && <span className="font-sans font-semibold text-accent">⚡ signal</span>}
                  <span
                    className={cn(p.orphan && "font-semibold text-status-warn")}
                    title={p.orphan ? "Orphelin : son père est mort, init (PID 1) l'a adopté" : p.ppid === 2000 ? "Père : le shell bash" : undefined}
                  >
                    PPID {p.ppid}
                    {p.orphan ? " · init" : ""}
                  </span>
                </span>
                <span className="truncate text-[10px] text-muted" title={detail}>
                  {detail}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
