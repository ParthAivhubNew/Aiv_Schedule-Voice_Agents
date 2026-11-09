// What the Voice call list needs to answer "who is left to call and how did the others go": the status of a row, the counts for the cards and
// chips, the filter behind the search box, and the saved views. Pure functions, so they are easy to test.

export const CHIPS = [
  ["all", "All"], ["not_called", "Not called"], ["no_answer", "No answer"], ["spoke", "Spoke with them"], ["interested", "Interested"],
  ["meeting", "Meeting booked"], ["not_interested", "Not interested"], ["dnc", "Do not call"], ["no_phone", "No phone"],
];

// A row's last call result, from the text the call log gives ("Meeting booked", "no_answer", "Left a voicemail"...), as one of the chips.
export function outcomeKey(row) {
  const o = String((row && row.lastOutcome) || "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (!o) return "not_called";
  if (/do not call|not to be called|dnc|opted out|stop calling/.test(o)) return "dnc";
  if (/meeting|booked/.test(o)) return "meeting";
  if (/not interested|rejected|wrong number|declined/.test(o)) return "not_interested";
  if (/interest/.test(o)) return "interested";
  if (/no answer|voicemail|busy|did not connect|failed|cancel|unanswered|missed/.test(o)) return "no_answer";
  return "spoke";
}

const blob = (row, phone) => [row.company, row.contact, row.name, phone, row.email, row.website, row.town, row.postcode, row.address, row.sector]
  .map((x) => String(x || "").toLowerCase()).join(" ");

// Rows that match the chip and every word typed in the search box. `phoneOf(row)` is the row's callable number, "" when it has none.
export function filterCalls(rows, { status = "all", q = "" } = {}, phoneOf = (r) => r.phone) {
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  const digits = (s) => String(s || "").replace(/\D/g, "");
  return rows.filter((r) => {
    const phone = phoneOf(r) || "";
    if (status === "no_phone" ? digits(phone).length >= 7 : status !== "all" && outcomeKey(r) !== status) return false;
    if (!words.length) return true;
    const text = blob(r, phone);
    const plain = digits(phone);
    return words.every((w) => text.includes(w) || (digits(w).length >= 3 && plain.includes(digits(w))));
  });
}

// Numbers for the four cards and the count on each chip.
export function countCalls(rows, phoneOf = (r) => r.phone) {
  const digits = (s) => String(s || "").replace(/\D/g, "");
  const chips = Object.fromEntries(CHIPS.map(([k]) => [k, 0]));
  let ready = 0;
  let called = 0;
  rows.forEach((r) => {
    const key = outcomeKey(r);
    const hasPhone = digits(phoneOf(r)).length >= 7;
    chips.all += 1;
    chips[key] += 1;
    if (!hasPhone) chips.no_phone += 1;
    if (hasPhone && !["dnc", "not_interested"].includes(key)) ready += 1;
    if (key !== "not_called" || Number(r.callTimes) > 0) called += 1;
  });
  return { chips, contacts: rows.length, ready, called, interested: chips.interested + chips.meeting };
}

// Saved views: a name for a chip and a search, kept in this browser. (Column layouts are saved by the column tools on the table.)
const VIEWS_KEY = "aivhub_voice_list_views";
export function readViews() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEWS_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.name === "string").slice(0, 20) : [];
  } catch { return []; }
}
export function writeViews(views) {
  try { localStorage.setItem(VIEWS_KEY, JSON.stringify(views.slice(0, 20))); } catch { /* the views just are not remembered */ }
}
export function withView(views, view) {
  const name = String(view.name || "").trim().slice(0, 40);
  if (!name) return views;
  return [{ name, status: view.status || "all", q: view.q || "" }, ...views.filter((v) => v.name.toLowerCase() !== name.toLowerCase())].slice(0, 20);
}

// What we hold for one contact, as Leads shows it for a company: which of the five details are filled and the share filled.
// A phone counts only when it has enough digits and a number check has not found it dead, made up or malformed.
// Only what is on the row is read; nothing is guessed.
export const DETAILS = [["phone", "phone"], ["contact", "contact name"], ["company", "company"], ["email", "email"], ["website", "website"]];
const DEAD_NUMBER = new Set(["not_working", "fictional", "bad_format"]);
const filled = (v) => String(v || "").trim() !== "";

export function rowDetails(row, phone) {
  const r = row || {};
  const has = {
    phone: String(phone || "").replace(/\D/g, "").length >= 7 && !DEAD_NUMBER.has(r.check && r.check.status),
    contact: filled(r.contact),
    company: filled(r.company),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r.email || "").trim()),
    website: filled(r.website),
  };
  const missing = DETAILS.filter(([k]) => !has[k]).map(([, label]) => label);
  return { pct: Math.round(((DETAILS.length - missing.length) / DETAILS.length) * 100), missing, has };
}

// The whole list: the average share filled, how many have a working phone, and how many have all five.
export function listDetails(rows, phoneOf = (r) => r.phone) {
  if (!rows.length) return { pct: 0, phones: 0, full: 0 };
  let sum = 0;
  let phones = 0;
  let full = 0;
  rows.forEach((r) => {
    const d = rowDetails(r, phoneOf(r));
    sum += d.pct;
    if (d.has.phone) phones += 1;
    if (!d.missing.length) full += 1;
  });
  return { pct: Math.round(sum / rows.length), phones, full };
}

export const detailsTip = (d) => `${d.pct}% of the details filled in: phone, contact name, company, email and website.${d.missing.length ? ` Missing: ${d.missing.join(", ")}.` : " Nothing is missing."}`;

// The question asked before calls start for several contacts at once: how many, how many at a time, and the price.
// perMinute and balance come from the Voice wallet; when they could not be read the price is described without a number.
export function bulkCallPrompt({ count, cap = 1, perMinute = null, balance = null }) {
  const n = Number(count) || 0;
  const lines = [`Call ${n.toLocaleString()} contact${n === 1 ? "" : "s"}, ${cap} at a time?`];
  const rate = Number(perMinute);
  if (rate > 0) lines.push(`Calls cost ${rate.toLocaleString()} credit${rate === 1 ? "" : "s"} a minute.`);
  else if (perMinute == null) lines.push("Calls are paid by the minute from your Voice credits.");
  if (balance != null && Number.isFinite(Number(balance))) lines.push(`You have ${Number(balance).toLocaleString()} Voice credit${Number(balance) === 1 ? "" : "s"}.`);
  return lines.join("\n");
}

// A call-list row as a Leads company, for saving it there.
export function rowAsAccount(r, phone) {
  return {
    name: r.company || r.name || "", website: r.website || "", phone: phone || "", email: r.email || "", contact_name: r.contact || "",
    region: [r.town, r.postcode].filter(Boolean).join(" "), industry: r.sector || "", source: "import",
  };
}
