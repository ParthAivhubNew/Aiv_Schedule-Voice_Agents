import React, { useCallback, useEffect, useState } from "react";
import { CalendarClock, Download } from "lucide-react";
import { CardsSkeleton } from "../../app/Loader";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";
import { kindChips, periodLabel, saveBlob, validateRange } from "./importMatchLogic";
import { Chip } from "./ImportMatch";

// Monthly changes: one card a month saying what changed at the companies you follow.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };
const label = { ...text, fontSize: 12, fontWeight: 600, color: C.slate, display: "block", marginBottom: 4 };
const css = `.mch .ui-input{width:100%;box-sizing:border-box}.mch .mch-btn{min-height:44px}`;

const today = () => new Date().toISOString().slice(0, 10);

export function ReportCard({ report, onDownload, busy }) {
  const s = report.summary || {};
  const chips = kindChips(s.by_kind);
  const title = report.period ? periodLabel(report.period) : `${s.start || ""} to ${s.end || ""}`;
  return (
    <section className="ui-card" aria-label={`Changes for ${title}`} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={{ ...text, fontSize: 16, fontWeight: 600, color: C.ink }}>{title}</div>
        {s.start && s.end ? <div style={muted}>{s.start} to {s.end}</div> : null}
      </div>
      {s.text ? <div style={{ ...text, fontSize: 14, color: C.ink, lineHeight: 1.5 }}>{s.text}</div> : null}
      <div style={{ ...muted, color: C.ink }}>{(s.companies || 0).toLocaleString("en-GB")} {s.companies === 1 ? "company" : "companies"} · {(s.total || 0).toLocaleString("en-GB")} {s.total === 1 ? "change" : "changes"}</div>
      {chips.length ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{chips.map((c) => <Chip key={c.kind} tone="plain">{c.label}: {c.count.toLocaleString("en-GB")}</Chip>)}</div> : null}
      <div><button type="button" className="ui-btn ui-btn--secondary mch-btn" disabled={busy} onClick={() => onDownload(report)}><Download size={14} aria-hidden="true" /> Download details</button></div>
    </section>
  );
}

export function MonthlyChangesView({ toast }) {
  const [reports, setReports] = useState(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState(today());
  const [running, setRunning] = useState(false);
  const [downloading, setDownloading] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    try { setReports((await api.listChangeReports()).reports || []); } catch (e) { setReports([]); toast?.(e.message || "Couldn't load your reports."); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const err = start && end ? validateRange(start, end) : "";
  const run = async () => {
    const bad = validateRange(start, end);
    if (bad) { setMsg(bad); return; }
    setRunning(true); setMsg("Building the report. This can take a minute.");
    try {
      const r = await api.runChangeReport(start, end);
      setMsg(r?.created === false ? "That period already had a report, shown below." : "Report ready.");
      toast?.("Report ready.");
      await load();
    } catch (e) { setMsg(e.message || "The report could not be built."); } finally { setRunning(false); }
  };
  const download = async (r) => {
    setDownloading(r.id);
    try { saveBlob(await api.downloadChangeReport(r.id), `changes-${r.period || `${r.summary?.start}-${r.summary?.end}`}.csv`); toast?.("Report downloaded."); } catch (e) { toast?.(e.message || "Couldn't download the report."); } finally { setDownloading(""); }
  };

  if (reports === null) return <CardsSkeleton count={3} label="Loading your reports" />;
  return (
    <div className="mch" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{css}</style>
      {!reports.length ? (
        <div className="ui-card" style={{ padding: "36px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <CalendarClock size={28} color="var(--ui-accent, #3457D5)" aria-hidden="true" />
          <div style={{ ...text, fontSize: 16, fontWeight: 600, color: C.ink }}>No reports yet</div>
          <div style={{ ...muted, maxWidth: 460 }}>A report appears after your first import and the first month end. It lists what changed at the companies you follow, such as a new status, name or address, or a director joining or leaving. The live register feed supplies the changes.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))" }}>
          {reports.map((r) => <ReportCard key={r.id} report={r} onDownload={download} busy={downloading === r.id} />)}
        </div>
      )}
      <div className="ui-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ ...text, fontSize: 14, fontWeight: 600, color: C.ink }}>Run for a custom period</div>
        <div style={muted}>Pick the first and last day, both included. The longest period is 366 days.</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ width: 170, maxWidth: "100%" }}><label htmlFor="mch-start" style={label}>From</label><input id="mch-start" type="date" className="ui-input" value={start} max={end || undefined} onChange={(e) => { setStart(e.target.value); setMsg(""); }} aria-describedby="mch-msg" /></div>
          <div style={{ width: 170, maxWidth: "100%" }}><label htmlFor="mch-end" style={label}>To</label><input id="mch-end" type="date" className="ui-input" value={end} min={start || undefined} onChange={(e) => { setEnd(e.target.value); setMsg(""); }} aria-describedby="mch-msg" /></div>
          <button type="button" className="ui-btn ui-btn--primary mch-btn" disabled={running || !start || !end || !!err} onClick={run}>{running ? "Building…" : "Run report"}</button>
        </div>
        <div id="mch-msg" role="status" aria-live="polite" style={{ ...text, fontSize: 13, minHeight: 18, color: err ? C.red : C.slate }}>{err || msg}</div>
      </div>
    </div>
  );
}
