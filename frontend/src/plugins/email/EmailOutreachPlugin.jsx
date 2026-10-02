import React, { useState, useEffect } from "react";
import {
  LayoutGrid,
  Wand2,
  Mail,
  Send,
  Sparkles,
  Inbox,
  PenLine,
  ChevronRight,
  ChevronLeft,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Copy,
  TrendingUp,
  RefreshCw,
  Plus,
  ArrowRight,
  Search,
  Filter,
  Check,
  X,
  SlidersHorizontal,
  Bot,
  User,
  ShieldCheck,
  Zap,
  BarChart3,
  BookOpen,
  LogOut,
  Layers,
  MessageSquare,
  CreditCard
} from "lucide-react";
import { AppSwitcher } from "../../hub/AppSwitcher";
import { NAV_TEXT, C, FONT_DISPLAY, FONT_BODY, FONT_MONO, HUB_PAPER, initialsFromName, getActiveAiCredentials } from "../../tokens";
import { api } from "../../api/apiClient";
import { SubscriptionPage } from "../../team/SubscriptionPage";
import { CampaignsView, DoNotEmailView, FindView, MailboxesView, RepliesView } from "./OutreachViews";
import { navigateHash, onRouteChange, replaceHash, routeHash } from "../../utils/route";

const INITIAL_EMAIL_TEMPLATES = [
  {
    id: "tpl_1",
    name: "Executive Operational Friction Hook",
    category: "Cold Approach",
    subject: "Eliminating dispatch & scheduling friction at {{company}}",
    body: "Hi {{firstName}},\n\nI noticed {{company}} has been expanding operations recently. When teams grow, operational follow-ups often slip through the cracks or take up hours of manual coordination.\n\nWe automate client confirmation and operational alerting workflows directly with your existing software.\n\nWould you be open to a 10-minute briefing next Tuesday?\n\nBest regards,"
  },
  {
    id: "tpl_2",
    name: "Customer Proof / Case Study Story",
    category: "Follow-Up",
    subject: "How similar mid-market teams eliminated Friday delays",
    body: "Hi {{firstName}},\n\nQuick follow-up on my note regarding {{company}}'s operations.\n\nOne of our logistics partners recently cut dispatch turnaround by 65% in their first 30 days without adding any headcount.\n\nI'd be glad to share the 1-page case breakdown with your team.\n\nBest,"
  },
  {
    id: "tpl_3",
    name: "Polite Executive Breakup Note",
    category: "Final Touch",
    subject: "Closing your file for now?",
    body: "Hi {{firstName}},\n\nI assume your team's operational systems are locked in for the quarter, so I won't follow up again.\n\nIf you ever need automated voice and email follow-ups for {{company}}, our door is always open.\n\nAll the best,"
  }
];

