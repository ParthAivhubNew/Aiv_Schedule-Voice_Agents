import React from "react";
import { C, FONT_DISPLAY } from "../tokens";
import { adminApi } from "./adminApi";
import { AivhubToggle, Note, PageTitle, Pill, card, fmt, heading, useLoad } from "./ui";

const TILES = [
  ["clients", "Clients"], ["suspended", "Suspended"], ["users", "Active users"], ["numbers", "Phone numbers"],
  ["liveCalls", "Live calls"], ["callsLast30d", "Calls (30 days)"], ["creditsUsed30d", "Credits used (30 days)"], ["payments30d", "Payments (30 days)"],
];

const SERVICES = [
  ["telnyx", "Telnyx account"], ["telnyxWebhookKey", "Telnyx webhook key"], ["stripe", "Stripe"], ["stripeWebhook", "Stripe webhook secret"],
  ["mail", "System email"], ["google", "Google sign-in"], ["signup", "Self sign-up"],
];

export function Dashboard({ go }) {
  const [includeAivhub, setIncludeAivhub] = React.useState(() => {
    try {
      const saved = localStorage.getItem("admin_include_aivhub");
      return saved !== null ? saved === "true" : true;
    } catch (_) {
      return true;
    }
  });

  const onToggle = (val) => {
    setIncludeAivhub(val);
    try {
      localStorage.setItem("admin_include_aivhub", String(val));
    } catch (_) {}
  };

  const loadDashboard = React.useCallback(() => adminApi.dashboard(includeAivhub), [includeAivhub]);
  const [d, err] = useLoad(loadDashboard, [loadDashboard]);
  const [p] = useLoad(adminApi.platform);

  return (
    <>
      <PageTitle
        title="Dashboard"
        sub={includeAivhub ? "Overall platform & client metrics (including Aivhub)." : "Client organisations only (excluding Aivhub)."}
        right={<AivhubToggle value={includeAivhub} onChange={onToggle} />}
      />
      <Note error>{err}</Note>
      {d && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          {TILES.map(([k, label]) => (
            <div key={k} style={card}>
              <div style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>{label}</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, color: k === "suspended" && d[k] ? C.red : C.textInk }}>{fmt(d[k])}</div>
            </div>
          ))}
        </div>
      )}
      {d && (d.pendingVerifications > 0 || d.whatsappRequests > 0) && (
        <button type="button" onClick={() => go("queue")} style={{ ...card, marginTop: 12, width: "100%", textAlign: "left", cursor: "pointer", borderColor: C.amber, background: C.amberSoft }}>
          <b>Waiting on us:</b> {d.pendingVerifications} business verification{d.pendingVerifications === 1 ? "" : "s"}, {d.whatsappRequests} WhatsApp request{d.whatsappRequests === 1 ? "" : "s"}. Open the queue →
        </button>
      )}
      <div style={heading}>Platform services</div>
      {p && (
        <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: 10 }}>
          {SERVICES.map(([k, label]) => (
            <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
              {label} <Pill tone={p[k] ? "green" : "amber"}>{p[k] ? "On" : "Not set"}</Pill>
            </span>
          ))}
          {p.stripe && p.stripeTestMode && <Pill tone="amber">Stripe test mode</Pill>}
          {p.telnyxMode && <span style={{ fontSize: 12.5, color: C.slate }}>Telnyx mode: {p.telnyxMode}</span>}
        </div>
      )}
    </>
  );
}
