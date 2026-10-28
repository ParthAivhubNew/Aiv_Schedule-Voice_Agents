// Standard columns for company import files, and matching a file's own columns to them.
// Same shape as the Voice plugin's importMapping.js (./voice/calling/importMapping.js), but for
// the fields a saved account actually has. A column that is none of these can be kept as the user's
// own column: its mapping is "custom:<name>", and its values are saved under that name.

export const STANDARD_FIELDS = [
  { key: "name", label: "Company name", important: true },
  { key: "website", label: "Website" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "contact_name", label: "Contact (full name)" },
  { key: "contact_first", label: "Contact first name" },
  { key: "contact_last", label: "Contact last name" },
  { key: "contact_title", label: "Contact's job title" },
  { key: "industry", label: "Industry" },
  { key: "region", label: "Town or region" },
  { key: "notes", label: "Notes" },
];

export const SKIP = "__skip__"; // do not import
export const CUSTOM = "custom:"; // "custom:UK 03 Sic Desc." = keep this column, under that name
export const MAX_CUSTOM = 30; // the server keeps at most this many own columns per company
export const isCustom = (target) => typeof target === "string" && target.startsWith(CUSTOM);
export const customName = (target) => (isCustom(target) ? target.slice(CUSTOM.length).replace(/\s+/g, " ").trim().slice(0, 40) : "");

// Fields are claimed in this order, and for each one the patterns are tried best-first, so the best column wins
// whatever order the file has them in (e.g. "Town" beats "Locality", and "Sic Desc." beats "Sic Code").
const GUESSES = [
  ["website", [/web\s*address|website|web\s*site|homepage|url/i, /domain/i]],
  ["email", [/e-?mail/i]],
  ["phone", [/^(company |business |main |office )?(telephone|phone|mobile|tel)(\s*(no|number))?\.?$/i, /telephone|phone|mobile|tel|cell|contact\s*number|^number$/i]],
  ["contact_first", [/fore?name|first\s*name|given\s*name/i]],
  ["contact_last", [/surname|last\s*name|family\s*name/i]],
  ["contact_title", [/job.?title|position|designation|^role$|contact.?role/i, /^(contact\s*)?title$/i]],
  ["name", [/^(business|company|trading|organi[sz]ation|account|firm)(\s*name)?$/i, /business\s*name|company(?!.*(phone|tel|e-?mail|number|web|url|address))|trading|organi[sz]ation|account\s*name|^name$/i]],
  ["contact_name", [/contact\s*name|full.?name|contact person|^contact$|decision\s*maker|^owner/i]],
  ["industry", [/(sic|sector|industry|category|business\s*type)[^a-z]*(desc|name|type)?(?!.*(code|no|number))/i, /^(industry|sector|category|type)$/i]],
  ["region", [/^(town|city)$/i, /town|city/i, /locality/i, /^(county|region|area)$/i, /county|region/i]],
  ["notes", [/note|comment|description/i]],
];

// A title column holding "Mr", "Mrs", "Dr"... is a salutation, not a job title: it is kept as the user's own column.
const HONORIFIC = /^(mr|mrs|ms|miss|mx|dr|prof|sir|dame|lord|lady|rev|master)\.?$/i;
const mostlyHonorifics = (header, records) => {
  const vals = (records || []).map((r) => String(r?.[header] ?? "").trim()).filter(Boolean);
  return vals.length > 0 && vals.filter((v) => HONORIFIC.test(v)).length / vals.length >= 0.8;
};

// A row with no company but a person's name is saved as that person, under their own name, so call lists of contacts import too.
export function withPeople(rows) {
  return (rows || []).map((r) => (!r.name && !r.website && r.contact_name ? { ...r, name: r.contact_name } : r));
}

export function signature(headers) {
  return (headers || []).map((h) => String(h).trim().toLowerCase()).sort().join("|");
}

