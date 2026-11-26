import React, { useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, Pill, Table, btn, cell, heading, input, useAction, useLoad } from "./ui";

// A monthly budget per supplier (backend/app/services/provider_budgets.py). This month's cost comes from the cost ledger. Staff hear at
// 80% and 100%; with "pause at the limit" on, the supplier isn't called again until the month turns or the budget is raised. AI models
// don't go through the provider wrapper, so for them a budget only alerts. Only staff admins can change budgets.
const STATE = { ok: ["green", "Under budget"], near: ["amber", "Over 80%"], over: ["red", "Over budget"], paused: ["red", "Paused"] };
const usd = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Row({ p, onSave }) {
  const [amount, setAmount] = useState(p.budgetUsd ?? "");
  const [pause, setPause] = useState(p.pause);
  const changed = String(amount) !== String(p.budgetUsd ?? "") || pause !== p.pause;
  const [tone, word] = STATE[p.state] || [];
  return (
    <tr>
      <td style={cell}><div style={{ fontWeight: 600 }}>{p.name}</div>{p.name !== p.id ? <div style={{ fontSize: 12, color: C.slate }}>{p.id}</div> : null}</td>
      <td style={cell}>{usd(p.spentUsd)}{p.pct !== null && p.pct !== undefined ? <div style={{ fontSize: 12, color: C.slate }}>{p.pct}% of the budget</div> : null}</td>
      <td style={cell}>
        <input style={{ ...input, width: 110 }} type="number" min="0" step="1" placeholder="No budget" value={amount} aria-label={`Monthly budget for ${p.name}, in US dollars`}
          onChange={(e) => setAmount(e.target.value)} />
      </td>
      <td style={cell}>
        {p.throughWrapper ? (
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
            <input type="checkbox" checked={pause} onChange={(e) => setPause(e.target.checked)} /> Pause at the limit
          </label>
        ) : <span style={{ fontSize: 12, color: C.slate }}>Alerts only</span>}
      </td>
      <td style={cell}>{word ? <Pill tone={tone}>{word}</Pill> : null}</td>
      <td style={cell}>
        <button type="button" style={btn(changed, !changed)} disabled={!changed}
          onClick={() => onSave(p, amount === "" ? null : Number(amount), pause)}>Save</button>
      </td>
    </tr>
  );
}

export function ProviderBudgets() {
  const [data, err, reload] = useLoad(adminApi.providerBudgets);
  const [msg, run] = useAction(reload);
  const save = (p, amount, pause) => run(() => adminApi.saveProviderBudget(p.id, { usd: amount, pause }),
    amount ? `${p.name}: budget saved.` : `${p.name}: budget removed.`);
  const rows = data?.providers || [];
  return (
    <>
      <div style={heading}>Monthly budgets{data?.month ? ` · ${data.month}` : ""}</div>
      <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 8 }}>
        What each supplier has cost this month, from the cost ledger. You hear at 80% and 100% of a budget. With “Pause at the limit”, the
        supplier isn't called again until next month or until you raise its budget, so clients get “nothing found” from it.
      </div>
      <Note error={!!err}>{err}</Note>
      <Note error={msg.error}>{msg.text}</Note>
      {rows.length > 0 && (
        <Table head={["Supplier", "This month", "Budget (US$)", "At the limit", "", ""]} minWidth={760}>
          {rows.map((p) => <Row key={`${p.id}:${p.budgetUsd}:${p.pause}`} p={p} onSave={save} />)}
        </Table>
      )}
    </>
  );
}
