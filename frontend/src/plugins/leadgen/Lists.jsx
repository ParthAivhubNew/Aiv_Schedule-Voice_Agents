import React, { useCallback, useEffect, useState } from "react";
import { Check, ListChecks, Megaphone, Pencil, Phone, Plus, Trash2, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";
import { AccountsView, contactFor, emailFor, phoneFor } from "./AccountsViews";
import { useConnection } from "../../hooks/useConnections";
import { buildCallList, stageCallList } from "../../utils/leadToVoice";
import { navigateHash } from "../../utils/route";
import { CallButton, useCallDialog } from "./CallFlow";
import { askConfirm, askText } from "./Dialogs";

// Lists: a named group of saved companies. Build one in Saved Accounts, enrich it here, then run a
// campaign on it. A list only remembers which companies are in it; the companies stay in Saved Accounts.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };

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
  const [openId, setOpenId] = useState(""); // a list id, "all" for every company, or "" for the overview
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(""); // id of the list whose name is being edited
  const open = lists.find((l) => l.id === openId);
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
    if (!list.records.length) { store.toast("None of these companies has a phone number yet. Check & improve them first."); return; }
    if (!stageCallList(list)) { store.toast("Couldn't pass the list to Voice."); return; }
    navigateHash("voice/list");
  };

  if (loading || store.loading) return <div style={muted}>Loading your lists…</div>;
  if (openId === "all" || open) {
    const scope = open ? new Set(open.ids) : null;
    const { members, withEmail } = open ? listReach(open, store.accounts) : listReach({ ids: store.accounts.map((a) => a.id) }, store.accounts);
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
          <CallButton label="Call this list" lockedLabel="Call this list · add Voice" disabled={busy || !members.length}
            onClick={() => call.open({ kind: "list", id: open ? open.id : "all", name: open ? open.name : "All companies" })}
            onLocked={() => call.open({ kind: "list", id: open ? open.id : "all", name: open ? open.name : "All companies" }, true)} />
          {canCall ? (
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy || !members.length} title="Open these companies on the Voice call list to look them over first"
              onClick={() => reviewInVoice(open ? open.name : "All companies", members)}>Review in Voice</button>
          ) : null}
          {open ? (
            <>
              <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!withEmail.length} onClick={() => onCampaign(open.id)}
                title={withEmail.length ? "" : "None of these companies has an email yet. Check & improve them first."}>
                <Megaphone size={14} /> Start a campaign
              </button>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy} title="Change the name of this list"
                onClick={() => setRenaming(open.id)}><Pencil size={14} /> Rename</button>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy} title="Delete the list only. The companies stay in your account"
                onClick={async () => { if (await askConfirm({ title: `Delete the list ${open.name}?`, body: "The companies stay in your account and in your other lists.", confirm: "Delete list", danger: true })) act(async () => { await api.deleteLeadList(open.id); setOpenId(""); }, "List deleted."); }}><Trash2 size={14} /> Delete</button>
            </>
          ) : null}
        </div>
        <AccountsView store={store} listsStore={listsStore} onOpen={onOpen} onAdd={onAdd} onGo={onGo} scopeIds={scope} listId={open ? open.id : ""} />
        {call.dialog}
      </div>
    );
  }
  const everyone = listReach({ ids: store.accounts.map((a) => a.id) }, store.accounts);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ ...muted, flex: "1 1 280px" }}>Every search you save and every file you import becomes a list. Open a list to check and improve it, fix what is wrong, then start a campaign on it.</div>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Search for companies, or bring in your own spreadsheet" onClick={() => onGo("find_leads")}>Find companies or import a file</button>
        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" title="Create an empty list, then add companies to it" onClick={async () => {
          const name = await askText({ title: "Name your new list", label: "For example Leeds dentists", confirm: "Create list", maxLength: 80 });
          if (!name) return;
          try {
            const r = await api.createLeadList(name.trim(), []);
            await reload();
            setOpenId(r.list.id);
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {[{ id: "all", name: "All companies", ...everyone }, ...lists.map((l) => ({ ...l, ...listReach(l, store.accounts) }))].map((l) => (
            <div key={l.id} role="button" tabIndex={0} title={`Open ${l.name}`} className="ui-card" onClick={() => { if (renaming !== l.id) setOpenId(l.id); }}
              onKeyDown={(e) => { if (e.key === "Enter" && renaming !== l.id) setOpenId(l.id); }}
              style={{ textAlign: "left", padding: 16, cursor: "pointer", display: "flex", flexDirection: "column", gap: 4 }}>
              <ListName list={l} editing={renaming === l.id} onEdit={() => setRenaming(l.id)} onStop={() => setRenaming("")} onSave={(n) => rename(l.id, n)} />
              <div style={muted}>{l.members.length.toLocaleString()} companies · {l.withEmail.length.toLocaleString()} with an email{progress(l.members.map((m) => m.id))}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
      if (target === "new") await api.createLeadList(name, ids);
      else await api.updateLeadList(target, { add: ids });
      await listsStore.reload();
      onToast(`Added ${ids.length.toLocaleString()} ${ids.length === 1 ? "company" : "companies"} to the list.`);
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
