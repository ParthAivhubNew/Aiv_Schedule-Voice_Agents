import React from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { AlertTriangle, History, Table2, Trash2, X } from "lucide-react";

const COLUMN_GUESSES = {
  name: ["company name", "company", "business name", "business", "organisation", "organization", "account name", "account", "customer name", "customer", "client name", "client", "trading name", "firm", "name"],
  phone: ["phone number", "telephone number", "mobile number", "contact number", "direct dial", "phone", "telephone", "mobile", "landline", "cell", "tel no", "tel"],
  website: ["company website", "website", "web address", "homepage", "url", "domain", "site", "web", "link"],
  contact: ["contact name", "contact person", "decision maker", "contact", "person", "attention", "poc", "owner", "director", "manager", "attn"],
  first_name: ["first name", "forename", "given name", "firstname", "first"],
  last_name: ["last name", "surname", "family name", "lastname", "last"],
  notes: ["notes", "note", "comment", "comments", "description", "remarks", "details"],
  channel: ["preferred channel", "contact channel", "contact method", "outreach channel", "channel"],
  email: ["email address", "e-mail", "email", "e mail", "mail"],
};

export const IMPORT_ROLES = [
  { id: "name", label: "Company name", required: true },
  { id: "phone", label: "Phone number", required: true },
  { id: "contact", label: "Contact person" },
  { id: "first_name", label: "First name" },
  { id: "last_name", label: "Last name" },
  { id: "email", label: "Email" },
  { id: "website", label: "Website / link" },
  { id: "channel", label: "Preferred channel" },
  { id: "notes", label: "Notes" },
  { id: "extra", label: "Keep as extra (AI can use this)" },
  { id: "ignore", label: "Ignore this column" },
];

const EXCLUSIVE = new Set(["name", "phone", "contact", "first_name", "last_name", "email", "website", "channel", "notes"]);

export function roleMeta(id) {
  return IMPORT_ROLES.find((r) => r.id === id) || IMPORT_ROLES[IMPORT_ROLES.length - 1];
}

export function headerForRole(map, role) {
  return Object.keys(map).find((h) => map[h] === role) || "";
}

export function sampleValues(records, header, n = 3) {
  const out = [];
  for (const rec of records || []) {
    const v = rec[header] == null ? "" : String(rec[header]).trim();
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= n) break;
  }
  return out;
}

export function columnFillCount(records, header) {
  return (records || []).filter((r) => String(r[header] ?? "").trim() !== "").length;
}

function normalizeChannel(raw) {
  const v = (raw || "").toString().trim().toLowerCase();
  if (!v) return "";
  if (v.includes("whats") || v === "wa") return "whatsapp";
  if (v.includes("sms") || v.includes("text")) return "sms";
  if (v.includes("mail") || v.includes("email") || v === "e-mail") return "email";
  if (v.includes("call") || v.includes("phone") || v.includes("voice")) return "voice";
  if (v.includes("auto") || v.includes("any")) return "auto";
  return "";
}

function guessColumn(headers, field, taken) {
  const candidates = COLUMN_GUESSES[field] || [];
  const lower = headers.map((h) => (h || "").toString().trim().toLowerCase());
  for (const c of candidates) {
    const idx = lower.findIndex((h, i) => h === c && !taken.has(headers[i]));
    if (idx !== -1) return headers[idx];
  }
  for (const c of candidates) {
    if (c.length < 5) continue;
    const idx = lower.findIndex((h, i) => h.includes(c) && !taken.has(headers[i]));
    if (idx !== -1) return headers[idx];
  }
  return "";
}

export function guessColumnMap(headers) {
  const map = {};
  const taken = new Set();
  const guessOrder = ["email", "phone", "website", "channel", "notes", "first_name", "last_name", "contact", "name"];
  for (const field of guessOrder) {
    const found = guessColumn(headers, field, taken);
    if (found) {
      map[found] = field;
      taken.add(found);
    }
  }
  (headers || []).forEach((h) => {
    if (!map[h]) map[h] = "extra";
  });
  return map;
}

export function assignColumnRole(map, header, role) {
  const next = { ...map, [header]: role };
  if (EXCLUSIVE.has(role)) {
    Object.keys(next).forEach((h) => {
      if (h !== header && next[h] === role) next[h] = "extra";
    });
  }
  return next;
}

