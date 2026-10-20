import { useEffect, useMemo, useRef, useState } from "react";
import { formatTime, type ProcState, type ProcView, type SimStep } from "@/components/processes/engine";
import { LEGEND_STATES, STATE_META } from "@/components/processes/simStyle";
import { cn } from "@/lib/cn";

interface Seg {
  pid: number;
  state: ProcState;
  from: number;
  to: number;
}

interface ProcessTimelineProps {
  steps: SimStep[];
  current: number;
  onSeek: (i: number) => void;
  selectedPid: number | null;
  onSelectProcess: (pid: number) => void;
}

const LANE = 24;
const LABEL_W = 84;
const AXIS = 20;

/** Bar geometry per state: the shape carries the state as well as the color. */
const SHAPE: Record<ProcState, { h: number; dash?: boolean }> = {
  RUNNING: { h: 14 },
  WAITING: { h: 8 },
  SLEEPING: { h: 8 },
  READY: { h: 3 },
  STOPPED: { h: 3 },
  ZOMBIE: { h: 0, dash: true },
  TERMINATED: { h: 0 },
};

function LegendMark({ state }: { state: ProcState }) {
  const s = SHAPE[state];
  const color = STATE_META[state].color;
  return (
    <svg width={18} height={14} aria-hidden className="shrink-0">
      {s.dash ? (
        <line x1={1} y1={7} x2={17} y2={7} stroke={color} strokeWidth={2} strokeDasharray="3 2" />
      ) : s.h > 0 ? (
        <rect x={1} y={7 - s.h / 2} width={16} height={s.h} rx={2} fill={color} />
      ) : (
        <line x1={1} y1={7} x2={17} y2={7} stroke="var(--line)" strokeWidth={1} />
      )}
    </svg>
  );
}

export function TimelineLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
      {LEGEND_STATES.map((s) => (
        <span key={s} className="flex items-center gap-1" title={STATE_META[s].desc}>
          <LegendMark state={s} />
          {STATE_META[s].label}
        </span>
      ))}
    </div>
  );
}

