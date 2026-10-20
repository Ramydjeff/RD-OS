import { create } from "zustand";
import { DEFAULT_EXAMPLE, SIM_EXAMPLES } from "@/components/processes/simExamples";
import { DEFAULT_OPTIONS, type SimOptions } from "@/components/processes/engine";

export interface SimProgram {
  id: string;
  title: string;
  fileName: string;
  code: string;
  /** Set when the program comes from (and can be saved back to) "Mes fichiers .c". */
  fileId?: string;
  isCustom: boolean;
}

interface SimulatorState {
  programs: SimProgram[];
  selectedId: string;
  options: SimOptions;
  select: (id: string) => void;
  /** Adds or replaces a custom program (matched by fileId, then by file name) and selects it. */
  load: (p: { code: string; fileName: string; fileId?: string }) => SimProgram;
  updateCode: (id: string, code: string, fileName?: string) => void;
  remove: (id: string) => void;
  setOptions: (patch: Partial<SimOptions>) => void;
}

const examples: SimProgram[] = SIM_EXAMPLES.map((e) => ({
  id: e.id,
  title: e.title,
  fileName: e.fileName,
  code: e.code,
  isCustom: false,
}));

export const useSimulator = create<SimulatorState>((set, get) => ({
  programs: examples,
  selectedId: DEFAULT_EXAMPLE.id,
  options: { ...DEFAULT_OPTIONS },
  select: (id) => set({ selectedId: id }),
  load: ({ code, fileName, fileId }) => {
    const existing = get().programs.find(
      (p) => p.isCustom && ((fileId && p.fileId === fileId) || (!fileId && !p.fileId && p.fileName === fileName)),
    );
    if (existing) {
      const updated = { ...existing, code, fileName, title: fileName };
      set({ programs: get().programs.map((p) => (p.id === existing.id ? updated : p)), selectedId: existing.id });
      return updated;
    }
    const prog: SimProgram = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: fileName,
      fileName,
      code,
      fileId,
      isCustom: true,
    };
    set({ programs: [prog, ...get().programs], selectedId: prog.id });
    return prog;
  },
  updateCode: (id, code, fileName) =>
    set({
      programs: get().programs.map((p) => {
        if (p.id !== id) return p;
        if (fileName && p.isCustom) return { ...p, code, fileName, title: fileName };
        return { ...p, code };
      }),
    }),
  remove: (id) => {
    const programs = get().programs.filter((p) => p.id !== id);
    set({ programs, selectedId: get().selectedId === id ? DEFAULT_EXAMPLE.id : get().selectedId });
  },
  setOptions: (patch) => set({ options: { ...get().options, ...patch } }),
}));

export function isExampleModified(p: SimProgram): boolean {
  if (p.isCustom) return false;
  return SIM_EXAMPLES.find((e) => e.id === p.id)?.code !== p.code;
}

export function resetExample(id: string) {
  const ex = SIM_EXAMPLES.find((e) => e.id === id);
  if (ex) useSimulator.getState().updateCode(id, ex.code);
}
