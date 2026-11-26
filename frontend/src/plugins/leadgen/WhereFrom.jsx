import React from "react";
import { C, FONT_BODY } from "../../tokens";
import { shortDate } from "./companyLogic";
import { originWords } from "./originLabels";
import { SOURCE_LABELS } from "./SourceMark";

// "Where this came from" on the company page (plan 10, Phase 2): how the company joined the account, where each of its website, phone
// and email came from, and the registers it appears on. Everything comes from the server: the saved company's origin and recorded
// sources, the company record's own sources (the contact labels), and its registers. Supplier names are never shown.

const text = { fontFamily: FONT_BODY };
const NAMES = { website: "Website", phone: "Phone", email: "Email" };

// One line per detail: the saved company's recorded source first, else what the company record says about its own value.
export function detailSources(c) {
  const mine = c?.mine || null;
  return ["website", "phone", "email"].map((kind) => {
    if (mine && String(mine[kind] || "").trim()) {
      const key = String((mine.field_sources || {})[kind] || "").split(":")[0];
      return { kind, name: NAMES[kind], label: SOURCE_LABELS[key] || "Not recorded" };
    }
    const own = c?.contact?.[kind];
    if (own?.value) return { kind, name: NAMES[kind], label: own.label };
    return null;
  }).filter(Boolean);
}

export function WhereFrom({ c }) {
  const mine = c?.mine || null;
  const rows = detailSources(c);
  const registers = c?.registers || [];
  if (!mine && !rows.length && !registers.length) return null;
  const detail = mine?.source_detail || {};
  const line = (label, children, key) => (
    <div key={key || label} style={{ display: "flex", gap: 10, fontSize: 13, lineHeight: 1.45 }}>
      <span style={{ width: 96, flexShrink: 0, color: C.slate }}>{label}</span>
      <span style={{ minWidth: 0, overflowWrap: "anywhere", color: C.textInk }}>{children}</span>
    </div>
  );
  return (
    <section aria-label="Where this came from" style={{ ...text, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, display: "grid", gap: 8, padding: 14 }}>
      <strong style={{ fontSize: 13.5 }}>Where this came from</strong>
      {mine ? line("Joined", (
        <>
          {originWords(mine.source)}{mine.added ? ` · ${shortDate(mine.added)}` : ""}
          {detail.text ? <span style={{ display: "block", color: C.slate, fontSize: 12 }}>{detail.url ? <a href={detail.url} target="_blank" rel="noreferrer" style={{ color: C.cobalt }}>{detail.text}</a> : detail.text}</span> : null}
        </>
      )) : null}
      {rows.map((r) => line(r.name, r.label, r.kind))}
      {registers.length ? line("Registers", (
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {registers.map((r) => <span key={r} style={{ fontSize: 12, fontWeight: 600, padding: "2px 9px", borderRadius: 999, background: C.successBg, color: C.successInk }}>{r}</span>)}
        </span>
      )) : null}
    </section>
  );
}
