import React, { useState } from "react";
import { Check } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";
import { contactFor, emailFor } from "./AccountsViews";
import { listReach } from "./Lists";
import { askConfirm } from "./Dialogs";
import { CheckNote, PersonalLines, ProfileBox, RefineBar, SequenceWriter, unknownFields } from "./EmailWriter";

// New campaign, one step at a time: who to email (a list) -> what to send -> from which mailboxes ->
// when -> review and launch. Everything a campaign needs is asked here, in this order, and nowhere else.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };
const label = { ...text, fontSize: 12.5, fontWeight: 600, color: C.textInk, display: "grid", gap: 4 };
const STEPS = ["Who", "Emails", "Send from", "Schedule", "Launch"];
const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];
const blankEmail = (delay) => ({ subject: "", body: "Hi {{first_name}},\n\n", delay_days: delay });

// The campaign's leads from a list: one per company that has an email, named from its contact when known.
export function leadsFromList(members) {
  return members.map((a) => {
    const email = emailFor(a)?.text;
    if (!email) return null;
    const parts = String(contactFor(a)?.text || "").trim().split(/\s+/).filter(Boolean);
    return { email, first_name: parts[0] || "", last_name: parts.slice(1).join(" "), company: a.name, account_id: a.id };
  }).filter(Boolean);
}

