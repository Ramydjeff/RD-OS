// Tree-walking C interpreter written as a generator: every statement yields
// to the kernel (scheduling point) and every system call is a yield whose
// answer comes from the kernel. A process' memory lives entirely here, which
// lets the kernel rebuild a forked child by deterministic replay.

import { CHAR, DOUBLE, INT, typeName, type CallExpr, type CType, type DeclStmt, type Declarator, type Expr, type FuncDef, type Program, type Stmt } from "./ast";
import { formatPrintf, type FormatContext, type ScanValue } from "./format";
import { CError } from "./lexer";
import {
  NULLPTR,
  STDERR_BLOCK,
  STDIN_BLOCK,
  STDOUT_BLOCK,
  UNDEF,
  VOID,
  blockString,
  cellLabel,
  coerce,
  escapeText,
  mkFloat,
  mkInt,
  scalarSize,
  showBlock,
  showValue,
  toNumber,
  truthy,
  zeroOf,
  type Block,
  type BlockKind,
  type Value,
} from "./memory";
import { ERRNO, SIG, errnoText, signalName } from "./signals";

export class CRuntimeError extends Error {
  readonly line: number;
  readonly signal: number;
  constructor(message: string, line: number, signal: number) {
    super(message);
    this.name = "CRuntimeError";
    this.line = line;
    this.signal = signal;
  }
}

export interface SignalDelivery {
  sig: number;
  handler: string;
}

export type SysCall =
  | { name: "fork" }
  | { name: "getpid" }
  | { name: "getppid" }
  | { name: "getpgrp" }
  | { name: "wait"; pid: number; options: number; fn: string }
  | { name: "exit"; code: number; how: "exit" | "_exit" | "return"; lost: string }
  | { name: "sleep"; ms: number; label: string }
  | { name: "write"; fd: number; data: string; via: string }
  | { name: "read"; fd: number; max: number }
  | { name: "isatty"; fd: number }
  | { name: "pipe" }
  | { name: "close"; fd: number }
  | { name: "dup"; fd: number }
  | { name: "dup2"; fd: number; fd2: number }
  | { name: "kill"; pid: number; sig: number }
  | { name: "raise"; sig: number }
  | { name: "signal"; sig: number; handler: string }
  | { name: "pause" }
  | { name: "alarm"; sec: number }
  | { name: "exec"; fn: string; path: string; argv: string[]; lost: string }
  | { name: "system"; cmd: string }
  | { name: "time" }
  | { name: "clock" }
  | { name: "stdin"; op: "scanf"; fmt: string }
  | { name: "stdin"; op: "getchar" }
  | { name: "stdin"; op: "fgets"; max: number };

export interface SysResult {
  ret: number;
  errno?: number;
  status?: number;
  fds?: [number, number];
  data?: string | null;
  values?: ScanValue[];
  signal?: SignalDelivery;
}

export type YieldReq =
  | { kind: "stmt"; line: number; src: string }
  | { kind: "sys"; call: SysCall; line: number; src: string };

type Gen<T> = Generator<YieldReq, T, unknown>;

type Completion = { t: 0 } | { t: 1 } | { t: 2 } | { t: 3; v: Value };
const NORMAL: Completion = { t: 0 };
const BREAK: Completion = { t: 1 };
const CONTINUE: Completion = { t: 2 };

interface Binding {
  name: string;
  block: Block;
  type: CType;
  isArray: boolean;
  dims: number[];
}

class Scope {
  readonly vars = new Map<string, Binding>();
  constructor(readonly parent: Scope | null) {}
}

interface Frame {
  fn: FuncDef;
  root: Scope;
  scope: Scope;
  line: number;
}

interface LRef {
  b: Block | null;
  o: number;
  t: CType;
  label: string;
}

export type BufferMode = "line" | "full" | "none";

export interface InterpOptions {
  buffer: BufferMode;
  progName: string;
}

export interface MemVar {
  name: string;
  type: string;
  value: string;
  changed: boolean;
}

export interface MemFrame {
  func: string;
  line: number;
  vars: MemVar[];
}

export interface MemView {
  globals: MemVar[];
  frames: MemFrame[];
  heap: MemVar[];
  buffer: string;
  bufferMode: BufferMode;
}

const CONSTS: Record<string, Value> = {
  NULL: NULLPTR,
  EXIT_SUCCESS: mkInt(0),
  EXIT_FAILURE: mkInt(1),
  true: mkInt(1),
  false: mkInt(0),
  EOF: mkInt(-1),
  RAND_MAX: mkInt(2147483647),
  BUFSIZ: mkInt(8192),
  CLOCKS_PER_SEC: mkInt(1000000),
  STDIN_FILENO: mkInt(0),
  STDOUT_FILENO: mkInt(1),
  STDERR_FILENO: mkInt(2),
  WNOHANG: mkInt(1),
  WUNTRACED: mkInt(2),
  WCONTINUED: mkInt(8),
  SIG_DFL: mkInt(0),
  SIG_IGN: mkInt(1),
  SIG_ERR: mkInt(-1),
  _IOFBF: mkInt(0),
  _IOLBF: mkInt(1),
  _IONBF: mkInt(2),
  stdin: { k: "ptr", b: STDIN_BLOCK, o: 0 },
  stdout: { k: "ptr", b: STDOUT_BLOCK, o: 0 },
  stderr: { k: "ptr", b: STDERR_BLOCK, o: 0 },
};
for (const [name, n] of Object.entries(SIG)) CONSTS[name] = mkInt(n);
for (const [name, n] of Object.entries(ERRNO)) CONSTS[name] = mkInt(n);

export const BUILTIN_HEADERS: Record<string, string> = {};
const H: [string, string[]][] = [
  ["unistd.h", ["fork", "vfork", "getpid", "getppid", "getpgrp", "getpgid", "getuid", "geteuid", "sleep", "usleep", "pause", "alarm", "pipe", "read", "write", "close", "dup", "dup2", "isatty", "execl", "execlp", "execle", "execv", "execvp", "execve", "_exit"]],
  ["sys/wait.h", ["wait", "waitpid", "WIFEXITED", "WEXITSTATUS", "WIFSIGNALED", "WTERMSIG", "WIFSTOPPED", "WSTOPSIG", "WCOREDUMP", "WIFCONTINUED"]],
  ["stdio.h", ["printf", "fprintf", "sprintf", "snprintf", "puts", "putchar", "fputs", "fputc", "putc", "fflush", "perror", "scanf", "getchar", "fgets", "gets", "setbuf", "setvbuf"]],
  ["stdlib.h", ["exit", "_Exit", "abort", "malloc", "calloc", "realloc", "free", "atoi", "atol", "atof", "strtol", "abs", "labs", "rand", "srand", "system"]],
  ["string.h", ["strlen", "strcpy", "strncpy", "strcat", "strncat", "strcmp", "strncmp", "strchr", "strrchr", "strstr", "strdup", "memset", "memcpy", "strerror"]],
  ["signal.h", ["kill", "signal", "raise"]],
  ["time.h", ["time", "clock"]],
  ["math.h", ["sqrt", "pow", "fabs", "floor", "ceil", "round", "exp", "log", "log10", "sin", "cos", "tan", "fmax", "fmin"]],
  ["ctype.h", ["isdigit", "isalpha", "isalnum", "isspace", "isupper", "islower", "toupper", "tolower"]],
  ["assert.h", ["assert"]],
];
for (const [header, names] of H) for (const n of names) BUILTIN_HEADERS[n] = header;
export const BUILTIN_NAMES = new Set(Object.keys(BUILTIN_HEADERS));
export const CONST_NAMES = new Set([...Object.keys(CONSTS), "errno"]);

/** glibc's TYPE_3 random generator: same sequence as rand() compiled with gcc. */
class GlibcRand {
  private st = new Int32Array(31);
  private f = 3;
  private r = 0;
  constructor() {
    this.seed(1);
  }
  seed(seed: number) {
    let word = seed | 0;
    if (word === 0) word = 1;
    this.st[0] = word;
    for (let i = 1; i < 31; i++) {
      const hi = Math.trunc(word / 127773);
      const lo = word % 127773;
      word = 16807 * lo - 2836 * hi;
      if (word < 0) word += 2147483647;
      this.st[i] = word;
    }
    this.f = 3;
    this.r = 0;
    for (let i = 0; i < 310; i++) this.next();
  }
  next(): number {
    this.st[this.f] = (this.st[this.f]! + this.st[this.r]!) | 0;
    const result = (this.st[this.f]! >>> 0) >>> 1;
    this.f++;
    if (this.f >= 31) {
      this.f = 0;
      this.r++;
    } else {
      this.r++;
      if (this.r >= 31) this.r = 0;
    }
    return result;
  }
}

const MAX_NOTES = 8;
const MAX_DEPTH = 200;

