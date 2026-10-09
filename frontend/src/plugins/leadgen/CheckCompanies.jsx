import React, { useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import { RefreshCw, ShieldCheck, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";

// "Check companies" on Saved Accounts: tick some companies (or all), see the most it could cost,
// and follow the run. Each company gets a verdict with its reasons. Nothing the user saved is
// changed by a check; the answer is kept beside it. The words here are generic on purpose.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };

export const VERDICTS = {
  verified: { label: "Verified", color: C.green, bg: C.greenSoft },
  looks_ok: { label: "Looks OK", color: C.cobalt, bg: C.cobaltSoft },
  not_found: { label: "Not found", color: C.amber, bg: C.amberSoft },
  problem: { label: "Problem", color: C.red, bg: C.redSoft },
  unclear: { label: "Unclear", color: C.slate, bg: C.paperSoft },
};
export const VERDICT_ORDER = ["verified", "looks_ok", "problem", "not_found", "unclear"];

const STAGE_LABEL = { our_records: "Our records", registry: "Company register", website: "Website", email: "Email", phone: "Phone", deep_search: "Deep web search", email_finder: "Email finder" };
const STATE_WORDS = {
  email: { verified: "Confirmed", found: "A verified address was found", ok: "Looks right", invalid: "Not working", none: "None given", unchecked: "Couldn't check" },
  phone: { ok: "Looks right", invalid: "Not a usable number", none: "None given", unchecked: "Couldn't check" },
  website: { live: "Working", dead: "Not working", parked: "Parked or for sale", none: "None given", unchecked: "Couldn't check" },
};

export function VerdictBadge({ verification }) {
  const v = verification?.verdict && VERDICTS[verification.verdict];
  if (!v) return <span style={{ color: C.slateLight }}>Not checked</span>;
  return (
    <span style={{ ...text, display: "inline-block", fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: v.bg, color: v.color }}>
      {v.label}
    </span>
  );
}

// What a check found for one company: the verdict, why, and how each contact detail looked.
export function CheckDetails({ account }) {
  const v = account?.verification;
  if (!v) return null;
  const rows = [["Website", "website", v.website], ["Email", "email", v.email], ["Phone", "phone", v.phone]].filter(([, , s]) => s && s.state && s.state !== "none");
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, marginRight: "auto" }}>Company check</div>
        <VerdictBadge verification={v} />
      </div>
      <ul style={{ ...text, margin: 0, paddingLeft: 18, fontSize: 13, color: C.textInk, lineHeight: 1.6 }}>
        {(v.reasons || []).map((r, i) => <li key={i}>{r}</li>)}
      </ul>
      {rows.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px", ...text, fontSize: 13 }}>
          {rows.map(([label, key, s]) => (
            <React.Fragment key={key}>
              <span style={{ color: C.slate }}>{label}</span>
              <span style={{ color: s.state === "invalid" || s.state === "dead" || s.state === "parked" ? C.red : C.textInk }}>
                {STATE_WORDS[key]?.[s.state] || s.state}{s.note && s.state !== "ok" && s.state !== "live" ? ` · ${s.note}` : ""}
              </span>
            </React.Fragment>
          ))}
        </div>
      ) : null}
      <div style={{ ...muted, fontSize: 12 }}>
        Checked {new Date(v.checked_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        {v.stages?.length ? ` using ${v.stages.map((s) => STAGE_LABEL[s] || s).join(", ").toLowerCase()}` : ""}.
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- following a run
export function useCompanyCheck({ onToast, reload }) {
  const [job, setJob] = useState(null);
  const beat = useRef(0);
  const latest = useRef({ onToast, reload });
  latest.current = { onToast, reload };
  const jobId = job?.job_id;
  const running = job?.status === "running";

  useEffect(() => {
    let alive = true;
    api.latestCompanyCheck().then((r) => { if (alive && r?.job?.status === "running") setJob(r.job); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!jobId || !running) return undefined;
    const timer = setInterval(async () => {
      try {
        const r = await api.getCompanyCheck(jobId);
        setJob(r.job);
        beat.current += 1;
        const { onToast: toast, reload: refresh } = latest.current;
        if (r.job.status !== "running") {
          refresh();
          toast(r.job.status === "done" ? "Check finished." : r.job.status === "cancelled" ? "Check cancelled. Finished companies keep their results."
            : r.job.status === "stalled" ? "The check stopped. Finished companies keep their results." : (r.job.error || "The check stopped early."));
        } else if (beat.current % 4 === 0) {
          refresh(); // show results as they come in
        }
      } catch (_) { /* a missed poll is fine; the next one catches up */ }
    }, 2500);
    return () => clearInterval(timer);
  }, [jobId, running]);

  return {
    job,
    start: async (body) => {
      const r = await api.startCompanyCheck(body);
      setJob(r.job);
      latest.current.onToast("Check started. You can keep using the app.");
      return r.job;
    },
    cancel: async () => {
      if (!jobId) return;
      try { setJob((await api.cancelCompanyCheck(jobId)).job); } catch (e) { latest.current.onToast(e.message || "Couldn't cancel."); }
    },
    dismiss: () => setJob(null),
  };
}

export function CheckProgress({ check, pendingCount, onRecheck, onFilter }) {
  const { job } = check;
  if (!job) return null;
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
  const running = job.status === "running";
  const counts = VERDICT_ORDER.filter((k) => job.counts?.[k]);
  return (
    <div className="ui-card" style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <ShieldCheck size={16} color={C.cobalt} />
        <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, marginRight: "auto" }}>
          {running ? `Checking ${job.done.toLocaleString()} of ${job.total.toLocaleString()}` : job.status === "done" ? `Checked ${job.done.toLocaleString()} companies`
            : job.status === "cancelled" ? `Cancelled after ${job.done.toLocaleString()} of ${job.total.toLocaleString()}` : `Stopped after ${job.done.toLocaleString()} of ${job.total.toLocaleString()}`}
        </div>
        {running ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={check.cancel}>Cancel</button> : null}
        {!running && pendingCount > 0 ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onRecheck}><RefreshCw size={13} /> Re-check {pendingCount} pending</button> : null}
        {!running ? <button type="button" className="ui-icon-btn" aria-label="Dismiss" onClick={check.dismiss}><X size={16} /></button> : null}
      </div>
      {running ? (
        <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, borderRadius: 3, background: C.paperSoft, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: C.cobalt, transition: "width .4s" }} />
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {counts.map((k) => (
          <button key={k} type="button" onClick={() => onFilter(k)} title={`Show ${VERDICTS[k].label.toLowerCase()} companies`}
            style={{ ...text, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: VERDICTS[k].bg, color: VERDICTS[k].color }}>
            {VERDICTS[k].label} {job.counts[k]}
          </button>
        ))}
        {!running && job.charged ? <span style={{ ...muted, fontSize: 12.5, marginLeft: "auto" }}>{job.charged.total ? `${job.charged.total} credits used` : "No credits used"}</span> : null}
      </div>
      {job.status === "stalled" ? <div style={{ ...muted, color: C.red }}>The check stopped (the server restarted). Companies already checked keep their results; credits held for the rest are given back.</div> : null}
      {job.error ? <div role="alert" style={{ ...muted, color: C.red }}>{job.error}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- the box before a run
export function CheckDialog({ ids, pendingOnly = false, onStart, onClose }) {
  const [email, setEmail] = useState(false);
  const [est, setEst] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setEst(null);
    api.estimateCompanyCheck({ ids, pending_only: pendingOnly, include_email: email })
      .then((r) => { if (alive) setEst(r); })
      .catch((e) => { if (alive) setError(e.message || "Couldn't work out the cost."); });
    return () => { alive = false; };
  }, [ids, pendingOnly, email]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const go = async () => {
    setBusy(true);
    setError("");
    try {
      await onStart({ ids, pending_only: pendingOnly, include_email: email });
      onClose();
    } catch (e) {
      setError(e.message || "Couldn't start the check.");
      setBusy(false);
    }
  };
  const max = est?.max_credits;
  const li = { ...text, fontSize: 13, color: C.textInk, lineHeight: 1.5 };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-label="Check companies" onClick={(e) => e.stopPropagation()} className="ui-card"
        style={{ width: "min(100%, 520px)", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ ...text, fontSize: 16, fontWeight: 600, color: C.ink, marginRight: "auto" }}>
            Check {est ? est.companies.toLocaleString() : ids.length.toLocaleString()} {(est ? est.companies : ids.length) === 1 ? "company" : "companies"}
          </div>
          <button type="button" className="ui-icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={muted}>Each company is checked one step at a time, cheapest first, and stops as soon as it has a clear answer. Nothing you saved is changed.</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          <li style={li}><strong>Our records</strong>, plus website, email and phone checks: free</li>
          <li style={li}><strong>Company register</strong>, asked directly when our records can't settle it: {est ? `${est.rates.check_registry} credit${est.rates.check_registry === 1 ? "" : "s"} each` : "…"}{est && !est.ready.registry ? " (not set up yet, so skipped)" : ""}</li>
          <li style={li}><strong>Deep web search</strong>, only if nothing above knows the company: {est ? `${est.rates.google_deep_search} credits each` : "…"}{est && !est.ready.deep ? " (not set up yet, so skipped)" : ""}</li>
        </ul>
        <label style={{ ...li, display: "flex", gap: 8, alignItems: "flex-start", opacity: est && !est.ready.email ? 0.55 : 1 }}>
          <input type="checkbox" checked={email} disabled={est ? !est.ready.email : false} onChange={(e) => setEmail(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            Also find or confirm contact emails{est ? ` (${est.rates.check_email} credits for each verified email found)` : ""}
            <span style={{ ...muted, display: "block", fontSize: 12 }}>
              {est ? (!est.ready.email ? "Not set up yet." : `${est.with_contact.toLocaleString()} of these have a contact name to look up.`) : ""}
            </span>
          </span>
        </label>
        <div style={{ background: C.paperSoft, borderRadius: 6, padding: "10px 12px", ...text, fontSize: 13, color: C.textInk }}>
          {max ? (
            <>
              The most this could cost is <strong>{max.total.toLocaleString()} credits</strong>. You only pay for what's used, and the rest is given back.
              <div style={{ ...muted, fontSize: 12, marginTop: 2 }}>Your Leads balance: {est.balance.toLocaleString()} credits.</div>
            </>
          ) : "Working out the cost…"}
        </div>
        {error ? <div role="alert" style={{ ...text, fontSize: 13, color: C.red }}>{error}</div> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="ui-btn ui-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="ui-btn ui-btn--primary" disabled={!est || busy || est.companies === 0} onClick={go}>{busy ? "Starting…" : "Start check"}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- results out
export function exportCheckCsv(accounts) {
  const rows = accounts.map((a) => {
    const v = a.verification || {};
    return {
      Company: a.name, Website: a.website, Email: a.email, Phone: a.phone, Contact: a.contact_name,
      Verdict: v.verdict ? VERDICTS[v.verdict]?.label || v.verdict : "Not checked",
      Reasons: (v.reasons || []).join("; "),
      "Website check": STATE_WORDS.website[v.website?.state] || "", "Email check": STATE_WORDS.email[v.email?.state] || "",
      "Email found": v.email?.found || "", "Phone check": STATE_WORDS.phone[v.phone?.state] || "",
      "Checked on": v.checked_at ? v.checked_at.slice(0, 10) : "",
    };
  });
  const url = URL.createObjectURL(new Blob([Papa.unparse(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `company-check-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
