import React, { useState } from "react";
import { CalendarDays, PhoneCall, ArrowRight, LogOut } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, HUB_PAPER, initialsFromName } from "../tokens";
import { BrandMark } from "../components/Badges";

function PluginCard({ icon: Icon, title, blurb, accent, ready, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 340,
        minHeight: 280,
        textAlign: "left",
        background: "#fff",
        border: `1px solid ${hover ? accent : C.border}`,
        borderRadius: 22,
        padding: 28,
        cursor: "pointer",
        boxShadow: hover ? "0 22px 48px rgba(18,20,28,0.10)" : "0 10px 28px rgba(18,20,28,0.04)",
        transform: hover ? "translateY(-3px)" : "none",
        transition: "transform 0.15s, box-shadow 0.15s, border-color 0.15s",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 14,
          background: `${accent}18`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 20,
        }}
      >
        <Icon size={24} color={accent} strokeWidth={2.1} />
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.slateLight, marginBottom: 8 }}>
        Plugin
      </div>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, letterSpacing: "-0.03em", lineHeight: 1.2 }}>
        {title}
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.slate, marginTop: 10, lineHeight: 1.5, flex: 1 }}>
        {blurb}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 22 }}>
        <span
          style={{
            fontFamily: FONT_BODY,
            fontSize: 11.5,
            fontWeight: 700,
            color: ready ? C.teal : C.amber,
            background: ready ? C.tealSoft : C.amberSoft,
            borderRadius: 999,
            padding: "4px 10px",
          }}
        >
          {ready ? "Open" : "Coming soon"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: accent }}>
          {ready ? "Enter" : "Preview"} <ArrowRight size={14} />
        </span>
      </div>
    </button>
  );
}

export function PluginHub({ operator = { name: "Jitendra S.", role: "Admin" }, onPick, onLogout }) {
  return (
    <div style={{ minHeight: "100vh", background: HUB_PAPER, fontFamily: FONT_BODY, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 36px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrandMark size={32} />
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink, letterSpacing: "-0.02em" }}>
            AIVHub
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk }}>{operator.name}</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slate }}>{operator.role}</div>
          </div>
          <div style={{ width: 32, height: 32, borderRadius: 999, background: C.cobalt, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700 }}>
            {initialsFromName(operator.name)}
          </div>
          <button
            onClick={onLogout}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 36,
              padding: "0 12px",
              borderRadius: 10,
              border: `1px solid ${C.border}`,
              background: "#fff",
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

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "12px 24px 64px" }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.slateLight, marginBottom: 8 }}>
          Workspace
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 32, color: C.ink, letterSpacing: "-0.04em", marginBottom: 8, textAlign: "center" }}>
          Choose a plugin
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 15, color: C.slate, marginBottom: 36, textAlign: "center", maxWidth: 480 }}>
          Same shell, separate products. Open one to start work.
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center" }}>
          <PluginCard
            icon={CalendarDays}
            title="Post scheduler"
            blurb="Chat a 2-day, week or month plan, save it, write posts here from company knowledge, approve in-app or email, then publish."
            accent={C.teal}
            ready={true}
            onClick={() => onPick("scheduler")}
          />
          <PluginCard
            icon={PhoneCall}
            title="AI Voice Appointment"
            blurb="Outbound voice SDR: import companies, call or message, book meetings. Humans supervise."
            accent={C.cobalt}
            ready={true}
            onClick={() => onPick("voice")}
          />
        </div>
      </div>
    </div>
  );
}
