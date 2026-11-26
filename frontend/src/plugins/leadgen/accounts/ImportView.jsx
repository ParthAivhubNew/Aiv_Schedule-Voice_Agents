import React, { useState, useRef } from "react";
import { Spinner } from "../../../app/Loader";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Check, X, FileSpreadsheet, Upload } from "lucide-react";
import { api } from "../../../api/apiClient";
import { EnrichmentBanner, EnrichmentSourcesModal } from "../EnrichmentSourcesModal";
import { C } from "../../../tokens";
import { ImportMapper } from "../ImportMapper";
import { quarantineCsv, applyMapping, withPeople } from "../importMapping";
import { pendingList } from "../openList";
import { CallButton, useCallDialog } from "../CallFlow";
import { ConsentDeclaration } from "../ConsentDeclaration";
import { niceName } from "../companyLogic";
import { openPicks } from "../listLogic";
import { muted, text } from "./accountParts";
import { customColumns } from "./accountsLogic";

// ---------------------------------------------------------------- Import
// Same logic as the Voice plugin's file import (CallingWorkspace.jsx: parseSpreadsheetFile) --
// every sheet of a workbook is read, not just the first, and .json is accepted alongside
// .xlsx/.xls/.ods/.csv/.tsv/.txt, so people can bring in whatever file they already have.
async function parseImportFile(file) {
  const name = file.name.toLowerCase();
  if (/\.(csv|tsv|txt)$/.test(name)) {
    const parsed = await new Promise((resolve, reject) => Papa.parse(file, { header: true, skipEmptyLines: "greedy", complete: resolve, error: reject }));
    return { sheets: { CSV: parsed.data || [] }, sheetNames: ["CSV"] };
  }
  if (/\.json$/.test(name)) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (_) {
      throw new Error("Could not read that JSON file.");
    }
    const records = Array.isArray(data) ? data
      : Array.isArray(data.rows) ? data.rows
      : Array.isArray(data.contacts) ? data.contacts
      : Array.isArray(data.companies) ? data.companies
      : Array.isArray(data.accounts) ? data.accounts
      : [];
    const objs = records.filter((r) => r && typeof r === "object");
    if (!objs.length) throw new Error("That JSON file has no list of companies.");
    return { sheets: { JSON: objs }, sheetNames: ["JSON"] };
  }
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheetNames = wb.SheetNames || [];
  if (!sheetNames.length) throw new Error("That spreadsheet has no sheets.");
  const sheets = {};
  for (const sName of sheetNames) sheets[sName] = XLSX.utils.sheet_to_json(wb.Sheets[sName], { defval: "" });
  return { sheets, sheetNames };
}

const IMPORT_BATCH = 500;

