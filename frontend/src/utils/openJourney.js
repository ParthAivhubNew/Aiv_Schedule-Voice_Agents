// "Open this journey" (or the Journeys page, with no id) from any screen: the Leads app switches to Journeys.
export const OPEN_JOURNEY_EVENT = "aivhub:open-journey";

export function openJourney(id = "") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_JOURNEY_EVENT, { detail: String(id || "") }));
}
