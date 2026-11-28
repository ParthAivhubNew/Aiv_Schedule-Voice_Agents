import React, { useCallback, useEffect, useState } from "react";
import { History, Plus, Power, Trash2 } from "lucide-react";
import { CardsSkeleton } from "../../../app/Loader";
import { C } from "../../../tokens";
import { api } from "../../../api/apiClient";
import { toggleLabel } from "./adminLogic";
import { askConfirm } from "../Dialogs";
import { Live, PageHead, card, field, muted, text } from "./adminUi";
import {
  EMPTY_LINE, INPUT_HELP, KEEP_HELP, LOAD_FAIL, NOTHING_TYPED, QUICK_ADDS, SAVE_FAIL, SUB, TITLE,
  addChanges, byLine, effectLine, groupRules, historyLine, removeChanges, ruleName, splitItems, summaryLine, switchChanges,
} from "./exclusionLogic";

export const EXCLUSION_CSS = `
.exc-row { display: flex; gap: 10px; align-items: center; padding: 8px 12px; border-top: 1px solid ${C.borderLight}; }
.exc-row:first-child { border-top: 0; }
.exc-row--off .exc-main { opacity: 0.6; }
.exc-main { flex: 1; min-width: 0; display: grid; gap: 2px; }
.exc-code { display: inline-block; font: 600 12px/1.3 'Inter', sans-serif; padding: 1px 7px; border-radius: 6px; background: ${C.paperSoft}; color: ${C.textInk}; overflow-wrap: anywhere; }
.exc-quick { min-height: 44px; padding: 0 12px; border-radius: 999px; border: 1px solid ${C.border}; background: ${C.surface}; font: 500 12.5px 'Inter', sans-serif; color: ${C.textInk}; cursor: pointer; }
.exc-quick:disabled { opacity: 0.5; cursor: not-allowed; }
`;

