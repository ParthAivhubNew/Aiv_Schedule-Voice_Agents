import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Clock, ExternalLink, Pencil, Plug, RefreshCw } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY, HUB_PAPER } from "../../tokens";
import { formatOrgTime, orgDateTime, useOrg } from "../../org/orgSettings";

// Overview (what needs the user today) and Insights (how published posts did). Every number shown
// comes from the networks; a figure a network does not share is left out, never shown as zero.

const TITLES = { linkedin: "LinkedIn", x: "X", facebook: "Facebook", instagram: "Instagram", threads: "Threads", reddit: "Reddit" };
const title = (id) => TITLES[String(id || "").toLowerCase()] || id || "";
const fmt = (n) => (n == null ? "–" : Number(n).toLocaleString());
// Network errors often arrive as raw JSON; show a plain sentence and keep the detail in the tooltip.
export const plainError = (e) => (!e ? "" : /[{[]/.test(e) ? "The network no longer accepts the saved login." : e);
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const page = { flex: 1, overflowY: "auto", padding: "22px 28px 48px", background: HUB_PAPER, fontFamily: FONT_BODY };
const card = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 };
const h2 = { fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink, margin: "0 0 10px" };
const muted = { fontSize: 12.5, color: C.slate, lineHeight: 1.5 };
const btn = {
  display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 8,
  border: `1px solid ${C.border}`, background: "#fff", color: C.ink, fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: FONT_BODY,
};

function when(ms, org) {
  if (!ms) return "No date";
  const at = orgDateTime(ms, org.timezone);
  const d = new Date(at.date + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + " · " + formatOrgTime(at.time, org.timeFormat);
}

function Loading({ what }) {
  return <div style={{ ...muted, padding: 24 }}>Loading {what}…</div>;
}

function Failed({ what, onRetry }) {
  return (
    <div style={{ ...card, display: "flex", alignItems: "center", gap: 10 }}>
      <AlertTriangle size={16} color={C.red} />
      <div style={{ flex: 1, fontSize: 13, color: C.ink }}>Could not load {what}.</div>
      <button type="button" style={btn} onClick={onRetry}><RefreshCw size={13} /> Try again</button>
    </div>
  );
}

// A count with its label. tone "alert" only when there is something to fix.
function Tile({ label, value, tone, sub }) {
  const alert = tone === "alert";
  return (
    <div style={{ ...card, padding: "14px 16px", borderColor: alert ? C.red : C.border, minWidth: 0 }}>
      <div style={{ fontSize: 26, fontWeight: 700, fontFamily: FONT_DISPLAY, color: alert ? C.red : C.ink, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>{label}</div>
      {sub ? <div style={{ fontSize: 11.5, color: C.slate, marginTop: 4 }}>{sub}</div> : null}
    </div>
  );
}

function ChartTip({ active, payload, label, name }) {
  if (!active || !payload || !payload.length || payload[0].value == null) return null;
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px", fontSize: 12, color: C.ink }}>
      <div style={{ color: C.slate }}>{new Date(label + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
      <div style={{ fontWeight: 700 }}>{fmt(payload[0].value)} {name}</div>
    </div>
  );
}

const axisTick = { fontSize: 11, fill: C.slate };
const dayTick = (v) => new Date(v + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function TrendChart({ data, field, name, height = 180, kind = "area" }) {
  const Chart = kind === "bar" ? BarChart : AreaChart;
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={C.border} strokeDasharray="0" />
          <XAxis dataKey="date" tickFormatter={dayTick} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} width={56} tickFormatter={(v) => Number(v).toLocaleString()} />
          <Tooltip content={<ChartTip name={name} />} cursor={kind === "bar" ? { fill: HUB_PAPER } : { stroke: C.slateLight || C.slate, strokeWidth: 1 }} />
          {kind === "bar"
            ? <Bar dataKey={field} fill={C.teal} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            : <Area dataKey={field} type="monotone" stroke={C.teal} strokeWidth={2} fill={C.tealSoft || "#E4F5F2"} connectNulls isAnimationActive={false}
                dot={false} activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2, fill: C.teal }} />}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────
export function OverviewPage({ onOpenPost, onRetry, onReconnect, onOpenApprovals, onOpenInsights, retrying, embedded = false }) {
  const root = embedded ? {} : page; // embedded: it sits above the calendar and scrolls with it
  const org = useOrg();
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const load = useCallback(() => {
    setState((s) => (s === "ok" ? "ok" : "loading"));
    api.getSocialOverview().then((d) => { setData(d); setState("ok"); }).catch(() => setState("error"));
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 60000);
    return () => window.clearInterval(t);
  }, [load]);
  useEffect(() => { if (!retrying) load(); }, [retrying, load]);

  if (state === "loading" && !data) return <div style={root}><Loading what="your overview" /></div>;
  if (state === "error" && !data) return <div style={root}><Failed what="your overview" onRetry={load} /></div>;
  const c = data.counts;
  const attention = data.failed.length + data.reconnect.length;
  const week = data.week;
  const hasResults = week.series.some((d) => d.reach != null || d.engagements != null);
  return (
    <div style={root}>
      <div style={{ maxWidth: embedded ? "none" : 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="overview-tiles" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <Tile label="Posts today" value={c.today} />
          <Tile label="Scheduled, next 7 days" value={c.nextSevenDays} />
          <Tile label="Failed" value={c.failed} tone={c.failed ? "alert" : ""} />
          <Tile label="Published this month" value={c.publishedThisMonth} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, alignItems: "start" }}>
          <section style={card} aria-labelledby="ov-attn">
            <h2 id="ov-attn" style={h2}>Needs attention</h2>
            {!attention && !c.waiting ? <div style={muted}>Nothing needs you right now.</div> : null}
            {c.waiting ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                <Clock size={15} color={C.amber} />
                <div style={{ flex: 1, fontSize: 13 }}>{c.waiting} post{c.waiting === 1 ? "" : "s"} waiting for approval</div>
                <button type="button" style={btn} onClick={onOpenApprovals}><Check size={13} /> Review</button>
              </div>
            ) : null}
            {data.reconnect.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                <Plug size={15} color={C.red} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{title(a.platform)} {a.handle ? "· " + a.handle : ""} needs reconnecting</div>
                  {a.error ? <div style={{ ...muted, fontSize: 11.5 }} title={a.error}>{plainError(a.error)}</div> : null}
                </div>
                <button type="button" style={btn} onClick={onReconnect}>Reconnect</button>
              </div>
            ))}
            {data.failed.map((p) => (
              <div key={p.id} style={{ padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertTriangle size={15} color={C.red} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
                  <span style={{ fontSize: 11.5, color: C.slate, flexShrink: 0 }}>{title(p.channel)}</span>
                </div>
                <div style={{ ...muted, margin: "4px 0 8px 23px" }}>{p.text}</div>
                <div style={{ display: "flex", gap: 8, marginLeft: 23, flexWrap: "wrap" }}>
                  {p.kind === "login" ? <button type="button" style={btn} onClick={onReconnect}><Plug size={13} /> Reconnect</button> : null}
                  {p.kind !== "permanent" ? (
                    <button type="button" style={btn} disabled={retrying === p.id} onClick={() => onRetry(p.id)}>
                      <RefreshCw size={13} /> {retrying === p.id ? "Posting…" : "Retry"}
                    </button>
                  ) : null}
                  <button type="button" style={btn} onClick={() => onOpenPost(p.id)}><Pencil size={13} /> Edit</button>
                </div>
              </div>
            ))}
          </section>

          <section style={card} aria-labelledby="ov-next">
            <h2 id="ov-next" style={h2}>Up next</h2>
            {!data.upcoming.length ? <div style={muted}>Nothing scheduled. Plan posts from the Calendar.</div> : null}
            {data.upcoming.map((p) => (
              <button key={p.id} type="button" onClick={() => onOpenPost(p.id)} className="ov-row"
                style={{ display: "flex", flexWrap: "wrap", width: "100%", alignItems: "center", gap: "2px 10px", padding: "8px 4px", border: "none", borderBottom: `1px solid ${C.border}`, background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: FONT_BODY }}>
                <div style={{ width: 118, flexShrink: 0, fontSize: 11.5, color: C.slate }}>{when(p.dueAtMs, org)}</div>
                <div style={{ flex: "1 1 160px", minWidth: 0, fontSize: 13, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
                <span style={{ fontSize: 11, color: p.status === "awaiting_approval" ? "#92400E" : C.slate, flexShrink: 0 }}>
                  {title(p.channel)}{p.status === "awaiting_approval" ? " · needs approval" : ""}
                </span>
              </button>
            ))}
          </section>
        </div>

        <section style={card} aria-labelledby="ov-week">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <h2 id="ov-week" style={{ ...h2, margin: 0, flex: 1 }}>Last 7 days</h2>
            <button type="button" style={btn} onClick={onOpenInsights}>See all results</button>
          </div>
          {hasResults ? (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 22px", margin: "6px 0 10px" }}>
                <Stat label="Reach" value={week.totals.reach ?? week.totals.impressions} />
                <Stat label="Engagements" value={week.totals.engagements} />
                <Stat label="Leads from posts" value={week.leads} accent />
                <Stat label="Meetings from posts" value={week.meetings} accent />
              </div>
              <TrendChart data={week.series} field="reach" name="reach" height={140} />
            </>
          ) : (
            <div style={muted}>Results appear a few hours after a post goes live. Leads from posts: {week.leads}. Meetings booked from posts: {week.meetings}.</div>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, change, accent }) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent ? C.teal : C.ink, fontVariantNumeric: "tabular-nums" }}>{typeof value === "string" ? value : fmt(value)}</div>
      <div style={{ fontSize: 11.5, color: C.slate }}>
        {label}
        {change != null ? <span style={{ marginLeft: 6, fontWeight: 700, color: change >= 0 ? C.teal : C.red }}>{change >= 0 ? "+" : ""}{change}%</span> : null}
      </div>
    </div>
  );
}

// ── Insights ────────────────────────────────────────────────────────────────
export function InsightsPage({ onOpenPost, showToast, side }) {
  const [days, setDays] = useState(30);
  const [channel, setChannel] = useState("");
  const [account, setAccount] = useState("");
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    setState("loading");
    api.getSocialInsights({ days, channel, account })
      .then((d) => { setData(d); setState("ok"); })
      .catch(() => setState("error"));
  }, [days, channel, account]);
  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.syncSocialInsights();
      showToast(r.channels ? `Updated results for ${r.channels} post channel${r.channels === 1 ? "" : "s"}.` : "Results are already up to date.");
      load();
    } catch (e) {
      showToast(e.message || "Could not read results right now.");
    } finally {
      setSyncing(false);
    }
  };

  const accountsForChannel = ((data && data.accounts) || []).filter((a) => !channel || a.platform === channel);
  return (
    <div style={page}>
      <div style={{ maxWidth: side ? 1560 : 1100, margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 20 }}>
      <div id="insights-main" style={{ flex: "1 1 620px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <div role="group" aria-label="Time range" style={{ display: "inline-flex", border: `1px solid ${C.border}`, borderRadius: 9, overflow: "hidden", background: "#fff" }}>
            {[7, 30, 90].map((d) => (
              <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}
                style={{ height: 32, padding: "0 12px", border: "none", background: days === d ? C.ink : "#fff", color: days === d ? "#fff" : C.ink, fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: FONT_BODY }}>
                {d} days
              </button>
            ))}
          </div>
          <select aria-label="Channel" value={channel} onChange={(e) => { setChannel(e.target.value); setAccount(""); }} style={{ ...btn, paddingRight: 8 }}>
            <option value="">All channels</option>
            {Object.keys(TITLES).map((k) => <option key={k} value={k}>{TITLES[k]}</option>)}
          </select>
          {accountsForChannel.length > 1 ? (
            <select aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)} style={{ ...btn, paddingRight: 8 }}>
              <option value="">All accounts</option>
              {accountsForChannel.map((a) => <option key={a.id} value={a.id}>{title(a.platform)} · {a.handle || a.id}</option>)}
            </select>
          ) : null}
          <div style={{ flex: 1 }} />
          {data && data.lastSyncedAt ? <span style={{ fontSize: 11.5, color: C.slate }}>Updated {new Date(data.lastSyncedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : null}
          <button type="button" style={btn} onClick={sync} disabled={syncing}><RefreshCw size={13} /> {syncing ? "Reading…" : "Refresh results"}</button>
        </div>

        {state === "loading" && !data ? <Loading what="results" /> : null}
        {state === "error" ? <Failed what="results" onRetry={load} /> : null}
        {data ? <InsightsBody data={data} onOpenPost={onOpenPost} loading={state === "loading"} /> : null}
      </div>
      {side ? <aside id="reports-panel" aria-label="Reports" style={{ flex: "0 1 420px", minWidth: 300, width: "100%", scrollMarginTop: 12 }}>{side}</aside> : null}
      </div>
    </div>
  );
}

