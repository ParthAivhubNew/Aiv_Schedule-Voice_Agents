import React, { useMemo, useRef, useState } from "react";
import { Download, ShieldCheck, X } from "lucide-react";
import { api } from "../../../api/apiClient";
import { C } from "../../../tokens";
import {
  CHECK_COLUMNS, CHUNK, MATCH, STATUS, STATUS_ORDER, applyResults, chunks, countByStatus, downloadCsv, filterRows,
  hasChecks, itemsFor, statusOf, toCsv,
} from "./numberCheck";

const TONES = {
  ok: { color: "#176B3F", bg: "#E3F4EA" },
  warn: { color: "#8A5A00", bg: "#FFF1D2" },
  bad: { color: "var(--ui-bad)", bg: "var(--ui-bad-soft)" },
  mute: { color: "#5B6573", bg: "#EEF0F3" },
};

export function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.not_checked;
  const t = TONES[s.tone];
  return (
    <span title={s.hint} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 99, fontSize: 12, fontWeight: 500, color: t.color, background: t.bg, whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: t.color }} />
      {s.label}
    </span>
  );
}

function Dialog({ title, onClose, children, footer }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", background: "rgba(18,20,28,0.35)", padding: 16 }} onClick={onClose}>
      <div className="ui-card" onClick={(e) => e.stopPropagation()} style={{ width: "min(100%, 460px)", maxHeight: "86vh", overflow: "auto", background: "#fff", padding: 20, boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: C.textInk, flex: 1 }}>{title}</div>
          <button type="button" className="ui-icon-btn ui-icon-btn--sm" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>
        {children}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>{footer}</div>
      </div>
    </div>
  );
}

const Line = ({ label, value, strong }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", fontSize: 13, color: strong ? C.textInk : C.slate, fontWeight: strong ? 600 : 400 }}>
    <span>{label}</span>
    <span style={{ fontVariantNumeric: "tabular-nums", color: C.textInk }}>{value}</span>
  </div>
);

