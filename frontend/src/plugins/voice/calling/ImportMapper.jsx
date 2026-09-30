import React, { useMemo, useState } from "react";
import { AlertTriangle, FileSpreadsheet, X } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY } from "../../../tokens";
import { applyMapping, guessMapping, KEEP, mappingWarnings, rememberMapping, savedMappingFor, SKIP, STANDARD_FIELDS } from "./importMapping";

const sel = { height: 34, borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", padding: "0 8px", fontSize: 12.5, fontFamily: FONT_BODY, width: "100%" };

// Popup shown after a file is chosen: match each file column to our standard columns,
// keep it as an extra column, or leave it out. Then the rows open in the list.
export function ImportMapper({ fileName, sheets, sheetNames, onCancel, onImport }) {
  const [sheet, setSheet] = useState((sheetNames && sheetNames[0]) || "");
  const data = (sheets && sheets[sheet]) || { headers: [], records: [] };
  const [mappings, setMappings] = useState({});
  const [remember, setRemember] = useState(true);

  const mapping = useMemo(() => {
    if (mappings[sheet]) return mappings[sheet];
    return savedMappingFor(data.headers) || guessMapping(data.headers);
  }, [mappings, sheet, data.headers]);
  const fromMemory = !mappings[sheet] && Boolean(savedMappingFor(data.headers));

  const setField = (col, value) => setMappings((m) => ({ ...m, [sheet]: { ...mapping, [col]: value } }));
  const warnings = mappingWarnings(mapping, data.records);
  const preview = data.records.slice(0, 3);
  const kept = Object.values(mapping).filter((v) => v === KEEP).length;
  const skipped = Object.values(mapping).filter((v) => v === SKIP).length;

  const doImport = () => {
    if (remember) rememberMapping(data.headers, mapping);
    const out = applyMapping(data.headers, data.records, mapping);
    onImport({ ...out, sheet });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.55)", zIndex: 140, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 900, maxHeight: "90vh", display: "flex", flexDirection: "column", fontFamily: FONT_BODY, boxShadow: "0 24px 70px rgba(0,0,0,0.22)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 22px 10px" }}>
          <FileSpreadsheet size={20} color={C.cobalt} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18 }}>Match your columns</div>
            <div style={{ fontSize: 12.5, color: C.slate }}>
              {fileName} · {data.records.length} rows. We guessed the matches; change any that are wrong.
              {fromMemory ? " (Using the matches you saved for files like this.)" : ""}
            </div>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: C.slate }}><X size={18} /></button>
        </div>

        {sheetNames && sheetNames.length > 1 && (
          <div style={{ padding: "0 22px 8px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12.5, color: C.slate }}>Sheet</span>
            <select value={sheet} onChange={(e) => setSheet(e.target.value)} style={{ ...sel, width: 240 }}>
              {sheetNames.map((s) => <option key={s} value={s}>{s} ({(sheets[s]?.records || []).length} rows)</option>)}
            </select>
          </div>
        )}

        <div style={{ overflowY: "auto", padding: "4px 22px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: C.slate }}>
                <th style={{ padding: "6px 6px", width: "26%" }}>Column in your file</th>
                <th style={{ padding: "6px 6px", width: "28%" }}>Import as</th>
                <th style={{ padding: "6px 6px" }}>First rows</th>
              </tr>
            </thead>
            <tbody>
              {data.headers.map((h) => (
                <tr key={h} style={{ borderTop: `1px solid ${C.borderLight}` }}>
                  <td style={{ padding: "7px 6px", fontWeight: 600, color: C.textInk }}>{h}</td>
                  <td style={{ padding: "7px 6px" }}>
                    <select value={mapping[h] || KEEP} onChange={(e) => setField(h, e.target.value)} style={sel} aria-label={`Import ${h} as`}>
                      <optgroup label="Standard columns">
                        {STANDARD_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </optgroup>
                      <option value={KEEP}>Others: keep as its own column</option>
                      <option value={SKIP}>Don't import</option>
                    </select>
                  </td>
                  <td style={{ padding: "7px 6px", color: C.slate, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {preview.map((r) => String(r[h] ?? "")).filter(Boolean).join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px 22px 16px" }}>
          {warnings.map((w) => (
            <div key={w} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.amber, marginBottom: 4 }}>
              <AlertTriangle size={13} /> {w}
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: C.slate }}>{kept} extra column{kept === 1 ? "" : "s"} kept · {skipped} left out</span>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember these matches for files with the same columns
            </label>
            <div style={{ flex: 1 }} />
            <button type="button" onClick={onCancel} style={{ height: 38, padding: "0 16px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff", fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            <button type="button" onClick={doImport} style={{ height: 38, padding: "0 18px", borderRadius: 10, border: "none", background: C.ink, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
              Import {data.records.length} rows
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