// Columns that match a standard field are matched to it; every other column is kept as the user's own
// column under its own name, so nothing in their file is lost by default (they can still pick Don't import).
export function guessMapping(headers, records = []) {
  const out = {};
  const claimed = new Set();
  const list = (headers || []).map((h) => ({ h, name: String(h || "").trim() }));
  GUESSES.forEach(([key, patterns]) => {
    for (const re of patterns) {
      const hit = list.find(({ h, name }) => !claimed.has(h) && re.test(name) && !(key === "contact_title" && mostlyHonorifics(h, records)));
      if (hit) {
        out[hit.h] = key;
        claimed.add(hit.h);
        return;
      }
    }
  });
  const taken = new Set(STANDARD_FIELDS.flatMap((f) => [f.key, f.label.toLowerCase()]));
  const names = new Set();
  let own = 0;
  list.forEach(({ h, name }) => {
    if (claimed.has(h)) return;
    let keep = name.replace(/\s+/g, " ").slice(0, 40).trim();
    if (keep && taken.has(keep.toLowerCase())) keep = `${keep.slice(0, 32)} (file)`;
    if (!keep || names.has(keep.toLowerCase()) || own >= MAX_CUSTOM) {
      out[h] = SKIP;
      return;
    }
    names.add(keep.toLowerCase());
    own += 1;
    out[h] = CUSTOM + keep;
  });
  return out;
}

// Excel drops the leading zero of a UK number stored as a number ("7702167658"); put it back so it dials and matches.
export function tidyPhone(v) {
  const t = String(v || "").trim();
  return /^[1-37-8]\d{9}$/.test(t) ? `0${t}` : t;
}

// Returns flat {name, website, phone, ...} objects -- each record has only the standard keys,
// filled from whichever file column was matched to them. If two columns are matched to the
// same field, the first one (in header order) wins.
export function applyMapping(headers, records, mapping) {
  const plan = [];
  const used = new Set();
  (headers || []).forEach((h) => {
    let target = mapping[h] || SKIP;
    if (isCustom(target)) target = customName(target) ? CUSTOM + customName(target) : SKIP;
    if (target === SKIP || used.has(target)) return;
    if (isCustom(target) && plan.filter(([, t]) => isCustom(t)).length >= MAX_CUSTOM) return;
    used.add(target);
    plan.push([h, target]);
  });
  const out = (records || []).map((rec) => {
    const r = {};
    plan.forEach(([from, to]) => {
      const value = String(rec[from] ?? "").trim();
      if (isCustom(to)) {
        if (!r.custom) r.custom = {};
        r.custom[customName(to)] = value;
      } else {
        r[to] = value;
      }
    });
    if (!r.contact_name && (r.contact_first || r.contact_last)) r.contact_name = [r.contact_first, r.contact_last].filter(Boolean).join(" ");
    delete r.contact_first;
    delete r.contact_last;
    if (r.phone) r.phone = tidyPhone(r.phone);
    return r;
  });
  return out;
}

// Problems worth showing before importing.
export function mappingWarnings(mapping, records) {
  const vals = Object.values(mapping);
  const warn = [];
  if (vals.includes("contact_name") && (vals.includes("contact_first") || vals.includes("contact_last"))) {
    warn.push("Contact (full name) is filled first; first and last name are only used for rows where it is empty.");
  }
  const hasPerson = vals.includes("contact_name") || vals.includes("contact_first") || vals.includes("contact_last");
  if (!vals.includes("name") && !vals.includes("website") && !hasPerson) {
    warn.push("No column is matched to Company name, Website or a contact's name, so these rows have nothing to save them by.");
  }
  if (!vals.includes("name") && !vals.includes("website") && hasPerson) {
    warn.push("There is no company column, so each row is saved as a person, under their own name.");
  }
  const counts = {};
  vals.forEach((v) => { if (v !== SKIP) counts[isCustom(v) ? CUSTOM + customName(v) : v] = (counts[isCustom(v) ? CUSTOM + customName(v) : v] || 0) + 1; });
  Object.entries(counts).forEach(([k, n]) => {
    if (n > 1) {
      const label = isCustom(k) ? `your column "${customName(k)}"` : (STANDARD_FIELDS.find((f) => f.key === k) || {}).label || k;
      warn.push(`${n} columns are matched to ${label}; only the first is used.`);
    }
  });
  const own = vals.filter(isCustom);
  if (own.some((v) => !customName(v))) warn.push("A column kept as your own needs a name; without one it is left out.");
  const taken = new Set(STANDARD_FIELDS.flatMap((f) => [f.key, f.label.toLowerCase()]));
  own.forEach((v) => { if (taken.has(customName(v).toLowerCase())) warn.push(`"${customName(v)}" is already one of our fields. Choose it from the list, or give your column another name.`); });
  if (new Set(own.map(customName).filter(Boolean)).size > MAX_CUSTOM) warn.push(`Only the first ${MAX_CUSTOM} of your own columns are kept.`);
  return warn;
}

const STORE = "leadgen_import_mappings_v3"; // v3: smarter guesses (names, towns, sector text), so older saved matches are not reused

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
