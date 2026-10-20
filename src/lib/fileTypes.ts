// What rAImy OS knows about a file from its name: how to show it, whether the
// editor can open it, and how Code Studio runs it.

export type FileKind =
  | "folder"
  | "c"
  | "cpp"
  | "header"
  | "python"
  | "shell"
  | "web"
  | "data"
  | "text"
  | "markdown"
  | "make"
  | "image"
  | "pdf"
  | "archive"
  | "exe"
  | "shortcut"
  | "office"
  | "media"
  | "binary"
  | "other";

const BY_EXT: Record<string, FileKind> = {
  c: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  "c++": "cpp",
  h: "header",
  hpp: "header",
  hh: "header",
  py: "python",
  pyw: "python",
  ipynb: "data",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  js: "web",
  mjs: "web",
  ts: "web",
  tsx: "web",
  jsx: "web",
  html: "web",
  css: "web",
  json: "data",
  yaml: "data",
  yml: "data",
  toml: "data",
  xml: "data",
  csv: "data",
  sql: "data",
  ini: "data",
  conf: "data",
  cfg: "data",
  env: "data",
  txt: "text",
  log: "text",
  md: "markdown",
  rst: "text",
  mk: "make",
  cmake: "make",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
  ico: "image",
  pdf: "pdf",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  xz: "archive",
  exe: "exe",
  msi: "exe",
  bat: "exe",
  cmd: "exe",
  ps1: "exe",
  lnk: "shortcut",
  url: "shortcut",
  docx: "office",
  doc: "office",
  xlsx: "office",
  xls: "office",
  pptx: "office",
  ppt: "office",
  odt: "office",
  mp3: "media",
  wav: "media",
  mp4: "media",
  mkv: "media",
  avi: "media",
  mov: "media",
  o: "binary",
  so: "binary",
  a: "binary",
  out: "binary",
  dll: "binary",
  class: "binary",
  pyc: "binary",
};

const BY_NAME: Record<string, FileKind> = {
  makefile: "make",
  gnumakefile: "make",
  "cmakelists.txt": "make",
  dockerfile: "data",
  ".bashrc": "shell",
  ".profile": "shell",
  ".gitignore": "text",
  readme: "markdown",
  license: "text",
};

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function fileKind(name: string, isDir = false): FileKind {
  if (isDir) return "folder";
  const lower = name.toLowerCase();
  return BY_NAME[lower] ?? BY_EXT[extOf(lower)] ?? (extOf(lower) === "" ? "other" : "other");
}

const TEXT_KINDS = new Set<FileKind>(["c", "cpp", "header", "python", "shell", "web", "data", "text", "markdown", "make"]);

/** Files Code Studio opens; everything else goes to its Windows handler. */
export function isEditable(name: string): boolean {
  return TEXT_KINDS.has(fileKind(name));
}

export type RunLang = "python" | "c" | "cpp" | "shell";

/** Languages Code Studio can compile/run. */
export function runLang(name: string): RunLang | null {
  const k = fileKind(name);
  if (k === "python" || k === "c" || k === "cpp" || k === "shell") return k;
  return null;
}

/** POSIX single-quote escaping for paths placed in a shell command. */
export function shQuote(s: string): string {
  return /^[A-Za-z0-9_./~+-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`;
}

export interface RunOptions {
  cFlags: string;
  cppFlags: string;
  python: string;
  args: string;
}

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  cFlags: "-Wall -Wextra -g -std=c17",
  cppFlags: "-Wall -Wextra -g -std=c++20",
  python: "python3",
  args: "",
};

/** Shell command that builds (when needed) and runs `file` from its own directory. */
export function runCommand(fileName: string, lang: RunLang, opts: RunOptions = DEFAULT_RUN_OPTIONS): string {
  const src = shQuote(fileName);
  const base = fileName.replace(/\.[^.]+$/, "") || "programme";
  const bin = shQuote(`./${base}`);
  const args = opts.args.trim() ? ` ${opts.args.trim()}` : "";
  switch (lang) {
    case "python":
      return `${opts.python} ${src}${args}`;
    case "shell":
      return `bash ${src}${args}`;
    case "c":
      return `gcc ${opts.cFlags} ${src} -o ${shQuote(base)} -lm && ${bin}${args}`;
    case "cpp":
      return `g++ ${opts.cppFlags} ${src} -o ${shQuote(base)} && ${bin}${args}`;
  }
}

export function debugCommand(fileName: string, lang: RunLang, opts: RunOptions = DEFAULT_RUN_OPTIONS): string | null {
  const base = fileName.replace(/\.[^.]+$/, "") || "programme";
  const src = shQuote(fileName);
  if (lang === "c") return `gcc ${opts.cFlags} -O0 ${src} -o ${shQuote(base)} -lm && gdb -q ${shQuote(`./${base}`)}`;
  if (lang === "cpp") return `g++ ${opts.cppFlags} -O0 ${src} -o ${shQuote(base)} && gdb -q ${shQuote(`./${base}`)}`;
  if (lang === "python") return `${opts.python} -m pdb ${src}`;
  return null;
}

export function valgrindCommand(fileName: string, lang: RunLang, opts: RunOptions = DEFAULT_RUN_OPTIONS): string | null {
  const base = fileName.replace(/\.[^.]+$/, "") || "programme";
  const src = shQuote(fileName);
  const vg = `valgrind --leak-check=full --show-leak-kinds=all --track-origins=yes ${shQuote(`./${base}`)}`;
  if (lang === "c") return `gcc ${opts.cFlags} ${src} -o ${shQuote(base)} -lm && ${vg}`;
  if (lang === "cpp") return `g++ ${opts.cppFlags} ${src} -o ${shQuote(base)} && ${vg}`;
  return null;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

export function kindLabel(kind: FileKind): string {
  const labels: Record<FileKind, string> = {
    folder: "Dossier",
    c: "Source C",
    cpp: "Source C++",
    header: "En-tête C/C++",
    python: "Script Python",
    shell: "Script shell",
    web: "Fichier web",
    data: "Données",
    text: "Texte",
    markdown: "Markdown",
    make: "Build",
    image: "Image",
    pdf: "PDF",
    archive: "Archive",
    exe: "Programme",
    shortcut: "Raccourci",
    office: "Document Office",
    media: "Média",
    binary: "Binaire",
    other: "Fichier",
  };
  return labels[kind];
}
