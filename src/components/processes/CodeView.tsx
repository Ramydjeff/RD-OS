import { useEffect, useMemo, useRef } from "react";
import type { ProcView } from "@/components/processes/engine";
import { STATE_META } from "@/components/processes/simStyle";
import { cn } from "@/lib/cn";
import { highlight, TOKEN_STYLE } from "@/lib/highlight";

interface CodeViewProps {
  code: string;
  currentLine: number | null;
  activePid: number | null;
  procs: ProcView[];
  selectedPid: number | null;
  errors?: Map<number, string>;
  warnings?: Map<number, string>;
  breakpoints: Set<number>;
  onToggleBreakpoint: (line: number) => void;
  onSelectProcess: (pid: number) => void;
  className?: string;
}

export function CodeView({
  code,
  currentLine,
  activePid,
  procs,
  selectedPid,
  errors,
  warnings,
  breakpoints,
  onToggleBreakpoint,
  onSelectProcess,
  className,
}: CodeViewProps) {
  const lines = useMemo(() => highlight(code, "c"), [code]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const markers = useMemo(() => {
    const map = new Map<number, ProcView[]>();
    for (const p of procs) {
      if (p.state === "TERMINATED" || p.state === "ZOMBIE" || p.external) continue;
      const list = map.get(p.line) ?? [];
      list.push(p);
      map.set(p.line, list);
    }
    return map;
  }, [procs]);

  useEffect(() => {
    const box = scrollRef.current;
    if (!box || !currentLine) return;
    const row = box.querySelector<HTMLElement>(`[data-line="${currentLine}"]`);
    if (!row) return;
    const top = row.offsetTop - box.offsetTop;
    if (top < box.scrollTop + 24 || top > box.scrollTop + box.clientHeight - 40) {
      box.scrollTo({ top: Math.max(0, top - box.clientHeight / 2.5), behavior: "smooth" });
    }
  }, [currentLine, code]);

  return (
    <div ref={scrollRef} className={cn("relative overflow-auto bg-code font-mono text-[11.5px] leading-[19px] selectable", className)}>
      <div className="min-w-max py-1">
        {lines.map((toks, idx) => {
          const n = idx + 1;
          const isCurrent = n === currentLine;
          const here = markers.get(n) ?? [];
          const err = errors?.get(n);
          const warn = warnings?.get(n);
          const bp = breakpoints.has(n);
          return (
            <div key={n} data-line={n}>
              <div
                className={cn(
                  "group flex items-stretch pr-2",
                  isCurrent && "bg-accent/15",
                  !isCurrent && here.length > 0 && "bg-codeline",
                  err && "bg-danger/15",
                )}
              >
                <button
                  type="button"
                  onClick={() => onToggleBreakpoint(n)}
                  title={bp ? "Retirer le point d'arrêt" : "Ajouter un point d'arrêt (la lecture s'arrêtera ici)"}
                  className={cn(
                    "relative flex w-11 shrink-0 items-center justify-end gap-1 border-r pr-2 text-[10px] tabular-nums select-none",
                    isCurrent ? "border-accent text-fg font-semibold" : "border-line/70 text-muted/70 hover:text-fg",
                  )}
                >
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      bp ? "bg-danger" : "bg-transparent group-hover:bg-danger/30",
                    )}
                    aria-hidden
                  />
                  {n}
                </button>
                <span
                  className={cn("whitespace-pre pl-3 pr-4 text-fg/90", isCurrent && "text-fg")}
                  title={err ?? warn ?? undefined}
                >
                  {toks.length === 0 ? " " : toks.map((t, i) => (
                    <span key={i} className={t.c ? TOKEN_STYLE[t.c] : undefined}>
                      {t.t}
                    </span>
                  ))}
                  {warn && !err && <span className="ml-2 text-[10px] not-italic text-status-warn">⚠</span>}
                </span>
                {here.length > 0 && (
                  <span className="ml-auto flex items-center gap-1 pl-2">
                    {here.map((p) => {
                      const isActive = p.pid === activePid;
                      const meta = STATE_META[p.state];
                      return (
                        <button
                          key={p.pid}
                          type="button"
                          onClick={() => onSelectProcess(p.pid)}
                          title={`${p.label} (PID ${p.pid}) — ${meta.label}${isActive ? " — vient d'exécuter cette ligne" : " — prochaine instruction"}`}
                          className={cn(
                            "rounded px-1 font-sans text-[9.5px] font-bold leading-[15px] border",
                            isActive ? "bg-accent text-white border-accent" : "bg-surface text-fg",
                            selectedPid === p.pid && !isActive && "ring-1 ring-accent2/70",
                          )}
                          style={isActive ? undefined : { borderColor: meta.color }}
                        >
                          {p.short}
                        </button>
                      );
                    })}
                  </span>
                )}
              </div>
              {err && (
                <div className="ml-11 border-l-2 border-danger bg-danger/10 px-3 py-1 font-sans text-[11px] text-fg whitespace-normal">
                  {err}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
