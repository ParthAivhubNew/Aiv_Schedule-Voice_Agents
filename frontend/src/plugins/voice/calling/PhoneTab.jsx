import React, { useCallback, useEffect, useState } from "react";
import { PhoneCall } from "lucide-react";
import { api } from "../../../api/apiClient";
import { C, FONT_BODY } from "../../../tokens";
import { openPhone, openTranscript } from "../../../utils/humanCall";
import { OUTCOMES, transcriptWords } from "./humanCallLogic";

// Calls this person made themselves from the browser, with transcripts. Shown in Conversations > Calls, set apart from the AI's calls.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.45 };
const outcomeWord = (id) => (OUTCOMES.find((o) => o.id === id) || {}).label || "";

export function RecentHumanCalls({ showEmpty = false }) {
  const [calls, setCalls] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api.humanCallsMine().then((r) => { setCalls(r.calls || []); setError(""); }).catch((e) => setError(e.message || "Couldn't load your calls.")), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]); // a transcript finishes after the call
  if (calls && !calls.length && !error && !showEmpty) return null;

  return (
    <div className="ui-card" style={{ padding: "12px 14px", display: "grid", gap: 8, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ ...text, fontSize: 14 }}>Calls you made yourself</strong>
        <span style={{ ...text, fontSize: 11, fontWeight: 700, color: C.cobalt, background: C.cobaltSoft, borderRadius: 999, padding: "2px 8px" }}>You, not the AI</span>
      </div>
      {calls && !calls.length ? <div style={muted}>None yet. Press Call on the Call list, then Call myself, and the call shows here with its transcript.</div> : null}
      {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
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
  );
}
