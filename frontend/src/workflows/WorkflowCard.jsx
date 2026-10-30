import React, { useEffect, useState } from "react";
import { Check, Workflow } from "lucide-react";
import { api } from "../api/apiClient";
import { Spinner } from "../app/Loader";
import { C, FONT_BODY } from "../tokens";
import { openWorkflows } from "./openWorkflows";
import { summary } from "./workflowModel";

// A workflow the assistant wrote with the person, shown in the chat. It does nothing until they press Turn on; then it is saved with the others.
export function WorkflowCard({ rule }) {
  const [meta, setMeta] = useState(null);
  const [state, setState] = useState("");
  const [error, setError] = useState("");
  const [dropped, setDropped] = useState(false);
  useEffect(() => { api.getWorkflows().then(setMeta).catch(() => {}); }, []);
  const text = { fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink };
  const muted = { fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate };
  const turnOn = async () => {
    setState("busy"); setError("");
    try {
      const current = await api.getWorkflows();
      const keep = current.workflows.map(({ stats, ...rest }) => rest);
      const saved = await api.saveWorkflows([...keep, { ...rule, id: undefined, enabled: true }]);
      if (saved.workflows.length <= keep.length) throw new Error("That workflow is not complete.");
      setState("on");
    } catch (err) { setError(err.message || "Could not turn it on."); setState(""); }
  };
  return (
    <div className="as-card" role="group" aria-label={`Workflow: ${rule.name}`}>
      <div style={{ ...text, fontWeight: 600, display: "flex", gap: 6, alignItems: "center" }}><Workflow size={15} aria-hidden="true" /> {rule.name}</div>
      <div style={{ ...muted, margin: "4px 0 8px" }}>{meta ? summary(rule, meta) : "Loading…"}</div>
      {state === "on" ? (
        <div style={{ ...muted, color: C.green, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <Check size={14} aria-hidden="true" /> It is on. It runs the next time that happens.
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => openWorkflows({})}>See it in Workflows</button>
        </div>
      ) : dropped ? <div style={muted}>Not turned on.</div> : (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={state === "busy" || !meta} onClick={turnOn}>{state === "busy" ? <><Spinner size={13} /> Turning on</> : "Turn on"}</button>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => openWorkflows({ event: rule.event })}>Open Workflows</button>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setDropped(true)}>Not now</button>
        </div>
      )}
      {error ? <div role="alert" style={{ ...muted, color: C.red, marginTop: 6 }}>{error}</div> : null}
    </div>
  );
}
