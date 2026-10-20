import { checkProgram } from "./checker";
import { CError } from "./lexer";
import { parseProgram } from "./parser";

export interface SourceDiagnostics {
  errors: { message: string; line: number }[];
  warnings: { message: string; line: number }[];
}

/** Parses and statically checks a program without running it (used while editing). */
export function checkSource(source: string): SourceDiagnostics {
  try {
    const prog = parseProgram(source);
    const r = checkProgram(prog);
    return { errors: r.errors.map((e) => ({ message: e.message, line: e.line })), warnings: r.warnings };
  } catch (err) {
    if (err instanceof CError) return { errors: [{ message: err.message, line: err.line }], warnings: [] };
    return { errors: [{ message: String(err), line: 1 }], warnings: [] };
  }
}
