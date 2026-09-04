import React, { useState } from "react";
import { C, FONT_BODY, FONT_DISPLAY } from "../tokens";
import { TopBar } from "../components/TopBar";

export function ProviderConfigView({ notifications, setNotifications }) {
  const [activeMode, setActiveMode] = useState("paid"); // "paid" or "oss"

  const layers = [
    { name: "LLM / Brain", paid: "Anthropic Claude 3.5 Sonnet / GPT-4o", oss: "DeepSeek-V3 / DeepSeek-R1" },
    { name: "Speech-to-Text", paid: "Deepgram Nova-2 (en-GB)", oss: "Faster-Whisper (large-v3-turbo)" },
    { name: "Text-to-Speech", paid: "Cartesia Sonic / ElevenLabs Flash", oss: "Kokoro-82M (British RP bf_emma)" },
    { name: "Voice Engine", paid: "Retell AI / Vapi Core", oss: "LiveKit Agents + SIP Gateway" },
    { name: "Telephony", paid: "Twilio Voice UK DIDs", oss: "Telnyx Wholesale SIP Trunk" },
    { name: "Calendar", paid: "Cal.com Cloud API", oss: "Cal.com Community Edition" },
  ];

  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.paper }}>
      <TopBar
        title="AI Providers & Stack Mode"
        subtitle="Toggle between Managed Cloud APIs and Open-Source self-hosted models."
        notifications={notifications}
        setNotifications={setNotifications}
      />

      <div style={{ padding: 32 }}>
        <div style={{ display: "flex", gap: 14, marginBottom: 28 }}>
          <button
            onClick={() => setActiveMode("paid")}
            style={{
              padding: "12px 22px",
              borderRadius: 12,
              border: `1.5px solid ${activeMode === "paid" ? C.cobalt : C.border}`,
              background: activeMode === "paid" ? C.cobaltSoft : "#FFFFFF",
              color: activeMode === "paid" ? C.cobaltDeep : C.slate,
              fontFamily: FONT_BODY,
              fontWeight: 700,
              fontSize: 13.5,
              cursor: "pointer",
            }}
          >
            Paid / Managed Cloud Stack (~$0.22/call)
          </button>
          <button
            onClick={() => setActiveMode("oss")}
            style={{
              padding: "12px 22px",
              borderRadius: 12,
              border: `1.5px solid ${activeMode === "oss" ? C.teal : C.border}`,
              background: activeMode === "oss" ? C.tealSoft : "#FFFFFF",
              color: activeMode === "oss" ? C.teal : C.slate,
              fontFamily: FONT_BODY,
              fontWeight: 700,
              fontSize: 13.5,
              cursor: "pointer",
            }}
          >
            Open Source / Self-Hosted Stack (~$0.03/call)
          </button>
        </div>

        <div style={{ background: "#FFFFFF", borderRadius: 18, border: `1px solid ${C.border}`, overflow: "hidden", maxWidth: 800, boxShadow: C.shadowCard }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontFamily: FONT_BODY, fontSize: 13.5 }}>
            <thead>
              <tr style={{ background: C.paperSoft, borderBottom: `1px solid ${C.border}`, color: C.slate, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <th style={{ padding: "14px 18px" }}>Infrastructure Layer</th>
                <th style={{ padding: "14px 18px" }}>Active Target Model / System</th>
              </tr>
            </thead>
            <tbody>
              {layers.map((l) => (
                <tr key={l.name} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                  <td style={{ padding: "16px 18px", fontWeight: 600, color: C.ink }}>{l.name}</td>
                  <td style={{ padding: "16px 18px", color: activeMode === "paid" ? C.cobaltDeep : C.teal, fontWeight: 600 }}>
                    {activeMode === "paid" ? l.paid : l.oss}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
