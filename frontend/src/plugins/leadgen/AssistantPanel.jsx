import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Building2, Check, ChevronRight, Clock, ListPlus, Plus, Send, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { Spinner } from "../../app/Loader";
import { C, FONT_BODY } from "../../tokens";
import { asAccount } from "./FindLeadsView";

// The AI assistant: a panel that sits to the right of any Leads page and pushes the page aside, opened from the dark button in the
// header or the menu. The server picks tools and words the answer (see api/lead_assistant.py). Companies always come from the stored
// register. Anything that costs credits or changes a list is shown as a card and only happens when the person presses its button.

const GOALS = [
  { id: "prospects", Icon: Sparkles, title: "Find ideal prospects", note: "Companies that fit your business, and why", prompt: "Find the best companies for my business and explain why they fit." },
  { id: "list", Icon: ListPlus, title: "Build a company list", note: "Say who you want, for example cafes in Leeds", prefill: "Find " },
  { id: "campaign", Icon: Send, title: "Write an email campaign", note: "Pick a list, write the emails, send", go: "outreach" },
];
const STAGES = ["Understanding your request", "Searching the company register", "Putting the answer together"];
const HISTORY_KEY = "leadgen_assistant";

const css = `
.as-wrap{flex:0 0 400px;width:400px;height:100vh;overflow:hidden;position:relative;z-index:70;animation:as-grow .28s var(--mo-ease,cubic-bezier(.2,.8,.2,1)) both}
.as-wrap[data-leaving="true"]{animation:as-shrink .22s var(--mo-ease,ease) both}
@keyframes as-grow{from{flex-basis:0;width:0;opacity:.4}to{flex-basis:400px;width:400px;opacity:1}}
@keyframes as-shrink{from{flex-basis:400px;width:400px;opacity:1}to{flex-basis:0;width:0;opacity:0}}
.as-panel{width:400px;height:100vh;box-sizing:border-box;display:flex;flex-direction:column;background:#fff;border-left:1px solid var(--ui-line,#E3E6EF)}
.as-head{display:flex;align-items:center;gap:6px;padding:0 10px 0 16px;height:56px;flex:none;border-bottom:1px solid var(--ui-line,#E3E6EF)}
.as-body{flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px;scroll-behavior:smooth}
.as-goal{all:unset;box-sizing:border-box;width:100%;display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border:1px solid var(--ui-line,#E3E6EF);border-radius:12px;cursor:pointer;background:#fff;animation:mo-rise .34s var(--mo-ease,ease) both;transition:border-color .15s,background-color .15s,transform .15s var(--mo-ease,ease),box-shadow .15s}
.as-goal:nth-of-type(1){animation-delay:.05s}.as-goal:nth-of-type(2){animation-delay:.1s}.as-goal:nth-of-type(3){animation-delay:.15s}
.as-goal:hover{border-color:var(--ui-accent,#3457D5);background:var(--ui-accent-soft,#F5F7FF);transform:translateY(-1px);box-shadow:0 4px 14px rgba(20,24,40,.07)}
.as-goal:active{transform:scale(.99)}
.as-goal:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:2px}
.as-me{align-self:flex-end;max-width:88%;background:var(--ui-sunken,#F1F3F8);border-radius:14px 14px 4px 14px;padding:9px 13px;white-space:pre-wrap;overflow-wrap:anywhere;animation:mo-rise .26s var(--mo-ease,ease) both}
.as-bot{align-self:flex-start;max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;animation:mo-rise .3s var(--mo-ease,ease) both}
.as-card{margin-top:10px;border:1px solid var(--ui-line,#E3E6EF);border-radius:12px;padding:10px 12px;background:#fff;white-space:normal;animation:mo-rise .34s .08s var(--mo-ease,ease) both}
.as-hit{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid var(--ui-line-soft,#EEF0F5)}
.as-steps{display:grid;grid-template-rows:0fr;transition:grid-template-rows .26s var(--mo-ease,ease);white-space:normal}
.as-steps[data-open="true"]{grid-template-rows:1fr}
.as-steps>div{overflow:hidden;min-height:0}
.as-chev{transition:transform .2s var(--mo-ease,ease)}
.as-chev[data-open="true"]{transform:rotate(90deg)}
.as-toggle{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:4px;font:12px Inter,sans-serif;color:var(--ui-muted,#6B7280);margin-bottom:6px;border-radius:6px;padding:1px 4px 1px 0}
.as-toggle:hover,.as-toggle:focus-visible{color:var(--ui-ink,#111827)}
.as-dots{display:inline-flex;gap:3px;margin-left:2px}
.as-dots i{width:5px;height:5px;border-radius:50%;background:var(--ui-muted,#6B7280);animation:mo-dot 1.1s ease-in-out infinite}
.as-dots i:nth-child(2){animation-delay:.15s}.as-dots i:nth-child(3){animation-delay:.3s}
.as-foot{flex:none;padding:10px 14px 12px;border-top:1px solid var(--ui-line,#E3E6EF);background:#fff}
.as-box{display:flex;align-items:flex-end;gap:8px;border:1px solid var(--ui-line,#E3E6EF);border-radius:12px;padding:8px 8px 8px 12px;background:#fff;transition:border-color .15s,box-shadow .15s}
.as-box:focus-within{border-color:var(--ui-accent,#3457D5);box-shadow:0 0 0 3px var(--ui-accent-soft,#EEF2FE)}
.as-box textarea{all:unset;flex:1;min-width:0;font:13.5px/1.45 Inter,sans-serif;max-height:120px;overflow-y:auto;color:var(--ui-ink,#111827);white-space:pre-wrap}
.as-send{all:unset;cursor:pointer;width:30px;height:30px;border-radius:8px;background:#111520;color:#fff;display:inline-flex;align-items:center;justify-content:center;flex:none;transition:transform .12s var(--mo-ease,ease),opacity .15s}
.as-send:not([disabled]):hover{transform:translateY(-1px)}.as-send:not([disabled]):active{transform:scale(.94)}
.as-send[disabled]{opacity:.35;cursor:default}
.as-send:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:2px}
.as-icon{all:unset;cursor:pointer;width:30px;height:30px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:var(--ui-muted,#6B7280);transition:background-color .12s,color .12s}
.as-icon:hover,.as-icon:focus-visible{background:var(--ui-hover,#F1F3F8);color:var(--ui-ink,#111827)}
.as-field{display:flex;flex-direction:column;gap:3px;font:12px Inter,sans-serif;color:var(--ui-muted,#6B7280)}
.as-field textarea,.as-field input{font:13px/1.4 Inter,sans-serif}
.as-orb{animation:mo-pop .5s var(--mo-ease,ease) both}
@media (max-width:820px){
  .as-wrap{position:fixed;inset:0;width:100%;flex-basis:auto;z-index:90;animation:mo-slide-in .26s var(--mo-ease,ease) both}
  .as-wrap[data-leaving="true"]{animation:mo-slide-out .2s var(--mo-ease,ease) both}
  .as-panel{width:100%}
}
@media (prefers-reduced-motion:reduce){
  .as-wrap,.as-wrap[data-leaving="true"],.as-goal,.as-me,.as-bot,.as-card,.as-orb{animation:none}
  .as-steps,.as-chev,.as-goal,.as-send{transition:none}
  .as-dots i{animation:none;opacity:.7}
}
`;

