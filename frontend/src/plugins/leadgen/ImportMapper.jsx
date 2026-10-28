import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, X } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { CUSTOM, guessMapping, isCustom, mappingWarnings, rememberMapping, savedMappingFor, SKIP, STANDARD_FIELDS } from "./importMapping";

const OWN = "__own__"; // the dropdown entry for "keep this column as my own"

const sel = { height: 34, borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", padding: "0 8px", fontSize: 12.5, fontFamily: FONT_BODY, width: "100%" };

// Same popup as the Voice plugin's file import (ImportMapper.jsx under plugins/voice/calling):
// match each file column to one of our fields, or leave it out. Shown right after a file is
// picked, before anything is saved.
export function ImportMapper({ fileName, sheets, sheetNames, initialSheet, onCancel, onImport }) {
  const [sheet, setSheet] = useState(initialSheet || (sheetNames && sheetNames[0]) || "");
  const records = useMemo(() => (sheets && sheets[sheet]) || [], [sheets, sheet]);
  const headers = useMemo(() => (records.length ? Object.keys(records[0]) : []), [records]);
  const [mappings, setMappings] = useState({});
  const [remember, setRemember] = useState(true);
  const [hideMatched, setHideMatched] = useState(false);

  const mapping = useMemo(() => {
    if (mappings[sheet]) return mappings[sheet];
    return savedMappingFor(headers) || guessMapping(headers, records);
  }, [mappings, sheet, headers, records]);
  const fromMemory = !mappings[sheet] && Boolean(savedMappingFor(headers));

  const setField = (col, value) => setMappings((m) => ({ ...m, [sheet]: { ...mapping, [col]: value } }));
  const warnings = mappingWarnings(mapping, records);
  const preview = records.slice(0, 3);
  // "4 columns, 3 matched, 1 kept as your own": what the person needs to look at is the rest.
  const standard = headers.filter((h) => mapping[h] && mapping[h] !== SKIP && !isCustom(mapping[h]));
  const own = headers.filter((h) => isCustom(mapping[h]));
  const left = headers.filter((h) => !mapping[h] || mapping[h] === SKIP);
  const shown = hideMatched ? headers.filter((h) => !standard.includes(h)) : headers;

  const confirm = () => {
    if (remember) rememberMapping(headers, mapping);
    onImport({ sheet, map: mapping });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.55)", zIndex: 140, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 900, maxHeight: "90vh", display: "flex", flexDirection: "column", fontFamily: FONT_BODY, boxShadow: "0 24px 70px rgba(0,0,0,0.22)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 22px 10px" }}>
          <FileSpreadsheet size={20} color={C.ink} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 18, color: C.ink }}>Match your columns</div>
            <div style={{ fontSize: 12.5, color: C.slate }}>
              {fileName} · {records.length} rows. We guessed the matches; change any that are wrong.
              {fromMemory ? " (Using the matches you saved for files like this.)" : ""}
            </div>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: C.slate }}><X size={18} /></button>
        </div>

        {sheetNames && sheetNames.length > 1 && (
          <div style={{ padding: "0 22px 8px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12.5, color: C.slate }}>Sheet</span>
            <select title="Pick which sheet of the workbook to import" value={sheet} onChange={(e) => setSheet(e.target.value)} style={{ ...sel, width: 240, maxWidth: "100%" }}>
              {sheetNames.map((s) => <option key={s} value={s}>{s} ({(sheets[s] || []).length} rows)</option>)}
            </select>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "0 22px 8px", fontSize: 13, color: C.ink }}>
          <strong>{headers.length} {headers.length === 1 ? "column" : "columns"} found</strong>
          <span style={{ background: "#E7F6EC", color: "#136F3A", borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>{standard.length} matched</span>
          {own.length ? <span style={{ background: "#EEF2FE", color: "#26409E", borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>{own.length} kept as your own</span> : null}
          {left.length ? <span style={{ background: "#FEF3E2", color: "#9A5B00", borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>{left.length} left out</span> : null}
          <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.slate, cursor: "pointer" }}>
            <input type="checkbox" checked={hideMatched} onChange={(e) => setHideMatched(e.target.checked)} /> Hide matched columns
          </label>
        </div>

        <div style={{ overflowY: "auto", padding: "4px 22px 12px" }}>
          <table className="map-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: C.slate }}>
                <th style={{ padding: "6px 6px", width: "26%" }}>Column in your file</th>
                <th style={{ padding: "6px 6px", width: "28%" }} title="Which field in your account each column goes into">Import as</th>
                <th style={{ padding: "6px 6px" }}>First rows</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((h) => (
                <tr key={h} style={{ borderTop: `1px solid ${C.borderLight || C.border}` }}>
                  <td style={{ padding: "7px 6px", fontWeight: 600, color: C.ink }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {standard.includes(h) ? <CheckCircle2 size={15} color="#16A34A" aria-label="Matched" /> : null}{h}
                    </span>
                  </td>
                  <td style={{ padding: "7px 6px" }}>
                    <select value={isCustom(mapping[h]) ? OWN : (mapping[h] || SKIP)} aria-label={`Import ${h} as`} style={sel}
                      onChange={(e) => setField(h, e.target.value === OWN ? CUSTOM + String(h).trim().slice(0, 40) : e.target.value)}>
                      <optgroup label="Account fields">
                        {STANDARD_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </optgroup>
                      <option value={OWN}>Keep as my own column…</option>
                      <option value={SKIP}>Don't import</option>
                    </select>
                    {isCustom(mapping[h]) ? (
                      <input value={mapping[h].slice(CUSTOM.length)} maxLength={40} aria-label={`Name for your column ${h}`} placeholder="Name this column"
                        onChange={(e) => setField(h, CUSTOM + e.target.value)} style={{ ...sel, marginTop: 6 }} />
                    ) : null}
                  </td>
                  <td style={{ padding: "7px 6px", color: C.slate, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.5 }}>
                    {preview.map((r, i) => <div key={i} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{String(r[h] ?? "") || "—"}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px 22px 16px" }}>
          {warnings.map((w) => (
            <div key={w} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#B45309", marginBottom: 4 }}>
              <AlertTriangle size={13} /> {w}
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer", color: C.slate }}>
              <input title="Next time a file has these same columns, they are matched this way automatically" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember these matches for files with the same columns
            </label>
            <div style={{ flex: 1 }} />
            <button type="button" className="ui-btn ui-btn--ghost" title="Go back to the starting matches for every column on this sheet" onClick={() => setMappings((m) => { const next = { ...m }; delete next[sheet]; return next; })}>Reset matches</button>
            <button title="Close without saving" type="button" className="ui-btn ui-btn--ghost" onClick={onCancel}>Cancel</button>
            <button type="button" className="ui-btn ui-btn--primary" title="Import the file with these matches" onClick={confirm}>Use these matches</button>
          </div>
        </div>
      </div>
    </div>
  );
}
