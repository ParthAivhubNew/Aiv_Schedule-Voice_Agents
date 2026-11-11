import React, { useEffect, useRef, useState } from "react";
import { Target } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { api } from "../../api/apiClient";
import { fitTip, fitTone } from "./fitLogic";

const text = { fontFamily: FONT_BODY };

// Whether this company has set its ideal customer. Read once and shared; saving the ICP tells every list to read it again.
export const ICP_EVENT = "leadgen-icp-changed";
let cached = null;
const listeners = new Set();
export function icpChanged(next) {
  cached = next ? Promise.resolve(next) : null;
  listeners.forEach((fn) => fn());
  window.dispatchEvent(new Event(ICP_EVENT));
}
export function useIcp() {
  const [state, setState] = useState({ loading: true, icp: null, isSet: false, filters: {}, choices: null });
  useEffect(() => {
    let live = true;
    const load = () => {
      cached = cached || api.getIcp().catch(() => null);
      cached.then((r) => { if (live) setState({ loading: false, icp: r?.icp || null, isSet: Boolean(r?.is_set), filters: r?.filters || {}, choices: r?.choices || null }); });
    };
    load();
    listeners.add(load);
    return () => { live = false; listeners.delete(load); };
  }, []);
  return state;
}

// The score with its reasons: the first reason sits beside it, the full list opens on hover or focus.
export function FitBadge({ fit, compact = false }) {
  const [spot, setSpot] = useState(null);
  const ref = useRef(null);
  const tone = fitTone(fit?.score);
  if (!fit || !tone) return <span style={{ color: C.slateLight }}>—</span>;
  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setSpot({ top: Math.min(r.bottom + 6, window.innerHeight - 220), left: Math.max(8, Math.min(r.left, window.innerWidth - 336)) });
  };
  const reasons = fit.reasons || [];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: compact ? 120 : 260 }}>
      <button ref={ref} type="button" aria-label={fitTip(fit).replace(/\n/g, ". ")} onMouseEnter={open} onMouseLeave={() => setSpot(null)} onFocus={open} onBlur={() => setSpot(null)}
        onClick={(e) => { e.stopPropagation(); spot ? setSpot(null) : open(); }}
        style={{ all: "unset", cursor: "help", ...text, fontSize: 12, fontWeight: 700, color: tone.fg, background: tone.bg, borderRadius: 999, padding: "2px 8px", fontVariantNumeric: "tabular-nums", flex: "none" }}>
        {fit.score}
      </button>
      {compact ? null : <span style={{ ...text, fontSize: 11.5, color: C.slate, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{reasons[0] || tone.word}</span>}
      {spot ? (
        <span role="tooltip" style={{ position: "fixed", top: spot.top, left: spot.left, zIndex: 80, width: 320, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 12px 32px rgba(20,24,40,.16)", padding: "10px 12px", ...text, fontSize: 12.5, color: C.textInk, whiteSpace: "normal", textAlign: "left" }}>
          <span style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>{tone.word}: {fit.score} of 100</span>
          {reasons.length
            ? <span style={{ display: "grid", gap: 3 }}>{reasons.map((r) => <span key={r}>{r}</span>)}</span>
            : <span style={{ color: C.slate }}>Nothing we hold matches your ideal customer yet.</span>}
        </span>
      ) : null}
    </span>
  );
}

// "Why now" tags from the register, beside the company name.
export function SignalTags({ signals, max = 2 }) {
  const list = signals || [];
  if (!list.length) return null;
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {list.slice(0, max).map((s) => (
        <span key={s.key} title={s.detail} style={{ ...text, fontSize: 10.5, fontWeight: 600, color: "#1D4ED8", background: "#DBEAFE", borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap" }}>{s.label}</span>
      ))}
      {list.length > max ? <span title={list.slice(max).map((s) => s.label).join(", ")} style={{ ...text, fontSize: 10.5, color: C.slate }}>+{list.length - max}</span> : null}
    </span>
  );
}

// Shown where a score would be, until the ideal customer is set.
export function IcpPrompt({ onSet }) {
  return (
    <div role="note" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 12px", border: `1px dashed ${C.border}`, borderRadius: 10, background: "#fff", ...text, fontSize: 13, color: C.textInk }}>
      <Target size={16} color={C.cobalt} aria-hidden="true" />
      <span style={{ flex: "1 1 260px" }}>Set your ideal customer to see how well each company fits, and why.</span>
      {onSet ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onSet}>Set your ideal customer</button> : null}
    </div>
  );
}
