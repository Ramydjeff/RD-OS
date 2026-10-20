// Application entry point.

// Self-hosted fonts (bundled, so they work offline and under the production CSP).
import "@fontsource-variable/geist";
import "@fontsource-variable/outfit";
import "@fontsource-variable/jetbrains-mono";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Desktop } from "@/components/desktop/Desktop";
import { AppShell } from "@/components/layout/AppShell";
import { shutdownTerminals } from "@/features/terminalActions";
import "@/styles/index.css";
import { startDesktopPersistence, useDesktop } from "@/store/desktop";
import { useSettings } from "@/store/settings";
import { resolveTheme, useTheme } from "@/store/theme";
import { useWsl } from "@/store/wsl";
import { startWorkspacePersistence, takeLastProject, useWorkspace } from "@/store/workspace";

function App() {
  const loaded = useWorkspace((s) => s.loaded);
  const desktopLoaded = useDesktop((s) => s.loaded);
  const shellMode = useDesktop((s) => s.shellMode);

  useEffect(() => {
    async function boot() {
      // Load settings first so the theme and terminal options are ready.
      await useSettings.getState().load();
      // Read the store again: the object taken before `load` still holds the defaults.
      const { settings } = useSettings.getState();

      // Apply theme immediately to avoid a flash.
      useTheme.getState().setSetting(settings.theme);
      document.documentElement.dataset.theme = resolveTheme(settings.theme);

      // Load workspace state (layout, recents, last project) and the desktop layout.
      const wsStore = useWorkspace.getState();
      await Promise.all([wsStore.load(), useDesktop.getState().load()]);
      const onDesktop = useDesktop.getState().shellMode === "desktop";

      // Kick off WSL detection in the background so the UI reacts as soon as it's ready.
      void useWsl.getState().refresh();

      // Restore startup behaviour.
      const startup = settings.startup;
      if (startup === "restore_project") {
        const last = takeLastProject();
        if (last) wsStore.openProject(last);
      } else if (startup === "open_terminal" && !onDesktop) {
        // On the desktop the terminal is an app the user opens; it never pops up uninvited.
        const { openTerminal } = await import("@/features/terminalActions");
        void openTerminal();
      }

      // Begin persisting layout changes.
      startWorkspacePersistence();
      startDesktopPersistence();
    }

    void boot();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Wire the Tauri close-requested event.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    async function setup() {
      const win = getCurrentWindow();
      unlisten = await win.onCloseRequested(async (ev) => {
        const { useTerminals } = await import("@/store/terminals");
        const { useSettings: s } = await import("@/store/settings");
        const { confirmDialog } = await import("@/store/ui");
        const hasSessions = Object.values(useTerminals.getState().meta).some(
          (m) => m.state === "running",
        );
        if (hasSessions && s.getState().settings.confirmations.closeAppWithSessions) {
          ev.preventDefault();
          const ok = await confirmDialog({
            title: "Fermer rAImy Solutions ?",
            message: "Des sessions de terminal sont en cours. Elles seront toutes arrêtées.",
            confirmLabel: "Fermer quand même",
            danger: true,
          });
          if (ok) {
            await shutdownTerminals();
            await win.destroy();
          }
        } else {
          await shutdownTerminals();
        }
      });
    }
    void setup();
    return () => unlisten?.();
  }, []);

  if (!loaded || !desktopLoaded) {
    // Render nothing while stores initialise — avoids a flash of default state.
    return null;
  }

  return shellMode === "desktop" ? <Desktop /> : <AppShell />;
}

const root = document.getElementById("root")!;
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
