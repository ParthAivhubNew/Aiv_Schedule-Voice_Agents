import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, Coins, CreditCard, ExternalLink, Mail, PhoneCall, Search } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { api } from "../api/apiClient";
import { APPS } from "../hub/apps";

const input = { padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY, background: "#fff", boxSizing: "border-box" };
export const btn = (primary, disabled) => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: 9, cursor: disabled ? "not-allowed" : "pointer",
  border: primary ? "none" : `1px solid ${C.border}`, background: primary ? C.ink : "#fff", color: primary ? "#fff" : C.textInk,
  fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, opacity: disabled ? 0.55 : 1,
});
export const heading = { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14.5, color: C.textInk, margin: "20px 0 10px" };
export const fmt = (n) => Number(n || 0).toLocaleString();
export const money = (cents, currency) => new Intl.NumberFormat(undefined, { style: "currency", currency: (currency || "usd").toUpperCase() }).format(Number(cents || 0) / 100);
export const day = (iso) => (iso ? new Date(iso + (iso.endsWith("Z") ? "" : "Z")).toLocaleDateString([], { day: "numeric", month: "short" }) : "");

const WALLET_ICON = { voice: PhoneCall, leadgen: Search, email: Mail, scheduler: CalendarDays };
export const WALLET_COLOUR = { voice: C.cobalt, leadgen: "#8B5CF6", email: "#F59E0B", scheduler: C.teal };

export function WalletCard({ w }) {
  const Icon = WALLET_ICON[w.key] || Coins;
  const size = w.batches.reduce((a, b) => a + b.amount, 0) || 1;
  const pct = Math.max(0, Math.min(100, Math.round((Math.max(w.balance, 0) / size) * 100)));
  const colour = w.empty ? C.red : w.low ? "#D97706" : WALLET_COLOUR[w.key];
  return (
    <div style={{ border: `1px solid ${w.empty ? "#F0C4B8" : C.border}`, borderRadius: 14, padding: "14px 16px", background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.slate, fontWeight: 600 }}>
        <Icon size={15} color={WALLET_COLOUR[w.key]} /> {w.label}
      </div>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 26, color: colour, margin: "4px 0 6px" }}>{fmt(w.balance)}</div>
      <div style={{ height: 5, borderRadius: 3, background: C.paperSoft, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: colour, transition: "width .4s" }} />
      </div>
      <div style={{ fontSize: 11.5, color: w.empty ? C.red : C.slate, marginTop: 6, minHeight: 16 }}>
        {w.empty ? "Paused: out of credits" : w.low ? "Running low (20% or less)" : w.nextExpiry ? `${fmt(w.nextExpiry.amount)} expire ${day(w.nextExpiry.at)}` : "No expiry"}
      </div>
    </div>
  );
}

// The organisation's wallets per app, each app's plan (bought on that app's Subscription page), and history.
// OutReach staff manage plans, credits and the rate card in the admin portal (/admin).
export function CreditsTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api.getBillingOverview());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !data) return <div style={{ color: C.red, fontSize: 12.5 }}>{error}</div>;
  if (!data) return <div style={{ color: C.slate, fontSize: 13 }}>Loading…</div>;

  // Plugins already on a plan change it on their Subscription page; the others can still be bought.
  const subscribed = ["active", "past_due", "trialing"].includes(data.subscription.status) ? data.subscription.plans : {};

  const portal = async () => {
    setBusy("portal");
    try {
      const { url } = await api.openBillingPortal();
      window.location.assign(url);
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  };

  return (
    <div style={{ fontFamily: FONT_BODY }}>
      {data.testMode && <div style={{ fontSize: 12, fontWeight: 700, color: "#7A5200", background: "#FFF3D6", padding: "6px 10px", borderRadius: 8, marginBottom: 10 }}>Stripe test mode: no real money moves.</div>}
      {data.subscription.status === "past_due" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: C.red, background: C.redSoft, padding: "8px 12px", borderRadius: 10, marginBottom: 10 }}>
          <AlertTriangle size={15} /> Your last payment failed. Update your card in Manage billing.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        {data.wallets.map((w) => <WalletCard key={w.key} w={w} />)}
      </div>
      <div style={{ fontSize: 12, color: C.slate, marginTop: 8 }}>
        {data.enforce ? "Each app pauses when its own credits reach zero; the others keep working." : "Tracking only: nothing is paused when credits run out."}
        {data.subscription.renewsAt && ` Plan renews ${day(data.subscription.renewsAt)}.`}
      </div>

      <div style={{ ...heading, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Plans</span>
        {data.subscription.hasCustomer && (
          <button type="button" style={btn(false, busy === "portal")} onClick={portal} disabled={busy === "portal"}>
            <CreditCard size={13} /> Manage billing <ExternalLink size={11} />
          </button>
        )}
      </div>
      {!data.stripeReady ? (
        <div style={{ fontSize: 13, color: C.slate, background: C.paperSoft, padding: "10px 12px", borderRadius: 10 }}>Online payments are coming soon. Until then the OutReach team adds credits for you.</div>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 8 }}>Each app has its own plan and is paid for on its own, from that app's Subscription page.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
            {APPS.filter((app) => app.plans).map((app) => {
              const plan = data.plans.find((p) => p.id === subscribed[app.wallet]);
              return (
                <div key={app.id} style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}>
                    {React.createElement(WALLET_ICON[app.wallet] || Coins, { size: 15, color: WALLET_COLOUR[app.wallet] })} {app.name}
                  </div>
                  <div style={{ fontSize: 12.5, color: plan ? C.teal : C.slate }}>
                    {plan ? `${plan.name} · ${money(plan.priceUsdCents, plan.currency)} a month` : "No plan yet"}
                  </div>
                  <button type="button" style={{ ...btn(!plan), alignSelf: "flex-start" }} onClick={() => window.location.assign(app.plans.replace(/^#/, ""))}>
                    <CreditCard size={13} /> {plan ? "Manage plan" : "See plans"}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {error && <div role="alert" style={{ color: C.red, fontSize: 12.5, marginTop: 8 }}>{error}</div>}

      <div style={heading}>History</div>
      {data.history.length === 0 ? (
        <div style={{ fontSize: 13, color: C.slate }}>Nothing yet.</div>
      ) : (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", maxHeight: 260, overflowY: "auto" }}>
          {data.history.map((h) => (
            <div key={h.id} style={{ display: "grid", gridTemplateColumns: "120px 90px 1fr 80px", gap: 10, padding: "7px 12px", borderTop: `1px solid ${C.border}`, fontSize: 12.5 }}>
              <span style={{ color: C.slate }}>{h.at ? new Date(h.at + "Z").toLocaleDateString() : ""}</span>
              <span style={{ color: WALLET_COLOUR[h.wallet] || C.slate, fontWeight: 600 }}>{h.wallet}</span>
              <span style={{ color: C.textInk }}>{h.note || h.kind}{h.by ? ` · ${h.by}` : ""}</span>
              <span style={{ fontFamily: FONT_MONO, textAlign: "right", color: h.amount < 0 ? C.red : C.teal }}>{h.amount > 0 ? "+" : ""}{fmt(h.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
