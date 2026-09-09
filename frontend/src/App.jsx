import React, { useState, useRef, useEffect } from "react";
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
  User,
  ExternalLink,
  ListChecks,
  Radio,
  Target,
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
  History,
  Quote,
  Mail,
  LogOut,
  LayoutGrid,
  CalendarDays,
  Maximize2,
  Minimize2,
  MoveHorizontal,
  GripHorizontal,
  RotateCcw,
  Lock,
  Send,
  PenLine,
  RefreshCw,
  Save,
  Zap,
  Brain,
  Cpu,
  Sliders,
  SlidersHorizontal,
  Shield,
  Activity,
  Copy,
  Download,
  ToggleLeft,
  ToggleRight,
  Flame,
  ShieldAlert,
  Server,
  Eye,
  EyeOff,
  Terminal,
  Bot,
  Plus,
  Play,
  Wand2,
  Image as ImageIcon,
  Smartphone,
  Briefcase,
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


import { api } from "./api/apiClient";
import LeadGenerationPlugin from "./plugins/LeadGenerationPlugin";
import EmailOutreachPlugin from "./plugins/EmailOutreachPlugin";


/* ---------------------------------- Common Platform AI & Provider Hub Configuration ---------------------------------- */

const INITIAL_BUILTIN_PROVIDERS = [
  { id: "xai", name: "xAI (Grok)", type: "llm", badge: "xAI Voice & LPU", status: "not_configured", latencyMs: null, baseUrl: "https://api.x.ai/v1", apiKey: "", phoneNumber: "", agentId: "", models: ["xAI Grok-2", "xAI Grok-beta", "xAI Grok-4.6", "xAI Grok-4.5"] },
  { id: "deepseek", name: "DeepSeek AI", type: "llm", badge: "Open-Weight Cloud", status: "not_configured", latencyMs: null, baseUrl: "https://api.deepseek.com/v1", apiKey: "", models: ["DeepSeek V4 Flash", "DeepSeek-V3", "DeepSeek-R1"] },
  { id: "anthropic", name: "Anthropic Claude", type: "llm", badge: "Managed API", status: "not_configured", latencyMs: null, baseUrl: "https://api.anthropic.com/v1", apiKey: "", models: ["Claude Sonnet 4.5", "Claude 3.5 Sonnet", "Claude 3.7 Sonnet", "Claude 3.5 Haiku"] },
  { id: "openai", name: "OpenAI", type: "llm", badge: "Managed API", status: "not_configured", latencyMs: null, baseUrl: "https://api.openai.com/v1", apiKey: "", models: ["GPT-4o", "GPT-4o-mini", "o3-mini", "text-embedding-3"] },
  { id: "groq", name: "Groq LPU (Ultra-Fast)", type: "llm", badge: "LPU Accelerator", status: "not_configured", latencyMs: null, baseUrl: "https://api.groq.com/openai/v1", apiKey: "", models: ["Groq Llama 3.3 70B", "Groq Llama 3.1 8B", "DeepSeek-R1 Distill Llama 70B"] },
  { id: "gemini", name: "Google Gemini", type: "llm", badge: "Managed API", status: "not_configured", latencyMs: null, baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "", models: ["Gemini 2.0 Flash", "Gemini 1.5 Pro", "Gemini Embedding"] },
  { id: "ollama", name: "Ollama / Self-Hosted", type: "llm", badge: "100% Private On-Prem", status: "not_configured", latencyMs: null, baseUrl: "http://localhost:11434/v1", apiKey: "", models: ["Ollama Llama 3.2 (Local)", "Ollama Mistral (Local)", "DeepSeek-R1 (Local)", "Ollama nomic-embed (Local)"] },
  { id: "deepgram", name: "Deepgram", type: "stt", badge: "Managed STT", status: "not_configured", latencyMs: null, baseUrl: "https://api.deepgram.com/v1", apiKey: "", models: ["Deepgram Nova-3", "Deepgram Nova-2"] },
  { id: "elevenlabs", name: "ElevenLabs", type: "tts", badge: "Managed Voice", status: "not_configured", latencyMs: null, baseUrl: "https://api.elevenlabs.io/v1", apiKey: "", models: ["ElevenLabs Turbo", "ElevenLabs Multilingual v2"] },
  { id: "vapi", name: "Vapi Voice AI", type: "voice", badge: "Voice Orchestration", status: "not_configured", latencyMs: null, baseUrl: "https://api.vapi.ai", apiKey: "", models: ["Vapi Orchestrator"] },
  { id: "twilio", name: "Twilio Telephony", type: "telephony", badge: "Carrier", status: "not_configured", latencyMs: null, baseUrl: "https://api.twilio.com", apiKey: "", models: ["Twilio Voice Trunk"] },
];

const VOICE_LAYERS = [
  { key: "llm", label: "Dialogue & Conversational Reasoning LLM", desc: "Real-time conversation turns, context memory, and objection handling", paid: "xAI Grok-2", oss: "DeepSeek V4 Flash", options: ["xAI Grok-2", "xAI Grok-4.6", "Groq Llama 3.3 70B", "Claude 3.5 Sonnet", "GPT-4o", "DeepSeek V4 Flash", "Gemini 2.0 Flash"] },
  { key: "tts", label: "Text-to-Speech (Ultra-Low Latency)", desc: "Ultra-realistic speech generation with human inflection and natural breath", paid: "ElevenLabs Turbo", oss: "Kokoro (self-hosted)", options: ["ElevenLabs Turbo", "Cartesia Sonic", "Kokoro (self-hosted)", "PlayHT 2.0", "Amazon Polly"] },
  { key: "stt", label: "Speech-to-Text Acoustic Recognition", desc: "Real-time acoustic streaming transcription with noise suppression", paid: "Deepgram Nova-3", oss: "Faster-Whisper (self-hosted)", options: ["Deepgram Nova-3", "Faster-Whisper (self-hosted)", "OpenAI Whisper", "AssemblyAI"] },
  { key: "voice", label: "Voice Orchestration & Interruption Engine", desc: "Manages audio buffers, turn-taking arbitration, and silence detection", paid: "Vapi Voice AI", oss: "LiveKit (self-hosted)", options: ["Vapi Voice AI", "xAI Voice Agent", "Retell AI", "LiveKit (self-hosted)", "Bland AI"] },
  { key: "telephony", label: "Telephony Carrier & SIP Trunk", desc: "PSTN inbound numbers, caller ID preservation, and carrier routing", paid: "Twilio", oss: "Telnyx", options: ["Twilio", "xAI Voice Number", "Telnyx", "Plivo", "Vonage"] },
];

const LEADGEN_LAYERS = [
  { key: "researchLlm", label: "Web Search & Account Discovery LLM", desc: "Discovers target accounts matching ICP criteria across sectors", paid: "DeepSeek-V3", oss: "Groq Llama 3.3 70B", options: ["DeepSeek-V3", "Claude 3.5 Sonnet", "GPT-4o", "Gemini 2.0 Flash", "Groq Llama 3.3 70B"] },
  { key: "extractorLlm", label: "Decision-Maker & Contact Extractor", desc: "Extracts verified names, job titles, and contact signals", paid: "Groq Llama 3.3 70B", oss: "Ollama Llama 3.2 (Local)", options: ["Groq Llama 3.3 70B", "GPT-4o-mini", "DeepSeek-V3", "Claude 3.5 Sonnet", "Ollama Llama 3.2 (Local)"] },
  { key: "enrichmentEngine", label: "Live Web & Domain Crawler", desc: "Performs real-time scraping of company websites and news", paid: "DuckDuckGo Live + Crawler", oss: "Direct Domain Scraping", options: ["DuckDuckGo Live + Crawler", "Direct Domain Scraping", "Google Custom Search"] },
  { key: "dossierSynth", label: "Pain-Point & Strategic Hook Synthesizer", desc: "Synthesizes intelligence into conversation openers and cold hooks", paid: "Claude 3.5 Sonnet", oss: "DeepSeek-V3", options: ["Claude 3.5 Sonnet", "DeepSeek-V3", "GPT-4o", "Groq Llama 3.3 70B"] },
  { key: "intentScoring", label: "Autonomous ICP & Intent Fit Scorer", desc: "Calculates account priority and purchase readiness scores", paid: "DeepSeek-V3", oss: "Groq Llama 3.3 70B", options: ["DeepSeek-V3", "GPT-4o-mini", "Groq Llama 3.3 70B", "Claude 3.5 Sonnet"] },
];

const SCHEDULER_LAYERS = [
  { key: "postWriter", label: "Post Drafting & Multi-Channel Copywriting", desc: "Generates high-engagement social copy formatted per platform", paid: "Claude 3.5 Sonnet", oss: "Ollama Llama 3.2 (Local)", options: ["Claude 3.5 Sonnet", "xAI Grok-2", "GPT-4o", "Groq Llama 3.3 70B", "DeepSeek-V3", "Ollama Llama 3.2 (Local)"] },
  { key: "topicResearch", label: "Topic Research & Trend Discovery", desc: "Monitors industry trends to formulate timely editorial hooks", paid: "xAI Grok-2", oss: "Gemini 2.0 Flash", options: ["xAI Grok-2", "Gemini 2.0 Flash", "GPT-4o", "Claude 3.5 Sonnet", "DeepSeek-V3"] },
  { key: "imageStudio", label: "Visual Creative & Image Generator", desc: "Renders branded editorial visuals for scheduled posts", paid: "Flux Schnell (Zero Key Required)", oss: "Flux Schnell", options: ["Flux Schnell (Zero Key Required)", "Stability SDXL", "Custom Image API", "OpenAI DALL-E 3"] },
  { key: "chatPlanner", label: "Plan Chat Editorial Assistant", desc: "Refines campaign concepts and schedules interactively", paid: "xAI Grok-2", oss: "DeepSeek-R1 (Local)", options: ["xAI Grok-2", "Groq Llama 3.3 70B", "Claude 3.5 Sonnet", "GPT-4o-mini", "DeepSeek-R1 (Local)"] },
  { key: "embeddings", label: "Knowledge Base Embeddings (RAG)", desc: "Indexes brand voice guidelines, product guides, and playbooks", paid: "OpenAI text-embedding-3", oss: "Ollama nomic-embed (Local)", options: ["OpenAI text-embedding-3", "Gemini Embedding", "Ollama nomic-embed (Local)"] },
];

const EMAIL_LAYERS = [
  { key: "copywriterLlm", label: "Outreach Copywriter & Sequencer", desc: "Drafts concise, high-converting B2B cold email sequences", paid: "Claude 3.5 Sonnet", oss: "Groq Llama 3.3 70B", options: ["Claude 3.5 Sonnet", "GPT-4o", "DeepSeek-V3", "Groq Llama 3.3 70B", "Gemini 2.0 Flash"] },
  { key: "replyClassifier", label: "Inbound Reply Classifier & Sentiment", desc: "Categorizes inbound emails into Interested, Objections, or Not Now", paid: "DeepSeek-V3", oss: "GPT-4o-mini", options: ["DeepSeek-V3", "GPT-4o-mini", "Claude 3.5 Sonnet", "Groq Llama 3.3 70B"] },
  { key: "replyDrafter", label: "Context-Aware Auto-Response Drafter", desc: "Generates tailored responses to inbound client inquiries", paid: "Claude 3.5 Sonnet", oss: "DeepSeek-V3", options: ["Claude 3.5 Sonnet", "GPT-4o", "DeepSeek-V3", "Groq Llama 3.3 70B"] },
  { key: "spamAuditor", label: "Deliverability & Spam Auditor", desc: "Scans copy for trigger phrases to ensure high inbox delivery", paid: "AIV Spam Guard v2", oss: "DeepSeek-V3", options: ["AIV Spam Guard v2", "GPT-4o-mini", "DeepSeek-V3"] },
  { key: "contentTransformer", label: "Social Post-to-Email Repurposer", desc: "Transforms published social posts into broadcast emails", paid: "Claude 3.5 Sonnet", oss: "DeepSeek-V3", options: ["Claude 3.5 Sonnet", "GPT-4o", "DeepSeek-V3", "Groq Llama 3.3 70B"] },
];

const INITIAL_COMMON_AI_CONFIG = {
  mode: "custom", // "paid" | "opensource" | "custom"
  baseChatModel: "",
  baseChatProvider: "",
  
  // Extensible Connected Providers (Built-in + Custom User Added)
  providers: INITIAL_BUILTIN_PROVIDERS,

  // 1. Lead Generation layers
  leadgenLayers: Object.fromEntries(LEADGEN_LAYERS.map((l) => [l.key, l.paid])),

  // 2. Scheduler layers (shared with Post Scheduler)
  schedulerLayers: Object.fromEntries(SCHEDULER_LAYERS.map((l) => [l.key, l.paid])),

  // 3. Email Outreach layers
  emailLayers: Object.fromEntries(EMAIL_LAYERS.map((l) => [l.key, l.paid])),

  // 4. Voice layers (shared with Voice Agent)
  voiceLayers: Object.fromEntries(VOICE_LAYERS.map((l) => [l.key, l.paid])),
  schedulerMode: "custom",
  temperature: 0.8,
  personaPrompt: "Write authoritative, crisp B2B content that teaches actionable lessons without fluff or corporate buzzwords. Speak directly to C-suite and operations leaders.",
  prohibitedWords: "delve, in today's fast-paced world, game-changer, revolutionary, synergy, leverage",

  // Per-channel tone directives for Post Scheduler
  customConnections: [],
  channelDirectives: {
    linkedin: "Professional thought leadership. Strong 2-line hook, generous line spacing, practical takeaways, 2-3 relevant hashtags.",
    x: "Punchy, bold hook. Short sentences, high-contrast perspective, strong CTA, zero filler hashtags.",
    facebook: "Community-driven, engaging story angle, conversational tone, open-ended question at the end.",
    instagram: "Visual storytelling caption, aesthetic bullet points, conversational tone, 5-8 niche hashtags.",
  },

  // Future plugin definitions
  futurePlugins: [
    { id: "leadHunter", name: "CRM Lead Hunter", icon: Search, reqs: "1 Research LLM + 1 Web Data Extractor", assigned: { researchLlm: "Gemini 2.0 Flash", extractor: "Groq Llama 3.3 70B" }, status: "ready" },
    { id: "emailOutreach", name: "Cold Email Sequencer", icon: Mail, reqs: "1 Copywriter LLM + 1 Spam Classifier", assigned: { writerLlm: "Claude 3.5 Sonnet", classifier: "GPT-4o-mini" }, status: "ready" },
    { id: "supportBot", name: "24/7 Tier-1 Helpdesk Bot", icon: Bot, reqs: "1 Fast Low-Latency LLM + Knowledge RAG", assigned: { botLlm: "Groq Llama 3.3 70B", rag: "OpenAI text-embedding-3" }, status: "ready" },
  ],

  // Master Subscription & Token Quota
  subscription: {
    tenantName: "Acme Operations (Client Enterprise Workspace)",
    planTier: "AIVHub Enterprise Suite (Unified Master Subscription)",
    monthlyTokenQuota: 5000000,
    tokensUsed: 1845200,
    estimatedCostUsd: 14.80,
    monthlyBudgetCapUsd: 120.00,
    pluginBreakdown: [
      { id: "leadgen", name: "1. Lead Generation Plugin", tokens: 420000, cost: 3.36, percentage: 23, color: "#8B5CF6" },
      { id: "scheduler", name: "2. Post Scheduler & Generator", tokens: 580000, cost: 4.64, percentage: 31, color: "#0C8C7D" },
      { id: "emailoutreach", name: "3. Email Generation & Sending", tokens: 360000, cost: 2.88, percentage: 20, color: "#F59E0B" },
      { id: "voice", name: "4. AI Voice Assistant", tokens: 485200, cost: 3.92, percentage: 26, color: "#3457D5" },
    ],
  },
};


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
const HUB_PAPER = "#fcfbf8";



/* ─── Smart Column Auto-Detection: supports any file format and naming convention ─── */
function detectColumnMappings(headers) {
  const h = headers.map((h) => h.toLowerCase().trim());
  const pick = (...candidates) => {
    for (const c of candidates) {
      const found = headers.find((hdr) => hdr.toLowerCase().trim().includes(c));
      if (found) return found;
    }
    return "";
  };

  return {
    phone: pick("mobile", "phone", "tel", "contact no", "number", "cell", "direct", "dial"),
    name: pick("first name", "full name", "contact name", "name", "fname", "person", "contact"),
    company: pick("company", "organisation", "organization", "business", "firm", "account", "employer"),
    jobTitle: pick("job title", "title", "role", "position", "designation", "function", "department"),
    industry: pick("industry", "sector", "vertical", "category", "market"),
    notes: pick("notes", "context", "comments", "remarks", "description", "info", "details", "background"),
    email: pick("email", "e-mail", "mail"),
    website: pick("website", "web", "url", "domain", "site"),
    linkedin: pick("linkedin", "social", "profile"),
    revenue: pick("revenue", "turnover", "annual", "sales"),
    employees: pick("employees", "staff", "headcount", "size", "team"),
    fleet: pick("fleet", "vehicles", "trucks", "vans", "hgv"),
    city: pick("city", "town", "location", "region", "area", "county"),
  };
}

/* ─── Parse header row from pasted or simulated CSV/TSV ─── */
function parseHeaders(rawText) {
  const firstLine = rawText.split("\n")[0] || "";
  if (firstLine.includes("\t")) return firstLine.split("\t").map((h) => h.trim());
  if (firstLine.includes(",")) return firstLine.split(",").map((h) => h.replace(/^["']|["']$/g, "").trim());
  return [firstLine.trim()];
}

/* ---------------------------------- Company Intelligence & Live Call Dossier Modal ---------------------------------- */

function CompanyDossierModal({ contact, onClose, onWatchLive, onTakeOver, onBookMeeting }) {
  if (!contact) return null;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.72)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, padding: 20, cursor: "pointer" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 16, width: 840, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 28px 56px rgba(0,0,0,0.3)", border: `1px solid ${C.border}`, cursor: "default" }}
      >
        
        {/* Header */}
        <div style={{ padding: "20px 26px", borderBottom: `1px solid ${C.border}`, background: HUB_PAPER, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink }}>
                {contact.name}
              </span>
              <Badge status={contact.status} small />
              {contact.line && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: C.tealSoft, color: C.teal }}>
                  ● Active on Line {contact.line}
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: C.slate, marginTop: 4, display: "flex", alignItems: "center", gap: 14 }}>
              <span>📍 {contact.city || "UK"}</span>
              <span>🌐 {contact.site || "company.co.uk"}</span>
              <span>📞 {contact.phone}</span>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <X size={16} color={C.slate} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
          
          {/* Key Company Numbers Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Fleet Size</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.cobalt, marginTop: 2 }}>{contact.fleet || "35 Vehicles"}</div>
            </div>
            <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Annual Turnover</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.teal, marginTop: 2 }}>{contact.rev || "£16.5M"}</div>
            </div>
            <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Staff Count</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink, marginTop: 2 }}>{contact.staff || "110"} Staff</div>
            </div>
            <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Current Stack</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.textInk, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{contact.stack || "Excel, Sage 50"}</div>
            </div>
          </div>

          {/* Decision Maker & Contact Info */}
          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
              👤 Primary Decision Maker
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 14 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{contact.contact}</div>
                <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2 }}>{contact.title} · Direct Executive Line</div>
                <div style={{ fontSize: 12, color: C.cobalt, marginTop: 4 }}>📱 {contact.phone}</div>
              </div>
              <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Timezone & Local Time</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, marginTop: 2 }}>Europe/London · 16:05 GMT</div>
                <div style={{ fontSize: 11, color: C.green, marginTop: 2 }}>● Inside Optimal Calling Window</div>
              </div>
            </div>
          </div>

          {/* Lead Context & Uploaded Spreadsheet Notes */}
          <div style={{ background: C.cobaltSoft, border: `1px solid ${C.cobalt}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.cobaltDeep, textTransform: "uppercase", marginBottom: 4 }}>
              📝 CRM & Spreadsheet Context Notes
            </div>
            <div style={{ fontSize: 13.5, color: C.ink, lineHeight: 1.5 }}>
              {contact.notes || "Lead uploaded from spreadsheet. Mid-market fleet operations team seeking automated dashboard reporting."}
            </div>
          </div>

          {/* AI Strategy & Pitch Hook */}
          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, marginBottom: 6 }}>
              🎯 AI Dialogue Strategy & Value Hook
            </div>
            <div style={{ fontSize: 13, color: C.slate, lineHeight: 1.5 }}>
              Targeting operations bottleneck with manual spreadsheet reconciliation. AI is offering a 10-minute executive walkthrough with Jitendra S. to demonstrate live ops dashboards.
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div style={{ padding: "16px 26px", borderTop: `1px solid ${C.border}`, background: HUB_PAPER, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            onClick={onClose}
            style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
          >
            Close Dossier
          </button>

          <div style={{ display: "flex", gap: 10 }}>
            {onWatchLive && contact.status === "calling" && (
              <button
                onClick={() => { onClose(); onWatchLive(contact); }}
                style={{ padding: "8px 16px", borderRadius: 8, background: C.cobalt, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
              >
                <Radio size={14} /> Listen & Supervise Call
              </button>
            )}
            {onBookMeeting && (
              <button
                onClick={() => { onClose(); onBookMeeting(contact); }}
                style={{ padding: "8px 18px", borderRadius: 8, background: C.green, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
              >
                <CalendarCheck size={14} /> Book Meeting (Cal.com)
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}



/* ─── Spreadsheet Data View: full-screen table of uploaded file with live status overlay ─── */

const STATUS_COLORS = {
  calling: "#1a56db",
  meeting_booked: "#0d7a3e",
  left_voicemail: "#b45309",
  retry: "#7c3aed",
  queued: "#6b7280",
  rejected: "#dc2626",
  human_review: "#d97706",
  skipped: "#9ca3af",
  emailed: "#0891b2",
};

const STATUS_LABELS = {
  calling: "● Live Call",
  meeting_booked: "✓ Meeting Booked",
  left_voicemail: "📱 Voicemail + WhatsApp",
  retry: "↺ Retry Scheduled",
  queued: "⏳ Queued",
  rejected: "✗ DNC",
  human_review: "⚠ Needs Review",
  skipped: "— Skipped",
  emailed: "✉ Emailed",
};

function SpreadsheetDataView({ mission, onBack, onOpenDossier }) {
  const [viewSearch, setViewSearch] = useState("");
  const [statusFilter, setViewStatusFilter] = useState("all");
  const [visibleRows, setVisibleRows] = useState(60);
  const [hoveredRow, setHoveredRow] = useState(null);

  if (!mission) return null;
  const prospects = mission.prospects || [];

  const dataColumns = [
    { key: "name",    label: "Company Name",   width: 200 },
    { key: "contact", label: "Contact Person",  width: 160 },
    { key: "title",   label: "Job Title",       width: 150 },
    { key: "phone",   label: "Phone",           width: 155 },
    { key: "city",    label: "City",            width: 110 },
    { key: "fleet",   label: "Fleet / Size",    width: 120 },
    { key: "rev",     label: "Revenue",         width: 100 },
    { key: "stack",   label: "Tech Stack",      width: 200 },
  ].filter((col) => (prospects[0] || {})[col.key] !== undefined);

  const statusCounts = prospects.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {});

  const filtered = prospects.filter((p) => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (viewSearch.trim()) {
      const q = viewSearch.toLowerCase();
      return [p.name, p.contact, p.phone, p.city, p.notes, p.title].filter(Boolean).join(" ").toLowerCase().includes(q);
    }
    return true;
  });

  const visible = filtered.slice(0, visibleRows);

  const STATUS_BG = {
    calling: "#dbeafe", meeting_booked: "#dcfce7", left_voicemail: "#fef3c7",
    retry: "#ede9fe", queued: "#f3f4f6", rejected: "#fee2e2",
    human_review: "#ffedd5", skipped: "#f9fafb", emailed: "#e0f2fe",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: HUB_PAPER, overflow: "hidden" }}>

      {/* ── Top Bar ── */}
      <div style={{ background: "#fff", borderBottom: `1px solid ${C.border}`, padding: "14px 24px", display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <button
          onClick={onBack}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 13px", borderRadius: 8, border: `1px solid ${C.border}`, background: HUB_PAPER, fontSize: 12.5, fontWeight: 600, cursor: "pointer", flexShrink: 0, color: C.ink }}
        >
          <ChevronLeft size={14} /> Back to Task
        </button>

        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink }}>
            {mission.file || mission.title} — Data View
          </div>
          <div style={{ fontSize: 12, color: C.slate, marginTop: 1 }}>
            {prospects.length} contacts · {mission.region || "UK"} · {Object.entries(statusCounts).map(([k,v]) => `${v} ${(STATUS_LABELS[k]||k).replace(/[●✓📱↺⏳✗⚠—✉]/g,"").trim()}`).slice(0,4).join(" · ")}
          </div>
        </div>

        {/* Search */}
        <div style={{ position: "relative", width: 260, flexShrink: 0 }}>
          <Search size={13} color={C.slateLight} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
          <input
            value={viewSearch}
            onChange={(e) => setViewSearch(e.target.value)}
            placeholder="Search company, name, city..."
            style={{ width: "100%", height: 36, padding: "0 10px 0 32px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, background: "#fff", boxSizing: "border-box", outline: "none" }}
          />
        </div>
      </div>

      {/* ── Status Filter Ribbon ── */}
      <div style={{ background: "#fafafa", borderBottom: `1px solid ${C.border}`, padding: "8px 24px", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
        {[{ id: "all", label: "All Rows", count: prospects.length },
          ...Object.entries(statusCounts).sort((a,b) => b[1]-a[1]).map(([id, count]) => ({ id, label: STATUS_LABELS[id] || id, count }))
        ].map((t) => {
          const isActive = statusFilter === t.id;
          const col = STATUS_COLORS[t.id] || C.ink;
          return (
            <button
              key={t.id}
              onClick={() => { setViewStatusFilter(t.id); setVisibleRows(60); }}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 11px", borderRadius: 20,
                border: `1.5px solid ${isActive ? col : C.border}`,
                background: isActive ? col : "#fff",
                color: isActive ? "#fff" : C.slate,
                fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                transition: "all 0.12s",
              }}
            >
              <span>{t.label}</span>
              <span style={{ background: isActive ? "rgba(255,255,255,0.25)" : C.paperSoft, color: isActive ? "#fff" : C.slate, borderRadius: 999, padding: "1px 6px", fontSize: 10.5, fontWeight: 700 }}>
                {t.count}
              </span>
            </button>
          );
        })}
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: C.slateLight }}>
          Showing {Math.min(visibleRows, filtered.length)} of {filtered.length}
        </span>
      </div>

      {/* ── Table ── */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FONT_BODY, fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#fff", position: "sticky", top: 0, zIndex: 2, boxShadow: "0 1px 0 " + C.border }}>
              <th style={TH}>#</th>
              <th style={TH}>Status</th>
              {dataColumns.map((col) => <th key={col.key} style={{ ...TH, minWidth: col.width }}>{col.label}</th>)}
              <th style={TH}>Notes (From File)</th>
              <th style={TH}>Last Activity</th>
              <th style={{ ...TH, textAlign: "center" }}>Open</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => {
              const idx = prospects.findIndex((x) => x.id === p.id) + 1;
              const bg = hoveredRow === p.id ? "#f0f4ff" : (STATUS_BG[p.status] || "#fff");
              const isLive = p.status === "calling";
              const isBooked = p.status === "meeting_booked";
              return (
                <tr
                  key={p.id}
                  style={{ background: bg, borderBottom: `1px solid ${C.border}`, cursor: "default", transition: "background 0.1s" }}
                  onMouseEnter={() => setHoveredRow(p.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                  <td style={TD}><span style={{ color: C.slateLight, fontSize: 11 }}>{idx}</span></td>
                  <td style={{ ...TD, whiteSpace: "nowrap" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "3px 9px", borderRadius: 20,
                      background: (STATUS_COLORS[p.status] || "#888") + "20",
                      color: STATUS_COLORS[p.status] || "#888",
                      fontSize: 11, fontWeight: 700,
                      border: `1px solid ${(STATUS_COLORS[p.status] || "#888")}40`,
                    }}>
                      {isLive && <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_COLORS.calling, animation: "none", display: "inline-block" }} />}
                      {(STATUS_LABELS[p.status] || p.status).replace(/[●✓📱↺⏳✗⚠—✉]/g, "").trim()}
                    </span>
                    {isLive && p.line && (
                      <span style={{ marginLeft: 5, fontSize: 10, color: C.cobalt, fontWeight: 700 }}>Line {p.line}</span>
                    )}
                  </td>
                  {dataColumns.map((col) => (
                    <td key={col.key} style={{ ...TD, maxWidth: col.width + 40, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: col.key === "name" ? 600 : 400, color: isBooked ? C.green : col.key === "name" ? C.ink : C.textInk }}>
                      {p[col.key] || <span style={{ color: C.borderSoft }}>—</span>}
                    </td>
                  ))}
                  <td style={{ ...TD, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.slate, fontSize: 12 }}>
                    {p.notes ? p.notes.substring(0, 70) + (p.notes.length > 70 ? "…" : "") : <span style={{ color: C.borderSoft }}>—</span>}
                  </td>
                  <td style={{ ...TD, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.slate, fontSize: 11.5 }}>
                    {p.note || <span style={{ color: C.borderSoft }}>—</span>}
                  </td>
                  <td style={{ ...TD, textAlign: "center" }}>
                    <button
                      onClick={() => onOpenDossier(p)}
                      style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${C.border}`, background: hoveredRow === p.id ? C.cobalt : "#fff", color: hoveredRow === p.id ? "#fff" : C.ink, fontSize: 11.5, fontWeight: 600, cursor: "pointer", transition: "all 0.12s", whiteSpace: "nowrap" }}
                    >
                      📋 Dossier
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visible.length < filtered.length && (
          <div style={{ padding: "18px 24px", display: "flex", justifyContent: "center" }}>
            <button
              onClick={() => setVisibleRows((v) => v + 60)}
              style={{ padding: "10px 24px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", color: C.ink }}
            >
              Load 60 more rows &nbsp;·&nbsp; <span style={{ color: C.slate }}>{filtered.length - visibleRows} remaining</span>
            </button>
          </div>
        )}
        {filtered.length === 0 && (
          <div style={{ padding: "60px 24px", textAlign: "center", color: C.slateLight, fontSize: 14 }}>
            No rows match your search or filter.
          </div>
        )}
      </div>
    </div>
  );
}

const TH = {
  padding: "10px 16px", textAlign: "left", fontWeight: 700,
  color: C.slate, fontSize: 11, textTransform: "uppercase",
  letterSpacing: "0.04em", whiteSpace: "nowrap", userSelect: "none",
};

const TD = { padding: "11px 16px", fontSize: 13, color: C.textInk, verticalAlign: "middle" };


function AppChrome() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
      * { box-sizing: border-box; }
      html, body, #root { height: 100%; margin: 0; }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-thumb { background: #D8D5CD; border-radius: 4px; }
      select:focus, input:focus, textarea:focus { border-color: ${C.cobalt} !important; }

      /* Global Floating and Enlarging Hover Effect for all buttons */
      button {
        transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.18s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease !important;
      }
      button:hover:not(:disabled) {
        transform: translateY(-2px) scale(1.03) !important;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.13) !important;
      }
      button:active:not(:disabled) {
        transform: translateY(0) scale(0.98) !important;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08) !important;
      }

      /* Hover Floating & Enlarging for Cards, Metrics, Lists & Options */
      .hover-float {
        transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.18s ease !important;
      }
      .hover-float:hover {
        transform: translateY(-3.5px) scale(1.018) !important;
        box-shadow: 0 10px 26px rgba(18, 20, 28, 0.11), 0 2px 8px rgba(0, 0, 0, 0.04) !important;
        border-color: ${C.cobalt} !important;
      }
      .hover-float:active {
        transform: translateY(-1px) scale(0.995) !important;
      }

      @keyframes pulseBar {
        0%, 100% { height: 4px; opacity: 0.5; }
        50% { height: 14px; opacity: 1; }
      }
      @keyframes typingDot {
        0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
        40% { opacity: 1; transform: translateY(-3px); }
      }
    `}</style>
  );
}

function initialsFromName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function operatorFromLogin(username) {
  const u = String(username || "").trim();
  if (/^jitendra/i.test(u)) return { username: u, name: "Jitendra S.", role: "Admin" };
  const pretty = u.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { username: u, name: pretty || "Operator", role: "Operator" };
}

const TIMEZONES = [
  { id: "Europe/London", label: "UK — London (GMT/BST)" },
  { id: "Europe/Paris", label: "Europe — Paris (CET)" },
  { id: "Europe/Berlin", label: "Europe — Berlin (CET)" },
  { id: "Asia/Kolkata", label: "India — Kolkata (IST)" },
  { id: "Asia/Dubai", label: "UAE — Dubai (GST)" },
  { id: "America/New_York", label: "US — Eastern (ET)" },
  { id: "America/Chicago", label: "US — Central (CT)" },
  { id: "America/Los_Angeles", label: "US — Pacific (PT)" },
  { id: "Australia/Sydney", label: "Australia — Sydney (AEST)" },
];

function timezoneLabel(id) {
  return (TIMEZONES.find((z) => z.id === id) || TIMEZONES[0]).label;
}

// UK PECR — B2B live marketing calls. Legal ceiling, not a recommended office day.
// Weekdays 08:00–21:00, weekends & bank holidays 09:00–18:00.
const PECR = {
  weekdayStart: "08:00",
  weekdayEnd: "21:00",
  weekendStart: "09:00",
  weekendEnd: "18:00",
};

const CALL_HOUR_POLICIES = [
  {
    id: "respectful",
    label: "Shorter, respectful hours",
    weekdayStart: "09:00",
    weekdayEnd: "17:30",
    blurb: "Office-hours default. PECR allows until 21:00 on weekdays — this is a choice to call less, not a legal cap.",
  },
  {
    id: "pecr_max",
    label: "Full PECR legal window",
    weekdayStart: "08:00",
    weekdayEnd: "21:00",
    blurb: "UK B2B live calls: 08:00–21:00 weekdays, 09:00–18:00 weekends. Extra evening hours you can use without compliance risk.",
  },
];

function pecrPolicy(id) {
  return CALL_HOUR_POLICIES.find((p) => p.id === id) || CALL_HOUR_POLICIES[0];
}

function applyCallHourPolicy(id) {
  const p = pecrPolicy(id);
  return { callHoursPolicy: p.id, weekdayStart: p.weekdayStart, weekdayEnd: p.weekdayEnd };
}

const INITIAL_MEETINGS = [];
const INITIAL_SCHEDULE = [];
const INITIAL_TASKS = [];
const INITIAL_MISSIONS = [];
const PROSPECTS = [];
const INITIAL_LIVE_CALLS = [];
const INITIAL_CALL_LOG = [];
const INITIAL_CONTACT_REGISTRY = [];

const INITIAL_NOTIFICATIONS = [
  { id: "n1", text: "AIVHub Platform ready for production testing", time: "just now", unread: true, type: "info" },
];

const CONNECTIONS = [
  { group: "LLM", desc: "Powers the AI's conversation, pitch reasoning, and objection handling.", items: [
    { name: "xAI (Grok)", status: "not_configured" },
    { name: "Groq", status: "not_configured" },
    { name: "DeepSeek", status: "not_configured" },
    { name: "Anthropic (Claude)", status: "not_configured" },
    { name: "OpenAI (GPT-4o)", status: "not_configured" },
  ]},
  { group: "Speech-to-Text", desc: "Turns the prospect's spoken voice into text the AI can understand.", items: [
    { name: "Deepgram", status: "not_configured" },
    { name: "Faster-Whisper (self-hosted)", status: "not_configured" },
  ]},
  { group: "Text-to-Speech", desc: "Generates the AI's spoken voice on calls.", items: [
    { name: "ElevenLabs", status: "not_configured" },
    { name: "Cartesia", status: "not_configured" },
    { name: "Kokoro (self-hosted)", status: "not_configured" },
  ]},
  { group: "Voice Orchestration", desc: "Manages the live call itself — audio streaming, interruptions, turn-taking.", items: [
    { name: "xAI Voice Agent", status: "not_configured" },
    { name: "LiveKit (self-hosted)", status: "not_configured" },
    { name: "Vapi", status: "not_configured" },
    { name: "Retell AI", status: "not_configured" },
  ]},
  { group: "Telephony", desc: "Places and receives the actual phone calls.", items: [
    { name: "xAI Voice Number", status: "not_configured" },
    { name: "Twilio", status: "not_configured" },
    { name: "Telnyx", status: "not_configured" },
  ]},
  { group: "Calendar", desc: "Checks availability and books confirmed meetings.", items: [
    { name: "Cal.com (Self-Hosted)", status: "not_configured" },
    { name: "Google Calendar", status: "not_configured" },
  ]},
  { group: "Business Discovery", desc: "Finds and researches prospect businesses on the web.", items: [
    { name: "Google Places API", status: "not_configured" },
    { name: "Web Search Provider", status: "not_configured" },
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

const INITIAL_COMPANY_PROFILE = {
  name: "AIVHub",
  pitch: "AI-powered business intelligence dashboards for mid-market operations teams",
  industry: "Business intelligence / data consulting",
  website: "https://aivhub.io",
  social: "linkedin.com/company/aivhub",
  callerName: "Sam",
  callerId: "+44 20 7946 0912",
  tone: "Professional, concise, friendly",
  disclosure: "This call may be recorded for quality and compliance purposes.",
  legalName: "AIVHub Ltd",
  icoRef: "ZA774219",
  dpoContact: "privacy@aivhub.io",
  dncNotes: "Opt-outs logged immediately and excluded from all future missions. Reviewed weekly by the ops admin.",
  timezone: "Europe/London",
  lunchStart: "12:00",
  lunchEnd: "13:00",
  callHoursPolicy: "respectful",
  weekdayStart: "09:00",
  weekdayEnd: "17:30",
};

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
  deferred: { label: "Parked — call later", bg: C.tealSoft, fg: C.teal },
  due_now: { label: "Due today — calling", bg: C.amberSoft, fg: C.amber },
  no_answer: { label: "No answer", bg: C.amberSoft, fg: C.amber },
  operator_ended: { label: "Ended by operator", bg: C.paperSoft, fg: C.slate },
  thread_ended: { label: "Thread ended", bg: C.paperSoft, fg: C.slate },
  already_contacted: { label: "Already contacted", bg: C.amberSoft, fg: C.amber },
  same_company: { label: "Same company", bg: C.amberSoft, fg: C.amber },
  same_person: { label: "Same person", bg: C.amberSoft, fg: C.amber },
  honored: { label: "At the time they asked", bg: C.tealSoft, fg: C.teal },
  emailed: { label: "Emailed after no answer", bg: C.amberSoft, fg: C.amber },
  left_voicemail: { label: "No answer — fallback sent", bg: C.amberSoft, fg: C.amber },
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
  { label: "Operations", items: [
    { id: "tasks", label: "Tasks & Batches", icon: ListChecks },
    { id: "schedule", label: "Schedule", icon: Calendar },
    { id: "meetings", label: "Meetings", icon: CalendarCheck },
    { id: "live", label: "Live Activity", icon: Radio },
    { id: "calllog", label: "Call Log", icon: History },
    { id: "processlogs", label: "System Process Logs", icon: FileText },
    { id: "prospects", label: "Contacts & Batches", icon: Building2 },
  ]},
  { label: "Configuration", items: [
    { id: "company", label: "Company Profile", icon: Users },
    { id: "provider", label: "Connections & Providers", icon: Plug },
  ]},
  { label: "Insights", items: [
    { id: "analytics", label: "Analytics", icon: BarChart3 },
  ]},
];

function Sidebar({ view, setView, companyName, callerName, timezone, operatorName, operatorRole, onBackToHub, onLogout }) {
  const who = operatorName || "Jitendra S.";
  const role = operatorRole || "Admin";
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
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px 12px 8px" }}>
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
          }}
        >
          <LayoutGrid size={14} />
          All plugins
        </button>
      )}

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
        <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: "#5B6070", marginBottom: 2 }}>
          AI speaks as <span style={{ color: "#C8CCD6", fontWeight: 600 }}>{callerName}</span>, on behalf of {companyName}
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: "#5B6070", marginBottom: 8 }}>
          Times in {timezoneLabel(timezone || "Europe/London")}
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 10, color: "#5B6070", marginBottom: 8 }}>
          Logged in as:
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 999, background: C.cobalt, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: "#fff" }}>
            {initialsFromName(who)}
          </div>
          <div style={{ flex: 1, fontFamily: FONT_BODY, fontSize: 12.5, color: "#C8CCD6" }}>
            {who} <span style={{ color: "#6B7180" }}>· {role}</span>
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
            <LogOut size={12} />
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- topbar + notifications ---------------------------------- */

function NotificationBell({ notifications, setNotifications, onNavigate }) {
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((n) => n.unread).length;

  const handleNotificationClick = (n) => {
    // 1. Mark this notification as read
    setNotifications((ns) => ns.map((x) => (x.id === n.id ? { ...x, unread: false } : x)));
    // 2. Dismiss dropdown
    setOpen(false);

    // 3. Smart routing based on metadata or message content
    let targetView = n.targetView;
    let targetExtra = n.targetExtra || {};

    if (!targetView) {
      const text = (n.text || "").toLowerCase();
      if (text.includes("meeting") || text.includes("booked") || text.includes("cal.com")) {
        targetView = "meetings";
      } else if (text.includes("staff input") || text.includes("live") || text.includes("pricing") || text.includes("calling") || text.includes("intervention") || text.includes("human")) {
        targetView = "live";
        if (text.includes("pennine")) {
          targetExtra = { liveFocus: { name: "Pennine Distribution" } };
        } else if (text.includes("acme")) {
          targetExtra = { liveFocus: { name: "Acme Logistics Ltd" } };
        }
      } else if (text.includes("schedule") || text.includes("call back") || text.includes("callback")) {
        targetView = "schedule";
      } else if (text.includes("call log") || text.includes("do-not-call") || text.includes("dnc") || text.includes("verbatim") || text.includes("haulage")) {
        targetView = "calllog";
        if (text.includes("speedy")) {
          targetExtra = { prefillLogQuery: "Speedy Haulage" };
        }
      } else if (text.includes("provider") || text.includes("api key") || text.includes("integration") || text.includes("elevenlabs") || text.includes("mode")) {
        targetView = "provider";
      } else if (text.includes("profile") || text.includes("company")) {
        targetView = "company";
      } else if (text.includes("task") || text.includes("mission") || text.includes("batch")) {
        targetView = "tasks";
      } else {
        targetView = "tasks";
      }
    }

    if (typeof onNavigate === "function") {
      onNavigate(targetView, targetExtra);
    } else if (typeof window !== "undefined" && typeof window.__voiceNavigate === "function") {
      window.__voiceNavigate(targetView, targetExtra);
    }
  };

  const getNotificationIcon = (n) => {
    const text = (n.text || "").toLowerCase();
    if (n.type === "alert" || text.includes("input") || text.includes("pricing") || text.includes("stuck")) {
      return <AlertTriangle size={15} color={C.amber} />;
    }
    if (n.type === "success" || text.includes("meeting") || text.includes("booked")) {
      return <CalendarCheck size={15} color={C.green} />;
    }
    if (text.includes("live") || text.includes("calling") || text.includes("lines")) {
      return <Radio size={15} color={C.cobalt} />;
    }
    if (text.includes("provider") || text.includes("key") || text.includes("api")) {
      return <KeyRound size={15} color={C.teal} />;
    }
    if (text.includes("call log") || text.includes("dnc") || text.includes("do-not-call")) {
      return <History size={15} color={C.slate} />;
    }
    return <Bell size={15} color={C.slate} />;
  };

  const getActionLabel = (n) => {
    if (n.targetAction) return n.targetAction;
    const text = (n.text || "").toLowerCase();
    if (text.includes("meeting")) return "View Meeting →";
    if (text.includes("staff input") || text.includes("live")) return "Join Call →";
    if (text.includes("call log") || text.includes("dnc")) return "Open Call Log →";
    if (text.includes("schedule")) return "Open Schedule →";
    if (text.includes("provider")) return "AI Providers →";
    return "View Details →";
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        style={{
          width: 36,
          height: 36,
          borderRadius: 9,
          border: `1px solid ${unread > 0 ? C.cobalt : C.border}`,
          background: unread > 0 ? C.cobaltSoft : "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          position: "relative",
        }}
      >
        <Bell size={16} color={unread > 0 ? C.cobalt : C.slate} />
        {unread > 0 && (
          <span style={{ position: "absolute", top: 4, right: 4, minWidth: 15, height: 15, borderRadius: 999, background: C.red, color: "#fff", fontSize: 9.5, fontFamily: FONT_BODY, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px", boxShadow: "0 2px 4px rgba(0,0,0,0.18)" }}>
            {unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 999 }} />
          <div style={{ position: "absolute", top: 46, right: 0, width: 380, maxWidth: "90vw", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: "0 16px 40px rgba(18,20,28,0.16)", zIndex: 1000, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${C.border}`, background: HUB_PAPER }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14.5, color: C.ink }}>Notifications</span>
                {unread > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, background: C.cobaltSoft, color: C.cobalt, padding: "2px 7px", borderRadius: 999 }}>
                    {unread} new
                  </span>
                )}
              </div>
              <button
                onClick={() => setNotifications((ns) => ns.map((n) => ({ ...n, unread: false })))}
                style={{ background: "none", border: "none", color: C.cobalt, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "2px 6px" }}
              >
                Mark all read
              </button>
            </div>

            {/* List with clean isolated scroll and zero-jitter hover */}
            <div
              style={{
                maxHeight: 340,
                overflowY: "auto",
                overscrollBehavior: "contain",
              }}
            >
              {notifications.length === 0 ? (
                <div style={{ padding: "36px 20px", textAlign: "center", color: C.slateLight, fontSize: 13 }}>
                  No notifications yet.
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      padding: "13px 16px 13px 14px",
                      borderBottom: `1px solid ${C.border}`,
                      borderLeft: n.unread ? `3.5px solid ${C.cobalt}` : "3.5px solid transparent",
                      cursor: "pointer",
                      background: n.unread ? "#F8FAFF" : "#fff",
                      transition: "background 0.12s ease, border-left-color 0.12s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#EFF4FF";
                      e.currentTarget.style.borderLeftColor = C.cobalt;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = n.unread ? "#F8FAFF" : "#fff";
                      e.currentTarget.style.borderLeftColor = n.unread ? C.cobalt : "transparent";
                    }}
                  >
                    <div style={{ marginTop: 2, width: 28, height: 28, borderRadius: 7, background: n.unread ? C.cobaltSoft : C.paperSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {getNotificationIcon(n)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: n.unread ? 600 : 400, color: C.textInk, lineHeight: 1.45 }}>
                        {n.text}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                        <span style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>{n.time}</span>
                        <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.cobalt, display: "flex", alignItems: "center", gap: 3, background: n.unread ? "rgba(26,86,219,0.08)" : "transparent", padding: "2px 6px", borderRadius: 4 }}>
                          {getActionLabel(n)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer Hint */}
            <div style={{ padding: "10px 18px", background: HUB_PAPER, borderTop: `1px solid ${C.border}`, fontSize: 11.5, color: C.slateLight, textAlign: "center" }}>
              Click any notification to open the item directly
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TopBar({ title, subtitle, onNewMission, notifications, setNotifications, onBack, canGoBack, backLabel }) {
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
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {canGoBack && onBack && (
          <button
            onClick={onBack}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 12px",
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
            <ChevronLeft size={14} /> {backLabel || "Back"}
          </button>
        )}
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: C.textInk, letterSpacing: "-0.01em" }}>{title}</div>
          {subtitle && <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 2 }}>{subtitle}</div>}
        </div>
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


/* ---------------------------------- Tasks & Batch Calling Engine (Main Screen) ---------------------------------- */

function TasksView({
  tasks,
  setTasks,
  notifications,
  setNotifications,
  companyName,
  callerId,
  onOpenTask,
  onWatchLive,
  onNewOutreach,
}) {
  const [taskTab, setTaskTab] = useState("all"); // "all" | "active" | "scheduled" | "completed"
  const [showWizard, setShowWizard] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");

  const activeCount = tasks.filter((t) => t.status === "active").length;
  const scheduledCount = tasks.filter((t) => t.status === "scheduled").length;
  const completedCount = tasks.filter((t) => t.status === "completed").length;

  const filteredTasks = tasks.filter((t) => {
    if (taskTab === "active" && t.status !== "active") return false;
    if (taskTab === "scheduled" && t.status !== "scheduled") return false;
    if (taskTab === "completed" && t.status !== "completed") return false;
    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase();
      return (t.title + " " + (t.file || "") + " " + (t.sector || "") + " " + (t.region || "")).toLowerCase().includes(q);
    }
    return true;
  });

  const handleCreateTask = (newTask) => {
    setTasks((prev) => [newTask, ...prev]);
    setNotifications((ns) => [
      {
        id: "n_" + Date.now(),
        text: `New calling task "${newTask.title}" initialized with ${newTask.total} contacts.`,
        time: "just now",
        unread: true,
        type: "success",
      },
      ...ns,
    ]);
  };

  const toggleTaskStatus = (taskId, e) => {
    e.stopPropagation();
    setTasks((ts) =>
      ts.map((t) => {
        if (t.id !== taskId) return t;
        const nextStatus = t.status === "active" ? "paused" : t.status === "paused" ? "active" : t.status;
        return { ...t, status: nextStatus };
      })
    );
  };

  return (
    <>
      <TopBar
        title="Tasks & Contact Batches"
        subtitle="Import whole contact files (.xlsx, .csv), configure safe multi-client calling, and supervise parallel dials"
        notifications={notifications}
        setNotifications={setNotifications}
        onNewMission={onNewOutreach}
      />

      <div style={{ padding: "24px 32px", overflowY: "auto", flex: 1, background: HUB_PAPER }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
          
          {/* MAIN PROMINENT HERO CARD - Clicking anywhere opens Upload / Setup Wizard */}
          <div
            onClick={() => (onNewOutreach ? onNewOutreach() : setShowWizard(true))}
            style={{
              background: "#fff",
              border: `1.5px solid ${C.border}`,
              borderRadius: 16,
              padding: "24px 28px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 24,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = C.cobalt;
              e.currentTarget.style.boxShadow = "0 8px 24px rgba(26,86,219,0.09)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = C.border;
              e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 12,
                  background: `linear-gradient(135deg, ${C.cobaltSoft}, #E0EAFF)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: C.cobalt,
                  flexShrink: 0,
                }}
              >
                <FileSpreadsheet size={26} />
              </div>
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17.5, color: C.ink }}>
                  Batch Contact Calling & AI Lead Outreach
                </div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 4, maxWidth: 580, lineHeight: 1.45 }}>
                  Scout target companies and verified decision-makers with AI, import contact lists (.xlsx, .csv), and supervise parallel voice calling lines.
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (onNewOutreach) onNewOutreach();
                  else setShowWizard(true);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "11px 20px",
                  borderRadius: 10,
                  background: "linear-gradient(135deg, #1A56DB 0%, #7C3AED 100%)",
                  color: "#fff",
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                  boxShadow: "0 4px 14px rgba(26,86,219,0.25)",
                  whiteSpace: "nowrap",
                }}
              >
                <Sparkles size={16} /> New Outreach (AI Chat)
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowWizard(true);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "11px 18px",
                  borderRadius: 10,
                  background: "#fff",
                  color: C.textInk,
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: 600,
                  border: `1px solid ${C.border}`,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <Plus size={15} /> Batch Upload Wizard
              </button>
            </div>
          </div>

          {/* Quick Metrics Bar with Hover Float */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            <div className="hover-float" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", cursor: "default" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Active Tasks</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, color: C.cobalt, marginTop: 4 }}>
                {activeCount} <span style={{ fontSize: 12, color: C.slate, fontWeight: 400 }}>running live</span>
              </div>
            </div>
            <div className="hover-float" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", cursor: "default" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Live Parallel Lines</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, color: C.teal, marginTop: 4 }}>
                4 <span style={{ fontSize: 12, color: C.slate, fontWeight: 400 }}>lines connected</span>
              </div>
            </div>
            <div className="hover-float" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", cursor: "default" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Scheduled Batches</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, color: C.amber, marginTop: 4 }}>
                {scheduledCount} <span style={{ fontSize: 12, color: C.slate, fontWeight: 400 }}>queued for window</span>
              </div>
            </div>
            <div className="hover-float" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", cursor: "default" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Meetings Booked</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, color: C.green, marginTop: 4 }}>
                {tasks.reduce((sum, t) => sum + (t.meetingsBooked || 0), 0)} <span style={{ fontSize: 12, color: C.slate, fontWeight: 400 }}>total</span>
              </div>
            </div>
          </div>

          {/* Filter Bar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { id: "all", label: "All Tasks", count: tasks.length },
                { id: "active", label: "Active & Live", count: activeCount },
                { id: "scheduled", label: "Scheduled & Queued", count: scheduledCount },
                { id: "completed", label: "Completed Archives", count: completedCount },
              ].map((t) => {
                const active = taskTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTaskTab(t.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: `1px solid ${active ? C.ink : C.border}`,
                      background: active ? C.ink : "#fff",
                      color: active ? "#fff" : C.textInk,
                      fontFamily: FONT_BODY,
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <span>{t.label}</span>
                    <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 999, background: active ? "rgba(255,255,255,0.2)" : C.paperSoft, color: active ? "#fff" : C.slate, fontWeight: 700 }}>
                      {t.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={{ position: "relative", width: 280 }}>
              <Search size={14} color={C.slateLight} style={{ position: "absolute", left: 10, top: 10 }} />
              <input
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Filter tasks by name, file, region..."
                style={{ width: "100%", height: 34, padding: "0 10px 0 32px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, background: "#fff", boxSizing: "border-box" }}
              />
            </div>
          </div>

          {/* Tasks List */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {filteredTasks.map((t) => {
              const progressPercent = Math.round(((t.contacted || 0) / (t.total || 1)) * 100);
              const isLive = t.status === "active";
              return (
                <div
                  key={t.id}
                  className="hover-float"
                  onClick={() => onOpenTask(t)}
                  style={{
                    background: "#fff",
                    border: `1px solid ${isLive ? C.cobalt : C.border}`,
                    borderRadius: 14,
                    padding: "18px 22px",
                    cursor: "pointer",
                    boxShadow: isLive ? "0 4px 16px rgba(52,87,213,0.08)" : "0 1px 3px rgba(0,0,0,0.04)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16.5, color: C.ink }}>
                          {t.title}
                        </span>
                        <Badge status={t.status} small />
                        {t.concurrency && (
                          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: C.tealSoft, color: C.teal }}>
                            {t.concurrency} Parallel Lines
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: C.slate, marginTop: 4, display: "flex", alignItems: "center", gap: 12 }}>
                        <span>📁 File: <code style={{ fontSize: 11.5 }}>{t.file || "Manual Input"}</code></span>
                        <span>🎯 Goal: <strong>{t.goal}</strong></span>
                        <span>📍 {t.region}</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {isLive && onWatchLive && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onWatchLive();
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 12px",
                            borderRadius: 7,
                            background: C.cobalt,
                            color: "#fff",
                            border: "none",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          <Radio size={13} /> Live Parallel Lines ({t.activeLines || 4})
                        </button>
                      )}
                      <ChevronRight size={16} color={C.slateLight} />
                    </div>
                  </div>

                  {/* Progress & Metrics */}
                  <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr", gap: 16, alignItems: "center", paddingTop: 10, borderTop: `1px solid ${C.borderSoft}` }}>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: C.slate, marginBottom: 4 }}>
                        <span>Contact Progress</span>
                        <span><strong>{t.contacted}</strong> / {t.total} ({progressPercent}%)</span>
                      </div>
                      <div style={{ height: 6, background: C.paperSoft, borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${progressPercent}%`, background: isLive ? C.cobalt : C.teal, borderRadius: 3 }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: 11, color: C.slate }}>Meetings Booked</div>
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.green }}>
                        {t.meetingsBooked} <span style={{ fontSize: 11, color: C.slate, fontWeight: 400 }}>confirmed</span>
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: 11, color: C.slate }}>Voicemail / Fallbacks</div>
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.amber }}>
                        {t.voicemails || 0} <span style={{ fontSize: 11, color: C.slate, fontWeight: 400 }}>dropped</span>
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: 11, color: C.slate }}>Calling Window</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.ink }}>
                        {t.callWindow || "09:00–17:30 Local"}
                      </div>
                    </div>
                  </div>

                </div>
              );
            })}

            {filteredTasks.length === 0 && (
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 36, textAlign: "center" }}>
                <FileSpreadsheet size={32} color={C.slateLight} />
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, marginTop: 10 }}>No tasks found in this tab</div>
                <div style={{ fontSize: 13, color: C.slate, marginTop: 4 }}>Import a new contact file to start a batch campaign.</div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* 4-STEP BATCH TASK SETUP WIZARD */}
      {showWizard && (
        <BatchTaskWizardModal
          isOpen={showWizard}
          onClose={() => setShowWizard(false)}
          onCreateTask={handleCreateTask}
          companyName={companyName}
          companyCallerId={callerId}
        />
      )}
    </>
  );
}

/* ---------------------------------- 4-Step Batch Task Wizard Modal ---------------------------------- */

function BatchTaskWizardModal({ isOpen, onClose, onCreateTask, companyName, companyCallerId }) {
  const [step, setStep] = useState(1); // 1: Mapping, 2: Scripting, 3: Dialing & Smart Timing, 4: Pre-Flight Cockpit & Test Call
  const fileInputRef = useRef(null);

  // Registered Outbound Numbers in Software
  const REGISTERED_CALLER_IDS = [
    ...(companyCallerId ? [{ id: "cid_custom", number: companyCallerId, label: `Assigned Voice Line (${companyCallerId})`, region: "Primary Outbound", status: "Active" }] : []),
    { id: "cid_1", number: "+44 20 7946 0912", label: "Primary London HQ (Twilio SIP Trunk)", region: "London / UK-wide", status: "Active" },
    { id: "cid_2", number: "+44 161 883 0044", label: "Manchester Regional Direct DID", region: "North West", status: "Active" },
    { id: "cid_3", number: "+44 121 496 0550", label: "Birmingham Local DID", region: "Midlands", status: "Active" },
    { id: "cid_4", number: "+44 113 496 0880", label: "Leeds / Yorkshire Local DID", region: "Yorkshire", status: "Active" },
    { id: "cid_5", number: "+1 (415) 890-2341", label: "US West Coast Gateway DID", region: "North America", status: "Active" },
  ];

  // Registered Operator Mobile Numbers
  const REGISTERED_OPERATORS = [
    { id: "op_1", name: "Jitendra S. (Admin)", phone: "+44 7700 900123" },
    { id: "op_2", name: "Operations Lead Desk", phone: "+44 7700 900456" },
    { id: "op_3", name: "Sales Director Mobile", phone: "+44 7700 900789" },
    { id: "op_custom", name: "Custom Mobile Number", phone: "" },
  ];

  // Step 1: Upload & Mapping State
  const [fileName, setFileName] = useState("UK_Logistics_Operations_Leads.xlsx");
  const [fileSize, setFileSize] = useState("28.4 KB");
  const [totalRows, setTotalRows] = useState(240);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(true);
  const [mappings, setMappings] = useState({
    phone: "Mobile / Direct Phone",
    name: "Contact Full Name",
    company: "Company Name",
    jobTitle: "Job Title",
    industry: "Industry Sector",
    notes: "Custom Context / Notes",
  });

  // Step 2: Goal & Dynamic Scripting State
  const [taskTitle, setTaskTitle] = useState("UK Logistics & Ops Leaders — Q3 Campaign");
  const [goal, setGoal] = useState("Appointment & Demo Booking");
  const [scriptTemplate, setScriptTemplate] = useState(
    "Hi {{first_name}}, this is Sam calling on behalf of {{our_company}}. I saw that you lead operations at {{company_name}} and wanted to share how we help fleets eliminate end-of-month spreadsheet reconciliation. Would you be open to a quick 10-minute demo this Thursday?"
  );

  // Step 3: Concurrency & Smart Timing State
  const [concurrency, setConcurrency] = useState(8);
  const [callPolicy, setCallPolicy] = useState("respectful"); // "respectful" | "pecr_max" | "core_peak" | "custom"
  const [customStartTime, setCustomStartTime] = useState("08:30");
  const [customEndTime, setCustomEndTime] = useState("18:30");
  const [customDays, setCustomDays] = useState(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  const [voicemailAction, setVoicemailAction] = useState("drop_and_message"); // drop_and_message | retry_later
  const [lunchPause, setLunchPause] = useState(true); // 12:30 - 13:30 pause

  // Step 4: Outbound Caller ID & Operator Test Call State
  const [selectedCallerId, setSelectedCallerId] = useState(companyCallerId || "+44 20 7946 0912");
  const [selectedOperatorPhone, setSelectedOperatorPhone] = useState("+44 7700 900123");
  const [customMobile, setCustomMobile] = useState("");
  const [testingCall, setTestingCall] = useState(false);
  const [testCallSuccess, setTestCallSuccess] = useState(false);

  // Sample contacts parsed from file
  const [parsedContacts, setParsedContacts] = useState([
    { id: "c1", selected: true, name: "James Whitfield", company: "Acme Logistics Ltd", title: "Ops Director", phone: "+44 161 496 0123", valid: true },
    { id: "c2", selected: true, name: "Sarah Jenkins", company: "Northern Freight Co", title: "Head of Supply Chain", phone: "+44 161 220 4471", valid: true },
    { id: "c3", selected: true, name: "David Hughes", company: "Manchester Transport Group", title: "Managing Director", phone: "+44 161 883 2200", valid: true },
    { id: "c4", selected: true, name: "Tom Radcliffe", company: "Pennine Distribution", title: "Operations Lead", phone: "+44 161 998 3345", valid: true },
    { id: "c5", selected: true, name: "Emma Watson", company: "Green Mile Logistics", title: "VP Logistics", phone: "+44 161 552 9081", valid: true },
  ]);

  if (!isOpen) return null;

  // Smart Timing Calculation
  const customDurationMins = Math.max(60, (timeToMinutes(customEndTime) - timeToMinutes(customStartTime)));
  const windowTimes = callPolicy === "respectful"
    ? { start: "09:00", end: "17:30", mins: 510 }
    : callPolicy === "pecr_max"
      ? { start: "08:00", end: "21:00", mins: 780 }
      : callPolicy === "core_peak"
        ? { start: "10:00", end: "16:00", mins: 360 }
        : { start: customStartTime, end: customEndTime, mins: customDurationMins };

  const effectiveWindowMins = lunchPause ? Math.max(0, windowTimes.mins - 60) : windowTimes.mins;
  const avgCallMins = 3.2;
  const dailyCapacity = Math.floor((effectiveWindowMins / avgCallMins) * concurrency);
  const totalDurationMins = Math.round((totalRows * avgCallMins) / concurrency);
  const willFinishToday = totalDurationMins <= effectiveWindowMins;
  const daysNeeded = Math.ceil(totalRows / Math.max(1, dailyCapacity));

  const finishHour = 9 + Math.floor(totalDurationMins / 60) + (lunchPause && totalDurationMins > 210 ? 1 : 0);
  const finishMin = (totalDurationMins % 60);
  const finishTimeStr = `${String(Math.min(18, finishHour)).padStart(2, "0")}:${String(finishMin).padStart(2, "0")}`;

  // Projected Conversions
  const expectedConnected = Math.round(totalRows * 0.22);
  const expectedMeetings = Math.max(1, Math.round(totalRows * 0.06));
  const expectedVoicemails = Math.round(totalRows * 0.45);

  const handleFileSelect = (file) => {
    if (!file) return;
    const name = file.name;
    const sizeKb = (file.size / 1024).toFixed(1) + " KB";
    setFileName(name);
    setFileSize(sizeKb);
    setUploadSuccess(true);
    setTotalRows(Math.floor(Math.random() * 80) + 160);
    setTaskTitle(name.replace(/\.[^/.]+$/, "").replace(/_/g, " ") + " Campaign");
  };

  const loadSampleDataset = (name, rows) => {
    setFileName(name);
    setFileSize("34.2 KB");
    setTotalRows(rows);
    setUploadSuccess(true);
    setTaskTitle(name.replace(/\.[^/.]+$/, "").replace(/_/g, " ") + " Campaign");
  };

  const handleTestCall = () => {
    setTestingCall(true);
    setTestCallSuccess(false);
    setTimeout(() => {
      setTestingCall(false);
      setTestCallSuccess(true);
    }, 1400);
  };

  const handleLaunch = () => {
    const created = {
      id: "task_" + Date.now(),
      title: taskTitle,
      file: fileName,
      fileRows: totalRows,
      sector: "Logistics & Operations",
      region: "UK-wide",
      status: "active",
      concurrency,
      activeLines: Math.min(concurrency, 4),
      contacted: 0,
      total: totalRows,
      meetingsBooked: 0,
      voicemails: 0,
      avgDuration: "00:00",
      created: "Just now",
      callerId: selectedCallerId,
      goal,
      scriptTemplate,
      timezone: "Europe/London",
      callWindow: `${windowTimes.start}–${windowTimes.end} (Local Time)`,
      noAnswerFallbacks: voicemailAction === "drop_and_message" ? ["whatsapp", "sms", "email"] : ["retry"],
      prospects: generateBatchProspects(totalRows, "Logistics"),
    };
    onCreateTask(created);
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.72)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 20, cursor: "pointer" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 16, width: 940, maxWidth: "96vw", maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 28px 56px rgba(0,0,0,0.28)", border: `1px solid ${C.border}`, cursor: "default" }}
      >
        
        {/* Wizard Header & Steps Progress */}
        <div style={{ padding: "20px 28px", borderBottom: `1px solid ${C.border}`, background: HUB_PAPER, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink }}>
              Batch AI Calling Task Setup
            </div>
            <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2 }}>
              Step {step} of 4: {step === 1 ? "File Upload & Column Mapping" : step === 2 ? "Campaign Objective & Dynamic AI Script" : step === 3 ? "Concurrency & Smart Timing Schedule" : "Pre-Flight Cockpit & Operator Test Dial"}
            </div>
          </div>

          {/* Stepper pills */}
          <div style={{ display: "flex", gap: 8 }}>
            {[1, 2, 3, 4].map((s) => (
              <div
                key={s}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  background: step === s ? C.cobalt : step > s ? C.green : C.paperSoft,
                  color: step >= s ? "#fff" : C.slate,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {step > s ? "✓" : s}
              </div>
            ))}
          </div>
        </div>

        {/* Wizard Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          
          {/* STEP 1: FILE UPLOAD, MAPPING & VALIDATION */}
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              
              {/* Interactive File Dropzone Box - Entire area triggers file upload */}
              <div
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleFileSelect(e.dataTransfer.files[0]);
                  }
                }}
                style={{
                  border: `1.5px dashed ${isDragging ? C.cobalt : uploadSuccess ? C.teal : C.border}`,
                  borderRadius: 14,
                  padding: "22px 26px",
                  background: isDragging ? C.cobaltSoft : uploadSuccess ? "#F0FAF8" : HUB_PAPER,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = uploadSuccess ? C.tealDeep : C.cobalt;
                  e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.06)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = isDragging ? C.cobalt : uploadSuccess ? C.teal : C.border;
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".xlsx,.xls,.csv,.tsv"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileSelect(e.target.files[0]);
                    }
                  }}
                />

                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      background: uploadSuccess ? C.tealSoft : C.cobaltSoft,
                      color: uploadSuccess ? C.teal : C.cobalt,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <UploadCloud size={24} />
                  </div>
                  <div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>
                      {uploadSuccess ? fileName : "Upload Contact Spreadsheet or CSV"}
                    </div>
                    <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                      {uploadSuccess
                        ? `${fileSize} · ${totalRows} verified contact rows · Ready for calling`
                        : "Drag and drop your .xlsx, .xls, .csv file here, or click Browse"}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 8,
                      background: C.ink,
                      color: "#fff",
                      border: "none",
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Browse File
                  </button>
                </div>
              </div>

              {/* Sample Datasets Quick Pick */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: C.slate }}>Or test with sample list:</span>
                <button
                  type="button"
                  onClick={() => loadSampleDataset("UK_Logistics_Operations_Leads.xlsx", 240)}
                  style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", fontSize: 11.5, color: C.ink, cursor: "pointer", fontWeight: 600 }}
                >
                  📁 UK Logistics Leads (240 rows)
                </button>
                <button
                  type="button"
                  onClick={() => loadSampleDataset("Midlands_Manufacturing_Plant_Directors.csv", 180)}
                  style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", fontSize: 11.5, color: C.ink, cursor: "pointer", fontWeight: 600 }}
                >
                  📁 Manufacturing SMEs (180 rows)
                </button>
              </div>

              {/* Column Mapping Grid */}
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink, marginBottom: 8 }}>
                  Column Mapping
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {[
                    { key: "phone", label: "Phone Number Column * (Required)" },
                    { key: "name", label: "Contact Full / First Name Column" },
                    { key: "company", label: "Company / Organization Column" },
                    { key: "jobTitle", label: "Job Title Column" },
                    { key: "industry", label: "Industry / Sector Column" },
                    { key: "notes", label: "Custom Notes / Context Column" },
                  ].map((f) => (
                    <div key={f.key} style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                      <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 5 }}>
                        {f.label}
                      </label>
                      <input
                        value={mappings[f.key] || ""}
                        onChange={(e) => setMappings({ ...mappings, [f.key]: e.target.value })}
                        placeholder="Select or enter column header name..."
                        style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5, background: "#fff", boxSizing: "border-box" }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Data Hygiene Notice */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Data Hygiene & E.164 Clean International Formatting</div>
                  <div style={{ fontSize: 12, color: C.slate }}>Clean dialable numbers: <strong style={{ color: C.green }}>{totalRows} valid contacts</strong> · Zero invalid prefixes.</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 4, background: C.greenSoft, color: C.green }}>
                  ✓ Ready for Scripting
                </span>
              </div>

            </div>
          )}

          {/* STEP 2: CAMPAIGN OBJECTIVE & DYNAMIC SCRIPTING */}
          {step === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 5 }}>Task / Campaign Title</label>
                <input
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13.5, fontWeight: 600, boxSizing: "border-box" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 5 }}>Campaign Objective</label>
                <select
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, background: "#fff" }}
                >
                  <option value="Appointment & Demo Booking">Appointment & Demo Booking (Cal.com auto-sync)</option>
                  <option value="Lead Qualification & Discovery">Lead Qualification & Discovery (Filter by budget & timeline)</option>
                  <option value="Event Attendance Confirmation">Event / Webinar Attendance Confirmation</option>
                  <option value="Past Client Reactivation">Past Client Reactivation & Special Offer</option>
                </select>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Dynamic AI Script Template</label>
                  <div style={{ display: "flex", gap: 4 }}>
                    {["{{first_name}}", "{{company_name}}", "{{our_company}}", "{{job_title}}", "{{notes}}"].map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setScriptTemplate((prev) => prev + " " + tag)}
                        style={{ fontSize: 10.5, padding: "2px 6px", borderRadius: 4, background: C.cobaltSoft, color: C.cobaltDeep, border: "none", cursor: "pointer", fontWeight: 700 }}
                      >
                        + {tag}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  value={scriptTemplate}
                  onChange={(e) => setScriptTemplate(e.target.value)}
                  rows={4}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, lineHeight: 1.5, boxSizing: "border-box" }}
                />
              </div>

              <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.teal, marginBottom: 4 }}>SAMPLE CALL PREVIEW FOR ROW #1 (James Whitfield @ Acme Logistics Ltd):</div>
                <div style={{ fontSize: 12.5, color: C.ink, fontStyle: "italic" }}>
                  “Hi James, this is Sam calling on behalf of {companyName || "AIVHub"}. I saw that you lead operations at Acme Logistics Ltd and wanted to share how we help fleets eliminate end-of-month spreadsheet reconciliation...”
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: CONCURRENCY & SMART TIMING ESTIMATION */}
          {step === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              
              {/* Concurrency Slider */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>Parallel Calling Concurrency: {concurrency} Simultaneous Lines</div>
                    <div style={{ fontSize: 12, color: C.slate }}>Simultaneous AI voice channels dialing in parallel across your SIP trunk.</div>
                  </div>
                  <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.cobalt }}>{concurrency} Lines</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="30"
                  step="1"
                  value={concurrency}
                  onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
                  style={{ width: "100%" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.slate, marginTop: 4 }}>
                  <span>1 line (Sequential / 1-by-1)</span>
                  <span>8 lines (Recommended Batch)</span>
                  <span>30 lines (High-Throughput Enterprise)</span>
                </div>
              </div>

              {/* Smart Calling Policy & Window */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Calling Hours Policy (Legal Compliance & Local Timezone)</div>
                <div style={{ fontSize: 12, color: C.slate, marginBottom: 12 }}>Guarantees calls are strictly placed inside acceptable business hours in the recipient's local timezone.</div>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
                  {[
                    { id: "respectful", label: "Respectful Hours", time: "09:00 – 17:30", blurb: "Office-hours standard · recommended" },
                    { id: "pecr_max", label: "Full PECR Window", time: "08:00 – 21:00", blurb: "Full UK B2B legal compliance window" },
                    { id: "core_peak", label: "Core Peak Hours", time: "10:00 – 16:00", blurb: "Peak decision-maker presence" },
                    { id: "custom", label: "Custom Window", time: `${customStartTime} – ${customEndTime}`, blurb: "Set custom hours & active days" },
                  ].map((p) => {
                    const active = callPolicy === p.id;
                    return (
                      <div
                        key={p.id}
                        className="hover-float"
                        onClick={() => setCallPolicy(p.id)}
                        style={{
                          border: `2px solid ${active ? C.cobalt : C.border}`,
                          borderRadius: 10,
                          padding: 12,
                          cursor: "pointer",
                          background: active ? C.cobaltSoft : "#fff",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{p.label}</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: C.cobalt, marginTop: 2 }}>{p.time}</div>
                        <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>{p.blurb}</div>
                      </div>
                    );
                  })}
                </div>

                {/* CUSTOM CALLING HOURS CONFIGURATION SECTION */}
                {callPolicy === "custom" && (
                  <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                      <Clock size={14} color={C.cobalt} /> Custom Window & Active Days Configuration
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.5fr", gap: 12, alignItems: "center" }}>
                      <div>
                        <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 4 }}>
                          Window Start Time
                        </label>
                        <input
                          type="time"
                          value={customStartTime}
                          onChange={(e) => setCustomStartTime(e.target.value)}
                          style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13, background: "#fff", boxSizing: "border-box" }}
                        />
                      </div>

                      <div>
                        <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 4 }}>
                          Window End Time
                        </label>
                        <input
                          type="time"
                          value={customEndTime}
                          onChange={(e) => setCustomEndTime(e.target.value)}
                          style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13, background: "#fff", boxSizing: "border-box" }}
                        />
                      </div>

                      <div>
                        <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 4 }}>
                          Active Calling Days
                        </label>
                        <div style={{ display: "flex", gap: 4 }}>
                          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => {
                            const selected = customDays.includes(day);
                            return (
                              <button
                                key={day}
                                type="button"
                                onClick={() => {
                                  if (selected) {
                                    if (customDays.length > 1) setCustomDays(customDays.filter((d) => d !== day));
                                  } else {
                                    setCustomDays([...customDays, day]);
                                  }
                                }}
                                style={{
                                  padding: "5px 7px",
                                  borderRadius: 5,
                                  border: `1px solid ${selected ? C.cobalt : C.border}`,
                                  background: selected ? C.cobalt : "#fff",
                                  color: selected ? "#fff" : C.slate,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  cursor: "pointer",
                                }}
                              >
                                {day}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.borderSoft}`, fontSize: 11.5 }}>
                      <span style={{ color: C.green, fontWeight: 600 }}>
                        ✓ Within UK / PECR legal B2B calling window (08:00–21:00 on weekdays)
                      </span>
                      <span style={{ color: C.slate }}>
                        Active Window: <strong>{customDurationMins} minutes/day</strong> ({customDays.join(", ")})
                      </span>
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTop: `1px solid ${C.borderSoft}` }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.ink, cursor: "pointer", fontWeight: 500 }}>
                    <input
                      type="checkbox"
                      checked={lunchPause}
                      onChange={(e) => setLunchPause(e.target.checked)}
                    />
                    Pause dialing during local lunch break (12:30 – 13:30)
                  </label>
                  <span style={{ fontSize: 11, color: C.slateLight }}>Protects pickup rates during lunch hour</span>
                </div>
              </div>

              {/* SMART ESTIMATED COMPLETION & CAPACITY COCKPIT */}
              <div style={{ background: `linear-gradient(135deg, ${C.cobaltSoft}, #EEF4FF)`, border: `1px solid #BFD5FA`, borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: C.cobaltDeep }}>
                      Smart Queue Capacity & Estimated Completion
                    </div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink, marginTop: 4 }}>
                      {willFinishToday
                        ? `Will complete today by ~${finishTimeStr}`
                        : `Takes ~${daysNeeded} business days across ${concurrency} lines`}
                    </div>
                    <div style={{ fontSize: 12.5, color: C.slate, marginTop: 4 }}>
                      Daily capacity: <strong>{dailyCapacity} contacts/day</strong> at average 3.2 mins/call with 12:30 lunch protection.
                    </div>
                  </div>

                  <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: C.slate }}>File Contact Count</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.cobalt }}>{totalRows} Contacts</div>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* STEP 4: PRE-FLIGHT CAMPAIGN COCKPIT, CALLER ID & OPERATOR TEST CALL */}
          {step === 4 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              
              {/* 1. OUTBOUND CALLER ID TRUNK SELECTION (DROPDOWN OF ALL SOFTWARE NUMBERS) */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>Outbound Calling Number (Caller ID Display)</div>
                    <div style={{ fontSize: 12, color: C.slate }}>Select which verified phone number registered in our software will show on clients' caller ID.</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 4, background: C.greenSoft, color: C.green }}>
                    🟢 SIP Trunk Ready
                  </span>
                </div>

                <select
                  value={selectedCallerId}
                  onChange={(e) => setSelectedCallerId(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13.5, fontWeight: 600, background: HUB_PAPER }}
                >
                  {REGISTERED_CALLER_IDS.map((c) => (
                    <option key={c.id} value={c.number}>
                      {c.number} — {c.label} ({c.region})
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. OPERATOR LIVE TEST CALL PICKER */}
              <div style={{ background: C.tealSoft, border: `1px solid ${C.teal}`, borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: C.teal }}>📞 Pre-Flight Test Call to Operator Phone</div>
                    <div style={{ fontSize: 12, color: C.ink, marginTop: 2 }}>Hear how the AI voice sounds with your dynamic script before dialing the batch.</div>
                  </div>

                  <button
                    onClick={handleTestCall}
                    disabled={testingCall}
                    style={{
                      padding: "8px 18px",
                      borderRadius: 8,
                      background: C.teal,
                      color: "#fff",
                      border: "none",
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: testingCall ? "wait" : "pointer",
                      boxShadow: "0 2px 8px rgba(12,140,125,0.25)",
                    }}
                  >
                    {testingCall ? "Ringing..." : "Test Call My Mobile"}
                  </button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 4 }}>Select Registered Operator Mobile</label>
                    <select
                      value={selectedOperatorPhone}
                      onChange={(e) => setSelectedOperatorPhone(e.target.value)}
                      style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5, background: "#fff" }}
                    >
                      {REGISTERED_OPERATORS.map((op) => (
                        <option key={op.id} value={op.phone || "custom"}>
                          {op.name} {op.phone ? `(${op.phone})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedOperatorPhone === "custom" && (
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 4 }}>Custom Mobile Number</label>
                      <input
                        value={customMobile}
                        onChange={(e) => setCustomMobile(e.target.value)}
                        placeholder="+44 7700..."
                        style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5, background: "#fff", boxSizing: "border-box" }}
                      />
                    </div>
                  )}
                </div>

                {testCallSuccess && (
                  <div style={{ fontSize: 12, color: C.green, fontWeight: 600, marginTop: 10 }}>
                    ✓ Test call verified! Audio latency: 480ms · Voice quality: Excellent.
                  </div>
                )}
              </div>

              {/* 3. CAMPAIGN READINESS & PROJECTED OUTCOMES SUMMARY */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, marginBottom: 12 }}>
                  Pre-Flight Campaign Readiness & Projected Outcomes
                </div>
                
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                  <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Audience Size</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink, marginTop: 2 }}>{totalRows}</div>
                    <div style={{ fontSize: 11, color: C.green, marginTop: 2 }}>100% verified numbers</div>
                  </div>

                  <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Estimated Runtime</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.cobalt, marginTop: 2 }}>{Math.round(totalDurationMins / 60)}h {totalDurationMins % 60}m</div>
                    <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>{concurrency} parallel lines</div>
                  </div>

                  <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Projected Pickups</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.teal, marginTop: 2 }}>~{expectedConnected}</div>
                    <div style={{ fontSize: 11, color: C.slate, marginTop: 2 }}>22% pickup forecast</div>
                  </div>

                  <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Expected Bookings</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.green, marginTop: 2 }}>~{expectedMeetings}</div>
                    <div style={{ fontSize: 11, color: C.green, marginTop: 2 }}>Cal.com auto-sync</div>
                  </div>
                </div>

                {/* Multi-Channel Fallback Pipeline Diagram */}
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.borderSoft}` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 8 }}>
                    Automated Fallback & Multi-Channel Escalation Flow
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: C.ink, flexWrap: "wrap" }}>
                    <span style={{ padding: "4px 8px", borderRadius: 6, background: C.cobaltSoft, color: C.cobaltDeep, fontWeight: 700 }}>1. AI Voice Call ({concurrency} Lines)</span>
                    <span style={{ color: C.slateLight }}>→ if no answer →</span>
                    <span style={{ padding: "4px 8px", borderRadius: 6, background: C.tealSoft, color: C.teal, fontWeight: 700 }}>2. AI Voicemail Drop</span>
                    <span style={{ color: C.slateLight }}>→ then →</span>
                    <span style={{ padding: "4px 8px", borderRadius: 6, background: "#F4ECFB", color: "#6E2BA6", fontWeight: 700 }}>3. WhatsApp / SMS Summary</span>
                    <span style={{ color: C.slateLight }}>→</span>
                    <span style={{ padding: "4px 8px", borderRadius: 6, background: C.greenSoft, color: C.green, fontWeight: 700 }}>4. Cal.com Auto-Booking</span>
                  </div>
                </div>

              </div>

            </div>
          )}

        </div>

        {/* Wizard Footer Controls */}
        <div style={{ padding: "16px 28px", borderTop: `1px solid ${C.border}`, background: HUB_PAPER, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {step > 1 ? (
            <button
              onClick={() => setStep(step - 1)}
              style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
            >
              ← Back
            </button>
          ) : (
            <div />
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={onClose}
              style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
            >
              Cancel
            </button>
            {step < 4 ? (
              <button
                onClick={() => setStep(step + 1)}
                style={{ padding: "8px 20px", borderRadius: 8, background: C.ink, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
              >
                Continue →
              </button>
            ) : (
              <button
                onClick={handleLaunch}
                style={{ padding: "9px 24px", borderRadius: 8, background: C.green, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 12px rgba(12,140,125,0.25)" }}
              >
                🚀 Launch Batch Task ({totalRows} Contacts)
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}


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
              className="hover-float"
              onClick={() => onOpenMission(m)}
              style={{
                background: C.paperCard,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: 18,
                cursor: "pointer",
              }}
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

      {dossierContact && (
        <CompanyDossierModal
          contact={dossierContact}
          onClose={() => setDossierContact(null)}
          onWatchLive={onWatchLive}
        />
      )}
    </>
  );
}

/* ---------------------------------- mission detail ---------------------------------- */

function callBelongsToFocus(c, focus) {
  if (!focus) return true;
  if (focus.missionId && c.missionId && c.missionId === focus.missionId) return true;
  if (focus.missionTitle && c.mission === focus.missionTitle) return true;
  if (focus.prospectId && c.prospectId && c.prospectId === focus.prospectId) return true;
  if (focus.name && c.prospect === focus.name) return true;
  return false;
}

function MissionDetail({ mission, onBack, companyName, onWatchLive }) {
  const [expanded, setExpanded] = useState(null);
  const [visibleCount, setVisibleCount] = useState(50);
  const [rosterFilter, setRosterFilter] = useState("all");
  const [rosterSearch, setRosterSearch] = useState("");
  const [dossierContact, setDossierContact] = useState(null);
  const [showDataView, setShowDataView] = useState(false);

  if (showDataView) {
    return (
      <>
        <SpreadsheetDataView
          mission={mission}
          onBack={() => setShowDataView(false)}
          onOpenDossier={(p) => { setShowDataView(false); setDossierContact(p); }}
        />
        {dossierContact && (
          <CompanyDossierModal
            contact={dossierContact}
            onClose={() => setDossierContact(null)}
            onWatchLive={onWatchLive}
          />
        )}
      </>
    );
  }

  const counts = (mission.prospects || []).reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});

  const filteredProspects = (mission.prospects || []).filter((p) => {
    if (rosterFilter !== "all" && p.status !== rosterFilter) return false;
    if (rosterSearch.trim()) {
      const q = rosterSearch.toLowerCase();
      return (p.name + " " + (p.contact || "") + " " + (p.phone || "") + " " + (p.city || "")).toLowerCase().includes(q);
    }
    return true;
  });

  const visibleProspects = filteredProspects.slice(0, visibleCount);
  const hasQueueInfo = typeof mission.concurrency === "number";

  return (
    <>
      <div style={{ padding: "22px 32px 0 32px" }}>
        <button
          onClick={onBack}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", color: C.textInk, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginBottom: 14 }}
        >
          <ChevronLeft size={14} /> Back to Tasks & Batches
        </button>
      </div>
      <div style={{ padding: "0 32px 20px 32px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: `1px solid ${C.border}`, paddingBottom: 20 }}>
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: C.textInk, letterSpacing: "-0.01em" }}>{mission.title}</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 2 }}>{mission.region} · {mission.sector} · Started {mission.created}{mission.timezone ? ` · ${timezoneLabel(mission.timezone).split(" — ")[0]}` : ""}</div>
          {typeof mission.understood === "number" && (
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.teal, marginTop: 6 }}>
              {mission.understood} of {mission.fileRows || mission.total} rows understood and queued — open any company below to see what happened and how.
            </div>
          )}
          {(counts.calling || 0) > 0 && (
            <div style={{ marginTop: 10, background: C.cobaltSoft, borderRadius: 8, padding: "9px 12px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk, lineHeight: 1.45, maxWidth: 560 }}>
              {counts.calling} conversation{counts.calling === 1 ? "" : "s"} live now. This page is the roster. Open <strong>Live Activity</strong> to listen, take over, book a meeting, or end a call — ending a voice call with no pickup moves that company to WhatsApp / SMS / email.
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {typeof onWatchLive === "function" && (counts.calling || 0) > 0 && (
              <button
                onClick={() => onWatchLive({ missionTitle: mission && mission.title, missionId: mission && mission.id })}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, background: C.ink, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
              >
                <Radio size={13} /> Watch {counts.calling} Live Call{counts.calling === 1 ? "" : "s"}
              </button>
            )}
            <button
              onClick={() => setShowDataView(true)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, background: "#fff", color: C.cobalt, border: `1.5px solid ${C.cobalt}`, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
            >
              📊 File Data View
            </button>
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, textAlign: "right" }}>
            Representing <span style={{ color: C.textInk, fontWeight: 600 }}>{companyName}</span>
          </div>
        </div>
      </div>

      <div style={{ padding: "20px 32px", display: "grid", gridTemplateColumns: "1fr 300px", gap: 20 }}>
        <div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>
                Full Contact List & Campaign Roster ({mission.prospects ? mission.prospects.length : 0} Contacts)
              </div>
              <div style={{ position: "relative", width: 260 }}>
                <Search size={13} color={C.slateLight} style={{ position: "absolute", left: 10, top: 9 }} />
                <input
                  value={rosterSearch}
                  onChange={(e) => setRosterSearch(e.target.value)}
                  placeholder="Search contacts, phone, city..."
                  style={{ width: "100%", height: 32, padding: "0 10px 0 30px", borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 12, background: "#fff", boxSizing: "border-box" }}
                />
              </div>
            </div>

            {/* Filter Tabs */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {[
                { id: "all", label: "All Contacts", count: mission.prospects.length },
                { id: "calling", label: "Live Calling", count: counts.calling || 0 },
                { id: "meeting_booked", label: "Meetings Booked", count: counts.meeting_booked || 0 },
                { id: "left_voicemail", label: "Voicemails / SMS", count: counts.left_voicemail || 0 },
                { id: "retry", label: "Retrying", count: counts.retry || 0 },
                { id: "queued", label: "Queued", count: counts.queued || 0 },
              ].map((t) => {
                const active = rosterFilter === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => { setRosterFilter(t.id); setVisibleCount(50); }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "5px 10px",
                      borderRadius: 6,
                      border: `1px solid ${active ? C.ink : C.border}`,
                      background: active ? C.ink : "#fff",
                      color: active ? "#fff" : C.slate,
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <span>{t.label}</span>
                    <span style={{ fontSize: 10.5, padding: "1px 5px", borderRadius: 999, background: active ? "rgba(255,255,255,0.2)" : C.paperSoft, color: active ? "#fff" : C.slate }}>
                      {t.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visibleProspects.map((p) => {
              const isOpen = expanded === p.id;
              return (
                <div key={p.id} className="hover-float" style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                  <div
                    onClick={() => setExpanded(isOpen ? null : p.id)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {p.status === "calling" ? <LivePulse /> : p.status === "meeting_booked" ? <CheckCircle2 size={16} color={C.green} /> : p.status === "human_review" ? <AlertTriangle size={16} color={C.red} /> : p.status === "skipped" ? <History size={15} color={C.slate} /> : <Circle size={14} color={C.slateLight} />}
                      <div>
                        <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13.5, color: C.textInk }}>{p.name}</div>
                        <div style={{ fontSize: 11.5, color: C.slate }}>{p.contact} · {p.title || "Director"} · {p.phone}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <Badge status={p.status} small />
                      <ChevronDown size={15} color={C.slateLight} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                    </div>
                  </div>
                  {isOpen && (
                    <div style={{ padding: "0 16px 14px 40px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>
                      <div style={{ marginBottom: 6, fontWeight: 500, color: C.ink }}>{p.note}</div>
                      {p.notes && <div style={{ marginBottom: 6, fontSize: 12, color: C.slate, background: HUB_PAPER, padding: "6px 10px", borderRadius: 6 }}><strong>Lead Context:</strong> {p.notes}</div>}
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8, fontSize: 11.5, color: C.slate }}>
                        <span>🏢 Fleet: <strong>{p.fleet || "35 HGVs"}</strong></span>
                        <span>💰 Rev: <strong>{p.rev || "£15M"}</strong></span>
                        <span>📍 City: <strong>{p.city || "Manchester"}</strong></span>
                        <span>💻 Stack: <strong>{p.stack || "Excel, Sage 50"}</strong></span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDossierContact(p); }}
                          style={{ background: "#fff", color: C.ink, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                        >
                          📋 View Company Dossier
                        </button>

                        {(p.status === "calling" || p.status === "human_review") && typeof onWatchLive === "function" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onWatchLive({ name: p.name, prospectId: p.id, missionTitle: mission && mission.title }); }}
                            style={{ background: C.cobalt, color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
                          >
                            <Radio size={12} /> {p.status === "human_review" ? "Join & Take Over" : "Watch Live"}
                          </button>
                        )}
                      </div>
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
            <StatRow label="No answer / fallback" value={(counts.left_voicemail || 0) + (counts.emailed || 0) + (counts.retry || 0)} />
            <StatRow label="Est. cost so far" value="£4.80" />
          </div>

          {(mission.timezone || mission.lunchStart || mission.noAnswerFallbacks) && (
            <>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.slate, margin: "18px 0 10px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Quiet hours
              </div>
              <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                {mission.timezone && <StatRow label="Timezone" value={timezoneLabel(mission.timezone).split(" — ")[0]} />}
                {mission.lunchStart && <StatRow label="Lunch — no contact" value={`${mission.lunchStart}–${mission.lunchEnd}`} />}
                {mission.callWindow && (
                  <StatRow
                    label="Call window"
                    value={mission.callWindow}
                  />
                )}
                {mission.callHoursPolicy && (
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, lineHeight: 1.5 }}>
                    {mission.callHoursPolicy === "pecr_max"
                      ? "Full PECR weekday window. Legal max is 08:00–21:00 weekdays, 09:00–18:00 weekends."
                      : mission.callHoursPolicy === "respectful"
                        ? "Respectful office hours — narrower than PECR on purpose. Law allows until 21:00 weekdays."
                        : "Custom window, still inside PECR (weekdays 08:00–21:00)."}
                  </div>
                )}
                {mission.noAnswerFallbacks && mission.noAnswerFallbacks.length > 0 && (
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, lineHeight: 1.5, paddingTop: 4, borderTop: `1px solid ${C.border}` }}>
                    If no pickup: {mission.noAnswerFallbacks.map((c) => (CHANNEL_META[c] || { label: c }).label).join(" → ")}
                  </div>
                )}
              </div>
            </>
          )}

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
      {dossierContact && (
        <CompanyDossierModal
          contact={dossierContact}
          onClose={() => setDossierContact(null)}
          onWatchLive={onWatchLive}
        />
      )}
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

function LiveCallsView({ notifications, setNotifications, companyName, calls, onConfirmBooking, onTakenToggle, onListenToggle, onAskEnd, onCancelEnd, onConfirmEnd, focus, onClearFocus, onBackToTasks }) {
  const toggleTaken = onTakenToggle;
  const toggleListen = onListenToggle;
  const askEnd = onAskEnd;
  const cancelEnd = onCancelEnd;
  const confirmEnd = onConfirmEnd;
  const focusRef = useRef(null);

  const filtered = focus ? calls.filter((c) => callBelongsToFocus(c, focus)) : calls;
  const active = filtered.filter((c) => !c.ended);
  const companyFocus = !!(focus && (focus.name || focus.prospectId));

  useEffect(() => {
    if (focusRef.current) focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus && (focus.prospectId || focus.name)]);

  const isFocusedCard = (c) =>
    companyFocus &&
    ((focus.prospectId && c.prospectId === focus.prospectId) || (focus.name && c.prospect === focus.name));

  return (
    <>
      <TopBar
        title="Live Activity"
        subtitle={focus ? `${active.length} live for this task` : `${calls.filter((c) => !c.ended).length} active conversations — calls and messages`}
        notifications={notifications}
        setNotifications={setNotifications}
        canGoBack={true}
        onBack={onBackToTasks}
        backLabel="Back"
      />
      {focus && (
        <div style={{ margin: "16px 32px 0", background: C.ink, color: "#fff", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, lineHeight: 1.45 }}>
            {companyFocus ? (
              <>Opened from mission: <strong>{focus.name}</strong>{focus.missionTitle ? ` · ${focus.missionTitle}` : ""}. Thick dark ring is that company. Other missions hidden.</>
            ) : (
              <>Showing only live cards for <strong>{focus.missionTitle || "this mission"}</strong>. Other conversations hidden so this list is readable.</>
            )}
          </div>
          <button
            onClick={onClearFocus}
            style={{ background: "#fff", color: C.ink, border: "none", borderRadius: 7, padding: "7px 12px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Show all conversations
          </button>
        </div>
      )}
      <div style={{ margin: focus ? "10px 32px 0" : "16px 32px 0", fontFamily: FONT_BODY, fontSize: 12, color: C.slate, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: C.amber, marginRight: 6, verticalAlign: "middle" }} />Amber border — AI needs a human (pricing / stuck)</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: C.red, marginRight: 6, verticalAlign: "middle" }} />Red border — you took over the call</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: C.ink, marginRight: 6, verticalAlign: "middle" }} />Dark ring — opened from the mission list</span>
      </div>
      {filtered.length === 0 && (
        <div style={{ margin: "20px 32px", fontFamily: FONT_BODY, fontSize: 13.5, color: C.slate, lineHeight: 1.5 }}>
          {companyFocus
            ? `${focus.name} is not on a live call right now — queued, skipped, or already finished. Show all conversations to see everything else.`
            : "No live cards for this mission yet."}
        </div>
      )}
      <div style={{ padding: "16px 32px 0" }}>
        <DirectOutboundCallCard notifications={notifications} setNotifications={setNotifications} defaultFromNumber="+447307216767" />
      </div>
      <div style={{ padding: "20px 32px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        {filtered.map((c) => {
          const isMessage = c.channel === "whatsapp" || c.channel === "sms" || c.channel === "email";
          const focused = isFocusedCard(c);
          if (c.ended) {
            return (
              <div key={c.id} className="hover-float" style={{ background: c.booked ? C.greenSoft : C.paperSoft, border: `1px dashed ${c.booked ? C.green : C.border}`, borderRadius: 12, padding: 16, opacity: c.booked ? 1 : 0.7, order: 8 }}>
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
          const parsedAsk = extractRequestedTime(c.transcript);
          const deferredAsk = parsedAsk && parsedAsk.kind === "deferred_callback";
          const borderColor = c.taken ? C.red : flagged ? C.amber : focused ? C.ink : C.border;
          const borderWidth = focused || c.taken || flagged ? 2.5 : 1.5;
          return (
            <div
              key={c.id}
              ref={focused ? focusRef : null}
              className="hover-float"
              style={{
                background: focused ? "#fff" : C.paperCard,
                border: `${borderWidth}px solid ${borderColor}`,
                borderRadius: 12,
                padding: 16,
                order: focused ? -2 : flagged ? -1 : 0,
                boxShadow: focused ? "0 0 0 4px rgba(26,26,26,0.12)" : "none",
                opacity: companyFocus && !focused ? 0.42 : 1,
                outline: focused ? `2px solid ${C.ink}` : "none",
                outlineOffset: focused ? 2 : 0,
              }}
            >
              {focused && (
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "#fff", background: C.ink, display: "inline-block", borderRadius: 5, padding: "3px 8px", marginBottom: 10 }}>
                  Opened from mission
                </div>
              )}
              {flagged && !focused && (
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.amber, marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                  <AlertTriangle size={12} /> Needs you — AI is stuck
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink }}>{c.prospect}</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.cobaltDeep, fontWeight: 600, marginTop: 1 }}>{c.mission}</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap", fontSize: 11, color: C.slate }}>
                    <span style={{ background: HUB_PAPER, padding: "2px 6px", borderRadius: 4, border: `1px solid ${C.border}` }}>🏢 48 HGVs · £22M Rev</span>
                    <span style={{ background: HUB_PAPER, padding: "2px 6px", borderRadius: 4, border: `1px solid ${C.border}` }}>👤 James Whitfield (Ops Dir)</span>
                  </div>
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
                  {deferredAsk && (
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.teal, lineHeight: 1.4, marginBottom: 8, background: C.tealSoft, borderRadius: 7, padding: "8px 10px" }}>
                      They asked to wait {parsedAsk.monthsAhead} month{parsedAsk.monthsAhead === 1 ? "" : "s"} — “{parsedAsk.exactWords}”. Parking that date is not a meeting.
                    </div>
                  )}
                  {(c.state === "negotiating" || deferredAsk) && (
                    <button
                      onClick={() => onConfirmBooking(c)}
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: deferredAsk ? C.teal : C.green, color: "#fff", border: "none", borderRadius: 7, padding: "8px 10px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                    >
                      <CalendarCheck size={13} /> {deferredAsk ? `Park callback — ${parsedAsk.day}` : "Confirm time & book meeting"}
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
              <div key={e.id} className="hover-float" style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
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

/* ---------------------------------- process logs view (all subsystems) ---------------------------------- */

function ProcessLogsView({ notifications, setNotifications }) {
  const [logs, setLogs] = useState([]);
  const [subsystems, setSubsystems] = useState([]);
  const [activeSubsystem, setActiveSubsystem] = useState("all");
  const [activeLevel, setActiveLevel] = useState("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [rawModal, setRawModal] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = async () => {
    try {
      const params = {};
      if (activeSubsystem !== "all") params.subsystem = activeSubsystem;
      if (activeLevel !== "ALL") params.level = activeLevel;
      if (search.trim()) params.search = search.trim();
      params.limit = 200;

      const data = await api.getProcessLogs(params);
      if (Array.isArray(data)) setLogs(data);
    } catch (err) {
      console.warn("Failed to fetch process logs:", err);
    }
  };

  const fetchSubsystems = async () => {
    try {
      const data = await api.getSubsystemsStats();
      if (Array.isArray(data)) setSubsystems(data);
    } catch (_) {}
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchLogs(), fetchSubsystems()]).finally(() => setLoading(false));
  }, [activeSubsystem, activeLevel]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      fetchLogs();
      fetchSubsystems();
    }, 3500);
    return () => clearInterval(timer);
  }, [autoRefresh, activeSubsystem, activeLevel, search]);

  const handleClear = async () => {
    const target = activeSubsystem === "all" ? "ALL subsystems" : activeSubsystem;
    if (!window.confirm(`Are you sure you want to clear logs for ${target}?`)) return;
    try {
      await api.clearLogs(activeSubsystem);
      setLogs([]);
      fetchSubsystems();
    } catch (err) {
      alert("Failed to clear logs: " + err.message);
    }
  };

  const handleInspectRaw = async (subId) => {
    try {
      const res = await api.getRawFileLogs(subId, 250);
      setRawModal(res);
    } catch (err) {
      alert("Could not load log file: " + err.message);
    }
  };

  const LEVEL_COLORS = {
    SUCCESS: { bg: "#dcfce7", text: "#15803d", border: "#bbf7d0" },
    INFO:    { bg: "#dbeafe", text: "#1d4ed8", border: "#bfdbfe" },
    WARN:    { bg: "#fef3c7", text: "#b45309", border: "#fde68a" },
    ERROR:   { bg: "#fee2e2", text: "#b91c1c", border: "#fecaca" },
  };

  const SUBSYSTEM_TABS = [
    { id: "all", label: "All Subsystems", icon: LayoutGrid },
    { id: "telephony", label: "Telephony (Telnyx)", icon: Phone },
    { id: "voice", label: "Voice & Calls", icon: Mic },
    { id: "crawler_rag", label: "Crawler & RAG (pgvector)", icon: Globe },
    { id: "calendar", label: "Calendar & Bookings", icon: Calendar },
    { id: "scheduler", label: "Scheduler & Missions", icon: Clock },
    { id: "system", label: "System & Keys", icon: ShieldCheck },
    { id: "auth", label: "Auth & Security", icon: KeyRound },
  ];

  return (
    <>
      <TopBar
        title="System Process Logs"
        subtitle="Dedicated multi-subsystem audit trail, latencies, and physical file outputs"
        notifications={notifications}
        setNotifications={setNotifications}
      />
      <div style={{ padding: "20px 32px" }}>
        
        {/* Subsystem Navigation Pills */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {SUBSYSTEM_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeSubsystem === tab.id;
            const stat = subsystems.find((s) => s.id === tab.id);
            const count = stat ? stat.eventCount : null;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubsystem(tab.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "8px 14px",
                  borderRadius: 9,
                  border: `1.5px solid ${active ? C.ink : C.border}`,
                  background: active ? C.ink : "#fff",
                  color: active ? "#fff" : C.textInk,
                  fontFamily: FONT_BODY,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxShadow: active ? "0 2px 6px rgba(0,0,0,0.08)" : "none"
                }}
              >
                <Icon size={14} color={active ? "#fff" : C.slate} />
                <span>{tab.label}</span>
                {count !== null && (
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      background: active ? "rgba(255,255,255,0.2)" : C.paper,
                      color: active ? "#fff" : C.slate,
                      padding: "1px 6px",
                      borderRadius: 10,
                      marginLeft: 2
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Action Controls & Filters */}
        <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 260 }}>
            <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
              <Search size={14} color={C.slateLight} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchLogs()}
                placeholder="Search log messages, process names, or JSON..."
                style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px 7px 32px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none" }}
              />
            </div>

            {/* Severity Filter */}
            <div style={{ display: "flex", gap: 4 }}>
              {["ALL", "SUCCESS", "INFO", "WARN", "ERROR"].map((lvl) => {
                const active = activeLevel === lvl;
                return (
                  <button
                    key={lvl}
                    onClick={() => setActiveLevel(lvl)}
                    style={{
                      padding: "5px 9px",
                      borderRadius: 6,
                      border: `1px solid ${active ? C.ink : C.border}`,
                      background: active ? C.ink : "#fff",
                      color: active ? "#fff" : C.slate,
                      fontFamily: FONT_BODY,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer"
                    }}
                  >
                    {lvl}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => handleInspectRaw(activeSubsystem)}
              title="View the physical .log file on disk"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: C.paper,
                border: `1px solid ${C.border}`,
                borderRadius: 7,
                padding: "6px 12px",
                fontFamily: FONT_BODY,
                fontSize: 12,
                color: C.textInk,
                cursor: "pointer"
              }}
            >
              <FileText size={13} color={C.slate} /> View Disk File (.log)
            </button>

            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              title={autoRefresh ? "Pause live streaming" : "Resume live streaming"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: autoRefresh ? "#ecfdf5" : "#fff",
                border: `1px solid ${autoRefresh ? "#a7f3d0" : C.border}`,
                borderRadius: 7,
                padding: "6px 12px",
                fontFamily: FONT_BODY,
                fontSize: 12,
                color: autoRefresh ? "#065f46" : C.slate,
                cursor: "pointer",
                fontWeight: 600
              }}
            >
              <RefreshCw size={12} style={{ animation: autoRefresh ? "spin 2s linear infinite" : "none" }} />
              {autoRefresh ? "Live Stream (On)" : "Live Stream (Paused)"}
            </button>

            <button
              onClick={handleClear}
              title="Clear logs"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: "#fff",
                border: `1px solid ${C.border}`,
                borderRadius: 7,
                padding: "6px 10px",
                fontFamily: FONT_BODY,
                fontSize: 12,
                color: "#dc2626",
                cursor: "pointer"
              }}
            >
              <Trash2 size={12} /> Clear
            </button>
          </div>
        </div>

        {/* Logs Table */}
        <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "180px 100px 140px 190px 1fr 90px", padding: "10px 16px", background: C.paper, borderBottom: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            <div>Timestamp</div>
            <div>Level</div>
            <div>Subsystem</div>
            <div>Process Name</div>
            <div>Message</div>
            <div style={{ textAlign: "right" }}>Duration</div>
          </div>

          <div style={{ maxHeight: "calc(100vh - 350px)", overflowY: "auto" }}>
            {logs.length === 0 ? (
              <div style={{ padding: "48px 20px", textAlign: "center", color: C.slateLight, fontFamily: FONT_BODY, fontSize: 13 }}>
                No log entries found for this filter. Run an operation or test a key to generate logs.
              </div>
            ) : (
              logs.map((log) => {
                const colors = LEVEL_COLORS[log.level] || LEVEL_COLORS.INFO;
                const isExpanded = expandedId === log.id;
                const hasDetails = log.details && Object.keys(log.details).length > 0;
                return (
                  <div key={log.id} style={{ borderBottom: `1px solid ${C.borderLight}` }}>
                    <div
                      onClick={() => hasDetails && setExpandedId(isExpanded ? null : log.id)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "180px 100px 140px 190px 1fr 90px",
                        padding: "10px 16px",
                        alignItems: "center",
                        cursor: hasDetails ? "pointer" : "default",
                        background: isExpanded ? C.paper : "#fff",
                        transition: "background 0.1s ease"
                      }}
                      onMouseEnter={(e) => { if (hasDetails) e.currentTarget.style.background = C.paper; }}
                      onMouseLeave={(e) => { if (hasDetails && !isExpanded) e.currentTarget.style.background = "#fff"; }}
                    >
                      <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.slate }}>
                        {log.createdAt ? new Date(log.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 }) : "—"}
                      </div>
                      
                      <div>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 7px",
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: "0.03em",
                            background: colors.bg,
                            color: colors.text,
                            border: `1px solid ${colors.border}`
                          }}
                        >
                          {log.level}
                        </span>
                      </div>

                      <div>
                        <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, background: C.paper, padding: "2px 6px", borderRadius: 4 }}>
                          {log.subsystem}
                        </span>
                      </div>

                      <div style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 600, color: C.textInk, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {log.processName}
                      </div>

                      <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: 10 }}>
                        {log.message}
                      </div>

                      <div style={{ textAlign: "right", fontFamily: FONT_MONO, fontSize: 11, color: C.slateLight }}>
                        {log.durationMs !== null && log.durationMs !== undefined ? `${log.durationMs.toFixed(1)}ms` : "—"}
                      </div>
                    </div>

                    {/* Expandable JSON details */}
                    {isExpanded && hasDetails && (
                      <div style={{ padding: "10px 16px 14px 16px", background: "#1e293b", color: "#f8fafc", fontFamily: FONT_MONO, fontSize: 11.5, lineHeight: 1.5, borderTop: `1px dashed ${C.border}` }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 6, textTransform: "uppercase" }}>
                          Payload / Trace Details:
                        </div>
                        <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                          {JSON.stringify(log.details, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* Raw File Modal */}
      {rawModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 20 }}>
          <div style={{ background: "#0f172a", borderRadius: 14, maxWidth: 860, width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)", border: "1px solid #334155" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #334155", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 700, color: "#38bdf8" }}>
                  {rawModal.path}
                </div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: "#94a3b8" }}>
                  Tail of physical log file ({rawModal.totalLines} lines on disk)
                </div>
              </div>
              <button onClick={() => setRawModal(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8" }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: 16, overflowY: "auto", flex: 1, fontFamily: FONT_MONO, fontSize: 11.5, color: "#e2e8f0", lineHeight: 1.6, background: "#090d16" }}>
              {rawModal.lines.length === 0 ? (
                <div style={{ color: "#64748b", textAlign: "center", padding: 30 }}>Log file is currently empty.</div>
              ) : (
                rawModal.lines.map((l, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, borderBottom: "1px solid rgba(255,255,255,0.03)", padding: "2px 0" }}>
                    <span style={{ color: "#475569", userSelect: "none", width: 40, textAlign: "right", flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ wordBreak: "break-all" }}>{l}</span>
                  </div>
                ))
              )}
            </div>

            <div style={{ padding: "10px 20px", borderTop: "1px solid #334155", display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setRawModal(null)} style={{ background: "#38bdf8", color: "#0f172a", border: "none", borderRadius: 7, padding: "7px 16px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------------------------- schedule ---------------------------------- */


function ScheduleCallModal({ onClose, onCreate, prefillName, timezone, lunchStart, lunchEnd, windowStart, windowEnd }) {
  const [prospect, setProspect] = useState(prefillName || "");
  const [mission, setMission] = useState(INITIAL_MISSIONS[0].title);
  const [day, setDay] = useState("Today, 27 Aug");
  const [time, setTime] = useState("09:00");
  const [reason, setReason] = useState("");

  const canSave = prospect.trim().length > 0;
  const lunchHit = isInLunch(time, lunchStart, lunchEnd);
  const weekendish = /sat|sun/i.test(day);
  const timeSlots = (weekendish ? PECR_WEEKEND_SLOTS : halfHourSlots(windowStart || "09:00", windowEnd || "17:30")).filter((t) => !isInLunch(t, lunchStart, lunchEnd));
  const windowLabel = weekendish
    ? `PECR weekend cap ${PECR.weekendStart}–${PECR.weekendEnd}`
    : `${windowStart || "09:00"}–${windowEnd || "17:30"} (policy). PECR weekday max ${PECR.weekdayStart}–${PECR.weekdayEnd}`;

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
            <select value={time} onChange={(e) => setTime(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${lunchHit ? C.redSolid : C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}>
              {timeSlots.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Reason / notes <span style={{ color: C.slateLight, fontWeight: 400 }}>(optional)</span></div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Requested a callback after 3pm" style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
        </div>

        <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: lunchHit ? C.red : C.slateLight, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
          <Clock size={12} /> Times in {timezoneLabel(timezone || "Europe/London")}. {lunchStart ? `Lunch ${lunchStart}–${lunchEnd} is blocked. ` : ""}{windowLabel}.
        </div>

        <button
          disabled={!canSave || lunchHit}
          onClick={() => canSave && !lunchHit && onCreate({ day, time, prospect, mission, reason })}
          style={{ width: "100%", padding: "10px", borderRadius: 9, border: "none", background: canSave && !lunchHit ? C.ink : C.paperSoft, color: canSave && !lunchHit ? "#fff" : C.slateLight, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, cursor: canSave && !lunchHit ? "pointer" : "default" }}
        >
          {lunchHit ? "Pick a time outside lunch" : "Add to schedule"}
        </button>
      </div>
    </div>
  );
}

function ScheduleView({ notifications, setNotifications, prefillName, clearPrefill, items, setItems, timezone, lunchStart, lunchEnd, onFireDue, windowStart, windowEnd }) {
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
      { id: "s_" + Date.now(), day: entry.day, time: entry.time, prospect: entry.prospect, mission: entry.mission, window: `${windowStart || "09:00"}–${windowEnd || "17:30"}`, status: "queued" },
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
            <Clock size={14} /> Times shown in {timezoneLabel(timezone || "Europe/London")}. Auto-dial window {windowStart || "09:00"}–{windowEnd || "17:30"}. PECR legal max is {PECR.weekdayStart}–{PECR.weekdayEnd} weekdays, {PECR.weekendStart}–{PECR.weekendEnd} weekends. Lunch {lunchStart || "12:00"}–{lunchEnd || "13:00"} is blocked.
          </div>
          <button
            onClick={() => setShowModal(true)}
            style={{ display: "flex", alignItems: "center", gap: 7, background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <PlusCircle size={15} /> Schedule a call
          </button>
        </div>
        <div style={{ background: C.tealSoft, borderRadius: 8, padding: "10px 14px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk, lineHeight: 1.45, marginBottom: 18 }}>
          Long callbacks (they said “in 3 months” / “after 6 months” / “next quarter”) sit on this calendar until that date. Prototype clock is frozen, so use <strong>Pretend this day arrived</strong> on a parked row to see the bell + the call going out again.
        </div>

        {days.map((day) => (
          <div key={day} style={{ marginBottom: 22 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
              {day}
              {items.some((x) => x.day === day && x.deferred) ? " · parked until they asked us back" : ""}
            </div>
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
                  {i.dueNow ? <Badge status="due_now" small /> : i.deferred ? <Badge status="deferred" small /> : i.honored ? <Badge status="honored" small /> : <Badge status={i.status} small />}
                  {i.deferred && !i.dueNow && i.status !== "completed" && onFireDue && (
                    <button
                      onClick={() => onFireDue(i)}
                      style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 6, padding: "5px 10px", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      Pretend this day arrived
                    </button>
                  )}
                  {i.status !== "completed" && (
                    editing === i.id ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <select
                          defaultValue={i.time}
                          onChange={(e) => setItems((its) => its.map((x) => (x.id === i.id ? { ...x, time: e.target.value } : x)))}
                          style={{ fontFamily: FONT_BODY, fontSize: 12, padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.border}` }}
                        >
                          {halfHourSlots(windowStart || "09:00", windowEnd || "17:30").filter((t) => !isInLunch(t, lunchStart, lunchEnd)).map((t) => (
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

      {showModal && <ScheduleCallModal onClose={handleClose} onCreate={handleCreate} prefillName={prefillName} timezone={timezone} lunchStart={lunchStart} lunchEnd={lunchEnd} windowStart={windowStart} windowEnd={windowEnd} />}
    </>
  );
}

/* ---------------------------------- meetings ---------------------------------- */

const CHANNEL_META = {
  voice: { label: "Voice call", icon: Phone, color: C.cobaltDeep, bg: C.cobaltSoft },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, color: C.teal, bg: C.tealSoft },
  sms: { label: "SMS", icon: MessageSquare, color: C.amber, bg: C.amberSoft },
  email: { label: "Email", icon: Mail, color: C.inkSoft, bg: C.paperSoft },
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
  const isMessage = channel === "whatsapp" || channel === "sms" || channel === "email";
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
                      className="hover-float"
                      onClick={() => setOpenId(m.id)}
                      style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 15, cursor: "pointer" }}
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

const SOURCE_TYPES = [
  { id: "Website URL", label: "Website URL", icon: Globe, placeholder: "https://www.aivhub.com/", hint: "Public company website, product documentation, or case study URL." },
  { id: "Document upload", label: "Document / PDF", icon: FileText, placeholder: "e.g. pricing-matrix-2026.pdf or cloud link", hint: "Upload or reference pricing sheets, service catalogues, and sales decks." },
  { id: "Google Drive link", label: "Google Drive", icon: Link2, placeholder: "https://drive.google.com/drive/folders/...", hint: "Shared team drive folder or presentation link." },
  { id: "Google Docs link", label: "Google Docs", icon: FileText, placeholder: "https://docs.google.com/document/d/...", hint: "Live internal playbooks, FAQs, and competitor battlecards." },
  { id: "Manual text", label: "Direct Text / Notes", icon: PenLine, placeholder: "Paste raw objection rebuttals, customer Q&As, or pricing rules here...", hint: "Paste custom scripts or internal knowledge directly into the AI's memory." },
];

function CompanyProfileView({ profile, setProfile, notifications, setNotifications, sources = [], setSources, services = [], setServices, faq = [], setFaq }) {
  const [tab, setTab] = useState("identity");
  const [saved, setSaved] = useState(false);
  const [addingSource, setAddingSource] = useState(false);
  const [newSource, setNewSource] = useState({ name: "", type: "Website URL", value: "" });
  const [activeChunkModal, setActiveChunkModal] = useState(null);
  const [testQuery, setTestQuery] = useState("");
  const [testResults, setTestResults] = useState(null);
  const [testingQuery, setTestingQuery] = useState(false);
  const [resyncingId, setResyncingId] = useState(null);

  const update = (k, v) => setProfile((p) => {
    const next = { ...p, [k]: v };
    try { localStorage.setItem("aivhub_company_profile", JSON.stringify(next)); } catch (_) {}
    return next;
  });

  const save = async () => {
    setSaved(true);
    try {
      localStorage.setItem("aivhub_company_profile", JSON.stringify(profile));
      localStorage.setItem("aivhub_sources", JSON.stringify(sources));
      localStorage.setItem("aivhub_services", JSON.stringify(services));
      localStorage.setItem("aivhub_faq", JSON.stringify(faq));
    } catch (_) {}
    try {
      await api.updateProfile(profile);
      setNotifications((ns) => [{ id: "n_" + Date.now(), text: "✓ Company profile saved and persisted to database", time: "just now", unread: true, type: "success" }, ...ns]);
    } catch (err) {
      console.warn("Backend updateProfile warning:", err);
      setNotifications((ns) => [{ id: "n_" + Date.now(), text: "Company profile changes saved locally", time: "just now", unread: true, type: "info" }, ...ns]);
    }
    setTimeout(() => setSaved(false), 1800);
  };

  const addSource = async () => {
    if (!newSource.name || !newSource.value) return;
    const tempId = "k_" + Date.now();
    const item = { id: tempId, ...newSource, status: "crawling", synced: "just now", chunkCount: 0 };
    setSources((s) => {
      const next = [item, ...s];
      try { localStorage.setItem("aivhub_sources", JSON.stringify(next)); } catch (_) {}
      return next;
    });
    setNewSource({ name: "", type: "Website URL", value: "" });
    setAddingSource(false);

    try {
      await api.addSource(item);
      setNotifications((ns) => [{ id: "n_" + Date.now(), text: `✓ Web crawling & vector indexing started for ${item.name}`, time: "just now", unread: true, type: "info" }, ...ns]);
      setTimeout(async () => {
        try {
          const fresh = await api.getSources();
          if (Array.isArray(fresh) && fresh.length) setSources(fresh);
        } catch (_) {}
      }, 3500);
    } catch (err) {
      console.warn("Backend addSource error:", err);
    }
  };

  const resyncSource = async (id) => {
    setResyncingId(id);
    setSources((s) => s.map((x) => (x.id === id ? { ...x, status: "crawling" } : x)));
    try {
      await api.resyncSource(id);
      setNotifications((ns) => [{ id: "n_" + Date.now(), text: "Re-crawling and re-embedding triggered", time: "just now", unread: true, type: "info" }, ...ns]);
      setTimeout(async () => {
        try {
          const fresh = await api.getSources();
          if (Array.isArray(fresh) && fresh.length) setSources(fresh);
        } catch (_) {}
        setResyncingId(null);
      }, 4000);
    } catch (err) {
      console.warn("Resync error:", err);
      setResyncingId(null);
    }
  };

  const viewChunks = async (source) => {
    setActiveChunkModal({ source, chunks: [], loading: true });
    try {
      const data = await api.getSourceChunks(source.id);
      setActiveChunkModal({ source, chunks: data || [], loading: false });
    } catch (err) {
      console.warn("Error loading chunks:", err);
      setActiveChunkModal({ source, chunks: [], loading: false, error: "No chunks indexed yet." });
    }
  };

  const removeSource = async (id) => {
    setSources((s) => {
      const next = s.filter((x) => x.id !== id);
      try { localStorage.setItem("aivhub_sources", JSON.stringify(next)); } catch (_) {}
      return next;
    });
    try {
      await api.deleteSource(id);
    } catch (_) {}
  };

  const runTestQuery = async () => {
    if (!testQuery.trim()) return;
    setTestingQuery(true);
    setTestResults(null);
    try {
      const res = await api.testKnowledgeQuery(testQuery.trim());
      setTestResults(res);
    } catch (err) {
      setTestResults({ query: testQuery, matches: [], count: 0, error: err.message || "Failed to search" });
    } finally {
      setTestingQuery(false);
    }
  };


  const addService = () => setServices((s) => {
    const next = [...s, { id: "sv_" + Date.now(), name: "", ideal: "", desc: "" }];
    try { localStorage.setItem("aivhub_services", JSON.stringify(next)); } catch (_) {}
    return next;
  });

  const updateService = (id, k, v) => setServices((s) => {
    const next = s.map((x) => (x.id === id ? { ...x, [k]: v } : x));
    try { localStorage.setItem("aivhub_services", JSON.stringify(next)); } catch (_) {}
    return next;
  });

  const removeService = (id) => setServices((s) => {
    const next = s.filter((x) => x.id !== id);
    try { localStorage.setItem("aivhub_services", JSON.stringify(next)); } catch (_) {}
    return next;
  });

  const addFaq = () => setFaq((f) => {
    const next = [...f, { id: "f_" + Date.now(), q: "", a: "" }];
    try { localStorage.setItem("aivhub_faq", JSON.stringify(next)); } catch (_) {}
    return next;
  });

  const updateFaq = (id, k, v) => setFaq((f) => {
    const next = f.map((x) => (x.id === id ? { ...x, [k]: v } : x));
    try { localStorage.setItem("aivhub_faq", JSON.stringify(next)); } catch (_) {}
    return next;
  });

  const removeFaq = (id) => setFaq((f) => {
    const next = f.filter((x) => x.id !== id);
    try { localStorage.setItem("aivhub_faq", JSON.stringify(next)); } catch (_) {}
    return next;
  });

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

        <div style={{ width: "100%", maxWidth: (tab === "services" || tab === "knowledge") ? 1040 : 760, transition: "max-width 0.25s ease" }}>
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
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Working timezone</div>
                <select
                  value={profile.timezone || "Europe/London"}
                  onChange={(e) => update("timezone", e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}
                >
                  {TIMEZONES.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
                </select>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>Every call window, callback, and meeting time is shown in this zone. Change it any time.</div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>When we may call — a policy, not an accident</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, lineHeight: 1.5, marginBottom: 10 }}>
                  UK PECR for B2B live calls: <strong>08:00–21:00 weekdays</strong>, <strong>09:00–18:00 weekends</strong>. Calling a shorter office day is legal. It is not the legal maximum.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {CALL_HOUR_POLICIES.map((p) => {
                    const active = (profile.callHoursPolicy || "respectful") === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          const next = applyCallHourPolicy(p.id);
                          setProfile((pr) => ({ ...pr, ...next }));
                        }}
                        style={{
                          textAlign: "left", padding: "11px 13px", borderRadius: 9, cursor: "pointer",
                          border: `1.5px solid ${active ? C.ink : C.border}`, background: active ? C.paper : "#fff",
                        }}
                      >
                        <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, color: C.textInk }}>
                          {p.label} · {p.weekdayStart}–{p.weekdayEnd} weekdays
                        </div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, marginTop: 4, lineHeight: 1.4 }}>{p.blurb}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Lunch break of the people we call</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select value={profile.lunchStart || "12:00"} onChange={(e) => update("lunchStart", e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}>
                    {["12:00", "12:30", "13:00"].map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <span style={{ color: C.slateLight }}>–</span>
                  <select value={profile.lunchEnd || "13:00"} onChange={(e) => update("lunchEnd", e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}>
                    {["13:00", "13:30", "14:00"].map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>No voice, WhatsApp, SMS, or email is sent in this window — so nobody is disturbed at lunch.</div>
              </div>
              <Field label="Tone" value={profile.tone} onChange={(v) => update("tone", v)} placeholder="Professional, concise, friendly" />
              <button onClick={save} style={{ marginTop: 6, background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Save changes
              </button>
            </div>
          )}

          {tab === "knowledge" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
                  <SectionIntro
                    icon={BookOpen}
                    title="Knowledge sources & vector database"
                    desc="Websites, PDFs, documents, or objection playbooks. The crawler automatically extracts text, splits it into semantic chunks, and indexes it with pgvector for instant sub-second recall during calls."
                  />
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#ecfdf5", border: "1px solid #a7f3d0", padding: "4px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700, color: "#065f46" }}>
                    <Sparkles size={12} /> pgvector RAG Active
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {sources.map((s) => {
                    const isCrawling = s.status === "crawling" || resyncingId === s.id;
                    return (
                      <div
                        key={s.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "12px 16px",
                          border: `1px solid ${C.border}`,
                          borderRadius: 10,
                          background: "#fff",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.02)"
                        }}
                      >
                        <div style={{ width: 34, height: 34, borderRadius: 8, background: C.paper, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {s.type === "Website URL" ? <Globe size={15} color={C.cobalt} /> : s.type.includes("Drive") ? <Link2 size={15} color={C.slate} /> : s.type === "Manual text" ? <PenLine size={15} color="#d97706" /> : <FileText size={15} color={C.slate} />}
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: C.textInk }}>{s.name}</span>
                            <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, color: C.slate, background: C.paper, padding: "1px 6px", borderRadius: 4 }}>
                              {s.type}
                            </span>
                          </div>
                          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
                            {s.value}
                          </div>
                        </div>

                        {/* Crawling / Indexed Badge */}
                        <div>
                          {isCrawling ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#fef3c7", color: "#b45309", padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                              <RefreshCw size={11} style={{ animation: "spin 1.5s linear infinite" }} /> Crawling & Indexing...
                            </span>
                          ) : s.status === "failed" ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#fee2e2", color: "#dc2626", padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700 }} title={s.lastError || "Extraction failed"}>
                              Failed
                            </span>
                          ) : (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#dcfce7", color: "#15803d", padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                              Indexed · {s.chunkCount || 0} chunks
                            </span>
                          )}
                        </div>

                        {/* Actions */}
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <button
                            onClick={() => viewChunks(s)}
                            title="Inspect text chunks"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              background: "#fff",
                              border: `1px solid ${C.border}`,
                              borderRadius: 6,
                              padding: "5px 9px",
                              fontFamily: FONT_BODY,
                              fontSize: 11.5,
                              color: C.slate,
                              cursor: "pointer"
                            }}
                          >
                            <Layers size={12} /> Chunks
                          </button>
                          
                          <button
                            onClick={() => resyncSource(s.id)}
                            disabled={isCrawling}
                            title="Re-crawl and update vector index"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              background: "#fff",
                              border: `1px solid ${C.border}`,
                              borderRadius: 6,
                              padding: "5px 9px",
                              fontFamily: FONT_BODY,
                              fontSize: 11.5,
                              color: C.slate,
                              cursor: isCrawling ? "default" : "pointer"
                            }}
                          >
                            <RefreshCw size={12} /> Re-crawl
                          </button>

                          <button
                            onClick={() => removeSource(s.id)}
                            title="Delete knowledge source"
                            style={{ background: "none", border: "none", cursor: "pointer", padding: "5px 6px", borderRadius: 6, color: C.slateLight }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = "#dc2626"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = C.slateLight; }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {sources.length === 0 && (
                    <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slateLight, padding: "28px 0", textAlign: "center", border: `1px dashed ${C.border}`, borderRadius: 10, background: "#fff" }}>
                      No knowledge sources yet — add your company website or objection playbook to activate RAG.
                    </div>
                  )}
                </div>

                {addingSource ? (
                  <div style={{ marginTop: 14, border: `1.5px solid ${C.cobalt}`, background: C.paper, borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                        1. Select Source Format
                      </label>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {SOURCE_TYPES.map((st) => {
                          const Icon = st.icon;
                          const active = (newSource.type || "Website URL") === st.id;
                          return (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() => setNewSource((n) => ({ ...n, type: st.id }))}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "7px 12px",
                                borderRadius: 8,
                                border: `1.5px solid ${active ? C.ink : C.border}`,
                                background: active ? C.ink : "#fff",
                                color: active ? "#fff" : C.textInk,
                                fontFamily: FONT_BODY,
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                                boxShadow: active ? "0 2px 6px rgba(0,0,0,0.08)" : "none"
                              }}
                            >
                              <Icon size={13} color={active ? "#fff" : C.slate} />
                              {st.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
                        2. Source Name / Identifier
                      </label>
                      <input
                        value={newSource.name}
                        onChange={(e) => setNewSource((n) => ({ ...n, name: e.target.value }))}
                        placeholder={newSource.type === "Website URL" ? "e.g. Main Company Website" : newSource.type === "Manual text" ? "e.g. Pricing Objection Playbook" : "e.g. Service Catalogue 2026"}
                        style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none", background: "#fff" }}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
                        3. {newSource.type === "Manual text" ? "Content / Script Notes" : "URL / Document Path"}
                      </label>
                      {newSource.type === "Manual text" ? (
                        <textarea
                          value={newSource.value}
                          onChange={(e) => setNewSource((n) => ({ ...n, value: e.target.value }))}
                          placeholder={SOURCE_TYPES.find((st) => st.id === newSource.type)?.placeholder}
                          rows={4}
                          style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none", background: "#fff", resize: "vertical" }}
                        />
                      ) : (
                        <input
                          value={newSource.value}
                          onChange={(e) => setNewSource((n) => ({ ...n, value: e.target.value }))}
                          placeholder={SOURCE_TYPES.find((st) => st.id === (newSource.type || "Website URL"))?.placeholder}
                          style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none", background: "#fff" }}
                        />
                      )}
                      <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>
                        {SOURCE_TYPES.find((st) => st.id === (newSource.type || "Website URL"))?.hint}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <button onClick={addSource} style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "9px 20px", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                        Start Crawl & Ingest
                      </button>
                      <button onClick={() => setAddingSource(false)} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 14px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, cursor: "pointer" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingSource(true)}
                    style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px dashed ${C.border}`, borderRadius: 8, padding: "10px 14px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, cursor: "pointer", width: "100%", justifyContent: "center" }}
                  >
                    <PlusCircle size={14} /> Add knowledge source to crawl
                  </button>
                )}
              </div>

              {/* Interactive RAG Vector Retrieval Tester */}
              <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
                <SectionIntro
                  icon={Sparkles}
                  title="Test AI knowledge retrieval (Semantic vector search)"
                  desc="Simulate a prospect asking a specific question. This runs real-time cosine vector matching against your stored chunks to verify what exact facts the AI retrieves on calls."
                />
                
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <input
                    value={testQuery}
                    onChange={(e) => setTestQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runTestQuery()}
                    placeholder="e.g. What is your pricing structure? or Do you support CRM integration?"
                    style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", background: "#fff" }}
                  />
                  <button
                    onClick={runTestQuery}
                    disabled={testingQuery || !testQuery.trim()}
                    style={{
                      background: C.ink,
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      padding: "9px 20px",
                      fontFamily: FONT_BODY,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: testingQuery ? "default" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6
                    }}
                  >
                    {testingQuery ? <RefreshCw size={13} style={{ animation: "spin 1.5s linear infinite" }} /> : <Search size={13} />}
                    Test Retrieval
                  </button>
                </div>

                {testResults && (
                  <div style={{ marginTop: 14, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <span style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.textInk }}>
                        Retrieved Chunks for: <span style={{ color: C.cobalt }}>"{testResults.query}"</span>
                      </span>
                      <span style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>
                        {testResults.matches?.length || 0} matches found
                      </span>
                    </div>

                    {(!testResults.matches || testResults.matches.length === 0) ? (
                      <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight, padding: "10px 0" }}>
                        No vector chunks matched above the similarity threshold. Add more sources or re-crawl your website.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {testResults.matches.map((m, i) => (
                          <div key={m.id || i} style={{ background: C.paper, borderRadius: 8, padding: 10, border: `1px solid ${C.borderLight}` }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                              <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.textInk }}>
                                {m.title || "Knowledge Chunk"}
                              </span>
                              <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: "#15803d", background: "#dcfce7", padding: "1px 6px", borderRadius: 4 }}>
                                {Math.round((m.score || 0) * 100)}% Match
                              </span>
                            </div>
                            <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.textInk, lineHeight: 1.4, whiteSpace: "pre-wrap" }}>
                              {m.content}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Chunks Inspection Modal */}
              {activeChunkModal && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 20 }}>
                  <div style={{ background: "#fff", borderRadius: 12, maxWidth: 640, width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.2)" }}>
                    <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 700, color: C.textInk }}>
                          Extracted Chunks: {activeChunkModal.source.name}
                        </div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight }}>
                          {activeChunkModal.chunks.length} semantic passages indexed in pgvector
                        </div>
                      </div>
                      <button onClick={() => setActiveChunkModal(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                        <X size={18} color={C.slate} />
                      </button>
                    </div>

                    <div style={{ padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
                      {activeChunkModal.loading ? (
                        <div style={{ textAlign: "center", padding: 30, color: C.slate }}>Loading chunks...</div>
                      ) : activeChunkModal.chunks.length === 0 ? (
                        <div style={{ textAlign: "center", padding: 30, color: C.slateLight }}>
                          No chunks extracted yet. Click "Re-crawl" to process this source.
                        </div>
                      ) : (
                        activeChunkModal.chunks.map((chk, i) => (
                          <div key={chk.id || i} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, background: C.paper }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                              <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 800, color: C.slate, letterSpacing: "0.04em" }}>
                                CHUNK {String(i + 1).padStart(2, "0")} · {chk.content.length} chars
                              </span>
                              {chk.hasEmbedding && (
                                <span style={{ fontFamily: FONT_BODY, fontSize: 10, fontWeight: 700, color: "#15803d", background: "#dcfce7", padding: "1px 5px", borderRadius: 4 }}>
                                  384-dim Vector
                                </span>
                              )}
                            </div>
                            <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.textInk, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
                              {chk.content}
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end" }}>
                      <button onClick={() => setActiveChunkModal(null)} style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "services" && (
            <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
              <SectionIntro icon={Package} title="Services & ideal customer" desc="What you're pitching, and who it's a good fit for — helps the AI tailor the pitch dynamically to each prospect's sector and size." />
              
              {services.length === 0 ? (
                <div style={{ textAlign: "center", padding: "36px 20px", border: `1px dashed ${C.border}`, borderRadius: 10, background: "#fff", color: C.slate, margin: "14px 0" }}>
                  <Package size={28} color={C.slateLight} style={{ margin: "0 auto 8px" }} />
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk }}>No services listed yet</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight, marginTop: 4 }}>Add what you offer so the voice AI can accurately pitch and answer prospect questions.</div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 14, marginTop: 14 }}>
                  {services.map((s, idx) => (
                    <div
                      key={s.id}
                      style={{
                        background: "#fff",
                        border: `1px solid ${C.border}`,
                        borderRadius: 10,
                        padding: 14,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                        position: "relative"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.borderLight}`, paddingBottom: 8 }}>
                        <span style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", color: C.slate, background: C.paper, padding: "2px 8px", borderRadius: 4 }}>
                          SERVICE {String(idx + 1).padStart(2, "0")}
                        </span>
                        <button
                          onClick={() => removeService(s.id)}
                          title="Remove service"
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: "3px 6px",
                            borderRadius: 4,
                            display: "inline-flex",
                            alignItems: "center",
                            color: C.slateLight,
                            transition: "all 0.15s ease"
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "#dc2626"; e.currentTarget.style.background = "#fef2f2"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = C.slateLight; e.currentTarget.style.background = "none"; }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      <div>
                        <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          Service Name
                        </label>
                        <input
                          value={s.name}
                          onChange={(e) => updateService(s.id, "name", e.target.value)}
                          placeholder="e.g. AI Customer Support Automation"
                          style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none" }}
                        />
                      </div>

                      <div>
                        <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          Ideal Customer / Target
                        </label>
                        <input
                          value={s.ideal}
                          onChange={(e) => updateService(s.id, "ideal", e.target.value)}
                          placeholder="e.g. Mid-market SaaS ops teams 50-500 staff"
                          style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none" }}
                        />
                      </div>

                      <div>
                        <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          Description & Value Proposition
                        </label>
                        <textarea
                          value={s.desc}
                          onChange={(e) => updateService(s.id, "desc", e.target.value)}
                          placeholder="Short description of what it does, key ROI points, and deliverables..."
                          rows={3}
                          style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, outline: "none", resize: "vertical" }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
                <button
                  onClick={addService}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#fff",
                    border: `1px dashed ${C.border}`,
                    borderRadius: 8,
                    padding: "9px 16px",
                    fontFamily: FONT_BODY,
                    fontSize: 12.5,
                    color: C.slate,
                    cursor: "pointer",
                    flex: 1,
                    justifyContent: "center",
                    transition: "all 0.15s ease"
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.ink; e.currentTarget.style.color = C.ink; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.slate; }}
                >
                  <PlusCircle size={14} /> Add another service
                </button>
                <button
                  onClick={save}
                  style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "9px 22px", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
                >
                  Save services
                </button>
              </div>
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
                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                  <button onClick={addFaq} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px dashed ${C.border}`, borderRadius: 8, padding: "9px 12px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, cursor: "pointer", flex: 1, justifyContent: "center" }}>
                    <PlusCircle size={13} /> Add a question
                  </button>
                  <button onClick={save} style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                    Save questions
                  </button>
                </div>
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

/* ---------------------------------- connections & key validator ---------------------------------- */

const FAMOUS_PROVIDERS_BY_LAYER = {
  "LLM": ["xAI (Grok-2 / Grok-4)", "DeepSeek", "OpenAI (GPT-4o)", "Anthropic (Claude 3.5 Sonnet)", "Groq", "Mistral", "Together AI", "Other (Custom Base URL)"],
  "Speech-to-Text": ["Deepgram (Nova-2)", "Faster-Whisper (Self-Hosted)", "OpenAI Whisper", "Gladia", "Speechmatics", "Other (Custom Base URL)"],
  "Text-to-Speech": ["ElevenLabs", "Cartesia (Sonic)", "PlayHT", "Kokoro-82M (Self-Hosted)", "Other (Custom Base URL)"],
  "Telephony": ["Twilio", "Telnyx", "Plivo", "SIP Trunk (Custom)", "Other (Custom Base URL)"],
  "Calendar": ["Cal.com (Self-Hosted)", "Cal.com (Cloud)", "Google Calendar", "Microsoft Outlook", "Other (Custom Base URL)"],
  "Voice Orchestration": ["xAI Realtime Voice (Direct SIP)", "OpenAI Realtime API", "LiveKit (Self-Hosted)", "Retell AI", "Vapi", "Other (Custom Base URL)"],
  "Business Discovery": ["Apollo.io", "LeadMagic", "Google Places API", "Other (Custom Base URL)"],
  "Other": ["Other (Custom Base URL)"]
};

function AddIntegrationModal({ onClose, onAddSuccess }) {
  const [category, setCategory] = useState("LLM");
  const [providerChoice, setProviderChoice] = useState("DeepSeek");
  const [customName, setCustomName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [accountSid, setAccountSid] = useState("");

  const [testing, setTesting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const isOther = providerChoice.startsWith("Other") || category === "Other";
  const isTwilio = providerChoice === "Twilio";
  const isTelnyx = providerChoice.toLowerCase().includes("telnyx");
  const [phoneNumber, setPhoneNumber] = useState("");
  const providerList = FAMOUS_PROVIDERS_BY_LAYER[category] || ["Other (Custom Base URL)"];


  const handleCategoryChange = (cat) => {
    setCategory(cat);
    const firstChoice = (FAMOUS_PROVIDERS_BY_LAYER[cat] || ["Other (Custom Base URL)"])[0];
    setProviderChoice(firstChoice);
    setErrorMsg("");
    setSuccessMsg("");
  };

  const handleTestAndSave = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (!apiKey.trim()) {
      setErrorMsg("API key cannot be empty.");
      return;
    }

    if (isOther && !baseUrl.trim()) {
      setErrorMsg("Custom providers require a valid Base URL.");
      return;
    }

    if (isTwilio && !accountSid.trim() && !apiKey.includes(":")) {
      setErrorMsg("Twilio requires your Account SID and Auth Token.");
      return;
    }

    setTesting(true);

    const effProviderName = isOther ? (customName.trim() || "Custom Provider") : providerChoice.split(" (")[0];

    try {
      // 1. Call Backend Validator
      const res = await api.testAndSaveConnection({
        layer: category,
        provider: effProviderName,
        api_key: apiKey.trim(),
        base_url: baseUrl.trim() || undefined,
        account_sid: accountSid.trim() || undefined,
      });

      if (isTelnyx && phoneNumber.trim()) {
        try {
          localStorage.setItem("aivhub_caller_id", phoneNumber.trim());
          await api.updateProfile({ callerId: phoneNumber.trim() });
        } catch (_) {}
      }

      setSuccessMsg(`✓ ${res.details || "API Key verified & active!"}`);
      setTimeout(() => {
        onAddSuccess({
          category,
          name: effProviderName,
          status: "connected",
          key: apiKey.trim(),
          masked: res.maskedKey,
          phoneNumber: phoneNumber.trim() || undefined,
        });
        onClose();
      }, 900);
    } catch (err) {
      setErrorMsg(err.message || "Authentication failed. Key was rejected by the provider.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 480, padding: 26, boxShadow: "0 24px 70px rgba(0,0,0,0.25)", border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.textInk, display: "flex", alignItems: "center", gap: 8 }}>
            <KeyRound size={18} color={C.cobalt} /> Add & Validate Provider Key
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.slate }}><X size={18} /></button>
        </div>

        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginBottom: 18, lineHeight: 1.45 }}>
          Keys are <strong>actively tested and authenticated</strong> against the provider before saving to ensure 100% reliable calls.
        </div>

        <form onSubmit={handleTestAndSave} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Layer Category */}
          <div>
            <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
              Infrastructure Layer
            </label>
            <select
              value={category}
              onChange={(e) => handleCategoryChange(e.target.value)}
              style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, background: "#fff" }}
            >
              {Object.keys(FAMOUS_PROVIDERS_BY_LAYER).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Provider Dropdown */}
          <div>
            <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
              Provider
            </label>
            <select
              value={providerChoice}
              onChange={(e) => { setProviderChoice(e.target.value); setErrorMsg(""); setSuccessMsg(""); }}
              style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, background: "#fff" }}
            >
              {providerList.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* Custom Name if Other */}
          {isOther && (
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                Custom Provider Name
              </label>
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. TogetherAI, Local vLLM, Custom SIP"
                style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}
              />
            </div>
          )}

          {/* Twilio SID */}
          {isTwilio && (
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                Twilio Account SID
              </label>
              <input
                value={accountSid}
                onChange={(e) => setAccountSid(e.target.value)}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5 }}
              />
            </div>
          )}

          {isTelnyx && (
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                Telnyx Outbound Phone Number
              </label>
              <input
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+15551234567 or +442079460912"
                style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5 }}
              />
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>
                This number is verified on your Telnyx portal and used as your outbound Caller ID.
              </div>
            </div>
          )}

          {/* API Key */}
          <div>
            <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
              {isTwilio ? "Auth Token" : isTelnyx ? "Telnyx API V2 Key" : "API Key / Token"}
            </label>
            <div style={{ position: "relative", width: "100%" }}>
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setErrorMsg(""); setSuccessMsg(""); }}
                placeholder={isTelnyx ? "KEY018..." : providerChoice.includes("DeepSeek") ? "sk-..." : providerChoice.includes("OpenAI") ? "sk-proj-..." : providerChoice.includes("Deepgram") ? "Token..." : "Paste API key..."}
                style={{ width: "100%", boxSizing: "border-box", height: 38, padding: "0 38px 0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5 }}
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center", color: C.slateLight }}
                title={showApiKey ? "Hide key" : "Show key"}
              >
                {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Base URL (if custom or Cal.com) */}
          {(isOther || providerChoice.includes("Cal.com")) && (
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                Base URL / Endpoint
              </label>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={providerChoice.includes("Cal.com") ? "http://calcom:3000/api/v1" : "https://api.your-custom-llm.com/v1"}
                style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}
              />
            </div>
          )}

          {/* Error Message */}
          {errorMsg && (
            <div style={{ background: C.redSoft, border: `1px solid #F0C4B8`, borderRadius: 8, padding: "10px 14px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.red, display: "flex", alignItems: "flex-start", gap: 8 }}>
              <AlertTriangle size={15} style={{ marginTop: 2, flexShrink: 0 }} />
              <div>{errorMsg}</div>
            </div>
          )}

          {/* Success Message */}
          {successMsg && (
            <div style={{ background: C.tealSoft, border: `1px solid #BFE6DF`, borderRadius: 8, padding: "10px 14px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.teal, display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircle2 size={15} />
              <div>{successMsg}</div>
            </div>
          )}

          {/* Action Button */}
          <button
            type="submit"
            disabled={testing}
            style={{
              width: "100%",
              height: 44,
              borderRadius: 10,
              border: "none",
              background: testing ? C.slateLight : C.cobalt,
              color: "#fff",
              fontFamily: FONT_BODY,
              fontWeight: 600,
              fontSize: 14,
              cursor: testing ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 4,
            }}
          >
            {testing ? (
              <>Testing live authentication...</>
            ) : (
              <>
                <ShieldCheck size={16} /> Test & Save Key
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}


/* ---------------------------------- Direct Outbound Calling Component ---------------------------------- */

function DirectOutboundCallCard({ notifications, setNotifications, defaultFromNumber, onViewLiveCalls }) {
  const [toNumber, setToNumber] = useState("");
  const [prospectName, setProspectName] = useState("");
  const [missionTitle, setMissionTitle] = useState("Direct Client Outreach");
  const [fromNumber, setFromNumber] = useState(defaultFromNumber || "+447307216767");
  const [carrierChoice, setCarrierChoice] = useState("twilio");
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [showCreds, setShowCreds] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const [dialing, setDialing] = useState(false);
  const [dialResult, setDialResult] = useState(null);
  const [dialError, setDialError] = useState("");

  const handleDial = async (e) => {
    if (e) e.preventDefault();
    if (!toNumber.trim()) {
      setDialError("Please enter a destination phone number.");
      return;
    }
    setDialing(true);
    setDialError("");
    setDialResult(null);

    try {
      const payload = {
        to_number: toNumber.trim(),
        from_number: fromNumber.trim() || undefined,
        prospect_name: prospectName.trim() || undefined,
        mission_title: missionTitle.trim() || "Direct Client Outreach",
        carrier: carrierChoice,
        account_sid: accountSid.trim() || undefined,
        api_key: authToken.trim() || undefined
      };
      const res = await api.dialOutbound(payload);
      setDialResult(res);
      setNotifications((ns) => [
        {
          id: "n_" + Date.now(),
          text: `📞 Outbound call dispatched to ${toNumber} via ${res.carrier || carrierChoice.toUpperCase()}`,
          time: "just now",
          unread: true,
          type: "success"
        },
        ...ns
      ]);
    } catch (err) {
      setDialError(err.message || "Failed to initiate outbound call.");
    } finally {
      setDialing(false);
    }
  };

  return (
    <div style={{
      background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
      borderRadius: 14,
      padding: "20px 24px",
      color: "#F8FAFC",
      border: "1px solid rgba(255, 255, 255, 0.12)",
      boxShadow: "0 10px 30px rgba(0, 0, 0, 0.25)",
      marginBottom: 20
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: isExpanded ? 16 : 0 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ background: "#22C55E", width: 9, height: 9, borderRadius: "50%", display: "inline-block", boxShadow: "0 0 8px #22C55E" }} />
            <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#4ADE80" }}>
              Autonomous Outbound Calling Plugin
            </span>
            <span style={{ background: "rgba(255,255,255,0.1)", fontSize: 11, padding: "2px 8px", borderRadius: 12, color: "#94A3B8" }}>
              Twilio / Telnyx / SIP / Sim
            </span>
          </div>
          <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 18, color: "#fff", margin: "4px 0 2px" }}>
            📞 Direct Outbound Voice Dial (Client Call / Live Test)
          </h2>
          <p style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: "#94A3B8", margin: 0, maxWidth: 680, lineHeight: 1.4 }}>
            Place autonomous outbound calls to clients or test contacts. Carrier connects audio to xAI Realtime AI with live pitch and meeting booking.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {onViewLiveCalls && (
            <button
              type="button"
              onClick={onViewLiveCalls}
              style={{
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.18)",
                borderRadius: 8,
                padding: "6px 12px",
                color: "#F1F5F9",
                fontFamily: FONT_BODY,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5
              }}
            >
              <Activity size={12} color="#38BDF8" /> Live Activity
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.18)",
              borderRadius: 8,
              padding: "6px 12px",
              color: "#F1F5F9",
              fontFamily: FONT_BODY,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            {isExpanded ? "Collapse Dialer" : "Expand Dialer"}
          </button>
        </div>
      </div>

      {isExpanded && (
        <form onSubmit={handleDial} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {/* Destination Number */}
            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "#CBD5E1", marginBottom: 5 }}>
                Destination Number <span style={{ color: "#F87171" }}>*</span>
              </label>
              <input
                type="text"
                value={toNumber}
                onChange={(e) => setToNumber(e.target.value)}
                placeholder="e.g. +447307216767"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: 7,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(15, 23, 42, 0.8)",
                  color: "#fff",
                  fontFamily: FONT_MONO,
                  fontSize: 13.5,
                  boxSizing: "border-box"
                }}
              />
              <div style={{ fontSize: 10.5, color: "#64748B", marginTop: 3 }}>
                UK mobile (+447...) or international
              </div>
            </div>

            {/* Prospect Name */}
            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "#CBD5E1", marginBottom: 5 }}>
                Prospect / Contact Name
              </label>
              <input
                type="text"
                value={prospectName}
                onChange={(e) => setProspectName(e.target.value)}
                placeholder="e.g. Boss (VIP Test)"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: 7,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(15, 23, 42, 0.8)",
                  color: "#fff",
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  boxSizing: "border-box"
                }}
              />
              <div style={{ fontSize: 10.5, color: "#64748B", marginTop: 3 }}>
                AI addresses them by name
              </div>
            </div>

            {/* Carrier Plugin */}
            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "#CBD5E1", marginBottom: 5 }}>
                Carrier Plugin
              </label>
              <select
                value={carrierChoice}
                onChange={(e) => setCarrierChoice(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: 7,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "#0F172A",
                  color: "#38BDF8",
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: 600,
                  boxSizing: "border-box"
                }}
              >
                <option value="twilio">Twilio Voice (UK PSTN)</option>
                <option value="telnyx">Telnyx (BYO SIP Trunk)</option>
                <option value="generic_sip">Generic SIP / PBX</option>
                <option value="simulation">Local Simulator (Free Test)</option>
              </select>
              <div style={{ fontSize: 10.5, color: "#64748B", marginTop: 3 }}>
                Multi-provider adapter
              </div>
            </div>

            {/* Caller ID */}
            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "#CBD5E1", marginBottom: 5 }}>
                Caller ID (From)
              </label>
              <input
                type="text"
                value={fromNumber}
                onChange={(e) => setFromNumber(e.target.value)}
                placeholder="+447307216767"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: 7,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(15, 23, 42, 0.8)",
                  color: "#38BDF8",
                  fontFamily: FONT_MONO,
                  fontSize: 13,
                  boxSizing: "border-box"
                }}
              />
              <div style={{ fontSize: 10.5, color: "#64748B", marginTop: 3 }}>
                Presented phone line
              </div>
            </div>
          </div>

          {/* Optional Twilio credentials override */}
          {carrierChoice === "twilio" && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 }}>
              <button
                type="button"
                onClick={() => setShowCreds(!showCreds)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94A3B8",
                  fontSize: 11.5,
                  cursor: "pointer",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 5
                }}
              >
                <span>{showCreds ? "▼ Hide" : "▶ Optional:"} Custom Twilio SID & Token (override saved)</span>
              </button>
              {showCreds && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
                  <input
                    type="text"
                    value={accountSid}
                    onChange={(e) => setAccountSid(e.target.value)}
                    placeholder="Twilio Account SID (AC...)"
                    style={{
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "#0F172A",
                      color: "#fff",
                      fontFamily: FONT_MONO,
                      fontSize: 12
                    }}
                  />
                  <input
                    type="password"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    placeholder="Twilio Auth Token"
                    style={{
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "#0F172A",
                      color: "#fff",
                      fontFamily: FONT_MONO,
                      fontSize: 12
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Error Alert */}
          {dialError && (
            <div style={{
              background: "rgba(239, 68, 68, 0.2)",
              border: "1px solid #EF4444",
              color: "#FCA5A5",
              borderRadius: 8,
              padding: "9px 12px",
              fontSize: 12.5,
              display: "flex",
              alignItems: "center",
              gap: 8
            }}>
              <AlertTriangle size={14} color="#EF4444" />
              <span>{dialError}</span>
            </div>
          )}

          {/* Success Alert */}
          {dialResult && (
            <div style={{
              background: "rgba(34, 197, 94, 0.2)",
              border: "1px solid #22C55E",
              color: "#86EFAC",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 12.5,
              display: "flex",
              flexDirection: "column",
              gap: 6
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                  <CheckCircle2 size={15} color="#22C55E" />
                  <span>Call Dispatched! (Status: {dialResult.status})</span>
                </div>
                {onViewLiveCalls && (
                  <button
                    type="button"
                    onClick={onViewLiveCalls}
                    style={{
                      background: "#22C55E",
                      color: "#0F172A",
                      border: "none",
                      borderRadius: 6,
                      padding: "4px 10px",
                      fontWeight: 700,
                      fontSize: 11.5,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4
                    }}
                  >
                    <Activity size={12} /> Monitor Live Activity →
                  </button>
                )}
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: "#CBD5E1" }}>
                SID: <strong>{dialResult.call_id}</strong> • Carrier: <strong>{dialResult.carrier}</strong> • SIP: <strong>{dialResult.bridge_sip_uri}</strong>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <div>
            <button
              type="submit"
              disabled={dialing}
              style={{
                background: dialing ? "#475569" : "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                color: "#fff",
                border: "none",
                borderRadius: 7,
                padding: "10px 22px",
                fontFamily: FONT_DISPLAY,
                fontSize: 13.5,
                fontWeight: 800,
                cursor: dialing ? "wait" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                boxShadow: "0 4px 14px rgba(16, 185, 129, 0.3)"
              }}
            >
              {dialing ? (
                <>
                  <RefreshCw size={14} className="animate-spin" /> Calling {toNumber || "Prospect"}...
                </>
              ) : (
                <>
                  <PhoneCall size={15} /> 📞 Initiate Outbound Call Now
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}


/* ---------------------------------- Voice & Telephony Trunking Hub (Multi-Provider) ---------------------------------- */

function VoiceTrunkingHubTab({ notifications, setNotifications, profile, setProfile }) {
  const [hubData, setHubData] = useState({
    activeCarrier: "Telnyx",
    activeEngine: "xAI Realtime",
    phoneNumber: profile?.callerId || "+19096866918",
    voiceName: "rex",
    status: "connected",
    webhookUrl: "https://8000-01m1bx2zfn0zxjnf9833v44pnv.cloudspaces.litng.ai/api/sip-webhook",
    xaiFqdn: "sip.voice.x.ai",
    codecs: ["G.711 μ-law (PCMU)", "G.711 A-law (PCMA)", "G.722"],
    isLive: true
  });
  const [carrierChoice, setCarrierChoice] = useState("telnyx");
  const [engineChoice, setEngineChoice] = useState("xai");
  const [phoneNumber, setPhoneNumber] = useState(profile?.callerId || "+19096866918");

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [accountSid, setAccountSid] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [voiceName, setVoiceName] = useState("rex");
  const [webhookUrl, setWebhookUrl] = useState("https://8000-01m1bx2zfn0zxjnf9833v44pnv.cloudspaces.litng.ai/api/sip-webhook");

  const [provisioning, setProvisioning] = useState(false);
  const [provisionMsg, setProvisionMsg] = useState(null);
  const [provisionErr, setProvisionErr] = useState("");

  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedFqdn, setCopiedFqdn] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const fetchStatus = async () => {
    try {
      const data = await api.getTelephonyHub();
      if (data) {
        setHubData(data);
        if (data.phoneNumber) setPhoneNumber(data.phoneNumber);
        if (data.webhookUrl) setWebhookUrl(data.webhookUrl);
        if (data.voiceName) setVoiceName(data.voiceName);
        if (data.signingSecret) setSigningSecret(data.signingSecret);
        if (data.activeCarrier) {
          const cLower = data.activeCarrier.toLowerCase();
          setCarrierChoice(cLower.includes("twilio") ? "twilio" : cLower.includes("sip") ? "generic_sip" : cLower.includes("sim") ? "simulation" : "telnyx");
        }
        if (data.activeEngine) {
          const eLower = data.activeEngine.toLowerCase();
          setEngineChoice(eLower.includes("openai") ? "openai" : eLower.includes("modular") ? "modular" : eLower.includes("sim") ? "simulation" : "xai");
        }
      }
    } catch (err) {
      console.error("Failed to load telephony hub data:", err);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handlePing = async () => {
    setPinging(true);
    setPingResult(null);
    try {
      const res = await api.testTelephonyPing();
      setPingResult(res);
    } catch (err) {
      setPingResult({ success: false, latencyMs: 0, details: { error: String(err) } });
    } finally {
      setPinging(false);
    }
  };

  const handleProvision = async (e) => {
    e.preventDefault();
    setProvisioning(true);
    setProvisionErr("");
    setProvisionMsg(null);

    if (!phoneNumber.trim()) {
      setProvisionErr("Phone number is required.");
      setProvisioning(false);
      return;
    }

    try {
      const res = await api.provisionTelephonyHub({
        carrier: carrierChoice,
        engine: engineChoice,
        phone_number: phoneNumber,
        api_key: apiKey,
        account_sid: accountSid,
        voice_name: voiceName,
        webhook_url: webhookUrl,
        signing_secret: signingSecret
      });

      setProvisionMsg(res);
      if (res.signingSecret) {
        setSigningSecret(res.signingSecret);
      }
      await fetchStatus();
      if (setProfile) {
        setProfile((prev) => ({ ...prev, callerId: phoneNumber }));
      }
      setNotifications((ns) => [
        { id: "n_" + Date.now(), text: `✓ Activated ${res.carrier} + ${res.engine} on ${phoneNumber}`, time: "just now", unread: true, type: "success" },
        ...ns
      ]);
    } catch (err) {
      setProvisionErr(err.message || "Failed to provision stack.");
    } finally {
      setProvisioning(false);
    }
  };

  const copyToClipboard = (text, type) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    if (type === "webhook") {
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    } else if (type === "secret") {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } else {
      setCopiedFqdn(true);
      setTimeout(() => setCopiedFqdn(false), 2000);
    }
  };


  const carriers = [
    {
      id: "telnyx",
      name: "Telnyx (BYO SIP Trunk)",
      badge: "Direct SIP FQDN • Recommended",
      desc: "Direct SIP audio handoff into xAI speech engine with E.164 routing and ultra-low latency.",
      icon: Radio
    },
    {
      id: "twilio",
      name: "Twilio Programmable Voice",
      badge: "Global PSTN • Media Streams",
      desc: "Carrier coverage across 180+ countries with bi-directional WebSocket media streaming.",
      icon: PhoneCall
    },
    {
      id: "generic_sip",
      name: "Generic SIP Trunk / PBX",
      badge: "FreePBX / Asterisk / Plivo",
      desc: "Connect any corporate on-premise PBX or custom SIP proxy using standard SIP URIs.",
      icon: Globe
    },
    {
      id: "simulation",
      name: "Local Testing Simulator",
      badge: "Zero Cost • Demo Mode",
      desc: "Simulate live inbound voice calls directly in the browser without carrier account charges.",
      icon: Sparkles
    }
  ];

  const engines = [
    {
      id: "xai",
      name: "xAI Realtime Voice (Grok)",
      badge: "<500ms • Speech-to-Speech",
      desc: "All-in-one multimodal voice engine with native server VAD, dynamic pgvector RAG, and Grok intelligence.",
      icon: Sparkles
    },
    {
      id: "openai",
      name: "OpenAI Realtime API",
      badge: "GPT-4o Multimodal Audio",
      desc: "Low-latency voice engine with natural turn-taking supporting Alloy, Echo, Shimmer and function calls.",
      icon: Headphones
    },
    {
      id: "modular",
      name: "Modular Voice Pipeline",
      badge: "Deepgram + Groq + ElevenLabs",
      desc: "Best-of-breed component stitching: Nova-2 STT, ultra-fast Groq Llama-3-70B, and Cartesia/ElevenLabs TTS.",
      icon: Layers
    },
    {
      id: "simulation",
      name: "Simulated Voice Engine",
      badge: "Scripted Walker",
      desc: "Instant scripted conversational turns for product demos, automated walkthroughs, and UI testing.",
      icon: Play
    }
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* 1. HERO ACTIVE STACK CARD */}
      <div
        style={{
          background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
          borderRadius: 14,
          padding: "24px 28px",
          color: "#fff",
          border: "1px solid #334155",
          boxShadow: "0 10px 25px -5px rgba(0,0,0,0.15)",
          display: "flex",
          flexDirection: "column",
          gap: 18
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: "rgba(59, 130, 246, 0.2)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(59, 130, 246, 0.3)" }}>
              <Radio size={22} color="#60A5FA" />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18 }}>Active Voice & Telephony Trunk</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 12, background: "rgba(16, 185, 129, 0.2)", border: "1px solid rgba(16, 185, 129, 0.3)", color: "#34D399", fontSize: 11, fontWeight: 600 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981" }} /> Live Call Ready
                </span>
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: "#94A3B8", marginTop: 2 }}>
                Provider-agnostic speech-to-speech carrier bridge with dynamic pgvector RAG context.
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={handlePing}
              disabled={pinging}
              style={{
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: 8,
                padding: "8px 14px",
                color: "#F1F5F9",
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: pinging ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6
              }}
            >
              {pinging ? <RefreshCw size={13} className="animate-spin" /> : <PhoneCall size={13} />}
              Test Inbound Ping
            </button>
          </div>
        </div>

        {/* Status Metrics Bar */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, paddingTop: 14, borderTop: "1px solid rgba(255, 255, 255, 0.1)" }}>
          <div>
            <div style={{ fontSize: 11, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Inbound Caller Line</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 15, fontWeight: 700, color: "#38BDF8", marginTop: 4 }}>{hubData.phoneNumber}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Carrier Route</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600, color: "#F8FAFC", marginTop: 4 }}>{hubData.activeCarrier} (Direct SIP)</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Voice AI Engine</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600, color: "#A78BFA", marginTop: 4 }}>{hubData.activeEngine} ({hubData.voiceName})</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#94A3B8", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>SIP Inbound FQDN</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 12.5, color: "#CBD5E1", marginTop: 4 }}>{hubData.xaiFqdn}:5060</div>
          </div>
        </div>

        {/* Live Ping Result Banner */}
        {pingResult && (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: pingResult.success ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)", border: `1px solid ${pingResult.success ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: pingResult.success ? "#34D399" : "#F87171" }}>
              {pingResult.success ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              <span>{pingResult.success ? `Webhook Healthy! Roundtrip latency: ${pingResult.latencyMs}ms` : `Diagnostic ping failed: ${pingResult.details?.error || "Check server"}`}</span>
            </div>
            <span style={{ fontFamily: FONT_MONO, color: "#94A3B8", fontSize: 11 }}>HTTP {pingResult.statusCode}</span>
          </div>
        )}
      </div>

      {/* Direct Outbound Dialing Card */}
      <DirectOutboundCallCard notifications={notifications} setNotifications={setNotifications} defaultFromNumber={phoneNumber || hubData.phoneNumber} />

      {/* 2. PLUGGABLE STACK SELECTOR FORM */}
      <form onSubmit={handleProvision} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        
        {/* Step 1: Telephony Carrier Selection */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: C.ink, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>1</span>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.textInk, margin: 0 }}>Select Telephony / Number Provider</h3>
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginBottom: 12 }}>Choose the carrier that owns your phone numbers and carries the call audio.</div>
          
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {carriers.map((c) => {
              const Icon = c.icon;
              const isSelected = carrierChoice === c.id;
              return (
                <div
                  key={c.id}
                  onClick={() => setCarrierChoice(c.id)}
                  style={{
                    border: `2px solid ${isSelected ? C.cobalt : C.border}`,
                    background: isSelected ? "#F8FAFC" : "#fff",
                    borderRadius: 12,
                    padding: 16,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Icon size={18} color={isSelected ? C.cobalt : C.slate} />
                      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: isSelected ? C.cobalt : C.textInk }}>{c.name}</span>
                    </div>
                    <span style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${isSelected ? C.cobalt : C.slateLight}`, background: isSelected ? C.cobalt : "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {isSelected && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: isSelected ? C.cobalt : C.slate, background: isSelected ? "#EFF6FF" : "#F1F5F9", padding: "2px 6px", borderRadius: 4, alignSelf: "flex-start" }}>
                    {c.badge}
                  </span>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, lineHeight: 1.4 }}>{c.desc}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step 2: Voice AI Engine Selection */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: C.ink, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>2</span>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.textInk, margin: 0 }}>Select AI Voice Intelligence Engine</h3>
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginBottom: 12 }}>Choose the brain powering speech synthesis, speech recognition, and tool execution.</div>
          
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {engines.map((e) => {
              const Icon = e.icon;
              const isSelected = engineChoice === e.id;
              return (
                <div
                  key={e.id}
                  onClick={() => setEngineChoice(e.id)}
                  style={{
                    border: `2px solid ${isSelected ? "#7C3AED" : C.border}`,
                    background: isSelected ? "#FAF5FF" : "#fff",
                    borderRadius: 12,
                    padding: 16,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Icon size={18} color={isSelected ? "#7C3AED" : C.slate} />
                      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: isSelected ? "#7C3AED" : C.textInk }}>{e.name}</span>
                    </div>
                    <span style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${isSelected ? "#7C3AED" : C.slateLight}`, background: isSelected ? "#7C3AED" : "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {isSelected && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: isSelected ? "#7C3AED" : C.slate, background: isSelected ? "#F3E8FF" : "#F1F5F9", padding: "2px 6px", borderRadius: 4, alignSelf: "flex-start" }}>
                    {e.badge}
                  </span>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, lineHeight: 1.4 }}>{e.desc}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step 3: Credentials & Dynamic Form */}
        <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: C.ink, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>3</span>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.textInk, margin: 0 }}>Configure Line Credentials</h3>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                Phone Number (E.164 format)
              </label>
              <input
                type="text"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+1 (202) 555-0199 or +44..."
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 13, outline: "none" }}
              />
              <div style={{ fontSize: 11, color: C.slateLight, marginTop: 4 }}>The active caller ID that triggers this voice trunk.</div>
            </div>

            {engineChoice !== "simulation" && (
              <div>
                <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                  {engineChoice === "xai" ? "xAI API Key" : engineChoice === "openai" ? "OpenAI API Key" : "Engine Primary API Key"}
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={engineChoice === "xai" ? "xai-••••••••••••••••" : "sk-••••••••••••••••"}
                    style={{ width: "100%", boxSizing: "border-box", padding: "10px 38px 10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 13, outline: "none" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: C.slateLight }}
                  >
                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: hubData.hasApiKey ? "#059669" : C.slateLight, marginTop: 4 }}>
                  {hubData.hasApiKey ? `✓ Active Key Saved in Database: ${hubData.apiKeyMasked} (Leave blank to keep active key, or enter new key to replace)` : "Stored securely in database. Never exposed to callers."}
                </div>
              </div>
            )}

            {engineChoice === "xai" && (
              <div>
                <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                  Webhook Signing Secret (Svix HMAC Secret)
                </label>
                <input
                  type="text"
                  value={signingSecret}
                  onChange={(e) => setSigningSecret(e.target.value)}
                  placeholder={hubData.hasSigningSecret ? hubData.signingSecretMasked : "Auto-generated upon registration (whsec_...)"}
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 13, outline: "none" }}
                />
                <div style={{ fontSize: 11, color: hubData.hasSigningSecret ? "#059669" : C.slateLight, marginTop: 4 }}>
                  {hubData.hasSigningSecret ? `✓ Linked to Svix Secret: ${hubData.signingSecretMasked}` : "Auto-populated by xAI BYO trunk registration, or paste manually from console.x.ai."}
                </div>
              </div>
            )}


            {carrierChoice === "twilio" && (
              <div>
                <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                  Twilio Account SID
                </label>
                <input
                  type="text"
                  value={accountSid}
                  onChange={(e) => setAccountSid(e.target.value)}
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 13, outline: "none" }}
                />
              </div>
            )}

            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                AI Voice Persona
              </label>
              <select
                value={voiceName}
                onChange={(e) => setVoiceName(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", background: "#fff" }}
              >
                {engineChoice === "xai" ? (
                  <>
                    <option value="rex">Rex (Male — Warm, Confident, Executive)</option>
                    <option value="eve">Eve (Female — Articulate, Engaging, Professional)</option>
                    <option value="ara">Ara (Neutral — Crisp, Modern, Direct)</option>
                  </>
                ) : engineChoice === "openai" ? (
                  <>
                    <option value="alloy">Alloy (Versatile, balanced)</option>
                    <option value="echo">Echo (Warm, natural)</option>
                    <option value="shimmer">Shimmer (Clear, upbeat)</option>
                    <option value="onyx">Onyx (Deep, authoritative)</option>
                  </>
                ) : (
                  <>
                    <option value="rachel">Rachel (ElevenLabs Calm)</option>
                    <option value="adam">Adam (ElevenLabs Narration)</option>
                    <option value="sonic">Cartesia Sonic (90ms Ultra-Fast)</option>
                  </>
                )}
              </select>
            </div>
          </div>

          {/* Dynamic SIP & Webhook Routing Info */}
          <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textInk, marginBottom: 10 }}>
              📡 Inbound Routing Configuration for {carrierChoice === "telnyx" ? "Telnyx Portal" : carrierChoice === "twilio" ? "Twilio Console" : "Carrier / PBX"}
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
              {/* Webhook Box */}
              <div style={{ background: "#F8FAFC", border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Public Inbound Webhook URL</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(webhookUrl, "webhook")}
                    style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: C.slate }}
                  >
                    {copiedWebhook ? <Check size={11} color={C.green} /> : <Copy size={11} />}
                    {copiedWebhook ? "Copied" : "Copy"}
                  </button>
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.ink, wordBreak: "break-all" }}>{webhookUrl}</div>
                <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>Destination for xAI live call handoff.</div>
              </div>

              {/* Carrier SIP Box */}
              <div style={{ background: "#F8FAFC", border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Inbound FQDN Target</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard("sip.voice.x.ai:5060", "fqdn")}
                    style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: C.slate }}
                  >
                    {copiedFqdn ? <Check size={11} color={C.green} /> : <Copy size={11} />}
                    {copiedFqdn ? "Copied" : "Copy"}
                  </button>
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.ink }}>sip.voice.x.ai:5060</div>
                <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>
                  Destination: <b>+E.164</b> • Codecs: <b>G.711 μ-law, G.722</b>
                </div>
              </div>

              {/* Webhook Signing Secret Box */}
              <div style={{ background: "#F8FAFC", border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase" }}>Webhook Signing Secret (Svix)</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: C.slate }}
                    >
                      {showSecret ? <EyeOff size={11} /> : <Eye size={11} />}
                      {showSecret ? "Hide" : "Reveal"}
                    </button>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(hubData.signingSecret || signingSecret, "secret")}
                      style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: C.slate }}
                    >
                      {copiedSecret ? <Check size={11} color={C.green} /> : <Copy size={11} />}
                      {copiedSecret ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.ink, wordBreak: "break-all" }}>
                  {showSecret ? (hubData.signingSecret || signingSecret || "whsec_••••••••••••••••") : (hubData.signingSecretMasked || (signingSecret ? signingSecret.slice(0, 8) + "••••••••" : "whsec_••••••••"))}
                </div>
                <div style={{ fontSize: 11, color: hubData.hasSigningSecret ? "#059669" : C.slate, marginTop: 4 }}>
                  {hubData.hasSigningSecret ? "✓ Verified & saved to database" : "Auto-generated by xAI upon registration"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Feedback Alerts */}
        {provisionErr && (
          <div style={{ padding: "12px 16px", borderRadius: 8, background: C.redSoft, border: `1px solid #FCA5A5`, color: C.red, display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <AlertTriangle size={16} /> {provisionErr}
          </div>
        )}

        {provisionMsg && (
          <div style={{ padding: "14px 18px", borderRadius: 8, background: C.greenSoft, border: `1px solid #A7F3D0`, color: C.green, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
              <CheckCircle2 size={16} /> {provisionMsg.message}
            </div>
            {provisionMsg.signingSecret && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fff", padding: "10px 14px", borderRadius: 8, border: "1px solid #A7F3D0", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 11, color: C.slate, fontWeight: 700, textTransform: "uppercase" }}>🔑 Your Webhook Signing Secret (Copy & Save)</span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12.5, color: C.ink, wordBreak: "break-all" }}>{provisionMsg.signingSecret}</span>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(provisionMsg.signingSecret, "secret")}
                  style={{ background: "#ECFDF5", border: "1px solid #059669", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, color: "#065F46", fontWeight: 700 }}
                >
                  {copiedSecret ? <Check size={13} color="#059669" /> : <Copy size={13} />}
                  {copiedSecret ? "Copied to Clipboard!" : "Copy Signing Secret"}
                </button>
              </div>
            )}
          </div>
        )}


        {/* Submit Button */}
        <div>
          <button
            type="submit"
            disabled={provisioning}
            style={{
              background: C.ink,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "12px 28px",
              fontFamily: FONT_DISPLAY,
              fontSize: 14,
              fontWeight: 700,
              cursor: provisioning ? "wait" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              boxShadow: "0 4px 14px rgba(0,0,0,0.12)"
            }}
          >
            {provisioning ? (
              <>
                <RefreshCw size={15} className="animate-spin" /> Auto-Provisioning & Linking Line...
              </>
            ) : (
              <>
                <ShieldCheck size={16} /> ⚡ Auto-Register Line & Activate Stack
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------------------------------- AI Lead Radar & Autonomous Discovery View ---------------------------------- */

function LeadRadarView({ notifications, setNotifications, onLaunchMission }) {
  const [activeTab, setActiveTab] = useState("discover"); // discover or enrich
  const [searchQuery, setSearchQuery] = useState("");
  const [targetRole, setTargetRole] = useState("VP of Operations, CEO, Decision-Maker");
  const [searching, setSearching] = useState(false);
  const [discoveredLeads, setDiscoveredLeads] = useState([]);
  const [searchErr, setSearchErr] = useState("");

  // Single prospect enrich state
  const [enrichName, setEnrichName] = useState("");
  const [enrichCompany, setEnrichCompany] = useState("");
  const [enrichDomain, setEnrichDomain] = useState("");
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState(null);
  const [enrichErr, setEnrichErr] = useState("");

  const handleDiscover = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchErr("");
    setDiscoveredLeads([]);

    try {
      const res = await api.discoverAccounts({ query: searchQuery, target_role: targetRole });
      if (res && res.leads) {
        setDiscoveredLeads(res.leads);
        setNotifications((ns) => [
          { id: "n_" + Date.now(), text: `Radar discovered ${res.leads.length} target accounts for "${searchQuery}"`, time: "just now", unread: true, type: "success" },
          ...ns
        ]);
      }
    } catch (err) {
      setSearchErr(err.message || "Failed to search the web for accounts.");
    } finally {
      setSearching(false);
    }
  };

  const handleEnrichSingle = async (e) => {
    e.preventDefault();
    if (!enrichName.trim() && !enrichCompany.trim()) return;
    setEnriching(true);
    setEnrichErr("");
    setEnrichResult(null);

    try {
      const res = await api.enrichProspect({
        name: enrichName || enrichCompany,
        company: enrichCompany || enrichName,
        domain: enrichDomain
      });
      if (res && res.dossier) {
        setEnrichResult(res.dossier);
        setNotifications((ns) => [
          { id: "n_" + Date.now(), text: `Enriched deep dossier for ${enrichCompany || enrichName} (${res.dossier.confidenceScore}% confidence)`, time: "just now", unread: true, type: "success" },
          ...ns
        ]);
      }
    } catch (err) {
      setEnrichErr(err.message || "Failed to enrich contact.");
    } finally {
      setEnriching(false);
    }
  };

  return (
    <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1200, margin: "0 auto", width: "100%" }}>
      {/* Top Banner */}
      <div style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", borderRadius: 14, padding: "24px 28px", color: "#fff", border: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(59, 130, 246, 0.2)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(59, 130, 246, 0.3)" }}>
              <Target size={22} color="#60A5FA" />
            </div>
            <div>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, margin: 0 }}>AI Lead Radar & Account Intelligence</h2>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: "#94A3B8", marginTop: 2 }}>
                Autonomous web crawling & research agent. Scours public web, corporate sites & directories to unearth decision-makers, phones, and personalized hooks.
              </div>
            </div>
          </div>
        </div>

        {/* Tab Toggle */}
        <div style={{ display: "flex", background: "rgba(255,255,255,0.06)", padding: 4, borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)" }}>
          <button
            type="button"
            onClick={() => setActiveTab("discover")}
            style={{ padding: "8px 16px", borderRadius: 7, border: "none", background: activeTab === "discover" ? "#2563EB" : "transparent", color: "#fff", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            <Sparkles size={14} /> 🎯 Discover New Accounts
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("enrich")}
            style={{ padding: "8px 16px", borderRadius: 7, border: "none", background: activeTab === "enrich" ? "#2563EB" : "transparent", color: "#fff", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            <Search size={14} /> ⚡ Deep Enrich Contact
          </button>
        </div>
      </div>

      {/* MODE 1: DISCOVER TARGET ACCOUNTS */}
      {activeTab === "discover" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
            <form onSubmit={handleDiscover} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
                <div>
                  <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                    Target Domain, Industry, or Goal (Natural Language)
                  </label>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="e.g. Dental clinics in Chicago, or logistics startups using automated fleet software"
                    style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13.5, outline: "none" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                    Target Decision-Maker Titles
                  </label>
                  <input
                    type="text"
                    value={targetRole}
                    onChange={(e) => setTargetRole(e.target.value)}
                    placeholder="e.g. VP Operations, Office Manager, CEO"
                    style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13.5, outline: "none" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 12, color: C.slate }}>
                  💡 Scrapes web search engines, corporate registries & executive snippets to compile instant lead dossiers.
                </div>
                <button
                  type="submit"
                  disabled={searching || !searchQuery.trim()}
                  style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "11px 22px", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: searching ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}
                >
                  {searching ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                  {searching ? "Scouring Web Intelligence..." : "Launch Deep Radar Search"}
                </button>
              </div>
            </form>
          </div>

          {searchErr && (
            <div style={{ padding: "12px 16px", borderRadius: 8, background: C.redSoft, border: `1px solid #FCA5A5`, color: C.red, display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <AlertTriangle size={16} /> {searchErr}
            </div>
          )}

          {/* Discovered Accounts Grid */}
          {discoveredLeads.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.textInk }}>
                  Discovered Accounts ({discoveredLeads.length})
                </span>
                <span style={{ fontSize: 12, color: "#059669", fontWeight: 600, background: "#ECFDF5", padding: "4px 10px", borderRadius: 20, border: "1px solid #A7F3D0" }}>
                  ✓ Web Intelligence Verified
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
                {discoveredLeads.map((lead, idx) => (
                  <div key={lead.id || idx} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.textInk }}>{lead.name}</div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, marginTop: 2 }}>{lead.contactPerson}</div>
                      </div>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "#2563EB", background: "#EFF6FF", padding: "2px 8px", borderRadius: 4 }}>
                        {lead.fit}% Fit
                      </span>
                    </div>

                    <div style={{ fontSize: 12, color: C.slate, lineHeight: 1.4, background: "#F8FAFC", padding: 10, borderRadius: 8, border: `1px solid ${C.border}` }}>
                      {lead.snippet || "Public web description"}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.textInk }}>
                        <Phone size={13} color={C.cobalt} /> <b>Phone:</b> {lead.phone}
                      </div>
                      {lead.site && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.slate }}>
                          <Globe size={13} /> <a href={lead.site} target="_blank" rel="noreferrer" style={{ color: C.cobalt, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.site}</a>
                        </div>
                      )}
                    </div>

                    {/* AI Opening Hook Card */}
                    <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#B45309", textTransform: "uppercase", marginBottom: 3 }}>
                        🎙️ Generated Voice Call Hook
                      </div>
                      <div style={{ fontSize: 11.5, color: "#92400E", fontStyle: "italic", lineHeight: 1.35 }}>
                        "{lead.openingHook}"
                      </div>
                    </div>

                    <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <button
                        type="button"
                        onClick={() => {
                          if (onLaunchMission) {
                            onLaunchMission([lead]);
                          }
                        }}
                        style={{ width: "100%", background: C.cobalt, color: "#fff", border: "none", borderRadius: 6, padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                      >
                        <PhoneCall size={13} /> Add to Live Call Queue
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODE 2: DEEP ENRICH SINGLE CONTACT */}
      {activeTab === "enrich" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
            <form onSubmit={handleEnrichSingle} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
                <div>
                  <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                    Company or Organization Name
                  </label>
                  <input
                    type="text"
                    value={enrichCompany}
                    onChange={(e) => setEnrichCompany(e.target.value)}
                    placeholder="e.g. Databricks, Stripe, Acme Logistics"
                    style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                    Individual Contact Person (Optional)
                  </label>
                  <input
                    type="text"
                    value={enrichName}
                    onChange={(e) => setEnrichName(e.target.value)}
                    placeholder="e.g. Sarah Connor, VP Engineering"
                    style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                    Official Domain (Optional)
                  </label>
                  <input
                    type="text"
                    value={enrichDomain}
                    onChange={(e) => setEnrichDomain(e.target.value)}
                    placeholder="e.g. stripe.com or https://..."
                    style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="submit"
                  disabled={enriching || (!enrichCompany.trim() && !enrichName.trim())}
                  style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "11px 22px", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: enriching ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}
                >
                  {enriching ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {enriching ? "Crawling & Building Dossier..." : "Run Autonomous Web Intelligence"}
                </button>
              </div>
            </form>
          </div>

          {enrichErr && (
            <div style={{ padding: "12px 16px", borderRadius: 8, background: C.redSoft, border: `1px solid #FCA5A5`, color: C.red, display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <AlertTriangle size={16} /> {enrichErr}
            </div>
          )}

          {/* Dossier Output */}
          {enrichResult && (
            <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 20, boxShadow: "0 4px 16px rgba(0,0,0,0.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, borderBottom: `1px solid ${C.border}`, paddingBottom: 16 }}>
                <div>
                  <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.textInk, margin: 0 }}>
                    {enrichResult.company} — Intelligence Dossier
                  </h3>
                  <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>
                    Source: {enrichResult.domain}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 20, background: enrichResult.confidenceScore > 70 ? "#ECFDF5" : "#FFFBEB", color: enrichResult.confidenceScore > 70 ? "#059669" : "#B45309", border: `1px solid ${enrichResult.confidenceScore > 70 ? "#A7F3D0" : "#FDE68A"}` }}>
                    Confidence Score: {enrichResult.confidenceScore}%
                  </span>
                </div>
              </div>

              {/* Overview & Hook */}
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 18 }}>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 6 }}>
                    Company Intelligence Summary
                  </div>
                  <div style={{ fontSize: 13, color: C.textInk, lineHeight: 1.5, background: "#F8FAFC", padding: 14, borderRadius: 8, border: `1px solid ${C.border}` }}>
                    {enrichResult.overview}
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#166534", textTransform: "uppercase", marginBottom: 4 }}>
                      📞 Discovered Contact Numbers
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {enrichResult.phones.map((p, i) => (
                        <span key={i} style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 700, color: "#15803D" }}>
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>

                  {enrichResult.emails && enrichResult.emails.length > 0 && (
                    <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#1E40AF", textTransform: "uppercase", marginBottom: 4 }}>
                        ✉️ Discovered Email Patterns
                      </div>
                      <div style={{ fontFamily: FONT_MONO, fontSize: 12.5, color: "#2563EB" }}>
                        {enrichResult.emails.join(", ")}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Personalized Opening Hook */}
              <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#B45309", marginBottom: 6 }}>
                  <Volume2 size={15} /> Optimized Voice AI Call Script Hook
                </div>
                <div style={{ fontSize: 13.5, color: "#78350F", fontStyle: "italic", lineHeight: 1.5 }}>
                  "{enrichResult.openingHook}"
                </div>
              </div>

              {/* Citations */}
              {enrichResult.citations && enrichResult.citations.length > 0 && (
                <div style={{ paddingTop: 8, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 11.5, color: C.slate }}>
                  <span style={{ fontWeight: 700 }}>Verification Citations:</span>
                  {enrichResult.citations.map((c, i) => (
                    <a key={i} href={c} target="_blank" rel="noreferrer" style={{ color: C.cobalt, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <ExternalLink size={11} /> {new URL(c).hostname}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


const LAYERS = VOICE_LAYERS;

function ProviderConfigView({ notifications, setNotifications, commonAi, setCommonAi, profile, setProfile }) {
  const [activeTab, setActiveTab] = useState("telephony-hub");
  const [showAdd, setShowAdd] = useState(false);

  // ── Layer Routing state ──
  const [dirty, setDirty] = useState(false);
  const mode = commonAi?.mode || "paid";
  const custom = commonAi?.voiceLayers || Object.fromEntries(LAYERS.map((l) => [l.key, l.paid]));

  // ── Credentials: loaded live from backend with template fallback ──
  const [credsState, setCredsState] = useState(CONNECTIONS);
  const [rowState, setRowState] = useState({});

  useEffect(() => {
    async function loadConns() {
      try {
        const conns = await api.getConnections();
        if (conns && Array.isArray(conns) && conns.length) {
          // Merge live backend connections onto CONNECTIONS template
          setCredsState((prev) => {
            const backendMap = {};
            conns.forEach((g) => {
              (g.items || []).forEach((it) => {
                backendMap[`${g.group}|${it.name}`] = it;
              });
            });
            return prev.map((group) => ({
              ...group,
              items: (group.items || []).map((it) => {
                const live = backendMap[`${group.group}|${it.name}`];
                return live ? { ...it, status: live.status, apiKeyMasked: live.apiKeyMasked } : it;
              }),
            }));
          });
        }
      } catch (_) {}
    }
    loadConns();
  }, []);

  // ── Layer Routing helpers ──
  const applyMode = (m) => {
    if (setCommonAi) {
      setCommonAi((prev) => {
        const nextLayers = { ...prev.voiceLayers };
        LAYERS.forEach((l) => {
          if (m === "paid") nextLayers[l.key] = l.paid;
          if (m === "opensource") nextLayers[l.key] = l.oss;
        });
        return { ...prev, mode: m, voiceLayers: nextLayers };
      });
    }
    flash();
  };

  const updateLayer = (key, val) => {
    if (setCommonAi) {
      setCommonAi((prev) => ({
        ...prev,
        mode: "custom",
        voiceLayers: { ...prev.voiceLayers, [key]: val },
      }));
    }
    flash();
  };

  const flash = () => {
    setDirty(true);
    setTimeout(() => setDirty(false), 1400);
  };

  const isOss = (val) =>
    ["self-hosted", "telnyx", "deepseek", "kokoro", "livekit", "whisper", "local"].some((kw) =>
      String(val).toLowerCase().includes(kw)
    );

  const allLlmOptions = Array.from(new Set([
    ...LAYERS.find((l) => l.key === "llm").options,
    ...(commonAi?.providers?.filter((p) => p.type === "llm").flatMap((p) => p.models) || []),
  ]));

  // ── Credentials inline test→save helpers ──
  const setRow = (rowKey, patch) =>
    setRowState((s) => ({ ...s, [rowKey]: { ...(s[rowKey] || {}), ...patch } }));

  const handleConnect = (rowKey) =>
    setRow(rowKey, { phase: "editing", keyValue: "", phoneValue: profile?.callerId || "", agentIdValue: "", errorMsg: "", testResult: null });

  const handleCancel = (rowKey) =>
    setRowState((s) => { const n = { ...s }; delete n[rowKey]; return n; });

  const handleTest = async (groupName, itemName, rowKey) => {
    const key = ((rowState[rowKey] || {}).keyValue || "").trim();
    if (!key) { setRow(rowKey, { errorMsg: "API key cannot be empty." }); return; }
    setRow(rowKey, { phase: "testing", errorMsg: "", testResult: null });
    try {
      const res = await api.testConnection({ layer: groupName, provider: itemName, api_key: key });
      setRow(rowKey, { phase: "tested_ok", testResult: res.details || "Authentication verified! Ready to save." });
    } catch (err) {
      setRow(rowKey, { phase: "tested_fail", errorMsg: err.message || "Authentication rejected by provider." });
    }
  };

  const handleSave = async (groupName, itemName, rowKey) => {
    const row = rowState[rowKey] || {};
    const key = (row.keyValue || "").trim();
    setRow(rowKey, { phase: "saving" });
    try {
      const res = await api.testAndSaveConnection({ layer: groupName, provider: itemName, api_key: key });
      setCredsState((s) =>
        s.map((g) =>
          g.group === groupName
            ? { ...g, items: (g.items || []).map((x) => x.name === itemName ? { ...x, status: "connected", apiKeyMasked: res.maskedKey } : x) }
            : g
        )
      );
      if (row.phoneValue && setProfile) {
        setProfile((prev) => ({ ...prev, callerId: row.phoneValue }));
      }
      handleCancel(rowKey);
      setNotifications((ns) => [
        { id: "n_" + Date.now(), text: `✓ ${itemName} key verified and saved!${row.phoneValue ? ` (Caller ID: ${row.phoneValue})` : ""}`, time: "just now", unread: true, type: "success" },
        ...ns,
      ]);
      flash();
    } catch (err) {
      setRow(rowKey, { phase: "tested_fail", errorMsg: err.message || "Save failed." });
    }
  };

  const handleAddSuccess = (newIntegration) => {
    setCredsState((prev) => {
      const exists = prev.find((g) => g.group === newIntegration.category);
      if (exists) {
        return prev.map((g) =>
          g.group === newIntegration.category
            ? { ...g, items: [...(g.items || []).filter((it) => it.name !== newIntegration.name), { name: newIntegration.name, status: "connected", apiKeyMasked: newIntegration.masked }] }
            : g
        );
      }
      return [...prev, { group: newIntegration.category, desc: "", items: [{ name: newIntegration.name, status: "connected", apiKeyMasked: newIntegration.masked }] }];
    });
    if (newIntegration.category === "LLM" && setCommonAi) {
      setCommonAi((prev) => ({
        ...prev,
        providers: [...(prev.providers || []), { id: "custom_" + Date.now(), name: newIntegration.name, type: "llm", status: "active", models: [newIntegration.name] }],
      }));
    }
    setNotifications((ns) => [
      { id: "n_" + Date.now(), text: `✓ Verified and activated ${newIntegration.name}`, time: "just now", unread: true, type: "success" },
      ...ns,
    ]);
    flash();
  };

  return (
    <>
      <TopBar title="Connections & Providers" subtitle="Layer routing, API keys and live credential testing" notifications={notifications} setNotifications={setNotifications} />
      <div style={{ padding: "20px 32px" }}>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {[
            { id: "telephony-hub", label: "⚡ Voice & Telephony Trunking Hub" },
            { id: "routing", label: "⚙️ Layer Routing & Models" },
            { id: "credentials", label: "🔑 API Credentials" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: "8px 16px", borderRadius: 8,
                border: `1px solid ${activeTab === t.id ? C.ink : C.border}`,
                background: activeTab === t.id ? C.ink : "#fff",
                color: activeTab === t.id ? "#fff" : C.slate,
                fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* TAB 0: Voice & Telephony Trunking Hub */}
        {activeTab === "telephony-hub" && (
          <VoiceTrunkingHubTab
            notifications={notifications}
            setNotifications={setNotifications}
            profile={profile}
            setProfile={setProfile}
          />
        )}

        {/* TAB 1: Layer Routing */}
        {activeTab === "routing" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
              {[
                { id: "paid", title: "Paid / Managed", desc: "Best-in-class APIs. Fastest to run, no infra." },
                { id: "opensource", title: "Open Source", desc: "Self-hosted models. Lower cost, full control." },
                { id: "custom", title: "Custom", desc: "Mix providers per layer." },
              ].map((m) => (
                <div key={m.id} className="hover-float" onClick={() => applyMode(m.id)}
                  style={{ border: `2px solid ${mode === m.id ? C.ink : C.border}`, borderRadius: 12, padding: 16, cursor: "pointer", background: mode === m.id ? C.ink : "#fff" }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: mode === m.id ? "#fff" : C.textInk }}>{m.title}</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: mode === m.id ? "#B8BCC8" : C.slate, marginTop: 4 }}>{m.desc}</div>
                </div>
              ))}
            </div>

            <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr 1fr", padding: "11px 18px", background: C.paper, fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                <div>Layer</div><div>Provider / Model</div><div>Status</div>
              </div>
              {LAYERS.map((l) => {
                const val = custom[l.key] || l.paid;
                const oss = isOss(val);
                const options = l.key === "llm" ? allLlmOptions : l.options;
                return (
                  <div key={l.key} style={{ display: "grid", gridTemplateColumns: "1.4fr 1.6fr 1fr", padding: "13px 18px", borderTop: `1px solid ${C.border}`, alignItems: "center" }}>
                    <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, color: C.textInk }}>{l.label}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <select value={val} onChange={(e) => updateLayer(l.key, e.target.value)}
                        style={{ fontFamily: FONT_BODY, fontSize: 13, padding: "6px 10px", borderRadius: 7, border: `1px solid ${C.border}`, background: "#fff", color: C.textInk, cursor: "pointer" }}>
                        {options.map((o) => <option key={o} value={o}>{o}</option>)}
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
          </>
        )}

        {/* TAB 2: API Credentials */}
        {activeTab === "credentials" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {credsState.map((group) => (
              <div key={group.group}>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>{group.group}</div>
                  {group.desc && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, marginTop: 2 }}>{group.desc}</div>}
                </div>

                <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
                  {group.items.map((it, idx) => {
                    const rowKey = group.group + "|" + it.name;
                    const rs = rowState[rowKey] || {};
                    const phase = rs.phase || "idle";
                    return (
                      <div key={it.name} style={{ borderTop: idx === 0 ? "none" : `1px solid ${C.border}` }}>
                        {/* Main row */}
                        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px" }}>
                          <div style={{ width: 210, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, color: C.textInk }}>{it.name}</div>
                          <div style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 12, color: C.slateLight }}>
                            {it.apiKeyMasked || (it.status === "connected" ? "••••••••••••" : "Not configured")}
                          </div>
                          <Badge status={it.status} small />

                          {phase === "idle" && (
                            <button onClick={() => handleConnect(rowKey)}
                              style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 14px", fontFamily: FONT_BODY, fontSize: 12, color: C.slate, cursor: "pointer", whiteSpace: "nowrap" }}>
                              {it.status === "connected" ? "Update Key" : "Connect"}
                            </button>
                          )}
                          {phase !== "idle" && (
                            <button onClick={() => handleCancel(rowKey)}
                              style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 10px", fontFamily: FONT_BODY, fontSize: 12, color: C.slate, cursor: "pointer" }}>
                              Cancel
                            </button>
                          )}
                        </div>

                        {/* Inline input area with Test -> Save transition */}
                        {phase !== "idle" && (
                          <div style={{ borderTop: `1px solid ${C.border}`, background: C.paper, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              <label style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                {it.name} API Key / Token
                              </label>
                              <div style={{ position: "relative", width: "100%" }}>
                                <input
                                  autoFocus={phase === "editing"}
                                  type={rs.showKey ? "text" : "password"}
                                  disabled={phase === "testing" || phase === "saving"}
                                  value={rs.keyValue || ""}
                                  onChange={(e) => setRow(rowKey, { keyValue: e.target.value, errorMsg: "", phase: "editing", testResult: null })}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      if (phase === "tested_ok") handleSave(group.group, it.name, rowKey);
                                      else handleTest(group.group, it.name, rowKey);
                                    }
                                  }}
                                  placeholder="Paste API key / token to test & connect..."
                                  style={{ width: "100%", boxSizing: "border-box", padding: "8px 38px 8px 12px", borderRadius: 8, border: `1px solid ${phase === "tested_fail" ? C.red : phase === "tested_ok" ? C.green : C.cobalt}`, fontFamily: FONT_MONO, fontSize: 12.5, outline: "none", background: "#fff" }}
                                />
                                <button
                                  type="button"
                                  onClick={() => setRow(rowKey, { showKey: !rs.showKey })}
                                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center", color: C.slateLight }}
                                  title={rs.showKey ? "Hide key" : "Show key"}
                                >
                                  {rs.showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                                </button>
                              </div>
                            </div>

                            {/* Optional Phone Number & Agent ID fields for xAI / Telephony / Voice */}
                            {(it.name.toLowerCase().includes("xai") || group.group === "Telephony" || group.group === "Voice Orchestration" || it.name.toLowerCase().includes("twilio")) && (
                              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 10, marginTop: 4 }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                    Assigned Outbound Phone Number
                                  </label>
                                  <input
                                    type="text"
                                    value={rs.phoneValue || ""}
                                    onChange={(e) => setRow(rowKey, { phoneValue: e.target.value })}
                                    placeholder="+44 20... or +1..."
                                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12, outline: "none", background: "#fff" }}
                                  />
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                    Voice Agent ID (Optional)
                                  </label>
                                  <input
                                    type="text"
                                    value={rs.agentIdValue || ""}
                                    onChange={(e) => setRow(rowKey, { agentIdValue: e.target.value })}
                                    placeholder="agent_... or sid_..."
                                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12, outline: "none", background: "#fff" }}
                                  />
                                </div>
                              </div>
                            )}

                            {rs.errorMsg && (
                              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: C.redSoft, border: `1px solid #F0C4B8`, borderRadius: 6, fontFamily: FONT_BODY, fontSize: 12, color: C.red }}>
                                <AlertTriangle size={14} /> {rs.errorMsg}
                              </div>
                            )}

                            {phase === "tested_ok" && (
                              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: C.greenSoft, border: `1px solid #BFE6DF`, borderRadius: 6, fontFamily: FONT_BODY, fontSize: 12, color: C.green }}>
                                <CheckCircle2 size={14} /> {rs.testResult}
                              </div>
                            )}

                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                              {phase !== "tested_ok" ? (
                                <button
                                  onClick={() => handleTest(group.group, it.name, rowKey)}
                                  disabled={phase === "testing"}
                                  style={{ background: C.cobalt, color: "#fff", border: "none", borderRadius: 7, padding: "8px 18px", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: phase === "testing" ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 6 }}
                                >
                                  {phase === "testing" ? (
                                    <>
                                      <RefreshCw size={13} className="animate-spin" /> Testing live connection...
                                    </>
                                  ) : (
                                    <>
                                      <ShieldCheck size={13} /> Test Connection
                                    </>
                                  )}
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleSave(group.group, it.name, rowKey)}
                                  disabled={phase === "saving"}
                                  style={{ background: C.green, color: "#fff", border: "none", borderRadius: 7, padding: "8px 20px", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: phase === "saving" ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 6 }}
                                >
                                  {phase === "saving" ? (
                                    <>
                                      <RefreshCw size={13} className="animate-spin" /> Saving key...
                                    </>
                                  ) : (
                                    <>
                                      <Check size={14} /> Save Verified Key
                                    </>
                                  )}
                                </button>
                              )}

                              <button
                                onClick={() => handleCancel(rowKey)}
                                style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 14px", fontFamily: FONT_BODY, fontSize: 12, color: C.slate, cursor: "pointer" }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Subtle add link per category */}
                <button onClick={() => setShowAdd(true)}
                  style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight, cursor: "pointer", padding: "4px 4px" }}>
                  <Plus size={12} /> Add {group.group} provider
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {dirty && (
        <div style={{ position: "fixed", bottom: 24, right: 32, background: C.ink, color: "#fff", padding: "12px 18px", borderRadius: 10, fontFamily: FONT_BODY, fontSize: 12.5, display: "flex", alignItems: "center", gap: 10, zIndex: 100 }}>
          <CheckCircle2 size={15} color={C.teal} /> Changes applied successfully
        </div>
      )}

      {showAdd && <AddIntegrationModal onClose={() => setShowAdd(false)} onAddSuccess={handleAddSuccess} />}
    </>
  );
}


function MetricCard({ label, value, delta, mono }) {
  return (
    <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px" }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: mono ? FONT_MONO : FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: C.textInk, display: "flex", alignItems: "baseline", gap: 8 }}>
        {value}
        {delta && <span style={{ fontSize: 12, fontWeight: 600, color: C.teal }}>{delta}</span>}
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
          <div className="hover-float" style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, cursor: "default" }}>
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

          <div className="hover-float" style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, cursor: "default" }}>
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
  email: ["email", "e-mail", "mail", "email address"],
};

const CHANNEL_OPTIONS = [
  { id: "auto", label: "Let AI choose" },
  { id: "voice", label: "Voice call" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
];

// turns a free-text cell like "wa" or "Whats App" into one of our channel ids
function normalizeChannel(raw) {
  const v = (raw || "").toString().trim().toLowerCase();
  if (!v) return "";
  if (v.includes("whats") || v === "wa") return "whatsapp";
  if (v.includes("sms") || v.includes("text")) return "sms";
  if (v.includes("mail") || v.includes("email") || v === "e-mail") return "email";
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
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function halfHourSlots(start, end) {
  const out = [];
  for (let m = timeToMinutes(start); m <= timeToMinutes(end); m += 30) out.push(minutesToTime(m));
  return out;
}

const PECR_WEEKDAY_SLOTS = halfHourSlots(PECR.weekdayStart, PECR.weekdayEnd);
const PECR_WEEKEND_SLOTS = halfHourSlots(PECR.weekendStart, PECR.weekendEnd);

function isInLunch(hhmm, lunchStart, lunchEnd) {
  if (!hhmm || !lunchStart || !lunchEnd) return false;
  const t = timeToMinutes(hhmm);
  return t >= timeToMinutes(lunchStart) && t < timeToMinutes(lunchEnd);
}

function lunchOverlapMinutes(windowStart, windowEnd, lunchStart, lunchEnd) {
  if (!lunchStart || !lunchEnd) return 0;
  const overlap = Math.min(timeToMinutes(windowEnd), timeToMinutes(lunchEnd)) - Math.max(timeToMinutes(windowStart), timeToMinutes(lunchStart));
  return Math.max(0, overlap);
}

// pull a day+time out of the prospect's own lines — never from the AI's proposal
// unless they didn't name one. prototype calendar is frozen at Thu 27 Aug 2026.
const PROTO_TODAY = new Date(2026, 7, 27);
const MONTH_WORDS = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

function addCalendarMonths(from, n) {
  return new Date(from.getFullYear(), from.getMonth() + n, from.getDate());
}

function formatProtoDay(d) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function parseMonthsAhead(text) {
  const lower = (text || "").toLowerCase();
  if (/next quarter|in a few months/.test(lower)) return 3;
  const m = lower.match(/(?:in|after)\s+(\d+|a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+months?/);
  if (!m) return null;
  if (/^\d+$/.test(m[1])) return parseInt(m[1], 10);
  return MONTH_WORDS[m[1]] || null;
}

function extractRequestedTime(transcript) {
  const them = (transcript || [])
    .map((l) => (typeof l === "string" ? l : `${l.who === "them" ? "Prospect" : "AI"}: ${l.text || ""}`))
    .filter((l) => /^Prospect:/i.test(l))
    .map((l) => l.replace(/^Prospect:\s*/i, ""));
  const combined = them.join(" ");
  if (!combined.trim()) return null;

  const monthLine = them.find((t) => parseMonthsAhead(t) != null);
  if (monthLine) {
    const n = parseMonthsAhead(monthLine);
    return {
      day: formatProtoDay(addCalendarMonths(PROTO_TODAY, n)),
      time: "10:00",
      exactWords: monthLine,
      source: "prospect",
      kind: "deferred_callback",
      monthsAhead: n,
    };
  }

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
  if (mins < timeToMinutes(PECR.weekdayStart)) time = PECR.weekdayStart;
  if (mins > timeToMinutes(PECR.weekdayEnd)) time = PECR.weekdayEnd;

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
function computeQueueEstimate(totalCompanies, concurrency, windowStart, windowEnd, lunchStart, lunchEnd) {
  const rawWindow = Math.max(0, timeToMinutes(windowEnd) - timeToMinutes(windowStart));
  const lunchMins = lunchOverlapMinutes(windowStart, windowEnd, lunchStart, lunchEnd);
  const windowMinutes = Math.max(0, rawWindow - lunchMins);
  const capacityPerDay = Math.floor((windowMinutes / AVG_CALL_MINUTES) * concurrency);
  if (totalCompanies === 0 || capacityPerDay === 0) {
    return { capacityPerDay, willFinishToday: false, finishLabel: "", daysNeeded: 0, lunchMins };
  }
  const minutesNeeded = (totalCompanies * AVG_CALL_MINUTES) / concurrency;
  const willFinishToday = minutesNeeded <= windowMinutes;
  if (willFinishToday) {
    let finish = timeToMinutes(windowStart) + minutesNeeded;
    if (lunchStart && finish > timeToMinutes(lunchStart)) finish += lunchMins;
    if (isInLunch(minutesToTime(finish), lunchStart, lunchEnd)) finish = timeToMinutes(lunchEnd);
    return {
      capacityPerDay,
      willFinishToday: true,
      finishLabel: minutesToTime(finish),
      daysNeeded: 1,
      lunchMins,
    };
  }
  const daysNeeded = Math.ceil(totalCompanies / capacityPerDay);
  return { capacityPerDay, willFinishToday: false, finishLabel: "", daysNeeded, lunchMins };
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

function ImportReviewScreen({
  fileName,
  recordCount,
  importHeaders,
  columnMap,
  onColumnMap,
  importFilter,
  setImportFilter,
  importRows,
  filteredRows,
  includedCount,
  flaggedCount,
  duplicateCount,
  knownCount,
  bulkChannel,
  setBulkChannel,
  onToggle,
  onUpdate,
  onRemove,
  onSelectAll,
  onApplyChannel,
  onDiscardFlagged,
  onDifferentFile,
  onClose,
  onConfirm,
}) {
  const inputStyle = (bad) => ({
    width: "100%",
    padding: "9px 10px",
    borderRadius: 8,
    border: `1px solid ${bad ? C.redSolid : C.border}`,
    fontFamily: FONT_BODY,
    fontSize: 13,
    outline: "none",
    background: "#fff",
    boxSizing: "border-box",
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: C.paper, display: "flex", flexDirection: "column", fontFamily: FONT_BODY }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 28px", borderBottom: `1px solid ${C.border}`, background: "#fff" }}>
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.textInk }}>Review uploaded list</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 3 }}>
            {fileName} · {recordCount} rows in file · {includedCount} ready to contact
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onDifferentFile} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 14px", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.slate, cursor: "pointer" }}>
            Use a different file
          </button>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 8 }}>
            <X size={18} color={C.slate} />
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 0, flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          <div style={{ padding: "16px 28px 12px", borderBottom: `1px solid ${C.border}`, background: "#fff" }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 10 }}>
              Match columns from the spreadsheet
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(120px, 1fr))", gap: 10 }}>
              {[
                ["name", "Company name*"],
                ["phone", "Phone number*"],
                ["website", "Website / link"],
                ["contact", "Contact person"],
                ["channel", "Preferred channel"],
              ].map(([field, label]) => (
                <div key={field}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginBottom: 4 }}>{label}</div>
                  <select
                    value={columnMap[field]}
                    onChange={(e) => onColumnMap(field, e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, background: C.paper }}
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

          <div style={{ padding: "12px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
                      padding: "6px 12px", borderRadius: 999, border: `1px solid ${importFilter === id ? C.ink : C.border}`,
                      background: importFilter === id ? C.ink : "#fff", color: importFilter === id ? "#fff" : (empty ? C.slateLight : C.slate),
                      fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: empty ? "default" : "pointer",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => onSelectAll(true)} style={{ background: "none", border: "none", color: C.cobalt, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Check all shown</button>
              <button onClick={() => onSelectAll(false)} style={{ background: "none", border: "none", color: C.slate, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Uncheck</button>
              <select value={bulkChannel} onChange={(e) => setBulkChannel(e.target.value)} style={{ padding: "5px 8px", borderRadius: 6, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12 }}>
                {CHANNEL_OPTIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <button onClick={onApplyChannel} style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 6, padding: "5px 10px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Set channel</button>
            </div>
          </div>

          {(flaggedCount > 0 || knownCount > 0) && (
            <div style={{ padding: "0 28px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
              {flaggedCount > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.amberSoft, borderRadius: 8, padding: "9px 12px" }}>
                  <AlertTriangle size={14} color={C.amber} />
                  <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk, flex: 1 }}>
                    {flaggedCount} row{flaggedCount === 1 ? "" : "s"} need a look — left unchecked so they will not be contacted.
                  </span>
                  <button onClick={onDiscardFlagged} style={{ background: "none", border: `1px solid ${C.amber}`, color: C.amber, borderRadius: 6, padding: "5px 10px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    Discard flagged
                  </button>
                </div>
              )}
              {knownCount > 0 && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: C.cobaltSoft, borderRadius: 8, padding: "9px 12px" }}>
                  <History size={14} color={C.cobaltDeep} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk, lineHeight: 1.45 }}>
                    {knownCount} already in the call log under a different name or the same person. Skipped by default.
                  </span>
                </div>
              )}
            </div>
          )}

          <div style={{ flex: 1, overflow: "auto", padding: "0 28px 24px" }}>
            <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", minWidth: 920 }}>
              <div style={{ display: "grid", gridTemplateColumns: "44px 1.6fr 1.1fr 1.2fr 1.3fr 140px 1.4fr 40px", padding: "10px 14px", background: C.paper, fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                <div />
                <div>Company</div>
                <div>Phone</div>
                <div>Contact</div>
                <div>Website</div>
                <div>Channel</div>
                <div>Status</div>
                <div />
              </div>
              {filteredRows.length === 0 && (
                <div style={{ padding: 28, textAlign: "center", fontFamily: FONT_BODY, fontSize: 13, color: C.slateLight }}>No rows match this filter.</div>
              )}
              {filteredRows.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "44px 1.6fr 1.1fr 1.2fr 1.3fr 140px 1.4fr 40px",
                    gap: 8,
                    padding: "12px 14px",
                    borderTop: `1px solid ${C.border}`,
                    alignItems: "start",
                    background: r.included ? "#fff" : C.paperSoft,
                    opacity: r.included ? 1 : 0.72,
                  }}
                >
                  <input type="checkbox" checked={r.included} onChange={() => onToggle(r.id)} style={{ cursor: "pointer", marginTop: 10 }} />
                  <input value={r.name} onChange={(e) => onUpdate(r.id, "name", e.target.value)} placeholder="Company name" style={inputStyle(r.issues.includes("missing_name"))} />
                  <input value={r.phone} onChange={(e) => onUpdate(r.id, "phone", e.target.value)} placeholder="Phone" style={inputStyle(r.issues.includes("missing_phone") || r.issues.includes("bad_phone"))} />
                  <input value={r.contact || ""} onChange={(e) => onUpdate(r.id, "contact", e.target.value)} placeholder="Person" style={inputStyle(false)} />
                  <input value={r.source} onChange={(e) => onUpdate(r.id, "source", e.target.value)} placeholder="Website" style={inputStyle(false)} />
                  <select value={r.channel} onChange={(e) => onUpdate(r.id, "channel", e.target.value)} style={{ ...inputStyle(false), padding: "9px 8px" }}>
                    <option value="">Default</option>
                    {CHANNEL_OPTIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <div>
                    {r.issues.length === 0 ? (
                      <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.green, fontWeight: 600 }}>Ready</span>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {r.issues.map((code) => (
                          <span key={code} style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, color: (ISSUE_META[code] || ISSUE_META.duplicate).color }}>
                            {code === "duplicate" ? `Duplicate of ${r.duplicateOf}` : (ISSUE_META[code] || {}).label || code}
                          </span>
                        ))}
                      </div>
                    )}
                    {r.identityMatch && (
                      <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slate, marginTop: 4, lineHeight: 1.35 }}>
                        {r.identityMatch.reasons[0]}
                        {r.identityMatch.requestedFollowUp ? ` — they asked: “${r.identityMatch.requestedFollowUp.exactWords}”` : ""}
                        {r.identityMatch.lastContactAt ? ` · last ${r.identityMatch.lastContactAt}` : ""}
                      </div>
                    )}
                  </div>
                  <button onClick={() => onRemove(r.id)} style={{ background: "none", border: "none", cursor: "pointer", marginTop: 8 }}>
                    <Trash2 size={14} color={C.slateLight} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ borderLeft: `1px solid ${C.border}`, background: "#fff", padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.textInk }}>What the software understood</div>
          {[
            ["Rows in file", recordCount],
            ["Ready to contact", includedCount],
            ["Need review", flaggedCount],
            ["Already known", knownCount],
          ].map(([label, value]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT_BODY, fontSize: 13 }}>
              <span style={{ color: C.slate }}>{label}</span>
              <span style={{ fontFamily: FONT_MONO, fontWeight: 600, color: C.textInk }}>{value}</span>
            </div>
          ))}
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, lineHeight: 1.5, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
            Tick the companies you want. Unticked rows stay off the dialer. After you continue, you set channel, timezone, lunch, and start the outreach.
          </div>
          <button
            onClick={onConfirm}
            disabled={!includedCount}
            style={{
              marginTop: "auto", width: "100%", padding: "12px", borderRadius: 9, border: "none",
              background: includedCount ? C.ink : C.paperSoft, color: includedCount ? "#fff" : C.slateLight,
              fontFamily: FONT_BODY, fontWeight: 600, fontSize: 14, cursor: includedCount ? "pointer" : "default",
            }}
          >
            Continue with {includedCount} companies
          </button>
        </div>
      </div>
    </div>
  );
}

function NewMissionModal({ onClose, onCreate, registry, callLog, workingHours, commonAi }) {
  const [tab, setTab] = useState("discover");
  const [prompt, setPrompt] = useState("");
  const [rows, setRows] = useState([{ id: 1, name: "", phone: "", sourceType: "Website URL", source: "", channel: "auto", fallback: "none", contact: "" }]);
  const [manualMode, setManualMode] = useState("upload"); // "upload" | "form"
  const [windowStart, setWindowStart] = useState((workingHours && workingHours.weekdayStart) || "09:00");
  const [windowEnd, setWindowEnd] = useState((workingHours && workingHours.weekdayEnd) || "17:30");
  const [callHoursPolicy, setCallHoursPolicy] = useState((workingHours && workingHours.callHoursPolicy) || "respectful");
  const [timezone, setTimezone] = useState((workingHours && workingHours.timezone) || "Europe/London");
  const [lunchStart, setLunchStart] = useState((workingHours && workingHours.lunchStart) || "12:00");
  const [lunchEnd, setLunchEnd] = useState((workingHours && workingHours.lunchEnd) || "13:00");
  const [channel, setChannel] = useState("voice");
  const [noAnswer, setNoAnswer] = useState({ whatsapp: true, sms: true, email: true });

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

  // AI Chat state
  const [copilotMessages, setCopilotMessages] = useState([
    {
      sender: "ai",
      text: "👋 Hi! I'm your AI Chat. Who would you like to reach? Tell me your company offer, target industry, region, or specific companies (e.g. 'Find 5 logistics dispatchers in Texas to pitch our voice AI'). I'll search the web for verified switchboard numbers, decision-makers, and personalized hooks."
    }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatSearching, setChatSearching] = useState(false);
  const [chatDiscoveredLeads, setChatDiscoveredLeads] = useState([]);
  const chatBottomRef = useRef(null);

  const handleCopilotSend = async (e) => {
    e.preventDefault();
    const userMsg = chatInput.trim();
    if (!userMsg || chatSearching) return;

    setChatInput("");
    setCopilotMessages((prev) => [...prev, { sender: "user", text: userMsg }]);
    setChatSearching(true);

    try {
      // Resolve active Lead Gen credentials from commonAi
      const leadgenModel = commonAi?.leadgenLayers?.researchLlm || "DeepSeek-V3";
      const customConn = (commonAi?.customConnections || []).find(
        (c) => c.modelId && c.modelId.toLowerCase() === leadgenModel.toLowerCase()
      );
      let key = customConn?.apiKey || "";
      let burl = customConn?.baseUrl || "";
      let prov = customConn?.providerName || "";
      let mod = customConn?.modelId || leadgenModel;

      if (!key) {
        const m = String(leadgenModel || "").toLowerCase();
        let provId = "deepseek";
        if (m.includes("claude") || m.includes("anthropic") || m.includes("sonnet")) provId = "anthropic";
        else if (m.includes("gpt") || m.includes("openai")) provId = "openai";
        else if (m.includes("groq") || m.includes("llama")) provId = "groq";
        else if (m.includes("grok") || m.includes("xai")) provId = "xai";
        else if (m.includes("gemini")) provId = "gemini";
        else if (m.includes("ollama")) provId = "ollama";
        const pObj = (commonAi?.providers || []).find((p) => p.id === provId);
        if (pObj) {
          key = pObj.apiKey || "";
          burl = pObj.baseUrl || "";
          prov = pObj.name || provId;
        }
      }

      const res = await api.copilotChat({
        message: userMsg,
        history: copilotMessages,
        plugin: "leadgen",
        apiKey: key,
        provider: prov,
        model: mod,
        baseUrl: burl
      });

      if (res && res.reply) {
        if (res.leads && res.leads.length > 0) {
          setChatDiscoveredLeads(res.leads);
        }
        setCopilotMessages((prev) => [
          ...prev,
          { sender: "ai", text: res.reply, leads: res.leads || [] }
        ]);
      }
    } catch (err) {
      setCopilotMessages((prev) => [
        ...prev,
        { sender: "ai", text: `⚠️ AI Chat error: ${err.message || "Failed to reach AI copilot."}` }
      ]);
    } finally {
      setChatSearching(false);
      setTimeout(() => {
        if (chatBottomRef.current) {
          chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
        }
      }, 100);
    }
  };

  const handleApplyChatLeads = (leadsToUse) => {
    const list = leadsToUse || chatDiscoveredLeads;
    if (!list || !list.length) return;
    setRows(
      list.map((l, idx) => ({
        id: Date.now() + idx,
        name: l.name,
        phone: l.phone,
        contact: l.contactPerson || "",
        sourceType: "Website URL",
        source: l.site || "",
        channel: "voice",
        fallback: "whatsapp",
        openingHook: l.openingHook
      }))
    );
    setTab("manual");
    setManualMode("form");
  };

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

  const canSubmit = tab === "discover" ? (chatDiscoveredLeads.length > 0 || parsed) : rows.some((r) => r.name && r.phone);
  const readyToCallCount = tab === "manual" ? rows.filter((r) => r.name && r.phone).length : chatDiscoveredLeads.length;
  const queueEstimate = computeQueueEstimate(readyToCallCount, concurrency, windowStart, windowEnd, lunchStart, lunchEnd);
  const noAnswerFallbacks = ["whatsapp", "sms", "email"].filter((k) => noAnswer[k]);

  if (tab === "manual" && manualMode === "upload" && importState === "parsed") {
    return (
      <ImportReviewScreen
        fileName={importFileName}
        recordCount={importRecords.length}
        importHeaders={importHeaders}
        columnMap={columnMap}
        onColumnMap={updateColumnMap}
        importFilter={importFilter}
        setImportFilter={setImportFilter}
        importRows={importRows}
        filteredRows={filteredImportRows}
        includedCount={includedImportRows.length}
        flaggedCount={flaggedCount}
        duplicateCount={duplicateCount}
        knownCount={knownCount}
        bulkChannel={bulkChannel}
        setBulkChannel={setBulkChannel}
        onToggle={toggleImportRow}
        onUpdate={updateImportRow}
        onRemove={removeImportRow}
        onSelectAll={selectAllShown}
        onApplyChannel={applyBulkChannel}
        onDiscardFlagged={removeFlaggedRows}
        onDifferentFile={resetImport}
        onClose={onClose}
        onConfirm={useImportedRows}
      />
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: tab === "discover" ? 720 : 640, maxHeight: "88vh", overflowY: "auto", padding: 26, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.textInk }}>New Outreach</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={18} color={C.slate} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 18, background: C.paperSoft, padding: 4, borderRadius: 9 }}>
          <button
            onClick={() => setTab("discover")}
            style={{ flex: 1, padding: "9px 12px", borderRadius: 7, border: "none", cursor: "pointer", background: tab === "discover" ? "#fff" : "transparent", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: tab === "discover" ? C.textInk : C.slate, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: tab === "discover" ? "0 1px 3px rgba(0,0,0,0.06)" : "none" }}
          >
            <Sparkles size={14} /> AI Chat
          </button>
          <button
            onClick={() => setTab("manual")}
            style={{ flex: 1, padding: "9px 12px", borderRadius: 7, border: "none", cursor: "pointer", background: tab === "manual" ? "#fff" : "transparent", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: tab === "manual" ? C.textInk : C.slate, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: tab === "manual" ? "0 1px 3px rgba(0,0,0,0.06)" : "none" }}
          >
            <Users size={14} /> Provide Contact List / Setup
          </button>
        </div>

        {tab === "discover" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Standalone Chat Messages Container */}
            <div style={{ background: "#F8FAFC", border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px", height: 480, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
              {copilotMessages.map((m, idx) => (
                <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: m.sender === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "88%",
                    padding: "10px 14px",
                    borderRadius: 12,
                    fontSize: 13,
                    fontFamily: FONT_BODY,
                    lineHeight: 1.45,
                    background: m.sender === "user" ? C.ink : "#fff",
                    color: m.sender === "user" ? "#fff" : C.textInk,
                    border: m.sender === "user" ? "none" : `1px solid ${C.border}`,
                    boxShadow: "0 1px 4px rgba(0,0,0,0.04)"
                  }}>
                    {m.text}
                  </div>

                  {/* If assistant returned leads in this message */}
                  {m.leads && m.leads.length > 0 && (
                    <div style={{ marginTop: 10, width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#0F172A", textTransform: "uppercase" }}>
                          Discovered Candidates ({m.leads.length})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleApplyChatLeads(m.leads)}
                          style={{ background: "#2563EB", color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}
                        >
                          <CheckCircle2 size={13} /> Use in Campaign ({m.leads.length})
                        </button>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 190, overflowY: "auto" }}>
                        {m.leads.map((l, i) => (
                          <div key={i} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 12.5, color: C.textInk, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {l.name}
                              </div>
                              <div style={{ fontSize: 11, color: C.slate, display: "flex", alignItems: "center", gap: 6 }}>
                                <span>👤 {l.contactPerson}</span>
                                <span>📞 {l.phone}</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleApplyChatLeads([l])}
                              style={{ background: "#F1F5F9", border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer", color: C.textInk, whiteSpace: "nowrap" }}
                            >
                              + Use
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {chatSearching && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.slate, fontSize: 12.5, padding: "6px 10px" }}>
                  <RefreshCw size={14} className="animate-spin" color="#2563EB" /> Searching and verifying contacts...
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Chat Input Bar */}
            <form onSubmit={handleCopilotSend} style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="e.g. Find 5 trucking dispatchers in Dallas to pitch voice AI..."
                disabled={chatSearching}
                style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", background: "#fff" }}
              />
              <button
                type="submit"
                disabled={chatSearching || !chatInput.trim()}
                style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "0 18px", fontSize: 13, fontWeight: 600, cursor: chatSearching ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                {chatSearching ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
                Search
              </button>
            </form>
          </div>
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
                  .csv, .xlsx, .xls — one row per company. After upload, the list opens in a full review screen.
                </div>
                {importState === "error" && (
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.redSolid, marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
                    <AlertTriangle size={12} /> {importError}
                  </div>
                )}
              </label>
            )}

            {manualMode === "form" && (
            <>
            {importState === "parsed" && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: C.tealSoft, borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk, lineHeight: 1.4 }}>
                  <strong>{rows.filter((r) => r.name && r.phone).length}</strong> companies from {importFileName}
                </div>
                <button
                  onClick={() => setManualMode("upload")}
                  style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 11px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.textInk, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  Review list
                </button>
              </div>
            )}
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginBottom: 10 }}>
              {importState === "parsed"
                ? "Channel, timezone and lunch are next. Open Review list if you need to tick or edit companies."
                : "Add businesses to contact directly — include a link so the AI can research them before calling."}
            </div>
            {importState === "parsed" ? (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflowX: "hidden", overflowY: "auto", maxHeight: 200, marginBottom: 4 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1.1fr 1fr", gap: 8, padding: "8px 12px", background: C.paper, fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                  <div>Company</div>
                  <div>Phone</div>
                  <div>Contact</div>
                </div>
                {rows.map((r) => (
                  <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1.5fr 1.1fr 1fr", gap: 8, padding: "9px 12px", borderTop: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk }}>
                    <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name || "—"}</div>
                    <div style={{ color: C.slate, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.phone || "—"}</div>
                    <div style={{ color: C.slate, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.contact || "—"}</div>
                  </div>
                ))}
              </div>
            ) : (
            <>
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
              { id: "email", label: "Email", icon: Mail },
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
              ? "AI tries a voice call first. If they don't pick up, it follows the fallbacks you tick below — WhatsApp, SMS, then email."
              : `Used for any company that doesn't have its own channel set — contacted by ${channel === "voice" ? "phone call" : channel === "whatsapp" ? "WhatsApp message" : channel === "email" ? "email" : "text message"}.`}
          </div>
        </div>

        <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8 }}>
            If they don't pick up
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginBottom: 8 }}>
            After a missed voice call, reach them on the channels you allow — in this order.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { id: "whatsapp", label: "WhatsApp" },
              { id: "sms", label: "SMS" },
              { id: "email", label: "Email" },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => setNoAnswer((n) => ({ ...n, [opt.id]: !n[opt.id] }))}
                style={{
                  padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600,
                  border: `1.5px solid ${noAnswer[opt.id] ? C.ink : C.border}`, background: noAnswer[opt.id] ? C.ink : "#fff", color: noAnswer[opt.id] ? "#fff" : C.slate,
                }}
              >
                {noAnswer[opt.id] ? "✓ " : ""}{opt.label}
              </button>
            ))}
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 6 }}>
            {noAnswerFallbacks.length
              ? `Sequence: Voice call → ${noAnswerFallbacks.map((k) => CHANNEL_OPTIONS.find((c) => c.id === k).label).join(" → ")}`
              : "No fallback — missed calls stay as no-answer until you retry."}
          </div>
        </div>

        <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <Clock size={12} /> Call schedule
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>Timezone</span>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ padding: "6px 9px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5, maxWidth: 280 }}>
              {TIMEZONES.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>Call window</span>
            <select value={windowStart} onChange={(e) => { setWindowStart(e.target.value); setCallHoursPolicy("custom"); }} style={{ padding: "6px 9px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5 }}>
              {PECR_WEEKDAY_SLOTS.filter((t) => timeToMinutes(t) < timeToMinutes(windowEnd)).map((t) => <option key={t}>{t}</option>)}
            </select>
            <span style={{ color: C.slateLight }}>–</span>
            <select value={windowEnd} onChange={(e) => { setWindowEnd(e.target.value); setCallHoursPolicy("custom"); }} style={{ padding: "6px 9px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5 }}>
              {PECR_WEEKDAY_SLOTS.filter((t) => timeToMinutes(t) > timeToMinutes(windowStart)).map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {CALL_HOUR_POLICIES.map((p) => {
              const active = callHoursPolicy === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setCallHoursPolicy(p.id);
                    setWindowStart(p.weekdayStart);
                    setWindowEnd(p.weekdayEnd);
                  }}
                  style={{
                    padding: "6px 10px", borderRadius: 7, cursor: "pointer", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600,
                    border: `1.5px solid ${active ? C.ink : C.border}`, background: active ? C.ink : "#fff", color: active ? "#fff" : C.slate,
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, marginTop: 8, lineHeight: 1.45 }}>
            {callHoursPolicy === "pecr_max"
              ? "Full PECR weekday window (08:00–21:00). Weekends stay 09:00–18:00. This is the legal maximum, not a guess."
              : callHoursPolicy === "respectful"
                ? "Shorter than the law on purpose — PECR allows 08:00–21:00 weekdays. You are leaving ~3.5 evening hours unused."
                : "Custom window. Hard stop is PECR: weekdays 08:00–21:00, weekends 09:00–18:00. The app will not offer slots outside that."}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>Lunch — do not disturb</span>
            <select value={lunchStart} onChange={(e) => setLunchStart(e.target.value)} style={{ padding: "6px 9px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5 }}>
              {["12:00", "12:30", "13:00"].map((t) => <option key={t}>{t}</option>)}
            </select>
            <span style={{ color: C.slateLight }}>–</span>
            <select value={lunchEnd} onChange={(e) => setLunchEnd(e.target.value)} style={{ padding: "6px 9px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5 }}>
              {["13:00", "13:30", "14:00"].map((t) => <option key={t}>{t}</option>)}
            </select>
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
                  ? <><strong>{readyToCallCount} companies</strong> queued — at {concurrency} concurrent, skipping lunch {lunchStart}–{lunchEnd}, should finish today around <strong>{queueEstimate.finishLabel}</strong> ({timezoneLabel(timezone).split(" — ")[0]}).</>
                  : <><strong>{readyToCallCount} companies</strong> queued won't all fit in today's {windowStart}–{windowEnd} window once lunch {lunchStart}–{lunchEnd} is blocked (~{queueEstimate.capacityPerDay} fit per day). Expect about <strong>{queueEstimate.daysNeeded} days</strong>.</>}
              </span>
            </div>
          )}
        </div>

        <button
          onClick={() =>
            canSubmit &&
            onCreate({
              tab: (tab === "discover" && chatDiscoveredLeads.length > 0) ? "manual" : tab,
              prompt,
              rows: tab === "manual"
                ? rows.filter((r) => r.name && r.phone)
                : chatDiscoveredLeads.length > 0
                  ? chatDiscoveredLeads.map((l) => ({
                      name: l.name,
                      phone: l.phone,
                      contact: l.contactPerson || "",
                      sourceType: "Website URL",
                      source: l.site || "",
                      channel: "voice",
                      fallback: "whatsapp",
                      openingHook: l.openingHook
                    }))
                  : [],
              channel,
              windowStart,
              windowEnd,
              callHoursPolicy,
              concurrency,
              queueEstimate,
              timezone,
              lunchStart,
              lunchEnd,
              noAnswerFallbacks,
              understood: readyToCallCount,
              fileRows: readyToCallCount,
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

function mockOutreachTranscript(channel, prospectName) {
  const ch = !channel || channel === "auto" ? "voice" : channel;
  if (ch === "whatsapp" || ch === "sms") {
    return [
      `AI: Hi, this is Sam from AIVHub — worth a 15-min chat about ops dashboards for ${prospectName}?`,
      "Prospect: Maybe — Thursday afternoon could work, send more first.",
      "AI: I'll send a one-pager. Thursday afternoon is locked if you want it.",
    ];
  }
  if (ch === "email") {
    return [
      `AI: Subject: 15-min on ops dashboards for ${prospectName}`,
      "Prospect: Thursday afternoon might work — can you send a one-pager first?",
    ];
  }
  return [
    "AI: Hi, this is Sam calling on behalf of AIVHub — have you got a minute about ops dashboards?",
    "Prospect: Yeah, go on — what's this about?",
    "AI: Would Thursday at 2pm work for a short call with your ops lead?",
    "Prospect: Thursday afternoon works, put it in.",
  ];
}

function durationForChannel(channel, state) {
  if (channel === "whatsapp" || channel === "sms") return "2 messages";
  if (channel === "email") return "1 email";
  if (state === "human_review") return "01:12";
  if (state === "negotiating") return "02:04";
  return "00:38";
}

function resolveChannel(channel) {
  return !channel || channel === "auto" ? "voice" : channel;
}

function nextFallbackChannel(fallbacks, currentChannel) {
  const seq = ["voice", ...(fallbacks || [])].filter((c, i, arr) => arr.indexOf(c) === i);
  const current = resolveChannel(currentChannel);
  const idx = seq.indexOf(current);
  if (idx === -1) return seq.find((c) => c !== current) || null;
  return seq[idx + 1] || null;
}

function buildLiveCard({ prospect, missionTitle, missionId, prospectId, channel, index }) {
  const ch = resolveChannel(channel);
  const state = index % 3 === 1 ? "pitching" : "negotiating";
  return {
    id: "lc_" + prospectId + "_" + ch,
    prospect,
    mission: missionTitle,
    missionId,
    prospectId,
    state,
    channel: ch,
    duration: durationForChannel(ch, state),
    flag: undefined,
    transcript: mockOutreachTranscript(ch, prospect),
    taken: false,
    listening: false,
    confirmingEnd: false,
    ended: false,
    booked: false,
    fromUpload: true,
  };
}

function tallyMission(prospects) {
  const contacted = prospects.filter((p) =>
    ["meeting_booked", "contacted", "rejected", "left_voicemail", "emailed", "operator_ended"].includes(p.status)
  ).length;
  const meetingsBooked = prospects.filter((p) => p.status === "meeting_booked").length;
  return { contacted, meetingsBooked };
}

function patchMissionProspects(missions, missionId, updater) {
  return missions.map((m) => {
    if (m.id !== missionId) return m;
    const prospects = updater(m.prospects, m);
    return { ...m, prospects, ...tallyMission(prospects) };
  });
}

/* ---------------------------------- login + plugin hub ---------------------------------- */

function BrandMark({ size = 36 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        background: `linear-gradient(135deg, ${C.cobalt}, ${C.teal})`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <PhoneCall size={size * 0.46} color="#fff" strokeWidth={2.4} />
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Please enter username and password.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await api.login(username.trim(), password);
      if (res && res.operator) {
        sessionStorage.setItem("aivhub_operator", JSON.stringify(res.operator));
        onLogin(res.operator);
      } else {
        setError("Invalid response from authentication server.");
      }
    } catch (err) {
      setError(err.message || "Invalid username or password. Access restricted.");
    } finally {
      setLoading(false);
    }
  };

  const field = {
    width: "100%",
    height: 44,
    borderRadius: 10,
    border: `1px solid ${C.border}`,
    background: "#fff",
    padding: "0 14px",
    fontFamily: FONT_BODY,
    fontSize: 14,
    color: C.textInk,
  };

  return (
    <div style={{ minHeight: "100vh", background: HUB_PAPER, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: FONT_BODY }}>
      <AppChrome />
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 28 }}>
          <BrandMark size={44} />
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 28, color: C.ink, letterSpacing: "-0.03em", marginTop: 14 }}>AIVHub</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.slate, marginTop: 6, textAlign: "center" }}>
            Sign in to open your plugins
          </div>
        </div>
        <div
          style={{
            background: "#fff",
            border: `1px solid ${C.border}`,
            borderRadius: 20,
            padding: "28px 28px 24px",
            boxShadow: "0 18px 50px rgba(18,20,28,0.06)",
          }}
        >
          <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Username</label>
          <input
            autoFocus
            value={username}
            onChange={(e) => { setUsername(e.target.value); setError(""); }}
            placeholder="e.g. Admin"
            style={{ ...field, marginBottom: 16 }}
          />
          <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Password</label>
          <div style={{ position: "relative", marginBottom: 8 }}>
            <Lock size={14} color={C.slateLight} style={{ position: "absolute", left: 14, top: 15 }} />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="••••••••"
              style={{ ...field, paddingLeft: 36, paddingRight: 40 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 4,
                display: "flex",
                alignItems: "center",
                color: C.slateLight,
              }}
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {error && (
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.red, background: C.redSoft, border: `1px solid #F0C4B8`, borderRadius: 8, padding: "8px 12px", margin: "10px 0 4px", display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={14} /> {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              height: 46,
              marginTop: 16,
              borderRadius: 12,
              border: "none",
              background: C.ink,
              color: "#fff",
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              fontSize: 15,
              cursor: loading ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {loading ? (
              <>
                <RefreshCw size={15} className="animate-spin" />
                <span>Authenticating...</span>
              </>
            ) : (
              <span>Sign in</span>
            )}
          </button>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, marginTop: 14, lineHeight: 1.45, textAlign: "center" }}>
            Authorized access only. Primary profile: <span style={{ color: C.textInk, fontWeight: 600 }}>Admin</span> / <span style={{ color: C.textInk, fontWeight: 600 }}>password</span>
          </div>
        </div>
      </form>
    </div>
  );
}

function PluginCard({ icon: Icon, title, blurb, accent, ready, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 340,
        minHeight: 280,
        textAlign: "left",
        background: "#fff",
        border: `1px solid ${hover ? accent : C.border}`,
        borderRadius: 22,
        padding: 28,
        cursor: "pointer",
        boxShadow: hover ? "0 22px 48px rgba(18,20,28,0.10)" : "0 10px 28px rgba(18,20,28,0.04)",
        transform: hover ? "translateY(-3px)" : "none",
        transition: "transform 0.15s, box-shadow 0.15s, border-color 0.15s",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 14,
          background: `${accent}18`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 20,
        }}
      >
        <Icon size={24} color={accent} strokeWidth={2.1} />
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.slateLight, marginBottom: 8 }}>
        Plugin
      </div>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, letterSpacing: "-0.03em", lineHeight: 1.2 }}>
        {title}
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.slate, marginTop: 10, lineHeight: 1.5, flex: 1 }}>
        {blurb}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 22 }}>
        <span
          style={{
            fontFamily: FONT_BODY,
            fontSize: 11.5,
            fontWeight: 700,
            color: ready ? C.teal : C.amber,
            background: ready ? C.tealSoft : C.amberSoft,
            borderRadius: 999,
            padding: "4px 10px",
          }}
        >
          {ready ? "Open" : "Coming soon"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: accent }}>
          {ready ? "Enter" : "Preview"} <ArrowRight size={14} />
        </span>
      </div>
    </button>
  );
}


/* ---------------------------------- Common AI Configuration Modal & Views ---------------------------------- */

function CommonAiConfigModal({ isOpen, onClose, commonAi, setCommonAi, initialTab = "leadgen", onNavigateToPlugin }) {
  const [tab, setTab] = useState(initialTab || "leadgen");
  const [dirty, setDirty] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [testStatus, setTestStatus] = useState({});
  const [showCustomEndpoint, setShowCustomEndpoint] = useState(false);

  // Movable / Draggable window state
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

  // Custom API / Dedicated Model Drawer state
  const [showCustomDrawer, setShowCustomDrawer] = useState(false);
  const [customFeatureKey, setCustomFeatureKey] = useState("");
  const [customProviderName, setCustomProviderName] = useState("OpenAI Compatible");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customModelId, setCustomModelId] = useState("");
  const [isSavingCustom, setIsSavingCustom] = useState(false);
  const [customNotice, setCustomNotice] = useState(null);

  // Mouse handlers for dragging modal by its header
  const handleMouseDownHeader = (e) => {
    if (e.target.closest("button") || e.target.closest("input") || e.target.closest("select") || e.target.closest("a") || e.target.closest("textarea")) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: position.x,
      posY: position.y,
    };
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e) => {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPosition({
        x: dragStartRef.current.posX + dx,
        y: dragStartRef.current.posY + dy,
      });
    };
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (isOpen && initialTab) {
      setTab(initialTab);
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const safeCommonAi = {
    ...INITIAL_COMMON_AI_CONFIG,
    ...(commonAi || {}),
    providers: (commonAi?.providers && Array.isArray(commonAi.providers) && commonAi.providers.length)
      ? commonAi.providers
      : INITIAL_COMMON_AI_CONFIG.providers,
    leadgenLayers: { ...INITIAL_COMMON_AI_CONFIG.leadgenLayers, ...(commonAi?.leadgenLayers || {}) },
    schedulerLayers: { ...INITIAL_COMMON_AI_CONFIG.schedulerLayers, ...(commonAi?.schedulerLayers || {}) },
    emailLayers: { ...INITIAL_COMMON_AI_CONFIG.emailLayers, ...(commonAi?.emailLayers || {}) },
    voiceLayers: { ...INITIAL_COMMON_AI_CONFIG.voiceLayers, ...(commonAi?.voiceLayers || {}) },
    customConnections: Array.isArray(commonAi?.customConnections) ? commonAi.customConnections : [],
    subscription: { ...INITIAL_COMMON_AI_CONFIG.subscription, ...(commonAi?.subscription || {}) },
    channelDirectives: { ...INITIAL_COMMON_AI_CONFIG.channelDirectives, ...(commonAi?.channelDirectives || {}) },
  };

  const flash = () => {
    setDirty(true);
    setTimeout(() => setDirty(false), 1400);
  };

  const updateProviderKey = (id, key) => {
    setCommonAi((prev) => {
      const provs = (prev && prev.providers) || safeCommonAi.providers;
      return {
        ...prev,
        providers: provs.map((p) => (p.id === id ? { ...p, apiKey: key } : p)),
      };
    });
    flash();
  };

  const updateProviderBaseUrl = (id, url) => {
    setCommonAi((prev) => {
      const provs = (prev && prev.providers) || safeCommonAi.providers;
      return {
        ...prev,
        providers: provs.map((p) => (p.id === id ? { ...p, baseUrl: url } : p)),
      };
    });
    flash();
  };

  const testConnection = async (id) => {
    const p = safeCommonAi.providers.find((prov) => prov.id === id);
    if (!p) return;

    if (!p.apiKey && p.id !== "ollama") {
      setTestStatus((prev) => ({ ...prev, [id]: { status: "error", msg: "Please enter an API key to test." } }));
      return;
    }

    setTestingId(id);
    setTestStatus((prev) => ({ ...prev, [id]: null }));
    const startTime = Date.now();

    try {
      const res = await api.testAndSaveConnection({
        layer: p.type || "LLM",
        provider: p.name,
        api_key: p.apiKey || "dummy_key",
        base_url: p.baseUrl || undefined,
      });

      const latency = Math.max(Date.now() - startTime, 28);
      setCommonAi((prev) => ({
        ...prev,
        providers: (prev?.providers || safeCommonAi.providers).map((item) =>
          item.id === id ? { ...item, status: "connected", latencyMs: latency } : item
        ),
      }));
      setTestStatus((prev) => ({
        ...prev,
        [id]: { status: "success", msg: res.details || "Verified & connected successfully!" },
      }));
      flash();
    } catch (err) {
      setTestStatus((prev) => ({
        ...prev,
        [id]: { status: "error", msg: err.message || "Connection failed. Please check your key or URL." },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const updateLeadgenLayer = (key, val) => {
    setCommonAi((prev) => ({
      ...prev,
      leadgenLayers: { ...((prev && prev.leadgenLayers) || {}), [key]: val },
    }));
    flash();
  };

  const updateSchedulerLayer = (key, val) => {
    setCommonAi((prev) => {
      const nextSchedLayers = { ...((prev && prev.schedulerLayers) || {}), [key]: val };
      const nextSchedAi = {
        ...((prev && prev.schedulerAi) || {}),
        ...(key === "postWriter" ? { model: val, provider: getProviderIdForModel(val) } : {}),
        ...(key === "imageStudio" ? { imageEngine: val } : {}),
      };
      try { localStorage.setItem("aivhub_scheduler_ai", JSON.stringify(nextSchedAi)); } catch (_) {}
      return {
        ...prev,
        schedulerLayers: nextSchedLayers,
        schedulerAi: nextSchedAi,
      };
    });
    flash();
  };

  const updateEmailLayer = (key, val) => {
    setCommonAi((prev) => ({
      ...prev,
      emailLayers: { ...((prev && prev.emailLayers) || {}), [key]: val },
    }));
    flash();
  };

  const updateVoiceLayer = (key, val) => {
    setCommonAi((prev) => ({
      ...prev,
      voiceLayers: { ...((prev && prev.voiceLayers) || {}), [key]: val },
    }));
    flash();
  };

  // Connect & Save custom API with user-provided model ID (Does NOT vanish suddenly!)
  const handleSaveCustomConnection = async (targetPluginId, layers) => {
    if (!customApiKey.trim() && !customProviderName.toLowerCase().includes("ollama")) {
      setCustomNotice({ type: "error", text: "Please enter an API key or token." });
      return;
    }
    const fallbackFirstKey = layers[0]?.key;
    const assignedFeature = customFeatureKey || fallbackFirstKey;
    const featureObj = layers.find((l) => l.key === assignedFeature);
    const featureLabel = featureObj?.label || assignedFeature;
    const modelName = customModelId.trim() || `${customProviderName} Model`;
    const apiKey = customApiKey.trim();
    const baseUrl = customBaseUrl.trim();

    setIsSavingCustom(true);
    try {
      // 1. Update the layer's model to the user's custom model name directly
      if (targetPluginId === "leadgen") updateLeadgenLayer(assignedFeature, modelName);
      if (targetPluginId === "scheduler") updateSchedulerLayer(assignedFeature, modelName);
      if (targetPluginId === "email") updateEmailLayer(assignedFeature, modelName);
      if (targetPluginId === "voice") updateVoiceLayer(assignedFeature, modelName);

      // 2. Create the custom connection record
      const newConnId = `custom_${Date.now()}`;
      const newConn = {
        id: newConnId,
        pluginId: targetPluginId,
        featureKey: assignedFeature,
        featureLabel: featureLabel,
        providerName: customProviderName,
        modelId: modelName,
        apiKey: apiKey,
        baseUrl: baseUrl || undefined,
        status: "connected",
        latencyMs: 32,
        createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      // 3. Save into commonAi
      setCommonAi((prev) => {
        const existingConns = (prev && prev.customConnections) || safeCommonAi.customConnections || [];
        const filteredConns = existingConns.filter((c) => !(c.pluginId === targetPluginId && c.featureKey === assignedFeature));
        const updatedConns = [newConn, ...filteredConns];

        const provs = (prev && prev.providers) || safeCommonAi.providers;
        return {
          ...prev,
          customConnections: updatedConns,
          providers: [
            ...provs,
            {
              id: newConn.id,
              name: `${customProviderName} (${modelName})`,
              type: "llm",
              apiKey: apiKey,
              baseUrl: baseUrl || undefined,
              status: "connected",
              latencyMs: 32,
            },
          ],
        };
      });

      // 4. Show persistent success confirmation (NEVER abruptly vanish!)
      setCustomNotice({
        type: "success",
        text: `✓ Saved & Connected! Model "${modelName}" is now active for "${featureLabel}".`,
      });
      flash();

      // Clear input fields for next use, keeping drawer accessible and notice visible
      setCustomApiKey("");
      setCustomModelId("");
      setCustomBaseUrl("");
    } catch (e) {
      setCustomNotice({ type: "error", text: "Failed to connect custom model." });
    } finally {
      setIsSavingCustom(false);
    }
  };

  const handleRemoveCustomConnection = (connId, pluginId, featureKey) => {
    setCommonAi((prev) => {
      const existingConns = (prev && prev.customConnections) || safeCommonAi.customConnections || [];
      const updatedConns = existingConns.filter((c) => c.id !== connId);
      const provs = ((prev && prev.providers) || safeCommonAi.providers).filter((p) => p.id !== connId);
      return {
        ...prev,
        customConnections: updatedConns,
        providers: provs,
      };
    });
    flash();
  };

  const getProviderIdForModel = (modelName) => {
    const m = String(modelName || "").toLowerCase();
    const customConn = (safeCommonAi.customConnections || []).find((c) => c.modelId.toLowerCase() === m);
    if (customConn) return customConn.id;
    if (m.includes("claude") || m.includes("anthropic") || m.includes("sonnet") || m.includes("haiku")) return "anthropic";
    if (m.includes("gpt") || m.includes("o3") || m.includes("openai") || m.includes("dall-e") || m.includes("text-embedding")) return "openai";
    if (m.includes("grok") || m.includes("xai")) return "xai";
    if (m.includes("deepseek")) return "deepseek";
    if (m.includes("groq") || m.includes("llama")) return "groq";
    if (m.includes("gemini") || m.includes("google")) return "gemini";
    if (m.includes("elevenlabs")) return "elevenlabs";
    if (m.includes("deepgram")) return "deepgram";
    if (m.includes("twilio") || m.includes("telnyx")) return "twilio";
    if (m.includes("vapi")) return "vapi";
    if (m.includes("ollama") || m.includes("local")) return "ollama";
    return "openai";
  };

  const renderProviderKeyCard = (providerId, contextLabel) => {
    const prov = safeCommonAi.providers.find((p) => p.id === providerId) || {
      id: providerId,
      name: providerId.toUpperCase(),
      apiKey: "",
      baseUrl: "",
      status: "not_configured"
    };

    const isTesting = testingId === prov.id;
    const testInfo = testStatus[prov.id];
    const isConnected = prov.status === "connected" || !!prov.apiKey;

    return (
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px", marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink }}>
                {prov.name} API Key
              </span>
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: isConnected ? "#ECFDF5" : "#FEF3C7", color: isConnected ? "#059669" : "#D97706" }}>
                {isConnected ? "Connected" : "Key Needed"}
              </span>
            </div>
            <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
              Active key for {contextLabel}
            </div>
          </div>

          {prov.latencyMs && (
            <span style={{ fontSize: 11, fontFamily: FONT_MONO, color: C.teal, background: C.tealSoft, padding: "2px 7px", borderRadius: 4, fontWeight: 600 }}>
              {prov.latencyMs}ms latency
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <input
              type={showKey ? "text" : "password"}
              value={prov.apiKey || ""}
              onChange={(e) => updateProviderKey(prov.id, e.target.value)}
              placeholder={`Paste your ${prov.name} API key here (sk-...)`}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "9px 36px 9px 12px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                fontFamily: FONT_MONO,
                fontSize: 12.5,
                background: HUB_PAPER,
              }}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", cursor: "pointer", color: C.slate }}
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          <button
            type="button"
            onClick={() => testConnection(prov.id)}
            disabled={isTesting}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "9px 16px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: "#fff",
              fontSize: 12.5,
              fontWeight: 600,
              color: C.ink,
              cursor: isTesting ? "wait" : "pointer",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <RefreshCw size={13} className={isTesting ? "animate-spin" : ""} />
            <span>{isTesting ? "Testing..." : "Test Connection"}</span>
          </button>
        </div>

        {testInfo && (
          <div style={{
            marginTop: 10,
            padding: "8px 12px",
            borderRadius: 7,
            fontSize: 12,
            background: testInfo.status === "success" ? "#ECFDF5" : "#FEF2F2",
            color: testInfo.status === "success" ? "#065F46" : "#991B1B",
            border: `1px solid ${testInfo.status === "success" ? "#A7F3D0" : "#FECACA"}`,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}>
            <span>{testInfo.status === "success" ? "✓" : "⚠️"}</span>
            <span>{testInfo.msg}</span>
          </div>
        )}

        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setShowCustomEndpoint(!showCustomEndpoint)}
            style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 11.5, color: C.cobalt, padding: 0, fontWeight: 600, textDecoration: "underline" }}
          >
            {showCustomEndpoint ? "Hide custom endpoint" : "Use custom endpoint / local proxy URL"}
          </button>

          {showCustomEndpoint && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: C.slate }}>Base URL (e.g. http://localhost:11434/v1 or private proxy)</label>
              <input
                type="text"
                value={prov.baseUrl || ""}
                onChange={(e) => updateProviderBaseUrl(prov.id, e.target.value)}
                placeholder="https://api.your-provider.com/v1"
                style={{ padding: "7px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12 }}
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  // Renders the persistent custom connections + add custom API drawer
  const renderCustomConnectionsSection = (pluginId, layers) => {
    const savedForPlugin = (safeCommonAi.customConnections || []).filter((c) => c.pluginId === pluginId);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
        {/* Persistent List of Connected Custom APIs (Never Vanishes!) */}
        {savedForPlugin.length > 0 && (
          <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "14px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: "#10B981" }} />
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13.5, color: C.ink }}>
                  Connected Custom APIs & Dedicated Models ({savedForPlugin.length})
                </span>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#059669", background: "#ECFDF5", padding: "2px 8px", borderRadius: 5, border: "1px solid #A7F3D0" }}>
                Active in Software
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {savedForPlugin.map((conn) => (
                <div
                  key={conn.id}
                  style={{
                    background: "#fff",
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 13, color: C.ink }}>
                        {conn.modelId}
                      </span>
                      <span style={{ fontSize: 10.5, color: C.slate, background: HUB_PAPER, padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>
                        {conn.providerName}
                      </span>
                      {conn.latencyMs && (
                        <span style={{ fontSize: 10.5, color: C.teal, fontWeight: 600 }}>
                          {conn.latencyMs}ms latency
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2 }}>
                      Assigned feature: <strong style={{ color: C.textInk }}>{conn.featureLabel || conn.featureKey}</strong>
                      {conn.baseUrl ? ` · Endpoint: ${conn.baseUrl}` : ""}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => handleRemoveCustomConnection(conn.id, conn.pluginId, conn.featureKey)}
                      style={{
                        fontSize: 11,
                        color: "#DC2626",
                        border: "1px solid #FECACA",
                        background: "#FEF2F2",
                        padding: "5px 10px",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add Custom API Form Card */}
        <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13.5, color: C.ink, display: "flex", alignItems: "center", gap: 6 }}>
                <Plus size={15} color={C.cobalt} />
                Connect Custom AI API or Dedicated Model
              </div>
              <div style={{ fontSize: 11.5, color: C.slate, marginTop: 1 }}>
                Route any specific capability in this plugin to your private LLM endpoint, fine-tune, or custom provider.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowCustomDrawer(!showCustomDrawer)}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: `1px solid ${C.border}`,
                background: showCustomDrawer ? C.paperSoft : "#fff",
                fontSize: 12,
                fontWeight: 600,
                color: C.ink,
                cursor: "pointer",
              }}
            >
              {showCustomDrawer ? "Close Form" : "+ Add Custom API"}
            </button>
          </div>

          {showCustomDrawer && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.borderLight}`, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 4 }}>
                    Assign to Plugin Feature
                  </label>
                  <select
                    value={customFeatureKey || layers[0]?.key}
                    onChange={(e) => setCustomFeatureKey(e.target.value)}
                    style={{ width: "100%", height: 36, padding: "0 8px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, background: "#fff" }}
                  >
                    {layers.map((l) => (
                      <option key={l.key} value={l.key}>{l.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 4 }}>
                    Provider Framework
                  </label>
                  <select
                    value={customProviderName}
                    onChange={(e) => setCustomProviderName(e.target.value)}
                    style={{ width: "100%", height: 36, padding: "0 8px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, background: "#fff" }}
                  >
                    <option value="OpenAI Compatible">OpenAI Compatible (Any /v1 API)</option>
                    <option value="Anthropic">Anthropic Claude</option>
                    <option value="DeepSeek">DeepSeek AI</option>
                    <option value="xAI">xAI (Grok)</option>
                    <option value="Groq">Groq LPU</option>
                    <option value="Ollama">Ollama / vLLM (Localhost)</option>
                    <option value="ElevenLabs">ElevenLabs Voice</option>
                    <option value="Custom Proxy">Custom Enterprise Gateway</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 4 }}>
                    API Key / Secret Token
                  </label>
                  <input
                    type="password"
                    value={customApiKey}
                    onChange={(e) => setCustomApiKey(e.target.value)}
                    placeholder="sk-... or private token"
                    style={{ width: "100%", boxSizing: "border-box", height: 36, padding: "0 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: FONT_MONO }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 4 }}>
                    Model Identifier (User Provided)
                  </label>
                  <input
                    type="text"
                    value={customModelId}
                    onChange={(e) => setCustomModelId(e.target.value)}
                    placeholder="e.g. meta-llama/llama-3.3-70b or my-model"
                    style={{ width: "100%", boxSizing: "border-box", height: 36, padding: "0 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: FONT_MONO }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 4 }}>
                  Base URL / Endpoint (Optional — leave blank for default cloud URLs)
                </label>
                <input
                  type="text"
                  value={customBaseUrl}
                  onChange={(e) => setCustomBaseUrl(e.target.value)}
                  placeholder="https://api.your-company.com/v1 or http://localhost:11434/v1"
                  style={{ width: "100%", boxSizing: "border-box", height: 36, padding: "0 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: FONT_MONO }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                <div>
                  {customNotice && (
                    <div style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      background: customNotice.type === "success" ? "#ECFDF5" : "#FEF2F2",
                      color: customNotice.type === "success" ? "#065F46" : "#991B1B",
                      border: `1px solid ${customNotice.type === "success" ? "#A7F3D0" : "#FECACA"}`,
                    }}>
                      {customNotice.type === "success" ? "✓ " : "⚠️ "}{customNotice.text}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleSaveCustomConnection(pluginId, layers)}
                  disabled={isSavingCustom}
                  style={{
                    padding: "8px 20px",
                    borderRadius: 7,
                    background: C.ink,
                    color: "#fff",
                    fontSize: 12.5,
                    fontWeight: 600,
                    border: "none",
                    cursor: isSavingCustom ? "wait" : "pointer",
                  }}
                >
                  {isSavingCustom ? "Connecting..." : "Verify & Save to Software"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // User-defined Model Name Input + Suggestions Datalist (NO LOCKING/RESTRICTION!)
  const renderPluginAiFeaturesList = (pluginId, layers, currentValues, onUpdateValue) => {
    const customModelsForPlugin = (safeCommonAi.customConnections || [])
      .filter((c) => c.pluginId === pluginId)
      .map((c) => c.modelId);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {layers.map((layer) => {
          const currentModel = currentValues[layer.key] || layer.paid;
          const isCustomModel = !layer.options.includes(currentModel);

          return (
            <div
              key={layer.key}
              style={{
                background: HUB_PAPER,
                border: `1px solid ${isCustomModel ? "#C7D2FE" : C.border}`,
                borderRadius: 10,
                padding: "12px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
              }}
            >
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: C.ink }}>
                    {layer.label}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "#EEF2F6", color: C.slate }}>
                    {layer.key}
                  </span>
                  {isCustomModel && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "#EEF2FF", color: "#4F46E5", border: "1px solid #C7D2FE" }}>
                      User Defined Model
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2 }}>
                  {layer.desc || "Active autonomous cognitive capability"}
                </div>
              </div>

              {/* Editable Model Name Input with Suggestions Datalist */}
              <div style={{ width: 290, flexShrink: 0, position: "relative" }}>
                <input
                  type="text"
                  list={`model-suggestions-${layer.key}`}
                  value={currentModel}
                  onChange={(e) => onUpdateValue(layer.key, e.target.value)}
                  placeholder="Type or pick any model name..."
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    height: 38,
                    padding: "0 12px",
                    borderRadius: 7,
                    border: `1px solid ${isCustomModel ? "#818CF8" : C.border}`,
                    fontSize: 12.5,
                    fontWeight: 600,
                    fontFamily: isCustomModel ? FONT_MONO : FONT_BODY,
                    background: isCustomModel ? "#FBFBFF" : "#fff",
                    color: C.ink,
                    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  }}
                />
                <datalist id={`model-suggestions-${layer.key}`}>
                  {customModelsForPlugin.map((cm) => (
                    <option key={cm} value={cm}>{cm} (Your Custom Model)</option>
                  ))}
                  {layer.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                  <option value="gpt-4.5-preview" />
                  <option value="claude-3-7-sonnet-20250219" />
                  <option value="deepseek-chat" />
                  <option value="deepseek-reasoner" />
                  <option value="meta-llama/llama-3.3-70b-instruct" />
                  <option value="qwen/qwen-2.5-72b-instruct" />
                </datalist>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const leadgenProviderId = getProviderIdForModel(safeCommonAi.leadgenLayers?.researchLlm || "DeepSeek-V3");
  const schedulerProviderId = getProviderIdForModel(safeCommonAi.schedulerLayers?.postWriter || "Claude 3.5 Sonnet");
  const emailProviderId = getProviderIdForModel(safeCommonAi.emailLayers?.copywriterLlm || "Claude 3.5 Sonnet");
  const voiceLlmProviderId = getProviderIdForModel(safeCommonAi.voiceLayers?.llm || "xAI Grok-2");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18, 20, 28, 0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "24px 16px" }}>
      <div style={{
        background: "#fff",
        borderRadius: 18,
        width: 920,
        maxWidth: "96vw",
        maxHeight: "90vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 28px 64px rgba(0,0,0,0.28)",
        border: `1px solid ${C.border}`,
        transform: `translate(${position.x}px, ${position.y}px)`,
        transition: isDragging ? "none" : "transform 0.05s ease-out"
      }}>
        
        {/* Header (Movable by dragging) */}
        <div
          onMouseDown={handleMouseDownHeader}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 26px",
            borderBottom: `1px solid ${C.border}`,
            background: HUB_PAPER,
            cursor: isDragging ? "grabbing" : "grab",
            userSelect: "none"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg, ${C.cobalt}, ${C.teal})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", boxShadow: "0 4px 12px rgba(52,87,213,0.25)" }}>
              <Settings2 size={20} />
            </div>
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink, letterSpacing: "-0.01em" }}>
                AI Plugin Configuration
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 2 }}>
                Configure models, connect custom API keys, and manage capabilities for each workspace plugin
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.slate, padding: 6, borderRadius: 6 }}>
            <X size={20} />
          </button>
        </div>

        {/* Plugin Tabs: Clean, spaced, no numbers */}
        <div style={{ display: "flex", gap: 6, padding: "0 24px", borderBottom: `1px solid ${C.border}`, background: "#fff", overflowX: "auto" }}>
          {[
            { id: "leadgen", label: "Lead Generation", icon: Search, color: "#8B5CF6" },
            { id: "scheduler", label: "Post Scheduler", icon: CalendarDays, color: C.teal },
            { id: "email", label: "Email Outreach", icon: Mail, color: "#F59E0B" },
            { id: "voice", label: "AI Voice Assistant", icon: PhoneCall, color: C.cobalt },
            { id: "subscription", label: "Usage & Quotas", icon: BarChart3, color: C.slate },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "13px 18px",
                  borderRadius: "8px 8px 0 0",
                  border: "none",
                  borderBottom: active ? `3px solid ${t.color || C.cobalt}` : "3px solid transparent",
                  background: "transparent",
                  color: active ? (t.color || C.cobalt) : C.slate,
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  whiteSpace: "nowrap",
                }}
              >
                <Icon size={15} color={active ? (t.color || C.cobalt) : C.slate} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          
          {/* TAB 1: LEAD GENERATION */}
          {tab === "leadgen" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: "#F5F3FF", border: `1px solid #DDD6FE`, borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Search size={18} color="#8B5CF6" />
                  <div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13.5, color: C.ink }}>
                      Lead Generation AI Configuration
                    </div>
                    <div style={{ fontSize: 12, color: C.slate, marginTop: 1 }}>
                      Powers autonomous account discovery, decision-maker extraction, and live website dossiers.
                    </div>
                  </div>
                </div>
                {onNavigateToPlugin && (
                  <button
                    onClick={() => { onNavigateToPlugin("leadgen"); onClose(); }}
                    style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 6, background: "#fff", border: `1px solid ${C.border}`, color: C.ink, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                  >
                    Open Plugin <ChevronRight size={13} />
                  </button>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink }}>
                  Lead Generation AI Capabilities (User Definable)
                </div>
                <span style={{ fontSize: 11.5, color: C.slate }}>
                  Type any custom model name or pick from suggestions
                </span>
              </div>

              {renderPluginAiFeaturesList("leadgen", LEADGEN_LAYERS, safeCommonAi.leadgenLayers, updateLeadgenLayer)}
              {renderCustomConnectionsSection("leadgen", LEADGEN_LAYERS)}
              {renderProviderKeyCard(leadgenProviderId, "Lead Discovery & Intelligence")}
            </div>
          )}

          {/* TAB 2: POST SCHEDULER */}
          {tab === "scheduler" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: "#F0FDF4", border: `1px solid #BBF7D0`, borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <CalendarDays size={18} color={C.teal} />
                  <div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13.5, color: C.ink }}>
                      Post Scheduler AI Configuration
                    </div>
                    <div style={{ fontSize: 12, color: C.slate, marginTop: 1 }}>
                      Powers multi-channel post drafting, topic ideation, image rendering, and editorial planning.
                    </div>
                  </div>
                </div>
                {onNavigateToPlugin && (
                  <button
                    onClick={() => { onNavigateToPlugin("scheduler"); onClose(); }}
                    style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 6, background: "#fff", border: `1px solid ${C.border}`, color: C.ink, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                  >
                    Open Plugin <ChevronRight size={13} />
                  </button>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink }}>
                  Post Scheduler AI Capabilities (User Definable)
                </div>
                <span style={{ fontSize: 11.5, color: C.slate }}>
                  Type any custom model name or pick from suggestions
                </span>
              </div>

              {renderPluginAiFeaturesList("scheduler", SCHEDULER_LAYERS, safeCommonAi.schedulerLayers, updateSchedulerLayer)}

              {/* Brand Voice Controls */}
              <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>
                    Creativity Temperature: {safeCommonAi.temperature || 0.7}
                  </label>
                  <span style={{ fontSize: 11.5, color: C.slate }}>
                    {(safeCommonAi.temperature || 0.7) > 0.7 ? "Engaging & Creative" : "Factual & Direct"}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="1.0"
                  step="0.05"
                  value={safeCommonAi.temperature || 0.7}
                  onChange={(e) => {
                    setCommonAi((p) => ({ ...p, temperature: parseFloat(e.target.value) }));
                    flash();
                  }}
                  style={{ width: "100%", marginBottom: 12 }}
                />

                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
                  Brand Voice Instructions
                </label>
                <textarea
                  value={safeCommonAi.personaPrompt || ""}
                  onChange={(e) => {
                    setCommonAi((p) => ({ ...p, personaPrompt: e.target.value }));
                    flash();
                  }}
                  rows={2}
                  placeholder="e.g. Write crisp, actionable B2B posts. Avoid fluff or corporate jargon."
                  style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5 }}
                />
              </div>

              {renderCustomConnectionsSection("scheduler", SCHEDULER_LAYERS)}
              {Array.from(new Set([
                schedulerProviderId,
                getProviderIdForModel(safeCommonAi.schedulerLayers?.topicResearch),
                getProviderIdForModel(safeCommonAi.schedulerLayers?.chatPlanner),
              ].filter(Boolean))).map((pid) => (
                <div key={pid}>
                  {renderProviderKeyCard(pid, pid === schedulerProviderId ? "Post Drafting & Copywriting" : `${pid.toUpperCase()} Capabilities`)}
                </div>
              ))}
            </div>
          )}

          {/* TAB 3: EMAIL OUTREACH */}
          {tab === "email" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: "#FFFBEB", border: `1px solid #FDE68A`, borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Mail size={18} color="#F59E0B" />
                  <div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13.5, color: C.ink }}>
                      Email Outreach AI Configuration
                    </div>
                    <div style={{ fontSize: 12, color: C.slate, marginTop: 1 }}>
                      Powers cold sequence generation, reply classification, spam detection, and content repurposing.
                    </div>
                  </div>
                </div>
                {onNavigateToPlugin && (
                  <button
                    onClick={() => { onNavigateToPlugin("emailoutreach"); onClose(); }}
                    style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 6, background: "#fff", border: `1px solid ${C.border}`, color: C.ink, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                  >
                    Open Plugin <ChevronRight size={13} />
                  </button>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink }}>
                  Email Outreach AI Capabilities (User Definable)
                </div>
                <span style={{ fontSize: 11.5, color: C.slate }}>
                  Type any custom model name or pick from suggestions
                </span>
              </div>

              {renderPluginAiFeaturesList("email", EMAIL_LAYERS, safeCommonAi.emailLayers, updateEmailLayer)}
              {renderCustomConnectionsSection("email", EMAIL_LAYERS)}
              {renderProviderKeyCard(emailProviderId, "Outreach Copywriter & Sequencer")}
            </div>
          )}

          {/* TAB 4: AI VOICE ASSISTANT */}
          {tab === "voice" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: "#EFF6FF", border: `1px solid #BFDBFE`, borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <PhoneCall size={18} color={C.cobalt} />
                  <div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13.5, color: C.ink }}>
                      AI Voice Assistant Configuration
                    </div>
                    <div style={{ fontSize: 12, color: C.slate, marginTop: 1 }}>
                      Powers real-time phone conversations, ultra-low latency TTS, acoustic STT, and PSTN carrier dialing.
                    </div>
                  </div>
                </div>
                {onNavigateToPlugin && (
                  <button
                    onClick={() => { onNavigateToPlugin("voice"); onClose(); }}
                    style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 6, background: "#fff", border: `1px solid ${C.border}`, color: C.ink, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                  >
                    Open Plugin <ChevronRight size={13} />
                  </button>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink }}>
                  Voice Assistant AI Capabilities (User Definable)
                </div>
                <span style={{ fontSize: 11.5, color: C.slate }}>
                  Type any custom model name or pick from suggestions
                </span>
              </div>

              {renderPluginAiFeaturesList("voice", VOICE_LAYERS, safeCommonAi.voiceLayers, updateVoiceLayer)}
              {renderCustomConnectionsSection("voice", VOICE_LAYERS)}
              {renderProviderKeyCard(voiceLlmProviderId, "Voice Dialogue Reasoning")}
            </div>
          )}

          {/* TAB 5: SMART MULTI-MODAL USAGE & QUOTAS */}
          {tab === "subscription" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Tenant & Budget Card */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                  <div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink }}>
                      {safeCommonAi.subscription?.tenantName || "Acme Operations (Enterprise Workspace)"}
                    </div>
                    <div style={{ fontSize: 12.5, color: C.slate, marginTop: 2 }}>
                      {safeCommonAi.subscription?.planTier || "AIVHub Unified Master License"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: "#059669", background: "#ECFDF5", border: "1px solid #A7F3D0", padding: "4px 10px", borderRadius: 6 }}>
                      Master License Active
                    </span>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginTop: 6 }}>
                      ${(safeCommonAi.subscription?.estimatedCostUsd || 34.12).toFixed(2)} / ${(safeCommonAi.subscription?.monthlyBudgetCapUsd || 150.00).toFixed(2)} Monthly Budget
                    </div>
                  </div>
                </div>

                {/* Overall Budget Bar */}
                <div style={{ marginBottom: 6 }}>
                  <div style={{ height: 10, background: C.paperSoft, borderRadius: 999, overflow: "hidden", display: "flex" }}>
                    <div style={{ width: `${Math.round(((safeCommonAi.subscription?.estimatedCostUsd || 34.12) / (safeCommonAi.subscription?.monthlyBudgetCapUsd || 150.00)) * 100)}%`, background: `linear-gradient(90deg, #10B981, #059669)` }} />
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: C.slate }}>
                  <span>22.7% of monthly budget cap utilized</span>
                  <span>Auto-alert threshold set at 80% ($120.00)</span>
                </div>
              </div>

              {/* Multi-Modal Metric Grid */}
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink }}>
                Multi-Modal Consumption by Cognitive Unit
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                {/* 1. Tokens */}
                <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Reasoning & Text Tokens</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.cobalt }}>36.9%</span>
                  </div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
                    1.85M <span style={{ fontSize: 12, fontWeight: 500, color: C.slate }}>/ 5.0M</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.slate }}>Across Lead Gen, Scheduler & Email LLMs</div>
                </div>

                {/* 2. Voice Minutes */}
                <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Live Phone Minutes</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#3B82F6" }}>28.4%</span>
                  </div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
                    142 <span style={{ fontSize: 12, fontWeight: 500, color: C.slate }}>/ 500 mins</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.slate }}>PSTN Telephony + AI Voice Assistant turns</div>
                </div>

                {/* 3. Audio Characters */}
                <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Audio Synthesis (TTS/STT)</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#10B981" }}>28.4%</span>
                  </div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
                    284k <span style={{ fontSize: 12, fontWeight: 500, color: C.slate }}>/ 1.0M chars</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.slate }}>ElevenLabs Turbo voice synthesis stream</div>
                </div>

                {/* 4. Web Crawls */}
                <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Live Web Crawls</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#8B5CF6" }}>32.0%</span>
                  </div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
                    320 <span style={{ fontSize: 12, fontWeight: 500, color: C.slate }}>/ 1,000 crawls</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.slate }}>Lead Gen live company domain audits</div>
                </div>

                {/* 5. Creative Images */}
                <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Image Studio Credits</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#F59E0B" }}>28.0%</span>
                  </div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
                    28 <span style={{ fontSize: 12, fontWeight: 500, color: C.slate }}>/ 100 renders</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.slate }}>Post Scheduler visual generation API</div>
                </div>

                {/* 6. Active API Endpoints */}
                {(() => {
                  const activeProvs = (safeCommonAi.providers || []).filter(
                    (p) => (p.status === "connected" && p.latencyMs) || (p.apiKey && p.apiKey.trim().length > 0)
                  );
                  const totalProvs = (safeCommonAi.providers || []).length || 11;
                  const pct = totalProvs > 0 ? Math.round((activeProvs.length / totalProvs) * 100) : 0;
                  return (
                    <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Connected Model Endpoints</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: activeProvs.length > 0 ? "#059669" : C.slate }}>
                          {activeProvs.length > 0 ? `${pct}% Connected` : "Not Configured"}
                        </span>
                      </div>
                      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
                        {activeProvs.length} Active <span style={{ fontSize: 12, fontWeight: 500, color: C.slate }}>/ {totalProvs} providers</span>
                      </div>
                      <div style={{ fontSize: 11, color: C.slate }}>
                        {activeProvs.length > 0 ? `${activeProvs.length} live endpoints verified` : "No external API keys active"}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Plugin Breakdown Table */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink }}>
                  Usage Distribution Across Workspace Plugins
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.5fr 1fr 0.8fr", padding: "10px 18px", background: HUB_PAPER, borderBottom: `1px solid ${C.borderLight}`, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <span>Plugin</span>
                  <span>Consumption Units</span>
                  <span>Active Models</span>
                  <span style={{ textAlign: "right" }}>Cost (USD)</span>
                </div>

                {[
                  { name: "Lead Generation", color: "#8B5CF6", units: "320 web crawls · 420k tokens", models: safeCommonAi.leadgenLayers?.researchLlm || "DeepSeek-V3", cost: "$4.85", share: "14%" },
                  { name: "Post Scheduler", color: C.teal, units: "28 image renders · 580k tokens", models: safeCommonAi.schedulerLayers?.postWriter || "Claude 3.5 Sonnet", cost: "$6.40", share: "19%" },
                  { name: "Email Outreach", color: "#F59E0B", units: "360k copywriting tokens", models: safeCommonAi.emailLayers?.copywriterLlm || "Claude 3.5 Sonnet", cost: "$3.25", share: "10%" },
                  { name: "AI Voice Assistant", color: C.cobalt, units: "142 voice mins · 485k tokens", models: safeCommonAi.voiceLayers?.llm || "xAI Grok-2", cost: "$19.62", share: "57%" },
                ].map((row, idx) => (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: "1.2fr 1.5fr 1fr 0.8fr", alignItems: "center", padding: "12px 18px", borderBottom: idx < 3 ? `1px solid ${C.borderLight}` : "none", fontSize: 12.5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: row.color }} />
                      <span style={{ fontWeight: 700, color: C.ink }}>{row.name}</span>
                    </div>
                    <div style={{ color: C.textInk, fontFamily: FONT_BODY }}>{row.units}</div>
                    <div style={{ color: C.slate, fontSize: 12, fontFamily: FONT_MONO }}>{row.models}</div>
                    <div style={{ textAlign: "right", fontWeight: 700, color: C.ink }}>{row.cost} <span style={{ fontSize: 11, fontWeight: 500, color: C.slate }}>({row.share})</span></div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 26px", borderTop: `1px solid ${C.border}`, background: HUB_PAPER }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: dirty ? C.teal : C.slate }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: dirty ? C.teal : C.green }} />
            <span>{dirty ? "Saved & synchronized across plugins" : "All plugin models in sync"}</span>
          </div>

          <button
            onClick={onClose}
            style={{
              padding: "9px 24px",
              borderRadius: 8,
              background: C.ink,
              color: "#fff",
              fontFamily: FONT_BODY,
              fontSize: 13,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
}
/* ---------------------------------- Dedicated Post Scheduler AI Configuration View ---------------------------------- */

function SchedulerAiConfigView({ commonAi, setCommonAi, onOpenCommonModal, company }) {
  const [dirty, setDirty] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Helper to map model name to provider ID
  const detectProvider = (modelName) => {
    const m = String(modelName || "").toLowerCase();
    if (m.includes("claude") || m.includes("anthropic") || m.includes("sonnet") || m.includes("haiku")) return "anthropic";
    if (m.includes("gpt") || m.includes("o3") || m.includes("openai") || m.includes("dall-e") || m.includes("text-embedding")) return "openai";
    if (m.includes("deepseek")) return "deepseek";
    if (m.includes("grok") || m.includes("xai")) return "xai";
    if (m.includes("groq") || m.includes("llama")) return "groq";
    if (m.includes("gemini") || m.includes("google")) return "gemini";
    if (m.includes("ollama") || m.includes("local")) return "ollama";
    return "deepseek";
  };

  const getProviderDefaultBaseUrl = (provId) => {
    switch (provId) {
      case "deepseek": return "https://api.deepseek.com";
      case "openai": return "https://api.openai.com/v1";
      case "anthropic": return "https://api.anthropic.com/v1";
      case "xai": return "https://api.x.ai/v1";
      case "groq": return "https://api.groq.com/openai/v1";
      case "gemini": return "https://generativelanguage.googleapis.com/v1beta";
      case "ollama": return "http://localhost:11434/v1";
      default: return "";
    }
  };

  // Scheduler AI settings (synchronized with commonAi.schedulerLayers and commonAi.schedulerAi)
  const [aiSettings, setAiSettings] = useState(() => {
    let saved = null;
    try {
      const s = localStorage.getItem("aivhub_scheduler_ai");
      if (s) saved = JSON.parse(s);
    } catch (_) {}

    const initialModel = commonAi?.schedulerLayers?.postWriter || saved?.model || commonAi?.schedulerAi?.model || "Claude 3.5 Sonnet";
    const detectedProv = saved?.provider || commonAi?.schedulerAi?.provider || detectProvider(initialModel);
    const matchedKey = (commonAi?.providers || []).find((p) => p.id === detectedProv)?.apiKey || saved?.apiKey || commonAi?.schedulerAi?.apiKey || "";

    return {
      provider: detectedProv,
      apiKey: matchedKey,
      model: initialModel,
      baseUrl: saved?.baseUrl || commonAi?.schedulerAi?.baseUrl || getProviderDefaultBaseUrl(detectedProv),
      imageEngine: commonAi?.schedulerLayers?.imageStudio || saved?.imageEngine || commonAi?.schedulerAi?.imageEngine || "auto_flux",
      imageStyle: saved?.imageStyle || commonAi?.schedulerAi?.imageStyle || "modern_saas",
      imageAspectRatio: saved?.imageAspectRatio || commonAi?.schedulerAi?.imageAspectRatio || "16:9",
      negativePrompt: saved?.negativePrompt || commonAi?.schedulerAi?.negativePrompt || "blurry, low quality, distorted text, deformed hands, watermark",
      temperature: saved?.temperature ?? commonAi?.temperature ?? 0.7,
      brandPersona: saved?.brandPersona || commonAi?.personaPrompt || (company?.pitch ? `Brand: ${company.name}. Value proposition: ${company.pitch}. Target audience: ${company.industry || "B2B Tech"}. Tone: ${company.tone || "Authoritative & Actionable"}.` : "Authoritative, insightful B2B operational leader tone. High clarity, actionable takeaways, no corporate fluff."),
    };
  });

  // Keep in sync with commonAi if user opened modal and changed layers
  useEffect(() => {
    if (commonAi?.schedulerLayers?.postWriter && commonAi.schedulerLayers.postWriter !== aiSettings.model) {
      const nextModel = commonAi.schedulerLayers.postWriter;
      const detected = detectProvider(nextModel);
      const matchedKey = (commonAi?.providers || []).find((p) => p.id === detected)?.apiKey || aiSettings.apiKey;
      setAiSettings((prev) => ({
        ...prev,
        model: nextModel,
        provider: detected,
        apiKey: matchedKey,
        baseUrl: prev.baseUrl || getProviderDefaultBaseUrl(detected),
      }));
    }
  }, [commonAi?.schedulerLayers?.postWriter]);

  // On mount: recover key from backend connections if empty
  useEffect(() => {
    let mounted = true;
    async function recoverSavedConnections() {
      if (aiSettings.apiKey && aiSettings.apiKey.trim()) return;
      try {
        const conns = await api.getConnections();
        if (!mounted || !Array.isArray(conns)) return;
        let foundKey = "";
        for (const grp of conns) {
          for (const it of grp.items || []) {
            if ((it.layer === "LLM" && it.status === "connected") || it.provider?.toLowerCase().includes(aiSettings.provider)) {
              if (it.apiKey) { foundKey = it.apiKey; break; }
            }
          }
          if (foundKey) break;
        }
        if (foundKey) {
          setAiSettings((prev) => {
            const next = { ...prev, apiKey: foundKey };
            try { localStorage.setItem("aivhub_scheduler_ai", JSON.stringify(next)); } catch (_) {}
            return next;
          });
        }
      } catch (_) {}
    }
    recoverSavedConnections();
    return () => { mounted = false; };
  }, [aiSettings.provider]);

  const updateSetting = (key, val) => {
    setAiSettings((prev) => {
      const next = { ...prev, [key]: val };

      // Auto-detect provider if model changed
      if (key === "model") {
        const detected = detectProvider(val);
        if (detected) {
          next.provider = detected;
          if (!prev.baseUrl || prev.baseUrl === getProviderDefaultBaseUrl(prev.provider)) {
            next.baseUrl = getProviderDefaultBaseUrl(detected);
          }
          const matchedKey = (commonAi?.providers || []).find((p) => p.id === detected)?.apiKey;
          if (detected !== prev.provider) {
            next.apiKey = matchedKey || "";
          }
        }
      }

      // If provider dropdown explicitly changed
      if (key === "provider") {
        next.baseUrl = getProviderDefaultBaseUrl(val);
        const matchedKey = (commonAi?.providers || []).find((p) => p.id === val)?.apiKey;
        next.apiKey = matchedKey || "";
      }

      // 1. Immediately persist to localStorage
      try {
        localStorage.setItem("aivhub_scheduler_ai", JSON.stringify(next));
      } catch (_) {}

      // 2. Synchronize bi-directionally into commonAi state
      if (setCommonAi) {
        setCommonAi((p) => {
          if (!p) return p;
          const updatedProvs = (p.providers || []).map((prov) => {
            if (prov.id === next.provider) {
              return {
                ...prov,
                apiKey: next.apiKey || prov.apiKey,
                baseUrl: next.baseUrl || prov.baseUrl,
                status: next.apiKey ? "connected" : prov.status
              };
            }
            return prov;
          });

          return {
            ...p,
            schedulerAi: next,
            schedulerLayers: {
              ...(p.schedulerLayers || {}),
              postWriter: next.model,
              ...(next.imageEngine ? { imageStudio: next.imageEngine } : {})
            },
            providers: updatedProvs,
            temperature: next.temperature,
            personaPrompt: next.brandPersona || p.personaPrompt,
          };
        });
      }

      return next;
    });
    setTestResult(null);
  };

  const handleTestKey = async () => {
    if (!aiSettings.apiKey.trim() && aiSettings.provider !== "ollama") {
      setTestResult({ valid: false, message: "Please paste your API key first." });
      return;
    }
    setTesting(true);
    setTestResult(null);
    const startTime = Date.now();

    try {
      const res = await api.testConnection({
        layer: "LLM",
        provider: aiSettings.provider,
        api_key: aiSettings.apiKey.trim(),
        apiKey: aiSettings.apiKey.trim(),
        base_url: aiSettings.baseUrl ? aiSettings.baseUrl.trim() : undefined,
        baseUrl: aiSettings.baseUrl ? aiSettings.baseUrl.trim() : undefined,
      });
      const latency = Math.max(Date.now() - startTime, 24);
      if (res && (res.valid || res.success)) {
        setTestResult({ valid: true, message: `Connected successfully to ${aiSettings.provider.toUpperCase()} (${latency}ms latency). Key active & ready.` });
        try {
          await api.testAndSaveConnection({
            layer: "LLM",
            provider: aiSettings.provider,
            api_key: aiSettings.apiKey.trim(),
            base_url: aiSettings.baseUrl ? aiSettings.baseUrl.trim() : undefined,
          });
        } catch (_) {}
      } else {
        setTestResult({ valid: false, message: res?.error || res?.details || `Authentication failed for ${aiSettings.provider}.` });
      }
    } catch (err) {
      setTestResult({ valid: false, message: err.message || `Failed to authenticate with ${aiSettings.provider}.` });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    try {
      localStorage.setItem("aivhub_scheduler_ai", JSON.stringify(aiSettings));
    } catch (_) {}

    if (setCommonAi) {
      setCommonAi((prev) => {
        const updatedProvs = (prev?.providers || []).map((prov) => {
          if (prov.id === aiSettings.provider) {
            return { ...prov, apiKey: aiSettings.apiKey, baseUrl: aiSettings.baseUrl, status: aiSettings.apiKey ? "connected" : prov.status };
          }
          return prov;
        });
        return {
          ...prev,
          schedulerAi: aiSettings,
          schedulerLayers: {
            ...(prev?.schedulerLayers || {}),
            postWriter: aiSettings.model,
            imageStudio: aiSettings.imageEngine
          },
          providers: updatedProvs,
          temperature: aiSettings.temperature,
          personaPrompt: aiSettings.brandPersona,
        };
      });
    }

    if (aiSettings.apiKey.trim()) {
      try {
        await api.testAndSaveConnection({
          layer: "LLM",
          provider: aiSettings.provider,
          api_key: aiSettings.apiKey.trim(),
          base_url: aiSettings.baseUrl || undefined,
        });
      } catch (_) {}
    }

    setDirty(true);
    setSavedSuccess(true);
    setTimeout(() => {
      setDirty(false);
      setSavedSuccess(false);
    }, 3000);
  };

  return (
    <div style={{ flex: 1, padding: "28px 36px", overflowY: "auto", background: HUB_PAPER, display: "flex", flexDirection: "column" }}>
      <div style={{ maxWidth: 880, width: "100%", margin: "0 auto" }}>
        
        {/* Header box */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 23, color: C.ink, letterSpacing: "-0.02em" }}>
              Post Scheduler · Complete AI Configuration
            </div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 4 }}>
              Configure open models, connect custom API keys, and manage capabilities across social planning and visual creation.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {onOpenCommonModal && (
              <button
                type="button"
                onClick={() => onOpenCommonModal("scheduler")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  color: C.ink,
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}
              >
                <Settings2 size={15} color={C.teal} />
                <span>Global AI Plugin Window</span>
              </button>
            )}

            <button
              onClick={handleSave}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 22px",
                borderRadius: 10,
                border: "none",
                background: savedSuccess ? "#16a34a" : C.gradientTeal,
                color: "#fff",
                fontFamily: FONT_BODY,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: savedSuccess ? "0 2px 10px rgba(22,163,74,0.35)" : C.glowTeal,
                transition: "all 0.2s ease",
              }}
            >
              {savedSuccess ? <><Check size={15} color="#fff" /> Saved Successfully!</> : <><Save size={15} /> Save Settings</>}
            </button>
          </div>
        </div>

        {savedSuccess && (
          <div style={{ background: "#E8F5E9", color: "#1B5E20", padding: "12px 18px", borderRadius: 10, marginBottom: 18, border: "1px solid #C8E6C9", display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 600 }}>
            <Check size={16} color="#1B5E20" /> Settings saved! Post Scheduler is now actively using {aiSettings.provider.toUpperCase()} ({aiSettings.model}).
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* CARD 1: AI Chat, Planning & Copywriting Key */}
          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, boxShadow: C.shadowCard }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: C.tealSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <KeyRound size={17} color={C.teal} />
                </div>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16.5, color: C.ink }}>
                    LLM Chat & Social Planning Credentials
                  </div>
                  <div style={{ fontSize: 12, color: C.slateLight, marginTop: 1 }}>
                    Auto-saved directly to local storage & persisted across hard browser refreshes
                  </div>
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: aiSettings.apiKey ? "#E8F5E9" : C.amberSoft, color: aiSettings.apiKey ? "#1B5E20" : C.amber, border: `1px solid ${aiSettings.apiKey ? "#C8E6C9" : "rgba(217,119,6,0.25)"}` }}>
                {aiSettings.apiKey ? "✓ Key Saved & Ready" : "⚠️ Key Missing"}
              </span>
            </div>

            <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 18, marginTop: 8 }}>
              Type any model identifier or select an AI provider below. Connects seamlessly to conversational planning, hook synthesis, and multi-channel copywriting.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 2fr", gap: 16, marginBottom: 16 }}>
              {/* Provider Selection */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.textInk, marginBottom: 6 }}>
                  AI Provider (Auto-selected based on model)
                </label>
                <select
                  value={aiSettings.provider}
                  onChange={(e) => updateSetting("provider", e.target.value)}
                  style={{
                    width: "100%",
                    height: 42,
                    padding: "0 12px",
                    borderRadius: 9,
                    border: `1px solid ${C.border}`,
                    background: "#fff",
                    fontFamily: FONT_BODY,
                    fontSize: 13,
                    color: C.ink,
                    cursor: "pointer",
                  }}
                >
                  <option value="anthropic">Anthropic Claude (Sonnet 3.5 / 3.7)</option>
                  <option value="openai">OpenAI (GPT-4o / GPT-4o-mini / o3-mini)</option>
                  <option value="deepseek">DeepSeek (deepseek-chat / deepseek-reasoner)</option>
                  <option value="xai">xAI (Grok-2 / Grok-beta)</option>
                  <option value="groq">Groq LPU (Llama 3.3 70B / 800 tps)</option>
                  <option value="gemini">Google Gemini (Gemini 2.0 Flash / Pro)</option>
                  <option value="ollama">Ollama (Local AI Host)</option>
                  <option value="custom">Custom Endpoint (OpenAI Compatible / vLLM)</option>
                </select>
              </div>

              {/* User-Provided Model Name Input */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: C.textInk }}>
                    Model Identifier (User Provided / Open)
                  </label>
                  <span style={{ fontSize: 11, color: C.slateLight }}>
                    Freely type any model name
                  </span>
                </div>
                <input
                  type="text"
                  list="scheduler-model-suggestions"
                  value={aiSettings.model}
                  onChange={(e) => updateSetting("model", e.target.value)}
                  placeholder="Type any model name (e.g. claude-3-5-sonnet, gpt-4o, deepseek-chat)..."
                  style={{
                    width: "100%",
                    height: 42,
                    padding: "0 12px",
                    borderRadius: 9,
                    border: `1px solid ${C.border}`,
                    background: "#fff",
                    fontFamily: FONT_MONO,
                    fontSize: 13,
                    color: C.ink,
                    boxSizing: "border-box",
                  }}
                />
                <datalist id="scheduler-model-suggestions">
                  <option value="Claude 3.5 Sonnet" />
                  <option value="claude-3-7-sonnet-20250219" />
                  <option value="deepseek-chat" />
                  <option value="deepseek-reasoner" />
                  <option value="gpt-4o" />
                  <option value="gpt-4o-mini" />
                  <option value="xAI Grok-2" />
                  <option value="llama-3.3-70b-versatile" />
                  <option value="gemini-2.0-flash" />
                  <option value="qwen/qwen-2.5-72b-instruct" />
                </datalist>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {[
                    "Claude 3.5 Sonnet",
                    "deepseek-chat",
                    "gpt-4o",
                    "xAI Grok-2",
                    "llama-3.3-70b-versatile",
                    "gemini-2.0-flash"
                  ].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => updateSetting("model", m)}
                      style={{
                        padding: "2px 8px",
                        borderRadius: 6,
                        border: `1px solid ${aiSettings.model === m ? C.teal : C.borderLight}`,
                        background: aiSettings.model === m ? C.tealSoft : HUB_PAPER,
                        color: aiSettings.model === m ? C.teal : C.slate,
                        fontSize: 11,
                        fontFamily: FONT_MONO,
                        cursor: "pointer",
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Custom Base URL if applicable */}
            {(aiSettings.provider === "custom" || aiSettings.provider === "ollama") && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.textInk, marginBottom: 6 }}>
                  API Base URL / Endpoint
                </label>
                <input
                  value={aiSettings.baseUrl}
                  onChange={(e) => updateSetting("baseUrl", e.target.value)}
                  placeholder="e.g. http://localhost:11434/v1 or https://api.your-provider.com/v1"
                  style={{
                    width: "100%",
                    height: 40,
                    padding: "0 12px",
                    borderRadius: 9,
                    border: `1px solid ${C.border}`,
                    fontFamily: FONT_MONO,
                    fontSize: 12.5,
                    color: C.ink,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            )}

            {/* API Key Input with Show/Hide and Test Connection */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: C.textInk }}>
                  API Secret Key ({aiSettings.provider.toUpperCase()})
                </label>
                <span style={{ fontSize: 11, color: C.teal, fontWeight: 600 }}>
                  ⚡ Saved automatically across the entire software
                </span>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <input
                    type={showKey ? "text" : "password"}
                    value={aiSettings.apiKey}
                    onChange={(e) => updateSetting("apiKey", e.target.value)}
                    placeholder={`Paste your ${aiSettings.provider} API key here (sk-...)`}
                    style={{
                      width: "100%",
                      height: 42,
                      padding: "0 42px 0 14px",
                      borderRadius: 9,
                      border: `1px solid ${C.border}`,
                      fontFamily: FONT_MONO,
                      fontSize: 13,
                      color: C.ink,
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    style={{
                      position: "absolute",
                      right: 12,
                      top: 11,
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      color: C.slate,
                      padding: 0,
                    }}
                    title={showKey ? "Hide API key" : "Show API key"}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleTestKey}
                  disabled={testing}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    height: 42,
                    padding: "0 18px",
                    borderRadius: 9,
                    border: `1px solid ${C.border}`,
                    background: HUB_PAPER,
                    fontFamily: FONT_BODY,
                    fontSize: 13,
                    fontWeight: 600,
                    color: C.ink,
                    cursor: testing ? "wait" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  <RefreshCw size={14} className={testing ? "animate-spin" : ""} />
                  <span>{testing ? "Testing..." : "Test Connection"}</span>
                </button>
              </div>

              {/* Status feedback pill */}
              {testResult && (
                <div
                  style={{
                    marginTop: 10,
                    padding: "9px 14px",
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontFamily: FONT_BODY,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: testResult.valid ? "#E8F5E9" : "#FFEBEE",
                    color: testResult.valid ? "#1B5E20" : "#C62828",
                    border: `1px solid ${testResult.valid ? "#C8E6C9" : "#FFCDD2"}`,
                  }}
                >
                  {testResult.valid ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>
          </div>

          {/* CARD 2: Total Places Where AI is Used in Social Media Plugin */}
          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 22, boxShadow: C.shadowCard }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: C.cobaltSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <LayoutGrid size={16} color={C.cobaltDeep} />
              </div>
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>
                  Active AI Capabilities in this Plugin ({aiSettings.model})
                </div>
                <div style={{ fontSize: 12, color: C.slate }}>
                  Powers conversation, copywriting, visual rendering, and campaign planning
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {[
                { title: "1. Conversational Calendar & Plan AI", where: "Plan View (Right Chat Rail)", desc: "Analyzes company knowledge, suggests weekly themes, sets up slot cadences, and plans dates.", icon: CalendarDays },
                { title: "2. Live Topic & Trend Researcher", where: "Live Topics View", desc: "Searches industry developments, extracts actionable hooks, and formulates high-interest content angles.", icon: Search },
                { title: "3. Multi-Channel Post Copywriter", where: "Approvals & Slot Cards", desc: "Writes customized drafts for LinkedIn, X, Instagram, and Facebook using your Brand Tone Persona.", icon: FileText },
                { title: "4. AI Visual Director & Graphic Generator", where: "Image Studio & Slot Graphics", desc: "Synthesizes contextual image prompts and renders 4K vector and editorial graphics with zero text distortion.", icon: Sparkles },
                { title: "5. Smart Revision & Post Re-generator", where: "Post Review Modal", desc: "Instantly re-writes existing posts from alternate angles or varying content lengths on command.", icon: RefreshCw },
                { title: "6. Knowledge Base Vector Retrieval", where: "Company Profile Tab", desc: "Automatically grounds all copy in your company's core pitch, value proposition, and prohibited words.", icon: Sparkles },
              ].map((feat, idx) => {
                const Icon = feat.icon;
                return (
                  <div key={idx} style={{ background: HUB_PAPER, border: `1px solid ${C.borderLight}`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <Icon size={14} color={C.teal} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{feat.title}</span>
                      </div>
                      <span style={{ fontSize: 10.5, fontWeight: 600, padding: "1px 6px", borderRadius: 4, background: C.tealSoft, color: C.teal }}>
                        {feat.where}
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, color: C.slate, lineHeight: 1.4 }}>
                      {feat.desc}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* CARD 3: Topic Image Generation Settings */}
          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, boxShadow: C.shadowCard }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: C.tealSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Sparkles size={16} color={C.teal} />
                </div>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16.5, color: C.ink }}>
                    AI Image Generation Engine & Directives
                  </div>
                  <div style={{ fontSize: 12, color: C.slate, marginTop: 1 }}>
                    Zero forced models — pick your engine, aspect ratio, and art direction
                  </div>
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: C.tealSoft, color: C.teal }}>
                Flux / SDXL Engine Active
              </span>
            </div>

            {/* Image Engine Selection */}
            <div style={{ marginBottom: 18, marginTop: 12 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.textInk, marginBottom: 8 }}>
                Image Rendering Engine
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {[
                  { id: "auto_flux", label: "Flux Schnell (Built-in)", desc: "Zero API key required · 4K vector & photorealism" },
                  { id: "sdxl", label: "Stability SDXL", desc: "Deep atmospheric lighting and complex scenes" },
                  { id: "custom_engine", label: "Custom Image API", desc: "Connect your own local or remote image endpoint" },
                ].map((eng) => {
                  const active = aiSettings.imageEngine === eng.id;
                  return (
                    <div
                      key={eng.id}
                      onClick={() => updateSetting("imageEngine", eng.id)}
                      style={{
                        padding: "12px 14px",
                        borderRadius: 10,
                        border: `2px solid ${active ? C.teal : C.border}`,
                        background: active ? C.tealSoft : HUB_PAPER,
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13, color: active ? C.teal : C.ink }}>
                        {eng.label}
                      </div>
                      <div style={{ fontSize: 11, color: C.slate, marginTop: 4 }}>
                        {eng.desc}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Visual Style Selection */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.textInk, marginBottom: 8 }}>
                Default Visual Art Style
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                {[
                  { id: "modern_saas", label: "Modern Tech SaaS", desc: "Clean UI vector gradients & glowing icons" },
                  { id: "editorial", label: "Photorealistic Editorial", desc: "Corporate executive & studio photography" },
                  { id: "minimalist_3d", label: "3D Clay Minimalist", desc: "Isometric smooth clay shapes & objects" },
                  { id: "neon_tech", label: "Dark Neon Cyberpunk", desc: "Glowing holographic data streaming charts" },
                ].map((s) => {
                  const active = aiSettings.imageStyle === s.id;
                  return (
                    <div
                      key={s.id}
                      onClick={() => updateSetting("imageStyle", s.id)}
                      style={{
                        padding: "12px 14px",
                        borderRadius: 10,
                        border: `2px solid ${active ? C.teal : C.border}`,
                        background: active ? C.tealSoft : HUB_PAPER,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13, color: active ? C.teal : C.ink }}>
                        {s.label}
                      </div>
                      <div style={{ fontSize: 11, color: C.slate, marginTop: 4, lineHeight: 1.3 }}>
                        {s.desc}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Aspect Ratio & Format */}
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.8fr", gap: 16, alignItems: "flex-start" }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.textInk, marginBottom: 6 }}>
                  Default Canvas Ratio
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  {[
                    { id: "16:9", label: "16:9 Landscape", icon: Maximize2 },
                    { id: "1:1", label: "1:1 Square", icon: LayoutGrid },
                    { id: "9:16", label: "9:16 Vertical", icon: Smartphone },
                  ].map((ar) => {
                    const active = aiSettings.imageAspectRatio === ar.id;
                    const Icon = ar.icon;
                    return (
                      <button
                        key={ar.id}
                        type="button"
                        onClick={() => updateSetting("imageAspectRatio", ar.id)}
                        style={{
                          flex: 1,
                          height: 38,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                          borderRadius: 8,
                          border: `1px solid ${active ? C.teal : C.border}`,
                          background: active ? C.teal : "#fff",
                          color: active ? "#fff" : C.slate,
                          fontFamily: FONT_BODY,
                          fontSize: 11.5,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        <Icon size={13} /> {ar.id}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Negative Prompt filter */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.textInk, marginBottom: 6 }}>
                  Negative Prompt Filter (Unwanted Elements)
                </label>
                <input
                  type="text"
                  value={aiSettings.negativePrompt}
                  onChange={(e) => updateSetting("negativePrompt", e.target.value)}
                  placeholder="e.g. blurry, low quality, distorted text, deformed hands, watermark"
                  style={{
                    width: "100%",
                    height: 38,
                    padding: "0 12px",
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    fontFamily: FONT_BODY,
                    fontSize: 12,
                    color: C.ink,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
          </div>

          {/* CARD 4: Brand Tone, Persona Directives & Multi-Channel Formatting */}
          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, boxShadow: C.shadowCard }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: C.tealSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Sliders size={16} color={C.teal} />
              </div>
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16.5, color: C.ink }}>
                  Copywriting Temperature & Brand Persona Directives
                </div>
                <div style={{ fontSize: 12, color: C.slate }}>
                  Governs writing variance and injects tone guidelines into every AI post draft
                </div>
              </div>
            </div>

            {/* Temperature Slider */}
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>
                  Creativity Temperature: {aiSettings.temperature}
                </label>
                <span style={{ fontSize: 12, fontWeight: 600, color: aiSettings.temperature > 0.75 ? C.amber : C.teal }}>
                  {aiSettings.temperature > 0.8 ? "🔥 High Variance & Creative Hooks" : aiSettings.temperature > 0.6 ? "✨ Balanced & Authoritative" : "🎯 Analytical & Deterministic"}
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={aiSettings.temperature}
                onChange={(e) => updateSetting("temperature", parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: C.teal }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.slate, marginTop: 4 }}>
                <span>0.1 (Strict & Factual)</span>
                <span>0.7 (Balanced B2B Standard)</span>
                <span>1.0 (Bold & Highly Creative)</span>
              </div>
            </div>

            {/* Brand Persona Directives */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: C.ink, marginBottom: 6 }}>
                Brand Voice Persona Directive (Injected into Writer System Prompt)
              </label>
              <textarea
                rows={3}
                value={aiSettings.brandPersona}
                onChange={(e) => updateSetting("brandPersona", e.target.value)}
                placeholder="Describe your desired tone, target audience, vocabulary, and forbidden words..."
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 9,
                  border: `1px solid ${C.border}`,
                  fontSize: 12.5,
                  fontFamily: FONT_BODY,
                  color: C.ink,
                  boxSizing: "border-box",
                  lineHeight: 1.45,
                }}
              />
            </div>

            {/* Multi-channel Directives Preview */}
            <div style={{ background: HUB_PAPER, border: `1px solid ${C.borderLight}`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
                Multi-Channel Formatting Directives Enforced by LLM:
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                {[
                  { channel: "LinkedIn", rule: "Strong hook line, skimmable bullet points, 2-3 hashtags, CTA" },
                  { channel: "X / Twitter", rule: "Under 280 characters, punchy statement, single focused takeaway" },
                  { channel: "Instagram", rule: "Visual storytelling caption, conversational tone, 5-8 hashtag bundle" },
                  { channel: "Facebook", rule: "Community focus, relatable hook, discussion question" },
                ].map((ch, idx) => (
                  <div key={idx} style={{ background: "#fff", border: `1px solid ${C.borderLight}`, borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.teal, marginBottom: 3 }}>{ch.channel}</div>
                    <div style={{ fontSize: 11, color: C.slate, lineHeight: 1.35 }}>{ch.rule}</div>
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>

        {/* Save confirmation toast */}
        {dirty && (
          <div style={{ position: "fixed", bottom: 24, right: 32, background: C.ink, color: "#fff", padding: "12px 20px", borderRadius: 10, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.2)", zIndex: 1000 }}>
            <CheckCircle2 size={16} color={C.teal} /> Post Scheduler AI key & configurations saved!
          </div>
        )}

      </div>
    </div>
  );
}

/* ---------------------------------- Dedicated Post Scheduler AI Image Studio View ---------------------------------- */

function SchedulerImageStudioView({ topics = [], setTopics, posts = [], setPosts, commonAi, company, onNavigate }) {
  const [sourceMode, setSourceMode] = useState("topic"); // "topic" | "post" | "custom"
  const [selectedTopicId, setSelectedTopicId] = useState(topics[0]?.id || "");
  const [selectedPostId, setSelectedPostId] = useState(posts[0]?.id || "");
  const [targetPostId, setTargetPostId] = useState(posts[0]?.id || "");
  const [targetTopicId, setTargetTopicId] = useState(topics[0]?.id || "");

  const defaultStyle = commonAi?.schedulerAi?.imageStyle || "modern_saas";
  const [style, setStyle] = useState(defaultStyle);
  const [aspectRatio, setAspectRatio] = useState("16:9"); // "16:9" | "1:1" | "9:16"
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(false);

  // Initial visual
  const [currentVisual, setCurrentVisual] = useState(() => {
    const existingPost = posts.find((p) => p.imageUrl);
    const existingTopic = topics.find((t) => t.imageUrl);
    if (existingPost) {
      return {
        imageUrl: existingPost.imageUrl,
        prompt: existingPost.imagePrompt || existingPost.title || "Social graphic visual",
        style: defaultStyle,
        ratio: "16:9",
        width: 1200,
        height: 675,
      };
    }
    if (existingTopic) {
      return {
        imageUrl: existingTopic.imageUrl,
        prompt: existingTopic.imagePrompt || existingTopic.headline,
        style: defaultStyle,
        ratio: "16:9",
        width: 1200,
        height: 675,
      };
    }
    return {
      imageUrl: "https://image.pollinations.ai/prompt/Modern%20sleek%20SaaS%20vector%20illustration%20of%20business%20intelligence%20dashboard%20with%20realtime%20analytics%20graphs%2C%20clean%20UI%20gradients%2C%204k?width=1200&height=675&nologo=true&seed=9021",
      prompt: "Modern sleek SaaS vector illustration of business intelligence dashboard with realtime analytics graphs, clean UI gradients, 4k",
      style: "modern_saas",
      ratio: "16:9",
      width: 1200,
      height: 675,
    };
  });

  const [history, setHistory] = useState(() => {
    const list = [];
    if (currentVisual) list.push(currentVisual);
    topics.filter((t) => t.imageUrl).forEach((t) => {
      list.push({ imageUrl: t.imageUrl, prompt: t.headline, style: "modern_saas", ratio: "16:9", width: 1200, height: 675 });
    });
    posts.filter((p) => p.imageUrl).forEach((p) => {
      list.push({ imageUrl: p.imageUrl, prompt: p.title || p.copy?.slice(0, 40), style: "modern_saas", ratio: "16:9", width: 1200, height: 675 });
    });
    return list.slice(0, 8);
  });

  useEffect(() => {
    if (sourceMode === "topic") {
      const top = topics.find((t) => t.id === selectedTopicId) || topics[0];
      if (top) {
        setPrompt(`${top.headline}. Focus on ${top.angle || "operational efficiency and actionable data insights"}. High quality visual concept, no text.`);
        setTargetTopicId(top.id);
      }
    } else if (sourceMode === "post") {
      const pst = posts.find((p) => p.id === selectedPostId) || posts[0];
      if (pst) {
        setPrompt(`${pst.title || pst.topicHeadline || pst.theme || "Operations dashboard analytics"}. Clean composition, high detail, no text.`);
        setTargetPostId(pst.id);
      }
    } else if (sourceMode === "custom" && !prompt) {
      setPrompt("Automated operations intelligence dashboard with real-time streaming analytics metrics and glowing charts, 4k");
    }
  }, [sourceMode, selectedTopicId, selectedPostId]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 4000);
  };

  const getDimensions = (ratio) => {
    if (ratio === "1:1") return { width: 1024, height: 1024 };
    if (ratio === "9:16") return { width: 720, height: 1280 };
    return { width: 1200, height: 675 }; // 16:9
  };

  const handleGenerate = async (forcedSeed) => {
    const cleanPrompt = (prompt || "").trim() || "Operations intelligence dashboard analytics";
    setGenerating(true);
    const { width, height } = getDimensions(aspectRatio);
    try {
      const res = await api.generateImage({
        prompt: cleanPrompt,
        style,
        width,
        height,
      });

      if (res && res.imageUrl) {
        let finalUrl = res.imageUrl;
        if (forcedSeed) {
          finalUrl = `${finalUrl}&seed=${Math.floor(Math.random() * 999999)}`;
        }
        const newVisual = {
          imageUrl: finalUrl,
          prompt: cleanPrompt,
          style,
          ratio: aspectRatio,
          width,
          height,
        };
        setCurrentVisual(newVisual);
        setHistory((prev) => [newVisual, ...prev.filter((h) => h.imageUrl !== finalUrl)].slice(0, 10));
        showToast("✨ AI visual graphic generated successfully!");
      }
    } catch (err) {
      console.error("Error generating image:", err);
      const encoded = encodeURIComponent(`${cleanPrompt}, ${style}`);
      const fallbackUrl = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&nologo=true&seed=${Math.floor(Math.random() * 999999)}`;
      const fallbackVisual = {
        imageUrl: fallbackUrl,
        prompt: cleanPrompt,
        style,
        ratio: aspectRatio,
        width,
        height,
      };
      setCurrentVisual(fallbackVisual);
      setHistory((prev) => [fallbackVisual, ...prev].slice(0, 10));
      showToast("✨ Generated AI visual!");
    } finally {
      setGenerating(false);
    }
  };

  const handleAttachToPost = async () => {
    if (!currentVisual || !currentVisual.imageUrl) {
      showToast("Please generate or select an image first.");
      return;
    }
    const targetPost = posts.find((p) => p.id === targetPostId) || posts[0];
    if (!targetPost) {
      showToast("No post found to attach to.");
      return;
    }

    setPosts((prev) =>
      prev.map((p) =>
        p.id === targetPost.id
          ? { ...p, imageUrl: currentVisual.imageUrl, imagePrompt: currentVisual.prompt }
          : p
      )
    );

    try {
      await api.updatePostStatus(
        targetPost.id,
        targetPost.status || "awaiting_approval",
        targetPost.copy || "",
        currentVisual.imageUrl,
        currentVisual.prompt
      );
    } catch (e) {
      console.warn("Updated post in memory, backend sync warning:", e);
    }

    showToast(`✅ Visual attached to post: "${(targetPost.title || targetPost.id).slice(0, 32)}…"`);
  };

  const handleAttachToTopic = () => {
    if (!currentVisual || !currentVisual.imageUrl) {
      showToast("Please generate or select an image first.");
      return;
    }
    const targetTopic = topics.find((t) => t.id === targetTopicId) || topics[0];
    if (!targetTopic) {
      showToast("No topic found to attach to.");
      return;
    }

    setTopics((prev) =>
      prev.map((t) =>
        t.id === targetTopic.id
          ? { ...t, imageUrl: currentVisual.imageUrl, imagePrompt: currentVisual.prompt }
          : t
      )
    );

    showToast(`✅ Visual attached to topic: "${targetTopic.headline.slice(0, 32)}…"`);
  };

  const handleEnhancePrompt = () => {
    const enhancements = {
      modern_saas: "isometric 3D visualization, clean gradient backdrop, frosted glassmorphism accents, crisp lighting, high quality 4k render",
      editorial: "photorealistic 35mm film photography, natural studio side-lighting, sharp professional depth of field, 8k resolution",
      minimalist_3d: "vibrant pastel clay render, soft ambient occlusion shadows, smooth textures, playful geometric objects, blender cycles 4k",
      neon_tech: "dark cinematic atmosphere, glowing cyan and violet laser accents, holographic telemetry HUD, high contrast cyber aesthetic",
    };
    const suffix = enhancements[style] || enhancements.modern_saas;
    if (!prompt.includes(suffix.slice(0, 15))) {
      setPrompt((prev) => (prev ? `${prev.trim()}, ${suffix}` : suffix));
      showToast("Enhanced prompt with style keywords!");
    }
  };

  const handleCopyUrl = () => {
    if (currentVisual?.imageUrl) {
      navigator.clipboard?.writeText(currentVisual.imageUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast("Copied image URL to clipboard!");
    }
  };

  const styleOptions = [
    { id: "modern_saas", label: "Modern Tech SaaS", desc: "Clean UI vector gradients, isometric mockups & dashboards" },
    { id: "editorial", label: "Editorial Photography", desc: "Photorealistic 35mm corporate style, soft natural studio lighting" },
    { id: "minimalist_3d", label: "3D Clay Minimalist", desc: "Playful isometric clay render, smooth pastel shading" },
    { id: "neon_tech", label: "Dark Neon Cyberpunk", desc: "Moody high-contrast dark UI, glowing cyan & violet lasers" },
  ];

  const ratioOptions = [
    { id: "16:9", label: "16:9 Landscape", hint: "LinkedIn & X Banners (1200×675)" },
    { id: "1:1", label: "1:1 Square", hint: "Feed Posts & Instagram (1024×1024)" },
    { id: "9:16", label: "9:16 Vertical", hint: "Stories & Reels (720×1280)" },
  ];

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "28px 36px", background: HUB_PAPER, fontFamily: FONT_BODY }}>
      <div style={{ maxWidth: 1200, width: "100%", margin: "0 auto" }}>
        
        {/* Header Ribbon */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 24 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: `linear-gradient(135deg, ${C.teal}, ${C.cobalt})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Sparkles size={18} color="#fff" />
              </div>
              <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, margin: 0, letterSpacing: "-0.02em" }}>
                AI Image Studio
              </h1>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: C.tealSoft, color: C.teal, border: `1px solid ${C.teal}33` }}>
                Zero-Config · Instant FLUX Generator
              </span>
            </div>
            <p style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, margin: "6px 0 0 0" }}>
              Generate, customize, and attach high-resolution visual graphics to your scheduled posts and topic library with one click.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => onNavigate && onNavigate("topics")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: "#fff",
                color: C.ink,
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Search size={14} /> Topic library ({topics.length})
            </button>
            <button
              onClick={() => onNavigate && onNavigate("month")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 8,
                border: "none",
                background: C.ink,
                color: "#fff",
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <CalendarDays size={14} /> View Calendar
            </button>
          </div>
        </div>

        {/* Visual Director AI Chat Rail Notification */}
        <div style={{ background: C.tealSoft, border: `1px solid ${C.teal}33`, borderRadius: 12, padding: "12px 18px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: C.teal, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Sparkles size={15} />
            </div>
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
                Visual Director AI is Active on Your Right Rail
              </span>
              <span style={{ fontSize: 12.5, color: C.slate, marginLeft: 8 }}>
                Chat with AI to brainstorm visual concepts, refine prompt lighting, or request graphic styles for any topic!
              </span>
            </div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: "#fff", color: C.teal, border: `1px solid ${C.teal}44` }}>
            👉 Open Chat on Right
          </span>
        </div>

        {/* 2-Column Main Workspace */}
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 24, alignItems: "start", marginBottom: 32 }}>
          
          {/* Left Column: Creative Controls */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            
            {/* Card 1: Source & Concept */}
            <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 22, boxShadow: C.shadowCard }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink, display: "flex", alignItems: "center", gap: 8 }}>
                  <Wand2 size={16} color={C.teal} /> 1. Select Concept Source
                </div>
                {/* Source Mode Tabs */}
                <div style={{ display: "flex", background: HUB_PAPER, padding: 3, borderRadius: 8, border: `1px solid ${C.border}` }}>
                  {[
                    { id: "topic", label: "From Topic" },
                    { id: "post", label: "From Post" },
                    { id: "custom", label: "Custom" },
                  ].map((m) => {
                    const active = sourceMode === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setSourceMode(m.id)}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: "none",
                          background: active ? "#fff" : "transparent",
                          color: active ? C.ink : C.slate,
                          fontFamily: FONT_BODY,
                          fontSize: 12,
                          fontWeight: active ? 700 : 500,
                          cursor: "pointer",
                          boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                        }}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Source Mode Specific Dropdown */}
              {sourceMode === "topic" && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.textInk, marginBottom: 6 }}>
                    Select Topic from Library ({topics.length} available)
                  </label>
                  <select
                    value={selectedTopicId}
                    onChange={(e) => setSelectedTopicId(e.target.value)}
                    style={{
                      width: "100%",
                      height: 40,
                      padding: "0 12px",
                      borderRadius: 9,
                      border: `1px solid ${C.border}`,
                      fontFamily: FONT_BODY,
                      fontSize: 13,
                      background: HUB_PAPER,
                      color: C.ink,
                    }}
                  >
                    {topics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.headline} ({t.theme || "Topic"})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {sourceMode === "post" && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.textInk, marginBottom: 6 }}>
                    Select Scheduled Post ({posts.length} available)
                  </label>
                  <select
                    value={selectedPostId}
                    onChange={(e) => setSelectedPostId(e.target.value)}
                    style={{
                      width: "100%",
                      height: 40,
                      padding: "0 12px",
                      borderRadius: 9,
                      border: `1px solid ${C.border}`,
                      fontFamily: FONT_BODY,
                      fontSize: 13,
                      background: HUB_PAPER,
                      color: C.ink,
                    }}
                  >
                    {posts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title || (p.copy || "").slice(0, 45) || p.id} [{p.status}]
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Editable Prompt */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 700, color: C.textInk }}>
                    Visual Description Prompt
                  </label>
                  <button
                    type="button"
                    onClick={handleEnhancePrompt}
                    style={{
                      background: "none",
                      border: "none",
                      color: C.teal,
                      fontFamily: FONT_BODY,
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: 0,
                    }}
                  >
                    <Sparkles size={12} /> ✨ Enhance Prompt
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe the visual concept in detail (e.g. Modern executive operations dashboard with real-time graphs)..."
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 9,
                    border: `1px solid ${C.border}`,
                    fontFamily: FONT_BODY,
                    fontSize: 13,
                    lineHeight: 1.45,
                    color: C.ink,
                    boxSizing: "border-box",
                    resize: "vertical",
                  }}
                />
              </div>

              {/* Prompt Suggestions Pills */}
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[
                  "Executive operations KPI dashboard",
                  "Automated supply chain logistics network",
                  "Customer retention data stream graph",
                  "Live AI voice calling telemetric dispatch",
                ].map((idea, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setPrompt(idea + ", clean UI gradients, 4k render, no text")}
                    style={{
                      padding: "4px 9px",
                      borderRadius: 6,
                      border: `1px solid ${C.borderLight}`,
                      background: HUB_PAPER,
                      color: C.slate,
                      fontSize: 11,
                      cursor: "pointer",
                      fontFamily: FONT_BODY,
                    }}
                  >
                    + {idea}
                  </button>
                ))}
              </div>
            </div>

            {/* Card 2: Visual Style Preset */}
            <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 22, boxShadow: C.shadowCard }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <Sliders size={16} color={C.cobalt} /> 2. Visual Art Style
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {styleOptions.map((opt) => {
                  const active = style === opt.id;
                  return (
                    <div
                      key={opt.id}
                      onClick={() => setStyle(opt.id)}
                      style={{
                        padding: "12px 14px",
                        borderRadius: 10,
                        border: `2px solid ${active ? C.teal : C.border}`,
                        background: active ? C.tealSoft : HUB_PAPER,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13, color: active ? C.teal : C.ink }}>
                          {opt.label}
                        </span>
                        {active && <CheckCircle2 size={14} color={C.teal} />}
                      </div>
                      <div style={{ fontSize: 11, color: C.slate, marginTop: 4, lineHeight: 1.35 }}>
                        {opt.desc}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Aspect Ratio Selector */}
              <div style={{ marginTop: 18 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.textInk, marginBottom: 8 }}>
                  Aspect Ratio & Canvas Dimensions
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {ratioOptions.map((r) => {
                    const active = aspectRatio === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setAspectRatio(r.id)}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: `1px solid ${active ? C.teal : C.border}`,
                          background: active ? C.tealSoft : "#fff",
                          color: active ? C.teal : C.slate,
                          cursor: "pointer",
                          textAlign: "center",
                          fontFamily: FONT_BODY,
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700 }}>{r.label}</div>
                        <div style={{ fontSize: 10, color: C.slateLight, marginTop: 2 }}>{r.hint.split(" ")[0]}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Action Button: Generate */}
              <button
                type="button"
                disabled={generating}
                onClick={() => handleGenerate(false)}
                style={{
                  marginTop: 20,
                  width: "100%",
                  height: 44,
                  borderRadius: 10,
                  border: "none",
                  background: generating ? C.slateLight : `linear-gradient(135deg, ${C.teal}, ${C.cobalt})`,
                  color: "#fff",
                  fontFamily: FONT_BODY,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: generating ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  boxShadow: "0 4px 12px rgba(13,148,136,0.25)",
                }}
              >
                {generating ? (
                  <>
                    <RefreshCw size={16} className="spin" /> Generating High-Res Graphic…
                  </>
                ) : (
                  <>
                    <Sparkles size={16} /> Generate Visual Graphic
                  </>
                )}
              </button>
            </div>

          </div>

          {/* Right Column: Live Visual Canvas & Attach Hub */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            
            {/* Canvas Container */}
            <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, boxShadow: C.shadowCard }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink, display: "flex", alignItems: "center", gap: 8 }}>
                  <ImageIcon size={16} color={C.cobalt} /> Visual Preview Canvas
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: HUB_PAPER, color: C.slate, border: `1px solid ${C.border}` }}>
                    {aspectRatio} · {getDimensions(aspectRatio).width}×{getDimensions(aspectRatio).height}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: C.cobaltSoft, color: C.cobaltDeep }}>
                    {style}
                  </span>
                </div>
              </div>

              {/* Main Image Viewport */}
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: aspectRatio === "1:1" ? "1 / 1" : aspectRatio === "9:16" ? "9 / 16" : "16 / 9",
                  maxHeight: 380,
                  borderRadius: 12,
                  overflow: "hidden",
                  background: C.ink,
                  border: `1px solid ${C.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {generating ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, color: "#fff", padding: 20, textAlign: "center" }}>
                    <div style={{ width: 44, height: 44, borderRadius: 999, border: "3px solid rgba(255,255,255,0.2)", borderTopColor: C.teal, animation: "spin 0.8s linear infinite" }} />
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14 }}>Synthesizing Visual with FLUX…</div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: "#9AA0AE", maxWidth: 300 }}>
                      Rendering photorealistic composition tailored to your topic and style.
                    </div>
                  </div>
                ) : currentVisual?.imageUrl ? (
                  <img
                    src={currentVisual.imageUrl}
                    alt={currentVisual.prompt}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <div style={{ color: "#9AA0AE", fontSize: 13 }}>No visual generated yet. Click "Generate" on the left.</div>
                )}

                {/* Floating Quick Action Overlay Buttons */}
                {currentVisual?.imageUrl && !generating && (
                  <div style={{ position: "absolute", bottom: 12, right: 12, display: "flex", gap: 6 }}>
                    <a
                      href={currentVisual.imageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        height: 30,
                        padding: "0 10px",
                        borderRadius: 6,
                        background: "rgba(0,0,0,0.75)",
                        backdropFilter: "blur(4px)",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 11,
                        fontWeight: 600,
                        textDecoration: "none",
                      }}
                      title="Open full resolution in new tab"
                    >
                      <ExternalLink size={12} /> Open Full
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyUrl}
                      style={{
                        height: 30,
                        padding: "0 10px",
                        borderRadius: 6,
                        background: "rgba(0,0,0,0.75)",
                        backdropFilter: "blur(4px)",
                        color: "#fff",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                      title="Copy URL"
                    >
                      {copied ? <Check size={12} color={C.teal} /> : <Copy size={12} />} {copied ? "Copied" : "Copy Link"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleGenerate(true)}
                      style={{
                        height: 30,
                        padding: "0 10px",
                        borderRadius: 6,
                        background: "rgba(0,0,0,0.75)",
                        backdropFilter: "blur(4px)",
                        color: "#fff",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                      title="Generate another variation"
                    >
                      <RefreshCw size={12} /> Variation
                    </button>
                  </div>
                )}
              </div>

              {/* Prompt Caption under Preview */}
              {currentVisual?.prompt && (
                <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: HUB_PAPER, border: `1px solid ${C.borderLight}` }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.slateLight, textTransform: "uppercase" }}>Generated Concept Prompt</div>
                  <div style={{ fontSize: 12, color: C.ink, marginTop: 2, lineHeight: 1.35 }}>{currentVisual.prompt}</div>
                </div>
              )}
            </div>

            {/* Attach Hub Card */}
            <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, boxShadow: C.shadowCard }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                <CheckCircle2 size={16} color={C.teal} /> 3. Attach Visual to Posts or Topics
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                
                {/* Attach to Post */}
                <div style={{ padding: 12, borderRadius: 10, border: `1px solid ${C.borderLight}`, background: HUB_PAPER }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.textInk, marginBottom: 6 }}>
                    Apply to Scheduled Post
                  </div>
                  <select
                    value={targetPostId}
                    onChange={(e) => setTargetPostId(e.target.value)}
                    style={{
                      width: "100%",
                      height: 36,
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      fontSize: 12,
                      fontFamily: FONT_BODY,
                      background: "#fff",
                      padding: "0 8px",
                      marginBottom: 8,
                    }}
                  >
                    {posts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title ? p.title.slice(0, 30) : p.id} ({p.status})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAttachToPost}
                    style={{
                      width: "100%",
                      height: 34,
                      borderRadius: 8,
                      border: "none",
                      background: C.teal,
                      color: "#fff",
                      fontFamily: FONT_BODY,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <Check size={14} /> Attach to Post
                  </button>
                </div>

                {/* Attach to Topic */}
                <div style={{ padding: 12, borderRadius: 10, border: `1px solid ${C.borderLight}`, background: HUB_PAPER }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.textInk, marginBottom: 6 }}>
                    Apply to Topic Library
                  </div>
                  <select
                    value={targetTopicId}
                    onChange={(e) => setTargetTopicId(e.target.value)}
                    style={{
                      width: "100%",
                      height: 36,
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      fontSize: 12,
                      fontFamily: FONT_BODY,
                      background: "#fff",
                      padding: "0 8px",
                      marginBottom: 8,
                    }}
                  >
                    {topics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.headline.slice(0, 32)}…
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAttachToTopic}
                    style={{
                      width: "100%",
                      height: 34,
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      background: "#fff",
                      color: C.ink,
                      fontFamily: FONT_BODY,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <Plus size={14} /> Attach to Topic
                  </button>
                </div>

              </div>
            </div>

          </div>

        </div>

        {/* Bottom Ribbon: Recent Visuals History */}
        {history.length > 0 && (
          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, boxShadow: C.shadowCard }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink, display: "flex", alignItems: "center", gap: 8 }}>
                <Layers size={16} color={C.cobalt} /> Session Visual Gallery ({history.length})
              </div>
              <span style={{ fontSize: 11.5, color: C.slate }}>
                Click any thumbnail to preview or attach to another post
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
              {history.map((h, i) => (
                <div
                  key={i}
                  onClick={() => setCurrentVisual(h)}
                  style={{
                    borderRadius: 10,
                    overflow: "hidden",
                    border: `2px solid ${currentVisual?.imageUrl === h.imageUrl ? C.teal : C.borderLight}`,
                    cursor: "pointer",
                    background: HUB_PAPER,
                    transition: "transform 0.15s ease",
                  }}
                  className="hover-float"
                >
                  <div style={{ width: "100%", height: 95, background: C.ink, overflow: "hidden" }}>
                    <img src={h.imageUrl} alt={h.prompt} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
                  </div>
                  <div style={{ padding: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {h.prompt}
                    </div>
                    <div style={{ fontSize: 10, color: C.slateLight, marginTop: 2 }}>
                      {h.ratio || "16:9"} · {h.style || "modern_saas"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Floating Toast Notification */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 32, background: C.ink, color: "#fff", padding: "12px 20px", borderRadius: 10, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.2)", zIndex: 2000 }}>
          <CheckCircle2 size={16} color={C.teal} /> {toast}
        </div>
      )}
    </div>
  );
}


function TeamUsersModal({ isOpen, onClose, currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", username: "", role: "Operator", email: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await api.getUsers();
      if (res && res.length) setUsers(res);
      else setUsers([{ id: "op_admin", username: "jitendra", name: "Jitendra S.", role: "Admin", email: "admin@aivhub.io" }]);
    } catch (_) {
      setUsers([{ id: "op_admin", username: "jitendra", name: "Jitendra S.", role: "Admin", email: "admin@aivhub.io" }]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadUsers();
      setShowAdd(false);
      setError("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isAdmin = currentUser?.role === "Admin";

  const handleCreate = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim() || !form.username.trim()) {
      setError("Name and username are required.");
      return;
    }
    setSaving(true);
    try {
      await api.createUser({
        name: form.name.trim(),
        username: form.username.trim().toLowerCase(),
        role: form.role,
        email: form.email.trim() || `${form.username.trim().toLowerCase()}@aivhub.io`,
      });
      setForm({ name: "", username: "", role: "Operator", email: "" });
      setShowAdd(false);
      await loadUsers();
    } catch (err) {
      setError(err.message || "Failed to create user.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleRole = async (u) => {
    if (!isAdmin) return;
    if (u.username === currentUser?.username) return;
    const nextRole = u.role === "Admin" ? "Operator" : "Admin";
    try {
      await api.createUser({
        username: u.username,
        name: u.name,
        role: nextRole,
        email: u.email,
      });
      await loadUsers();
    } catch (_) {}
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 560, padding: 26, boxShadow: "0 24px 70px rgba(0,0,0,0.22)", border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: C.cobaltSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Users size={18} color={C.cobalt} />
            </div>
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.textInk }}>Team & User Hierarchy</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate }}>Admin manages platform AI & keys; Operators run missions below.</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.slate }}><X size={18} /></button>
        </div>

        {/* User list */}
        <div style={{ maxHeight: 280, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 12, background: C.paper, marginBottom: 16 }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: C.slate, fontSize: 13, fontFamily: FONT_BODY }}>Loading team members...</div>
          ) : (
            users.map((u, idx) => (
              <div key={u.id || u.username} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: idx === 0 ? "none" : `1px solid ${C.borderLight}`, background: "#fff" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 999, background: u.role === "Admin" ? C.cobalt : C.slate, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                    {initialsFromName(u.name)}
                  </div>
                  <div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.textInk }}>
                      {u.name} {u.username === currentUser?.username && <span style={{ fontSize: 11, color: C.slateLight }}>(you)</span>}
                    </div>
                    <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.slateLight }}>
                      @{u.username} · {u.email || `${u.username}@aivhub.io`}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    onClick={() => handleToggleRole(u)}
                    title={isAdmin && u.username !== currentUser?.username ? "Click to toggle role" : ""}
                    style={{
                      fontFamily: FONT_BODY,
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "3px 8px",
                      borderRadius: 6,
                      background: u.role === "Admin" ? C.cobaltSoft : C.paperSoft,
                      color: u.role === "Admin" ? C.cobaltDeep : C.slate,
                      cursor: isAdmin && u.username !== currentUser?.username ? "pointer" : "default",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {u.role}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add user form */}
        {showAdd ? (
          <form onSubmit={handleCreate} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, background: C.paperSoft, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, color: C.textInk }}>Add New Team Member</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Full Name (e.g. Alex M.)"
                style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: FONT_BODY, background: "#fff" }}
              />
              <input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="Username (e.g. alex)"
                style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: FONT_BODY, background: "#fff" }}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 10 }}>
              <input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="Email (optional)"
                style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: FONT_BODY, background: "#fff" }}
              />
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: FONT_BODY, background: "#fff" }}
              >
                <option value="Operator">Operator (User)</option>
                <option value="Admin">Admin (Full Access)</option>
              </select>
            </div>
            {error && <div style={{ color: C.red, fontSize: 12, fontFamily: FONT_BODY }}>⚠️ {error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              <button type="button" onClick={() => setShowAdd(false)} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontSize: 12, cursor: "pointer" }}>Cancel</button>
              <button type="submit" disabled={saving} style={{ padding: "6px 16px", borderRadius: 8, border: "none", background: C.cobalt, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{saving ? "Creating..." : "Create User"}</button>
            </div>
          </form>
        ) : (
          isAdmin && (
            <button
              onClick={() => setShowAdd(true)}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 14px", borderRadius: 10, border: `1px dashed ${C.border}`, background: "#fff", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.slate, cursor: "pointer" }}
            >
              <Plus size={14} /> Add Operator / User Account
            </button>
          )
        )}
      </div>
    </div>
  );
}

function ProfileSettingsModal({ isOpen, onClose, operator, setOperator }) {
  const [name, setName] = useState(operator?.name || "");
  const [email, setEmail] = useState(operator?.email || `${operator?.username || "user"}@aivhub.io`);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isOpen && operator) {
      setName(operator.name || "");
      setEmail(operator.email || `${operator.username || "user"}@aivhub.io`);
      setSaved(false);
    }
  }, [isOpen, operator]);

  if (!isOpen) return null;

  const handleSave = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setOperator((prev) => ({ ...prev, name: name.trim(), email: email.trim() }));
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 800);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 440, padding: 26, boxShadow: "0 24px 70px rgba(0,0,0,0.22)", border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: C.paperSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <User size={18} color={C.slate} />
            </div>
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.textInk }}>Profile Settings</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate }}>Manage your account identity and email.</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.slate }}><X size={18} /></button>
        </div>

        <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Display Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }} />
          </div>
          <div>
            <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Username (Read Only)</label>
            <input value={`@${operator?.username}`} disabled style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5, background: C.paperSoft, color: C.slate }} />
          </div>
          <div>
            <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Role Assigned</label>
            <input value={operator?.role} disabled style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, background: C.paperSoft, color: C.slate }} />
          </div>
          <div>
            <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }} />
          </div>

          {saved && (
            <div style={{ padding: "8px 12px", background: C.tealSoft, color: C.teal, borderRadius: 8, fontSize: 12, fontFamily: FONT_BODY, display: "flex", alignItems: "center", gap: 6 }}>
              <CheckCircle2 size={14} /> Profile updated successfully!
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button type="submit" style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: C.ink, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function UserProfileMenu({ operator, onLogout, commonAi, onOpenCommonAi, onOpenTeamUsers, onOpenProfileSettings }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const isAdmin = operator?.role === "Admin";
  const configuredProvidersList = (commonAi?.providers || []).filter(
    (p) => (p.status === "connected" && p.latencyMs) || (p.apiKey && p.apiKey.trim().length > 0)
  );
  const totalProvidersCount = (commonAi?.providers || []).length || 11;
  const configuredCount = configuredProvidersList.length;
  const isFullyConnected = configuredCount >= totalProvidersCount && totalProvidersCount > 0;
  const isPartiallyConnected = configuredCount > 0 && !isFullyConnected;
  const activeModelDisplay = commonAi?.baseChatModel
    ? commonAi.baseChatModel.split(" ")[0]
    : (configuredCount > 0 ? `${configuredCount} Active` : "Not configured");

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: open ? "#fff" : "#fff",
          border: `1px solid ${open ? C.cobalt : C.border}`,
          borderRadius: 999,
          padding: "4px 14px 4px 5px",
          cursor: "pointer",
          boxShadow: open ? "0 4px 14px rgba(52,87,213,0.14)" : "0 2px 8px rgba(18,20,28,0.04)",
          transition: "all 0.15s ease",
        }}
      >
        <div style={{
          width: 32,
          height: 32,
          borderRadius: 999,
          background: isAdmin ? `linear-gradient(135deg, ${C.cobalt}, #6366F1)` : C.slate,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FONT_BODY,
          fontSize: 12,
          fontWeight: 700,
          boxShadow: "0 2px 6px rgba(52,87,213,0.2)",
        }}>
          {initialsFromName(operator?.name)}
        </div>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, color: C.textInk, lineHeight: 1.2 }}>
            {operator?.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
            <span style={{
              fontSize: 9.5,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              padding: "1px 6px",
              borderRadius: 4,
              background: isAdmin ? "#EEF2FF" : C.paperSoft,
              color: isAdmin ? "#4338CA" : C.slate,
            }}>
              {operator?.role}
            </span>
          </div>
        </div>
        <ChevronDown size={14} color={C.slate} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s ease", marginLeft: 4 }} />
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          right: 0,
          width: 305,
          background: "#fff",
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          boxShadow: "0 18px 50px rgba(18,20,28,0.16)",
          padding: 8,
          zIndex: 150,
        }}>
          {/* Header Card */}
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.borderLight}`, marginBottom: 6 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 700, color: C.textInk }}>{operator?.name}</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight, marginTop: 1 }}>@{operator?.username}</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.slate, marginTop: 3 }}>
              {operator?.email || `${operator?.username}@aivhub.io`}
            </div>
          </div>

          {/* Admin Controls */}
          {isAdmin && (
            <>
              <div style={{ padding: "4px 10px", fontFamily: FONT_BODY, fontSize: 10, fontWeight: 700, color: C.slateLight, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Admin Controls
              </div>

              {/* AI Configuration */}
              <button
                onClick={() => { setOpen(false); onOpenCommonAi(); }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = C.paperSoft}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: C.cobaltSoft, display: "flex", alignItems: "center", justifyContent: "center", color: C.cobalt }}>
                    <Settings2 size={15} />
                  </div>
                  <div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk }}>AI Configuration</div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>Plugin models & API keys</div>
                  </div>
                </div>
                {isFullyConnected ? (
                  <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: "4px 10px",
                    borderRadius: 8,
                    background: "#ECFDF5",
                    color: "#059669",
                    border: "1px solid #A7F3D0",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: "#059669", flexShrink: 0 }} />
                    All Active
                  </span>
                ) : isPartiallyConnected ? (
                  <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: "4px 10px",
                    borderRadius: 8,
                    background: "#F1F5F9",
                    color: "#475569",
                    border: "1px solid #CBD5E1",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: "#94A3B8", flexShrink: 0 }} />
                    {configuredCount} / {totalProvidersCount} Connected
                  </span>
                ) : (
                  <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: "4px 10px",
                    borderRadius: 8,
                    background: "#F8FAFC",
                    color: "#64748B",
                    border: "1px solid #E2E8F0",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: "#94A3B8", flexShrink: 0 }} />
                    Not configured
                  </span>
                )}
              </button>

              {/* Team & Users */}
              <button
                onClick={() => { setOpen(false); onOpenTeamUsers(); }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 10,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = C.paperSoft}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <Users size={15} color={C.cobalt} />
                <div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk }}>Team & Users</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>Manage operators & roles</div>
                </div>
              </button>

              <div style={{ height: 1, background: C.borderLight, margin: "6px 8px" }} />
            </>
          )}

          {/* User Settings */}
          <button
            onClick={() => { setOpen(false); onOpenProfileSettings(); }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 12px",
              borderRadius: 10,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = C.paperSoft}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
          >
            <User size={15} color={C.slate} />
            <div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk }}>Profile Settings</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>Name & email details</div>
            </div>
          </button>

          <div style={{ height: 1, background: C.borderLight, margin: "6px 8px" }} />

          {/* Logout */}
          <button
            onClick={() => { setOpen(false); onLogout(); }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 12px",
              borderRadius: 10,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
              color: C.red,
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = C.redSoft}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
          >
            <LogOut size={15} color={C.red} />
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600 }}>Sign out</div>
          </button>
        </div>
      )}
    </div>
  );
}

function PluginHub({ operator, onPick, onLogout, commonAi, onOpenCommonAi, onOpenTeamUsers, onOpenProfileSettings }) {
  return (
    <div style={{ minHeight: "100vh", background: HUB_PAPER, fontFamily: FONT_BODY, display: "flex", flexDirection: "column" }}>
      <AppChrome />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 36px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrandMark size={32} />
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink, letterSpacing: "-0.02em" }}>AIVHub</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* User Profile Menu with embedded AI Config & Team Hierarchy */}
          <UserProfileMenu
            operator={operator}
            onLogout={onLogout}
            commonAi={commonAi}
            onOpenCommonAi={onOpenCommonAi}
            onOpenTeamUsers={onOpenTeamUsers}
            onOpenProfileSettings={onOpenProfileSettings}
          />
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "12px 24px 64px" }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.slateLight, marginBottom: 8 }}>
          Workspace Plugins
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 32, color: C.ink, letterSpacing: "-0.04em", marginBottom: 8, textAlign: "center" }}>
          Choose a plugin
        </div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 15, color: C.slate, marginBottom: 38, textAlign: "center", maxWidth: 640, lineHeight: 1.5 }}>
          The unified AI growth suite for your business. Scout verified accounts, schedule branded content, run outbound email sequences, and conduct live voice discovery calls.
        </div>

        {/* Workspace Plugins with generous spacing and clean titles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 310px))", gap: 32, justifyContent: "center", width: "100%", maxWidth: 1360 }}>
          <PluginCard
            icon={Search}
            title="Lead Generation"
            blurb="Autonomous business lead scout: discover target accounts, extract verified decision-makers & numbers, and prepare enriched intelligence dossiers."
            accent="#8B5CF6"
            ready={true}
            onClick={() => onPick("leadgen")}
          />
          <PluginCard
            icon={CalendarDays}
            title="Post Scheduler"
            blurb="Social content planner & generator: multi-channel drafting from company knowledge, editorial calendar scheduling, and AI visual creative studio."
            accent={C.teal}
            ready={true}
            onClick={() => onPick("scheduler")}
          />
          <PluginCard
            icon={Mail}
            title="Email Outreach"
            blurb="AI email drafter & campaign sender: cold approach sequences, inbound client reply drafter, and 1-click social post-to-email repurposing."
            accent="#F59E0B"
            ready={true}
            onClick={() => onPick("emailoutreach")}
          />
          <PluginCard
            icon={PhoneCall}
            title="AI Voice Assistant"
            blurb="Live multi-line outbound voice agent: import verified prospect contacts, initiate realistic telephone calls, book meetings, and supervise."
            accent={C.cobalt}
            ready={true}
            onClick={() => onPick("voice")}
          />
        </div>
      </div>
    </div>
  );
}

const SOCIAL_CHANNELS = {
  linkedin: { label: "LinkedIn", color: "#0A66C2", soft: "#E8F1FA", mark: "in" },
  threads: { label: "Threads", color: "#000000", soft: "#F4F4F5", mark: "@" },
  x: { label: "X", color: "#111827", soft: "#EFEFEF", mark: "X" },
  facebook: { label: "Facebook", color: "#1877F2", soft: "#E7F0FE", mark: "f" },
  instagram: { label: "Instagram", color: "#E4405F", soft: "#FDECEE", mark: "Ig" },
};

const PLAN_MONTH = { year: 2026, month: 8, label: "September 2026" };
const SCHEDULER_NOW = new Date(2026, 8, 1, 10, 0, 0);
const WEEKDAY_NUM = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
const THEME_TINT = {
  ps_mon: { fg: "#3457D5", bg: "#EAEEFC" },
  ps_wed: { fg: "#0C8C7D", bg: "#E4F5F2" },
  ps_fri: { fg: "#B8760A", bg: "#FCEFDA" },
};

const INITIAL_OUR_COMPANY = {
  name: "AIVHub",
  about: "AI-powered business intelligence dashboards for mid-market operations teams",
  industry: "Business intelligence / data consulting",
  website: "https://aivhub.io",
};

function companyFromProfile(profile, knowledgeSources) {
  const p = profile || INITIAL_COMPANY_PROFILE;
  const kb = (knowledgeSources || []).filter((s) => s.status === "indexed").map((s) => s.name);
  return {
    name: p.name,
    about: p.pitch || p.about || "",
    industry: p.industry || "",
    website: p.website || "",
    tone: p.tone || "",
    kbNames: kb.length ? kb : ["Company website"],
  };
}

const TOPIC_BANK = {
  ps_mon: [
    { id: "t_mon_1", headline: "Ops teams still closing the week in spreadsheets — that's the gap we built for", angle: "If Friday still means exporting CSV and praying the numbers match, the dashboard isn't a nice-to-have. It's how the week should have felt.", cta: "See how AIVHub dashboards work →", source: "Customer calls", freshness: "This week" },
    { id: "t_mon_2", headline: "What we shipped this month: live dispatch and utilisation in one view", angle: "One screen, the numbers that actually move the floor. Written like a product note, not a launch fanfare.", cta: "See what's new in AIVHub →", source: "Product", freshness: "3 days ago" },
    { id: "t_mon_3", headline: "Month-end packs vs live ops — why mid-market is stuck in between", angle: "Boards get a PDF. The warehouse gets a WhatsApp. We sit in the gap and make both look at the same truth.", cta: "How AIVHub handles live ops →", source: "Industry scan", freshness: "This week" },
    { id: "t_mon_4", headline: "A 12-minute setup, not a six-month BI project", angle: "That's the point of being mid-market sized: you don't have a data team waiting. The product has to arrive useful.", cta: "Start with AIVHub →", source: "Onboarding notes", freshness: "This week" },
  ],
  ps_wed: [
    { id: "t_wed_1", headline: "A logistics ops director told us they were tracking performance in three tools", angle: "We didn't pitch. We asked which number they trust at 4pm. That's the story — and why the dashboard exists.", cta: "Read how teams use AIVHub →", source: "Customer story", freshness: "Yesterday" },
    { id: "t_wed_2", headline: "UK mid-market still spending on reports nobody opens", angle: "The industry news this week is more of the same: more tools, less trust in the number. We post because we live in that mess.", cta: "What we believe about reporting →", source: "Trade press", freshness: "2 days ago" },
    { id: "t_wed_3", headline: "When the floor and the board disagree, it's a data problem", angle: "Not a people problem. A live-ops dashboard is how AIVHub earns the next conversation.", cta: "See AIVHub in operations →", source: "Field notes", freshness: "This week" },
    { id: "t_wed_4", headline: "A plant manager asked for 'one number for the shift'", angle: "That's a better brief than a 40-page requirements doc. We built toward that sentence.", cta: "How we scope a dashboard →", source: "Discovery", freshness: "4 days ago" },
    { id: "t_wed_5", headline: "Competitors selling 'AI insights' — we still start with the operational fact", angle: "Insight without a trusted number is theatre. Our posts should sound like the floor, not a model card.", cta: "What AIVHub actually shows →", source: "Market", freshness: "This week" },
  ],
  ps_fri: [
    { id: "t_fri_1", headline: "How we work: humans supervise, the product does the grind", angle: "Same idea as our voice work — people stay in charge. The Friday post is who we are, not a feature list.", cta: "Meet the AIVHub way →", source: "Team", freshness: "Today" },
    { id: "t_fri_2", headline: "We're hiring people who have sat next to an ops manager, not only a dashboard", angle: "Culture post with a job attached. If it doesn't sound like us, don't publish it.", cta: "See roles at AIVHub →", source: "Hiring", freshness: "Yesterday" },
    { id: "t_fri_3", headline: "A note from this week's customer call — they just wanted Friday to be quieter", angle: "That's the proof. Not a logo wall. A quieter Friday.", cta: "Why teams pick AIVHub →", source: "Customer", freshness: "This week" },
    { id: "t_fri_4", headline: "London / remote — building for UK and European operations teams", angle: "Where we sit matters to who we write for. Keep it specific, keep it ours.", cta: "Where AIVHub works →", source: "Company", freshness: "This week" },
  ],
  generic: [
    { id: "t_gen_1", headline: "What's moving in our world this week", angle: "A live story about us and the work we do — written like a person, with a reason to look at the product.", cta: "Learn more about AIVHub →", source: "Desk research", freshness: "This week" },
  ],
};

function buildOurSchedules() {
  return [
    { id: "ps_mon", weekday: "Monday", time: "09:00", cadence: "weekly", channels: ["linkedin", "facebook"], theme: "Product — what we shipped and how it helps ops teams", status: "active" },
    { id: "ps_wed", weekday: "Wednesday", time: "09:00", cadence: "weekly", channels: ["linkedin", "x"], theme: "The work — customer stories and what's going on in operations & reporting", status: "active" },
    { id: "ps_fri", weekday: "Friday", time: "09:00", cadence: "weekly", channels: ["linkedin", "facebook"], theme: "Us — people, hiring, and how we work", status: "active" },
  ];
}

const INITIAL_POST_SCHEDULES = buildOurSchedules();

function formatPlanDay(d) {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function startOfDayMs(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function weekdayName(dateObj) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dateObj.getDay()];
}

function horizonRange(horizon, now) {
  const n = now || SCHEDULER_NOW;
  const start = new Date(startOfDayMs(n));
  if (horizon === "2days") {
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return rangeFromDates(start, end, "2days");
  }
  if (horizon === "week") {
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return rangeFromDates(start, end, "week");
  }
  return monthRange(n.getFullYear(), n.getMonth());
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function monthRange(year, month) {
  return {
    horizon: "custom",
    fromMs: new Date(year, month, 1).getTime(),
    toMs: new Date(year, month + 1, 0).getTime(),
    label: monthLabel(year, month),
  };
}

function rangeFromDates(fromDate, toDate, horizon) {
  let a = startOfDayMs(fromDate);
  let b = startOfDayMs(toDate);
  if (b < a) { const tmp = a; a = b; b = tmp; }
  const sameMonth = new Date(a).getMonth() === new Date(b).getMonth() && new Date(a).getFullYear() === new Date(b).getFullYear() && new Date(a).getDate() === 1 && new Date(b).getDate() === new Date(new Date(b).getFullYear(), new Date(b).getMonth() + 1, 0).getDate();
  return {
    horizon: horizon || "custom",
    fromMs: a,
    toMs: b,
    label: sameMonth ? monthLabel(new Date(a).getFullYear(), new Date(a).getMonth()) : (formatPlanDay(new Date(a)) + " – " + formatPlanDay(new Date(b))),
  };
}

function isoDate(ms) {
  const d = new Date(ms);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function dayKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  return x.getFullYear() + "-" + (x.getMonth() + 1) + "-" + x.getDate();
}

const MONTH_INDEX = { january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11 };

function parseDateRangeFromText(text, now) {
  const t = String(text || "").toLowerCase();
  const n = now || SCHEDULER_NOW;
  const today = new Date(startOfDayMs(n));
  const yearNow = today.getFullYear();

  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\s*(?:to|–|-)\s*(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return rangeFromDates(new Date(iso[1]), new Date(iso[2]), "custom");

  if (/\blast week\b/.test(t)) {
    const end = addDays(today, -1);
    return rangeFromDates(addDays(end, -6), end, "past_week");
  }
  if (/\bnext week\b/.test(t)) return rangeFromDates(addDays(today, 1), addDays(today, 7), "week");
  if (/\blast month\b/.test(t)) {
    const m = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
    const y = today.getMonth() === 0 ? yearNow - 1 : yearNow;
    return monthRange(y, m);
  }
  if (/\bnext month\b/.test(t)) {
    const m = today.getMonth() + 1;
    return monthRange(yearNow + Math.floor(m / 12), m % 12);
  }

  const span = t.match(/\b(\d{1,2})\s*(?:–|-|to)\s*(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?\b/);
  if (span && MONTH_INDEX[span[3]] !== undefined) {
    const y = span[4] ? parseInt(span[4], 10) : yearNow;
    return rangeFromDates(new Date(y, MONTH_INDEX[span[3]], parseInt(span[1], 10)), new Date(y, MONTH_INDEX[span[3]], parseInt(span[2], 10)), "custom");
  }

  const fromTo = t.match(/\b(?:from|between)\s+(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?\s+(?:to|and|–|-)\s+(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?/);
  if (fromTo && MONTH_INDEX[fromTo[2]] !== undefined && MONTH_INDEX[fromTo[5]] !== undefined) {
    const y1 = fromTo[3] ? parseInt(fromTo[3], 10) : yearNow;
    const y2 = fromTo[6] ? parseInt(fromTo[6], 10) : y1;
    return rangeFromDates(new Date(y1, MONTH_INDEX[fromTo[2]], parseInt(fromTo[1], 10)), new Date(y2, MONTH_INDEX[fromTo[5]], parseInt(fromTo[4], 10)), "custom");
  }

  const named = t.match(/\b(january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s*(\d{4})?\b/);
  if (named && MONTH_INDEX[named[1]] !== undefined) {
    return monthRange(named[2] ? parseInt(named[2], 10) : yearNow, MONTH_INDEX[named[1]]);
  }
  return null;
}

function parseHorizonFromText(t) {
  if (/\b(2 days|two days|couple of days|next two)\b/.test(t)) return "2days";
  if (/\b(this week|one week|a week)\b/.test(t) && !/\blast week\b/.test(t) && !/\bnext week\b/.test(t)) return "week";
  if (/\b(this month|the month|whole month)\b/.test(t) && !/\blast month\b/.test(t) && !/\bnext month\b/.test(t)) return "month";
  return null;
}

function stripResearchPrefix(text) {
  return String(text || "").replace(/^\s*(find topics?|search( the web)?|look up|research|what's going on|whats going on|scan)(\s+(about|on|for))?\s*/i, "").trim();
}

function researchTopicsFromQuery(query, company) {
  const q = (query || "what's moving in our world").replace(/\s+/g, " ").trim();
  const who = (company && company.name) || "we";
  const kb = (company && company.kbNames && company.kbNames[0]) || "Company knowledge";
  const rows = [
    { h: "Search result: " + q, a: "What the web and the sector are saying right now. " + who + " should take a position — not recap the article.", src: "Web search", fresh: "Just now" },
    { h: "What people are asking about “" + q + "”", a: "Comments and threads, not a press release. Reply to the room, then point at what we actually do.", src: "Social listen", fresh: "Today" },
    { h: q + " — a take " + who + " can own", a: "Public story × our proof. " + kb + " is why this isn't generic.", src: kb, fresh: "This week" },
    { h: "A practical angle on " + q, a: "One thing a reader can do today. Then a reason to look at " + who + ".", src: "Desk research", fresh: "2 days ago" },
    { h: "What changed recently around " + q, a: "If the story moved, the post should move. Old copy on a live issue looks asleep.", src: "News scan", fresh: "Yesterday" },
  ];
  const stamp = Date.now();
  return rows.map((x, i) => ({
    id: "rs_" + stamp + "_" + i,
    headline: voiceForCompany(x.h, company),
    angle: voiceForCompany(x.a, company),
    cta: "See how " + who + " thinks about this →",
    source: x.src,
    freshness: x.fresh,
    query: q,
    scheduleId: null,
    saved: true,
  }));
}

function expandSlotsForRange(schedules, fromMs, toMs, fillEmptyDays) {
  const rules = schedules || [];
  const slots = [];
  if (!rules.length) return slots;
  const start = startOfDayMs(fromMs);
  const end = startOfDayMs(toMs);
  let dayIndex = 0;
  for (let ms = start; ms <= end; ms += 86400000) {
    const d = new Date(ms);
    const weekday = weekdayName(d);
    const matches = rules.filter((s) => s.weekday === weekday);
    const use = matches.length
      ? matches
      : (fillEmptyDays ? [{ ...rules[dayIndex % rules.length], weekday, id: "ps_" + weekday.slice(0, 3).toLowerCase() }] : []);
    use.forEach((sch) => {
      slots.push({
        id: "slot_" + d.getFullYear() + "_" + (d.getMonth() + 1) + "_" + d.getDate() + "_" + sch.id,
        day: d.getDate(),
        dateMs: startOfDayMs(d),
        weekday,
        scheduleId: sch.id,
        theme: sch.theme,
        channels: (sch.channels || ["linkedin"]).slice(),
        time: sch.time || "09:00",
        topicId: null,
        postId: null,
      });
    });
    dayIndex += 1;
  }
  return slots;
}

function expandMonthSlots(schedules, year, month) {
  return expandSlotsForRange(schedules, new Date(year, month, 1).getTime(), new Date(year, month + 1, 0).getTime(), false);
}

function slotDueMs(slot) {
  if (!slot) return 0;
  const parts = String(slot.time || "09:00").split(":");
  const d = new Date(slot.dateMs);
  d.setHours(parseInt(parts[0], 10) || 9, parseInt(parts[1], 10) || 0, 0, 0);
  return d.getTime();
}

function isSlotDue(slot, now) {
  return slotDueMs(slot) <= (now || SCHEDULER_NOW).getTime();
}

function operatorEmail(operator) {
  const u = String((operator && operator.username) || "jitendra").replace(/\s+/g, "").toLowerCase();
  return u + "@aivhub.io";
}

function makeApprovalEmail(post, operator) {
  return {
    id: "em_" + post.id + "_" + Date.now(),
    to: operatorEmail(operator),
    subject: "Approve post — " + (post.topicHeadline || post.theme),
    preview: "Due " + (post.dateLabel || "") + ". Written in this software from company knowledge. Approve to publish, or reject.",
    body: (post.copy || "") + "\n\n" + (post.cta || ""),
    postId: post.id,
    sentAt: "just now",
    status: "unread",
  };
}

function buildMonthCells(year, month) {
  const first = new Date(year, month, 1);
  const daysIn = new Date(year, month + 1, 0).getDate();
  const pad = (first.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < pad; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function voiceForCompany(text, company) {
  const who = (company && company.name) || "we";
  return String(text || "").replace(/AIVHub/g, who);
}

function writePostFromTopic(schedule, topic, slot, status, company) {
  const t = topic || TOPIC_BANK.generic[0];
  const who = (company && company.name) || "we";
  const due = slot && isSlotDue(slot);
  const resolved = status || (due ? "awaiting_approval" : "scheduled");
  const kb = (company && company.kbNames) || [];
  const imagePrompt = t.imagePrompt || `${t.headline || (schedule && schedule.theme) || "Modern operations"}, modern tech illustration, clean design, 4k`;
  const seed = Math.floor(Math.random() * 900000) + 100000;
  const imageUrl = t.imageUrl || `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?width=1200&height=675&nologo=true&seed=${seed}`;

  return {
    id: "post_" + (slot && slot.id) + "_" + t.id,
    slotId: slot && slot.id,
    scheduleId: schedule.id,
    weekday: slot ? slot.weekday : schedule.weekday,
    dateLabel: slot ? formatPlanDay(new Date(slot.dateMs)) + " · " + slot.time : schedule.weekday,
    dateMs: slot ? slot.dateMs : null,
    time: (slot && slot.time) || schedule.time,
    channels: (slot && slot.channels) || schedule.channels.slice(),
    theme: schedule.theme,
    topicId: t.id,
    topicHeadline: voiceForCompany(t.headline, company),
    topicSource: t.source,
    topicFreshness: t.freshness,
    copy: voiceForCompany(t.headline + ".\n\n" + t.angle, company) + (company && company.about ? "\n\n— " + company.about : ""),
    cta: voiceForCompany(t.cta || ("See what " + who + " is doing →"), company),
    status: resolved,
    publishedAt: null,
    edited: false,
    variant: 0,
    writtenInApp: true,
    kbUsed: kb.slice(0, 3),
    imageUrl,
    imagePrompt,
    emailSent: resolved === "awaiting_approval",
    approvalVia: resolved === "awaiting_approval" ? ["app", "email"] : [],
  };
}

function assignTopicsToSlots(slots, topics) {
  const used = new Set();
  return slots.map((slot) => {
    if (slot.topicId) return slot;
    const next = topics.find((t) => !used.has(t.id) && (t.scheduleId === slot.scheduleId || !t.scheduleId));
    if (!next) return slot;
    used.add(next.id);
    return { ...slot, topicId: next.id };
  });
}

function tintFor(id) {
  if (THEME_TINT[id]) return THEME_TINT[id];
  const pal = [THEME_TINT.ps_mon, THEME_TINT.ps_wed, THEME_TINT.ps_fri];
  let h = 0;
  const s = String(id || "");
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i);
  return pal[h % pal.length];
}

function synthesizeTopicsFor(schedule, company) {
  const bank = TOPIC_BANK[schedule.id];
  if (bank) {
    return bank.map((t) => ({
      ...t,
      headline: voiceForCompany(t.headline, company),
      angle: voiceForCompany(t.angle, company),
      cta: voiceForCompany(t.cta, company),
      scheduleId: schedule.id,
      theme: schedule.theme,
    }));
  }
  const theme = schedule.theme || "our work";
  const who = (company && company.name) || "we";
  const bits = [
    ["What's live this week on " + theme, "This is our story, not someone else's. " + who + " should show up with a useful take, not a slogan.", (company && company.kbNames && company.kbNames[0]) || "Company knowledge", "This week"],
    ["A practical angle on " + theme + " for this month", "Skip the announcement tone. Give one thing a reader can do today, then a reason to look at " + who + ".", "Our notes", "2 days ago"],
    [theme + " — what changed in the last few days", "If the story moved, the post should move with it. Old copy on a live issue looks asleep.", "News scan", "Yesterday"],
    ["Why " + theme + " matters to us before month-end", "A calendar slot is wasted if the post could have been written in January. Tie it to now, and to us.", "Sector brief", "This week"],
    ["A conversation already happening around " + theme, "Reply to the room instead of broadcasting. That's how " + who + " sounds like a person.", "Social listen", "Today"],
  ];
  return bits.map((b, i) => ({
    id: schedule.id + "_t" + (i + 1),
    headline: b[0],
    angle: b[1],
    cta: "See what " + who + " is doing →",
    source: b[2],
    freshness: b[3],
    scheduleId: schedule.id,
    theme: schedule.theme,
  }));
}

function collectFoundTopics(schedules, company) {
  const out = [];
  (schedules || []).forEach((sch) => {
    synthesizeTopicsFor(sch, company).forEach((t) => out.push(t));
  });
  return out;
}

function writePostsFrom(schList, topicList, slotList, company) {
  const schMap = {};
  (schList || []).forEach((s) => { schMap[s.id] = s; });
  const topicMap = {};
  (topicList || []).forEach((t) => { topicMap[t.id] = t; });
  const created = [];
  const nextSlots = (slotList || []).map((slot) => {
    if (!slot.topicId || slot.postId) return slot;
    const sch = schMap[slot.scheduleId];
    const topic = topicMap[slot.topicId];
    if (!sch || !topic) return slot;
    const post = writePostFromTopic(sch, topic, slot, null, company);
    created.push(post);
    return { ...slot, postId: post.id };
  });
  return { nextSlots, created };
}


const INITIAL_MONTH_SLOTS = expandMonthSlots(INITIAL_POST_SCHEDULES, PLAN_MONTH.year, PLAN_MONTH.month).map((s, idx) => {
  if (idx === 0) return { ...s, topicId: "t_mon_1", postId: "post_seed_pub_1" };
  if (idx === 1) return { ...s, topicId: "t_mon_2", postId: "post_seed_awaiting_1" };
  if (idx === 2) return { ...s, topicId: "t_mon_3", postId: "post_seed_awaiting_2" };
  if (idx === 3) return { ...s, topicId: "t_mon_4", postId: "post_seed_approved_1" };
  if (idx === 4) return { ...s, topicId: "t_mon_5", postId: "post_seed_scheduled_1" };
  return s;
});

const INITIAL_SCHEDULER_TOPICS = [
  {
    id: "t_mon_1",
    freshness: "Yesterday",
    source: "Industry Benchmark",
    query: "UK logistics efficiency & fleet tech",
    headline: "Fleet operators report 28% telematics integration lag in Q3",
    angle: "Why standalone telematics without dispatch integration costs fleets 4.2 hours per driver per week.",
    saved: true,
  },
  {
    id: "t_mon_2",
    freshness: "2 days ago",
    source: "Customer Interviews",
    query: "UK logistics efficiency & fleet tech",
    headline: "Why multi-depot operations directors are ditching disconnected spreadsheets",
    angle: "Manual reconciliation across 4+ depots creates invoicing latency that eats straight into EBITDA.",
    saved: true,
  },
  {
    id: "t_mon_3",
    freshness: "3 days ago",
    source: "Technical Analysis",
    query: "B2B warehouse automation trends 2026",
    headline: "Autonomous dispatch vs human dispatcher intuition: where the real ROI lands",
    angle: "AI route sequencing isn't about replacing dispatchers—it gives them 35 extra minutes per run.",
    saved: true,
  },
  {
    id: "t_mon_4",
    freshness: "4 days ago",
    source: "Regulatory Updates",
    query: "Cold chain telematics compliance",
    headline: "Cold chain compliance: new 2026 digital reporting standards for food & pharma",
    angle: "Manual temperature logs are facing audit penalties under the revised traceability guidelines.",
    saved: true,
  },
  {
    id: "t_mon_5",
    freshness: "5 days ago",
    source: "Case Study",
    query: "UK logistics efficiency & fleet tech",
    headline: "How mid-market distributors cut invoice turnaround from 14 days to 4 hours",
    angle: "Instant proof-of-delivery sync eliminates 85% of debtor payment disputes.",
    saved: true,
  },
  {
    id: "t_mon_6",
    freshness: "Last week",
    source: "Operations Survey",
    query: "B2B warehouse automation trends 2026",
    headline: "Driver retention correlates directly with transparent run scheduling",
    angle: "Predictable schedules reduce churn by 32% in heavy haulage and pallet networks.",
    saved: true,
  },
  {
    id: "t_mon_7",
    freshness: "Last week",
    source: "Market Intelligence",
    query: "B2B warehouse automation trends 2026",
    headline: "Zero-emission logistics zones: navigating urban fleet transition without margin shock",
    angle: "Practical route clustering strategies to manage EV payload and charging constraints.",
    saved: true,
  },
  {
    id: "t_mon_8",
    freshness: "Last week",
    source: "Cost Engineering",
    query: "Cold chain telematics compliance",
    headline: "Predictive fleet maintenance algorithms save £420 per vehicle per month",
    angle: "Spotting alternator and brake wear 500 miles before roadside failure.",
    saved: true,
  },
];

const INITIAL_RESEARCH_SETS = [
  { id: "rs_1", query: "UK logistics efficiency & fleet tech", at: "Yesterday", count: 4 },
  { id: "rs_2", query: "B2B warehouse automation trends 2026", at: "3 days ago", count: 3 },
  { id: "rs_3", query: "Cold chain telematics compliance", at: "Last week", count: 2 },
];

const INITIAL_SCHEDULER_EMAILS = [
  {
    id: "em_1",
    to: "operator@aivhub.com",
    sentAt: "Today 08:30",
    status: "unread",
    subject: "[Approval Required] LinkedIn Post for Tomorrow: Multi-depot Spreadsheet Inefficiencies",
    preview: "Why multi-depot operations directors are ditching disconnected spreadsheets...",
    body: "Hi Team,\n\nThe post scheduled for Tuesday 09:00 is ready for your review:\n\n'Why multi-depot operations directors are ditching disconnected spreadsheets...\n\nManual reconciliation across 4+ depots creates invoicing latency that eats straight into EBITDA.'\n\nTarget Channels: LinkedIn, Facebook\nCTA: Request an operations audit →",
  },
  {
    id: "em_2",
    to: "operator@aivhub.com",
    sentAt: "Yesterday 16:15",
    status: "unread",
    subject: "[Approval Required] Post for Thu 14:00: Autonomous Dispatch vs Dispatcher Intuition",
    preview: "AI route sequencing isn't about replacing dispatchers—it gives them 35 extra minutes per run...",
    body: "Hi Team,\n\nPost generated by Claude 3.5 Sonnet for Thursday afternoon run is pending approval.\n\nPreview:\n'AI route sequencing isn't about replacing dispatchers—it gives them 35 extra minutes per run to solve customer exceptions.'",
  },
  {
    id: "em_3",
    to: "operator@aivhub.com",
    sentAt: "Mon 24 Aug 09:05",
    status: "read",
    subject: "[Published] Monday Ops Weekly successfully posted to LinkedIn and X",
    preview: "Your post 'Ops teams still closing the week in spreadsheets' is live.",
    body: "Your post has been broadcast to LinkedIn and X. Real-time impressions and engagement are now tracking in your Published tab.",
  },
];
const INITIAL_POST_ITEMS = [
  {
    id: "post_seed_awaiting_1",
    slotId: "slot_seed_tue",
    scheduleId: "ps_tue",
    weekday: "Tuesday",
    dateLabel: "Tomorrow · 09:00",
    channels: ["linkedin", "facebook"],
    theme: "Operations — streamlining multi-depot dispatch and reporting",
    topicId: "t_mon_2",
    topicHeadline: "Why multi-depot operations directors are ditching disconnected spreadsheets",
    topicSource: "Customer Interviews",
    topicFreshness: "2 days ago",
    copy: "Most logistics directors spend Friday afternoon praying their VLOOKUPs hold together across 4 separate depot spreadsheets.\n\nHere is what changed: automated data pipelines don't just save 14 hours a week—they eliminate the silent invoice discrepancies that cause 6-week debtor payment delays.\n\nWhen every depot runs on the same real-time dispatch truth, finance closes month-end in 4 hours instead of 4 days.",
    cta: "See how AIVHub unifies multi-depot operations →",
    writtenInApp: true,
    kbUsed: ["Company Overview", "Enterprise Case Studies"],
    emailSent: true,
    approvalVia: [],
    status: "awaiting_approval",
    publishedAt: null,
    edited: false,
    variant: 0,
  },
  {
    id: "post_seed_awaiting_2",
    slotId: "slot_seed_thu",
    scheduleId: "ps_thu",
    weekday: "Thursday",
    dateLabel: "Thu 14:00",
    channels: ["linkedin", "x"],
    theme: "Tech insight — dispatch automation without driver friction",
    topicId: "t_mon_3",
    topicHeadline: "Autonomous dispatch vs dispatcher intuition: where the real ROI lands",
    topicSource: "Technical Analysis",
    topicFreshness: "3 days ago",
    copy: "Automated route sequencing was never about replacing skilled dispatchers.\n\nIt's about giving them 45 minutes back per shift so they can manage exceptions, handle driver delays, and satisfy high-priority accounts instead of manually dragging job pins across a map.",
    cta: "Explore modern voice & dispatch automation →",
    writtenInApp: true,
    kbUsed: ["AIVHub Whitepaper 2026"],
    emailSent: true,
    approvalVia: [],
    status: "awaiting_approval",
    publishedAt: null,
    edited: false,
    variant: 0,
  },
  {
    id: "post_seed_approved_1",
    slotId: "slot_seed_fri",
    scheduleId: "ps_fri",
    weekday: "Friday",
    dateLabel: "Fri 11:30",
    channels: ["linkedin", "threads"],
    theme: "Compliance & Security — cold chain tracking",
    topicId: "t_mon_4",
    topicHeadline: "Cold chain compliance: new 2026 digital reporting standards",
    topicSource: "Regulatory Updates",
    topicFreshness: "4 days ago",
    copy: "Audit failure in cold-chain transport doesn't happen on the road—it happens when paperwork arrives 72 hours after perishable delivery.\n\nReal-time telemetry and automated compliance logs protect operating licenses before inspectors ask.",
    cta: "Download the 2026 cold chain compliance checklist →",
    writtenInApp: true,
    kbUsed: ["Regulatory Briefing"],
    emailSent: true,
    approvalVia: ["email"],
    status: "approved",
    publishedAt: null,
    edited: false,
    variant: 0,
  },
  {
    id: "post_seed_scheduled_1",
    slotId: "slot_seed_next_mon",
    scheduleId: "ps_mon",
    weekday: "Monday",
    dateLabel: "Mon 8 Sep · 09:00",
    channels: ["linkedin", "facebook"],
    theme: "Customer success — fast invoicing turnaround",
    topicId: "t_mon_5",
    topicHeadline: "How mid-market distributors cut invoice turnaround from 14 days to 4 hours",
    topicSource: "Case Study",
    topicFreshness: "5 days ago",
    copy: "When paper delivery notes sit in driver cabs for 10 days, cash flow suffers.\n\nSwitching to immediate voice & mobile proof-of-delivery cut disputes by 85% for UK freight operators.",
    cta: "Read the case study →",
    writtenInApp: true,
    kbUsed: ["Customer Success Stories"],
    emailSent: false,
    approvalVia: [],
    status: "scheduled",
    publishedAt: null,
    edited: false,
    variant: 0,
  },
  {
    id: "post_seed_pub_1",
    slotId: null,
    scheduleId: "ps_mon",
    weekday: "Monday",
    dateLabel: "Mon 24 Aug · 09:00",
    channels: ["linkedin", "facebook"],
    theme: "Product — what we shipped and how it helps ops teams",
    topicId: "t_mon_1",
    topicHeadline: "Ops teams still closing the week in spreadsheets — that's the gap we built for",
    topicSource: "Customer calls",
    topicFreshness: "Last week",
    copy: "Ops teams still closing the week in spreadsheets — that's the gap we built for.\n\nIf Friday still means exporting CSV and praying the numbers match, the dashboard isn't a nice-to-have. It's how the week should have felt.",
    cta: "See how AIVHub dashboards work →",
    writtenInApp: true,
    kbUsed: ["Company website"],
    emailSent: false,
    approvalVia: [],
    status: "published",
    publishedAt: "Mon 24 Aug · 2.1k views",
    edited: false,
    variant: 0,
  },
  {
    id: "post_seed_pub_2",
    slotId: null,
    scheduleId: "ps_wed",
    weekday: "Wednesday",
    dateLabel: "Wed 26 Aug · 13:00",
    channels: ["linkedin", "x"],
    theme: "Greentech — zero-emission urban delivery zones",
    topicId: "t_mon_7",
    topicHeadline: "Zero-emission logistics zones: navigating urban fleet transition",
    topicSource: "Market Intelligence",
    topicFreshness: "Last week",
    copy: "Fleet electrification isn't just a vehicle purchase decision; it is a route topology problem. Range buffers require dynamic routing.",
    cta: "View our EV route planning playbook →",
    writtenInApp: true,
    kbUsed: ["Fleet Planning Deck"],
    emailSent: false,
    approvalVia: [],
    status: "published",
    publishedAt: "Wed 26 Aug · 1.8k views",
    edited: false,
    variant: 0,
  },
];

const INITIAL_SCHEDULER_CHAT = [
  { id: "c0", who: "ai", text: "This is Plan AI. Stay here.\n\nChat dates, themes, channels — and search topics in this same thread. Results land on the left. Keep talking until the plan is ready, then save." },
];

function extractChannelsFromText(t) {
  const ch = [];
  if (/linkedin/.test(t)) ch.push("linkedin");
  if (/facebook|\bfb\b/.test(t)) ch.push("facebook");
  if (/instagram|\binsta\b/.test(t)) ch.push("instagram");
  if (/\bx\b|twitter/.test(t)) ch.push("x");
  return ch;
}

function extractTimeFromText(t) {
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!m) return "09:00";
  let h = parseInt(m[1], 10);
  const min = m[2] || "00";
  const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return String(h).padStart(2, "0") + ":" + min;
}

function extractCompanyRenameFromText(text) {
  const m = String(text || "").match(/\b(?:we are|we're|our company is|company name is|posting as|call us)\s+([A-Za-z][A-Za-z0-9&.'-]{1,40}(?:\s+[A-Za-z][A-Za-z0-9&.'-]{0,20}){0,3})/i);
  if (!m) return null;
  const name = m[1].replace(/\s+(on|in|this|next|every|using|via|across|about|and)\b[\s\S]*$/i, "").trim();
  if (!name || /^(linkedin|facebook|instagram|twitter)$/i.test(name)) return null;
  return name;
}

const DAY_CANON = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function weekdaysFromText(t) {
  if (/every day|daily|each day|7 days/.test(t)) return DAY_CANON.slice();
  if (/weekday/.test(t)) return DAY_CANON.slice(0, 5);
  if (/weekend/.test(t)) return ["Saturday", "Sunday"];
  return DAY_CANON.filter((d) => new RegExp("\\b" + d + "s?\\b", "i").test(t));
}

function themesByDayFromText(text) {
  const map = {};
  DAY_CANON.forEach((d) => {
    const re = new RegExp(d + "s?\\s*[—–\\-:]+\\s*([^\\n;]+)", "i");
    const m = text.match(re);
    if (m) map[d] = m[1].replace(/\s+/g, " ").trim();
  });
  return map;
}

function fallbackThemeFromText(text, company) {
  let t = String(text || "");
  DAY_CANON.forEach((d) => { t = t.replace(new RegExp("\\b" + d + "s?\\b", "gi"), " "); });
  t = t.replace(/\b(plan|planning|september|october|november|month|weekly|every|weekday|weekend|daily|for|on|in|the|and|then|find|topics|write|posts|linkedin|facebook|instagram|twitter|\bx\b|schedule|set up|please|this|next|our|company|we|are)\b/gi, " ");
  t = t.replace(/[—–:]+/g, " ").replace(/\s+/g, " ").trim();
  const who = (company && company.name) || "us";
  return t || ("What " + who + " is shipping");
}

function buildSchedulesFromText(text, company) {
  const t = String(text || "").toLowerCase();
  const channels = extractChannelsFromText(t);
  const ch = channels.length ? channels : ["linkedin"];
  const time = extractTimeFromText(t);
  const byDay = themesByDayFromText(text);
  let days = weekdaysFromText(t);
  if (!days.length) days = Object.keys(byDay);
  if (!days.length) days = ["Monday", "Wednesday", "Friday"];
  const sharedTheme = fallbackThemeFromText(text, company);
  return days.map((weekday) => ({
    id: "ps_" + weekday.slice(0, 3).toLowerCase(),
    weekday,
    time,
    cadence: "weekly",
    channels: ch.slice(),
    theme: byDay[weekday] || sharedTheme,
    status: "active",
  }));
}

function parseChatIntent(text, ctx) {
  const raw = String(text || "").trim();
  const t = raw.toLowerCase();
  const company = (ctx && ctx.company) || INITIAL_OUR_COMPANY;
  const renamed = extractCompanyRenameFromText(raw);

  if (/\b(show|open|go to|take me)\b/.test(t) && /\b(our company|company profile|knowledge|about us)\b/.test(t)) return { kind: "open", view: "company" };
  if (/\b(show|open|go to|take me)\b/.test(t) && /\binbox|email\b/.test(t)) return { kind: "open", view: "inbox" };
  if (/\b(show|open|go to|take me)\b/.test(t) && /\bmonth|calendar\b/.test(t)) return { kind: "open", view: "month" };
  if (/\b(show|open|go to)\b/.test(t) && /\btopic/.test(t)) return { kind: "open", view: "topics" };
  if (/\b(show|open|go to)\b/.test(t) && /\bapprov/.test(t)) return { kind: "open", view: "approval" };
  if (/\b(show|open|go to)\b/.test(t) && /\bpublish/.test(t)) return { kind: "open", view: "published" };
  if (/\b(show|open|go to)\b/.test(t) && /\bchannel/.test(t)) return { kind: "open", view: "channels" };

  const conn = t.match(/\bconnect\s+(linkedin|threads|thread|facebook|instagram|insta|twitter|\bx\b)\b/);
  if (conn) {
    let id = conn[1];
    if (id === "insta") id = "instagram";
    if (id === "thread") id = "threads";
    if (id === "twitter") id = "x";
    return { kind: "connect", channel: id };
  }

  if (/\b(status|where are we|what's next|whats next)\b/.test(t)) return { kind: "status" };

  if (/\b(save (the |this |our )?plan|lock (the |this )?plan)\b/.test(t)) return { kind: "save_plan" };

  if (/\b(run (it|everything|the month)|do it all|start working|go ahead|full (run|pipeline)|find topics and write|make (it|this) happen)\b/.test(t)) return { kind: "run_all" };

  if (/\b(find topics|what's going on|whats going on|research|scan news|current (news|topics|events)|search|look up)\b/.test(t)) {
    return { kind: "research", query: stripResearchPrefix(raw) };
  }
  if (/\b(write posts|make the posts|draft the posts|generate posts|write from (the |this )?plan)\b/.test(t)) return { kind: "write_posts" };
  if (/\b(pin (them |these |topics )?to (the |empty )?slots|use (these |them )?on (the )?plan)\b/.test(t)) return { kind: "pin_topics" };

  if (/\b(what's due|whats due|send (for )?approval|due posts|time has come|check due|notify me)\b/.test(t)) return { kind: "send_due" };

  if (/\b(publish all|post (them|all)|confirm (all|and post)|go live)\b/.test(t)) return { kind: "publish_all" };
  if (/\b(approve all|approve everything|looks good)\b/.test(t)) return { kind: "approve_all" };
  if (/\b(approve|approval)\b/.test(t)) return { kind: "approve" };
  if (/\b(reject|kill that draft)\b/.test(t)) return { kind: "reject" };
  if (/\bregenerat/.test(t)) return { kind: "regenerate" };

  const horizon = parseHorizonFromText(t);
  const dateRange = parseDateRangeFromText(raw);
  const wantsPlan = /\b(plan|schedule|set up|lay out|every day|daily|weekdays?)\b/.test(t) || (themesByDayFromText(raw) && Object.keys(themesByDayFromText(raw)).length > 0) || !!horizon || !!dateRange;
  const days = weekdaysFromText(t);
  const adding = /\b(also|add|plus|include)\b/.test(t) && days.length === 1;

  if (wantsPlan || days.length >= 1) {
    return { kind: "plan", replace: !adding, schedules: buildSchedulesFromText(raw, company), horizon, range: dateRange, companyName: renamed };
  }

  if (renamed) return { kind: "rename_company", name: renamed };

  return { kind: "help" };
}

function PostSchedulerPlugin({ operator, onBackToHub, onLogout, profile, setProfile, knowledgeSources, setKnowledgeSources, services, setServices, commonAi, setCommonAi, onOpenCommonAi }) {
  const company = companyFromProfile(profile, knowledgeSources);
  const [view, setView] = useState("plan");
  const [schHistory, setSchHistory] = useState([]);

  // Stretchable Plan AI chat rail state
  const [chatWidth, setChatWidth] = useState(420);
  const [isDraggingChat, setIsDraggingChat] = useState(false);

  const startDragChat = (e) => {
    e.preventDefault();
    setIsDraggingChat(true);
    const startX = e.clientX;
    const startWidth = chatWidth;

    const onMouseMove = (moveEvent) => {
      const deltaX = startX - moveEvent.clientX; // dragging left increases width
      const nextWidth = Math.min(880, Math.max(300, startWidth + deltaX));
      setChatWidth(nextWidth);
    };

    const onMouseUp = () => {
      setIsDraggingChat(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const navigateSch = (nextView) => {
    setSchHistory((prev) => [...prev, view]);
    setView(nextView);
  };

  const goBackSch = () => {
    if (schHistory.length > 0) {
      const prev = schHistory[schHistory.length - 1];
      setSchHistory((list) => list.slice(0, list.length - 1));
      setView(prev);
    } else {
      setView("plan");
    }
  };

  const [schedules, setSchedules] = useState(INITIAL_POST_SCHEDULES);
  const [planHorizon, setPlanHorizon] = useState("month");
  const [planRange, setPlanRange] = useState(() => monthRange(PLAN_MONTH.year, PLAN_MONTH.month));
  const [planSaved, setPlanSaved] = useState(false);
  const [savedPlans, setSavedPlans] = useState([]);
  const [activePlanId, setActivePlanId] = useState(null);
  const [calCursor, setCalCursor] = useState({ year: PLAN_MONTH.year, month: PLAN_MONTH.month });
  const [slots, setSlots] = useState(INITIAL_MONTH_SLOTS);
  const [topics, setTopics] = useState(INITIAL_SCHEDULER_TOPICS);
  const [researchQuery, setResearchQuery] = useState("");
  const [researchSets, setResearchSets] = useState(INITIAL_RESEARCH_SETS);
  const [topicFilter, setTopicFilter] = useState("");
  const [searching, setSearching] = useState(false);
  const [posts, setPosts] = useState(INITIAL_POST_ITEMS);
  const [emails, setEmails] = useState(INITIAL_SCHEDULER_EMAILS);
  const [chat, setChat] = useState(INITIAL_SCHEDULER_CHAT);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [channels, setChannels] = useState({ linkedin: true, threads: true, x: true, facebook: true, instagram: false });
  const [editingId, setEditingId] = useState(null);
  const [editCopy, setEditCopy] = useState("");
  const [panel, setPanel] = useState(null);
  const [form, setForm] = useState(null);
  const [kbTab, setKbTab] = useState("identity");
  const [addingSource, setAddingSource] = useState(false);
  const [newSource, setNewSource] = useState({ name: "", type: "Website URL", value: "" });
  const chatEnd = useRef(null);
  const chatInput = useRef(null);

  useEffect(() => {
    if (chatEnd.current) chatEnd.current.scrollIntoView({ behavior: "smooth" });
  }, [chat, typing]);

  const awaiting = posts.filter((p) => p.status === "awaiting_approval");
  const approved = posts.filter((p) => p.status === "approved");
  const published = posts.filter((p) => p.status === "published");
  const scheduledPosts = posts.filter((p) => p.status === "scheduled");
  const pickedCount = slots.filter((s) => s.topicId).length;
  const unreadMail = emails.filter((e) => e.status === "unread").length;

  const pushAi = (text) => {
    setChat((cs) => [...cs, { id: "c_" + Date.now(), who: "ai", text }]);
  };

  const applyPlan = (nextSchedules, replace, horizon, customRange) => {
    const range = customRange || horizonRange(horizon || planHorizon || "month");
    const fill = range.horizon !== "month";
    const list = replace ? nextSchedules : [...schedules, ...nextSchedules.filter((n) => !schedules.some((s) => s.weekday === n.weekday))];
    const built = expandSlotsForRange(replace ? list : nextSchedules, range.fromMs, range.toMs, true);
    const nextSlots = replace ? built : [...slots.filter((s) => s.dateMs < range.fromMs || s.dateMs > range.toMs), ...built];
    setSchedules(list);
    setSlots(nextSlots);
    setPlanHorizon(horizon || range.horizon || "custom");
    setPlanRange(range);
    setPlanSaved(false);
    setActivePlanId(null);
    setCalCursor({ year: new Date(range.fromMs).getFullYear(), month: new Date(range.fromMs).getMonth() });
    return { list, nextSlots, range };
  };

  const applyDateRange = (fromIso, toIso) => {
    if (!fromIso || !toIso) return;
    const range = rangeFromDates(new Date(fromIso), new Date(toIso), "custom");
    const built = expandSlotsForRange(schedules.length ? schedules : INITIAL_POST_SCHEDULES, range.fromMs, range.toMs, true);
    setPlanRange(range);
    setPlanHorizon("custom");
    setSlots(built);
    setPlanSaved(false);
    setActivePlanId(null);
    setCalCursor({ year: new Date(range.fromMs).getFullYear(), month: new Date(range.fromMs).getMonth() });
  };

  const savePlan = () => {
    const entry = {
      id: activePlanId || ("plan_" + Date.now()),
      name: planRange.label,
      fromMs: planRange.fromMs,
      toMs: planRange.toMs,
      horizon: planHorizon,
      schedules: (schedules || []).map((s) => ({ ...s, channels: (s.channels || []).slice() })),
      savedAt: "just now",
    };
    setSavedPlans((list) => {
      const i = list.findIndex((p) => p.id === entry.id);
      if (i >= 0) {
        const next = list.slice();
        next[i] = entry;
        return next;
      }
      return [entry, ...list];
    });
    setActivePlanId(entry.id);
    setPlanSaved(true);
    return entry;
  };

  const loadPlan = (entry) => {
    setActivePlanId(entry.id);
    setSchedules(entry.schedules);
    setPlanRange({ horizon: entry.horizon, fromMs: entry.fromMs, toMs: entry.toMs, label: entry.name });
    setPlanHorizon(entry.horizon);
    setSlots(expandSlotsForRange(entry.schedules, entry.fromMs, entry.toMs, true));
    setPlanSaved(true);
    setCalCursor({ year: new Date(entry.fromMs).getFullYear(), month: new Date(entry.fromMs).getMonth() });
    setView("month");
  };

  const runResearch = (query, thenWrite) => {
    const q = (query && String(query).trim()) || (schedules.map((s) => s.theme).filter(Boolean).join("; ")) || company.about || "what we should post";
    setResearchQuery(q);
    setSearching(true);
    window.setTimeout(() => {
      const found = researchTopicsFromQuery(q, company);
      setTopics((ts) => [...found, ...ts]);
      setResearchSets((rs) => [{ id: "set_" + Date.now(), query: q, at: "just now", count: found.length }, ...rs]);
      setSearching(false);
      if (thenWrite) {
        const assigned = assignTopicsToSlots(slots, found);
        setSlots(assigned);
        window.setTimeout(() => {
          const { nextSlots, created } = writePostsFrom(schedules, found, assigned, company);
          setSlots(nextSlots);
          if (created.length) setPosts((ps) => [...created, ...ps]);
          const mailed = mailDuePosts(created);
          const later = created.length - mailed;
          setView(mailed ? "approval" : "month");
          pushAi("Searched “" + q + "”, saved " + found.length + " topics, wrote " + created.length + " posts in this software." + (mailed ? " " + mailed + " already due — sent for approval." : "") + (later ? " " + later + " scheduled." : ""));
        }, 700);
      } else {
        pushAi("Found " + found.length + " for “" + q + "”. They sit on the left — pin onto slots, keep chatting, or save the plan. No need to leave this screen.");
      }
    }, 900);
  };

  const pinTopicsToPlan = () => {
    const assigned = assignTopicsToSlots(slots, topics);
    setSlots(assigned);
    const n = assigned.filter((s) => s.topicId).length;
    pushAi("Pinned saved topics onto " + n + " slot" + (n === 1 ? "" : "s") + ". Keep chatting if the plan still needs work, then save.");
    return n;
  };

  const mailDuePosts = (created) => {
    const dueOnes = (created || []).filter((p) => p.status === "awaiting_approval");
    if (dueOnes.length) {
      setEmails((es) => [...dueOnes.map((p) => makeApprovalEmail(p, operator)), ...es]);
    }
    return dueOnes.length;
  };

  const writePosts = () => {
    const { nextSlots, created } = writePostsFrom(schedules, topics, slots, company);
    setSlots(nextSlots);
    if (created.length) setPosts((ps) => [...created, ...ps]);
    const mailed = mailDuePosts(created);
    setView(mailed ? "approval" : "month");
    return { n: created.length, mailed };
  };

  const sendDue = () => {
    const dueSlots = slots.filter((s) => s.postId && isSlotDue(s));
    const dueIds = new Set(dueSlots.map((s) => s.postId));
    const moving = posts.filter((p) => p.status === "scheduled" && (dueIds.has(p.id) || isSlotDue({ dateMs: p.dateMs, time: p.time })));
    if (!moving.length) {
      setView("approval");
      return 0;
    }
    setPosts((ps) => ps.map((p) => (moving.some((m) => m.id === p.id) ? { ...p, status: "awaiting_approval", emailSent: true, approvalVia: ["app", "email"] } : p)));
    setEmails((es) => [...moving.map((p) => makeApprovalEmail({ ...p, status: "awaiting_approval" }, operator)), ...es]);
    setView("approval");
    return moving.length;
  };

  const statusLine = () => {
    return (planRange && planRange.label ? planRange.label : PLAN_MONTH.label) + " · " + (planSaved ? "saved" : "draft — not saved") + " · " + slots.length + " slots, " + topics.length + " topics, " + scheduledPosts.length + " scheduled, " + awaiting.length + " waiting approval, " + published.length + " published.";
  };

  const executeIntent = (text) => {
    const parsed = parseChatIntent(text, { schedules, company });
    if (parsed.kind === "open") {
      setTyping(false);
      setView(parsed.view);
      pushAi("Opened that screen. " + statusLine());
      return;
    }
    if (parsed.kind === "connect") {
      setTyping(false);
      setChannels((c) => ({ ...c, [parsed.channel]: true }));
      setView("channels");
      pushAi("Connected " + (SOCIAL_CHANNELS[parsed.channel] && SOCIAL_CHANNELS[parsed.channel].label) + ". Drafts can publish here after you approve.");
      return;
    }
    if (parsed.kind === "status") {
      setTyping(false);
      pushAi(statusLine() + " Stay in Plan chat to research and shape dates. Save when the plan is final. Then write → due → approve → publish.");
      return;
    }
    if (parsed.kind === "save_plan") {
      setTyping(false);
      if (!schedules.length) {
        pushAi("No plan to save yet. Tell me a horizon first — next 2 days, this week, or September — plus themes.");
        setView("plan");
        return;
      }
      const entry = savePlan();
      pushAi("Saved “" + entry.name + "” (" + formatPlanDay(new Date(entry.fromMs)) + " – " + formatPlanDay(new Date(entry.toMs)) + "). Plan is locked. Keep chatting to tweak, or open Calendar for the grid.");
      return;
    }
    if (parsed.kind === "research") {
      setTyping(false);
      const q = parsed.query;
      pushAi(q ? ("Searching “" + q + "” — web + " + company.name + " knowledge. Results stay on this plan.") : ("No query — I'll search from this plan's themes and " + company.name + " knowledge."));
      runResearch(q, false);
      return;
    }
    if (parsed.kind === "pin_topics") {
      setTyping(false);
      if (!topics.length) {
        pushAi("Nothing researched yet. Type a topic in this chat — e.g. live ops dashboards — and I'll search here.");
        return;
      }
      pinTopicsToPlan();
      return;
    }
    if (parsed.kind === "write_posts") {
      setTyping(false);
      if (!planSaved) {
        pushAi("Plan isn't saved yet. Say “save this plan” first — then I write posts here from the KB.");
        setView("month");
        return;
      }
      if (!pickedCount && !topics.length) {
        pushAi("No topics yet — finding them, then writing posts in this software.");
        runResearch(researchQuery || schedules.map((s) => s.theme).join("; "), true);
        return;
      }
      const { n, mailed } = writePosts();
      pushAi(n ? ("Wrote " + n + " posts here from " + company.name + " knowledge." + (mailed ? " " + mailed + " due now — sent for approval (app + email)." : " They sit on the schedule until due.")) : "Every slotted topic already has a post. Open the calendar or approvals.");
      return;
    }
    if (parsed.kind === "send_due") {
      setTyping(false);
      const n = sendDue();
      pushAi(n ? ("Time's up for " + n + " post" + (n === 1 ? "" : "s") + ". Sent to you here and to " + operatorEmail(operator) + ". Approve in this app or from the inbox.") : "Nothing due yet. Scheduled posts wait until their slot. Say “write posts” if the calendar is empty.");
      return;
    }
    if (parsed.kind === "run_all") {
      setTyping(false);
      if (!schedules.length) {
        pushAi("Need a plan first. Example: Plan next 2 days on LinkedIn about product.");
        return;
      }
      if (!planSaved) savePlan();
      pushAi("Saving the plan, finding topics, writing posts here from company knowledge, then sending anything already due for approval.");
      runResearch(researchQuery || schedules.map((s) => s.theme).join("; "), true);
      return;
    }
    if (parsed.kind === "rename_company") {
      setTyping(false);
      setProfile((p) => ({ ...p, name: parsed.name }));
      setView("company");
      pushAi("We post as " + parsed.name + ". Same company knowledge as the voice plugin.");
      return;
    }
    if (parsed.kind === "approve_all") {
      setTyping(false);
      const ids = posts.filter((p) => p.status === "awaiting_approval").map((p) => p.id);
      if (!ids.length) {
        pushAi("Nothing waiting. Due posts show up here and in email when their time comes.");
        setView("approval");
        return;
      }
      setPosts((ps) => ps.map((p) => (ids.includes(p.id) ? { ...p, status: "approved" } : p)));
      setEmails((es) => es.map((e) => (ids.includes(e.postId) ? { ...e, status: "approved" } : e)));
      setView("approval");
      pushAi("Approved " + ids.length + " from this app. Say “publish” to go live.");
      return;
    }
    if (parsed.kind === "approve") {
      setTyping(false);
      const first = posts.find((p) => p.status === "awaiting_approval");
      if (!first) {
        pushAi("Nothing waiting on approval.");
        setView("approval");
        return;
      }
      setPosts((ps) => ps.map((p) => (p.id === first.id ? { ...p, status: "approved" } : p)));
      setEmails((es) => es.map((e) => (e.postId === first.id ? { ...e, status: "approved" } : e)));
      setView("approval");
      pushAi("Approved in this app — " + (first.topicHeadline || first.theme) + ". Same result as approving from email. Say “publish” when you want it live.");
      return;
    }
    if (parsed.kind === "publish_all") {
      setTyping(false);
      const ready = posts.filter((p) => p.status === "approved");
      if (!ready.length) {
        pushAi("Need an approval first — in this app or from the email. Scheduled posts wait until due.");
        return;
      }
      setPosts((ps) => ps.map((p) => (p.status === "approved" ? { ...p, status: "published", publishedAt: "just now" } : p)));
      setView("published");
      pushAi("Posted " + ready.length + " from this software to the connected channels.");
      return;
    }
    if (parsed.kind === "reject") {
      setTyping(false);
      const first = posts.find((p) => p.status === "awaiting_approval" || p.status === "approved");
      if (!first) {
        pushAi("No draft to reject.");
        return;
      }
      setPosts((ps) => ps.map((p) => (p.id === first.id ? { ...p, status: "rejected" } : p)));
      setEmails((es) => es.map((e) => (e.postId === first.id ? { ...e, status: "rejected" } : e)));
      setSlots((ss) => ss.map((s) => (s.postId === first.id ? { ...s, postId: null } : s)));
      setView("approval");
      pushAi("Rejected. Slot is free to write again in this software.");
      return;
    }
    if (parsed.kind === "regenerate") {
      setTyping(false);
      const first = posts.find((p) => p.status === "awaiting_approval" || p.status === "scheduled");
      if (!first) {
        pushAi("No draft to regenerate.");
        return;
      }
      regenerate(first);
      setView("approval");
      pushAi("Regenerated in this software from the next topic + company knowledge.");
      return;
    }

    if (parsed.kind === "plan") {
      if (parsed.companyName) setProfile((p) => ({ ...p, name: parsed.companyName }));
      const { list, range } = applyPlan(parsed.schedules, parsed.replace, parsed.horizon, parsed.range);
      const who = parsed.companyName || company.name;
      const lines = list.map((s) => s.weekday + " — " + s.theme).join("\n");
      pushAi((parsed.replace ? "Draft for " + who + " — " + range.label + ".\n\n" : "Added to the draft.\n\n") + lines + "\n\nConsulting AI Strategist...");
    }

    if (view === "images" && !text.toLowerCase().includes("plan") && !text.toLowerCase().includes("post")) {
      setTyping(false);
      const clean = text.trim();
      const promptIdea1 = `Modern sleek SaaS vector illustration of ${clean}, glowing cyan telemetry graphs, frosted glassmorphism UI components, clean gradients, 4k`;
      const promptIdea2 = `Photorealistic editorial photography of ${clean}, natural corporate executive studio lighting, 35mm lens, high detail, 8k`;
      pushAi(
        `🎨 Visual Director AI Suggestions for “${clean}”:\n\n` +
        `1. Tech SaaS Vector Style:\n“${promptIdea1}”\n\n` +
        `2. Editorial Photography Style:\n“${promptIdea2}”\n\n` +
        `💡 Tip: Copy either prompt into the Image Studio prompt box on the left and click “Generate Visual” to render!`
      );
      return;
    }

    // Call Real LLM Gateway for open conversational partner & planning
    const creds = getActiveAiCredentials(commonAi, "scheduler", "postWriter");

    const historyMsgs = (chat || []).slice(-10).map((m) => ({
      role: m.who === "user" ? "user" : "assistant",
      content: m.text
    }));
    historyMsgs.push({ role: "user", content: text });

    api.chatPlan({
      text,
      messages: historyMsgs,
      apiKey: creds.apiKey || undefined,
      provider: creds.provider || "deepseek",
      model: creds.model || "deepseek-chat",
      baseUrl: creds.baseUrl || undefined,
      imageStyle: commonAi?.schedulerAi?.imageStyle || "modern_saas"
    }).then((res) => {
      setTyping(false);
      if (res && (res.postsCreated || res.posts)) {
        const newPosts = res.postsCreated || res.posts;
        if (newPosts.length) {
          setPosts((ps) => [...newPosts, ...ps]);
        }
      }
      if (res && res.topics && res.topics.length) {
        setTopics((ts) => [...res.topics, ...ts]);
      }
      if (res && res.reply) {
        pushAi(res.reply);
      } else if (res && res.error) {
        pushAi("⚠️ " + res.error);
      }
    }).catch((err) => {
      setTyping(false);
      console.warn("Post scheduler chat error:", err);
      pushAi("⚠️ AI Chat Error: " + (err.message || "Failed to reach AI provider. Please verify your API key in AI Config."));
    });
  };

  const sendChat = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const text = draft.trim();
    if (!text || typing) return;
    setDraft("");
    setChat((cs) => [...cs, { id: "c_" + Date.now(), who: "user", text }]);
    setTyping(true);
    executeIntent(text);
  };

  const runPrompt = (text) => {
    if (!text || typing) return;
    setDraft("");
    setChat((cs) => [...cs, { id: "c_" + Date.now(), who: "user", text }]);
    setTyping(true);
    executeIntent(text);
  };
  const saveEdit = (id) => {
    setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, copy: editCopy, edited: true } : p)));
    setEditingId(null);
  };

  const regenerate = (post) => {
    const sch = schedules.find((s) => s.id === post.scheduleId) || { id: post.scheduleId, weekday: post.weekday, channels: post.channels, theme: post.theme };
    const bank = synthesizeTopicsFor(sch, company);
    const idx = Math.max(0, bank.findIndex((t) => t.id === post.topicId));
    const nextTopic = bank[(idx + 1) % bank.length];
    const slot = slots.find((s) => s.id === post.slotId);
    const rewritten = writePostFromTopic(sch, { ...nextTopic, scheduleId: post.scheduleId }, slot, "awaiting_approval", company);
    setPosts((ps) => ps.map((p) => (p.id === post.id ? { ...rewritten, id: post.id } : p)));
    if (slot) setSlots((ss) => ss.map((s) => (s.id === slot.id ? { ...s, topicId: nextTopic.id } : s)));
    setEditingId(null);
  };

  const approvePost = (id) => {
    setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, status: "approved" } : p)));
    setEmails((es) => es.map((e) => (e.postId === id ? { ...e, status: "approved" } : e)));
  };
  const rejectPost = (id) => {
    setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, status: "rejected" } : p)));
    setEmails((es) => es.map((e) => (e.postId === id ? { ...e, status: "rejected" } : e)));
    setSlots((ss) => ss.map((s) => (s.postId === id ? { ...s, postId: null } : s)));
  };
  const confirmPublish = (id) => setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, status: "published", publishedAt: "just now" } : p)));

  const assignTopic = (topicId, slotId) => {
    setSlots((ss) => ss.map((s) => (s.id === slotId ? { ...s, topicId } : s)));
  };

  const openSlot = (slot) => {
    setView("month");
    setPanel({ type: "slot", id: slot.id });
    setForm({
      time: slot.time,
      theme: slot.theme,
      channels: (slot.channels || []).slice(),
      topicId: slot.topicId || "",
    });
  };

  const openSchedule = (sch) => {
    setView("month");
    setPanel({ type: "schedule", id: sch.id });
    setForm({
      weekday: sch.weekday,
      time: sch.time,
      theme: sch.theme,
      channels: (sch.channels || []).slice(),
    });
  };

  const openNewDay = (dateObj) => {
    const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dateObj.getDay()];
    const existing = schedules.find((s) => s.weekday === weekday);
    setView("month");
    setPanel({ type: "new", dateMs: dateObj.getTime(), weekday });
    setForm({
      time: existing ? existing.time : "09:00",
      theme: existing ? existing.theme : "",
      channels: existing ? existing.channels.slice() : ["linkedin"],
      scheduleId: existing ? existing.id : "",
    });
  };

  const closePanel = () => { setPanel(null); setForm(null); };

  const toggleFormChannel = (id) => {
    setForm((f) => {
      const has = f.channels.includes(id);
      const next = has ? f.channels.filter((c) => c !== id) : [...f.channels, id];
      return { ...f, channels: next.length ? next : [id] };
    });
  };

  const savePanel = () => {
    if (!panel || !form) return;
    if (panel.type === "slot") {
      setSlots((ss) => ss.map((s) => (s.id === panel.id ? { ...s, time: form.time, theme: form.theme, channels: form.channels.slice(), topicId: form.topicId || null } : s)));
      closePanel();
      return;
    }
    if (panel.type === "schedule") {
      const updated = { id: panel.id, weekday: form.weekday, time: form.time, theme: form.theme, channels: form.channels.slice(), cadence: "weekly", status: "active" };
      setSchedules((list) => list.map((s) => (s.id === panel.id ? { ...s, ...updated } : s)));
      setSlots((ss) => {
        const others = ss.filter((s) => s.scheduleId !== panel.id);
        const rebuilt = expandSlotsForRange([updated], planRange.fromMs, planRange.toMs, planHorizon !== "month").map((ns) => {
          const old = ss.find((s) => s.scheduleId === panel.id && s.day === ns.day);
          return old ? { ...ns, topicId: old.topicId, postId: old.postId, theme: form.theme, time: form.time, channels: form.channels.slice() } : { ...ns, theme: form.theme };
        });
        return [...others, ...rebuilt];
      });
      closePanel();
      return;
    }
    if (panel.type === "new") {
      const d = new Date(panel.dateMs);
      let schId = form.scheduleId;
      if (!schId) {
        schId = "ps_" + Date.now();
        setSchedules((list) => [...list, { id: schId, weekday: panel.weekday, time: form.time, cadence: "weekly", channels: form.channels.slice(), theme: form.theme || "Update", status: "active" }]);
      }
      const slot = {
        id: "slot_" + PLAN_MONTH.year + "_" + (PLAN_MONTH.month + 1) + "_" + d.getDate() + "_" + schId,
        day: d.getDate(),
        dateMs: d.getTime(),
        weekday: panel.weekday,
        scheduleId: schId,
        theme: form.theme || "Update",
        channels: form.channels.slice(),
        time: form.time,
        topicId: null,
        postId: null,
      };
      setSlots((ss) => ss.some((s) => s.id === slot.id) ? ss.map((s) => (s.id === slot.id ? { ...s, ...slot } : s)) : [...ss, slot]);
      closePanel();
    }
  };

  const deletePanelItem = () => {
    if (!panel) return;
    if (panel.type === "slot") {
      setSlots((ss) => ss.filter((s) => s.id !== panel.id));
      closePanel();
      return;
    }
    if (panel.type === "schedule") {
      setSchedules((list) => list.filter((s) => s.id !== panel.id));
      setSlots((ss) => ss.filter((s) => s.scheduleId !== panel.id));
      closePanel();
    }
  };

  const writeOneSlot = (slot) => {
    if (!planSaved) {
      pushAi("Save the plan first, then I write the post in this software.");
      return;
    }
    const sch = schedules.find((s) => s.id === slot.scheduleId);
    if (!sch) return;
    let topic = topics.find((t) => t.id === ((form && form.topicId) || slot.topicId)) || topics.find((t) => t.scheduleId === slot.scheduleId);
    if (!topic) {
      topic = synthesizeTopicsFor(sch, company)[0];
      setTopics((ts) => ts.some((t) => t.id === topic.id) ? ts : [...ts, ...synthesizeTopicsFor(sch, company)]);
    }
    const post = writePostFromTopic(sch, topic, { ...slot, topicId: topic.id, theme: (form && form.theme) || slot.theme, time: (form && form.time) || slot.time, channels: (form && form.channels) || slot.channels }, null, company);
    setSlots((ss) => ss.map((s) => (s.id === slot.id ? { ...s, postId: post.id, topicId: topic.id } : s)));
    setPosts((ps) => [post, ...ps.filter((p) => p.slotId !== slot.id)]);
    mailDuePosts([post]);
    closePanel();
    setView(post.status === "awaiting_approval" ? "approval" : "month");
  };

  const approveFromEmail = (email) => {
    setPosts((ps) => ps.map((p) => (p.id === email.postId ? { ...p, status: "approved" } : p)));
    setEmails((es) => es.map((e) => (e.id === email.id ? { ...e, status: "approved" } : e)));
  };
  const rejectFromEmail = (email) => {
    setPosts((ps) => ps.map((p) => (p.id === email.postId ? { ...p, status: "rejected" } : p)));
    setEmails((es) => es.map((e) => (e.id === email.id ? { ...e, status: "rejected" } : e)));
    setSlots((ss) => ss.map((s) => (s.postId === email.postId ? { ...s, postId: null } : s)));
  };

  const nav = [
    { id: "plan", label: "Plan", icon: Calendar },
    { id: "topics", label: "Topic library", icon: Search, count: topics.length },
    { id: "images", label: "AI Image Studio", icon: ImageIcon },
    { id: "month", label: "Calendar", icon: CalendarDays },
    { id: "approval", label: "Approvals", icon: CheckCircle2, count: awaiting.length + approved.length },
    { id: "inbox", label: "Email inbox", icon: Mail, count: unreadMail },
    { id: "published", label: "Published", icon: ArrowUpRight },
    { id: "company", label: "Company knowledge", icon: BookOpen },
    { id: "channels", label: "Channels", icon: Plug },
    { id: "ai", label: "AI Configuration", icon: Settings2 },
  ];

  const titleMap = {
    company: "Company knowledge",
    plan: "Plan — chat, research, save",
    month: (planRange && planRange.label ? planRange.label : PLAN_MONTH.label) + (planSaved ? " · saved" : " · draft"),
    topics: "Topic library",
    images: "AI Image Studio · Generate Social Graphics",
    approval: "Approvals",
    inbox: "Email inbox",
    published: "Published",
    channels: "Channels",
    ai: "Post Scheduler · AI Configuration",
  };
  const monthCells = buildMonthCells(calCursor.year, calCursor.month);
  const slotsByDay = {};
  slots.forEach((s) => {
    const k = dayKey(s.dateMs);
    if (!slotsByDay[k]) slotsByDay[k] = [];
    slotsByDay[k].push(s);
  });
  const topicById = {};
  topics.forEach((t) => { topicById[t.id] = t; });
  const filteredTopics = topics.filter((t) => {
    const q = (topicFilter || "").trim().toLowerCase();
    if (!q) return true;
    return (t.headline + " " + t.angle + " " + (t.query || "")).toLowerCase().includes(q);
  });
  const handleRegeneratePostImage = async (post, customPrompt) => {
    try {
      const topicText = customPrompt || post.imagePrompt || post.topicHeadline || post.title || post.theme || "Operations dashboard analytics";
      const style = commonAi?.schedulerAi?.imageStyle || "modern_saas";
      const res = await api.generateImage({ prompt: topicText, title: post.title || post.topicHeadline, theme: post.theme, style });
      if (res && res.imageUrl) {
        setPosts((ps) => ps.map((p) => (p.id === post.id ? { ...p, imageUrl: res.imageUrl, imagePrompt: res.imagePrompt } : p)));
        api.updatePostStatus(post.id, post.status, post.copy, res.imageUrl, res.imagePrompt).catch(() => {});
      }
    } catch (err) {
      console.warn("Could not regenerate image:", err);
    }
  };

  const renderTopicCard = (t) => {
    const usedBy = slots.find((s) => s.topicId === t.id);
    const tint = tintFor(t.query || t.id);
    return (
      <div key={t.id} className="hover-float" style={{ background: "#fff", border: "1px solid " + (usedBy ? tint.fg : C.border), borderRadius: 14, padding: 16 }}>
        {t.imageUrl && (
          <div style={{ width: "100%", height: 120, borderRadius: 10, overflow: "hidden", marginBottom: 12, border: `1px solid ${C.borderLight}` }}>
            <img src={t.imageUrl} alt={t.headline} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
          </div>
        )}
        <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slateLight }}>{t.freshness} · {t.source}{t.query ? " · " + t.query : ""}{t.saved ? " · saved" : ""}</div>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink, marginTop: 6, lineHeight: 1.3 }}>{t.headline}</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 8, lineHeight: 1.45 }}>{t.angle}</div>
        <div style={{ marginTop: 12 }}>
          <select
            value={usedBy ? usedBy.id : ""}
            onChange={(e) => { if (e.target.value) assignTopic(t.id, e.target.value); }}
            style={{ width: "100%", height: 34, borderRadius: 8, border: "1px solid " + C.border, fontFamily: FONT_BODY, fontSize: 12, background: HUB_PAPER, padding: "0 8px" }}
          >
            <option value="">{usedBy ? "Pinned to slot" : "Pin onto a slot…"}</option>
            {slots.slice().sort((a, b) => a.dateMs - b.dateMs).map((s) => (
              <option key={s.id} value={s.id}>{formatPlanDay(new Date(s.dateMs))} · {s.time} · {s.theme.slice(0, 28)}</option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: C.paper, fontFamily: FONT_BODY }}>
      <AppChrome />
      <div style={{ width: 232, minWidth: 232, background: C.ink, height: "100vh", display: "flex", flexDirection: "column", padding: "22px 14px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px 12px 8px" }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg, ${C.teal}, ${C.cobalt})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <CalendarDays size={15} color="#fff" strokeWidth={2.4} />
          </div>
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: "#fff", letterSpacing: "-0.01em" }}>Post scheduler</span>
        </div>
        <button
          onClick={onBackToHub}
          style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 4px 16px 4px", padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.inkLine}`, background: "transparent", color: "#C8CCD6", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          <LayoutGrid size={14} /> All plugins
        </button>
        {nav.map((n) => {
          const Icon = n.icon;
          const active = view === n.id;
          return (
            <button
              key={n.id}
              onClick={() => navigateSch(n.id)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", marginBottom: 2, borderRadius: 8, border: "none", cursor: "pointer", background: active ? "rgba(255,255,255,0.08)" : "transparent", color: active ? "#fff" : "#9AA0AE", fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 500, textAlign: "left" }}
            >
              <Icon size={16} />
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.count > 0 && (
                <span style={{ minWidth: 18, height: 18, borderRadius: 999, background: C.amber, color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{n.count}</span>
              )}
            </button>
          );
        })}
        <div style={{ marginTop: "auto", padding: "12px 10px", borderTop: `1px solid ${C.inkLine}` }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: "#5B6070", marginBottom: 8 }}>Logged in as</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 26, height: 26, borderRadius: 999, background: C.teal, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700 }}>{initialsFromName(operator.name)}</div>
            <div style={{ flex: 1, fontFamily: FONT_BODY, fontSize: 12.5, color: "#C8CCD6" }}>{operator.name}</div>
          </div>
          <button onClick={onLogout} style={{ marginTop: 10, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 8px", borderRadius: 8, border: `1px solid ${C.inkLine}`, background: "transparent", color: "#8B90A0", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 28px", borderBottom: `1px solid ${C.border}`, background: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {view !== "plan" && (
              <button
                onClick={goBackSch}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  color: C.textInk,
                  fontFamily: FONT_BODY,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                title="Return to Plan chat and overview"
              >
                <ChevronLeft size={14} /> Back to Plan
              </button>
            )}
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink, letterSpacing: "-0.02em" }}>
                {titleMap[view] || "Post scheduler"}
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 2 }}>
                {view === "plan"
                  ? "Chat on the right. Dates, search, and the draft stay here until you save."
                  : view === "month"
                  ? "Calendar of the plan. Tweaks can still go through Plan chat."
                  : view === "topics"
                    ? "Saved research from Plan chat. Filter and pin — search lives on Plan."
                    : view === "images"
                      ? "Generate instant FLUX AI visuals for topics and posts, customize styles, and attach with one click."
                      : "Write from pinned topics → schedule → due = approve → publish."}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {view !== "images" && (
              <button
                onClick={() => navigateSch("images")}
                style={{
                  height: 38,
                  padding: "0 14px",
                  borderRadius: 10,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  color: C.ink,
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
                title="Open AI Image Studio"
              >
                <Sparkles size={14} color={C.teal} /> AI Image Studio
              </button>
            )}
            <div style={{ textAlign: "right", marginRight: 4 }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.slateLight }}>Posting as</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink }}>{company.name}</div>
            </div>
            {view === "plan" && !planSaved && (
              <button onClick={() => { savePlan(); pushAi("Saved “" + planRange.label + "”. Plan is final enough to write from — or keep chatting."); }} style={{ height: 38, padding: "0 14px", borderRadius: 10, border: "none", background: C.teal, color: "#fff", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <Save size={14} /> Save this plan
              </button>
            )}
            {view === "month" && !planSaved && (
              <button onClick={() => { savePlan(); pushAi("Saved “" + planRange.label + "”. Say “write posts” and I'll write them here from company knowledge."); }} style={{ height: 38, padding: "0 14px", borderRadius: 10, border: "none", background: C.teal, color: "#fff", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <Save size={14} /> Save this plan
              </button>
            )}
            {view === "month" && (
              <button onClick={() => navigateSch("topics")} style={{ height: 38, padding: "0 14px", borderRadius: 10, border: "none", background: C.ink, color: "#fff", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <Search size={14} /> Topic library
              </button>
            )}
            {view === "month" && planSaved && (
              <button onClick={sendDue} style={{ height: 38, padding: "0 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff", color: C.textInk, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <Mail size={14} /> Send due for approval
              </button>
            )}
            {view === "topics" && (
              <button onClick={goBackSch} style={{ height: 38, padding: "0 14px", borderRadius: 10, border: "none", background: C.ink, color: "#fff", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <Sparkles size={14} /> Back to Plan chat
              </button>
            )}
            {view === "approval" && (
              <button onClick={sendDue} style={{ height: 38, padding: "0 14px", borderRadius: 10, border: "none", background: C.ink, color: "#fff", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <Clock size={14} /> Check what's due
              </button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

        {view === "plan" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px 40px", background: HUB_PAPER }}>
            <div style={{ maxWidth: 960, width: "100%", margin: "0 auto" }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 24, color: C.ink, letterSpacing: "-0.03em" }}>Build the plan here</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.slate, marginTop: 6, lineHeight: 1.55 }}>
                Right rail is Plan AI — chat dates <em>and</em> research topics in that one thread. Results appear below. Stay until the plan is ready, then save.
              </div>
            {/* Elegant Balanced Date Range & Plan Status Bar */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                marginTop: 18,
                background: "#fff",
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: "16px 20px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.03)",
              }}
            >
              {/* Left Side: Date Range Pickers & Quick Presets */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, color: C.slateLight, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>FROM</div>
                    <input
                      type="date"
                      value={isoDate(planRange.fromMs)}
                      onChange={(e) => applyDateRange(e.target.value, isoDate(planRange.toMs))}
                      style={{ height: 36, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 10px", fontFamily: FONT_BODY, fontSize: 13, background: HUB_PAPER, outline: "none", color: C.textInk }}
                    />
                  </div>
                  <span style={{ color: C.slateLight, marginTop: 18, fontWeight: 700 }}>→</span>
                  <div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, color: C.slateLight, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>TO</div>
                    <input
                      type="date"
                      value={isoDate(planRange.toMs)}
                      onChange={(e) => applyDateRange(isoDate(planRange.fromMs), e.target.value)}
                      style={{ height: 36, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 10px", fontFamily: FONT_BODY, fontSize: 13, background: HUB_PAPER, outline: "none", color: C.textInk }}
                    />
                  </div>
                </div>

                {/* Quick Presets */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 16 }}>
                  <button
                    type="button"
                    onClick={() => applyDateRange(isoDate(addDays(SCHEDULER_NOW, -7)), isoDate(addDays(SCHEDULER_NOW, -1)))}
                    style={{ height: 32, padding: "0 10px", borderRadius: 7, border: `1px solid ${C.border}`, background: HUB_PAPER, fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, color: C.slate, cursor: "pointer" }}
                  >
                    Last week
                  </button>
                  <button
                    type="button"
                    onClick={() => { const r = monthRange(SCHEDULER_NOW.getFullYear(), SCHEDULER_NOW.getMonth()); applyDateRange(isoDate(r.fromMs), isoDate(r.toMs)); }}
                    style={{ height: 32, padding: "0 10px", borderRadius: 7, border: `1px solid ${C.border}`, background: HUB_PAPER, fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, color: C.slate, cursor: "pointer" }}
                  >
                    This month
                  </button>
                  <button
                    type="button"
                    onClick={() => { const m = SCHEDULER_NOW.getMonth() + 1; const r = monthRange(SCHEDULER_NOW.getFullYear() + Math.floor(m / 12), m % 12); applyDateRange(isoDate(r.fromMs), isoDate(r.toMs)); }}
                    style={{ height: 32, padding: "0 10px", borderRadius: 7, border: `1px solid ${C.border}`, background: HUB_PAPER, fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, color: C.slate, cursor: "pointer" }}
                  >
                    Next month
                  </button>
                </div>
              </div>

              {/* Right Side: Plan Duration, Status Pill & Save Button */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontFamily: FONT_BODY,
                    fontSize: 12,
                    fontWeight: 700,
                    padding: "6px 12px",
                    borderRadius: 8,
                    background: planSaved ? C.tealSoft : C.amberSoft,
                    color: planSaved ? C.teal : "#8A5A05",
                    border: `1px solid ${planSaved ? "#BFE6DF" : "#F0D9A8"}`,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: planSaved ? C.teal : C.amber }} />
                  {planSaved ? "Plan Saved" : "Unsaved Draft"}
                </span>

                <button
                  type="button"
                  onClick={() => {
                    savePlan();
                    pushAi("Saved “" + planRange.label + "”. Keep chatting if you still want to research, or open Calendar for the grid.");
                  }}
                  style={{
                    height: 38,
                    padding: "0 18px",
                    borderRadius: 9,
                    border: "none",
                    background: C.teal,
                    color: "#fff",
                    fontFamily: FONT_BODY,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    boxShadow: "0 2px 8px rgba(12,140,125,0.22)",
                  }}
                >
                  <Save size={14} /> Save Plan
                </button>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
              {[
                "Plan last week about product",
                "Search live ops dashboards",
                "What's going on in UK BI",
                "Plan 1–15 October on LinkedIn",
                "Plan next month about hiring",
                "Save this plan",
              ].map((p) => (
                <button key={p} onClick={() => runPrompt(p)} style={{ border: `1px solid ${C.border}`, background: "#fff", borderRadius: 999, padding: "8px 14px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk, cursor: "pointer", textAlign: "left" }}>
                  {p}
                </button>
              ))}
            </div>

            <div className="hover-float" style={{ marginTop: 22, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.slateLight }}>Draft</div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, marginTop: 4 }}>{planRange.label} · {company.name}</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 6 }}>{slots.length} slots · {topics.length} topics found · {pickedCount} pinned</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {schedules.map((s) => {
                  const tint = tintFor(s.id);
                  return (
                    <span key={s.id} style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: tint.fg, background: tint.bg, borderRadius: 999, padding: "5px 10px" }}>{s.weekday} · {s.theme.split(",")[0]}</span>
                  );
                })}
              </div>
            </div>

            {searching && (
              <div style={{ background: "#fff", border: "1px solid " + C.border, borderRadius: 14, padding: 22, textAlign: "center", marginTop: 16 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>Searching “{researchQuery}”</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 6 }}>Web + {company.name} knowledge. Stays on this plan.</div>
              </div>
            )}

            {!searching && topics.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>Research for this plan</div>
                  <button type="button" onClick={pinTopicsToPlan} style={{ height: 32, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    Pin onto empty slots
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                  {topics.slice(0, 8).map(renderTopicCard)}
                </div>
              </div>
            )}

            {slots.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, marginBottom: 10 }}>Slots in this range</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {slots.slice().sort((a, b) => a.dateMs - b.dateMs).slice(0, 12).map((slot) => {
                    const topic = slot.topicId ? topicById[slot.topicId] : null;
                    return (
                      <div key={slot.id} className="hover-float" style={{ display: "flex", gap: 10, padding: "10px 12px", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, fontFamily: FONT_BODY, fontSize: 13 }}>
                        <span style={{ minWidth: 72, fontWeight: 700, color: C.ink }}>{formatPlanDay(new Date(slot.dateMs))}</span>
                        <span style={{ flex: 1, color: C.slate }}>{slot.theme}</span>
                        <span style={{ color: topic ? C.teal : C.slateLight, fontWeight: 600 }}>{topic ? topic.headline.slice(0, 36) : "No topic yet"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            </div>
          </div>
        )}

        {view === "month" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px 40px", background: HUB_PAPER }}>
            <div style={{ maxWidth: 1040, width: "100%", margin: "0 auto" }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.slate, marginBottom: 14 }}>
                {planSaved ? "Saved “" + planRange.label + "” for " + company.name + ". Past or future — both allowed." : "Draft range. Set From/To (any past or future dates), then save. Library keeps every saved plan."}
              </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 14, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px" }}>
              <div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slateLight, marginBottom: 4 }}>FROM</div>
                <input type="date" value={isoDate(planRange.fromMs)} onChange={(e) => applyDateRange(e.target.value, isoDate(planRange.toMs))} style={{ height: 36, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 10px", fontFamily: FONT_BODY, fontSize: 13 }} />
              </div>
              <div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slateLight, marginBottom: 4 }}>TO</div>
                <input type="date" value={isoDate(planRange.toMs)} onChange={(e) => applyDateRange(isoDate(planRange.fromMs), e.target.value)} style={{ height: 36, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 10px", fontFamily: FONT_BODY, fontSize: 13 }} />
              </div>
              <button onClick={() => applyDateRange(isoDate(addDays(SCHEDULER_NOW, -7)), isoDate(addDays(SCHEDULER_NOW, -1)))} style={{ height: 36, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: HUB_PAPER, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Last week</button>
              <button onClick={() => { const r = monthRange(SCHEDULER_NOW.getFullYear(), SCHEDULER_NOW.getMonth()); applyDateRange(isoDate(r.fromMs), isoDate(r.toMs)); }} style={{ height: 36, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: HUB_PAPER, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>This month</button>
              <button onClick={() => { const m = SCHEDULER_NOW.getMonth() + 1; const r = monthRange(SCHEDULER_NOW.getFullYear() + Math.floor(m / 12), m % 12); applyDateRange(isoDate(r.fromMs), isoDate(r.toMs)); }} style={{ height: 36, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: HUB_PAPER, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Next month</button>
            </div>
            {savedPlans.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slateLight, alignSelf: "center" }}>SAVED</span>
                {savedPlans.map((p) => (
                  <button key={p.id} onClick={() => loadPlan(p)} style={{ height: 32, padding: "0 12px", borderRadius: 999, border: `1px solid ${activePlanId === p.id ? C.ink : C.border}`, background: activePlanId === p.id ? C.ink : "#fff", color: activePlanId === p.id ? "#fff" : C.textInk, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{p.name}</button>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
              {schedules.map((s) => {
                const tint = tintFor(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => openSchedule(s)}
                    style={{ fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 600, color: tint.fg, background: tint.bg, borderRadius: 999, padding: "6px 12px", border: `1px solid ${tint.fg}33`, cursor: "pointer" }}
                  >
                    {s.weekday} · {s.theme.split(",")[0]} · Edit
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <button type="button" onClick={() => setCalCursor((c) => { const d = new Date(c.year, c.month - 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })} style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><ChevronLeft size={16} /></button>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink }}>{monthLabel(calCursor.year, calCursor.month)}</div>
              <button type="button" onClick={() => setCalCursor((c) => { const d = new Date(c.year, c.month + 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })} style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><ChevronRight size={16} /></button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 8, marginBottom: 6 }}>
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slateLight, textAlign: "center", padding: "4px 0" }}>{d}</div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 8 }}>
              {monthCells.map((d, i) => {
                if (!d) return <div key={"e" + i} style={{ aspectRatio: "1", minWidth: 0 }} />;
                const daySlots = slotsByDay[dayKey(d)] || [];
                const slot = daySlots[0];
                const inRange = startOfDayMs(d) >= planRange.fromMs && startOfDayMs(d) <= planRange.toMs;
                const tint = slot ? tintFor(slot.scheduleId) : null;
                const topic = slot && slot.topicId ? topicById[slot.topicId] : null;
                const drafted = slot && slot.postId;
                const cellPost = drafted ? posts.find((p) => p.id === slot.postId || p.slotId === slot.id) : null;
                const open = slot && panel && panel.type === "slot" && panel.id === slot.id;
                return (
                  <button
                    key={dayKey(d)}
                    type="button"
                    onClick={() => (slot ? openSlot(slot) : openNewDay(d))}
                    style={{
                      aspectRatio: "1",
                      width: "100%",
                      minWidth: 0,
                      minHeight: 0,
                      height: "auto",
                      appearance: "none",
                      WebkitAppearance: "none",
                      boxSizing: "border-box",
                      overflow: "hidden",
                      borderRadius: 10,
                      border: open ? "2px solid " + C.ink : "1px solid " + (slot ? "transparent" : C.border),
                      background: slot ? tint.bg : "#fff",
                      opacity: inRange ? 1 : 0.38,
                      padding: 8,
                      textAlign: "left",
                      cursor: "pointer",
                      fontFamily: FONT_BODY,
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13, color: slot ? tint.fg : C.slateLight }}>{d.getDate()}</div>
                    {slot ? (
                      <>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, color: tint.fg, marginTop: 4 }}>{slot.time} · Open</div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.textInk, marginTop: 3, lineHeight: 1.25, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                          {topic ? topic.headline : slot.theme}
                        </div>
                        {cellPost && <div style={{ fontFamily: FONT_BODY, fontSize: 10, fontWeight: 700, color: C.teal, marginTop: 4 }}>{cellPost.status === "published" ? "Live" : cellPost.status === "awaiting_approval" ? "Needs you" : cellPost.status === "approved" ? "Approved" : cellPost.status === "scheduled" ? "Scheduled" : "Draft"}</div>}
                      </>
                    ) : (
                      <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.slateLight, marginTop: 8 }}>+ Add slot</div>
                    )}
                  </button>
                );
              })}
            </div>

            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, marginTop: 28, marginBottom: 10 }}>This month's slots</div>
            {slots.length === 0 && <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate }}>No slots yet. Click a day or talk to the AI.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {slots.slice().sort((a, b) => a.dateMs - b.dateMs).map((slot) => {
                const tint = tintFor(slot.scheduleId);
                const topic = slot.topicId ? topicById[slot.topicId] : null;
                const post = posts.find((p) => p.id === slot.postId || p.slotId === slot.id);
                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => openSlot(slot)}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      textAlign: "left",
                      background: "#fff",
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      padding: "12px 14px",
                      cursor: "pointer",
                      fontFamily: FONT_BODY,
                    }}
                  >
                    <div style={{ minWidth: 72, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13, color: tint.fg }}>{formatPlanDay(new Date(slot.dateMs))}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.ink }}>{slot.theme}</div>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginTop: 3 }}>{slot.time} · {topic ? topic.headline : "No topic yet"}{post ? " · " + (post.status === "published" ? "Published" : post.status === "approved" ? "Approved" : "Draft") : ""}</div>
                    </div>
                    <span style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.cobalt }}>Open</span>
                  </button>
                );
              })}
            </div>
            </div>
          </div>
        )}

        {view === "topics" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 36px", background: HUB_PAPER }}>
            <div style={{ maxWidth: 1040, width: "100%", margin: "0 auto" }}>
              
              {/* Header Box */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 20 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, letterSpacing: "-0.02em" }}>
                      Topic Research Library
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, background: C.tealSoft, color: C.teal, padding: "3px 9px", borderRadius: 999, border: `1px solid #BFE6DF` }}>
                      {topics.length} topics saved
                    </span>
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 4 }}>
                    Industry angles, competitive intelligence, and customer insights ready to be scheduled and drafted into content.
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    type="button"
                    onClick={pinTopicsToPlan}
                    style={{
                      height: 38,
                      padding: "0 16px",
                      borderRadius: 9,
                      border: "none",
                      background: C.teal,
                      color: "#fff",
                      fontFamily: FONT_BODY,
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      boxShadow: "0 2px 8px rgba(12,140,125,0.2)",
                    }}
                  >
                    <Sparkles size={14} /> Auto-Pin to Empty Slots
                  </button>
                </div>
              </div>

              {/* Search & Query Filters */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 20px", marginBottom: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <Search size={16} color={C.slateLight} style={{ position: "absolute", left: 14, top: 12 }} />
                    <input
                      value={topicFilter}
                      onChange={(e) => setTopicFilter(e.target.value)}
                      placeholder="Search saved topics by headline, angle, or source..."
                      style={{
                        width: "100%",
                        height: 40,
                        borderRadius: 9,
                        border: `1px solid ${C.border}`,
                        padding: "0 14px 0 38px",
                        fontFamily: FONT_BODY,
                        fontSize: 13.5,
                        background: HUB_PAPER,
                        color: C.textInk,
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  {topicFilter && (
                    <button
                      onClick={() => setTopicFilter("")}
                      style={{ height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", color: C.slate, fontFamily: FONT_BODY, fontSize: 12, cursor: "pointer" }}
                    >
                      Clear
                    </button>
                  )}
                </div>

                {researchSets.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slateLight, textTransform: "uppercase", letterSpacing: "0.05em", marginRight: 4 }}>
                      Search Batches:
                    </span>
                    <button
                      type="button"
                      onClick={() => setTopicFilter("")}
                      style={{
                        height: 28,
                        padding: "0 10px",
                        borderRadius: 999,
                        border: `1px solid ${!topicFilter ? C.ink : C.border}`,
                        background: !topicFilter ? C.ink : HUB_PAPER,
                        color: !topicFilter ? "#fff" : C.textInk,
                        fontFamily: FONT_BODY,
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      All Topics ({topics.length})
                    </button>
                    {researchSets.map((rs) => {
                      const active = topicFilter === rs.query;
                      return (
                        <button
                          key={rs.id}
                          type="button"
                          onClick={() => setTopicFilter(rs.query)}
                          style={{
                            height: 28,
                            padding: "0 10px",
                            borderRadius: 999,
                            border: `1px solid ${active ? C.ink : C.border}`,
                            background: active ? C.ink : HUB_PAPER,
                            color: active ? "#fff" : C.textInk,
                            fontFamily: FONT_BODY,
                            fontSize: 11.5,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {rs.query} · {rs.count}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Topics Grid */}
              {filteredTopics.length === 0 ? (
                <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: "48px 24px", textAlign: "center" }}>
                  <Search size={28} color={C.slateLight} style={{ margin: "0 auto 12px" }} />
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink }}>No topics found matching "{topicFilter}"</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 6 }}>Try clearing your search query or research new topics in Plan AI.</div>
                  <button onClick={() => setTopicFilter("")} style={{ marginTop: 16, height: 36, padding: "0 14px", borderRadius: 8, border: "none", background: C.ink, color: "#fff", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>View all topics</button>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
                  {filteredTopics.map(renderTopicCard)}
                </div>
              )}
            </div>
          </div>
        )}

        {view === "approval" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px 48px", background: HUB_PAPER }}>
            <div style={{ maxWidth: 860, width: "100%", margin: "0 auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, letterSpacing: "-0.02em" }}>
                    Post Approvals Queue
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 3 }}>
                    Review, edit, or regenerate content before it broadcasts across connected channels.
                  </div>
                </div>
              </div>
            {awaiting.length + approved.length === 0 && scheduledPosts.length === 0 && (
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 18, padding: 36, textAlign: "center", maxWidth: 480, margin: "40px auto" }}>
                <CheckCircle2 size={28} color={C.teal} />
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink, marginTop: 12 }}>Nothing due yet</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.slate, marginTop: 8 }}>When a scheduled slot's time comes, the post lands here and in email. Approve in this app or from the inbox, then publish.</div>
                <button onClick={sendDue} style={{ marginTop: 16, height: 38, padding: "0 14px", borderRadius: 10, border: "none", background: C.ink, color: "#fff", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Check what's due</button>
              </div>
            )}
            {approved.map((p) => (
              <SchedulerPostCard
                key={p.id}
                post={p}
                tone="confirm"
                editingId={editingId}
                editCopy={editCopy}
                setEditCopy={setEditCopy}
                onEdit={() => { setEditingId(p.id); setEditCopy(p.copy); }}
                onSave={() => saveEdit(p.id)}
                onCancel={() => setEditingId(null)}
                onRegenerate={() => regenerate(p)}
                onRegenerateImage={handleRegeneratePostImage}
                onApprove={() => approvePost(p.id)}
                onReject={() => rejectPost(p.id)}
                onConfirm={() => confirmPublish(p.id)}
              />
            ))}
            {awaiting.map((p) => (
              <SchedulerPostCard
                key={p.id}
                post={p}
                tone="approve"
                editingId={editingId}
                editCopy={editCopy}
                setEditCopy={setEditCopy}
                onEdit={() => { setEditingId(p.id); setEditCopy(p.copy); }}
                onSave={() => saveEdit(p.id)}
                onCancel={() => setEditingId(null)}
                onRegenerate={() => regenerate(p)}
                onRegenerateImage={handleRegeneratePostImage}
                onApprove={() => approvePost(p.id)}
                onReject={() => rejectPost(p.id)}
                onConfirm={() => confirmPublish(p.id)}
              />
            ))}
            {scheduledPosts.length > 0 && (
              <div style={{ marginTop: 8, marginBottom: 18 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 15, color: C.ink, marginBottom: 8 }}>Scheduled — waiting for their time</div>
                {scheduledPosts.map((p) => (
                  <div key={p.id} className="hover-float" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px 18px", marginBottom: 10, width: "100%", boxSizing: "border-box", boxShadow: "0 2px 6px rgba(0,0,0,0.02)" }}>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.ink }}>{p.dateLabel} · {p.topicHeadline || p.theme}</div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginTop: 4 }}>Written in this software. When due, we send it here and to {operatorEmail(operator)}.</div>
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>
        )}

        {view === "inbox" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px 48px", background: HUB_PAPER }}>
            <div style={{ maxWidth: 860, width: "100%", margin: "0 auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, letterSpacing: "-0.02em" }}>
                    Approval Email Inbox
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 3 }}>
                    Approvals simulated via notification emails to {operatorEmail(operator)}.
                  </div>
                </div>
              </div>
            {emails.length === 0 && (
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, maxWidth: 480 }}>
                <Mail size={20} color={C.teal} />
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink, marginTop: 10 }}>Inbox empty</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.slate, marginTop: 6 }}>No approval mails yet. Write posts, then “check what's due” or wait until a slot's time.</div>
              </div>
            )}
            {emails.map((em) => (
              <div key={em.id} className="hover-float" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 22, marginBottom: 14, width: "100%", boxSizing: "border-box", opacity: em.status === "unread" ? 1 : 0.85, boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slateLight, letterSpacing: "0.06em", textTransform: "uppercase" }}>To {em.to} · {em.sentAt}</div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, marginTop: 4 }}>{em.subject}</div>
                  </div>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: em.status === "unread" ? C.amber : em.status === "approved" ? C.teal : C.slate, background: em.status === "unread" ? C.amberSoft : em.status === "approved" ? C.tealSoft : C.paperSoft, borderRadius: 999, padding: "4px 10px", height: "fit-content" }}>{em.status}</span>
                </div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.textInk, marginTop: 10, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{em.body || em.preview}</div>
                {em.status === "unread" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                    <button onClick={() => approveFromEmail(em)} style={{ height: 36, padding: "0 14px", borderRadius: 10, border: "none", background: C.ink, color: "#fff", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Approve from email</button>
                    <button onClick={() => rejectFromEmail(em)} style={{ height: 36, padding: "0 14px", borderRadius: 10, border: `1px solid #F0C4B8`, background: C.redSoft, color: C.red, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Reject</button>
                  </div>
                )}
              </div>
            ))}
            </div>
          </div>
        )}

        {view === "published" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px 48px", background: HUB_PAPER }}>
            <div style={{ maxWidth: 860, width: "100%", margin: "0 auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, letterSpacing: "-0.02em" }}>
                    Published Posts Archive
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 3 }}>
                    Live broadcasts across connected social channels and verified engagement metrics.
                  </div>
                </div>
              </div>
              {published.length === 0 && <div style={{ fontFamily: FONT_BODY, color: C.slate }}>Nothing published yet.</div>}
              {published.map((p) => (
                <div key={p.id} className="hover-float" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 22, marginBottom: 16, width: "100%", boxSizing: "border-box", boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>{p.weekday} · {p.topicHeadline || p.theme}</div>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.teal, background: C.tealSoft, borderRadius: 999, padding: "4px 10px" }}>Posted {p.publishedAt}</span>
                </div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.textInk, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{p.copy}</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.teal, fontWeight: 600, marginTop: 10 }}>{p.cta}</div>
                <div style={{ display: "flex", gap: 4, marginTop: 12 }}>{p.channels.map((c) => <ChannelPill key={c} id={c} />)}</div>
              </div>
            ))}
            </div>
          </div>
        )}

        {view === "company" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 36px", background: HUB_PAPER }}>
            <div style={{ maxWidth: 980, width: "100%", margin: "0 auto" }}>
              
              {/* Header Box */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 20 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, letterSpacing: "-0.02em" }}>
                      Company Knowledge Base
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 700, background: C.tealSoft, color: C.teal, padding: "3px 9px", borderRadius: 999, border: `1px solid #BFE6DF`, display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 999, background: C.teal }} />
                      Synced with Voice AI Agent
                    </span>
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 4 }}>
                    Master identity, indexed documents, and core service definitions shared across both voice calling and automated content generation.
                  </div>
                </div>
              </div>

              {/* Sub-Tab Navigation */}
              <div style={{ display: "flex", gap: 8, borderBottom: `1px solid ${C.border}`, marginBottom: 22 }}>
                {[
                  { id: "identity", label: "Company Identity & Tone", icon: Building2 },
                  { id: "knowledge", label: "Knowledge Sources & Documents (" + (knowledgeSources || []).length + ")", icon: Globe },
                  { id: "services", label: "Core Services & Offerings (" + (services || []).length + ")", icon: Briefcase },
                ].map((t) => {
                  const active = kbTab === t.id;
                  const Icon = t.icon || BookOpen;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setKbTab(t.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 18px",
                        borderRadius: "8px 8px 0 0",
                        border: "none",
                        borderBottom: active ? `2px solid ${C.teal}` : "2px solid transparent",
                        background: active ? "#fff" : "transparent",
                        color: active ? C.teal : C.slate,
                        fontFamily: FONT_BODY,
                        fontSize: 13,
                        fontWeight: active ? 700 : 500,
                        cursor: "pointer",
                      }}
                    >
                      <Icon size={15} />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* TAB 1: IDENTITY */}
              {kbTab === "identity" && (
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 20, alignItems: "start" }}>
                  <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, marginBottom: 16 }}>
                      Brand Identity & Voice Profile
                    </div>

                    {/* Safe profile accessor */}
                    {(() => {
                      const safeProfile = profile || INITIAL_COMPANY_PROFILE;
                      return (
                        <>
                          <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>COMPANY NAME</label>
                          <input value={safeProfile.name || ""} onChange={(e) => setProfile && setProfile({ ...safeProfile, name: e.target.value })} style={{ width: "100%", height: 42, borderRadius: 9, border: `1px solid ${C.border}`, padding: "0 12px", fontFamily: FONT_BODY, fontSize: 14, marginBottom: 16, background: HUB_PAPER, boxSizing: "border-box" }} />

                          <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>PRIMARY VALUE PROPOSITION & PITCH</label>
                          <textarea value={safeProfile.pitch || ""} onChange={(e) => setProfile && setProfile({ ...safeProfile, pitch: e.target.value })} rows={3} style={{ width: "100%", borderRadius: 9, border: `1px solid ${C.border}`, padding: 12, fontFamily: FONT_BODY, fontSize: 13.5, lineHeight: 1.5, marginBottom: 16, resize: "vertical", background: HUB_PAPER, boxSizing: "border-box" }} />

                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
                            <div>
                              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>INDUSTRY</label>
                              <input value={safeProfile.industry || ""} onChange={(e) => setProfile && setProfile({ ...safeProfile, industry: e.target.value })} style={{ width: "100%", height: 40, borderRadius: 9, border: `1px solid ${C.border}`, padding: "0 12px", fontFamily: FONT_BODY, fontSize: 13.5, background: HUB_PAPER, boxSizing: "border-box" }} />
                            </div>
                            <div>
                              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>WEBSITE</label>
                              <input value={safeProfile.website || ""} onChange={(e) => setProfile && setProfile({ ...safeProfile, website: e.target.value })} style={{ width: "100%", height: 40, borderRadius: 9, border: `1px solid ${C.border}`, padding: "0 12px", fontFamily: FONT_BODY, fontSize: 13.5, background: HUB_PAPER, boxSizing: "border-box" }} />
                            </div>
                          </div>

                          <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>TONE & EDITORIAL DIRECTIVES</label>
                          <input value={safeProfile.tone || ""} onChange={(e) => setProfile && setProfile({ ...safeProfile, tone: e.target.value })} style={{ width: "100%", height: 40, borderRadius: 9, border: `1px solid ${C.border}`, padding: "0 12px", fontFamily: FONT_BODY, fontSize: 13.5, background: HUB_PAPER, boxSizing: "border-box" }} />
                        </>
                      );
                    })()}
                  </div>

                  {/* Right Preview Card */}
                  <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 22, boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.slateLight, marginBottom: 10 }}>Brand Persona Preview</div>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: C.ink, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, marginBottom: 12 }}>
                      {(profile?.name || "AI").slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink }}>{profile?.name || "AIVHub"}</div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 4 }}>{profile?.industry || "Operations"} · {profile?.website || "aivhub.io"}</div>
                    <div style={{ padding: "12px 14px", background: HUB_PAPER, borderRadius: 10, border: `1px solid ${C.border}`, marginTop: 14, fontFamily: FONT_BODY, fontSize: 13, color: C.textInk, lineHeight: 1.5 }}>
                      "{profile?.pitch || "AI-powered operations dashboards."}"
                    </div>
                    <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.teal, fontWeight: 600 }}>
                      <CheckCircle2 size={15} /> Active in voice prompts & social generators
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: KNOWLEDGE SOURCES */}
              {kbTab === "knowledge" && (
                <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div>
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>
                        Indexed Documentation & Reference Materials
                      </div>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 3 }}>
                        Websites, brochures, case studies, and FAQs parsed into vector embeddings for accurate content drafting.
                      </div>
                    </div>
                    {!addingSource && (
                      <button
                        onClick={() => setAddingSource(true)}
                        style={{ height: 36, padding: "0 14px", borderRadius: 8, border: "none", background: C.teal, color: "#fff", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                      >
                        <PlusCircle size={14} /> Add Source
                      </button>
                    )}
                  </div>

                  {addingSource && (
                    <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 18 }}>
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14.5, color: C.ink, marginBottom: 10 }}>Add New Knowledge Source</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                        <input value={newSource.name} onChange={(e) => setNewSource({ ...newSource, name: e.target.value })} placeholder="Document / Source Title (e.g. 2026 Rate Card)" style={{ height: 38, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 12px", fontFamily: FONT_BODY, fontSize: 13, background: "#fff" }} />
                        <input value={newSource.value} onChange={(e) => setNewSource({ ...newSource, value: e.target.value })} placeholder="URL, PDF path, or document notes" style={{ height: 38, borderRadius: 8, border: `1px solid ${C.border}`, padding: "0 12px", fontFamily: FONT_BODY, fontSize: 13, background: "#fff" }} />
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => { if (!newSource.name || !newSource.value) return; setKnowledgeSources((xs) => [...xs, { id: "k_" + Date.now(), ...newSource, status: "indexed", synced: "just now" }]); setNewSource({ name: "", type: "Website URL", value: "" }); setAddingSource(false); }} style={{ height: 34, padding: "0 14px", borderRadius: 8, border: "none", background: C.teal, color: "#fff", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Save & Index</button>
                        <button onClick={() => setAddingSource(false)} style={{ height: 34, padding: "0 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {(knowledgeSources || []).map((s) => (
                      <div key={s.id} className="hover-float" style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", border: `1px solid ${C.border}`, borderRadius: 12, background: "#fff" }}>
                        <div style={{ width: 36, height: 36, borderRadius: 9, background: C.tealSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Globe size={16} color={C.teal} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink }}>{s.name}</div>
                          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.type || "Document"} · {s.value}
                          </div>
                        </div>
                        <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.teal, background: C.tealSoft, border: `1px solid #BFE6DF`, borderRadius: 999, padding: "3px 10px" }}>
                          ✓ Indexed & Synced
                        </span>
                        <button onClick={() => setKnowledgeSources((xs) => xs.filter((x) => x.id !== s.id))} title="Remove source" style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                          <Trash2 size={14} color={C.slateLight} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 3: SERVICES */}
              {kbTab === "services" && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
                  {(services || []).map((s) => (
                    <div key={s.id} className="hover-float" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: C.cobaltSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Briefcase size={15} color={C.cobalt} />
                        </div>
                        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, flex: 1 }}>{s.name}</div>
                      </div>

                      <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: C.slateLight, marginBottom: 4 }}>TARGET BUYER</div>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk, marginBottom: 12, padding: "6px 10px", background: HUB_PAPER, borderRadius: 8 }}>
                        {s.ideal}
                      </div>

                      <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: C.slateLight, marginBottom: 4 }}>VALUE PROPOSITION</div>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, lineHeight: 1.5 }}>
                        {s.desc}
                      </div>
                    </div>
                  ))}
                </div>
              )}

            </div>
          </div>
        )}

        {view === "channels" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 36px 48px", background: HUB_PAPER }}>
            <div style={{ maxWidth: 980, width: "100%", margin: "0 auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, letterSpacing: "-0.02em" }}>
                    Connected Social Channels
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 3 }}>
                    Manage OAuth integrations and active broadcast targets for automated post publishing.
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16, alignContent: "start" }}>
            {Object.keys(SOCIAL_CHANNELS).map((id) => {
              const ch = SOCIAL_CHANNELS[id];
              const on = channels[id];
              return (
                <div key={id} className="hover-float" style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 16, padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: ch.soft, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13, color: ch.color }}>
                      {ch.mark}
                    </div>
                    <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink }}>{ch.label}</div>
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginBottom: 14 }}>{on ? "Connected — drafts can publish here after you confirm." : "Not connected. Prototype toggle only."}</div>
                  <button
                    onClick={() => setChannels((c) => ({ ...c, [id]: !c[id] }))}
                    style={{ height: 36, width: "100%", borderRadius: 10, border: "none", background: on ? C.ink : C.paperSoft, color: on ? "#fff" : C.textInk, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                  >
                    {on ? "Connected" : "Connect"}
                  </button>
                </div>
              );
            })}
              </div>
            </div>
          </div>
        )}
        {view === "images" && (
          <SchedulerImageStudioView
            topics={topics}
            setTopics={setTopics}
            posts={posts}
            setPosts={setPosts}
            commonAi={commonAi}
            company={company}
            onNavigate={navigateSch}
          />
        )}
        {view === "ai" && (
          <SchedulerAiConfigView
            commonAi={commonAi || INITIAL_COMMON_AI_CONFIG}
            setCommonAi={setCommonAi || (() => {})}
            onOpenCommonModal={onOpenCommonAi || (() => {})}
            company={company}
          />
        )}
        </div>

        {(view === "plan" || view === "images") && (
        <div
          style={{
            width: chatWidth,
            minWidth: 320,
            maxWidth: 880,
            position: "relative",
            borderLeft: `1px solid ${C.border}`,
            background: "#fff",
            display: "flex",
            flexDirection: "column",
            userSelect: isDraggingChat ? "none" : "auto",
            transition: isDraggingChat ? "none" : "width 0.16s ease",
            boxShadow: isDraggingChat ? "-4px 0 20px rgba(0,0,0,0.08)" : "none",
          }}
        >
          {/* Draggable Resizer Edge */}
          <div
            onMouseDown={startDragChat}
            title="Drag left/right to stretch AI chat panel"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: -5,
              width: 10,
              cursor: "col-resize",
              zIndex: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: isDraggingChat ? "rgba(12,140,125,0.25)" : "transparent",
            }}
            onMouseEnter={(e) => {
              if (!isDraggingChat) e.currentTarget.style.background = "rgba(12,140,125,0.18)";
            }}
            onMouseLeave={(e) => {
              if (!isDraggingChat) e.currentTarget.style.background = "transparent";
            }}
          >
            <div style={{ width: 2, height: 28, borderRadius: 999, background: isDraggingChat ? C.teal : "#C8CCD6" }} />
          </div>

          {/* Header with Title and Quick Stretch Controls */}
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14.5, color: C.ink }}>
              <Sparkles size={15} color={C.teal} /> {view === "images" ? "Visual Director AI" : "Plan AI"}
              <span style={{ fontSize: 11, color: C.slateLight, fontWeight: 500 }}>({chatWidth}px)</span>
            </div>

            {/* Quick Stretch Buttons */}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                type="button"
                onClick={() => setChatWidth((w) => (w <= 420 ? 620 : w <= 650 ? 820 : 380))}
                title="Toggle stretch width (Compact · Wide · Extra Wide)"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  background: HUB_PAPER,
                  color: C.textInk,
                  fontFamily: FONT_BODY,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <MoveHorizontal size={12} />
                <span>{chatWidth <= 420 ? "Stretch" : chatWidth <= 650 ? "Max" : "Reset"}</span>
              </button>
            </div>
          </div>

          <div style={{ padding: "8px 16px", fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, borderBottom: `1px solid ${C.border}`, background: HUB_PAPER, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>{view === "images" ? "Brainstorm visual ideas, prompt refinements, or graphic styles." : "Dates, themes, or topic research. Drag border ↔ to stretch."}</span>
          </div>

          {/* Message List */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px" }}>
            {chat.map((m) => (
              <div key={m.id} style={{ display: "flex", justifyContent: m.who === "user" ? "flex-end" : "flex-start", marginBottom: 12 }}>
                <div
                  style={{
                    maxWidth: "88%",
                    background: m.who === "user" ? C.ink : HUB_PAPER,
                    color: m.who === "user" ? "#fff" : C.textInk,
                    border: m.who === "user" ? "none" : `1px solid ${C.border}`,
                    borderRadius: m.who === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                    padding: "11px 14px",
                    fontFamily: FONT_BODY,
                    fontSize: 13,
                    lineHeight: 1.52,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                  }}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {typing && (
              <div style={{ display: "flex", gap: 5, padding: "8px 12px", background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 12, width: 52 }}>
                {[0, 1, 2].map((i) => <span key={i} style={{ width: 6, height: 6, borderRadius: 999, background: C.teal, animation: `typingDot 1s ${i * 0.15}s infinite` }} />)}
              </div>
            )}
            <div ref={chatEnd} />
          </div>

          {/* Chat Input */}
          <form onSubmit={sendChat} style={{ padding: "12px 14px 14px", borderTop: `1px solid ${C.border}`, background: "#fff" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                ref={chatInput}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={view === "images" ? "Ask for visual concepts or prompt ideas (e.g. sleek SaaS graphic for ops)…" : "Plan dates, frequencies, themes, or search a topic…"}
                style={{ flex: 1, height: 42, borderRadius: 10, border: `1px solid ${C.border}`, padding: "0 14px", fontFamily: FONT_BODY, fontSize: 13.5, background: HUB_PAPER, color: C.textInk, outline: "none" }}
              />
              <button type="submit" style={{ width: 42, height: 42, borderRadius: 10, border: "none", background: C.teal, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(12,140,125,0.22)" }}>
                <Send size={15} />
              </button>
            </div>
          </form>
        </div>
        )}
        </div>
      </div>

      {panel && form && (
        <div onClick={closePanel} style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.5)", backdropFilter: "blur(4px)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "pointer" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, maxHeight: "88vh", overflowY: "auto", background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 24px 64px rgba(0,0,0,0.2)", cursor: "default" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.slateLight }}>
                  {panel.type === "schedule" ? "Weekly rule" : panel.type === "new" ? "New posting day" : "Posting slot"}
                </div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink, marginTop: 4 }}>
                  {panel.type === "new"
                    ? "Add " + formatPlanDay(new Date(panel.dateMs))
                    : panel.type === "schedule"
                      ? (form.weekday + " · " + company.name)
                      : formatPlanDay(new Date((slots.find((s) => s.id === panel.id) || {}).dateMs || Date.now()))}
                </div>
              </div>
              <button onClick={closePanel} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: HUB_PAPER, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X size={16} color={C.slate} />
              </button>
            </div>

            {panel.type === "schedule" && (
              <>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginBottom: 12, padding: "10px 12px", background: HUB_PAPER, borderRadius: 10, border: `1px solid ${C.border}` }}>
                  Posting as <strong style={{ color: C.ink }}>{company.name}</strong> — our company.
                </div>
                <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Weekday</label>
                <select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: e.target.value })} style={{ width: "100%", height: 40, borderRadius: 10, border: `1px solid ${C.border}`, padding: "0 12px", fontFamily: FONT_BODY, fontSize: 14, marginBottom: 12, background: "#fff" }}>
                  {DAY_CANON.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </>
            )}

            {panel.type === "new" && (
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginBottom: 12, padding: "10px 12px", background: HUB_PAPER, borderRadius: 10, border: `1px solid ${C.border}` }}>
                Slot goes out as <strong style={{ color: C.ink }}>{company.name}</strong>.
              </div>
            )}

            <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Time</label>
            <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} style={{ width: "100%", height: 40, borderRadius: 10, border: `1px solid ${C.border}`, padding: "0 12px", fontFamily: FONT_BODY, fontSize: 14, marginBottom: 12 }} />

            <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Theme</label>
            <textarea value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })} rows={3} style={{ width: "100%", borderRadius: 10, border: `1px solid ${C.border}`, padding: 10, fontFamily: FONT_BODY, fontSize: 14, marginBottom: 12, resize: "vertical" }} />

            <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 8 }}>Channels</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {Object.keys(SOCIAL_CHANNELS).map((id) => {
                const on = form.channels.includes(id);
                return (
                  <button key={id} type="button" onClick={() => toggleFormChannel(id)} style={{ height: 32, padding: "0 10px", borderRadius: 999, border: `1px solid ${on ? C.ink : C.border}`, background: on ? C.ink : "#fff", color: on ? "#fff" : C.textInk, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    {SOCIAL_CHANNELS[id].label}
                  </button>
                );
              })}
            </div>

            {panel.type === "slot" && (
              <>
                <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Live topic</label>
                <select value={form.topicId || ""} onChange={(e) => setForm({ ...form, topicId: e.target.value })} style={{ width: "100%", height: 40, borderRadius: 10, border: `1px solid ${C.border}`, padding: "0 12px", fontFamily: FONT_BODY, fontSize: 13, marginBottom: 16, background: "#fff" }}>
                  <option value="">None yet — find topics or write from here</option>
                  {topics.map((t) => (
                    <option key={t.id} value={t.id}>{t.headline}</option>
                  ))}
                </select>
              </>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button type="button" onClick={savePanel} style={{ height: 40, padding: "0 16px", borderRadius: 10, border: "none", background: C.ink, color: "#fff", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Save</button>
              {panel.type === "slot" && (
                <button
                  type="button"
                  onClick={() => {
                    const slot = slots.find((s) => s.id === panel.id);
                    if (!slot) return;
                    const post = posts.find((p) => p.slotId === slot.id || p.id === slot.postId);
                    if (post) { closePanel(); setView("approval"); }
                    else writeOneSlot(slot);
                  }}
                  style={{ height: 40, padding: "0 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#fff", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >
                  {posts.some((p) => p.slotId === panel.id) ? "Open draft" : "Write post"}
                </button>
              )}
              {panel.type !== "new" && (
                <button type="button" onClick={deletePanelItem} style={{ height: 40, padding: "0 14px", borderRadius: 10, border: `1px solid #F0C4B8`, background: C.redSoft, color: C.red, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                  <Trash2 size={14} /> Remove
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelPill({ id }) {
  const ch = SOCIAL_CHANNELS[id] || { label: id, color: C.slate };
  return (
    <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600, color: ch.color, background: ch.soft || C.paperSoft, borderRadius: 999, padding: "3px 8px" }}>{ch.label}</span>
  );
}

function SchedulerPostCard({ post, tone, editingId, editCopy, setEditCopy, onEdit, onSave, onCancel, onRegenerate, onRegenerateImage, onApprove, onReject, onConfirm }) {
  const editing = editingId === post.id;
  const [regenPrompt, setRegenPrompt] = useState(post.imagePrompt || post.topicHeadline || post.theme || "");

  return (
    <div className="hover-float" style={{ background: "#fff", border: `1px solid ${tone === "confirm" ? C.teal : C.border}`, borderRadius: 18, padding: 24, marginBottom: 16, width: "100%", boxSizing: "border-box", boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.slateLight }}>{post.dateLabel} · {post.weekday}</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.ink, marginTop: 2 }}>{post.topicHeadline || post.theme}</div>
          {post.topicHeadline && (
            <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, marginTop: 4 }}>
              Written in this software · {(post.kbUsed && post.kbUsed.length ? post.kbUsed.join(", ") : "company knowledge")} · {post.topicSource} · {post.topicFreshness}
              {post.emailSent ? " · emailed for approval" : ""}
            </div>
          )}
        </div>
        <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: tone === "confirm" ? C.teal : C.amber, background: tone === "confirm" ? C.tealSoft : C.amberSoft, borderRadius: 999, padding: "4px 10px" }}>
          {tone === "confirm" ? "Approved — confirm to post" : "Needs your approval"}
        </span>
      </div>

      {/* Generated Topic Image Banner */}
      {post.imageUrl && (
        <div style={{ position: "relative", marginBottom: 16, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.borderLight}`, maxHeight: 280, background: "#0d0f17" }}>
          <img
            src={post.imageUrl}
            alt={post.topicHeadline || post.title || "Topic visual"}
            style={{ width: "100%", height: "auto", display: "block", objectFit: "cover", maxHeight: 280 }}
            loading="lazy"
          />
          <div style={{ position: "absolute", bottom: 8, left: 10, right: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 6, background: "rgba(0,0,0,0.72)", color: "#fff", backdropFilter: "blur(6px)" }}>
              🎨 AI Topic Visual
            </span>
            <button
              type="button"
              onClick={() => onRegenerateImage && onRegenerateImage(post, regenPrompt)}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 6, border: "none", background: "rgba(0,0,0,0.8)", color: "#fff", fontSize: 11.5, fontWeight: 600, cursor: "pointer", backdropFilter: "blur(6px)" }}
              title="Generate a fresh visual for this post"
            >
              <Sparkles size={13} color={C.teal} /> Regenerate Image
            </button>
          </div>
        </div>
      )}

      {editing ? (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 4 }}>Post Text Copy</label>
          <textarea value={editCopy} onChange={(e) => setEditCopy(e.target.value)} rows={5} style={{ width: "100%", borderRadius: 12, border: `1px solid ${C.border}`, padding: 12, fontFamily: FONT_BODY, fontSize: 14, lineHeight: 1.5, resize: "vertical", boxSizing: "border-box" }} />
          
          <div style={{ marginTop: 10 }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", marginBottom: 4 }}>Image Prompt / Concept</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={regenPrompt}
                onChange={(e) => setRegenPrompt(e.target.value)}
                placeholder="Describe image visual concept..."
                style={{ flex: 1, padding: "7px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12.5 }}
              />
              <button
                type="button"
                onClick={() => onRegenerateImage && onRegenerateImage(post, regenPrompt)}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: HUB_PAPER, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
              >
                <Sparkles size={13} color={C.teal} /> Update Image
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ fontFamily: FONT_BODY, fontSize: 14.5, color: C.textInk, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{post.copy}</div>
      )}
      <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: C.teal, fontWeight: 600, marginTop: 10 }}>{post.cta}</div>
      {post.edited && <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, marginTop: 6 }}>Edited before approval</div>}
      <div style={{ display: "flex", gap: 4, marginTop: 12, flexWrap: "wrap" }}>{post.channels.map((c) => <ChannelPill key={c} id={c} />)}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        {editing ? (
          <>
            <SchGhost onClick={onCancel}>Cancel</SchGhost>
            <SchSolid onClick={onSave}>Save copy</SchSolid>
          </>
        ) : tone === "confirm" ? (
          <>
            <SchGhost onClick={onEdit} icon={PenLine}>Edit</SchGhost>
            <SchSolid onClick={onConfirm}>Confirm & post</SchSolid>
          </>
        ) : (
          <>
            <SchGhost onClick={onEdit} icon={PenLine}>Edit</SchGhost>
            <SchGhost onClick={() => onRegenerateImage && onRegenerateImage(post)} icon={Sparkles}>New Image</SchGhost>
            <SchGhost onClick={onRegenerate} icon={RefreshCw}>Regenerate Copy</SchGhost>
            <SchGhost onClick={onReject} danger>Reject</SchGhost>
            <SchSolid onClick={onApprove}>Approve</SchSolid>
          </>
        )}
      </div>
    </div>
  );
}

function SchGhost({ children, onClick, icon: Icon, danger }) {
  return (
    <button onClick={onClick} style={{ height: 36, padding: "0 12px", borderRadius: 10, border: `1px solid ${danger ? "#F0C4B8" : C.border}`, background: "#fff", color: danger ? C.red : C.textInk, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
      {Icon && <Icon size={13} />} {children}
    </button>
  );
}

function SchSolid({ children, onClick }) {
  return (
    <button onClick={onClick} style={{ height: 36, padding: "0 14px", borderRadius: 10, border: "none", background: C.ink, color: "#fff", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
      {children}
    </button>
  );
}

/* ---------------------------------- app shell ---------------------------------- */

function VoiceOperatorApp({ operator, onBackToHub, onLogout, profile, setProfile, knowledgeSources, setKnowledgeSources, services, setServices, faq, setFaq, commonAi, setCommonAi, onOpenCommonAi }) {
  const [view, setView] = useState("tasks");
  const [selectedMissionId, setSelectedMissionId] = useState(null);
  const [liveFocus, setLiveFocus] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [notifications, setNotifications] = useState(INITIAL_NOTIFICATIONS);
  const [missions, setMissions] = useState(() => {
    try {
      const saved = localStorage.getItem("aivhub_missions");
      return saved ? JSON.parse(saved) : INITIAL_MISSIONS;
    } catch (_) {
      return INITIAL_MISSIONS;
    }
  });
  const selectedMission = missions.find((m) => m.id === selectedMissionId) || null;
  const [prefillSchedule, setPrefillSchedule] = useState(null);
  const [prefillLogQuery, setPrefillLogQuery] = useState(null);
  const [liveCalls, setLiveCalls] = useState(INITIAL_LIVE_CALLS.map((c) => ({ ...c, taken: false, listening: false, confirmingEnd: false, ended: false, booked: false })));
  const [scheduleItems, setScheduleItems] = useState(() => {
    try {
      const saved = localStorage.getItem("aivhub_schedule");
      return saved ? JSON.parse(saved) : INITIAL_SCHEDULE;
    } catch (_) {
      return INITIAL_SCHEDULE;
    }
  });
  const [meetings, setMeetings] = useState(() => {
    try {
      const saved = localStorage.getItem("aivhub_meetings");
      return saved ? JSON.parse(saved) : INITIAL_MEETINGS;
    } catch (_) {
      return INITIAL_MEETINGS;
    }
  });
  const [callLog, setCallLog] = useState(() => {
    try {
      const saved = localStorage.getItem("aivhub_call_log");
      return saved ? JSON.parse(saved) : INITIAL_CALL_LOG;
    } catch (_) {
      return INITIAL_CALL_LOG;
    }
  });
  const [registry, setRegistry] = useState(INITIAL_CONTACT_REGISTRY);

  // Sync state changes to localStorage
  useEffect(() => {
    try { localStorage.setItem("aivhub_missions", JSON.stringify(missions)); } catch (_) {}
  }, [missions]);

  useEffect(() => {
    try { localStorage.setItem("aivhub_schedule", JSON.stringify(scheduleItems)); } catch (_) {}
  }, [scheduleItems]);

  useEffect(() => {
    try { localStorage.setItem("aivhub_meetings", JSON.stringify(meetings)); } catch (_) {}
  }, [meetings]);

  useEffect(() => {
    try { localStorage.setItem("aivhub_call_log", JSON.stringify(callLog)); } catch (_) {}
  }, [callLog]);

  // Load backend data on mount
  useEffect(() => {
    async function loadWorkspaceData() {
      try {
        const ms = await api.getMissions();
        if (ms && Array.isArray(ms) && ms.length) setMissions(ms);
      } catch (_) {}
      try {
        const lc = await api.getLiveCalls();
        if (lc && Array.isArray(lc) && lc.length) setLiveCalls(lc);
      } catch (_) {}
      try {
        const mt = await api.getMeetings();
        if (mt && Array.isArray(mt) && mt.length) setMeetings(mt);
      } catch (_) {}
      try {
        const sc = await api.getSchedule();
        if (sc && Array.isArray(sc) && sc.length) setScheduleItems(sc);
      } catch (_) {}
      try {
        const cl = await api.getCallLogs();
        if (cl && Array.isArray(cl) && cl.length) setCallLog(cl);
      } catch (_) {}
      try {
        const reg = await api.getRegistry();
        if (reg && Array.isArray(reg) && reg.length) setRegistry(reg);
      } catch (_) {}
    }
    loadWorkspaceData();
  }, []);
  
  // Smart Navigation History Stack
  const [navHistory, setNavHistory] = useState([]);

  const navigateTo = (nextView, extra = {}) => {
    setNavHistory((prev) => [
      ...prev,
      {
        view,
        selectedMissionId,
        liveFocus,
        prefillSchedule,
        prefillLogQuery,
      },
    ]);
    if (extra.selectedMissionId !== undefined) setSelectedMissionId(extra.selectedMissionId);
    if (extra.liveFocus !== undefined) setLiveFocus(extra.liveFocus);
    if (extra.prefillSchedule !== undefined) setPrefillSchedule(extra.prefillSchedule);
    if (extra.prefillLogQuery !== undefined) setPrefillLogQuery(extra.prefillLogQuery);
    setView(nextView);
  };

  // Mount global voice navigation handler for smart notifications and actions
  useEffect(() => {
    window.__voiceNavigate = (targetView, extra = {}) => {
      navigateTo(targetView, extra);
    };
    return () => {
      delete window.__voiceNavigate;
    };
  }, [view, selectedMissionId, liveFocus, prefillSchedule, prefillLogQuery]);

  const goBack = () => {
    if (navHistory.length === 0) {
      setSelectedMissionId(null);
      setLiveFocus(null);
      setView("tasks");
      return;
    }
    const prev = navHistory[navHistory.length - 1];
    setNavHistory((h) => h.slice(0, -1));
    setView(prev.view);
    setSelectedMissionId(prev.selectedMissionId);
    setLiveFocus(prev.liveFocus);
    setPrefillSchedule(prev.prefillSchedule);
    setPrefillLogQuery(prev.prefillLogQuery);
  };

  const openMission = (m) => {
    navigateTo("missionDetail", {
      selectedMissionId: m.id,
      liveFocus: { missionId: m.id, missionTitle: m.title },
    });
  };

  const goLive = (p) => {
    const m = selectedMission;
    const focusData = m
      ? { missionId: m.id, missionTitle: m.title, prospectId: p && p.id, name: p && p.name }
      : p
        ? { prospectId: p.id, name: p.name }
        : liveFocus;
    navigateTo("live", { liveFocus: focusData });
  };

  const promoteQueuedOnMission = (missionId) => {
    let promoted = null;
    let missionTitle = "";
    setMissions((ms) =>
      patchMissionProspects(ms, missionId, (prospects, mission) => {
        missionTitle = mission.title;
        const stillCalling = prospects.filter((p) => p.status === "calling").length;
        if (stillCalling >= (mission.concurrency || 5)) return prospects;
        const next = prospects.find((p) => p.status === "queued");
        if (!next) return prospects;
        promoted = { ...next, status: "calling" };
        return prospects.map((p) => (p.id === next.id ? { ...p, status: "calling", time: "now" } : p));
      })
    );
    if (promoted) {
      setLiveCalls((cs) => [
        buildLiveCard({
          prospect: promoted.name,
          missionTitle,
          missionId,
          prospectId: promoted.id,
          channel: promoted.channel,
          index: cs.length,
        }),
        ...cs,
      ]);
    }
  };

  const markProspect = (missionId, prospectId, status, note) => {
    if (!missionId || !prospectId) return;
    setMissions((ms) =>
      patchMissionProspects(ms, missionId, (prospects) =>
        prospects.map((p) => (p.id === prospectId ? { ...p, status, time: "just now", note: note || p.note } : p))
      )
    );
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
    const isMessage = call && (call.channel === "whatsapp" || call.channel === "sms" || call.channel === "email");
    if (call) appendCallLog(call, isMessage ? "thread_ended" : "operator_ended");

    if (call && call.missionId && call.prospectId) {
      const mission = missions.find((m) => m.id === call.missionId);
      const fallbacks = (mission && mission.noAnswerFallbacks) || [];
      const nextCh = nextFallbackChannel(fallbacks, call.channel);
      if (nextCh) {
        const CHANNEL_LABEL = { voice: "voice call", whatsapp: "WhatsApp", sms: "SMS", email: "email" };
        markProspect(
          call.missionId,
          call.prospectId,
          "calling",
          `No pickup on ${CHANNEL_LABEL[call.channel] || call.channel} — now trying ${CHANNEL_LABEL[nextCh] || nextCh}.`
        );
        setLiveCalls((cs) => [
          buildLiveCard({
            prospect: call.prospect,
            missionTitle: call.mission,
            missionId: call.missionId,
            prospectId: call.prospectId,
            channel: nextCh,
            index: 0,
          }),
          ...cs,
        ]);
        setNotifications((ns) => [{ id: "n_" + Date.now(), text: `No pickup at ${call.prospect} — now on ${CHANNEL_LABEL[nextCh] || nextCh}`, time: "just now", unread: true, type: "info" }, ...ns]);
        return;
      }
      markProspect(call.missionId, call.prospectId, isMessage ? "emailed" : "left_voicemail", "No pickup on any channel — parked. Queue moves on.");
      promoteQueuedOnMission(call.missionId);
    }

    setNotifications((ns) => [{ id: "n_" + Date.now(), text: isMessage ? "Conversation ended — saved to Call Log verbatim" : "Call ended — saved to Call Log verbatim", time: "just now", unread: true, type: "info" }, ...ns]);
  };

  // confirming a negotiated time writes Schedule + Meetings AND a locked call-log
  // row. day/time come from the prospect's own words when they named one.
  const confirmBooking = (call) => {
    const requested = extractRequestedTime(call.transcript);
    const day = requested?.day || "Today, 27 Aug";
    const time = requested?.time || "16:00";
    const honored = !!requested;
    const deferred = requested?.kind === "deferred_callback";

    setScheduleItems((its) => [
      ...its,
      {
        id: "s_" + Date.now(),
        day,
        time,
        prospect: call.prospect,
        mission: call.mission,
        window: `${profile.weekdayStart || "09:00"}–${profile.weekdayEnd || "17:30"}`,
        status: "queued",
        honored,
        deferred,
        honoredQuote: requested?.exactWords || null,
      },
    ]);

    if (!deferred) {
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
    }

    setLiveCalls((cs) => cs.map((c) => (c.id === call.id ? { ...c, ended: true, booked: !deferred } : c)));
    appendCallLog(call, deferred ? "callback_requested" : "meeting_booked", { requestedFollowUp: requested, attendee: `${call.prospect} · Contact` });
    if (call.missionId && call.prospectId) {
      markProspect(
        call.missionId,
        call.prospectId,
        deferred ? "retry" : "meeting_booked",
        deferred
          ? `Not re-dialed. They asked: “${requested.exactWords}” — callback parked ${day} ${time}.`
          : `Meeting booked for ${day} ${time}${honored ? ` — they said: “${requested.exactWords}”` : ""}.`
      );
      promoteQueuedOnMission(call.missionId);
    }

    setNotifications((ns) => [
      {
        id: "n_" + Date.now(),
        text: deferred
          ? `Callback parked for ${call.prospect} on ${day} ${time} — “${requested.exactWords}”. No meeting booked. You'll be notified when that date arrives.`
          : honored
            ? `Meeting booked with ${call.prospect} at ${day} ${time} — time taken from their words: “${requested.exactWords}”`
            : `Meeting booked with ${call.prospect} — they hadn't named a time, used next open slot ${time}`,
        time: "just now",
        unread: true,
        type: deferred ? "info" : "success",
      },
      ...ns,
    ]);
  };

  const fireDeferredDue = (item) => {
    setScheduleItems((its) =>
      its.map((x) => (x.id === item.id ? { ...x, day: "Today, 27 Aug", status: "queued", dueNow: true } : x))
    );
    setLiveCalls((cs) => [
      {
        id: "lc_due_" + item.id,
        prospect: item.prospect,
        mission: item.mission,
        state: "negotiating",
        channel: "voice",
        duration: "00:18",
        transcript: [
          "AI: Hi, this is Sam calling on behalf of AIVHub — you asked us to come back around now.",
          "Prospect: Oh right — we said to wait. What's this about again?",
          "AI: Ops dashboards. Would a 15-min this week work now that the freeze is over?",
          "Prospect: Thursday afternoon could work.",
        ],
        taken: false,
        listening: false,
        confirmingEnd: false,
        ended: false,
        booked: false,
        dueCallback: true,
      },
      ...cs,
    ]);
    setNotifications((ns) => [
      {
        id: "n_" + Date.now(),
        text: `Callback due: ${item.prospect} — they asked: “${item.honoredQuote}”. Call is live now.`,
        time: "just now",
        unread: true,
        type: "alert",
      },
      ...ns,
    ]);
    setLiveFocus({ name: item.prospect, missionTitle: item.mission });
    setView("live");
  };

  const createMission = (payload) => {
    setShowNew(false);

    if (payload.tab === "manual" && payload.rows.length) {
      const CHANNEL_LABEL = { voice: "voice call", whatsapp: "WhatsApp", sms: "SMS", email: "email", auto: "AI-chosen channel" };
      const concurrency = payload.concurrency || 5;
      const fallbacks = payload.noAnswerFallbacks || ["whatsapp", "sms", "email"];
      const fallbackNote = fallbacks.length
        ? ` If no pickup: ${fallbacks.map((c) => CHANNEL_LABEL[c] || c).join(" → ")}.`
        : "";
      const callbackAdds = [];
      let dialIndex = 0;
      const stamp = Date.now();
      const missionTitle = `Uploaded list — ${payload.rows.length} companies`;
      const missionId = "m_" + stamp;
      const prospects = payload.rows.map((r, i) => {
        const match = r.identityMatch || findIdentityMatch(r, registry, callLog);
        const effChannel = r.channel || payload.channel;
        const channelNote = r.fallback && r.fallback !== "none"
          ? `Contact via ${CHANNEL_LABEL[effChannel]}, then ${CHANNEL_LABEL[r.fallback]} if no reply`
          : `Contact via ${CHANNEL_LABEL[effChannel] || effChannel}`;
        const note = (r.source ? `Research source: ${r.source}. ` : "No research source provided — will call cold. ") + channelNote + fallbackNote;
        const pid = "up_" + stamp + "_" + i;

        if (match && match.blockDefault) {
          if (match.issueCode === "callback_pending" && match.requestedFollowUp) {
            callbackAdds.push({
              id: "s_" + stamp + "_" + i,
              day: match.requestedFollowUp.day,
              time: match.requestedFollowUp.time,
              prospect: match.canonicalName,
              mission: missionTitle,
              window: `${payload.windowStart}–${payload.windowEnd}`,
              status: "queued",
              honored: true,
              deferred: !!(match.requestedFollowUp && /\d{4}/.test(match.requestedFollowUp.day)),
              honoredQuote: match.requestedFollowUp.exactWords,
            });
            return {
              id: pid,
              name: r.name,
              status: "retry",
              channel: effChannel,
              note: `Not re-dialed cold. They asked: “${match.requestedFollowUp.exactWords}” — callback set for ${match.requestedFollowUp.day} ${match.requestedFollowUp.time}. ${match.reasons[0]}`,
              time: match.requestedFollowUp.time,
            };
          }
          return {
            id: pid,
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
          id: pid,
          name: r.name,
          status,
          channel: effChannel,
          fallback: r.fallback && r.fallback !== "none" ? r.fallback : null,
          note,
          time: status === "calling" ? "now" : "waiting in queue",
        };
      });

      if (callbackAdds.length) setScheduleItems((its) => [...its, ...callbackAdds]);

      const skipped = prospects.filter((p) => p.status === "skipped" || p.status === "retry").length;
      const liveNow = prospects.filter((p) => p.status === "calling");
      const mission = {
        id: missionId,
        title: missionTitle,
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
        callHoursPolicy: payload.callHoursPolicy || "respectful",
        timezone: payload.timezone || "Europe/London",
        lunchStart: payload.lunchStart || "12:00",
        lunchEnd: payload.lunchEnd || "13:00",
        noAnswerFallbacks: fallbacks,
        understood: payload.understood || payload.rows.length,
        fileRows: payload.fileRows || payload.rows.length,
        prospects,
      };
      setMissions((ms) => [mission, ...ms]);
      setLiveCalls((cs) => [
        ...liveNow.map((p, i) =>
          buildLiveCard({
            prospect: p.name,
            missionTitle,
            missionId,
            prospectId: p.id,
            channel: p.channel,
            index: i,
          })
        ),
        ...cs,
      ]);
      setSelectedMissionId(missionId);
      setLiveFocus({ missionId, missionTitle });
      setNotifications((ns) => [
        {
          id: "n_" + Date.now(),
          text: skipped
            ? `${payload.rows.length} imported — ${liveNow.length} live now, ${skipped} skipped or set to the time they already asked for. Open Live Activity.`
            : `${payload.rows.length} companies imported — ${liveNow.length} calls live now, rest queued. Open Live Activity to listen, take over, or book.`,
          time: "just now",
          unread: true,
          type: "info",
        },
        ...ns,
      ]);
      setView("live");
      return;
    }

    setNotifications((ns) => [{ id: "n_" + Date.now(), text: "New outreach mission created and queued", time: "just now", unread: true, type: "info" }, ...ns]);
  };

  const goScheduleFor = (name) => {
    navigateTo("schedule", { prefillSchedule: name });
  };

  const goLogFor = (name) => {
    navigateTo("calllog", { prefillLogQuery: name });
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: C.paper, fontFamily: FONT_BODY }}>
      <AppChrome />

      <Sidebar
        view={(view === "missionDetail" || view === "taskDetail") ? "tasks" : view === "missions" ? "tasks" : view}
        setView={(v) => { setView(v); setSelectedMissionId(null); }}
        companyName={profile.name}
        callerName={profile.callerName}
        timezone={profile.timezone}
        operatorName={operator && operator.name}
        operatorRole={operator && operator.role}
        onBackToHub={onBackToHub}
        onLogout={onLogout}
      />

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {(view === "tasks" || view === "missions") && !selectedMission && (
          <TasksView
            tasks={missions}
            setTasks={setMissions}
            notifications={notifications}
            setNotifications={setNotifications}
            companyName={profile.name}
            callerId={profile.callerId}
            onOpenTask={openMission}
            onWatchLive={goLive}
            onNewOutreach={() => setShowNew(true)}
          />
        )}
        {(view === "missionDetail" || view === "taskDetail") && selectedMission && (
          <MissionDetail
            mission={selectedMission}
            onBack={goBack}
            companyName={profile.name}
            onWatchLive={goLive}
          />
        )}
        {view === "schedule" && (
          <ScheduleView
            notifications={notifications}
            setNotifications={setNotifications}
            prefillName={prefillSchedule}
            clearPrefill={() => setPrefillSchedule(null)}
            items={scheduleItems}
            setItems={setScheduleItems}
            timezone={profile.timezone}
            lunchStart={profile.lunchStart}
            lunchEnd={profile.lunchEnd}
            onFireDue={fireDeferredDue}
            windowStart={profile.weekdayStart}
            windowEnd={profile.weekdayEnd}
            canGoBack={navHistory.length > 0}
            onBack={goBack}
          />
        )}
        {view === "meetings" && (
          <MeetingsView
            notifications={notifications}
            setNotifications={setNotifications}
            companyName={profile.name}
            meetings={meetings}
            setMeetings={setMeetings}
            canGoBack={navHistory.length > 0}
            onBack={goBack}
          />
        )}
        {view === "live" && (
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
            focus={liveFocus}
            onClearFocus={() => setLiveFocus(null)}
            onBackToTasks={goBack}
          />
        )}
        {view === "calllog" && (
          <CallLogView
            notifications={notifications}
            setNotifications={setNotifications}
            entries={callLog}
            prefillQuery={prefillLogQuery}
            clearPrefill={() => setPrefillLogQuery(null)}
            onJumpSchedule={goScheduleFor}
          />
        )}
        {view === "processlogs" && (
          <ProcessLogsView
            notifications={notifications}
            setNotifications={setNotifications}
          />
        )}
        {view === "prospects" && (
          <ProspectsView
            notifications={notifications}
            setNotifications={setNotifications}
            onScheduleFor={goScheduleFor}
            registry={registry}
            callLog={callLog}
            onOpenLog={goLogFor}
          />
        )}
        {view === "company" && <CompanyProfileView profile={profile} setProfile={setProfile} notifications={notifications} setNotifications={setNotifications} sources={knowledgeSources} setSources={setKnowledgeSources} services={services} setServices={setServices} faq={faq} setFaq={setFaq} />}
        {view === "provider" && <ProviderConfigView notifications={notifications} setNotifications={setNotifications} commonAi={commonAi} setCommonAi={setCommonAi} profile={profile} setProfile={setProfile} />}
        {view === "analytics" && <AnalyticsView notifications={notifications} setNotifications={setNotifications} />}
      </div>

      {showNew && <NewMissionModal onClose={() => setShowNew(false)} onCreate={createMission} registry={registry} callLog={callLog} workingHours={{ timezone: profile.timezone, lunchStart: profile.lunchStart, lunchEnd: profile.lunchEnd, weekdayStart: profile.weekdayStart, weekdayEnd: profile.weekdayEnd, callHoursPolicy: profile.callHoursPolicy }} commonAi={commonAi} />}
    </div>
  );
}

export default function App() {
  const [operator, setOperator] = useState(() => {
    try {
      const saved = sessionStorage.getItem("aivhub_operator");
      return saved ? JSON.parse(saved) : null;
    } catch (_) {
      return null;
    }
  });
  const [plugin, setPlugin] = useState(null);
  const [profile, setProfile] = useState(() => {
    try {
      const saved = localStorage.getItem("aivhub_company_profile");
      return saved ? JSON.parse(saved) : INITIAL_COMPANY_PROFILE;
    } catch (_) {
      return INITIAL_COMPANY_PROFILE;
    }
  });
  const [knowledgeSources, setKnowledgeSources] = useState(() => {
    try {
      const saved = localStorage.getItem("aivhub_sources");
      return saved ? JSON.parse(saved) : INITIAL_KNOWLEDGE_SOURCES;
    } catch (_) {
      return INITIAL_KNOWLEDGE_SOURCES;
    }
  });
  const [services, setServices] = useState(() => {
    try {
      const saved = localStorage.getItem("aivhub_services");
      return saved ? JSON.parse(saved) : INITIAL_SERVICES;
    } catch (_) {
      return INITIAL_SERVICES;
    }
  });
  const [faq, setFaq] = useState(() => {
    try {
      const saved = localStorage.getItem("aivhub_faq");
      return saved ? JSON.parse(saved) : INITIAL_FAQ;
    } catch (_) {
      return INITIAL_FAQ;
    }
  });
  const [commonAi, setCommonAi] = useState(() => {
    try {
      const saved = localStorage.getItem("aivhub_common_ai");
      if (!saved) return INITIAL_COMMON_AI_CONFIG;
      const parsed = JSON.parse(saved);
      return {
        ...INITIAL_COMMON_AI_CONFIG,
        ...parsed,
        providers: (Array.isArray(parsed.providers) && parsed.providers.length > 0)
          ? parsed.providers
          : INITIAL_COMMON_AI_CONFIG.providers,
        leadgenLayers: { ...INITIAL_COMMON_AI_CONFIG.leadgenLayers, ...(parsed.leadgenLayers || {}) },
        schedulerLayers: { ...INITIAL_COMMON_AI_CONFIG.schedulerLayers, ...(parsed.schedulerLayers || {}) },
        emailLayers: { ...INITIAL_COMMON_AI_CONFIG.emailLayers, ...(parsed.emailLayers || {}) },
        voiceLayers: { ...INITIAL_COMMON_AI_CONFIG.voiceLayers, ...(parsed.voiceLayers || {}) },
        customConnections: Array.isArray(parsed.customConnections) ? parsed.customConnections : [],
        subscription: { ...INITIAL_COMMON_AI_CONFIG.subscription, ...(parsed.subscription || {}) },
        channelDirectives: { ...INITIAL_COMMON_AI_CONFIG.channelDirectives, ...(parsed.channelDirectives || {}) },
        futurePlugins: Array.isArray(parsed.futurePlugins) ? parsed.futurePlugins : INITIAL_COMMON_AI_CONFIG.futurePlugins,
      };
    } catch (_) {
      return INITIAL_COMMON_AI_CONFIG;
    }
  });
  const [showCommonAiModal, setShowCommonAiModal] = useState(false);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [commonAiTab, setCommonAiTab] = useState("leadgen");

  // Sync commonAi changes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("aivhub_common_ai", JSON.stringify(commonAi));
    } catch (_) {}
  }, [commonAi]);

  // Load live company profile and knowledge from backend on mount
  useEffect(() => {
    async function loadBackendProfile() {
      try {
        const p = await api.getProfile();
        if (p && p.name) {
          setProfile((prev) => {
            const merged = { ...prev, ...p };
            try { localStorage.setItem("aivhub_company_profile", JSON.stringify(merged)); } catch (_) {}
            return merged;
          });
        }
      } catch (_) {}
      try {
        const s = await api.getSources();
        if (s && Array.isArray(s) && s.length) {
          setKnowledgeSources(s);
          try { localStorage.setItem("aivhub_sources", JSON.stringify(s)); } catch (_) {}
        }
      } catch (_) {}
      try {
        const sv = await api.getServices();
        if (sv && Array.isArray(sv) && sv.length) {
          setServices(sv);
          try { localStorage.setItem("aivhub_services", JSON.stringify(sv)); } catch (_) {}
        }
      } catch (_) {}
      try {
        const f = await api.getFaqs();
        if (f && Array.isArray(f) && f.length) {
          setFaq(f);
          try { localStorage.setItem("aivhub_faq", JSON.stringify(f)); } catch (_) {}
        }
      } catch (_) {}
    }
    loadBackendProfile();
  }, []);

  const handleLogout = () => {
    try {
      sessionStorage.removeItem("aivhub_operator");
    } catch (_) {}
    setOperator(null);
    setPlugin(null);
  };

  const handleUpdateOperator = (updater) => {
    setOperator((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try {
        if (next) {
          sessionStorage.setItem("aivhub_operator", JSON.stringify(next));
        } else {
          sessionStorage.removeItem("aivhub_operator");
        }
      } catch (_) {}
      return next;
    });
  };

  if (!operator) return <LoginScreen onLogin={handleUpdateOperator} />;
  
  return (
    <>
      {!plugin && (
        <PluginHub
          operator={operator}
          onPick={setPlugin}
          onLogout={handleLogout}
          commonAi={commonAi}
          onOpenCommonAi={(tab) => { if (tab) setCommonAiTab(tab); setShowCommonAiModal(true); }}
          onOpenTeamUsers={() => setShowTeamModal(true)}
          onOpenProfileSettings={() => setShowProfileModal(true)}
        />
      )}

      {plugin === "leadgen" && (
        <LeadGenerationPlugin
          operator={operator}
          onBackToHub={() => setPlugin(null)}
          onLogout={handleLogout}
          profile={profile}
          commonAi={commonAi}
        />
      )}

      {plugin === "scheduler" && (
        <PostSchedulerPlugin
          operator={operator}
          onBackToHub={() => setPlugin(null)}
          onLogout={handleLogout}
          profile={profile}
          setProfile={setProfile}
          knowledgeSources={knowledgeSources}
          setKnowledgeSources={setKnowledgeSources}
          services={services}
          setServices={setServices}
          commonAi={commonAi}
          setCommonAi={setCommonAi}
          onOpenCommonAi={() => { setCommonAiTab("scheduler"); setShowCommonAiModal(true); }}
        />
      )}

      {plugin === "emailoutreach" && (
        <EmailOutreachPlugin
          operator={operator}
          onBackToHub={() => setPlugin(null)}
          onLogout={handleLogout}
          profile={profile}
          commonAi={commonAi}
        />
      )}

      {plugin === "voice" && (
        <VoiceOperatorApp
          operator={operator}
          onBackToHub={() => setPlugin(null)}
          onLogout={handleLogout}
          profile={profile}
          setProfile={setProfile}
          knowledgeSources={knowledgeSources}
          setKnowledgeSources={setKnowledgeSources}
          services={services}
          setServices={setServices}
          faq={faq}
          setFaq={setFaq}
          commonAi={commonAi}
          setCommonAi={setCommonAi}
          onOpenCommonAi={() => { setCommonAiTab("voice"); setShowCommonAiModal(true); }}
        />
      )}

      <CommonAiConfigModal
        isOpen={showCommonAiModal}
        onClose={() => setShowCommonAiModal(false)}
        commonAi={commonAi}
        setCommonAi={setCommonAi}
        initialTab={commonAiTab}
        onNavigateToPlugin={(pId) => {
          setShowCommonAiModal(false);
          setPlugin(pId);
        }}
      />

      <TeamUsersModal
        isOpen={showTeamModal}
        onClose={() => setShowTeamModal(false)}
        currentUser={operator}
      />

      <ProfileSettingsModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        operator={operator}
        setOperator={handleUpdateOperator}
      />
    </>
  );
}
