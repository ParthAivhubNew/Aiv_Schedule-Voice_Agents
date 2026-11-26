import React, { useEffect, useState } from "react";
import { authStorage, hasSession } from "../api/authStore";
import { initSupportWidget, loadSupportWidget, resetSupportWidget } from "./supportWidget";
import { SUPPORT_UNAVAILABLE_EVENT, SUPPORT_UNAVAILABLE_LINE } from "./openSupport";
import { C } from "../tokens";

// Support is the AIV Support widget only. This starts it for whoever is signed in, clears it on sign-out, and says so when it cannot open.
// `operator` is passed by the app; a page outside the app (the help pages) reads the saved sign-in instead.
function storedOperator() {
  try {
    const saved = authStorage().getItem("aivhub_operator");
    return saved && hasSession() ? JSON.parse(saved) : null;
  } catch (_) {
    return null;
  }
}

export function SupportWidgetBridge({ operator }) {
  const who = operator === undefined ? storedOperator() : operator;
  const email = who?.email || "";
  const name = who?.name || who?.username || "";
  const company = who?.org_name || "";
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!email) { resetSupportWidget(); return undefined; }
    let live = true;
    loadSupportWidget().then((ok) => { if (live && ok) initSupportWidget({ email, name, company }); });
    return () => { live = false; };
  }, [email, name, company]);

  useEffect(() => {
    let timer = 0;
    const show = () => { setNotice(SUPPORT_UNAVAILABLE_LINE); clearTimeout(timer); timer = setTimeout(() => setNotice(""), 8000); };
    window.addEventListener(SUPPORT_UNAVAILABLE_EVENT, show);
    return () => { clearTimeout(timer); window.removeEventListener(SUPPORT_UNAVAILABLE_EVENT, show); };
  }, []);

  return (
    <div role="status" aria-live="polite" style={notice ? { position: "fixed", right: 16, bottom: 16, zIndex: 3000, maxWidth: 320, padding: "12px 14px", borderRadius: 10, background: "#111520", color: C.onAccent, fontSize: 13.5, lineHeight: 1.45, boxShadow: "0 8px 24px rgba(0,0,0,.25)" } : { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
      {notice}
    </div>
  );
}
