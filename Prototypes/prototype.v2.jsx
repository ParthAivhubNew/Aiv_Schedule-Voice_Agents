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
  UploadCloud,
  FileSpreadsheet,
  Table2,
  History,
  Quote,
} from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
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
  { id: "m2", title: "Manufacturing SMEs — Leeds", sector: "Manufacturing", region: "Leeds", status: "completed", contacted: 15, total: 15, meetingsBooked: 6, created: "20 Aug", source: "discover", prospects: [
    { id: "p2a", name: "Ferrum Manufacturing", status: "meeting_booked", note: "Meeting booked — Fri 3 Sep, 2:00 PM", time: "20 Aug" },
    { id: "p2b", name: "Yorkshire Components Ltd", status: "meeting_booked", note: "Converted — moved to proposal stage", time: "20 Aug" },
    { id: "p2c", name: "Dales Precision Engineering", status: "meeting_booked", note: "Meeting booked — Mon 6 Sep, 10:00 AM", time: "19 Aug" },
    { id: "p2d", name: "Aire Valley Fabrication", status: "interested", note: "Interested, following up next quarter", time: "19 Aug" },
    { id: "p2e", name: "Leeds Metal Works", status: "rejected", note: "Not interested — added to do-not-call", time: "18 Aug" },
    { id: "p2f", name: "Kirkstall Tooling Co", status: "contacted", note: "Left voicemail, no callback yet", time: "18 Aug" },
  ] },
  { id: "m3", title: "Retail chains — Birmingham", sector: "Retail", region: "Birmingham", status: "needs_attention", contacted: 8, total: 25, meetingsBooked: 1, created: "22 Aug", source: "discover", prospects: [
    { id: "p3a", name: "Midlands Fashion Co", status: "meeting_booked", note: "Meeting booked — Sat 24 Aug, 9:30 AM", time: "24 Aug" },
    { id: "p3b", name: "Bright Retail Group", status: "human_review", note: "Asked about pricing — needs staff input", time: "25 Aug" },
    { id: "p3c", name: "Bullring Fashion House", status: "researching", note: "Researching company profile", time: "25 Aug" },
    { id: "p3d", name: "Colmore Row Boutiques", status: "retry", note: "No answer — retry scheduled tomorrow", time: "24 Aug" },
    { id: "p3e", name: "Custard Factory Retail Co", status: "rejected", note: "Not interested — added to do-not-call", time: "23 Aug" },
  ] },
  { id: "m4", title: "Provided contact list — Q3 warm leads", sector: "Mixed", region: "UK-wide", status: "active", contacted: 5, total: 9, meetingsBooked: 0, created: "26 Aug", source: "manual", prospects: [
    { id: "p4a", name: "Riverside Manufacturing", status: "calling", note: "Negotiating meeting time over WhatsApp", time: "now" },
    { id: "p4b", name: "Coventry Precision Ltd", status: "retry", note: "They asked: “Call me back next week, Monday morning if you can.” — callback set Mon 31 Aug, 10:00. Not re-dialed cold.", time: "26 Aug" },
    { id: "p4c", name: "Solent Freight Partners", status: "contacted", note: "Left voicemail, no callback yet", time: "26 Aug" },
    { id: "p4d", name: "Thameside Distribution", status: "human_review", note: "Asked about pricing — needs staff input", time: "26 Aug" },
    { id: "p4e", name: "Wessex Components", status: "contacted", note: "Spoke briefly, not the right contact — redialing switchboard", time: "26 Aug" },
    { id: "p4f", name: "Anglia Fabrication Co", status: "queued", note: "Not yet contacted — next in queue", time: "waiting" },
    { id: "p4g", name: "Chiltern Logistics Group", status: "queued", note: "Not yet contacted — next in queue", time: "waiting" },
    { id: "p4h", name: "Mersey Industrial Supplies", status: "queued", note: "Not yet contacted — next in queue", time: "waiting" },
    { id: "p4i", name: "Tyneside Manufacturing Co", status: "queued", note: "Not yet contacted — next in queue", time: "waiting" },
  ] },
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
  { id: "s8", day: "Mon, 31 Aug", time: "10:00", prospect: "Coventry Precision Ltd", mission: "Q3 warm leads", window: "09:00–17:30", status: "queued", honored: true, honoredQuote: "Call me back next week, Monday morning if you can." },
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

/* ---------------------------------- identity registry + call log ---------------------------------- */

// one canonical record per real-world company. aliases catch the same firm under
// different legal spellings ("Acme Logistics Ltd" vs "ACME LOGISTICS LIMITED") so
// we don't dial them twice from a fresh spreadsheet.
const INITIAL_CONTACT_REGISTRY = [
  {
    id: "cr1",
    canonicalName: "Acme Logistics Ltd",
    aliases: ["Acme Logistics", "ACME LOGISTICS LIMITED", "Acme Logistics Limited"],
    phones: ["+44 161 496 0123"],
    websites: ["acmelogistics.co.uk"],
    region: "Manchester",
    sector: "Logistics",
    people: [{ id: "cp1", canonicalName: "James Whitfield", aliases: ["J. Whitfield", "Jim Whitfield"], role: "Ops Director", phone: "+44 161 496 0123" }],
    doNotCall: false,
    lastOutcome: "meeting_booked",
    lastContactAt: "26 Aug 2026, 14:32",
  },
  {
    id: "cr2",
    canonicalName: "Northern Freight Co",
    aliases: ["Northern Freight Company", "Northern Freight", "NFC Ltd"],
    phones: ["+44 161 220 4471"],
    websites: ["northernfreight.co.uk"],
    region: "Manchester",
    sector: "Logistics",
    people: [{ id: "cp2", canonicalName: "Ops lead", aliases: [], role: "Ops", phone: "+44 161 220 4471" }],
    doNotCall: false,
    lastOutcome: "calling",
    lastContactAt: "27 Aug 2026, live",
  },
  {
    id: "cr3",
    canonicalName: "Speedy Haulage",
    aliases: ["Speedy Haulage Ltd", "Speedy Haulage Limited"],
    phones: ["+44 161 774 5510"],
    websites: ["speedyhaulage.co.uk"],
    region: "Manchester",
    sector: "Logistics",
    people: [{ id: "cp3", canonicalName: "Priya Nair", aliases: ["P. Nair"], role: "MD", phone: "+44 161 774 5510" }],
    doNotCall: true,
    lastOutcome: "rejected",
    lastContactAt: "26 Aug 2026, 10:41",
  },
  {
    id: "cr4",
    canonicalName: "Pennine Distribution",
    aliases: ["Pennine Dist", "Pennine Distribution Ltd", "Pennine-Dist"],
    phones: ["+44 161 998 3345"],
    websites: ["pennine-dist.co.uk"],
    region: "Manchester",
    sector: "Logistics",
    people: [{ id: "cp4", canonicalName: "Tom Radcliffe", aliases: ["Thomas Radcliffe", "T. Radcliffe"], role: "Finance Director", phone: "+44 161 998 3345" }],
    doNotCall: false,
    lastOutcome: "human_review",
    lastContactAt: "26 Aug 2026, 13:12",
  },
  {
    id: "cr5",
    canonicalName: "Riverside Manufacturing",
    aliases: ["Riverside Mfg", "Riverside Manufacturing Ltd", "Riverside Manufacturing Co"],
    phones: ["+44 247 655 0190"],
    websites: ["riverside-mfg.co.uk"],
    region: "Coventry",
    sector: "Manufacturing",
    people: [{ id: "cp5", canonicalName: "Site contact", aliases: [], role: "Contact", phone: "" }],
    doNotCall: false,
    lastOutcome: "calling",
    lastContactAt: "27 Aug 2026, live",
  },
  {
    id: "cr6",
    canonicalName: "Bright Retail Group",
    aliases: ["Bright Retail", "BRG Retail", "Bright Retail Group Ltd"],
    phones: ["+44 121 233 8890"],
    websites: ["brightretail.co.uk"],
    region: "Birmingham",
    sector: "Retail",
    people: [],
    doNotCall: false,
    lastOutcome: "contacted",
    lastContactAt: "25 Aug 2026",
  },
  {
    id: "cr7",
    canonicalName: "Coventry Precision Ltd",
    aliases: ["Coventry Precision", "Coventry Precision Limited"],
    phones: ["+44 247 611 4402"],
    websites: ["coventryprecision.co.uk"],
    region: "Coventry",
    sector: "Manufacturing",
    people: [{ id: "cp7", canonicalName: "Plant contact", aliases: [], role: "Contact", phone: "" }],
    doNotCall: false,
    lastOutcome: "callback_requested",
    lastContactAt: "26 Aug 2026, 16:05",
    requestedFollowUp: { day: "Mon, 31 Aug", time: "10:00", exactWords: "Call me back next week, Monday morning if you can." },
  },
  {
    id: "cr8",
    canonicalName: "Ferrum Manufacturing",
    aliases: ["Ferrum Mfg", "Ferrum Manufacturing Ltd"],
    phones: ["+44 113 220 5541"],
    websites: ["ferrummfg.co.uk"],
    region: "Leeds",
    sector: "Manufacturing",
    people: [{ id: "cp8", canonicalName: "David Oyelaran", aliases: ["Dave Oyelaran", "D. Oyelaran"], role: "COO", phone: "+44 113 220 5541" }],
    doNotCall: false,
    lastOutcome: "needs_outcome",
    lastContactAt: "21 Aug 2026, 11:00",
  },
  {
    id: "cr9",
    canonicalName: "Manchester Transport Group",
    aliases: ["MT Group", "Manchester Transport", "Manchester Transport Group Ltd"],
    phones: ["+44 161 883 2200"],
    websites: ["mtgroup.co.uk"],
    region: "Manchester",
    sector: "Logistics",
    people: [],
    doNotCall: false,
    lastOutcome: "retry",
    lastContactAt: "26 Aug 2026, 11:05",
  },
  {
    id: "cr10",
    canonicalName: "Midlands Fashion Co",
    aliases: ["Midlands Fashion", "Midlands Fashion Company"],
    phones: ["+44 121 456 7712"],
    websites: ["midlandsfashion.co.uk"],
    region: "Birmingham",
    sector: "Retail",
    people: [{ id: "cp10", canonicalName: "Sarah Coombs", aliases: ["S. Coombs"], role: "CEO", phone: "+44 121 456 7712" }],
    doNotCall: false,
    lastOutcome: "not_fit",
    lastContactAt: "24 Aug 2026, 09:30",
  },
];

