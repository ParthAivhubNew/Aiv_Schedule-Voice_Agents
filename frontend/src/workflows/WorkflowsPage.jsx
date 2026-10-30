import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Plus, RotateCcw, Square, Trash2, Workflow, X } from "lucide-react";
import { api } from "../api/apiClient";
import { Loader, Spinner } from "../app/Loader";
import { C, FONT_BODY } from "../tokens";
import { PLUGIN_COLOR, PLUGIN_NAME, STATUS_LABEL, blankAction, blankWorkflow, blockText, opLabel, problem, summary, when } from "./workflowModel";

// Workflows: "when this happens, do that", for the whole company. Opened from the hub or from a plugin's sidebar; it is one page, so a workflow can
// use Leads, Voice and Social together and nothing is kept per plugin.

const css = `
.wf{position:fixed;inset:0;z-index:120;background:var(--ui-paper,#F6F7F9);overflow-y:auto;font-family:${FONT_BODY};color:#12141C}
.wf-top{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:12px;padding:12px clamp(16px,4vw,32px);background:#fff;border-bottom:1px solid #E3E6EB}
.wf-main{max-width:980px;margin:0 auto;padding:22px clamp(16px,4vw,32px) 72px;display:grid;gap:16px}
.wf-tabs{display:flex;gap:4px;border-bottom:1px solid #E3E6EB}
.wf-tab{all:unset;cursor:pointer;padding:9px 14px;font-size:13.5px;font-weight:600;color:#6B7280;border-bottom:2px solid transparent;margin-bottom:-1px}
.wf-tab[aria-selected="true"]{color:#12141C;border-bottom-color:#12141C}
.wf-tab:focus-visible,.wf-chip:focus-visible,.wf-link:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:2px}
.wf-card{background:#fff;border:1px solid #E3E6EB;border-radius:12px;padding:12px 14px}
.wf-chip{all:unset;cursor:pointer;padding:5px 11px;border:1px solid #D5D9E0;border-radius:999px;font-size:12.5px;background:#fff}
.wf-chip[aria-pressed="true"]{background:#111520;color:#fff;border-color:#111520}
.wf-label{display:grid;gap:4px;font-size:12px;font-weight:600;color:#6B7280}
.wf-step{border:1px solid #E3E6EB;border-radius:10px;padding:10px;display:grid;gap:8px;background:#FBFCFD}
.wf-nest{margin-left:14px;border-left:2px solid #E3E6EB;padding-left:12px;display:grid;gap:8px}
.wf-link{all:unset;cursor:pointer;color:#3457D5;font-size:12.5px;font-weight:600}
.wf-pill{display:inline-block;font-size:11px;font-weight:700;color:#fff;border-radius:6px;padding:1px 7px}
.wf-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
@media (prefers-reduced-motion:reduce){.wf *{transition:none!important;animation:none!important}}
`;

const text = { fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink };
const muted = { fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate };

function Select({ value, onChange, children, label, style }) {
  return <select className="ui-input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ minWidth: 0, ...style }}>{children}</select>;
}

