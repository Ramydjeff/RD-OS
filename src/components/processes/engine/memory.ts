// Value and memory model. Each process owns its memory (blocks of cells);
// pointers reference a block plus an element offset.

import type { CType } from "./ast";

export type BlockKind = "var" | "array" | "str" | "heap" | "stream";

export interface Block {
  id: number;
  name: string;
  kind: BlockKind;
  cells: Value[];
  /** Element type of the cells (scalar type for variables, element type for arrays). */
  elem: CType;
  freed?: boolean;
  readonly?: boolean;
  /** For heap blocks: line of the malloc(). */
  line?: number;
}

export type Value =
  | { k: "int"; v: number; u?: boolean; l?: boolean }
  | { k: "float"; v: number }
  | { k: "ptr"; b: Block | null; o: number; t?: CType }
  | { k: "fn"; name: string }
  | { k: "undef" }
  | { k: "void" };

export const VOID: Value = { k: "void" };
export const UNDEF: Value = { k: "undef" };
export const NULLPTR: Value = { k: "ptr", b: null, o: 0 };

export const mkInt = (v: number): Value => ({ k: "int", v });
export const mkFloat = (v: number): Value => ({ k: "float", v });

/** Sentinel blocks standing for the stdio streams (stdout, stderr, stdin). */
const streamType: CType = { base: "void", unsigned: false, ptr: 0, dims: [] };
export const STDIN_BLOCK: Block = { id: -1, name: "stdin", kind: "stream", cells: [], elem: streamType };
export const STDOUT_BLOCK: Block = { id: -2, name: "stdout", kind: "stream", cells: [], elem: streamType };
export const STDERR_BLOCK: Block = { id: -3, name: "stderr", kind: "stream", cells: [], elem: streamType };

export function fakeAddress(b: Block | null, o: number): number {
  if (!b) return 0;
  const size = b.kind === "heap" || b.kind === "str" ? 1 : scalarSize(b.elem);
  const base = b.kind === "heap" ? 0x5555_5555_6000 : b.kind === "str" ? 0x5555_5555_4000 : 0x7ffd_4a3c_0000;
  return base + b.id * 0x40 + o * size;
}

export function scalarSize(t: CType): number {
  if (t.ptr > 0) return 8;
  switch (t.base) {
    case "char":
    case "bool":
      return 1;
    case "short":
      return 2;
    case "int":
    case "float":
      return 4;
    case "long":
    case "double":
      return 8;
    case "void":
      return 1;
  }
}

export function toNumber(v: Value): number {
  switch (v.k) {
    case "int":
    case "float":
      return v.v;
    case "ptr":
      return v.b ? fakeAddress(v.b, v.o) : v.o;
    default:
      return 0;
  }
}

export function truthy(v: Value): boolean {
  if (v.k === "ptr") return v.b !== null || v.o !== 0;
  if (v.k === "fn") return true;
  return toNumber(v) !== 0;
}

/** Wraps an integer like the C type would (two's complement). */
export function wrapInt(n: number, base: CType["base"], unsigned: boolean): number {
  if (!Number.isFinite(n)) return 0;
  n = Math.trunc(n);
  switch (base) {
    case "bool":
      return n !== 0 ? 1 : 0;
    case "char":
      return unsigned ? n & 0xff : (n << 24) >> 24;
    case "short":
      return unsigned ? n & 0xffff : (n << 16) >> 16;
    case "long":
      if (unsigned && n < 0) return n + 2 ** 64;
      return n;
    default:
      return unsigned ? n >>> 0 : n | 0;
  }
}

export function isIntegral(t: CType): boolean {
  return t.ptr === 0 && t.base !== "float" && t.base !== "double" && t.base !== "void";
}

export function derefType(t: CType): CType {
  return { ...t, ptr: Math.max(0, t.ptr - 1), dims: [] };
}

