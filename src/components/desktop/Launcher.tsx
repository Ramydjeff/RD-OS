// Ctrl+Shift+Space: one box to open apps, Windows programs, recent files,
// guides and commands, run a shell command ("$ ls -la") or ask rAImy Agent.

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, CornerDownLeft, FileCode2, FolderOpen, GraduationCap, Search, TerminalSquare, Zap } from "lucide-react";
import { AppIcon, WinAppIcon } from "@/components/desktop/AppIcon";
import { APPS } from "@/components/desktop/apps";
import { GUIDE_INDEX } from "@/components/apps/guide/content";
import { buildActions, runAction } from "@/features/actions";
import { launchWinApp, openFolder, openInStudio, runInTerminal } from "@/features/desktopActions";
import { cn } from "@/lib/cn";
import { score } from "@/lib/fuzzy";
import { locationDisplay } from "@/lib/paths";
import { askAgent } from "@/store/agent";
import { APP_IDS, useDesktop } from "@/store/desktop";
import { useStudio } from "@/store/studio";
import { useWinApps } from "@/store/winapps";
import { useWorkspace } from "@/store/workspace";

interface Result {
  id: string;
  group: string;
  title: string;
  detail?: string;
  icon: React.ReactNode;
  score: number;
  run: () => void;
}

const GROUP_LIMIT: Record<string, number> = {
  Applications: 6,
  "Programmes Windows": 6,
  Récents: 5,
  Guides: 4,
  Commandes: 5,
};

export function Launcher() {
  const query = useDesktop((s) => s.launcherQuery);
  const setQuery = useDesktop((s) => s.setLauncherQuery);
  const close = () => useDesktop.getState().setOverlay(null);
  const winApps = useWinApps((s) => s.apps);
  const recents = useStudio((s) => s.recents);
  const projects = useWorkspace((s) => s.recentProjects);
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void useWinApps.getState().ensure();
  }, []);

  const results = useMemo<Result[]>(() => {
    const q = query.trim();
    const out: Result[] = [];
    if (q.startsWith("$") || q.startsWith(">")) {
      const cmd = q.slice(1).trim();
      if (cmd) {
        out.push({
          id: "shell",
          group: "Terminal",
          title: `Exécuter : ${cmd}`,
          detail: "Dans le terminal Ubuntu",
          icon: <TerminalSquare size={18} className="text-accent" />,
          score: 9999,
          run: () => void runInTerminal(cmd),
        });
      }
      return out;
    }
    const d = useDesktop.getState();
    for (const id of APP_IDS) {
      const m = APPS[id];
      const s = q ? score(q, m.name, `${m.keywords} ${m.blurb}`) : 0;
      if (s !== null) out.push({ id: `app:${id}`, group: "Applications", title: m.name, detail: m.blurb, icon: <AppIcon app={id} size={28} />, score: s + 50, run: () => d.openApp(id) });
    }
    if (q) {
      for (const a of winApps) {
        const s = score(q, a.name, a.group);
        if (s !== null)
          out.push({
            id: `win:${a.path}`,
            group: "Programmes Windows",
            title: a.name,
            detail: a.group || (a.source === "desktop" ? "Bureau Windows" : "Menu Démarrer"),
            icon: <WinAppIcon path={a.path} name={a.name} size={28} />,
            score: s,
            run: () => void launchWinApp(a.path, a.name),
          });
      }
    }
    for (const r of recents) {
      const s = q ? score(q, r.name, locationDisplay(r.location)) : 0;
      if (s !== null)
        out.push({
          id: `file:${locationDisplay(r.location)}`,
          group: "Récents",
          title: r.name,
          detail: locationDisplay(r.location),
          icon: <FileCode2 size={18} className="text-accent2" />,
          score: s - (q ? 0 : r.openedAt / 1e13),
          run: () => void openInStudio(r.location),
        });
    }
    for (const p of projects) {
      const s = q ? score(q, p.name, locationDisplay(p.location)) : null;
      if (s !== null)
        out.push({
          id: `proj:${locationDisplay(p.location)}`,
          group: "Récents",
          title: p.name,
          detail: locationDisplay(p.location),
          icon: <FolderOpen size={18} className="text-[#f7c35b]" />,
          score: s,
          run: () => openFolder(p.location),
        });
    }
    if (q) {
      for (const g of GUIDE_INDEX) {
        const s = score(q, g.title, g.keywords);
        if (s !== null)
          out.push({
            id: `guide:${g.id}`,
            group: "Guides",
            title: g.title,
            detail: "rAImy Academy",
            icon: <GraduationCap size={18} className="text-[#2dd4bf]" />,
            score: s,
            run: () => d.openApp("guide", { args: { section: g.id } }),
          });
      }
      for (const a of buildActions()) {
        if (!a.enabled || a.id === "palette.open") continue;
        const s = score(q, a.title, `${a.group} ${a.keywords ?? ""}`);
        if (s !== null)
          out.push({ id: `act:${a.id}`, group: "Commandes", title: a.title, detail: a.group, icon: <Zap size={16} className="text-warn" />, score: s - 100, run: () => runAction(a.id) });
      }
    }
    const grouped = new Map<string, Result[]>();
    for (const r of out.sort((a, b) => b.score - a.score)) {
      const list = grouped.get(r.group) ?? [];
      if (list.length < (GROUP_LIMIT[r.group] ?? 5)) list.push(r);
      grouped.set(r.group, list);
    }
    const order = ["Applications", "Récents", "Programmes Windows", "Guides", "Commandes"];
    const flat = order.flatMap((g) => grouped.get(g) ?? []);
    if (q) {
      flat.push({
        id: "ask",
        group: "rAImy Agent",
        title: `Demander à rAImy : « ${q} »`,
        detail: "Réponse de l'IA, avec accès à votre environnement",
        icon: <Bot size={18} className="text-accent" />,
        score: 0,
        run: () => askAgent(q),
      });
    }
    return flat;
  }, [query, winApps, recents, projects]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  function choose(r: Result | undefined) {
    if (!r) return;
    close();
    r.run();
  }

  let lastGroup = "";
  return (
    <div className="absolute inset-0 z-40 flex justify-center bg-black/25 pt-[14vh]" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label="Recherche" className="os-glass-strong os-pop-down flex max-h-[62vh] w-[640px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl shadow-[var(--shadow)]">
        <label className="flex h-14 shrink-0 items-center gap-3 border-b border-glass-line px-5">
          <Search size={18} className="text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher… ($ commande pour le terminal)"
            className="h-full flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-faint"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(results[index]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
          />
        </label>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-muted">Aucun résultat.</p>}
          {results.map((r, i) => {
            const header = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            return (
              <div key={r.id}>
                {header && <p className="px-3 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">{header}</p>}
                <button
                  type="button"
                  data-index={i}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => choose(r)}
                  className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left", i === index ? "bg-active" : "hover:bg-glass")}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center">{r.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-fg">{r.title}</span>
                    {r.detail && <span className="block truncate text-[11px] text-muted">{r.detail}</span>}
                  </span>
                  {i === index && <CornerDownLeft size={14} className="text-muted" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
