// Registers the global keyboard shortcut listener.
// Must be mounted once, at the root level.

import { useEffect } from "react";
import { runAction } from "@/features/actions";
import { resolveBindings, matchAction } from "@/lib/shortcuts";
import { useSettings } from "@/store/settings";
import { activeTerminalId } from "@/store/terminals";

export function useShortcuts() {
  const overrides = useSettings((s) => s.settings.shortcuts);

  useEffect(() => {
    const bindings = resolveBindings(overrides);

    function onKeyDown(e: KeyboardEvent) {
      const inTerminal = !!activeTerminalId();
      const match = matchAction(e, bindings, inTerminal);
      if (!match) return;
      e.preventDefault();
      e.stopPropagation();
      runAction(match.actionId);
    }

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [overrides]);
}
