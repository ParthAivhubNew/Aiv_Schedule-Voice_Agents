// Matching what someone types to the real industries of the register (see backend app/services/industry_index.py). Runs on the page: the
// whole list is about a thousand terms, so there is no lookup per keystroke. A term is {k: "sic", code, label, n} or {k: "type", label, n}.

export const words = (s) => String(s || "").toLowerCase().match(/[a-z0-9]+/g) || [];

export const termKey = (t) => (t.k === "sic" ? `sic:${t.code}` : t.k === "group" ? `group:${t.name}` : `type:${t.label}`);
export const termText = (t) => (t.k === "sic" ? [t.code, t.label].filter(Boolean).join(" ") : t.label);

// The label begins with the text and the text ends on a word edge: "tax" begins "Tax consultancy" but not "Taxi operation".
const startsWithWord = (label, q) => label.startsWith(q) && !/[a-z0-9]/.test(label.charAt(q.length));

// Edit distance, giving up (returning max + 1) as soon as it must exceed max.
export function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      low = Math.min(low, cur[j]);
    }
    if (low > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// The best few terms for what is typed. Tiers, best first: starts with the text (or the code starts with the digits); every typed word is a
// whole word of the label; every typed word starts a word of the label; the term is a SIC code of the trade family the text belongs to
// (accountancy, accounting and accountants are one); a close spelling, only for words of six letters or more ("tax" is never "taxi").
export function matchTerms(query, terms, families = [], taken = new Set(), limit = 8) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];
  const qw = words(q);
  if (!qw.length) return [];
  const digits = /^\d+$/.test(q);
  const famCodes = new Set();
  const matched = [];  // the trade families the text belongs to
  const join = (f) => { if (!matched.includes(f)) matched.push(f); (f.codes || []).forEach((c) => famCodes.add(c)); };
  for (const f of families) {
    if ((f.words || []).some((w) => w === q || (q.length >= 4 && w.startsWith(q)) || qw.includes(w))) join(f);
  }
  const fuzzyOk = qw.every((w) => w.length >= 6);
  if (fuzzyOk && qw.length === 1) {  // a close spelling of a family word ("accoutants")
    const room = qw[0].length >= 9 ? 2 : 1;
    for (const f of families) {
      if ((f.words || []).some((w) => w.length >= 6 && distance(qw[0], w, room) <= room)) join(f);
    }
  }
  const out = [];
  for (const t of terms) {
    if (taken.has(termKey(t)) || (t.hidden && !q.includes("dorm"))) continue;
    const text = termText(t).toLowerCase();
    const tw = words(t.label || t.code);
    let tier = -1;
    if (digits) {
      if (t.k === "sic" && t.code.startsWith(q)) tier = 0;
    } else if (startsWithWord((t.label || "").toLowerCase(), q)) tier = 0;
    else if (qw.every((w) => tw.includes(w))) tier = 1;
    else if (qw.every((w) => tw.some((x) => x.startsWith(w)))) tier = 2;
    else if (t.k === "sic" && famCodes.has(t.code)) tier = 3;
    else if (fuzzyOk && qw.every((w) => tw.some((x) => distance(w, x, w.length >= 9 ? 2 : 1) <= (w.length >= 9 ? 2 : 1)))) tier = 4;
    if (tier >= 0) out.push({ ...t, tier, text });
  }
  out.sort((a, b) => a.tier - b.tier || (b.n || 0) - (a.n || 0) || a.text.localeCompare(b.text));
  return [...groupPicks(matched, terms, taken), ...out].slice(0, limit);
}

// One pick for a whole trade: the family's SIC codes and the register types named like it (Dentist is a care-register type, "Dental practice
// activities" a Companies House code: a person who wants dentists wants both). Only offered when there is a type to add; what is already
// chosen is left out, and the pick disappears once everything in it is chosen.
export function groupPicks(families, terms, taken) {
  const out = [];
  for (const f of families) {
    const have = new Set(terms.filter((t) => t.k === "sic").map((t) => t.code));
    const types = terms.filter((t) => t.k === "type" && !taken.has(termKey(t)) && words(t.label).some((w) => (f.words || []).includes(w)));
    const codes = (f.codes || []).filter((c) => have.has(c) && !taken.has(`sic:${c}`));
    if (!types.length || codes.length + types.length < 2) continue;  // one thing is not a group: it is offered as itself
    const size = (t) => t.n || 0;
    const n = types.reduce((s, t) => s + size(t), 0) + codes.reduce((s, c) => s + size(terms.find((t) => t.k === "sic" && t.code === c)), 0);
    out.push({ k: "group", name: f.name, label: `All ${f.name}`, codes, types: types.map((t) => t.label), n, tier: -1, text: `all ${f.name}` });
  }
  return out;
}
