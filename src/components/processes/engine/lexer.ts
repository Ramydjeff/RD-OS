// Lexer + minimal C preprocessor for the process simulator.
// Positions (line, col, start, end) always refer to the normalized source
// (CRLF -> LF), so the UI can highlight exact lines and statement text.

export class CError extends Error {
  readonly line: number;
  readonly col: number;
  constructor(message: string, line: number, col = 0) {
    super(message);
    this.name = "CError";
    this.line = line;
    this.col = col;
  }
}

export type TokKind = "num" | "str" | "id" | "op" | "eof";

export interface Token {
  kind: TokKind;
  text: string;
  num?: number;
  isFloat?: boolean;
  isLong?: boolean;
  isUnsigned?: boolean;
  /** Decoded value of a string literal. */
  str?: string;
  line: number;
  col: number;
  start: number;
  end: number;
}

interface Macro {
  params: string[] | null;
  body: Token[];
}

export interface LexResult {
  tokens: Token[];
  includes: string[];
  source: string;
}

const OPS = [
  "<<=", ">>=", "...", "->", "++", "--", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||",
  "+=", "-=", "*=", "/=", "%=", "&=", "^=", "|=",
  "+", "-", "*", "/", "%", "<", ">", "=", "!", "~", "&", "|", "^", "?", ":", ";", ",", ".",
  "(", ")", "[", "]", "{", "}",
];

const isDigit = (c: string) => c >= "0" && c <= "9";
const isHex = (c: string) => isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
const isIdStart = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isIdPart = (c: string) => isIdStart(c) || isDigit(c);

export function normalizeSource(source: string): string {
  return source.replace(/\r\n?/g, "\n");
}

/** Replaces comments with spaces (newlines kept) without touching string literals. */
function stripComments(src: string): string {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < n && src[i] !== q && src[i] !== "\n") {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      out[i++] = " ";
      out[i++] = " ";
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < n) {
        out[i++] = " ";
        out[i++] = " ";
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

function decodeEscape(text: string, i: number, line: number): { ch: string; next: number } {
  // text[i] is the character right after the backslash.
  const c = text[i];
  switch (c) {
    case "n": return { ch: "\n", next: i + 1 };
    case "t": return { ch: "\t", next: i + 1 };
    case "r": return { ch: "\r", next: i + 1 };
    case "a": return { ch: "\x07", next: i + 1 };
    case "b": return { ch: "\b", next: i + 1 };
    case "f": return { ch: "\f", next: i + 1 };
    case "v": return { ch: "\v", next: i + 1 };
    case "e": return { ch: "\x1b", next: i + 1 };
    case "\\": return { ch: "\\", next: i + 1 };
    case "'": return { ch: "'", next: i + 1 };
    case '"': return { ch: '"', next: i + 1 };
    case "?": return { ch: "?", next: i + 1 };
    case "x": {
      let j = i + 1;
      while (j < text.length && isHex(text[j]!)) j++;
      if (j === i + 1) throw new CError("Séquence d'échappement \\x invalide", line);
      return { ch: String.fromCharCode(parseInt(text.slice(i + 1, j), 16) & 0xff), next: j };
    }
    default: {
      if (c !== undefined && c >= "0" && c <= "7") {
        let j = i;
        while (j < i + 3 && j < text.length && text[j]! >= "0" && text[j]! <= "7") j++;
        return { ch: String.fromCharCode(parseInt(text.slice(i, j), 8) & 0xff), next: j };
      }
      return { ch: c ?? "", next: i + 1 };
    }
  }
}

/** Tokenizes already-preprocessed text. */
function scan(text: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i]!;
    if (c === "\n") {
      line++;
      i++;
      lineStart = i;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v" || c === "\\") {
      i++;
      continue;
    }
    const start = i;
    const col = i - lineStart + 1;

    if (isIdStart(c)) {
      while (i < n && isIdPart(text[i]!)) i++;
      toks.push({ kind: "id", text: text.slice(start, i), line, col, start, end: i });
      continue;
    }

    if (isDigit(c) || (c === "." && isDigit(text[i + 1] ?? ""))) {
      let j = i;
      let value = 0;
      let isFloat = false;
      if (c === "0" && (text[j + 1] === "x" || text[j + 1] === "X")) {
        j += 2;
        const s = j;
        while (j < n && isHex(text[j]!)) j++;
        value = parseInt(text.slice(s, j) || "0", 16);
      } else if (c === "0" && (text[j + 1] === "b" || text[j + 1] === "B")) {
        j += 2;
        const s = j;
        while (j < n && (text[j] === "0" || text[j] === "1")) j++;
        value = parseInt(text.slice(s, j) || "0", 2);
      } else {
        while (j < n && isDigit(text[j]!)) j++;
        if (text[j] === ".") {
          isFloat = true;
          j++;
          while (j < n && isDigit(text[j]!)) j++;
        }
        if (text[j] === "e" || text[j] === "E") {
          const save = j;
          j++;
          if (text[j] === "+" || text[j] === "-") j++;
          if (isDigit(text[j] ?? "")) {
            isFloat = true;
            while (j < n && isDigit(text[j]!)) j++;
          } else {
            j = save;
          }
        }
        const raw = text.slice(i, j);
        if (isFloat) value = parseFloat(raw);
        else if (raw.length > 1 && raw[0] === "0") value = parseInt(raw, 8);
        else value = parseInt(raw, 10);
      }
      let isLong = false;
      let isUnsigned = false;
      while (j < n && /[uUlLfF]/.test(text[j]!)) {
        const s = text[j]!;
        if (s === "u" || s === "U") isUnsigned = true;
        else if (s === "l" || s === "L") isLong = true;
        else if (s === "f" || s === "F") isFloat = true;
        j++;
      }
      if (j < n && isIdPart(text[j]!)) {
        throw new CError(`Nombre invalide « ${text.slice(i, j + 1)} »`, line, col);
      }
      toks.push({ kind: "num", text: text.slice(i, j), num: value, isFloat, isLong, isUnsigned, line, col, start, end: j });
      i = j;
      continue;
    }

    if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < n && text[j] !== '"') {
        if (text[j] === "\n") throw new CError("Chaîne de caractères non terminée (guillemet fermant manquant)", line, col);
        if (text[j] === "\\") {
          const d = decodeEscape(text, j + 1, line);
          s += d.ch;
          j = d.next;
        } else {
          s += text[j];
          j++;
        }
      }
      if (j >= n) throw new CError("Chaîne de caractères non terminée (guillemet fermant manquant)", line, col);
      j++;
      toks.push({ kind: "str", text: text.slice(i, j), str: s, line, col, start, end: j });
      i = j;
      continue;
    }

    if (c === "'") {
      let j = i + 1;
      let ch = "";
      if (text[j] === "\\") {
        const d = decodeEscape(text, j + 1, line);
        ch = d.ch;
        j = d.next;
      } else {
        ch = text[j] ?? "";
        j++;
      }
      if (text[j] !== "'") throw new CError("Caractère littéral mal formé (apostrophe fermante manquante)", line, col);
      j++;
      const code = ch.charCodeAt(0) || 0;
      toks.push({ kind: "num", text: text.slice(i, j), num: code > 127 ? code - 256 : code, line, col, start, end: j });
      i = j;
      continue;
    }

    let matched: string | null = null;
    for (const op of OPS) {
      if (text.startsWith(op, i)) {
        matched = op;
        break;
      }
    }
    if (!matched) throw new CError(`Caractère inattendu « ${c} »`, line, col);
    toks.push({ kind: "op", text: matched, line, col, start, end: i + matched.length });
    i += matched.length;
  }
  return toks;
}