// append-only. once a line is in here, UI never edits the prospect's words.
// requestedFollowUp.exactWords is always a verbatim quote, not a paraphrase.
const INITIAL_CALL_LOG = [
  {
    id: "cl1",
    registryId: "cr1",
    canonicalName: "Acme Logistics Ltd",
    listedAs: "ACME LOGISTICS LIMITED",
    personCanonical: "James Whitfield",
    personListedAs: "James Whitfield · Ops Director",
    channel: "voice",
    mission: "Logistics — Manchester",
    startedAt: "26 Aug 2026, 14:18",
    endedAt: "26 Aug 2026, 14:32",
    duration: "14 min",
    outcome: "meeting_booked",
    requestedFollowUp: { day: "Thu 3 Sep", time: "14:00", exactWords: "Yeah, put something in for Thursday afternoon." },
    wordsLocked: true,
    transcript: [
      { who: "ai", text: "Hi, this is Sam calling on behalf of AIVHub — do you have a quick minute?" },
      { who: "them", text: "Sure, what's this about?" },
      { who: "ai", text: "We build BI dashboards for logistics operators — saw Acme's been growing fast in Manchester. Quick question: how does your team currently track dispatch performance?" },
      { who: "them", text: "Mostly spreadsheets, honestly. It's a mess." },
      { who: "ai", text: "That's exactly what we help with. Would a 15-minute call with James make sense to see if it's a fit?" },
      { who: "them", text: "Yeah, put something in for Thursday afternoon." },
      { who: "ai", text: "Perfect — Thursday 2pm works, I'll send a Google Meet link over." },
    ],
  },
  {
    id: "cl2",
    registryId: "cr3",
    canonicalName: "Speedy Haulage",
    listedAs: "Speedy Haulage",
    personCanonical: "Priya Nair",
    personListedAs: "Priya Nair · MD",
    channel: "voice",
    mission: "Logistics — Manchester",
    startedAt: "26 Aug 2026, 10:34",
    endedAt: "26 Aug 2026, 10:41",
    duration: "7 min",
    outcome: "rejected",
    requestedFollowUp: null,
    wordsLocked: true,
    transcript: [
      { who: "ai", text: "Hi Priya, this is Sam from AIVHub — got a minute?" },
      { who: "them", text: "Not interested, please don't call this number again." },
      { who: "ai", text: "Understood — I'll take you off the list now. Sorry to have bothered you." },
    ],
  },
  {
    id: "cl3",
    registryId: "cr7",
    canonicalName: "Coventry Precision Ltd",
    listedAs: "Coventry Precision Ltd",
    personCanonical: "Plant contact",
    personListedAs: "Plant contact",
    channel: "voice",
    mission: "Q3 warm leads",
    startedAt: "26 Aug 2026, 15:58",
    endedAt: "26 Aug 2026, 16:05",
    duration: "7 min",
    outcome: "callback_requested",
    requestedFollowUp: { day: "Mon, 31 Aug", time: "10:00", exactWords: "Call me back next week, Monday morning if you can." },
    wordsLocked: true,
    transcript: [
      { who: "ai", text: "Hi, Sam from AIVHub — is now an OK time for a quick word?" },
      { who: "them", text: "Caught me on the shop floor. Call me back next week, Monday morning if you can." },
      { who: "ai", text: "Monday morning — I'll call you then. Thanks." },
    ],
  },
  {
    id: "cl4",
    registryId: "cr9",
    canonicalName: "Manchester Transport Group",
    listedAs: "Manchester Transport Group",
    personCanonical: "",
    personListedAs: "",
    channel: "voice",
    mission: "Logistics — Manchester",
    startedAt: "26 Aug 2026, 11:02",
    endedAt: "26 Aug 2026, 11:05",
    duration: "no answer",
    outcome: "no_answer",
    requestedFollowUp: null,
    wordsLocked: true,
    transcript: [
      { who: "ai", text: "Hi, this is Sam calling on behalf of AIVHub —" },
      { who: "them", text: "(no answer — voicemail after 3 rings)" },
    ],
  },
  {
    id: "cl5",
    registryId: "cr8",
    canonicalName: "Ferrum Manufacturing",
    listedAs: "Ferrum Manufacturing",
    personCanonical: "David Oyelaran",
    personListedAs: "David Oyelaran · COO",
    channel: "voice",
    mission: "Manufacturing SMEs — Leeds",
    startedAt: "20 Aug 2026, 10:44",
    endedAt: "20 Aug 2026, 10:51",
    duration: "7 min",
    outcome: "meeting_booked",
    requestedFollowUp: { day: "Fri 21 Aug", time: "11:00", exactWords: "Friday works." },
    wordsLocked: true,
    transcript: [
      { who: "ai", text: "Hi David, this is Sam from AIVHub — got 2 minutes?" },
      { who: "them", text: "Just about, go ahead." },
      { who: "ai", text: "We work with manufacturers on real-time production dashboards. Would a short call to explore fit work for you?" },
      { who: "them", text: "Could do, but budget's tight until October." },
      { who: "ai", text: "Understood — let's do a no-pressure discovery call so it's ready when budget opens up. Friday 11am?" },
      { who: "them", text: "Friday works." },
    ],
  },
  {
    id: "cl6",
    registryId: "cr10",
    canonicalName: "Midlands Fashion Co",
    listedAs: "Midlands Fashion Co",
    personCanonical: "Sarah Coombs",
    personListedAs: "Sarah Coombs · CEO",
    channel: "whatsapp",
    mission: "Retail chains — Birmingham",
    startedAt: "23 Aug 2026, 16:12",
    endedAt: "23 Aug 2026, 16:18",
    duration: "4 messages",
    outcome: "meeting_booked",
    requestedFollowUp: { day: "Sat 24 Aug", time: "09:30", exactWords: "OK, Saturday morning works, come by the office." },
    wordsLocked: true,
    transcript: [
      { who: "ai", text: "Hi Sarah, this is AIVHub — we help retail teams with BI dashboards. Open to a quick chat?" },
      { who: "them", text: "Maybe — what's the cost roughly?" },
      { who: "ai", text: "Depends on scope, easiest to cover on a short call. Could we grab 15 min in person, since your office is local to our team?" },
      { who: "them", text: "OK, Saturday morning works, come by the office." },
    ],
  },
  {
    id: "cl7",
    registryId: "cr4",
    canonicalName: "Pennine Distribution",
    listedAs: "Pennine Distribution",
    personCanonical: "Tom Radcliffe",
    personListedAs: "Tom Radcliffe · Finance Director",
    channel: "voice",
    mission: "Logistics — Manchester",
    startedAt: "26 Aug 2026, 13:08",
    endedAt: "26 Aug 2026, 13:12",
    duration: "4 min",
    outcome: "human_review",
    requestedFollowUp: null,
    wordsLocked: true,
    transcript: [
      { who: "ai", text: "Hi Tom, Sam from AIVHub — do you have a moment?" },
      { who: "them", text: "What exactly does this cost us, roughly?" },
      { who: "ai", text: "I can have someone follow up with pricing details directly —" },
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
  skipped: { label: "Skipped — already known", bg: C.paperSoft, fg: C.slate },
  callback_requested: { label: "Callback they asked for", bg: C.tealSoft, fg: C.teal },
  no_answer: { label: "No answer", bg: C.amberSoft, fg: C.amber },
  operator_ended: { label: "Ended by operator", bg: C.paperSoft, fg: C.slate },
  thread_ended: { label: "Thread ended", bg: C.paperSoft, fg: C.slate },
  already_contacted: { label: "Already contacted", bg: C.amberSoft, fg: C.amber },
  same_company: { label: "Same company", bg: C.amberSoft, fg: C.amber },
  same_person: { label: "Same person", bg: C.amberSoft, fg: C.amber },
  honored: { label: "At the time they asked", bg: C.tealSoft, fg: C.teal },
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

/* -------- identity matching: same firm / same person under different spellings -------- */

const LEGAL_SUFFIXES = /\b(ltd|limited|llp|plc|inc|incorporated|co|company|group|holdings|the|uk|llc)\b/g;
const NICKNAMES = {
  james: ["jim", "jimmy", "jamie"],
  jim: ["james", "jimmy", "jamie"],
  jimmy: ["james", "jim"],
  jamie: ["james", "jim"],
  thomas: ["tom", "tommy"],
  tom: ["thomas", "tommy"],
  tommy: ["thomas", "tom"],
  david: ["dave"],
  dave: ["david"],
  william: ["will", "bill", "billy", "liam"],
  robert: ["rob", "bob", "bobby"],
  michael: ["mike", "mick"],
  christopher: ["chris"],
  jennifer: ["jen", "jenny"],
  elizabeth: ["liz", "beth"],
  priya: ["pri"],
};

function normalizeCompanyName(raw) {
  return (raw || "")
    .toString()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeWebsite(raw) {
  return (raw || "")
    .toString()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
}

function normalizePersonName(raw) {
  return (raw || "").toString().toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

function personTokens(raw) {
  const parts = normalizePersonName(raw).split(" ").filter(Boolean);
  return { first: parts[0] || "", last: parts[parts.length - 1] || "", parts };
}

function firstNamesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length === 1 && b.startsWith(a)) return true;
  if (b.length === 1 && a.startsWith(b)) return true;
  return (NICKNAMES[a] || []).includes(b) || (NICKNAMES[b] || []).includes(a);
}

function peopleMatch(nameA, nameB) {
  if (!nameA || !nameB) return false;
  const a = personTokens(nameA);
  const b = personTokens(nameB);
  if (!a.last || !b.last || a.last !== b.last) return false;
  return firstNamesMatch(a.first, b.first);
}

function tokenOverlap(a, b) {
  const ta = new Set((a || "").split(" ").filter((t) => t.length > 1));
  const tb = new Set((b || "").split(" ").filter((t) => t.length > 1));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => { if (tb.has(t)) inter += 1; });
  return inter / Math.max(ta.size, tb.size);
}

function allRegistryNames(entry) {
  return [entry.canonicalName, ...(entry.aliases || [])];
}

function allPersonNames(person) {
  return [person.canonicalName, ...(person.aliases || [])];
}

function lockTranscript(lines) {
  return (lines || []).map((l) => {
    if (typeof l !== "string") return { who: l.who, text: l.text };
    const isAi = /^AI:/i.test(l);
    return { who: isAi ? "ai" : "them", text: l.replace(/^AI:\s*|^Prospect:\s*/i, "") };
  });
}

// score a spreadsheet/form row against the canonical registry. phone and website
// are hard matches; company names match after stripping Ltd/Limited/Co; people
// match on last name + first name / initial / nickname (Jim = James).
function findIdentityMatch(row, registry, callLog) {
  if (!registry || !registry.length) return null;
  const rowName = normalizeCompanyName(row.name);
  const rowPhone = normalizePhoneDigits(row.phone);
  const rowWeb = normalizeWebsite(row.source || row.website || "");
  const rowPerson = row.contact || "";

  let best = null;
  registry.forEach((entry) => {
    const reasons = [];
    let score = 0;
    let nameHit = false;
    let personHit = null;

    if (rowPhone.length >= 8) {
      const hit = (entry.phones || []).find((p) => normalizePhoneDigits(p) === rowPhone);
      if (hit) {
        score += 100;
        reasons.push(`Same phone as ${entry.canonicalName} (${hit})`);
      }
    }

    if (rowWeb) {
      const hit = (entry.websites || []).find((w) => normalizeWebsite(w) === rowWeb);
      if (hit) {
        score += 80;
        reasons.push(`Same website (${hit})`);
      }
    }

    if (rowName) {
      const names = allRegistryNames(entry).map(normalizeCompanyName).filter(Boolean);
      if (names.includes(rowName)) {
        nameHit = true;
        score += 70;
        const shownAs = allRegistryNames(entry).find((n) => normalizeCompanyName(n) === rowName);
        reasons.push(
          shownAs && shownAs !== entry.canonicalName
            ? `"${row.name}" is the same company as ${entry.canonicalName} (alias: ${shownAs})`
            : `Company name matches ${entry.canonicalName}`
        );
      } else {
        const overlap = Math.max(...names.map((n) => tokenOverlap(rowName, n)), 0);
        if (overlap >= 0.75 && rowName.split(" ").length >= 2) {
          nameHit = true;
          score += 55;
          reasons.push(`"${row.name}" looks like ${entry.canonicalName} (same background, different spelling)`);
        }
      }
    }

    if (rowPerson) {
      (entry.people || []).forEach((person) => {
        if (allPersonNames(person).some((n) => peopleMatch(rowPerson, n))) {
          personHit = person;
          score += 40;
          reasons.push(
            `"${rowPerson}" is the same person as ${person.canonicalName}${person.role ? ` (${person.role})` : ""} at ${entry.canonicalName}`
          );
        }
      });
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { entry, score, reasons, nameHit, personHit };
    }
  });

  if (!best || best.score < 50) return null;

  const { entry, reasons, personHit, nameHit } = best;
  const lastLog = (callLog || []).find((l) => l.registryId === entry.id);
  const followUp = entry.requestedFollowUp || lastLog?.requestedFollowUp || null;
  const bookedOutcomes = ["meeting_booked", "converted", "needs_outcome", "upcoming"];

  let issueCode = "same_company";
  let blockDefault = true;
  if (entry.doNotCall || entry.lastOutcome === "rejected") issueCode = "already_dnc";
  else if (followUp && (entry.lastOutcome === "callback_requested" || entry.lastOutcome === "retry")) issueCode = "callback_pending";
  else if (bookedOutcomes.includes(entry.lastOutcome)) issueCode = "already_contacted";
  else if (personHit) issueCode = "same_person";
  else if (nameHit || best.score >= 80) issueCode = "same_company";

  const noteBits = [
    `Matched to ${entry.canonicalName}`,
    entry.lastContactAt ? `last contact ${entry.lastContactAt}` : null,
    entry.lastOutcome ? `outcome: ${STATUS_MAP[entry.lastOutcome]?.label || entry.lastOutcome}` : null,
  ].filter(Boolean);

  return {
    issueCode,
    blockDefault,
    registryId: entry.id,
    canonicalName: entry.canonicalName,
    personCanonical: personHit?.canonicalName || "",
    reasons,
    lastOutcome: entry.lastOutcome,
    lastContactAt: entry.lastContactAt,
    requestedFollowUp: followUp,
    doNotCall: !!entry.doNotCall,
    note: noteBits.join(" · "),
  };
}

function nowStamp() {
  return "27 Aug 2026, " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/* ---------------------------------- sidebar ---------------------------------- */

const NAV_GROUPS = [
  { label: "Workspace", items: [
    { id: "today", label: "Today", icon: Radio },
    { id: "missions", label: "Outreach", icon: ListChecks },
    { id: "schedule", label: "Calendar", icon: Calendar },
    { id: "prospects", label: "Contacts", icon: Building2 },
  ]},
  { label: "Manage", items: [
    { id: "company", label: "Setup", icon: Settings2 },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
  ]},
];

function isNavActive(navId, view) {
  const families = {
    today: ["today", "live"],
    missions: ["missions", "missionDetail"],
    schedule: ["schedule", "meetings"],
    prospects: ["prospects", "calllog"],
    company: ["company", "connections", "provider"],
    analytics: ["analytics"],
  };
  return (families[navId] || [navId]).includes(view);
}

function Sidebar({ view, setView, companyName, callerName }) {
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
              const active = isNavActive(n.id, view);
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
        <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: "#5B6070", marginBottom: 2 }}>
          AI speaks as <span style={{ color: "#C8CCD6", fontWeight: 600 }}>{callerName}</span>, on behalf of {companyName}
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: "#5B6070", marginBottom: 8 }}>
          Logged in as:
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
      <TopBar title="Outreach" subtitle="Choose who to contact, then track each list from start to result" onNewMission={onNewMission} notifications={notifications} setNotifications={setNotifications} />
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15.5, color: C.textInk, lineHeight: 1.3 }}>{m.title}</div>
                <Badge status={m.status} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                {m.source === "manual" && (
                  <span style={{ fontFamily: FONT_BODY, fontSize: 10, fontWeight: 700, color: C.teal, background: C.tealSoft, padding: "2px 6px", borderRadius: 5, whiteSpace: "nowrap" }}>PROVIDED LIST</span>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.slate, fontFamily: FONT_BODY, fontSize: 12.5 }}>
                  <MapPin size={12} /> {m.region} <span style={{ color: C.border }}>·</span> {m.sector}
                </div>
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
  const [visibleCount, setVisibleCount] = useState(25);
  const counts = mission.prospects.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});
  const visibleProspects = mission.prospects.slice(0, visibleCount);
  const hasQueueInfo = typeof mission.concurrency === "number";

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
            {visibleProspects.map((p) => {
              const isOpen = expanded === p.id;
              return (
                <div key={p.id} style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <div
                    onClick={() => setExpanded(isOpen ? null : p.id)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {p.status === "calling" ? <LivePulse /> : p.status === "meeting_booked" ? <CheckCircle2 size={16} color={C.green} /> : p.status === "human_review" ? <AlertTriangle size={16} color={C.red} /> : p.status === "skipped" ? <History size={15} color={C.slate} /> : <Circle size={14} color={C.slateLight} />}
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
            {visibleCount < mission.prospects.length && (
              <button
                onClick={() => setVisibleCount((v) => v + 25)}
                style={{ marginTop: 4, padding: "9px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", color: C.slate, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
              >
                Show 25 more ({mission.prospects.length - visibleCount} remaining)
              </button>
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
            <StatRow label="Skipped — already known" value={counts.skipped || 0} accent={counts.skipped ? C.amber : undefined} />
            <StatRow label="Est. cost so far" value="£4.80" />
          </div>

          {hasQueueInfo && (
            <>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.slate, margin: "18px 0 10px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Queue
              </div>
              <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                <StatRow label="Calling now" value={counts.calling || 0} accent={counts.calling ? C.cobaltDeep : undefined} />
                <StatRow label="Waiting in queue" value={counts.queued || 0} />
                <StatRow label="Concurrent lines" value={mission.concurrency} />
                <StatRow label="Call window" value={mission.callWindow} />
                {mission.queueEstimate && (
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, lineHeight: 1.5, paddingTop: 4, borderTop: `1px solid ${C.border}` }}>
                    {mission.queueEstimate.willFinishToday
                      ? <>Should clear the queue today around <strong>{mission.queueEstimate.finishLabel}</strong>.</>
                      : <>At this pace, expect about <strong>{mission.queueEstimate.daysNeeded} days</strong> to get through the full list.</>}
                  </div>
                )}
              </div>
            </>
          )}
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

function LiveCallsView({ notifications, setNotifications, companyName, calls, onConfirmBooking, onTakenToggle, onListenToggle, onAskEnd, onCancelEnd, onConfirmEnd }) {
  const toggleTaken = onTakenToggle;
  const toggleListen = onListenToggle;
  const askEnd = onAskEnd;
  const cancelEnd = onCancelEnd;
  const confirmEnd = onConfirmEnd;

  const active = calls.filter((c) => !c.ended);

  return (
    <>
      <TopBar title="Live Activity" subtitle={`${active.length} active conversations — calls and messages`} notifications={notifications} setNotifications={setNotifications} />
      <div style={{ padding: "20px 32px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        {calls.map((c) => {
          const isMessage = c.channel === "whatsapp" || c.channel === "sms";
          if (c.ended) {
            return (
              <div key={c.id} style={{ background: c.booked ? C.greenSoft : C.paperSoft, border: `1px dashed ${c.booked ? C.green : C.border}`, borderRadius: 12, padding: 16, opacity: c.booked ? 1 : 0.7 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14.5, color: c.booked ? C.textInk : C.slate }}>{c.prospect}</div>
                {c.booked ? (
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.green, marginTop: 6, display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                    <CheckCircle2 size={13} /> Meeting booked — time taken from their words, saved to Call Log, Schedule, and Meetings
                  </div>
                ) : (
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight, marginTop: 6 }}>{isMessage ? "Conversation ended" : "Call ended"} — {c.duration}</div>
                )}
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
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                  {c.state === "negotiating" && (
                    <button
                      onClick={() => onConfirmBooking(c)}
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: C.green, color: "#fff", border: "none", borderRadius: 7, padding: "8px 10px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                    >
                      <CalendarCheck size={13} /> Confirm time & book meeting
                    </button>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <ActionBtn icon={isMessage ? MessageCircle : Mic} label={c.taken ? "Hand back" : "Take over"} onClick={() => toggleTaken(c.id)} active={c.taken} />
                    {!isMessage && <ActionBtn icon={Headphones} label={c.listening ? "Stop listening" : "Listen"} onClick={() => toggleListen(c.id)} active={c.listening} />}
                    <ActionBtn icon={isMessage ? X : PhoneOff} label={isMessage ? "End thread" : "End"} onClick={() => askEnd(c.id)} danger />
                  </div>
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

/* ---------------------------------- call log ---------------------------------- */

const LOG_FILTERS = [
  ["all", "All"],
  ["meeting_booked", "Meetings booked"],
  ["callback_requested", "Callbacks they asked for"],
  ["rejected", "Do-not-call"],
  ["no_answer", "No answer"],
];

function CallLogView({ notifications, setNotifications, entries, prefillQuery, clearPrefill, onJumpSchedule }) {
  const [query, setQuery] = useState(prefillQuery || "");
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState(null);

  React.useEffect(() => {
    if (prefillQuery) {
      setQuery(prefillQuery);
      if (clearPrefill) clearPrefill();
    }
  }, [prefillQuery, clearPrefill]);

  const filtered = entries.filter((e) => {
    if (filter !== "all" && e.outcome !== filter) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const blob = [
      e.canonicalName, e.listedAs, e.personCanonical, e.personListedAs, e.mission,
      ...(e.transcript || []).map((l) => l.text),
      e.requestedFollowUp?.exactWords,
    ].join(" ").toLowerCase();
    return blob.includes(q);
  });

  return (
    <>
      <TopBar title="Call Log" subtitle="Append-only record of every conversation — prospect words are never edited" notifications={notifications} setNotifications={setNotifications} />
      <div style={{ padding: "20px 32px" }}>
        <div style={{ background: C.tealSoft, border: `1px solid #B7E0D6`, borderRadius: 8, padding: "10px 14px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.teal, marginBottom: 16, display: "flex", alignItems: "flex-start", gap: 8 }}>
          <Quote size={14} style={{ marginTop: 2, flexShrink: 0 }} />
          <span>
            Times we call back are taken from <strong>their exact words</strong>, not a guessed slot. Same company or person under a different spelling is treated as already known — see match reasons on each row.
          </span>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 360 }}>
            <Search size={14} color={C.slateLight} style={{ position: "absolute", left: 11, top: 10 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search company, person, or their words..."
              style={{ width: "100%", padding: "8px 12px 8px 32px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          {LOG_FILTERS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              style={{
                fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 7,
                border: `1px solid ${filter === id ? C.ink : C.border}`, background: filter === id ? C.ink : "#fff",
                color: filter === id ? "#fff" : C.slate, cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.length === 0 && (
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slateLight, padding: "24px 0", textAlign: "center" }}>
              No logged conversations match this filter.
            </div>
          )}
          {filtered.map((e) => {
            const isOpen = openId === e.id;
            const aliasDiffers = e.listedAs && e.canonicalName && e.listedAs !== e.canonicalName;
            return (
              <div key={e.id} style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                <div
                  onClick={() => setOpenId(isOpen ? null : e.id)}
                  style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "14px 16px", cursor: "pointer" }}
                >
                  <div style={{ width: 138, flexShrink: 0 }}>
                    <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.textInk, fontWeight: 600 }}>{e.endedAt}</div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 2 }}>{e.duration}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14.5, color: C.textInk }}>{e.canonicalName}</span>
                      <ChannelTag channel={e.channel} small />
                      <Badge status={e.outcome} small />
                      {e.wordsLocked && (
                        <span style={{ fontFamily: FONT_BODY, fontSize: 10, fontWeight: 700, color: C.teal, background: C.tealSoft, padding: "2px 6px", borderRadius: 5 }}>VERBATIM</span>
                      )}
                    </div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginTop: 3 }}>
                      {e.personListedAs || e.personCanonical || "No named contact"} · {e.mission}
                    </div>
                    {aliasDiffers && (
                      <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.amber, marginTop: 3 }}>
                        Called as “{e.listedAs}” — same company as {e.canonicalName}
                      </div>
                    )}
                    {e.requestedFollowUp && (
                      <div style={{ marginTop: 8, background: C.tealSoft, borderRadius: 8, padding: "8px 10px" }}>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.teal, marginBottom: 3, display: "flex", alignItems: "center", gap: 5 }}>
                          <Clock size={11} /> Honored at {e.requestedFollowUp.day}, {e.requestedFollowUp.time}
                        </div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk, fontStyle: "italic" }}>
                          “{e.requestedFollowUp.exactWords}”
                        </div>
                      </div>
                    )}
                  </div>
                  <ChevronDown size={16} color={C.slateLight} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s", marginTop: 4 }} />
                </div>
                {isOpen && (
                  <div style={{ padding: "0 16px 16px 168px" }}>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                      Transcript — locked, never edited
                    </div>
                    <div style={{ background: C.paper, borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
                      {(e.transcript || []).map((line, i) => {
                        const isThem = line.who === "them";
                        const isQuote = isThem && e.requestedFollowUp && line.text === e.requestedFollowUp.exactWords;
                        return (
                          <div key={i} style={{ display: "flex", justifyContent: isThem ? "flex-start" : "flex-end" }}>
                            <div
                              style={{
                                maxWidth: "88%",
                                background: isQuote ? C.tealSoft : isThem ? "#fff" : C.cobalt,
                                color: isThem ? C.textInk : "#fff",
                                border: isQuote ? `1px solid ${C.teal}` : isThem ? `1px solid ${C.border}` : "none",
                                borderRadius: 10,
                                padding: "6px 10px",
                                fontFamily: FONT_BODY,
                                fontSize: 12.5,
                                lineHeight: 1.4,
                              }}
                            >
                              <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.7, display: "block", marginBottom: 2 }}>{isThem ? "THEM" : "AI"}</span>
                              {line.text}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {e.requestedFollowUp && onJumpSchedule && (
                      <button
                        onClick={() => onJumpSchedule(e.canonicalName)}
                        style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 10px", fontFamily: FONT_BODY, fontSize: 12, color: C.slate, cursor: "pointer" }}
                      >
                        <Calendar size={12} /> See scheduled callback
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
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

function ScheduleView({ notifications, setNotifications, prefillName, clearPrefill, items, setItems }) {
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
                    {i.honoredQuote && (
                      <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.teal, marginTop: 3, fontStyle: "italic", display: "flex", alignItems: "center", gap: 5 }}>
                        <Quote size={11} /> “{i.honoredQuote}”
                      </div>
                    )}
                  </div>
                  {i.honored ? <Badge status="honored" small /> : <Badge status={i.status} small />}
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

function BookingPanel({ meeting, companyName }) {
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
          {companyName} × {meeting.prospect}
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

function MeetingDetailModal({ meeting, onClose, onOutcome, onSaveMeetingTranscript, companyName }) {
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
            <BookingPanel meeting={meeting} companyName={companyName} />
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

function MeetingsView({ notifications, setNotifications, companyName, meetings, setMeetings }) {
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

      {openMeeting && <MeetingDetailModal meeting={openMeeting} onClose={() => setOpenId(null)} onOutcome={setOutcome} onSaveMeetingTranscript={saveMeetingTranscript} companyName={companyName} />}
    </>
  );
}

/* ---------------------------------- prospects ---------------------------------- */

function ProspectsView({ notifications, setNotifications, onScheduleFor, registry, callLog, onOpenLog }) {
  const [query, setQuery] = useState("");
  const filtered = PROSPECTS.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  const registryFor = (p) => (registry || []).find((r) =>
    allRegistryNames(r).some((n) => normalizeCompanyName(n) === normalizeCompanyName(p.name))
  );
  const lastLogFor = (p) => {
    const entry = registryFor(p);
    return (callLog || []).find((l) => (entry && l.registryId === entry.id) || normalizeCompanyName(l.canonicalName) === normalizeCompanyName(p.name));
  };

  return (
    <>
      <TopBar title="Prospects" subtitle="Every business researched or contacted so far — aliases collapsed to one company" notifications={notifications} setNotifications={setNotifications} />
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
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.4fr 1fr 1fr 1.3fr", padding: "10px 18px", background: C.paper, fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>
            <div>Company</div>
            <div>Region</div>
            <div>Contact</div>
            <div>Status</div>
            <div>Fit score</div>
            <div></div>
          </div>
          {filtered.map((p) => {
            const entry = registryFor(p);
            const last = lastLogFor(p);
            const blocked = entry?.doNotCall || p.status === "do_not_call" || p.status === "meeting_booked";
            const aliases = (entry?.aliases || []).filter((a) => a !== p.name);
            return (
              <div
                key={p.id}
                style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.4fr 1fr 1fr 1.3fr", padding: "13px 18px", borderTop: `1px solid ${C.border}`, alignItems: "center" }}
              >
                <div>
                  <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, color: C.textInk }}>{p.name}</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight }}>{p.sector}</div>
                  {aliases.length > 0 && (
                    <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.amber, marginTop: 2 }}>
                      Also listed as {aliases.slice(0, 2).join(", ")}
                    </div>
                  )}
                  {last && (
                    <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.slateLight, marginTop: 2 }}>
                      Last log {last.endedAt} · {STATUS_MAP[last.outcome]?.label || last.outcome}
                    </div>
                  )}
                </div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>{p.region}</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate }}>{p.contact}</div>
                <div>
                  <Badge status={p.status} small />
                </div>
                <FitScore value={p.fit} />
                <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
                  {last && (
                    <button
                      onClick={() => onOpenLog && onOpenLog(p.name)}
                      style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 9px", fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, cursor: "pointer" }}
                    >
                      <History size={12} /> Log
                    </button>
                  )}
                  <button
                    onClick={() => !blocked && onScheduleFor && onScheduleFor(p.name)}
                    title={blocked ? "Already contacted or on do-not-call — open the call log instead of dialing again" : "Schedule a call"}
                    style={{
                      display: "flex", alignItems: "center", gap: 5, background: "none",
                      border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 9px",
                      fontFamily: FONT_BODY, fontSize: 11.5, color: blocked ? C.slateLight : C.slate,
                      cursor: blocked ? "not-allowed" : "pointer", opacity: blocked ? 0.5 : 1,
                    }}
                  >
                    <Calendar size={12} /> {blocked ? "Don't re-dial" : "Schedule call"}
                  </button>
                  <ExternalLink size={14} color={C.slateLight} style={{ cursor: "pointer" }} />
                </div>
              </div>
            );
          })}
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

/* -------- file-import helpers: turn a company CSV/XLSX into rows -------- */

// header text -> which field it maps to. checked in order, first match wins.
const COLUMN_GUESSES = {
  name: ["company", "company name", "business", "business name", "name", "organisation", "organization"],
  phone: ["phone", "phone number", "telephone", "tel", "mobile", "contact number"],
  website: ["website", "url", "site", "web", "domain", "link"],
  contact: ["contact", "contact name", "person", "attention", "poc"],
  notes: ["notes", "note", "comment", "comments", "description"],
  channel: ["channel", "contact channel", "contact method", "preferred channel", "outreach channel"],
};

const CHANNEL_OPTIONS = [
  { id: "auto", label: "Let AI choose" },
  { id: "voice", label: "Voice call" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "sms", label: "SMS" },
];

// turns a free-text cell like "wa" or "Whats App" into one of our channel ids
function normalizeChannel(raw) {
  const v = (raw || "").toString().trim().toLowerCase();
  if (!v) return "";
  if (v.includes("whats") || v === "wa") return "whatsapp";
  if (v.includes("sms") || v.includes("text")) return "sms";
  if (v.includes("call") || v.includes("phone") || v.includes("voice")) return "voice";
  if (v.includes("auto") || v.includes("any")) return "auto";
  return "";
}

/* -------- validation + dedupe: catches bad rows before they reach the dialer -------- */

// digits-only phone, UK "+44"/"44" prefix folded to leading 0 so it matches a
// locally-formatted duplicate of the same number
function normalizePhoneDigits(raw) {
  let d = (raw || "").toString().replace(/\D/g, "");
  if (d.startsWith("44") && d.length > 10) d = "0" + d.slice(2);
  return d;
}

// adds `issues` (array of problem codes) and `duplicateOf` (name of the row
// it duplicates, if any) to each row. Does NOT touch `included` — that's
// decided once at import time and left alone after, so user overrides stick.
function validateRows(list, registry, callLog) {
  const seenPhones = new Map(); // normalized digits -> first row's name
  return list.map((r) => {
    const issues = [];
    if (!r.name) issues.push("missing_name");
    const digits = normalizePhoneDigits(r.phone);
    if (!r.phone) issues.push("missing_phone");
    else if (digits.length < 8 || digits.length > 13) issues.push("bad_phone");

    let duplicateOf = null;
    if (digits.length >= 8) {
      if (seenPhones.has(digits)) {
        duplicateOf = seenPhones.get(digits);
        issues.push("duplicate");
      } else {
        seenPhones.set(digits, r.name || "(unnamed)");
      }
    }

    const identityMatch = findIdentityMatch(r, registry, callLog);
    if (identityMatch) issues.push(identityMatch.issueCode);

    return { ...r, issues, duplicateOf, identityMatch };
  });
}

const ISSUE_META = {
  missing_name: { label: "No company name", color: "#C2410C" },
  missing_phone: { label: "No phone number", color: "#C2410C" },
  bad_phone: { label: "Phone looks invalid", color: "#B8760A" },
  duplicate: { label: "Duplicate number", color: "#B8760A" },
  already_contacted: { label: "Already contacted", color: "#C2410C" },
  already_dnc: { label: "Do-not-call", color: "#6B7280" },
  same_company: { label: "Same company, different name", color: "#B8760A" },
  same_person: { label: "Same person, different name", color: "#B8760A" },
  callback_pending: { label: "Callback they already asked for", color: "#0C8C7D" },
};

/* -------- call-window math: will N companies actually finish today? -------- */

const AVG_CALL_MINUTES = 3; // rough estimate used for capacity planning only
const CONCURRENCY_OPTIONS = [1, 5, 10, 20];

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// pull a day+time out of the prospect's own lines — never from the AI's proposal
// unless they didn't name one. prototype calendar is frozen at Thu 27 Aug 2026.
function extractRequestedTime(transcript) {
  const them = (transcript || [])
    .map((l) => (typeof l === "string" ? l : `${l.who === "them" ? "Prospect" : "AI"}: ${l.text || ""}`))
    .filter((l) => /^Prospect:/i.test(l))
    .map((l) => l.replace(/^Prospect:\s*/i, ""));
  const combined = them.join(" ");
  if (!combined.trim()) return null;

  const exactWords = them.find((t) =>
    /monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|afternoon|morning|\d{1,2}(:\d{2})?\s*(am|pm)/i.test(t)
  );
  if (!exactWords) return null;

  const lower = exactWords.toLowerCase();
  const nextWeek = /next week/.test(lower);

  let time = "14:00";
  const tm = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (tm) {
    let h = parseInt(tm[1], 10);
    const min = tm[2] || "00";
    const ap = (tm[3] || "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    time = `${String(h).padStart(2, "0")}:${min}`;
  } else if (/morning/.test(lower)) time = "10:00";
  else if (/afternoon/.test(lower)) time = "14:00";

  const mins = timeToMinutes(time);
  if (mins < timeToMinutes("09:00")) time = "09:00";
  if (mins > timeToMinutes("17:00")) time = "17:00";

  let day = null;
  if (/tomorrow/.test(lower)) day = "Tomorrow, 28 Aug";
  else if (/monday/.test(lower)) day = nextWeek ? "Mon, 7 Sep" : "Mon, 31 Aug";
  else if (/tuesday/.test(lower)) day = "Tue, 1 Sep";
  else if (/wednesday/.test(lower)) day = "Wed, 2 Sep";
  else if (/thursday/.test(lower)) day = nextWeek ? "Thu, 3 Sep" : "Today, 27 Aug";
  else if (/friday/.test(lower)) day = nextWeek ? "Fri, 4 Sep" : "Tomorrow, 28 Aug";
  else if (/saturday/.test(lower)) day = "Sat, 29 Aug";
  else if (nextWeek) day = "Mon, 31 Aug";
  if (!day) return null;

  return { day, time, exactWords, source: "prospect" };
}

// returns how many companies fit in the window today, and if not all do,
// how many days it'll realistically take at this concurrency.
function computeQueueEstimate(totalCompanies, concurrency, windowStart, windowEnd) {
  const windowMinutes = Math.max(0, timeToMinutes(windowEnd) - timeToMinutes(windowStart));
  const capacityPerDay = Math.floor((windowMinutes / AVG_CALL_MINUTES) * concurrency);
  if (totalCompanies === 0 || capacityPerDay === 0) {
    return { capacityPerDay, willFinishToday: false, finishLabel: "", daysNeeded: 0 };
  }
  const minutesNeeded = (totalCompanies * AVG_CALL_MINUTES) / concurrency;
  const willFinishToday = minutesNeeded <= windowMinutes;
  if (willFinishToday) {
    return {
      capacityPerDay,
      willFinishToday: true,
      finishLabel: minutesToTime(timeToMinutes(windowStart) + minutesNeeded),
      daysNeeded: 1,
    };
  }
  const daysNeeded = Math.ceil(totalCompanies / capacityPerDay);
  return { capacityPerDay, willFinishToday: false, finishLabel: "", daysNeeded };
}

function guessColumn(headers, field) {
  const candidates = COLUMN_GUESSES[field] || [];
  const lower = headers.map((h) => (h || "").toString().trim().toLowerCase());
  for (const c of candidates) {
    const idx = lower.indexOf(c);
    if (idx !== -1) return headers[idx];
  }
  // loose contains-match fallback
  for (const c of candidates) {
    const idx = lower.findIndex((h) => h.includes(c));
    if (idx !== -1) return headers[idx];
  }
  return "";
}

// parses a File (csv or xlsx/xls) into { headers, records } where records are
// plain objects keyed by the file's own header row.
function parseSpreadsheetFile(file, onDone, onError) {
  const ext = file.name.split(".").pop().toLowerCase();

  if (ext === "csv") {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields || [];
        onDone({ headers, records: results.data });
      },
      error: (err) => onError(err.message || "Could not read CSV file"),
    });
    return;
  }

  if (ext === "xlsx" || ext === "xls") {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const records = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        const headers = records.length ? Object.keys(records[0]) : [];
        onDone({ headers, records });
      } catch (err) {
        onError("Could not read spreadsheet — check the file isn't corrupted");
      }
    };
    reader.onerror = () => onError("Could not read file");
    reader.readAsArrayBuffer(file);
    return;
  }

  onError("Unsupported file type — upload a .csv, .xlsx, or .xls file");
}

