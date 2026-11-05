import React, { useCallback, useEffect, useState } from "react";
import { PhoneCall } from "lucide-react";
import { api } from "../../../api/apiClient";
import { C, FONT_BODY } from "../../../tokens";
import { openPhone, openTranscript } from "../../../utils/humanCall";
import { OUTCOMES, cleanNumber, transcriptWords, validNumber } from "./humanCallLogic";

// Voice > Phone: call any number yourself from the browser, and see your last calls with their transcripts.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.45 };
const outcomeWord = (id) => (OUTCOMES.find((o) => o.id === id) || {}).label || "";

export function PhoneTab() {
  const [number, setNumber] = useState("");
  const [calls, setCalls] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api.humanCallsMine().then((r) => { setCalls(r.calls || []); setError(""); }).catch((e) => setError(e.message || "Couldn't load your calls.")), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]); // a transcript finishes after the call
  const dial = (e) => { e.preventDefault(); openPhone({ number: cleanNumber(number) }); };

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      <form onSubmit={dial} className="ui-card" style={{ padding: 16, display: "grid", gap: 10, border: `1px solid ${C.border}`, borderRadius: 12 }}>
        <strong style={{ ...text, fontSize: 15 }}>Call from your browser</strong>
        <span style={muted}>You talk to them yourself, with no AI on the line. Each minute uses voice credit. You can record the call and get a written transcript.</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input aria-label="Number to call" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+44 118 900 0123" inputMode="tel"
            style={{ ...text, flex: 1, minWidth: 200, fontSize: 16, padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 8 }} />
          <button type="submit" className="ui-btn ui-btn--primary" disabled={!validNumber(number)}><PhoneCall size={15} /> Call</button>
        </div>
      </form>

      <div style={{ display: "grid", gap: 8 }}>
        <strong style={{ ...text, fontSize: 14 }}>Your recent calls</strong>
        {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
        {calls && !calls.length ? <div style={muted}>No calls yet. Your calls appear here with their result and transcript.</div> : null}
        {(calls || []).map((c) => (
          <div key={c.call_ref} className="ui-card" style={{ padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 10, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ ...text, fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" }}>{c.name}</div>
              <div style={muted}>{c.started_at ? new Date(c.started_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""} · {c.minutes} min{outcomeWord(c.outcome) ? ` · ${outcomeWord(c.outcome)}` : ""}</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {c.record ? <span style={{ ...muted, fontWeight: 600, color: c.transcript === "ready" ? C.green : c.transcript === "failed" ? C.red : C.slate }}>{transcriptWords(c.transcript, c.transcript_error)}</span> : null}
              {c.record && c.transcript !== "none" ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => openTranscript(c.call_ref)}>Transcript</button> : null}
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => openPhone({ number: c.to, name: c.name !== c.to ? c.name : "", leadId: c.lead_id || "" })}><PhoneCall size={13} /> Call again</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
