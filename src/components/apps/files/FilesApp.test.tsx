import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DirListing, Location } from "@/types/ipc";

// Listings resolve when the test says so, to replay out-of-order answers.
const pending = new Map<string, (l: DirListing) => void>();
const key = (l: Location) => (l.kind === "linux" ? l.path : l.path);

vi.mock("@/lib/ipc", () => ({
  ipc: {
    fsListDir: (loc: Location) => new Promise<DirListing>((resolve) => pending.set(key(loc), resolve)),
    desktopWinApps: async () => [],
    desktopPlaces: async () => ({
      userName: "ramy",
      home: "C:\\Users\\ramy",
      folders: [{ id: "desktop", label: "Bureau Windows", path: "C:\\Users\\ramy\\Desktop" }],
      drives: ["C:\\"],
    }),
    wslDetect: async () => {
      throw new Error("no wsl in tests");
    },
    log: async () => undefined,
  },
  Channel: class {},
}));

const { default: FilesApp } = await import("@/components/apps/files/FilesApp");
const { WindowContext } = await import("@/components/desktop/windowContext");

const listing = (...names: string[]): DirListing => ({
  entries: names.map((name) => ({ name, kind: "file", size: 10, modifiedMs: null, hidden: false, symlink: false })),
  truncated: false,
});

describe("Fichiers", () => {
  it("never shows a folder's files under another folder when listings arrive out of order", async () => {
    const linuxHome: Location = { kind: "linux", distro: "Ubuntu", path: "/home/ramy" };
    const desktop: Location = { kind: "windows", path: "C:\\Users\\ramy\\Desktop" };
    const win = {
      id: "files-1",
      app: "files" as const,
      title: null,
      rect: { x: 0, y: 0, w: 900, h: 600 },
      mode: "normal" as const,
      minimized: false,
      z: 1,
      phase: "open" as const,
      args: { nonce: 1, location: linuxHome },
    };
    const view = render(
      <WindowContext.Provider value={{ win, focused: true, visible: true }}>
        <FilesApp />
      </WindowContext.Provider>,
    );
    await act(async () => {});
    // Navigate to the Windows desktop while the slow Linux listing is still pending.
    await act(async () => {
      screen.getByRole("button", { name: /Bureau Windows/ }).click();
    });
    await act(async () => pending.get("C:\\Users\\ramy\\Desktop")!(listing("notes.txt")));
    await act(async () => pending.get("/home/ramy")!(listing("test2.c")));

    expect(screen.queryByText("test2.c")).toBeNull();
    expect(screen.getByText("notes.txt")).toBeTruthy();
    expect(desktop.path).toContain("Desktop");
    view.unmount();
  });
});
