// Lightweight code editor: a native <textarea> (so typing, selection, IME and
// undo stay native) over a highlighted layer that only renders the visible
// lines. Both layers use the same font metrics and scroll together.

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { HIGHLIGHT_MAX_LINES, TOKEN_STYLE, highlight, languageFromFileName, type Lang, type Tok } from "@/lib/highlight";

const LH = 20; // line height, px
const PAD_Y = 10;
const PAD_X = 14;
const OVERSCAN = 30;
const INDENT = "    ";

const LINE_COMMENT: Partial<Record<Lang, string>> = {
  c: "//",
  cpp: "//",
  js: "//",
  ts: "//",
  python: "#",
  shell: "#",
};

export interface CodeEditorProps {
  value: string;
  /** Omit for a read-only view. */
  onChange?: (value: string) => void;
  language?: Lang;
  /** Used to pick the language when `language` is not given. */
  fileName?: string;
  onSave?: () => void;
  onSubmit?: () => void;
  /** Line number -> message: tinted line and red gutter number. */
  errorLines?: Map<number, string>;
  className?: string;
  autoFocus?: boolean;
}

/** Inserts text at the selection through the browser so Ctrl+Z keeps working. */
function insertText(ta: HTMLTextAreaElement, text: string) {
  ta.focus();
  if (!document.execCommand?.("insertText", false, text)) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/** Replaces whole lines [from, to] of the selection with `map(line)` and keeps them selected. */
function editLines(ta: HTMLTextAreaElement, map: (line: string) => string) {
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const start = value.lastIndexOf("\n", s - 1) + 1;
  const endNl = value.indexOf("\n", e > s && value[e - 1] === "\n" ? e - 1 : e);
  const end = endNl < 0 ? value.length : endNl;
  const next = value.slice(start, end).split("\n").map(map).join("\n");
  ta.setSelectionRange(start, end);
  insertText(ta, next);
  ta.setSelectionRange(start, start + next.length);
}

export function CodeEditor({ value, onChange, language, fileName, onSave, onSubmit, errorLines, className, autoFocus }: CodeEditorProps) {
  const lang = language ?? (fileName ? languageFromFileName(fileName) : "plain");
  const readOnly = !onChange;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef(0);
  const [view, setView] = useState({ top: 0, left: 0, height: 600 });
  const [caretLine, setCaretLine] = useState(1);

  const lines: Tok[][] = useMemo(() => {
    const count = value.length > 400_000 ? Infinity : value.split("\n").length;
    return count > HIGHLIGHT_MAX_LINES ? highlight(value, "plain") : highlight(value, lang);
  }, [value, lang]);

  const total = lines.length;
  const first = Math.max(0, Math.floor((view.top - PAD_Y) / LH) - OVERSCAN);
  const last = Math.min(total - 1, Math.ceil((view.top + view.height) / LH) + OVERSCAN);
  firstRef.current = first;
  const offsetY = PAD_Y + first * LH - view.top;

  // Keep the layers aligned in the same frame as the native scroll; React then
  // re-renders the visible window (the overscan hides the one-frame delay).
  const onScroll = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const y = PAD_Y + firstRef.current * LH - ta.scrollTop;
    if (layerRef.current) layerRef.current.style.transform = `translate(${-ta.scrollLeft}px, ${y}px)`;
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${y}px)`;
    setView((v) => (v.top === ta.scrollTop && v.left === ta.scrollLeft ? v : { ...v, top: ta.scrollTop, left: ta.scrollLeft }));
  }, []);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const ro = new ResizeObserver(() => setView((v) => ({ ...v, height: ta.clientHeight })));
    ro.observe(ta);
    if (autoFocus) ta.focus({ preventScroll: true });
    return () => ro.disconnect();
  }, [autoFocus]);

  const trackCaret = () => {
    const ta = taRef.current;
    if (!ta) return;
    let n = 1;
    const pos = ta.selectionStart;
    for (let i = ta.value.indexOf("\n"); i >= 0 && i < pos; i = ta.value.indexOf("\n", i + 1)) n++;
    setCaretLine(n);
  };

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave?.();
      return;
    }
    if (mod && e.key === "Enter") {
      e.preventDefault();
      onSubmit?.();
      return;
    }
    if (readOnly) return;
    if (e.key === "Tab") {
      e.preventDefault();
      const multi = ta.value.slice(ta.selectionStart, ta.selectionEnd).includes("\n");
      if (e.shiftKey) editLines(ta, (l) => l.replace(/^( {1,4}|\t)/, ""));
      else if (multi) editLines(ta, (l) => (l ? INDENT + l : l));
      else insertText(ta, INDENT);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !mod && !e.altKey) {
      const { value: v, selectionStart: s } = ta;
      const lineStart = v.lastIndexOf("\n", s - 1) + 1;
      const indent = v.slice(lineStart).match(/^[ \t]*/)?.[0] ?? "";
      const before = v.slice(lineStart, s).trimEnd();
      const opens = before.endsWith("{") || (lang === "python" && before.endsWith(":"));
      e.preventDefault();
      if (opens && v[s] === "}") {
        insertText(ta, `\n${indent}${INDENT}\n${indent}`);
        const caret = s + 1 + indent.length + INDENT.length;
        ta.setSelectionRange(caret, caret);
      } else {
        insertText(ta, `\n${indent}${opens ? INDENT : ""}`);
      }
      return;
    }
    const comment = LINE_COMMENT[lang];
    if (mod && e.key === "/" && comment) {
      e.preventDefault();
      const { value: v, selectionStart: s, selectionEnd: en } = ta;
      const start = v.lastIndexOf("\n", s - 1) + 1;
      const end = v.indexOf("\n", en) < 0 ? v.length : v.indexOf("\n", en);
      const block = v.slice(start, end).split("\n").filter((l) => l.trim());
      const allCommented = block.length > 0 && block.every((l) => l.trimStart().startsWith(comment));
      editLines(ta, (l) => {
        if (!l.trim()) return l;
        if (allCommented) return l.replace(new RegExp(`^(\\s*)${comment.replace(/[/]/g, "\\/")} ?`), "$1");
        const ind = l.match(/^\s*/)?.[0] ?? "";
        return `${ind}${comment} ${l.slice(ind.length)}`;
      });
    }
  }

  const digits = Math.max(3, String(total).length);
  const rows: React.ReactNode[] = [];
  const nums: React.ReactNode[] = [];
  for (let i = first; i <= last; i++) {
    const n = i + 1;
    const err = errorLines?.get(n);
    const toks = lines[i]!;
    rows.push(
      <div
        key={n}
        className={cn("whitespace-pre", err ? "bg-danger/12" : n === caretLine && !readOnly && "bg-codeline")}
        style={{ height: LH, paddingLeft: PAD_X }}
      >
        {toks.length === 0
          ? " "
          : toks.map((t, k) => (
              <span key={k} className={t.c ? TOKEN_STYLE[t.c] : undefined}>
                {t.t}
              </span>
            ))}
      </div>,
    );
    nums.push(
      <div
        key={n}
        title={err}
        className={cn("pr-3 text-right", err ? "font-semibold text-danger" : n === caretLine ? "text-fg2" : "text-faint")}
        style={{ height: LH }}
      >
        {n}
      </div>,
    );
  }

  return (
    <div className={cn("relative flex h-full min-h-0 overflow-hidden bg-code font-mono text-[12.5px]", className)} style={{ lineHeight: `${LH}px`, tabSize: 4 }}>
      <div className="relative shrink-0 overflow-hidden border-r border-line/70 select-none" style={{ width: `${digits + 2.5}ch` }}>
        <div ref={gutterRef} className="absolute inset-x-0 top-0" style={{ transform: `translateY(${offsetY}px)` }}>
          {nums}
        </div>
      </div>
      <div className="relative min-w-0 flex-1">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div ref={layerRef} className="min-w-max text-fg" style={{ transform: `translate(${-view.left}px, ${offsetY}px)` }}>
            {rows}
          </div>
        </div>
        <textarea
          ref={taRef}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange?.(e.target.value)}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          onSelect={trackCaret}
          onClick={trackCaret}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          aria-label={fileName ? `Contenu de ${fileName}` : "Éditeur de code"}
          className="selectable absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre bg-transparent text-transparent caret-[var(--fg)] outline-none [-webkit-text-fill-color:transparent] selection:bg-[var(--selection)]"
          style={{ padding: `${PAD_Y}px ${PAD_X}px`, lineHeight: `${LH}px`, tabSize: 4 }}
        />
      </div>
    </div>
  );
}
