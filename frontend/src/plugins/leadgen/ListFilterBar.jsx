import React from "react";
import { C, FONT_BODY } from "../../tokens";
import { TPS_NOTE, tpsMarks } from "./listFilters";

const text = { fontFamily: FONT_BODY };

// "TPS checked N": narrows to rows whose phone number has a TPS/CTPS result. Same pill shape as the Google data pill.
export function TpsPill({ count, on, onClick }) {
  return (
    <button type="button" aria-pressed={on} title="Show only contacts with at least one phone number checked against the TPS and CTPS registers (any number on the record)" onClick={onClick}
      style={{ ...text, minHeight: 36, padding: "0 14px", borderRadius: 999, border: `1px solid ${on ? C.chipEmerald : C.chipEmeraldLine}`, background: on ? C.chipEmerald : C.successBg, color: on ? C.onAccent : C.chipEmerald, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
      TPS checked {count.toLocaleString()}
    </button>
  );
}

// "Data from": one source at a time, each with how many rows it gave. Renders nothing when no source is recorded.
export function SourceSelect({ options, value, onChange }) {
  if (!options.length) return null;
  const active = options.some((o) => o.key === value) ? value : "";
  return (
    <select className="ui-input" aria-label="Data from" title="Show only rows whose phone, email or website came from one source" value={active} onChange={(e) => onChange(e.target.value)} style={{ height: 36, width: "auto", maxWidth: "100%" }}>
      <option value="">Data from</option>
      {options.map((o) => <option key={o.key} value={o.key}>{o.label} ({o.count.toLocaleString()})</option>)}
    </select>
  );
}

// "Came from": how the companies joined the account (Find Leads, your file, a web form...), one at a time, with how many each gave.
// Renders nothing when every row came the same way.
export function OriginSelect({ options, value, onChange }) {
  if (options.length < 2) return null;
  const active = options.some((o) => o.key === value) ? value : "";
  return (
    <select className="ui-input" aria-label="Came from" title="Show only companies that joined your account one way" value={active} onChange={(e) => onChange(e.target.value)} style={{ height: 36, width: "auto", maxWidth: "100%" }}>
      <option value="">Came from</option>
      {options.map((o) => <option key={o.key} value={o.key}>{o.label} ({o.count.toLocaleString()})</option>)}
    </select>
  );
}

export function TpsNote() {
  return <div role="status" style={{ ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 }}>{TPS_NOTE}</div>;
}

// A small text chip after a phone number. Words, not colour alone; nothing when the number was not screened.
export function TpsChip({ screening }) {
  const marks = tpsMarks(screening);
  if (!marks.length) return null;
  return marks.map((m) => (
    <span key={m.text} title={m.title} style={{ ...text, display: "inline-block", marginLeft: 6, padding: "0 6px", borderRadius: 4, border: `1px solid ${C.chipEmeraldLine}`, background: C.successBg, color: C.chipEmeraldInk, fontSize: 11.5, fontWeight: 600, lineHeight: "18px", verticalAlign: "middle" }}>{m.text}</span>
  ));
}
