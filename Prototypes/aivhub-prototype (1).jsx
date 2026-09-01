import React, { useState } from "react";
import {
  PhoneCall,
  Building2,
  Settings2,
  BarChart3,
  Bell,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  CheckCircle2,
  Circle,
  AlertTriangle,
  PlusCircle,
  Mic,
  PhoneOff,
  X,
  ArrowUpRight,
  MapPin,
  Search,
  ExternalLink,
  ListChecks,
  Radio,
  Calendar,
  Clock,
  KeyRound,
  Plug,
  Headphones,
  FileText,
  Link2,
  Globe,
  Trash2,
  Check,
  Volume2,
  Sparkles,
  Users,
  Layers,
  HelpCircle,
  Info,
  Package,
  ShieldCheck,
  BookOpen,
  CalendarCheck,
  Video,
  ArrowRight,
  Star,
  Phone,
  MessageCircle,
  MessageSquare,
  Navigation,
  Paperclip,
  Sparkle,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from "recharts";

/* ---------------------------------- tokens ---------------------------------- */

const C = {
  ink: "#12141C",
  inkSoft: "#1B1E29",
  inkLine: "#2A2D3A",
  paper: "#F6F5F2",
  paperCard: "#FFFFFF",
  paperSoft: "#EFEDE8",
  border: "#E4E1D9",
  cobalt: "#3457D5",
  cobaltSoft: "#EAEEFC",
  cobaltDeep: "#26409E",
  teal: "#0C8C7D",
  tealSoft: "#E4F5F2",
  amber: "#B8760A",
  amberSoft: "#FCEFDA",
  red: "#C2410C",
  redSolid: "#DC2626",
  redSoft: "#FBEAE8",
  green: "#15803D",
  greenSoft: "#E7F5EB",
  slate: "#6B7280",
  slateLight: "#9CA3AF",
  textInk: "#1B1D24",
};

const FONT_DISPLAY = "'Space Grotesk', sans-serif";
const FONT_BODY = "'Inter', sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

/* ---------------------------------- mock data ---------------------------------- */

const INITIAL_MISSIONS = [
  {
    id: "m1",
    title: "Logistics companies — Manchester",
    sector: "Logistics",
    region: "Manchester",
    status: "active",
    contacted: 12,
    total: 20,
    meetingsBooked: 3,
    created: "24 Aug",
    source: "discover",
    prospects: [
      { id: "p1", name: "Acme Logistics Ltd", status: "meeting_booked", note: "Meeting booked — Thu 26 Sep, 2:00 PM", time: "14:32" },
      { id: "p2", name: "Northern Freight Co", status: "calling", note: "Negotiating meeting time", time: "now" },
      { id: "p3", name: "Manchester Transport Group", status: "retry", note: "No answer — retry scheduled 15:00", time: "11:05" },
      { id: "p4", name: "Speedy Haulage", status: "rejected", note: "Not interested — added to do-not-call", time: "10:41" },
      { id: "p5", name: "Green Mile Logistics", status: "researching", note: "Researching company profile", time: "09:58" },
      { id: "p6", name: "Pennine Distribution", status: "human_review", note: "Asked about pricing — needs staff input", time: "13:12" },
    ],
  },
  { id: "m2", title: "Manufacturing SMEs — Leeds", sector: "Manufacturing", region: "Leeds", status: "completed", contacted: 15, total: 15, meetingsBooked: 6, created: "20 Aug", source: "discover", prospects: [] },
  { id: "m3", title: "Retail chains — Birmingham", sector: "Retail", region: "Birmingham", status: "needs_attention", contacted: 8, total: 25, meetingsBooked: 1, created: "22 Aug", source: "discover", prospects: [] },
  { id: "m4", title: "Provided contact list — Q3 warm leads", sector: "Mixed", region: "UK-wide", status: "active", contacted: 5, total: 9, meetingsBooked: 0, created: "26 Aug", source: "manual", prospects: [] },
];

const PROSPECTS = [
  { id: "p1", name: "Acme Logistics Ltd", sector: "Logistics", region: "Manchester", status: "meeting_booked", fit: 92, lastContact: "26 Aug", contact: "James Whitfield · Ops Director", phone: "+44 161 496 0123", site: "acmelogistics.co.uk" },
  { id: "p2", name: "Northern Freight Co", sector: "Logistics", region: "Manchester", status: "contacted", fit: 81, lastContact: "26 Aug", contact: "—", phone: "+44 161 220 4471", site: "northernfreight.co.uk" },
  { id: "p3", name: "Manchester Transport Group", sector: "Logistics", region: "Manchester", status: "contacted", fit: 74, lastContact: "26 Aug", contact: "—", phone: "+44 161 883 2200", site: "mtgroup.co.uk" },
  { id: "p4", name: "Speedy Haulage", sector: "Logistics", region: "Manchester", status: "do_not_call", fit: 58, lastContact: "26 Aug", contact: "Priya Nair · MD", phone: "+44 161 774 5510", site: "speedyhaulage.co.uk" },
  { id: "p5", name: "Green Mile Logistics", sector: "Logistics", region: "Manchester", status: "cold", fit: 69, lastContact: "—", contact: "—", phone: "+44 161 552 9081", site: "greenmilelogistics.co.uk" },
  { id: "p6", name: "Pennine Distribution", sector: "Logistics", region: "Manchester", status: "interested", fit: 88, lastContact: "26 Aug", contact: "Tom Radcliffe · Finance Director", phone: "+44 161 998 3345", site: "pennine-dist.co.uk" },
  { id: "p7", name: "Bright Retail Group", sector: "Retail", region: "Birmingham", status: "contacted", fit: 77, lastContact: "25 Aug", contact: "—", phone: "+44 121 233 8890", site: "brightretail.co.uk" },
  { id: "p8", name: "Midlands Fashion Co", sector: "Retail", region: "Birmingham", status: "meeting_booked", fit: 85, lastContact: "24 Aug", contact: "Sarah Coombs · CEO", phone: "+44 121 456 7712", site: "midlandsfashion.co.uk" },
  { id: "p9", name: "Ferrum Manufacturing", sector: "Manufacturing", region: "Leeds", status: "meeting_booked", fit: 90, lastContact: "20 Aug", contact: "David Oyelaran · COO", phone: "+44 113 220 5541", site: "ferrummfg.co.uk" },
  { id: "p10", name: "Yorkshire Components Ltd", sector: "Manufacturing", region: "Leeds", status: "meeting_booked", fit: 87, lastContact: "20 Aug", contact: "Liam Foster · Plant Manager", phone: "+44 113 776 4420", site: "yorkshirecomponents.co.uk" },
];

const INITIAL_LIVE_CALLS = [
  {
    id: "c1",
    prospect: "Northern Freight Co",
    mission: "Logistics — Manchester",
    state: "negotiating",
    channel: "voice",
    duration: "02:14",
    transcript: [
      "AI: Would Thursday at 2pm work for a short call with your ops lead?",
      "Prospect: Let me check — maybe Wednesday instead.",
      "AI: Wednesday works well — morning or afternoon suits better?",
    ],
  },
  {
    id: "c2",
    prospect: "Pennine Distribution",
    mission: "Logistics — Manchester",
    state: "human_review",
    channel: "voice",
    duration: "04:02",
    flag: "Pricing question",
    transcript: [
      "Prospect: What exactly does this cost us, roughly?",
      "AI: I can have someone follow up with pricing details directly —",
    ],
  },
  {
    id: "c3",
    prospect: "Bright Retail Group",
    mission: "Retail — Birmingham",
    state: "pitching",
    channel: "voice",
    duration: "00:48",
    transcript: [
      "AI: Hi, this is Sam calling on behalf of AIVHub —",
      "Prospect: Sorry, what is this regarding?",
    ],
  },
  {
    id: "c4",
    prospect: "Riverside Manufacturing",
    mission: "Q3 warm leads",
    state: "negotiating",
    channel: "whatsapp",
    duration: "3 messages",
    transcript: [
      "AI: Hi! This is Sam from AIVHub — saw Riverside's expanding the Coventry site. Worth a quick 15-min chat about ops dashboards?",
      "Prospect: Maybe, send more info first",
      "AI: Sure — sending a one-pager now. Would Tuesday or Wednesday next week work for a short call either way?",
    ],
  },
];

const TREND = [
  { day: "1 Aug", rate: 11 },
  { day: "6 Aug", rate: 12 },
  { day: "11 Aug", rate: 13 },
  { day: "16 Aug", rate: 15 },
  { day: "21 Aug", rate: 16 },
  { day: "26 Aug", rate: 18 },
];

const COST_BREAKDOWN = [
  { name: "LLM", Paid: 320, "Open Source": 42 },
  { name: "STT", Paid: 180, "Open Source": 6 },
  { name: "TTS", Paid: 260, "Open Source": 4 },
  { name: "Telephony", Paid: 410, "Open Source": 380 },
];

const INITIAL_SCHEDULE = [
  { id: "s1", day: "Today, 27 Aug", time: "09:30", prospect: "Green Mile Logistics", mission: "Logistics — Manchester", window: "09:00–17:30", status: "queued" },
  { id: "s2", day: "Today, 27 Aug", time: "11:00", prospect: "Manchester Transport Group", mission: "Logistics — Manchester", window: "09:00–17:30", status: "queued" },
  { id: "s3", day: "Today, 27 Aug", time: "13:15", prospect: "Bright Retail Group", mission: "Retail — Birmingham", window: "09:00–17:30", status: "queued" },
  { id: "s4", day: "Today, 27 Aug", time: "15:00", prospect: "Manchester Transport Group", mission: "Logistics — Manchester", window: "09:00–17:30", status: "retry" },
  { id: "s5", day: "Tomorrow, 28 Aug", time: "09:15", prospect: "Fintech Prospect Batch (5)", mission: "Fintech startups — London", window: "09:00–17:30", status: "queued" },
  { id: "s6", day: "Tomorrow, 28 Aug", time: "10:00", prospect: "Riverside Manufacturing", mission: "Q3 warm leads", window: "10:00–16:00", status: "queued" },
  { id: "s7", day: "Yesterday, 26 Aug", time: "14:32", prospect: "Acme Logistics Ltd", mission: "Logistics — Manchester", window: "09:00–17:30", status: "completed" },
];

const INITIAL_NOTIFICATIONS = [
  { id: "n1", text: "Meeting booked — Acme Logistics Ltd, Thu 2:00 PM", time: "10m ago", unread: true, type: "success" },
  { id: "n2", text: "Pennine Distribution needs staff input — pricing question", time: "24m ago", unread: true, type: "alert" },
  { id: "n3", text: "Speedy Haulage marked do-not-call", time: "1h ago", unread: true, type: "info" },
  { id: "n4", text: "Mission \"Manufacturing SMEs — Leeds\" completed — 6 meetings booked", time: "Yesterday", unread: false, type: "success" },
  { id: "n5", text: "Provider config changed to Open Source mode", time: "2 days ago", unread: false, type: "info" },
];

const CONNECTIONS = [
  { group: "LLM", desc: "Powers the AI's conversation, pitch reasoning, and objection handling.", items: [
    { name: "Anthropic (Claude)", status: "connected" },
    { name: "OpenAI (GPT-4o)", status: "connected" },
    { name: "DeepSeek", status: "not_configured" },
  ]},
  { group: "Speech-to-Text", desc: "Turns the prospect's spoken voice into text the AI can understand.", items: [
    { name: "Deepgram", status: "connected" },
    { name: "Faster-Whisper (self-hosted)", status: "not_configured" },
  ]},
  { group: "Text-to-Speech", desc: "Generates the AI's spoken voice on calls.", items: [
    { name: "ElevenLabs", status: "connected" },
    { name: "Cartesia", status: "not_configured" },
    { name: "Kokoro (self-hosted)", status: "not_configured" },
  ]},
  { group: "Voice Orchestration", desc: "Manages the live call itself — audio streaming, interruptions, turn-taking.", items: [
    { name: "Vapi", status: "connected" },
    { name: "Retell AI", status: "not_configured" },
    { name: "LiveKit (self-hosted)", status: "error" },
  ]},
  { group: "Telephony", desc: "Places and receives the actual phone calls.", items: [
    { name: "Twilio", status: "connected" },
    { name: "Telnyx", status: "not_configured" },
  ]},
  { group: "Calendar", desc: "Checks availability and books confirmed meetings.", items: [
    { name: "Cal.com", status: "connected" },
  ]},
  { group: "Business Discovery", desc: "Finds and researches prospect businesses on the web.", items: [
    { name: "Google Places API", status: "connected" },
    { name: "Web Search Provider", status: "connected" },
  ]},
  { group: "Other", desc: "Anything else your team connects — CRM, spreadsheets, custom internal tools.", items: [] },
];

const CATEGORY_OPTIONS = ["LLM", "Speech-to-Text", "Text-to-Speech", "Voice Orchestration", "Telephony", "Calendar", "Business Discovery", "Other"];

const INITIAL_KNOWLEDGE_SOURCES = [
  { id: "k1", name: "Company website", type: "Website URL", value: "aivhub.io", status: "indexed", synced: "2 hours ago" },
  { id: "k2", name: "Service catalogue & pricing", type: "Document upload", value: "aivhub-services-2026.pdf", status: "indexed", synced: "1 day ago" },
  { id: "k3", name: "Case studies deck", type: "Google Drive link", value: "drive.google.com/aivhub-case-studies", status: "pending", synced: "—" },
  { id: "k4", name: "Objection handling notes", type: "Manual text", value: "Internal notes on common pushback", status: "indexed", synced: "3 days ago" },
];

const INITIAL_FAQ = [
  { id: "f1", q: "What does AIVHub actually do?", a: "We build AI-powered business intelligence dashboards that turn raw operational data into clear, real-time decisions for mid-market teams." },
  { id: "f2", q: "How much does it cost?", a: "Pricing depends on team size and data sources — I can have someone send exact numbers, or we can cover it on the call we're booking." },
  { id: "f3", q: "Who else uses this?", a: "We work with logistics, manufacturing, and retail operators across the UK — happy to share relevant examples on the call." },
];

const INITIAL_SERVICES = [
  { id: "sv1", name: "BI Dashboard Platform", ideal: "Mid-market ops teams, 50-500 staff", desc: "Real-time operational dashboards pulling from existing systems." },
  { id: "sv2", name: "Data Pipeline Consulting", ideal: "Companies with fragmented data sources", desc: "Set up reliable pipelines feeding clean data into reporting." },
];

const INITIAL_MEETINGS = [
  {
    id: "mt1", prospect: "Acme Logistics Ltd", mission: "Logistics — Manchester", date: "Thu 3 Sep", time: "14:00", duration: "15 min", status: "upcoming", fit: 92,
    channel: "voice", format: "video", platform: "Google Meet", videoLink: "meet.google.com/aiv-acme-disc",
    host: "Jitendra S.", attendee: "James Whitfield · Ops Director",
    prep: "James showed strong interest in real-time dispatch dashboards on the call. Current pain point: manual Excel reporting takes ~2 days/week for his team. Mentioned they're evaluating 2 other vendors — worth asking who.",
    callTranscript: [
      { who: "ai", text: "Hi, this is Sam calling on behalf of AIVHub — do you have a quick minute?" },
      { who: "them", text: "Sure, what's this about?" },
      { who: "ai", text: "We build BI dashboards for logistics operators — saw Acme's been growing fast in Manchester. Quick question: how does your team currently track dispatch performance?" },
      { who: "them", text: "Mostly spreadsheets, honestly. It's a mess." },
      { who: "ai", text: "That's exactly what we help with. Would a 15-minute call with James make sense to see if it's a fit?" },
      { who: "them", text: "Yeah, put something in for Thursday afternoon." },
      { who: "ai", text: "Perfect — Thursday 2pm works, I'll send a Google Meet link over." },
    ],
    meetingTranscript: null,
  },
  {
    id: "mt2", prospect: "Ferrum Manufacturing", mission: "Manufacturing SMEs — Leeds", date: "Fri 21 Aug", time: "11:00", duration: "20 min", status: "needs_outcome", fit: 90,
    channel: "voice", format: "phone", dialIn: "+44 113 220 5541",
    host: "Jitendra S.", attendee: "David Oyelaran · COO",
    prep: "David was open to a pilot on production-line dashboards. Budget cycle starts in October — timing may matter.",
    callTranscript: [
      { who: "ai", text: "Hi David, this is Sam from AIVHub — got 2 minutes?" },
      { who: "them", text: "Just about, go ahead." },
      { who: "ai", text: "We work with manufacturers on real-time production dashboards. Would a short call to explore fit work for you?" },
      { who: "them", text: "Could do, but budget's tight until October." },
      { who: "ai", text: "Understood — let's do a no-pressure discovery call so it's ready when budget opens up. Friday 11am?" },
      { who: "them", text: "Friday works." },
    ],
    meetingTranscript: null,
  },
  {
    id: "mt3", prospect: "Yorkshire Components Ltd", mission: "Manufacturing SMEs — Leeds", date: "Wed 19 Aug", time: "10:30", duration: "15 min", status: "converted", fit: 87,
    channel: "voice", format: "video", platform: "Microsoft Teams", videoLink: "teams.microsoft.com/aiv-yorkshire",
    host: "Jitendra S.", attendee: "Liam Foster · Plant Manager",
    prep: "Liam requested a formal proposal after the call.", outcome: "Converted — moved to proposal stage",
    callTranscript: [
      { who: "ai", text: "Hi Liam, calling on behalf of AIVHub — is now an OK time?" },
      { who: "them", text: "Sure, quick one though." },
      { who: "ai", text: "No problem — we build dashboards for plant operations. Worth a short call with our team?" },
      { who: "them", text: "Yes, send me a Teams invite for next week." },
    ],
    meetingTranscript: [
      { who: "host", text: "Thanks for making time, Liam — talk us through what you're currently tracking manually." },
      { who: "them", text: "Mainly downtime and throughput per line, all in spreadsheets updated end of shift." },
      { who: "host", text: "That's a great fit for what we've built — I'll put a proposal together this week." },
      { who: "them", text: "Sounds good, send it over and I'll loop in finance." },
    ],
  },
  {
    id: "mt4", prospect: "Midlands Fashion Co", mission: "Retail chains — Birmingham", date: "Sat 24 Aug", time: "09:30", duration: "15 min", status: "not_fit", fit: 85,
    channel: "whatsapp", format: "in_person", address: "14 Colmore Row, Birmingham B3 2QD",
    host: "Jitendra S.", attendee: "Sarah Coombs · CEO",
    prep: "Sarah was interested but flagged budget constraints for this fiscal year.", outcome: "Not a fit — budget too small this year",
    callTranscript: [
      { who: "ai", text: "Hi Sarah, this is AIVHub — we help retail teams with BI dashboards. Open to a quick chat?" },
      { who: "them", text: "Maybe — what's the cost roughly?" },
      { who: "ai", text: "Depends on scope, easiest to cover on a short call. Could we grab 15 min in person, since your office is local to our team?" },
      { who: "them", text: "OK, Saturday morning works, come by the office." },
    ],
    meetingTranscript: [
      { who: "host", text: "Thanks for having us in, Sarah. Talk us through your current reporting setup." },
      { who: "them", text: "It's fine, but budgets are frozen until next fiscal year — I don't think we can move on this now." },
      { who: "host", text: "Understood — let's revisit in the new fiscal year, I'll follow up in a few months." },
    ],
  },
];

/* ---------------------------------- helpers ---------------------------------- */

const STATUS_MAP = {
  active: { label: "Active", bg: C.cobaltSoft, fg: C.cobaltDeep },
  completed: { label: "Completed", bg: C.greenSoft, fg: C.green },
  needs_attention: { label: "Needs attention", bg: C.redSoft, fg: C.red },
  meeting_booked: { label: "Meeting booked", bg: C.greenSoft, fg: C.green },
  calling: { label: "Calling", bg: C.cobaltSoft, fg: C.cobaltDeep },
  retry: { label: "Retry scheduled", bg: C.amberSoft, fg: C.amber },
  rejected: { label: "Not interested", bg: C.paperSoft, fg: C.slate },
  researching: { label: "Researching", bg: C.paperSoft, fg: C.slate },
  human_review: { label: "Needs input", bg: C.redSoft, fg: C.red },
  contacted: { label: "Contacted", bg: C.cobaltSoft, fg: C.cobaltDeep },
  interested: { label: "Interested", bg: C.tealSoft, fg: C.teal },
  do_not_call: { label: "Do not call", bg: C.paperSoft, fg: C.slate },
  cold: { label: "Cold", bg: C.paperSoft, fg: C.slateLight },
  queued: { label: "Queued", bg: C.cobaltSoft, fg: C.cobaltDeep },
  ended: { label: "Call ended", bg: C.paperSoft, fg: C.slate },
  connected: { label: "Connected", bg: C.greenSoft, fg: C.green },
  not_configured: { label: "Not configured", bg: C.paperSoft, fg: C.slateLight },
  error: { label: "Error", bg: C.redSoft, fg: C.red },
  indexed: { label: "Indexed", bg: C.greenSoft, fg: C.green },
  pending: { label: "Syncing...", bg: C.amberSoft, fg: C.amber },
  upcoming: { label: "Upcoming", bg: C.cobaltSoft, fg: C.cobaltDeep },
  needs_outcome: { label: "Log outcome", bg: C.amberSoft, fg: C.amber },
  converted: { label: "Converted", bg: C.greenSoft, fg: C.green },
  not_fit: { label: "Not a fit", bg: C.paperSoft, fg: C.slate },
  follow_up: { label: "Follow-up set", bg: C.tealSoft, fg: C.teal },
};

function Badge({ status, small }) {
  const s = STATUS_MAP[status] || STATUS_MAP.cold;
  return (
    <span
      style={{
        background: s.bg,
        color: s.fg,
        fontFamily: FONT_BODY,
        fontSize: small ? 11 : 12,
        fontWeight: 600,
        padding: small ? "3px 8px" : "4px 10px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        letterSpacing: "0.01em",
      }}
    >
      {s.label}
    </span>
  );
}

function LivePulse() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, height: 14 }}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            width: 3,
            borderRadius: 2,
            background: C.cobalt,
            animation: `pulseBar 1s ease-in-out ${i * 0.12}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function FitScore({ value }) {
  const color = value >= 85 ? C.green : value >= 70 ? C.amber : C.slate;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 46, height: 6, borderRadius: 3, background: C.paperSoft, overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.textInk, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

/* ---------------------------------- sidebar ---------------------------------- */

const NAV_GROUPS = [
  { label: "Operations", items: [
    { id: "missions", label: "Missions", icon: ListChecks },
    { id: "schedule", label: "Schedule", icon: Calendar },
    { id: "meetings", label: "Meetings", icon: CalendarCheck },
    { id: "live", label: "Live Calls", icon: Radio },
    { id: "prospects", label: "Prospects", icon: Building2 },
  ]},
  { label: "Configuration", items: [
    { id: "company", label: "Company Profile", icon: Users },
    { id: "connections", label: "Connections", icon: Plug },
    { id: "provider", label: "AI Providers", icon: Settings2 },
  ]},
  { label: "Insights", items: [
    { id: "analytics", label: "Analytics", icon: BarChart3 },
  ]},
];

function Sidebar({ view, setView, companyName }) {
  return (
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
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px 22px 8px" }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: `linear-gradient(135deg, ${C.cobalt}, ${C.teal})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <PhoneCall size={15} color="#fff" strokeWidth={2.4} />
        </div>
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: "#fff", letterSpacing: "-0.01em" }}>
          AIVHub
        </span>
      </div>

      {NAV_GROUPS.map((group) => (
        <div key={group.label} style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, color: "#5B6070", textTransform: "uppercase", letterSpacing: "0.06em", padding: "4px 10px" }}>
            {group.label}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {group.items.map((n) => {
              const Icon = n.icon;
              const active = view === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => setView(n.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 10px",
                    borderRadius: 8,
                    border: "none",
                    cursor: "pointer",
                    background: active ? "rgba(255,255,255,0.08)" : "transparent",
                    color: active ? "#fff" : "#9AA0AE",
                    fontFamily: FONT_BODY,
                    fontSize: 13.5,
                    fontWeight: 500,
                    textAlign: "left",
                    transition: "background 0.15s, color 0.15s",
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  <Icon size={16} strokeWidth={2} />
                  {n.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ marginTop: "auto", padding: "12px 10px", borderTop: `1px solid ${C.inkLine}` }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: "#5B6070", marginBottom: 8 }}>
          Speaking as <span style={{ color: "#C8CCD6", fontWeight: 600 }}>{companyName}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 999, background: C.cobalt, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: "#fff" }}>
            RS
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: "#C8CCD6" }}>
            Jitendra S. <span style={{ color: "#6B7180" }}>· Admin</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- topbar + notifications ---------------------------------- */

