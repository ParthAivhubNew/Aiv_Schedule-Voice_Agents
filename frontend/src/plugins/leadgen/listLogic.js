// What the saved-companies list and the lists page work out from rows. No screens here, so it can be tested on its own.
import { emailFor, phoneFor, readiness, SOURCE_LABEL } from "./AccountsViews";

const FIRST_SEEN = { scout: "Found by AI Lead Scout", copilot: "Found by AI Lead Copilot", import: "Imported", manual: "Added by hand", inbound_form: "Web form" };

// Where a company stands: already in touch, ready to write to, or still needs a way to reach it.
export function bucket(a) {
  const c = a.connection || {};
  if (c.last_contact_at || c.last_called_at || (c.stage && c.stage !== "new")) return "contacted";
  const route = a.email_route || {};
  if (route.email === false && route.group === "reach_other_way") return "other"; // a sole trader or individual: a call, letter or LinkedIn instead of email
  if (emailFor(a)?.text && !a.send_block && route.email !== false && !["fixes", "attention"].includes(readiness(a))) return "ready";
  return "needs";
}

// Phone or email answers we found more than one of, waiting for the person to choose.
export const openPicks = (a) => ((a.verification || {}).fixes || []).filter((f) => f.kind === "pick" && !f.applied);

const digits = (v) => String(v || "").replace(/\D+/g, "");

// id -> ["duplicate" | "shared_phone"]. A duplicate shares a company number, a website domain, or a name and postcode.
export function duplicateFlags(rows) {
  const groups = { dup: new Map(), phone: new Map() };
  const add = (map, key, row) => { if (key) map.set(key, [...(map.get(key) || []), row]); };
  rows.forEach((a) => {
    add(groups.dup, a.registration_number ? `n:${String(a.registration_number).trim().toUpperCase()}` : "", a);
    add(groups.dup, a.domain ? `d:${String(a.domain).toLowerCase()}` : "", a);
    add(groups.dup, a.name && a.postcode ? `p:${String(a.name).trim().toLowerCase()}|${String(a.postcode).replace(/\s+/g, "").toLowerCase()}` : "", a);
    add(groups.phone, digits(phoneFor(a)?.text), a);
  });
  const out = {};
  const mark = (id, flag) => { out[id] = out[id] || []; if (!out[id].includes(flag)) out[id].push(flag); };
  groups.dup.forEach((list) => { if (list.length > 1) list.forEach((a) => mark(a.id, "duplicate")); });
  groups.phone.forEach((list) => {
    const companies = new Set(list.map((a) => (a.registration_number ? String(a.registration_number).toUpperCase() : a.id)));
    if (list.length > 1 && companies.size > 1) list.forEach((a) => mark(a.id, "shared_phone"));
  });
  return out;
}

export const FLAG_WORDS = {
  duplicate: ["Possible duplicate", "Another row has the same company number, website or name and postcode."],
  shared_phone: ["Shared phone", "Another company in this list has the same phone number."],
};

// "Imported · 3 Nov 2026" from where it came from and when it was saved.
export function firstSeen(a) {
  const how = FIRST_SEEN[a.source] || FIRST_SEEN.manual;
  const d = a.created_at ? new Date(a.created_at) : null;
  const when = d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  return [how, when].filter(Boolean).join(" · ");
}

// The numbers a list row shows: how many are ready, the average fit of the scored ones, and where most came from.
export function listStats(members) {
  const rows = members || [];
  const ready = rows.filter((a) => bucket(a) === "ready").length;
  const scored = rows.map((a) => a.fit?.score).filter((s) => typeof s === "number");
  const avgFit = scored.length ? Math.round(scored.reduce((x, y) => x + y, 0) / scored.length) : null;
  const counts = {};
  rows.forEach((a) => { const k = SOURCE_LABEL[a.source] || SOURCE_LABEL.manual; counts[k] = (counts[k] || 0) + 1; });
  const top = Object.entries(counts).sort((x, y) => y[1] - x[1])[0];
  const source = !top ? "" : top[1] > rows.length / 2 ? top[0] : "Mixed";
  return { ready, avgFit, source };
}
