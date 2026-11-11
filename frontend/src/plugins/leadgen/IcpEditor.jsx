import React, { useEffect, useRef, useState } from "react";
import { Plus, Sparkles, X } from "lucide-react";
import { Spinner } from "../../app/Loader";
import { C, FONT_BODY } from "../../tokens";
import { api } from "../../api/apiClient";
import { icpChanged } from "./FitParts";
import { icpSummary, isIcpSet, splitAreas } from "./fitLogic";

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };
const label = { ...text, fontSize: 12.5, fontWeight: 600, color: C.textInk, display: "grid", gap: 4 };
const chip = { ...text, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, background: C.paperSoft, border: `1px solid ${C.border}`, borderRadius: 999, padding: "2px 4px 2px 9px" };

const BLANK = { sic_codes: [], sic_labels: {}, postcode_areas: [], areas: [], size_bands: [], company_types: [], exclude_charities: true };

function fromIcp(icp) {
  return { ...BLANK, ...(icp || {}), areas: (icp?.areas || []).map((a) => ({ postcode: a.postcode, radius_miles: String(a.radius_miles), districts: a.districts || [] })) };
}

// Pick SIC codes by typing a trade word or the start of a code. Only codes the register uses are offered.
export function SicPicker({ value, labels, onChange, disabled }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(false);
  const run = useRef(0);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return undefined; }
    const mine = ++run.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await api.sicCodes(term);
        if (mine === run.current) setHits(r.codes || []);
      } catch { if (mine === run.current) setHits([]); }
      if (mine === run.current) setBusy(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const add = (h) => { if (!value.includes(h.code)) onChange([...value, h.code], { ...labels, [h.code]: h.text }); setQ(""); setHits([]); };
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {value.length ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {value.map((c) => (
            <span key={c} style={chip}>{labels[c] ? `${labels[c]} (${c})` : c}
              {disabled ? null : <button type="button" className="ui-icon-btn" aria-label={`Remove ${labels[c] || c}`} onClick={() => onChange(value.filter((x) => x !== c), labels)}><X size={12} /></button>}
            </span>
          ))}
        </div>
      ) : null}
      {disabled ? null : (
        <div style={{ position: "relative" }}>
          <input className="ui-input" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find an industry" placeholder="Type a trade, like cafes or plumbing, or a SIC code" />
          {q.trim().length >= 2 ? (
            <div className="ui-card ui-scroll" role="listbox" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 30, maxHeight: 260, overflowY: "auto", padding: 4, boxShadow: "0 12px 32px rgba(20,24,40,.12)" }}>
              {busy ? <div style={{ ...muted, padding: 8 }}><Spinner size={13} /> Looking…</div> : null}
              {!busy && !hits.length ? <div style={{ ...muted, padding: 8 }}>No industry on the register matches “{q.trim()}”.</div> : null}
              {hits.map((h) => (
                <button key={h.code} type="button" role="option" aria-selected={value.includes(h.code)} className="ui-btn ui-btn--ghost ui-btn--sm"
                  style={{ width: "100%", justifyContent: "flex-start", textAlign: "left", fontWeight: value.includes(h.code) ? 700 : 400 }} onClick={() => add(h)}>
                  <span style={{ fontVariantNumeric: "tabular-nums", color: C.slate, marginRight: 8 }}>{h.code}</span>{h.text}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// "Your ideal customer": who to look for, which drives the fit score and the list Find Leads opens on.
export function IcpEditor() {
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [areasText, setAreasText] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const apply = (r) => {
    setSaved(r);
    setForm(fromIcp(r.icp));
    setAreasText((r.icp?.postcode_areas || []).join(", "));
  };
  useEffect(() => { api.getIcp().then(apply).catch((e) => setError(e.message || "Couldn't load your ideal customer.")); }, []);
  if (!saved) return error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null;

  const locked = saved.can_edit === false;
  const choices = saved.choices || { company_types: [], size_bands: [], max_radius_miles: 15 };
  const typeLabels = Object.fromEntries(choices.company_types.map((t) => [t.id, t.label]));
  const toggle = (k, v) => setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));
  const setArea = (i, k, v) => setForm((f) => ({ ...f, areas: f.areas.map((a, j) => (j === i ? { ...a, [k]: v, districts: [] } : a)) }));
  const body = () => ({ ...form, postcode_areas: splitAreas(areasText), areas: form.areas.filter((a) => a.postcode.trim()).map((a) => ({ postcode: a.postcode.trim(), radius_miles: Number(a.radius_miles) || 0, districts: a.districts })) });

  const save = async () => {
    setBusy("save"); setError(""); setNote("");
    try {
      const r = await api.saveIcp(body());
      apply(r);
      icpChanged(r);
      setNote(r.is_set ? "Saved. Lists now show how well each company fits, and Find Leads opens on these companies." : "Saved.");
    } catch (e) {
      setError(e.message || "Couldn't save.");
    } finally {
      setBusy("");
    }
  };
  const draft = async () => {
    setBusy("draft"); setError(""); setNote("");
    try {
      const r = await api.draftIcp();
      const d = r.draft || {};
      setForm((f) => fromIcp({ ...f, ...d, areas: f.areas, exclude_charities: f.exclude_charities }));
      setAreasText((d.postcode_areas || []).join(", "));
      const found = [(d.sic_codes || []).length ? `${d.sic_codes.length} ${d.sic_codes.length === 1 ? "industry" : "industries"}` : "", (d.postcode_areas || []).length ? "areas" : "", (d.size_bands || []).length ? "sizes" : ""].filter(Boolean);
      setNote(found.length
        ? `Filled in from your website: ${found.join(", ")}. Check each one, change anything that's wrong, then save.${(r.evidence || []).length ? ` Your site says: “${r.evidence[0]}”.` : ""}`
        : "Your website didn't say enough about who you sell to. Fill the boxes in yourself.");
    } catch (e) {
      setError(e.message || "Couldn't read your website.");
    } finally {
      setBusy("");
    }
  };

  const current = body();
  return (
    <div className="ui-card" style={{ padding: 12, display: "grid", gap: 12, marginTop: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ ...text, fontSize: 13.5, color: C.ink, marginRight: "auto" }}>Your ideal customer</strong>
        {locked ? null : (
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={Boolean(busy)} onClick={draft}
            title="Reads your own website and fills in who you seem to sell to. Nothing is saved until you press Save">
            {busy === "draft" ? <Spinner size={13} /> : <Sparkles size={14} />} Set it from my website
          </button>
        )}
      </div>
      <div style={muted}>
        Who you want to sell to. Each company then gets a fit score from 0 to 100, worked out only from facts we hold, with the reasons beside it.
        {isIcpSet(saved.icp) ? <> Now: {icpSummary(saved.icp, typeLabels)}.</> : " Nothing is set yet, so no scores show."}
      </div>
      {locked ? <div role="status" style={{ ...muted, fontSize: 12.5, color: C.amber }}>Only an admin can change this. Ask an admin to update it.</div> : null}

      <div style={label}>Industries<SicPicker value={form.sic_codes} labels={form.sic_labels} disabled={locked} onChange={(codes, labels) => setForm((f) => ({ ...f, sic_codes: codes, sic_labels: labels }))} /></div>

      <label style={label} title="The first part of a postcode: LS for all of Leeds, or LS6 for one district">Postcode areas
        <input className="ui-input" value={areasText} disabled={locked} onChange={(e) => setAreasText(e.target.value)} placeholder="For example LS, BD1, M" />
      </label>
      <div style={{ display: "grid", gap: 6 }}>
        <span style={label}>Or a distance around a postcode</span>
        {form.areas.map((a, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input className="ui-input" value={a.postcode} disabled={locked} aria-label="Postcode" onChange={(e) => setArea(i, "postcode", e.target.value)} placeholder="LS1 4AP" style={{ width: 130 }} />
            <span style={muted}>within</span>
            <input className="ui-input" type="number" min={1} max={choices.max_radius_miles} value={a.radius_miles} disabled={locked} aria-label="Miles" onChange={(e) => setArea(i, "radius_miles", e.target.value)} style={{ width: 80 }} />
            <span style={muted}>miles</span>
            {locked ? null : <button type="button" className="ui-icon-btn" aria-label="Remove this area" onClick={() => setForm((f) => ({ ...f, areas: f.areas.filter((_, j) => j !== i) }))}><X size={14} /></button>}
            {a.districts?.length ? <span style={{ ...muted, fontSize: 12, flexBasis: "100%" }}>Covers {a.districts.join(", ")}</span> : null}
          </div>
        ))}
        {locked || form.areas.length >= 5 ? null : (
          <div><button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setForm((f) => ({ ...f, areas: [...f.areas, { postcode: "", radius_miles: "10", districts: [] }] }))}><Plus size={13} /> Add a distance</button></div>
        )}
      </div>

      <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
        <legend style={{ ...label, marginBottom: 4 }}>Size, from their filed accounts</legend>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {choices.size_bands.map((s) => (
            <label key={s.id} style={{ ...muted, display: "inline-flex", gap: 6, alignItems: "center", color: C.textInk }}>
              <input type="checkbox" disabled={locked} checked={form.size_bands.includes(s.id)} onChange={() => toggle("size_bands", s.id)} /> {s.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
        <legend style={{ ...label, marginBottom: 4 }}>Company types</legend>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {choices.company_types.map((t) => (
            <label key={t.id} style={{ ...muted, display: "inline-flex", gap: 6, alignItems: "center", color: C.textInk }}>
              <input type="checkbox" disabled={locked} checked={form.company_types.includes(t.id)} onChange={() => toggle("company_types", t.id)} /> {t.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label style={{ ...muted, display: "inline-flex", gap: 6, alignItems: "center", color: C.textInk }}>
        <input type="checkbox" disabled={locked} checked={form.exclude_charities} onChange={(e) => setForm((f) => ({ ...f, exclude_charities: e.target.checked }))} /> Leave out charities
      </label>

      {note ? <div role="status" style={{ ...muted, fontSize: 12.5, color: C.textInk }}>{note}</div> : null}
      {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
      {locked ? null : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={Boolean(busy)} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={Boolean(busy)} onClick={() => { apply(saved); setNote(""); setError(""); }}>Reset</button>
          {!isIcpSet(current) ? <span style={{ ...muted, fontSize: 12 }}>Pick at least an industry, an area, a size or a company type for scores to show.</span> : null}
        </div>
      )}
    </div>
  );
}
