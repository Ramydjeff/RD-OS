// Simulated UNIX kernel: process table, scheduler, fork/wait/exit, zombies,
// orphans adopted by init, sleep timers, pipes, file descriptors and signals.
// A forked child is rebuilt by replaying the parent's execution with the
// recorded system call results, so its memory is an exact copy.

import type { Program } from "./ast";
import { checkProgram } from "./checker";
import { scanInput } from "./format";
import {
  CRuntimeError,
  Interpreter,
  type BufferMode,
  type InterpOptions,
  type MemView,
  type SysCall,
  type SysResult,
  type YieldReq,
} from "./interpreter";
import { CError, normalizeSource } from "./lexer";
import { escapeText } from "./memory";
import { parseProgram } from "./parser";
import { ERRNO, SIG, defaultAction, shellSignalMessage, signalName } from "./signals";

export type ProcState = "READY" | "RUNNING" | "WAITING" | "SLEEPING" | "STOPPED" | "ZOMBIE" | "TERMINATED";
export type Policy = "parent" | "child" | "rr" | "random";

export interface SimOptions {
  policy: Policy;
  quantum: number;
  seed: number;
  buffer: BufferMode;
  stdin: string;
  maxSteps: number;
  maxProcs: number;
}

export const DEFAULT_OPTIONS: SimOptions = {
  policy: "parent",
  quantum: 3,
  seed: 7,
  buffer: "line",
  stdin: "",
  maxSteps: 5000,
  maxProcs: 40,
};

export const SHELL_PID = 2000;
export const ROOT_PID = 2001;
export const INIT_PID = 1;
const EPOCH = 1_760_000_000;

export interface ProcView {
  pid: number;
  ppid: number;
  /** PID of the process that called fork() (genealogy, never changes). */
  parent: number | null;
  label: string;
  short: string;
  color: number;
  depth: number;
  state: ProcState;
  line: number;
  func: string;
  stack: string[];
  blockedOn: string | null;
  exitCode: number | null;
  exitSignal: number | null;
  core: boolean;
  status: number | null;
  orphan: boolean;
  reapedBy: number | null;
  children: number[];
  bornStep: number;
  endStep: number | null;
  external: string | null;
  mem: MemView | null;
  fds: string[];
  cpu: number;
  buffer: string;
}

export interface OutChunk {
  pid: number;
  text: string;
  stream: "out" | "err" | "sys";
  step: number;
}

export type StepKind =
  | "start"
  | "stmt"
  | "fork"
  | "exit"
  | "wait"
  | "reap"
  | "block"
  | "wake"
  | "sleep"
  | "output"
  | "signal"
  | "exec"
  | "pipe"
  | "error"
  | "end";

export type StepMark =
  | { type: "fork"; from: number; to: number }
  | { type: "reap"; parent: number; child: number }
  | { type: "exit"; pid: number }
  | { type: "signal"; from: number; to: number; sig: number }
  | { type: "exec"; pid: number };

export interface SimStep {
  i: number;
  pid: number;
  line: number;
  src: string;
  kind: StepKind;
  title: string;
  text: string[];
  notes: string[];
  time: number;
  switchFrom: number | null;
  procs: ProcView[];
  out: OutChunk[];
  marks: StepMark[];
}

export interface SimWarning {
  message: string;
  line?: number;
  step?: number;
}

export interface SimStats {
  processes: number;
  forks: number;
  maxAlive: number;
  outputLines: number;
  duration: number;
  truncated: boolean;
  zombies: number;
  orphans: number;
  deadlocked: number;
}

export interface SimResult {
  ok: boolean;
  error: { message: string; line: number } | null;
  errors: { message: string; line: number }[];
  steps: SimStep[];
  output: OutChunk[];
  warnings: SimWarning[];
  stats: SimStats;
  code: string;
  fileName: string;
  options: SimOptions;
}

type FdEntry = { kind: "tty"; mode: "r" | "w" | "e" } | { kind: "pipe"; pipe: Pipe; end: "r" | "w" };

interface Pipe {
  id: number;
  buf: string;
  readers: number;
  writers: number;
}

type Blocked =
  | { type: "wait"; pid: number; options: number; fn: string }
  | { type: "read"; fd: number }
  | { type: "pause" }
  | { type: "sleep"; until: number; label: string }
  | { type: "system"; child: number; cmd: string };

interface External {
  argv: string[];
  phase: number;
  input: string;
}

interface KProc {
  pid: number;
  ppid: number;
  parent: number | null;
  label: string;
  short: string;
  color: number;
  depth: number;
  childCount: number;
  state: ProcState;
  prevState: ProcState | null;
  interp: Interpreter | null;
  gen: Generator<YieldReq, void, unknown> | null;
  pending: YieldReq | null;
  pendingIndex: number;
  resume: unknown;
  log: { at: number; v: unknown }[];
  blocked: Blocked | null;
  children: number[];
  exitCode: number | null;
  exitSignal: number | null;
  core: boolean;
  status: number | null;
  orphan: boolean;
  reapedBy: number | null;
  bornStep: number;
  endStep: number | null;
  zombieSince: number | null;
  fds: Map<number, FdEntry>;
  handlers: Map<number, string>;
  pendingSignals: number[];
  alarmAt: number | null;
  external: External | null;
  line: number;
  cpu: number;
  view: ProcView | null;
  mem: MemView | null;
  dirty: boolean;
  yieldToChild: boolean;
}

type SysOutcome = { type: "value"; value: SysResult } | { type: "block" } | { type: "gone" };
const BLOCK: SysOutcome = { type: "block" };
const GONE: SysOutcome = { type: "gone" };
const val = (value: SysResult): SysOutcome => ({ type: "value", value });

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatTime(ms: number): string {
  return `${(ms / 1000).toFixed(3)} s`;
}

const quote = (s: string, max = 60) => {
  const e = escapeText(s);
  return `« ${e.length > max ? e.slice(0, max) + "…" : e} »`;
};

const KIND_PRIORITY: Record<StepKind, number> = {
  start: 9,
  error: 9,
  end: 9,
  fork: 8,
  exec: 8,
  exit: 7,
  reap: 7,
  signal: 6,
  block: 6,
  sleep: 5,
  wake: 5,
  wait: 5,
  pipe: 3,
  output: 2,
  stmt: 0,
};

class Kernel {
  private readonly procs = new Map<number, KProc>();
  private readonly ready: number[] = [];
  readonly steps: SimStep[] = [];
  readonly output: OutChunk[] = [];
  readonly warnings: SimWarning[] = [];
  private readonly warnKeys = new Set<string>();
  private clock = 0;
  private nextPid = ROOT_PID;
  private nextPipeId = 1;
  private current: KProc | null = null;
  private lastRun: number | null = null;
  private switchReason = "";
  private quantumUsed = 0;
  private liveUnits = 0;
  private truncated = false;
  private aborted: { message: string; line: number } | null = null;
  private forks = 0;
  private maxAlive = 1;
  private stdinPos = 0;
  private readonly rng: () => number;
  private readonly interpOpts: InterpOptions;
  private readonly progName: string;

  constructor(
    private readonly prog: Program,
    private readonly opts: SimOptions,
    private readonly fileName: string,
  ) {
    this.rng = mulberry32(opts.seed);
    this.progName = "./" + (fileName.replace(/\.[^.]+$/, "").replace(/[^\w.-]/g, "_") || "a.out");
    this.interpOpts = { buffer: opts.buffer, progName: this.progName };
  }

  // ── helpers ───────────────────────────────────────────────────────────
  private warn(message: string, line?: number, step?: number) {
    const key = `${message}@${line ?? ""}`;
    if (this.warnKeys.has(key)) return;
    this.warnKeys.add(key);
    this.warnings.push({ message, line, step });
  }

  private alive(): KProc[] {
    return [...this.procs.values()].filter((p) => p.state !== "ZOMBIE" && p.state !== "TERMINATED");
  }

  private name(pid: number): string {
    if (pid === INIT_PID) return "init (1)";
    if (pid === SHELL_PID) return "bash (2000)";
    const p = this.procs.get(pid);
    return p ? `${p.short} (${pid})` : String(pid);
  }

  private setState(p: KProc, s: ProcState) {
    p.state = s;
    p.dirty = true;
  }

  private enqueue(p: KProc, front = false) {
    this.setState(p, "READY");
    const idx = this.ready.indexOf(p.pid);
    if (idx >= 0) this.ready.splice(idx, 1);
    if (front) this.ready.unshift(p.pid);
    else this.ready.push(p.pid);
  }

  private dequeue(p: KProc) {
    const idx = this.ready.indexOf(p.pid);
    if (idx >= 0) this.ready.splice(idx, 1);
  }

