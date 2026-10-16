import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, ShieldCheck, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";
import { announceCreditsChanged } from "./CreditsChip";

// "Check companies" on Saved Accounts: tick some companies (or all), see the most it could cost,
// and follow the run. Each company gets a verdict with its reasons. Nothing the user saved is
// changed by a check; the answer is kept beside it. The words here are generic on purpose.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };

export const VERDICTS = {
  verified: { label: "Verified", color: C.green, bg: C.greenSoft },
  looks_ok: { label: "Looks OK", color: "var(--ui-accent)", bg: "var(--ui-accent-soft)" },
  not_found: { label: "Not found", color: C.amber, bg: C.amberSoft },
  problem: { label: "Problem", color: C.red, bg: C.redSoft },
  unclear: { label: "Unclear", color: C.slate, bg: C.paperSoft },
};
export const VERDICT_ORDER = ["verified", "looks_ok", "problem", "not_found", "unclear"];

const STAGE_LABEL = { web: "Web research", our_records: "Our records", registry: "Company register", website: "Website", email: "Email", phone: "Phone", deep_search: "Deep web search", email_finder: "Email finder" };
const STATE_WORDS = {
  email: { verified: "Confirmed", found: "A verified address was found", ok: "Looks right", invalid: "Not working", none: "None given", unchecked: "Couldn't check" },
  phone: { ok: "Looks right", unconfirmed: "Not a normal phone line", invalid: "Not a usable number", none: "None given", unchecked: "Couldn't check" },
  website: { live: "Working", dead: "Not working", parked: "Parked or for sale", none: "None given", unchecked: "Couldn't check" },
};

const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : "");

