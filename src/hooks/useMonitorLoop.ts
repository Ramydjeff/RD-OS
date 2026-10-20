// Polls the monitor store on a regular interval. Call useMonitorLoop once at
// startup.
//
// Host numbers are cheap (this process only). Linux numbers cost two wsl.exe
// launches, so they are sampled only while a view that shows them is mounted
// (useWslMetrics), and nothing is sampled while the window is hidden.

import { useEffect } from "react";
import { useMonitor } from "@/store/monitor";
import { useSettings } from "@/store/settings";
import { useWorkspace } from "@/store/workspace";
import { chooseDistro, useWsl } from "@/store/wsl";

let wslWatchers = 0;

const currentDistro = () => chooseDistro(useWsl.getState().status);

/** Declares that the calling view shows Linux metrics (sampled while it is mounted). */
export function useWslMetrics() {
  const selectedDistro = useWorkspace((s) => s.selectedDistro);
  const wslReady = useWsl((s) => s.status !== null);
  useEffect(() => {
    wslWatchers++;
    if (wslReady) void useMonitor.getState().refreshWsl(currentDistro());
    return () => {
      wslWatchers--;
    };
  }, [selectedDistro, wslReady]);
}

export function useMonitorLoop() {
  const enabled = useSettings((s) => s.settings.monitor.enabled);
  const intervalSecs = useSettings((s) => s.settings.monitor.intervalSecs);

  useEffect(() => {
    if (!enabled) return;
    const { refreshHost, refreshWsl, refreshSessions } = useMonitor.getState();

    const tick = () => {
      if (document.visibilityState === "hidden") return;
      void refreshHost();
      void refreshSessions();
      if (wslWatchers > 0 && useWsl.getState().status) void refreshWsl(currentDistro());
    };

    tick();
    const id = setInterval(tick, intervalSecs * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, intervalSecs]);
}