/** Runs directives, then tokenizes and expands macros. */
export function lex(rawSource: string): LexResult {
  const source = normalizeSource(rawSource);
  const lines = stripComments(source).split("\n");
  const macros = new Map<string, Macro>();
  const includes: string[] = [];
  const cond: { active: boolean; taken: boolean }[] = [];
  const out: string[] = [];

  const isActive = () => cond.every((c) => c.active);
  const evalCond = (expr: string): boolean => {
    let e = expr.replace(/defined\s*\(\s*(\w+)\s*\)|defined\s+(\w+)/g, (_m, a: string, b: string) =>
      macros.has(a ?? b) ? "1" : "0",
    );
    e = e.replace(/[A-Za-z_]\w*/g, (name) => {
      const m = macros.get(name);
      if (m && !m.params && m.body.length === 1 && m.body[0]!.kind === "num") return String(m.body[0]!.num);
      return "0";
    });
    const t = e.trim();
    if (/^!\s*\d+$/.test(t)) return Number(t.slice(1).trim()) === 0;
    if (/^-?\d+$/.test(t)) return Number(t) !== 0;
    return true;
  };

  let k = 0;
  while (k < lines.length) {
    const ln = lines[k]!;
    if (/^\s*#/.test(ln)) {
      let full = ln;
      let count = 1;
      while (/\\\s*$/.test(full) && k + count < lines.length) {
        full = full.replace(/\\\s*$/, " ") + lines[k + count];
        count++;
      }
      const lineNo = k + 1;
      const body = full.trim().slice(1).trim();
      const m = body.match(/^(\w+)\s*([\s\S]*)$/);
      const dir = m?.[1] ?? "";
      const rest = m?.[2] ?? "";
      const active = isActive();
      switch (dir) {
        case "include":
          if (active) includes.push(rest.replace(/[<>"]/g, "").trim());
          break;
        case "define":
          if (active) {
            const dm = rest.match(/^([A-Za-z_]\w*)(\(([^)]*)\))?\s*([\s\S]*)$/);
            if (!dm) throw new CError("Directive #define invalide", lineNo);
            const name = dm[1]!;
            const params = dm[2] !== undefined ? dm[3]!.split(",").map((s) => s.trim()).filter(Boolean) : null;
            let bodyToks: Token[] = [];
            try {
              bodyToks = scan(dm[4] ?? "").map((t) => ({ ...t, line: lineNo }));
            } catch (err) {
              if (err instanceof CError) throw new CError(err.message, lineNo);
              throw err;
            }
            macros.set(name, { params, body: bodyToks });
          }
          break;
        case "undef":
          if (active) macros.delete(rest.trim());
          break;
        case "ifdef":
          cond.push({ active: active && macros.has(rest.trim()), taken: macros.has(rest.trim()) });
          break;
        case "ifndef":
          cond.push({ active: active && !macros.has(rest.trim()), taken: !macros.has(rest.trim()) });
          break;
        case "if": {
          const v = evalCond(rest);
          cond.push({ active: active && v, taken: v });
          break;
        }
        case "elif": {
          const top = cond.pop();
          if (!top) throw new CError("#elif sans #if", lineNo);
          const parentActive = isActive();
          const v = !top.taken && evalCond(rest);
          cond.push({ active: parentActive && v, taken: top.taken || v });
          break;
        }
        case "else": {
          const top = cond.pop();
          if (!top) throw new CError("#else sans #if", lineNo);
          const parentActive = isActive();
          cond.push({ active: parentActive && !top.taken, taken: true });
          break;
        }
        case "endif":
          if (!cond.pop()) throw new CError("#endif sans #if", lineNo);
          break;
        case "error":
          if (active) throw new CError(`#error ${rest}`, lineNo);
          break;
        default:
          break; // #pragma, #line, ... are ignored
      }
      for (let t = 0; t < count; t++) out.push(" ".repeat(lines[k + t]!.length));
      k += count;
      continue;
    }
    out.push(isActive() ? ln : " ".repeat(ln.length));
    k++;
  }

  const raw = scan(out.join("\n"));
  const tokens = expandMacros(raw, macros);
  const last = raw[raw.length - 1];
  tokens.push({
    kind: "eof",
    text: "",
    line: last ? last.line : 1,
    col: last ? last.col + last.text.length : 1,
    start: source.length,
    end: source.length,
  });
  return { tokens, includes, source };
}

function expandMacros(tokens: Token[], macros: Map<string, Macro>): Token[] {
  if (macros.size === 0) return tokens;

  const expand = (list: Token[], hidden: Set<string>, depth: number): Token[] => {
    if (depth > 64) return list;
    const out: Token[] = [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i]!;
      const m = t.kind === "id" && !hidden.has(t.text) ? macros.get(t.text) : undefined;
      if (!m) {
        out.push(t);
        continue;
      }
      const place = (b: Token): Token => ({ ...b, line: t.line, col: t.col, start: t.start, end: t.end });
      const nextHidden = new Set(hidden).add(t.text);
      if (!m.params) {
        out.push(...expand(m.body.map(place), nextHidden, depth + 1));
        continue;
      }
      const open = list[i + 1];
      if (!open || open.kind !== "op" || open.text !== "(") {
        out.push(t);
        continue;
      }
      const args: Token[][] = [[]];
      let j = i + 2;
      let level = 0;
      for (; j < list.length; j++) {
        const a = list[j]!;
        if (a.kind === "op" && (a.text === "(" || a.text === "[" || a.text === "{")) level++;
        if (a.kind === "op" && (a.text === ")" || a.text === "]" || a.text === "}")) {
          if (level === 0 && a.text === ")") break;
          level--;
        }
        if (a.kind === "op" && a.text === "," && level === 0) {
          args.push([]);
          continue;
        }
        args[args.length - 1]!.push(a);
      }
      if (j >= list.length) throw new CError(`Appel de la macro « ${t.text} » non fermé`, t.line, t.col);
      const close = list[j]!;
      const expandedArgs = args.map((a) => expand(a, hidden, depth + 1));
      const body: Token[] = [];
      for (const b of m.body) {
        const pi = b.kind === "id" ? m.params.indexOf(b.text) : -1;
        if (pi >= 0) body.push(...(expandedArgs[pi] ?? []).map((a) => ({ ...a })));
        else body.push(place(b));
      }
      const span = (x: Token): Token => ({ ...x, start: t.start, end: close.end, line: t.line, col: t.col });
      out.push(...expand(body, nextHidden, depth + 1).map(span));
      i = j;
    }
    return out;
  };

  return expand(tokens, new Set(), 0);
}
