import React, { useEffect, useState } from "react";
import { Search, Sparkles, Send, Users, Plus, ArrowUp } from "lucide-react";
import { C, FONT_BODY } from "../../tokens";
import { api } from "../../api/apiClient";

// AI Lead Copilot: open chat about target companies, ideal customers, markets and outreach.
// Extracted out of the shell (LeadGenerationPlugin.jsx) so it's a self-contained view like every
// other screen in this plugin, now mounted under the Find Leads tab (see FindLeadsView.jsx).
export function CopilotView({ store }) {
  const [copilotChatMessages, setCopilotChatMessages] = useState([
    {
      id: "m_init",
      role: "assistant",
      text: "I can find target companies on the web, sharpen your ideal customer profile, research a market or draft outreach. What are you working on?",
      time: "Just now",
      leads: []
    }
  ]);
  const [copilotInput, setCopilotInput] = useState("");
  const [isCopilotTyping, setIsCopilotTyping] = useState(false);
  const copilotScrollRef = React.useRef(null);
  useEffect(() => {
    if (copilotScrollRef.current) copilotScrollRef.current.scrollIntoView({ block: "nearest" });
  }, [copilotChatMessages.length, isCopilotTyping]);

  const handleSendCopilotChat = async (e, customText) => {
    if (e) e.preventDefault();
    const query = (customText || copilotInput).trim();
    if (!query || isCopilotTyping) return;

    setCopilotInput("");
    const userMsg = {
      id: "m_" + Date.now(),
      role: "user",
      text: query,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };
    setCopilotChatMessages((prev) => [...prev, userMsg]);
    setIsCopilotTyping(true);

    try {
      const res = await api.copilotChat({
        message: query,
        history: copilotChatMessages.map((m) => ({ role: m.role, content: m.text })),
        plugin: "leadgen"
      });

      const aiMsg = {
        id: "m_" + (Date.now() + 1),
        role: "assistant",
        text: res?.reply || "I processed your request. How else can I help?",
        leads: res?.leads || [],
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        model: res?.model
      };
      setCopilotChatMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      setCopilotChatMessages((prev) => [
        ...prev,
        {
          id: "m_" + (Date.now() + 1),
          role: "assistant",
          text: /credits/i.test(err.message || "") ? err.message : `Couldn't reach the AI: ${err.message || "no answer from the AI service."} Try again in a moment.`,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        }
      ]);
    } finally {
      setIsCopilotTyping(false);
      setTimeout(() => {
        if (copilotScrollRef.current) {
          copilotScrollRef.current.scrollIntoView({ behavior: "smooth" });
        }
      }, 100);
    }
  };

  // Saves a company the Copilot found, with only what the web search returned.
  const handleAddCopilotLead = (lead) => {
    store.save([{ name: lead.name || lead.companyName || "", website: lead.site || lead.website || "", phone: lead.phone || "",
      notes: lead.snippet || "", source: "copilot", source_url: lead.sourceUrl || "" }]);
  };

  return (
    <div className="ui-card" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 220px)", minHeight: 440, overflow: "hidden" }}>
      <div className="ui-scroll" style={{ flex: 1, overflowY: "auto", padding: "20px 20px 8px", display: "flex", flexDirection: "column", gap: 16 }}>
        {copilotChatMessages.map((m) => (m.role === "user" ? (
          <div key={m.id} style={{ alignSelf: "flex-end", maxWidth: "80%", background: "var(--ui-accent-soft)", color: "var(--ui-accent-ink)", padding: "9px 13px", borderRadius: 8, fontFamily: FONT_BODY, fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {m.text}
          </div>
        ) : (
          <div key={m.id} style={{ display: "flex", gap: 10, maxWidth: "88%" }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: "#8B5CF614", color: "#8B5CF6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Sparkles size={15} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, lineHeight: 1.6, color: C.textInk, whiteSpace: "pre-wrap", overflowWrap: "anywhere", paddingTop: 4 }}>{m.text}</div>
              {m.leads && m.leads.length ? (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  {m.leads.map((l, i) => (
                    <div key={l.id || i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 6, background: "#fff" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, color: C.ink }}>{l.name || l.companyName}</div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {[l.site || l.website || l.domain, l.phone].filter(Boolean).join(" · ") || "No website or phone found"}
                        </div>
                      </div>
                      <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => handleAddCopilotLead(l)}>
                        <Plus size={14} /> Save
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )))}
        {copilotChatMessages.length <= 1 && !isCopilotTyping ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, paddingLeft: 38 }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight }}>Try</span>
            {[
              [Search, "Find 20 logistics companies in Manchester"],
              [Users, "Who should I target with an AI phone receptionist?"],
              [Send, "Write a short cold email to a dental practice"],
            ].map(([Icon, text]) => (
              <button key={text} type="button" className="ui-chip" onClick={() => handleSendCopilotChat(null, text)}>
                <Icon size={14} color={C.slate} /> {text}
              </button>
            ))}
          </div>
        ) : null}
        {isCopilotTyping ? <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, paddingLeft: 38 }}>Thinking…</div> : null}
        <div ref={copilotScrollRef} />
      </div>
      <form onSubmit={handleSendCopilotChat} style={{ padding: 12, borderTop: `1px solid ${C.border}` }}>
        <div className="ui-field" style={{ display: "flex", alignItems: "flex-end", gap: 8, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 6px 6px 12px", background: "#fff" }}>
          <textarea
            value={copilotInput}
            onChange={(e) => setCopilotInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendCopilotChat();
              }
            }}
            rows={2}
            placeholder="Ask about target companies, your ideal customer or outreach"
            aria-label="Message the Copilot"
            style={{ flex: 1, minWidth: 0, border: 0, outline: 0, resize: "none", fontFamily: FONT_BODY, fontSize: 13.5, lineHeight: 1.5, padding: "4px 0", background: "transparent", color: C.textInk }}
          />
          <button type="submit" className="ui-btn ui-btn--primary" title="Send" disabled={!copilotInput.trim() || isCopilotTyping} style={{ width: 34, height: 34, padding: 0 }}>
            <ArrowUp size={16} />
          </button>
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight, marginTop: 8 }}>
          Enter to send, Shift + Enter for a new line. Company searches use public web results.
        </div>
      </form>
    </div>
  );
}
