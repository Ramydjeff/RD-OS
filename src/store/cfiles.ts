import { create } from "zustand";

export interface CFile {
  id: string;
  name: string;
  folderId: string | null;
  content: string;
  updatedAt: number;
}

export interface CFolder {
  id: string;
  name: string;
  parentId: string | null;
}

const STORAGE_KEY = "kali_c_files_store_v1";

const DEFAULT_FOLDERS: CFolder[] = [
  { id: "folder-tp1", name: "TP1_Processus", parentId: null },
  { id: "folder-cours", name: "Exemples_Cours", parentId: null },
];

const DEFAULT_FILES: CFile[] = [
  {
    id: "file-boucle",
    name: "boucle_forks.c",
    folderId: "folder-tp1",
    content: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int n = 5;

void p() {
    printf("je suis le processus pere %d \\n", getpid());
}

void pfils(int i) {
    printf("je suis le processus fils %d \\n", i);
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
}`,
    updatedAt: Date.now(),
  },
  {
    id: "file-2forks",
    name: "2_forks_wait.c",
    folderId: "folder-tp1",
    content: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

void p() {
    printf("je suis le processus pere %d \\n", getpid());
}

void p1() {
    printf("je suis le processus fils 1 %d \\n", getpid());
    exit(0);
}

void p2() {
    printf("je suis le processus fils 2 %d \\n", getpid());
    exit(0);
}

int main() {
    printf("salam WAALIKOM\\n");
    int id = fork();
    if (id == 0) { p1(); }
    id = fork();
    if (id == 0) { p2(); }
    p();
    wait(0);
    wait(0);
    return 0;
}`,
    updatedAt: Date.now(),
  },
  {
    id: "file-simple",
    name: "simple_fork.c",
    folderId: "folder-cours",
    content: `#include <stdio.h>
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
        printf("[Pere %d] J'ai cree le fils %d. Attente avec wait()...\\n", getpid(), pid);
        wait(NULL);
        printf("[Pere %d] Mon fils s'est termine avec succes.\\n", getpid());
    }

    return 0;
}`,
    updatedAt: Date.now(),
  },
  {
    id: "file-chaine",
    name: "chaine_processus.c",
    folderId: "folder-cours",
    content: `#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main() {
    printf("[Pere %d] Demarrage\\n", getpid());
    pid_t f1 = fork();
    if (f1 == 0) {
        printf("[Fils %d] Je cree le petit-fils...\\n", getpid());
        pid_t f2 = fork();
        if (f2 == 0) {
            printf("[Petit-fils %d] Je suis la troisieme generation !\\n", getpid());
            exit(0);
        }
        wait(NULL);
        printf("[Fils %d] Petit-fils termine, je quitte.\\n", getpid());
        exit(0);
    }
    wait(NULL);
    printf("[Pere %d] Fin du programme.\\n", getpid());
    return 0;
}`,
    updatedAt: Date.now(),
  },
];

function loadInitial(): { folders: CFolder[]; files: CFile[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.folders) && Array.isArray(data.files) && data.files.length > 0) {
        return { folders: data.folders, files: data.files };
      }
    }
  } catch {
    // ignore parsing errors
  }
  return { folders: DEFAULT_FOLDERS, files: DEFAULT_FILES };
}

function persist(folders: CFolder[], files: CFile[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ folders, files }));
  } catch {
    // ignore
  }
}

export interface ClipboardItem {
  type: "file" | "folder";
  id: string;
  name: string;
}

interface CFilesState {
  folders: CFolder[];
  files: CFile[];
  activeFileId: string | null;
  expandedFolderIds: Set<string>;
  clipboard: ClipboardItem | null;

  // Actions
  setActiveFileId: (id: string | null) => void;
  toggleFolder: (folderId: string) => void;
  createFolder: (name: string, parentId?: string | null) => CFolder;
  renameFolder: (id: string, newName: string) => void;
  deleteFolder: (id: string) => void;

  createFile: (name: string, folderId: string | null, content?: string) => CFile;
  updateFileContent: (id: string, content: string) => void;
  renameFile: (id: string, newName: string) => void;
  deleteFile: (id: string) => void;
  duplicateFile: (id: string) => CFile | null;
  /** Moves a file into a folder (null: root). */
  moveFile: (id: string, folderId: string | null) => void;
  /** Moves a folder under another one (null: root); refuses to move it inside itself. */
  moveFolder: (id: string, parentId: string | null) => boolean;
  /** Adds files read from disk; names already taken in the folder get a suffix. */
  importFiles: (items: { name: string; content: string }[], folderId: string | null) => CFile[];

  // Clipboard & Path Helpers
  setClipboard: (item: ClipboardItem | null) => void;
  pasteFromClipboard: (targetFolderId: string | null) => void;
  getFolderPath: (folderId: string | null) => string;
  getFilePath: (fileId: string) => string;
}

