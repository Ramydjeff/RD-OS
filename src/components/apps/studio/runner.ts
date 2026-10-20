// Code Studio's own terminal: a private session (not a Terminal-app tab)
// where programs are compiled and run, so their input/output stays next to
// the code. Compiler errors are read back from its screen.

import { createController, destroyController, getController } from "@/components/terminal/registry";
import { shQuote } from "@/lib/fileTypes";
import { useTerminals } from "@/store/terminals";
import type { Location } from "@/types/ipc";

let studioTerminal: string | null = null;

export function studioTerminalId(): string | null {
  return studioTerminal;
}

function waitRunning(id: string, timeoutMs = 20_000): Promise<boolean> {
  return new Promise((resolve) => {
    const state = () => useTerminals.getState().meta[id]?.state;
    if (state() === "running") return resolve(true);
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, timeoutMs);
    const off = useTerminals.subscribe(() => {
      const s = state();
      if (s === "running" || s === "failed") {
        clearTimeout(timer);
        off();
        resolve(s === "running");
      }
    });
  });
}

/** The studio terminal, created (and started once mounted) on first use. */
export function ensureStudioTerminal(distro: string, cwd: Location | null): string {
  if (studioTerminal && getController(studioTerminal)) return studioTerminal;
  studioTerminal = crypto.randomUUID();
  createController(studioTerminal, { distro, cwd });
  return studioTerminal;
}

/** Types `cd <dir> && clear && <command>` in the studio terminal and runs it. */
export async function runInStudioTerminal(linuxDir: string, command: string): Promise<boolean> {
  const id = studioTerminal;
  const c = id ? getController(id) : undefined;
  if (!id || !c) return false;
  if (c.meta.state === "exited" || c.meta.state === "failed") await c.restart();
  if (!(await waitRunning(id))) return false;
  c.term.input(`cd ${shQuote(linuxDir)} && clear && ${command}\r`);
  c.focus();
  return true;
}

/** The last `n` lines currently on the studio terminal (for error parsing and "Corriger"). */
export function studioOutput(n = 80): string {
  const c = studioTerminal ? getController(studioTerminal) : undefined;
  if (!c) return "";
  const buf = c.term.buffer.active;
  const end = buf.baseY + buf.cursorY;
  const lines: string[] = [];
  for (let i = Math.max(0, end - n); i <= end; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? "");
  return lines.join("\n").replace(/\n+$/, "");
}

export async function disposeStudioTerminal(): Promise<void> {
  const id = studioTerminal;
  studioTerminal = null;
  if (id) await destroyController(id);
}

/** Compiler / interpreter diagnostics for `fileName` found in `output`: line -> message. */
export function parseDiagnostics(output: string, fileName: string): Map<number, string> {
  const map = new Map<number, string>();
  const esc = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const gcc = new RegExp(`(?:^|/)${esc}:(\\d+):(?:\\d+:)?\\s*(?:fatal )?(error|erreur|warning|avertissement)\\s*:\\s*(.*)$`, "i");
  const py = new RegExp(`File "(?:[^"]*/)?${esc}", line (\\d+)`);
  const lines = output.split("\n");
  lines.forEach((line, i) => {
    const g = gcc.exec(line.trim());
    if (g) {
      const n = Number(g[1]);
      const prefix = /warn|avert/i.test(g[2]!) ? "Avertissement" : "Erreur";
      if (!map.has(n) || prefix === "Erreur") map.set(n, `${prefix} : ${g[3]}`);
      return;
    }
    const p = py.exec(line);
    if (p) {
      // The exception message is the last non-indented line of the traceback.
      const msg = lines.slice(i + 1).find((l) => /^\w+(Error|Exception|Warning)\b/.test(l)) ?? "Erreur Python";
      map.set(Number(p[1]), msg.trim());
    }
  });
  return map;
}
