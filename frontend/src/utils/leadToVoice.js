// Hand-off from a Lead Gen list to the Voice call list. Lead Gen stages the companies here, Voice
// picks them up when it opens. The stage waits in storage, so a user without the Voice plan can buy it
// and find the list ready.

const KEY = "aivhub_leadgen_to_voice";
const HEADERS = ["Company name", "Contact name", "Phone", "Email", "Website", "Lead ID"];

// Companies with a phone number go across; the rest are counted so the user knows who was left out.
// `allowed` is the server preview: the ids that can be called, and a count of those it held back.
export function buildCallList(name, accounts, phoneFor, contactFor, emailFor, allowed = null) {
  const records = [];
  let skipped = 0;
  const ok = allowed ? new Set(allowed) : null;
  for (const a of accounts) {
    const phone = phoneFor(a)?.text || "";
    if (!phone || (ok && !ok.has(a.id))) { skipped += 1; continue; }
    records.push({
      "Company name": a.name || a.company_name || "",
      "Contact name": contactFor(a)?.text || "",
      "Phone": phone,
      "Email": emailFor(a)?.text || "",
      "Website": a.website || "",
      "Lead ID": a.id,
    });
  }
  return { name, headers: HEADERS, records, skipped };
}

export function stageCallList(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ name: list.name, headers: list.headers, records: list.records, skipped: list.skipped || 0, at: Date.now() }));
    return true;
  } catch (_) {
    return false;
  }
}

// Returns the staged list once, then clears it.
export function takeCallList() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    const v = JSON.parse(raw);
    return v && Array.isArray(v.records) && v.records.length ? v : null;
  } catch (_) {
    return null;
  }
}

// How many companies are waiting, without taking them. Lets Voice tell a locked user their list is saved.
export function peekCallList() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    return v && Array.isArray(v.records) ? { name: v.name, count: v.records.length, skipped: v.skipped || 0 } : null;
  } catch (_) {
    return null;
  }
}
