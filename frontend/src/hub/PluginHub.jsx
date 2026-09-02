import React, { useState } from "react";
import { PhoneCall, CalendarDays, ArrowRight, LogOut, Sparkles } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, HUB_PAPER, initialsFromName } from "../tokens";
import { AppChrome } from "../components/AppChrome";
import { BrandMark } from "../components/Badges";

function PluginCard({ icon: Icon, title, blurb, accentGradient, accentColor, ready, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 360,
        minHeight: 300,
        textAlign: "left",
        background: hover ? "rgba(25, 31, 56, 0.85)" : "rgba(18, 22, 41, 0.75)",
        backdropFilter: "blur(20px)",
        border: `1px solid ${hover ? accentColor : "rgba(255, 255, 255, 0.08)"}`,
        borderRadius: 24,
        padding: 32,
        cursor: "pointer",
        boxShadow: hover ? `0 24px 60px ${accentColor}33, 0 0 30px ${accentColor}22` : C.shadowCard,
        transform: hover ? "translateY(-4px)" : "none",
        transition: "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s, border-color 0.2s, background 0.2s",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      <div
        style={{
          width: 58,
          height: 58,
          borderRadius: 16,
          background: accentGradient || accentColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 24,
          boxShadow: hover ? `0 10px 30px ${accentColor}55` : "none",
          transition: "box-shadow 0.2s",
        }}
      >
        <Icon size={28} color="#fff" strokeWidth={2.2} />
      </div>

      <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: C.slateLight, marginBottom: 8 }}>
        Product Plugin
      </div>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, color: "#FFFFFF", letterSpacing: "-0.03em", lineHeight: 1.2 }}>
        {title}
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.slate, marginTop: 12, lineHeight: 1.5, flex: 1 }}>
        {blurb}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 26, paddingTop: 18, borderTop: `1px solid rgba(255, 255, 255, 0.06)` }}>
        <span
          style={{
            fontFamily: FONT_BODY,
            fontSize: 11.5,
            fontWeight: 700,
            color: ready ? C.teal : C.amber,
            background: ready ? C.tealSoft : C.amberSoft,
            borderRadius: 999,
            padding: "4px 12px",
            border: `1px solid ${ready ? C.teal : C.amber}33`,
          }}
        >
          {ready ? "Active Suite" : "Coming soon"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: accentColor }}>
          {ready ? "Launch" : "Preview"} <ArrowRight size={14} />
        </span>
      </div>
    </button>
  );
}

export function PluginHub({ operator, onPick, onLogout }) {
  const op = operator || { name: "Jitendra S.", role: "Admin" };

  return (
    <div style={{ minHeight: "100vh", background: "#090B13", fontFamily: FONT_BODY, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
      <AppChrome />

      {/* Radiant Glow Atmosphere */}
      <div
        style={{
          position: "absolute",
          width: 800,
          height: 600,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(147,83,255,0.14) 0%, rgba(75,115,255,0.09) 35%, rgba(255,84,226,0.05) 60%, transparent 80%)",
          filter: "blur(100px)",
          top: "10%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}
      />

      {/* Top Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 44px", position: "relative", zIndex: 1, borderBottom: `1px solid rgba(255, 255, 255, 0.05)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BrandMark size={36} />
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: "#FFFFFF", letterSpacing: "-0.03em" }}>AIVHub</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: "#FFFFFF" }}>{op.name}</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slate }}>{op.role}</div>
          </div>
          <div style={{ width: 36, height: 36, borderRadius: 999, background: C.gradientPrimary, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, boxShadow: C.glowPrimary }}>
            {initialsFromName(op.name)}
          </div>
          <button
            onClick={onLogout}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 38,
              padding: "0 14px",
              borderRadius: 10,
              border: `1px solid rgba(255, 255, 255, 0.1)`,
              background: "rgba(255, 255, 255, 0.04)",
              fontFamily: FONT_BODY,
              fontSize: 12.5,
              fontWeight: 600,
              color: C.slate,
              cursor: "pointer",
            }}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </div>

      {/* Hub Center */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "20px 24px 72px", position: "relative", zIndex: 1 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(147,83,255,0.12)", padding: "5px 14px", borderRadius: 999, marginBottom: 16, border: "1px solid rgba(147,83,255,0.25)" }}>
          <Sparkles size={14} color={C.radiantPurple} />
          <span style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#C084FC" }}>
            Unified Workspace Hub
          </span>
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 38, color: "#FFFFFF", letterSpacing: "-0.04em", marginBottom: 12, textAlign: "center" }}>
          Choose your active workspace
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 16, color: C.slate, marginBottom: 44, textAlign: "center", maxWidth: 540 }}>
          Same unified company intelligence and compliance shell, specialized for voice & social campaigns.
        </div>

        <div style={{ display: "flex", gap: 32, flexWrap: "wrap", justifyContent: "center" }}>
          <PluginCard
            icon={PhoneCall}
            title="AI Voice Appointment"
            blurb="Autonomous voice SDR: research UK companies, execute outbound calls, handle objections, and book qualified discovery meetings."
            accentGradient={C.gradientPrimary}
            accentColor={C.cobaltDeep}
            ready={true}
            onClick={() => onPick("voice")}
          />
          <PluginCard
            icon={CalendarDays}
            title="Post Scheduler"
            blurb="Plan multi-week content campaigns with natural chat, generate verified copy from your company knowledge base, and approve in-app."
            accentGradient={C.gradientTeal}
            accentColor={C.teal}
            ready={true}
            onClick={() => onPick("scheduler")}
          />
        </div>
      </div>
    </div>
  );
}