export function AssistantButton({ open, onClick }) {
  return (
    <button type="button" className="ui-btn ui-btn--sm as-open" aria-pressed={open} title={open ? "Close the AI assistant" : "Open the AI assistant"} onClick={onClick}
      style={{ background: "#111520", color: "#fff", border: "1px solid #111520", display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
      <Sparkles size={14} aria-hidden="true" /> <span className="hide-xs">AI Assistant</span>
    </button>
  );
}

const seconds = (ms) => (ms < 1000 ? "less than a second" : `${Math.round(ms / 1000)} second${Math.round(ms / 1000) === 1 ? "" : "s"}`);

function Steps({ steps, tookMs }) {
  const [on, setOn] = useState(false);
  if (!steps?.length) return null;
  return (
    <div>
      <button type="button" className="as-toggle" aria-expanded={on} onClick={() => setOn((v) => !v)}>
        <ChevronRight size={13} className="as-chev" data-open={on} aria-hidden="true" /> Worked for {seconds(tookMs || 0)}
      </button>
      <div className="as-steps" data-open={on}>
        <div>
          <ol style={{ margin: "0 0 8px", padding: "0 0 0 4px", listStyle: "none", display: "grid", gap: 6 }}>
            {steps.map((s, i) => (
              <li key={i} style={{ display: "flex", gap: 8, fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>
                <Check size={13} color={C.green} aria-hidden="true" style={{ flex: "none", marginTop: 2 }} />
                <span><strong style={{ color: C.ink, fontWeight: 600 }}>{s.label}</strong>{s.detail ? <><br />{s.detail}</> : null}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

// "Tell me about your business": read the website, let the person fix the fields, save them where every tool reads them.
function ProfileSetup({ onSaved }) {
  const [url, setUrl] = useState("");
  const [fields, setFields] = useState(null);
  const [base, setBase] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { api.emailGetWritingProfile().then(setBase).catch(() => {}); }, []);
  const canEdit = base ? base.can_edit !== false : true;
  const read = async () => {
    if (!url.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const r = await api.assistantProfileFromSite(url.trim());
      setFields({ ...r.profile, website: r.website });
    } catch (err) { setError(err.message || "I couldn't read that site."); }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true); setError("");
    try {
      await api.emailSaveWritingProfile({ ...(base?.edit || {}), ...fields });
      onSaved();
    } catch (err) { setError(err.message || "Couldn't save."); }
    setBusy(false);
  };
  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));
  const small = { fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate };
  return (
    <div className="as-card" style={{ marginTop: 0 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.ink }}><Building2 size={16} aria-hidden="true" /> Tell me about your business</div>
      <p style={{ ...small, margin: "4px 0 8px" }}>Give me your website and I will read it, so my answers fit what you sell.</p>
      {!fields ? (
        <div style={{ display: "flex", gap: 6 }}>
          <input className="ui-input" aria-label="Your website" placeholder="yourcompany.com" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") read(); }} style={{ flex: 1, minWidth: 0 }} />
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy || !url.trim()} onClick={read}>{busy ? <Spinner size={13} /> : "Read it"}</button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {[["company", "Company name", "input"], ["sells", "What you sell", "textarea"], ["audience", "Who buys it", "textarea"], ["offer", "Your main offer", "textarea"], ["tone", "How you speak", "input"]].map(([k, label, kind]) => (
            <label key={k} className="as-field">{label}
              {kind === "input" ? <input className="ui-input" value={fields[k] || ""} onChange={set(k)} maxLength={200} /> : <textarea className="ui-input" rows={2} value={fields[k] || ""} onChange={set(k)} maxLength={600} style={{ height: "auto", padding: 8, resize: "vertical" }} />}
            </label>
          ))}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy || !canEdit || !fields.company?.trim() || !fields.sells?.trim()} onClick={save}>{busy ? <Spinner size={13} /> : "Save"}</button>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setFields(null)}>Back</button>
            {!canEdit ? <span style={small}>Only an admin can save this.</span> : null}
          </div>
        </div>
      )}
      {error ? <div role="alert" style={{ ...small, color: C.red, marginTop: 6 }}>{error}</div> : null}
    </div>
  );
}

export function AssistantPanel({ open, onClose, store, lists, onShowResults, onGo, onCampaign, onOpenList }) {
  const [render, setRender] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [view, setView] = useState("chat"); // chat | history
  const [history, setHistory] = useState([]);
  const [acts, setActs] = useState({}); // proposal id -> { state: "running" | "done" | "error", text }
  const filters = useRef({});
  const chatId = useRef(`a_${Date.now()}`);
  const run = useRef(0);
  const endRef = useRef(null);
  const boxRef = useRef(null);

  const loadProfile = useCallback(() => {
    api.emailGetWritingProfile().then((r) => setNeedsProfile(!r?.edit?.company || !r?.edit?.sells)).catch(() => {});
  }, []);
  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => {
    if (open) { setRender(true); setLeaving(false); return undefined; }
    if (!render) return undefined;
    setLeaving(true);
    const t = setTimeout(() => { setRender(false); setLeaving(false); }, 220);
    return () => clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!busy) return undefined;
    setStage(0);
    const t = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 3200);
    return () => clearInterval(t);
  }, [busy]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [messages, busy, acts]);
  useEffect(() => { if (open && view === "chat") setTimeout(() => boxRef.current?.focus(), 80); }, [open, view]);

  if (!render) return null;

  const remember = (list) => {
    const first = list.find((m) => m.role === "user");
    if (!first) return;
    api.saveChatHistory(HISTORY_KEY, {
      id: chatId.current, title: first.text.slice(0, 70), at: Date.now(), filters: filters.current,
      chat: list.map((m) => ({ id: m.id, role: m.role, text: m.text, ...(m.found ? { found: m.found.total } : {}) })),
    }).catch(() => {});
  };

  const send = async (override) => {
    const text = String(override ?? input).trim();
    if (!text || busy) return;
    setInput("");
    const prior = messages.map((m) => ({ role: m.role, content: m.text }));
    const asked = [...messages, { id: `u${Date.now()}`, role: "user", text }];
    setMessages(asked);
    setBusy(true);
    const mine = ++run.current;
    let res = null;
    let failure = null;
    try {
      res = await api.assistantAsk({ message: text, history: prior, filters: filters.current, lists: (lists || []).map((l) => ({ id: l.id, name: l.name, count: l.count })) });
    } catch (err) { failure = err; }
    if (mine !== run.current) return;
    setBusy(false);
    let next;
    if (failure) {
      next = [...asked, { id: `a${Date.now()}`, role: "assistant", error: true, text: failure.message || "I couldn't reach the AI. Try again in a moment." }];
    } else {
      if (res.found?.filters) filters.current = res.found.filters;
      next = [...asked, { id: `a${Date.now()}`, role: "assistant", text: res.reply, steps: res.steps, tookMs: res.took_ms, found: res.found, proposals: res.proposals }];
    }
    setMessages(next);
    if (!failure) remember(next);
  };

  const stop = () => { run.current += 1; setBusy(false); };
  const fresh = () => { run.current += 1; setBusy(false); setMessages([]); setInput(""); setActs({}); filters.current = {}; chatId.current = `a_${Date.now()}`; setView("chat"); };
  const showHistory = () => {
    setView("history");
    api.chatHistory(HISTORY_KEY).then((r) => setHistory(r?.chats || [])).catch(() => setHistory([]));
  };
  const openChat = (h) => {
    run.current += 1; setBusy(false); setActs({});
    chatId.current = h.id; filters.current = h.filters || {};
    setMessages((h.chat || []).map((m) => ({ id: m.id, role: m.role === "user" ? "user" : "assistant", text: m.text })));
    setView("chat");
  };
  const forget = (id) => { setHistory((h) => h.filter((x) => x.id !== id)); api.deleteChatHistory(HISTORY_KEY, id).catch(() => {}); };

  const pick = (g) => {
    if (g.go) { onGo?.(g.go); return; }
    if (g.prompt) { send(g.prompt); return; }
    setInput(g.prefill || "");
    boxRef.current?.focus();
  };

  // A card's button: the only place the assistant's suggestions turn into action.
  const confirm = async (p) => {
    if (p.kind === "check_list") { onOpenList?.(p.params.list_id); return; }
    if (p.kind === "campaign") { onCampaign?.(p.params.list_id); return; }
    setActs((a) => ({ ...a, [p.id]: { state: "running" } }));
    try {
      const r = await api.searchCompanies({ filters: p.params.filters, limit: p.params.how_many, offset: 0, exclude_ids: [], sort: "best" });
      const accounts = (r.companies || []).map(asAccount);
      if (!accounts.length) throw new Error("That search has no companies to save.");
      await store.save(accounts, p.params.list_name);
      setActs((a) => ({ ...a, [p.id]: { state: "done", text: `Saved ${accounts.length} to “${p.params.list_name}”.` } }));
    } catch (err) {
      setActs((a) => ({ ...a, [p.id]: { state: "error", text: err.message || "Couldn't save them." } }));
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === "Escape") onClose();
  };

  const text = { fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink };
  const muted = { fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate };

  return (
    <div className="as-wrap" data-leaving={leaving}>
      <aside className="as-panel" aria-label="AI assistant">
        <style>{css}</style>
        <div className="as-head">
          <Sparkles size={16} aria-hidden="true" />
          <strong style={{ ...text, fontSize: 14, flex: 1 }}>{view === "history" ? "Earlier chats" : "AI Assistant"}</strong>
          <button type="button" className="as-icon" title="Earlier chats" aria-label="Earlier chats" onClick={() => (view === "history" ? setView("chat") : showHistory())}><Clock size={16} /></button>
          <button type="button" className="as-icon" title="Start a new chat" aria-label="Start a new chat" onClick={fresh}><Plus size={16} /></button>
          <button type="button" className="as-icon" title="Close" aria-label="Close the assistant" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="as-body">
          {view === "history" ? (
            history.length ? history.map((h) => (
              <div key={h.id} className="as-hit" style={{ alignItems: "center" }}>
                <button type="button" className="ui-link" style={{ ...text, textAlign: "left", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => openChat(h)}>{h.title || "Chat"}</button>
                <span style={muted}>{h.at ? new Date(h.at).toLocaleDateString([], { day: "numeric", month: "short" }) : ""}</span>
                <button type="button" className="as-icon" title="Delete this chat" aria-label={`Delete ${h.title}`} onClick={() => forget(h.id)}><Trash2 size={14} /></button>
              </div>
            )) : <div style={muted}>No earlier chats yet.</div>
          ) : (
            <>
              {!messages.length ? (
                <>
                  <div style={{ textAlign: "center", padding: "18px 0 4px" }}>
                    <span className="ld-orb as-orb" aria-hidden="true" style={{ width: 54, height: 54, margin: "0 auto 12px" }}><Sparkles size={24} color="var(--ui-accent, #3457D5)" /></span>
                    <h2 style={{ ...text, fontSize: 18, fontWeight: 600, margin: 0 }}>What can I do for you today?</h2>
                    <p style={{ ...muted, margin: "6px 0 0" }}>Ask in your own words, or start with one of these.</p>
                  </div>
                  {GOALS.map((g) => (
                    <button key={g.id} type="button" className="as-goal" onClick={() => pick(g)}>
                      <g.Icon size={18} color="var(--ui-accent, #3457D5)" aria-hidden="true" style={{ marginTop: 2, flex: "none" }} />
                      <span><span style={{ ...text, fontWeight: 600, display: "block" }}>{g.title}</span><span style={muted}>{g.note}</span></span>
                    </button>
                  ))}
                  {needsProfile ? <ProfileSetup onSaved={() => { setNeedsProfile(false); loadProfile(); }} /> : null}
                </>
              ) : null}

              {messages.map((m) => (m.role === "user" ? (
                <div key={m.id} className="as-me" style={text}>{m.text}</div>
              ) : (
                <div key={m.id} className="as-bot" style={{ ...text, color: m.error ? C.red : C.ink }}>
                  <Steps steps={m.steps} tookMs={m.tookMs} />
                  {m.text}
                  {m.found ? (
                    <div className="as-card">
                      <div style={{ ...text, fontWeight: 600 }}>{m.found.total.toLocaleString()}{m.found.capped ? "+" : ""} {m.found.total === 1 ? "company" : "companies"} found</div>
                      {(m.found.top || []).slice(0, 5).map((c) => (
                        <div key={c.id} className="as-hit">
                          <span style={{ ...text, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                          <span style={{ ...muted, flex: "none" }}>{c.region || ""}</span>
                        </div>
                      ))}
                      {m.found.total > 0 ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ marginTop: 8 }} onClick={() => onShowResults?.(m.found.filters)}>Show all in Find Leads</button> : null}
                    </div>
                  ) : null}
                  {(m.proposals || []).map((p) => {
                    const a = acts[p.id] || {};
                    return (
                      <div key={p.id} className="as-card">
                        <div style={{ ...text, fontWeight: 600, display: "flex", gap: 6, alignItems: "center" }}>
                          {p.kind === "check_list" ? <ShieldCheck size={15} aria-hidden="true" /> : p.kind === "campaign" ? <Send size={15} aria-hidden="true" /> : <ListPlus size={15} aria-hidden="true" />} {p.title}
                        </div>
                        <div style={{ ...muted, margin: "2px 0 8px" }}>{a.text || p.detail}</div>
                        {a.state === "done" ? <span style={{ ...muted, color: C.green, display: "inline-flex", gap: 4, alignItems: "center" }}><Check size={14} aria-hidden="true" /> Done</span> : (
                          <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={a.state === "running"} onClick={() => confirm(p)}>
                            {a.state === "running" ? <><Spinner size={13} /> Saving</> : p.kind === "add_to_list" ? (a.state === "error" ? "Try again" : "Save them") : p.kind === "check_list" ? "Open the check" : "Set up the campaign"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )))}

              {busy ? (
                <div role="status" aria-live="polite" style={{ ...muted, display: "flex", alignItems: "center", gap: 8 }}>
                  <Spinner size={14} /> <span>{STAGES[stage]}<span className="as-dots" aria-hidden="true"><i /><i /><i /></span></span>
                  <button type="button" className="ui-link" style={{ marginLeft: "auto" }} onClick={stop}>Stop</button>
                </div>
              ) : null}
              <div ref={endRef} />
            </>
          )}
        </div>

        {view === "chat" ? (
          <div className="as-foot">
            <div className="as-box">
              <textarea ref={boxRef} rows={1} value={input} placeholder="Ask anything, or describe who you want to find" aria-label="Message the assistant"
                onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} />
              <button type="button" className="as-send" aria-label="Send" disabled={!input.trim() || busy} onClick={() => send()}><ArrowUp size={16} /></button>
            </div>
            <div style={{ ...muted, fontSize: 11.5, marginTop: 6 }}>Searching the register is free. Saving, checking and sending only happen when you press the button on a card.</div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
