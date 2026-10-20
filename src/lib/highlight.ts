// Small, dependency-free syntax highlighter shared by the code editor, the file
// viewer and the process simulator. It tokenizes line by line and carries only
// the state that can span lines (block comments, triple-quoted and template
// strings), so a 5 000-line file highlights in a few milliseconds.

export type Lang = "c" | "cpp" | "python" | "js" | "ts" | "json" | "shell" | "markdown" | "plain";
export type TokClass = "kw" | "type" | "str" | "num" | "com" | "pre" | "sys" | "fn";

export interface Tok {
  t: string;
  c?: TokClass;
}

export const TOKEN_STYLE: Record<TokClass, string> = {
  kw: "text-[var(--syn-kw)]",
  type: "text-[var(--syn-type)]",
  str: "text-[var(--syn-str)]",
  num: "text-[var(--syn-num)]",
  com: "text-[var(--syn-com)] italic",
  pre: "text-[var(--syn-pre)]",
  sys: "text-[var(--syn-sys)] font-semibold",
  fn: "text-[var(--syn-fn)]",
};

export const LANG_LABEL: Record<Lang, string> = {
  c: "C",
  cpp: "C++",
  python: "Python",
  js: "JavaScript",
  ts: "TypeScript",
  json: "JSON",
  shell: "Shell",
  markdown: "Markdown",
  plain: "Texte",
};

const EXT_LANG: Record<string, Lang> = {
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  ino: "cpp",
  py: "python",
  pyw: "python",
  js: "js",
  mjs: "js",
  cjs: "js",
  jsx: "js",
  ts: "ts",
  tsx: "ts",
  mts: "ts",
  json: "json",
  jsonc: "json",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  md: "markdown",
  markdown: "markdown",
};

