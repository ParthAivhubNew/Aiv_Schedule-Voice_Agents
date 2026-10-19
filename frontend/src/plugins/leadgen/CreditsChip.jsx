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

// The Leads wallet and price list, kept fresh the same way for every part of the screen that shows them.
export function useLeadCredits(wallet = "leadgen") {
  const [c, setC] = useState(null);
  const load = useCallback(() => {
    (wallet === "leadgen" ? api.getLeadCredits() : api.getWalletGlance(wallet)).then(setC).catch(() => {});
  }, [wallet]);
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    window.addEventListener(CREDITS_EVENT, load);
    return () => { clearInterval(t); window.removeEventListener(CREDITS_EVENT, load); };
  }, [load]);
  return c;
}

// "1 credit", "2.5 credits", "Free".
export const creditWord = (n) => (!n ? "Free" : `${n} credit${n === 1 ? "" : "s"}`);

export function CreditsChip({ onOpen, wallet = "leadgen", app = "Leads" }) {
  const c = useLeadCredits(wallet);
  if (!c) return null;
  const unit = wallet === "voice" && c.rates?.voice_minute?.credits === 1 ? "minutes" : "credits";
  const tone = c.empty ? C.red : c.low ? "#B45309" : C.ink;
  const tip = [
    `${c.balance.toLocaleString()} ${app} ${unit} left to spend.`,
    c.held ? `${c.held.toLocaleString()} more are held by a job that is running; whatever it doesn't use is given back.` : "",
    `${c.used_30d.toLocaleString()} used in the last 30 days (${c.used_today.toLocaleString()} today).`,
    c.empty ? `You are out of ${unit}. Top up to keep going.` : c.low ? "Running low." : "",
  ].filter(Boolean).join(" ");
  return (
    <button type="button" onClick={onOpen} title={tip} aria-label={tip}
      style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 11px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", cursor: onOpen ? "pointer" : "default", fontFamily: FONT_BODY, fontSize: 12.5, color: tone }}>
      <Coins size={14} />
      <strong style={{ fontVariantNumeric: "tabular-nums" }}>{c.balance.toLocaleString()}</strong>
      <span className="hide-xs" style={{ color: C.slate }}>{unit}</span>
      {c.held ? <span style={{ color: C.slate, fontSize: 11.5 }}>· {c.held.toLocaleString()} on hold</span> : null}
      <span className="hide-mobile" style={{ color: C.slate, fontSize: 11.5 }}>· {c.used_30d.toLocaleString()} used in the last 30 days</span>
    </button>
  );
}