export class Interpreter {
  readonly globals = new Scope(null);
  readonly frames: Frame[] = [];
  /** True while the kernel replays history for a forked child. */
  silent = false;
  stdoutBuf = "";
  bufMode: BufferMode;
  private bufDecided = false;
  errno = 0;
  warnings: { message: string; line: number }[] = [];
  private notes: string[] = [];
  private dirty = new Set<Block>();
  private nextBlockId = 1;
  private readonly strCache = new Map<Expr, Block>();
  private readonly statics = new Map<Declarator, Binding>();
  private readonly heap: Block[] = [];
  private readonly rand = new GlibcRand();
  private readonly warnedUndef = new Set<Block>();
  private readonly errnoBlock: Block;
  curLine = 0;
  curSrc = "";

  constructor(
    private readonly prog: Program,
    private readonly opts: InterpOptions,
  ) {
    this.bufMode = opts.buffer;
    this.errnoBlock = this.newBlock("errno", "var", [mkInt(0)], INT);
  }

  // ── kernel-facing helpers ─────────────────────────────────────────────
  takeNotes(): string[] {
    const n = this.notes;
    this.notes = [];
    return n;
  }

  takeWarnings(): { message: string; line: number }[] {
    const w = this.warnings;
    this.warnings = [];
    return w;
  }

  funcName(): string {
    const f = this.frames[this.frames.length - 1];
    return f ? f.fn.name : "main";
  }

  callStack(): string[] {
    return this.frames.map((f) => f.fn.name);
  }

  snapshot(): MemView {
    const dirty = this.dirty;
    const isDirty = (b: Block): boolean =>
      dirty.has(b) || b.cells.some((c) => c.k === "ptr" && !!c.b && c.b.kind === "array" && c.b.name.startsWith(b.name + "[") && dirty.has(c.b));
    const viewOf = (bind: Binding): MemVar => {
      let type = typeName(bind.type);
      if (bind.isArray) type += bind.dims.map((d) => `[${d}]`).join("");
      const value = bind.isArray ? showBlock(bind.block) : showValue(bind.block.cells[0] ?? UNDEF, bind.type);
      return { name: bind.name, type, value, changed: isDirty(bind.block) };
    };
    const scopeVars = (s: Scope): MemVar[] => [...s.vars.values()].map(viewOf);
    const frames: MemFrame[] = this.frames.map((f) => {
      const chain: Scope[] = [];
      for (let s: Scope | null = f.scope; s && s !== this.globals; s = s.parent) chain.unshift(s);
      const seen = new Set<string>();
      const vars: MemVar[] = [];
      for (const s of chain) for (const v of scopeVars(s)) {
        if (seen.has(v.name)) {
          const idx = vars.findIndex((x) => x.name === v.name);
          if (idx >= 0) vars.splice(idx, 1);
        }
        seen.add(v.name);
        vars.push(v);
      }
      return { func: f.fn.name, line: f.line, vars };
    });
    const heap = this.heap
      .filter((b) => !b.freed)
      .map((b) => ({ name: b.name, type: `${typeName(b.elem)}[${b.cells.length}]`, value: showBlock(b), changed: dirty.has(b) }));
    this.dirty = new Set();
    return { globals: scopeVars(this.globals), frames, heap, buffer: this.stdoutBuf, bufferMode: this.bufMode };
  }

  private warn(message: string, line: number) {
    if (!this.silent) this.warnings.push({ message, line });
  }

  private note(message: string) {
    if (this.silent) return;
    if (this.notes.length < MAX_NOTES) this.notes.push(message);
    else if (this.notes.length === MAX_NOTES) this.notes.push("…");
  }

  private fmtCtx(line: number): FormatContext {
    return { warn: (m) => this.warn(m, line) };
  }

  // ── memory ────────────────────────────────────────────────────────────
  private newBlock(name: string, kind: BlockKind, cells: Value[], elem: CType): Block {
    return { id: this.nextBlockId++, name, kind, cells, elem };
  }

