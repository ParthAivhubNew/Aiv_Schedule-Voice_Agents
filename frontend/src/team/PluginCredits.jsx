import React, { useEffect, useState } from "react";
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
  const state = w.empty ? "empty" : w.low ? "low" : undefined;
  return (
    <button type="button" onClick={onOpen} className="ui-credits" data-state={state} title={w.empty ? "Out of credits: this app is paused" : "Plan and credits"}>
      <span>
        <span className="ui-credits-label">{w.empty ? "Out of credits" : w.low ? "Credits running low" : "Credits"}</span>
        <span className="ui-credits-num">{Number(w.balance || 0).toLocaleString()}</span>
      </span>
      <span className="ui-credits-action">Top up</span>
    </button>
  );
}
