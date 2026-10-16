import { create } from "zustand";
import { errorMessage } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import type { HostReport, SessionSummary, WslMetrics } from "@/types/ipc";

interface MonitorStore {
  host: HostReport | null;
  hostError: string | null;
  hostAt: number | null;
  wsl: WslMetrics | null;
  wslError: string | null;
  wslAt: number | null;
  backendSessions: SessionSummary[];
  refreshHost: () => Promise<void>;
  refreshWsl: (distro: string | null) => Promise<void>;
  refreshSessions: () => Promise<void>;
}

export const useMonitor = create<MonitorStore>((set) => ({
  host: null,
  hostError: null,
  hostAt: null,
  wsl: null,
  wslError: null,
  wslAt: null,
  backendSessions: [],
  refreshHost: async () => {
    try {
      const host = await ipc.monitorHost();
      set({ host, hostError: null, hostAt: Date.now() });
    } catch (e) {
      set({ hostError: errorMessage(e) });
    }
  },
  refreshWsl: async (distro) => {
    if (!distro) {
      set({ wsl: null, wslError: "No distribution selected." });
      return;
    }
    try {
      const wsl = await ipc.monitorWsl(distro);
      set({ wsl, wslError: null, wslAt: Date.now() });
    } catch (e) {
      set({ wsl: null, wslError: errorMessage(e), wslAt: Date.now() });
    }
  },
  refreshSessions: async () => {
    try {
      set({ backendSessions: await ipc.terminalList() });
    } catch {
      /* the table falls back to what the UI knows */
    }
  },
}));
