import React, { useState } from "react";
import {
  Activity,
  CheckCircle2,
  AlertCircle,
  Radio,
  RotateCcw,
  Sparkles,
  PhoneCall,
  CalendarCheck,
  Cpu,
  Layers,
  Check,
  AlertTriangle
} from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { TopBar } from "../components/TopBar";
import { api } from "../api/apiClient";

export function ProviderConfigView({
  notifications,
  setNotifications,
  commonAi,
  setCommonAi,
  profile,
  setProfile,
  embedded = false,
  onNavigateView
}) {
  const [activeMode, setActiveMode] = useState("paid"); // "paid" or "oss"

  // 5-Point Diagnostics State
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const [diagnosticResult, setDiagnosticResult] = useState(null);
  const [diagError, setDiagError] = useState(null);

  const runDiagnostics = async () => {
    try {
      setDiagnosticsRunning(true);
      setDiagError(null);
      const res = await api.runVoiceAndBookingDiagnostics();
      setDiagnosticResult(res);
    } catch (err) {
      setDiagError(err.message || "Diagnostic check failed");
    } finally {
      setDiagnosticsRunning(false);
    }
  };

  const layers = [
    { name: "LLM / Conversational Brain", paid: "OpenAI (gpt-4o-mini) / xAI Grok", oss: "DeepSeek (deepseek-chat)" },
    { name: "Speech-to-Text (STT)", paid: "Deepgram (nova-2 streaming)", oss: "Faster-Whisper (self-hosted)" },
    { name: "Text-to-Speech (TTS)", paid: "Cartesia (sonic-3 low latency)", oss: "Kokoro (self-hosted)" },
    { name: "Voice & Realtime WebRTC", paid: "LiveKit Cloud / Local Agent", oss: "LiveKit Server (self-hosted)" },
    { name: "Telephony & SIP Outbound", paid: "Twilio / Telnyx Voice API", oss: "Twilio / Telnyx Voice API" },
    { name: "Calendar & Meeting Engine", paid: "Cal.com Cloud Calendar", oss: "Internal Database Calendar" },
  ];

  return (
    <div style={{ flex: 1, overflowY: "auto", background: embedded ? "transparent" : C.paper }}>
      {!embedded && (
        <TopBar
          title="AI Providers & Stack Mode"
          subtitle="Toggle between Managed Cloud APIs and Open-Source self-hosted models."
          notifications={notifications}
          setNotifications={setNotifications}
        />
      )}

      <div style={{ padding: embedded ? 0 : 32, display: "flex", flexDirection: "column", gap: 20 }}>
        
        {/* 5-Point Universal Diagnostic Scorecard */}
        <div style={{ background: "#FFFFFF", borderRadius: 16, border: `1px solid ${C.border}`, padding: 22, boxShadow: C.shadowCard }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Activity size={18} color={C.cobalt} />
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>
                  5-Point Universal Voice & Booking Diagnostics
                </span>
                {diagnosticResult && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "3px 8px",
                      borderRadius: 6,
                      background: diagnosticResult.all_passed ? "#DCFCE7" : "#FEF3C7",
                      color: diagnosticResult.all_passed ? "#15803D" : "#B45309"
                    }}
                  >
                    SCORE: {diagnosticResult.overall_score || (diagnosticResult.all_passed ? "5/5 PASS" : "ATTENTION")}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>
                Instant real-time verification of Telephony, STT, LLM Orchestration, TTS Audio, and Dual-Calendar engine.
              </div>
            </div>

            <button
              onClick={runDiagnostics}
              disabled={diagnosticsRunning}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 8,
                background: C.cobalt,
                color: "#fff",
                border: "none",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 2px 6px rgba(75,115,255,0.25)"
              }}
            >
              <RotateCcw size={13} className={diagnosticsRunning ? "animate-spin" : ""} />
              {diagnosticsRunning ? "Running Diagnostics..." : "Run Voice Diagnostics"}
            </button>
          </div>

          {diagError && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#DC2626", fontSize: 12.5, marginBottom: 14 }}>
              {diagError}
            </div>
          )}

          {diagnosticResult ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 10 }}>
              {[
                { key: "telephony", label: "1. Telephony Carrier", icon: PhoneCall, data: diagnosticResult.checks?.telephony || diagnosticResult.telephony, latency: diagnosticResult.latency_ms?.telephony },
                { key: "voice_stack", label: "2. AI Voice Plugins", icon: Cpu, data: diagnosticResult.checks?.voice_stack || diagnosticResult.voice_stack || diagnosticResult.stt, latency: diagnosticResult.latency_ms?.voice_stack },
                { key: "calendar_config", label: "3. Calendar Mode", icon: CalendarCheck, data: diagnosticResult.checks?.calendar_config || diagnosticResult.calendar_config, latency: diagnosticResult.latency_ms?.calendar_config },
                { key: "slot_availability", label: "4. Slot Availability", icon: Radio, data: diagnosticResult.checks?.slot_availability || diagnosticResult.slot_availability, latency: diagnosticResult.latency_ms?.slot_availability },
                { key: "test_booking_roundtrip", label: "5. Test Booking", icon: Activity, data: diagnosticResult.checks?.test_booking_roundtrip || diagnosticResult.test_booking_roundtrip, latency: diagnosticResult.latency_ms?.test_booking_roundtrip },
              ].map((layer) => {
                const passed = layer.data?.status === "pass";
                const isWarning = layer.data?.status === "warn";
                const Icon = layer.icon;
                const summary = layer.data?.summary || (Array.isArray(layer.data?.details) ? layer.data.details[0] : layer.data?.details) || (passed ? "Ready" : "Not configured");
                return (
                  <div
                    key={layer.key}
                    style={{
                      padding: 12,
                      borderRadius: 9,
                      border: `1px solid ${passed ? "#BBF7D0" : isWarning ? "#FDE68A" : "#FCA5A5"}`,
                      background: passed ? "#F0FDF4" : isWarning ? "#FFFBEB" : "#FEF2F2"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Icon size={13} color={passed ? "#16A34A" : isWarning ? "#D97706" : "#DC2626"} />
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: C.ink }}>{layer.label}</span>
                      </div>
                      {passed ? (
                        <CheckCircle2 size={14} color="#16A34A" />
                      ) : (
                        <AlertCircle size={14} color={isWarning ? "#D97706" : "#DC2626"} />
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: C.slate, marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={summary}>
                      {summary}
                    </div>
                    {layer.latency != null && (
                      <div style={{ fontSize: 10, fontFamily: FONT_MONO, color: C.cobalt }}>
                        Latency: {layer.latency} ms
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: 12, borderRadius: 8, background: C.paperSoft, border: `1px solid ${C.border}`, fontSize: 12, color: C.slate, textAlign: "center" }}>
              Click <strong>Run Voice Diagnostics</strong> above to test all 5 layers of your voice and booking infrastructure.
            </div>
          )}
        </div>

        {/* Stack Mode Toggle */}
        <div style={{ display: "flex", gap: 12 }}>
          <button
            type="button"
            onClick={() => setActiveMode("paid")}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: `1.5px solid ${activeMode === "paid" ? C.cobalt : C.border}`,
              background: activeMode === "paid" ? C.cobaltSoft : "#FFFFFF",
              color: activeMode === "paid" ? C.cobaltDeep : C.slate,
              fontFamily: FONT_BODY,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Paid / Managed Cloud Stack (~$0.22/call)
          </button>
          <button
            type="button"
            onClick={() => setActiveMode("oss")}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: `1.5px solid ${activeMode === "oss" ? C.teal : C.border}`,
              background: activeMode === "oss" ? C.tealSoft : "#FFFFFF",
              color: activeMode === "oss" ? C.teal : C.slate,
              fontFamily: FONT_BODY,
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Open Source / Self-Hosted Stack (~$0.03/call)
          </button>
        </div>

        {/* Infrastructure Layer Table */}
        <div style={{ background: "#FFFFFF", borderRadius: 16, border: `1px solid ${C.border}`, overflow: "hidden", boxShadow: C.shadowCard }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontFamily: FONT_BODY, fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.paperSoft, borderBottom: `1px solid ${C.border}`, color: C.slate, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <th style={{ padding: "12px 16px" }}>Infrastructure Layer</th>
                <th style={{ padding: "12px 16px" }}>Active Target Model / System</th>
              </tr>
            </thead>
            <tbody>
              {layers.map((l) => (
                <tr key={l.name} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                  <td style={{ padding: "14px 16px", fontWeight: 600, color: C.ink }}>{l.name}</td>
                  <td style={{ padding: "14px 16px", color: activeMode === "paid" ? C.cobaltDeep : C.teal, fontWeight: 600 }}>
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
