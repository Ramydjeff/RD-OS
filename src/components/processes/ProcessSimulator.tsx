// The process simulator, laid out like a player: the program and its settings
// on top, what happens now next to the code in the middle, the process tree
// and the details (output, timeline, memory, log, summary) on the right, and
// the transport at the bottom.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChartColumn,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleX,
  Code2,
  Copy,
  Ellipsis,
  FileCode2,
  FileUp,
  FolderTree,
  History,
  Keyboard,
  ListTree,
  MemoryStick,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  ScrollText,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  Upload,
  X,
} from "lucide-react";
import { CodeView } from "@/components/processes/CodeView";
import { EventLog } from "@/components/processes/EventLog";
import { MemoryPanel } from "@/components/processes/MemoryPanel";
import { ProcessTimeline, TimelineLegend } from "@/components/processes/ProcessTimeline";
import { ProcessTreeGraph } from "@/components/processes/ProcessTreeGraph";
import { TerminalOutput } from "@/components/processes/TerminalOutput";
import {
  checkSource,
  formatTime,
  simulate,
  terminalText,
  type Policy,
  type SimOptions,
  type SimStep,
} from "@/components/processes/engine";
import { SIM_EXAMPLES } from "@/components/processes/simExamples";
import { EVENT_KINDS, KIND_LABEL, ProcChip, STATE_META, StateIcon } from "@/components/processes/simStyle";
import { Button } from "@/components/ui/Button";
import { CodeEditor } from "@/components/ui/CodeEditor";
import { ContextMenu, type MenuItem } from "@/components/ui/ContextMenu";
import { FIELD, Toggle } from "@/components/ui/Fields";
import { Modal } from "@/components/ui/Modal";
import { insertIntoActive, openTerminal } from "@/features/terminalActions";
import { cn } from "@/lib/cn";
import { useCFiles } from "@/store/cfiles";
import { isExampleModified, resetExample, useSimulator } from "@/store/simulator";
import { toast } from "@/store/ui";

interface ProcessSimulatorProps {
  externalCode?: { code: string; fileName: string; fileId?: string } | null;
  onExternalConsumed?: () => void;
  onOpenFileManager?: () => void;
  /** Shown at the left of the toolbar (the page's view switch). */
  nav?: ReactNode;
}

const POLICIES: { id: Policy; label: string; hint: string }[] = [
  { id: "parent", label: "Père d'abord (Linux)", hint: "Non préemptif : le processus qui tourne continue jusqu'à se bloquer ou se terminer ; après fork(), le père garde le processeur (comportement habituel de Linux)." },
  { id: "child", label: "Fils d'abord", hint: "Après chaque fork(), le fils obtient immédiatement le processeur." },
  { id: "rr", label: "Tourniquet (round-robin)", hint: "Préemptif : chaque processus exécute au plus q instructions puis cède le processeur au suivant." },
  { id: "random", label: "Aléatoire", hint: "L'ordonnanceur choisit au hasard : montre que l'ordre d'affichage n'est pas garanti." },
];

const BUFFERS: { id: SimOptions["buffer"]; label: string }[] = [
  { id: "line", label: "Terminal (par ligne)" },
  { id: "full", label: "Fichier / tube (complet)" },
  { id: "none", label: "Non bufferisé" },
];

const SPEEDS = [0.5, 1, 2, 4];

type Insight = "output" | "timeline" | "memory" | "events" | "summary";

const INSIGHTS: { id: Insight; label: string; Icon: typeof Play }[] = [
  { id: "output", label: "Sortie", Icon: TerminalSquare },
  { id: "timeline", label: "Chronologie", Icon: History },
  { id: "memory", label: "Mémoire", Icon: MemoryStick },
  { id: "events", label: "Journal", Icon: ScrollText },
  { id: "summary", label: "Bilan", Icon: ChartColumn },
];

