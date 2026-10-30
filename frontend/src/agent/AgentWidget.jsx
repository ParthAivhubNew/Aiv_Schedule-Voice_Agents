import React, { useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Hand, Minus, Pause, Play, Sparkles, Square, X } from "lucide-react";
import { Spinner } from "../app/Loader";
import { C, FONT_BODY } from "../tokens";
import { navigateHash } from "../utils/route";
import { PLUGIN_COLOR, PLUGIN_LABEL, STATUS_LABEL, answerGate, cancelRun, doneCount, isActive, openGate, pauseRun, resumeRun, useAgentRuns, watchRuns } from "./agentRuns";

// The corner widget: every plan the person is running, in the bottom-right corner on every screen. Minimised it is one small pill; click it to see
// each step, pause, resume or cancel, and to answer a step that waits for them. The work carries on whatever page they are on.

const KEY_MIN = "aivhub_agent_widget_min";
const KEY_GONE = "aivhub_agent_widget_dismissed";
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* the choice is just not remembered */ } };

const css = `
.aw{position:fixed;right:16px;bottom:16px;z-index:95;font-family:${FONT_BODY};color:var(--ui-ink,#12141C)}
.aw-pill{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:8px;max-width:min(360px,calc(100vw - 32px));padding:9px 14px;border-radius:999px;background:#111520;color:#fff;font-size:12.5px;font-weight:600;box-shadow:0 8px 24px rgba(18,20,28,.22);animation:aw-in .25s ease both}
.aw-pill:focus-visible,.aw-btn:focus-visible,.aw-x:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:2px}
.aw-pill[data-s="waiting"]{background:#B8760A}
.aw-pill[data-s="failed"],.aw-pill[data-s="interrupted"]{background:#C2410C}
.aw-pill span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.aw-panel{width:min(380px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 32px));display:flex;flex-direction:column;background:#fff;border:1px solid var(--ui-line,#E3E6EB);border-radius:14px;box-shadow:0 16px 48px rgba(18,20,28,.2);overflow:hidden;animation:aw-in .22s ease both}
.aw-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--ui-line,#E3E6EB);font-size:13px;font-weight:600}
.aw-body{overflow-y:auto;padding:10px 12px;display:grid;gap:12px}
.aw-run{display:grid;gap:8px;padding-bottom:12px;border-bottom:1px solid var(--ui-line,#EDEFF2)}
.aw-run:last-child{border-bottom:0;padding-bottom:0}
.aw-steps{margin:0;padding:0;list-style:none;display:grid;gap:7px}
.aw-steps li{display:flex;gap:8px;font-size:12.5px;line-height:1.4}
.aw-chip{flex:none;align-self:flex-start;font-size:10.5px;font-weight:700;color:#fff;border-radius:6px;padding:1px 6px;margin-top:1px}
.aw-btn{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:8px;border:1px solid var(--ui-line,#D5D9E0);font-size:12px;font-weight:600;background:#fff;color:var(--ui-ink,#12141C)}
.aw-btn:hover{background:#F4F6FA}
.aw-btn[data-primary="true"]{background:#111520;color:#fff;border-color:#111520}
.aw-btn[data-danger="true"]{color:#C2410C}
.aw-x{all:unset;cursor:pointer;width:26px;height:26px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;color:#6B7280}
.aw-x:hover{background:#F0F2F6}
.aw-bar{height:4px;border-radius:2px;background:#EDEFF2;overflow:hidden}
.aw-bar i{display:block;height:100%;background:var(--ui-accent,#3457D5);transition:width .4s ease}
@media (min-width:821px){body:has(.as-wrap:not(.as-page)) .aw{right:416px}}
@media (max-width:820px){body:has(.as-wrap) .aw{bottom:176px}}
@keyframes aw-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.aw-pill,.aw-panel{animation:none}.aw-bar i{transition:none}}
`;

