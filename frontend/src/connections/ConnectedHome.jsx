import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, Circle, Lock, Phone, Search } from "lucide-react";
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

function Funnel({ data }) {
  const top = Math.max(1, ...data.stages.map((s) => s.count));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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

// Which plugin each inbox kind and weekly number belongs to, so a company with one plugin sees only its own.
const KIND_PLUGIN = { reply: "leads", meeting_request: "leads", needs_human: "voice", callback: "voice", comment: "social" };
const WEEK_PLUGIN = { new_leads: "leads", emails_sent: "leads", replies: "leads", calls: "voice", conversations: "voice", meetings: "voice", posts: "social" };
const WEEK_WORD = { new_leads: "companies", emails_sent: "emails sent", replies: "replies", calls: "calls", conversations: "conversations", meetings: "meetings", posts: "posts" };
const TYPE_WORD = { reply: "Reply", meeting_request: "Wants to talk", needs_human: "Needs a person", callback: "Call back", comment: "Comment" };
const TAB_DEFS = [["all", "Everything", null], ["meeting_request", "Wants to talk", "leads"], ["reply", "Replies", "leads"], ["calls", "Calls", "voice"], ["comment", "Comments", "social"]];

// On a desktop screen the whole of Home fits the window with no page scroll; on a phone it stacks and scrolls as usual.
const FIT_CSS = `
.home-top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
.home-top .home-search{flex:1 1 320px;max-width:460px;min-width:0}
.home-main{display:grid;gap:14px;min-height:0;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr)}
.home-col{display:flex;flex-direction:column;gap:14px;min-width:0;min-height:0}
.home-col>section{min-height:0;overflow:hidden}
.home-grow{flex:1 1 auto}
@media (max-width:820px){.home-main{grid-template-columns:1fr}.home-cards{order:5}}
@media (min-width:821px) and (min-height:700px){.home-fit{height:calc(100vh - 60px);box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column}.home-fit .home-main{flex:1}}
`;

function Panel({ title, right, children, grow }) {
  return (
    <section className={`ui-card${grow ? " home-grow" : ""}`} style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}><h2 style={{ ...head, flex: 1 }}>{title}</h2>{right}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0, minHeight: 0, flex: 1, overflow: "hidden" }}>{children}</div>
    </section>
  );
}

const Empty = ({ children }) => <div style={{ ...muted, padding: "6px 0" }}>{children}</div>;
const row = { display: "flex", gap: 10, alignItems: "center", borderTop: `1px solid ${C.border}`, padding: "9px 0" };
const clamp = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" };

