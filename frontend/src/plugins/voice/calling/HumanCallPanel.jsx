import React, { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Mic, MicOff, PhoneCall, PhoneOff, RotateCcw, X } from "lucide-react";
import { api } from "../../../api/apiClient";
import { C, FONT_BODY } from "../../../tokens";
import { OUTCOMES, clock, cleanNumber, costLine, minutesLeft, rateLine, speakerWord, stageOf, transcriptWords, validNumber } from "./humanCallLogic";

// The browser phone: a person calls a lead themselves and talks to them directly, with no AI on the line.
// Stages: dial -> starting -> ringing -> connected -> after (outcome and note) -> saved (cost, transcript).
// The server checks everything before the call (opt-outs, credit, hours, caller ID) and holds the credit; the browser only dials.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.45 };
const POLL_MS = 4000;
const CHUNK_MS = 20000;

function pickMime() {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

/** Records both voices into one two-channel file (you on the left, them on the right) and sends it in pieces while the call runs. */
function startRecording(call, ref) {
  const local = call.localStream, remote = call.remoteStream;
  if (!local || !remote || typeof MediaRecorder === "undefined") return null;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const merger = ctx.createChannelMerger(2);
  const dest = ctx.createMediaStreamDestination();
  dest.channelCount = 2;
  merger.connect(dest);
  ctx.createMediaStreamSource(local).connect(merger, 0, 0);
  ctx.createMediaStreamSource(remote).connect(merger, 0, 1);
  const mime = pickMime();
  const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined);
  const sends = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) sends.push(api.uploadHumanCallAudio(ref, e.data).catch(() => null)); };
  rec.start(CHUNK_MS);
  return {
    stop: () => new Promise((resolve) => {
      rec.onstop = async () => { await Promise.race([Promise.all(sends), new Promise((r) => setTimeout(r, 10000))]); try { ctx.close(); } catch { /* closed */ } resolve(); };
      try { rec.stop(); } catch { resolve(); }
    }),
  };
}

function Transcript({ callRef, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(""); // what the copy button says for a moment after a press
  const load = useCallback(() => api.humanCallTranscript(callRef).then((r) => { setData(r); setError(""); }).catch((e) => setError(e.message || "Couldn't load this call.")), [callRef]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data || !["waiting", "working"].includes(data.transcript)) return undefined;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [data, load]);
  if (error) return <div role="alert" style={{ ...muted, color: C.red }}>{error}</div>;
  if (!data) return <div style={muted}>Loading…</div>;
  const copy = () => {
    const said = (ok) => { setCopied(ok ? "Copied" : "Couldn't copy"); setTimeout(() => setCopied(""), 1600); };
    const text = (data.lines || []).map((l) => `${speakerWord(l.who)}: ${l.text}`).join("\n");
    if (!navigator.clipboard) { said(false); return; }
    navigator.clipboard.writeText(text).then(() => said(true), () => said(false));
  };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ ...text, fontSize: 15 }}>{data.name} · {data.minutes} min</strong>
        <span style={{ ...muted, fontWeight: 600, color: data.transcript === "ready" ? C.green : data.transcript === "failed" ? C.red : C.slate }}>{transcriptWords(data.transcript, data.transcript_error)}</span>
      </div>
      {data.summary ? <div style={{ ...text, fontSize: 13.5, background: C.greenSoft, borderRadius: 8, padding: "8px 10px", lineHeight: 1.5 }}><b>Summary.</b> {data.summary}</div> : null}
      {data.has_audio ? <audio controls preload="none" src={api.humanCallAudioUrl(callRef)} style={{ width: "100%" }} /> : null}
      <div style={{ display: "grid", gap: 6, maxHeight: 280, overflowY: "auto" }}>
        {(data.lines || []).map((l, i) => (
          <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px" }}>
            <div style={muted}>{clock(l.at)} · {speakerWord(l.who)}</div>
            <div style={{ ...text, fontSize: 13.5, lineHeight: 1.5 }}>{l.text}</div>
          </div>
        ))}
        {!data.lines?.length && data.transcript === "ready" ? <div style={muted}>No speech was found in this call.</div> : null}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ ...muted, flex: 1, minWidth: 180 }}>Automatic transcript, so it may contain mistakes. Audio is kept for a limited time.</span>
        {data.transcript === "failed" ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => api.retryHumanCallTranscript(callRef).then(load).catch((e) => setError(e.message))}><RotateCcw size={13} /> Try again</button> : null}
        {(data.lines || []).length ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={copy}><Copy size={13} /> <span aria-live="polite">{copied || "Copy text"}</span></button> : null}
        {onBack ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onBack}>Back</button> : null}
      </div>
    </div>
  );
}

