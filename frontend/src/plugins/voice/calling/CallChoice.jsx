import React, { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, Phone, User } from "lucide-react";
import { openPhone } from "../../../utils/humanCall";

// The one Call button: pick the AI caller, or call yourself from the browser (you talk, with an optional recording and transcript).
// `icon` makes it the small round-row version for tables.
export function CallChoice({ onAi, aiDisabled = false, aiTitle = "", number = "", name = "", leadId = "", icon = false, disabled = false, busyLabel = "" }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const pick = (fn) => () => { setOpen(false); fn(); };
  return (
    <span ref={box} style={{ position: "relative", display: "inline-flex" }}>
      {icon ? (
        <button type="button" className="ui-icon-btn ui-icon-btn--sm" aria-haspopup="menu" aria-expanded={open} disabled={disabled} title="Call: with the AI, or yourself" aria-label="Call" onClick={() => setOpen((v) => !v)}>
          <Phone size={15} />
        </button>
      ) : (
        <button type="button" className="ui-btn ui-btn--primary" aria-haspopup="menu" aria-expanded={open} disabled={disabled} title="Call with the AI, or call yourself" onClick={() => setOpen((v) => !v)}>
          <Phone size={15} /> {busyLabel || "Call"} <ChevronDown size={13} />
        </button>
      )}
      {open ? (
        <div role="menu" className="ui-menu" style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, zIndex: 120, minWidth: 250 }}>
          <button type="button" role="menuitem" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={aiDisabled} title={aiTitle} style={{ width: "100%", justifyContent: "flex-start", height: "auto", padding: "8px 10px", textAlign: "left" }} onClick={pick(onAi)}>
            <Bot size={15} /> <span><strong>Call with AI</strong><br /><span style={{ fontWeight: 400, fontSize: 12 }}>The AI caller talks to them for you</span></span>
          </button>
          <button type="button" role="menuitem" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ width: "100%", justifyContent: "flex-start", height: "auto", padding: "8px 10px", textAlign: "left" }} onClick={pick(() => openPhone({ number, name, leadId }))}>
            <User size={15} /> <span><strong>Call myself</strong><br /><span style={{ fontWeight: 400, fontSize: 12 }}>From your browser. You can record it and get a transcript</span></span>
          </button>
        </div>
      ) : null}
    </span>
  );
}
