import React, { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { api } from "../api/apiClient";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

// In a plugin's sidebar (admins only): that plugin's credits at a glance; opens its
// Subscription page. `refreshKey` changes when the balance may have (e.g. the page shown).
// The full card shows the label, the balance and a Top up button. In the icon rail (global.css) only the coin and a short
// balance show, with the same state colour, so low or empty credits are still noticed.
export function PluginCredits({ wallet, operator, onOpen, refreshKey }) {
  const [w, setW] = useState(null);
  const isAdmin = Boolean(operator?.is_admin);

  useEffect(() => {
    if (!isAdmin) return;
    api.getBillingOverview().then((ov) => setW(ov.wallets.find((x) => x.key === wallet) || null)).catch(() => {});
  }, [isAdmin, wallet, refreshKey]);

  if (!w) return null;
  const state = w.empty ? "empty" : w.low ? "low" : undefined;
  const balance = Number(w.balance || 0);
  const label = w.empty ? "Out of credits" : w.low ? "Credits running low" : "Credits";
  return (
    <button type="button" onClick={onOpen} className="ui-credits" data-state={state} aria-label={`${label}: ${balance.toLocaleString()}. Open your plan to top up`}>
      <span className="ui-credits-full">
        <span className="ui-credits-label">{label}</span>
        <span className="ui-credits-num">{balance.toLocaleString()}</span>
      </span>
      <span className="ui-credits-action ui-credits-full">Top up</span>
      <span className="ui-credits-mini" aria-hidden="true">
        <Coins size={16} strokeWidth={1.75} />
        <span>{compact.format(balance)}</span>
      </span>
    </button>
  );
}