  private setKind(step: SimStep, kind: StepKind, title?: string) {
    if (KIND_PRIORITY[kind] >= KIND_PRIORITY[step.kind]) {
      step.kind = kind;
      if (title) step.title = title;
    } else if (title && !step.title) {
      step.title = title;
    }
  }

  private newStep(pid: number, line: number, src: string, kind: StepKind): SimStep {
    const step: SimStep = {
      i: this.steps.length,
      pid,
      line,
      src,
      kind,
      title: "",
      text: [],
      notes: [],
      time: this.clock,
      switchFrom: null,
      procs: [],
      out: [],
      marks: [],
    };
    this.steps.push(step);
    return step;
  }

  private snapshotProcs(): ProcView[] {
    const list: ProcView[] = [];
    for (const p of this.procs.values()) {
      if (p.dirty || !p.view) {
        p.view = this.buildView(p);
        p.dirty = false;
      }
      list.push(p.view);
    }
    return list;
  }

  private describeBlocked(p: KProc): string | null {
    const b = p.blocked;
    if (!b) return p.state === "STOPPED" ? "stoppé (SIGSTOP)" : null;
    switch (b.type) {
      case "wait":
        return b.pid > 0 ? `${b.fn}(${b.pid}) : attend ce fils` : `${b.fn}() : attend la fin d'un fils`;
      case "read":
        return `read(${b.fd}) : attend des données dans le tube`;
      case "pause":
        return "pause() : attend un signal";
      case "sleep":
        return `${b.label} : réveil à t = ${formatTime(b.until)}`;
      case "system":
        return `system("${b.cmd}") : attend la commande`;
    }
  }

  private describeFd(fd: number, e: FdEntry): string {
    if (e.kind === "tty") return `${fd} → terminal (${e.mode === "r" ? "stdin" : e.mode === "w" ? "stdout" : "stderr"})`;
    return `${fd} → tube #${e.pipe.id} (${e.end === "r" ? "lecture" : "écriture"})`;
  }

  private buildView(p: KProc): ProcView {
    return {
      pid: p.pid,
      ppid: p.ppid,
      parent: p.parent,
      label: p.label,
      short: p.short,
      color: p.color,
      depth: p.depth,
      state: p.state,
      line: p.line,
      func: p.external ? p.external.argv[0] ?? "?" : p.interp?.funcName() ?? "main",
      stack: p.interp?.callStack() ?? [],
      blockedOn: this.describeBlocked(p),
      exitCode: p.exitCode,
      exitSignal: p.exitSignal,
      core: p.core,
      status: p.status,
      orphan: p.orphan,
      reapedBy: p.reapedBy,
      children: [...p.children],
      bornStep: p.bornStep,
      endStep: p.endStep,
      external: p.external ? p.external.argv.join(" ") : null,
      mem: p.mem,
      fds: [...p.fds.entries()].sort((a, b) => a[0] - b[0]).map(([fd, e]) => this.describeFd(fd, e)),
      cpu: p.cpu,
      buffer: p.interp?.stdoutBuf ?? "",
    };
  }

  private exitDesc(p: KProc): string {
    if (p.exitSignal !== null) return `tué par ${signalName(p.exitSignal)}${p.core ? " (core dumped)" : ""}`;
    return `code de sortie ${p.exitCode ?? 0}`;
  }

  private emit(p: KProc, text: string, stream: OutChunk["stream"], step: SimStep) {
    if (!text) return;
    const chunk: OutChunk = { pid: p.pid, text, stream, step: step.i };
    this.output.push(chunk);
    step.out.push(chunk);
  }

  private lowestFreeFd(p: KProc, from = 0): number {
    let fd = from;
    while (p.fds.has(fd)) fd++;
    return fd;
  }

  private retain(e: FdEntry) {
    if (e.kind === "pipe") {
      if (e.end === "r") e.pipe.readers++;
      else e.pipe.writers++;
    }
  }

  private release(e: FdEntry) {
    if (e.kind !== "pipe") return;
    if (e.end === "r") e.pipe.readers--;
    else {
      e.pipe.writers--;
      if (e.pipe.writers === 0) this.wakePipeReaders(e.pipe);
    }
  }

  private pipeOf(p: KProc, fd: number): Pipe | null {
    const e = p.fds.get(fd);
    return e && e.kind === "pipe" ? e.pipe : null;
  }

  private wakePipeReaders(pipe: Pipe) {
    for (const q of this.procs.values()) {
      if (q.state !== "WAITING" || q.blocked?.type !== "read") continue;
      if (this.pipeOf(q, q.blocked.fd) === pipe) {
        q.blocked = null;
        q.resume = undefined;
        this.enqueue(q);
      }
    }
  }

  private writersOf(pipe: Pipe): string[] {
    const list: string[] = [];
    for (const q of this.procs.values()) {
      if (q.state === "ZOMBIE" || q.state === "TERMINATED") continue;
      for (const [fd, e] of q.fds) if (e.kind === "pipe" && e.pipe === pipe && e.end === "w") list.push(`${q.short} (fd ${fd})`);
    }
    return list;
  }

  // ── process creation ──────────────────────────────────────────────────
  private baseProc(pid: number, ppid: number, parent: KProc | null): KProc {
    let label = "Père";
    let short = "P";
    let depth = 0;
    if (parent) {
      parent.childCount++;
      const n = parent.childCount;
      label = parent.parent === null ? `Fils ${n}` : `${parent.label}.${n}`;
      short = parent.parent === null ? `F${n}` : `${parent.short}.${n}`;
      depth = parent.depth + 1;
    }
    const fds = new Map<number, FdEntry>();
    if (parent) {
      for (const [fd, e] of parent.fds) {
        const copy: FdEntry = e.kind === "pipe" ? { kind: "pipe", pipe: e.pipe, end: e.end } : { ...e };
        this.retain(copy);
        fds.set(fd, copy);
      }
    } else {
      fds.set(0, { kind: "tty", mode: "r" });
      fds.set(1, { kind: "tty", mode: "w" });
      fds.set(2, { kind: "tty", mode: "e" });
    }
    return {
      pid,
      ppid,
      parent: parent ? parent.pid : null,
      label,
      short,
      color: this.procs.size,
      depth,
      childCount: 0,
      state: "READY",
      prevState: null,
      interp: null,
      gen: null,
      pending: null,
      pendingIndex: -1,
      resume: undefined,
      log: [],
      blocked: null,
      children: [],
      exitCode: null,
      exitSignal: null,
      core: false,
      status: null,
      orphan: false,
      reapedBy: null,
      bornStep: this.steps.length,
      endStep: null,
      zombieSince: null,
      fds,
      handlers: parent ? new Map(parent.handlers) : new Map(),
      pendingSignals: [],
      alarmAt: null,
      external: null,
      line: parent ? parent.line : 1,
      cpu: 0,
      view: null,
      mem: null,
      dirty: true,
      yieldToChild: false,
    };
  }

  private spawnChild(parent: KProc, step: SimStep): KProc {
    const pid = this.nextPid++;
    const child = this.baseProc(pid, parent.pid, parent);
    child.bornStep = step.i;
    const interp = new Interpreter(this.prog, this.interpOpts);
    interp.silent = true;
    const gen = interp.run();
    const forkIndex = parent.pendingIndex;
    const log = parent.log;
    let li = 0;
    let r = gen.next();
    let idx = 0;
    while (idx < forkIndex) {
      if (r.done) throw new Error("rejeu interrompu");
      let v: unknown;
      const e = log[li];
      if (e && e.at === idx) {
        v = e.v;
        li++;
      }
      r = gen.next(v);
      idx++;
    }
    if (r.done || r.value.kind !== "sys" || r.value.call.name !== "fork") {
      throw new Error("Rejeu du fork() désynchronisé (erreur interne du simulateur)");
    }
    interp.silent = false;
    interp.takeNotes();
    interp.takeWarnings();
    interp.snapshot();
    child.interp = interp;
    child.gen = gen;
    child.pending = r.value;
    child.pendingIndex = idx;
    child.resume = { ret: 0 } satisfies SysResult;
    child.log = log.slice(0, li);
    child.line = r.value.line;
    child.mem = interp.snapshot();
    this.procs.set(pid, child);
    this.maxAlive = Math.max(this.maxAlive, this.alive().length);
    return child;
  }

  // ── termination ───────────────────────────────────────────────────────
  private reap(parent: KProc, child: KProc, step: SimStep) {
    this.setState(child, "TERMINATED");
    child.reapedBy = parent.pid;
    step.marks.push({ type: "reap", parent: parent.pid, child: child.pid });
  }

