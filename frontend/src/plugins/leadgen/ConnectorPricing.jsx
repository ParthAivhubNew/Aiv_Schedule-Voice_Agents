import React from "react";
import { ExternalLink, KeyRound, Tag } from "lucide-react";
import { CONNECTOR_PRICING } from "./connectorPrices";
import { C } from "../../tokens";

const FONT = "Inter, system-ui, sans-serif";
const INK = C.uiInk;
const SLATE = "#64748B";
const BORDER = C.border;
const TEAL = "#0C8C7D";

const linkBtn = (primary) => ({
  fontFamily: FONT,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 40,
  padding: "0 14px",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  textDecoration: "none",
  border: `1px solid ${primary ? TEAL : BORDER}`,
  background: primary ? TEAL : "#FFFFFF",
  color: primary ? "#FFFFFF" : INK,
});

// Where to get the connector's API access, where to see its price list, and what it costs. Figures come from each vendor's own pages.
export function ConnectorPricing({ id }) {
  const p = CONNECTOR_PRICING[id];
  if (!p) return null;
  return (
    <section aria-label="Connect and pricing" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16, fontFamily: FONT }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: SLATE }}>Connect</div>
        <a href={p.apiUrl} target="_blank" rel="noopener noreferrer" style={linkBtn(true)}>
          <KeyRound size={15} aria-hidden="true" /> Get API access <ExternalLink size={12} aria-hidden="true" />
        </a>
        <a href={p.pricingUrl} target="_blank" rel="noopener noreferrer" style={linkBtn(false)}>
          <Tag size={15} aria-hidden="true" /> Pricing page <ExternalLink size={12} aria-hidden="true" />
        </a>
        {p.free ? (
          <span style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: C.successSoft, color: C.green }}>Free tier</span>
        ) : null}
      </div>

      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, overflow: "hidden", background: "#FFFFFF" }}>
        <div style={{ padding: "10px 14px", background: C.neutralBg, borderBottom: `1px solid ${BORDER}`, fontSize: 13, fontWeight: 700, color: INK }}>Estimated cost</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: SLATE, textAlign: "left" }}>
              <th style={{ padding: "8px 14px", fontWeight: 600 }}>Plan</th>
              <th style={{ padding: "8px 8px", fontWeight: 600 }}>Price</th>
              <th style={{ padding: "8px 14px", fontWeight: 600 }}>Note</th>
            </tr>
          </thead>
          <tbody>
            {p.pricing.map((r, i) => (
              <tr key={r.plan + i} style={{ borderTop: `1px solid ${BORDER}` }}>
                <td style={{ padding: "9px 14px", fontWeight: 600, color: INK }}>{r.plan}</td>
                <td style={{ padding: "9px 8px", fontWeight: 700, color: INK, whiteSpace: "nowrap" }}>{r.price}</td>
                <td style={{ padding: "9px 14px", color: SLATE }}>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: "8px 14px", borderTop: `1px solid ${BORDER}`, fontSize: 11.5, color: SLATE }}>Vendor prices, {p.asOf}. Check before you buy.</div>
      </div>
    </section>
  );
}
