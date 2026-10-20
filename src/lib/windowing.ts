// Window geometry for the rAImy OS desktop. Pure functions, so the window
// manager's rules (clamping, snapping, cascading) are easy to test.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The part of the screen windows may use (everything above the taskbar). */
export interface Area {
  w: number;
  h: number;
}

/** "normal" uses the window's own rect; the others are derived from the area. */
export type WinMode = "normal" | "maximized" | "left" | "right";

export const MIN_W = 380;
export const MIN_H = 260;
/** How much of a window must stay reachable when it is dragged off screen. */
const KEEP_VISIBLE = 140;
const TITLE_H = 40;
const CASCADE = 30;

export function clampRect(r: Rect, area: Area): Rect {
  const w = Math.round(Math.min(Math.max(r.w, MIN_W), Math.max(MIN_W, area.w)));
  const h = Math.round(Math.min(Math.max(r.h, MIN_H), Math.max(MIN_H, area.h)));
  const x = Math.round(Math.min(Math.max(r.x, KEEP_VISIBLE - w), area.w - KEEP_VISIBLE));
  const y = Math.round(Math.min(Math.max(r.y, 0), Math.max(0, area.h - TITLE_H)));
  return { x, y, w, h };
}

/** A new window of `size`, centred and shifted by `index` steps so stacks stay readable. */
export function cascadeRect(size: { w: number; h: number }, area: Area, index: number): Rect {
  const w = Math.min(size.w, area.w - 24);
  const h = Math.min(size.h, area.h - 24);
  const step = index % 8;
  return clampRect(
    {
      x: (area.w - w) / 2 + (step - 2) * CASCADE,
      y: Math.max(12, (area.h - h) / 2 - 20) + (step - 2) * CASCADE * 0.6,
      w,
      h,
    },
    area,
  );
}

/** The rectangle a window occupies on screen in a given mode. */
export function modeRect(mode: WinMode, rect: Rect, area: Area): Rect {
  const half = Math.round(area.w / 2);
  switch (mode) {
    case "maximized":
      return { x: 0, y: 0, w: area.w, h: area.h };
    case "left":
      return { x: 0, y: 0, w: half, h: area.h };
    case "right":
      return { x: half, y: 0, w: area.w - half, h: area.h };
    default:
      return clampRect(rect, area);
  }
}

/** Snap target while dragging a window with the pointer at (px, py). */
export function snapZoneAt(px: number, py: number, area: Area): Exclude<WinMode, "normal"> | null {
  if (py <= 4) return "maximized";
  if (px <= 6) return "left";
  if (px >= area.w - 6) return "right";
  return null;
}

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** New rect after dragging `edge` by (dx, dy), never smaller than the minimum size. */
export function resizeRect(start: Rect, edge: ResizeEdge, dx: number, dy: number): Rect {
  let { x, y, w, h } = start;
  if (edge.includes("e")) w = Math.max(MIN_W, start.w + dx);
  if (edge.includes("s")) h = Math.max(MIN_H, start.h + dy);
  if (edge.includes("w")) {
    w = Math.max(MIN_W, start.w - dx);
    x = start.x + start.w - w;
  }
  if (edge.includes("n")) {
    h = Math.max(MIN_H, start.h - dy);
    y = Math.max(0, start.y + start.h - h);
    h = start.y + start.h - y;
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}
