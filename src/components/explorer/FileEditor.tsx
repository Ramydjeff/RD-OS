// Main area of the explorer view: the home page, or the files opened from the
// tree as tabs with an editor.

import { lazy, Suspense } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ChevronRight, ClipboardCopy, Cpu, ExternalLink, FileWarning, House, LoaderCircle, Save, SquareTerminal, X } from "lucide-react";
import { FileIcon } from "@/components/explorer/fileIcons";
import { Button, IconButton } from "@/components/ui/Button";
import { CodeEditor } from "@/components/ui/CodeEditor";
import { openTerminal, reportError } from "@/features/terminalActions";
import { cn } from "@/lib/cn";
import { LANG_LABEL, languageFromFileName } from "@/lib/highlight";
import { childLocation, hostPathOf, locationName, parentRel } from "@/lib/paths";
import { isDirty, useEditor, type OpenFile } from "@/store/editor";
import { simulateSource } from "@/store/processesView";
import { toast } from "@/store/ui";
import { useWorkspace } from "@/store/workspace";

const WorkspaceDashboard = lazy(() => import("@/components/layout/WorkspaceDashboard").then((m) => ({ default: m.WorkspaceDashboard })));

export function EditorArea() {
  const files = useEditor((s) => s.files);
  const activeKey = useEditor((s) => s.activeKey);
  const active = files.find((f) => f.key === activeKey) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {files.length > 0 && <EditorTabs files={files} activeKey={activeKey} />}
      <div className="min-h-0 flex-1">
        {active ? (
          <FileView key={active.key} file={active} />
        ) : (
          <div className="h-full overflow-y-auto">
            <Suspense fallback={null}>
              <WorkspaceDashboard />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}

function EditorTabs({ files, activeKey }: { files: OpenFile[]; activeKey: string | null }) {
  const { setActive, close, pin } = useEditor.getState();
  return (
    <div role="tablist" aria-label="Fichiers ouverts" className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-surface">
      <button
        type="button"
        role="tab"
        aria-selected={activeKey === null}
        title="Accueil"
        aria-label="Accueil"
        onClick={() => setActive(null)}
        className={cn(
          "flex w-10 shrink-0 items-center justify-center border-r border-line",
          activeKey === null ? "bg-bg text-fg shadow-[inset_0_-2px_0_var(--accent)]" : "text-muted hover:bg-hover hover:text-fg",
        )}
      >
        <House size={15} />
      </button>
      {files.map((f) => {
        const active = f.key === activeKey;
        const dirty = isDirty(f);
        return (
          <div
            key={f.key}
            role="presentation"
            title={f.rel}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                void close(f.key);
              }
            }}
            className={cn(
              "group flex max-w-56 shrink-0 items-center gap-2 border-r border-line pl-3 pr-1.5",
              active ? "bg-bg text-fg shadow-[inset_0_-2px_0_var(--accent)]" : "text-muted hover:bg-hover hover:text-fg2",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActive(f.key)}
              onDoubleClick={() => pin(f.key)}
              className="flex min-w-0 items-center gap-2 text-[12.5px]"
            >
              <FileIcon name={f.name} size={14} />
              <span className={cn("truncate", f.preview && "italic")}>{f.name}</span>
            </button>
            <button
              type="button"
              aria-label={dirty ? `${f.name} : modifications non enregistrées. Fermer` : `Fermer ${f.name}`}
              onClick={() => void close(f.key)}
              className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-fg"
            >
              {dirty && <span className="h-2 w-2 rounded-full bg-fg2 group-hover:hidden" />}
              <X size={13} className={cn(dirty ? "hidden group-hover:block" : "opacity-0 group-hover:opacity-100", active && !dirty && "opacity-100")} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function FileView({ file }: { file: OpenFile }) {
  const { setContent, save } = useEditor.getState();
  const dirty = isDirty(file);
  const lang = languageFromFileName(file.name);
  const loc = childLocation(file.root, file.rel);
  const segments = file.rel.split("/");
  const lineCount = file.status === "ready" ? file.content.split("\n").length : 0;
  const crlf = file.status === "ready" && file.saved.includes("\r\n");

  const doSave = () => {
    void save(file.key).then((ok) => ok && toast("success", `${file.name} enregistré.`));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-code">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line bg-bg px-4">
        <nav aria-label="Chemin du fichier" className="flex min-w-0 flex-1 items-center gap-1 text-[12px] text-muted">
          <span className="shrink-0 text-fg2">{locationName(file.root)}</span>
          {segments.map((seg, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1">
              <ChevronRight size={12} className="shrink-0 text-faint" />
              <span className={cn("truncate", i === segments.length - 1 && "font-medium text-fg")}>{seg}</span>
            </span>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-1">
          {/\.c$/i.test(file.name) && file.status === "ready" && (
            <Button
              size="sm"
              variant="ghost"
              title="Exécuter ce programme dans le simulateur de processus"
              onClick={() => {
                void simulateSource(file.content, file.name);
                useWorkspace.getState().setView("processes");
              }}
            >
              <Cpu size={13} /> Simuler
            </Button>
          )}
          <IconButton
            label="Ouvrir le dossier dans le terminal"
            size="sm"
            icon={<SquareTerminal size={14} />}
            onClick={() => void openTerminal({ cwd: childLocation(file.root, parentRel(file.rel)) })}
          />
          <IconButton
            label="Copier le chemin"
            size="sm"
            icon={<ClipboardCopy size={14} />}
            onClick={() =>
              void navigator.clipboard?.writeText(loc.path).then(
                () => toast("success", "Chemin copié."),
                () => toast("error", "Le presse-papiers n'est pas accessible."),
              )
            }
          />
          {file.status === "ready" && (
            <Button size="sm" variant={dirty ? "primary" : "ghost"} disabled={!dirty} onClick={doSave} title="Enregistrer (Ctrl+S)">
              <Save size={13} /> Enregistrer
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {file.status === "loading" && (
          <p className="flex h-full items-center justify-center gap-2 text-[12.5px] text-muted">
            <LoaderCircle size={15} className="animate-spin text-accent" /> Ouverture de {file.name}…
          </p>
        )}
        {file.status === "error" && (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <FileWarning size={30} className="text-faint" strokeWidth={1.5} />
            <div className="space-y-1">
              <p className="font-display text-[15px] font-semibold text-fg">{file.name}</p>
              <p className="max-w-md text-[12.5px] text-muted">{file.error}</p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => void revealItemInDir(hostPathOf(loc)).catch((e) => reportError("Impossible d'ouvrir l'Explorateur", e))}
              >
                <ExternalLink size={13} /> Afficher dans l'Explorateur Windows
              </Button>
            </div>
          </div>
        )}
        {file.status === "ready" && (
          // A preview (single click in the tree) leaves the focus in the tree, so arrows and F2 keep working there.
          <CodeEditor value={file.content} onChange={(v) => setContent(file.key, v)} language={lang} fileName={file.name} onSave={doSave} autoFocus={!file.preview} />
        )}
      </div>

      {file.status === "ready" && (
        <div className="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-bg px-4 font-mono text-[10.5px] text-faint">
          <span className={dirty ? "text-warn" : undefined}>{dirty ? "● modifié" : file.savedAt ? "✓ enregistré" : "à jour"}</span>
          <span>{lineCount} lignes</span>
          <span className="ml-auto">{LANG_LABEL[lang]}</span>
          <span>UTF-8</span>
          <span>{crlf ? "CRLF" : "LF"}</span>
        </div>
      )}
    </div>
  );
}
