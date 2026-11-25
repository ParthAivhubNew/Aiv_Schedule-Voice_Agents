import React, { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { C, FONT_BODY } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Table, btn, cell, fmt, heading, input, mono, money, useAction, when } from "./ui";

const WALLETS = [["voice", "Voice"], ["leadgen", "Leads"], ["email", "Email"], ["scheduler", "Social"]];
const WALLET_ORDER = WALLETS.map(([w]) => w);

// The app a Stripe product is most likely for, from its name (staff can change it).
const guessWallet = (name) => (/social|post|schedul/i.test(name) ? "scheduler" : /lead/i.test(name) ? "leadgen" : /mail/i.test(name) ? "email" : "voice");

// "22 hours of call per month" in a Stripe description becomes 22 hours of calls in credits.
const guessCredits = (s, rates) => {
  const hours = guessWallet(s.name) === "voice" && /(\d+(?:\.\d+)?)\s*hours?/i.exec(s.description || "");
  return hours ? String(Math.round(Number(hours[1]) * 60 * (rates?.voice_minute?.credits || 0))) : "";
};

const EMPTY_PLAN = { wallet: "voice", kind: "plan", name: "", priceUsd: "", credits: "" };

// Runs a save; when the margin guard refuses it (an activity would sell below the floor), asks staff whether to save anyway and why.
async function withMarginCheck(save) {
  try {
    return await save({});
  } catch (err) {
    if (err.status !== 409 || err.info?.code !== "margin_floor") throw err;
    const needs = (err.info.items || []).filter((i) => i.creditsNeeded).map((i) => `${i.label}: at least ${i.creditsNeeded} credits`).join("; ");
    const reason = window.prompt(`${err.message}${needs ? `\n\nTo meet the floor: ${needs}.` : ""}\n\nTo save anyway, say why (kept in the audit log):`);
    if (!reason) throw new Error("Not saved: it would sell below the margin floor.");
    return save({ override: true, reason });
  }
}