export function languageFromFileName(name: string): Lang {
  const lower = name.toLowerCase();
  if (lower === "makefile" || lower === "dockerfile" || lower.endsWith(".bashrc") || lower === ".profile") return "shell";
  const dot = lower.lastIndexOf(".");
  return dot < 0 ? "plain" : (EXT_LANG[lower.slice(dot + 1)] ?? "plain");
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

// ─── C / C++ (also used by the process simulator) ─────────────────────────────

const C_KW = words(`if else while for do return switch case default break continue sizeof static const struct typedef
  enum goto extern volatile register union inline`);
const CPP_KW = words(`${[...C_KW].join(" ")} class public private protected namespace template typename new delete this
  virtual override using try catch throw nullptr auto constexpr noexcept operator friend explicit mutable true false
  static_cast dynamic_cast reinterpret_cast const_cast`);
const C_TYPES = words(`int char void long short float double unsigned signed pid_t size_t ssize_t bool FILE time_t
  uint8_t int32_t uint32_t int64_t uint64_t`);
const CPP_TYPES = words(`${[...C_TYPES].join(" ")} string vector map set unordered_map std wchar_t`);
const C_SYS = words(`fork vfork wait waitpid exit _exit sleep usleep pipe dup dup2 close read write kill signal pause
  alarm execl execlp execv execvp execve execle getpid getppid system raise abort`);

function highlightC(code: string, kw: Set<string>, types: Set<string>): Tok[][] {
  const lines = code.split("\n");
  let inComment = false;
  return lines.map((line) => {
    const toks: Tok[] = [];
    const push = (t: string, c?: TokClass) => {
      if (!t) return;
      const last = toks[toks.length - 1];
      if (last && last.c === c) last.t += t;
      else toks.push({ t, c });
    };
    let i = 0;
    if (!inComment && /^\s*#/.test(line)) {
      const m = line.match(/^(\s*#\s*\w+)(.*)$/);
      push(m?.[1] ?? line, "pre");
      const rest = m?.[2] ?? "";
      const inc = rest.match(/^(\s*)(<[^>]*>|"[^"]*")(.*)$/);
      if (inc) {
        push(inc[1] ?? "");
        push(inc[2] ?? "", "str");
        push(inc[3] ?? "", "com");
      } else {
        push(rest);
      }
      return toks;
    }
    while (i < line.length) {
      if (inComment) {
        const end = line.indexOf("*/", i);
        if (end < 0) {
          push(line.slice(i), "com");
          i = line.length;
        } else {
          push(line.slice(i, end + 2), "com");
          i = end + 2;
          inComment = false;
        }
        continue;
      }
      const c = line[i]!;
      if (c === "/" && line[i + 1] === "/") {
        push(line.slice(i), "com");
        break;
      }
      if (c === "/" && line[i + 1] === "*") {
        inComment = true;
        push("/*", "com");
        i += 2;
        continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < line.length && line[j] !== c) j += line[j] === "\\" ? 2 : 1;
        push(line.slice(i, j + 1), "str");
        i = j + 1;
        continue;
      }
      if (/[0-9]/.test(c)) {
        const m = line.slice(i).match(/^(0x[0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?)[uUlLfF]*/);
        const t = m?.[0] ?? c;
        push(t, "num");
        i += t.length;
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const m = line.slice(i).match(/^[A-Za-z_]\w*/);
        const w = m?.[0] ?? c;
        const after = line.slice(i + w.length).match(/^\s*\(/);
        if (kw.has(w)) push(w, "kw");
        else if (types.has(w)) push(w, "type");
        else if (C_SYS.has(w) && after) push(w, "sys");
        else if (after) push(w, "fn");
        else push(w);
        i += w.length;
        continue;
      }
      push(c);
      i++;
    }
    return toks;
  });
}

// ─── Generic engine (Python, JS/TS, shell, JSON) ──────────────────────────────

interface Spec {
  lineComment: string[];
  block?: [string, string];
  quotes: string;
  /** Python's ''' / """ strings. */
  triple?: boolean;
  /** JS template strings may span lines. */
  backtick?: boolean;
  kw: Set<string>;
  types?: Set<string>;
  builtins?: Set<string>;
  /** "@decorator" (Python) or "$VAR" (shell) drawn as `pre`. */
  sigil?: "@" | "$";
}

const SPECS: Partial<Record<Lang, Spec>> = {
  python: {
    lineComment: ["#"],
    quotes: `'"`,
    triple: true,
    kw: words(`False None True and as assert async await break class continue def del elif else except finally for
      from global if import in is lambda nonlocal not or pass raise return try while with yield match case self cls`),
    types: words(`int str float bool list dict set tuple object bytes type complex frozenset`),
    builtins: words(`print len range open input enumerate zip map filter sorted super isinstance abs min max sum any
      all round reversed getattr setattr hasattr iter next`),
    sigil: "@",
  },
  js: {
    lineComment: ["//"],
    block: ["/*", "*/"],
    quotes: `'"`,
    backtick: true,
    kw: words(`break case catch class const continue debugger default delete do else export extends finally for
      function if import in instanceof let new return super switch this throw try typeof var void while with yield
      async await of from as true false null undefined static get set`),
    builtins: words(`console require module process Math JSON Object Array Promise Number String Boolean Date Map Set
      Error window document`),
  },
  shell: {
    lineComment: ["#"],
    quotes: `'"`,
    kw: words(`if then else elif fi for while until do done case esac in function return export local readonly
      source alias unset shift exit`),
    builtins: words(`echo cd ls cat grep sed awk sudo apt pip pip3 python python3 gcc make cmake git npm node mkdir rm
      cp mv chmod chown touch printf read`),
    sigil: "$",
  },
  json: {
    lineComment: [],
    quotes: `"`,
    kw: words(`true false null`),
  },
};
SPECS.ts = {
  ...SPECS.js!,
  kw: words(`${[...SPECS.js!.kw].join(" ")} interface type enum implements private public protected readonly
    declare namespace abstract keyof satisfies infer is`),
  types: words(`string number boolean any unknown never object bigint symbol Record Partial Readonly Promise`),
};

function highlightGeneric(code: string, spec: Spec): Tok[][] {
  const lines = code.split("\n");
  /** Open multi-line construct: a block comment, or the closing delimiter of a string. */
  let open: { kind: "com" | "str"; end: string } | null = null;
  return lines.map((line) => {
    const toks: Tok[] = [];
    const push = (t: string, c?: TokClass) => {
      if (!t) return;
      const last = toks[toks.length - 1];
      if (last && last.c === c) last.t += t;
      else toks.push({ t, c });
    };
    let i = 0;
    while (i < line.length) {
      if (open) {
        const end = line.indexOf(open.end, i);
        if (end < 0) {
          push(line.slice(i), open.kind);
          i = line.length;
        } else {
          push(line.slice(i, end + open.end.length), open.kind);
          i = end + open.end.length;
          open = null;
        }
        continue;
      }
      const rest = line.slice(i);
      const lc = spec.lineComment.find((p) => rest.startsWith(p));
      // In shell, "#" only starts a comment at a word boundary ("$#" and "a#b" are not comments).
      if (lc && !(spec.sigil === "$" && i > 0 && !/\s/.test(line[i - 1]!))) {
        push(rest, "com");
        break;
      }
      if (spec.block && rest.startsWith(spec.block[0])) {
        open = { kind: "com", end: spec.block[1] };
        push(spec.block[0], "com");
        i += spec.block[0].length;
        continue;
      }
      const c = line[i]!;
      if (spec.triple && (rest.startsWith('"""') || rest.startsWith("'''"))) {
        const q = rest.slice(0, 3);
        const end = line.indexOf(q, i + 3);
        if (end < 0) {
          open = { kind: "str", end: q };
          push(rest, "str");
          break;
        }
        push(line.slice(i, end + 3), "str");
        i = end + 3;
        continue;
      }
      if (spec.backtick && c === "`") {
        let j = i + 1;
        while (j < line.length && line[j] !== "`") j += line[j] === "\\" ? 2 : 1;
        if (j >= line.length) {
          open = { kind: "str", end: "`" };
          push(rest, "str");
          break;
        }
        push(line.slice(i, j + 1), "str");
        i = j + 1;
        continue;
      }
      if (spec.quotes.includes(c)) {
        let j = i + 1;
        while (j < line.length && line[j] !== c) j += line[j] === "\\" ? 2 : 1;
        const s = line.slice(i, j + 1);
        // JSON keys read better in the function colour.
        const isKey = spec === SPECS.json && /^\s*:/.test(line.slice(j + 1));
        push(s, isKey ? "fn" : "str");
        i = j + 1;
        continue;
      }
      if (spec.sigil && c === spec.sigil) {
        const m = rest.match(spec.sigil === "$" ? /^\$(\{[^}]*\}|\w+|[#?@*!$0-9])/ : /^@[\w.]+/);
        if (m) {
          push(m[0], "pre");
          i += m[0].length;
          continue;
        }
      }
      if (/[0-9]/.test(c) && (i === 0 || !/[\w$]/.test(line[i - 1]!))) {
        const m = rest.match(/^(0x[0-9a-fA-F_]+|0b[01_]+|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?)n?/);
        const t = m?.[0] ?? c;
        push(t, "num");
        i += t.length;
        continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        const m = rest.match(/^[A-Za-z_$][\w$]*/);
        const w = m?.[0] ?? c;
        const call = /^\s*\(/.test(line.slice(i + w.length));
        if (spec.kw.has(w)) push(w, "kw");
        else if (spec.types?.has(w)) push(w, "type");
        else if (spec.builtins?.has(w)) push(w, "sys");
        else if (call) push(w, "fn");
        else push(w);
        i += w.length;
        continue;
      }
      push(c);
      i++;
    }
    return toks;
  });
}

function highlightMarkdown(code: string): Tok[][] {
  let fence = false;
  return code.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return [{ t: line, c: "pre" as const }];
    }
    if (fence) return [{ t: line, c: "str" as const }];
    if (/^\s{0,3}#{1,6}\s/.test(line)) return [{ t: line, c: "kw" as const }];
    if (/^\s*>/.test(line)) return [{ t: line, c: "com" as const }];
    const toks: Tok[] = [];
    const list = line.match(/^(\s*(?:[-*+]|\d+\.)\s)/);
    let rest = line;
    if (list) {
      toks.push({ t: list[1]!, c: "pre" });
      rest = line.slice(list[1]!.length);
    }
    for (const part of rest.split(/(`[^`]*`)/)) {
      if (!part) continue;
      toks.push(part.startsWith("`") && part.endsWith("`") && part.length > 1 ? { t: part, c: "str" } : { t: part });
    }
    return toks;
  });
}

/** Above this size the editor shows plain text: typing must stay instant. */
export const HIGHLIGHT_MAX_LINES = 5000;

export function highlight(code: string, lang: Lang = "c"): Tok[][] {
  switch (lang) {
    case "c":
      return highlightC(code, C_KW, C_TYPES);
    case "cpp":
      return highlightC(code, CPP_KW, CPP_TYPES);
    case "markdown":
      return highlightMarkdown(code);
    case "plain":
      return code.split("\n").map((t) => (t ? [{ t }] : []));
    default:
      return highlightGeneric(code, SPECS[lang]!);
  }
}
