import { useSyncExternalStore } from "react";

// Opens the Workflows page from anywhere (the hub, a plugin's sidebar, the assistant). The page is one screen for the whole company, so nothing
// is kept per plugin; `from` only says which plugin the person came from, so the page starts on that plugin's events.
export const OPEN_EVENT = "aivhub:open-workflows";

export function openWorkflows(context = {}) {
  try {
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: context }));
  } catch (_) {
    // a browser without custom events just does not open it
  }
}

// Whether the page is open, so a plugin's sidebar can highlight Workflows instead of the screen underneath it.
let isOpen = false;
const listeners = new Set();
export function setWorkflowsOpen(on) {
  if (isOpen === on) return;
  isOpen = on;
  listeners.forEach((fn) => fn());
}
export const subscribeWorkflowsOpen = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const workflowsOpenNow = () => isOpen;

// For an app's top bar: while the page is open the bar says "Workflows", the same as it names every other page.
export const WORKFLOWS_HEADER = ["Workflows", "When something happens in Leads, Voice or Social, do something automatically."];
export const useWorkflowsOpen = () => useSyncExternalStore(subscribeWorkflowsOpen, workflowsOpenNow, () => false);
