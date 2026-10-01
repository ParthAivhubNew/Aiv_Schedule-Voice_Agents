import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { C, FONT_DISPLAY } from "../tokens";
import { adminApi } from "./adminApi";
import { AwardsTable } from "./GiveCredits";
import { Note, PageTitle, Table, btn, card, cell, fmt, heading, input, mono, money, useAction, useLoad } from "./ui";

const right = { ...cell, textAlign: "right", ...mono, whiteSpace: "nowrap" };
const amounts = (byCurrency) => {
  const parts = Object.entries(byCurrency || {}).filter(([, v]) => v).map(([cur, cents]) => money(cents, cur));
  return parts.length ? parts.join(" + ") : "—";
};

// A month of money in and out: what clients paid per app, what they used, what that cost us
// (units x our cost per unit, set below), the margin per client, and subscriptions.
export function Revenue({ canEdit }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [report, awards] = await Promise.all([adminApi.revenue(month), adminApi.awards({ month })]);
      setData({ ...report, awards });
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const tile = (label, value, tone) => (
    <div style={card}>
      <div style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: tone || C.textInk }}>{value}</div>
    </div>
  );
  const subs = data?.subscriptions || {};
  return (
    <>
      <PageTitle title="Revenue" sub="Money in, usage, our cost and margin, per month. Amounts stay in the currency they were paid in."
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <input type="month" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} style={input} />
            <button type="button" style={btn(false, busy)} disabled={busy} onClick={load}><RefreshCw size={13} /> Refresh</button>
          </div>
        } />
      <Note error>{error}</Note>
      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
            {tile("Paid this month", amounts(Object.values(data.revenue).reduce((acc, byCur) => {
              Object.entries(byCur).forEach(([cur, v]) => { acc[cur] = (acc[cur] || 0) + v; });
              return acc;
            }, {})))}
            {tile("Payments", fmt(data.payments))}
            {tile("Failed payments", fmt(data.failedPayments), data.failedPayments ? C.red : undefined)}
            {tile("Live subscriptions", fmt((subs.active || 0) + (subs.trialing || 0)))}
            {tile("Behind on payment", fmt(subs.past_due || 0), subs.past_due ? C.amber : undefined)}
            {tile("Live plans, per month", amounts(data.monthlyPlans))}
            {tile("Credits given free", fmt(Object.values(data.given || {}).reduce((a, b) => a + b, 0)), C.amber)}
          </div>
          {!data.costsSet && <Note error>Our cost per unit is not set yet, so costs and margins show as 0. Set them below.</Note>}

          <div style={heading}>Per app</div>
          <Table head={["App", "Paid", "Credits used", "Given free", "Our cost", "Margin"]} minWidth={560}>
            {(data.apps || []).length === 0 && <tr><td colSpan={6} style={{ ...cell, color: C.slate }}>Nothing this month.</td></tr>}
            {(data.apps || []).map((a) => (
              <tr key={a.wallet}>
                <td style={cell}>{a.name}</td>
                <td style={right}>{amounts(a.paid)}</td>
                <td style={right}>{fmt(a.credits)}</td>
                <td style={right}>{fmt(a.given)}</td>
                <td style={right}>{money(a.costCents, data.currency)}</td>
                <td style={{ ...right, color: a.marginCents == null ? C.slate : a.marginCents < 0 ? C.red : C.teal }}>
                  {a.marginCents == null ? "other currency" : money(a.marginCents, data.currency)}
                </td>
              </tr>
            ))}
          </Table>

          <div style={heading}>Usage and our cost</div>
          <Table head={["What", "Units", "Credits charged", `Our cost per unit (${data.currency.toUpperCase()})`, "Our cost"]}>
            {data.usage.length === 0 && <tr><td colSpan={5} style={{ ...cell, color: C.slate }}>No usage this month.</td></tr>}
            {data.usage.map((u) => (
              <tr key={u.item}>
                <td style={cell}>{u.label}</td>
                <td style={right}>{fmt(u.units)}</td>
                <td style={right}>{fmt(u.credits)}</td>
                <td style={right}>{u.unitCost ? money(u.unitCost, data.currency) : "not set"}</td>
                <td style={right}>{money(u.costCents, data.currency)}</td>
              </tr>
            ))}
          </Table>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 6 }}>Telnyx's own cost per client (from Telnyx's usage report) is under Plans & pricing → Telnyx costs and margin.</div>

          <div style={heading}>Credits given by staff</div>
          <AwardsTable rows={data.awards || []} showClient />
          <div style={{ fontSize: 12, color: C.slate, marginTop: 6 }}>"Given (no payment)" is never revenue. Offline and other payments count in "Paid" above, in the currency paid.</div>

          <div style={heading}>Per client</div>
          <Table head={["Client", "Paid", "Credits used", "Our cost", "Margin"]}>
            {data.clients.length === 0 && <tr><td colSpan={5} style={{ ...cell, color: C.slate }}>Nothing this month.</td></tr>}
            {data.clients.map((r) => (
              <tr key={r.orgId}>
                <td style={cell}>{r.name}</td>
                <td style={right}>{amounts(r.paid)}</td>
                <td style={right}>{fmt(r.credits)}</td>
                <td style={right}>{money(r.costCents, data.currency)}</td>
                <td style={{ ...right, color: r.marginCents == null ? C.slate : r.marginCents < 0 ? C.red : C.teal }}>
                  {r.marginCents == null ? "other currency" : money(r.marginCents, data.currency)}
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
      <UnitCosts canEdit={canEdit} onSaved={load} />
    </>
  );
}

// Our own cost of one unit of each rate-card item (a call minute, a post, a lead...).
function UnitCosts({ canEdit, onSaved }) {
  const [data, err, reload] = useLoad(adminApi.unitCosts);
  const [draft, setDraft] = useState(null);
  const [msg, run] = useAction(async () => { await reload(); await onSaved(); });
  useEffect(() => {
    if (data) setDraft({ currency: data.currency, costs: Object.fromEntries(Object.entries(data.costs).map(([k, v]) => [k, String(v || "")])) });
  }, [data]);
  if (!data || !draft) return <Note error>{err}</Note>;
  return (
    <>
      <div style={heading}>Our cost per unit</div>
      <Note error={msg.error}>{msg.text}</Note>
      <div style={{ ...card, display: "grid", gap: 10 }}>
        <div style={{ fontSize: 12.5, color: C.slate }}>
          What one unit costs us (Telnyx, AI, data providers), in {draft.currency === "gbp" ? "pence" : "cents"}. Used for the costs and margins above.
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
          Currency
          <select aria-label="Cost currency" value={draft.currency} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} style={input}>
            <option value="gbp">GBP</option><option value="usd">USD</option><option value="eur">EUR</option>
          </select>
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
          {data.items.map((it) => (
            <label key={it.key} style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
              {it.label} <span style={{ color: C.slate, fontSize: 11.5 }}>per {it.unit}</span>
              <input aria-label={`Our cost per ${it.unit}: ${it.label}`} type="number" min="0" step="0.01" disabled={!canEdit}
                value={draft.costs[it.key] ?? ""} onChange={(e) => setDraft({ ...draft, costs: { ...draft.costs, [it.key]: e.target.value } })} style={input} />
            </label>
          ))}
        </div>
        {canEdit && (
          <button type="button" style={{ ...btn(true), justifySelf: "start" }}
            onClick={() => run(() => adminApi.setUnitCosts({ currency: draft.currency, costs: Object.fromEntries(Object.entries(draft.costs).map(([k, v]) => [k, Number(v) || 0])) }), "Saved.")}>
            Save costs
          </button>
        )}
      </div>
    </>
  );
}
