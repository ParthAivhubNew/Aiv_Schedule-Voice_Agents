import { detailMissing } from "../searchGuard";
import { useEffect, useState } from "react";
import { SOCIAL } from "../PickOptions";
import { api } from "../../../api/apiClient";
import { domainOf } from "../accounts/accountsLogic";
import { useCompanyCheck } from "../CheckCompanies";
import { useCallDialog } from "../CallFlow";
import { useConnection } from "../../../hooks/useConnections";
import { announceCreditsChanged } from "../CreditsChip";
import { asAccount } from "./findLogic";

// Find Leads contact actions: free reveals, one-click web look-ups for a missing website or phone, calling, and Get contacts for many companies. Moved out of FindLeadsSearch unchanged; it takes what it uses and returns what the screen uses.
export function useContactActions({ setCompanies, setOpenCo, store, tab, view }) {
  const saveOne = (c) => store.save([asAccount(c)]);
  // One click on an empty website or phone: look on the web (and, if that finds no website, the deeper search), fill the row.
  const [lookups, setLookups] = useState({}); // `${company id}:${website|phone}` -> "busy" | "none": each button has its own lookup
  const [peopleOf, setPeopleOf] = useState(null); // how many companies match, of which peopleTotal have people on file
  const [pick, setPick] = useState(null); // {company, kind, options}: a lookup that was not sure, waiting for the person to choose
  useEffect(() => { setPick(null); }, [tab, view]); // a pop-up for a company never follows the person to another view
  const [waiting, setWaiting] = useState({}); // `${company id}:${kind}` -> the matches the person has not chosen from yet
  const applyCompany = (id, company) => {
    if (!company) return;
    setCompanies((rows) => rows.map((x) => (x.id === id ? { ...x, ...company, saved: x.saved } : x)));
    setOpenCo((o) => (o && o.id === id ? { ...o, ...company, saved: o.saved } : o));
  };
  // Opens one contact our registry holds. Free, once; it stays visible after that. It never searches for anything.
  const reveal = async (c, kind) => {
    const key = `${c.id}:${kind}`;
    if (lookups[key] === "busy") return;
    setLookups((m) => ({ ...m, [key]: "busy" }));
    try { const r = await api.revealContact(c.id, kind); applyCompany(c.id, r.company); store.toast(`${kind[0].toUpperCase()}${kind.slice(1)} opened for ${c.name}.`); } catch (err) { store.toast(err.message || "Couldn't open that."); }
    setLookups((m) => { const n = { ...m }; delete n[key]; return n; });
  };
  // Opens everything our registry holds for these companies. Free: no credits are used.
  const revealMany = async (rows) => {
    const ids = rows.filter((c) => Object.keys(c.closed || {}).length).map((c) => c.id);
    if (!ids.length) return;
    try {
      const r = await api.revealMany(ids);
      (r.companies || []).forEach((co) => applyCompany(co.id, co));
      store.toast(`Opened ${(r.companies || []).length.toLocaleString()} ${(r.companies || []).length === 1 ? "company" : "companies"}. Free.`);
    } catch (err) { store.toast(err.message || "Couldn't open them."); }
  };
  const revealRow = (c) => revealMany([c]);
  const findSite = async (c, kind = "website") => {
    const key = `${c.id}:${kind}`;
    if (lookups[key] === "busy") return;
    if (lookups[key] === "options" && waiting[key]) { setPick({ company: c, kind, options: waiting[key] }); return; }
    setLookups((m) => ({ ...m, [key]: "busy" }));
    try {
      const r = SOCIAL.includes(kind) ? await api.findSocial(c.id, kind) : await api.findCompanyWebsite(c.id, kind);
      if (r.charged) announceCreditsChanged();
      if (r.company) setCompanies((rows) => rows.map((x) => (x.id === c.id ? { ...x, ...r.company, saved: x.saved } : x)));
      setOpenCo((o) => (o && o.id === c.id && r.company ? { ...o, ...r.company, saved: o.saved } : o));
      const matches = !r.found && (r.options || []).length ? r.options : null;
      setLookups((m) => { const n = { ...m }; if (r.found) delete n[key]; else n[key] = matches ? "options" : "none"; return n; });
      const listed = !r.found && r.listing && r.listing.url; // no site of its own, but the company's exact directory page: shown in the cell, no box
      if (!r.found && !listed) setPick({ company: c, kind, options: matches || [] }); // a miss opens the box too, so the person can add details and search again
      if (matches) setWaiting((w) => ({ ...w, [key]: matches }));
      if (r.found || !matches || listed) store.toast(r.found ? `Found the ${kind} for ${c.name}${r.source === "deep" ? " with the deep web search" : r.source === "web" ? " with the web search" : ""}${r.charged ? ". Credits used for this find" : ""}.` : r.note || "Nothing found.");
    } catch (err) {
      setLookups((m) => { const n = { ...m }; delete n[key]; return n; });
      store.toast(err.message || "The lookup didn't finish. Nothing was charged.");
    }
  };
  const call = useCallDialog(store.toast);
  const { available: canCall } = useConnection("call_leads");
  // The saved copy of a search result, saving it first when it isn't saved yet. Calling needs a saved company
  // so the call, its result and any meeting stay with it.
  const savedCopy = async (c) => {
    const have = store.accounts.find((a) => (a.business_record_id && a.business_record_id === c.id) || (domainOf(c.website) && a.domain === domainOf(c.website)) || a.name.toLowerCase() === String(c.name || "").toLowerCase());
    if (have) return have;
    const r = await store.save([asAccount(c)], "Unsorted", { quiet: true });
    return r?.accounts?.[0] || null;
  };
  const callOne = async (c) => {
    const row = await savedCopy(c);
    if (!row) return;
    call.open({ kind: "one", id: row.id, name: row.name });
  };
  // Get contacts for many ticked companies at once: the ones not saved yet are saved to Unsorted, then the same cost box as in
  // Lists opens, showing the most it can cost and what comes back. Nothing is charged until the person confirms there.
  const contactCheck = useCompanyCheck({ onToast: store.toast, reload: store.reload });
  const [checking, setChecking] = useState(null);
  const [preparing, setPreparing] = useState(false);
  // A detail the register holds but we haven't shown yet (c.closed) is not missing: Reveal shows it, free. Get contacts is only for what we have nowhere.
  const missingDetail = detailMissing;
  const getContacts = async (list) => {
    const savedOf = (c, pool) => pool.find((a) => (a.business_record_id && a.business_record_id === c.id) || (domainOf(c.website) && a.domain === domainOf(c.website)) || a.name.toLowerCase() === String(c.name || "").toLowerCase());
    setPreparing(true);
    try {
      const missing = list.filter((c) => !savedOf(c, store.accounts));
      let fresh = [];
      if (missing.length) {
        const r = await store.save(missing.map(asAccount), "Unsorted", { quiet: true });
        if (!r) return;
        fresh = r.accounts || [];
      }
      const pool = [...fresh, ...store.accounts];
      const ids = [...new Set(list.map((c) => savedOf(c, pool)).filter(Boolean).map((a) => a.id))];
      if (ids.length) setChecking({ ids });
      else store.toast("Couldn't get these companies ready. Try again.");
    } finally {
      setPreparing(false);
    }
  };
  const callAll = async (list) => {
    const withPhone = list.filter((c) => c.phone);
    if (!withPhone.length) { store.toast("None of these companies has a phone number yet."); return; }
    // The ones not saved yet are saved in one go; the call box then shows how many will be called and what it costs.
    const savedOf = (c, pool) => pool.find((a) => (a.business_record_id && a.business_record_id === c.id) || (domainOf(c.website) && a.domain === domainOf(c.website)) || a.name.toLowerCase() === String(c.name || "").toLowerCase());
    const missing = withPhone.filter((c) => !savedOf(c, store.accounts));
    let fresh = [];
    if (missing.length) {
      const r = await store.save(missing.map(asAccount), "Unsorted", { quiet: true });
      if (!r) return;
      fresh = r.accounts || [];
    }
    const pool = [...fresh, ...store.accounts];
    const rows = withPhone.map((c) => savedOf(c, pool)).filter(Boolean);
    if (rows.length) call.open({ kind: "selected", ids: [...new Set(rows.map((r) => r.id))], name: `${rows.length.toLocaleString()} ${rows.length === 1 ? "company" : "companies"} from your search` });
    else store.toast("Couldn't save these companies for calling. Try again.");
  };
  return { applyCompany, call, callAll, callOne, canCall, checking, contactCheck, findSite, getContacts, lookups, missingDetail, peopleOf, pick, preparing, reveal, revealMany, revealRow, saveOne, setChecking, setLookups, setPeopleOf, setPick, setWaiting };
}
