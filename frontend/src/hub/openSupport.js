import { useSyncExternalStore } from "react";

// Opens the Support panel from anywhere (the hub, a plugin's sidebar, the assistant).
// `plugin` says which app the person is in; `screen` says which page they were on.
export const OPEN_EVENT = "aivhub:open-support";

export function openSupport(context = {}) {
  try {
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: context }));
  } catch (_) {
    // a browser without custom events just does not open it
  }
}

let isOpen = false;
const listeners = new Set();
export function setSupportOpen(on) {
  if (isOpen === on) return;
  isOpen = on;
  listeners.forEach((fn) => fn());
}
export const subscribeSupportOpen = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const supportOpenNow = () => isOpen;
export const useSupportOpen = () => useSyncExternalStore(subscribeSupportOpen, supportOpenNow, () => false);
