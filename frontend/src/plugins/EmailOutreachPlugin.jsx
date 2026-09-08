import React, { useState } from "react";
import {
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
  MessageSquare
} from "lucide-react";
import { C, FONT_DISPLAY, FONT_BODY, FONT_MONO, HUB_PAPER, initialsFromName } from "../tokens";

const INITIAL_CAMPAIGN_SEQUENCES = [
  {
    id: "seq_1",
    name: "Operational Friction Outbound",
    targetAudience: "Logistics & Fleet Operations VPs",
    status: "active",
    enrollments: 412,
    openRate: "68.4%",
    replyRate: "24.6%",
    cadence: "3-step cadence over 8 days",
    steps: [
      { stepNumber: 1, delayDays: 0, type: "Initial Hook", subject: "Eliminating dispatch friction at {{company}}", preview: "Hi {{firstName}}, noticed you recently expanded terminal capacity..." },
      { stepNumber: 2, delayDays: 3, type: "Customer Story Proof", subject: "How similar fleets cut driver check-in delays by 65%", preview: "Quick follow-up on my note regarding autonomous ops updates..." },
      { stepNumber: 3, delayDays: 7, type: "Executive Breakup", subject: "Permission to close your file for now?", preview: "I assume your dispatch systems are locked in for the quarter..." }
    ]
  },
  {
    id: "seq_2",
    name: "Series A Tech Scaler Follow-up",
    targetAudience: "COOs & Heads of People",
    status: "active",
    enrollments: 280,
    openRate: "74.1%",
    replyRate: "31.2%",
    cadence: "3-step cadence over 6 days",
    steps: [
      { stepNumber: 1, delayDays: 0, type: "Funding Congratulatory Hook", subject: "Congrats on the Series A at {{company}}", preview: "Scaling operations without hiring 10 more coordinators..." },
      { stepNumber: 2, delayDays: 2, type: "System Integration", subject: "Connecting directly with {{company}} Slack / CRM", preview: "Our platform arrives useful on day one..." },
      { stepNumber: 3, delayDays: 6, type: "Briefing Offer", subject: "10-minute preview before your board meeting?", preview: "Happy to send a 1-page operational benchmark if preferred..." }
    ]
  },
  {
    id: "seq_3",
    name: "Diagnostic Clinic No-Show Reduction",
    targetAudience: "Clinical Directors & Operations Leads",
    status: "paused",
    enrollments: 165,
    openRate: "61.8%",
    replyRate: "18.5%",
    cadence: "2-step cadence over 5 days",
    steps: [
      { stepNumber: 1, delayDays: 0, type: "HIPAA Compliant Alert", subject: "Specialty scan attendance rate at {{company}}", preview: "Most diagnostic clinics lose $14k/month to missed slots..." },
      { stepNumber: 2, delayDays: 4, type: "ROI Demonstration", subject: "Cutting specialty appointment drop-offs", preview: "Automated pre-visit confirmations with zero staff overhead..." }
    ]
  }
];

