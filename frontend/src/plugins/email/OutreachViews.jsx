import React, { useState } from "react";
import { C } from "../../tokens";
import { api } from "../../api/apiClient";
import { Note, Pill, btn, card, cell, input, th, useAction, useLoad, when } from "../../adminPortal/ui";

const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];
const PRESETS = [["one.com", "one.com"], ["gmail", "Google Workspace / Gmail"], ["outlook", "Microsoft 365 / Outlook"], ["zoho", "Zoho Mail"], ["", "Other (enter servers)"]];
const STATUS_TONE = { active: "green", graduated: "green", warming: "blue", paused: "amber", error: "red", connected: "slate", running: "green", draft: "slate", completed: "blue" };
const STATUS_TEXT = { active: "Sending", graduated: "Sending", warming: "Warming up", paused: "Paused", error: "Needs attention", connected: "Not started", running: "Running", draft: "Draft", completed: "Finished" };
const CATEGORY = { interested: ["Interested", "green"], question: ["Question", "blue"], not_interested: ["Not interested", "slate"], ooo: ["Out of office", "slate"], unsubscribe: ["Unsubscribe", "red"] };
const row = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const label = { fontSize: 12, fontWeight: 600, color: C.slate, display: "grid", gap: 4 };
const small = { fontSize: 12, color: C.slate };

function Check({ ok, children }) {
  return <span style={{ fontSize: 12, color: ok ? C.green : C.red, fontWeight: 600 }}>{ok ? "✓" : "✗"} {children}</span>;
}

// ── Mailboxes ───────────────────────────────────────────────────────────────
const blankBox = { email: "", display_name: "", preset: "one.com", password: "", smtp_host: "", smtp_port: "", imap_host: "", imap_port: "", username: "", max_daily_target: 40, signature: "" };

