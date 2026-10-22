import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Eye, FileText, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY, HUB_PAPER } from "../../tokens";
import { useEscapeLayer } from "./escapeLayers";

// Results reports for clients and managers: the Insights numbers as an email and a page that opens
// with a link (no sign-in). Sent on demand, every Monday or on the 1st of each month.

const page = { flex: 1, overflowY: "auto", padding: "22px 28px 48px", background: HUB_PAPER, fontFamily: FONT_BODY };
const card = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 };
const muted = { fontSize: 12.5, color: C.slate, lineHeight: 1.5 };
const btn = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 8,
  border: `1px solid ${C.border}`, background: "#fff", color: C.ink, fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: FONT_BODY,
};
const primary = { ...btn, background: C.ink, color: "#fff", borderColor: C.ink };
const field = { width: "100%", height: 34, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 10px", fontFamily: FONT_BODY, fontSize: 13, boxSizing: "border-box", background: "#fff", marginTop: 4 };
const label = { display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginTop: 12 };
const CHANNELS = [["linkedin", "LinkedIn"], ["x", "X"], ["facebook", "Facebook"], ["instagram", "Instagram"], ["threads", "Threads"], ["reddit", "Reddit"]];
const FREQ = { none: "Sent when you press Send", weekly: "Every Monday at 08:00", monthly: "On the 1st of each month at 08:00" };
const EMPTY = { name: "", days: 30, channels: [], recipients: "", frequency: "none", intro: "" };

function ReportForm({ initial, onSaved, onCancel, showToast }) {
  const [f, setF] = useState(() => ({ ...EMPTY, ...initial, recipients: (initial && initial.recipients ? initial.recipients.join(", ") : "") }));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { focusRecipients, ...rest } = f;
    const body = { ...rest, recipients: f.recipients.split(/[,;\s]+/).filter(Boolean) };
    try {
      const res = initial && initial.id ? await api.saveReport(initial.id, body) : await api.createReport(body);
      onSaved(res.report);
    } catch (err) {
      showToast(err.message || "Could not save the report.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} style={{ ...card, borderColor: C.teal }} aria-label={initial && initial.id ? "Edit report" : "New report"}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15 }}>{initial && initial.id ? "Edit report" : "New report"}</div>
      <label style={label}>Name<input style={field} value={f.name} maxLength={120} required placeholder="e.g. Acme Ltd, monthly" onChange={(e) => set("name", e.target.value)} /></label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0 16px" }}>
        <label style={label}>Period
          <select style={field} value={f.days} onChange={(e) => set("days", Number(e.target.value))}>
            <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
        </label>
        <label style={label}>Send it
          <select style={field} value={f.frequency} onChange={(e) => set("frequency", e.target.value)}>
            <option value="none">Only when I press Send</option><option value="weekly">Every Monday</option><option value="monthly">On the 1st of each month</option>
          </select>
        </label>
      </div>
      <fieldset style={{ border: "none", padding: 0, margin: "12px 0 0" }}>
        <legend style={{ fontSize: 11.5, fontWeight: 700, color: C.slate }}>Channels (none ticked: all of them)</legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 6 }}>
          {CHANNELS.map(([id, name]) => (
            <label key={id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={f.channels.includes(id)}
                onChange={(e) => set("channels", e.target.checked ? [...f.channels, id] : f.channels.filter((c) => c !== id))} /> {name}
            </label>
          ))}
        </div>
      </fieldset>
      <label style={label}>Who gets it (email addresses, separated by commas)
        <input style={field} autoFocus={!!(initial && initial.focusRecipients)} type="text" inputMode="email" value={f.recipients} placeholder="client@example.com, manager@example.com" onChange={(e) => set("recipients", e.target.value)} />
      </label>
      <label style={label}>Note at the top (optional)
        <textarea style={{ ...field, height: 72, padding: 8, resize: "vertical" }} value={f.intro} maxLength={2000}
          placeholder="e.g. Reach grew after the product launch. Next month we focus on LinkedIn." onChange={(e) => set("intro", e.target.value)} />
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button type="submit" style={primary} disabled={busy}>{busy ? "Saving…" : "Save report"}</button>
        <button type="button" style={btn} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function Preview({ data, onClose }) {
  useEscapeLayer(!!data, 3, onClose);
  if (!data || typeof document === "undefined") return null;
  return createPortal(
    <div role="presentation" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(18,20,28,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-label="Report preview" onClick={(e) => e.stopPropagation()}
        style={{ width: "min(860px, 100%)", height: "min(860px, 100%)", background: "#fff", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: FONT_BODY }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700, flex: 1, minWidth: 0 }}>Preview · {data.period}</div>
          <a href={data.link} target="_blank" rel="noreferrer" className="ui-link" style={{ fontSize: 12.5, fontWeight: 700 }}>Open the shareable page</a>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: "none", background: "none", cursor: "pointer", color: C.slate, padding: 4 }}><X size={16} /></button>
        </div>
        <iframe title="Report preview" srcDoc={data.html} sandbox="allow-scripts allow-popups allow-modals" style={{ flex: 1, border: "none", width: "100%" }} />
      </div>
    </div>,
    document.body,
  );
}

export function ReportsPage({ showToast, embedded = false }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState(null);
  const [links, setLinks] = useState({});
  const [runs, setRuns] = useState([]);
  const [sharing, setSharing] = useState(null); // { id, to }
  const load = useCallback(() => {
    api.listReports().then((d) => { setData(d); setState("ok"); }).catch(() => setState("error"));
    api.getReportHistory().then((d) => setRuns(d.runs || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (id, what, fn) => {
    setBusy(id + what);
    try {
      await fn();
    } catch (e) {
      showToast(e.message || "That did not work. Try again.");
    } finally {
      setBusy("");
    }
  };
  const openPreview = (r) => act(r.id, "preview", async () => {
    const p = await api.previewReport(r.id);
    setLinks((m) => ({ ...m, [r.id]: p.link }));
    setPreview(p);
  });
  const copyLink = (r) => act(r.id, "link", async () => {
    const link = links[r.id] || (await api.previewReport(r.id)).link;
    setLinks((m) => ({ ...m, [r.id]: link }));
    await navigator.clipboard.writeText(link);
    const until = new Date(Date.now() + 120 * 86400000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    showToast(`Link copied. Anyone with it can view the report until ${until}.`);
  });
  const openShare = (r) => setSharing({ id: r.id, to: (r.recipients || []).join(", ") });
  const share = (r) => act(r.id, "send", async () => {
    const to = sharing.to.split(/[,;\s]+/).filter(Boolean);
    if (!to.length) throw new Error("Type at least one email address.");
    const res = await api.sendReport(r.id, to);
    showToast(`Sent to ${res.sent} ${res.sent === 1 ? "person" : "people"}.`);
    setSharing(null);
    load();
  });
  const remove = (r) => {
    if (!window.confirm(`Delete the report “${r.name}”? Its link stops working.`)) return;
    act(r.id, "delete", async () => { await api.deleteReport(r.id); load(); });
  };
  const mailOff = data && !data.emailReady;
  const stamp = (iso, opts) => new Date(iso).toLocaleString("en-GB", opts);

  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: embedded ? 12 : 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {embedded ? <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, flex: "1 1 auto" }}>Reports</div> : null}
        {!embedded ? (
          <div style={{ ...muted, flex: "1 1 320px" }}>
            Share how your social media is doing with a client or your manager: reach, views, engagements, link clicks,
            best posts and followers, from the same numbers as Insights.
          </div>
        ) : null}
        {!editing ? <button type="button" style={primary} onClick={() => setEditing({})}><Plus size={14} /> New report</button> : null}
      </div>
      {embedded ? <div style={{ ...muted, marginTop: -6 }}>Share these numbers with a client or your manager. Everything sent is listed below.</div> : null}
      {mailOff ? (
        <div style={{ ...card, background: C.amberSoft || "#FCEFDA", borderColor: C.amber, fontSize: 12.5 }}>
          Email sending is not set up for your account yet, so reports cannot be emailed. You can still share each report’s link.
        </div>
      ) : null}
      {editing ? (
        <ReportForm initial={editing} showToast={showToast} onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); showToast("Report saved."); }} />
      ) : null}
      {state === "loading" ? <div style={muted}>Loading reports…</div> : state === "error" ? (
        <div style={card}>Could not load reports. <button type="button" style={btn} onClick={load}>Try again</button></div>
      ) : !data.reports.length && !editing ? (
        <div style={{ ...card, textAlign: "center", padding: 28, borderStyle: "dashed" }}>
          <FileText size={22} color={C.slate} />
          <div style={{ fontWeight: 700, marginTop: 8 }}>No reports yet</div>
          <div style={{ ...muted, marginTop: 4 }}>Make one per client, then share it now or every month.</div>
        </div>
      ) : data.reports.map((r) => (
        <section key={r.id} style={card} aria-label={r.name}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, overflowWrap: "anywhere" }}>{r.name}</div>
          <div style={{ ...muted, marginTop: 2 }}>
            Last {r.days} days · {r.channels.length ? r.channels.map((c) => (CHANNELS.find(([id]) => id === c) || [c, c])[1]).join(", ") : "All channels"}
            {" · "}{FREQ[r.frequency]}
          </div>
          <div style={{ ...muted, fontSize: 12 }}>
            {r.recipients.length ? `Saved recipients: ${r.recipients.join(", ")}` : "No saved recipients"}
            {r.lastSentAt ? ` · Last sent ${stamp(r.lastSentAt, { day: "numeric", month: "short", year: "numeric" })}` : ""}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
            <button type="button" style={primary} disabled={mailOff} aria-expanded={!!sharing && sharing.id === r.id}
              title={mailOff ? "Email sending is not set up for your account yet" : "Email this report to somebody now"}
              onClick={() => (sharing && sharing.id === r.id ? setSharing(null) : openShare(r))}>
              <Send size={13} /> Share to somebody
            </button>
            <button type="button" style={btn} disabled={busy === r.id + "preview"} onClick={() => openPreview(r)}><Eye size={13} /> {busy === r.id + "preview" ? "Loading…" : "Preview"}</button>
            <button type="button" style={btn} disabled={busy === r.id + "link"} onClick={() => copyLink(r)} title="Copy a link that shows the latest numbers. It works for 120 days"><Copy size={13} /> Copy link</button>
            <button type="button" style={btn} onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`}><Pencil size={13} /></button>
            <button type="button" style={{ ...btn, color: "#B42318", borderColor: "#F3D1CD" }} onClick={() => remove(r)} aria-label={`Delete ${r.name}`}><Trash2 size={13} /></button>
          </div>
          {sharing && sharing.id === r.id ? (
            <div style={{ marginTop: 10, padding: 10, background: HUB_PAPER, borderRadius: 10 }}>
              <label style={{ ...label, marginTop: 0 }}>Send it to (email addresses, separated by commas)
                <input style={field} autoFocus type="text" inputMode="email" value={sharing.to} placeholder="client@example.com, manager@example.com"
                  onChange={(e) => setSharing({ ...sharing, to: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); share(r); } }} />
              </label>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button type="button" style={primary} disabled={busy === r.id + "send"} onClick={() => share(r)}>{busy === r.id + "send" ? "Sending…" : "Send now"}</button>
                <button type="button" style={btn} onClick={() => setSharing(null)}>Cancel</button>
              </div>
            </div>
          ) : null}
        </section>
      ))}
      <section style={card} aria-labelledby="rep-hist">
        <div id="rep-hist" style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Sent so far</div>
        {!runs.length ? <div style={muted}>Nothing sent yet. When you share a report, or a scheduled one goes out, it is listed here.</div> : (
          <div style={{ maxHeight: embedded ? 360 : "none", overflowY: "auto" }}>
            {runs.map((h) => (
              <div key={h.id} style={{ padding: "8px 0", borderTop: `1px solid ${C.border}`, fontSize: 12.5 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
                  <b style={{ color: C.ink, overflowWrap: "anywhere" }}>{h.reportName || "Report"}</b>
                  <span style={{ color: C.slate }}>{stamp(h.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <div style={{ color: C.slate, overflowWrap: "anywhere" }}>{h.trigger === "schedule" ? "Scheduled · " : ""}To {h.recipients.join(", ")}</div>
                <div style={{ color: h.sent ? C.teal : "#B42318", fontWeight: 700 }}>
                  {h.sent ? `Sent to ${h.sent}${h.failed ? `, ${h.failed} failed` : ""}` : (h.error || "Not sent")}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );

  return (
    <>
      {embedded ? body : (
        <div style={page}>
          <div style={{ maxWidth: 980, margin: "0 auto" }}>{body}</div>
        </div>
      )}
      <Preview data={preview} onClose={() => setPreview(null)} />
    </>
  );
}
