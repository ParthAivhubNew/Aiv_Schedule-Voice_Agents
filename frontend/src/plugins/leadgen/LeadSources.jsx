import React, { useEffect, useState } from "react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../tokens";

// The "Lead sources" card on Lists (plan 10, Phase 2): the company's saved companies by how they joined and how far each group got, and
// where their phones, emails and websites came from. Read from GET /leadgen/sources/summary; nothing is worked out in the browser.

const text = { fontFamily: FONT_BODY };
const FIELD = { phone: "Phones", email: "Emails", website: "Websites" };
const STEPS = [["contacted", "Contacted"], ["meeting", "Meeting"], ["won", "Won"]];
const num = (n) => Number(n || 0).toLocaleString("en-GB");

// "1,450 of 2,488 (58%)"
export function coverageLine(withValue, total) {
  if (!total) return "0";
  return `${num(withValue)} of ${num(total)} (${Math.round((withValue / total) * 100)}%)`;
}

// "Also 120 credits on searches and 15 on companies you removed since." from the summary's credits; "" when there are none.
export function creditsLine(c) {
  if (!c) return "";
  const parts = [c.searches ? `${num(c.searches)} on searches (Find Leads and the assistant)` : "", c.removed ? `${num(c.removed)} on companies you've removed since` : ""].filter(Boolean);
  return parts.length ? `Also ${parts.join(" and ")}.` : "";
}

export function LeadSourcesCard({ initialData = null }) {
  const [data, setData] = useState(initialData);
  const [error, setError] = useState("");
  useEffect(() => {
    if (initialData) return undefined;
    let alive = true;
    Promise.resolve()
      .then(() => api.getLeadSourcesSummary())
      .then((res) => alive && setData(res))
      .catch(() => alive && setError("hidden"));
    return () => {
      alive = false;
    };
  }, [initialData]);
  if (error || !data || !data.total) return null; // a summary that can't load leaves the Lists page as it was
  return (
    <section aria-label="Lead sources" className="ui-card" style={{ ...text, padding: 16, display: "grid", gap: 14 }}>
      <div>
        <strong style={{ fontSize: 14, color: C.ink }}>Lead sources</strong>
        <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2 }}>How your {num(data.total)} saved companies joined, how far each group got, what each group cost in credits, and where their details came from.</div>
      </div>
      <div className="ui-scroll" style={{ overflowX: "auto" }}>
        <table className="ui-table" style={{ minWidth: 460 }}>
          <thead>
            <tr>
              <th>Came from</th>
              <th style={{ textAlign: "right" }}>Companies</th>
              {STEPS.map(([k, label]) => <th key={k} style={{ textAlign: "right" }} title={`Reached ${label.toLowerCase()} or further`}>{label}</th>)}
              <th style={{ textAlign: "right" }} title="Leads credits spent on look-ups, checks and e-mails for these companies">Credits</th>
            </tr>
          </thead>
          <tbody>
            {data.origins.map((o) => (
              <tr key={o.key}>
                <td>{o.label}</td>
                <td style={{ textAlign: "right" }}>{num(o.count)}</td>
                {STEPS.map(([k]) => <td key={k} style={{ textAlign: "right", color: o.reached[k] ? C.textInk : C.slateLight }}>{num(o.reached[k])}</td>)}
                <td style={{ textAlign: "right", color: o.credits ? C.textInk : C.slateLight }}>{num(o.credits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creditsLine(data.credits) ? <div style={{ fontSize: 12.5, color: C.slate }}>{creditsLine(data.credits)}</div> : null}
      <div style={{ display: "grid", gap: 6 }}>
        {data.coverage.map((f) => (
          <div key={f.field} style={{ fontSize: 13, lineHeight: 1.45 }}>
            <span style={{ fontWeight: 600, color: C.ink }}>{FIELD[f.field]}: </span>
            <span style={{ color: C.textInk }}>{coverageLine(f.with, data.total)}</span>
            {f.bySource.length ? <span style={{ color: C.slate }}> · {f.bySource.map((s) => `${s.label} ${num(s.count)}`).join(", ")}</span> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
