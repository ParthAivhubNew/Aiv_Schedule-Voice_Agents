import React, { useState } from "react";
import { Plug, Plus, Check, AlertTriangle, KeyRound, Settings2, Sliders, ShieldCheck, X } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { TopBar } from "../components/TopBar";

export function ConnectionsView({ notifications, setNotifications, connections = [
  { group: "LLM (Reasoning & Orchestration)", desc: "Conversational intelligence and dynamic objection handling models", items: [{ name: "Anthropic Claude 3.5 Sonnet", status: "connected" }, { name: "OpenAI GPT-4o", status: "connected" }, { name: "DeepSeek-V3", status: "not_configured" }] },
  { group: "Speech-to-Text (STT)", desc: "Low-latency streaming transcription and speaker diarization", items: [{ name: "Deepgram Nova-2 (en-GB)", status: "connected" }, { name: "Faster-Whisper (Self-Hosted)", status: "not_configured" }] },
  { group: "Text-to-Speech (TTS)", desc: "Realistic conversational voices with British accents", items: [{ name: "ElevenLabs Turbo v2.5", status: "connected" }, { name: "Cartesia Sonic", status: "connected" }, { name: "Kokoro-82M (Self-Hosted)", status: "not_configured" }] },
  { group: "Telephony & Carrier", desc: "Outbound PSTN dialing, SIP trunks, and caller ID verification", items: [{ name: "Sipgate UK Trunk (+44 56 0002 2627)", status: "connected" }, { name: "Twilio Voice UK (+44 7307 216767)", status: "connected" }, { name: "Telnyx Elastic SIP Trunk", status: "not_configured" }] },
  { group: "Calendar & Discovery", desc: "Automated real-time slot checking and calendar booking links", items: [{ name: "Cal.com Cloud API", status: "connected" }, { name: "Google Calendar & Meet", status: "connected" }] },
], onAddConnection }) {
  const [showAdd, setShowAdd] = useState(false);
  const [group, setGroup] = useState("LLM");
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

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

      <div style={{ padding: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
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
                  <div key={it.id || it.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: 10, background: C.paperSoft }}>
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
                <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. nova-3, deepseek-chat, gpt-4o, llama-3.3-70b-versatile" style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12 }} />
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
