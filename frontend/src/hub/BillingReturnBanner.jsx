import React, { useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { C, FONT_BODY } from "../tokens";

// After Stripe Checkout sends people back: ?billing=success|cancelled (read once, then removed).
export function takeBillingParam() {
  try {
    const q = new URLSearchParams(window.location.search);
    const v = q.get("billing");
    if (v) window.history.replaceState(null, "", window.location.pathname);
    return v || "";
  } catch (_) {
    return "";
  }
}

export function BillingReturnBanner() {
  const [state, setState] = useState(takeBillingParam);
  if (!state) return null;
  const ok = state === "success";
  return (
    <div role="status" style={{ width: "100%", maxWidth: 720, display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 16, borderRadius: 12, fontFamily: FONT_BODY, fontSize: 13.5,
      background: ok ? C.tealSoft : C.paperSoft, color: ok ? C.teal : C.slate, border: `1px solid ${ok ? "#BFE6DF" : C.border}` }}>
      {ok && <CheckCircle2 size={16} />}
      <span style={{ flex: 1 }}>{ok ? "Payment received. Your credits appear in Plans & credits within a minute." : "Checkout cancelled. Nothing was charged."}</span>
      <button type="button" aria-label="Dismiss" onClick={() => setState("")} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }}><X size={15} /></button>
    </div>
  );
}
