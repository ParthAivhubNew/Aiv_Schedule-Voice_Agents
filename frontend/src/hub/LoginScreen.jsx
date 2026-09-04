import React, { useState } from "react";
import { Lock, PhoneCall, ArrowRight } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, HUB_PAPER } from "../tokens";
import { BrandMark } from "../components/Badges";

export function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("jitendra");
  const [password, setPassword] = useState("••••••••");
  const [error, setError] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (!username.trim()) {
      setError("Please enter a username");
      return;
    }
    onLogin({
      username: username.trim(),
      name: username.toLowerCase().startsWith("jitendra") ? "Jitendra S." : username.trim(),
      role: "Admin",
    });
  };

  const field = {
    width: "100%",
    height: 44,
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: "#fff",
    padding: "0 14px",
    fontFamily: FONT_BODY,
    fontSize: 14,
    color: C.textInk,
  };

  return (
    <div style={{ minHeight: "100vh", background: HUB_PAPER, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: FONT_BODY }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 28 }}>
          <BrandMark size={44} />
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 28, color: C.ink, letterSpacing: "-0.03em", marginTop: 14 }}>
            AIVHub
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.slate, marginTop: 6, textAlign: "center" }}>
            Sign in to open your workspace plugins
          </div>
        </div>
        <div
          style={{
            background: "#fff",
            border: `1px solid ${C.border}`,
            borderRadius: 20,
            padding: "28px 28px 24px",
            boxShadow: "0 18px 50px rgba(18,20,28,0.06)",
          }}
        >
          <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>
            Username
          </label>
          <input
            autoFocus
            value={username}
            onChange={(e) => { setUsername(e.target.value); setError(""); }}
            placeholder="e.g. jitendra"
            style={{ ...field, marginBottom: 16 }}
          />
          <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>
            Password
          </label>
          <div style={{ position: "relative", marginBottom: 8 }}>
            <Lock size={14} color={C.slateLight} style={{ position: "absolute", left: 14, top: 15 }} />
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="••••••••"
              style={{ ...field, paddingLeft: 36 }}
            />
          </div>
          {error && <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.red, margin: "8px 0 4px" }}>{error}</div>}
          <button
            type="submit"
            style={{
              width: "100%",
              height: 46,
              marginTop: 16,
              borderRadius: 12,
              border: "none",
              background: C.ink,
              color: "#fff",
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Sign in
          </button>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, marginTop: 14, lineHeight: 1.45 }}>
            Prototype login — any username and password works. Try <span style={{ color: C.textInk, fontWeight: 600 }}>jitendra</span> to land as the seeded operator.
          </div>
        </div>
      </form>
    </div>
  );
}
