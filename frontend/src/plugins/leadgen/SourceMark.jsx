import React from "react";
import { MapPin } from "lucide-react";
import { C } from "../../tokens";
import { Tooltip } from "../../app/ui";

export const GOOGLE_NOTE = "From Google. You can see and use it in Outreach, but it can't be downloaded.";
export const ENRICHMENT_NOTE = "From our enrichment data. You can see and use it in Outreach, but it can't be downloaded.";

const isGoogle = (source) => /google/i.test(String(source || ""));

// The Google "G", so people can see at a glance which details came from Google.
export function GoogleG({ size = 14, title = "Google" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={title} style={{ display: "block", flexShrink: 0 }}>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

// The source of each phone, email and website. A value the saved record does not tag but the server flagged as "From Google" counts as Google,
// so older loaded data is shown honestly instead of as a register detail or as nothing.
export function effectiveSources(a) {
  const out = { ...(a?.field_sources || {}) };
  for (const f of ["phone", "email", "website"]) {
    if (!out[f] && a?.restricted?.[f] && /^From Google/i.test(a?.restricted_note?.[f] || "")) out[f] = "google_places";
  }
  return out;
}


// A small pin beside a phone, website or email that can be used here but not downloaded. The shared Tooltip shows the note.
export function SourceMark({ note, source = "", size = 13 }) {
  const google = isGoogle(source);
  const text = note || (google ? GOOGLE_NOTE : ENRICHMENT_NOTE);
  return (
    <span style={{ display: "inline-flex", verticalAlign: "middle", marginLeft: 4 }}>
      <Tooltip trigger={google ? <GoogleG size={size} title="From Google" /> : <MapPin size={size} aria-hidden="true" />} label={google ? "From Google" : "Restricted source"} width={240}>{text}</Tooltip>
    </span>
  );
}

// Plain names for where a value came from. Clients never see a supplier's name, so enrichment is just "Enrichment data".
export const SOURCE_LABELS = {
  website: "Company website", register: "Official register", user: "You", import: "Your file",
  web: "Web search", check: "Number check", google_places: "Google", apollo: "Enrichment data",
  licensed: "Licensed business data", scrape: "Web scrape", research: "Research", record: "Company record",
};
const FIELD_NAMES = { phone: "Phone", email: "Email", website: "Website" };

// True when any of the company's phone, email or website came from Google. Reads the saved source first, then the tooltip the server wrote.
export function hasGoogleData(a) {
  const sources = effectiveSources(a);
  const notes = a?.restricted_note || {};
  return Object.keys(FIELD_NAMES).some((f) => isGoogle(sources[f]) || (a?.restricted?.[f] && /^From Google/i.test(notes[f] || "")));
}

// One line per field the company holds a source for, e.g. [{field: "Phone", label: "Company website"}]. Empty when nothing is recorded.
export function sourceRows(sources) {
  return Object.keys(FIELD_NAMES)
    .filter((f) => sources && sources[f])
    .map((f) => ({ field: FIELD_NAMES[f], label: SOURCE_LABELS[String(sources[f]).split(":")[0]] || "Other source" }));
}

// The "Data from" cell: which place each phone, email and website came from.
export function SourceList({ sources }) {
  const rows = sourceRows(sources);
  if (!rows.length) return <span style={{ color: C.slateLight }} title="No source is recorded for this company's details yet">—</span>;
  return (
    <div style={{ display: "grid", gap: 2, fontSize: 12, lineHeight: 1.35 }}>
      {rows.map((r) => <div key={r.field} style={{ whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}><span style={{ color: C.slate }}>{r.field}:</span> {r.label === "Google" ? <GoogleG size={12} /> : null}{r.label}</div>)}
    </div>
  );
}

// The mark for one field of a payload, or nothing. flags: the payload's `restricted`, notes: its `restricted_note` (accounts only), sources: its `field_sources`.
export function FieldMark({ flags, notes, sources, field }) {
  if (!flags || !(flags[field] || flags[`web_${field}`])) return null;
  return <SourceMark note={notes?.[field] || ""} source={sources?.[field] || ""} />;
}
