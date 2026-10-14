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
export function useLeadCredits() {
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
  return c;
}

// "1 credit", "2.5 credits", "Free".
export const creditWord = (n) => (!n ? "Free" : `${n} credit${n === 1 ? "" : "s"}`);

// What the main things cost, in words a person reads before pressing a button. Missing prices are left out.
export function priceLines(rates) {
  const r = rates || {};
  const line = (key, label, per) => (r[key] ? [label, `${creditWord(r[key].credits)}${per}`] : null);
  return [
    ["Search the company register", "Free"],
    line("lead_lookup", "Web search or look-up", " per company found"),
    line("google_deep_search", "Deep web search", " if it finds something"),
    line("lead_phone_check", "Check phone numbers", r.lead_phone_check ? ` per ${r.lead_phone_check.unit}` : ""),
    line("lead_email_write", "Write personal email lines", r.lead_email_write ? ` per ${r.lead_email_write.unit}` : ""),
    line("email_send", "Send an email", " each"),
  ].filter(Boolean);
}

// Shown at the top of Find Leads and Lists: what is left, and what things cost, before anything is pressed.
export function PlanStrip({ onOpen }) {
  const c = useLeadCredits();
  if (!c) return null;
  const tone = c.empty ? C.red : c.low ? "#B45309" : C.ink;
  const lines = priceLines(c.rates);
  return (
    <div className="ui-card" style={{ display: "flex", flexWrap: "wrap", marginBottom: 16, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "12px 18px", borderRight: `1px solid ${C.border}`, minWidth: 190, flex: "0 0 auto" }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: C.slateLight }}>Credits left</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 24, fontWeight: 700, color: tone, fontVariantNumeric: "tabular-nums" }}>{c.balance.toLocaleString()}</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate }}>
          {c.used_30d.toLocaleString()} used in 30 days{c.held ? ` · ${c.held.toLocaleString()} on hold` : ""}
        </div>
        {c.empty ? <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.red, fontWeight: 600 }}>Out of credits</div> : c.low ? <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: "#B45309", fontWeight: 600 }}>Running low</div> : null}
        {onOpen ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ marginTop: 6 }} title="See your plan, what it includes and top up" onClick={onOpen}>Plan &amp; top up</button> : null}
      </div>
      <div style={{ padding: "12px 18px", flex: "1 1 320px", minWidth: 0 }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: C.slateLight }}>What things cost</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "4px 20px", marginTop: 6, fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>
          {lines.map(([what, price]) => (
            <div key={what} style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
              <span>{what}</span><strong style={{ color: price === "Free" ? "#15803D" : C.ink, whiteSpace: "nowrap" }}>{price}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CreditsChip({ onOpen }) {
  const c = useLeadCredits();
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
