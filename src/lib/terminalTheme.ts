import type { ITheme } from "@xterm/xterm";

export type ResolvedTheme = "dark" | "light";

const DARK: ITheme = {
  background: "#0C0E0B",
  foreground: "#F0F4F8",
  cursor: "#D6303A",
  cursorAccent: "#0C0E0B",
  selectionBackground: "rgba(214, 48, 58, 0.32)",
  selectionInactiveBackground: "rgba(214, 231, 243, 0.15)",
  black: "#141815",
  red: "#D6303A",
  green: "#4ADE80",
  yellow: "#FBBF24",
  blue: "#7EB6E8",
  magenta: "#C084FC",
  cyan: "#D6E7F3",
  white: "#F0F4F8",
  brightBlack: "#52605B",
  brightRed: "#FF525D",
  brightGreen: "#86EFAC",
  brightYellow: "#FDE047",
  brightBlue: "#A3D3FA",
  brightMagenta: "#E9D5FF",
  brightCyan: "#E8F3FA",
  brightWhite: "#FFFFFF",
};

const LIGHT: ITheme = {
  background: "#ffffff",
  foreground: "#14171c",
  cursor: "#0b8a63",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(11, 138, 99, 0.22)",
  selectionInactiveBackground: "rgba(86, 96, 112, 0.2)",
  black: "#14171c",
  red: "#c93636",
  green: "#0b7a57",
  yellow: "#8a5a00",
  blue: "#1a5fa6",
  magenta: "#8a3fb5",
  cyan: "#0b7f8e",
  white: "#b9c0cc",
  brightBlack: "#566070",
  brightRed: "#e04b4b",
  brightGreen: "#0f9a6c",
  brightYellow: "#a87000",
  brightBlue: "#2877c9",
  brightMagenta: "#a352d1",
  brightCyan: "#1296a8",
  brightWhite: "#e4e8ee",
};

export function terminalTheme(theme: ResolvedTheme): ITheme {
  return theme === "light" ? LIGHT : DARK;
}
