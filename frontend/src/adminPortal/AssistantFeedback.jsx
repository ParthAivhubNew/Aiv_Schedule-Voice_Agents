import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { C } from "../tokens";
import { adminApi } from "./adminApi";
import { Note, PageTitle, Table, btn, card, cell, fmt, heading, input, useAction, when } from "./ui";

const PLUGIN_NAMES = { leads: "Leads", voice: "Voice", social: "Social" };
const right = { ...cell, textAlign: "right", whiteSpace: "nowrap" };

// How the assistants are doing, from the thumbs people press under their answers: the up rate for each assistant, why answers went wrong,
// and the latest ones with the question that was asked. No organisation or person is named. A fixed one leaves the list.
export function AssistantFeedback({ canEdit }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { setData(await adminApi.assistantFeedback(days)); } catch (err) { setError(err.message); }
    setBusy(false);
  }, [days]);
  useEffect(() => { load(); }, [load]);
  const [msg, run] = useAction(load);

  return (
    <div>
      <PageTitle title="Assistant feedback" sub="Thumbs on assistant answers. Use the problems here to improve the prompts, synonyms and search rules."
        right={(
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} style={input}>
              <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
            </select>
            <button type="button" style={btn(false, busy)} disabled={busy} onClick={load}><RefreshCw size={13} /> Refresh</button>
          </div>
        )} />
      <Note error>{error}</Note>
      <Note error={msg.error}>{msg.text}</Note>
      {data ? (
        <>
          <div style={heading}>By assistant</div>
          <Table head={["Assistant", "Thumbs up", "Thumbs down", "Up rate"]} minWidth={420}>
            {Object.entries(data.by_plugin).map(([k, v]) => (
              <tr key={k}>
                <td style={cell}>{PLUGIN_NAMES[k] || k}</td>
                <td style={right}>{fmt(v.up)}</td>
                <td style={right}>{fmt(v.down)}</td>
                <td style={right}>{v.up_rate == null ? "—" : `${v.up_rate}%`}</td>
              </tr>
            ))}
          </Table>

          <div style={heading}>Why answers went wrong</div>
          {data.top_reasons.length ? (
            <Table head={["Assistant", "Reason", "Times"]} minWidth={360}>
              {data.top_reasons.map((r) => (
                <tr key={`${r.plugin}-${r.reason}`}>
                  <td style={cell}>{PLUGIN_NAMES[r.plugin] || r.plugin}</td>
                  <td style={cell}>{r.label}</td>
                  <td style={right}>{fmt(r.count)}</td>
                </tr>
              ))}
            </Table>
          ) : <div style={{ fontSize: 12.5, color: C.slate }}>No thumbs down in this period.</div>}

          <div style={heading}>Latest problems</div>
          <div style={{ display: "grid", gap: 10 }}>
            {data.recent.map((r) => (
              <div key={r.id} style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 12, color: C.slate }}>
                  <span>{PLUGIN_NAMES[r.plugin] || r.plugin} · {r.reason} · {when(r.at)}</span>
                  {canEdit ? (
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      <button type="button" style={btn(false)} onClick={() => run(() => adminApi.setAssistantFeedbackStatus(r.id, "fixed"), "Marked as fixed.")}>Fixed</button>
                      <button type="button" style={btn(false)} onClick={() => run(() => adminApi.setAssistantFeedbackStatus(r.id, "dismissed"), "Dismissed.")}>Dismiss</button>
                    </span>
                  ) : null}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, margin: "6px 0 2px", overflowWrap: "anywhere" }}>Asked: {r.question || "—"}</div>
                {r.note ? <div style={{ fontSize: 12.5, overflowWrap: "anywhere" }}>They said: {r.note}</div> : null}
                <div style={{ fontSize: 12.5, color: C.slate, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>Answered: {r.answer || "—"}</div>
                {r.context?.filters ? <div style={{ fontSize: 11.5, color: C.slate, marginTop: 4, overflowWrap: "anywhere" }}>Filters used: {JSON.stringify(r.context.filters)}{r.context.total != null ? ` · ${fmt(r.context.total)} matched` : ""}</div> : null}
              </div>
            ))}
            {!data.recent.length ? <div style={{ fontSize: 12.5, color: C.slate }}>Nothing to fix.</div> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
