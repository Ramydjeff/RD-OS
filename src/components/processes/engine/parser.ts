// Recursive-descent parser producing the AST in ./ast.ts.
// Error messages are in French and point to the exact line.

import type { BaseType, CType, DeclStmt, Declarator, Expr, FuncDef, Param, Program, Stmt } from "./ast";
import { CError, lex, type Token } from "./lexer";

const BUILTIN_TYPEDEFS: Record<string, Omit<CType, "dims">> = {
  pid_t: { base: "int", unsigned: false, ptr: 0, alias: "pid_t" },
  size_t: { base: "long", unsigned: true, ptr: 0, alias: "size_t" },
  ssize_t: { base: "long", unsigned: false, ptr: 0, alias: "ssize_t" },
  time_t: { base: "long", unsigned: false, ptr: 0, alias: "time_t" },
  clock_t: { base: "long", unsigned: false, ptr: 0, alias: "clock_t" },
  off_t: { base: "long", unsigned: false, ptr: 0, alias: "off_t" },
  uid_t: { base: "int", unsigned: true, ptr: 0, alias: "uid_t" },
  gid_t: { base: "int", unsigned: true, ptr: 0, alias: "gid_t" },
  sig_atomic_t: { base: "int", unsigned: false, ptr: 0, alias: "sig_atomic_t" },
  sighandler_t: { base: "void", unsigned: false, ptr: 1, alias: "sighandler_t" },
  int8_t: { base: "char", unsigned: false, ptr: 0, alias: "int8_t" },
  uint8_t: { base: "char", unsigned: true, ptr: 0, alias: "uint8_t" },
  int16_t: { base: "short", unsigned: false, ptr: 0, alias: "int16_t" },
  uint16_t: { base: "short", unsigned: true, ptr: 0, alias: "uint16_t" },
  int32_t: { base: "int", unsigned: false, ptr: 0, alias: "int32_t" },
  uint32_t: { base: "int", unsigned: true, ptr: 0, alias: "uint32_t" },
  int64_t: { base: "long", unsigned: false, ptr: 0, alias: "int64_t" },
  uint64_t: { base: "long", unsigned: true, ptr: 0, alias: "uint64_t" },
  FILE: { base: "void", unsigned: false, ptr: 0, alias: "FILE" },
};

const SPECIFIERS = new Set([
  "void", "char", "short", "int", "long", "float", "double", "signed", "unsigned", "_Bool", "bool",
  "const", "volatile", "static", "extern", "register", "auto", "inline", "typedef", "struct", "union", "enum",
]);

const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="]);

const BIN_PREC: Record<string, number> = {
  "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6,
  "<": 7, ">": 7, "<=": 7, ">=": 7, "<<": 8, ">>": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10,
};

interface Specs {
  type: CType;
  isStatic: boolean;
  isTypedef: boolean;
}

class Parser {
  private pos = 0;
  private readonly typedefs = new Map<string, CType>();
  private readonly enums = new Map<string, number>();

  constructor(
    private readonly toks: Token[],
    private readonly src: string,
  ) {}

  // ── token helpers ─────────────────────────────────────────────────────
  private peek(o = 0): Token {
    return this.toks[Math.min(this.pos + o, this.toks.length - 1)]!;
  }
  private prev(): Token {
    return this.toks[Math.max(0, this.pos - 1)]!;
  }
  private next(): Token {
    const t = this.peek();
    if (this.pos < this.toks.length - 1) this.pos++;
    return t;
  }
  private isOp(text: string, o = 0): boolean {
    const t = this.peek(o);
    return t.kind === "op" && t.text === text;
  }
  private isWord(text: string, o = 0): boolean {
    const t = this.peek(o);
    return t.kind === "id" && t.text === text;
  }
  private describe(t: Token): string {
    return t.kind === "eof" ? "la fin du fichier" : `« ${t.text} »`;
  }
  private fail(msg: string, tok: Token = this.peek()): never {
    throw new CError(msg, tok.line, tok.col);
  }
  private expectOp(text: string, context = ""): Token {
    if (!this.isOp(text)) {
      const t = this.peek();
      this.fail(`« ${text} » attendu${context ? " " + context : ""}, mais ${this.describe(t)} trouvé`, t);
    }
    return this.next();
  }
  private expectSemi(): Token {
    if (this.isOp(";")) return this.next();
    const p = this.prev();
    const t = this.peek();
    if (t.line > p.line) {
      throw new CError(`Point-virgule « ; » manquant à la fin de la ligne ${p.line} (après « ${p.text} »)`, p.line, p.col);
    }
    this.fail(`« ; » attendu, mais ${this.describe(t)} trouvé`, t);
  }
  private slice(from: Token, to: Token): string {
    return this.src.slice(from.start, to.end).replace(/\s+/g, " ").trim();
  }

