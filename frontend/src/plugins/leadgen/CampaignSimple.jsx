import React, { useEffect, useState } from "react";
import { AlertCircle, Check, Monitor, Plus, Smartphone, Sparkles, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";
import { leadsFromList, fill, CampaignWizard } from "./CampaignWizard";
import { listReach } from "./Lists";
import { CheckNote, PersonalLines, ProfileBox, RefineBar, SequenceWriter, unknownFields } from "./EmailWriter";

// New campaign, on one page, for someone who has never sent a campaign: pick who, let the AI write the emails, check
// the summary, press Launch. The exact timing, call steps and "send as" addresses are still there in the step-by-step
// version, one click away. Same server calls as that version, so campaigns made here look the same everywhere.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };
const h2 = { ...text, fontSize: 15, fontWeight: 700, color: C.ink, margin: 0 };
const WEEKDAYS = [1, 2, 3, 4, 5];
const DAY_NAMES = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];
const WAITS = [[1, "1 day"], [2, "2 days"], [3, "3 days"], [4, "4 days"], [5, "5 days"], [7, "1 week"], [10, "10 days"], [14, "2 weeks"]];
const DEFAULT_SCHEDULE = { days: WEEKDAYS, start: "09:00", end: "17:00", gap: 120 };

// People never type {{first_name}}: they see and insert [First name]. The server keeps the {{...}} form.
const FRIENDLY = { first_name: "First name", last_name: "Last name", company: "Company", personal_line: "Opening line" };
const ALIAS = { firstname: "first_name", lastname: "last_name", personalline: "personal_line" };
export const toFriendly = (t) => String(t || "").replace(/\{\{\s*([A-Za-z_]+)\s*\}\}/g, (whole, key) => {
  const k = key.toLowerCase();
  const name = FRIENDLY[ALIAS[k] || k];
  return name ? `[${name}]` : whole;
});
export const fromFriendly = (t) => String(t || "").replace(/\[\s*(First name|Last name|Company|Opening line)\s*\]/gi, (_, name) => {
  const key = Object.keys(FRIENDLY).find((k) => FRIENDLY[k].toLowerCase() === name.toLowerCase());
  return `{{${key}}}`;
});

