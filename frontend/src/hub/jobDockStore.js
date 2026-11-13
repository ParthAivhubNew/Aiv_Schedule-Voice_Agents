import { useSyncExternalStore } from "react";

// What the bulk-check dock has to say, shared with the bell: the bell shows the line and the number waiting on you,
// and opens the dock's panel. The dock writes here; nothing is stored beyond this page.
let state = { line: "", count: 0, open: false };
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
const same = (a, b) => a.line === b.line && a.count === b.count && a.open === b.open;

export function setDock(patch) {
  const next = { ...state, ...patch };
  if (same(state, next)) return;
  state = next;
  emit();
}
export const openDock = () => setDock({ open: true });
export const closeDock = () => setDock({ open: false });
// Back to the bell's notification list: close the check and ask the bell to open.
export const backToNotifications = () => { closeDock(); window.dispatchEvent(new CustomEvent("aivhub:open-bell")); };
export const useDock = () => useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state, () => state);