const INITIAL_INBOX_THREADS = [
  {
    id: "thread_1",
    prospectName: "Marcus Vance",
    company: "Apex Freight Logistics Inc.",
    email: "m.vance@apexfreight.com",
    phone: "+1 (214) 555-0182",
    sentiment: "positive",
    sentimentLabel: "Meeting Requested",
    receivedAt: "18 mins ago",
    unread: true,
    subject: "Re: Eliminating dispatch friction at Apex Freight",
    lastMessage: "This sounds relevant. We have 3 new depots coming online in Dallas next month and dispatch is already underwater. Are you free Thursday at 2 PM CT for a quick call?",
    history: [
      { who: "them", text: "This sounds relevant. We have 3 new depots coming online in Dallas next month and dispatch is already underwater. Are you free Thursday at 2 PM CT for a quick call?" }
    ]
  },
  {
    id: "thread_2",
    prospectName: "Sarah Lindqvist",
    company: "CloudScale Systems Ltd",
    email: "s.lindqvist@cloudscale.io",
    phone: "+44 20 7946 0921",
    sentiment: "question",
    sentimentLabel: "Pricing & Integrations",
    receivedAt: "1 hour ago",
    unread: false,
    subject: "Re: Congrats on the Series A at CloudScale",
    lastMessage: "Thanks for reaching out. Does this integrate directly with HubSpot and Slack for notification triggers? Also what does your mid-market pricing look like?",
    history: [
      { who: "them", text: "Thanks for reaching out. Does this integrate directly with HubSpot and Slack for notification triggers? Also what does your mid-market pricing look like?" }
    ]
  },
  {
    id: "thread_3",
    prospectName: "Dr. Arthur Pendelton",
    company: "Beacon Health Diagnostics",
    email: "a.pendelton@beaconhealth.org",
    phone: "+1 (312) 555-0199",
    sentiment: "positive",
    sentimentLabel: "High Intent",
    receivedAt: "3 hours ago",
    unread: false,
    subject: "Re: Specialty scan attendance rate at Beacon Health",
    lastMessage: "We're evaluating solutions to reduce MRI and ultrasound no-shows right now. Send over your technical compliance sheet.",
    history: [
      { who: "them", text: "We're evaluating solutions to reduce MRI and ultrasound no-shows right now. Send over your technical compliance sheet." }
    ]
  }
];

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
  const [view, setView] = useState("campaigns"); // "campaigns" | "drafter" | "inbox" | "templates" | "analytics"
  const [campaigns, setCampaigns] = useState(INITIAL_CAMPAIGN_SEQUENCES);
  const [inboxThreads, setInboxThreads] = useState(INITIAL_INBOX_THREADS);
  const [selectedThread, setSelectedThread] = useState(INITIAL_INBOX_THREADS[0]);
  const [templates, setTemplates] = useState(INITIAL_EMAIL_TEMPLATES);
  const [toastMessage, setToastMessage] = useState(null);

  // Drafter State
  const [draftMode, setDraftMode] = useState("cold"); // "cold" | "repurpose"
  const [targetCompany, setTargetCompany] = useState("Apex Freight Logistics");
  const [targetPersona, setTargetPersona] = useState("VP of Fleet Operations");
  const [selectedPostTopic, setSelectedPostTopic] = useState("Ops teams still closing the week in spreadsheets");
  const [isGenerating, setIsGenerating] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [generatedDraft, setGeneratedDraft] = useState({
    subject: "Eliminating dispatch friction at Apex Freight",
    preview: "Quick note on how automation cuts driver check-in delays...",
    body: "Hi Marcus,\n\nI noticed Apex Freight is expanding your Texas depots. As fleet volume grows, manual status checks create operational drag.\n\nWe automate the entire outbound confirmation and dispatch update cycle via AI voice and email.\n\nAre you free for a quick 10-minute briefing next Tuesday?\n\nBest,\n" + (operator ? operator.name : "AIVHub Operations")
  });

  const [showNewCampaignModal, setShowNewCampaignModal] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignAudience, setNewCampaignAudience] = useState("");

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
          body: `Hi {{firstName}},\n\nWe recently published our findings on: "${selectedPostTopic}".\n\nFor growing teams at ${targetCompany}, operational drift doesn't happen because people don't care — it happens because systems don't talk to each other fast enough.\n\nOur autonomous agent infrastructure connects directly to your existing systems, updates clients automatically, and alerts supervisors before delays cascade.\n\nAre you free for a quick 10-minute briefing next Tuesday?\n\nBest,\n${operator ? operator.name : "AIVHub Operations"}`
        });
      } else {
        setGeneratedDraft({
          subject: `Direct inquiry regarding ${targetCompany} operational workflows`,
          preview: `Quick question regarding how your team manages client outreach...`,
          body: `Hi {{firstName}},\n\nI noticed ${targetCompany} has been expanding operations recently. As team size grows, client follow-ups often slip through the cracks.\n\nWe automate the entire outbound prospecting and client confirmation cycle via AI voice and email.\n\nWould you be open to reviewing a 1-page breakdown?\n\nBest regards,\n${operator ? operator.name : "AIVHub Operations"}`
        });
      }
      setIsGenerating(false);
      showToast("Generated high-converting B2B email draft with AI!");
    }, 1000);
  };

  const handleSendReply = () => {
    if (!selectedThread) return;
    showToast(`Reply sent to ${selectedThread.prospectName} (${selectedThread.email})!`);
    setReplyText("");
  };

  const handleCreateCampaign = (e) => {
    e.preventDefault();
    if (!newCampaignName.trim()) return;
    const created = {
      id: "seq_" + Date.now(),
      name: newCampaignName.trim(),
      targetAudience: newCampaignAudience.trim() || "Target Business Decision Makers",
      status: "active",
      enrollments: 0,
      openRate: "0.0%",
      replyRate: "0.0%",
      cadence: "3-step cadence over 7 days",
      steps: [
        { stepNumber: 1, delayDays: 0, type: "Initial Hook", subject: "Introduction & Value Angle", preview: "Hi {{firstName}}, quick note regarding..." },
        { stepNumber: 2, delayDays: 3, type: "Case Study Proof", subject: "Operational benchmark metrics", preview: "Sharing how peers solve this..." },
        { stepNumber: 3, delayDays: 7, type: "Follow-Up", subject: "Next steps for your team?", preview: "Checking in to see if this is relevant..." }
      ]
    };
    setCampaigns((prev) => [created, ...prev]);
    setShowNewCampaignModal(false);
    setNewCampaignName("");
    setNewCampaignAudience("");
    showToast("Created new outreach sequence cadence!");
  };

  const navItems = [
    { id: "campaigns", label: "Outreach Sequences", icon: Send, count: campaigns.length },
    { id: "drafter", label: "AI Email Drafter", icon: PenLine, count: "AI" },
    { id: "inbox", label: "Replies & Inbox", icon: Mail, count: inboxThreads.filter((t) => t.unread).length },
    { id: "templates", label: "Template Library", icon: BookOpen, count: templates.length },
    { id: "analytics", label: "Deliverability & Stats", icon: BarChart3 },
  ];

  const viewTitles = {
    campaigns: { title: "Outreach Sequences", desc: "Automated multi-step cold email cadences and deliverability metrics." },
    drafter: { title: "AI Email Drafter", desc: "Generate personalized cold pitches or repurpose social content into newsletters." },
    inbox: { title: "Unified Replies Inbox", desc: "Incoming client responses, sentiment tagging, and 1-click AI reply drafting." },
    templates: { title: "Email Template Library", desc: "Battle-tested B2B templates with dynamic personalization merge variables." },
    analytics: { title: "Deliverability & Domain Health", desc: "SPF/DKIM/DMARC status, inbox placement rates, and spam-trigger auditing." },
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: HUB_PAPER, fontFamily: FONT_BODY, overflow: "hidden" }}>
      
      {/* ----------------- LEFT DARK SIDEBAR (MATCHING OTHER PLUGINS) ----------------- */}
      <div
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

        {/* Back to Workspace button */}
        {onBackToHub && (
          <button
            onClick={onBackToHub}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              margin: "0 4px 16px 4px",
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${C.inkLine}`,
              background: "transparent",
              color: "#C8CCD6",
              fontFamily: FONT_BODY,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <ChevronLeft size={14} /> Back to Plugins
          </button>
        )}

        {/* Navigation items */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
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
                  fontFamily: FONT_BODY,
                  fontSize: 13.5,
                  fontWeight: active ? 600 : 500,
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
        <div style={{ marginTop: "auto", padding: "12px 10px", borderTop: `1px solid ${C.inkLine}` }}>
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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100vh" }}>
        
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
            {view === "campaigns" && (
              <button
                onClick={() => setShowNewCampaignModal(true)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 8,
                  background: C.ink,
                  color: "#fff",
                  fontFamily: FONT_BODY,
                  fontSize: 12.5,
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <Plus size={14} /> New Sequence
              </button>
            )}

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
          
          {/* VIEW 1: OUTREACH SEQUENCES */}
          {view === "campaigns" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              
              {/* KPI metrics row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
                {[
                  { label: "Active Sequences", val: campaigns.length, color: "#F59E0B" },
                  { label: "Contacts Enrolled", val: "857", color: "#2563EB" },
                  { label: "Average Open Rate", val: "68.4%", color: "#059669" },
                  { label: "Reply Rate", val: "24.6%", color: "#8B5CF6" },
                ].map((stat, i) => (
                  <div key={i} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 18px" }}>
                    <div style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>{stat.label}</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 700, color: stat.color, marginTop: 4 }}>{stat.val}</div>
                  </div>
                ))}
              </div>

              {/* Sequence Cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {campaigns.map((seq) => (
                  <div key={seq.id} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, boxShadow: "0 2px 6px rgba(0,0,0,0.02)" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink }}>{seq.name}</span>
                          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: seq.status === "active" ? "#ECFDF5" : HUB_PAPER, color: seq.status === "active" ? "#059669" : C.slate }}>
                            {seq.status === "active" ? "Active" : "Paused"}
                          </span>
                        </div>
                        <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2 }}>Targeting: {seq.targetAudience} · {seq.cadence}</div>
                      </div>

                      <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 11, color: C.slate }}>Open Rate</div>
                          <div style={{ fontWeight: 700, color: "#059669", fontSize: 14 }}>{seq.openRate}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 11, color: C.slate }}>Reply Rate</div>
                          <div style={{ fontWeight: 700, color: "#2563EB", fontSize: 14 }}>{seq.replyRate}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 11, color: C.slate }}>Enrolled</div>
                          <div style={{ fontWeight: 700, color: C.ink, fontSize: 14 }}>{seq.enrollments}</div>
                        </div>
                      </div>
                    </div>

                    {/* Step pills */}
                    <div style={{ display: "grid", gridTemplateColumns: `repeat(${seq.steps.length}, 1fr)`, gap: 10, background: HUB_PAPER, padding: 12, borderRadius: 8, border: `1px solid ${C.border}` }}>
                      {seq.steps.map((st) => (
                        <div key={st.stepNumber} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 3 }}>
                            <span>Step {st.stepNumber} ({st.type})</span>
                            <span>{st.delayDays === 0 ? "Day 1" : `+${st.delayDays}d`}</span>
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{st.subject}</div>
                          <div style={{ fontSize: 11, color: C.slate, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{st.preview}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

            </div>
          )}

          {/* VIEW 2: AI EMAIL DRAFTER */}
          {view === "drafter" && (
            <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 20 }}>
              
              {/* Left Config Panel */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, marginBottom: 14 }}>
                  AI Drafting Engine
                </div>

                <div style={{ display: "flex", background: HUB_PAPER, padding: 4, borderRadius: 8, gap: 4, marginBottom: 16, border: `1px solid ${C.border}` }}>
                  <button
                    type="button"
                    onClick={() => setDraftMode("cold")}
                    style={{ flex: 1, padding: "7px 10px", borderRadius: 6, border: "none", background: draftMode === "cold" ? "#fff" : "transparent", color: draftMode === "cold" ? C.ink : C.slate, fontWeight: draftMode === "cold" ? 700 : 500, fontSize: 12.5, cursor: "pointer" }}
                  >
                    Cold Outreach
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraftMode("repurpose")}
                    style={{ flex: 1, padding: "7px 10px", borderRadius: 6, border: "none", background: draftMode === "repurpose" ? "#fff" : "transparent", color: draftMode === "repurpose" ? C.ink : C.slate, fontWeight: draftMode === "repurpose" ? 700 : 500, fontSize: 12.5, cursor: "pointer" }}
                  >
                    Repurpose Content
                  </button>
                </div>

                <form onSubmit={handleGenerateDraft} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Target Company Name</label>
                    <input
                      type="text"
                      value={targetCompany}
                      onChange={(e) => setTargetCompany(e.target.value)}
                      style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Target Decision Maker Persona</label>
                    <input
                      type="text"
                      value={targetPersona}
                      onChange={(e) => setTargetPersona(e.target.value)}
                      style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 13 }}
                    />
                  </div>

                  {draftMode === "repurpose" && (
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Source Content Topic</label>
                      <select
                        value={selectedPostTopic}
                        onChange={(e) => setSelectedPostTopic(e.target.value)}
                        style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 12.5, background: "#fff" }}
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
                      justifyContent: "center",
                      gap: 8,
                      padding: "10px 16px",
                      borderRadius: 8,
                      background: "linear-gradient(135deg, #F59E0B, #D97706)",
                      color: "#fff",
                      border: "none",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: isGenerating ? "wait" : "pointer",
                      marginTop: 8,
                    }}
                  >
                    <Sparkles size={15} />
                    <span>{isGenerating ? "Drafting Email..." : "Generate AI Email Draft"}</span>
                  </button>
                </form>
              </div>

              {/* Right Preview Output */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>
                    Generated Outreach Copy
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: "#ECFDF5", color: "#059669" }}>
                    Deliverability 98/100
                  </span>
                </div>

                <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.slate }}>Subject Line:</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginTop: 2 }}>{generatedDraft.subject}</div>
                </div>

                <textarea
                  value={generatedDraft.body}
                  onChange={(e) => setGeneratedDraft((d) => ({ ...d, body: e.target.value }))}
                  rows={10}
                  style={{ width: "100%", boxSizing: "border-box", padding: 12, borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: FONT_BODY, lineHeight: 1.5, flex: 1 }}
                />
              </div>

            </div>
          )}

          {/* VIEW 3: INBOX & REPLIES */}
          {view === "inbox" && (
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.8fr", gap: 16, minHeight: 480 }}>
              
              {/* Left Inbox List */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}`, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>
                  Client Replies ({inboxThreads.length})
                </div>

                <div style={{ overflowY: "auto", flex: 1 }}>
                  {inboxThreads.map((thread) => {
                    const active = selectedThread?.id === thread.id;
                    return (
                      <div
                        key={thread.id}
                        onClick={() => setSelectedThread(thread)}
                        style={{
                          padding: "14px 16px",
                          borderBottom: `1px solid ${C.borderLight}`,
                          background: active ? "#FFFBEB" : "#fff",
                          cursor: "pointer",
                          borderLeft: active ? "3px solid #F59E0B" : "3px solid transparent",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: C.ink }}>{thread.prospectName}</span>
                          <span style={{ fontSize: 10.5, color: C.slate }}>{thread.receivedAt}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: C.slate, marginBottom: 5 }}>{thread.company}</div>
                        <div style={{ fontSize: 12, color: C.textInk, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {thread.lastMessage}
                        </div>
                        <span style={{ display: "inline-block", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "#ECFDF5", color: "#059669", marginTop: 6 }}>
                          {thread.sentimentLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Conversation & Reply Box */}
              {selectedThread ? (
                <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 14, borderBottom: `1px solid ${C.border}`, marginBottom: 14 }}>
                    <div>
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>{selectedThread.prospectName}</div>
                      <div style={{ fontSize: 12, color: C.slate }}>{selectedThread.email} · {selectedThread.company}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 4, background: "#ECFDF5", color: "#059669" }}>
                      {selectedThread.sentimentLabel}
                    </span>
                  </div>

                  {/* Message body */}
                  <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, fontSize: 13, color: C.textInk, lineHeight: 1.5, marginBottom: 16 }}>
                    <div style={{ fontWeight: 700, fontSize: 12.5, color: C.ink, marginBottom: 6 }}>{selectedThread.subject}</div>
                    {selectedThread.lastMessage}
                  </div>

                  {/* 1-Click AI Reply */}
                  <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <label style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Compose Reply</label>
                      <button
                        type="button"
                        onClick={() => {
                          setReplyText(`Hi ${selectedThread.prospectName.split(" ")[0]},\n\nThanks for your reply! Thursday at 2 PM CT works well for our team. I will send over a calendar invite with the Zoom briefing link shortly.\n\nLooking forward to speaking,\n${operator ? operator.name : "AIVHub Team"}`);
                          showToast("Generated smart AI reply draft!");
                        }}
                        style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 11.5, color: "#D97706", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}
                      >
                        <Sparkles size={12} /> Auto-Draft AI Reply
                      </button>
                    </div>

                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Type reply or click Auto-Draft AI Reply above..."
                      rows={4}
                      style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: FONT_BODY }}
                    />

                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <button
                        onClick={handleSendReply}
                        disabled={!replyText.trim()}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 8, background: C.ink, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 600, cursor: replyText.trim() ? "pointer" : "not-allowed" }}
                      >
                        <Send size={13} /> Send Reply
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

            </div>
          )}

          {/* VIEW 4: TEMPLATES */}
          {view === "templates" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
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

          {/* VIEW 5: ANALYTICS & DELIVERABILITY */}
          {view === "analytics" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
                <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: 18 }}>
                  <div style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>SPF Authentication</div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: "#059669", marginTop: 4 }}>Valid (Passed)</div>
                  <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2 }}>Domain authorized for outbound mail</div>
                </div>
                <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: 18 }}>
                  <div style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>DKIM Signature</div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: "#059669", marginTop: 4 }}>Active (2048-bit)</div>
                  <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2 }}>Cryptographic header verification</div>
                </div>
                <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: 18 }}>
                  <div style={{ fontSize: 12, color: C.slate, fontWeight: 600 }}>DMARC Policy</div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: "#059669", marginTop: 4 }}>Enforced</div>
                  <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2 }}>Protection against domain spoofing</div>
                </div>
              </div>

              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, marginBottom: 8 }}>
                  Outreach Spam Filter Audit
                </div>
                <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 14 }}>
                  Zero spam words detected across all 3 active outreach sequence steps. Primary inbox delivery rate is 98.4%.
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#059669", background: "#ECFDF5", padding: "4px 10px", borderRadius: 6 }}>
                    ✓ 0 Spam Trigger Words
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#059669", background: "#ECFDF5", padding: "4px 10px", borderRadius: 6 }}>
                    ✓ Unsubscribe Header Included
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#059669", background: "#ECFDF5", padding: "4px 10px", borderRadius: 6 }}>
                    ✓ Custom Tracking Domain Active
                  </span>
                </div>
              </div>
            </div>
          )}

        </div>

      </div>

      {/* New Campaign Modal */}
      {showNewCampaignModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
          <div style={{ background: "#fff", borderRadius: 14, width: 460, maxWidth: "95vw", padding: 22, border: `1px solid ${C.border}`, boxShadow: "0 20px 50px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>Create Outreach Sequence</div>
              <button onClick={() => setShowNewCampaignModal(false)} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.slate }}><X size={16} /></button>
            </div>
            <form onSubmit={handleCreateCampaign} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Sequence Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Mid-Market CFO Outbound"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5 }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Target Audience</label>
                <input
                  type="text"
                  placeholder="e.g. Operations Directors in UK"
                  value={newCampaignAudience}
                  onChange={(e) => setNewCampaignAudience(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5 }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                <button type="button" onClick={() => setShowNewCampaignModal(false)} style={{ padding: "7px 14px", borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", fontSize: 12 }}>Cancel</button>
                <button type="submit" style={{ padding: "7px 16px", borderRadius: 6, background: C.ink, color: "#fff", border: "none", fontSize: 12, fontWeight: 600 }}>Create Sequence</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMessage && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: C.ink, color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.2)", zIndex: 9999 }}>
          {toastMessage}
        </div>
      )}

    </div>
  );
}
