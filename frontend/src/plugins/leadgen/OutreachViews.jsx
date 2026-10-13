import React, { useEffect, useState } from "react";
import { C } from "../../tokens";
import { api } from "../../api/apiClient";
import { Note, Pill, btn, card, cell, input, th, useAction, useLoad, when } from "../../adminPortal/ui";
import { askConfirm, askText } from "./Dialogs";

const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];
const PRESETS = [["one.com", "one.com"], ["gmail", "Google Workspace / Gmail"], ["outlook", "Microsoft 365 / Outlook"], ["zoho", "Zoho Mail"], ["", "Other (enter servers)"]];
const STATUS_TONE = { active: "green", graduated: "green", warming: "blue", paused: "amber", error: "red", connected: "slate", running: "green", draft: "slate", completed: "blue" };
const STATUS_TEXT = { active: "Sending", graduated: "Sending", warming: "Warming up", paused: "Paused", error: "Needs attention", connected: "Warm-up not started", running: "Running", draft: "Draft", completed: "Finished" };
const CATEGORY = { interested: ["Interested", "green"], question: ["Question", "blue"], not_interested: ["Not interested", "slate"], ooo: ["Out of office", "slate"], unsubscribe: ["Unsubscribe", "red"] };
const row = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const label = { fontSize: 12, fontWeight: 600, color: C.slate, display: "grid", gap: 4 };
const small = { fontSize: 12, color: C.slate };

// The one thing a person needs to know about a mailbox right now, with its colour and any action.
const TONES = { red: { bg: "#fef2f2", ink: "#b91c1c" }, amber: { bg: "#fffbeb", ink: "#92400e" }, blue: { bg: "#eff6ff", ink: "#1e40af" }, green: { bg: "#f0fdf4", ink: "#166534" } };
export function readiness(m) {
  if (m.status === "error") return { tone: "red", title: "Connection problem.", body: "The mailbox login is failing, so nothing can send. Check the password in Settings, then use Test connection." };
  if (!m.spf_verified) return { tone: "red", title: "SPF record missing.", body: "Add it below. Without it most receivers reject the mail, so this mailbox can't send yet." };
  if (!m.dkim_verified && !m.dkim_override) return { tone: "amber", title: "DKIM record missing.", body: "Add it below to start sending, or choose to send without it at the risk of more mail going to spam.", action: "skip" };
  if (!m.dkim_verified && m.dkim_override) {
    const next = m.status === "connected" ? " Next step: start warm-up." : "";
    return { tone: "amber", title: "Sending without DKIM.", body: `More of your emails may land in spam and your domain's reputation can suffer. Bounces over 2% still pause this mailbox.${next}`, action: "require" };
  }
  if (m.status === "connected") return { tone: "blue", title: "Ready to warm up.", body: "Your DNS records are in place. Start warm-up to begin building this mailbox's sending reputation." };
  if (m.status === "paused") return { tone: "amber", title: "Sending is paused.", body: m.pause_reason || "Start it again when you are ready." };
  if (m.status === "warming") return { tone: "blue", title: "Warming up.", body: `Day ${m.consecutive_healthy_days} of about 21. Campaigns send automatically at a gentle pace until it graduates.` };
  return null;
}

function Check({ ok, children, tip }) {
  return <span title={tip} style={{ fontSize: 12, color: ok ? C.green : C.red, fontWeight: 600, cursor: tip ? "help" : undefined }}>{ok ? "✓" : "✗"} {children}</span>;
}

function CopyBox({ text }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked: the text is still selectable */ }
  };
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", background: C.bg || "#f3f4f6", borderRadius: 6, padding: "3px 8px", maxWidth: "100%" }}>
      <code style={{ fontSize: 12, wordBreak: "break-all", userSelect: "all" }}>{text}</code>
      <button title="Copy to the clipboard" type="button" style={{ ...btn(false), padding: "1px 8px", fontSize: 11 }} onClick={copy}>{done ? "Copied" : "Copy"}</button>
    </span>
  );
}