export default function HumanCallPanel({ request, onClose }) {
  const [phase, setPhase] = useState(request.transcript ? "transcript" : "dial");
  const [number, setNumber] = useState(request.number || "");
  const [config, setConfig] = useState(null);
  const [from, setFrom] = useState("");
  const [record, setRecord] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [session, setSession] = useState(null); // { call_ref, max_seconds }
  const [elapsed, setElapsed] = useState(0);
  const [muted_, setMuted] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const client = useRef(null);
  const call = useRef(null);
  const recorder = useRef(null);
  const refRef = useRef("");
  const ended = useRef(false);
  const tick = useRef(null);
  const audioId = "human-call-remote";
  const recorderWanted = useRef(false);

  useEffect(() => {
    let live = true;
    api.humanCallConfig().then((c) => {
      if (!live) return;
      setConfig(c);
      setFrom((c.numbers.find((n) => n.default) || c.numbers[0] || {}).e164 || "");
      setRecord(Boolean(c.record_default));
    }).catch((e) => live && setError(e.message || "Couldn't load the phone."));
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const leave = () => { if (refRef.current && !ended.current) api.endHumanCallOnExit(refRef.current); };
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, []);

  const stopClock = () => { if (tick.current) { clearInterval(tick.current); tick.current = null; } };
  useEffect(() => stopClock, []);

  const finish = useCallback(async () => {
    if (ended.current) return;
    ended.current = true;
    stopClock();
    try { if (recorder.current) await recorder.current.stop(); } catch { /* nothing to send */ }
    recorder.current = null;
    try { client.current?.disconnect(); } catch { /* already closed */ }
    client.current = null;
    setPhase("after");
    try { setResult(await api.endHumanCall(refRef.current, {})); } catch (e) { setError(e.message || "The call could not be closed."); }
  }, []);

  const hangUp = useCallback(() => { try { call.current?.hangup(); } catch { /* already down */ } finish(); }, [finish]);

  useEffect(() => {
    if (phase === "connected" && session?.max_seconds && elapsed >= session.max_seconds) hangUp();
  }, [phase, elapsed, session, hangUp]);

  const onStage = useCallback((stage, theCall) => {
    if (stage === "ringing") {
      setPhase((p) => (p === "starting" ? "ringing" : p));
      api.humanCallConnected(refRef.current, { answered: false }).catch(() => {});
    } else if (stage === "connected") {
      setPhase("connected");
      api.humanCallConnected(refRef.current, { answered: true }).catch(() => {});
      if (!tick.current) tick.current = setInterval(() => setElapsed((s) => s + 1), 1000);
      if (theCall && recorderWanted.current && !recorder.current) recorder.current = startRecording(theCall, refRef.current);
    } else if (stage === "ended") {
      finish();
    }
  }, [finish]);

  const place = async () => {
    setError("");
    if (!validNumber(number)) { setError("That does not look like a phone number. Include the area or country code."); return; }
    if (!from) { setError("Pick one of your own phone numbers to call from."); return; }
    setPhase("starting");
    ended.current = false;
    try {
      const s = await api.startHumanCall({ to: cleanNumber(number), from_number: from, lead_id: request.leadId || null, record, consent_ack: consent });
      refRef.current = s.call_ref;
      recorderWanted.current = Boolean(s.record);
      setSession(s);
      setWarnings(s.warnings || []);
      setElapsed(0);
      const { TelnyxRTC } = await import("@telnyx/webrtc");
      const rtc = new TelnyxRTC({ login_token: s.token });
      rtc.remoteElement = audioId;
      client.current = rtc;
      rtc.on("telnyx.ready", () => {
        call.current = rtc.newCall({ destinationNumber: s.to, callerNumber: s.from, clientState: btoa(s.call_ref), audio: true, video: false });
      });
      rtc.on("telnyx.error", () => { if (ended.current) return; setError("The phone connection failed. Try again."); finish(); }); // after a hang-up the closing line may still report: that is not a failure
      rtc.on("telnyx.socket.close", () => { if (!ended.current) { setError("Connection lost."); finish(); } });
      rtc.on("telnyx.notification", (n) => {
        if (n.type === "userMediaError") { setError("Allow the microphone to make calls."); finish(); return; }
        if (n.type !== "callUpdate" || !n.call) return;
        call.current = n.call;
        const stage = stageOf(n.call.state);
        if (stage) onStage(stage, n.call);
      });
      rtc.connect();
    } catch (e) {
      setError(e.message || "The call could not start.");
      setPhase("dial");
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.endHumanCall(refRef.current, { outcome, note });
      setResult(r);
      setPhase("saved");
    } catch (e) { setError(e.message || "Couldn't save."); }
    setSaving(false);
  };

  const left = minutesLeft(session?.max_seconds, elapsed);
  const busy = phase === "starting" || phase === "ringing" || phase === "connected";
  const title = request.name ? `Call ${request.name}` : "Phone";
  const noNumbers = config && !config.numbers.length;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", background: "rgba(16,20,27,.45)", padding: 16 }}
      onClick={() => { if (!busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        style={{ ...text, width: "min(480px, 100%)", maxHeight: "92vh", overflowY: "auto", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, display: "grid", gap: 12, boxShadow: "0 12px 40px rgba(0,0,0,.2)" }}>
        <audio id={audioId} autoPlay />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 16 }}>{phase === "transcript" ? "Call transcript" : title}</strong>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {phase === "transcript" ? <Transcript callRef={request.transcript} /> : null}

        {phase === "dial" || phase === "starting" ? (
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ ...muted, display: "grid", gap: 3 }}>Number
              <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+44 118 900 0123" inputMode="tel" autoFocus
                style={{ ...text, fontSize: 18, fontWeight: 700, padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 8 }} />
            </label>
            {noNumbers ? <div role="note" style={{ ...muted, color: C.amber, background: C.amberSoft, borderRadius: 8, padding: "8px 10px" }}>
              {(config.unconfirmed || []).length
                ? `Your number ${config.unconfirmed[0]} could not be confirmed for browser calls yet. Check that it was ordered or added by our team on the Numbers page, or contact support.`
                : "You need a phone number of your own to call from. Get one on the Numbers page first."}</div> : (
              <label style={{ ...muted, display: "grid", gap: 3 }}>Your caller ID
                <select value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...text, fontSize: 14, padding: "7px 9px", border: `1px solid ${C.border}`, borderRadius: 8 }}>
                  {(config?.numbers || []).map((n) => <option key={n.e164} value={n.e164}>{n.e164}{n.label ? ` · ${n.label}` : ""}</option>)}
                </select>
              </label>
            )}
            <label style={{ ...text, display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5, cursor: "pointer" }}>
              <input type="checkbox" checked={record} onChange={(e) => { setRecord(e.target.checked); if (!e.target.checked) setConsent(false); }} style={{ marginTop: 3 }} />
              <span><b>Record and transcribe this call</b><br /><span style={muted}>You get a written transcript and summary. {rateLine(config?.rates, true)}.</span></span>
            </label>
            {record ? (
              <label style={{ ...text, display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer", background: C.amberSoft, borderRadius: 8, padding: "8px 10px" }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
                <span>I will tell the person this call is recorded and transcribed.<br /><span style={muted}>Say: "This call may be recorded for our records."</span></span>
              </label>
            ) : null}
            <div style={{ ...muted, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span>{config?.minutes_left != null ? `About ${config.minutes_left} minutes of credit left` : ""}</span>
              <span>{rateLine(config?.rates, record)}</span>
            </div>
            <button type="button" className="ui-btn ui-btn--primary" disabled={phase === "starting" || noNumbers || (record && !consent)} onClick={place}>
              <PhoneCall size={15} /> {phase === "starting" ? "Checking…" : "Call"}
            </button>
          </div>
        ) : null}

        {phase === "ringing" || phase === "connected" ? (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{cleanNumber(number)}</span>
              <span style={{ ...muted, fontWeight: 600, color: phase === "connected" ? C.green : C.amber }}>{phase === "connected" ? "Connected" : "Ringing…"}</span>
            </div>
            {phase === "connected" ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{clock(elapsed)}</span>
                {session?.record ? <span style={{ ...muted, fontWeight: 700, color: C.red }}>● Recording</span> : null}
              </div>
            ) : null}
            {left != null ? <div style={muted}>About {left} min of credit left in this call</div> : null}
            {warnings.map((w) => <div key={w} role="note" style={{ ...muted, color: C.amber, background: C.amberSoft, borderRadius: 8, padding: "6px 10px" }}>{w}</div>)}
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button type="button" className="ui-btn ui-btn--secondary" onClick={() => { const m = !muted_; setMuted(m); try { m ? call.current?.muteAudio() : call.current?.unmuteAudio(); } catch { /* not connected yet */ } }}>
                {muted_ ? <MicOff size={15} /> : <Mic size={15} />} {muted_ ? "Unmute" : "Mute"}
              </button>
              <button type="button" className="ui-btn" style={{ background: C.red, color: "#fff", borderColor: C.red }} onClick={hangUp}><PhoneOff size={15} /> Hang up</button>
            </div>
          </div>
        ) : null}

        {phase === "after" || phase === "saved" ? (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <strong>Call ended</strong>
              <span style={{ ...muted, fontWeight: 600 }}>{result ? costLine(result.minutes, config?.rates, result.record) : "Closing the call…"}</span>
            </div>
            {phase === "after" ? (
              <>
                <div role="radiogroup" aria-label="How did it go?" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {OUTCOMES.map((o) => (
                    <button key={o.id} type="button" role="radio" aria-checked={outcome === o.id} onClick={() => setOutcome(o.id)}
                      style={{ ...text, fontSize: 12.5, padding: "4px 10px", borderRadius: 99, cursor: "pointer", border: `1px solid ${outcome === o.id ? C.cobalt : C.border}`, background: outcome === o.id ? C.cobalt : "#fff", color: outcome === o.id ? "#fff" : C.textInk }}>{o.label}</button>
                  ))}
                </div>
                <label style={{ ...muted, display: "grid", gap: 3 }}>Note
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} style={{ ...text, fontSize: 13.5, padding: "7px 9px", border: `1px solid ${C.border}`, borderRadius: 8, resize: "none" }} />
                </label>
                <button type="button" className="ui-btn ui-btn--primary" disabled={saving || !result} onClick={save}>Save</button>
              </>
            ) : (
              <>
                <div role="status" style={{ ...text, fontSize: 13.5, background: C.greenSoft, borderRadius: 8, padding: "8px 10px" }}>
                  Saved to the call history{request.leadId ? " and the lead" : ""}.{result?.record ? ` ${transcriptWords(result.transcript) || "The transcript will appear here."}` : ""}
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  {result?.record ? <button type="button" className="ui-btn ui-btn--secondary" onClick={() => setPhase("transcript-after")}>Open transcript</button> : null}
                  <button type="button" className="ui-btn ui-btn--primary" onClick={onClose}>Done</button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {phase === "transcript-after" ? <Transcript callRef={refRef.current} onBack={() => setPhase("saved")} /> : null}

        {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
      </div>
    </div>
  );
}
