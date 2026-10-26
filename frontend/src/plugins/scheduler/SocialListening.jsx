import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, EyeOff, Plus, RefreshCw, Search, Trash2, UserPlus } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY, FONT_DISPLAY, HUB_PAPER } from "../../tokens";

// Listening: public posts that mention the words a company cares about, from the networks that let
// apps search. Each source says plainly when it cannot search and what would fix it.

const page = { flex: 1, overflowY: "auto", padding: "22px 28px 48px", background: HUB_PAPER, fontFamily: FONT_BODY };
const card = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 };
const muted = { fontSize: 12.5, color: C.slate, lineHeight: 1.5 };
const btn = {
  display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 8,
  border: `1px solid ${C.border}`, background: "#fff", color: C.ink, fontWeight: 600, fontSize: 12, cursor: "pointer", fontFamily: FONT_BODY,
};
const primary = { ...btn, background: C.ink, color: "#fff", borderColor: C.ink };
const field = { width: "100%", height: 34, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 10px", fontFamily: FONT_BODY, fontSize: 13, boxSizing: "border-box", background: "#fff", marginTop: 4 };
const label = { display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginTop: 10 };
const SOURCES = [
  ["reddit", "Reddit", "Posts across Reddit, checked every hour."],
  ["threads", "Threads", "Recent posts, every 2 hours. Needs keyword search approved by Meta."],
  ["instagram", "Instagram", "Hashtags only (one-word keywords), every 6 hours."],
  ["x", "X", "Recent posts, once a day. Each search costs on your X API plan."],
];
const NAME = Object.fromEntries(SOURCES.map(([id, n]) => [id, n]));

function ago(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function TopicForm({ initial, available, onSaved, onCancel, showToast }) {
  const [f, setF] = useState(() => ({
    name: (initial && initial.name) || "",
    keywords: ((initial && initial.keywords) || []).join(", "),
    exclude: ((initial && initial.exclude) || []).join(", "),
    sources: (initial && initial.sources) || ["reddit"],
  }));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = initial && initial.id ? await api.saveListenTopic(initial.id, f) : await api.createListenTopic(f);
      onSaved(res);
    } catch (err) {
      showToast(err.message || "Could not save the topic.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} style={{ ...card, borderColor: C.teal }} aria-label={initial && initial.id ? "Edit topic" : "New topic"}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15 }}>{initial && initial.id ? "Edit topic" : "Listen for"}</div>
      <label style={label}>Words or phrases (separated by commas)
        <input style={field} required value={f.keywords} placeholder="your brand, your product, a competitor" onChange={(e) => set("keywords", e.target.value)} />
      </label>
      <label style={label}>Leave out posts that mention (optional)
        <input style={field} value={f.exclude} placeholder="jobs, hiring" onChange={(e) => set("exclude", e.target.value)} />
      </label>
      <label style={label}>Name (optional)<input style={field} value={f.name} maxLength={80} placeholder="e.g. Our brand" onChange={(e) => set("name", e.target.value)} /></label>
      <fieldset style={{ border: "none", padding: 0, margin: "12px 0 0" }}>
        <legend style={{ fontSize: 11.5, fontWeight: 700, color: C.slate }}>Where</legend>
        {SOURCES.map(([id, name, note]) => (
          <label key={id} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, cursor: "pointer", marginTop: 6 }}>
            <input type="checkbox" style={{ marginTop: 3 }} checked={f.sources.includes(id)}
              onChange={(e) => set("sources", e.target.checked ? [...f.sources, id] : f.sources.filter((s) => s !== id))} />
            <span>{name}<span style={{ ...muted, fontSize: 12, display: "block" }}>
              {note}{available && available[id] === false ? (id === "reddit" ? " Not set up yet: ask support, or connect a Reddit account." : ` Connect a ${name} account under Accounts first.`) : ""}
            </span></span>
          </label>
        ))}
      </fieldset>
      <div style={{ ...muted, fontSize: 12, marginTop: 10 }}>LinkedIn and Facebook do not let apps search public posts, so they cannot be listened to.</div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="submit" style={primary} disabled={busy}>{busy ? "Searching…" : "Save and search"}</button>
        <button type="button" style={btn} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function ListeningPage({ showToast }) {
  const [over, setOver] = useState(null);
  const [mentions, setMentions] = useState([]);
  const [state, setState] = useState("loading");
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState("new");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState("");

  const loadTopics = useCallback(() => api.getListening().then(setOver).catch(() => setState("error")), []);
  const loadMentions = useCallback(() => {
    api.getMentions({ topic, status: status === "all" ? "" : status })
      .then((d) => { setMentions(d.mentions); setState("ok"); })
      .catch(() => setState("error"));
  }, [topic, status]);
  useEffect(() => { loadTopics(); }, [loadTopics]);
  useEffect(() => { loadMentions(); }, [loadMentions]);

  const mark = async (ids, s) => {
    try {
      await api.markMentions(ids, s);
      setMentions((ms) => (status === "all" ? ms.map((m) => (ids.includes(m.id) ? { ...m, status: s } : m)) : ms.filter((m) => !ids.includes(m.id))));
      loadTopics();
    } catch (e) {
      showToast(e.message || "Could not update.");
    }
  };
  const toLeads = async (m) => {
    setBusy(m.id);
    try {
      const res = await api.mentionsToLeads([m.id]);
      showToast(res.added ? `Added to the “${res.list.name}” list in Lead Gen.` : "Already a lead.");
      loadMentions();
    } catch (e) {
      showToast(e.message || "Could not add the lead.");
    } finally {
      setBusy("");
    }
  };
  const searchNow = async (t) => {
    setBusy("t" + t.id);
    try {
      const res = await api.checkListenTopic(t.id);
      showToast(res.found ? `Found ${res.found} new mention${res.found === 1 ? "" : "s"}.` : "Nothing new yet.");
      loadTopics();
      loadMentions();
    } catch (e) {
      showToast(e.message || "The search did not run.");
    } finally {
      setBusy("");
    }
  };
  const remove = async (t) => {
    if (!window.confirm(`Stop listening for “${t.name}” and delete what it found?`)) return;
    await api.deleteListenTopic(t.id).catch(() => {});
    if (topic === t.id) setTopic("");
    loadTopics();
    loadMentions();
  };

  const topics = (over && over.topics) || [];
  return (
    <div style={page}>
      <div style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "minmax(260px, 340px) minmax(0, 1fr)", gap: 16, alignItems: "start" }} className="listen-layout">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {editing ? (
            <TopicForm initial={editing} available={over && over.sources} showToast={showToast} onCancel={() => setEditing(null)}
              onSaved={(res) => { setEditing(null); loadTopics(); loadMentions(); if (res.found != null) showToast(res.found ? `Found ${res.found} mention${res.found === 1 ? "" : "s"}.` : "Saved. Nothing found yet; it keeps looking."); }} />
          ) : (
            <button type="button" style={{ ...primary, justifyContent: "center", height: 36 }} disabled={topics.length >= ((over && over.maxTopics) || 20)} onClick={() => setEditing({})}>
              <Plus size={14} /> Listen for something
            </button>
          )}
          {topics.map((t) => (
            <section key={t.id} style={{ ...card, padding: 12, borderColor: topic === t.id ? C.teal : C.border }} aria-label={t.name}>
              <button type="button" onClick={() => setTopic(topic === t.id ? "" : t.id)} aria-pressed={topic === t.id}
                style={{ border: "none", background: "none", padding: 0, textAlign: "left", width: "100%", cursor: "pointer", fontFamily: FONT_BODY }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5, flex: 1, minWidth: 0 }}>{t.name}</span>
                  {t.newCount ? <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: C.teal, borderRadius: 99, padding: "1px 7px" }}>{t.newCount} new</span> : null}
                </div>
                <div style={{ ...muted, fontSize: 12 }}>{t.keywords.join(", ")} · {t.sources.map((s) => NAME[s]).join(", ")}</div>
              </button>
              {Object.entries(t.errors || {}).map(([s, e]) => (
                <div key={s} style={{ display: "flex", gap: 6, fontSize: 11.5, color: C.amberInk || "#92400E", marginTop: 6 }}>
                  <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} /> {e}
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button type="button" style={{ ...btn, height: 28, fontSize: 11.5 }} disabled={busy === "t" + t.id} onClick={() => searchNow(t)}>
                  <RefreshCw size={12} /> {busy === "t" + t.id ? "Searching…" : "Search now"}
                </button>
                <button type="button" style={{ ...btn, height: 28, fontSize: 11.5 }} onClick={() => setEditing(t)}>Edit</button>
                <button type="button" style={{ ...btn, height: 28, fontSize: 11.5, color: "#B42318", borderColor: "#F3D1CD" }} onClick={() => remove(t)} aria-label={`Delete ${t.name}`}><Trash2 size={12} /></button>
              </div>
            </section>
          ))}
          {!topics.length && !editing ? (
            <div style={{ ...card, ...muted }}>
              Add your brand, products or competitors. New public posts that mention them appear here, and you can add the people behind them to Lead Gen.
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }} role="group" aria-label="Show">
            {[["new", "New"], ["all", "All"], ["ignored", "Ignored"]].map(([id, name]) => (
              <button key={id} type="button" aria-pressed={status === id} onClick={() => setStatus(id)}
                style={{ ...btn, background: status === id ? C.ink : "#fff", color: status === id ? "#fff" : C.ink, borderColor: status === id ? C.ink : C.border }}>{name}</button>
            ))}
            <div style={{ flex: 1 }} />
            {status === "new" && mentions.length ? (
              <button type="button" style={btn} onClick={() => mark(mentions.map((m) => m.id), "seen")}><Check size={13} /> Mark all as seen</button>
            ) : null}
          </div>
          {state === "loading" ? <div style={muted}>Loading…</div> : state === "error" ? (
            <div style={card}>Could not load mentions. <button type="button" style={btn} onClick={loadMentions}>Try again</button></div>
          ) : !mentions.length ? (
            <div style={{ ...card, textAlign: "center", padding: 32, borderStyle: "dashed" }}>
              <Search size={20} color={C.slate} />
              <div style={{ fontWeight: 700, marginTop: 8 }}>{status === "new" ? "Nothing new" : "Nothing here"}</div>
              <div style={{ ...muted, marginTop: 4 }}>{topics.length ? "New mentions appear here as they are found." : "Add a topic to start listening."}</div>
            </div>
          ) : mentions.map((m) => (
            <article key={m.id} style={{ ...card, padding: 14 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 8px", alignItems: "baseline", fontSize: 12 }}>
                <b style={{ color: C.ink }}>{NAME[m.source] || m.source}</b>
                {m.where ? <span style={{ color: C.slate }}>{m.where}</span> : null}
                {m.author ? (m.authorUrl ? <a href={m.authorUrl} target="_blank" rel="noreferrer" className="ui-link">{m.author}</a> : <span>{m.author}</span>) : null}
                <span style={{ color: C.slate }}>{ago(m.postedAt || m.foundAt)}</span>
                {m.score != null ? <span style={{ color: C.slate }}>{m.score.toLocaleString()} {m.source === "reddit" ? "points" : "likes"}</span> : null}
              </div>
              {m.title ? <div style={{ fontWeight: 700, fontSize: 14, marginTop: 4 }}>{m.title}</div> : null}
              {m.text ? <div style={{ fontSize: 13, color: C.textInk || C.ink, marginTop: 4, whiteSpace: "pre-wrap", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" }}>{m.text}</div> : null}
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                {m.url ? <a href={m.url} target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: "none" }}>Open on {NAME[m.source] || "the network"}</a> : null}
                {m.status === "new" ? <button type="button" style={btn} onClick={() => mark([m.id], "seen")}><Check size={13} /> Seen</button> : null}
                {m.status !== "ignored" ? <button type="button" style={btn} onClick={() => mark([m.id], "ignored")}><EyeOff size={13} /> Ignore</button>
                  : <button type="button" style={btn} onClick={() => mark([m.id], "new")}>Restore</button>}
                {m.author ? (
                  <button type="button" style={btn} disabled={!!m.leadId || busy === m.id} onClick={() => toLeads(m)}>
                    <UserPlus size={13} /> {m.leadId ? "In Lead Gen" : busy === m.id ? "Adding…" : "Add to leads"}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>
      <style>{"@media (max-width: 820px) { .listen-layout { grid-template-columns: 1fr !important; } }"}</style>
    </div>
  );
}
