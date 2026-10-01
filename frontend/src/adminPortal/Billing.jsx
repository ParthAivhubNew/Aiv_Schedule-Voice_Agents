import React, { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { C, FONT_BODY } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Table, btn, cell, fmt, heading, input, mono, money, useAction } from "./ui";

const WALLETS = [["voice", "Voice"], ["leadgen", "Lead generation"], ["email", "Email"], ["scheduler", "Post scheduler"]];

// The app a Stripe product is most likely for, from its name (staff can change it).
const guessWallet = (name) => (/social|post|schedul/i.test(name) ? "scheduler" : /lead/i.test(name) ? "leadgen" : /mail/i.test(name) ? "email" : "voice");

// "22 hours of call per month" in a Stripe description becomes 22 hours of calls in credits.
const guessCredits = (s, rates) => {
  const hours = guessWallet(s.name) === "voice" && /(\d+(?:\.\d+)?)\s*hours?/i.exec(s.description || "");
  return hours ? String(Math.round(Number(hours[1]) * 60 * (rates?.voice_minute?.credits || 0))) : "";
};

const EMPTY_PLAN = { wallet: "voice", kind: "plan", name: "", priceUsd: "", credits: "" };

// Plans and top-ups on sale, prices already made in Stripe, the rate card and the Telnyx margin.
export function Billing({ canEdit }) {
  const [plans, setPlans] = useState([]);
  const [stripePrices, setStripePrices] = useState([]);
  const [rates, setRates] = useState(null);
  const [rateDraft, setRateDraft] = useState({});
  const [stripeReady, setStripeReady] = useState(false);
  const [sell, setSell] = useState({});
  const [plan, setPlan] = useState(EMPTY_PLAN);
  const [loadErr, setLoadErr] = useState("");

  const load = useCallback(async () => {
    try {
      const platform = await adminApi.platform();
      setStripeReady(Boolean(platform.stripe));
      // Stripe first: it also refreshes the names and descriptions of the plans on sale.
      if (platform.stripe) setStripePrices(await adminApi.stripePrices().catch((err) => { setLoadErr(err.message); return []; }));
      const [p, r] = await Promise.all([adminApi.plans(), adminApi.rates()]);
      setPlans(p);
      setRates(r);
      setRateDraft(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v.credits)])));
    } catch (err) {
      setLoadErr(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const [msg, run] = useAction(load);

  return (
    <>
      <PageTitle title="Plans & pricing" sub={stripeReady ? "Customers buy these in each app's Subscription page." : "Stripe keys are not set on the server: nothing can be bought yet."} />
      <Note error>{loadErr}</Note>
      <Note error={msg.error}>{msg.text}</Note>

      <div style={heading}>On sale</div>
      <Table head={["App", "Kind", "Name", "Price", "Credits", "Active", "Stripe"]} minWidth={760}>
        {plans.length === 0 && <tr><td colSpan={7} style={{ ...cell, color: C.slate }}>None yet.</td></tr>}
        {plans.map((p) => (
          <tr key={p.id} style={{ opacity: p.active ? 1 : 0.55 }}>
            <td style={cell}>{p.wallet}</td>
            <td style={cell}>{p.kind === "plan" ? "Monthly" : "Top-up"}</td>
            <td style={cell}>{p.name}</td>
            <td style={{ ...cell, ...mono }}>{money(p.priceUsdCents, p.currency)}</td>
            <td style={cell}>
              {canEdit ? (
                <input key={p.credits} aria-label={`Credits for ${p.name}`} title="Credits this gives (saved when you leave the box)" type="number" min="1" defaultValue={p.credits}
                  style={{ ...input, padding: "4px 8px", width: 100, ...mono }}
                  onBlur={(e) => {
                    const credits = Number(e.target.value);
                    if (credits > 0 && credits !== p.credits) run(() => adminApi.updatePlan(p.id, { ...p, credits }), `${p.name} now gives ${fmt(credits)} credits.`);
                  }} />
              ) : fmt(p.credits)}
            </td>
            <td style={cell}>
              <input type="checkbox" aria-label={`${p.name} on sale`} checked={p.active} disabled={!canEdit}
                onChange={() => run(() => adminApi.updatePlan(p.id, { ...p, active: !p.active }), p.active ? `${p.name} taken off sale.` : `${p.name} back on sale.`)} />
            </td>
            <td style={cell}>
              {p.inStripe ? <span style={{ color: C.teal, fontWeight: 600 }}>In Stripe</span> : canEdit && stripeReady ? (
                <button type="button" style={btn(false)} onClick={() => run(() => adminApi.syncPlan(p.id), "Created in Stripe.")}>Create in Stripe</button>
              ) : "Not yet"}
            </td>
          </tr>
        ))}
      </Table>

      {canEdit && stripePrices.length > 0 && (
        <>
          <div style={heading}>In your Stripe account, not on sale here yet</div>
          <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 8 }}>
            Pick the app and the credits each one gives (1 hour of calls = {fmt(60 * (rates?.voice_minute?.credits || 0))} credits, 1 AI post = {fmt(rates?.ai_post?.credits)}).
          </div>
          <Table head={["Stripe price", "Amount", "App", "Credits", ""]} minWidth={760}>
            {stripePrices.map((s) => {
              const draft = sell[s.priceId] || { wallet: guessWallet(s.name), credits: guessCredits(s, rates) };
              const edit = (patch) => setSell({ ...sell, [s.priceId]: { ...draft, ...patch } });
              return (
                <tr key={s.priceId}>
                  <td style={cell}>{s.name}{s.description && <span style={{ color: C.slate }}> · {s.description}</span>} <span style={{ color: C.slate }}>({s.kind === "plan" ? "monthly" : "one-off"})</span></td>
                  <td style={{ ...cell, ...mono }}>{money(s.priceCents, s.currency)}</td>
                  <td style={cell}>
                    <select aria-label={`App for ${s.name}`} value={draft.wallet} onChange={(e) => edit({ wallet: e.target.value })} style={input}>
                      {WALLETS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  </td>
                  <td style={cell}><input aria-label={`Credits for ${s.name}`} type="number" min="1" placeholder="Credits" value={draft.credits} onChange={(e) => edit({ credits: e.target.value })} style={{ ...input, width: 110 }} /></td>
                  <td style={cell}>
                    <button type="button" style={btn(true)} onClick={() => run(async () => {
                      if (!(Number(draft.credits) > 0)) throw new Error("Enter how many credits it gives.");
                      await adminApi.sellStripePrice(s.priceId, draft.wallet, Number(draft.credits));
                    }, `${s.name} is on sale.`)}>Put on sale</button>
                  </td>
                </tr>
              );
            })}
          </Table>
        </>
      )}

      {canEdit && (
        <>
          <div style={heading}>Add a plan or top-up</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <select aria-label="Plan app" value={plan.wallet} onChange={(e) => setPlan({ ...plan, wallet: e.target.value })} style={input}>
              {WALLETS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <select aria-label="Plan kind" value={plan.kind} onChange={(e) => setPlan({ ...plan, kind: e.target.value })} style={input}>
              <option value="plan">Monthly plan</option><option value="topup">Top-up</option>
            </select>
            <input aria-label="Plan name" placeholder="Name, e.g. Voice Starter" value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })} style={{ ...input, flex: 1, minWidth: 160 }} />
            <input aria-label="Price in USD" type="number" min="0.5" step="0.01" placeholder="Price $" value={plan.priceUsd} onChange={(e) => setPlan({ ...plan, priceUsd: e.target.value })} style={{ ...input, width: 100 }} />
            <input aria-label="Plan credits" type="number" min="1" placeholder="Credits" value={plan.credits} onChange={(e) => setPlan({ ...plan, credits: e.target.value })} style={{ ...input, width: 110 }} />
            <button type="button" style={btn(true)} onClick={() => run(async () => {
              await adminApi.createPlan({ wallet: plan.wallet, kind: plan.kind, name: plan.name, priceUsdCents: Math.round(Number(plan.priceUsd) * 100), credits: Number(plan.credits) });
              setPlan(EMPTY_PLAN);
            }, "Plan added. Create it in Stripe to put it on sale.")}><Plus size={13} /> Add</button>
          </div>
        </>
      )}

      <div style={heading}>Rate card (credits per unit)</div>
      {rates && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          {Object.entries(rates).map(([k, r]) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, opacity: r.charged ? 1 : 0.6 }} title={r.charged ? "" : "Priced, not charged yet"}>
              {r.label}
              <input type="number" min="0" disabled={!canEdit} value={rateDraft[k] ?? ""} onChange={(e) => setRateDraft({ ...rateDraft, [k]: e.target.value })} style={{ ...input, width: 76 }} />
            </label>
          ))}
          {canEdit && <button type="button" style={btn(false)} onClick={() => run(() => adminApi.setRates(Object.fromEntries(Object.entries(rateDraft).map(([k, v]) => [k, Number(v) || 0]))), "Rates saved.")}>Save rates</button>}
        </div>
      )}

      <TelnyxMargin />
    </>
  );
}

