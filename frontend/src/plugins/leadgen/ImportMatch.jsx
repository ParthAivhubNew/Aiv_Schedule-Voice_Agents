import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, Download, FileUp, X } from "lucide-react";
import { CardsSkeleton } from "../../app/Loader";
import { SalesforceDialog } from "./SalesforceDialog";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";
import {
  MAX_BYTES, MAX_ROWS, OPTIONAL_COLUMNS, REQUIRED_COLUMNS, ROW_FILTERS,
  decisionMessage, formatScore, importChips, importStatusLabel, isAdminOperator, isBusy, pct, percentToFraction,
  progressPercent, reduceQueueAfterDecision, saveBlob, shouldIgnoreReviewKey, statusLabel, templateCsv, validatePercentThresholds, whenText,
} from "./importMatchLogic";
import { Pill } from "../../app/ui";

// Import & match: upload your own customer records, match them to the Companies House register, and
// let a person confirm what the match was not sure about.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };
const label = { ...text, fontSize: 12, fontWeight: 600, color: C.slate, display: "block", marginBottom: 4 };
const css = `.imx .ui-input{width:100%;box-sizing:border-box}.imx .ui-table td{white-space:normal;overflow-wrap:anywhere}
.imx .imx-btn{min-height:44px}.imx .imx-tab{min-height:44px;padding:0 14px;border:0;border-bottom:2px solid transparent;background:none;cursor:pointer;font:600 14px ${FONT_BODY};color:${C.slate}}
.imx .imx-tab[aria-selected="true"]{color:${C.ink};border-bottom-color:${C.cobalt}}
.imx .imx-tab:focus-visible,.imx .imx-pick:focus-visible,.imx .imx-drop:focus-within{outline:2px solid ${C.cobalt};outline-offset:2px}
.imx .imx-rq{display:grid;grid-template-columns:minmax(200px,280px) 1fr;gap:14px;align-items:start}
.imx .imx-pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.imx .imx-pick{min-height:44px;width:100%;text-align:left;border:1px solid ${C.border};background:${C.surface};border-radius:8px;padding:8px 10px;cursor:pointer;font:500 13px ${FONT_BODY};color:${C.ink}}
@media (max-width:760px){.imx .imx-rq{grid-template-columns:1fr}.imx .imx-qlist{max-height:200px;overflow-y:auto}}`;


// The shared label (app/ui.jsx Pill); "plain" is its muted tone.
export function Chip({ tone = "plain", children }) {
  return <Pill tone={tone === "plain" ? "muted" : tone}>{children}</Pill>;
}

function CountChips({ counts }) {
  return <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>{importChips(counts).map((c) => <Chip key={c.key} tone={c.tone}>{c.label}: {c.count.toLocaleString("en-GB")}</Chip>)}</span>;
}

function Progress({ imp }) {
  const p = progressPercent(imp);
  return (
    <div>
      <div role="progressbar" aria-label="Matching progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} style={{ height: 8, background: C.paperSoft, borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${p}%`, height: "100%", background: C.cobalt, transition: "width .3s" }} />
      </div>
      <div style={{ ...muted, marginTop: 4 }}>{(imp.stats?.processed || 0).toLocaleString("en-GB")} of {(imp.row_count || 0).toLocaleString("en-GB")} records checked ({p}%)</div>
    </div>
  );
}