// ── The blocks of a flow ────────────────────────────────────────────────────
function ConditionEditor({ cond, onChange, meta, label }) {
  const spec = meta.condition_fields[cond.field] || {};
  const setField = (field) => { const s = meta.condition_fields[field]; onChange({ field, op: s.ops[0], value: s.values ? s.values[0] : "" }); };
  return (
    <div className="wf-row" role="group" aria-label={label}>
      <Select label="Filter on" value={cond.field} onChange={setField}>{Object.entries(meta.condition_fields).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
      <Select label="Comparison" value={cond.op} onChange={(op) => onChange({ ...cond, op })}>{(spec.ops || []).map((o) => <option key={o} value={o}>{opLabel(o)}</option>)}</Select>
      {spec.values ? (
        <Select label="Value" value={cond.value} onChange={(value) => onChange({ ...cond, value })}>{spec.values.map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}</Select>
      ) : <input className="ui-input" aria-label="Value" placeholder={cond.field === "in_list" ? "List name" : "Text to look for"} value={cond.value} onChange={(e) => onChange({ ...cond, value: e.target.value })} style={{ minWidth: 140, flex: 1 }} />}
    </div>
  );
}

const newBlock = (type) => (type === "wait" ? { type: "wait", hours: 24 } : type === "stop" ? { type: "stop" }
  : type === "if" ? { type: "if", cond: { field: "stage", op: "is", value: "new" }, then: [blankAction()], else: [] } : blankAction());

function BlockEditor({ block, onChange, onRemove, meta, depth, index }) {
  const set = (patch) => onChange({ ...block, ...patch });
  const head = (
    <div className="wf-row">
      <span style={{ ...muted, fontWeight: 700, width: 18 }}>{index + 1}</span>
      <Select label={`Step ${index + 1} kind`} value={block.type} onChange={(t) => onChange(newBlock(t))}>
        <option value="action">Do something</option><option value="if">If… (two paths)</option><option value="wait">Wait</option><option value="stop">Stop here</option>
      </Select>
      <span style={{ flex: 1 }} />
      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label={`Remove step ${index + 1}`} onClick={onRemove}><Trash2 size={13} /></button>
    </div>
  );
  if (block.type === "stop") return <div className="wf-step">{head}<div style={muted}>The workflow ends here for this company.</div></div>;
  if (block.type === "wait") {
    const days = block.hours % 24 === 0;
    return (
      <div className="wf-step">{head}
        <div className="wf-row">
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
      <div className="wf-step">{head}
        <ConditionEditor cond={block.cond} onChange={(cond) => set({ cond })} meta={meta} label={`Step ${index + 1} condition`} />
        <div style={{ ...muted, fontWeight: 700 }}>If yes</div>
        <div className="wf-nest"><Flow blocks={block.then} onChange={(then) => set({ then })} meta={meta} depth={depth + 1} /></div>
        <div style={{ ...muted, fontWeight: 700 }}>If no (leave empty to do nothing)</div>
        <div className="wf-nest"><Flow blocks={block.else} onChange={(other) => set({ else: other })} meta={meta} depth={depth + 1} /></div>
      </div>
    );
  }
  const a = block.action;
  return (
    <div className="wf-step">{head}
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
        <div className="wf-row"><span style={muted}>in</span><input className="ui-input" type="number" min={0} max={365} aria-label="Days until the follow-up" value={block.days ?? 1} onChange={(e) => set({ days: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 80 }} /><span style={muted}>days</span></div>
      ) : null}
      {meta.action_info[a]?.needs_lead ? null : <div style={muted}>Works even when the event has no company behind it.</div>}
    </div>
  );
}

function Flow({ blocks, onChange, meta, depth = 0 }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {blocks.map((b, i) => <BlockEditor key={i} block={b} index={i} depth={depth} meta={meta} onChange={(nb) => onChange(blocks.map((x, j) => (j === i ? nb : x)))} onRemove={() => onChange(blocks.filter((_, j) => j !== i))} />)}
      <div className="wf-row">
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => onChange([...blocks, blankAction()])}><Plus size={13} /> Step</button>
        {depth < 2 ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => onChange([...blocks, newBlock("if")])}><Plus size={13} /> If / else</button> : null}
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => onChange([...blocks, newBlock("wait")])}><Plus size={13} /> Wait</button>
      </div>
    </div>
  );
}

