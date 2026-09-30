import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Minus, RefreshCw, Share2, Table2, LineChart as LineIcon, X } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { api } from "../api/apiClient";
import { LevelPicker } from "../team/TeamModal";

// Categorical slots 1-3 of the validated reference palette (light surface).
// Aqua is below 3:1 on the surface, so series always carry a legend and a table view.
const SERIES = [
  { key: "calls", label: "Calls", color: "#2a78d6" },
  { key: "connected", label: "Connected", color: "#eb6834" },
  { key: "booked", label: "Meetings booked", color: "#1baf7a" },
];
const SURFACE = "#fcfcfb";
const INK = C.textInk;
const MUTED = C.slate;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const RANGES = [7, 30, 90];

function fmtDay(iso) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function Delta({ now, before, suffix = "", invert = false }) {
  if (before === undefined || before === null) return null;
  const diff = Math.round((now - before) * 10) / 10;
  if (!before && !now) return <span style={{ fontSize: 12, color: MUTED }}>No data yet</span>;
  const up = diff > 0;
  const good = invert ? !up : up;
  const Icon = diff === 0 ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const color = diff === 0 ? MUTED : good ? C.green : C.red;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, color }}>
      <Icon size={13} aria-hidden="true" />
      {diff > 0 ? "+" : ""}{diff}{suffix}
      <span style={{ color: MUTED }}>&nbsp;vs previous</span>
    </span>
  );
}

function StatTile({ label, value, unit, delta }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", minWidth: 0 }}>
      <div style={{ fontSize: 12, color: MUTED, fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, color: INK, margin: "4px 0 2px", fontVariantNumeric: "tabular-nums" }}>
        {value}<span style={{ fontSize: 15, color: MUTED, fontWeight: 600 }}>{unit}</span>
      </div>
      {delta}
    </div>
  );
}

function Card({ title, subtitle, children, right }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: INK }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{subtitle}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 10px", boxShadow: "0 6px 18px rgba(0,0,0,0.08)", fontSize: 12 }}>
      <div style={{ fontWeight: 700, color: INK, marginBottom: 4 }}>{fmtDay(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: "flex", alignItems: "center", gap: 6, color: INK }}>
          <span style={{ width: 10, height: 2, background: p.color, display: "inline-block" }} />
          <span style={{ color: MUTED }}>{SERIES.find((s) => s.key === p.dataKey)?.label}</span>
          <b style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{p.value}</b>
        </div>
      ))}
    </div>
  );
}

