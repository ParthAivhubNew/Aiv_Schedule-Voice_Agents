import React, { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { C, FONT_BODY } from "../tokens";
import { api } from "../api/apiClient";

// In a plugin's sidebar (admins only): that plugin's credits at a glance; opens its
// Subscription page. `refreshKey` changes when the balance may have (e.g. the page shown).
export function PluginCredits({ wallet, operator, onOpen, refreshKey }) {
  const [w, setW] = useState(null);
  const isAdmin = Boolean(operator?.is_admin);

  useEffect(() => {
    if (!isAdmin) return;
    api.getBillingOverview().then((ov) => setW(ov.wallets.find((x) => x.key === wallet) || null)).catch(() => {});
  }, [isAdmin, wallet, refreshKey]);

  if (!w) return null;
  const colour = w.empty ? "#F87171" : w.low ? "#FBBF24" : "#C8CCD6";
  return (
    <button type="button" onClick={onOpen} title={w.empty ? "Out of credits: this plugin is paused" : "Plan and credits"}
      style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 4px 8px", padding: "8px 10px", borderRadius: 8, border: `1px solid ${w.empty || w.low ? colour : C.inkLine}`, background: "transparent", color: colour, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
      <Coins size={14} />
      <span style={{ flex: 1, textAlign: "left" }}>{Number(w.balance || 0).toLocaleString()} credits</span>
    </button>
  );
}
