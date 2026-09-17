export const EDITION_KEY = "aivhub_scheduler_edition";
export const EDITION_EVENT = "aivhub-scheduler-edition";

export function getSchedulerEdition() {
  try {
    const hash = String(window.location.hash || "");
    const qIdx = hash.indexOf("?");
    if (qIdx >= 0) {
      const p = new URLSearchParams(hash.slice(qIdx + 1));
      const fromHash = String(p.get("edition") || "").toLowerCase();
      if (fromHash === "classic" || fromHash === "simple") {
        try {
          localStorage.setItem(EDITION_KEY, fromHash);
        } catch (_) {}
        return fromHash;
      }
    }
  } catch (_) {}
  try {
    const v = String(localStorage.getItem(EDITION_KEY) || "").toLowerCase();
    if (v === "classic" || v === "simple") return v;
  } catch (_) {}
  return "simple";
}

export function setSchedulerEdition(edition) {
  const v = edition === "classic" ? "classic" : "simple";
  try {
    localStorage.setItem(EDITION_KEY, v);
  } catch (_) {}
  try {
    window.dispatchEvent(new Event(EDITION_EVENT));
  } catch (_) {}
  return v;
}

export function isClassicRevertPhrase(text) {
  const t = String(text || "").toLowerCase();
  return (
    /\bmake it like (the )?old one\b/.test(t) ||
    /\buse (the )?classic( scheduler)?\b/.test(t) ||
    /\brevert to (classic|old)\b/.test(t) ||
    /\bold scheduler\b/.test(t)
  );
}

export function isSimpleRestorePhrase(text) {
  const t = String(text || "").toLowerCase();
  return /\bmake it simple\b/.test(t) || /\buse (the )?new scheduler\b/.test(t);
}
