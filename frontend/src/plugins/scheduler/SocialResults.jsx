import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, ExternalLink, Pencil, Plug, RefreshCw, Send, X } from "lucide-react";
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
  if (embedded) {
    const next = data.upcoming[0];
    const stat = (value, title, hint, tone) => (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "2px 20px", flex: "1 1 190px", minWidth: 0, borderLeft: `1px solid ${C.border}` }} className="ov-stat">
        <b style={{ fontSize: 28, lineHeight: 1, minWidth: 22, color: tone === "alert" ? C.red : C.ink, fontVariantNumeric: "tabular-nums" }}>{value}</b>
        <span style={{ display: "flex", flexDirection: "column", gap: 2, lineHeight: 1.25, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{title}</span>
          <span style={{ fontSize: 12, color: C.slate }}>{hint}</span>
        </span>
      </div>
    );
    return (
      <div style={{ ...card, padding: 0, overflow: "hidden" }} aria-label="Overview">
        <style>{`.ov-stat:first-child{border-left:none!important;padding-left:18px!important}`}</style>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", padding: "12px 0", gap: "10px 0" }}>
          <div style={{ display: "flex", flexWrap: "wrap", flex: "1 1 520px", gap: "10px 0", minWidth: 0 }}>
            {stat(c.today, "Posts today", "going out today")}
            {stat(c.nextSevenDays, "Scheduled", "in the next 7 days")}
            {stat(c.failed, "Failed", c.failed ? "didn't publish, needs a fix" : "all posts published fine", c.failed ? "alert" : "")}
            {stat(c.publishedThisMonth, "Published", "so far this month")}
            {hasResults ? stat(fmt(week.totals.reach ?? week.totals.impressions), "People reached", "in the last 7 days") : null}
          </div>
          <div style={{ padding: "0 18px 0 8px", flexShrink: 0 }}>
            <button type="button" style={{ ...btn, height: 32, fontSize: 12.5, padding: "0 14px" }} onClick={onOpenInsights}>See all results</button>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", padding: "8px 18px", borderTop: `1px solid ${C.border}`, background: C.paperSoft || "#F8F9FB", fontSize: 12.5, color: C.slate, minWidth: 0 }}>
          {data.reconnect.length ? (
            <button type="button" style={{ ...btn, height: 24, fontSize: 11.5 }} onClick={onReconnect}><Plug size={12} color={C.red} /> {data.reconnect.length} to reconnect</button>
          ) : null}
          {data.failed.length ? (
            <button type="button" style={{ ...btn, height: 24, fontSize: 11.5 }} onClick={() => onOpenPost(data.failed[0].id)}><AlertTriangle size={12} color={C.red} /> {data.failed.length} failed, fix</button>
          ) : null}
          {!attention ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: C.green || "#16A34A" }} />Nothing needs you right now</span> : null}
          <span style={{ flex: 1 }} />
          {next ? (
            <button type="button" onClick={() => onOpenPost(next.id)} title={next.title}
              style={{ border: "none", background: "transparent", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: 0 }}>
              <span style={{ color: C.slate }}>Up next: {when(next.dueAtMs, org)} · </span>{next.title}
            </button>
          ) : <span>Nothing scheduled yet</span>}
        </div>
      </div>
    );
  }
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
  const [channels, setChannels] = useState([]); // empty = every network
  const [accountIds, setAccountIds] = useState([]); // empty = every account
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    setState("loading");
    api.getSocialInsights({ days, channel: channels.join(","), account: accountIds.join(",") })
      .then((d) => { setData(d); setState("ok"); })
      .catch(() => setState("error"));
  }, [days, channels, accountIds]);
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

  const allAccounts = (data && data.accounts) || [];
  const connected = [...new Set(allAccounts.map((a) => a.platform))];
  const channelOptions = (connected.length ? connected : Object.keys(TITLES)).map((k) => ({ id: k, label: title(k), dot: DOTS[k] }));
  const accountsForChannel = allAccounts.filter((a) => !channels.length || channels.includes(a.platform));
  const accountOptions = accountsForChannel.map((a) => ({ id: a.id, label: `${title(a.platform)} · ${a.handle || a.id}`, dot: DOTS[a.platform] }));
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
          <Picker label="Networks" allLabel="All networks" noun="networks" options={channelOptions} value={channels}
            onChange={(v) => { setChannels(v); setAccountIds([]); }} />
          {accountOptions.length > 1 ? (
            <Picker label="Accounts" allLabel="All accounts" noun="accounts" options={accountOptions} value={accountIds} onChange={setAccountIds} />
          ) : null}
          <div style={{ flex: 1 }} />
          {data && data.lastSyncedAt ? <span style={{ fontSize: 11.5, color: C.slate }}>Updated {new Date(data.lastSyncedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : null}
          <button type="button" style={btn} onClick={sync} disabled={syncing}><RefreshCw size={13} /> {syncing ? "Reading…" : "Refresh results"}</button>
        </div>

        {state === "loading" && !data ? <Loading what="results" /> : null}
        {state === "error" ? <Failed what="results" onRetry={load} /> : null}
        {data ? <InsightsBody data={data} onOpenPost={onOpenPost} loading={state === "loading"} showToast={showToast} single={channels.length === 1} onPickChannel={(k) => { setChannels([k]); setAccountIds([]); }} /> : null}
      </div>
      {side ? <aside id="reports-panel" aria-label="Reports" style={{ flex: "0 1 420px", minWidth: 300, width: "100%", scrollMarginTop: 12 }}>{side}</aside> : null}
      </div>
    </div>
  );
}

