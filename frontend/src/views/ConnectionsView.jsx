import React, { useState } from "react";
import { Plug, Plus, Check, AlertTriangle, KeyRound, Settings2, Sliders, ShieldCheck, X } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { TopBar } from "../components/TopBar";

export function ConnectionsView({ notifications, setNotifications, connections = [], onAddConnection }) {
  const [showAdd, setShowAdd] = useState(false);
  const [group, setGroup] = useState("LLM");
  const [name, setName] = useState("");

  const handleAdd = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (onAddConnection) onAddConnection({ group_name: group, name: name.trim() });
    setShowAdd(false);
    setName("");
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.bg }}>
      <TopBar
        title="Connections & Integrations"
        subtitle="Manage API keys and active carrier/provider credentials across voice infrastructure layers."
        notifications={notifications}
        setNotifications={setNotifications}
      />

      <div style={{ padding: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: "#FFFFFF" }}>
            Configured Providers
          </div>
          <button
            onClick={() => setShowAdd(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, height: 38, padding: "0 16px", borderRadius: 10, border: "none", background: C.gradientPrimary, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", boxShadow: C.glowPrimary }}
          >
            <Plus size={15} /> Add Provider
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 22 }}>
          {connections.map((grp) => (
            <div key={grp.group} style={{ background: "rgba(18, 22, 41, 0.75)", backdropFilter: "blur(16px)", borderRadius: 20, border: `1px solid ${C.border}`, padding: 24, boxShadow: C.shadowCard }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: "#FFFFFF", marginBottom: 4 }}>
                {grp.group}
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginBottom: 16 }}>
                {grp.desc}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {grp.items.map((it) => (
                  <div key={it.id || it.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.borderLight}` }}>
                    <span style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: "#FFFFFF" }}>{it.name}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 5, background: it.status === "connected" ? C.tealSoft : "rgba(255,255,255,0.04)", color: it.status === "connected" ? C.teal : C.slate, border: `1px solid ${it.status === "connected" ? "rgba(0,229,195,0.3)" : C.borderLight}` }}>
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
        <div style={{ position: "fixed", inset: 0, background: "rgba(9,11,19,0.7)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
          <div style={{ width: "100%", maxWidth: 420, background: "rgba(18,22,41,0.95)", borderRadius: 20, border: `1px solid ${C.border}`, padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: "#FFFFFF" }}>Add Provider Key</div>
              <button onClick={() => setShowAdd(false)} style={{ border: "none", background: "none", cursor: "pointer", color: C.slate }}><X size={18} /></button>
            </div>
            <form onSubmit={handleAdd} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 }}>Layer</label>
                <select value={group} onChange={(e) => setGroup(e.target.value)} style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: 10 }}>
                  <option value="LLM">LLM (Reasoning & Conversation)</option>
                  <option value="Speech-to-Text">Speech-to-Text (STT)</option>
                  <option value="Text-to-Speech">Text-to-Speech (TTS)</option>
                  <option value="Voice Orchestration">Voice Orchestration</option>
                  <option value="Telephony">Telephony Carrier</option>
                  <option value="Calendar">Calendar API</option>
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 }}>Provider Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. OpenAI / ElevenLabs / Twilio" style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: 10 }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#CBD5E1", marginBottom: 6 }}>API Key</label>
                <input type="password" required placeholder="sk-••••••••••••••••" style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: 10 }} />
              </div>
              <button type="submit" style={{ height: 44, borderRadius: 11, border: "none", background: C.gradientPrimary, color: "#fff", fontWeight: 600, cursor: "pointer", marginTop: 8, boxShadow: C.glowPrimary }}>
                Connect Provider
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
