import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Check, CheckCheck, Clock, Loader2, MessageCircle, Plus, Send, User, AlertTriangle } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../../../tokens";
import { api } from "../../../api/apiClient";

const WA = "#1FA855";
const input = { boxSizing: "border-box", padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13.5, fontFamily: FONT_BODY, background: "#fff" };
const btn = (primary, disabled) => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer",
  border: primary ? "none" : `1px solid ${C.border}`, background: primary ? C.ink : "#fff", color: primary ? "#fff" : C.textInk,
  fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, opacity: disabled ? 0.55 : 1,
});

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso + (iso.endsWith("Z") ? "" : "Z"));
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function Tick({ status }) {
  if (status === "read") return <CheckCheck size={13} color="#34B7F1" />;
  if (status === "delivered") return <CheckCheck size={13} />;
  if (status === "sent") return <Check size={13} />;
  if (status === "failed") return <AlertTriangle size={13} color={C.red} />;
  return <Clock size={12} />;
}

function TemplateForm({ onSend, busy }) {
  const [name, setName] = useState("");
  const [params, setParams] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input aria-label="Template name" placeholder="Approved template name" value={name} onChange={(e) => setName(e.target.value)} style={{ ...input, flex: "1 1 160px" }} />
      <input aria-label="Template values" placeholder="Values, comma separated" value={params} onChange={(e) => setParams(e.target.value)} style={{ ...input, flex: "1 1 160px" }} />
      <button type="button" style={btn(true, !name || busy)} disabled={!name || busy}
        onClick={() => onSend({ name: name.trim(), params: params.split(",").map((p) => p.trim()).filter(Boolean) })}>
        <Send size={13} /> Send template
      </button>
    </div>
  );
}

