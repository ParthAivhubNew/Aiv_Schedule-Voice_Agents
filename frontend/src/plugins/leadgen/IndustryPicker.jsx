import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";
import { SicPicker } from "./IcpEditor";
import { matchTerms, termKey } from "./industryMatch";

// Pick an industry by typing: the real industries of the register are matched as you type (see industryMatch.js), each with how many
// companies carry it. A SIC industry fills the SIC codes filter; a register type (Charity, Restaurant/Cafe/Canteen, Dentist...) fills the
// industry type filter. Until the list has been built on the server, the older SIC search is used instead.

let loaded = null;
const load = () => (loaded ||= api.industries().catch(() => { loaded = null; return { ready: false, terms: [], families: [] }; }));

const text = { fontFamily: FONT_BODY };
const chip = { ...text, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, background: C.paperSoft, border: `1px solid ${C.border}`, borderRadius: 999, padding: "2px 4px 2px 9px" };

export default function IndustryPicker({ codes, labels, types, onChange }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => { let on = true; load().then((d) => on && setData(d)); return () => { on = false; }; }, []);

  const terms = data?.terms || [];
  const known = useMemo(() => Object.fromEntries(terms.filter((t) => t.k === "sic").map((t) => [t.code, t.label])), [terms]);
  const taken = useMemo(() => new Set([...codes.map((c) => `sic:${c}`), ...types.map((t) => `type:${t}`)]), [codes, types]);
  const hits = useMemo(() => (data?.ready ? matchTerms(q, terms, data.families, taken) : []), [q, terms, data, taken]);
  const give = (next) => onChange({ codes, labels, types, ...next });

  const pick = (t) => {
    if (t.k === "sic") give({ codes: [...codes, t.code], labels: { ...labels, [t.code]: t.label } });
    else if (t.k === "group") {  // a whole trade: its SIC codes and its register types, each added as its own chip so any can be removed
      const add = t.codes.filter((c) => !codes.includes(c));
      give({ codes: [...codes, ...add], labels: { ...labels, ...Object.fromEntries(add.map((c) => [c, known[c]])) }, types: [...types, ...t.types.filter((x) => !types.includes(x))] });
    } else give({ types: [...types, t.label] });
    setQ(""); setActive(0);
  };
  const onKey = (e) => {
    if (!hits.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); pick(hits[Math.min(active, hits.length - 1)]); }
    else if (e.key === "Escape") { e.stopPropagation(); setQ(""); }
  };

  const chips = (
    <>
      {codes.map((c) => {
        const name = labels[c] || known[c];
        return (
          <span key={`s${c}`} style={chip} title="A SIC industry">{name ? `${name} (${c})` : c}
            <button type="button" className="ui-icon-btn" aria-label={`Remove ${name || c}`} onClick={() => give({ codes: codes.filter((x) => x !== c) })}><X size={12} /></button>
          </span>
        );
      })}
      {types.map((t) => (
        <span key={`t${t}`} style={chip} title="An industry type from a register">{t}
          <button type="button" className="ui-icon-btn" aria-label={`Remove ${t}`} onClick={() => give({ types: types.filter((x) => x !== t) })}><X size={12} /></button>
        </span>
      ))}
    </>
  );

  // The list is not built yet (or could not be read): the older SIC search, and any type already chosen stays visible.
  if (data && !data.ready) {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        {types.length ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{chips}</div> : null}
        <SicPicker value={codes} labels={labels} onChange={(c, l) => give({ codes: c, labels: l })} />
      </div>
    );
  }
  const shown = q.trim().length >= 2;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {codes.length || types.length ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{chips}</div> : null}
      <div style={{ position: "relative" }}>
        <input className="ui-input" value={q} aria-label="Find an industry" aria-autocomplete="list" aria-expanded={open && shown} autoComplete="off" spellCheck={false}
          placeholder="Type an industry, like cafes, accountants or dentist" disabled={!data}
          onChange={(e) => { setQ(e.target.value); setActive(0); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKey} />
        {open && shown && data ? (
          <div className="ui-card ui-scroll" role="listbox" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 30, maxHeight: 280, overflowY: "auto", padding: 4, boxShadow: "0 12px 32px rgba(20,24,40,.12)" }}>
            {!hits.length ? <div style={{ ...text, fontSize: 13, color: C.slate, padding: 8 }}>No industry on the register matches “{q.trim()}”. Words in the Include box still search company names and activities.</div> : null}
            {hits.map((t, i) => (
              <button key={termKey(t)} type="button" role="option" aria-selected={i === active} className="ui-btn ui-btn--ghost ui-btn--sm"
                onMouseDown={(e) => { e.preventDefault(); pick(t); }} onMouseEnter={() => setActive(i)}
                style={{ width: "100%", justifyContent: "flex-start", textAlign: "left", gap: 8, background: i === active ? "var(--ui-hover, #eef0f4)" : undefined }}>
                {t.k === "sic" ? <span style={{ fontVariantNumeric: "tabular-nums", color: C.slate }}>{t.code}</span> : null}
                <span style={{ flex: 1 }}>{t.label || t.code}</span>
                {t.k === "group" ? <span style={{ fontSize: 11, color: C.slate }}>{t.codes.length ? `${t.codes.length} SIC ${t.codes.length === 1 ? "code" : "codes"} + ` : ""}{t.types.join(", ")}</span> : null}
                {t.k === "type" ? <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em", color: C.slate }}>Register type</span> : null}
                <span style={{ fontSize: 12, color: C.slate, fontVariantNumeric: "tabular-nums" }}>about {t.n.toLocaleString()}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