function tableFromAoa(aoa) {
  if (!aoa || !aoa.length) return { headers: [], records: [] };
  if (aoa[0] && aoa[0][0] != null) aoa[0][0] = String(aoa[0][0]).replace(/^\uFEFF/, "");
  const width = Math.max(0, ...aoa.map((row) => (row || []).length));
  const headerRow = [];
  for (let i = 0; i < width; i++) {
    const t = (aoa[0][i] ?? "").toString().trim();
    headerRow.push(t || `Column ${i + 1}`);
  }
  const seen = {};
  const headers = headerRow.map((h) => {
    if (!seen[h]) {
      seen[h] = 1;
      return h;
    }
    seen[h] += 1;
    return `${h} (${seen[h]})`;
  });
  const records = aoa
    .slice(1)
    .filter((row) => (row || []).some((c) => String(c ?? "").trim() !== ""))
    .map((row) => {
      const rec = {};
      headers.forEach((h, i) => {
        rec[h] = row[i] == null ? "" : row[i];
      });
      return rec;
    });
  return { headers, records };
}

export function applyColumnMap(rec, map, id) {
  const pick = (role) => {
    const h = headerForRole(map, role);
    return h ? rec[h] ?? "" : "";
  };
  const first = String(pick("first_name") || "").trim();
  const last = String(pick("last_name") || "").trim();
  const contact = String(pick("contact") || "").trim() || [first, last].filter(Boolean).join(" ");
  const extras = {};
  const extraParts = [];
  Object.entries(map || {}).forEach(([h, role]) => {
    if (role !== "extra") return;
    const v = rec[h];
    extras[h] = v;
    if (v != null && String(v).trim() !== "") extraParts.push(`${h}: ${v}`);
  });
  const notesCol = String(pick("notes") || "").trim();
  const notes = [notesCol, extraParts.join(" · ")].filter(Boolean).join(" — ");
  const website = String(pick("website") || "").trim();
  return {
    id,
    name: String(pick("name") || "").trim(),
    phone: String(pick("phone") || "").trim(),
    contact,
    email: String(pick("email") || "").trim(),
    sourceType: website ? "Website URL" : "Notes only",
    source: website,
    notes,
    extras,
    raw: rec || {},
    channel: normalizeChannel(pick("channel")),
    fallback: "none",
  };
}

export function parseSpreadsheetFile(file, onDone, onError) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();

  if (ext === "csv") {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        const { headers, records } = tableFromAoa(results.data || []);
        onDone({ headers, records, sheets: [], sheet: "", allSheets: null });
      },
      error: (err) => onError(err.message || "Could not read CSV file"),
    });
    return;
  }

  if (ext === "xlsx" || ext === "xls") {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const allSheets = {};
        (wb.SheetNames || []).forEach((name) => {
          const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false });
          allSheets[name] = tableFromAoa(aoa);
        });
        const sheet = (wb.SheetNames && wb.SheetNames[0]) || "";
        const parsed = allSheets[sheet] || { headers: [], records: [] };
        onDone({ ...parsed, sheets: wb.SheetNames || [], sheet, allSheets });
      } catch (err) {
        onError("Could not read spreadsheet — check the file isn't corrupted");
      }
    };
    reader.onerror = () => onError("Could not read file");
    reader.readAsArrayBuffer(file);
    return;
  }

  onError("Unsupported file type — upload a .csv, .xlsx, or .xls file");
}

