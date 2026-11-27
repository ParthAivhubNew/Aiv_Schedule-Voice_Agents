import React, { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { C, FONT_BODY } from "../tokens";

// One "Filters" button that opens a small panel of a list's filters (plan 13, step 6: the pattern from Find Leads, for every list
// screen), with how many are on. children: the controls, stacked.
export function FilterPopover({ count = 0, children, title = "Filter this list" }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" className="ui-btn ui-btn--secondary" style={{ height: 42 }} aria-haspopup="dialog" aria-expanded={open} title={title} onClick={() => setOpen((v) => !v)}>
        <SlidersHorizontal size={15} aria-hidden="true" /> Filters
        {count ? <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999, background: "var(--ui-accent)", color: C.onAccent, fontSize: 11, fontWeight: 600 }}>{count}</span> : null}
      </button>
      {open ? (
        <div role="dialog" aria-label="Filters" style={{ position: "absolute", left: 0, top: 48, zIndex: 30, width: 300, maxWidth: "calc(100vw - 32px)", padding: 14, display: "flex", flexDirection: "column", gap: 12, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 16px 40px rgba(15,23,42,0.16)", fontFamily: FONT_BODY }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

// The filters that are on, as chips: × takes one off. chips: [{ key, text, onRemove }]
export function FilterChips({ chips, onClearAll }) {
  if (!chips.length) return null;
  return (
    <div aria-label="Filters in use" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      {chips.map((c) => (
        <span key={c.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, maxWidth: 280, height: 28, padding: "0 4px 0 10px", borderRadius: 999, background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.text}</span>
          <button type="button" aria-label={`Remove ${c.text}`} title={`Remove ${c.text}`} onClick={c.onRemove}
            style={{ all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: 999 }}><X size={12} /></button>
        </span>
      ))}
      {onClearAll && chips.length > 1 ? (
        <button type="button" onClick={onClearAll} style={{ all: "unset", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, padding: "0 6px", height: 28, display: "inline-flex", alignItems: "center" }}>Clear all</button>
      ) : null}
    </div>
  );
}

// Tabs with a count, underlined when on, like Find Leads' All · New to you · Saved. tabs: [{ id, label, count, tip, dot }]
export function CountTabs({ tabs, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} style={{ display: "flex", gap: 4, overflowX: "auto", maxWidth: "100%" }}>
      {tabs.map((t) => {
        const on = value === t.id;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={on} title={t.tip} onClick={() => onChange(t.id)}
            style={{ all: "unset", cursor: "pointer", boxSizing: "border-box", height: 32, padding: "0 12px", display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", borderRadius: 8, margin: "6px 0", background: on ? "var(--ui-hover)" : "transparent", fontFamily: FONT_BODY, fontSize: 13.5 }}>
            {t.dot ? <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: t.dot }} /> : null}
            <span style={{ color: on ? C.ink : C.slate, fontWeight: on ? 600 : 500 }}>{t.label}</span>
            <span style={{ color: on ? C.ink : C.slate, fontVariantNumeric: "tabular-nums" }}>{Number(t.count || 0).toLocaleString()}</span>
          </button>
        );
      })}
    </div>
  );
}
