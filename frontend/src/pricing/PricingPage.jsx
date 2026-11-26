import React, { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { api } from "../api/apiClient";
import { BrandLockup } from "../hub/BrandMark";
import { planName } from "../hub/planName";
import { C, FONT_BODY, FONT_DISPLAY } from "../tokens";
import { actionPrice, appsInOrder, creditsLine, money } from "./pricingLogic";

// The public price list at /pricing (plan 11, C.6): each app's plans and top-ups, and what each paid action costs, all from the server
// (GET /auth/pricing). Nothing is typed in here. A brand's own address has its own prices, so the page says to ask the organisation.

const page = { minHeight: "100vh", background: C.paper, fontFamily: FONT_BODY, color: C.textInk };
const wrap = { maxWidth: 1040, margin: "0 auto", padding: "32px 16px 64px" };
const card = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 10 };

function PlanCard({ app, plan }) {
  return (
    <div style={card}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>{planName(plan.name)}</div>
      <div>
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 30, color: C.ink }}>{money(plan.priceCents, plan.currency)}</span>
        <span style={{ fontSize: 13, color: C.slate }}> a month</span>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{creditsLine(app.id, plan.credits)}</div>
      {plan.description ? <div style={{ fontSize: 13, color: C.slate, lineHeight: 1.5 }}>{plan.description}</div> : null}
      {[...plan.features, ...plan.limits].length ? (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {[...plan.features, ...plan.limits].map((f) => (
            <li key={f} style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.45 }}>
              <Check size={15} color={C.success} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />{f}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function PricingPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.getPricing().then(setData).catch((e) => setError(e?.message || "The prices couldn't be loaded. Try again in a moment."));
  }, []);
  const apps = appsInOrder(data?.apps);

  return (
    <div style={page}>
      <header style={{ height: 60, borderBottom: `1px solid ${C.border}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", gap: 12 }}>
        <a href="/" style={{ textDecoration: "none" }}><BrandLockup size={26} /></a>
        <nav style={{ display: "flex", gap: 8 }}>
          <a href="/signin" className="ui-btn ui-btn--ghost ui-btn--sm">Sign in</a>
          {data?.signupOpen ? <a href="/signup" className="ui-btn ui-btn--primary ui-btn--sm">Create an account</a> : null}
        </nav>
      </header>
      <main style={wrap}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, margin: "0 0 8px", color: C.ink }}>Prices</h1>
        <p style={{ margin: "0 0 6px", fontSize: 15, color: C.slate, lineHeight: 1.55, maxWidth: 720 }}>
          Each app has its own plan and its own credits. A plan gives you credits every month; paid actions use them at the prices below.
          Running out in one app pauses only that app.
        </p>
        <p style={{ margin: "0 0 28px", fontSize: 13, color: C.slate }}>
          {data?.vatAdded ? "Prices are before VAT, which is added at checkout. " : ""}
          <a href="/help/account#plans-and-credits" style={{ color: C.cobalt }}>How credits work</a>
        </p>

        {error ? <div role="alert" style={{ color: C.dangerInk, fontSize: 14 }}>{error}</div> : null}
        {!data && !error ? <div role="status" style={{ color: C.slate, fontSize: 14 }}>Loading the prices…</div> : null}
        {data && data.available === false ? (
          <div style={{ ...card, maxWidth: 560 }}>Your organisation arranges prices for this service. Ask your organisation, or sign in to see your plan.</div>
        ) : null}
        {data?.available && !apps.length ? <div style={{ color: C.slate, fontSize: 14 }}>Prices will be published here soon.</div> : null}

        {apps.map((app) => (
          <section key={app.id} aria-labelledby={`price-${app.id}`} style={{ marginBottom: 40 }}>
            <h2 id={`price-${app.id}`} style={{ fontFamily: FONT_DISPLAY, fontSize: 21, margin: "0 0 14px", color: C.ink }}>{app.name}</h2>
            {app.plans.length ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
                {app.plans.map((p) => <PlanCard key={p.id} app={app} plan={p} />)}
              </div>
            ) : null}
            {app.topups.length ? (
              <div style={{ marginTop: 14, fontSize: 13.5, color: C.textInk }}>
                <strong>Top-ups:</strong>{" "}
                {app.topups.map((t, i) => (
                  <span key={t.id}>{i ? " · " : ""}{creditsLine(app.id, t.credits, { monthly: false })} for {money(t.priceCents, t.currency)}</span>
                ))}
              </div>
            ) : null}
            {app.actions.length ? (
              <details style={{ marginTop: 14 }}>
                <summary style={{ cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: C.cobalt }}>What each action costs in credits</summary>
                <table style={{ marginTop: 10, borderCollapse: "collapse", width: "100%", maxWidth: 640, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10 }}>
                  <tbody>
                    {app.actions.map((a) => (
                      <tr key={a.item}>
                        <td style={{ padding: "8px 12px", borderTop: `1px solid ${C.border}`, fontSize: 13 }}>{a.label}</td>
                        <td style={{ padding: "8px 12px", borderTop: `1px solid ${C.border}`, fontSize: 13, textAlign: "right", whiteSpace: "nowrap" }}>{actionPrice(a)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ) : null}
          </section>
        ))}
      </main>
    </div>
  );
}
