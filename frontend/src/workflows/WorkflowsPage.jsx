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
.wf{position:fixed;inset:0;z-index:120;background:var(--ui-bg,#F5F6F8);overflow-y:auto;font-family:${FONT_BODY};color:var(--ui-ink,#111827)}
.wf-top{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:10px;min-height:56px;padding:8px clamp(12px,4vw,32px);background:var(--ui-surface,#fff);border-bottom:1px solid var(--ui-line,#E3E6EB)}
.wf-top h1{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wf-main{width:100%;max-width:1120px;margin:0 auto;box-sizing:border-box;padding:20px 24px 72px;display:grid;gap:16px;align-content:start}
.wf-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
.wf-tabs{display:flex;gap:2px;border-bottom:1px solid var(--ui-line,#E3E6EB);flex:1 1 auto;min-width:0}
.wf-tab{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;min-height:44px;padding:0 14px;font-size:14px;font-weight:600;color:var(--ui-muted,#6B7280);border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
.wf-tab[aria-selected="true"]{color:var(--ui-ink,#111827);border-bottom-color:var(--ui-accent,#3457D5)}
.wf-tab:focus-visible,.wf-link:focus-visible,.wf-pick:focus-visible,.wf-run-toggle:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:2px}
.wf-card{background:var(--ui-surface,#fff);border:1px solid var(--ui-line,#E3E6EB);border-radius:10px;padding:16px 18px;box-shadow:var(--ui-shadow)}
.wf-link{all:unset;cursor:pointer;color:var(--ui-accent,#3457D5);font-size:13px;font-weight:600;border-radius:4px}
.wf-link:hover{text-decoration:underline;text-underline-offset:3px}
.wf-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.wf-item{display:grid;gap:12px}
.wf-head{display:flex;align-items:flex-start;gap:12px}
.wf-title{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;padding-top:1px}
.wf-title h3{margin:0;font-size:15px;font-weight:600;line-height:1.35;overflow-wrap:anywhere}
.wf-plug{font-size:12.5px;font-weight:600}
.wf-plug--voice{color:#26409E}.wf-plug--leads{color:#6B3FC9}.wf-plug--social{color:#0A6F63}
.wf-off{font-size:12.5px;font-weight:600;color:var(--ui-muted,#6B7280)}
.wf-flow{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px 0}
.wf-flow li{display:flex;align-items:center;min-width:0;max-width:100%}
.wf-flow li+li::before{content:"\\203A";color:var(--ui-faint,#9CA3AF);margin:0 7px;font-size:15px;line-height:1}
.wf-step{font-size:13px;line-height:1.35;padding:5px 10px;border-radius:6px;background:var(--ui-hover,#F0F2F5);color:var(--ui-ink,#111827);overflow-wrap:anywhere}
.wf-step--trigger{background:var(--ui-accent-soft,#EEF2FE);color:var(--ui-accent-ink,#26409E);font-weight:600}
.wf-step--cond{background:transparent;border:1px dashed var(--ui-line-strong,#CBD1D9)}
.wf-item[data-off="true"] .wf-flow{opacity:.65}
.wf-foot{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding-top:12px;border-top:1px solid var(--ui-line-soft,#EDEFF2)}
.wf-stats{flex:1 1 220px;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:2px 14px;font-size:13px;color:var(--ui-muted,#6B7280)}
.wf-stat--bad{color:var(--ui-bad,#B4390A);font-weight:600}
.wf-stat--wait{color:#8A5A06;font-weight:600}
.wf-actions{display:flex;align-items:center;gap:6px;flex:none}
.wf-switch{appearance:none;-webkit-appearance:none;flex:none;width:40px;height:24px;border-radius:999px;background:#9CA3AF;position:relative;cursor:pointer;margin:0;transition:background .15s}
.wf-switch::before{content:"";position:absolute;inset:-10px -4px}
.wf-switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s}
.wf-switch:checked{background:var(--ui-accent,#3457D5)}
.wf-switch:checked::after{transform:translateX(16px)}
.wf-switch:disabled{opacity:.5;cursor:default}
.wf-switch:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:2px}
.wf-group{display:grid;gap:8px}
.wf-group h2{margin:10px 0 0;font-size:13px;font-weight:700;color:var(--ui-ink-2,#374151)}
.wf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr));gap:12px}
.wf-event{background:var(--ui-surface,#fff);border:1px solid var(--ui-line,#E3E6EB);border-radius:10px;display:grid;align-content:start;gap:6px;padding-bottom:12px}
.wf-event:hover,.wf-event:focus-within{border-color:var(--ui-accent,#3457D5)}
.wf-pick{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:10px;padding:14px 16px 4px;min-height:44px}
.wf-pick:disabled{cursor:default}
.wf-ex{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:4px 16px 0;font-size:13px;color:var(--ui-muted,#6B7280)}
.wf-ex .wf-link{display:inline-flex;align-items:center;min-height:32px;padding:0 10px;border:1px solid var(--ui-line,#E3E6EB);border-radius:6px;background:var(--ui-sunken,#F8F9FB)}
.wf-run{display:grid;gap:10px}
.wf-run-head{display:flex;flex-wrap:wrap;align-items:flex-start;gap:8px 12px}
.wf-run-toggle{all:unset;box-sizing:border-box;cursor:pointer;flex:1 1 220px;min-width:0;display:flex;gap:8px;align-items:flex-start;border-radius:6px}
.wf-run-side{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.wf-run-toggle svg{flex:none;margin-top:3px}
.wf-status{flex:none;font-size:12.5px;font-weight:600;padding:3px 9px;border-radius:999px;background:var(--ui-hover,#F0F2F5);color:var(--ui-ink-2,#374151)}
.wf-status--done{background:#E7F5EB;color:#14602F}.wf-status--failed{background:var(--ui-bad-soft,#FBE9E6);color:var(--ui-bad,#B4390A)}
.wf-status--waiting{background:#FCEFDA;color:#7A4E05}.wf-status--running{background:var(--ui-accent-soft,#EEF2FE);color:var(--ui-accent-ink,#26409E)}
.wf-log{margin:0;padding:10px 0 0 0;list-style:none;display:grid;gap:6px;border-top:1px solid var(--ui-line-soft,#EDEFF2)}
.wf-empty{display:grid;gap:8px;justify-items:start;padding:22px}
@media (max-width:820px){
  .wf-main{padding:14px 12px 88px}
  .wf-card{padding:14px}
  .wf-tabs{flex-basis:100%}
  .wf-bar .ui-input{flex:1 1 160px}
  .wf .ui-btn--sm{min-height:44px;padding:0 14px}
  .wf-actions{width:100%}
  .wf-actions .wf-edit{flex:1}
  .wf-actions .ui-btn--ghost{width:44px;padding:0}
  .wf-stats{flex-basis:100%}
  .wf-flow{flex-direction:column;align-items:stretch;gap:0}
  .wf-flow li{flex-direction:column;align-items:flex-start}
  .wf-flow li+li::before{content:"";width:1px;height:10px;margin:0 0 0 16px;background:var(--ui-line-strong,#CBD1D9)}
  .wf-run-toggle{flex-basis:100%}
  .wf-run-side{padding-left:24px}
  .wf-ex .wf-link{min-height:40px}
  .wf-pick{padding-top:12px}
}
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
    <ol className="wf-flow" aria-label="What this workflow does">
      <li><span className="wf-step wf-step--trigger">{trigger}</span></li>
      {(w.conditions || []).map((c, i) => <li key={`c${i}`}><span className="wf-step wf-step--cond">Only if {conditionText(c, meta).toLowerCase()}</span></li>)}
      {(w.do || []).map((b, i) => <li key={i}><span className="wf-step">{chipText(b, meta)}</span></li>)}
    </ol>
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
      <div className="wf-bar">
        <Select label="Workflow" value={workflowId} onChange={setWorkflowId}><option value="">All workflows</option>{meta.workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
        <Select label="Status" value={status} onChange={setStatus}><option value="">Any status</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
      </div>
      {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
      {!runs ? <Loader compact label="Loading" /> : !runs.length ? (
        <div className="wf-card" style={muted}>{meta.workflows.length ? "Nothing has run yet. Each time a workflow starts, it shows up here with what every step did, and why one was skipped." : "Nothing has run yet, and there are no workflows. Create one and its runs will show up here."}</div>
      ) : runs.map((r) => (
        <div key={r.id} className="wf-card wf-run">
          <div className="wf-run-head">
            <button type="button" className="wf-run-toggle" aria-expanded={open === r.id} aria-label={`${open === r.id ? "Hide" : "Show"} what ${r.workflow_name} did`} onClick={() => setOpen(open === r.id ? "" : r.id)}>
              {open === r.id ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
              <span style={{ minWidth: 0 }}>
                <span style={{ ...text, fontWeight: 600, display: "block", overflowWrap: "anywhere" }}>{r.workflow_name}{r.lead_name ? <span style={{ ...muted, fontWeight: 400 }}> · {r.lead_name}</span> : null}</span>
                <span style={{ ...muted, display: "block" }}>{meta.events[r.event] || r.event} · {when(r.created_at)}{r.status === "waiting" && r.resume_at ? ` · carries on ${new Date(r.resume_at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</span>
              </span>
            </button>
            <div className="wf-run-side">
            <span className={`wf-status wf-status--${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span>
            {canEdit && r.status === "failed" ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => act(() => api.retryWorkflowRun(r.id), "Trying it again.")}><RotateCcw size={13} /> Try again</button> : null}
            {canEdit && (r.status === "waiting" || r.status === "failed") ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => act(() => api.cancelWorkflowRun(r.id), "Stopped.")}><Square size={12} /> Stop</button> : null}
            </div>
          </div>
          {open === r.id ? (
            r.log.length ? (
              <ol className="wf-log">
                {r.log.map((l, i) => <li key={i} style={{ display: "flex", gap: 8, ...text, fontSize: 13 }}>{l.ok === false ? <X size={14} color={C.red} aria-label="failed" style={{ marginTop: 2, flex: "none" }} /> : l.label === "Skipped" ? <Square size={11} color={C.slate} aria-label="skipped" style={{ marginTop: 4, flex: "none" }} /> : <Check size={14} color={C.green} aria-label="ok" style={{ marginTop: 2, flex: "none" }} />}<span style={{ minWidth: 0, overflowWrap: "anywhere" }}><strong>{l.label}</strong> <span style={{ color: C.slate }}>{l.result}</span></span></li>)}
              </ol>
            ) : <div className="wf-log" style={muted}>No steps have run yet.</div>
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
  const newButton = <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" aria-label="New workflow" onClick={() => setMode("start")}><Plus size={14} aria-hidden="true" /> New<span className="hide-mobile">workflow</span></button>;
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
          {!inFlow && canEdit && meta && shown.length ? newButton : null /* an empty page has one create button, in its card */}
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
            <div className="wf-bar">
              <div className="wf-tabs" role="tablist">
                {[["workflows", `Workflows${meta.workflows.length ? ` (${meta.workflows.length})` : ""}`], ["activity", "Activity"]].map(([k, label]) => <button key={k} type="button" role="tab" className="wf-tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}
              </div>
              {top && canEdit && meta.workflows.length ? newButton : null}
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
                const plug = meta.event_info[w.event]?.plugin;
                return (
                  <article key={w.id} className="wf-card wf-item" data-off={!w.enabled}>
                    <div className="wf-head">
                      <input type="checkbox" role="switch" className="wf-switch" checked={w.enabled} disabled={!canEdit || busyId === w.id} aria-label={`Turn ${w.name} ${w.enabled ? "off" : "on"}`} onChange={(e) => flip({ enabled: e.target.checked })} />
                      <div className="wf-title">
                        <h3>{w.name}</h3>
                        <span className={`wf-plug wf-plug--${plug}`}>{PLUGIN_NAME[plug]}</span>
                        {w.enabled ? null : <span className="wf-off">Off</span>}
                      </div>
                    </div>
                    <FlowChips w={w} meta={meta} />
                    <div className="wf-foot">
                      <div className="wf-stats">
                        {st.runs ? <span>Ran {st.runs} time{st.runs === 1 ? "" : "s"}, last {when(st.last)}</span> : <span>Has not run yet</span>}
                        {st.waiting ? <span className="wf-stat--wait">{st.waiting} waiting</span> : null}
                        {st.failed ? <span className="wf-stat--bad">{st.failed} failed</span> : null}
                        {st.skipped ? <span>{st.skipped} skipped</span> : null}
                        {st.runs || st.skipped ? <button type="button" className="wf-link" onClick={() => { setRunsFor(w.id); setTab("activity"); }}>See activity</button> : null}
                      </div>
                      {canEdit && askDelete !== w.id ? (
                        <div className="wf-actions">
                          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm wf-edit" aria-label={`Edit ${w.name}`} onClick={() => { setEditing({ id: w.id, workflow: JSON.parse(JSON.stringify(strip(w))) }); setMode("edit"); }}>Edit</button>
                          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label={`Delete ${w.name}`} onClick={() => setAskDelete(w.id)}><Trash2 size={15} /></button>
                        </div>
                      ) : null}
                      {canEdit && askDelete === w.id ? (
                        <div className="wf-actions wf-row" role="group" aria-label={`Delete ${w.name}?`}>
                          <span style={muted}>Delete{st.waiting ? ` and stop ${st.waiting} waiting` : ""}?</span>
                          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busyId === w.id} onClick={() => act(w.id, (list) => list.filter((x) => x.id !== w.id), `${w.name} deleted.`)}>Delete</button>
                          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setAskDelete("")}>Keep</button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              }) : (
                <div className="wf-card wf-empty">
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
