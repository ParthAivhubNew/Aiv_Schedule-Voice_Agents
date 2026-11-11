import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bookmark, ChevronDown, Play, Trash2 } from "lucide-react";
import { Spinner } from "../../app/Loader";
import { C, FONT_BODY } from "../../tokens";
import { api } from "../../api/apiClient";
import { askConfirm } from "./Dialogs";
import { weeklyLabel } from "./savedSearchLogic";

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.45 };

const CSS = `
.ss-wrap{position:relative}
.ss-panel{position:absolute;top:calc(100% + 6px);left:0;z-index:40;width:min(380px,calc(100vw - 32px));max-height:70vh;overflow-y:auto;padding:12px;display:grid;gap:10px;box-shadow:0 12px 32px rgba(20,24,40,.14)}
@media (max-width:820px){.ss-panel{position:fixed;left:16px;right:16px;top:auto;width:auto;margin-top:6px}}
.ss-row{display:grid;gap:6px;padding:8px 0;border-top:1px solid var(--ui-line-soft)}
`;

// The Find Leads toolbar dropdown: saved searches to apply, and "save this search as a list".
export function SavedSearches({ filters, hasFilters, onApply }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState("");
  const [name, setName] = useState("");
  const [weekly, setWeekly] = useState(true);
  const [msg, setMsg] = useState("");
  const box = useRef(null);

  const load = useCallback(async () => {
    try { setRows((await api.savedSearches()).searches || []); } catch { setRows([]); }
  }, []);
  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const act = async (id, fn, done) => {
    setBusy(id); setMsg("");
    try { const r = await fn(); await load(); if (done) setMsg(done(r)); } catch (err) { setMsg(err.message || "That didn't work. Try again."); }
    setBusy("");
  };
  const save = () => act("new", async () => {
    const r = await api.saveSearch({ name: name.trim(), filters, list_name: name.trim(), weekly });
    setName("");
    return r;
  }, (r) => `Saved. ${r.last_added || 0} companies are in the list "${r.name}".`);

  return (
    <div className="ss-wrap" ref={box}>
      <style>{CSS}</style>
      <button type="button" className="ui-btn ui-btn--secondary" style={{ height: 40 }} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Bookmark size={15} /> Saved searches{rows.length ? ` · ${rows.length}` : ""} <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="ui-card ss-panel" role="dialog" aria-label="Saved searches">
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ ...text, fontSize: 12, fontWeight: 600, color: C.slate }} htmlFor="ss-name">Save this search as a list</label>
            <input id="ss-name" className="ui-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Leeds accountants" disabled={!hasFilters} />
            <label style={{ ...text, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6, minHeight: 40 }}>
              <input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} /> Keep it updated weekly
            </label>
            <button type="button" className="ui-btn ui-btn--primary" style={{ minHeight: 40 }} disabled={!hasFilters || !name.trim() || busy === "new"} onClick={save}>
              {busy === "new" ? <Spinner size={13} /> : null} Save the search and make the list
            </button>
            {!hasFilters ? <span style={muted}>Set an industry, a place or a reason to get in touch first.</span> : null}
          </div>
          {msg ? <div role="status" style={{ ...muted, color: C.ink }}>{msg}</div> : null}
          {rows.length ? <div style={{ ...text, fontSize: 12, fontWeight: 600, color: C.slate }}>Your saved searches</div> : null}
          {rows.map((s) => (
            <div key={s.id} className="ss-row">
              <button type="button" className="ui-btn ui-btn--ghost" style={{ justifyContent: "flex-start", textAlign: "left", minHeight: 40, fontWeight: 600 }} onClick={() => { onApply(s.filters); setOpen(false); }}>{s.name}</button>
              <span style={muted}>{weeklyLabel(s)}</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ minHeight: 40 }} disabled={busy === s.id}
                  onClick={() => act(s.id, () => api.runSavedSearch(s.id), (r) => `${r.last_added || 0} new ${r.last_added === 1 ? "company" : "companies"} added to the list.`)}>
                  {busy === s.id ? <Spinner size={13} /> : <Play size={13} />} Run now
                </button>
                <label style={{ ...text, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6, minHeight: 40 }}>
                  <input type="checkbox" checked={!!s.weekly} onChange={(e) => act(s.id, () => api.updateSavedSearch(s.id, { weekly: e.target.checked }))} /> Weekly
                </label>
                <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ minHeight: 40, marginLeft: "auto" }} aria-label={`Delete ${s.name}`}
                  onClick={async () => { if (await askConfirm({ title: `Delete "${s.name}"?`, body: "The list it filled stays.", confirm: "Delete", danger: true })) act(s.id, () => api.deleteSavedSearch(s.id)); }}>
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          ))}
          {!rows.length ? <span style={muted}>No saved searches yet.</span> : null}
        </div>
      ) : null}
    </div>
  );
}