  private terminate(p: KProc, how: { code?: number; signal?: number; core?: boolean }, step: SimStep) {
    if (p.state === "ZOMBIE" || p.state === "TERMINATED") return;
    const wasCurrent = this.current === p;
    if (how.signal) {
      p.exitSignal = how.signal;
      p.core = !!how.core;
      p.status = how.signal | (how.core ? 0x80 : 0);
    } else {
      p.exitCode = (how.code ?? 0) & 0xff;
      p.status = p.exitCode << 8;
    }
    if (p.interp) p.mem = p.interp.snapshot();
    p.gen = null;
    p.blocked = null;
    p.endStep = step.i;
    p.alarmAt = null;
    this.dequeue(p);
    for (const e of p.fds.values()) this.release(e);
    p.fds.clear();
    step.marks.push({ type: "exit", pid: p.pid });

    const orphans: KProc[] = [];
    for (const c of this.procs.values()) {
      if (c.ppid !== p.pid || c.state === "TERMINATED") continue;
      c.ppid = INIT_PID;
      c.orphan = true;
      c.dirty = true;
      orphans.push(c);
      if (c.state === "ZOMBIE") {
        this.setState(c, "TERMINATED");
        c.reapedBy = INIT_PID;
      }
    }
    if (orphans.length) {
      const zombies = orphans.filter((c) => c.reapedBy === INIT_PID);
      step.text.push(
        `${orphans.map((c) => c.short).join(", ")} ${orphans.length > 1 ? "deviennent orphelins et sont adoptés" : "devient orphelin et est adopté"} par init (PID 1) : getppid() renverra désormais 1${zombies.length ? ` ; init récupère aussitôt ${zombies.map((c) => c.short).join(", ")} (zombie)` : ""}.`,
      );
    }

    if (p.ppid === SHELL_PID) {
      this.setState(p, "TERMINATED");
      p.reapedBy = SHELL_PID;
      step.text.push(
        `Le shell bash (PID 2000), père de ${p.short}, récupère son statut : $? = ${p.exitSignal !== null ? 128 + p.exitSignal : p.exitCode}.`,
      );
      if (p.exitSignal !== null) {
        const msg = shellSignalMessage(p.exitSignal, p.core);
        if (msg) this.emit(p, msg + "\n", "sys", step);
      }
      const others = this.alive().filter((q) => q !== p);
      if (others.length) {
        step.text.push(
          `${others.map((q) => q.short).join(", ")} ${others.length > 1 ? "tournent" : "tourne"} encore : le shell réaffiche son invite « $ » et leurs sorties apparaîtront APRÈS elle.`,
        );
        this.emit(p, "$ ", "sys", step);
      }
    } else if (p.ppid === INIT_PID) {
      this.setState(p, "TERMINATED");
      p.reapedBy = INIT_PID;
      step.text.push(`${p.short} est orphelin : init (PID 1) le récupère immédiatement, il ne reste pas zombie.`);
    } else {
      this.setState(p, "ZOMBIE");
      p.zombieSince = step.i;
      const parent = this.procs.get(p.ppid);
      if (parent) {
        if (parent.blocked?.type === "system" && parent.blocked.child === p.pid) {
          this.reap(parent, p, step);
          parent.blocked = null;
          parent.resume = { ret: 0, status: p.status ?? 0 } satisfies SysResult;
          this.enqueue(parent);
          step.text.push(`La commande est terminée : system() dans ${parent.short} récupère son statut et ${parent.short} redevient prêt.`);
        } else {
          step.text.push(
            `${p.short} devient ZOMBIE : il est terminé, mais son entrée reste dans la table des processus tant que son père ${parent.short} n'a pas appelé wait().`,
          );
          if (
            parent.state === "WAITING" &&
            parent.blocked?.type === "wait" &&
            (parent.blocked.pid <= 0 || parent.blocked.pid === p.pid)
          ) {
            parent.blocked = null;
            parent.resume = undefined;
            this.enqueue(parent);
            step.text.push(`${parent.short} était bloqué dans wait() : il est réveillé (état PRÊT) et récupérera ${p.short} dès qu'il aura le processeur.`);
          }
          const h = parent.handlers.get(SIG.SIGCHLD);
          if (h && h !== "IGN") this.deliverSignal(parent, SIG.SIGCHLD, p, step, true);
        }
      }
    }
    p.dirty = true;
    if (wasCurrent) this.switchReason = `${p.short} est terminé`;
  }

