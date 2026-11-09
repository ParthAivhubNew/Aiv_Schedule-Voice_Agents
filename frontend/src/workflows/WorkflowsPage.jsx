import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Plus, RotateCcw, Square, Trash2, Workflow, X } from "lucide-react";
import { api } from "../api/apiClient";
import { Loader } from "../app/Loader";
import { C, FONT_BODY } from "../tokens";
import { PLUGIN_NAME, STATUS_LABEL, blankWorkflow, chipText, conditionText, when } from "./workflowModel";
import { setWorkflowsOpen } from "./openWorkflows";
import { useFlash } from "../components/useFlash";
import { failText } from "../components/flash";
import { Select, WorkflowEditor, editorCss } from "./WorkflowEditor";

// Workflows: "when this happens, do that", for the whole company. Opened from the hub or from a plugin's sidebar; it is one page, so a workflow can
// use Leads, Voice and Social together and nothing is kept per plugin.
//
// Three screens: the list of workflows, the activity (every run, step by step), and the editor. Starting a new workflow begins by choosing what
// triggers it; the ready-made examples for that trigger sit under it there, not on the main screen.

const css = `
.wf{position:fixed;inset:0;z-index:120;background:var(--ui-paper,#F6F7F9);overflow-y:auto;font-family:${FONT_BODY};color:#12141C}
.wf-top{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:12px;padding:12px clamp(16px,4vw,32px);background:#fff;border-bottom:1px solid #E3E6EB}
.wf-main{width:100%;box-sizing:border-box;padding:20px 24px 64px;display:grid;gap:16px;align-content:start}
@media (max-width:820px){.wf-main{padding:16px 16px 56px}}
.wf-tabs{display:flex;gap:4px;border-bottom:1px solid #E3E6EB}
.wf-tab{all:unset;cursor:pointer;padding:9px 14px;font-size:14px;font-weight:600;color:#6B7280;border-bottom:2px solid transparent;margin-bottom:-1px}
.wf-tab[aria-selected="true"]{color:#12141C;border-bottom-color:#12141C}
.wf-tab:focus-visible,.wf-link:focus-visible,.wf-pick:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:2px}
.wf-card{background:#fff;border:1px solid #E3E6EB;border-radius:10px;padding:16px 18px}
.wf-link{all:unset;cursor:pointer;color:#3457D5;font-size:13px;font-weight:600}
.wf-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.wf-flow{display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-top:6px}
.wf-step{font-size:13px;padding:3px 9px;border-radius:6px;background:#EEF0F4;color:#12141C}
.wf-step--trigger{background:#EEF2FE;color:#26409E;font-weight:600}
.wf-group{display:grid;gap:6px}
.wf-group h2{margin:8px 0 0;font-size:13px;font-weight:700;color:#12141C}
.wf-switch{appearance:none;-webkit-appearance:none;flex:none;width:34px;height:20px;border-radius:999px;background:#C5CAD3;position:relative;cursor:pointer;margin:2px 0 0;transition:background .15s}
.wf-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
.wf-switch:checked{background:#3457D5}
.wf-switch:checked::after{transform:translateX(14px)}
.wf-switch:disabled{opacity:.5;cursor:default}
.wf-switch:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:2px}
.wf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr));gap:12px}
.wf-event{background:#fff;border:1px solid #E3E6EB;border-radius:10px;display:grid;align-content:start;gap:8px;padding-bottom:12px}
.wf-event:hover{border-color:#3457D5}
.wf-pick{all:unset;cursor:pointer;display:flex;align-items:center;gap:10px;padding:14px 18px 4px}
.wf-ex{display:flex;gap:6px 12px;flex-wrap:wrap;align-items:center;padding:0 18px;font-size:13px;color:#6B7280}
@media (prefers-reduced-motion:reduce){.wf *{transition:none!important;animation:none!important}}
${editorCss}
`;

const text = { fontFamily: FONT_BODY, fontSize: 14, color: C.ink };
const muted = { fontFamily: FONT_BODY, fontSize: 13, color: C.slate };