// Outcomes: one hue, sorted, value labelled at the bar end.
function OutcomeBars({ items }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const [hover, setHover] = useState(null);
  if (!items.length) return <Empty />;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {items.map((o) => (
        <div
          key={o.key}
          onMouseEnter={() => setHover(o.key)}
          onMouseLeave={() => setHover(null)}
          title={`${o.label}: ${o.count}`}
          style={{ display: "grid", gridTemplateColumns: "130px 1fr 40px", alignItems: "center", gap: 10, padding: "2px 0", background: hover === o.key ? C.paper : "transparent", borderRadius: 6 }}
        >
          <span style={{ fontSize: 12.5, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
          <div style={{ height: 12, background: C.paperSoft, borderRadius: 4 }}>
            <div style={{ width: `${(o.count / max) * 100}%`, height: "100%", background: SERIES[0].color, borderRadius: 4, minWidth: 3 }} />
          </div>
          <span style={{ fontSize: 12.5, color: INK, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{o.count}</span>
        </div>
      ))}
    </div>
  );
}

// Best time to call: weekday x hour, shaded by connect rate (one hue, light to dark).
function BestTimeGrid({ cells }) {
  const [tip, setTip] = useState(null);
  const hours = useMemo(() => {
    const used = cells.map((c) => c.hour);
    const lo = Math.min(8, ...used);
    const hi = Math.max(20, ...used);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [cells]);
  const lookup = useMemo(() => Object.fromEntries(cells.map((c) => [`${c.weekday}-${c.hour}`, c])), [cells]);
  if (!cells.length) return <Empty />;
  const shade = (rate) => {
    const t = Math.max(0, Math.min(1, rate / 100));
    // Light-to-dark steps of the series blue.
    const a = [234, 241, 251];
    const b = [26, 84, 158];
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
  };
  return (
    <div style={{ position: "relative", overflowX: "auto" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 2, fontSize: 11, color: MUTED }}>
        <thead>
          <tr>
            <th />
            {hours.map((h) => <th key={h} style={{ fontWeight: 500, padding: "0 0 4px", minWidth: 24 }}>{h % 3 === 0 ? `${h}:00` : ""}</th>)}
          </tr>
        </thead>
        <tbody>
          {WEEKDAYS.map((wd, wi) => (
            <tr key={wd}>
              <th style={{ fontWeight: 600, textAlign: "left", paddingRight: 6, color: INK }}>{wd}</th>
              {hours.map((h) => {
                const cell = lookup[`${wi}-${h}`];
                return (
                  <td
                    key={h}
                    onMouseEnter={(e) => cell && setTip({ x: e.currentTarget.offsetLeft, y: e.currentTarget.offsetTop, cell, wd, h })}
                    onMouseLeave={() => setTip(null)}
                    style={{ width: 24, height: 22, borderRadius: 4, background: cell ? shade(cell.rate) : C.paper, cursor: cell ? "default" : undefined }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {tip && (
        <div style={{ position: "absolute", left: tip.x + 30, top: tip.y - 6, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 9px", fontSize: 12, color: INK, boxShadow: "0 6px 18px rgba(0,0,0,0.08)", pointerEvents: "none", whiteSpace: "nowrap" }}>
          <b>{tip.wd} {tip.h}:00</b> · {tip.cell.calls} calls · {tip.cell.connected} connected ({tip.cell.rate}%)
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: MUTED, marginTop: 8 }}>
        Connect rate <span>0%</span>
        <span style={{ width: 90, height: 8, borderRadius: 4, background: `linear-gradient(90deg, ${shade(0)}, ${shade(100)})` }} />
        <span>100%</span>
        <span style={{ marginLeft: 10 }}>Grey = no calls in that hour</span>
      </div>
    </div>
  );
}

function Empty() {
  return <div style={{ fontSize: 13, color: MUTED, padding: "18px 0" }}>No calls in this period yet.</div>;
}

// Admins decide who else sees Analytics.
function SharePanel({ onClose }) {
  const [people, setPeople] = useState([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setPeople(await api.getShare("analytics"));
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const set = async (id, level) => {
    try {
      await api.setShare("analytics", { [id]: level });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.45)", zIndex: 130, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 620, maxHeight: "85vh", overflowY: "auto", padding: 20, fontFamily: FONT_BODY }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, flex: 1 }}>Share Analytics</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: MUTED }}><X size={18} /></button>
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 14 }}>Analytics starts visible to admins only. Choose who else can see it.</div>
        {error && <div style={{ color: C.red, fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        {people.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${C.borderLight}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: 11.5, color: MUTED }}>{p.roles.join(", ") || "No role"}{!p.is_active ? " · disabled" : ""}</div>
            </div>
            {p.is_admin ? (
              <span style={{ fontSize: 12, color: MUTED }}>Admin: always has access</span>
            ) : (
              <LevelPicker value={p.direct === "none" ? p.level : p.direct} onChange={(lv) => set(p.id, lv)} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnalyticsTab({ operator }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [asTable, setAsTable] = useState(false);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api.getCallingAnalytics(days));
    } catch (err) {
      setError(err.message || "Could not load analytics.");
    } finally {
      setLoading(false);
    }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const cur = data?.current;
  const prev = data?.previous;
  const pill = (active) => ({
    padding: "6px 12px", borderRadius: 8, border: `1px solid ${active ? C.ink : C.border}`, background: active ? C.ink : "#fff",
    color: active ? "#fff" : INK, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: FONT_BODY,
  });

  return (
    <div style={{ fontFamily: FONT_BODY, display: "grid", gap: 14 }}>
      {/* Filters in one row above the charts */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {RANGES.map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} style={pill(days === d)}>Last {d} days</button>
        ))}
        <button type="button" onClick={load} style={{ ...pill(false), display: "inline-flex", alignItems: "center", gap: 6 }}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
        <div style={{ flex: 1 }} />
        {data && <span style={{ fontSize: 12, color: MUTED }}>Times in {data.timezone}</span>}
        {operator?.is_admin && (
          <button type="button" onClick={() => setSharing(true)} style={{ ...pill(false), display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Share2 size={13} /> Share access
          </button>
        )}
      </div>

      {error && <div style={{ color: C.red, background: C.redSoft, padding: "10px 12px", borderRadius: 10, fontSize: 13 }}>{error}</div>}

      {cur && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
            <StatTile label="Calls" value={cur.calls} delta={<Delta now={cur.calls} before={prev.calls} />} />
            <StatTile label="Connect rate" value={cur.connectRate} unit="%" delta={<Delta now={cur.connectRate} before={prev.connectRate} suffix=" pts" />} />
            <StatTile label="Meetings booked" value={cur.booked} delta={<Delta now={cur.booked} before={prev.booked} />} />
            <StatTile label="Booking rate" value={cur.bookingRate} unit="%" delta={<Delta now={cur.bookingRate} before={prev.bookingRate} suffix=" pts" />} />
            <StatTile label="Avg talk time" value={cur.avgTalkMinutes} unit=" min" delta={<Delta now={cur.avgTalkMinutes} before={prev.avgTalkMinutes} suffix=" min" />} />
            <StatTile label="Callbacks asked" value={cur.callbacks} delta={<Delta now={cur.callbacks} before={prev.callbacks} />} />
          </div>

          <Card
            title="Calls over time"
            subtitle={`Daily calls, connected calls and meetings booked · ${cur.talkMinutes} talk minutes in total`}
            right={
              <button type="button" onClick={() => setAsTable(!asTable)} style={{ ...pill(false), display: "inline-flex", alignItems: "center", gap: 6 }}>
                {asTable ? <><LineIcon size={13} /> Chart</> : <><Table2 size={13} /> Table</>}
              </button>
            }
          >
            {asTable ? (
              <div style={{ maxHeight: 280, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ color: MUTED, textAlign: "left" }}>
                      <th style={{ padding: 6 }}>Day</th>
                      {SERIES.map((s) => <th key={s.key} style={{ padding: 6, textAlign: "right" }}>{s.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.trend.filter((d) => d.calls).reverse().map((d) => (
                      <tr key={d.date} style={{ borderTop: `1px solid ${C.borderLight}` }}>
                        <td style={{ padding: 6 }}>{fmtDay(d.date)}</td>
                        {SERIES.map((s) => <td key={s.key} style={{ padding: 6, textAlign: "right", fontFamily: FONT_MONO }}>{d[s.key]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.trend.some((d) => d.calls) && <Empty />}
              </div>
            ) : (
              <div style={{ height: 260, background: SURFACE, borderRadius: 10 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.trend} margin={{ top: 10, right: 16, left: -12, bottom: 0 }}>
                    <CartesianGrid stroke={C.borderLight} vertical={false} />
                    <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={{ stroke: C.border }} minTickGap={24} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} />
                    <Tooltip content={<TrendTooltip />} cursor={{ stroke: C.slateLight, strokeWidth: 1 }} />
                    <Legend verticalAlign="top" height={28} iconType="plainline" itemSorter={(item) => SERIES.findIndex((s) => s.key === item.dataKey)}formatter={(v) => <span style={{ color: INK, fontSize: 12 }}>{SERIES.find((s) => s.key === v)?.label}</span>} />
                    {SERIES.map((s) => (
                      <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14 }}>
            <Card title="How calls ended" subtitle="Outcome of every call in this period">
              <OutcomeBars items={data.outcomes} />
            </Card>
            <Card title="Best time to call" subtitle="Share of calls answered by weekday and hour">
              <BestTimeGrid cells={data.heatmap} />
            </Card>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14 }}>
            <Card title="Campaigns" subtitle="Results per contact list or campaign">
              {data.campaigns.length ? (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ color: MUTED, textAlign: "left" }}>
                      <th style={{ padding: "6px 4px" }}>Campaign</th>
                      <th style={{ padding: "6px 4px", textAlign: "right" }}>Calls</th>
                      <th style={{ padding: "6px 4px", textAlign: "right" }}>Connect</th>
                      <th style={{ padding: "6px 4px", textAlign: "right" }}>Booked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.campaigns.map((c) => (
                      <tr key={c.name} style={{ borderTop: `1px solid ${C.borderLight}` }}>
                        <td style={{ padding: "7px 4px", color: INK, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</td>
                        <td style={{ padding: "7px 4px", textAlign: "right", fontFamily: FONT_MONO }}>{c.calls}</td>
                        <td style={{ padding: "7px 4px", textAlign: "right", fontFamily: FONT_MONO }}>{c.connectRate}%</td>
                        <td style={{ padding: "7px 4px", textAlign: "right", fontFamily: FONT_MONO }}>{c.booked}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <Empty />}
            </Card>
            <Card title="Meetings" subtitle="All meetings from calls, across time">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  ["Upcoming", data.meetings.upcoming],
                  ["Need an outcome", data.meetings.needsOutcome],
                  ["Became customers", data.meetings.converted],
                  ["Not a fit", data.meetings.notFit],
                ].map(([label, n]) => (
                  <div key={label} style={{ border: `1px solid ${C.borderLight}`, borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 12, color: MUTED }}>{label}</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: INK }}>{n}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
      {!cur && !error && <div style={{ fontSize: 13, color: MUTED }}>Loading analytics…</div>}
      {sharing && <SharePanel onClose={() => setSharing(false)} />}
    </div>
  );
}
