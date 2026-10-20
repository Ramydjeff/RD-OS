// rAImy OS iconography: one tone family and a set of glyphs drawn for the OS.
//
// Glyphs sit on a 24-unit grid and are duotone: the main shape in the tile's
// colour, a secondary shape (`g2`) at reduced opacity, and on the terminal a
// cursor in the brand's signal red (`g-accent`). The tile itself (AppIcon)
// supplies the colour, so the same glyph works on obsidian and colour tiles.

import type { ReactElement } from "react";

export interface Tone {
  /** Glyph colour on obsidian tiles. */
  hue: string;
  /** Deep shade used for the inner glow. */
  deep: string;
  /** Two stops of the full-colour tile. */
  tile: [string, string];
  /** Keeps a light glyph on a dark tile in the colour style (Terminal). */
  dark?: boolean;
}

export const TONES = {
  amber: { hue: "#ffc35a", deep: "#c26a10", tile: ["#ffcb66", "#e0742a"] },
  violet: { hue: "#b49dff", deep: "#5a3ee0", tile: ["#a08cff", "#6234e0"] },
  frost: { hue: "#e3ebf3", deep: "#55606b", tile: ["#343c34", "#0c0f0c"], dark: true },
  coral: { hue: "#ff5d6e", deep: "#b0263a", tile: ["#ff6877", "#b02d38"] },
  teal: { hue: "#46e0cc", deep: "#0b7c7a", tile: ["#3fd8c4", "#0b6b78"] },
  sky: { hue: "#74beff", deep: "#1d5bd6", tile: ["#6cb8ff", "#2552d6"] },
  mint: { hue: "#55e897", deep: "#0e8a4e", tile: ["#4fe08f", "#0c7a46"] },
  ember: { hue: "#ff8d50", deep: "#c2410c", tile: ["#ff9257", "#c23a14"] },
  cyan: { hue: "#5cdcf2", deep: "#0b7ea6", tile: ["#4fd6f0", "#3f5ae6"] },
  mist: { hue: "#c6cfd9", deep: "#4b5663", tile: ["#a4afbc", "#47525e"] },
} satisfies Record<string, Tone>;

export type ToneId = keyof typeof TONES;
export const TONE_IDS = Object.keys(TONES) as ToneId[];

export type Glyph = () => ReactElement;

const stroke = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Window body shared by Code Studio and Terminal. */
const Pane = () => <rect className="g2" x="2.5" y="3.5" width="19" height="17" rx="4.2" />;

