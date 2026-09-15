import React, { useState, useEffect } from "react";
import {
  BookOpen,
  Phone,
  ExternalLink,
  Copy,
  Check,
  CheckCircle2,
  Circle,
  AlertTriangle,
  ShieldCheck,
  Zap,
  Calendar,
  Radio,
  ArrowRight,
  Sparkles,
  Terminal,
  HelpCircle,
  Layers,
  Settings2,
  RefreshCw,
  PhoneCall,
  Lock,
  Globe,
  Headphones,
  Sliders,
  CheckSquare,
  Square,
  Search,
} from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { TopBar } from "../components/TopBar";
import { api } from "../api/apiClient";

export function TelephonyDocsView({ notifications, setNotifications, onNavigate }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [copiedKey, setCopiedKey] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [hubData, setHubData] = useState({
    activeCarrier: "Telnyx",
    activeEngine: "xAI Realtime",
    phoneNumber: "+19096866918",
    webhookUrl: "https://8000-01m1bx2zfn0zxjnf9833v44pnv.cloudspaces.litng.ai/api/sip-webhook",
    voiceName: "ara",
    silenceDurationMs: 380,
    status: "connected",
  });

  const [checklist, setChecklist] = useState(() => {
    try {
      const saved = localStorage.getItem("aivhub_setup_checklist");
      return saved
        ? JSON.parse(saved)
        : ["carrier_account", "buy_number", "webhook_config", "voice_engine"];
    } catch (_) {
      return ["carrier_account", "buy_number", "webhook_config", "voice_engine"];
    }
  });

  useEffect(() => {
    async function loadStatus() {
      try {
        const data = await api.getTelephonyHub();
        if (data) {
          setHubData((prev) => ({
            ...prev,
            ...data,
            phoneNumber: data.phoneNumber || prev.phoneNumber,
            webhookUrl: data.webhookUrl || prev.webhookUrl,
            activeCarrier: data.activeCarrier || prev.activeCarrier,
            activeEngine: data.activeEngine || prev.activeEngine,
          }));
        }
      } catch (_) {}
    }
    loadStatus();
  }, []);

  const toggleChecklist = (id) => {
    setChecklist((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem("aivhub_setup_checklist", JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  };

  const copyToClipboard = (text, key) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
      if (setNotifications) {
        setNotifications((ns) => [
          {
            id: "n_" + Date.now(),
            text: `✓ Copied to clipboard: ${text.length > 35 ? text.slice(0, 35) + "..." : text}`,
            time: "just now",
            unread: true,
            type: "success",
          },
          ...ns,
        ]);
      }
    } catch (_) {}
  };

  const CHECKLIST_ITEMS = [
    { id: "carrier_account", label: "1. Create Telnyx or Twilio Carrier Account" },
    { id: "buy_number", label: "2. Purchase Dedicated Phone Number (Voice + SMS)" },
    { id: "webhook_config", label: "3. Configure Webhook URL in Carrier Portal" },
    { id: "trunking_hub", label: "4. Enter Phone Number & Carrier Secret in AIVHub" },
    { id: "voice_engine", label: "5. Configure xAI Grok Voice or OpenAI Realtime API Key" },
    { id: "calendar_sync", label: "6. Link Cal.com for Instant In-Call Bookings" },
    { id: "live_test", label: "7. Place Inbound Test Call & Verify Live UI Banner" },
  ];

  const completedCount = checklist.length;
  const progressPct = Math.round((completedCount / CHECKLIST_ITEMS.length) * 100);

  return (
    <div style={{ flex: 1, overflowY: "auto", background: C.paper, display: "flex", flexDirection: "column" }}>
      <TopBar
        title="Telephony & Connections Setup Guide"
        subtitle="Step-by-step documentation for acquiring a phone number, configuring SIP webhooks, connecting AI voice engines, and testing live calls."
        notifications={notifications}
        setNotifications={setNotifications}
      />

      <div style={{ padding: "24px 32px", maxWidth: 1200, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        {/* Top Action Bar & Live Snapshot Card */}
        <div
          style={{
            background: "linear-gradient(135deg, #0F172A 0%, #1E1B4B 100%)",
            borderRadius: 16,
            border: "1px solid #4338CA",
            color: "#fff",
            padding: "24px 28px",
            marginBottom: 24,
            boxShadow: "0 10px 30px rgba(15, 23, 42, 0.25)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 12,
                  background: "linear-gradient(135deg, #6366F1, #3B82F6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 0 16px rgba(99, 102, 241, 0.4)",
                }}
              >
                <BookOpen size={24} color="#fff" />
              </div>
              <div>
                <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 700, margin: 0, color: "#fff" }}>
                  AIVHub Telephony & Inbound Connection Hub
                </h2>
                <div style={{ fontSize: 13, color: "#C7D2FE", marginTop: 3 }}>
                  Everything you need to get your AI Voice Agent live with a real phone number.
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => onNavigate && onNavigate("provider")}
                style={{
                  background: "linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 16px",
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  boxShadow: "0 4px 14px rgba(99, 102, 241, 0.35)",
                }}
              >
                <Zap size={15} />
                Open Telephony Trunking Hub &rarr;
              </button>
              <button
                onClick={() => onNavigate && onNavigate("live")}
                style={{
                  background: "rgba(255, 255, 255, 0.1)",
                  color: "#E2E8F0",
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  borderRadius: 8,
                  padding: "9px 16px",
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Radio size={15} color="#34D399" />
                Live Call Monitor
              </button>
            </div>
          </div>

          {/* Quick Diagnostics Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, paddingTop: 16, borderTop: "1px solid rgba(255, 255, 255, 0.12)" }}>
            <div style={{ background: "rgba(255, 255, 255, 0.05)", borderRadius: 10, padding: "12px 16px", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
              <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Dedicated Phone Number</div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 16, fontWeight: 700, color: "#38BDF8", marginTop: 4 }}>
                {hubData.phoneNumber || "Not Configured"}
              </div>
            </div>

            <div style={{ background: "rgba(255, 255, 255, 0.05)", borderRadius: 10, padding: "12px 16px", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
              <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Active Carrier Trunk</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#34D399", marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#34D399", display: "inline-block" }} />
                {hubData.activeCarrier || "Telnyx"}
              </div>
            </div>

            <div style={{ background: "rgba(255, 255, 255, 0.05)", borderRadius: 10, padding: "12px 16px", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
              <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Voice Engine & Persona</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#FCD34D", marginTop: 4 }}>
                {hubData.activeEngine || "xAI Realtime"} ({hubData.voiceName || "ara"} · {hubData.silenceDurationMs || 380}ms VAD)
              </div>
            </div>

            <div style={{ background: "rgba(255, 255, 255, 0.05)", borderRadius: 10, padding: "12px 16px", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
              <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Carrier Webhook URL</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: "#E2E8F0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
                  {hubData.webhookUrl}
                </span>
                <button
                  onClick={() => copyToClipboard(hubData.webhookUrl, "top_webhook")}
                  style={{
                    background: "rgba(255, 255, 255, 0.15)",
                    border: "none",
                    borderRadius: 6,
                    padding: "3px 8px",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                  title="Copy Webhook URL"
                >
                  {copiedKey === "top_webhook" ? <Check size={12} color="#34D399" /> : <Copy size={12} />}
                  {copiedKey === "top_webhook" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Interactive Setup Progress & Checklist */}
        <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: "20px 24px", marginBottom: 24, boxShadow: C.shadowCard }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
            <div>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.textInk }}>
                Setup Checklist & Progress
              </span>
              <span style={{ fontSize: 13, color: C.slate, marginLeft: 10 }}>
                ({completedCount} of {CHECKLIST_ITEMS.length} completed · {progressPct}%)
              </span>
            </div>
            <div style={{ width: 220, height: 8, background: "#E2E8F0", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${progressPct}%`, height: "100%", background: "linear-gradient(90deg, #10B981, #059669)", borderRadius: 999, transition: "width 0.3s ease" }} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {CHECKLIST_ITEMS.map((item) => {
              const isChecked = checklist.includes(item.id);
              return (
                <div
                  key={item.id}
                  onClick={() => toggleChecklist(item.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                    border: `1px solid ${isChecked ? "#A7F3D0" : C.border}`,
                    background: isChecked ? "#ECFDF5" : "#F8FAFC",
                    transition: "all 0.15s ease",
                  }}
                >
                  {isChecked ? (
                    <CheckCircle2 size={18} color="#059669" />
                  ) : (
                    <Circle size={18} color="#94A3B8" />
                  )}
                  <span
                    style={{
                      fontFamily: FONT_BODY,
                      fontSize: 13,
                      fontWeight: isChecked ? 600 : 500,
                      color: isChecked ? "#065F46" : C.textInk,
                      textDecoration: isChecked ? "line-through" : "none",
                    }}
                  >
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Documentation Navigation Tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {[
            { id: "overview", label: "🗺️ Overview & Architecture" },
            { id: "telnyx", label: "📞 Telnyx Walkthrough (Recommended)" },
            { id: "twilio", label: "🔴 Twilio Walkthrough (Alternative)" },
            { id: "voice-ai", label: "🧠 Voice AI & Persona (xAI / OpenAI)" },
            { id: "calendar", label: "📅 Cal.com & Calendar Booking" },
            { id: "troubleshooting", label: "❓ Troubleshooting & Carrier FAQs" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "9px 18px",
                borderRadius: 8,
                border: `1px solid ${activeTab === tab.id ? C.ink : C.border}`,
                background: activeTab === tab.id ? C.ink : "#fff",
                color: activeTab === tab.id ? "#fff" : C.slate,
                fontFamily: FONT_BODY,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* TAB 1: Overview & Architecture */}
        {activeTab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: "26px 30px", boxShadow: C.shadowCard }}>
              <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, margin: "0 0 10px 0", color: C.textInk }}>
                How AIVHub Voice Inbound Telephony Works
              </h3>
              <p style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.slate, lineHeight: 1.6, margin: "0 0 20px 0" }}>
                AIVHub transforms standard carrier phone calls into real-time conversational AI dialogue. When an external customer or lead dials your dedicated business phone number, the carrier sends an HTTP webhook into our server, which instantly opens a bi-directional audio stream with the AI voice engine.
              </p>

              {/* Visual Flow Diagram */}
              <div style={{ background: "#0F172A", borderRadius: 12, padding: "24px 20px", color: "#fff", marginBottom: 24 }}>
                <div style={{ fontSize: 12, color: "#818CF8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14, textAlign: "center" }}>
                  End-to-End Inbound Call Lifecycle Flow
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, textAlign: "center" }}>
                  <div style={{ flex: 1, minWidth: 140, background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 12, border: "1px solid rgba(255,255,255,0.1)" }}>
                    <div style={{ fontSize: 20 }}>📱</div>
                    <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4, color: "#F8FAFC" }}>1. Client Dials</div>
                    <div style={{ fontSize: 11, color: "#94A3B8" }}>Calls your dedicated E.164 number</div>
                  </div>

                  <div style={{ color: "#6366F1", fontSize: 18, fontWeight: 800 }}>&rarr;</div>

                  <div style={{ flex: 1, minWidth: 140, background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 12, border: "1px solid rgba(255,255,255,0.1)" }}>
                    <div style={{ fontSize: 20 }}>📡</div>
                    <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4, color: "#34D399" }}>2. Telnyx / Twilio</div>
                    <div style={{ fontSize: 11, color: "#94A3B8" }}>Dispatches Webhook HTTP POST</div>
                  </div>

                  <div style={{ color: "#6366F1", fontSize: 18, fontWeight: 800 }}>&rarr;</div>

                  <div style={{ flex: 1, minWidth: 140, background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 12, border: "1px solid rgba(255,255,255,0.1)" }}>
                    <div style={{ fontSize: 20 }}>⚡</div>
                    <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4, color: "#818CF8" }}>3. AIVHub Server</div>
                    <div style={{ fontSize: 11, color: "#94A3B8" }}>Answers in &lt;50ms, initiates SIP audio</div>
                  </div>

                  <div style={{ color: "#6366F1", fontSize: 18, fontWeight: 800 }}>&rarr;</div>

                  <div style={{ flex: 1, minWidth: 140, background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 12, border: "1px solid rgba(255,255,255,0.1)" }}>
                    <div style={{ fontSize: 20 }}>🎙️</div>
                    <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4, color: "#FCD34D" }}>4. xAI Voice AI</div>
                    <div style={{ fontSize: 11, color: "#94A3B8" }}>Converses in real-time (Ara voice)</div>
                  </div>

                  <div style={{ color: "#6366F1", fontSize: 18, fontWeight: 800 }}>&rarr;</div>

                  <div style={{ flex: 1, minWidth: 140, background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 12, border: "1px solid rgba(255,255,255,0.1)" }}>
                    <div style={{ fontSize: 20 }}>🖥️</div>
                    <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4, color: "#38BDF8" }}>5. Live UI Toast</div>
                    <div style={{ fontSize: 11, color: "#94A3B8" }}>One-click operator takeover</div>
                  </div>
                </div>
              </div>

              {/* Essential Prerequisite Checklist */}
              <h4 style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700, margin: "0 0 12px 0", color: C.textInk }}>
                What You Need Before You Start
              </h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, background: "#F8FAFC" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, color: C.textInk, marginBottom: 6 }}>
                    <Phone size={16} color="#2563EB" />
                    1. Telephony Carrier Account
                  </div>
                  <p style={{ fontSize: 13, color: C.slate, margin: 0, lineHeight: 1.5 }}>
                    Either <strong>Telnyx</strong> (recommended for direct SIP trunking, &lt;380ms response time) or <strong>Twilio</strong>. You will purchase 1 phone number (~$1.00/mo).
                  </p>
                </div>

                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, background: "#F8FAFC" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, color: C.textInk, marginBottom: 6 }}>
                    <Sparkles size={16} color="#7C3AED" />
                    2. AI Voice Provider Key
                  </div>
                  <p style={{ fontSize: 13, color: C.slate, margin: 0, lineHeight: 1.5 }}>
                    An API key from <strong>xAI (Grok Voice)</strong> or <strong>OpenAI (Realtime API)</strong> to drive the natural spoken voice persona and knowledge intelligence.
                  </p>
                </div>

                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, background: "#F8FAFC" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, color: C.textInk, marginBottom: 6 }}>
                    <Calendar size={16} color="#059669" />
                    3. Booking Calendar (Optional)
                  </div>
                  <p style={{ fontSize: 13, color: C.slate, margin: 0, lineHeight: 1.5 }}>
                    A free <strong>Cal.com</strong> account + API key so the Voice AI can seamlessly schedule appointments directly into your Google or Outlook calendar during calls.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Telnyx Walkthrough */}
        {activeTab === "telnyx" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: "26px 30px", boxShadow: C.shadowCard }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <span style={{ background: "#DBEAFE", color: "#1E40AF", fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 6, textTransform: "uppercase" }}>
                    Recommended Carrier
                  </span>
                  <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700, margin: "8px 0 4px 0", color: C.textInk }}>
                    Telnyx Call Control & SIP Trunking Setup
                  </h3>
                  <p style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.slate, margin: 0 }}>
                    Follow these 5 exact steps in your Telnyx Mission Control Portal to activate low-latency voice trunking.
                  </p>
                </div>
                <a
                  href="https://portal.telnyx.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#2563EB",
                    color: "#fff",
                    textDecoration: "none",
                    borderRadius: 8,
                    padding: "9px 15px",
                    fontFamily: FONT_BODY,
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  Open Telnyx Portal
                  <ExternalLink size={14} />
                </a>
              </div>

              {/* Steps List */}
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {/* Step 1 */}
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, background: "#F8FAFC" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#2563EB", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>1</span>
                    <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.textInk }}>
                      Buy a Dedicated Phone Number
                    </span>
                  </div>
                  <ol style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: "#334155", margin: "0 0 10px 24px", lineHeight: 1.6 }}>
                    <li>Log into your <strong>Telnyx Portal</strong>.</li>
                    <li>In the left menu, click <strong>Numbers &rarr; Search & Buy Numbers</strong>.</li>
                    <li>Select <strong>Country</strong> (e.g., <em>United States +1</em>) and check features: <strong>Voice</strong> and <strong>SMS</strong>.</li>
                    <li>Search for your preferred Area Code or City, pick an available number, and click <strong>Buy</strong> (~$1.00/month).</li>
                    <li>Once purchased, copy your new number in E.164 format (e.g. <code>+19096866918</code>).</li>
                  </ol>
                </div>

                {/* Step 2 */}
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, background: "#F8FAFC" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#2563EB", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>2</span>
                    <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.textInk }}>
                      Create a Call Control / Webhook Application
                    </span>
                  </div>
                  <ol style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: "#334155", margin: "0 0 12px 24px", lineHeight: 1.6 }}>
                    <li>In the Telnyx left menu, go to <strong>Voice &rarr; Call Control / TeXML Applications</strong>.</li>
                    <li>Click <strong>Add New Application</strong>.</li>
                    <li>Set Application Name to: <strong>AIVHub Voice AI Operator</strong>.</li>
                    <li>Under <strong>Webhook API Version</strong>, choose <strong>API v2</strong>.</li>
                    <li>In the <strong>Webhook URL</strong> field, paste your AIVHub server webhook URL:</li>
                  </ol>

                  {/* Webhook Copy Box */}
                  <div style={{ background: "#0F172A", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "0 0 12px 24px" }}>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 12.5, color: "#38BDF8", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {hubData.webhookUrl}
                    </span>
                    <button
                      onClick={() => copyToClipboard(hubData.webhookUrl, "telnyx_webhook")}
                      style={{
                        background: "#4F46E5",
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        padding: "5px 12px",
                        fontFamily: FONT_BODY,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexShrink: 0,
                      }}
                    >
                      {copiedKey === "telnyx_webhook" ? <Check size={13} /> : <Copy size={13} />}
                      {copiedKey === "telnyx_webhook" ? "Copied!" : "Copy URL"}
                    </button>
                  </div>
                </div>

                {/* Step 3 */}
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, background: "#F8FAFC" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#2563EB", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>3</span>
                    <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.textInk }}>
                      Assign the Number to the Call Control Application
                    </span>
                  </div>
                  <p style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: "#334155", margin: "0 0 0 24px", lineHeight: 1.6 }}>
                    In the same Call Control Application view, scroll down to the <strong>Numbers</strong> section. Search for the phone number you purchased in Step 1 and select it to link it to this webhook app. Click <strong>Save Application</strong>.
                  </p>
                </div>

                {/* Step 4 */}
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, background: "#F8FAFC" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#2563EB", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>4</span>
                    <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.textInk }}>
                      Copy Credentials into AIVHub Telephony Hub
                    </span>
                  </div>
                  <ol style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: "#334155", margin: "0 0 12px 24px", lineHeight: 1.6 }}>
                    <li>In Telnyx Portal, go to <strong>Account Settings &rarr; Keys & Credentials</strong> and copy your <strong>API V2 Key</strong>.</li>
                    <li>In the Call Control Application you just created, copy the <strong>Webhook Signing Secret</strong>.</li>
                    <li>In AIVHub, click the button below to open the Trunking Hub, choose <strong>Telnyx</strong>, enter your number and keys, and click <strong>Save & Connect</strong>.</li>
                  </ol>

                  <div style={{ margin: "0 0 0 24px" }}>
                    <button
                      onClick={() => onNavigate && onNavigate("provider")}
                      style={{
                        background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
                        color: "#fff",
                        border: "none",
                        borderRadius: 8,
                        padding: "8px 16px",
                        fontFamily: FONT_BODY,
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      ⚡ Open Connections & Providers &rarr;
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: Twilio Walkthrough */}
        {activeTab === "twilio" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: "26px 30px", boxShadow: C.shadowCard }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <span style={{ background: "#FEE2E2", color: "#B91C1C", fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 6, textTransform: "uppercase" }}>
                    Alternative Carrier
                  </span>
                  <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700, margin: "8px 0 4px 0", color: C.textInk }}>
                    Twilio Voice Webhook Setup
                  </h3>
                  <p style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.slate, margin: 0 }}>
                    If you prefer Twilio or already own a Twilio phone number, follow these steps to route inbound calls to AIVHub.
                  </p>
                </div>
                <a
                  href="https://console.twilio.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#E11D48",
                    color: "#fff",
                    textDecoration: "none",
                    borderRadius: 8,
                    padding: "9px 15px",
                    fontFamily: FONT_BODY,
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  Open Twilio Console
                  <ExternalLink size={14} />
                </a>
              </div>

              {/* Steps List */}
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, background: "#F8FAFC" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#E11D48", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>1</span>
                    <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.textInk }}>
                      Buy a Twilio Number
                    </span>
                  </div>
                  <ol style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: "#334155", margin: "0 0 10px 24px", lineHeight: 1.6 }}>
                    <li>Log into your <strong>Twilio Console</strong>.</li>
                    <li>Go to <strong>Phone Numbers &rarr; Manage &rarr; Buy a number</strong>.</li>
                    <li>Check the <strong>Voice</strong> box and search for your area code. Buy the number (~$1.15/month).</li>
                  </ol>
                </div>

                <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, background: "#F8FAFC" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#E11D48", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>2</span>
                    <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.textInk }}>
                      Configure Inbound Voice Webhook
                    </span>
                  </div>
                  <ol style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: "#334155", margin: "0 0 12px 24px", lineHeight: 1.6 }}>
                    <li>Go to <strong>Phone Numbers &rarr; Manage &rarr; Active numbers</strong> and click your purchased number.</li>
                    <li>Scroll down to the <strong>Voice Configuration</strong> section.</li>
                    <li>Under <strong>A CALL COMES IN</strong>, select <strong>Webhook</strong>.</li>
                    <li>Set the URL to: <code>https://&lt;your-server-domain&gt;/twilio/voice</code></li>
                    <li>Set HTTP Method to <strong>HTTP POST</strong>.</li>
                    <li>Click <strong>Save configuration</strong> at the bottom.</li>
                  </ol>
                </div>

                <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, background: "#F8FAFC" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#E11D48", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>3</span>
                    <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.textInk }}>
                      Connect Account SID & Auth Token
                    </span>
                  </div>
                  <p style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: "#334155", margin: "0 0 12px 24px", lineHeight: 1.6 }}>
                    From your Twilio Console home dashboard, copy your <strong>Account SID</strong> and <strong>Auth Token</strong>. Open the AIVHub Connections & Providers view, select <strong>Twilio</strong>, and save your credentials.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: Voice AI & Persona */}
        {activeTab === "voice-ai" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: "26px 30px", boxShadow: C.shadowCard }}>
              <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700, margin: "0 0 6px 0", color: C.textInk }}>
                AI Voice Intelligence & Natural Flow Tuning
              </h3>
              <p style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.slate, margin: "0 0 20px 0" }}>
                AIVHub uses real-time spoken language models to provide ultra-low latency, human-sounding phone conversations with verbal nods and instant turn-taking.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginBottom: 24 }}>
                {/* Voice Persona Card */}
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, background: "#F8FAFC" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#6366F1", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                    Voice Personas (xAI Grok)
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid #E2E8F0" }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: "#0F172A" }}>🎙️ Ara (Default)</div>
                      <div style={{ fontSize: 12, color: "#64748B" }}>Warm, confident, conversational female voice. Optimized for customer discovery and sales qualification.</div>
                    </div>
                    <div style={{ padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid #E2E8F0" }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: "#0F172A" }}>🎙️ Eve</div>
                      <div style={{ fontSize: 12, color: "#64748B" }}>Lively, upbeat, energetic female tone. Excellent for high-energy tech and customer support.</div>
                    </div>
                    <div style={{ padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid #E2E8F0" }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: "#0F172A" }}>🎙️ Sal</div>
                      <div style={{ fontSize: 12, color: "#64748B" }}>Grounded, calm, authoritative male voice. Best for consulting, legal, and financial services.</div>
                    </div>
                  </div>
                </div>

                {/* Turn-Taking & Latency Tuning */}
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, background: "#F8FAFC" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#059669", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                    Turn-Taking Silence Duration (VAD)
                  </div>
                  <p style={{ fontSize: 13, color: "#334155", lineHeight: 1.5, margin: "0 0 12px 0" }}>
                    Voice Activity Detection (VAD) silence duration determines how many milliseconds the AI waits after the caller stops speaking before it responds:
                  </p>
                  <ul style={{ fontSize: 12.5, color: "#475569", margin: "0 0 14px 20px", lineHeight: 1.6 }}>
                    <li><strong>380ms (Recommended)</strong>: Natural conversational cadence. Fast and responsive without interrupting sentences.</li>
                    <li><strong>320ms (Ultra-Snappy)</strong>: Instant replies for high-paced rapid dialogues.</li>
                    <li><strong>500ms (Relaxed)</strong>: Allows callers to pause or think between words.</li>
                  </ul>
                  <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#92400E" }}>
                    💡 <em>Tip: You can adjust this anytime in the Telephony Trunking Hub with the VAD Silence Slider.</em>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: Calendar & Booking */}
        {activeTab === "calendar" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: "26px 30px", boxShadow: C.shadowCard }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700, margin: "0 0 4px 0", color: C.textInk }}>
                    Cal.com & Meeting Booking Integration
                  </h3>
                  <p style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.slate, margin: 0 }}>
                    Allow callers to book discovery meetings and demos directly on the phone call.
                  </p>
                </div>
                <a
                  href="https://cal.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#0F172A",
                    color: "#fff",
                    textDecoration: "none",
                    borderRadius: 8,
                    padding: "9px 15px",
                    fontFamily: FONT_BODY,
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  Open Cal.com
                  <ExternalLink size={14} />
                </a>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, background: "#F8FAFC" }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: C.textInk, marginBottom: 6 }}>1. Get Cal.com API Key</div>
                  <p style={{ fontSize: 13, color: C.slate, margin: 0, lineHeight: 1.5 }}>
                    In your Cal.com dashboard, navigate to <strong>Settings &rarr; Developer &rarr; API Keys</strong>. Click <em>Add New Key</em>, name it <code>AIVHub Agent</code>, and copy the generated token.
                  </p>
                </div>

                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, background: "#F8FAFC" }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: C.textInk, marginBottom: 6 }}>2. Enter API Key in AIVHub</div>
                  <p style={{ fontSize: 13, color: C.slate, margin: 0, lineHeight: 1.5 }}>
                    Open the <strong>Cal.com Booking Hub</strong> or <strong>Communication Accounts</strong> modal. Paste your API key and set your target event slug (e.g. <code>15min</code> or <code>discovery-call</code>).
                  </p>
                </div>

                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, background: "#F8FAFC" }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: C.textInk, marginBottom: 6 }}>3. Automatic In-Call Booking Execution</div>
                  <p style={{ fontSize: 13, color: C.slate, margin: 0, lineHeight: 1.5 }}>
                    During live phone calls, when a caller agrees to meet (e.g. <em>"Yes, Thursday at 2 PM works for me"</em>), the AI instantly checks real-time slot availability, books the calendar event, and automatically emails the caller a Google Meet / Zoom confirmation!
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: Troubleshooting & FAQs */}
        {activeTab === "troubleshooting" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: "26px 30px", boxShadow: C.shadowCard }}>
              <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700, margin: "0 0 16px 0", color: C.textInk }}>
                Frequently Asked Questions & Diagnostics
              </h3>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, color: "#0F172A", marginBottom: 6 }}>
                    ❓ Why did the phone ring 2 or 3 times before the AI picked up?
                  </div>
                  <p style={{ fontSize: 13, color: C.slate, margin: 0, lineHeight: 1.6 }}>
                    In PSTN telecommunications, standard cellular carrier networks (AT&T, Verizon, T-Mobile, Vodafone) take approximately 1.5 to 2.5 seconds to route cellular radio signals to the Telnyx/Twilio data center. As soon as the carrier dispatches the webhook to our server, AIVHub answers the call in under <strong>50 milliseconds</strong>.
                  </p>
                </div>

                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, color: "#0F172A", marginBottom: 6 }}>
                    ❓ Does the incoming call banner appear even if I am working in another plugin?
                  </div>
                  <p style={{ fontSize: 13, color: C.slate, margin: 0, lineHeight: 1.6 }}>
                    <strong>Yes!</strong> AIVHub has a root-level universal listener. Whether you are typing a post in the <em>Post Scheduler</em>, searching filters in <em>Lead Gen</em>, or scheduling in <em>Cal.com</em>, a floating incoming call card appears at the top right with audio chime and caller details. Clicking <strong>Jump to Call & Take Over</strong> preserves 100% of your unsaved work in that plugin.
                  </p>
                </div>

                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, color: "#0F172A", marginBottom: 6 }}>
                    ❓ What should I do if the carrier says "Webhook returned HTTP 404 or 502"?
                  </div>
                  <p style={{ fontSize: 13, color: C.slate, margin: 0, lineHeight: 1.6 }}>
                    Ensure your backend server is running and accessible over public HTTPS. In cloud environments like Lightning AI Studio, make sure port 8000 is exposed or use your live domain. You can verify your webhook endpoint by clicking the <strong>⚡ Run Telephony Carrier Ping</strong> button in the Telephony Trunking Hub.
                  </p>
                </div>

                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, color: "#0F172A", marginBottom: 6 }}>
                    ❓ How do I speak directly with the caller if I want to intervene?
                  </div>
                  <p style={{ fontSize: 13, color: C.slate, margin: 0, lineHeight: 1.6 }}>
                    When a call is live, jump to the <strong>Live Activity</strong> view and click <strong>Take Over</strong>. Your browser microphone will immediately bridge into the audio stream while the AI gracefully steps back.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
