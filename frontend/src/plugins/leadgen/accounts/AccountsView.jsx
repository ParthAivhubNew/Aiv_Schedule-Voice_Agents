import React, { useEffect, useState } from "react";
import { GridTools } from "../../../components/GridTools";
import { writeEmail } from "../../../utils/writeEmail";
import { pagePicked, useBulkSelect } from "../../../components/bulkSelect";
import { SelectAllNotice } from "../../../components/SelectAllNotice";
import { Spinner } from "../../../app/Loader";
import { openPhone } from "../../../utils/humanCall";
import { Building2, Download, Megaphone, Mail, PhoneCall, Plus, Search, ShieldCheck } from "lucide-react";
import { api } from "../../../api/apiClient";
import { ExportDialog } from "../ExportDialog";
import { FieldMark, hasGoogleData, SourceList } from "../SourceMark";
import { SourceBadge } from "../SourceBadge";
import { OriginSelect, SourceSelect, TpsChip, TpsNote, TpsPill } from "../ListFilterBar";
import { hasSource, hasTpsCheck, screeningOf, sourceOptions } from "../listFilters";
import { numbersToCheck } from "../phoneNumbers";
import { C } from "../../../tokens";
import { AddToListDialog } from "../Lists";
import { TpsCheckDialog } from "../TpsCheckDialog";
import { CheckDialog, CheckProgress, LOCK_TIP, VerdictBadge, VERDICTS, VERDICT_ORDER, useCompanyCheck, useLocked } from "../CheckCompanies";
import { askConfirm, askText } from "../Dialogs";
import { CallButton, useCallDialog } from "../CallFlow";
import { StageBadge } from "../LeadActivity";
import { NotesButton } from "../Notes";
import { FitBadge, IcpPrompt, SignalTags, useIcp } from "../FitParts";
import { byFit } from "../fitLogic";
import { CARDS_CSS, useNarrow } from "../cardsLayout";
import { SearchField } from "../../../components/SearchField";
import { displayName, legalTag } from "../companyLogic";
import { bucket, duplicateFlags, FLAG_WORDS, firstSeen, openPicks } from "../listLogic";
import { SelectionBar } from "../FindLeadsParts";
import { originKey, originOptions } from "../originLabels";
import { EmptyState } from "../../../app/ui";
import { HIDDEN_KEY, completeFirst, contactFor, customColumns, emailFor, foundCount, isNew, openFixes, phoneFor, readHidden, readiness, wasLookedUp } from "./accountsLogic";
import { Completeness, Empty, Loading, MoreMenu, NewTag, QualityBar, SiteLink, ViewsMenu, muted, text } from "./accountParts";
import { NeedsChoiceTable } from "./ImportView";

const TABS = [["all", "All", "Every company in this list, whatever its status"], ["ready", "Ready", "Has an email that passed the checks"], ["needs", "Needs contact", "No email we can send to yet"], ["other", "Reach another way", "Sole traders and individuals: a call, letter or LinkedIn task instead of email, until they agree to email"], ["contacted", "Contacted", "You have already been in touch"]];
// The old filter cards, now behind one "More filters" menu. Each shows only while some company matches it.
const MORE_CHIPS = [
  ["new", "New data found", (a) => foundCount(a) > 0, "Companies where we filled in a blank or found extra people, emails or phones"],
  ["fixes", "Fixes to review", (a) => readiness(a) === "fixes", "We found a better value than the one you had. Nothing changes until you accept it"],
  ["retention", "Due for deletion", (a) => Boolean(a.retention_flagged), "Not contacted for 12 months (or never contacted and added over 12 months ago). Review and delete from Review old contacts"],
  ["flagged", "Import warnings", (a) => (a.import_flags || []).length > 0, "Problems noticed when the file was imported, such as a company number that belongs to another company"],
];
const VERDICT_TIPS = {
  verified: "Confirmed active by the official register or our records",
  looks_ok: "Nothing wrong found, but no register confirmed it",
  problem: "Closed or dissolved, or its website or email doesn't work",
  mismatch: "The company number in your file belongs to a different company",
  not_found: "We found no record of this company",
  unclear: "The check couldn't finish for these",
};

const ACCOUNT_PAGE_SIZES = [10, 25, 50, 100];
const COMPANY_PIN = ["Company"];