export function ConnectedHome({ operator, cards, plainCards, greeting }) {
  const { plugins, loading } = useConnections();
  const [pipe, setPipe] = useState(null);
  const [next, setNext] = useState(null);
  const [inbox, setInbox] = useState(null);
  const [inboxFailed, setInboxFailed] = useState(false);
  const [check, setCheck] = useState(null);
  const [week, setWeek] = useState(null);
  const [tab, setTab] = useState("all");
  const [mail, setMail] = useState({ busy: false, note: "" });
  const owned = Object.values(plugins).filter(Boolean).length;
  const loadInbox = () => {
    setInbox(null);
    setInboxFailed(false);
    api.getInbox().then(setInbox).catch(() => setInboxFailed(true));
  };
  useEffect(() => {
    if (loading || !owned) return;
    api.getPipeline().then(setPipe).catch(() => setPipe(null));
    api.getNextActions(4).then(setNext).catch(() => setNext({ items: [], total: 0 }));
    loadInbox();
    api.getConnectionChecklist().then(setCheck).catch(() => setCheck(null));
    api.getWeeklySummary().then(setWeek).catch(() => setWeek(null));
  }, [loading, owned]);
  if (loading || !owned) return <>{greeting}{plainCards}</>;

  const act = (it) => {
    if (it.action === "meeting") navigateHash("#/voice/schedule");
    else openLead(it.lead_id);
  };
  const tabs = TAB_DEFS.filter(([, , plugin]) => !plugin || plugins[plugin]);
  const items = (inbox?.items || []).filter((i) => plugins[KIND_PLUGIN[i.type]] && (tab === "all" || i.type === tab || (tab === "calls" && ["needs_human", "callback"].includes(i.type))));
  const weekLines = week ? Object.entries(week.numbers).filter(([k]) => plugins[WEEK_PLUGIN[k]]) : [];
  const todo = check ? check.steps.filter((s) => s.available && !s.done) : [];
  const showPipe = Boolean(plugins.leads && pipe);
  const emailMe = async () => {
    setMail({ busy: true, note: "" });
    try { const r = await api.sendWeeklySummary(); setMail({ busy: false, note: `Sent to ${r.to}` }); }
    catch (e) { setMail({ busy: false, note: e.message || "Couldn't send it." }); }
    window.setTimeout(() => setMail((m) => ({ ...m, note: "" })), 6000);
  };
  const fix = (s) => (s.key === "calendar" || s.key === "call_window" ? navigateHash("#/voice/hours") : s.key === "mailbox" ? navigateHash("#/leadgen/mailboxes") : openConnectionSettings("follow"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, minHeight: 0 }}>
      <style>{FIT_CSS}</style>
      <div className="home-top">
        <div style={{ minWidth: 0 }}>{greeting}</div>
        <div className="home-search"><SearchBox /></div>
      </div>
      {cards}
      <div className="home-main">
        <div className="home-col">
          <Panel title="Do next" right={next && next.total > next.items.length ? <span style={muted}>{next.total} in all</span> : null}>
            {!next ? <Empty>Loading…</Empty> : !next.items.length ? <Empty>Nothing is waiting on you. Callbacks, warm leads and meetings to write up show here.</Empty> : next.items.map((it) => (
              <div key={`${it.kind}${it.lead_id}${it.meeting_id || ""}`} style={row}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...text, fontSize: 13.5, fontWeight: 600, color: C.ink, ...clamp }}>{it.title}</div>
                  <div style={muted}>{it.detail}</div>
                </div>
                {it.locked ? (
                  <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" title="Calling comes with Voice" onClick={() => openPlans("voice")}><Lock size={13} /> Add Voice</button>
                ) : (
                  <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => act(it)}>{it.action === "call" ? <><Phone size={13} /> Open</> : <>Open <ArrowRight size={13} /></>}</button>
                )}
              </div>
            ))}
          </Panel>
          <Panel title="Inbox">
            {tabs.length > 2 ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                {tabs.map(([k, label]) => <button key={k} type="button" className={`ui-btn ui-btn--sm ${tab === k ? "ui-btn--primary" : "ui-btn--ghost"}`} onClick={() => setTab(k)}>{label}</button>)}
              </div>
            ) : null}
            {inboxFailed ? (
              <Empty>We couldn't load your inbox. <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={loadInbox}>Try again</button></Empty>
            ) : !inbox ? <Empty>Loading…</Empty> : !items.length ? <Empty>Nothing new. Replies, callbacks and comments from your plugins land here.</Empty> : items.slice(0, 5).map((i) => (
              <button key={i.type + i.id} type="button" onClick={() => (i.lead_id ? openLead(i.lead_id) : navigateHash(i.type === "comment" ? "#/scheduler/plan" : i.type === "reply" || i.type === "meeting_request" ? "#/leadgen/replies" : "#/voice/logs"))}
                style={{ ...text, all: "unset", cursor: "pointer", display: "block", boxSizing: "border-box", width: "100%", borderTop: `1px solid ${C.border}`, padding: "9px 0" }}>
                <div style={{ fontSize: 13, color: C.ink, fontWeight: 600, ...clamp, WebkitLineClamp: 1 }}>{i.title}</div>
                <div style={{ ...muted, ...clamp, WebkitLineClamp: 1 }}>{TYPE_WORD[i.type] || i.type} · {when(i.at)}{i.text ? ` · ${i.text}` : ""}</div>
              </button>
            ))}
          </Panel>
        </div>
        <div className="home-col">
          {showPipe ? (
            <Panel title="Pipeline" right={<span style={muted}>across your plugins</span>}>
              {pipe.stages[0].count ? <Funnel data={pipe} /> : <Empty>Save companies in Lead Gen and your pipeline builds here.</Empty>}
            </Panel>
          ) : null}
          {weekLines.length ? (
            <Panel title="Last 7 days" right={<>{mail.note ? <span role="status" style={muted}>{mail.note}</span> : null}{operator?.is_admin ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={mail.busy} onClick={emailMe}>{mail.busy ? "Sending…" : "Email me this"}</button> : null}</>}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "8px 10px" }}>
                {weekLines.map(([k, n]) => (
                  <div key={k}><div style={{ ...text, fontSize: 18, fontWeight: 600, color: C.ink, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{n.toLocaleString()}</div><div style={muted}>{WEEK_WORD[k]}</div></div>
                ))}
              </div>
            </Panel>
          ) : null}
          {todo.length ? (
            <Panel title="Finish setting up" right={<span style={muted}>{todo.length} left</span>}>
              {todo.slice(0, 1).map((s) => (
                <div key={s.key} style={row}>
                  <Circle size={15} color={C.slateLight} style={{ flexShrink: 0 }} />
                  <span style={{ ...text, fontSize: 13, color: C.ink, flex: 1, minWidth: 0, ...clamp }}>{s.label}</span>
                  <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => fix(s)}>Do it</button>
                </div>
              ))}
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
