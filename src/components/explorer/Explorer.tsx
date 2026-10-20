import { useRef, useState } from "react";
import {
  ChevronsDownUp,
  Eye,
  EyeOff,
  FilePlus,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Search,
  SquareTerminal,
  X,
} from "lucide-react";
import { FileTree, type FileTreeHandle } from "@/components/explorer/FileTree";
import { Button, IconButton } from "@/components/ui/Button";
import { openTerminal } from "@/features/terminalActions";
import { cn } from "@/lib/cn";
import { isMountedWindowsPath, locationDisplay, locationKey, locationName } from "@/lib/paths";
import { useEditor } from "@/store/editor";
import { useUi } from "@/store/ui";
import { useWorkspace } from "@/store/workspace";

export function Explorer() {
  const project = useWorkspace((s) => s.project);
  const showHidden = useWorkspace((s) => s.showHiddenFiles);
  const toggleHidden = useWorkspace((s) => s.toggleHidden);
  const closeProject = useWorkspace((s) => s.closeProject);
  const treeRef = useRef<FileTreeHandle>(null);
  const [filter, setFilter] = useState("");
  const setOpenProjectOpen = useUi((s) => s.setOpenProjectOpen);
  const setNewProjectOpen = useUi((s) => s.setNewProjectOpen);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between pl-4 pr-2">
        <h2 className="eyebrow">Explorateur</h2>
        <div className="flex items-center">
          {project ? (
            <>
              <IconButton label="Nouveau fichier" size="sm" icon={<FilePlus size={14} />} onClick={() => treeRef.current?.newEntry("file")} />
              <IconButton label="Nouveau dossier" size="sm" icon={<FolderPlus size={14} />} onClick={() => treeRef.current?.newEntry("dir")} />
              <IconButton label="Actualiser" size="sm" icon={<RefreshCw size={13} />} onClick={() => treeRef.current?.refresh()} />
              <IconButton label="Tout replier" size="sm" icon={<ChevronsDownUp size={14} />} onClick={() => treeRef.current?.collapseAll()} />
              <IconButton
                label={showHidden ? "Masquer les fichiers cachés" : "Afficher les fichiers cachés"}
                size="sm"
                active={showHidden}
                icon={showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                onClick={toggleHidden}
              />
            </>
          ) : (
            <>
              <IconButton label="Ouvrir un dossier…" size="sm" icon={<FolderOpen size={14} />} onClick={() => setOpenProjectOpen(true)} />
              <IconButton label="Nouveau projet…" size="sm" icon={<FolderPlus size={14} />} onClick={() => setNewProjectOpen(true)} />
            </>
          )}
        </div>
      </div>

      {project ? (
        <>
          <div className="group/proj mx-2 mb-2 rounded-[var(--radius-md)] px-2 py-1.5 hover:bg-hover">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-display text-[14px] font-semibold tracking-[-0.01em] text-fg" title={locationName(project)}>
                {locationName(project)}
              </span>
              <div className="flex shrink-0 items-center opacity-70 transition-opacity group-hover/proj:opacity-100">
                <IconButton
                  label="Ouvrir la racine dans le terminal"
                  size="sm"
                  icon={<SquareTerminal size={14} />}
                  onClick={() => void openTerminal({ cwd: project })}
                />
                <IconButton
                  label="Fermer le projet"
                  size="sm"
                  icon={<X size={14} />}
                  onClick={() => void useEditor.getState().closeProject(project).then((ok) => ok && closeProject())}
                />
              </div>
            </div>
            <p className="selectable truncate font-mono text-[11px] text-faint" title={locationDisplay(project)}>
              {project.kind === "linux" ? `${project.distro} · ${project.path}` : project.path}
            </p>
            {isMountedWindowsPath(project) && (
              <p className="mt-1 text-[11px] leading-snug text-warn">Disque Windows vu depuis WSL : accès plus lent.</p>
            )}
          </div>

          <div className="relative mx-3 mb-1.5">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setFilter("");
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  treeRef.current?.focus();
                }
              }}
              placeholder="Filtrer les fichiers…"
              spellCheck={false}
              aria-label="Filtrer les fichiers chargés"
              className={cn(
                "h-7 w-full rounded-[var(--radius-sm)] border border-transparent bg-glass pl-8 pr-7 text-[12.5px] text-fg placeholder:text-faint",
                "outline-none transition-colors focus:border-accent/60",
              )}
            />
            {filter && (
              <button
                type="button"
                aria-label="Effacer le filtre"
                onClick={() => setFilter("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:bg-hover hover:text-fg"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <FileTree key={locationKey(project)} ref={treeRef} root={project} showHidden={showHidden} filter={filter} />
        </>
      ) : (
        <EmptyExplorer />
      )}
    </div>
  );
}

function EmptyExplorer() {
  const recents = useWorkspace((s) => s.recentProjects);
  const openProject = useWorkspace((s) => s.openProject);
  const forgetRecent = useWorkspace((s) => s.forgetRecent);
  const setOpenProjectOpen = useUi((s) => s.setOpenProjectOpen);
  const setNewProjectOpen = useUi((s) => s.setNewProjectOpen);

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-auto px-4 pb-4 pt-1">
      <div className="space-y-3">
        <p className="text-[12.5px] leading-relaxed text-muted">Aucun dossier ouvert. Ouvrez un projet pour parcourir et modifier ses fichiers.</p>
        <div className="flex flex-col gap-1.5">
          <Button variant="primary" onClick={() => setOpenProjectOpen(true)}>
            <FolderOpen size={14} /> Ouvrir un dossier
          </Button>
          <Button onClick={() => setNewProjectOpen(true)}>
            <FolderPlus size={14} /> Nouveau projet
          </Button>
        </div>
      </div>

      {recents.length > 0 && (
        <div>
          <h3 className="eyebrow mb-1.5">Récents</h3>
          <ul className="-mx-2">
            {recents.map((r) => (
              <li key={locationKey(r.location)} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => openProject(r.location)}
                  title={locationDisplay(r.location)}
                  className="min-w-0 flex-1 rounded-[var(--radius-sm)] px-2 py-1.5 text-left hover:bg-hover"
                >
                  <span className="block truncate text-[13px] text-fg">{r.name}</span>
                  <span className="block truncate font-mono text-[10.5px] text-faint">{locationDisplay(r.location)}</span>
                </button>
                <IconButton
                  label={`Retirer ${r.name} des récents`}
                  size="sm"
                  icon={<X size={12} />}
                  className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => forgetRecent(r.location)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-l-2 border-line pl-3 text-[12px] leading-relaxed text-muted">
        <p className="mb-1 font-medium text-fg2">Où ranger ses projets ?</p>
        <p>
          Dans le système de fichiers Linux (par exemple <span className="font-mono text-fg2">~/projets</span>) : compilation, Python et
          Git y sont bien plus rapides que sur un disque Windows ouvert depuis WSL (<span className="font-mono text-fg2">/mnt/c/…</span>).
        </p>
      </div>
    </div>
  );
}
