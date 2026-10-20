// Command palette (Ctrl+Shift+P): everything the app can do, plus open files
// and recent projects, reachable by typing a few letters.

import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, FolderOpen, Search, Zap } from "lucide-react";
import { FileIcon } from "@/components/explorer/fileIcons";
import { Keys } from "@/components/ui/Fields";
import { buildActions, runAction } from "@/features/actions";
import { cn } from "@/lib/cn";
import { locationDisplay, locationKey } from "@/lib/paths";
import { formatShortcut, resolveBindings } from "@/lib/shortcuts";
import { useEditor } from "@/store/editor";
import { useSettings } from "@/store/settings";
import { useUi } from "@/store/ui";
import { useWorkspace } from "@/store/workspace";

interface Entry {
  id: string;
  title: string;
  group: string;
  detail?: string;
  keywords?: string;
  shortcut?: string;
  icon: React.ReactNode;
  run: () => void;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Subsequence match; word starts and consecutive letters score higher. */
function fuzzy(query: string, text: string): { score: number; hits: number[] } | null {
  const q = fold(query);
  const t = fold(text);
  if (!q) return { score: 0, hits: [] };
  const direct = t.indexOf(q);
  if (direct >= 0) {
    const atWord = direct === 0 || /[\s/._-]/.test(t[direct - 1]!);
    return { score: 1000 - direct + (atWord ? 200 : 0), hits: Array.from({ length: q.length }, (_, i) => direct + i) };
  }
  const hits: number[] = [];
  let score = 0;
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    if (ch === " ") continue;
    while (ti < t.length && t[ti] !== ch) ti++;
    if (ti >= t.length) return null;
    const prev = hits[hits.length - 1];
    score += prev === ti - 1 ? 8 : 1;
    if (ti === 0 || /[\s/._-]/.test(t[ti - 1]!)) score += 6;
    hits.push(ti);
    ti++;
  }
  return { score, hits };
}

function Marked({ text, hits }: { text: string; hits: number[] }) {
  if (hits.length === 0) return <>{text}</>;
  const set = new Set(hits);
  return (
    <>
      {Array.from(text).map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="font-semibold text-accent">
            {ch}
          </span>
        ) : (
          ch
        ),
      )}
    </>
  );
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  if (!open) return null;
  return <Palette />;
}

function Palette() {
  const close = () => useUi.getState().setPaletteOpen(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  const entries = useMemo((): Entry[] => {
    const keys = resolveBindings(useSettings.getState().settings.shortcuts);
    const out: Entry[] = [];
    const editor = useEditor.getState();
    for (const f of editor.files) {
      out.push({
        id: `file:${f.key}`,
        title: f.name,
        group: "Fichiers ouverts",
        detail: f.rel,
        icon: <FileIcon name={f.name} size={14} />,
        run: () => {
          useEditor.getState().setActive(f.key);
          useWorkspace.getState().setView("explorer");
        },
      });
    }
    for (const a of buildActions()) {
      if (!a.enabled || a.id === "palette.open") continue;
      const k = a.shortcutId ? keys.get(a.shortcutId) : undefined;
      out.push({
        id: a.id,
        title: a.title,
        group: a.group,
        keywords: a.keywords,
        shortcut: k ? formatShortcut(k) : undefined,
        icon: <Zap size={13} className="text-faint" />,
        run: () => runAction(a.id),
      });
    }
    const current = useWorkspace.getState().project;
    for (const r of useWorkspace.getState().recentProjects) {
      if (current && locationKey(current) === locationKey(r.location)) continue;
      out.push({
        id: `recent:${locationKey(r.location)}`,
        title: `Ouvrir ${r.name}`,
        group: "Projets récents",
        detail: locationDisplay(r.location),
        icon: <FolderOpen size={13} className="text-faint" />,
        run: () => useWorkspace.getState().openProject(r.location),
      });
    }
    return out;
  }, []);

  const results = useMemo(() => {
    if (!query.trim()) return entries.map((e) => ({ e, hits: [] as number[], score: 0 }));
    const scored: { e: Entry; hits: number[]; score: number }[] = [];
    for (const e of entries) {
      const m = fuzzy(query, e.title);
      const k = m ? null : fuzzy(query, `${e.keywords ?? ""} ${e.detail ?? ""} ${e.group}`);
      if (m) scored.push({ e, hits: m.hits, score: m.score + 50 });
      else if (k) scored.push({ e, hits: [], score: k.score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 60);
  }, [entries, query]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    inputRef.current?.focus();
    const prev = previous.current;
    return () => prev?.focus?.();
  }, []);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const runAt = (i: number) => {
    const r = results[i];
    if (!r) return;
    close();
    // Let the palette unmount (and focus return) before the command runs.
    requestAnimationFrame(() => r.e.run());
  };

  let lastGroup = "";
  return (
    <div className="fade-in fixed inset-0 z-[70] flex justify-center bg-[var(--overlay)]/60 px-4 pt-[9vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Palette de commandes" className="pop-in flex h-fit max-h-[70vh] w-full max-w-[600px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-elevated shadow-[var(--shadow)]">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "PageDown") {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 8));
              } else if (e.key === "PageUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 8));
              } else if (e.key === "Enter") {
                e.preventDefault();
                runAt(index);
              }
            }}
            placeholder="Tapez une commande, un fichier ouvert, un projet…"
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[index] ? `palette-${index}` : undefined}
            className="h-12 min-w-0 flex-1 bg-transparent font-display text-[15px] text-fg outline-none placeholder:text-faint"
          />
          <kbd className="shrink-0 rounded border border-line-strong px-1.5 font-mono text-[10px] text-faint">Échap</kbd>
        </div>
        <div ref={listRef} id="palette-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-muted">Aucun résultat pour « {query} ».</p>}
          {results.map(({ e, hits }, i) => {
            const heading = !query.trim() && e.group !== lastGroup ? e.group : null;
            lastGroup = e.group;
            return (
              <div key={e.id}>
                {heading && <div className="eyebrow px-2.5 pb-1 pt-2.5">{heading}</div>}
                <div
                  id={`palette-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === index}
                  onMouseMove={() => i !== index && setIndex(i)}
                  onClick={() => runAt(i)}
                  className={cn(
                    "flex h-9 cursor-default items-center gap-3 rounded-[var(--radius-sm)] px-2.5 text-[13px]",
                    i === index ? "bg-active text-fg" : "text-fg2",
                  )}
                >
                  <span className="flex w-4 shrink-0 justify-center">{e.icon}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <Marked text={e.title} hits={hits} />
                    {e.detail && <span className="ml-2 font-mono text-[11px] text-faint">{e.detail}</span>}
                  </span>
                  {query.trim() && <span className="shrink-0 text-[11px] text-faint">{e.group}</span>}
                  {e.shortcut && <Keys combo={e.shortcut} className="shrink-0" />}
                  {i === index && !e.shortcut && <CornerDownLeft size={13} className="shrink-0 text-faint" />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-line bg-surface/60 px-4 py-2 text-[11px] text-faint">
          <span>↑ ↓ naviguer</span>
          <span>Entrée exécuter</span>
          <span>Échap fermer</span>
        </div>
      </div>
    </div>
  );
}
