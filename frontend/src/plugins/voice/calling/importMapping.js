// Standard columns for contact files, and matching a file's own columns to them.
// A file column is either matched to a standard column, kept as an extra column ("Others"),
// or not imported. Matched columns are renamed to the standard name, so the rest of the app
// reads them the same way whatever the file called them.

export const STANDARD_FIELDS = [
  { key: "company", label: "Company name", header: "Company name" },
  { key: "contact", label: "Contact name (full)", header: "Contact name" },
  { key: "first_name", label: "First name", header: "First name" },
  { key: "last_name", label: "Last name", header: "Last name" },
  { key: "phone", label: "Phone", header: "Phone", important: true },
  { key: "email", label: "Email", header: "Email" },
  { key: "website", label: "Website", header: "Website" },
  { key: "linkedin", label: "LinkedIn", header: "LinkedIn" },
  { key: "job_title", label: "Job title", header: "Job title" },
  { key: "industry", label: "Industry / sector", header: "Industry" },
  { key: "address", label: "Address", header: "Address" },
  { key: "town", label: "Town / city", header: "Town" },
  { key: "postcode", label: "Postcode", header: "Postcode" },
  { key: "country", label: "Country", header: "Country" },
  { key: "notes", label: "Notes", header: "Notes" },
];

export const KEEP = "__keep__"; // keep as an extra column (Others)
export const SKIP = "__skip__"; // do not import

const GUESSES = [
  ["linkedin", /linkedin/i],
  ["email", /e-?mail/i],
  ["website", /web\s*address|website|web\s*site|homepage|\burl\b|domain/i],
  ["phone", /telephone|phone|mobile|\btel\b|cell\b|contact\s*number|^number$/i],
  ["first_name", /forename|first.?name|given.?name/i],
  ["last_name", /surname|last.?name|family.?name/i],
  ["job_title", /job.?title|position|^title$|^role$|designation/i],
  ["company", /business\s*name|company|trading|organi[sz]ation|^business$|^firm$|account\s*name/i],
  ["contact", /contact\s*name|prospect\s*name|full.?name|contact person|^contact$|^name$|decision\s*maker/i],
  ["industry", /sic|sector|industry/i],
  ["postcode", /post\s*code|zip/i],
  ["town", /^town$|^city$|locality/i],
  ["address", /address/i],
  ["country", /country/i],
  ["notes", /note|comment/i],
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
      out[h] = KEEP;
    }
  });
  return out;
}

// Returns { headers, records } with matched columns renamed to the standard names,
// extra columns kept under their own names and skipped columns dropped.
export function applyMapping(headers, records, mapping) {
  const byKey = Object.fromEntries(STANDARD_FIELDS.map((f) => [f.key, f.header]));
  const outHeaders = [];
  const plan = [];
  (headers || []).forEach((h) => {
    const target = mapping[h] || KEEP;
    if (target === SKIP) return;
    const name = target === KEEP ? String(h) : byKey[target];
    if (!name || outHeaders.includes(name)) return;
    outHeaders.push(name);
    plan.push([h, name]);
  });
  let outRecords = (records || []).map((rec) => {
    const r = {};
    plan.forEach(([from, to]) => {
      r[to] = rec[from] === undefined || rec[from] === null ? "" : rec[from];
    });
    return r;
  });
  // First + last name (and no full-name column): one "Contact name" column.
  const first = byKey.first_name;
  const last = byKey.last_name;
  if (outHeaders.includes(first) && outHeaders.includes(last) && !outHeaders.includes(byKey.contact)) {
    const at = outHeaders.indexOf(first);
    const headersOut = outHeaders.filter((h) => h !== first && h !== last);
    headersOut.splice(Math.min(at, headersOut.length), 0, byKey.contact);
    outRecords = outRecords.map((r) => {
      const { [first]: f, [last]: l, ...rest } = r;
      return { ...rest, [byKey.contact]: [f, l].map((x) => String(x || "").trim()).filter(Boolean).join(" ") };
    });
    return { headers: headersOut, records: outRecords };
  }
  return { headers: outHeaders, records: outRecords };
}

// Problems worth showing before importing.
export function mappingWarnings(mapping, records) {
  const vals = Object.values(mapping);
  const warn = [];
  if (!vals.includes("phone")) warn.push("No column is matched to Phone, so these contacts cannot be called yet.");
  if (!vals.some((v) => ["company", "contact", "first_name", "last_name"].includes(v))) {
    warn.push("No company or contact name column is matched.");
  }
  const counts = {};
  vals.forEach((v) => { if (v !== KEEP && v !== SKIP) counts[v] = (counts[v] || 0) + 1; });
  Object.entries(counts).forEach(([k, n]) => {
    if (n > 1) warn.push(`${n} columns are matched to the same field (${k}); only the first is used.`);
  });
  const phoneCol = Object.keys(mapping).find((h) => mapping[h] === "phone");
  if (phoneCol) {
    const empty = (records || []).filter((r) => !String(r[phoneCol] || "").replace(/\D/g, "")).length;
    if (empty) warn.push(`${empty} of ${(records || []).length} rows have no phone number.`);
  }
  return warn;
}

const STORE = "outreach_import_mappings";

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