const initial = loadInitial();

export const useCFiles = create<CFilesState>((set, get) => ({
  folders: initial.folders,
  files: initial.files,
  activeFileId: initial.files[0]?.id ?? null,
  expandedFolderIds: new Set(["folder-tp1", "folder-cours"]),
  clipboard: null,

  setActiveFileId: (id) => set({ activeFileId: id }),

  toggleFolder: (folderId) =>
    set((state) => {
      const next = new Set(state.expandedFolderIds);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return { expandedFolderIds: next };
    }),

  createFolder: (name, parentId = null) => {
    const newFolder: CFolder = {
      id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || "Nouveau_Dossier",
      parentId,
    };
    const nextFolders = [...get().folders, newFolder];
    const nextExpanded = new Set(get().expandedFolderIds);
    nextExpanded.add(newFolder.id);
    if (parentId) nextExpanded.add(parentId);

    set({ folders: nextFolders, expandedFolderIds: nextExpanded });
    persist(nextFolders, get().files);
    return newFolder;
  },

  renameFolder: (id, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const nextFolders = get().folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f));
    set({ folders: nextFolders });
    persist(nextFolders, get().files);
  },

  deleteFolder: (id) => {
    // Delete folder and all nested files & folders
    const toDeleteFolderIds = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of get().folders) {
        if (f.parentId && toDeleteFolderIds.has(f.parentId) && !toDeleteFolderIds.has(f.id)) {
          toDeleteFolderIds.add(f.id);
          changed = true;
        }
      }
    }

    const nextFolders = get().folders.filter((f) => !toDeleteFolderIds.has(f.id));
    const nextFiles = get().files.filter((f) => !f.folderId || !toDeleteFolderIds.has(f.folderId));
    const nextActive = toDeleteFolderIds.has(get().files.find((f) => f.id === get().activeFileId)?.folderId ?? "")
      ? nextFiles[0]?.id ?? null
      : get().activeFileId;

    set({ folders: nextFolders, files: nextFiles, activeFileId: nextActive });
    persist(nextFolders, nextFiles);
  },

  createFile: (name, folderId, content = "") => {
    let cleanName = name.trim() || "nouveau.c";
    if (!cleanName.endsWith(".c") && !cleanName.endsWith(".h")) {
      cleanName += ".c";
    }

    const newFile: CFile = {
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName,
      folderId,
      content:
        content ||
        `#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main() {\n    printf("Bonjour depuis ${cleanName}\\n");\n    return 0;\n}\n`,
      updatedAt: Date.now(),
    };

    const nextFiles = [newFile, ...get().files];
    set({ files: nextFiles, activeFileId: newFile.id });
    persist(get().folders, nextFiles);
    return newFile;
  },

  updateFileContent: (id, content) => {
    const nextFiles = get().files.map((f) =>
      f.id === id ? { ...f, content, updatedAt: Date.now() } : f,
    );
    set({ files: nextFiles });
    persist(get().folders, nextFiles);
  },

  renameFile: (id, newName) => {
    let clean = newName.trim();
    if (!clean) return;
    if (!clean.endsWith(".c") && !clean.endsWith(".h")) clean += ".c";

    const nextFiles = get().files.map((f) => (f.id === id ? { ...f, name: clean } : f));
    set({ files: nextFiles });
    persist(get().folders, nextFiles);
  },

  deleteFile: (id) => {
    const nextFiles = get().files.filter((f) => f.id !== id);
    const nextActive = get().activeFileId === id ? nextFiles[0]?.id ?? null : get().activeFileId;
    set({ files: nextFiles, activeFileId: nextActive });
    persist(get().folders, nextFiles);
  },

  duplicateFile: (id) => {
    const src = get().files.find((f) => f.id === id);
    if (!src) return null;

    const baseName = src.name.replace(/\.[^/.]+$/, "");
    const ext = src.name.slice(baseName.length);
    const copyName = `${baseName}_copie${ext}`;

    const newFile: CFile = {
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: copyName,
      folderId: src.folderId,
      content: src.content,
      updatedAt: Date.now(),
    };

    const nextFiles = [newFile, ...get().files];
    set({ files: nextFiles, activeFileId: newFile.id });
    persist(get().folders, nextFiles);
    return newFile;
  },

  moveFile: (id, folderId) => {
    const nextFiles = get().files.map((f) => (f.id === id ? { ...f, folderId, updatedAt: Date.now() } : f));
    const nextExpanded = new Set(get().expandedFolderIds);
    if (folderId) nextExpanded.add(folderId);
    set({ files: nextFiles, expandedFolderIds: nextExpanded });
    persist(get().folders, nextFiles);
  },

  moveFolder: (id, parentId) => {
    // Walk up from the target: moving a folder into its own subtree is refused.
    const byId = new Map(get().folders.map((f) => [f.id, f]));
    for (let cur: string | null = parentId; cur; cur = byId.get(cur)?.parentId ?? null) {
      if (cur === id) return false;
    }
    const nextFolders = get().folders.map((f) => (f.id === id ? { ...f, parentId } : f));
    const nextExpanded = new Set(get().expandedFolderIds);
    if (parentId) nextExpanded.add(parentId);
    set({ folders: nextFolders, expandedFolderIds: nextExpanded });
    persist(nextFolders, get().files);
    return true;
  },

  importFiles: (items, folderId) => {
    const taken = new Set(get().files.filter((f) => f.folderId === folderId).map((f) => f.name));
    const created: CFile[] = items.map((it, i) => {
      let name = it.name.trim() || "importe.c";
      if (taken.has(name)) {
        const base = name.replace(/\.[^/.]+$/, "");
        const ext = name.slice(base.length);
        let n = 2;
        while (taken.has(`${base}_${n}${ext}`)) n++;
        name = `${base}_${n}${ext}`;
      }
      taken.add(name);
      return { id: `file-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`, name, folderId, content: it.content, updatedAt: Date.now() };
    });
    const nextFiles = [...created, ...get().files];
    const nextExpanded = new Set(get().expandedFolderIds);
    if (folderId) nextExpanded.add(folderId);
    set({ files: nextFiles, expandedFolderIds: nextExpanded, activeFileId: created[0]?.id ?? get().activeFileId });
    persist(get().folders, nextFiles);
    return created;
  },

  setClipboard: (item) => set({ clipboard: item }),

  getFolderPath: (folderId) => {
    if (!folderId) return "";
    const folders = get().folders;
    const parts: string[] = [];
    let curr: string | null = folderId;
    const visited = new Set<string>();
    while (curr && !visited.has(curr)) {
      visited.add(curr);
      const f = folders.find((item) => item.id === curr);
      if (!f) break;
      parts.unshift(f.name);
      curr = f.parentId;
    }
    return parts.join("/");
  },

  getFilePath: (fileId) => {
    const file = get().files.find((f) => f.id === fileId);
    if (!file) return "";
    const folderPath = get().getFolderPath(file.folderId);
    return folderPath ? `${folderPath}/${file.name}` : file.name;
  },

  pasteFromClipboard: (targetFolderId) => {
    const clip = get().clipboard;
    if (!clip) return;

    if (clip.type === "file") {
      const src = get().files.find((f) => f.id === clip.id);
      if (!src) return;

      const existing = get().files.some((f) => f.folderId === targetFolderId && f.name === src.name);
      let newName = src.name;
      if (existing) {
        const baseName = src.name.replace(/\.[^/.]+$/, "");
        const ext = src.name.slice(baseName.length);
        newName = `${baseName}_copie${ext}`;
      }

      const newFile: CFile = {
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: newName,
        folderId: targetFolderId,
        content: src.content,
        updatedAt: Date.now(),
      };
      const nextFiles = [newFile, ...get().files];
      set({ files: nextFiles, activeFileId: newFile.id });
      persist(get().folders, nextFiles);
    } else if (clip.type === "folder") {
      const srcFolder = get().folders.find((f) => f.id === clip.id);
      if (!srcFolder) return;
      if (targetFolderId === clip.id) return;

      const folderIdMap = new Map<string, string>();
      const newRootFolderId = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      folderIdMap.set(clip.id, newRootFolderId);

      const newFolders: CFolder[] = [
        {
          id: newRootFolderId,
          name: `${srcFolder.name}_copie`,
          parentId: targetFolderId,
        },
      ];

      const findSubfolders = (parentId: string) => {
        const children = get().folders.filter((f) => f.parentId === parentId);
        for (const child of children) {
          const newChildId = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          folderIdMap.set(child.id, newChildId);
          newFolders.push({
            id: newChildId,
            name: child.name,
            parentId: folderIdMap.get(child.parentId!) ?? targetFolderId,
          });
          findSubfolders(child.id);
        }
      };
      findSubfolders(clip.id);

      const newFiles: CFile[] = [];
      for (const [oldFId, newFId] of folderIdMap.entries()) {
        const filesInFolder = get().files.filter((f) => f.folderId === oldFId);
        for (const file of filesInFolder) {
          newFiles.push({
            id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: file.name,
            folderId: newFId,
            content: file.content,
            updatedAt: Date.now(),
          });
        }
      }

      const nextFolders = [...get().folders, ...newFolders];
      const nextFiles = [...newFiles, ...get().files];
      const nextExpanded = new Set(get().expandedFolderIds);
      nextExpanded.add(newRootFolderId);
      if (targetFolderId) nextExpanded.add(targetFolderId);

      set({
        folders: nextFolders,
        files: nextFiles,
        expandedFolderIds: nextExpanded,
        activeFileId: newFiles[0]?.id ?? get().activeFileId,
      });
      persist(nextFolders, nextFiles);
    }
  },
}));