// Every company that has more than one phone or email to choose from, one row each: the options in a dropdown (the best guess first),
// "Use" to save the one shown, and one button to accept every best guess. Nothing is saved until a choice is made.
export function NeedsChoiceTable({ rows, store }) {
  const items = rows.flatMap((a) => openPicks(a).map((f) => ({ a, f })));
  const [chosen, setChosen] = useState({});
  const [busy, setBusy] = useState("");
  const key = (a, f) => `${a.id}:${f.field}`;
  const act = async (id, fn, ok) => {
    setBusy(id);
    try { await fn(); await store.reload(); if (ok) store.toast?.(ok); } catch (e) { store.toast?.(e.message || "That didn't save. Try again."); } finally { setBusy(""); }
  };
  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      <div style={{ padding: "10px 12px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>Needs your choice · {items.length.toLocaleString()}</strong>
        <span style={{ ...muted, flex: 1 }}>Nothing is saved until you choose.</span>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={Boolean(busy)}
          onClick={() => act("all", () => api.acceptBestCheckPicks({ ids: [...new Set(items.map(({ a }) => a.id))] }), "Saved every best guess.")}>Accept all best guesses ({items.length.toLocaleString()})</button>
      </div>
      <div className="ui-scroll" style={{ overflowX: "auto" }}>
        <table className="ui-table" style={{ minWidth: 520 }}>
          <thead><tr><th>Company</th><th>Detail</th><th>Options</th><th aria-label="Action" /></tr></thead>
          <tbody>
            {items.map(({ a, f }) => {
              const opts = f.options || [];
              const value = chosen[key(a, f)] || (opts[0] || {}).value || "";
              return (
                <tr key={key(a, f)}>
                  <td style={{ fontWeight: 600 }}>{niceName(a.name)}</td>
                  <td>{f.field === "phone" ? "Phone" : "Email"}</td>
                  <td><select className="ui-input" aria-label={`Options for ${a.name}`} value={value} onChange={(e) => setChosen((c) => ({ ...c, [key(a, f)]: e.target.value }))} style={{ maxWidth: 320 }}>
                    {opts.map((o, i) => <option key={o.value} value={o.value}>{o.value}{i === 0 ? " (best guess)" : ""}</option>)}
                  </select></td>
                  <td style={{ textAlign: "right" }}><button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={Boolean(busy) || !value}
                    onClick={() => act(key(a, f), () => api.answerCheckPick(a.id, { field: f.field, value }), "Saved.")}>Use</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// What an import did, in plain terms, and what to do next.
function QuarantineBox({ rows }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([quarantineCsv(rows)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "not-imported.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <b style={{ ...text, fontSize: 13.5 }}>Not saved ({rows.length.toLocaleString()})</b>
        <span style={{ ...muted, fontSize: 12.5 }}>Nothing here was added to your lists. Fix the rows and import them again.</span>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ marginLeft: "auto" }} onClick={download}>Download these rows</button>
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 180, overflowY: "auto", ...muted, fontSize: 12.5 }}>
        {rows.slice(0, 50).map((r, i) => <li key={i}><b>{r.name}</b>: {(r.reasons || []).join(" ")}</li>)}
        {rows.length > 50 ? <li>…and {(rows.length - 50).toLocaleString()} more in the download.</li> : null}
      </ul>
    </div>
  );
}

function ImportReport({ done, accounts = [], onGo, onClose, onToast }) {
  const call = useCallDialog(onToast);
  // The opt-in question matters only when someone in the file could be a sole trader. When every new company is already a confirmed
  // register company it would change nothing, so it is not asked. Not enough known yet: it is asked.
  const fresh = (done.newIds || []).map((id) => accounts.find((a) => a.id === id)).filter(Boolean);
  const askConsent = Boolean(done.newIds?.length) && !(fresh.length === done.newIds.length && fresh.every((a) => (a.email_route || {}).group === "ready"));
  const stat = (n, label, tip) => (n ? (
    <div title={tip} style={{ flex: "1 1 120px", minWidth: 110, padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 8, background: "#fff" }}>
      <div style={{ ...text, fontSize: 22, lineHeight: 1.15, fontWeight: 600, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{n.toLocaleString()}</div>
      <div style={{ ...muted, fontSize: 12.5, marginTop: 2 }}>{label}</div>
    </div>
  ) : null);
  const gaps = [["phone number", done.blanks.phone], ["email", done.blanks.email], ["website", done.blanks.website]].filter(([, n]) => n);
  return (
    <div className="ui-card" role="status" style={{ padding: 18, textAlign: "left", display: "flex", flexDirection: "column", gap: 14, maxWidth: 760, width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ width: 24, height: 24, borderRadius: 12, background: C.greenSoft, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Check size={14} color={C.green} /></span>
        <div style={{ marginRight: "auto", minWidth: 0 }}>
          <div style={{ ...text, fontSize: 15, fontWeight: 600, color: C.ink }}>Import finished</div>
          <div style={{ ...muted, fontSize: 12.5, overflowWrap: "anywhere" }}>{done.file ? `${done.file} · ` : ""}saved in the list {done.list?.name || "Unsorted"}</div>
        </div>
        <button type="button" className="ui-icon-btn" aria-label="Dismiss" onClick={onClose}><X size={16} /></button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {stat(done.added, "new companies", "Companies that were not in your account before")}
        {stat(done.matched, "already saved, added to the list", "Matched by website, or by name and town. Not copied, nothing to pay again")}
        {stat(done.filled, "filled from our records (free)", "The registry record was found, so its website, size and sector were added where yours were blank")}
        {stat(done.repeats, "repeats, kept once", "The same company on more than one row")}
        {stat(done.unnamed, "left out: no name or website", "Rows with nothing to identify the company")}
        {stat((done.quarantined || []).length, "not saved: failed a check", "Rows with a bad email, phone, website or similar. They are listed below with the reason")}
        {stat(done.warned, "saved with a warning", "Saved, but worth a look: a personal mailbox, a shared inbox, a mobile, or no Ltd in the name")}
      </div>
      {(done.quarantined || []).length ? <QuarantineBox rows={done.quarantined} /> : null}
      {askConsent ? <ConsentDeclaration leadIds={done.newIds} scope="import" count={done.newIds.length} onDone={(_, msg) => onToast?.(msg)} /> : null}
      {!done.added && !done.matched ? <div style={{ ...muted, fontSize: 13 }}>Nothing was added.</div> : null}
      {done.matching ? <div style={{ display: "flex", gap: 8, alignItems: "center", ...muted, fontSize: 12.5 }}><Spinner size={13} /> Filling in from our company records: {done.matching.done.toLocaleString()} of {done.matching.total.toLocaleString()}. Free. You can keep working.</div> : null}
      {gaps.length || done.custom?.length ? (
        <div style={{ ...muted, fontSize: 12.5, display: "flex", flexDirection: "column", gap: 4 }}>
          {gaps.length ? <div>Missing in your file: {gaps.map(([label, n]) => `${n.toLocaleString()} ${label}${n === 1 ? "" : "s"}`).join(", ")}. Open the list and use "Get contacts" to fill these and fix what looks wrong.</div> : null}
          {done.custom?.length ? <div>Your own columns were kept: {done.custom.join(", ")}.</div> : null}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button title="Go to this list" type="button" className="ui-btn ui-btn--primary" onClick={() => { if (done.list?.id) pendingList.id = done.list.id; onGo("lists"); }}>Open the list</button>
        {done.list?.id && (done.blanks?.phone ?? 0) < (done.list.count ?? Infinity) ? (
          <CallButton label="Call this list" lockedLabel="Call this list · add Voice" title="Skips anyone without a number, on your do-not-contact list or contacted lately, and shows you who before it dials"
            onClick={() => call.open({ kind: "list", id: done.list.id, name: done.list.name })} onLocked={() => call.open({ kind: "list", id: done.list.id, name: done.list.name }, true)} />
        ) : null}
      </div>
      {call.dialog}
    </div>
  );
}

export function ImportView({ store, onGo, onAskAi }) {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState(null); // { sheetName: rawRecords[] }
  const [sheetNames, setSheetNames] = useState([]); // sheets that actually have rows
  const [showMapper, setShowMapper] = useState(false); // "Match your columns" popup, same as Voice's file import
  const [activeSheet, setActiveSheet] = useState("");
  const [fields, setFields] = useState([]); // account-shaped rows, after column matching
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [listName, setListName] = useState(""); // the list this file is saved into
  const [progress, setProgress] = useState(null); // { done, total } while a big file is going in
  const [onExisting, setOnExisting] = useState("fill"); // a company already saved: fill its blanks, leave it, or overwrite it from the file
  const [fillFree, setFillFree] = useState(true); // after saving, fill what our own records already know (free)
  const [enrichModalOpen, setEnrichModalOpen] = useState(false);

  const resetFile = () => {
    setFile(null);
    setSheets(null);
    setSheetNames([]);
    setFields([]);
    setShowMapper(false);
  };

  const pick = async (f) => {
    if (!f) return;
    setError("");
    setDone(null);
    try {
      const { sheets: allSheets, sheetNames: names } = await parseImportFile(f);
      const withRows = names.filter((n) => (allSheets[n] || []).some((r) => Object.values(r).some((v) => String(v).trim())));
      if (!withRows.length) throw new Error("That file has no rows to import.");
      setFile(f);
      setListName(f.name.replace(/\.[^.]+$/, "").slice(0, 80));
      setSheets(allSheets);
      setSheetNames(withRows);
      setShowMapper(true);
    } catch (e) {
      resetFile();
      setError(e.message || "Couldn't read that file. Use .xlsx, .xls, .ods, .csv, .tsv or .json.");
    }
  };

  const onMapped = ({ sheet, map }) => {
    const data = (sheets[sheet] || []).filter((r) => Object.values(r).some((v) => String(v).trim()));
    const headers = data.length ? Object.keys(data[0]) : [];
    setActiveSheet(sheet);
    setFields(withPeople(applyMapping(headers, data, map), Object.values(map).includes("name")));
    setShowMapper(false);
  };

  const usable = fields.filter((r) => r.name || r.website);
  // The blanks in what is about to be imported, so the report can say what "Check & improve" will have to fill.
  const blanks = (rows) => ({ phone: rows.filter((r) => !r.phone).length, email: rows.filter((r) => !r.email).length, website: rows.filter((r) => !r.website).length });
  // Free: it only reads our own company records. It runs after the import is already shown, a few at a time, so nobody waits on it;
  // the report line counts up, and the list is refreshed once it ends. A huge file is capped.
  const fillFromRecords = async (ids) => {
    let next = 0;
    let finished = 0;
    let filled = 0;
    setDone((d) => (d ? { ...d, matching: { done: 0, total: ids.length } } : d));
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        try {
          const r = await api.quickCheckLeadAccount(id);
          if (r && r.registry) filled += 1;
        } catch { /* one that can't be read is simply left as it was */ }
        finished += 1;
        setDone((d) => (d ? { ...d, filled, matching: { done: finished, total: ids.length } } : d));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setDone((d) => (d ? { ...d, filled, matching: null } : d));
    store.reload();
  };
  const importNow = async () => {
    setBusy(true);
    const name = listName.trim() || "Unsorted";
    const rows = usable.map((x) => ({ ...x, source: "import", source_url: file?.name ? `file:${file.name}`.slice(0, 500) : "" }));  // which file it came from
    const total = { added: 0, matched: 0, repeats: 0, quarantined: [], warned: 0, unnamed: fields.length - usable.length, list: null, rows: rows.length, file: file?.name || "", blanks: blanks(rows), custom: customColumns(fields) };
    try {
      // In batches, so a big file shows how far it has got and never hits the size limit of one request.
      for (let i = 0; i < rows.length; i += IMPORT_BATCH) {
        setProgress({ done: i, total: rows.length });
        const r = await store.save(rows.slice(i, i + IMPORT_BATCH), name, { quiet: true, onExisting });
        if (r && r.accounts) total.newIds = [...(total.newIds || []), ...r.accounts.map((a) => a.id)];
        if (!r) throw new Error(`Stopped after ${i.toLocaleString()} of ${rows.length.toLocaleString()} rows. What was imported so far is in the list ${name}.`);
        total.added += r.added; total.matched += r.matched || 0; total.repeats += r.repeats || 0; total.unnamed += r.unnamed || 0; total.warned += r.warned || 0; total.quarantined = [...total.quarantined, ...(r.quarantined || [])]; total.list = r.list || total.list;
      }
      setDone(total);
      if (fillFree && total.newIds?.length) fillFromRecords(total.newIds.slice(0, 300));
      store.toast(`Imported ${total.added.toLocaleString()} new ${total.added === 1 ? "company" : "companies"} into ${total.list?.name || name}.`);
      resetFile();
    } catch (e) {
      setError(e.message || "The import stopped. Try again.");
      store.toast(e.message || "The import stopped. Try again.");
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <EnrichmentBanner onOpenModal={() => setEnrichModalOpen(true)} />
      <input ref={fileRef} type="file" hidden accept=".xlsx,.xls,.ods,.csv,.tsv,.txt,.json" onChange={(e) => { pick(e.target.files && e.target.files[0]); e.target.value = ""; }} />
      {showMapper ? (
        <ImportMapper
          fileName={file?.name}
          sheets={sheets}
          sheetNames={sheetNames}
          initialSheet={activeSheet}
          onCancel={resetFile}
          onImport={onMapped}
        />
      ) : null}
      {done && !fields.length ? <ImportReport done={done} accounts={store.accounts} onGo={onGo} onClose={() => setDone(null)} onToast={store.toast} /> : null}
      {!fields.length ? (
        <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files && e.dataTransfer.files[0]); }}
          style={{ border: "1.5px dashed #CBD1D9", borderRadius: 8, background: "var(--ui-sunken)", padding: done ? "24px 20px" : "36px 20px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10 }}>
          <div style={{ width: 44, height: 44, borderRadius: 6, background: "#fff", border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: "#8B5CF6" }}><FileSpreadsheet size={20} /></div>
          <div style={{ ...text, fontSize: 15, fontWeight: 600, color: C.ink }}>{done ? "Import another file" : "Import companies from a file"}</div>
          <div style={{ ...muted, maxWidth: "46ch" }}>Drop an Excel, CSV or JSON file here, or choose one. You check which column is which before anything is saved.</div>
          <ul style={{ ...muted, fontSize: 12.5, margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 2 }}>
            <li>Every sheet in a workbook is read, not just the first.</li>
            <li>Every file becomes a list.</li>
            <li>A company you already saved is not copied, only added to the list.</li>
          </ul>
          <button title="Pick a CSV or Excel file of companies to import" type="button" className="ui-btn ui-btn--primary" onClick={() => fileRef.current && fileRef.current.click()}><Upload size={15} /> Upload CSV / Excel</button>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
            {[".xlsx", ".xls", ".csv", ".tsv", ".ods", ".json"].map((ext) => (
              <span key={ext} style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 500, color: C.slate, padding: "2px 6px", border: `1px solid ${C.border}`, background: "#fff", borderRadius: 4 }}>{ext}</span>
            ))}
          </div>
          {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
          {onAskAi ? (
            <div style={{ fontSize: 12.5, color: C.slate, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
              Or
              <button title="Use the AI search to find companies instead of importing a file" type="button" className="ui-link" onClick={onAskAi}>ask the AI to find companies instead</button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="ui-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ ...text, fontSize: 14, fontWeight: 600, color: C.ink, marginRight: "auto" }}>{file?.name} · {fields.length} {fields.length === 1 ? "row" : "rows"}{fields.some((r) => r.name && r.name === r.contact_name && !r.website) ? " · saved as people" : ""}</div>
            <button title="Change which of your columns goes into which field" type="button" className="ui-btn ui-btn--ghost" onClick={() => setShowMapper(true)}>Edit column matches</button>
            <button title="Pick a different file" type="button" className="ui-btn ui-btn--ghost" onClick={resetFile}>Choose another file</button>
          </div>
          <div className="ui-scroll" style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 6 }}>
            <table className="ui-table" style={{ minWidth: 640 }}>
              <thead><tr><th>Company</th><th>Website</th><th>Phone</th><th>Contact</th></tr></thead>
              <tbody>
                {fields.slice(0, 5).map((r, i) => (
                  <tr key={i}>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</td>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{r.website}</td>
                    <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{r.phone}</td>
                    <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{r.contact_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label style={{ ...muted, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>Save into the list
            <input className="ui-input" style={{ maxWidth: 280 }} value={listName} maxLength={80} onChange={(e) => setListName(e.target.value)} aria-label="List name" />
            <button type="button" className="ui-link" onClick={() => setListName((file?.name || "").replace(/\.[^.]+$/, "").slice(0, 80))} title="Use the file name again">Reset</button>
            <span style={{ fontSize: 12 }}>A list with this name is reused if you already have one.</span>
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ ...muted, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>If a company is already saved
              <select className="ui-input" style={{ width: "auto", maxWidth: 360 }} value={onExisting} onChange={(e) => setOnExisting(e.target.value)} aria-label="If a company is already saved">
                <option value="fill">Fill its blanks from my file, keep what is saved</option>
                <option value="skip">Leave it exactly as it is</option>
                <option value="update">Update it with my file's values</option>
              </select>
            </label>
            <label style={{ ...muted, display: "flex", gap: 8, alignItems: "center" }} title="Reads our own company records only. Nothing is charged.">
              <input type="checkbox" checked={fillFree} onChange={(e) => setFillFree(e.target.checked)} /> After saving, fill in what our company records already know: website, size, sector. Free.
            </label>
          </div>
          {customColumns(fields).length ? (
            <div style={{ ...muted, fontSize: 12.5 }}>Kept as your own columns: {customColumns(fields).join(", ")}</div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button title="Add these companies to the list" type="button" className="ui-btn ui-btn--primary" disabled={!usable.length || busy} onClick={importNow}>
              {busy ? (progress ? `Importing ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()}…` : "Importing…") : `Import ${usable.length} ${usable.length === 1 ? "company" : "companies"}`}
            </button>
            {busy && progress ? (
              <div role="progressbar" aria-valuenow={Math.round((progress.done / progress.total) * 100)} style={{ flex: "1 1 160px", height: 6, borderRadius: 3, background: C.paperSoft, overflow: "hidden" }}>
                <div style={{ width: `${Math.round((progress.done / progress.total) * 100)}%`, height: "100%", background: "var(--ui-accent)", transition: "width .3s" }} />
              </div>
            ) : null}
            {fields.length > usable.length ? <span style={{ ...muted, fontSize: 12.5 }}>{fields.length - usable.length} without a name or website will be left out.</span> : null}
          </div>
          {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
        </div>
      )}
      <EnrichmentSourcesModal open={enrichModalOpen} onClose={() => setEnrichModalOpen(false)} />
    </div>
  );
}