  private crash(p: KProc, err: unknown, step: SimStep) {
    this.setKind(step, "error");
    if (err instanceof CRuntimeError) {
      step.line = err.line;
      step.title = `${p.short} : ${signalName(err.signal)}`;
      step.text.push(`Erreur à l'exécution ligne ${err.line} : ${err.message}. Le noyau envoie ${signalName(err.signal)} à ${p.short}, qui est tué.`);
      this.warn(`${p.short} (PID ${p.pid}) tué par ${signalName(err.signal)} : ${err.message}`, err.line, step.i);
      this.terminate(p, { signal: err.signal, core: true }, step);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    const line = err instanceof CError ? err.line : step.line;
    step.line = line;
    step.title = "Erreur : simulation arrêtée";
    step.text.push(`Ligne ${line} : ${message}`);
    this.aborted = { message, line };
    this.terminate(p, { signal: SIG.SIGABRT }, step);
  }

  // ── signals ───────────────────────────────────────────────────────────
  /** Returns "self" when the current process must run its own handler right after the system call. */
  private deliverSignal(target: KProc, sig: number, from: KProc, step: SimStep, quiet = false): "dead" | "self" | "done" {
    const name = signalName(sig);
    if (target.state === "ZOMBIE" || target.state === "TERMINATED") {
      if (!quiet) step.text.push(`${name} envoyé à ${target.short} : aucun effet, il est déjà terminé.`);
      return "done";
    }
    step.marks.push({ type: "signal", from: from.pid, to: target.pid, sig });
    if (!quiet) this.setKind(step, "signal", `${name} : ${from.short} → ${target.short}`);
    const h = sig === SIG.SIGKILL || sig === SIG.SIGSTOP ? undefined : target.handlers.get(sig);
    if (h === "IGN") {
      if (!quiet) step.text.push(`${target.short} ignore ${name} (SIG_IGN).`);
      return "done";
    }
    if (!h) {
      const act = defaultAction(sig);
      if (act === "term" || act === "core") {
        step.text.push(`${name} reçu par ${target.short} sans gestionnaire : action par défaut, le processus est tué${act === "core" ? " (core dumped)" : ""}.`);
        this.terminate(target, { signal: sig, core: act === "core" }, step);
        return "dead";
      }
      if (act === "stop") {
        target.prevState = target.state;
        this.dequeue(target);
        this.setState(target, "STOPPED");
        step.text.push(`${name} : ${target.short} est suspendu (STOPPED) jusqu'à SIGCONT.`);
        if (target === this.current) this.switchReason = `${target.short} suspendu`;
        return "done";
      }
      if (act === "cont") {
        if (target.state === "STOPPED") {
          const prev = target.prevState ?? "READY";
          if (prev === "WAITING" || prev === "SLEEPING") this.setState(target, prev);
          else this.enqueue(target);
          step.text.push(`SIGCONT : ${target.short} reprend son exécution.`);
        }
        return "done";
      }
      if (!quiet) step.text.push(`${name} est ignoré par défaut par ${target.short}.`);
      return "done";
    }
    // User handler.
    const delivery = { sig, handler: h };
    if ((target.state === "WAITING" || target.state === "SLEEPING") && target.blocked && target.blocked.type !== "system") {
      const b = target.blocked;
      const remaining = b.type === "sleep" ? Math.max(0, Math.ceil((b.until - this.clock) / 1000)) : -1;
      target.resume = { ret: remaining, errno: b.type === "sleep" ? undefined : ERRNO.EINTR, signal: delivery } satisfies SysResult;
      target.blocked = null;
      this.enqueue(target);
      step.text.push(`${target.short} est interrompu (${b.type === "sleep" ? "sleep" : b.type + "()"}) par ${name} : il exécutera ${h}(), puis l'appel bloquant renverra ${remaining}.`);
      return "done";
    }
    if (target === from && target === this.current) {
      step.text.push(`${target.short} exécute aussitôt son gestionnaire ${h}() pour ${name}.`);
      return "self";
    }
    target.pendingSignals.push(sig);
    target.dirty = true;
    step.text.push(`${name} est mis en attente : ${target.short} exécutera ${h}() dès qu'il reprendra le processeur.`);
    return "done";
  }

  // ── system calls ──────────────────────────────────────────────────────
  private syscall(p: KProc, call: SysCall, step: SimStep): SysOutcome {
    switch (call.name) {
      case "getpid":
        return val({ ret: p.pid });
      case "getppid":
        return val({ ret: p.ppid });
      case "getpgrp":
        return val({ ret: ROOT_PID });
      case "isatty": {
        const e = p.fds.get(call.fd);
        return val({ ret: e?.kind === "tty" ? 1 : 0 });
      }
      case "time":
        return val({ ret: EPOCH + Math.floor(this.clock / 1000) });
      case "clock":
        return val({ ret: p.cpu * 1000 });
      case "fork":
        return this.sysFork(p, step);
      case "wait":
        return this.sysWait(p, call, step);
      case "exit": {
        const how = call.how;
        const verb = how === "return" ? `return ${call.code}` : `${how}(${call.code})`;
        this.setKind(step, "exit", `${verb} : ${p.short} se termine`);
        step.text.push(
          how === "return"
            ? `main() se termine (return ${call.code}) : c'est équivalent à exit(${call.code}).`
            : `${how}(${call.code}) termine ${p.short} immédiatement${how === "_exit" ? ", sans vider les tampons stdio" : ""} : le code C qui suit n'est jamais exécuté.`,
        );
        if ((call.code & 0xff) !== call.code) {
          step.text.push(`Seuls les 8 bits de poids faible sont gardés : le code de sortie vaut ${call.code & 0xff}.`);
        }
        if (call.lost) {
          step.text.push(`Le tampon stdout ${quote(call.lost)} est perdu : il ne sera jamais affiché.`);
          this.warn(`_exit() a perdu le texte ${quote(call.lost)} resté dans le tampon de stdout`, step.line, step.i);
        }
        this.terminate(p, { code: call.code }, step);
        return GONE;
      }
      case "sleep": {
        if (call.ms <= 0) return val({ ret: 0 });
        const until = this.clock + call.ms;
        p.blocked = { type: "sleep", until, label: call.label };
        this.setState(p, "SLEEPING");
        this.setKind(step, "sleep", `${call.label} : ${p.short} s'endort`);
        step.text.push(
          `${p.short} s'endort ${(call.ms / 1000).toLocaleString("fr-FR")} s (état ENDORMI) : il ne consomme plus le processeur jusqu'à t = ${formatTime(until)}.`,
        );
        this.switchReason = `${p.short} s'est endormi`;
        return BLOCK;
      }
      case "write":
        return this.sysWrite(p, call.fd, call.data, call.via, step);
      case "read":
        return this.sysRead(p, call.fd, call.max, step);
      case "pipe": {
        const r = this.lowestFreeFd(p);
        const pipe: Pipe = { id: this.nextPipeId++, buf: "", readers: 1, writers: 1 };
        p.fds.set(r, { kind: "pipe", pipe, end: "r" });
        const w = this.lowestFreeFd(p);
        p.fds.set(w, { kind: "pipe", pipe, end: "w" });
        p.dirty = true;
        this.setKind(step, "pipe", `pipe() : tube #${pipe.id} créé`);
        step.text.push(`pipe() crée le tube #${pipe.id} dans le noyau : fd[0] = ${r} pour lire, fd[1] = ${w} pour écrire. Après un fork(), le fils hérite des deux extrémités.`);
        return val({ ret: 0, fds: [r, w] });
      }
      case "close": {
        const e = p.fds.get(call.fd);
        if (!e) {
          step.text.push(`close(${call.fd}) : descripteur déjà fermé ou invalide, renvoie -1 (EBADF).`);
          return val({ ret: -1, errno: ERRNO.EBADF });
        }
        p.fds.delete(call.fd);
        p.dirty = true;
        this.release(e);
        if (e.kind === "pipe") {
          this.setKind(step, "pipe");
          step.text.push(
            `${p.short} ferme fd ${call.fd} (${e.end === "r" ? "lecture" : "écriture"} du tube #${e.pipe.id})${e.end === "w" && e.pipe.writers === 0 ? " : plus aucun écrivain, les lecteurs recevront la fin de fichier (read() = 0)" : ""}.`,
          );
        }
        return val({ ret: 0 });
      }
      case "dup": {
        const e = p.fds.get(call.fd);
        if (!e) return val({ ret: -1, errno: ERRNO.EBADF });
        const nfd = this.lowestFreeFd(p);
        const copy: FdEntry = e.kind === "pipe" ? { kind: "pipe", pipe: e.pipe, end: e.end } : { ...e };
        this.retain(copy);
        p.fds.set(nfd, copy);
        p.dirty = true;
        step.text.push(`dup(${call.fd}) : le descripteur ${nfd} désigne la même chose que ${call.fd}.`);
        return val({ ret: nfd });
      }
      case "dup2": {
        const e = p.fds.get(call.fd);
        if (!e) return val({ ret: -1, errno: ERRNO.EBADF });
        if (call.fd === call.fd2) return val({ ret: call.fd2 });
        const old = p.fds.get(call.fd2);
        if (old) this.release(old);
        const copy: FdEntry = e.kind === "pipe" ? { kind: "pipe", pipe: e.pipe, end: e.end } : { ...e };
        this.retain(copy);
        p.fds.set(call.fd2, copy);
        p.dirty = true;
        this.setKind(step, "pipe", `dup2(${call.fd}, ${call.fd2}) : redirection`);
        const what = call.fd2 === 0 ? "l'entrée standard" : call.fd2 === 1 ? "la sortie standard" : call.fd2 === 2 ? "la sortie d'erreur" : `le descripteur ${call.fd2}`;
        step.text.push(`dup2(${call.fd}, ${call.fd2}) : ${what} de ${p.short} est redirigée vers ${this.describeFd(call.fd, e).replace(/^\d+ → /, "")}.`);
        return val({ ret: call.fd2 });
      }
      case "kill": {
        const targets =
          call.pid > 0
            ? [this.procs.get(call.pid)].filter((x): x is KProc => !!x && x.state !== "TERMINATED")
            : this.alive().filter((q) => call.pid !== -1 || q !== p);
        if (targets.length === 0) {
          step.text.push(`kill(${call.pid}, ${signalName(call.sig)}) : aucun processus de PID ${call.pid}, renvoie -1 (ESRCH).`);
          return val({ ret: -1, errno: ERRNO.ESRCH });
        }
        if (call.sig === 0) return val({ ret: 0 });
        let self: "dead" | "self" | "done" = "done";
        for (const t of targets) {
          const r = this.deliverSignal(t, call.sig, p, step);
          if (t === p) self = r;
        }
        if (self === "dead") return GONE;
        if (self === "self") return val({ ret: 0, signal: { sig: call.sig, handler: p.handlers.get(call.sig)! } });
        return val({ ret: 0 });
      }
      case "raise": {
        const r = this.deliverSignal(p, call.sig, p, step);
        if (r === "dead") return GONE;
        if (r === "self") return val({ ret: 0, signal: { sig: call.sig, handler: p.handlers.get(call.sig)! } });
        return val({ ret: 0 });
      }
      case "signal": {
        if (call.sig === SIG.SIGKILL || call.sig === SIG.SIGSTOP) {
          step.text.push(`${signalName(call.sig)} ne peut être ni capturé ni ignoré : signal() renvoie SIG_ERR.`);
          return val({ ret: -1, errno: ERRNO.EINVAL });
        }
        const prev = p.handlers.get(call.sig);
        if (call.handler === "DFL") p.handlers.delete(call.sig);
        else p.handlers.set(call.sig, call.handler);
        p.dirty = true;
        step.text.push(
          call.handler === "DFL"
            ? `${p.short} rétablit l'action par défaut pour ${signalName(call.sig)}.`
            : call.handler === "IGN"
              ? `${p.short} ignorera désormais ${signalName(call.sig)}.`
              : `${p.short} installe le gestionnaire ${call.handler}() pour ${signalName(call.sig)} (hérité par les futurs fils).`,
        );
        return val({ ret: prev === "IGN" ? 1 : 0 });
      }
      case "pause":
        p.blocked = { type: "pause" };
        this.setState(p, "WAITING");
        this.setKind(step, "block", `pause() : ${p.short} attend un signal`);
        step.text.push(`${p.short} se bloque dans pause() jusqu'à l'arrivée d'un signal.`);
        this.switchReason = `${p.short} bloqué dans pause()`;
        return BLOCK;
      case "alarm": {
        const prev = p.alarmAt !== null ? Math.max(0, Math.ceil((p.alarmAt - this.clock) / 1000)) : 0;
        p.alarmAt = call.sec > 0 ? this.clock + call.sec * 1000 : null;
        if (call.sec > 0) step.text.push(`alarm(${call.sec}) : le noyau enverra SIGALRM à ${p.short} à t = ${formatTime(p.alarmAt!)}.`);
        return val({ ret: prev });
      }
      case "exec": {
        const cmd = call.argv.join(" ");
        this.setKind(step, "exec", `${call.fn}() : ${p.short} devient « ${cmd} »`);
        step.text.push(
          `${call.fn}("${call.path}", …) remplace le code et les données de ${p.short} par le programme ${call.path} : même PID ${p.pid}, mêmes descripteurs ouverts, mais les instructions C qui suivent ne seront jamais exécutées.`,
        );
        if (call.lost) {
          step.text.push(`Le tampon stdout ${quote(call.lost)} n'avait pas été vidé : exec le détruit, il ne s'affichera jamais.`);
          this.warn(`exec() a détruit le texte ${quote(call.lost)} resté dans le tampon de stdout (ajoutez fflush(stdout) avant exec)`, step.line, step.i);
        }
        if (p.interp) {
          step.notes.push(...p.interp.takeNotes());
          for (const w of p.interp.takeWarnings()) this.warn(w.message, w.line, step.i);
        }
        p.mem = null;
        p.interp = null;
        p.gen = null;
        p.pending = null;
        p.external = { argv: call.argv, phase: 0, input: "" };
        for (const [sig, h] of [...p.handlers]) if (h !== "IGN") p.handlers.delete(sig);
        p.dirty = true;
        step.marks.push({ type: "exec", pid: p.pid });
        return GONE;
      }
      case "system": {
        if (this.alive().length >= this.opts.maxProcs) return val({ ret: -1, errno: ERRNO.EAGAIN });
        const pid = this.nextPid++;
        const child = this.baseProc(pid, p.pid, p);
        child.external = { argv: ["sh", "-c", call.cmd], phase: 0, input: "" };
        child.line = step.line;
        this.procs.set(pid, child);
        p.children.push(pid);
        this.forks++;
        this.maxAlive = Math.max(this.maxAlive, this.alive().length);
        p.blocked = { type: "system", child: pid, cmd: call.cmd };
        this.setState(p, "WAITING");
        this.enqueue(child);
        step.marks.push({ type: "fork", from: p.pid, to: pid });
        this.setKind(step, "fork", `system("${call.cmd}") : ${p.short} crée ${child.short}`);
        step.text.push(
          `system() fait un fork() : ${child.short} (PID ${pid}) exécute /bin/sh -c "${call.cmd}" pendant que ${p.short} l'attend (waitpid). Attention : system() ne vide pas le tampon de stdout.`,
        );
        this.switchReason = `${p.short} attend la fin de system()`;
        return BLOCK;
      }
      case "stdin":
        return this.sysStdin(p, call, step);
    }
  }

  private sysFork(p: KProc, step: SimStep): SysOutcome {
    if (this.alive().length >= this.opts.maxProcs) {
      this.warn(`Limite de ${this.opts.maxProcs} processus simultanés atteinte : fork() échoue et renvoie -1 (EAGAIN). Une « fork bomb » ?`, step.line, step.i);
      step.text.push(`fork() échoue : la limite de ${this.opts.maxProcs} processus est atteinte (EAGAIN), il renvoie -1.`);
      return val({ ret: -1, errno: ERRNO.EAGAIN });
    }
    const child = this.spawnChild(p, step);
    p.children.push(child.pid);
    p.dirty = true;
    this.forks++;
    this.setKind(step, "fork", `fork() : ${p.short} crée ${child.short} (PID ${child.pid})`);
    step.text.push(
      `fork() duplique ${p.short} (PID ${p.pid}) : le nouveau processus ${child.short} (PID ${child.pid}) reçoit une COPIE de toute la mémoire (variables, pile, tas, tampon stdout), les mêmes descripteurs ouverts et la même position dans le code.`,
    );
    step.text.push(`fork() renvoie ${child.pid} dans le père et 0 dans le fils ; les deux processus continuent juste après l'appel, indépendamment.`);
    const buf = p.interp?.stdoutBuf ?? "";
    if (buf) {
      step.text.push(`⚠ Le tampon de stdout contient encore ${quote(buf)} : il est copié dans le fils, ce texte sera donc affiché DEUX fois.`);
      this.warn(
        `Ligne ${step.line} : ${quote(buf)} était encore dans le tampon de stdout au moment du fork() : il sera affiché par le père ET par le fils (ajoutez \\n ou fflush(stdout) avant fork()).`,
        step.line,
        step.i,
      );
    }
    step.marks.push({ type: "fork", from: p.pid, to: child.pid });
    if (this.opts.policy === "child") {
      this.enqueue(child, true);
      p.yieldToChild = true;
    } else {
      this.enqueue(child);
    }
    return val({ ret: child.pid });
  }

  private sysWait(p: KProc, call: Extract<SysCall, { name: "wait" }>, step: SimStep): SysOutcome {
    const mine = p.children
      .map((pid) => this.procs.get(pid))
      .filter((c): c is KProc => !!c && c.ppid === p.pid && c.state !== "TERMINATED");
    const cands = call.pid > 0 ? mine.filter((c) => c.pid === call.pid) : mine;
    const label = call.pid > 0 ? `${call.fn}(${call.pid})` : `${call.fn}()`;
    if (cands.length === 0) {
      this.setKind(step, "wait", `${label} → -1 : aucun fils`);
      step.text.push(
        call.pid > 0
          ? `${label} : ${call.pid} n'est pas (ou plus) un fils de ${p.short}, l'appel renvoie -1 immédiatement (ECHILD).`
          : `${p.short} n'a plus aucun fils à attendre (ni vivant ni zombie) : ${label} renvoie -1 immédiatement (errno = ECHILD).`,
      );
      return val({ ret: -1, errno: ERRNO.ECHILD });
    }
    const z = cands.find((c) => c.state === "ZOMBIE");
    if (z) {
      this.reap(p, z, step);
      this.setKind(step, "reap", `${label} récupère ${z.short} (PID ${z.pid})`);
      step.text.push(
        `${p.short} récupère le zombie ${z.short} (PID ${z.pid}, ${this.exitDesc(z)}) : ${label} renvoie ${z.pid} et l'entrée de ${z.short} est enfin retirée de la table des processus.`,
      );
      return val({ ret: z.pid, status: z.status ?? 0 });
    }
    if (call.options & 1) {
      this.setKind(step, "wait", `${label} WNOHANG → 0`);
      step.text.push(`WNOHANG : aucun fils n'est encore terminé, ${label} renvoie 0 sans bloquer ${p.short}.`);
      return val({ ret: 0 });
    }
    p.blocked = { type: "wait", pid: call.pid, options: call.options, fn: call.fn };
    this.setState(p, "WAITING");
    this.setKind(step, "block", `${label} : ${p.short} se bloque`);
    step.text.push(
      `Aucun fils de ${p.short} n'est encore terminé (${cands.map((c) => c.short).join(", ")} en cours) : ${p.short} passe à l'état BLOQUÉ et libère le processeur jusqu'à la fin d'un fils.`,
    );
    this.switchReason = `${p.short} est bloqué dans ${call.fn}()`;
    return BLOCK;
  }

  private sysWrite(p: KProc, fd: number, data: string, via: string, step: SimStep): SysOutcome {
    const e = p.fds.get(fd);
    if (!e || (e.kind === "tty" && e.mode === "r") || (e.kind === "pipe" && e.end === "r")) {
      step.text.push(`write sur le descripteur ${fd} ${e ? "ouvert en lecture seule" : "fermé"} : échec, renvoie -1 (EBADF).`);
      this.warn(`${p.short} écrit sur le descripteur ${fd} ${e ? "ouvert en lecture" : "fermé"} : la donnée ${quote(data, 30)} est perdue`, step.line, step.i);
      return val({ ret: -1, errno: ERRNO.EBADF });
    }
    if (e.kind === "tty") {
      this.emit(p, data, e.mode === "e" ? "err" : "out", step);
      const shown = quote(data.replace(/\n$/, ""));
      this.setKind(step, "output", `${p.short} affiche ${shown}`);
      if (via === "flush") step.text.push(`Le contenu du tampon est écrit sur le terminal : ${shown} apparaît à l'écran.`);
      else if (via === "write") step.text.push(`write(${fd}, …) écrit ${shown} directement sur le terminal, sans passer par le tampon de stdio.`);
      else if (e.mode === "e") step.text.push(`${via}() écrit ${shown} sur stderr, qui n'est pas bufferisé : affichage immédiat.`);
      else step.text.push(`${via}() : ${this.interpBuffered(p) ? "le \\n vide le tampon de la ligne" : "sortie non bufferisée"} → ${shown} s'affiche.`);
      return val({ ret: data.length });
    }
    const pipe = e.pipe;
    if (pipe.readers === 0) {
      this.setKind(step, "signal", `${p.short} : SIGPIPE`);
      step.text.push(`Écriture dans le tube #${pipe.id} alors que plus personne ne peut le lire : le noyau envoie SIGPIPE.`);
      const r = this.deliverSignal(p, SIG.SIGPIPE, p, step);
      if (r === "dead") return GONE;
      return val({ ret: -1, errno: ERRNO.EPIPE });
    }
    pipe.buf += data;
    this.setKind(step, "pipe", `${p.short} écrit dans le tube #${pipe.id}`);
    step.text.push(`${p.short} écrit ${quote(data)} dans le tube #${pipe.id} (${pipe.buf.length} octet(s) en attente de lecture).`);
    this.wakePipeReaders(pipe);
    return val({ ret: data.length });
  }

  private interpBuffered(p: KProc): boolean {
    return (p.interp?.bufMode ?? "line") !== "none";
  }

  private sysRead(p: KProc, fd: number, max: number, step: SimStep): SysOutcome {
    const e = p.fds.get(fd);
    if (!e || (e.kind === "tty" && e.mode !== "r") || (e.kind === "pipe" && e.end !== "r")) {
      step.text.push(`read sur le descripteur ${fd} ${e ? "ouvert en écriture" : "fermé"} : renvoie -1 (EBADF).`);
      return val({ ret: -1, errno: ERRNO.EBADF });
    }
    if (e.kind === "tty") {
      const rest = this.opts.stdin.slice(this.stdinPos);
      const nl = rest.indexOf("\n");
      const data = rest.slice(0, Math.min(max, nl >= 0 ? nl + 1 : rest.length));
      this.stdinPos += data.length;
      step.text.push(data ? `read(0) lit ${quote(data)} au clavier (entrée simulée).` : "read(0) : l'entrée standard est vide, renvoie 0 (fin de fichier).");
      return val({ ret: data.length, data });
    }
    const pipe = e.pipe;
    if (pipe.buf.length > 0) {
      const data = pipe.buf.slice(0, max);
      pipe.buf = pipe.buf.slice(data.length);
      this.setKind(step, "pipe", `${p.short} lit dans le tube #${pipe.id}`);
      step.text.push(`read() retire ${quote(data)} du tube #${pipe.id}${pipe.buf ? ` (il reste ${pipe.buf.length} octet(s))` : ""}.`);
      return val({ ret: data.length, data });
    }
    if (pipe.writers === 0) {
      this.setKind(step, "pipe", `read() = 0 : fin du tube #${pipe.id}`);
      step.text.push(`Le tube #${pipe.id} est vide et plus aucune extrémité d'écriture n'est ouverte : read() renvoie 0 (fin de fichier).`);
      return val({ ret: 0, data: "" });
    }
    p.blocked = { type: "read", fd };
    this.setState(p, "WAITING");
    this.setKind(step, "block", `read() : ${p.short} attend le tube #${pipe.id}`);
    step.text.push(
      `Le tube #${pipe.id} est vide mais l'écriture y est encore possible (ouverte par ${this.writersOf(pipe).join(", ")}) : ${p.short} se bloque dans read().`,
    );
    this.switchReason = `${p.short} attend des données dans le tube`;
    return BLOCK;
  }

  private sysStdin(p: KProc, call: Extract<SysCall, { name: "stdin" }>, step: SimStep): SysOutcome {
    const e = p.fds.get(0);
    let text: string;
    let consume: (n: number) => void;
    if (e?.kind === "pipe" && e.end === "r") {
      const pipe = e.pipe;
      if (!pipe.buf && pipe.writers > 0) {
        p.blocked = { type: "read", fd: 0 };
        this.setState(p, "WAITING");
        this.setKind(step, "block", `${p.short} attend des données sur stdin (tube #${pipe.id})`);
        step.text.push(`L'entrée standard de ${p.short} est le tube #${pipe.id}, encore vide : la lecture se bloque.`);
        this.switchReason = `${p.short} attend des données`;
        return BLOCK;
      }
      text = pipe.buf;
      consume = (n) => {
        pipe.buf = pipe.buf.slice(n);
      };
    } else {
      text = this.opts.stdin.slice(this.stdinPos);
      consume = (n) => {
        this.stdinPos += n;
      };
    }
    if (call.op === "getchar") {
      if (!text) return val({ ret: -1 });
      consume(1);
      return val({ ret: text.charCodeAt(0) & 0xff });
    }
    if (call.op === "fgets") {
      if (!text) {
        step.text.push("fgets() : plus rien à lire sur l'entrée standard, renvoie NULL.");
        return val({ ret: 0, data: null });
      }
      const nl = text.indexOf("\n");
      const data = text.slice(0, Math.min(call.max - 1, nl >= 0 ? nl + 1 : text.length));
      consume(data.length);
      step.text.push(`fgets() lit ${quote(data)} sur l'entrée standard.`);
      return val({ ret: 1, data });
    }
    const r = scanInput(call.fmt, text, 0);
    consume(r.pos);
    step.text.push(
      r.count < 0
        ? "scanf() : l'entrée standard est vide (saisissez des données dans « Entrée stdin »), renvoie EOF (-1)."
        : `scanf() lit ${r.count} valeur(s) : ${r.values.map((v) => (typeof v.value === "string" ? `"${v.value}"` : v.value)).join(", ") || "aucune"}.`,
    );
    if (r.count < 0) this.warn("scanf() n'a rien pu lire : renseignez l'entrée standard simulée (champ « Entrée stdin »)", step.line, step.i);
    return val({ ret: r.count, values: r.values });
  }

  // ── external programs (after exec / system) ───────────────────────────
  private runExternal(p: KProc, step: SimStep) {
    const ext = p.external!;
    let argv = ext.argv;
    if (argv[0] === "sh" && argv[1] === "-c") argv = (argv[2] ?? "").trim().split(/\s+/).filter(Boolean);
    const cmd = (argv[0] ?? "").split("/").pop() ?? "";
    const args = argv.slice(1);
    step.kind = "exec";
    step.src = ext.argv.join(" ");
    step.title = `${p.short} exécute « ${argv.join(" ")} »`;
    const out = (s: string) => {
      if (s) this.sysWrite(p, 1, s, "write", step);
    };
    const finish = (code: number) => {
      this.setKind(step, "exit");
      step.text.push(`Le programme « ${cmd} » se termine (code ${code}).`);
      this.terminate(p, { code }, step);
    };
    const filters = new Set(["cat", "wc", "sort", "grep", "head", "tail", "uniq", "tr", "rev"]);

    if (filters.has(cmd) && !(cmd === "cat" && args.length > 0)) {
      // Read the whole standard input first.
      const e = p.fds.get(0);
      if (e?.kind === "pipe") {
        if (e.pipe.buf) {
          ext.input += e.pipe.buf;
          step.text.push(`« ${cmd} » lit ${quote(e.pipe.buf)} sur son entrée standard (tube #${e.pipe.id}).`);
          e.pipe.buf = "";
        }
        if (e.pipe.writers > 0) {
          p.blocked = { type: "read", fd: 0 };
          this.setState(p, "WAITING");
          step.text.push(`« ${cmd} » attend la fin de son entrée (tube #${e.pipe.id} encore ouvert en écriture par ${this.writersOf(e.pipe).join(", ")}).`);
          this.switchReason = `${p.short} attend son entrée`;
          return;
        }
      } else if (e?.kind === "tty") {
        ext.input += this.opts.stdin.slice(this.stdinPos);
        this.stdinPos = this.opts.stdin.length;
      }
      const input = ext.input;
      const lines = input.split("\n");
      if (lines[lines.length - 1] === "") lines.pop();
      let res = "";
      switch (cmd) {
        case "cat":
          res = input;
          break;
        case "wc": {
          const l = (input.match(/\n/g) ?? []).length;
          const w = input.split(/\s+/).filter(Boolean).length;
          const c = input.length;
          if (args.includes("-l")) res = `${l}\n`;
          else if (args.includes("-w")) res = `${w}\n`;
          else if (args.includes("-c")) res = `${c}\n`;
          else res = `${String(l).padStart(7)} ${String(w).padStart(7)} ${String(c).padStart(7)}\n`;
          break;
        }
        case "sort":
          res = lines.sort(args.includes("-n") ? (a, b) => parseFloat(a) - parseFloat(b) : undefined).join("\n") + (lines.length ? "\n" : "");
          if (args.includes("-r")) res = lines.reverse().join("\n") + (lines.length ? "\n" : "");
          break;
        case "grep": {
          const pat = args.find((a) => !a.startsWith("-")) ?? "";
          const kept = lines.filter((l) => (args.includes("-v") ? !l.includes(pat) : l.includes(pat)));
          res = args.includes("-c") ? `${kept.length}\n` : kept.map((l) => l + "\n").join("");
          break;
        }
        case "head":
        case "tail": {
          const nArg = args.find((a) => /^-?\d+$/.test(a.replace(/^-n/, "")));
          const n = nArg ? Math.abs(parseInt(nArg.replace(/^-n/, ""), 10)) : 10;
          const kept = cmd === "head" ? lines.slice(0, n) : lines.slice(-n);
          res = kept.map((l) => l + "\n").join("");
          break;
        }
        case "uniq":
          res = lines.filter((l, i) => l !== lines[i - 1]).map((l) => l + "\n").join("");
          break;
        case "rev":
          res = lines.map((l) => [...l].reverse().join("") + "\n").join("");
          break;
        case "tr": {
          const [a = "", b = ""] = args;
          const map = (ch: string) => {
            if (a === "a-z" && b === "A-Z") return ch.toUpperCase();
            if (a === "A-Z" && b === "a-z") return ch.toLowerCase();
            const i = a.indexOf(ch);
            return i >= 0 ? (b[Math.min(i, b.length - 1)] ?? ch) : ch;
          };
          res = [...input].map(map).join("");
          break;
        }
      }
      out(res);
      finish(0);
      return;
    }

    switch (cmd) {
      case "echo": {
        const noNl = args[0] === "-n";
        out(args.slice(noNl ? 1 : 0).join(" ").replace(/^["']|["']$/g, "") + (noNl ? "" : "\n"));
        finish(0);
        return;
      }
      case "true":
        finish(0);
        return;
      case "false":
        finish(1);
        return;
      case "sleep": {
        if (ext.phase === 0) {
          const ms = Math.max(0, parseFloat(args[0] ?? "0") * 1000);
          ext.phase = 1;
          if (ms > 0) {
            p.blocked = { type: "sleep", until: this.clock + ms, label: `sleep ${args[0]}` };
            this.setState(p, "SLEEPING");
            step.text.push(`La commande sleep endort ${p.short} ${args[0]} s.`);
            this.switchReason = `${p.short} dort`;
            return;
          }
        }
        finish(0);
        return;
      }
      case "pwd":
        out("/home/etudiant\n");
        finish(0);
        return;
      case "whoami":
        out("etudiant\n");
        finish(0);
        return;
      case "hostname":
        out("rd-os\n");
        finish(0);
        return;
      case "date": {
        const d = new Date((EPOCH + Math.floor(this.clock / 1000)) * 1000);
        out(d.toUTCString() + "\n");
        finish(0);
        return;
      }
      case "ls": {
        const src = this.fileName;
        const bin = this.progName.replace(/^\.\//, "");
        out(args.some((a) => a.startsWith("-l"))
          ? `total 24\n-rwxr-xr-x 1 etudiant etudiant 16112 ${bin}\n-rw-r--r-- 1 etudiant etudiant  ${String(this.prog.source.length).padStart(4)} ${src}\n`
          : `${bin}\n${src}\n`);
        finish(0);
        return;
      }
      case "ps": {
        const rows = [
          "    PID    PPID STAT CMD",
          `   2000       1 S    bash`,
          ...this.alive().map((q) => `${String(q.pid).padStart(7)} ${String(q.ppid).padStart(7)} ${q === p ? "R" : q.state === "WAITING" || q.state === "SLEEPING" ? "S" : "R"}    ${q.external ? q.external.argv.join(" ") : this.progName}`),
          ...[...this.procs.values()].filter((q) => q.state === "ZOMBIE").map((q) => `${String(q.pid).padStart(7)} ${String(q.ppid).padStart(7)} Z    [${this.progName.replace(/^\.\//, "")}] <defunct>`),
        ];
        out(rows.join("\n") + "\n");
        step.text.push("ps affiche la table des processus simulée (les zombies apparaissent avec l'état Z / <defunct>).");
        finish(0);
        return;
      }
      default:
        this.emit(p, `[« ${argv.join(" ")} » : programme externe non simulé]\n`, "sys", step);
        step.text.push(`Le simulateur ne connaît pas le programme « ${cmd} » : son exécution est représentée sans sa sortie réelle.`);
        finish(0);
    }
  }

  // ── scheduling ────────────────────────────────────────────────────────
  private pickNext(): KProc | null {
    if (this.opts.policy === "random" && this.ready.length > 1) {
      const idx = Math.floor(this.rng() * this.ready.length);
      const [pid] = this.ready.splice(idx, 1);
      const p = pid !== undefined ? this.procs.get(pid) : undefined;
      if (p && p.state === "READY") return p;
    }
    while (this.ready.length) {
      const pid = this.ready.shift()!;
      const p = this.procs.get(pid);
      if (p && p.state === "READY") return p;
    }
    return null;
  }

  private nextTimer(): number | null {
    let t: number | null = null;
    for (const p of this.procs.values()) {
      if (p.state === "SLEEPING" && p.blocked?.type === "sleep") t = t === null ? p.blocked.until : Math.min(t, p.blocked.until);
      if (p.alarmAt !== null && p.state !== "ZOMBIE" && p.state !== "TERMINATED") t = t === null ? p.alarmAt : Math.min(t, p.alarmAt);
    }
    return t;
  }

  private fireTimers(idle: boolean) {
    for (const p of [...this.procs.values()]) {
      if (p.state === "SLEEPING" && p.blocked?.type === "sleep" && p.blocked.until <= this.clock) {
        const label = p.blocked.label;
        p.blocked = null;
        p.resume = p.external ? undefined : ({ ret: 0 } satisfies SysResult);
        this.enqueue(p);
        const step = this.newStep(p.pid, p.line, p.pending?.src ?? "", "wake");
        step.title = `Réveil de ${p.short}`;
        if (idle) step.text.push(`Tous les processus sont bloqués ou endormis : le processeur reste inactif et le temps avance jusqu'à t = ${formatTime(this.clock)}.`);
        step.text.push(`${label} est écoulé : ${p.short} se réveille et passe à l'état PRÊT (il attend maintenant le processeur).`);
        step.procs = this.snapshotProcs();
      }
      if (p.alarmAt !== null && p.alarmAt <= this.clock && p.state !== "ZOMBIE" && p.state !== "TERMINATED") {
        p.alarmAt = null;
        const step = this.newStep(p.pid, p.line, p.pending?.src ?? "", "signal");
        step.title = `SIGALRM pour ${p.short}`;
        step.text.push(`L'alarme programmée par alarm() expire : le noyau envoie SIGALRM à ${p.short}.`);
        this.deliverSignal(p, SIG.SIGALRM, p, step, true);
        step.procs = this.snapshotProcs();
      }
    }
  }

  private runUnit(p: KProc, step: SimStep) {
    if (p.external) {
      this.runExternal(p, step);
      return;
    }
    let value: unknown = p.resume;
    p.resume = undefined;
    if (p.cpu === 0 && p.pending?.kind === "sys" && p.pending.call.name === "fork" && p.parent !== null) {
      step.title = `${p.short} démarre : fork() renvoie 0`;
      step.text.push(
        `${p.short} obtient le processeur pour la première fois. Il reprend exactement là où était son père : à la sortie de fork(), qui renvoie 0 chez lui.`,
      );
    }
    if (p.pending?.kind === "sys" && p.pending.call.name !== "fork") {
      const c = p.pending.call;
      const what = c.name === "sleep" ? c.label : c.name === "wait" ? `${c.fn}()` : c.name === "stdin" ? "la lecture de stdin" : `${c.name}()`;
      this.setKind(step, "stmt", `${p.short} reprend après ${what}`);
    }
    const sigResume = (value as SysResult | undefined)?.signal;
    if (sigResume) {
      this.setKind(step, "signal", `${p.short} exécute ${sigResume.handler}() (${signalName(sigResume.sig)})`);
    }
    if (p.pending?.kind === "sys" && value === undefined) {
      // Woken from a blocking call: retry it.
      const res = this.syscall(p, p.pending.call, step);
      if (res.type !== "value") return;
      value = res.value;
    } else if (p.pending?.kind === "stmt" && p.pendingSignals.length) {
      const sig = p.pendingSignals.shift()!;
      const handler = p.handlers.get(sig);
      if (handler && handler !== "IGN") {
        value = { signal: { sig, handler } };
        this.setKind(step, "signal", `${p.short} traite ${signalName(sig)}`);
        step.text.push(`${p.short} reprend le processeur avec ${signalName(sig)} en attente : le gestionnaire ${handler}() s'exécute d'abord.`);
      }
    }
    for (;;) {
      if (p.pendingIndex >= 0 && value !== undefined) p.log.push({ at: p.pendingIndex, v: value });
      let r: IteratorResult<YieldReq, void>;
      try {
        r = p.pendingIndex < 0 ? p.gen!.next() : p.gen!.next(value);
      } catch (err) {
        this.crash(p, err, step);
        return;
      }
      p.pendingIndex++;
      if (r.done) {
        this.terminate(p, { code: 0 }, step);
        return;
      }
      const y = r.value;
      p.pending = y;
      p.line = y.line;
      if (y.kind === "stmt") {
        p.cpu++;
        return;
      }
      const res = this.syscall(p, y.call, step);
      if (res.type !== "value") return;
      value = res.value;
    }
  }

  private finishStep(p: KProc, step: SimStep) {
    if (p.interp) {
      step.notes.push(...p.interp.takeNotes());
      for (const w of p.interp.takeWarnings()) this.warn(w.message, w.line, step.i);
      if (p.state !== "TERMINATED" && p.state !== "ZOMBIE") p.mem = p.interp.snapshot();
    }
    p.dirty = true;
    if (!step.title) {
      const src = step.src.length > 48 ? step.src.slice(0, 48) + "…" : step.src;
      step.title = src ? `${p.short} exécute ${src}` : `${p.short} s'exécute`;
    }
    step.procs = this.snapshotProcs();
    this.maxAlive = Math.max(this.maxAlive, this.alive().length);
  }

  run(): void {
    const root = this.baseProc(this.nextPid++, SHELL_PID, null);
    root.interp = new Interpreter(this.prog, this.interpOpts);
    root.gen = root.interp.run();
    const main = this.prog.funcs.get("main")!;
    root.line = main.line;
    root.pending = { kind: "stmt", line: main.line, src: "main()" };
    this.procs.set(root.pid, root);

    // Step 0: the shell starts the program; runs global initializers up to main's first statement.
    const start = this.newStep(root.pid, main.line, "int main()", "start");
    start.title = `Lancement de ${this.progName}`;
    start.text.push(
      `Le shell bash (PID ${SHELL_PID}) lance ${this.progName} : le processus ${root.short} (PID ${root.pid}, PPID ${SHELL_PID}) est créé et commence dans main().`,
    );
    this.setState(root, "RUNNING");
    this.current = root;
    this.runUnit(root, start);
    this.finishStep(root, start);
    this.lastRun = root.pid;

    let current: KProc | null = root.state === "RUNNING" ? root : null;
    if (!current && root.state === "READY") this.enqueue(root);
    while (!this.aborted) {
      if (this.liveUnits >= this.opts.maxSteps) {
        this.truncated = true;
        this.warn(
          `Simulation arrêtée après ${this.opts.maxSteps} étapes : boucle infinie ou programme trop long. Les étapes affichées restent exactes.`,
        );
        break;
      }
      if (!current || current.state !== "RUNNING") {
        const next = this.pickNext();
        if (!next) {
          const t = this.nextTimer();
          if (t === null) break;
          this.clock = Math.max(this.clock, t);
          this.fireTimers(true);
          continue;
        }
        current = next;
        this.setState(current, "RUNNING");
        this.quantumUsed = 0;
      }
      const p = current;
      this.current = p;
      const step = this.newStep(p.pid, p.pending?.line ?? p.line, p.pending?.src ?? "", "stmt");
      if (this.lastRun !== null && this.lastRun !== p.pid) {
        step.switchFrom = this.lastRun;
        step.text.push(`Changement de contexte : ${this.name(this.lastRun)} → ${p.short} (${p.pid})${this.switchReason ? ` — ${this.switchReason}` : ""}.`);
      }
      this.switchReason = "";
      this.runUnit(p, step);
      this.liveUnits++;
      this.lastRun = p.pid;
      this.finishStep(p, step);
      this.clock += 1;
      this.fireTimers(false);

      if (p.state === "RUNNING") {
        if (p.yieldToChild) {
          p.yieldToChild = false;
          this.ready.splice(Math.min(1, this.ready.length), 0, p.pid);
          this.setState(p, "READY");
          this.switchReason = `politique « fils d'abord » : le fils obtient le processeur juste après fork()`;
        } else if (this.opts.policy === "rr" && ++this.quantumUsed >= this.opts.quantum && this.ready.length > 0) {
          this.enqueue(p);
          this.switchReason = `quantum de ${this.opts.quantum} instruction(s) épuisé pour ${p.short}`;
        } else if (this.opts.policy === "random" && this.ready.length > 0 && this.rng() < 0.4) {
          this.enqueue(p);
          this.switchReason = "l'ordonnanceur a choisi un autre processus (ordre aléatoire)";
        }
      }
    }

    // Final summary step.
    const end = this.newStep(0, this.prog.funcs.get("main")!.endLine, "", "end");
    end.title = this.aborted ? "Simulation interrompue" : "Fin de la simulation";
    const stuck = this.alive();
    if (stuck.length && !this.truncated && !this.aborted) {
      end.title = "Interblocage : processus bloqués pour toujours";
      for (const q of stuck) {
        let why = this.describeBlocked(q) ?? q.state;
        if (q.blocked?.type === "read") {
          const pipe = this.pipeOf(q, q.blocked.fd);
          if (pipe) why += ` — le tube #${pipe.id} est encore ouvert en écriture par ${this.writersOf(pipe).join(", ")} (pensez à close() l'extrémité inutile)`;
        }
        end.text.push(`${q.short} (PID ${q.pid}) reste bloqué : ${why}.`);
        this.warn(`${q.short} (PID ${q.pid}) est bloqué pour toujours : ${why}`, q.line);
      }
    }
    const total = this.procs.size;
    end.text.push(`${total} processus au total (${this.forks} fork${this.forks > 1 ? "s" : ""} réussi${this.forks > 1 ? "s" : ""}), au plus ${this.maxAlive} en même temps. Durée simulée : ${formatTime(this.clock)}.`);
    const neverWaited = [...this.procs.values()].filter((q) => q.reapedBy === INIT_PID);
    if (neverWaited.length) {
      end.text.push(`${neverWaited.map((q) => q.short).join(", ")} ${neverWaited.length > 1 ? "n'ont" : "n'a"} pas été attendu${neverWaited.length > 1 ? "s" : ""} par leur père : init (PID 1) s'en est chargé.`);
    }
    end.procs = this.snapshotProcs();
  }

  fail(message: string) {
    const last = this.steps[this.steps.length - 1];
    const line = last?.line ?? 1;
    this.aborted = { message: `Erreur interne du simulateur : ${message}`, line };
    if (last && last.procs.length === 0) last.procs = this.snapshotProcs();
  }

  result(code: string, extraWarnings: SimWarning[]): SimResult {
    let outputLines = 0;
    for (const c of this.output) if (c.stream !== "sys") outputLines += (c.text.match(/\n/g) ?? []).length;
    const procs = [...this.procs.values()];
    return {
      ok: !this.aborted,
      error: this.aborted,
      errors: this.aborted ? [this.aborted] : [],
      steps: this.steps,
      output: this.output,
      warnings: [...extraWarnings, ...this.warnings],
      stats: {
        processes: procs.length,
        forks: this.forks,
        maxAlive: this.maxAlive,
        outputLines,
        duration: this.clock,
        truncated: this.truncated,
        zombies: procs.filter((q) => q.zombieSince !== null).length,
        orphans: procs.filter((q) => q.orphan).length,
        deadlocked: this.truncated || this.aborted ? 0 : this.alive().length,
      },
      code,
      fileName: this.fileName,
      options: this.opts,
    };
  }
}

function emptyResult(code: string, fileName: string, options: SimOptions, errors: { message: string; line: number }[], warnings: SimWarning[]): SimResult {
  return {
    ok: false,
    error: errors[0] ?? null,
    errors,
    steps: [],
    output: [],
    warnings,
    stats: { processes: 0, forks: 0, maxAlive: 0, outputLines: 0, duration: 0, truncated: false, zombies: 0, orphans: 0, deadlocked: 0 },
    code,
    fileName,
    options,
  };
}

/** Parses, checks and runs a C program, returning the full step-by-step trace. */
export function simulate(source: string, fileName = "programme.c", options: Partial<SimOptions> = {}): SimResult {
  const opts: SimOptions = { ...DEFAULT_OPTIONS, ...options };
  const code = normalizeSource(source);
  let prog: Program;
  try {
    prog = parseProgram(code);
  } catch (err) {
    if (err instanceof CError) return emptyResult(code, fileName, opts, [{ message: err.message, line: err.line }], []);
    throw err;
  }
  const check = checkProgram(prog);
  const warnings: SimWarning[] = check.warnings.map((w) => ({ message: w.message, line: w.line }));
  if (check.errors.length) {
    return emptyResult(code, fileName, opts, check.errors.map((e) => ({ message: e.message, line: e.line })), warnings);
  }
  const kernel = new Kernel(prog, opts, fileName);
  try {
    kernel.run();
  } catch (err) {
    // Never let an engine bug break the UI: keep the trace computed so far.
    kernel.fail(err instanceof Error ? err.message : String(err));
  }
  return kernel.result(code, warnings);
}

/** Concatenated terminal output (stdout + stderr), as a real terminal would show it. */
export function terminalText(result: SimResult, uptoStep = Infinity, includeSys = false): string {
  return result.output
    .filter((c) => c.step <= uptoStep && (includeSys || c.stream !== "sys"))
    .map((c) => c.text)
    .join("");
}
