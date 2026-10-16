import { useRef, useState } from "react";
import { Eye, EyeOff, FilePlus, FolderOpen, FolderPlus, RefreshCw, TerminalSquare, X } from "lucide-react";
import { FileTree, type FileTreeHandle } from "@/components/explorer/FileTree";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Fields";
import { openTerminal } from "@/features/terminalActions";
import { isMountedWindowsPath, locationDisplay, locationName } from "@/lib/paths";
import { useUi } from "@/store/ui";
import { useWorkspace } from "@/store/workspace";
import type { EntryKind } from "@/types/ipc";

export function Explorer() {
  const project = useWorkspace((s) => s.project);
  const showHidden = useWorkspace((s) => s.showHiddenFiles);
  const toggleHidden = useWorkspace((s) => s.toggleHidden);
  const closeProject = useWorkspace((s) => s.closeProject);
  const treeRef = useRef<FileTreeHandle>(null);
  const [, setSelection] = useState<{ rel: string; kind: EntryKind } | null>(null);
  const setOpenProjectOpen = useUi((s) => s.setOpenProjectOpen);
  const setNewProjectOpen = useUi((s) => s.setNewProjectOpen);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-between px-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Explorer</h2>
        <div className="flex items-center">
          <IconButton label="Open project..." size="sm" icon={<FolderOpen size={14} />} onClick={() => setOpenProjectOpen(true)} />
          <IconButton label="New project from template..." size="sm" icon={<FolderPlus size={14} />} onClick={() => setNewProjectOpen(true)} />
          {project && (
            <>
              <IconButton label="New file" size="sm" icon={<FilePlus size={14} />} onClick={() => treeRef.current?.newEntry("file")} />
              <IconButton label="Refresh" size="sm" icon={<RefreshCw size={13} />} onClick={() => treeRef.current?.refresh()} />
              <IconButton
                label={showHidden ? "Hide hidden files" : "Show hidden files"}
                size="sm"
                active={showHidden}
                icon={showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                onClick={toggleHidden}
              />
            </>
          )}
        </div>
      </div>

      {project ? (
        <>
          <div className="mx-3 mb-1 space-y-1 border-b border-line pb-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-semibold" title={locationName(project)}>
                {locationName(project)}
              </span>
              <div className="flex shrink-0 items-center">
                <IconButton
                  label="Open project root in terminal"
                  size="sm"
                  icon={<TerminalSquare size={14} />}
                  onClick={() => void openTerminal({ cwd: project })}
                />
                <IconButton label="Close project" size="sm" icon={<X size={14} />} onClick={closeProject} />
              </div>
            </div>
            <p className="selectable truncate font-mono text-[11px] text-muted" title={locationDisplay(project)}>
              {locationDisplay(project)}
            </p>
            <div className="flex gap-1">
              <Badge tone={project.kind === "linux" ? "good" : "neutral"}>{project.kind === "linux" ? "Linux filesystem" : "Windows filesystem"}</Badge>
              {isMountedWindowsPath(project) && <Badge tone="warn">Windows drive via /mnt</Badge>}
            </div>
          </div>
          <FileTree key={locationDisplay(project)} ref={treeRef} root={project} showHidden={showHidden} onSelectionChange={setSelection} />
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
    <div className="min-h-0 flex-1 space-y-4 overflow-auto px-3 pb-3">
      <div className="space-y-2">
        <p className="text-muted">No project is open.</p>
        <div className="flex flex-col gap-1.5">
          <Button variant="primary" onClick={() => setOpenProjectOpen(true)}>
            <FolderOpen size={14} /> Open project...
          </Button>
          <Button onClick={() => setNewProjectOpen(true)}>
            <FolderPlus size={14} /> New project from template...
          </Button>
        </div>
      </div>

      {recents.length > 0 && (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Recent</h3>
          <ul>
            {recents.map((r) => (
              <li key={locationDisplay(r.location)} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => openProject(r.location)}
                  title={locationDisplay(r.location)}
                  className="min-w-0 flex-1 rounded-[var(--radius-sm)] px-2 py-1 text-left hover:bg-hover"
                >
                  <span className="block truncate text-[13px]">{r.name}</span>
                  <span className="block truncate font-mono text-[11px] text-muted">{locationDisplay(r.location)}</span>
                </button>
                <IconButton
                  label={`Remove ${r.name} from recent projects`}
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

      <div className="rounded-[var(--radius-sm)] border border-line p-2.5 text-xs leading-relaxed text-muted">
        <p className="mb-1 font-medium text-fg">Where should projects live?</p>
        <p>
          Projects inside the Linux filesystem (for example <span className="font-mono">/home/you/projects</span>) are fastest for builds,
          Python environments and Git. Windows folders opened from WSL (<span className="font-mono">/mnt/c/...</span>) work, but file access
          across the boundary is much slower.
        </p>
      </div>
    </div>
  );
}
