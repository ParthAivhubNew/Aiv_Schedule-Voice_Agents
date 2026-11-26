import { inboxKind } from "../inboxes";
import { ORIGIN_LABEL, ORIGIN_WORDS, originWords } from "../originLabels";

// The Leads screens built on saved accounts (stored on the server, per company): Find Leads results,
// Saved Accounts, Decision Makers, Account Dossiers and Import, plus the account panel and the
// add-account form. Nothing here is made up: a field nobody found stays empty.

export const SOURCE_LABEL = ORIGIN_LABEL;
// Where a company came from, in a sentence a person understands.
export const SOURCE_WORDS = ORIGIN_WORDS;
export const sourceWords = originWords;

export function domainOf(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch (_) {
    return "";
  }
}

export function hasFindings(a) {
  const r = a?.research;
  return Boolean(r && (r.overview || r.people?.length || r.team?.length || r.phones?.length || r.emails?.length || r.other_offices?.length || Object.keys(r.socials || {}).length));
}

// What happens next for a company that still isn't complete or verified. Finding data is our job, so every point is something
// we do or something the person already knows, never a pointer to another service. When we have searched everything, we say so.
const SHARED_INBOX = /^(info|hello|contact|enquiries|enquiry|office|admin|sales|support|accounts|mail|team|reception)@/i;
const NAMES = { website: "website", phone: "phone", email: "email", contact_name: "contact" };
// What to do next, chosen from this company's own state. Each tip names what is actually wrong here, and nothing shows when nothing is.
export function tipsFor(a) {
  const has = (k) => Boolean(String(a[k] || "").trim());
  const v = a.verification || {};
  const searched = Boolean(a.researched_at);
  const gaps = ["website", "phone", "email", "contact_name"].filter((k) => !has(k));
  const tips = [];
  if (gaps.length) {
    const list = gaps.map((k) => NAMES[k]).join(", ");
    tips.push(searched
      ? ["Still missing: " + list, "Our records and the web were searched and these are not published anywhere we can reach. Find contact again re-runs the search. New details appear here as we find them."]
      : ["Missing: " + list, "Press Find contact. We check our records, then the web, and fill in what we find."]);
  }
  if (!has("website") && gaps.length) tips.push(["Know the website?", "If you have it from your own file or a conversation, type it under Details. We then read that site for the phone, email and contact."]);
  if (has("website") && !has("phone") && searched) tips.push(["No phone on their site", "We read the company's own pages and found no number. A deep web search looks beyond the site and runs as part of Find contact."]);
  if (has("website") && !has("contact_name")) tips.push(["No named contact", has("email") && SHARED_INBOX.test(a.email) ? "Only a shared inbox was found. An email to it reaches the firm, not a person. Find contact looks for the owner or director on their pages." : "We look for the owner or director on the company's own pages."]);
  if (has("email") && SHARED_INBOX.test(a.email) && has("contact_name")) tips.push(["Shared inbox", "The email is a shared address. It works, but a message to a named person usually gets more replies. Check the email lines for this lead."]);
  if (v.phone?.state === "invalid") tips.push(["This number isn't usable", (v.phone.note ? v.phone.note + " " : "") + "Correct it under Details, or use Find contact to look for another."]);
  else if (has("phone") && v.phone?.verified !== true) tips.push(["Number not confirmed", "Use Get contacts from the list. We check whether the number is real and live (the price shows before it runs) and tag it when it matches the company's own website."]);
  if (v.email?.state === "invalid") tips.push(["This email will bounce", "The address failed our test. Correct it under Details, or use Find contact to look for another."]);
  else if (has("email") && !GOOD_EMAIL.has(v.email?.state)) tips.push(["Email not confirmed", "Use Get contacts from the list. We test the address before you send, so it doesn't bounce."]);
  if (gaps.length && searched) tips.push(["If it stays incomplete", "Small firms often publish no contact details. You are charged only when we find something. You can also leave this company out of a journey."]);
  return tips;
}

// ---------------------------------------------------------------- Saved Accounts
// Columns a person can hide from their own view of the table (kept in their browser; nothing is deleted).

// What a row can honestly show for "Contact" and "Email": what is saved on the company first, then what its
// research found, so a researched company is never shown as empty while its dossier holds the details.
// A blank cell means two different things: we looked and found nothing, or nobody has looked yet.
export function wasLookedUp(a) {
  return Boolean(a?.researched_at || (a?.verification && a.verification.checked_at));
}

// A number saved on the company first, then what research found, so a researched company never looks empty.
export function phoneFor(a) {
  if (a.phone) return { text: a.phone, fromResearch: false };
  const r = a.research || {};
  const found = (r.phones || [])[0] || (r.team || []).map((t) => t.phone).find(Boolean) || (r.other_offices || []).map((o) => o.phone).find(Boolean);
  return found ? { text: found, fromResearch: true } : null;
}
// The companies with the most details filled in (from the file, from research and from our register) come first, so the ones worth working are on top.
// A company with an email or a phone beats one without at the same level, and the rest keep their order.
export function completeFirst(rows) {
  const score = (a) => (a.completeness?.pct || 0) * 10 + (emailFor(a)?.text ? 2 : 0) + (phoneFor(a)?.text ? 1 : 0);
  return rows.map((a, i) => [a, i]).sort((x, y) => score(y[0]) - score(x[0]) || x[1] - y[1]).map(([a]) => a);
}
// Was this field empty before we looked, and filled in by us?
export const isNew = (a, field) => Boolean(a.found?.filled?.some((f) => f.field === field));
export const foundCount = (a) => a.found?.new_count || 0;

