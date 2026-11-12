import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, ChevronDown, Phone, User } from "lucide-react";
import { openPhone } from "../../../utils/humanCall";

// The one Call button: pick the AI caller, or call yourself from the browser (you talk, with an optional recording and transcript).
// `icon` makes it the small round-row version for tables.
// The menu is drawn on the page body, not inside the row, so a table or card that clips its content cannot hide it.
export function CallChoice({ onAi, aiDisabled = false, aiTitle = "", number = "", name = "", leadId = "", icon = false, disabled = false, busyLabel = "" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btn = useRef(null);
  const menu = useRef(null);

  const place = () => {
    if (!btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const below = r.bottom + 4;
    const top = below + 110 > window.innerHeight ? Math.max(8, r.top - 4 - 110) : below;
    setPos({ top, right: Math.max(8, window.innerWidth - r.right) });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (menu.current && menu.current.contains(e.target)) return;
      if (btn.current && btn.current.contains(e.target)) return;
      setOpen(false);
    };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    const close = () => setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const pick = (fn) => () => { setOpen(false); fn(); };
  return (
    <span style={{ display: "inline-flex" }}>
      {icon ? (
        <button ref={btn} type="button" className="ui-icon-btn ui-icon-btn--sm" aria-haspopup="menu" aria-expanded={open} disabled={disabled} title="Call: with the AI, or yourself" aria-label="Call" onClick={() => setOpen((v) => !v)}>
          <Phone size={15} />
        </button>
      ) : (
        <button ref={btn} type="button" className="ui-btn ui-btn--primary" aria-haspopup="menu" aria-expanded={open} disabled={disabled} title="Call with the AI, or call yourself" onClick={() => setOpen((v) => !v)}>
          <Phone size={15} /> {busyLabel || "Call"} <ChevronDown size={13} />
        </button>
      )}
      {open ? createPortal(
        <div ref={menu} role="menu" className="ui-menu" style={{ position: "fixed", top: pos.top, right: pos.right, left: "auto", marginTop: 0, zIndex: 2000, minWidth: 250 }}>
          <button type="button" role="menuitem" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={aiDisabled} title={aiTitle} style={{ width: "100%", justifyContent: "flex-start", height: "auto", padding: "8px 10px", textAlign: "left" }} onClick={pick(onAi)}>
            <Bot size={15} /> <span><strong>Call with AI</strong><br /><span style={{ fontWeight: 400, fontSize: 12 }}>The AI caller talks to them for you</span></span>
          </button>
          <button type="button" role="menuitem" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ width: "100%", justifyContent: "flex-start", height: "auto", padding: "8px 10px", textAlign: "left" }} onClick={pick(() => openPhone({ number, name, leadId }))}>
            <User size={15} /> <span><strong>Call myself</strong><br /><span style={{ fontWeight: 400, fontSize: 12 }}>From your browser. You can record it and get a transcript</span></span>
          </button>
        </div>,
        document.body,
      ) : null}
    </span>
  );
}
