import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, CreditCard, ExternalLink } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { api } from "../api/apiClient";
import { takeBillingParam } from "../hub/BillingReturnBanner";
import { btn, day, fmt, heading, money, MonthlyUsage, WalletCard, WALLET_COLOUR } from "./CreditsTab";

const card = { border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", background: "#fff" };
const stepBtn = { width: 30, height: 32, border: "none", background: C.paperSoft, color: C.textInk, fontSize: 16, fontWeight: 700, cursor: "pointer" };
const MAX_QUANTITY = 99; // same limit as the server

// One plugin's subscription, managed by the organisation's admins from inside the plugin:
// subscribe to a monthly plan, move to another plan, cancel or keep it, buy one-off top-ups,
// and open Stripe for the card and invoices. `back` is this page's path (where Stripe returns to).
export function SubscriptionPage({ wallet, back }) {
  const [data, setData] = useState(null);
  const [live, setLive] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [ask, setAsk] = useState(null); // { text, yes, run } waiting for a yes
  const [qty, setQty] = useState({}); // top-up id -> how many to buy
  const [returned] = useState(takeBillingParam);
  const [notice, setNotice] = useState(returned === "success" ? "Payment received. Your plan and credits appear here within a minute." : returned ? "Checkout cancelled. Nothing was charged." : "");

  const load = useCallback(async () => {
    try {
      const [ov, plans] = await Promise.all([api.getBillingOverview(), api.getLivePlans()]);
      setData(ov);
      setLive(plans);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // Stripe tells us about payments a moment after they happen, so look again shortly after one.
  const loadSoon = useCallback(() => {
    load();
    const timers = [3000, 8000].map((ms) => setTimeout(load, ms));
    return () => timers.forEach(clearTimeout);
  }, [load]);

  useEffect(() => (returned === "success" ? loadSoon() : void load()), [returned, load, loadSoon]);

  if (error && !data) return <div role="alert" style={{ color: C.red, fontSize: 12.5 }}>{error}</div>;
  if (!data) return <div style={{ color: C.slate, fontSize: 13 }}>Loading…</div>;

  const w = data.wallets.find((x) => x.key === wallet);
  const plans = data.plans.filter((p) => p.wallet === wallet && p.kind === "plan");
  const topups = data.plans.filter((p) => p.wallet === wallet && p.kind === "topup");
  const mine = live[wallet];
  const current = mine && data.plans.find((p) => p.id === mine.planId);
  const history = data.history.filter((h) => h.wallet === wallet);
  // What this plugin's credits are spent on, from the rate card.
  const rates = Object.values(data.rates).filter((r) => r.wallet === wallet && r.credits > 0);
  // Calling is sold by the minute: voice credits are shown as minutes of calls (a credit is a
  // minute unless staff changed the rate card).
  const perMinute = wallet === "voice" ? data.rates.voice_minute?.credits : 0;
  const callTime = (credits) => `${fmt(Math.floor(credits / perMinute))} minutes of calls`;
  const about = (p) => (p.description ? ` · ${p.description}` : "");
  const worth = (credits) => (perMinute === 1 ? callTime(credits) : perMinute ? `${callTime(credits)} (${fmt(credits)} credits)` : `${fmt(credits)} credits`);

  const run = async (key, fn) => {
    setBusy(key);
    setError("");
    setAsk(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    }
    setBusy("");
  };
  const toStripe = (key, fn) => run(key, async () => {
    const { url } = await fn();
    window.location.assign(url);
  });

  const change = (p) => {
    const up = p.priceUsdCents > current.priceUsdCents;
    const price = `${money(p.priceUsdCents, p.currency)}/month`;
    setAsk({
      text: up
        ? `Move to ${p.name} (${price}) now? Your card is charged the difference for the rest of this period and the extra credits are added straight away.`
        : `Move to ${p.name} (${price}) from your next renewal${mine.periodEnd ? ` on ${day(mine.periodEnd)}` : ""}? This period's credits stay until then and nothing is refunded.`,
      yes: up ? "Upgrade now" : "Change plan",
      run: () => run(p.id, async () => {
        const { url } = await api.changePlan(p.id);
        if (url) return window.location.assign(url); // the bank wants this payment confirmed
        setNotice(up ? `You are now on ${p.name}. The extra credits appear within a minute.` : `You move to ${p.name} at your next renewal.`);
        loadSoon();
      }),
    });
  };

  const setEnding = (ending) => {
    const go = () => run("cancel", async () => {
      await api.cancelPlan(wallet, ending);
      setNotice(ending ? `${current.name} is cancelled. It stays active until ${day(mine.periodEnd)}.` : `${current.name} carries on and renews as usual.`);
      load();
    });
    if (!ending) return go();
    setAsk({ text: `Cancel ${current.name}? It stays active, with its credits, until ${day(mine.periodEnd)} and is not renewed after that.`, yes: "Cancel plan", run: go });
  };

  return (
    <div style={{ fontFamily: FONT_BODY, maxWidth: 860 }}>
      {data.testMode && <div style={{ fontSize: 12, fontWeight: 700, color: "#7A5200", background: "#FFF3D6", padding: "6px 10px", borderRadius: 8, marginBottom: 10 }}>Stripe test mode: no real money moves.</div>}
      {notice && (
        <div role="status" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: C.teal, background: C.tealSoft, padding: "8px 12px", borderRadius: 10, marginBottom: 10 }}>
          <CheckCircle2 size={15} /> {notice}
        </div>
      )}
      {mine?.status === "past_due" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: C.red, background: C.redSoft, padding: "8px 12px", borderRadius: 10, marginBottom: 10 }}>
          <AlertTriangle size={15} /> Your last payment failed. Update your card in Card & invoices.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
        {w && <WalletCard w={w} />}
        <div style={card}>
          <div style={{ fontSize: 12.5, color: C.slate, fontWeight: 600 }}>Your plan</div>
          {current ? (
            <>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.textInk, margin: "4px 0 2px" }}>{current.name}</div>
              <div style={{ fontSize: 12.5, color: C.slate }}>
                {money(current.priceUsdCents, current.currency)}/month · {worth(current.credits)} every month
              </div>
              <div style={{ fontSize: 12.5, color: mine.ending ? C.red : C.slate, marginTop: 2 }}>
                {mine.ending ? `Cancelled: ends ${day(mine.periodEnd)}` : `Renews ${day(mine.periodEnd)}`}
              </div>
              <div style={{ marginTop: 10 }}>
                {mine.ending
                  ? <button type="button" style={btn(true, busy === "cancel")} disabled={busy === "cancel"} onClick={() => setEnding(false)}>Keep my plan</button>
                  : <button type="button" style={btn(false, busy === "cancel")} disabled={busy === "cancel"} onClick={() => setEnding(true)}>Cancel plan</button>}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.textInk, margin: "4px 0 2px" }}>No plan yet</div>
              <div style={{ fontSize: 12.5, color: C.slate }}>Subscribe to a monthly plan below, or buy a one-off top-up when you need more.</div>
            </>
          )}
        </div>
      </div>

      {rates.length > 0 && (
        <div style={{ fontSize: 12, color: C.slate, marginTop: 8 }}>
          Credits are used like this: {rates.map((r) => `${r.label} = ${fmt(r.credits)} ${r.credits === 1 ? "credit" : "credits"}${r.charged ? "" : " (not charged yet)"}`).join(" · ")}.
          {perMinute > 1 && w && w.balance > 0 && ` You have ${callTime(w.balance)} left.`}
        </div>
      )}

      {ask && (
        <div role="alertdialog" style={{ ...card, marginTop: 12, borderColor: C.cobalt, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1, minWidth: 240, fontSize: 13, color: C.textInk }}>{ask.text}</span>
          <button type="button" style={btn(false)} onClick={() => setAsk(null)}>Not now</button>
          <button type="button" style={btn(true)} onClick={ask.run}>{ask.yes}</button>
        </div>
      )}
      {error && <div role="alert" style={{ color: C.red, fontSize: 12.5, marginTop: 8 }}>{error}</div>}

      {!data.stripeReady ? (
        <div style={{ fontSize: 13, color: C.slate, background: C.paperSoft, padding: "10px 12px", borderRadius: 10, marginTop: 16 }}>Online payments are coming soon. Until then the OutReach team adds credits for you.</div>
      ) : (
        <>
          <div style={heading}>Monthly plans</div>
          {plans.length === 0 && <div style={{ fontSize: 13, color: C.slate }}>No plans on sale yet.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {plans.map((p) => {
              const isMine = current?.id === p.id;
              return (
                <div key={p.id} style={{ ...card, borderWidth: 2, borderColor: isMine ? WALLET_COLOUR[wallet] : C.border }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, marginTop: 2 }}>{money(p.priceUsdCents, p.currency)}<span style={{ fontSize: 12, color: C.slate, fontWeight: 500 }}> /month</span></div>
                  <div style={{ fontSize: 12.5, color: C.slate, minHeight: 34 }}>{worth(p.credits)} every month{about(p)}</div>
                  <div style={{ marginTop: 10 }}>
                    {isMine ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 700, color: WALLET_COLOUR[wallet] }}><Check size={14} /> Your plan</span>
                    ) : current ? (
                      <button type="button" style={btn(false, Boolean(busy))} disabled={Boolean(busy)} onClick={() => change(p)}>
                        {p.priceUsdCents > current.priceUsdCents ? "Upgrade" : "Downgrade"}
                      </button>
                    ) : (
                      <button type="button" style={btn(true, Boolean(busy))} disabled={Boolean(busy)} onClick={() => toStripe(p.id, () => api.startCheckout([p.id], [], back))}>
                        <CreditCard size={13} /> Subscribe
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {topups.length > 0 && <div style={heading}>One-off top-ups</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {topups.map((p) => {
              const n = qty[p.id] || 1;
              const setN = (next) => setQty({ ...qty, [p.id]: Math.max(1, Math.min(MAX_QUANTITY, Math.round(next) || 1)) });
              return (
                <div key={p.id} style={{ ...card, borderStyle: "dashed" }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, marginTop: 2 }}>{money(p.priceUsdCents, p.currency)}<span style={{ fontSize: 12, color: C.slate, fontWeight: 500 }}> each</span></div>
                  <div style={{ fontSize: 12.5, color: C.slate, minHeight: 34 }}>{worth(p.credits)} each, never expire{about(p)}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${C.border}`, borderRadius: 9, overflow: "hidden" }}>
                      <button type="button" aria-label={`One fewer ${p.name}`} style={stepBtn} disabled={n <= 1} onClick={() => setN(n - 1)}>−</button>
                      <input aria-label={`How many ${p.name}`} type="number" min="1" max={MAX_QUANTITY} value={n} onChange={(e) => setN(Number(e.target.value))}
                        style={{ width: 44, border: "none", textAlign: "center", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, padding: "7px 0", MozAppearance: "textfield" }} />
                      <button type="button" aria-label={`One more ${p.name}`} style={stepBtn} disabled={n >= MAX_QUANTITY} onClick={() => setN(n + 1)}>+</button>
                    </div>
                    <button type="button" style={btn(true, Boolean(busy))} disabled={Boolean(busy)} onClick={() => toStripe(p.id, () => api.startCheckout([], [p.id], back, { [p.id]: n }))}>
                      <CreditCard size={13} /> Buy {money(p.priceUsdCents * n, p.currency)}
                    </button>
                    {n > 1 && <span style={{ fontSize: 12, color: C.slate }}>{worth(p.credits * n)}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: C.slate }}>Paid by card through Stripe. Cards from other countries see and pay in their own currency.</div>
            {data.subscription.hasCustomer && (
              <button type="button" style={btn(false, busy === "portal")} disabled={busy === "portal"} onClick={() => toStripe("portal", () => api.openBillingPortal(back))}>
                <CreditCard size={13} /> Card & invoices <ExternalLink size={11} />
              </button>
            )}
          </div>
        </>
      )}

      <MonthlyUsage wallets={data.wallets} only={wallet} />

      <div style={heading}>Latest activity</div>
      {history.length === 0 ? (
        <div style={{ fontSize: 13, color: C.slate }}>Nothing yet.</div>
      ) : (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", maxHeight: 260, overflowY: "auto", background: "#fff" }}>
          {history.map((h) => (
            <div key={h.id} style={{ display: "grid", gridTemplateColumns: "120px 1fr 80px", gap: 10, padding: "7px 12px", borderTop: `1px solid ${C.border}`, fontSize: 12.5 }}>
              <span style={{ color: C.slate }}>{h.at ? new Date(h.at + "Z").toLocaleDateString() : ""}</span>
              <span style={{ color: C.textInk }}>{h.note || h.kind}{h.by ? ` · ${h.by}` : ""}</span>
              <span style={{ fontFamily: FONT_MONO, textAlign: "right", color: h.amount < 0 ? C.red : C.teal }}>{h.amount > 0 ? "+" : ""}{fmt(h.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
