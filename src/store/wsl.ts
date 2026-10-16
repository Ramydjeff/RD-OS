import { create } from "zustand";
import { errorMessage } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { useSettings } from "@/store/settings";
import { useWorkspace } from "@/store/workspace";
import type { Distro, WslStatus } from "@/types/ipc";

interface WslStore {
  status: WslStatus | null;
  loading: boolean;
  /** The detection call itself failed (distinct from WSL reporting a problem). */
  error: string | null;
  lastRefresh: number;
  refresh: () => Promise<WslStatus | null>;
}

export const useWsl = create<WslStore>((set, get) => ({
  status: null,
  loading: false,
  error: null,
  lastRefresh: 0,
  refresh: async () => {
    if (get().loading) return get().status;
    set({ loading: true, error: null });
    try {
      const status = await ipc.wslDetect();
      set({ status, loading: false, lastRefresh: Date.now() });
      return status;
    } catch (e) {
      set({ loading: false, error: errorMessage(e) });
      return null;
    }
  },
}));

/** Distributions that can host terminals (excludes managed system distros). */
export function usableDistros(status: WslStatus | null): Distro[] {
  return (status?.distros ?? []).filter((d) => !d.managed);
}

/**
 * Picks the distribution for new terminals: the one chosen in the UI, then the
 * app default from settings, then WSL's default, then the first usable one.
 */
export function chooseDistro(status: WslStatus | null): string | null {
  const usable = usableDistros(status);
  const byName = (n: string | null | undefined) => (n ? usable.find((d) => d.name === n)?.name ?? null : null);
  return (
    byName(useWorkspace.getState().selectedDistro) ??
    byName(useSettings.getState().settings.defaultDistro) ??
    byName(status?.defaultDistro) ??
    usable[0]?.name ??
    null
  );
}
