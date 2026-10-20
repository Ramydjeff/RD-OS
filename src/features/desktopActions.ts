// Things the desktop, the launcher and the apps all do: open an item, launch
// a Windows program, run a command in the terminal, control the OS window.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { getController } from "@/components/terminal/registry";
import { activeController, openTerminal } from "@/features/terminalActions";
import { errorMessage } from "@/lib/errors";
import { isEditable } from "@/lib/fileTypes";
import { ipc } from "@/lib/ipc";
import { locationDisplay } from "@/lib/paths";
import { useDesktop, type DesktopItem, type PinnedItem } from "@/store/desktop";
import { fileName, useStudio } from "@/store/studio";
import { useTerminals } from "@/store/terminals";
import { toast } from "@/store/ui";
import type { Location } from "@/types/ipc";

export async function launchWinApp(path: string, name?: string): Promise<void> {
  try {
    await ipc.desktopOpen({ kind: "windows", path });
    if (name) toast("info", `Lancement de ${name}…`, 2200);
  } catch (e) {
    toast("error", `Impossible de lancer ${name ?? path} : ${errorMessage(e)}`);
  }
}

export function openFolder(location: Location, newWindow = true): void {
  useDesktop.getState().openApp("files", { args: { location }, newWindow });
}

export async function openInStudio(location: Location): Promise<void> {
  try {
    await useStudio.getState().openFile(location);
    useDesktop.getState().openApp("studio");
  } catch (e) {
    toast("error", `Impossible d'ouvrir ${locationDisplay(location)} : ${errorMessage(e)}`);
  }
}

/** Folders open in Fichiers, source files in Code Studio, the rest with Windows. */
export async function openLocation(location: Location, isDir: boolean): Promise<void> {
  if (isDir) return openFolder(location);
  if (isEditable(fileName(location))) return openInStudio(location);
  try {
    await ipc.desktopOpen(location);
  } catch (e) {
    toast("error", `Impossible d'ouvrir ${locationDisplay(location)} : ${errorMessage(e)}`);
  }
}

export async function revealInExplorer(location: Location): Promise<void> {
  try {
    await ipc.desktopOpen(location, true);
  } catch (e) {
    toast("error", errorMessage(e));
  }
}

export function openDesktopItem(item: DesktopItem | PinnedItem): void {
  if (item.kind === "app") useDesktop.getState().openApp(item.app);
  else if (item.kind === "winapp") void launchWinApp(item.path, item.name);
  else void openLocation(item.location, item.isDir);
}

export function newCodeFile(templateId: string): void {
  useStudio.getState().newFile(templateId);
  useDesktop.getState().openApp("studio");
}

function waitRunning(terminalId: string, timeoutMs = 20_000): Promise<boolean> {
  return new Promise((resolve) => {
    const ready = () => useTerminals.getState().meta[terminalId]?.state;
    if (ready() === "running") return resolve(true);
    const timer = setTimeout(() => {
      unsub();
      resolve(false);
    }, timeoutMs);
    const unsub = useTerminals.subscribe(() => {
      const s = ready();
      if (s === "running" || s === "failed" || s === "exited") {
        clearTimeout(timer);
        unsub();
        resolve(s === "running");
      }
    });
  });
}

/**
 * Types `command` in the Terminal app and presses Enter: in the active
 * terminal when one is running and no folder is requested, else in a new tab.
 */
export async function runInTerminal(command: string, cwd?: Location | null): Promise<void> {
  useDesktop.getState().openApp("terminal");
  let c = cwd === undefined ? activeController() : undefined;
  if (!c || c.meta.state !== "running") {
    const id = await openTerminal(cwd === undefined ? {} : { cwd });
    if (!id || !(await waitRunning(id))) return;
    c = getController(id);
    // Give bash a moment to print its prompt so the command shows after it.
    await new Promise((r) => setTimeout(r, 350));
  }
  if (!c) return;
  c.insertText(command);
  c.term.input("\r");
  c.focus();
}

// ─── The OS window itself ────────────────────────────────────────────────────

export async function toggleFullscreen(): Promise<void> {
  try {
    const w = getCurrentWindow();
    await w.setFullscreen(!(await w.isFullscreen()));
  } catch {
    /* not running inside the desktop app */
  }
}

export async function minimizeOs(): Promise<void> {
  try {
    await getCurrentWindow().minimize();
  } catch {
    /* not running inside the desktop app */
  }
}

export async function quitOs(): Promise<void> {
  try {
    await getCurrentWindow().close();
  } catch {
    /* not running inside the desktop app */
  }
}
