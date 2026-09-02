import React from "react";
import {
  ListChecks,
  Calendar,
  CalendarCheck,
  Radio,
  History,
  Building2,
  Users,
  Plug,
  Settings2,
  BarChart3,
  PhoneCall,
  LogOut,
  ChevronLeft,
  Lock,
} from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO, timezoneLabel, initialsFromName } from "../tokens";

export const NAV_GROUPS = [
  { label: "Operations", items: [
    { id: "missions", label: "Missions", icon: ListChecks },
    { id: "schedule", label: "Schedule", icon: Calendar },
    { id: "meetings", label: "Meetings", icon: CalendarCheck },
    { id: "live", label: "Live Activity", icon: Radio },
    { id: "calllog", label: "Call Log", icon: History },
    { id: "prospects", label: "Prospects", icon: Building2 },
  ]},
  { label: "Configuration", items: [
    { id: "company", label: "Company Profile", icon: Users },
    { id: "connections", label: "Connections", icon: Plug },
    { id: "provider", label: "AI Providers", icon: Settings2 },
  ]},
  { label: "Insights", items: [
    { id: "analytics", label: "Analytics", icon: BarChart3 },
  ]},
];

export function Sidebar({ view, setView, companyName, callerName, timezone, operatorName, operatorRole, onBackToHub, onLogout }) {
  const who = operatorName || "Jitendra S.";
  const role = operatorRole || "Admin";
  return (
    <div
      style={{
        width: 240,
        minWidth: 240,
        background: C.ink,
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "22px 14px",
        boxSizing: "border-box",
        overflowY: "auto",
        borderRight: `1px solid ${C.inkLine}`,
      }}
    >
      {/* Brand Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 14px 8px" }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: C.gradientPrimary,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 10px rgba(75,115,255,0.4)",
          }}
        >
          <PhoneCall size={15} color="#fff" strokeWidth={2.4} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16.5, color: "#fff", letterSpacing: "-0.02em" }}>
            AIVHub
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.slateLight, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Voice AI Platform
          </div>
        </div>
        {onBackToHub && (
          <button
            onClick={onBackToHub}
            title="Back to Workspace Hub"
            style={{
              background: C.inkSoft,
              border: `1px solid ${C.inkLine}`,
              borderRadius: 7,
              color: C.slateLight,
              width: 26,
              height: 26,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <ChevronLeft size={14} />
          </button>
        )}
      </div>

      {/* Navigation Sections */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 18, marginTop: 10 }}>
        {NAV_GROUPS.map((grp) => (
          <div key={grp.label}>
            <div
              style={{
                fontFamily: FONT_BODY,
                fontSize: 10,
                fontWeight: 700,
                color: C.slate,
                textTransform: "uppercase",
                letterSpacing: "0.09em",
                padding: "0 8px 6px 8px",
              }}
            >
              {grp.label}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {grp.items.map((item) => {
                const Icon = item.icon;
                const active = view === item.id || (view === "missionDetail" && item.id === "missions");
                return (
                  <button
                    key={item.id}
                    onClick={() => setView(item.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "8px 11px",
                      borderRadius: 9,
                      border: "none",
                      background: active ? "rgba(75, 115, 255, 0.15)" : "transparent",
                      color: active ? "#fff" : "#94A3B8",
                      fontFamily: FONT_BODY,
                      fontSize: 12.5,
                      fontWeight: active ? 600 : 500,
                      cursor: "pointer",
                      textAlign: "left",
                      position: "relative",
                      transition: "background 0.15s, color 0.15s",
                    }}
                  >
                    {active && (
                      <span
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 6,
                          bottom: 6,
                          width: 3,
                          borderRadius: 2,
                          background: C.gradientPrimary,
                        }}
                      />
                    )}
                    <Icon size={15} color={active ? C.cobalt : "#94A3B8"} strokeWidth={active ? 2.3 : 1.8} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Info */}
      <div style={{ borderTop: `1px solid ${C.inkLine}`, paddingTop: 14, marginTop: 14 }}>
        <div style={{ padding: "0 6px 10px 6px" }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: "#94A3B8", lineHeight: 1.4 }}>
            AI speaks as <span style={{ color: "#fff", fontWeight: 600 }}>{callerName || "Sam"}</span>, on behalf of{" "}
            <span style={{ color: "#fff", fontWeight: 600 }}>{companyName || "AIVHub"}</span>
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 9.5, color: C.slate, marginTop: 3 }}>
            TZ: {timezone || "Europe/London"}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: C.inkSoft, borderRadius: 10, border: `1px solid ${C.inkLine}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: C.gradientPrimary,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: FONT_BODY,
                fontSize: 11,
                fontWeight: 700,
                boxShadow: "0 2px 8px rgba(75,115,255,0.3)",
              }}
            >
              {initialsFromName(who)}
            </div>
            <div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: "#fff" }}>{who}</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: C.slateLight }}>{role}</div>
            </div>
          </div>
          {onLogout && (
            <button
              onClick={onLogout}
              title="Sign out"
              style={{
                background: "transparent",
                border: "none",
                color: C.slateLight,
                cursor: "pointer",
                padding: 4,
                display: "flex",
                alignItems: "center",
              }}
            >
              <LogOut size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
