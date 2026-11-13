import React, { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { api } from "../../api/apiClient";
import { Spinner } from "../../app/Loader";
import { creditWord, useLeadCredits } from "./CreditsChip";
import { FitBadge } from "./FitParts";
import { nextTarget, summaryRows } from "./summaryLogic";

// The Summary tab of the company drawer and the saved-company panel: the fit, who to contact, the best email and phone with where
// each came from, and the one next step.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.5 };
const PILL = { Register: ["#1D4ED8", "#DBEAFE"], Web: ["#92400E", "#FEF3C7"], "Your file": ["#475569", "#F1F5F9"], "Found by us": ["#166534", "#DCFCE7"] };

const asked = new Map(); // company id -> profile promise, so the tab asks the server once per company

// The company profile for one company, read once when the Summary tab is first shown for it.
export function useCompanyProfile(id, active) {
  const [state, setState] = useState({ id: "", data: null, error: "" });
  const [tick, setTick] = useState(0); // bumped after a pick, so the profile is read again
  useEffect(() => {
    if (!id || !active) return undefined;
    let live = true;
    if (!asked.has(id)) asked.set(id, api.companyProfile(id).then((r) => r.company || r));
    asked.get(id).then((data) => { if (live) setState({ id, data, error: "" }); }).catch((e) => { asked.delete(id); if (live) setState({ id, data: null, error: e.message || "Couldn't load the summary." }); });
    return () => { live = false; };
  }, [id, active, tick]);
  const mine = state.id === id;
  return { profile: mine ? state.data : null, loading: Boolean(id && active && !(mine && (state.data || state.error))), error: mine ? state.error : "", reload: () => setTick((n) => n + 1) };
}

function NewsLine({ companyId }) {
  const [news, setNews] = useState({ id: "", data: null });
  useEffect(() => {
    if (!companyId) return undefined;
    let live = true;
    api.companyNews(companyId).then((r) => { if (live) setNews({ id: companyId, data: r }); }).catch(() => { if (live) setNews({ id: companyId, data: null }); });
    return () => { live = false; };
  }, [companyId]);
  const n = news.id === companyId ? news.data : null;
  if (!n || n.skipped || !n.headline) return null;
  return (
    <Row label="Recent news">
      {n.url ? <a href={n.url} target="_blank" rel="noreferrer" style={{ color: C.textInk }}>{n.headline}</a> : <span>{n.headline}</span>}
      {n.source ? <span style={{ ...muted, fontSize: 12 }}>{n.source}</span> : null}
    </Row>
  );
}

function Source({ word }) {
  const [fg, bg] = PILL[word] || PILL["Your file"];
  return <span style={{ ...text, fontSize: 10.5, fontWeight: 600, color: fg, background: bg, borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap" }}>{word}</span>;
}

function Row({ label, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 96px) minmax(0, 1fr)", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.borderLight}`, alignItems: "baseline" }}>
      <span style={{ ...muted, fontSize: 12 }}>{label}</span>
      <div style={{ ...text, fontSize: 13.5, color: C.textInk, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>{children}</div>
    </div>
  );
}

function Contact({ c, none }) {
  if (!c) return <span style={{ color: C.slateLight }}>{none}</span>;
  return (
    <>
      <span style={{ overflowWrap: "anywhere" }}>{c.value}</span>
      <Source word={c.source} />
      {c.checked ? <span style={{ ...muted, fontSize: 11.5 }}>checked {c.checked}</span> : null}
    </>
  );
}

// A lookup found matches nobody has chosen from yet: shown right here with a "Use this" button, never as "Not found yet".
function PendingPick({ companyId, kind, options, onPicked }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const use = async (o) => {
    setBusy(o.value); setErr("");
    try {
      await api.chooseContact(companyId, { kind, value: o.value, person: "" });
      asked.delete(companyId);
      onPicked?.();
    } catch (e) { setErr(e.message || "Couldn't save that. Try again."); } finally { setBusy(""); }
  };
  return (
    <div style={{ display: "grid", gap: 6, width: "100%" }}>
      <strong style={{ fontSize: 13 }}>{options.length} found · pick one</strong>
      {options.map((o) => (
        <div key={o.value} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ overflowWrap: "anywhere" }}>{o.value}</span>
          {o.label ? <span style={{ ...muted, fontSize: 11.5 }}>{o.label}</span> : null}
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={Boolean(busy)} onClick={() => use(o)}>{busy === o.value ? <Spinner size={12} /> : null} Use this</button>
        </div>
      ))}
      {err ? <div role="alert" style={{ ...muted, color: C.red }}>{err}</div> : null}
    </div>
  );
}

// One button for finding a missing contact: our records, then the web, then a deep web search, then the check.
export function FindContactButton({ store, account }) {
  const credits = useLeadCredits();
  const state = store.improving?.[account.id];
  const busy = Boolean(store.researching?.[account.id]);
  const rates = credits?.rates || {};
  const most = (rates.lead_lookup?.credits || 0) + (rates.google_deep_search?.credits || 0);
  const running = (state?.steps || []).find((st) => st.state === "run");
  const ended = account.verification?.verdict === "problem";
  const r = state?.done ? state.result : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
      <button type="button" className="ui-btn ui-btn--secondary" disabled={busy || ended} onClick={() => store.improve(account.id, { again: Boolean(state?.done) })}
        title="Tries our records first (free), then the web, then a deep web search if a phone or website is still missing, then checks what it found.">
        {busy ? <Spinner size={14} /> : <Search size={14} />} {busy ? "Working…" : most ? `Find contact · up to ${creditWord(most)}, only charged if found` : "Find contact"}
      </button>
      {busy ? <div style={muted} role="status">{running ? running.label : "Starting"}…</div> : null}
      {ended ? <div style={muted}>This company has ended, so we don't search for its contact details.</div> : null}
      {r && !busy ? <div style={muted}>{r.added.length ? `Added ${r.added.map((k) => (k === "contact_name" ? "contact" : k)).join(", ")}. Nothing you already had was changed.` : r.problem ? `It stopped: ${r.problem}` : "We searched our records and the web and found nothing more. Nothing was charged."}</div> : null}
    </div>
  );
}

// profile: the server's company profile or null; account: the saved company or null; onGoTab switches the tab the next step points at.
export function SummaryTab({ profile, account, loading, error, onGoTab, companyId, onPicked }) {
  const rows = summaryRows({ profile, account });
  const next = rows.next;
  const target = nextTarget(next);
  const saved = Boolean(account);
  const icpSet = profile ? profile.icp_set : rows.fit != null;
  return (
    <div style={{ display: "flex", flexDirection: "column", paddingTop: 6 }}>
      {error ? <div role="alert" style={{ ...muted, color: C.red, padding: "8px 0" }}>{error}</div> : null}
      <Row label="Fit">
        {rows.fit ? <FitBadge fit={rows.fit} /> : <span style={{ color: C.slateLight }}>{loading ? "Reading…" : icpSet ? "—" : "Set your ideal customer to see a fit score"}</span>}
      </Row>
      {rows.fit?.reasons?.length ? (
        <ul style={{ ...muted, margin: "6px 0 0", paddingLeft: 18 }}>
          {rows.fit.reasons.map((x) => <li key={x}>{x}</li>)}
        </ul>
      ) : null}
      <Row label="Who to contact">
        {rows.who ? <><strong>{rows.who.name}</strong>{rows.who.role ? <span style={{ color: C.slate }}>{rows.who.role}</span> : null}<Source word={rows.who.source} /></>
          : <span style={{ color: C.slateLight }}>{loading ? "Reading…" : "No named person yet"}</span>}
      </Row>
      {["email", "phone"].map((k) => {
        const waiting = !rows[k] && companyId ? profile?.pending?.[k] || [] : [];
        return (
          <Row key={k} label={k === "email" ? "Best email" : "Best phone"}>
            {waiting.length ? <PendingPick companyId={companyId} kind={k} options={waiting} onPicked={onPicked} />
              : <Contact c={rows[k]} none={loading ? "Reading…" : "Not found yet"} />}
          </Row>
        );
      })}
      <Row label="Next step">
        {next && next.label ? (
          <>
            {target && saved
              ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title={next.why} onClick={() => onGoTab?.(target.tab)}>{next.label}</button>
              : <strong>{next.label}</strong>}
            <span style={{ ...muted, fontSize: 12 }}>{target && !saved ? "Save this company to take this step." : next.why}</span>
          </>
        ) : <span style={{ color: C.slateLight }}>{loading ? "Reading…" : next?.why || "Nothing to do here"}</span>}
      </Row>
      {companyId ? <NewsLine companyId={companyId} /> : null}
    </div>
  );
}
