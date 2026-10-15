import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Circle, Lock, Phone, Search } from "lucide-react";
import { api } from "../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY } from "../tokens";
import { navigateHash } from "../utils/route";
import { openConnectionSettings, openPlans, useConnections } from "../hooks/useConnections";

// The top of Home once there is something to show: where the pipeline stands, what to do next, one inbox, one search
// and a short setup list. Each part appears only for the plugins the organisation has.

const text = { fontFamily: FONT_BODY };
const muted = { ...text, fontSize: 12.5, color: C.slate, lineHeight: 1.5 };
const head = { fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14.5, color: C.ink, margin: 0 };
const OPEN_LEAD_KEY = "aivhub_open_lead";

// Opens a company's panel in Lead Gen, from anywhere.
export function openLead(id) {
  if (!id) { navigateHash("#/leadgen/lists"); return; }
  try { sessionStorage.setItem(OPEN_LEAD_KEY, id); } catch (_) { /* the list still opens */ }
  navigateHash("#/leadgen/lists");
  window.setTimeout(() => { try { window.dispatchEvent(new CustomEvent("aivhub:open-lead", { detail: id })); } catch (_) { /* nothing to tell */ } }, 150);
}
export function takeOpenLead() {
  try { const id = sessionStorage.getItem(OPEN_LEAD_KEY); if (id) sessionStorage.removeItem(OPEN_LEAD_KEY); return id || ""; } catch (_) { return ""; }
}

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

function Card({ title, children, right }) {
  return (
    <section className="ui-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}><h2 style={{ ...head, flex: 1 }}>{title}</h2>{right}</div>
      {children}
    </section>
  );
}

