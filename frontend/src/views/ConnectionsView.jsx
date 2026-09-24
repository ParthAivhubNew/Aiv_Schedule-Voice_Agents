import React, { useState } from "react";
import {
  Plug,
  Plus,
  Check,
  AlertTriangle,
  KeyRound,
  Settings2,
  Sliders,
  ShieldCheck,
  X,
  Activity,
  CheckCircle2,
  AlertCircle,
  Radio,
  Clock,
  RotateCcw,
  Sparkles,
  PhoneCall,
  CalendarCheck,
  Cpu
} from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { TopBar } from "../components/TopBar";
import { api } from "../api/apiClient";

export function ConnectionsView({
  notifications,
  setNotifications,
  connections = [
    { group: "LLM (Reasoning & Orchestration)", desc: "Conversational intelligence and dynamic objection handling models", items: [{ name: "OpenAI", status: "connected" }, { name: "DeepSeek", status: "connected" }, { name: "xAI (Grok)", status: "connected" }] },
    { group: "Speech-to-Text (STT)", desc: "Low-latency streaming transcription and speaker diarization", items: [{ name: "Deepgram", status: "connected" }, { name: "Faster-Whisper (Self-Hosted)", status: "not_configured" }] },
    { group: "Text-to-Speech (TTS)", desc: "Realistic conversational voices", items: [{ name: "Cartesia", status: "connected" }, { name: "ElevenLabs", status: "not_configured" }] },
    { group: "Telephony & Carrier", desc: "Outbound PSTN dialing, SIP trunks, and caller ID verification", items: [{ name: "Twilio", status: "connected" }] },
    { group: "Calendar & Discovery", desc: "Automated real-time slot checking and calendar booking links", items: [{ name: "Cal.com & PostgreSQL Internal", status: "connected" }] },
  ],
  onAddConnection
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [group, setGroup] = useState("LLM");
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

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

  const handleAdd = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (onAddConnection) onAddConnection({
      group_name: group,
      name: name.trim(),
      api_key: apiKey.trim(),
      model: model.trim(),
      base_url: baseUrl.trim(),
    });
    setShowAdd(false);
    setName("");
    setModel("");
    setBaseUrl("");
    setApiKey("");
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.paper }}>
      <TopBar
        title="Connections & Integrations"
        subtitle="Manage API keys and active carrier/provider credentials across voice infrastructure layers."
        notifications={notifications}
        setNotifications={setNotifications}
      />

      <div style={{ padding: 32, maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 28 }}>
        
        {/* Universal 5-Point Diagnostic Scorecard */}
        <div style={{ background: "#FFFFFF", borderRadius: 18, border: `1px solid ${C.border}`, padding: 24, boxShadow: C.shadowCard }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Activity size={18} color={C.cobalt} />
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink }}>
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
              <div style={{ fontSize: 12.5, color: C.slate, marginTop: 4 }}>
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
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 2px 6px rgba(75,115,255,0.25)"
              }}
            >
              <RotateCcw size={13} className={diagnosticsRunning ? "animate-spin" : ""} />
              {diagnosticsRunning ? "Running 5-Point Test..." : "Run Voice Diagnostics"}
            </button>
          </div>

          {diagError && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#DC2626", fontSize: 12.5, marginBottom: 14 }}>
              {diagError}
            </div>
          )}

          {diagnosticResult ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 10 }}>
              {[
                { key: "telephony", label: "1. Telephony Carrier", icon: PhoneCall, data: diagnosticResult.telephony },
                { key: "stt", label: "2. STT Streaming", icon: Radio, data: diagnosticResult.stt },
                { key: "llm_orchestration", label: "3. LLM Orchestrator", icon: Cpu, data: diagnosticResult.llm_orchestration },
                { key: "tts", label: "4. TTS Synthesizer", icon: Activity, data: diagnosticResult.tts },
                { key: "calendar_engine", label: "5. Calendar Engine", icon: CalendarCheck, data: diagnosticResult.calendar_engine },
              ].map((layer) => {
                const passed = layer.data?.status === "pass";
                const isWarning = layer.data?.status === "warn";
                const Icon = layer.icon;
                return (
                  <div
                    key={layer.key}
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      border: `1px solid ${passed ? "#BBF7D0" : isWarning ? "#FDE68A" : "#FCA5A5"}`,
                      background: passed ? "#F0FDF4" : isWarning ? "#FFFBEB" : "#FEF2F2"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Icon size={14} color={passed ? "#16A34A" : isWarning ? "#D97706" : "#DC2626"} />
                        <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>{layer.label}</span>
                      </div>
                      {passed ? (
                        <CheckCircle2 size={15} color="#16A34A" />
                      ) : (
                        <AlertCircle size={15} color={isWarning ? "#D97706" : "#DC2626"} />
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: C.slate, marginBottom: 4 }}>
                      {layer.data?.details || "Status ok"}
                    </div>
                    {layer.data?.latency_ms != null && (
                      <div style={{ fontSize: 10, fontFamily: FONT_MONO, color: C.cobalt }}>
                        Latency: {layer.data.latency_ms} ms
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: 14, borderRadius: 8, background: C.paperSoft, border: `1px solid ${C.border}`, fontSize: 12, color: C.slate, textAlign: "center" }}>
              Click <strong>Run Voice Diagnostics</strong> above to test all 5 layers of your voice and booking infrastructure end-to-end.
            </div>
          )}
        </div>

        {/* Configured Providers Section */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink }}>
              Configured Providers
            </div>
            <button
              onClick={() => setShowAdd(true)}
              style={{ display: "flex", alignItems: "center", gap: 6, height: 38, padding: "0 16px", borderRadius: 9, border: "none", background: C.cobalt, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            >
              <Plus size={15} /> Add Provider
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 20 }}>
            {connections.map((grp) => (
              <div key={grp.group} style={{ background: "#FFFFFF", borderRadius: 18, border: `1px solid ${C.border}`, padding: 24, boxShadow: C.shadowCard }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16.5, color: C.ink, marginBottom: 4 }}>
                  {grp.group}
                </div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginBottom: 16 }}>
                  {grp.desc}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {grp.items.map((it) => (
                    <div key={it.id || it.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: 10, background: it.status === "connected" ? "#F0FDF4" : C.paperSoft, border: `1px solid ${it.status === "connected" ? "#BBF7D0" : "transparent"}` }}>
                      <div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk }}>{it.name}</div>
                        {it.model && (
                          <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.cobalt, marginTop: 2 }}>Model: {it.model}</div>
                        )}
                      </div>
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 4, background: it.status === "connected" ? C.tealSoft : C.paper, color: it.status === "connected" ? C.teal : C.slate }}>
                        {it.status === "connected" ? "CONNECTED" : "NOT CONFIGURED"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.45)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
          <div style={{ width: "100%", maxWidth: 440, background: "#FFFFFF", borderRadius: 20, border: `1px solid ${C.border}`, padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.15)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink }}>Add Provider Key & Model</div>
              <button onClick={() => setShowAdd(false)} style={{ border: "none", background: "none", cursor: "pointer", color: C.slate }}><X size={18} /></button>
            </div>
            <form onSubmit={handleAdd} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 5 }}>Layer</label>
                <select value={group} onChange={(e) => setGroup(e.target.value)} style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff" }}>
                  <option value="LLM">LLM (Reasoning & Conversation)</option>
                  <option value="Speech-to-Text">Speech-to-Text (STT)</option>
                  <option value="Text-to-Speech">Text-to-Speech (TTS)</option>
                  <option value="Voice Orchestration">Voice Orchestration</option>
                  <option value="Telephony">Telephony Carrier</option>
                  <option value="Messaging">Messaging (WhatsApp Cloud API)</option>
                  <option value="Calendar">Calendar API</option>
                  <option value="Other">Other / Custom</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 5 }}>Provider Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Deepgram, DeepSeek, Groq, Custom" style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}` }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 5 }}>API Key</label>
                <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required placeholder="sk-••••••••••••••••" style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}` }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 5 }}>
                  Model Name / Slug (Type any model)
                </label>
                <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. nova-2, deepseek-chat, gpt-4o-mini, grok-4.20-0309-non-reasoning" style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12 }} />
                <div style={{ fontSize: 11, color: C.slateLight, marginTop: 3 }}>Future-proof: You can type any model released in the future.</div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 5 }}>Custom Base URL (Optional)</label>
                <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://... or http://localhost:11434/v1" style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12 }} />
              </div>
              <button type="submit" style={{ height: 44, borderRadius: 10, border: "none", background: C.cobalt, color: "#fff", fontWeight: 600, cursor: "pointer", marginTop: 4 }}>
                Connect Provider
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
