// One short line telling the person an action worked or failed. Any screen can call it; the app shell that is open shows it
// (Leads shows it in its toast). Nothing is shown where no shell listens, so shared parts can call it safely.
export const NOTICE_EVENT = "aivhub:notice";

export function notice(message) {
  const text = String(message || "").trim();
  if (!text || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: text }));
}