export const GLYPHS = {
  folder: () => (
    <>
      <path className="g2" d="M3 8.6V6.7A2.7 2.7 0 0 1 5.7 4h3.2c.8 0 1.4.3 1.9.9L12 6.3h6.3A2.7 2.7 0 0 1 21 9v1.4H3z" />
      <path d="M2.3 12.1a2 2 0 0 1 2-2.3h15.4a2 2 0 0 1 2 2.3l-.95 6.1A2.7 2.7 0 0 1 18.1 20.5H5.9a2.7 2.7 0 0 1-2.65-2.3z" />
      <path {...stroke} strokeWidth="1.3" opacity=".35" stroke="#000" d="M6.2 16.9h4.6" />
    </>
  ),
  code: () => (
    <>
      <Pane />
      <g {...stroke} strokeWidth="2.1">
        <path d="M8.7 9.1 5.9 12l2.8 2.9" />
        <path d="M15.3 9.1 18.1 12l-2.8 2.9" />
        <path d="M13.2 8 10.8 16" />
      </g>
    </>
  ),
  terminal: () => (
    <>
      <Pane />
      <path {...stroke} strokeWidth="2.25" d="m6.6 8.8 3.2 3.2-3.2 3.2" />
      <rect className="g-accent g-blink" x="11.8" y="13.9" width="5.8" height="2.3" rx="1.15" />
    </>
  ),
  /** The lens ring of the rAImy mark, opened by a spark. */
  spark: () => (
    <>
      <path className="g2" {...stroke} strokeWidth="1.8" d="M20.3 9.8A8.6 8.6 0 1 1 14.2 3.7" />
      <path d="M12 6.2c.55 3 2.8 5.25 5.8 5.8-3 .55-5.25 2.8-5.8 5.8-.55-3-2.8-5.25-5.8-5.8 3-.55 5.25-2.8 5.8-5.8z" />
      <path d="M18.4 2.9c.25 1.2 1.1 2.05 2.3 2.3-1.2.25-2.05 1.1-2.3 2.3-.25-1.2-1.1-2.05-2.3-2.3 1.2-.25 2.05-1.1 2.3-2.3z" />
    </>
  ),
  academy: () => (
    <>
      <path className="g2" d="M6.2 11.6v4.1c0 1.9 2.6 3.6 5.8 3.6s5.8-1.7 5.8-3.6v-4.1L12 14.3z" />
      <path d="M11.1 4.3a2.1 2.1 0 0 1 1.8 0l8.2 3.85c.8.38.8 1.52 0 1.9l-8.2 3.85a2.1 2.1 0 0 1-1.8 0L2.9 10.05c-.8-.38-.8-1.52 0-1.9z" />
      <path {...stroke} strokeWidth="1.7" d="M20.1 9.6v5" />
      <circle cx="20.1" cy="15.7" r="1.3" />
    </>
  ),
  grid: () => (
    <>
      <rect x="3" y="3" width="8" height="8" rx="2.4" />
      <rect x="14.2" y="4.2" width="5.6" height="5.6" rx="1.5" transform="rotate(45 17 7)" />
      <rect className="g2" x="3" y="13" width="8" height="8" rx="2.4" />
      <rect className="g2" x="13" y="13" width="8" height="8" rx="2.4" />
    </>
  ),
  gauge: () => (
    <>
      <path className="g2" {...stroke} strokeWidth="2.4" d="M4 16a8 8 0 0 1 16 0" />
      <path {...stroke} strokeWidth="2.4" d="M4 16a8 8 0 0 1 12.6-6.55" />
      <path {...stroke} strokeWidth="2.1" d="M12 16 15.3 11.4" />
      <circle cx="12" cy="16" r="2.3" />
      <path className="g2" {...stroke} strokeWidth="1.8" d="M7.5 20.2h9" />
    </>
  ),
  /** A distribution as an isometric cube. */
  cube: () => (
    <g strokeLinejoin="round" strokeWidth="1.4" stroke="currentColor">
      <path d="M12 2.7 20 7.1 12 11.5 4 7.1z" />
      <path opacity=".62" d="M3.6 8.8 11.2 13v8.3L3.6 17.1z" />
      <path opacity=".34" d="M12.8 13 20.4 8.8v8.3l-7.6 4.2z" />
    </g>
  ),
  /** fork(): a parent and its two children. */
  fork: () => (
    <>
      <path className="g2" {...stroke} strokeWidth="2" d="M12 8v2.7c0 2.3-6 2-6 4.8M12 10.7c0 2.3 6 2 6 4.8" />
      <circle cx="12" cy="5.4" r="2.8" />
      <circle cx="6" cy="18.4" r="2.8" />
      <circle cx="18" cy="18.4" r="2.8" />
    </>
  ),
  sliders: () => (
    <>
      <path className="g2" {...stroke} strokeWidth="2" d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="15.2" cy="7" r="2.7" />
      <circle cx="8.4" cy="12" r="2.7" />
      <circle cx="13.4" cy="17" r="2.7" />
    </>
  ),
} satisfies Record<string, Glyph>;

export type GlyphId = keyof typeof GLYPHS;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A stable tone for a name (Windows programs, projects). */
export function toneFor(name: string): ToneId {
  const pool = TONE_IDS.filter((t) => t !== "frost");
  return pool[hash(name.toLowerCase()) % pool.length]!;
}
