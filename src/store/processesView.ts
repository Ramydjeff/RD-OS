// Which tab the "Processus" view shows. Kept apart from the simulator store so
// that opening the view from anywhere never pulls the C engine into the
// startup bundle: the simulator is loaded on demand.

import { create } from "zustand";

export type ProcessesTab = "cfiles" | "simulator" | "metrics";

export const useProcessesView = create<{ tab: ProcessesTab; setTab: (tab: ProcessesTab) => void }>((set) => ({
  tab: "cfiles",
  setTab: (tab) => set({ tab }),
}));

/** Loads a C source into the simulator and shows it (explorer, editor, C file manager). */
export async function simulateSource(code: string, fileName: string, fileId?: string): Promise<void> {
  const { useSimulator } = await import("@/store/simulator");
  useSimulator.getState().load({ code, fileName, fileId });
  useProcessesView.getState().setTab("simulator");
}
