import React, { useCallback, useEffect, useState } from "react";
import { Loader } from "../../app/Loader";
import { CalendarClock, Check, Copy, Lock, PhoneCall, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";
import { openPlans, useConnection } from "../../hooks/useConnections";
import { CallButton, useCallDialog } from "./CallFlow";

// Everything that has happened with one company, across Lead Gen, Voice and Social: where it is in the journey,
// what a call found out (to accept or ignore), meetings, calls with their summaries, and one timeline.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.5 };
const heading = { ...text, fontSize: 13.5, fontWeight: 600, color: C.ink };

export const STAGES = [["new", "New"], ["contacted", "Contacted"], ["interested", "Interested"], ["meeting", "Meeting"], ["won", "Won"]];
const END_STAGES = { lost: "Not interested", do_not_contact: "Do not contact" };
const KIND_FILTERS = [["", "All"], ["call", "Calls"], ["email", "Emails"], ["meeting", "Meetings"], ["post", "Posts"], ["note", "Notes"]];
const KIND_WORD = { call: "Call", email: "Email", meeting: "Meeting", post: "Post", note: "Note", status: "Status" };
const OUTCOME_WORD = {
  meeting_booked: "Meeting booked", callback_requested: "Asked for a call back", contacted: "Spoke with them", interested: "Interested",
  left_voicemail: "Left a voicemail", no_answer: "No answer", busy: "Busy", rejected: "Not interested", wrong_number: "Wrong number",
  do_not_call: "Asked not to be called", failed: "Did not connect", canceled: "Cancelled", operator_ended: "Ended by a person",
};
const SUGGEST_WORD = { email: "Email", contact_name: "Contact", best_time: "Best time to call" };

export function StageBadge({ stage }) {
  const label = END_STAGES[stage] || (STAGES.find(([k]) => k === stage) || [])[1] || "New";
  const tone = stage === "do_not_contact" || stage === "lost" ? C.red : stage === "meeting" || stage === "won" ? "#16A34A" : stage === "interested" ? "var(--ui-accent)" : C.slate;
  return <span style={{ ...text, fontSize: 11.5, fontWeight: 600, color: tone, border: `1px solid ${tone}33`, background: `${tone}12`, borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap" }}>{label}</span>;
}

function Journey({ stage }) {
  const at = STAGES.findIndex(([k]) => k === stage);
  if (END_STAGES[stage]) return <div><StageBadge stage={stage} /></div>;
  return (
    <div style={{ display: "flex", gap: 4 }} aria-label={`Stage: ${stage}`}>
      {STAGES.map(([k, label], i) => (
        <div key={k} style={{ flex: 1, minWidth: 0 }}>
          <div style={{ height: 5, borderRadius: 3, background: i <= at ? "var(--ui-accent)" : C.border }} />
          <div style={{ ...muted, fontSize: 11, marginTop: 3, color: i === at ? C.ink : C.slateLight, fontWeight: i === at ? 600 : 400 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

export function LeadActivity({ account, store }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [openCall, setOpenCall] = useState("");
  const [pick, setPick] = useState({ date: "", time: "" });
  const call = useCallDialog(store.toast);
  const booking = useConnection("booking_in_email");
  const [score, setScore] = useState(null);
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
  const copy = async (getter, done) => {
    setBusy("copy");
    try {
      const value = await getter();
      try { await navigator.clipboard.writeText(value); store.toast(done); } catch (_) { store.toast(value); }
    } catch (e) {
      store.toast(e.message || "Couldn't get that.");
    } finally {
      setBusy("");
    }
  };

  const lead = data?.lead;
  const stage = lead?.stage || account.connection?.stage || "new";
  const suggestions = lead?.suggestions || [];
  const callsById = Object.fromEntries((data?.calls || []).map((c) => [c.id, c]));
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={heading}>Journey</div>
      <Journey stage={stage} />
      {score != null ? (
        <div style={muted} title="Adds up: a checked email and phone, a named contact, how far along they are, call results, email opens and post engagement.">
          Worth a call: <b style={{ color: C.ink }}>{score}</b> out of 100 ({score >= 60 ? "strong" : score >= 30 ? "fair" : "low"}). Higher means easier to reach and more interested.
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <CallButton label="Call" lockedLabel="Call · add Voice" onClick={() => call.open({ kind: "one", id: account.id, name: account.name })}
          onLocked={() => call.open({ kind: "one", id: account.id, name: account.name }, true)} />
        {booking.available ? (
          <>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy === "copy"} title="A page where they pick a free time. Paste it into an email or message"
              onClick={() => copy(async () => (await api.getBookingLink(account.id)).url, "Booking link copied.")}><Copy size={13} /> Booking link</button>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy === "copy"} title="Free times in their own time zone, as text for a reply"
              onClick={() => copy(async () => (await api.getLeadSlots(account.id)).text, "Times copied.")}><CalendarClock size={13} /> Times to reply with</button>
          </>
        ) : (
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Booking pages and meeting times come with Voice" onClick={() => openPlans("voice")}><Lock size={13} /> Booking · add Voice</button>
        )}
        <select className="ui-input" style={{ height: 30, width: "auto" }} aria-label="Move to a stage" value={stage} disabled={busy === "stage"}
          onChange={(e) => run("stage", () => api.setLeadStage(account.id, e.target.value), "Moved.")}>
          {STAGES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          <option value="lost">Not interested</option>
          <option value="do_not_contact">Do not contact</option>
        </select>
      </div>
      {booking.available ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={muted}>Book a time:</span>
          <input className="ui-input" type="date" style={{ height: 30, width: "auto" }} aria-label="Meeting date" value={pick.date} onChange={(e) => setPick((p) => ({ ...p, date: e.target.value }))} />
          <input className="ui-input" type="time" style={{ height: 30, width: "auto" }} aria-label="Meeting time" value={pick.time} onChange={(e) => setPick((p) => ({ ...p, time: e.target.value }))} />
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!pick.date || !pick.time || busy === "book"} title="Books it in your calendar and sends them the invitation"
            onClick={() => run("book", async () => { await api.bookFromLead({ lead_id: account.id, date: pick.date, time: pick.time }); setPick({ date: "", time: "" }); }, "Booked. The invitation is on its way.")}>Book</button>
        </div>
      ) : null}
      {lead?.next_action_at ? (
        <div style={{ ...muted, background: C.paperSoft, borderRadius: 8, padding: "8px 10px" }}>
          <PhoneCall size={12} style={{ verticalAlign: "-2px" }} /> {lead.next_action || "Follow up"}: {when(lead.next_action_at)}
        </div>
      ) : null}

      {suggestions.length ? (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={heading}>Found on a call</div>
          {suggestions.map((s) => (
            <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ ...text, fontSize: 13, flex: 1, minWidth: 160 }}>{SUGGEST_WORD[s.field] || s.field}: <b>{s.value}</b></span>
              <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy === s.id} onClick={() => run(s.id, () => api.resolveSuggestion(account.id, s.id, true), "Updated.")}><Check size={13} /> Use it</button>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy === s.id} onClick={() => run(s.id, () => api.resolveSuggestion(account.id, s.id, false))}><X size={13} /> Ignore</button>
            </div>
          ))}
        </div>
      ) : null}

      {Object.values(account.research?.socials || {}).some(Boolean) ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", ...text, fontSize: 12.5 }}>
          <span style={muted}>Find them on:</span>
          {Object.entries(account.research.socials).filter(([, url]) => url).map(([network, url]) => (
            <a key={network} className="ui-link" href={String(url).startsWith("http") ? url : `https://${url}`} target="_blank" rel="noreferrer">{network}</a>
          ))}
        </div>
      ) : null}

      {(data?.meetings || []).length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={heading}>Meetings</div>
          {data.meetings.map((m) => (
            <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", ...text, fontSize: 13 }}>
              <span style={{ flex: 1, minWidth: 160 }}>{m.date} {m.time} · {m.outcome === "no_show" ? "Did not attend" : m.status.replace("_", " ")}</span>
              {m.video_link ? <a className="ui-link" href={m.video_link} target="_blank" rel="noreferrer">Join link</a> : null}
              {m.call_id ? <span style={muted}>booked on a call</span> : null}
              {m.status !== "converted" && m.outcome !== "no_show" ? (
                <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy === m.id} title="They didn't come. Runs the follow-ups you switched on"
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
              <div style={{ display: "flex", gap: 8, alignItems: "center", ...text, fontSize: 13 }}>
                <b style={{ flex: 1 }}>{OUTCOME_WORD[c.outcome] || c.outcome}</b>
                <span style={muted}>{c.started_at} · {c.duration}</span>
                {c.summary ? <button type="button" className="ui-link" onClick={() => setOpenCall(openCall === c.id ? "" : c.id)}>{openCall === c.id ? "Hide summary" : "Summary"}</button> : null}
              </div>
              {openCall === c.id && c.summary ? <div style={{ ...muted, whiteSpace: "pre-wrap", marginTop: 6 }}>{c.summary}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      <div style={heading}>Timeline</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {KIND_FILTERS.map(([k, label]) => (
          <button key={k || "all"} type="button" className={`ui-btn ui-btn--sm ${kind === k ? "ui-btn--primary" : "ui-btn--ghost"}`} onClick={() => setKind(k)}>{label}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input className="ui-input" style={{ flex: 1 }} placeholder="Add a note" aria-label="Add a note" value={note} maxLength={500}
          onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) run("note", async () => { await api.addLeadNote(account.id, note.trim()); setNote(""); }); }} />
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!note.trim() || busy === "note"} onClick={() => run("note", async () => { await api.addLeadNote(account.id, note.trim()); setNote(""); })}>Add</button>
      </div>
      {error ? <div role="alert" style={{ ...text, fontSize: 13, color: C.red }}>{error}</div> : null}
      {!data && !error ? <Loader compact label="Loading" /> : null}
      {data && !data.events.length ? <div style={muted}>Nothing has happened with this company yet. Calls, emails, meetings and posts will appear here.</div> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {(data?.events || []).map((e) => (
          <div key={e.id} style={{ display: "flex", gap: 10, padding: "6px 0", borderTop: `1px solid ${C.border}` }}>
            <span style={{ ...muted, width: 92, flex: "none" }}>{when(e.at)}</span>
            <span style={{ ...text, fontSize: 11.5, fontWeight: 600, color: C.slate, width: 62, flex: "none" }}>{KIND_WORD[e.kind] || e.kind}</span>
            <span style={{ ...text, fontSize: 13, color: C.textInk, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
              {e.summary}
              {e.kind === "call" && e.detail?.log_id && callsById[e.detail.log_id]?.summary ? <button type="button" className="ui-link" style={{ marginLeft: 6 }} onClick={() => setOpenCall(e.detail.log_id)}>summary</button> : null}
            </span>
          </div>
        ))}
      </div>
      {call.dialog}
    </section>
  );
}
