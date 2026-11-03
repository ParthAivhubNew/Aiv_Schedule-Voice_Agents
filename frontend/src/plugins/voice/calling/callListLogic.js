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

// A call-list row as a Leads company, for saving it there.
export function rowAsAccount(r, phone) {
  return {
    name: r.company || r.name || "", website: r.website || "", phone: phone || "", email: r.email || "", contact_name: r.contact || "",
    region: [r.town, r.postcode].filter(Boolean).join(" "), industry: r.sector || "", source: "import",
  };
}
