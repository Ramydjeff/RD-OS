import type { ReactNode } from "react";
import { CircleCheck, Ghost, Hourglass, Moon, Pause, Play, Square } from "lucide-react";
import type { ProcState, ProcView, StepKind } from "@/components/processes/engine";
import { cn } from "@/lib/cn";

export const STATE_META: Record<ProcState, { label: string; desc: string; color: string; Icon: typeof Play }> = {
  RUNNING: { label: "En cours", desc: "utilise le processeur", color: "var(--st-run)", Icon: Play },
  READY: { label: "Prêt", desc: "attend son tour pour le processeur", color: "var(--st-ready)", Icon: Hourglass },
  WAITING: { label: "Bloqué", desc: "attend un événement (wait, read, pause…)", color: "var(--st-wait)", Icon: Pause },
  SLEEPING: { label: "Endormi", desc: "sleep() en cours, ne consomme pas le processeur", color: "var(--st-sleep)", Icon: Moon },
  STOPPED: { label: "Stoppé", desc: "suspendu par SIGSTOP", color: "var(--st-ready)", Icon: Square },
  ZOMBIE: { label: "Zombie", desc: "terminé, attend le wait() de son père", color: "var(--st-zombie)", Icon: Ghost },
  TERMINATED: { label: "Terminé", desc: "retiré de la table des processus", color: "var(--muted)", Icon: CircleCheck },
};

export const LEGEND_STATES: ProcState[] = ["RUNNING", "READY", "WAITING", "SLEEPING", "ZOMBIE", "TERMINATED"];

export const KIND_LABEL: Record<StepKind, string> = {
  start: "Démarrage",
  stmt: "Instruction",
  fork: "fork()",
  exit: "exit()",
  wait: "wait()",
  reap: "Récupération",
  block: "Blocage",
  wake: "Réveil",
  sleep: "sleep()",
  output: "Affichage",
  signal: "Signal",
  exec: "exec()",
  pipe: "Tube / fd",
  error: "Erreur",
  end: "Bilan",
};

/** Steps worth stopping on when "événements seulement" is enabled. */
export const EVENT_KINDS = new Set<StepKind>(["start", "fork", "exit", "wait", "reap", "block", "wake", "sleep", "output", "signal", "exec", "pipe", "error", "end"]);

export function StateIcon({ state, size = 11, className }: { state: ProcState; size?: number; className?: string }) {
  const { Icon, color } = STATE_META[state];
  return <Icon size={size} style={{ color }} fill={state === "RUNNING" ? color : "none"} strokeWidth={2.2} className={cn("shrink-0", className)} aria-hidden />;
}

export function StateBadge({ state, compact = false, className }: { state: ProcState; compact?: boolean; className?: string }) {
  const meta = STATE_META[state];
  return (
    <span
      title={`${meta.label} : ${meta.desc}`}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-semibold leading-4 text-fg",
        state === "ZOMBIE" ? "border-dashed" : "",
        state === "TERMINATED" ? "text-muted" : "",
        className,
      )}
      style={{ borderColor: `color-mix(in srgb, ${meta.color} 55%, transparent)`, backgroundColor: `color-mix(in srgb, ${meta.color} 12%, transparent)` }}
    >
      <StateIcon state={state} size={10} />
      {!compact && meta.label}
    </span>
  );
}

/** Small label identifying a process (P, F1, F1.2): identity is always carried by text. */
export function ProcChip({
  proc,
  active = false,
  onClick,
  className,
  children,
}: {
  proc: Pick<ProcView, "short" | "pid" | "state" | "label">;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={`${proc.label} — PID ${proc.pid} — ${STATE_META[proc.state].label}`}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-px font-mono text-[10px] font-semibold leading-4",
        active ? "bg-accent text-white" : "bg-elevated text-fg border border-line",
        onClick && "hover:border-accent2/60 cursor-pointer",
        className,
      )}
    >
      {proc.short}
      {children}
    </Tag>
  );
}

export function procExitText(p: ProcView): string {
  if (p.exitSignal !== null) return `tué par signal ${p.exitSignal}${p.core ? " (core)" : ""}`;
  if (p.exitCode !== null) return `exit ${p.exitCode}`;
  return "";
}