// ── Making or changing one ──────────────────────────────────────────────────
function Editor({ meta, initial, onSave, onCancel, canEdit }) {
  const [w, setW] = useState(initial);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [trial, setTrial] = useState(null);
  const info = meta.event_info[w.event];
  const set = (patch) => { setError(""); setTrial(null); setW((x) => ({ ...x, ...patch })); };
  const why = problem(w, meta);
  const tryIt = async () => {
    setBusy("try"); setError(""); setTrial(null);
    try { setTrial(await api.testWorkflow(w)); } catch (err) { setError(err.message || "I could not try that."); }
    setBusy("");
  };
  const save = async () => {
    if (why) { setError(why); return; }
    setBusy("save"); setError("");
    try { await onSave(w); } catch (err) { setError(err.message || "Could not save."); setBusy(""); }
  };
  const byPlugin = ["voice", "leads", "social"].map((p) => [p, Object.entries(meta.event_info).filter(([, v]) => v.plugin === p)]);
  return (
    <div className="wf-card" style={{ display: "grid", gap: 16 }}>
      <label className="wf-label">Name
        <input className="ui-input" aria-label="Workflow name" value={w.name} maxLength={80} placeholder="For example: Callback requested, plan the call back" onChange={(e) => set({ name: e.target.value })} />
      </label>

      <section aria-label="When this happens" style={{ display: "grid", gap: 8 }}>
        <div style={{ ...text, fontWeight: 700 }}>1. When this happens</div>
        <div className="wf-row">
          <Select label="Event" value={w.event} onChange={(event) => set({ event, when: {} })} style={{ flex: "1 1 260px" }}>
            {byPlugin.map(([p, list]) => <optgroup key={p} label={PLUGIN_NAME[p]}>{list.map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</optgroup>)}
          </Select>
          {info?.outcomes?.length ? (
            <Select label="Only when the result is" value={w.when?.outcome || ""} onChange={(o) => set({ when: o ? { outcome: o } : {} })}>
              <option value="">any result</option>{info.outcomes.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
            </Select>
          ) : null}
        </div>
        {!info?.lead ? <div style={muted}>There is no company behind this event, so only steps that do not need one will run (a notification or a web address).</div> : null}
        <div style={{ ...muted, fontWeight: 700 }}>Only for companies where (optional)</div>
        {(w.conditions || []).map((c, i) => (
          <div key={i} className="wf-row">
            <div style={{ flex: 1, minWidth: 0 }}><ConditionEditor cond={c} meta={meta} label={`Filter ${i + 1}`} onChange={(nc) => set({ conditions: w.conditions.map((x, j) => (j === i ? nc : x)) })} /></div>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label={`Remove filter ${i + 1}`} onClick={() => set({ conditions: w.conditions.filter((_, j) => j !== i) })}><X size={13} /></button>
          </div>
        ))}
        {(w.conditions || []).length < 6 && info?.lead ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ justifySelf: "start" }} onClick={() => set({ conditions: [...(w.conditions || []), { field: "stage", op: "is", value: "new" }] })}><Plus size={13} /> Add a filter</button> : null}
      </section>

      <section aria-label="Then do this" style={{ display: "grid", gap: 8 }}>
        <div style={{ ...text, fontWeight: 700 }}>2. Then do this</div>
        <Flow blocks={w.do} onChange={(d) => set({ do: d })} meta={meta} />
      </section>

      <section aria-label="Settings" style={{ display: "grid", gap: 8 }}>
        <div style={{ ...text, fontWeight: 700 }}>3. How often</div>
        <div className="wf-row">
          <Select label="Run for the same company" value={w.limits.reenroll} onChange={(reenroll) => set({ limits: { ...w.limits, reenroll } })}>
            <option value="every">Every time it happens</option><option value="once">Only once per company</option><option value="days">At most once every few days</option>
          </Select>
          {w.limits.reenroll === "days" ? <><input className="ui-input" type="number" min={1} max={365} aria-label="Days between runs" value={w.limits.days} onChange={(e) => set({ limits: { ...w.limits, days: Math.max(1, Number(e.target.value) || 1) } })} style={{ width: 80 }} /><span style={muted}>days</span></> : null}
          <span style={muted}>At most</span>
          <input className="ui-input" type="number" min={1} max={1000} aria-label="Most runs a day" value={w.limits.per_day} onChange={(e) => set({ limits: { ...w.limits, per_day: Math.max(1, Number(e.target.value) || 1) } })} style={{ width: 90 }} />
          <span style={muted}>runs a day</span>
        </div>
      </section>

      {trial ? (
        <div className="wf-card" role="status" aria-label="What would happen" style={{ background: "#F4F7FF" }}>
          <div style={{ ...text, fontWeight: 700, marginBottom: 6 }}>What would happen for {trial.lead.name} <span style={muted}>(nothing was changed or sent)</span></div>
          <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 3, ...text, fontSize: 12.5 }}>{trial.log.map((l, i) => <li key={i}><strong>{l.label}:</strong> {l.result}</li>)}</ol>
        </div>
      ) : null}
      {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
      <div className="wf-row">
        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!!busy || !canEdit} onClick={save}>{busy === "save" ? <Spinner size={13} /> : "Save workflow"}</button>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!!busy || !!why} onClick={tryIt} title={why || "See what it would do for your latest saved company, without changing anything"}>{busy === "try" ? <Spinner size={13} /> : "Try it on a company"}</button>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onCancel}>Cancel</button>
        {!canEdit ? <span style={muted}>Only people who can edit company settings can save.</span> : null}
      </div>
    </div>
  );
}

