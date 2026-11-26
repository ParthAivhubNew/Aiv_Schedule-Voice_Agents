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
export function OnboardingChecklist({ operator, onGo }) {
  const [data, setData] = useState(null);
  const [closed, setClosed] = useState(() => hidden(operator?.org_id));

  useEffect(() => {
    if (!operator?.is_admin || closed) return;
    api.getOnboarding().then(setData).catch(() => setData(null));
  }, [operator, closed]);

  if (!operator?.is_admin || closed || !data || data.done >= data.total) return null;

  const hide = () => {
    try {
      localStorage.setItem(`${HIDE_KEY}:${operator.org_id}`, "1");
    } catch (_) {}
    setClosed(true);
  };

  const pct = Math.round((data.done / data.total) * 100);
  return (
    <div style={{ width: "100%", maxWidth: 720, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: "18px 20px", marginBottom: 32, boxShadow: "0 10px 30px rgba(18,20,28,0.05)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.textInk }}>Get started</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>{data.done} of {data.total} done</div>
        </div>
        <button aria-label="Hide get started" title="Hide" onClick={hide} style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight }}>
          <X size={16} />
        </button>
      </div>
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
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, border: `1px solid ${s.done ? "transparent" : C.border}`, background: s.done ? C.paperSoft : "#fff", cursor: s.done ? "default" : "pointer", fontFamily: FONT_BODY, fontSize: 13, color: s.done ? C.slate : C.textInk, textAlign: "left", textDecoration: s.done ? "line-through" : "none" }}
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
