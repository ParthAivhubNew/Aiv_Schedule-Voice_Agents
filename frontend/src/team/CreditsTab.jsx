import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, Check, Coins, CreditCard, ExternalLink, Mail, PhoneCall, Plus, RefreshCw, Search } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { api } from "../api/apiClient";

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

// The organisation's wallets per plugin, plans and top-ups (one checkout), and history.
// OutReach staff also see every organisation, plans and the rate card.
export function CreditsTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [pick, setPick] = useState({ plans: {}, topups: {} });
  const [busy, setBusy] = useState("");
  const [isStaff, setIsStaff] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ov, cr] = await Promise.all([api.getBillingOverview(), api.getCredits()]);
      setData(ov);
      setIsStaff(Boolean(cr.isPlatformStaff));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byWallet = useMemo(() => {
    const out = {};
    (data?.plans || []).forEach((p) => {
      (out[p.wallet] = out[p.wallet] || { plan: [], topup: [] })[p.kind].push(p);
    });
    return out;
  }, [data]);

  if (error && !data) return <div style={{ color: C.red, fontSize: 12.5 }}>{error}</div>;
  if (!data) return <div style={{ color: C.slate, fontSize: 13 }}>Loading…</div>;

  const chosenPlans = Object.values(pick.plans).filter(Boolean);
  const chosenTopups = Object.entries(pick.topups).filter(([, v]) => v).map(([k]) => k);
  const chosen = [...chosenPlans, ...chosenTopups].map((id) => data.plans.find((p) => p.id === id)).filter(Boolean);
  const total = chosen.reduce((a, p) => a + p.priceUsdCents, 0);
  // Plugins already on a plan change it on their Subscription page; the others can still be bought.
  const subscribed = ["active", "past_due", "trialing"].includes(data.subscription.status) ? data.subscription.plans : {};

  const checkout = async () => {
    setBusy("checkout");
    setError("");
    try {
      const { url } = await api.startCheckout(chosenPlans, chosenTopups);
      window.location.assign(url);
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  };

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
        <span>Plans & top-ups</span>
        {data.subscription.hasCustomer && (
          <button type="button" style={btn(false, busy === "portal")} onClick={portal} disabled={busy === "portal"}>
            <CreditCard size={13} /> Manage billing <ExternalLink size={11} />
          </button>
        )}
      </div>
      {!data.stripeReady ? (
        <div style={{ fontSize: 13, color: C.slate, background: C.paperSoft, padding: "10px 12px", borderRadius: 10 }}>Online payments are coming soon. Until then the OutReach team adds credits for you.</div>
      ) : data.plans.length === 0 ? (
        <div style={{ fontSize: 13, color: C.slate }}>No plans on sale yet.</div>
      ) : (
        <>
          <div style={{ display: "grid", gap: 12 }}>
            {Object.entries(byWallet).map(([wallet, group]) => (
              <div key={wallet} style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  {React.createElement(WALLET_ICON[wallet] || Coins, { size: 15, color: WALLET_COLOUR[wallet] })}
                  {data.wallets.find((w) => w.key === wallet)?.label || wallet}
                  {subscribed[wallet] && <span style={{ fontSize: 11, color: C.teal, background: C.tealSoft, padding: "1px 8px", borderRadius: 99 }}>Subscribed</span>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
                  {group.plan.map((p) => {
                    const on = pick.plans[wallet] === p.id;
                    const current = subscribed[wallet] === p.id;
                    const hasSub = Boolean(subscribed[wallet]);
                    return (
                      <button key={p.id} type="button" disabled={hasSub} onClick={() => setPick({ ...pick, plans: { ...pick.plans, [wallet]: on ? "" : p.id } })}
                        style={{ textAlign: "left", padding: 12, borderRadius: 12, cursor: hasSub ? "default" : "pointer", border: `2px solid ${on || current ? C.cobalt : C.border}`, background: on ? C.cobaltSoft : "#fff" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 13 }}>{p.name}{(on || current) && <Check size={14} color={C.cobalt} />}</div>
                        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, marginTop: 2 }}>{money(p.priceUsdCents, p.currency)}<span style={{ fontSize: 11.5, color: C.slate, fontWeight: 500 }}> /month</span></div>
                        <div style={{ fontSize: 12, color: C.slate }}>{fmt(p.credits)} credits every month</div>
                      </button>
                    );
                  })}
                  {group.topup.map((p) => {
                    const on = Boolean(pick.topups[p.id]);
                    return (
                      <button key={p.id} type="button" onClick={() => setPick({ ...pick, topups: { ...pick.topups, [p.id]: !on } })}
                        style={{ textAlign: "left", padding: 12, borderRadius: 12, cursor: "pointer", border: `2px dashed ${on ? C.teal : C.border}`, background: on ? C.tealSoft : "#fff" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 13 }}>{p.name}{on && <Check size={14} color={C.teal} />}</div>
                        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, marginTop: 2 }}>{money(p.priceUsdCents, p.currency)}<span style={{ fontSize: 11.5, color: C.slate, fontWeight: 500 }}> once</span></div>
                        <div style={{ fontSize: 12, color: C.slate }}>{fmt(p.credits)} credits · never expire</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, color: C.slate }}>Cards from other countries see and pay in their own currency at Stripe's rate.</div>
            <button type="button" style={btn(true, !total || busy === "checkout")} disabled={!total || busy === "checkout"} onClick={checkout}>
              {busy === "checkout" ? <RefreshCw size={13} /> : <CreditCard size={13} />} Pay {total ? money(total, chosen[0].currency) : ""}
            </button>
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

      {isStaff && <PlatformCredits rates={data.rates} wallets={data.wallets} stripeReady={data.stripeReady} onChanged={load} />}
    </div>
  );
}

// The plugin a Stripe product is most likely for, from its name (staff can change it).
const guessWallet = (name) => (/social|post|schedul/i.test(name) ? "scheduler" : /lead/i.test(name) ? "leadgen" : /mail/i.test(name) ? "email" : "voice");

// "22 hours of call per month" in a Stripe description becomes 22 hours of calls in credits.
const guessCredits = (s, rates) => {
  const hours = guessWallet(s.name) === "voice" && /(\d+(?:\.\d+)?)\s*hours?/i.exec(s.description);
  return hours ? String(Math.round(Number(hours[1]) * 60 * (rates.voice_minute?.credits || 0))) : "";
};

const EMPTY_PLAN = { wallet: "voice", kind: "plan", name: "", priceUsd: "", credits: "" };

// OutReach staff only: every organisation's wallets, adding credits, enforcement, plans and the rate card.
function PlatformCredits({ rates, wallets, stripeReady, onChanged }) {
  const [orgs, setOrgs] = useState([]);
  const [plans, setPlans] = useState([]);
  const [stripePrices, setStripePrices] = useState([]);
  const [sell, setSell] = useState({}); // Stripe price id -> { wallet, credits } being typed
  const [grant, setGrant] = useState({ org_id: "", wallet: "voice", amount: "", days: "30", note: "" });
  const [plan, setPlan] = useState(EMPTY_PLAN);
  const [rateDraft, setRateDraft] = useState(() => Object.fromEntries(Object.entries(rates).map(([k, r]) => [k, String(r.credits)])));
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      // Stripe first: it also refreshes the names and descriptions of the plans on sale.
      if (stripeReady) setStripePrices(await api.getStripePrices());
      const [o, p] = await Promise.all([api.getPlatformOrgs(), api.getPlatformPlans()]);
      setOrgs(o);
      setPlans(p);
    } catch (err) {
      setMsg(err.message);
    }
  }, [stripeReady]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn, ok) => {
    try {
      await fn();
      setMsg(ok);
      load();
      onChanged();
    } catch (err) {
      setMsg(err.message);
    }
  };

  const walletKeys = wallets.map((w) => w.key);
  return (
    <div style={{ marginTop: 24, paddingTop: 6, borderTop: `1px dashed ${C.border}` }}>
      <div style={{ ...heading, display: "flex", alignItems: "center", gap: 6 }}><Coins size={15} /> All organisations (OutReach staff)</div>
      {msg && <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 8 }}>{msg}</div>}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "auto", marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: `1.4fr repeat(${walletKeys.length}, 80px) 120px`, gap: 8, padding: "6px 12px", fontSize: 11, color: C.slate, fontWeight: 700, textTransform: "uppercase" }}>
          <span>Organisation</span>{walletKeys.map((k) => <span key={k} style={{ textAlign: "right" }}>{k}</span>)}<span style={{ textAlign: "right" }}>Stop at zero</span>
        </div>
        {orgs.map((o) => (
          <div key={o.id} style={{ display: "grid", gridTemplateColumns: `1.4fr repeat(${walletKeys.length}, 80px) 120px`, gap: 8, alignItems: "center", padding: "7px 12px", borderTop: `1px solid ${C.border}`, fontSize: 12.5 }}>
            <span>{o.name} <span style={{ color: C.slateLight, fontFamily: FONT_MONO, fontSize: 10.5 }}>{o.id}</span></span>
            {walletKeys.map((k) => <span key={k} style={{ fontFamily: FONT_MONO, textAlign: "right" }}>{fmt(o.wallets?.[k])}</span>)}
            <label style={{ display: "flex", gap: 6, justifyContent: "flex-end", cursor: "pointer" }}>
              <input type="checkbox" checked={o.enforce} onChange={() => run(() => api.setOrgCreditEnforce(o.id, !o.enforce), "Saved.")} />
            </label>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <select aria-label="Organisation" value={grant.org_id} onChange={(e) => setGrant({ ...grant, org_id: e.target.value })} style={input}>
          <option value="">Organisation…</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select aria-label="Wallet" value={grant.wallet} onChange={(e) => setGrant({ ...grant, wallet: e.target.value })} style={input}>
          {walletKeys.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input aria-label="Credits" type="number" placeholder="Credits (negative removes)" value={grant.amount} onChange={(e) => setGrant({ ...grant, amount: e.target.value })} style={{ ...input, width: 170 }} />
        <input aria-label="Expires in days" type="number" min="0" placeholder="Days (empty = never)" value={grant.days} onChange={(e) => setGrant({ ...grant, days: e.target.value })} style={{ ...input, width: 150 }} />
        <input aria-label="Note" placeholder="Note" value={grant.note} onChange={(e) => setGrant({ ...grant, note: e.target.value })} style={{ ...input, flex: 1, minWidth: 120 }} />
        <button type="button" style={btn(true)} onClick={() => {
          if (!grant.org_id || !Number(grant.amount)) return setMsg("Pick an organisation and an amount.");
          run(() => api.grantCredits(grant.org_id, Number(grant.amount), grant.note, grant.wallet, grant.days ? Number(grant.days) : null), "Credits added.");
        }}><Plus size={13} /> Add credits</button>
      </div>

      <div style={heading}>Plans & top-ups for sale</div>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 10 }}>
        {plans.length === 0 && <div style={{ padding: 10, fontSize: 12.5, color: C.slate }}>None yet.</div>}
        {plans.map((p) => (
          <div key={p.id} style={{ display: "grid", gridTemplateColumns: "90px 60px 1fr 80px 90px 150px", gap: 8, alignItems: "center", padding: "7px 12px", borderTop: `1px solid ${C.border}`, fontSize: 12.5, opacity: p.active ? 1 : 0.5 }}>
            <span style={{ color: WALLET_COLOUR[p.wallet], fontWeight: 600 }}>{p.wallet}</span>
            <span>{p.kind}</span>
            <span>{p.name}</span>
            <span style={{ fontFamily: FONT_MONO }}>{money(p.priceUsdCents, p.currency)}</span>
            <input key={p.credits} aria-label={`Credits for ${p.name}`} title="Credits this gives (saved when you leave the box)" type="number" min="1" defaultValue={p.credits} style={{ ...input, padding: "4px 8px", width: "100%", fontFamily: FONT_MONO }}
              onBlur={(e) => {
                const credits = Number(e.target.value);
                if (credits > 0 && credits !== p.credits) run(() => api.updatePlatformPlan(p.id, { ...p, credits }), `${p.name} now gives ${fmt(credits)} credits.`);
              }} />
            <span style={{ textAlign: "right" }}>
              {p.inStripe ? <span style={{ color: C.teal, fontWeight: 600 }}>In Stripe</span> : (
                <button type="button" style={btn(false)} onClick={() => run(() => api.syncPlanToStripe(p.id), "Created in Stripe.")}>Create in Stripe</button>
              )}
            </span>
          </div>
        ))}
      </div>
      {stripePrices.length > 0 && (
        <div style={{ border: `1px dashed ${C.border}`, borderRadius: 10, marginBottom: 10 }}>
          <div style={{ padding: "8px 12px", fontSize: 12.5, color: C.slate }}>
            Already in your Stripe account, not on sale here yet. Pick the app and the credits each one gives
            (1 hour of calls = {fmt(60 * (rates.voice_minute?.credits || 0))} credits, 1 AI post = {fmt(rates.ai_post?.credits)}).
          </div>
          {stripePrices.map((s) => {
            const draft = sell[s.priceId] || { wallet: guessWallet(s.name), credits: guessCredits(s, rates) };
            const edit = (patch) => setSell({ ...sell, [s.priceId]: { ...draft, ...patch } });
            return (
              <div key={s.priceId} style={{ display: "grid", gridTemplateColumns: "1fr 80px 110px 100px 110px", gap: 8, alignItems: "center", padding: "7px 12px", borderTop: `1px solid ${C.border}`, fontSize: 12.5 }}>
                <span>{s.name}{s.description && <span style={{ color: C.slate }}> · {s.description}</span>} <span style={{ color: C.slate }}>({s.kind === "plan" ? "monthly" : "one-off"})</span></span>
                <span style={{ fontFamily: FONT_MONO }}>{money(s.priceCents, s.currency)}</span>
                <select aria-label={`App for ${s.name}`} value={draft.wallet} onChange={(e) => edit({ wallet: e.target.value })} style={input}>
                  {walletKeys.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <input aria-label={`Credits for ${s.name}`} type="number" min="1" placeholder="Credits" value={draft.credits} onChange={(e) => edit({ credits: e.target.value })} style={{ ...input, width: "100%" }} />
                <button type="button" style={btn(false)} onClick={() => {
                  if (!(Number(draft.credits) > 0)) return setMsg("Enter how many credits it gives.");
                  run(() => api.sellStripePrice(s.priceId, draft.wallet, Number(draft.credits)), `${s.name} is on sale.`);
                }}>Put on sale</button>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <select aria-label="Plan wallet" value={plan.wallet} onChange={(e) => setPlan({ ...plan, wallet: e.target.value })} style={input}>
          {walletKeys.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select aria-label="Plan kind" value={plan.kind} onChange={(e) => setPlan({ ...plan, kind: e.target.value })} style={input}>
          <option value="plan">Monthly plan</option><option value="topup">Top-up</option>
        </select>
        <input aria-label="Plan name" placeholder="Name, e.g. Voice Starter" value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })} style={{ ...input, flex: 1, minWidth: 140 }} />
        <input aria-label="Price in USD" type="number" min="0.5" step="0.01" placeholder="Price $" value={plan.priceUsd} onChange={(e) => setPlan({ ...plan, priceUsd: e.target.value })} style={{ ...input, width: 100 }} />
        <input aria-label="Plan credits" type="number" min="1" placeholder="Credits" value={plan.credits} onChange={(e) => setPlan({ ...plan, credits: e.target.value })} style={{ ...input, width: 100 }} />
        <button type="button" style={btn(true)} onClick={() => run(async () => {
          await api.createPlatformPlan({ wallet: plan.wallet, kind: plan.kind, name: plan.name, priceUsdCents: Math.round(Number(plan.priceUsd) * 100), credits: Number(plan.credits) });
          setPlan(EMPTY_PLAN);
        }, "Plan added. Create it in Stripe to put it on sale.")}><Plus size={13} /> Add</button>
      </div>

      <div style={heading}>Rate card (credits per unit)</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        {Object.entries(rates).map(([k, r]) => (
          <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, opacity: r.charged ? 1 : 0.6 }} title={r.charged ? "" : "Priced, not charged yet"}>
            {r.label}
            <input type="number" min="0" value={rateDraft[k] ?? ""} onChange={(e) => setRateDraft({ ...rateDraft, [k]: e.target.value })} style={{ ...input, width: 70 }} />
          </label>
        ))}
        <button type="button" style={btn(false)} onClick={() => run(() => api.setCreditRates(Object.fromEntries(Object.entries(rateDraft).map(([k, v]) => [k, Number(v) || 0]))), "Rates saved.")}>Save rates</button>
      </div>

      <TelnyxMargin />
    </div>
  );
}

const cell = { padding: "7px 10px", borderTop: `1px solid ${C.border}`, fontSize: 12.5, textAlign: "right", fontFamily: FONT_MONO, whiteSpace: "nowrap" };
const amount = (v, cur) => `${Number(v || 0).toFixed(2)} ${(cur || "").toUpperCase()}`;

// OutReach staff: for a month, what Telnyx charged us for each customer's billing group next to
// the minutes we billed and what the customer paid us, so the margin stays visible.
function TelnyxMargin() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setMsg("");
    try {
      setData(await api.getTelnyxCosts(month));
    } catch (err) {
      setMsg(err.message);
      setData(null);
    }
    setBusy(false);
  };

  return (
    <>
      <div style={heading}>Telnyx costs and margin</div>
      <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 8 }}>
        Every customer uses our one Telnyx balance. This compares what Telnyx charged for each customer's billing group with the
        minutes we billed and what the customer paid us for Voice in the same month. Telnyx's own report can take a day to catch up.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <input type="month" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} style={input} />
        <button type="button" style={btn(true, busy)} disabled={busy} onClick={load}>{busy ? <RefreshCw size={13} /> : null} Show</button>
      </div>
      {msg && <div role="alert" style={{ fontSize: 12.5, color: C.red, marginBottom: 8 }}>{msg}</div>}
      {data && (
        <>
          <div className="scroll-narrow" style={{ border: `1px solid ${C.border}`, background: "#fff", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr style={{ fontSize: 11, color: C.slate, textTransform: "uppercase" }}>
                  {["Customer", "Minutes we billed", "Minutes Telnyx billed", "Telnyx cost", "Paid us", "Margin"].map((h, i) => (
                    <th key={h} style={{ padding: "7px 10px", textAlign: i ? "right" : "left", fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && <tr><td colSpan={6} style={{ ...cell, textAlign: "left", fontFamily: FONT_BODY, color: C.slate }}>No customers on our Telnyx account yet.</td></tr>}
                {data.rows.map((r) => {
                  const short = r.telnyxMinutes > r.minutesBilled * 1.05 + 1;
                  return (
                    <tr key={r.orgId}>
                      <td style={{ ...cell, textAlign: "left", fontFamily: FONT_BODY }}>{r.name}</td>
                      <td style={cell}>{fmt(r.minutesBilled)}</td>
                      <td style={{ ...cell, color: short ? C.red : C.textInk }} title={short ? "Telnyx billed more minutes than we did" : ""}>{fmt(r.telnyxMinutes)}</td>
                      <td style={cell}>{amount(r.telnyxCost, r.telnyxCurrency)}</td>
                      <td style={cell}>{amount(r.paid, r.paidCurrency)}</td>
                      <td style={{ ...cell, color: r.margin == null ? C.slate : r.margin < 0 ? C.red : C.teal }}>
                        {r.margin == null ? "set FX_USD_TO_GBP" : `${amount(r.margin, r.paidCurrency)}${r.marginPct != null ? ` (${r.marginPct}%)` : ""}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data.unattributed.length > 0 && (
            <div style={{ fontSize: 12.5, color: C.slate, marginTop: 8 }}>
              Not split by customer (Telnyx does not report these per billing group): {data.unattributed.map((u) => `${u.product} ${amount(u.cost, u.currency)}`).join(" · ")}.
            </div>
          )}
          {data.errors.length > 0 && <div style={{ fontSize: 12, color: C.amber, marginTop: 6 }}>Some Telnyx reports could not be read: {data.errors.join("; ")}</div>}
          {data.fxUsdToGbp && <div style={{ fontSize: 12, color: C.slate, marginTop: 6 }}>Telnyx's USD converted at {data.fxUsdToGbp} GBP per USD.</div>}
        </>
      )}
    </>
  );
}
