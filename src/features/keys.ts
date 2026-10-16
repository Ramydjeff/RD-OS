import { runAction } from "@/features/actions";
import { matchAction, resolveBindings } from "@/lib/shortcuts";
import { useSettings } from "@/store/settings";

function modalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

/**
 * Dispatches a key event to the app action bound to it, if any.
 * Returns true when the event was consumed.
 */
export function runKeyEvent(e: KeyboardEvent, inTerminal: boolean): boolean {
  if (e.type !== "keydown" || e.isComposing) return false;
  const bindings = resolveBindings(useSettings.getState().settings.shortcuts);
  const match = matchAction(e, bindings, inTerminal);
  if (!match) return false;
  // While a dialog is open only the palette toggle stays live.
  if (modalOpen() && match.actionId !== "palette.open") return false;
  e.preventDefault();
  e.stopPropagation();
  runAction(match.actionId);
  return true;
}

/** True when the key event originates inside a terminal. */
export function eventInTerminal(e: Event): boolean {
  const t = e.target;
  return t instanceof Element && t.closest("[data-terminal-id]") !== null;
}