const right = { ...cell, textAlign: "right", ...mono, whiteSpace: "nowrap" };
const amount = (v, cur) => `${Number(v || 0).toFixed(2)} ${(cur || "").toUpperCase()}`;

// For a month: what Telnyx charged us for each customer's billing group next to the minutes we
// billed and what the customer paid us, so the margin stays visible.
function TelnyxMargin() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setMsg("");
    try {
      setData(await adminApi.telnyxCosts(month));
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
        <button type="button" style={btn(true, busy)} disabled={busy} onClick={load}>{busy && <RefreshCw size={13} />} Show</button>
      </div>
      <Note error>{msg}</Note>
      {data && (
        <>
          <Table head={["Customer", "Minutes we billed", "Minutes Telnyx billed", "Telnyx cost", "Paid us", "Margin"]}>
            {data.rows.length === 0 && <tr><td colSpan={6} style={{ ...cell, color: C.slate }}>No customers on our Telnyx account yet.</td></tr>}
            {data.rows.map((r) => {
              const short = r.telnyxMinutes > r.minutesBilled * 1.05 + 1;
              return (
                <tr key={r.orgId}>
                  <td style={{ ...cell, fontFamily: FONT_BODY }}>{r.name}</td>
                  <td style={right}>{fmt(r.minutesBilled)}</td>
                  <td style={{ ...right, color: short ? C.red : C.textInk }} title={short ? "Telnyx billed more minutes than we did" : ""}>{fmt(r.telnyxMinutes)}</td>
                  <td style={right}>{amount(r.telnyxCost, r.telnyxCurrency)}</td>
                  <td style={right}>{amount(r.paid, r.paidCurrency)}</td>
                  <td style={{ ...right, color: r.margin == null ? C.slate : r.margin < 0 ? C.red : C.teal }}>
                    {r.margin == null ? "set FX_USD_TO_GBP" : `${amount(r.margin, r.paidCurrency)}${r.marginPct != null ? ` (${r.marginPct}%)` : ""}`}
                  </td>
                </tr>
              );
            })}
          </Table>
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
