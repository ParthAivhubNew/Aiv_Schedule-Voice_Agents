// What the company page shows, worked out from the server's profile. No screens here, so it can be tested on its own.

export const TABS = [["overview", "Overview"], ["people", "People"], ["filings", "Filings and money"], ["activity", "Activity"]];
export const STATUS_PILL = { green: "green", amber: "amber", red: "red", slate: "slate" };
export const SIGNAL_TONES = { opportunity: "green", caution: "amber", info: "blue" };
export const SOURCE_WORDS = { register: "Register", web: "Web", missing: "Not known" };

// "BRIGHT CAFE LIMITED" -> "Bright Cafe Limited". Names that are already mixed case are left as they are.
export function niceName(name) {
  const s = String(name || "");
  if (!s || s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s&(/-])([a-z])/g, (_, a, b) => a + b.toUpperCase()).replace(/\b(Ltd|Llp|Plc|Uk)\b/g, (w) => (w === "Uk" ? "UK" : w.toUpperCase() === "LTD" ? "Ltd" : w.toUpperCase()));
}

// The line under the name: type, place, age, size. Only what is known.
export function subLine(c) {
  return [c.type, c.region ? niceName(c.region) : "", c.age ? c.age : c.incorporated ? `since ${c.incorporated.split(" ").slice(-1)[0]}` : "", c.size ? `${c.size} company` : ""].filter(Boolean).join(" · ");
}

// Contact details in display order, each with a link and where it came from. A missing one has no link and offers to be found.
export function contactRows(contact) {
  const link = { website: (v) => (/^https?:/i.test(v) ? v : `https://${v}`), phone: (v) => `tel:${v.replace(/\s+/g, "")}`, email: (v) => `mailto:${v}` };
  return ["website", "phone", "email"].map((kind) => {
    const c = (contact && contact[kind]) || { value: "", source: "missing", label: "Not known yet" };
    const shown = kind === "website" ? c.value.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : c.value;
    return { kind, value: c.value, shown, href: c.value ? link[kind](c.value) : "", source: c.source, sourceWord: SOURCE_WORDS[c.source] || c.source, label: c.label, canFind: c.source === "missing" && kind !== "email" };
  });
}

// Why now: opportunities first, then cautions, then plain information.
export function orderSignals(signals) {
  const rank = { opportunity: 0, caution: 1, info: 2 };
  return [...(signals || [])].sort((a, b) => (rank[a.tone] ?? 3) - (rank[b.tone] ?? 3));
}

// One person's second line: how long in the role, nationality, trade, where they live, birth year. Only what the register publishes.
export function personMeta(o) {
  const y = o.years_in_role;
  const years = y == null ? "" : y === 0 ? "joined this year" : `${y} ${y === 1 ? "year" : "years"} in the role`;
  return [years, o.nationality, o.occupation, o.country_of_residence ? `lives in ${o.country_of_residence}` : "", o.born_year ? `born ${o.born_year}` : ""].filter(Boolean).join(" · ");
}

// Filings as label/value rows, skipping what is not stored. `warn` marks a date that has passed.
export function filingRows(c) {
  const rows = [];
  if (c.accounts && c.accounts.category) rows.push({ label: "Accounts filed as", value: c.accounts.category });
  if (c.accounts && c.accounts.last_made) rows.push({ label: "Last accounts", value: c.accounts.last_made });
  if (c.accounts && c.accounts.next_due) rows.push({ label: "Next accounts due", value: c.accounts.next_due, warn: Boolean(c.accounts.overdue), note: c.accounts.overdue ? "overdue" : "" });
  if (c.confirmation && c.confirmation.last) rows.push({ label: "Last confirmation statement", value: c.confirmation.last });
  if (c.confirmation && c.confirmation.next_due) rows.push({ label: "Next confirmation statement", value: c.confirmation.next_due });
  if (c.charges && c.charges.total) rows.push({ label: "Charges", value: `${c.charges.outstanding} outstanding, ${c.charges.satisfied} settled` });
  if (c.country) rows.push({ label: "Country of origin", value: c.country });
  return rows;
}

// A plain count for the People tab label.
export const peopleCount = (people) => (people ? (people.officers || []).length + (people.controllers || []).length : 0);

// What happened, when: newest first, with a plain "5 Nov" style date.
export function activityRows(activity) {
  return (activity || []).map((a) => ({ ...a, when: a.at ? new Date(a.at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "" }));
}

// The register writes officers as "SURNAME, Forename": shown as "Forename Surname".
export function personName(raw) {
  const s = String(raw || "").trim();
  if (!s.includes(",")) return niceName(s);
  const [last, ...rest] = s.split(",");
  return `${niceName(rest.join(",").trim())} ${niceName(last.trim())}`.trim();
}

// "2026-08-31" -> "31 Aug 2026"
export function shortDate(iso) {
  const d = new Date(`${String(iso || "").slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(iso || "") : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
