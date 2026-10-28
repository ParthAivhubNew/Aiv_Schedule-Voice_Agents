import React, { useEffect, useState } from "react";
import { Loader } from "../../app/Loader";
import { C } from "../../tokens";
import { api } from "../../api/apiClient";
import { Note, Pill, btn as baseBtn, card, cell, input, th, useAction, useLoad, when } from "../../adminPortal/ui";
import { askConfirm, askText } from "./Dialogs";
import { useConnection } from "../../hooks/useConnections";
import { ArrowLeft, ChevronRight, Mail, MoreHorizontal, Phone, Plus, Trash2 } from "lucide-react";

// "Reply with times": the free times in their own time zone and a booking link, as the body of a reply.
function ReplyWithTimes({ r }) {
  const { available } = useConnection("booking_in_email");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  if (!available) return null;
  return (
    <>
    <button type="button" style={btn(false)} disabled={busy} title="Opens a reply with free times in their time zone and a link to pick their own"
      onClick={async () => {
        setBusy(true);
        try {
          const t = await api.getSlotsByEmail(r.email);
          const subject = r.subject.startsWith("Re:") ? r.subject : `Re: ${r.subject}`;
          window.location.href = `mailto:${r.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`Hi ${(r.name || "").split(" ")[0] || "there"},\n\n${t.text}\n`)}`;
        } catch (e) { setProblem(e.message || "Couldn't get your free times."); } finally { setBusy(false); }
      }}>Reply with times</button>
    {problem ? <span style={{ fontSize: 12, color: C.red }}>{problem}</span> : null}
    </>
  );
}

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
  if (!m.spf_verified) return { tone: "red", title: "Permission to send is not set up (SPF).", body: "Add the setting below. Without it most inboxes reject your emails, so this mailbox cannot send yet." };
  if (!m.dkim_verified && !m.dkim_override) return { tone: "amber", title: "Email signature is not set up (DKIM).", body: "Add the setting below to start sending, or send without it and accept that more of your emails may go to spam.", action: "skip" };
  if (!m.dkim_verified && m.dkim_override) {
    const next = m.status === "connected" ? " Next step: start warm-up." : "";
    return { tone: "amber", title: "Sending without DKIM.", body: `More of your emails may land in spam and your domain's reputation can suffer. Bounces over 2% still pause this mailbox.${next}`, action: "require" };
  }
  if (m.status === "connected") return { tone: "blue", title: "Ready to warm up.", body: "Your domain settings are in place. Next, start warm-up: this mailbox sends a few emails a day and slowly sends more, so inboxes learn to trust it and your emails do not land in spam." };
  if (m.status === "paused") return { tone: "amber", title: "Sending is paused.", body: m.pause_reason || "Start it again when you are ready." };
  if (m.status === "warming") return { tone: "blue", title: "Warming up.", body: `Day ${m.consecutive_healthy_days} of about 21. This mailbox sends a few emails a day and sends more each day, until it reaches your daily target. Do not rush it: it protects your emails from going to spam.` };
  return null;
}

