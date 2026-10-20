// AST of the C subset understood by the process simulator.

export type BaseType = "void" | "char" | "short" | "int" | "long" | "float" | "double" | "bool";

export interface CType {
  base: BaseType;
  unsigned: boolean;
  /** Pointer depth: `int **p` -> 2. */
  ptr: number;
  /** Array dimensions in declaration order; `null` when the size comes from the initializer. */
  dims: (Expr | null)[];
  /** Typedef name used in the source (pid_t, size_t...), for display only. */
  alias?: string;
}

interface Node {
  line: number;
}

export type Expr =
  | (Node & { k: "num"; v: number; float: boolean; long: boolean; unsigned: boolean })
  | (Node & { k: "str"; v: string })
  | (Node & { k: "id"; name: string })
  | (Node & { k: "unary"; op: "-" | "+" | "!" | "~" | "*" | "&"; e: Expr })
  | (Node & { k: "update"; op: "++" | "--"; prefix: boolean; e: Expr })
  | (Node & { k: "bin"; op: string; l: Expr; r: Expr })
  | (Node & { k: "logic"; op: "&&" | "||"; l: Expr; r: Expr })
  | (Node & { k: "assign"; op: string; l: Expr; r: Expr })
  | (Node & { k: "cond"; c: Expr; a: Expr; b: Expr })
  | (Node & { k: "call"; callee: Expr; args: Expr[] })
  | (Node & { k: "index"; e: Expr; i: Expr })
  | (Node & { k: "cast"; type: CType; e: Expr })
  | (Node & { k: "sizeof"; type: CType | null; e: Expr | null })
  | (Node & { k: "comma"; l: Expr; r: Expr })
  | (Node & { k: "init"; items: Expr[] });

export type CallExpr = Extract<Expr, { k: "call" }>;

export interface Declarator {
  name: string;
  type: CType;
  init: Expr | null;
  line: number;
}

export type Stmt =
  | (Node & { k: "block"; body: Stmt[]; endLine: number })
  | (Node & { k: "decl"; decls: Declarator[]; src: string; isStatic: boolean })
  | (Node & { k: "expr"; e: Expr; src: string })
  | (Node & { k: "if"; c: Expr; then: Stmt; else: Stmt | null; src: string })
  | (Node & { k: "while"; c: Expr; body: Stmt; src: string })
  | (Node & { k: "do"; body: Stmt; c: Expr; src: string })
  | (Node & {
      k: "for";
      init: Stmt | null;
      c: Expr | null;
      step: Expr | null;
      body: Stmt;
      src: string;
      initSrc: string;
      condSrc: string;
      stepSrc: string;
    })
  | (Node & { k: "switch"; e: Expr; body: Stmt; src: string })
  | (Node & { k: "case"; test: Expr | null })
  | (Node & { k: "break" })
  | (Node & { k: "continue" })
  | (Node & { k: "return"; e: Expr | null; src: string })
  | (Node & { k: "empty" });

export type DeclStmt = Extract<Stmt, { k: "decl" }>;

export interface Param {
  name: string;
  type: CType;
}

export interface FuncDef {
  name: string;
  ret: CType;
  params: Param[];
  body: Extract<Stmt, { k: "block" }>;
  line: number;
  endLine: number;
}

export interface Program {
  funcs: Map<string, FuncDef>;
  globals: DeclStmt[];
  includes: string[];
  source: string;
}

export const INT: CType = { base: "int", unsigned: false, ptr: 0, dims: [] };
export const CHAR: CType = { base: "char", unsigned: false, ptr: 0, dims: [] };
export const DOUBLE: CType = { base: "double", unsigned: false, ptr: 0, dims: [] };

export function typeName(t: CType): string {
  let s = t.alias ?? `${t.unsigned && t.base !== "bool" ? "unsigned " : ""}${t.base}`;
  if (t.ptr > 0) s += " " + "*".repeat(t.ptr);
  return s;
}
