import { useEffect, useMemo, useRef } from "react";
import type { OutChunk, ProcView } from "@/components/processes/engine";
import { cn } from "@/lib/cn";

interface Seg {
  pid: number;
  text: string;
  stream: OutChunk["stream"];
  step: number;
}

interface TerminalOutputProps {
  output: OutChunk[];
  upTo: number;
  procs: ProcView[];
  onSelectProcess: (pid: number) => void;
  showOwners: boolean;
}

export function TerminalOutput({ output, upTo, procs, onSelectProcess, showOwners }: TerminalOutputProps) {
  const byPid = useMemo(() => new Map(procs.map((p) => [p.pid, p])), [procs]);
  const lines = useMemo(() => {
    const out: Seg[][] = [[]];
    for (const c of output) {
      if (c.step > upTo) break;
      const parts = c.text.split("\n");
      parts.forEach((part, i) => {
        if (i > 0) out.push([]);
        if (part) out[out.length - 1]!.push({ pid: c.pid, text: part, stream: c.stream, step: c.step });
      });
    }
    if (out.length > 1 && out[out.length - 1]!.length === 0) out.pop();
    return out;
  }, [output, upTo]);

  const pending = procs.filter((p) => p.buffer && p.state !== "TERMINATED" && p.state !== "ZOMBIE");
  const empty = lines.length === 1 && lines[0]!.length === 0;
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = endRef.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, pending.length]);

  return (
    <div className="h-full overflow-auto bg-code px-2 py-1.5 font-mono text-[11.5px] leading-[19px] selectable">
      {empty && pending.length === 0 && <p className="px-1 text-[11px] italic text-muted">Rien n'est encore affiché.</p>}
      {!empty &&
        lines.map((segs, li) => {
          const owners = [...new Set(segs.filter((s) => s.stream !== "sys").map((s) => s.pid))];
          return (
            <div key={li} className="flex items-start gap-2">
              {showOwners && (
                <span className="flex w-12 shrink-0 justify-end gap-0.5 pt-[2px]">
                  {owners.slice(0, 2).map((pid) => {
                    const p = byPid.get(pid);
                    return (
                      <button
                        key={pid}
                        type="button"
                        onClick={() => onSelectProcess(pid)}
                        title={p ? `Écrit par ${p.label} (PID ${pid})` : `PID ${pid}`}
                        className="rounded bg-elevated px-1 text-[9px] font-bold leading-[14px] text-fg hover:bg-active"
                      >
                        {p?.short ?? pid}
                      </button>
                    );
                  })}
                  {owners.length > 2 && <span className="text-[9px] text-muted">+</span>}
                </span>
              )}
              <span className="min-w-0 whitespace-pre-wrap break-all">
                {segs.map((s, si) => (
                  <span
                    key={si}
                    title={s.stream === "err" ? "stderr" : s.stream === "sys" ? "message du shell" : undefined}
                    className={cn(
                      s.stream === "err" && "text-danger",
                      s.stream === "sys" && "italic text-muted",
                      s.stream === "out" && "text-fg",
                      s.step === upTo && s.stream !== "sys" && "sim-flash rounded-sm",
                      owners.length > 1 && s.stream === "out" && "underline decoration-dotted decoration-muted/60 underline-offset-4",
                    )}
                  >
                    {s.text}
                  </span>
                ))}
                {segs.length === 0 && " "}
              </span>
            </div>
          );
        })}
      {pending.map((p) => (
        <div key={p.pid} className="mt-1 flex items-start gap-2 rounded border border-dashed border-line px-1 py-0.5 text-muted">
          {showOwners && (
            <span className="flex w-12 shrink-0 justify-end pt-[2px]">
              <span className="rounded bg-elevated px-1 text-[9px] font-bold leading-[14px] text-fg">{p.short}</span>
            </span>
          )}
          <span className="min-w-0 whitespace-pre-wrap break-all">
            <span className="font-sans text-[10px] not-italic">tampon stdout, pas encore affiché : </span>
            <span className="italic">{p.buffer}</span>
          </span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
