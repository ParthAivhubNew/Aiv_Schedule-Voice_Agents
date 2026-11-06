import React, { useCallback, useEffect, useState } from "react";
import { Loader } from "../app/Loader";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { btn, fmt, heading } from "./CreditsTab";

const input = { padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY, background: "#fff", boxSizing: "border-box" };
const th = { padding: "7px 12px", fontSize: 11, color: C.slate, textTransform: "uppercase", textAlign: "left" };
const td = { padding: "7px 12px", borderTop: `1px solid ${C.border}`, fontSize: 12.5 };
const when = (iso) => (iso ? new Date(iso + (iso.endsWith("Z") ? "" : "Z")).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const stat = (k, v, sub) => (
  <div key={k} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px" }}>
    <div style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>{k}</div>
    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20 }}>{v}</div>
    {sub && <div style={{ fontSize: 11.5, color: C.slate }}>{sub}</div>}
  </div>
);

// Who used how many credits. `load(days, userId)` returns the /credits/people shape (the partner screen passes its own loader);
// `saveCap(userId, cap)` is given only where the viewer may set limits (an organisation's admin).
export function PeopleUsage({ load, saveCap, title = "Who used the credits", showMe = true }) {
  const [days, setDays] = useState(30);
  const [picked, setPicked] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState({});
  const [saving, setSaving] = useState("");

  const refresh = useCallback(() => {
    let live = true;
    setError("");
    load(days, picked).then((d) => live && setData(d), (e) => live && setError(e.message || "Could not load usage."));
    return () => { live = false; };
  }, [load, days, picked]);
  useEffect(refresh, [refresh]);

  if (error && !data) return <div role="alert" style={{ color: C.red, fontSize: 12.5 }}>{error}</div>;
  if (!data) return <Loader compact label="Loading" />;

  const names = data.wallets || {};
  const peak = Math.max(1, ...((data.detail && data.detail.days) || []).map((d) => d.credits));
  const save = async (p) => {
    const raw = edit[p.userId];
    const cap = raw === "" || raw === undefined ? null : Math.max(0, parseInt(raw, 10) || 0);
    setSaving(p.userId);
    try {
      await saveCap(p.userId, cap);
      setEdit((e) => { const n = { ...e }; delete n[p.userId]; return n; });
      refresh();
    } catch (e) {
      setError(e.message || "Could not save the limit.");
    }
    setSaving("");
  };

  return (
    <div style={{ fontFamily: FONT_BODY }}>
      <div style={{ ...heading, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span>{title}</span>
        <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} style={input}>
          {[7, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
      </div>
      {error && <div role="alert" style={{ color: C.red, fontSize: 12.5, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
        {stat("Whole organisation", fmt(data.orgTotal), `credits in ${days} days`)}
        {showMe && stat("You", fmt(data.me.used), data.orgTotal ? `${data.me.share}% of the organisation` : "")}
        {showMe && data.me.cap != null && stat("Your monthly limit", fmt(data.me.cap), `${fmt(Math.max(0, data.me.cap - data.me.monthUsed))} left this month`)}
      </div>

      {data.people && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflowX: "auto", marginBottom: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
            <thead><tr>{["Person", "Credits used", "Share", saveCap ? "Monthly limit" : "", "Last active"].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.userId || "none"} style={{ background: picked === p.userId && p.userId ? C.paperSoft : "transparent" }}>
                  <td style={td}>
                    <button type="button" onClick={() => setPicked(picked === p.userId ? "" : p.userId)} aria-pressed={picked === p.userId}
                      style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: C.cobalt, fontWeight: 600, fontSize: 12.5, fontFamily: FONT_BODY, textAlign: "left" }}>{p.name}</button>
                    {p.username && <div style={{ fontSize: 11, color: C.slate }}>{p.username}</div>}
                  </td>
                  <td style={{ ...td, fontFamily: FONT_MONO }}>{fmt(p.used)}</td>
                  <td style={td}>
                    <div style={{ height: 6, width: 70, background: C.paperSoft, borderRadius: 3, overflow: "hidden" }}><div style={{ width: `${p.share}%`, height: "100%", background: C.cobalt }} /></div>
                    <span style={{ fontSize: 11, color: C.slate }}>{p.share}%</span>
                  </td>
                  <td style={td}>
                    {saveCap && p.username ? (
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <input aria-label={`Monthly limit for ${p.name}`} type="number" min="0" placeholder="No limit" style={{ ...input, width: 96 }}
                          value={edit[p.userId] !== undefined ? edit[p.userId] : (p.cap ?? "")} onChange={(e) => setEdit({ ...edit, [p.userId]: e.target.value })} />
                        {edit[p.userId] !== undefined && <button type="button" style={btn(true, saving === p.userId)} disabled={saving === p.userId} onClick={() => save(p)}>Save</button>}
                        {p.cap != null && edit[p.userId] === undefined && <span style={{ fontSize: 11, color: C.slate }}>{fmt(p.monthUsed)} used</span>}
                      </span>
                    ) : null}
                  </td>
                  <td style={{ ...td, color: C.slate }}>{when(p.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.detail && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>{data.detail.name}: where the credits went</div>
          {data.detail.items.length === 0 ? <div style={{ fontSize: 13, color: C.slate }}>Nothing used in this period.</div> : (
            <>
              {data.detail.days.length > 0 && (
                <div aria-label="Credits used per day" style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 60, marginBottom: 10, borderBottom: `1px solid ${C.border}` }}>
                  {data.detail.days.map((d) => <div key={d.day} title={`${d.day}: ${fmt(d.credits)} credits`} style={{ flex: 1, minWidth: 3, maxWidth: 18, height: `${Math.max(4, (d.credits / peak) * 100)}%`, background: C.cobalt, borderRadius: "3px 3px 0 0" }} />)}
                </div>
              )}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 360 }}>
                  <thead><tr>{["What", "App", "How many", "Credits"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>{data.detail.items.map((it) => (
                    <tr key={it.item}><td style={td}>{it.label}</td><td style={td}>{names[it.wallet] || it.wallet}</td><td style={{ ...td, fontFamily: FONT_MONO }}>{fmt(it.units)} {it.unit}</td><td style={{ ...td, fontFamily: FONT_MONO }}>{fmt(it.credits)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <div style={{ ...heading, fontSize: 13, margin: "12px 0 6px" }}>Latest lines</div>
              <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 10 }}>
                {data.detail.lines.map((l) => (
                  <div key={l.id} style={{ display: "grid", gridTemplateColumns: "130px 1fr 60px", gap: 10, padding: "6px 12px", borderTop: `1px solid ${C.border}`, fontSize: 12.5 }}>
                    <span style={{ color: C.slate }}>{when(l.at)}</span><span>{l.label}{l.note ? ` · ${l.note}` : ""}</span><span style={{ fontFamily: FONT_MONO, textAlign: "right" }}>{fmt(l.credits)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
