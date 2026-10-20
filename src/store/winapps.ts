// Windows programs found in the Start Menu and on the Windows desktop, plus
// the user's well-known folders and drives. Loaded once, on first use.

import { create } from "zustand";
import { errorMessage } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import type { HostPlaces, WinApp } from "@/types/ipc";

interface WinAppsStore {
  apps: WinApp[];
  places: HostPlaces | null;
  loading: boolean;
  error: string | null;
  loaded: boolean;
  ensure: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useWinApps = create<WinAppsStore>((set, get) => ({
  apps: [],
  places: null,
  loading: false,
  error: null,
  loaded: false,
  ensure: async () => {
    if (get().loaded || get().loading) return;
    await get().refresh();
  },
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const [apps, places] = await Promise.all([ipc.desktopWinApps(), ipc.desktopPlaces()]);
      set({ apps, places, loading: false, loaded: true });
    } catch (e) {
      set({ loading: false, loaded: true, error: errorMessage(e) });
    }
  },
}));