function RuleRow({ rule, busy, onToggle, onRemove }) {
  const name = ruleName(rule);
  const by = byLine(rule);
  return (
    <div className={`exc-row${rule.enabled ? "" : " exc-row--off"}`}>
      <div className="exc-main">
        <span style={{ ...text, fontSize: 13.5, color: C.textInk, overflowWrap: "anywhere" }}>
          {rule.value ? <span className="exc-code">{rule.value}</span> : null}{rule.value ? " " : ""}{rule.meaning}
          {rule.enabled ? null : <span style={{ ...muted, marginLeft: 6 }}>Switched off</span>}
        </span>
        {by || rule.label ? <span style={{ ...muted, fontSize: 12 }}>{[rule.label, by].filter(Boolean).join(" · ")}</span> : null}
      </div>
      <span className="adm-actions" role="group" aria-label={`Actions for ${name}`}>
        <button type="button" className={`adm-icon ${rule.enabled ? "adm-icon--off" : "adm-icon--on"}`} aria-label={toggleLabel(name, rule.enabled)}
          title={toggleLabel(name, rule.enabled)} disabled={busy} onClick={() => onToggle(rule)}><Power size={13} aria-hidden="true" /></button>
        <button type="button" className="adm-icon adm-icon--del" aria-label={`Delete ${name}`} title={`Delete ${name}`} disabled={busy} onClick={() => onRemove(rule)}>
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

// The drawing, apart from the loading, so each state can be shown on its own.
export function ExclusionRulesBody({ data, error, loading, draft = "", onDraft = () => {}, onAdd = () => {}, onQuick = () => {}, onToggle = () => {}, onRemove = () => {}, onCheck = () => {}, effect = "", checking = false,
  busy = false, message = "", problem = "", history = null, historyOpen = false, onHistory = () => {} }) {
  const groups = data ? groupRules(data.rules) : [];
  return (
    <div style={{ display: "grid", gap: 14, width: "100%", minWidth: 0 }}>
      <style>{EXCLUSION_CSS}</style>
      <PageHead title={TITLE} sub={SUB} />
      {error ? <div role="alert" style={{ ...text, fontSize: 13.5, color: C.red }}>{error}</div> : null}
      {loading ? <CardsSkeleton count={2} label="Loading the exclusion list" /> : null}
      {data ? (
        <>
          <section style={{ ...card, padding: 14, display: "grid", gap: 10 }} aria-label="Add to the exclusion list">
            <label htmlFor="exc-add" style={{ ...text, fontSize: 13, fontWeight: 600, color: C.textInk }}>Leave out</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input id="exc-add" value={draft} disabled={busy} placeholder="85200, church, Places of Worship, BN9" aria-describedby="exc-help"
                onChange={(e) => onDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }}
                style={{ ...field, flex: "1 1 260px", minWidth: 0 }} />
              <button type="button" className="ui-btn ui-btn--primary" style={{ minHeight: 44 }} disabled={busy || !splitItems(draft).length} onClick={() => onAdd()}>
                <Plus size={14} aria-hidden="true" /> Add
              </button>
              <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} disabled={busy || checking || !splitItems(draft).length} onClick={() => onCheck()}>
                {checking ? "Counting…" : "Check effect"}
              </button>
            </div>
            {effect ? <div role="status" style={{ ...text, fontSize: 13.5, color: C.textInk }}>{effect}</div> : null}
            <span id="exc-help" style={{ ...muted, fontSize: 12.5 }}>{INPUT_HELP} {KEEP_HELP}</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label="Common rules">
              {QUICK_ADDS.map((q) => (
                <button key={q.label} type="button" className="exc-quick" disabled={busy} onClick={() => onQuick(q.text)}>{q.label}</button>
              ))}
            </div>
          </section>

          <Live message={message} error={problem} />

          <div style={{ ...muted, display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
            <span>{summaryLine(data)}</span>
            <span>{data.rules.length} of {data.max} rules used</span>
          </div>
          {groups.length === 0 ? <div style={muted}>{EMPTY_LINE}</div> : null}
          {groups.map((g) => (
            <section key={g.title} style={card} aria-label={g.title}>
              <div style={{ ...text, padding: "10px 12px 4px", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: C.slate }}>{g.title} <span>{g.rules.length}</span></div>
              {g.rules.map((r) => <RuleRow key={r.id} rule={r} busy={busy} onToggle={onToggle} onRemove={onRemove} />)}
            </section>
          ))}

          <div>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-expanded={historyOpen} aria-controls="exc-history" style={{ minHeight: 44 }} onClick={onHistory}>
              <History size={14} aria-hidden="true" /> Recent changes
            </button>
            {historyOpen ? (
              <ul id="exc-history" style={{ ...muted, margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
                {history === null ? <li>Loading…</li> : history.length === 0 ? <li>No changes yet.</li> : history.map((h) => <li key={h.id}>{historyLine(h)}</li>)}
              </ul>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function ExclusionRules() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [effect, setEffect] = useState("");
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.getExclusions()); setError(""); } catch (e) { setError(e.message || LOAD_FAIL); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const loadHistory = useCallback(async () => {
    try { setHistory((await api.getExclusionHistory()).changes || []); } catch { setHistory([]); }
  }, []);

  // One short question, then the change. Counting the register is only done when the admin asks for it (Check effect).
  const change = async ({ title, lines, send, done }) => {
    setMessage(""); setProblem(""); setBusy(true);
    try {
      const body = lines.map((l) => `- ${l}`).join("\n");
      const sure = await askConfirm({ title, body, confirm: "Yes, make the change", cancel: "Cancel" });
      if (!sure) return;
      await send();
      setMessage(done);
      await load();
      if (historyOpen) loadHistory();
    } catch (e) {
      setProblem(e.message || SAVE_FAIL);
    } finally {
      setBusy(false);
    }
  };

  const add = (text_ = draft) => {
    const items = splitItems(text_);
    if (!items.length) { setProblem(NOTHING_TYPED); return Promise.resolve(); }
    return change({
      title: "Add to your organisation's exclusion list?", lines: addChanges(items),
      send: async () => { await api.addExclusions({ items }); setDraft(""); setEffect(""); }, done: "Added. It applies to everyone in your organisation now.",
    });
  };
  const toggle = (rule) => change({
    title: `${rule.enabled ? "Switch off" : "Switch on"} this rule?`, lines: switchChanges(rule, !rule.enabled),
    send: () => api.changeExclusion(rule.id, { enabled: !rule.enabled, updated_at: rule.updatedAt }), done: rule.enabled ? "Switched off." : "Switched on.",
  });
  const remove = (rule) => change({
    title: "Delete this rule?", lines: removeChanges(rule),
    send: () => api.removeExclusion(rule.id), done: "Deleted.",
  });
  // What the typed rules would leave out, counted only when asked. A rule that can't be used is named here, before anything is saved.
  const check = async () => {
    const items = splitItems(draft);
    if (!items.length) { setProblem(NOTHING_TYPED); return; }
    setChecking(true); setProblem(""); setEffect("");
    try {
      const p = await api.previewExclusions({ add_items: items });
      setEffect(effectLine(p) || "Counting took too long. The rules will still apply when you add them.");
    } catch (e) {
      setProblem(e.message || SAVE_FAIL);
    } finally {
      setChecking(false);
    }
  };
  const toggleHistory = () => { const next = !historyOpen; setHistoryOpen(next); if (next) loadHistory(); };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <ExclusionRulesBody data={data} error={error} loading={!data && !error} draft={draft} onDraft={(v) => { setDraft(v); setProblem(""); setEffect(""); }} onAdd={add} onCheck={check} effect={effect} checking={checking}
        onQuick={(t) => add(t)} onToggle={toggle} onRemove={remove} busy={busy} message={message} problem={problem}
        history={history} historyOpen={historyOpen} onHistory={toggleHistory} />
      {error && !data ? <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44 }} onClick={load}>Try again</button> : null}
    </div>
  );
}