function InsightsBody({ data, onOpenPost, loading }) {
  const t = data.totals;
  const ch = data.changes;
  const empty = !t.posts;
  const reachField = data.series.some((d) => d.reach != null) ? "reach" : "impressions";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, opacity: loading ? 0.6 : 1 }}>
      {empty ? (
        <div style={card}>
          <h2 style={h2}>No results in the last {data.days} days</h2>
          <div style={muted}>Numbers appear here a few hours after posts go live. They are read from each network every few hours.</div>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <div style={card}><Stat label="Reach" value={t.reach} change={ch.reach} /></div>
            <div style={card}><Stat label="Views" value={t.impressions} change={ch.impressions} /></div>
            <div style={card}><Stat label="Engagements" value={t.engagements} change={ch.engagements} /></div>
            <div style={card}><Stat label="Engagement rate" value={t.engagementRate == null ? null : t.engagementRate + "%"} /></div>
            <div style={card}><Stat label="Clicks (from the networks)" value={t.clicks} change={ch.clicks} /></div>
            <div style={card}><Stat label="Tracked link clicks" value={t.linkClicks} change={ch.linkClicks} /></div>
          </div>
          <div style={{ ...muted, marginTop: -6 }}>
            {t.measured} of {t.posts} post{t.posts === 1 ? "" : "s"} have numbers. Changes compare with the {data.days} days before.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            <section style={card}>
              <h2 style={h2}>{reachField === "reach" ? "Reach" : "Views"} by publish day</h2>
              <TrendChart data={data.series} field={reachField} name={reachField === "reach" ? "reach" : "views"} />
            </section>
            <section style={card}>
              <h2 style={h2}>Engagements by publish day</h2>
              <TrendChart data={data.series} field="engagements" name="engagements" kind="bar" />
            </section>
          </div>

          <section style={card} aria-labelledby="in-top">
            <h2 id="in-top" style={h2}>Top posts</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 640 }}>
                <thead>
                  <tr style={{ color: C.slate, textAlign: "right" }}>
                    {["Post", "Reach", "Views", "Likes", "Comments", "Clicks", "Tracked clicks", "Leads", "Meetings"].map((h, i) => (
                      <th key={h} scope="col" style={{ fontWeight: 600, padding: "6px 8px", borderBottom: `1px solid ${C.border}`, textAlign: i ? "right" : "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.top.map((p) => (
                    <tr key={p.id}>
                      <td style={{ padding: "8px", borderBottom: `1px solid ${C.border}`, maxWidth: 280 }}>
                        <button type="button" onClick={() => onOpenPost(p.id)} className="ui-link"
                          style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontWeight: 600, color: C.ink, textAlign: "left", fontFamily: FONT_BODY, fontSize: 12.5 }}>
                          {p.title || "Post"}
                        </button>
                        <div style={{ fontSize: 11, color: C.slate, display: "flex", gap: 8, alignItems: "center" }}>
                          {title(p.channel)}
                          {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="ui-link" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>View <ExternalLink size={11} /></a> : null}
                        </div>
                      </td>
                      {["reach", "impressions", "likes", "comments", "clicks", "linkClicks", "leads", "meetings"].map((k) => (
                        <td key={k} style={{ padding: "8px", borderBottom: `1px solid ${C.border}`, textAlign: "right", fontVariantNumeric: "tabular-nums", color: (k === "leads" || k === "meetings") && p[k] ? C.teal : C.ink, fontWeight: (k === "leads" || k === "meetings") && p[k] ? 700 : 400 }}>
                          {fmt(p[k])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, alignItems: "start" }}>
        <BestTimes best={data.bestTimes} tz={data.timezone} />
        <section style={card} aria-labelledby="in-fol">
          <h2 id="in-fol" style={h2}>Followers</h2>
          {!data.followers.length ? <div style={muted}>Connect an account to see its followers.</div> : null}
          {data.followers.map((f) => (
            <div key={f.accountId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{title(f.platform)} {f.handle ? "· " + f.handle : ""}</div>
              <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{f.followers == null ? "Not shared" : fmt(f.followers)}</div>
              {f.change ? <div style={{ fontSize: 12, fontWeight: 700, color: f.change > 0 ? C.teal : C.red, width: 60, textAlign: "right" }}>{f.change > 0 ? "+" : ""}{fmt(f.change)}</div> : <div style={{ width: 60 }} />}
            </div>
          ))}
        </section>
      </div>

      {data.notes.length ? (
        <section style={card} aria-labelledby="in-notes">
          <h2 id="in-notes" style={h2}>Why some numbers are missing</h2>
          <ul style={{ margin: 0, paddingLeft: 18, ...muted }}>
            {data.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// Weekday × hour grid, one hue light to dark by average engagements. The top slots are also
// listed as text, so nothing depends on reading the colour.
function BestTimes({ best, tz }) {
  if (!best) {
    return (
      <section style={card}>
        <h2 style={h2}>Best times to post</h2>
        <div style={muted}>Shown once at least 8 posts have results, so the advice comes from your own audience.</div>
      </section>
    );
  }
  const max = Math.max(...best.cells.map((c) => c.avg), 1);
  const at = {};
  best.cells.forEach((c) => { at[c.weekday + ":" + c.hour] = c; });
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <section style={card} aria-labelledby="in-best">
      <h2 id="in-best" style={h2}>Best times to post</h2>
      <div style={{ ...muted, marginBottom: 8 }}>
        Top slots ({tz}): {best.top.map((c) => `${DAY_NAMES[c.weekday]} ${String(c.hour).padStart(2, "0")}:00`).join(", ")}.
      </div>
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "34px repeat(24, minmax(10px, 1fr))", gap: 2, minWidth: 360 }}>
          <div />
          {hours.map((h) => <div key={h} style={{ fontSize: 9, color: C.slate, textAlign: "center" }}>{h % 6 === 0 ? h : ""}</div>)}
          {DAY_NAMES.map((d, wd) => (
            <React.Fragment key={d}>
              <div style={{ fontSize: 10.5, color: C.slate, lineHeight: "14px" }}>{d}</div>
              {hours.map((h) => {
                const c = at[wd + ":" + h];
                const share = c ? 0.18 + 0.82 * (c.avg / max) : 0;
                return (
                  <div key={h}
                    title={c ? `${d} ${String(h).padStart(2, "0")}:00 · ${c.avg} engagements on average (${c.posts} post${c.posts === 1 ? "" : "s"})` : `${d} ${String(h).padStart(2, "0")}:00 · no posts yet`}
                    style={{ height: 14, borderRadius: 3, background: c ? C.teal : HUB_PAPER, opacity: c ? share : 1 }} />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
