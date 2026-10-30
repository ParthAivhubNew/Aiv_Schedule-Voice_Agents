import React, { useCallback, useEffect, useRef, useState } from "react";
import { C } from "../../tokens";
import { api } from "../../api/apiClient";
import { Loader, Spinner } from "../../app/Loader";
import { Note, Pill, btn as baseBtn, card, input, useAction, when } from "../../adminPortal/ui";
import { askConfirm, askText } from "./Dialogs";
import { useConnection, openPlans } from "../../hooks/useConnections";
import { Drawer } from "./FindLeadsParts";
import { Chips, Field, Note as InfoNote, Row as FieldRow, input as timeInput, priBtn, secBtn } from "../scheduler/ScheduleWindow";
import { parseLeads } from "./OutreachViews";
import { ArrowDown, ArrowUp, Bot, CheckSquare, ChevronDown, ChevronUp, Lock, Mail, MoreHorizontal, Pause, PenLine, Phone, Play, Plus, Share2, SlidersHorizontal, Sparkles, Trash2, Users, X } from "lucide-react";
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

// ── A list that scrolls like a wheel: no scroll bar, arrows where there is more, the edges fade ─────────────────
const WHEEL_CSS = `
.jw-scroll{scrollbar-width:none;-ms-overflow-style:none;scroll-behavior:smooth;overscroll-behavior:contain}
.jw-scroll::-webkit-scrollbar{display:none}
.jw-scroll[data-up="true"][data-down="true"]{-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 34px,#000 calc(100% - 34px),transparent 100%);mask-image:linear-gradient(to bottom,transparent 0,#000 34px,#000 calc(100% - 34px),transparent 100%)}
.jw-scroll[data-up="true"][data-down="false"]{-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 34px);mask-image:linear-gradient(to bottom,transparent 0,#000 34px)}
.jw-scroll[data-up="false"][data-down="true"]{-webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - 34px),transparent 100%);mask-image:linear-gradient(to bottom,#000 calc(100% - 34px),transparent 100%)}
.jw-arrow{all:unset;cursor:pointer;position:absolute;left:50%;transform:translateX(-50%);width:30px;height:24px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid #D5D9E0;color:#475467;box-shadow:0 2px 8px rgba(20,24,40,.12);z-index:2}
.jw-arrow:hover{background:#F4F6FA}.jw-arrow:focus-visible{outline:2px solid var(--ui-accent,#7C3AED);outline-offset:2px}
.jw-arrow[data-dir="down"]{bottom:2px;animation:jw-nudge 1.8s ease-in-out infinite}
.jw-arrow[data-dir="up"]{top:2px}
.jw-quiet{scrollbar-width:none;-ms-overflow-style:none}.jw-quiet::-webkit-scrollbar{display:none}
@keyframes jw-nudge{0%,100%{transform:translate(-50%,0)}50%{transform:translate(-50%,3px)}}
@media (prefers-reduced-motion:reduce){.jw-scroll{scroll-behavior:auto}.jw-arrow[data-dir="down"]{animation:none}}
`;

function Wheel({ label, children }) {
  const ref = useRef(null);
  const [edge, setEdge] = useState({ up: false, down: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = { up: el.scrollTop > 4, down: el.scrollTop + el.clientHeight < el.scrollHeight - 4 };
    setEdge((e) => (e.up === next.up && e.down === next.down ? e : next));
  }, []);
  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, children]);
  const by = (dir) => { const el = ref.current; if (el) el.scrollBy({ top: dir * Math.max(120, el.clientHeight * 0.75) }); };
  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
      <style>{WHEEL_CSS}</style>
      <div ref={ref} className="jw-scroll" role="region" aria-label={label} tabIndex={0} data-up={edge.up} data-down={edge.down} onScroll={measure}
        title={edge.up || edge.down ? "Scroll with your mouse wheel, your finger or the arrows to see more" : undefined}
        style={{ height: "100%", overflowY: "auto", display: "grid", gap: 8, alignContent: "start", padding: "2px 2px 6px", scrollSnapType: "y proximity" }}>
        {children}
      </div>
      {edge.up ? <button type="button" className="jw-arrow" data-dir="up" aria-label="Scroll up for more" title="More above" onClick={() => by(-1)}><ChevronUp size={16} /></button> : null}
      {edge.down ? <button type="button" className="jw-arrow" data-dir="down" aria-label="Scroll down for more" title="More below: scroll or press" onClick={() => by(1)}><ChevronDown size={16} /></button> : null}
    </div>
  );
}

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

