import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { C } from "../tokens";
import { btn, heading } from "./ui";

export const LOG_PAGE_SIZE = 10;

// The "when was it asked" log: folded away until opened, and shown ten calls at a time.
export function CallLog({ title, children, total = 0, offset = 0, onPage }) {
  const [open, setOpen] = useState(false);
  const from = total ? offset + 1 : 0;
  const to = Math.min(total, offset + LOG_PAGE_SIZE);
  return (
    <div style={{ marginTop: 26 }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        style={{ ...heading, margin: "0 0 6px", display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, cursor: "pointer" }}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />} {title}
        <span style={{ fontSize: 12, fontWeight: 400, color: C.slate }}>{total ? `${total.toLocaleString()} calls` : ""}</span>
      </button>
      {open ? (
        <div>
          {children}
          {total > LOG_PAGE_SIZE ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: C.slate }}>
              <span>Showing {from}-{to} of {total.toLocaleString()}</span>
              <span style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
                <button type="button" style={btn(false, offset === 0)} disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - LOG_PAGE_SIZE))}>Previous</button>
                <button type="button" style={btn(false, to >= total)} disabled={to >= total} onClick={() => onPage(offset + LOG_PAGE_SIZE)}>Next</button>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
