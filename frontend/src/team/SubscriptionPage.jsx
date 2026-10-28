import React, { useCallback, useEffect, useState } from "react";
import { Loader } from "../app/Loader";
import { AlertTriangle, Check, CheckCircle2, CreditCard, ExternalLink } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { api } from "../api/apiClient";
import { BILLING_CHANGED, takeBillingParam } from "../hub/BillingReturnBanner";
import { btn, day, fmt, heading, money, MonthlyUsage, WalletCard, WALLET_COLOUR } from "./CreditsTab";

const card = { border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", background: "#fff" };
const stepBtn = { width: 30, height: 32, border: "none", background: C.paperSoft, color: C.textInk, fontSize: 16, fontWeight: 700, cursor: "pointer" };
const MAX_QUANTITY = 99; // same limit as the server
// Why people cancel: the same choices the server accepts.
const REASONS = [
  ["too_expensive", "It costs too much"], ["not_using", "I am not using it enough"], ["missing_feature", "It is missing something I need"],
  ["other_tool", "I am switching to another tool"], ["pause", "I just need a break"], ["other", "Something else"],
];

// One plugin's subscription, managed by the organisation's admins from inside the plugin:
// subscribe to a monthly plan, move to another plan, cancel or keep it, buy one-off top-ups,
// and open Stripe for the card and invoices. `back` is this page's path (where Stripe returns to).
export function SubscriptionPage({ wallet, back }) {
  const [data, setData] = useState(null);
  const [live, setLive] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [ask, setAsk] = useState(null); // { text, yes, run } waiting for a yes
  const [leaving, setLeaving] = useState(null); // { reason, note } while the cancel questions are open
  const [qty, setQty] = useState({}); // top-up id -> how many to buy
  const [returned] = useState(takeBillingParam);
  const [notice, setNotice] = useState(returned === "success" ? "Payment received. Your plan and credits appear here within a minute." : returned ? "Checkout cancelled. Nothing was charged." : "");

  const load = useCallback(async () => {
    try {
      const [ov, plans] = await Promise.all([api.getBillingOverview(), api.getLivePlans()]);
      setData(ov);
      setLive(plans);
      return ov;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, []);

  // Stripe tells us about a payment a moment after it happens (up to a minute), so after a
  // checkout keep looking for a minute. Whenever this app's plan or credits change, say so, so
  // the app's menu unlocks without a page reload.
  const loadSoon = useCallback(() => {
    let timer;
    let seen = null;
    const until = Date.now() + 60000;
    const look = async () => {
      const ov = await load();
      const credits = ov?.wallets?.find((x) => x.key === wallet);
      const now = JSON.stringify([ov?.subscription?.plans?.[wallet] || "", credits?.balance ?? null]);
      if (ov && now !== seen) window.dispatchEvent(new Event(BILLING_CHANGED));
      seen = now;
      if (Date.now() < until) timer = setTimeout(look, 4000);
    };
    look();
    return () => clearTimeout(timer);
  }, [load, wallet]);

  useEffect(() => (returned === "success" ? loadSoon() : void load()), [returned, load, loadSoon]);

  if (error && !data) return <div role="alert" style={{ color: C.red, fontSize: 12.5 }}>{error}</div>;
  if (!data) return <Loader compact label="Loading" />;

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
  const vat = data.taxAdded ? " + VAT" : "";
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
    const price = `${money(p.priceUsdCents, p.currency)}/month${vat}`;
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
    const go = (reason = "", note = "") => run("cancel", async () => {
      await api.cancelPlan(wallet, ending, reason, note);
      setLeaving(null);
      setNotice(ending ? `${current.name} is cancelled. It stays active until ${day(mine.periodEnd)}. We have emailed the details to your admins.` : `${current.name} carries on and renews as usual.`);
      load();
    });
    if (!ending) return go();
    setAsk(null);
    setLeaving({ reason: "", note: "", go });
  };
  // What the cancel dialog tells them: plan credits end with the period, top-ups stay.
  const planCredits = (w?.batches || []).filter((b) => b.expiresAt).reduce((a, b) => a + b.remaining, 0);
  const keptCredits = (w?.batches || []).filter((b) => !b.expiresAt).reduce((a, b) => a + b.remaining, 0);

  return (
    <div style={{ fontFamily: FONT_BODY }}>
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
                {money(current.priceUsdCents, current.currency)}/month{vat} · {worth(current.credits)} every month
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

      {leaving && current && (
        <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setLeaving(null); }}
          style={{ position: "fixed", inset: 0, zIndex: 130, background: "rgba(18,20,28,.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div role="dialog" aria-label={`Cancel ${current.name}`} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 520, maxHeight: "calc(100dvh - 32px)", overflowY: "auto", padding: 22, boxShadow: "0 24px 70px rgba(0,0,0,.25)" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.textInk }}>Cancel {current.name}?</div>
            <ul style={{ margin: "10px 0 14px", paddingLeft: 18, fontSize: 13, color: C.textInk, lineHeight: 1.6 }}>
              <li>It stays active until <b>{day(mine.periodEnd)}</b>, then stops. It will not renew and nothing more is charged.</li>
              <li>{planCredits > 0 ? <>You can use your <b>{fmt(planCredits)}</b> plan credits until then. Any left over expire that day.</> : "You have no plan credits left to use."}</li>
              {keptCredits > 0 && <li>Your <b>{fmt(keptCredits)}</b> top-up credits never expire and stay with you.</li>}
              <li>The current month is not refunded.</li>
              <li>You can press <b>Keep my plan</b> any time before {day(mine.periodEnd)}.</li>
            </ul>
            <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
              <legend style={{ fontSize: 13, fontWeight: 700, color: C.textInk, marginBottom: 6 }}>Why are you cancelling?</legend>
              {REASONS.map(([id, label]) => (
                <label key={id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: C.textInk, padding: "4px 0", cursor: "pointer" }}>
                  <input type="radio" name="cancel-reason" checked={leaving.reason === id} onChange={() => setLeaving({ ...leaving, reason: id })} /> {label}
                </label>
              ))}
            </fieldset>
            <textarea aria-label="Anything we should know?" placeholder="Anything we should know? (optional)" maxLength={500} value={leaving.note}
              onChange={(e) => setLeaving({ ...leaving, note: e.target.value })}
              style={{ width: "100%", boxSizing: "border-box", marginTop: 10, minHeight: 64, borderRadius: 8, border: `1px solid ${C.border}`, padding: "8px 10px", fontFamily: FONT_BODY, fontSize: 13, resize: "vertical" }} />
            {error && <div role="alert" style={{ color: C.red, fontSize: 12.5, marginTop: 8 }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button type="button" style={btn(true)} onClick={() => setLeaving(null)}>Keep my plan</button>
              <button type="button" disabled={!leaving.reason || busy === "cancel"}
                style={{ ...btn(false, busy === "cancel"), color: C.red, borderColor: C.red, opacity: leaving.reason ? 1 : 0.5 }}
                onClick={() => leaving.go(leaving.reason, leaving.note.trim())}>{busy === "cancel" ? "Cancelling…" : "Cancel plan"}</button>
            </div>
          </div>
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
        <div style={{ fontSize: 13, color: C.slate, background: C.paperSoft, padding: "10px 12px", borderRadius: 10, marginTop: 16 }}>Online payments are coming soon. Until then the Outreach team adds credits for you.</div>
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
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, marginTop: 2 }}>{money(p.priceUsdCents, p.currency)}<span style={{ fontSize: 12, color: C.slate, fontWeight: 500 }}> /month{vat}</span></div>
                  <div style={{ fontSize: 12.5, color: C.slate, minHeight: 34 }}>{worth(p.credits)} every month{about(p)}<div style={{ marginTop: 3 }}>Unused credits don't carry over. They are replaced when the plan renews.</div></div>
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
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, marginTop: 2 }}>{money(p.priceUsdCents, p.currency)}<span style={{ fontSize: 12, color: C.slate, fontWeight: 500 }}> each{vat}</span></div>
                  <div style={{ fontSize: 12.5, color: C.slate, minHeight: 34 }}>{worth(p.credits)} each, never expire{about(p)}<div style={{ marginTop: 3 }}>Used after your plan credits, so they carry over.</div></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${C.border}`, borderRadius: 9, overflow: "hidden" }}>
                      <button type="button" aria-label={`One fewer ${p.name}`} style={stepBtn} disabled={n <= 1} onClick={() => setN(n - 1)}>−</button>
                      <input aria-label={`How many ${p.name}`} type="number" min="1" max={MAX_QUANTITY} value={n} onChange={(e) => setN(Number(e.target.value))}
                        style={{ width: 44, border: "none", textAlign: "center", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, padding: "7px 0", MozAppearance: "textfield" }} />
                      <button type="button" aria-label={`One more ${p.name}`} style={stepBtn} disabled={n >= MAX_QUANTITY} onClick={() => setN(n + 1)}>+</button>
                    </div>
                    <button type="button" style={btn(true, Boolean(busy))} disabled={Boolean(busy)} onClick={() => toStripe(p.id, () => api.startCheckout([], [p.id], back, { [p.id]: n }))}>
                      <CreditCard size={13} /> Buy {money(p.priceUsdCents * n, p.currency)}{vat}
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
