import React, { useCallback, useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";

// Leads credits, always in view: what is left, what a running job has on hold, and what was used lately.
// Refreshes on its own, and straight away when something that spends credits finishes (see announceCreditsChanged).

export const CREDITS_EVENT = "leads-credits-changed";
export const announceCreditsChanged = () => {
  try { window.dispatchEvent(new Event(CREDITS_EVENT)); } catch { /* nothing is listening */ }
};

export function CreditsChip({ onOpen }) {
  const [c, setC] = useState(null);
  const load = useCallback(() => {
    api.getLeadCredits().then(setC).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    window.addEventListener(CREDITS_EVENT, load);
    return () => { clearInterval(t); window.removeEventListener(CREDITS_EVENT, load); };
  }, [load]);
  if (!c) return null;
  const tone = c.empty ? C.red : c.low ? "#B45309" : C.ink;
  const tip = [
    `${c.balance.toLocaleString()} Leads credits left to spend.`,
    c.held ? `${c.held.toLocaleString()} more are held by a job that is running; whatever it doesn't use is given back.` : "",
    `${c.used_30d.toLocaleString()} used in the last 30 days (${c.used_today.toLocaleString()} today).`,
    c.empty ? "You are out of credits. Top up to keep searching." : c.low ? "Running low." : "",
  ].filter(Boolean).join(" ");
  return (
    <button type="button" onClick={onOpen} title={tip} aria-label={tip}
      style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 11px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", cursor: onOpen ? "pointer" : "default", fontFamily: FONT_BODY, fontSize: 12.5, color: tone }}>
      <Coins size={14} />
      <strong style={{ fontVariantNumeric: "tabular-nums" }}>{c.balance.toLocaleString()}</strong>
      <span style={{ color: C.slate }}>credits</span>
      {c.held ? <span style={{ color: C.slate, fontSize: 11.5 }}>· {c.held.toLocaleString()} on hold</span> : null}
      <span className="hide-mobile" style={{ color: C.slate, fontSize: 11.5 }}>· {c.used_30d.toLocaleString()} used (30 days)</span>
    </button>
  );
}
