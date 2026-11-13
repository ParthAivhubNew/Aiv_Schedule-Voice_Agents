import React, { useCallback, useEffect, useState } from "react";
import { lastList, takePendingList } from "./openList";
import { GridTools } from "../../components/GridTools";
import { CardsSkeleton } from "../../app/Loader";
import { Check, ListChecks, Megaphone, Pencil, Plus, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";
import { AccountsView, contactFor, emailFor, MoreMenu, openFixes, phoneFor } from "./AccountsViews";
import { useIcp } from "./FitParts";
import { listStats } from "./listLogic";
import { useConnection } from "../../hooks/useConnections";
import { buildCallList, LISTS_CHANGED, setOpenList, stageCallList } from "../../utils/leadToVoice";
import { navigateHash } from "../../utils/route";
import { useCallDialog } from "./CallFlow";
import { LOCK_TIP, useLocked } from "./CheckCompanies";
import { askConfirm, askText } from "./Dialogs";
import { ConsentDeclaration } from "./ConsentDeclaration";

// Lists: a named group of saved companies. Build one in Saved Accounts, enrich it here, then run a
// campaign on it. A list only remembers which companies are in it; the companies stay in Saved Accounts.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };

// "Today", "Yesterday" or the date: enough to tell which list was worked on lately.
function whenShort(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: days > 300 ? "numeric" : undefined });
}

export function useLeadLists(onToast) {
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      setLists((await api.listLeadLists()).lists || []);
    } catch (e) {
      onToast?.(e.message || "Couldn't load your lists.");
    } finally {
      setLoading(false);
    }
  }, [onToast]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    window.addEventListener(LISTS_CHANGED, reload);
    return () => window.removeEventListener(LISTS_CHANGED, reload);
  }, [reload]);
  return { lists, loading, reload };
}

// The companies in a list, and how many of them have an email we could send to.
export function listReach(list, accounts) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const members = list.ids.map((i) => byId.get(i)).filter(Boolean);
  return { members, withEmail: members.filter((a) => emailFor(a)?.text) };
}

// A list's name, editable in place: the pencil (or a click on the name) turns it into a box.
function ListName({ list, editing, onEdit, onSave, onStop, size = 15 }) {
  const [draft, setDraft] = useState(list.name);
  useEffect(() => { if (editing) setDraft(list.name); }, [editing, list.name]);
  if (!editing) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ ...text, fontSize: size, fontWeight: 600, color: C.ink, overflowWrap: "anywhere" }}>{list.name}</span>
        {list.id !== "all" ? (
          <span role="button" tabIndex={0} aria-label={`Rename ${list.name}`} title="Rename this list"
            onClick={(e) => { e.stopPropagation(); onEdit(); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onEdit(); } }}
            style={{ display: "inline-flex", cursor: "pointer", color: C.slate, padding: 2 }}><Pencil size={14} /></span>
        ) : null}
      </span>
    );
  }
  const save = () => { const n = draft.trim(); if (n && n !== list.name) onSave(n); else onStop(); };
  return (
    <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <input className="ui-input" autoFocus value={draft} maxLength={80} aria-label="List name" style={{ height: 30, width: 200 }}
        onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onStop(); }} />
      <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" title="Save the new name" disabled={!draft.trim()} onClick={save}><Check size={14} /> Save</button>
      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Keep the old name" onClick={onStop}><X size={14} /></button>
    </span>
  );
}

