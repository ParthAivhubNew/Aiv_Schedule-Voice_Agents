import React, { useRef, useState } from "react";
import { AlertTriangle, Check, Download, FileSpreadsheet, Info, Upload } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY, HUB_PAPER } from "../../tokens";
import { formatOrgTime, useOrg } from "../../org/orgSettings";

// Bulk import: many posts from one CSV or Excel file. The file is checked first and every problem
// is shown on its row; only rows that pass are imported, and they go through approval as usual.

const page = { flex: 1, overflowY: "auto", padding: "22px 28px 48px", background: HUB_PAPER, fontFamily: FONT_BODY };
const card = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 };
const muted = { fontSize: 12.5, color: C.slate, lineHeight: 1.5 };
const btn = {
  display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 12px", borderRadius: 8,
  border: `1px solid ${C.border}`, background: "#fff", color: C.ink, fontWeight: 600, fontSize: 12.5, cursor: "pointer", fontFamily: FONT_BODY,
};
const primary = { ...btn, background: C.ink, color: "#fff", borderColor: C.ink };
const TITLES = { linkedin: "LinkedIn", x: "X", facebook: "Facebook", instagram: "Instagram", threads: "Threads", reddit: "Reddit" };

const COLUMNS = [
  ["date", "Publish date, e.g. 2026-11-03 or 03/11/2026 (day first)."],
  ["time", "e.g. 09:30 or 9:30 PM, in your account time zone. Empty: 09:00."],
  ["channels", "One or more of linkedin, x, facebook, instagram, threads, reddit."],
  ["text", "The post. Leave empty and fill topic to have the AI write it."],
  ["topic", "What the AI should write about (1 post credit each)."],
  ["title", "Headline. Needed for Reddit, where it is the post title."],
  ["media", "Links to pictures or videos, separated by commas. Kept in your media library."],
  ["first comment", "Posted under the post right after it goes live."],
  ["alt text", "Describes the first picture for screen readers."],
  ["subreddit", "For Reddit rows: the community to post in."],
];

