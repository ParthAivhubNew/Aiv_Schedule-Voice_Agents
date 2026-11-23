import { tpsKey, uniqueNumbers } from "./tpsCheck";

// Every phone number a saved company holds, each with its own TPS/CTPS result: the company's own number, each extra number research found
// (`research.phones`, with `research.phones_screening` in the same order), each team member's and person's number, and each other office's.
// A number written two ways (0113 550 0412, +44 113 550 0412) is one entry; it keeps the first result any copy carried.
export function allNumbers(a) {
  const out = [];
  const at = new Map();
  const add = (text, screening, kind, who = "") => {
    const t = String(text || "").trim();
    const k = tpsKey(t);
    if (!k) return;
    if (at.has(k)) {
      const seen = out[at.get(k)];
      if (!seen.screening && screening) seen.screening = screening;
      return;
    }
    at.set(k, out.length);
    out.push({ text: t, key: k, screening: screening || null, kind, who });
  };
  const r = a?.research && typeof a.research === "object" ? a.research : {};
  add(a?.phone, a?.phone_screening, "company");
  (Array.isArray(r.phones) ? r.phones : []).forEach((p, i) => add(typeof p === "string" ? p : p?.phone, (r.phones_screening || [])[i] || p?.phone_screening, "research"));
  for (const t of [...(r.team || []), ...(r.people || [])]) if (t && t.phone) add(t.phone, t.phone_screening, "person", t.name || "");
  for (const o of r.other_offices || []) if (o && o.phone) add(o.phone, o.phone_screening, "office", o.town || "");
  return out;
}

// The TPS/CTPS result held for one number of this company, or null.
export function screeningOfNumber(a, text) {
  const k = tpsKey(text);
  return k ? allNumbers(a).find((n) => n.key === k)?.screening || null : null;
}

// The company has a result when any of its numbers has one.
export const hasAnyTpsCheck = (a) => allNumbers(a).some((n) => n.screening);

// Every distinct number on these companies, ready for the check dialog (which skips the ones checked in the last 28 days, free).
export const numbersToCheck = (accounts) => uniqueNumbers((accounts || []).flatMap((a) => allNumbers(a).map((n) => n.text)));

// How many numbers on these companies already hold a result, and how many do not (a rough local count; the server decides what is fresh).
export function numberCounts(accounts) {
  const nums = (accounts || []).flatMap((a) => allNumbers(a));
  const keys = new Map();
  nums.forEach((n) => { if (!keys.has(n.key) || (n.screening && !keys.get(n.key))) keys.set(n.key, Boolean(n.screening)); });
  const checked = [...keys.values()].filter(Boolean).length;
  return { total: keys.size, checked, unchecked: keys.size - checked };
}