// ── Runs ────────────────────────────────────────────────────────────────────
function RunsTab({ meta, workflowId, setWorkflowId, canEdit }) {
  const [runs, setRuns] = useState(null);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => api.workflowRuns(workflowId, status).then((r) => { setRuns(r.runs); setError(""); }).catch((e) => setError(e.message || "Could not load the runs.")), [workflowId, status]);
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);
  const act = async (fn) => { try { await fn(); await load(); } catch (e) { setError(e.message || "That did not work."); } };
  const tone = { done: C.green, failed: C.red, waiting: C.amber, stopped: C.slate, skipped: C.slate, running: C.cobalt };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="wf-row">
        <Select label="Workflow" value={workflowId} onChange={setWorkflowId}><option value="">All workflows</option>{meta.workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
        <Select label="Status" value={status} onChange={setStatus}><option value="">Any status</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
      </div>
      {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
      {!runs ? <Loader compact label="Loading" /> : !runs.length ? <div className="wf-card" style={muted}>No runs yet. They appear here the moment a workflow starts, with what each step did, and why one was skipped.</div> : runs.map((r) => (
        <div key={r.id} className="wf-card">
          <div className="wf-row">
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-expanded={open === r.id} aria-label={`${open === r.id ? "Hide" : "Show"} what ${r.workflow_name} did`} onClick={() => setOpen(open === r.id ? "" : r.id)}>{open === r.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ ...text, fontWeight: 600 }}>{r.workflow_name}{r.lead_name ? <span style={{ ...muted, fontWeight: 400 }}> · {r.lead_name}</span> : null}</div>
              <div style={muted}>{meta.events[r.event] || r.event} · {when(r.created_at)}{r.status === "waiting" && r.resume_at ? ` · carries on ${new Date(r.resume_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</div>
            </div>
            <span style={{ ...muted, fontWeight: 700, color: tone[r.status] }}>{STATUS_LABEL[r.status] || r.status}</span>
            {canEdit && r.status === "failed" ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => act(() => api.retryWorkflowRun(r.id))}><RotateCcw size={13} /> Try again</button> : null}
            {canEdit && (r.status === "waiting" || r.status === "failed") ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => act(() => api.cancelWorkflowRun(r.id))}><Square size={12} /> Stop</button> : null}
          </div>
          {open === r.id ? (
            <ol style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
              {r.log.map((l, i) => <li key={i} style={{ display: "flex", gap: 8, ...text, fontSize: 12.5 }}>{l.ok === false ? <X size={13} color={C.red} aria-label="failed" style={{ marginTop: 2 }} /> : <Check size={13} color={C.green} aria-label="ok" style={{ marginTop: 2 }} />}<span><strong>{l.label}</strong> <span style={{ color: C.slate }}>{l.result}</span></span></li>)}
            </ol>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ── The page ────────────────────────────────────────────────────────────────
export function WorkflowsPage({ context, onClose, canEdit = true }) {
  const [meta, setMeta] = useState(null);
  const [tab, setTab] = useState("workflows");
  const [plugin, setPlugin] = useState(context?.from || "");
  const [editing, setEditing] = useState(null); // {index, workflow}
  const [runsFor, setRunsFor] = useState("");
  const [error, setError] = useState("");
  const heading = useRef(null);
  const load = useCallback(() => api.getWorkflows().then(setMeta).catch((e) => setError(e.message || "Could not load your workflows.")), []);
  useEffect(() => { load(); heading.current?.focus(); }, [load]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !editing) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, onClose]);

  const persist = async (list) => {
    const r = await api.saveWorkflows(list.map(({ stats, ...rest }) => rest));
    if ((r.workflows || []).length < list.length) throw new Error("One of the workflows is not complete.");
    await load();
  };
  const strip = (w) => { const { stats, ...rest } = w; return rest; };
  const shown = useMemo(() => (meta ? meta.workflows.filter((w) => !plugin || meta.event_info[w.event]?.plugin === plugin) : []), [meta, plugin]);
  const templates = useMemo(() => (meta ? meta.templates.filter((t) => !plugin || meta.event_info[t.event]?.plugin === plugin) : []), [meta, plugin]);
  const startFrom = (t) => setEditing({ index: -1, workflow: { ...blankWorkflow(t?.event), ...(t ? { name: t.name, when: t.when || {}, do: JSON.parse(JSON.stringify(t.do)) } : {}) } });
  const event = context?.event;

  return (
    <div className="wf" role="dialog" aria-modal="true" aria-label="Workflows">
      <style>{css}</style>
      <div className="wf-top">
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onClose} aria-label="Back"><ArrowLeft size={15} /> Back</button>
        <Workflow size={18} aria-hidden="true" />
        <h1 ref={heading} tabIndex={-1} style={{ margin: 0, fontSize: 17, fontWeight: 600, outline: "none" }}>Workflows</h1>
        <span style={{ ...muted, flex: 1 }} className="hide-mobile">When something happens in Leads, Voice or Social, do something automatically.</span>
        {!editing && canEdit ? <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => startFrom(event ? { event, name: "", do: [blankAction()] } : null)}><Plus size={14} /> New workflow</button> : null}
      </div>
      <div className="wf-main">
        {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
        {!meta ? <Loader compact label="Loading" /> : editing ? (
          <Editor meta={meta} initial={editing.workflow} canEdit={canEdit} onCancel={() => setEditing(null)}
            onSave={async (w) => { await persist(editing.index >= 0 ? meta.workflows.map((x, i) => (i === editing.index ? w : strip(x))) : [...meta.workflows.map(strip), w]); setEditing(null); setTab("workflows"); }} />
        ) : (
          <>
            <div className="wf-row" role="group" aria-label="Show">
              {[["", "All"], ["voice", "Voice"], ["leads", "Leads"], ["social", "Social"]].map(([k, label]) => <button key={k || "all"} type="button" className="wf-chip" aria-pressed={plugin === k} onClick={() => setPlugin(k)}>{label}</button>)}
            </div>
            <div className="wf-tabs" role="tablist">
              {[["workflows", `Your workflows${meta.workflows.length ? ` (${meta.workflows.length})` : ""}`], ["templates", "Templates"], ["runs", "Runs"]].map(([k, label]) => <button key={k} type="button" role="tab" className="wf-tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}
            </div>
            {tab === "workflows" ? (
              shown.length ? shown.map((w) => {
                const i = meta.workflows.findIndex((x) => x.id === w.id);
                const flip = (patch) => persist(meta.workflows.map((x, j) => (j === i ? { ...strip(x), ...patch } : strip(x)))).catch((e) => setError(e.message));
                return (
                  <div key={w.id} className="wf-card wf-row" style={{ alignItems: "flex-start" }}>
                    <input type="checkbox" role="switch" checked={w.enabled} disabled={!canEdit} aria-label={`${w.name} is ${w.enabled ? "on" : "off"}`} style={{ marginTop: 3 }} onChange={(e) => flip({ enabled: e.target.checked })} />
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ ...text, fontWeight: 600 }}>{w.name}</div>
                      <div style={muted}>{summary(w, meta)}</div>
                      <div style={{ ...muted, marginTop: 4 }}>
                        <span className="wf-pill" style={{ background: PLUGIN_COLOR[meta.event_info[w.event]?.plugin] }}>{PLUGIN_NAME[meta.event_info[w.event]?.plugin]}</span>{" "}
                        {w.stats.runs} run{w.stats.runs === 1 ? "" : "s"} · last {when(w.stats.last)}
                        {w.stats.waiting ? ` · ${w.stats.waiting} waiting` : ""}{w.stats.failed ? <span style={{ color: C.red }}> · {w.stats.failed} failed</span> : null}
                        {" · "}<button type="button" className="wf-link" onClick={() => { setRunsFor(w.id); setTab("runs"); }}>See runs</button>
                      </div>
                    </div>
                    {canEdit ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setEditing({ index: i, workflow: JSON.parse(JSON.stringify(strip(w))) })}>Edit</button> : null}
                    {canEdit ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label={`Delete ${w.name}`} onClick={() => persist(meta.workflows.filter((_, j) => j !== i).map(strip)).catch((e) => setError(e.message))}><Trash2 size={13} /></button> : null}
                  </div>
                );
              }) : (
                <div className="wf-card" style={{ display: "grid", gap: 8 }}>
                  <div style={{ ...text, fontWeight: 600 }}>{meta.workflows.length ? "Nothing here for that plugin yet." : "No workflows yet."}</div>
                  <div style={muted}>Start from a ready-made one, or build your own. A workflow does nothing until you save it and leave it switched on.</div>
                  <div className="wf-row"><button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => setTab("templates")}>Browse templates</button>{canEdit ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => startFrom(null)}>Build my own</button> : null}</div>
                </div>
              )
            ) : null}
            {tab === "templates" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,290px),1fr))", gap: 12 }}>
                {templates.map((t) => (
                  <div key={t.id} className="wf-card" style={{ display: "grid", gap: 6, alignContent: "start" }}>
                    <span className="wf-pill" style={{ background: PLUGIN_COLOR[meta.event_info[t.event]?.plugin], justifySelf: "start" }}>{PLUGIN_NAME[meta.event_info[t.event]?.plugin]}</span>
                    <div style={{ ...text, fontWeight: 600 }}>{t.name}</div>
                    <div style={muted}>{t.about}</div>
                    <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ justifySelf: "start" }} disabled={!canEdit} onClick={() => startFrom(t)}>Use this</button>
                  </div>
                ))}
              </div>
            ) : null}
            {tab === "runs" ? <RunsTab meta={meta} workflowId={runsFor} setWorkflowId={setRunsFor} canEdit={canEdit} /> : null}
          </>
        )}
      </div>
    </div>
  );
}
