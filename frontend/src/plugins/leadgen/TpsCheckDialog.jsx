import React, { useEffect, useMemo, useRef, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { C } from "../../tokens";
import { TPS_CHUNK, badgeTip, creditsWord, dateWord, estimateTps, previewLine, runTpsChecks, summarise, tpsLabel, uniqueNumbers } from "./tpsCheck";

const TONES = {
  bad: { color: "var(--ui-bad)", bg: "var(--ui-bad-soft)" },
  ok: { color: "#176B3F", bg: "#E3F4EA" },
  mute: { color: "#5B6573", bg: "#EEF0F3" },
  warn: { color: "#8A5A00", bg: "#FFF1D2" },
};

function toneOf(status, ctps) {
  if (ctps || status === "listed") return TONES.bad;
  if (status === "clear") return TONES.ok;
  if (status === "unknown") return TONES.warn;
  return TONES.mute;
}

export function TpsBadge({ status, ctps, checkedAt }) {
  if (!status) return <span style={{ color: C.slateLight, fontSize: 12 }}>Not screened</span>;
  const t = toneOf(status, ctps);
  return (
    <span title={badgeTip(checkedAt)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 99, fontSize: 12, fontWeight: 500, color: t.color, background: t.bg, whiteSpace: "nowrap" }}>
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 99, background: t.color }} />
      {tpsLabel(status, ctps)}
    </span>
  );
}

const Chip = ({ label, n, tone }) => (
  <span style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "4px 10px", borderRadius: 99, fontSize: 12.5, fontWeight: 500, color: tone.color, background: tone.bg }}>
    {label} <b style={{ fontVariantNumeric: "tabular-nums" }}>{n.toLocaleString()}</b>
  </span>
);

