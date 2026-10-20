// Code Studio: tabs, the shared code editor, and a build-and-run terminal for
// Python, C, C++ and Bash. Compiler errors are marked in the gutter, and
// rAImy Agent can explain the code or fix the last error.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Bug,
  ChevronDown,
  Circle,
  Code2,
  FileCode2,
  FolderOpen,
  Gauge,
  PanelBottomClose,
  PanelBottomOpen,
  Play,
  Save,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { TEMPLATES } from "@/components/apps/studio/templates";
import {
  disposeStudioTerminal,
  ensureStudioTerminal,
  parseDiagnostics,
  runInStudioTerminal,
  studioOutput,
  studioTerminalId,
} from "@/components/apps/studio/runner";
import { AppIcon } from "@/components/desktop/AppIcon";
import { useWindow } from "@/components/desktop/windowContext";
import { FolderPicker } from "@/components/explorer/FolderPicker";
import { getController } from "@/components/terminal/registry";
import { CodeEditor } from "@/components/ui/CodeEditor";
import { ContextMenu, type MenuItem } from "@/components/ui/ContextMenu";
import { currentDistro, linuxHome } from "@/features/agent/tools";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { debugCommand, runCommand, runLang, valgrindCommand, type RunLang } from "@/lib/fileTypes";
import { LANG_LABEL, languageFromFileName } from "@/lib/highlight";
import { ipc } from "@/lib/ipc";
import { locationDisplay, parentLocation, validateEntryName } from "@/lib/paths";
import { askAgent } from "@/store/agent";
import { useDesktop } from "@/store/desktop";
import { isDirty, useStudio, type StudioTab } from "@/store/studio";
import { useSettings } from "@/store/settings";
import { confirmDialog, promptDialog, toast } from "@/store/ui";
import type { Location } from "@/types/ipc";

type RunKind = "run" | "debug" | "valgrind";

function EmbeddedTerminal({ id, visible }: { id: string; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = getController(id);
    const el = host.current;
    if (!c || !el) return;
    c.mount(el);
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => c.fit());
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [id]);
  useEffect(() => {
    getController(id)?.setVisible(visible);
  }, [id, visible]);
  return <div ref={host} className="absolute inset-0 bg-term" />;
}

