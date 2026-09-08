import React, { useState } from "react";
import {
  Mail,
  Send,
  Sparkles,
  Inbox,
  Reply,
  CheckCircle2,
  Clock,
  User,
  Building2,
  TrendingUp,
  LayoutGrid,
  PhoneCall,
  CalendarDays,
  FileText,
  Copy,
  Check,
  Plus,
  ArrowRight,
  Filter,
  RefreshCw,
  AlertCircle
} from "lucide-react";
import { C, FONT_DISPLAY, FONT_BODY, FONT_MONO, HUB_PAPER } from "../tokens";

const INITIAL_CAMPAIGN_SEQUENCES = [
  {
    id: "seq_1",
    title: "Q3 Fleet & Logistics Automated Dispatch Sequence",
    targetAudience: "VP Operations & Fleet Managers",
    status: "active",
    contactsCount: 84,
    deliveredRate: "99.4%",
    openRate: "58.4%",
    replyRate: "18.2%",
    meetingsBooked: 8,
    steps: [
      {
        stepNum: 1,
        delay: "Day 1",
        subject: "Quick question regarding {{company}} fleet dispatch bottlenecks",
        preview: "Noticed your Dallas terminal expansion. How are you handling driver notifications during shift changes?",
        body: "Hi {{firstName}},\n\nI noticed {{company}} has been expanding regional distribution capacity recently. When talking with fleet operations directors, the #1 bottleneck on Friday afternoons is dispatchers being buried in spreadsheets and manual call updates.\n\nWe built an autonomous voice & notification workflow that connects to your dispatch software and updates drivers automatically.\n\nWorth a 7-minute look this Thursday afternoon?\n\nBest,\nOperations Team"
      },
      {
        stepNum: 2,
        delay: "Day 3 (if no reply)",
        subject: "Case study: How Apex cut dispatch call backlog by 60%",
        preview: "Here is the exact numbers dashboard they deployed without replacing their TMS...",
        body: "Hi {{firstName}},\n\nFollowing up on my previous note. Apex Logistics recently cut their weekend driver check-in backlog by 60% by letting automated voice agents handle the initial load confirmations.\n\nI put together a 1-page breakdown of how their operations team runs it.\n\nShould I send the link over to you?\n\nBest,"
      },
      {
        stepNum: 3,
        delay: "Day 7 (if no reply)",
        subject: "Permission to close file for {{company}}?",
        preview: "Checking in one last time before archiving our notes...",
        body: "Hi {{firstName}},\n\nAssuming automated dispatch calls aren't a priority for {{company}} right now. I will close your file for this quarter.\n\nIf you ever want to see how other mid-market fleets are automating driver check-ins, feel free to reach back out anytime.\n\nBest regards,"
      }
    ]
  },
  {
    id: "seq_2",
    title: "Content Repurpose: Freight Tech Industry Newsletter",
    targetAudience: "Operations Directors (From 2. Post Scheduler)",
    status: "active",
    contactsCount: 142,
    deliveredRate: "98.9%",
    openRate: "62.1%",
    replyRate: "14.5%",
    meetingsBooked: 5,
    steps: [
      {
        stepNum: 1,
        delay: "Day 1",
        subject: "Why mid-market operations teams are stuck between boards and warehouses",
        preview: "Boards get a PDF. The warehouse gets a WhatsApp. How we fix the data gap...",
        body: "Hi {{firstName}},\n\nBoards get a monthly PDF report. The warehouse gets a chaotic WhatsApp group. Mid-market operators sit in the middle trying to figure out which number to trust at 4 PM on a Friday.\n\nWe recently published our breakdown on why operations reporting breaks down and how live agent monitoring solves it.\n\nRead the full breakdown or reply to discuss how this applies to {{company}}."
      }
    ]
  }
];

