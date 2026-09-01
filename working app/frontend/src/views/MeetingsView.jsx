import React, { useState } from "react";
import { CalendarCheck, Video, Phone, MapPin, Check, ExternalLink, ChevronRight, X, Sparkles, MessageSquare } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { TopBar } from "../components/TopBar";
import { Badge, FitScore } from "../components/Badges";

export function MeetingDetailModal({ meeting, onClose, onOutcome, onSaveTranscript, companyName }) {
  const [outcomeStatus, setOutcomeStatus] = useState(meeting.status || "converted");
  const [outcomeNote, setOutcomeNote] = useState(meeting.outcome || "");

  if (!meeting) return null;

  const handleSaveOutcome = () => {
    onOutcome(meeting.id, outcomeStatus, outcomeNote);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(9,11,19,0.75)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 700, maxHeight: "90vh", background: "rgba(18,22,41,0.96)", borderRadius: 22, border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 28px 70px rgba(0,0,0,0.7)" }}>
        <div style={{ padding: "22px 26px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 19, color: "#FFFFFF" }}>
              {companyName || "AIVHub"} × {meeting.prospect}
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 2 }}>
              {meeting.date} at {meeting.time} ({meeting.duration}) · Synced via Cal.com
            </div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: C.slate }}><X size={18} /></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 26, display: "flex", flexDirection: "column", gap: 22 }}>
          {/* Format info */}
          <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 14, padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between", border: `1px solid ${C.borderLight}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {meeting.format === "video" && <Video size={18} color={C.cobaltDeep} />}
              {meeting.format === "phone" && <Phone size={18} color={C.cobaltDeep} />}
              {meeting.format === "in_person" && <MapPin size={18} color={C.cobaltDeep} />}
              <span style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: "#FFFFFF" }}>
                {meeting.format === "video" ? `${meeting.platform || "Video Call"}: ${meeting.videoLink || "meet.google.com/aiv-demo"}` : meeting.format === "phone" ? `Dial-in: ${meeting.dialIn || "+44 20 7946 0912"}` : meeting.address || "14 Colmore Row, Birmingham"}
              </span>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.teal, background: C.tealSoft, padding: "3px 9px", borderRadius: 5, border: `1px solid rgba(0,229,195,0.3)` }}>
              CONFIRMED
            </span>
          </div>

          {/* AI Pre-Call Prep Notes */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, color: "#FFFFFF", marginBottom: 8 }}>
              <Sparkles size={14} color={C.radiantPurple} /> AI Pre-Call Briefing Notes
            </div>
            <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${C.borderLight}`, borderRadius: 12, padding: 16, fontFamily: FONT_BODY, fontSize: 13, color: "#CBD5E1", lineHeight: 1.5 }}>
              {meeting.prep || "James showed strong interest in real-time dispatch dashboards on the call. Current pain point: manual Excel reporting takes ~2 days/week."}
            </div>
          </div>

          {/* Transcript that led to booking */}
          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, color: "#FFFFFF", marginBottom: 8 }}>
              Outreach Call Transcript
            </div>
            <div style={{ background: "rgba(9,11,19,0.7)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8, maxHeight: 180, overflowY: "auto", border: `1px solid ${C.borderLight}` }}>
              {(meeting.callTranscript || []).map((line, idx) => (
                <div key={idx} style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                  <b style={{ color: line.who === "ai" ? C.cobaltDeep : "#FFFFFF" }}>{line.who === "ai" ? "AI (Sam): " : "Prospect: "}</b>
                  <span style={{ color: "#CBD5E1" }}>{line.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Post-Meeting Outcome Logger */}
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 18 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, color: "#FFFFFF", marginBottom: 10 }}>
              Log Meeting Outcome
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {["converted", "needs_outcome", "not_fit"].map((st) => (
                <button
                  key={st}
                  onClick={() => setOutcomeStatus(st)}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 8,
                    border: `1px solid ${outcomeStatus === st ? C.cobaltDeep : C.border}`,
                    background: outcomeStatus === st ? C.cobaltSoft : "rgba(255,255,255,0.03)",
                    color: outcomeStatus === st ? "#fff" : C.slate,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    textTransform: "capitalize",
                  }}
                >
                  {st.replace("_", " ")}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={outcomeNote}
              onChange={(e) => setOutcomeNote(e.target.value)}
              placeholder="e.g. Converted — proposal sent for 50 vehicles"
              style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: 10, fontSize: 13 }}
            />
            <button
              onClick={handleSaveOutcome}
              style={{ marginTop: 12, padding: "9px 18px", borderRadius: 9, border: "none", background: C.teal, color: "#090B13", fontWeight: 700, fontSize: 13, cursor: "pointer", boxShadow: C.glowTeal }}
            >
              Save Outcome
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MeetingsView({ notifications, setNotifications, companyName, meetings = [], onOutcome, onSaveMeetingTranscript }) {
  const [selectedMeeting, setSelectedMeeting] = useState(null);

  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.bg }}>
      <TopBar
        title="Meetings"
        subtitle="Discovery calls & demos booked by the AI SDR with automated prep briefings."
        notifications={notifications}
        setNotifications={setNotifications}
      />

      <div style={{ padding: 32 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 22 }}>
          {meetings.map((m) => (
            <div
              key={m.id}
              onClick={() => setSelectedMeeting(m)}
              style={{
                background: "rgba(18, 22, 41, 0.75)",
                backdropFilter: "blur(16px)",
                borderRadius: 20,
                border: `1px solid ${C.border}`,
                padding: 24,
                cursor: "pointer",
                boxShadow: C.shadowCard,
                transition: "transform 0.15s, box-shadow 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: "#FFFFFF" }}>
                    {m.prospect}
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginTop: 2 }}>
                    {m.attendee || "Operations Contact"}
                  </div>
                </div>
                <Badge status={m.status} />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, padding: "12px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 12, border: `1px solid ${C.borderLight}` }}>
                <CalendarCheck size={18} color={C.cobaltDeep} />
                <div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: "#FFFFFF" }}>
                    {m.date} at {m.time}
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate }}>
                    Duration: {m.duration} · {m.platform || "Google Meet"}
                  </div>
                </div>
              </div>

              {m.outcome && (
                <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.teal, marginTop: 14, fontWeight: 600 }}>
                  ✓ {m.outcome}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.borderLight}` }}>
                <FitScore value={m.fit || 90} />
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.cobaltDeep }}>
                  Prep briefing <ChevronRight size={14} />
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedMeeting && (
        <MeetingDetailModal
          meeting={selectedMeeting}
          companyName={companyName}
          onClose={() => setSelectedMeeting(null)}
          onOutcome={(id, st, out) => {
            if (onOutcome) onOutcome(id, st, out);
            setSelectedMeeting(null);
          }}
          onSaveTranscript={onSaveMeetingTranscript}
        />
      )}
    </div>
  );
}
