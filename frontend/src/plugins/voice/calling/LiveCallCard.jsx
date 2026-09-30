import React, { useEffect, useRef, useState } from "react";
import { Calendar, CheckCircle2, ChevronDown, ChevronUp, Headphones, PhoneOff, Sparkles } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY } from "../../../tokens";

const STATE_META = {
  calling: { label: "Ringing", fg: C.amber, bg: C.amberSoft, pulse: true },
  ringing: { label: "Ringing", fg: C.amber, bg: C.amberSoft, pulse: true },
  pitching: { label: "Live", fg: C.green, bg: C.greenSoft, pulse: true },
  negotiating: { label: "Live", fg: C.green, bg: C.greenSoft, pulse: true },
  human_review: { label: "Needs you", fg: C.red, bg: C.redSoft, pulse: true },
  ended: { label: "Ended", fg: C.slate, bg: C.paperSoft },
  failed: { label: "Not reached", fg: C.red, bg: C.redSoft },
  canceled: { label: "Canceled", fg: C.slate, bg: C.paperSoft },
};

/** Normalises transcript entries (strings "AI: …" / "Prospect: …" / "System: …" or {who,text}). */
export function parseTranscriptLine(line) {
  if (line && typeof line === "object") {
    const who = String(line.who || line.role || "").toLowerCase();
    const text = String(line.text || line.content || "");
    if (who === "system") return { who: "system", text };
    if (who === "ai" || who === "assistant" || who === "agent") return { who: "ai", text };
    return { who: "them", text };
  }
  const s = String(line || "").trim();
  const m = s.match(/^(AI|Agent|Assistant|Prospect|Them|Caller|User|System|Human)\s*:\s*/i);
  if (!m) return { who: "system", text: s };
  const tag = m[1].toLowerCase();
  const text = s.slice(m[0].length);
  if (tag === "system") return { who: "system", text };
  if (tag === "ai" || tag === "agent" || tag === "assistant") return { who: "ai", text };
  if (tag === "human") return { who: "human", text };
  return { who: "them", text };
}

function StatePill({ state }) {
  const meta = STATE_META[String(state || "").toLowerCase()] || { label: state || "Live", fg: C.slate, bg: C.paperSoft };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 999, background: meta.bg, color: meta.fg, fontSize: 11, fontWeight: 800, letterSpacing: "0.02em", whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: meta.fg, animation: meta.pulse ? "aivhubPulse 1.4s ease-in-out infinite" : "none" }} />
      {meta.label}
    </span>
  );
}

function Transcript({ lines, live, tall }) {
  const boxRef = useRef(null);
  const stickRef = useRef(true);
  const parsed = (lines || []).map(parseTranscriptLine).filter((l) => l.text);

  useEffect(() => {
    const el = boxRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [parsed.length]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div
      ref={boxRef}
      onScroll={onScroll}
      style={{ background: C.paper, borderRadius: 12, padding: "10px 12px", marginTop: 12, maxHeight: tall ? 420 : 210, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, transition: "max-height 0.2s ease" }}
    >
      {parsed.length ? parsed.map((l, i) => {
        if (l.who === "system") {
          return (
            <div key={i} style={{ alignSelf: "center", fontSize: 11, color: C.slate, textAlign: "center", maxWidth: "92%", lineHeight: 1.4 }}>
              {l.text}
            </div>
          );
        }
        const mine = l.who === "ai" || l.who === "human";
        return (
          <div key={i} style={{ alignSelf: mine ? "flex-start" : "flex-end", maxWidth: "82%" }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: mine ? C.cobaltDeep : C.teal, marginBottom: 2, textAlign: mine ? "left" : "right", letterSpacing: "0.04em", textTransform: "uppercase" }}>
              {l.who === "ai" ? "AI" : l.who === "human" ? "You" : "Them"}
            </div>
            <div style={{ background: mine ? "#fff" : C.tealSoft, border: `1px solid ${mine ? C.border : "#BFE6DF"}`, borderRadius: 10, padding: "7px 10px", fontSize: 13, lineHeight: 1.45, color: C.textInk }}>
              {l.text}
            </div>
          </div>
        );
      }) : (
        <div style={{ color: C.slateLight, fontSize: 12.5, textAlign: "center", padding: "8px 0" }}>
          {live ? "Waiting for the first words…" : "No transcript captured."}
        </div>
      )}
    </div>
  );
}

const btn = (extra = {}) => ({
  height: 38,
  padding: "0 12px",
  borderRadius: 9,
  border: `1px solid ${C.border}`,
  background: "#fff",
  color: C.textInk,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontWeight: 700,
  fontFamily: FONT_BODY,
  fontSize: 13,
  ...extra,
});