const INITIAL_INBOX_THREADS = [
  {
    id: "inbox_1",
    prospectName: "Marcus Vance",
    company: "Apex Freight Logistics Inc.",
    email: "m.vance@apexfreight.com",
    phone: "+1 (214) 555-0182",
    sentiment: "High Intent / Pricing",
    time: "14 mins ago",
    unread: true,
    lastMessage: "Sounds interesting. What does pricing look like for 25 parallel lines, and can it integrate with McLeod TMS?",
    aiSuggestedReply: "Hi Marcus,\n\nPricing for 25 parallel lines starts at $450/mo with zero per-minute surcharges on standard SIP trunks. We have an existing webhook bridge for McLeod TMS dispatch events.\n\nAre you free Thursday at 2:00 PM CST to inspect the live TMS bridge demo?",
    readyForVoiceCall: true
  },
  {
    id: "inbox_2",
    prospectName: "Sarah Lindqvist",
    company: "CloudScale Systems Ltd",
    email: "s.lindqvist@cloudscale.io",
    phone: "+44 20 7946 0921",
    sentiment: "Meeting Request",
    time: "1 hour ago",
    unread: true,
    lastMessage: "I saw the Series A note. Yes, we are overwhelmed with demo qualification. Are you free this Thursday at 3:00 PM GMT?",
    aiSuggestedReply: "Hi Sarah,\n\nThursday at 3:00 PM GMT works perfectly. I will send a calendar invite with the screen share link right now.\n\nLooking forward to speaking!",
    readyForVoiceCall: true
  },
  {
    id: "inbox_3",
    prospectName: "Dr. Arthur Pendelton",
    company: "Beacon Health Diagnostics",
    email: "a.pendelton@beaconhealth.org",
    phone: "+1 (312) 555-0199",
    sentiment: "Technical Question",
    time: "Yesterday",
    unread: false,
    lastMessage: "Is your voice agent HIPAA compliant for specialty diagnostic scheduling?",
    aiSuggestedReply: "Hi Dr. Pendelton,\n\nYes, all speech pipelines support on-prem private transcription models (Faster-Whisper & Kokoro TTS) and execute BAA HIPAA agreements.\n\nShall I forward our security compliance package?",
    readyForVoiceCall: false
  }
];

