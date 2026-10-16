import { TerminalController } from "@/components/terminal/controller";
import { confirmDialog } from "@/store/ui";
import { runKeyEvent } from "@/features/keys";
import { collectLeaves } from "@/lib/layoutTree";
import { useSettings } from "@/store/settings";
import { useTerminals } from "@/store/terminals";
import { useTheme } from "@/store/theme";
import type { Location } from "@/types/ipc";

const controllers = new Map<string, TerminalController>();

export function getController(terminalId: string): TerminalController | undefined {
  return controllers.get(terminalId);
}

export function allControllers(): TerminalController[] {
  return [...controllers.values()];
}

function previewPaste(text: string): string {
  const lines = text.split("\n");
  const shown = lines.slice(0, 12).join("\n");
  return lines.length > 12 ? `${shown}\n... (${lines.length - 12} more lines)` : shown;
}

export function createController(
  terminalId: string,
  target: { distro: string | null; cwd: Location | null },
): TerminalController {
  const existing = controllers.get(terminalId);
  if (existing) return existing;
  const controller = new TerminalController(terminalId, target, {
    onChange: (patch) => useTerminals.getState().patchMeta(terminalId, patch),
    getSettings: () => useSettings.getState().settings,
    getTheme: () => useTheme.getState().resolved,
    confirmPaste: (text) =>
      confirmDialog({
        title: "Paste multiple lines?",
        message: `The clipboard holds ${text.split("\n").length} lines. This shell does not use bracketed paste, so each line runs as soon as it arrives. Only paste commands you trust.`,
        detail: previewPaste(text),
        confirmLabel: "Paste",
        danger: true,
      }),
    onAppKey: (e) => runKeyEvent(e, true),
    onFocus: () => {
      const { tabs, setActivePane, setActiveTab, activeTabId } = useTerminals.getState();
      for (const tab of tabs) {
        const leaf = collectLeaves(tab.root).find((l) => l.terminalId === terminalId);
        if (leaf) {
          if (activeTabId !== tab.id) setActiveTab(tab.id);
          setActivePane(tab.id, leaf.id);
          return;
        }
      }
    },
    onSearchRequested: () => useTerminals.getState().setSearchFor(terminalId),
  });
  controllers.set(terminalId, controller);
  return controller;
}

export async function destroyController(terminalId: string): Promise<void> {
  const c = controllers.get(terminalId);
  controllers.delete(terminalId);
  useTerminals.getState().dropMeta(terminalId);
  await c?.dispose();
}

// Keep every live terminal in sync with settings and theme changes.
useSettings.subscribe((state, prev) => {
  if (state.settings.terminal !== prev.settings.terminal) {
    for (const c of controllers.values()) c.applySettings(state.settings);
  }
});
useTheme.subscribe((state, prev) => {
  if (state.resolved !== prev.resolved) for (const c of controllers.values()) c.applyTheme(state.resolved);
});