function Panel({
  title,
  icon,
  right,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  icon: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface", className)}>
      <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-line px-3.5">
        <h3 className="flex min-w-0 items-center gap-2 text-[12.5px] font-semibold text-fg">
          <span className="shrink-0 text-muted">{icon}</span>
          <span className="truncate">{title}</span>
        </h3>
        {right && <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted">{right}</div>}
      </header>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg/40 px-3 py-2" title={hint}>
      <div className="font-display text-[19px] font-semibold tabular-nums text-fg">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}

/** What the current step does, in plain words. */
function StepCard({ step, total, onSelect }: { step: SimStep; total: number; onSelect: (pid: number) => void }) {
  const proc = step.procs.find((p) => p.pid === step.pid);
  const warnings = step.text.filter((t) => t.startsWith("⚠"));
  const texts = step.text.filter((t) => !t.startsWith("⚠"));
  return (
    <section aria-live="polite" className="relative shrink-0 overflow-hidden rounded-xl border border-line bg-surface">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", step.kind === "error" ? "bg-danger" : "bg-accent")} />
      <div className="max-h-[210px] min-h-[128px] overflow-y-auto py-3.5 pr-4 pl-5">
        <div className="flex items-center gap-2">
          {proc ? (
            <ProcChip proc={proc} active onClick={() => onSelect(proc.pid)}>
              <span className="font-normal opacity-80">{proc.pid}</span>
            </ProcChip>
          ) : (
            <span className="rounded bg-elevated px-1.5 font-mono text-[10px] font-semibold text-fg">noyau</span>
          )}
          <span className={cn("text-[10.5px] font-semibold tracking-[0.12em] uppercase", step.kind === "error" ? "text-danger" : "text-muted")}>
            {KIND_LABEL[step.kind]}
          </span>
          <span
            className="ml-auto shrink-0 font-mono text-[11px] text-faint tabular-nums"
            title="Temps simulé : 1 instruction ≈ 1 ms, sleep() fait avancer l'horloge"
          >
            {step.i + 1}/{total} · t = {formatTime(step.time)}
          </span>
        </div>
        <h2 className="mt-2 text-[15px] leading-snug font-semibold text-fg">{step.title}</h2>
        {texts.map((t, i) => (
          <p key={i} className={cn("mt-1 text-[13px] leading-relaxed", i === 0 && t.startsWith("Changement de contexte") ? "text-muted" : "text-fg2")}>
            {t}
          </p>
        ))}
        {warnings.map((t, i) => (
          <p key={`w${i}`} className="mt-2 flex items-start gap-1.5 rounded-lg border border-status-warn/50 bg-status-warn/10 px-2.5 py-1.5 text-[12px] text-fg">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-status-warn" />
            {t.replace(/^⚠\s*/, "")}
          </p>
        ))}
        {(step.src || step.notes.length > 0) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {step.src && (
              <code className="max-w-full truncate rounded-md bg-code px-2 py-0.5 font-mono text-[11px] text-fg2" title={step.src}>
                l.{step.line} · {step.src}
              </code>
            )}
            {step.notes.map((n, i) => (
              <span key={i} className="rounded-md border border-line px-2 py-0.5 font-mono text-[11px] text-fg">
                {n}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Scheduling, stdout buffering, stdin and stepping: everything that changes the run. */
function SettingsPanel({
  options,
  setOptions,
  eventsOnly,
  setEventsOnly,
  anchor,
  onClose,
}: {
  options: SimOptions;
  setOptions: (patch: Partial<SimOptions>) => void;
  eventsOnly: boolean;
  setEventsOnly: (v: boolean) => void;
  anchor: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", away, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [anchor, onClose]);
  const policy = POLICIES.find((p) => p.id === options.policy)!;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Réglages de la simulation"
      className="pop-in absolute top-[52px] right-3 z-30 w-[370px] max-w-[calc(100%-24px)] rounded-xl border border-line bg-elevated p-4 shadow-[var(--shadow)]"
    >
      <h3 className="text-[13px] font-semibold text-fg">Réglages de la simulation</h3>
      <p className="mt-0.5 text-[11.5px] text-muted">Chaque changement relance la simulation depuis le début.</p>

      <p className="mt-4 mb-1.5 text-[11.5px] font-medium text-fg2">Ordonnancement</p>
      <div className="grid grid-cols-2 gap-1.5">
        {POLICIES.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setOptions({ policy: p.id })}
            className={cn(
              "rounded-lg border px-2.5 py-2 text-left text-[12px] font-medium transition-colors",
              options.policy === p.id ? "border-accent/60 bg-active text-fg" : "border-line text-fg2 hover:bg-hover",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-muted">{policy.hint}</p>
      {options.policy === "rr" && (
        <label className="mt-2 flex items-center gap-2 text-[12px] text-fg2">
          Quantum
          <input
            type="number"
            min={1}
            max={20}
            value={options.quantum}
            onChange={(e) => setOptions({ quantum: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
            className={cn(FIELD, "h-7 w-16")}
          />
          instructions
        </label>
      )}
      {options.policy === "random" && (
        <Button size="sm" className="mt-2" onClick={() => setOptions({ seed: options.seed + 1 })} title="Rejouer avec un autre ordre aléatoire">
          <Shuffle size={12} /> Autre ordre (graine {options.seed})
        </Button>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-[11.5px] font-medium text-fg2" title="Un terminal vide stdout à chaque \n ; un fichier ou un tube seulement quand le tampon est plein ou à exit().">
          Tampon de stdout
          <select
            value={options.buffer}
            onChange={(e) => setOptions({ buffer: e.target.value as SimOptions["buffer"] })}
            className={cn(FIELD, "h-8 text-[12px]")}
          >
            {BUFFERS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[11.5px] font-medium text-fg2" title="Texte lu par scanf(), getchar(), fgets() ou read(0, …)">
          Entrée clavier (stdin)
          <input
            value={options.stdin.replace(/\n/g, "\\n")}
            onChange={(e) => setOptions({ stdin: e.target.value.replace(/\\n/g, "\n") })}
            placeholder="ex. 3 4\n"
            className={cn(FIELD, "h-8 font-mono text-[12px]")}
          />
        </label>
      </div>

      <div className="mt-4 flex items-start justify-between gap-3 border-t border-line pt-3">
        <span>
          <span className="block text-[12.5px] text-fg">Événements seulement</span>
          <span className="block text-[11px] text-muted">Lecture et pas à pas sautent les instructions simples.</span>
        </span>
        <Toggle checked={eventsOnly} onChange={setEventsOnly} label="Événements seulement" />
      </div>
    </div>
  );
}

function PlayerButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-fg2 transition-colors hover:bg-hover hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function shellQuote(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function ProcessSimulator({ externalCode, onExternalConsumed, onOpenFileManager, nav }: ProcessSimulatorProps = {}) {
  const programs = useSimulator((s) => s.programs);
  const selectedId = useSimulator((s) => s.selectedId);
  const options = useSimulator((s) => s.options);
  const { select, load, updateCode, remove, setOptions } = useSimulator.getState();
  const program = programs.find((p) => p.id === selectedId) ?? programs[0]!;

  const result = useMemo(() => simulate(program.code, program.fileName, options), [program.code, program.fileName, options]);
  const steps = result.steps;
  const maxStep = Math.max(0, steps.length - 1);

  const [stepIdx, setStepIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [eventsOnly, setEventsOnly] = useState(false);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const [showOwners, setShowOwners] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [insight, setInsight] = useState<Insight>("output");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  // A new trace (code or options changed): go back to the start.
  useEffect(() => {
    setStepIdx(0);
    setPlaying(false);
    setSelectedPid(null);
  }, [result]);

  useEffect(() => {
    setBreakpoints(new Set());
  }, [program.id]);

  useEffect(() => {
    if (!externalCode?.code) return;
    load(externalCode);
    onExternalConsumed?.();
    toast("success", `« ${externalCode.fileName} » chargé dans le simulateur.`);
  }, [externalCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const idx = Math.min(stepIdx, maxStep);
  const step = steps[idx];

  const isStop = useCallback((s: SimStep) => !eventsOnly || EVENT_KINDS.has(s.kind), [eventsOnly]);
  const nextIndex = useCallback(
    (from: number, dir: 1 | -1, eventOnly = false) => {
      for (let i = from + dir; i >= 0 && i <= maxStep; i += dir) {
        const s = steps[i]!;
        if (eventOnly ? EVENT_KINDS.has(s.kind) && s.kind !== "stmt" : isStop(s)) return i;
      }
      return from;
    },
    [steps, maxStep, isStop],
  );

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setStepIdx((prev) => {
        const next = nextIndex(prev, 1);
        if (next === prev) {
          setPlaying(false);
          return prev;
        }
        const s = steps[next]!;
        if (breakpoints.has(s.line) && s.pid !== 0) {
          setPlaying(false);
          toast("info", `Point d'arrêt ligne ${s.line}`);
        }
        return next;
      });
    }, 1100 / speed);
    return () => clearInterval(t);
  }, [playing, speed, nextIndex, steps, breakpoints]);

  const go = useCallback((i: number) => {
    setPlaying(false);
    setStepIdx(Math.max(0, Math.min(maxStep, i)));
  }, [maxStep]);

  const togglePlay = useCallback(() => {
    if (idx >= maxStep) setStepIdx(0);
    setPlaying((p) => !p);
  }, [idx, maxStep]);

  // Keyboard: ← → pas, Maj+← → événement, Espace lecture, Début/Fin.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (editorOpen || helpOpen || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable))) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        go(nextIndex(idx, 1, e.shiftKey));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(nextIndex(idx, -1, e.shiftKey));
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "Home") {
        e.preventDefault();
        go(0);
      } else if (e.key === "End") {
        e.preventDefault();
        go(maxStep);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, maxStep, go, nextIndex, togglePlay, editorOpen, helpOpen]);

  const forkLines = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of steps) for (const mk of s.marks) if (mk.type === "fork") m.set(mk.to, s.line);
    return m;
  }, [steps]);

  // fork() and exit() positions, drawn as ticks on the progress bar.
  const ticks = useMemo(
    () => steps.filter((s) => s.kind === "fork" || s.kind === "exit").map((s) => ({ i: s.i, kind: s.kind })),
    [steps],
  );

  const procs = step?.procs ?? [];
  const activePid = step && step.pid !== 0 ? step.pid : null;
  const shownPid = selectedPid ?? activePid ?? procs[0]?.pid ?? null;
  const shownProc = procs.find((p) => p.pid === shownPid) ?? null;
  const aliveCount = procs.filter((p) => p.state !== "TERMINATED" && p.state !== "ZOMBIE").length;

  const errorLines = useMemo(() => new Map(result.errors.map((e) => [e.line, e.message])), [result.errors]);
  const warnLines = useMemo(() => {
    const m = new Map<number, string>();
    for (const w of result.warnings) if (w.line && !m.has(w.line)) m.set(w.line, w.message);
    return m;
  }, [result.warnings]);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") {
        load({ code: text, fileName: file.name });
        toast("success", `« ${file.name} » chargé.`);
      }
    };
    reader.readAsText(file);
  };

  const runInWsl = async () => {
    try {
      const id = await openTerminal();
      if (!id) return;
      const safe = program.fileName.replace(/[^\w.-]/g, "_").replace(/\.c$/i, "") || "prog";
      const tag = `RDOS_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      let cmd = `cat > /tmp/${safe}.c << '${tag}'\n${program.code.replace(/\s*$/, "")}\n${tag}\ngcc -Wall -o /tmp/${safe} /tmp/${safe}.c && /tmp/${safe}`;
      if (options.stdin) cmd += ` < <(printf '%s' ${shellQuote(options.stdin)})`;
      setTimeout(() => insertIntoActive(cmd + "\n"), 450);
      toast("info", "Compilation avec gcc et exécution réelle dans le terminal WSL : comparez avec la simulation.");
    } catch {
      toast("error", "Impossible d'ouvrir le terminal.");
    }
  };

  const copyOutput = () => {
    void navigator.clipboard?.writeText(terminalText(result, idx)).then(
      () => toast("success", "Sortie copiée."),
      () => toast("error", "Copie impossible."),
    );
  };

  const toggleBreakpoint = (line: number) =>
    setBreakpoints((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });

  const policy = POLICIES.find((p) => p.id === options.policy)!;
  const modified = isExampleModified(program);
  const customs = programs.filter((p) => p.isCustom);
  const examples = programs.filter((p) => !p.isCustom);
  const compileFailed = !result.ok && steps.length === 0;
  const progress = maxStep > 0 ? (idx / maxStep) * 100 : 0;

  const moreItems: (MenuItem | "separator")[] = [
    { id: "open", label: "Ouvrir un fichier .c…", icon: <FileUp size={13} />, onSelect: () => fileInputRef.current?.click() },
    ...(onOpenFileManager ? [{ id: "files", label: "Mes fichiers C", icon: <FolderTree size={13} />, onSelect: onOpenFileManager }] : []),
    { id: "gcc", label: "Exécuter pour de vrai (gcc dans WSL)", icon: <TerminalSquare size={13} />, onSelect: () => void runInWsl() },
    ...(modified ? [{ id: "reset", label: "Rétablir l'exemple d'origine", icon: <RotateCcw size={13} />, onSelect: () => resetExample(program.id) }] : []),
    ...(program.isCustom
      ? [{ id: "remove", label: "Retirer ce fichier du simulateur", icon: <X size={13} />, danger: true, onSelect: () => remove(program.id) }]
      : []),
    "separator",
    { id: "help", label: "Aide et raccourcis clavier", icon: <Keyboard size={13} />, onSelect: () => setHelpOpen(true) },
  ];

  return (
    <div
      className="@container relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) readFile(f);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".c,.h,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) readFile(f);
          e.target.value = "";
        }}
      />
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-accent bg-bg/90">
          <Upload size={34} className="mb-2 text-accent" />
          <p className="text-sm font-semibold text-fg">Déposez votre fichier .c</p>
          <p className="text-xs text-muted">Il sera compilé et exécuté par le simulateur</p>
        </div>
      )}

      {/* ── Programme et réglages ─────────────────────────────────────── */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        {nav}
        {nav && <span aria-hidden className="mx-1 h-5 w-px bg-line" />}
        <label className="relative flex h-8 min-w-0 items-center rounded-lg border border-line bg-surface pl-2.5 transition-colors hover:border-line-strong">
          <FileCode2 size={14} className="shrink-0 text-muted" />
          <select
            value={program.id}
            onChange={(e) => select(e.target.value)}
            className="h-full max-w-[230px] min-w-0 cursor-pointer appearance-none truncate bg-transparent pr-7 pl-2 text-[12.5px] font-medium text-fg outline-none"
            aria-label="Programme simulé"
          >
            {customs.length > 0 && (
              <optgroup label="Mes fichiers">
                {customs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Exemples">
              {examples.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                  {isExampleModified(p) ? " (modifié)" : ""}
                </option>
              ))}
            </optgroup>
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-2 text-muted" />
        </label>
        <Button size="sm" variant="ghost" onClick={() => setEditorOpen(true)}>
          <Pencil size={13} /> Modifier le code
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" className="hidden @4xl:inline-flex" onClick={() => void runInWsl()} title="Compiler avec gcc et exécuter pour de vrai dans WSL">
            <TerminalSquare size={13} /> Comparer avec gcc
          </Button>
          <Button
            ref={settingsRef}
            size="sm"
            variant={settingsOpen ? "secondary" : "ghost"}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((o) => !o)}
            title={`Ordonnancement : ${policy.label}`}
          >
            <SlidersHorizontal size={13} /> Réglages
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Plus d'actions"
            title="Plus d'actions"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ x: r.right - 220, y: r.bottom + 6 });
            }}
          >
            <Ellipsis size={15} />
          </Button>
        </div>
      </div>
      {settingsOpen && (
        <SettingsPanel
          options={options}
          setOptions={setOptions}
          eventsOnly={eventsOnly}
          setEventsOnly={setEventsOnly}
          anchor={settingsRef}
          onClose={closeSettings}
        />
      )}

      {/* ── Contenu ───────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto @5xl:overflow-hidden">
        {compileFailed ? (
          <div className="grid gap-3 p-3 @5xl:h-full @5xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <section className="self-start rounded-xl border border-danger/40 bg-surface p-5">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg">
                <CircleX size={18} className="text-danger" /> Le programme ne compile pas
              </h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                Comme gcc, le simulateur refuse d'exécuter un programme qui contient des erreurs. Corrigez-les puis relancez.
              </p>
              <ul className="mt-3 space-y-1.5">
                {result.errors.map((e, i) => (
                  <li key={i} className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-[12.5px] text-fg">
                    <span className="font-mono font-semibold">ligne {e.line}</span> : {e.message}
                  </li>
                ))}
              </ul>
              {result.warnings.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {result.warnings.map((w, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11.5px] text-muted">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0 text-status-warn" />
                      {w.line ? `ligne ${w.line} : ` : ""}
                      {w.message}
                    </li>
                  ))}
                </ul>
              )}
              <Button className="mt-4" variant="primary" onClick={() => setEditorOpen(true)}>
                <Pencil size={14} /> Corriger le code
              </Button>
            </section>
            <Panel title={program.fileName} icon={<Code2 size={14} />} className="h-[460px] @5xl:h-full">
              <CodeView
                className="h-full"
                code={result.code}
                currentLine={result.errors[0]?.line ?? null}
                activePid={null}
                procs={[]}
                selectedPid={null}
                errors={errorLines}
                warnings={warnLines}
                breakpoints={breakpoints}
                onToggleBreakpoint={() => undefined}
                onSelectProcess={() => undefined}
              />
            </Panel>
          </div>
        ) : step ? (
          <div className="grid gap-3 p-3 @5xl:h-full @5xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            {/* Ce qui se passe + le code */}
            <div className="flex min-h-0 min-w-0 flex-col gap-3">
              {!result.ok && result.error && (
                <div className="flex shrink-0 items-start gap-2 rounded-xl border border-danger/50 bg-danger/10 px-3.5 py-2.5 text-[12.5px] text-fg">
                  <CircleX size={14} className="mt-0.5 shrink-0 text-danger" />
                  <span>
                    Simulation interrompue ligne {result.error.line} : {result.error.message}
                  </span>
                </div>
              )}
              <StepCard step={step} total={steps.length} onSelect={setSelectedPid} />
              <Panel
                title={program.fileName}
                icon={<Code2 size={14} />}
                right={<span className="hidden @6xl:inline">Clic sur un numéro de ligne : point d'arrêt</span>}
                className="h-[440px] @5xl:h-auto @5xl:flex-1"
              >
                <CodeView
                  className="h-full"
                  code={result.code}
                  currentLine={step.kind === "end" ? null : step.line}
                  activePid={activePid}
                  procs={procs}
                  selectedPid={selectedPid}
                  warnings={warnLines}
                  breakpoints={breakpoints}
                  onToggleBreakpoint={toggleBreakpoint}
                  onSelectProcess={setSelectedPid}
                />
              </Panel>
            </div>

            {/* L'arbre + les détails */}
            <div className="flex min-h-0 min-w-0 flex-col gap-3">
              <Panel
                title="Arbre des processus"
                icon={<ListTree size={14} />}
                right={
                  <>
                    <span className="tabular-nums">
                      {procs.length} créé{procs.length > 1 ? "s" : ""} · {aliveCount} vivant{aliveCount > 1 ? "s" : ""}
                    </span>
                    {selectedPid !== null && (
                      <button type="button" className="rounded-md px-1.5 py-0.5 text-accent hover:bg-hover" onClick={() => setSelectedPid(null)}>
                        Suivre l'actif
                      </button>
                    )}
                  </>
                }
                className="h-[300px] @5xl:h-auto @5xl:flex-[5]"
                bodyClassName="bg-code/40"
              >
                <ProcessTreeGraph
                  procs={procs}
                  activePid={activePid}
                  selectedPid={selectedPid}
                  onSelectProcess={(pid) => setSelectedPid((cur) => (cur === pid ? null : pid))}
                  forkLines={forkLines}
                  marks={step.marks}
                  stepIndex={step.i}
                />
              </Panel>

              <section className="flex h-[340px] min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface @5xl:h-auto @5xl:flex-[4]">
                <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-1.5">
                  <div role="tablist" aria-label="Détails de la simulation" className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
                    {INSIGHTS.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={insight === t.id}
                        onClick={() => setInsight(t.id)}
                        className={cn(
                          "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors",
                          insight === t.id ? "bg-hover text-fg" : "text-muted hover:text-fg2",
                        )}
                      >
                        <t.Icon size={13} className={insight === t.id ? "text-accent" : undefined} />
                        {t.label}
                        {t.id === "output" && step.kind === "output" && insight !== "output" && (
                          <span aria-label="nouvel affichage" className="h-1.5 w-1.5 rounded-full bg-accent" />
                        )}
                        {t.id === "summary" && result.warnings.length > 0 && (
                          <span className="rounded-full bg-status-warn/15 px-1.5 text-[10px] font-semibold text-status-warn tabular-nums">
                            {result.warnings.length}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  {insight === "output" && (
                    <div className="ml-auto flex shrink-0 items-center gap-1 pr-1 text-[11px] text-muted">
                      <label className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 hover:text-fg2">
                        <input type="checkbox" checked={showOwners} onChange={(e) => setShowOwners(e.target.checked)} className="accent-[var(--accent)]" />
                        Auteurs
                      </label>
                      <button type="button" onClick={copyOutput} className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-hover hover:text-fg" title="Copier la sortie affichée">
                        <Copy size={12} /> Copier
                      </button>
                    </div>
                  )}
                </header>
                <div className="min-h-0 flex-1 overflow-auto">
                  {insight === "output" && (
                    <TerminalOutput output={result.output} upTo={idx} procs={procs} onSelectProcess={setSelectedPid} showOwners={showOwners} />
                  )}
                  {insight === "timeline" && (
                    <>
                      <div className="px-3.5 pt-2.5 pb-1">
                        <TimelineLegend />
                      </div>
                      <ProcessTimeline steps={steps} current={idx} onSeek={go} selectedPid={selectedPid} onSelectProcess={setSelectedPid} />
                    </>
                  )}
                  {insight === "memory" && (
                    <>
                      <div className="flex flex-wrap items-center gap-1 border-b border-line px-3.5 py-2">
                        <span className="mr-1 text-[11px] text-muted">Processus :</span>
                        {procs.map((p) => (
                          <ProcChip
                            key={p.pid}
                            proc={p}
                            active={p.pid === shownPid}
                            onClick={() => setSelectedPid(p.pid)}
                            className={p.state === "TERMINATED" ? "opacity-50" : undefined}
                          />
                        ))}
                      </div>
                      <MemoryPanel proc={shownProc} following={selectedPid === null} />
                    </>
                  )}
                  {insight === "events" && <EventLog steps={steps} current={idx} onSeek={go} />}
                  {insight === "summary" && (
                    <div className="space-y-4 p-3.5">
                      <div className="grid grid-cols-3 gap-2">
                        <Stat label="Processus créés" value={result.stats.processes} hint="Processus principal compris" />
                        <Stat label="fork() réussis" value={result.stats.forks} />
                        <Stat label="Max simultanés" value={result.stats.maxAlive} />
                        <Stat label="Lignes affichées" value={result.stats.outputLines} />
                        <Stat label="Zombies (passés)" value={result.stats.zombies} hint="Processus restés zombies au moins une étape" />
                        <Stat label="Orphelins" value={result.stats.orphans} hint="Adoptés par init (PID 1)" />
                      </div>
                      <div className="flex items-center justify-between text-[12px] text-muted">
                        <span>Durée simulée</span>
                        <span className="font-mono text-fg tabular-nums">{formatTime(result.stats.duration)}</span>
                      </div>
                      {result.stats.deadlocked > 0 && (
                        <p className="flex items-start gap-1.5 rounded-lg border border-danger/50 bg-danger/10 px-2.5 py-1.5 text-[12px] text-fg">
                          <CircleX size={13} className="mt-0.5 shrink-0 text-danger" />
                          {result.stats.deadlocked} processus bloqué{result.stats.deadlocked > 1 ? "s" : ""} pour toujours (interblocage) : voir la dernière étape.
                        </p>
                      )}
                      {result.warnings.length > 0 ? (
                        <div className="space-y-1">
                          <p className="text-[11.5px] font-medium text-fg2">Avertissements</p>
                          {result.warnings.map((w, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => (w.step !== undefined ? go(w.step) : undefined)}
                              className={cn("flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] text-fg", w.step !== undefined && "hover:bg-hover")}
                            >
                              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-status-warn" />
                              <span>
                                {w.line ? <span className="font-mono text-muted">l.{w.line} </span> : null}
                                {w.message}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[12px] text-muted">Aucun avertissement.</p>
                      )}
                      <div className="space-y-1 border-t border-line pt-3 text-[11.5px] text-muted">
                        <p className="font-medium text-fg2">États d'un processus</p>
                        {(["RUNNING", "READY", "WAITING", "SLEEPING", "ZOMBIE", "TERMINATED"] as const).map((s) => (
                          <div key={s} className="flex items-center gap-1.5">
                            <StateIcon state={s} />
                            <span className="font-medium text-fg">{STATE_META[s].label}</span>
                            <span className="truncate">{STATE_META[s].desc}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Lecteur ───────────────────────────────────────────────────── */}
      {!compileFailed && step && (
        <div className="flex h-[60px] shrink-0 items-center gap-3 border-t border-line bg-surface px-3 @3xl:px-4">
          <div className="flex shrink-0 items-center">
            <PlayerButton label="Début (Début)" onClick={() => go(0)} disabled={idx === 0}>
              <SkipBack size={15} />
            </PlayerButton>
            <PlayerButton label="Événement précédent (Maj+←)" onClick={() => go(nextIndex(idx, -1, true))} disabled={idx === 0}>
              <ChevronsLeft size={17} />
            </PlayerButton>
            <PlayerButton label="Étape précédente (←)" onClick={() => go(nextIndex(idx, -1))} disabled={idx === 0}>
              <ChevronLeft size={18} />
            </PlayerButton>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Lecture"}
              title="Lecture / pause (Espace)"
              className="mx-1.5 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-onaccent shadow-[0_6px_18px_-6px_var(--accent)] transition-[background-color,transform] hover:bg-accent-hover active:scale-95"
            >
              {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="translate-x-px" />}
            </button>
            <PlayerButton label="Étape suivante (→)" onClick={() => go(nextIndex(idx, 1))} disabled={idx >= maxStep}>
              <ChevronRight size={18} />
            </PlayerButton>
            <PlayerButton label="Événement suivant (Maj+→)" onClick={() => go(nextIndex(idx, 1, true))} disabled={idx >= maxStep}>
              <ChevronsRight size={17} />
            </PlayerButton>
            <PlayerButton label="Fin (Fin)" onClick={() => go(maxStep)} disabled={idx >= maxStep}>
              <SkipForward size={15} />
            </PlayerButton>
          </div>

          <div className="relative flex h-8 min-w-[120px] flex-1 items-center">
            <div aria-hidden className="pointer-events-none absolute inset-x-[7px] top-[25px] h-1">
              {ticks.map((t) => (
                <span
                  key={t.i}
                  title={t.kind === "fork" ? "fork()" : "exit()"}
                  className={cn("absolute h-1 w-[2px] rounded-full", t.kind === "fork" ? "bg-accent/80" : "bg-faint")}
                  style={{ left: `${maxStep > 0 ? (t.i / maxStep) * 100 : 0}%` }}
                />
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={maxStep}
              value={idx}
              onChange={(e) => go(Number(e.target.value))}
              aria-label="Position dans la trace d'exécution"
              style={{ background: `linear-gradient(to right, var(--accent) ${progress}%, var(--line-strong) ${progress}%)` }}
              className="h-1 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-fg [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_var(--accent)] [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-110"
            />
          </div>

          <span className="w-[76px] shrink-0 text-right font-mono text-[12px] text-fg2 tabular-nums">
            {idx + 1} <span className="text-faint">/ {steps.length}</span>
          </span>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="h-8 shrink-0 cursor-pointer rounded-lg border border-line bg-bg px-2 text-[12px] text-fg outline-none hover:border-line-strong"
            aria-label="Vitesse de lecture"
            title="Vitesse de lecture"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                ×{s}
              </option>
            ))}
          </select>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={moreItems} onClose={() => setMenu(null)} />}

      {editorOpen && (
        <CodeEditorModal
          initialCode={program.code}
          fileName={program.fileName}
          canSaveToFile={!!program.fileId}
          onClose={() => setEditorOpen(false)}
          onApply={(code, fileName, saveToFile) => {
            if (program.isCustom) updateCode(program.id, code, fileName);
            else if (fileName === program.fileName) updateCode(program.id, code);
            else load({ code, fileName });
            if (saveToFile && program.fileId) {
              useCFiles.getState().updateFileContent(program.fileId, code);
              toast("success", "Fichier enregistré dans « Mes fichiers ».");
            }
            setEditorOpen(false);
          }}
        />
      )}

      {helpOpen && (
        <Modal title="Comment lire la simulation" onClose={() => setHelpOpen(false)} width="max-w-xl">
          <div className="space-y-3 text-[12px] text-fg">
            <p>
              Le code C est réellement interprété : chaque instruction est exécutée par un processus simulé, et chaque appel système
              (fork, wait, exit, sleep, pipe, kill…) passe par un noyau UNIX simulé qui gère la table des processus, les zombies, les
              orphelins adoptés par init, les tampons de stdout et l'ordonnancement.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>fork() copie toute la mémoire du père : chaque processus a ses propres variables (onglet Mémoire).</li>
              <li>L'ordre des affichages dépend de l'ordonnanceur : changez-le dans Réglages pour voir d'autres ordres possibles.</li>
              <li>« Comparer avec gcc » lance le vrai programme dans WSL pour comparer.</li>
            </ul>
            <table className="w-full text-[11px]">
              <tbody>
                {[
                  ["→ / ←", "étape suivante / précédente"],
                  ["Maj + → / ←", "événement suivant / précédent (fork, wait, exit, affichage…)"],
                  ["Espace", "lecture / pause"],
                  ["Début / Fin", "première / dernière étape"],
                  ["Clic sur un numéro de ligne", "point d'arrêt : la lecture s'y arrête"],
                  ["Clic sur la chronologie", "aller à cette étape"],
                ].map(([k, v]) => (
                  <tr key={k} className="border-t border-line/60">
                    <td className="py-1 pr-3 font-mono font-semibold whitespace-nowrap">{k}</td>
                    <td className="py-1 text-muted">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CodeEditorModal({
  initialCode,
  fileName: initialName,
  canSaveToFile,
  onClose,
  onApply,
}: {
  initialCode: string;
  fileName: string;
  canSaveToFile: boolean;
  onClose: () => void;
  onApply: (code: string, fileName: string, saveToFile: boolean) => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [fileName, setFileName] = useState(initialName);
  const [saveToFile, setSaveToFile] = useState(canSaveToFile);
  const [diag, setDiag] = useState(() => checkSource(initialCode));
  useEffect(() => {
    const t = setTimeout(() => setDiag(checkSource(code)), 250);
    return () => clearTimeout(t);
  }, [code]);

  const errLines = useMemo(() => new Map(diag.errors.map((e) => [e.line, e.message])), [diag]);
  const apply = () => onApply(code, fileName.trim() || "programme.c", saveToFile);

  return (
    <Modal
      title="Modifier le code C"
      onClose={onClose}
      width="max-w-4xl"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-[11px] text-muted">Ctrl+Entrée pour simuler · Ctrl+/ commente · Tab indente</span>
          <span className="flex items-center gap-2">
            {canSaveToFile && (
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
                <input type="checkbox" checked={saveToFile} onChange={(e) => setSaveToFile(e.target.checked)} className="accent-[var(--accent)]" />
                enregistrer aussi dans « Mes fichiers »
              </label>
            )}
            <Button size="sm" variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button size="sm" variant="primary" onClick={apply}>
              <Sparkles size={13} /> Simuler
            </Button>
          </span>
        </div>
      }
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted">
            Nom du fichier
            <input
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className="h-6 w-44 rounded border border-line bg-surface px-1.5 font-mono text-[11px] text-fg"
            />
          </label>
          <span className="text-[11px] text-muted">Modèles :</span>
          {SIM_EXAMPLES.slice(0, 6).map((ex) => (
            <button
              key={ex.id}
              type="button"
              onClick={() => setCode(ex.code)}
              className="rounded border border-line px-1.5 py-px text-[11px] text-fg hover:border-accent"
              title={ex.desc}
            >
              {ex.title}
            </button>
          ))}
        </div>
        <div className="h-[52vh] overflow-hidden rounded-[var(--radius-md)] border border-line">
          <CodeEditor value={code} onChange={setCode} language="c" fileName={fileName} errorLines={errLines} onSubmit={apply} autoFocus />
        </div>
        <div className="max-h-28 overflow-auto rounded border border-line px-2 py-1 text-[11px]">
          {diag.errors.length === 0 && diag.warnings.length === 0 && <p className="text-muted">✓ Aucune erreur détectée : le programme peut être simulé.</p>}
          {diag.errors.map((e, i) => (
            <p key={`e${i}`} className="flex items-start gap-1.5 text-fg">
              <CircleX size={12} className="mt-0.5 shrink-0 text-danger" />
              <span>
                <span className="font-mono font-semibold">l.{e.line}</span> {e.message}
              </span>
            </p>
          ))}
          {diag.warnings.map((w, i) => (
            <p key={`w${i}`} className="flex items-start gap-1.5 text-muted">
              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-status-warn" />
              <span>
                <span className="font-mono">l.{w.line}</span> {w.message}
              </span>
            </p>
          ))}
        </div>
      </div>
    </Modal>
  );
}
