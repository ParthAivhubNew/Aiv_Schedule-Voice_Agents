import React, { useState } from "react";
import { History, Lock, Search, Filter, PhoneCall, MessageCircle, ChevronDown, ChevronRight, Building2, Calendar } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { TopBar } from "../components/TopBar";
import { Badge } from "../components/Badges";

export function CallLogView({ notifications, setNotifications, entries = [] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);

  const filtered = entries.filter((e) => {
    if (query && !e.canonicalName.toLowerCase().includes(query.toLowerCase())) return false;
    if (filter !== "all" && e.outcome !== filter) return false;
    return true;
  });

  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.paper }}>
      <TopBar
        title="Call Log"
        subtitle="Append-only immutable record of all calls with verbatim quotes and locked transcripts."
        notifications={notifications}
        setNotifications={setNotifications}
      />

      <div style={{ padding: 32 }}>
        <div style={{ display: "flex", gap: 14, marginBottom: 22 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search size={16} color={C.slate} style={{ position: "absolute", left: 14, top: 12 }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search companies or transcripts..."
              style={{ width: "100%", height: 40, paddingLeft: 40, borderRadius: 10, fontFamily: FONT_BODY, fontSize: 13 }}
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ height: 40, padding: "0 14px", borderRadius: 10, fontFamily: FONT_BODY, fontSize: 13 }}
          >
            <option value="all">All Outcomes</option>
            <option value="meeting_booked">Meeting Booked</option>
            <option value="callback_requested">Callback Requested</option>
            <option value="rejected">Rejected / DNC</option>
            <option value="no_answer">No Answer</option>
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((log) => {
            const isExpanded = expandedId === log.id;
            return (
              <div
                key={log.id}
                style={{
                  background: "#FFFFFF",
                  borderRadius: 16,
                  border: `1px solid ${C.border}`,
                  padding: 20,
                  boxShadow: C.shadowCard,
                }}
              >
                <div
                  onClick={() => setExpandedId(isExpanded ? null : log.id)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: C.paperSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {log.channel === "voice" ? <PhoneCall size={18} color={C.cobalt} /> : <MessageCircle size={18} color={C.teal} />}
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, color: C.ink }}>
                          {log.canonicalName}
                        </span>
                        {log.wordsLocked && <Lock size={12} color={C.slateLight} title="Transcript verbatim and locked" />}
                      </div>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 2 }}>
                        {log.startedAt} · Duration: {log.duration} · {log.mission}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Badge status={log.outcome} />
                    {isExpanded ? <ChevronDown size={18} color={C.slate} /> : <ChevronRight size={18} color={C.slate} />}
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${C.borderLight}` }}>
                    {log.requestedFollowUp && (
                      <div style={{ background: C.cobaltSoft, border: `1px solid #C7D7FA`, padding: "10px 14px", borderRadius: 10, marginBottom: 14, fontSize: 12.5, color: C.cobaltDeep }}>
                        <b>Requested Follow-Up:</b> {log.requestedFollowUp.day} at {log.requestedFollowUp.time} — “{log.requestedFollowUp.exactWords}”
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, color: C.ink, display: "flex", alignItems: "center", gap: 6 }}>
                        <span>Verbatim Call Transcript</span>
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: C.teal, background: C.tealSoft, padding: "2px 8px", borderRadius: 12 }}>Locked</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const fullText = (log.transcript || [])
                            .map((t) => `${t.who === "ai" ? "AI (Sam)" : t.who === "system" ? "System" : "Prospect"}: ${t.text}`)
                            .join("\n");
                          navigator.clipboard.writeText(fullText);
                          if (setNotifications) {
                            setNotifications((ns) => [
                              { id: "n_" + Date.now(), text: `📋 Transcript copied to clipboard for ${log.canonicalName}`, time: "just now", unread: true, type: "info" },
                              ...ns
                            ]);
                          }
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          background: "#FFFFFF",
                          border: `1px solid ${C.border}`,
                          borderRadius: 7,
                          padding: "5px 10px",
                          fontFamily: FONT_BODY,
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: C.slate,
                          cursor: "pointer"
                        }}
                      >
                        📋 Copy Transcript
                      </button>
                    </div>

                    <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 10 }}>
                      {(log.transcript || []).map((t, idx) => {
                        const isAi = t.who === "ai";
                        const isSystem = t.who === "system";
                        if (isSystem) {
                          return (
                            <div key={idx} style={{ textAlign: "center", margin: "4px 0" }}>
                              <span style={{ fontFamily: FONT_BODY, fontSize: 11, background: "#F1F5F9", color: "#475569", padding: "4px 12px", borderRadius: 12, border: "1px solid #E2E8F0" }}>
                                ℹ️ {t.text}
                              </span>
                            </div>
                          );
                        }
                        return (
                          <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: isAi ? "flex-start" : "flex-end" }}>
                            <div style={{ fontSize: 10.5, fontWeight: 700, color: isAi ? C.cobalt : C.slate, marginBottom: 3, padding: "0 4px" }}>
                              {isAi ? "🤖 Sam (AI Voice SDR)" : `👤 ${log.canonicalName || "Prospect"}`}
                            </div>
                            <div
                              style={{
                                maxWidth: "85%",
                                background: isAi ? "#F0F7FF" : "#FFFFFF",
                                border: `1px solid ${isAi ? "#BFDBFE" : "#E2E8F0"}`,
                                borderRadius: isAi ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
                                padding: "10px 14px",
                                fontFamily: FONT_BODY,
                                fontSize: 13,
                                lineHeight: 1.45,
                                color: isAi ? "#1E293B" : C.textInk,
                                boxShadow: "0 1px 3px rgba(0,0,0,0.03)"
                              }}
                            >
                              {t.text}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