// A passing check is green. A missing one is red when sending depends on it, and a quiet grey "not set" when it is only recommended.
function Check({ ok, children, tip, optional = false }) {
  const color = ok ? C.green : optional ? C.slate : C.red;
  return <span title={tip} style={{ fontSize: 12, color, fontWeight: 600, cursor: tip ? "help" : undefined }}>{ok ? "✓" : optional ? "–" : "✗"} {children}{!ok && optional ? " (not set)" : ""}</span>;
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
      <div style={{ fontSize: 13, fontWeight: 700 }}>Settings to add for {m.email.split("@")[1]}</div>
      <div style={small}>These {steps.length === 1 ? "is a short setting" : "are short settings"} that prove your emails really come from you, so they reach inboxes instead of spam. Add {steps.length === 1 ? "it" : "each one"} where you manage your domain, usually the company where you bought it, such as GoDaddy or Namecheap, under \"DNS settings\". For each one, copy the Name and Value below into a new record of the Type shown. It can take a few minutes to an hour to work, and this page checks again by itself.</div>
      {steps.map((s) => (
        <div key={s.key} style={{ display: "grid", gap: 4, fontSize: 12 }}>
          <div style={{ fontWeight: 700 }}>{s.title} <span style={{ fontWeight: 400, color: C.slate }}>· {s.why}</span></div>
          <div style={row}><span style={small}>Type</span><b>{s.type}</b><span style={small}>Name (or Host)</span><CopyBox text={s.host} /></div>
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
        <button title="Check now whether these settings are in place" type="button" style={btn(true)} onClick={() => onCheck(selector.trim() || undefined)}>Check my settings</button>
        {!required ? <span style={small}>Optional, but it helps more of your emails reach the inbox.</span> : null}
      </div>
    </div>
  );
}

// ── Shared outreach store ─────────────────────────────────────────────────
// Mailboxes and campaigns are each fetched once here instead of separately in every view that
// needs them (MailboxesView, CampaignsView and FindView all used to run their own duplicate
// api.emailMailboxes/api.emailCampaigns calls). Instantiate once in the shell and pass down.
// The selected button wears the app's own colour (purple in Leads), not the owner portal's black.
const btn = (primary, disabled) => ({ ...baseBtn(primary, disabled), ...(primary ? { background: "var(--ui-accent)" } : {}) });

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

export function MailboxesView({ outreach, onViewSent }) {
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
        <div style={small}>Each mailbox warms up for about 3–4 weeks, rising to your daily target. Campaigns can send from day one in small numbers and grow as it warms up. Bounces over 2% pause it automatically.</div>
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
              <span style={{ ...small, marginLeft: "auto" }} title="What this mailbox has sent so far today, out of what it is allowed today. When campaign emails reach their allowance, the rest wait until tomorrow">
                Today: {m.today_campaign_sent} of {m.campaign_quota} campaign emails · {m.today_warmup_sent} of {m.warmup_quota} warm-up · {m.today_replies} {m.today_replies === 1 ? "reply" : "replies"} · {m.today_bounced} {m.today_bounced === 1 ? "bounce" : "bounces"}
              </span>
            </div>
            {m.last_error && <div style={{ fontSize: 12, color: C.red }}>{m.last_error}</div>}

            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ ...row, gap: 14 }}>
                <Check ok={m.spf_verified} tip="SPF: a DNS record listing which servers may send mail for your domain">SPF</Check>
                <Check ok={m.dkim_verified || m.dkim_override} tip={m.dkim_override && !m.dkim_verified ? "DKIM is skipped: you chose to send without it" : "DKIM: a signature that proves your email wasn't changed on the way"}>{m.dkim_override && !m.dkim_verified ? "DKIM (skipped)" : "DKIM"}</Check>
                <Check ok={m.dmarc_verified} optional tip="DMARC: tells receiving servers what to do with mail that fails SPF or DKIM. Recommended, not required">DMARC</Check>
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

            {!sending && (
              <div style={small}>
                <b>What is warm-up?</b> A brand-new mailbox that suddenly sends lots of email looks like spam to Gmail and Outlook. Warm-up fixes that: for about 3 weeks the mailbox sends a few emails a day, which grow slowly, and our system replies to some of them, so inboxes learn your emails are wanted. Skip it only if this mailbox already sends email every day.
              </div>
            )}
            <div style={row}>
              {!sending && <button type="button" style={btn(true, !m.spf_verified || !(m.dkim_verified || m.dkim_override))} disabled={!m.spf_verified || !(m.dkim_verified || m.dkim_override)} title={m.spf_verified && (m.dkim_verified || m.dkim_override) ? "Begin the gradual ramp-up that builds your sending reputation" : "Add the DNS records above first"} onClick={() => run(() => api.emailWarmup(m.id, "start"), "Warm-up started.")}>Start warm-up</button>}
              {sending && <button type="button" style={btn(false)} title="Stops everything this mailbox sends, warm-up and campaigns, until you start it again" onClick={() => run(() => api.emailWarmup(m.id, "pause"), "Sending paused.")}>Pause sending</button>}
              {(!sending || m.status === "warming") && <button type="button" style={btn(false)} title="For a mailbox that already sends normal email every day. Campaigns can then send straight away instead of after the first week of warm-up" onClick={async () => {
                if (await askConfirm({ title: "Skip warm-up?", body: "Only do this for a mailbox that already sends email every day. It will send up to its daily target straight away.", confirm: "Skip warm-up" })) run(() => api.emailWarmup(m.id, "skip"), "Sending at full volume.");
              }}>Skip warm-up…</button>}
              <button type="button" style={btn(false)} title="Check the mailbox login and servers work" onClick={() => run(() => api.emailTestMailbox(m.id), "Connection works.")}>Test connection</button>
              {onViewSent ? <button type="button" style={btn(false)} title="See every email this mailbox has sent, and what became of it" onClick={() => onViewSent(m.id)}>View sent</button> : null}
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
              <input type="radio" name="campaign-mailbox" checked={c.mailbox_ids.includes(m.id)} onChange={() => setC({ ...c, mailbox_ids: [m.id] })} />
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
      {c.steps.map((s, i) => (s.channel === "call" ? (
        <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, display: "grid", gap: 8, background: C.paperSoft }}>
          <div style={row}>
            <strong style={{ fontSize: 13 }}>Step {i + 1}: your AI caller phones them</strong>
            <label style={{ ...row, ...small }}>wait <input style={{ ...input, width: 64 }} type="number" min={1} value={s.delay_days} onChange={(e) => step(i, "delay_days", e.target.value)} /> days after step {i}</label>
            <label style={{ ...row, ...small }}>When
              <select style={input} value={s.condition || "always"} onChange={(e) => step(i, "condition", e.target.value)}>
                <option value="always">Always</option>
                <option value="no_reply">Only if they haven't replied</option>
                <option value="opened_no_reply">Only if they opened an email but haven't replied</option>
              </select>
            </label>
            <button title="Remove this call step from the campaign" type="button" style={{ ...btn(false), marginLeft: "auto" }} onClick={() => setC({ ...c, steps: c.steps.filter((_, j) => j !== i) })}>Remove</button>
          </div>
        </div>
      ) : (
        <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, display: "grid", gap: 8 }}>
          <div style={row}>
            <strong style={{ fontSize: 13 }}>{i === 0 ? "Email 1" : `Step ${i + 1}: email`}</strong>
            {i > 0 && <label style={{ ...row, ...small }}>wait <input style={{ ...input, width: 64 }} type="number" min={1} value={s.delay_days} onChange={(e) => step(i, "delay_days", e.target.value)} /> days after email {i}</label>}
            {i > 0 && <button title="Remove this step from the campaign" type="button" style={{ ...btn(false), marginLeft: "auto" }} onClick={() => setC({ ...c, steps: c.steps.filter((_, j) => j !== i) })}>Remove</button>}
          </div>
          <input style={input} placeholder={i === 0 ? "Subject" : "Subject (empty = reply in the same thread)"} value={s.subject} onChange={(e) => step(i, "subject", e.target.value)} />
          <textarea style={{ ...input, minHeight: 120 }} value={s.body} onChange={(e) => step(i, "body", e.target.value)} />
        </div>
      )))}
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
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(false);
  if (!data) return <Note error>{err}</Note>;
  const c = data.campaign;
  if (editing) {
    return <CampaignEditor initial={{ ...c, mailbox_ids: (c.mailbox_ids || []).slice(0, 1), steps: c.steps.map((s) => ({ subject: s.subject, body: s.body, delay_days: s.delay_days, channel: s.channel || "email", condition: s.condition || "always" })) }} mailboxes={mailboxes}
      onSaved={() => { setEditing(false); reload(); }} onCancel={() => setEditing(false)} />;
  }
  const leads = parseLeads(paste);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 10 }}>
        <button title="Back to all campaigns" type="button" onClick={onBack}
          style={{ justifySelf: "start", display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: "none", padding: "4px 0", color: C.slate, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          <ArrowLeft size={15} /> All campaigns
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 18, lineHeight: 1.25, overflowWrap: "anywhere" }}>{c.name}</strong>
          <Pill tone={STATUS_TONE[c.status]}>{STATUS_TEXT[c.status] || c.status}</Pill>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {c.status !== "running" ? <button title="Start sending this campaign" type="button" style={{ ...btn(true), flex: "1 1 auto", maxWidth: 220, minHeight: 40 }} onClick={() => run(() => api.emailCampaignStatus(c.id, "running"), "Running. Emails go out during its sending hours.")}>Start sending</button>
            : <button title="Hold this. Nothing more is spent until you resume" type="button" style={{ ...btn(false), flex: "1 1 auto", maxWidth: 220, minHeight: 40 }} onClick={() => run(() => api.emailCampaignStatus(c.id, "paused"), "Paused.")}>Pause</button>}
          <button title="Change this campaign's emails and schedule" type="button" style={{ ...btn(false), minHeight: 40 }} onClick={() => setEditing(true)}>Edit</button>
          <span style={{ position: "relative" }}>
            <button type="button" title="More" aria-label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}
              style={{ ...btn(false), minHeight: 40, minWidth: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 8px" }}><MoreHorizontal size={17} /></button>
            {menu ? (
              <>
                <div onClick={() => setMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 79 }} />
                <div className="ui-menu" role="menu" style={{ zIndex: 80 }}>
                  <button type="button" role="menuitem" className="ui-menu-item" style={{ color: C.red }}
                    onClick={async () => { setMenu(false); if (await askConfirm({ title: `Delete ${c.name}?`, body: "Its leads and emails are deleted with it.", confirm: "Delete campaign", danger: true })) run(() => api.emailDeleteCampaign(c.id).then(onBack)); }}>
                    <Trash2 size={15} /> Delete campaign
                  </button>
                </div>
              </>
            ) : null}
          </span>
        </div>
      </div>
      <Note error={msg.error}>{msg.text}</Note>
      {c.status === "running" && (c.lead_status?.active || 0) > 0 && (c.why || []).length ? (
        <div role="status" style={{ ...card, display: "grid", gap: 6 }}>
          <div style={row}>
            <strong style={{ fontSize: 13.5 }}>Why hasn't it sent yet?</strong>
            <button type="button" style={{ ...btn(false), marginLeft: "auto" }} title="Look again at everything the sender checks" onClick={reload}>Check again</button>
          </div>
          {c.why.map((w, i) => (
            <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5, color: TONES[w.level === "green" ? "green" : w.level === "red" ? "red" : "amber"].ink, background: TONES[w.level === "green" ? "green" : w.level === "red" ? "red" : "amber"].bg, borderRadius: 8, padding: "8px 11px" }}>{w.text}</div>
          ))}
        </div>
      ) : null}
      {!c.mailbox_ids.length ? (
        <div role="status" style={{ fontSize: 12.5, lineHeight: 1.5, color: TONES.amber.ink, background: TONES.amber.bg, borderRadius: 10, padding: "9px 12px" }}>
          No mailbox picked, so nothing can be sent yet. Choose one under Edit.
        </div>
      ) : null}
      <CampaignStats c={c} />
      <div style={{ ...card, display: "grid", gap: 10 }}>
        <strong style={{ fontSize: 14 }}>Steps</strong>
        <SequenceSteps steps={c.steps} />
      </div>
      <div style={{ ...card, padding: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14, marginRight: "auto" }}>Leads <span style={{ ...small, fontWeight: 500 }}>{c.leads}</span></strong>
          <button title="Add people to this campaign" type="button" aria-expanded={adding} style={{ ...btn(false), minHeight: 40, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setAdding((a) => !a)}>
            <Plus size={15} /> Add leads
          </button>
        </div>
        {adding ? (
          <div style={{ display: "grid", gap: 8, padding: "0 14px 14px" }}>
            <div style={small}>Paste one per line: email, first name, last name, company (or a CSV with those column headers). Addresses on your do-not-email list are skipped.</div>
            <textarea style={{ ...input, minHeight: 90, fontFamily: "monospace" }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"ann@client.com, Ann, Lee, Client Ltd"} />
            <div style={row}>
              <button title="Add these people to the campaign" type="button" style={btn(true, !leads.length)} disabled={!leads.length} onClick={() => run(async () => {
                const out = await api.emailAddLeads(c.id, leads);
                setPaste("");
                setAdding(false);
                const s = out.skipped;
                setAdded(`${out.added} added. Skipped: ${s.duplicate} already in, ${s.do_not_email} on the do-not-email list, ${s.invalid} not valid.`);
              })}>Add {leads.length || ""} lead{leads.length === 1 ? "" : "s"}</button>
            </div>
          </div>
        ) : null}
        {added ? <div style={{ ...small, padding: "0 14px 10px" }}>{added}</div> : null}
        {(c.lead_list || []).map((l) => (
          <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderTop: `1px solid ${C.borderLight}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflowWrap: "anywhere" }}>{`${l.first_name} ${l.last_name}`.trim() || l.email}</div>
              <div style={{ ...small, overflowWrap: "anywhere" }}>{[l.email, l.company].filter(Boolean).join(" · ")}</div>
              <div style={{ ...small, marginTop: 3 }} title="When this person is next due an email. It goes out at the next sending window after this time">
                {LEAD_TEXT[l.status] || l.status}{l.status === "active" ? ` · step ${l.step} of ${c.steps.length}` : ""}{l.next_at ? ` · due ${when(l.next_at)}` : ""}
              </div>
            </div>
            <button title="Take this person out of the campaign" aria-label={`Remove ${l.email}`} type="button" onClick={() => run(() => api.emailRemoveLead(c.id, l.id))}
              style={{ ...btn(false), minWidth: 40, minHeight: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0 }}><Trash2 size={15} /></button>
          </div>
        ))}
        {!(c.lead_list || []).length && <div style={{ ...small, padding: "12px 14px", borderTop: `1px solid ${C.borderLight}` }}>No leads yet. Add some, then start sending.</div>}
      </div>
    </div>
  );
}

const LEAD_TEXT = { active: "Getting emails", replied: "Replied", bounced: "Bounced", unsubscribed: "Unsubscribed", completed: "Finished", paused: "Paused" };

// "2 emails, then a call": what a campaign does, in words.
function stepsSummary(steps) {
  const emails = steps.filter((s) => s.channel !== "call").length;
  const calls = steps.length - emails;
  if (!steps.length) return "No steps yet";
  return `${emails} email${emails === 1 ? "" : "s"}${calls ? `, then ${calls === 1 ? "a call" : `${calls} calls`}` : ""}`;
}

// The campaign's numbers in one strip; on a list card it sits inside the card without its own border.
function CampaignStats({ c, bare = false }) {
  const items = [["Leads", c.leads], ["Sent", c.sent], ["Replies", c.replied, c.sent ? `${c.reply_rate}%` : ""], ["Bounced", c.bounced]];
  return (
    <div style={{ ...(bare ? { borderTop: `1px solid ${C.borderLight}`, paddingTop: 10 } : card), display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
      {items.map(([k, v, extra]) => (
        <div key={k} style={{ minWidth: 0 }}>
          <div style={{ fontSize: bare ? 17 : 20, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: C.ink }}>
            {v}{extra ? <span style={{ fontSize: 12, fontWeight: 600, color: C.slate }}> {extra}</span> : null}
          </div>
          <div style={small}>{k}</div>
        </div>
      ))}
    </div>
  );
}

// Each step in order: what is sent, and when, counted from the step before.
function SequenceSteps({ steps }) {
  if (!steps.length) return <div style={small}>No steps yet. Add the first email under Edit.</div>;
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
      {steps.map((s, i) => {
        const call = s.channel === "call";
        const Icon = call ? Phone : Mail;
        const delay = i === 0 ? "Straight away" : `${s.delay_days || 0} day${s.delay_days === 1 ? "" : "s"} later`;
        const cond = call && s.condition === "no_reply" ? ", if no reply" : call && s.condition === "opened_no_reply" ? ", if opened but no reply" : "";
        return (
          <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ width: 30, height: 30, borderRadius: 15, flexShrink: 0, display: "grid", placeItems: "center", background: call ? C.tealSoft : C.cobaltSoft, color: call ? C.teal : C.cobalt }}><Icon size={14} /></span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{call ? "Phone call" : s.subject || "Email with no subject"}</div>
              <div style={small}>{delay}{cond}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function CampaignsView({ outreach, onNew }) {
  const [open, setOpen] = useState("");
  const [creating, setCreating] = useState(false);
  const mailboxes = outreach.mailboxes;
  if (open) return <CampaignDetail id={open} mailboxes={mailboxes} outreach={outreach} onBack={() => { setOpen(""); outreach.reloadCampaigns(); }} />;
  if (creating) {
    return <CampaignEditor initial={{ ...blankCampaign, mailbox_ids: mailboxes.slice(0, 1).map((m) => m.id) }} mailboxes={mailboxes}
      onSaved={(c) => { setCreating(false); setOpen(c.id); outreach.reloadCampaigns(); }} onCancel={() => setCreating(false)} />;
  }
  const camps = outreach.campaigns;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Note error>{outreach.error}</Note>
      <div style={row}>
        <button title="Write a new email campaign" type="button" style={{ ...btn(true), marginLeft: "auto" }} onClick={() => (onNew ? onNew() : setCreating(true))}>New campaign</button>
      </div>
      {camps.length === 0 && <div style={{ ...card, ...small }}>No campaigns yet. Create one, add leads, then start it.</div>}
      {camps.map((c) => (
        <button type="button" title="Open this campaign" key={c.id} onClick={() => setOpen(c.id)} style={{ ...card, textAlign: "left", cursor: "pointer", display: "grid", gap: 10, width: "100%" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 15, overflowWrap: "anywhere" }}>{c.name}</strong>
                <Pill tone={STATUS_TONE[c.status]}>{STATUS_TEXT[c.status] || c.status}</Pill>
              </div>
              <div style={small}>
                {stepsSummary(c.steps)}
                {c.mailbox_ids.length ? ` · ${c.mailbox_ids.length} mailbox${c.mailbox_ids.length === 1 ? "" : "es"}` : <span style={{ color: TONES.amber.ink }}> · no mailbox yet</span>}
              </div>
            </div>
            <ChevronRight size={18} color={C.slate} style={{ flexShrink: 0, marginTop: 2 }} />
          </div>
          <CampaignStats c={c} bare />
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
export function RepliesView({ outreach, initial, onStarted }) {
  const [sub, setSub] = useState(initial?.sub || "replies");
  const [start, setStart] = useState(initial || null); // where a jump from another page asked to open, kept after the page forgets it
  useEffect(() => { if (initial) { setStart(initial); setSub(initial.sub || "replies"); onStarted?.(); } }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={row}>
        <button title="People who replied to your emails" type="button" style={btn(sub === "replies")} onClick={() => setSub("replies")}>Replies</button>
        <button title="Every email that went out, and what became of it" type="button" style={btn(sub === "sent")} onClick={() => setSub("sent")}>Sent</button>
        <button title="People who must never be emailed again" type="button" style={btn(sub === "suppression")} onClick={() => setSub("suppression")}>Do Not Email</button>
      </div>
      {sub === "replies" ? <RepliesList /> : sub === "sent" ? <SentList outreach={outreach} initialMailbox={start?.mailboxId || ""} key={start?.mailboxId || "all"} /> : <DoNotEmailView />}
    </div>
  );
}

const SENT_STATUS = { sent: ["Sent", "slate"], replied: ["Replied", "green"], bounced: ["Bounced", "red"], failed: ["Failed", "red"] };

// Every email that went out (warm-up traffic left out), newest first. Click one to read it as it was sent.
export function SentList({ outreach, initialMailbox = "" }) {
  const PAGE = 50;
  const [filters, setFilters] = useState({ mailbox_id: initialMailbox, campaign_id: "", status: "", kind: "", q: "" });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(""); // id of the email being read
  const [detail, setDetail] = useState(null);
  const run = React.useRef(0);

  const load = async (offset) => {
    const mine = ++run.current;
    setBusy(true);
    setError("");
    try {
      const r = await api.emailSent({ ...filters, limit: PAGE, offset });
      if (mine !== run.current) return;
      setRows((prev) => (offset ? [...prev, ...r.messages] : r.messages));
      setTotal(r.total);
    } catch (e) {
      if (mine === run.current) setError(e.message || "Couldn't load the sent emails.");
    } finally {
      if (mine === run.current) setBusy(false);
    }
  };
  useEffect(() => { load(0); }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const show = async (id) => {
    if (open === id) { setOpen(""); setDetail(null); return; }
    setOpen(id);
    setDetail(null);
    try { setDetail((await api.emailSentOne(id)).message); } catch (e) { setError(e.message || "Couldn't open that email."); }
  };
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });
  const reset = () => setFilters({ mailbox_id: "", campaign_id: "", status: "", kind: "", q: "" });
  const mailboxes = outreach?.mailboxes || [];
  const campaigns = outreach?.campaigns || [];
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Note error>{error}</Note>
      <div style={{ ...card, ...row }}>
        <input style={{ ...input, flex: "1 1 220px" }} value={filters.q} onChange={set("q")} placeholder="Search by address or subject" aria-label="Search sent emails" title="Find an email by who it went to or its subject" />
        <select style={input} value={filters.mailbox_id} onChange={set("mailbox_id")} aria-label="Mailbox" title="Only emails sent from this mailbox">
          <option value="">All mailboxes</option>{mailboxes.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
        </select>
        <select style={input} value={filters.campaign_id} onChange={set("campaign_id")} aria-label="Campaign" title="Only emails from this campaign">
          <option value="">All campaigns</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select style={input} value={filters.status} onChange={set("status")} aria-label="What happened" title="Only emails with this outcome">
          <option value="">Any outcome</option>{Object.entries(SENT_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select style={input} value={filters.kind} onChange={set("kind")} aria-label="Type" title="Campaign emails, or one-to-one emails sent through the API">
          <option value="">Campaign and one-to-one</option><option value="campaign">Campaign emails</option><option value="one_to_one">One-to-one emails</option>
        </select>
        <button type="button" style={btn(false)} title="Clear every filter" onClick={reset}>Reset</button>
      </div>
      <div style={small}>{busy && !rows.length ? "Loading…" : `${total.toLocaleString()} email${total === 1 ? "" : "s"}. Warm-up emails are not listed.`}</div>
      {!busy && rows.length === 0 && <div style={{ ...card, ...small }}>No emails match. Emails appear here as soon as they are sent.</div>}
      {rows.map((m) => (
        <div key={m.id} style={{ ...card, display: "grid", gap: 8 }}>
          <button type="button" title="Read this email" onClick={() => show(m.id)} style={{ all: "unset", cursor: "pointer", display: "grid", gap: 4 }}>
            <div style={row}>
              <strong>{m.name || m.to}</strong>{m.name && <span style={small}>{m.to}</span>}{m.company && <span style={small}>· {m.company}</span>}
              <span style={{ marginLeft: "auto" }}><Pill tone={(SENT_STATUS[m.status] || [])[1]}>{(SENT_STATUS[m.status] || [m.status])[0]}</Pill></span>
            </div>
            <div style={{ fontSize: 13 }}>{m.subject || "(no subject)"}</div>
            <div style={small}>{when(m.sent_at)} · from {m.mailbox || "a mailbox"} · {m.kind === "one_to_one" ? "One-to-one email" : `Campaign: ${m.campaign || "—"}`}</div>
          </button>
          {open === m.id && (
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, display: "grid", gap: 8 }}>
              {!detail ? <Loader compact label="Loading" /> : (
                <>
                  <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{detail.body || "(no text saved)"}</div>
                  <div style={small}>Shown as it was written. Your signature and the unsubscribe link are added when it is sent.</div>
                  {detail.bounce_reason ? <div style={{ fontSize: 12.5, color: C.red }}>Bounced: {detail.bounce_reason}</div> : null}
                  {detail.reply ? <div style={{ ...card, background: "#f0fdf4" }}><div style={small}>Their reply{detail.replied_at ? ` · ${when(detail.replied_at)}` : ""}</div><div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{detail.reply}</div></div> : null}
                </>
              )}
            </div>
          )}
        </div>
      ))}
      {rows.length < total ? <div><button type="button" style={btn(false)} disabled={busy} title="Load the next emails" onClick={() => load(rows.length)}>{busy ? "Loading…" : "Show more"}</button></div> : null}
    </div>
  );
}

export function RepliesList() {
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
            {["interested", "question"].includes(r.category) && <ReplyWithTimes r={r} />}
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
