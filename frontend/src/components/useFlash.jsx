import React, { useCallback, useEffect, useRef, useState } from "react";
import { C, FONT_BODY } from "../tokens";

// A short line in the corner after an action, for screens with no toast of their own. It is local to the screen that
// owns it, so it never doubles up with the Leads toast that listens for notice().
// Returns [toast element to render, flash(text, isError)].
export function useFlash(ms = 3500) {
  const [msg, setMsg] = useState(null);
  const timer = useRef(0);
  const flash = useCallback((text, error = false) => {
    const t = String(text || "").trim();
    if (!t) return;
    clearTimeout(timer.current);
    setMsg({ text: t, error });
    timer.current = setTimeout(() => setMsg(null), error ? ms + 2500 : ms);
  }, [ms]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = msg ? (
    <div role={msg.error ? "alert" : "status"} aria-live="polite" className="app-toast"
      style={{ position: "fixed", bottom: 24, right: 24, maxWidth: "min(420px, calc(100vw - 32px))", background: msg.error ? C.red : C.ink, color: "#fff", padding: "10px 18px", borderRadius: 8, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.2)", zIndex: 9999 }}>
      {msg.text}
    </div>
  ) : null;
  return [node, flash];
}
