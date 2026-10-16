import React, { useCallback, useEffect, useState } from "react";
import { Ban, Database, Lock, Plus, Repeat, Trash2, Workflow, X } from "lucide-react";
import { api, apiRequest } from "../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY } from "../tokens";
import { openPlans, useConnections, PLUGIN_NAME } from "../hooks/useConnections";

// Settings -> Connections: what the three plugins do for you on their own, the rules you add, the one
// do-not-contact list, merging duplicates, and the contact export. Everything here is opt-in unless it says otherwise.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.5 };
const heading = { ...text, fontSize: 14, fontWeight: 600, color: C.ink };

// key, label, help, the plugins it needs, and what else it takes
const SWITCHES = [
  { group: "After a call", items: [
    { key: "update_lead_after_call", label: "Update the company after every call", help: "Its stage, last call and timeline change by themselves.", needs: ["leads", "voice"] },
    { key: "auto_apply_suggestions", label: "Use what a call finds without asking", help: "An email, a contact or a best time heard on the call is saved straight away. Off: you accept each one.", needs: ["leads", "voice"] },
    { key: "interested_email", label: "Email them after they ask for a call back", help: "Sends the message below from your mailbox.", needs: ["leads", "voice"], template: "interested_template" },
    { key: "no_answer_email", label: "Email them after missed calls", help: "A short “sorry I missed you” once they haven't picked up.", needs: ["leads", "voice"], number: { key: "no_answer_after", label: "after", suffix: "missed calls", min: 1, max: 10 } },
  ] },
  { group: "Meetings", items: [
    { key: "stop_on_booking", label: "Stop the emails and calls when they book", help: "Everything still planned for them is cancelled.", needs: ["leads", "voice"] },
    { key: "booking_reminders", label: "Remind people before a meeting", help: "An email 24 hours and 1 hour before.", needs: ["voice"] },
    { key: "reminder_call", label: "Ring to confirm an hour before", help: "Your AI caller checks they are still coming and can move the meeting.", needs: ["leads", "voice"] },
    { key: "no_show_email", label: "Email people who didn't attend", help: "Sent when you mark a meeting as not attended, with a link to pick a new time.", needs: ["voice"] },
    { key: "no_show_call", label: "Ring people who didn't attend", help: "Offers a new time.", needs: ["leads", "voice"] },
  ] },
  { group: "Finding who to call", items: [
    { key: "warm_lead_prompt", label: "Show who is warm", help: "Counts email opens and post engagement, and suggests a call. Switching this off also stops the open count in your emails.", needs: ["leads"], number: { key: "warm_opens", label: "after", suffix: "opens", min: 1, max: 10 } },
    { key: "weekly_summary", label: "Email me a summary on Mondays", help: "Calls, emails, meetings and posts from the last seven days, for the plugins you have.", needs: [] },
  ] },
];

// An on/off switch that a screen reader and the keyboard can use.
function Toggle({ on, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      style={{ all: "unset", cursor: disabled ? "not-allowed" : "pointer", flexShrink: 0, width: 40, height: 22, borderRadius: 999, boxSizing: "border-box", position: "relative", opacity: disabled ? 0.5 : 1,
        background: on ? C.cobalt : C.border, transition: "background 0.15s" }}>
      <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: 999, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)", transition: "left 0.15s" }} />
    </button>
  );
}

// Which plugins a switch needs, as small tags.
function Needs({ needs, plugins }) {
  if (!needs.length) return null;
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {needs.map((p) => (
        <span key={p} style={{ ...text, fontSize: 10.5, fontWeight: 600, padding: "1px 7px", borderRadius: 999, border: `1px solid ${plugins[p] ? C.border : "#F5C28A"}`, background: plugins[p] ? C.paperSoft : "#FFF6EA", color: plugins[p] ? C.slate : "#9A5B0C" }}>{PLUGIN_NAME[p]}</span>
      ))}
    </span>
  );
}