function Funnel({ data }) {
  const top = Math.max(1, ...data.stages.map((s) => s.count));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {data.stages.map((s) => (
        <div key={s.key} style={{ display: "grid", gridTemplateColumns: "92px 1fr 70px", gap: 8, alignItems: "center" }}>
          <span style={{ ...text, fontSize: 12.5, color: C.slate }}>{s.label}</span>
          <div style={{ height: 10, background: C.paperSoft, borderRadius: 5, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.max(2, (s.count / top) * 100)}%`, background: C.cobalt }} />
          </div>
          <span style={{ ...text, fontSize: 12.5, color: C.ink, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{s.count.toLocaleString()}{s.of_previous != null ? <span style={{ color: C.slateLight }}> · {s.of_previous}%</span> : null}</span>
        </div>
      ))}
      {data.lost || data.do_not_contact ? <div style={muted}>{data.lost ? `${data.lost} not interested` : ""}{data.lost && data.do_not_contact ? " · " : ""}{data.do_not_contact ? `${data.do_not_contact} do not contact` : ""}</div> : null}
      {data.meetings_from_posts ? <div style={muted}>{data.meetings_from_posts} meeting{data.meetings_from_posts === 1 ? "" : "s"} came from your posts.</div> : null}
    </div>
  );
}

function SearchBox() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const timer = useRef(0);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) { setRes(null); return undefined; }
    timer.current = window.setTimeout(() => { api.searchEverything(q.trim()).then(setRes).catch(() => setRes({ groups: [] })); }, 250);
    return () => window.clearTimeout(timer.current);
  }, [q]);
  const go = (kind, item) => {
    setQ("");
    if (kind === "lead") openLead(item.id);
    else if (kind === "call" || kind === "meeting") (item.lead_id ? openLead(item.lead_id) : navigateHash(kind === "call" ? "#/voice/logs" : "#/voice/schedule"));
    else navigateHash("#/scheduler/plan");
  };
  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${C.border}`, background: "#fff", borderRadius: 10, padding: "0 12px", height: 42 }}>
        <Search size={16} color={C.slate} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people, companies, calls, meetings and posts" aria-label="Search everything"
          style={{ ...text, flex: 1, border: "none", outline: "none", fontSize: 14, background: "transparent" }} />
      </div>
      {res ? (
        <div className="ui-card" style={{ position: "absolute", left: 0, right: 0, top: 46, zIndex: 20, padding: 8, maxHeight: 360, overflowY: "auto" }}>
          {!res.groups.length ? <div style={{ ...muted, padding: 8 }}>Nothing found for “{q}”.</div> : res.groups.map((g) => (
            <div key={g.kind} style={{ marginBottom: 6 }}>
              <div style={{ ...muted, fontSize: 11.5, padding: "4px 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{g.label}</div>
              {g.items.map((it) => (
                <button key={it.id} type="button" onClick={() => go(g.kind, it)} style={{ ...text, all: "unset", display: "block", width: "calc(100% - 16px)", cursor: "pointer", padding: "6px 8px", borderRadius: 6, fontSize: 13 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.paperSoft; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                  <span style={{ color: C.ink, fontWeight: 600 }}>{it.title}</span> <span style={{ color: C.slate }}>{it.detail}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ConnectedHome({ operator }) {
  const { plugins, loading } = useConnections();
  const [pipe, setPipe] = useState(null);
  const [next, setNext] = useState(null);
  const [inbox, setInbox] = useState(null);
  const [check, setCheck] = useState(null);
  const [week, setWeek] = useState(null);
  const [tab, setTab] = useState("all");
  const owned = Object.values(plugins).filter(Boolean).length;
  useEffect(() => {
    if (loading || !owned) return;
    api.getPipeline().then(setPipe).catch(() => setPipe(null));
    api.getNextActions(5).then(setNext).catch(() => setNext(null));
    api.getInbox().then(setInbox).catch(() => setInbox(null));
    api.getConnectionChecklist().then(setCheck).catch(() => setCheck(null));
    api.getWeeklySummary().then(setWeek).catch(() => setWeek(null));
  }, [loading, owned]);
  if (loading || !owned) return null;

  const act = (it) => {
    if (it.action === "call" && it.lead_id) openLead(it.lead_id);
    else if (it.action === "meeting") navigateHash("#/voice/schedule");
    else openLead(it.lead_id);
  };
  const items = (inbox?.items || []).filter((i) => tab === "all" || i.type === tab || (tab === "calls" && ["needs_human", "callback"].includes(i.type)));
  const TYPE_WORD = { reply: "Reply", meeting_request: "Wants to talk", needs_human: "Needs a person", callback: "Call back", comment: "Comment" };
  const tabs = [["all", "Everything"], ["meeting_request", "Wants to talk"], ["reply", "Replies"], ["calls", "Calls"], ["comment", "Comments"]];
  const weekLines = week ? Object.entries(week.numbers) : [];
  const WEEK_WORD = { new_leads: "companies saved", emails_sent: "emails sent", replies: "replies", calls: "calls", conversations: "conversations", meetings: "meetings booked", posts: "posts published" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, margin: "0 0 28px" }}>
      <SearchBox />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 16 }}>
        <Card title="Do next" right={next && next.total > next.items.length ? <span style={muted}>{next.total} in all</span> : null}>
          {!next ? <div style={muted}>Loading…</div> : !next.items.length ? <div style={muted}>Nothing is waiting on you. New callbacks, warm leads and meetings to write up show here.</div> : next.items.map((it) => (
            <div key={`${it.kind}${it.lead_id}${it.meeting_id || ""}`} style={{ display: "flex", gap: 8, alignItems: "center", borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, overflowWrap: "anywhere" }}>{it.title}</div>
                <div style={muted}>{it.detail}</div>
              </div>
              {it.locked ? (
                <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Calling comes with Voice" onClick={() => openPlans("voice")}><Lock size={13} /> Add Voice</button>
              ) : (
                <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => act(it)}>{it.action === "call" ? <><Phone size={13} /> Open</> : <>Open <ArrowRight size={13} /></>}</button>
              )}
            </div>
          ))}
        </Card>
        {pipe ? (
          <Card title="Pipeline" right={<span style={muted}>across your plugins</span>}>
            {pipe.stages[0].count ? <Funnel data={pipe} /> : <div style={muted}>Save companies in Lead Gen and your pipeline builds here: found, verified, contacted, interested, meeting, won.</div>}
          </Card>
        ) : null}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 16 }}>
        <Card title="Inbox">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {tabs.map(([k, label]) => <button key={k} type="button" className={`ui-btn ui-btn--sm ${tab === k ? "ui-btn--primary" : "ui-btn--ghost"}`} onClick={() => setTab(k)}>{label}</button>)}
          </div>
          {!inbox ? <div style={muted}>Loading…</div> : !items.length ? <div style={muted}>Nothing here.</div> : items.slice(0, 8).map((i) => (
            <button key={i.type + i.id} type="button" onClick={() => (i.lead_id ? openLead(i.lead_id) : navigateHash(i.type === "comment" ? "#/scheduler/plan" : "#/leadgen/replies"))}
              style={{ ...text, all: "unset", cursor: "pointer", display: "block", borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
              <div style={{ fontSize: 13, color: C.ink, fontWeight: 600, overflowWrap: "anywhere" }}>{i.title}</div>
              <div style={muted}>{TYPE_WORD[i.type] || i.type} · {when(i.at)}{i.text ? ` · ${i.text.slice(0, 90)}` : ""}</div>
            </button>
          ))}
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {check && check.done < check.total ? (
            <Card title="Set up your plugins together" right={<span style={muted}>{check.done} of {check.total}</span>}>
              {check.steps.filter((s) => s.available).map((s) => (
                <div key={s.key} style={{ display: "flex", gap: 8, alignItems: "center", ...text, fontSize: 13, color: s.done ? C.slate : C.ink }}>
                  {s.done ? <CheckCircle2 size={15} color={C.teal} /> : <Circle size={15} color={C.slateLight} />}
                  <span style={{ flex: 1, textDecoration: s.done ? "line-through" : "none" }}>{s.label}</span>
                  {!s.done ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => (s.key === "calendar" || s.key === "call_window" ? navigateHash("#/voice/hours") : s.key === "mailbox" ? navigateHash("#/leadgen/mailboxes") : openConnectionSettings("follow"))}>Do it</button> : null}
                </div>
              ))}
            </Card>
          ) : null}
          {weekLines.length ? (
            <Card title="Last 7 days" right={operator?.is_admin ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => openConnectionSettings("follow")}>Get this by email</button> : null}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                {weekLines.map(([k, n]) => <div key={k}><div style={{ ...text, fontSize: 20, fontWeight: 600, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{n.toLocaleString()}</div><div style={muted}>{WEEK_WORD[k]}</div></div>)}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