const rulesText = (rules, providerNames) => {
  const r = rules || {};
  const who = r.providers == null ? "All providers" : r.providers.length === 0 ? "No providers" : r.providers.map((id) => providerNames[id] || id).join(", ");
  return `${who}${r.cost_cap_pct ? ` · fair-use cap ${r.cost_cap_pct}%` : ""}`;
};

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
  const [providers, setProviders] = useState([]);
  const [rulesFor, setRulesFor] = useState(null); // {id, providers: null | [...], cost_cap_pct} being edited

  const load = useCallback(async () => {
    try {
      const platform = await adminApi.platform();
      setStripeReady(Boolean(platform.stripe));
      // Stripe first: it also refreshes the names and descriptions of the plans on sale.
      if (platform.stripe) setStripePrices(await adminApi.stripePrices().catch((err) => { setLoadErr(err.message); return []; }));
      const [p, r, prov] = await Promise.all([adminApi.plans(), adminApi.rates(), adminApi.providers().catch(() => ({ providers: [] }))]);
      setProviders(prov.providers || []);
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
      <Table head={["App", "Kind", "Name", "Price", "Credits", "Active", "Stripe", "Includes"]} minWidth={920}>
        {plans.length === 0 && <tr><td colSpan={8} style={{ ...cell, color: C.slate }}>None yet.</td></tr>}
        {plans.map((p) => (
          <React.Fragment key={p.id}>
          <tr style={{ opacity: p.active ? 1 : 0.55 }}>
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
                    if (credits > 0 && credits !== p.credits) run(() => withMarginCheck((extra) => adminApi.updatePlan(p.id, { ...p, credits, ...extra })), `${p.name} now gives ${fmt(credits)} credits.`);
                  }} />
              ) : fmt(p.credits)}
            </td>
            <td style={cell}>
              <input type="checkbox" aria-label={`${p.name} on sale`} checked={p.active} disabled={!canEdit}
                onChange={() => run(() => withMarginCheck((extra) => adminApi.updatePlan(p.id, { ...p, active: !p.active, ...extra })), p.active ? `${p.name} taken off sale.` : `${p.name} back on sale.`)} />
            </td>
            <td style={cell}>
              {p.inStripe ? <span style={{ color: C.teal, fontWeight: 600 }}>In Stripe</span> : canEdit && stripeReady ? (
                <button type="button" style={btn(false)} onClick={() => run(() => adminApi.syncPlan(p.id), "Created in Stripe.")}>Create in Stripe</button>
              ) : "Not yet"}
            </td>
            <td style={{ ...cell, fontSize: 12.5 }}>
              {rulesText(p.rules, Object.fromEntries(providers.map((x) => [x.id, x.name])))}
              {canEdit && (
                <button type="button" style={{ ...btn(false), marginLeft: 8, padding: "2px 8px" }}
                  onClick={() => setRulesFor(rulesFor?.id === p.id ? null : { id: p.id, providers: p.rules?.providers ?? null, cost_cap_pct: p.rules?.cost_cap_pct ?? "" })}>
                  {rulesFor?.id === p.id ? "Close" : "Edit"}
                </button>
              )}
            </td>
          </tr>
          {rulesFor?.id === p.id && (
            <tr>
              <td colSpan={8} style={{ ...cell, background: "#F9FAFB" }}>
                <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 6 }}>
                  Providers this plan may use (a company on several plans may use any provider one of them includes), and the fair-use cap:
                  how much our cost may reach, as a share of what the company paid this billing period. At 80% its admins are told; at 100% paid lookups pause until a top-up or the next period.
                </div>
                <label style={{ fontSize: 13, marginRight: 14 }}>
                  <input type="checkbox" checked={rulesFor.providers == null} onChange={(e) => setRulesFor({ ...rulesFor, providers: e.target.checked ? null : providers.map((x) => x.id) })} /> All providers
                </label>
                {rulesFor.providers != null && providers.map((x) => (
                  <label key={x.id} style={{ fontSize: 13, marginRight: 12, whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={rulesFor.providers.includes(x.id)}
                      onChange={(e) => setRulesFor({ ...rulesFor, providers: e.target.checked ? [...rulesFor.providers, x.id] : rulesFor.providers.filter((id) => id !== x.id) })} /> {x.name}
                  </label>
                ))}
                <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 13 }}>Fair-use cap</span>
                  <input type="number" min="5" max="100" placeholder="off" aria-label={`Fair-use cap for ${p.name}`} value={rulesFor.cost_cap_pct}
                    onChange={(e) => setRulesFor({ ...rulesFor, cost_cap_pct: e.target.value })} style={{ ...input, width: 80 }} />
                  <span style={{ fontSize: 13, color: C.slate }}>% (empty: no cap)</span>
                  <button type="button" style={btn(true)} onClick={() => run(async () => {
                    await adminApi.updatePlan(p.id, { ...p, rules: { providers: rulesFor.providers, cost_cap_pct: rulesFor.cost_cap_pct === "" ? null : Number(rulesFor.cost_cap_pct) } });
                    setRulesFor(null);
                  }, `${p.name}: what it includes is saved.`)}>Save</button>
                </div>
              </td>
            </tr>
          )}
          </React.Fragment>
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
              await withMarginCheck((extra) => adminApi.createPlan({ wallet: plan.wallet, kind: plan.kind, name: plan.name, priceUsdCents: Math.round(Number(plan.priceUsd) * 100), credits: Number(plan.credits), ...extra }));
              setPlan(EMPTY_PLAN);
            }, "Plan added. Create it in Stripe to put it on sale.")}><Plus size={13} /> Add</button>
          </div>
        </>
      )}

      <div style={heading}>What each activity costs (credits)</div>
      <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 8 }}>
        Change a price and press Save. It applies to everything started from then on; work already under way keeps the price it began with.
        Half credits are fine. 0 makes the activity free.
      </div>
      {rates && (
        <>
          <Table head={["App", "Activity", "Per", "Credits", "Standard"]} minWidth={640}>
            {Object.entries(rates)
              .sort(([, a], [, b]) => WALLET_ORDER.indexOf(a.wallet) - WALLET_ORDER.indexOf(b.wallet))
              .map(([k, r]) => {
                const changed = Number(rateDraft[k]) !== r.credits;
                return (
                  <tr key={k}>
                    <td style={cell}>{WALLETS.find(([w]) => w === r.wallet)?.[1] || r.wallet}</td>
                    <td style={cell}>{r.label}</td>
                    <td style={{ ...cell, color: C.slate }}>{r.unit}</td>
                    <td style={cell}>
                      <input type="number" min="0" step="0.5" aria-label={`Credits for ${r.label}`} disabled={!canEdit} value={rateDraft[k] ?? ""}
                        onChange={(e) => setRateDraft({ ...rateDraft, [k]: e.target.value })}
                        style={{ ...input, width: 90, ...mono, borderColor: changed ? C.teal : undefined }} />
                    </td>
                    <td style={{ ...cell, ...mono, color: C.slate }}>{r.standard}</td>
                  </tr>
                );
              })}
          </Table>
          {canEdit && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button type="button" style={btn(true)} onClick={() => {
                const bad = Object.entries(rateDraft).find(([, v]) => v === "" || !(Number(v) >= 0));
                if (bad) return run(async () => { throw new Error(`Enter a price for "${rates[bad[0]].label}" (0 or more).`); });
                const draft = Object.fromEntries(Object.entries(rateDraft).map(([k, v]) => [k, Number(v)]));
                return run(() => withMarginCheck((extra) => adminApi.setRates(draft, extra)).then(load), "Prices saved.");
              }}>Save prices</button>
              <button type="button" style={btn(false)} onClick={() => setRateDraft(Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, String(v.standard)])))}>Fill in standard prices</button>
            </div>
          )}
        </>
      )}

      <MarginCheck canEdit={canEdit} key={JSON.stringify(rates || {}) + plans.length} />
      <TelnyxMargin canEdit={canEdit} />
      <MonthReport canEdit={canEdit} />
    </>
  );
}

