import { beforeEach, describe, expect, it, vi } from "vitest";
import { layoutIcons } from "@/components/desktop/DesktopIcons";
import { cascadeRect, clampRect, MIN_H, MIN_W, modeRect, resizeRect, snapZoneAt } from "@/lib/windowing";
import { sanitize, useDesktop, type DesktopItem } from "@/store/desktop";

const area = { w: 1600, h: 840 };

describe("window geometry", () => {
  it("keeps windows reachable and at least the minimum size", () => {
    const r = clampRect({ x: -5000, y: -40, w: 100, h: 50 }, area);
    expect(r.w).toBe(MIN_W);
    expect(r.h).toBe(MIN_H);
    expect(r.x + r.w).toBeGreaterThanOrEqual(140);
    expect(r.y).toBe(0);
    const far = clampRect({ x: 9000, y: 9000, w: 800, h: 600 }, area);
    expect(far.x).toBeLessThanOrEqual(area.w - 140);
    expect(far.y).toBeLessThanOrEqual(area.h - 40);
  });

  it("derives maximized and snapped rects from the area", () => {
    const r = { x: 100, y: 100, w: 700, h: 500 };
    expect(modeRect("maximized", r, area)).toEqual({ x: 0, y: 0, w: 1600, h: 840 });
    expect(modeRect("left", r, area)).toEqual({ x: 0, y: 0, w: 800, h: 840 });
    expect(modeRect("right", r, area)).toEqual({ x: 800, y: 0, w: 800, h: 840 });
    expect(modeRect("normal", r, area)).toEqual(r);
  });

  it("snaps near the edges only", () => {
    expect(snapZoneAt(800, 2, area)).toBe("maximized");
    expect(snapZoneAt(3, 400, area)).toBe("left");
    expect(snapZoneAt(1597, 400, area)).toBe("right");
    expect(snapZoneAt(800, 400, area)).toBeNull();
  });

  it("resizes from any edge without going below the minimum", () => {
    const start = { x: 200, y: 200, w: 600, h: 400 };
    expect(resizeRect(start, "se", 50, 30)).toEqual({ x: 200, y: 200, w: 650, h: 430 });
    const nw = resizeRect(start, "nw", 50, 40);
    expect(nw).toEqual({ x: 250, y: 240, w: 550, h: 360 });
    const tiny = resizeRect(start, "w", 5000, 0);
    expect(tiny.w).toBe(MIN_W);
    expect(tiny.x + tiny.w).toBe(start.x + start.w);
  });

  it("cascades new windows inside the area", () => {
    for (let i = 0; i < 12; i++) {
      const r = cascadeRect({ w: 1000, h: 640 }, area, i);
      expect(r.x).toBeGreaterThanOrEqual(-860);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y + 40).toBeLessThanOrEqual(area.h);
    }
  });
});

