import React, { useState, useEffect, useCallback } from "react";
import {
  FileText,
  PhoneCall,
  PhoneIncoming,
  Sparkles,
  Save,
  RotateCcw,
  Plus,
  Trash2,
  Copy,
  Check,
  Eye,
  Sliders,
  ShieldAlert,
  HelpCircle,
  Clock,
  User,
  Building,
  Mail,
  Phone,
  Globe,
  Tag,
  CheckCircle2,
  ChevronRight,
  AlertCircle
} from "lucide-react";
import { TopBar } from "../components/TopBar";
import { BookingPolicyEditor } from "../components/BookingPolicyEditor";
import { C, FONT_BODY, FONT_DISPLAY, FONT_MONO } from "../tokens";
import { api } from "../api/apiClient";

const DEFAULT_OBJECTIONS = [
  { key: "not_interested", label: "Not Interested", defaultText: "I completely respect that, {{prospect_name}}. Before I go, can I ask if your main priority right now is reducing call handling time, or is your schedule completely booked up?" },
  { key: "send_info", label: "Send Info / Email", defaultText: "I'd be glad to send our 2-page brief to {{prospect_email}}. What specific workflow challenge should I ensure is highlighted in the PDF?" },
  { key: "too_busy", label: "Too Busy / Bad Timing", defaultText: "Understood! When would be a better 2-minute window to reconnect—would later this afternoon or tomorrow morning work better for you?" },
  { key: "already_have_solution", label: "Already Have a Solution", defaultText: "That makes total sense. Many of our current clients also had existing systems before seeing how our AI schedules 24/7 with zero human intervention. Would a brief 10-minute comparison be worth a look?" }
];

const VARIABLE_TAGS = [
  { tag: "{{prospect_name}}", desc: "Prospect's Full/First Name" },
  { tag: "{{company_name}}", desc: "Your Organization's Name" },
  { tag: "{{caller_name}}", desc: "AI Agent Persona Name" },
  { tag: "{{prospect_company}}", desc: "Prospect's Company Name" },
  { tag: "{{prospect_email}}", desc: "Prospect's Email Address" },
  { tag: "{{prospect_phone}}", desc: "Prospect's Phone Number" },
  { tag: "{{timezone}}", desc: "Validated IANA Timezone" },
  { tag: "{{meeting_time}}", desc: "Agreed Meeting Time Slot" },
  { tag: "{{value_prop}}", desc: "Mission/Company Value Prop" },
  { tag: "{{industry_phrase}}", desc: "Prospect Industry Context" },
  { tag: "{{today}}", desc: "Current Date Formatted" }
];