// The rating in plain words: a short headline, what we found, what it means for the person, and what to do about it.
// Built from the verdict and the reasons the check saved, so checks made before this still explain themselves.
export function explainCheck(v) {
  const reasons = v?.reasons || [];
  const when = v?.checked_at ? new Date(v.checked_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  const reg = reasons.map((r) => r.match(/^Company register: (.+?) \(checked live\)$/)).find(Boolean);
  const store = reasons.map((r) => r.match(/^Our records: ([^,]+)/)).find(Boolean);
  const status = ((reg && reg[1]) || (store && store[1]) || "").trim();
  const found = reasons.map((r) => {
    let m;
    if ((m = r.match(/^Company register: (.+?) \(checked live\)$/))) return `The company register${when ? ` (checked live on ${when})` : ""} lists it as ${m[1].toLowerCase()}.`;
    if ((m = r.match(/^Our records said (.+?); the register is newer/))) return `Our own records still said ${m[1].toLowerCase()}, but the register is more up to date, so we trust the register.`;
    if ((m = r.match(/^Our records: ([^,]+)(?:, updated (.+))?$/))) return `Our own records list it as ${m[1].toLowerCase()}${m[2] ? `, last updated ${m[2]}` : ""}.`;
    if (r === "Found on a register but its status isn't clear") return "It is on a register, but the register doesn't say whether it is still trading.";
    if (r === "Deep web search: permanently closed") return "A web search found the business, and it is marked as permanently closed.";
    if (r.startsWith("Deep web search: found as a working")) return "A web search found it as a business that is open and working.";
    if (r.startsWith("Deep web search: found, temporarily")) return "A web search found it, but it is marked as temporarily closed.";
    if (r.startsWith("Company register check pending")) return "The company register hadn't answered yet.";
    if (r.startsWith("Website works and shows")) return "Its website works and shows the company name. No register or search matched it.";
    if (r.startsWith("No register or search could")) return "We couldn't reach any register or search just now.";
    if (r.startsWith("No register, record")) return "No register, record or search result matched this name.";
    if (r === "Website isn't working" || r.startsWith("Website looks parked")) return "";
    return r;
  }).filter(Boolean);
  const stop = "Leave it out of campaigns. If it now trades under another name, change the name and run Check & improve again.";
  const byVerdict = {
    problem: reasons.some((r) => /permanently closed/i.test(r))
      ? { headline: "Closed for good", means: "The business has shut down, so calls and emails are unlikely to reach anyone.", todo: stop }
      : { headline: `${cap(status) || "Ended"} on the company register`, means: "The company has legally ended or stopped trading, so calls and emails are unlikely to reach anyone.", todo: stop },
    verified: { headline: `${cap(status) || "Active"} on the company register`, means: "This is a real company that is still trading.", todo: "Nothing to do here. Check the phone and email below before you contact them." },
    looks_ok: { headline: "Exists, but not confirmed as trading", means: "We found signs that it exists, but no register told us it is active, so we can't promise it is.", todo: "Fine to contact. For a firm answer, add its registered name or company number and check again." },
    not_found: { headline: "Not found on any register or search", means: "We couldn't confirm that this company exists. The name may be spelt differently, or it may be a sole trader or a trading name.", todo: "Check the spelling, or add the registered name or number under Details, then run Check & improve again." },
    unclear: { headline: "Couldn't confirm just now", means: "The sources we ask didn't answer, so this says nothing about the company itself.", todo: "Run Check & improve again in a few minutes. Nothing is charged for a source that didn't answer." },
  };
  const base = byVerdict[v?.verdict] || { headline: "", means: "", todo: "" };
  const also = [["Website", v?.website, { dead: "isn't working", parked: "looks parked or for sale" }], ["Email", v?.email, { invalid: "will bounce" }],
    ["Phone", v?.phone, { invalid: "isn't a usable number", unconfirmed: "isn't a normal phone line" }]]
    .map(([label, st, words]) => (st && words[st.state] ? `${label} ${words[st.state]}.` : "")).filter(Boolean);
  return { ...base, found, also };
}

export function VerdictBadge({ verification, withWhy = false }) {
  const v = verification?.verdict && VERDICTS[verification.verdict];
  if (!v) return <span style={{ color: C.slateLight }}>Not checked</span>;
  const why = explainCheck(verification);
  const bad = verification.verdict === "problem";
  return (
    <span title={[why.headline + ".", ...why.found, why.todo].filter(Boolean).join(" ")} style={{ display: "inline-flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
      <span style={{ ...text, display: "inline-block", fontSize: bad ? 13 : 12, fontWeight: bad ? 700 : 600, padding: bad ? "3px 11px" : "2px 8px", borderRadius: 999, background: v.bg, color: v.color, border: bad ? `1px solid ${v.color}` : "none" }}>
        {v.label}
      </span>
      {withWhy && why.headline ? <span style={{ ...text, fontSize: 11.5, color: bad ? C.red : C.slate, fontWeight: bad ? 600 : 400, lineHeight: 1.3 }}>{why.headline}</span> : null}
    </span>
  );
}

// A company that has ended is never a small label: this sits at the top of its panel every time.
export function EndedBanner({ account }) {
  const v = account?.verification;
  if (v?.verdict !== "problem") return null;
  const why = explainCheck(v);
  return (
    <div role="alert" style={{ display: "flex", gap: 12, alignItems: "flex-start", background: C.redSoft, border: `2px solid ${C.red}`, borderRadius: 10, padding: "14px 16px" }}>
      <AlertTriangle size={26} color={C.red} style={{ flex: "none", marginTop: 1 }} />
      <div style={{ ...text, color: C.red }}>
        <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.25 }}>{why.headline}</div>
        <div style={{ fontSize: 13.5, color: C.textInk, marginTop: 4, lineHeight: 1.5 }}>{why.means} {why.todo}</div>
      </div>
    </div>
  );
}

// Every contact detail with what the checks made of it, and the reason, so nothing is a bare tick or a bare dash.
export function detailChecks(a) {
  const v = a.verification || {};
  const has = (k) => Boolean(String(a[k] || "").trim());
  const checked = Boolean(v.checked_at);
  const how = ((a.found?.filled || []).find((f) => f.field === "contact_name") || {}).how;
  const todo = (why) => ({ tone: "todo", word: "Not checked yet", why });
  const rows = [];

  const web = v.website || {};
  rows.push({ label: "Website", value: a.website || a.domain || "", ...(!has("website") && !a.domain
    ? { tone: "missing", word: "Missing", why: "We need it to read the company's own pages for a phone, email and contact, and to see that it still trades." }
    : web.state === "live" ? { tone: "good", word: "Working", why: web.note || "The site loads and shows the company name." }
    : web.state === "dead" ? { tone: "bad", word: "Not working", why: "The site didn't load. It may be closed down, or the address is wrong." }
    : web.state === "parked" ? { tone: "bad", word: "Parked or for sale", why: "The address is a placeholder page, so it isn't the company's own site." }
    : checked ? { tone: "todo", word: "Couldn't check", why: "The site didn't answer this time." }
    : todo("Check & improve opens the site to see that it loads and shows the company name.")) });

  const em = v.email || {};
  rows.push({ label: "Email", value: a.email || "", ...(!has("email")
    ? { tone: "missing", word: "Missing", why: "Without an email we can't include this company in an email campaign." }
    : em.state === "verified" ? { tone: "good", word: "Confirmed", why: "The address was found and confirmed for this contact." }
    : em.state === "found" ? { tone: "good", word: "Verified address found", why: "A verified address for this contact was found, shown under fixes." }
    : em.state === "ok" ? { tone: "good", word: "Looks right", why: em.note || "The format and the mail server look right, so it should not bounce." }
    : em.state === "invalid" ? { tone: "bad", word: "Will bounce", why: em.note || "The address failed our test, so it would bounce." }
    : checked ? { tone: "todo", word: "Couldn't check", why: em.note || "The mail server didn't answer this time." }
    : todo("Check & improve tests the address before you send, so it doesn't bounce.")) });

  const ph = v.phone || {};
  rows.push({ label: "Phone", value: a.phone || "", ...(!has("phone")
    ? { tone: "missing", word: "Missing", why: "Needed for calls, and to match the company to its own website." }
    : ph.verified === true ? { tone: "good", word: "Confirmed", why: ph.note || "The phone network confirms the number is real and live." }
    : ph.state === "invalid" ? { tone: "bad", word: "Not usable", why: ph.note || "It isn't a valid number, or the phone network doesn't know it." }
    : ph.state === "unconfirmed" ? { tone: "warn", word: "Not a normal phone line", why: ph.note || "The phone network has it, but not as a mobile or landline." }
    : ph.state === "ok" ? { tone: "warn", word: "Format looks right", why: "The phone network hasn't confirmed it is live yet. Check & improve asks it." }
    : todo("Check & improve asks the phone network whether the number is real and live.")) });
  if (ph.match) rows[rows.length - 1].why += ph.match === "differs" ? ` ${ph.match_note || "The website shows a different number."}` : ` ${ph.match_note || `It matches the company's ${ph.match}.`}`;

  const people = (a.research?.people || []).length;
  rows.push({ label: "Contact", value: a.contact_name ? `${a.contact_name}${a.contact_title ? ` · ${a.contact_title}` : ""}` : "", ...(!has("contact_name")
    ? { tone: "missing", word: "Missing", why: "A message to a named person gets more replies than one to a shared inbox." }
    : how ? { tone: "good", word: "Named", why: "Found by us on the company's own pages, not from your file." }
    : { tone: "good", word: "Named", why: people ? "From your file. Our research found other people too, shown below." : "From your file. We haven't checked it against the company's pages." }) });
  return rows;
}

const TONES = { good: ["#15803D", "#DCFCE7"], warn: ["#92400E", "#FFFBEB"], bad: ["#B91C1C", "#FEE2E2"], todo: ["#475569", "#F1F5F9"], missing: ["#475569", "#F1F5F9"] };

export function DetailChecks({ account }) {
  const rows = detailChecks(account);
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink }}>Checks on each detail</div>
      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: "grid", gridTemplateColumns: "76px minmax(0, 1fr)", gap: "2px 10px", borderLeft: `3px solid ${TONES[r.tone][0]}`, paddingLeft: 10 }}>
            <span style={{ ...text, fontSize: 13, color: C.slate }}>{r.label}</span>
            <span style={{ ...text, fontSize: 13, color: r.value ? C.textInk : C.slateLight, overflowWrap: "anywhere" }}>{r.value || "—"}</span>
            <span />
            <span style={{ ...text, fontSize: 12.5, lineHeight: 1.45, color: C.slate }}>
              <strong style={{ color: TONES[r.tone][0], background: TONES[r.tone][1], borderRadius: 4, padding: "1px 6px", marginRight: 6, fontSize: 11.5 }}>{r.word}</strong>{r.why}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// What a check found for one company: the verdict, why, and how each contact detail looked.