// The strip above the list: check numbers (selected rows, or the whole list), filter by result,
// and export whatever you like. All results live on the rows themselves.
export function NumberCheckBar({ rows, setRows, selectedIds, setSelectedIds, phoneOf, filter, setFilter, baseColumns, showToast, fileName }) {
  const [dialog, setDialog] = useState("");
  const [est, setEst] = useState(null);
  const [chosen, setChosen] = useState([]); // the rows this check was opened for
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const stop = useRef(false);

  const [scope, setScope] = useState("all");
  const [picked, setPicked] = useState(null);

  const withPhone = useMemo(() => rows.filter((r) => phoneOf(r)), [rows, phoneOf]);
  const selected = useMemo(() => withPhone.filter((r) => selectedIds.has(r.id)), [withPhone, selectedIds]);
  const target = selected.length ? selected : withPhone;
  const checked = hasChecks(rows);
  const counts = useMemo(() => countByStatus(rows), [rows]);
  const shown = useMemo(() => filterRows(rows, filter), [rows, filter]);

  if (!rows.length) return null;

  const open = async (whole) => {
    const rowsToCheck = whole ? withPhone : target;
    setError("");
    setEst(null);
    setChosen(rowsToCheck);
    setDialog("check");
    try {
      setEst(await api.estimateNumberCheck(itemsFor(rowsToCheck, phoneOf)));
    } catch (e) {
      setError(e.message || "Couldn't work out the cost. Try again.");
    }
  };

  const go = async () => {
    if (!est) return;
    setBusy(true);
    stop.current = false;
    setRows((prev) => applyResults(prev, est.rows)); // free answers first: format, repeats, do-not-call, already checked
    const byId = new Map(chosen.map((r) => [r.id, r]));
    const todo = est.to_check.map((k) => byId.get(k)).filter(Boolean);
    const runs = chunks(itemsFor(todo, phoneOf), CHUNK);
    let done = 0;
    let charged = 0;
    setDialog("");
    try {
      for (const run of runs) {
        if (stop.current) break;
        setProgress({ done, total: todo.length });
        const out = await api.runNumberCheck(run);
        setRows((prev) => applyResults(prev, out.rows));
        charged += out.credits_charged || 0;
        done += run.length;
      }
      const fresh = stop.current ? "Check stopped" : "Check finished";
      showToast(`${fresh}${charged ? ` · ${charged} credit${charged === 1 ? "" : "s"} used` : ""}`);
    } catch (e) {
      showToast(e.message || "Couldn't finish the check. Numbers already checked keep their results.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // What the filter is showing can be ticked for calling or dropped from the list in one go.
  const selectShown = () => setSelectedIds(new Set(shown.filter((r) => phoneOf(r)).map((r) => r.id)));
  const removeShown = () => {
    if (!window.confirm(`Remove ${shown.length} row${shown.length === 1 ? "" : "s"} from this list?`)) return;
    const gone = new Set(shown.map((r) => r.id));
    setRows((prev) => prev.filter((r) => !gone.has(r.id)));
    setSelectedIds((prev) => new Set([...prev].filter((id) => !gone.has(id))));
    setFilter("");
    showToast(`Removed ${gone.size} row${gone.size === 1 ? "" : "s"}`);
  };

  const exportColumns = [...baseColumns, ...CHECK_COLUMNS];
  const openExport = () => {
    setScope(selected.length ? "selected" : filter ? "filter" : "all");
    setPicked(new Set([...baseColumns.map((c) => c.id), ...(checked ? CHECK_COLUMNS.map((c) => c.id) : [])]));
    setDialog("export");
  };
  const exportRows = scope === "selected" ? rows.filter((r) => selectedIds.has(r.id)) : scope === "filter" ? shown : rows;
  const doExport = () => {
    const cols = exportColumns.filter((c) => picked && picked.has(c.id));
    if (!cols.length) return;
    const base = String(fileName || "list").replace(/\.[^.]+$/, "") || "list";
    downloadCsv(`${base}_checked.csv`, toCsv(cols, exportRows));
    setDialog("");
    showToast(`Exported ${exportRows.length} row${exportRows.length === 1 ? "" : "s"}`);
  };

  const label = selected.length ? `Check selected (${selected.length})` : `Check all (${withPhone.length})`;
  const skipped = est ? est.rows.filter((r) => ["bad_format", "duplicate", "do_not_call"].includes(r.status)).length : 0;
  const alreadyKnown = est ? est.rows.filter((r) => r.cached).length : 0;
  const lacking = est && est.enforced && est.credits > est.balance;

  return (
    <div style={{ flexShrink: 0, borderBottom: `1px solid ${C.borderLight}`, padding: "8px 12px 8px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className={checked ? "ui-btn ui-btn--secondary ui-btn--sm" : "ui-btn ui-btn--primary ui-btn--sm"} disabled={busy || !withPhone.length} onClick={() => open(false)}
          title="Find out which numbers are real, what kind they are and who they are registered to">
          <ShieldCheck size={15} /> {busy ? "Checking…" : label}
        </button>
        {selected.length && withPhone.length > selected.length && !busy ? (
          <button type="button" className="ui-link" onClick={() => open(true)}>Check all {withPhone.length}</button>
        ) : null}
        {busy && progress ? (
          <>
            <span style={{ fontSize: 12.5, color: C.slate, fontVariantNumeric: "tabular-nums" }}>Checking {progress.done}/{progress.total}</span>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => { stop.current = true; }}>Stop</button>
          </>
        ) : null}
        {!checked && !busy ? <span style={{ fontSize: 12.5, color: C.slate }}>See which numbers work before you call. 1 credit per 5 numbers.</span> : null}
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ marginLeft: "auto" }} onClick={openExport}><Download size={15} /> Export</button>
      </div>

      {checked ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="ui-chip" aria-pressed={!filter} onClick={() => setFilter("")} style={!filter ? { borderColor: "var(--ui-accent)", color: "var(--ui-accent-ink)" } : undefined}>All {rows.length}</button>
          {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
            <button key={s} type="button" className="ui-chip" aria-pressed={filter === s} title={STATUS[s].hint} onClick={() => setFilter(filter === s ? "" : s)}
              style={filter === s ? { borderColor: "var(--ui-accent)", color: "var(--ui-accent-ink)" } : undefined}>
              {STATUS[s].label} {counts[s]}
            </button>
          ))}
          {["match", "differs"].some((m) => rows.some((r) => r.check && r.check.match === m)) ? (
            <>
              <span style={{ color: C.slateLight, fontSize: 12 }}>Name:</span>
              {["match", "partial", "differs"].filter((m) => rows.some((r) => r.check && r.check.match === m)).map((m) => (
                <button key={m} type="button" className="ui-chip" aria-pressed={filter === `match:${m}`} onClick={() => setFilter(filter === `match:${m}` ? "" : `match:${m}`)}
                  style={filter === `match:${m}` ? { borderColor: "var(--ui-accent)", color: "var(--ui-accent-ink)" } : undefined}>
                  {MATCH[m]}
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}

      {checked && filter && shown.length ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: C.slate }}>
          <span>{shown.length} shown</span>
          <button type="button" className="ui-link" onClick={selectShown}>Select these</button>
          <button type="button" className="ui-link" onClick={removeShown}>Remove these</button>
        </div>
      ) : null}

      {dialog === "check" ? (
        <Dialog
          title={chosen.length === withPhone.length ? `Check all ${chosen.length} numbers` : `Check ${chosen.length} selected number${chosen.length === 1 ? "" : "s"}`}
          onClose={() => setDialog("")}
          footer={(
            <>
              <button type="button" className="ui-btn ui-btn--ghost" onClick={() => setDialog("")}>Cancel</button>
              <button type="button" className="ui-btn ui-btn--primary" disabled={!est || lacking || busy} onClick={go}>
                {est && est.to_check.length ? `Check ${est.to_check.length} number${est.to_check.length === 1 ? "" : "s"}` : "Show results"}
              </button>
            </>
          )}
        >
          {error ? <div style={{ fontSize: 13, color: "var(--ui-bad)" }}>{error}</div> : !est ? <div style={{ fontSize: 13, color: C.slate }}>Working out the cost…</div> : (
            <div>
              <Line label="Numbers chosen" value={est.rows.length} />
              <Line label="Answered already (free)" value={alreadyKnown} />
              <Line label="Skipped: bad format, repeats, do-not-call (free)" value={skipped} />
              <Line label="To check now" value={est.to_check.length} />
              <hr className="ui-menu-sep" />
              <Line label="Cost" value={`${est.credits} credit${est.credits === 1 ? "" : "s"}`} strong />
              <Line label="Your balance" value={`${est.balance} credit${est.balance === 1 ? "" : "s"}`} />
              <div style={{ fontSize: 12, color: C.slate, marginTop: 8, lineHeight: 1.5 }}>
                You are charged only for numbers that get an answer. Numbers that can't be checked right now are free and can be tried again.
                A check shows whether a number exists, its type and the name registered to it. It can't tell if someone will answer.
              </div>
              {lacking ? <div style={{ fontSize: 13, color: "var(--ui-bad)", marginTop: 8 }}>Not enough credits for this check. Choose fewer numbers or add credits.</div> : null}
            </div>
          )}
        </Dialog>
      ) : null}

      {dialog === "export" && picked ? (
        <Dialog
          title="Export to CSV"
          onClose={() => setDialog("")}
          footer={(
            <>
              <button type="button" className="ui-btn ui-btn--ghost" onClick={() => setDialog("")}>Cancel</button>
              <button type="button" className="ui-btn ui-btn--primary" disabled={!picked.size || !exportRows.length} onClick={doExport}>
                <Download size={15} /> Export {exportRows.length} row{exportRows.length === 1 ? "" : "s"}
              </button>
            </>
          )}
        >
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.slate, marginBottom: 4 }}>Rows</div>
          {[["all", `All rows (${rows.length})`, true], ["selected", `Selected (${selected.length})`, selected.length > 0], ["filter", `Shown by the current filter (${shown.length})`, Boolean(filter)]].map(([id, text, on]) => (
            <label key={id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "3px 0", opacity: on ? 1 : 0.45 }}>
              <input type="radio" name="export-scope" checked={scope === id} disabled={!on} onChange={() => setScope(id)} /> {text}
            </label>
          ))}
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.slate, margin: "12px 0 4px" }}>Columns</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
            {exportColumns.map((c) => (
              <label key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "3px 0", minWidth: 0 }}>
                <input type="checkbox" checked={picked.has(c.id)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
              </label>
            ))}
          </div>
          {!checked ? <div style={{ fontSize: 12, color: C.slate, marginTop: 8 }}>Check columns will be empty until you run a check.</div> : null}
        </Dialog>
      ) : null}
    </div>
  );
}

export { statusOf };
