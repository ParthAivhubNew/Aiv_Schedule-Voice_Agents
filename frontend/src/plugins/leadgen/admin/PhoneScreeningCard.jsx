import React, { useCallback, useEffect, useState } from "react";
import { C } from "../../../tokens";
import { api } from "../../../api/apiClient";
import { confirmTwice } from "./confirmChange";
import { card, muted, text } from "./adminUi";

export const SCREENING_TITLE = "Phone screening";
export const SCREENING_SWITCH = "Check phone numbers against the TPS and CTPS registers automatically.";
export const screeningCostLine = (credits = 2) => `Uses credits: ${credits} credits per 5 numbers checked. Numbers checked in the last 28 days are free.`;
export const SCREENING_LOAD_ERROR = "Couldn't load phone screening. Try again.";
export const SCREENING_SAVE_ERROR = "Couldn't save. Try again.";

export function screeningChanges(turnOn, credits = 2) {
  return turnOn
    ? ["Turn on automatic TPS and CTPS checks", `Numbers on companies you save from now on are checked. This uses ${credits} credits per 5 numbers checked`]
    : ["Turn off automatic TPS and CTPS checks", "Saved numbers are no longer checked unless someone starts a check"];
}

// The drawing, apart from the loading, so each state can be shown on its own.
export function PhoneScreeningBody({ state, busy, error, saved, onToggle }) {
  const on = !!(state && state.enabled);
  const notice = state && state.notice && state.notice.text;
  return (
    <section style={{ ...card, padding: 14, display: "grid", gap: 10, maxWidth: 760 }} aria-labelledby="ps-title">
      <h3 id="ps-title" style={{ ...text, margin: 0, fontSize: 16, color: C.textInk }}>{SCREENING_TITLE}</h3>
      <label htmlFor="ps-switch" style={{ display: "flex", gap: 12, alignItems: "flex-start", minHeight: 44, cursor: state && !busy ? "pointer" : "default" }}>
        <input id="ps-switch" type="checkbox" role="switch" checked={on} disabled={!state || busy} aria-describedby="ps-cost" onChange={() => onToggle(!on)} style={{ width: 24, height: 24, marginTop: 2, flex: "none" }} />
        <span style={{ ...text, fontSize: 14, color: C.textInk, lineHeight: 1.5 }}>{SCREENING_SWITCH}</span>
      </label>
      <p id="ps-cost" style={{ ...muted, margin: 0 }}>{screeningCostLine(state ? state.credits_per_five : 2)}</p>
      {notice ? <div role="status" style={{ ...text, fontSize: 13.5, color: C.textInk, background: C.amberSoft, borderRadius: 8, padding: "8px 10px" }}>{notice}</div> : null}
      <div role="status" aria-live="polite" style={{ ...muted, color: C.textInk, minHeight: saved ? 20 : 0 }}>{saved || ""}</div>
      {error ? <div role="alert" style={{ ...text, fontSize: 13.5, color: C.red }}>{error}</div> : null}
    </section>
  );
}

export function PhoneScreeningCard() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const load = useCallback(async () => {
    try { setState(await api.getAutoTps()); setError(""); } catch (e) { setError(e.message || SCREENING_LOAD_ERROR); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const toggle = async (turnOn) => {
    const sure = await confirmTwice({ title: turnOn ? "Turn on automatic phone screening?" : "Turn off automatic phone screening?", changes: screeningChanges(turnOn, state && state.credits_per_five), subject: "phone screening" });
    if (!sure) return;
    setBusy(true); setError(""); setSaved("");
    try {
      setState(await api.setAutoTps(turnOn));
      setSaved(turnOn ? "Automatic phone screening is on." : "Automatic phone screening is off.");
    } catch (e) {
      setError(e.message || SCREENING_SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <PhoneScreeningBody state={state} busy={busy} error={error} saved={saved} onToggle={toggle} />
      {error && !state ? <button type="button" className="ui-btn ui-btn--secondary" style={{ minHeight: 44, justifySelf: "start" }} onClick={load}>Try again</button> : null}
    </div>
  );
}
