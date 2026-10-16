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

// What the main things cost, as price tiles: [what, price, what you get]. Missing prices are left out.
export function priceLines(rates) {
  const r = rates || {};
  const tile = (key, label, per, note) => (r[key] ? [label, creditWord(r[key].credits), per, note] : null);
  return [
    ["Company register", "Free", "", "Search every registered company"],
    tile("lead_lookup", "Web search", " per company found", "Companies from the open web"),
    tile("google_deep_search", "Deep web search", " if it finds something", "Finds a missing phone or website"),
    r.lead_phone_check ? ["Phone check", creditWord(r.lead_phone_check.credits), ` per ${r.lead_phone_check.unit}`, "Is the number real and live"] : null,
    r.lead_email_write ? ["Personal email lines", creditWord(r.lead_email_write.credits), ` per ${r.lead_email_write.unit}`, "Written for each lead"] : null,
    tile("email_send", "Send an email", " each", "Charged when it is sent"),
  ].filter(Boolean);
}

// Shown at the top of Find Leads and Lists: one slim line with what is left, and the price list one click away.
export function PlanStrip({ onOpen }) {
  const c = useLeadCredits();
  const [open, setOpen] = useState(false);
  if (!c) return null;
  const tone = c.empty ? C.red : c.low ? "#B45309" : C.ink;
  const tiles = priceLines(c.rates);
  const webCost = c.rates?.lead_lookup?.credits;
  const canBuy = webCost ? Math.floor(c.balance / webCost) : 0;
  const pct = Math.min(100, Math.round((c.balance / Math.max(c.balance + c.used_30d, 1)) * 100));
  const small = { fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate };
  return (
    <div className="ui-card" style={{ marginBottom: 16, padding: "10px 16px", display: "grid", gap: open ? 12 : 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
          <Coins size={15} color={tone} style={{ alignSelf: "center" }} />
          <strong style={{ fontFamily: FONT_BODY, fontSize: 20, color: tone, fontVariantNumeric: "tabular-nums" }}>{c.balance.toLocaleString()}</strong>
          <span style={small}>credits left</span>
        </span>
        <span aria-hidden style={{ width: 90, height: 5, borderRadius: 3, background: C.border, overflow: "hidden" }}>
          <span style={{ display: "block", width: `${pct}%`, height: "100%", background: tone }} />
        </span>
        <span style={small}>
          {c.used_30d.toLocaleString()} used in the last 30 days{c.held ? ` · ${c.held.toLocaleString()} on hold` : ""}
          {canBuy ? ` · enough for about ${canBuy.toLocaleString()} web-found companies` : ""}
        </span>
        {c.empty ? <strong style={{ ...small, color: C.red }}>Out of credits</strong> : c.low ? <strong style={{ ...small, color: "#B45309" }}>Running low</strong> : null}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Hide prices" : "See prices"}
          </button>
          {onOpen ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="See your plan and top up" onClick={onOpen}>Plan &amp; top up</button> : null}
        </span>
      </div>
      {open ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
          {tiles.map(([what, price, per, note]) => (
            <div key={what} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px" }}>
              <div style={{ ...small, fontWeight: 600, color: C.ink }}>{what}</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 15, fontWeight: 700, color: price === "Free" ? "#15803D" : C.ink }}>
                {price}<span style={{ ...small, fontSize: 11.5, fontWeight: 400 }}>{per}</span>
              </div>
              <div style={{ ...small, fontSize: 11.5 }}>{note}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
