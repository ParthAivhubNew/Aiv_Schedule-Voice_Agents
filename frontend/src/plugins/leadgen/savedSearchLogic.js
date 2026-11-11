// Pure helpers for Find Leads: the radius and "reasons to get in touch now" filters, and saved searches.

export const SIGNAL_OPTIONS = [
  ["new_director", "New director (last 90 days)", "Only companies whose directors we have already read from the register."],
  ["accounts_due", "Accounts due in the next 60 days", "The register says their next accounts are due soon."],
  ["filed_late", "Accounts overdue", "The register shows a filing that is past its due date."],
  ["new_company", "New company (last 12 months)", "Incorporated in the last year."],
];

export const RADIUS_MILES = [1, 3, 5, 10, 25];

// What a radius lookup answered, as the form's `near` value (kept with the typed text so it can be shown again).
export function nearFromReply(postcode, miles, reply) {
  const districts = (reply?.districts || []).filter(Boolean);
  return { postcode: String(reply?.postcode || postcode || "").trim().toUpperCase(), miles: Number(miles) || 5, districts };
}

export function coversText(near) {
  const n = near?.districts?.length || 0;
  return n ? `Covers ${n} postcode ${n === 1 ? "district" : "districts"}` : "";
}

export function toggleIn(list, key) {
  return list.includes(key) ? list.filter((x) => x !== key) : [...list, key];
}

// The filters a saved search keeps, as the panel's own filter object: near only when it has districts, signals only when picked.
export function cleanFilters(filters) {
  const out = { ...(filters || {}) };
  if (!out.near || !(out.near.districts || []).length) delete out.near;
  if (!(out.signals || []).length) delete out.signals;
  return out;
}

export function weeklyLabel(s) {
  if (!s) return "";
  const on = s.last_run_at ? new Date(s.last_run_at).toLocaleDateString([], { day: "numeric", month: "short" }) : "";
  const added = s.last_added ? `${s.last_added} new` : "nothing new";
  if (s.weekly) return on ? `Updates weekly. Last run ${on}, ${added}.` : "Updates weekly.";
  return on ? `Last run ${on}, ${added}.` : "Runs when you ask.";
}