function StepIcon({ state }) {
  if (state === "done") return <Check size={14} color={C.green} aria-label="done" style={{ flex: "none", marginTop: 2 }} />;
  if (state === "running") return <span style={{ flex: "none", marginTop: 2 }}><Spinner size={13} /></span>;
  if (state === "waiting") return <Hand size={14} color={C.amber} aria-label="waiting for you" style={{ flex: "none", marginTop: 2 }} />;
  if (state === "failed") return <AlertTriangle size={14} color={C.red} aria-label="failed" style={{ flex: "none", marginTop: 2 }} />;
  if (state === "skipped") return <Minus size={14} color="#9CA3AF" aria-label="skipped" style={{ flex: "none", marginTop: 2 }} />;
  return <span aria-label="not started" style={{ flex: "none", width: 14, height: 14, marginTop: 2, borderRadius: "50%", border: "1.5px solid #C9CED8", boxSizing: "border-box" }} />;
}

function Run({ run, onGone }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const total = run.steps.length;
  const waiting = run.steps.find((s) => s.state === "waiting");
  const call = async (name, fn) => {
    setBusy(name);
    setError("");
    try { await fn(); } catch (err) { setError(err.message || "That did not work. Try again."); } finally { setBusy(""); }
  };
  const live = isActive(run);
  const plugins = [...new Set(run.steps.map((s) => s.plugin))];
  return (
    <section className="aw-run" aria-label={run.title}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, overflowWrap: "anywhere" }}>{run.title}</div>
          <div style={{ fontSize: 12, color: run.status === "failed" || run.status === "interrupted" ? C.red : run.status === "waiting" ? C.amber : "#6B7280" }}>
            {STATUS_LABEL[run.status] || run.status} · {doneCount(run)} of {total}
            {plugins.length > 1 ? ` · ${plugins.map((p) => PLUGIN_LABEL[p]).join(" + ")}` : ""}
          </div>
        </div>
        {!live ? <button type="button" className="aw-x" aria-label={`Hide ${run.title}`} title="Hide" onClick={() => onGone(run.id)}><X size={14} /></button> : null}
      </div>
      <div className="aw-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount(run)} aria-label="Progress"><i style={{ width: `${(doneCount(run) / Math.max(total, 1)) * 100}%` }} /></div>
      <ol className="aw-steps">
        {run.steps.map((s) => (
          <li key={s.i}>
            <StepIcon state={s.state} />
            <span className="aw-chip" style={{ background: PLUGIN_COLOR[s.plugin] }}>{PLUGIN_LABEL[s.plugin]}</span>
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
              <strong style={{ fontWeight: 600 }}>{s.label}</strong>
              {s.kind === "gate" && s.state === "pending" ? <span style={{ color: C.amber }}> · your turn</span> : null}
              {s.result && (s.state === "done" || s.state === "failed" || s.state === "skipped") ? <><br /><span style={{ color: "#6B7280" }}>{s.result.length > 220 ? `${s.result.slice(0, 220)}…` : s.result}</span></> : null}
            </span>
          </li>
        ))}
      </ol>
      {waiting ? (
        <div role="group" aria-label="This step needs you" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", background: C.amberSoft, borderRadius: 10, padding: "8px 10px" }}>
          <span style={{ fontSize: 12.5, flex: "1 1 100%" }}>{waiting.label}: this one is yours to do, because it costs credits or sends something.</span>
          {waiting.go ? <button type="button" className="aw-btn" data-primary="true" onClick={() => openGate(waiting, navigateHash)}>Open it</button> : null}
          <button type="button" className="aw-btn" disabled={busy === "gate"} onClick={() => call("gate", () => answerGate(run.id, "done"))}>I have done it</button>
          <button type="button" className="aw-btn" disabled={busy === "gate"} onClick={() => call("gate", () => answerGate(run.id, "skip"))}>Skip it</button>
        </div>
      ) : null}
      {error ? <div role="alert" style={{ fontSize: 12, color: C.red }}>{error}</div> : null}
      {live || run.status === "failed" ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {run.status === "running" || run.status === "waiting" ? <button type="button" className="aw-btn" disabled={busy === "pause"} onClick={() => call("pause", () => pauseRun(run.id))}><Pause size={13} aria-hidden="true" /> Pause</button> : null}
          {run.status === "paused" || run.status === "interrupted" || run.status === "failed" ? <button type="button" className="aw-btn" data-primary="true" disabled={busy === "resume"} onClick={() => call("resume", () => resumeRun(run.id))}><Play size={13} aria-hidden="true" /> {run.status === "failed" ? "Try this step again" : "Resume"}</button> : null}
          {live ? <button type="button" className="aw-btn" data-danger="true" disabled={busy === "cancel"} onClick={() => call("cancel", () => cancelRun(run.id))}><Square size={12} aria-hidden="true" /> Cancel</button> : null}
        </div>
      ) : null}
      {run.status === "done" && run.summary ? <div style={{ fontSize: 12, color: "#6B7280" }}>{run.summary}</div> : null}
      {run.status === "cancelled" ? <div style={{ fontSize: 12, color: "#6B7280" }}>Cancelled. Anything already sent or saved stays as it is.</div> : null}
    </section>
  );
}