export function MailboxesView() {
  const [data, err, reload] = useLoad(api.emailMailboxes);
  const [overview] = useLoad(api.emailOverview);
  const [msg, run] = useAction(reload);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(blankBox);
  const [editing, setEditing] = useState("");
  const [patch, setPatch] = useState({});
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const connect = () => run(async () => {
    const body = { ...form, smtp_port: form.smtp_port ? Number(form.smtp_port) : null, imap_port: form.imap_port ? Number(form.imap_port) : null, max_daily_target: Number(form.max_daily_target) || 40 };
    await api.emailConnectMailbox(body);
    setAdding(false);
    setForm(blankBox);
  }, "Mailbox connected. Start warmup when its DNS checks pass.");

  const boxes = data?.mailboxes || [];
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Note error>{err}</Note>
      <Note error={msg.error}>{msg.text}</Note>
      {overview && !overview.warmupPartnerReady && (
        <Note>Warmup will use your own mailboxes only until the OutReach team adds the platform mailbox. Connect two or more mailboxes so they warm each other.</Note>
      )}
      <div style={row}>
        <div style={small}>Each mailbox warms up for about 3–4 weeks (5 a day rising to your daily target), then sends campaigns. Bounces over 2% pause it automatically.</div>
        <button type="button" style={{ ...btn(true), marginLeft: "auto" }} onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "Connect mailbox"}</button>
      </div>

      {adding && (
        <div style={{ ...card, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <label style={label}>Email address<input style={input} value={form.email} onChange={set("email")} placeholder="sam@yourcompany.com" /></label>
            <label style={label}>Name people see<input style={input} value={form.display_name} onChange={set("display_name")} placeholder="Sam Smith" /></label>
            <label style={label}>Email provider
              <select style={input} value={form.preset} onChange={set("preset")}>{PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
            <label style={label}>Password{form.preset === "gmail" || form.preset === "outlook" ? " (an app password)" : ""}
              <input style={input} type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
            </label>
            <label style={label}>Daily target (emails)<input style={input} type="number" min={5} max={100} value={form.max_daily_target} onChange={set("max_daily_target")} /></label>
          </div>
          {form.preset === "" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              <label style={label}>SMTP server<input style={input} value={form.smtp_host} onChange={set("smtp_host")} placeholder="smtp.example.com" /></label>
              <label style={label}>SMTP port<input style={input} value={form.smtp_port} onChange={set("smtp_port")} placeholder="465 or 587" /></label>
              <label style={label}>IMAP server<input style={input} value={form.imap_host} onChange={set("imap_host")} placeholder="imap.example.com" /></label>
              <label style={label}>IMAP port<input style={input} value={form.imap_port} onChange={set("imap_port")} placeholder="993" /></label>
              <label style={label}>Username (if not the email)<input style={input} value={form.username} onChange={set("username")} /></label>
            </div>
          )}
          <label style={label}>Signature<textarea style={{ ...input, minHeight: 60 }} value={form.signature} onChange={set("signature")} placeholder={"Sam Smith\nYour Company Ltd"} /></label>
          {(form.preset === "gmail" || form.preset === "outlook") && (
            <div style={small}>Google and Microsoft need IMAP turned on and an app password (2-step verification on), not your normal password.</div>
          )}
          <div><button type="button" style={btn(true)} onClick={connect}>Test and connect</button></div>
        </div>
      )}

      {boxes.length === 0 && !adding && <div style={{ ...card, ...small }}>No mailboxes yet. Connect the mailbox your campaigns should send from.</div>}
      {boxes.map((m) => {
        const dns = m.dns || {};
        const sending = ["warming", "active", "graduated"].includes(m.status);
        return (
          <div key={m.id} style={{ ...card, display: "grid", gap: 8 }}>
            <div style={row}>
              <span style={{ fontWeight: 700 }}>{m.email}</span>
              <Pill tone={STATUS_TONE[m.status]}>{STATUS_TEXT[m.status] || m.status}</Pill>
              {m.status === "warming" && <span style={small}>Day {m.consecutive_healthy_days} of ~21</span>}
              <span style={{ ...small, marginLeft: "auto" }}>Today: {m.today_campaign_sent}/{m.campaign_quota} campaign · {m.today_warmup_sent}/{m.warmup_quota} warmup · {m.today_replies} replies · {m.today_bounced} bounced</span>
            </div>
            {m.pause_reason && <div style={{ fontSize: 12, color: C.amber }}>{m.pause_reason}</div>}
            {m.last_error && <div style={{ fontSize: 12, color: C.red }}>{m.last_error}</div>}
            <div style={row}>
              <Check ok={m.spf_verified}>SPF</Check><Check ok={m.dkim_verified}>DKIM</Check>
              <Check ok={m.dmarc_verified}>DMARC</Check><Check ok={m.mx_verified}>MX</Check>
              <span style={small}>Bounces (7 days): {(m.bounce_rate_7d * 100).toFixed(1)}%</span>
            </div>
            {(dns.recommendations || []).length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: C.slate }}>{dns.recommendations.map((r) => <li key={r}>{r}</li>)}</ul>
            )}
            <div style={row}>
              {!sending && <button type="button" style={btn(true)} onClick={() => run(() => api.emailWarmup(m.id, "start"), "Warmup started.")}>Start warmup</button>}
              {!sending && <button type="button" style={btn(false)} title="For a mailbox that has sent normal email for months" onClick={() => {
                if (window.confirm("Skip warmup? Only do this for a mailbox that already sends email every day. It will send up to its daily target straight away.")) run(() => api.emailWarmup(m.id, "skip"), "Sending at full volume.");
              }}>Already warm</button>}
              {sending && <button type="button" style={btn(false)} onClick={() => run(() => api.emailWarmup(m.id, "pause"), "Paused.")}>Pause</button>}
              <button type="button" style={btn(false)} onClick={() => run(() => api.emailCheckDns(m.id), "DNS checked.")}>Check DNS</button>
              <button type="button" style={btn(false)} onClick={() => run(() => api.emailTestMailbox(m.id), "Login works.")}>Test login</button>
              <button type="button" style={btn(false)} onClick={() => { setEditing(editing === m.id ? "" : m.id); setPatch({ display_name: m.display_name, max_daily_target: m.max_daily_target, signature: m.signature, password: "" }); }}>Edit</button>
              <button type="button" style={btn(false)} onClick={() => { if (window.confirm(`Remove ${m.email}? Campaigns stop using it.`)) run(() => api.emailDeleteMailbox(m.id), "Removed."); }}>Remove</button>
            </div>
            {editing === m.id && (
              <div style={{ display: "grid", gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                  <label style={label}>Name people see<input style={input} value={patch.display_name} onChange={(e) => setPatch({ ...patch, display_name: e.target.value })} /></label>
                  <label style={label}>Daily target<input style={input} type="number" min={5} max={100} value={patch.max_daily_target} onChange={(e) => setPatch({ ...patch, max_daily_target: e.target.value })} /></label>
                  <label style={label}>New password (optional)<input style={input} type="password" autoComplete="new-password" value={patch.password} onChange={(e) => setPatch({ ...patch, password: e.target.value })} /></label>
                </div>
                <label style={label}>Signature<textarea style={{ ...input, minHeight: 60 }} value={patch.signature} onChange={(e) => setPatch({ ...patch, signature: e.target.value })} /></label>
                <div><button type="button" style={btn(true)} onClick={() => run(async () => {
                  await api.emailUpdateMailbox(m.id, { ...patch, max_daily_target: Number(patch.max_daily_target) || 40, password: patch.password || null });
                  setEditing("");
                }, "Saved.")}>Save</button></div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Campaigns ───────────────────────────────────────────────────────────────
const blankCampaign = {
  name: "", mailbox_ids: [], sending_window_start: "09:00", sending_window_end: "17:00", days_of_week: [1, 2, 3, 4, 5], min_delay_seconds: 120,
  steps: [{ subject: "", body: "Hi {{first_name}},\n\n", delay_days: 0 }, { subject: "", body: "Hi {{first_name}},\n\n", delay_days: 3 }],
};

export function parseLeads(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const split = (l) => l.split(/[,\t;]/).map((x) => x.trim().replace(/^"|"$/g, ""));
  let cols = ["email", "first_name", "last_name", "company"];
  const first = split(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  if (first.some((h) => h === "email" || h === "emailaddress")) {
    const map = { email: "email", emailaddress: "email", firstname: "first_name", first: "first_name", lastname: "last_name", last: "last_name", surname: "last_name", company: "company", companyname: "company", organisation: "company", organization: "company" };
    cols = first.map((h) => map[h] || "");
    lines.shift();
  }
  return lines.map((l) => {
    const v = split(l);
    const lead = {};
    cols.forEach((c, i) => { if (c && v[i]) lead[c] = v[i]; });
    return lead;
  }).filter((l) => l.email);
}

function CampaignEditor({ initial, mailboxes, onSaved, onCancel }) {
  const [c, setC] = useState(initial);
  const [msg, run] = useAction();
  const step = (i, k, v) => setC({ ...c, steps: c.steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });
  const save = () => run(async () => {
    const body = { ...c, min_delay_seconds: Number(c.min_delay_seconds) || 120, steps: c.steps.map((s) => ({ ...s, delay_days: Number(s.delay_days) || 0 })) };
    const out = c.id ? await api.emailUpdateCampaign(c.id, body) : await api.emailCreateCampaign(body);
    onSaved(out.campaign);
  });
  return (
    <div style={{ ...card, display: "grid", gap: 12 }}>
      <Note error={msg.error}>{msg.text}</Note>
      <label style={label}>Campaign name<input style={input} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></label>
      <div style={label}>Send from
        <div style={row}>
          {mailboxes.length === 0 && <span style={small}>Connect a mailbox first.</span>}
          {mailboxes.map((m) => (
            <label key={m.id} style={{ ...row, fontWeight: 500, color: C.textInk }}>
              <input type="checkbox" checked={c.mailbox_ids.includes(m.id)} onChange={(e) => setC({ ...c, mailbox_ids: e.target.checked ? [...c.mailbox_ids, m.id] : c.mailbox_ids.filter((x) => x !== m.id) })} />
              {m.email}
            </label>
          ))}
        </div>
      </div>
      <div style={{ ...row, gap: 14 }}>
        <div style={label}>Days
          <div style={row}>{DAYS.map(([d, n]) => (
            <label key={d} style={{ ...row, gap: 3, fontWeight: 500, color: C.textInk }}>
              <input type="checkbox" checked={c.days_of_week.includes(d)} onChange={(e) => setC({ ...c, days_of_week: e.target.checked ? [...c.days_of_week, d].sort() : c.days_of_week.filter((x) => x !== d) })} />{n}
            </label>
          ))}</div>
        </div>
        <label style={label}>From<input style={{ ...input, width: 90 }} type="time" value={c.sending_window_start} onChange={(e) => setC({ ...c, sending_window_start: e.target.value })} /></label>
        <label style={label}>To<input style={{ ...input, width: 90 }} type="time" value={c.sending_window_end} onChange={(e) => setC({ ...c, sending_window_end: e.target.value })} /></label>
        <label style={label}>Gap between emails (seconds)<input style={{ ...input, width: 110 }} type="number" min={30} value={c.min_delay_seconds} onChange={(e) => setC({ ...c, min_delay_seconds: e.target.value })} /></label>
      </div>
      <div style={small}>Hours are in your company's timezone. Use {"{{first_name}}"}, {"{{last_name}}"} and {"{{company}}"} in subjects and emails. Follow-ups with no subject go as a reply in the same thread.</div>
      {c.steps.map((s, i) => (
        <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, display: "grid", gap: 8 }}>
          <div style={row}>
            <strong style={{ fontSize: 13 }}>Email {i + 1}</strong>
            {i > 0 && <label style={{ ...row, ...small }}>wait <input style={{ ...input, width: 64 }} type="number" min={1} value={s.delay_days} onChange={(e) => step(i, "delay_days", e.target.value)} /> days after email {i}</label>}
            {i > 0 && <button type="button" style={{ ...btn(false), marginLeft: "auto" }} onClick={() => setC({ ...c, steps: c.steps.filter((_, j) => j !== i) })}>Remove</button>}
          </div>
          <input style={input} placeholder={i === 0 ? "Subject" : "Subject (empty = reply in the same thread)"} value={s.subject} onChange={(e) => step(i, "subject", e.target.value)} />
          <textarea style={{ ...input, minHeight: 120 }} value={s.body} onChange={(e) => step(i, "body", e.target.value)} />
        </div>
      ))}
      <div style={row}>
        {c.steps.length < 6 && <button type="button" style={btn(false)} onClick={() => setC({ ...c, steps: [...c.steps, { subject: "", body: "Hi {{first_name}},\n\n", delay_days: 3 }] })}>Add follow-up</button>}
        <button type="button" style={{ ...btn(true), marginLeft: "auto" }} onClick={save}>Save campaign</button>
        <button type="button" style={btn(false)} onClick={onCancel}>Cancel</button>
      </div>
      <div style={small}>Every email gets an unsubscribe link automatically. Leads who reply, bounce or unsubscribe stop getting follow-ups.</div>
    </div>
  );
}

function CampaignDetail({ id, mailboxes, onBack }) {
  const [data, err, reload] = useLoad(() => api.emailCampaign(id), [id]);
  const [msg, run] = useAction(reload);
  const [paste, setPaste] = useState("");
  const [added, setAdded] = useState("");
  const [editing, setEditing] = useState(false);
  if (!data) return <Note error>{err}</Note>;
  const c = data.campaign;
  if (editing) {
    return <CampaignEditor initial={{ ...c, steps: c.steps.map((s) => ({ subject: s.subject, body: s.body, delay_days: s.delay_days })) }} mailboxes={mailboxes}
      onSaved={() => { setEditing(false); reload(); }} onCancel={() => setEditing(false)} />;
  }
  const leads = parseLeads(paste);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={row}>
        <button type="button" style={btn(false)} onClick={onBack}>← All campaigns</button>
        <strong style={{ fontSize: 16 }}>{c.name}</strong>
        <Pill tone={STATUS_TONE[c.status]}>{STATUS_TEXT[c.status] || c.status}</Pill>
        <span style={{ marginLeft: "auto", ...row }}>
          {c.status !== "running" ? <button type="button" style={btn(true)} onClick={() => run(() => api.emailCampaignStatus(c.id, "running"), "Running. Emails go out during its sending hours.")}>Start</button>
            : <button type="button" style={btn(false)} onClick={() => run(() => api.emailCampaignStatus(c.id, "paused"), "Paused.")}>Pause</button>}
          <button type="button" style={btn(false)} onClick={() => setEditing(true)}>Edit</button>
          <button type="button" style={btn(false)} onClick={() => { if (window.confirm(`Delete ${c.name} and its leads?`)) run(() => api.emailDeleteCampaign(c.id).then(onBack)); }}>Delete</button>
        </span>
      </div>
      <Note error={msg.error}>{msg.text}</Note>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        {[["Leads", c.leads], ["Emails sent", c.sent], ["Replies", c.replied], ["Reply rate", `${c.reply_rate}%`], ["Bounced", c.bounced]].map(([k, v]) => (
          <div key={k} style={card}><div style={small}>{k}</div><div style={{ fontSize: 20, fontWeight: 700 }}>{v}</div></div>
        ))}
      </div>
      <div style={{ ...card, display: "grid", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>Add leads</strong>
        <div style={small}>Paste one per line: email, first name, last name, company (or a CSV with those column headers). Addresses on your do-not-email list are skipped.</div>
        <textarea style={{ ...input, minHeight: 90, fontFamily: "monospace" }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"ann@client.com, Ann, Lee, Client Ltd"} />
        <div style={row}>
          <button type="button" style={btn(true, !leads.length)} disabled={!leads.length} onClick={() => run(async () => {
            const out = await api.emailAddLeads(c.id, leads);
            setPaste("");
            const s = out.skipped;
            setAdded(`${out.added} added. Skipped: ${s.duplicate} already in, ${s.do_not_email} on the do-not-email list, ${s.invalid} not valid.`);
          })}>Add {leads.length || ""} lead{leads.length === 1 ? "" : "s"}</button>
          {added && <span style={small}>{added}</span>}
        </div>
      </div>
      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["Lead", "Company", "Status", "Email", "Next"].map((h) => <th key={h} style={th}>{h}</th>)}<th style={th} /></tr></thead>
          <tbody>
            {(c.lead_list || []).map((l) => (
              <tr key={l.id}>
                <td style={cell}>{`${l.first_name} ${l.last_name}`.trim() || "—"}<div style={small}>{l.email}</div></td>
                <td style={cell}>{l.company || "—"}</td>
                <td style={cell}>{l.status}</td>
                <td style={cell}>{l.status === "active" ? `${l.step} of ${c.steps.length}` : "—"}</td>
                <td style={cell}>{l.next_at ? when(l.next_at) : "—"}</td>
                <td style={cell}><button type="button" style={btn(false)} onClick={() => run(() => api.emailRemoveLead(c.id, l.id))}>Remove</button></td>
              </tr>
            ))}
            {!(c.lead_list || []).length && <tr><td style={cell} colSpan={6}>No leads yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CampaignsView() {
  const [data, err, reload] = useLoad(api.emailCampaigns);
  const [boxes] = useLoad(api.emailMailboxes);
  const [open, setOpen] = useState("");
  const [creating, setCreating] = useState(false);
  const mailboxes = boxes?.mailboxes || [];
  if (open) return <CampaignDetail id={open} mailboxes={mailboxes} onBack={() => { setOpen(""); reload(); }} />;
  if (creating) {
    return <CampaignEditor initial={{ ...blankCampaign, mailbox_ids: mailboxes.map((m) => m.id) }} mailboxes={mailboxes}
      onSaved={(c) => { setCreating(false); setOpen(c.id); }} onCancel={() => setCreating(false)} />;
  }
  const camps = data?.campaigns || [];
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Note error>{err}</Note>
      <div style={row}><button type="button" style={{ ...btn(true), marginLeft: "auto" }} onClick={() => setCreating(true)}>New campaign</button></div>
      {camps.length === 0 && <div style={{ ...card, ...small }}>No campaigns yet. Create one, add leads, then start it.</div>}
      {camps.map((c) => (
        <button type="button" key={c.id} onClick={() => setOpen(c.id)} style={{ ...card, textAlign: "left", cursor: "pointer", display: "grid", gap: 6 }}>
          <div style={row}><strong>{c.name}</strong><Pill tone={STATUS_TONE[c.status]}>{STATUS_TEXT[c.status] || c.status}</Pill>
            <span style={{ ...small, marginLeft: "auto" }}>{c.steps.length} email{c.steps.length === 1 ? "" : "s"} · {c.mailbox_ids.length} mailbox{c.mailbox_ids.length === 1 ? "" : "es"}</span></div>
          <div style={small}>{c.leads} leads · {c.sent} sent · {c.replied} replies ({c.reply_rate}%) · {c.bounced} bounced</div>
        </button>
      ))}
    </div>
  );
}

// ── Find emails ─────────────────────────────────────────────────────────────
export function FindView() {
  const [q, setQ] = useState({ first_name: "", last_name: "", company_name: "", domain: "" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [campaigns] = useLoad(api.emailCampaigns);
  const [target, setTarget] = useState("");
  const [msg, run] = useAction();
  const set = (k) => (e) => setQ({ ...q, [k]: e.target.value });
  const find = async () => {
    setBusy(true);
    setResult(null);
    await run(async () => setResult(await api.emailFind(q)));
    setBusy(false);
  };
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ ...card, display: "grid", gap: 10 }}>
        <div style={small}>Finds a person's verified work email. Costs 1 lead-generation credit only when an email is found.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <label style={label}>First name<input style={input} value={q.first_name} onChange={set("first_name")} /></label>
          <label style={label}>Last name<input style={input} value={q.last_name} onChange={set("last_name")} /></label>
          <label style={label}>Company website<input style={input} value={q.domain} onChange={set("domain")} placeholder="client.com" /></label>
          <label style={label}>or company name<input style={input} value={q.company_name} onChange={set("company_name")} /></label>
        </div>
        <div><button type="button" style={btn(true, busy)} disabled={busy} onClick={find}>{busy ? "Searching…" : "Find email"}</button></div>
      </div>
      <Note error={msg.error}>{msg.text}</Note>
      {result && !result.found && <div style={{ ...card, ...small }}>{result.detail || "No verified email found."} No credit used.</div>}
      {result && result.found && (
        <div style={{ ...card, display: "grid", gap: 8 }}>
          <div style={row}>
            <strong>{result.email}</strong>
            {result.verification_status === "verified" ? <Pill tone="green">Verified</Pill> : <Pill tone="amber">Catch-all domain: may bounce</Pill>}
            {result.entity_type === "individual" && <Pill tone="red">Personal mailbox: UK rules need consent</Pill>}
          </div>
          <div style={row}>
            <select style={input} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Add to campaign…</option>
              {(campaigns?.campaigns || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="button" style={btn(false, !target)} disabled={!target} onClick={() => run(() => api.emailAddLeads(target, [{
              email: result.email, first_name: result.first_name, last_name: result.last_name, company: result.company_name || "",
            }]), "Added to the campaign.")}>Add</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Replies ─────────────────────────────────────────────────────────────────
export function RepliesView() {
  const [category, setCategory] = useState("");
  const [data, err, reload] = useLoad(() => api.emailReplies(category), [category]);
  const [msg, run] = useAction(reload);
  const replies = data?.replies || [];
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Note error>{err}</Note>
      <Note error={msg.error}>{msg.text}</Note>
      <div style={row}>
        {[["", "All"], ...Object.entries(CATEGORY).map(([k, [l]]) => [k, l])].map(([k, l]) => (
          <button type="button" key={k || "all"} style={btn(category === k)} onClick={() => setCategory(k)}>{l}</button>
        ))}
        <span style={{ ...small, marginLeft: "auto" }}>Inboxes are checked every 5 minutes.</span>
      </div>
      {replies.length === 0 && <div style={{ ...card, ...small }}>No replies yet.</div>}
      {replies.map((r) => (
        <div key={r.id} style={{ ...card, display: "grid", gap: 6 }}>
          <div style={row}>
            <strong>{r.name || r.email}</strong>{r.name && <span style={small}>{r.email}</span>}
            {r.company && <span style={small}>· {r.company}</span>}
            <span style={{ ...small, marginLeft: "auto" }}>{r.campaign} · {when(r.replied_at)}</span>
          </div>
          <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{r.text}</div>
          <div style={row}>
            <Pill tone={(CATEGORY[r.category] || [])[1]}>{(CATEGORY[r.category] || [r.category])[0]}</Pill>
            <select style={{ ...input, padding: "4px 8px" }} value={r.category} onChange={(e) => run(() => api.emailReplyCategory(r.id, e.target.value))}>
              {Object.entries(CATEGORY).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <a href={`mailto:${r.email}?subject=${encodeURIComponent(r.subject.startsWith("Re:") ? r.subject : `Re: ${r.subject}`)}`} style={{ ...btn(false), textDecoration: "none" }}>Reply</a>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Do-not-email list ───────────────────────────────────────────────────────
export function DoNotEmailView() {
  const [data, err, reload] = useLoad(api.emailSuppressions);
  const [msg, run] = useAction(reload);
  const [entry, setEntry] = useState("");
  const rows = data?.suppressions || [];
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Note error>{err}</Note>
      <Note error={msg.error}>{msg.text}</Note>
      <div style={{ ...card, ...row }}>
        <input style={{ ...input, flex: "1 1 260px" }} value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="name@company.com or a whole domain like company.com" />
        <button type="button" style={btn(true, !entry.trim())} disabled={!entry.trim()} onClick={() => run(async () => { await api.emailAddSuppression(entry.trim()); setEntry(""); }, "Added.")}>Add</button>
      </div>
      <div style={small}>Unsubscribes and hard bounces are added automatically. Nobody on this list is emailed by any campaign.</div>
      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["Address", "Why", "Added"].map((h) => <th key={h} style={th}>{h}</th>)}<th style={th} /></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td style={cell}>{s.email}</td>
                <td style={cell}>{{ unsubscribe: "Unsubscribed", hard_bounce: "Bounced", manual: "Added by you" }[s.reason] || s.reason}</td>
                <td style={cell}>{when(s.created_at)}</td>
                <td style={cell}><button type="button" style={btn(false)} onClick={() => { if (window.confirm(`Allow emails to ${s.email} again?`)) run(() => api.emailRemoveSuppression(s.id), "Removed."); }}>Remove</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td style={cell} colSpan={4}>Nobody yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
