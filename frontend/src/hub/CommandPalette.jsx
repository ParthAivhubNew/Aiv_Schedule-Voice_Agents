import React, { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { C, FONT_BODY } from "../tokens";
import { api } from "../api/apiClient";
import { navigateHash } from "../utils/route";
import { openWorkflows } from "../workflows/openWorkflows";
import { openLead } from "../connections/ConnectedHome";
import { useShowInstallSteps } from "../components/installState";
import { openSupport } from "./openSupport";
import { helpForHere } from "./PluginHub";
import { commandItems, matchCommands } from "./commandItems";

export const OPEN_SEARCH = "outreach:open-search";
export const openSearch = () => window.dispatchEvent(new Event(OPEN_SEARCH));
const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
export const searchKeys = () => (isMac() ? "⌘K" : "Ctrl K");

// Search (⌘K / Ctrl K) (plan 13, step 7): one box that opens any page, any setting, and any company, person, call, meeting or post.
// It is the way to everything that left the menus. Arrow keys move, Enter opens, Escape closes.
export function CommandPalette({ operator }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState(null); // the server's groups for q
  const [at, setAt] = useState(0);
  const input = useRef(null);
  const list = useRef(null);
  const installable = useShowInstallSteps();
  const items = useMemo(() => commandItems(operator, { installable }), [operator, installable]);

  useEffect(() => {
    const key = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && String(e.key).toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); }
    };
    const show = () => setOpen(true);
    window.addEventListener("keydown", key);
    window.addEventListener(OPEN_SEARCH, show);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener(OPEN_SEARCH, show); };
  }, []);
  useEffect(() => {
    if (open) { setQ(""); setFound(null); setAt(0); window.setTimeout(() => input.current?.focus(), 0); }
  }, [open]);
  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) { setFound(null); return undefined; }
    let live = true;
    const t = window.setTimeout(() => { api.searchEverything(term).then((r) => live && setFound(r.groups || [])).catch(() => live && setFound([])); }, 220);
    return () => { live = false; window.clearTimeout(t); };
  }, [q, open]);

  const pages = matchCommands(items, q);
  const records = (found || []).filter((g) => g.items.length).flatMap((g) => g.items.slice(0, 5).map((it) => ({ id: `${g.kind}:${it.id}`, label: it.title, hint: it.detail, group: g.label, record: { kind: g.kind, item: it } })));
  const rows = [...pages, ...records];
  useEffect(() => { setAt(0); }, [q, found]);
  useEffect(() => { list.current?.querySelector(`[data-row="${at}"]`)?.scrollIntoView({ block: "nearest" }); }, [at]);
  if (!open) return null;

  const run = (row) => {
    setOpen(false);
    if (row.record) {
      const { kind, item } = row.record;
      if (kind === "lead") openLead(item.id);
      else if (kind === "call" || kind === "meeting") (item.lead_id ? openLead(item.lead_id) : navigateHash(kind === "call" ? "#/voice/logs" : "#/voice/schedule"));
      else navigateHash("#/scheduler/plan");
      return;
    }
    if (row.go === "workflows") openWorkflows({});
    else if (row.go === "support") openSupport({ plugin: helpForHere().plugin });
    else if (row.go === "help") window.open(helpForHere().docs, "_blank");
    else if (row.go === "calendar") window.dispatchEvent(new CustomEvent("aivhub:open-calendar-settings", { detail: "accounts" }));
    else navigateHash(row.go === "#/" ? "" : row.go);
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && rows[at]) { e.preventDefault(); run(rows[at]); }
  };

  let lastGroup = "";
  return (
    <div role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(15,23,42,0.35)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "12vh 16px 16px" }}>
      <div role="dialog" aria-modal="true" aria-label="Search" style={{ width: "100%", maxWidth: 640, background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, boxShadow: "0 24px 70px rgba(15,23,42,0.28)", overflow: "hidden", fontFamily: FONT_BODY }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px", height: 54, borderBottom: `1px solid ${C.border}` }}>
          <Search size={18} color={C.slate} aria-hidden="true" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search pages, settings, companies and people"
            aria-label="Search" role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={rows[at] ? `cmdk-${at}` : undefined}
            style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", fontFamily: FONT_BODY, fontSize: 15.5, color: C.ink }} />
          <kbd style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, border: `1px solid ${C.border}`, borderRadius: 6, padding: "2px 6px" }}>Esc</kbd>
        </div>
        <div ref={list} id="cmdk-list" role="listbox" aria-label="Results" style={{ maxHeight: "min(420px, 60vh)", overflowY: "auto", padding: 6 }}>
          {rows.map((row, i) => {
            const head = row.group !== lastGroup ? row.group : "";
            lastGroup = row.group;
            const on = i === at;
            return (
              <React.Fragment key={row.id}>
                {head ? <div style={{ padding: "10px 10px 4px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: C.slate }}>{head}</div> : null}
                <div id={`cmdk-${i}`} data-row={i} role="option" aria-selected={on} onMouseMove={() => setAt(i)} onClick={() => run(row)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer", background: on ? "var(--ui-hover)" : "transparent" }}>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: C.ink, whiteSpace: "nowrap" }}>{row.label}</span>
                    {row.hint ? <span style={{ fontSize: 12.5, color: C.slate, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.hint}</span> : null}
                  </span>
                  {on ? <CornerDownLeft size={14} color={C.slate} aria-hidden="true" /> : null}
                </div>
              </React.Fragment>
            );
          })}
          {!rows.length ? <div style={{ padding: "18px 12px", fontSize: 13.5, color: C.slate }}>{found === null && q.trim().length >= 2 ? "Searching…" : `Nothing found for “${q.trim()}”.`}</div> : null}
          {rows.length && q.trim().length >= 2 && found === null ? <div style={{ padding: "8px 12px", fontSize: 12.5, color: C.slate }}>Looking for companies and people…</div> : null}
        </div>
      </div>
    </div>
  );
}

// The search box in every header: it opens the same search.
export function SearchButton({ compact = false }) {
  return (
    <button type="button" className="ui-btn ui-btn--secondary hide-xs" onClick={openSearch} title={`Search pages, settings, companies and people (${searchKeys()})`}
      aria-label="Search" style={{ height: 36, gap: 8, color: C.slate, fontWeight: 500, minWidth: compact ? 0 : 180, justifyContent: "flex-start" }}>
      <Search size={15} aria-hidden="true" />
      {compact ? null : <span style={{ flex: 1, textAlign: "left" }}>Search</span>}
      <kbd style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slate, border: `1px solid ${C.border}`, borderRadius: 5, padding: "1px 5px" }}>{searchKeys()}</kbd>
    </button>
  );
}
