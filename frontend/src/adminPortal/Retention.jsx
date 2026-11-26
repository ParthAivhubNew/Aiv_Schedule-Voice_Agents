import React, { useEffect, useState } from "react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, Pill, btn, card, input, useAction, useLoad } from "./ui";

// How long personal data and supplier logs are kept (backend/app/services/data_retention.py). Nothing is deleted until a staff admin
// switches retention on; until then each rule shows, as a dry run, what it would remove. The raw register data is reported only.
const fmt = (n) => Number(n || 0).toLocaleString();

export function Retention({ canEdit }) {
  const [data, err, reload] = useLoad(adminApi.retention);
  const [msg, run] = useAction(reload);
  const [days, setDays] = useState({});
  useEffect(() => {
    if (data?.rules) setDays(Object.fromEntries(data.rules.map((r) => [r.id, r.days])));
  }, [data]);
  if (!data) return <Note error={!!err}>{err}</Note>;

  const changed = data.rules.some((r) => Number(days[r.id]) !== r.days);
  const save = (on) => run(() => adminApi.saveRetention({ on, days }), on ? "Retention is on: it runs once a day." : "Retention is off: nothing is deleted.");
  const switchOn = () => {
    const due = data.rules.reduce((n, r) => n + r.dueNow, 0);
    if (window.confirm(`Switch retention on? It deletes for good, once a day. ${fmt(due)} item${due === 1 ? "" : "s"} would go at the next run.`)) save(true);
  };
  const runNow = () => {
    if (window.confirm("Run retention now? What is listed as due is deleted or blanked for good.")) run(() => adminApi.runRetention(), "Retention ran.");
  };
  const last = data.lastRun;
  return (
    <div style={{ ...card, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700 }}>How long data is kept</div>
        {data.on ? <Pill tone="green">On</Pill> : <Pill tone="amber">Off: nothing is deleted</Pill>}
      </div>
      <div style={{ fontSize: 12.5, color: C.slate }}>
        Once switched on, these rules run once a day. “Due now” is what the next run would remove. The 12-month review of saved companies and the
        deletion of browser-call audio work on their own.
      </div>
      <Note error={msg.error}>{msg.text}</Note>
      <div style={{ display: "grid", gap: 8 }}>
        {data.rules.map((r) => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
            <span style={{ flex: "1 1 280px" }}>{r.label}: {r.does} after</span>
            <input type="number" min={data.minDays} max={data.maxDays} disabled={!canEdit} aria-label={`Days to keep: ${r.label}`}
              style={{ ...input, width: 90 }} value={days[r.id] ?? r.days} onChange={(e) => setDays({ ...days, [r.id]: e.target.value })} />
            <span style={{ color: C.slate }}>days</span>
            <Pill tone={r.dueNow ? "amber" : "green"}>{fmt(r.dueNow)} due now</Pill>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: C.slate }}>
        Raw register data: {fmt(data.rawRegister.withRawData)} company records hold it, {fmt(data.rawRegister.closedWithRawData)} of them closed companies.
        It is never removed here: the register and where each value came from depend on it.
      </div>
      {last ? (
        <div style={{ fontSize: 12, color: C.slate }}>
          Last run {new Date(last.at).toLocaleString()}: {Object.entries(last.done || {}).map(([k, n]) => `${k.replace(/_/g, " ")} ${n < 0 ? "failed" : fmt(n)}`).join(" · ")}
        </div>
      ) : null}
      {canEdit && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {changed ? <button type="button" style={btn(true)} onClick={() => save(data.on)}>Save periods</button> : null}
          {data.on ? (
            <>
              <button type="button" style={btn(false)} onClick={runNow}>Run now</button>
              <button type="button" style={btn(false)} onClick={() => save(false)}>Switch off</button>
            </>
          ) : <button type="button" style={btn(true)} onClick={switchOn}>Switch retention on</button>}
        </div>
      )}
    </div>
  );
}
