// The four answers of a legitimate interests assessment, in the order the server prints them.
export const LIA_FIELDS = [
  ["purpose", "Purpose: what you want and why"],
  ["necessity", "Necessity: why contacting them is needed"],
  ["balance", "Balance: how it affects the people you write to"],
  ["safeguards", "Safeguards: what protects them"],
];

// One line under the intro: untouched wording, or who saved it and when.
export function liaStatus(doc) {
  if (!doc || !doc.saved) return "Not saved yet.";
  const day = String(doc.updated_at || "").slice(0, 10);
  return day ? `Last saved ${day}${doc.by ? ` by ${doc.by}` : ""}.` : "Saved.";
}
