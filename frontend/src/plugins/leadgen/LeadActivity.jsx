import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader } from "../../app/Loader";
import { CalendarClock, CalendarPlus, Check, Copy, Lock, Mail, Phone, PhoneCall, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";
import { openPlans, useConnection } from "../../hooks/useConnections";
import { writeEmail } from "../../utils/writeEmail";
import { useCallDialog } from "./CallFlow";
import { notesChanged } from "./Notes";
import { NOTE_MAX, cleanNote, noteProblem } from "./notesLogic";
import {
  ACTION_WORDS, ACTIVITY_INTRO, KIND_FILTERS, SCORE_WHY, STAGE_INTRO, STAGE_TIPS,
  actionTip, bookingState, callState, emailState, filterFor, kindCount, pillText, scoreBand, withFind,
} from "./activityLogic";

// Everything that has happened with one company, across Lead Gen, Voice and Social: what you can start (and why something is off),
// where it is in the journey, what a call found out (to accept or ignore), meetings, calls with their summaries, and one timeline.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.5 };
const heading = { ...text, fontSize: 13.5, fontWeight: 600, color: C.ink };
const card = { border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 };

export const STAGES = [["new", "New"], ["contacted", "Contacted"], ["interested", "Interested"], ["meeting", "Meeting"], ["won", "Won"]];
const END_STAGES = { lost: "Not interested", do_not_contact: "Do not contact" };
const KIND_WORD = { call: "Call", email: "Email", meeting: "Meeting", post: "Post", note: "Note", status: "Status" };
export const OUTCOME_WORD = {
  meeting_booked: "Meeting booked", callback_requested: "Asked for a call back", contacted: "Spoke with them", interested: "Interested",
  left_voicemail: "Left a voicemail", no_answer: "No answer", busy: "Busy", rejected: "Not interested", wrong_number: "Wrong number",
  do_not_call: "Asked not to be called", failed: "Did not connect", canceled: "Cancelled", operator_ended: "Ended by a person",
};
const SUGGEST_WORD = { email: "Email", contact_name: "Contact", best_time: "Best time to call" };

export function StageBadge({ stage }) {
  const label = END_STAGES[stage] || (STAGES.find(([k]) => k === stage) || [])[1] || "New";
  const tone = stage === "do_not_contact" || stage === "lost" ? C.red : stage === "meeting" || stage === "won" ? "#16A34A" : stage === "interested" ? "var(--ui-accent)" : C.slate;
  // The accent is a CSS variable, so a hex suffix (tone + "33") is not a colour: mix it instead, and the pill keeps its border and tint.
  const tint = (pct) => (tone.startsWith("var(") ? `color-mix(in srgb, ${tone} ${pct}%, transparent)` : `${tone}${pct === 20 ? "33" : "12"}`);
  return <span title={STAGE_TIPS[stage] || undefined} style={{ ...text, fontSize: 11.5, fontWeight: 600, color: tone, border: `1px solid ${tint(20)}`, background: tint(7), borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap" }}>{label}</span>;
}

// The stage bar. Each step carries what it means; the current one is also written out under the bar, so it reads without hovering.
function Journey({ stage }) {
  const at = STAGES.findIndex(([k]) => k === stage);
  if (END_STAGES[stage]) return <div><StageBadge stage={stage} /></div>;
  return (
    <ol style={{ display: "flex", gap: 4, margin: 0, padding: 0, listStyle: "none" }} aria-label="Stages">
      {STAGES.map(([k, label], i) => (
        <li key={k} title={STAGE_TIPS[k]} aria-current={i === at ? "step" : undefined} aria-label={`${STAGE_TIPS[k]}${i === at ? " This is the stage now." : ""}`} style={{ flex: 1, minWidth: 0, cursor: "help" }}>
          <div style={{ height: 5, borderRadius: 3, background: i <= at ? "var(--ui-accent)" : C.border }} />
          <div style={{ ...muted, fontSize: 11, marginTop: 3, color: i === at ? C.ink : C.slate, fontWeight: i === at ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
        </li>
      ))}
    </ol>
  );
}

// One thing you can start: the button, one line on what it does, and when it is off, why and how to fix it.
function Action({ name, state, onGoTab, children, button }) {
  const why = useId();
  const off = state && !state.ok;
  return (
    <div style={card}>
      {button(off ? why : undefined)}
      <div style={{ ...muted, fontSize: 12 }}>{ACTION_WORDS[name].does}</div>
      {off ? (
        <div id={why} style={{ ...muted, fontSize: 12, color: C.textInk }}>
          <b>{state.reason}</b>{" "}
          {state.fix && state.fixTab && onGoTab ? <button type="button" className="ui-link" onClick={() => onGoTab(state.fixTab)}>{state.fix}</button> : state.fix}
          {state.plan ? <button type="button" className="ui-link" onClick={() => openPlans("voice")}>See Voice plans</button> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

// account: the saved company ({ id, name, email, phone, business_record_id, connection, research }).
// find: where this screen looks for a missing phone or email, { text, tab }. onGoTab(tab): switch the profile to that tab.
export function LeadActivity({ account, store, find, onGoTab }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [openCall, setOpenCall] = useState("");
  const [pick, setPick] = useState({ date: "", time: "" });
  const [showWhy, setShowWhy] = useState(false);
  const call = useCallDialog(store.toast);
  const voice = useConnection("call_leads");
  const booking = useConnection("booking_in_email");
  const [score, setScore] = useState(null);
  const dateRef = useRef(null);
  const noteRef = useRef(null);
  const ids = useId();
  useEffect(() => {
    let live = true;
    api.getConnectionLeads().then((r) => { if (live) setScore(r.leads?.[account.id]?.score ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [account.id, data]);

  const load = useCallback(async () => {
    try {
      setData(await api.getTimeline(account.id, kind));
      setError("");
    } catch (e) {
      setError(e.message || "Couldn't load this company's history.");
    }
  }, [account.id, kind]);
  useEffect(() => { load(); }, [load]);

  const run = async (key, fn, done) => {
    setBusy(key);
    try {
      await fn();
      if (done) store.toast(done);
      await load();
      await store.reload?.();
    } catch (e) {
      store.toast(e.message || "That didn't work.");
    } finally {
      setBusy("");
    }
  };
  const copy = async (key, getter, done) => {
    setBusy(key);
    try {
      const value = await getter();
      try { await navigator.clipboard.writeText(value); store.toast(done); } catch (_) { store.toast(value); }
    } catch (e) {
      store.toast(e.message || "Couldn't get that.");
    } finally {
      setBusy("");
    }
  };
  const addNote = () => {
    const problem = noteProblem(note);
    if (problem) { store.toast(problem); return; }
    run("note", async () => {
      await api.addLeadNoteEntry({ companyId: account.business_record_id || "", accountId: account.id, text: cleanNote(note) });
      setNote("");
      notesChanged();
    }, "Note added. It is on the Notes tab too.");
  };

  const lead = { ...(account.connection || {}), ...(data?.lead || {}) };
  const stage = lead.stage || "new";
  const suggestions = lead.suggestions || [];
  const callsById = Object.fromEntries((data?.calls || []).map((c) => [c.id, c]));
  const counts = data?.counts || null;
  const email = account.email || "";
  const states = {
    call: withFind(callState({ lead: { ...lead, stage }, phone: account.phone, voice }), find),
    email: withFind(emailState({ lead: { stage }, email }), find),
    booking: bookingState({ lead: { stage }, booking }),
  };
  const target = { kind: "one", id: account.id, name: account.name };
  const start = {
    call: () => call.open(target),
    email: () => writeEmail(email),
    meeting: () => dateRef.current?.focus(),
    note: () => noteRef.current?.focus(),
  };
  const filter = filterFor(kind);
  const emptyAction = filter.action && (filter.action === "note" || states[filter.action === "meeting" ? "booking" : filter.action]?.ok)
    ? { call: "Call", email: "Write an email", meeting: "Book a meeting", note: "Add a note" }[filter.action] : "";
  const bookTip = !pick.date || !pick.time ? "Pick a date and a time first." : "Puts the meeting in your calendar and sends them an invitation.";

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={muted}>{ACTIVITY_INTRO}</div>

      <div style={heading}>Start something</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 210px), 1fr))", gap: 8 }}>
        <Action name="call" state={states.call} onGoTab={onGoTab} button={(why) => (
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ alignSelf: "flex-start" }} disabled={!states.call.ok}
            aria-describedby={why} title={actionTip("call", states.call)} onClick={start.call}>
            {states.call.plan ? <Lock size={13} /> : <Phone size={13} />} Call
          </button>
        )} />
        <Action name="email" state={states.email} onGoTab={onGoTab} button={(why) => (
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ alignSelf: "flex-start" }} disabled={!states.email.ok}
            aria-describedby={why} title={states.email.ok ? `${ACTION_WORDS.email.does} To: ${email}` : actionTip("email", states.email)} onClick={start.email}>
            <Mail size={13} /> Write an email
          </button>
        )} />
        <Action name="meeting" state={states.booking} onGoTab={onGoTab} button={() => <div style={{ ...text, fontSize: 13, fontWeight: 600, color: C.ink, display: "flex", gap: 6, alignItems: "center" }}><CalendarPlus size={14} aria-hidden="true" /> Book a meeting</div>}>
          {states.booking.ok ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input ref={dateRef} className="ui-input" type="date" style={{ height: 30, width: "auto", minWidth: 0, maxWidth: "100%" }} aria-label="Meeting date" value={pick.date} onChange={(e) => setPick((p) => ({ ...p, date: e.target.value }))} />
              <input className="ui-input" type="time" style={{ height: 30, width: "auto", minWidth: 0 }} aria-label="Meeting time" value={pick.time} onChange={(e) => setPick((p) => ({ ...p, time: e.target.value }))} />
              <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!pick.date || !pick.time || busy === "book"} title={bookTip}
                onClick={() => run("book", async () => { await api.bookFromLead({ lead_id: account.id, date: pick.date, time: pick.time }); setPick({ date: "", time: "" }); }, "Booked. It is in your calendar and they have an invitation on its way.")}>Book</button>
            </div>
          ) : null}
        </Action>
        <Action name="link" state={states.booking} onGoTab={onGoTab} button={(why) => (
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ alignSelf: "flex-start" }} disabled={!states.booking.ok || busy === "link"}
            aria-describedby={why} title={states.booking.ok ? `${ACTION_WORDS.link.does} Paste it into an email or message.` : actionTip("link", states.booking)}
            onClick={() => copy("link", async () => (await api.getBookingLink(account.id)).url, "Booking link copied. Paste it into an email or message.")}><Copy size={13} /> Copy booking link</button>
        )} />
        <Action name="times" state={states.booking} onGoTab={onGoTab} button={(why) => (
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ alignSelf: "flex-start" }} disabled={!states.booking.ok || busy === "times"}
            aria-describedby={why} title={actionTip("times", states.booking)}
            onClick={() => copy("times", async () => (await api.getLeadSlots(account.id)).text, "Your free times are copied. Paste them into your reply.")}><CalendarClock size={13} /> Copy times to reply with</button>
        )} />
      </div>

      <div style={heading}>Stage</div>
      <div style={muted}>{STAGE_INTRO}</div>
      <Journey stage={stage} />
      <div style={{ ...muted, color: C.textInk }}>Now: {STAGE_TIPS[stage] || STAGE_TIPS.new}</div>
      <label style={{ ...muted, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        Move to stage
        <select className="ui-input" style={{ height: 30, width: "auto" }} value={stage} disabled={busy === "stage"} title="Set the stage yourself. Calls, replies and booked meetings also move it on by themselves."
          onChange={(e) => run("stage", () => api.setLeadStage(account.id, e.target.value), "Stage changed.")}>
          {STAGES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          <option value="lost">Not interested</option>
          <option value="do_not_contact">Do not contact</option>
        </select>
      </label>
      {score != null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={muted} title={SCORE_WHY}>
            Worth a call: <b style={{ color: C.ink }}>{score}</b> out of 100 ({scoreBand(score)}).{" "}
            <button type="button" className="ui-link" aria-expanded={showWhy} aria-controls={`${ids}-why`} onClick={() => setShowWhy((v) => !v)}>{showWhy ? "Hide" : "What is this?"}</button>
          </div>
          {showWhy ? <div id={`${ids}-why`} style={{ ...muted, fontSize: 12, background: C.paperSoft, borderRadius: 8, padding: "8px 10px" }}>{SCORE_WHY} Low is under 30, medium 30 to 59, high 60 or more.</div> : null}
        </div>
      ) : null}
      {lead.next_action_at ? (
        <div style={{ ...muted, background: C.paperSoft, borderRadius: 8, padding: "8px 10px" }}>
          <PhoneCall size={12} style={{ verticalAlign: "-2px" }} /> {lead.next_action || "Follow up"}: {when(lead.next_action_at)}
        </div>
      ) : null}

      {suggestions.length ? (
        <div style={card}>
          <div style={heading}>Found on a call</div>
          <div style={{ ...muted, fontSize: 12 }}>Your AI caller heard these. Use one to put it on the company record.</div>
          {suggestions.map((s) => (
            <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ ...text, fontSize: 13, flex: 1, minWidth: 160 }}>{SUGGEST_WORD[s.field] || s.field}: <b>{s.value}</b></span>
              <button type="button" title="Put this on the company record" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy === s.id} onClick={() => run(s.id, () => api.resolveSuggestion(account.id, s.id, true), "Updated.")}><Check size={13} /> Use it</button>
              <button type="button" title="Leave the company record as it is" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy === s.id} onClick={() => run(s.id, () => api.resolveSuggestion(account.id, s.id, false))}><X size={13} /> Ignore</button>
            </div>
          ))}
        </div>
      ) : null}

      {Object.values(account.research?.socials || {}).some(Boolean) ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", ...text, fontSize: 12.5 }}>
          <span style={muted}>Find them on:</span>
          {Object.entries(account.research.socials).filter(([, url]) => url).map(([network, url]) => (
            <a key={network} className="ui-link" title={`Open their ${network} page in a new tab`} href={String(url).startsWith("http") ? url : `https://${url}`} target="_blank" rel="noreferrer">{network}</a>
          ))}
        </div>
      ) : null}

      {(data?.meetings || []).length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={heading}>Meetings</div>
          {data.meetings.map((m) => (
            <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", ...text, fontSize: 13 }}>
              <span style={{ flex: 1, minWidth: 160 }}>{m.date} {m.time} · {m.outcome === "no_show" ? "Did not attend" : m.status.replace("_", " ")}</span>
              {m.video_link ? <a className="ui-link" title="Open the meeting's video call in a new tab" href={m.video_link} target="_blank" rel="noreferrer">Join link</a> : null}
              {m.call_id ? <span style={muted}>booked on a call</span> : null}
              {m.status !== "converted" && m.outcome !== "no_show" ? (
                <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy === m.id} title="Mark that they didn't come. This runs the no-show follow-ups you switched on"
                  onClick={() => run(m.id, () => api.markNoShow(m.id), "Marked as not attended.")}>Didn't attend</button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {(data?.calls || []).length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={heading}>Calls</div>
          {data.calls.map((c) => (
            <div key={c.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", ...text, fontSize: 13 }}>
                <b style={{ flex: 1, minWidth: 120 }}>{OUTCOME_WORD[c.outcome] || c.outcome}</b>
                <span style={muted}>{c.started_at} · {c.duration}</span>
                {c.summary ? <button type="button" className="ui-link" aria-expanded={openCall === c.id} onClick={() => setOpenCall(openCall === c.id ? "" : c.id)}>{openCall === c.id ? "Hide summary" : "Summary of the call"}</button> : null}
              </div>
              {openCall === c.id && c.summary ? <div style={{ ...muted, whiteSpace: "pre-wrap", marginTop: 6 }}>{c.summary}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      <div style={heading}>Timeline</div>
      <div role="group" aria-label="Show on the timeline" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {KIND_FILTERS.map((f) => {
          const n = counts ? kindCount(counts, f.kind) : null;
          return (
            <React.Fragment key={f.kind || "all"}>
              <button type="button" title={f.tip} aria-describedby={`${ids}-tip-${f.kind || "all"}`} aria-pressed={kind === f.kind}
                className={`ui-btn ui-btn--sm ${kind === f.kind ? "ui-btn--primary" : "ui-btn--ghost"}`} onClick={() => setKind(f.kind)}>
                {n == null ? f.label : pillText(f.label, n)}
              </button>
              <span id={`${ids}-tip-${f.kind || "all"}`} hidden>{f.tip}</span>
            </React.Fragment>
          );
        })}
      </div>
      <div style={{ ...muted, fontSize: 12 }}>{filter.tip}</div>
      {error ? <div role="alert" style={{ ...text, fontSize: 13, color: C.red }}>{error} <button type="button" className="ui-link" onClick={load}>Try again</button></div> : null}
      {!data && !error ? <Loader compact label="Loading" /> : null}
      {data && !data.events.length ? (
        <div style={{ ...muted, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>{filter.empty}</span>
          {emptyAction ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={start[filter.action]}>{emptyAction}</button> : null}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {(data?.events || []).map((e) => (
          <div key={e.id} style={{ display: "flex", gap: 10, padding: "6px 0", borderTop: `1px solid ${C.border}`, flexWrap: "wrap" }}>
            <span style={{ ...muted, width: 92, flex: "none" }}>{when(e.at)}</span>
            <span style={{ ...text, fontSize: 11.5, fontWeight: 600, color: C.slate, width: 62, flex: "none" }}>{KIND_WORD[e.kind] || e.kind}</span>
            <span style={{ ...text, fontSize: 13, color: C.textInk, flex: "1 1 160px", minWidth: 0, overflowWrap: "anywhere" }}>
              {e.summary}
              {e.kind === "call" && e.detail?.log_id && callsById[e.detail.log_id]?.summary ? <button type="button" className="ui-link" style={{ marginLeft: 6 }} onClick={() => setOpenCall(e.detail.log_id)}>Summary of the call</button> : null}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
        <label htmlFor={`${ids}-note`} style={{ ...text, fontSize: 13, fontWeight: 600, color: C.ink }}>Add a note to the timeline</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input ref={noteRef} id={`${ids}-note`} className="ui-input" style={{ flex: 1, minWidth: 0 }} placeholder="For example: Spoke to Sam, call back after the 12th"
            aria-describedby={`${ids}-note-help`} value={note} maxLength={NOTE_MAX}
            onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && note.trim() && busy !== "note") addNote(); }} />
          <button type="button" title="Add this note. Your team sees it here and on the Notes tab, with your name and the time" className="ui-btn ui-btn--primary ui-btn--sm"
            disabled={!note.trim() || busy === "note"} onClick={addNote}>Add</button>
        </div>
        <div id={`${ids}-note-help`} style={{ ...muted, fontSize: 12 }}>Saved as a team note: it shows here under Notes and on the Notes tab, with your name and the time.</div>
      </div>
      {call.dialog}
    </section>
  );
}
