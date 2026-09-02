import React from "react";
import { ArrowUpRight, PlusCircle, ArrowRight, ChevronLeft, PhoneCall, Radio, CheckCircle2, Clock, HelpCircle, AlertTriangle } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { TopBar } from "../components/TopBar";
import { Badge, LivePulse } from "../components/Badges";

export function MissionsView({ onOpenMission, onNewMission, notifications, setNotifications, missions = [] }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.bg }}>
      <TopBar
        title="Missions"
        subtitle="Campaigns currently researching, dialing, and booking meetings across UK regions."
        onNewMission={onNewMission}
        notifications={notifications}
        setNotifications={setNotifications}
      />

      <div style={{ padding: 32 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 22 }}>
          {missions.map((m) => {
            const pct = m.total > 0 ? Math.round((m.contacted / m.total) * 100) : 0;
            return (
              <div
                key={m.id}
                onClick={() => onOpenMission(m)}
                style={{
                  background: "rgba(18, 22, 41, 0.75)",
                  backdropFilter: "blur(16px)",
                  borderRadius: 20,
                  border: `1px solid ${C.border}`,
                  padding: 24,
                  cursor: "pointer",
                  boxShadow: C.shadowCard,
                  transition: "transform 0.15s, box-shadow 0.15s, border-color 0.15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17.5, color: "#FFFFFF", lineHeight: 1.3 }}>
                    {m.title}
                  </div>
                  <Badge status={m.status} />
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                  {m.source === "manual" && (
                    <span
                      style={{
                        fontFamily: FONT_BODY,
                        fontSize: 10,
                        fontWeight: 700,
                        color: C.cobaltDeep,
                        background: C.cobaltSoft,
                        padding: "2px 8px",
                        borderRadius: 5,
                        letterSpacing: "0.06em",
                        border: `1px solid rgba(75,115,255,0.3)`,
                      }}
                    >
                      PROVIDED LIST
                    </span>
                  )}
                  <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>
                    {m.region} · {m.sector}
                  </span>
                </div>

                <div style={{ marginTop: 22 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginBottom: 8 }}>
                    <span>Progress ({m.contacted}/{m.total} contacted)</span>
                    <span style={{ fontFamily: FONT_MONO, fontWeight: 600, color: "#FFFFFF" }}>{pct}%</span>
                  </div>
                  <div style={{ height: 6, width: "100%", background: "rgba(255,255,255,0.06)", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: C.gradientPrimary, borderRadius: 999 }} />
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 22, paddingTop: 16, borderTop: `1px solid ${C.borderLight}` }}>
                  <div>
                    <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.teal }}>
                      {m.meetingsBooked}
                    </span>
                    <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginLeft: 6 }}>
                      meetings booked
                    </span>
                  </div>
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.cobaltDeep }}>
                    View feed <ArrowRight size={14} />
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

export function MissionDetail({ mission, onBack, companyName, onWatchLive }) {
  if (!mission) return null;
  const prospects = mission.prospects || [];
  const booked = prospects.filter((p) => p.status === "meeting_booked").length;
  const calling = prospects.filter((p) => p.status === "calling").length;
  const queued = prospects.filter((p) => p.status === "queued").length;

  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.bg }}>
      <div style={{ padding: "20px 32px", background: "rgba(18, 22, 41, 0.9)", backdropFilter: "blur(16px)", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button
            onClick={onBack}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              border: `1px solid ${C.border}`,
              background: C.paperSoft,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "#fff",
            }}
          >
            <ChevronLeft size={18} />
          </button>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: "#FFFFFF", margin: 0 }}>
                {mission.title}
              </h1>
              <Badge status={mission.status} />
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 2 }}>
              Representing <span style={{ fontWeight: 600, color: "#FFFFFF" }}>{companyName || "AIVHub"}</span> · {mission.region} · {mission.sector}
            </div>
          </div>
        </div>

        {calling > 0 && (
          <button
            onClick={onWatchLive}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 38,
              padding: "0 18px",
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
            <Radio size={15} /> Watch live ({calling})
          </button>
        )}
      </div>

      <div style={{ padding: 32, display: "grid", gridTemplateColumns: "1fr 320px", gap: 24 }}>
        {/* Left: Prospects feed */}
        <div style={{ background: "rgba(18, 22, 41, 0.75)", backdropFilter: "blur(16px)", borderRadius: 20, border: `1px solid ${C.border}`, padding: 24, boxShadow: C.shadowCard }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: "#FFFFFF", marginBottom: 18 }}>
            Prospect Activity ({prospects.length})
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {prospects.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 16px",
                  borderRadius: 14,
                  border: `1px solid ${p.status === "calling" ? "rgba(75,115,255,0.35)" : C.borderLight}`,
                  background: p.status === "calling" ? "rgba(75,115,255,0.12)" : "rgba(255,255,255,0.02)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {p.status === "calling" && <LivePulse />}
                  {p.status === "meeting_booked" && <CheckCircle2 size={16} color={C.teal} />}
                  {p.status === "human_review" && <AlertTriangle size={16} color={C.amber} />}
                  {p.status === "queued" && <Clock size={16} color={C.slateLight} />}
                  {p.status === "rejected" && <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.red }} />}
                  {p.status === "retry" && <Clock size={16} color={C.amber} />}

                  <div>
                    <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14, color: "#FFFFFF" }}>
                      {p.name}
                    </div>
                    {p.note && (
                      <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginTop: 2 }}>
                        {p.note}
                      </div>
                    )}
                  </div>
                </div>

                <Badge status={p.status} small />
              </div>
            ))}
          </div>
        </div>

        {/* Right: Stats & Queue Info */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ background: "rgba(18, 22, 41, 0.75)", backdropFilter: "blur(16px)", borderRadius: 20, border: `1px solid ${C.border}`, padding: 22, boxShadow: C.shadowCard }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.slate, marginBottom: 14 }}>
              Campaign Statistics
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate }}>Meetings Booked</span>
                <span style={{ fontFamily: FONT_MONO, fontWeight: 700, color: C.teal }}>{booked}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate }}>Active Calls</span>
                <span style={{ fontFamily: FONT_MONO, fontWeight: 700, color: C.cobaltDeep }}>{calling}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate }}>Waiting in Queue</span>
                <span style={{ fontFamily: FONT_MONO, fontWeight: 700, color: C.slate }}>{queued}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate }}>Concurrency</span>
                <span style={{ fontFamily: FONT_MONO, fontWeight: 700, color: "#FFFFFF" }}>{mission.concurrency || 5} lines</span>
              </div>
            </div>
          </div>

          {mission.queueEstimate && (
            <div style={{ background: "rgba(75,115,255,0.08)", borderRadius: 20, border: `1px solid rgba(75,115,255,0.25)`, padding: 20 }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.cobaltDeep, marginBottom: 6 }}>
                Queue Pacing ETA
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16.5, color: "#FFFFFF", marginBottom: 4 }}>
                {mission.queueEstimate.finish_label || "Fitting in today's window"}
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, lineHeight: 1.4 }}>
                Paced across {mission.concurrency} concurrent lines within {mission.call_window || "09:00–17:30"} UK PECR window.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
