import React, { useEffect, useRef, useState } from "react";
import { Pause, Play, X } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { Spinner } from "../../app/Loader";

// One look for every search that takes a moment: what is happening, how long it has been, how far it
// got when that is known, and a way to pause or stop. The words are honest: it only claims progress it can count.

const text = { fontFamily: FONT_BODY };

// A search that is one request to the server cannot be frozen half way, so "pause" holds its answer:
// the search carries on, and the results are shown when you press Resume. Cancel throws the answer away.
export function useHold() {
  const [paused, setPaused] = useState(false);
  const flag = useRef(false);
  const held = useRef(null);
  return {
    paused,
    pause: () => { flag.current = true; setPaused(true); },
    resume: () => { flag.current = false; setPaused(false); const f = held.current; held.current = null; if (f) f(); },
    settle: (fn) => { if (flag.current) held.current = fn; else fn(); },
    clear: () => { flag.current = false; held.current = null; setPaused(false); },
  };
}

export function SearchStatus({ title, detail, found, total, paused = false, onPause, onResume, onCancel, cancelLabel = "Cancel", holding = false }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const pct = total ? Math.min(100, Math.round(((found || 0) / total) * 100)) : null;
  const slow = seconds >= 8 && !paused;
  const sliding = pct == null && !paused;
  return (
    <div className="ui-card" role="status" aria-live="polite" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span className="ld-orb" aria-hidden="true" style={{ width: 34, height: 34, animation: paused ? "none" : undefined }}>
          {paused ? <Pause size={16} color={C.slate} /> : <Spinner size={22} />}
        </span>
        <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, marginRight: "auto" }}>
          {paused ? "Paused" : title}
          <span style={{ fontWeight: 400, color: C.slate, fontVariantNumeric: "tabular-nums" }}> · {seconds}s</span>
        </div>
        {onPause && !paused ? <button title="Hold this. Nothing more is spent until you resume" type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onPause}><Pause size={13} /> Pause</button> : null}
        {onResume && paused ? <button title="Carry on from where it stopped" type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onResume}><Play size={13} /> Resume</button> : null}
        {onCancel ? <button type="button" title="Stop this and keep anything already found" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onCancel}><X size={13} /> {cancelLabel}</button> : null}
      </div>
      <div style={{ height: 5, borderRadius: 3, background: "var(--ui-accent-soft, #EEF2FE)", overflow: "hidden" }}>
        <div style={{ width: pct == null ? "35%" : `${pct}%`, height: "100%", borderRadius: 3, background: paused ? C.slateLight : "linear-gradient(90deg, var(--ui-accent, #3457D5), #8FA6FF)", transition: "width .4s", ...(sliding ? { animation: "ui-slide 1.4s ease-in-out infinite" } : null) }} />
      </div>
      <div style={{ ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.5 }}>
        {paused ? (holding ? "The search is still finishing in the background. Its results appear when you resume." : "Nothing more is being searched. Resume when you're ready, or cancel to keep what you have.") : detail}
        {slow ? " Big searches take a little longer. It's still working." : ""}
      </div>
      <style>{"@keyframes ui-slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}"}</style>
    </div>
  );
}
