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
    <div style={{ flex: 1, overflowY: "auto", background: C.bg }}>
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

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {filtered.map((log) => {
            const isExpanded = expandedId === log.id;
            return (
              <div
                key={log.id}
                style={{
                  background: "rgba(18, 22, 41, 0.75)",
                  backdropFilter: "blur(16px)",
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
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${C.borderLight}` }}>
                      {log.channel === "voice" ? <PhoneCall size={18} color={C.cobaltDeep} /> : <MessageCircle size={18} color={C.teal} />}
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 15, color: "#FFFFFF" }}>
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
                      <div style={{ background: "rgba(75,115,255,0.1)", border: "1px solid rgba(75,115,255,0.25)", padding: "10px 14px", borderRadius: 10, marginBottom: 14, fontSize: 12.5, color: "#93C5FD" }}>
                        <b>Requested Follow-Up:</b> {log.requestedFollowUp.day} at {log.requestedFollowUp.time} — “{log.requestedFollowUp.exactWords}”
                      </div>
                    )}
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, color: "#CBD5E1", marginBottom: 8 }}>
                      Verbatim Call Transcript
                    </div>
                    <div style={{ background: "rgba(9, 11, 19, 0.7)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8, border: `1px solid ${C.borderLight}` }}>
                      {(log.transcript || []).map((t, idx) => (
                        <div key={idx} style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                          <b style={{ color: t.who === "ai" ? C.cobaltDeep : "#FFFFFF" }}>{t.who === "ai" ? "AI (Sam): " : "Prospect: "}</b>
                          <span style={{ color: "#CBD5E1" }}>{t.text}</span>
                        </div>
                      ))}
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
