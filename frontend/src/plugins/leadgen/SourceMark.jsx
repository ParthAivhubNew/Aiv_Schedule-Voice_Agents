import React, { useId, useState } from "react";
import { MapPin } from "lucide-react";
import { C } from "../../tokens";

export const GOOGLE_NOTE = "From Google. You can see and use it in Outreach, but it can't be downloaded.";
export const ENRICHMENT_NOTE = "From our enrichment data. You can see and use it in Outreach, but it can't be downloaded.";

const isGoogle = (source) => /google/i.test(String(source || ""));

// Clipped off screen, still read aloud: the label must not depend on the icon or its colour.
const hidden = { position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };

// A small pin beside a phone, website or email that can be used here but not downloaded.
export function SourceMark({ note, source = "", size = 13 }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const google = isGoogle(source);
  const text = note || (google ? GOOGLE_NOTE : ENRICHMENT_NOTE);
  return (
    <span style={{ position: "relative", display: "inline-flex", verticalAlign: "middle", marginLeft: 4 }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" title={text} aria-describedby={id} aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 24, minHeight: 24, padding: 0, border: 0, background: "transparent", color: C.slate, cursor: "help", borderRadius: 6 }}>
        <MapPin size={size} aria-hidden="true" />
        <span style={hidden}>{google ? "From Google" : "Restricted source"}</span>
      </button>
      <span id={id} role="tooltip" style={open ? { position: "absolute", zIndex: 30, left: 0, top: "100%", width: 230, padding: "8px 10px", borderRadius: 8, background: C.ink, color: "#fff", fontSize: 12, lineHeight: 1.4, whiteSpace: "normal", fontWeight: 400 } : hidden}>{text}</span>
    </span>
  );
}

// Plain names for where a value came from. Clients never see a supplier's name, so enrichment is just "Enrichment data".
export const SOURCE_LABELS = {
  website: "Company website", register: "Official register", user: "You", import: "Your file",
  web: "Web search", check: "Number check", google_places: "Google", apollo: "Enrichment data",
};
const FIELD_NAMES = { phone: "Phone", email: "Email", website: "Website" };

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