export function CheckDetails({ account }) {
  const v = account?.verification;
  if (!v) return null;
  const why = explainCheck(v);
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, marginRight: "auto" }}>Company check</div>
        <VerdictBadge verification={v} />
      </div>
      <div style={{ ...text, fontSize: 14, fontWeight: 600, color: C.ink }}>{why.headline}</div>
      <div style={{ display: "grid", gridTemplateColumns: "92px minmax(0, 1fr)", gap: "8px 12px", ...text, fontSize: 13, color: C.textInk, lineHeight: 1.5, borderLeft: `3px solid ${(VERDICTS[v.verdict] || {}).color || C.border}`, paddingLeft: 12 }}>
        <span style={{ color: C.slate }}>What we found</span>
        <span>{why.found.map((f, i) => <span key={i} style={{ display: "block" }}>{f}</span>)}</span>
        {why.means ? <><span style={{ color: C.slate }}>What it means</span><span>{why.means}</span></> : null}
        {why.also.length ? <><span style={{ color: C.slate }}>Also noticed</span><span>{why.also.join(" ")}</span></> : null}
        {why.todo ? <><span style={{ color: C.slate }}>What to do</span><span>{why.todo}</span></> : null}
      </div>
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
          announceCreditsChanged();
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
      latest.current.onToast("Started. You can keep using the app.");
      announceCreditsChanged(); // the credits it holds show straight away
      return r.job;
    },
    cancel: async () => {
      if (!jobId) return;
      try { setJob((await api.cancelCompanyCheck(jobId)).job); } catch (e) { latest.current.onToast(e.message || "Couldn't cancel."); }
    },
    pause: async () => {
      if (!jobId) return;
      try { setJob((await api.pauseCompanyCheck(jobId)).job); } catch (e) { latest.current.onToast(e.message || "Couldn't pause."); }
    },
    resume: async () => {
      if (!jobId) return;
      try { setJob((await api.resumeCompanyCheck(jobId)).job); } catch (e) { latest.current.onToast(e.message || "Couldn't resume."); }
    },
    dismiss: () => setJob(null),
  };
}