export function TpsEstimateView({ est, total }) {
  if (!est.ready) {
    return <div role="alert" style={{ fontSize: 13.5, color: C.textInk }}>TPS and CTPS checking is not switched on yet. Ask your administrator.</div>;
  }
  const lacking = est.enforced && est.credits > est.balance;
  return (
    <div style={{ display: "grid", gap: 8, fontSize: 13.5, color: C.textInk, lineHeight: 1.5 }}>
      <div>{previewLine(est, total)}</div>
      <div>You have {creditsWord(est.balance)}. Numbers checked in the last 28 days are free, and nothing is spent until you press Check numbers.</div>
      {lacking ? <div role="alert" style={{ color: C.red }}>You don't have enough credits for this check. Add credits under Plan &amp; credits, then try again.</div> : null}
      {est.to_check > TPS_CHUNK ? <div style={{ color: C.slate }}>It runs in batches of {TPS_CHUNK.toLocaleString()}, one after another.</div> : null}
    </div>
  );
}

export function TpsResultsView({ rows, charged, note }) {
  const s = summarise(rows);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Chip label="On TPS" n={s.listed} tone={TONES.bad} />
        <Chip label="On CTPS" n={s.ctps} tone={TONES.bad} />
        <Chip label="Clear" n={s.clear} tone={TONES.ok} />
        <Chip label="Not UK" n={s.not_uk} tone={TONES.mute} />
        <Chip label="Couldn't check" n={s.couldnt_check} tone={TONES.warn} />
      </div>
      <div style={{ fontSize: 13, color: C.slate }}>
        {creditsWord(charged)} charged.{s.couldnt_check ? " Numbers we couldn't check were not charged. Run the check again later to retry them." : ""}
        {note ? ` ${note}` : ""}
      </div>
      <div className="ui-scroll" style={{ maxHeight: 280, overflow: "auto", border: `1px solid ${C.borderLight}`, borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: C.slate }}>
              <th style={{ padding: "6px 10px" }}>Number</th>
              <th style={{ padding: "6px 10px" }}>Result</th>
              <th style={{ padding: "6px 10px" }}>Checked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.number} style={{ borderTop: `1px solid ${C.borderLight}` }}>
                <td style={{ padding: "8px 10px", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{r.number}</td>
                <td style={{ padding: "8px 10px" }}><TpsBadge status={r.status} ctps={r.ctps} checkedAt={r.checked_at} /></td>
                <td style={{ padding: "8px 10px", color: C.slate, whiteSpace: "nowrap" }}>{dateWord(r.checked_at) || "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function TpsCheckDialog({ numbers, wallet, title = "Check TPS and CTPS", onClose, onDone }) {
  const list = useMemo(() => uniqueNumbers(numbers), [numbers]);
  const [est, setEst] = useState(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("estimate"); // estimate | running | done
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);
  const box = useRef(null);
  const stop = useRef(false);

  useEffect(() => {
    let live = true;
    estimateTps(list, wallet)
      .then((e) => { if (live) setEst(e); })
      .catch((e) => { if (live) setError(e?.message || "Couldn't work out the cost. Try again."); });
    return () => { live = false; };
  }, [list, wallet]);

  useEffect(() => {
    const before = document.activeElement;
    box.current?.querySelector(FOCUSABLE)?.focus();
    return () => { if (before && before.focus) before.focus(); };
  }, []);

  const keys = (e) => {
    if (e.key === "Escape" && phase !== "running") { onClose(); return; }
    if (e.key !== "Tab") return;
    const items = [...box.current.querySelectorAll(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const go = async () => {
    stop.current = false;
    setError("");
    setPhase("running");
    setProgress({ done: 0, total: list.length });
    const out = await runTpsChecks(list, wallet, (done, total) => setProgress({ done, total }), () => stop.current);
    setResult(out);
    setError(out.error);
    setPhase("done");
    if (out.rows.length) onDone?.(out.rows);
  };

  const lacking = est && est.enforced && est.credits > est.balance;
  const canRun = est && est.ready && !lacking && phase === "estimate";
  const btn = { minHeight: 44 };

  return (
    <div onClick={phase === "running" ? undefined : onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} onKeyDown={keys} onClick={(e) => e.stopPropagation()} className="ui-card"
        style={{ width: "min(100%, 560px)", maxHeight: "90vh", overflow: "auto", boxSizing: "border-box", padding: 20, display: "flex", flexDirection: "column", gap: 12, background: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 600, color: C.textInk }}>{title}</div>
          <button type="button" className="ui-icon-btn" style={{ minWidth: 44, minHeight: 44 }} onClick={onClose} disabled={phase === "running"} aria-label="Close"><X size={16} /></button>
        </div>

        {phase === "estimate" && !est && !error ? <div role="status" style={{ fontSize: 13.5, color: C.slate }}>Working out the cost…</div> : null}
        {phase === "estimate" && est ? <TpsEstimateView est={est} total={list.length} /> : null}
        {phase === "running" ? (
          <div role="status" aria-live="polite" style={{ fontSize: 13.5, color: C.textInk }}>
            Checking… {progress.done.toLocaleString()} of {progress.total.toLocaleString()}
          </div>
        ) : null}
        {phase === "done" && result ? <TpsResultsView rows={result.rows} charged={result.charged} note={result.note} /> : null}
        {error ? <div role="alert" style={{ fontSize: 13, color: C.red }}>{error}</div> : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          {phase === "running" ? (
            <button type="button" className="ui-btn ui-btn--ghost" style={btn} onClick={() => { stop.current = true; }}>Stop after this batch</button>
          ) : (
            <button type="button" className="ui-btn ui-btn--ghost" style={btn} onClick={onClose}>{phase === "done" ? "Close" : "Cancel"}</button>
          )}
          {phase === "estimate" ? (
            <button type="button" className="ui-btn ui-btn--primary" style={btn} disabled={!canRun} onClick={go}>
              <ShieldCheck size={15} /> Check numbers
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default TpsCheckDialog;