export function ListsView({ store, listsStore, onGo, onOpen, onAdd, onCampaign }) {
  const { lists, loading, reload } = listsStore;
  const { available: canCall } = useConnection("call_leads");
  const call = useCallDialog(store.toast);
  const icp = useIcp();
  const [reach, setReach] = useState({}); // per company: has it been called, is it interested (from the connections view)
  useEffect(() => {
    let live = true;
    if (canCall) api.getConnectionLeads().then((r) => { if (live) setReach(r.leads || {}); }).catch(() => {});
    return () => { live = false; };
  }, [canCall, store.accounts, lists]);
  // "Called 29 of 42 · 6 interested", only once calling is part of the plan.
  const progress = (ids) => {
    if (!canCall) return "";
    const called = ids.filter((i) => reach[i] && reach[i].history !== "never").length;
    const interested = ids.filter((i) => ["interested", "meeting", "won"].includes(reach[i]?.stage)).length;
    return called ? ` · called ${called.toLocaleString()} of ${ids.length.toLocaleString()}${interested ? ` · ${interested.toLocaleString()} interested` : ""}` : "";
  };
  const [openId, setOpenId] = useState(takePendingList); // a list id, "all" for every company, or "" for the overview
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(""); // id of the list whose name is being edited
  const [consentFor, setConsentFor] = useState(""); // id of the list whose consent question is open
  const open = lists.find((l) => l.id === openId);
  useEffect(() => { lastList.id = openId; }, [openId]); // so Back from a company opened in this list comes back here, not to all lists
  const rename = async (id, name) => {
    setBusy(true);
    try {
      await api.updateLeadList(id, { name });
      await reload();
      store.toast("Renamed.");
      setRenaming("");
    } catch (e) {
      store.toast(e.message || "Couldn't rename it.");
    } finally {
      setBusy(false);
    }
  };

  // "Review in Voice first": the same companies, opened on the Voice call list to look over and change before calling.
  const reviewInVoice = (name, members) => {
    const list = buildCallList(name, members, phoneFor, contactFor, emailFor);
    if (!list.records.length) { store.toast("None of these companies has a phone number yet. Use Get contacts on them first."); return; }
    if (!stageCallList(list)) { store.toast("Couldn't pass the list to Voice."); return; }
    navigateHash("#/voice/list");
  };

  // While a list is open, tell the app shell so switching to Voice can offer to bring it along.
  useEffect(() => {
    const current = openId === "all" || open;
    if (!current || !canCall) { setOpenList("leadgen", null); return undefined; }
    const name = open ? open.name : "All companies";
    const { members } = open ? listReach(open, store.accounts) : listReach({ ids: store.accounts.map((a) => a.id) }, store.accounts);
    setOpenList("leadgen", { name, count: members.length, build: () => buildCallList(name, members, phoneFor, contactFor, emailFor) });
    return () => setOpenList("leadgen", null);
  }, [openId, open, canCall, store.accounts]);

  const locked = useLocked();
  if (loading || store.loading) return <CardsSkeleton count={4} label="Loading your lists" />;
  if (openId === "all" || open) {
    const scope = open ? new Set(open.ids) : null;
    const { members, withEmail } = open ? listReach(open, store.accounts) : listReach({ ids: store.accounts.map((a) => a.id) }, store.accounts);
    const fixIds = members.filter((a) => openFixes(a).length).map((a) => a.id);
    const act = async (fn, done) => {
      setBusy(true);
      try {
        await fn();
        await reload();
        if (done) store.toast(done);
      } catch (e) {
        store.toast(e.message || "That didn't work.");
      } finally {
        setBusy(false);
      }
    };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button title="Back to all your lists" type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setOpenId("")}>← All lists</button>
          {open ? <ListName list={open} size={17} editing={renaming === open.id} onEdit={() => setRenaming(open.id)} onStop={() => setRenaming("")} onSave={(n) => rename(open.id, n)} />
            : <div style={{ ...text, fontSize: 17, fontWeight: 600, color: C.ink }}>All companies</div>}
          <span style={muted}>{members.length.toLocaleString()} companies · {withEmail.length.toLocaleString()} with an email{progress(members.map((m) => m.id))}</span>
          <span style={{ flex: 1 }} />
          {open ? (
            <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!withEmail.length} onClick={() => onCampaign(open.id)}
              title={withEmail.length ? "" : "None of these companies has an email yet. Use Get contacts first."}>
              <Megaphone size={14} /> Start journey
            </button>
          ) : null}
          <MoreMenu items={[
            { label: canCall ? "Call this list" : "Call this list · add Voice", disabled: busy || !members.length, title: "Have your AI caller phone them",
              onClick: () => call.open({ kind: "list", id: open ? open.id : "all", name: open ? open.name : "All companies" }, !canCall) },
            canCall ? { label: "Review in Voice", disabled: busy || !members.length, title: "Open these companies on the Voice call list to look them over first", onClick: () => reviewInVoice(open ? open.name : "All companies", members) } : null,
            open ? { label: "How they agreed", title: "Tell us how these contacts agreed to hear from you, so sole traders among them can be emailed", onClick: () => setConsentFor(consentFor === open.id ? "" : open.id) } : null,
            { label: "Review old contacts", title: "See contacts you haven't touched in a long time and decide which to keep or delete", onClick: () => onGo("retention") },
            open ? { label: "Rename", disabled: busy, title: "Change the name of this list", onClick: () => setRenaming(open.id) } : null,
            open ? { label: "Delete list", danger: true, disabled: busy || open.ids.some((i) => locked.has(i)), title: open.ids.some((i) => locked.has(i)) ? LOCK_TIP : "Delete the list only. The companies stay in your account",
              onClick: async () => { if (await askConfirm({ title: `Delete the list ${open.name}?`, body: "The companies stay in your account and in your other lists.", confirm: "Delete list", danger: true })) act(async () => { await api.deleteLeadList(open.id); setOpenId(""); }, "List deleted."); } } : null,
            fixIds.length ? { label: `Accept all fixes (${fixIds.length.toLocaleString()})`, disabled: busy, title: "Apply every suggested fix in this list. The value you had is kept in the company's check details",
              onClick: async () => {
                if (!(await askConfirm({ title: `Apply ${fixIds.length.toLocaleString()} ${fixIds.length === 1 ? "company's" : "companies'"} suggested fixes?`, body: "The values you had stay noted in each company's check details.", confirm: "Apply fixes" }))) return;
                try { const r = await api.acceptCheckFixes(fixIds); await store.reload(); store.toast(r.applied ? `Applied ${r.applied} ${r.applied === 1 ? "fix" : "fixes"}.` : "Nothing to apply."); } catch (e) { store.toast(e.message || "Couldn't apply the fixes."); }
              } } : null,
          ]} />
        </div>
        {open && consentFor === open.id ? (
          <ConsentDeclaration key={open.id} listId={open.id} scope="list" count={open.ids.length} onClose={() => setConsentFor("")}
            onDone={(_, msg) => { store.toast?.(msg); store.reload?.(); }} />
        ) : null}
        <AccountsView store={store} listsStore={listsStore} onOpen={onOpen} onAdd={onAdd} onGo={onGo} onCampaign={onCampaign} scopeIds={scope} listId={open ? open.id : ""} moreInHeader />
        {call.dialog}
      </div>
    );
  }
  const everyone = listReach({ ids: store.accounts.map((a) => a.id) }, store.accounts);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ ...muted, flex: "1 1 280px" }}>Every search you save and every file you import becomes a list. Open a list to check and improve it, fix what is wrong, then start a journey on it.</div>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Search for companies, or bring in your own spreadsheet" onClick={() => onGo("find_leads")}>Find companies or import a file</button>
        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" title="Create an empty list, then add companies to it" onClick={async () => {
          const name = await askText({ title: "Name your new list", label: "For example Leeds dentists", confirm: "Create list", maxLength: 80 });
          if (!name) return;
          try {
            const r = await api.createLeadList(name.trim(), []);
            await reload();
            setOpenId(r.list.id);
            store.toast(`Created the list ${name.trim()}.`);
          } catch (e) {
            store.toast(e.message || "Couldn't create the list.");
          }
        }}><Plus size={14} /> New list</button>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Type in one company yourself" onClick={onAdd}>Add one by hand</button>
      </div>
      {!lists.length && !store.accounts.length ? (
        <div className="ui-card" style={{ padding: "40px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <ListChecks size={28} color="#8B5CF6" />
          <div style={{ ...text, fontSize: 16, fontWeight: 600, color: C.ink }}>No lists yet</div>
          <div style={{ ...muted, maxWidth: 420 }}>Search for companies or import your own file in Find Leads. What you save lands here as a list.</div>
          <button title="Search for companies or import a file" type="button" className="ui-btn ui-btn--primary" onClick={() => onGo("find_leads")}>Go to Find Leads</button>
        </div>
      ) : (
        <div className="ui-card" style={{ overflow: "hidden" }}>
          <GridTools id="my-lists" />
          <div className="ui-scroll" style={{ overflowX: "auto" }}>
            <table className="ui-table" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th>List name</th>
                  <th style={{ textAlign: "right" }} title="Companies in the list">Companies</th>
                  <th style={{ textAlign: "right" }} title="Has an email that passed the checks and has not been contacted yet">Ready to email</th>
                  <th style={{ textAlign: "right" }} title="How many have an email we can send to">With an email</th>
                  <th style={{ textAlign: "right" }} title="The average fit score of the companies that have one">Avg fit</th>
                  <th>Owner</th>
                  <th title="Where most of these companies came from">Source</th>
                  <th title="When companies were last added or taken out">Last changed</th>
                  <th style={{ textAlign: "right" }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {[{ id: "all", name: "All companies", ...everyone }, ...lists.map((l) => ({ ...l, ...listReach(l, store.accounts) }))].map((full) => { const l = { ...full, stats: listStats(full.members) }; return (
                  <tr key={l.id} title={`Open ${l.name}`} style={{ cursor: "pointer" }} onClick={() => { if (renaming !== l.id) setOpenId(l.id); }}>
                    <td>
                      <ListName list={l} editing={renaming === l.id} onEdit={() => setRenaming(l.id)} onStop={() => setRenaming("")} onSave={(n) => rename(l.id, n)} size={14} />
                      {progress(l.members.map((m) => m.id)) ? <div style={{ ...muted, fontSize: 12 }}>{progress(l.members.map((m) => m.id)).replace(/^ · /, "")}</div> : null}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.members.length.toLocaleString()}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.stats.ready.toLocaleString()}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.withEmail.length.toLocaleString()}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{icp.isSet && l.stats.avgFit != null ? l.stats.avgFit : "–"}</td>
                    <td style={{ color: C.slate, whiteSpace: "nowrap" }}>{l.owner || "–"}</td>
                    <td style={{ color: C.slate, whiteSpace: "nowrap" }}>{l.stats.source || "–"}</td>
                    <td style={{ color: C.slate, whiteSpace: "nowrap" }}>{whenShort(l.updated_at || l.created_at)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setOpenId(l.id)}>Open</button>
                    </td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// What the server really did, so "36 selected" never reads as "36 added" when some were already in the list or are not saved companies.
export function addedMessage(r, asked) {
  const added = r?.added ?? asked;
  const noun = (n) => `${n.toLocaleString()} ${n === 1 ? "company" : "companies"}`;
  let text = `Added ${noun(added)} to the list.`;
  if (r?.already) text += ` ${noun(r.already)} ${r.already === 1 ? "was" : "were"} already in it.`;
  if (r?.missing) text += ` ${noun(r.missing)} could not be added because ${r.missing === 1 ? "it is" : "they are"} not saved in Leads yet.`;
  return text;
}

// "Add to list" box on Saved Accounts: pick an existing list or name a new one.
export function AddToListDialog({ ids, listsStore, onToast, onClose }) {
  const [target, setTarget] = useState(listsStore.lists[0]?.id || "new");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const go = async () => {
    setBusy(true);
    setError("");
    try {
      const r = target === "new" ? await api.createLeadList(name, ids) : await api.updateLeadList(target, { add: ids });
      await listsStore.reload();
      onToast(addedMessage(r, ids.length));
      onClose();
    } catch (e) {
      setError(e.message || "Couldn't add them.");
      setBusy(false);
    }
  };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-label="Add to list" onClick={(e) => e.stopPropagation()} className="ui-card" style={{ width: "min(100%, 420px)", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ ...text, fontSize: 16, fontWeight: 600, color: C.ink }}>Add {ids.length.toLocaleString()} {ids.length === 1 ? "company" : "companies"} to a list</div>
        <select className="ui-input" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="List">
          {listsStore.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          <option value="new">+ A new list</option>
        </select>
        {target === "new" ? <input className="ui-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, for example Leeds dentists" aria-label="New list name" /> : null}
        {error ? <div role="alert" style={{ ...text, fontSize: 13, color: C.red }}>{error}</div> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button title="Back to the first list and clear the name" type="button" className="ui-btn ui-btn--ghost" onClick={() => { setTarget(listsStore.lists[0]?.id || "new"); setName(""); setError(""); }}>Reset</button>
          <button title="Close without saving" type="button" className="ui-btn ui-btn--ghost" onClick={onClose}>Cancel</button>
          <button title="Add these companies to the list" type="button" className="ui-btn ui-btn--primary" disabled={busy || (target === "new" && !name.trim())} onClick={go}>{busy ? "Adding…" : "Add"}</button>
        </div>
      </div>
    </div>
  );
}
