import React, { useEffect, useState } from "react";
import { Copy, FileSpreadsheet, ListChecks, MoreHorizontal, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { C } from "../../../tokens";

const PAGE_SIZE = 6;

function ago(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  const days = Math.round(mins / 1440);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

// The Call list screen when no list is open: every saved list as a card, and a way to bring in a new one.
export function CallListsView({ lists, loading, onOpen, onImport, onNew, onRename, onDuplicate, onDelete, onFindWithAi }) {
  const [menu, setMenu] = useState("");
  const [pageNo, setPageNo] = useState(0);
  const pages = Math.max(1, Math.ceil(lists.length / PAGE_SIZE));
  useEffect(() => { if (pageNo > pages - 1) setPageNo(pages - 1); }, [pages, pageNo]);
  const shown = lists.slice(pageNo * PAGE_SIZE, pageNo * PAGE_SIZE + PAGE_SIZE);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "18px 20px", gap: 14, overflow: "auto" }} className="ui-scroll">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ marginRight: "auto" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textInk }}>Your lists</div>
          <div style={{ fontSize: 12.5, color: C.slate }}>Open a list to call from it, or bring in a new one. Saved lists are shared with your team.</div>
        </div>
        <button type="button" className="ui-btn ui-btn--secondary" onClick={onNew} title="Start an empty list and type contacts in by hand"><Plus size={15} /> New list</button>
        <button type="button" className="ui-btn ui-btn--primary" onClick={onImport} title="Choose a spreadsheet with the people you want to call (CSV or Excel)"><Upload size={15} /> Import CSV / Excel</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
        {shown.map((l) => (
          <div key={l.id} className="ui-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8, position: "relative" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 6, display: "grid", placeItems: "center", background: "var(--ui-accent-soft)", color: C.cobalt, flexShrink: 0 }}>
                <ListChecks size={16} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: C.textInk, overflowWrap: "anywhere" }}>{l.name}</div>
                <div style={{ fontSize: 12, color: C.slate }}>Updated {ago(l.updated_at)}</div>
              </div>
              <button type="button" className="ui-icon-btn ui-icon-btn--sm" title="Rename, copy or delete this list" aria-haspopup="menu" aria-expanded={menu === l.id}
                onClick={() => setMenu((m) => (m === l.id ? "" : l.id))}><MoreHorizontal size={16} /></button>
              {menu === l.id ? (
                <>
                  <div onClick={() => setMenu("")} style={{ position: "fixed", inset: 0, zIndex: 79 }} />
                  <div className="ui-menu" role="menu" style={{ top: 44, right: 10 }}>
                    <button type="button" role="menuitem" className="ui-menu-item" onClick={() => { setMenu(""); onRename(l); }}><Pencil size={15} /> Rename</button>
                    <button type="button" role="menuitem" className="ui-menu-item" onClick={() => { setMenu(""); onDuplicate(l); }}><Copy size={15} /> Duplicate</button>
                    <hr className="ui-menu-sep" />
                    <button type="button" role="menuitem" className="ui-menu-item" onClick={() => { setMenu(""); onDelete(l); }}><Trash2 size={15} /> Delete</button>
                  </div>
                </>
              ) : null}
            </div>
            <div style={{ fontSize: 12.5, color: C.slate, fontVariantNumeric: "tabular-nums" }}>
              <strong style={{ color: C.textInk, fontWeight: 600 }}>{l.count.toLocaleString()}</strong> contact{l.count === 1 ? "" : "s"} · {l.called.toLocaleString()} called
            </div>
            <button type="button" className="ui-btn ui-btn--secondary" style={{ marginTop: "auto" }} onClick={() => onOpen(l)} title={`Open ${l.name} and call from it`}>Open</button>
          </div>
        ))}

        {pageNo === pages - 1 ? (
          <button type="button" onClick={onImport} title="Choose a spreadsheet to make a new list"
            style={{ minHeight: 120, border: "1.5px dashed #CBD1D9", borderRadius: 8, background: "var(--ui-sunken)", color: C.slate, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, font: "500 13px Inter, sans-serif" }}>
            <FileSpreadsheet size={20} color={C.cobalt} />
            Import a new list
            <span style={{ fontSize: 11.5, fontWeight: 400 }}>.csv, .xlsx, .xls, .tsv, .ods, .json</span>
          </button>
        ) : null}
      </div>

      {loading && !lists.length ? <div style={{ fontSize: 12.5, color: C.slate }}>Loading your lists…</div> : null}

      {pages > 1 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 12.5, color: C.slate }}>
          <button type="button" className="ui-btn ui-btn--ghost" disabled={pageNo === 0} onClick={() => setPageNo((n) => n - 1)}>Previous</button>
          <span>Page {pageNo + 1} of {pages}</span>
          <button type="button" className="ui-btn ui-btn--ghost" disabled={pageNo >= pages - 1} onClick={() => setPageNo((n) => n + 1)}>Next</button>
        </div>
      ) : null}

      <div style={{ fontSize: 12.5, color: C.slate, textAlign: "center" }}>
        Or <button type="button" className="ui-link" onClick={onFindWithAi} title="Let the AI search the web for companies to call. Type what you need in the chat on the right">ask List AI to find companies</button>
      </div>
    </div>
  );
}