function NotificationBell({ notifications, setNotifications }) {
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((n) => n.unread).length;

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          border: `1px solid ${C.border}`,
          background: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          position: "relative",
        }}
      >
        <Bell size={15} color={C.slate} />
        {unread > 0 && (
          <span style={{ position: "absolute", top: 5, right: 6, minWidth: 14, height: 14, borderRadius: 999, background: C.red, color: "#fff", fontSize: 9, fontFamily: FONT_BODY, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
            {unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{ position: "absolute", top: 42, right: 0, width: 340, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.14)", zIndex: 41, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: C.textInk }}>Notifications</span>
              <button
                onClick={() => setNotifications((ns) => ns.map((n) => ({ ...n, unread: false })))}
                style={{ background: "none", border: "none", color: C.cobalt, fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
              >
                Mark all read
              </button>
            </div>
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => setNotifications((ns) => ns.map((x) => (x.id === n.id ? { ...x, unread: false } : x)))}
                  style={{ display: "flex", gap: 10, padding: "11px 14px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", background: n.unread ? C.cobaltSoft : "#fff" }}
                >
                  <div style={{ marginTop: 3, width: 7, height: 7, borderRadius: 999, background: n.unread ? C.cobalt : "transparent", flexShrink: 0 }} />
                  <div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk, lineHeight: 1.4 }}>{n.text}</div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 2 }}>{n.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TopBar({ title, subtitle, onNewMission, notifications, setNotifications }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "22px 32px 20px 32px",
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: C.textInk, letterSpacing: "-0.01em" }}>{title}</div>
        {subtitle && <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 2 }}>{subtitle}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <NotificationBell notifications={notifications} setNotifications={setNotifications} />
        {onNewMission && (
          <button
            onClick={onNewMission}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              background: C.ink,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "9px 15px",
              fontFamily: FONT_BODY,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <PlusCircle size={15} />
            New Outreach
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- missions list ---------------------------------- */

function MissionsView({ onOpenMission, onNewMission, notifications, setNotifications, missions }) {
  const [filter, setFilter] = useState("all");
  const filtered = missions.filter((m) => filter === "all" || m.status === filter);

  return (
    <>
      <TopBar title="Missions" subtitle="Outbound outreach campaigns, tracked end to end" onNewMission={onNewMission} notifications={notifications} setNotifications={setNotifications} />
      <div style={{ padding: "20px 32px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {[
            ["all", "All"],
            ["active", "Active"],
            ["needs_attention", "Needs attention"],
            ["completed", "Completed"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              style={{
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                fontWeight: 600,
                padding: "6px 13px",
                borderRadius: 7,
                border: `1px solid ${filter === id ? C.ink : C.border}`,
                background: filter === id ? C.ink : "#fff",
                color: filter === id ? "#fff" : C.slate,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
          {filtered.map((m) => (
            <div
              key={m.id}
              onClick={() => onOpenMission(m)}
              style={{
                background: C.paperCard,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: 18,
                cursor: "pointer",
                transition: "border-color 0.15s, transform 0.1s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = C.cobalt)}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.border)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15.5, color: C.textInk }}>{m.title}</div>
                    {m.source === "manual" && (
                      <span style={{ fontFamily: FONT_BODY, fontSize: 10, fontWeight: 700, color: C.teal, background: C.tealSoft, padding: "2px 6px", borderRadius: 5 }}>PROVIDED LIST</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, color: C.slate, fontFamily: FONT_BODY, fontSize: 12.5 }}>
                    <MapPin size={12} /> {m.region} <span style={{ color: C.border }}>·</span> {m.sector}
                  </div>
                </div>
                <Badge status={m.status} />
              </div>

              <div style={{ display: "flex", gap: 20, marginTop: 16 }}>
                <div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 600, color: C.textInk }}>
                    {m.contacted}
                    <span style={{ color: C.slateLight, fontSize: 13 }}>/{m.total}</span>
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slate, marginTop: 2 }}>Contacted</div>
                </div>
                <div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 18, fontWeight: 600, color: C.green }}>{m.meetingsBooked}</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slate, marginTop: 2 }}>Meetings booked</div>
                </div>
                <div style={{ marginLeft: "auto", alignSelf: "flex-end", color: C.slateLight, fontFamily: FONT_BODY, fontSize: 11 }}>
                  Started {m.created}
                </div>
              </div>

              <div style={{ height: 5, borderRadius: 3, background: C.paperSoft, marginTop: 14, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(m.contacted / m.total) * 100}%`, background: C.cobalt, borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ---------------------------------- mission detail ---------------------------------- */

function MissionDetail({ mission, onBack, companyName }) {
  const [expanded, setExpanded] = useState(null);
  const counts = mission.prospects.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div style={{ padding: "22px 32px 0 32px" }}>
        <button
          onClick={onBack}
          style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: C.slate, fontFamily: FONT_BODY, fontSize: 13, cursor: "pointer", marginBottom: 14 }}
        >
          <ChevronLeft size={14} /> Back to missions
        </button>
      </div>
      <div style={{ padding: "0 32px 20px 32px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: `1px solid ${C.border}`, paddingBottom: 20 }}>
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: C.textInk, letterSpacing: "-0.01em" }}>{mission.title}</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 2 }}>{mission.region} · {mission.sector} · Started {mission.created}</div>
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, textAlign: "right" }}>
          Representing<br /><span style={{ color: C.textInk, fontWeight: 600 }}>{companyName}</span>
        </div>
      </div>

      <div style={{ padding: "20px 32px", display: "grid", gridTemplateColumns: "1fr 300px", gap: 20 }}>
        <div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.slate, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Prospects ({mission.prospects.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {mission.prospects.map((p) => {
              const isOpen = expanded === p.id;
              return (
                <div key={p.id} style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <div
                    onClick={() => setExpanded(isOpen ? null : p.id)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {p.status === "calling" ? <LivePulse /> : p.status === "meeting_booked" ? <CheckCircle2 size={16} color={C.green} /> : p.status === "human_review" ? <AlertTriangle size={16} color={C.red} /> : <Circle size={14} color={C.slateLight} />}
                      <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, color: C.textInk }}>{p.name}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <Badge status={p.status} small />
                      <ChevronDown size={15} color={C.slateLight} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                    </div>
                  </div>
                  {isOpen && (
                    <div style={{ padding: "0 16px 14px 40px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>
                      <div style={{ marginBottom: 4 }}>{p.note}</div>
                      <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.slateLight }}>Last update: {p.time}</div>
                      {p.status === "human_review" && (
                        <button
                          style={{ marginTop: 8, background: C.ink, color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                        >
                          Join call
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {mission.prospects.length === 0 && (
              <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slateLight, padding: "20px 0" }}>No prospect activity recorded yet for this mission.</div>
            )}
          </div>
        </div>

        <div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.slate, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Mission stats
          </div>
          <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <StatRow label="Contacted" value={`${mission.contacted}/${mission.total}`} />
            <StatRow label="Meetings booked" value={mission.meetingsBooked} accent={C.green} />
            <StatRow label="Answer rate" value="64%" />
            <StatRow label="Needs input" value={counts.human_review || 0} accent={counts.human_review ? C.red : undefined} />
            <StatRow label="Do-not-call" value={counts.rejected || 0} />
            <StatRow label="Est. cost so far" value="£4.80" />
          </div>
        </div>
      </div>
    </>
  );
}

function StatRow({ label, value, accent }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>{label}</span>
      <span style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: 600, color: accent || C.textInk }}>{value}</span>
    </div>
  );
}

/* ---------------------------------- live calls ---------------------------------- */

function LiveCallsView({ notifications, setNotifications, companyName }) {
  const [calls, setCalls] = useState(INITIAL_LIVE_CALLS.map((c) => ({ ...c, taken: false, listening: false, confirmingEnd: false, ended: false })));

  const toggleTaken = (id) => setCalls((cs) => cs.map((c) => (c.id === id ? { ...c, taken: !c.taken } : c)));
  const toggleListen = (id) => setCalls((cs) => cs.map((c) => (c.id === id ? { ...c, listening: !c.listening } : c)));
  const askEnd = (id) => setCalls((cs) => cs.map((c) => (c.id === id ? { ...c, confirmingEnd: true } : c)));
  const cancelEnd = (id) => setCalls((cs) => cs.map((c) => (c.id === id ? { ...c, confirmingEnd: false } : c)));
  const confirmEnd = (id) => {
    setCalls((cs) => cs.map((c) => (c.id === id ? { ...c, ended: true, confirmingEnd: false } : c)));
    setNotifications((ns) => [{ id: "n_" + Date.now(), text: "Conversation ended manually by operator", time: "just now", unread: true, type: "info" }, ...ns]);
  };

  const active = calls.filter((c) => !c.ended);

  return (
    <>
      <TopBar title="Live Activity" subtitle={`${active.length} active conversations — calls and messages`} notifications={notifications} setNotifications={setNotifications} />
      <div style={{ padding: "20px 32px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        {calls.map((c) => {
          const isMessage = c.channel === "whatsapp" || c.channel === "sms";
          if (c.ended) {
            return (
              <div key={c.id} style={{ background: C.paperSoft, border: `1px dashed ${C.border}`, borderRadius: 12, padding: 16, opacity: 0.7 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14.5, color: C.slate }}>{c.prospect}</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight, marginTop: 6 }}>{isMessage ? "Conversation ended" : "Call ended"} — {c.duration}</div>
              </div>
            );
          }
          const flagged = c.state === "human_review";
          return (
            <div
              key={c.id}
              style={{
                background: C.paperCard,
                border: `1.5px solid ${c.taken ? C.red : flagged ? C.red : C.border}`,
                borderRadius: 12,
                padding: 16,
                order: flagged ? -1 : 0,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14.5, color: C.textInk }}>{c.prospect}</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, marginTop: 2 }}>{c.mission}</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.slateLight, marginTop: 2 }}>On behalf of {companyName}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {isMessage ? <ChannelTag channel={c.channel} small /> : <LivePulse />}
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.slate }}>{c.duration}</span>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0" }}>
                <Badge status={c.state === "human_review" ? "human_review" : c.state === "negotiating" ? "calling" : "contacted"} small />
                {c.flag && (
                  <span style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.red, display: "flex", alignItems: "center", gap: 4 }}>
                    <AlertTriangle size={11} /> {c.flag}
                  </span>
                )}
                {c.taken && (
                  <span style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.red, fontWeight: 700 }}>● HUMAN DRIVING</span>
                )}
                {c.listening && !c.taken && (
                  <span style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.cobaltDeep, fontWeight: 700, display: "flex", alignItems: "center", gap: 3 }}>
                    <Volume2 size={11} /> LISTENING
                  </span>
                )}
              </div>

              {isMessage ? (
                <div style={{ background: C.paper, borderRadius: 8, padding: "10px 12px", height: 84, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                  {c.transcript.map((line, i) => {
                    const isAi = line.startsWith("AI");
                    return (
                      <div key={i} style={{ display: "flex", justifyContent: isAi ? "flex-end" : "flex-start" }}>
                        <div style={{ maxWidth: "82%", background: isAi ? C.cobalt : "#fff", color: isAi ? "#fff" : C.textInk, border: isAi ? "none" : `1px solid ${C.border}`, borderRadius: 10, padding: "5px 9px", fontFamily: FONT_BODY, fontSize: 11, lineHeight: 1.35 }}>
                          {line.replace(/^AI:\s*|^Prospect:\s*/, "")}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ background: C.paper, borderRadius: 8, padding: "10px 12px", height: 84, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                  {c.transcript.map((line, i) => (
                    <div key={i} style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: line.startsWith("AI") ? C.cobaltDeep : C.textInk, lineHeight: 1.4 }}>
                      {line}
                    </div>
                  ))}
                  {c.taken && <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.red, fontStyle: "italic" }}>— You are now speaking live —</div>}
                </div>
              )}

              {!c.confirmingEnd ? (
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <ActionBtn icon={isMessage ? MessageCircle : Mic} label={c.taken ? "Hand back" : "Take over"} onClick={() => toggleTaken(c.id)} active={c.taken} />
                  {!isMessage && <ActionBtn icon={Headphones} label={c.listening ? "Stop listening" : "Listen"} onClick={() => toggleListen(c.id)} active={c.listening} />}
                  <ActionBtn icon={isMessage ? X : PhoneOff} label={isMessage ? "End thread" : "End"} onClick={() => askEnd(c.id)} danger />
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", background: C.redSoft, padding: "8px 10px", borderRadius: 8 }}>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.red, flex: 1 }}>{isMessage ? "End this conversation?" : "End this call?"}</span>
                  <button onClick={() => cancelEnd(c.id)} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", fontFamily: FONT_BODY, fontSize: 11.5, cursor: "pointer" }}>Cancel</button>
                  <button onClick={() => confirmEnd(c.id)} style={{ background: C.red, color: "#fff", border: "none", borderRadius: 6, padding: "5px 10px", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>Confirm</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function ActionBtn({ icon: Icon, label, onClick, active, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "7px 8px",
        borderRadius: 7,
        border: `1px solid ${active ? C.red : C.border}`,
        background: active ? C.redSoft : "#fff",
        color: active ? C.red : danger ? C.red : C.textInk,
        fontFamily: FONT_BODY,
        fontSize: 11.5,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      <Icon size={12.5} /> {label}
    </button>
  );
}

/* ---------------------------------- schedule ---------------------------------- */

function ScheduleCallModal({ onClose, onCreate, prefillName }) {
  const [prospect, setProspect] = useState(prefillName || "");
  const [mission, setMission] = useState(INITIAL_MISSIONS[0].title);
  const [day, setDay] = useState("Today, 27 Aug");
  const [time, setTime] = useState("09:00");
  const [reason, setReason] = useState("");

  const canSave = prospect.trim().length > 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "#fff", borderRadius: 14, width: 460, padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.textInk }}>Schedule a call</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={17} color={C.slate} /></button>
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginBottom: 16 }}>
          Book a specific call time — useful for callbacks a prospect requested, or a one-off outreach outside a mission's automatic queue.
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Prospect / business name</div>
          <input
            value={prospect}
            onChange={(e) => setProspect(e.target.value)}
            placeholder="e.g. Northern Freight Co"
            style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", boxSizing: "border-box" }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Mission</div>
          <select value={mission} onChange={(e) => setMission(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}>
            {INITIAL_MISSIONS.map((m) => <option key={m.id}>{m.title}</option>)}
            <option>Ad-hoc — no mission</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Day</div>
            <select value={day} onChange={(e) => setDay(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}>
              {["Today, 27 Aug", "Tomorrow, 28 Aug", "Fri, 29 Aug", "Mon, 1 Sep"].map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Time</div>
            <select value={time} onChange={(e) => setTime(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}>
              {["09:00", "09:30", "10:00", "11:00", "13:15", "14:00", "15:00", "16:30", "17:00"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Reason / notes <span style={{ color: C.slateLight, fontWeight: 400 }}>(optional)</span></div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Requested a callback after 3pm" style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
        </div>

        <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
          <Clock size={12} /> Falls within the 09:00–17:30 UK compliance window.
        </div>

        <button
          disabled={!canSave}
          onClick={() => canSave && onCreate({ day, time, prospect, mission, reason })}
          style={{ width: "100%", padding: "10px", borderRadius: 9, border: "none", background: canSave ? C.ink : C.paperSoft, color: canSave ? "#fff" : C.slateLight, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, cursor: canSave ? "pointer" : "default" }}
        >
          Add to schedule
        </button>
      </div>
    </div>
  );
}

function ScheduleView({ notifications, setNotifications, prefillName, clearPrefill }) {
  const [items, setItems] = useState(INITIAL_SCHEDULE);
  const [editing, setEditing] = useState(null);
  const [showModal, setShowModal] = useState(false);

  React.useEffect(() => {
    if (prefillName) setShowModal(true);
  }, [prefillName]);

  const days = [...new Set(items.map((i) => i.day))];

  const handleClose = () => {
    setShowModal(false);
    if (clearPrefill) clearPrefill();
  };

  const handleCreate = (entry) => {
    setItems((its) => [
      ...its,
      { id: "s_" + Date.now(), day: entry.day, time: entry.time, prospect: entry.prospect, mission: entry.mission, window: "09:00–17:30", status: "queued" },
    ]);
    setNotifications((ns) => [{ id: "n_" + Date.now(), text: `Call scheduled with ${entry.prospect} at ${entry.time}, ${entry.day}`, time: "just now", unread: true, type: "info" }, ...ns]);
    handleClose();
  };

  return (
    <>
      <TopBar title="Schedule" subtitle="Upcoming and completed calls, respecting each mission's call window" notifications={notifications} setNotifications={setNotifications} />
      <div style={{ padding: "20px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, background: C.cobaltSoft, border: `1px solid #C9D3F5`, borderRadius: 8, padding: "10px 14px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.cobaltDeep, display: "flex", alignItems: "center", gap: 8 }}>
            <Clock size={14} /> Calls are only placed within each mission's configured window (default 09:00–17:30 UK).
          </div>
          <button
            onClick={() => setShowModal(true)}
            style={{ display: "flex", alignItems: "center", gap: 7, background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <PlusCircle size={15} /> Schedule a call
          </button>
        </div>

        {days.map((day) => (
          <div key={day} style={{ marginBottom: 22 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>{day}</div>
            <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              {items.filter((i) => i.day === day).map((i, idx, arr) => (
                <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 18px", borderTop: idx === 0 ? "none" : `1px solid ${C.border}` }}>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 600, color: C.textInk, width: 56 }}>{i.time}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, color: C.textInk }}>{i.prospect}</div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight }}>{i.mission} · window {i.window}</div>
                  </div>
                  <Badge status={i.status} small />
                  {i.status !== "completed" && (
                    editing === i.id ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <select
                          defaultValue={i.time}
                          onChange={(e) => setItems((its) => its.map((x) => (x.id === i.id ? { ...x, time: e.target.value } : x)))}
                          style={{ fontFamily: FONT_BODY, fontSize: 12, padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.border}` }}
                        >
                          {["09:00", "09:30", "10:00", "11:00", "13:15", "14:00", "15:00", "16:30"].map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                        <button onClick={() => setEditing(null)} style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontFamily: FONT_BODY, fontSize: 11.5, cursor: "pointer" }}>
                          <Check size={12} />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setEditing(i.id)} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, cursor: "pointer" }}>
                        Reschedule
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {showModal && <ScheduleCallModal onClose={handleClose} onCreate={handleCreate} prefillName={prefillName} />}
    </>
  );
}

/* ---------------------------------- meetings ---------------------------------- */

const CHANNEL_META = {
  voice: { label: "Voice call", icon: Phone, color: C.cobaltDeep, bg: C.cobaltSoft },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, color: C.teal, bg: C.tealSoft },
  sms: { label: "SMS", icon: MessageSquare, color: C.amber, bg: C.amberSoft },
};

const FORMAT_META = {
  video: { label: "Video call", icon: Video },
  phone: { label: "Phone call", icon: Phone },
  in_person: { label: "In person", icon: MapPin },
};

function ChannelTag({ channel, small }) {
  const m = CHANNEL_META[channel] || CHANNEL_META.voice;
  const Icon = m.icon;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: m.bg, color: m.color, fontFamily: FONT_BODY, fontSize: small ? 10.5 : 11.5, fontWeight: 700, padding: small ? "2px 7px" : "3px 8px", borderRadius: 999 }}>
      <Icon size={small ? 10 : 11} /> {m.label}
    </span>
  );
}

function BookingPanel({ meeting }) {
  const fm = FORMAT_META[meeting.format] || FORMAT_META.video;
  const FormatIcon = fm.icon;
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", background: "#fff" }}>
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, color: C.slateLight, display: "flex", alignItems: "center", gap: 5 }}>
            <CalendarCheck size={11} /> SYNCED VIA CAL.COM
          </span>
          <ChannelTag channel={meeting.channel} small />
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.textInk }}>
          AIVHub × {meeting.prospect}
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginTop: 2 }}>Discovery call · {meeting.duration}</div>
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk }}>
          <Calendar size={13} color={C.slate} /> {meeting.date} · {meeting.time}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk }}>
          <FormatIcon size={13} color={C.slate} />
          {meeting.format === "video" && <>{meeting.platform} — <span style={{ color: C.cobalt }}>{meeting.videoLink}</span></>}
          {meeting.format === "phone" && <>Dial-in — {meeting.dialIn}</>}
          {meeting.format === "in_person" && <>{meeting.address}</>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk }}>
          <Users size={13} color={C.slate} /> {meeting.host} & {meeting.attendee}
        </div>
      </div>

      <div style={{ padding: "0 16px 16px 16px", display: "flex", gap: 8 }}>
        <button style={{ flex: 1, padding: "8px", borderRadius: 7, border: `1px solid ${C.border}`, background: "#fff", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.textInk, cursor: "pointer" }}>Reschedule</button>
        <button style={{ flex: 1, padding: "8px", borderRadius: 7, border: `1px solid ${C.border}`, background: "#fff", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.red, cursor: "pointer" }}>Cancel</button>
        <button style={{ flex: 1.5, padding: "8px", borderRadius: 7, border: "none", background: C.cobalt, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
          {meeting.format === "in_person" ? <><Navigation size={12} /> Directions</> : <><FormatIcon size={12} /> {meeting.format === "phone" ? "Call now" : "Join meeting"}</>}
        </button>
      </div>
    </div>
  );
}

function TranscriptThread({ lines, channel, emptyText }) {
  if (!lines || lines.length === 0) {
    return (
      <div style={{ border: `1px dashed ${C.border}`, borderRadius: 10, padding: "18px 14px", textAlign: "center", fontFamily: FONT_BODY, fontSize: 12.5, color: C.slateLight }}>
        {emptyText}
      </div>
    );
  }
  const isMessage = channel === "whatsapp" || channel === "sms";
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: isMessage ? 6 : 5, background: isMessage ? C.paper : "#fff" }}>
      {lines.map((l, i) => {
        const isAi = l.who === "ai" || l.who === "host";
        if (isMessage) {
          return (
            <div key={i} style={{ display: "flex", justifyContent: isAi ? "flex-end" : "flex-start" }}>
              <div style={{ maxWidth: "78%", background: isAi ? C.cobalt : "#fff", color: isAi ? "#fff" : C.textInk, border: isAi ? "none" : `1px solid ${C.border}`, borderRadius: 12, padding: "7px 11px", fontFamily: FONT_BODY, fontSize: 12.5, lineHeight: 1.4 }}>
                {l.text}
              </div>
            </div>
          );
        }
        return (
          <div key={i} style={{ fontFamily: FONT_MONO, fontSize: 12, lineHeight: 1.5, color: isAi ? C.cobaltDeep : C.textInk }}>
            <span style={{ fontWeight: 700 }}>{isAi ? (l.who === "host" ? "Host: " : "AI: ") : "Them: "}</span>{l.text}
          </div>
        );
      })}
    </div>
  );
}

function MeetingDetailModal({ meeting, onClose, onOutcome, onSaveMeetingTranscript }) {
  const [reminder, setReminder] = useState(true);
  const [showCallTranscript, setShowCallTranscript] = useState(false);
  const [showMeetingTranscript, setShowMeetingTranscript] = useState(true);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasted, setPasted] = useState("");

  const hasMeetingTranscript = meeting.meetingTranscript && meeting.meetingTranscript.length > 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: 800, maxHeight: "90vh", overflowY: "auto", padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.textInk }}>{meeting.prospect}</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 2 }}>{meeting.mission}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} color={C.slate} /></button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Booking</div>
            <BookingPanel meeting={meeting} />
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, cursor: "pointer" }}>
              <input type="checkbox" checked={reminder} onChange={() => setReminder((r) => !r)} />
              Send reminder 1 hour before, via {CHANNEL_META[meeting.channel].label.toLowerCase()}
            </label>

            <div style={{ marginTop: 18 }}>
              <button
                onClick={() => setShowCallTranscript((s) => !s)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 8 }}
              >
                <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Transcript that led to this booking
                </span>
                <ChevronDown size={14} color={C.slateLight} style={{ transform: showCallTranscript ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              </button>
              {showCallTranscript && <TranscriptThread lines={meeting.callTranscript} channel={meeting.channel} emptyText="No transcript recorded." />}
            </div>
          </div>

          <div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Meeting prep brief</div>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>Fit score</span>
                <FitScore value={meeting.fit} />
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk, lineHeight: 1.55 }}>{meeting.prep}</div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Meeting transcript
              </span>
              {meeting.format === "in_person" && (
                <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.slateLight, display: "flex", alignItems: "center", gap: 4 }}>
                  <MapPin size={10} /> not auto-recorded
                </span>
              )}
            </div>
            {hasMeetingTranscript ? (
              <TranscriptThread lines={meeting.meetingTranscript} channel="voice" emptyText="" />
            ) : pasteMode ? (
              <div>
                <textarea
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder="Paste the meeting transcript or notes here after it happens..."
                  style={{ width: "100%", minHeight: 90, padding: 10, borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, resize: "none", outline: "none", boxSizing: "border-box", marginBottom: 8 }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => { onSaveMeetingTranscript(meeting.id, pasted); setPasteMode(false); }}
                    style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 7, padding: "7px 14px", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                  >
                    Save
                  </button>
                  <button onClick={() => setPasteMode(false)} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 14px", fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{ border: `1px dashed ${C.border}`, borderRadius: 10, padding: "16px 14px", textAlign: "center" }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slateLight, marginBottom: 10 }}>
                  {meeting.format === "video" ? "Will appear automatically if the call is recorded, once it's happened." : "Add notes or a transcript once this meeting has happened."}
                </div>
                <button
                  onClick={() => setPasteMode(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 12px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, cursor: "pointer" }}
                >
                  <Paperclip size={12} /> Add transcript or notes
                </button>
              </div>
            )}

            <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", margin: "18px 0 8px 0" }}>
              {meeting.outcome ? "Outcome" : "After the meeting"}
            </div>
            {meeting.outcome ? (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk, display: "flex", alignItems: "center", gap: 8 }}>
                {meeting.status === "converted" ? <CheckCircle2 size={15} color={C.green} /> : <Circle size={15} color={C.slateLight} />}
                {meeting.outcome}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button onClick={() => onOutcome(meeting.id, "converted", "Converted — moved to proposal stage")} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.textInk, cursor: "pointer" }}>
                  <Star size={13} color={C.green} /> Converted — move to proposal
                </button>
                <button onClick={() => onOutcome(meeting.id, "follow_up", "Follow-up scheduled")} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.textInk, cursor: "pointer" }}>
                  <Clock size={13} color={C.teal} /> Needs a follow-up
                </button>
                <button onClick={() => onOutcome(meeting.id, "not_fit", "Not a fit")} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.slate, cursor: "pointer" }}>
                  <X size={13} color={C.slateLight} /> Not a fit
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MeetingsView({ notifications, setNotifications }) {
  const [meetings, setMeetings] = useState(INITIAL_MEETINGS);
  const [openId, setOpenId] = useState(null);

  const setOutcome = (id, status, outcome) => {
    setMeetings((ms) => ms.map((m) => (m.id === id ? { ...m, status, outcome } : m)));
    setNotifications((ns) => [{ id: "n_" + Date.now(), text: `Meeting outcome logged: ${outcome}`, time: "just now", unread: true, type: "success" }, ...ns]);
    setOpenId(null);
  };

  const saveMeetingTranscript = (id, text) => {
    const lines = text.split("\n").filter(Boolean).map((t) => ({ who: "host", text: t }));
    setMeetings((ms) => ms.map((m) => (m.id === id ? { ...m, meetingTranscript: lines } : m)));
    setNotifications((ns) => [{ id: "n_" + Date.now(), text: "Meeting transcript saved", time: "just now", unread: true, type: "info" }, ...ns]);
  };

  const groups = [
    { label: "Needs outcome logged", filter: (m) => m.status === "needs_outcome" },
    { label: "Upcoming", filter: (m) => m.status === "upcoming" },
    { label: "Resolved", filter: (m) => ["converted", "not_fit", "follow_up"].includes(m.status) },
  ];

  const openMeeting = meetings.find((m) => m.id === openId);

  return (
    <>
      <TopBar title="Meetings" subtitle="Everything that happens after a call goes well" notifications={notifications} setNotifications={setNotifications} />
      <div style={{ padding: "20px 32px" }}>
        <div style={{ background: C.tealSoft, border: `1px solid #BFE6DF`, borderRadius: 8, padding: "10px 14px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.teal, marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}>
          <CalendarCheck size={14} /> Every meeting is a real Cal.com booking, whichever channel led to it. Log an outcome after it happens so Analytics reflects actual results, not just bookings made.
        </div>

        {groups.map((g) => {
          const items = meetings.filter(g.filter);
          if (items.length === 0) return null;
          return (
            <div key={g.label} style={{ marginBottom: 22 }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>{g.label} ({items.length})</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
                {items.map((m) => {
                  const fm = FORMAT_META[m.format] || FORMAT_META.video;
                  const FormatIcon = fm.icon;
                  return (
                    <div
                      key={m.id}
                      onClick={() => setOpenId(m.id)}
                      style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 15, cursor: "pointer" }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = C.cobalt)}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = C.border)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14.5, color: C.textInk }}>{m.prospect}</div>
                        <Badge status={m.status} small />
                      </div>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, marginTop: 4 }}>{m.mission}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                        <ChannelTag channel={m.channel} small />
                        <span style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: FONT_BODY, fontSize: 10.5, color: C.slateLight }}>
                          <FormatIcon size={10} /> {fm.label}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontFamily: FONT_MONO, fontSize: 12, color: C.textInk }}>
                        <Calendar size={12} color={C.slate} /> {m.date} · {m.time}
                      </div>
                      {m.outcome && (
                        <div style={{ marginTop: 8, fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>{m.outcome}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {openMeeting && <MeetingDetailModal meeting={openMeeting} onClose={() => setOpenId(null)} onOutcome={setOutcome} onSaveMeetingTranscript={saveMeetingTranscript} />}
    </>
  );
}

/* ---------------------------------- prospects ---------------------------------- */

function ProspectsView({ notifications, setNotifications, onScheduleFor }) {
  const [query, setQuery] = useState("");
  const filtered = PROSPECTS.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <TopBar title="Prospects" subtitle="Every business researched or contacted so far" notifications={notifications} setNotifications={setNotifications} />
      <div style={{ padding: "20px 32px" }}>
        <div style={{ position: "relative", marginBottom: 16, maxWidth: 320 }}>
          <Search size={14} color={C.slateLight} style={{ position: "absolute", left: 11, top: 10 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search prospects..."
            style={{
              width: "100%",
              padding: "8px 12px 8px 32px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              fontFamily: FONT_BODY,
              fontSize: 13,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.4fr 1fr 1fr 1.1fr", padding: "10px 18px", background: C.paper, fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>
            <div>Company</div>
            <div>Region</div>
            <div>Contact</div>
            <div>Status</div>
            <div>Fit score</div>
            <div></div>
          </div>
          {filtered.map((p) => (
            <div
              key={p.id}
              style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.4fr 1fr 1fr 1.1fr", padding: "13px 18px", borderTop: `1px solid ${C.border}`, alignItems: "center" }}
            >
              <div>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, color: C.textInk }}>{p.name}</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight }}>{p.sector}</div>
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>{p.region}</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate }}>{p.contact}</div>
              <div>
                <Badge status={p.status} small />
              </div>
              <FitScore value={p.fit} />
              <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
                <button
                  onClick={() => onScheduleFor && onScheduleFor(p.name)}
                  style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 9px", fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, cursor: "pointer" }}
                >
                  <Calendar size={12} /> Schedule call
                </button>
                <ExternalLink size={14} color={C.slateLight} style={{ cursor: "pointer" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ---------------------------------- company profile ---------------------------------- */

function SectionIntro({ icon: Icon, title, desc }) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, background: C.cobaltSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={15} color={C.cobaltDeep} />
      </div>
      <div>
        <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14.5, color: C.textInk }}>{title}</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 2, lineHeight: 1.5 }}>{desc}</div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, textarea, hint }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>{label}</div>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ width: "100%", minHeight: 70, padding: 10, borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, resize: "none", outline: "none", boxSizing: "border-box" }}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", boxSizing: "border-box" }}
        />
      )}
      {hint && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const PROFILE_TABS = [
  { id: "identity", label: "Identity", icon: Users },
  { id: "knowledge", label: "Knowledge Sources", icon: BookOpen },
  { id: "services", label: "Services", icon: Package },
  { id: "script", label: "Call Script & FAQ", icon: HelpCircle },
  { id: "compliance", label: "Compliance", icon: ShieldCheck },
];

function CompanyProfileView({ profile, setProfile, notifications, setNotifications }) {
  const [tab, setTab] = useState("identity");
  const [saved, setSaved] = useState(false);
  const [sources, setSources] = useState(INITIAL_KNOWLEDGE_SOURCES);
  const [addingSource, setAddingSource] = useState(false);
  const [newSource, setNewSource] = useState({ name: "", type: "Website URL", value: "" });
  const [services, setServices] = useState(INITIAL_SERVICES);
  const [faq, setFaq] = useState(INITIAL_FAQ);

  const update = (k, v) => setProfile((p) => ({ ...p, [k]: v }));
  const save = () => {
    setSaved(true);
    setNotifications((ns) => [{ id: "n_" + Date.now(), text: "Company profile updated", time: "just now", unread: true, type: "info" }, ...ns]);
    setTimeout(() => setSaved(false), 1800);
  };

  const addSource = () => {
    if (!newSource.name || !newSource.value) return;
    setSources((s) => [...s, { id: "k_" + Date.now(), ...newSource, status: "pending", synced: "just now" }]);
    setNewSource({ name: "", type: "Website URL", value: "" });
    setAddingSource(false);
  };
  const removeSource = (id) => setSources((s) => s.filter((x) => x.id !== id));

  const addService = () => setServices((s) => [...s, { id: "sv_" + Date.now(), name: "", ideal: "", desc: "" }]);
  const updateService = (id, k, v) => setServices((s) => s.map((x) => (x.id === id ? { ...x, [k]: v } : x)));
  const removeService = (id) => setServices((s) => s.filter((x) => x.id !== id));

  const addFaq = () => setFaq((f) => [...f, { id: "f_" + Date.now(), q: "", a: "" }]);
  const updateFaq = (id, k, v) => setFaq((f) => f.map((x) => (x.id === id ? { ...x, [k]: v } : x)));
  const removeFaq = (id) => setFaq((f) => f.filter((x) => x.id !== id));

  return (
    <>
      <TopBar title="Company Profile" subtitle="Everything the AI knows about your company when it's on a call" notifications={notifications} setNotifications={setNotifications} />
      <div style={{ padding: "20px 32px", display: "grid", gridTemplateColumns: "200px 1fr", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {PROFILE_TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", borderRadius: 8, border: "none", cursor: "pointer", textAlign: "left",
                  background: active ? C.cobaltSoft : "transparent", color: active ? C.cobaltDeep : C.slate, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600,
                }}
              >
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </div>

        <div style={{ maxWidth: 680 }}>
          {tab === "identity" && (
            <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
              <SectionIntro icon={Users} title="Company identity" desc="Basic facts the AI introduces itself with and uses to explain who it's calling on behalf of." />
              <Field label="Company name" value={profile.name} onChange={(v) => update("name", v)} placeholder="AIVHub" />
              <Field label="One-line pitch" value={profile.pitch} onChange={(v) => update("pitch", v)} placeholder="AI-powered business intelligence dashboards for mid-market operations teams" />
              <Field label="Industry" value={profile.industry || ""} onChange={(v) => update("industry", v)} placeholder="Business intelligence / data consulting" />
              <Field label="Website" value={profile.website || ""} onChange={(v) => update("website", v)} placeholder="https://aivhub.io" hint="Also added automatically as a knowledge source." />
              <Field label="LinkedIn / other social links" value={profile.social || ""} onChange={(v) => update("social", v)} placeholder="linkedin.com/company/aivhub" />
              <Field label="Caller persona name" value={profile.callerName} onChange={(v) => update("callerName", v)} placeholder="Sam" hint="The name the AI introduces itself as on calls." />
              <Field label="Caller ID number shown" value={profile.callerId} onChange={(v) => update("callerId", v)} placeholder="+44 20 7946 0912" />
              <Field label="Tone" value={profile.tone} onChange={(v) => update("tone", v)} placeholder="Professional, concise, friendly" />
              <button onClick={save} style={{ marginTop: 6, background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Save changes
              </button>
            </div>
          )}

          {tab === "knowledge" && (
            <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
              <SectionIntro icon={BookOpen} title="Knowledge sources" desc="Website pages, documents, or links the AI can reference when a prospect asks something specific — pricing, case studies, technical detail. Add anything you'd hand a new salesperson on day one." />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {sources.map((s) => (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", border: `1px solid ${C.border}`, borderRadius: 9 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 7, background: C.paper, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {s.type === "Website URL" ? <Globe size={14} color={C.slate} /> : s.type.includes("Drive") ? <Link2 size={14} color={C.slate} /> : s.type === "Document upload" ? <FileText size={14} color={C.slate} /> : <FileText size={14} color={C.slate} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, color: C.textInk }}>{s.name}</div>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.type} · {s.value}</div>
                    </div>
                    <Badge status={s.status} small />
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, width: 78, textAlign: "right" }}>{s.synced}</div>
                    <button onClick={() => removeSource(s.id)} style={{ background: "none", border: "none", cursor: "pointer" }}>
                      <Trash2 size={14} color={C.slateLight} />
                    </button>
                  </div>
                ))}
                {sources.length === 0 && (
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slateLight, padding: "16px 0", textAlign: "center" }}>
                    No knowledge sources yet — add your website or a pricing doc to get started.
                  </div>
                )}
              </div>

              {addingSource ? (
                <div style={{ marginTop: 12, border: `1px dashed ${C.cobalt}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  <input
                    value={newSource.name}
                    onChange={(e) => setNewSource((n) => ({ ...n, name: e.target.value }))}
                    placeholder="Name this source, e.g. 'Pricing sheet'"
                    style={{ padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none" }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <select
                      value={newSource.type}
                      onChange={(e) => setNewSource((n) => ({ ...n, type: e.target.value }))}
                      style={{ padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5 }}
                    >
                      {["Website URL", "Document upload", "Google Drive link", "Google Docs link", "Manual text"].map((o) => <option key={o}>{o}</option>)}
                    </select>
                    <input
                      value={newSource.value}
                      onChange={(e) => setNewSource((n) => ({ ...n, value: e.target.value }))}
                      placeholder={newSource.type === "Manual text" ? "Paste or type the content" : "Paste link, or filename if uploading"}
                      style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none" }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={addSource} style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 7, padding: "7px 14px", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Add source</button>
                    <button onClick={() => setAddingSource(false)} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 7, padding: "7px 14px", fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setAddingSource(true)}
                  style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px dashed ${C.border}`, borderRadius: 8, padding: "9px 12px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, cursor: "pointer", width: "100%", justifyContent: "center" }}
                >
                  <PlusCircle size={13} /> Add a knowledge source
                </button>
              )}
            </div>
          )}

          {tab === "services" && (
            <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
              <SectionIntro icon={Package} title="Services & ideal customer" desc="What you're pitching, and who it's a good fit for — helps the AI tailor the pitch to each prospect's sector and size." />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {services.map((s) => (
                  <div key={s.id} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input value={s.name} onChange={(e) => updateService(s.id, "name", e.target.value)} placeholder="Service name" style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none" }} />
                      <button onClick={() => removeService(s.id)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={14} color={C.slateLight} /></button>
                    </div>
                    <input value={s.ideal} onChange={(e) => updateService(s.id, "ideal", e.target.value)} placeholder="Ideal customer, e.g. mid-market ops teams 50-500 staff" style={{ padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none" }} />
                    <textarea value={s.desc} onChange={(e) => updateService(s.id, "desc", e.target.value)} placeholder="Short description of what it does" style={{ padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none", minHeight: 50, resize: "none" }} />
                  </div>
                ))}
              </div>
              <button onClick={addService} style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px dashed ${C.border}`, borderRadius: 8, padding: "9px 12px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, cursor: "pointer", width: "100%", justifyContent: "center" }}>
                <PlusCircle size={13} /> Add a service
              </button>
            </div>
          )}

          {tab === "script" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
                <SectionIntro icon={HelpCircle} title="Call disclosure & script basics" desc="Required opening line, plus the general tone every call should follow." />
                <Field label="Call recording disclosure script" value={profile.disclosure} onChange={(v) => update("disclosure", v)} placeholder="This call may be recorded for quality and training purposes." textarea />
                <button onClick={save} style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Save changes</button>
              </div>

              <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
                <SectionIntro icon={HelpCircle} title="Common questions & approved answers" desc="When a prospect asks something the AI hasn't heard before, it falls back to these — write answers the way you'd want a new hire to say them." />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {faq.map((f) => (
                    <div key={f.id} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input value={f.q} onChange={(e) => updateFaq(f.id, "q", e.target.value)} placeholder="Question a prospect might ask" style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none", fontWeight: 600 }} />
                        <button onClick={() => removeFaq(f.id)} style={{ background: "none", border: "none", cursor: "pointer" }}><Trash2 size={14} color={C.slateLight} /></button>
                      </div>
                      <textarea value={f.a} onChange={(e) => updateFaq(f.id, "a", e.target.value)} placeholder="Approved answer" style={{ padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none", minHeight: 50, resize: "none" }} />
                    </div>
                  ))}
                </div>
                <button onClick={addFaq} style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px dashed ${C.border}`, borderRadius: 8, padding: "9px 12px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, cursor: "pointer", width: "100%", justifyContent: "center" }}>
                  <PlusCircle size={13} /> Add a question
                </button>
              </div>
            </div>
          )}

          {tab === "compliance" && (
            <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
              <SectionIntro icon={ShieldCheck} title="Compliance & legal" desc="Details needed for UK outbound-calling rules — shown to admins only, never spoken on calls." />
              <Field label="Registered legal company name" value={profile.legalName || ""} onChange={(v) => update("legalName", v)} placeholder="AIVHub Ltd" />
              <Field label="ICO registration reference" value={profile.icoRef || ""} onChange={(v) => update("icoRef", v)} placeholder="ZA123456" />
              <Field label="Data protection contact" value={profile.dpoContact || ""} onChange={(v) => update("dpoContact", v)} placeholder="privacy@aivhub.io" />
              <Field label="Do-not-call list handling notes" value={profile.dncNotes || ""} onChange={(v) => update("dncNotes", v)} placeholder="Opt-outs logged immediately and excluded from all future missions." textarea />
              <button onClick={save} style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Save changes</button>
            </div>
          )}
        </div>
      </div>

      {saved && (
        <div style={{ position: "fixed", bottom: 24, right: 32, background: C.ink, color: "#fff", padding: "12px 18px", borderRadius: 10, fontFamily: FONT_BODY, fontSize: 12.5, display: "flex", alignItems: "center", gap: 10 }}>
          <CheckCircle2 size={15} color={C.teal} /> Saved — used on all future calls
        </div>
      )}
    </>
  );
}

/* ---------------------------------- connections ---------------------------------- */

function AddIntegrationModal({ onClose, onAdd }) {
  const [form, setForm] = useState({ category: "LLM", name: "", key: "", endpoint: "" });
  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const canSave = form.name.trim().length > 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "#fff", borderRadius: 14, width: 440, padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.textInk }}>Add integration</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={17} color={C.slate} /></button>
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginBottom: 14 }}>
          Connect any provider not already listed — a new LLM, a CRM, a spreadsheet tool, anything your team relies on.
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Category</div>
          <select value={form.category} onChange={(e) => upd("category", e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}>
            {CATEGORY_OPTIONS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Provider name</div>
          <input value={form.name} onChange={(e) => upd("name", e.target.value)} placeholder="e.g. HubSpot, Mistral, custom internal API" style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>API key / credential <span style={{ color: C.slateLight, fontWeight: 400 }}>(optional for now)</span></div>
          <input type="password" value={form.key} onChange={(e) => upd("key", e.target.value)} placeholder="Paste API key..." style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5, outline: "none", boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Endpoint URL <span style={{ color: C.slateLight, fontWeight: 400 }}>(optional)</span></div>
          <input value={form.endpoint} onChange={(e) => upd("endpoint", e.target.value)} placeholder="https://api.example.com/v1" style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
        </div>
        <button
          disabled={!canSave}
          onClick={() => canSave && onAdd(form)}
          style={{ width: "100%", padding: "10px", borderRadius: 9, border: "none", background: canSave ? C.ink : C.paperSoft, color: canSave ? "#fff" : C.slateLight, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, cursor: canSave ? "pointer" : "default" }}
        >
          Add integration
        </button>
      </div>
    </div>
  );
}

function ConnectionsView({ notifications, setNotifications }) {
  const [state, setState] = useState(CONNECTIONS);
  const [editingKey, setEditingKey] = useState(null);
  const [keyValue, setKeyValue] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const setStatus = (group, name, status) => {
    setState((s) => s.map((g) => (g.group === group ? { ...g, items: g.items.map((it) => (it.name === name ? { ...it, status } : it)) } : g)));
  };

  const addIntegration = (form) => {
    setState((s) => s.map((g) => (g.group === form.category ? { ...g, items: [...g.items, { name: form.name, status: form.key ? "connected" : "not_configured" }] } : g)));
    setShowAdd(false);
    setNotifications((ns) => [{ id: "n_" + Date.now(), text: `${form.name} added under ${form.category}`, time: "just now", unread: true, type: "info" }, ...ns]);
  };

  return (
    <>
      <TopBar title="Connections" subtitle="API keys and credentials for every provider across the stack" notifications={notifications} setNotifications={setNotifications} />
      <div style={{ padding: "20px 32px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, background: C.amberSoft, border: `1px solid #F0D9A8`, borderRadius: 8, padding: "10px 14px", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <KeyRound size={14} color="#8A5A05" style={{ marginTop: 2, flexShrink: 0 }} />
            <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: "#8A5A05" }}>
              Add credentials here for any provider you might use — which one is <em style={{ fontStyle: "italic" }}>active</em> is chosen separately under AI Providers. Don't see something you use? Add it below.
            </span>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, background: C.ink, color: "#fff", border: "none", borderRadius: 7, padding: "7px 12px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <PlusCircle size={13} /> Add integration
          </button>
        </div>

        {state.map((group) => (
          <div key={group.group} style={{ marginBottom: 18 }}>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>{group.group}</div>
              {group.desc && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, marginTop: 2 }}>{group.desc}</div>}
            </div>
            {group.items.length === 0 ? (
              <div style={{ border: `1px dashed ${C.border}`, borderRadius: 12, padding: "16px 18px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.slateLight, textAlign: "center" }}>
                Nothing connected yet in this category — use "Add integration" above.
              </div>
            ) : (
            <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              {group.items.map((it, idx) => {
                const rowKey = group.group + it.name;
                const isEditing = editingKey === rowKey;
                return (
                  <div key={it.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderTop: idx === 0 ? "none" : `1px solid ${C.border}` }}>
                    <div style={{ width: 200, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, color: C.textInk }}>{it.name}</div>
                    {isEditing ? (
                      <input
                        autoFocus
                        type="password"
                        value={keyValue}
                        onChange={(e) => setKeyValue(e.target.value)}
                        placeholder="Paste API key..."
                        style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.cobalt}`, fontFamily: FONT_MONO, fontSize: 12.5, outline: "none" }}
                      />
                    ) : (
                      <div style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 12.5, color: C.slateLight }}>
                        {it.status === "connected" ? "••••••••••••" + it.name.slice(0, 2).toLowerCase() : "Not set"}
                      </div>
                    )}
                    <Badge status={it.status} small />
                    {isEditing ? (
                      <button
                        onClick={() => { setStatus(group.group, it.name, "connected"); setEditingKey(null); setKeyValue(""); }}
                        style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                      >
                        Save
                      </button>
                    ) : (
                      <button
                        onClick={() => { setEditingKey(rowKey); setKeyValue(""); }}
                        style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 12px", fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, cursor: "pointer" }}
                      >
                        {it.status === "connected" ? "Update" : "Connect"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </div>
        ))}
      </div>

      {showAdd && <AddIntegrationModal onClose={() => setShowAdd(false)} onAdd={addIntegration} />}
    </>
  );
}

/* ---------------------------------- provider config ---------------------------------- */

const LAYERS = [
  { key: "voice", label: "Voice Orchestration", paid: "Vapi", oss: "LiveKit (self-hosted)", options: ["Vapi", "Retell", "LiveKit (self-hosted)"] },
  { key: "llm", label: "LLM · Conversation", paid: "Claude Sonnet 4.5", oss: "DeepSeek V4 Flash", options: ["Claude Sonnet 4.5", "GPT-4o", "DeepSeek V4 Flash"] },
  { key: "stt", label: "Speech-to-Text", paid: "Deepgram Nova-3", oss: "Faster-Whisper (self-hosted)", options: ["Deepgram Nova-3", "Faster-Whisper (self-hosted)"] },
  { key: "tts", label: "Text-to-Speech", paid: "ElevenLabs Turbo", oss: "Kokoro (self-hosted)", options: ["ElevenLabs Turbo", "Cartesia Sonic", "Kokoro (self-hosted)"] },
  { key: "telephony", label: "Telephony", paid: "Twilio", oss: "Telnyx", options: ["Twilio", "Telnyx"] },
  { key: "calendar", label: "Calendar", paid: "Cal.com (Cloud)", oss: "Cal.com (Self-hosted)", options: ["Cal.com (Cloud)", "Cal.com (Self-hosted)"] },
];

function ProviderConfigView({ notifications, setNotifications }) {
  const [mode, setMode] = useState("paid");
  const [custom, setCustom] = useState(Object.fromEntries(LAYERS.map((l) => [l.key, l.paid])));
  const [dirty, setDirty] = useState(false);

  const applyMode = (m) => {
    setMode(m);
    if (m === "paid") setCustom(Object.fromEntries(LAYERS.map((l) => [l.key, l.paid])));
    if (m === "opensource") setCustom(Object.fromEntries(LAYERS.map((l) => [l.key, l.oss])));
    flash();
  };

  const flash = () => {
    setDirty(true);
    setTimeout(() => setDirty(false), 1400);
  };

  const isOss = (val) => val.toLowerCase().includes("self-hosted") || val.toLowerCase().includes("telnyx") || val.toLowerCase().includes("deepseek") || val.toLowerCase().includes("kokoro") || val.toLowerCase().includes("livekit") || val.toLowerCase().includes("whisper");

  return (
    <>
      <TopBar title="AI Providers" subtitle="Switch every layer between managed APIs and self-hosted models" notifications={notifications} setNotifications={setNotifications} />
      <div style={{ padding: "20px 32px" }}>
        <div style={{ background: C.amberSoft, border: `1px solid #F0D9A8`, borderRadius: 8, padding: "10px 14px", fontFamily: FONT_BODY, fontSize: 12.5, color: "#8A5A05", marginBottom: 20 }}>
          Telephony carrier cost applies in both Paid and Open Source modes. Need credentials for a provider first? Set them up under Connections.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
          {[
            { id: "paid", title: "Paid / Managed", desc: "Best-in-class APIs. Fastest to run, no infra." },
            { id: "opensource", title: "Open Source", desc: "Self-hosted models. Lower cost, full control." },
            { id: "custom", title: "Custom", desc: "Mix providers per layer." },
          ].map((m) => (
            <div
              key={m.id}
              onClick={() => applyMode(m.id)}
              style={{
                border: `2px solid ${mode === m.id ? C.ink : C.border}`,
                borderRadius: 12,
                padding: 16,
                cursor: "pointer",
                background: mode === m.id ? C.ink : "#fff",
                transition: "all 0.15s",
              }}
            >
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: mode === m.id ? "#fff" : C.textInk }}>{m.title}</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: mode === m.id ? "#B8BCC8" : C.slate, marginTop: 4 }}>{m.desc}</div>
            </div>
          ))}
        </div>

        <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr 1fr", padding: "10px 18px", background: C.paper, fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>
            <div>Layer</div>
            <div>Provider</div>
            <div>Status</div>
          </div>
          {LAYERS.map((l) => {
            const val = custom[l.key];
            const oss = isOss(val);
            return (
              <div key={l.key} style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr 1fr", padding: "13px 18px", borderTop: `1px solid ${C.border}`, alignItems: "center" }}>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, color: C.textInk }}>{l.label}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <select
                    value={val}
                    onChange={(e) => {
                      setCustom((c) => ({ ...c, [l.key]: e.target.value }));
                      setMode("custom");
                      flash();
                    }}
                    style={{
                      fontFamily: FONT_BODY,
                      fontSize: 13,
                      padding: "6px 10px",
                      borderRadius: 7,
                      border: `1px solid ${C.border}`,
                      background: "#fff",
                      color: C.textInk,
                      cursor: "pointer",
                    }}
                  >
                    {l.options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: oss ? C.tealSoft : C.cobaltSoft, color: oss ? C.teal : C.cobaltDeep }}>
                    {oss ? "SELF-HOSTED" : "PAID API"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: C.green }} />
                  <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate }}>Connected</span>
                </div>
              </div>
            );
          })}
        </div>

        {dirty && (
          <div style={{ position: "fixed", bottom: 24, right: 32, background: C.ink, color: "#fff", padding: "12px 18px", borderRadius: 10, fontFamily: FONT_BODY, fontSize: 12.5, display: "flex", alignItems: "center", gap: 10 }}>
            <CheckCircle2 size={15} color={C.teal} /> Provider changes applied — takes effect on new calls
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------------------------- analytics ---------------------------------- */

function MetricCard({ label, value, delta, mono }) {
  return (
    <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
        <div style={{ fontFamily: mono ? FONT_MONO : FONT_DISPLAY, fontSize: 26, fontWeight: 700, color: C.textInk }}>{value}</div>
        {delta && (
          <div style={{ display: "flex", alignItems: "center", gap: 2, color: C.green, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600 }}>
            <ArrowUpRight size={13} /> {delta}
          </div>
        )}
      </div>
    </div>
  );
}

function AnalyticsView({ notifications, setNotifications }) {
  return (
    <>
      <TopBar title="Analytics" subtitle="Platform performance and cost, last 30 days" notifications={notifications} setNotifications={setNotifications} />
      <div style={{ padding: "20px 32px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
          <MetricCard label="Meetings booked rate" value="18%" delta="+6pt" />
          <MetricCard label="Human takeover rate" value="9%" />
          <MetricCard label="Cost per meeting booked" value="£11.40" mono />
          <MetricCard label="Avg. call duration" value="2m 34s" mono />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14 }}>
          <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
            <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, color: C.textInk, marginBottom: 12 }}>Meetings booked rate — trend</div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={TREND}>
                <CartesianGrid stroke={C.border} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fontFamily: FONT_BODY, fill: C.slate }} axisLine={{ stroke: C.border }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fontFamily: FONT_BODY, fill: C.slate }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip contentStyle={{ fontFamily: FONT_BODY, fontSize: 12, borderRadius: 8, border: `1px solid ${C.border}` }} />
                <Line type="monotone" dataKey="rate" stroke={C.cobalt} strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
            <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, color: C.textInk, marginBottom: 12 }}>Cost by layer — Paid vs Open Source</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={COST_BREAKDOWN}>
                <CartesianGrid stroke={C.border} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fontFamily: FONT_BODY, fill: C.slate }} axisLine={{ stroke: C.border }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fontFamily: FONT_BODY, fill: C.slate }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ fontFamily: FONT_BODY, fontSize: 12, borderRadius: 8, border: `1px solid ${C.border}` }} />
                <Legend wrapperStyle={{ fontFamily: FONT_BODY, fontSize: 11.5 }} />
                <Bar dataKey="Paid" fill={C.cobalt} radius={[4, 4, 0, 0]} />
                <Bar dataKey="Open Source" fill={C.teal} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------------------------------- new mission modal ---------------------------------- */

function NewMissionModal({ onClose, onCreate }) {
  const [tab, setTab] = useState("discover");
  const [prompt, setPrompt] = useState("");
  const [rows, setRows] = useState([{ id: 1, name: "", phone: "", sourceType: "Website URL", source: "" }]);
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("17:30");
  const [channel, setChannel] = useState("voice");

  const parsed = prompt.length > 8;

  const addRow = () => setRows((r) => [...r, { id: Date.now(), name: "", phone: "", sourceType: "Website URL", source: "" }]);
  const removeRow = (id) => setRows((r) => r.filter((x) => x.id !== id));
  const updateRow = (id, k, v) => setRows((r) => r.map((x) => (x.id === id ? { ...x, [k]: v } : x)));

  const canSubmit = tab === "discover" ? parsed : rows.some((r) => r.name && r.phone);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: 620, maxHeight: "88vh", overflowY: "auto", padding: 26, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.textInk }}>New outreach</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={18} color={C.slate} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 18, background: C.paperSoft, padding: 4, borderRadius: 9 }}>
          <button
            onClick={() => setTab("discover")}
            style={{ flex: 1, padding: "8px 10px", borderRadius: 7, border: "none", cursor: "pointer", background: tab === "discover" ? "#fff" : "transparent", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: tab === "discover" ? C.textInk : C.slate, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <Sparkles size={13} /> Describe & discover
          </button>
          <button
            onClick={() => setTab("manual")}
            style={{ flex: 1, padding: "8px 10px", borderRadius: 7, border: "none", cursor: "pointer", background: tab === "manual" ? "#fff" : "transparent", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: tab === "manual" ? C.textInk : C.slate, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <Users size={13} /> Provide contact list
          </button>
        </div>

        {tab === "discover" && (
          <>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginBottom: 6 }}>Who should we reach out to?</div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Mid-size logistics companies in Manchester, pitch our BI dashboard, book a 15-min discovery call"
              style={{ width: "100%", minHeight: 80, padding: 12, borderRadius: 10, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13.5, resize: "none", outline: "none", boxSizing: "border-box" }}
            />
            {parsed && (
              <div style={{ marginTop: 14, background: C.paper, borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
                  <Globe size={12} /> Parsed — will search the web to find matching businesses
                </div>
                {[
                  ["Sector", "Logistics"],
                  ["Region", "Manchester"],
                  ["Pitch", "BI dashboard demo"],
                  ["Meeting type", "15-min discovery call"],
                  ["Target count", "20 prospects"],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT_BODY, fontSize: 12.5 }}>
                    <span style={{ color: C.slate }}>{k}</span>
                    <span style={{ color: C.textInk, fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "manual" && (
          <>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginBottom: 10 }}>
              Add businesses to contact directly — include a link so the AI can research them before calling.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {rows.map((r) => (
                <div key={r.id} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={r.name}
                      onChange={(e) => updateRow(r.id, "name", e.target.value)}
                      placeholder="Company name"
                      style={{ flex: 1.3, padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none" }}
                    />
                    <input
                      value={r.phone}
                      onChange={(e) => updateRow(r.id, "phone", e.target.value)}
                      placeholder="Phone number"
                      style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none" }}
                    />
                    <button onClick={() => removeRow(r.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 4px" }}>
                      <Trash2 size={14} color={C.slateLight} />
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <select
                      value={r.sourceType}
                      onChange={(e) => updateRow(r.id, "sourceType", e.target.value)}
                      style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5 }}
                    >
                      {["Website URL", "Document upload", "Google Maps link", "Google Drive link", "Notes only"].map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                    <input
                      value={r.source}
                      onChange={(e) => updateRow(r.id, "source", e.target.value)}
                      placeholder={r.sourceType === "Notes only" ? "Free-text notes about this business" : "Paste link"}
                      style={{ flex: 2, padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none" }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={addRow}
              style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px dashed ${C.border}`, borderRadius: 8, padding: "8px 12px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, cursor: "pointer", width: "100%", justifyContent: "center" }}
            >
              <PlusCircle size={13} /> Add another business
            </button>
          </>
        )}

        <div style={{ marginTop: 18, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <Sparkles size={12} /> Contact channel
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
            {[
              { id: "voice", label: "Voice call", icon: Phone },
              { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
              { id: "sms", label: "SMS", icon: MessageSquare },
              { id: "auto", label: "Let AI choose", icon: Sparkle },
            ].map((c) => {
              const Icon = c.icon;
              const active = channel === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setChannel(c.id)}
                  style={{
                    flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "9px 6px", borderRadius: 9,
                    border: `1.5px solid ${active ? C.ink : C.border}`, background: active ? C.ink : "#fff", color: active ? "#fff" : C.slate, cursor: "pointer",
                  }}
                >
                  <Icon size={14} />
                  <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 600 }}>{c.label}</span>
                </button>
              );
            })}
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>
            {channel === "auto" ? "AI tries a voice call first, and falls back to WhatsApp or SMS if it can't get through." : `Prospects on this mission will be contacted by ${channel === "voice" ? "phone call" : channel === "whatsapp" ? "WhatsApp message" : "text message"}.`}
          </div>
        </div>

        <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <Clock size={12} /> Call schedule
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>Call window</span>
            <select value={windowStart} onChange={(e) => setWindowStart(e.target.value)} style={{ padding: "6px 9px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5 }}>
              {["08:00", "09:00", "10:00"].map((t) => <option key={t}>{t}</option>)}
            </select>
            <span style={{ color: C.slateLight }}>–</span>
            <select value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} style={{ padding: "6px 9px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5 }}>
              {["16:00", "17:00", "17:30", "18:00"].map((t) => <option key={t}>{t}</option>)}
            </select>
            <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, marginLeft: "auto" }}>UK compliance limit: 09:00–17:30</span>
          </div>
        </div>

        <button
          onClick={() => canSubmit && onCreate()}
          disabled={!canSubmit}
          style={{
            marginTop: 18,
            width: "100%",
            padding: "11px",
            borderRadius: 9,
            border: "none",
            background: canSubmit ? C.ink : C.paperSoft,
            color: canSubmit ? "#fff" : C.slateLight,
            fontFamily: FONT_BODY,
            fontWeight: 600,
            fontSize: 13.5,
            cursor: canSubmit ? "pointer" : "default",
          }}
        >
          Confirm & start mission
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------- app shell ---------------------------------- */

export default function App() {
  const [view, setView] = useState("missions");
  const [selectedMission, setSelectedMission] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [notifications, setNotifications] = useState(INITIAL_NOTIFICATIONS);
  const [missions, setMissions] = useState(INITIAL_MISSIONS);
  const [prefillSchedule, setPrefillSchedule] = useState(null);
  const [profile, setProfile] = useState({
    name: "AIVHub",
    pitch: "AI-powered business intelligence dashboards for mid-market operations teams",
    services: "BI dashboards, data pipeline consulting, real-time reporting",
    callerName: "Sam",
    callerId: "+44 20 7946 0912",
    tone: "Professional, concise, friendly",
    disclosure: "This call may be recorded for quality and training purposes.",
  });

  const openMission = (m) => {
    setSelectedMission(m);
    setView("missionDetail");
  };

  const createMission = () => {
    setShowNew(false);
    setNotifications((ns) => [{ id: "n_" + Date.now(), text: "New outreach mission created and queued", time: "just now", unread: true, type: "info" }, ...ns]);
  };

  const goScheduleFor = (name) => {
    setPrefillSchedule(name);
    setView("schedule");
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: C.paper, fontFamily: FONT_BODY }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: #D8D5CD; border-radius: 4px; }
        select:focus, input:focus, textarea:focus { border-color: ${C.cobalt} !important; }
        @keyframes pulseBar {
          0%, 100% { height: 4px; opacity: 0.5; }
          50% { height: 14px; opacity: 1; }
        }
      `}</style>

      <Sidebar view={view === "missionDetail" ? "missions" : view} setView={(v) => { setView(v); setSelectedMission(null); }} companyName={profile.name} />

      <div style={{ flex: 1, overflowY: "auto" }}>
        {view === "missions" && <MissionsView missions={missions} onOpenMission={openMission} onNewMission={() => setShowNew(true)} notifications={notifications} setNotifications={setNotifications} />}
        {view === "missionDetail" && selectedMission && <MissionDetail mission={selectedMission} onBack={() => setView("missions")} companyName={profile.name} />}
        {view === "schedule" && <ScheduleView notifications={notifications} setNotifications={setNotifications} prefillName={prefillSchedule} clearPrefill={() => setPrefillSchedule(null)} />}
        {view === "meetings" && <MeetingsView notifications={notifications} setNotifications={setNotifications} />}
        {view === "live" && <LiveCallsView notifications={notifications} setNotifications={setNotifications} companyName={profile.name} />}
        {view === "prospects" && <ProspectsView notifications={notifications} setNotifications={setNotifications} onScheduleFor={goScheduleFor} />}
        {view === "company" && <CompanyProfileView profile={profile} setProfile={setProfile} notifications={notifications} setNotifications={setNotifications} />}
        {view === "connections" && <ConnectionsView notifications={notifications} setNotifications={setNotifications} />}
        {view === "provider" && <ProviderConfigView notifications={notifications} setNotifications={setNotifications} />}
        {view === "analytics" && <AnalyticsView notifications={notifications} setNotifications={setNotifications} />}
      </div>

      {showNew && <NewMissionModal onClose={() => setShowNew(false)} onCreate={createMission} />}
    </div>
  );
}
