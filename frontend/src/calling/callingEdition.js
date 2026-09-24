export const CALLING_EDITION_KEY = "aivhub_calling_edition";
export const CALLING_EDITION_EVENT = "aivhub-calling-edition";

export function getCallingEdition() {
  try {
    const hash = String(window.location.hash || "");
    const qIdx = hash.indexOf("?");
    if (qIdx >= 0) {
      const p = new URLSearchParams(hash.slice(qIdx + 1));
      const fromHash = String(p.get("edition") || "").toLowerCase();
      if (fromHash === "classic" || fromHash === "simple") {
        try {
          localStorage.setItem(CALLING_EDITION_KEY, fromHash);
        } catch (_) {}
        return fromHash;
      }
    }
  } catch (_) {}
  try {
    const v = String(localStorage.getItem(CALLING_EDITION_KEY) || "").toLowerCase();
    if (v === "classic" || v === "simple") return v;
  } catch (_) {}
  return "simple";
}

export function setCallingEdition(edition) {
  const v = edition === "classic" ? "classic" : "simple";
  try {
    localStorage.setItem(CALLING_EDITION_KEY, v);
  } catch (_) {}
  try {
    window.dispatchEvent(new Event(CALLING_EDITION_EVENT));
  } catch (_) {}
  return v;
}

export function isClassicCallingPhrase(text) {
  const t = String(text || "").toLowerCase();
  return (
    /\bmake it like (the )?old one\b/.test(t) ||
    /\buse (the )?classic( calling| voice)?\b/.test(t) ||
    /\brevert to (classic|old)\b/.test(t) ||
    /\bold (calling|voice)\b/.test(t)
  );
}

export function isSimpleCallingPhrase(text) {
  const t = String(text || "").toLowerCase();
  return /\bmake it simple\b/.test(t) || /\buse (the )?new calling\b/.test(t);
}