function NewMissionModal({ onClose, onCreate, registry, callLog }) {
  const [tab, setTab] = useState("discover");
  const [prompt, setPrompt] = useState("");
  const [rows, setRows] = useState([{ id: 1, name: "", phone: "", sourceType: "Website URL", source: "", channel: "auto", fallback: "none", contact: "" }]);
  const [manualMode, setManualMode] = useState("upload"); // "upload" | "form"
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("17:30");
  const [channel, setChannel] = useState("voice");

  // file import state
  const [importState, setImportState] = useState("idle"); // idle | parsed | error
  const [importError, setImportError] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importHeaders, setImportHeaders] = useState([]);
  const [columnMap, setColumnMap] = useState({ name: "", phone: "", website: "", contact: "", channel: "" });
  const [importRecords, setImportRecords] = useState([]); // raw records from file
  const [importRows, setImportRows] = useState([]); // mapped preview rows, editable
  const [importFilter, setImportFilter] = useState("all"); // all | issues | duplicates
  const [bulkChannel, setBulkChannel] = useState("voice");
  const [concurrency, setConcurrency] = useState(5);

  const parsed = prompt.length > 8;

  const addRow = () => setRows((r) => [...r, { id: Date.now(), name: "", phone: "", sourceType: "Website URL", source: "", channel: "", fallback: "none", contact: "" }]);
  const removeRow = (id) => setRows((r) => r.filter((x) => x.id !== id));
  const updateRow = (id, k, v) => setRows((r) => r.map((x) => (x.id === id ? { ...x, [k]: v } : x)));

  const buildPreviewFromMap = (records, map) => {
    const mapped = records.map((rec, i) => ({
      id: "imp_" + i,
      name: (map.name ? rec[map.name] : "") || "",
      phone: (map.phone ? rec[map.phone] : "") || "",
      contact: (map.contact ? rec[map.contact] : "") || "",
      sourceType: "Website URL",
      source: (map.website ? rec[map.website] : "") || "",
      channel: normalizeChannel(map.channel ? rec[map.channel] : ""), // "" = use mission default
      fallback: "none",
    }));
    // flag missing/invalid/duplicate rows, then only auto-include the clean ones —
    // stops bad data from silently reaching the dialer on a big import
    return validateRows(mapped, registry, callLog).map((r) => ({ ...r, included: r.issues.length === 0 }));
  };

  const handleFileSelected = (file) => {
    if (!file) return;
    setImportError("");
    setImportFileName(file.name);
    parseSpreadsheetFile(
      file,
      ({ headers, records }) => {
        if (!records.length) {
          setImportState("error");
          setImportError("No rows found in that file");
          return;
        }
        const map = {
          name: guessColumn(headers, "name"),
          phone: guessColumn(headers, "phone"),
          website: guessColumn(headers, "website"),
          contact: guessColumn(headers, "contact"),
          channel: guessColumn(headers, "channel"),
        };
        setImportHeaders(headers);
        setColumnMap(map);
        setImportRecords(records);
        setImportRows(buildPreviewFromMap(records, map));
        setImportState("parsed");
      },
      (msg) => {
        setImportState("error");
        setImportError(msg);
      }
    );
  };

  const updateColumnMap = (field, header) => {
    const nextMap = { ...columnMap, [field]: header };
    setColumnMap(nextMap);
    setImportRows(buildPreviewFromMap(importRecords, nextMap));
  };

  const updateImportRow = (id, k, v) =>
    setImportRows((r) => validateRows(r.map((x) => (x.id === id ? { ...x, [k]: v } : x)), registry, callLog).map((nr, i) => ({ ...nr, included: r[i].included })));
  const removeImportRow = (id) => setImportRows((r) => r.filter((x) => x.id !== id));
  const toggleImportRow = (id) => setImportRows((r) => r.map((x) => (x.id === id ? { ...x, included: !x.included } : x)));

  const selectAllShown = (value) =>
    setImportRows((r) => r.map((x) => (filteredImportRows.some((f) => f.id === x.id) ? { ...x, included: value } : x)));
  const applyBulkChannel = () =>
    setImportRows((r) => r.map((x) => (x.included ? { ...x, channel: bulkChannel } : x)));
  const removeFlaggedRows = () => setImportRows((r) => r.map((x) => (x.issues.length ? { ...x, included: false } : x)));

  const includedImportRows = importRows.filter((r) => r.included && r.name);
  const flaggedCount = importRows.filter((r) => r.issues.length > 0).length;
  const duplicateCount = importRows.filter((r) => r.issues.includes("duplicate")).length;
  const knownCount = importRows.filter((r) => r.identityMatch).length;
  const filteredImportRows =
    importFilter === "issues" ? importRows.filter((r) => r.issues.length > 0) :
    importFilter === "duplicates" ? importRows.filter((r) => r.issues.includes("duplicate")) :
    importFilter === "known" ? importRows.filter((r) => r.identityMatch) :
    importRows;

  const useImportedRows = () => {
    setRows(
      includedImportRows.map((r, i) => ({
        id: Date.now() + i,
        name: r.name,
        phone: r.phone,
        contact: r.contact || "",
        sourceType: r.source ? "Website URL" : "Notes only",
        source: r.source || r.contact || "",
        channel: r.channel || "", // "" = falls back to mission default at submit time
        fallback: r.fallback || "none",
      }))
    );
    setManualMode("form");
  };

  const resetImport = () => {
    setImportState("idle");
    setImportError("");
    setImportFileName("");
    setImportHeaders([]);
    setImportRecords([]);
    setImportRows([]);
  };

  const canSubmit = tab === "discover" ? parsed : rows.some((r) => r.name && r.phone);
  const readyToCallCount = tab === "manual" ? rows.filter((r) => r.name && r.phone).length : 0;
  const queueEstimate = computeQueueEstimate(readyToCallCount, concurrency, windowStart, windowEnd);

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
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              <button
                onClick={() => setManualMode("upload")}
                style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: `1px solid ${manualMode === "upload" ? C.ink : C.border}`, cursor: "pointer", background: manualMode === "upload" ? C.ink : "#fff", color: manualMode === "upload" ? "#fff" : C.slate, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <UploadCloud size={13} /> Upload file
              </button>
              <button
                onClick={() => setManualMode("form")}
                style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: `1px solid ${manualMode === "form" ? C.ink : C.border}`, cursor: "pointer", background: manualMode === "form" ? C.ink : "#fff", color: manualMode === "form" ? "#fff" : C.slate, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Users size={13} /> Enter manually
              </button>
            </div>

            {manualMode === "upload" && (
              <div>
                {importState !== "parsed" && (
                  <label
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
                      border: `1.5px dashed ${importState === "error" ? C.redSolid : C.border}`, borderRadius: 12, padding: "30px 16px",
                      cursor: "pointer", background: C.paper, textAlign: "center",
                    }}
                  >
                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={(e) => handleFileSelected(e.target.files[0])}
                      style={{ display: "none" }}
                    />
                    <FileSpreadsheet size={22} color={C.slate} />
                    <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk }}>
                      Drop a CSV or Excel file, or click to browse
                    </div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight }}>
                      .csv, .xlsx, .xls — one row per company
                    </div>
                    {importState === "error" && (
                      <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.redSolid, marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
                        <AlertTriangle size={12} /> {importError}
                      </div>
                    )}
                  </label>
                )}

                {importState === "parsed" && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk, fontWeight: 600 }}>
                        <Check size={13} color={C.green} /> {importFileName} — {importRecords.length} rows found
                      </div>
                      <button onClick={resetImport} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, color: C.slate, textDecoration: "underline" }}>
                        Use a different file
                      </button>
                    </div>

                    <div style={{ background: C.paper, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8 }}>
                        Match your columns
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {[
                          ["name", "Company name*"],
                          ["phone", "Phone number*"],
                          ["website", "Website / link"],
                          ["contact", "Contact person"],
                          ["channel", "Preferred channel"],
                        ].map(([field, label]) => (
                          <div key={field}>
                            <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginBottom: 3 }}>{label}</div>
                            <select
                              value={columnMap[field]}
                              onChange={(e) => updateColumnMap(field, e.target.value)}
                              style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12 }}
                            >
                              <option value="">— not in file —</option>
                              {importHeaders.map((h) => (
                                <option key={h} value={h}>{h}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                        <Table2 size={12} /> Preview — {includedImportRows.length} of {importRows.length} will be added
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {[
                          ["all", `All (${importRows.length})`],
                          ["issues", `Needs review (${flaggedCount})`],
                          ["duplicates", `Duplicates (${duplicateCount})`],
                          ["known", `Already known (${knownCount})`],
                        ].map(([id, label]) => {
                          const empty =
                            (id === "issues" && !flaggedCount) ||
                            (id === "duplicates" && !duplicateCount) ||
                            (id === "known" && !knownCount);
                          return (
                          <button
                            key={id}
                            onClick={() => setImportFilter(id)}
                            disabled={id !== "all" && empty}
                            style={{
                              padding: "4px 9px", borderRadius: 999, border: `1px solid ${importFilter === id ? C.ink : C.border}`,
                              background: importFilter === id ? C.ink : "#fff", color: importFilter === id ? "#fff" : (empty ? C.slateLight : C.slate),
                              fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600, cursor: empty ? "default" : "pointer",
                            }}
                          >
                            {label}
                          </button>
                          );
                        })}
                      </div>
                    </div>

                    {flaggedCount > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.amberSoft, borderRadius: 8, padding: "8px 10px", marginBottom: 8 }}>
                        <AlertTriangle size={13} color={C.amber} />
                        <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.textInk, flex: 1 }}>
                          {flaggedCount} row{flaggedCount === 1 ? "" : "s"} flagged (missing info, bad number, duplicate, or already in the call log under a different name) and left unchecked — they won't be contacted unless you fix and re-check them.
                        </span>
                        <button onClick={removeFlaggedRows} style={{ background: "none", border: `1px solid ${C.amber}`, color: C.amber, borderRadius: 6, padding: "4px 9px", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                          Discard flagged rows
                        </button>
                      </div>
                    )}
                    {knownCount > 0 && (
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: C.cobaltSoft, borderRadius: 8, padding: "8px 10px", marginBottom: 8 }}>
                        <History size={13} color={C.cobaltDeep} style={{ marginTop: 1, flexShrink: 0 }} />
                        <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.textInk, lineHeight: 1.45 }}>
                          {knownCount} match{knownCount === 1 ? "es" : ""} a company or person already in the call log — including the same firm under a different legal name, or the same individual (Jim = James). Skipped by default so nobody gets a repeat call.
                        </span>
                      </div>
                    )}

                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                      <button onClick={() => selectAllShown(true)} style={{ background: "none", border: "none", color: C.cobalt, fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                        Check all shown
                      </button>
                      <button onClick={() => selectAllShown(false)} style={{ background: "none", border: "none", color: C.slate, fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                        Uncheck all shown
                      </button>
                      <span style={{ width: 1, height: 14, background: C.border }} />
                      <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight }}>Set channel for checked rows:</span>
                      <select value={bulkChannel} onChange={(e) => setBulkChannel(e.target.value)} style={{ padding: "3px 6px", borderRadius: 5, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 11 }}>
                        {CHANNEL_OPTIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                      <button onClick={applyBulkChannel} style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 6, padding: "4px 9px", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                        Apply
                      </button>
                    </div>

                    <div style={{ maxHeight: 260, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 10 }}>
                      {filteredImportRows.length === 0 && (
                        <div style={{ padding: 16, textAlign: "center", fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight }}>No rows match this filter.</div>
                      )}
                      {filteredImportRows.map((r) => (
                        <div key={r.id} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", borderBottom: `1px solid ${C.border}`, opacity: r.included ? 1 : 0.55 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <input type="checkbox" checked={r.included} onChange={() => toggleImportRow(r.id)} style={{ cursor: "pointer" }} />
                            <input
                              value={r.name}
                              onChange={(e) => updateImportRow(r.id, "name", e.target.value)}
                              placeholder="Company name"
                              style={{ flex: 1.3, padding: "5px 8px", borderRadius: 6, border: `1px solid ${r.issues.includes("missing_name") ? C.redSolid : C.border}`, fontFamily: FONT_BODY, fontSize: 12 }}
                            />
                            <input
                              value={r.phone}
                              onChange={(e) => updateImportRow(r.id, "phone", e.target.value)}
                              placeholder="Phone"
                              style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: `1px solid ${r.issues.includes("missing_phone") || r.issues.includes("bad_phone") ? C.redSolid : C.border}`, fontFamily: FONT_BODY, fontSize: 12 }}
                            />
                            <input
                              value={r.source}
                              onChange={(e) => updateImportRow(r.id, "source", e.target.value)}
                              placeholder="Website / link"
                              style={{ flex: 1.4, padding: "5px 8px", borderRadius: 6, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12 }}
                            />
                            <button onClick={() => removeImportRow(r.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px" }}>
                              <Trash2 size={13} color={C.slateLight} />
                            </button>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 22, flexWrap: "wrap" }}>
                            <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.slateLight }}>Contact via</span>
                            <select
                              value={r.channel}
                              onChange={(e) => updateImportRow(r.id, "channel", e.target.value)}
                              style={{ padding: "3px 6px", borderRadius: 5, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 11 }}
                            >
                              <option value="">Mission default</option>
                              {CHANNEL_OPTIONS.map((c) => (
                                <option key={c.id} value={c.id}>{c.label}</option>
                              ))}
                            </select>
                            {r.channel && r.channel !== "auto" && (
                              <>
                                <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.slateLight }}>then, if no reply</span>
                                <select
                                  value={r.fallback}
                                  onChange={(e) => updateImportRow(r.id, "fallback", e.target.value)}
                                  style={{ padding: "3px 6px", borderRadius: 5, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 11 }}
                                >
                                  <option value="none">Don't retry</option>
                                  {CHANNEL_OPTIONS.filter((c) => c.id !== "auto" && c.id !== r.channel).map((c) => (
                                    <option key={c.id} value={c.id}>Try {c.label}</option>
                                  ))}
                                </select>
                              </>
                            )}
                            {r.issues.length > 0 && (
                              <span style={{ display: "flex", gap: 4, marginLeft: "auto", flexWrap: "wrap" }}>
                                {r.issues.map((code) => (
                                  <span key={code} style={{ fontFamily: FONT_BODY, fontSize: 10, fontWeight: 700, color: (ISSUE_META[code] || ISSUE_META.duplicate).color, background: "#fff", border: `1px solid ${(ISSUE_META[code] || ISSUE_META.duplicate).color}`, borderRadius: 999, padding: "1px 6px" }}>
                                    {code === "duplicate" ? `Duplicate of ${r.duplicateOf}` : (ISSUE_META[code] || {}).label || code}
                                  </span>
                                ))}
                              </span>
                            )}
                          </div>
                          {r.identityMatch && (
                            <div style={{ paddingLeft: 22, fontFamily: FONT_BODY, fontSize: 11, color: C.slate, lineHeight: 1.4 }}>
                              {r.identityMatch.reasons[0]}
                              {r.identityMatch.requestedFollowUp ? ` — they asked: “${r.identityMatch.requestedFollowUp.exactWords}” (${r.identityMatch.requestedFollowUp.day}, ${r.identityMatch.requestedFollowUp.time})` : ""}
                              {r.identityMatch.lastContactAt ? ` · last ${r.identityMatch.lastContactAt}` : ""}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={useImportedRows}
                      disabled={!includedImportRows.length}
                      style={{
                        marginTop: 12, width: "100%", padding: "9px", borderRadius: 8, border: "none",
                        background: includedImportRows.length ? C.ink : C.paperSoft, color: includedImportRows.length ? "#fff" : C.slateLight,
                        fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12.5, cursor: includedImportRows.length ? "pointer" : "default",
                      }}
                    >
                      Add {includedImportRows.length} companies to this mission
                    </button>
                  </div>
                )}
              </div>
            )}

            {manualMode === "form" && (
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
                  <input
                    value={r.contact || ""}
                    onChange={(e) => updateRow(r.id, "contact", e.target.value)}
                    placeholder="Contact person — catches Jim Whitfield = James Whitfield"
                    style={{ padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none" }}
                  />
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>Contact via</span>
                    <select
                      value={r.channel || ""}
                      onChange={(e) => updateRow(r.id, "channel", e.target.value)}
                      style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 11.5 }}
                    >
                      <option value="">Mission default</option>
                      {CHANNEL_OPTIONS.map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                    {r.channel && r.channel !== "auto" && (
                      <>
                        <span style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>then, if no reply</span>
                        <select
                          value={r.fallback || "none"}
                          onChange={(e) => updateRow(r.id, "fallback", e.target.value)}
                          style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 11.5 }}
                        >
                          <option value="none">Don't retry</option>
                          {CHANNEL_OPTIONS.filter((c) => c.id !== "auto" && c.id !== r.channel).map((c) => (
                            <option key={c.id} value={c.id}>Try {c.label}</option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                  {findIdentityMatch(r, registry, callLog) && (
                    <div style={{ background: C.amberSoft, borderRadius: 7, padding: "7px 9px", fontFamily: FONT_BODY, fontSize: 11.5, color: C.textInk, lineHeight: 1.4 }}>
                      {findIdentityMatch(r, registry, callLog).reasons[0]} — will be skipped from the dialer so we don't contact them twice. Confirm still adds them to the mission as skipped.
                    </div>
                  )}
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
          </>
        )}

        <div style={{ marginTop: 18, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <Sparkles size={12} /> Default contact channel
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
            {channel === "auto"
              ? "AI tries a voice call first, and falls back to WhatsApp or SMS if it can't get through."
              : `Used for any company that doesn't have its own channel set — contacted by ${channel === "voice" ? "phone call" : channel === "whatsapp" ? "WhatsApp message" : "text message"}. Set "Contact via" per row above to override for a specific company.`}
          </div>
        </div>

        <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <Clock size={12} /> Call schedule
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>Call window</span>
            <select value={windowStart} onChange={(e) => setWindowStart(e.target.value)} style={{ padding: "6px 9px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5 }}>
              {["09:00", "09:30", "10:00"].map((t) => <option key={t}>{t}</option>)}
            </select>
            <span style={{ color: C.slateLight }}>–</span>
            <select value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} style={{ padding: "6px 9px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5 }}>
              {["16:00", "16:30", "17:00", "17:30"].map((t) => <option key={t}>{t}</option>)}
            </select>
            <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight }}>UK compliance limit: 09:00–17:30</span>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>Calls running at once</span>
            <select value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} style={{ padding: "6px 9px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5 }}>
              {CONCURRENCY_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight }}>higher = faster through the list, but more simultaneous lines</span>
          </div>

          {readyToCallCount > 0 && (
            <div
              style={{
                display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, padding: "9px 11px", borderRadius: 8,
                background: queueEstimate.willFinishToday ? C.tealSoft : C.amberSoft,
              }}
            >
              {queueEstimate.willFinishToday ? <CheckCircle2 size={14} color={C.teal} style={{ marginTop: 1, flexShrink: 0 }} /> : <AlertTriangle size={14} color={C.amber} style={{ marginTop: 1, flexShrink: 0 }} />}
              <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.textInk, lineHeight: 1.5 }}>
                {queueEstimate.willFinishToday
                  ? <><strong>{readyToCallCount} companies</strong> queued — at {concurrency} concurrent, should finish today around <strong>{queueEstimate.finishLabel}</strong>.</>
                  : <><strong>{readyToCallCount} companies</strong> queued won't all fit in today's {windowStart}–{windowEnd} window at {concurrency} concurrent (~{queueEstimate.capacityPerDay} fit per day). Expect about <strong>{queueEstimate.daysNeeded} days</strong> to get through the list — raise concurrency or extend the window to go faster.</>}
              </span>
            </div>
          )}
        </div>

        <button
          onClick={() =>
            canSubmit &&
            onCreate({
              tab,
              prompt,
              rows: tab === "manual" ? rows.filter((r) => r.name && r.phone) : [],
              channel,
              windowStart,
              windowEnd,
              concurrency,
              queueEstimate,
            })
          }
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

/* ---------------------------------- simplified v2 workspace ---------------------------------- */

function WorkspaceTabs({ items, active, onChange }) {
  return (
    <div style={{ padding: "12px 32px 0", background: C.paper, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", gap: 4 }}>
        {items.map((item) => {
          const Icon = item.icon;
          const selected = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 12px",
                border: "none",
                borderBottom: `2px solid ${selected ? C.cobalt : "transparent"}`,
                background: "transparent",
                color: selected ? C.cobaltDeep : C.slate,
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                fontWeight: selected ? 700 : 600,
                cursor: "pointer",
              }}
            >
              <Icon size={14} /> {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TodayMetric({ label, value, note, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left",
        background: C.paperCard,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 16,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate }}>{label}</div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 25, fontWeight: 700, color: color || C.textInk, marginTop: 4 }}>{value}</div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, marginTop: 3 }}>{note}</div>
    </button>
  );
}

function TodayView({ notifications, setNotifications, calls, scheduleItems, meetings, callLog, onNavigate, onNewMission }) {
  const activeCalls = calls.filter((c) => !c.ended);
  const needsHuman = activeCalls.filter((c) => c.state === "human_review");
  const todayCalls = scheduleItems.filter((i) => i.day.startsWith("Today"));
  const upcomingMeetings = meetings.filter((m) => m.status === "upcoming");
  const nextActions = [
    ...needsHuman.map((c) => ({
      id: `human_${c.id}`,
      tone: "alert",
      icon: AlertTriangle,
      title: `${c.prospect} needs you`,
      detail: c.flag || "AI needs staff input",
      action: "Open conversation",
      target: "live",
    })),
    ...todayCalls.filter((i) => i.status !== "completed").slice(0, 3).map((i) => ({
      id: `schedule_${i.id}`,
      tone: i.honored ? "honored" : "normal",
      icon: Clock,
      title: `${i.time} · ${i.prospect}`,
      detail: i.honoredQuote ? `They asked: “${i.honoredQuote}”` : `Scheduled outreach · ${i.mission}`,
      action: "Open calendar",
      target: "schedule",
    })),
    ...upcomingMeetings.slice(0, 2).map((m) => ({
      id: `meeting_${m.id}`,
      tone: "success",
      icon: CalendarCheck,
      title: `${m.date}, ${m.time} · ${m.prospect}`,
      detail: `${m.duration} ${m.format === "video" ? "video meeting" : m.format === "phone" ? "phone meeting" : "in-person meeting"}`,
      action: "Meeting details",
      target: "meetings",
    })),
  ];

  return (
    <>
      <TopBar
        title="Today"
        subtitle="One place for live conversations, callbacks, meetings, and anything that needs you"
        onNewMission={onNewMission}
        notifications={notifications}
        setNotifications={setNotifications}
      />
      <div style={{ padding: "20px 32px 32px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(150px, 1fr))", gap: 12, marginBottom: 22 }}>
          <TodayMetric label="Live now" value={activeCalls.length} note="Calls and messages" color={C.cobaltDeep} onClick={() => onNavigate("live")} />
          <TodayMetric label="Needs you" value={needsHuman.length} note="Questions AI cannot answer" color={needsHuman.length ? C.red : C.green} onClick={() => onNavigate("live")} />
          <TodayMetric label="Calls today" value={todayCalls.length} note="Callbacks and scheduled outreach" onClick={() => onNavigate("schedule")} />
          <TodayMetric label="Upcoming meetings" value={upcomingMeetings.length} note="Confirmed appointments" color={C.green} onClick={() => onNavigate("meetings")} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(280px, 0.8fr)", gap: 16 }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, color: C.textInk }}>Next actions</div>
              <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight }}>Ordered by urgency</span>
            </div>
            <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              {nextActions.map((item, index) => {
                const Icon = item.icon;
                const accent = item.tone === "alert" ? C.red : item.tone === "success" || item.tone === "honored" ? C.teal : C.cobalt;
                return (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", borderTop: index ? `1px solid ${C.border}` : "none" }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: item.tone === "alert" ? C.redSoft : item.tone === "success" || item.tone === "honored" ? C.tealSoft : C.cobaltSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon size={15} color={accent} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 650, color: C.textInk }}>{item.title}</div>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: item.tone === "honored" ? C.teal : C.slate, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.detail}</div>
                    </div>
                    <button onClick={() => onNavigate(item.target)} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 9px", fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, cursor: "pointer" }}>
                      {item.action}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, color: C.textInk, marginBottom: 9 }}>Recent outcomes</div>
            <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              {callLog.slice(0, 5).map((entry, index) => (
                <button
                  key={entry.id}
                  onClick={() => onNavigate("calllog")}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "11px 13px", border: "none", borderTop: index ? `1px solid ${C.border}` : "none", background: "#fff", textAlign: "left", cursor: "pointer" }}
                >
                  <ChannelTag channel={entry.channel} small />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.textInk, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.canonicalName}</div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.slateLight }}>{entry.endedAt}</div>
                  </div>
                  <Badge status={entry.outcome} small />
                </button>
              ))}
            </div>
            <button onClick={() => onNavigate("calllog")} style={{ width: "100%", marginTop: 9, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, cursor: "pointer" }}>
              View complete history
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------------------------------- app shell ---------------------------------- */

export default function App() {
  const [view, setView] = useState("today");
  const [selectedMission, setSelectedMission] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [notifications, setNotifications] = useState(INITIAL_NOTIFICATIONS);
  const [missions, setMissions] = useState(INITIAL_MISSIONS);
  const [prefillSchedule, setPrefillSchedule] = useState(null);
  const [prefillLogQuery, setPrefillLogQuery] = useState(null);
  const [liveCalls, setLiveCalls] = useState(INITIAL_LIVE_CALLS.map((c) => ({ ...c, taken: false, listening: false, confirmingEnd: false, ended: false, booked: false })));
  const [scheduleItems, setScheduleItems] = useState(INITIAL_SCHEDULE);
  const [meetings, setMeetings] = useState(INITIAL_MEETINGS);
  const [callLog, setCallLog] = useState(INITIAL_CALL_LOG);
  const [registry, setRegistry] = useState(INITIAL_CONTACT_REGISTRY);
  const [profile, setProfile] = useState({
    name: "AIVHub",
    pitch: "AI-powered business intelligence dashboards for mid-market operations teams",
    industry: "Business intelligence / data consulting",
    website: "https://aivhub.io",
    social: "linkedin.com/company/aivhub",
    callerName: "Sam",
    callerId: "+44 20 7946 0912",
    tone: "Professional, concise, friendly",
    disclosure: "This call may be recorded for quality and training purposes.",
    legalName: "AIVHub Ltd",
    icoRef: "ZA774219",
    dpoContact: "privacy@aivhub.io",
    dncNotes: "Opt-outs logged immediately and excluded from all future missions. Reviewed weekly by the ops admin.",
  });

  const openMission = (m) => {
    setSelectedMission(m);
    setView("missionDetail");
  };

  // turns raw "AI: ..." / "Prospect: ..." transcript lines (live-call format) into the
  // { who, text } shape meetings expect for their call transcript
  const toCallTranscript = (lines) =>
    (lines || []).map((l) => {
      const isAi = l.startsWith("AI:");
      return { who: isAi ? "ai" : "them", text: l.replace(/^AI:\s*|^Prospect:\s*/, "") };
    });

  const toggleCallTaken = (id) => setLiveCalls((cs) => cs.map((c) => (c.id === id ? { ...c, taken: !c.taken } : c)));
  const toggleCallListen = (id) => setLiveCalls((cs) => cs.map((c) => (c.id === id ? { ...c, listening: !c.listening } : c)));
  const askEndCall = (id) => setLiveCalls((cs) => cs.map((c) => (c.id === id ? { ...c, confirmingEnd: true } : c)));
  const cancelEndCall = (id) => setLiveCalls((cs) => cs.map((c) => (c.id === id ? { ...c, confirmingEnd: false } : c)));

  const appendCallLog = (call, outcome, extra = {}) => {
    const match = findIdentityMatch({ name: call.prospect, phone: "", contact: "" }, registry, callLog);
    const followUp = extra.requestedFollowUp !== undefined ? extra.requestedFollowUp : extractRequestedTime(call.transcript);
    const endedAt = nowStamp();
    const entry = {
      id: "cl_" + Date.now(),
      registryId: match?.registryId || "cr_" + Date.now(),
      canonicalName: match?.canonicalName || call.prospect,
      listedAs: call.prospect,
      personCanonical: match?.personCanonical || "",
      personListedAs: extra.attendee || "",
      channel: call.channel,
      mission: call.mission,
      startedAt: extra.startedAt || endedAt,
      endedAt,
      duration: call.duration,
      outcome,
      requestedFollowUp: followUp || null,
      wordsLocked: true,
      transcript: lockTranscript(call.transcript),
    };
    setCallLog((ls) => [entry, ...ls]);
    setRegistry((reg) => {
      if (match?.registryId) {
        return reg.map((r) => {
          if (r.id !== match.registryId) return r;
          const already = r.canonicalName === call.prospect || (r.aliases || []).includes(call.prospect);
          return {
            ...r,
            aliases: already ? r.aliases : [...(r.aliases || []), call.prospect],
            lastOutcome: outcome,
            lastContactAt: endedAt,
            doNotCall: outcome === "rejected" ? true : r.doNotCall,
            requestedFollowUp: followUp || r.requestedFollowUp,
          };
        });
      }
      return [
        {
          id: entry.registryId,
          canonicalName: call.prospect,
          aliases: [],
          phones: [],
          websites: [],
          region: "",
          sector: "",
          people: [],
          doNotCall: outcome === "rejected",
          lastOutcome: outcome,
          lastContactAt: endedAt,
          requestedFollowUp: followUp || null,
        },
        ...reg,
      ];
    });
    return entry;
  };

  const confirmEndCall = (id) => {
    const call = liveCalls.find((c) => c.id === id);
    setLiveCalls((cs) => cs.map((c) => (c.id === id ? { ...c, ended: true, confirmingEnd: false } : c)));
    const isMessage = call && (call.channel === "whatsapp" || call.channel === "sms");
    if (call) appendCallLog(call, isMessage ? "thread_ended" : "operator_ended");
    setNotifications((ns) => [{ id: "n_" + Date.now(), text: isMessage ? "Conversation ended — saved to Call Log verbatim" : "Call ended — saved to Call Log verbatim", time: "just now", unread: true, type: "info" }, ...ns]);
  };

  // confirming a negotiated time writes Schedule + Meetings AND a locked call-log
  // row. day/time come from the prospect's own words when they named one.
  const confirmBooking = (call) => {
    const requested = extractRequestedTime(call.transcript);
    const day = requested?.day || "Today, 27 Aug";
    const time = requested?.time || "16:00";
    const honored = !!requested;

    setScheduleItems((its) => [
      ...its,
      {
        id: "s_" + Date.now(),
        day,
        time,
        prospect: call.prospect,
        mission: call.mission,
        window: "09:00–17:30",
        status: "queued",
        honored,
        honoredQuote: requested?.exactWords || null,
      },
    ]);

    setMeetings((ms) => [
      {
        id: "mt_" + Date.now(),
        prospect: call.prospect,
        mission: call.mission,
        date: day,
        time,
        duration: "15 min",
        status: "upcoming",
        fit: 80,
        channel: call.channel,
        format: "video",
        platform: "Google Meet",
        videoLink: `meet.google.com/aiv-${call.prospect.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        host: "Jitendra S.",
        attendee: `${call.prospect} · Contact`,
        prep: honored
          ? `They said: “${requested.exactWords}” — booked at that time, not a guessed slot.`
          : "Booked live by the AI — they hadn't named a time yet, so this is the next open slot.",
        callTranscript: toCallTranscript(call.transcript),
        meetingTranscript: null,
      },
      ...ms,
    ]);

    setLiveCalls((cs) => cs.map((c) => (c.id === call.id ? { ...c, ended: true, booked: true } : c)));
    appendCallLog(call, "meeting_booked", { requestedFollowUp: requested, attendee: `${call.prospect} · Contact` });

    setNotifications((ns) => [
      {
        id: "n_" + Date.now(),
        text: honored
          ? `Meeting booked with ${call.prospect} at ${day} ${time} — time taken from their words: “${requested.exactWords}”`
          : `Meeting booked with ${call.prospect} — they hadn't named a time, used next open slot ${time}`,
        time: "just now",
        unread: true,
        type: "success",
      },
      ...ns,
    ]);
  };

  const createMission = (payload) => {
    setShowNew(false);

    if (payload.tab === "manual" && payload.rows.length) {
      const CHANNEL_LABEL = { voice: "voice call", whatsapp: "WhatsApp", sms: "SMS", auto: "AI-chosen channel" };
      const concurrency = payload.concurrency || 5;
      const callbackAdds = [];
      let dialIndex = 0;
      const prospects = payload.rows.map((r, i) => {
        const match = r.identityMatch || findIdentityMatch(r, registry, callLog);
        const effChannel = r.channel || payload.channel;
        const channelNote = r.fallback && r.fallback !== "none"
          ? `Contact via ${CHANNEL_LABEL[effChannel]}, then ${CHANNEL_LABEL[r.fallback]} if no reply`
          : `Contact via ${CHANNEL_LABEL[effChannel]}`;

        if (match && match.blockDefault) {
          if (match.issueCode === "callback_pending" && match.requestedFollowUp) {
            callbackAdds.push({
              id: "s_" + Date.now() + "_" + i,
              day: match.requestedFollowUp.day,
              time: match.requestedFollowUp.time,
              prospect: match.canonicalName,
              mission: `Uploaded list — ${payload.rows.length} companies`,
              window: `${payload.windowStart}–${payload.windowEnd}`,
              status: "queued",
              honored: true,
              honoredQuote: match.requestedFollowUp.exactWords,
            });
            return {
              id: "up_" + Date.now() + "_" + i,
              name: r.name,
              status: "retry",
              channel: effChannel,
              note: `Not re-dialed cold. They asked: “${match.requestedFollowUp.exactWords}” — callback set for ${match.requestedFollowUp.day} ${match.requestedFollowUp.time}. ${match.reasons[0]}`,
              time: match.requestedFollowUp.time,
            };
          }
          return {
            id: "up_" + Date.now() + "_" + i,
            name: r.name,
            status: "skipped",
            channel: effChannel,
            note: `Skipped — ${match.note}. ${match.reasons[0] || ""}${match.doNotCall ? " On do-not-call." : ""}`,
            time: match.lastContactAt || "known",
          };
        }

        const status = dialIndex < concurrency ? "calling" : "queued";
        dialIndex += 1;
        return {
          id: "up_" + Date.now() + "_" + i,
          name: r.name,
          status,
          channel: effChannel,
          fallback: r.fallback && r.fallback !== "none" ? r.fallback : null,
          note: (r.source ? `Research source: ${r.source}. ` : "No research source provided — will call cold. ") + channelNote,
          time: status === "calling" ? "now" : "waiting in queue",
        };
      });

      if (callbackAdds.length) setScheduleItems((its) => [...its, ...callbackAdds]);

      const skipped = prospects.filter((p) => p.status === "skipped" || p.status === "retry").length;
      const mission = {
        id: "m_" + Date.now(),
        title: `Uploaded list — ${payload.rows.length} companies`,
        sector: "Mixed",
        region: "Uploaded list",
        status: "active",
        contacted: 0,
        total: payload.rows.length,
        meetingsBooked: 0,
        created: "just now",
        source: "manual",
        concurrency,
        queueEstimate: payload.queueEstimate,
        callWindow: `${payload.windowStart}–${payload.windowEnd}`,
        prospects,
      };
      setMissions((ms) => [mission, ...ms]);
      setNotifications((ns) => [
        {
          id: "n_" + Date.now(),
          text: skipped
            ? `${payload.rows.length} imported — ${dialIndex} going out now, ${skipped} skipped or set to the time they already asked for`
            : `${payload.rows.length} companies imported — ${Math.min(concurrency, payload.rows.length)} calls starting now, rest queued`,
          time: "just now",
          unread: true,
          type: "info",
        },
        ...ns,
      ]);
      openMission(mission);
      return;
    }

    setNotifications((ns) => [{ id: "n_" + Date.now(), text: "New outreach mission created and queued", time: "just now", unread: true, type: "info" }, ...ns]);
  };

  const goScheduleFor = (name) => {
    setPrefillSchedule(name);
    setView("schedule");
  };

  const goLogFor = (name) => {
    setPrefillLogQuery(name);
    setView("calllog");
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

      <Sidebar view={view === "missionDetail" ? "missions" : view} setView={(v) => { setView(v); setSelectedMission(null); }} companyName={profile.name} callerName={profile.callerName} />

      <div style={{ flex: 1, overflowY: "auto" }}>
        {view === "today" && (
          <TodayView
            notifications={notifications}
            setNotifications={setNotifications}
            calls={liveCalls}
            scheduleItems={scheduleItems}
            meetings={meetings}
            callLog={callLog}
            onNavigate={setView}
            onNewMission={() => setShowNew(true)}
          />
        )}
        {view === "missions" && <MissionsView missions={missions} onOpenMission={openMission} onNewMission={() => setShowNew(true)} notifications={notifications} setNotifications={setNotifications} />}
        {view === "missionDetail" && selectedMission && <MissionDetail mission={selectedMission} onBack={() => setView("missions")} companyName={profile.name} />}
        {view === "schedule" && (
          <>
            <WorkspaceTabs
              active="schedule"
              onChange={setView}
              items={[
                { id: "schedule", label: "Calls & callbacks", icon: PhoneCall },
                { id: "meetings", label: "Meetings", icon: CalendarCheck },
              ]}
            />
            <ScheduleView notifications={notifications} setNotifications={setNotifications} prefillName={prefillSchedule} clearPrefill={() => setPrefillSchedule(null)} items={scheduleItems} setItems={setScheduleItems} />
          </>
        )}
        {view === "meetings" && (
          <>
            <WorkspaceTabs
              active="meetings"
              onChange={setView}
              items={[
                { id: "schedule", label: "Calls & callbacks", icon: PhoneCall },
                { id: "meetings", label: "Meetings", icon: CalendarCheck },
              ]}
            />
            <MeetingsView notifications={notifications} setNotifications={setNotifications} companyName={profile.name} meetings={meetings} setMeetings={setMeetings} />
          </>
        )}
        {view === "live" && (
          <>
            <WorkspaceTabs
              active="live"
              onChange={setView}
              items={[
                { id: "today", label: "Today overview", icon: ListChecks },
                { id: "live", label: "Live conversations", icon: Radio },
              ]}
            />
            <LiveCallsView
              notifications={notifications}
              setNotifications={setNotifications}
              companyName={profile.name}
              calls={liveCalls}
              onConfirmBooking={confirmBooking}
              onTakenToggle={toggleCallTaken}
              onListenToggle={toggleCallListen}
              onAskEnd={askEndCall}
              onCancelEnd={cancelEndCall}
              onConfirmEnd={confirmEndCall}
            />
          </>
        )}
        {view === "calllog" && (
          <>
            <WorkspaceTabs
              active="calllog"
              onChange={setView}
              items={[
                { id: "prospects", label: "Companies & people", icon: Building2 },
                { id: "calllog", label: "Conversation history", icon: History },
              ]}
            />
            <CallLogView
              notifications={notifications}
              setNotifications={setNotifications}
              entries={callLog}
              prefillQuery={prefillLogQuery}
              clearPrefill={() => setPrefillLogQuery(null)}
              onJumpSchedule={goScheduleFor}
            />
          </>
        )}
        {view === "prospects" && (
          <>
            <WorkspaceTabs
              active="prospects"
              onChange={setView}
              items={[
                { id: "prospects", label: "Companies & people", icon: Building2 },
                { id: "calllog", label: "Conversation history", icon: History },
              ]}
            />
            <ProspectsView
              notifications={notifications}
              setNotifications={setNotifications}
              onScheduleFor={goScheduleFor}
              registry={registry}
              callLog={callLog}
              onOpenLog={goLogFor}
            />
          </>
        )}
        {view === "company" && (
          <>
            <WorkspaceTabs
              active="company"
              onChange={setView}
              items={[
                { id: "company", label: "Company & AI", icon: Users },
                { id: "connections", label: "Connections", icon: Plug },
                { id: "provider", label: "Providers", icon: Settings2 },
              ]}
            />
            <CompanyProfileView profile={profile} setProfile={setProfile} notifications={notifications} setNotifications={setNotifications} />
          </>
        )}
        {view === "connections" && (
          <>
            <WorkspaceTabs
              active="connections"
              onChange={setView}
              items={[
                { id: "company", label: "Company & AI", icon: Users },
                { id: "connections", label: "Connections", icon: Plug },
                { id: "provider", label: "Providers", icon: Settings2 },
              ]}
            />
            <ConnectionsView notifications={notifications} setNotifications={setNotifications} />
          </>
        )}
        {view === "provider" && (
          <>
            <WorkspaceTabs
              active="provider"
              onChange={setView}
              items={[
                { id: "company", label: "Company & AI", icon: Users },
                { id: "connections", label: "Connections", icon: Plug },
                { id: "provider", label: "Providers", icon: Settings2 },
              ]}
            />
            <ProviderConfigView notifications={notifications} setNotifications={setNotifications} />
          </>
        )}
        {view === "analytics" && <AnalyticsView notifications={notifications} setNotifications={setNotifications} />}
      </div>

      {showNew && <NewMissionModal onClose={() => setShowNew(false)} onCreate={createMission} registry={registry} callLog={callLog} />}
    </div>
  );
}
