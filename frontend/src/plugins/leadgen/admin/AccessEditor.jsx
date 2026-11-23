import React, { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { C, FONT_BODY } from "../../../tokens";
import { api } from "../../../api/apiClient";
import { field, muted, text } from "./adminUi";

// One person's data access: which postcodes, export, live Google details. Used by the Data access card and by the user profile.
export const NO_LIMIT_LINE = "All postcodes. No personal limit.";
export const AREAS_HELP = "Add postcode districts (like LS1 or M1) or a whole area (like LS) only if you want to limit this person to them. Any postcode in the UK works.";
export const NEED_AREAS_LINE = "Add at least one postcode district, or choose All postcodes.";
export const AREA_ERROR = "Use a postcode district such as BN1 or LS27, or a whole area such as LS.";
export const ADMIN_SEES_ALL_LINE = "Admins see everything";
export const ADMIN_SEES_ALL_HELP = "An admin has no postcode limit, and export and live Google details are always on. This cannot be changed here.";

// A district (LS1, EC2A) or a whole postcode area (LS), as the server reads them.
export const cleanArea = (v) => { const d = String(v || "").toUpperCase().replace(/\s+/g, ""); return /^[A-Z]{1,2}(\d[A-Z\d]?)?$/.test(d) ? d : ""; };

// "1,240 companies in 3 areas", or "in all postcodes" when the person has no limit.
export function previewLine(p) {
  if (!p) return "";
  const n = Number(p.companies || 0).toLocaleString("en-GB");
  const k = (p.districts || []).length;
  return `${n} ${Number(p.companies) === 1 ? "company" : "companies"} ${k ? `in ${k} ${k === 1 ? "area" : "areas"}` : "in all postcodes"}`;
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const hidden = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" };

// The draft a screen holds until Save. `access` is the saved copy: { districts, allow_export, allow_google }, or null while it loads.
export function useAccessDraft(access, userId, { onTouch, initialPreview = null } = {}) {
  const [districts, setDistricts] = useState((access && access.districts) || []);
  const [only, setOnly] = useState(((access && access.districts) || []).length > 0); // "Only these postcodes" or "All postcodes"
  const [allowExport, setAllowExport] = useState(!access || access.allow_export !== false);
  const [allowGoogle, setAllowGoogle] = useState(!access || access.allow_google !== false);
  const [preview, setPreview] = useState(initialPreview);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");

  // A new saved copy (loaded, or just saved) becomes the draft.
  useEffect(() => {
    if (!access) return;
    setDistricts(access.districts || []);
    setOnly((access.districts || []).length > 0);
    setAllowExport(access.allow_export !== false);
    setAllowGoogle(access.allow_google !== false);
  }, [access]);

  const saved = access || {};
  const dirty = !!access && (!sameSet(districts, saved.districts || []) || allowExport !== (saved.allow_export !== false) || allowGoogle !== (saved.allow_google !== false));
  const needsAreas = only && districts.length === 0; // "only these" with none chosen would mean all, so it cannot be saved
  const touched = () => { setPreview(null); setPreviewError(""); if (onTouch) onTouch(); };
  const set = (patch) => {
    if ("districts" in patch) setDistricts(patch.districts);
    if ("only" in patch) setOnly(patch.only);
    if ("allowExport" in patch) setAllowExport(patch.allowExport);
    if ("allowGoogle" in patch) setAllowGoogle(patch.allowGoogle);
    touched();
  };
  const look = async () => {
    setPreviewBusy(true); setPreviewError("");
    try { setPreview(await api.previewDataAccess(userId)); } catch (e) { setPreviewError(e.message || "Couldn't work that out. Try again."); } finally { setPreviewBusy(false); }
  };
  const body = () => ({ districts, allow_export: allowExport, allow_google: allowGoogle });
  return { districts, only, allowExport, allowGoogle, preview, previewBusy, previewError, dirty, needsAreas, set, look, body };
}

function Switch({ id, label, hint, checked, onChange, disabled }) {
  return (
    <label htmlFor={id} style={{ display: "flex", gap: 10, alignItems: "flex-start", minHeight: 44, cursor: disabled ? "not-allowed" : "pointer" }}>
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ width: 22, height: 22, marginTop: 10, flexShrink: 0 }} />
      <span style={{ display: "grid", gap: 2, paddingTop: 9 }}>
        <span style={{ ...text, fontSize: 14, fontWeight: 600, color: C.textInk }}>{label} <span style={{ fontWeight: 500, color: C.slate }}>({checked ? "On" : "Off"})</span></span>
        <span style={{ ...muted, fontSize: 12.5 }}>{hint}</span>
      </span>
    </label>
  );
}