export function WhatsappInbox() {
  const [status, setStatus] = useState(null);
  const [threads, setThreads] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [conv, setConv] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [newForm, setNewForm] = useState({ ourNumber: "", contactNumber: "", contactName: "" });
  const endRef = useRef(null);

  const loadThreads = useCallback(async () => {
    try {
      setThreads(await api.getWaThreads());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const loadConv = useCallback(async (id) => {
    if (!id) return;
    try {
      setConv(await api.getWaThread(id));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    api.getWaStatus().then(setStatus).catch(() => setStatus({ numbers: [] }));
    loadThreads();
    const t = setInterval(() => {
      loadThreads();
      if (activeId) loadConv(activeId);
    }, 8000);
    return () => clearInterval(t);
  }, [loadThreads, loadConv, activeId]);

  useEffect(() => {
    loadConv(activeId);
  }, [activeId, loadConv]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [conv?.messages?.length]);

  const waNumbers = (status?.numbers || []).filter((n) => n.whatsapp);

  const send = async (payload) => {
    setBusy(true);
    setError("");
    try {
      await api.sendWa(activeId, payload);
      setText("");
      await loadConv(activeId);
      loadThreads();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const start = async (template) => {
    setBusy(true);
    setError("");
    try {
      const t = await api.startWaThread({ ...newForm, ourNumber: newForm.ourNumber || waNumbers[0]?.e164, template });
      setStarting(false);
      setNewForm({ ourNumber: "", contactNumber: "", contactName: "" });
      await loadThreads();
      setActiveId(t.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (status && waNumbers.length === 0 && threads.length === 0) {
    return (
      <div style={{ maxWidth: 640, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, fontFamily: FONT_BODY }}>
        <MessageCircle size={28} color={WA} />
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, margin: "10px 0 6px" }}>WhatsApp on your own number</div>
        <p style={{ fontSize: 13.5, color: C.slate, lineHeight: 1.6, margin: 0 }}>
          Message customers on WhatsApp from the same number you call them from.
          Go to <b>Subscription &rarr; Numbers</b> and press <b>Turn on WhatsApp</b> next to your number. The first time, we complete Meta's business check with you; after that you can switch it off and on yourself.
        </p>
        {(status.numbers || []).some((n) => n.requested) && (
          <p style={{ fontSize: 13, color: "#7A5200", background: "#FFF3D6", padding: "8px 12px", borderRadius: 10, marginTop: 14 }}>
            WhatsApp is being set up for your number. This page opens once it is live.
          </p>
        )}
      </div>
    );
  }

  const t = conv?.thread;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 320px) minmax(0, 1fr)", height: "calc(100vh - 150px)", minHeight: 480, border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden", background: "#fff", fontFamily: FONT_BODY }}>
      <div style={{ borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 14px 10px" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", gap: 6 }}><MessageCircle size={17} color={WA} /> WhatsApp</div>
          <button type="button" style={btn(false)} onClick={() => { setStarting(true); setActiveId(""); setConv(null); }} disabled={waNumbers.length === 0}><Plus size={13} /> New</button>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {threads.length === 0 && <div style={{ padding: 14, fontSize: 13, color: C.slate }}>No conversations yet. They appear here when customers message you.</div>}
          {threads.map((th) => (
            <button key={th.id} type="button" onClick={() => { setStarting(false); setActiveId(th.id); }}
              style={{ width: "100%", textAlign: "left", border: "none", borderTop: `1px solid ${C.border}`, background: th.id === activeId ? C.cobaltSoft : "#fff", padding: "10px 14px", cursor: "pointer", display: "grid", gap: 2 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 13.5, color: C.textInk, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{th.contactName || th.contactNumber}</span>
                <span style={{ fontSize: 11, color: C.slateLight, flexShrink: 0 }}>{when(th.lastMessageAt)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12.5, color: C.slate, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{th.preview}</span>
                {th.unread > 0 && <span style={{ background: WA, color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 99, padding: "1px 7px" }}>{th.unread}</span>}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "#F7F5F0" }}>
        {starting ? (
          <div style={{ padding: 20, display: "grid", gap: 10, maxWidth: 560 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16 }}>New conversation</div>
            <p style={{ fontSize: 13, color: C.slate, margin: 0 }}>WhatsApp only lets businesses start a conversation with an approved template.</p>
            {waNumbers.length > 1 && (
              <select aria-label="From number" value={newForm.ourNumber} onChange={(e) => setNewForm({ ...newForm, ourNumber: e.target.value })} style={input}>
                {waNumbers.map((n) => <option key={n.id} value={n.e164}>{n.e164}</option>)}
              </select>
            )}
            <input aria-label="Contact number" placeholder="Contact number, e.g. +447700900123" value={newForm.contactNumber} onChange={(e) => setNewForm({ ...newForm, contactNumber: e.target.value })} style={input} />
            <input aria-label="Contact name" placeholder="Name (optional)" value={newForm.contactName} onChange={(e) => setNewForm({ ...newForm, contactName: e.target.value })} style={input} />
            <TemplateForm onSend={start} busy={busy} />
            {error && <div role="alert" style={{ fontSize: 13, color: C.red }}>{error}</div>}
          </div>
        ) : !t ? (
          <div style={{ margin: "auto", color: C.slate, fontSize: 13.5, textAlign: "center" }}>
            <MessageCircle size={30} color={C.slateLight} /><br />Choose a conversation
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: "#fff", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ width: 34, height: 34, borderRadius: "50%", background: C.tealSoft, display: "flex", alignItems: "center", justifyContent: "center" }}><User size={16} color={C.teal} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{t.contactName || t.contactNumber}</div>
                <div style={{ fontSize: 12, color: C.slate, fontFamily: FONT_MONO }}>{t.contactNumber} → {t.ourNumber}</div>
              </div>
<span title="Outreach never answers WhatsApp for you; you are emailed when a conversation has something new." style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: C.slate }}>
                <Bot size={14} /> Auto-replies off
              </span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 6 }}>
              {conv.messages.map((m) => {
                const out = m.direction === "outbound";
                return (
                  <div key={m.id} style={{ alignSelf: out ? "flex-end" : "flex-start", maxWidth: "72%" }}>
                    <div style={{ background: out ? (m.sender === "ai" ? "#E3ECFF" : "#D9FDD3") : "#fff", borderRadius: 12, borderTopRightRadius: out ? 4 : 12, borderTopLeftRadius: out ? 12 : 4, padding: "7px 10px", fontSize: 13.5, color: C.textInk, boxShadow: "0 1px 1px rgba(0,0,0,.06)", whiteSpace: "pre-wrap" }}>
                      {m.kind === "template" && <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 2 }}>TEMPLATE</div>}
                      {m.text}
                      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, fontSize: 10.5, color: C.slate, marginTop: 3 }}>
                        {out && (m.sender === "ai" ? "AI · " : m.senderName ? `${m.senderName} · ` : "")}
                        {when(m.at)} {out && <Tick status={m.status} />}
                      </div>
                    </div>
                    {m.status === "failed" && m.error && <div style={{ fontSize: 11.5, color: C.red, marginTop: 2, textAlign: "right" }}>{m.error}</div>}
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
            <div style={{ padding: 12, background: "#fff", borderTop: `1px solid ${C.border}` }}>
              {error && <div role="alert" style={{ fontSize: 12.5, color: C.red, marginBottom: 8 }}>{error}</div>}
              {t.windowOpen ? (
                <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) send({ text }); }} style={{ display: "flex", gap: 8 }}>
                  <input aria-label="Message" placeholder="Type a message" value={text} onChange={(e) => setText(e.target.value)} style={{ ...input, flex: 1 }} />
                  <button type="submit" style={{ ...btn(true, busy || !text.trim()), background: WA }} disabled={busy || !text.trim()}>
                    {busy ? <Loader2 size={14} /> : <Send size={14} />} Send
                  </button>
                </form>
              ) : (
                <>
                  <div style={{ fontSize: 12.5, color: "#7A5200", marginBottom: 8 }}>More than 24 hours since they last wrote: WhatsApp only allows an approved template now.</div>
                  <TemplateForm onSend={(template) => send({ template })} busy={busy} />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