export function AgentWidget() {
  const runs = useAgentRuns();
  const [min, setMin] = useState(() => read(KEY_MIN, true));
  const [gone, setGone] = useState(() => read(KEY_GONE, []));
  useEffect(() => watchRuns(), []);
  useEffect(() => {
    const open = () => { setMin(false); write(KEY_MIN, false); };
    window.addEventListener("aivhub:agent-open", open);
    return () => window.removeEventListener("aivhub:agent-open", open);
  }, []);
  const hide = (id) => { const next = [...gone, id].slice(-50); setGone(next); write(KEY_GONE, next); };
  // Finished plans stay for a few hours so the result can be read. A plan that was dropped before any step ran is not worth showing.
  const untouched = (r) => r.status === "cancelled" && r.steps.every((s) => s.state === "pending");
  const shown = runs.filter((r) => isActive(r) || (!gone.includes(r.id) && !untouched(r) && ["done", "failed", "cancelled"].includes(r.status) && Date.now() - Date.parse(r.updated_at || 0) < 6 * 3600 * 1000));
  const toggle = (v) => { setMin(v); write(KEY_MIN, v); };
  if (!shown.length) return null;
  const lead = shown.find((r) => r.status === "waiting") || shown.find((r) => r.status === "running") || shown[0];
  const current = lead.steps.find((s) => s.state === "running" || s.state === "waiting");
  const pill = lead.status === "waiting" ? `Needs you: ${current?.label || lead.title}`
    : lead.status === "running" ? `${lead.title} · step ${Math.min(doneCount(lead) + 1, lead.steps.length)} of ${lead.steps.length}`
      : `${lead.title} · ${STATUS_LABEL[lead.status] || lead.status}`;
  return (
    <div className="aw">
      <style>{css}</style>
      {min ? (
        <button type="button" className="aw-pill" data-s={lead.status} aria-label={`${pill}. Open the progress`} onClick={() => toggle(false)}>
          {lead.status === "running" ? <Spinner size={13} /> : lead.status === "waiting" ? <Hand size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
          <span>{pill}</span>{shown.length > 1 ? <span aria-hidden="true">+{shown.length - 1}</span> : null}
        </button>
      ) : (
        <div className="aw-panel" role="region" aria-label="Plans running in the background">
          <div className="aw-head">
            <Sparkles size={15} aria-hidden="true" /> <span style={{ flex: 1 }}>Running for you</span>
            <button type="button" className="aw-x" aria-label="Minimise" title="Minimise: the work carries on" onClick={() => toggle(true)}><ChevronDown size={16} /></button>
          </div>
          <div className="aw-body" aria-live="polite">{shown.map((r) => <Run key={r.id} run={r} onGone={hide} />)}</div>
        </div>
      )}
    </div>
  );
}
