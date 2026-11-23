import React from "react";
import { ShieldAlert } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { noticeLines } from "./accessLogic";

// A status line for results that were narrowed or refused by the account's data access. The icon and the words carry it, not colour.
export function AccessNotice({ message, style }) {
  const lines = noticeLines(message);
  return (
    <div role="status" aria-live="polite">
      {lines.length ? (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 12px", border: `1px solid ${C.border}`, borderRadius: 10, background: "#FFFBEB", fontFamily: FONT_BODY, fontSize: 13, lineHeight: 1.5, color: C.textInk, ...style }}>
          <ShieldAlert size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{lines.map((l, i) => <span key={i} style={{ display: "block" }}>{l}</span>)}</span>
        </div>
      ) : null}
    </div>
  );
}
