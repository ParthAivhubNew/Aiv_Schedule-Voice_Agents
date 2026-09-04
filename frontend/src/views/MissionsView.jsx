import React from "react";
import { ArrowUpRight, PlusCircle, ArrowRight, ChevronLeft, PhoneCall, Radio, CheckCircle2, Clock, HelpCircle, AlertTriangle } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { TopBar } from "../components/TopBar";
import { Badge, LivePulse } from "../components/Badges";

export function MissionsView({ onOpenMission, onNewMission, notifications, setNotifications, missions = [] }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.paper }}>
      <TopBar
        title="Missions"
        subtitle="Campaigns currently researching, dialing, and booking meetings across UK regions."
        onNewMission={onNewMission}
        notifications={notifications}
        setNotifications={setNotifications}
      />

      <div style={{ padding: 32 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 20 }}>
          {missions.map((m) => {
            const total = m.total || m.prospectsCount || 0;
            const contacted = m.contacted || m.completedCount || 0;
            const pct = total > 0 ? Math.round((contacted / total) * 100) : 0;
            const booked = m.meetingsBooked || m.booked || 0;
            return (
              <div
                key={m.id}
                onClick={() => onOpenMission && onOpenMission(m)}
                style={{
                  background: "#FFFFFF",
                  borderRadius: 18,
                  border: `1px solid ${C.border}`,
                  padding: 24,
                  cursor: "pointer",
                  boxShadow: C.shadowCard,
                  transition: "transform 0.15s, box-shadow 0.15s, border-color 0.15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17.5, color: C.ink, lineHeight: 1.3 }}>
                    {m.name || m.title}
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
                    <span>Progress ({contacted}/{total} contacted)</span>
                    <span style={{ fontFamily: FONT_MONO, fontWeight: 600, color: C.ink }}>{pct}%</span>
                  </div>
                  <div style={{ width: "100%", height: 7, borderRadius: 999, background: C.paperSoft, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: C.gradientPrimary, borderRadius: 999 }} />
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.borderLight}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <CheckCircle2 size={15} color={C.teal} />
                    <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.textInk }}>
                      {booked} {booked === 1 ? "meeting" : "meetings"} booked
                    </span>
                  </div>
                  <span style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.cobalt }}>
                    View details <ArrowRight size={13} />
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
