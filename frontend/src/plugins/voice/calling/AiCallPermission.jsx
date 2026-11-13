import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Bot, User, X } from "lucide-react";
import { api } from "../../../api/apiClient";
import { C, FONT_BODY } from "../../../tokens";

// Shown on the spot when an AI call to a number is refused for want of recorded permission: say they agreed and the call goes
// ahead, or call them yourself. Nothing else to find, nowhere else to go.
const METHODS = [
  ["verbal_recorded", "They said yes on a recorded call"],
  ["web_form", "They ticked a box on a web form"],
  ["written", "They agreed in writing"],
  ["email", "They agreed by email"],
];

export function AiCallPermission({ number, name = "", company = "", onRecorded, onCallMyself, onClose }) {
  const [f, setF] = useState({ company, person: name, method: "verbal_recorded", confirmed: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const ready = f.confirmed && f.company.trim().length > 1;
  const record = async () => {
    setBusy(true);
    setError("");
    try {
      await api.callPermissionRecord({ number, company: f.company.trim(), person: f.person.trim(), method: f.method });
      await onRecorded?.();
    } catch (e) {
      setError(e.message || "Couldn't record that. Try again.");
      setBusy(false);
    }
  };
  const label = { display: "grid", gap: 4, fontSize: 12.5, color: C.slate, fontFamily: FONT_BODY };
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.45)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-label="Permission for an AI call" onClick={(e) => e.stopPropagation()} className="ui-card"
        style={{ width: "min(100%, 460px)", padding: 20, display: "grid", gap: 12, fontFamily: FONT_BODY }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 16, color: C.ink, flex: 1 }}>Has {name || number} agreed to AI calls?</strong>
          <button type="button" className="ui-icon-btn ui-icon-btn--sm" aria-label="Close" onClick={onClose}><X size={14} /></button>
        </div>
        <div style={{ fontSize: 13.5, color: C.slate, lineHeight: 1.5 }}>
          UK rules allow an AI-voiced call only to a number whose owner agreed to it. If they did, say how, and the call starts right away. The agreement is kept on record for {number}.
        </div>
        <label style={label}>Company they agreed to hear from
          <input className="ui-input" value={f.company} onChange={(e) => set({ company: e.target.value })} placeholder="Your company name" />
        </label>
        <label style={label}>How they agreed
          <select className="ui-input" value={f.method} onChange={(e) => set({ method: e.target.value })}>{METHODS.map(([k, w]) => <option key={k} value={k}>{w}</option>)}</select>
        </label>
        <label style={{ ...label, gridTemplateColumns: "auto 1fr", alignItems: "start", gap: 8, color: C.ink }}>
          <input type="checkbox" checked={f.confirmed} onChange={(e) => set({ confirmed: e.target.checked })} style={{ marginTop: 3 }} />
          I confirm they agreed to AI-voiced calls from this company, and I can show proof if asked.
        </label>
        {error ? <div role="alert" style={{ fontSize: 13, color: C.red }}>{error}</div> : null}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" className="ui-btn ui-btn--ghost" disabled={busy} onClick={onCallMyself} title="Call from your browser yourself. No AI permission is needed"><User size={14} /> Call myself instead</button>
          <button type="button" className="ui-btn ui-btn--primary" disabled={busy || !ready} onClick={record}><Bot size={14} /> {busy ? "Starting…" : "Record it and call with AI"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