export function LiveCallCard({
  call,
  listening,
  taken,
  confirmingEnd,
  onListen,
  onTakeover,
  onBook,
  onAskEnd,
  onCancelEnd,
  onConfirmEnd,
}) {
  const [tall, setTall] = useState(false);
  const [busy, setBusy] = useState("");
  const id = call.id || call.call_sid;
  const name = call.prospect || call.prospect_name || call.contact || call.name || "Unknown";
  const state = String(call.state || call.status || "calling").toLowerCase();
  const isAssistant = call.carrier === "telnyx_assistant";
  const canListen = call.supportsListen !== false && !String(id || "").startsWith("pending_") && !String(id || "").startsWith("batch_pending_");
  const pending = String(id || "").includes("pending_");
  const lines = call.transcript || [];

  const run = async (key, fn) => {
    if (busy) return;
    setBusy(key);
    try { await fn(); } finally { setBusy(""); }
  };

  return (
    <div style={{ background: "#fff", border: `1.5px solid ${taken ? C.red : listening ? C.cobalt : C.border}`, borderRadius: 16, padding: 18, boxShadow: "0 8px 28px rgba(18,20,28,0.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
            <StatePill state={state} />
            {call.booked ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 800, color: C.green }}>
                <CheckCircle2 size={13} /> Booked
              </span>
            ) : null}
          </div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 5, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: C.textInk }}>{call.duration || "00:00"}</span>
            {call.mission ? <span>· {call.mission}</span> : null}
            {isAssistant ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.cobaltDeep, fontWeight: 700 }}>
                · <Sparkles size={12} /> Telnyx AI Assistant
              </span>
            ) : null}
          </div>
        </div>
        {taken ? <span style={{ color: C.red, fontWeight: 800, fontSize: 11, whiteSpace: "nowrap" }}>YOU'RE ON THE LINE</span> : null}
      </div>

      <Transcript lines={lines} live tall={tall} />
      {lines.length > 6 ? (
        <button type="button" onClick={() => setTall((t) => !t)} style={{ marginTop: 6, background: "none", border: "none", color: C.slate, fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, padding: 0 }}>
          {tall ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {tall ? "Shrink" : "Expand transcript"}
        </button>
      ) : null}

      {confirmingEnd ? (
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", background: C.redSoft, padding: 10, borderRadius: 10 }}>
          <span style={{ flex: 1, fontSize: 13, color: C.red, fontWeight: 600 }}>Hang up on {name}?</span>
          <button type="button" onClick={onCancelEnd} style={btn({ height: 32 })}>Keep call</button>
          <button type="button" disabled={busy === "end"} onClick={() => run("end", onConfirmEnd)} style={btn({ height: 32, border: "none", background: C.red, color: "#fff" })}>
            {busy === "end" ? "Ending…" : "Hang up"}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {canListen ? (
            <>
              <button type="button" onClick={() => run("listen", onListen)} style={btn({ borderColor: listening ? C.cobalt : C.border, background: listening ? C.cobaltSoft : "#fff", color: listening ? C.cobalt : C.textInk })}>
                <Headphones size={14} /> {listening ? "Stop listening" : "Listen"}
              </button>
              <button type="button" onClick={() => run("takeover", onTakeover)} style={btn({ background: taken ? C.redSoft : "#fff" })}>
                {taken ? "Hand back to AI" : "Take over"}
              </button>
            </>
          ) : isAssistant ? (
            <span style={{ fontSize: 11.5, color: C.slate, alignSelf: "center", maxWidth: 320 }}>
              Audio runs inside Telnyx — live listen/take-over isn't available for Assistant calls. The transcript updates as they talk.
            </span>
          ) : null}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            disabled={pending || busy === "book" || call.booked}
            onClick={() => run("book", onBook)}
            title="Books from what was said on this call (time + email in the transcript) onto the real calendar"
            style={btn({ border: "none", background: call.booked ? C.greenSoft : C.green, color: call.booked ? C.green : "#fff", opacity: pending ? 0.5 : 1, cursor: pending || call.booked ? "default" : "pointer" })}
          >
            <Calendar size={14} /> {call.booked ? "Booked" : busy === "book" ? "Booking…" : "Book from call"}
          </button>
          <button type="button" disabled={pending} onClick={onAskEnd} style={btn({ border: "none", background: C.redSoft, color: C.red, opacity: pending ? 0.5 : 1 })}>
            <PhoneOff size={14} /> End
          </button>
        </div>
      )}
    </div>
  );
}

export function RecentlyEndedList({ calls, onOpenHistory }) {
  const [openId, setOpenId] = useState("");
  if (!calls.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "6px 2px 8px" }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: C.slate, textTransform: "uppercase", letterSpacing: "0.05em" }}>Just ended</div>
        <button type="button" onClick={onOpenHistory} style={{ background: "none", border: "none", color: C.cobalt, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          Open call history →
        </button>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
        {calls.map((c, i) => {
          const open = openId === c.id;
          return (
            <div key={c.id} style={{ borderTop: i ? `1px solid ${C.borderLight}` : "none" }}>
              <button type="button" onClick={() => setOpenId(open ? "" : c.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: FONT_BODY }}>
                <span style={{ fontWeight: 700, fontSize: 13.5, color: C.textInk, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.prospect || "Unknown"}</span>
                <StatePill state={c.state || "ended"} />
                {c.booked ? <CheckCircle2 size={14} color={C.green} /> : null}
                <span style={{ fontSize: 12, color: C.slate, fontVariantNumeric: "tabular-nums" }}>{c.duration}</span>
                {open ? <ChevronUp size={14} color={C.slate} /> : <ChevronDown size={14} color={C.slate} />}
              </button>
              {open ? <div style={{ padding: "0 14px 12px" }}><Transcript lines={c.transcript || []} live={false} /></div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const LIVE_CARD_KEYFRAMES = "@keyframes aivhubPulse{0%,100%{opacity:1}50%{opacity:.35}}";