// ── Rules: the same fields and look as the Voice and Social schedulers (days, times, a daily limit), then when to stop ──
const DAY_OPTIONS = WEEKDAYS.map(([n, w]) => ({ id: n, label: w }));
const ALWAYS_STOP = ["reply", "booking", "optout"];

function RulesPanel({ j, mailboxes, onSave, saving }) {
  const s = j.settings;
  const [draft, setDraft] = useState(() => ({
    mailbox_ids: s.mailbox_ids || [], days_of_week: s.days_of_week || [], sending_window_start: s.sending_window_start, sending_window_end: s.sending_window_end,
    daily_cap: s.daily_cap || 0, one_at_a_time: s.one_at_a_time !== false, on_not_interested: s.rules.on_not_interested !== false, unresponsive_days: s.rules.unresponsive_days,
    skip_stages: s.rules.skip_stages || [],
  }));
  const [more, setMore] = useState(false);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const toggleBox = (id) => set({ mailbox_ids: draft.mailbox_ids.includes(id) ? draft.mailbox_ids.filter((x) => x !== id) : [...draft.mailbox_ids, id] });
  const days = DAY_OPTIONS.filter((d) => draft.days_of_week.includes(d.id)).map((d) => d.label).join(", ");
  const from = mailboxes.filter((m) => draft.mailbox_ids.includes(m.id)).map((m) => m.email);
  const sentence = days
    ? `Emails go out ${days}, between ${draft.sending_window_start} and ${draft.sending_window_end}${draft.daily_cap ? `, at most ${draft.daily_cap} a day` : ""}${from.length ? `, from ${from.join(", ")}` : ""}.`
    : "Pick the days emails may go out.";
  const stopValue = [...ALWAYS_STOP, ...(draft.on_not_interested ? ["not_interested"] : [])];
  return (
    <div>
      <InfoNote tone={days && from.length ? undefined : "warn"}>{from.length ? sentence : `${sentence} Choose an email account to send from.`}</InfoNote>
      <Field label="Send emails as" hint={mailboxes.length ? "Pick one or more. The journey spreads its emails across them." : ""}>
        {mailboxes.length ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Chips options={mailboxes.map((m) => ({ id: m.id, label: m.email }))} value={draft.mailbox_ids} onChange={(v) => set({ mailbox_ids: v })} />
          </div>
        ) : <div style={small}>No email account is connected yet. Connect one under Email accounts.</div>}
      </Field>
      <Field label="Send on">
        <Chips options={DAY_OPTIONS} value={draft.days_of_week} onChange={(v) => set({ days_of_week: v })} />
      </Field>
      <FieldRow>
        <Field label="From"><input type="time" aria-label="Send from" style={timeInput} value={draft.sending_window_start} onChange={(e) => set({ sending_window_start: e.target.value })} /></Field>
        <Field label="Until"><input type="time" aria-label="Send until" style={timeInput} value={draft.sending_window_end} onChange={(e) => set({ sending_window_end: e.target.value })} /></Field>
        <Field label="Most emails a day" hint="0 means no extra limit."><input type="number" min="0" aria-label="Most emails a day" style={timeInput} value={draft.daily_cap} onChange={(e) => set({ daily_cap: Number(e.target.value) || 0 })} /></Field>
      </FieldRow>
      <Field label="Stop for a person when they" hint="Replying, booking a meeting and opting out always stop it, so nobody who answers is written to again.">
        <Chips options={[{ id: "reply", label: "Reply" }, { id: "booking", label: "Book a meeting" }, { id: "optout", label: "Opt out" }, { id: "not_interested", label: "Say they are not interested" }]}
          value={stopValue} onChange={(v) => set({ on_not_interested: v.includes("not_interested") })} />
      </Field>
      <div style={{ marginBottom: 14 }}>
        <button type="button" aria-expanded={more} style={secBtn} onClick={() => setMore((m) => !m)}>{more ? "Fewer options" : "More options"}</button>
      </div>
      {more ? (
        <>
          <Field label="Mark as no answer after" hint="Days of silence after the last step. 0 means never.">
            <input type="number" min="0" max="60" aria-label="Days of silence before no answer" style={{ ...timeInput, width: 140 }} value={draft.unresponsive_days} onChange={(e) => set({ unresponsive_days: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="Leave out anyone whose stage is">
            <Chips options={STAGES.map(([v, w]) => ({ id: v, label: w }))} value={draft.skip_stages} onChange={(v) => set({ skip_stages: v })} />
          </Field>
          <Field label="Other journeys">
            <Chips options={[{ id: "one", label: "Skip people already in another running journey" }]} value={draft.one_at_a_time ? ["one"] : []} onChange={(v) => set({ one_at_a_time: v.includes("one") })} />
          </Field>
        </>
      ) : null}
      <button type="button" style={{ ...priBtn, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={() => onSave({
        mailbox_ids: draft.mailbox_ids, days_of_week: draft.days_of_week, sending_window_start: draft.sending_window_start, sending_window_end: draft.sending_window_end,
        daily_cap: draft.daily_cap, one_at_a_time: draft.one_at_a_time, rules: { on_not_interested: draft.on_not_interested, unresponsive_days: draft.unresponsive_days, skip_stages: draft.skip_stages },
      })}>{saving ? <><Spinner size={13} /> Saving</> : "Save"}</button>
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

      <Drawer open={rules} onClose={() => setRules(false)} title="Rules" sub={j.name} avatar={<span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 10, background: C.paperSoft || "#F4F6FA", display: "grid", placeItems: "center", color: C.slate }}><SlidersHorizontal size={18} /></span>}>
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
          <label title={callOk ? "Tick to add a step where the AI phones the person if they have not replied to your emails. Calls use your calling credits, and you review the journey before anything starts." : "Needs the Voice plugin and a plan. It would add a step where the AI phones people who have not replied to your emails."}
            style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, opacity: callOk ? 1 : 0.6, cursor: callOk ? "pointer" : "not-allowed" }}>
            <input type="checkbox" disabled={!callOk} checked={calls && callOk} onChange={(e) => setCalls(e.target.checked)} /> Add a call{callOk ? "" : " (needs Voice)"}
          </label>
          <label title="Tick to add a step that becomes a to-do for you when someone has not replied, such as ringing them yourself, a LinkedIn message or a personal email. That person waits until you mark it done."
            style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={tasks} onChange={(e) => setTasks(e.target.checked)} /> Add a task for me
          </label>
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

  if (journeys === null) return <Loader compact label="Loading your journeys" />;
  const open = (id) => { setCreating(false); setSelected(id); load(); };
  const empty = !journeys.length;

  return (
    <div style={narrow ? { display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0, overflowY: "auto" } : { display: "flex", gap: 16, alignItems: "stretch", height: "100%", minHeight: 0 }} className={narrow ? "jw-quiet" : undefined}>
      <style>{WHEEL_CSS}</style>
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
      <aside aria-label="Your journeys" style={{ flex: "0 0 270px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
        <button type="button" style={{ ...btn(true), width: "100%", justifyContent: "center", textAlign: "center" }} onClick={() => { setCreating(true); }}><Plus size={14} /> New journey</button>
        <Wheel label="Your journeys: scroll for more">
        {journeys.map((j) => {
          const on = !creating && j.id === selected;
          return (
            <button key={j.id} type="button" aria-current={on ? "true" : undefined} onClick={() => open(j.id)}
              style={{ all: "unset", boxSizing: "border-box", cursor: "pointer", display: "grid", gap: 3, padding: "10px 12px", borderRadius: 12, scrollSnapAlign: "start", border: `1px solid ${on ? C.cobalt : C.borderLight}`, background: on ? C.cobaltSoft : "#fff" }}>
              <span style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "space-between" }}>
                <strong style={{ fontSize: 13.5, overflowWrap: "anywhere" }}>{j.name}</strong>
                <Pill tone={STATUS_TONES[j.status]}>{STATUS_WORDS[j.status] || j.status}</Pill>
              </span>
              <span style={small}>{headline(j.results, j.tasks_open)}</span>
            </button>
          );
        })}
        {empty ? <div style={small}>No journeys yet.</div> : null}
        </Wheel>
      </aside>
      )}
      <main className="jw-quiet" style={{ flex: "1 1 0", minWidth: 0, minHeight: 0, overflowY: narrow ? "visible" : "auto", paddingBottom: 12 }}>
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
