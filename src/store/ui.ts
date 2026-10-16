import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ConfirmRequest {
  id: number;
  title: string;
  message: string;
  /** Optional monospace detail (a path, a command, a preview). */
  detail?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

export interface PromptRequest {
  id: number;
  title: string;
  label: string;
  initial: string;
  confirmLabel: string;
  validate?: (value: string) => string | null;
  resolve: (value: string | null) => void;
}

interface UiState {
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  prompt: PromptRequest | null;
  paletteOpen: boolean;
  newProjectOpen: boolean;
  openProjectOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  setNewProjectOpen: (open: boolean) => void;
  setOpenProjectOpen: (open: boolean) => void;
  dismissToast: (id: number) => void;
}

let nextId = 1;

export const useUi = create<UiState>((set) => ({
  toasts: [],
  confirm: null,
  prompt: null,
  paletteOpen: false,
  newProjectOpen: false,
  openProjectOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setNewProjectOpen: (newProjectOpen) => set({ newProjectOpen }),
  setOpenProjectOpen: (openProjectOpen) => set({ openProjectOpen }),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function toast(kind: ToastKind, message: string, ms = kind === "error" ? 7000 : 3500): void {
  const id = nextId++;
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
  setTimeout(() => useUi.getState().dismissToast(id), ms);
}

export interface ConfirmOptions {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** Shows a modal confirmation. Resolves `false` for cancel, Escape or a newer dialog replacing it. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useUi.getState().confirm?.resolve(false);
    useUi.setState({
      confirm: {
        id: nextId++,
        title: opts.title,
        message: opts.message,
        detail: opts.detail,
        confirmLabel: opts.confirmLabel ?? "Confirm",
        cancelLabel: opts.cancelLabel ?? "Cancel",
        danger: opts.danger ?? false,
        resolve: (ok) => {
          useUi.setState({ confirm: null });
          resolve(ok);
        },
      },
    });
  });
}

export interface PromptOptions {
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  validate?: (value: string) => string | null;
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    useUi.getState().prompt?.resolve(null);
    useUi.setState({
      prompt: {
        id: nextId++,
        title: opts.title,
        label: opts.label,
        initial: opts.initial ?? "",
        confirmLabel: opts.confirmLabel ?? "OK",
        validate: opts.validate,
        resolve: (value) => {
          useUi.setState({ prompt: null });
          resolve(value);
        },
      },
    });
  });
}