  // ── types ─────────────────────────────────────────────────────────────
  private isTypeStart(o = 0): boolean {
    const t = this.peek(o);
    if (t.kind !== "id") return false;
    return SPECIFIERS.has(t.text) || this.typedefs.has(t.text) || t.text in BUILTIN_TYPEDEFS;
  }

  private parseSpecifiers(): Specs | null {
    let base: BaseType | null = null;
    let unsigned = false;
    let short = false;
    let longs = 0;
    let isStatic = false;
    let isTypedef = false;
    let fromTypedef: CType | null = null;
    let consumed = false;

    for (;;) {
      const t = this.peek();
      if (t.kind !== "id") break;
      const w = t.text;
      if (w === "const" || w === "volatile" || w === "register" || w === "auto" || w === "inline" || w === "extern") {
        this.next();
      } else if (w === "static") {
        isStatic = true;
        this.next();
      } else if (w === "typedef") {
        isTypedef = true;
        this.next();
      } else if (w === "unsigned") {
        unsigned = true;
        this.next();
      } else if (w === "signed") {
        this.next();
      } else if (w === "short") {
        short = true;
        this.next();
      } else if (w === "long") {
        longs++;
        this.next();
      } else if (w === "int" || w === "char" || w === "float" || w === "double" || w === "void") {
        base = w;
        this.next();
      } else if (w === "_Bool" || w === "bool") {
        base = "bool";
        this.next();
      } else if (w === "struct" || w === "union") {
        this.fail(
          `Les types « ${w} » ne sont pas encore pris en charge par le simulateur (utilisez des variables ou des tableaux simples)`,
        );
      } else if (w === "enum") {
        this.parseEnum();
        base = "int";
      } else if (!fromTypedef && (this.typedefs.has(w) || w in BUILTIN_TYPEDEFS)) {
        // A typedef name is a type only if no other type keyword was seen.
        if (base || unsigned || short || longs) break;
        const td = this.typedefs.get(w) ?? { ...BUILTIN_TYPEDEFS[w]!, dims: [] };
        fromTypedef = { ...td, dims: [...td.dims] };
        this.next();
      } else {
        break;
      }
      consumed = true;
    }
    if (!consumed) return null;
    if (fromTypedef) return { type: fromTypedef, isStatic, isTypedef };

    let b: BaseType = base ?? "int";
    if (short && b === "int") b = "short";
    if (longs > 0 && b === "int") b = "long";
    if (longs > 0 && b === "double") b = "double";
    return { type: { base: b, unsigned, ptr: 0, dims: [] }, isStatic, isTypedef };
  }

  private parseEnum(): void {
    this.next(); // enum
    if (this.peek().kind === "id" && !this.isOp("{", 0)) this.next();
    if (!this.isOp("{")) return;
    this.next();
    let value = 0;
    while (!this.isOp("}")) {
      const name = this.peek();
      if (name.kind !== "id") this.fail("Nom de constante attendu dans l'enum");
      this.next();
      if (this.isOp("=")) {
        this.next();
        value = this.constValue(this.parseCond());
      }
      this.enums.set(name.text, value);
      value++;
      if (this.isOp(",")) this.next();
      else break;
    }
    this.expectOp("}", "pour fermer l'enum");
  }