const blank = (delay) => ({ subject: "", body: "Hi {{first_name}},\n\n", delay_days: delay });
const blocked = (m) => (Array.isArray(m.blockers) && m.blockers.length ? m.blockers.join(", ") : "");
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function Row({ ok, title, detail, action }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: ok ? C.greenSoft : C.amberSoft, color: ok ? C.green : C.amber }}>
        {ok ? <Check size={13} /> : <AlertCircle size={13} />}
      </span>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink }}>{title}</div>
        {detail ? <div style={{ ...muted, fontSize: 12.5 }}>{detail}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function SimpleCampaign({ store, listsStore, outreach, initialListId = "", onDone, onCancel, onOpenBusiness, onOpenMailboxes, onOpenLists, onAdvanced }) {
  const [listId, setListId] = useState(initialListId);
  const [name, setName] = useState("");
  const [emails, setEmails] = useState([]);
  const [sched, setSched] = useState(DEFAULT_SCHEDULE);
  const [editTimes, setEditTimes] = useState(false);
  const [mailboxId, setMailboxId] = useState("");
  const [profileReady, setProfileReady] = useState(false);
  const [personalise, setPersonalise] = useState(true);
  const [lines, setLines] = useState({});
  const [active, setActive] = useState(0);
  const [templates, setTemplates] = useState([]);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tplName, setTplName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Start on the list that can actually be emailed, so most people do not have to choose.
  useEffect(() => {
    if (listId || !listsStore.lists.length) return;
    const best = listsStore.lists.find((l) => listReach(l, store.accounts).withEmail.length > 0) || listsStore.lists[0];
    setListId(best.id);
  }, [listId, listsStore.lists, store.accounts]);

  useEffect(() => {
    let live = true;
    api.emailTemplates().then((r) => { if (live) setTemplates(r.templates || []); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const list = listsStore.lists.find((l) => l.id === listId);
  const { members } = list ? listReach(list, store.accounts) : { members: [] };
  const leads = leadsFromList(members);
  const mailboxes = outreach.mailboxes;
  const ready = mailboxes.filter((m) => !blocked(m));
  // The one mailbox it sends from: the first that is ready, unless the person picked another.
  const sender = mailboxes.find((m) => m.id === mailboxId && !blocked(m)) || ready[0] || null;
  const usesLine = emails.some((e) => /\{\{\s*personal_?line\s*\}\}/i.test(`${e.subject}\n${e.body}`));

  const boxes = React.useRef({}); // each email's text box, so a name goes in where the person is typing
  const addWord = (i, key) => {
    const box = boxes.current[i];
    const at = box && typeof box.selectionStart === "number" ? box.selectionStart : emails[i].body.length;
    const body = emails[i].body;
    const mine = toFriendly(body);
    const word = `[${FRIENDLY[key]}]`;
    const next = `${mine.slice(0, at)}${word}${mine.slice(at)}`;
    setEmail(i, { body: fromFriendly(next), ai: false, warnings: [] });
    setTimeout(() => { if (box) { box.focus(); box.setSelectionRange(at + word.length, at + word.length); } }, 0);
  };
  const setEmail = (i, patch) => setEmails((all) => all.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const edit = (i, field, value) => setEmail(i, { [field]: fromFriendly(value), ai: false, warnings: [] }); // typing makes it their own words

  const blockers = [];
  if (!list) blockers.push("Pick who should get it.");
  else if (!leads.length) blockers.push("Nobody in this list has an email yet.");
  if (!sender) blockers.push(mailboxes.length ? "Your email account is not ready to send yet." : "Connect an email account to send from.");
  if (!emails.length) blockers.push("Write the emails.");
  else if (isEmpty(emails)) blockers.push("Every email needs some text, and the first one a subject line.");
  else if (emails.some((e) => unknownFields(e.subject, e.body).length)) blockers.push("An email has a word in brackets that can't be filled in.");
  else if (emails.some((e) => e.ai && (e.warnings || []).length)) blockers.push("The AI wrote something the facts don't back up. Change that email or ask the AI to.");
  if (!sched.days.length) blockers.push("Pick at least one day to send on.");

  const launch = async (start) => {
    setBusy(true);
    setError("");
    let made = null;
    try {
      made = (await api.emailCreateCampaign({
        name: name.trim() || `${list.name} campaign`, mailbox_ids: [sender.id], sending_window_start: sched.start, sending_window_end: sched.end,
        days_of_week: sched.days, min_delay_seconds: Number(sched.gap) || 120, aliases: {},
        steps: emails.map((e) => ({ subject: e.subject, body: e.body, delay_days: Number(e.delay_days) || 0 })),
      })).campaign;
      const out = await api.emailAddLeads(made.id, leads.map(({ account_id, ...lead }) => ({ ...lead, personal_line: (lines[account_id] || "").trim() })));
      if (start) await api.emailCampaignStatus(made.id, "running");
      store.toast(start ? `Campaign started: ${plural(out.added, "person", "people")} will be emailed.` : `Saved as a draft with ${plural(out.added, "person", "people")}.`);
      onDone(made.id);
    } catch (e) {
      if (made) { // it exists but could not start (a mailbox that is not ready, for example): keep it as a draft
        store.toast(`Saved as a draft. It didn't start: ${e.message}`);
        onDone(made.id);
        return;
      }
      setError(e.message || "Couldn't create the campaign.");
      setBusy(false);
    }
  };

  const days = sched.days.length === 5 && WEEKDAYS.every((d) => sched.days.includes(d)) ? "Weekdays" : DAY_NAMES.filter(([d]) => sched.days.includes(d)).map(([, n]) => n).join(", ");
  const total = emails.slice(1).reduce((n, x) => n + (Number(x.delay_days) || 0), 0);
  const timeline = emails.length > 1 ? `${emails.length} emails over ${total} days` : `${emails.length} email`;
  const at = Math.min(active, Math.max(emails.length - 1, 0));
  const dayOf = (i) => emails.slice(1, i + 1).reduce((n, x) => n + (Number(x.delay_days) || 0), 0);
  const e = emails[at];

  const useTemplate = (t, i) => {
    // The starter templates sign off with {{senderName}}; there is no such merge word, so it becomes the sender's own name.
    const me = sender ? (sender.from_name || sender.name || "") : "";
    const own = (v) => fromFriendly(toFriendly(v)).replace(/\{\{\s*sender_?name\s*\}\}/gi, me);
    const step = { subject: own(t.subject), body: own(t.body_text).trimEnd(), ai: false, warnings: [] };
    if (!emails.length) { setEmails([{ ...step, delay_days: 0 }, blank(3)]); setActive(0); } else setEmail(i, step);
    setPicking(false);
  };
  const saveTemplate = async () => {
    if (!tplName.trim() || !e) return;
    try {
      const out = await api.emailCreateTemplate({ name: tplName.trim(), subject: e.subject, body_text: e.body, category: at ? "Follow-up" : "Outbound", tags: [] });
      setTemplates((all) => [out.template, ...all]);
      setTplName("");
      setSaving(false);
      store.toast("Saved as a template.");
    } catch (err) { setError(err.message || "Couldn't save the template."); }
  };

  const check = [
    { ok: leads.length > 0, label: leads.length ? `${plural(leads.length, "person", "people")} to email` : "Choose who gets it" },
    { ok: emails.length > 0 && !isEmpty(emails) && !emails.some((x) => unknownFields(x.subject, x.body).length) && !emails.some((x) => x.ai && (x.warnings || []).length), label: emails.length ? timeline : "Write the emails" },
    { ok: Boolean(sender), label: sender ? `Sending from ${sender.email}` : "Connect an email account" },
    { ok: sched.days.length > 0, label: sched.days.length ? `${days}, ${sched.start} to ${sched.end}` : "Pick sending days" },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ ...h2, fontSize: 17 }}>New campaign</h2>
        <input className="ui-input" style={{ width: 260, height: 32 }} aria-label="Campaign name" value={name} onChange={(ev) => setName(ev.target.value)} placeholder={list ? `${list.name} campaign` : "Name this campaign"} />
        <span style={{ flex: 1 }} />
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onAdvanced} title="Timing between emails, calls between emails, the address emails are sent as, and more">More options</button>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onCancel}>Cancel</button>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "3 1 480px", minWidth: 0, display: "grid", gap: 16 }}>
          <div className="ui-card" style={{ padding: 16, display: "grid", gap: 12 }}>
            <h3 style={h2}>Who</h3>
            {listsStore.lists.length ? (
              <>
                <select className="ui-input" aria-label="List" value={listId} onChange={(ev) => setListId(ev.target.value)}>
                  {listsStore.lists.map((l) => {
                    const r = listReach(l, store.accounts);
                    return <option key={l.id} value={l.id}>{l.name} ({plural(r.withEmail.length, "person", "people")} can be emailed)</option>;
                  })}
                </select>
                {list ? (
                  <Row ok={leads.length > 0} title={leads.length ? `${plural(leads.length, "person", "people")} will get it` : "Nobody in this list has an email yet"}
                    detail={members.length > leads.length ? `${plural(members.length - leads.length, "company", "companies")} in the list ${members.length - leads.length === 1 ? "has" : "have"} no email and will be skipped.` : ""}
                    action={!leads.length || members.length > leads.length ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onOpenLists}>Find their emails</button> : null} />
                ) : null}
              </>
            ) : (
              <Row ok={false} title="You need a list of companies first" detail="Find companies, tick the ones you want and add them to a list." action={<button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onOpenLists}>Go to My lists</button>} />
            )}
          </div>

          <div className="ui-card" style={{ padding: 16, display: "grid", gap: 12 }}>
            <h3 style={h2}>Emails</h3>
            <ProfileBox compact onReady={setProfileReady} onManage={onOpenBusiness} />
            {!emails.length ? (
              <>
                {!profileReady ? <div style={{ ...muted, fontSize: 12.5 }}>Fill in the boxes above and save, then the AI can write your emails for you.</div> : null}
                <SequenceWriter accountIds={members.map((a) => a.id)} personalise={personalise} setPersonalise={setPersonalise} ready={profileReady}
                  onWritten={(steps) => {
                    if (!steps.length) return;
                    setEmails(steps.map((s, i) => ({ subject: s.subject || "", body: s.body, delay_days: s.delay_days ?? (i ? 3 : 0), ai: true, warnings: s.warnings || [] })));
                    setActive(0);
                  }} />
                <div style={{ ...muted, fontSize: 12 }}>Or start from a template</div>
                <TemplateList templates={templates} onPick={(t) => useTemplate(t, 0)} />
                <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ justifySelf: "start" }} onClick={() => { setEmails([blank(0), blank(3)]); setActive(0); }}>Write them yourself</button>
              </>
            ) : (
              <>
                <div role="tablist" aria-label="Emails in this campaign" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {emails.map((x, i) => (
                    <button key={i} type="button" role="tab" aria-selected={i === at} onClick={() => setActive(i)}
                      className={`ui-btn ui-btn--sm ${i === at ? "ui-btn--secondary" : "ui-btn--ghost"}`}>
                      Email {i + 1} <span style={{ ...muted, fontSize: 11.5 }}>· Day {dayOf(i)}</span>
                    </button>
                  ))}
                  {emails.length < 6 ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label="Add a follow-up" onClick={() => { setEmails([...emails, blank(3)]); setActive(emails.length); }}><Plus size={13} /> Follow-up</button> : null}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {at > 0 ? (
                    <label style={{ ...muted, display: "inline-flex", gap: 6, alignItems: "center" }}>Sent
                      <select className="ui-input" style={{ width: "auto", height: 30 }} aria-label={`Wait before follow-up ${at}`} value={WAITS.some(([d]) => d === Number(e.delay_days)) ? Number(e.delay_days) : ""}
                        onChange={(ev) => setEmail(at, { delay_days: Number(ev.target.value) })}>
                        {!WAITS.some(([d]) => d === Number(e.delay_days)) ? <option value="">{e.delay_days} days</option> : null}
                        {WAITS.map(([d, label]) => <option key={d} value={d}>{label}</option>)}
                      </select> after the one before, only if they haven't replied
                    </label>
                  ) : <span style={muted}>Goes out first.</span>}
                  <span style={{ flex: 1 }} />
                  <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => { setPicking((v) => !v); setSaving(false); }}>Use a template</button>
                  <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => { setSaving((v) => !v); setPicking(false); }}>Save as template</button>
                  {at > 0 ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => { setEmails(emails.filter((_, j) => j !== at)); setActive(Math.max(at - 1, 0)); }}><X size={13} /> Remove</button> : null}
                </div>
                {picking ? <TemplateList templates={templates} onPick={(t) => useTemplate(t, at)} /> : null}
                {saving ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input className="ui-input" style={{ flex: "1 1 200px" }} aria-label="Template name" placeholder="Name this template" value={tplName} onChange={(ev) => setTplName(ev.target.value)} />
                    <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!tplName.trim()} onClick={saveTemplate}>Save</button>
                  </div>
                ) : null}
                <input className="ui-input" aria-label={`Subject of email ${at + 1}`} placeholder={at === 0 ? "Subject" : "Subject (leave empty to reply in the same conversation)"} value={toFriendly(e.subject)} onChange={(ev) => edit(at, "subject", ev.target.value)} />
                <textarea className="ui-input" ref={(el) => { boxes.current[at] = el; }} aria-label={`Text of email ${at + 1}`} style={{ minHeight: 170 }} value={toFriendly(e.body)} onChange={(ev) => edit(at, "body", ev.target.value)} />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ ...muted, fontSize: 12 }}>Add their:</span>
                  <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => addWord(at, "first_name")}>First name</button>
                  <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => addWord(at, "company")}>Company</button>
                </div>
                <CheckNote email={e} aiWritten={Boolean(e.ai)} />
                <RefineBar email={e} ready={profileReady} onChange={(r) => setEmails((all) => all.map((x, j) => (j === at ? { ...x, subject: at === 0 || x.subject ? r.subject : x.subject, body: r.body, ai: true, warnings: r.warnings || [] } : x)))} />
                <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ justifySelf: "start" }} onClick={() => { setEmails([]); setActive(0); }}><Sparkles size={13} /> Start the emails again</button>
                {usesLine ? (
                  <details>
                    <summary style={{ ...muted, cursor: "pointer" }}>Opening line about each company (optional)</summary>
                    <div style={{ marginTop: 8 }}><PersonalLines leads={leads} lines={lines} setLines={setLines} ready={profileReady} /></div>
                  </details>
                ) : null}
              </>
            )}
          </div>

          <div className="ui-card" style={{ padding: 16, display: "grid", gap: 12 }}>
            <h3 style={h2}>When</h3>
            {sender ? (
              <Row ok title={`From ${sender.email}`} detail="Ready to send."
                action={ready.length > 1 ? (
                  <select className="ui-input" style={{ width: "auto", height: 30 }} aria-label="Send from" value={sender.id} onChange={(ev) => setMailboxId(ev.target.value)}>
                    {ready.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
                  </select>
                ) : null} />
            ) : (
              <Row ok={false} title={mailboxes.length ? "Your email account is not ready to send yet" : "Connect an email account to send from"}
                detail={mailboxes.length ? mailboxes.map((m) => `${m.email}: ${blocked(m)}`).join(" · ") : "Campaigns are sent from your own email address."}
                action={<button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onOpenMailboxes}>{mailboxes.length ? "Finish setting it up" : "Connect your email"}</button>} />
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ ...text, fontSize: 13.5, color: C.textInk }}>{sched.days.length ? `${days}, ${sched.start} to ${sched.end}` : "No days picked"}, in your company's time, a few minutes apart.</span>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setEditTimes((v) => !v)}>{editTimes ? "Done" : "Change"}</button>
            </div>
            {editTimes ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div role="group" aria-label="Days" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {DAY_NAMES.map(([d, n]) => (
                    <label key={d} style={{ ...muted, display: "inline-flex", gap: 4, alignItems: "center" }}>
                      <input type="checkbox" checked={sched.days.includes(d)} onChange={(ev) => setSched({ ...sched, days: ev.target.checked ? [...sched.days, d].sort() : sched.days.filter((x) => x !== d) })} />{n}
                    </label>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <label style={muted}>From <input className="ui-input" style={{ width: 110 }} type="time" value={sched.start} onChange={(ev) => setSched({ ...sched, start: ev.target.value })} /></label>
                  <label style={muted}>To <input className="ui-input" style={{ width: 110 }} type="time" value={sched.end} onChange={(ev) => setSched({ ...sched, end: ev.target.value })} /></label>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ flex: "2 1 360px", minWidth: 0, display: "grid", gap: 16, position: "sticky", top: 8 }}>
          <MailPreview email={e} opener={emails[0]} leads={leads} lines={lines} sender={sender} />
          <div className="ui-card" style={{ padding: 16, display: "grid", gap: 10 }}>
            <h3 style={h2}>Before you launch</h3>
            <div style={{ display: "grid", gap: 6 }}>
              {check.map((c) => (
                <div key={c.label} style={{ display: "flex", gap: 8, alignItems: "center", ...text, fontSize: 13, color: c.ok ? C.textInk : C.amber }}>
                  <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: c.ok ? C.greenSoft : C.amberSoft, color: c.ok ? C.green : C.amber }}>
                    {c.ok ? <Check size={11} /> : <AlertCircle size={11} />}
                  </span>{c.label}
                </div>
              ))}
            </div>
            {blockers.length ? (
              <ul role="status" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 3, ...muted, fontSize: 12.5, color: C.amber }}>{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            ) : (
              <div style={{ ...muted, fontSize: 12.5 }}>Every email has an unsubscribe link, and anyone on your do-not-email list is skipped.</div>
            )}
            {error ? <div role="alert" style={{ ...text, fontSize: 13, color: C.red }}>{error}</div> : null}
            <button type="button" className="ui-btn ui-btn--primary" disabled={busy || blockers.length > 0} onClick={() => launch(true)}>{busy ? "Working…" : "Launch campaign"}</button>
            <button type="button" className="ui-btn ui-btn--ghost" disabled={busy || blockers.length > 0} onClick={() => launch(false)} title="Keep it without sending anything yet">Save as draft</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplateList({ templates, onPick }) {
  if (!templates.length) return <div style={{ ...muted, fontSize: 12.5 }}>No templates yet.</div>;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {templates.map((t) => (
        <button key={t.id} type="button" onClick={() => onPick(t)} className="ui-btn ui-btn--ghost" style={{ flex: "1 1 200px", maxWidth: 260, height: "auto", display: "grid", gap: 2, textAlign: "left", padding: 10, border: `1px solid ${C.border}`, borderRadius: 10 }}>
          <span style={{ ...text, fontSize: 13, fontWeight: 600, color: C.ink }}>{t.name}</span>
          <span style={{ ...muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{toFriendly(t.subject)}</span>
        </button>
      ))}
    </div>
  );
}

// An email as it will arrive: sender, recipient, subject, text with their details filled in, signature and the
// unsubscribe line. Pick another recipient or the phone view to check it.
export function MailPreview({ email, opener, leads, lines, sender }) {
  const [who, setWho] = useState(0);
  const [phone, setPhone] = useState(false);
  const lead = leads[Math.min(who, Math.max(leads.length - 1, 0))];
  const sample = lead || { first_name: "Alex", last_name: "", company: "Example Ltd", email: "alex@example.com", account_id: "" };
  // A follow-up with no subject is sent as a reply in the same conversation.
  const own = email && email.subject.trim() ? email.subject : opener && email !== opener ? `Re: ${opener.subject}` : "";
  const subject = own ? fill(own, sample, lines[sample.account_id]) : "";
  const body = email ? fill(email.body, sample, lines[sample.account_id]) : "";
  const sig = sender ? (sender.signature || "").trim() : "";
  const name = sender ? (sender.from_name || sender.name || "") : "";
  return (
    <div className="ui-card" style={{ padding: 16, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <h3 style={h2}>Preview</h3>
        <span style={{ flex: 1 }} />
        <button type="button" className={`ui-btn ui-btn--sm ${phone ? "ui-btn--ghost" : "ui-btn--secondary"}`} aria-pressed={!phone} onClick={() => setPhone(false)}><Monitor size={13} /> Desktop</button>
        <button type="button" className={`ui-btn ui-btn--sm ${phone ? "ui-btn--secondary" : "ui-btn--ghost"}`} aria-pressed={phone} onClick={() => setPhone(true)}><Smartphone size={13} /> Phone</button>
      </div>
      {leads.length > 1 ? (
        <label style={{ ...muted, display: "flex", gap: 6, alignItems: "center" }}>As seen by
          <select className="ui-input" style={{ height: 30, flex: 1, minWidth: 0 }} aria-label="Preview as" value={Math.min(who, leads.length - 1)} onChange={(ev) => setWho(Number(ev.target.value))}>
            {leads.slice(0, 50).map((l, i) => <option key={l.account_id || i} value={i}>{l.first_name ? `${l.first_name} · ` : ""}{l.company}</option>)}
          </select>
        </label>
      ) : null}
      {!email ? (
        <div style={{ ...muted, padding: "24px 0", textAlign: "center" }}>Your first email shows up here as you write it.</div>
      ) : (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", width: phone ? 300 : "100%", maxWidth: "100%", margin: "0 auto" }}>
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}`, display: "grid", gap: 2 }}>
            <div style={{ ...text, fontSize: 13.5, fontWeight: 700, color: C.ink, overflowWrap: "anywhere" }}>{subject || "(no subject)"}</div>
            <div style={{ ...muted, fontSize: 12, overflowWrap: "anywhere" }}>From {name ? `${name} ` : ""}{sender ? `<${sender.email}>` : "your email account"}</div>
            <div style={{ ...muted, fontSize: 12, overflowWrap: "anywhere" }}>To {sample.first_name ? `${sample.first_name} ` : ""}{sample.email ? `<${sample.email}>` : ""}</div>
          </div>
          <div style={{ padding: 12, ...text, fontSize: 13.5, color: C.textInk, whiteSpace: "pre-wrap", lineHeight: 1.55, overflowWrap: "anywhere" }}>
            {body}
            {sig ? <div style={{ marginTop: 12, color: C.slate }}>{sig}</div> : null}
            <div style={{ marginTop: 14, fontSize: 11.5, color: C.slate }}>Don't want these emails? Unsubscribe</div>
          </div>
        </div>
      )}
    </div>
  );
}

function isEmpty(emails) {
  return !emails[0].subject.trim() || emails.some((e) => !e.body.trim());
}

// The simple page first; "More options" opens the step-by-step version with everything in it.
export function NewCampaign(props) {
  const [advanced, setAdvanced] = useState(false);
  if (advanced) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div><button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setAdvanced(false)}>Back to the simple version</button></div>
        <CampaignWizard {...props} />
      </div>
    );
  }
  return <SimpleCampaign {...props} onAdvanced={() => setAdvanced(true)} />;
}
