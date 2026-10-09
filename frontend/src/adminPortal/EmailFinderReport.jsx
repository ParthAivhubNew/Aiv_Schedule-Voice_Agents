import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, Table, btn, cell, fmt, heading, input, mono, useAction } from "./ui";

const right = { ...cell, textAlign: "right", ...mono, whiteSpace: "nowrap" };
const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const usd = (v) => (v == null ? "—" : `$${v.toFixed(v < 1 ? 3 : 2)}`);

// How each email-finder provider is doing: hit rate, spend, bounces and what a good email costs us.
// Staff only. The suggested order is advice; an admin chooses whether to use it.
export function EmailFinderReport({ canEdit }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, run] = useAction(() => load());

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await adminApi.emailFinderReport(days));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const label = (p) => data?.providers.find((r) => r.provider === p)?.label || p;
  const same = data && data.currentOrder.join() === data.suggestedOrder.join();
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ ...heading, margin: "22px 0 2px" }}>Email finder performance</div>
          <div style={{ fontSize: 12.5, color: C.slate }}>
            How often each provider finds a verified email, what we pay, and how many of its addresses later bounced.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} style={input}>
            <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
          <button type="button" style={btn(false, busy)} disabled={busy} onClick={load}><RefreshCw size={13} /> Refresh</button>
        </div>
      </div>
      <Note error>{error}</Note>
      <Note error={msg.error}>{msg.text}</Note>
      {data && (
        <>
          <div style={{ marginTop: 10 }}>
            <Table head={["Provider", "Lookups", "Verified", "Hit rate", "We paid", "Bounced", "Cost per good email"]} minWidth={620}>
              {data.providers.map((r) => (
                <tr key={r.provider}>
                  <td style={cell}>{r.label}</td>
                  <td style={right}>{fmt(r.lookups)}</td>
                  <td style={right}>{fmt(r.verified)}</td>
                  <td style={right}>{pct(r.hitRate)}</td>
                  <td style={right}>{usd(r.spendUsd)}</td>
                  <td style={{ ...right, color: r.bounceRate > 0.1 ? C.red : undefined }}>{r.bounced ? `${fmt(r.bounced)} (${pct(r.bounceRate)})` : "0"}</td>
                  <td style={right}>{usd(r.costPerGoodUsd)}</td>
                </tr>
              ))}
            </Table>
          </div>
          <div style={{ fontSize: 12.5, color: C.slate, marginTop: 8, display: "grid", gap: 4 }}>
            <div>Repeat searches answered from our own memory (no provider paid): {fmt(data.answeredFromCache)} found, {fmt(data.repeatMissesSkipped)} not found.</div>
            <div>Order used now: {data.currentOrder.map(label).join(" → ")}</div>
            <div>
              {data.enoughData
                ? <>Suggested (cheapest good email first): {data.suggestedOrder.map(label).join(" → ")}</>
                : "Not enough results yet to suggest a better order."}
            </div>
          </div>
          {canEdit && data.enoughData && !same && (
            <button type="button" style={{ ...btn(true), marginTop: 8 }}
              onClick={() => run(() => adminApi.setEmailFinderOrder(data.suggestedOrder), "Order saved. New searches use it.")}>
              Use the suggested order
            </button>
          )}
        </>
      )}
    </div>
  );
}
