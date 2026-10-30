import React, { useCallback, useEffect, useRef, useState } from "react";
import { C } from "../../tokens";
import { api } from "../../api/apiClient";
import { Spinner } from "../../app/Loader";
import { Note, Pill, btn as baseBtn, card, input, useAction, when } from "../../adminPortal/ui";
import { askConfirm, askText } from "./Dialogs";
import { useConnection, openPlans } from "../../hooks/useConnections";
import { Drawer } from "./FindLeadsParts";
import { parseLeads } from "./OutreachViews";
import { ArrowDown, ArrowUp, Bot, CheckSquare, Lock, Mail, MoreHorizontal, Pause, PenLine, Phone, Play, Plus, Share2, SlidersHorizontal, Sparkles, Trash2, Users, X } from "lucide-react";
import {
  CALL_OUTCOMES, FINISH_WORDS, PERSON_WORDS, STAGES, STATUS_TONES, STATUS_WORDS, STEP_TYPES, WEEKDAYS, addedText, blankStep, blockers, headline, moveStep, sortTasks, stepLine,
  stepsForSave, typeOf, waitText,
} from "./journeyLogic";

const btn = (primary, disabled) => ({ ...baseBtn(primary, disabled), ...(primary ? { background: "var(--ui-accent)" } : {}), minHeight: 36 });
const small = { fontSize: 12, color: C.slate };
const row = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const TONES = { red: { bg: "#fef2f2", ink: "#b91c1c" }, amber: { bg: "#fffbeb", ink: "#92400e" }, green: { bg: "#f0fdf4", ink: "#166534" } };
const label = { display: "grid", gap: 4, fontSize: 12, fontWeight: 600, color: C.slate };
const ICONS = { email: Mail, call: Phone, manual_email: PenLine, call_task: Phone, task: CheckSquare, social_task: Share2, linkedin_task: Users };
const ACCENT = { email: [C.cobalt, C.cobaltSoft], manual_email: [C.cobalt, C.cobaltSoft], call: [C.teal, C.tealSoft], call_task: [C.teal, C.tealSoft], social_task: [C.amber, C.amberSoft], task: [C.slate, C.paperSoft], linkedin_task: [C.slate, C.paperSoft] };

