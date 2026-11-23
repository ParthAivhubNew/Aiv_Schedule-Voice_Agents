import { openSupportWidget } from "./supportWidget";

// Support is the AIV Support widget only. When it is not ready the person is told, instead of nothing happening.
export const SUPPORT_UNAVAILABLE_EVENT = "aivhub:support-unavailable";
export const SUPPORT_UNAVAILABLE_LINE = "Support isn't available right now. Try again in a moment, or email support@aivhub.com.";

export function openSupport() {
  if (openSupportWidget()) return;
  try {
    window.dispatchEvent(new CustomEvent(SUPPORT_UNAVAILABLE_EVENT));
  } catch (_) {
    // a browser without custom events shows nothing
  }
}
