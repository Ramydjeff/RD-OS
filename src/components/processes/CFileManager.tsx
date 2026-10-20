// "Mes fichiers C": a small virtual file system (kept in local storage) for the
// programs studied with the simulator. Folders nest, files move by drag and
// drop, names are edited in place, real .c files can be imported, and the code
// is saved automatically while it is checked like gcc would.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleX,
  ClipboardCopy,
  Copy,
  Download,
  FilePlus,
  FileUp,
  FolderPlus,
  LayoutTemplate,
  LoaderCircle,
  Pencil,
  Play,
  Search,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { FileIcon, FolderIcon } from "@/components/explorer/fileIcons";
import { checkSource } from "@/components/processes/engine";
import { Button, IconButton } from "@/components/ui/Button";
import { CodeEditor } from "@/components/ui/CodeEditor";
import { ContextMenu, type MenuItem } from "@/components/ui/ContextMenu";
import { insertIntoActive, openTerminal } from "@/features/terminalActions";
import { cn } from "@/lib/cn";
import { type CFile, type CFolder, useCFiles } from "@/store/cfiles";
import { confirmDialog, toast } from "@/store/ui";

const C_TEMPLATES = [
  {
    name: "Boucle de forks (TD)",
    desc: "Boucle for avec fork(), pfils(i) et wait(0)",
    code: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int n = 5;

void p() {
    printf("je suis le processus pere %d\\n", getpid());
}

void pfils(int i) {
    printf("je suis le processus fils %d\\n", i);
    exit(0);
}

int main() {
    printf("salam\\n");
    for (int i = 2; i <= n; i++) {
        int id = fork();
        if (id == 0) {
            pfils(i);
        }
    }
    p();
    for (int i = 2; i <= n; i++) {
        wait(0);
    }
    return 0;
}
`,
  },
  {
    name: "Deux forks et wait",
    desc: "Deux fils p1() et p2(), le père attend",
    code: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

void p() {
    printf("je suis le processus pere %d\\n", getpid());
}

void p1() {
    printf("je suis le processus fils 1 %d\\n", getpid());
    exit(0);
}

void p2() {
    printf("je suis le processus fils 2 %d\\n", getpid());
    exit(0);
}

int main() {
    printf("Demarrage\\n");
    int id = fork();
    if (id == 0) { p1(); }
    id = fork();
    if (id == 0) { p2(); }
    p();
    wait(0);
    wait(0);
    return 0;
}
`,
  },
  {
    name: "Fork simple",
    desc: "Un fils, le père attend avec wait()",
    code: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main() {
    printf("[Pere %d] Avant fork()\\n", getpid());
    pid_t pid = fork();

    if (pid < 0) {
        perror("fork error");
        exit(1);
    } else if (pid == 0) {
        printf("[Fils %d] Je suis le fils, mon pere est %d\\n", getpid(), getppid());
        exit(0);
    } else {
        printf("[Pere %d] Fils %d cree. Attente avec wait()...\\n", getpid(), pid);
        wait(NULL);
        printf("[Pere %d] Fils termine avec succes.\\n", getpid());
    }

    return 0;
}
`,
  },
  {
    name: "Chaîne de processus",
    desc: "Père → fils → petit-fils",
    code: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main() {
    printf("[Pere %d] Demarrage\\n", getpid());
    pid_t f1 = fork();
    if (f1 == 0) {
        printf("[Fils %d] Creation du petit-fils...\\n", getpid());
        pid_t f2 = fork();
        if (f2 == 0) {
            printf("[Petit-fils %d] Troisieme generation !\\n", getpid());
            exit(0);
        }
        wait(NULL);
        printf("[Fils %d] Petit-fils termine.\\n", getpid());
        exit(0);
    }
    wait(NULL);
    printf("[Pere %d] Fin du programme.\\n", getpid());
    return 0;
}
`,
  },
  {
    name: "sleep() et concurrence",
    desc: "Le fils dort 2 s avant de terminer",
    code: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main() {
    printf("[Pere %d] Demarrage\\n", getpid());
    pid_t pid = fork();
    if (pid == 0) {
        printf("[Fils %d] Je dors 2 secondes...\\n", getpid());
        sleep(2);
        printf("[Fils %d] Reveil et exit\\n", getpid());
        exit(0);
    }
    printf("[Pere %d] Attente avec wait()...\\n", getpid());
    wait(NULL);
    printf("[Pere %d] Termine.\\n", getpid());
    return 0;
}
`,
  },
  {
    name: "Programme minimal",
    desc: "Juste main()",
    code: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main() {
    printf("Bonjour\\n");
    return 0;
}
`,
  },
];

