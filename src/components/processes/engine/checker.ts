// Static checks done before running, like a compiler would:
// undeclared identifiers, unknown functions, wrong argument counts and
// missing #include lines (gcc "implicit declaration" warnings).

import type { Expr, Program, Stmt } from "./ast";
import { BUILTIN_HEADERS, BUILTIN_NAMES, CONST_NAMES } from "./interpreter";
import { CError } from "./lexer";

export interface Diagnostic {
  message: string;
  line: number;
}

const CONST_HEADERS: Record<string, string> = {
  WNOHANG: "sys/wait.h",
  SIGKILL: "signal.h",
  SIGTERM: "signal.h",
  SIGINT: "signal.h",
  SIGUSR1: "signal.h",
  SIGUSR2: "signal.h",
  SIGALRM: "signal.h",
  SIGCHLD: "signal.h",
  SIG_IGN: "signal.h",
  SIG_DFL: "signal.h",
};

export function checkProgram(prog: Program): { errors: CError[]; warnings: Diagnostic[] } {
  const errors: CError[] = [];
  const warnings: Diagnostic[] = [];
  const includes = new Set(prog.includes.map((h) => h.trim()));
  const warnedHeader = new Set<string>();
  const reported = new Set<string>();
  const globals = new Set<string>();
  const scopes: Set<string>[] = [];

  const needHeader = (name: string, header: string, line: number, isFunction: boolean) => {
    if (includes.has(header) || warnedHeader.has(header)) return;
    if (header === "sys/wait.h" && includes.has("wait.h")) return;
    warnedHeader.add(header);
    warnings.push({
      message: isFunction
        ? `« ${name}() » est utilisée sans #include <${header}> (gcc : implicit declaration of function '${name}')`
        : `« ${name} » est utilisée sans #include <${header}> (gcc : '${name}' undeclared)`,
      line,
    });
  };

  const isDeclared = (n: string) =>
    scopes.some((s) => s.has(n)) || globals.has(n) || prog.funcs.has(n) || CONST_NAMES.has(n) || BUILTIN_NAMES.has(n);

  const expr = (e: Expr | null | undefined): void => {
    if (!e) return;
    switch (e.k) {
      case "id":
        if (!isDeclared(e.name)) {
          const key = `id:${e.name}`;
          if (!reported.has(key)) {
            reported.add(key);
            errors.push(new CError(`« ${e.name} » n'est pas déclarée (gcc : '${e.name}' undeclared)`, e.line));
          }
        } else if (CONST_HEADERS[e.name] && !scopes.some((s) => s.has(e.name))) {
          needHeader(e.name, CONST_HEADERS[e.name]!, e.line, false);
        }
        return;
      case "call": {
        if (e.callee.k === "id" && !scopes.some((s) => s.has((e.callee as { name: string }).name))) {
          const name = e.callee.name;
          const fn = prog.funcs.get(name);
          if (fn) {
            if (fn.params.length > 0 && fn.params.length !== e.args.length) {
              errors.push(
                new CError(
                  `${name}() attend ${fn.params.length} argument(s) mais en reçoit ${e.args.length} (gcc : too ${e.args.length < fn.params.length ? "few" : "many"} arguments)`,
                  e.line,
                ),
              );
            }
          } else if (BUILTIN_NAMES.has(name)) {
            needHeader(name, BUILTIN_HEADERS[name]!, e.line, true);
          } else {
            const key = `fn:${name}`;
            if (!reported.has(key)) {
              reported.add(key);
              errors.push(
                new CError(
                  `Fonction « ${name}() » inconnue : elle n'est pas définie dans ce fichier et le simulateur ne la connaît pas (gcc : undefined reference to '${name}')`,
                  e.line,
                ),
              );
            }
          }
        } else {
          expr(e.callee);
        }
        e.args.forEach(expr);
        return;
      }
      case "unary":
      case "update":
      case "cast":
        expr(e.e);
        return;
      case "bin":
      case "logic":
      case "assign":
      case "comma":
        expr(e.l);
        expr(e.r);
        return;
      case "cond":
        expr(e.c);
        expr(e.a);
        expr(e.b);
        return;
      case "index":
        expr(e.e);
        expr(e.i);
        return;
      case "sizeof":
        expr(e.e);
        return;
      case "init":
        e.items.forEach(expr);
        return;
      default:
        return;
    }
  };

  const stmt = (s: Stmt | null): void => {
    if (!s) return;
    switch (s.k) {
      case "block":
        scopes.push(new Set());
        s.body.forEach(stmt);
        scopes.pop();
        return;
      case "decl":
        for (const d of s.decls) {
          d.type.dims.forEach((x) => expr(x));
          expr(d.init);
          scopes[scopes.length - 1]?.add(d.name);
        }
        return;
      case "expr":
        expr(s.e);
        return;
      case "if":
        expr(s.c);
        stmt(s.then);
        stmt(s.else);
        return;
      case "while":
      case "do":
        expr(s.c);
        stmt(s.body);
        return;
      case "for":
        scopes.push(new Set());
        stmt(s.init);
        expr(s.c);
        expr(s.step);
        stmt(s.body);
        scopes.pop();
        return;
      case "switch":
        expr(s.e);
        stmt(s.body);
        return;
      case "case":
        expr(s.test);
        return;
      case "return":
        expr(s.e);
        return;
      default:
        return;
    }
  };

  for (const g of prog.globals) {
    for (const d of g.decls) {
      expr(d.init);
      globals.add(d.name);
    }
  }
  for (const fn of prog.funcs.values()) {
    scopes.length = 0;
    scopes.push(new Set(fn.params.map((p) => p.name).filter(Boolean)));
    fn.body.body.forEach(stmt);
  }
  errors.sort((a, b) => a.line - b.line);
  warnings.sort((a, b) => a.line - b.line);
  return { errors, warnings };
}
