// Pure helpers for the AI-call permission screen.

export const METHOD_OPTIONS = [
  ["verbal_recorded", "They said yes on a recorded call"],
  ["web_form", "They ticked a box on a web form"],
  ["written", "They agreed in writing"],
  ["email", "They agreed by email"],
];

/** The pill under a number: what is known about its TPS screening. */
export function screeningPill(screening) {
  const s = screening || {};
  if (s.tps_status === "listed" || s.ctps) return { tone: "red", text: "On the TPS list" };
  if (s.tps_status === "clear" && s.fresh) return { tone: "green", text: "Clear on TPS" };
  return { tone: "amber", text: "Not screened: check TPS first" };
}

/** What is still missing before a permission can be saved, in words. */
export function permissionMissing(f) {
  if (String(f.number || "").replace(/\D/g, "").length < 8) return "Give the phone number in full.";
  if (!String(f.company || "").trim()) return "Say which company the person agreed to hear from.";
  if (!f.confirmed) return "Tick the box to confirm this is true.";
  return "";
}