export function CampaignWizard({ store, listsStore, outreach, initialListId = "", onDone, onCancel, onOpenBusiness }) {
  const [step, setStep] = useState(0);
  const [listId, setListId] = useState(initialListId);
  const [name, setName] = useState("");
  const [emails, setEmails] = useState([blankEmail(0), blankEmail(3)]);
  const [mailboxIds, setMailboxIds] = useState(() => outreach.mailboxes.filter((m) => !_blocked(m)).map((m) => m.id));
  const [sched, setSched] = useState({ days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", gap: 120 });
  const [aliasMap, setAliasMap] = useState({}); // {mailbox id: alias address it sends as}
  const [profileReady, setProfileReady] = useState(false); // "About your business" is filled in, so the AI may write
  const [personalise, setPersonalise] = useState(true);
  const [lines, setLines] = useState({}); // account id -> the opening line for that company
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const list = listsStore.lists.find((l) => l.id === listId);
  const { members } = list ? listReach(list, store.accounts) : { members: [] };
  const leads = leadsFromList(members);
  const mailboxes = outreach.mailboxes;
  const chosen = mailboxes.filter((m) => mailboxIds.includes(m.id));
  const notReady = chosen.filter((m) => _blocked(m));

  const problem = [
    !list ? "Pick a list to email." : !leads.length ? "None of the companies in this list has an email yet. Enrich the list first." : "",
    !emails[0].subject.trim() || emails.some((e) => !e.body.trim()) ? "Every email needs text, and the first one a subject."
      : emails.some((e) => unknownFields(e.subject, e.body).length) ? "An email uses a field that can't be filled in. Fix it before going on."
      : emails.some((e) => e.ai && (e.warnings || []).length) ? "The AI wrote something the facts don't back up. Edit or remove it, or ask the AI to change it." : "",
    !chosen.length ? "Pick at least one mailbox to send from." : "",
    !sched.days.length ? "Pick at least one sending day." : "",
  ];
  const canNext = !problem[step] || step === 4;
  // Typing in an AI-written email makes it the person's own words: the AI's fact warnings no longer apply.
  const setEmail = (i, k, v) => setEmails(emails.map((e, j) => (j === i ? { ...e, [k]: v, ...(k === "subject" || k === "body" ? { ai: false, warnings: [] } : null) } : e)));
  const usesLine = emails.some((e) => /\{\{\s*personal_?line\s*\}\}/i.test(`${e.subject}\n${e.body}`));

  const launch = async (start) => {
    setBusy(true);
    setError("");
    let made = null;
    try {
      made = (await api.emailCreateCampaign({
        name: name.trim() || `${list.name} campaign`, mailbox_ids: mailboxIds, sending_window_start: sched.start, sending_window_end: sched.end,
        days_of_week: sched.days, min_delay_seconds: Number(sched.gap) || 120, aliases: aliasMap,
        steps: emails.map((e) => ({ subject: e.subject, body: e.body, delay_days: Number(e.delay_days) || 0 })),
      })).campaign;
      const out = await api.emailAddLeads(made.id, leads.map(({ account_id, ...lead }) => ({ ...lead, personal_line: (lines[account_id] || "").trim() })));
      if (start) await api.emailCampaignStatus(made.id, "running");
      store.toast(start ? `Campaign started: ${out.added} leads added.` : `Campaign saved as a draft: ${out.added} leads added.`);
      onDone(made.id);
    } catch (e) {
      // The campaign exists but could not start (for example a mailbox is not ready): keep it as a draft.
      if (made) {
        store.toast(`Saved as a draft. It didn't start: ${e.message}`);
        onDone(made.id);
        return;
      }
      setError(e.message || "Couldn't create the campaign.");
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <span style={{ ...text, fontSize: 12.5, fontWeight: 600, padding: "4px 10px", borderRadius: 999, display: "inline-flex", gap: 4, alignItems: "center",
              background: i === step ? C.ink : i < step ? C.greenSoft : C.paperSoft, color: i === step ? "#fff" : i < step ? C.green : C.slate }}>
              {i < step ? <Check size={12} /> : null}{i + 1}. {s}
            </span>
          </React.Fragment>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Clear everything you've entered and go back to step 1" disabled={busy}
          onClick={async () => {
            if (!(await askConfirm({ title: "Start over?", body: "What you've typed in these steps will be cleared.", confirm: "Start over", danger: true }))) return;
            setStep(0); setListId(initialListId); setName(""); setEmails([blankEmail(0), blankEmail(3)]);
            setMailboxIds(outreach.mailboxes.filter((m) => !_blocked(m)).map((m) => m.id));
            setSched({ days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", gap: 120 }); setAliasMap({}); setLines({}); setPersonalise(true); setError("");
          }}>Start over</button>
        <button title="Close without saving" type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onCancel}>Cancel</button>
      </div>

      <div className="ui-card" style={{ padding: 18, display: "grid", gap: 14 }}>
        {step === 0 ? (
          <>
            <div style={{ ...text, fontSize: 15, fontWeight: 600, color: C.ink }}>Who should get this campaign?</div>
            {listsStore.lists.length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {listsStore.lists.map((l) => {
                  const r = listReach(l, store.accounts);
                  return (
                    <label key={l.id} className="ui-card" style={{ padding: "10px 12px", display: "flex", gap: 10, alignItems: "center", cursor: "pointer", borderColor: listId === l.id ? C.cobalt : undefined }}>
                      <input type="radio" name="list" checked={listId === l.id} onChange={() => setListId(l.id)} />
                      <span style={{ ...text, fontWeight: 600, color: C.ink }}>{l.name}</span>
                      <span style={{ ...muted, marginLeft: "auto" }}>{r.members.length.toLocaleString()} companies · {r.withEmail.length.toLocaleString()} with an email</span>
                    </label>
                  );
                })}
              </div>
            ) : <div style={muted}>You have no lists yet. In Saved Accounts, tick companies and choose Add to list.</div>}
            <label style={label}>Campaign name (optional)
              <input className="ui-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={list ? `${list.name} campaign` : "For example Leeds dentists, March"} />
            </label>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <div style={{ ...text, fontSize: 15, fontWeight: 600, color: C.ink }}>What should the emails say?</div>
            <div style={muted}>Write them yourself, or let the AI write them from what you tell us about your business and what this list has in common. Use {"{{first_name}}"}, {"{{last_name}}"}, {"{{company}}"} and {"{{personal_line}}"} (an opening line about each company). A follow-up with no subject goes as a reply in the same thread. Someone who replies, bounces or unsubscribes gets no more emails.</div>
            <ProfileBox onReady={setProfileReady} onManage={onOpenBusiness} />
            <SequenceWriter accountIds={members.map((a) => a.id)} personalise={personalise} setPersonalise={setPersonalise} ready={profileReady}
              onWritten={(steps) => { if (steps.length) setEmails(steps.map((s, i) => ({ subject: s.subject || "", body: s.body, delay_days: s.delay_days ?? (i ? 3 : 0), ai: true, warnings: s.warnings || [] }))); }} />
            {emails.map((e, i) => (
              <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <strong style={{ ...text, fontSize: 13 }}>Email {i + 1}</strong>
                  {i > 0 ? (
                    <label style={{ ...muted, display: "inline-flex", gap: 6, alignItems: "center" }}>wait
                      <input className="ui-input" style={{ width: 64 }} type="number" min={1} value={e.delay_days} onChange={(ev) => setEmail(i, "delay_days", ev.target.value)} /> days after email {i}
                    </label>
                  ) : null}
                  {i > 0 ? <button title="Remove this follow-up from the campaign" type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ marginLeft: "auto" }} onClick={() => setEmails(emails.filter((_, j) => j !== i))}>Remove</button> : null}
                </div>
                <input className="ui-input" placeholder={i === 0 ? "Subject" : "Subject (empty = reply in the same thread)"} value={e.subject} onChange={(ev) => setEmail(i, "subject", ev.target.value)} />
                <textarea className="ui-input" style={{ minHeight: 110 }} value={e.body} onChange={(ev) => setEmail(i, "body", ev.target.value)} />
                <CheckNote email={e} aiWritten={Boolean(e.ai)} />
                <RefineBar email={e} ready={profileReady} onChange={(r) => setEmails(emails.map((x, j) => (j === i ? { ...x, subject: i === 0 || x.subject ? r.subject : x.subject, body: r.body, ai: true, warnings: r.warnings || [] } : x)))} />
              </div>
            ))}
            {emails.length < 6 ? <div><button title="Add another email that is sent if there is no reply" type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setEmails([...emails, blankEmail(3)])}>Add a follow-up</button></div> : null}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div style={{ ...text, fontSize: 15, fontWeight: 600, color: C.ink }}>Which mailboxes should send it?</div>
            <div style={muted}>Emails are shared out across the mailboxes you tick. If one gets blocked or fails, the others carry on, so tick more than one. Only mailboxes that have passed their DNS checks and started warming up can send.</div>
            {!mailboxes.length ? <div style={muted}>You have no mailbox connected yet. Connect one under Mailboxes first.</div> : null}
            {mailboxes.map((m) => (
              <div key={m.id} className="ui-card" style={{ padding: "10px 12px", display: "grid", gap: 8 }}>
                <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
                  <input type="checkbox" checked={mailboxIds.includes(m.id)} onChange={(e) => setMailboxIds(e.target.checked ? [...mailboxIds, m.id] : mailboxIds.filter((x) => x !== m.id))} />
                  <span style={{ ...text, fontWeight: 600, color: C.ink }}>{m.email}</span>
                  <span style={{ ...text, fontSize: 12.5, marginLeft: "auto", color: _blocked(m) ? C.red : C.green }}>{_blocked(m) ? `Can't send yet: ${_blocked(m)}` : "Ready to send"}</span>
                </label>
                {mailboxIds.includes(m.id) && (m.aliases || []).length ? (
                  <label style={{ ...muted, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", paddingLeft: 26 }} title="Recipients see this address in the From line. Replies come back to this mailbox.">
                    Send as
                    <select title="Which address recipients see in the From line" className="ui-input" style={{ width: "auto", height: 30 }} value={aliasMap[m.id] || ""}
                      onChange={(e) => setAliasMap((a) => { const next = { ...a }; if (e.target.value) next[m.id] = e.target.value; else delete next[m.id]; return next; })}>
                      <option value="">{m.email} (the mailbox itself)</option>
                      {m.aliases.map((a) => <option key={a.address} value={a.address}>{a.name ? `${a.name} <${a.address}>` : a.address}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>
            ))}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div style={{ ...text, fontSize: 15, fontWeight: 600, color: C.ink }}>When should emails go out?</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {DAYS.map(([d, n]) => (
                <label key={d} style={{ ...muted, display: "inline-flex", gap: 4, alignItems: "center" }}>
                  <input type="checkbox" checked={sched.days.includes(d)} onChange={(e) => setSched({ ...sched, days: e.target.checked ? [...sched.days, d].sort() : sched.days.filter((x) => x !== d) })} />{n}
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label style={label}>From<input className="ui-input" style={{ width: 110 }} type="time" value={sched.start} onChange={(e) => setSched({ ...sched, start: e.target.value })} /></label>
              <label style={label}>To<input className="ui-input" style={{ width: 110 }} type="time" value={sched.end} onChange={(e) => setSched({ ...sched, end: e.target.value })} /></label>
              <label style={label}>Gap between emails (seconds)<input className="ui-input" style={{ width: 140 }} type="number" min={30} value={sched.gap} onChange={(e) => setSched({ ...sched, gap: e.target.value })} /></label>
            </div>
            <div style={muted}>Hours are in your company's timezone.</div>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <div style={{ ...text, fontSize: 15, fontWeight: 600, color: C.ink }}>Review and launch</div>
            {usesLine ? <PersonalLines leads={leads} lines={lines} setLines={setLines} ready={profileReady} /> : null}
            <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4, ...text, fontSize: 13.5, color: C.textInk }}>
              <li><strong>{leads.length.toLocaleString()}</strong> people at companies in <strong>{list?.name}</strong>{members.length > leads.length ? ` (${(members.length - leads.length).toLocaleString()} skipped: no email yet)` : ""}</li>
              <li><strong>{emails.length}</strong> email{emails.length === 1 ? "" : "s"}, the first starting "{emails[0].subject || "…"}"</li>
              <li>Sent from <strong>{chosen.map((m) => aliasMap[m.id] || m.email).join(", ")}</strong></li>
              <li>{sched.days.map((d) => DAYS.find((x) => x[0] === d)[1]).join(", ")}, {sched.start} to {sched.end}, one email every {sched.gap}s at most</li>
              <li>Every email gets an unsubscribe link, and anyone on your do-not-email list is skipped.</li>
            </ul>
            {leads.length ? (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, display: "grid", gap: 4 }}>
                <div style={{ ...muted, fontSize: 12 }}>What the first person gets ({leads[0].first_name || "there"} at {leads[0].company}):</div>
                <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink }}>{fill(emails[0].subject, leads[0], lines[leads[0].account_id])}</div>
                <div style={{ ...text, fontSize: 13.5, color: C.textInk, whiteSpace: "pre-wrap" }}>{fill(emails[0].body, leads[0], lines[leads[0].account_id])}</div>
              </div>
            ) : null}
            {notReady.length ? (
              <div role="alert" style={{ ...text, fontSize: 13, color: C.red }}>
                {notReady.map((m) => `${m.email} can't send yet (${_blocked(m)})`).join("; ")}. You can save this as a draft and start it once the mailbox is ready.
              </div>
            ) : null}
          </>
        ) : null}
        {error ? <div role="alert" style={{ ...text, fontSize: 13, color: C.red }}>{error}</div> : null}
        {problem[step] && step < 4 ? <div style={{ ...text, fontSize: 12.5, color: C.amber }}>{problem[step]}</div> : null}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {step > 0 ? <button title="Go back one step" type="button" className="ui-btn ui-btn--ghost" disabled={busy} onClick={() => setStep(step - 1)}>Back</button> : null}
        <span style={{ flex: 1 }} />
        {step < 4 ? <button title="Go to the next step" type="button" className="ui-btn ui-btn--primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Next</button> : (
          <>
            <button title="Keep this campaign without sending anything yet" type="button" className="ui-btn ui-btn--ghost" disabled={busy} onClick={() => launch(false)}>Save as draft</button>
            <button title="Start sending this campaign" type="button" className="ui-btn ui-btn--primary" disabled={busy || notReady.length > 0} onClick={() => launch(true)}>{busy ? "Working…" : "Launch campaign"}</button>
          </>
        )}
      </div>
    </div>
  );
}

// An email as one person will see it, so the sender can check it before anything goes out.
export function fill(template, lead, line) {
  const values = { first_name: lead.first_name, firstname: lead.first_name, last_name: lead.last_name, lastname: lead.last_name, company: lead.company, personal_line: (line || "").trim(), personalline: (line || "").trim() };
  return String(template || "")
    .replace(/\{\{\s*([A-Za-z_]+)\s*\}\}/g, (_, k) => values[k.toLowerCase()] || "")
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n");
}

// Why a mailbox can't send right now, in a few words ("" when it can).
function _blocked(m) {
  return Array.isArray(m.blockers) && m.blockers.length ? m.blockers.join(", ") : "";
}