// What is still missing for a mailbox's domain, with the exact record to add. Re-checks by itself
// every 90 seconds while the page is open so the ticks turn green without pressing anything.
function SetupGuide({ mailbox: m, onCheck, onAuto }) {
  // A DKIM step the person chose to skip is not shown as outstanding.
  const steps = (m.setup || []).filter((x) => !(x.key === "dkim" && m.dkim_override));
  const [selector, setSelector] = useState(m.dkim_selector || "");
  const missing = steps.length > 0;
  useEffect(() => {
    if (!missing) return undefined;
    const id = setInterval(() => { onAuto(selector.trim() || undefined); }, 90000);
    return () => clearInterval(id);
  }, [missing, selector]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!missing) return null;
  const required = steps.some((x) => x.key === "spf" || x.key === "dkim");
  return (
    <div style={{ display: "grid", gap: 10, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>DNS records to add for {m.email.split("@")[1]}</div>
      <div style={small}>Add {steps.length === 1 ? "this record" : "these records"} where you manage your domain's DNS (your domain registrar or hosting provider). Changes can take a few minutes to an hour, and this page re-checks automatically.</div>
      {steps.map((s) => (
        <div key={s.key} style={{ display: "grid", gap: 4, fontSize: 12 }}>
          <div style={{ fontWeight: 700 }}>{s.title} <span style={{ fontWeight: 400, color: C.slate }}>· {s.why}</span></div>
          <div style={row}><span style={small}>Type</span><b>{s.type}</b><span style={small}>Name</span><CopyBox text={s.host} /></div>
          {s.value ? <div style={row}><span style={small}>Value</span><CopyBox text={s.value} /></div> : null}
          {s.howto ? <div style={small}>{s.howto}</div> : null}
          {s.key === "dkim" && (
            <label style={{ ...row, fontSize: 12 }}>
              <span style={small}>{s.note}</span>
              <input style={{ ...input, width: 200 }} placeholder="DKIM selector, for example google" aria-label="DKIM selector" title="The name your mail provider gave the DKIM record" value={selector} onChange={(e) => setSelector(e.target.value)} />
            </label>
          )}
        </div>
      ))}
      <div style={row}>
        <button title="Look up the records now and update this mailbox" type="button" style={btn(true)} onClick={() => onCheck(selector.trim() || undefined)}>Verify DNS records</button>
        {!required ? <span style={small}>Optional. It improves how receivers treat your mail.</span> : null}
      </div>
    </div>
  );
}

// ── Shared outreach store ─────────────────────────────────────────────────
// Mailboxes and campaigns are each fetched once here instead of separately in every view that
// needs them (MailboxesView, CampaignsView and FindView all used to run their own duplicate
// api.emailMailboxes/api.emailCampaigns calls). Instantiate once in the shell and pass down.
export function useOutreachData() {
  const [mailboxData, mailboxErr, reloadMailboxes] = useLoad(api.emailMailboxes);
  const [campaignData, campaignErr, reloadCampaigns] = useLoad(api.emailCampaigns);
  return {
    mailboxes: mailboxData?.mailboxes || [],
    campaigns: campaignData?.campaigns || [],
    loading: mailboxData === null || campaignData === null,
    error: mailboxErr || campaignErr,
    reloadMailboxes,
    reloadCampaigns,
  };
}

// ── Mailboxes ───────────────────────────────────────────────────────────────
const blankBox = { email: "", display_name: "", preset: "one.com", password: "", smtp_host: "", smtp_port: "", imap_host: "", imap_port: "", username: "", max_daily_target: 40, signature: "" };

// Extra "send as" addresses for one mailbox (set up at the email provider first), usable per campaign.
function AliasBox({ mailbox: m, run }) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const domain = m.email.split("@")[1];
  const aliases = m.aliases || [];
  if (!open && !aliases.length) {
    return <div><button type="button" style={btn(false)} title="Let this mailbox send as another address on your domain, like sales@" onClick={() => setOpen(true)}>Add sender alias</button></div>;
  }
  return (
    <div style={{ display: "grid", gap: 6, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
      <div style={small}>Aliases: other addresses on @{domain} this mailbox can send as. Create the alias at your email provider first, then add it here and pick it in a campaign.</div>
      {aliases.map((a) => (
        <div key={a.address} style={row}>
          <span style={{ fontSize: 13 }}>{a.name ? `${a.name} <${a.address}>` : a.address}</span>
          <button title="Remove this alias. Campaigns using it go back to the mailbox address" type="button" style={btn(false)} onClick={() => run(() => api.emailRemoveAlias(m.id, a.address), "Alias removed.")}>Remove</button>
        </div>
      ))}
      <div style={row}>
        <input style={{ ...input, width: 220 }} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={`sales@${domain}`} aria-label="Alias address" />
        <input style={{ ...input, width: 160 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name shown (optional)" aria-label="Alias name" />
        <button title="Save this alias on the mailbox" type="button" style={btn(true, !address.trim())} disabled={!address.trim()} onClick={() => run(async () => {
          await api.emailAddAlias(m.id, address.trim(), name.trim());
          setAddress(""); setName("");
        }, "Alias added.")}>Add alias</button>
        <button type="button" style={btn(false)} title="Clear the fields" onClick={() => { setAddress(""); setName(""); }}>Reset</button>
      </div>
    </div>
  );
}

export function MailboxesView({ outreach }) {
  const [overview] = useLoad(api.emailOverview);
  const [msg, run] = useAction(outreach.reloadMailboxes);
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
  }, "Mailbox connected. Start warm-up once its DNS records are verified.");

  const boxes = outreach.mailboxes;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Note error>{outreach.error}</Note>
      <Note error={msg.error}>{msg.text}</Note>
      {overview && !overview.warmupPartnerReady && (
        <Note>Warm-up uses your own mailboxes until the Outreach team adds the platform mailbox. Connect two or more mailboxes so they warm each other up.</Note>
      )}
      <div style={row}>
        <div style={small}>Each mailbox warms up for about 3–4 weeks (5 a day rising to your daily target), then sends campaigns. Bounces over 2% pause it automatically.</div>
        <button title="Close without saving" type="button" style={{ ...btn(true), marginLeft: "auto" }} onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "Connect mailbox"}</button>
      </div>

      {adding && (
        <div style={{ ...card, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <label style={label}>Email address<input style={input} value={form.email} onChange={set("email")} placeholder="sam@yourcompany.com" /></label>
            <label style={label}>Name people see<input style={input} value={form.display_name} onChange={set("display_name")} placeholder="Sam Smith" /></label>
            <label style={label}>Email provider
              <select title="Pick your email provider so the server settings are filled in for you" style={input} value={form.preset} onChange={set("preset")}>{PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
            <label style={label}>Password{form.preset === "gmail" || form.preset === "outlook" ? " (an app password)" : ""}
              <input style={input} type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
            </label>
            <label style={label} title="The most emails this mailbox will send a day once warmed up. Start low: 40 is safe"><span>Daily target (emails)</span><input style={input} type="number" min={5} max={100} value={form.max_daily_target} onChange={set("max_daily_target")} /></label>
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
          <div style={row}>
            <button title="Check the login works, then save the mailbox" type="button" style={btn(true)} onClick={connect}>Test and connect</button>
            <button type="button" style={btn(false)} title="Clear every field" onClick={() => setForm(blankBox)}>Reset</button>
          </div>
        </div>
      )}

      {boxes.length === 0 && !adding && <div style={{ ...card, ...small }}>No mailboxes yet. Connect the mailbox your campaigns should send from.</div>}
      {boxes.map((m) => {
        const dns = m.dns || {};
        const sending = ["warming", "active", "graduated"].includes(m.status);
        const note = readiness(m);
        const skipDkim = async () => {
          if (await askConfirm({ title: "Send without DKIM?", body: "Without DKIM, Gmail, Outlook and others are much more likely to put your emails in spam, and your domain's reputation can suffer, including for your normal email. You can turn this off at any time. Bounces over 2% still pause the mailbox, and warm-up limits still apply.", confirm: "Send without DKIM", danger: true })) run(() => api.emailDkimOverride(m.id, true), "This mailbox can now send without DKIM.");
        };
        return (
          <div key={m.id} style={{ ...card, display: "grid", gap: 12 }}>
            <div style={row}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{m.email}</span>
              <Pill tone={STATUS_TONE[m.status]}>{STATUS_TEXT[m.status] || m.status}</Pill>
              <span style={{ ...small, marginLeft: "auto" }} title="What this mailbox has done so far today">
                Today: {m.today_campaign_sent} campaign and {m.today_warmup_sent} warm-up sent · {m.today_replies} {m.today_replies === 1 ? "reply" : "replies"} · {m.today_bounced} {m.today_bounced === 1 ? "bounce" : "bounces"}
              </span>
            </div>
            {m.last_error && <div style={{ fontSize: 12, color: C.red }}>{m.last_error}</div>}

            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ ...row, gap: 14 }}>
                <Check ok={m.spf_verified} tip="SPF: a DNS record listing which servers may send mail for your domain">SPF</Check>
                <Check ok={m.dkim_verified || m.dkim_override} tip={m.dkim_override && !m.dkim_verified ? "DKIM is skipped: you chose to send without it" : "DKIM: a signature that proves your email wasn't changed on the way"}>{m.dkim_override && !m.dkim_verified ? "DKIM (skipped)" : "DKIM"}</Check>
                <Check ok={m.dmarc_verified} tip="DMARC: tells receiving servers what to do with mail that fails SPF or DKIM. Recommended, not required">DMARC</Check>
                <Check ok={m.mx_verified} tip="MX: the domain can receive mail, so replies reach you">MX</Check>
                <span style={small}>Bounce rate, last 7 days: {(m.bounce_rate_7d * 100).toFixed(1)}%</span>
                <button type="button" style={{ ...btn(false), marginLeft: "auto" }} title="Look up this domain's SPF, DKIM, DMARC and MX records now" onClick={() => run(() => api.emailCheckDns(m.id), "DNS records re-checked.")}>Re-check DNS</button>
              </div>
              {note && (
                <div role="status" style={{ fontSize: 12.5, color: TONES[note.tone].ink, background: TONES[note.tone].bg, borderRadius: 8, padding: "9px 12px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ flex: "1 1 260px", lineHeight: 1.5 }}><strong>{note.title}</strong> {note.body}</span>
                  {note.action === "skip" && <button type="button" style={btn(false)} title="Send without a DKIM record. Mail is more likely to be junked" onClick={skipDkim}>Send without DKIM…</button>}
                  {note.action === "require" && <button type="button" style={btn(false)} title="Go back to requiring DKIM before this mailbox sends" onClick={() => run(() => api.emailDkimOverride(m.id, false), "DKIM is required again.")}>Require DKIM</button>}
                </div>
              )}
            </div>

            <SetupGuide mailbox={m} onCheck={(sel) => run(() => api.emailCheckDns(m.id, sel), "DNS records checked.")}
              onAuto={(sel) => api.emailCheckDns(m.id, sel).then(outreach.reloadMailboxes).catch(() => {})} />
            {(dns.recommendations || []).filter((r) => /unavailable|No DKIM record found/.test(r)).map((r) => <div key={r} style={small}>{r}</div>)}

            <div style={row}>
              {!sending && <button type="button" style={btn(true, !m.spf_verified || !(m.dkim_verified || m.dkim_override))} disabled={!m.spf_verified || !(m.dkim_verified || m.dkim_override)} title={m.spf_verified && (m.dkim_verified || m.dkim_override) ? "Begin the gradual ramp-up that builds your sending reputation" : "Add the DNS records above first"} onClick={() => run(() => api.emailWarmup(m.id, "start"), "Warm-up started.")}>Start warm-up</button>}
              {sending && <button type="button" style={btn(false)} title="Stop sending from this mailbox until you start it again" onClick={() => run(() => api.emailWarmup(m.id, "pause"), "Sending paused.")}>Pause sending</button>}
              {!sending && <button type="button" style={btn(false)} title="For a mailbox that already sends normal email every day" onClick={async () => {
                if (await askConfirm({ title: "Skip warm-up?", body: "Only do this for a mailbox that already sends email every day. It will send up to its daily target straight away.", confirm: "Skip warm-up" })) run(() => api.emailWarmup(m.id, "skip"), "Sending at full volume.");
              }}>Skip warm-up…</button>}
              <button type="button" style={btn(false)} title="Check the mailbox login and servers work" onClick={() => run(() => api.emailTestMailbox(m.id), "Connection works.")}>Test connection</button>
              <button type="button" style={btn(false)} title="Change the name, daily target, password or signature" onClick={() => { setEditing(editing === m.id ? "" : m.id); setPatch({ display_name: m.display_name, max_daily_target: m.max_daily_target, signature: m.signature, password: "" }); }}>Settings</button>
              <span style={{ flex: 1 }} />
              <button type="button" style={btn(false)} title="Disconnect this mailbox. Campaigns stop using it" onClick={async () => { if (await askConfirm({ title: `Disconnect ${m.email}?`, body: "Campaigns stop using it. Nothing is deleted from your email account.", confirm: "Disconnect", danger: true })) run(() => api.emailDeleteMailbox(m.id), "Mailbox disconnected."); }}>Disconnect</button>
            </div>
            <AliasBox mailbox={m} run={run} />
            {editing === m.id && (
              <div style={{ display: "grid", gap: 8, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                  <label style={label}>Name people see<input style={input} value={patch.display_name} onChange={(e) => setPatch({ ...patch, display_name: e.target.value })} /></label>
                  <label style={label}>Daily target<input style={input} type="number" min={5} max={100} value={patch.max_daily_target} onChange={(e) => setPatch({ ...patch, max_daily_target: e.target.value })} /></label>
                  <label style={label}>New password (optional)<input style={input} type="password" autoComplete="new-password" value={patch.password} onChange={(e) => setPatch({ ...patch, password: e.target.value })} /></label>
                </div>
                <label style={label}>Signature<textarea style={{ ...input, minHeight: 60 }} value={patch.signature} onChange={(e) => setPatch({ ...patch, signature: e.target.value })} /></label>
                <div style={row}>
                  <button title="Save the changes to this mailbox" type="button" style={btn(true)} onClick={() => run(async () => {
                    await api.emailUpdateMailbox(m.id, { ...patch, max_daily_target: Number(patch.max_daily_target) || 40, password: patch.password || null });
                    setEditing("");
                  }, "Saved.")}>Save</button>
                  <button type="button" style={btn(false)} title="Put the fields back to what is saved"
                    onClick={() => setPatch({ display_name: m.display_name, max_daily_target: m.max_daily_target, signature: m.signature, password: "" })}>Reset</button>
                </div>
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
      <label style={label} title="Only you see this name"><span>Campaign name</span><input style={input} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></label>
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
        <label style={label} title="The shortest wait between two emails from the same mailbox"><span>Gap between emails (seconds)</span><input style={{ ...input, width: 110 }} type="number" min={30} value={c.min_delay_seconds} onChange={(e) => setC({ ...c, min_delay_seconds: e.target.value })} /></label>
      </div>
      <div style={small}>Hours are in your company's timezone. Use {"{{first_name}}"}, {"{{last_name}}"} and {"{{company}}"} in subjects and emails. Follow-ups with no subject go as a reply in the same thread.</div>
      {c.steps.map((s, i) => (
        <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, display: "grid", gap: 8 }}>
          <div style={row}>
            <strong style={{ fontSize: 13 }}>Email {i + 1}</strong>
            {i > 0 && <label style={{ ...row, ...small }}>wait <input style={{ ...input, width: 64 }} type="number" min={1} value={s.delay_days} onChange={(e) => step(i, "delay_days", e.target.value)} /> days after email {i}</label>}
            {i > 0 && <button title="Remove this step from the campaign" type="button" style={{ ...btn(false), marginLeft: "auto" }} onClick={() => setC({ ...c, steps: c.steps.filter((_, j) => j !== i) })}>Remove</button>}
          </div>
          <input style={input} placeholder={i === 0 ? "Subject" : "Subject (empty = reply in the same thread)"} value={s.subject} onChange={(e) => step(i, "subject", e.target.value)} />
          <textarea style={{ ...input, minHeight: 120 }} value={s.body} onChange={(e) => step(i, "body", e.target.value)} />
        </div>
      ))}
      <div style={row}>
        {c.steps.length < 6 && <button title="Add another email that is sent if there is no reply" type="button" style={btn(false)} onClick={() => setC({ ...c, steps: [...c.steps, { subject: "", body: "Hi {{first_name}},\n\n", delay_days: 3 }] })}>Add follow-up</button>}
        <button title="Save the changes to this campaign" type="button" style={{ ...btn(true), marginLeft: "auto" }} onClick={save}>Save campaign</button>
        <button type="button" style={btn(false)} title="Put everything back to how it was when you opened this" onClick={() => setC(initial)}>Reset</button>
        <button title="Close without saving" type="button" style={btn(false)} onClick={onCancel}>Cancel</button>
      </div>
      <div style={small}>Every email gets an unsubscribe link automatically. Leads who reply, bounce or unsubscribe stop getting follow-ups.</div>
    </div>
  );
}

function CampaignDetail({ id, mailboxes, outreach, onBack }) {
  const [data, err, reload] = useLoad(() => api.emailCampaign(id), [id]);
  const [msg, run] = useAction(reload);
  const [paste, setPaste] = useState("");
  const [added, setAdded] = useState("");
  const [editing, setEditing] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  if (!data) return <Note error>{err}</Note>;
  const c = data.campaign;
  if (editing) {
    return <CampaignEditor initial={{ ...c, steps: c.steps.map((s) => ({ subject: s.subject, body: s.body, delay_days: s.delay_days })) }} mailboxes={mailboxes}
      onSaved={() => { setEditing(false); reload(); }} onCancel={() => setEditing(false)} />;
  }
  const leads = parseLeads(paste);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {findOpen && <FindEmailDrawer outreach={outreach} defaultTarget={c.id} onClose={() => { setFindOpen(false); reload(); }} />}
      <div style={row}>
        <button title="Back to all campaigns" type="button" style={btn(false)} onClick={onBack}>← All campaigns</button>
        <strong style={{ fontSize: 16 }}>{c.name}</strong>
        <Pill tone={STATUS_TONE[c.status]}>{STATUS_TEXT[c.status] || c.status}</Pill>
        <span style={{ marginLeft: "auto", ...row }}>
          {c.status !== "running" ? <button title="Start sending this campaign" type="button" style={btn(true)} onClick={() => run(() => api.emailCampaignStatus(c.id, "running"), "Running. Emails go out during its sending hours.")}>Start</button>
            : <button title="Hold this. Nothing more is spent until you resume" type="button" style={btn(false)} onClick={() => run(() => api.emailCampaignStatus(c.id, "paused"), "Paused.")}>Pause</button>}
          <button title="Look for a person's work email from their name and company" type="button" style={btn(false)} onClick={() => setFindOpen(true)}>Find a work email</button>
          <button title="Change this campaign's emails and schedule" type="button" style={btn(false)} onClick={() => setEditing(true)}>Edit</button>
          <button title="Delete this campaign permanently" type="button" style={btn(false)} onClick={async () => { if (await askConfirm({ title: `Delete ${c.name}?`, body: "Its leads and emails are deleted with it.", confirm: "Delete campaign", danger: true })) run(() => api.emailDeleteCampaign(c.id).then(onBack)); }}>Delete</button>
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
          <button title="Add these people to the campaign" type="button" style={btn(true, !leads.length)} disabled={!leads.length} onClick={() => run(async () => {
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
                <td style={cell}><button title="Take this person out of the campaign" type="button" style={btn(false)} onClick={() => run(() => api.emailRemoveLead(c.id, l.id))}>Remove</button></td>
              </tr>
            ))}
            {!(c.lead_list || []).length && <tr><td style={cell} colSpan={6}>No leads yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CampaignsView({ outreach, onNew }) {
  const [open, setOpen] = useState("");
  const [creating, setCreating] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const mailboxes = outreach.mailboxes;
  if (open) return <CampaignDetail id={open} mailboxes={mailboxes} outreach={outreach} onBack={() => { setOpen(""); outreach.reloadCampaigns(); }} />;
  if (creating) {
    return <CampaignEditor initial={{ ...blankCampaign, mailbox_ids: mailboxes.map((m) => m.id) }} mailboxes={mailboxes}
      onSaved={(c) => { setCreating(false); setOpen(c.id); outreach.reloadCampaigns(); }} onCancel={() => setCreating(false)} />;
  }
  const camps = outreach.campaigns;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {findOpen && <FindEmailDrawer outreach={outreach} onClose={() => { setFindOpen(false); outreach.reloadCampaigns(); }} />}
      <Note error>{outreach.error}</Note>
      <div style={row}>
        <button title="Look for a person's work email from their name and company" type="button" style={btn(false)} onClick={() => setFindOpen(true)}>Find a work email</button>
        <button title="Write a new email campaign" type="button" style={{ ...btn(true), marginLeft: "auto" }} onClick={() => (onNew ? onNew() : setCreating(true))}>New campaign</button>
      </div>
      {camps.length === 0 && <div style={{ ...card, ...small }}>No campaigns yet. Create one, add leads, then start it.</div>}
      {camps.map((c) => (
        <button type="button" title="Open this campaign" key={c.id} onClick={() => setOpen(c.id)} style={{ ...card, textAlign: "left", cursor: "pointer", display: "grid", gap: 6 }}>
          <div style={row}><strong>{c.name}</strong><Pill tone={STATUS_TONE[c.status]}>{STATUS_TEXT[c.status] || c.status}</Pill>
            <span style={{ ...small, marginLeft: "auto" }}>{c.steps.length} email{c.steps.length === 1 ? "" : "s"} · {c.mailbox_ids.length} mailbox{c.mailbox_ids.length === 1 ? "" : "es"}</span></div>
          <div style={small}>{c.leads} leads · {c.sent} sent · {c.replied} replies ({c.reply_rate}%) · {c.bounced} bounced</div>
        </button>
      ))}
    </div>
  );
}

// ── Find emails (a drawer reachable from the campaign list and an open campaign, not its own
// top-level tab -- finding a missing email is a step in running a sequence, not a destination) ──
export function FindEmailDrawer({ outreach, onClose, defaultTarget }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.45)", zIndex: 1000, display: "flex", justifyContent: "flex-end" }}>
      <div role="dialog" aria-label="Find a work email" onClick={(e) => e.stopPropagation()}
        style={{ width: "min(100%, 480px)", height: "100%", background: "#fff", overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 16px 12px 20px", borderBottom: `1px solid ${C.border}` }}>
          <strong style={{ fontSize: 15, flex: 1 }}>Find a work email</strong>
          <button title="Close this panel" type="button" style={btn(false)} onClick={onClose}>Close</button>
        </div>
        <div style={{ padding: 16 }}>
          <FindView outreach={outreach} defaultTarget={defaultTarget} />
        </div>
      </div>
    </div>
  );
}

// ── Find emails ─────────────────────────────────────────────────────────────
export function FindView({ outreach, defaultTarget = "" }) {
  const [q, setQ] = useState({ first_name: "", last_name: "", company_name: "", domain: "" });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(defaultTarget);
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
        <div style={row}>
          <button title="Look for the work email" type="button" style={btn(true, busy)} disabled={busy} onClick={find}>{busy ? "Searching…" : "Find email"}</button>
          <button type="button" style={btn(false)} title="Clear the fields and the result" onClick={() => { setQ({ first_name: "", last_name: "", company_name: "", domain: "" }); setResult(null); }}>Reset</button>
        </div>
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
          {outreach.campaigns.length === 0 ? (
            <div style={small}>No campaigns yet, so there's nowhere to add this email to. Create a campaign first, then come back and find emails for it.</div>
          ) : (
            <div style={row}>
              <select title="Pick the campaign to add this person to" style={input} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Add to campaign…</option>
                {outreach.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button title="Add this person to the chosen campaign" type="button" style={btn(false, !target)} disabled={!target} onClick={() => run(() => api.emailAddLeads(target, [{
                email: result.email, first_name: result.first_name, last_name: result.last_name, company: result.company_name || "",
              }]), "Added to the campaign.")}>Add</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Inbox (Replies + Do Not Email, as inner tabs of one view) ───────────────
export function RepliesView() {
  const [sub, setSub] = useState("replies");
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={row}>
        <button title="People who replied to your emails" type="button" style={btn(sub === "replies")} onClick={() => setSub("replies")}>Replies</button>
        <button title="People who must never be emailed again" type="button" style={btn(sub === "suppression")} onClick={() => setSub("suppression")}>Do Not Email</button>
      </div>
      {sub === "replies" ? <RepliesList /> : <DoNotEmailView />}
    </div>
  );
}

function RepliesList() {
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
          <button type="button" title="Show these replies" key={k || "all"} style={btn(category === k)} onClick={() => setCategory(k)}>{l}</button>
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
            <select title="Label this reply so you can find it later" style={{ ...input, padding: "4px 8px" }} value={r.category} onChange={(e) => run(() => api.emailReplyCategory(r.id, e.target.value))}>
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
        <button title="Never email this address or domain again" type="button" style={btn(true, !entry.trim())} disabled={!entry.trim()} onClick={() => run(async () => { await api.emailAddSuppression(entry.trim()); setEntry(""); }, "Added.")}>Add</button>
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
                <td style={cell}><button title="Allow emails to this address again" type="button" style={btn(false)} onClick={async () => { if (await askConfirm({ title: `Allow emails to ${s.email} again?`, confirm: "Allow again" })) run(() => api.emailRemoveSuppression(s.id), "Removed."); }}>Remove</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td style={cell} colSpan={4}>Nobody yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