describe("desktop store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useDesktop.setState({ windows: [], focusedId: null, zTop: 10, peeked: [], area, rects: {}, overlay: null });
  });

  it("opens one window per singleton app and focuses it again", () => {
    const d = useDesktop.getState();
    const a = d.openApp("studio");
    const b = useDesktop.getState().openApp("studio");
    expect(a).toBe(b);
    expect(useDesktop.getState().windows).toHaveLength(1);
    const f1 = useDesktop.getState().openApp("files");
    const f2 = useDesktop.getState().openApp("files", { newWindow: true });
    expect(f1).not.toBe(f2);
    expect(useDesktop.getState().focusedId).toBe(f2);
  });

  it("minimizes, restores and moves focus to the next window", () => {
    const s = useDesktop.getState();
    const a = s.openApp("terminal");
    const b = useDesktop.getState().openApp("agent");
    useDesktop.getState().minimize(b);
    expect(useDesktop.getState().focusedId).toBe(a);
    useDesktop.getState().toggleMinimize(b);
    expect(useDesktop.getState().windows.find((w) => w.id === b)?.minimized).toBe(false);
    expect(useDesktop.getState().focusedId).toBe(b);
  });

  it("closes with an animation, then removes the window and remembers its size", () => {
    const id = useDesktop.getState().openApp("guide");
    useDesktop.getState().commitRect(id, { x: 10, y: 20, w: 900, h: 600 });
    useDesktop.getState().close(id);
    expect(useDesktop.getState().windows[0]?.phase).toBe("closing");
    vi.runAllTimers();
    expect(useDesktop.getState().windows).toHaveLength(0);
    expect(useDesktop.getState().rects.guide).toEqual({ x: 10, y: 20, w: 900, h: 600 });
  });

  it("show desktop hides every window and the second press brings them back", () => {
    const a = useDesktop.getState().openApp("terminal");
    const b = useDesktop.getState().openApp("agent");
    useDesktop.getState().showDesktop();
    expect(useDesktop.getState().windows.every((w) => w.minimized)).toBe(true);
    useDesktop.getState().showDesktop();
    expect(useDesktop.getState().windows.filter((w) => !w.minimized).map((w) => w.id).sort()).toEqual([a, b].sort());
  });

  it("delivers new arguments to an open singleton window", () => {
    const id = useDesktop.getState().openApp("guide", { args: { section: "c" } });
    const n1 = useDesktop.getState().windows[0]!.args.nonce;
    useDesktop.getState().openApp("guide", { args: { section: "python" } });
    const w = useDesktop.getState().windows.find((x) => x.id === id)!;
    expect(w.args.section).toBe("python");
    expect(w.args.nonce).not.toBe(n1);
  });

  it("sanitizes a damaged saved layout", () => {
    const out = sanitize({
      wallpaper: "nope",
      shellMode: "workspace",
      items: [{ id: "a", kind: "app", app: "files" }, { id: "b", kind: "app", app: "virus" }, { kind: "app" }],
      icons: { a: { col: 1, row: 2 }, b: { col: -1, row: 0 } },
      pinned: [{ kind: "winapp", name: "Chrome", path: "C:\\x.lnk" }, { kind: "app", app: 3 }],
      rects: { files: { x: 1, y: 2, w: 3, h: 4 }, bad: { x: 1 } },
    });
    expect(out.wallpaper).toBeUndefined();
    expect(out.shellMode).toBe("workspace");
    expect(out.items).toEqual([{ id: "a", kind: "app", app: "files" }]);
    expect(out.icons).toEqual({ a: { col: 1, row: 2 } });
    expect(out.pinned).toHaveLength(1);
    expect(Object.keys(out.rects!)).toEqual(["files"]);
  });

  it("keeps the look settings only when they are valid", () => {
    expect(sanitize({ wallpaper: "signature", iconStyle: "color", showClock: false })).toMatchObject({
      wallpaper: "signature",
      iconStyle: "color",
      showClock: false,
    });
    const bad = sanitize({ iconStyle: "neon", showClock: "yes" });
    expect(bad.iconStyle).toBeUndefined();
    expect(bad.showClock).toBeUndefined();
  });
});

describe("desktop icon layout", () => {
  const items: DesktopItem[] = ["a", "b", "c", "d"].map((id) => ({ id, kind: "app", app: "files" }));

  it("keeps saved positions and fills the rest column by column", () => {
    const pos = layoutIcons(items, { c: { col: 0, row: 0 } }, 2);
    expect(pos.get("c")).toEqual({ col: 0, row: 0 });
    expect(pos.get("a")).toEqual({ col: 0, row: 1 });
    expect(pos.get("b")).toEqual({ col: 1, row: 0 });
    expect(pos.get("d")).toEqual({ col: 1, row: 1 });
  });

  it("ignores saved cells that no longer fit or collide", () => {
    const pos = layoutIcons(items, { a: { col: 0, row: 9 }, b: { col: 0, row: 0 }, c: { col: 0, row: 0 } }, 3);
    const cells = [...pos.values()].map((p) => `${p.col}:${p.row}`);
    expect(new Set(cells).size).toBe(4);
    expect(pos.get("b")).toEqual({ col: 0, row: 0 });
  });
});