// The steps of a workflow as small chips, trigger first, so a row reads left to right the way it runs.
function FlowChips({ w, meta }) {
  const info = meta.event_info[w.event];
  const trigger = `${info ? info.hint : w.event}${w.when?.outcome ? `: ${w.when.outcome.replace(/_/g, " ")}` : ""}`;
  return (
    <div className="wf-flow" aria-label="What this workflow does">
      <span className="wf-step wf-step--trigger">{trigger}</span>
      {(w.conditions || []).map((c, i) => <span key={`c${i}`} className="wf-step">Only if {conditionText(c, meta).toLowerCase()}</span>)}
      {(w.do || []).map((b, i) => <React.Fragment key={i}><ChevronRight size={12} color="#9AA1AD" aria-hidden="true" /><span className="wf-step">{chipText(b, meta)}</span></React.Fragment>)}
    </div>
  );
}

// ── Activity ────────────────────────────────────────────────────────────────
function Activity({ meta, workflowId, setWorkflowId, canEdit, flash }) {
  const [runs, setRuns] = useState(null);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => api.workflowRuns(workflowId, status).then((r) => { setRuns(r.runs); setError(""); }).catch((e) => setError(e.message || "Could not load the activity.")), [workflowId, status]);
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);
  const act = async (fn, done) => { try { await fn(); await load(); flash(done); } catch (e) { flash(failText(e, "That did not work."), true); } };
  const tone = { done: C.green, failed: C.red, waiting: C.amber, stopped: C.slate, skipped: C.slate, running: C.cobalt };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="wf-row">
        <Select label="Workflow" value={workflowId} onChange={setWorkflowId}><option value="">All workflows</option>{meta.workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
        <Select label="Status" value={status} onChange={setStatus}><option value="">Any status</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
      </div>
      {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
      {!runs ? <Loader compact label="Loading" /> : !runs.length ? (
        <div className="wf-card" style={muted}>{meta.workflows.length ? "Nothing has run yet. Each time a workflow starts, it shows up here with what every step did, and why one was skipped." : "Nothing has run yet, and there are no workflows. Create one and its runs will show up here."}</div>
      ) : runs.map((r) => (
        <div key={r.id} className="wf-card">
          <div className="wf-row">
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-expanded={open === r.id} aria-label={`${open === r.id ? "Hide" : "Show"} what ${r.workflow_name} did`} onClick={() => setOpen(open === r.id ? "" : r.id)}>{open === r.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ ...text, fontWeight: 600 }}>{r.workflow_name}{r.lead_name ? <span style={{ ...muted, fontWeight: 400 }}> · {r.lead_name}</span> : null}</div>
              <div style={muted}>{meta.events[r.event] || r.event} · {when(r.created_at)}{r.status === "waiting" && r.resume_at ? ` · carries on ${new Date(r.resume_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</div>
            </div>
            <span style={{ ...muted, fontWeight: 700, color: tone[r.status] }}>{STATUS_LABEL[r.status] || r.status}</span>
            {canEdit && r.status === "failed" ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => act(() => api.retryWorkflowRun(r.id), "Trying it again.")}><RotateCcw size={13} /> Try again</button> : null}
            {canEdit && (r.status === "waiting" || r.status === "failed") ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => act(() => api.cancelWorkflowRun(r.id), "Stopped.")}><Square size={12} /> Stop</button> : null}
          </div>
          {open === r.id ? (
            <ol style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
              {r.log.map((l, i) => <li key={i} style={{ display: "flex", gap: 8, ...text, fontSize: 12.5 }}>{l.ok === false ? <X size={13} color={C.red} aria-label="failed" style={{ marginTop: 2 }} /> : l.label === "Skipped" ? <Square size={11} color={C.slate} aria-label="skipped" style={{ marginTop: 3 }} /> : <Check size={13} color={C.green} aria-label="ok" style={{ marginTop: 2 }} />}<span><strong>{l.label}</strong> <span style={{ color: C.slate }}>{l.result}</span></span></li>)}
            </ol>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ── Starting a new one: choose what triggers it ─────────────────────────────
function Start({ meta, first, canEdit, onPick, onTemplate }) {
  const order = [first, ...["voice", "leads", "social"].filter((p) => p !== first)].filter(Boolean); // the plugin the person came from first, all of them listed
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>What should start it?</h2>
        <div style={muted}>Pick the event. You choose the steps next, or start from an example under it.</div>
      </div>
      {order.map((p) => (
        <div key={p} className="wf-group">
          <h2>{PLUGIN_NAME[p]}</h2>
          <div className="wf-grid">
          {Object.entries(meta.event_info).filter(([, v]) => v.plugin === p).map(([k, v]) => {
            const examples = meta.templates.filter((t) => t.event === k);
            return (
              <div key={k} className="wf-event">
                <button type="button" className="wf-pick" disabled={!canEdit} onClick={() => onPick(k)}>
                  <span style={{ flex: 1 }}><span style={{ ...text, fontWeight: 600, display: "block" }}>{v.label}</span><span style={muted}>{v.hint}</span></span>
                  <ChevronRight size={14} aria-hidden="true" color="#9AA1AD" />
                </button>
                {examples.length ? (
                  <div className="wf-ex"><span>Examples:</span>{examples.map((t) => <button key={t.id} type="button" className="wf-link" disabled={!canEdit} title={t.about} onClick={() => onTemplate(t)}>{t.name}</button>)}</div>
                ) : null}
              </div>
            );
          })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── The page ────────────────────────────────────────────────────────────────
export function WorkflowsPage({ context, onClose, canEdit = true }) {
  const [meta, setMeta] = useState(null);
  const [tab, setTab] = useState("workflows");
  const [plugin, setPlugin] = useState("");
  const [mode, setMode] = useState("list"); // list | start | edit
  const [editing, setEditing] = useState(null);
  const [runsFor, setRunsFor] = useState("");
  const [error, setError] = useState("");
  const [toast, flash] = useFlash();
  const heading = useRef(null);
  const mainRef = useRef(null);
  const focusTop = () => (heading.current || mainRef.current)?.focus();
  const load = useCallback(() => api.getWorkflows().then(setMeta).catch((e) => setError(e.message || "Could not load your workflows.")), []);
  useEffect(() => { load(); focusTop(); }, [load]);
  const inFlow = mode !== "list";
  const back = () => { setMode("list"); setEditing(null); setError(""); };
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !e.defaultPrevented) (inFlow ? back : onClose)(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inFlow, onClose]);
  useEffect(() => { focusTop(); }, [mode]);

  // The plugin's own menu stays visible and usable: the page starts where the menu ends, and choosing a menu item closes the page.
  useEffect(() => { setWorkflowsOpen(true); return () => setWorkflowsOpen(false); }, []);
  const [left, setLeft] = useState(0);
  const [top, setTop] = useState(0); // where the app's own top bar ends; 0 when the app has none (the home screen)
  useEffect(() => {
    const side = document.querySelector(".app-sidebar");
    const bar = () => document.querySelector("[data-wf-anchor]");
    const measure = () => {
      setLeft(side && window.innerWidth > 820 ? Math.max(0, Math.round(side.getBoundingClientRect().right)) : 0); // on a phone the menu slides over the page
      setTop(bar() ? Math.round(bar().getBoundingClientRect().bottom) : 0);
    };
    measure();
    const ro = typeof ResizeObserver === "function" && side ? new ResizeObserver(measure) : null;
    if (side) ro?.observe(side);
    if (bar()) ro?.observe(bar());
    window.addEventListener("resize", measure);
    const onPick = (e) => {
      const item = e.target.closest?.(".app-sidebar button, .app-sidebar a, .app-sidebar [role='button']");
      if (!item || item.classList.contains("sidebar-toggle")) return;
      const label = `${item.textContent} ${item.getAttribute("title") || ""} ${item.getAttribute("aria-label") || ""}`;
      if (!/workflows/i.test(label)) onClose();
    };
    document.addEventListener("click", onPick, true);
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure); document.removeEventListener("click", onPick, true); };
  }, [onClose]);

  const strip = (w) => { const { stats, ...rest } = w; return rest; };
  // Every change starts from what the server holds now and is applied by id, so two quick changes or a second tab cannot overwrite each other.
  const persist = async (change) => {
    const fresh = (await api.getWorkflows()).workflows.map(strip);
    await api.saveWorkflows(change(fresh));
    await load();
  };
  const [busyId, setBusyId] = useState("");
  const [askDelete, setAskDelete] = useState("");
  const act = async (id, change, done) => {
    setBusyId(id); setError("");
    try { await persist(change); flash(done); } catch (e) { flash(failText(e, "That did not save."), true); }
    setBusyId(""); setAskDelete("");
  };
  const shown = useMemo(() => (meta ? meta.workflows.filter((w) => !plugin || meta.event_info[w.event]?.plugin === plugin) : []), [meta, plugin]);
  const fromTemplate = (t) => ({ ...blankWorkflow(t.event), name: t.name, when: t.when || {}, do: JSON.parse(JSON.stringify(t.do)) });
  const editNew = (workflow) => { setEditing({ id: "", workflow }); setMode("edit"); };
  const newButton = <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => setMode("start")}><Plus size={14} /> New workflow</button>;
  const title = mode === "start" ? "New workflow" : mode === "edit" ? (editing?.id ? "Edit workflow" : "New workflow") : "Workflows";

  return (
    <div className="wf" role="dialog" aria-modal="false" aria-label="Workflows" style={{ left, top }}>
      <style>{css}</style>
      {top ? null : (
        <div className="wf-top">
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={inFlow ? back : onClose} aria-label={inFlow ? "Back to your workflows" : "Back"}><ArrowLeft size={14} aria-hidden="true" /> Back</button>
          <Workflow size={18} aria-hidden="true" />
          <h1 ref={heading} tabIndex={-1} style={{ margin: 0, fontSize: 17, fontWeight: 600, outline: "none" }}>{title}</h1>
          <span style={{ ...muted, flex: 1 }} className="hide-mobile">{inFlow ? "" : "When something happens in Leads, Voice or Social, do something automatically."}</span>
          {!inFlow && canEdit && meta ? newButton : null}
        </div>
      )}
      <div className="wf-main" ref={mainRef} tabIndex={-1} style={{ outline: "none" }}>
        {top && inFlow ? (
          <div className="wf-row">
            <button type="button" className="wf-link" onClick={back}>Workflows</button><ChevronRight size={12} color="#9AA1AD" aria-hidden="true" />
            <span style={{ ...text, fontWeight: 600 }}>{title}</span>
          </div>
        ) : null}
        {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
        {!meta ? <Loader compact label="Loading" /> : mode === "start" ? (
          <Start meta={meta} first={context?.from} canEdit={canEdit} onPick={(event) => editNew(blankWorkflow(event))} onTemplate={(t) => editNew(fromTemplate(t))} />
        ) : mode === "edit" ? (
          <WorkflowEditor meta={meta} initial={editing.workflow} canEdit={canEdit} onCancel={back}
            onSave={async (w) => { await persist((list) => (editing.id ? list.map((x) => (x.id === editing.id ? w : x)) : [...list, w])); back(); setTab("workflows"); flash(`${w.name || "Workflow"} saved.`); }} />
        ) : (
          <>
            <div className="wf-row" style={{ justifyContent: "space-between" }}>
              <div className="wf-tabs" role="tablist" style={{ flex: 1 }}>
                {[["workflows", `Workflows${meta.workflows.length ? ` (${meta.workflows.length})` : ""}`], ["activity", "Activity"]].map(([k, label]) => <button key={k} type="button" role="tab" className="wf-tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}
              </div>
              {top && canEdit ? newButton : null}
              {tab === "workflows" && meta.workflows.length ? (
                <Select label="Show workflows from" value={plugin} onChange={setPlugin}>
                  <option value="">All plugins</option>{["voice", "leads", "social"].map((p) => <option key={p} value={p}>{PLUGIN_NAME[p]}</option>)}
                </Select>
              ) : null}
            </div>

            {tab === "workflows" ? (
              shown.length ? shown.map((w) => {
                const st = w.stats || {};
                const flip = (patch) => act(w.id, (list) => list.map((x) => (x.id === w.id ? { ...x, ...patch } : x)), `${w.name} is ${patch.enabled ? "on" : "off"}.`);
                return (
                  <div key={w.id} className="wf-card wf-row" style={{ alignItems: "flex-start" }}>
                    <input type="checkbox" role="switch" className="wf-switch" checked={w.enabled} disabled={!canEdit || busyId === w.id} aria-label={`Turn ${w.name} ${w.enabled ? "off" : "on"}`} onChange={(e) => flip({ enabled: e.target.checked })} />
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ ...text, fontWeight: 600 }}>{w.name} <span style={{ ...muted, fontWeight: 400 }}>· {PLUGIN_NAME[meta.event_info[w.event]?.plugin]}{w.enabled ? "" : " · off"}</span></div>
                      <FlowChips w={w} meta={meta} />
                      <div style={{ ...muted, marginTop: 6 }}>
                        {st.runs ? <>Ran {st.runs} time{st.runs === 1 ? "" : "s"}, last {when(st.last)}</> : "Has not run yet"}
                        {st.waiting ? ` · ${st.waiting} waiting` : ""}{st.failed ? <span style={{ color: C.red }}> · {st.failed} failed</span> : null}{st.skipped ? ` · ${st.skipped} skipped` : ""}
                        {st.runs || st.skipped ? <>{" · "}<button type="button" className="wf-link" onClick={() => { setRunsFor(w.id); setTab("activity"); }}>See activity</button></> : null}
                      </div>
                    </div>
                    {canEdit ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" aria-label={`Edit ${w.name}`} onClick={() => { setEditing({ id: w.id, workflow: JSON.parse(JSON.stringify(strip(w))) }); setMode("edit"); }}>Edit</button> : null}
                    {canEdit && askDelete !== w.id ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label={`Delete ${w.name}`} onClick={() => setAskDelete(w.id)}><Trash2 size={13} /></button> : null}
                    {canEdit && askDelete === w.id ? (
                      <span className="wf-row" role="group" aria-label={`Delete ${w.name}?`}>
                        <span style={muted}>Delete{st.waiting ? ` and stop ${st.waiting} waiting` : ""}?</span>
                        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busyId === w.id} onClick={() => act(w.id, (list) => list.filter((x) => x.id !== w.id), `${w.name} deleted.`)}>Delete</button>
                        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setAskDelete("")}>Keep</button>
                      </span>
                    ) : null}
                  </div>
                );
              }) : (
                <div className="wf-card" style={{ display: "grid", gap: 8, justifyItems: "start", padding: 20 }}>
                  <div style={{ ...text, fontWeight: 600, fontSize: 15 }}>{meta.workflows.length ? `No ${PLUGIN_NAME[plugin] || ""} workflows yet.` : "No workflows yet."}</div>
                  <div style={muted}>A workflow watches for one event, such as a call ending or a reply arriving, and then does the steps you set: move the lead, add a note, plan a follow-up, send an email. It does nothing until it is saved and switched on.</div>
                  {canEdit ? <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={() => setMode("start")}><Plus size={14} /> Create a workflow</button> : <div style={muted}>Only people who can edit company settings can create one.</div>}
                </div>
              )
            ) : <Activity meta={meta} workflowId={runsFor} setWorkflowId={setRunsFor} canEdit={canEdit} flash={flash} />}
          </>
        )}
      </div>
      {toast}
    </div>
  );
}
