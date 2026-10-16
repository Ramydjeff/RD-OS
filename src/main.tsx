// Application entry point.

import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppShell } from "@/components/layout/AppShell";
import { shutdownTerminals } from "@/features/terminalActions";
import "@/styles/index.css";
import { useSettings } from "@/store/settings";
import { resolveTheme, useTheme } from "@/store/theme";
import { useWsl } from "@/store/wsl";
import { startWorkspacePersistence, takeLastProject, useWorkspace } from "@/store/workspace";

function App() {
  const loaded = useWorkspace((s) => s.loaded);

  useEffect(() => {
    async function boot() {
      // Load settings first so the theme and terminal options are ready.
      const settingsStore = useSettings.getState();
      await settingsStore.load();
      const { settings } = settingsStore;

      // Apply theme immediately to avoid a flash.
      useTheme.getState().setSetting(settings.theme);
      document.documentElement.dataset.theme = resolveTheme(settings.theme);

      // Load workspace state (layout, recents, last project).
      const wsStore = useWorkspace.getState();
      await wsStore.load();

      // Kick off WSL detection in the background so the UI reacts as soon as it's ready.
      void useWsl.getState().refresh();

      // Restore startup behaviour.
      const startup = settings.startup;
      if (startup === "restore_project") {
        const last = takeLastProject();
        if (last) wsStore.openProject(last);
      } else if (startup === "open_terminal") {
        const { openTerminal } = await import("@/features/terminalActions");
        void openTerminal();
      }

      // Begin persisting layout changes.
      startWorkspacePersistence();
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
            title: "Close rAImy Solutions?",
            message: "There are running terminal sessions. They will all be stopped.",
            confirmLabel: "Close anyway",
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

  if (!loaded) {
    // Render nothing while stores initialise — avoids a flash of default state.
    return null;
  }

  return <AppShell />;
}

const root = document.getElementById("root")!;
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