  /** Evaluates a constant integer expression at parse time (enum values). */
  private constValue(e: Expr): number {
    switch (e.k) {
      case "num":
        return e.v;
      case "unary":
        if (e.op === "-") return -this.constValue(e.e);
        if (e.op === "+") return this.constValue(e.e);
        if (e.op === "~") return ~this.constValue(e.e);
        if (e.op === "!") return this.constValue(e.e) ? 0 : 1;
        break;
      case "bin": {
        const a = this.constValue(e.l);
        const b = this.constValue(e.r);
        switch (e.op) {
          case "+": return a + b;
          case "-": return a - b;
          case "*": return a * b;
          case "/": return b ? Math.trunc(a / b) : 0;
          case "%": return b ? a % b : 0;
          case "<<": return a << b;
          case ">>": return a >> b;
          case "|": return a | b;
          case "&": return a & b;
          case "^": return a ^ b;
        }
        break;
      }
      default:
        break;
    }
    this.fail("Expression constante attendue");
  }

  private parseDeclarator(base: CType, allowAbstract: boolean): { name: string; type: CType; tok: Token } {
    let ptr = 0;
    while (this.isOp("*")) {
      this.next();
      ptr++;
      while (this.isWord("const") || this.isWord("volatile") || this.isWord("restrict")) this.next();
    }
    if (this.isOp("(") && this.isOp("*", 1)) {
      this.fail("Les pointeurs de fonction ne sont pas pris en charge (passez directement le nom de la fonction)");
    }
    const tok = this.peek();
    let name = "";
    if (tok.kind === "id" && !SPECIFIERS.has(tok.text)) {
      name = tok.text;
      this.next();
    } else if (!allowAbstract) {
      this.fail(`Nom de variable ou de fonction attendu, mais ${this.describe(tok)} trouvé`);
    }
    const dims: (Expr | null)[] = [...base.dims];
    while (this.isOp("[")) {
      this.next();
      if (this.isOp("]")) dims.push(null);
      else dims.push(this.parseAssign());
      this.expectOp("]", "pour fermer la taille du tableau");
    }
    return { name, type: { ...base, ptr: base.ptr + ptr, dims }, tok };
  }

  private parseTypeName(): CType {
    const spec = this.parseSpecifiers();
    if (!spec) this.fail("Nom de type attendu");
    return this.parseDeclarator(spec.type, true).type;
  }

  private parseParams(): Param[] {
    this.expectOp("(");
    const params: Param[] = [];
    if (this.isOp(")")) {
      this.next();
      return params;
    }
    if (this.isWord("void") && this.isOp(")", 1)) {
      this.next();
      this.next();
      return params;
    }
    for (;;) {
      if (this.isOp("...")) {
        this.next();
        break;
      }
      const spec = this.parseSpecifiers();
      if (!spec) this.fail(`Type de paramètre attendu, mais ${this.describe(this.peek())} trouvé`);
      const d = this.parseDeclarator(spec.type, true);
      const type = { ...d.type };
      if (type.dims.length > 0) {
        type.ptr += 1;
        type.dims = type.dims.slice(1);
      }
      params.push({ name: d.name, type });
      if (this.isOp(",")) this.next();
      else break;
    }
    this.expectOp(")", "pour fermer la liste des paramètres");
    return params;
  }

