// Standard columns for company import files, and matching a file's own columns to them.
// Same shape as the Voice plugin's importMapping.js (./voice/calling/importMapping.js), but for
// the fields a saved account actually has -- there's no "keep as extra column" option here since
// an account has no place to put a column that isn't one of these.

export const STANDARD_FIELDS = [
  { key: "name", label: "Company name", important: true },
  { key: "website", label: "Website" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "contact_name", label: "Contact" },
  { key: "contact_title", label: "Contact's job title" },
  { key: "industry", label: "Industry" },
  { key: "region", label: "Town or region" },
  { key: "notes", label: "Notes" },
];

export const SKIP = "__skip__"; // do not import

const GUESSES = [
  ["website", /web\s*address|website|web\s*site|homepage|\burl\b|domain/i],
  ["email", /e-?mail/i],
  ["phone", /telephone|phone|mobile|\btel\b|cell\b|contact\s*number|^number$/i],
  ["contact_title", /job.?title|^title$|^role$|position|designation/i],
  ["name", /business\s*name|company|trading|organi[sz]ation|^business$|^firm$|account\s*name|^name$/i],
  ["contact_name", /contact\s*name|full.?name|contact person|^contact$|decision\s*maker|owner/i],
  ["industry", /sic|sector|industry|category|^type$/i],
  ["region", /post\s*code|zip|^town$|^city$|locality|^region$|location|county|^area$|country|address/i],
  ["notes", /note|comment|description/i],
];

export function signature(headers) {
  return (headers || []).map((h) => String(h).trim().toLowerCase()).sort().join("|");
}

export function guessMapping(headers) {
  const used = new Set();
  const out = {};
  (headers || []).forEach((h) => {
    const name = String(h || "").trim();
    const hit = GUESSES.find(([key, re]) => !used.has(key) && re.test(name));
    if (hit) {
      out[h] = hit[0];
      used.add(hit[0]);
    } else {
      out[h] = SKIP;
    }
  });
  return out;
}

// Returns flat {name, website, phone, ...} objects -- each record has only the standard keys,
// filled from whichever file column was matched to them. If two columns are matched to the
// same field, the first one (in header order) wins.
export function applyMapping(headers, records, mapping) {
  const plan = [];
  const used = new Set();
  (headers || []).forEach((h) => {
    const target = mapping[h] || SKIP;
    if (target === SKIP || used.has(target)) return;
    used.add(target);
    plan.push([h, target]);
  });
  const out = (records || []).map((rec) => {
    const r = {};
    plan.forEach(([from, to]) => {
      r[to] = String(rec[from] ?? "").trim();
    });
    return r;
  });
  return out;
}

// Problems worth showing before importing.
export function mappingWarnings(mapping, records) {
  const vals = Object.values(mapping);
  const warn = [];
  if (!vals.includes("name") && !vals.includes("website")) {
    warn.push("No column is matched to Company name or Website, so these rows have nothing to save them by.");
  }
  const counts = {};
  vals.forEach((v) => { if (v !== SKIP) counts[v] = (counts[v] || 0) + 1; });
  Object.entries(counts).forEach(([k, n]) => {
    if (n > 1) {
      const label = (STANDARD_FIELDS.find((f) => f.key === k) || {}).label || k;
      warn.push(`${n} columns are matched to ${label}; only the first is used.`);
    }
  });
  return warn;
}

const STORE = "leadgen_import_mappings";

export function savedMappingFor(headers) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) || "{}");
    return all[signature(headers)] || null;
  } catch (_) {
    return null;
  }
}

export function rememberMapping(headers, mapping) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) || "{}");
    all[signature(headers)] = mapping;
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch (_) {}
}
