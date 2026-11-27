import React, { useEffect, useState } from "react";
import { CheckCircle2, Circle, X } from "lucide-react";
import { C, FONT_DISPLAY, FONT_BODY } from "../tokens";
import { api } from "../api/apiClient";
import { sendDraft } from "../utils/draftHandoff";

const HIDE_KEY = "outreach_onboarding_hidden";

function hidden(orgId) {
  try {
    return localStorage.getItem(`${HIDE_KEY}:${orgId}`) === "1";
  } catch (_) {
    return false;
  }
}

// First steps for a new organisation, shown to admins on the home screen until done or hidden (plan 11, C.6). The steps and whether each
// is done come from the server (GET /auth/onboarding), which picks them for the apps the company has.
// A step's "go" is either an in-app path ("#/voice/hours") or "team:<tab>". A step with a "sample" ({filters, label}) opens Find Leads
// on that search, already run: the company's own ideal customers, or a sample (GET /auth/onboarding).
// It now lives in Settings → Company → Getting started (plan 13, step 5), always shown there, done or not; Home shows only the next
// step (NextStep below).
export function OnboardingChecklist({ operator, onGo }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!operator?.is_admin) return;
    api.getOnboarding().then(setData).catch(() => setData(null));
  }, [operator]);

  if (!operator?.is_admin || !data) return null;

  const pct = Math.round((data.done / data.total) * 100);
  return (
    <div style={{ width: "100%", maxWidth: 720 }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginBottom: 8 }}>{data.done} of {data.total} done</div>
      <div style={{ height: 6, background: C.paperSoft, borderRadius: 3, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: C.teal }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 6 }}>
        {data.steps.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              if (s.done) return;
              if (s.sample?.filters) sendDraft({ filters: s.sample.filters, meta: { sample: !s.sample.own, own: Boolean(s.sample.own) } });
              onGo(s.go);
            }}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, border: `1px solid ${s.done ? "transparent" : C.border}`, background: s.done ? C.paperSoft : C.surface, cursor: s.done ? "default" : "pointer", fontFamily: FONT_BODY, fontSize: 13, color: s.done ? C.slate : C.textInk, textAlign: "left", textDecoration: s.done ? "line-through" : "none" }}
          >
            {s.done ? <CheckCircle2 size={15} color={C.teal} /> : <Circle size={15} color={C.slateLight} />}
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              {s.label}
              {!s.done && s.sample?.label ? <span style={{ fontSize: 11.5, color: C.slate, textDecoration: "none" }}>{s.sample.label}</span> : null}
            </span>
          </button>
        ))}
      </div>
      {data.credits ? (
        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 10, lineHeight: 1.5 }}>
          {data.credits}{" "}
          {data.creditsHelp ? <a href={data.creditsHelp} target="_blank" rel="noreferrer" style={{ color: C.cobalt }}>How credits work</a> : null}
        </div>
      ) : null}
    </div>
  );
}

// Home's one card (plan 13, 3.3): the single most useful unfinished first step, not the whole list. It goes once every step is done or
// the person hides it; the full list stays in Settings → Getting started.
export function NextStep({ operator, onGo }) {
  const [data, setData] = useState(null);
  const [closed, setClosed] = useState(() => hidden(operator?.org_id));
  useEffect(() => {
    if (!operator?.is_admin || closed) return;
    api.getOnboarding().then(setData).catch(() => setData(null));
  }, [operator, closed]);
  const step = data && data.steps.find((s) => !s.done);
  if (!operator?.is_admin || closed || !step) return null;
  const hide = () => {
    try { localStorage.setItem(`${HIDE_KEY}:${operator.org_id}`, "1"); } catch (_) {}
    setClosed(true);
  };
  const go = () => {
    if (step.sample?.filters) sendDraft({ filters: step.sample.filters, meta: { sample: !step.sample.own, own: Boolean(step.sample.own) } });
    onGo(step.go);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", marginBottom: 28 }}>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate }}>Next step · {data.done} of {data.total} done</div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 15.5, fontWeight: 600, color: C.textInk, marginTop: 2 }}>{step.label}</div>
        {step.sample?.label ? <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 2 }}>{step.sample.label}</div> : null}
      </div>
      <button type="button" className="ui-btn ui-btn--ghost" onClick={() => onGo("#/settings/getting-started")}>See all steps</button>
      <button type="button" className="ui-btn ui-btn--primary" onClick={go}>Start</button>
      <button type="button" aria-label="Hide the next step" title="Hide" onClick={hide} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, display: "flex" }}>
        <X size={16} />
      </button>
    </div>
  );
}