// What the run is doing right now, in plain words, from how much of each step has been done so far.
const USED_WORDS = [["registry", "asked the company register"], ["deep", "searched the web for"], ["phone", "checked the phone network for"],
  ["web", "researched"], ["email", "found emails for"]];
function liveLine(job) {
  const bits = USED_WORDS.filter(([k]) => job.used?.[k]).map(([k, w]) => `${w} ${job.used[k].toLocaleString()}`);
  const started = job.started_at ? new Date(job.started_at + (job.started_at.endsWith("Z") ? "" : "Z")).getTime() : 0;
  let eta = "";
  if (job.status === "running" && !job.pause && started && job.done >= 3) {
    const left = Math.max(0, Math.round(((Date.now() - started) / job.done) * (job.total - job.done) / 1000));
    eta = left < 60 ? "less than a minute left" : `about ${Math.round(left / 60)} min left`;
  }
  return [bits.length ? `So far we've ${bits.join(", ")}.` : "Starting up: matching each company against our records.", eta].filter(Boolean).join(" ");
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
          {running ? `${job.pause ? "Paused at" : "Checking"} ${job.done.toLocaleString()} of ${job.total.toLocaleString()}` : job.status === "done" ? `Checked ${job.done.toLocaleString()} companies`
            : job.status === "cancelled" ? `Cancelled after ${job.done.toLocaleString()} of ${job.total.toLocaleString()}` : `Stopped after ${job.done.toLocaleString()} of ${job.total.toLocaleString()}`}
        </div>
        {running ? (
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title={job.pause ? "Carry on from where it stopped" : "Hold the check. Nothing more is spent until you resume"} onClick={job.pause ? check.resume : check.pause}>{job.pause ? "Resume" : "Pause"}</button>
        ) : null}
        {running ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Stop now. Companies already checked keep their results, and unused credits are given back" onClick={check.cancel}>Cancel</button> : null}
        {!running && pendingCount > 0 ? <button title="Check the companies that are still waiting, again" type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onRecheck}><RefreshCw size={13} /> Re-check {pendingCount} pending</button> : null}
        {!running ? <button type="button" className="ui-icon-btn" aria-label="Dismiss" onClick={check.dismiss}><X size={16} /></button> : null}
      </div>
      {running ? <div style={{ ...muted, fontSize: 12.5 }}>{job.pause ? "Paused. Nothing more is spent until you resume." : liveLine(job)}</div> : null}
      {running ? (
        <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, borderRadius: 3, background: C.paperSoft, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "var(--ui-accent)", transition: "width .4s" }} />
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
  // Phone and email checks are part of every run, not options: a company isn't checked until both are.
  const email = true, phone = true;
  const [web, setWeb] = useState(true);
  const [est, setEst] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setEst(null);
    api.estimateCompanyCheck({ ids, pending_only: pendingOnly, include_email: email, include_web: web, include_phone: phone })
      .then((r) => { if (alive) setEst(r); })
      .catch((e) => { if (alive) setError(e.message || "Couldn't work out the cost."); });
    return () => { alive = false; };
  }, [ids, pendingOnly, email, web, phone]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const go = async () => {
    setBusy(true);
    setError("");
    try {
      await onStart({ ids, pending_only: pendingOnly, include_email: email, include_web: web, include_phone: phone });
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
      <div role="dialog" aria-label="Check & improve" onClick={(e) => e.stopPropagation()} className="ui-card"
        style={{ width: "min(100%, 520px)", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ ...text, fontSize: 16, fontWeight: 600, color: C.ink, marginRight: "auto" }}>
            Check & improve {est ? est.companies.toLocaleString() : ids.length.toLocaleString()} {(est ? est.companies : ids.length) === 1 ? "company" : "companies"}
          </div>
          <button type="button" className="ui-icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={muted}>Each company is corrected and completed one step at a time, cheapest first. Blanks are filled in. A value you gave that looks wrong is never overwritten: it is offered as a fix you can accept, with your original kept beside it.</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          <li style={li}><strong>Our records</strong>, plus website and email format checks: free</li>
          <li style={li}><strong>Company register</strong>, asked directly when our records can't settle it: {est ? `${est.rates.check_registry} credit${est.rates.check_registry === 1 ? "" : "s"} each` : "…"}{est && !est.ready.registry ? " (not set up yet, so skipped)" : ""}</li>
          <li style={li}><strong>Deep web search</strong>, only if nothing above knows the company: {est ? `${est.rates.google_deep_search} credits each` : "…"}{est && !est.ready.deep ? " (not set up yet, so skipped)" : ""}</li>
          <li style={li}><strong>Every phone number</strong>, asked of the phone network: {est ? (!est.ready.phone ? "not set up yet, so skipped" : `${est.rates.lead_phone_check} credit${est.rates.lead_phone_check === 1 ? "" : "s"} per 5 numbers, ${est.phone_rows.toLocaleString()} to check. Numbers checked in the last 30 days are free`) : "…"}</li>
          <li style={li}><strong>Every email</strong>, tested before you send, and the work email of each named contact found or confirmed: {est ? (!est.ready.email ? "not set up yet, so skipped" : `${est.rates.check_email} credits for each verified email found, ${est.with_contact.toLocaleString()} have a contact name to look up`) : "…"}</li>
        </ul>
        <label title="A live search of the open web for the company's people, phone numbers and emails" style={{ ...li, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            Also search the web for each company's people, phones and emails{est ? ` (${est.rates.lead_lookup} credits for each company where something is found)` : ""}
            <span style={{ ...muted, display: "block", fontSize: 12 }}>
              {est ? `${est.web_rows.toLocaleString()} of these haven't been looked up yet. Ones already looked up are skipped.` : ""}
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
          <button type="button" className="ui-btn ui-btn--ghost" title="Put the choices back to how they were" onClick={() => { setWeb(true); setError(""); }}>Reset</button>
          <button title="Close without saving" type="button" className="ui-btn ui-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="ui-btn ui-btn--primary" title="Start now. You can pause or cancel any time, and unused credits are given back" disabled={!est || busy || est.companies === 0} onClick={go}>{busy ? "Starting…" : "Start"}</button>
        </div>
      </div>
    </div>
  );
}
