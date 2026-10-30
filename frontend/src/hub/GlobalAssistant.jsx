import React, { useState } from "react";
import { createPortal } from "react-dom";
import { AssistantButton, AssistantPanel } from "../plugins/leadgen/AssistantPanel";
import { useLeadAccounts } from "../plugins/leadgen/AccountsViews";
import { useLeadLists } from "../plugins/leadgen/Lists";
import { useConnections } from "../hooks/useConnections";
import { navigateHash } from "../utils/route";

// The assistant outside Leads: a button in the header of Voice and Social that opens the same chat, with the same conversation, as a
// panel over the page. Anything the chat finds or prepares opens in Leads, where it belongs. Shown only to companies that have Leads.

function Dock({ open, onClose, plugin }) {
  if (plugin !== "leads") {
    return (
      <div style={{ position: "fixed", top: 0, right: 0, zIndex: 80 }}>
        <AssistantPanel plugin={plugin} open={open} onClose={onClose} />
      </div>
    );
  }
  return <LeadsDock open={open} onClose={onClose} />;
}

function LeadsDock({ open, onClose }) {
  const toast = () => {};
  const listsStore = useLeadLists(toast);
  const store = useLeadAccounts(toast, listsStore.reload);
  const go = (view) => { onClose(); navigateHash(`#/leadgen/${view}`); };
  return (
    <div style={{ position: "fixed", top: 0, right: 0, zIndex: 80 }}>
      <AssistantPanel open={open} onClose={onClose} store={store}
        lists={listsStore.lists.map((l) => ({ id: l.id, name: l.name, count: (l.ids || []).length }))}
        onGo={(view) => go(view === "outreach" ? "outreach" : view || "find_leads")} onImport={() => go("find_leads")}
        onOpenList={() => go("lists")} onCampaign={() => go("outreach")} onShowResults={() => go("find_leads")} />
    </div>
  );
}

// plugin: which assistant the header button opens ("leads", "voice" or "social"): the one for the screen you are on.
export function GlobalAssistant({ plugin = "leads" }) {
  const { plugins } = useConnections();
  const [open, setOpen] = useState(false);
  const [used, setUsed] = useState(false); // the panel's data loads only once it has been opened
  if (plugin === "leads" && !plugins.leads) return null;
  return (
    <>
      <AssistantButton label={plugin === "voice" ? "Voice assistant" : plugin === "social" ? "Social assistant" : "AI Assistant"} open={open} onClick={() => { setUsed(true); setOpen((v) => !v); }} />
      {used ? createPortal(<Dock plugin={plugin} open={open} onClose={() => setOpen(false)} />, document.body) : null}
    </>
  );
}
