// Terminal-level operations shared by the toolbar, shortcuts and command palette.

import { createController, destroyController, getController } from "@/components/terminal/registry";
import { errorMessage } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { collectLeaves, type SplitDirection } from "@/lib/layoutTree";
import { locationDisplay } from "@/lib/paths";
import { useSettings } from "@/store/settings";
import { activeLeaf, activeTerminalId, useTerminals } from "@/store/terminals";
import { confirmDialog, toast } from "@/store/ui";
import { chooseDistro, useWsl } from "@/store/wsl";
import { useWorkspace } from "@/store/workspace";
import type { Location } from "@/types/ipc";

export interface OpenOptions {
  /** `undefined`: current project (or default dir); `null`: the Linux home directory. */
  cwd?: Location | null;
  distro?: string | null;
  split?: SplitDirection;
}

let guardUntil = 0;

function focusSoon(terminalId: string): void {
  requestAnimationFrame(() => requestAnimationFrame(() => getController(terminalId)?.focus()));
}

/** Opens a terminal in a new tab, or as a split of the active pane. */
export async function openTerminal(opts: OpenOptions = {}): Promise<string | null> {
  // Repeated clicks must not create duplicate sessions.
  const now = Date.now();
  if (now < guardUntil) return null;
  guardUntil = now + 350;

  let status = useWsl.getState().status;
  if (!status) status = await useWsl.getState().refresh();
  if (!status || !status.available || status.distros.length === 0) {
    toast("error", status?.problem?.message ?? useWsl.getState().error ?? "WSL is not available.");
    useWorkspace.getState().setView("environments");
    return null;
  }

  const settings = useSettings.getState().settings;
  const ws = useWorkspace.getState();
  const cwd = opts.cwd !== undefined ? opts.cwd : (ws.project ?? settings.defaultProjectDir ?? null);
  const distro = opts.distro ?? (cwd?.kind === "linux" ? cwd.distro : chooseDistro(status));
  if (!distro) {
    toast("error", "No usable WSL distribution was found. Install one from the Environments view.");
    ws.setView("environments");
    return null;
  }
  const info = status.distros.find((d) => d.name === distro);
  if (info && !info.running) toast("info", `Starting ${distro}...`);

  const terminalId = crypto.randomUUID();
  createController(terminalId, { distro, cwd });
  const store = useTerminals.getState();
  const current = activeLeaf();
  if (opts.split && current) store.splitPane(current.tab.id, current.leaf.id, opts.split, terminalId);
  else store.addTab(terminalId);
  ws.setPanelVisible(true);
  focusSoon(terminalId);
  void ipc.log("info", "terminal", `opening ${distro} in ${cwd ? locationDisplay(cwd) : "~"}`);
  return terminalId;
}

/** True when closing would end running work; asks the user in that case. */
export async function confirmClosing(terminalIds: string[], what: string): Promise<boolean> {
  if (!useSettings.getState().settings.confirmations.closeBusyTerminal) return true;
  const checks = await Promise.all(
    terminalIds.map(async (id) => {
      const meta = useTerminals.getState().meta[id];
      const backendId = meta?.backendId;
      if (!backendId || meta?.state !== "running") return { id, busy: false, unknown: false, jobs: [] as string[] };
      try {
        const r = await ipc.terminalBusyCheck(backendId);
        return { id, ...r };
      } catch {
        return { id, busy: false, unknown: true, jobs: [] as string[] };
      }
    }),
  );
  const busy = checks.filter((c) => c.busy);
  const unknown = checks.filter((c) => c.unknown && !c.busy);
  if (busy.length === 0 && unknown.length === 0) return true;
  const jobs = [...new Set(busy.flatMap((c) => c.jobs))];
  const message =
    busy.length > 0
      ? `${what} still has running processes${jobs.length ? ` (${jobs.slice(0, 6).join(", ")})` : ""}. They will be stopped and unsaved work in them is lost.`
      : `${what} may still have running processes; this could not be verified.`;
  return confirmDialog({
    title: "End this terminal session?",
    message,
    confirmLabel: "End session",
    danger: true,
  });
}

export async function closePane(tabId: string, paneId: string): Promise<void> {
  const tab = useTerminals.getState().tabs.find((t) => t.id === tabId);
  const leaf = tab && collectLeaves(tab.root).find((l) => l.id === paneId);
  if (!tab || !leaf) return;
  if (!(await confirmClosing([leaf.terminalId], "This terminal"))) return;
  useTerminals.getState().removePane(tabId, paneId);
  await destroyController(leaf.terminalId);
}

export async function closeActive(): Promise<void> {
  const a = activeLeaf();
  if (a) await closePane(a.tab.id, a.leaf.id);
}

export async function closeTab(tabId: string): Promise<void> {
  const tab = useTerminals.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const leaves = collectLeaves(tab.root);
  const label = leaves.length > 1 ? "This tab" : "This terminal";
  if (!(await confirmClosing(leaves.map((l) => l.terminalId), label))) return;
  for (const l of leaves) useTerminals.getState().removePane(tabId, l.id);
  await Promise.all(leaves.map((l) => destroyController(l.terminalId)));
}

export async function restartTerminal(terminalId: string): Promise<void> {
  const c = getController(terminalId);
  if (!c) return;
  if (c.meta.state === "running" && !(await confirmClosing([terminalId], "This terminal"))) return;
  await c.restart();
  focusSoon(terminalId);
}

export async function terminateTerminal(terminalId: string): Promise<void> {
  const c = getController(terminalId);
  if (!c || c.meta.state !== "running") return;
  if (!(await confirmClosing([terminalId], "This terminal"))) return;
  await c.terminate();
}

export function activeController() {
  const id = activeTerminalId();
  return id ? getController(id) : undefined;
}

export function focusActiveTerminal(): void {
  const id = activeTerminalId();
  if (id) focusSoon(id);
}

export function openSearch(): void {
  const id = activeTerminalId();
  if (!id) return;
  useWorkspace.getState().setPanelVisible(true);
  useTerminals.getState().setSearchFor(id);
}

/** Types text at the active prompt without pressing Enter. */
export function insertIntoActive(text: string): boolean {
  const c = activeController();
  if (!c || c.meta.state !== "running") {
    toast("error", "Open a running terminal first.");
    return false;
  }
  c.insertText(text);
  return true;
}

/** Ends every terminal at application exit. Resolves when the backend has released them. */
export async function shutdownTerminals(): Promise<void> {
  const ids = Object.keys(useTerminals.getState().meta);
  await Promise.allSettled(ids.map((id) => destroyController(id)));
}

export async function reportError(context: string, e: unknown): Promise<void> {
  const message = errorMessage(e);
  toast("error", `${context}: ${message}`);
  void ipc.log("error", "ui", `${context}: ${message}`);
}
