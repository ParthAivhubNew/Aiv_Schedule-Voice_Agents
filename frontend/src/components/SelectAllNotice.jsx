import React from "react";
import { C, FONT_BODY } from "../tokens";
import { selectionLine } from "./bulkSelect";

const link = { fontFamily: FONT_BODY, background: "none", border: "none", padding: 0, color: "var(--ui-accent)", cursor: "pointer", fontSize: 13, textDecoration: "underline" };

// The line above a table once rows are ticked: "25 selected out of 1,234. Select all 1,234 · Clear".
export function SelectAllNotice({ sel, pageIds, total, capped = false, reach, unit, busy = false, onSelectAll }) {
  const line = selectionLine({ count: sel.count, everything: sel.everything, ids: sel.ids, pageIds, total, capped, reach, unit });
  if (!line) return null;
  return (
    <div role="status" style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.textInk, padding: "6px 12px", background: C.paperSoft, borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <span>{line.text}</span>
      {line.offer ? <button type="button" style={link} disabled={busy} onClick={onSelectAll}>{busy ? "Selecting…" : line.offer}</button> : null}
      <button type="button" style={link} onClick={sel.clear}>Clear</button>
    </div>
  );
}
