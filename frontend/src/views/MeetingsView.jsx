import React, { useState } from "react";
import { CalendarCheck, Video, Phone, MapPin, Check, ExternalLink, ChevronRight, X, Sparkles, MessageSquare } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { TopBar } from "../components/TopBar";
import { Badge, FitScore } from "../components/Badges";

export function MeetingDetailModal({ meeting, onClose, onOutcome, companyName }) {
  const [outcomeStatus, setOutcomeStatus] = useState(meeting.status || "converted");
  const [outcomeNote, setOutcomeNote] = useState(meeting.outcome || "");

  if (!meeting) return null;

  const handleSaveOutcome = () => {
    onOutcome(meeting.id, outcomeStatus, outcomeNote);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.45)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 680, maxHeight: "90vh", background: "#FFFFFF", borderRadius: 20, border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.15)" }}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink }}>
              {companyName || "AIVHub"} × {meeting.prospect}
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 2 }}>
              {meeting.date} at {meeting.time} ({meeting.duration}) · Synced via Cal.com
            </div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: C.slate }}><X size={18} /></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ background: C.paperSoft, borderRadius: 12, padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {meeting.format === "video" && <Video size={16} color={C.cobalt} />}
              {meeting.format === "phone" && <Phone size={16} color={C.cobalt} />}
              {meeting.format === "in_person" && <MapPin size={16} color={C.cobalt} />}
              <span style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk }}>
                {meeting.format === "video" ? `${meeting.platform || "Video Call"}: ${meeting.videoLink || "meet.google.com/aiv-demo"}` : meeting.format === "phone" ? `Dial-in: ${meeting.dialIn || "+44 20 7946 0912"}` : meeting.address || "14 Colmore Row, Birmingham"}
              </span>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.teal, background: C.tealSoft, padding: "3px 8px", borderRadius: 4 }}>
              CONFIRMED
            </span>
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
              <Sparkles size={14} color={C.cobalt} /> AI Pre-Call Briefing Notes
            </div>
            <div style={{ background: C.paperSoft, borderRadius: 10, padding: 14, fontFamily: FONT_BODY, fontSize: 13, color: C.textInk, lineHeight: 1.5 }}>
              {meeting.prep || "James showed strong interest in real-time dispatch dashboards on the call. Current pain point: manual Excel reporting takes ~2 days/week."}
            </div>
          </div>

          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
              Outreach Call Transcript
            </div>
            <div style={{ background: C.paperSoft, borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 8, maxHeight: 180, overflowY: "auto" }}>
              {(meeting.callTranscript || []).map((line, idx) => (
                <div key={idx} style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                  <b style={{ color: line.who === "ai" ? C.cobalt : C.ink }}>{line.who === "ai" ? "AI (Sam): " : "Prospect: "}</b>
                  <span style={{ color: C.textInk }}>{line.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 10 }}>
              Log Meeting Outcome
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {["converted", "needs_outcome", "not_fit"].map((st) => (
                <button
                  key={st}
                  onClick={() => setOutcomeStatus(st)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: `1px solid ${outcomeStatus === st ? C.cobalt : C.border}`,
                    background: outcomeStatus === st ? C.cobaltSoft : "#FFFFFF",
                    color: outcomeStatus === st ? C.cobaltDeep : C.slate,
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
              style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, fontSize: 13 }}
            />
            <button
              onClick={handleSaveOutcome}
              style={{ marginTop: 10, padding: "8px 16px", borderRadius: 8, border: "none", background: C.teal, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            >
              Save Outcome
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MeetingsView({ notifications, setNotifications, companyName, meetings = [], onOutcome }) {
  const [selectedMeeting, setSelectedMeeting] = useState(null);

  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.paper }}>
      <TopBar
        title="Meetings"
        subtitle="Discovery calls & demos booked by the AI SDR with automated prep briefings."
        notifications={notifications}
        setNotifications={setNotifications}
      />

      <div style={{ padding: 32 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 20 }}>
          {meetings.map((m) => (
            <div
              key={m.id}
              onClick={() => setSelectedMeeting(m)}
              style={{
                background: "#FFFFFF",
                borderRadius: 18,
                border: `1px solid ${C.border}`,
                padding: 24,
                cursor: "pointer",
                boxShadow: C.shadowCard,
                transition: "transform 0.15s, box-shadow 0.15s",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink }}>
                    {m.prospect}
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginTop: 2 }}>
                    {m.attendee || "Operations Contact"}
                  </div>
                </div>
                <Badge status={m.status} />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, padding: "12px 14px", background: C.paperSoft, borderRadius: 10 }}>
                <CalendarCheck size={18} color={C.cobalt} />
                <div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk }}>
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
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.cobalt }}>
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
        />
      )}
    </div>
  );
}
