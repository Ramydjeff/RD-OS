// rAImy Academy: installation and learning guides, with live environment
// checks and runnable commands.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bot, CheckCircle2, CircleDashed, LoaderCircle, Play, RefreshCw, Search, XCircle } from "lucide-react";
import { Markdown } from "@/components/apps/agent/Markdown";
import { GUIDE } from "@/components/apps/guide/content";
import { useWindow } from "@/components/desktop/windowContext";
import { currentDistro } from "@/features/agent/tools";
import { runInTerminal } from "@/features/desktopActions";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { score } from "@/lib/fuzzy";
import { ipc } from "@/lib/ipc";
import { askAgent } from "@/store/agent";
import { useDesktop } from "@/store/desktop";
import type { Diagnostics } from "@/types/ipc";

const APT_PACKAGES: Record<string, string> = {
  python3: "python3",
  pip3: "python3-pip",
  git: "git",
  gcc: "build-essential",
  "g++": "build-essential",
  make: "build-essential",
  cmake: "cmake",
};

function EnvCheck() {
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function check() {
    setLoading(true);
    setError(null);
    try {
      setDiag(await ipc.envDiagnostics(await currentDistro()));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void check();
  }, []);

  const relevant = diag?.tools.filter((t) => t.command in APT_PACKAGES) ?? [];
  const missing = [...new Set(relevant.filter((t) => !t.found).map((t) => APT_PACKAGES[t.command]!))];

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-[12.5px] font-semibold text-fg">
          Vérification en direct {diag?.osRelease.prettyName ? <span className="font-normal text-muted">· {diag.osRelease.prettyName}</span> : null}
        </span>
        <button type="button" onClick={() => void check()} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] text-muted hover:bg-hover hover:text-fg">
          <RefreshCw size={12} className={cn(loading && "animate-spin")} /> Revérifier
        </button>
      </div>
      {error ? (
        <div className="flex items-center gap-3 px-4 py-3 text-[12.5px] text-warn">
          <XCircle size={15} /> {error}
          <button type="button" onClick={() => useDesktop.getState().openApp("guide", { args: { section: "installer-wsl" } })} className="ml-auto text-accent2 hover:underline">
            Installer WSL
          </button>
        </div>
      ) : !diag ? (
        <p className="flex items-center gap-2 px-4 py-3 text-[12.5px] text-muted">
          <LoaderCircle size={13} className="animate-spin" /> Analyse d'Ubuntu… (la première fois, la distribution démarre)
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 px-4 py-3 md:grid-cols-3">
            {relevant.map((t) => (
              <div key={t.command} className="flex min-w-0 items-center gap-2 text-[12.5px]">
                {t.found ? <CheckCircle2 size={14} className="shrink-0 text-ok" /> : <CircleDashed size={14} className="shrink-0 text-warn" />}
                <span className="text-fg">{t.label}</span>
                <span className="truncate font-mono text-[10.5px] text-faint">{t.found ? (t.version?.replace(/^.*?(\d+\.\d+(\.\d+)?).*$/, "$1") ?? "") : "absent"}</span>
              </div>
            ))}
          </div>
          {missing.length > 0 ? (
            <div className="flex items-center justify-between gap-3 border-t border-line bg-[var(--active)] px-4 py-2.5">
              <span className="text-[12.5px] text-fg">{missing.length} paquet(s) à installer.</span>
              <button
                type="button"
                onClick={() => void runInTerminal(`sudo apt update && sudo apt install -y ${missing.join(" ")} gdb valgrind python3-venv`)}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-onaccent hover:bg-accent-hover"
              >
                <Play size={12} fill="currentColor" /> Installer dans le terminal
              </button>
            </div>
          ) : (
            <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-ok">Tout est prêt pour programmer en Python, C et C++.</p>
          )}
        </>
      )}
    </div>
  );
}

export default function GuideApp() {
  const { win } = useWindow();
  const [current, setCurrent] = useState(GUIDE[0]!.id);
  const [query, setQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = win.args.section;
    if (typeof s === "string" && GUIDE.some((g) => g.id === s)) setCurrent(s);
  }, [win.args.nonce, win.args.section]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
    useDesktop.getState().setTitle(win.id, GUIDE.find((g) => g.id === current)?.title ?? null);
  }, [current, win.id]);

  const visible = useMemo(() => {
    if (!query.trim()) return GUIDE;
    return GUIDE.filter((g) => score(query, g.title, `${g.keywords} ${g.group}`) !== null || g.body.toLowerCase().includes(query.toLowerCase()));
  }, [query]);
  const groups = [...new Set(visible.map((g) => g.group))];
  const index = GUIDE.findIndex((g) => g.id === current);
  const section = GUIDE[index]!;
  const prev = GUIDE[index - 1];
  const next = GUIDE[index + 1];

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
        <div className="p-3">
          <label className="flex h-8 items-center gap-2 rounded-lg border border-line bg-bg px-2.5 focus-within:border-accent/60">
            <Search size={13} className="text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chercher un guide" className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint" />
          </label>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {groups.map((g) => (
            <div key={g} className="mb-3">
              <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">{g}</p>
              {visible
                .filter((s) => s.group === g)
                .map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setCurrent(s.id)}
                    className={cn(
                      "block w-full truncate rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors",
                      s.id === current ? "bg-active font-medium text-fg shadow-[inset_2px_0_0_var(--accent)]" : "text-fg2 hover:bg-hover",
                    )}
                  >
                    {s.title}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={() => askAgent(`J'ai une question sur « ${section.title} » : `, { fresh: true, send: false })}
            className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-[12px] text-fg2 hover:border-accent/50 hover:text-fg"
          >
            <Bot size={14} className="text-accent" /> Poser une question à rAImy
          </button>
        </div>
      </aside>

      <div ref={contentRef} className="min-w-0 flex-1 overflow-y-auto">
        <article className="mx-auto max-w-3xl px-8 py-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">{section.group}</p>
          <h1 className="mt-1 mb-6 font-display text-[26px] font-semibold leading-tight text-fg">{section.title}</h1>
          {section.widget === "envcheck" && <EnvCheck />}
          <Markdown text={section.body} />
          <div className="mt-10 flex justify-between gap-3 border-t border-line pt-5">
            {prev ? (
              <button type="button" onClick={() => setCurrent(prev.id)} className="flex items-center gap-2 text-left text-[12.5px] text-muted hover:text-fg">
                <ArrowLeft size={14} /> {prev.title}
              </button>
            ) : (
              <span />
            )}
            {next && (
              <button type="button" onClick={() => setCurrent(next.id)} className="flex items-center gap-2 text-right text-[12.5px] text-fg hover:text-accent">
                {next.title} <ArrowRight size={14} />
              </button>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}
