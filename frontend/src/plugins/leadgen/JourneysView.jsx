import React, { useCallback, useEffect, useRef, useState } from "react";
import { notice } from "../../utils/notice";
import { C } from "../../tokens";
import { api } from "../../api/apiClient";
import { Loader, Spinner } from "../../app/Loader";
import { Note, Pill, btn as baseBtn, card, input, useAction, when } from "../../adminPortal/ui";
import { askConfirm, askText } from "./Dialogs";
import { useConnection, openPlans } from "../../hooks/useConnections";
import { Drawer } from "./FindLeadsParts";
import { BrandDialog, DesignBox, DesignPreview, useEmailDesign } from "./EmailDesign";
import { Chips, Field, Note as InfoNote, Row as FieldRow, input as timeInput, priBtn, secBtn } from "../scheduler/ScheduleWindow";
import { parseLeads } from "./OutreachViews";
import { ConsentDeclaration } from "./ConsentDeclaration";
import { niceName } from "./companyLogic";
import { openPhone } from "../../utils/humanCall";
import { ArrowDown, ArrowUp, Bot, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileText, Lock, Mail, MoreHorizontal, Pause, PenLine, Phone, Play, Plus, Share2, SlidersHorizontal, Sparkles, Trash2, Users, X } from "lucide-react";
import {
  CALL_OUTCOMES, FINISH_WORDS, PERSON_WORDS, STAGES, STATUS_TONES, STATUS_WORDS, STEP_TYPES, WEEKDAYS, addedText, blankStep, blockers, headline, moveStep, opensNote, rateText, resultsBar, sortTasks, stepLine, taskGroups,
  stepTable, stepsForSave, typeOf, waitText, withTag,
} from "./journeyLogic";