export function ProcessTimeline({ steps, current, onSeek, selectedPid, onSelectProcess }: ProcessTimelineProps) {
  const lanes: ProcView[] = useMemo(() => steps[steps.length - 1]?.procs ?? [], [steps]);
  const laneIndex = useMemo(() => new Map(lanes.map((p, i) => [p.pid, i])), [lanes]);

  const segs = useMemo(() => {
    const out: Seg[] = [];
    const last = new Map<number, Seg>();
    steps.forEach((step, i) => {
      for (const v of step.procs) {
        if (v.state === "TERMINATED") continue;
        const prev = last.get(v.pid);
        if (prev && prev.state === v.state && prev.to === i - 1) prev.to = i;
        else {
          const seg = { pid: v.pid, state: v.state, from: i, to: i };
          out.push(seg);
          last.set(v.pid, seg);
        }
      }
    });
    return out;
  }, [steps]);

  const timeJumps = useMemo(() => {
    const list: { i: number; dt: number }[] = [];
    for (let i = 1; i < steps.length; i++) {
      const dt = steps[i]!.time - steps[i - 1]!.time;
      if (dt >= 100) list.push({ i, dt });
    }
    return list;
  }, [steps]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(600);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const n = Math.max(1, steps.length);
  const px = Math.max(4, Math.min(30, (boxW - 12) / n));
  const width = Math.max(boxW, n * px + 12);
  const height = lanes.length * LANE + AXIS;
  const cx = (i: number) => 6 + i * px + px / 2;
  const laneY = (pid: number) => (laneIndex.get(pid) ?? 0) * LANE + LANE / 2;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = cx(current);
    if (x < el.scrollLeft + 30 || x > el.scrollLeft + el.clientWidth - 30) el.scrollTo({ left: Math.max(0, x - el.clientWidth / 2), behavior: "smooth" });
  }, [current, px]); // eslint-disable-line react-hooks/exhaustive-deps

  const [hover, setHover] = useState<{ i: number; lane: number; x: number; y: number } | null>(null);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const i = Math.min(n - 1, Math.max(0, Math.floor((x - 6) / px)));
    const lane = Math.min(lanes.length - 1, Math.max(0, Math.floor(y / LANE)));
    setHover({ i, lane, x: e.clientX, y: e.clientY });
  };

  const tickEvery = Math.max(1, Math.ceil(48 / px));
  const hoverStep = hover ? steps[hover.i] : undefined;
  const hoverProc = hover && hoverStep ? hoverStep.procs.find((p) => p.pid === lanes[hover.lane]?.pid) : undefined;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex min-h-0">
        <div className="shrink-0 border-r border-line bg-surface" style={{ width: LABEL_W }}>
          {lanes.map((p) => {
            const cur = steps[current]?.procs.find((v) => v.pid === p.pid);
            return (
              <button
                key={p.pid}
                type="button"
                onClick={() => onSelectProcess(p.pid)}
                style={{ height: LANE }}
                title={`${p.label} — PID ${p.pid}`}
                className={cn(
                  "flex w-full items-center gap-1.5 px-2 text-left font-mono text-[10px] hover:bg-hover",
                  selectedPid === p.pid && "bg-active",
                  !cur && "opacity-40",
                )}
              >
                <span className={cn("font-bold", steps[current]?.pid === p.pid ? "text-accent" : "text-fg")}>{p.short}</span>
                <span className="text-muted">{p.pid}</span>
              </button>
            );
          })}
          <div style={{ height: AXIS }} />
        </div>
        <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <svg
            width={width}
            height={height}
            className="block cursor-pointer"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            onClick={() => hover && onSeek(hover.i)}
            role="img"
            aria-label="Chronologie des états de chaque processus, étape par étape"
          >
            {lanes.map((p, li) => (
              <rect
                key={p.pid}
                x={0}
                y={li * LANE}
                width={width}
                height={LANE}
                fill={selectedPid === p.pid ? "var(--active)" : li % 2 ? "var(--code-line)" : "transparent"}
              />
            ))}
            <rect x={cx(current) - px / 2} y={0} width={px} height={lanes.length * LANE} fill="var(--accent)" opacity={0.12} />

            {timeJumps.map((j) => (
              <g key={`t${j.i}`}>
                <title>{`Processeur inactif : le temps avance de ${(j.dt / 1000).toLocaleString("fr-FR")} s (sleep)`}</title>
                <line x1={cx(j.i) - px / 2} y1={0} x2={cx(j.i) - px / 2} y2={lanes.length * LANE} stroke="var(--muted)" strokeDasharray="1 3" />
                <text x={cx(j.i) - px / 2 + 3} y={lanes.length * LANE + 14} fontSize={9} fill="var(--fg)" fontWeight={600}>
                  +{(j.dt / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s
                </text>
              </g>
            ))}

            {segs.map((s, k) => {
              const shape = SHAPE[s.state];
              const x = 6 + s.from * px + (px > 6 ? 1 : 0);
              const w = Math.max(1.5, (s.to - s.from + 1) * px - (px > 6 ? 2 : 0));
              const y = laneY(s.pid);
              const color = STATE_META[s.state].color;
              if (shape.dash) {
                return <line key={k} x1={x} y1={y} x2={x + w} y2={y} stroke={color} strokeWidth={2} strokeDasharray="3 2" />;
              }
              if (shape.h === 0) return null;
              return <rect key={k} x={x} y={y - shape.h / 2} width={w} height={shape.h} rx={Math.min(2, w / 2)} fill={color} />;
            })}

            {steps.map((step) =>
              step.marks.map((m, k) => {
                const x = cx(step.i);
                if (m.type === "fork") {
                  const y1 = laneY(m.from);
                  const y2 = laneY(m.to);
                  return (
                    <g key={`m${step.i}-${k}`}>
                      <line x1={x} y1={y1} x2={x} y2={y2} stroke="var(--fg)" strokeOpacity={0.55} strokeWidth={1.2} />
                      <circle cx={x} cy={y2} r={3.5} fill="var(--surface)" stroke="var(--fg)" strokeWidth={1.2} />
                    </g>
                  );
                }
                if (m.type === "reap") {
                  return (
                    <line key={`m${step.i}-${k}`} x1={x} y1={laneY(m.child)} x2={x} y2={laneY(m.parent)} stroke="var(--muted)" strokeWidth={1.2} strokeDasharray="2 2" />
                  );
                }
                if (m.type === "exit") {
                  const y = laneY(m.pid);
                  return <path key={`m${step.i}-${k}`} d={`M ${x - 3} ${y - 3} L ${x + 3} ${y + 3} M ${x + 3} ${y - 3} L ${x - 3} ${y + 3}`} stroke="var(--fg)" strokeWidth={1.4} />;
                }
                if (m.type === "signal") {
                  const y = laneY(m.to);
                  return <path key={`m${step.i}-${k}`} d={`M ${x} ${y - 8} L ${x - 3} ${y} L ${x + 1} ${y} L ${x - 1} ${y + 7}`} fill="none" stroke="var(--accent)" strokeWidth={1.6} />;
                }
                return null;
              }),
            )}

            <line x1={cx(current)} y1={0} x2={cx(current)} y2={lanes.length * LANE} stroke="var(--accent)" strokeWidth={1.5} />

            <line x1={0} y1={lanes.length * LANE + 0.5} x2={width} y2={lanes.length * LANE + 0.5} stroke="var(--line)" />
            {steps.map((s) =>
              s.i % tickEvery === 0 && !timeJumps.some((j) => Math.abs(j.i - s.i) * px < 34) ? (
                <text key={s.i} x={cx(s.i)} y={lanes.length * LANE + 14} fontSize={9} textAnchor="middle" fill="var(--muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {s.i + 1}
                </text>
              ) : null,
            )}
          </svg>
        </div>
      </div>
      {hover && hoverStep && (
        <div
          className="pointer-events-none fixed z-50 max-w-[300px] rounded-md border border-line bg-elevated px-2.5 py-1.5 text-[11px] shadow-[var(--shadow)]"
          style={{ left: hover.x + 14, top: hover.y + 12 }}
        >
          <div className="font-semibold text-fg">
            Étape {hoverStep.i + 1} · t = {formatTime(hoverStep.time)}
          </div>
          <div className="text-muted">{hoverStep.title}</div>
          {hoverProc && (
            <div className="mt-1 flex items-center gap-1.5 text-fg">
              <LegendMark state={hoverProc.state} />
              <span className="font-mono font-semibold">{hoverProc.short}</span>
              <span>{STATE_META[hoverProc.state].label}</span>
              {hoverProc.blockedOn && <span className="text-muted">— {hoverProc.blockedOn}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
