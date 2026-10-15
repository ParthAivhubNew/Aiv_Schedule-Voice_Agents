import React, { useEffect, useState } from "react";
import { Lock, Phone, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";
import { missingNames, openPlans, useConnection } from "../../hooks/useConnections";
import { navigateHash } from "../../utils/route";

// Calling Lead Gen companies with the Voice plan: a button that is locked (and says why) without it, and one
// box that shows who can be called, who is held back and why, what it will use, and starts the calls.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 13, color: C.slate, lineHeight: 1.5 };

export const SKIP_WORDS = {
  no_phone: "have no phone number",
  failed_check: "have a number that failed the check",
  do_not_call: "are on your do-not-contact list",
  recently_called: "were contacted recently",
  already_queued: "are already in a running call round",
  outside_hours: "can't be called at this hour",
};

const overlay = { position: "fixed", inset: 0, background: "rgba(15,18,28,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };

// ── The button ──────────────────────────────────────────────────────────────
export function CallButton({ onClick, label = "Call", lockedLabel = "Call · add Voice", size = "sm", variant = "secondary", disabled = false, title = "", onLocked }) {
  const { available, loading, missing } = useConnection("call_leads");
  const locked = !loading && !available;
  const cls = `ui-btn ui-btn--${variant} ${size === "sm" ? "ui-btn--sm" : ""}`;
  return (
    <button type="button" className={cls} disabled={disabled || loading}
      title={locked ? `Phoning leads needs ${missingNames(missing) || "the Voice plan"}. Click to see how it works.` : (title || "Have your AI caller phone them")}
      onClick={() => (locked ? onLocked?.() : onClick?.())}>
      {locked ? <Lock size={13} /> : <Phone size={13} />} {locked ? lockedLabel : label}
    </button>
  );
}

// ── The box ─────────────────────────────────────────────────────────────────
// target: { kind: "list", id, name } | { kind: "selected", ids, name } | { kind: "one", id, name }
export function CallDialog({ target, onClose, onToast, upsell = false }) {
  const { available, missing, loading: planLoading } = useConnection("call_leads");
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState(false);
  const [lines, setLines] = useState({}); // lead id -> the opening line the user edited
  const [open, setOpen] = useState(false);
  const [concurrency, setConcurrency] = useState(2);
  const [lowMinutes, setLowMinutes] = useState("");

  const body = () => ({ ids: target.ids || [], override_recontact: override, hooks: lines, concurrency: target.kind === "one" ? 1 : concurrency });
  const preview = async () => {
    setError("");
    try {
      if (target.kind === "list") return setPlan(await api.previewListCalls(target.id, body()));
      if (target.kind === "one") return setPlan(await api.previewCallOne(target.id, body()));
      return setPlan(await api.previewCalls(body()));
    } catch (e) {
      setPlan(null);
      setError(e.message || "Couldn't check who can be called.");
    }
  };
  useEffect(() => {
    if (planLoading || !available || upsell) return;
    preview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planLoading, available, override]);

  const start = async (acceptLow = false) => {
    setBusy(true);
    setError("");
    setLowMinutes("");
    const payload = { ...body(), accept_low_minutes: acceptLow, title: target.name ? `Calls: ${target.name}` : "" };
    try {
      const res = target.kind === "list" ? await api.callList(target.id, payload)
        : target.kind === "one" ? await api.callNow(target.id, payload)
        : await api.callCompanies(payload);
      onToast?.(`Calling ${res.called} ${res.called === 1 ? "company" : "companies"}.${res.skipped_text ? ` Held back: ${res.skipped_text}.` : ""}`);
      onClose();
      navigateHash("#/voice/live");
    } catch (e) {
      if (e.code === "LOW_MINUTES") setLowMinutes(e.message);
      else setError(e.message || "Couldn't start the calls.");
    } finally {
      setBusy(false);
    }
  };

  const locked = upsell || (!planLoading && !available);
  const callable = plan?.callable?.length || 0;
  const skipped = plan ? Object.entries(plan.skipped || {}).filter(([, ids]) => ids.length) : [];
  const cost = plan?.cost;
  return (
    <div onClick={onClose} style={overlay}>
      <div role="dialog" aria-label="Call these companies" onClick={(e) => e.stopPropagation()} className="ui-card"
        style={{ width: "min(100%, 560px)", maxHeight: "88vh", overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ ...text, fontSize: 16, fontWeight: 600, color: C.ink, flex: 1 }}>
            {target.kind === "one" ? `Call ${target.name}` : `Call ${target.name || "these companies"}`}
          </div>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" aria-label="Close" onClick={onClose}><X size={14} /></button>
        </div>

        {locked ? (
          <>
            <div style={muted}>
              Your AI caller can phone the companies in your lists, read what you know about each one, and book meetings straight into your calendar.
              That is part of the Voice plan{missing.length ? `, and ${missingNames(missing)} isn't on your account yet` : ""}.
            </div>
            <div style={{ ...muted, background: C.paperSoft, padding: 10, borderRadius: 8 }}>
              Everything you have found stays exactly as it is. When you add Voice, the Call buttons switch on by themselves.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="ui-btn ui-btn--ghost" onClick={onClose}>Not now</button>
              <button type="button" className="ui-btn ui-btn--primary" onClick={() => { onClose(); openPlans("voice"); }}>See Voice plans</button>
            </div>
          </>
        ) : (
          <>
            {!plan && !error ? <div style={muted}>Checking who can be called…</div> : null}
            {plan ? (
              <>
                <div style={{ ...text, fontSize: 14, color: C.ink }}>
                  <b>{callable.toLocaleString()}</b> of {plan.total.toLocaleString()} can be called now.
                </div>
                {skipped.length ? (
                  <ul style={{ ...muted, margin: 0, paddingLeft: 18 }}>
                    {skipped.map(([k, ids]) => <li key={k}>{ids.length.toLocaleString()} {SKIP_WORDS[k] || k}</li>)}
                  </ul>
                ) : null}
                {plan.recall_days ? (
                  <label style={{ ...muted, display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                    Include companies contacted in the last {plan.recall_days} days
                  </label>
                ) : null}
                {callable ? (
                  <>
                    <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" style={{ alignSelf: "flex-start" }} onClick={() => setOpen((v) => !v)}>
                      {open ? "Hide the opening lines" : "See and edit the opening lines"}
                    </button>
                    {open ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 260, overflowY: "auto" }}>
                        {plan.people.slice(0, 50).map((p) => (
                          <div key={p.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 8 }}>
                            <div style={{ ...text, fontSize: 13, fontWeight: 600, color: C.ink }}>{p.name} <span style={{ ...muted, fontWeight: 400 }}>{p.phone}{p.contact ? ` · ${p.contact}` : ""}</span></div>
                            {p.warning ? <div style={{ ...muted, color: C.amber }}>{p.warning}</div> : null}
                            <textarea className="ui-input" rows={2} style={{ width: "100%", marginTop: 4, boxSizing: "border-box" }}
                              placeholder="No research yet, so your AI caller will open in its usual way. Type a line to use instead."
                              value={lines[p.id] ?? p.opening_line} onChange={(e) => setLines((prev) => ({ ...prev, [p.id]: e.target.value }))} />
                            {p.contact ? <div style={{ ...muted, fontSize: 12 }}>Your AI caller asks for {p.contact} first, and if they're out asks when to ring back.</div> : null}
                          </div>
                        ))}
                        {plan.people.length > 50 ? <div style={muted}>…and {plan.people.length - 50} more use their saved research.</div> : null}
                      </div>
                    ) : null}
                    {target.kind !== "one" ? (
                      <label style={{ ...muted, display: "flex", gap: 8, alignItems: "center" }}>
                        Calls at the same time
                        <select className="ui-input" style={{ width: 70 }} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))}>
                          <option value={1}>1</option><option value={2}>2</option>
                        </select>
                      </label>
                    ) : null}
                    <div style={{ ...muted, background: C.paperSoft, padding: 10, borderRadius: 8 }}>
                      Uses your <b>Voice</b> minutes.
                      {cost?.minutes_left != null ? <> You have {cost.minutes_left} left{cost.minutes_needed != null ? `; this round may use about ${cost.minutes_needed}` : ""}.</> : null}
                      {cost && cost.enough === false ? <> That is more than you have, so the round pauses when they run out and carries on after a top-up. <button type="button" className="ui-link" onClick={() => { onClose(); openPlans("voice"); }}>Top up</button></> : null}
                    </div>
                  </>
                ) : (
                  <div style={muted}>Nobody here can be called right now. Fix the numbers in Check & improve, or wait for the hold to pass.</div>
                )}
              </>
            ) : null}
            {lowMinutes ? (
              <div role="alert" style={{ ...muted, color: C.amber }}>
                {lowMinutes}
                <div style={{ marginTop: 6 }}><button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy} onClick={() => start(true)}>Call anyway</button></div>
              </div>
            ) : null}
            {error ? <div role="alert" style={{ ...text, fontSize: 13, color: C.red }}>{error}</div> : null}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="ui-btn ui-btn--ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="ui-btn ui-btn--primary" disabled={busy || !callable} onClick={() => start(false)}>
                <Phone size={14} /> {busy ? "Starting…" : `Call ${callable.toLocaleString()}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// One place to hold the open box: const call = useCallDialog(toast); <CallButton onClick={() => call.open(target)} onLocked={() => call.open(target, true)} /> {call.dialog}
export function useCallDialog(onToast) {
  const [state, setState] = useState(null);
  return {
    open: (target, upsell = false) => setState({ target, upsell }),
    dialog: state ? <CallDialog target={state.target} upsell={state.upsell} onToast={onToast} onClose={() => setState(null)} /> : null,
  };
}
