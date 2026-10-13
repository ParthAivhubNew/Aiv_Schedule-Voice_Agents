import React, { useEffect, useState } from "react";
import { Pause, Play, RefreshCw, X } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";

// One look for every search that takes a moment: what is happening, how long it has been, how far it
// got when that is known, and a way to pause or stop. The words are honest: it only claims progress it can count.

const text = { fontFamily: FONT_BODY };

export function SearchStatus({ title, detail, found, total, paused = false, onPause, onResume, onCancel, cancelLabel = "Cancel" }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const pct = total ? Math.min(100, Math.round(((found || 0) / total) * 100)) : null;
  const slow = seconds >= 8 && !paused;
  const sliding = pct == null && !paused;
  return (
    <div className="ui-card" role="status" aria-live="polite" style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {paused ? <Pause size={16} color={C.slate} /> : <RefreshCw size={16} className="ui-spin" color={C.cobalt} />}
        <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, marginRight: "auto" }}>
          {paused ? "Paused" : title}
          <span style={{ fontWeight: 400, color: C.slate }}> · {seconds}s</span>
        </div>
        {onPause && !paused ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onPause}><Pause size={13} /> Pause</button> : null}
        {onResume && paused ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onResume}><Play size={13} /> Resume</button> : null}
        {onCancel ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onCancel}><X size={13} /> {cancelLabel}</button> : null}
      </div>
      <div style={{ height: 6, borderRadius: 3, background: C.paperSoft, overflow: "hidden" }}>
        <div style={{ width: pct == null ? "35%" : `${pct}%`, height: "100%", background: paused ? C.slateLight : C.cobalt, transition: "width .4s", ...(sliding ? { animation: "ui-slide 1.4s ease-in-out infinite" } : null) }} />
      </div>
      <div style={{ ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.5 }}>
        {paused ? "Nothing more is being searched. Resume when you're ready, or cancel to keep what you have." : detail}
        {slow ? " Big searches take a little longer. It's still working." : ""}
      </div>
      <style>{"@keyframes ui-slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}"}</style>
    </div>
  );
}
