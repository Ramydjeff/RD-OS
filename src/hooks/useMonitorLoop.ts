// Polls the monitor store on a regular interval.
// Call once at application startup.

import { useEffect } from "react";
import { useMonitor } from "@/store/monitor";
import { useSettings } from "@/store/settings";
import { useWorkspace } from "@/store/workspace";

export function useMonitorLoop() {
  const enabled = useSettings((s) => s.settings.monitor.enabled);
  const intervalSecs = useSettings((s) => s.settings.monitor.intervalSecs);
  const selectedDistro = useWorkspace((s) => s.selectedDistro);

  useEffect(() => {
    if (!enabled) return;

    const { refreshHost, refreshWsl, refreshSessions } = useMonitor.getState();

    // Kick off immediately, then repeat.
    void refreshHost();
    void refreshWsl(selectedDistro);
    void refreshSessions();

    const ms = intervalSecs * 1000;
    const id = setInterval(() => {
      void refreshHost();
      void refreshWsl(useWorkspace.getState().selectedDistro);
      void refreshSessions();
    }, ms);

    return () => clearInterval(id);
  }, [enabled, intervalSecs, selectedDistro]);
}