const DND_FILE = "application/x-raimy-cfile";
const DND_FOLDER = "application/x-raimy-cfolder";
const SAVE_DELAY = 450;

type Editing = { kind: "rename-file" | "rename-folder"; id: string } | { kind: "new-file" | "new-folder"; parent: string | null } | null;

interface CFileManagerProps {
  /** Called after a program was sent to the simulator. */
  onLaunchSimulation: (code: string, fileName: string, fileId?: string) => void;
}

function copyText(text: string, what: string) {
  void navigator.clipboard?.writeText(text).then(
    () => toast("success", `${what} copié.`),
    () => toast("error", "Le presse-papiers n'est pas accessible."),
  );
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/x-c" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readDropped(list: FileList | File[]): Promise<{ name: string; content: string }[]> {
  const files = Array.from(list).filter((f) => /\.(c|h|txt)$/i.test(f.name) && f.size < 1024 * 1024);
  return Promise.all(files.map(async (f) => ({ name: f.name.replace(/\.txt$/i, ".c"), content: await f.text() })));
}

export function CFileManager({ onLaunchSimulation }: CFileManagerProps) {
  const folders = useCFiles((s) => s.folders);
  const files = useCFiles((s) => s.files);
  const activeFileId = useCFiles((s) => s.activeFileId);
  const expanded = useCFiles((s) => s.expandedFolderIds);
  const store = useCFiles.getState;

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: (MenuItem | "separator")[] } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | "root" | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const importTarget = useRef<string | null>(null);

  const activeFile = files.find((f) => f.id === activeFileId) ?? null;

  const importInto = useCallback(async (list: FileList | File[], folderId: string | null) => {
    const items = await readDropped(list);
    if (items.length === 0) {
      toast("info", "Seuls les fichiers .c, .h ou .txt de moins de 1 Mo sont importés.");
      return;
    }
    const created = store().importFiles(items, folderId);
    toast("success", created.length === 1 ? `« ${created[0]!.name} » importé.` : `${created.length} fichiers importés.`);
  }, [store]);

  const askDeleteFile = useCallback(async (f: CFile) => {
    const ok = await confirmDialog({
      title: "Supprimer ce fichier ?",
      message: `« ${f.name} » sera supprimé de vos fichiers C.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (ok) store().deleteFile(f.id);
  }, [store]);

  const askDeleteFolder = useCallback(async (folder: CFolder) => {
    const ok = await confirmDialog({
      title: "Supprimer ce dossier ?",
      message: `« ${folder.name} », ses sous-dossiers et tous leurs fichiers seront supprimés.`,
      confirmLabel: "Supprimer le dossier",
      danger: true,
    });
    if (ok) store().deleteFolder(folder.id);
  }, [store]);

  const fileMenu = (f: CFile): (MenuItem | "separator")[] => [
    { id: "sim", label: "Simuler", icon: <Play size={14} />, onSelect: () => onLaunchSimulation(f.content, f.name, f.id) },
    "separator",
    { id: "rename", label: "Renommer", icon: <Pencil size={14} />, hint: "F2", onSelect: () => setEditing({ kind: "rename-file", id: f.id }) },
    { id: "dup", label: "Dupliquer", icon: <Copy size={14} />, onSelect: () => store().duplicateFile(f.id) },
    { id: "path", label: "Copier le chemin", icon: <ClipboardCopy size={14} />, onSelect: () => copyText(store().getFilePath(f.id), "Chemin") },
    { id: "export", label: "Exporter (.c)", icon: <Download size={14} />, onSelect: () => download(f.name, f.content) },
    "separator",
    { id: "del", label: "Supprimer", icon: <Trash2 size={14} />, hint: "Suppr", danger: true, onSelect: () => void askDeleteFile(f) },
  ];

  const folderMenu = (folder: CFolder): (MenuItem | "separator")[] => [
    { id: "nf", label: "Nouveau fichier ici", icon: <FilePlus size={14} />, onSelect: () => startCreate("new-file", folder.id) },
    { id: "nd", label: "Nouveau dossier ici", icon: <FolderPlus size={14} />, onSelect: () => startCreate("new-folder", folder.id) },
    {
      id: "imp",
      label: "Importer des fichiers ici…",
      icon: <FileUp size={14} />,
      onSelect: () => {
        importTarget.current = folder.id;
        importRef.current?.click();
      },
    },
    "separator",
    { id: "rename", label: "Renommer", icon: <Pencil size={14} />, hint: "F2", onSelect: () => setEditing({ kind: "rename-folder", id: folder.id }) },
    { id: "path", label: "Copier le chemin", icon: <ClipboardCopy size={14} />, onSelect: () => copyText(`${store().getFolderPath(folder.id)}/`, "Chemin") },
    "separator",
    { id: "del", label: "Supprimer le dossier", icon: <Trash2 size={14} />, danger: true, onSelect: () => void askDeleteFolder(folder) },
  ];

  function startCreate(kind: "new-file" | "new-folder", parent: string | null) {
    if (parent && !store().expandedFolderIds.has(parent)) store().toggleFolder(parent);
    setEditing({ kind, parent });
  }

  function commit(value: string) {
    const e = editing;
    setEditing(null);
    const name = value.trim();
    if (!e || !name) return;
    if ("id" in e) {
      if (e.kind === "rename-file") store().renameFile(e.id, name);
      else store().renameFolder(e.id, name);
    } else if (e.kind === "new-folder") store().createFolder(name, e.parent);
    else store().createFile(name, e.parent);
  }

  // ── Tree model ──────────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();
  const children = useMemo(() => {
    const byParent = new Map<string | null, CFolder[]>();
    for (const f of folders) {
      const list = byParent.get(f.parentId) ?? [];
      list.push(f);
      byParent.set(f.parentId, list);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    const filesBy = new Map<string | null, CFile[]>();
    for (const f of files) {
      if (q && !f.name.toLowerCase().includes(q)) continue;
      const list = filesBy.get(f.folderId) ?? [];
      list.push(f);
      filesBy.set(f.folderId, list);
    }
    for (const list of filesBy.values()) list.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return { folders: byParent, files: filesBy };
  }, [folders, files, q]);

  const folderHasMatch = useCallback(
    (id: string): boolean =>
      (children.files.get(id)?.length ?? 0) > 0 || (children.folders.get(id) ?? []).some((c) => folderHasMatch(c.id)),
    [children],
  );

  // Flat list of visible rows (for rendering and keyboard navigation).
  type Row =
    | { type: "folder"; folder: CFolder; depth: number; open: boolean; count: number }
    | { type: "file"; file: CFile; depth: number }
    | { type: "new"; kind: "new-file" | "new-folder"; depth: number };
  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (parent: string | null, depth: number) => {
      if (editing && (editing.kind === "new-file" || editing.kind === "new-folder") && editing.parent === parent) {
        out.push({ type: "new", kind: editing.kind, depth });
      }
      for (const folder of children.folders.get(parent) ?? []) {
        if (q && !folderHasMatch(folder.id)) continue;
        const open = q ? true : expanded.has(folder.id);
        out.push({ type: "folder", folder, depth, open, count: files.filter((f) => f.folderId === folder.id).length });
        if (open) walk(folder.id, depth + 1);
      }
      for (const file of children.files.get(parent) ?? []) out.push({ type: "file", file, depth });
    };
    walk(null, 0);
    return out;
  }, [children, expanded, editing, q, folderHasMatch, files]);

  function onTreeKey(e: React.KeyboardEvent) {
    if (editing) return;
    const fileRows = rows.filter((r): r is Extract<Row, { type: "file" }> => r.type === "file");
    const cur = fileRows.findIndex((r) => r.file.id === activeFileId);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = fileRows[Math.max(0, Math.min(fileRows.length - 1, cur + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) store().setActiveFileId(next.file.id);
    } else if (e.key === "F2" && activeFile) {
      e.preventDefault();
      setEditing({ kind: "rename-file", id: activeFile.id });
    } else if (e.key === "Delete" && activeFile) {
      e.preventDefault();
      void askDeleteFile(activeFile);
    }
  }

  const dropProps = (target: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      const t = e.dataTransfer.types;
      if (t.includes(DND_FILE) || t.includes(DND_FOLDER) || t.includes("Files")) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = t.includes("Files") ? "copy" : "move";
        setDropTarget(target ?? "root");
      }
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget((d) => (d === (target ?? "root") ? null : d));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(null);
      const fileId = e.dataTransfer.getData(DND_FILE);
      const folderId = e.dataTransfer.getData(DND_FOLDER);
      if (fileId) store().moveFile(fileId, target);
      else if (folderId) {
        if (folderId !== target && !store().moveFolder(folderId, target)) toast("info", "Un dossier ne peut pas être déplacé dans lui-même.");
      } else if (e.dataTransfer.files.length > 0) void importInto(e.dataTransfer.files, target);
    },
  });

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
      <input
        ref={importRef}
        type="file"
        multiple
        accept=".c,.h,.txt"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void importInto(e.target.files, importTarget.current);
          e.target.value = "";
        }}
      />

      {/* ── Files ─────────────────────────────────────────────────── */}
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-line">
        <div className="flex h-10 shrink-0 items-center justify-between pl-4 pr-2">
          <h2 className="eyebrow">Mes fichiers C</h2>
          <div className="flex items-center">
            <IconButton label="Nouveau fichier" size="sm" icon={<FilePlus size={14} />} onClick={() => startCreate("new-file", activeFile?.folderId ?? null)} />
            <IconButton label="Nouveau dossier" size="sm" icon={<FolderPlus size={14} />} onClick={() => startCreate("new-folder", null)} />
            <IconButton
              label="Importer des fichiers .c depuis le disque"
              size="sm"
              icon={<FileUp size={14} />}
              onClick={() => {
                importTarget.current = activeFile?.folderId ?? null;
                importRef.current?.click();
              }}
            />
          </div>
        </div>
        <div className="relative mx-3 mb-2">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setSearch("")}
            placeholder="Rechercher un fichier…"
            spellCheck={false}
            className="h-7 w-full rounded-[var(--radius-sm)] border border-transparent bg-glass pl-8 pr-7 text-[12.5px] text-fg outline-none placeholder:text-faint focus:border-accent/60"
          />
          {search && (
            <button type="button" aria-label="Effacer" onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-fg">
              <X size={12} />
            </button>
          )}
        </div>

        <div
          role="tree"
          tabIndex={0}
          aria-label="Mes fichiers C"
          onKeyDown={onTreeKey}
          {...dropProps(null)}
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest("[data-row]")) return;
            e.preventDefault();
            setMenu({
              x: e.clientX,
              y: e.clientY,
              items: [
                { id: "nf", label: "Nouveau fichier", icon: <FilePlus size={14} />, onSelect: () => startCreate("new-file", null) },
                { id: "nd", label: "Nouveau dossier", icon: <FolderPlus size={14} />, onSelect: () => startCreate("new-folder", null) },
                {
                  id: "imp",
                  label: "Importer des fichiers…",
                  icon: <FileUp size={14} />,
                  onSelect: () => {
                    importTarget.current = null;
                    importRef.current?.click();
                  },
                },
              ],
            });
          }}
          className={cn("min-h-0 flex-1 overflow-y-auto pb-6 outline-none", dropTarget === "root" && "bg-active/40")}
        >
          {rows.length === 0 && (
            <p className="px-4 py-3 text-[12px] text-muted">{q ? `Aucun fichier ne contient « ${search.trim()} ».` : "Aucun fichier. Créez-en un ou importez vos .c."}</p>
          )}
          {rows.map((r) => {
            const pad = 12 + r.depth * 14;
            if (r.type === "new") {
              return (
                <div key="new" className="flex h-[26px] items-center gap-1.5 pr-2" style={{ paddingLeft: pad + 18 }}>
                  {r.kind === "new-folder" ? <FolderIcon name="" open={false} /> : <FileIcon name="nouveau.c" />}
                  <InlineInput
                    initial=""
                    placeholder={r.kind === "new-folder" ? "Nom du dossier" : "nom_du_programme.c"}
                    onCommit={commit}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              );
            }
            if (r.type === "folder") {
              const f = r.folder;
              const renaming = editing?.kind === "rename-folder" && editing.id === f.id;
              return (
                <div
                  key={f.id}
                  data-row
                  draggable={!renaming}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_FOLDER, f.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  {...dropProps(f.id)}
                  onClick={() => !renaming && store().toggleFolder(f.id)}
                  onDoubleClick={() => setEditing({ kind: "rename-folder", id: f.id })}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, items: folderMenu(f) });
                  }}
                  className={cn(
                    "group flex h-[26px] cursor-default items-center gap-1.5 pr-2 text-[13px] text-fg2 hover:bg-hover hover:text-fg",
                    dropTarget === f.id && "bg-active text-fg ring-1 ring-inset ring-accent/50",
                  )}
                  style={{ paddingLeft: pad }}
                >
                  <ChevronRight size={13} className={cn("shrink-0 text-muted transition-transform duration-150", r.open && "rotate-90")} />
                  <FolderIcon name={f.name} open={r.open} />
                  {renaming ? (
                    <InlineInput initial={f.name} placeholder="Nom du dossier" onCommit={commit} onCancel={() => setEditing(null)} />
                  ) : (
                    <>
                      <span className="truncate font-medium">{f.name}</span>
                      <span className="ml-auto text-[11px] text-faint tabular">{r.count || ""}</span>
                    </>
                  )}
                </div>
              );
            }
            const file = r.file;
            const active = file.id === activeFileId;
            const renaming = editing?.kind === "rename-file" && editing.id === file.id;
            return (
              <div
                key={file.id}
                data-row
                role="treeitem"
                aria-selected={active}
                draggable={!renaming}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND_FILE, file.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => store().setActiveFileId(file.id)}
                onDoubleClick={() => setEditing({ kind: "rename-file", id: file.id })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  store().setActiveFileId(file.id);
                  setMenu({ x: e.clientX, y: e.clientY, items: fileMenu(file) });
                }}
                title={store().getFilePath(file.id)}
                className={cn(
                  "relative flex h-[26px] cursor-default items-center gap-1.5 pr-2 text-[13px]",
                  active ? "bg-active text-fg" : "text-fg2 hover:bg-hover hover:text-fg",
                )}
                style={{ paddingLeft: pad + 18 }}
              >
                {active && <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-accent" />}
                <FileIcon name={file.name} />
                {renaming ? (
                  <InlineInput initial={file.name} placeholder="nom.c" onCommit={commit} onCancel={() => setEditing(null)} />
                ) : (
                  <span className="truncate">{file.name}</span>
                )}
              </div>
            );
          })}
        </div>
        <p className="shrink-0 border-t border-line px-4 py-2 text-[11px] leading-snug text-faint">
          Glissez un fichier sur un dossier pour le déplacer, ou déposez vos .c ici pour les importer.
        </p>
      </aside>

      {/* ── Editor ────────────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-1 flex-col">
        {activeFile ? (
          <CEditor key={activeFile.id} file={activeFile} onSimulate={(code) => onLaunchSimulation(code, activeFile.name, activeFile.id)} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="space-y-1">
              <p className="font-display text-[16px] font-semibold text-fg">Aucun fichier sélectionné</p>
              <p className="text-[12.5px] text-muted">Choisissez un programme à gauche, créez-en un ou importez vos fichiers .c.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => startCreate("new-file", null)}>
                <FilePlus size={14} /> Nouveau fichier
              </Button>
              <Button
                onClick={() => {
                  importTarget.current = null;
                  importRef.current?.click();
                }}
              >
                <FileUp size={14} /> Importer
              </Button>
            </div>
          </div>
        )}
      </section>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Editor for one file: saves by itself shortly after typing, checks the code like gcc. */
function CEditor({ file, onSimulate }: { file: CFile; onSimulate: (code: string) => void }) {
  const [code, setCode] = useState(file.content);
  const [saved, setSaved] = useState(true);
  const [diag, setDiag] = useState(() => checkSource(file.content));
  const [templates, setTemplates] = useState<{ x: number; y: number } | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(code);
  latest.current = code;

  const flush = useCallback(() => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    useCFiles.getState().updateFileContent(file.id, latest.current);
    setSaved(true);
  }, [file.id]);

  // Save what was typed when leaving the file (switching file or tab).
  useEffect(() => () => {
    if (pending.current) {
      clearTimeout(pending.current);
      useCFiles.getState().updateFileContent(file.id, latest.current);
    }
  }, [file.id]);

  useEffect(() => {
    const t = setTimeout(() => setDiag(checkSource(code)), 300);
    return () => clearTimeout(t);
  }, [code]);

  const onChange = (v: string) => {
    setCode(v);
    setSaved(false);
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(flush, SAVE_DELAY);
  };

  const errorLines = useMemo(() => new Map(diag.errors.map((e) => [e.line, e.message])), [diag]);
  const path = useCFiles.getState().getFolderPath(file.folderId);

  const runInWsl = async () => {
    flush();
    try {
      const id = await openTerminal();
      if (!id) return;
      const safe = file.name.replace(/[^\w.-]/g, "_").replace(/\.c$/i, "") || "prog";
      const tag = `RAIMY_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const cmd = `cat > /tmp/${safe}.c << '${tag}'\n${code.replace(/\s*$/, "")}\n${tag}\ngcc -Wall -o /tmp/${safe} /tmp/${safe}.c && /tmp/${safe}\n`;
      setTimeout(() => insertIntoActive(cmd), 450);
      toast("info", `Compilation de « ${file.name} » avec gcc dans le terminal WSL.`);
    } catch {
      toast("error", "Impossible d'ouvrir le terminal.");
    }
  };

  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line px-4">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px]">
          {path && <span className="truncate text-muted">{path} /</span>}
          <span className="truncate font-medium text-fg">{file.name}</span>
          <span className={cn("ml-2 flex shrink-0 items-center gap-1 text-[11px]", saved ? "text-faint" : "text-muted")}>
            {saved ? <Check size={12} /> : <LoaderCircle size={11} className="animate-spin" />}
            {saved ? "Enregistré" : "Enregistrement…"}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setTemplates({ x: r.left, y: r.bottom + 4 });
          }}
          title="Remplacer le code par un modèle"
        >
          <LayoutTemplate size={13} /> Modèles
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void runInWsl()} title="Compiler avec gcc et exécuter pour de vrai dans WSL">
          <SquareTerminal size={13} /> gcc (WSL)
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            flush();
            onSimulate(latest.current);
          }}
          title="Visualiser l'exécution pas à pas (Ctrl+Entrée)"
        >
          <Play size={13} /> Simuler
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        <CodeEditor
          value={code}
          onChange={onChange}
          language="c"
          fileName={file.name}
          errorLines={errorLines}
          onSave={() => {
            flush();
            toast("success", `« ${file.name} » enregistré.`);
          }}
          onSubmit={() => {
            flush();
            onSimulate(latest.current);
          }}
        />
      </div>

      <div className="max-h-28 shrink-0 overflow-y-auto border-t border-line px-4 py-1.5 text-[11.5px]">
        {diag.errors.length === 0 && diag.warnings.length === 0 && (
          <p className="flex items-center gap-1.5 text-muted">
            <Check size={12} className="text-ok" /> Aucune erreur : le programme peut être simulé.
          </p>
        )}
        {diag.errors.map((e, i) => (
          <p key={`e${i}`} className="flex items-start gap-1.5 py-0.5 text-fg">
            <CircleX size={12} className="mt-0.5 shrink-0 text-danger" />
            <span>
              <span className="font-mono text-muted">ligne {e.line}</span> · {e.message}
            </span>
          </p>
        ))}
        {diag.warnings.map((w, i) => (
          <p key={`w${i}`} className="flex items-start gap-1.5 py-0.5 text-fg2">
            <AlertTriangle size={12} className="mt-0.5 shrink-0 text-status-warn" />
            <span>
              <span className="font-mono text-muted">ligne {w.line}</span> · {w.message}
            </span>
          </p>
        ))}
      </div>

      {templates && (
        <ContextMenu
          x={templates.x}
          y={templates.y}
          onClose={() => setTemplates(null)}
          items={C_TEMPLATES.map((t) => ({
            id: t.name,
            label: `${t.name} — ${t.desc}`,
            icon: <LayoutTemplate size={14} />,
            onSelect: () => {
              void (async () => {
                if (code.trim() && code !== t.code) {
                  const ok = await confirmDialog({
                    title: "Remplacer le code ?",
                    message: `Le contenu de « ${file.name} » sera remplacé par le modèle « ${t.name} ».`,
                    confirmLabel: "Remplacer",
                  });
                  if (!ok) return;
                }
                onChange(t.code);
              })();
            },
          }))}
        />
      )}
    </>
  );
}

/** In-place name field: Enter or leaving commits, Escape cancels. */
function InlineInput({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  const finish = (ok: boolean) => {
    if (done.current) return;
    done.current = true;
    if (ok && value.trim()) onCommit(value);
    else onCancel();
  };
  return (
    <input
      ref={ref}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
      className="h-[20px] min-w-0 flex-1 rounded-[3px] border border-accent bg-bg px-1.5 text-[13px] text-fg outline-none placeholder:text-faint"
    />
  );
}
