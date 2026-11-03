import React, { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { api } from "../api/apiClient";
import { Spinner } from "../app/Loader";
import { C, FONT_BODY } from "../tokens";
import { PLUGIN_NAME, blankAction, opLabel, problem } from "./workflowModel";

// The editor draws a workflow the way it runs: the trigger at the top, then each step in order, with the two paths of an "if" side by side.

export const editorCss = `
.wfe{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:24px;align-items:start;width:100%;font-family:${FONT_BODY};color:#12141C}
.wfe-main{min-width:0}
.wfe-side{position:sticky;top:16px;display:grid;gap:12px;min-width:0}
@media (max-width:1000px){.wfe{grid-template-columns:minmax(0,1fr)}.wfe-side{position:static}}
.wfe-node{background:#fff;border:1px solid #D5D9E0;border-radius:10px;padding:16px 18px;display:grid;gap:12px}
.wfe-node--trigger{border-color:#3457D5;background:#F7F9FF}
.wfe-tag{font-size:13px;font-weight:700;color:#6B7280;display:flex;align-items:center;gap:8px}
.wfe-tag b{display:inline-grid;place-items:center;min-width:20px;height:20px;border-radius:6px;background:#EEF0F4;color:#12141C;font-size:11.5px}
.wfe-line{width:2px;height:16px;background:#C5CAD3;margin:0 auto}
.wfe-add{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;padding:2px 0}
.wfe-branches{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:640px){.wfe-branches{grid-template-columns:1fr}}
.wfe-branch{background:#FBFCFD;border:1px dashed #C5CAD3;border-radius:10px;padding:10px;display:grid;gap:0;align-content:start}
.wfe-branch h4{margin:0 0 8px;font-size:12px;font-weight:700;color:#12141C}
.wfe-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.wfe-label{display:grid;gap:6px;font-size:13px;font-weight:600;color:#6B7280}
.wfe-bar{padding-top:4px}
`;

const text = { fontFamily: FONT_BODY, fontSize: 14, color: C.ink };
const muted = { fontFamily: FONT_BODY, fontSize: 13, color: C.slate };

export function Select({ value, onChange, children, label, style }) {
  return <select className="ui-input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ minWidth: 0, ...style }}>{children}</select>;
}

const newBlock = (type) => (type === "wait" ? { type: "wait", hours: 24 } : type === "stop" ? { type: "stop" }
  : type === "if" ? { type: "if", cond: { field: "stage", op: "is", value: "new" }, then: [blankAction()], else: [] } : blankAction());

function ConditionEditor({ cond, onChange, meta, label }) {
  const spec = meta.condition_fields[cond.field] || {};
  const setField = (field) => { const s = meta.condition_fields[field]; onChange({ field, op: s.ops[0], value: s.values ? s.values[0] : "" }); };
  return (
    <div className="wfe-row" role="group" aria-label={label}>
      <Select label="Filter on" value={cond.field} onChange={setField}>{Object.entries(meta.condition_fields).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
      <Select label="Comparison" value={cond.op} onChange={(op) => onChange({ ...cond, op })}>{(spec.ops || []).map((o) => <option key={o} value={o}>{opLabel(o)}</option>)}</Select>
      {spec.values ? (
        <Select label="Value" value={cond.value} onChange={(value) => onChange({ ...cond, value })}>{spec.values.map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}</Select>
      ) : <input className="ui-input" aria-label="Value" placeholder={cond.field === "in_list" ? "List name" : "Text to look for"} value={cond.value} onChange={(e) => onChange({ ...cond, value: e.target.value })} style={{ minWidth: 140, flex: 1 }} />}
    </div>
  );
}

const KIND = { action: "Do", if: "If", wait: "Wait", stop: "Stop" };

function Step({ block, onChange, onRemove, onMove, first, last, meta, depth, index }) {
  const set = (patch) => onChange({ ...block, ...patch });
  const head = (
    <div className="wfe-tag">
      <b>{index + 1}</b><span>{KIND[block.type]}</span>
      <span style={{ flex: 1 }} />
      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label={`Move step ${index + 1} up`} disabled={first} onClick={() => onMove(-1)}><ArrowUp size={13} /></button>
      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label={`Move step ${index + 1} down`} disabled={last} onClick={() => onMove(1)}><ArrowDown size={13} /></button>
      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label={`Remove step ${index + 1}`} onClick={onRemove}><Trash2 size={13} /></button>
    </div>
  );
  if (block.type === "stop") return <div className="wfe-node">{head}<div style={muted}>The workflow ends here for this company.</div></div>;
  if (block.type === "wait") {
    const days = block.hours % 24 === 0;
    return (
      <div className="wfe-node">{head}
        <div className="wfe-row">
          <input className="ui-input" type="number" min={1} aria-label="How long to wait" value={days ? block.hours / 24 : block.hours} onChange={(e) => set({ hours: Math.max(1, Number(e.target.value) || 1) * (days ? 24 : 1) })} style={{ width: 90 }} />
          <Select label="Unit" value={days ? "days" : "hours"} onChange={(u) => set({ hours: u === "days" ? Math.max(1, Math.round(block.hours / 24)) * 24 : Math.max(1, block.hours % 24 === 0 ? block.hours / 24 : block.hours) })}>
            <option value="hours">hours</option><option value="days">days</option>
          </Select>
          <span style={muted}>then carry on (up to 30 days)</span>
        </div>
      </div>
    );
  }
  if (block.type === "if") {
    return (
      <div className="wfe-node">{head}
        <ConditionEditor cond={block.cond} onChange={(cond) => set({ cond })} meta={meta} label={`Step ${index + 1} condition`} />
        <div className="wfe-branches">
          <div className="wfe-branch"><h4>If yes</h4><Flow blocks={block.then} onChange={(then) => set({ then })} meta={meta} depth={depth + 1} /></div>
          <div className="wfe-branch"><h4>If no <span style={{ ...muted, fontWeight: 400 }}>(empty does nothing)</span></h4><Flow blocks={block.else} onChange={(other) => set({ else: other })} meta={meta} depth={depth + 1} /></div>
        </div>
      </div>
    );
  }
  const a = block.action;
  return (
    <div className="wfe-node">{head}
      <Select label={`Step ${index + 1} action`} value={a} onChange={(action) => set({ action, value: action === "set_stage" ? "interested" : "", days: action === "follow_up" ? 1 : undefined, subject: "" })}>
        {Object.entries(meta.actions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select>
      {a === "set_stage" ? (
        <Select label="Stage" value={block.value} onChange={(value) => set({ value })}>{meta.stages.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</Select>
      ) : a === "add_to_list" ? (
        <input className="ui-input" aria-label="List name" placeholder="List name (made if it is new)" value={block.value} onChange={(e) => set({ value: e.target.value })} />
      ) : a === "webhook" ? (
        <input className="ui-input" aria-label="Web address" placeholder="https://your-system.example.com/hook" value={block.value} onChange={(e) => set({ value: e.target.value })} />
      ) : a === "add_dnc" ? <div style={muted}>Stops every plugin from contacting this company again.</div> : (
        <>
          {a === "send_email" ? <input className="ui-input" aria-label="Subject" placeholder="Subject" value={block.subject || ""} onChange={(e) => set({ subject: e.target.value })} /> : null}
          <textarea className="ui-input" rows={2} aria-label={a === "send_email" ? "Message" : "Text"} style={{ height: "auto", padding: 8, resize: "vertical" }}
            placeholder={a === "follow_up" ? "What to do, e.g. Call {{company}} back" : "Text. {{first_name}} and {{company}} work here"} value={block.value} onChange={(e) => set({ value: e.target.value })} />
        </>
      )}
      {a === "follow_up" ? (
        <div className="wfe-row"><span style={muted}>in</span><input className="ui-input" type="number" min={0} max={365} aria-label="Days until the follow-up" value={block.days ?? 1} onChange={(e) => set({ days: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 80 }} /><span style={muted}>days</span></div>
      ) : null}
    </div>
  );
}

function Flow({ blocks, onChange, meta, depth = 0 }) {
  const ended = blocks.some((b) => b.type === "stop");
  return (
    <div>
      {blocks.map((b, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <div className="wfe-line" aria-hidden="true" /> : null}
          <Step block={b} index={i} depth={depth} meta={meta} first={i === 0} last={i === blocks.length - 1} onMove={(d) => { const to = [...blocks]; [to[i], to[i + d]] = [to[i + d], to[i]]; onChange(to); }} onChange={(nb) => onChange(blocks.map((x, j) => (j === i ? nb : x)))} onRemove={() => onChange(blocks.filter((_, j) => j !== i))} />
        </React.Fragment>
      ))}
      {blocks.length ? <div className="wfe-line" aria-hidden="true" /> : null}
      {ended ? <div style={{ ...muted, textAlign: "center" }}>Steps after a Stop never run.</div> : null}
      <div className="wfe-add" role="group" aria-label="Add a step">
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => onChange([...blocks, blankAction()])}><Plus size={13} /> Action</button>
        {depth < 2 ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => onChange([...blocks, newBlock("if")])}><Plus size={13} /> If / else</button> : null}
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => onChange([...blocks, newBlock("wait")])}><Plus size={13} /> Wait</button>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => onChange([...blocks, newBlock("stop")])}>Stop</button>
      </div>
    </div>
  );
}

export function WorkflowEditor({ meta, initial, onSave, onCancel, canEdit }) {
  const [w, setW] = useState(initial);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [trial, setTrial] = useState(null);
  const info = meta.event_info[w.event];
  const set = (patch) => { setError(""); setTrial(null); setW((x) => ({ ...x, ...patch })); };
  // A blank name falls back to what starts the workflow, so saving never needs typing.
  const named = (x) => (x.name.trim() ? x : { ...x, name: info?.label || "" });
  const why = problem(named(w), meta);
  const tryIt = async () => {
    setBusy("try"); setError(""); setTrial(null);
    try { setTrial(await api.testWorkflow(named(w))); } catch (err) { setError(err.message || "I could not try that."); }
    setBusy("");
  };
  const save = async () => {
    if (why) { setError(why); return; }
    setBusy("save"); setError("");
    try { await onSave(named(w)); } catch (err) { setError(err.message || "Could not save."); setBusy(""); }
  };
  const byPlugin = ["voice", "leads", "social"].map((p) => [p, Object.entries(meta.event_info).filter(([, v]) => v.plugin === p)]);
  const lim = w.limits;
  return (
    <div className="wfe">
      <div className="wfe-main">
      <section className="wfe-node wfe-node--trigger" aria-label="When this happens">
        <div className="wfe-tag"><span>When this happens</span></div>
        <div className="wfe-row">
          <Select label="Event" value={w.event} onChange={(event) => set({ event, when: {}, conditions: meta.event_info[event]?.lead ? w.conditions : [], do: meta.event_info[event]?.lead ? w.do : w.do.filter((b) => b.type !== "action" || !meta.action_info[b.action]?.needs_lead) })} style={{ flex: "1 1 260px" }}>
            {byPlugin.map(([p, list]) => <optgroup key={p} label={PLUGIN_NAME[p]}>{list.map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</optgroup>)}
          </Select>
          {info?.outcomes?.length ? (
            <Select label="Only when the result is" value={w.when?.outcome || ""} onChange={(o) => set({ when: o ? { outcome: o } : {} })}>
              <option value="">any result</option>{info.outcomes.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
            </Select>
          ) : null}
        </div>
        {!info?.lead ? <div style={muted}>No company is behind this event, so only steps that do not need one will run (a notification or a web address).</div> : null}
        {(w.conditions || []).map((c, i) => (
          <div key={i} className="wfe-row">
            <span style={{ ...muted, fontWeight: 700, width: 34 }}>{i === 0 ? "Only if" : "and"}</span>
            <div style={{ flex: 1, minWidth: 0 }}><ConditionEditor cond={c} meta={meta} label={`Filter ${i + 1}`} onChange={(nc) => set({ conditions: w.conditions.map((x, j) => (j === i ? nc : x)) })} /></div>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label={`Remove filter ${i + 1}`} onClick={() => set({ conditions: w.conditions.filter((_, j) => j !== i) })}><X size={13} /></button>
          </div>
        ))}
        {(w.conditions || []).length < 6 && info?.lead ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ justifySelf: "start" }} onClick={() => set({ conditions: [...(w.conditions || []), { field: "stage", op: "is", value: "new" }] })}><Plus size={13} /> Only for some companies</button> : null}
      </section>

      <div className="wfe-line" aria-hidden="true" />
      <section aria-label="Then do this">
        <Flow blocks={w.do} onChange={(d) => set({ do: d })} meta={meta} />
      </section>

      </div>
      <aside className="wfe-side" aria-label="Details">
      <label className="wfe-label">Name
        <input className="ui-input" aria-label="Workflow name" value={w.name} maxLength={80} placeholder={info?.label || "Name this workflow"} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <section className="wfe-node" aria-label="How often">
        <div className="wfe-tag"><span>How often it can run</span></div>
        <div className="wfe-row">
          <Select label="Run for the same company" value={lim.reenroll} onChange={(reenroll) => set({ limits: { ...lim, reenroll } })}>
            <option value="every">Every time it happens</option><option value="once">Only once per company</option><option value="days">At most once every few days</option>
          </Select>
          {lim.reenroll === "days" ? <><input className="ui-input" type="number" min={1} max={365} aria-label="Days between runs" value={lim.days} onChange={(e) => set({ limits: { ...lim, days: Math.max(1, Number(e.target.value) || 1) } })} style={{ width: 80 }} /><span style={muted}>days</span></> : null}
          <span style={muted}>Up to</span>
          <input className="ui-input" type="number" min={1} max={1000} aria-label="Most runs a day" value={lim.per_day} onChange={(e) => set({ limits: { ...lim, per_day: Math.max(1, Number(e.target.value) || 1) } })} style={{ width: 90 }} />
          <span style={muted}>runs a day</span>
        </div>
      </section>

      {trial ? (
        <div className="wfe-node" role="status" aria-label="What would happen" style={{ background: "#F4F7FF" }}>
          <div style={{ ...text, fontWeight: 700 }}>What would happen for {trial.lead.name} <span style={muted}>(nothing was changed or sent)</span></div>
          <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 3, ...text, fontSize: 12.5 }}>{trial.log.map((l, i) => <li key={i}><strong>{l.label}:</strong> {l.result}</li>)}</ol>
        </div>
      ) : null}
      {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
      <div className="wfe-row wfe-bar">
        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!!busy || !canEdit} onClick={save}>{busy === "save" ? <Spinner size={13} /> : "Save workflow"}</button>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!!busy || !!why} onClick={tryIt} title={why || "See what it would do for your latest saved company, without changing anything"}>{busy === "try" ? <Spinner size={13} /> : "Try it on a company"}</button>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onCancel}>Cancel</button>
        {!canEdit ? <span style={muted}>Only people who can edit company settings can save.</span> : null}
        {why && canEdit ? <span style={muted} role="status">To try or save: {why.charAt(0).toLowerCase() + why.slice(1)}</span> : null}
      </div>
      </aside>
    </div>
  );
}
