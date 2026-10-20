// Real Windows icons of programs, shortcuts and files, asked from the backend
// in small batches the first time an icon is on screen, then kept for the
// session. `undefined` while loading, `null` when Windows has no icon for it.

import { useCallback, useSyncExternalStore } from "react";
import { ipc } from "@/lib/ipc";

const BATCH = 48;

const icons = new Map<string, string | null>();
const listeners = new Map<string, Set<() => void>>();
const queued = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | undefined;

function settle(key: string, url: string | null) {
  icons.set(key, url);
  for (const notify of listeners.get(key) ?? []) notify();
}

function flush() {
  timer = undefined;
  const batch = [...queued].slice(0, BATCH);
  for (const [key] of batch) queued.delete(key);
  if (queued.size > 0) timer = setTimeout(flush, 0);
  ipc.desktopIcons(batch.map(([, path]) => path)).then(
    (urls) => batch.forEach(([key], i) => settle(key, urls[i] ?? null)),
    () => batch.forEach(([key]) => settle(key, null)),
  );
}

function request(path: string) {
  const key = path.toLowerCase();
  if (icons.has(key) || queued.has(key)) return;
  queued.set(key, path);
  // Collect every icon that mounts in the same frame into one call.
  timer ??= setTimeout(flush, 16);
}

/** The icon for `path`; nothing is fetched until `enabled` (e.g. on screen). */
export function useWinIcon(path: string, enabled = true): string | null | undefined {
  const key = path.toLowerCase();
  const subscribe = useCallback(
    (notify: () => void) => {
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(notify);
      if (enabled) request(path);
      return () => {
        set.delete(notify);
        if (set.size === 0) listeners.delete(key);
      };
    },
    [key, path, enabled],
  );
  return useSyncExternalStore(subscribe, () => icons.get(key));
}

/** Windows paths whose own icon should be shown as is. */
export function hasOwnIcon(path: string): boolean {
  return /\.(exe|lnk|url|appref-ms|ico|msi)$/i.test(path);
}
