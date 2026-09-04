import React, { useState } from "react";
import { Mic, PhoneOff, Headphones, UserCheck, ShieldCheck, Sparkles, MessageCircle, PhoneCall, AlertCircle } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { TopBar } from "../components/TopBar";
import { Badge, LivePulse } from "../components/Badges";

export function LiveCallsView({ notifications, setNotifications, calls = [], onTakeOver, onEndCall }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.paper }}>
      <TopBar
        title="Live Activity"
        subtitle="Real-time monitoring of live autonomous voice and messaging outreach channels."
        notifications={notifications}
        setNotifications={setNotifications}
      />

      <div style={{ padding: 32 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(460px, 1fr))", gap: 24 }}>
          {calls.map((c) => {
            const isEngaged = c.status === "engaged" || c.state === "engaged";
            return (
              <div
                key={c.id}
                style={{
                  background: "#FFFFFF",
                  borderRadius: 20,
                  border: `1px solid ${c.supervisorTaken ? C.amber : C.border}`,
                  padding: 24,
                  boxShadow: C.shadowCard,
                  display: "flex",
                  flexDirection: "column",
                  gap: 18,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink }}>
                        {c.prospect}
                      </span>
                      {isEngaged && <LivePulse />}
                    </div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 4 }}>
                      Contact: <b>{c.contact || "Director"}</b> · {c.startedAt || "1 min ago"}
                    </div>
                  </div>
                  <Badge status={c.supervisorTaken ? "human_review" : c.status || "engaged"} />
                </div>

                {/* Audio Waveform visualization */}
                {isEngaged && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, height: 40, padding: "0 12px", background: C.paperSoft, borderRadius: 10 }}>
                    {(c.waveform || [30, 45, 60, 80, 40, 65, 90, 50, 70, 40, 60, 30, 50]).map((h, i) => (
                      <div
                        key={i}
                        style={{
                          flex: 1,
                          height: `${Math.max(15, h)}%`,
                          background: c.supervisorTaken ? C.amber : C.cobalt,
                          borderRadius: 2,
                          transition: "height 0.15s ease",
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* Live Transcript snippet */}
                <div style={{ background: C.paperSoft, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8, maxHeight: 150, overflowY: "auto" }}>
                  {(c.transcript || []).map((t, idx) => (
                    <div key={idx} style={{ fontSize: 12.5, lineHeight: 1.45, fontFamily: FONT_BODY }}>
                      <b style={{ color: t.who === "ai" ? C.cobalt : C.ink }}>
                        {t.who === "ai" ? "Sam (AI SDR): " : "Prospect: "}
                      </b>
                      <span style={{ color: C.textInk }}>{t.text}</span>
                    </div>
                  ))}
                </div>

                {/* Supervisor Toolbar */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 14, borderTop: `1px solid ${C.borderLight}` }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => onTakeOver && onTakeOver(c.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        height: 34,
                        padding: "0 12px",
                        borderRadius: 8,
                        border: `1px solid ${c.supervisorTaken ? C.amber : C.border}`,
                        background: c.supervisorTaken ? C.amberSoft : "#FFFFFF",
                        color: c.supervisorTaken ? C.amber : C.textInk,
                        fontFamily: FONT_BODY,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      <UserCheck size={13} /> {c.supervisorTaken ? "Supervising" : "Take Over"}
                    </button>
                    <button
                      onClick={() => onEndCall && onEndCall(c.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        height: 34,
                        padding: "0 12px",
                        borderRadius: 8,
                        border: `1px solid ${C.redSoft}`,
                        background: C.redSoft,
                        color: C.red,
                        fontFamily: FONT_BODY,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      <PhoneOff size={13} /> End Call
                    </button>
                  </div>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.slate }}>
                    Duration: {c.durationSec ? `${Math.floor(c.durationSec / 60)}m ${c.durationSec % 60}s` : "01:42"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
