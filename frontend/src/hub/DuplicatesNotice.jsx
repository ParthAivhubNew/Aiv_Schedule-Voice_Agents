import React, { useCallback, useEffect, useRef, useState } from "react";
import { Copy, X } from "lucide-react";
import { C, FONT_BODY } from "../tokens";
import { DUPLICATES_EVENT, mergeDuplicates } from "../utils/duplicateNotice";

// When companies are not added because they are already saved (a saved search, an import, a copy into a list), this tells the person
// how many, and the "Show them" button opens every one next to the company it matched. Mounted once for the whole app.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function Facts({ c }) {
  const rows = [["Website", c.website], ["Phone", c.phone], ["Email", c.email], ["Contact", c.contact], ["Place", c.place]].filter(([, v]) => v);
  return (
    <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
      <div style={{ ...text, fontSize: 14, fontWeight: 600, color: C.ink, overflowWrap: "anywhere" }}>{c.name || "(no name)"}</div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ ...muted, fontSize: 12.5, overflowWrap: "anywhere" }}><span style={{ color: C.slateLight }}>{k}: </span>{v}</div>
      ))}
      {!rows.length ? <div style={{ ...muted, fontSize: 12.5, color: C.slateLight }}>No other details</div> : null}
    </div>
  );
}

function Pair({ d }) {
  return (
    <li style={{ listStyle: "none", border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, display: "grid", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <div style={{ borderLeft: `3px solid ${C.green}`, paddingLeft: 10, minWidth: 0 }}>
          <div style={{ ...muted, fontSize: 11.5, fontWeight: 700, color: C.green, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 2 }}>Already saved (kept)</div>
          {d.original ? <Facts c={d.original} /> : <div style={muted}>That company has since been removed.</div>}
        </div>
        <div style={{ borderLeft: `3px solid ${C.amber}`, paddingLeft: 10, minWidth: 0 }}>
          <div style={{ ...muted, fontSize: 11.5, fontWeight: 700, color: C.amber, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 2 }}>Not added (duplicate)</div>
          <Facts c={d.duplicate} />
        </div>
      </div>
      {d.why ? <div style={{ ...muted, fontSize: 12 }}>Matched because: {d.why.toLowerCase()}</div> : null}
    </li>
  );
}

function Item({ c }) {
  return (
    <li style={{ listStyle: "none", border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, borderLeft: `3px solid ${C.green}` }}>
      <Facts c={c} />
    </li>
  );
}

function DuplicatesDialog({ notice, onClose }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose); // a new onClose each render must not re-run the effect and re-take focus
  closeRef.current = onClose;
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const list = notice.kind === "list";
  const shown = list ? (notice.items || []) : (notice.pairs || []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", padding: 12 }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Duplicates that were not added" ref={ref} tabIndex={-1} onClick={(e) => e.stopPropagation()}
        style={{ outline: "none", background: "#fff", borderRadius: 14, width: "min(860px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "16px 18px 10px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ ...text, fontSize: 17, fontWeight: 700, color: C.ink, margin: 0 }}>
              {list ? `${plural(notice.total, "company was", "companies were")} already in this list` : `${plural(notice.total, "duplicate was", "duplicates were")} not added`}
            </h2>
            <p style={{ ...muted, margin: "4px 0 0" }}>
              {list ? "Each company can be in a list once, so these stayed as they were." : "Each is already saved, so it was not saved again. The saved company is kept, and a file import may have filled in details it was missing."}
            </p>
          </div>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <ul style={{ margin: 0, padding: "4px 18px 14px", display: "grid", gap: 10, overflowY: "auto", flex: "1 1 auto" }}>
          {list ? shown.map((c) => <Item key={c.id} c={c} />) : shown.map((d, i) => <Pair key={`${d.original_id}-${i}`} d={d} />)}
          {notice.total > shown.length ? <li style={{ ...muted, listStyle: "none", textAlign: "center", padding: 6 }}>Showing the first {shown.length.toLocaleString()} of {notice.total.toLocaleString()}.</li> : null}
        </ul>
        <div style={{ padding: "10px 18px 16px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="ui-btn ui-btn--primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function DuplicatesNotice() {
  const [notice, setNotice] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = (e) => setNotice((cur) => mergeDuplicates(cur, e.detail));
    window.addEventListener(DUPLICATES_EVENT, on);
    return () => window.removeEventListener(DUPLICATES_EVENT, on);
  }, []);
  const dismiss = useCallback(() => { setOpen(false); setNotice(null); }, []);
  if (!notice) return null;
  const list = notice.kind === "list";
  return (
    <>
      {!open ? <div role="status" style={{ position: "fixed", left: 16, bottom: 16, zIndex: 1900, maxWidth: "min(460px, calc(100vw - 32px))", background: "#fff", border: `1px solid ${C.border}`, borderLeft: `4px solid ${C.amber}`, borderRadius: 10, boxShadow: C.shadowCardHover, padding: "10px 12px", display: "flex", gap: 10, alignItems: "center" }}>
        <Copy size={16} color={C.amber} aria-hidden="true" style={{ flex: "none" }} />
        <div style={{ ...text, fontSize: 13.5, color: C.textInk, flex: 1, minWidth: 0 }}>
          {list ? `${plural(notice.total, "company was", "companies were")} already in that list.` : `${plural(notice.total, "duplicate", "duplicates")} not added: already saved.`}
        </div>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setOpen(true)}>Show them</button>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={dismiss} aria-label="Dismiss"><X size={14} /></button>
      </div> : null}
      {open ? <DuplicatesDialog notice={notice} onClose={dismiss} /> : null}
    </>
  );
}
