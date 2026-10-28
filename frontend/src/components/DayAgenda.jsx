import React, { useEffect, useState } from "react";
import { Loader } from "../app/Loader";
import { ChevronRight } from "lucide-react";
import { api } from "../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY } from "../tokens";
import { navigateHash } from "../utils/route";
import { formatOrgTime, useOrg } from "../org/orgSettings";

// One day across every app the company has: the app being looked at first, then the others.
// `hideKinds` leaves out what the calling screen already shows itself (its own meetings, its own posts).
const DOT = { leads: "#8B5CF6", voice: C.cobalt, social: C.teal };

export function DayAgenda({ date, focus, hideKinds = [], heading = "Across your apps", compact = false }) {
  const org = useOrg() || {};
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    if (!date) return undefined;
    let live = true;
    setState((s) => (data ? "refreshing" : "loading"));
    api.getAgenda({ date, focus })
      .then((d) => { if (live) { setData(d); setState("ok"); } })
      .catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [date, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = ((data && data.groups) || [])
    .map((g) => ({ ...g, items: g.items.filter((i) => !hideKinds.includes(i.kind)) }))
    .filter((g) => g.items.length);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <section aria-label={heading} aria-busy={state === "loading" || state === "refreshing"} style={{ fontFamily: FONT_BODY }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <strong style={{ fontFamily: FONT_DISPLAY, fontSize: compact ? 14 : 15, color: C.ink, marginRight: "auto" }}>{heading}</strong>
        {total ? <span style={{ fontSize: 12, color: C.slate }}>{total} thing{total === 1 ? "" : "s"}</span> : null}
      </div>
      {state === "loading" && !data ? <Loader compact label="Loading the day" /> : null}
      {state === "error" ? <div style={{ fontSize: 13, color: C.slate }}>The day could not be loaded just now. Try again in a moment.</div> : null}
      {data && !total && state !== "error" ? <div style={{ fontSize: 13, color: C.slate }}>Nothing else is planned for this day.</div> : null}
      <div style={{ display: "grid", gap: 14, opacity: state === "refreshing" ? 0.6 : 1 }}>
        {groups.map((g) => (
          <div key={g.plugin}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: C.slate, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 99, background: DOT[g.plugin] || C.slate }} />
              {g.label}
              <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· {g.items.length}</span>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {g.items.map((it) => (
                <button key={`${it.kind}:${it.id}:${it.time}`} type="button" onClick={() => navigateHash(it.href)} title={`Open in ${g.label}`}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 48, padding: "8px 12px", textAlign: "left", border: `1px solid ${C.border}`, borderLeft: `3px solid ${DOT[g.plugin] || C.slate}`, borderRadius: 10, background: "#fff", cursor: "pointer", fontFamily: FONT_BODY }}>
                  <span style={{ width: 52, flexShrink: 0, fontSize: 12.5, fontWeight: 700, color: it.time ? C.ink : C.slate, fontVariantNumeric: "tabular-nums" }}>
                    {it.time ? formatOrgTime(it.time, org.timeFormat) : "All day"}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</span>
                    {it.detail || it.status ? (
                      <span style={{ display: "block", fontSize: 12, color: C.slate, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {[it.status, it.detail].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight size={15} color={C.slate} style={{ flexShrink: 0 }} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Leads has no calendar of its own, so this is its page for a day: step through the days, with Leads' own things first.
export function TodayView({ focus = "leads" }) {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [day, setDay] = useState(() => iso(new Date()));
  const shift = (n) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); setDay(iso(d)); };
  const label = new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const btn = { height: 36, padding: "0 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff", color: C.ink, cursor: "pointer", fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13 };
  return (
    <div className="ui-card" style={{ padding: 18, maxWidth: 760 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <button type="button" style={btn} onClick={() => shift(-1)} aria-label="Previous day" title="Previous day">‹</button>
        <button type="button" style={btn} onClick={() => shift(1)} aria-label="Next day" title="Next day">›</button>
        <button type="button" style={btn} onClick={() => setDay(iso(new Date()))} title="Back to today">Today</button>
        <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Pick a day" title="Pick a day" style={{ ...btn, fontWeight: 500 }} />
        <strong style={{ fontFamily: FONT_DISPLAY, fontSize: 16, color: C.ink, marginLeft: "auto" }}>{label}</strong>
      </div>
      <DayAgenda date={day} focus={focus} heading="What is planned" />
    </div>
  );
}

// What the other apps have on each day of the month shown, for the grid of a calendar. Refreshes when the month changes.
export function useMonthAgenda(year, month) {
  const [days, setDays] = useState({});
  const key = `${year}-${String(month + 1).padStart(2, "0")}`;
  useEffect(() => {
    let live = true;
    api.getAgendaMonth(key).then((d) => { if (live) setDays((d && d.days) || {}); }).catch(() => { if (live) setDays({}); });
    return () => { live = false; };
  }, [key]);
  return days;
}

// Small counts for the apps other than the one the calendar belongs to, so every grid agrees on which days are busy.
export function OtherAppsMarks({ counts, own }) {
  const shown = ["leads", "voice", "social"].filter((p) => p !== own && counts && counts[p]);
  if (!shown.length) return null;
  const label = shown.map((p) => `${counts[p]} in ${p === "leads" ? "Leads" : p === "voice" ? "Voice" : "Social"}`).join(", ");
  return (
    <div role="img" aria-label={label} title={label} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "auto", paddingTop: 2 }}>
      {shown.map((p) => (
        <span key={p} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700, color: C.slate }}>
          <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 99, background: DOT[p] }} />{counts[p]}
        </span>
      ))}
    </div>
  );
}
