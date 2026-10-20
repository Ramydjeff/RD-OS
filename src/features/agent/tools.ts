// What happens when rAImy Agent calls a tool. Approval is handled by the
// agent store before `runTool` is called for tools that change things.

import { errorMessage } from "@/lib/errors";
import { formatSize } from "@/lib/fileTypes";
import { ipc } from "@/lib/ipc";
import { parentLocation, sameLocation } from "@/lib/paths";
import { useDesktop } from "@/store/desktop";
import { fileName, useStudio } from "@/store/studio";
import { useWorkspace } from "@/store/workspace";
import { chooseDistro, usableDistros, useWsl } from "@/store/wsl";
import type { Diagnostics, Location } from "@/types/ipc";

const MAX_FILE_CHARS = 120_000;
const MAX_ENTRIES = 400;

export interface ToolOutcome {
  /** Text returned to the model. */
  content: string;
  isError: boolean;
  /** Extra data for the UI card (exit code, path...). */
  meta?: Record<string, unknown>;
}

export async function currentDistro(): Promise<string> {
  let status = useWsl.getState().status;
  if (!status) status = await useWsl.getState().refresh();
  const d = chooseDistro(status);
  if (!d) throw new Error("Aucune distribution WSL utilisable. Installez Ubuntu (voir rAImy Academy → Installer WSL).");
  return d;
}

const homes = new Map<string, string>();

export async function linuxHome(distro: string): Promise<string> {
  const known = homes.get(distro);
  if (known) return known;
  const home = await ipc.wslLinuxHome(distro);
  homes.set(distro, home);
  return home;
}

function isWindowsPath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");
}