export function ImportReviewScreen({
  C,
  FONT_DISPLAY,
  FONT_BODY,
  FONT_MONO,
  CHANNEL_OPTIONS,
  ISSUE_META,
  fileName,
  recordCount,
  importHeaders,
  importRecords,
  columnMap,
  onColumnRole,
  importSheets,
  importSheet,
  onSheetChange,
  importFilter,
  setImportFilter,
  importRows,
  filteredRows,
  includedCount,
  flaggedCount,
  duplicateCount,
  knownCount,
  bulkChannel,
  setBulkChannel,
  onToggle,
  onUpdate,
  onUpdateRaw,
  onRemove,
  onSelectAll,
  onApplyChannel,
  onDiscardFlagged,
  onDifferentFile,
  onClose,
  onConfirm,
}) {
  const headers = importHeaders || [];
  const records = importRecords || [];
  const map = columnMap || {};
  const rows = importRows || [];
  const shown = filteredRows || [];

  const inputStyle = (bad) => ({
    width: "100%",
    padding: "8px 9px",
    borderRadius: 8,
    border: `1px solid ${bad ? C.redSolid : C.border}`,
    fontFamily: FONT_BODY,
    fontSize: 12.5,
    outline: "none",
    background: "#fff",
    boxSizing: "border-box",
  });

  const nameMapped = !!headerForRole(map, "name");
  const phoneMapped = !!headerForRole(map, "phone");
  const extraCount = headers.filter((h) => map[h] === "extra").length;
  const ignoreCount = headers.filter((h) => map[h] === "ignore").length;
  const mappedCount = headers.filter((h) => map[h] && map[h] !== "extra" && map[h] !== "ignore").length;
  const gridCols = `44px repeat(${Math.max(headers.length, 1)}, minmax(150px, 1fr)) 132px minmax(150px, 1.2fr) 40px`;
  const roleColor = (role) => {
    if (role === "ignore") return C.slateLight;
    if (role === "extra") return C.slate;
    if (role === "name" || role === "phone") return C.teal;
    return C.cobaltDeep;
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: C.paper, display: "flex", flexDirection: "column", fontFamily: FONT_BODY }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 28px", borderBottom: `1px solid ${C.border}`, background: "#fff" }}>
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.textInk }}>Map columns, then review rows</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 3, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>{fileName}</span>
            {importSheets && importSheets.length > 1 && (
              <select
                value={importSheet}
                onChange={(e) => onSheetChange(e.target.value)}
                style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12 }}
              >
                {importSheets.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
            <span>· {headers.length} columns · {recordCount} rows · {includedCount} ready to contact</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onDifferentFile} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 14px", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.slate, cursor: "pointer" }}>
            Use a different file
          </button>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 8 }}>
            <X size={18} color={C.slate} />
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 0, flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          <div style={{ padding: "14px 28px 12px", borderBottom: `1px solid ${C.border}`, background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Table2 size={14} color={C.cobalt} />
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                  Every column in the file — tell us what each one is
                </div>
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate }}>
                {mappedCount} mapped · {extraCount} kept as extra · {ignoreCount} ignored
              </div>
            </div>
            {(!nameMapped || !phoneMapped) && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.amberSoft, borderRadius: 8, padding: "8px 11px", marginBottom: 10 }}>
                <AlertTriangle size={13} color={C.amber} />
                <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.textInk }}>
                  Need {!nameMapped && !phoneMapped ? "Company name and Phone number" : !nameMapped ? "Company name" : "Phone number"} mapped before rows can go on the dialer.
                </span>
              </div>
            )}
            <div style={{ maxHeight: 250, overflow: "auto", border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(160px, 1.1fr) minmax(220px, 1.6fr) 90px minmax(200px, 1fr)", padding: "8px 14px", background: C.paper, fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em", position: "sticky", top: 0, zIndex: 1 }}>
                <div>Column in file</div>
                <div>Sample values</div>
                <div>Filled</div>
                <div>This column is</div>
              </div>
              {headers.map((h) => {
                const role = map[h] || "extra";
                const samples = sampleValues(records, h);
                const filled = columnFillCount(records, h);
                return (
                  <div
                    key={h}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(160px, 1.1fr) minmax(220px, 1.6fr) 90px minmax(200px, 1fr)",
                      gap: 10,
                      padding: "10px 14px",
                      borderTop: `1px solid ${C.border}`,
                      alignItems: "center",
                      background: role === "ignore" ? C.paperSoft : "#fff",
                      opacity: role === "ignore" ? 0.7 : 1,
                    }}
                  >
                    <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={h}>
                      {h}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
                      {samples.length === 0 ? (
                        <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight }}>No values</span>
                      ) : samples.map((s) => (
                        <span key={s} title={s} style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.textInk, background: C.paper, border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 7px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s}
                        </span>
                      ))}
                    </div>
                    <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.slate }}>
                      {filled}/{recordCount}
                    </div>
                    <select
                      value={role}
                      onChange={(e) => onColumnRole(h, e.target.value)}
                      style={{
                        width: "100%", padding: "7px 9px", borderRadius: 8,
                        border: `1.5px solid ${role === "ignore" ? C.border : roleColor(role)}`,
                        fontFamily: FONT_BODY, fontSize: 12.5, background: "#fff",
                        color: roleColor(role), fontWeight: 600,
                      }}
                    >
                      {IMPORT_ROLES.map((r) => (
                        <option key={r.id} value={r.id}>{r.label}{r.required ? " *" : ""}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, marginTop: 8 }}>
              Different files can have different titles. Map what you have. Extra columns stay available to the AI unless you Ignore them.
            </div>
          </div>

          <div style={{ padding: "12px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[
                ["all", `All (${rows.length})`],
                ["issues", `Needs review (${flaggedCount})`],
                ["duplicates", `Duplicates (${duplicateCount})`],
                ["known", `Already known (${knownCount})`],
              ].map(([id, label]) => {
                const empty =
                  (id === "issues" && !flaggedCount) ||
                  (id === "duplicates" && !duplicateCount) ||
                  (id === "known" && !knownCount);
                return (
                  <button
                    key={id}
                    onClick={() => setImportFilter(id)}
                    disabled={id !== "all" && empty}
                    style={{
                      padding: "6px 12px", borderRadius: 999, border: `1px solid ${importFilter === id ? C.ink : C.border}`,
                      background: importFilter === id ? C.ink : "#fff", color: importFilter === id ? "#fff" : (empty ? C.slateLight : C.slate),
                      fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: empty ? "default" : "pointer",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => onSelectAll(true)} style={{ background: "none", border: "none", color: C.cobalt, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Check all shown</button>
              <button onClick={() => onSelectAll(false)} style={{ background: "none", border: "none", color: C.slate, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Uncheck</button>
              <select value={bulkChannel} onChange={(e) => setBulkChannel(e.target.value)} style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12 }}>
                {CHANNEL_OPTIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <button onClick={onApplyChannel} style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 6, padding: "5px 10px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Set channel</button>
            </div>
          </div>

          {(flaggedCount > 0 || knownCount > 0) && (
            <div style={{ padding: "0 28px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
              {flaggedCount > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.amberSoft, borderRadius: 8, padding: "9px 12px" }}>
                  <AlertTriangle size={14} color={C.amber} />
                  <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk, flex: 1 }}>
                    {flaggedCount} row{flaggedCount === 1 ? "" : "s"} need a look — left unchecked so they will not be contacted.
                  </span>
                  <button onClick={onDiscardFlagged} style={{ background: "none", border: `1px solid ${C.amber}`, color: C.amber, borderRadius: 6, padding: "5px 10px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    Discard flagged
                  </button>
                </div>
              )}
              {knownCount > 0 && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: C.cobaltSoft, borderRadius: 8, padding: "9px 12px" }}>
                  <History size={14} color={C.cobaltDeep} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk, lineHeight: 1.45 }}>
                    {knownCount} already in the call log under a different name or the same person. Skipped by default.
                  </span>
                </div>
              )}
            </div>
          )}

          <div style={{ flex: 1, overflow: "auto", padding: "0 28px 24px" }}>
            <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, overflowX: "auto" }}>
              <div style={{ minWidth: 44 + headers.length * 160 + 320, display: "grid", gridTemplateColumns: gridCols, padding: "10px 14px", background: C.paper, fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, letterSpacing: "0.02em", position: "sticky", top: 0, zIndex: 1 }}>
                <div />
                {headers.map((h) => {
                  const role = map[h] || "extra";
                  return (
                    <div key={h} style={{ minWidth: 0, opacity: role === "ignore" ? 0.45 : 1 }}>
                      <div style={{ textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={h}>{h}</div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: roleColor(role), textTransform: "none", letterSpacing: 0, marginTop: 2 }}>
                        {roleMeta(role).label}
                      </div>
                    </div>
                  );
                })}
                <div style={{ textTransform: "uppercase" }}>Channel</div>
                <div style={{ textTransform: "uppercase" }}>Status</div>
                <div />
              </div>
              {shown.length === 0 && (
                <div style={{ padding: 28, textAlign: "center", fontFamily: FONT_BODY, fontSize: 13, color: C.slateLight }}>No rows match this filter.</div>
              )}
              {shown.map((r) => {
                const nameHeader = headerForRole(map, "name");
                const phoneHeader = headerForRole(map, "phone");
                const issues = r.issues || [];
                return (
                  <div
                    key={r.id}
                    style={{
                      minWidth: 44 + headers.length * 160 + 320,
                      display: "grid",
                      gridTemplateColumns: gridCols,
                      gap: 8,
                      padding: "10px 14px",
                      borderTop: `1px solid ${C.border}`,
                      alignItems: "start",
                      background: r.included ? "#fff" : C.paperSoft,
                      opacity: r.included ? 1 : 0.72,
                    }}
                  >
                    <input type="checkbox" checked={!!r.included} onChange={() => onToggle(r.id)} style={{ cursor: "pointer", marginTop: 8 }} />
                    {headers.map((h) => {
                      const role = map[h] || "extra";
                      const val = r.raw ? (r.raw[h] ?? "") : "";
                      const bad =
                        (h === nameHeader && issues.includes("missing_name")) ||
                        (h === phoneHeader && (issues.includes("missing_phone") || issues.includes("bad_phone")));
                      return (
                        <input
                          key={h}
                          value={val}
                          onChange={(e) => onUpdateRaw(r.id, h, e.target.value)}
                          disabled={role === "ignore"}
                          style={{ ...inputStyle(bad), opacity: role === "ignore" ? 0.5 : 1 }}
                        />
                      );
                    })}
                    <select value={r.channel || ""} onChange={(e) => onUpdate(r.id, "channel", e.target.value)} style={{ ...inputStyle(false), padding: "8px 6px" }}>
                      <option value="">Default</option>
                      {CHANNEL_OPTIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                    <div>
                      {issues.length === 0 ? (
                        <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.green, fontWeight: 600 }}>Ready</span>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {issues.map((code) => (
                            <span key={code} style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, color: (ISSUE_META[code] || ISSUE_META.duplicate).color }}>
                              {code === "duplicate" ? `Duplicate of ${r.duplicateOf}` : (ISSUE_META[code] || {}).label || code}
                            </span>
                          ))}
                        </div>
                      )}
                      {r.identityMatch && (
                        <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slate, marginTop: 4, lineHeight: 1.35 }}>
                          {r.identityMatch.reasons[0]}
                          {r.identityMatch.requestedFollowUp ? ` — they asked: “${r.identityMatch.requestedFollowUp.exactWords}”` : ""}
                          {r.identityMatch.lastContactAt ? ` · last ${r.identityMatch.lastContactAt}` : ""}
                        </div>
                      )}
                    </div>
                    <button onClick={() => onRemove(r.id)} style={{ background: "none", border: "none", cursor: "pointer", marginTop: 8 }}>
                      <Trash2 size={14} color={C.slateLight} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ borderLeft: `1px solid ${C.border}`, background: "#fff", padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.textInk }}>What the software understood</div>
          {[
            ["Rows in file", recordCount],
            ["Columns in file", headers.length],
            ["Mapped", mappedCount],
            ["Kept as extra", extraCount],
            ["Ready to contact", includedCount],
            ["Need review", flaggedCount],
            ["Already known", knownCount],
          ].map(([label, value]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT_BODY, fontSize: 13 }}>
              <span style={{ color: C.slate }}>{label}</span>
              <span style={{ fontFamily: FONT_MONO, fontWeight: 600, color: C.textInk }}>{value}</span>
            </div>
          ))}
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, lineHeight: 1.5, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
            Every column from this file is listed. Map Company name and Phone. Unknown titles stay as extra — they do not break the import.
          </div>
          <button
            onClick={onConfirm}
            disabled={!includedCount}
            style={{
              marginTop: "auto", width: "100%", padding: "12px", borderRadius: 9, border: "none",
              background: includedCount ? C.ink : C.paperSoft, color: includedCount ? "#fff" : C.slateLight,
              fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14, cursor: includedCount ? "pointer" : "default",
            }}
          >
            Continue with {includedCount} companies
          </button>
        </div>
      </div>
    </div>
  );
}
