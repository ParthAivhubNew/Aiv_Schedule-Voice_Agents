import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, FileText, Plus, Trash2, X } from "lucide-react";
import { CardsSkeleton } from "../../app/Loader";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";
import { askConfirm, askText } from "./Dialogs";
import { fieldTypeLabel, formLinks, moveItem, newField, whenShort } from "./inboundFormLogic";

// Inbound forms: build a web form, share its link or iframe, and review the answers. An answer waits as
// "pending" until its email domain can receive mail (a quick automatic check) or you approve it; only then
// does it become a company in your leads and land in the list you chose.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };
const label = { ...text, fontSize: 12, fontWeight: 600, color: C.slate, display: "block", marginBottom: 4 };
const FIELD_TYPES = ["name", "email", "phone", "text", "dropdown", "checkbox"];
const MAP_CHOICES = [["", "Keep as the form's own question"], ["contact_name", "Contact name"], ["email", "Email"], ["phone", "Phone"], ["name", "Company name"], ["website", "Website"], ["contact_title", "Job title"], ["industry", "Industry"], ["region", "Region"], ["notes", "Notes"]];
const css = ".ifm .ui-input{width:100%;box-sizing:border-box}.ifm .ifm-auto{width:auto}.ifm .ui-table td{white-space:normal;overflow-wrap:anywhere}";
const STATUS_TEXT = { pending: "Checking", approved: "Saved as a lead", blocked: "Blocked" };