  // ── program ───────────────────────────────────────────────────────────
  parseProgram(includes: string[]): Program {
    const funcs = new Map<string, FuncDef>();
    const globals: DeclStmt[] = [];

    while (this.peek().kind !== "eof") {
      if (this.isOp(";")) {
        this.next();
        continue;
      }
      const first = this.peek();
      let spec = this.parseSpecifiers();
      if (!spec) {
        if (first.kind === "id" && this.isOp("(", 1)) {
          spec = { type: { base: "int", unsigned: false, ptr: 0, dims: [] }, isStatic: false, isTypedef: false };
        } else {
          this.fail(`Déclaration ou définition de fonction attendue, mais ${this.describe(first)} trouvé`);
        }
      }
      if (spec.isTypedef) {
        for (;;) {
          const d = this.parseDeclarator(spec.type, false);
          this.typedefs.set(d.name, { ...d.type, alias: d.name });
          if (this.isOp(",")) this.next();
          else break;
        }
        this.expectSemi();
        continue;
      }
      if (this.isOp(";")) {
        this.next();
        continue;
      }

      const decls: Declarator[] = [];
      for (;;) {
        const d = this.parseDeclarator(spec.type, false);
        if (this.isOp("(")) {
          const params = this.parseParams();
          if (this.isOp("{")) {
            if (funcs.has(d.name)) this.fail(`La fonction « ${d.name} » est définie deux fois`, d.tok);
            const body = this.parseBlock();
            funcs.set(d.name, { name: d.name, ret: d.type, params, body, line: d.tok.line, endLine: body.endLine });
            break;
          }
          // Prototype only.
          if (this.isOp(",")) {
            this.next();
            continue;
          }
          this.expectSemi();
          break;
        }
        const init = this.isOp("=") ? (this.next(), this.parseInitializer()) : null;
        decls.push({ name: d.name, type: d.type, init, line: d.tok.line });
        if (this.isOp(",")) {
          this.next();
          continue;
        }
        const semi = this.expectSemi();
        globals.push({ k: "decl", decls, line: first.line, src: this.slice(first, semi), isStatic: true });
        break;
      }
    }
    if (!funcs.has("main")) throw new CError("Aucune fonction main() trouvée : le programme ne peut pas démarrer", 1);
    return { funcs, globals, includes, source: this.src };
  }

  private parseInitializer(): Expr {
    if (this.isOp("{")) {
      const open = this.next();
      const items: Expr[] = [];
      while (!this.isOp("}")) {
        items.push(this.parseInitializer());
        if (this.isOp(",")) this.next();
        else break;
      }
      this.expectOp("}", "pour fermer la liste d'initialisation");
      return { k: "init", items, line: open.line };
    }
    return this.parseAssign();
  }

  // ── statements ────────────────────────────────────────────────────────
  private parseBlock(): Extract<Stmt, { k: "block" }> {
    const open = this.expectOp("{");
    const body: Stmt[] = [];
    while (!this.isOp("}")) {
      if (this.peek().kind === "eof") {
        throw new CError(`Accolade « } » manquante : le bloc ouvert ligne ${open.line} n'est jamais fermé`, open.line, open.col);
      }
      body.push(this.parseStatement());
    }
    const close = this.next();
    return { k: "block", body, line: open.line, endLine: close.line };
  }

  private parseDeclaration(): DeclStmt {
    const first = this.peek();
    const spec = this.parseSpecifiers();
    if (!spec) this.fail("Déclaration attendue");
    if (spec.isTypedef) {
      for (;;) {
        const d = this.parseDeclarator(spec.type, false);
        this.typedefs.set(d.name, { ...d.type, alias: d.name });
        if (this.isOp(",")) this.next();
        else break;
      }
      const semi = this.expectSemi();
      return { k: "decl", decls: [], line: first.line, src: this.slice(first, semi), isStatic: false };
    }
    const decls: Declarator[] = [];
    if (!this.isOp(";")) {
      for (;;) {
        const d = this.parseDeclarator(spec.type, false);
        if (this.isOp("(")) {
          this.parseParams(); // local prototype, ignored
        } else {
          const init = this.isOp("=") ? (this.next(), this.parseInitializer()) : null;
          decls.push({ name: d.name, type: d.type, init, line: d.tok.line });
        }
        if (this.isOp(",")) this.next();
        else break;
      }
    }
    const semi = this.expectSemi();
    return { k: "decl", decls, line: first.line, src: this.slice(first, semi), isStatic: spec.isStatic };
  }

