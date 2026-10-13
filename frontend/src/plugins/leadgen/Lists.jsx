import React, { useCallback, useEffect, useState } from "react";
import { ListChecks, Megaphone, Plus, Trash2 } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";
import { AccountsView, emailFor } from "./AccountsViews";

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

export function ListsView({ store, listsStore, onGo, onOpen, onAdd, onCampaign }) {
  const { lists, loading, reload } = listsStore;
  const [openId, setOpenId] = useState(""); // a list id, "all" for every company, or "" for the overview
  const [busy, setBusy] = useState(false);
  const open = lists.find((l) => l.id === openId);

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
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setOpenId("")}>← All lists</button>
          <div style={{ ...text, fontSize: 17, fontWeight: 600, color: C.ink }}>{open ? open.name : "All companies"}</div>
          <span style={muted}>{members.length.toLocaleString()} companies · {withEmail.length.toLocaleString()} with an email</span>
          <span style={{ flex: 1 }} />
          {open ? (
            <>
              <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!withEmail.length} onClick={() => onCampaign(open.id)}
                title={withEmail.length ? "" : "None of these companies has an email yet. Get contact details first."}>
                <Megaphone size={14} /> Start a campaign
              </button>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy} title="Change the name of this list"
                onClick={() => { const n = window.prompt("Rename this list", open.name); if (n && n.trim()) act(() => api.updateLeadList(open.id, { name: n }), "Renamed."); }}>Rename</button>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy} title="Delete the list only. The companies stay in your account"
                onClick={() => { if (window.confirm(`Delete the list ${open.name}? The companies stay in your account and in your other lists.`)) act(async () => { await api.deleteLeadList(open.id); setOpenId(""); }, "List deleted."); }}><Trash2 size={14} /> Delete</button>
            </>
          ) : null}
        </div>
        <AccountsView store={store} listsStore={listsStore} onOpen={onOpen} onAdd={onAdd} onGo={onGo} scopeIds={scope} listId={open ? open.id : ""} />
      </div>
    );
  }
  const everyone = listReach({ ids: store.accounts.map((a) => a.id) }, store.accounts);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ ...muted, flex: "1 1 280px" }}>Every search you save and every file you import becomes a list. Open a list to get contact details, fix what is wrong, then start a campaign on it.</div>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Search for companies, or bring in your own spreadsheet" onClick={() => onGo("find_leads")}>Find companies or import a file</button>
        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" title="Create an empty list, then add companies to it" onClick={async () => {
          const name = window.prompt("Name your new list", "");
          if (!name || !name.trim()) return;
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
          <button type="button" className="ui-btn ui-btn--primary" onClick={() => onGo("find_leads")}>Go to Find Leads</button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {[{ id: "all", name: "All companies", ...everyone }, ...lists.map((l) => ({ ...l, ...listReach(l, store.accounts) }))].map((l) => (
            <button key={l.id} type="button" className="ui-card" onClick={() => setOpenId(l.id)} style={{ textAlign: "left", padding: 16, cursor: "pointer", display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ ...text, fontSize: 15, fontWeight: 600, color: C.ink }}>{l.name}</div>
              <div style={muted}>{l.members.length.toLocaleString()} companies · {l.withEmail.length.toLocaleString()} with an email</div>
            </button>
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
          <button type="button" className="ui-btn ui-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="ui-btn ui-btn--primary" disabled={busy || (target === "new" && !name.trim())} onClick={go}>{busy ? "Adding…" : "Add"}</button>
        </div>
      </div>
    </div>
  );
}
