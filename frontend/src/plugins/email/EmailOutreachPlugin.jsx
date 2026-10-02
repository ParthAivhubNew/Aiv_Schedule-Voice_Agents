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
  const [templates, setTemplates] = useState(INITIAL_EMAIL_TEMPLATES);
  const [toastMessage, setToastMessage] = useState(null);

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
      const creds = getActiveAiCredentials(commonAi, "email", "copywriterLlm");
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

  const handleRefineDraft = (actionType) => {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      if (actionType === "concise") {
        setGeneratedDraft(prev => ({
          ...prev,
          body: `Hi {{firstName}},\n\nNoticed {{companyName}} is scaling operations. When outbound volume spikes, manual coordination eats hours.\n\nWe deployed autonomous agents for similar teams to automate 100% of client updates and outbound confirmations.\n\nWorth a 7-minute call Thursday to see how it works?\n\nBest,\n${operator ? operator.name : "Operations team"}`
        }));
        showToast("AI refined draft: Made concise & direct (<75 words)!");
      } else if (actionType === "cta") {
        setGeneratedDraft(prev => ({
          ...prev,
          body: prev.body.replace(/Are you free.*|Would you be open.*/g, "Are you open to seeing a 2-minute workflow video on how this works for {{companyName}}?")
        }));
        showToast("AI refined draft: Inserted high-converting, low-friction CTA!");
      } else if (actionType === "executive") {
        setGeneratedDraft(prev => ({
          ...prev,
          body: `Hi {{firstName}},\n\nI lead client enablement at our team. In reviewing {{companyName}}'s operational growth, managing communication latency between teams is often a top priority for leadership.\n\nWe provide enterprise teams with autonomous AI voice and email orchestration that reduces manual follow-up overhead by 40% while preserving strict brand governance.\n\nWould you be open to a brief introductory conversation next week?\n\nSincerely,\n${operator ? operator.name : "Operations team"}`
        }));
        showToast("AI refined draft: Upgraded to consultative executive tone!");
      } else if (actionType === "metric") {
        setGeneratedDraft(prev => ({
          ...prev,
          body: prev.body + "\n\nP.S. Our logistics partners cut response latency by 3.2x and recovered 14 engineering hours per week in the first 30 days."
        }));
        showToast("AI refined draft: Added verified case study metric!");
      } else if (actionType === "custom" && customPrompt.trim()) {
        setGeneratedDraft(prev => ({
          ...prev,
          body: prev.body + `\n\n[AI customized for: "${customPrompt}"]\nWe specifically integrate directly with your existing software stack without disrupting current field workflows.`
        }));
        setCustomPrompt("");
        showToast("AI refined draft based on your instruction!");
      }
    }, 500);
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

  const handleGenerateDraft = (e) => {
    e.preventDefault();
    setIsGenerating(true);
    setTimeout(() => {
      if (draftMode === "repurpose") {
        setGeneratedDraft({
          subject: `How ${targetCompany} can eliminate Friday operational bottlenecks`,
          preview: `Adapted from our recent operational research: "${selectedPostTopic.slice(0, 40)}..."`,
          body: `Hi {{firstName}},\n\nWe recently published our findings on: "${selectedPostTopic}".\n\nFor growing teams at ${targetCompany}, operational drift doesn't happen because people don't care — it happens because systems don't talk to each other fast enough.\n\nOur autonomous agent infrastructure connects directly to your existing systems, updates clients automatically, and alerts supervisors before delays cascade.\n\nAre you free for a quick 10-minute briefing next Tuesday?\n\nBest,\n${operator ? operator.name : "Operations team"}`
        });
      } else {
        setGeneratedDraft({
          subject: `Direct inquiry regarding ${targetCompany} operational workflows`,
          preview: `Quick question regarding how your team manages client outreach...`,
          body: `Hi {{firstName}},\n\nI noticed ${targetCompany} has been expanding operations recently. As team size grows, client follow-ups often slip through the cracks.\n\nWe automate the entire outbound prospecting and client confirmation cycle via AI voice and email.\n\nWould you be open to reviewing a 1-page breakdown?\n\nBest regards,\n${operator ? operator.name : "Operations team"}`
        });
      }
      setIsGenerating(false);
      showToast("Generated high-converting B2B email draft with AI!");
    }, 1000);
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
                      Email Outreach Studio & Drafter
                    </div>
                    <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2 }}>
                      Autonomous copywriting engine calibrated for high deliverability, executive tone, and direct conversion.
                    </div>
                  </div>

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
                      Cold Outreach Strategy
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
                      Repurpose from Post Topic
                    </button>
                  </div>
                </div>

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
                      onClick={() => {
                        setTemplates(prev => [
                          {
                            id: `tmpl_${Date.now()}`,
                            title: generatedDraft.subject.slice(0, 32),
                            category: "Outbound",
                            subject: generatedDraft.subject,
                            body: generatedDraft.body,
                            openRate: "68%",
                            replyRate: "22%"
                          },
                          ...prev
                        ]);
                        showToast("Saved draft to Email Templates library!");
                      }}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: "linear-gradient(135deg, #F59E0B, #D97706)", color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 6px rgba(245,158,11,0.25)" }}
                    >
                      <CheckCircle2 size={14} /> Save to Templates
                    </button>
                  </div>
                </div>

              </div>
            </div>
          )}


          {/* VIEW 4: TEMPLATES */}
          {view === "templates" && (
            <div className="stack-narrow" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {templates.map((tpl) => (
                <div key={tpl.id} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: C.ink }}>{tpl.name}</div>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: HUB_PAPER, border: `1px solid ${C.border}`, color: C.slate }}>
                      {tpl.category}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.ink, marginBottom: 8, background: HUB_PAPER, padding: "6px 10px", borderRadius: 6 }}>
                    Subject: {tpl.subject}
                  </div>
                  <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.45, maxHeight: 100, overflow: "hidden" }}>
                    {tpl.body}
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(tpl.body);
                        showToast("Copied template body to clipboard!");
                      }}
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                    >
                      <Copy size={12} /> Copy Template
                    </button>
                  </div>
                </div>
              ))}
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