export function ConversationTemplatesView({ notifications, setNotifications, embedded = false }) {
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);
  const [activeTab, setActiveTab] = useState("editor"); // 'editor' | 'preview' | 'variables'
  const [filterDirection, setFilterDirection] = useState("all"); // 'all' | 'outbound' | 'inbound'
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const [copiedTag, setCopiedTag] = useState(null);

  // Template Form State
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    call_direction: "outbound",
    mission_type: "demo",
    greeting_template: "",
    permission_check_template: "",
    value_prop_template: "",
    objection_responses: {},
    booking_transition_template: "",
    confirmation_template: "",
    closing_template: "",
    custom_rules: "",
    demo_script: "",
    agent_persona: "professional, warm, and highly efficient voice specialist",
    tone_instructions: "Speak in natural, concise conversational bursts. Never use robotic monologue.",
    max_objection_attempts: 3,
    is_active: true,
    is_default: false
  });

  // Live Preview State — fixed sample lead; the preview otherwise renders your real
  // company profile and real booking policy, so this is just placeholder prospect data.
  const previewData = {
    prospect_name: "Sarah Jenkins",
    prospect_company: "Apex Retail Group",
    prospect_email: "sarah@apexretail.com",
    prospect_phone: "+447307216767",
    prospect_timezone: "Europe/London",
  };
  const [previewScenario, setPreviewScenario] = useState("full");
  const [renderedPreview, setRenderedPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Booking & Call Rules (shared across every engine — one CalcomSetting row, not per-template)
  const [bookingPolicy, setBookingPolicy] = useState(null);
  const [calSettingsBase, setCalSettingsBase] = useState(null);
  const [bookingDirty, setBookingDirty] = useState(false);
  const [bookingSaving, setBookingSaving] = useState(false);
  const [bookingSaveStatus, setBookingSaveStatus] = useState(null);

  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getConversationTemplates();
      if (Array.isArray(data)) {
        setTemplates(data);
        if (data.length > 0 && !selectedTemplateId) {
          setSelectedTemplateId(data[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to fetch templates:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedTemplateId]);

  const loadTemplateDetail = useCallback(async (id) => {
    if (!id) return;
    try {
      const data = await api.getConversationTemplate(id);
      setFormData({
        name: data.name || "",
        description: data.description || "",
        call_direction: data.call_direction || "outbound",
        mission_type: data.mission_type || "demo",
        greeting_template: data.greeting_template || "",
        permission_check_template: data.permission_check_template || "",
        value_prop_template: data.value_prop_template || "",
        objection_responses: data.objection_responses || {},
        booking_transition_template: data.booking_transition_template || "",
        confirmation_template: data.confirmation_template || "",
        closing_template: data.closing_template || "",
        custom_rules: data.custom_rules || "",
        demo_script: data.demo_script || "",
        agent_persona: data.agent_persona || "professional, warm, and highly efficient voice specialist",
        tone_instructions: data.tone_instructions || "",
        max_objection_attempts: data.max_objection_attempts || 3,
        is_active: data.is_active ?? true,
        is_default: data.is_default ?? false
      });
    } catch (err) {
      console.error("Failed to load template detail:", err);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
    api.getCalcomSettings()
      .then((s) => {
        if (!s) return;
        setCalSettingsBase(s);
        setBookingPolicy(s.booking_policy || {});
      })
      .catch(() => {});
  }, [loadTemplates]);

  const setBookingPolicyDirty = (next) => {
    setBookingDirty(true);
    setBookingPolicy(next);
  };

  const handleSaveBookingPolicy = async () => {
    if (!calSettingsBase || bookingPolicy == null) return;
    setBookingSaving(true);
    setBookingSaveStatus(null);
    try {
      const payload = { ...calSettingsBase, booking_policy: bookingPolicy || {} };
      const savedCal = await api.saveCalcomSettings(payload);
      setCalSettingsBase(savedCal || payload);
      setBookingPolicy((savedCal || payload).booking_policy || bookingPolicy);
      setBookingDirty(false);
      setBookingSaveStatus({ type: "success", text: "Booking & call rules saved — used on every engine." });
    } catch (err) {
      console.error("Failed to save booking policy:", err);
      setBookingSaveStatus({ type: "error", text: "Failed to save. Please try again." });
    } finally {
      setBookingSaving(false);
    }
  };

  useEffect(() => {
    if (selectedTemplateId) {
      loadTemplateDetail(selectedTemplateId);
    }
  }, [selectedTemplateId, loadTemplateDetail]);

  const handleSave = async () => {
    try {
      setSaving(true);
      if (selectedTemplateId) {
        await api.updateConversationTemplate(selectedTemplateId, formData);
        setStatusMsg({ type: "success", text: "Template saved successfully!" });
      }
      await loadTemplates();
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err) {
      setStatusMsg({ type: "error", text: `Failed to save: ${err.message || err}` });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateNew = async () => {
    const isOutbound = filterDirection !== "inbound";
    const newName = `Custom ${isOutbound ? "Outbound" : "Inbound"} Flow (${new Date().toLocaleDateString()})`;
    try {
      setSaving(true);
      const res = await api.createConversationTemplate({
        ...formData,
        name: newName,
        call_direction: isOutbound ? "outbound" : "inbound",
        is_default: false
      });
      if (res.template_id) {
        await loadTemplates();
        setSelectedTemplateId(res.template_id);
        setStatusMsg({ type: "success", text: "Created new template!" });
        setTimeout(() => setStatusMsg(null), 3000);
      }
    } catch (err) {
      setStatusMsg({ type: "error", text: `Failed to create template: ${err.message || err}` });
    } finally {
      setSaving(false);
    }
  };

  const runPreview = useCallback(async () => {
    if (!selectedTemplateId) return;
    try {
      setPreviewLoading(true);
      let payload = { ...previewData };
      if (previewScenario === "partial") {
        payload = { prospect_name: previewData.prospect_name, prospect_phone: previewData.prospect_phone };
      } else if (previewScenario === "direct") {
        payload = { prospect_phone: previewData.prospect_phone };
      } else if (previewScenario === "inbound") {
        payload = {};
      }
      const res = await api.previewConversationTemplate(selectedTemplateId, payload);
      setRenderedPreview(res.rendered_prompt || "");
    } catch (err) {
      console.error("Preview error:", err);
    } finally {
      setPreviewLoading(false);
    }
  }, [selectedTemplateId, previewData, previewScenario]);

  useEffect(() => {
    if (activeTab === "preview" && selectedTemplateId) {
      runPreview();
    }
  }, [activeTab, selectedTemplateId, previewScenario, runPreview]);

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedTag(text);
    setTimeout(() => setCopiedTag(null), 2000);
  };

  const filteredTemplates = templates.filter(t => {
    if (filterDirection === "outbound") return t.call_direction === "outbound";
    if (filterDirection === "inbound") return t.call_direction === "inbound";
    return true;
  });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: embedded ? "100%" : "100vh", minHeight: 0, overflow: "hidden", background: C.paper }}>
      {!embedded && (
        <TopBar
          title="AI Voice Conversation Templates"
          subtitle="Configure dynamic multi-stage prompts, value propositions, and smart objection handling for Outbound & Inbound calls."
          notifications={notifications}
          setNotifications={setNotifications}
        />
      )}

      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        {/* Left Sidebar: Template Directory */}
        <div style={{ width: 320, minWidth: 320, borderRight: `1px solid ${C.border}`, background: "#FFFFFF", display: "flex", flexDirection: "column" }}>
          {/* Header & Filter Controls */}
          <div style={{ padding: "18px 20px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>Templates</span>
              <button
                onClick={handleCreateNew}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "5px 10px",
                  borderRadius: 7,
                  background: C.cobalt,
                  color: "#fff",
                  border: "none",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                <Plus size={13} /> New
              </button>
            </div>

            {/* Direction Filter Tabs */}
            <div style={{ display: "flex", background: C.paperSoft, padding: 3, borderRadius: 8 }}>
              {["all", "outbound", "inbound"].map((dir) => (
                <button
                  key={dir}
                  onClick={() => setFilterDirection(dir)}
                  style={{
                    flex: 1,
                    padding: "5px 0",
                    border: "none",
                    borderRadius: 6,
                    background: filterDirection === dir ? "#fff" : "transparent",
                    color: filterDirection === dir ? C.ink : C.slate,
                    fontFamily: FONT_BODY,
                    fontSize: 11.5,
                    fontWeight: 600,
                    textTransform: "capitalize",
                    cursor: "pointer",
                    boxShadow: filterDirection === dir ? "0 1px 3px rgba(0,0,0,0.06)" : "none"
                  }}
                >
                  {dir}
                </button>
              ))}
            </div>
          </div>

          {/* Template List */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            {loading ? (
              <div style={{ padding: 20, textAlign: "center", color: C.slate, fontSize: 13 }}>Loading templates...</div>
            ) : filteredTemplates.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: C.slate, fontSize: 13 }}>No templates found.</div>
            ) : (
              filteredTemplates.map((t) => {
                const isSelected = t.id === selectedTemplateId;
                const isOutbound = t.call_direction === "outbound";
                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTemplateId(t.id)}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 10,
                      cursor: "pointer",
                      border: `1px solid ${isSelected ? C.cobalt : C.border}`,
                      background: isSelected ? "rgba(75, 115, 255, 0.05)" : "#fff",
                      transition: "all 0.15s ease"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13, color: isSelected ? C.cobalt : C.ink }}>
                        {t.name}
                      </span>
                      {t.is_default && (
                        <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "#EEF2FF", color: C.cobalt }}>
                          DEFAULT
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 10.5,
                          fontWeight: 600,
                          padding: "2px 7px",
                          borderRadius: 4,
                          background: isOutbound ? "#F0FDF4" : "#F8FAFC",
                          color: isOutbound ? "#16A34A" : C.slate
                        }}
                      >
                        {isOutbound ? <PhoneCall size={10} /> : <PhoneIncoming size={10} />}
                        {isOutbound ? "Outbound" : "Inbound"}
                      </span>
                      {t.times_used > 0 && (
                        <span style={{ fontSize: 10.5, color: C.slate }}>
                          {t.times_used} calls
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Main Workspace */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#F8FAFC" }}>
          {/* Top Bar for active template */}
          <div style={{ padding: "14px 28px", background: "#fff", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ display: "flex", background: C.paperSoft, padding: 3, borderRadius: 8 }}>
                <button
                  onClick={() => setActiveTab("editor")}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: "none",
                    background: activeTab === "editor" ? "#fff" : "transparent",
                    color: activeTab === "editor" ? C.ink : C.slate,
                    fontFamily: FONT_BODY,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: activeTab === "editor" ? "0 1px 3px rgba(0,0,0,0.06)" : "none"
                  }}
                >
                  Prompt & Flow Editor
                </button>
                <button
                  onClick={() => setActiveTab("preview")}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: "none",
                    background: activeTab === "preview" ? "#fff" : "transparent",
                    color: activeTab === "preview" ? C.ink : C.slate,
                    fontFamily: FONT_BODY,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: activeTab === "preview" ? "0 1px 3px rgba(0,0,0,0.06)" : "none"
                  }}
                >
                  Live Prompt Preview
                </button>
                <button
                  onClick={() => setActiveTab("variables")}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: "none",
                    background: activeTab === "variables" ? "#fff" : "transparent",
                    color: activeTab === "variables" ? C.ink : C.slate,
                    fontFamily: FONT_BODY,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: activeTab === "variables" ? "0 1px 3px rgba(0,0,0,0.06)" : "none"
                  }}
                >
                  Tags
                </button>
                <button
                  onClick={() => setActiveTab("booking")}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: "none",
                    background: activeTab === "booking" ? "#fff" : "transparent",
                    color: activeTab === "booking" ? C.ink : C.slate,
                    fontFamily: FONT_BODY,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: activeTab === "booking" ? "0 1px 3px rgba(0,0,0,0.06)" : "none"
                  }}
                >
                  Booking & Call Rules
                </button>
              </div>

              {statusMsg && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: statusMsg.type === "success" ? "#16A34A" : "#DC2626" }}>
                  {statusMsg.type === "success" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                  {statusMsg.text}
                </div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={handleSave}
                disabled={saving || !selectedTemplateId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 18px",
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
                <Save size={14} /> {saving ? "Saving..." : "Save Template"}
              </button>
            </div>
          </div>

          {/* Tab 1: Editor */}
          {activeTab === "editor" && (
            <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
              <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
                {/* Meta Configuration Card */}
                <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: 22, boxShadow: C.shadowCard }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, marginBottom: 14 }}>
                    Template Information
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Template Name</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13 }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Call Direction</label>
                      <select
                        value={formData.call_direction}
                        onChange={(e) => setFormData({ ...formData, call_direction: e.target.value })}
                        style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, background: "#fff" }}
                      >
                        <option value="outbound">Outbound (Proactive Prospecting)</option>
                        <option value="inbound">Inbound (Reception & Qualification)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Section 1: Greeting Hook */}
                <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: 22, boxShadow: C.shadowCard }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>
                      1. Opening Hook & Greeting
                    </div>
                    <span style={{ fontSize: 11, color: C.slate }}>Spoken immediately upon connection</span>
                  </div>
                  <textarea
                    rows={3}
                    value={formData.greeting_template}
                    onChange={(e) => setFormData({ ...formData, greeting_template: e.target.value })}
                    style={{ width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY, lineHeight: 1.5 }}
                    placeholder="e.g. Hi {{prospect_name}}, this is {{caller_name}} with {{company_name}}..."
                  />
                </div>

                {/* Section 2: Permission Check */}
                <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: 22, boxShadow: C.shadowCard }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>
                      2. Permission & Timing Check
                    </div>
                    <span style={{ fontSize: 11, color: C.slate }}>Checks if prospect has 2 minutes</span>
                  </div>
                  <textarea
                    rows={2}
                    value={formData.permission_check_template}
                    onChange={(e) => setFormData({ ...formData, permission_check_template: e.target.value })}
                    style={{ width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY, lineHeight: 1.5 }}
                    placeholder="e.g. Did I catch you at a bad time? I only need 2 minutes to explain why I called."
                  />
                </div>

                {/* Section 3: Value Proposition */}
                <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: 22, boxShadow: C.shadowCard }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>
                      3. Value Proposition & Core Pitch
                    </div>
                    <span style={{ fontSize: 11, color: C.slate }}>Dynamic pitch referencing company benefit</span>
                  </div>
                  <textarea
                    rows={3}
                    value={formData.value_prop_template}
                    onChange={(e) => setFormData({ ...formData, value_prop_template: e.target.value })}
                    style={{ width: "100%", padding: 12, borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY, lineHeight: 1.5 }}
                    placeholder="e.g. We help {{industry_phrase}} automate 80% of repetitive booking and qualify leads 24/7..."
                  />
                </div>

                {/* Section 4: Smart Objection Handling Matrix */}
                <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: 22, boxShadow: C.shadowCard }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>
                        4. Objection Handling Matrix
                      </div>
                      <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2 }}>
                        Configured responses for the 4 most common sales objections
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11.5, color: C.slate }}>Max Attempts:</span>
                      <input
                        type="number"
                        min={1}
                        max={5}
                        value={formData.max_objection_attempts}
                        onChange={(e) => setFormData({ ...formData, max_objection_attempts: parseInt(e.target.value) || 3 })}
                        style={{ width: 50, padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, textAlign: "center" }}
                      />
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {DEFAULT_OBJECTIONS.map((obj) => (
                      <div key={obj.key} style={{ background: C.paperSoft, borderRadius: 10, padding: 14, border: `1px solid ${C.border}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <Tag size={13} color={C.cobalt} />
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{obj.label}</span>
                          <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: C.slate }}>({obj.key})</span>
                        </div>
                        <textarea
                          rows={2}
                          value={formData.objection_responses[obj.key] ?? obj.defaultText}
                          onChange={(e) => setFormData({
                            ...formData,
                            objection_responses: {
                              ...formData.objection_responses,
                              [obj.key]: e.target.value
                            }
                          })}
                          style={{ width: "100%", padding: 10, borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5, background: "#fff", lineHeight: 1.4 }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Section 5: Booking Transition & Confirmation */}
                <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: 22, boxShadow: C.shadowCard }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink, marginBottom: 14 }}>
                    5. Booking Flow & Closing
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Booking Transition Offer</label>
                      <textarea
                        rows={2}
                        value={formData.booking_transition_template}
                        onChange={(e) => setFormData({ ...formData, booking_transition_template: e.target.value })}
                        style={{ width: "100%", padding: 10, borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5, lineHeight: 1.4 }}
                        placeholder="e.g. Let's get 15 minutes on the calendar this week. Would Tuesday or Thursday work better for you?"
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Slot & Email Confirmation</label>
                      <textarea
                        rows={2}
                        value={formData.confirmation_template}
                        onChange={(e) => setFormData({ ...formData, confirmation_template: e.target.value })}
                        style={{ width: "100%", padding: 10, borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5, lineHeight: 1.4 }}
                        placeholder="e.g. Perfect! I have you booked for {{meeting_time}} {{timezone}}. I'll send an invite to {{prospect_email}}."
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Closing / Goodbye</label>
                      <textarea
                        rows={2}
                        value={formData.closing_template}
                        onChange={(e) => setFormData({ ...formData, closing_template: e.target.value })}
                        style={{ width: "100%", padding: 10, borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5, lineHeight: 1.4 }}
                        placeholder="e.g. Thanks for your time, {{prospect_name}}. Have a fantastic week!"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 6: Business Rules & Demo Script */}
                <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: 22, boxShadow: C.shadowCard }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink, marginBottom: 4 }}>
                    6. Business Rules & Demo Script
                  </div>
                  <div style={{ fontSize: 11.5, color: C.slate, marginBottom: 14 }}>
                    Applies to every voice engine (xAI included) — not just this template's structured steps above.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Custom Business Rules (free text)</label>
                      <textarea
                        rows={4}
                        value={formData.custom_rules}
                        onChange={(e) => setFormData({ ...formData, custom_rules: e.target.value })}
                        style={{ width: "100%", padding: 10, borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5, lineHeight: 1.4, fontFamily: FONT_BODY }}
                        placeholder="e.g. Never discuss pricing on the first call. Always offer Tuesday/Thursday mornings first. If they mention a competitor by name, acknowledge respectfully and pivot to our differentiators."
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Demo Conversation (worked example, optional)</label>
                      <textarea
                        rows={6}
                        value={formData.demo_script}
                        onChange={(e) => setFormData({ ...formData, demo_script: e.target.value })}
                        style={{ width: "100%", padding: 10, borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5, lineHeight: 1.4, fontFamily: FONT_MONO }}
                        placeholder={'Prospect: "Hello?"\nAI: "Hi {{prospect_name}}, this is {{caller_name}} calling from {{company_name}}..."\nProspect: "What is this regarding?"\nAI: "..."'}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Live Prompt Preview */}
          {activeTab === "preview" && (
            <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
              <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Scenario Switcher Card */}
                <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: 20, boxShadow: C.shadowCard }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>
                        Simulation & Context Testing
                      </div>
                      <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                        Test how this template resolves across different lead data levels (Full CRM, Partial, Direct Call, Inbound)
                      </div>
                    </div>
                    <button
                      onClick={runPreview}
                      disabled={previewLoading}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 7, background: C.cobalt, color: "#fff", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                    >
                      <RotateCcw size={12} /> {previewLoading ? "Rendering..." : "Refresh Preview"}
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                    {[
                      { id: "full", label: "Full CRM Lead", desc: "Name + Company + Email + Phone" },
                      { id: "partial", label: "Partial Lead", desc: "Name + Phone only" },
                      { id: "direct", label: "Direct Call", desc: "Phone Number only" },
                      { id: "inbound", label: "Inbound Call", desc: "No initial prospect info" }
                    ].map((sc) => (
                      <div
                        key={sc.id}
                        onClick={() => setPreviewScenario(sc.id)}
                        style={{
                          flex: 1,
                          padding: "10px 14px",
                          borderRadius: 8,
                          cursor: "pointer",
                          border: `1px solid ${previewScenario === sc.id ? C.cobalt : C.border}`,
                          background: previewScenario === sc.id ? "rgba(75, 115, 255, 0.06)" : C.paperSoft
                        }}
                      >
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: previewScenario === sc.id ? C.cobalt : C.ink }}>{sc.label}</div>
                        <div style={{ fontSize: 10.5, color: C.slate, marginTop: 2 }}>{sc.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Rendered Prompt Box */}
                <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: 22, boxShadow: C.shadowCard }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>
                      Resolved LLM System Prompt
                    </div>
                    <button
                      onClick={() => copyToClipboard(renderedPreview || "")}
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: C.paperSoft, border: `1px solid ${C.border}`, fontSize: 11, cursor: "pointer" }}
                    >
                      <Copy size={11} /> {copiedTag === renderedPreview ? "Copied!" : "Copy Prompt"}
                    </button>
                  </div>
                  <pre style={{ margin: 0, padding: 16, borderRadius: 8, background: "#0F172A", color: "#E2E8F0", fontFamily: FONT_MONO, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 500, overflowY: "auto" }}>
                    {previewLoading ? "Resolving context and rendering template..." : renderedPreview || "No preview available."}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Variables & Tags */}
          {activeTab === "variables" && (
            <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
              <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
                {/* Standard Tags List */}
                <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: 22, boxShadow: C.shadowCard }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, marginBottom: 4 }}>
                    Standard Conversation Tags
                  </div>
                  <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 16 }}>
                    Click any variable tag to copy it to your clipboard for pasting into any prompt section.
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                    {VARIABLE_TAGS.map((v) => (
                      <div
                        key={v.tag}
                        onClick={() => copyToClipboard(v.tag)}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 8,
                          border: `1px solid ${C.border}`,
                          background: C.paperSoft,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          transition: "all 0.15s ease"
                        }}
                      >
                        <div>
                          <div style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700, color: C.cobalt }}>{v.tag}</div>
                          <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>{v.desc}</div>
                        </div>
                        <span style={{ fontSize: 10, color: copiedTag === v.tag ? "#16A34A" : C.slate }}>
                          {copiedTag === v.tag ? <Check size={14} /> : <Copy size={13} />}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 4: Booking & Call Rules — one shared policy, applies to xAI, OpenAI Realtime and Modular/LiveKit alike */}
          {activeTab === "booking" && (
            <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
              <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
                <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${C.border}`, padding: 22, boxShadow: C.shadowCard }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>
                      Booking & Call Rules
                    </div>
                    {bookingSaveStatus && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: bookingSaveStatus.type === "success" ? "#16A34A" : "#DC2626" }}>
                        {bookingSaveStatus.type === "success" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                        {bookingSaveStatus.text}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 16 }}>
                    How the voice agent books meetings on live calls — built-in steps plus your free-text rules. Shared across every voice engine (not per-template), so it saves separately below.
                  </div>
                  <BookingPolicyEditor bookingPolicy={bookingPolicy} onChange={setBookingPolicyDirty} />
                  <button
                    onClick={handleSaveBookingPolicy}
                    disabled={bookingSaving || !bookingDirty}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 18px",
                      borderRadius: 8,
                      background: bookingDirty ? C.cobalt : C.paperSoft,
                      color: bookingDirty ? "#fff" : C.slate,
                      border: "none",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: bookingDirty ? "pointer" : "default",
                      boxShadow: bookingDirty ? "0 2px 6px rgba(75,115,255,0.25)" : "none"
                    }}
                  >
                    <Save size={14} /> {bookingSaving ? "Saving..." : "Save booking & call rules"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
