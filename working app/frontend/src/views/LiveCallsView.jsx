import React from "react";
import { Radio, Headphones, Mic, PhoneOff, Check, AlertTriangle, MessageSquare, Building2, ExternalLink, CalendarCheck } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { TopBar } from "../components/TopBar";
import { Badge, LivePulse } from "../components/Badges";

export function LiveCallsView({
  notifications,
  setNotifications,
  companyName,
  calls = [],
  onConfirmBooking,
  onTakenToggle,
  onListenToggle,
  onEndCall,
}) {
  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.bg }}>
      <TopBar
        title="Live Activity"
        subtitle="Real-time monitoring of in-progress voice calls and multi-channel outreach conversations."
        notifications={notifications}
        setNotifications={setNotifications}
      />

      <div style={{ padding: 32 }}>
        {calls.length === 0 ? (
          <div
            style={{
              background: "rgba(18, 22, 41, 0.75)",
              backdropFilter: "blur(16px)",
              borderRadius: 20,
              border: `1px solid ${C.border}`,
              padding: "60px 24px",
              textAlign: "center",
              boxShadow: C.shadowCard,
            }}
          >
            <Radio size={40} color={C.slateLight} style={{ margin: "0 auto 14px" }} />
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 19, color: "#FFFFFF" }}>
              No active calls right now
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 4 }}>
              When outreach missions start dialing, live audio waveforms and streaming transcripts appear here.
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(440px, 1fr))", gap: 22 }}>
            {calls.map((c) => {
              const isVoice = c.channel === "voice";
              return (
                <div
                  key={c.id}
                  style={{
                    background: c.booked ? "rgba(16, 185, 129, 0.12)" : "rgba(18, 22, 41, 0.75)",
                    backdropFilter: "blur(16px)",
                    borderRadius: 20,
                    border: `1px solid ${c.booked ? "rgba(16,185,129,0.4)" : c.taken ? "rgba(255,176,32,0.4)" : C.border}`,
                    padding: 24,
                    boxShadow: c.booked ? "0 8px 30px rgba(16,185,129,0.2)" : C.shadowCard,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {/* Card Header */}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17.5, color: "#FFFFFF" }}>
                          {c.prospect}
                        </span>
                        {!c.booked && !c.ended && <LivePulse />}
                      </div>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginTop: 2 }}>
                        {c.mission} · <span style={{ textTransform: "capitalize" }}>{c.channel}</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontFamily: FONT_MONO,
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: "#CBD5E1",
                          background: "rgba(255,255,255,0.06)",
                          padding: "2px 8px",
                          borderRadius: 6,
                        }}
                      >
                        {c.duration}
                      </span>
                      {c.flag && (
                        <span
                          style={{
                            fontFamily: FONT_BODY,
                            fontSize: 11,
                            fontWeight: 700,
                            color: C.amber,
                            background: C.amberSoft,
                            padding: "2px 8px",
                            borderRadius: 6,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            border: `1px solid ${C.amber}33`,
                          }}
                        >
                          <AlertTriangle size={12} /> {c.flag}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Transcript Feed */}
                  <div
                    style={{
                      flex: 1,
                      background: "rgba(9, 11, 19, 0.7)",
                      borderRadius: 14,
                      padding: 14,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      maxHeight: 180,
                      overflowY: "auto",
                      marginBottom: 16,
                      border: `1px solid ${C.borderLight}`,
                    }}
                  >
                    {c.transcript && c.transcript.length > 0 ? (
                      c.transcript.map((line, idx) => {
                        const isAi = line.startsWith("AI:");
                        const text = line.replace(/^(AI:|Prospect:)\s*/, "");
                        return (
                          <div
                            key={idx}
                            style={{
                              alignSelf: isAi ? "flex-start" : "flex-end",
                              maxWidth: "85%",
                              background: isAi ? "rgba(255,255,255,0.08)" : C.cobalt,
                              color: "#FFFFFF",
                              padding: "7px 12px",
                              borderRadius: 10,
                              fontFamily: FONT_BODY,
                              fontSize: 12.5,
                              lineHeight: 1.4,
                              boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                            }}
                          >
                            <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.75, display: "block", marginBottom: 2 }}>
                              {isAi ? `Sam (${companyName || "AIVHub"})` : c.prospect}
                            </span>
                            {text}
                          </div>
                        );
                      })
                    ) : (
                      <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight, textAlign: "center", padding: "14px 0" }}>
                        Call connecting...
                      </div>
                    )}
                  </div>

                  {/* Booking Confirmation Action */}
                  {c.booked ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: C.green,
                        fontFamily: FONT_BODY,
                        fontSize: 13,
                        fontWeight: 600,
                        padding: "8px 0",
                      }}
                    >
                      <Check size={16} /> Meeting booked — added to Schedule and Meetings.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {c.state === "negotiating" && onConfirmBooking && (
                        <button
                          onClick={() => onConfirmBooking(c.id)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 8,
                            width: "100%",
                            height: 40,
                            borderRadius: 10,
                            border: "none",
                            background: C.gradientPrimary,
                            color: "#fff",
                            fontFamily: FONT_BODY,
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: "pointer",
                            boxShadow: C.glowPrimary,
                          }}
                        >
                          <CalendarCheck size={15} /> Confirm time & book meeting
                        </button>
                      )}

                      {/* Supervisor Toolbar */}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={() => onListenToggle && onListenToggle(c.id)}
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                            height: 36,
                            borderRadius: 9,
                            border: `1px solid ${c.listening ? C.cobalt : C.border}`,
                            background: c.listening ? "rgba(75,115,255,0.2)" : "rgba(255,255,255,0.04)",
                            color: c.listening ? "#fff" : C.slate,
                            fontFamily: FONT_BODY,
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          <Headphones size={14} /> {c.listening ? "Listening" : "Listen in"}
                        </button>

                        <button
                          onClick={() => onTakenToggle && onTakenToggle(c.id)}
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                            height: 36,
                            borderRadius: 9,
                            border: `1px solid ${c.taken ? C.amber : C.border}`,
                            background: c.taken ? "rgba(255,176,32,0.2)" : "rgba(255,255,255,0.04)",
                            color: c.taken ? "#fff" : C.slate,
                            fontFamily: FONT_BODY,
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          <Mic size={14} /> {c.taken ? "Taking over" : "Take over"}
                        </button>

                        <button
                          onClick={() => onEndCall && onEndCall(c.id)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 36,
                            height: 36,
                            borderRadius: 9,
                            border: `1px solid ${C.red}30`,
                            background: C.redSoft,
                            color: C.red,
                            cursor: "pointer",
                          }}
                        >
                          <PhoneOff size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
