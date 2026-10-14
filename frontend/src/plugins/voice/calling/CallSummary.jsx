import React, { useEffect, useState } from "react";
import { Mail, RefreshCw, Sparkles } from "lucide-react";
import { C, FONT_BODY } from "../../../tokens";

const small = { height: 28, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", color: C.textInk, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: FONT_BODY };

/**
 * The AI summary of a call. Never emailed on its own: "Email me this" sends it to the user who asks.
 * onWrite() returns the new text (or throws); onEmail() sends it to the signed-in user.
 */
export function CallSummary({ summary, onWrite, onEmail, urgent = false, label = "AI summary" }) {
  const [text, setText] = useState(summary || "");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => { setText(summary || ""); }, [summary]);

  const write = async () => {
    setBusy("write");
    setMsg("");
    try {
      const r = await onWrite();
      const next = typeof r === "string" ? r : r && r.summary;
      if (next) setText(next);
      else setMsg("Not enough was said yet to summarise.");
    } catch (e) {
      setMsg(e.message || "Could not write the summary.");
    } finally {
      setBusy("");
    }
  };
  const email = async () => {
    setBusy("email");
    setMsg("");
    try {
      const r = await onEmail();
      setMsg(r && r.to ? `Sent to ${r.to}.` : "Sent.");
    } catch (e) {
      setMsg(e.message || "Could not send it.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div style={{ marginTop: 12, borderRadius: 12, padding: "10px 12px", background: urgent ? C.redSoft : C.cobaltSoft, border: `1px solid ${urgent ? C.red : C.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: urgent ? C.red : C.cobaltDeep }}>
          <Sparkles size={12} /> {label}
        </span>
        <div style={{ flex: 1 }} />
        {onWrite ? (
          <button type="button" style={small} disabled={Boolean(busy)} onClick={write}>
            <RefreshCw size={12} /> {busy === "write" ? "Writing…" : text ? "Refresh" : "Write summary"}
          </button>
        ) : null}
        {onEmail && text ? (
          <button type="button" style={small} disabled={Boolean(busy)} onClick={email}>
            <Mail size={12} /> {busy === "email" ? "Sending…" : "Email me this"}
          </button>
        ) : null}
      </div>
      {text ? (
        <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.55, color: C.textInk, whiteSpace: "pre-wrap" }}>{text}</div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 12.5, color: C.slate }}>{urgent ? "Writing it now…" : "No summary yet."}</div>
      )}
      {msg ? <div style={{ marginTop: 6, fontSize: 11.5, color: C.slate }}>{msg}</div> : null}
    </div>
  );
}