const right = { ...cell, textAlign: "right", ...mono, whiteSpace: "nowrap" };
const pence = (v) => (v == null ? "—" : v >= 100 ? `£${(v / 100).toFixed(2)}` : `${Number(v).toFixed(1)}p`);
const STATUS = { below: ["Below the floor", C.red], unknown: ["Cost not known", C.amber], ok: ["OK", C.teal], free: ["No cost to us", C.slate] };

// Every activity's margin at the cheapest credit on sale against its worst-case cost (services/margin_guard.py). Saving a price or a
// plan that would put an activity below the floor asks for a reason first.
function MarginCheck({ canEdit }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => adminApi.margins().then(setData, (e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const [msg, run] = useAction(load);
  if (err) return <Note error>{err}</Note>;
  if (!data) return null;
  const s = data.settings;
  const floor = s.floor_pct;
  return (
    <>
      <div style={heading}>Margin check</div>
      <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 8 }}>
        Each activity at the cheapest credit on sale ({s.prices_include_vat ? "prices taken to include 20% VAT" : "prices taken to be before VAT"}, less Stripe's {s.stripe_pct}% + {s.stripe_fixed_pence}p),
        against the most one unit can cost us. $1 = £{data.usdToGbp}. Below {floor}% is flagged, and a change that causes it asks for a reason.
      </div>
      <Note error={msg.error}>{msg.text}</Note>
      {canEdit && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <label style={{ fontSize: 13 }}>Margin floor <input type="number" min="0" max="95" defaultValue={floor} aria-label="Margin floor"
            onBlur={(e) => Number(e.target.value) !== floor && run(() => adminApi.setMarginSettings({ floorPct: Number(e.target.value) }), "Floor saved.")} style={{ ...input, width: 70 }} /> %</label>
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={s.prices_include_vat}
            onChange={(e) => run(() => adminApi.setMarginSettings({ pricesIncludeVat: e.target.checked }), "Saved.")} /> Prices include VAT</label>
        </div>
      )}
      <Table head={["Activity", "App", "Credits", "Net a credit", "Brings in", "Worst cost", "Margin", ""]} minWidth={820}>
        {data.items.map((r) => {
          const [label, tone] = STATUS[r.status] || [r.status, C.slate];
          const needed = r.status === "below" && r.creditPence && r.worstCostPence != null ? Math.ceil(r.worstCostPence / (r.creditPence * (1 - floor / 100))) : null;
          return (
            <tr key={r.item}>
              <td style={cell}>{r.label}</td>
              <td style={cell}>{WALLETS.find(([w]) => w === r.wallet)?.[1] || r.wallet}</td>
              <td style={right}>{r.credits}</td>
              <td style={right}>{pence(r.creditPence)}</td>
              <td style={right}>{pence(r.revenuePence)}</td>
              <td style={right}>{pence(r.worstCostPence)}</td>
              <td style={{ ...right, color: tone }}>{r.marginPct == null ? "—" : `${r.marginPct}%`}</td>
              <td style={{ ...cell, fontSize: 12, color: tone }}>{label}{needed ? ` · needs ${needed} credits` : ""}</td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
const amount = (v, cur) => `${Number(v || 0).toFixed(2)} ${(cur || "").toUpperCase()}`;

// For a month: what Telnyx charged us for each customer's billing group next to the minutes we
// billed and what the customer paid us, so the margin stays visible.
function TelnyxMargin({ canEdit }) {
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
      <VoiceCheck month={month} canEdit={canEdit} />
    </>
  );
}

// The owner's month-end summary of plans (who joined, started, cancelled and why, ended). It goes by itself from the 1st; this sends one now.
function MonthReport({ canEdit }) {
  const last = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (d) => {
    setBusy(true);
    setMsg("");
    try {
      const r = await adminApi.sendBillingReport(d.getFullYear(), d.getMonth() + 1);
      setMsg(r.sent ? `Sent to ${r.sent} staff admin${r.sent === 1 ? "" : "s"}.` : "Nobody could be emailed: check the system mailbox and the staff admins' addresses.");
    } catch (err) {
      setMsg(err.message);
    }
    setBusy(false);
  };
  const name = (d) => d.toLocaleString([], { month: "long", year: "numeric" });
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        <b>Month-end plan report:</b>
        <span style={{ color: C.slate }}>emailed to the staff admins by itself from the 1st: who joined, who left and why.</span>
        {canEdit && <button type="button" style={btn(false, busy)} disabled={busy} onClick={() => send(last)}>Send {name(last)} now</button>}
      </div>
      <Note error>{msg}</Note>
    </div>
  );
}

// The saved monthly check (run by itself on the 2nd for last month): customers whose minutes
// charged and Telnyx's billed minutes differ by more than 5 minutes and 5%.
function VoiceCheck({ month, canEdit }) {
  const [check, setCheck] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    adminApi.voiceCheck(month).then((r) => live && setCheck(r.result), () => live && setCheck(null));
    return () => { live = false; };
  }, [month]);
  const run = async () => {
    setBusy(true);
    setMsg("");
    try {
      setCheck((await adminApi.runVoiceCheck(month)).result);
    } catch (err) {
      setMsg(err.message);
    }
    setBusy(false);
  };
  const gaps = (check?.rows || []).filter((r) => r.flagged);
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        <b>Monthly check, {month}:</b>
        {check ? (
          <span style={{ color: gaps.length ? C.red : C.teal }}>
            {gaps.length ? `${gaps.length} customer${gaps.length === 1 ? "" : "s"} with a gap` : "minutes agree"} · checked {when(check.at)}
          </span>
        ) : <span style={{ color: C.slate }}>not checked yet (runs by itself on the 2nd for last month)</span>}
        {canEdit && <button type="button" style={btn(false, busy)} disabled={busy} onClick={run}>{busy && <RefreshCw size={13} />} {check ? "Check again" : "Check now"}</button>}
      </div>
      <Note error>{msg}</Note>
      {gaps.length > 0 && (
        <Table head={["Customer", "Minutes we charged", "Minutes Telnyx billed", "Gap"]} minWidth={480}>
          {gaps.map((r) => (
            <tr key={r.orgId}>
              <td style={{ ...cell, fontFamily: FONT_BODY }}>{r.name}</td>
              <td style={right}>{fmt(r.minutesBilled)}</td>
              <td style={right}>{fmt(r.telnyxMinutes)}</td>
              <td style={{ ...right, color: C.red }}>{r.gapMinutes > 0 ? "+" : ""}{fmt(r.gapMinutes)}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