function InsightsBody({ data, onOpenPost, loading, single, onPickChannel, showToast }) {
  const [openPost, setOpenPost] = useState(null);
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

          {!single && (data.byChannel || []).length > 1 ? <ByChannel rows={data.byChannel} days={data.days} onPick={onPickChannel} /> : null}

          <TopPosts posts={data.top || []} onOpen={setOpenPost} />
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

      {openPost ? <PostResultsDialog post={openPost} onClose={() => setOpenPost(null)} onOpenPost={onOpenPost} showToast={showToast} /> : null}
    </div>
  );
}

const DOTS = { linkedin: "#0A66C2", x: "#14171A", facebook: "#1877F2", instagram: "#E1306C", threads: "#5B5F66", reddit: "#FF4500" };

// A drop-down that holds several choices. Nothing chosen means everything; unticking one keeps the rest.
function Picker({ label, allLabel, noun, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const ids = options.map((o) => o.id);
  const chosen = value.length ? value.filter((v) => ids.includes(v)) : ids;
  const all = chosen.length === ids.length;
  const set = (next) => onChange(next.length === ids.length ? [] : next);
  const toggle = (id) => {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
    if (next.length) set(next); // at least one stays ticked
  };
  const text = all ? allLabel : chosen.length === 1 ? (options.find((o) => o.id === chosen[0]) || {}).label : `${chosen.length} ${noun}`;
  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={`Choose ${noun}`}
        style={{ ...btn, paddingRight: 10, borderColor: all ? C.border : C.ink }}>
        <span style={{ display: "inline-flex" }}>
          {(all ? [] : chosen.slice(0, 3)).map((id, i) => (
            <span key={id} style={{ width: 9, height: 9, borderRadius: 99, background: (options.find((o) => o.id === id) || {}).dot || C.slate, border: "1.5px solid #fff", marginLeft: i ? -3 : 0 }} />
          ))}
        </span>
        {text}
        <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open ? (
        <div role="listbox" aria-label={label} aria-multiselectable="true"
          style={{ position: "absolute", top: 38, left: 0, zIndex: 30, minWidth: 250, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 12px 32px rgba(20,24,40,.16)", padding: 6 }}>
          <div style={{ display: "flex", alignItems: "center", padding: "4px 8px 6px", gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: C.slate, textTransform: "uppercase" }}>{label}</span>
            <button type="button" onClick={() => onChange([])} disabled={all}
              style={{ marginLeft: "auto", border: "none", background: "transparent", color: all ? C.slateLight : C.cobalt, fontWeight: 600, fontSize: 12, cursor: all ? "default" : "pointer", fontFamily: FONT_BODY }}>
              Select all
            </button>
          </div>
          {options.map((o) => {
            const on = chosen.includes(o.id);
            return (
              <div key={o.id} role="option" aria-selected={on} tabIndex={0} onClick={() => toggle(o.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(o.id); } }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px", borderRadius: 8, cursor: "pointer", fontSize: 13, color: C.ink, background: on ? "#F4F6FB" : "transparent" }}>
                <span style={{ width: 16, height: 16, borderRadius: 5, border: `1.5px solid ${on ? C.ink : C.border}`, background: on ? C.ink : "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {on ? <Check size={11} color="#fff" strokeWidth={3} /> : null}
                </span>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: o.dot || C.slate, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                <button type="button" onClick={(e) => { e.stopPropagation(); onChange([o.id]); }} title={`Only ${o.label}`}
                  style={{ border: "none", background: "transparent", color: C.slate, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: FONT_BODY }}>
                  Only
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// The best two posts of each network. "More" opens every post, a page at a time, so nothing needs scrolling.
const PER_PAGE = 8;
function PostRow({ p, onOpen, showNetwork }) {
  const metric = (label, v, tone) => (
    <div style={{ minWidth: 64, textAlign: "right" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: tone || C.ink, fontVariantNumeric: "tabular-nums" }}>{fmt(v)}</div>
      <div style={{ fontSize: 11, color: C.slate }}>{label}</div>
    </div>
  );
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 18px", padding: "10px 0", borderTop: `1px solid ${C.border}` }}>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <button type="button" onClick={() => onOpen(p)} className="ui-link" title="See this post's numbers and share them"
          style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontWeight: 600, color: C.ink, textAlign: "left", fontFamily: FONT_BODY, fontSize: 13, overflowWrap: "anywhere" }}>
          {p.title || "Post"}
        </button>
        {showNetwork ? <div style={{ fontSize: 11, color: C.slate }}>{title(p.channel)}</div> : null}
      </div>
      <div style={{ display: "flex", gap: 14 }}>
        {metric("Reach", p.reach != null ? p.reach : p.impressions)}
        {metric("Engagements", p.engagements)}
        {metric("Clicks", p.clicks)}
      </div>
      <button type="button" style={btn} onClick={() => onOpen(p)} title="See this post's numbers and share them">Numbers</button>
    </div>
  );
}

function TopPosts({ posts: byPost, onOpen }) {
  const [all, setAll] = useState(false);
  const [pg, setPg] = useState(0);
  // A post that went to several networks counts under each one, with that network's own numbers.
  const posts = [];
  byPost.forEach((p) => {
    (p.channels && p.channels.length ? p.channels : [p.channel]).forEach((n) => {
      const m = (p.perChannel || {})[n];
      posts.push(m ? { ...p, channel: n, ...m } : { ...p, channel: n });
    });
  });
  posts.sort((a, b) => (b.engagements || 0) - (a.engagements || 0) || ((b.reach || b.impressions || 0) - (a.reach || a.impressions || 0)));
  useEffect(() => { setPg(0); }, [all, byPost]);
  const groups = [];
  posts.forEach((p) => {
    let g = groups.find((x) => x.channel === p.channel);
    if (!g) { g = { channel: p.channel, rows: [] }; groups.push(g); }
    g.rows.push(p);
  });
  const shown = groups.reduce((n, g) => n + Math.min(2, g.rows.length), 0);
  const more = posts.length - shown;
  const pages = Math.max(1, Math.ceil(posts.length / PER_PAGE));
  const slice = posts.slice(pg * PER_PAGE, pg * PER_PAGE + PER_PAGE);
  return (
    <section style={card} aria-labelledby="in-top">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
        <h2 id="in-top" style={{ ...h2, margin: 0 }}>{all ? "All posts" : "Top posts"}</h2>
        {all ? <button type="button" style={{ ...btn, marginLeft: "auto" }} onClick={() => setAll(false)}>Back to the top 2 of each</button> : null}
      </div>
      <div style={{ ...muted, marginBottom: 6 }}>
        {all ? "Best first. Pick a post to see its numbers and share them." : "The best two posts of each network. Pick a post to see its numbers and share them."}
      </div>
      {!posts.length ? <div style={muted}>No posts with numbers in this period.</div> : null}
      {all ? (
        <>
          {slice.map((p) => <PostRow key={p.id + p.channel} p={p} onOpen={onOpen} showNetwork />)}
          {pages > 1 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
              <button type="button" style={btn} disabled={pg === 0} onClick={() => setPg(pg - 1)} aria-label="Previous page"><ChevronLeft size={14} /> Previous</button>
              <span style={{ fontSize: 12.5, color: C.slate }}>Page {pg + 1} of {pages}</span>
              <button type="button" style={btn} disabled={pg >= pages - 1} onClick={() => setPg(pg + 1)} aria-label="Next page">Next <ChevronRight size={14} /></button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {groups.map((g) => (
            <div key={g.channel} style={{ marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, color: C.ink }}>
                <span style={{ width: 9, height: 9, borderRadius: 99, background: DOTS[g.channel] || C.slate }} />
                {title(g.channel)}
                <span style={{ fontWeight: 400, color: C.slate }}>· top {Math.min(2, g.rows.length)} of {g.rows.length} post{g.rows.length === 1 ? "" : "s"}</span>
              </div>
              {g.rows.slice(0, 2).map((p) => <PostRow key={p.id + p.channel} p={p} onOpen={onOpen} />)}
            </div>
          ))}
          {more > 0 ? (
            <div style={{ paddingTop: 12, borderTop: `1px solid ${C.border}`, marginTop: 10 }}>
              <button type="button" style={btn} onClick={() => setAll(true)} title="Open every post, a page at a time">More · {more} more post{more === 1 ? "" : "s"}</button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

// One post's numbers in full, with ways to share them. A shared link is live; an email is a copy made at that moment and says so.
function PostResultsDialog({ post, onClose, onOpenPost, showToast }) {
  const org = useOrg();
  // The window can be dragged by its title bar, so it never has to cover the numbers behind it.
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const startDrag = (e) => {
    if (e.target.closest("button, a, input, textarea")) return;
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveDrag = (e) => {
    const d = drag.current;
    if (!d) return;
    const maxX = window.innerWidth / 2 - 60;
    const maxY = window.innerHeight / 2 - 40;
    setPos({ x: Math.max(-maxX, Math.min(maxX, d.ox + e.clientX - d.sx)), y: Math.max(-maxY, Math.min(maxY, d.oy + e.clientY - d.sy)) });
  };
  const endDrag = () => { drag.current = null; };
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const day = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  useEffect(() => {
    let live = true;
    api.getPostResults(post.id).then((d) => { if (live) { setData(d); setState("ok"); } }).catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [post.id]);
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  const asOf = data && data.asOf ? `${when(Date.parse(data.asOf), org)} (${org.timezone})` : "";
  const totals = (data && data.totals) || {};
  const fields = [["reach", "Reach"], ["impressions", "Views"], ["likes", "Likes"], ["comments", "Comments"], ["shares", "Shares"], ["saves", "Saves"], ["clicks", "Clicks"]]
    .filter(([k]) => totals[k] != null);
  const extra = data ? [["linkClicks", "Tracked link clicks"], ["leads", "Leads"], ["meetings", "Meetings booked"]].filter(([k]) => data[k]) : [];
  const copy = async () => {
    setBusy("link");
    try {
      const r = await api.postResultsLink(post.id);
      await navigator.clipboard.writeText(r.link);
      showToast(`Link copied. Anyone with it can see this post's numbers until ${day(r.expiresAt)}.`);
    } catch (e) {
      showToast(e.message || "Could not make a link right now.");
    } finally {
      setBusy("");
    }
  };
  const send = async (e) => {
    e.preventDefault();
    if (!to.trim()) return;
    setBusy("mail");
    try {
      const r = await api.sendPostResults(post.id, { to, note });
      showToast(`Sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}.`);
      setTo(""); setNote("");
    } catch (err) {
      showToast(err.message || "The email could not be sent.");
    } finally {
      setBusy("");
    }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={`Numbers for ${post.title || "post"}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(18,20,28,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ ...card, width: "min(640px, 100%)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", padding: 20, transform: `translate(${pos.x}px, ${pos.y}px)`, boxShadow: "0 18px 48px rgba(20,24,40,.28)" }}>
        <div onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} title="Drag to move this window"
          style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "grab", touchAction: "none", margin: "-20px -20px 0", padding: "20px 20px 6px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ ...h2, margin: 0, overflowWrap: "anywhere" }}>{post.title || "Post"}</h2>
            <div style={muted}>{data && (data.channels || []).length ? data.channels.map((c) => title(c.platform)).join(", ") : title(post.channel)}{post.publishedAt ? ` · published ${new Date(post.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}</div>
          </div>
          <button type="button" style={{ ...btn, width: 32, padding: 0, justifyContent: "center" }} onClick={onClose} aria-label="Close" title="Close"><X size={14} /></button>
        </div>

        {state === "loading" ? <Loading what="this post's numbers" /> : null}
        {state === "error" ? <div style={{ ...muted, padding: "14px 0" }}>The numbers could not be loaded. Try again in a moment.</div> : null}
        {state === "ok" && data.test ? <div style={{ ...muted, padding: "14px 0" }}>Posted in test mode: it was not sent to any network, so it has no results.</div> : null}
        {state === "ok" && !data.test ? (
          <>
            {fields.length || extra.length ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, margin: "14px 0 6px" }}>
                {fields.map(([k, label]) => (
                  <div key={k} style={{ background: "#F4F6FB", borderRadius: 10, padding: "9px 12px" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{fmt(totals[k])}</div>
                    <div style={{ fontSize: 11.5, color: C.slate }}>{label}</div>
                  </div>
                ))}
                {extra.map(([k, label]) => (
                  <div key={k} style={{ background: "#EAF6F4", borderRadius: 10, padding: "9px 12px" }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.teal, fontVariantNumeric: "tabular-nums" }}>{fmt(data[k])}</div>
                    <div style={{ fontSize: 11.5, color: C.slate }}>{label}</div>
                  </div>
                ))}
              </div>
            ) : <div style={{ ...muted, padding: "14px 0" }}>No numbers yet. They are read from the network every few hours after the post goes live.</div>}
            {(data.channels || []).length > 1 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 8 }}>
                <thead><tr style={{ color: C.slate }}>{["Network", "Reach", "Engagements", "Clicks"].map((h, i) => <th key={h} scope="col" style={{ fontWeight: 600, padding: "6px 8px", borderBottom: `1px solid ${C.border}`, textAlign: i ? "right" : "left" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.channels.map((c) => (
                    <tr key={c.platform}>
                      <td style={{ padding: "7px 8px", borderBottom: `1px solid ${C.border}` }}>{title(c.platform)}</td>
                      {[c.reach != null ? c.reach : c.impressions, c.engagements, c.clicks].map((v, i) => <td key={i} style={{ padding: "7px 8px", borderBottom: `1px solid ${C.border}`, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(v)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <div style={{ ...muted, marginTop: 10 }}>
              {asOf ? `Numbers as of ${asOf}, the last time they were read from the network. They keep changing, so refresh Insights for the latest.` : "Nothing has been read from the network for this post yet."}
            </div>
            {(data.links || []).filter((l) => l.url).length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {data.links.filter((l) => l.url).map((l) => (
                  <a key={l.url} href={l.url} target="_blank" rel="noreferrer" title={`Open the post on ${title(l.platform)}`}
                    style={{ ...btn, textDecoration: "none" }}>
                    View on {title(l.platform)} <ExternalLink size={12} />
                  </a>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 16, paddingTop: 14 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 13.5, color: C.ink, fontFamily: FONT_DISPLAY }}>Share these numbers</h3>
          <div style={muted}>
            A link always shows the latest numbers whenever it is opened, needs no sign-in, and stops working 120 days after you make it. An email is a copy made now: it states when the numbers are from, when its link stops working, and links to the live page.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            <button type="button" style={btn} onClick={copy} disabled={busy === "link"} title="Copy a link anyone can open to see this post's latest numbers"><Copy size={13} /> {busy === "link" ? "Making link…" : "Copy live link"}</button>
            {onOpenPost ? <button type="button" style={btn} onClick={() => { onClose(); onOpenPost(post.id); }} title="Open the post itself">Open the post</button> : null}
          </div>
          <form onSubmit={send} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            <input value={to} onChange={(e) => setTo(e.target.value)} aria-label="Email addresses" placeholder="Email addresses, separated by commas" title="Who should get these numbers by email"
              style={{ height: 36, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 10px", fontFamily: FONT_BODY, fontSize: 13 }} />
            <textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label="Message (optional)" placeholder="A message to go with it (optional)" rows={2} maxLength={1000}
              style={{ borderRadius: 8, border: `1px solid ${C.border}`, padding: 10, fontFamily: FONT_BODY, fontSize: 13, resize: "vertical" }} />
            <div><button type="submit" style={{ ...btn, background: C.ink, color: "#fff", borderColor: C.ink }} disabled={!to.trim() || busy === "mail"} title="Email these numbers"><Send size={13} /> {busy === "mail" ? "Sending…" : "Email these numbers"}</button></div>
          </form>
        </div>
      </div>
    </div>
  );
}

// The networks side by side: one row each, with a bar for its share of the total. A row opens that network's own numbers.
function ByChannel({ rows, days, onPick }) {
  const useEng = rows.some((r) => r.engagements != null);
  const metric = (r) => (useEng ? r.engagements : r.reach) || 0;
  const total = rows.reduce((n, r) => n + metric(r), 0);
  const heads = ["Network", "Posts", "Reach", "Views", "Engagements", "Rate", "Followers"];
  const num = { padding: "9px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", borderBottom: `1px solid ${C.border}` };
  return (
    <section style={card} aria-labelledby="in-chan">
      <h2 id="in-chan" style={h2}>By channel</h2>
      <div style={{ ...muted, marginBottom: 8 }}>
        How each network did over the last {days} days. The bar is its share of all {useEng ? "engagements" : "reach"}. Pick a network to see only its numbers below.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 620 }}>
          <thead>
            <tr style={{ color: C.slate }}>
              {heads.map((h, i) => <th key={h} scope="col" style={{ fontWeight: 600, padding: "6px 8px", borderBottom: `1px solid ${C.border}`, textAlign: i ? "right" : "left" }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const share = total ? Math.round((100 * metric(r)) / total) : 0;
              const none = !r.posts;
              const delta = r.change && r.change.reach;
              return (
                <tr key={r.platform} style={{ cursor: "pointer", color: none ? C.slate : C.ink }} onClick={() => onPick(r.platform)} title={`See only ${title(r.platform)}`}>
                  <td style={{ padding: "9px 8px", borderBottom: `1px solid ${C.border}`, minWidth: 170 }}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); onPick(r.platform); }} className="ui-link"
                      style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", fontWeight: 700, fontFamily: FONT_BODY, fontSize: 12.5, color: C.ink }}>
                      {title(r.platform)}
                    </button>
                    {none ? (
                      <div style={{ fontSize: 11, color: C.slate }}>No posts in this period</div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }} aria-label={`${share}% of ${useEng ? "engagements" : "reach"}`}>
                        <div style={{ flex: 1, height: 5, borderRadius: 3, background: C.border, maxWidth: 120 }}>
                          <div style={{ width: `${share}%`, height: "100%", borderRadius: 3, background: C.teal }} />
                        </div>
                        <span style={{ fontSize: 11, color: C.slate }}>{share}%</span>
                      </div>
                    )}
                  </td>
                  <td style={num}>{fmt(r.posts)}</td>
                  <td style={num}>
                    {fmt(r.reach)}
                    {delta != null ? <div style={{ fontSize: 11, fontWeight: 700, color: delta >= 0 ? C.teal : C.red }}>{delta > 0 ? "+" : ""}{delta}%</div> : null}
                  </td>
                  <td style={num}>{fmt(r.impressions)}</td>
                  <td style={num}>{fmt(r.engagements)}</td>
                  <td style={num}>{r.engagementRate == null ? "–" : r.engagementRate + "%"}</td>
                  <td style={num}>{r.followers == null ? "Not shared" : fmt(r.followers)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
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
