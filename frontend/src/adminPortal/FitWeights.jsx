import React, { useEffect, useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, btn, card, input, useAction, useLoad } from "./ui";

// How much each part of a client's fit score counts. Staff admins change it here; every client's scores use it within a minute.
export function FitWeights({ canEdit }) {
  const [data, error, reload] = useLoad(adminApi.fitWeights);
  const [form, setForm] = useState(null);
  const [msg, run] = useAction(reload);
  useEffect(() => { if (data) setForm(Object.fromEntries(Object.entries(data.weights).map(([k, v]) => [k, String(v)]))); }, [data]);
  if (!data || !form) return <Note error>{error}</Note>;
  const total = Object.values(form).reduce((s, v) => s + (Number(v) || 0), 0);
  const asNumbers = () => Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v)]));
  return (
    <div style={{ ...card, display: "grid", gap: 10 }}>
      <div style={{ fontSize: 12.5, color: C.slate }}>
        Points for each part of the fit score clients see. A part a client's ideal customer leaves open is left out of their total, so scores stay out of 100. The parts must add up to 100.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {Object.keys(data.weights).map((k) => (
          <label key={k} style={{ display: "grid", gap: 4, fontSize: 12.5, fontWeight: 600, color: C.textInk }}>
            {data.labels[k] || k}
            <input type="number" min={0} max={100} step={1} style={input} disabled={!canEdit} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: total === 100 ? C.slate : C.red }}>Total: {total} of 100</div>
      <Note error={msg.error}>{msg.text}</Note>
      {canEdit ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={btn(true, total !== 100)} disabled={total !== 100} onClick={() => run(() => adminApi.setFitWeights(asNumbers()), "Saved. New scores use these points.")}>Save</button>
          <button type="button" style={btn(false)} onClick={() => setForm(Object.fromEntries(Object.entries(data.defaults).map(([k, v]) => [k, String(v)])))}>Back to the defaults</button>
        </div>
      ) : <div style={{ fontSize: 12, color: C.slate }}>Only staff admins can change these.</div>}
    </div>
  );
}