export function InboundFormsView({ toast, onOpenLead }) {
  const [forms, setForms] = useState(null);
  const [openId, setOpenId] = useState("");
  const load = useCallback(async () => {
    try { setForms((await api.listInboundForms()).forms || []); } catch (e) { setForms([]); toast?.(e.message || "Couldn't load your forms."); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  if (forms === null) return <CardsSkeleton count={3} label="Loading your forms" />;
  if (openId) return <FormEditor id={openId} toast={toast} onOpenLead={onOpenLead} onBack={() => { setOpenId(""); load(); }} />;

  const create = async () => {
    const name = await askText({ title: "Name your form", label: "For example Contact us", confirm: "Create form", maxLength: 80 });
    if (!name) return;
    try { setOpenId((await api.createInboundForm(name.trim())).id); toast?.("Form created. Add fields, then publish it."); } catch (e) { toast?.(e.message || "Couldn't create the form."); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {forms.length ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={create}><Plus size={14} /> New form</button>
        </div>
      ) : null}
      {!forms.length ? (
        <div className="ui-card" style={{ padding: "40px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <FileText size={28} color="var(--ui-accent, #3457D5)" />
          <div style={{ ...text, fontSize: 16, fontWeight: 600, color: C.ink }}>No forms yet</div>
          <div style={{ ...muted, maxWidth: 420 }}>A form asks for a name and email, plus anything else you add. Visitors fill it in on a page we host, or in an iframe on your own site.</div>
          <button type="button" className="ui-btn ui-btn--primary" onClick={create}>Create your first form</button>
        </div>
      ) : (
        <div className="ui-card" style={{ overflow: "hidden" }}>
          <div className="ui-scroll" style={{ overflowX: "auto" }}>
            <table className="ui-table" style={{ minWidth: 560 }}>
              <thead><tr><th>Form</th><th>Status</th><th style={{ textAlign: "right" }}>Answers</th><th>Changed</th></tr></thead>
              <tbody>
                {forms.map((f) => (
                  <tr key={f.id} style={{ cursor: "pointer" }} onClick={() => setOpenId(f.id)}>
                    <td><button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ fontWeight: 600 }} onClick={() => setOpenId(f.id)}>{f.name}</button></td>
                    <td>{f.status === "published" ? (f.dirty ? "Published, edits not live" : "Published") : "Draft"}</td>
                    <td style={{ textAlign: "right" }}>{f.submissions.toLocaleString()}{f.pending ? ` (${f.pending} checking)` : ""}</td>
                    <td style={{ color: C.slate }}>{whenShort(f.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FormEditor({ id, toast, onBack, onOpenLead }) {
  const [form, setForm] = useState(null);
  const [draft, setDraft] = useState(null); // { name, fields, settings }: what the screen holds before Save
  const [tab, setTab] = useState("fields");
  const [lists, setLists] = useState([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");

  const adopt = useCallback((f) => { setForm(f); setDraft({ name: f.name, fields: f.fields, settings: f.settings }); }, []);
  useEffect(() => {
    let live = true;
    api.getInboundForm(id).then((f) => { if (live) adopt(f); }).catch((e) => { toast?.(e.message || "Couldn't open the form."); onBack(); });
    api.listLeadLists().then((r) => { if (live) setLists(r.lists || []); }).catch(() => {});
    return () => { live = false; };
  }, [id, adopt, toast, onBack]);

  const changed = useMemo(() => !!form && !!draft && (draft.name !== form.name || JSON.stringify(draft.fields) !== JSON.stringify(form.fields) || JSON.stringify(draft.settings) !== JSON.stringify(form.settings)), [form, draft]);
  if (!form || !draft) return <CardsSkeleton count={2} label="Opening the form" />;

  const run = async (fn, done) => {
    setBusy(true);
    try { const f = await fn(); if (f) adopt(f); if (done) toast?.(done); return true; } catch (e) { toast?.(e.message || "That didn't work."); return false; } finally { setBusy(false); }
  };
  const save = () => run(() => api.saveInboundForm(id, draft), "Saved.");
  const publish = async () => {
    if (changed && !(await save())) return;
    run(() => api.publishInboundForm(id), "Published. The link is live.");
  };
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setSettings = (patch) => setDraft((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  const setField = (fid, patch) => set({ fields: draft.fields.map((f) => (f.id === fid ? { ...f, ...patch } : f)) });
  const links = formLinks(window.location.origin, form.public_key);

  return (
    <div className="ifm" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{css}</style>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={async () => { if (!changed || await askConfirm({ title: "Leave without saving?", body: "Your edits to this form will be lost.", confirm: "Leave" })) onBack(); }}>← All forms</button>
        <input aria-label="Form name" value={draft.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} className="ui-input ifm-auto" style={{ ...text, fontSize: 16, fontWeight: 600, minWidth: 200, flex: "1 1 200px", maxWidth: 360 }} />
        <span style={muted}>{form.status === "published" ? (form.dirty || changed ? "Published · edits not live yet" : "Published") : "Draft"}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy} onClick={async () => { if (await askConfirm({ title: `Delete ${form.name}?`, body: "Its link stops working and its answers are deleted. Leads already saved stay in your lists.", confirm: "Delete form", danger: true })) { if (await run(() => api.deleteInboundForm(id).then(() => null), `Deleted ${form.name}.`)) onBack(); } }}><Trash2 size={14} /> Delete</button>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy || !changed} onClick={save}>Save</button>
        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy || (form.status === "published" && !changed && !form.dirty)} onClick={publish}>{form.status === "published" ? "Publish changes" : "Publish"}</button>
        {form.status === "published" ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy} title="Take the link offline. You can publish again later." onClick={() => run(() => api.unpublishInboundForm(id), "Unpublished.")}>Unpublish</button> : null}
      </div>

      <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: `1px solid ${C.border || "#e5e7eb"}` }}>
        {[["fields", "Fields"], ["settings", "Settings"], ["share", "Share"], ["answers", `Answers${form.submissions ? ` (${form.submissions})` : ""}`]].map(([k, name]) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ borderRadius: "8px 8px 0 0", fontWeight: tab === k ? 700 : 500, borderBottom: tab === k ? "2px solid #8B5CF6" : "2px solid transparent" }} onClick={() => setTab(k)}>{name}</button>
        ))}
      </div>

      {tab === "fields" && (
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
          <div className="ui-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            {draft.fields.map((f, i) => (
              <div key={f.id} style={{ border: `1px solid ${selected === f.id ? "var(--ui-accent, #3457D5)" : "#e5e7eb"}`, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ flex: 1, justifyContent: "flex-start", fontWeight: 600 }} aria-expanded={selected === f.id} onClick={() => setSelected(selected === f.id ? "" : f.id)}>
                    {f.label} <span style={{ ...muted, marginLeft: 6 }}>{fieldTypeLabel(f.type)}{f.required ? " · required" : ""}</span>
                  </button>
                  <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Move up" aria-label={`Move ${f.label} up`} disabled={i === 0} onClick={() => set({ fields: moveItem(draft.fields, i, -1) })}><ArrowUp size={14} /></button>
                  <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Move down" aria-label={`Move ${f.label} down`} disabled={i === draft.fields.length - 1} onClick={() => set({ fields: moveItem(draft.fields, i, 1) })}><ArrowDown size={14} /></button>
                  <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title={f.type === "email" ? "Every form needs its email field" : "Remove this field"} aria-label={`Remove ${f.label}`} disabled={f.type === "email"} onClick={() => set({ fields: draft.fields.filter((x) => x.id !== f.id) })}><X size={14} /></button>
                </div>
                {selected === f.id ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div><label style={label} htmlFor={`l_${f.id}`}>Label</label><input id={`l_${f.id}`} className="ui-input" maxLength={80} value={f.label} onChange={(e) => setField(f.id, { label: e.target.value })} /></div>
                    {f.type !== "checkbox" ? <div><label style={label} htmlFor={`p_${f.id}`}>Placeholder</label><input id={`p_${f.id}`} className="ui-input" maxLength={120} value={f.placeholder} onChange={(e) => setField(f.id, { placeholder: e.target.value })} /></div> : null}
                    {f.type === "dropdown" ? <div><label style={label} htmlFor={`o_${f.id}`}>Options, one per line</label><textarea id={`o_${f.id}`} className="ui-input" rows={4} value={(f.options || []).join("\n")} onChange={(e) => setField(f.id, { options: e.target.value.split("\n").slice(0, 30) })} /></div> : null}
                    {f.type !== "email" ? (
                      <label style={{ ...text, fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={!!f.required} onChange={(e) => setField(f.id, { required: e.target.checked })} /> Required</label>
                    ) : <div style={muted}>Email is always required.</div>}
                    {f.type !== "email" ? (
                      <div><label style={label} htmlFor={`m_${f.id}`}>Save the answer as</label>
                        <select id={`m_${f.id}`} className="ui-input" value={f.maps_to.startsWith("custom:") ? "" : f.maps_to} onChange={(e) => setField(f.id, { maps_to: e.target.value || `custom:${f.id}` })}>
                          {MAP_CHOICES.filter(([k]) => k !== "email").map(([k, name]) => <option key={k} value={k}>{name}</option>)}
                        </select></div>
                    ) : null}
                    {f.maps_to === "phone" || f.maps_to === "website" ? (
                      <label style={{ ...text, fontSize: 13, display: "flex", gap: 8, alignItems: "flex-start" }} htmlFor={`sh_${f.id}`}>
                        <input id={`sh_${f.id}`} type="checkbox" style={{ marginTop: 3 }} checked={!!f.share_to_company} onChange={(e) => setField(f.id, { share_to_company: e.target.checked })} />
                        <span>Add this answer to the company's details, shown as confirmed by the business. Only used when the form is opened from a link in an email you sent, and the form tells the person.</span>
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label htmlFor="add_type" style={{ ...label, margin: 0 }}>Add a field</label>
              <select id="add_type" className="ui-input ifm-auto" defaultValue="" onChange={(e) => { const t = e.target.value; e.target.value = ""; if (!t) return; if (draft.fields.length >= 20) { toast?.("A form can hold up to 20 fields."); return; } const nf = newField(t, draft.fields); set({ fields: [...draft.fields, nf] }); setSelected(nf.id); }}>
                <option value="">Choose a type…</option>
                {FIELD_TYPES.filter((t) => t !== "email" || !draft.fields.some((f) => f.type === "email")).map((t) => <option key={t} value={t}>{fieldTypeLabel(t)}</option>)}
              </select>
            </div>
          </div>
          <FormPreview name={draft.name} fields={draft.fields} />
        </div>
      )}

      {tab === "settings" && (
        <div className="ui-card" style={{ padding: 16, display: "grid", gap: 14, maxWidth: 640 }}>
          <div>
            <label style={label} htmlFor="s_list">Add new leads to this list</label>
            <select id="s_list" className="ui-input" value={draft.settings.list_id || ""} onChange={(e) => { const l = lists.find((x) => x.id === e.target.value); setSettings({ list_id: e.target.value, list_name: l ? l.name : draft.settings.list_name }); }}>
              <option value="">{`A list named "${draft.settings.list_name || "Web form leads"}"`}</option>
              {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            {!draft.settings.list_id ? <input aria-label="Name for the new list" className="ui-input" style={{ marginTop: 8 }} maxLength={80} value={draft.settings.list_name || ""} onChange={(e) => setSettings({ list_name: e.target.value })} /> : null}
          </div>
          <div>
            <label style={label} htmlFor="s_thanks">Message after sending</label>
            <input id="s_thanks" className="ui-input" maxLength={300} value={draft.settings.thanks || ""} onChange={(e) => setSettings({ thanks: e.target.value })} />
          </div>
          <label style={{ ...text, fontSize: 14, display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={!!draft.settings.block_free_email} onChange={(e) => setSettings({ block_free_email: e.target.checked })} /> Ask for a work email (refuse Gmail, Outlook and other free mailboxes)
          </label>
          <ListEditor id="s_dom" title="Only accept these email domains" hint="For example acme.co.uk. Leave empty to accept any." value={draft.settings.allowed_email_domains || []} onChange={(v) => setSettings({ allowed_email_domains: v })} />
          <ListEditor id="s_org" title="Only let these websites show the form" hint="For example acme.com. Leave empty to allow any site. Your own hosted link always works." value={draft.settings.allowed_origins || []} onChange={(v) => setSettings({ allowed_origins: v })} />
          <div>
            <label style={label} htmlFor="s_max">Most answers accepted in 24 hours</label>
            <input id="s_max" className="ui-input ifm-auto" type="number" min={1} max={5000} value={draft.settings.daily_limit || 200} onChange={(e) => setSettings({ daily_limit: Math.max(1, Math.min(5000, Number(e.target.value) || 200)) })} style={{ maxWidth: 140 }} />
            <div style={muted}>Stops a flood of fake answers from filling your leads.</div>
          </div>
          <div style={muted}>Save, then Publish changes to put edits on the live form.</div>
        </div>
      )}

      {tab === "share" && (
        <div className="ui-card" style={{ padding: 16, display: "grid", gap: 14, maxWidth: 720 }}>
          {form.status !== "published" ? <div style={{ ...text, fontSize: 14, color: C.ink }}>This form is a draft. Publish it to get a working link.</div> : null}
          <CopyRow title="Link to the form page" value={links.page} disabled={form.status !== "published"} toast={toast} />
          <CopyRow title="iframe for your website" value={links.iframe} multiline disabled={form.status !== "published"} toast={toast} />
          <div style={muted}>The link is public: anyone who has it can send an answer. If it gets misused, make a new one and the old link stops working at once.</div>
          <div><button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy} onClick={async () => { if (await askConfirm({ title: "Make a new link?", body: "The current link and any iframe using it stop working.", confirm: "Make new link", danger: true })) run(() => api.rotateInboundFormKey(id), "New link made."); }}>Make a new link</button></div>
        </div>
      )}

      {tab === "answers" && <Answers formId={id} toast={toast} onOpenLead={onOpenLead} onChanged={() => api.getInboundForm(id).then((f) => setForm((p) => ({ ...p, submissions: f.submissions, pending: f.pending })))} />}
    </div>
  );
}

function ListEditor({ id, title, hint, value, onChange }) {
  const [raw, setRaw] = useState(value.join(", "));
  return (
    <div>
      <label style={label} htmlFor={id}>{title}</label>
      <input id={id} className="ui-input" value={raw} placeholder="acme.co.uk, acme.com" onChange={(e) => { setRaw(e.target.value); onChange(e.target.value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)); }} />
      <div style={muted}>{hint}</div>
    </div>
  );
}

function CopyRow({ title, value, multiline, disabled, toast }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1800); } catch (_) { toast?.("Couldn't copy. Select the text and copy it."); }
  };
  return (
    <div>
      <label style={label} htmlFor={`c_${title}`}>{title}</label>
      <div style={{ display: "flex", gap: 8, alignItems: multiline ? "flex-start" : "center" }}>
        {multiline ? <textarea id={`c_${title}`} readOnly rows={3} className="ui-input" style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }} value={value} onFocus={(e) => e.target.select()} />
          : <input id={`c_${title}`} readOnly className="ui-input" style={{ flex: 1 }} value={value} onFocus={(e) => e.target.select()} />}
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={disabled} onClick={copy}>{done ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}</button>
      </div>
    </div>
  );
}

function FormPreview({ name, fields }) {
  return (
    <div className="ui-card" style={{ padding: 18 }} aria-label="Preview of the form">
      <div style={{ ...muted, marginBottom: 8 }}>Preview</div>
      <div style={{ ...text, fontSize: 20, fontWeight: 700, color: "#2b2926", marginBottom: 6 }}>{name}</div>
      {fields.map((f) => (
        <div key={f.id} style={{ marginTop: 12 }}>
          {f.type === "checkbox" ? (
            <label style={{ ...text, fontSize: 14, display: "flex", gap: 8 }}><input type="checkbox" disabled /> {f.label}</label>
          ) : (
            <>
              <label style={{ ...text, fontSize: 14, fontWeight: 600, display: "block", marginBottom: 4 }}>{f.label}{f.required ? <span style={{ color: "#f72237" }}> *</span> : null}</label>
              {f.type === "dropdown" ? <select className="ui-input" disabled><option>{f.placeholder || "Choose one"}</option></select> : <input className="ui-input" disabled placeholder={f.placeholder} />}
            </>
          )}
        </div>
      ))}
      <button type="button" className="ui-btn ui-btn--primary" disabled style={{ marginTop: 16 }}>Submit</button>
    </div>
  );
}

function Answers({ formId, toast, onOpenLead, onChanged }) {
  const [rows, setRows] = useState(null);
  const [labels, setLabels] = useState({});
  const load = useCallback(async () => {
    try { const r = await api.listInboundSubmissions(formId); setRows(r.submissions || []); setLabels(r.labels || {}); } catch (e) { setRows([]); toast?.(e.message || "Couldn't load the answers."); }
  }, [formId, toast]);
  useEffect(() => { load(); }, [load]);
  if (rows === null) return <CardsSkeleton count={2} label="Loading answers" />;
  if (!rows.length) return <div className="ui-card" style={{ padding: 24, ...muted }}>No answers yet. They appear here a few seconds after someone sends the form.</div>;
  const act = async (fn, msg) => { try { await fn(); toast?.(msg); await load(); onChanged?.(); } catch (e) { toast?.(e.message || "That didn't work."); } };
  return (
    <div className="ui-card" style={{ overflow: "hidden" }}>
      <div className="ui-scroll" style={{ overflowX: "auto" }}>
        <table className="ui-table" style={{ minWidth: 640 }}>
          <thead><tr><th>Received</th><th>Email</th><th>Answers</th><th>Status</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td style={{ color: C.slate, whiteSpace: "nowrap" }}>{whenShort(s.created_at)}</td>
                <td>{s.email}</td>
                <td style={{ minWidth: 220, maxWidth: 360 }}>{Object.entries(s.answers || {}).filter(([k]) => !/email/.test(k) && labels[k]).map(([k, v]) => `${labels[k]}: ${v}`).join(" · ")}</td>
                <td title={s.reason || ""}>{STATUS_TEXT[s.status] || s.status}{s.status === "blocked" && s.reason ? ` · ${s.reason}` : ""}</td>
                <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  {s.status === "approved" && s.lead_id && onOpenLead ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => onOpenLead(s.lead_id)}>Open lead</button> : null}
                  {s.status !== "approved" ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => act(() => api.approveInboundSubmission(s.id), "Saved as a lead.")}>Save as lead</button> : null}
                  {s.status === "pending" ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => act(() => api.blockInboundSubmission(s.id), "Blocked.")}>Block</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
