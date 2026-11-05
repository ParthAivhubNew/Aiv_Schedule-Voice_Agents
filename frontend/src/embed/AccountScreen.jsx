import React, { useEffect, useState } from "react";
import { C, FONT_BODY } from "../tokens";
import { TeamModal } from "../team/TeamModal";
import { SubscriptionPage } from "../team/SubscriptionPage";
import { DeveloperApiKeysModal } from "../settings/DeveloperApiKeysModal";

// The admin screen inside a partner's page: users and roles, phone numbers, plans and credits, API keys and webhooks. It is only reachable when
// Outreach staff switched it on for the partner and the person signed in as an admin with their password (see services/embed.py, "account").
const NOOP = () => {};
export const PLANS_EVENT = "outreach-account-plans"; // a "See plans" button elsewhere asks for the Plans tab of one app
const APPS = [["leadgen", "Leads"], ["voice", "Voice"], ["scheduler", "Social"]];

export default function AccountScreen({ operator }) {
  const [tab, setTab] = useState("team"); // team | plans | keys
  const [wallet, setWallet] = useState("leadgen");
  useEffect(() => {
    const open = (e) => { if (APPS.some(([w]) => w === e.detail)) setWallet(e.detail); setTab("plans"); };
    window.addEventListener(PLANS_EVENT, open);
    return () => window.removeEventListener(PLANS_EVENT, open);
  }, []);
  const button = (id, label) => (
    <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
      style={{ padding: "12px 16px", border: 0, borderBottom: `2px solid ${tab === id ? C.cobalt : "transparent"}`, background: "none", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: tab === id ? C.cobalt : C.slate }}>
      {label}
    </button>
  );
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#fff", fontFamily: FONT_BODY }}>
      <div role="tablist" aria-label="Account" style={{ display: "flex", gap: 4, padding: "0 12px", borderBottom: `1px solid ${C.border}`, flex: "none" }}>
        {button("team", "Users, numbers & credits")}
        {button("plans", "Plans & billing")}
        {button("keys", "API keys & webhooks")}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {tab === "team" ? <TeamModal inline isOpen onClose={NOOP} currentUser={operator} /> : null}
        {tab === "plans" ? (
          <div style={{ padding: 16 }}>
            <div role="group" aria-label="App" style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {APPS.map(([w, name]) => (
                <button key={w} type="button" aria-pressed={wallet === w} onClick={() => setWallet(w)}
                  style={{ padding: "6px 12px", borderRadius: 999, border: `1px solid ${wallet === w ? C.cobalt : C.border}`, background: wallet === w ? C.cobaltSoft : "#fff", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 13 }}>{name}</button>
              ))}
            </div>
            <SubscriptionPage key={wallet} wallet={wallet} back="/" />
          </div>
        ) : null}
        {tab === "keys" ? <DeveloperApiKeysModal inline open onClose={NOOP} /> : null}
      </div>
    </div>
  );
}