export default function EmailOutreachPlugin({
  operator,
  onBackToHub,
  onLogout,
  profile,
  commonAi,
  onOpenCommonAi,
  onNavigateToPlugin,
  sharedLeads = [],
  scheduledPosts = [],
  onEscalateToVoice
}) {
  const [activeTab, setActiveTab] = useState("campaigns"); // "campaigns" | "drafter" | "inbox"
  const [campaigns, setCampaigns] = useState(INITIAL_CAMPAIGN_SEQUENCES);
  const [inboxThreads, setInboxThreads] = useState(INITIAL_INBOX_THREADS);
  const [selectedThread, setSelectedThread] = useState(INITIAL_INBOX_THREADS[0]);
  const [activeSequence, setActiveSequence] = useState(INITIAL_CAMPAIGN_SEQUENCES[0]);
  const [toastMessage, setToastMessage] = useState(null);

  // Drafter State
  const [draftMode, setDraftMode] = useState("repurpose"); // "cold" | "reply" | "repurpose"
  const [targetCompany, setTargetCompany] = useState("Apex Freight Logistics");
  const [emailTone, setEmailTone] = useState("Consultative B2B");
  const [selectedPostTopic, setSelectedPostTopic] = useState(
    "Ops teams still closing the week in spreadsheets — that's the gap we built for"
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedDraft, setGeneratedDraft] = useState({
    subject: "Why operations teams still close Friday in spreadsheets",
    preview: "If Friday still means exporting CSV and praying numbers match...",
    body: `Hi {{firstName}},

Most mid-market operations directors tell us the same story: the board receives a polished slide deck once a month, but the warehouse floor is coordinated in an unmanageable WhatsApp thread.

When the shift ends on Friday, supervisors spend 90 minutes exporting spreadsheets just to know what shipped.

We built an autonomous operational intelligence engine that bridges the floor to management in real time.

Would you be open to a 7-minute look at how other operations leaders run this?

Best regards,
${operator ? operator.name : "AIVHub Operations Team"}`
  });

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
          body: `Hi {{firstName}},\n\nI noticed ${targetCompany} has been expanding its operations team recently. As team size grows, client follow-ups often slip through the cracks.\n\nWe automate the entire outbound prospecting and client confirmation cycle via AI voice and email.\n\nWould you be open to reviewing a 1-page breakdown?\n\nBest regards,`
        });
      }
      setIsGenerating(false);
      showToast("Generated high-converting B2B email draft with AI!");
    }, 1000);
  };

  const handleSendReply = () => {
    if (!selectedThread) return;
    showToast(`Reply sent to ${selectedThread.prospectName} (${selectedThread.email})!`);
  };

  const handleEscalateToVoice = (thread) => {
    if (onEscalateToVoice) {
      onEscalateToVoice(thread);
    }
    showToast(`Escalated ${thread.prospectName} (${thread.phone}) to 4. AI Voice Assistant dialer!`);
  };

  return (
    <div style={{ minHeight: "100vh", background: HUB_PAPER, fontFamily: FONT_BODY, display: "flex", flexDirection: "column" }}>
      {/* Top Bar */}
      <header
        style={{
          background: "#fff",
          borderBottom: `1px solid ${C.border}`,
          padding: "14px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {onBackToHub && (
            <button
              onClick={onBackToHub}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: "#fff",
                color: C.textInk,
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              <LayoutGrid size={14} /> All Plugins
            </button>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: "linear-gradient(135deg, #7C3AED 0%, #9333EA 100%)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 14
              }}
            >
              3
            </span>
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>
                Email Generation & Dispatch Plugin
              </div>
              <div style={{ fontSize: 11.5, color: C.slate }}>
                Automated Outbound Sequences, Reply AI Drafter & Social Content Repurposer
              </div>
            </div>
          </div>
        </div>

        {/* Funnel Switcher */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", background: C.paperSoft, padding: 3, borderRadius: 8, gap: 4 }}>
            <button
              onClick={() => onNavigateToPlugin && onNavigateToPlugin("leadgen")}
              style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: "transparent", color: C.slate, fontWeight: 600, fontSize: 11.5, cursor: "pointer" }}
            >
              1. Lead Gen
            </button>
            <button
              onClick={() => onNavigateToPlugin && onNavigateToPlugin("scheduler")}
              style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: "transparent", color: C.slate, fontWeight: 600, fontSize: 11.5, cursor: "pointer" }}
            >
              2. Post Scheduler
            </button>
            <button
              disabled
              style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: "#fff", color: "#7C3AED", fontWeight: 700, fontSize: 11.5, boxShadow: "0 1px 2px rgba(0,0,0,0.06)" }}
            >
              3. Email Dispatch
            </button>
            <button
              onClick={() => onNavigateToPlugin && onNavigateToPlugin("voice")}
              style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: "transparent", color: C.slate, fontWeight: 600, fontSize: 11.5, cursor: "pointer" }}
            >
              4. Voice Assistant
            </button>
          </div>

          <button
            onClick={onOpenCommonAi}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 12px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: "#fff",
              color: C.ink,
              fontFamily: FONT_BODY,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            <Sparkles size={14} color="#7C3AED" /> AI Config
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main style={{ flex: 1, padding: "24px 36px", overflowY: "auto", maxWidth: 1240, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        
        {/* Navigation Tabs */}
        <div style={{ display: "flex", gap: 8, borderBottom: `1px solid ${C.border}`, marginBottom: 24 }}>
          {[
            { id: "campaigns", label: "Outbound Sequences", icon: Mail, count: campaigns.length },
            { id: "drafter", label: "AI Email Drafter & Repurposer", icon: Sparkles },
            { id: "inbox", label: "Inbound Inbox & Reply AI", icon: Inbox, count: inboxThreads.filter((t) => t.unread).length }
          ].map((tab) => {
            const active = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 16px",
                  borderRadius: "8px 8px 0 0",
                  border: "none",
                  borderBottom: active ? `3px solid #7C3AED` : "3px solid transparent",
                  background: "transparent",
                  color: active ? "#7C3AED" : C.slate,
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  cursor: "pointer"
                }}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    style={{
                      fontSize: 10.5,
                      padding: "2px 7px",
                      borderRadius: 999,
                      background: active ? "#F3E8FF" : C.paperSoft,
                      color: active ? "#7C3AED" : C.slate,
                      fontWeight: 700
                    }}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* TAB 1: OUTBOUND SEQUENCES */}
        {activeTab === "campaigns" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Quick Metrics */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px" }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Delivered Emails</div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, color: C.ink, marginTop: 4 }}>1,482</div>
                <div style={{ fontSize: 11, color: C.green, marginTop: 2 }}>✓ 99.4% Inbox Delivery</div>
              </div>
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px" }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Average Open Rate</div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, color: "#7C3AED", marginTop: 4 }}>59.8%</div>
                <div style={{ fontSize: 11, color: C.slateLight, marginTop: 2 }}>Industry benchmark: 28%</div>
              </div>
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px" }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Client Reply Rate</div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, color: C.cobalt, marginTop: 4 }}>16.7%</div>
                <div style={{ fontSize: 11, color: C.slateLight, marginTop: 2 }}>Positive intent: 74%</div>
              </div>
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px" }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Meetings Booked</div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, color: C.green, marginTop: 4 }}>13</div>
                <div style={{ fontSize: 11, color: C.slateLight, marginTop: 2 }}>Handed off to Voice Assistant</div>
              </div>
            </div>

            {/* Campaign Sequences Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.8fr", gap: 20 }}>
              {/* Sequence Selector List */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>
                  Active Outreach Sequences
                </div>
                {campaigns.map((seq) => {
                  const active = activeSequence.id === seq.id;
                  return (
                    <div
                      key={seq.id}
                      onClick={() => setActiveSequence(seq)}
                      style={{
                        background: "#fff",
                        border: `1.5px solid ${active ? "#7C3AED" : C.border}`,
                        borderRadius: 12,
                        padding: 16,
                        cursor: "pointer",
                        boxShadow: active ? "0 4px 14px rgba(124,58,237,0.12)" : "none",
                        transition: "all 0.15s"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED", background: "#F3E8FF", padding: "2px 7px", borderRadius: 4 }}>
                          {seq.steps.length} Steps Sequence
                        </span>
                        <span style={{ fontSize: 11.5, color: C.green, fontWeight: 600 }}>Active</span>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: C.ink }}>{seq.title}</div>
                      <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>Audience: {seq.targetAudience}</div>

                      <div style={{ display: "flex", gap: 14, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}`, fontSize: 11.5 }}>
                        <div><strong style={{ color: C.ink }}>{seq.contactsCount}</strong> <span style={{ color: C.slate }}>Contacts</span></div>
                        <div><strong style={{ color: "#7C3AED" }}>{seq.openRate}</strong> <span style={{ color: C.slate }}>Opens</span></div>
                        <div><strong style={{ color: C.green }}>{seq.replyRate}</strong> <span style={{ color: C.slate }}>Replies</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Sequence Steps Detail Inspector */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>
                      Sequence Breakdown: {activeSequence.title}
                    </div>
                    <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                      Automated multi-step touchpoints with delay intervals
                    </div>
                  </div>
                  <button
                    onClick={() => showToast("Step added to campaign sequence!")}
                    style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 7, border: `1px solid ${C.border}`, background: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  >
                    <Plus size={13} /> Add Step
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {activeSequence.steps.map((step) => (
                    <div key={step.stepNum} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, background: HUB_PAPER }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 22, height: 22, borderRadius: 999, background: "#7C3AED", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 700 }}>
                            {step.stepNum}
                          </span>
                          <span style={{ fontWeight: 700, fontSize: 13, color: C.ink }}>
                            Step {step.stepNum}: {step.delay}
                          </span>
                        </div>
                        <span style={{ fontSize: 11, color: C.slate, background: "#fff", padding: "2px 6px", borderRadius: 4, border: `1px solid ${C.border}` }}>
                          Auto Trigger
                        </span>
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink, marginBottom: 4 }}>
                        Subject: <span style={{ fontFamily: FONT_BODY, fontWeight: 500, color: C.textInk }}>{step.subject}</span>
                      </div>
                      <div style={{ fontSize: 12, color: C.slate, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
                        {step.body}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: AI EMAIL DRAFTER & CONTENT REPURPOSER */}
        {activeTab === "drafter" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            {/* Form Controls */}
            <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <Sparkles size={18} color="#7C3AED" />
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>
                  AI Email Composer & Content Repurposer
                </div>
              </div>

              <form onSubmit={handleGenerateDraft} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: C.ink, display: "block", marginBottom: 5 }}>
                    Drafting Objective
                  </label>
                  <div style={{ display: "flex", gap: 6, background: C.paperSoft, padding: 3, borderRadius: 8 }}>
                    {[
                      { id: "repurpose", label: "Convert Post from 2. Post Scheduler" },
                      { id: "cold", label: "Cold Approach Email" }
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setDraftMode(m.id)}
                        style={{
                          flex: 1,
                          padding: "6px 8px",
                          borderRadius: 6,
                          border: "none",
                          fontSize: 11.5,
                          fontWeight: draftMode === m.id ? 700 : 500,
                          background: draftMode === m.id ? "#fff" : "transparent",
                          color: draftMode === m.id ? "#7C3AED" : C.slate,
                          cursor: "pointer",
                          boxShadow: draftMode === m.id ? "0 1px 2px rgba(0,0,0,0.06)" : "none"
                        }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {draftMode === "repurpose" && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: C.ink, display: "block", marginBottom: 5 }}>
                      Select Social Post from 2. Post Scheduler Bank
                    </label>
                    <select
                      value={selectedPostTopic}
                      onChange={(e) => setSelectedPostTopic(e.target.value)}
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, background: "#fff", color: C.textInk }}
                    >
                      <option value="Ops teams still closing the week in spreadsheets — that's the gap we built for">
                        "Ops teams still closing week in spreadsheets..." (LinkedIn / X)
                      </option>
                      <option value="What we shipped this month: live dispatch and utilisation in one view">
                        "What we shipped this month: live dispatch..." (Product Note)
                      </option>
                      <option value="A logistics ops director told us they were tracking performance in three tools">
                        "A logistics ops director told us they were tracking in 3 tools..." (Customer Story)
                      </option>
                    </select>
                  </div>
                )}

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: C.ink, display: "block", marginBottom: 5 }}>
                    Target Account or Sector
                  </label>
                  <input
                    type="text"
                    value={targetCompany}
                    onChange={(e) => setTargetCompany(e.target.value)}
                    placeholder="e.g. Apex Freight Logistics"
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, boxSizing: "border-box" }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: C.ink, display: "block", marginBottom: 5 }}>
                    Voice & Tone Directive
                  </label>
                  <select
                    value={emailTone}
                    onChange={(e) => setEmailTone(e.target.value)}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, background: "#fff", color: C.textInk }}
                  >
                    <option value="Consultative B2B">Consultative B2B (Actionable & Respectful)</option>
                    <option value="Direct & Short">Direct & Short (&lt; 75 words)</option>
                    <option value="Value & Metrics Hook">Value & Metrics Hook (ROI focused)</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={isGenerating}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "11px",
                    borderRadius: 9,
                    background: "linear-gradient(135deg, #7C3AED 0%, #9333EA 100%)",
                    color: "#fff",
                    border: "none",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: isGenerating ? "wait" : "pointer",
                    boxShadow: "0 2px 8px rgba(124,58,237,0.25)"
                  }}
                >
                  {isGenerating ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  {isGenerating ? "Drafting with AI..." : "Generate Email Draft"}
                </button>
              </form>
            </div>

            {/* Email Preview Card */}
            <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 22, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, paddingBottom: 10, borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>
                  Live Email Preview
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(generatedDraft.body);
                      showToast("Copied draft body to clipboard!");
                    }}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                  >
                    <Copy size={12} /> Copy
                  </button>
                  <button
                    onClick={() => showToast("Added draft into Sequence 1!")}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 6, background: "#7C3AED", color: "#fff", border: "none", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                  >
                    <Send size={12} /> Add to Sequence
                  </button>
                </div>
              </div>

              <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, flex: 1, display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 12, color: C.slate, marginBottom: 6 }}>
                  <strong>To:</strong> {{firstName}} &lt;contact@{targetCompany.toLowerCase().replace(/\s+/g, "")}.com&gt;
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 12 }}>
                  <strong>Subject:</strong> {generatedDraft.subject}
                </div>
                <div style={{ flex: 1, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, fontSize: 13, color: C.textInk, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                  {generatedDraft.body}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: INBOUND INBOX & AI REPLY */}
        {activeTab === "inbox" && (
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1.9fr", gap: 20 }}>
            {/* Thread List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>
                Incoming Client Replies ({inboxThreads.length})
              </div>
              {inboxThreads.map((t) => {
                const active = selectedThread?.id === t.id;
                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedThread(t)}
                    style={{
                      background: "#fff",
                      border: `1.5px solid ${active ? "#7C3AED" : C.border}`,
                      borderRadius: 12,
                      padding: 14,
                      cursor: "pointer",
                      boxShadow: active ? "0 4px 12px rgba(124,58,237,0.1)" : "none",
                      transition: "all 0.15s"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: C.ink }}>{t.prospectName}</div>
                      <span style={{ fontSize: 11, color: C.slateLight }}>{t.time}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "#7C3AED", fontWeight: 600 }}>{t.company}</div>
                    <div style={{ fontSize: 12, color: C.slate, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      "{t.lastMessage}"
                    </div>
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, background: "#DCFCE7", color: "#166534", padding: "2px 6px", borderRadius: 4 }}>
                        {t.sentiment}
                      </span>
                      {t.readyForVoiceCall && (
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: C.cobalt }}>
                          Ready for 4. Voice
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Selected Conversation & Reply Box */}
            {selectedThread ? (
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 22, display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 14, borderBottom: `1px solid ${C.border}`, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink }}>
                      {selectedThread.prospectName}
                    </div>
                    <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                      {selectedThread.company} • {selectedThread.email} • {selectedThread.phone}
                    </div>
                  </div>

                  {/* 1-Click Handoff into Plugin 4 Voice */}
                  <button
                    onClick={() => handleEscalateToVoice(selectedThread)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 14px",
                      borderRadius: 8,
                      background: C.ink,
                      color: "#fff",
                      border: "none",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    <PhoneCall size={13} /> Call with 4. Voice Assistant
                  </button>
                </div>

                {/* Client Message */}
                <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 4 }}>
                    Client Inquiry
                  </div>
                  <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.5 }}>
                    "{selectedThread.lastMessage}"
                  </div>
                </div>

                {/* AI Suggested Response Box */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#7C3AED", display: "flex", alignItems: "center", gap: 5 }}>
                      <Sparkles size={13} /> AI Suggested Contextual Reply
                    </span>
                    <span style={{ fontSize: 11, color: C.slate }}>Based on company knowledge base</span>
                  </div>

                  <textarea
                    defaultValue={selectedThread.aiSuggestedReply}
                    rows={6}
                    style={{
                      width: "100%",
                      padding: 12,
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      fontFamily: FONT_BODY,
                      fontSize: 13,
                      lineHeight: 1.5,
                      boxSizing: "border-box",
                      marginBottom: 12,
                      resize: "vertical"
                    }}
                  />

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button
                      onClick={handleSendReply}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "9px 16px",
                        borderRadius: 8,
                        background: "#7C3AED",
                        color: "#fff",
                        border: "none",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer"
                      }}
                    >
                      <Send size={13} /> Approve & Dispatch Reply
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 32, textAlign: "center", color: C.slate }}>
                Select an inbound email to review and reply
              </div>
            )}
          </div>
        )}
      </main>

      {/* Floating Toast */}
      {toastMessage && (
        <div style={{ position: "fixed", bottom: 24, right: 28, background: C.ink, color: "#fff", padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", zIndex: 1000 }}>
          <CheckCircle2 size={16} color={C.teal} /> {toastMessage}
        </div>
      )}
    </div>
  );
}
