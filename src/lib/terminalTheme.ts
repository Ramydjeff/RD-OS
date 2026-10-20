import type { ITheme } from "@xterm/xterm";

export type ResolvedTheme = "dark" | "light";

// Backgrounds match --term-bg in styles/index.css so the pane and the canvas
// are one surface. Coral is kept for the cursor and the selection only.
const DARK: ITheme = {
  background: "#0c0e0b",
  foreground: "#e3e9ef",
  cursor: "#f43f52",
  cursorAccent: "#0c0e0b",
  selectionBackground: "rgba(244, 63, 82, 0.30)",
  selectionInactiveBackground: "rgba(217, 230, 245, 0.14)",
  black: "#1a1e1a",
  red: "#f2545f",
  green: "#5bd68f",
  yellow: "#f2c35b",
  blue: "#78aef0",
  magenta: "#c49af0",
  cyan: "#6fcfd8",
  white: "#d9e6f5",
  brightBlack: "#5e6873",
  brightRed: "#ff7a83",
  brightGreen: "#8ee8b2",
  brightYellow: "#ffd98a",
  brightBlue: "#a5cbf7",
  brightMagenta: "#ddc2fa",
  brightCyan: "#9ee5ea",
  brightWhite: "#ffffff",
};

const LIGHT: ITheme = {
  background: "#fbfaf7",
  foreground: "#1b1f1b",
  cursor: "#d92d42",
  cursorAccent: "#fbfaf7",
  selectionBackground: "rgba(217, 45, 66, 0.20)",
  selectionInactiveBackground: "rgba(18, 21, 18, 0.10)",
  black: "#1b1f1b",
  red: "#c4283a",
  green: "#13774b",
  yellow: "#8a5a00",
  blue: "#1d5fa8",
  magenta: "#8a3fb5",
  cyan: "#0b7280",
  white: "#b7bcb3",
  brightBlack: "#5d645c",
  brightRed: "#dd3a4c",
  brightGreen: "#16905a",
  brightYellow: "#a87000",
  brightBlue: "#2877c9",
  brightMagenta: "#a352d1",
  brightCyan: "#108a99",
  brightWhite: "#e4e1d9",
};

export function terminalTheme(theme: ResolvedTheme): ITheme {
  return theme === "light" ? LIGHT : DARK;
}
