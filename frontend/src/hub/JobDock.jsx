import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Pause, Play, Square } from "lucide-react";
import { api } from "../api/apiClient";
import { usePluginAccess } from "../components/PluginAccessGate";
import { C, FONT_BODY } from "../tokens";
import { FIELD_WORDS, dockText, orderCards, sureWord } from "./jobDockLogic";

// A small dock in the corner of every screen. It follows the latest bulk check, and holds the questions it could not
// answer itself: companies where it found several phones or emails. Nothing is saved on a company until it is chosen here.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.45 };

function PickCard({ card, onChoose, onSkip, busy }) {
  const [value, setValue] = useState("");
  const name = `pick_${card.account_id}_${card.field}`;
  return (
    <fieldset className="ui-card" style={{ margin: 0, padding: 12, border: "1px solid #E3E6EB", display: "grid", gap: 8 }}>
      <legend style={{ ...text, fontSize: 13.5, fontWeight: 600, padding: "0 4px" }}>{card.name} <span style={muted}>· {FIELD_WORDS[card.field] || card.field}{card.region ? ` · ${card.region}` : ""}</span></legend>
      {card.options.map((o, i) => (
        <label key={o.value} style={{ ...text, display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, minHeight: 44, cursor: "pointer" }}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => setValue(o.value)} style={{ marginTop: 4 }} />
          <span><b>{o.value}</b> <span style={{ ...muted, fontWeight: 600 }}>{sureWord(i)}</span><br /><span style={muted}>Found by: {o.source}</span></span>
        </label>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!value || busy} onClick={() => onChoose(card, value)}><Check size={14} /> Use this one</button>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={busy} onClick={() => onSkip(card)}>Skip for now</button>
      </div>
    </fieldset>
  );
}

export default function JobDock() {
  const { hasPlan } = usePluginAccess("leadgen"); // the checks belong to Leads: no plan, no polling, no dock
  const [job, setJob] = useState(null);
  const [cards, setCards] = useState([]);
  const [others, setOthers] = useState([]); // long jobs in Social and Voice
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState([]);
  const [error, setError] = useState("");
  const [said, setSaid] = useState("");
  const lastSaid = useRef(0);

  const load = useCallback(async () => {
    try {
      const [j, p, o] = await Promise.all([
        hasPlan ? api.latestCompanyCheck() : { job: null }, hasPlan ? api.checkPicks() : { picks: [] }, api.activeJobs().catch(() => ({ jobs: [] }))]);
      setJob(j.job || null);
      setCards(p.picks || []);
      setOthers(o.jobs || []);
    } catch (_) { /* signed out or offline: nothing to show */ }
  }, [hasPlan]);
  const running = (!!job && job.status === "running") || others.length > 0;
  useEffect(() => {
    load();
    const t = setInterval(load, running ? 3000 : 20000);
    return () => clearInterval(t);
  }, [load, running]);

  const line = dockText(job, cards.length, others);
  useEffect(() => { // one polite update for screen readers every 10 s at most
    if (Date.now() - lastSaid.current > 10000) { lastSaid.current = Date.now(); setSaid(line); }
  }, [line]);

  if (!line) return null;
  const ordered = orderCards(cards, skipped);
  const act = async (fn) => { setBusy(true); setError(""); try { await fn(); } catch (e) { setError(e.message || "That didn't work."); } finally { await load(); setBusy(false); } };
  const choose = (c, value) => act(() => api.answerCheckPick(c.account_id, { field: c.field, value }));
  const skip = (c) => act(async () => { setSkipped((s) => [...s, `${c.account_id}:${c.field}`]); await api.answerCheckPick(c.account_id, { field: c.field, skip: true }); });
  const acceptAll = () => act(() => api.acceptBestCheckPicks({ ids: [...new Set(cards.map((c) => c.account_id))] }));
  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;
  const counts = job?.counts || {};

  return (
    <div style={{ position: "fixed", right: "max(16px, env(safe-area-inset-right, 0px))", bottom: "calc(16px + env(safe-area-inset-bottom, 0px))", zIndex: 900, maxWidth: "calc(100vw - 32px)", display: "grid", gap: 8, justifyItems: "end" }}>
      <span role="status" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{said}</span>
      {open ? (
        <section className="ui-card" aria-label="Bulk check" style={{ width: 400, maxWidth: "100%", maxHeight: "min(70vh, 640px)", overflow: "auto", padding: 14, display: "grid", gap: 12, boxShadow: "0 12px 32px rgba(18,20,28,.22)" }}>
          {job ? (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ ...text, fontSize: 14, fontWeight: 600 }}>{running ? (job.pause ? "Check paused" : "Checking companies") : job.status === "done" ? "Check finished" : "Check stopped"}</div>
              <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, borderRadius: 3, background: "var(--ui-accent-soft, #EEF2FE)", overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "var(--ui-accent, #3457D5)", transition: "width .4s" }} />
              </div>
              <div style={muted}>{job.done} of {job.total} checked{job.recent && job.recent[0] ? ` · last: ${job.recent[0].name}` : ""}</div>
              <div style={{ ...muted, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span>Verified {counts.verified || 0}</span><span>Looks OK {counts.looks_ok || 0}</span><span>Not found {counts.not_found || 0}</span><span>Problem {(counts.problem || 0) + (counts.mismatch || 0)}</span>
                {job.charged && job.charged.total ? <span>{job.charged.total} credits used</span> : null}
              </div>
              {running ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => act(() => (job.pause ? api.resumeCompanyCheck(job.job_id) : api.pauseCompanyCheck(job.job_id)))}>{job.pause ? <><Play size={13} /> Resume</> : <><Pause size={13} /> Pause</>}</button>
                  <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => act(() => api.cancelCompanyCheck(job.job_id))}><Square size={12} /> Stop</button>
                </div>
              ) : null}
            </div>
          ) : null}
          {others.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ ...text, fontSize: 14, fontWeight: 600 }}>Also running</div>
              {others.map((o) => (
                <div key={o.id} style={{ display: "grid", gap: 4 }}>
                  <div style={{ ...text, fontSize: 13.5 }}>{o.title} <span style={muted}>· {o.plugin === "voice" ? "Voice" : "Social"} · {o.done} of {o.total}</span></div>
                  <div role="progressbar" aria-valuenow={o.total ? Math.round((o.done / o.total) * 100) : 0} aria-valuemin={0} aria-valuemax={100} style={{ height: 5, borderRadius: 3, background: "var(--ui-accent-soft, #EEF2FE)", overflow: "hidden" }}>
                    <div style={{ width: `${o.total ? Math.round((o.done / o.total) * 100) : 0}%`, height: "100%", background: "var(--ui-accent, #3457D5)" }} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {cards.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ ...text, fontSize: 14, fontWeight: 600 }}>Needs you ({cards.length})</div>
              <div style={muted}>Nothing here is saved until you choose. Skipped items stay here.</div>
              {cards.length > 1 ? (
                <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ justifySelf: "start" }} disabled={busy} onClick={acceptAll}>
                  <Check size={14} /> Accept all best guesses ({cards.length})
                </button>
              ) : null}
              {ordered.map((c) => <PickCard key={`${c.account_id}:${c.field}`} card={c} onChoose={choose} onSkip={skip} busy={busy} />)}
            </div>
          ) : null}
          {error ? <div role="alert" style={{ ...muted, color: C.red }}>{error}</div> : null}
        </section>
      ) : null}
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        style={{ ...text, display: "flex", gap: 8, alignItems: "center", border: "none", cursor: "pointer", background: "#171A21", color: "#fff", borderRadius: 999, padding: "10px 16px", minHeight: 44, fontSize: 13.5, fontWeight: 600, boxShadow: "0 6px 20px rgba(0,0,0,.25)" }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: cards.length ? "#FFC857" : "#8B5CF6" }} />
        {line}
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
      </button>
    </div>
  );
}
