import React, { useState } from "react";
import { Check, Hand } from "lucide-react";
import { Spinner } from "../app/Loader";
import { C, FONT_BODY } from "../tokens";
import { PLUGIN_COLOR, PLUGIN_LABEL, STATUS_LABEL, cancelRun, doneCount, isActive, runById, startRun, useAgentRuns } from "./agentRuns";

// The plan the assistant wrote with the person, shown in the chat. Nothing runs until they press Run. After that the same card shows how it is going,
// and the corner widget keeps it in view on every screen.
export function PlanCard({ plan }) {
  const runs = useAgentRuns();
  const live = runById(runs, plan.id);
  const run = live || plan;
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dropped, setDropped] = useState(false);
  const planned = run.status === "planned" && !dropped;
  const text = { fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink };
  const muted = { fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate };
  const call = async (name, fn) => {
    setBusy(name);
    setError("");
    try { await fn(); } catch (err) { setError(err.message || "That did not work. Try again."); } finally { setBusy(""); }
  };
  const gates = run.steps.filter((s) => s.kind === "gate").length;
  const plugins = [...new Set(run.steps.map((s) => s.plugin))];
  return (
    <div className="as-card" role="group" aria-label={`Plan: ${run.title}`}>
      <div style={{ ...text, fontWeight: 600 }}>{run.title}</div>
      <div style={{ ...muted, margin: "2px 0 8px" }}>
        {planned ? `${run.steps.length} steps${plugins.length > 1 ? ` across ${plugins.map((p) => PLUGIN_LABEL[p]).join(" and ")}` : ""}. Nothing runs until you press Run.` : dropped ? "Not run." : `${STATUS_LABEL[run.status] || run.status} · ${doneCount(run)} of ${run.steps.length} steps`}
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
        {run.steps.map((s) => (
          <li key={s.i} style={{ display: "flex", gap: 8, ...text, fontSize: 12.5, alignItems: "flex-start" }}>
            {s.state === "done" ? <Check size={13} color={C.green} aria-label="done" style={{ flex: "none", marginTop: 3 }} />
              : s.state === "running" ? <span style={{ flex: "none", marginTop: 2 }}><Spinner size={12} /></span>
                : s.state === "waiting" || (s.kind === "gate" && s.state === "pending") ? <Hand size={13} color={C.amber} aria-label="your turn" style={{ flex: "none", marginTop: 3 }} />
                  : <span style={{ flex: "none", width: 12, height: 12, marginTop: 3, borderRadius: "50%", border: "1.5px solid #C9CED8", boxSizing: "border-box" }} aria-hidden="true" />}
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "#fff", background: PLUGIN_COLOR[s.plugin], borderRadius: 6, padding: "1px 6px", marginTop: 2, flex: "none" }}>{PLUGIN_LABEL[s.plugin]}</span>
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{s.label}{s.kind === "gate" && planned ? <span style={{ color: C.amber }}> · you do this one</span> : null}</span>
          </li>
        ))}
      </ol>
      {planned && gates ? <div style={{ ...muted, marginTop: 8 }}>{gates === 1 ? "One step costs credits or sends something, so it waits for you." : `${gates} steps cost credits or send something, so they wait for you.`}</div> : null}
      {error ? <div role="alert" style={{ ...muted, color: C.red, marginTop: 6 }}>{error}</div> : null}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {planned ? (
          <>
            <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!!busy}
              onClick={() => call("run", async () => { await startRun(run.id); window.dispatchEvent(new CustomEvent("aivhub:agent-open")); })}>
              {busy === "run" ? <><Spinner size={13} /> Starting</> : "Run it"}
            </button>
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!!busy} onClick={() => call("drop", async () => { await cancelRun(run.id); setDropped(true); })}>Not now</button>
          </>
        ) : isActive(run) ? (
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => window.dispatchEvent(new CustomEvent("aivhub:agent-open"))}>Show progress</button>
        ) : null}
      </div>
      {planned ? <div style={{ ...muted, marginTop: 6 }}>Want something different? Tell me and I will change the plan.</div> : null}
    </div>
  );
}
