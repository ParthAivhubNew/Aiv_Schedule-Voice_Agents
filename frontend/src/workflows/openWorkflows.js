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