/** Turns what the model wrote ("~/tp/main.c", "C:\\x", "src/a.py") into a location. */
export async function resolvePath(input: string): Promise<{ location: Location; exists: boolean; isDir: boolean; display: string }> {
  let p = input.trim().replace(/^["']|["']$/g, "");
  if (!p) throw new Error("Chemin vide.");
  const distro = await currentDistro();
  if (p === "~" || p.startsWith("~/")) p = (await linuxHome(distro)) + p.slice(1);
  else if (!p.startsWith("/") && !isWindowsPath(p)) {
    const project = useWorkspace.getState().project;
    const base = project?.kind === "linux" ? project.path : await linuxHome(distro);
    p = `${base.replace(/\/+$/, "")}/${p.replace(/^\.\//, "")}`;
  }
  const r = await ipc.fsResolveLocation(p, distro);
  return { location: r.location, exists: r.exists, isDir: r.isDir, display: r.display };
}

function numbered(text: string): string {
  const lines = text.split("\n");
  const width = String(lines.length).length;
  return lines.map((l, i) => `${String(i + 1).padStart(width)}│ ${l}`).join("\n");
}

let diagCache: { distro: string; at: number; value: Diagnostics } | null = null;

async function diagnostics(distro: string): Promise<Diagnostics> {
  if (diagCache && diagCache.distro === distro && Date.now() - diagCache.at < 5 * 60_000) return diagCache.value;
  const value = await ipc.envDiagnostics(distro);
  diagCache = { distro, at: Date.now(), value };
  return value;
}

type Input = Record<string, unknown>;

function str(input: Input, key: string): string {
  const v = input[key];
  if (typeof v !== "string") throw new Error(`Paramètre « ${key} » manquant ou invalide.`);
  return v;
}

export async function runTool(name: string, input: Input): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "run_command": {
        const distro = await currentDistro();
        const command = str(input, "command");
        let cwd = typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : null;
        if (cwd?.startsWith("~")) cwd = (await linuxHome(distro)) + cwd.slice(1);
        const r = await ipc.agentRunCommand(distro, cwd, command);
        const parts = [
          r.timedOut
            ? `La commande a dépassé le délai et a été arrêtée (${(r.durationMs / 1000).toFixed(1)} s).`
            : `code de sortie : ${r.exitCode ?? "inconnu"} (durée ${(r.durationMs / 1000).toFixed(1)} s)`,
        ];
        parts.push(r.stdout.trim() ? `--- stdout ---\n${r.stdout.trimEnd()}` : "--- stdout --- (vide)");
        if (r.stderr.trim()) parts.push(`--- stderr ---\n${r.stderr.trimEnd()}`);
        if (r.truncated) parts.push("(sortie tronquée)");
        return {
          content: parts.join("\n"),
          // A program that exits non-zero is a normal result; only a timeout is a tool failure.
          isError: r.timedOut,
          meta: { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, durationMs: r.durationMs, timedOut: r.timedOut },
        };
      }

      case "read_file": {
        const target = await resolvePath(str(input, "path"));
        if (!target.exists) return { content: `Le fichier ${target.display} n'existe pas.`, isError: true };
        if (target.isDir) return { content: `${target.display} est un dossier ; utilise list_directory.`, isError: true };
        const parent = parentLocation(target.location);
        if (!parent) return { content: "Chemin invalide.", isError: true };
        let text = await ipc.fsReadFile(parent, fileName(target.location));
        let note = "";
        if (text.length > MAX_FILE_CHARS) {
          note = `\n\n[... fichier tronqué : ${text.length - MAX_FILE_CHARS} caractères non affichés ...]`;
          text = text.slice(0, MAX_FILE_CHARS);
        }
        return {
          content: `${target.display}\n${numbered(text)}${note}`,
          isError: false,
          meta: { path: target.display, lines: text.split("\n").length },
        };
      }

      case "list_directory": {
        const target = await resolvePath(str(input, "path"));
        if (!target.exists || !target.isDir) return { content: `${target.display} n'est pas un dossier existant.`, isError: true };
        const listing = await ipc.fsListDir(target.location, "", false);
        const entries = [...listing.entries].sort((a, b) =>
          a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
        );
        const lines = entries
          .slice(0, MAX_ENTRIES)
          .map((e) => (e.kind === "dir" ? `${e.name}/` : `${e.name}  (${formatSize(e.size)})`));
        if (entries.length > MAX_ENTRIES || listing.truncated) lines.push(`... ${entries.length - MAX_ENTRIES} autres éléments`);
        return {
          content: `${target.display} — ${entries.length} élément(s)\n${lines.join("\n") || "(dossier vide)"}`,
          isError: false,
          meta: { path: target.display, count: entries.length },
        };
      }

      case "write_file": {
        const target = await resolvePath(str(input, "path"));
        const content = str(input, "content");
        if (target.isDir) return { content: `${target.display} est un dossier.`, isError: true };
        const parent = parentLocation(target.location);
        if (!parent) return { content: "Chemin invalide.", isError: true };
        const name = fileName(target.location);
        await ipc.fsWriteFile(parent, name, content);
        // Keep an open, unmodified Code Studio tab in sync with the new content.
        const studio = useStudio.getState();
        const tab = studio.tabs.find((t) => sameLocation(t.location, target.location));
        if (tab && tab.content === tab.saved) {
          useStudio.setState({
            tabs: studio.tabs.map((t) => (t.id === tab.id ? { ...t, content, saved: content } : t)),
          });
        }
        return {
          content: `${target.exists ? "Fichier remplacé" : "Fichier créé"} : ${target.display} (${content.split("\n").length} lignes).`,
          isError: false,
          meta: { path: target.display, location: target.location },
        };
      }

      case "open_in_code_studio": {
        const target = await resolvePath(str(input, "path"));
        if (!target.exists || target.isDir) return { content: `${target.display} n'est pas un fichier existant.`, isError: true };
        await useStudio.getState().openFile(target.location);
        useDesktop.getState().openApp("studio");
        return { content: `${target.display} est ouvert dans Code Studio.`, isError: false };
      }

      case "get_environment": {
        const status = useWsl.getState().status ?? (await useWsl.getState().refresh());
        const lines: string[] = [];
        if (!status?.available) {
          lines.push(`WSL indisponible : ${status?.problem?.message ?? "non détecté"}`);
          if (status?.problem?.hint) lines.push(`Conseil : ${status.problem.hint}`);
          return { content: lines.join("\n"), isError: false };
        }
        const distro = await currentDistro();
        lines.push(`WSL ${status.wslVersion ?? ""}`.trim());
        lines.push(
          `Distributions : ${usableDistros(status)
            .map((d) => `${d.name}${d.isDefault ? " (défaut)" : ""} — ${d.running ? "démarrée" : "arrêtée"}`)
            .join(", ")}`,
        );
        lines.push(`Distribution utilisée : ${distro}, dossier personnel ${await linuxHome(distro)}`);
        const diag = await diagnostics(distro);
        if (diag.osRelease.prettyName) lines.push(`Système : ${diag.osRelease.prettyName}`);
        for (const t of diag.tools) lines.push(`- ${t.label} (${t.command}) : ${t.found ? (t.version ?? "installé") : "ABSENT"}`);
        const tabs = useStudio.getState().tabs;
        if (tabs.length) lines.push(`Fichiers ouverts dans Code Studio : ${tabs.map((t) => t.name).join(", ")}`);
        return { content: lines.join("\n"), isError: false };
      }

      default:
        return { content: `Outil inconnu : ${name}`, isError: true };
    }
  } catch (e) {
    return { content: `Erreur : ${errorMessage(e)}`, isError: true };
  }
}

/** One-line summary of a tool call for the chat card header. */
export function describeCall(name: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  switch (name) {
    case "run_command":
      return s("explanation") || "Exécuter une commande";
    case "read_file":
      return `Lecture de ${s("path")}`;
    case "list_directory":
      return `Contenu de ${s("path")}`;
    case "write_file":
      return `Écriture de ${s("path")}`;
    case "open_in_code_studio":
      return `Ouverture de ${s("path")} dans Code Studio`;
    case "get_environment":
      return "Analyse de l'environnement";
    default:
      return name;
  }
}