// ── One step: a row you can open and change where it is ─────────────────────
function StepRow({ step, index, count, open, onOpen, onChange, onMove, onRemove, callOk }) {
  const Icon = ICONS[step.channel] || Mail;
  const [fg, bg] = ACCENT[step.channel] || ACCENT.task;
  const set = (k) => (e) => onChange({ ...step, [k]: e.target.value });
  const isEmail = step.channel === "email" || step.channel === "manual_email";
  const isCall = step.channel === "call";
  const second = Boolean(step.body_b || step.subject_b);
  return (
    <li style={{ border: `1px solid ${open ? C.cobalt : C.borderLight}`, borderRadius: 12, background: "#fff", overflow: "hidden" }}>
      <button type="button" onClick={onOpen} aria-expanded={open} style={{ all: "unset", boxSizing: "border-box", width: "100%", cursor: "pointer", display: "flex", gap: 10, alignItems: "center", padding: "10px 12px" }}>
        <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 15, flexShrink: 0, display: "grid", placeItems: "center", background: bg, color: fg }}><Icon size={14} /></span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{index + 1}. {stepLine(step)}</span>
          <span style={small}>{waitText(step, index)}{isCall && step.condition === "no_reply" ? ", if no reply" : isCall && step.condition === "opened_no_reply" ? ", if opened but no reply" : ""} · {typeOf(step.channel).label}</span>
        </span>
      </button>
      {open ? (
        <div style={{ display: "grid", gap: 10, padding: "4px 12px 12px", borderTop: `1px solid ${C.borderLight}` }}>
          {index > 0 ? (
            <div style={row}>
              <label style={{ ...label, gridAutoFlow: "column", alignItems: "center", gap: 6 }}>Wait
                <input aria-label="Days to wait" type="number" min="0" max="365" style={{ ...input, width: 70 }} value={step.delay_days} onChange={set("delay_days")} /> days
                <input aria-label="Hours to wait" type="number" min="0" max="23" style={{ ...input, width: 70 }} value={step.delay_hours} onChange={set("delay_hours")} /> hours
              </label>
            </div>
          ) : null}
          {isEmail ? (
            <>
              <label style={label}>Subject{index > 0 && step.channel === "email" ? " (leave empty to reply in the same thread)" : ""}
                <input style={input} value={step.subject} onChange={set("subject")} maxLength={300} placeholder="Quick idea for {{company}}" />
              </label>
              <label style={label}>{step.channel === "manual_email" ? "The email you will send" : "Email"}
                <textarea style={{ ...input, minHeight: 110, resize: "vertical" }} value={step.body} onChange={set("body")} placeholder={"Hi {{first_name}},\n\n"} />
              </label>
              <div style={small}>Use {"{{first_name}}"}, {"{{last_name}}"}, {"{{company}}"} and {"{{personal_line}}"}.</div>
              {step.channel === "email" ? (
                second ? (
                  <div style={{ display: "grid", gap: 8, padding: 10, background: C.paperSoft, borderRadius: 10 }}>
                    <strong style={{ fontSize: 12.5 }}>Second version (half the people get this one)</strong>
                    <input aria-label="Second version subject" style={input} value={step.subject_b} onChange={set("subject_b")} placeholder="Another subject" />
                    <textarea aria-label="Second version email" style={{ ...input, minHeight: 90, resize: "vertical" }} value={step.body_b} onChange={set("body_b")} />
                    <button type="button" style={{ ...btn(false), justifySelf: "start" }} onClick={() => onChange({ ...step, subject_b: "", body_b: "" })}>Remove the second version</button>
                  </div>
                ) : <button type="button" style={{ ...btn(false), justifySelf: "start" }} onClick={() => onChange({ ...step, subject_b: step.subject, body_b: step.body || " " })}>Test a second version</button>
              ) : null}
            </>
          ) : null}
          {isCall ? (
            <>
              {!callOk ? <div role="status" style={{ ...small, color: TONES.amber.ink }}>Calls need the Voice plan. <button type="button" style={{ all: "unset", color: C.cobalt, cursor: "pointer", fontWeight: 600 }} onClick={() => openPlans("voice")}>See plans</button></div> : null}
              <label style={label}>What is this call for?
                <input style={input} value={step.goal} onChange={set("goal")} maxLength={600} placeholder="Ask if they'd like a 15 minute intro" />
              </label>
              <label style={label}>Talking points (optional)
                <textarea style={{ ...input, minHeight: 70, resize: "vertical" }} value={step.notes} onChange={set("notes")} placeholder="Mention the case study. Ask who handles this." />
              </label>
              <div style={row}>
                <label style={label}>Call when
                  <select style={input} value={step.condition} onChange={set("condition")}>
                    <option value="always">Always</option><option value="no_reply">They have not replied</option><option value="opened_no_reply">They opened but did not reply</option>
                  </select>
                </label>
                <label style={label}>Voicemail
                  <select style={input} value={step.voicemail} onChange={set("voicemail")}>
                    <option value="hang_up">Hang up</option><option value="leave_message">Leave a short message</option>
                  </select>
                </label>
                <label style={label}>If nobody answers
                  <select style={input} value={step.retries} onChange={set("retries")}>
                    <option value={0}>Move on</option><option value={1}>Try once more</option><option value={2}>Try twice more</option><option value={3}>Try three more times</option>
                  </select>
                </label>
              </div>
            </>
          ) : null}
          {!isEmail && !isCall ? (
            <>
              <label style={label}>Task
                <input style={input} value={step.title} onChange={set("title")} maxLength={120} placeholder={typeOf(step.channel).label} />
              </label>
              <label style={label}>What to do
                <textarea style={{ ...input, minHeight: 70, resize: "vertical" }} value={step.notes} onChange={set("notes")} placeholder="Instructions for whoever does it" />
              </label>
            </>
          ) : null}
          <div style={row}>
            <button type="button" aria-label="Move this step up" disabled={index === 0} style={btn(false, index === 0)} onClick={() => onMove(-1)}><ArrowUp size={14} /></button>
            <button type="button" aria-label="Move this step down" disabled={index === count - 1} style={btn(false, index === count - 1)} onClick={() => onMove(1)}><ArrowDown size={14} /></button>
            <button type="button" aria-label="Remove this step" disabled={count <= 1} style={{ ...btn(false, count <= 1), marginLeft: "auto", color: C.red }} onClick={onRemove}><Trash2 size={14} /> Remove step</button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

// ── What needs the person today, on the same page ───────────────────────────
function NeedsYou({ tasks, replied, onDone, onSkip, onMail, busy }) {
  const [outcome, setOutcome] = useState({});
  const list = sortTasks(tasks);
  if (!list.length && !replied) return <div style={{ ...small, padding: "2px 2px" }}>Nothing needs you right now.</div>;
  return (
    <div style={{ ...card, display: "grid", gap: 10, padding: 12 }}>
      <strong style={{ fontSize: 14 }}>Needs you today</strong>
      {replied ? (
        <div style={{ ...row, justifyContent: "space-between" }}>
          <span style={{ fontSize: 13 }}>{replied} {replied === 1 ? "person has" : "people have"} replied.</span>
          <button type="button" style={btn(false)} onClick={onMail}>Read replies</button>
        </div>
      ) : null}
      {list.map((t) => {
        const call = t.kind === "call_task";
        return (
          <div key={t.id} style={{ display: "grid", gap: 6, padding: "9px 0", borderTop: `1px solid ${C.borderLight}` }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{t.title}</div>
                <div style={small}>{[t.contact, t.company, t.phone, t.email].filter(Boolean).join(" · ")}{t.due_at ? ` · due ${when(t.due_at)}` : ""}</div>
                {t.notes ? <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", marginTop: 4, color: C.textInk, overflowWrap: "anywhere" }}>{t.notes}</div> : null}
              </div>
              {!call ? <button type="button" style={btn(true, busy)} disabled={busy} onClick={() => onDone(t.id, "")}>Done</button> : null}
              <button type="button" style={btn(false, busy)} disabled={busy} onClick={() => onSkip(t.id)}>Skip</button>
            </div>
            {call ? (
              <div role="group" aria-label="How did the call go?" style={row}>
                {CALL_OUTCOMES.map(([v, w]) => (
                  <button key={v} type="button" disabled={busy} aria-pressed={outcome[t.id] === v} style={{ ...btn(outcome[t.id] === v, busy), padding: "5px 10px" }}
                    onClick={() => (outcome[t.id] === v ? onDone(t.id, v) : setOutcome((o) => ({ ...o, [t.id]: v })))}>{w}</button>
                ))}
                {outcome[t.id] ? <span style={small}>Press {CALL_OUTCOMES.find(([v]) => v === outcome[t.id])?.[1]} again to save.</span> : <span style={small}>Choose how it went.</span>}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ── Rules: only what is asked, the rest under More ──────────────────────────
function RulesPanel({ j, mailboxes, onSave, saving }) {
  const s = j.settings;
  const [draft, setDraft] = useState(() => ({
    mailbox_ids: s.mailbox_ids || [], days_of_week: s.days_of_week || [], sending_window_start: s.sending_window_start, sending_window_end: s.sending_window_end,
    daily_cap: s.daily_cap || 0, one_at_a_time: s.one_at_a_time !== false, on_not_interested: s.rules.on_not_interested !== false, unresponsive_days: s.rules.unresponsive_days,
    skip_stages: s.rules.skip_stages || [],
  }));
  const [more, setMore] = useState(false);
  const toggle = (key, value) => setDraft((d) => ({ ...d, [key]: d[key].includes(value) ? d[key].filter((x) => x !== value) : [...d[key], value] }));
  const chip = (on) => ({ ...btn(on), padding: "5px 11px" });
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 6 }}>
        <legend style={{ ...label, padding: 0 }}>Send emails as</legend>
        {mailboxes.length ? mailboxes.map((m) => (
          <label key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={draft.mailbox_ids.includes(m.id)} onChange={() => toggle("mailbox_ids", m.id)} /> {m.email}
          </label>
        )) : <div style={small}>No email account is connected yet. Connect one under Email accounts.</div>}
      </fieldset>
      <div style={{ display: "grid", gap: 6 }}>
        <span style={label}>Send on</span>
        <div role="group" aria-label="Sending days" style={row}>
          {WEEKDAYS.map(([n, w]) => <button key={n} type="button" aria-pressed={draft.days_of_week.includes(n)} style={chip(draft.days_of_week.includes(n))} onClick={() => toggle("days_of_week", n)}>{w}</button>)}
        </div>
        <div style={row}>
          <label style={label}>From<input type="time" style={input} value={draft.sending_window_start} onChange={(e) => setDraft({ ...draft, sending_window_start: e.target.value })} /></label>
          <label style={label}>Until<input type="time" style={input} value={draft.sending_window_end} onChange={(e) => setDraft({ ...draft, sending_window_end: e.target.value })} /></label>
          <label style={label}>Most emails a day (0 = no extra limit)<input type="number" min="0" style={{ ...input, width: 110 }} value={draft.daily_cap} onChange={(e) => setDraft({ ...draft, daily_cap: Number(e.target.value) || 0 })} /></label>
        </div>
      </div>
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 6 }}>
        <legend style={{ ...label, padding: 0 }}>Stop for a person when they</legend>
        {[["reply", "reply"], ["book a meeting", "book a meeting"], ["opt out", "opt out"]].map(([k, w]) => (
          <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: C.slate }}><input type="checkbox" checked disabled /> {w} <Lock size={12} aria-label="always on" /></label>
        ))}
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={draft.on_not_interested} onChange={(e) => setDraft({ ...draft, on_not_interested: e.target.checked })} /> say they are not interested</label>
      </fieldset>
      <button type="button" aria-expanded={more} style={{ ...btn(false), justifySelf: "start" }} onClick={() => setMore((m) => !m)}>{more ? "Fewer options" : "More options"}</button>
      {more ? (
        <div style={{ display: "grid", gap: 12 }}>
          <label style={label}>Mark as "no answer" after this many days of silence (0 = never)
            <input type="number" min="0" max="60" style={{ ...input, width: 110 }} value={draft.unresponsive_days} onChange={(e) => setDraft({ ...draft, unresponsive_days: Number(e.target.value) || 0 })} />
          </label>
          <div style={{ display: "grid", gap: 6 }}>
            <span style={label}>Leave out anyone whose stage is</span>
            <div role="group" aria-label="Stages to leave out" style={row}>
              {STAGES.map(([v, w]) => <button key={v} type="button" aria-pressed={draft.skip_stages.includes(v)} style={chip(draft.skip_stages.includes(v))} onClick={() => toggle("skip_stages", v)}>{w}</button>)}
            </div>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={draft.one_at_a_time} onChange={(e) => setDraft({ ...draft, one_at_a_time: e.target.checked })} /> Don't add people who are already in another running journey</label>
        </div>
      ) : null}
      <button type="button" style={{ ...btn(true, saving), justifySelf: "start" }} disabled={saving} onClick={() => onSave({
        mailbox_ids: draft.mailbox_ids, days_of_week: draft.days_of_week, sending_window_start: draft.sending_window_start, sending_window_end: draft.sending_window_end,
        daily_cap: draft.daily_cap, one_at_a_time: draft.one_at_a_time, rules: { on_not_interested: draft.on_not_interested, unresponsive_days: draft.unresponsive_days, skip_stages: draft.skip_stages },
      })}>Save</button>
    </div>
  );
}

// ── One journey, all on one page ────────────────────────────────────────────
function JourneyPage({ id, outreach, lists, onGo, onAskAssistant, onChanged, onGone }) {
  const [j, setJ] = useState(null);
  const [err, setErr] = useState("");
  const [steps, setSteps] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [openStep, setOpenStep] = useState(-1);
  const [menu, setMenu] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [rules, setRules] = useState(false);
  const [details, setDetails] = useState(false);
  const [advice, setAdvice] = useState(null);
  const [listId, setListId] = useState("");
  const [paste, setPaste] = useState("");
  const [count, setCount] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const callOk = useConnection("call_step").available;
  const stepsRef = useRef(false);

  const load = useCallback(async (keepSteps) => {
    try {
      const r = await api.journey(id);
      setJ(r.journey);
      setErr("");
      if (!keepSteps || !stepsRef.current) setSteps(r.journey.steps);
    } catch (e) {
      setErr(e.message || "Couldn't load this journey.");
    }
  }, [id]);
  const [msg, run] = useAction(() => { load(false); onChanged?.(); });
  useEffect(() => { stepsRef.current = false; setDirty(false); setOpenStep(-1); setJ(null); load(false); }, [id, load]);
  useEffect(() => { stepsRef.current = dirty; }, [dirty]);
  useEffect(() => {
    if (!j || j.status !== "running") return undefined;
    const t = setInterval(() => load(true), 20000);
    return () => clearInterval(t);
  }, [j && j.status, load]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!j) return err ? <Note error>{err}</Note> : <div style={{ padding: 24 }}><Spinner size={18} /></div>;
  const red = blockers(j.preflight);
  const live = j.status === "running";
  const edit = (next) => { setSteps(next); setDirty(true); };
  const fix = { people: () => setAdding(true), settings: () => setRules(true), mailboxes: () => onGo("mailboxes"), credits: () => onGo("subscription"), voice: () => openPlans("voice"), steps: () => setAddMenu(true) };
  const people = j.people || [];
  const shown = showAll ? people : people.slice(0, 5);
  const mailList = parseLeads(paste);
  const preview = async (lid) => { setListId(lid); setCount(null); if (lid) { try { setCount(await api.journeyPeople(j.id, { list_id: lid, how_many: 200, dry_run: true })); } catch (e) { setCount({ error: e.message }); } } };
  const task = async (fn) => { setBusy(true); try { await fn(); await load(true); onChanged?.(); } finally { setBusy(false); } };

  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ ...row, justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={row}>
              <button type="button" title="Rename" onClick={async () => { const n = await askText({ title: "Rename this journey", initial: j.name, confirm: "Save" }); if (n && n.trim()) run(() => api.journeySettings(j.id, { name: n.trim() })); }}
                style={{ all: "unset", cursor: "pointer", fontSize: 18, fontWeight: 700, overflowWrap: "anywhere" }}>{j.name}</button>
              <Pill tone={STATUS_TONES[j.status]}>{STATUS_WORDS[j.status] || j.status}</Pill>
            </div>
            <div style={small}>{headline(j.results, j.tasks_open)}{j.goal ? ` · ${j.goal}` : ""}</div>
          </div>
          <div style={row}>
            {live ? <button type="button" style={btn(false)} onClick={() => run(() => api.journeyStatus(j.id, "paused"), "Paused. Nobody loses their place.")}><Pause size={14} /> Pause</button>
              : <button type="button" style={btn(true, red.length > 0)} disabled={red.length > 0} title={red.length ? red[0].text : "Start it"} onClick={() => run(() => api.journeyStatus(j.id, "running"), "Running. The first step goes out in the next sending window.")}><Play size={14} /> {j.status === "paused" ? "Resume" : "Start"}</button>}
            <button type="button" style={btn(false)} onClick={() => setRules(true)}><SlidersHorizontal size={14} /> Rules</button>
            <button type="button" style={btn(false)} title="Ask the AI about this journey" onClick={() => onAskAssistant?.()}><Bot size={14} /> Ask AI</button>
            <span style={{ position: "relative" }}>
              <button type="button" aria-label="More" aria-haspopup="menu" aria-expanded={menu} style={{ ...btn(false), padding: "0 9px" }} onClick={() => setMenu((m) => !m)}><MoreHorizontal size={16} /></button>
              {menu ? (
                <>
                  <div onClick={() => setMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 79 }} />
                  <div className="ui-menu" role="menu" style={{ zIndex: 80 }}>
                    <button type="button" role="menuitem" className="ui-menu-item" onClick={() => { setMenu(false); run(async () => { const r = await api.journeyClone(j.id); onChanged?.(r.journey.id); }, "Copied as a draft."); }}>Make a copy</button>
                    <button type="button" role="menuitem" className="ui-menu-item" onClick={async () => { setMenu(false); setDetails(true); setAdvice(null); api.journeySuggestions(j.id).then((r) => setAdvice(r.suggestions)).catch(() => setAdvice([])); }}>Results and advice</button>
                    {j.status !== "completed" && j.status !== "draft" ? (
                      <button type="button" role="menuitem" className="ui-menu-item" style={{ color: C.red }} onClick={async () => { setMenu(false); if (await askConfirm({ title: `Stop ${j.name}?`, body: "This ends it for everyone still in it. It can't be started again.", confirm: "Stop it", danger: true })) run(() => api.journeyStatus(j.id, "stopped")); }}>Stop it</button>
                    ) : null}
                    <button type="button" role="menuitem" className="ui-menu-item" style={{ color: C.red }} onClick={async () => { setMenu(false); if (await askConfirm({ title: `Delete ${j.name}?`, body: "The people in it and its tasks are deleted with it.", confirm: "Delete", danger: true })) { await api.journeyDelete(j.id); onGone?.(); } }}><Trash2 size={14} /> Delete</button>
                  </div>
                </>
              ) : null}
            </span>
          </div>
        </div>
        <Note error={msg.error}>{msg.text}</Note>
      </div>

      {!live ? (
        <div role="status" style={{ display: "grid", gap: 6 }}>
          {(j.preflight || []).map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, lineHeight: 1.5, color: TONES[p.level]?.ink, background: TONES[p.level]?.bg, borderRadius: 8, padding: "7px 11px" }}>
              <span style={{ flex: "1 1 240px" }}>{p.text}</span>
              {p.fix && fix[p.fix] ? <button type="button" style={{ ...btn(false), padding: "3px 10px" }} onClick={fix[p.fix]}>Fix</button> : null}
            </div>
          ))}
        </div>
      ) : (j.results.waiting_on_a_task ? <div style={small}>{j.results.waiting_on_a_task} waiting on a task.</div> : null)}

      <NeedsYou tasks={j.tasks} replied={j.results.by_status.replied} busy={busy} onMail={() => onGo("mail")}
        onDone={(tid, outcome) => task(() => api.journeyTaskDone(tid, outcome))} onSkip={(tid) => task(() => api.journeyTaskSkip(tid))} />

      <div style={{ ...card, display: "grid", gap: 10, padding: 12 }}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <strong style={{ fontSize: 14 }}>Steps</strong>
          {dirty ? (
            <div style={row}>
              <button type="button" style={btn(false)} onClick={() => { setSteps(j.steps); setDirty(false); }}>Undo</button>
              <button type="button" style={btn(true)} onClick={() => run(async () => { await api.journeySteps(j.id, stepsForSave(steps)); setDirty(false); }, live ? "Saved. People part-way through keep their place." : "Saved.")}>Save changes</button>
            </div>
          ) : null}
        </div>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {steps.map((s, i) => (
            <StepRow key={s.key || i} step={s} index={i} count={steps.length} open={openStep === i} callOk={callOk}
              onOpen={() => setOpenStep(openStep === i ? -1 : i)} onChange={(n) => edit(steps.map((x, k) => (k === i ? n : x)))}
              onMove={(by) => { edit(moveStep(steps, i, by)); setOpenStep(i + by); }}
              onRemove={() => { edit(steps.filter((_, k) => k !== i).map((x, k) => (k === 0 ? { ...x, delay_days: 0, delay_hours: 0 } : x))); setOpenStep(-1); }} />
          ))}
        </ol>
        <div style={{ position: "relative", justifySelf: "start" }}>
          <button type="button" aria-expanded={addMenu} style={btn(false)} onClick={() => setAddMenu((m) => !m)}><Plus size={14} /> Add a step</button>
          {addMenu ? (
            <>
              <div onClick={() => setAddMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 79 }} />
              <div className="ui-menu" role="menu" style={{ zIndex: 80, minWidth: 260 }}>
                {STEP_TYPES.map((t) => {
                  const Icon = ICONS[t.channel];
                  const locked = t.needs === "call_step" && !callOk;
                  return (
                    <button key={t.channel} type="button" role="menuitem" className="ui-menu-item" disabled={locked && false}
                      onClick={() => { setAddMenu(false); if (locked) { openPlans("voice"); return; } const next = [...steps, blankStep(t.channel, steps.length)]; edit(next); setOpenStep(next.length - 1); }}>
                      <Icon size={14} /> <span style={{ display: "grid", textAlign: "left" }}><span>{t.label}{locked ? " (needs Voice)" : ""}</span><span style={small}>{t.hint}</span></span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div style={{ ...card, display: "grid", gap: 10, padding: 12 }}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <strong style={{ fontSize: 14 }}>People <span style={{ ...small, fontWeight: 500 }}>{j.results.people}</span></strong>
          <button type="button" aria-expanded={adding} style={btn(false)} onClick={() => setAdding((a) => !a)}><Plus size={14} /> Add people</button>
        </div>
        {adding ? (
          <div style={{ display: "grid", gap: 8 }}>
            <label style={label}>From one of your lists
              <select style={input} value={listId} onChange={(e) => preview(e.target.value)}>
                <option value="">Choose a list</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({(l.ids || []).length})</option>)}
              </select>
            </label>
            {count ? <div style={{ fontSize: 12.5 }}>{count.error ? count.error : addedText(count)}</div> : null}
            {listId && count && !count.error && count.added ? (
              <button type="button" style={{ ...btn(true), justifySelf: "start" }} onClick={() => run(async () => { const out = await api.journeyPeople(j.id, { list_id: listId, how_many: 200 }); setListId(""); setCount(null); setAdding(false); return out; }, `Added ${count.added}. Nothing is sent until the journey is running.`)}>Add {count.added}</button>
            ) : null}
            <label style={label}>Or paste people (email, first name, last name, company; one per line)
              <textarea style={{ ...input, minHeight: 70, fontFamily: "monospace" }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="ann@client.com, Ann, Lee, Client Ltd" />
            </label>
            {mailList.length ? <button type="button" style={{ ...btn(true), justifySelf: "start" }} onClick={() => run(async () => { const out = await api.journeyPeople(j.id, { people: mailList }); setPaste(""); setAdding(false); return out; }, `Added ${mailList.length} (those already in or on the do-not-email list are skipped).`)}>Add {mailList.length}</button> : null}
          </div>
        ) : null}
        {shown.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${C.borderLight}` }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{p.name || p.email || p.company}</div>
              <div style={small}>{[p.company, p.email].filter(Boolean).join(" · ")}</div>
              <div style={small}>{PERSON_WORDS[p.status] || p.status}{p.status === "active" ? ` · step ${p.step} of ${j.steps.length}${p.waiting ? " · waiting on a task or call" : p.next_at ? ` · next ${when(p.next_at)}` : ""}` : p.finish_reason ? ` · ${FINISH_WORDS[p.finish_reason] || p.finish_reason}` : ""}</div>
            </div>
            <button type="button" aria-label={`Remove ${p.email || p.name}`} style={{ ...btn(false), padding: "0 9px" }} onClick={() => run(() => api.journeyRemovePerson(j.id, p.id))}><X size={14} /></button>
          </div>
        ))}
        {people.length > 5 ? <button type="button" style={{ ...btn(false), justifySelf: "start" }} onClick={() => setShowAll((s) => !s)}>{showAll ? "Show fewer" : `Show all ${people.length}`}</button> : null}
        {!people.length && !adding ? <div style={small}>Nobody yet. Add a list, then start the journey.</div> : null}
      </div>

      <Drawer open={rules} onClose={() => setRules(false)} title="Rules" sub={j.name}>
        <RulesPanel key={j.id + String(rules)} j={j} mailboxes={outreach.mailboxes} saving={busy} onSave={(body) => run(async () => { await api.journeySettings(j.id, body); setRules(false); }, "Saved.")} />
      </Drawer>
      <Drawer open={details} onClose={() => setDetails(false)} title="Results and advice" sub={j.name}>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            {[["People", j.results.people], ["Sent", j.results.sent], ["Opened", j.results.opened], ["Replied", j.results.replied, `${j.results.reply_rate}%`], ["Bounced", j.results.bounced, `${j.results.bounce_rate}%`], ["Waiting on you", j.results.waiting_on_a_task]].map(([k, v, x]) => (
              <div key={k}><div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{v}{x ? <span style={{ fontSize: 12, color: C.slate }}> {x}</span> : null}</div><div style={small}>{k}</div></div>
            ))}
          </div>
          {Object.keys(j.results.variants || {}).length ? (
            <div style={{ display: "grid", gap: 4 }}>
              <strong style={{ fontSize: 13.5 }}>Second version test</strong>
              {Object.entries(j.results.variants).map(([k, v]) => <div key={k} style={{ fontSize: 13 }}>Version {k.toUpperCase()}: {v.sent} sent, {v.replied} replied ({v.reply_rate}%)</div>)}
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 6 }}>
            <strong style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "center" }}><Sparkles size={14} /> Advice from the numbers</strong>
            {advice === null ? <Spinner size={14} /> : advice.map((a, i) => <div key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>{a}</div>)}
          </div>
        </div>
      </Drawer>
    </div>
  );
}

// ── Making a new journey: describe it, pick a ready-made one, or start blank ─
function NewJourney({ lists, onCreated, onCancel, onGuided, initialListId }) {
  const [goal, setGoal] = useState("");
  const [listId, setListId] = useState(initialListId || "");
  const [calls, setCalls] = useState(false);
  const [tasks, setTasks] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const callOk = useConnection("call_step").available;
  useEffect(() => { api.journeyTemplates().then((r) => setTemplates(r.templates || [])).catch(() => {}); }, []);

  const finish = async (made) => {
    if (listId) { try { await api.journeyPeople(made.id, { list_id: listId, how_many: 200 }); } catch (e) { /* the journey is made; adding people can be done on its page */ } }
    onCreated(made.id);
  };
  const go = (name, fn) => async () => {
    setBusy(name);
    setErr("");
    try { finish((await fn()).journey); } catch (e) { setErr(e.message || "That didn't work."); setBusy(""); }
  };

  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <strong style={{ fontSize: 18 }}>New journey</strong>
        <button type="button" style={btn(false)} onClick={onCancel}>Cancel</button>
      </div>
      <Note error>{err}</Note>
      <label style={label}>Who is it for? (optional: they are added as a draft and nothing is sent)
        <select style={input} value={listId} onChange={(e) => setListId(e.target.value)}>
          <option value="">Add people later</option>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({(l.ids || []).length})</option>)}
        </select>
      </label>
      <div style={{ ...card, display: "grid", gap: 10, padding: 12 }}>
        <strong style={{ fontSize: 14, display: "flex", gap: 6, alignItems: "center" }}><Sparkles size={15} /> Say what it is for and we write it</strong>
        <textarea aria-label="What the journey is for" style={{ ...input, minHeight: 74, resize: "vertical" }} value={goal} onChange={(e) => setGoal(e.target.value)}
          placeholder="Introduce us to dental practices in Leeds, then ring them if they have not replied" maxLength={600} />
        <div style={row}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, opacity: callOk ? 1 : 0.6 }}><input type="checkbox" disabled={!callOk} checked={calls && callOk} onChange={(e) => setCalls(e.target.checked)} /> Add a call{callOk ? "" : " (needs Voice)"}</label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={tasks} onChange={(e) => setTasks(e.target.checked)} /> Add a task for me</label>
        </div>
        <button type="button" style={{ ...btn(true, !goal.trim() || Boolean(busy)), justifySelf: "start" }} disabled={!goal.trim() || Boolean(busy)}
          onClick={go("draft", () => api.journeyDraft({ goal: goal.trim(), channels: [...(calls && callOk ? ["call"] : []), ...(tasks ? ["task"] : [])], count: 3 }))}>
          {busy === "draft" ? <><Spinner size={13} /> Writing it</> : "Write it for me"}
        </button>
        <div style={small}>It uses what you wrote in About your business and never invents facts. You review everything before anything is sent.</div>
      </div>
      <div style={{ ...card, display: "grid", gap: 8, padding: 12 }}>
        <strong style={{ fontSize: 14 }}>Or start from a ready-made journey</strong>
        {templates.map((t) => (
          <div key={t.key} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: `1px solid ${C.borderLight}` }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t.name} <span style={small}>· {t.steps} steps</span></div>
              <div style={small}>{t.best_for}</div>
            </div>
            <button type="button" style={btn(false, Boolean(busy))} disabled={Boolean(busy)} onClick={go(t.key, () => api.journeyFromTemplate(t.key))}>{busy === t.key ? <Spinner size={13} /> : "Use"}</button>
          </div>
        ))}
      </div>
      <div style={row}>
        <button type="button" style={btn(false, Boolean(busy))} disabled={Boolean(busy)} onClick={go("blank", () => api.journeyCreate({ name: "New journey", goal: "", steps: [{ channel: "email", subject: "Hello {{company}}", body: "Hi {{first_name}},\n\n" }] }))}>Start from a blank email</button>
        <button type="button" style={{ all: "unset", cursor: "pointer", color: C.cobalt, fontSize: 13, fontWeight: 600 }} onClick={onGuided}>Guided setup with a personal opening line for each person</button>
      </div>
    </div>
  );
}

// True on a phone-sized screen, where the list of journeys becomes a dropdown so the journey itself stays in view.
function useNarrow() {
  const query = "(max-width: 700px)";
  const [narrow, setNarrow] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

// ── The page ────────────────────────────────────────────────────────────────
export function JourneysView({ outreach, listsStore, onGo, onAskAssistant, onGuided, onConsumed, initialId = "", initialListId = "" }) {
  const [prefill, setPrefill] = useState(initialListId); // a list chosen on another page: used once, here
  const [journeys, setJourneys] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(initialId);
  const [creating, setCreating] = useState(false);
  const lists = (listsStore && listsStore.lists) || [];
  const narrow = useNarrow();

  const load = useCallback(async () => {
    try { const r = await api.journeys(); setJourneys(r.journeys || []); setError(""); } catch (e) { setError(e.message || "Couldn't load your journeys."); setJourneys((j) => j || []); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (initialId) { setSelected(initialId); setCreating(false); } }, [initialId]);
  useEffect(() => { if (initialListId) { setPrefill(initialListId); setCreating(true); onConsumed?.(); } }, [initialListId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (journeys && !selected && !creating && journeys.length) setSelected(journeys[0].id); }, [journeys, selected, creating]);

  if (journeys === null) return <div style={{ padding: 24 }}><Spinner size={18} /></div>;
  const open = (id) => { setCreating(false); setSelected(id); load(); };
  const empty = !journeys.length;

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <Note error>{error}</Note>
      {narrow ? (
        <div style={{ ...row, flex: "1 1 100%", flexWrap: "nowrap" }}>
          <select aria-label="Choose a journey" style={{ ...input, flex: 1, minWidth: 0 }} value={creating ? "" : selected} onChange={(e) => open(e.target.value)}>
            {creating || !selected ? <option value="">New journey</option> : null}
            {journeys.map((j) => <option key={j.id} value={j.id}>{j.name} · {STATUS_WORDS[j.status] || j.status}</option>)}
          </select>
          <button type="button" style={btn(true)} onClick={() => setCreating(true)}><Plus size={14} /> New</button>
        </div>
      ) : (
      <aside aria-label="Your journeys" style={{ flex: "1 1 230px", maxWidth: 290, minWidth: 0, display: "grid", gap: 8 }}>
        <button type="button" style={btn(true)} onClick={() => { setCreating(true); }}><Plus size={14} /> New journey</button>
        {journeys.map((j) => {
          const on = !creating && j.id === selected;
          return (
            <button key={j.id} type="button" aria-current={on ? "true" : undefined} onClick={() => open(j.id)}
              style={{ all: "unset", boxSizing: "border-box", cursor: "pointer", display: "grid", gap: 3, padding: "10px 12px", borderRadius: 12, border: `1px solid ${on ? C.cobalt : C.borderLight}`, background: on ? C.cobaltSoft : "#fff" }}>
              <span style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "space-between" }}>
                <strong style={{ fontSize: 13.5, overflowWrap: "anywhere" }}>{j.name}</strong>
                <Pill tone={STATUS_TONES[j.status]}>{STATUS_WORDS[j.status] || j.status}</Pill>
              </span>
              <span style={small}>{headline(j.results, j.tasks_open)}</span>
            </button>
          );
        })}
        {empty ? <div style={small}>No journeys yet.</div> : null}
      </aside>
      )}
      <main style={{ flex: "3 1 420px", minWidth: 0 }}>
        {creating || empty ? (
          <NewJourney lists={lists} initialListId={prefill} onGuided={onGuided} onCancel={() => setCreating(false)} onCreated={(id) => { open(id); }} />
        ) : selected ? (
          <JourneyPage key={selected} id={selected} outreach={outreach} lists={lists} onGo={onGo} onAskAssistant={onAskAssistant}
            onChanged={(newId) => { load(); if (typeof newId === "string") open(newId); }} onGone={() => { setSelected(""); load(); }} />
        ) : null}
      </main>
    </div>
  );
}