export const HOW_WORD = { web: "web search", check: "contact check" };
const FIELD_WORD = { website: "Website", phone: "Phone", email: "Email", contact_name: "Contact" };
export const barColor = (p) => (p >= 75 ? "#16A34A" : p >= 50 ? "#D97706" : "#DC2626");

// How complete the company's record is, from the server's count over website, phone, email, address, industry, people and size.
// The tooltip names what is missing, so a low number says what to look for.
export function completenessTip(c) {
  if (!c) return "";
  const missing = c.missing || [];
  return `${c.pct}% of the key details are filled in: website, phone, email, address, industry, people and size.${missing.length ? ` Missing: ${missing.join(", ")}.` : " Nothing is missing."}`;
}

// A name from the user's own file columns (e.g. "Contact forename" + "Contact surname"), when it was not saved as the contact.
export function fileContact(a) {
  const c = a.custom || {};
  const pick = (re) => Object.entries(c).find(([k, v]) => re.test(k) && String(v || "").trim());
  const first = pick(/fore?name|first/i), last = pick(/surname|last/i);
  return [first?.[1], last?.[1]].filter(Boolean).join(" ").trim();
}

export function contactFor(a) {
  if (a.contact_name) return { text: a.contact_name, title: a.contact_title || "", fromResearch: false };
  const r = a.research || {};
  const person = (r.team || []).find((t) => t.name) || (r.people || []).find((t) => t.name);
  if (person) return { text: person.name, title: person.title || person.role || "", fromResearch: true };
  const named = (r.email_contacts || []).find((c) => c.name);
  if (named) return { text: named.name, title: "", fromResearch: true };
  const mailbox = [...(r.team || []).map((t) => t.email), ...(r.emails || [])].find((e) => /^[a-z]{2,}[._-][a-z]{2,}@/i.test(e || "") && inboxKind(e) === "person");
  if (mailbox) return { text: mailbox, title: "", fromResearch: true };
  return null;
}
export function emailFor(a) {
  if (a.email) return { text: a.email, fromResearch: false };
  const r = a.research || {};
  const found = (r.emails || [])[0] || (r.team || []).map((t) => t.email).find(Boolean);
  return found ? { text: found, fromResearch: true } : null;
}
export const HIDDEN_KEY = "aivhub_accounts_hidden_columns";
// Column hiding now lives only in the grid's "Columns" menu. Drop what the old top-row button saved so nothing stays hidden with no way back.
export const readHidden = () => {
  try { localStorage.removeItem(HIDDEN_KEY); } catch { /* nothing to clear */ }
  return [];
};
// The user's own columns from imported files, in the order they first appear.
export function customColumns(accounts) {
  const seen = [];
  (accounts || []).forEach((a) => Object.keys(a.custom || {}).forEach((k) => { if (!seen.includes(k)) seen.push(k); }));
  return seen;
}

// Where a menu opens: just under its button, in the window, so the table's rounded edge never clips it.
export function menuSpot(box, side) {
  const r = box.current ? box.current.getBoundingClientRect() : { bottom: 0, left: 0, right: 0 };
  return side === "right" ? { top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) } : { top: r.bottom + 4, left: Math.max(8, r.left) };
}

// Saved views: a name for a set of columns and a filter, kept in this browser. "Default view" is always there.
export const VIEWS_KEY = "aivhub_accounts_views";
export const readViews = () => {
  try { const v = JSON.parse(localStorage.getItem(VIEWS_KEY) || "[]"); return Array.isArray(v) ? v.filter((x) => x && typeof x.name === "string") : []; } catch { return []; }
};

export const openFixes = (a) => ((a.verification || {}).fixes || []).filter((f) => f.kind === "fix" && !f.applied);
const GOOD_EMAIL = new Set(["ok", "verified", "found"]);
const hasProblem = (a) => ["problem", "mismatch"].includes(a.verification?.verdict) || a.verification?.email?.state === "invalid";
// Where a company stands for emailing: the one answer the list shows and filters by.
export function readiness(a) {
  if (openFixes(a).length) return "fixes";
  if (hasProblem(a)) return "attention";
  if ((a.import_flags || []).some((f) => /^REGNO_/.test(f.code))) return "attention"; // the company number in the file is wrong or used twice
  if (a.send_block && a.send_block.code !== "unchecked") return "attention"; // an individual without consent, or a bad address: not sendable
  if (!a.send_block && emailFor(a)?.text && GOOD_EMAIL.has(a.verification?.email?.state)) return "ready";
  if (!emailFor(a)?.text && wasLookedUp(a)) return "noemail";
  return "other";
}
