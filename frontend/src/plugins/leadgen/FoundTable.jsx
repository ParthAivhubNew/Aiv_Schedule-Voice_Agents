import React from "react";
import { C, FONT_BODY } from "../../tokens";
import { foundHeading } from "./foundText";
import { domainOf } from "./AccountsViews";

const text = { fontFamily: FONT_BODY, fontSize: 13, color: C.ink };
const muted = { ...text, color: C.slate };
const th = { ...muted, fontSize: 11.5, fontWeight: 600, textAlign: "left", padding: "4px 10px 4px 0", whiteSpace: "nowrap" };
const td = { ...text, padding: "6px 10px 6px 0", borderTop: "1px solid var(--ui-line-soft,#EEF0F5)", verticalAlign: "top" };

// The companies a search listed, one row each, exactly as many as were listed. Saving them saves these rows.
export function FoundTable({ found, onShowAll }) {
  const rows = found.top || [];
  const { title, note } = foundHeading(found);
  return (
    <div className="as-card">
      <div style={{ ...text, fontWeight: 600 }}>{title}</div>
      {note ? <div style={{ ...muted, fontSize: 12.5 }}>{note}</div> : null}
      {rows.length ? (
        <div style={{ overflowX: "auto", marginTop: 6 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 420 }}>
            <thead><tr><th style={th}>Company</th><th style={th}>Town</th><th style={th}>Website</th><th style={th}>Phone</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={{ ...td, fontWeight: 500, overflowWrap: "anywhere" }}>{c.name}</td>
                  <td style={td}>{c.region || "—"}{c.postcode ? <span style={{ ...muted, fontSize: 12 }}> {c.postcode}</span> : null}</td>
                  <td style={{ ...td, overflowWrap: "anywhere" }}>{domainOf(c.website || c.web_website || "") || <span style={muted}>—</span>}</td>
                  <td style={td}>{c.phone || c.web_phone || <span style={muted}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {found.total > rows.length ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ marginTop: 8 }} onClick={onShowAll}>Open all {found.total.toLocaleString()}{found.capped ? "+" : ""} in Find Leads</button> : null}
    </div>
  );
}