/** Converts a value to the given (non-array) type, as an assignment would. */
export function coerce(v: Value, t: CType): Value {
  if (t.ptr > 0) {
    if (v.k === "ptr") return t.base === "void" && t.ptr === 1 ? v : { ...v, t: derefType(t) };
    if (v.k === "fn") return v;
    const n = toNumber(v);
    return { k: "ptr", b: null, o: n };
  }
  if (t.base === "void") return VOID;
  if (v.k === "undef") return v;
  if (v.k === "fn") return v;
  if (t.base === "float" || t.base === "double") {
    const n = toNumber(v);
    return { k: "float", v: t.base === "float" ? Math.fround(n) : n };
  }
  const n = toNumber(v);
  const r: Value = { k: "int", v: wrapInt(n, t.base, t.unsigned) };
  if (t.unsigned) r.u = true;
  if (t.base === "long") r.l = true;
  return r;
}

export function zeroOf(t: CType): Value {
  if (t.ptr > 0) return NULLPTR;
  if (t.base === "float" || t.base === "double") return mkFloat(0);
  return coerce(mkInt(0), t);
}

/** Human-readable name of a memory cell, e.g. `x`, `t[2]`, `tas#3[0]`. */
export function cellLabel(b: Block, o: number): string {
  if (b.kind === "var") return o === 0 ? b.name : `${b.name}[${o}]`;
  if (b.kind === "heap") return `${b.name}[${o}]`;
  if (b.kind === "str") return `"${blockString(b, 0, 12)}"[${o}]`;
  return `${b.name}[${o}]`;
}

/** Reads a NUL-terminated string from a block (bounded). */
export function blockString(b: Block, from: number, max = 4096): string {
  let s = "";
  for (let i = from; i < b.cells.length && s.length < max; i++) {
    const c = b.cells[i]!;
    const n = c.k === "int" ? c.v : 0;
    if (n === 0) break;
    s += String.fromCharCode(n & 0xff);
  }
  return s;
}

export function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r")
    .replace(/\0/g, "\\0");
}

function formatFloat(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toFixed(1);
  const s = n.toPrecision(7);
  return s.includes("e") ? s : String(Number(s));
}

function charLabel(n: number): string {
  if (n === 0) return "'\\0'";
  if (n === 10) return "'\\n'";
  if (n === 9) return "'\\t'";
  if (n >= 32 && n < 127) return `'${String.fromCharCode(n)}'`;
  return `'\\x${(n & 0xff).toString(16).padStart(2, "0")}'`;
}

/** Display of a scalar value, using the declared type as a hint. */
export function showValue(v: Value, t?: CType): string {
  switch (v.k) {
    case "undef":
      return "?";
    case "void":
      return "void";
    case "fn":
      return `${v.name}()`;
    case "float":
      return formatFloat(v.v);
    case "int":
      if (t && t.ptr === 0 && t.base === "char" && !t.alias) return `${charLabel(v.v)} (${v.v})`;
      return String(v.v);
    case "ptr": {
      if (!v.b) return v.o === 0 ? "NULL" : `0x${v.o.toString(16)}`;
      if (v.b.kind === "stream") return v.b.name;
      if (v.b.kind === "str") return `→ "${escapeText(blockString(v.b, v.o, 40))}"`;
      if (v.b.freed) return `→ ${cellLabel(v.b, v.o)} (libéré)`;
      return `&${cellLabel(v.b, v.o)}`;
    }
  }
}

/** Display of a whole block (arrays, strings, heap allocations). */
export function showBlock(b: Block, maxItems = 12): string {
  const isChar = b.elem.ptr === 0 && b.elem.base === "char" && b.elem.dims.length === 0;
  if (isChar && b.cells.every((c) => c.k === "int" || c.k === "undef")) {
    const end = b.cells.findIndex((c) => c.k === "int" && c.v === 0);
    if (end >= 0) return `"${escapeText(blockString(b, 0, 64))}"`;
  }
  const items = b.cells.slice(0, maxItems).map((c) => {
    if (c.k === "ptr" && c.b && c.b.kind === "array" && c.b.name.startsWith(b.name + "[")) return showBlock(c.b, 6);
    return showValue(c, b.elem);
  });
  return `[${items.join(", ")}${b.cells.length > maxItems ? ", …" : ""}]`;
}