export function AccountsView({ store, listsStore, onOpen, onAdd, onGo, onCampaign, scopeIds = null, listId = "", moreInHeader = false, canExport = false }) {
  const narrow = useNarrow();
  const [filter, setFilter] = useState("");
  const [tabPref, setTabPref] = useState(""); // "" = the first tab that has companies
  const [moreFilter, setMoreFilter] = useState("");
  const [googleOnly, setGoogleOnly] = useState(false); // the "Google data" pill: only companies whose details came from Google
  const [tpsOnly, setTpsOnly] = useState(false); // the "TPS checked" pill: only companies whose phone has a TPS/CTPS result
  const [fromSource, setFromSource] = useState(""); // the "Data from" select: one source key, "" = any
  const [fromOrigin, setFromOrigin] = useState(""); // the "Came from" select: one origin key (Find Leads, your file...), "" = any
  const [picksOnly, setPicksOnly] = useState(() => { try { const go = sessionStorage.getItem("aivhub_open_picks") === "1"; if (go) sessionStorage.removeItem("aivhub_open_picks"); return go; } catch { return false; } }); // the bell's Review opens here
  useEffect(() => { const open = () => setPicksOnly(true); window.addEventListener("aivhub:open-picks", open); return () => window.removeEventListener("aivhub:open-picks", open); }, []);
  const [pageSize, setPageSize] = useState(() => {
    try { const n = Number(localStorage.getItem("aivhub_accounts_page_size")); return ACCOUNT_PAGE_SIZES.includes(n) ? n : 100; } catch (_) { return 25; }
  });
  const [pageNo, setPageNo] = useState(0);
  useEffect(() => { setPageNo(0); }, [filter, tabPref, moreFilter, picksOnly, listId, googleOnly, tpsOnly, fromSource, fromOrigin]);
  const sel = useBulkSelect(`${filter}|${tabPref}|${moreFilter}|${picksOnly}|${listId}|${googleOnly}|${tpsOnly}|${fromSource}|${fromOrigin}`); // ids ticked for the bulk actions; a new filter or list clears them
  const [checking, setChecking] = useState(null); // { ids, pendingOnly, mode } while the cost box is open
  const [tpsNumbers, setTpsNumbers] = useState(null); // numbers of the ticked companies while the TPS and CTPS check is open
  const [listing, setListing] = useState(false); // the Add to list box is open
  const [exportOpen, setExportOpen] = useState(false); // Export dialog for the ticked companies (administrators only)
  const [hidden, setHidden] = useState(readHidden); // columns this person chose not to see
  const check = useCompanyCheck({ onToast: store.toast, reload: store.reload });
  const locked = useLocked();
  const call = useCallDialog(store.toast);
  const icp = useIcp();
  const [sortBy, setSortBy] = useState(""); // "" = Best fit once an ideal customer is set, else most complete first
  const [extra, setExtra] = useState({}); // score, warm and call history per company, from the connections view
  useEffect(() => {
    let live = true;
    api.getConnectionLeads().then((r) => { if (live) setExtra(r.leads || {}); }).catch(() => {});
    return () => { live = false; };
  }, [store.accounts]);
  if (store.loading || (store.error && !store.accounts.length)) return <Loading store={store} />;
  if (!store.accounts.length) {
    return (
      <EmptyState icon={Building2} title="No saved accounts yet" body="Find companies with Find Leads, import a spreadsheet, or add one by hand.">
        <button title="Search the company register for new companies" type="button" className="ui-btn ui-btn--primary" onClick={() => onGo("find_leads")}><Search size={15} /> Find companies</button>
        <button title="Type in one company yourself" type="button" className="ui-btn ui-btn--ghost" onClick={onAdd}><Plus size={15} /> Add by hand</button>
      </EmptyState>
    );
  }
  const base = scopeIds ? store.accounts.filter((a) => scopeIds.has(a.id)) : store.accounts; // the list being looked at, or every company
  const own = customColumns(base);
  const saveHidden = (next) => {
    setHidden(next);
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(next)); } catch { /* the choice just isn't remembered */ }
  };
  const showing = (id) => !hidden.includes(id);
  const shownOwn = own.filter((n) => showing(`c:${n}`));
  const fitShown = icp.isSet && showing("fit");
  const order = sortBy || (icp.isSet ? "fit" : "complete");
  const columnCount = 2 + (fitShown ? 1 : 0) + ["phone", "email", "contact", "stage", "quality", "check", "website", "datasource", "source"].filter(showing).length + shownOwn.length + 1;
  const q = filter.trim().toLowerCase();
  const buckets = { all: [], ready: [], needs: [], other: [], contacted: [] };
  base.forEach((a) => { buckets[bucket(a)].push(a); buckets.all.push(a); });
  const tabsShown = TABS; // every tab stays, even at 0, so nothing seems to have gone missing
  // Companies that would have been ready to email but are held until their register match or consent is settled
  const heldBack = buckets.needs.filter((a) => a.email && (a.email_route || {}).email === false && (a.email_route || {}).group === "quick_choice").length;
  const tab = tabPref && buckets[tabPref] ? tabPref : TABS.find(([k]) => k !== "all" && buckets[k].length)?.[0] || "all"; // opens on the first group with companies; All is one click away
  const pickRows = base.filter((a) => openPicks(a).length);
  const picks = picksOnly && pickRows.length > 0; // "Needs your choice" looks across every tab
  const inTab = picks ? pickRows : buckets[tab];
  const verdictChips = VERDICT_ORDER.map((k) => [`v_${k}`, VERDICTS[k].label, (a) => a.verification?.verdict === k, VERDICT_TIPS[k]]);
  const historyChips = [
    ["h_never", "Never called", (a) => extra[a.id]?.history === "never", "No call has been made to this company"],
    ["h_no_answer", "Called, no answer", (a) => extra[a.id]?.history === "no_answer", "Called, but nobody picked up or it went to voicemail"],
    ["h_interested", "Interested", (a) => extra[a.id]?.history === "interested", "Spoke with them and they showed interest"],
    ["h_recent", "Contacted recently", (a) => extra[a.id]?.history === "recent", "Called within your re-contact gap"],
    ["h_warm", "Warm", (a) => Boolean(extra[a.id]?.warm), "Opened your emails or engaged with your posts"],
  ];
  const allChips = [...MORE_CHIPS, ...historyChips, ...verdictChips];
  const available = allChips.filter(([id, , pred]) => id === "retention" || inTab.some(pred)); // Due for deletion always shows, even at 0, so it can be found
  const activeChip = available.find(([id]) => id === moreFilter);
  const flags = duplicateFlags(base);
  const sourceChoices = sourceOptions(inTab);
  const activeSource = sourceChoices.some((o) => o.key === fromSource) ? fromSource : "";
  const originChoices = originOptions(inTab);
  const activeOrigin = originChoices.some((o) => o.key === fromOrigin) ? fromOrigin : "";
  const matching = inTab
    .filter((a) => !activeOrigin || originKey(a.source) === activeOrigin)
    .filter(activeChip ? activeChip[2] : () => true)
    .filter((a) => !googleOnly || hasGoogleData(a))
    .filter((a) => !tpsOnly || hasTpsCheck(a))
    .filter((a) => !activeSource || hasSource(a, activeSource))
    .filter((a) => !q || [a.name, a.domain, a.contact_name, a.industry, a.region].some((v) => String(v || "").toLowerCase().includes(q)));
  // A filter chosen elsewhere (the check results) opens the tab that holds the companies it finds.
  const focusFilter = (id) => {
    const chip = allChips.find(([cid]) => cid === id);
    const where = chip ? TABS.map((t) => t[0]).find((k) => buckets[k].some(chip[2])) : "";
    if (where) setTabPref(where);
    setPicksOnly(false);
    setMoreFilter(id);
  };
  const shown = order === "fit" && icp.isSet ? byFit(completeFirst(matching)) : completeFirst(matching);
  const shownIds = shown.map((a) => a.id);
  const lastPage = Math.max(0, Math.ceil(shown.length / pageSize) - 1);
  const page = Math.min(pageNo, lastPage);
  const paged = shown.slice(page * pageSize, (page + 1) * pageSize);
  const pageIds = paged.map((a) => a.id);
  const deleteTicked = async () => {
    const n = pickedIds.length;
    if (!n) return;
    if (!(await askConfirm({ title: `Delete ${n.toLocaleString()} ${n === 1 ? "company" : "companies"}?`, body: "They are removed from your saved companies, every list and any journey they are in. This can't be undone.", confirm: `Delete ${n.toLocaleString()}`, danger: true }))) return;
    const never = await askConfirm({ title: "Also stop anyone contacting them?", body: "Add their emails and phone numbers to your do-not-contact list, for an erasure request. Press Cancel to delete without blocking them.", confirm: "Yes, block them" });
    try {
      const out = await api.deleteLeadAccounts(pickedIds, Boolean(never));
      sel.clear();
      await store.reload();
      await listsStore?.reload?.();
      store.toast?.(`Deleted ${out.deleted.toLocaleString()}.${out.over_cap ? ` ${out.over_cap.toLocaleString()} more were not deleted (the limit is 5,000 at a time). Run it again for the rest.` : ""}${out.locked?.length ? ` ${out.locked.length} are being checked right now and were kept.` : ""}`);
    } catch (e) {
      store.toast?.(e.message || "Couldn't delete them");
    }
  };
  const allShownPicked = pagePicked(sel.ids, pageIds);
  const pickedIds = base.filter((a) => sel.has(a.id)).map((a) => a.id); // companies removed since are dropped
  const pickedWord = sel.everything && pickedIds.length === shownIds.length ? `All ${pickedIds.length.toLocaleString()} selected` : `${pickedIds.length.toLocaleString()} selected`;
  // Get contacts is for companies missing something we hold nowhere. A detail the register holds (on_file) is shown with Reveal, free.
  const lacks = (a) => ["website", "phone", "email"].some((k) => !a[k] && !(a.on_file || []).includes(k));
  const pickedLacking = pickedIds.filter((id) => { const a = base.find((x) => x.id === id); return !a || lacks(a); });
  const pickedOnFile = base.filter((a) => sel.has(a.id) && a.on_file?.length && a.business_record_id);
  const revealRows = async (rows) => {
    const ids = rows.map((a) => a.business_record_id).filter(Boolean);
    if (!ids.length) return;
    try {
      const r = await api.revealMany(ids);
      await store.reload();
      store.toast(`Opened ${(r.companies || []).length.toLocaleString()} ${(r.companies || []).length === 1 ? "company" : "companies"}. Free.`);
    } catch (e) {
      store.toast(e.message || "Couldn't open them.");
    }
  };
  const pendingCount = base.filter((a) => a.verification?.pending_registry).length;
  const fixIds = base.filter((a) => openFixes(a).length).map((a) => a.id);
  // Takes companies out of the list being looked at (one or many). They stay in your account and in any other list.
  const removeFromList = async (ids) => {
    if (!(await askConfirm({ title: `Remove ${ids.length.toLocaleString()} ${ids.length === 1 ? "company" : "companies"} from this list?`, body: `${ids.length === 1 ? "It stays" : "They stay"} in your account and in your other lists.`, confirm: "Remove", danger: true }))) return;
    try {
      await api.updateLeadList(listId, { remove: ids });
      await listsStore.reload();
      sel.drop(ids);
      store.toast(`Removed ${ids.length.toLocaleString()} ${ids.length === 1 ? "company" : "companies"} from the list.`);
    } catch (e) {
      store.toast(e.message || "Couldn't remove them.");
    }
  };
  const openTps = () => {
    const picked = pickedIds.map((id) => base.find((x) => x.id === id)).filter(Boolean);
    const numbers = numbersToCheck(picked);
    if (!numbers.length) { store.toast("None of the ticked companies has a phone number yet. Use Get contacts first."); return; }
    setTpsNumbers(numbers); // every number on the ticked companies: the company's own, those research found and each person's
  };
  // The ticked companies become a list of their own, and the campaign is started on it.
  const startCampaign = async () => {
    const withEmail = pickedIds.filter((id) => emailFor(base.find((a) => a.id === id) || {})?.text);
    if (!withEmail.length) { store.toast("None of the ticked companies has an email yet. Use Get contacts first."); return; }
    const name = await askText({ title: `Start a journey on ${withEmail.length.toLocaleString()} ${withEmail.length === 1 ? "company" : "companies"}`, label: "Name the list they go in", initial: `Journey ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`, confirm: "Continue", maxLength: 80 });
    if (!name) return;
    try {
      let r;
      for (let n = 1; ; n += 1) { // a name already taken (same default twice in a minute) gets 2, 3, ...
        try { r = await api.createLeadList(n === 1 ? name.trim() : `${name.trim().slice(0, 74)} ${n}`, withEmail); break; } catch (e) { if (n >= 5 || !/already have a list/i.test(e.message || "")) throw e; }
      }
      await listsStore.reload();
      onCampaign(r.list.id);
    } catch (e) {
      store.toast(e.message || "Couldn't start it.");
    }
  };
  const acceptFixes = async (ids, fields) => {
    try {
      const r = await api.acceptCheckFixes(ids, fields);
      await store.reload();
      store.toast(r.applied ? `Applied ${r.applied} ${r.applied === 1 ? "fix" : "fixes"}.` : "Nothing to apply.");
    } catch (e) {
      store.toast(e.message || "Couldn't apply the fixes.");
    }
  };
  const acceptAllFixes = async (ids) => {
    if (await askConfirm({ title: `Apply ${ids.length.toLocaleString()} ${ids.length === 1 ? "company's" : "companies'"} suggested fixes?`, body: "The values you had stay noted in each company's check details.", confirm: "Apply fixes" })) acceptFixes(ids);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!icp.loading && !icp.isSet ? <IcpPrompt onSet={() => onGo("business")} /> : null}
      {heldBack ? (
        <div role="status" style={{ ...text, fontSize: 12.5, color: C.slate }}>
          {heldBack.toLocaleString()} {heldBack === 1 ? "company with an email moved" : "companies with an email moved"} to Needs your choice after the register check. Settle each one to bring {heldBack === 1 ? "it" : "them"} back to Ready to email.
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div role="tablist" aria-label="Companies by what to do next" style={{ display: "flex", gap: 4, overflowX: "auto", maxWidth: "100%", flex: "0 1 auto" }}>
          {tabsShown.map(([k, label, tip]) => {
            const on = !picks && tab === k;
            return (
              <button key={k} type="button" role="tab" aria-selected={on} title={tip} onClick={() => { setTabPref(k); setPicksOnly(false); }}
                style={{ ...text, minHeight: 36, padding: "0 14px", borderRadius: 999, border: `1px solid ${on ? C.ink : C.border}`, background: on ? C.ink : "#fff", color: on ? "#fff" : C.textInk, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                {label} {buckets[k].length.toLocaleString()}
              </button>
            );
          })}
        </div>
        {pickRows.length ? (
          <button type="button" aria-pressed={picks} title="We found more than one phone or email for these. Pick the right one" onClick={() => setPicksOnly((v) => !v)}
            style={{ ...text, minHeight: 36, padding: "0 14px", borderRadius: 999, border: `1px solid ${picks ? "#B45309" : "#F59E0B"}`, background: picks ? C.warning : C.warningSoft, color: picks ? "#fff" : C.warningInk, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            Needs your choice {pickRows.length.toLocaleString()}
          </button>
        ) : null}
        <button type="button" aria-pressed={googleOnly} title="Show only companies whose phone, email or website came from Google"
          onClick={() => setGoogleOnly((v) => !v)}
          style={{ ...text, minHeight: 36, padding: "0 14px", borderRadius: 999, border: `1px solid ${googleOnly ? "#1D4ED8" : "#93B4F5"}`, background: googleOnly ? C.infoInk : "#EFF5FF", color: googleOnly ? "#fff" : C.infoInk, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
          Google data {inTab.filter(hasGoogleData).length.toLocaleString()}
        </button>
        <TpsPill count={inTab.filter((a) => hasTpsCheck(a)).length} on={tpsOnly} onClick={() => setTpsOnly((v) => !v)} />
        <SourceSelect options={sourceChoices} value={activeSource} onChange={setFromSource} />
        <OriginSelect options={originChoices} value={activeOrigin} onChange={setFromOrigin} />
        {available.length ? (
          <select className="ui-input" aria-label="Filter" value={activeChip ? activeChip[0] : ""} onChange={(e) => setMoreFilter(e.target.value)} style={{ height: 36, width: "auto", maxWidth: "100%" }}>
            <option value="">More filters</option>
            {available.map(([id, label]) => <option key={id} value={id}>{label} ({inTab.filter(allChips.find(([cid]) => cid === id)[2]).length.toLocaleString()})</option>)}
          </select>
        ) : null}
      </div>
      {googleOnly ? (
        <div role="status" style={{ ...text, fontSize: 13, color: "#1E3A8A", background: "#EFF5FF", border: "1px solid #93B4F5", borderRadius: 8, padding: "8px 12px" }}>
          Showing only companies with Google data ({matching.length.toLocaleString()}). You can see and use it here, but it can't be downloaded. Open a company to see its live Google details.
        </div>
      ) : null}
      {tpsOnly ? <TpsNote /> : null}
      <CheckProgress check={check} pendingCount={pendingCount} onFilter={(k) => focusFilter(`v_${k}`)}
        onRecheck={() => setChecking({ ids: base.filter((a) => a.verification?.pending_registry).map((a) => a.id), pendingOnly: true })} />

      <div className="ui-card" style={{ overflow: "hidden" }}>
        <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <SearchField value={filter} onChange={setFilter} placeholder="Filter by name, website, contact or place" label="Filter saved accounts" height={42} style={{ flex: "1 1 320px" }} />
          <span style={{ flex: 1 }} />
          {!moreInHeader && fixIds.length ? (
            <MoreMenu items={[{ label: `Accept all fixes (${fixIds.length.toLocaleString()})`, title: "Apply every suggested fix in this list. The value you had is kept in the company's check details", onClick: () => acceptAllFixes(fixIds) }]} />
          ) : null}
          <span id="acc-grid-tools" style={{ display: "contents" }} />{/* the Default / My layout switch and Columns sit here, in this row */}
          <ViewsMenu current={{ hidden, tab: tabPref, filter: moreFilter }} onToast={store.toast}
            onApply={(v) => {
              saveHidden(v.hidden || []);
              const wanted = v.filter ?? (v.scope && v.scope !== "all" ? v.scope : "");
              setTabPref(TABS.some(([k]) => k === v.tab) ? v.tab : "");
              setMoreFilter(allChips.some(([id]) => id === wanted) ? wanted : "");
              setPicksOnly(false);
            }} />
        </div>
        <SelectionBar count={pickedIds.length} label={pickedWord} onClear={sel.clear}>
          {pickedLacking.length ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={check.job?.status === "running"}
            title="Look for the emails and phone numbers these companies are missing. You see the most it can cost first"
            onClick={() => setChecking({ ids: [...pickedLacking].sort((x, y) => shownIds.indexOf(x) - shownIds.indexOf(y)), pendingOnly: false, mode: "contacts" })}>
            <ShieldCheck size={14} /> Get contacts
          </button> : null}
          {pickedOnFile.length ? (
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Show the website, phone and email we hold for the ticked companies. Free." onClick={() => revealRows(pickedOnFile)}>Reveal {pickedOnFile.length.toLocaleString()}</button>
          ) : null}
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={openTps}
            title="Check every phone number on the ticked companies against the TPS and CTPS registers. You see the cost first.">
            <ShieldCheck size={14} /> Check TPS/CTPS
          </button>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!listsStore} onClick={() => setListing(true)}
            title="Group these companies in a named list, ready for a journey">
            Add to list
          </button>
          <CallButton label="Call" lockedLabel="Call · add Voice"
            onClick={() => call.open({ kind: "selected", ids: pickedIds, name: `${pickedIds.length} selected` })}
            onLocked={() => call.open({ kind: "selected", ids: pickedIds, name: `${pickedIds.length} selected` }, true)} />
          {listId ? (
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={pickedIds.some((i) => locked.has(i))} onClick={() => removeFromList(pickedIds)}
              title={pickedIds.some((i) => locked.has(i)) ? LOCK_TIP : "Take the ticked companies out of this list"}>
              Remove from list
            </button>
          ) : null}
          {onCampaign && !listId ? (
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!listsStore} title="Put the ticked companies in a list and start an email journey on it" onClick={startCampaign}>
              <Megaphone size={14} /> Start journey
            </button>
          ) : null}
          {canExport ? (
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Export the ticked companies as a spreadsheet" onClick={() => setExportOpen(true)}>
              <Download size={14} /> Export
            </button>
          ) : null}
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ color: C.red }} onClick={deleteTicked}
            title="Delete the ticked companies for good. They leave every list and journey.">
            Delete
          </button>
        </SelectionBar>
        <SelectAllNotice sel={sel} pageIds={pageIds} total={shownIds.length} onSelectAll={() => sel.selectAll(shownIds)} />
        <GridTools id="my-list" pinned={COMPANY_PIN} into="acc-grid-tools" />
        {picks ? <NeedsChoiceTable rows={pickRows} store={store} /> : null}
        {narrow && !picks ? (
          <div className="fl-cards">
            <style>{CARDS_CSS}</style>
            {paged.map((a) => {
              const ph = phoneFor(a);
              const em = emailFor(a);
              const ct = contactFor(a);
              const stop = (e) => e.stopPropagation();
              return (
                <article key={a.id} className="fl-co" data-on={sel.has(a.id)} style={a.verification?.verdict === "problem" ? { background: C.redSoft } : undefined} onClick={() => onOpen(a)}>
                  <label className="row-tick" title="Select this company" onClick={stop}><input type="checkbox" checked={sel.has(a.id)} onChange={() => sel.toggle(a.id)} aria-label={`Select ${a.name}`} /></label>
                  <div className="fl-co-body">
                    <div style={{ minWidth: 0 }}>
                      <button type="button" className="fl-co-name" onClick={(e) => { stop(e); onOpen(a); }}>{displayName(a.name)}</button>
                      {a.favourite || a.pinned ? <span title="Pinned favourite" style={{ color: C.warningBright, marginLeft: 5 }}>★</span> : null}
                      {a.registration_number ? <span title="Verified registration" style={{ color: C.success, marginLeft: 4, fontWeight: 700 }}>✓</span> : null}
                      {legalTag(a.registry?.company_category, a.registration_number) ? <div className="fl-co-sub">{legalTag(a.registry?.company_category, a.registration_number)}</div> : null}
                    </div>
                    <div onClick={stop}><SourceBadge account={a} /></div>
                    {a.signals?.length ? <SignalTags signals={a.signals} /> : null}
                    {fitShown ? <FitBadge fit={a.fit} /> : null}
                    <div className="fl-co-reach" onClick={stop}>
                      {ph ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>{ph.text}
                          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label={`Call ${a.name} in the browser`} onClick={() => openPhone({ number: ph.text, leadId: a.id, name: a.name })}><PhoneCall size={14} /></button>
                          {a.verification?.phone?.verified === true ? <span title={a.verification.phone.note} style={{ color: C.success }}>✓</span> : null}
                        </span>
                      ) : <Empty a={a} field="phone" />}
                      {em ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 2, minWidth: 0, overflowWrap: "anywhere" }}>{em.text}
                          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label={`Write an email to ${a.name}`} onClick={() => writeEmail(em.text)}><Mail size={14} /></button>
                        </span>
                      ) : <Empty a={a} field="email" />}
                    </div>
                    {ct ? <div className="fl-co-meta">{ct.text}{ct.title ? ` · ${ct.title}` : ""}</div> : null}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }} onClick={stop}>
                      <StageBadge stage={a.connection?.stage || "new"} />
                      <VerdictBadge verification={a.verification} />
                    </div>
                    <div className="fl-co-reach" onClick={stop}>
                      <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => onOpen(a)}>{store.researching[a.id] ? <><Spinner size={13} /> Working…</> : "Open"}</button>
                      {listId ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={locked.has(a.id)} onClick={() => removeFromList([a.id])} title={locked.has(a.id) ? LOCK_TIP : "Remove from this list"}>Remove</button> : null}
                    </div>
                  </div>
                </article>
              );
            })}
            {!shown.length ? <div style={{ color: C.slate, padding: 8 }}>{filter ? `Nothing matches “${filter}”.` : "Nothing here."}</div> : null}
            <button type="button" className="ui-btn ui-btn--secondary" onClick={onAdd}><Plus size={14} /> Add a row</button>
          </div>
        ) : null}
        <div className="ui-scroll" style={{ overflowX: "auto", display: picks || narrow ? "none" : undefined }}>
          <table className="ui-table acc-stick" style={{ minWidth: 520 + 120 * (columnCount - 3) }}>
            <thead>
              <tr>
                <th style={{ width: 1 }}>
                  <label className="row-tick" title="Select every company on this page"><input type="checkbox" checked={allShownPicked} onChange={() => sel.togglePage(pageIds)} aria-label="Select all companies on this page" /></label>
                </th>
                <th>Company</th>
                {showing("datasource") ? <th title="Where the phone, email and website came from: your file, the official register, the company's own website and so on">Data from</th> : null}
                {showing("source") ? <th title="How and when this company was first saved">First seen via</th> : null}
                {fitShown ? (
                  <th aria-sort={order === "fit" ? "descending" : "none"} style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="ui-link" title={order === "fit" ? "Sorted by best fit. Click to sort by most complete" : "Sort by best fit"}
                      onClick={() => setSortBy(order === "fit" ? "complete" : "fit")} style={{ font: "inherit", color: "inherit" }}>
                      Fit{order === "fit" ? " ↓" : ""}
                    </button>
                  </th>
                ) : null}
                {showing("phone") ? <th title="The number you saved, or one research found. A tick means the phone network confirmed it">Phone</th> : null}
                {showing("email") ? <th title="The email you saved, or one research found">Email</th> : null}
                {showing("contact") ? <th title="The person to write to">Contact</th> : null}
                {showing("stage") ? <th title="Where this company is in your journey with them, and how likely it is to answer">Stage</th> : null}
                {showing("quality") ? <th title="How much of the website, phone, email, address, industry, people and size we hold. Hover a row to see what is missing">Complete</th> : null}
                {showing("check") ? <th title="Whether the company, its website and its email look real">Check</th> : null}
                {showing("website") ? <th title="The company's own website">Website</th> : null}
                {shownOwn.map((n) => <th key={n} style={{ whiteSpace: "nowrap" }}>{n}</th>)}
                <th style={{ width: 1 }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {paged.map((a) => (
                <tr key={a.id} style={{ background: a.verification?.verdict === "problem" ? C.redSoft : "#fff" }}>
                  <td style={{ padding: 0, width: 48 }} onClick={(e) => e.stopPropagation()}><label className="row-tick" title="Select this company"><input type="checkbox" checked={sel.has(a.id)} onChange={() => sel.toggle(a.id)} aria-label={`Select ${a.name}`} /></label></td>
                  <td>
                    <button type="button" title={a.name} onClick={() => onOpen(a)} style={{ ...text, all: "unset", cursor: "pointer", fontWeight: 600, color: C.ink, fontSize: 13.5 }}>{displayName(a.name)}</button>
                    {a.favourite || a.pinned ? <span title="Pinned favourite" style={{ color: C.warningBright, marginLeft: 5 }}>★</span> : null}
                    {a.registration_number ? <span title="Verified registration" style={{ color: C.success, marginLeft: 4, fontWeight: 700 }}>✓</span> : null}
                    {legalTag(a.registry?.company_category, a.registration_number) ? <span style={{ ...text, marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: C.slate, background: C.paperSoft, borderRadius: 4, padding: "1px 5px" }}>{legalTag(a.registry?.company_category, a.registration_number)}</span> : null}
                    <span style={{ marginLeft: 4 }}><NotesButton companyId={a.id} name={a.name} /></span>
                    {a.kind === "person" ? <span title="A person with no company on the row. Only their phone and email are checked." style={{ ...text, fontSize: 11, color: C.slate, background: C.paperSoft, borderRadius: 999, padding: "1px 7px", marginLeft: 6 }}>Person</span> : null}
                    <div style={{ marginTop: 2 }}><SourceBadge account={a} /></div>
                    {a.signals?.length || flags[a.id] ? (
                      <div style={{ marginTop: 3, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                        <SignalTags signals={a.signals} />
                        {flags[a.id] ? <span title={flags[a.id].map((f) => FLAG_WORDS[f][1]).join(" ")} style={{ ...text, fontSize: 10.5, fontWeight: 600, color: C.warningInk, background: C.warningSoft, borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap" }}>{flags[a.id].map((f) => FLAG_WORDS[f][0]).join(" · ")}</span> : null}
                      </div>
                    ) : null}
                  </td>
                  {showing("datasource") ? <td><SourceList sources={a.field_sources} /></td> : null}
                  {showing("source") ? <td style={{ color: C.slate, whiteSpace: "nowrap" }}>{firstSeen(a)}</td> : null}
                  {fitShown ? <td style={{ maxWidth: 260 }}><FitBadge fit={a.fit} /></td> : null}
                  {showing("phone") ? (
                    <td style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {phoneFor(a) ? (
                        <>
                          {phoneFor(a).text}
                          <FieldMark flags={a.restricted} notes={a.restricted_note} sources={a.field_sources} field="phone" />
                          <TpsChip screening={screeningOf(a, phoneFor(a).text)} />
                          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Call this number from your browser" aria-label={`Call ${a.name} in the browser`}
                            onClick={(e) => { e.stopPropagation(); openPhone({ number: phoneFor(a).text, leadId: a.id, name: a.name }); }}><PhoneCall size={13} /></button>
                          {a.verification?.phone?.verified === true ? <span title={a.verification.phone.note} style={{ color: C.success }}> ✓</span> : null}
                          {a.verification?.phone?.state === "invalid" ? <span title={a.verification.phone.note || "Not a usable number"} style={{ color: C.red }}> ✕</span> : null}
                          {phoneFor(a).fromResearch ? <span style={{ color: C.slateLight, fontSize: 11.5 }}> · from research</span> : null}
                          {isNew(a, "phone") ? <NewTag /> : null}
                        </>
                      ) : <Empty a={a} field="phone" />}
                    </td>
                  ) : null}
                  {showing("email") ? <td style={{ maxWidth: 240, whiteSpace: "nowrap" }} title={emailFor(a)?.text || ""}>
                    {emailFor(a) ? (
                      <div style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{emailFor(a).text}</span>
                        <FieldMark flags={a.restricted} notes={a.restricted_note} sources={a.field_sources} field="email" />
                        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ flex: "none" }} title="Write an email to this address" aria-label={`Write an email to ${a.name}`}
                          onClick={(e) => { e.stopPropagation(); writeEmail(emailFor(a).text); }}><Mail size={13} /></button>
                        {emailFor(a).fromResearch ? <span style={{ color: C.slateLight, fontSize: 11.5, flex: "none" }}>&nbsp;· from research</span> : null}
                        {isNew(a, "email") ? <span style={{ flex: "none" }}><NewTag /></span> : null}
                      </div>
                    ) : <Empty a={a} field="email" />}</td> : null}
                  {showing("contact") ? (
                    <td>
                      {contactFor(a)
                        ? <>{contactFor(a).text}{contactFor(a).title ? <span style={{ color: C.slate }}> · {contactFor(a).title}</span> : null}
                          {contactFor(a).fromResearch ? <span style={{ color: C.slateLight, fontSize: 11.5 }}> · from research</span> : null}</>
                        : a.registry_contact ? <>{a.registry_contact.name}{a.registry_contact.role ? <span style={{ color: C.slate }}> · {a.registry_contact.role}</span> : null}<span style={{ color: C.slateLight, fontSize: 11.5 }}> · from the register</span></>
                        : <Empty a={a} />}
                    </td>
                  ) : null}
                  {showing("stage") ? (
                    <td style={{ whiteSpace: "nowrap" }}>
                      <StageBadge stage={a.connection?.stage || "new"} />
                      {extra[a.id]?.warm ? <span title="Opened your emails or engaged with your posts" style={{ ...text, fontSize: 11.5, color: C.amber, marginLeft: 6 }}>Warm</span> : null}
                      {a.connection?.last_call_outcome ? <div style={{ ...muted, fontSize: 11.5 }}>Last call: {String(a.connection.last_call_outcome).replace(/_/g, " ")}</div> : null}
                    </td>
                  ) : null}
                  {showing("quality") ? <td>{a.completeness ? <Completeness c={a.completeness} /> : wasLookedUp(a) ? <QualityBar found={a.found} /> : <span style={{ color: C.slateLight }}>—</span>}</td> : null}
                  {showing("check") ? (
                    <td>
                      <VerdictBadge verification={a.verification} withWhy />
                      {openFixes(a).map((f) => (
                        <div key={f.field} style={{ fontSize: 12, marginTop: 3, color: C.textInk }} title={f.why}>
                          <span style={{ color: C.slate }}>{f.field}:</span> {f.from || "—"} → <strong>{f.to}</strong>{" "}
                          <button title="Use the suggested value in place of the one you entered. Your original is kept beside it" type="button" className="ui-link" onClick={() => acceptFixes([a.id], [f.field])}>Accept</button>
                        </div>
                      ))}
                    </td>
                  ) : null}
                  {showing("website") ? <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}><SiteLink account={a} /></td> : null}
                  {shownOwn.map((n) => (
                    <td key={n} title={a.custom?.[n] || ""} style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.custom?.[n] || <span style={{ color: C.slateLight }}>—</span>}
                    </td>
                  ))}
                  <td style={{ textAlign: "right" }}>
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      {a.on_file?.length && a.business_record_id ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Show the website, phone and email we hold. Free." onClick={() => revealRows([a])}>Reveal</button> : null}
                      <button title="Open this company's full details" type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => onOpen(a)}>
                        {store.researching[a.id] ? <><Spinner size={13} /> Working…</> : "Open"}
                      </button>
                      {listId ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={locked.has(a.id)} onClick={() => removeFromList([a.id])} title={locked.has(a.id) ? LOCK_TIP : "Remove from this list"}>Remove</button> : null}
                    </span>
                  </td>
                </tr>
              ))}
              {!shown.length ? <tr><td colSpan={columnCount} style={{ color: C.slate }}>{filter ? `Nothing matches “${filter}”.` : "Nothing here."}</td></tr> : null}
              <tr><td colSpan={columnCount} style={{ padding: "6px 8px" }}>
                <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Type in one more company yourself" onClick={onAdd}><Plus size={14} /> Add a row</button>
              </td></tr>
            </tbody>
          </table>
        </div>
        {shown.length > ACCOUNT_PAGE_SIZES[0] ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", borderTop: `1px solid ${C.borderLight}` }}>
            <span style={{ ...text, fontSize: 12.5, color: C.slate, fontVariantNumeric: "tabular-nums" }}>
              {(page * pageSize + 1).toLocaleString()}–{Math.min((page + 1) * pageSize, shown.length).toLocaleString()} of {shown.length.toLocaleString()}
            </span>
            <label style={{ ...text, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.slate }}>
              Rows per page
              <select className="ui-input" aria-label="Rows per page" value={pageSize} style={{ height: 30, padding: "0 6px", width: "auto" }}
                onChange={(e) => { const n = Number(e.target.value); setPageSize(n); setPageNo(0); try { localStorage.setItem("aivhub_accounts_page_size", String(n)); } catch (_) { /* just not remembered */ } }}>
                {ACCOUNT_PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={page === 0} onClick={() => setPageNo(page - 1)} aria-label="Previous page">‹ Previous</button>
              <span style={{ ...text, fontSize: 12.5, color: C.slate, fontVariantNumeric: "tabular-nums" }}>Page {page + 1} of {lastPage + 1}</span>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={page >= lastPage} onClick={() => setPageNo(page + 1)} aria-label="Next page">Next ›</button>
            </div>
          </div>
        ) : null}
      </div>
      {checking ? (
        <CheckDialog ids={checking.ids} pendingOnly={checking.pendingOnly} mode={checking.mode} onStart={check.start} onClose={() => setChecking(null)} />
      ) : null}
      {listing && listsStore ? <AddToListDialog ids={pickedIds} listsStore={listsStore} onToast={store.toast} onClose={() => setListing(false)} /> : null}
      {tpsNumbers ? <TpsCheckDialog numbers={tpsNumbers} wallet="leadgen" onClose={() => setTpsNumbers(null)} onDone={() => store.reload()} /> : null}
      {exportOpen && canExport ? <ExportDialog kind="companies" scope={{ ids: pickedIds }} onClose={() => setExportOpen(false)} /> : null}
      {call.dialog}
    </div>
  );
}