const btn = (primary, disabled) => ({ ...baseBtn(primary, disabled), ...(primary ? { background: "var(--ui-accent)" } : {}), minHeight: 36 });
const small = { fontSize: 12, color: C.slate };
const row = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const TONES = { red: { bg: "#fef2f2", ink: "#b91c1c" }, amber: { bg: "#fffbeb", ink: "#92400e" }, green: { bg: "#f0fdf4", ink: "#166534" } };
const label = { display: "grid", gap: 4, fontSize: 12, fontWeight: 600, color: C.slate };
const ICONS = { email: Mail, call: Phone, manual_email: PenLine, call_task: Phone, task: CheckSquare, social_task: Share2, linkedin_task: Users, letter_task: FileText };
const ACCENT = { email: [C.cobalt, C.cobaltSoft], manual_email: [C.cobalt, C.cobaltSoft], call: [C.teal, C.tealSoft], call_task: [C.teal, C.tealSoft], social_task: [C.amber, C.amberSoft], task: [C.slate, C.paperSoft], linkedin_task: [C.slate, C.paperSoft], letter_task: [C.slate, C.paperSoft] };

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
// Puts a link to one of the person's published forms into the email text. Each recipient gets their own link when it is sent.
function FormPicker({ onPick }) {
  const [forms, setForms] = useState(null);
  useEffect(() => {
    let alive = true;
    api.listInboundForms().then((r) => { if (alive) setForms((r.forms || r || []).filter((f) => f.status === "published")); }).catch(() => { if (alive) setForms([]); });
    return () => { alive = false; };
  }, []);
  if (!forms) return null;
  if (!forms.length) return <div style={small}>To send a form in this email, publish one under Inbound, Forms first.</div>;
  return (
    <label style={{ ...small, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>Send a form in this email
      <select aria-label="Insert form link" style={{ ...input, width: "auto", maxWidth: 260 }} value="" onChange={(e) => { if (e.target.value) onPick(e.target.value); }}>
        <option value="">Insert form link…</option>
        {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
    </label>
  );
}

function ResultsBar({ results, onOpen, finished = false }) {
  if (!results || (!results.sent && !finished)) return null; // a finished journey always shows its results, even when they are all zero
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <button type="button" onClick={onOpen} aria-label="Open results by step" style={{ all: "unset", boxSizing: "border-box", cursor: "pointer", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(84px, 1fr))", gap: 8, padding: "10px 12px", border: `1px solid ${C.borderLight}`, borderRadius: 12, background: "#fff", minHeight: 44 }}>
        {resultsBar(results).map((b) => (
          <span key={b.key}><span style={{ display: "block", fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{b.value}</span><span style={small}>{b.label}</span></span>
        ))}
      </button>
      <div style={small}>{opensNote(results)}</div>
    </div>
  );
}

function StepTable({ results }) {
  const rows = stepTable(results);
  if (!rows.length) return null;
  const cell = { padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <strong style={{ fontSize: 13.5 }}>Each step</strong>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 420, width: "100%" }}>
          <thead><tr style={{ color: C.slate }}>{["Step", "Sent", "Delivered", "Opened", "Replied", "Booked", "Bounced", "Opted out"].map((h, i) => <th key={h} style={{ ...cell, textAlign: i ? "right" : "left", fontWeight: 600 }}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.step_key} style={{ borderTop: `1px solid ${C.borderLight}` }}>
              <td style={{ ...cell, textAlign: "left" }}>{r.step}</td><td style={cell}>{r.sent}</td><td style={cell}>{r.delivered}</td><td style={cell}>{r.opened} ({rateText(r.open_rate)})</td>
              <td style={cell}>{r.replied} ({rateText(r.reply_rate)})</td><td style={cell}>{r.booked}</td><td style={cell}>{r.bounced}</td><td style={cell}>{r.opted_out}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function PreviewBox({ journeyId, people, steps }) {
  const [who, setWho] = useState("");
  const [stepKey, setStepKey] = useState("");
  const [shown, setShown] = useState(null);
  const [err, setErr] = useState("");
  const emails = steps.filter((s) => s.channel === "email" && s.key);
  useEffect(() => {
    if (!who) { setShown(null); setErr(""); return undefined; }
    let live = true;
    api.journeyPreview(journeyId, who, stepKey).then((r) => { if (live) { setShown(r); setErr(""); } }).catch((e) => { if (live) { setShown(null); setErr(e.message || "That preview didn't load."); } });
    return () => { live = false; };
  }, [journeyId, who, stepKey]);
  if (!people.length || !emails.length) return null;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ ...row, alignItems: "flex-end" }}>
        <label style={{ ...label, flex: "1 1 220px" }}>Preview with a real person
          <select style={input} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Choose someone</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name || p.company || p.email}{p.company && p.name ? ` (${p.company})` : ""}</option>)}
          </select>
        </label>
        {emails.length > 1 ? (
          <label style={{ ...label, flex: "0 1 160px" }}>Email
            <select style={input} value={stepKey} onChange={(e) => setStepKey(e.target.value)}>
              <option value="">First email</option>
              {emails.map((s) => <option key={s.key} value={s.key}>Step {s.step}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      {err ? <div role="status" style={small}>{err}</div> : null}
      {shown ? (
        <div style={{ border: `1px solid ${C.borderLight}`, borderRadius: 12, background: "#fff", padding: 12, display: "grid", gap: 8, overflowWrap: "anywhere" }}>
          <div style={small}>To {shown.to || "(no email address)"}</div>
          <strong style={{ fontSize: 14 }}>{shown.subject || "(same thread)"}</strong>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{shown.body_text}</div>
          <div style={{ ...small, whiteSpace: "pre-wrap", borderTop: `1px solid ${C.borderLight}`, paddingTop: 8 }}>{shown.footer_text}</div>
          {shown.approval_note ? <div style={small}>{shown.approval_note}. It waits for you before it goes out.</div> : null}
        </div>
      ) : null}
    </div>
  );
}

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
              <div style={{ ...small, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span>Use {"{{first_name}}"}, {"{{last_name}}"}, {"{{company}}"}, {"{{personal_line}}"} and {"{{source_line}}"} (says where you found them).</span>
                <button type="button" style={{ ...btn(false), minHeight: 40 }} onClick={() => onChange({ ...step, body: withTag(step.body, "{{source_line}}") })}>Insert source line</button>
              </div>
              <FormPicker onPick={(id) => onChange({ ...step, body: [(step.body || "").trimEnd(), "{{form_link:" + id + "}}"].filter(Boolean).join(String.fromCharCode(10, 10)) })} />
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
function NeedsYou({ tasks, replied, choices = 0, onDone, onSkip, onMail, busy }) {
  const [outcome, setOutcome] = useState({});
  const voiceOk = useConnection("call_step").available;
  const list = sortTasks(tasks);
  if (!list.length && !replied) return <div style={{ ...small, padding: "2px 2px" }}>{choices ? `${choices} ${choices === 1 ? "person is" : "people are"} waiting for your quick choice above. Nothing else needs you.` : "Nothing needs you right now."}</div>;
  return (
    <div style={{ ...card, display: "grid", gap: 10, padding: 12 }}>
      <strong style={{ fontSize: 14 }}>Needs you today</strong>
      {replied ? (
        <div style={{ ...row, justifyContent: "space-between" }}>
          <span style={{ fontSize: 13 }}>{replied} {replied === 1 ? "person has" : "people have"} replied.</span>
          <button type="button" style={btn(false)} onClick={onMail}>Read replies</button>
        </div>
      ) : null}
      {taskGroups(list).map(([gk, gw, rows]) => (
        <div key={gk} style={{ display: "grid", gap: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".02em", color: gk === "overdue" ? C.red : C.slate }}>{gw} · {rows.length}</div>
      {rows.map((t) => {
        const call = t.kind === "call_task";
        const finder = t.kind === "task" && t.instead_of_email; // "find another way": three ways to do it
        return (
          <div key={t.id} style={{ display: "grid", gap: 6, padding: "9px 0", borderTop: `1px solid ${C.borderLight}` }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{t.title}{t.needs_screening ? <> <Pill tone="amber">Check TPS first</Pill></> : null}</div>
                {t.instead_of_email ? <div style={small}>In place of an email, so the journey carries on.</div> : null}
                <div style={small}>{[t.contact, t.company, t.phone, t.email].filter(Boolean).join(" · ")}{t.due_at ? ` · due ${when(t.due_at)}` : ""}</div>
                {t.notes ? <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", marginTop: 4, color: C.textInk, overflowWrap: "anywhere" }}>{t.notes}</div> : null}
              </div>
              {!call ? <button type="button" style={btn(true, busy)} disabled={busy} onClick={() => onDone(t.id, "")}>Done</button> : null}
              <button type="button" style={btn(false, busy)} disabled={busy} onClick={() => onSkip(t.id)}>Skip</button>
            </div>
            {finder ? (
              <div role="group" aria-label="Ways to reach them" style={row}>
                <button type="button" style={btn(false, busy)} disabled={busy || !t.phone} title={t.phone ? "Open the phone here and call. Check the number against the TPS register first" : "No phone number on file"}
                  onClick={() => { openPhone({ number: t.phone, name: t.contact || t.company }); onDone(t.id, "called"); }}>Call</button>
                <button type="button" style={btn(false, busy)} disabled={busy} title="Record that a letter is being sent" onClick={() => onDone(t.id, "letter")}>Send a letter</button>
                {!voiceOk ? <span style={{ ...small, color: TONES.amber.ink }}>Calling from here needs the Voice plan. <button type="button" style={{ all: "unset", color: C.cobalt, cursor: "pointer", fontWeight: 600 }} onClick={() => openPlans("voice")}>See plans</button></span> : null}
                <a href={`https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent([t.contact, t.company].filter(Boolean).join(" "))}`} target="_blank" rel="noreferrer"
                  style={{ ...btn(false, busy), textDecoration: "none", display: "inline-flex", alignItems: "center" }} onClick={() => onDone(t.id, "linkedin")}>Find on LinkedIn</a>
              </div>
            ) : null}
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
      ))}
    </div>
  );
}

// "Search the register": for when none of the suggested companies is right. Type a name or a company number, pick the match.
function RegisterSearch({ busy, onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(null);
  const [looking, setLooking] = useState(false);
  const go = async () => {
    if (q.trim().length < 3) return;
    setLooking(true);
    try { setRows((await api.registerSearch(q.trim())).results || []); } catch (_) { setRows([]); } finally { setLooking(false); }
  };
  if (!open) return <button type="button" style={btn(false, busy)} disabled={busy} title="Look the company up on the register by name or company number" onClick={() => setOpen(true)}>Search the register</button>;
  return (
    <div style={{ display: "grid", gap: 6, flexBasis: "100%" }}>
      <div style={row}>
        <input style={{ ...input, maxWidth: 320 }} autoFocus aria-label="Company name or number" placeholder="Company name or number" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
        <button type="button" style={btn(true, looking)} disabled={looking || q.trim().length < 3} onClick={go}>{looking ? "Searching…" : "Search"}</button>
        <button type="button" style={btn(false)} onClick={() => { setOpen(false); setRows(null); setQ(""); }}>Close</button>
      </div>
      {rows && !rows.length ? <div style={small}>Nothing on the register matches that. Try fewer words, or the company number.</div> : null}
      {(rows || []).map((x) => (
        <div key={x.id}><button type="button" style={btn(false, busy)} disabled={busy} onClick={() => onPick(x)}>
          Is this {niceName(x.name)}{x.number ? ` (${x.number})` : ""}{x.place ? `, ${niceName(x.place)}` : ""}?
        </button></div>
      ))}
    </div>
  );
}

// ── Who gets email, and the one-click choices that are left ─────────────────
function AudienceCard({ audience, busy, onChoose, onDeclared }) {
  const a = audience || {};
  const [consentFor, setConsentFor] = useState(null);
  const [soleFor, setSoleFor] = useState(""); // the contact whose "how do we reach them instead?" choice is open
  if (!a.text) return null;
  const choices = a.choices || [];
  return (
    <div style={{ ...card, display: "grid", gap: 10, padding: 12 }} aria-label="Who gets what">
      <strong style={{ fontSize: 14 }}>{a.text}</strong>
      {a.reach_other_way ? <div style={small}>Sole traders and individuals need their consent before a marketing email, so the journey makes a call, letter or LinkedIn task for them instead and carries on.</div> : null}
      {choices.map((c) => (
        <div key={c.lead_id} style={{ display: "grid", gap: 6, padding: "9px 0", borderTop: `1px solid ${C.borderLight}` }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{niceName(c.name)} <span style={{ ...small, fontWeight: 400 }}>{c.email}</span></div>
          <div style={row}>
            {(c.candidates || []).map((x) => (
              <button key={x.id} type="button" style={btn(false, busy)} disabled={busy} onClick={() => onChoose(c.lead_id, { business_record_id: x.id }, `Matched to ${niceName(x.name)}.`)}>
                Is this {niceName(x.name)}{x.number ? ` (${x.number})` : ""}?
              </button>
            ))}
            <RegisterSearch busy={busy} onPick={(x) => onChoose(c.lead_id, { business_record_id: x.id }, `Matched to ${niceName(x.name)}.`)} />
            <button type="button" style={btn(soleFor === c.lead_id, busy)} disabled={busy} aria-expanded={soleFor === c.lead_id} onClick={() => setSoleFor(soleFor === c.lead_id ? "" : c.lead_id)}>It's a sole trader</button>
            <button type="button" style={btn(false, busy)} disabled={busy} title="Opened by you or already a customer. You say how and when they agreed, and they can be emailed" onClick={() => setConsentFor(c)}>They've opted in / existing contact</button>
          </div>
          {!(c.candidates || []).length ? <div style={small}>No close match in the company register.</div> : null}
          {soleFor === c.lead_id ? (
            <div role="group" aria-label="How to reach them instead of email" style={{ display: "grid", gap: 6 }}>
              <div style={small}>Sole traders aren't emailed without consent. Their email steps are skipped and the journey carries on. How should we reach {c.name} instead?</div>
              <div style={row}>
                {[["call_task", "Call them", "After you check the number against the TPS register"], ["letter_task", "Send a letter", "A task with their address"], ["linkedin_task", "Reach them on LinkedIn", "A task with their profile"], ["", "Let the journey decide", "A call if there is a number, else a letter, else LinkedIn"]].map(([ch, label, tip]) => (
                  <button key={ch || "auto"} type="button" style={btn(false, busy)} disabled={busy} title={tip}
                    onClick={() => { setSoleFor(""); onChoose(c.lead_id, { sole_trader: true, ...(ch ? { channel: ch } : {}) }, `${c.name} will be reached another way${ch ? `: ${label.toLowerCase()}` : ""}.`); }}>{label}</button>
                ))}
              </div>
            </div>
          ) : null}
          {consentFor && consentFor.lead_id === c.lead_id ? (
            <div ref={(el) => { if (el && !el.dataset.seen) { el.dataset.seen = "1"; el.scrollIntoView({ block: "center", behavior: "smooth" }); } }} style={{ marginTop: 4 }}>
              <ConsentDeclaration key={c.lead_id} leadIds={[c.lead_id]} scope="account" count={1} onClose={() => setConsentFor(null)} onDone={(_, msg) => { setConsentFor(null); onDeclared?.(msg); }} />
            </div>
          ) : null}
        </div>
      ))}
      {a.quick_choice > choices.length ? <div style={small}>Showing {choices.length} of {a.quick_choice}. More show here as you answer these.</div> : null}
    </div>
  );
}

// ── Emails waiting for the person to read and approve ───────────────────────
function ApprovalQueue({ items, reason, busy, onSave, onApprove, onApproveAll }) {
  const [open, setOpen] = useState("");
  const [draft, setDraft] = useState({ subject: "", body: "" });
  if (!items.length) return reason ? <div style={small}>{reason}. Emails wait here for you before they go.</div> : null;
  const edit = (a) => { setOpen(a.id); setDraft({ subject: a.subject, body: a.body }); };
  return (
    <div style={{ ...card, display: "grid", gap: 10, padding: 12 }} aria-label="Emails waiting for you">
      <div style={{ ...row, justifyContent: "space-between" }}>
        <strong style={{ fontSize: 14 }}>{items.length} {items.length === 1 ? "email is" : "emails are"} waiting for you</strong>
        <button type="button" style={btn(true, busy)} disabled={busy} onClick={onApproveAll}>Approve all {items.length}</button>
      </div>
      {reason ? <div style={small}>{reason}.</div> : null}
      {items.map((a) => (
        <div key={a.id} style={{ display: "grid", gap: 6, padding: "9px 0", borderTop: `1px solid ${C.borderLight}` }}>
          {open === a.id ? (
            <>
              <input aria-label="Subject" style={input} value={draft.subject} maxLength={300} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} />
              <textarea aria-label="Email" style={{ ...input, minHeight: 120, resize: "vertical" }} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
              <div style={row}>
                <button type="button" style={btn(true, busy || !draft.body.trim())} disabled={busy || !draft.body.trim()} onClick={async () => { await onSave(a.id, draft); setOpen(""); }}>Save</button>
                <button type="button" style={btn(false)} onClick={() => setOpen("")}>Cancel</button>
              </div>
            </>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{a.subject || "(reply in the same thread)"}{a.edited ? <span style={{ ...small, fontWeight: 400 }}> · edited</span> : null}</div>
                <div style={small}>To {[a.email, a.company].filter(Boolean).join(" · ")}</div>
                <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", marginTop: 4, color: C.textInk, overflowWrap: "anywhere", maxHeight: 96, overflow: "hidden" }}>{a.body}</div>
              </div>
              <button type="button" style={btn(false, busy)} disabled={busy} onClick={() => edit(a)}>Edit</button>
              <button type="button" style={btn(true, busy)} disabled={busy} onClick={() => onApprove(a.id)}>Approve</button>
            </div>
          )}
        </div>
      ))}
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
    daily_cap: s.daily_cap || 0, one_at_a_time: s.one_at_a_time !== false, on_not_interested: s.rules.on_not_interested !== false, on_form: s.rules.on_form !== false, unresponsive_days: s.rules.unresponsive_days,
    skip_stages: s.rules.skip_stages || [], approval_required: Boolean(s.approval_required),
  }));
  const [more, setMore] = useState(false);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const toggleBox = (id) => set({ mailbox_ids: draft.mailbox_ids.includes(id) ? draft.mailbox_ids.filter((x) => x !== id) : [...draft.mailbox_ids, id] });
  const days = DAY_OPTIONS.filter((d) => draft.days_of_week.includes(d.id)).map((d) => d.label).join(", ");
  const from = mailboxes.filter((m) => draft.mailbox_ids.includes(m.id)).map((m) => m.email);
  const sentence = days
    ? `Emails go out ${days}, between ${draft.sending_window_start} and ${draft.sending_window_end}${draft.daily_cap ? `, at most ${draft.daily_cap} a day` : ""}${from.length ? `, from ${from.join(", ")}` : ""}.`
    : "Pick the days emails may go out.";
  const stopValue = [...ALWAYS_STOP, ...(draft.on_not_interested ? ["not_interested"] : []), ...(draft.on_form ? ["form"] : [])];
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
        <Chips options={[{ id: "reply", label: "Reply" }, { id: "booking", label: "Book a meeting" }, { id: "optout", label: "Opt out" }, { id: "not_interested", label: "Say they are not interested" }, { id: "form", label: "Send back a form" }]}
          value={stopValue} onChange={(v) => set({ on_not_interested: v.includes("not_interested"), on_form: v.includes("form") })} />
      </Field>
      <Field label="Before each email goes" hint="Always on while a mailbox is still warming up.">
        <Chips options={[{ id: "approve", label: "Let me read and approve it" }]} value={draft.approval_required ? ["approve"] : []} onChange={(v) => set({ approval_required: v.includes("approve") })} />
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
        daily_cap: draft.daily_cap, one_at_a_time: draft.one_at_a_time, approval_required: draft.approval_required, rules: { on_not_interested: draft.on_not_interested, on_form: draft.on_form, unresponsive_days: draft.unresponsive_days, skip_stages: draft.skip_stages },
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
  const addRef = useRef(null);
  const [menuBox, setMenuBox] = useState(null); // where the open Add a step menu sits, kept inside the window (never clipped by a scrolling parent)
  useEffect(() => {
    if (!addMenu) { setMenuBox(null); return; }
    const r = addRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(300, window.innerWidth - 16), gap = 8;
    const below = window.innerHeight - r.bottom - gap - 4, above = r.top - gap - 4;
    const up = below < 280 && above > below;
    setMenuBox({ left: Math.max(gap, Math.min(r.left, window.innerWidth - width - gap)), width,
      ...(up ? { bottom: window.innerHeight - r.top + 4, maxHeight: above } : { top: r.bottom + 4, maxHeight: below }) });
  }, [addMenu]);
  const [adding, setAdding] = useState(false);
  const [rules, setRules] = useState(false);
  const [looks, setLooks] = useState(false); // the "Look of the emails" drawer
  const [brandOpen, setBrandOpen] = useState(false);
  const emailDesign = useEmailDesign();
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
  const fix = { people: () => setAdding(true), settings: () => setRules(true), mailboxes: () => onGo("mailboxes"), business: () => onGo("business"), credits: () => onGo("subscription"), voice: () => openPlans("voice"), steps: () => setAddMenu(true), quick_choice: () => document.getElementById(`aud-${j.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }) };
  const people = j.people || [];
  const shown = showAll ? people : people.slice(0, 5);
  const mailList = parseLeads(paste);
  const preview = async (lid) => { setListId(lid); setCount(null); if (lid) { try { setCount(await api.journeyPeople(j.id, { list_id: lid, how_many: 200, dry_run: true })); } catch (e) { setCount({ error: e.message }); } } };
  const task = async (fn, ok) => {
    setBusy(true);
    try { await fn(); notice(ok); await load(true); onChanged?.(); } catch (e) { notice(e.message || "That didn't work. Try again."); } finally { setBusy(false); }
  };

  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ ...row, justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={row}>
              <button type="button" title="Rename" onClick={async () => { const n = await askText({ title: "Rename this journey", initial: j.name, confirm: "Save" }); if (n && n.trim()) run(() => api.journeySettings(j.id, { name: n.trim() }), "Renamed."); }}
                style={{ all: "unset", cursor: "pointer", fontSize: 18, fontWeight: 700, overflowWrap: "anywhere" }}>{j.name}</button>
              <Pill tone={STATUS_TONES[j.status]}>{STATUS_WORDS[j.status] || j.status}</Pill>
            </div>
            <div style={small}>{headline(j.results, j.tasks_open, j.status)}{j.goal ? ` · ${j.goal}` : ""}</div>
          </div>
          <div style={row}>
            {live ? <button type="button" style={btn(false)} title="Stop sending for now. Nobody loses their place, and you can resume later" onClick={() => run(() => api.journeyStatus(j.id, "paused"), "Paused. Nobody loses their place.")}><Pause size={14} /> Pause</button>
              : <button type="button" style={btn(true, red.length > 0)} disabled={red.length > 0} title={red.length ? red[0].text : "Start it"} onClick={async () => { const n = j.results?.in_progress || 0; if (j.status !== "paused" && n && !(await askConfirm({ title: `Start sending to ${n} ${n === 1 ? "person" : "people"}?`, body: `${j.schedule?.lines?.slice(0, 2).join(" ") || "The first step goes out in the next sending window."}${j.schedule?.finish ? ` The first email to everyone should be out by ${j.schedule.finish}.` : ""} You can pause it at any time.`, confirm: "Start" }))) return; run(() => api.journeyStatus(j.id, "running"), "Running. The first step goes out in the next sending window."); }}><Play size={14} /> {j.status === "paused" ? "Resume" : "Start"}</button>}
            <button type="button" style={btn(false)} title="Sending days and hours, daily limits, which mailbox sends, and when to stop" onClick={() => setRules(true)}><SlidersHorizontal size={14} /> Rules</button>
            <button type="button" style={btn(false)} title="Send these emails with your logo, colours and buttons" onClick={() => setLooks(true)}><PenLine size={14} /> Design</button>
            <button type="button" style={btn(false)} title="Ask the AI to explain, improve or change this journey" onClick={() => onAskAssistant?.()}><Bot size={14} /> Ask AI</button>
            <span style={{ position: "relative" }}>
              <button type="button" aria-label="More" title="More: copy, results and advice, stop, delete" aria-haspopup="menu" aria-expanded={menu} style={{ ...btn(false), padding: "0 9px" }} onClick={() => setMenu((m) => !m)}><MoreHorizontal size={16} /></button>
              {menu ? (
                <>
                  <div onClick={() => setMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 95 }} />
                  <div className="ui-menu" role="menu" style={{ zIndex: 100 }}>
                    <button type="button" role="menuitem" className="ui-menu-item" title="Make a draft copy with the same steps and rules, with nobody in it" onClick={() => { setMenu(false); run(async () => { const r = await api.journeyClone(j.id); onChanged?.(r.journey.id); }, "Copied as a draft."); }}>Make a copy</button>
                    <button type="button" role="menuitem" className="ui-menu-item" title="Sent, opened, replied and bounced counts for each step, with tips to improve them" onClick={async () => { setMenu(false); setDetails(true); setAdvice(null); api.journeySuggestions(j.id).then((r) => setAdvice(r.suggestions)).catch(() => setAdvice([])); }}>Results and advice</button>
                    {j.status === "completed" ? (
                      <button type="button" role="menuitem" className="ui-menu-item" title={j.archived ? "Show it in the Finished list again" : "Tidy it out of the list. Its results are kept and you can bring it back"} onClick={() => { setMenu(false); run(() => api.journeyStatus(j.id, j.archived ? "unarchived" : "archived"), j.archived ? "Brought back." : "Archived. Find it under Archived."); }}>{j.archived ? "Unarchive" : "Archive"}</button>
                    ) : null}
                    {j.status !== "completed" && j.status !== "draft" ? (
                      <button type="button" role="menuitem" className="ui-menu-item" style={{ color: C.red }} title="End it for everyone still in it. It can't be started again" onClick={async () => { setMenu(false); if (await askConfirm({ title: `Stop ${j.name}?`, body: "This ends it for everyone still in it. It can't be started again.", confirm: "Stop it", danger: true })) run(() => api.journeyStatus(j.id, "stopped"), "Stopped. Nobody else gets a step from it."); }}>Stop it</button>
                    ) : null}
                    <button type="button" role="menuitem" className="ui-menu-item" style={{ color: C.red }} title="Remove the journey and its tasks. Your saved companies and contacts stay" onClick={async () => { setMenu(false); if (await askConfirm({ title: `Delete ${j.name}?`, body: "This removes the journey, its tasks and everyone's place in it. Your saved companies and contacts are not deleted.", confirm: "Delete", danger: true })) { try { await api.journeyDelete(j.id); notice(`Deleted ${j.name}.`); onGone?.(); } catch (e) { notice(e.message || "Couldn't delete it. Try again."); } } }}><Trash2 size={14} /> Delete</button>
                  </div>
                </>
              ) : null}
            </span>
          </div>
        </div>
        <Note error={msg.error}>{msg.text}</Note>
      </div>

      {j.status === "draft" ? ( // setup warnings are for drafts only; a running or finished journey shows results
        <div role="status" style={{ display: "grid", gap: 6 }}>
          {(j.preflight || []).filter((p) => !(j.audience?.text && p.text === `${j.audience.text}.`)).map((p, i) => ( // the who-gets-what line is already in its own card below
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, lineHeight: 1.5, color: TONES[p.level]?.ink, background: TONES[p.level]?.bg, borderRadius: 8, padding: "7px 11px" }}>
              <span style={{ flex: "1 1 240px" }}>{p.text}</span>
              {p.fix && fix[p.fix] ? <button type="button" style={{ ...btn(false), padding: "3px 10px" }} onClick={fix[p.fix]}>Fix</button> : null}
            </div>
          ))}
        </div>
      ) : (j.results.waiting_on_a_task ? <div style={small}>{j.results.waiting_on_a_task} waiting on a task.</div> : null)}

      <ResultsBar results={j.results} finished={j.status === "completed"} onOpen={() => { setDetails(true); setAdvice(null); api.journeySuggestions(j.id).then((r) => setAdvice(r.suggestions)).catch(() => setAdvice([])); }} />
      <PreviewBox journeyId={j.id} people={j.people || []} steps={steps} />

      <div id={`aud-${j.id}`}>
        <AudienceCard audience={j.audience} busy={busy} onChoose={(lid, body, ok) => task(() => api.leadEligibilityChoose(lid, body), ok)} onDeclared={(msg) => task(async () => {}, msg || "Saved. They can now be emailed.")} />
      </div>
      <ApprovalQueue items={j.approvals || []} reason={j.approval?.reason} busy={busy}
        onSave={(aid, body) => task(() => api.journeyApprovalEdit(aid, body), "Saved. Approve it and it goes out as it reads now.")}
        onApprove={(aid) => task(() => api.journeyApprove(aid), "Approved. It goes out in the next sending window.")}
        onApproveAll={() => task(() => api.journeyApproveAll(j.id), "All approved. They go out in the next sending windows.")} />

      <NeedsYou tasks={j.tasks} choices={j.audience?.quick_choice || 0} replied={j.results.by_status.replied} busy={busy} onMail={() => onGo("mail")}
        onDone={(tid, outcome) => task(() => api.journeyTaskDone(tid, outcome), "Task done.")} onSkip={(tid) => task(() => api.journeyTaskSkip(tid), "Task skipped.")} />

      <div style={{ ...card, display: "grid", gap: 10, padding: 12 }}>
        <div style={{ ...row, justifyContent: "space-between" }}>
          <strong style={{ fontSize: 14 }}>Steps</strong>
          {dirty ? (
            <div style={row}>
              <button type="button" style={btn(false)} onClick={() => { setSteps(j.steps); setDirty(false); notice("Changes undone."); }}>Undo</button>
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
        <div ref={addRef} style={{ position: "relative", justifySelf: "start", zIndex: 90 }}>
          <button type="button" aria-expanded={addMenu} style={btn(false)} onClick={() => setAddMenu((m) => !m)}><Plus size={14} /> Add a step</button>
          {addMenu ? (
            <>
              <div onClick={() => setAddMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 95 }} />
              <div className="ui-menu ui-menu--left" role="menu" style={{ zIndex: 100, minWidth: 0, position: "fixed", right: "auto", overflowY: "auto", visibility: menuBox ? "visible" : "hidden", ...menuBox }}>
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

      {j.schedule?.lines?.length ? (
        <div style={{ ...card, display: "grid", gap: 6, padding: 12 }} aria-label="When emails go out">
          <strong style={{ fontSize: 14 }}>When emails go out</strong>
          {j.schedule.lines.map((line, i) => <div key={i} style={{ fontSize: 13, lineHeight: 1.45 }}>{line}</div>)}
          <div style={small}>This is an estimate. Each person's exact next send shows under People once the journey is running.</div>
        </div>
      ) : null}
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
              {p.timeline && p.timeline.length ? <div style={small}>{p.timeline[p.timeline.length - 1].text}</div> : null}
              {p.status === "active" && p.bad_address ? (
                <div style={{ ...small, color: C.red }}>Won't be emailed: invalid address.{" "}
                  <button type="button" style={{ all: "unset", cursor: "pointer", textDecoration: "underline", color: C.cobalt }}
                    onClick={async () => {
                      const fixed = await askText({ title: "Fix this email address", label: `${p.name || p.company || "This person"}: what is the right address?`, initial: String(p.email || "").replace(/[.\s]+$/, ""), confirm: "Save" });
                      const addr = String(fixed || "").trim();
                      if (!addr || addr === p.email) return;
                      const [first = "", ...rest] = String(p.name || "").split(" ");
                      run(async () => { await api.journeyRemovePerson(j.id, p.id); return api.journeyPeople(j.id, { people: [{ email: addr, first_name: first, last_name: rest.join(" "), company: p.company || "" }] }); }, `Address fixed for ${p.name || p.company || addr}.`);
                    }}>Fix the address</button></div>
              ) : null}
              <div style={small}>{p.status === "active" && p.bad_address ? "" : p.status === "active" && p.on_hold ? "Waiting for your choice; their emails are on hold" : p.status === "active" && j.status !== "running" && j.status !== "paused" ? "Queued" : (PERSON_WORDS[p.status] || p.status)}{p.status === "active" && (p.on_hold || p.bad_address) ? "" : p.status === "active" && j.status !== "running" && j.status !== "paused" ? ` · starts when you press Start${j.schedule?.next_opens ? `, first window opens ${j.schedule.next_opens}` : ""}` : p.status === "active" ? ` · step ${p.step} of ${j.steps.length}${p.waiting ? " · waiting on a task or call" : p.next_at ? (new Date(p.next_at) < new Date() ? " · next goes in the next sending window" : ` · next ${when(p.next_at)}`) : ""}` : p.finish_reason ? ` · ${FINISH_WORDS[p.finish_reason] || p.finish_reason}` : ""}</div>
            </div>
            <button type="button" aria-label={`Remove ${p.email || p.name}`} style={{ ...btn(false), padding: "0 9px" }} onClick={() => run(() => api.journeyRemovePerson(j.id, p.id), `Removed ${p.name || p.email || "them"} from this journey.`)}><X size={14} /></button>
          </div>
        ))}
        {people.length > 5 ? <button type="button" style={{ ...btn(false), justifySelf: "start" }} onClick={() => setShowAll((s) => !s)}>{showAll ? "Show fewer" : `Show all ${people.length}`}</button> : null}
        {!people.length && !adding ? <div style={small}>Nobody yet. Add a list, then start the journey.</div> : null}
      </div>

      <Drawer open={rules} onClose={() => setRules(false)} title="Rules" sub={j.name} avatar={<span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 10, background: C.paperSoft || "#F4F6FA", display: "grid", placeItems: "center", color: C.slate }}><SlidersHorizontal size={18} /></span>}>
        <RulesPanel key={j.id + String(rules)} j={j} mailboxes={outreach.mailboxes} saving={busy} onSave={(body) => run(async () => { await api.journeySettings(j.id, body); setRules(false); }, "Saved.")} />
      </Drawer>
      <Drawer open={looks} onClose={() => setLooks(false)} title="Look of the emails" sub={j.name}>
        <div style={{ display: "grid", gap: 14 }}>
          <DesignBox design={emailDesign.design} designed={Boolean(emailDesign.design?.campaigns?.[j.id])}
            setDesigned={(on) => run(() => api.setEmailCampaignDesign(j.id, on).then(emailDesign.setDesign), on ? "Emails will go out with your brand design." : "Emails will go out as plain messages.")}
            onSetup={() => setBrandOpen(true)} />
          {(() => {
            const first = steps.find((x) => x.channel === "email" || x.channel === "manual_email");
            if (!first || !emailDesign.design) return null;
            return <><div style={small}>{emailDesign.design?.campaigns?.[j.id] ? "This is how the emails arrive." : "This is how they would look. The design is off, so emails go out as plain messages."}</div><DesignPreview subject={first.subject} body={first.body} brand={emailDesign.design.brand} mailboxId={(j.mailbox_ids || [])[0] || ""} height={420} /></>;
          })()}
          <div style={small}>Only emails are designed. Calls and tasks are not changed. Buttons: write a line like [Book a call](https://your-link) on its own.</div>
        </div>
      </Drawer>
      {brandOpen ? <BrandDialog design={emailDesign.design} mailboxes={outreach.mailboxes} subject={(steps.find((x) => x.channel === "email") || {}).subject || ""}
        body={(steps.find((x) => x.channel === "email") || {}).body || ""} onClose={() => setBrandOpen(false)} onSaved={(r) => emailDesign.setDesign(r)} /> : null}
      <Drawer open={details} onClose={() => setDetails(false)} title="Results and advice" sub={j.name}>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            {[["People", j.results.people], ["Sent", j.results.sent], ["Opened", j.results.opened], ["Replied", j.results.replied, `${j.results.reply_rate}%`], ["Bounced", j.results.bounced, `${j.results.bounce_rate}%`], ["Waiting on you", j.results.waiting_on_a_task]].map(([k, v, x]) => (
              <div key={k}><div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{v}{x ? <span style={{ fontSize: 12, color: C.slate }}> {x}</span> : null}</div><div style={small}>{k}</div></div>
            ))}
          </div>
          <StepTable results={j.results} />
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
  const [tpage, setTpage] = useState(0);
  useEffect(() => { api.journeyTemplates().then((r) => setTemplates(r.templates || [])).catch(() => {}); }, []);

  const finish = async (made) => {
    let note = "Journey made as a draft. Nothing is sent until you start it.";
    if (listId) {
      try { await api.journeyPeople(made.id, { list_id: listId, how_many: 200 }); } catch (e) { note = `Journey made, but the people weren't added: ${e.message || "try Add people on its page."}`; }
    }
    notice(note);
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
        {templates.slice(tpage * 4, tpage * 4 + 4).map((t) => (
          <div key={t.key} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: `1px solid ${C.borderLight}` }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t.name} <span style={small}>· {t.steps} steps</span></div>
              <div style={small}>{t.best_for}</div>
            </div>
            <button type="button" style={btn(false, Boolean(busy))} disabled={Boolean(busy)} onClick={go(t.key, () => api.journeyFromTemplate(t.key))}>{busy === t.key ? <Spinner size={13} /> : "Use"}</button>
          </div>
        ))}
        {templates.length > 4 ? (
          <div role="navigation" aria-label="More ready-made journeys" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, paddingTop: 8, borderTop: `1px solid ${C.borderLight}`, ...small }}>
            <button type="button" style={{ ...btn(false), padding: "0 9px" }} aria-label="Previous ready-made journeys" title="Previous" disabled={tpage === 0} onClick={() => setTpage(tpage - 1)}><ChevronLeft size={14} /></button>
            <span>{tpage * 4 + 1}–{Math.min(templates.length, tpage * 4 + 4)} of {templates.length}</span>
            <button type="button" style={{ ...btn(false), padding: "0 9px" }} aria-label="Next ready-made journeys" title="Next" disabled={(tpage + 1) * 4 >= templates.length} onClick={() => setTpage(tpage + 1)}><ChevronRight size={14} /></button>
          </div>
        ) : null}
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

const FILTERS = [["running", "Running"], ["draft", "Drafts"], ["completed", "Finished"], ["archived", "Archived"]];
const inFilter = (j, k) => (k === "archived" ? Boolean(j.archived)
  : !j.archived && (k === "running" ? j.status === "running" || j.status === "paused" : j.status === k));

// ── The page ────────────────────────────────────────────────────────────────
export function JourneysView({ outreach, listsStore, onGo, onAskAssistant, onGuided, onConsumed, initialId = "", initialListId = "" }) {
  const [prefill, setPrefill] = useState(initialListId); // a list chosen on another page: used once, here
  const [journeys, setJourneys] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(initialId);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("running"); // running (with paused) | draft | completed | archived
  const lists = (listsStore && listsStore.lists) || [];
  const narrow = useNarrow();

  const load = useCallback(async () => {
    try { const r = await api.journeys(); setJourneys(r.journeys || []); setError(""); } catch (e) { setError(e.message || "Couldn't load your journeys."); setJourneys((j) => j || []); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (initialId) { setSelected(initialId); setCreating(false); } }, [initialId]);
  useEffect(() => { if (initialListId) { setPrefill(initialListId); setCreating(true); onConsumed?.(); } }, [initialListId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Opening the tab lands on the newest running journey (else the newest one still being set up, else any); the new-journey form
  // shows only when someone presses New journey, or when there is nothing yet.
  const landed = useRef(false);
  useEffect(() => {
    if (!journeys || landed.current) return;
    landed.current = true;
    if (selected || creating) return;
    const live = (s) => journeys.find((j) => j.status === s && !j.archived);
    const pick = live("running") || live("paused") || live("draft") || journeys.find((j) => !j.archived);
    if (pick) { setSelected(pick.id); setFilter(pick.status === "completed" ? "completed" : pick.status === "draft" ? "draft" : "running"); } else setCreating(true);
  }, [journeys, selected, creating]);

  if (journeys === null) return <Loader compact label="Loading your journeys" />;
  const open = (id) => { setCreating(false); setSelected(id); const j = journeys.find((x) => x.id === id); if (j) setFilter(FILTERS.map(([k]) => k).find((k) => inFilter(j, k)) || "running"); load(); };
  const shownJourneys = journeys.filter((j) => inFilter(j, filter));
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
        {journeys.length ? (
          <div style={{ display: "grid", gap: 2, padding: "2px 4px 0" }}>
            <strong style={{ fontSize: 13 }}>Your journeys · {journeys.length}</strong>
            <span style={small}>{[["running", "running"], ["paused", "paused"], ["draft", "in draft"], ["completed", "finished"]].map(([k, w]) => [journeys.filter((j) => j.status === k).length, w]).filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(" · ")}</span>
          </div>
        ) : null}
        {journeys.length ? (
          <div role="tablist" aria-label="Show journeys" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {FILTERS.map(([k, w]) => {
              const n = journeys.filter((j) => inFilter(j, k)).length;
              if (k === "archived" && !n) return null;
              return <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                style={{ ...btn(filter === k), padding: "3px 10px", minHeight: 30, fontSize: 12.5 }}>{w} {n}</button>;
            })}
          </div>
        ) : null}
        <Wheel label="Your journeys: scroll for more">
        {shownJourneys.map((j) => {
          const on = !creating && j.id === selected;
          return (
            <button key={j.id} type="button" aria-current={on ? "true" : undefined} onClick={() => open(j.id)}
              style={{ all: "unset", boxSizing: "border-box", cursor: "pointer", display: "grid", gap: 3, padding: "10px 12px", borderRadius: 12, scrollSnapAlign: "start", border: `1px solid ${on ? C.cobalt : C.borderLight}`, background: on ? C.cobaltSoft : "#fff" }}>
              <span style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "space-between" }}>
                <strong title={j.name} style={{ fontSize: 13.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.name}</strong>
                <Pill tone={STATUS_TONES[j.status]}>{STATUS_WORDS[j.status] || j.status}</Pill>
              </span>
              <span style={small}>{headline(j.results, j.tasks_open, j.status)}</span>
            </button>
          );
        })}
        {empty ? <div style={small}>No journeys yet.</div> : !shownJourneys.length ? <div style={small}>Nothing {filter === "running" ? "running" : filter === "draft" ? "in draft" : filter === "archived" ? "archived" : "finished"} right now.</div> : null}
        </Wheel>
      </aside>
      )}
      <main className="jw-quiet" style={{ flex: "1 1 0", minWidth: 0, minHeight: 0, overflowY: narrow ? "visible" : "auto", paddingBottom: 12 }}>
        {creating || empty ? (
          <NewJourney lists={lists} initialListId={prefill} onGuided={onGuided} onCancel={() => { setCreating(false); if (!selected && journeys.length) setSelected(journeys[0].id); }} onCreated={(id) => { open(id); }} />
        ) : selected ? (
          <JourneyPage key={selected} id={selected} outreach={outreach} lists={lists} onGo={onGo} onAskAssistant={onAskAssistant}
            onChanged={(newId) => { load(); if (typeof newId === "string") open(newId); }} onGone={() => { setSelected(""); load(); }} />
        ) : null}
      </main>
    </div>
  );
}