  private parseStatement(): Stmt {
    const t = this.peek();
    if (this.isOp("{")) return this.parseBlock();
    if (this.isOp(";")) {
      this.next();
      return { k: "empty", line: t.line };
    }
    if (t.kind === "id") {
      switch (t.text) {
        case "if": {
          this.next();
          this.expectOp("(", "après if");
          const c = this.parseExpr();
          const rp = this.expectOp(")", "pour fermer la condition du if");
          const then = this.parseStatement();
          let other: Stmt | null = null;
          if (this.isWord("else")) {
            this.next();
            other = this.parseStatement();
          }
          return { k: "if", c, then, else: other, line: t.line, src: this.slice(t, rp) };
        }
        case "while": {
          this.next();
          this.expectOp("(", "après while");
          const c = this.parseExpr();
          const rp = this.expectOp(")", "pour fermer la condition du while");
          const body = this.parseStatement();
          return { k: "while", c, body, line: t.line, src: this.slice(t, rp) };
        }
        case "do": {
          this.next();
          const body = this.parseStatement();
          const w = this.peek();
          if (!this.isWord("while")) this.fail("« while » attendu après le corps du do");
          this.next();
          this.expectOp("(");
          const c = this.parseExpr();
          const rp = this.expectOp(")");
          this.expectSemi();
          return { k: "do", body, c, line: w.line, src: this.slice(w, rp) };
        }
        case "for": {
          this.next();
          this.expectOp("(", "après for");
          let init: Stmt | null = null;
          let initSrc = "";
          const initStart = this.peek();
          if (this.isOp(";")) {
            this.next();
          } else if (this.isTypeStart()) {
            init = this.parseDeclaration();
            initSrc = this.slice(initStart, this.prev()).replace(/;$/, "");
          } else {
            const e = this.parseExpr();
            initSrc = this.slice(initStart, this.prev());
            this.expectSemi();
            init = { k: "expr", e, line: initStart.line, src: initSrc };
          }
          let c: Expr | null = null;
          let condSrc = "";
          if (!this.isOp(";")) {
            const cs = this.peek();
            c = this.parseExpr();
            condSrc = this.slice(cs, this.prev());
          }
          this.expectSemi();
          let step: Expr | null = null;
          let stepSrc = "";
          if (!this.isOp(")")) {
            const ss = this.peek();
            step = this.parseExpr();
            stepSrc = this.slice(ss, this.prev());
          }
          const rp = this.expectOp(")", "pour fermer l'en-tête du for");
          const body = this.parseStatement();
          return { k: "for", init, c, step, body, line: t.line, src: this.slice(t, rp), initSrc, condSrc, stepSrc };
        }
        case "switch": {
          this.next();
          this.expectOp("(", "après switch");
          const e = this.parseExpr();
          const rp = this.expectOp(")");
          const body = this.parseStatement();
          return { k: "switch", e, body, line: t.line, src: this.slice(t, rp) };
        }
        case "case": {
          this.next();
          const test = this.parseCond();
          this.expectOp(":", "après case");
          return { k: "case", test, line: t.line };
        }
        case "default": {
          this.next();
          this.expectOp(":", "après default");
          return { k: "case", test: null, line: t.line };
        }
        case "break":
          this.next();
          this.expectSemi();
          return { k: "break", line: t.line };
        case "continue":
          this.next();
          this.expectSemi();
          return { k: "continue", line: t.line };
        case "return": {
          this.next();
          const e = this.isOp(";") ? null : this.parseExpr();
          const semi = this.expectSemi();
          return { k: "return", e, line: t.line, src: this.slice(t, semi) };
        }
        case "goto":
          this.fail("« goto » n'est pas pris en charge par le simulateur");
          break;
        case "else":
          this.fail("« else » sans « if » correspondant (vérifiez les accolades et les points-virgules)");
          break;
        default:
          break;
      }
      if (this.isTypeStart()) return this.parseDeclaration();
      if (this.isOp(":", 1)) this.fail("Les étiquettes (goto) ne sont pas prises en charge");
    }
    const e = this.parseExpr();
    const semi = this.expectSemi();
    return { k: "expr", e, line: t.line, src: this.slice(t, semi) };
  }

  // ── expressions ───────────────────────────────────────────────────────
  parseExpr(): Expr {
    let e = this.parseAssign();
    while (this.isOp(",")) {
      const t = this.next();
      e = { k: "comma", l: e, r: this.parseAssign(), line: t.line };
    }
    return e;
  }

  private parseAssign(): Expr {
    const l = this.parseCond();
    const t = this.peek();
    if (t.kind === "op" && ASSIGN_OPS.has(t.text)) {
      this.next();
      if (l.k !== "id" && l.k !== "index" && !(l.k === "unary" && l.op === "*")) {
        this.fail("Le membre gauche d'une affectation doit être une variable, une case de tableau ou *pointeur", t);
      }
      const r = this.parseAssign();
      return { k: "assign", op: t.text, l, r, line: t.line };
    }
    return l;
  }

