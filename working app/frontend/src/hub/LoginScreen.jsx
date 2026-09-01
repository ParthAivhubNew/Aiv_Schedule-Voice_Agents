import React, { useState } from "react";
import { Lock, ArrowRight, PhoneCall, Sparkles } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, HUB_PAPER } from "../tokens";
import { AppChrome } from "../components/AppChrome";

export function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("jitendra");
  const [password, setPassword] = useState("••••••••");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    onLogin(username);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#090B13",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT_BODY,
        padding: 24,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <AppChrome />
      
      {/* Background Radiant Neon Glow Orbs */}
      <div
        style={{
          position: "absolute",
          width: 550,
          height: 550,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(147,83,255,0.2) 0%, rgba(75,115,255,0.12) 40%, rgba(255,84,226,0.06) 70%, transparent 80%)",
          filter: "blur(80px)",
          top: "30%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}
      />

      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: 420,
          background: "rgba(18, 22, 41, 0.8)",
          backdropFilter: "blur(24px)",
          borderRadius: 24,
          border: `1px solid rgba(255, 255, 255, 0.1)`,
          padding: "42px 38px",
          boxShadow: "0 24px 60px rgba(0,0,0,0.6), 0 0 30px rgba(147,83,255,0.15)",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 13,
              background: C.gradientPrimary,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: C.glowPrimary,
            }}
          >
            <PhoneCall size={22} color="#fff" strokeWidth={2.4} />
          </div>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 21, color: "#FFFFFF", letterSpacing: "-0.03em" }}>
              AIVHub
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate }}>
              Voice AI & Outreach Platform
            </div>
          </div>
        </div>

        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, color: "#FFFFFF", marginBottom: 6, letterSpacing: "-0.02em" }}>
          Sign in to Platform
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginBottom: 26, lineHeight: 1.45 }}>
          Access your SDR campaigns, live dialers, and post scheduler workspace.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 }}>
              Username or Email
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. jitendra"
              style={{
                width: "100%",
                height: 44,
                padding: "0 14px",
                borderRadius: 11,
                fontFamily: FONT_BODY,
                fontSize: 13.5,
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: "100%",
                height: 44,
                padding: "0 14px",
                borderRadius: 11,
                fontFamily: FONT_BODY,
                fontSize: 13.5,
              }}
            />
          </div>

          <button
            type="submit"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              height: 46,
              borderRadius: 12,
              border: "none",
              background: C.gradientPrimary,
              color: "#fff",
              fontFamily: FONT_BODY,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              marginTop: 10,
              boxShadow: C.glowPrimary,
            }}
          >
            Continue to Workspace <ArrowRight size={16} />
          </button>
        </div>

        <div style={{ marginTop: 26, paddingTop: 18, borderTop: `1px solid rgba(255,255,255,0.08)`, display: "flex", alignItems: "center", gap: 8, color: C.slateLight, fontSize: 12 }}>
          <Lock size={13} />
          <span>Development account — type <b>jitendra</b> for admin access.</span>
        </div>
      </form>
    </div>
  );
}