function Row({ s, rules, plugins, onChange, busy, first }) {
  const missing = s.needs.filter((p) => !plugins[p]);
  const on = Boolean(rules[s.key]);
  return (
    <div style={{ padding: "12px 16px", borderTop: first ? "none" : `1px solid ${C.borderLight}`, opacity: missing.length ? 0.75 : 1 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink }}>{s.label}</div>
          <div style={{ ...muted, margin: "2px 0 6px" }}>{s.help}</div>
          <Needs needs={s.needs} plugins={plugins} />
        </div>
        {missing.length ? (
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ flexShrink: 0 }} onClick={() => openPlans(missing[0])}><Lock size={12} /> Add {PLUGIN_NAME[missing[0]]}</button>
        ) : (
          <Toggle on={on} label={s.label} disabled={busy} onChange={(v) => onChange({ [s.key]: v })} />
        )}
      </div>
      {!missing.length && on && s.number ? (
        <label style={{ ...muted, display: "flex", gap: 6, alignItems: "center", marginTop: 10 }}>{s.number.label}
          <input className="ui-input" type="number" min={s.number.min} max={s.number.max} style={{ width: 70 }} value={rules[s.number.key]} onChange={(e) => onChange({ [s.number.key]: Number(e.target.value) })} /> {s.number.suffix}
        </label>
      ) : null}
      {!missing.length && on && s.template ? (
        <textarea className="ui-input" rows={4} style={{ width: "100%", marginTop: 10, boxSizing: "border-box" }} maxLength={200}
          placeholder="Hi {{first_name}}, thanks for the chat. I'll send details of {{company}}'s next steps shortly."
          defaultValue={rules[s.template]} onBlur={(e) => { if (e.target.value !== rules[s.template]) onChange({ [s.template]: e.target.value }); }} />
      ) : null}
    </div>
  );
}