export default function StudioApp() {
  const { win, visible } = useWindow();
  const tabs = useStudio((s) => s.tabs);
  const activeId = useStudio((s) => s.activeId);
  const recents = useStudio((s) => s.recents);
  const runOptions = useStudio((s) => s.runOptions);
  const defaultDir = useSettings((s) => s.settings.defaultProjectDir);
  const tab = tabs.find((t) => t.id === activeId) ?? null;

  const [termId, setTermId] = useState<string | null>(studioTerminalId());
  const [outputOpen, setOutputOpen] = useState(false);
  const [outputH, setOutputH] = useState(240);
  const [saveAsFor, setSaveAsFor] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, Map<number, string>>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; items: (MenuItem | "separator")[] } | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const scanTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const saveAsResolve = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    useDesktop.getState().setTitle(win.id, tab ? `${tab.name}${isDirty(tab) ? " •" : ""}` : null);
  }, [tab, win.id]);

  // The private terminal ends with the window.
  useEffect(
    () => () => {
      clearInterval(scanTimer.current);
      void disposeStudioTerminal();
    },
    [],
  );

  const lang: RunLang | null = tab ? runLang(tab.name) : null;

  async function save(t: StudioTab): Promise<boolean> {
    if (!t.location) return saveAs(t.id);
    const err = await useStudio.getState().save(t.id);
    if (err) {
      toast("error", err);
      return false;
    }
    return true;
  }

  function saveAs(id: string): Promise<boolean> {
    setSaveAsFor(id);
    return new Promise((resolve) => {
      saveAsResolve.current = resolve;
    });
  }

  async function finishSaveAs(dir: Location) {
    const id = saveAsFor;
    setSaveAsFor(null);
    const t = useStudio.getState().tabs.find((x) => x.id === id);
    if (!t) return saveAsResolve.current?.(false);
    const name = await promptDialog({
      title: "Enregistrer sous",
      label: `Nom du fichier dans ${locationDisplay(dir)}`,
      initial: t.name,
      confirmLabel: "Enregistrer",
      validate: validateEntryName,
    });
    if (!name) return saveAsResolve.current?.(false);
    const err = await useStudio.getState().saveAs(t.id, dir, name);
    if (err) toast("error", err);
    else toast("success", `${name} enregistré.`);
    saveAsResolve.current?.(!err);
  }

  async function run(kind: RunKind) {
    const t = useStudio.getState().tabs.find((x) => x.id === useStudio.getState().activeId);
    if (!t) return;
    const l = runLang(t.name);
    if (!l) {
      toast("info", "Ce type de fichier ne s'exécute pas. Utilisez un fichier .py, .c, .cpp ou .sh.");
      return;
    }
    if ((isDirty(t) || !t.location) && !(await save(t))) return;
    const saved = useStudio.getState().tabs.find((x) => x.id === t.id);
    if (!saved?.location) return;
    const dir = parentLocation(saved.location);
    if (!dir) return;
    let cmd: string | null;
    if (kind === "debug") cmd = debugCommand(saved.name, l, runOptions);
    else if (kind === "valgrind") cmd = valgrindCommand(saved.name, l, runOptions);
    else cmd = runCommand(saved.name, l, runOptions);
    if (!cmd) {
      toast("info", kind === "valgrind" ? "Valgrind s'utilise avec du C ou du C++." : "Pas de débogueur pour ce langage.");
      return;
    }
    try {
      const distro = dir.kind === "linux" ? dir.distro : await currentDistro();
      const linuxDir = dir.kind === "linux" ? dir.path : await ipc.wslToLinuxPath(distro, dir.path);
      setTermId(ensureStudioTerminal(distro, dir));
      setOutputOpen(true);
      setErrors((e) => ({ ...e, [saved.id]: new Map() }));
      if (!(await runInStudioTerminal(linuxDir, cmd))) {
        toast("error", "Le terminal de Code Studio n'a pas pu démarrer. Vérifiez WSL dans « Ubuntu & WSL ».");
        return;
      }
      // Read compiler/interpreter diagnostics back from the screen for a while.
      clearInterval(scanTimer.current);
      const started = Date.now();
      scanTimer.current = setInterval(() => {
        const found = parseDiagnostics(studioOutput(200), saved.name);
        setErrors((e) => {
          const prev = e[saved.id];
          if (prev && prev.size === found.size && [...found].every(([k, v]) => prev.get(k) === v)) return e;
          return { ...e, [saved.id]: found };
        });
        if (found.size) useStudio.getState().setLastError({ tabId: saved.id, text: studioOutput(80) });
        if (Date.now() - started > 20_000) clearInterval(scanTimer.current);
      }, 600);
    } catch (e) {
      toast("error", errorMessage(e));
    }
  }

  async function closeTab(t: StudioTab) {
    if (isDirty(t)) {
      const ok = await confirmDialog({
        title: `Fermer ${t.name} ?`,
        message: "Les modifications non enregistrées seront perdues.",
        confirmLabel: "Fermer sans enregistrer",
        danger: true,
      });
      if (!ok) return;
    }
    useStudio.getState().closeTab(t.id);
  }

  function explain() {
    if (!tab) return;
    askAgent(
      `Explique-moi ce programme (${tab.name}) étape par étape, puis signale les erreurs ou mauvaises pratiques éventuelles.\n\n\`\`\`${languageFromFileName(tab.name)}\n${tab.content}\n\`\`\``,
      { fresh: true },
    );
  }

  function fix() {
    if (!tab) return;
    const out = studioOutput(80);
    const where = tab.location ? ` (${locationDisplay(tab.location)})` : "";
    askAgent(
      `Mon programme ${tab.name}${where} ne fonctionne pas. Explique l'erreur puis propose la correction (corrige le fichier si c'est simple).\n\n\`\`\`${languageFromFileName(tab.name)}\n${tab.content}\n\`\`\`${out.trim() ? `\n\nSortie du terminal :\n\`\`\`\n${out}\n\`\`\`` : ""}`,
      { fresh: true },
    );
  }

  function newMenu(e: React.MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: r.left,
      y: r.bottom + 4,
      items: TEMPLATES.map((t) => ({ id: t.id, label: t.label, icon: <FileCode2 size={13} />, onSelect: () => useStudio.getState().newFile(t.id) })),
    });
  }

  function onOutputResize(e: React.PointerEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const sy = e.clientY;
    const sh = outputH;
    const move = (ev: PointerEvent) => setOutputH(Math.max(110, Math.min(700, sh + sy - ev.clientY)));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  const errorLines = tab ? errors[tab.id] : undefined;
  const lines = useMemo(() => (tab ? tab.content.split("\n").length : 0), [tab]);

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={(e) => {
        if (e.key === "F5") {
          e.preventDefault();
          void run(e.shiftKey ? "debug" : "run");
        }
      }}
    >
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line bg-surface px-2 py-1.5">
        <ToolButton icon={<FileCode2 size={14} />} label="Nouveau" trailing={<ChevronDown size={12} />} onClick={newMenu} />
        <ToolButton icon={<FolderOpen size={14} />} label="Ouvrir" onClick={() => useDesktop.getState().openApp("files", { newWindow: true })} />
        <ToolButton icon={<Save size={14} />} label="Enregistrer" disabled={!tab} onClick={() => tab && void save(tab)} />
        <span className="mx-1 h-5 w-px bg-line" />
        <button
          type="button"
          disabled={!tab || !lang}
          onClick={() => void run("run")}
          title="Compiler et exécuter (Ctrl+Entrée ou F5)"
          className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[12.5px] font-semibold text-onaccent shadow-[0_4px_14px_-4px_var(--accent)] transition-[background-color,transform] hover:bg-accent-hover active:scale-95 disabled:opacity-40 disabled:shadow-none"
        >
          <Play size={13} fill="currentColor" /> Exécuter
        </button>
        <ToolButton icon={<Bug size={14} />} label="Déboguer" title="gdb / pdb (Maj+F5)" disabled={!tab || !lang} onClick={() => void run("debug")} />
        {(lang === "c" || lang === "cpp") && <ToolButton icon={<Gauge size={14} />} label="Valgrind" title="Détecter les fuites mémoire" onClick={() => void run("valgrind")} />}
        <ToolButton icon={<Settings2 size={14} />} label="" title="Options de compilation" onClick={() => setOptionsOpen((o) => !o)} />
        <div className="flex-1" />
        <ToolButton icon={<Sparkles size={14} className="text-accent" />} label="Expliquer" disabled={!tab} onClick={explain} />
        <ToolButton icon={<Bot size={14} className="text-accent" />} label="Corriger" disabled={!tab} onClick={fix} />
        <ToolButton
          icon={outputOpen ? <PanelBottomClose size={14} /> : <PanelBottomOpen size={14} />}
          label=""
          title="Afficher la sortie"
          disabled={!termId}
          onClick={() => setOutputOpen((o) => !o)}
        />
      </div>

      {optionsOpen && (
        <div className="grid shrink-0 grid-cols-2 gap-3 border-b border-line bg-surface px-4 py-3 text-[12px] lg:grid-cols-4">
          <OptionField label="Options gcc (C)" value={runOptions.cFlags} onChange={(v) => useStudio.getState().setRunOptions({ cFlags: v })} />
          <OptionField label="Options g++ (C++)" value={runOptions.cppFlags} onChange={(v) => useStudio.getState().setRunOptions({ cppFlags: v })} />
          <OptionField label="Interpréteur Python" value={runOptions.python} onChange={(v) => useStudio.getState().setRunOptions({ python: v })} />
          <OptionField label="Arguments du programme" value={runOptions.args} onChange={(v) => useStudio.getState().setRunOptions({ args: v })} />
        </div>
      )}

      {/* Tabs */}
      {tabs.length > 0 && (
        <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-surface">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={cn(
                "group flex min-w-0 max-w-52 shrink-0 cursor-default items-center gap-2 border-r border-line pr-1.5 pl-3 text-[12px]",
                t.id === activeId ? "bg-bg text-fg shadow-[inset_0_2px_0_var(--accent)]" : "text-muted hover:bg-hover",
              )}
              onClick={() => useStudio.getState().setActive(t.id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  void closeTab(t);
                }
              }}
              title={t.location ? locationDisplay(t.location) : "Non enregistré"}
            >
              <Code2 size={12} className="shrink-0 text-accent2" />
              <span className="truncate">{t.name}</span>
              <button
                type="button"
                aria-label={`Fermer ${t.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void closeTab(t);
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg"
              >
                {isDirty(t) ? <Circle size={8} fill="currentColor" className="group-hover:hidden" /> : null}
                <X size={12} className={cn(isDirty(t) && "hidden group-hover:block")} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Editor */}
      <div className="relative min-h-0 flex-1">
        {tab ? (
          <CodeEditor
            key={tab.id}
            value={tab.content}
            onChange={(v) => useStudio.getState().update(tab.id, v)}
            fileName={tab.name}
            onSave={() => void save(tab)}
            onSubmit={() => void run("run")}
            errorLines={errorLines}
            autoFocus
            className="h-full"
          />
        ) : (
          <Welcome
            recents={recents}
            onTemplate={(id) => useStudio.getState().newFile(id)}
            onRecent={(loc) => void useStudio.getState().openFile(loc).catch((e) => toast("error", errorMessage(e)))}
          />
        )}
      </div>

      {/* Output */}
      {termId && (
        <div className={cn("relative shrink-0 border-t border-line", !outputOpen && "hidden")} style={{ height: outputH }}>
          <div className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize" onPointerDown={onOutputResize} />
          <div className="flex h-7 items-center justify-between border-b border-line bg-surface px-3 text-[11px] text-muted">
            <span className="font-semibold uppercase tracking-[0.12em]">Sortie</span>
            <span className="truncate font-mono">{errorLines?.size ? `${errorLines.size} ligne(s) signalée(s) dans l'éditeur` : "Le programme peut lire au clavier ici"}</span>
          </div>
          <div className="absolute inset-x-0 top-7 bottom-0">
            <EmbeddedTerminal id={termId} visible={visible && outputOpen} />
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-surface px-3 text-[11px] text-muted">
        {tab ? (
          <>
            <span className="text-fg2">{LANG_LABEL[languageFromFileName(tab.name)]}</span>
            <span>{lines} lignes</span>
            <span className="min-w-0 flex-1 truncate font-mono">{tab.location ? locationDisplay(tab.location) : "Non enregistré"}</span>
            <span className={isDirty(tab) ? "text-warn" : "text-ok"}>{isDirty(tab) ? "Modifié" : "Enregistré"}</span>
          </>
        ) : (
          <span>Ctrl+S enregistrer · Ctrl+Entrée exécuter · F5 exécuter · Maj+F5 déboguer</span>
        )}
      </div>

      {saveAsFor && (
        <FolderPicker
          title="Enregistrer dans…"
          confirmLabel="Choisir ce dossier"
          initial={defaultDir}
          onClose={() => {
            setSaveAsFor(null);
            saveAsResolve.current?.(false);
          }}
          onSelect={(loc) => void finishSaveAs(loc)}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function ToolButton({
  icon,
  label,
  title,
  trailing,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  trailing?: React.ReactNode;
  disabled?: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] text-fg2 transition-colors hover:bg-hover hover:text-fg disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {icon}
      {label && <span>{label}</span>}
      {trailing}
    </button>
  );
}

function OptionField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded-md border border-line bg-bg px-2 font-mono text-[11.5px] text-fg outline-none focus:border-accent/60"
      />
    </label>
  );
}

function Welcome({
  recents,
  onTemplate,
  onRecent,
}: {
  recents: { name: string; location: Location }[];
  onTemplate: (id: string) => void;
  onRecent: (loc: Location) => void;
}) {
  const [home, setHome] = useState<string | null>(null);
  useEffect(() => {
    void currentDistro()
      .then(linuxHome)
      .then(setHome)
      .catch(() => undefined);
  }, []);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-10">
        <div className="flex items-center gap-4">
          <AppIcon app="studio" size={52} />
          <div>
            <h2 className="font-display text-[24px] font-semibold text-fg">Code Studio</h2>
            <p className="text-[13px] text-muted">Écrivez, compilez et exécutez du Python, du C et du C++ dans Ubuntu, sans quitter votre bureau.</p>
          </div>
        </div>
        <h3 className="mt-8 mb-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Commencer un fichier</h3>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTemplate(t.id)}
              className="group rounded-xl border border-line bg-surface p-4 text-left transition-[border-color,transform] hover:-translate-y-0.5 hover:border-accent/50"
            >
              <span className="font-mono text-[11px] text-accent">{t.fileName}</span>
              <span className="mt-1 block text-[13px] font-medium text-fg">{t.label}</span>
            </button>
          ))}
        </div>
        {recents.length > 0 && (
          <>
            <h3 className="mt-8 mb-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Fichiers récents</h3>
            <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {recents.slice(0, 8).map((r) => (
                <button key={locationDisplay(r.location)} type="button" onClick={() => onRecent(r.location)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover">
                  <FileCode2 size={14} className="text-accent2" />
                  <span className="text-[12.5px] text-fg">{r.name}</span>
                  <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-faint">{locationDisplay(r.location)}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <p className="mt-8 text-[12px] leading-relaxed text-muted">
          Astuce : enregistrez vos exercices dans votre dossier Linux{home ? <span className="font-mono text-fg2"> {home}</span> : null} plutôt que sur
          C:\ — la compilation y est bien plus rapide. Le bouton <span className="text-fg2">Exécuter</span> compile avec{" "}
          <span className="font-mono text-fg2">gcc -Wall -Wextra -g</span> et lance le programme dans le panneau de sortie, où il peut lire au clavier.
        </p>
      </div>
    </div>
  );
}