function dayLabel(iso) {
  if (!iso) return "";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export function ImportPage({ showToast, onOpenApprovals, onOpenCalendar }) {
  const org = useOrg();
  const fileRef = useRef(null);
  const [checked, setChecked] = useState(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState("");
  const [approve, setApprove] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [done, setDone] = useState(null);
  const [over, setOver] = useState(false);

  const download = async () => {
    try {
      const t = await api.getImportTemplate();
      const url = URL.createObjectURL(new Blob([t.csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = t.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast(e.message || "Could not download the template.");
    }
  };

  const check = async (file) => {
    if (!file) return;
    setBusy("check");
    setDone(null);
    setFileName(file.name);
    try {
      setChecked(await api.checkImport(file));
    } catch (e) {
      setChecked(null);
      showToast(e.message || "Could not read that file.");
    } finally {
      setBusy("");
    }
  };

  const commit = async () => {
    const ready = checked.rows.filter((r) => !r.issues.length);
    setBusy("import");
    try {
      const res = await api.commitImport(ready, approve);
      setDone(res);
      setChecked(null);
    } catch (e) {
      showToast(e.message || "The import did not finish. Nothing was saved.");
    } finally {
      setBusy("");
    }
  };

  const s = checked && checked.summary;
  const rows = checked ? checked.rows.filter((r) => !onlyProblems || r.issues.length) : [];
  return (
    <div style={page}>
      <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        {done ? (
          <section style={{ ...card, borderColor: C.teal }} aria-live="polite">
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15 }}>
              <Check size={18} color={C.teal} /> Imported {done.created} post{done.created === 1 ? "" : "s"}
            </div>
            <div style={{ ...muted, marginTop: 6 }}>
              {done.aiWriting ? `The AI is writing ${done.aiWriting} of them; they wait for approval when ready. ` : ""}
              {approve ? "Posts with text are approved and go out at their time." : "They are waiting for approval."}
            </div>
            {done.failed && done.failed.length ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>Not imported</div>
                {done.failed.map((f) => <div key={f.row} style={{ ...muted, fontSize: 12 }}>Row {f.row}: {f.error}</div>)}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" style={primary} onClick={onOpenApprovals}>Open approvals</button>
              <button type="button" style={btn} onClick={onOpenCalendar}>Open calendar</button>
              <button type="button" style={btn} onClick={() => setDone(null)}>Import another file</button>
            </div>
          </section>
        ) : null}

        {!checked ? (
          <section style={card} aria-labelledby="imp-h">
            <h2 id="imp-h" style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, margin: 0 }}>Import posts from a file</h2>
            <p style={{ ...muted, margin: "6px 0 14px" }}>
              One row per post: a date, the channels and the text. A row with several channels becomes one post per channel.
              Nothing is saved until you have checked the rows.
            </p>
            <div
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); check(e.dataTransfer.files[0]); }}
              style={{ border: `2px dashed ${over ? C.teal : C.border}`, borderRadius: 12, padding: 24, textAlign: "center", background: over ? (C.tealSoft || "#E4F5F2") : HUB_PAPER }}
            >
              <FileSpreadsheet size={26} color={C.slate} />
              <div style={{ fontWeight: 700, marginTop: 6 }}>Drop a .csv or .xlsx file here</div>
              <div style={{ ...muted, marginTop: 2 }}>Up to 500 rows and 5 MB.</div>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xlsm,text/csv" style={{ display: "none" }}
                onChange={(e) => { check(e.target.files[0]); e.target.value = ""; }} />
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
                <button type="button" style={primary} disabled={busy === "check"} onClick={() => fileRef.current && fileRef.current.click()}>
                  <Upload size={14} /> {busy === "check" ? "Checking…" : "Choose a file"}
                </button>
                <button type="button" style={btn} onClick={download}><Download size={14} /> Download the template</button>
              </div>
            </div>
            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>What goes in each column</summary>
              <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                {COLUMNS.map(([k, v], i) => (
                  <li key={k} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 150px) minmax(0, 1fr)", gap: "2px 14px", alignItems: "baseline", padding: "9px 12px", borderTop: i ? `1px solid ${C.border}` : "none", background: i % 2 ? "#FAFAF8" : "#fff" }}>
                    <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, fontWeight: 700, color: C.ink }}>{k}</span>
                    <span style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.45 }}>{v}</span>
                  </li>
                ))}
              </ul>
              <div style={{ ...muted, fontSize: 12, marginTop: 8 }}>Only <b style={{ color: C.ink }}>channels</b> and either <b style={{ color: C.ink }}>text</b> or <b style={{ color: C.ink }}>topic</b> are needed. The rest are optional.</div>
            </details>
          </section>
        ) : (
          <>
            <section style={{ ...card, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }} aria-live="polite">
              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis" }}>{fileName}</div>
                <div style={{ ...muted, marginTop: 2 }}>
                  {s.rows} row{s.rows === 1 ? "" : "s"}: <b style={{ color: C.ink }}>{s.ready} ready</b> ({s.posts} post{s.posts === 1 ? "" : "s"}
                  {s.aiWritten ? `, ${s.aiWritten} written by the AI` : ""}){s.problems ? <>, <b style={{ color: C.red }}>{s.problems} with problems</b> (not imported)</> : ""}.
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
                <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show problems only
              </label>
            </section>
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }} aria-label="Rows in the file">
              {rows.map((r) => (
                <li key={r.row} style={{ ...card, padding: "10px 14px", borderColor: r.issues.length ? C.red : C.border }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 10px" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.slate }}>Row {r.row}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.date ? dayLabel(r.date) + (r.time ? " · " + formatOrgTime(r.time, org.timeFormat) : "") : "No date"}</span>
                    <span style={{ fontSize: 12, color: C.slate }}>{r.channels.map((c) => TITLES[c] || c).join(", ")}</span>
                    {r.media.length ? <span style={{ fontSize: 12, color: C.slate }}>{r.media.length} file{r.media.length === 1 ? "" : "s"}</span> : null}
                    <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: r.issues.length ? C.red : C.teal }}>{r.issues.length ? "Not imported" : "Ready"}</span>
                  </div>
                  {r.title ? <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginTop: 4 }}>{r.title}</div> : null}
                  <div style={{ fontSize: 13, color: C.ink, marginTop: r.title ? 2 : 4, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {r.text || (r.topic ? `The AI writes about: ${r.topic}` : "")}
                  </div>
                  {r.issues.map((i) => (
                    <div key={i} style={{ display: "flex", gap: 6, fontSize: 12, color: C.red, marginTop: 4 }}><AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} /> {i}</div>
                  ))}
                  {r.notes.map((n) => (
                    <div key={n} style={{ display: "flex", gap: 6, fontSize: 12, color: C.slate, marginTop: 4 }}><Info size={13} style={{ flexShrink: 0, marginTop: 2 }} /> {n}</div>
                  ))}
                </li>
              ))}
              {!rows.length ? <li style={{ ...muted, padding: 12 }}>No rows with problems.</li> : null}
            </ol>
            <section style={{ ...card, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", position: "sticky", bottom: 0 }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, cursor: "pointer", flex: "1 1 280px" }}>
                <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} style={{ marginTop: 3 }} />
                <span>Approve them now<div style={{ ...muted, fontSize: 12 }}>Off: they wait in Approvals like other posts. Posts the AI writes always wait for approval.</div></span>
              </label>
              <button type="button" style={btn} onClick={() => setChecked(null)}>Choose another file</button>
              <button type="button" style={primary} disabled={!s.ready || busy === "import"} onClick={commit}>
                <Check size={14} /> {busy === "import" ? "Importing…" : `Import ${s.posts} post${s.posts === 1 ? "" : "s"}`}
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
