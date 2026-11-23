import { ENRICHMENT_NOTE, GOOGLE_NOTE, SOURCE_LABELS, hasGoogleData } from "./SourceMark";
import { VERDICTS } from "./CheckCompanies";

// What a saved company can honestly say about where its details came from and what was checked.
// Fields come from `field_sources` (the server only records phone, email and website). Checks come from the
// stages the company check saved in `verification.stages`: a check that did not run is never listed.

const FIELDS = [["phone", "Phone"], ["email", "Email"], ["website", "Website"]];

const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : "");
const whenOf = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
};

const WEBSITE = { live: "Working", dead: "Not working", parked: "Parked or for sale", directory: "A directory page, not its own site" };
const EMAIL = { verified: "Confirmed", found: "A verified address was found", ok: "Looks right", invalid: "Not working" };
const PHONE = { ok: "Looks right", unconfirmed: "Not a normal phone line", invalid: "Not a usable number" };

function registerResult(v) {
  const reasons = v.reasons || [];
  for (const r of reasons) {
    const m = r.match(/^Company register: (.+?) \((checked live|our register copy)\)$/);
    if (m) return `${cap(m[1])}${m[2] === "checked live" ? ", checked live" : ", from our copy of the register"}`;
  }
  if (v.pending_registry) return "Has not answered yet";
  return "Checked";
}

function recordsResult(v) {
  for (const r of v.reasons || []) {
    const m = r.match(/^Our records: ([^,]+)/);
    if (m) return cap(m[1].trim());
  }
  return "Checked";
}

function searchResult(v) {
  const r = (v.reasons || []).find((x) => x.startsWith("Deep web search:")) || "";
  if (/permanently closed/i.test(r)) return "Found, marked permanently closed";
  if (/found as a working/i.test(r)) return "Found, open and working";
  if (/temporarily/i.test(r)) return "Found, temporarily closed";
  return "Searched";
}

// Each step the check records, in the order a reader expects. `ran` is the stage name the server saved.
const STEPS = [
  ["registry", SOURCE_LABELS.register, (v) => registerResult(v)],
  ["our_records", "Our records", (v) => recordsResult(v)],
  ["deep_search", SOURCE_LABELS.web, (v) => searchResult(v)],
  ["web", SOURCE_LABELS.web, () => "Searched"],
  ["listing", "Directory page", (v) => (v.listing?.confirmed ? "Confirmed as this company's page" : "Found, not confirmed")],
  ["website", SOURCE_LABELS.website, (v) => WEBSITE[v.website?.state] || "Checked"],
  ["email", "Email address", (v) => EMAIL[v.email?.state] || "Checked"],
  ["phone", "Phone format", (v) => PHONE[v.phone?.state] || "Checked"],
  ["phone_lookup", SOURCE_LABELS.check, (v) => (v.phone?.verified === true ? "Confirmed live" : v.phone?.verified === false ? "Not confirmed" : "Asked")],
  ["email_finder", "Email search", (v) => (["verified", "found"].includes(v.email?.state) ? "A verified address was found" : "Searched")],
];

// -> { fields: [{key, field, label}], sources: [{key, label}], checks: [{name, result, when}], notes: [string], checked: boolean, summary: string }
export function describeSources(account) {
  const a = account || {};
  const raw = a.field_sources || {};
  const fields = FIELDS.filter(([f]) => raw[f]).map(([f, field]) => {
    const key = String(raw[f]).split(":")[0];
    return { key, field, label: SOURCE_LABELS[key] || "Other source" };
  });
  const seen = new Set();
  const sources = fields.filter((f) => (seen.has(f.label) ? false : seen.add(f.label))).map(({ key, label }) => ({ key, label }));

  const v = a.verification;
  const when = whenOf(v?.checked_at);
  let checks = [];
  if (v && typeof v === "object") {
    const stages = Array.isArray(v.stages) ? v.stages : [];
    checks = STEPS.filter(([stage]) => stages.includes(stage)).map(([, name, result]) => ({ name, result: result(v), when }));
    if (!checks.length && v.source === "register_copy") checks = [{ name: SOURCE_LABELS.register, result: registerResult(v), when }];
    if (!checks.length && v.verdict && VERDICTS[v.verdict]) checks = [{ name: "Company check", result: VERDICTS[v.verdict].label, when }];
  }

  const notes = [];
  if (hasGoogleData(a)) notes.push(GOOGLE_NOTE);
  else if (Object.keys(a.restricted || {}).some((k) => a.restricted[k])) notes.push(ENRICHMENT_NOTE);

  const checked = checks.length > 0;
  const parts = [];
  if (fields.length) parts.push(`Details from ${sources.map((s) => s.label).join(", ")}`);
  parts.push(checked ? `${checks.length} ${checks.length === 1 ? "check" : "checks"}${when ? `, last on ${when}` : ""}` : "Not checked yet");
  return { fields, sources, checks, notes, checked, summary: parts.join(". ") };
}