export function ImportMatchView({ operator, toast, onReviewCount }) {
  const [tab, setTab] = useState("imports");
  const [openId, setOpenId] = useState("");
  const [waiting, setWaiting] = useState(null);
  const refreshWaiting = useCallback(async () => {
    try { const n = (await api.getReviewQueue({ status: "open", limit: 1 })).total || 0; setWaiting(n); onReviewCount?.(n); } catch (_) { /* the tab shows no number */ }
  }, [onReviewCount]);
  useEffect(() => { refreshWaiting(); }, [refreshWaiting, tab]);
  const goReview = (id) => { setOpenId(id || ""); setTab("review"); };

  return (
    <div className="imx" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{css}</style>
      <div role="tablist" aria-label="Import and match" style={{ display: "flex", gap: 4, borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
        <button type="button" role="tab" id="imx-t-imports" aria-selected={tab === "imports"} aria-controls="imx-p-imports" className="imx-tab" onClick={() => setTab("imports")}>Imports</button>
        <button type="button" role="tab" id="imx-t-review" aria-selected={tab === "review"} aria-controls="imx-p-review" className="imx-tab" onClick={() => { setOpenId(""); setTab("review"); }}>Needs review{waiting != null ? ` (${waiting.toLocaleString("en-GB")})` : ""}</button>
      </div>
      {tab === "imports"
        ? <div role="tabpanel" id="imx-p-imports" aria-labelledby="imx-t-imports"><ImportsTab operator={operator} toast={toast} onReview={goReview} onChanged={refreshWaiting} /></div>
        : <div role="tabpanel" id="imx-p-review" aria-labelledby="imx-t-review"><ReviewQueue toast={toast} importId={openId} onClearImport={() => setOpenId("")} onChanged={refreshWaiting} /></div>}
    </div>
  );
}

// ---------- Imports tab ----------

function ImportsTab({ operator, toast, onReview, onChanged }) {
  const [imports, setImports] = useState(null);
  const [openId, setOpenId] = useState("");
  const load = useCallback(async () => {
    try { setImports((await api.listRecordImports()).imports || []); } catch (e) { setImports([]); toast?.(e.message || "Couldn't load your imports."); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  if (imports === null) return <CardsSkeleton count={3} label="Loading your imports" />;
  if (openId) return <ImportDetail id={openId} toast={toast} onBack={() => { setOpenId(""); load(); }} onReview={onReview} onChanged={onChanged} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <UploadCard toast={toast} onUploaded={(imp) => { load(); if (imp?.id) setOpenId(imp.id); }} />
      <div className="ui-card" style={{ overflow: "hidden" }}>
        <div style={{ ...text, fontSize: 14, fontWeight: 600, color: C.ink, padding: "12px 14px" }}>Previous imports</div>
        {!imports.length ? <div style={{ ...muted, padding: "0 14px 14px" }}>Nothing imported yet. Your first file will appear here.</div> : (
          <div className="ui-scroll" style={{ overflowX: "auto" }}>
            <table className="ui-table" style={{ minWidth: 560 }}>
              <thead><tr><th>File</th><th>Date</th><th>Status</th><th>Result</th></tr></thead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id}>
                    <td><button type="button" className="ui-btn ui-btn--ghost imx-btn" style={{ fontWeight: 600, textAlign: "left", height: "auto" }} onClick={() => setOpenId(i.id)}>{i.filename || "Import"}</button><div style={muted}>{(i.row_count || 0).toLocaleString("en-GB")} records</div></td>
                    <td style={muted}>{whenText(i.created_at)}</td>
                    <td>{isBusy(i) ? <Chip tone="warn">{importStatusLabel(i.status)} {progressPercent(i)}%</Chip> : i.status === "failed" ? <Chip tone="warn">Failed</Chip> : <Chip tone="good">Done</Chip>}</td>
                    <td><CountChips counts={i.stats?.counts} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {isAdminOperator(operator) ? <MatchingRules toast={toast} /> : null}
    </div>
  );
}

function UploadCard({ toast, onUploaded }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const choose = (f) => {
    setMsg("");
    if (!f) return setFile(null);
    if (f.size > MAX_BYTES) { setFile(null); return setMsg("That file is over 40 MB. Split it and import it in parts."); }
    setFile(f);
  };
  const upload = async () => {
    if (!file || busy) return;
    setBusy(true); setMsg("Uploading. Large files can take a minute.");
    try {
      const imp = await api.uploadRecordImport(file);
      toast?.("Uploaded. Matching has started.");
      setFile(null); setMsg("");
      onUploaded?.(imp);
    } catch (e) { setMsg(e.message || "The upload failed. Nothing was imported."); } finally { setBusy(false); }
  };
  const template = () => saveBlob(new Blob([templateCsv()], { type: "text/csv" }), "import-template.csv");
  return (
    <div className="ui-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ ...text, fontSize: 16, fontWeight: 600, color: C.ink }}>Import your customer records</div>
      <div style={muted}>Upload an export of your own customer records as a CSV file. We match each record to the Companies House register. Anything we are not sure about goes to a person to confirm.</div>
      <div style={muted}>
        <strong>Required columns:</strong> {REQUIRED_COLUMNS.join(", ")}. <strong>Optional:</strong> {OPTIONAL_COLUMNS.join(", ")}. Up to {MAX_ROWS.toLocaleString("en-GB")} rows and 40 MB.
      </div>
      <div className="imx-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); choose(e.dataTransfer?.files?.[0]); }}
        style={{ border: `1.5px dashed ${C.border}`, borderRadius: 10, padding: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <FileUp size={20} color={C.cobalt} aria-hidden="true" />
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <label htmlFor="imx-file" style={label}>CSV file</label>
          <input id="imx-file" type="file" accept=".csv,text/csv" className="ui-input" onChange={(e) => choose(e.target.files?.[0])} />
          {file ? <div style={{ ...muted, marginTop: 4 }}>{file.name}</div> : null}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="ui-btn ui-btn--primary imx-btn" disabled={!file || busy} onClick={upload}>{busy ? "Uploading…" : "Upload and match"}</button>
        <button type="button" className="ui-btn ui-btn--secondary imx-btn" onClick={template}><Download size={14} aria-hidden="true" /> Download a blank template</button>
        <button type="button" className="ui-btn ui-btn--ghost imx-btn" onClick={() => saveBlob(new Blob([templateCsv()], { type: "text/csv" }), "salesforce-accounts-template.csv")}><Download size={14} aria-hidden="true" /> Salesforce template</button>
      </div>
      <div role="status" aria-live="polite" style={{ ...muted, minHeight: 18 }}>{msg}</div>
    </div>
  );
}

function MatchingRules({ toast }) {
  const [vals, setVals] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { api.getMatchSettings().then((s) => setVals({ auto: pct(s.auto), review: pct(s.review) })).catch(() => setVals({ auto: "92", review: "70" })); }, []);
  if (!vals) return null;
  const err = validatePercentThresholds(vals.auto, vals.review);
  const save = async () => {
    if (err || saving) return;
    setSaving(true); setMsg("");
    try {
      const s = await api.saveMatchSettings(percentToFraction(vals.auto), percentToFraction(vals.review));
      setVals({ auto: pct(s.auto), review: pct(s.review) });
      setMsg("Saved. This applies to the next import."); toast?.("Matching rules saved.");
    } catch (e) { setMsg(e.message || "That did not save."); } finally { setSaving(false); }
  };
  return (
    <div className="ui-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ ...text, fontSize: 14, fontWeight: 600, color: C.ink }}>Matching rules</div>
      <div style={muted}>Matches at or above {vals.auto || "–"}% are accepted automatically. Between {vals.review || "–"}% and {vals.auto || "–"}% a person confirms. Below {vals.review || "–"}% is no match. A change applies to the next import, not to ones already done.</div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ width: 150 }}><label htmlFor="imx-auto" style={label}>Accept automatically at (%)</label><input id="imx-auto" className="ui-input" type="number" inputMode="numeric" min={1} max={100} value={vals.auto} onChange={(e) => setVals({ ...vals, auto: e.target.value })} aria-invalid={!!err} aria-describedby="imx-rules-msg" /></div>
        <div style={{ width: 150 }}><label htmlFor="imx-review" style={label}>Send to a person from (%)</label><input id="imx-review" className="ui-input" type="number" inputMode="numeric" min={1} max={99} value={vals.review} onChange={(e) => setVals({ ...vals, review: e.target.value })} aria-invalid={!!err} aria-describedby="imx-rules-msg" /></div>
        <button type="button" className="ui-btn ui-btn--primary imx-btn" disabled={!!err || saving} onClick={save}>{saving ? "Saving…" : "Save rules"}</button>
      </div>
      <div id="imx-rules-msg" role="status" aria-live="polite" style={{ ...text, fontSize: 13, minHeight: 18, color: err ? C.red : C.slate }}>{err || msg}</div>
    </div>
  );
}

function ImportDetail({ id, toast, onBack, onReview, onChanged }) {
  const [imp, setImp] = useState(null);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState(null);
  const [updateFile, setUpdateFile] = useState(false); // the Salesforce update file dialog
  const size = 50;
  const busy = isBusy(imp);

  const loadImport = useCallback(async () => {
    try { setImp(await api.getRecordImport(id)); } catch (e) { toast?.(e.message || "Couldn't load this import."); }
  }, [id, toast]);
  useEffect(() => { loadImport(); }, [loadImport]);
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(loadImport, 2000);
    return () => clearInterval(t);
  }, [busy, loadImport]);
  useEffect(() => { if (imp?.status === "done") onChanged?.(); }, [imp?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const doneNow = imp?.status === "done";
  const started = !!imp && imp.status !== "uploaded";
  useEffect(() => {
    if (!started) return undefined;
    let live = true;
    setRows(null);
    api.getRecordImportRows(id, { status, limit: size, offset: page * size })
      .then((r) => { if (live) setRows(r); })
      .catch((e) => { if (live) { setRows({ total: 0, rows: [] }); toast?.(e.message || "Couldn't load the records."); } });
    return () => { live = false; };
  }, [id, status, page, doneNow, started]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async () => {
    try { saveBlob(await api.downloadRecordDuplicates(id), `duplicates-${(imp?.filename || id).replace(/\.csv$/i, "")}.csv`); toast?.("Duplicates file downloaded."); } catch (e) { toast?.(e.message || "Couldn't download the file."); }
  };

  const downloadSalesforce = async () => {
    try {
      const allRows = await api.getRecordImportRows(id, { limit: 10000 });
      const items = allRows?.rows || [];
      const headers = ["Account ID", "Account Name", "Company Number", "Match Status", "Matched Company Name", "Match Score"];
      const lines = [
        headers.join(","),
        ...items.map((r) => [
          `"${String(r.record_id || "").replace(/"/g, '""')}"`,
          `"${String(r.name || "").replace(/"/g, '""')}"`,
          `"${String(r.match_company_number || "").replace(/"/g, '""')}"`,
          `"${String(statusLabel(r.match_status) || "").replace(/"/g, '""')}"`,
          `"${String(r.match_name || "").replace(/"/g, '""')}"`,
          `"${String(formatScore(r.score) || "").replace(/"/g, '""')}"`,
        ].join(",")),
      ];
      const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
      saveBlob(blob, `salesforce-update-${(imp?.filename || id).replace(/\.csv$/i, "")}.csv`);
      toast?.("Salesforce update file downloaded.");
    } catch (e) {
      toast?.(e.message || "Couldn't download Salesforce file.");
    }
  };

  if (!imp) return <CardsSkeleton count={2} label="Loading this import" />;
  const counts = imp.counts || imp.stats?.counts || {};
  const dup = imp.stats?.duplicates || {};
  const total = rows?.total || 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div><button type="button" className="ui-btn ui-btn--ghost imx-btn" onClick={onBack}><ChevronLeft size={14} aria-hidden="true" /> All imports</button></div>
      <div className="ui-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ ...text, fontSize: 16, fontWeight: 600, color: C.ink, overflowWrap: "anywhere" }}>{imp.filename || "Import"}</div>
        <div style={muted}>{whenText(imp.created_at)} · {(imp.row_count || 0).toLocaleString("en-GB")} records{imp.stats?.skipped_blank ? ` · ${imp.stats.skipped_blank.toLocaleString("en-GB")} blank rows skipped` : ""} · {importStatusLabel(imp.status)}</div>
        {busy ? <div aria-live="polite"><Progress imp={imp} /></div> : null}
        {imp.status === "failed" ? <div role="alert" style={{ ...text, fontSize: 13, color: C.red }}>{imp.error || "This import failed. Nothing was matched."}</div> : null}
        <CountChips counts={counts} />
        {doneNow ? <div style={muted}>Duplicates found: {(dup.exact || 0).toLocaleString("en-GB")} exact, {(dup.near || 0).toLocaleString("en-GB")} near.</div> : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {doneNow && (counts.review || 0) > 0 ? <button type="button" className="ui-btn ui-btn--primary imx-btn" onClick={() => onReview(id)}>Review {(counts.review || 0).toLocaleString("en-GB")} waiting</button> : null}
          {doneNow ? <button type="button" className="ui-btn ui-btn--secondary imx-btn" onClick={download}><Download size={14} aria-hidden="true" /> Duplicates file</button> : null}
          {doneNow ? <button type="button" className="ui-btn ui-btn--secondary imx-btn" onClick={downloadSalesforce}><Download size={14} aria-hidden="true" /> Export for Salesforce</button> : null}
          {doneNow ? <button type="button" className="ui-btn ui-btn--secondary imx-btn" onClick={() => setUpdateFile(true)}><Download size={14} aria-hidden="true" /> Download update file</button> : null}
        </div>
      </div>
      {updateFile ? <SalesforceDialog importId={id} onClose={() => setUpdateFile(false)} /> : null}
      {started ? (
        <div className="ui-card" style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", padding: 14, flexWrap: "wrap" }}>
            <div style={{ ...text, fontSize: 14, fontWeight: 600, color: C.ink, flex: "1 1 120px" }}>Records</div>
            <div style={{ width: 220, maxWidth: "100%" }}>
              <label htmlFor="imx-filter" style={label}>Show</label>
              <select id="imx-filter" className="ui-input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
                {ROW_FILTERS.map((s) => <option key={s} value={s}>{s ? statusLabel(s) : "All records"}</option>)}
              </select>
            </div>
          </div>
          {rows === null ? <div style={{ ...muted, padding: "0 14px 14px" }} role="status">Loading records…</div> : !rows.rows?.length ? <div style={{ ...muted, padding: "0 14px 14px" }}>No records to show here.</div> : (
            <div className="ui-scroll" style={{ overflowX: "auto" }}>
              <table className="ui-table" style={{ minWidth: 720 }}>
                <thead><tr><th>Your record</th><th>Postcode</th><th>Result</th><th>Matched company</th><th style={{ textAlign: "right" }}>Score</th></tr></thead>
                <tbody>
                  {rows.rows.map((r) => (
                    <tr key={r.id}>
                      <td><div style={{ fontWeight: 600 }}>{r.name}</div><div style={muted}>{r.record_id}</div></td>
                      <td>{r.postcode}</td>
                      <td>{statusLabel(r.match_status)}</td>
                      <td>{r.match_name ? <><div>{r.match_name}</div><div style={muted}>{r.match_company_number}</div></> : ""}</td>
                      <td style={{ textAlign: "right" }}>{formatScore(r.score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", padding: 14, flexWrap: "wrap" }}>
            <span style={muted} aria-live="polite">{total ? `${page * size + 1}–${Math.min(total, (page + 1) * size)} of ${total.toLocaleString("en-GB")}` : ""}</span>
            <span style={{ display: "flex", gap: 8 }}>
              <button type="button" className="ui-btn ui-btn--secondary imx-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <button type="button" className="ui-btn ui-btn--secondary imx-btn" disabled={(page + 1) * size >= total} onClick={() => setPage(page + 1)}>Next</button>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------- Review queue ----------

function Field({ name, value }) {
  return value ? <div style={{ marginBottom: 6 }}><div style={{ ...text, fontSize: 11.5, fontWeight: 600, color: C.slate, textTransform: "uppercase", letterSpacing: 0.3 }}>{name}</div><div style={{ ...text, fontSize: 14, color: C.ink, overflowWrap: "anywhere" }}>{value}</div></div> : null;
}

export function RecordCard({ fsb }) {
  return (
    <section className="ui-card" aria-label="Your record" style={{ padding: 14 }}>
      <div style={{ ...text, fontSize: 13, fontWeight: 700, color: C.cobalt, marginBottom: 8 }}>Your record</div>
      <Field name="Name" value={fsb?.name} />
      <Field name="Address" value={fsb?.address} />
      <Field name="Postcode" value={fsb?.postcode} />
      <Field name="Company number given" value={fsb?.company_number_given} />
      <Field name="Phone" value={fsb?.phone} />
      <Field name="Website" value={fsb?.website} />
      <Field name="Record ID" value={fsb?.record_id} />
    </section>
  );
}

export function CandidateCard({ cand }) {
  return (
    <section className="ui-card" aria-label="Company on the register" style={{ padding: 14 }}>
      <div style={{ ...text, fontSize: 13, fontWeight: 700, color: C.teal, marginBottom: 8 }}>Company on the register</div>
      {cand ? (
        <>
          <Field name="Name" value={cand.name} />
          <Field name="Company number" value={cand.company_number} />
          <Field name="Address" value={cand.address} />
          <Field name="Postcode" value={cand.postcode} />
          <Field name="Status" value={cand.status} />
          <Field name="Industry (SIC)" value={cand.sic_text} />
        </>
      ) : <div style={muted}>No company to show.</div>}
    </section>
  );
}

export function ReviewQueue({ toast, importId, onClearImport, onChanged, initialData = null, initialStatus = "open" }) {
  const [status, setStatus] = useState(initialStatus);
  const [data, setData] = useState(initialData);
  const [sel, setSel] = useState(0);
  const [cand, setCand] = useState(0);
  const [pickOpen, setPickOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async (keep) => {
    try {
      const r = await api.getReviewQueue({ importId, status, limit: 200, offset: 0 });
      setData(r);
      setSel((s) => (keep ? Math.min(s, Math.max(0, (r.items || []).length - 1)) : 0));
    } catch (e) { setData({ total: 0, items: [] }); setNote(e.message || "Couldn't load the queue."); }
  }, [importId, status]);
  useEffect(() => {
    if (initialData && status === initialStatus) return;
    setData(null); setNote(""); load(false);
  }, [load, initialData, initialStatus, status]);

  const items = data?.items || [];
  const item = items[sel] || null;
  useEffect(() => { setCand(0); setPickOpen(false); setTyped(""); }, [item?.id]);

  const decide = useCallback(async (decision, number) => {
    if (!item || busy || item.match_status !== "review") return;
    setBusy(true); setNote("");
    try {
      await api.decideReview(item.id, decision, number || "");
      const msg = decision === "reject" ? "Saved as no match." : "Match confirmed.";
      toast?.(msg); setNote(msg);
      setData((d) => reduceQueueAfterDecision(d, item.id));
      setSel((s) => Math.max(0, Math.min(s, items.length - 2)));
      onChanged?.();
    } catch (e) {
      const m = decisionMessage(e);
      toast?.(m); setNote(m);
      if (e?.status === 409 || e?.status === 404) load(true);
    } finally { setBusy(false); }
  }, [item, busy, items.length, toast, load, onChanged]);

  const yes = useCallback(() => { const c = item?.candidates?.[cand]; if (cand > 0 && c) decide("pick", c.company_number); else decide("accept"); }, [item, cand, decide]);
  useEffect(() => {
    const onKey = (e) => {
      if (shouldIgnoreReviewKey(e)) return;
      if (e.key === "y" || e.key === "Y") { e.preventDefault(); yes(); }
      if (e.key === "n" || e.key === "N") { e.preventDefault(); decide("reject"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [yes, decide]);

  const shown = useMemo(() => (item?.candidates || [])[cand] || item?.candidate || null, [item, cand]);
  const pickOther = () => { const n = typed.trim(); if (n) decide("pick", n); };

  if (data === null) return <CardsSkeleton count={2} label="Loading the review queue" />;
  const open = item?.match_status === "review";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ width: 200, maxWidth: "100%" }}>
          <label htmlFor="imx-q-status" style={label}>Show</label>
          <select id="imx-q-status" className="ui-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">Waiting for a decision</option>
            <option value="decided">Already decided</option>
            <option value="all">Both</option>
          </select>
        </div>
        {importId ? <button type="button" className="ui-btn ui-btn--secondary imx-btn" onClick={onClearImport}>Showing one import. Show all</button> : null}
        <div style={{ ...muted, marginLeft: "auto" }} aria-live="polite">{status === "open" ? `${(data.total || 0).toLocaleString("en-GB")} to review` : `${(data.total || 0).toLocaleString("en-GB")} records`}</div>
      </div>
      <div role="status" aria-live="polite" style={{ ...text, fontSize: 13, color: C.slate, minHeight: 18 }}>{note}</div>
      {!items.length ? (
        <div className="ui-card" style={{ padding: "36px 20px", textAlign: "center" }}>
          <div style={{ ...text, fontSize: 16, fontWeight: 600, color: C.ink }}>{status === "open" ? "Nothing waiting for review" : "No records here"}</div>
          <div style={{ ...muted, marginTop: 4 }}>{status === "open" ? "Records we are not sure about appear here after an import." : "Decisions appear here once someone has made them."}</div>
        </div>
      ) : (
        <div className="imx-rq">
          <div className="imx-qlist ui-card" role="list" aria-label="Records to review" style={{ padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            {items.map((it, i) => (
              <button key={it.id} role="listitem" type="button" className="imx-pick" aria-current={i === sel ? "true" : undefined} style={i === sel ? { borderColor: C.cobalt, background: C.cobaltSoft } : undefined} onClick={() => setSel(i)}>
                <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{it.fsb?.name}</div>
                <div style={{ fontSize: 12, color: C.slate }}>{formatScore(it.score)}{it.match_status !== "review" ? ` · ${statusLabel(it.match_status)}` : ""}</div>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            <div className="imx-pair">
              <RecordCard fsb={item.fsb} />
              <CandidateCard cand={shown} />
            </div>
            <div className="ui-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ ...text, fontSize: 14, color: C.ink }}><strong>Confidence {formatScore(item.candidates?.[cand]?.score ?? item.score)}.</strong> {item.reason}</div>
              {item.candidates?.length > 1 && open ? (
                <div role="group" aria-label="Other possible companies" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {item.candidates.map((c, i) => (
                    <button key={c.company_number} type="button" className="ui-btn ui-btn--secondary imx-btn" aria-pressed={i === cand} style={i === cand ? { borderColor: C.cobalt, background: C.cobaltSoft } : undefined} onClick={() => setCand(i)}>
                      {i + 1}. {c.name || c.company_number} ({formatScore(c.score)})
                    </button>
                  ))}
                </div>
              ) : null}
              {open ? (
                <>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="ui-btn ui-btn--primary imx-btn" disabled={busy || !shown} onClick={yes}><Check size={16} aria-hidden="true" /> Yes, same company</button>
                    <button type="button" className="ui-btn ui-btn--secondary imx-btn" disabled={busy} onClick={() => decide("reject")}><X size={16} aria-hidden="true" /> No match</button>
                    <button type="button" className="ui-btn ui-btn--ghost imx-btn" aria-expanded={pickOpen} onClick={() => setPickOpen(!pickOpen)}>Pick another</button>
                  </div>
                  <div style={{ ...muted, fontSize: 12 }}>Keyboard: Y for yes, N for no match.</div>
                  {pickOpen ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 200px" }}>
                        <label htmlFor="imx-typed" style={label}>Company number</label>
                        <input id="imx-typed" className="ui-input" value={typed} maxLength={12} placeholder="For example 01234567" onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") pickOther(); }} />
                      </div>
                      <button type="button" className="ui-btn ui-btn--primary imx-btn" disabled={busy || !typed.trim()} onClick={pickOther}>Use this company</button>
                    </div>
                  ) : null}
                </>
              ) : (
                <div style={muted}>{statusLabel(item.match_status)}{item.decided_by ? ` by ${item.decided_by}` : ""}{item.decided_at ? `, ${whenText(item.decided_at)}` : ""}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