export default function EmailOutreachPlugin({
  operator,
  onBackToHub,
  onLogout,
  profile,
  commonAi,
}) {
  const [view, setView] = useState(() => {
    try {
      const hash = routeHash().replace(/^#\/?/, "");
      const parts = hash.split("/");
      if (parts[0] === "emailoutreach" && parts[1]) return parts[1];
      return localStorage.getItem("aivhub_email_view") || "campaigns";
    } catch (_) {
      return "campaigns";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("aivhub_email_view", view);
      const target = `#/emailoutreach/${view}`;
      if (routeHash() !== target) {
        replaceHash(target);
      }
    } catch (_) {}
  }, [view]);

  useEffect(() => {
    const onHash = () => {
      try {
        const hash = routeHash().replace(/^#\/?/, "");
        const parts = hash.split("/");
        if (parts[0] === "emailoutreach" && parts[1] && parts[1] !== view) {
          setView(parts[1]);
        }
      } catch (_) {}
    };
    return onRouteChange(onHash);
  }, [view]);
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [showNewTemplateModal, setShowNewTemplateModal] = useState(false);
  const [newTemplateForm, setNewTemplateForm] = useState({ name: "", category: "Outbound", subject: "", body_text: "" });
  const [toastMessage, setToastMessage] = useState(null);

  // Dedicated AI Model Configuration & Test Bench State
  const [showAiConfig, setShowAiConfig] = useState(false);
  const [customAi, setCustomAi] = useState({
    provider: "openai",
    model: "gpt-4o-mini",
    apiKey: "",
    baseUrl: ""
  });
  const [testRunStatus, setTestRunStatus] = useState(null);

  const fetchTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const res = await api.emailTemplates();
      if (res?.templates) {
        setTemplates(res.templates);
      }
    } catch (e) {
      console.warn("Failed to load email templates:", e);
    } finally {
      setTemplatesLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleTestRunAi = async () => {
    setTestRunStatus({ loading: true, error: null, result: null, latencyMs: null });
    const startTime = Date.now();
    const creds = customAi.apiKey ? customAi : getActiveAiCredentials(commonAi, "email", "copywriterLlm");
    try {
      const res = await api.emailAiDraft({
        action_type: "generate",
        topic: "Autonomous B2B scheduling & customer confirmation agent",
        target_audience: "VP of Operations",
        objective: "Book a 7-minute introductory discovery briefing",
        company_name: "Acme Logistics",
        recipient_name: "Alex Mercer",
        sender_name: operator ? operator.name : "OutReach Team",
        api_key: creds.apiKey,
        provider: creds.provider,
        model: creds.model,
        base_url: creds.baseUrl
      });
      const latency = Date.now() - startTime;
      if (res?.body) {
        setTestRunStatus({
          loading: false,
          success: true,
          result: `Subject: ${res.subject}\n\n${res.body}`,
          latencyMs: latency,
          provider: res.provider || creds.provider,
          model: res.model || creds.model
        });
        showToast(`AI Test Run Succeeded (${latency}ms)!`);
      } else {
        throw new Error(res?.error || "No response received");
      }
    } catch (err) {
      setTestRunStatus({
        loading: false,
        success: false,
        error: err.message || "Failed to reach AI service",
        latencyMs: Date.now() - startTime
      });
      showToast(`AI Test Run failed: ${err.message}`);
    }
  };

  // Open AI Email Outreach Copilot State
  const [emailChatMessages, setEmailChatMessages] = useState([
    {
      id: "em_init",
      role: "assistant",
      text: "👋 Hi! I'm your AI Outreach & Email Copilot. You can ask me to draft custom emails, analyze objection patterns, suggest subject lines, or discuss general outbound strategy.\n\nWhat would you like to work on?",
      time: "Just now"
    }
  ]);
  const [emailChatInput, setEmailChatInput] = useState("");
  const [isEmailTyping, setIsEmailTyping] = useState(false);
  const emailScrollRef = React.useRef(null);

  const handleSendEmailChat = async (e, customText) => {
    if (e) e.preventDefault();
    const query = (customText || emailChatInput).trim();
    if (!query || isEmailTyping) return;

    setEmailChatInput("");
    const userMsg = {
      id: "em_" + Date.now(),
      role: "user",
      text: query,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };
    setEmailChatMessages((prev) => [...prev, userMsg]);
    setIsEmailTyping(true);

    try {
      const creds = customAi.apiKey ? customAi : getActiveAiCredentials(commonAi, "email", "copywriterLlm");
      const res = await api.copilotChat({
        message: query,
        history: emailChatMessages.map((m) => ({ role: m.role, content: m.text })),
        plugin: "email",
        apiKey: creds.apiKey,
        provider: creds.provider,
        model: creds.model,
        baseUrl: creds.baseUrl
      });

      setEmailChatMessages((prev) => [
        ...prev,
        {
          id: "em_" + (Date.now() + 1),
          role: "assistant",
          text: res?.reply || "Draft ready. How else can I assist?",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          model: res?.model || creds.model
        }
      ]);
    } catch (err) {
      setEmailChatMessages((prev) => [
        ...prev,
        {
          id: "em_" + (Date.now() + 1),
          role: "assistant",
          text: `⚠️ AI connection error: ${err.message || "Failed to reach AI service."}`,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        }
      ]);
    } finally {
      setIsEmailTyping(false);
      setTimeout(() => {
        if (emailScrollRef.current) {
          emailScrollRef.current.scrollIntoView({ behavior: "smooth" });
        }
      }, 100);
    }
  };

  // Drafter State
  const [draftMode, setDraftMode] = useState("cold"); // "cold" | "repurpose"
  const [targetCompany, setTargetCompany] = useState("Apex Freight Logistics");
  const [targetPersona, setTargetPersona] = useState("VP of Fleet Operations");
  const [selectedPostTopic, setSelectedPostTopic] = useState("Ops teams still closing the week in spreadsheets");
  const [isGenerating, setIsGenerating] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [showAltSubjects, setShowAltSubjects] = useState(false);
  const [altSubjects, setAltSubjects] = useState([
    "Quick idea for {{companyName}}'s outbound operations",
    "Cutting dispatch latency at {{companyName}} by 28%",
    "Question regarding {{companyName}} workflow automation"
  ]);
  const [generatedDraft, setGeneratedDraft] = useState({
    subject: "Eliminating dispatch friction at Apex Freight",
    preview: "Quick note on how automation cuts driver check-in delays...",
    body: "Hi Marcus,\n\nI noticed Apex Freight is expanding your Texas depots. As fleet volume grows, manual status checks create operational drag.\n\nWe automate the entire outbound confirmation and dispatch update cycle via AI voice and email.\n\nAre you free for a quick 10-minute briefing next Tuesday?\n\nBest,\n" + (operator ? operator.name : "Operations team")
  });

  const handleRefineDraft = async (actionType) => {
    setIsGenerating(true);
    const creds = customAi.apiKey ? customAi : getActiveAiCredentials(commonAi, "email", "copywriterLlm");
    try {
      const res = await api.emailAiDraft({
        action_type: actionType,
        current_subject: generatedDraft.subject,
        current_body: generatedDraft.body,
        custom_prompt: actionType === "custom" ? customPrompt : "",
        sender_name: operator ? operator.name : "Operations team",
        recipient_name: targetPersona,
        company_name: targetCompany,
        api_key: creds.apiKey,
        provider: creds.provider,
        model: creds.model,
        base_url: creds.baseUrl
      });
      if (res?.body) {
        setGeneratedDraft(prev => ({
          ...prev,
          subject: res.subject || prev.subject,
          body: res.body
        }));
        showToast(`AI refined draft: ${actionType === "concise" ? "Made concise" : actionType === "cta" ? "Low-friction CTA" : actionType === "executive" ? "Executive tone" : actionType === "metric" ? "Added ROI metric" : "Custom refinement"}!`);
      }
    } catch (err) {
      showToast(`AI Notice: ${err.message}`);
    } finally {
      setIsGenerating(false);
      if (actionType === "custom") setCustomPrompt("");
    }
  };

  const handleInsertTag = (tag) => {
    setGeneratedDraft(prev => ({
      ...prev,
      body: prev.body + " " + tag + " "
    }));
    showToast("Inserted tag " + tag);
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleGenerateDraft = async (e) => {
    e.preventDefault();
    setIsGenerating(true);
    const creds = customAi.apiKey ? customAi : getActiveAiCredentials(commonAi, "email", "copywriterLlm");
    try {
      const res = await api.emailAiDraft({
        action_type: "generate",
        topic: draftMode === "repurpose" ? `Repurposed insights from: ${selectedPostTopic}` : `Operational friction and automation for ${targetCompany}`,
        target_audience: targetPersona,
        objective: "Book a 7-minute introductory discovery briefing",
        company_name: targetCompany,
        recipient_name: targetPersona,
        sender_name: operator ? operator.name : "Operations team",
        api_key: creds.apiKey,
        provider: creds.provider,
        model: creds.model,
        base_url: creds.baseUrl
      });
      if (res?.body) {
        setGeneratedDraft({
          subject: res.subject || (draftMode === "repurpose" ? `How ${targetCompany} can eliminate Friday operational bottlenecks` : `Direct inquiry regarding ${targetCompany} workflows`),
          preview: `Quick note regarding ${targetCompany} operations...`,
          body: res.body
        });
        showToast("Generated high-converting B2B email draft with AI!");
      }
    } catch (err) {
      showToast(`AI generation error: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveToTemplates = async () => {
    try {
      const res = await api.emailCreateTemplate({
        name: generatedDraft.subject.slice(0, 36) || "Custom Outreach Template",
        subject: generatedDraft.subject,
        body_text: generatedDraft.body,
        category: "Outbound",
        tags: ["AI Generated", "Outbound"]
      });
      if (res?.ok) {
        showToast("Saved template to company database!");
        fetchTemplates();
      }
    } catch (err) {
      showToast(`Error saving template: ${err.message}`);
    }
  };

  const handleCreateNewTemplate = async (e) => {
    e.preventDefault();
    if (!newTemplateForm.name.trim()) return;
    try {
      const res = await api.emailCreateTemplate({
        name: newTemplateForm.name.trim(),
        category: newTemplateForm.category || "Outbound",
        subject: newTemplateForm.subject || "",
        body_text: newTemplateForm.body_text || "",
        tags: ["Custom", newTemplateForm.category]
      });
      if (res?.ok) {
        showToast(`Template "${newTemplateForm.name}" created!`);
        setShowNewTemplateModal(false);
        setNewTemplateForm({ name: "", category: "Outbound", subject: "", body_text: "" });
        fetchTemplates();
      }
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  };

  const handleDeleteTemplate = async (templateId) => {
    try {
      await api.emailDeleteTemplate(templateId);
      setTemplates(prev => prev.filter(t => t.id !== templateId));
      showToast("Template removed from database.");
    } catch (err) {
      showToast(`Delete failed: ${err.message}`);
    }
  };

  const navItems = [
    { id: "copilot", label: "AI Outreach Copilot", icon: Sparkles, count: "Open Chat" },
    { id: "campaigns", label: "Campaigns", icon: Send },
    { id: "mailboxes", label: "Mailboxes & Warmup", icon: ShieldCheck },
    { id: "find", label: "Find Emails", icon: Search },
    { id: "inbox", label: "Replies", icon: Mail },
    { id: "drafter", label: "AI Email Drafter", icon: PenLine, count: "AI" },
    { id: "templates", label: "Template Library", icon: BookOpen, count: templates.length },
    { id: "donotemail", label: "Do-not-email List", icon: X },
    ...(operator?.is_admin ? [{ id: "subscription", label: "Subscription", icon: CreditCard }] : []),
  ];

  const viewTitles = {
    copilot: { title: "AI Outreach Copilot (Open Assistant)", desc: "Conversational AI assistant for email strategy, copywriting, objection handling, and messaging." },
    campaigns: { title: "Campaigns", desc: "Multi-step cold email sequences sent from your mailboxes during your sending hours." },
    mailboxes: { title: "Mailboxes & Warmup", desc: "Connect sending mailboxes, check their DNS and warm them up before campaigns." },
    find: { title: "Find Emails", desc: "Find a person's verified work email from their name and company." },
    donotemail: { title: "Do-not-email List", desc: "Addresses and domains no campaign will ever email." },
    drafter: { title: "AI Email Drafter", desc: "Generate personalized cold pitches or repurpose social content into newsletters." },
    inbox: { title: "Replies", desc: "Replies to your campaigns, sorted by AI. Replying stops that lead's follow-ups." },
    templates: { title: "Email Template Library", desc: "Battle-tested B2B templates with dynamic personalization merge variables." },
    analytics: { title: "Deliverability & Domain Health", desc: "SPF/DKIM/DMARC status, inbox placement rates, and spam-trigger auditing." },
    subscription: { title: "Subscription", desc: "Your email outreach plan and credits. Change plan, top up, or cancel." },
  };

  return (
    <div className="app-shell" style={{ display: "flex", height: "100vh", background: HUB_PAPER, fontFamily: FONT_BODY, overflow: "hidden" }}>
      
      {/* ----------------- LEFT DARK SIDEBAR (MATCHING OTHER PLUGINS) ----------------- */}
      <div
        className="app-sidebar"
        style={{
          width: 232,
          minWidth: 232,
          background: C.ink,
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          padding: "22px 14px",
          boxSizing: "border-box",
        }}
      >
        {/* Header with Icon + Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 8px 12px 8px" }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "linear-gradient(135deg, #F59E0B, #D97706)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              boxShadow: "0 2px 8px rgba(245,158,11,0.3)",
            }}
          >
            <Mail size={15} strokeWidth={2.4} />
          </div>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: "#fff", letterSpacing: "-0.01em" }}>
            Email Outreach
          </span>
        </div>

        <AppSwitcher current="emailoutreach" onHome={onBackToHub} />

        {/* Navigation items */}
        <div className="app-sidebar-nav" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 10px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  background: active ? "rgba(255,255,255,0.09)" : "transparent",
                  color: active ? "#fff" : "#9AA0AE",
                  ...NAV_TEXT,
                  textAlign: "left",
                  transition: "all 0.12s",
                }}
              >
                <Icon size={16} color={active ? "#FBBF24" : "#9AA0AE"} />
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.count !== undefined && (
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      padding: "1px 6px",
                      borderRadius: 999,
                      background: active ? "#F59E0B" : "rgba(255,255,255,0.08)",
                      color: "#fff",
                    }}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Sidebar Footer: Operator & Sign Out */}
        <div className="app-sidebar-extra" style={{ marginTop: "auto", padding: "12px 10px", borderTop: `1px solid ${C.inkLine}` }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: "#6B7280", marginBottom: 8 }}>
            Logged in as
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 999,
                background: "#F59E0B",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: FONT_BODY,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {initialsFromName(operator?.name)}
            </div>
            <div style={{ flex: 1, fontFamily: FONT_BODY, fontSize: 12.5, color: "#C8CCD6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {operator?.name || "Operator"}
            </div>
          </div>
          {onLogout && (
            <button
              onClick={onLogout}
              style={{
                marginTop: 10,
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "7px 8px",
                borderRadius: 8,
                border: `1px solid ${C.inkLine}`,
                background: "transparent",
                color: "#8B90A0",
                fontFamily: FONT_BODY,
                fontSize: 11.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <LogOut size={12} /> Sign out
            </button>
          )}
        </div>
      </div>

      {/* ----------------- RIGHT WORKSPACE AREA ----------------- */}
      <div className="app-main" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100vh" }}>
        
        {/* Top Header Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 28px",
            borderBottom: `1px solid ${C.border}`,
            background: "#fff",
          }}
        >
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink, letterSpacing: "-0.02em" }}>
              {viewTitles[view]?.title || "Email Outreach"}
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 2 }}>
              {viewTitles[view]?.desc || ""}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>

            {view === "drafter" && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedDraft.body);
                  showToast("Copied draft email body to clipboard!");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  color: C.textInk,
                  fontFamily: FONT_BODY,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <Copy size={14} /> Copy Draft
              </button>
            )}
          </div>
        </div>

        {/* Main Workspace Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          

          {/* VIEW 2: EXPANSIVE AI EMAIL STUDIO */}
          {view === "drafter" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Studio Header Card */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: "18px 22px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink, display: "flex", alignItems: "center", gap: 8 }}>
                      <PenLine size={18} color="#F59E0B" />
                      Email Outreach Studio & AI Drafter
                    </div>
                    <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2 }}>
                      Autonomous copywriting engine calibrated for high deliverability, executive tone, and direct conversion.
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {/* Dedicated AI Model Settings Button */}
                    <button
                      type="button"
                      onClick={() => setShowAiConfig(!showAiConfig)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: showAiConfig ? "1px solid #D97706" : `1px solid ${C.border}`,
                        background: showAiConfig ? "#FEF3C7" : "#fff",
                        color: showAiConfig ? "#92400E" : C.ink,
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      <SlidersHorizontal size={14} />
                      <span>{showAiConfig ? "Hide AI Model Settings" : "⚙️ AI Model & API Key"}</span>
                    </button>

                    {/* Mode Selector */}
                    <div style={{ display: "flex", background: HUB_PAPER, padding: 3, borderRadius: 8, gap: 4, border: `1px solid ${C.border}` }}>
                      <button
                        type="button"
                        onClick={() => setDraftMode("cold")}
                        style={{
                          padding: "6px 14px",
                          borderRadius: 6,
                          border: "none",
                          background: draftMode === "cold" ? "#fff" : "transparent",
                          color: draftMode === "cold" ? C.ink : C.slate,
                          fontWeight: draftMode === "cold" ? 700 : 500,
                          fontSize: 12.5,
                          cursor: "pointer",
                          boxShadow: draftMode === "cold" ? "0 1px 3px rgba(0,0,0,0.08)" : "none"
                        }}
                      >
                        Cold Outreach
                      </button>
                      <button
                        type="button"
                        onClick={() => setDraftMode("repurpose")}
                        style={{
                          padding: "6px 14px",
                          borderRadius: 6,
                          border: "none",
                          background: draftMode === "repurpose" ? "#fff" : "transparent",
                          color: draftMode === "repurpose" ? C.ink : C.slate,
                          fontWeight: draftMode === "repurpose" ? 700 : 500,
                          fontSize: 12.5,
                          cursor: "pointer",
                          boxShadow: draftMode === "repurpose" ? "0 1px 3px rgba(0,0,0,0.08)" : "none"
                        }}
                      >
                        Repurpose Post
                      </button>
                    </div>
                  </div>
                </div>

                {/* Dedicated Space for AI LLM Provider, Custom API Key & Test Run */}
                {showAiConfig && (
                  <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#92400E", display: "flex", alignItems: "center", gap: 6 }}>
                        <Zap size={16} />
                        AI Model & API Key Workspace (Outreach Copywriter)
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#B45309", background: "#FEF3C7", padding: "2px 8px", borderRadius: 6, border: "1px solid #FDE68A" }}>
                        Active: {customAi.apiKey ? `Custom (${customAi.provider})` : "Company Platform Key"}
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.5fr", gap: 10, marginBottom: 12 }}>
                      <div>
                        <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#92400E", marginBottom: 4 }}>LLM Provider</label>
                        <select
                          value={customAi.provider}
                          onChange={(e) => setCustomAi({ ...customAi, provider: e.target.value })}
                          style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #FDE68A", fontSize: 12, background: "#fff" }}
                        >
                          <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
                          <option value="anthropic">Anthropic (Claude 3.5 Sonnet)</option>
                          <option value="deepseek">DeepSeek (DeepSeek-Chat)</option>
                          <option value="groq">Groq (Llama 3.3 70B)</option>
                          <option value="xai">xAI (Grok)</option>
                          <option value="gemini">Google Gemini</option>
                        </select>
                      </div>

                      <div>
                        <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#92400E", marginBottom: 4 }}>Model Name / ID</label>
                        <input
                          type="text"
                          value={customAi.model}
                          onChange={(e) => setCustomAi({ ...customAi, model: e.target.value })}
                          placeholder="e.g. gpt-4o-mini"
                          style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 6, border: "1px solid #FDE68A", fontSize: 12, background: "#fff" }}
                        />
                      </div>

                      <div>
                        <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#92400E", marginBottom: 4 }}>API Key (Leave empty to use Platform Key)</label>
                        <input
                          type="password"
                          value={customAi.apiKey}
                          onChange={(e) => setCustomAi({ ...customAi, apiKey: e.target.value })}
                          placeholder="sk-... (optional dedicated key)"
                          style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 6, border: "1px solid #FDE68A", fontSize: 12, background: "#fff" }}
                        />
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTop: "1px solid #FDE68A", flexWrap: "wrap", gap: 8 }}>
                      <div style={{ fontSize: 11.5, color: "#78350F" }}>
                        Specify a custom key for isolated high-volume copywriting or test runs.
                      </div>
                      <button
                        type="button"
                        onClick={handleTestRunAi}
                        disabled={testRunStatus?.loading}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 14px",
                          borderRadius: 6,
                          background: "#D97706",
                          color: "#fff",
                          border: "none",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: testRunStatus?.loading ? "wait" : "pointer"
                        }}
                      >
                        <Zap size={13} />
                        <span>{testRunStatus?.loading ? "Running Test Prompt..." : "⚡ Run Test AI Prompt"}</span>
                      </button>
                    </div>

                    {/* Test Run Result Indicator */}
                    {testRunStatus && (
                      <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 8, background: testRunStatus.success ? "#ECFDF5" : "#FEF2F2", border: `1px solid ${testRunStatus.success ? "#A7F3D0" : "#FECACA"}` }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11.5, fontWeight: 700, color: testRunStatus.success ? "#065F46" : "#991B1B" }}>
                          <span>{testRunStatus.success ? `✅ AI Test Passed (${testRunStatus.latencyMs}ms)` : `❌ AI Test Failed (${testRunStatus.latencyMs}ms)`}</span>
                          <span style={{ fontWeight: 500, fontSize: 11 }}>Model: {testRunStatus.model || customAi.model}</span>
                        </div>
                        {testRunStatus.error && (
                          <div style={{ fontSize: 11, color: "#B91C1C", marginTop: 4 }}>{testRunStatus.error}</div>
                        )}
                        {testRunStatus.result && (
                          <div style={{ fontSize: 11.5, color: "#064E3B", marginTop: 6, whiteSpace: "pre-wrap", maxHeight: 90, overflow: "auto", background: "#fff", padding: "6px 8px", borderRadius: 6, border: "1px solid #D1FAE5" }}>
                            {testRunStatus.result}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Target Inputs Bar */}
                <form onSubmit={handleGenerateDraft} style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap", background: HUB_PAPER, padding: "12px 14px", borderRadius: 10, border: `1px solid ${C.border}` }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 4 }}>Target Company Name</label>
                    <input
                      type="text"
                      value={targetCompany}
                      onChange={(e) => setTargetCompany(e.target.value)}
                      placeholder="e.g. Apex Freight Logistics"
                      style={{ width: "100%", boxSizing: "border-box", padding: "8px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, background: "#fff" }}
                    />
                  </div>

                  <div style={{ flex: 1, minWidth: 180 }}>
                    <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 4 }}>Decision Maker Persona</label>
                    <input
                      type="text"
                      value={targetPersona}
                      onChange={(e) => setTargetPersona(e.target.value)}
                      placeholder="e.g. VP of Operations"
                      style={{ width: "100%", boxSizing: "border-box", padding: "8px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13, background: "#fff" }}
                    />
                  </div>

                  {draftMode === "repurpose" && (
                    <div style={{ flex: 1.5, minWidth: 220 }}>
                      <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 4 }}>Source Scheduled Topic</label>
                      <select
                        value={selectedPostTopic}
                        onChange={(e) => setSelectedPostTopic(e.target.value)}
                        style={{ width: "100%", padding: "8px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 12.5, background: "#fff", color: C.ink }}
                      >
                        <option value="Ops teams still closing the week in spreadsheets">Ops teams closing in spreadsheets</option>
                        <option value="When the floor and the board disagree on data">When the floor and board disagree</option>
                        <option value="Plant managers needing shift facts instead of 40-page reports">Plant managers shift facts</option>
                      </select>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isGenerating}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 18px",
                      height: 38,
                      borderRadius: 8,
                      background: "linear-gradient(135deg, #F59E0B, #D97706)",
                      color: "#fff",
                      border: "none",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: isGenerating ? "wait" : "pointer",
                      boxShadow: "0 2px 6px rgba(245,158,11,0.25)",
                      whiteSpace: "nowrap"
                    }}
                  >
                    <Sparkles size={15} />
                    <span>{isGenerating ? "Drafting..." : "Generate AI Email Draft"}</span>
                  </button>
                </form>
              </div>

              {/* Expansive Canvas + Editor */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                
                {/* Dynamic Variable Chips & Subject Line Row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, paddingBottom: 12, borderBottom: `1px solid ${C.borderLight}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: C.slate }}>Insert Merge Variable:</span>
                    {[
                      "{{firstName}}",
                      "{{companyName}}",
                      "{{title}}",
                      "{{industry}}",
                      "{{yourName}}"
                    ].map(tag => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleInsertTag(tag)}
                        style={{
                          fontSize: 11,
                          fontFamily: FONT_MONO,
                          fontWeight: 600,
                          padding: "3px 8px",
                          borderRadius: 6,
                          background: HUB_PAPER,
                          border: `1px solid ${C.border}`,
                          color: C.ink,
                          cursor: "pointer",
                          transition: "all 0.15s ease"
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.borderColor = "#F59E0B"}
                        onMouseLeave={(e) => e.currentTarget.style.borderColor = C.border}
                      >
                        + {tag}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 6, background: "#ECFDF5", color: "#059669", border: "1px solid #A7F3D0" }}>
                      Deliverability: 98/100 (Optimal SPF/DKIM)
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: C.slate, background: HUB_PAPER, padding: "3px 8px", borderRadius: 6, border: `1px solid ${C.border}` }}>
                      ~28 sec read
                    </span>
                  </div>
                </div>

                {/* Subject Line Input + Alt Subject Generator */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>
                      Subject Line
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowAltSubjects(!showAltSubjects)}
                      style={{ border: "none", background: "transparent", color: "#D97706", fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <Sparkles size={12} />
                      {showAltSubjects ? "Hide Alternative Subjects" : "⚡ 3 Alternative Subjects"}
                    </button>
                  </div>

                  <input
                    type="text"
                    value={generatedDraft.subject}
                    onChange={(e) => setGeneratedDraft(d => ({ ...d, subject: e.target.value }))}
                    style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13.5, fontWeight: 600, color: C.ink, background: HUB_PAPER }}
                  />

                  {showAltSubjects && (
                    <div style={{ marginTop: 8, padding: 10, background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#92400E", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Click to apply high-open subject:
                      </div>
                      {altSubjects.map((alt, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            setGeneratedDraft(d => ({ ...d, subject: alt.replace("{{companyName}}", targetCompany) }));
                            setShowAltSubjects(false);
                            showToast("Updated subject line!");
                          }}
                          style={{ fontSize: 12.5, color: C.ink, padding: "6px 8px", borderRadius: 6, background: "#fff", border: `1px solid ${C.borderLight}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#FEF3C7"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}
                        >
                          <span>{alt.replace("{{companyName}}", targetCompany)}</span>
                          <span style={{ fontSize: 11, color: "#D97706", fontWeight: 700 }}>Apply →</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Expansive Email Body Textarea */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>
                      Email Body (Expansive Canvas)
                    </label>
                    <span style={{ fontSize: 11.5, color: C.slate }}>
                      Word count: ~{(generatedDraft.body || "").split(/\s+/).filter(Boolean).length} words (Recommended: 50-100 words)
                    </span>
                  </div>

                  <textarea
                    value={generatedDraft.body}
                    onChange={(e) => setGeneratedDraft(d => ({ ...d, body: e.target.value }))}
                    rows={12}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "16px 18px",
                      borderRadius: 10,
                      border: `1px solid ${C.border}`,
                      fontSize: 13.5,
                      fontFamily: FONT_BODY,
                      lineHeight: 1.6,
                      color: C.ink,
                      background: "#fff",
                      resize: "vertical"
                    }}
                  />
                </div>

                {/* 1-Click AI Power Refinements */}
                <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px" }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    1-Click AI Refinement Actions:
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => handleRefineDraft("concise")}
                      disabled={isGenerating}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 7, border: `1px solid ${C.border}`, background: "#fff", fontSize: 12, fontWeight: 600, color: C.ink, cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
                    >
                      <span>⚡</span> Make More Concise
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRefineDraft("cta")}
                      disabled={isGenerating}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 7, border: `1px solid ${C.border}`, background: "#fff", fontSize: 12, fontWeight: 600, color: C.ink, cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
                    >
                      <span>🎯</span> Stronger Call-to-Action
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRefineDraft("executive")}
                      disabled={isGenerating}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 7, border: `1px solid ${C.border}`, background: "#fff", fontSize: 12, fontWeight: 600, color: C.ink, cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
                    >
                      <span>👔</span> Executive Tone
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRefineDraft("metric")}
                      disabled={isGenerating}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 7, border: `1px solid ${C.border}`, background: "#fff", fontSize: 12, fontWeight: 600, color: C.ink, cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
                    >
                      <span>📊</span> Add Case Study Metric
                    </button>
                  </div>

                  {/* Direct Custom AI Instruction Input */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                    <input
                      type="text"
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      placeholder="Or give custom instruction to AI (e.g. emphasize we integrate in 1 day without downtime)..."
                      style={{ flex: 1, padding: "8px 12px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 12.5, background: "#fff" }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleRefineDraft("custom");
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleRefineDraft("custom")}
                      disabled={!customPrompt.trim() || isGenerating}
                      style={{ padding: "8px 14px", borderRadius: 7, border: "none", background: C.ink, color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: customPrompt.trim() ? "pointer" : "default", opacity: customPrompt.trim() ? 1 : 0.5 }}
                    >
                      Refine
                    </button>
                  </div>
                </div>

                {/* Bottom Action Controls */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 12, borderTop: `1px solid ${C.borderLight}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.slate }}>
                    <ShieldCheck size={16} color="#059669" />
                    <span>0 spam trigger words detected · Clean inbox placement guarantee</span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(`Subject: ${generatedDraft.subject}\n\n${generatedDraft.body}`);
                        showToast("Copied full draft to clipboard!");
                      }}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", color: C.ink, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                    >
                      <Copy size={14} /> Copy Draft
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveToTemplates}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: "linear-gradient(135deg, #F59E0B, #D97706)", color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 6px rgba(245,158,11,0.25)" }}
                    >
                      <CheckCircle2 size={14} /> Save to Database Templates
                    </button>
                  </div>
                </div>

              </div>
            </div>
          )}


          {/* VIEW 4: TEMPLATES (Database-backed per company) */}
          {view === "templates" && (
            <div>
              {/* Header with New Template Button */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink, margin: 0 }}>
                    Company Email Template Library
                  </h2>
                  <p style={{ fontSize: 12.5, color: C.slate, margin: "2px 0 0 0" }}>
                    Saved B2B sequence templates stored securely in your company database.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowNewTemplateModal(true)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 16px",
                    borderRadius: 8,
                    background: "linear-gradient(135deg, #F59E0B, #D97706)",
                    color: "#fff",
                    border: "none",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 2px 6px rgba(245,158,11,0.25)"
                  }}
                >
                  <Plus size={15} />
                  <span>Create Template</span>
                </button>
              </div>

              {templatesLoading ? (
                <div style={{ textAlign: "center", padding: 40, color: C.slate }}>
                  <RefreshCw size={24} className="animate-spin" style={{ margin: "0 auto 8px" }} />
                  <div>Loading templates from database...</div>
                </div>
              ) : templates.length === 0 ? (
                <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 40, textAlign: "center" }}>
                  <BookOpen size={36} color="#D97706" style={{ margin: "0 auto 12px" }} />
                  <div style={{ fontWeight: 700, fontSize: 16, color: C.ink, marginBottom: 4 }}>No templates saved yet</div>
                  <div style={{ fontSize: 13, color: C.slate, marginBottom: 16 }}>Create your first reusable cold email template or draft one with AI.</div>
                  <button
                    onClick={() => setShowNewTemplateModal(true)}
                    style={{ padding: "8px 16px", borderRadius: 8, background: C.ink, color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                  >
                    + Create Template
                  </button>
                </div>
              ) : (
                <div className="stack-narrow" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  {templates.map((tpl) => (
                    <div key={tpl.id} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <div style={{ fontWeight: 700, fontSize: 15, color: C.ink }}>{tpl.name}</div>
                          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: HUB_PAPER, border: `1px solid ${C.border}`, color: C.slate }}>
                            {tpl.category || "Outbound"}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.ink, marginBottom: 8, background: HUB_PAPER, padding: "6px 10px", borderRadius: 6 }}>
                          Subject: {tpl.subject}
                        </div>
                        <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.45, maxHeight: 110, overflow: "hidden", whiteSpace: "pre-wrap" }}>
                          {tpl.body_text}
                        </div>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 14, paddingTop: 10, borderTop: `1px solid ${C.borderLight}` }}>
                        <button
                          type="button"
                          onClick={() => handleDeleteTemplate(tpl.id)}
                          style={{ border: "none", background: "transparent", color: "#DC2626", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                        >
                          Delete
                        </button>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(`Subject: ${tpl.subject}\n\n${tpl.body_text}`);
                              showToast("Copied template to clipboard!");
                            }}
                            style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                          >
                            <Copy size={12} /> Copy
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setGeneratedDraft({
                                subject: tpl.subject,
                                preview: (tpl.body_text || "").slice(0, 40) + "...",
                                body: tpl.body_text
                              });
                              setView("drafter");
                              showToast(`Loaded "${tpl.name}" into AI Drafter!`);
                            }}
                            style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 6, background: "linear-gradient(135deg, #F59E0B, #D97706)", color: "#fff", border: "none", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}
                          >
                            <PenLine size={12} /> Use in AI Drafter
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Create Template Modal */}
              {showNewTemplateModal && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
                  <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 540, padding: "24px 28px", boxShadow: "0 20px 40px rgba(0,0,0,0.2)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <div style={{ fontWeight: 700, fontSize: 16, color: C.ink }}>Create New Email Template</div>
                      <button onClick={() => setShowNewTemplateModal(false)} style={{ border: "none", background: "transparent", cursor: "pointer" }}>
                        <X size={18} color={C.slate} />
                      </button>
                    </div>

                    <form onSubmit={handleCreateNewTemplate} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div>
                        <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 4 }}>Template Name</label>
                        <input
                          type="text"
                          required
                          value={newTemplateForm.name}
                          onChange={(e) => setNewTemplateForm({ ...newTemplateForm, name: e.target.value })}
                          placeholder="e.g. Cold Executive Hook v2"
                          style={{ width: "100%", boxSizing: "border-box", padding: "8px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13 }}
                        />
                      </div>

                      <div>
                        <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 4 }}>Category</label>
                        <select
                          value={newTemplateForm.category}
                          onChange={(e) => setNewTemplateForm({ ...newTemplateForm, category: e.target.value })}
                          style={{ width: "100%", padding: "8px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 12.5 }}
                        >
                          <option value="Outbound">Outbound / Cold Approach</option>
                          <option value="Follow-Up">Follow-Up / Proof</option>
                          <option value="Nudge">Nudge / Quick Check-In</option>
                          <option value="Breakup">Final Breakup Note</option>
                        </select>
                      </div>

                      <div>
                        <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 4 }}>Subject Line</label>
                        <input
                          type="text"
                          required
                          value={newTemplateForm.subject}
                          onChange={(e) => setNewTemplateForm({ ...newTemplateForm, subject: e.target.value })}
                          placeholder="e.g. Eliminating operational latency for {{companyName}}"
                          style={{ width: "100%", boxSizing: "border-box", padding: "8px 11px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13 }}
                        />
                      </div>

                      <div>
                        <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 4 }}>Email Body</label>
                        <textarea
                          rows={6}
                          required
                          value={newTemplateForm.body_text}
                          onChange={(e) => setNewTemplateForm({ ...newTemplateForm, body_text: e.target.value })}
                          placeholder="Hi {{firstName}},&#10;&#10;Noticed your team is scaling operations..."
                          style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: FONT_BODY, lineHeight: 1.5 }}
                        />
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                        <button
                          type="button"
                          onClick={() => setShowNewTemplateModal(false)}
                          style={{ padding: "8px 14px", borderRadius: 7, border: `1px solid ${C.border}`, background: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: "linear-gradient(135deg, #F59E0B, #D97706)", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
                        >
                          Save Template to Database
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {view === "campaigns" && <CampaignsView />}
          {view === "mailboxes" && <MailboxesView />}
          {view === "find" && <FindView />}
          {view === "inbox" && <RepliesView />}
          {view === "donotemail" && <DoNotEmailView />}
          {view === "subscription" && operator?.is_admin && <SubscriptionPage wallet="email" back="/emailoutreach/subscription" />}


        </div>

      </div>


      {/* Toast */}
      {toastMessage && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: C.ink, color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.2)", zIndex: 9999 }}>
          {toastMessage}
        </div>
      )}

    </div>
  );
}