function Switches({ rules, plugins, onChange, busy }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="ui-card" style={{ padding: "14px 16px", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink }}>Wait before contacting a company again</div>
          <div style={muted}>A company you called or emailed in this time is held back from new call rounds, unless you include it by hand.</div>
        </div>
        <label style={{ ...muted, display: "flex", gap: 6, alignItems: "center" }}>
          <input className="ui-input" type="number" min={0} max={365} style={{ width: 80 }} value={rules.recontact_days} disabled={busy}
            onChange={(e) => onChange({ recontact_days: Number(e.target.value) })} /> days
        </label>
      </div>
      {SWITCHES.map((g) => (
        <section key={g.group}>
          <div style={{ ...text, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 8px 2px" }}>{g.group}</div>
          <div className="ui-card" style={{ padding: 0, overflow: "hidden" }}>
            {g.items.map((s, i) => <Row key={s.key} s={s} rules={rules} plugins={plugins} onChange={onChange} busy={busy} first={i === 0} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Your own rules ──────────────────────────────────────────────────────────
function RuleEditor({ meta, rule, onSave, onCancel, onDelete }) {
  const [r, setR] = useState(rule);
  const outcomes = r.event === "call.completed" ? meta.call_outcomes : r.event === "campaign.reply" ? meta.reply_kinds : [];
  const setStep = (i, patch) => setR({ ...r, do: r.do.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <div className="ui-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <input className="ui-input" placeholder="Name this rule" value={r.name} maxLength={80} onChange={(e) => setR({ ...r, name: e.target.value })} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={muted}>When</span>
        <select className="ui-input" style={{ width: "auto" }} value={r.event} onChange={(e) => setR({ ...r, event: e.target.value, when: {} })}>
          {Object.entries(meta.events).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {outcomes.length ? (
          <select className="ui-input" style={{ width: "auto" }} value={r.when?.outcome || ""} onChange={(e) => setR({ ...r, when: e.target.value ? { outcome: e.target.value } : {} })}>
            <option value="">any result</option>
            {outcomes.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
          </select>
        ) : null}
      </div>
      {r.do.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
          <span style={muted}>{i === 0 ? "Then" : "and"}</span>
          <select className="ui-input" style={{ width: "auto" }} value={s.action} onChange={(e) => setStep(i, { action: e.target.value, value: "" })}>
            {Object.entries(meta.actions).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          {s.action === "set_stage" ? (
            <select className="ui-input" style={{ width: "auto" }} value={s.value} onChange={(e) => setStep(i, { value: e.target.value })}>
              <option value="">choose…</option>
              {meta.stages.map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}
            </select>
          ) : s.action === "add_dnc" ? null : (
            <>
              {s.action === "send_email" ? <input className="ui-input" style={{ width: 200 }} placeholder="Subject" value={s.subject || ""} onChange={(e) => setStep(i, { subject: e.target.value })} /> : null}
              <input className="ui-input" style={{ flex: 1, minWidth: 200 }} maxLength={2000}
                placeholder={s.action === "add_to_list" ? "List name" : s.action === "send_email" ? "Message. {{first_name}} and {{company}} work here" : "Text. {{first_name}} and {{company}} work here"}
                value={s.value} onChange={(e) => setStep(i, { value: e.target.value })} />
            </>
          )}
          {r.do.length > 1 ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label="Remove this action" onClick={() => setR({ ...r, do: r.do.filter((_, j) => j !== i) })}><X size={13} /></button> : null}
        </div>
      ))}
      {r.do.length < 5 ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ alignSelf: "flex-start" }} onClick={() => setR({ ...r, do: [...r.do, { action: "add_note", value: "" }] })}><Plus size={13} /> Another action</button> : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => onSave(r)}>Save rule</button>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onCancel}>Cancel</button>
        <span style={{ flex: 1 }} />
        {onDelete ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onDelete}><Trash2 size={13} /> Delete</button> : null}
      </div>
    </div>
  );
}

function RulesTab({ toast }) {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null); // index, or "new"
  const load = useCallback(() => api.getWorkflows().then(setData).catch((e) => toast(e.message || "Couldn't load your rules.")), [toast]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <div style={muted}>Loading…</div>;
  const save = async (list) => {
    try { const r = await api.saveWorkflows(list); setData({ ...data, workflows: r.workflows }); setEditing(null); toast("Saved."); } catch (e) { toast(e.message || "Couldn't save."); }
  };
  const blank = { name: "", enabled: true, event: "call.completed", when: { outcome: "meeting_booked" }, do: [{ action: "add_note", value: "" }] };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={muted}>“When this happens, do that.” A rule runs on the company behind the call, booking or reply. A step that needs a plan you don't have is skipped, and the timeline says so.</div>
      {data.workflows.map((w, i) => (editing === i ? (
        <RuleEditor key={w.id} meta={data} rule={w} onCancel={() => setEditing(null)} onSave={(r) => save(data.workflows.map((x, j) => (j === i ? r : x)))} onDelete={() => save(data.workflows.filter((_, j) => j !== i))} />
      ) : (
        <div key={w.id} className="ui-card" style={{ padding: "10px 12px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input type="checkbox" checked={w.enabled} aria-label={`${w.name} is on`} onChange={(e) => save(data.workflows.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink }}>{w.name}</div>
            <div style={muted}>When {data.events[w.event].toLowerCase()}{w.when?.outcome ? ` (${w.when.outcome.replace(/_/g, " ")})` : ""}: {w.do.map((s) => data.actions[s.action].toLowerCase()).join(", then ")}</div>
          </div>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setEditing(i)}>Edit</button>
        </div>
      )))}
      {editing === "new" ? <RuleEditor meta={data} rule={blank} onCancel={() => setEditing(null)} onSave={(r) => save([...data.workflows, r])} /> : (
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ alignSelf: "flex-start" }} disabled={data.workflows.length >= 30} onClick={() => setEditing("new")}><Plus size={13} /> New rule</button>
      )}
    </div>
  );
}

// ── Do not contact ──────────────────────────────────────────────────────────
function BlockTab({ toast }) {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ phone: "", email: "", name: "" });
  const load = useCallback(() => api.getDoNotContact().then((r) => setRows(r.entries)).catch((e) => toast(e.message || "Couldn't load the list.")), [toast]);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    const mail = f.email.trim();
    const body = mail.startsWith("@") ? { domain: mail.slice(1), phone: f.phone, name: f.name } : { ...f };
    try { await api.addDoNotContact({ ...body, reason: "Added by hand" }); setF({ phone: "", email: "", name: "" }); toast("Added. Calls, emails and posts to them stop."); load(); } catch (e) { toast(e.message || "Couldn't add."); }
  };
  const SOURCE = { call: "Asked on a call", email_unsubscribe: "Unsubscribed from an email", manual: "Added by hand", import: "Imported" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={muted}>One list for calls, emails and social. Anyone here is skipped everywhere: a call round, a campaign and a shared post. Someone who asks on a call, or unsubscribes from an email, lands here by themselves.</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input className="ui-input" style={{ flex: "1 1 130px" }} placeholder="Name (optional)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="ui-input" style={{ flex: "1 1 150px" }} placeholder="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <input className="ui-input" style={{ flex: "1 1 200px" }} placeholder="Email, or @company.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!(f.phone.trim() || f.email.trim())} onClick={add}>Add</button>
      </div>
      {!rows ? <div style={muted}>Loading…</div> : !rows.length ? <div style={muted}>Nobody is on the list.</div> : (
        <div className="ui-scroll" style={{ overflowX: "auto" }}>
          <table className="ui-table">
            <thead><tr><th>Who</th><th>Phone or email</th><th>Stops</th><th>Why</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name || "—"}</td>
                  <td>{r.phone || r.email || (r.domain ? `@${r.domain}` : "—")}</td>
                  <td>{(r.channels || []).join(", ")}</td>
                  <td>{SOURCE[r.source] || r.reason || r.source}</td>
                  <td><button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Allow contact again" onClick={() => api.removeDoNotContact(r.id).then(load).catch((e) => toast(e.message))}><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Duplicates, export and filling in links ─────────────────────────────────
function FailedEvents({ toast }) {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => api.getFailedEvents().then((r) => setRows(r.events)).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  if (!rows || !rows.length) return null;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={heading}>Things that didn't finish</div>
      <div style={muted}>A step that kept failing after three tries. The call, booking or reply itself was saved. Try the step again once whatever blocked it is fixed.</div>
      {rows.map((r) => (
        <div key={r.id} className="ui-card" style={{ padding: "8px 10px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ ...text, fontSize: 13, flex: 1, minWidth: 200 }}>{r.event} · {r.error}</span>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={async () => { try { await api.retryFailedEvent(r.id); toast("Done."); load(); } catch (e) { toast(e.message || "It failed again."); } }}>Try again</button>
        </div>
      ))}
    </section>
  );
}

function DataTab({ toast, plugins }) {
  const [groups, setGroups] = useState(null);
  const [backfill, setBackfill] = useState(null);
  const [busy, setBusy] = useState("");
  const load = useCallback(() => api.getDuplicates().then((r) => setGroups(r.groups)).catch((e) => { setGroups([]); toast(e.message || "Couldn't look for duplicates."); }), [toast]);
  useEffect(() => { if (plugins.leads) load(); }, [load, plugins.leads]);
  const download = async (path, name) => {
    setBusy("csv");
    try {
      const blob = await apiRequest(path, { asBlob: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { toast(e.message || "Couldn't download."); } finally { setBusy(""); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {plugins.leads ? (
        <>
          <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={heading}>Duplicate companies</div>
            <div style={muted}>The same company saved twice (same website, phone or person). Merging keeps everything: lists, calls, meetings and history all move to the one you keep, and it gains any detail it was missing.</div>
            {!groups ? <div style={muted}>Looking…</div> : !groups.length ? <div style={muted}>No duplicates found.</div> : groups.slice(0, 20).map((g) => (
              <div key={g.match + g.key} className="ui-card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={muted}>Same {g.match === "d" ? "website" : g.match === "p" ? "phone" : "email"}: {g.key}</div>
                {g.members.map((m, i) => (
                  <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", ...text, fontSize: 13 }}>
                    <span style={{ flex: 1, minWidth: 160 }}>{m.name} <span style={muted}>{[m.email, m.phone].filter(Boolean).join(" · ")}</span></span>
                    {i === 0 ? null : <span />}
                    <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy === m.id} title="Keep this one and fold the others into it"
                      onClick={async () => { setBusy(m.id); try { await api.mergeContacts(m.id, g.members.filter((x) => x.id !== m.id).map((x) => x.id)); toast("Merged."); await load(); } catch (e) { toast(e.message || "Couldn't merge."); } finally { setBusy(""); } }}>Keep this one</button>
                  </div>
                ))}
              </div>
            ))}
          </section>
          <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={heading}>Export</div>
            <div style={muted}>One row per company with its stage and how many calls, emails, meetings and posts it has had.</div>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ alignSelf: "flex-start" }} disabled={busy === "csv"} onClick={() => download("/contacts/export.csv", "contacts.csv")}>Download contacts (CSV)</button>
          </section>
        </>
      ) : <div style={muted}>Duplicates and the export are part of Lead Gen.</div>}
      <FailedEvents toast={toast} />
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={heading}>Link older calls to your companies</div>
        <div style={muted}>If you made calls before the plugins were connected, this matches them to your saved companies by phone number or name so their history shows up. It only fills in links that are missing, and never changes anything else. Check first, then apply.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy === "bf"} onClick={async () => { setBusy("bf"); try { setBackfill(await api.backfillConnections(true)); } catch (e) { toast(e.message || "Couldn't check."); } finally { setBusy(""); } }}>Check what it would link</button>
          {backfill ? <span style={muted}>{backfill.prospects_linked} call targets, {backfill.calls_linked} past calls, {backfill.leads_matched_to_contacts} companies to contact records.</span> : null}
          {backfill && backfill.dry_run && (backfill.prospects_linked + backfill.calls_linked + backfill.leads_matched_to_contacts) > 0 ? (
            <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy === "bf"} onClick={async () => { setBusy("bf"); try { setBackfill(await api.backfillConnections(false)); toast("Linked."); } catch (e) { toast(e.message || "Couldn't link."); } finally { setBusy(""); } }}>Link them</button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

const TABS = [
  ["follow", "Follow-ups", Repeat, "What happens by itself after calls, meetings and replies"],
  ["rules", "Your rules", Workflow, "“When this happens, do that”"],
  ["block", "Do not contact", Ban, "People every plugin must leave alone"],
  ["data", "Data", Database, "Duplicates, export and older calls"],
];

const CSS = `
.cx-modal{display:flex;width:min(100%,900px);height:min(680px,calc(100dvh - 32px));background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.22);border:1px solid ${C.border}}
.cx-side{width:220px;flex-shrink:0;background:${C.paperSoft};border-right:1px solid ${C.border};padding:18px 12px;display:flex;flex-direction:column;gap:14px;overflow-y:auto}
.cx-tabs{display:flex;flex-direction:column;gap:2px}
.cx-tab{all:unset;cursor:pointer;box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;font:600 13.5px ${FONT_BODY};color:${C.slate};white-space:nowrap}
.cx-tab:hover{background:#fff}
.cx-tab.on{background:#fff;color:${C.cobalt};box-shadow:0 1px 3px rgba(18,20,28,.08)}
.cx-main{flex:1;min-width:0;display:flex;flex-direction:column}
.cx-head{display:flex;align-items:center;gap:8px;padding:16px 22px 12px;border-bottom:1px solid ${C.border}}
.cx-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:18px 22px 24px}
@media (max-width:700px){
  .cx-modal{flex-direction:column;height:calc(100dvh - 32px)}
  .cx-side{width:auto;padding:12px 12px 0;border-right:none;border-bottom:1px solid ${C.border};overflow:visible}
  .cx-tabs{flex-direction:row;overflow-x:auto}
  .cx-tab{border-radius:8px 8px 0 0}
  .cx-head,.cx-body{padding-left:16px;padding-right:16px}
}
`;

export function ConnectionsSettingsModal({ isOpen, onClose, initialTab = "" }) {
  const [tab, setTab] = useState("follow");
  const [rules, setRules] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const { plugins } = useConnections();
  const toast = useCallback((m) => { setMessage(m); window.setTimeout(() => setMessage(""), 3500); }, []);
  useEffect(() => { if (isOpen && TABS.some(([k]) => k === initialTab)) setTab(initialTab); }, [isOpen, initialTab]);
  useEffect(() => {
    if (!isOpen) return;
    api.getConnectionRules().then((r) => setRules(r.rules)).catch((e) => toast(e.message || "Couldn't load your settings."));
  }, [isOpen, toast]);
  useEffect(() => {
    if (!isOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [isOpen, onClose]);
  if (!isOpen) return null;
  const change = async (patch) => {
    const next = { ...rules, ...patch };
    setRules(next);
    setBusy(true);
    try { setRules((await api.saveConnectionRules(patch)).rules); } catch (e) { toast(e.message || "Couldn't save."); api.getConnectionRules().then((r) => setRules(r.rules)).catch(() => {}); } finally { setBusy(false); }
  };
  const current = TABS.find(([k]) => k === tab) || TABS[0];
  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, overscrollBehavior: "contain", background: "rgba(18,20,28,0.55)", backdropFilter: "blur(4px)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <style>{CSS}</style>
      <div role="dialog" aria-label="Connections" className="cx-modal">
        <aside className="cx-side">
          <div style={{ padding: "0 6px" }}>
            <div style={{ ...text, fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 700, color: C.ink }}>Connections</div>
            <div style={{ ...muted, fontSize: 12, marginTop: 4 }}>How Lead Gen, Voice and Social work together.</div>
          </div>
          <div className="cx-tabs" role="tablist">
            {TABS.map(([k, label, Icon]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`cx-tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}><Icon size={16} /> {label}</button>
            ))}
          </div>
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6 }} className="hide-mobile">
            <div style={{ ...text, fontSize: 10.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.06em", padding: "0 6px" }}>Your plugins</div>
            {["leads", "voice", "social"].map((p) => (
              <div key={p} style={{ ...text, fontSize: 12.5, color: plugins[p] ? C.ink : C.slate, display: "flex", alignItems: "center", gap: 8, padding: "0 6px" }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: plugins[p] ? "#16A34A" : C.border }} />
                {PLUGIN_NAME[p]}<span style={{ marginLeft: "auto", fontSize: 11, color: C.slate }}>{plugins[p] ? "Active" : "Not added"}</span>
              </div>
            ))}
          </div>
        </aside>
        <div className="cx-main">
          <div className="cx-head">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ ...text, fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: C.ink, margin: 0 }}>{current[1]}</h1>
              <div style={{ ...muted, fontSize: 12.5 }}>{current[3]}</div>
            </div>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label="Close" onClick={onClose}><X size={16} /></button>
          </div>
          <div className="cx-body ui-scroll">
            {tab === "follow" ? (rules ? <Switches rules={rules} plugins={plugins} onChange={change} busy={busy} /> : <div style={muted}>Loading…</div>) : null}
            {tab === "rules" ? <RulesTab toast={toast} /> : null}
            {tab === "block" ? <BlockTab toast={toast} /> : null}
            {tab === "data" ? <DataTab toast={toast} plugins={plugins} /> : null}
          </div>
          {message ? <div role="status" style={{ ...text, fontSize: 13, padding: "9px 22px", background: C.paperSoft, color: C.ink, borderTop: `1px solid ${C.border}` }}>{message}</div> : null}
        </div>
      </div>
    </div>
  );
}
