import { SOURCE_LABELS, hasGoogleData } from "./SourceMark";
import { hasAnyTpsCheck, screeningOfNumber } from "./phoneNumbers";

// Filters shared by Lists (an open list), Saved companies and Saved people: "TPS checked" and "Data from".
// Pure functions, so the screens and the tests use the same rules.

export const TPS_NOTE = "Showing contacts with at least one phone number checked against the TPS and CTPS registers (any number on the record).";

// The sources offered in the "Data from" select, in the order they are listed. "You" (typed by hand) is not offered.
export const SOURCE_KEYS = ["register", "website", "import", "web", "check", "google_places", "apollo"];
const SOURCE_FIELDS = ["phone", "email", "website"];

const baseKey = (raw) => String(raw || "").split(":")[0];

// The sources behind a company's phone, email and website. Google also counts when the server only wrote it in the view-only note.
export function sourceKeysOf(a, fields = SOURCE_FIELDS) {
  const found = new Set();
  const sources = a?.field_sources || {};
  fields.forEach((f) => { const k = baseKey(sources[f]); if (k) found.add(k); });
  if (fields === SOURCE_FIELDS && hasGoogleData(a)) found.add("google_places");
  return found;
}

export const hasSource = (a, key, fields) => sourceKeysOf(a, fields).has(key);

// [{key, label, count}] for each source with at least one row in `rows`; nothing for a source with none.
export function sourceOptions(rows, keyOf = (a) => sourceKeysOf(a)) {
  const counts = {};
  rows.forEach((r) => keyOf(r).forEach((k) => { counts[k] = (counts[k] || 0) + 1; }));
  return SOURCE_KEYS.filter((k) => counts[k]).map((k) => ({ key: k, label: SOURCE_LABELS[k], count: counts[k] }));
}

// The screening result of one number the row shows: the company's own, an extra number research found, or a person's or office's.
export const screeningOf = (a, phoneText) => (phoneText ? screeningOfNumber(a, phoneText) : null);

// A company counts as checked when any number on its record has a result.
export const hasTpsCheck = (a) => hasAnyTpsCheck(a);

const dateOf = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
};

// Text chips for one screening result: "TPS clear", "On TPS" and/or "On CTPS". Empty when the number was not screened.
export function tpsMarks(s) {
  if (!s) return [];
  const when = dateOf(s.checked_at);
  const title = `Checked against the TPS and CTPS registers${when ? ` on ${when}` : ""}`;
  const marks = [];
  if (s.status === "listed") marks.push({ text: "On TPS", title });
  if (s.ctps) marks.push({ text: "On CTPS", title });
  if (!marks.length && s.status === "clear") marks.push({ text: "TPS clear", title });
  return marks;
}
