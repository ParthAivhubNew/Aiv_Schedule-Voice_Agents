import React from "react";
import { MapPin } from "lucide-react";
import { C } from "../../tokens";
import { Tooltip } from "../../app/ui";

export const GOOGLE_NOTE = "From Google. You can see and use it in Outreach, but it can't be downloaded.";
export const ENRICHMENT_NOTE = "From our enrichment data. You can see and use it in Outreach, but it can't be downloaded.";

const isGoogle = (source) => /google/i.test(String(source || ""));


// A small pin beside a phone, website or email that can be used here but not downloaded. The shared Tooltip shows the note.
export function SourceMark({ note, source = "", size = 13 }) {
  const google = isGoogle(source);
  const text = note || (google ? GOOGLE_NOTE : ENRICHMENT_NOTE);
  return (
    <span style={{ display: "inline-flex", verticalAlign: "middle", marginLeft: 4 }}>
      <Tooltip trigger={<MapPin size={size} aria-hidden="true" />} label={google ? "From Google" : "Restricted source"} width={240}>{text}</Tooltip>
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
  const sources = a?.field_sources || {};
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
      {rows.map((r) => <div key={r.field} style={{ whiteSpace: "nowrap" }}><span style={{ color: C.slate }}>{r.field}:</span> {r.label}</div>)}
    </div>
  );
}

// The mark for one field of a payload, or nothing. flags: the payload's `restricted`, notes: its `restricted_note` (accounts only), sources: its `field_sources`.
export function FieldMark({ flags, notes, sources, field }) {
  if (!flags || !(flags[field] || flags[`web_${field}`])) return null;
  return <SourceMark note={notes?.[field] || ""} source={sources?.[field] || ""} />;
}
