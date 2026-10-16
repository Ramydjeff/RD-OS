import { create } from "zustand";
import type { ResolvedTheme } from "@/lib/terminalTheme";
import type { ThemeSetting } from "@/types/ipc";

const query = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

export function resolveTheme(setting: ThemeSetting): ResolvedTheme {
  if (setting === "system") return query?.matches ? "light" : "dark";
  return setting;
}

interface ThemeStore {
  setting: ThemeSetting;
  resolved: ResolvedTheme;
  setSetting: (s: ThemeSetting) => void;
}

function apply(resolved: ResolvedTheme) {
  document.documentElement.dataset.theme = resolved;
}

export const useTheme = create<ThemeStore>((set, get) => ({
  setting: "dark",
  resolved: "dark",
  setSetting: (setting) => {
    const resolved = resolveTheme(setting);
    apply(resolved);
    set({ setting, resolved });
    void get;
  },
}));

// Follow the OS when the setting is "system".
query?.addEventListener("change", () => {
  const { setting, setSetting } = useTheme.getState();
  if (setting === "system") setSetting("system");
});