  private makeString(s: string, readonly: boolean): Block {
    const cells: Value[] = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i) & 0xff;
      cells.push(mkInt(c > 127 ? c - 256 : c));
    }
    cells.push(mkInt(0));
    const b = this.newBlock(`"${escapeText(s.slice(0, 16))}"`, "str", cells, CHAR);
    b.readonly = readonly;
    return b;
  }

  private strBlock(e: Expr & { k: "str" }): Block {
    let b = this.strCache.get(e);
    if (!b) {
      b = this.makeString(e.v, true);
      this.strCache.set(e, b);
    }
    return b;
  }

  private makeArray(name: string, dims: number[], elem: CType, zero: boolean): Block {
    const n = dims[0]!;
    if (dims.length === 1) {
      const cells: Value[] = [];
      for (let i = 0; i < n; i++) cells.push(zero ? zeroOf(elem) : UNDEF);
      return this.newBlock(name, "array", cells, elem);
    }
    const cells: Value[] = [];
    for (let i = 0; i < n; i++) {
      const sub = this.makeArray(`${name}[${i}]`, dims.slice(1), elem, zero);
      cells.push({ k: "ptr", b: sub, o: 0, t: elem });
    }
    return this.newBlock(name, "array", cells, elem);
  }

  private zeroFill(b: Block) {
    for (let i = 0; i < b.cells.length; i++) {
      const c = b.cells[i]!;
      if (c.k === "ptr" && c.b && c.b.kind === "array" && c.b.name.startsWith(b.name + "[")) this.zeroFill(c.b);
      else b.cells[i] = zeroOf(b.elem);
    }
  }

  private checkAccess(b: Block | null, o: number, line: number, write: boolean): Block {
    if (!b) {
      throw new CRuntimeError(o === 0 ? "Déréférencement du pointeur NULL" : `Accès à une adresse invalide (0x${o.toString(16)})`, line, SIG.SIGSEGV);
    }
    if (b.kind === "stream") throw new CError(`« ${b.name} » est un flux (FILE *), pas une zone mémoire`, line);
    if (b.freed) throw new CRuntimeError(`Accès à ${b.name} après free() (zone déjà libérée)`, line, SIG.SIGSEGV);
    if (o < 0 || o >= b.cells.length) {
      const what = b.kind === "str" ? "la chaîne littérale" : `« ${b.name} »`;
      throw new CRuntimeError(
        `Accès hors limites : indice ${o} alors que ${what} n'a que ${b.cells.length} case(s) (comportement indéfini en C, le simulateur arrête le processus)`,
        line,
        SIG.SIGSEGV,
      );
    }
    if (write && b.readonly) {
      throw new CRuntimeError("Modification d'une chaîne littérale : elle est en mémoire en lecture seule", line, SIG.SIGSEGV);
    }
    return b;
  }

  private read(lv: LRef, line: number): Value {
    const b = this.checkAccess(lv.b, lv.o, line, false);
    const v = b.cells[lv.o]!;
    if (v.k === "undef") {
      if (!this.warnedUndef.has(b)) {
        this.warnedUndef.add(b);
        this.warn(
          `« ${lv.label} » est lue sans avoir été initialisée : sa valeur est indéterminée en C (le simulateur prend 0)`,
          line,
        );
      }
      return zeroOf(lv.t);
    }
    return v;
  }

  private store(lv: LRef, v: Value, line: number, quiet = false): Value {
    const b = this.checkAccess(lv.b, lv.o, line, true);
    let cv = coerce(v.k === "undef" ? zeroOf(lv.t) : v, lv.t);
    if (cv.k === "ptr" && cv.b && cv.b.kind === "heap" && cv.t && cv.t.base !== "void" && cv.b.elem === CHAR && cv.t !== CHAR) {
      // First typed use of a malloc() block: give it its element type.
      const bytes = cv.b.cells.length;
      const size = scalarSize(cv.t);
      if (size > 1 && cv.t.base !== "char") {
        cv.b.elem = cv.t;
        cv.b.cells.length = Math.max(1, Math.floor(bytes / size));
        for (let i = 0; i < cv.b.cells.length; i++) if (cv.b.cells[i] === undefined) cv.b.cells[i] = UNDEF;
      } else {
        cv.b.elem = cv.t;
      }
    }
    if (cv.k === "undef") cv = zeroOf(lv.t);
    b.cells[lv.o] = cv;
    this.dirty.add(b);
    if (!quiet) this.note(`${lv.label} ← ${showValue(cv, lv.t)}`);
    return cv;
  }

  private ptrLv(p: Value, line: number): LRef {
    if (p.k !== "ptr") throw new CError("Déréférencement d'une valeur qui n'est pas un pointeur", line);
    const t = p.t && !(p.t.base === "void" && p.t.ptr === 0) ? p.t : (p.b?.elem ?? INT);
    return { b: p.b, o: p.o, t, label: p.b ? cellLabel(p.b, p.o) : "*NULL" };
  }

  cstr(v: Value | undefined, line: number): string {
    if (!v || v.k !== "ptr") throw new CError("Une chaîne de caractères (char *) est attendue", line);
    if (!v.b) throw new CRuntimeError("Chaîne NULL passée à une fonction", line, SIG.SIGSEGV);
    if (v.b.kind === "stream") throw new CError("Un flux FILE * a été passé là où une chaîne est attendue", line);
    this.checkAccess(v.b, v.o, line, false);
    return blockString(v.b, v.o);
  }

  private writeCStr(dst: Value | undefined, s: string, line: number, what: string) {
    if (!dst || dst.k !== "ptr") throw new CError(`${what} : un tableau de char est attendu comme destination`, line);
    const b = this.checkAccess(dst.b, dst.o, line, true);
    if (dst.o + s.length >= b.cells.length) {
      throw new CRuntimeError(
        `${what} : débordement de tampon, ${s.length + 1} octets à écrire dans ${b.name} qui n'a que ${b.cells.length - dst.o} case(s)`,
        line,
        SIG.SIGSEGV,
      );
    }
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i) & 0xff;
      b.cells[dst.o + i] = mkInt(c > 127 ? c - 256 : c);
    }
    b.cells[dst.o + s.length] = mkInt(0);
    this.dirty.add(b);
    this.note(`${cellLabel(b, dst.o).replace(/\[0\]$/, "")} ← "${escapeText(s)}"`);
  }

  private readBytes(src: Value | undefined, n: number, line: number): string {
    if (!src || src.k !== "ptr") throw new CError("Un tampon (pointeur) est attendu", line);
    const b = this.checkAccess(src.b, src.o, line, false);
    let s = "";
    for (let i = 0; i < n; i++) {
      const c = b.cells[src.o + i];
      if (c === undefined) {
        throw new CRuntimeError(`Lecture de ${n} octets au-delà de la fin de ${b.name}`, line, SIG.SIGSEGV);
      }
      s += String.fromCharCode(Math.trunc(toNumber(c)) & 0xff);
    }
    return s;
  }

  // ── scopes ────────────────────────────────────────────────────────────
  private frame(): Frame | undefined {
    return this.frames[this.frames.length - 1];
  }
  private scope(): Scope {
    return this.frame()?.scope ?? this.globals;
  }
  private pushScope() {
    const f = this.frame();
    if (f) f.scope = new Scope(f.scope);
  }
  private popScope() {
    const f = this.frame();
    if (f) f.scope = f.scope.parent ?? f.root;
  }
  private lookup(name: string): Binding | undefined {
    for (let s: Scope | null = this.scope(); s; s = s.parent) {
      const b = s.vars.get(name);
      if (b) return b;
    }
    return undefined;
  }

  // ── yields ────────────────────────────────────────────────────────────
  private *stmt(line: number, src: string): Gen<void> {
    this.curLine = line;
    this.curSrc = src;
    const f = this.frame();
    if (f) f.line = line;
    const r = yield { kind: "stmt", line, src };
    if (r && typeof r === "object" && "signal" in r) {
      yield* this.runHandler((r as { signal: SignalDelivery }).signal);
    }
  }

  private *sys(call: SysCall): Gen<SysResult> {
    const r = (yield { kind: "sys", call, line: this.curLine, src: this.curSrc }) as SysResult;
    if (r.errno !== undefined) {
      this.errno = r.errno;
      this.errnoBlock.cells[0] = mkInt(r.errno);
    }
    if (r.signal) yield* this.runHandler(r.signal);
    return r;
  }

  private *runHandler(d: SignalDelivery): Gen<void> {
    const fn = this.prog.funcs.get(d.handler);
    if (!fn) return;
    this.note(`signal ${signalName(d.sig)} reçu → le gestionnaire ${d.handler}() s'exécute`);
    yield* this.callFunction(fn, [mkInt(d.sig)], this.curLine);
  }

  // ── program ───────────────────────────────────────────────────────────
  *run(): Gen<void> {
    for (const g of this.prog.globals) yield* this.execDecl(g, this.globals, true, false);
    const main = this.prog.funcs.get("main");
    if (!main) throw new CError("Aucune fonction main()", 1);
    const args: Value[] = [];
    if (main.params.length >= 1) args.push(mkInt(1));
    if (main.params.length >= 2) {
      const name = this.makeString(this.opts.progName, false);
      const argv = this.newBlock("argv", "array", [{ k: "ptr", b: name, o: 0, t: CHAR }, NULLPTR], { ...CHAR, ptr: 1 });
      args.push({ k: "ptr", b: argv, o: 0, t: { ...CHAR, ptr: 1 } });
    }
    this.curLine = main.line;
    this.curSrc = "main()";
    const ret = yield* this.callFunction(main, args, main.line, true);
    yield* this.exitProcess(Math.trunc(toNumber(ret)), "return");
  }

  private *callFunction(fn: FuncDef, args: Value[], line: number, isMain = false): Gen<Value> {
    if (this.frames.length >= MAX_DEPTH) {
      throw new CRuntimeError(`Débordement de pile : récursion trop profonde dans ${fn.name}()`, line, SIG.SIGSEGV);
    }
    const saveLine = this.curLine;
    const saveSrc = this.curSrc;
    const root = new Scope(this.globals);
    fn.params.forEach((p, i) => {
      if (!p.name) return;
      const a = args[i];
      if (a === undefined) {
        this.warn(`${fn.name}() est appelée sans valeur pour le paramètre « ${p.name} »`, line);
      }
      const b = this.newBlock(p.name, "var", [a === undefined ? UNDEF : coerce(a, p.type)], p.type);
      root.vars.set(p.name, { name: p.name, block: b, type: p.type, isArray: false, dims: [] });
    });
    const frame: Frame = { fn, root, scope: root, line: fn.line };
    this.frames.push(frame);
    let c: Completion = NORMAL;
    for (const s of fn.body.body) {
      c = yield* this.exec(s);
      if (c.t !== 0) break;
    }
    if (isMain && c.t !== 3) yield* this.stmt(fn.endLine, "}");
    this.frames.pop();
    this.curLine = saveLine;
    this.curSrc = saveSrc;
    const isVoid = fn.ret.base === "void" && fn.ret.ptr === 0;
    if (c.t === 3) return isVoid ? VOID : coerce(c.v, fn.ret);
    if (isMain) return mkInt(0);
    if (!isVoid) this.warn(`${fn.name}() se termine sans « return » : sa valeur de retour est indéterminée`, fn.endLine);
    return isVoid ? VOID : mkInt(0);
  }

  // ── statements ────────────────────────────────────────────────────────
  private *exec(s: Stmt): Gen<Completion> {
    switch (s.k) {
      case "block": {
        this.pushScope();
        for (const st of s.body) {
          const c = yield* this.exec(st);
          if (c.t !== 0) {
            this.popScope();
            return c;
          }
        }
        this.popScope();
        return NORMAL;
      }
      case "decl":
        yield* this.execDecl(s, this.scope(), false, true);
        return NORMAL;
      case "expr":
        yield* this.stmt(s.line, s.src);
        yield* this.eval(s.e);
        return NORMAL;
      case "if": {
        yield* this.stmt(s.line, s.src);
        const v = truthy(yield* this.eval(s.c));
        this.noteCondition(s.c, s.src.replace(/^if\s*/, ""), v, v ? (s.else ? "branche « if »" : "on entre dans le bloc") : s.else ? "branche « else »" : "le bloc est sauté");
        if (v) return yield* this.exec(s.then);
        if (s.else) return yield* this.exec(s.else);
        return NORMAL;
      }
      case "while":
        for (;;) {
          yield* this.stmt(s.line, s.src);
          const v = truthy(yield* this.eval(s.c));
          this.noteCondition(s.c, s.src.replace(/^while\s*/, ""), v, v ? "nouveau tour de boucle" : "sortie de la boucle");
          if (!v) return NORMAL;
          const c = yield* this.exec(s.body);
          if (c.t === 1) return NORMAL;
          if (c.t === 3) return c;
        }
      case "do":
        for (;;) {
          const c = yield* this.exec(s.body);
          if (c.t === 1) return NORMAL;
          if (c.t === 3) return c;
          yield* this.stmt(s.line, s.src);
          const v = truthy(yield* this.eval(s.c));
          this.noteCondition(s.c, s.src.replace(/^while\s*/, ""), v, v ? "nouveau tour de boucle" : "sortie de la boucle");
          if (!v) return NORMAL;
        }
      case "for": {
        this.pushScope();
        let first = true;
        for (;;) {
          yield* this.stmt(s.line, s.src);
          if (first) {
            if (s.init?.k === "decl") yield* this.execDecl(s.init, this.scope(), false, false);
            else if (s.init?.k === "expr") yield* this.eval(s.init.e);
          } else if (s.step) {
            yield* this.eval(s.step);
          }
          first = false;
          if (s.c) {
            const v = truthy(yield* this.eval(s.c));
            this.noteCondition(s.c, `(${s.condSrc})`, v, v ? "on exécute le corps de la boucle" : "sortie de la boucle");
            if (!v) break;
          }
          const c = yield* this.exec(s.body);
          if (c.t === 1) break;
          if (c.t === 3) {
            this.popScope();
            return c;
          }
        }
        this.popScope();
        return NORMAL;
      }
      case "switch": {
        yield* this.stmt(s.line, s.src);
        const v = Math.trunc(toNumber(yield* this.eval(s.e)));
        const body = s.body.k === "block" ? s.body.body : [s.body];
        let start = -1;
        for (let i = 0; i < body.length; i++) {
          const st = body[i]!;
          if (st.k === "case" && st.test && Math.trunc(toNumber(yield* this.eval(st.test))) === v) {
            start = i;
            break;
          }
        }
        if (start < 0) start = body.findIndex((st) => st.k === "case" && !st.test);
        this.note(start < 0 ? `switch (${v}) : aucun case ne correspond` : `switch : saut vers ${body[start]!.k === "case" && (body[start] as { test: Expr | null }).test ? `case ${v}` : "default"}`);
        if (start < 0) return NORMAL;
        this.pushScope();
        for (let i = start; i < body.length; i++) {
          const st = body[i]!;
          if (st.k === "case") continue;
          const c = yield* this.exec(st);
          if (c.t === 1) break;
          if (c.t !== 0) {
            this.popScope();
            return c;
          }
        }
        this.popScope();
        return NORMAL;
      }
      case "case":
        return NORMAL;
      case "break":
        return BREAK;
      case "continue":
        return CONTINUE;
      case "return": {
        yield* this.stmt(s.line, s.src);
        const v = s.e ? yield* this.eval(s.e) : VOID;
        return { t: 3, v };
      }
      case "empty":
        return NORMAL;
    }
  }

  private noteCondition(e: Expr, text: string, value: boolean, outcome: string) {
    if (this.silent) return;
    const vals: string[] = [];
    const seen = new Set<string>();
    const walk = (x: Expr) => {
      if (vals.length >= 4) return;
      switch (x.k) {
        case "id": {
          if (seen.has(x.name)) return;
          seen.add(x.name);
          const b = this.lookup(x.name);
          if (b && !b.isArray) vals.push(`${x.name} = ${showValue(b.block.cells[0] ?? UNDEF, b.type)}`);
          return;
        }
        case "unary":
        case "update":
        case "cast":
          walk(x.e);
          return;
        case "bin":
        case "logic":
        case "assign":
        case "comma":
          walk(x.l);
          walk(x.r);
          return;
        case "cond":
          walk(x.c);
          return;
        case "index":
          walk(x.e);
          walk(x.i);
          return;
        default:
          return;
      }
    };
    walk(e);
    const detail = vals.length ? ` avec ${vals.join(", ")}` : "";
    this.note(`condition ${text} ${value ? "VRAIE" : "FAUSSE"}${detail} → ${outcome}`);
  }

  private *execDecl(s: DeclStmt, scope: Scope, isGlobal: boolean, doYield: boolean): Gen<void> {
    if (doYield && s.decls.some((d) => d.init)) yield* this.stmt(s.line, s.src);
    for (const d of s.decls) {
      if (s.isStatic && !isGlobal) {
        const existing = this.statics.get(d);
        if (existing) {
          scope.vars.set(d.name, existing);
          continue;
        }
      }
      const bind = yield* this.allocate(d, isGlobal || s.isStatic);
      scope.vars.set(d.name, bind);
      if (s.isStatic && !isGlobal) this.statics.set(d, bind);
    }
  }

  private *allocate(d: Declarator, zeroInit: boolean): Gen<Binding> {
    const t = d.type;
    if (t.dims.length === 0) {
      const b = this.newBlock(d.name, "var", [zeroInit ? zeroOf(t) : UNDEF], t);
      if (d.init) {
        const initE = d.init.k === "init" ? d.init.items[0] : d.init;
        if (initE) {
          const v = yield* this.eval(initE);
          this.store({ b, o: 0, t, label: d.name }, v, d.line);
        }
      }
      return { name: d.name, block: b, type: t, isArray: false, dims: [] };
    }
    const dims: number[] = [];
    for (let i = 0; i < t.dims.length; i++) {
      const de = t.dims[i];
      if (de) {
        const n = Math.trunc(toNumber(yield* this.eval(de)));
        if (n <= 0 || n > 100000) throw new CError(`Taille invalide (${n}) pour le tableau « ${d.name} »`, d.line);
        dims.push(n);
      } else if (i === 0 && d.init) {
        dims.push(d.init.k === "init" ? Math.max(1, d.init.items.length) : d.init.k === "str" ? d.init.v.length + 1 : 1);
      } else {
        throw new CError(`Taille du tableau « ${d.name} » manquante`, d.line);
      }
    }
    const elem: CType = { ...t, dims: [] };
    const block = this.makeArray(d.name, dims, elem, zeroInit);
    if (d.init) {
      this.zeroFill(block);
      yield* this.initArray(block, dims, elem, d.init, d.line);
      this.note(`${d.name} ← ${showBlock(block)}`);
    }
    this.dirty.add(block);
    return { name: d.name, block, type: elem, isArray: true, dims };
  }

  private *initArray(block: Block, dims: number[], elem: CType, init: Expr, line: number): Gen<void> {
    if (init.k === "str") {
      if (elem.base !== "char" || elem.ptr > 0) throw new CError("Une chaîne ne peut initialiser qu'un tableau de char", line);
      const n = Math.min(init.v.length, block.cells.length);
      if (init.v.length >= block.cells.length + 1) {
        this.warn(`La chaîne "${escapeText(init.v)}" est trop longue pour ${block.name}[${block.cells.length}]`, line);
      }
      for (let i = 0; i < n; i++) block.cells[i] = coerce(mkInt(init.v.charCodeAt(i)), elem);
      return;
    }
    if (init.k !== "init") throw new CError(`Le tableau « ${block.name} » doit être initialisé avec { ... }`, line);
    if (dims.length > 1 && init.items.every((it) => it.k === "init" || it.k === "str")) {
      for (let i = 0; i < init.items.length && i < block.cells.length; i++) {
        const row = block.cells[i]!;
        if (row.k === "ptr" && row.b) yield* this.initArray(row.b, dims.slice(1), elem, init.items[i]!, line);
      }
      return;
    }
    // Flat list: fill in row-major order.
    const leaves: Block[] = [];
    const collect = (b: Block, depth: number) => {
      if (depth === dims.length - 1) {
        leaves.push(b);
        return;
      }
      for (const c of b.cells) if (c.k === "ptr" && c.b) collect(c.b, depth + 1);
    };
    collect(block, 0);
    let k = 0;
    for (const item of init.items) {
      const leaf = leaves[Math.floor(k / dims[dims.length - 1]!)];
      if (!leaf) {
        this.warn(`Trop de valeurs pour initialiser « ${block.name} »`, line);
        break;
      }
      const v = yield* this.eval(item.k === "init" ? (item.items[0] ?? { k: "num", v: 0, float: false, long: false, unsigned: false, line }) : item);
      leaf.cells[k % dims[dims.length - 1]!] = coerce(v, elem);
      k++;
    }
  }

  // ── expressions ───────────────────────────────────────────────────────
  private *lvalue(e: Expr): Gen<LRef> {
    switch (e.k) {
      case "id": {
        const bind = this.lookup(e.name);
        if (!bind) {
          if (e.name === "errno") return { b: this.errnoBlock, o: 0, t: INT, label: "errno" };
          throw new CError(`« ${e.name} » n'est pas déclarée`, e.line);
        }
        if (bind.isArray) throw new CError(`Le tableau « ${e.name} » ne peut pas être affecté directement (copiez-le case par case)`, e.line);
        return { b: bind.block, o: 0, t: bind.type, label: e.name };
      }
      case "index":
        return yield* this.indexLv(e);
      case "unary":
        if (e.op === "*") return this.ptrLv(yield* this.eval(e.e), e.line);
        break;
      case "cast":
        return yield* this.lvalue(e.e);
      default:
        break;
    }
    throw new CError("Expression non modifiable : une variable, une case de tableau ou *pointeur est attendue", e.line);
  }

  private *indexLv(e: Expr & { k: "index" }): Gen<LRef> {
    let base = yield* this.eval(e.e);
    let idx = yield* this.eval(e.i);
    if (base.k !== "ptr" && idx.k === "ptr") [base, idx] = [idx, base];
    if (base.k !== "ptr") throw new CError("Indexation [ ] d'une valeur qui n'est ni un tableau ni un pointeur", e.line);
    const n = Math.trunc(toNumber(idx));
    const o = base.o + n;
    const t = base.t && !(base.t.base === "void" && base.t.ptr === 0) ? base.t : (base.b?.elem ?? INT);
    return { b: base.b, o, t, label: base.b ? cellLabel(base.b, o) : `NULL[${n}]` };
  }

  private *eval(e: Expr): Gen<Value> {
    switch (e.k) {
      case "num": {
        if (e.float) return mkFloat(e.v);
        const v: Value = { k: "int", v: e.v };
        if (e.long || e.v > 2147483647 || e.v < -2147483648) v.l = true;
        if (e.unsigned) v.u = true;
        return v;
      }
      case "str":
        return { k: "ptr", b: this.strBlock(e), o: 0, t: CHAR };
      case "id": {
        const bind = this.lookup(e.name);
        if (bind) {
          if (bind.isArray) return { k: "ptr", b: bind.block, o: 0, t: bind.block.elem };
          return this.read({ b: bind.block, o: 0, t: bind.type, label: e.name }, e.line);
        }
        if (this.prog.funcs.has(e.name)) return { k: "fn", name: e.name };
        if (e.name === "errno") return mkInt(this.errno);
        const c = CONSTS[e.name];
        if (c) return c;
        if (BUILTIN_NAMES.has(e.name)) return { k: "fn", name: e.name };
        throw new CError(`« ${e.name} » n'est pas déclarée`, e.line);
      }
      case "unary": {
        if (e.op === "&") {
          if (e.e.k === "id") {
            const bind = this.lookup(e.e.name);
            if (!bind && this.prog.funcs.has(e.e.name)) return { k: "fn", name: e.e.name };
            if (bind?.isArray) return { k: "ptr", b: bind.block, o: 0, t: bind.block.elem };
          }
          const lv = yield* this.lvalue(e.e);
          return { k: "ptr", b: lv.b, o: lv.o, t: lv.t };
        }
        if (e.op === "*") {
          const p = yield* this.eval(e.e);
          if (p.k === "fn") return p;
          return this.read(this.ptrLv(p, e.line), e.line);
        }
        const v = yield* this.eval(e.e);
        switch (e.op) {
          case "!":
            return mkInt(truthy(v) ? 0 : 1);
          case "+":
            return v;
          case "-":
            if (v.k === "float") return mkFloat(-v.v);
            if (v.k === "int") return this.normInt(-v.v, !!v.u, !!v.l);
            throw new CError("Opposé (-) d'un pointeur", e.line);
          case "~":
            if (v.k !== "int") throw new CError("L'opérateur ~ n'accepte que des entiers", e.line);
            return this.normInt(v.l ? -v.v - 1 : ~v.v, !!v.u, !!v.l);
        }
        break;
      }
      case "update": {
        const lv = yield* this.lvalue(e.e);
        const old = this.read(lv, e.line);
        const delta = e.op === "++" ? 1 : -1;
        let nv: Value;
        if (old.k === "ptr") nv = { ...old, o: old.o + delta };
        else if (old.k === "float") nv = mkFloat(old.v + delta);
        else nv = this.binop("+", old, mkInt(delta), e.line);
        const stored = this.store(lv, nv, e.line);
        return e.prefix ? stored : old;
      }
      case "bin": {
        const a = yield* this.eval(e.l);
        const b = yield* this.eval(e.r);
        return this.binop(e.op, a, b, e.line);
      }
      case "logic": {
        const l = truthy(yield* this.eval(e.l));
        if (e.op === "&&") {
          if (!l) return mkInt(0);
          return mkInt(truthy(yield* this.eval(e.r)) ? 1 : 0);
        }
        if (l) return mkInt(1);
        return mkInt(truthy(yield* this.eval(e.r)) ? 1 : 0);
      }
      case "assign": {
        const lv = yield* this.lvalue(e.l);
        let v = yield* this.eval(e.r);
        if (e.op !== "=") v = this.binop(e.op.slice(0, -1), this.read(lv, e.line), v, e.line);
        return this.store(lv, v, e.line);
      }
      case "cond":
        return truthy(yield* this.eval(e.c)) ? yield* this.eval(e.a) : yield* this.eval(e.b);
      case "comma":
        yield* this.eval(e.l);
        return yield* this.eval(e.r);
      case "call":
        return yield* this.evalCall(e);
      case "index":
        return this.read(yield* this.indexLv(e), e.line);
      case "cast": {
        const v = yield* this.eval(e.e);
        if (e.type.base === "void" && e.type.ptr === 0) return VOID;
        return coerce(v, e.type);
      }
      case "sizeof": {
        const n = e.type ? this.sizeOfType(e.type) : this.sizeOfExpr(e.e!);
        return { k: "int", v: n, u: true, l: true };
      }
      case "init":
        throw new CError("Liste d'initialisation { ... } inattendue ici", e.line);
    }
    throw new CError("Expression non prise en charge", (e as { line: number }).line);
  }

  private normInt(r: number, u: boolean, l: boolean): Value {
    if (!l) r = u ? r >>> 0 : r | 0;
    const v: Value = { k: "int", v: r };
    if (u) v.u = true;
    if (l) v.l = true;
    return v;
  }

  private binop(op: string, a0: Value, b0: Value, line: number): Value {
    const a = a0.k === "undef" ? mkInt(0) : a0;
    const b = b0.k === "undef" ? mkInt(0) : b0;
    const cmp = op === "==" || op === "!=" || op === "<" || op === ">" || op === "<=" || op === ">=";
    const compare = (x: number, y: number) => {
      switch (op) {
        case "==": return x === y;
        case "!=": return x !== y;
        case "<": return x < y;
        case ">": return x > y;
        case "<=": return x <= y;
        default: return x >= y;
      }
    };
    if (a.k === "ptr" || b.k === "ptr" || a.k === "fn" || b.k === "fn") {
      if (cmp) {
        const key = (v: Value) => (v.k === "fn" ? 1 : toNumber(v));
        return mkInt(compare(key(a), key(b)) ? 1 : 0);
      }
      if (op === "+" && a.k === "ptr" && b.k === "int") return { ...a, o: a.o + b.v };
      if (op === "+" && b.k === "ptr" && a.k === "int") return { ...b, o: b.o + a.v };
      if (op === "-" && a.k === "ptr" && b.k === "int") return { ...a, o: a.o - b.v };
      if (op === "-" && a.k === "ptr" && b.k === "ptr") return { k: "int", v: a.o - b.o, l: true };
      throw new CError(`Opération « ${op} » invalide avec un pointeur`, line);
    }
    if (a.k === "void" || b.k === "void") throw new CError("Utilisation de la valeur d'une fonction void", line);
    if (cmp) {
      let x = toNumber(a);
      let y = toNumber(b);
      if (a.k === "int" && b.k === "int" && (a.u || b.u) && !(a.l || b.l)) {
        x = x >>> 0;
        y = y >>> 0;
      }
      return mkInt(compare(x, y) ? 1 : 0);
    }
    if (a.k === "float" || b.k === "float") {
      const x = toNumber(a);
      const y = toNumber(b);
      switch (op) {
        case "+": return mkFloat(x + y);
        case "-": return mkFloat(x - y);
        case "*": return mkFloat(x * y);
        case "/": return mkFloat(x / y);
        default: throw new CError(`L'opérateur « ${op} » n'accepte pas de nombres réels`, line);
      }
    }
    if (a.k !== "int" || b.k !== "int") throw new CError(`Opération « ${op} » invalide`, line);
    const x = a.v;
    const y = b.v;
    const u = !!(a.u || b.u);
    const l = !!(a.l || b.l);
    let r: number;
    switch (op) {
      case "+": r = x + y; break;
      case "-": r = x - y; break;
      case "*": r = l ? x * y : Math.imul(x, y); break;
      case "/":
        if (y === 0) throw new CRuntimeError("Division entière par zéro", line, SIG.SIGFPE);
        r = Math.trunc(x / y);
        break;
      case "%":
        if (y === 0) throw new CRuntimeError("Modulo par zéro", line, SIG.SIGFPE);
        r = x % y;
        break;
      case "<<": r = l ? x * 2 ** (y & 63) : x << (y & 31); break;
      case ">>": r = l ? Math.floor(x / 2 ** (y & 63)) : u ? x >>> (y & 31) : x >> (y & 31); break;
      case "&": r = x & y; break;
      case "|": r = x | y; break;
      case "^": r = x ^ y; break;
      default: throw new CError(`Opérateur « ${op} » inconnu`, line);
    }
    return this.normInt(r, u, l);
  }

  private staticType(e: Expr): { t: CType; dims: number[] } {
    switch (e.k) {
      case "id": {
        const b = this.lookup(e.name);
        return b ? { t: b.type, dims: b.dims } : { t: INT, dims: [] };
      }
      case "index":
      case "unary": {
        if (e.k === "unary" && e.op !== "*") {
          if (e.op === "&") {
            const s = this.staticType(e.e);
            return { t: { ...s.t, ptr: s.t.ptr + 1 }, dims: [] };
          }
          return this.staticType(e.e);
        }
        const s = this.staticType(e.e);
        if (s.dims.length > 0) return { t: s.t, dims: s.dims.slice(1) };
        return { t: { ...s.t, ptr: Math.max(0, s.t.ptr - 1) }, dims: [] };
      }
      case "str":
        return { t: CHAR, dims: [e.v.length + 1] };
      case "num":
        return { t: e.float ? DOUBLE : e.long ? { ...INT, base: "long" } : INT, dims: [] };
      case "cast":
        return { t: e.type, dims: [] };
      case "call": {
        const fn = e.callee.k === "id" ? this.prog.funcs.get(e.callee.name) : undefined;
        return { t: fn ? fn.ret : INT, dims: [] };
      }
      default:
        return { t: INT, dims: [] };
    }
  }

  private sizeOfType(t: CType): number {
    let n = scalarSize(t);
    for (const d of t.dims) n *= d && d.k === "num" ? d.v : 1;
    return n;
  }

  private sizeOfExpr(e: Expr): number {
    const s = this.staticType(e);
    return scalarSize(s.t) * s.dims.reduce((a, b) => a * b, 1);
  }

  // ── calls ─────────────────────────────────────────────────────────────
  private *evalCall(e: CallExpr): Gen<Value> {
    let name: string | null = null;
    if (e.callee.k === "id" && !this.lookup(e.callee.name)) name = e.callee.name;
    else {
      const callee = yield* this.eval(e.callee);
      if (callee.k === "fn") name = callee.name;
    }
    if (!name) throw new CError("Appel d'une valeur qui n'est pas une fonction", e.line);
    const fn = this.prog.funcs.get(name);
    // gcc (x86-64) evaluates call arguments from right to left: reproduce it
    // so that side effects such as printf("%d %d", rand(), rand()) match.
    const args: Value[] = new Array<Value>(e.args.length);
    for (let i = e.args.length - 1; i >= 0; i--) args[i] = yield* this.eval(e.args[i]!);
    if (fn) return yield* this.callFunction(fn, args, e.line);
    if (BUILTIN_NAMES.has(name)) return yield* this.builtin(name, args, e);
    throw new CError(`Fonction « ${name}() » inconnue : elle n'est ni définie dans le fichier ni simulée par le moteur`, e.line);
  }

  private *flushStdout(reason: string): Gen<void> {
    if (!this.stdoutBuf) return;
    const data = this.stdoutBuf;
    this.stdoutBuf = "";
    this.note(`${reason} vide le tampon de stdout : « ${escapeText(data)} » part vers la sortie`);
    yield* this.sys({ name: "write", fd: 1, data, via: "flush" });
  }

  private *writeStdout(text: string, via: string): Gen<void> {
    if (!text) return;
    if (!this.bufDecided) {
      this.bufDecided = true;
      if (this.bufMode === "line") {
        const tty = yield* this.sys({ name: "isatty", fd: 1 });
        if (tty.ret === 0) {
          this.bufMode = "full";
          this.note("stdout n'est pas un terminal (redirigé) : la glibc passe en tampon COMPLET, il n'est plus vidé à chaque \\n");
        }
      }
    }
    if (this.bufMode === "none") {
      yield* this.sys({ name: "write", fd: 1, data: text, via });
      return;
    }
    this.stdoutBuf += text;
    if (this.bufMode === "line") {
      const idx = this.stdoutBuf.lastIndexOf("\n");
      if (idx >= 0) {
        const chunk = this.stdoutBuf.slice(0, idx + 1);
        this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
        yield* this.sys({ name: "write", fd: 1, data: chunk, via });
      }
    } else if (this.stdoutBuf.length >= 4096) {
      const chunk = this.stdoutBuf;
      this.stdoutBuf = "";
      yield* this.sys({ name: "write", fd: 1, data: chunk, via });
    }
    if (this.stdoutBuf) {
      this.note(
        `« ${escapeText(this.stdoutBuf)} » reste dans le tampon de stdout (${this.bufMode === "line" ? "pas encore de \\n" : "tampon complet"}) : rien n'est encore affiché`,
      );
    }
  }

  /** glibc flushes line-buffered stdout before reading from stdin. */
  private *flushBeforeInput(): Gen<void> {
    if (this.bufMode === "line" && this.stdoutBuf) yield* this.flushStdout("La lecture sur stdin");
  }

  *exitProcess(code: number, how: "exit" | "_exit" | "return"): Gen<void> {
    let lost = "";
    if (how === "_exit") {
      lost = this.stdoutBuf;
      if (lost) this.note(`_exit() ne vide PAS le tampon stdout : « ${escapeText(lost)} » est perdu`);
    } else {
      yield* this.flushStdout(how === "return" ? "La fin de main()" : "exit()");
    }
    yield* this.sys({ name: "exit", code, how, lost });
    throw new Error("Le processus a repris après exit()");
  }

  private *doWait(pid: number, statusPtr: Value | undefined, options: number, fn: string, line: number): Gen<Value> {
    const r = yield* this.sys({ name: "wait", pid, options, fn });
    if (r.ret > 0 && statusPtr && statusPtr.k === "ptr" && statusPtr.b) {
      this.store(this.ptrLv(statusPtr, line), mkInt(r.status ?? 0), line);
    }
    if (r.ret > 0) {
      const st = r.status ?? 0;
      const decoded = (st & 0x7f) === 0
        ? `WIFEXITED vrai, WEXITSTATUS = ${(st >> 8) & 0xff}`
        : `WIFSIGNALED vrai, WTERMSIG = ${st & 0x7f} (${signalName(st & 0x7f)})`;
      this.note(`${fn}() a renvoyé ${r.ret} : le fils ${r.ret} est récupéré (status = ${st} → ${decoded})`);
    }
    else if (r.ret === 0) this.note(`${fn}() avec WNOHANG : aucun fils terminé pour l'instant, renvoie 0 sans bloquer`);
    else this.note(`${fn}() a renvoyé -1 : ${r.errno === ERRNO.EINTR ? "interrompu par un signal (EINTR)" : "aucun fils à attendre (ECHILD)"}`);
    return mkInt(r.ret);
  }

  private stringArgs(args: Value[], from: number, line: number): string[] {
    const out: string[] = [];
    for (let i = from; i < args.length; i++) {
      const a = args[i]!;
      if (a.k === "ptr" && !a.b) break;
      if (a.k === "int" && a.v === 0) break;
      out.push(this.cstr(a, line));
    }
    return out;
  }

  private arrayOfStrings(v: Value | undefined, line: number): string[] {
    if (!v || v.k !== "ptr" || !v.b) return [];
    const out: string[] = [];
    for (let i = v.o; i < v.b.cells.length; i++) {
      const c = v.b.cells[i]!;
      if (c.k !== "ptr" || !c.b) break;
      out.push(this.cstr(c, line));
    }
    return out;
  }

  private *builtin(name: string, args: Value[], call: CallExpr): Gen<Value> {
    const line = call.line;
    const num = (i: number) => toNumber(args[i] ?? mkInt(0));
    const int = (i: number) => Math.trunc(num(i));
    const isStream = (v: Value | undefined, b: Block) => v?.k === "ptr" && v.b === b;

    switch (name) {
      // ── processes ──────────────────────────────────────────────────
      case "fork":
      case "vfork": {
        const r = yield* this.sys({ name: "fork" });
        if (r.ret === 0) this.note("fork() a renvoyé 0 : ce processus est le FILS");
        else if (r.ret > 0) this.note(`fork() a renvoyé ${r.ret} : ce processus est le PÈRE (${r.ret} = PID du fils créé)`);
        else this.note("fork() a échoué et renvoyé -1 (trop de processus)");
        return mkInt(r.ret);
      }
      case "getpid":
        return mkInt((yield* this.sys({ name: "getpid" })).ret);
      case "getppid":
        return mkInt((yield* this.sys({ name: "getppid" })).ret);
      case "getpgrp":
      case "getpgid":
        return mkInt((yield* this.sys({ name: "getpgrp" })).ret);
      case "getuid":
      case "geteuid":
        return mkInt(1000);
      case "wait":
        return yield* this.doWait(-1, args[0], 0, "wait", line);
      case "waitpid":
        return yield* this.doWait(int(0), args[1], int(2), "waitpid", line);
      case "exit":
        yield* this.exitProcess(int(0), "exit");
        return VOID;
      case "_exit":
      case "_Exit":
        yield* this.exitProcess(int(0), "_exit");
        return VOID;
      case "abort":
        yield* this.sys({ name: "raise", sig: SIG.SIGABRT });
        yield* this.exitProcess(134, "_exit");
        return VOID;
      case "sleep": {
        const n = Math.max(0, int(0));
        const r = yield* this.sys({ name: "sleep", ms: n * 1000, label: `sleep(${n})` });
        return mkInt(r.ret);
      }
      case "usleep": {
        const us = Math.max(0, int(0));
        const r = yield* this.sys({ name: "sleep", ms: Math.round(us / 1000), label: `usleep(${us})` });
        return mkInt(r.ret < 0 ? -1 : 0);
      }
      case "pause":
        return mkInt((yield* this.sys({ name: "pause" })).ret);
      case "alarm":
        return mkInt((yield* this.sys({ name: "alarm", sec: int(0) })).ret);
      case "kill":
        return mkInt((yield* this.sys({ name: "kill", pid: int(0), sig: int(1) })).ret);
      case "raise":
        return mkInt((yield* this.sys({ name: "raise", sig: int(0) })).ret);
      case "signal": {
        const h = args[1];
        const handler = h?.k === "fn" ? h.name : toNumber(h ?? mkInt(0)) === 1 ? "IGN" : "DFL";
        const r = yield* this.sys({ name: "signal", sig: int(0), handler });
        return mkInt(r.ret);
      }
      case "execl":
      case "execlp":
      case "execle":
      case "execv":
      case "execvp":
      case "execve": {
        const path = this.cstr(args[0], line);
        const argv = name === "execl" || name === "execlp" || name === "execle" ? this.stringArgs(args, 1, line) : this.arrayOfStrings(args[1], line);
        const r = yield* this.sys({ name: "exec", fn: name, path, argv: argv.length ? argv : [path], lost: this.stdoutBuf });
        return mkInt(r.ret);
      }
      case "system": {
        const r = yield* this.sys({ name: "system", cmd: this.cstr(args[0], line) });
        return mkInt(r.status ?? r.ret);
      }
      case "WIFEXITED":
        return mkInt((int(0) & 0x7f) === 0 ? 1 : 0);
      case "WEXITSTATUS":
        return mkInt((int(0) >> 8) & 0xff);
      case "WIFSIGNALED": {
        const s = int(0) & 0x7f;
        return mkInt(s !== 0 && s !== 0x7f ? 1 : 0);
      }
      case "WTERMSIG":
        return mkInt(int(0) & 0x7f);
      case "WCOREDUMP":
        return mkInt(int(0) & 0x80 ? 1 : 0);
      case "WIFSTOPPED":
        return mkInt((int(0) & 0xff) === 0x7f ? 1 : 0);
      case "WSTOPSIG":
        return mkInt((int(0) >> 8) & 0xff);
      case "WIFCONTINUED":
        return mkInt(int(0) === 0xffff ? 1 : 0);

      // ── stdio ──────────────────────────────────────────────────────
      case "printf": {
        const s = formatPrintf(this.cstr(args[0], line), args.slice(1), this.fmtCtx(line));
        yield* this.writeStdout(s, "printf");
        return mkInt(s.length);
      }
      case "puts": {
        const s = this.cstr(args[0], line) + "\n";
        yield* this.writeStdout(s, "puts");
        return mkInt(s.length);
      }
      case "putchar": {
        yield* this.writeStdout(String.fromCharCode(int(0) & 0xff), "putchar");
        return mkInt(int(0) & 0xff);
      }
      case "fprintf":
      case "fputs":
      case "fputc":
      case "putc": {
        const streamArg = name === "fprintf" ? args[0] : args[1];
        let s: string;
        if (name === "fprintf") s = formatPrintf(this.cstr(args[1], line), args.slice(2), this.fmtCtx(line));
        else if (name === "fputs") s = this.cstr(args[0], line);
        else s = String.fromCharCode(int(0) & 0xff);
        if (isStream(streamArg, STDERR_BLOCK)) yield* this.sys({ name: "write", fd: 2, data: s, via: name });
        else if (isStream(streamArg, STDOUT_BLOCK)) yield* this.writeStdout(s, name);
        else throw new CError(`${name}() : seuls les flux stdout et stderr sont simulés (pas de fichiers)`, line);
        return mkInt(name === "fputc" || name === "putc" ? int(0) : s.length);
      }
      case "fflush": {
        const a = args[0];
        if (!a || isStream(a, STDOUT_BLOCK) || (a.k === "ptr" && !a.b) || (a.k === "int" && a.v === 0)) yield* this.flushStdout("fflush()");
        return mkInt(0);
      }
      case "setbuf":
      case "setvbuf": {
        if (isStream(args[0], STDOUT_BLOCK)) {
          const mode = name === "setbuf" ? (args[1]?.k === "ptr" && !args[1].b ? 2 : 0) : int(2);
          this.bufMode = mode === 2 ? "none" : mode === 1 ? "line" : "full";
          this.bufDecided = true;
          this.note(`stdout passe en mode ${this.bufMode === "none" ? "NON bufferisé (chaque printf est affiché tout de suite)" : this.bufMode === "line" ? "tampon par ligne" : "tampon complet"}`);
        }
        return mkInt(0);
      }
      case "perror": {
        const prefix = args[0] && args[0].k === "ptr" && args[0].b ? this.cstr(args[0], line) : "";
        const msg = `${prefix ? prefix + ": " : ""}${errnoText(this.errno)}\n`;
        yield* this.sys({ name: "write", fd: 2, data: msg, via: "perror" });
        return VOID;
      }
      case "strerror":
        return { k: "ptr", b: this.makeString(errnoText(int(0)), true), o: 0, t: CHAR };
      case "sprintf": {
        const s = formatPrintf(this.cstr(args[1], line), args.slice(2), this.fmtCtx(line));
        this.writeCStr(args[0], s, line, "sprintf");
        return mkInt(s.length);
      }
      case "snprintf": {
        const n = int(1);
        const s = formatPrintf(this.cstr(args[2], line), args.slice(3), this.fmtCtx(line));
        if (n > 0) this.writeCStr(args[0], s.slice(0, n - 1), line, "snprintf");
        return mkInt(s.length);
      }
      case "scanf": {
        const fmt = this.cstr(args[0], line);
        yield* this.flushBeforeInput();
        const r = yield* this.sys({ name: "stdin", op: "scanf", fmt });
        (r.values ?? []).forEach((v, i) => {
          const dst = args[i + 1];
          if (!dst || dst.k !== "ptr") {
            this.warn("scanf : il manque « & » devant la variable (un pointeur est attendu)", line);
            return;
          }
          if (typeof v.value === "string") {
            if (v.conv === "c") this.store(this.ptrLv(dst, line), mkInt(v.value.charCodeAt(0) || 0), line);
            else this.writeCStr(dst, v.value, line, "scanf");
          } else {
            this.store(this.ptrLv(dst, line), v.conv === "f" ? mkFloat(v.value) : mkInt(v.value), line);
          }
        });
        return mkInt(r.ret);
      }
      case "getchar":
        yield* this.flushBeforeInput();
        return mkInt((yield* this.sys({ name: "stdin", op: "getchar" })).ret);
      case "fgets":
      case "gets": {
        const max = name === "fgets" ? int(1) : 4096;
        yield* this.flushBeforeInput();
        const r = yield* this.sys({ name: "stdin", op: "fgets", max });
        if (r.data === null || r.data === undefined) return NULLPTR;
        this.writeCStr(args[0], name === "gets" ? r.data.replace(/\n$/, "") : r.data, line, name);
        return args[0] ?? NULLPTR;
      }

      // ── low-level I/O ──────────────────────────────────────────────
      case "write": {
        const data = this.readBytes(args[1], Math.max(0, int(2)), line);
        return mkInt((yield* this.sys({ name: "write", fd: int(0), data, via: "write" })).ret);
      }
      case "read": {
        const max = Math.max(0, int(2));
        const r = yield* this.sys({ name: "read", fd: int(0), max });
        if (r.ret > 0 && r.data) {
          const dst = args[1];
          if (!dst || dst.k !== "ptr") throw new CError("read() : un tampon est attendu", line);
          const b = this.checkAccess(dst.b, dst.o, line, true);
          if (dst.o + r.data.length > b.cells.length) {
            throw new CRuntimeError(`read() : débordement, ${r.data.length} octets dans ${b.name}[${b.cells.length}]`, line, SIG.SIGSEGV);
          }
          for (let i = 0; i < r.data.length; i++) b.cells[dst.o + i] = coerce(mkInt(r.data.charCodeAt(i)), b.elem);
          this.dirty.add(b);
          this.note(`read() a lu ${r.ret} octet(s) : « ${escapeText(r.data)} »`);
        } else if (r.ret === 0) {
          this.note("read() renvoie 0 : fin de fichier (plus aucun écrivain sur le tube)");
        }
        return mkInt(r.ret);
      }
      case "isatty":
        return mkInt((yield* this.sys({ name: "isatty", fd: int(0) })).ret);
      case "pipe": {
        const r = yield* this.sys({ name: "pipe" });
        if (r.ret === 0 && r.fds) {
          const dst = args[0];
          if (!dst || dst.k !== "ptr") throw new CError("pipe() attend un tableau int fd[2]", line);
          const lv0 = this.ptrLv(dst, line);
          this.store(lv0, mkInt(r.fds[0]), line);
          this.store({ ...lv0, o: lv0.o + 1, label: dst.b ? cellLabel(dst.b, dst.o + 1) : "fd[1]" }, mkInt(r.fds[1]), line);
        }
        return mkInt(r.ret);
      }
      case "close":
        return mkInt((yield* this.sys({ name: "close", fd: int(0) })).ret);
      case "dup":
        return mkInt((yield* this.sys({ name: "dup", fd: int(0) })).ret);
      case "dup2":
        return mkInt((yield* this.sys({ name: "dup2", fd: int(0), fd2: int(1) })).ret);

      // ── strings ────────────────────────────────────────────────────
      case "strlen":
        return { k: "int", v: this.cstr(args[0], line).length, u: true, l: true };
      case "strcpy":
      case "strncpy": {
        let s = this.cstr(args[1], line);
        if (name === "strncpy") s = s.slice(0, int(2));
        this.writeCStr(args[0], s, line, name);
        return args[0] ?? NULLPTR;
      }
      case "strcat":
      case "strncat": {
        const dst = this.cstr(args[0], line);
        let s = this.cstr(args[1], line);
        if (name === "strncat") s = s.slice(0, int(2));
        const d = args[0]!;
        this.writeCStr(d.k === "ptr" ? { ...d, o: d.o } : d, dst + s, line, name);
        return args[0] ?? NULLPTR;
      }
      case "strcmp":
      case "strncmp": {
        let a = this.cstr(args[0], line);
        let b = this.cstr(args[1], line);
        if (name === "strncmp") {
          a = a.slice(0, int(2));
          b = b.slice(0, int(2));
        }
        return mkInt(a === b ? 0 : a < b ? -1 : 1);
      }
      case "strchr":
      case "strrchr": {
        const p = args[0];
        const s = this.cstr(p, line);
        const ch = String.fromCharCode(int(1) & 0xff);
        const i = int(1) === 0 ? s.length : name === "strchr" ? s.indexOf(ch) : s.lastIndexOf(ch);
        return i < 0 || p?.k !== "ptr" ? NULLPTR : { ...p, o: p.o + i };
      }
      case "strstr": {
        const p = args[0];
        const i = this.cstr(p, line).indexOf(this.cstr(args[1], line));
        return i < 0 || p?.k !== "ptr" ? NULLPTR : { ...p, o: p.o + i };
      }
      case "strdup": {
        const s = this.cstr(args[0], line);
        const b = this.makeString(s, false);
        b.kind = "heap";
        b.name = `tas#${b.id}`;
        this.heap.push(b);
        return { k: "ptr", b, o: 0, t: CHAR };
      }
      case "memset": {
        const p = args[0];
        if (!p || p.k !== "ptr") throw new CError("memset() attend un pointeur", line);
        const b = this.checkAccess(p.b, p.o, line, true);
        const size = scalarSize(b.elem);
        const count = Math.ceil(int(2) / size);
        for (let i = 0; i < count; i++) {
          if (p.o + i >= b.cells.length) throw new CRuntimeError("memset() déborde de la zone mémoire", line, SIG.SIGSEGV);
          b.cells[p.o + i] = coerce(mkInt(size === 1 ? int(1) : int(1) === 0 ? 0 : int(1) * 0x01010101), b.elem);
        }
        this.dirty.add(b);
        return p;
      }
      case "memcpy": {
        const d = args[0];
        const s = args[1];
        if (!d || d.k !== "ptr" || !s || s.k !== "ptr") throw new CError("memcpy() attend deux pointeurs", line);
        const db = this.checkAccess(d.b, d.o, line, true);
        const sb = this.checkAccess(s.b, s.o, line, false);
        const count = Math.ceil(int(2) / scalarSize(db.elem));
        for (let i = 0; i < count; i++) {
          const v = sb.cells[s.o + i];
          if (v === undefined || d.o + i >= db.cells.length) throw new CRuntimeError("memcpy() déborde", line, SIG.SIGSEGV);
          db.cells[d.o + i] = v;
        }
        this.dirty.add(db);
        return d;
      }

      // ── conversions & maths ────────────────────────────────────────
      case "atoi":
      case "atol":
      case "strtol": {
        const s = this.cstr(args[0], line).trim();
        const m = s.match(/^[+-]?\d+/);
        return mkInt(m ? parseInt(m[0], name === "strtol" && args[2] ? int(2) || 10 : 10) | 0 : 0);
      }
      case "atof": {
        const n = parseFloat(this.cstr(args[0], line));
        return mkFloat(Number.isNaN(n) ? 0 : n);
      }
      case "abs":
      case "labs":
        return mkInt(Math.abs(int(0)));
      case "fabs":
        return mkFloat(Math.abs(num(0)));
      case "sqrt":
        return mkFloat(Math.sqrt(num(0)));
      case "pow":
        return mkFloat(Math.pow(num(0), num(1)));
      case "floor":
        return mkFloat(Math.floor(num(0)));
      case "ceil":
        return mkFloat(Math.ceil(num(0)));
      case "round":
        return mkFloat(Math.sign(num(0)) * Math.round(Math.abs(num(0))));
      case "exp":
        return mkFloat(Math.exp(num(0)));
      case "log":
        return mkFloat(Math.log(num(0)));
      case "log10":
        return mkFloat(Math.log10(num(0)));
      case "sin":
        return mkFloat(Math.sin(num(0)));
      case "cos":
        return mkFloat(Math.cos(num(0)));
      case "tan":
        return mkFloat(Math.tan(num(0)));
      case "fmax":
        return mkFloat(Math.max(num(0), num(1)));
      case "fmin":
        return mkFloat(Math.min(num(0), num(1)));
      case "rand":
        return mkInt(this.rand.next());
      case "srand":
        this.rand.seed(int(0));
        this.note(`srand(${int(0)}) : nouvelle graine pour rand()`);
        return VOID;
      case "time": {
        const r = yield* this.sys({ name: "time" });
        const p = args[0];
        if (p && p.k === "ptr" && p.b) this.store(this.ptrLv(p, line), { k: "int", v: r.ret, l: true }, line);
        return { k: "int", v: r.ret, l: true };
      }
      case "clock":
        return { k: "int", v: (yield* this.sys({ name: "clock" })).ret, l: true };
      case "malloc":
      case "calloc": {
        const bytes = name === "malloc" ? int(0) : int(0) * int(1);
        if (bytes <= 0 || bytes > 1_000_000) return NULLPTR;
        const cells: Value[] = [];
        for (let i = 0; i < bytes; i++) cells.push(name === "calloc" ? mkInt(0) : UNDEF);
        const b = this.newBlock("", "heap", cells, CHAR);
        b.name = `tas#${b.id}`;
        b.line = line;
        this.heap.push(b);
        this.note(`${name}(${bytes}) réserve ${bytes} octets sur le tas (${b.name})`);
        return { k: "ptr", b, o: 0 };
      }
      case "realloc": {
        const p = args[0];
        const bytes = int(1);
        const cells: Value[] = [];
        for (let i = 0; i < bytes; i++) cells.push(UNDEF);
        const nb = this.newBlock("", "heap", cells, p?.k === "ptr" && p.b ? p.b.elem : CHAR);
        nb.name = `tas#${nb.id}`;
        if (p?.k === "ptr" && p.b) {
          const size = scalarSize(p.b.elem);
          nb.cells.length = Math.max(1, Math.floor(bytes / size));
          for (let i = 0; i < nb.cells.length; i++) nb.cells[i] = p.b.cells[i] ?? UNDEF;
          p.b.freed = true;
        }
        this.heap.push(nb);
        return { k: "ptr", b: nb, o: 0, t: p?.k === "ptr" ? p.t : undefined };
      }
      case "free": {
        const p = args[0];
        if (!p || p.k !== "ptr" || !p.b) return VOID;
        if (p.b.kind !== "heap" || p.o !== 0) {
          throw new CRuntimeError("free() d'un pointeur qui ne vient pas de malloc() : free(): invalid pointer", line, SIG.SIGABRT);
        }
        if (p.b.freed) throw new CRuntimeError("free() appelé deux fois sur la même zone : double free detected", line, SIG.SIGABRT);
        p.b.freed = true;
        this.note(`free() libère ${p.b.name}`);
        return VOID;
      }
      case "isdigit":
        return mkInt(/[0-9]/.test(String.fromCharCode(int(0))) ? 1 : 0);
      case "isalpha":
        return mkInt(/[A-Za-z]/.test(String.fromCharCode(int(0))) ? 1 : 0);
      case "isalnum":
        return mkInt(/[A-Za-z0-9]/.test(String.fromCharCode(int(0))) ? 1 : 0);
      case "isspace":
        return mkInt(/[ \t\n\r\f\v]/.test(String.fromCharCode(int(0))) ? 1 : 0);
      case "isupper":
        return mkInt(/[A-Z]/.test(String.fromCharCode(int(0))) ? 1 : 0);
      case "islower":
        return mkInt(/[a-z]/.test(String.fromCharCode(int(0))) ? 1 : 0);
      case "toupper":
        return mkInt(String.fromCharCode(int(0)).toUpperCase().charCodeAt(0));
      case "tolower":
        return mkInt(String.fromCharCode(int(0)).toLowerCase().charCodeAt(0));
      case "assert": {
        if (!truthy(args[0] ?? mkInt(0))) {
          const src = this.prog.source.slice(0).split("\n")[line - 1]?.trim() ?? "";
          const msg = `${this.opts.progName}: Assertion « ${src.replace(/^assert\s*\(|\);?$/g, "")} » failed.\n`;
          yield* this.sys({ name: "write", fd: 2, data: msg, via: "assert" });
          yield* this.sys({ name: "raise", sig: SIG.SIGABRT });
        }
        return VOID;
      }
    }
    throw new CError(`Fonction « ${name}() » non simulée`, line);
  }
}
