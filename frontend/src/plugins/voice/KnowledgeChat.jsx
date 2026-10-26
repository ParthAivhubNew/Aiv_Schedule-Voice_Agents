import { useEffect, useRef, useState } from "react";
import { ArrowUp, History, Plus, Sparkles, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { C, FONT_BODY } from "../../app/constants";
import { SectionIntro } from "../../app/ui";

const LS_CHAT = "aivhub_knowledge_chat_v1";
const LS_THREADS = "aivhub_knowledge_threads_v1";
const MAX_THREADS = 30;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

const WELCOME = {
  id: "kc0",
  who: "ai",
  text: "Ask what a prospect might ask. I show the exact passages from your sources that the AI would use on a call.",
};

// Test what the AI finds in the knowledge sources. Chats are kept on this device, like the other AI chats.
export function KnowledgeChat() {
  const [chat, setChat] = useState(() => {
    const saved = read(LS_CHAT, null);
    return Array.isArray(saved) && saved.length ? saved : [WELCOME];
  });
  const [threads, setThreads] = useState(() => read(LS_THREADS, []) || []);
  const [histOpen, setHistOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef(null);

  useEffect(() => { write(LS_CHAT, chat); }, [chat]);
  useEffect(() => { write(LS_THREADS, threads); }, [threads]);
  useEffect(() => { if (end.current) end.current.scrollIntoView({ block: "end" }); }, [chat, busy, histOpen]);

  const asked = chat.some((m) => m.who === "user");

  const archive = () => {
    if (!asked) return;
    const first = chat.find((m) => m.who === "user");
    const title = String(first?.text || "Chat").slice(0, 60);
    setThreads((ts) => [{ id: "kt_" + Date.now(), title, messages: chat }, ...ts].slice(0, MAX_THREADS));
  };

  const newChat = () => {
    archive();
    setChat([WELCOME]);
    setHistOpen(false);
  };

  const send = async (e) => {
    if (e) e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const stamp = Date.now();
    setChat((c) => [...c, { id: "ku_" + stamp, who: "user", text }]);
    setInput("");
    setBusy(true);
    let reply;
    try {
      const res = await api.testKnowledgeQuery(text);
      const matches = Array.isArray(res?.matches) ? res.matches : [];
      reply = {
        id: "ka_" + stamp, who: "ai", matches,
        text: matches.length
          ? `Found ${matches.length} passage${matches.length === 1 ? "" : "s"} the AI would use for that.`
          : "Nothing in your sources matches that well enough. Add a source or re-crawl your website, or write an approved answer below.",
      };
    } catch (err) {
      reply = { id: "ka_" + stamp, who: "ai", text: err?.message || "The search failed. Try again.", error: true };
    }
    setChat((c) => [...c, reply]);
    setBusy(false);
  };

  return (
    <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <SectionIntro icon={Sparkles} title="Ask your knowledge" desc="Try a question a prospect might ask and see what the AI finds in your sources." />
        </div>
        <button type="button" className="ui-icon-btn" title="Past chats" aria-label="Past chats" onClick={() => setHistOpen((o) => !o)}><History size={16} /></button>
        <button type="button" className="ui-icon-btn" title="New chat" aria-label="New chat" onClick={newChat}><Plus size={16} /></button>
      </div>

      {histOpen ? (
        <div style={{ height: 380, overflowY: "auto", marginTop: 10 }}>
          {!threads.length ? <div style={{ fontSize: 13, color: C.slateLight }}>No saved chats yet.</div> : threads.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 2, marginBottom: 2 }}>
              <button type="button" className="ui-menu-item" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                onClick={() => { archive(); setChat(t.messages); setThreads((ts) => ts.filter((x) => x.id !== t.id)); setHistOpen(false); }}>{t.title}</button>
              <button type="button" className="ui-icon-btn ui-icon-btn--sm" title="Delete chat" aria-label="Delete chat" onClick={() => setThreads((ts) => ts.filter((x) => x.id !== t.id))}><X size={15} /></button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ height: 380, overflowY: "auto", marginTop: 10, paddingRight: 4 }} aria-live="polite">
          {chat.map((m) => {
            const mine = m.who === "user";
            return (
              <div key={m.id} style={{ marginBottom: 12, display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "92%", padding: "9px 12px", borderRadius: 14, fontFamily: FONT_BODY, fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap",
                  background: mine ? C.ink : "#fff", color: mine ? "#fff" : (m.error ? C.red : C.textInk), border: mine ? "none" : `1px solid ${C.border}`,
                }}>{m.text}</div>
                {(m.matches || []).map((x, i) => (
                  <div key={x.id || i} style={{ maxWidth: "92%", marginTop: 6, background: C.paper, borderRadius: 10, padding: 10, border: `1px solid ${C.borderLight}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
                      <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.textInk }}>{x.title || "From your sources"}</span>
                      <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: "#15803d", background: "#dcfce7", padding: "1px 6px", borderRadius: 4, flexShrink: 0 }}>{Math.round((x.score || 0) * 100)}% match</span>
                    </div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.textInk, lineHeight: 1.4, whiteSpace: "pre-wrap" }}>{x.content}</div>
                  </div>
                ))}
              </div>
            );
          })}
          {busy ? <div style={{ fontSize: 12.5, color: C.slate }}>Searching your sources…</div> : null}
          <div ref={end} />
        </div>
      )}

      <form onSubmit={send} style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", border: `1px solid ${C.border}`, borderRadius: 12, padding: "6px 6px 6px 12px", background: "#fff" }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} aria-label="Ask your knowledge"
          placeholder="e.g. What is your pricing? Do you integrate with a CRM?"
          style={{ flex: 1, minWidth: 0, height: 30, border: 0, outline: 0, background: "transparent", fontFamily: FONT_BODY, fontSize: 13, color: C.textInk }} />
        <button type="submit" className="ui-btn ui-btn--primary" title="Send" disabled={busy || !input.trim()} style={{ width: 30, height: 30, padding: 0 }}><ArrowUp size={16} /></button>
      </form>
    </div>
  );
}
