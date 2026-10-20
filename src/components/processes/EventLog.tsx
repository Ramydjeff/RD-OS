import { useEffect, useMemo, useRef, useState } from "react";
import type { SimStep, StepKind } from "@/components/processes/engine";
import { KIND_LABEL } from "@/components/processes/simStyle";
import { cn } from "@/lib/cn";

const FILTERS: { id: string; label: string; kinds: Set<StepKind> }[] = [
  { id: "proc", label: "Processus", kinds: new Set(["start", "fork", "exit", "reap", "wait", "block", "wake", "sleep", "exec", "signal", "error", "end"]) },
  { id: "out", label: "Sorties", kinds: new Set(["output"]) },
  { id: "io", label: "Tubes & fd", kinds: new Set(["pipe"]) },
];

export function EventLog({ steps, current, onSeek }: { steps: SimStep[]; current: number; onSeek: (i: number) => void }) {
  const [active, setActive] = useState<Set<string>>(new Set(["proc", "out", "io"]));
  const kinds = useMemo(() => {
    const k = new Set<StepKind>();
    for (const f of FILTERS) if (active.has(f.id)) f.kinds.forEach((x) => k.add(x));
    return k;
  }, [active]);
  const events = useMemo(() => steps.filter((s) => kinds.has(s.kind)), [steps, kinds]);
  const listRef = useRef<HTMLOListElement>(null);

  const currentIdx = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < events.length; i++) if (events[i]!.i <= current) idx = i;
    return idx;
  }, [events, current]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-ev="${currentIdx}"]`);
    const box = listRef.current;
    if (!el || !box) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 24) box.scrollTop = Math.max(0, top - box.clientHeight / 2);
  }, [currentIdx]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap gap-1 border-b border-line px-2 py-1">
        {FILTERS.map((f) => {
          const on = active.has(f.id);
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setActive((prev) => {
                  const next = new Set(prev);
                  if (next.has(f.id)) next.delete(f.id);
                  else next.add(f.id);
                  return next;
                })
              }
              className={cn(
                "rounded border px-1.5 py-px text-[10px] font-medium",
                on ? "border-accent/60 bg-accent/10 text-fg" : "border-line text-muted hover:text-fg",
              )}
            >
              {on ? "✓ " : ""}
              {f.label}
            </button>
          );
        })}
        <span className="ml-auto self-center text-[10px] text-muted">{events.length} évén.</span>
      </div>
      <ol ref={listRef} className="min-h-0 flex-1 overflow-auto py-1">
        {events.map((s, k) => (
          <li key={s.i} data-ev={k}>
            <button
              type="button"
              onClick={() => onSeek(s.i)}
              className={cn(
                "flex w-full items-baseline gap-2 px-2 py-0.5 text-left text-[11px] hover:bg-hover",
                s.i === current && "bg-accent/15",
                s.i > current && "opacity-50",
              )}
            >
              <span className="w-7 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted">{s.i + 1}</span>
              <span className={cn("w-[90px] shrink-0 truncate text-[10px] font-semibold uppercase tracking-wide", s.kind === "error" ? "text-danger" : "text-muted")}>
                {KIND_LABEL[s.kind]}
              </span>
              <span className={cn("min-w-0 flex-1 truncate", s.i === current ? "text-fg font-medium" : "text-fg/90")} title={s.title}>
                {s.title}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
