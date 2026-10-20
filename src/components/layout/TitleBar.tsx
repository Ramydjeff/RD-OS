import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LayoutGrid, Minus, Search, Square, X } from "lucide-react";
import { RaimyIcon, RaimyWordmark } from "@/components/ui/RaimyLogo";
import { formatShortcut, resolveBindings } from "@/lib/shortcuts";
import { locationName } from "@/lib/paths";
import { useDesktop } from "@/store/desktop";
import { useEditor } from "@/store/editor";
import { useSettings } from "@/store/settings";
import { useUi } from "@/store/ui";
import { useWorkspace } from "@/store/workspace";

const VIEW_TITLE = {
  explorer: "Explorateur",
  processes: "Processus",
  environments: "Environnements",
  settings: "Paramètres",
} as const;

async function onWindow(fn: (w: ReturnType<typeof getCurrentWindow>) => Promise<unknown>) {
  try {
    await fn(getCurrentWindow());
  } catch {
    /* not running inside a Tauri window (browser preview) */
  }
}

export function TitleBar() {
  const project = useWorkspace((s) => s.project);
  const activeView = useWorkspace((s) => s.activeView);
  // Select the path only: the file object changes on every keystroke.
  const activeRel = useEditor((s) => (activeView === "explorer" ? s.files.find((f) => f.key === s.activeKey)?.rel : undefined));
  const shortcuts = useSettings((s) => s.settings.shortcuts);
  const paletteKeys = formatShortcut(resolveBindings(shortcuts).get("palette.open") ?? "Ctrl+Shift+P");
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onWindow(async (win) => {
      setIsMaximized(await win.isMaximized());
      unlisten = await win.onResized(async () => setIsMaximized(await win.isMaximized()));
    });
    return () => unlisten?.();
  }, []);

  const context = activeView === "explorer" && project ? locationName(project) : VIEW_TITLE[activeView];

  return (
    <header data-tauri-drag-region className="relative flex h-[38px] w-full shrink-0 items-center border-b border-line bg-surface">
      {/* Brand + where you are */}
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2.5 pl-3.5">
        <RaimyIcon size={17} />
        <RaimyWordmark className="text-[13.5px]" />
        <span aria-hidden className="mx-1 h-4 w-px bg-line-strong" />
        <span data-tauri-drag-region className="truncate text-[12px] text-muted">
          {context}
          {activeRel && <span className="text-faint"> / {activeRel}</span>}
        </span>
      </div>

      {/* Command center */}
      <button
        type="button"
        onClick={() => useUi.getState().setPaletteOpen(true)}
        title={`Palette de commandes (${paletteKeys})`}
        className="group flex h-[26px] w-[min(380px,34vw)] shrink-0 items-center gap-2 rounded-[var(--radius-sm)] border border-line bg-bg/70 px-2.5 text-[12px] text-faint transition-colors hover:border-line-strong hover:text-muted"
      >
        <Search size={13} className="shrink-0" />
        <span className="flex-1 truncate text-left">Rechercher une commande, un fichier…</span>
        <kbd className="shrink-0 font-mono text-[10px] text-faint group-hover:text-muted">{paletteKeys}</kbd>
      </button>

      {/* Desktop shell + window controls */}
      <div data-tauri-drag-region className="flex flex-1 items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => useDesktop.getState().setShellMode("desktop")}
          title="Revenir au bureau rAImy OS"
          className="mr-1 flex h-[26px] items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-[12px] text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <LayoutGrid size={14} /> Bureau
        </button>
        <div className="flex h-[38px] items-stretch">
          <button
            type="button"
            onClick={() => void onWindow((w) => w.minimize())}
            aria-label="Réduire"
            title="Réduire"
            className="flex w-[46px] items-center justify-center text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            <Minus size={14} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            onClick={() => void onWindow(async (w) => {
              await w.toggleMaximize();
              setIsMaximized(await w.isMaximized());
            })}
            aria-label={isMaximized ? "Restaurer" : "Agrandir"}
            title={isMaximized ? "Restaurer" : "Agrandir"}
            className="flex w-[46px] items-center justify-center text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            {isMaximized ? (
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden>
                <rect x="0.55" y="2.55" width="7.9" height="7.9" rx="1" />
                <path d="M2.5 2.5V1.6a1 1 0 0 1 1-1h5.9a1 1 0 0 1 1 1v5.9a1 1 0 0 1-1 1h-.9" />
              </svg>
            ) : (
              <Square size={11} strokeWidth={1.6} />
            )}
          </button>
          <button
            type="button"
            onClick={() => void onWindow((w) => w.close())}
            aria-label="Fermer"
            title="Fermer"
            className="flex w-[46px] items-center justify-center text-muted transition-colors hover:bg-[#c42b1c] hover:text-white"
          >
            <X size={15} strokeWidth={1.6} />
          </button>
        </div>
      </div>
    </header>
  );
}