  private parseCond(): Expr {
    const c = this.parseBin(1);
    if (this.isOp("?")) {
      const t = this.next();
      const a = this.parseExpr();
      this.expectOp(":", "dans l'opérateur ternaire");
      const b = this.parseCond();
      return { k: "cond", c, a, b, line: t.line };
    }
    return c;
  }

  private parseBin(minPrec: number): Expr {
    let l = this.parseUnary();
    for (;;) {
      const t = this.peek();
      const prec = t.kind === "op" ? BIN_PREC[t.text] : undefined;
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const r = this.parseBin(prec + 1);
      l = t.text === "&&" || t.text === "||"
        ? { k: "logic", op: t.text, l, r, line: t.line }
        : { k: "bin", op: t.text, l, r, line: t.line };
    }
    return l;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.kind === "op") {
      if (t.text === "++" || t.text === "--") {
        this.next();
        return { k: "update", op: t.text, prefix: true, e: this.parseUnary(), line: t.line };
      }
      if (t.text === "-" || t.text === "+" || t.text === "!" || t.text === "~" || t.text === "*" || t.text === "&") {
        this.next();
        return { k: "unary", op: t.text, e: this.parseUnary(), line: t.line };
      }
      if (t.text === "(" && this.isTypeStart(1)) {
        this.next();
        const type = this.parseTypeName();
        this.expectOp(")", "pour fermer la conversion de type");
        return { k: "cast", type, e: this.parseUnary(), line: t.line };
      }
    }
    if (t.kind === "id" && t.text === "sizeof") {
      this.next();
      if (this.isOp("(") && this.isTypeStart(1)) {
        this.next();
        const type = this.parseTypeName();
        this.expectOp(")");
        return { k: "sizeof", type, e: null, line: t.line };
      }
      return { k: "sizeof", type: null, e: this.parseUnary(), line: t.line };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.kind !== "op") break;
      if (t.text === "[") {
        this.next();
        const i = this.parseExpr();
        this.expectOp("]", "pour fermer l'indice du tableau");
        e = { k: "index", e, i, line: t.line };
      } else if (t.text === "(") {
        this.next();
        const args: Expr[] = [];
        if (!this.isOp(")")) {
          for (;;) {
            args.push(this.parseAssign());
            if (this.isOp(",")) this.next();
            else break;
          }
        }
        this.expectOp(")", "pour fermer l'appel de fonction");
        e = { k: "call", callee: e, args, line: t.line };
      } else if (t.text === "++" || t.text === "--") {
        this.next();
        e = { k: "update", op: t.text, prefix: false, e, line: t.line };
      } else if (t.text === "." || t.text === "->") {
        this.fail(`L'accès aux champs (« ${t.text} ») n'est pas pris en charge : les structures ne sont pas simulées`);
      } else {
        break;
      }
    }
    return e;
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (t.kind === "num") {
      this.next();
      return { k: "num", v: t.num ?? 0, float: !!t.isFloat, long: !!t.isLong, unsigned: !!t.isUnsigned, line: t.line };
    }
    if (t.kind === "str") {
      let s = "";
      while (this.peek().kind === "str") s += this.next().str ?? "";
      return { k: "str", v: s, line: t.line };
    }
    if (t.kind === "id") {
      if (SPECIFIERS.has(t.text)) this.fail(`Mot-clé « ${t.text} » inattendu ici`);
      this.next();
      const ev = this.enums.get(t.text);
      if (ev !== undefined) return { k: "num", v: ev, float: false, long: false, unsigned: false, line: t.line };
      return { k: "id", name: t.text, line: t.line };
    }
    if (this.isOp("(")) {
      this.next();
      const e = this.parseExpr();
      this.expectOp(")", "pour fermer la parenthèse");
      return e;
    }
    this.fail(`Expression attendue, mais ${this.describe(t)} trouvé`);
  }
}

export function parseProgram(source: string): Program {
  const { tokens, includes, source: normalized } = lex(source);
  return new Parser(tokens, normalized).parseProgram(includes);
}
