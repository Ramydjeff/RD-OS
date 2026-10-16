// Keyboard shortcut model.
//
// Shortcuts are strings such as "Ctrl+Shift+T". Keys use `KeyboardEvent.code`
// style names ("Comma", "Backquote", "F5"), so they are layout independent and
// the same strings are validated by the backend.
//
// Terminal rule: while the terminal has focus, only bindings that include
// Shift or Alt are handled by the app. A plain Ctrl+<key> binding is passed to
// the shell (readline, less, vim and tmux all use them) and the same action is
// reachable through its Ctrl+Shift+<key> alias instead.

export interface ShortcutDef {
  id: string;
  label: string;
  keys: string;
}

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  { id: "terminal.new", label: "New terminal", keys: "Ctrl+Shift+T" },
  { id: "terminal.close", label: "Close active terminal", keys: "Ctrl+Shift+W" },
  { id: "terminal.search", label: "Search terminal output", keys: "Ctrl+F" },
  { id: "terminal.clear", label: "Clear visible terminal", keys: "Ctrl+Shift+K" },
  { id: "view.toggleSidebar", label: "Toggle sidebar", keys: "Ctrl+B" },
  { id: "view.togglePanel", label: "Toggle terminal panel", keys: "Ctrl+Backquote" },
  { id: "view.maximizePanel", label: "Maximize terminal panel", keys: "Ctrl+Shift+M" },
  { id: "palette.open", label: "Command palette", keys: "Ctrl+Shift+P" },
  { id: "settings.open", label: "Open settings", keys: "Ctrl+Comma" },
];

export interface Chord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}

const MODIFIER_ORDER = ["Ctrl", "Shift", "Alt", "Meta"] as const;

export function parseShortcut(s: string): Chord | null {
  const parts = s.split("+");
  const key = parts[parts.length - 1];
  if (!key || parts.length < 2) return null;
  const mods = new Set(parts.slice(0, -1));
  for (const m of mods) if (!MODIFIER_ORDER.includes(m as (typeof MODIFIER_ORDER)[number])) return null;
  return {
    ctrl: mods.has("Ctrl"),
    shift: mods.has("Shift"),
    alt: mods.has("Alt"),
    meta: mods.has("Meta"),
    key,
  };
}

export function chordToString(c: Chord): string {
  const mods = MODIFIER_ORDER.filter((m) => c[m.toLowerCase() as "ctrl" | "shift" | "alt" | "meta"]);
  return [...mods, c.key].join("+");
}

/** `KeyboardEvent.code` -> key name used in shortcut strings. */
export function codeToKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  const named = new Set([
    "Enter", "Escape", "Tab", "Space", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backquote", "Comma", "Period", "Slash", "Backslash",
    "Semicolon", "Quote", "BracketLeft", "BracketRight", "Minus", "Equal",
  ]);
  return named.has(code) ? code : null;
}

type KeyLike = Pick<KeyboardEvent, "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">;

export function eventToChord(e: KeyLike): Chord | null {
  const key = codeToKey(e.code);
  if (!key) return null;
  return { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, key };
}

export function chordEquals(a: Chord, b: Chord): boolean {
  return a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.meta === b.meta && a.key === b.key;
}

const KEY_LABELS: Record<string, string> = {
  Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Semicolon: ";", Quote: "'", BracketLeft: "[",
  BracketRight: "]", Minus: "-", Equal: "=", Backquote: "`", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left",
  ArrowRight: "Right", Escape: "Esc",
};

export function formatShortcut(s: string): string {
  const c = parseShortcut(s);
  if (!c) return s;
  const mods = MODIFIER_ORDER.filter((m) => c[m.toLowerCase() as "ctrl" | "shift" | "alt" | "meta"]);
  return [...mods, KEY_LABELS[c.key] ?? c.key].join("+");
}

/** A binding the terminal itself commonly uses (plain Ctrl+letter/punctuation). */
export function isPlainCtrl(c: Chord): boolean {
  return c.ctrl && !c.shift && !c.alt && !c.meta;
}

export function resolveBindings(overrides: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of DEFAULT_SHORTCUTS) map.set(d.id, overrides[d.id] ?? d.keys);
  return map;
}

export interface Match {
  actionId: string;
  /** Matched through the automatic Ctrl+Shift alias of a plain Ctrl binding. */
  viaAlias: boolean;
}

/**
 * Finds the action for a key event. Explicit bindings always win over aliases.
 * `inTerminal` applies the terminal rule described at the top of this file.
 */
export function matchAction(e: KeyLike, bindings: Map<string, string>, inTerminal: boolean): Match | null {
  const pressed = eventToChord(e);
  if (!pressed) return null;
  let alias: Match | null = null;
  for (const [actionId, keys] of bindings) {
    const chord = parseShortcut(keys);
    if (!chord) continue;
    if (chordEquals(chord, pressed)) {
      if (inTerminal && isPlainCtrl(chord)) continue; // belongs to the shell
      return { actionId, viaAlias: false };
    }
    if (isPlainCtrl(chord) && chordEquals({ ...chord, shift: true }, pressed)) {
      alias ??= { actionId, viaAlias: true };
    }
  }
  return alias;
}

/** Actions whose binding is shadowed by the terminal while it has focus. */
export function terminalConflicts(bindings: Map<string, string>): { actionId: string; keys: string; alias: string }[] {
  const out: { actionId: string; keys: string; alias: string }[] = [];
  for (const [actionId, keys] of bindings) {
    const c = parseShortcut(keys);
    if (c && isPlainCtrl(c)) out.push({ actionId, keys, alias: chordToString({ ...c, shift: true }) });
  }
  return out;
}