// Areas, the two switches and "What will they see?". The parent owns the draft (useAccessDraft) and the Save button.
export function AccessEditor({ draft, allowed = [], idBase, disabled = false }) {
  const [entry, setEntry] = useState("");
  const [entryError, setEntryError] = useState("");
  const { districts, only, set } = draft;
  const toggle = (d) => set({ districts: districts.includes(d) ? districts.filter((x) => x !== d) : [...districts, d] });
  const suggestions = allowed.filter((d) => !districts.includes(d));
  const addArea = () => {
    const parts = entry.split(/[\s,;]+/).filter(Boolean);
    if (!parts.length) return;
    const clean = parts.map(cleanArea);
    if (clean.some((c) => !c)) { setEntryError(AREA_ERROR); return; }
    setEntryError("");
    set({ districts: [...new Set([...districts, ...clean])].sort() });
    setEntry("");
  };

  return (
    <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
      <fieldset style={{ border: "none", margin: 0, padding: 0, display: "grid", gap: 8, minWidth: 0 }} disabled={disabled}>
        <legend style={{ ...text, fontSize: 13, fontWeight: 600, color: C.textInk, padding: 0, marginBottom: 6 }}>Areas</legend>
        <div role="radiogroup" aria-label="Which postcodes this person can see" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[[false, "All postcodes"], [true, "Only these postcodes"]].map(([val, label]) => (
            <button key={label} type="button" role="radio" aria-checked={only === val}
              onClick={() => { setEntryError(""); set(val ? { only: true } : { only: false, districts: [] }); }}
              style={{ minHeight: 44, padding: "0 14px", borderRadius: 999, border: `1px solid ${only === val ? C.cobalt : C.border}`, background: only === val ? C.cobaltSoft : "#fff", color: only === val ? C.cobaltDeep : C.textInk, fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: only === val ? 700 : 500, cursor: "pointer" }}>
              {only === val ? "✓ " : ""}{label}
            </button>
          ))}
        </div>
        {only ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label htmlFor={`${idBase}-area`} style={hidden}>Add a postcode district or area</label>
          <input id={`${idBase}-area`} value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="Add a district, e.g. LS1, M1 or EC2A" autoComplete="off" spellCheck={false}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addArea(); } }} style={{ ...field, flex: "1 1 220px" }} />
          <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} onClick={addArea} disabled={!entry.trim()}>Add</button>
          {districts.length ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ minHeight: 44 }} onClick={() => set({ districts: [] })}>Clear all</button> : null}
        </div> : null}
        {entryError ? <div role="alert" style={{ ...text, fontSize: 13.5, color: C.red }}>{entryError}</div> : null}
        {only && districts.length ? (
          <ul aria-label="Areas chosen" style={{ display: "flex", gap: 6, flexWrap: "wrap", listStyle: "none", margin: 0, padding: 0 }}>
            {districts.map((d) => (
              <li key={d}>
                <button type="button" onClick={() => toggle(d)} aria-label={`Remove ${d}`} title={`Remove ${d}`}
                  style={{ minHeight: 44, padding: "0 12px", borderRadius: 999, border: `1px solid ${C.cobalt}`, background: C.cobaltSoft, color: C.cobaltDeep, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  {d} ✕
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {only && suggestions.length ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} aria-label="Suggested areas">
            {suggestions.map((d) => (
              <button key={d} type="button" onClick={() => toggle(d)} style={{ minHeight: 44, minWidth: 44, padding: "0 12px", borderRadius: 999, border: `1px solid ${C.border}`, background: "#fff", color: C.textInk, fontFamily: FONT_BODY, fontSize: 13, cursor: "pointer" }}>{d}</button>
            ))}
          </div>
        ) : null}
        {!only ? <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.textInk }}>{NO_LIMIT_LINE}</div> : districts.length ? <div style={muted}>{districts.length} {districts.length === 1 ? "area" : "areas"} chosen: {districts.join(", ")}</div> : <div role="alert" style={{ ...text, fontSize: 13.5, color: C.red }}>{NEED_AREAS_LINE}</div>}
        {only ? <div style={{ ...muted, fontSize: 12.5 }}>{AREAS_HELP}</div> : null}
      </fieldset>

      <div style={{ display: "grid", gap: 2 }}>
        <Switch id={`${idBase}-export`} label="Can export data" hint="On until you switch it off" checked={draft.allowExport} disabled={disabled} onChange={(v) => set({ allowExport: v })} />
        <Switch id={`${idBase}-google`} label="Can open live Google details" hint="On until you switch it off" checked={draft.allowGoogle} disabled={disabled} onChange={(v) => set({ allowGoogle: v })} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} disabled={disabled || draft.previewBusy} onClick={draft.look}><Eye size={15} aria-hidden="true" /> {draft.previewBusy ? "Working it out…" : "What will they see?"}</button>
      </div>
      <div role="status" aria-live="polite" style={{ display: "grid", gap: 4 }}>
        {draft.preview ? <div style={{ ...text, fontSize: 13.5, color: C.textInk }}>{previewLine(draft.preview)}{draft.dirty ? <span style={muted}> (as last saved)</span> : null}</div> : null}
      </div>
      {draft.previewError ? <div role="alert" style={{ ...text, fontSize: 13.5, color: C.red }}>{draft.previewError}</div> : null}
    </div>
  );
}
