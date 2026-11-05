import React, { useState } from "react";
import { Building2, CalendarDays, Check, ChevronRight, Copy, PhoneCall, SlidersHorizontal, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { Spinner } from "../../app/Loader";
import { C, FONT_BODY } from "../../tokens";
import { FEEDBACK_REASONS, filtersText, viewCountText } from "./assistantUi";

// The cards an assistant answer can end with. The chat never lists rows: a search ends with a small draft card, and one click opens the
// real screen (the full table) with the same filters. Styles are in cardsCss, added to the panel's own.

const text = { fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink };
const muted = { fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate };

export const cardsCss = `
.as-view{all:unset;box-sizing:border-box;width:100%;display:flex;gap:11px;align-items:flex-start;margin-top:10px;padding:12px 12px 12px 14px;border:1px solid var(--ui-line,#E3E6EF);border-radius:12px;background:var(--ui-sunken,#F6F7FA);cursor:pointer;white-space:normal;animation:mo-rise .34s .08s var(--mo-ease,ease) both;transition:border-color .15s,box-shadow .15s,transform .15s var(--mo-ease,ease)}
.as-view:hover,.as-view:focus-visible{border-color:var(--ui-accent,#3457D5);box-shadow:0 4px 14px rgba(20,24,40,.08);transform:translateY(-1px)}
.as-view:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:2px}
.as-view:active{transform:none}
.as-view-ic{flex:none;width:30px;height:30px;border-radius:8px;background:#fff;border:1px solid var(--ui-line,#E3E6EF);display:inline-flex;align-items:center;justify-content:center;color:var(--ui-accent,#3457D5)}
.as-view-body{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.as-view-title{font:600 13.5px Inter,sans-serif;color:var(--ui-ink,#111827)}
.as-view-sum{font:12.5px/1.4 Inter,sans-serif;color:var(--ui-muted,#6B7280);overflow-wrap:anywhere}
.as-view-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:3px}
.as-view-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:1px solid var(--ui-line,#E3E6EF);border-radius:6px;background:#fff;font:12px Inter,sans-serif;color:var(--ui-ink,#111827)}
.as-view-go{flex:none;color:var(--ui-muted,#6B7280);margin-top:7px}
.as-tag--draft{background:#EEF2FE;color:#2F4BB8}
.as-choice{padding:12px 12px 6px}
.as-choice-h{font:12.5px Inter,sans-serif;color:var(--ui-muted,#6B7280);margin-bottom:6px}
.as-choice-o{all:unset;box-sizing:border-box;width:100%;display:flex;gap:10px;align-items:flex-start;padding:9px 6px;border-radius:8px;cursor:pointer}
.as-choice-o:hover,.as-choice-o:focus-visible{background:var(--ui-hover,#F1F3F8)}
.as-choice-o:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:-2px}
.as-choice-o[disabled]{opacity:.5;cursor:default}
.as-choice-dot{flex:none;width:16px;height:16px;margin-top:2px;border:1.5px solid var(--ui-line-strong,#C5CAD6);border-radius:50%;background:#fff}
.as-choice-o:hover .as-choice-dot{border-color:var(--ui-accent,#3457D5)}
.as-choice-t{display:flex;flex-direction:column;gap:2px;min-width:0}
.as-choice-l{font:600 13.5px Inter,sans-serif;color:var(--ui-ink,#111827);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.as-choice-n{font:12.5px/1.4 Inter,sans-serif;color:var(--ui-muted,#6B7280)}
.as-rec{font:600 11px Inter,sans-serif;padding:1px 8px;border-radius:999px;background:#DDEFE3;color:#1F6B3A}
.as-fb{display:flex;gap:2px;align-items:center;margin-top:8px;white-space:normal}
.as-fb button{all:unset;cursor:pointer;width:28px;height:28px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;color:var(--ui-muted,#6B7280);transition:background-color .12s,color .12s}
.as-fb button:hover,.as-fb button:focus-visible{background:var(--ui-hover,#F1F3F8);color:var(--ui-ink,#111827)}
.as-fb button:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:1px}
.as-fb button[aria-pressed="true"]{color:var(--ui-accent,#3457D5);background:var(--ui-accent-soft,#EEF2FE)}
.as-fb-note{font:12px Inter,sans-serif;color:var(--ui-muted,#6B7280);margin-left:6px}
.as-why{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.as-why button{all:unset;cursor:pointer;box-sizing:border-box;padding:4px 10px;border:1px solid var(--ui-line,#E3E6EF);border-radius:999px;font:12.5px Inter,sans-serif;color:var(--ui-ink,#111827);background:#fff}
.as-why button[aria-pressed="true"]{border-color:var(--ui-accent,#3457D5);background:var(--ui-accent-soft,#EEF2FE)}
.as-why button:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:1px}
.as-nudge{display:flex;align-items:stretch;gap:2px;margin:0 0 8px;border:1px solid var(--ui-line,#E3E6EF);border-radius:12px;background:var(--ui-sunken,#F6F7FA);overflow:hidden}
.as-nudge-main{all:unset;box-sizing:border-box;flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;padding:9px 12px;cursor:pointer}
.as-nudge-main:hover,.as-nudge-main:focus-visible{background:var(--ui-hover,#EEF0F5)}
.as-nudge-main:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:-2px}
.as-nudge .as-icon{align-self:center;margin-right:4px}
@media (prefers-reduced-motion:reduce){.as-view{animation:none;transition:none}.as-view:hover,.as-view:focus-visible{transform:none}}
`;

// The draft card: what the answer found, in a line, and a click that opens the full list on the left.
export function ViewCard({ view, onOpen }) {
  const Icon = view.kind === "calls" ? PhoneCall : view.kind === "posts" ? CalendarDays : Building2;
  const count = viewCountText(view);
  const filters = filtersText(view.filter_count);
  return (
    <button type="button" className="as-view" onClick={onOpen} aria-label={`Open ${view.title}, ${count}${filters ? `, ${filters}` : ""}`}>
      <span className="as-view-ic" aria-hidden="true"><Icon size={16} /></span>
      <span className="as-view-body">
        <span className="as-view-title">{view.title} <span className="as-tag as-tag--draft">Draft</span></span>
        {view.summary ? <span className="as-view-sum">{view.summary}</span> : null}
        <span className="as-view-meta">
          {filters ? <span className="as-view-chip"><SlidersHorizontal size={12} aria-hidden="true" /> {filters}</span> : null}
          <span className="as-view-chip">{count}</span>
        </span>
      </span>
      <ChevronRight className="as-view-go" size={16} aria-hidden="true" />
    </button>
  );
}

// "Select one of the following": the next steps worth taking, the recommended one first. Code decides which are offered.
export function ChoiceCard({ choices, disabled, onPick }) {
  return (
    <div className="as-card as-choice" role="group" aria-label="Select one of the following">
      <div className="as-choice-h">Select one of the following</div>
      {choices.map((c) => (
        <button key={c.id} type="button" className="as-choice-o" disabled={disabled} onClick={() => onPick(c)}>
          <span className="as-choice-dot" aria-hidden="true" />
          <span className="as-choice-t">
            <span className="as-choice-l">{c.label}{c.recommended ? <span className="as-rec">Recommended</span> : null}</span>
            {c.note ? <span className="as-choice-n">{c.note}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

// "Customize your AI": above the message box while the business profile is thin. One click opens the person's own profile.
export function CustomizeBanner({ line, onOpen, onDismiss }) {
  return (
    <div className="as-nudge">
      <button type="button" className="as-nudge-main" onClick={onOpen}>
        <strong style={{ ...text, fontSize: 13, fontWeight: 600 }}>Customize your AI</strong>
        <span style={muted}>{line}</span>
      </button>
      <button type="button" className="as-icon" title="Not now" aria-label="Dismiss for now" onClick={onDismiss}><X size={15} /></button>
    </div>
  );
}

// Copy, thumbs up, thumbs down. A thumbs down asks why, keeps the answer for staff, and offers one sentence to remember. Nothing is
// remembered until the person presses "Remember".
export function FeedbackBar({ message, question, plugin, chatId, context, onRemember }) {
  const [rating, setRating] = useState("");
  const [picking, setPicking] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(null); // { id, lesson } from the server
  const [lesson, setLesson] = useState(""); // "", "kept" or "no"
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try { await navigator.clipboard.writeText(message.text || ""); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* the browser refused: nothing to show */ }
  };
  const send = async (value, why = "", words = "") => {
    setBusy(true); setError("");
    try {
      const r = await api.assistantFeedback({ plugin, rating: value, reason: why, note: words, question, answer: message.text || "", chat_id: chatId, message_id: message.id, context });
      setSaved(r); setRating(value); setPicking(false);
    } catch (err) { setError(err?.message || "Couldn't save that. Try again."); }
    setBusy(false);
  };
  const keep = async () => {
    if (!saved?.lesson) return;
    setBusy(true);
    try { await onRemember?.(saved.lesson); await api.assistantFeedbackLesson(saved.id).catch(() => {}); setLesson("kept"); } catch { setError("Couldn't save it to Memory."); }
    setBusy(false);
  };

  return (
    <div>
      <div className="as-fb" role="group" aria-label="Rate this answer">
        <button type="button" title="Copy" aria-label="Copy the answer" onClick={copy}>{copied ? <Check size={14} color={C.green} /> : <Copy size={14} />}</button>
        <button type="button" title="Good answer" aria-label="Good answer" aria-pressed={rating === "up"} disabled={busy || Boolean(rating)} onClick={() => send("up")}><ThumbsUp size={14} /></button>
        <button type="button" title="Not right" aria-label="Not right" aria-pressed={rating === "down" || picking} disabled={busy || Boolean(rating)} onClick={() => setPicking((v) => !v)}><ThumbsDown size={14} /></button>
        {rating === "up" ? <span className="as-fb-note" role="status">Thanks.</span> : null}
        {rating === "down" && !saved?.lesson ? <span className="as-fb-note" role="status">Thanks. We will use this to improve it.</span> : null}
        {busy ? <Spinner size={13} /> : null}
      </div>
      {picking ? (
        <div className="as-card">
          <div style={{ ...text, fontWeight: 600 }}>What was wrong?</div>
          <div className="as-why" role="group" aria-label="What was wrong">
            {FEEDBACK_REASONS.map((r) => <button key={r.id} type="button" aria-pressed={reason === r.id} onClick={() => setReason(r.id)}>{r.label}</button>)}
          </div>
          <textarea className="ui-input" rows={2} aria-label="What should be better? (optional)" placeholder="What should be better? (optional)" value={note} maxLength={300}
            onChange={(e) => setNote(e.target.value)} style={{ width: "100%", height: "auto", padding: 8, resize: "vertical", boxSizing: "border-box" }} />
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy || !reason} onClick={() => send("down", reason, note)}>Send</button>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setPicking(false)}>Cancel</button>
          </div>
        </div>
      ) : null}
      {rating === "down" && saved?.lesson && !lesson ? (
        <div className="as-card">
          <div style={{ ...muted, marginBottom: 4 }}>Want me to remember this for next time?</div>
          <div style={{ ...text, overflowWrap: "anywhere" }}>“{saved.lesson}”</div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy} onClick={keep}>Remember</button>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setLesson("no")}>No thanks</button>
          </div>
        </div>
      ) : null}
      {lesson === "kept" ? <div className="as-fb-note" role="status" style={{ marginTop: 4 }}>Saved to Memory. I will follow it from now on.</div> : null}
      {error ? <div role="alert" style={{ ...muted, color: C.red, marginTop: 4 }}>{error}</div> : null}
    </div>
  );
}
