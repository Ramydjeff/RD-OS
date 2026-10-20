import { createContext, useContext } from "react";
import type { DesktopWindow } from "@/store/desktop";

export interface WindowCtx {
  win: DesktopWindow;
  /** The window has keyboard focus and sits on top. */
  focused: boolean;
  /** The window is on screen (not minimized). */
  visible: boolean;
}

export const WindowContext = createContext<WindowCtx | null>(null);

/** The window an app is rendered in. Apps are only ever rendered inside one. */
export function useWindow(): WindowCtx {
  const ctx = useContext(WindowContext);
  if (!ctx) throw new Error("useWindow() used outside a desktop window");
  return ctx;
}

/** Same as useWindow(), but null when the component also renders outside a window. */
export function useOptionalWindow(): WindowCtx | null {
  return useContext(WindowContext);
}
