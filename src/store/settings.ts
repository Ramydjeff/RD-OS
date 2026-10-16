import { create } from "zustand";
import { errorMessage } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import type { Settings } from "@/types/ipc";

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  theme: "dark",
  terminal: {
    fontFamily: "Cascadia Code, Cascadia Mono, Consolas, monospace",
    fontSize: 14,
    lineHeight: 1.2,
    cursorStyle: "block",
    cursorBlink: true,
    scrollback: 10000,
    copyOnSelect: false,
  },
  defaultDistro: null,
  defaultProjectDir: null,
  startup: "open_terminal",
  shortcuts: {},
  confirmations: {
    deleteEntries: true,
    closeBusyTerminal: true,
    closeAppWithSessions: true,
    terminateDistro: true,
  },
  monitor: { enabled: true, intervalSecs: 10 },
};

/** Mirrors the backend rules so most mistakes are caught before a round trip. */
export function validateSettings(s: Settings): string[] {
  const errs: string[] = [];
  const t = s.terminal;
  if (!/^[A-Za-z0-9 ,'"._-]{1,200}$/.test(t.fontFamily.trim()) || !t.fontFamily.trim()) {
    errs.push("Font family may only contain letters, digits, spaces, commas, quotes, '.', '_' and '-'.");
  }
  if (!Number.isInteger(t.fontSize) || t.fontSize < 8 || t.fontSize > 32) errs.push("Font size must be between 8 and 32.");
  if (!(t.lineHeight >= 1 && t.lineHeight <= 2)) errs.push("Line height must be between 1.0 and 2.0.");
  if (!Number.isInteger(t.scrollback) || t.scrollback < 500 || t.scrollback > 100000) {
    errs.push("Scrollback must be between 500 and 100000 lines.");
  }
  if (!Number.isInteger(s.monitor.intervalSecs) || s.monitor.intervalSecs < 2 || s.monitor.intervalSecs > 300) {
    errs.push("Monitor interval must be between 2 and 300 seconds.");
  }
  return errs;
}

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
  warning: string | null;
  load: () => Promise<void>;
  /** Validates, saves, then applies. Returns an error message or null. */
  update: (mutate: (s: Settings) => Settings) => Promise<string | null>;
  reset: () => Promise<string | null>;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  warning: null,
  load: async () => {
    try {
      const { value, warning } = await ipc.settingsLoad();
      set({ settings: value, warning, loaded: true });
    } catch (e) {
      set({ loaded: true, warning: `Settings could not be loaded: ${errorMessage(e)}` });
    }
  },
  update: async (mutate) => {
    const next = mutate(structuredClone(get().settings));
    const problems = validateSettings(next);
    if (problems.length > 0) return problems.join(" ");
    try {
      await ipc.settingsSave(next);
      set({ settings: next });
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  },
  reset: async () => {
    try {
      const fresh = await ipc.settingsReset();
      set({ settings: fresh, warning: null });
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  },
}));
