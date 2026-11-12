import React, { useCallback, useEffect, useRef, useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { api } from "../../../api/apiClient";
import { C } from "../../../tokens";
import { openPlans } from "../../../hooks/useConnections";
import { CheckDialog, CheckProgress, useCompanyCheck } from "../../leadgen/CheckCompanies";
import { applyPulled, linkRowsFor, pullIds } from "./getContacts";

// Get contacts on a call list: the same enrichment as the Leads lists (company register, website, email finding, web search, phone network),
// with the same cost box. The rows are saved as Leads companies first, so the result is the same company everywhere. Paid from the Leads credits.
export function GetContactsBar({ rows, setRows, selectedIds, fileName, phoneOf, showToast, leadsOn }) {
  const [ids, setIds] = useState(null); // the Leads companies the cost box is open for
  const [busy, setBusy] = useState(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const pull = useCallback(async () => {
    const lead = pullIds(rowsRef.current);
    if (!lead.length) return;
    try {
      const r = await api.pullCallList(lead);
      setRows((prev) => applyPulled(prev, r.companies || {}));
    } catch (_) { /* the next refresh catches up */ }
  }, [setRows]);
  const check = useCompanyCheck({ onToast: showToast, reload: pull });
  // A list opened from Leads already has companies behind it: show what Leads knows about them without waiting for a new check.
  const unread = rows.some((r) => r.leadId && !r.lead);
  const asked = useRef("");
  useEffect(() => {
    const key = pullIds(rows).join(",");
    if (leadsOn && unread && key && asked.current !== key) { asked.current = key; pull(); }
  }, [rows, unread, leadsOn, pull]);

  if (!rows.length) return null;
  const withData = rows.filter((r) => r.company || r.contact || r.website || phoneOf(r));
  const picked = withData.filter((r) => selectedIds.has(r.id));
  const target = picked.length ? picked : withData;
  const running = check.job?.status === "running";

  const open = async () => {
    setBusy(true);
    try {
      let linked = {};
      for (let i = 0; i < target.length; i += 300) {
        const out = await api.linkCallList(linkRowsFor(target.slice(i, i + 300), phoneOf), fileName);
        linked = { ...linked, ...out.links };
      }
      setRows((prev) => prev.map((r) => (linked[r.id] ? { ...r, leadId: linked[r.id] } : r)));
      const list = [...new Set(Object.values(linked))];
      if (!list.length) { showToast("Nothing here can be looked up yet. Each contact needs a company name or a website."); return; }
      setIds(list);
    } catch (e) {
      showToast(e.message || "Couldn't get this list ready.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ flexShrink: 0, borderBottom: `1px solid ${C.borderLight}`, padding: "8px 12px 8px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {leadsOn ? (
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy || running || !target.length} onClick={open}
            title="Look for the emails, phone numbers, website and company details these contacts are missing. You see the most it can cost first">
            <ShieldCheck size={15} /> {busy ? "Getting ready…" : running ? "Looking…" : picked.length ? `Get contacts (${picked.length})` : `Get contacts (${target.length})`}
          </button>
        ) : (
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => openPlans("leads")} title="Finding missing contact details comes with Leads">
            <Lock size={13} /> Get contacts · add Leads
          </button>
        )}
        <span style={{ fontSize: 12.5, color: C.slate }}>Fills in what is missing and checks each company, the same as in your Leads lists.</span>
      </div>
      <CheckProgress check={check} pendingCount={0} onRecheck={() => {}} onFilter={() => {}} />
      {ids ? <CheckDialog ids={ids} mode="contacts" onStart={check.start} onClose={() => setIds(null)} /> : null}
    </div>
  );
}
