// File-type icons for the explorer and editor tabs: the shape says the family
// (code, data, text, image...), a muted hue says the language.

import {
  File,
  FileArchive,
  FileCode2,
  FileCog,
  FileImage,
  FileJson,
  FileLock,
  FileTerminal,
  FileText,
  Folder,
  FolderGit2,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

interface IconSpec {
  Icon: LucideIcon;
  color: string;
}

const CODE = (color: string): IconSpec => ({ Icon: FileCode2, color });

const BY_EXT: Record<string, IconSpec> = {
  c: CODE("text-[#7aa7e0]"),
  h: CODE("text-[#a48be0]"),
  cpp: CODE("text-[#5f9ad9]"),
  cc: CODE("text-[#5f9ad9]"),
  hpp: CODE("text-[#a48be0]"),
  ino: CODE("text-[#3fb0a6]"),
  py: CODE("text-[#e2b84f]"),
  js: CODE("text-[#d9c34a]"),
  mjs: CODE("text-[#d9c34a]"),
  jsx: CODE("text-[#56b8d6]"),
  ts: CODE("text-[#4f8fe0]"),
  tsx: CODE("text-[#56b8d6]"),
  rs: CODE("text-[#e0895a]"),
  go: CODE("text-[#4fb7c9]"),
  java: CODE("text-[#e07a5a]"),
  html: CODE("text-[#e0734f]"),
  css: CODE("text-[#6f8fe0]"),
  json: { Icon: FileJson, color: "text-[#d9a84a]" },
  yaml: { Icon: FileCog, color: "text-[#c98fd0]" },
  yml: { Icon: FileCog, color: "text-[#c98fd0]" },
  toml: { Icon: FileCog, color: "text-[#c98fd0]" },
  ini: { Icon: FileCog, color: "text-muted" },
  cfg: { Icon: FileCog, color: "text-muted" },
  sh: { Icon: FileTerminal, color: "text-[#5fc28a]" },
  bash: { Icon: FileTerminal, color: "text-[#5fc28a]" },
  ps1: { Icon: FileTerminal, color: "text-[#6f9fe0]" },
  md: { Icon: FileText, color: "text-[#8fb4dc]" },
  txt: { Icon: FileText, color: "text-fg2" },
  log: { Icon: FileText, color: "text-muted" },
  csv: { Icon: FileText, color: "text-[#5fc28a]" },
  lock: { Icon: FileLock, color: "text-muted" },
  zip: { Icon: FileArchive, color: "text-[#d0a060]" },
  gz: { Icon: FileArchive, color: "text-[#d0a060]" },
  tar: { Icon: FileArchive, color: "text-[#d0a060]" },
  "7z": { Icon: FileArchive, color: "text-[#d0a060]" },
};

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tif", "tiff", "avif"]);

const BY_NAME: Record<string, IconSpec> = {
  makefile: { Icon: FileCog, color: "text-[#e0895a]" },
  "cmakelists.txt": { Icon: FileCog, color: "text-[#5fc28a]" },
  dockerfile: { Icon: FileCog, color: "text-[#4fb7c9]" },
  ".gitignore": { Icon: FileCog, color: "text-muted" },
  ".env": { Icon: FileLock, color: "text-[#e2b84f]" },
};

export function fileIconSpec(name: string): IconSpec {
  const lower = name.toLowerCase();
  const named = BY_NAME[lower];
  if (named) return named;
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";
  if (IMAGE.has(ext)) return { Icon: FileImage, color: "text-[#b48be0]" };
  return BY_EXT[ext] ?? { Icon: File, color: "text-muted" };
}

export function FileIcon({ name, size = 15, className }: { name: string; size?: number; className?: string }) {
  const { Icon, color } = fileIconSpec(name);
  return <Icon size={size} strokeWidth={1.75} className={cn("shrink-0", color, className)} aria-hidden />;
}

export function FolderIcon({ name, open, size = 15, className }: { name: string; open: boolean; size?: number; className?: string }) {
  const dim = name === "node_modules" || name === ".git" || name === "__pycache__" || name === ".venv" || name === "target";
  const Icon = name === ".git" ? FolderGit2 : open ? FolderOpen : Folder;
  return (
    <Icon
      size={size}
      strokeWidth={1.75}
      className={cn("shrink-0", dim ? "text-faint" : "text-[var(--brand-tagline)]", className)}
      aria-hidden
    />
  );
}
