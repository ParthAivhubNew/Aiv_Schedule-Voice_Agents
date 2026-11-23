import React, { useId, useRef, useState } from "react";
import { Database, FileUp, Globe, Landmark, MapPin, Phone, Search, ShieldCheck, ShieldQuestion, User } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { describeSources } from "./sourceBadgeLogic";

const ICONS = { register: Landmark, website: Globe, user: User, import: FileUp, web: Search, check: Phone, google_places: MapPin, apollo: Database };

// Clipped off screen, still read aloud, so the button's description is always there.
const hidden = { position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };
const head = { fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: C.slate, margin: "8px 0 3px" };

// A shield and one tiny chip per source under a company name. Hover, focus or a tap opens what each detail came from and what was checked.
// `defaultOpen` is for tests and screenshots only.
export function SourceBadge({ account, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [pos, setPos] = useState(null);
  const id = useId();
  const btn = useRef(null);
  const d = describeSources(account);
  const name = account?.name || "this company";

  const show = () => {
    // Fixed so a table's scroll box cannot clip it; kept inside the screen at 375px.
    const r = btn.current?.getBoundingClientRect?.();
    if (r && typeof window !== "undefined") {
      const w = Math.min(300, window.innerWidth - 32);
      const left = Math.max(16, Math.min(r.left, window.innerWidth - w - 16));
      const below = r.bottom + 6;
      setPos(below + 220 > window.innerHeight && r.top > 240 ? { left, bottom: window.innerHeight - r.top + 6, width: w } : { left, top: below, width: w });
    }
    setOpen(true);
  };
  const Shield = d.checked || d.fields.length ? ShieldCheck : ShieldQuestion;

  return (
    <span style={{ display: "inline-flex", verticalAlign: "middle" }} onMouseEnter={show} onMouseLeave={() => setOpen(false)} onClick={(e) => e.stopPropagation()}>
      <button ref={btn} type="button" aria-describedby={id} aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); if (open) setOpen(false); else show(); }}
        onFocus={show} onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); e.stopPropagation(); } }}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 44, minHeight: 44, margin: "-12px 0", padding: "0 6px", border: 0, background: "transparent", color: d.checked ? C.green : C.slate, cursor: "help", borderRadius: 8 }}>
        <Shield size={15} aria-hidden="true" />
        {d.sources.map((s) => {
          const Icon = ICONS[s.key] || Globe;
          return <span key={s.label} aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 5, background: C.paperSoft, color: C.slate }}><Icon size={11} /></span>;
        })}
        <span style={hidden}>{`Where ${name}'s details come from and what was checked. ${d.summary}`}</span>
      </button>
      <span id={id} role="tooltip"
        style={open ? { position: "fixed", zIndex: 60, ...pos, boxSizing: "border-box", maxWidth: "calc(100vw - 32px)", maxHeight: "60vh", overflowY: "auto", padding: "10px 12px", borderRadius: 10, background: "#fff", color: C.textInk, border: `1px solid ${C.border}`, boxShadow: "0 8px 24px rgba(15,23,42,.18)", fontFamily: FONT_BODY, fontSize: 12.5, lineHeight: 1.45, fontWeight: 400, whiteSpace: "normal", textAlign: "left" } : hidden}>
        <div style={{ ...head, marginTop: 0 }}>Details from</div>
        {d.fields.length
          ? d.fields.map((f) => <div key={f.field}><span style={{ color: C.slate }}>{f.field}:</span> {f.label}</div>)
          : <div style={{ color: C.slate }}>No source is recorded for this company's details yet.</div>}
        <div style={head}>Checked against</div>
        {d.checked
          ? d.checks.map((c) => <div key={c.name}><b style={{ fontWeight: 600 }}>{c.name}:</b> {c.result}{c.when ? <span style={{ color: C.slate }}>, {c.when}</span> : null}</div>)
          : <div style={{ color: C.slate }}>Not checked yet</div>}
        {d.notes.map((n) => <div key={n} style={{ marginTop: 8, color: C.slate }}>{n}</div>)}
      </span>
    </span>
  );
}
