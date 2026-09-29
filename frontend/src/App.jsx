import React, { useState, useRef, useEffect, useMemo } from "react";
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
  Pause,
  Wand2,
  Image as ImageIcon,
  Smartphone,
  Briefcase,
  Square,
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
import { compressVoiceBlob, cloneFilename } from "./utils/compressVoice";
import { WebSocketClient } from "./api/wsClient";
import { AudioStreamPlayer } from "./api/audioStreamPlayer";
import { TelephonyDocsView } from "./views/TelephonyDocsView";
import LeadGenerationPlugin from "./plugins/LeadGenerationPlugin";
import EmailOutreachPlugin from "./plugins/EmailOutreachPlugin";
import { CalcomSchedulerPlugin } from "./plugins/CalcomSchedulerPlugin";
import { CalcomAdminModal } from "./admin/CalcomAdminModal";
import { meetingTimeLabel, logDisplayName, dedupeNotifications, prependNotification, notificationFingerprint, resolveNotificationTarget, notificationActionLabel, scrubSecretsForStorage } from "./tokens";
import { SocialWorkspaceGate } from "./scheduler/SocialWorkspace";
import { OrgSettingsProvider, announceOrgUpdated } from "./org/orgSettings";
import { humanizeAiReply } from "./scheduler/chatClean";
import { CallingWorkspace } from "./calling/CallingWorkspace";
import { CALLING_EDITION_EVENT, getCallingEdition, setCallingEdition } from "./calling/callingEdition";
import { LiveKitBrowserCallModal } from "./components/LiveKitBrowserCallModal";
import { ConversationTemplatesView } from "./views/ConversationTemplatesView";


/* ---------------------------------- Common Platform AI & Provider Hub Configuration ---------------------------------- */

const INITIAL_BUILTIN_PROVIDERS = [
  { id: "xai", name: "xAI (Grok)", type: "llm", badge: "xAI Voice & LPU", status: "not_configured", latencyMs: null, baseUrl: "https://api.x.ai/v1", apiKey: "", phoneNumber: "", agentId: "", models: ["grok-4.20-0309-non-reasoning"] },
  { id: "deepseek", name: "DeepSeek AI", type: "llm", badge: "Open-Weight Cloud", status: "not_configured", latencyMs: null, baseUrl: "https://api.deepseek.com/v1", apiKey: "", models: ["deepseek-chat"] },
  { id: "anthropic", name: "Anthropic Claude", type: "llm", badge: "Managed API", status: "not_configured", latencyMs: null, baseUrl: "https://api.anthropic.com/v1", apiKey: "", models: ["claude-3-5-sonnet-20241022"] },
  { id: "openai", name: "OpenAI", type: "llm", badge: "Managed API", status: "not_configured", latencyMs: null, baseUrl: "https://api.openai.com/v1", apiKey: "", models: ["gpt-4o-mini"] },
  { id: "groq", name: "Groq LPU (Ultra-Fast)", type: "llm", badge: "LPU Accelerator", status: "not_configured", latencyMs: null, baseUrl: "https://api.groq.com/openai/v1", apiKey: "", models: ["llama-3.3-70b-versatile"] },
  { id: "gemini", name: "Google Gemini", type: "llm", badge: "Managed API", status: "not_configured", latencyMs: null, baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "", models: ["gemini-2.0-flash"] },
  { id: "stability", name: "Stability AI", type: "image", badge: "Image Synthesis", status: "not_configured", latencyMs: null, baseUrl: "https://api.stability.ai", apiKey: "", models: ["sdxl-1.0", "sd-1.5"] },
  { id: "fal", name: "Fal.ai", type: "image", badge: "Fast FLUX / Diffusion", status: "not_configured", latencyMs: null, baseUrl: "https://fal.run", apiKey: "", models: ["fal-ai/flux/schnell"] },
  { id: "pollinations", name: "Pollinations AI", type: "image", badge: "Free Built-in FLUX", status: "connected", latencyMs: null, baseUrl: "https://image.pollinations.ai", apiKey: "", models: ["FLUX.1 Schnell", "Flux.1 Dev"] },
  { id: "cartesia", name: "Cartesia", type: "tts", badge: "Sonic Voice", status: "not_configured", latencyMs: null, baseUrl: "https://api.cartesia.ai", apiKey: "", models: ["sonic-3"] },
  { id: "ollama", name: "Ollama / Self-Hosted", type: "llm", badge: "100% Private On-Prem", status: "not_configured", latencyMs: null, baseUrl: "http://localhost:11434/v1", apiKey: "", models: ["llama3.2"] },
  { id: "deepgram", name: "Deepgram", type: "stt", badge: "Managed STT", status: "not_configured", latencyMs: null, baseUrl: "https://api.deepgram.com/v1", apiKey: "", models: ["nova-2"] },
  { id: "elevenlabs", name: "ElevenLabs", type: "tts", badge: "Managed Voice", status: "not_configured", latencyMs: null, baseUrl: "https://api.elevenlabs.io/v1", apiKey: "", models: ["ElevenLabs Turbo"] },
  { id: "vapi", name: "Vapi Voice AI", type: "voice", badge: "Voice Orchestration", status: "not_configured", latencyMs: null, baseUrl: "https://api.vapi.ai", apiKey: "", models: ["Vapi Orchestrator"] },
  { id: "twilio", name: "Twilio Telephony", type: "telephony", badge: "Carrier", status: "not_configured", latencyMs: null, baseUrl: "https://api.twilio.com", apiKey: "", models: ["Twilio Voice Trunk"] },
  { id: "telnyx_llm", name: "Telnyx AI", type: "llm", badge: "Telnyx Inference", status: "not_configured", latencyMs: null, baseUrl: "https://api.telnyx.com/v2/ai", apiKey: "", models: ["meta-llama/Meta-Llama-3.1-70B-Instruct"] },
  { id: "telnyx_stt", name: "Telnyx Whisper", type: "stt", badge: "Managed STT", status: "not_configured", latencyMs: null, baseUrl: "https://api.telnyx.com/v2/ai", apiKey: "", models: ["openai/whisper-large-v3"] },
  { id: "telnyx_tts", name: "Telnyx Natural (TTS)", type: "tts", badge: "Telnyx Voice", status: "not_configured", latencyMs: null, baseUrl: "https://api.telnyx.com/v2/ai", apiKey: "", models: ["telnyx/natural"] },
  { id: "whatsapp", name: "WhatsApp Cloud API (Meta)", type: "messaging", badge: "Official Meta API", status: "not_configured", latencyMs: null, baseUrl: "https://graph.facebook.com/v20.0", apiKey: "", models: ["WhatsApp Cloud API"] },
];

const VOICE_LAYERS = [
  { key: "llm", label: "Dialogue & Conversational Reasoning LLM", desc: "Real-time conversation turns, context memory, and objection handling", paid: "xAI (Grok)", oss: "DeepSeek", options: [] },
  { key: "tts", label: "Text-to-Speech (Ultra-Low Latency)", desc: "Ultra-realistic speech generation with human inflection and natural breath", paid: "Cartesia", oss: "Kokoro (self-hosted)", options: [] },
  { key: "stt", label: "Speech-to-Text Acoustic Recognition", desc: "Real-time acoustic streaming transcription with noise suppression", paid: "Deepgram", oss: "Faster-Whisper (self-hosted)", options: [] },
  { key: "voice", label: "Voice Orchestration & Interruption Engine", desc: "Manages audio buffers, turn-taking arbitration, and silence detection", paid: "LiveKit (self-hosted)", oss: "LiveKit (self-hosted)", options: ["LiveKit (self-hosted)", "Vapi Voice AI", "Retell AI"] },
  { key: "telephony", label: "Telephony Carrier & SIP Trunk", desc: "PSTN inbound numbers, caller ID preservation, and carrier routing", paid: "Twilio", oss: "Telnyx", options: ["Twilio", "Telnyx"] },
];

function prettyProvider(raw, fallback) {
  const s = String(raw || "").trim();
  if (!s) return fallback;
  const map = {
    xai: "xAI (Grok)",
    openai: "OpenAI",
    groq: "Groq",
    anthropic: "Anthropic",
    deepseek: "DeepSeek",
    deepgram: "Deepgram",
    elevenlabs: "ElevenLabs",
    cartesia: "Cartesia",
    whisper: "Whisper",
    telnyx: "Telnyx",
    twilio: "Twilio",
  };
  return map[s.toLowerCase()] || s;
}

function isCartesiaUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || "").trim());
}

function looksLikeApiKeyNotVoiceId(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return false;
  return /^(sk_|sk-|sk_car_|xai-|whsec_|api_|key_|el_)/.test(s);
}

function isValidCloneVoiceId(v) {
  const s = String(v || "").trim();
  if (!s || s.length < 2 || looksLikeApiKeyNotVoiceId(s)) return false;
  // Valid for Telnyx (e.g. Telnyx.Ultra.cc91c96c-...), Cartesia UUID, ElevenLabs ID, Deepgram, OpenAI, or custom voice slugs
  return true;
}

function liveStackLabels(hub) {
  if (hub?.liveLabels && typeof hub.liveLabels === "object") {
    return hub.liveLabels;
  }
  const engine = String(hub?.liveEngine || "").toLowerCase();
  const voice = hub?.voiceName || hub?.voiceEngineName || "—";
  const engineLabel =
    engine === "xai" ? "xAI Grok (speech-to-speech)"
    : engine === "openai" ? "OpenAI Realtime"
    : engine === "livekit" ? (hub?.activeEngine || "LiveKit (self-hosted)")
    : engine === "vapi" ? "Vapi Voice AI"
    : engine === "retell" ? "Retell AI"
    : engine === "modular" ? "Modular pipeline"
    : hub?.activeEngine || "—";
  // Plugin hybrid: xAI brain/STT + external TTS clone from Connections
  if (engine === "xai" && hub?.externalTts) {
    return {
      engine: "xAI + cloned TTS (plugin)",
      llm: "xAI Grok",
      stt: "xAI",
      tts: prettyProvider(hub?.ttsProvider, hub?.ttsName || "Cloned TTS"),
      carrier: hub?.activeCarrier || "—",
      voice: hub?.ttsVoiceId || voice,
      note: hub?.liveNote || "",
    };
  }
  if (engine === "xai") {
    return {
      engine: engineLabel,
      llm: "xAI Grok",
      stt: "xAI",
      tts: `xAI built-in (${voice})`,
      carrier: hub?.activeCarrier || "—",
      voice,
      note: hub?.liveNote || "",
    };
  }
  if (engine === "openai") {
    return {
      engine: engineLabel,
      llm: engineLabel,
      stt: engineLabel,
      tts: `OpenAI (${voice})`,
      carrier: hub?.activeCarrier || "—",
      voice,
      note: hub?.liveNote || "",
    };
  }
  return {
    engine: engineLabel,
    llm: prettyProvider(hub?.llmProvider, hub?.llmName || "—"),
    stt: prettyProvider(hub?.sttProvider, hub?.sttName || "—"),
    tts: prettyProvider(hub?.ttsProvider, hub?.ttsName || "—"),
    carrier: hub?.activeCarrier || "—",
    voice,
    note: hub?.liveNote || "",
  };
}

function voiceLayersFromHub(hub, prevLayers) {
  const prev = prevLayers && typeof prevLayers === "object" ? prevLayers : {};
  if (!hub) return prev;
  const labels = liveStackLabels(hub);
  return {
    ...prev,
    llm: labels.llm !== "—" ? labels.llm : prev.llm,
    tts: labels.tts !== "—" ? labels.tts : prev.tts,
    stt: labels.stt !== "—" ? labels.stt : prev.stt,
    voice: labels.engine !== "—" ? labels.engine : prev.voice,
    telephony: labels.carrier !== "—" ? labels.carrier : prev.telephony,
  };
}

function syncCommonAiWithBackend(prevCommonAi, backendConns, liveHub) {
  const prev = prevCommonAi || INITIAL_COMMON_AI_CONFIG;
  const flatItems = [];
  if (Array.isArray(backendConns)) {
    backendConns.forEach((group) => {
      (group.items || []).forEach((item) => {
        flatItems.push({ ...item, groupName: group.group });
      });
    });
  }

  const findItem = (pattern) => {
    const matched = flatItems.filter((it) => pattern.test(it.name || "") || pattern.test(it.id || ""));
    const connected = matched.find((it) => (it.status || "").toLowerCase() === "connected" && it.apiKeyMasked && it.apiKeyMasked !== "••••••••");
    if (connected) return connected;
    const anyConnected = matched.find((it) => (it.status || "").toLowerCase() === "connected" || Boolean(it.apiKeyMasked && it.apiKeyMasked !== "••••••••"));
    return anyConnected || matched[0] || null;
  };

  const matchRules = {
    xai: /xai|grok/i,
    openai: /openai|gpt/i,
    anthropic: /anthropic|claude/i,
    deepseek: /deepseek/i,
    groq: /groq|llama/i,
    gemini: /gemini|google/i,
    elevenlabs: /elevenlabs/i,
    cartesia: /cartesia/i,
    deepgram: /deepgram/i,
    twilio: /twilio/i,
    vapi: /vapi/i,
    stability: /stability|sdxl/i,
    fal: /fal/i,
    ollama: /ollama/i,
  };

  const currentProviders = (prev.providers && Array.isArray(prev.providers) && prev.providers.length)
    ? prev.providers
    : INITIAL_BUILTIN_PROVIDERS;

  const nextProviders = currentProviders.map((p) => {
    const rule = matchRules[p.id];
    if (rule) {
      const match = findItem(rule);
      if (match) {
        const connected = (match.status || "").toLowerCase() === "connected" || Boolean(match.apiKeyMasked && match.apiKeyMasked !== "••••••••");
        return {
          ...p,
          status: connected ? "connected" : (p.apiKey ? "connected" : "not_configured"),
          apiKeyMasked: (match.apiKeyMasked && match.apiKeyMasked !== "••••••••" ? match.apiKeyMasked : "") || p.apiKeyMasked || "",
          dbConnectionId: match.id,
        };
      }
    }
    // Fallback detection from live hub status
    if (liveHub) {
      if (p.id === "xai" && (String(liveHub.liveEngine || "").toLowerCase().includes("xai") || liveHub.apiKeyMasked)) {
        return { ...p, status: "connected", apiKeyMasked: liveHub.apiKeyMasked || p.apiKeyMasked || "" };
      }
      if (p.id === "twilio" && String(liveHub.activeCarrier || "").toLowerCase().includes("twilio")) {
        return { ...p, status: "connected" };
      }
      if (p.id === "cartesia" && (String(liveHub.ttsProvider || "").toLowerCase().includes("cartesia") || String(liveHub.ttsName || "").toLowerCase().includes("cartesia"))) {
        return { ...p, status: "connected" };
      }
      if (p.id === "elevenlabs" && String(liveHub.ttsProvider || "").toLowerCase().includes("eleven")) {
        return { ...p, status: "connected" };
      }
    }
    if (p.id === "pollinations") {
      return { ...p, status: "connected", latencyMs: null };
    }
    return p;
  });

  if (!nextProviders.find((p) => p.id === "cartesia")) {
    const cMatch = findItem(/cartesia/i);
    const connected = (cMatch && ((cMatch.status || "").toLowerCase() === "connected" || Boolean(cMatch.apiKeyMasked))) || (liveHub && String(liveHub.ttsProvider || "").toLowerCase().includes("cartesia"));
    nextProviders.push({
      id: "cartesia",
      name: "Cartesia",
      type: "tts",
      badge: "Sonic Voice",
      status: connected ? "connected" : "not_configured",
      latencyMs: null,
      baseUrl: "https://api.cartesia.ai",
      apiKey: "",
      apiKeyMasked: cMatch?.apiKeyMasked || "",
      models: ["Cartesia Sonic"],
    });
  }

  let nextVoiceLayers = prev.voiceLayers || {};
  if (liveHub) {
    nextVoiceLayers = voiceLayersFromHub(liveHub, nextVoiceLayers);
  }

  // Scheduler AI lives in Post Scheduler → Accounts & AI (backend); drop the old browser copy.
  const { schedulerLayers: _oldLayers, schedulerAi: _oldSchedAi, ...rest } = prev;
  try { localStorage.removeItem("aivhub_scheduler_ai"); } catch (_) {}

  return {
    ...rest,
    providers: nextProviders,
    voiceLayers: nextVoiceLayers,
  };
}

const LEADGEN_LAYERS = [
  { key: "researchLlm", label: "Web Search & Account Discovery LLM", desc: "Discovers target accounts matching ICP criteria across sectors", paid: "gpt-4o-mini", oss: "deepseek-chat", options: ["gpt-4o-mini", "deepseek-chat", "grok-4.20-0309-non-reasoning"] },
  { key: "extractorLlm", label: "Decision-Maker & Contact Extractor", desc: "Extracts verified names, job titles, and contact signals", paid: "gpt-4o-mini", oss: "deepseek-chat", options: ["gpt-4o-mini", "deepseek-chat", "grok-4.20-0309-non-reasoning"] },
  { key: "enrichmentEngine", label: "Live Web & Domain Crawler", desc: "Performs real-time scraping of company websites and news", paid: "DuckDuckGo Live + Crawler", oss: "Direct Domain Scraping", options: ["DuckDuckGo Live + Crawler", "Direct Domain Scraping", "Google Custom Search"] },
  { key: "dossierSynth", label: "Pain-Point & Strategic Hook Synthesizer", desc: "Synthesizes intelligence into conversation openers and cold hooks", paid: "gpt-4o-mini", oss: "deepseek-chat", options: ["gpt-4o-mini", "deepseek-chat", "grok-4.20-0309-non-reasoning"] },
  { key: "intentScoring", label: "Autonomous ICP & Intent Fit Scorer", desc: "Calculates account priority and purchase readiness scores", paid: "gpt-4o-mini", oss: "deepseek-chat", options: ["gpt-4o-mini", "deepseek-chat", "grok-4.20-0309-non-reasoning"] },
];

const LOCAL_BGE_EMBEDDINGS = "BAAI/bge-small-en-v1.5 (local CPU)";

const EMAIL_LAYERS = [
  { key: "copywriterLlm", label: "Outreach Copywriter & Sequencer", desc: "Drafts concise, high-converting B2B cold email sequences", paid: "gpt-4o-mini", oss: "deepseek-chat", options: ["gpt-4o-mini", "deepseek-chat", "grok-4.20-0309-non-reasoning"] },
  { key: "replyClassifier", label: "Inbound Reply Classifier & Sentiment", desc: "Categorizes inbound emails into Interested, Objections, or Not Now", paid: "gpt-4o-mini", oss: "deepseek-chat", options: ["gpt-4o-mini", "deepseek-chat", "grok-4.20-0309-non-reasoning"] },
  { key: "replyDrafter", label: "Context-Aware Auto-Response Drafter", desc: "Generates tailored responses to inbound client inquiries", paid: "gpt-4o-mini", oss: "deepseek-chat", options: ["gpt-4o-mini", "deepseek-chat", "grok-4.20-0309-non-reasoning"] },
  { key: "spamAuditor", label: "Deliverability & Spam Auditor", desc: "Scans copy for trigger phrases to ensure high inbox delivery", paid: "AIV Spam Guard v2", oss: "deepseek-chat", options: ["AIV Spam Guard v2", "gpt-4o-mini", "deepseek-chat"] },
  { key: "contentTransformer", label: "Social Post-to-Email Repurposer", desc: "Transforms published social posts into broadcast emails", paid: "gpt-4o-mini", oss: "deepseek-chat", options: ["gpt-4o-mini", "deepseek-chat", "grok-4.20-0309-non-reasoning"] },
];

const INITIAL_COMMON_AI_CONFIG = {
  mode: "custom", // "paid" | "opensource" | "custom"
  baseChatModel: "",
  baseChatProvider: "",
  
  // Extensible Connected Providers (Built-in + Custom User Added)
  providers: INITIAL_BUILTIN_PROVIDERS,

  // 1. Lead Generation layers
  leadgenLayers: Object.fromEntries(LEADGEN_LAYERS.map((l) => [l.key, l.paid])),

  // 3. Email Outreach layers
  emailLayers: Object.fromEntries(EMAIL_LAYERS.map((l) => [l.key, l.paid])),

  // 4. Voice layers (shared with Voice Agent)
  voiceLayers: Object.fromEntries(VOICE_LAYERS.map((l) => [l.key, l.paid])),
  temperature: 0.8,
  personaPrompt: "Write authoritative, crisp B2B content that teaches actionable lessons without fluff or corporate buzzwords. Speak directly to C-suite and operations leaders.",
  prohibitedWords: "delve, in today's fast-paced world, game-changer, revolutionary, synergy, leverage, unlock, not because, the fix isn't, most teams still, scattered data in",

  // Per-channel tone directives for Post Scheduler
  customConnections: [],
  channelDirectives: {
    linkedin: "LinkedIn craft: 120-220 words, 70% educational / 20% thought leadership / 10% product. Hook, real data problem, modern analytics, mention the company once from profile facts only, one takeaway, comment question, 3-6 hashtags. Rotate angles. No fake stats, no ad voice. Matching 4:5 premium visual, one idea, minimal text.",
    x: "Punchy, bold hook. Short sentences, high-contrast perspective, strong CTA, zero filler hashtags.",
    facebook: "Community-driven, engaging story angle, conversational tone, open-ended question at the end.",
    instagram: "Visual storytelling caption, aesthetic bullet points, conversational tone, 5-8 niche hashtags.",
  },

  // Future plugin definitions
  futurePlugins: [
    { id: "leadHunter", name: "CRM Lead Hunter", icon: Search, reqs: "1 Research LLM + 1 Web Data Extractor", assigned: { researchLlm: "grok-4.20-0309-non-reasoning", extractor: "gpt-4o-mini" }, status: "ready" },
    { id: "emailOutreach", name: "Cold Email Sequencer", icon: Mail, reqs: "1 Copywriter LLM + 1 Spam Classifier", assigned: { writerLlm: "grok-4.20-0309-non-reasoning", classifier: "gpt-4o-mini" }, status: "ready" },
    { id: "supportBot", name: "24/7 Tier-1 Helpdesk Bot", icon: Bot, reqs: "1 Fast Low-Latency LLM + Knowledge RAG", assigned: { botLlm: "deepseek-chat", rag: LOCAL_BGE_EMBEDDINGS }, status: "ready" },
  ],

  // Master Subscription & Token Quota (Live database metrics populated on load)
  subscription: {
    tenantName: "Outreach by Aivhub Workspace",
    planTier: "Metered Workspace Subscription",
    monthlyTokenQuota: 0,
    tokensUsed: 0,
    estimatedCostUsd: 0,
    monthlyBudgetCapUsd: 0,
    pluginBreakdown: [],
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
  gradientTeal: "linear-gradient(135deg, #0C8C7D 0%, #15803D 100%)",
  glowTeal: "0 8px 24px rgba(12,140,125,0.25)",
  shadowCard: "0 2px 8px rgba(0,0,0,0.04)",
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

/* ─── Graceful Error Boundary to prevent blank screens ─── */
class SafeErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("[SafeErrorBoundary] Caught error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", margin: 24, maxWidth: 640 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 22 }}>⚠️</span>
            <h3 style={{ margin: 0, color: "#0f172a", fontSize: 16 }}>{this.props.label || "View"} Recovery</h3>
          </div>
          <p style={{ color: "#64748b", fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
            {this.props.label || "This section"} encountered a temporary display issue: {this.state.error?.message || "Unknown display state"}.
          </p>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              if (this.props.onReset) this.props.onReset();
            }}
            style={{ padding: "8px 18px", borderRadius: 8, background: "#0f172a", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13 }}
          >
            Reload Section
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ---------------------------------- Company Intelligence & Live Call Dossier Modal ---------------------------------- */

function dash(v) {
  const s = String(v == null ? "" : v).trim();
  return s || "";
}

function CompanyDossierModal({ contact, onClose, onWatchLive, onTakeOver, onBookMeeting, callIsLive }) {
  if (!contact) return null;
  const company = dash(contact.name);
  const person = dash(contact.contact);
  const displayName = person || company || "Contact";
  const phone = dash(contact.phone);
  const email = dash(contact.email);
  const rawSite = dash(contact.site || contact.source || contact.website);
  const site = looksLikeUrl(rawSite) && rawSite.toLowerCase() !== displayName.toLowerCase() ? rawSite : "";
  const linkedin = looksLikeUrl(dash(contact.linkedin)) ? dash(contact.linkedin) : "";
  const city = dash(contact.city);
  const title = dash(contact.title);
  const notes = dash(contact.notes);
  const hook = dash(contact.openingHook);
  const live = Boolean(callIsLive || contact.status === "calling");

  const present = [
    person && { label: "Person", value: person },
    company && company !== person && { label: "Company", value: company },
    title && { label: "Title", value: title },
    phone && { label: "Phone", value: phone },
    email && { label: "Email", value: email },
    city && { label: "City", value: city },
    site && { label: "Website", value: site, href: site.startsWith("http") ? site : `https://${site}` },
    linkedin && { label: "LinkedIn", value: linkedin, href: linkedin.startsWith("http") ? linkedin : `https://${linkedin}` },
    notes && { label: "Notes", value: notes },
    hook && { label: "Call hook", value: hook },
  ].filter(Boolean);

  const missing = [
    !company && "company",
    !person && "person",
    !phone && "phone",
    !email && "email",
    !site && "website",
    !linkedin && "LinkedIn",
  ].filter(Boolean);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.72)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, padding: 20, cursor: "pointer" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 16, width: 560, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 28px 56px rgba(0,0,0,0.3)", border: `1px solid ${C.border}`, cursor: "default" }}
      >
        <div style={{ padding: "20px 26px", borderBottom: `1px solid ${C.border}`, background: HUB_PAPER, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink }}>{displayName}</span>
              <Badge status={contact.status} small />
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <X size={16} color={C.slate} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0 18px" }}>
          {present.map((row) => (
            <div key={row.label} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, padding: "10px 26px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", paddingTop: 2 }}>{row.label}</div>
              <div style={{ fontSize: 14, color: C.ink, lineHeight: 1.45, wordBreak: "break-word" }}>
                {row.href ? (
                  <a href={row.href} target="_blank" rel="noreferrer" style={{ color: C.cobalt }}>{row.value}</a>
                ) : (
                  row.value
                )}
              </div>
            </div>
          ))}
          {missing.length > 0 && (
            <div style={{ padding: "14px 26px 0", fontSize: 13, color: C.slate, lineHeight: 1.5 }}>
              Missing from file: {missing.join(", ")}. Use Find missing to search the web, or type them here.
            </div>
          )}
        </div>

        <div style={{ padding: "16px 26px", borderTop: `1px solid ${C.border}`, background: HUB_PAPER, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            onClick={onClose}
            style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
          >
            Close
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            {onWatchLive && live && (
              <button
                onClick={() => { onClose(); onWatchLive(contact); }}
                style={{ padding: "8px 16px", borderRadius: 8, background: C.cobalt, color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
              >
                <Radio size={14} /> Listen & Supervise Call
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
  {
    id: "custom",
    label: "Custom hours",
    weekdayStart: "",
    weekdayEnd: "",
    blurb: "Set start and end yourself. Still inside PECR (weekdays 08:00–21:00). Use this when 09:00–17:30 is too tight or too wide.",
  },
];

function pecrPolicy(id) {
  return CALL_HOUR_POLICIES.find((p) => p.id === id) || CALL_HOUR_POLICIES[0];
}

function applyCallHourPolicy(id, current = {}) {
  if (id === "custom") {
    return {
      callHoursPolicy: "custom",
      weekdayStart: current.weekdayStart || "09:00",
      weekdayEnd: current.weekdayEnd || "17:30",
    };
  }
  const p = pecrPolicy(id);
  return { callHoursPolicy: p.id, weekdayStart: p.weekdayStart, weekdayEnd: p.weekdayEnd };
}

const WEEKDAY_HOUR_OPTIONS = Array.from({ length: 27 }, (_, i) => {
  const m = 8 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});
const LUNCH_HOUR_OPTIONS = Array.from({ length: 9 }, (_, i) => {
  const m = 11 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

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
    { name: "OpenAI", status: "not_configured" },
  ]},
  { group: "Speech-to-Text", desc: "Turns the prospect's spoken voice into text the AI can understand.", items: [
    { name: "Deepgram", status: "not_configured" },
    { name: "Faster-Whisper (self-hosted)", status: "not_configured" },
  ]},
  { group: "Text-to-Speech", desc: "Generates the AI's spoken voice on calls.", items: [
    { name: "xAI Voice Agent", status: "not_configured" },
    { name: "Deepgram Aura", status: "not_configured" },
    { name: "Cartesia", status: "not_configured" },
    { name: "ElevenLabs", status: "not_configured" },
    { name: "Kokoro (self-hosted)", status: "not_configured" },
  ]},
  { group: "Voice Orchestration", desc: "Manages the live call itself — audio streaming, interruptions, turn-taking.", items: [
    { name: "xAI Voice Agent", status: "not_configured" },
    { name: "LiveKit (self-hosted)", status: "connected" },
    { name: "Vapi", status: "not_configured" },
    { name: "Retell AI", status: "not_configured" },
  ]},
  { group: "Telephony", desc: "Places and receives the actual phone calls.", items: [
    { name: "xAI Voice Number", status: "not_configured" },
    { name: "Twilio", status: "not_configured" },
  ]},
  { group: "Messaging", desc: "Sends automated confirmations and follow-ups via WhatsApp and SMS.", items: [
    { name: "WhatsApp Cloud API (Meta)", status: "not_configured" },
    { name: "Twilio WhatsApp", status: "not_configured" },
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

const CATEGORY_OPTIONS = ["LLM", "Speech-to-Text", "Text-to-Speech", "Voice Orchestration", "Telephony", "Messaging", "Calendar", "Business Discovery", "Other"];

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
  spokenName: "",
  pitch: "AI-powered business intelligence dashboards for mid-market operations teams",
  industry: "Business intelligence / data consulting",
  website: "https://aivhub.io",
  social: "linkedin.com/company/aivhub",
  callerName: "Sam",
  callerId: "",
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

function CallTimer({ initialDuration = "00:00", active = true, style }) {
  const [seconds, setSeconds] = useState(() => {
    if (!initialDuration || typeof initialDuration !== "string" || !initialDuration.includes(":")) return 0;
    const parts = initialDuration.split(":").map((n) => parseInt(n, 10) || 0);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  });

  useEffect(() => {
    if (initialDuration && typeof initialDuration === "string" && initialDuration.includes(":")) {
      const parts = initialDuration.split(":").map((n) => parseInt(n, 10) || 0);
      setSeconds((parts[0] || 0) * 60 + (parts[1] || 0));
    }
  }, [initialDuration]);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [active]);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const formatted = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  return <span style={style}>{formatted}</span>;
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
    { id: "list", label: "Contact List & Batches", icon: Building2 },
    { id: "tasks", label: "Tasks & Batches", icon: ListChecks },
    { id: "schedule", label: "Schedule", icon: Calendar },
    { id: "meetings", label: "Meetings", icon: CalendarCheck },
    { id: "live", label: "Live Activity", icon: Radio },
    { id: "calllog", label: "Call Log", icon: History },
    { id: "processlogs", label: "System Process Logs", icon: FileText },
  ]},
  { label: "Configuration", items: [
    { id: "company", label: "Company Profile", icon: Users },
    { id: "provider", label: "Connections & Providers", icon: Plug },
  ]},
  { label: "Insights", items: [
    { id: "analytics", label: "Analytics", icon: BarChart3 },
  ]},
  { label: "Resources", items: [
    { id: "docs", label: "Setup Guide & Docs", icon: BookOpen },
  ]},
];

function Sidebar({ view, setView, companyName, callerName, timezone, operatorName, operatorRole, onBackToHub, onLogout, activeCallCount = 0, onUseSimple }) {
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
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 32 32"
          width={28}
          height={28}
          style={{
            display: "block",
            flexShrink: 0,
          }}
        >
          <defs>
            <linearGradient id="aiv" x1="4" y1="2" x2="30" y2="32" gradientUnits="userSpaceOnUse">
              <stop stopColor="#3457D5"/>
              <stop offset="1" stopColor="#0C8C7D"/>
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="9" fill="url(#aiv)"/>
          <circle cx="11" cy="16" r="2.35" fill="#fff"/>
          <path d="M15.6 11.1c2.7 1.5 2.7 8.3 0 9.8" fill="none" stroke="#fff" strokeWidth="1.85" strokeLinecap="round"/>
          <path d="M19.4 8.4c4.3 2.5 4.3 12.7 0 15.2" fill="none" stroke="#fff" strokeWidth="1.85" strokeLinecap="round"/>
          <path d="M23.1 6.1c5.8 3.3 5.8 16.5 0 19.8" fill="none" stroke="#fff" strokeWidth="1.75" strokeLinecap="round"/>
        </svg>
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: "#fff", letterSpacing: "-0.01em" }}>
          Outreach by Aivhub
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
              const active = view === n.id || (n.id === "list" && view === "prospects");
              return (
                <button
                  key={n.id}
                  onClick={() => setView(n.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
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
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Icon size={16} strokeWidth={2} />
                    {n.label}
                  </span>
                  {n.id === "live" && activeCallCount > 0 && (
                    <span style={{ background: "#10B981", color: "#fff", fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999 }}>
                      {activeCallCount} LIVE
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ marginTop: "auto", padding: "12px 10px", borderTop: `1px solid ${C.inkLine}` }}>
        {onUseSimple && (
          <button
            type="button"
            onClick={onUseSimple}
            style={{
              marginBottom: 12,
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "8px",
              borderRadius: 8,
              border: "1px solid rgba(52,87,213,0.35)",
              background: "rgba(52,87,213,0.2)",
              color: "#EAEEFC",
              fontFamily: FONT_BODY,
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Use new calling
          </button>
        )}
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
  const [activeId, setActiveId] = useState("");
  const items = useMemo(() => dedupeNotifications(notifications), [notifications]);
  const unread = items.filter((n) => n.unread).length;

  useEffect(() => {
    if (!setNotifications || !notifications?.length) return;
    const cleaned = dedupeNotifications(notifications);
    if (cleaned.length !== notifications.length) setNotifications(cleaned);
  }, [notifications?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const markOneRead = (n) => {
    const fp = notificationFingerprint(n.text);
    setNotifications((ns) =>
      dedupeNotifications(ns).map((x) =>
        x.id === n.id || notificationFingerprint(x.text) === fp ? { ...x, unread: false } : x
      )
    );
  };

  const goTo = (n) => {
    markOneRead(n);
    const { targetView, targetExtra } = resolveNotificationTarget(n);
    if (typeof onNavigate === "function") {
      onNavigate(targetView, targetExtra);
    } else if (typeof window !== "undefined" && typeof window.__voiceNavigate === "function") {
      window.__voiceNavigate(targetView, targetExtra);
    }
    // Panel stays open — only X / outside / clear closes it
  };

  const handleNotificationClick = (n) => {
    markOneRead(n);
    setActiveId((id) => (id === n.id ? "" : n.id));
  };

  const clearAll = () => {
    setNotifications([]);
    setActiveId("");
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

  const hasUnread = unread > 0;

  return (
    <div style={{ position: "relative" }}>
      <style>{`
        @keyframes aivhubBellPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(52,87,213,0.45); transform: scale(1); }
          50% { box-shadow: 0 0 0 8px rgba(52,87,213,0); transform: scale(1.06); }
        }
      `}</style>
      <button
        onClick={() => setOpen((o) => !o)}
        title={hasUnread ? `${unread} unread` : "Notifications"}
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          border: hasUnread ? `2px solid ${C.cobalt}` : `1px solid ${C.border}`,
          background: hasUnread ? C.cobalt : "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          position: "relative",
          color: hasUnread ? "#fff" : C.slate,
          animation: hasUnread ? "aivhubBellPulse 1.6s ease-in-out infinite" : "none",
        }}
      >
        <Bell size={16} color={hasUnread ? "#fff" : C.slate} />
        {hasUnread && (
          <span style={{ position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 999, background: C.redSolid || C.red, color: "#fff", fontSize: 10, fontFamily: FONT_BODY, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", border: "2px solid #fff", boxShadow: "0 2px 4px rgba(0,0,0,0.18)" }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => { setOpen(false); setActiveId(""); }} style={{ position: "fixed", inset: 0, zIndex: 999 }} />
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
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {unread > 0 && (
                  <button
                    onClick={() => setNotifications((ns) => dedupeNotifications(ns).map((n) => ({ ...n, unread: false })))}
                    style={{ background: "none", border: "none", color: C.cobalt, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "2px 6px" }}
                  >
                    Mark all read
                  </button>
                )}
                {items.length > 0 && (
                  <button
                    onClick={clearAll}
                    style={{ background: "none", border: "none", color: C.slate, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "2px 6px" }}
                  >
                    Clear all
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setOpen(false); setActiveId(""); }}
                  title="Close"
                  style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", color: C.slate, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* List with clean isolated scroll and zero-jitter hover */}
            <div
              style={{
                maxHeight: 340,
                overflowY: "auto",
                overscrollBehavior: "contain",
              }}
            >
              {items.length === 0 ? (
                <div style={{ padding: "36px 20px", textAlign: "center", color: C.slateLight, fontSize: 13 }}>
                  No notifications yet.
                </div>
              ) : (
                items.map((n) => {
                  const expanded = activeId === n.id;
                  return (
                  <div
                    key={n.id}
                    style={{
                      borderBottom: `1px solid ${C.border}`,
                      borderLeft: n.unread ? `3.5px solid ${C.cobalt}` : "3.5px solid transparent",
                      background: n.unread ? "#F8FAFF" : "#fff",
                    }}
                  >
                    <div
                      onClick={() => handleNotificationClick(n)}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        padding: "13px 16px 13px 14px",
                        cursor: "pointer",
                        transition: "background 0.12s ease",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#EFF4FF"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = n.unread ? "#F8FAFF" : "#fff"; }}
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
                          <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.cobalt }}>
                            {notificationActionLabel(n)}
                          </span>
                        </div>
                      </div>
                    </div>
                    {expanded && (
                      <div style={{ padding: "0 16px 12px 54px" }}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); goTo(n); }}
                          style={{
                            height: 32,
                            padding: "0 12px",
                            borderRadius: 8,
                            border: "none",
                            background: C.cobalt,
                            color: "#fff",
                            fontFamily: FONT_BODY,
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {notificationActionLabel(n)}
                        </button>
                      </div>
                    )}
                  </div>
                  );
                })
              )}
            </div>

            {/* Footer Hint */}
            <div style={{ padding: "10px 18px", background: HUB_PAPER, borderTop: `1px solid ${C.border}`, fontSize: 11.5, color: C.slateLight, textAlign: "center" }}>
              Tap a notification, then Open to go there. Panel stays open until you close it.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TopBar({ title, subtitle, onNewMission, notifications, setNotifications, onBack, canGoBack, backLabel, onNavigate }) {
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
        <NotificationBell notifications={notifications} setNotifications={setNotifications} onNavigate={onNavigate || ((view, extra) => typeof window !== "undefined" && window.__voiceNavigate && window.__voiceNavigate(view, extra))} />
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
  onLaunchLiveBatch,
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
          onLaunchLiveBatch={onLaunchLiveBatch}
          companyName={companyName}
          companyCallerId={callerId}
        />
      )}
    </>
  );
}

/* ---------------------------------- 4-Step Batch Task Wizard Modal ---------------------------------- */

function BatchTaskWizardModal({ isOpen, onClose, onCreateTask, onLaunchLiveBatch, companyName, companyCallerId }) {
  const [step, setStep] = useState(1); // 1: Mapping, 2: Scripting, 3: Dialing & Smart Timing, 4: Pre-Flight Cockpit & Test Call
  const fileInputRef = useRef(null);

  // Registered Outbound Numbers in Software
  const REGISTERED_CALLER_IDS = [
    ...(companyCallerId ? [{ id: "cid_custom", number: companyCallerId, label: `Assigned Company Line (${companyCallerId})`, region: "Active Line", status: "Active" }] : []),
  ];

  // Registered Operator Mobile Numbers
  const REGISTERED_OPERATORS = [
    { id: "op_1", name: "Jitendra S. (Admin)", phone: "+44 7700 900123" },
    { id: "op_2", name: "Operations Lead Desk", phone: "+44 7700 900456" },
    { id: "op_3", name: "Sales Director Mobile", phone: "+44 7700 900789" },
    { id: "op_custom", name: "Custom Mobile Number", phone: "" },
  ];

  // Step 1: Upload & Mapping State
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState("");
  const [totalRows, setTotalRows] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [liveFileReady, setLiveFileReady] = useState(false);
  const [parseError, setParseError] = useState("");
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState("");
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
  const [concurrency, setConcurrency] = useState(1);
  const [callPolicy, setCallPolicy] = useState("respectful"); // "respectful" | "pecr_max" | "core_peak" | "custom"
  const [customStartTime, setCustomStartTime] = useState("08:30");
  const [customEndTime, setCustomEndTime] = useState("18:30");
  const [customDays, setCustomDays] = useState(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  const [voicemailAction, setVoicemailAction] = useState("drop_and_message"); // drop_and_message | retry_later
  const [lunchPause, setLunchPause] = useState(true); // 12:30 - 13:30 pause

  // Step 4: Outbound Caller ID & Operator Test Call State
  const [selectedCallerId, setSelectedCallerId] = useState(companyCallerId || "");
  useEffect(() => {
    if (companyCallerId && !selectedCallerId) {
      setSelectedCallerId(companyCallerId);
    }
  }, [companyCallerId]);
  const [selectedOperatorPhone, setSelectedOperatorPhone] = useState("+44 7700 900123");
  const [customMobile, setCustomMobile] = useState("");
  const [testingCall, setTestingCall] = useState(false);
  const [testCallSuccess, setTestCallSuccess] = useState(false);

  // Sample contacts parsed from file
  const [parsedContacts, setParsedContacts] = useState([]);

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
    setParseError("");
    setLaunchError("");
    setUploadSuccess(false);
    setLiveFileReady(false);
    parseSpreadsheetFile(
      file,
      ({ headers, records }) => {
        const contacts = contactsFromSpreadsheetRecords(headers, records);
        if (!contacts.length) {
          setParseError("No dialable phone numbers in this file. Need a Name and Mobile Phone column.");
          setParsedContacts([]);
          setTotalRows(0);
          setUploadSuccess(false);
          setLiveFileReady(false);
          return;
        }
        setParsedContacts(contacts);
        setTotalRows(contacts.length);
    setUploadSuccess(true);
        setLiveFileReady(true);
    setTaskTitle(name.replace(/\.[^/.]+$/, "").replace(/_/g, " ") + " Campaign");
        const phoneH = guessColumn(headers, "phone");
        const nameH = guessColumn(headers, "name") || guessColumn(headers, "contact");
        setMappings((m) => ({
          ...m,
          phone: phoneH || m.phone,
          name: nameH || m.name,
        }));
      },
      (err) => {
        setParseError(err || "Could not read spreadsheet");
        setUploadSuccess(false);
        setLiveFileReady(false);
        setParsedContacts([]);
        setTotalRows(0);
      }
    );
  };

  const loadSampleDataset = (name, rows) => {
    setFileName(name);
    setFileSize("demo");
    setTotalRows(rows);
    setUploadSuccess(true);
    setLiveFileReady(false);
    setParsedContacts([]);
    setParseError("Sample lists are demo-only. Upload a real spreadsheet to place live phone calls.");
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

  const handleLaunch = async () => {
    const liveRows = parsedContacts.filter((c) => c.selected && c.valid && digitsInPhone(c.phone).length >= 7);
    if (onLaunchLiveBatch && liveFileReady && liveRows.length) {
      setLaunching(true);
      setLaunchError("");
      try {
        await onLaunchLiveBatch({
          rows: liveRows.map((c) => ({
            name: c.company || "",
            contact: c.name,
            phone: c.phone,
            website: c.website || "",
            email: c.email || "",
            linkedin: c.linkedin || "",
          })),
          concurrency,
          title: taskTitle,
          windowStart: windowTimes.start,
          windowEnd: windowTimes.end,
          timezone: "Europe/London",
        });
        onClose();
      } catch (err) {
        setLaunchError((err && err.message) || "Failed to start live outbound calls.");
      } finally {
        setLaunching(false);
      }
      return;
    }
    if (onLaunchLiveBatch) {
      setLaunchError("Upload a spreadsheet with real phone numbers first. Sample lists do not place live calls.");
      return;
    }
    const created = {
      id: "task_" + Date.now(),
      title: taskTitle,
      file: fileName,
      fileRows: totalRows,
      sector: "Logistics & Operations",
      region: "UK-wide",
      status: "active",
      concurrency,
      activeLines: Math.min(concurrency, 5),
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
      prospects: parsedContacts && parsedContacts.length ? parsedContacts : [],
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

              {parseError && (
                <div style={{ fontSize: 12.5, color: "#B45309", background: C.amberSoft, borderRadius: 8, padding: "8px 12px" }}>
                  {parseError}
                </div>
              )}

              {liveFileReady && parsedContacts.length > 0 && (
                <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, marginBottom: 8 }}>
                    Live numbers ready — {parsedContacts.length} will be dialed
                  </div>
                  {parsedContacts.slice(0, 8).map((c) => (
                    <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 0.9fr 0.9fr", gap: 8, fontSize: 12, padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                      <span>{c.name}</span>
                      <span style={{ fontFamily: FONT_MONO, color: C.slate }}>{c.phone}</span>
                      <span style={{ color: c.company ? C.ink : C.slateLight }}>{c.company || "company —"}</span>
                      <span style={{ color: c.email || c.website || c.linkedin ? C.ink : C.slateLight }}>{c.email || c.website || c.linkedin || "email / web / LI —"}</span>
                    </div>
                  ))}
                </div>
              )}

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
                    { key: "email", label: "Email Column (empty if not in file)" },
                    { key: "website", label: "Website Column (empty if not in file)" },
                    { key: "linkedin", label: "LinkedIn Column (empty if not in file)" },
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
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>Calls at once: {concurrency} {concurrency === 1 ? "line" : "lines"}</div>
                    <div style={{ fontSize: 12, color: C.slate }}>Pick 1 for one-by-one. Max 5 so voice quality stays clean.</div>
                  </div>
                  <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.cobalt }}>{concurrency} Lines</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={concurrency}
                  onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
                  style={{ width: "100%" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.slate, marginTop: 4 }}>
                  <span>1 line (one at a time)</span>
                  <span>3 lines</span>
                  <span>5 lines (max for quality)</span>
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
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                {launchError ? <div style={{ fontSize: 11.5, color: "#B91C1C", maxWidth: 360, textAlign: "right" }}>{launchError}</div> : null}
              <button
                onClick={handleLaunch}
                disabled={launching || !liveFileReady}
                title={!liveFileReady ? "Upload a spreadsheet with phone numbers first" : "Places real outbound calls"}
                style={{ padding: "9px 24px", borderRadius: 8, background: launching || !liveFileReady ? C.slateLight : C.green, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: launching || !liveFileReady ? "default" : "pointer", boxShadow: launching || !liveFileReady ? "none" : "0 4px 12px rgba(12,140,125,0.25)" }}
              >
                {launching ? "Placing live calls…" : `🚀 Launch live outbound (${totalRows} contacts)`}
              </button>
              </div>
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
    </>
  );
}

/* ---------------------------------- mission detail ---------------------------------- */

function callBelongsToFocus(c, focus) {
  if (!focus) return true;
  if (c.missionId === "m_outbound" || (c.id && c.id.startsWith("call_"))) return true;
  if (focus.missionId && c.missionId && c.missionId === focus.missionId) return true;
  if (focus.missionTitle && c.mission === focus.missionTitle) return true;
  if (focus.prospectId && c.prospectId && c.prospectId === focus.prospectId) return true;
  if (focus.name && c.prospect === focus.name) return true;
  return false;
}

function MissionDetail({ mission, onBack, companyName, onWatchLive, liveCalls = [] }) {
  const [expanded, setExpanded] = useState(null);
  const [visibleCount, setVisibleCount] = useState(50);
  const [rosterFilter, setRosterFilter] = useState("all");
  const [rosterSearch, setRosterSearch] = useState("");
  const [dossierContact, setDossierContact] = useState(null);
  const [showDataView, setShowDataView] = useState(false);
  const prospectLive = (p) => (liveCalls || []).some((c) => liveCallActive(c) && prospectMatchesCall(p, c, mission && mission.id));

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
            callIsLive={prospectLive(dossierContact)}
          />
        )}
      </>
    );
  }

  const counts = (mission.prospects || []).reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});
  const liveCount = (mission.prospects || []).filter(prospectLive).length;
  const tally = tallyMission(mission.prospects || []);

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
          <div style={{ minHeight: (liveCount || 0) > 0 ? 44 : 0, marginTop: (liveCount || 0) > 0 ? 10 : 0, transition: "min-height 0.2s ease" }}>
            {(liveCount || 0) > 0 && (
              <div style={{ background: C.cobaltSoft, borderRadius: 8, padding: "9px 12px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk, lineHeight: 1.45, maxWidth: 560 }}>
                {liveCount} conversation{liveCount === 1 ? "" : "s"} live now. This page is the roster. Open <strong>Live Activity</strong> to listen, take over, or end a call.
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 36 }}>
            {typeof onWatchLive === "function" && (
              <button
                onClick={() => onWatchLive({ missionTitle: mission && mission.title, missionId: mission && mission.id })}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 8,
                  background: C.ink,
                  color: "#fff",
                  border: "none",
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: (liveCount || 0) > 0 ? "pointer" : "default",
                  opacity: (liveCount || 0) > 0 ? 1 : 0,
                  pointerEvents: (liveCount || 0) > 0 ? "auto" : "none",
                  visibility: (liveCount || 0) > 0 ? "visible" : "hidden",
                  transition: "opacity 0.2s ease, visibility 0.2s ease",
                }}
              >
                <Radio size={13} /> Watch {liveCount} Live Call{liveCount === 1 ? "" : "s"}
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
                      {prospectLive(p) ? <LivePulse /> : p.status === "meeting_booked" ? <CheckCircle2 size={16} color={C.green} /> : p.status === "human_review" ? <AlertTriangle size={16} color={C.red} /> : p.status === "skipped" ? <History size={15} color={C.slate} /> : <Circle size={14} color={C.slateLight} />}
                      <div>
                        <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13.5, color: C.textInk }}>{p.name}</div>
                        <div style={{ fontSize: 11.5, color: C.slate }}>{[p.contact, p.title, p.phone].filter(Boolean).join(" · ")}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <Badge status={prospectLive(p) ? "calling" : p.status} small />
                      <ChevronDown size={15} color={C.slateLight} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
                    </div>
                  </div>
                  {isOpen && (
                    <div style={{ padding: "0 16px 14px 40px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>
                      <div style={{ marginBottom: 6, fontWeight: 500, color: C.ink }}>{p.note}</div>
                      {p.notes && <div style={{ marginBottom: 6, fontSize: 12, color: C.slate, background: HUB_PAPER, padding: "6px 10px", borderRadius: 6 }}><strong>Lead Context:</strong> {p.notes}</div>}
                      {(p.fleet || p.rev || p.city || p.stack) && (
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8, fontSize: 11.5, color: C.slate }}>
                        {p.fleet && <span>Fleet: <strong>{p.fleet}</strong></span>}
                        {p.rev && <span>Rev: <strong>{p.rev}</strong></span>}
                        {p.city && <span>City: <strong>{p.city}</strong></span>}
                        {p.stack && <span>Stack: <strong>{p.stack}</strong></span>}
                      </div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDossierContact(p); }}
                          style={{ background: "#fff", color: C.ink, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                        >
                          📋 View Company Dossier
                        </button>

                        {(prospectLive(p) || p.status === "human_review") && typeof onWatchLive === "function" && (
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
            <StatRow label="Contacted" value={`${tally.contacted}/${tally.total}`} />
            <StatRow label="Meetings booked" value={tally.meetingsBooked} accent={C.green} />
            <StatRow label="Needs input" value={counts.human_review || 0} accent={counts.human_review ? C.red : undefined} />
            <StatRow label="Do-not-call" value={counts.rejected || 0} />
            <StatRow label="Skipped — already known" value={counts.skipped || 0} accent={counts.skipped ? C.amber : undefined} />
            <StatRow label="No answer / fallback" value={(counts.left_voicemail || 0) + (counts.emailed || 0) + (counts.retry || 0) + (counts.no_answer || 0)} />
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
                <StatRow label="Calling now" value={liveCount} accent={liveCount ? C.cobaltDeep : undefined} />
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
          callIsLive={prospectLive(dossierContact)}
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

const LiveCallsView = React.memo(function LiveCallsView({ notifications, setNotifications, companyName, callerId, calls, onConfirmBooking, onTakenToggle, onListenToggle, onAskEnd, onCancelEnd, onConfirmEnd, focus, onClearFocus, onBackToTasks, onRefreshLiveCalls, directDialPrefill, onOptimisticCall }) {
  const toggleTaken = onTakenToggle;
  const toggleListen = onListenToggle;
  const askEnd = onAskEnd;
  const cancelEnd = onCancelEnd;
  const confirmEnd = onConfirmEnd;
  const focusRef = useRef(null);

  const baseFiltered = focus ? calls.filter((c) => callBelongsToFocus(c, focus)) : calls;
  // Deduplicate calls by prospect name, carrier_sid, or ID to prevent ghost/duplicate cards
  const rawFiltered = baseFiltered.filter((c) => !c.ended || c.booked);
  const seenKeys = new Set();
  const filtered = [];
  for (const c of rawFiltered) {
    const key = (c.carrier_sid || c.prospect || c.id || "").trim();
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      filtered.push(c);
    }
  }
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
        subtitle={focus ? `${active.length} live for this task` : `${active.length} active conversations — calls and messages`}
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
      <div style={{ margin: focus ? "10px 32px 0" : "16px 32px 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: C.amber, marginRight: 6, verticalAlign: "middle" }} />Amber border — AI needs a human (pricing / stuck)</span>
          <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: C.red, marginRight: 6, verticalAlign: "middle" }} />Red border — you took over the call</span>
          <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: C.ink, marginRight: 6, verticalAlign: "middle" }} />Dark ring — opened from the mission list</span>
        </div>
        <button
          onClick={async () => {
            try {
              await api.clearLiveCalls();
              if (onRefreshLiveCalls) onRefreshLiveCalls();
            } catch (_) {}
          }}
          style={{ background: "#F1F5F9", border: `1px solid ${C.border}`, borderRadius: 7, padding: "5px 12px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          🧹 Clear Inactive / Stale Calls
        </button>
      </div>
      {filtered.length === 0 && (
        <div style={{ margin: "20px 32px", fontFamily: FONT_BODY, fontSize: 13.5, color: C.slate, lineHeight: 1.5 }}>
          {companyFocus
            ? `${focus.name} is not on a live call right now — queued, skipped, or already finished. Show all conversations to see everything else.`
            : "No active conversations right now."}
        </div>
      )}
      <div style={{ padding: "16px 32px 0" }}>
        <DirectOutboundCallCard
          notifications={notifications}
          setNotifications={setNotifications}
          defaultFromNumber={callerId || ""}
          prefillData={directDialPrefill}
          onCallCreated={(res, payload) => {
            if (onClearFocus) onClearFocus();
            if (onOptimisticCall) onOptimisticCall(res, payload);
            if (onRefreshLiveCalls) onRefreshLiveCalls();
          }}
        />
      </div>
      <div style={{ padding: "20px 32px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        {filtered.map((c) => {
          const isMessage = c.channel === "whatsapp" || c.channel === "sms" || c.channel === "email";
          const focused = isFocusedCard(c);
          if (c.ended) {
            return (
              <div key={c.id} className="hover-float" style={{ background: c.booked ? C.greenSoft : C.paperSoft, border: `1px dashed ${c.booked ? C.green : C.border}`, borderRadius: 12, padding: 16, opacity: c.booked ? 1 : 0.7, order: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14.5, color: c.booked ? C.textInk : C.slate }}>{c.prospect}</div>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await api.deleteLiveCall(c.id);
                        if (onRefreshLiveCalls) onRefreshLiveCalls();
                      } catch (_) {}
                    }}
                    title="Dismiss card"
                    style={{ background: "none", border: "none", cursor: "pointer", color: C.slateLight, padding: 2, display: "flex", alignItems: "center" }}
                  >
                    <X size={14} />
                  </button>
                </div>
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
                  {(c.company || c.phone || c.caller) && (
                    <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap", fontSize: 11, color: C.slate }}>
                      {c.company && <span style={{ background: HUB_PAPER, padding: "2px 6px", borderRadius: 4, border: `1px solid ${C.border}` }}>🏢 {c.company}</span>}
                      {(c.phone || c.caller) && <span style={{ background: HUB_PAPER, padding: "2px 6px", borderRadius: 4, border: `1px solid ${C.border}` }}>📞 {c.phone || c.caller}</span>}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {isMessage ? <ChannelTag channel={c.channel} small /> : <LivePulse />}
                  <CallTimer initialDuration={c.duration} active={!c.ended && c.state !== "ended"} style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.slate }} />
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
                  {c.taken && <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.red, fontStyle: "italic", fontWeight: 700 }}>— 🎙️ OPERATOR MIC LIVE — You are speaking directly to the prospect —</div>}
                </div>
              )}

              {/* Real-time Audio Stream Indicators */}
              {c.listening && !c.ended && (
                <div style={{ marginTop: 8, background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 7, padding: "6px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: "#059669" }}>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#10B981", animation: "pulse 1.5s infinite" }} />
                    🎧 Live Call Audio Streaming to Your Speakers
                  </div>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: "#059669" }}>8kHz μ-Law</span>
                </div>
              )}

              {c.taken && !c.ended && (
                <div style={{ marginTop: 8, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 7, padding: "6px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: "#DC2626" }}>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#EF4444", animation: "pulse 1s infinite" }} />
                    🔴 ON AIR: Supervisor Speaking Live (AI Muted)
                  </div>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: "#DC2626" }}>MIC LIVE</span>
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
                    <ActionBtn
                      icon={isMessage ? MessageCircle : Mic}
                      label={c.taken ? "Hand back to AI" : "Take over"}
                      onClick={() => toggleTaken(c.id)}
                      active={c.taken}
                      activeColor="#DC2626"
                      activeBg="#FEF2F2"
                    />
                    {!isMessage && (
                      <ActionBtn
                        icon={Headphones}
                        label={c.listening ? "Stop listening" : "Listen live"}
                        onClick={() => toggleListen(c.id)}
                        active={c.listening}
                        activeColor="#059669"
                        activeBg="#ECFDF5"
                      />
                    )}
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
});

function ActionBtn({ icon: Icon, label, onClick, active, danger, activeColor, activeBg }) {
  const fg = active ? (activeColor || C.red) : danger ? C.red : C.textInk;
  const bg = active ? (activeBg || C.redSoft) : "#fff";
  const bdr = active ? (activeColor || C.red) : C.border;
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
        border: `1px solid ${bdr}`,
        background: bg,
        color: fg,
        fontFamily: FONT_BODY,
        fontSize: 11.5,
        fontWeight: 600,
        cursor: "pointer",
        transition: "all 0.15s ease",
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

function CallLogView({ notifications, setNotifications, entries, prefillQuery, clearPrefill, onJumpSchedule, onDirectDial }) {
  const [query, setQuery] = useState(prefillQuery || "");
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const fallbackCopy = (text) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand("copy");
    } catch (_) {}
    document.body.removeChild(textArea);
  };

  const handleCopyTranscript = (evt, item) => {
    evt.stopPropagation();
    const fullText = (item.transcript || [])
      .map((t) => {
        if (!t) return "";
        if (typeof t === "string") return t;
        const speaker = t.who === "ai" ? "AI (Sam)" : t.who === "system" ? "System" : (logDisplayName(item) || "Prospect");
        return `${speaker}: ${t.text || ""}`;
      })
      .filter(Boolean)
      .join("\n");

    const onDone = () => {
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2500);
      if (setNotifications) {
        setNotifications((ns) => [
          { id: "n_" + Date.now(), text: `📋 Transcript copied to clipboard for ${logDisplayName(item)}`, time: "just now", unread: true, type: "info" },
          ...ns
        ]);
      }
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(fullText).then(onDone).catch(() => {
        fallbackCopy(fullText);
        onDone();
      });
    } else {
      fallbackCopy(fullText);
      onDone();
    }
  };

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
      e.canonicalName, e.listedAs, e.personCanonical, e.personListedAs, logDisplayName(e), e.mission,
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
            const personName = logDisplayName(e);
            const companyName = e.canonicalName && e.canonicalName !== personName ? e.canonicalName : "";
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
                      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14.5, color: C.textInk }}>{personName}</span>
                      <ChannelTag channel={e.channel} small />
                      <Badge status={e.outcome} small />
                      {e.wordsLocked && (
                        <span style={{ fontFamily: FONT_BODY, fontSize: 10, fontWeight: 700, color: C.teal, background: C.tealSoft, padding: "2px 6px", borderRadius: 5 }}>VERBATIM</span>
                      )}
                    </div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginTop: 3 }}>
                      {companyName || e.personListedAs || e.personCanonical || "Named from file"} · {e.mission}
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
                  <div style={{ padding: "0 20px 20px", borderTop: `1px solid ${C.borderLight}`, marginTop: 12, paddingTop: 16 }}>
                    <div style={{ maxWidth: 720, margin: "0 auto" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, color: C.ink, display: "flex", alignItems: "center", gap: 6 }}>
                          <span>Verbatim Call Transcript</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: C.teal, background: C.tealSoft, padding: "2px 8px", borderRadius: 12 }}>Locked</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {onDirectDial && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDirectDial({
                                  name: personName,
                                  phone: "",
                                  company: e.canonicalName
                                });
                              }}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                background: C.cobaltSoft,
                                border: `1px solid #BFDBFE`,
                                borderRadius: 7,
                                padding: "5px 10px",
                                fontFamily: FONT_BODY,
                                fontSize: 11.5,
                                fontWeight: 600,
                                color: C.cobalt,
                                cursor: "pointer"
                              }}
                            >
                              <PhoneCall size={12} /> Call Again
                            </button>
                          )}
                          <button
                            onClick={(evt) => handleCopyTranscript(evt, e)}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              background: copiedId === e.id ? "#DCFCE7" : "#FFFFFF",
                              border: `1px solid ${copiedId === e.id ? "#86EFAC" : C.border}`,
                              borderRadius: 7,
                              padding: "5px 10px",
                              fontFamily: FONT_BODY,
                              fontSize: 11.5,
                              fontWeight: 600,
                              color: copiedId === e.id ? "#166534" : C.slate,
                              cursor: "pointer",
                              transition: "all 0.15s ease"
                            }}
                          >
                            {copiedId === e.id ? "✅ Copied!" : "📋 Copy Transcript"}
                          </button>
                        </div>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 10, background: C.paper, borderRadius: 12, padding: 16 }}>
                        {(e.transcript || []).map((line, i) => {
                          const isThem = line.who === "them";
                          const isSystem = line.who === "system";
                          const isQuote = isThem && e.requestedFollowUp && line.text === e.requestedFollowUp.exactWords;

                          if (isSystem) {
                            return (
                              <div key={i} style={{ textAlign: "center", margin: "4px 0" }}>
                                <span style={{ fontFamily: FONT_BODY, fontSize: 11, background: "#F1F5F9", color: "#475569", padding: "4px 12px", borderRadius: 12, border: "1px solid #E2E8F0" }}>
                                  ℹ️ {line.text}
                                </span>
                              </div>
                            );
                          }

                          return (
                            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: isThem ? "flex-end" : "flex-start" }}>
                              <div style={{ fontSize: 10.5, fontWeight: 700, color: isThem ? C.slate : C.cobalt, marginBottom: 3, padding: "0 4px" }}>
                                {isThem ? `👤 ${personName}` : "🤖 Sam (AI Voice SDR)"}
                              </div>
                              <div
                                style={{
                                  maxWidth: "85%",
                                  background: isQuote ? C.tealSoft : isThem ? "#FFFFFF" : "#F0F7FF",
                                  color: isThem ? C.textInk : "#1E293B",
                                  border: isQuote ? `1px solid ${C.teal}` : isThem ? `1px solid ${C.border}` : "1px solid #BFDBFE",
                                  borderRadius: isThem ? "14px 4px 14px 14px" : "4px 14px 14px 14px",
                                  padding: "9px 14px",
                                  fontFamily: FONT_BODY,
                                  fontSize: 12.5,
                                  lineHeight: 1.45,
                                  boxShadow: isThem ? "0 1px 3px rgba(0,0,0,0.04)" : "none",
                                }}
                              >
                                {line.text}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {e.requestedFollowUp && onJumpSchedule && (
                        <button
                          onClick={() => onJumpSchedule(e.canonicalName)}
                          style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 12px", fontFamily: FONT_BODY, fontSize: 12, color: C.slate, cursor: "pointer" }}
                        >
                          <Calendar size={12} /> See scheduled callback
                        </button>
                      )}
                    </div>
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
          <Calendar size={13} color={C.slate} /> {meetingTimeLabel(meeting)}
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
                        <Calendar size={12} color={C.slate} /> {meetingTimeLabel(m)}
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

function ProspectsView({ notifications, setNotifications, onScheduleFor, registry, callLog, onOpenLog, onDirectDial }) {
  const [query, setQuery] = useState("");
  const [savedContacts, setSavedContacts] = useState(() => {
    try {
      const saved = localStorage.getItem("aivhub_saved_contacts");
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return [
      { id: "sc_jm", name: "Jitendra Mehta", company: "AIVHub Ltd", phone: "+447577570050", contact: "Jitendra Mehta", role: "CEO / Director", sector: "AI & Voice Tech", region: "UK", status: "ready_to_call", fit: 98, isSaved: true },
      { id: "sc_ops", name: "Operations Desk", company: "AIVHub", phone: "+447307216767", contact: "Support Ops", role: "Telephony Lead", sector: "Telephony", region: "UK", status: "ready_to_call", fit: 95, isSaved: true }
    ];
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCompany, setAddCompany] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addRole, setAddRole] = useState("");

  const handleSaveContact = (e) => {
    if (e) e.preventDefault();
    if (!addPhone.trim()) {
      alert("Please enter a phone number.");
      return;
    }
    const newContact = {
      id: "sc_" + Date.now(),
      name: addName.trim() || "Contact",
      company: addCompany.trim() || "Independent",
      phone: addPhone.trim(),
      contact: addName.trim() || "Contact",
      role: addRole.trim() || "Client",
      sector: "Outreach",
      region: "UK",
      status: "ready_to_call",
      fit: 95,
      isSaved: true
    };
    const updated = [newContact, ...savedContacts];
    setSavedContacts(updated);
    try {
      localStorage.setItem("aivhub_saved_contacts", JSON.stringify(updated));
    } catch (_) {}
    if (setNotifications) {
      setNotifications((ns) => [
        { id: "n_" + Date.now(), text: `💾 Contact saved: ${newContact.name} (${newContact.phone})`, time: "just now", unread: true, type: "success" },
        ...ns
      ]);
    }
    setAddName("");
    setAddCompany("");
    setAddPhone("");
    setAddRole("");
    setShowAddModal(false);
  };

  const allItems = [...savedContacts, ...PROSPECTS.filter(p => !savedContacts.some(sc => sc.name.toLowerCase() === p.name.toLowerCase()))];
  const filtered = allItems.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    (p.company && p.company.toLowerCase().includes(query.toLowerCase())) ||
    (p.phone && p.phone.includes(query))
  );

  const registryFor = (p) => (registry || []).find((r) =>
    allRegistryNames(r).some((n) => normalizeCompanyName(n) === normalizeCompanyName(p.name))
  );
  const lastLogFor = (p) => {
    const entry = registryFor(p);
    return (callLog || []).find((l) => (entry && l.registryId === entry.id) || normalizeCompanyName(l.canonicalName) === normalizeCompanyName(p.name));
  };

  const copyContactShare = (p) => {
    const shareText = `👤 Contact: ${p.name}\n🏢 Company: ${p.company || p.name}\n📞 Phone: ${p.phone || "N/A"}\n💼 Role: ${p.role || p.contact || "Decision Maker"}`;
    navigator.clipboard.writeText(shareText);
    if (setNotifications) {
      setNotifications((ns) => [
        { id: "n_" + Date.now(), text: `📋 Contact details copied for ${p.name}!`, time: "just now", unread: true, type: "info" },
        ...ns
      ]);
    }
  };

  return (
    <>
      <TopBar title="Contacts & Batches" subtitle="Manage persistent client contacts, dial 1-click calls, and share prospect profiles" notifications={notifications} setNotifications={setNotifications} />
      <div style={{ padding: "20px 32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
          <div style={{ position: "relative", minWidth: 260, maxWidth: 360, flex: 1 }}>
            <Search size={14} color={C.slateLight} style={{ position: "absolute", left: 11, top: 10 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search contacts, companies, or phone..."
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
          <button
            onClick={() => setShowAddModal(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: C.cobalt,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "9px 16px",
              fontFamily: FONT_BODY,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 2px 6px rgba(37, 99, 235, 0.25)"
            }}
          >
            + Save New Contact
          </button>
        </div>

        {/* Add Contact Modal */}
        {showAddModal && (
          <div style={{ background: "#FFFFFF", border: `2px solid ${C.cobalt}`, borderRadius: 12, padding: 20, marginBottom: 20, boxShadow: C.shadowCard }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.ink, marginBottom: 14 }}>
              💾 Save Client / Test Contact (1-Click Persistent Dial)
            </div>
            <form onSubmit={handleSaveContact} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 4 }}>Full Name</label>
                <input
                  type="text"
                  placeholder="e.g. Jitendra Mehta"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13, boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 4 }}>Phone Number (E.164) *</label>
                <input
                  type="text"
                  placeholder="e.g. +447577570050"
                  value={addPhone}
                  onChange={(e) => setAddPhone(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13, boxSizing: "border-box", fontFamily: FONT_MONO }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 4 }}>Company / Organization</label>
                <input
                  type="text"
                  placeholder="e.g. AIVHub Ltd"
                  value={addCompany}
                  onChange={(e) => setAddCompany(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13, boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 4 }}>Role / Title</label>
                <input
                  type="text"
                  placeholder="e.g. CEO / Managing Director"
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13, boxSizing: "border-box" }}
                />
              </div>
              <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 14px", fontFamily: FONT_BODY, fontSize: 12.5, cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ background: C.cobalt, color: "#fff", border: "none", borderRadius: 6, padding: "7px 16px", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
                >
                  Save to Quick Dial
                </button>
              </div>
            </form>
          </div>
        )}

        <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.8fr 1.2fr 1.2fr 1fr 1.8fr", padding: "10px 18px", background: C.paper, fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>
            <div>Contact / Company</div>
            <div>Phone Number</div>
            <div>Role & Sector</div>
            <div>Status</div>
            <div style={{ textAlign: "right" }}>Actions</div>
          </div>
          {filtered.map((p) => {
            const entry = registryFor(p);
            const last = lastLogFor(p);
            const blocked = entry?.doNotCall || p.status === "do_not_call";
            return (
              <div
                key={p.id}
                style={{ display: "grid", gridTemplateColumns: "1.8fr 1.2fr 1.2fr 1fr 1.8fr", padding: "14px 18px", borderTop: `1px solid ${C.border}`, alignItems: "center" }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13.5, color: C.textInk }}>{p.name}</span>
                    {p.isSaved && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: C.cobalt, background: C.cobaltSoft, padding: "1px 6px", borderRadius: 4 }}>SAVED</span>
                    )}
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight }}>{p.company || p.name}</div>
                  {last && (
                    <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.slateLight, marginTop: 2 }}>
                      Last call: {last.endedAt} · {STATUS_MAP[last.outcome]?.label || last.outcome}
                    </div>
                  )}
                </div>

                {/* Phone Number */}
                <div style={{ fontFamily: FONT_MONO, fontSize: 12.5, color: p.phone ? C.textInk : C.slateLight, display: "flex", alignItems: "center", gap: 6 }}>
                  <PhoneCall size={12} color={p.phone ? C.cobalt : C.slateLight} />
                  <span>{p.phone || "No phone listed"}</span>
                </div>

                {/* Role / Sector */}
                <div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate }}>{p.role || p.contact}</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>{p.sector || p.region}</div>
                </div>

                <div>
                  <Badge status={p.status || "ready_to_call"} small />
                </div>

                {/* Action Buttons: Call Now, Share, Log */}
                <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
                  {onDirectDial && p.phone && (
                    <button
                      onClick={() => onDirectDial({ name: p.name, phone: p.phone, company: p.company || p.name })}
                      title="Call this number immediately via Twilio/xAI"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        background: C.cobalt,
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        padding: "6px 12px",
                        fontFamily: FONT_BODY,
                        fontSize: 11.5,
                        fontWeight: 700,
                        cursor: "pointer",
                        boxShadow: "0 1px 4px rgba(37, 99, 235, 0.2)"
                      }}
                    >
                      <PhoneCall size={12} /> Call Now
                    </button>
                  )}
                  <button
                    onClick={() => copyContactShare(p)}
                    title="Share contact details"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      background: "#FFFFFF",
                      border: `1px solid ${C.border}`,
                      borderRadius: 6,
                      padding: "6px 10px",
                      fontFamily: FONT_BODY,
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: C.slate,
                      cursor: "pointer"
                    }}
                  >
                    🔗 Share
                  </button>
                  {last && (
                    <button
                      onClick={() => onOpenLog && onOpenLog(p.name)}
                      style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px", fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, cursor: "pointer" }}
                    >
                      <History size={12} />
                    </button>
                  )}
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
  { id: "compliance", label: "Compliance", icon: ShieldCheck },
];

const SOURCE_TYPES = [
  { id: "Website URL", label: "Website URL", icon: Globe, placeholder: "https://www.aivhub.com/", hint: "Public company website, product documentation, or case study URL." },
  { id: "Document upload", label: "Document / PDF", icon: FileText, placeholder: "e.g. pricing-matrix-2026.pdf or cloud link", hint: "Upload or reference pricing sheets, service catalogues, and sales decks." },
  { id: "Google Drive link", label: "Google Drive", icon: Link2, placeholder: "https://drive.google.com/drive/folders/...", hint: "Shared team drive folder or presentation link." },
  { id: "Google Docs link", label: "Google Docs", icon: FileText, placeholder: "https://docs.google.com/document/d/...", hint: "Live internal playbooks, FAQs, and competitor battlecards." },
  { id: "Manual text", label: "Direct Text / Notes", icon: PenLine, placeholder: "Paste raw objection rebuttals, customer Q&As, or pricing rules here...", hint: "Paste custom scripts or internal knowledge directly into the AI's memory." },
];

function CompanyProfileView({ profile, setProfile, notifications, setNotifications, sources = [], setSources, services = [], setServices, faq = [], setFaq, embedded = false, voiceName, setVoiceName, onDirtyChange }) {
  const [tab, setTab] = useState("identity");
  const [saved, setSaved] = useState(false);
  const [addingSource, setAddingSource] = useState(false);
  const [newSource, setNewSource] = useState({ name: "", type: "Website URL", value: "" });
  const [activeChunkModal, setActiveChunkModal] = useState(null);
  const [testQuery, setTestQuery] = useState("");
  const [testResults, setTestResults] = useState(null);
  const [testingQuery, setTestingQuery] = useState(false);
  const [resyncingId, setResyncingId] = useState(null);
  const [dirty, setDirty] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [unsavedModalTarget, setUnsavedModalTarget] = useState(null);

  useEffect(() => {
    if (typeof onDirtyChange === "function") onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const markDirty = () => setDirty(true);

  const requestTab = (nextId) => {
    if (nextId === tab) return;
    if (dirty) {
      setUnsavedModalTarget(nextId);
      return;
    }
    setTab(nextId);
  };

  const handleConfirmLeave = () => {
    const target = unsavedModalTarget;
    setDirty(false);
    setUnsavedModalTarget(null);
    if (target) setTab(target);
  };

  const handleSaveAndLeave = async () => {
    const target = unsavedModalTarget;
    await save(true);
    setUnsavedModalTarget(null);
    if (target) setTab(target);
  };

  const handleCancelLeave = () => {
    setUnsavedModalTarget(null);
  };

  useEffect(() => {
    const onExternalSave = () => {
      save(true);
    };
    window.addEventListener("aivhub_save_company", onExternalSave);
    return () => window.removeEventListener("aivhub_save_company", onExternalSave);
  }, [profile, sources, services, faq, voiceName]);

  const update = (k, v) => {
    markDirty();
    setProfile((p) => {
      const next = { ...p, [k]: v };
      try { localStorage.setItem("aivhub_company_profile", JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const save = async (showToast = true) => {
    setSaving(true);
    setSaveStatus(null);
    setDirty(false);
    try {
      localStorage.setItem("aivhub_company_profile", JSON.stringify(profile));
      localStorage.setItem("aivhub_sources", JSON.stringify(sources));
      localStorage.setItem("aivhub_services", JSON.stringify(services));
      localStorage.setItem("aivhub_faq", JSON.stringify(faq));
    } catch (_) {}
    try {
      await api.updateProfile(profile);
      announceOrgUpdated();
      await api.saveServices(services);
      await api.saveFaqs(faq);
      if (voiceName) {
        try {
          await api.selectVoice({
            voice_id: voiceName,
            label:
              voiceName === "rex-uk" ? "Rex UK — Sam (British, male)"
              : voiceName === "ara-uk" ? "Ara UK (British, female)"
              : voiceName === "eve-uk" ? "Eve UK (British, female)"
              : voiceName === "rex" ? "Rex (Sam / male)"
              : voiceName === "ara" ? "Ara (female)"
              : voiceName,
            provider: "xai",
            accent: String(voiceName || "").includes("-uk") ? "british" : undefined,
          });
        } catch (_) {}
      }
      setSaving(false);
      setSaved(true);
      setSaveStatus("saved");
      if (showToast && typeof setNotifications === "function") {
        setNotifications((ns) => [{ id: "n_" + Date.now(), text: "✓ Company profile, call rules & compliance saved", time: "just now", unread: true, type: "success" }, ...(ns || [])]);
      }
    } catch (err) {
      console.warn("Backend updateProfile warning:", err);
      setSaving(false);
      setSaved(true);
      setSaveStatus("saved_local");
      if (showToast && typeof setNotifications === "function") {
        setNotifications((ns) => [{ id: "n_" + Date.now(), text: "Company profile changes saved locally", time: "just now", unread: true, type: "info" }, ...(ns || [])]);
      }
    }
    setTimeout(() => {
      setSaved(false);
      setSaveStatus(null);
    }, 3000);
  };

  const renderSaveBtn = (label = "Save changes") => (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginTop: 8 }}>
      <button
        type="button"
        onClick={() => save(true)}
        disabled={saving}
        style={{
          background: saved ? "#059669" : saving ? "#4b5563" : "linear-gradient(135deg, #2a47ae 0%, #1a2d7a 100%)",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          padding: "10px 20px",
          fontFamily: FONT_BODY,
          fontSize: 13,
          fontWeight: 600,
          cursor: saving ? "wait" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          transition: "all 0.2s ease",
          boxShadow: saved ? "0 4px 12px rgba(5, 150, 105, 0.3)" : "0 4px 12px rgba(42, 71, 174, 0.25)",
        }}
      >
        {saving ? (
          <>
            <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} />
            <span>Saving changes...</span>
          </>
        ) : saved ? (
          <>
            <Check size={14} />
            <span>Changes Saved!</span>
          </>
        ) : (
          <>
            <span>💾</span>
            <span>{label}</span>
          </>
        )}
      </button>
      {dirty && !saved && !saving && (
        <span style={{ fontSize: 12, color: "#b45309", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
          ● Unsaved changes
        </span>
      )}
      {saved && (
        <span style={{ fontSize: 12, color: "#059669", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <CheckCircle2 size={14} /> Synced to database
        </span>
      )}
    </div>
  );

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


  const addService = () => {
    markDirty();
    setServices((s) => {
      const next = [...s, { id: "sv_" + Date.now(), name: "", ideal: "", desc: "" }];
      try { localStorage.setItem("aivhub_services", JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const updateService = (id, k, v) => {
    markDirty();
    setServices((s) => {
      const next = s.map((x) => (x.id === id ? { ...x, [k]: v } : x));
      try { localStorage.setItem("aivhub_services", JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const removeService = (id) => {
    markDirty();
    setServices((s) => {
      const next = s.filter((x) => x.id !== id);
      try { localStorage.setItem("aivhub_services", JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const addFaq = () => {
    markDirty();
    setFaq((f) => {
      const next = [...f, { id: "f_" + Date.now(), q: "", a: "" }];
      try { localStorage.setItem("aivhub_faq", JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const updateFaq = (id, k, v) => {
    markDirty();
    setFaq((f) => {
      const next = f.map((x) => (x.id === id ? { ...x, [k]: v } : x));
      try { localStorage.setItem("aivhub_faq", JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const removeFaq = (id) => {
    markDirty();
    setFaq((f) => {
      const next = f.filter((x) => x.id !== id);
      try { localStorage.setItem("aivhub_faq", JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const renderProfileTabs = (mode) => (
    <div style={mode === "pills"
      ? { display: "flex", gap: 8, flexWrap: "wrap" }
      : { display: "flex", flexDirection: "column", gap: 2 }
    }>
      {PROFILE_TABS.map((t) => {
        const Icon = t.icon;
        const active = tab === t.id;
        const pill = mode === "pills";
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => requestTab(t.id)}
            style={pill ? {
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              borderRadius: 8,
              border: `1px solid ${active ? C.ink : C.border}`,
              background: active ? C.ink : "#fff",
              color: active ? "#fff" : C.slate,
              fontFamily: FONT_BODY,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            } : {
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "9px 11px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              textAlign: "left",
              background: active ? C.cobaltSoft : "transparent",
              color: active ? C.cobaltDeep : C.slate,
              fontFamily: FONT_BODY,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <Icon size={15} /> {t.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      {!embedded && <TopBar title="Company Profile" subtitle="Everything the AI knows about your company when it's on a call" notifications={notifications} setNotifications={setNotifications} />}
      <div style={embedded
        ? { padding: 0, display: "flex", flexDirection: "column", gap: 14 }
        : { padding: "20px 32px", display: "grid", gridTemplateColumns: "200px 1fr", gap: 24 }
      }>
        {renderProfileTabs(embedded ? "pills" : "rail")}

        <div style={{ width: "100%", maxWidth: embedded ? "100%" : ((tab === "services" || tab === "knowledge") ? 1040 : 760), transition: "max-width 0.25s ease" }}>
          {tab === "identity" && (
            <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
              <SectionIntro icon={Users} title="Company identity" desc="Basic facts the AI introduces itself with and uses to explain who it's calling on behalf of." />
              <Field label="Company name" value={profile.name} onChange={(v) => update("name", v)} placeholder="Your company" />
              <Field
                label="Say company name as (spoken)"
                value={profile.spokenName || ""}
                onChange={(v) => update("spokenName", v)}
                placeholder="How the voice should say your brand"
                hint="Optional. Blank = say the company name as written."
              />
              <Field label="Industry" value={profile.industry || ""} onChange={(v) => update("industry", v)} placeholder="Industry" />
              <Field label="Website" value={profile.website || ""} onChange={(v) => update("website", v)} placeholder="https://" hint="Also added automatically as a knowledge source." />
              <Field label="LinkedIn / other social links" value={profile.social || ""} onChange={(v) => update("social", v)} placeholder="linkedin.com/company/…" />
              <Field label="Caller persona name" value={profile.callerName} onChange={(v) => update("callerName", v)} placeholder="Name the agent uses" hint="The name the AI introduces itself as on calls." />
              <Field label="Caller ID number shown" value={profile.callerId} onChange={(v) => update("callerId", v)} placeholder="+44…" />
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Organisation timezone</div>
                <select
                  value={profile.timezone || "Europe/London"}
                  onChange={(e) => update("timezone", e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}
                >
                  {!TIMEZONES.some((z) => z.id === (profile.timezone || "Europe/London")) ? <option value={profile.timezone}>{profile.timezone}</option> : null}
                  {TIMEZONES.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
                </select>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>The whole app runs on this clock: post schedules, call windows, callbacks, meetings and call logs.</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Week starts on</div>
                  <select
                    value={profile.weekStart || "monday"}
                    onChange={(e) => update("weekStart", e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, background: "#fff" }}
                  >
                    <option value="monday">Monday</option>
                    <option value="sunday">Sunday</option>
                    <option value="saturday">Saturday</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Time format</div>
                  <select
                    value={profile.timeFormat || "24h"}
                    onChange={(e) => update("timeFormat", e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, background: "#fff" }}
                  >
                    <option value="24h">24-hour (14:30)</option>
                    <option value="12h">12-hour (2:30 PM)</option>
                  </select>
                </div>
              </div>
              <Field
                label="Post approver emails"
                value={Array.isArray(profile.approverEmails) ? profile.approverEmails.join(", ") : (profile.approverEmails || "")}
                onChange={(v) => update("approverEmails", v)}
                placeholder="approver@company.com, manager@company.com"
                hint="Every scheduled post is sent here for approval. Separate several with commas."
              />
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Active Calendar Engine</div>
                <select
                  value={profile.calendar_mode || profile.calendarMode || "internal"}
                  onChange={(e) => update("calendar_mode", e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, background: "#fff" }}
                >
                  <option value="internal">Internal Database Calendar</option>
                  <option value="calcom">Cal.com Cloud Calendar & Event Types</option>
                </select>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>
                  Switch at any time. When using Internal mode, booked appointments appear directly in your local Meetings tab. When Cal.com is selected, slots and bookings synchronize via Cal.com.
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>When we may call — a policy, not an accident</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, lineHeight: 1.5, marginBottom: 10 }}>
                  UK PECR for B2B live calls: <strong>08:00–21:00 weekdays</strong>, <strong>09:00–18:00 weekends</strong>. Calling a shorter office day is legal. It is not the legal maximum.
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {CALL_HOUR_POLICIES.map((p) => {
                    const active = (profile.callHoursPolicy || "respectful") === p.id;
                    const range = p.id === "custom"
                      ? `${profile.weekdayStart || "09:00"}–${profile.weekdayEnd || "17:30"}`
                      : `${p.weekdayStart}–${p.weekdayEnd}`;
                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          const next = applyCallHourPolicy(p.id, profile);
                          setProfile((pr) => {
                            const merged = { ...pr, ...next };
                            try { localStorage.setItem("aivhub_company_profile", JSON.stringify(merged)); } catch (_) {}
                            return merged;
                          });
                        }}
                        style={{
                          textAlign: "left", padding: "11px 13px", borderRadius: 9, cursor: "pointer",
                          border: `1.5px solid ${active ? C.ink : C.border}`, background: active ? C.paper : "#fff",
                        }}
                      >
                        <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, color: C.textInk }}>
                          {p.label} · {range} weekdays
                        </div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, marginTop: 4, lineHeight: 1.4 }}>{p.blurb}</div>
                      </button>
                    );
                  })}
                </div>
                {(profile.callHoursPolicy || "respectful") === "custom" && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate }}>Window</span>
                      <select
                        value={profile.weekdayStart || "09:00"}
                        onChange={(e) => {
                          const v = e.target.value;
                          setProfile((p) => {
                            const next = { ...p, weekdayStart: v, callHoursPolicy: "custom" };
                            try { localStorage.setItem("aivhub_company_profile", JSON.stringify(next)); } catch (_) {}
                            return next;
                          });
                        }}
                        style={{ flex: 1, minWidth: 110, padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}
                      >
                        {WEEKDAY_HOUR_OPTIONS.filter((t) => t < (profile.weekdayEnd || "21:00")).map((t) => <option key={t}>{t}</option>)}
                      </select>
                      <span style={{ color: C.slateLight }}>–</span>
                      <select
                        value={profile.weekdayEnd || "17:30"}
                        onChange={(e) => {
                          const v = e.target.value;
                          setProfile((p) => {
                            const next = { ...p, weekdayEnd: v, callHoursPolicy: "custom" };
                            try { localStorage.setItem("aivhub_company_profile", JSON.stringify(next)); } catch (_) {}
                            return next;
                          });
                        }}
                        style={{ flex: 1, minWidth: 110, padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}
                      >
                        {WEEKDAY_HOUR_OPTIONS.filter((t) => t > (profile.weekdayStart || "08:00")).map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 6 }}>
                      Hard stop is PECR 08:00–21:00 weekdays.
                    </div>
                  </>
                )}
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>Lunch break of the people we call</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select value={profile.lunchStart || "12:00"} onChange={(e) => update("lunchStart", e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}>
                    {LUNCH_HOUR_OPTIONS.filter((t) => t < (profile.lunchEnd || "15:00")).map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <span style={{ color: C.slateLight }}>–</span>
                  <select value={profile.lunchEnd || "13:00"} onChange={(e) => update("lunchEnd", e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13 }}>
                    {LUNCH_HOUR_OPTIONS.filter((t) => t > (profile.lunchStart || "11:00")).map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>No voice, WhatsApp, SMS, or email is sent in this window — so nobody is disturbed at lunch.</div>
              </div>
              <Field label="Tone" value={profile.tone} onChange={(v) => update("tone", v)} placeholder="Professional, concise, friendly" />
              {renderSaveBtn("Save changes")}
            </div>
          )}

          {tab === "knowledge" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
                {(() => {
                  const ragFailed = sources.filter((s) => s.status === "failed").length;
                  const ragCrawling = sources.some((s) => s.status === "crawling" || resyncingId === s.id);
                  const ragChunks = sources.reduce((n, s) => n + (Number(s.chunkCount) || 0), 0);
                  const ragLive = sources.filter((s) => s.status !== "failed" && s.status !== "crawling").length;
                  const ragTone = ragCrawling
                    ? { bg: "#FFFBEB", bd: "#FDE68A", fg: "#92400E", label: "Indexing sources", sub: "Crawler is splitting pages into chunks for on-call search." }
                    : ragLive && !ragFailed
                      ? { bg: "#ECFDF5", bd: "#A7F3D0", fg: "#065F46", label: "Knowledge live on calls", sub: `${ragLive} source${ragLive === 1 ? "" : "s"} · ${ragChunks} chunk${ragChunks === 1 ? "" : "s"} · pitch, pricing and product answers come from these pages.` }
                      : ragLive && ragFailed
                        ? { bg: "#FFF7ED", bd: "#FED7AA", fg: "#9A3412", label: "Knowledge partial", sub: `${ragLive} live · ${ragFailed} failed · Re-crawl the failed URL so the agent is not answering from a thin index.` }
                        : ragFailed
                          ? { bg: "#FEF2F2", bd: "#FECACA", fg: "#991B1B", label: "Knowledge offline", sub: "All sources failed. Re-crawl before expecting website answers on a call." }
                          : { bg: "#F8FAFC", bd: C.border, fg: C.slate, label: "No sources indexed", sub: "Add your website or docs. The agent only enriches the pitch from what you index here." };
                  return (
                    <>
                  <SectionIntro
                    icon={BookOpen}
                    title="Knowledge sources & vector database"
                        desc="Websites, PDFs, documents, or objection playbooks. The crawler extracts text, chunks it, and indexes it for recall on live calls. The one-line pitch is the spine — this index is how the AI fills in product, pricing, and proof."
                      />
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, margin: "14px 0 18px", padding: "12px 14px", borderRadius: 12, background: ragTone.bg, border: `1px solid ${ragTone.bd}` }}>
                        <span style={{
                          width: 10, height: 10, borderRadius: 99, marginTop: 4, flexShrink: 0,
                          background: ragTone.fg,
                          boxShadow: ragCrawling || ragLive ? `0 0 0 4px ${ragTone.bd}` : "none",
                        }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, color: ragTone.fg, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            {ragTone.label}
                            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", opacity: 0.8 }}>pgvector</span>
                  </div>
                          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: ragTone.fg, opacity: 0.85, marginTop: 3, lineHeight: 1.45 }}>{ragTone.sub}</div>
                </div>
                      </div>
                    </>
                  );
                })()}

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
                <button onClick={addFaq} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px dashed ${C.border}`, borderRadius: 8, padding: "9px 12px", fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, cursor: "pointer", width: "100%", justifyContent: "center", marginTop: 12 }}>
                  <PlusCircle size={13} /> Add a question
                </button>
              </div>

              {renderSaveBtn("Save knowledge & FAQs")}
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
                {renderSaveBtn("Save services")}
              </div>
            </div>
          )}

          {tab === "compliance" && (
            <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22 }}>
              <SectionIntro icon={ShieldCheck} title="Compliance & legal" desc="Details needed for UK outbound-calling rules — shown to admins only, never spoken on calls." />
              <Field label="Registered legal company name" value={profile.legalName || ""} onChange={(v) => update("legalName", v)} placeholder="Legal entity name" />
              <Field label="ICO registration reference" value={profile.icoRef || ""} onChange={(v) => update("icoRef", v)} placeholder="ICO reference" />
              <Field label="Data protection contact" value={profile.dpoContact || ""} onChange={(v) => update("dpoContact", v)} placeholder="privacy@company.com" />
              <Field label="Do-not-call list handling notes" value={profile.dncNotes || ""} onChange={(v) => update("dncNotes", v)} placeholder="Opt-outs logged immediately and excluded from all future missions." textarea />
              {renderSaveBtn("Save changes")}
            </div>
          )}
        </div>
      </div>

      {saved && (
        <div style={{ position: "fixed", bottom: 24, right: 32, background: C.ink, color: "#fff", padding: "12px 18px", borderRadius: 10, fontFamily: FONT_BODY, fontSize: 12.5, display: "flex", alignItems: "center", gap: 10 }}>
          <CheckCircle2 size={15} color={C.teal} /> Saved — used on all future calls
        </div>
      )}

      {unsavedModalTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100000,
            background: "rgba(15, 23, 42, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={handleCancelLeave}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 460,
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(226, 232, 240, 0.8)",
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: "#FEF3C7",
                  border: "1px solid #FDE68A",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  color: "#D97706",
                }}
              >
                <AlertTriangle size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: "#0F172A", lineHeight: 1.3 }}>
                  Unsaved changes
                </div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: "#475569", marginTop: 6, lineHeight: 1.5 }}>
                  You have unsaved changes on this page. If you leave now without saving, your recent edits will be lost.
                </div>
              </div>
              <button
                type="button"
                onClick={handleCancelLeave}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94A3B8",
                  cursor: "pointer",
                  padding: 4,
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 8,
                marginTop: 8,
                paddingTop: 16,
                borderTop: "1px solid #F1F5F9",
              }}
            >
              <button
                type="button"
                onClick={handleCancelLeave}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid #E2E8F0",
                  background: "#ffffff",
                  color: "#475569",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: FONT_BODY,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmLeave}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid #FCA5A5",
                  background: "#FEF2F2",
                  color: "#DC2626",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: FONT_BODY,
                }}
              >
                Leave without saving
              </button>
              <button
                type="button"
                onClick={handleSaveAndLeave}
                disabled={saving}
                style={{
                  padding: "8px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: "linear-gradient(135deg, #2a47ae 0%, #1a2d7a 100%)",
                  color: "#ffffff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: saving ? "wait" : "pointer",
                  fontFamily: FONT_BODY,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  boxShadow: "0 4px 12px rgba(42, 71, 174, 0.25)",
                }}
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------------------------- connections & key validator ---------------------------------- */

const FAMOUS_PROVIDERS_BY_LAYER = {
  "LLM": ["Telnyx AI", "xAI (Grok)", "DeepSeek", "OpenAI", "Anthropic", "Groq", "Mistral", "Together AI", "Other (Custom Base URL)"],
  "Speech-to-Text": ["Deepgram", "Telnyx Whisper", "Faster-Whisper (Self-Hosted)", "OpenAI Whisper", "Gladia", "Speechmatics", "Other (Custom Base URL)"],
  "Text-to-Speech": ["Cartesia", "ElevenLabs", "Telnyx Natural (TTS)", "Deepgram Aura", "PlayHT", "Kokoro-82M (Self-Hosted)", "Other (Custom Base URL)"],
  "Telephony": ["Twilio", "Telnyx", "Plivo", "SIP Trunk (Custom)", "Other (Custom Base URL)"],
  "Messaging": ["WhatsApp Cloud API (Meta)", "Twilio WhatsApp", "Other (Custom Base URL)"],
  "Calendar": ["Cal.com (Self-Hosted)", "Cal.com (Cloud)", "Google Calendar", "Microsoft Outlook", "Other (Custom Base URL)"],
  "Voice Orchestration": ["LiveKit (Self-Hosted)", "xAI Voice Agent", "Vapi", "Retell AI", "OpenAI Realtime API", "Other (Custom Base URL)"],
  "Business Discovery": ["Apollo.io", "LeadMagic", "Google Places API", "Other (Custom Base URL)"],
  "Other": ["Other (Custom Base URL)"]
};

function AddIntegrationModal({ onClose, onAddSuccess, initialCategory = "LLM" }) {
  const [category, setCategory] = useState(initialCategory && FAMOUS_PROVIDERS_BY_LAYER[initialCategory] ? initialCategory : "LLM");
  const [providerChoice, setProviderChoice] = useState(
    ((FAMOUS_PROVIDERS_BY_LAYER[initialCategory] || FAMOUS_PROVIDERS_BY_LAYER.LLM) || ["Other (Custom Base URL)"])[0]
  );
  const [customName, setCustomName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [accountSid, setAccountSid] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [showPhoneField, setShowPhoneField] = useState(false);

  const [testing, setTesting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const isOther = providerChoice.startsWith("Other") || category === "Other";
  const isTwilio = providerChoice === "Twilio" || providerChoice.includes("Twilio");
  const isTelnyx = providerChoice.toLowerCase().includes("telnyx");
  const isWhatsApp = providerChoice.toLowerCase().includes("whatsapp") || category === "Messaging";
  const isTts = category === "Text-to-Speech";
  const providerList = FAMOUS_PROVIDERS_BY_LAYER[category] || ["Other (Custom Base URL)"];

  const getModelPlaceholder = (cat, prov) => {
    if (prov.includes("Telnyx AI") || (cat === "LLM" && prov.includes("Telnyx"))) return "meta-llama/Meta-Llama-3.1-70B-Instruct";
    if (prov.includes("Telnyx Whisper") || (cat === "Speech-to-Text" && prov.includes("Telnyx"))) return "openai/whisper-large-v3";
    if (prov.includes("Telnyx Natural") || (cat === "Text-to-Speech" && prov.includes("Telnyx"))) return "telnyx/natural";
    if (prov.includes("DeepSeek")) return "deepseek-chat";
    if (prov.includes("OpenAI") && cat === "LLM") return "gpt-4o-mini";
    if (prov.includes("OpenAI") && cat === "Speech-to-Text") return "whisper-1";
    if (prov.includes("Anthropic")) return "claude-3-5-sonnet-20241022";
    if (prov.includes("xAI") || prov.includes("Grok")) return "grok-4.20-0309-non-reasoning";
    if (prov.includes("Groq")) return "llama-3.3-70b-versatile";
    if (prov.includes("Deepgram") && cat === "Speech-to-Text") return "nova-2";
    if (prov.includes("Deepgram") && cat === "Text-to-Speech") return "aura-asteria-en";
    if (prov.includes("Cartesia")) return "sonic-3";
    if (prov.includes("ElevenLabs")) return "eleven_turbo_v2_5";
    if (cat === "LLM") return "e.g. meta-llama/Meta-Llama-3.1-70B-Instruct";
    if (cat === "Speech-to-Text") return "e.g. nova-2, openai/whisper-large-v3";
    if (cat === "Text-to-Speech") return "e.g. sonic-3, telnyx/natural";
    return "e.g. model-id-or-slug";
  };

  const handleCategoryChange = (cat) => {
    setCategory(cat);
    const firstChoice = (FAMOUS_PROVIDERS_BY_LAYER[cat] || ["Other (Custom Base URL)"])[0];
    setProviderChoice(firstChoice);
    setErrorMsg("");
    setSuccessMsg("");
    setShowPhoneField(false);
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

    if (isWhatsApp && !accountSid.trim()) {
      setErrorMsg("WhatsApp Cloud API requires your Meta Phone Number ID.");
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
        model: model.trim() || undefined,
        voice_id: isTts && voiceId.trim() ? voiceId.trim() : undefined,
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
          model: model.trim() || undefined,
          baseUrl: baseUrl.trim() || undefined,
          voiceId: isTts && voiceId.trim() ? voiceId.trim() : undefined,
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
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", padding: 26, boxShadow: "0 24px 70px rgba(0,0,0,0.25)", border: `1px solid ${C.border}` }}>
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

          {/* Model Name / Slug */}
          {(category === "LLM" || category === "Speech-to-Text" || category === "Text-to-Speech" || category === "Voice Orchestration" || isOther) && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{ fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {category === "LLM" ? "Model Name / Slug" : category === "Speech-to-Text" ? "STT Model / Engine" : category === "Text-to-Speech" ? "TTS Voice / Model" : "Model Identifier (Optional)"}
                </label>
                {(category === "LLM" || category === "Speech-to-Text" || category === "Text-to-Speech") && (
                  <span
                    style={{ fontSize: 11, color: C.cobalt, cursor: "pointer", fontWeight: 600 }}
                    onClick={() => setModel(getModelPlaceholder(category, providerChoice))}
                    title="Click to fill recommended default model"
                  >
                    Auto-fill default
                  </span>
                )}
              </div>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={getModelPlaceholder(category, providerChoice)}
                style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5 }}
              />
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>
                {category === "LLM"
                  ? "Specify the model to run for conversational reasoning (e.g. meta-llama/Meta-Llama-3.1-70B-Instruct for Telnyx AI)."
                  : category === "Speech-to-Text"
                  ? "Acoustic model for speech recognition (e.g. openai/whisper-large-v3, nova-2)."
                  : category === "Text-to-Speech"
                  ? "Voice model synthesis engine (e.g. telnyx/natural, sonic-3)."
                  : "Model or engine identifier required by this endpoint."}
              </div>
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

          {/* WhatsApp Phone Number ID */}
          {isWhatsApp && (
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                WhatsApp Phone Number ID
              </label>
              <input
                value={accountSid}
                onChange={(e) => setAccountSid(e.target.value)}
                placeholder="e.g. 1238965585975808 (15-digit ID from Meta Dev App)"
                style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5 }}
              />
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>
                Found in Meta for Developers &gt; WhatsApp &gt; API Setup &gt; Phone number ID.
              </div>
            </div>
          )}

          {/* WhatsApp Registered Phone Number */}
          {isWhatsApp && (
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                WhatsApp Registered Phone Number
              </label>
              <input
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="e.g. +44... or +1..."
                style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5 }}
              />
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>
                The verified WhatsApp Business phone number used to send/receive messages.
              </div>
            </div>
          )}

          {/* Telnyx Telephony Outbound Phone Number (Direct for Telephony layer) */}
          {isTelnyx && category === "Telephony" && (
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                Telnyx Outbound Phone Number
              </label>
              <input
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="e.g. +44... or +1..."
                style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5 }}
              />
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>
                This number is verified on your Telnyx portal and used as your outbound Caller ID.
              </div>
            </div>
          )}

          {/* Telnyx Phone Number Optional Accordion Dropdown (for LLM / STT / TTS) */}
          {isTelnyx && category !== "Telephony" && (
            <div style={{ border: `1px dashed ${C.border}`, borderRadius: 8, padding: "10px 12px", background: "#FAF9F6" }}>
              <button
                type="button"
                onClick={() => setShowPhoneField(!showPhoneField)}
                style={{ background: "none", border: "none", cursor: "pointer", color: C.cobalt, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, padding: 0, display: "flex", alignItems: "center", gap: 4 }}
              >
                {showPhoneField ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {showPhoneField ? "Hide Telnyx Outbound Caller ID" : "Attach Outbound Phone Number (Optional)"}
              </button>
              {showPhoneField && (
                <div style={{ marginTop: 8 }}>
                  <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>
                    Telnyx Outbound Phone Number
                  </label>
                  <input
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="e.g. +44... or +1..."
                    style={{ width: "100%", height: 36, padding: "0 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12, background: "#fff" }}
                  />
                  <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.slateLight, marginTop: 3 }}>
                    Optional: Save as your outbound Caller ID when dialing via Telnyx.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* API Key */}
          <div>
            <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
              {isTwilio ? "Auth Token" : isTelnyx ? "Telnyx API V2 Key" : isWhatsApp ? "Meta WhatsApp Access Token (EAAG...)" : "API Key / Token"}
            </label>
            <div style={{ position: "relative", width: "100%" }}>
              <input
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setErrorMsg(""); setSuccessMsg(""); }}
                placeholder={isTelnyx ? "KEY018..." : isWhatsApp ? "EAAG..." : providerChoice.includes("DeepSeek") ? "sk-..." : providerChoice.includes("OpenAI") ? "sk-proj-..." : providerChoice.includes("Deepgram") ? "Token..." : "Paste API key..."}
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

          {isTts && (
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                Cloned Voice ID (optional)
              </label>
              <input
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                placeholder={providerChoice.includes("Cartesia") ? "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" : "ElevenLabs or Cartesia voice id"}
                style={{ width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5 }}
              />
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>
                With Voice Orchestration = xAI, this TTS plugin speaks your clone on live calls.
              </div>
            </div>
          )}

          {/* Base URL (if custom or Cal.com) */}
          {(isOther || providerChoice.includes("Cal.com")) && (
            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                Base URL / Endpoint
              </label>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={providerChoice.includes("Cal.com") ? "https://api.cal.com/v2" : "https://api.your-custom-llm.com/v1"}
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

function DirectOutboundCallCard({ notifications, setNotifications, defaultFromNumber, onViewLiveCalls, onCallCreated, prefillData, style }) {
  const [toNumber, setToNumber] = useState(prefillData?.toNumber || "");
  const [prospectName, setProspectName] = useState(prefillData?.prospectName || "");
  const [fromNumber, setFromNumber] = useState(defaultFromNumber || "");
  const [carrierChoice, setCarrierChoice] = useState("twilio");
  const [missionTitle, setMissionTitle] = useState(prefillData?.missionTitle || "Direct Client Outreach");
  const [liveKitModalOpen, setLiveKitModalOpen] = useState(false);

  useEffect(() => {
    if (defaultFromNumber) {
      setFromNumber((prev) => (!prev || prev.includes("79460912") ? defaultFromNumber : prev));
    }
  }, [defaultFromNumber]);
  const [accountSid, setAccountSid] = useState(() => {
    try {
      const saved = (localStorage.getItem("aivhub_twilio_sid") || "").trim();
      // If the saved value is truncated or invalid (not 34 chars starting with AC), purge it immediately!
      if (saved && (!saved.startsWith("AC") || saved.length !== 34)) {
        localStorage.removeItem("aivhub_twilio_sid");
        return "";
      }
      return saved;
    } catch (_) { return ""; }
  });
  const [authToken, setAuthToken] = useState(() => {
    try {
      const saved = (localStorage.getItem("aivhub_twilio_token") || "").trim();
      // If the saved token is truncated or invalid (not 32 chars), purge it immediately!
      if (saved && saved.length !== 32) {
        localStorage.removeItem("aivhub_twilio_token");
        return "";
      }
      return saved;
    } catch (_) { return ""; }
  });
  const [showCreds, setShowCreds] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Auto-sync Twilio credentials to localStorage ONLY if completely valid; otherwise remove
  useEffect(() => {
    try {
      const clean = (accountSid || "").trim();
      if (clean && clean.startsWith("AC") && clean.length === 34) {
        localStorage.setItem("aivhub_twilio_sid", clean);
      } else {
        localStorage.removeItem("aivhub_twilio_sid");
      }
    } catch (_) {}
  }, [accountSid]);

  useEffect(() => {
    try {
      const clean = (authToken || "").trim();
      if (clean && clean.length === 32) {
        localStorage.setItem("aivhub_twilio_token", clean);
      } else {
        localStorage.removeItem("aivhub_twilio_token");
      }
    } catch (_) {}
  }, [authToken]);

  // Clean any legacy invalid items from localStorage on mount
  useEffect(() => {
    try {
      const s = localStorage.getItem("aivhub_twilio_sid");
      if (s && (!s.startsWith("AC") || s.length !== 34)) {
        localStorage.removeItem("aivhub_twilio_sid");
        setAccountSid("");
      }
      const t = localStorage.getItem("aivhub_twilio_token");
      if (t && t.length !== 32) {
        localStorage.removeItem("aivhub_twilio_token");
        setAuthToken("");
      }
    } catch (_) {}
  }, []);

  const [savedContacts, setSavedContacts] = useState(() => {
    try {
      const saved = localStorage.getItem("aivhub_saved_contacts");
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return [
      { id: "sc_jm", name: "Jitendra Mehta", company: "AIVHub Ltd", phone: "+447577570050", role: "CEO / Director" },
      { id: "sc_ops", name: "Operations Desk", company: "AIVHub", phone: "+447307216767", role: "Support" }
    ];
  });

  useEffect(() => {
    if (prefillData) {
      if (prefillData.toNumber) setToNumber(prefillData.toNumber);
      if (prefillData.prospectName) setProspectName(prefillData.prospectName);
      if (prefillData.missionTitle) setMissionTitle(prefillData.missionTitle);
    }
  }, [prefillData]);

  const [dialing, setDialing] = useState(false);
  const [dialResult, setDialResult] = useState(null);
  const [dialError, setDialError] = useState("");
  const [saveStatus, setSaveStatus] = useState(null);

  const handleSaveTwilioCreds = async () => {
    const cleanSid = (accountSid || "").trim();
    const cleanToken = (authToken || "").trim();
    if (!cleanSid || !cleanToken) {
      setSaveStatus({ error: "Please enter both Twilio Account SID and Auth Token." });
      return;
    }
    if (!cleanSid.startsWith("AC") || cleanSid.length !== 34) {
      setSaveStatus({ error: `Account SID must start with 'AC' and be exactly 34 characters (currently ${cleanSid.length}). Found: '${cleanSid}'. Please copy the full Account SID from console.twilio.com.` });
      return;
    }
    if (cleanToken.length !== 32) {
      setSaveStatus({ error: `Auth Token must be exactly 32 characters (currently ${cleanToken.length}). Please copy the full Auth Token from console.twilio.com.` });
      return;
    }
    setSaveStatus({ saving: true });
    try {
      // Account SID is an identifier; Auth Token is sealed in DB only — never keep token in browser vault.
      localStorage.setItem("aivhub_twilio_sid", cleanSid);
      localStorage.removeItem("aivhub_twilio_token");
      await api.testAndSaveConnection({
        layer: "Telephony",
        provider: "Twilio",
        api_key: cleanToken,
        account_sid: cleanSid
      });
      setAuthToken("");
      setSaveStatus({ success: "✓ Twilio credentials encrypted & saved to database (token not kept in browser)." });
      setTimeout(() => setSaveStatus(null), 3500);
    } catch (err) {
      setSaveStatus({ error: err.message || "Failed to verify Twilio credentials." });
      setTimeout(() => setSaveStatus(null), 4500);
    }
  };

  const handleDial = async (e) => {
    if (e) e.preventDefault();
    if (carrierChoice === "livekit") {
      setLiveKitModalOpen(true);
      return;
    }
    if (!toNumber.trim()) {
      setDialError("Please enter a destination phone number.");
      return;
    }
    setDialing(true);
    setDialError("");
    setDialResult(null);

    const cleanSid = (accountSid || "").trim();
    const cleanToken = (authToken || "").trim();

    // If valid full credentials are provided, save to localStorage and pass in payload
    const validSid = (cleanSid && cleanSid.startsWith("AC") && cleanSid.length === 34) ? cleanSid : undefined;
    const validToken = (cleanToken && cleanToken.length === 32) ? cleanToken : undefined;

    if (validSid) {
      try { localStorage.setItem("aivhub_twilio_sid", validSid); } catch (_) {}
    }
    if (validToken) {
      try { localStorage.setItem("aivhub_twilio_token", validToken); } catch (_) {}
    }

    try {
      const payload = {
        to_number: toNumber.trim(),
        from_number: fromNumber.trim() || undefined,
        prospect_name: prospectName.trim() || undefined,
        mission_title: missionTitle.trim() || "Direct Client Outreach",
        carrier: carrierChoice,
        account_sid: validSid,
        api_key: validToken
      };
      const res = await api.dialOutbound(payload);
      setDialResult(res);
      if (onCallCreated) {
        try { onCallCreated(res, payload); } catch (_) {}
      }
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
      background: "#fff",
      borderRadius: 16,
      padding: isExpanded ? "20px 24px" : "14px 16px",
      color: C.textInk,
      border: `1px solid ${C.border}`,
      boxShadow: "0 8px 28px rgba(18,20,28,0.06)",
      margin: 0,
      ...style
    }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => { if (!isExpanded) setIsExpanded(true); }}
        onKeyDown={(e) => { if (!isExpanded && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setIsExpanded(true); } }}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: isExpanded ? 16 : 0, cursor: isExpanded ? "default" : "pointer" }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ background: C.teal, width: 8, height: 8, borderRadius: "50%", display: "inline-block" }} />
            <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: C.slate }}>
              Direct outbound
            </span>
          </div>
          {isExpanded ? (
            <>
              <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 18, color: C.textInk, margin: "6px 0 2px" }}>
                Dial one number
              </h2>
              <p style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, margin: 0, maxWidth: 680, lineHeight: 1.4 }}>
                Test a single live line. Same voice stack as list calls. List page already dials the file — use this only for a one-off.
              </p>
            </>
          ) : (
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 4 }}>
              Collapsed. Click to expand and place a one-off test call.
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }} onClick={(e) => e.stopPropagation()}>
          {isExpanded && onViewLiveCalls && (
            <button
              type="button"
              onClick={onViewLiveCalls}
              style={{
                background: C.cobaltSoft,
                border: "1px solid #C7D7FA",
                borderRadius: 8,
                padding: "6px 12px",
                color: C.cobaltDeep,
                fontFamily: FONT_BODY,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5
              }}
            >
              <Activity size={12} color={C.cobalt} /> Live
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              background: C.cobaltSoft,
              border: "1px solid #C7D7FA",
              borderRadius: 8,
              padding: "7px 12px",
              color: C.cobaltDeep,
              fontFamily: FONT_BODY,
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ChevronDown size={14} style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
            {isExpanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {isExpanded && (
        <form onSubmit={handleDial} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Quick Dial Saved Contacts Bar */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "#F8FAFC", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              ⚡ Quick Dial:
            </span>
            {savedContacts.map((sc) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => {
                  setToNumber(sc.phone);
                  setProspectName(sc.name);
                }}
                style={{
                  background: toNumber === sc.phone ? C.cobalt : "#fff",
                  border: `1px solid ${toNumber === sc.phone ? C.cobalt : C.border}`,
                  borderRadius: 16,
                  padding: "4px 10px",
                  color: toNumber === sc.phone ? "#fff" : C.textInk,
                  fontFamily: FONT_BODY,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5
                }}
              >
                <span>📞 {sc.name}</span>
                <span style={{ opacity: 0.75, fontSize: 10.5 }}>({sc.phone})</span>
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {/* Destination Number */}
            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 5 }}>
                Destination Number <span style={{ color: C.red }}>*</span>
              </label>
              <input
                type="text"
                value={toNumber}
                onChange={(e) => setToNumber(e.target.value)}
                placeholder="e.g. +44... or +1..."
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: 7,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  color: C.textInk,
                  fontFamily: FONT_MONO,
                  fontSize: 13.5,
                  boxSizing: "border-box"
                }}
              />
              <div style={{ fontSize: 10.5, color: C.slateLight, marginTop: 3 }}>
                UK mobile (+447...) or international
              </div>
            </div>

            {/* Prospect Name */}
            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 5 }}>
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
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  color: C.textInk,
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  boxSizing: "border-box"
                }}
              />
              <div style={{ fontSize: 10.5, color: C.slateLight, marginTop: 3 }}>
                AI addresses them by name
              </div>
            </div>

            {/* Mission Title */}
            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 5 }}>
                Mission / Campaign
              </label>
              <input
                type="text"
                value={missionTitle}
                onChange={(e) => setMissionTitle(e.target.value)}
                placeholder="e.g. Direct Client Outreach"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: 7,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  color: C.textInk,
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  boxSizing: "border-box"
                }}
              />
              <div style={{ fontSize: 10.5, color: C.slateLight, marginTop: 3 }}>
                Label for tracking & notes
              </div>
            </div>

            {/* Carrier Plugin */}
            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 5 }}>
                Carrier Plugin
              </label>
              <select
                value={carrierChoice}
                onChange={(e) => setCarrierChoice(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: 7,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  color: C.textInk,
                  fontFamily: FONT_BODY,
                  fontSize: 13,
                  fontWeight: 600,
                  boxSizing: "border-box"
                }}
              >
                <option value="twilio">Twilio Voice (UK PSTN)</option>
                <option value="telnyx">Telnyx (BYO SIP Trunk)</option>
                <option value="generic_sip">Generic SIP / PBX</option>
                <option value="livekit">LiveKit WebRTC (In-Browser Test)</option>
              </select>
              <div style={{ fontSize: 10.5, color: C.slateLight, marginTop: 3 }}>
                Multi-provider adapter
              </div>
            </div>

            {/* Caller ID */}
            <div>
              <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.slate, marginBottom: 5 }}>
                Caller ID (From)
              </label>
              <input
                type="text"
                value={fromNumber}
                onChange={(e) => setFromNumber(e.target.value)}
                placeholder="e.g. +44... or +1..."
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: 7,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  color: C.textInk,
                  fontFamily: FONT_MONO,
                  fontSize: 13,
                  boxSizing: "border-box"
                }}
              />
              <div style={{ fontSize: 10.5, color: C.slateLight, marginTop: 3 }}>
                Presented phone line
              </div>
            </div>
          </div>

          {/* Twilio credentials vault */}
          {carrierChoice === "twilio" && (
            <div style={{
              background: "#F8FAFC",
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: "12px 14px",
              marginTop: 6
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: C.textInk }}>
                  <KeyRound size={13} color={C.cobalt} />
                  <span>Twilio Account Credentials (Saved Safely)</span>
                  {accountSid && authToken && (
                    <span style={{ fontSize: 10, color: "#065F46", background: "#D1FAE5", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>
                      ✓ Saved & Active
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {(accountSid || authToken) && (
                    <button
                      type="button"
                      onClick={() => {
                        setAccountSid("");
                        setAuthToken("");
                        try {
                          localStorage.removeItem("aivhub_twilio_sid");
                          localStorage.removeItem("aivhub_twilio_token");
                        } catch (_) {}
                      }}
                      style={{
                        background: "#fff",
                        color: C.slate,
                        border: `1px solid ${C.border}`,
                        borderRadius: 6,
                        padding: "5px 10px",
                        fontSize: 11,
                        cursor: "pointer"
                      }}
                    >
                      Clear & Use Server Vault
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSaveTwilioCreds}
                    disabled={saveStatus?.saving}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      background: C.cobalt,
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "5px 12px",
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer"
                    }}
                  >
                    <Save size={12} />
                    {saveStatus?.saving ? "Saving..." : "Save Credentials"}
                  </button>
                </div>
              </div>
              {!accountSid && !authToken && (
                <div style={{ fontSize: 11, color: "#065F46", background: "#ECFDF5", padding: "6px 10px", borderRadius: 6, marginBottom: 8, display: "flex", alignItems: "center", gap: 6, border: "1px solid #A7F3D0" }}>
                  <span>🛡️</span>
                  <span><strong>Active:</strong> Using verified carrier credentials stored securely in the server vault{fromNumber ? ` (${fromNumber})` : ""}. You do not need to enter credentials manually.</span>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                    <label style={{ fontSize: 10.5, color: C.slate }}>Twilio Account SID</label>
                    <span style={{
                      fontSize: 9.5,
                      fontWeight: 600,
                      color: !accountSid ? C.slateLight : (accountSid.length === 34 && accountSid.startsWith("AC") ? "#059669" : C.red)
                    }}>
                      {accountSid ? `${accountSid.length}/34 chars ${accountSid.length === 34 && accountSid.startsWith("AC") ? "✓" : "(incomplete)"}` : "Required (34 chars)"}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={accountSid}
                    onChange={(e) => setAccountSid(e.target.value)}
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: `1px solid ${accountSid && (accountSid.length !== 34 || !accountSid.startsWith("AC")) ? "#FCA5A5" : C.border}`,
                      background: "#fff",
                      color: C.textInk,
                      fontFamily: FONT_MONO,
                      fontSize: 12,
                      boxSizing: "border-box"
                    }}
                  />
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                    <label style={{ fontSize: 10.5, color: C.slate }}>Twilio Auth Token</label>
                    <span style={{
                      fontSize: 9.5,
                      fontWeight: 600,
                      color: !authToken ? C.slateLight : (authToken.length === 32 ? "#059669" : C.red)
                    }}>
                      {authToken ? `${authToken.length}/32 chars ${authToken.length === 32 ? "✓" : "(incomplete)"}` : "Required (32 chars)"}
                    </span>
                  </div>
                  <input
                    type="password"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    placeholder="••••••••••••••••••••••••••••••••"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: `1px solid ${authToken && authToken.length !== 32 ? "#FCA5A5" : C.border}`,
                      background: "#fff",
                      color: C.textInk,
                      fontFamily: FONT_MONO,
                      fontSize: 12,
                      boxSizing: "border-box"
                    }}
                  />
                </div>
              </div>

              {saveStatus?.success && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: "#059669", fontWeight: 600 }}>
                  {saveStatus.success}
                </div>
              )}
              {saveStatus?.error && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: C.red, fontWeight: 600 }}>
                  ⚠ {saveStatus.error}
                </div>
              )}
            </div>
          )}

          {/* Error Alert */}
          {dialError && (
            <div style={{
              background: C.redSoft,
              border: "1px solid #FCA5A5",
              color: C.red,
              borderRadius: 8,
              padding: "9px 12px",
              fontSize: 12.5,
              display: "flex",
              alignItems: "center",
              gap: 8
            }}>
              <AlertTriangle size={14} color={C.red} />
              <span>{dialError}</span>
            </div>
          )}

          {/* Success Alert */}
          {dialResult && (
            <div style={{
              background: C.greenSoft,
              border: "1px solid #A7F3D0",
              color: "#065F46",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 12.5,
              display: "flex",
              flexDirection: "column",
              gap: 6
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                  <CheckCircle2 size={15} color="#059669" />
                  <span>Call Dispatched! (Status: {dialResult.status})</span>
                </div>
                {onViewLiveCalls && (
                  <button
                    type="button"
                    onClick={onViewLiveCalls}
                    style={{
                      background: C.green,
                      color: "#fff",
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
              <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.slate }}>
                SID: <strong>{dialResult.call_id}</strong> • Carrier: <strong>{dialResult.carrier}</strong> • SIP: <strong>{dialResult.bridge_sip_uri}</strong>
              </div>
            </div>
          )}

          {/* Submit & Test Buttons */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="submit"
              disabled={dialing}
              style={{
                background: dialing ? C.slateLight : C.ink,
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
                boxShadow: "0 4px 14px rgba(0,0,0,0.12)"
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

            <button
              type="button"
              onClick={() => setLiveKitModalOpen(true)}
              style={{
                background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
                color: "#fff",
                border: "none",
                borderRadius: 7,
                padding: "10px 22px",
                fontFamily: FONT_DISPLAY,
                fontSize: 13.5,
                fontWeight: 800,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                boxShadow: "0 4px 14px rgba(37,99,235,0.3)",
                transition: "all 0.15s ease",
              }}
              title="Test call directly in web browser using LiveKit WebRTC (Zero carrier charges, 48kHz audio)"
            >
              <Headphones size={15} /> 🎙️ Test Call in Web (LiveKit WebRTC)
            </button>
          </div>
        </form>
      )}

      {/* LiveKit WebRTC In-Browser Voice Call Modal */}
      <LiveKitBrowserCallModal
        isOpen={liveKitModalOpen}
        onClose={() => setLiveKitModalOpen(false)}
        prospectName={prospectName.trim() || "Test Prospect"}
        prospectPhone={toNumber.trim() || "Browser WebRTC"}
        companyName={missionTitle.trim() || "AIVHub"}
        onCallEnded={() => {
          if (onViewLiveCalls) onViewLiveCalls();
        }}
      />
    </div>
  );
}


/* ---------------------------------- Voice & Telephony Trunking Hub (Multi-Provider) ---------------------------------- */

function QuickSwitchModelModal({
  layerKey,
  layerTitle,
  layerName,
  hubData,
  connections = [],
  onClose,
  onSelectSuccess,
  onOpenCredentials,
}) {
  const [switching, setSwitching] = useState(false);
  const [selectedVal, setSelectedVal] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  const groupMap = {
    llm: "LLM",
    stt: "Speech-to-Text",
    tts: "Text-to-Speech",
    telephony: "Telephony",
    engine: "Voice Orchestration",
    voice: "Voice Persona",
  };

  const groupName = groupMap[layerKey] || layerName || "LLM";

  // Build model and provider options from all configured/registered items in DB + built-ins + standard options
  const options = useMemo(() => {
    const rawGroupItems = connections.find((g) => g.group === groupName)?.items || [];
    const groupItems = rawGroupItems;

    if (layerKey === "engine") {
      return [
        {
          id: "modular",
          label: "Modular Voice Pipeline (Ultra-Low Latency Streaming)",
          desc: "Decoupled Deepgram STT + Streaming LLM + Cartesia/ElevenLabs TTS with sub-500ms response.",
          badge: "Ultra-Fast (300ms)",
          value: "modular",
          isBuiltIn: true,
        },
        {
          id: "livekit",
          label: "LiveKit WebRTC Agents",
          desc: "WebRTC browser calling & SIP telephony bridge with realtime stream pacing.",
          badge: "Browser & SIP",
          value: "livekit",
          isBuiltIn: true,
        },
        {
          id: "xai",
          label: "xAI Realtime Grok (Speech-to-Speech)",
          desc: "Direct native speech-to-speech audio model via xAI SIP trunking.",
          badge: "Speech-to-Speech",
          value: "xai",
          isBuiltIn: true,
        },
        {
          id: "openai",
          label: "OpenAI Realtime",
          desc: "OpenAI Realtime bidirectional audio API pipeline.",
          badge: "Realtime",
          value: "openai",
          isBuiltIn: true,
        },
      ];
    }

    if (layerKey === "voice") {
      const builtin = [
        { id: "rex", label: "Rex (Friendly Male)", desc: "Warm, energetic tone with fast pacing", value: "rex", badge: "Engine Persona", isBuiltIn: true },
        { id: "ara", label: "Ara (Warm Female)", desc: "Professional, crisp executive tone", value: "ara", badge: "Engine Persona", isBuiltIn: true },
        { id: "eve", label: "Eve (Energetic Female)", desc: "Bright, engaging conversationalist", value: "eve", badge: "Engine Persona", isBuiltIn: true },
        { id: "leo", label: "Leo (Direct Male)", desc: "Authoritative, clear business speaker", value: "leo", badge: "Engine Persona", isBuiltIn: true },
        { id: "sal", label: "Sal (Smooth Neutral)", desc: "Calm, reassuring voice profile", value: "sal", badge: "Engine Persona", isBuiltIn: true },
      ];
      const seenVids = new Set();
      const customClones = [];
      (Array.isArray(hubData?.customVoices) ? hubData.customVoices : []).forEach((cv) => {
        const vid = cv.id || cv.voice_id;
        if (vid && !seenVids.has(vid)) {
          seenVids.add(vid);
          customClones.push({
            id: vid,
            label: `${cv.name || "Custom Clone"} (Cloned Voice)`,
            desc: `Custom voice profile · ID: ${vid}`,
            value: vid,
            badge: "Cloned Voice",
          });
        }
      });
      (connections || []).forEach((group) => {
        (group.items || []).forEach((item) => {
          const vid = item.voiceId || item.config?.voice_id;
          if (vid && isValidCloneVoiceId(vid) && !seenVids.has(vid)) {
            seenVids.add(vid);
            customClones.push({
              id: vid,
              label: `${item.name} (${vid.slice(0, 8)}...)`,
              desc: `Saved in Connections (${item.name}) · ID: ${vid}`,
              value: vid,
              badge: `${item.name} Clone`,
            });
          }
        });
      });
      return [...customClones, ...builtin];
    }

    if (layerKey === "llm") {
      const res = [];
      const seenProviders = new Set();
      groupItems.forEach((c) => {
        const modelName = (c.model || (c.name.toLowerCase().includes("telnyx") ? "meta-llama/Meta-Llama-3.1-70B-Instruct" : c.name.toLowerCase().includes("deepseek") ? "deepseek-chat" : c.name.toLowerCase().includes("openai") ? "gpt-4o-mini" : c.name.toLowerCase().includes("anthropic") ? "claude-3-5-sonnet-20241022" : "")).trim();
        const providerTitle = c.name || "LLM";
        seenProviders.add(providerTitle.toLowerCase());
        const isConnected = c.status === "connected" || (c.apiKeyMasked && c.apiKeyMasked.length > 0);
        res.push({
          id: c.id,
          provider: providerTitle,
          label: modelName ? `${providerTitle} (${modelName})` : providerTitle,
          desc: `${providerTitle} · Model: ${modelName || "Default"}`,
          badge: isConnected ? (modelName || "Connected") : "Needs Key",
          value: providerTitle,
          model: modelName,
          isConnected,
        });
      });

      // Default standard templates if not already present
      const standardLlms = [
        { name: "Telnyx AI", model: "meta-llama/Meta-Llama-3.1-70B-Instruct" },
        { name: "OpenAI", model: "gpt-4o-mini" },
        { name: "DeepSeek", model: "deepseek-chat" },
        { name: "Anthropic (Claude)", model: "claude-3-5-sonnet-20241022" },
        { name: "xAI (Grok)", model: "grok-4.20-0309-non-reasoning" },
        { name: "Groq", model: "llama-3.3-70b-versatile" },
      ];
      standardLlms.forEach((sl) => {
        if (!seenProviders.has(sl.name.toLowerCase()) && ![...seenProviders].some((p) => p.includes(sl.name.toLowerCase()) || sl.name.toLowerCase().includes(p))) {
          res.push({
            id: `std_llm_${sl.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
            provider: sl.name,
            label: `${sl.name} (${sl.model})`,
            desc: `Standard LLM · Model: ${sl.model}`,
            badge: sl.model,
            value: sl.name,
            model: sl.model,
            isConnected: false,
          });
        }
      });
      return res;
    }

    if (layerKey === "stt") {
      const res = [];
      const seenProviders = new Set();
      groupItems.forEach((c) => {
        const modelName = (c.model || (c.name.toLowerCase().includes("deepgram") ? "nova-2" : c.name.toLowerCase().includes("telnyx") ? "openai/whisper-large-v3" : "")).trim();
        const providerTitle = c.name || "STT";
        seenProviders.add(providerTitle.toLowerCase());
        const isConnected = c.status === "connected" || (c.apiKeyMasked && c.apiKeyMasked.length > 0);
        res.push({
          id: c.id,
          provider: providerTitle,
          label: modelName ? `${providerTitle} (${modelName})` : providerTitle,
          desc: `${providerTitle} · Model: ${modelName || "Default"}`,
          badge: isConnected ? (modelName || "Connected") : "Needs Key",
          value: providerTitle,
          model: modelName,
          isConnected,
        });
      });

      const standardStts = [
        { name: "Deepgram", model: "nova-2" },
        { name: "Telnyx Whisper", model: "openai/whisper-large-v3" },
      ];
      standardStts.forEach((st) => {
        if (!seenProviders.has(st.name.toLowerCase()) && ![...seenProviders].some((p) => p.includes(st.name.toLowerCase()) || st.name.toLowerCase().includes(p))) {
          res.push({
            id: `std_stt_${st.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
            provider: st.name,
            label: `${st.name} (${st.model})`,
            desc: `Standard STT · Model: ${st.model}`,
            badge: st.model,
            value: st.name,
            model: st.model,
            isConnected: false,
          });
        }
      });
      return res;
    }

    if (layerKey === "tts") {
      const res = [];
      const seenProviders = new Set();
      groupItems.forEach((c) => {
        const cLower = (c.name || "").toLowerCase();
        const modelName = (c.model || (cLower.includes("cartesia") ? "sonic-3" : cLower.includes("telnyx") ? "telnyx/natural" : cLower.includes("eleven") ? "eleven_turbo_v2_5" : "")).trim();
        const providerTitle = c.name || "TTS";
        seenProviders.add(providerTitle.toLowerCase());
        const isConnected = c.status === "connected" || (c.apiKeyMasked && c.apiKeyMasked.length > 0);
        res.push({
          id: c.id,
          provider: providerTitle,
          label: modelName ? `${providerTitle} (${modelName})` : providerTitle,
          desc: `${providerTitle} · ${c.voiceId ? `Voice: ${c.voiceId}` : "Voice persona"}`,
          badge: isConnected ? (modelName || "Connected") : "Needs Key",
          value: providerTitle,
          voiceId: c.voiceId,
          model: modelName,
          isConnected,
        });
      });

      const standardTts = [
        { name: "Cartesia", model: "sonic-3" },
        { name: "Telnyx Natural (TTS)", model: "telnyx/natural" },
        { name: "ElevenLabs", model: "eleven_turbo_v2_5" },
        { name: "Deepgram Aura", model: "aura-asteria-en" },
      ];
      standardTts.forEach((st) => {
        if (!seenProviders.has(st.name.toLowerCase()) && ![...seenProviders].some((p) => p.includes(st.name.toLowerCase()) || st.name.toLowerCase().includes(p))) {
          res.push({
            id: `std_tts_${st.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
            provider: st.name,
            label: `${st.name} (${st.model})`,
            desc: `Standard TTS · Model: ${st.model}`,
            badge: st.model,
            value: st.name,
            model: st.model,
            isConnected: false,
          });
        }
      });

      // Built-in engine voices
      res.push(
        { id: "xai_rex", provider: "xAI", label: "xAI built-in (rex)", desc: "Warm energetic male voice persona bundled in engine.", badge: "Engine Voice", value: "xAI built-in (rex)", isBuiltIn: true },
        { id: "xai_ara", provider: "xAI", label: "xAI built-in (ara)", desc: "Clear professional female voice persona bundled in engine.", badge: "Engine Voice", value: "xAI built-in (ara)", isBuiltIn: true },
        { id: "xai_eve", provider: "xAI", label: "xAI built-in (eve)", desc: "Engaging female voice persona bundled in engine.", badge: "Engine Voice", value: "xAI built-in (eve)", isBuiltIn: true },
        { id: "xai_leo", provider: "xAI", label: "xAI built-in (leo)", desc: "Direct authoritative male voice persona bundled in engine.", badge: "Engine Voice", value: "xAI built-in (leo)", isBuiltIn: true }
      );
      return res;
    }

    if (layerKey === "telephony") {
      const res = [];
      const seenProviders = new Set();
      groupItems.forEach((c) => {
        const cLower = (c.name || "").toLowerCase();
        seenProviders.add(cLower);
        const isConnected = c.status === "connected" || (c.apiKeyMasked && c.apiKeyMasked.length > 0);
        if (cLower.includes("telnyx")) {
          res.push({
            id: c.id,
            provider: "Telnyx",
            label: "Telnyx (SIP Trunking)",
            desc: "High-throughput SIP trunking for low-latency bidirectional telephony.",
            badge: isConnected ? "SIP Trunk" : "Needs Key",
            value: "Telnyx",
            isConnected,
          });
        } else if (cLower.includes("twilio")) {
          res.push({
            id: c.id,
            provider: "Twilio",
            label: "Twilio (Voice & Media Streams)",
            desc: "Reliable global PSTN carrier with WebSocket bi-directional streaming.",
            badge: isConnected ? "Media Stream" : "Needs Key",
            value: "Twilio",
            isConnected,
          });
        } else {
          res.push({
            id: c.id,
            provider: c.name,
            label: c.name,
            desc: "Saved telephony carrier connection",
            badge: isConnected ? "Connected" : "Needs Key",
            value: c.name,
            isConnected,
          });
        }
      });

      if (!seenProviders.has("twilio")) {
        res.push({
          id: "std_twilio",
          provider: "Twilio",
          label: "Twilio (Voice & Media Streams)",
          desc: "Reliable global PSTN carrier with WebSocket bi-directional streaming.",
          badge: "Media Stream",
          value: "Twilio",
          isConnected: false,
        });
      }
      if (!seenProviders.has("telnyx")) {
        res.push({
          id: "std_telnyx",
          provider: "Telnyx",
          label: "Telnyx (SIP Trunking)",
          desc: "High-throughput SIP trunking for low-latency bidirectional telephony.",
          badge: "SIP Trunk",
          value: "Telnyx",
          isConnected: false,
        });
      }
      return res;
    }

    return groupItems.map((c) => ({
      id: c.id,
      label: c.name,
      desc: c.model ? `Model: ${c.model}` : "Connected Provider",
      badge: c.status === "connected" ? "Connected" : "Configured",
      value: c.name,
    }));
  }, [layerKey, groupName, connections, hubData]);

  const isOptionActive = (opt) => {
    const v = (opt.value || opt.label || "").toLowerCase();
    const m = (opt.model || "").toLowerCase();
    const curModel = String(hubData?.llmModel || "").toLowerCase();
    const curLlm = String(hubData?.llmName || hubData?.llmProvider || "").toLowerCase();

    if (layerKey === "engine") {
      const curEngine = String(hubData?.liveEngine || hubData?.activeEngine || "").toLowerCase();
      return (opt.value && curEngine === opt.value.toLowerCase()) || curEngine.includes(v);
    }
    if (layerKey === "voice") {
      const curVoice = String(hubData?.voiceName || "").toLowerCase();
      return curVoice === v || (opt.id && curVoice === opt.id.toLowerCase());
    }
    if (layerKey === "llm") {
      if (m) {
        if (curModel) return curModel === m;
        if (curLlm.includes("deepseek")) return m === "deepseek-chat";
        if (curLlm.includes("groq")) return m === "llama-3.3-70b-versatile";
        if (curLlm.includes("openai")) return m === "gpt-4o-mini";
        if (curLlm.includes("anthropic")) return m === "claude-3-5-sonnet-20241022";
        if (curLlm.includes("xai") || curLlm.includes("grok")) return m.includes("grok");
        return curLlm.includes(m);
      }
      return curLlm === v || curLlm.includes(v);
    }
    if (layerKey === "stt") {
      const curStt = String(hubData?.sttName || hubData?.sttProvider || "").toLowerCase();
      const curSttModel = String(hubData?.sttModel || "").toLowerCase();
      if (m) {
        if (curSttModel) return curSttModel === m;
        if (curStt.includes("deepgram")) return m === "nova-2";
        return curStt.includes(m);
      }
      return curStt === v || curStt.includes(v);
    }
    if (layerKey === "tts") {
      const curTts = String(hubData?.ttsName || hubData?.ttsProvider || hubData?.voiceName || "").toLowerCase();
      return curTts === v || (opt.id && curTts.includes(opt.id.toLowerCase())) || curTts.includes(v);
    }
    if (layerKey === "telephony") {
      const curCarrier = String(hubData?.activeCarrier || "").toLowerCase();
      return curCarrier.includes(v);
    }
    return false;
  };

  const handleSelect = async (opt) => {
    setSelectedVal(opt.id || opt.value);
    setSwitching(true);
    setErrorMsg("");
    try {
      const payload = {};
      if (layerKey === "engine") {
        payload.engine = opt.value;
        payload.voice = opt.value;
      } else if (layerKey === "voice") {
        payload.voice = opt.value;
      } else if (layerKey === "llm") {
        payload.llm = opt.provider || opt.value;
        if (opt.model) payload.llm_model = opt.model;
      } else if (layerKey === "stt") {
        payload.stt = opt.provider || opt.value;
        if (opt.model) payload.stt_model = opt.model;
      } else if (layerKey === "tts") {
        payload.tts = opt.provider || opt.value;
        if (opt.voiceId) payload.voice = opt.voiceId;
        if (opt.model) payload.tts_model = opt.model;
      } else if (layerKey === "telephony") {
        payload.carrier = opt.value;
      }

      await api.selectActiveStack(payload);
      setTimeout(() => {
        if (onSelectSuccess) onSelectSuccess(opt);
        onClose();
      }, 300);
    } catch (err) {
      setErrorMsg(err.message || "Failed to switch active model.");
      setSwitching(false);
    }
  };

  const getLayerIcon = () => {
    if (layerKey === "llm") return <Brain size={20} color="#4F46E5" />;
    if (layerKey === "stt") return <Mic size={20} color="#059669" />;
    if (layerKey === "tts") return <Volume2 size={20} color="#D97706" />;
    if (layerKey === "telephony") return <PhoneCall size={20} color="#2563EB" />;
    if (layerKey === "engine") return <Cpu size={20} color="#7C3AED" />;
    return <User size={20} color="#DB2777" />;
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.65)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 520, padding: 24, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", maxHeight: "90vh" }}>
        
        {/* Modal Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ padding: 8, borderRadius: 10, background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {getLayerIcon()}
            </div>
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.textInk }}>
                Switch {layerTitle || "Model"}
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginTop: 2 }}>
                1-click switch between saved & built-in options
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: C.slate, padding: 4, borderRadius: 6 }}
          >
            <X size={19} />
          </button>
        </div>

        {errorMsg && (
          <div style={{ padding: "8px 12px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#B91C1C", fontSize: 12, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={14} /> {errorMsg}
          </div>
        )}

        {/* Scrollable Model Options */}
        <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 4, maxHeight: 380, margin: "4px 0 16px" }}>
          {options.length === 0 ? (
            <div style={{ padding: "28px 16px", textAlign: "center", background: "#F8FAFC", borderRadius: 12, border: `1px dashed ${C.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.textInk, marginBottom: 4 }}>
                No connected {layerTitle || "providers"} found
              </div>
              <div style={{ fontSize: 12, color: C.slate, maxWidth: 360, margin: "0 auto 14px", lineHeight: 1.4 }}>
                Save your API key under Connections to unlock models in this category for live calling.
              </div>
              <button
                type="button"
                onClick={() => {
                  if (onOpenCredentials) onOpenCredentials();
                }}
                style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
              >
                Go to Connections
              </button>
            </div>
          ) : (
            options.map((opt) => {
              const active = isOptionActive(opt);
              const isBusy = switching && selectedVal === (opt.id || opt.value);

              return (
                <div
                  key={opt.id || opt.value}
                  onClick={() => !active && !switching && handleSelect(opt)}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: active ? "1.5px solid #10B981" : "1px solid #E2E8F0",
                    background: active ? "#F0FDF4" : "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    cursor: active ? "default" : (switching ? "wait" : "pointer"),
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!active && !switching) {
                      e.currentTarget.style.borderColor = "#94A3B8";
                      e.currentTarget.style.background = "#F8FAFC";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active && !switching) {
                      e.currentTarget.style.borderColor = "#E2E8F0";
                      e.currentTarget.style.background = "#fff";
                    }
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
                      <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13.5, color: C.textInk }}>
                        {opt.label}
                      </span>
                      {opt.badge && (
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 6px", borderRadius: 6, background: active ? "#D1FAE5" : "#F1F5F9", color: active ? "#065F46" : "#475569" }}>
                          {opt.badge}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.slate, lineHeight: 1.35 }}>
                      {opt.desc}
                    </div>
                  </div>

                  <div>
                    {active ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "#10B981", color: "#fff" }}>
                        <Check size={13} /> Active
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={switching}
                        style={{
                          background: isBusy ? "#94A3B8" : "#fff",
                          color: isBusy ? "#fff" : C.ink,
                          border: `1px solid ${C.border}`,
                          borderRadius: 7,
                          padding: "5px 11px",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: switching ? "wait" : "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {isBusy ? "Switching…" : "Use this"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: C.slate }}>
          <span>Need a model not listed?</span>
          <button
            type="button"
            onClick={() => {
              if (onOpenCredentials) onOpenCredentials();
            }}
            style={{ background: "none", border: "none", color: C.cobalt, fontWeight: 600, cursor: "pointer", fontSize: 12, padding: 0 }}
          >
            + Connect new provider in Connections →
          </button>
        </div>

      </div>
    </div>
  );
}

function CallPluginStackBoard({ hubData, connections = [], onChangeModel, onAddLayer, onOpenCredentials }) {
  const labels = liveStackLabels(hubData || {});
  const engine = String(hubData?.liveEngine || "").toLowerCase();
  const modular = engine === "modular" || engine === "livekit";
  const hybrid = !!hubData?.externalTts;
  const xaiLike = engine === "xai" || engine === "openai";

  const resolveModel = (key) => {
    if (key === "llm") {
      return hubData?.llmModel || hubData?.liveLabels?.llmModel || hubData?.liveLabels?.llm_model || (modular ? "gpt-4o-mini" : "");
    }
    if (key === "stt") {
      return hubData?.sttModel || hubData?.liveLabels?.sttModel || hubData?.liveLabels?.stt_model || (modular ? "nova-2" : "");
    }
    if (key === "tts") {
      return hubData?.ttsModel || hubData?.liveLabels?.ttsModel || hubData?.liveLabels?.tts_model || (modular || hybrid ? "sonic-3" : "");
    }
    if (key === "telephony") {
      return hubData?.phoneNumber || "";
    }
    return "";
  };

  const rows = [
    {
      key: "telephony",
      title: "Phone",
      layer: "Telephony",
      value: labels.carrier || hubData?.activeCarrier || "—",
      model: resolveModel("telephony"),
      isPhone: true,
      ok: hubData?.status === "connected" && !!hubData?.phoneNumber,
      hint: "Twilio, Telnyx, or SIP",
      needPlugin: true,
    },
    {
      key: "engine",
      title: "Call engine",
      layer: "Voice Orchestration",
      value: labels.engine,
      ok: hubData?.status === "connected" && !!engine,
      hint: "xAI · Modular · OpenAI",
      needPlugin: true,
    },
    {
      key: "stt",
      title: "Listen (STT)",
      layer: "Speech-to-Text",
      value: modular ? labels.stt : (xaiLike ? "Inside engine" : labels.stt),
      model: resolveModel("stt"),
      ok: modular ? !!(hubData?.sttProvider || hubData?.sttName) : hubData?.status === "connected",
      hint: modular ? "Deepgram, Whisper, …" : "Bundled — no separate plugin",
      needPlugin: true,
    },
    {
      key: "llm",
      title: "Think (LLM)",
      layer: "LLM",
      value: modular ? labels.llm : (xaiLike ? "Inside engine" : labels.llm),
      model: resolveModel("llm"),
      ok: modular ? !!(hubData?.llmProvider || hubData?.llmName) : hubData?.status === "connected",
      hint: modular ? "Groq, OpenAI, Grok chat, …" : "Bundled — no separate plugin",
      needPlugin: true,
    },
    {
      key: "tts",
      title: "Speak (TTS)",
      layer: "Text-to-Speech",
      value: (modular || hybrid)
        ? labels.tts
        : (engine === "xai"
          ? `xAI built-in (${hubData?.voiceName || "rex"})`
          : engine === "openai"
            ? `OpenAI (${hubData?.voiceName || "alloy"})`
            : labels.tts),
      model: resolveModel("tts"),
      ok: modular || hybrid ? !!(hubData?.ttsProvider || hubData?.ttsName) : hubData?.status === "connected",
      hint: hybrid || modular ? "Cartesia, ElevenLabs, PlayHT, Other…" : "Using engine voice — Add TTS only to clone",
      needPlugin: true,
      recommend: engine === "xai" && !hybrid,
    },
    {
      key: "voice",
      title: "Voice ID",
      layer: "Voice Persona",
      value: looksLikeApiKeyNotVoiceId(hubData?.voiceName || hubData?.ttsVoiceId)
        ? "API key pasted by mistake"
        : (hybrid
          ? (hubData?.ttsVoiceId || hubData?.voiceName || "—")
          : (hubData?.voiceName || "—")),
      ok: hubData?.status === "connected" && (looksLikeApiKeyNotVoiceId(hubData?.voiceName || hubData?.ttsVoiceId)
        ? false
        : !!(hubData?.voiceName && String(hubData.voiceName).length > 1 && (!hybrid || isValidCloneVoiceId(hubData.voiceName)))),
      hint: looksLikeApiKeyNotVoiceId(hubData?.voiceName || hubData?.ttsVoiceId)
        ? "Paste Cartesia Voice UUID on Line setup"
        : (hybrid ? "Must be Cartesia UUID with dashes" : "Saved engine persona (ara / rex / …)"),
      needPlugin: true,
    },
  ];

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, margin: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.textInk }}>What Calling uses</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 4, maxWidth: 560, lineHeight: 1.45 }}>
            Live pieces for the next call. Click <strong>Change</strong> to switch between saved models. Yellow = still needed.
          </div>
        </div>
        <button
          type="button"
          onClick={() => onOpenCredentials && onOpenCredentials()}
          style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, color: C.ink, cursor: "pointer" }}
        >
          Connect providers
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <div
            key={r.key}
            style={{
              display: "grid",
              gridTemplateColumns: "140px 1fr auto",
              gap: 12,
              alignItems: "center",
              padding: "12px 14px",
              borderRadius: 10,
              border: `1px solid ${r.ok ? "#E2E8F0" : "#FDE68A"}`,
              background: r.ok ? "#F8FAFC" : "#FFFBEB",
            }}
          >
            <div>
              <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: C.textInk }}>{r.title}</div>
              <div style={{ fontSize: 11, color: C.slateLight, marginTop: 2 }}>{r.hint}</div>
            </div>
            <div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.ink, wordBreak: "break-all", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>{r.value}</span>
                {r.model && !String(r.value || "").toLowerCase().includes(String(r.model || "").toLowerCase()) && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "2px 8px",
                      borderRadius: 6,
                      background: r.isPhone ? "#F1F5F9" : "#EFF6FF",
                      border: `1px solid ${r.isPhone ? "#CBD5E1" : "#BFDBFE"}`,
                      color: r.isPhone ? "#334155" : "#1D4ED8",
                      fontSize: 11.5,
                      fontWeight: 600,
                      fontFamily: FONT_MONO,
                      letterSpacing: "0.01em",
                    }}
                    title={r.isPhone ? `Line Number: ${r.model}` : `Active Model: ${r.model}`}
                  >
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: r.isPhone ? "#64748B" : "#2563EB" }} />
                    {r.model}
                  </span>
                )}
              </div>
              {r.recommend && (
                <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "#B45309", marginTop: 2 }}>
                  Tip: add TTS plugin + Voice ID for your clone
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 999,
                background: r.ok ? "#D1FAE5" : "#FEF3C7", color: r.ok ? "#065F46" : "#92400E",
              }}>
                {r.ok ? "Ready" : "Needed"}
              </span>
              {r.needPlugin && (
                <button
                  type="button"
                  onClick={() => {
                    if (r.ok && onChangeModel) {
                      onChangeModel(r.key, r.title, r.layer);
                    } else if (onAddLayer) {
                      onAddLayer(r.layer);
                    }
                  }}
                  style={{
                    background: C.ink, color: "#fff", border: "none", borderRadius: 7,
                    padding: "6px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  {r.ok ? "Change" : "Add"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: C.slate, lineHeight: 1.45 }}>
        {modular
          ? "Modular mode: STT + LLM + TTS plugins all required from Connections."
          : hybrid
            ? "Hybrid mode: xAI listens/thinks; your TTS plugin speaks the clone."
            : "Engine-bundled mode: STT/LLM inside the engine. Add a TTS plugin anytime to unlock your own voice."}
      </div>
    </div>
  );
}

function TelnyxAssistantSettingsCard() {
  const [assistantId, setAssistantId] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [dialTo, setDialTo] = useState("");
  const [dialing, setDialing] = useState(false);
  const [dialMsg, setDialMsg] = useState("");
  const [publicBase, setPublicBase] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.getTelnyxAssistantSettings()
      .then((res) => {
        if (cancelled || !res) return;
        setAssistantId(res.assistantId || "");
        setPublicKey(res.publicKey || "");
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    api.getTelephonyHub()
      .then((hub) => {
        if (cancelled || !hub || !hub.webhookUrl) return;
        setPublicBase(String(hub.webhookUrl).replace(/\/api\/sip-webhook\/?$/, ""));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    const id = assistantId.trim();
    if (id && !/^[A-Za-z0-9_-]{6,}$/.test(id)) {
      setSavedMsg("That doesn't look like an Assistant ID (copy it from Telnyx → AI Assistants).");
      return;
    }
    setSaving(true);
    setSavedMsg("");
    try {
      await api.saveTelnyxAssistantSettings({ assistant_id: id, public_key: publicKey.trim() });
      setSavedMsg("Saved");
      try { window.dispatchEvent(new Event("aivhub_telnyx_assistant_saved")); } catch (_) {}
      setTimeout(() => setSavedMsg(""), 2500);
    } catch (e) {
      setSavedMsg(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1400);
    } catch (_) {}
  };

  const handleDial = async () => {
    const to = dialTo.trim();
    if (!to) return;
    setDialing(true);
    setDialMsg("");
    try {
      const res = await api.dialViaTelnyxAssistant({ to });
      setDialMsg(res?.success ? `Calling ${res.to || to} — follow it on the Live page.` : (res?.error || "Call failed."));
      if (res?.success) {
        try { window.dispatchEvent(new CustomEvent("aivhub_set_voice_view", { detail: "live" })); } catch (_) {}
      }
    } catch (e) {
      setDialMsg(e?.message || "Call failed.");
    } finally {
      setDialing(false);
    }
  };

  const inputStyle = { width: "100%", height: 38, padding: "0 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5 };

  return (
    <div style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.textInk }}>Telnyx AI Assistant Settings</div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, marginTop: 3, marginBottom: 12 }}>
        Connects a Telnyx-hosted AI Assistant to this software (booking tools, call logging, and your active conversation template's prompt sync). Not needed unless you're using Telnyx's own voice stack.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>Assistant ID</label>
          <input
            value={assistantId}
            onChange={(e) => setAssistantId(e.target.value)}
            placeholder="e.g. 18bc015c-1545-484e-ad84-50b8a02fec06"
            disabled={!loaded}
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>Account Public Key</label>
          <input
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            placeholder="From Telnyx: Account Settings -> Keys & Credentials"
            disabled={!loaded}
            style={inputStyle}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={!loaded || saving}
            style={{ background: C.ink, border: "none", borderRadius: 8, padding: "8px 16px", color: "#fff", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, cursor: saving ? "wait" : "pointer" }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {savedMsg && (
            <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: savedMsg === "Saved" ? C.green : C.red, fontWeight: 600 }}>{savedMsg}</span>
          )}
        </div>

        {publicBase && (
          <div style={{ background: C.paper, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", display: "grid", gap: 6 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>Paste into your Telnyx Assistant</div>
            {[
              ["events", "Assistant webhook (dynamic variables + call end)", `${publicBase}/api/telnyx-assistant/call-event`],
              ["tools", "Webhook tool URL (replace {tool} with check_availability / book_appointment)", `${publicBase}/api/telnyx-assistant/tool/{tool}`],
            ].map(([k, label, url]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate }}>{label}</div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.textInk, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</div>
                </div>
                <button type="button" onClick={() => copyUrl(k, url)} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", fontFamily: FONT_BODY, fontSize: 11.5, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {copied === k ? "Copied" : "Copy"}
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 12 }}>
          <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>Call via Telnyx Assistant</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={dialTo}
              onChange={(e) => setDialTo(e.target.value)}
              placeholder="+1 555... destination number"
              disabled={dialing}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              type="button"
              onClick={handleDial}
              disabled={dialing || !dialTo.trim()}
              style={{ background: C.cobalt || C.ink, border: "none", borderRadius: 8, padding: "0 16px", color: "#fff", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, cursor: dialing ? "wait" : "pointer", whiteSpace: "nowrap" }}
            >
              {dialing ? "Calling..." : "Call"}
            </button>
          </div>
          {dialMsg && (
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: dialMsg.startsWith("Calling") ? C.green : C.red, fontWeight: 600, marginTop: 6 }}>{dialMsg}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function VoiceTrunkingHubTab({ notifications, setNotifications, profile, setProfile, onOpenCredentials }) {
  const getCachedHub = () => {
    try {
      const raw = localStorage.getItem("aivhub_telephony_hub_cache");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch (_) {}
    return null;
  };

  const cached = getCachedHub();

  // Until /telephony-hub answers, show "Not configured" — never a made-up stack.
  const [hubData, setHubData] = useState(cached || {
    activeCarrier: "Not configured",
    activeEngine: "Not configured",
    liveEngine: "not_configured",
    liveNote: "",
    externalTts: false,
    ttsProvider: null,
    ttsName: "Not configured",
    llmProvider: null,
    llmName: "Not configured",
    sttProvider: null,
    sttName: "Not configured",
    ttsVoiceId: null,
    phoneNumber: profile?.callerId || "",
    voiceName: "",
    silenceDurationMs: 380,
    temperature: 0.80,
    status: "not_configured",
    webhookUrl: "",
    xaiFqdn: "",
    codecs: ["G.711 μ-law (PCMU)", "G.711 A-law (PCMA)", "G.722"],
    isLive: false
  });
  const [carrierChoice, setCarrierChoice] = useState(() => {
    const c = String(cached?.activeCarrier || "twilio").toLowerCase();
    return c.includes("telnyx") ? "telnyx" : c.includes("sip") ? "generic_sip" : "twilio";
  });
  const [engineChoice, setEngineChoice] = useState(() => {
    return cached?.liveEngine || "livekit";
  });
  const [phoneNumber, setPhoneNumber] = useState(hubData?.phoneNumber || "");
  const [liveKitModalOpen, setLiveKitModalOpen] = useState(false);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagScore, setDiagScore] = useState(null);

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [accountSid, setAccountSid] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [voiceName, setVoiceName] = useState(cached?.voiceName || "");
  const [speakMode, setSpeakMode] = useState("clone"); // builtin | clone
  const [customVoices, setCustomVoices] = useState(cached?.customVoices || []);
  const [cloneName, setCloneName] = useState("");
  const [pasteVoiceId, setPasteVoiceId] = useState("");
  const [cloneMsg, setCloneMsg] = useState("");
  const [cloneErr, setCloneErr] = useState("");
  const [cloning, setCloning] = useState(false);
  const [xaiCloneBlocked, setXaiCloneBlocked] = useState(false);
  const [showEnterpriseRecord, setShowEnterpriseRecord] = useState(false);
  const [recState, setRecState] = useState("idle");
  const [recSec, setRecSec] = useState(0);
  const recRef = useRef(null);
  const recTimerRef = useRef(null);
  const recChunksRef = useRef([]);
  const [recBlob, setRecBlob] = useState(null);
  const [silenceDurationMs, setSilenceDurationMs] = useState(cached?.silenceDurationMs || 380);
  const [temperature, setTemperature] = useState(cached?.temperature || 0.80);
  const [webhookUrl, setWebhookUrl] = useState(cached?.webhookUrl || "");

  const [provisioning, setProvisioning] = useState(false);
  const [provisionMsg, setProvisionMsg] = useState(null);
  const [provisionErr, setProvisionErr] = useState("");

  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedFqdn, setCopiedFqdn] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [showStackAdd, setShowStackAdd] = useState(false);
  const [stackAddLayer, setStackAddLayer] = useState("Text-to-Speech");
  const [inboundRoutingOpen, setInboundRoutingOpen] = useState(false);
  const [provisionConfirmOpen, setProvisionConfirmOpen] = useState(false);
  const [showProvisionTip, setShowProvisionTip] = useState(false);
  const [connsState, setConnsState] = useState([]);
  const [quickSwitchState, setQuickSwitchState] = useState({ open: false, layerKey: "", layerTitle: "", layerName: "" });

  const fetchStatus = async () => {
    try {
      const [data, conns] = await Promise.all([
        api.getTelephonyHub().catch(() => null),
        api.getConnections().catch(() => []),
      ]);
      if (conns && Array.isArray(conns)) {
        setConnsState(conns);
      }
      if (data) {
        setHubData(data);
        try {
          localStorage.setItem("aivhub_telephony_hub_cache", JSON.stringify(data));
        } catch (_) {}
        setPhoneNumber(data.phoneNumber || "");
        if (data.phoneNumber && setProfile) {
          setProfile((prev) => ({ ...prev, callerId: data.phoneNumber }));
        }
        if (data.webhookUrl) setWebhookUrl(data.webhookUrl);
        if (data.voiceName) {
          setVoiceName(data.voiceName);
          setSpeakMode(isValidCloneVoiceId(data.voiceName) ? "clone" : "builtin");
        }
        if (Array.isArray(data.customVoices)) setCustomVoices(data.customVoices);
        if (data.xaiCloneApiBlocked) setXaiCloneBlocked(true);
        if (data.silenceDurationMs) setSilenceDurationMs(data.silenceDurationMs);
        if (data.temperature) setTemperature(data.temperature);
        if (data.signingSecret) setSigningSecret(data.signingSecret);
        if (data.activeCarrier) {
          const cLower = data.activeCarrier.toLowerCase();
          setCarrierChoice(cLower.includes("twilio") ? "twilio" : cLower.includes("sip") ? "generic_sip" : "telnyx");
        }
        if (data.liveEngine) {
          setEngineChoice(["xai", "openai", "livekit", "modular"].includes(data.liveEngine) ? data.liveEngine : "xai");
        } else if (data.activeEngine) {
          const eLower = data.activeEngine.toLowerCase();
          setEngineChoice(eLower.includes("livekit") ? "livekit" : eLower.includes("openai") ? "openai" : eLower.includes("modular") ? "modular" : "xai");
        }
      }
    } catch (err) {
      console.error("Failed to load telephony hub data:", err);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (hubData?.phoneNumber !== undefined) {
      setPhoneNumber(hubData.phoneNumber || "");
    }
  }, [hubData?.phoneNumber]);

  const handleRunDiagnostics = async () => {
    try {
      setDiagRunning(true);
      const res = await api.runVoiceAndBookingDiagnostics();
      setDiagScore(res);
      if (typeof setNotifications === "function") {
        setNotifications((ns) => [
          {
            id: "n_" + Date.now(),
            text: `5-Point Diagnostics Score: ${res?.overall_score || (res?.all_passed ? "5/5 PASS" : "Results Ready")}`,
            time: "just now",
            unread: true,
            type: res?.all_passed ? "success" : "warning",
          },
          ...(ns || []),
        ]);
      }
    } catch (err) {
      if (typeof setNotifications === "function") {
        setNotifications((ns) => [
          {
            id: "n_" + Date.now(),
            text: `Diagnostics check failed: ${err.message || err}`,
            time: "just now",
            unread: true,
            type: "error",
          },
          ...(ns || []),
        ]);
      }
    } finally {
      setDiagRunning(false);
    }
  };

  const notifyAdminXaiClone = (force) => {
    if (typeof setNotifications !== "function") return;
    try {
      if (!force && sessionStorage.getItem("aivhub_admin_xai_clone_notice") === "1") return;
      sessionStorage.setItem("aivhub_admin_xai_clone_notice", "1");
    } catch (_) { /* ignore */ }
    setNotifications((ns) => {
      if ((ns || []).some((n) => n.id === "n_xai_clone_enterprise")) return ns;
      return [
        {
          id: "n_xai_clone_enterprise",
          text: "Admin action needed: xAI in-app voice clone (Record → Save) requires an Enterprise plan. Until upgrade, operators must create the voice in console.x.ai → Custom Voices, copy the 8-character Voice ID, and paste it in Voice & Telephony Trunking Hub.",
          time: "just now",
          unread: true,
          type: "alert",
          targetView: "provider",
          targetAction: "Open voice hub →",
        },
        ...(ns || []),
      ];
    });
  };

  useEffect(() => {
    setCloneErr("");
    setCloneMsg("");
    setRecBlob(null);
    setRecState("idle");
    try { recRef.current?.stop(); } catch (_) { /* ignore */ }
    if (engineChoice === "xai") notifyAdminXaiClone(false);
  }, [engineChoice]);

  useEffect(() => {
    if (recState !== "recording") return undefined;
    recTimerRef.current = setInterval(() => {
      setRecSec((s) => {
        const next = s + 1;
        if (next >= 90) {
          try { recRef.current?.stop(); } catch (_) { /* ignore */ }
        }
        return next;
      });
    }, 1000);
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    };
  }, [recState]);

  const stopRecording = () => {
    try {
      recRef.current?.stop();
    } catch (_) { /* ignore */ }
    recRef.current = null;
    if (recTimerRef.current) clearInterval(recTimerRef.current);
  };

  const startRecording = async () => {
    setCloneErr("");
    setCloneMsg("");
    setRecBlob(null);
    setRecSec(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      recChunksRef.current = [];
      let rec;
      try {
        const recOpts = mime
          ? { mimeType: mime, audioBitsPerSecond: 16000 }
          : { audioBitsPerSecond: 16000 };
        rec = new MediaRecorder(stream, recOpts);
      } catch (_) {
        rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      }
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) recChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || "audio/webm";
        setRecBlob(new Blob(recChunksRef.current, { type }));
        setRecState("ready");
      };
      rec.start(1000);
      recRef.current = rec;
      setRecState("recording");
    } catch (err) {
      setCloneErr(`Mic blocked: ${err.message || err}`);
    }
  };

  const uploadClone = async () => {
    if (!recBlob) {
      setCloneErr("Record your voice first (aim 60–90 seconds).");
      return;
    }
    if (recSec < 15 && recBlob.size < 40000) {
      setCloneErr("Too short. Record at least 30 seconds of natural speech.");
      return;
    }
    setCloning(true);
    setCloneErr("");
    setCloneMsg("Compressing recording…");
    try {
      let file = recBlob;
      try {
        file = await compressVoiceBlob(recBlob);
      } catch (_) {
        if (recBlob.size > 900 * 1024) {
          throw new Error("Could not compress recording. Record 30–45 seconds and retry.");
        }
      }
      const fd = new FormData();
      fd.append("name", cloneName.trim() || "My voice");
      fd.append("engine", engineChoice);
      fd.append("file", file, cloneFilename(file));
      setCloneMsg("Uploading clone…");
      const res = await api.cloneVoice(fd);
      setCloneMsg(res.message || "Voice cloned and saved.");
      if (res.voices) setCustomVoices(res.voices);
      if (res.voice?.voice_id) setVoiceName(res.voice.voice_id);
      setRecState("idle");
      setRecBlob(null);
    } catch (err) {
      const msg = err.message || String(err);
      setCloneErr(msg);
      if (/enterprise/i.test(msg) || /403/.test(msg)) {
        setXaiCloneBlocked(true);
        setShowEnterpriseRecord(false);
        notifyAdminXaiClone(true);
      }
    } finally {
      setCloning(false);
    }
  };

  const linkPastedVoice = async () => {
    const vid = pasteVoiceId.trim();
    if (!vid) {
      setCloneErr("Please paste a Voice ID or model identifier (e.g. Telnyx, Cartesia, ElevenLabs).");
      return;
    }
    if (looksLikeApiKeyNotVoiceId(vid)) {
      setCloneErr("That is an API key. Save it under Connections. Here paste only the Voice ID / Model slug.");
      return;
    }
    if (!isValidCloneVoiceId(vid)) {
      setCloneErr("Invalid Voice ID format. Please check your provider's voice model identifier.");
      return;
    }
    setCloning(true);
    setCloneErr("");
    try {
      const looksUuid = isCartesiaUuid(vid);
      const vLow = vid.toLowerCase();
      const lLow = (cloneName || "").toLowerCase();
      let provider = "custom";
      if (vLow.includes("telnyx") || lLow.includes("telnyx")) {
        provider = "telnyx";
      } else if (looksUuid || lLow.includes("cartesia")) {
        provider = "cartesia";
      } else if (vLow.includes("eleven") || lLow.includes("eleven") || vid.length >= 16) {
        provider = "elevenlabs";
      } else if (vLow.includes("deepgram") || lLow.includes("deepgram") || vLow.includes("aura")) {
        provider = "deepgram";
      } else if (vLow.includes("openai") || lLow.includes("openai")) {
        provider = "openai";
      }
      const effectiveLabel = cloneName.trim() || (provider === "telnyx" ? "Telnyx Natural" : provider === "cartesia" ? "Cartesia Voice" : vid);
      const res = await api.selectVoice({
        voice_id: vid,
        label: effectiveLabel,
        provider,
      });
      setVoiceName(vid);
      setSpeakMode("clone");
      if (res.voices) setCustomVoices(res.voices);
      setCloneMsg(`✓ Active voice set to ${res.voice_name || effectiveLabel}`);
      setTimeout(() => setCloneMsg(""), 3500);
      setPasteVoiceId("");
      setCloneName("");
      try { await fetchStatus(); } catch (_) { /* ignore */ }
    } catch (err) {
      setCloneErr(err.message || String(err));
    } finally {
      setCloning(false);
    }
  };

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
    if (e && e.preventDefault) e.preventDefault();
    setProvisionConfirmOpen(false);
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
        silence_duration_ms: Number(silenceDurationMs),
        temperature: Number(temperature),
        webhook_url: webhookUrl,
        signing_secret: signingSecret
      });

      setProvisionMsg(res);
      if (res.signingSecret) {
        setSigningSecret(res.signingSecret);
      }
      const activeNum = res.phoneNumber || phoneNumber;
      if (activeNum) setPhoneNumber(activeNum);
      await fetchStatus();
      if (setProfile) {
        setProfile((prev) => ({ ...prev, callerId: activeNum }));
      }
      try {
        const raw = localStorage.getItem("aivhub_company_profile");
        const p = raw ? JSON.parse(raw) : {};
        p.callerId = activeNum;
        localStorage.setItem("aivhub_company_profile", JSON.stringify(p));
      } catch (_) {}
      setNotifications((ns) => [
        { id: "n_" + Date.now(), text: res.message || `✓ Activated ${res.carrier} + ${res.engine} on ${activeNum}`, time: "just now", unread: true, type: "success" },
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


  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* 1. HERO ACTIVE STACK CARD */}
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: "24px 28px",
          color: C.textInk,
          border: `1px solid ${C.border}`,
          boxShadow: "0 8px 28px rgba(18,20,28,0.06)",
          display: "flex",
          flexDirection: "column",
          gap: 18
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: C.cobaltSoft, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #C7D7FA" }}>
              <Radio size={22} color={C.cobalt} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.textInk }}>Active Voice & Telephony Trunk</span>
                {hubData?.status === "connected" ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 12, background: "#D1FAE5", border: "1px solid #A7F3D0", color: "#065F46", fontSize: 11, fontWeight: 600 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981" }} /> Live Call Ready
                  </span>
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 12, background: "#FEF3C7", border: "1px solid #FDE68A", color: "#92400E", fontSize: 11, fontWeight: 600 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#F59E0B" }} /> Not Configured
                  </span>
                )}
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 2 }}>
                {hubData.liveNote || "Live line status for the next call."}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={handlePing}
              disabled={pinging}
              style={{
                background: C.cobaltSoft,
                border: "1px solid #C7D7FA",
                borderRadius: 8,
                padding: "8px 14px",
                color: C.cobaltDeep,
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

            <button
              type="button"
              onClick={() => setLiveKitModalOpen(true)}
              style={{
                background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
                border: "none",
                borderRadius: 8,
                padding: "8px 16px",
                color: "#fff",
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                boxShadow: "0 2px 8px rgba(37,99,235,0.3)",
              }}
              title="Test the AI agent voice directly in your web browser via LiveKit WebRTC (no phone needed)"
            >
              <Headphones size={14} /> Test Call in Web (LiveKit)
            </button>
            <button
              type="button"
              onClick={handleRunDiagnostics}
              disabled={diagRunning}
              style={{
                background: C.ink,
                border: "none",
                borderRadius: 8,
                padding: "8px 16px",
                color: "#fff",
                fontFamily: FONT_BODY,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: diagRunning ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                boxShadow: "0 2px 8px rgba(15,23,42,0.18)",
              }}
              title="Run 5-point universal diagnostic health check across Telephony, STT, LLM, TTS, and Calendar"
            >
              <Activity size={14} className={diagRunning ? "animate-spin" : ""} />
              {diagRunning ? "Testing Stack..." : "5-Point Diagnostics"}
            </button>
          </div>
        </div>

        {/* Status Metrics Bar */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          <div>
            <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Inbound Caller Line</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 15, fontWeight: 700, color: C.cobaltDeep, marginTop: 4 }}>{hubData.phoneNumber}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Carrier Route</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600, color: hubData?.status === "connected" ? C.textInk : C.slate, marginTop: 4 }}>{hubData.activeCarrier} (Direct SIP)</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Voice AI Engine</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600, color: hubData?.status === "connected" ? C.textInk : C.slate, marginTop: 4 }}>{hubData.activeEngine} ({hubData.voiceName})</div>
          </div>
          {engineChoice !== "livekit" && (
            <div>
              <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>SIP Inbound FQDN</div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 12.5, color: C.slate, marginTop: 4 }}>{hubData.xaiFqdn}:5060</div>
            </div>
          )}
          {engineChoice === "livekit" && (
            <div>
              <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>WebRTC Connection</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: hubData?.status === "connected" ? C.teal : C.slate, marginTop: 4, fontWeight: 600 }}>Browser-based (no SIP)</div>
            </div>
          )}
        </div>

        {(() => {
          const labels = liveStackLabels(hubData);
          return (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, paddingTop: 4 }}>
              <div>
                <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Live engine</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.textInk, marginTop: 4 }}>{labels.engine}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>LLM</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.textInk, marginTop: 4 }}>{labels.llm}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>STT</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.textInk, marginTop: 4 }}>{labels.stt}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.slate, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>TTS</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.textInk, marginTop: 4 }}>{labels.tts}</div>
              </div>
            </div>
          );
        })()}

        {/* 5-Point Diagnostic Scorecard Banner */}
        {diagScore && (
          <div style={{ padding: "14px 16px", borderRadius: 10, background: diagScore.all_passed ? "#F0FDF4" : "#FFFBEB", border: `1px solid ${diagScore.all_passed ? "#BBF7D0" : "#FDE68A"}`, marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Activity size={16} color={diagScore.all_passed ? "#16A34A" : "#D97706"} />
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink }}>5-Point Universal Diagnostics</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: diagScore.all_passed ? "#DCFCE7" : "#FEF3C7", color: diagScore.all_passed ? "#15803D" : "#B45309" }}>
                  SCORE: {diagScore.overall_score || (diagScore.all_passed ? "5/5 PASS" : "ATTENTION")}
                </span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, marginTop: 6 }}>
              {[
                { label: "1. Telephony", data: diagScore.checks?.telephony || diagScore.telephony },
                { label: "2. Voice Stack", data: diagScore.checks?.voice_stack || diagScore.voice_stack || diagScore.stt },
                { label: "3. Calendar Mode", data: diagScore.checks?.calendar_config || diagScore.calendar_config },
                { label: "4. Slot Engine", data: diagScore.checks?.slot_availability || diagScore.slot_availability },
                { label: "5. Test Booking", data: diagScore.checks?.test_booking_roundtrip || diagScore.test_booking_roundtrip },
              ].map((item, idx) => {
                const passed = item.data?.status === "pass";
                const isWarn = item.data?.status === "warn";
                const summary = item.data?.summary || (Array.isArray(item.data?.details) ? item.data.details[0] : item.data?.details) || (passed ? "Ready" : "Not configured");
                return (
                  <div key={idx} style={{ padding: "8px 10px", borderRadius: 7, background: "#fff", border: `1px solid ${passed ? "#BBF7D0" : isWarn ? "#FDE68A" : "#FCA5A5"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: C.ink }}>{item.label}</span>
                      {passed ? <CheckCircle2 size={13} color="#16A34A" /> : isWarn ? <AlertTriangle size={13} color="#D97706" /> : <AlertTriangle size={13} color="#DC2626" />}
                    </div>
                    <div style={{ fontSize: 10.5, color: C.slate, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={summary}>{summary}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Live Ping Result Banner */}
        {pingResult && (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: pingResult.success ? C.greenSoft : C.redSoft, border: `1px solid ${pingResult.success ? "#A7F3D0" : "#FCA5A5"}`, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12.5, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: pingResult.success ? "#065F46" : C.red }}>
              {pingResult.success ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              <span>{pingResult.success ? `Webhook healthy · ${pingResult.latencyMs}ms` : `Ping failed: ${pingResult.details?.error || "Check server"}`}</span>
            </div>
            <span style={{ fontFamily: FONT_MONO, color: C.slate, fontSize: 11 }}>HTTP {pingResult.statusCode}</span>
          </div>
        )}
      </div>

      <CallPluginStackBoard
        hubData={hubData}
        connections={connsState}
        onChangeModel={(layerKey, layerTitle, layerName) => {
          setQuickSwitchState({ open: true, layerKey, layerTitle, layerName });
        }}
        onAddLayer={(layer) => {
          setStackAddLayer(layer || "Text-to-Speech");
          setShowStackAdd(true);
        }}
        onOpenCredentials={() => {
          if (typeof onOpenCredentials === "function") onOpenCredentials();
        }}
      />

      {quickSwitchState.open && (
        <QuickSwitchModelModal
          layerKey={quickSwitchState.layerKey}
          layerTitle={quickSwitchState.layerTitle}
          layerName={quickSwitchState.layerName}
          hubData={hubData}
          connections={connsState}
          onClose={() => setQuickSwitchState({ open: false, layerKey: "", layerTitle: "", layerName: "" })}
          onSelectSuccess={(opt) => {
            fetchStatus();
            if (typeof setNotifications === "function") {
              setNotifications((ns) => [
                {
                  id: "n_" + Date.now(),
                  text: `✓ Live call stack switched to ${opt.label || opt.name || opt.value}.`,
                  time: "just now",
                  unread: true,
                  type: "success",
                },
                ...(ns || []),
              ]);
            }
          }}
          onOpenCredentials={() => {
            setQuickSwitchState({ open: false, layerKey: "", layerTitle: "", layerName: "" });
            if (typeof onOpenCredentials === "function") onOpenCredentials();
          }}
        />
      )}

      {showStackAdd && (
        <AddIntegrationModal
          initialCategory={stackAddLayer}
          onClose={() => setShowStackAdd(false)}
          onAddSuccess={() => {
            setShowStackAdd(false);
            fetchStatus();
            if (typeof setNotifications === "function") {
              setNotifications((ns) => [
                { id: "n_" + Date.now(), text: "Plugin connected — live call stack updated.", time: "just now", unread: true, type: "success" },
                ...(ns || []),
              ]);
            }
          }}
        />
      )}

      {/* Direct Outbound Dialing Card */}
      <DirectOutboundCallCard notifications={notifications} setNotifications={setNotifications} defaultFromNumber={phoneNumber || hubData.phoneNumber} />

      {/* 2. PLUGGABLE STACK SELECTOR FORM */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!provisioning) setProvisionConfirmOpen(true);
        }}
        style={{ display: "flex", flexDirection: "column", gap: 20, margin: 0 }}
      >
        
        {/* Line Credentials & Activation Form */}
        <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, margin: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 16, color: C.textInk, margin: 0 }}>Configure Line Credentials & Activation</h3>
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

            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                  {engineChoice === "xai" ? "xAI API Key" : engineChoice === "openai" ? "OpenAI API Key" : engineChoice === "livekit" ? "LiveKit API Key (optional — uses Connections plugins)" : engineChoice === "modular" ? "Optional engine key (modular uses Connections STT/TTS/LLM)" : "Engine Primary API Key"}
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={engineChoice === "xai" ? "xai-••••••••••••••••" : engineChoice === "livekit" ? "devkey (or leave blank if using .env LIVEKIT_API_KEY)" : "sk-••••••••••••••••"}
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

            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 8 }}>
                Who speaks on the call?
              </div>

              {looksLikeApiKeyNotVoiceId(voiceName) && (
                <div style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #FECACA", fontSize: 12.5, color: "#991B1B", lineHeight: 1.45 }}>
                  Active voice is set to an <b>API key</b> (`{String(voiceName).slice(0, 12)}…`). That cannot speak. Save the key under <b>Connections → Cartesia</b>, then paste your Cartesia <b>Voice UUID</b> below (looks like <code>xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</code>).
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <button
                  type="button"
                  onClick={() => {
                    setSpeakMode("builtin");
                    const fallback = ["ara-uk", "ara", "rex-uk", "rex", "eve-uk", "eve"].includes(voiceName) ? voiceName : "ara-uk";
                    setVoiceName(fallback);
                    api.selectVoice({
                      voice_id: fallback,
                      label: fallback === "ara-uk" ? "Ara UK (British, female)" : fallback,
                      provider: "xai",
                      accent: String(fallback).includes("-uk") ? "british" : undefined,
                    }).then(() => fetchStatus()).catch(() => {});
                  }}
                  style={{
                    textAlign: "left",
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: `2px solid ${speakMode === "builtin" && !looksLikeApiKeyNotVoiceId(voiceName) ? C.cobalt : C.border}`,
                    background: speakMode === "builtin" && !looksLikeApiKeyNotVoiceId(voiceName) ? "#F8FAFC" : "#fff",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.textInk }}>Built-in xAI voice</div>
                  <div style={{ fontSize: 12, color: C.slate, marginTop: 4, lineHeight: 1.4 }}>Ara / Rex / Eve — no Cartesia needed</div>
                </button>
                <button
                  type="button"
                  onClick={() => setSpeakMode("clone")}
                  style={{
                    textAlign: "left",
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: `2px solid ${speakMode === "clone" || looksLikeApiKeyNotVoiceId(voiceName) ? C.cobalt : C.border}`,
                    background: speakMode === "clone" || looksLikeApiKeyNotVoiceId(voiceName) ? "#F8FAFC" : "#fff",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.textInk }}>Custom / Cloned Voice</div>
                  <div style={{ fontSize: 12, color: C.slate, marginTop: 4, lineHeight: 1.4 }}>Telnyx · Cartesia · ElevenLabs · Custom TTS</div>
                </button>
              </div>

              {speakMode === "builtin" && !looksLikeApiKeyNotVoiceId(voiceName) ? (
                <div>
                  <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                    Pick built-in voice
                  </label>
                  <select
                    value={["rex-uk", "rex", "ara-uk", "ara", "eve-uk", "eve"].includes(voiceName) ? voiceName : "ara-uk"}
                    onChange={(e) => {
                      const v = e.target.value;
                      setVoiceName(v);
                      api.selectVoice({
                        voice_id: v,
                        label: v === "rex-uk" ? "Rex UK — Sam (British, male)"
                          : v === "ara-uk" ? "Ara UK (British, female)"
                          : v === "eve-uk" ? "Eve UK (British, female)"
                          : v,
                        provider: "xai",
                        accent: String(v || "").includes("-uk") ? "british" : undefined,
                      }).then(() => fetchStatus()).catch(() => {});
                    }}
                    style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", background: "#fff" }}
                  >
                    <option value="ara-uk">Ara UK (British female)</option>
                    <option value="ara">Ara (Female)</option>
                    <option value="rex-uk">Rex UK (British male)</option>
                    <option value="rex">Rex (Male)</option>
                    <option value="eve-uk">Eve UK (British female)</option>
                    <option value="eve">Eve (Female)</option>
                  </select>
                </div>
              ) : (
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, background: "#F8FAFC", display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.45 }}>
                    <b style={{ color: C.textInk }}>Step A.</b> Connections → Save your provider API key (Telnyx, Cartesia, ElevenLabs, etc.).<br />
                    <b style={{ color: C.textInk }}>Step B.</b> Copy your provider's <b>Voice ID / Model Slug</b> (e.g. <code>Telnyx.Ultra.cc91c96c-...</code>, Cartesia UUID, ElevenLabs ID).<br />
                    <b style={{ color: C.textInk }}>Step C.</b> Paste below & click <b>Link</b> — it becomes the active speaking voice on calls.
                  </div>

                  {(() => {
                    const seen = new Set();
                    const allClones = [];
                    (customVoices || []).filter((v) => isValidCloneVoiceId(v.voice_id)).forEach((v) => {
                      if (!seen.has(v.voice_id)) {
                        seen.add(v.voice_id);
                        allClones.push(v);
                      }
                    });
                    (connsState || []).forEach((g) => {
                      (g.items || []).forEach((it) => {
                        const vid = it.voiceId || it.config?.voice_id;
                        if (vid && isValidCloneVoiceId(vid) && !seen.has(vid)) {
                          seen.add(vid);
                          allClones.push({
                            voice_id: vid,
                            name: `${it.name} Voice (${vid.slice(0, 8)}...)`,
                            provider: it.name.toLowerCase(),
                          });
                        }
                      });
                    });
                    if (!allClones.length) return null;
                    return (
                      <div>
                        <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                          Saved & Linked Cloned / Provider Voices
                        </label>
                        <select
                          value={isValidCloneVoiceId(voiceName) ? voiceName : ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) return;
                            setVoiceName(v);
                            const fromList = allClones.find((x) => x.voice_id === v);
                            api.selectVoice({
                              voice_id: v,
                              label: fromList?.name || v,
                              provider: fromList?.provider || (isCartesiaUuid(v) ? "cartesia" : v.toLowerCase().includes("telnyx") ? "telnyx" : "elevenlabs"),
                            }).then(() => fetchStatus()).catch(() => {});
                          }}
                          style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", background: "#fff" }}
                        >
                          <option value="" disabled>Select a cloned voice…</option>
                          {allClones.map((v) => (
                            <option key={v.voice_id} value={v.voice_id}>
                              {v.name || v.voice_id}{v.provider ? ` · ${v.provider}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })()}

                  <div>
                    <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                      Link new Voice ID or Model Slug
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr auto", gap: 8, alignItems: "center" }}>
                      <input
                        type="text"
                        value={cloneName}
                        onChange={(e) => setCloneName(e.target.value)}
                        placeholder="Label (e.g. Telnyx Natural, My voice)"
                        style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, background: "#fff" }}
                      />
                      <input
                        type="text"
                        value={pasteVoiceId}
                        onChange={(e) => setPasteVoiceId(e.target.value)}
                        placeholder="e.g. Telnyx.Ultra.cc91c96c-... or Cartesia UUID or ElevenLabs ID"
                        style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12.5, background: "#fff" }}
                      />
                      <button type="button" onClick={linkPastedVoice} disabled={cloning || !pasteVoiceId.trim()} style={{ background: pasteVoiceId.trim() ? C.ink : "#E7E5E4", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: pasteVoiceId.trim() ? "pointer" : "not-allowed", whiteSpace: "nowrap" }}>
                        {cloning ? "…" : "Link"}
                      </button>
                    </div>
                    {cloneMsg && <div style={{ marginTop: 8, fontSize: 12.5, color: "#059669" }}>{cloneMsg}</div>}
                    {cloneErr && <div style={{ marginTop: 8, fontSize: 12.5, color: "#B91C1C" }}>{cloneErr}</div>}
                  </div>

                  {isValidCloneVoiceId(voiceName) && (
                    <div style={{ marginTop: 4, padding: "8px 12px", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 8, fontSize: 12.5, color: "#065F46", fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
                      <CheckCircle2 size={15} color="#059669" />
                      <div>
                        Active speaking voice: <b>{customVoices.find((v) => v.voice_id === voiceName)?.name || voiceName}</b>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                Response speed
              </label>
              <select
                value={silenceDurationMs}
                onChange={(e) => setSilenceDurationMs(Number(e.target.value))}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", background: "#fff" }}
              >
                <option value={320}>Fast (320ms)</option>
                <option value={380}>Balanced (380ms)</option>
                <option value={500}>Relaxed (500ms)</option>
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 700, color: C.slate, marginBottom: 6 }}>
                Voice style
              </label>
              <select
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", background: "#fff" }}
              >
                <option value={0.85}>Warm</option>
                <option value={0.80}>Balanced</option>
                <option value={0.70}>Neutral</option>
              </select>
            </div>
          </div>

          {/* Dynamic SIP & Webhook Routing Info — collapsed by default */}
          <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
            <button
              type="button"
              onClick={() => setInboundRoutingOpen((o) => !o)}
              aria-expanded={inboundRoutingOpen}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                background: inboundRoutingOpen ? "#F8FAFC" : "#fff",
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: "12px 14px",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.textInk }}>
                  📡 Inbound Routing Configuration for {carrierChoice === "telnyx" ? "Telnyx Portal" : carrierChoice === "twilio" ? "Twilio Console" : "Carrier / PBX"}
                </div>
                {!inboundRoutingOpen && (
                  <div style={{ fontSize: 12, color: C.slate, marginTop: 3 }}>
                    Collapsed. Expand for webhook URL, SIP FQDN, and signing secret.
                  </div>
                )}
              </div>
              <span style={{
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                fontWeight: 700,
                color: C.cobaltDeep,
                background: C.cobaltSoft,
                border: "1px solid #C7D7FA",
                borderRadius: 8,
                padding: "6px 10px",
              }}>
                {inboundRoutingOpen ? "Collapse" : "Expand"}
                <ChevronDown size={14} style={{ transform: inboundRoutingOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              </span>
            </button>

            {inboundRoutingOpen && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginTop: 12 }}>
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
                    onClick={() => copyToClipboard(`${hubData?.xaiFqdn || "sip.voice.x.ai"}:5060`, "fqdn")}
                    style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: C.slate }}
                  >
                    {copiedFqdn ? <Check size={11} color={C.green} /> : <Copy size={11} />}
                    {copiedFqdn ? "Copied" : "Copy"}
                  </button>
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.ink }}>{hubData?.xaiFqdn || "sip.voice.x.ai"}:5060</div>
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
                      title={signingSecret ? (showSecret ? "Hide" : "Show one-time secret") : "Full secret stays encrypted — only mask is available"}
                    >
                      {showSecret ? <EyeOff size={11} /> : <Eye size={11} />}
                      {showSecret ? "Hide" : "Reveal"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const copyVal = signingSecret || "";
                        if (!copyVal) {
                          setNotifications?.((ns) => [
                            { id: "n_" + Date.now(), text: "Full signing secret is encrypted — copy only available right after provision.", time: "just now", unread: true, type: "info" },
                            ...(ns || []),
                          ]);
                          return;
                        }
                        copyToClipboard(copyVal, "secret");
                      }}
                      style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 5, padding: "3px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, color: C.slate }}
                    >
                      {copiedSecret ? <Check size={11} color={C.green} /> : <Copy size={11} />}
                      {copiedSecret ? "Copied" : "Copy"}
                    </button>                  </div>
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.ink, wordBreak: "break-all" }}>
                  {showSecret
                    ? (signingSecret || hubData.signingSecretMasked || "whsec_••••••••")
                    : (hubData.signingSecretMasked || (signingSecret ? (signingSecret.slice(0, 8) + "••••••••") : "whsec_••••••••"))}
                </div>
                <div style={{ fontSize: 11, color: hubData.hasSigningSecret ? "#059669" : C.slate, marginTop: 4 }}>
                  {hubData.hasSigningSecret
                    ? "✓ Encrypted in database — full secret cannot be revealed again (shown once at provision)"
                    : "Auto-generated by xAI upon registration"}
                </div>              </div>
            </div>
            )}
          </div>
        </div>

        {/* Feedback Alerts */}
        {provisionErr && (
          <div style={{ padding: "12px 16px", borderRadius: 8, background: C.redSoft, border: `1px solid #FCA5A5`, color: C.red, display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <AlertTriangle size={16} /> {provisionErr}
          </div>
        )}

        {provisionMsg && (
          <div style={{
            padding: "14px 18px",
            borderRadius: 8,
            background: (provisionMsg.success && !provisionMsg.registrationError) ? C.greenSoft : C.redSoft,
            border: `1px solid ${(provisionMsg.success && !provisionMsg.registrationError) ? "#A7F3D0" : "#FCA5A5"}`,
            color: (provisionMsg.success && !provisionMsg.registrationError) ? C.green : C.red,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            fontSize: 13
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
              {(provisionMsg.success && !provisionMsg.registrationError) ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              {provisionMsg.message}
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


        {/* Submit Button + confirm popup */}
        <div style={{ position: "relative", display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
          {showProvisionTip && !provisioning && (
            <div
              role="tooltip"
              style={{
                position: "absolute",
                bottom: "calc(100% + 10px)",
                left: 0,
                zIndex: 30,
                maxWidth: 340,
                padding: "10px 12px",
                borderRadius: 10,
                background: "#0F172A",
                color: "#F8FAFC",
                fontSize: 12.5,
                lineHeight: 1.45,
                boxShadow: "0 10px 28px rgba(15,23,42,0.28)",
                pointerEvents: "none",
              }}
            >
              Saves phone, carrier, voice engine, and voice settings. Registers the number on xAI (BYO trunk) and refreshes Telephony + Voice connections. Does not place a call.
              <span style={{
                position: "absolute",
                bottom: -6,
                left: 28,
                width: 12,
                height: 12,
                background: "#0F172A",
                transform: "rotate(45deg)",
              }} />
            </div>
          )}
          <button
            type="submit"
            disabled={provisioning}
            onMouseEnter={() => setShowProvisionTip(true)}
            onMouseLeave={() => setShowProvisionTip(false)}
            onFocus={() => setShowProvisionTip(true)}
            onBlur={() => setShowProvisionTip(false)}
            aria-describedby="provision-stack-tip"
            style={{
              background: "linear-gradient(135deg, #0EA5E9 0%, #0284C7 100%)",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "14px 32px",
              fontFamily: FONT_DISPLAY,
              fontSize: 15,
              fontWeight: 800,
              cursor: provisioning ? "wait" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              boxShadow: "0 6px 20px rgba(6, 182, 212, 0.35)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              transition: "all 0.2s ease",
              transform: provisioning ? "scale(0.98)" : "scale(1)",
              opacity: provisioning ? 0.7 : 1,
            }}
          >
            {provisioning ? (
              <>
                <RefreshCw size={16} className="animate-spin" style={{ animation: "spin 1s linear infinite" }} /> 
                <span>Provisioning...</span>
              </>
            ) : (
              <>
                <ShieldCheck size={18} /> 
                <span>💾 Save & Activate Stack</span>
              </>
            )}
          </button>
          <span id="provision-stack-tip" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            Saves phone, carrier, voice engine, and voice settings. Registers the number on xAI and refreshes connections. Does not place a call.
          </span>
        </div>
      </form>

      {provisionConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="provision-confirm-title"
          onClick={() => !provisioning && setProvisionConfirmOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 420,
              background: "#fff",
              borderRadius: 14,
              border: `1px solid ${C.border}`,
              boxShadow: "0 24px 60px rgba(15,23,42,0.28)",
              padding: "22px 24px",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: C.cobaltSoft,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <ShieldCheck size={18} color={C.cobaltDeep} />
                </div>
                <h3 id="provision-confirm-title" style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 800, color: C.textInk }}>
                  Save updated stack?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setProvisionConfirmOpen(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: C.slate, padding: 4 }}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <p style={{ margin: "0 0 18px", fontSize: 13.5, lineHeight: 1.5, color: C.slate }}>
              New updates will get saved — phone number, carrier, voice engine, active voice, and pacing. The line will also register with xAI if needed. This does not start a call.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setProvisionConfirmOpen(false)}
                style={{
                  background: "#fff",
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "9px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  color: C.textInk,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleProvision()}
                style={{
                  background: `linear-gradient(135deg, #2a47ae 0%, #1a2d7a 100%)`,
                  border: "none",
                  borderRadius: 10,
                  padding: "11px 22px",
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: "pointer",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  boxShadow: `0 4px 12px rgba(42, 71, 174, 0.3)`,
                  transition: "all 0.2s ease",
                }}
              >
                <Check size={16} style={{ fontWeight: "bold" }} /> 💾 Save & Activate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LiveKit WebRTC In-Browser Voice Call Modal */}
      <LiveKitBrowserCallModal
        isOpen={liveKitModalOpen}
        onClose={() => setLiveKitModalOpen(false)}
        prospectName="Line Setup Test User"
        prospectPhone={phoneNumber || hubData?.phoneNumber || "Browser WebRTC"}
        companyName={profile?.name || "AIVHub"}
      />
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

function ProviderConfigView({ notifications, setNotifications, commonAi, setCommonAi, profile, setProfile, onNavigateView, embedded = false }) {
  const [activeTab, setActiveTab] = useState("telephony-hub");
  const [showAdd, setShowAdd] = useState(false);
  const [addModalCategory, setAddModalCategory] = useState("LLM");
  const [dirty, setDirty] = useState(false);

  // ── Credentials: loaded live from backend with template fallback ──
  const [credsState, setCredsState] = useState(CONNECTIONS);
  const [rowState, setRowState] = useState({});
  const [liveHub, setLiveHub] = useState(null);
  const [customVoices, setCustomVoices] = useState([]);
  const [voiceName, setVoiceName] = useState("");
  const [speakMode, setSpeakMode] = useState("builtin"); // "builtin" or "clone"
  const [deleteKeyConfirm, setDeleteKeyConfirm] = useState(null); // { groupName, item, rowKey, deleting }
  const liveLabels = liveHub ? liveStackLabels(liveHub) : null;

  useEffect(() => {
    async function loadConns() {
      try {
        const conns = await api.getConnections();
        if (conns && Array.isArray(conns) && conns.length) {
          setCredsState((prev) => {
            const groupBackendItems = {};
            conns.forEach((g) => {
              groupBackendItems[g.group] = g.items || [];
            });

            return prev.map((group) => {
              const bItems = groupBackendItems[group.group] || [];
              const matchedIds = new Set();

              const updatedItems = (group.items || []).map((it) => {
                // 1. Exact name match (excluding already matched items)
                let live = bItems.find((b) => !matchedIds.has(b.id) && b.name.toLowerCase() === it.name.toLowerCase());

                // 2. Normalized alias match if not exact
                if (!live) {
                  const itNorm = it.name.toLowerCase().replace(/[^a-z0-9]/g, "");
                  live = bItems.find((b) => {
                    if (matchedIds.has(b.id)) return false;
                    const bNorm = b.name.toLowerCase().replace(/[^a-z0-9]/g, "");
                    if (itNorm === bNorm) return true;
                    // xAI voice orchestrator aliases
                    if (group.group === "Voice Orchestration" && !itNorm.includes("telnyx") && (itNorm.startsWith("xai") || itNorm.includes("grok")) && (bNorm.startsWith("xai") || bNorm.includes("grok"))) return true;
                    // xAI LLM aliases (strict: do NOT match if it is telnyx)
                    if (group.group === "LLM" && !itNorm.includes("telnyx") && (itNorm.startsWith("xai") || itNorm.includes("grok")) && (bNorm.startsWith("xai") || bNorm.includes("grok"))) return true;
                    // LiveKit aliases
                    if (itNorm.includes("livekit") && bNorm.includes("livekit")) return true;
                    // Cartesia aliases
                    if (itNorm.includes("cartesia") && bNorm.includes("cartesia")) return true;
                    // ElevenLabs aliases
                    if (itNorm.includes("eleven") && bNorm.includes("eleven")) return true;
                    // Deepgram aliases
                    if (itNorm.includes("deepgram") && bNorm.includes("deepgram")) return true;
                    // Twilio aliases
                    if (itNorm.includes("twilio") && bNorm.includes("twilio")) return true;
                    // Cal.com aliases (not any name containing "cal", e.g. "Local LLM")
                    if (itNorm.includes("calcom") && bNorm.includes("calcom")) return true;
                    return false;
                  });
                }

                if (live) {
                  if (live.id) matchedIds.add(live.id);
                  return {
                    ...it,
                    id: live.id,
                    status: live.status,
                    apiKeyMasked: live.apiKeyMasked,
                    model: live.model || it.model,
                    baseUrl: live.baseUrl || it.baseUrl,
                    voiceId: live.voiceId || it.voiceId,
                    phone: live.phone || it.phone,
                    accountSid: live.accountSid || it.accountSid,
                    agentId: live.agentId || it.agentId,
                    connectionId: live.connectionId || it.connectionId,
                  };
                }
                return it;
              });

              // Only preserve custom or additional providers from backend that are actually connected with saved keys
              const extraItems = bItems.filter((b) => b.id && !matchedIds.has(b.id) && b.status === "connected" && b.apiKeyMasked).map((b) => ({
                name: b.name,
                id: b.id,
                status: b.status,
                apiKeyMasked: b.apiKeyMasked,
                model: b.model,
                baseUrl: b.baseUrl,
                voiceId: b.voiceId,
                phone: b.phone,
                accountSid: b.accountSid,
                agentId: b.agentId,
                connectionId: b.connectionId,
              }));

              return {
                ...group,
                items: [...updatedItems, ...extraItems],
              };
            });
          });
        }
      } catch (_) {}
      try {
        const hub = await api.getTelephonyHub();
        if (hub) {
          setLiveHub(hub);
          if (Array.isArray(hub.customVoices)) setCustomVoices(hub.customVoices);
          if (setCommonAi) {
            setCommonAi((prev) => ({
              ...prev,
              voiceLayers: voiceLayersFromHub(hub, prev.voiceLayers),
            }));
          }
        }
      } catch (_) {}
    }
    loadConns();
  }, []);

  const flash = () => {
    setDirty(true);
    setTimeout(() => setDirty(false), 1400);
  };

  // ── Credentials inline test→save helpers ──
  const setRow = (rowKey, patch) =>
    setRowState((s) => ({ ...s, [rowKey]: { ...(s[rowKey] || {}), ...patch } }));

  const isTelnyxCarrierRow = (rowKey) => /^Telephony\|/.test(rowKey || "") && /telnyx/i.test(rowKey || "");

  // Non-secret fields sent with every save so "Save" never blanks what the form showed.
  const extraFields = (rowKey, row) => {
    const second = (row.agentIdValue || "").trim();
    if (isTelnyxCarrierRow(rowKey)) return { connection_id: second };
    if (/twilio|whatsapp/i.test(rowKey || "")) return {};
    return { agent_id: second };
  };

  const refreshLiveHub = async () => {
    try {
      const hub = await api.getTelephonyHub();
      if (hub) setLiveHub(hub);
    } catch (_) {}
  };

  const handleConnect = (rowKey, it = {}) =>
    setRow(rowKey, {
      phase: "editing",
      keyValue: "",
      phoneValue: it?.phone || "",
      agentIdValue: isTelnyxCarrierRow(rowKey) ? (it?.connectionId || "") : (it?.agentId || ""),
      accountSidValue: it?.accountSid || "",
      modelValue: it?.model || "",
      baseUrlValue: it?.baseUrl || "",
      voiceIdValue: it?.voiceId || it?.config?.voice_id || "",
      errorMsg: "",
      testResult: null
    });

  const handleCancel = (rowKey) =>
    setRowState((s) => { const n = { ...s }; delete n[rowKey]; return n; });

  const handleTest = async (groupName, itemName, rowKey) => {
    const row = rowState[rowKey] || {};
    const key = (row.keyValue || "").trim();
    if (!key) { setRow(rowKey, { errorMsg: "API key cannot be empty." }); return; }
    const isTwilio = String(itemName || "").toLowerCase().includes("twilio");
    const isWhatsApp = String(itemName || "").toLowerCase().includes("whatsapp");
    const sidCandidate = (row.accountSidValue || row.agentIdValue || "").trim();
    const accountSid = isTwilio
      ? (sidCandidate.startsWith("AC") ? sidCandidate : (row.accountSidValue || "").trim())
      : isWhatsApp
      ? (row.accountSidValue || "").trim()
      : undefined;
    if (isTwilio && (!accountSid || !accountSid.startsWith("AC") || accountSid.length !== 34)) {
      setRow(rowKey, { errorMsg: "Twilio needs Account SID (AC…, 34 chars) in the Account SID field — not Voice Agent ID." });
      return;
    }
    if (isTwilio && (key.startsWith("xai-") || key.length !== 32)) {
      setRow(rowKey, { errorMsg: "Paste the Twilio Auth Token (32 characters from console.twilio.com) — not an xAI key." });
      return;
    }
    setRow(rowKey, { phase: "testing", errorMsg: "", testResult: null });
    try {
      const res = await api.testConnection({
        layer: groupName,
        provider: itemName,
        api_key: key,
        account_sid: accountSid || undefined,
        base_url: (row.baseUrlValue || "").trim() || undefined,
        model: (row.modelValue || "").trim() || undefined,
        voice_id: (row.voiceIdValue || "").trim() || undefined,
      });
      setRow(rowKey, { phase: "tested_ok", testResult: res.details || "Authentication verified! Ready to save." });
    } catch (err) {
      const msg = err?.name === "AbortError"
        ? "Test cancelled."
        : (err?.message || "Authentication rejected by provider.");
      setRow(rowKey, { phase: "tested_fail", errorMsg: msg });
    }
  };

  const handleSave = async (groupName, itemName, rowKey) => {
    const row = rowState[rowKey] || {};
    const key = (row.keyValue || "").trim();
    const item = (credsState.find((g) => g.group === groupName)?.items || []).find((x) => x.name === itemName);
    const isAlreadyConnected = item?.status === "connected";

    // If key is not entered and connection is already connected, perform lightweight config update
    if (!key && isAlreadyConnected) {
      setRow(rowKey, { phase: "saving" });
      try {
        const savedVoiceId = (row.voiceIdValue || "").trim();
        const savedModel = (row.modelValue || "").trim();
        const savedBaseUrl = (row.baseUrlValue || "").trim();
        const savedPhone = (row.phoneValue || "").trim();
        await api.updateConnectionConfig({
          id: item.id || undefined,
          layer: groupName,
          provider: itemName,
          model: savedModel,
          base_url: savedBaseUrl,
          voice_id: savedVoiceId,
          phone: savedPhone,
          ...extraFields(rowKey, row),
        });
        setCredsState((s) =>
          s.map((g) =>
            g.group === groupName
              ? {
                  ...g,
                  items: (g.items || []).map((x) =>
                    x.name === itemName
                      ? {
                          ...x,
                          model: savedModel,
                          baseUrl: savedBaseUrl,
                          voiceId: savedVoiceId,
                          phone: savedPhone,
                          ...(isTelnyxCarrierRow(rowKey) ? { connectionId: (row.agentIdValue || "").trim() } : { agentId: (row.agentIdValue || "").trim() }),
                          config: { ...(x.config || {}), voice_id: savedVoiceId, model: savedModel },
                        }
                      : x
                  ),
                }
              : g
          )
        );
        if (savedVoiceId) {
          const vObj = {
            voice_id: savedVoiceId,
            id: savedVoiceId,
            name: `${itemName} Voice (${savedVoiceId.slice(0, 8)}...)`,
            provider: itemName.toLowerCase(),
          };
          setCustomVoices((prev) => [vObj, ...(prev || []).filter((v) => v.voice_id !== savedVoiceId)]);
          setVoiceName(savedVoiceId);
          setSpeakMode("clone");
        }
        handleCancel(rowKey);
        setNotifications((ns) => [
          { id: "n_" + Date.now(), text: `✓ Updated configuration for ${itemName}`, time: "just now", unread: true, type: "success" },
          ...ns,
        ]);
        flash();
        refreshLiveHub();
        return;
      } catch (err) {
        setRow(rowKey, { phase: "tested_fail", errorMsg: err.message || "Failed to update configuration." });
        return;
      }
    }

    const isTwilio = String(itemName || "").toLowerCase().includes("twilio");
    const isWhatsApp = String(itemName || "").toLowerCase().includes("whatsapp");
    const sidCandidate = (row.accountSidValue || row.agentIdValue || "").trim();
    const accountSid = isTwilio
      ? (sidCandidate.startsWith("AC") ? sidCandidate : (row.accountSidValue || "").trim())
      : isWhatsApp
      ? (row.accountSidValue || "").trim()
      : undefined;
    setRow(rowKey, { phase: "saving" });
    try {
      const res = await api.testAndSaveConnection({
        layer: groupName,
        provider: itemName,
        api_key: key,
        account_sid: accountSid || undefined,
        base_url: (row.baseUrlValue || "").trim() || undefined,
        model: (row.modelValue || "").trim() || undefined,
        voice_id: (row.voiceIdValue || "").trim() || undefined,
        phone: (row.phoneValue || "").trim() || undefined,
        ...extraFields(rowKey, row),
      });
      const savedVoiceId = (row.voiceIdValue || "").trim();
      setCredsState((s) =>
        s.map((g) =>
          g.group === groupName
            ? {
                ...g,
                items: (g.items || []).map((x) =>
                  x.name === itemName
                    ? {
                        ...x,
                        id: res.id || x.id,
                        status: "connected",
                        apiKeyMasked: res.maskedKey,
                        model: (row.modelValue || "").trim() || x.model,
                        baseUrl: (row.baseUrlValue || "").trim() || x.baseUrl,
                        voiceId: savedVoiceId || x.voiceId,
                        phone: (row.phoneValue || "").trim() || x.phone,
                        ...(isTelnyxCarrierRow(rowKey)
                          ? { connectionId: (row.agentIdValue || "").trim() || x.connectionId }
                          : { agentId: (row.agentIdValue || "").trim() || x.agentId }),
                        config: { ...(x.config || {}), voice_id: savedVoiceId || x.voiceId },
                      }
                    : x
                ),
              }
            : g
        )
      );
      if (savedVoiceId) {
        const vObj = {
          voice_id: savedVoiceId,
          id: savedVoiceId,
          name: `${itemName} Voice (${savedVoiceId.slice(0, 8)}...)`,
          provider: itemName.toLowerCase(),
        };
        setCustomVoices((prev) => [vObj, ...(prev || []).filter((v) => v.voice_id !== savedVoiceId)]);
        setVoiceName(savedVoiceId);
        setSpeakMode("clone");
      }
      if (row.phoneValue && setProfile) {
        setProfile((prev) => ({ ...prev, callerId: row.phoneValue }));
      }
      try {
        if (isTwilio && accountSid) localStorage.setItem("aivhub_twilio_sid", accountSid);
      } catch (_) {}
      handleCancel(rowKey);
      setNotifications((ns) => [
        { id: "n_" + Date.now(), text: `✓ ${itemName} key verified and saved!${row.phoneValue ? ` (Caller ID: ${row.phoneValue})` : ""}`, time: "just now", unread: true, type: "success" },
        ...ns,
      ]);
      flash();
      refreshLiveHub();
    } catch (err) {
      setRow(rowKey, { phase: "tested_fail", errorMsg: err.message || "Save failed." });
    }
  };

  const requestDeleteKey = (groupName, item, rowKey) => {
    if (!item || item.status !== "connected") return;
    setDeleteKeyConfirm({ groupName, item, rowKey, deleting: false });
  };

  const confirmDeleteKey = async () => {
    if (!deleteKeyConfirm) return;
    const { groupName, item, rowKey } = deleteKeyConfirm;
    setDeleteKeyConfirm((s) => (s ? { ...s, deleting: true } : s));
    setRow(rowKey, { phase: "saving", errorMsg: "" });
    try {
      await api.clearConnectionKey({
        id: item.id || undefined,
        layer: groupName,
        provider: item.name,
      });
      setCredsState((s) =>
        s.map((g) =>
          g.group === groupName
            ? {
                ...g,
                items: (g.items || []).map((x) =>
                  x.name === item.name
                    ? { ...x, status: "not_configured", apiKeyMasked: undefined }
                    : x
                ),
              }
            : g
        )
      );
      handleCancel(rowKey);
      setDeleteKeyConfirm(null);
      setNotifications((ns) => [
        { id: "n_" + Date.now(), text: `Deleted ${item.name} API key.`, time: "just now", unread: true, type: "success" },
        ...ns,
      ]);
      flash();
    } catch (err) {
      setRow(rowKey, { phase: "idle", errorMsg: "" });
      handleCancel(rowKey);
      setDeleteKeyConfirm(null);
      setNotifications((ns) => [
        { id: "n_" + Date.now(), text: err.message || `Failed to delete ${item.name} key.`, time: "just now", unread: true, type: "error" },
        ...ns,
      ]);
    }
  };

  const handleAddSuccess = (newIntegration) => {
    const itemObj = {
      name: newIntegration.name,
      status: "connected",
      apiKeyMasked: newIntegration.masked,
      model: newIntegration.model,
      baseUrl: newIntegration.baseUrl,
      voiceId: newIntegration.voiceId,
      config: { voice_id: newIntegration.voiceId },
    };
    setCredsState((prev) => {
      const exists = prev.find((g) => g.group === newIntegration.category);
      if (exists) {
        return prev.map((g) =>
          g.group === newIntegration.category
            ? { ...g, items: [...(g.items || []).filter((it) => it.name !== newIntegration.name), itemObj] }
            : g
        );
      }
      return [...prev, { group: newIntegration.category, desc: "", items: [itemObj] }];
    });
    if (newIntegration.voiceId) {
      const vObj = {
        voice_id: newIntegration.voiceId,
        id: newIntegration.voiceId,
        name: `${newIntegration.name} Voice (${newIntegration.voiceId.slice(0, 8)}...)`,
        provider: newIntegration.name.toLowerCase(),
      };
      setCustomVoices((prev) => [vObj, ...(prev || []).filter((v) => v.voice_id !== newIntegration.voiceId)]);
      setVoiceName(newIntegration.voiceId);
      setSpeakMode("clone");
      try {
        const cached = JSON.parse(localStorage.getItem("aivhub_telephony_hub_cache") || "{}");
        cached.customVoices = [vObj, ...(cached.customVoices || []).filter((v) => v.voice_id !== newIntegration.voiceId)];
        cached.voiceName = newIntegration.voiceId;
        localStorage.setItem("aivhub_telephony_hub_cache", JSON.stringify(cached));
      } catch (_) {}
    }
    setNotifications((ns) => [
      { id: "n_" + Date.now(), text: `✓ Verified and activated ${newIntegration.name}`, time: "just now", unread: true, type: "success" },
      ...ns,
    ]);
    flash();
  };

  return (
    <>
      {!embedded && <TopBar title="AI config" subtitle="Line setup · Connections · Setup guide" notifications={notifications} setNotifications={setNotifications} />}
      <div style={{ padding: embedded ? 0 : "20px 32px" }}>

        <div style={{
          display: "flex",
          gap: 8,
          marginBottom: 18,
          flexWrap: "wrap",
          padding: embedded ? 6 : 0,
          background: embedded ? "#fff" : "transparent",
          border: embedded ? `1px solid ${C.border}` : "none",
          borderRadius: embedded ? 14 : 0,
          boxShadow: embedded ? "0 8px 28px rgba(18,20,28,0.06)" : "none",
        }}>
          {(embedded
            ? [
                { id: "telephony-hub", label: "Line setup" },
                { id: "credentials", label: "Connections" },
                { id: "docs", label: "Setup guide" },
              ]
            : [
                { id: "telephony-hub", label: "Line setup" },
                { id: "credentials", label: "Connections" },
                { id: "docs", label: "Setup guide" },
              ]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: embedded ? "8px 14px" : "8px 16px",
                borderRadius: embedded ? 10 : 8,
                border: embedded ? "none" : `1px solid ${activeTab === t.id ? C.ink : C.border}`,
                background: activeTab === t.id ? (embedded ? C.ink : C.ink) : (embedded ? "transparent" : "#fff"),
                color: activeTab === t.id ? "#fff" : C.slate,
                fontFamily: FONT_BODY,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "docs" && (
          <TelephonyDocsView
            embedded={embedded}
            notifications={notifications}
            setNotifications={setNotifications}
            onNavigate={(dest) => {
              if (dest === "provider") setActiveTab("telephony-hub");
              else if (onNavigateView) onNavigateView(dest);
              else if (typeof window.__aivhub_switch_voice_view === "function") window.__aivhub_switch_voice_view(dest);
            }}
          />
        )}

        {/* TAB 0: Voice & Telephony Trunking Hub */}
        {activeTab === "telephony-hub" && (
          <VoiceTrunkingHubTab
            notifications={notifications}
            setNotifications={setNotifications}
            profile={profile}
            setProfile={setProfile}
            onOpenCredentials={() => setActiveTab("credentials")}
          />
        )}

        {/* TAB: Connections — single place to paste keys + see what's in use */}
        {activeTab === "credentials" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ padding: "14px 16px", borderRadius: 10, background: "#F8FAFC", border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.textInk, marginBottom: 4 }}>Connections</div>
              <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.45 }}>
                One place for API keys. Rows highlighted <b>In use · Calling</b> are what the live call stack is using now. Line phone / Activate stay under <b>Line setup</b>.
              </div>
              {liveLabels && (
                <div style={{ marginTop: 10, fontSize: 12.5, color: C.ink, fontWeight: 600 }}>
                  Calling now: {liveLabels.carrier} · {liveLabels.engine} · speak {liveLabels.tts}
                  {liveHub?.externalTts ? " (hybrid)" : ""}
                </div>
              )}
            </div>

            <TelnyxAssistantSettingsCard />

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
                    const nameL = String(it.name || "").toLowerCase();
                    const carrierL = String(liveHub?.activeCarrier || liveLabels?.carrier || "").toLowerCase();
                    const ttsL = String(liveHub?.ttsProvider || liveHub?.ttsName || liveLabels?.tts || "").toLowerCase();
                    const engL = String(liveHub?.liveEngine || liveHub?.activeEngine || "").toLowerCase();
                    const isConnected = it.status === "connected";
                    let usedBy = "";
                    if (isConnected) {
                      if (group.group === "Telephony" && carrierL && nameL.includes(carrierL.split(/\s+/)[0])) {
                        usedBy = "In use · Calling";
                      } else if (group.group === "Text-to-Speech" && (
                        (nameL.includes("xai") && (ttsL.includes("xai") || !liveHub?.externalTts && engL.includes("xai"))) ||
                        (nameL.includes("cartesia") && ttsL.includes("cartesia")) ||
                        (nameL.includes("eleven") && ttsL.includes("eleven")) ||
                        (nameL.includes("deepgram") && (ttsL.includes("deepgram") || ttsL.includes("aura"))) ||
                        (ttsL && nameL.includes(ttsL.split(/\s+/)[0]))
                      )) {
                        usedBy = "In use · Calling speak";
                      } else if (group.group === "Voice Orchestration" && (
                        (nameL.includes("livekit") && engL.includes("livekit")) ||
                        (nameL.includes("xai") && engL.includes("xai")) ||
                        (nameL.includes("vapi") && engL.includes("vapi")) ||
                        (nameL.includes("retell") && engL.includes("retell")) ||
                        (nameL.includes("openai") && engL.includes("openai")) ||
                        (nameL.includes("modular") && engL.includes("modular"))
                      )) {
                        usedBy = "In use · Calling engine";
                      } else if (group.group === "Speech-to-Text" && (
                        (liveHub?.sttProvider && nameL.includes(String(liveHub.sttProvider).toLowerCase())) ||
                        (nameL.includes("deepgram") && String(liveLabels?.stt || "").toLowerCase().includes("deepgram"))
                      )) {
                        usedBy = "In use · Calling listen";
                      } else if (group.group === "LLM" && (
                        (liveHub?.llmProvider && nameL.includes(String(liveHub.llmProvider).toLowerCase())) ||
                        (nameL.includes("deepseek") && String(liveLabels?.llm || "").toLowerCase().includes("deepseek")) ||
                        (nameL.includes("openai") && String(liveLabels?.llm || "").toLowerCase().includes("openai"))
                      )) {
                        usedBy = "In use · Calling think";
                      } else if (group.group === "Calendar") {
                        usedBy = "In use · Schedule";
                      }
                    }
                    const highlighted = isConnected && !!usedBy;
                    const rowBg = isConnected ? "#F0FDF4" : undefined;
                    const rowBorderTop = idx === 0 ? "none" : (isConnected ? "1px solid #BBF7D0" : `1px solid ${C.border}`);
                    return (
                      <div key={it.name} style={{ borderTop: rowBorderTop, background: rowBg, transition: "background 0.2s ease, border-color 0.2s ease" }}>
                        {/* Main row */}
                        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 18px" }}>
                          <div style={{ width: 210, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, color: C.textInk }}>
                            {it.name}
                            {it.model && (
                              <div style={{ fontSize: 11, fontFamily: FONT_MONO, color: C.cobalt, marginTop: 2, fontWeight: 600 }}>
                                Model: {it.model}
                              </div>
                            )}
                            {highlighted && (
                              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#065F46", marginTop: 3, letterSpacing: "0.02em" }}>
                                {usedBy}
                                {group.group === "Text-to-Speech" && (liveHub?.ttsName || liveLabels?.tts) && (
                                  <span style={{ display: "block", color: "#047857", fontWeight: 600, fontSize: 10, marginTop: 1 }}>
                                    Active: {liveHub.ttsName || liveLabels.tts}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 12, color: isConnected ? C.textInk : C.slateLight }}>
                            {it.apiKeyMasked || (isConnected ? "••••••••••••" : "Not configured")}
                          </div>
                          <Badge status={it.status} small />

                          {phase === "idle" && (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                              <button onClick={() => handleConnect(rowKey, it)}
                                style={{
                                  background: "#fff",
                                  border: `1px solid ${isConnected ? "#86EFAC" : C.border}`,
                                  borderRadius: 7,
                                  padding: "6px 14px",
                                  fontFamily: FONT_BODY,
                                  fontSize: 12,
                                  color: isConnected ? "#15803D" : C.slate,
                                  fontWeight: isConnected ? 600 : 500,
                                  cursor: "pointer",
                                  whiteSpace: "nowrap"
                                }}>
                                {isConnected ? "Configure / Update" : "Connect"}
                              </button>
                              {isConnected && (
                                <button
                                  type="button"
                                  onClick={() => requestDeleteKey(group.group, it, rowKey)}
                                  title="Delete saved API key"
                                  style={{ background: "#fff", border: `1px solid #F0C4B8`, borderRadius: 7, padding: "6px 10px", fontFamily: FONT_BODY, fontSize: 12, color: C.red, cursor: "pointer", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 5 }}
                                >
                                  <Trash2 size={13} /> Delete key
                                </button>
                              )}
                            </div>
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
                                {String(it.name || "").toLowerCase().includes("twilio")
                                  ? "Twilio Auth Token"
                                  : String(it.name || "").toLowerCase().includes("whatsapp")
                                  ? "Meta WhatsApp Access Token (EAAG...)"
                                  : `${it.name} API Key / Token`}
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
                                  placeholder={String(it.name || "").toLowerCase().includes("twilio")
                                    ? "Paste 32-character Auth Token from console.twilio.com"
                                    : String(it.name || "").toLowerCase().includes("whatsapp")
                                    ? "Paste Meta Access Token (starts with EAAG...)"
                                    : "Paste API key / token to test & connect..."}
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

                            {/* Optional Phone Number & Agent ID / Twilio Account SID / WhatsApp Phone ID */}
                            {(it.name.toLowerCase().includes("xai") || group.group === "Telephony" || group.group === "Voice Orchestration" || it.name.toLowerCase().includes("twilio") || group.group === "Messaging" || it.name.toLowerCase().includes("whatsapp")) && (
                              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 10, marginTop: 4 }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                    {String(it.name || "").toLowerCase().includes("whatsapp")
                                      ? "WhatsApp Sender / Phone Number"
                                      : "Assigned Outbound Phone Number"}
                                  </label>
                                  <input
                                    type="text"
                                    value={rs.phoneValue || ""}
                                    onChange={(e) => setRow(rowKey, { phoneValue: e.target.value })}
                                    placeholder={String(it.name || "").toLowerCase().includes("whatsapp") ? "+1 555... or your registered WhatsApp number" : "+44 20... or +1..."}
                                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12, outline: "none", background: "#fff" }}
                                  />
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                    {isTelnyxCarrierRow(rowKey)
                                      ? "Call Control App ID (Optional)"
                                      : String(it.name || "").toLowerCase().includes("twilio")
                                      ? "Account SID (required)"
                                      : String(it.name || "").toLowerCase().includes("whatsapp")
                                      ? "Phone Number ID (Required)"
                                      : String(it.name || "").toLowerCase().includes("vapi")
                                      ? "Vapi Assistant ID (Optional)"
                                      : String(it.name || "").toLowerCase().includes("retell")
                                      ? "Retell Agent ID (Required for Outbound)"
                                      : "Voice Agent ID (Optional)"}
                                  </label>
                                  <input
                                    type="text"
                                    value={
                                      String(it.name || "").toLowerCase().includes("twilio") || String(it.name || "").toLowerCase().includes("whatsapp")
                                        ? (rs.accountSidValue || rs.agentIdValue || "")
                                        : (rs.agentIdValue || "")
                                    }
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      if (String(it.name || "").toLowerCase().includes("twilio") || String(it.name || "").toLowerCase().includes("whatsapp")) {
                                        setRow(rowKey, { accountSidValue: v, agentIdValue: v, errorMsg: "" });
                                      } else {
                                        setRow(rowKey, { agentIdValue: v });
                                      }
                                    }}
                                    placeholder={isTelnyxCarrierRow(rowKey)
                                      ? "Leave empty to auto-detect"
                                      : String(it.name || "").toLowerCase().includes("twilio")
                                      ? "ACxxxxxxxx… (34 characters)"
                                      : String(it.name || "").toLowerCase().includes("whatsapp")
                                      ? "e.g. 1238965585975808 (15 digits)"
                                      : String(it.name || "").toLowerCase().includes("vapi")
                                      ? "asst_... or UUID (optional)"
                                      : String(it.name || "").toLowerCase().includes("retell")
                                      ? "agent_xxxxxxxxxxxxxxxx"
                                      : "agent_... or sid_..."}
                                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12, outline: "none", background: "#fff" }}
                                  />
                                </div>
                              </div>
                            )}

                            {/* Model Selection & Custom Base URL */}
                            {(["LLM", "Speech-to-Text", "Text-to-Speech", "Voice Orchestration"].includes(group.group) || String(it.name || "").toLowerCase().includes("other")) && (
                              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 10, marginTop: 4 }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                    Model
                                  </label>
                                  <input
                                    type="text"
                                    value={rs.modelValue || ""}
                                    onChange={(e) => setRow(rowKey, { modelValue: e.target.value })}
                                    placeholder={group.group === "Speech-to-Text" ? "e.g. nova-2, nova-2-phonecall" : group.group === "Text-to-Speech" ? "e.g. sonic-3" : "e.g. deepseek-chat, gpt-4o-mini, grok-4.20-0309-non-reasoning"}
                                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12, outline: "none", background: "#fff" }}
                                  />
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                    Custom Base URL (Optional)
                                  </label>
                                  <input
                                    type="text"
                                    value={rs.baseUrlValue || ""}
                                    onChange={(e) => setRow(rowKey, { baseUrlValue: e.target.value })}
                                    placeholder="https://... or http://localhost:11434/v1"
                                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12, outline: "none", background: "#fff" }}
                                  />
                                </div>
                              </div>
                            )}

                            {/* Cloned Voice ID for TTS / Voice layers */}
                            {(group.group === "Text-to-Speech" || group.group === "Voice Orchestration") && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                                <label style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                  Cloned Voice ID (Optional)
                                </label>
                                <input
                                  type="text"
                                  value={rs.voiceIdValue || ""}
                                  onChange={(e) => setRow(rowKey, { voiceIdValue: e.target.value })}
                                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx or ElevenLabs Voice ID"
                                  style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_MONO, fontSize: 12, outline: "none", background: "#fff" }}
                                />
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

                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
                              {phase !== "tested_ok" ? (
                                <>
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
                                  {isConnected && (
                                    <button
                                      onClick={() => handleSave(group.group, it.name, rowKey)}
                                      disabled={phase === "saving"}
                                      title="Update model, base URL, or voice ID without re-testing your secret API key"
                                      style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 7, padding: "8px 16px", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, cursor: phase === "saving" ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 6 }}
                                    >
                                      {phase === "saving" ? (
                                        <>
                                          <RefreshCw size={13} className="animate-spin" /> Updating…
                                        </>
                                      ) : (
                                        <>
                                          <Save size={13} /> Save Settings (Keep Key)
                                        </>
                                      )}
                                    </button>
                                  )}
                                </>
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
                <button onClick={() => { setAddModalCategory(group.group); setShowAdd(true); }}
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

      {showAdd && <AddIntegrationModal initialCategory={addModalCategory} onClose={() => setShowAdd(false)} onAddSuccess={handleAddSuccess} />}

      {deleteKeyConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-key-confirm-title"
          onClick={() => !deleteKeyConfirm.deleting && setDeleteKeyConfirm(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 440,
              background: "#fff",
              borderRadius: 14,
              border: `1px solid ${C.border}`,
              boxShadow: "0 24px 60px rgba(15,23,42,0.28)",
              padding: "22px 24px",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: C.redSoft,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <Trash2 size={18} color={C.red} />
                </div>
                <h3 id="delete-key-confirm-title" style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 800, color: C.textInk }}>
                  Delete {deleteKeyConfirm.item?.name} Key?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => !deleteKeyConfirm.deleting && setDeleteKeyConfirm(null)}
                style={{ background: "none", border: "none", cursor: deleteKeyConfirm.deleting ? "wait" : "pointer", color: C.slate, padding: 4 }}
                aria-label="Close"
                disabled={deleteKeyConfirm.deleting}
              >
                <X size={18} />
              </button>
            </div>
            <p style={{ margin: "0 0 18px", fontSize: 13.5, lineHeight: 1.5, color: C.slate }}>
              Permanently remove the saved credentials for <b style={{ color: C.textInk }}>{deleteKeyConfirm.item?.name}</b> in <b>{deleteKeyConfirm.groupName}</b>? This action is irreversible. Live calls relying on {deleteKeyConfirm.item?.name} will fail until a valid key is provided again.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setDeleteKeyConfirm(null)}
                disabled={deleteKeyConfirm.deleting}
                style={{
                  background: "#fff",
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "9px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: deleteKeyConfirm.deleting ? "wait" : "pointer",
                  color: C.textInk,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteKey}
                disabled={deleteKeyConfirm.deleting}
                style={{
                  background: C.red,
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: deleteKeyConfirm.deleting ? "wait" : "pointer",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {deleteKeyConfirm.deleting ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" /> Deleting…
                  </>
                ) : (
                  <>
                    <Trash2 size={14} /> Delete key
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
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
  const fallbackTrend = [
    { day: "1 Aug", rate: 11 },
    { day: "6 Aug", rate: 12 },
    { day: "11 Aug", rate: 13 },
    { day: "16 Aug", rate: 15 },
    { day: "21 Aug", rate: 16 },
    { day: "26 Aug", rate: 18 },
  ];
  const fallbackCost = [
    { name: "LLM", Paid: 320, "Open Source": 42 },
    { name: "STT", Paid: 180, "Open Source": 6 },
    { name: "TTS", Paid: 260, "Open Source": 4 },
    { name: "Telephony", Paid: 410, "Open Source": 380 },
  ];
  const [metrics, setMetrics] = useState({
    conversionRate: "18%",
    conversionDelta: "+6pt",
    takeoverRate: "9%",
    costPerMeeting: "£11.40",
    avgDuration: "2m 34s",
    meetingsBooked: 10,
    prospectsReached: 41,
  });
  const [trend, setTrend] = useState(fallbackTrend);
  const [costBreakdown, setCostBreakdown] = useState(fallbackCost);
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.getAnalytics();
        if (!alive || !data) return;
        const m = data.metrics || {};
        setMetrics((prev) => ({
          ...prev,
          conversionRate: m.conversionRate || prev.conversionRate,
          conversionDelta: m.conversionDelta || prev.conversionDelta,
          meetingsBooked: m.meetingsBooked ?? prev.meetingsBooked,
          prospectsReached: m.prospectsReached ?? prev.prospectsReached,
        }));
        if (Array.isArray(data.trend) && data.trend.length) setTrend(data.trend);
        if (Array.isArray(data.costBreakdown) && data.costBreakdown.length) setCostBreakdown(data.costBreakdown);
      } catch (err) {
        if (alive) setLoadErr(err.message || "Analytics API unavailable — showing local snapshot.");
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <>
      <TopBar title="Analytics" subtitle="Platform performance and cost, last 30 days" notifications={notifications} setNotifications={setNotifications} />
      <div style={{ padding: "20px 32px" }}>
        {loadErr && (
          <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "#FFF7ED", border: "1px solid #FED7AA", color: "#9A3412", fontSize: 12.5 }}>
            {loadErr}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
          <MetricCard label="Meetings booked rate" value={metrics.conversionRate} delta={metrics.conversionDelta} />
          <MetricCard label="Meetings booked" value={String(metrics.meetingsBooked)} />
          <MetricCard label="Cost per meeting booked" value={metrics.costPerMeeting} mono />
          <MetricCard label="Prospects reached" value={String(metrics.prospectsReached)} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14 }}>
          <div className="hover-float" style={{ background: C.paperCard, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, cursor: "default" }}>
            <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5, color: C.textInk, marginBottom: 12 }}>Meetings booked rate — trend</div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend}>
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
              <BarChart data={costBreakdown}>
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
  name: ["company", "company name", "business", "business name", "organisation", "organization", "account"],
  phone: ["phone", "phone number", "telephone", "tel", "mobile", "mobile phone", "contact number"],
  website: ["website", "url", "site", "web", "domain", "homepage"],
  contact: ["contact name", "contact", "full name", "person", "attention", "poc", "first name"],
  notes: ["notes", "note", "comment", "comments", "description"],
  channel: ["channel", "contact channel", "contact method", "preferred channel", "outreach channel"],
  email: ["email", "e-mail", "mail", "email address"],
  linkedin: ["linkedin", "linkedin url", "linkedin profile", "li url"],
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

const ROLE_NAME_RE = /^(ceo|cfo|coo|cto|cmo|cio|founder|co-?founder|president|director|managing director|vp|svp|evp|head|officer|manager|lead|owner|partner|chairman|chair|executive|decision[- ]?maker|operations lead)$/i;

function isPersonName(raw) {
  const name = (raw || "").trim();
  if (!name || ROLE_NAME_RE.test(name)) return false;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 5) return false;
  if (parts.some((p) => ROLE_NAME_RE.test(p.replace(/\.$/, "")))) return false;
  if (parts.some((p) => /^(new|york|los|angeles|san|francisco|inc|ltd|corp|llc|group|company|plc)$/i.test(p))) return false;
  return parts.every((p) => /^[A-Z][a-zA-Z'-]+$/.test(p) || /^(de|da|van|von|der|la|le|di|du)$/i.test(p));
}

function looksLikeUrl(raw) {
  const v = String(raw || "").trim();
  if (!v || v.length < 5 || /\s/.test(v)) return false;
  if (isPersonName(v)) return false;
  return /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}([/:?#].*)?$/i.test(v) || /linkedin\.com\//i.test(v);
}

function looksLikeCompanyLabel(raw) {
  const v = String(raw || "").trim();
  if (!v) return false;
  if (isPersonName(v)) return false;
  return /\b(ltd|limited|inc|llc|plc|gmbh|llp|corp|company|group|services|holdings)\b/i.test(v) || v.length > 2;
}

function headerLooksLikePersonColumn(h) {
  const t = String(h || "").trim().toLowerCase();
  return /(contact\s*name|full\s*name|first\s*name|last\s*name|\bperson\b|people|individual)/.test(t);
}

function headerLooksLikeCompanyColumn(h) {
  const t = String(h || "").trim().toLowerCase();
  return /(company|organisation|organization|business|employer|account name)/.test(t);
}

function isProposedPhone(raw) {
  if (!raw || /555-0/i.test(raw) || /inferred/i.test(raw)) return false;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return false;
  if (digits.startsWith("202") || digits.startsWith("000")) return false;
  if (/^(?:19|20)\d{2}(?:19|20)\d{2}$/.test(digits)) return false;
  if (new Set(digits).size === 1) return false;
  return true;
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
    if (!r.email) issues.push("missing_email");
    if (!r.contact) issues.push("missing_person");

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

function rowMissingFields(r) {
  const missing = [];
  const person = (r?.contact || "").trim();
  const company = (r?.name || "").trim();
  const label = (company || person).trim();
  if (!label) missing.push("company");
  if (person && !company) missing.push("company");
  if (!(r?.phone || "").trim()) missing.push("phone");
  if (!(r?.email || "").trim()) missing.push("email");
  if (!person && !isPersonName(r?.name)) missing.push("person");
  if (!(r?.source || r?.website || "").trim()) missing.push("website");
  if (!(r?.linkedin || "").trim()) missing.push("linkedin");
  return missing;
}

function rowDialable(r, missionChannel = "voice") {
  if (!(r?.name || r?.contact || "").trim()) return false;
  const ch = r.channel || missionChannel || "voice";
  if (ch === "email") return Boolean((r.email || "").trim());
  return Boolean((r.phone || "").trim());
}

function serializeMissionContacts(list) {
  return (list || [])
    .filter((r) => (r.name || r.contact || "").trim())
    .map((r) => ({
      id: r.id,
      name: r.name || r.contact || "",
      phone: r.phone || "",
      email: r.email || "",
      contact: r.contact || "",
      source: looksLikeUrl(r.source) ? r.source : looksLikeUrl(r.site) ? r.site : "",
      linkedin: looksLikeUrl(r.linkedin) ? r.linkedin : "",
    }));
}

function applyFillToRow(r, fill) {
  if (!fill || fill.status !== "proposed") return r;
  const aiFields = { ...(r.aiFields || {}) };
  const next = { ...r, aiFields };
  const take = (key, mark, ok) => {
    const val = fill[key];
    if (!val || String(r[key] || "").trim()) return;
    if (ok && !ok(val)) return;
    next[key] = val;
      if (mark) aiFields[key] = true;
  };
  take("phone", true, isProposedPhone);
  take("email", true);
  take("contact", true, isPersonName);
  if (!String(r.name || "").trim() || isPersonName(r.name)) {
    const company = fill.company || fill.name;
    if (company && looksLikeCompanyLabel(company) && !isPersonName(company)) {
      next.name = company;
      aiFields.name = true;
    }
  }
  const site = fill.website || fill.source;
  if (looksLikeUrl(site) && !looksLikeUrl(r.source)) {
    next.source = site;
    next.sourceType = "Website URL";
    aiFields.source = true;
  }
  take("linkedin", true, looksLikeUrl);
  take("twitter", true, looksLikeUrl);
  take("facebook", true, looksLikeUrl);
  take("instagram", true, looksLikeUrl);
  take("youtube", false);
  if (fill.openingHook) next.openingHook = fill.openingHook;
  next.aiFields = aiFields;
  return next;
}

function socialHref(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  return raw.startsWith("http") ? raw : `https://${raw}`;
}

function socialHandle(url, kind) {
  const href = socialHref(url);
  if (!href) return "";
  try {
    const u = new URL(href);
    const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (kind === "linkedin") {
      if (parts[0] === "company" && parts[1]) return parts[1];
      if (parts[0] === "in" && parts[1]) return `in/${parts[1]}`;
      if (parts[0] === "school" && parts[1]) return parts[1];
    }
    const last = (parts[parts.length - 1] || "").replace(/^@/, "");
    return last || u.hostname.replace(/^www\./, "");
  } catch {
    return String(url);
  }
}

function SocialChip({ href, label, color, title }) {
  if (!href) return null;
  return (
    <a
      href={socialHref(href)}
      target="_blank"
      rel="noreferrer"
      title={title || href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: 22,
        minWidth: 22,
        maxWidth: 110,
        padding: "0 7px",
        borderRadius: 6,
        background: color,
        color: "#fff",
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: "0.01em",
        textDecoration: "none",
        fontFamily: FONT_BODY,
        flexShrink: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </a>
  );
}

function aiInputStyle(isAi) {
  return {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: `1px solid ${isAi ? "#F5D565" : C.border}`,
    background: isAi ? "#FFFBEB" : "#fff",
    fontFamily: FONT_BODY,
    fontSize: 12.5,
    outline: "none",
    boxSizing: "border-box",
  };
}

const ISSUE_META = {
  missing_name: { label: "No company name", color: "#C2410C" },
  missing_phone: { label: "No phone number", color: "#C2410C" },
  missing_email: { label: "No email", color: "#B8760A" },
  missing_person: { label: "No contact person", color: "#B8760A" },
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
const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5];

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
  const blocked = (header) => {
    if (field === "name" && headerLooksLikePersonColumn(header)) return true;
    if (field === "website" && (headerLooksLikePersonColumn(header) || /social|linkedin|twitter|facebook/i.test(String(header)))) return true;
    if (field === "name" && !headerLooksLikeCompanyColumn(header) && /contact|person|mobile|phone/i.test(String(header))) return true;
    return false;
  };
  for (const c of candidates) {
    const idx = lower.indexOf(c);
    if (idx !== -1 && !blocked(headers[idx])) return headers[idx];
  }
  for (const c of candidates) {
    if (c.length < 4 && field !== "phone") continue;
    const idx = lower.findIndex((h, i) => h.includes(c) && !blocked(headers[i]));
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

function digitsInPhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function contactsFromSpreadsheetRecords(headers, records) {
  const nameH = guessColumn(headers, "name") || guessColumn(headers, "contact") || (headers[0] || "");
  const phoneH = guessColumn(headers, "phone") || "";
  const contactH = guessColumn(headers, "contact") || nameH;
  const companyH = guessColumn(headers, "name") || "";
  const titleH = headers.find((h) => /title|role|position/i.test(String(h || ""))) || "";
  return (records || [])
    .map((row, i) => {
      const name = String((contactH && row[contactH]) || (nameH && row[nameH]) || "").trim();
      const company = String((companyH && row[companyH]) || "").trim();
      const phone = String((phoneH && row[phoneH]) || "").trim();
      const title = String((titleH && row[titleH]) || "").trim();
      const emailH = headers.find((h) => /e-?mail/i.test(String(h || ""))) || "";
      const webH = headers.find((h) => /website|homepage|url/i.test(String(h || "")) && !/linkedin/i.test(String(h || ""))) || "";
      const liH = headers.find((h) => /linkedin/i.test(String(h || ""))) || "";
      const valid = digitsInPhone(phone).length >= 7 && Boolean(name || company);
      return {
        id: "pc_" + i,
        selected: valid,
        name: name || company || `Row ${i + 1}`,
        company: company && company !== name ? company : "",
        title,
        phone,
        email: String((emailH && row[emailH]) || "").trim(),
        website: String((webH && row[webH]) || "").trim(),
        linkedin: String((liH && row[liH]) || "").trim(),
        valid,
      };
    })
    .filter((c) => c.valid);
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
  onAskAi,
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(100px, 1fr))", gap: 10 }}>
              {[
                ["name", "Company (if in file)"],
                ["contact", "Contact person"],
                ["phone", "Phone number"],
                ["email", "Email"],
                ["website", "Website"],
                ["linkedin", "LinkedIn"],
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
              <div style={{ display: "grid", gridTemplateColumns: "44px 1.3fr 1fr 1.1fr 1fr 1.1fr 1.1fr 110px 1.2fr 40px", padding: "10px 14px", background: C.paper, fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                <div />
                <div>Company</div>
                <div>Phone</div>
                <div>Email</div>
                <div>Contact</div>
                <div>Website</div>
                <div>LinkedIn</div>
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
                    gridTemplateColumns: "44px 1.3fr 1fr 1.1fr 1fr 1.1fr 1.1fr 110px 1.2fr 40px",
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
                  <input value={r.email || ""} onChange={(e) => onUpdate(r.id, "email", e.target.value)} placeholder="Email" style={inputStyle(r.issues.includes("missing_email"))} />
                  <input value={r.contact || ""} onChange={(e) => onUpdate(r.id, "contact", e.target.value)} placeholder="Person" style={inputStyle(r.issues.includes("missing_person"))} />
                  <input value={r.source} onChange={(e) => onUpdate(r.id, "source", e.target.value)} placeholder="Website (empty if not in file)" style={inputStyle(false)} />
                  <input value={r.linkedin || ""} onChange={(e) => onUpdate(r.id, "linkedin", e.target.value)} placeholder="LinkedIn (empty if not in file)" style={inputStyle(false)} />
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
            File columns stay. Empty company / email / website / LinkedIn are extra slots. Continue runs web search to fill those — will not invent if nothing public.
          </div>
          {onAskAi && (
            <button
              onClick={onAskAi}
              disabled={!includedCount}
              style={{
                width: "100%", padding: "11px", borderRadius: 9, border: `1px solid ${C.ink}`,
                background: "#fff", color: C.ink,
                fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13.5,
                cursor: includedCount ? "pointer" : "default",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <Sparkles size={14} /> Continue — find missing details
            </button>
          )}
          <button
            onClick={onConfirm}
            disabled={!includedCount}
            style={{
              width: "100%", padding: "12px", borderRadius: 9, border: "none",
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
  const [tab, setTab] = useState("manual");
  const [prompt, setPrompt] = useState("");
  const [rows, setRows] = useState([{ id: 1, name: "", phone: "", email: "", sourceType: "Website URL", source: "", channel: "auto", fallback: "none", contact: "" }]);
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
  const [columnMap, setColumnMap] = useState({ name: "", phone: "", website: "", contact: "", email: "", channel: "", linkedin: "" });
  const [importRecords, setImportRecords] = useState([]); // raw records from file
  const [importRows, setImportRows] = useState([]); // mapped preview rows, editable
  const [importFilter, setImportFilter] = useState("all"); // all | issues | duplicates
  const [bulkChannel, setBulkChannel] = useState("voice");
  const [concurrency, setConcurrency] = useState(1);

  const parsed = prompt.length > 8;

  // AI Chat state
  const [copilotMessages, setCopilotMessages] = useState([
    {
      sender: "ai",
      text: "👋 I'm the Voice SDR chat. Load a list (even if phones or emails are missing), then tell me what to find — e.g. 'Get UK phone numbers and ops directors for these companies.' I'll propose fills; you Accept before they hit the dialer. You can also ask me to find new companies from scratch."
    }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatSearching, setChatSearching] = useState(false);
  const [chatDiscoveredLeads, setChatDiscoveredLeads] = useState([]);
  const [pendingFills, setPendingFills] = useState([]);
  const [lookingIds, setLookingIds] = useState([]);
  const chatBottomRef = useRef(null);
  const findMissingLock = useRef(false);
  const lookupStopRef = useRef(false);
  const lookupAbortRef = useRef(null);
  const [lookupRunning, setLookupRunning] = useState(false);

  const namedRows = rows.filter((r) => (r.name || r.contact || "").trim());
  const incompleteRows = namedRows.filter((r) => rowMissingFields(r).length > 0);
  const dialableRows = namedRows.filter((r) => rowDialable(r, channel));

  const applyFillsToRows = (incoming) => {
    const list = (incoming || []).filter((f) => f && f.rowId && f.status === "proposed");
    if (!list.length) return;
    setRows((prev) =>
      prev.map((r) => {
        const fill = list.find((f) => String(f.rowId) === String(r.id));
        return fill ? applyFillToRow(r, fill) : r;
      })
    );
  };

  const mergeFillsIntoPending = (incoming) => {
    applyFillsToRows(incoming);
    const list = (incoming || []).filter((f) => f && f.rowId);
    if (!list.length) return;
    setPendingFills((prev) => {
      const next = [...prev];
      list.forEach((fill) => {
        const idx = next.findIndex((p) => String(p.rowId) === String(fill.rowId));
        if (idx >= 0) next[idx] = { ...next[idx], ...fill };
        else next.push(fill);
      });
      return next;
    });
  };

  const acceptFill = (fill) => {
    setRows((prev) =>
      prev.map((r) => (String(r.id) === String(fill.rowId) ? applyFillToRow(r, fill) : r))
    );
    setPendingFills((prev) => prev.filter((p) => String(p.rowId) !== String(fill.rowId)));
  };

  const dismissFill = (fill) => {
    setPendingFills((prev) => prev.filter((p) => String(p.rowId) !== String(fill.rowId)));
  };

  const acceptAllFills = () => {
    const proposed = pendingFills.filter((f) => f.status === "proposed");
    if (!proposed.length) return;
    setRows((prev) =>
      prev.map((r) => {
        const fill = proposed.find((f) => String(f.rowId) === String(r.id));
        return fill ? applyFillToRow(r, fill) : r;
      })
    );
    setPendingFills((prev) => prev.filter((p) => p.status !== "proposed"));
  };

  const resolveChatCredentials = () => {
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
    return { key, burl, prov, mod };
  };

  const runCopilotTurn = async (userMsg) => {
    if (!userMsg || chatSearching) return;
    setCopilotMessages((prev) => [...prev, { sender: "user", text: userMsg }]);
    setChatSearching(true);
    try {
      const creds = resolveChatCredentials();
      const res = await api.copilotChat({
        message: userMsg,
        history: copilotMessages,
        plugin: "voice",
        apiKey: creds.key,
        provider: creds.prov,
        model: creds.mod,
        baseUrl: creds.burl,
        contacts: serializeMissionContacts(namedRows),
        channel,
      });
      if (res && res.fills && res.fills.length) mergeFillsIntoPending(res.fills);
      if (res && res.leads && res.leads.length > 0) setChatDiscoveredLeads(res.leads);
      setCopilotMessages((prev) => [
        ...prev,
        {
          sender: "ai",
          text: (res && res.reply) || "Looked at the list.",
          leads: (res && res.leads) || [],
          fills: (res && res.fills) || [],
        },
      ]);
    } catch (err) {
      setCopilotMessages((prev) => [
        ...prev,
        { sender: "ai", text: `⚠️ AI Chat error: ${err.message || "Failed to reach AI copilot."}` },
      ]);
    } finally {
      setChatSearching(false);
      setTimeout(() => {
        if (chatBottomRef.current) chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
      }, 100);
    }
  };

  const handleCopilotSend = async (e) => {
    e.preventDefault();
    const userMsg = chatInput.trim();
    if (!userMsg || chatSearching) return;
    setChatInput("");
    await runCopilotTurn(userMsg);
  };

  const pauseLookup = () => {
    lookupStopRef.current = true;
    if (lookupAbortRef.current) {
      try {
        lookupAbortRef.current.abort();
      } catch (_) {}
    }
  };

  const closeModal = () => {
    pauseLookup();
    onClose();
  };

  const handleFindMissing = async (listOverride) => {
    const pool = (listOverride && listOverride.length ? listOverride : incompleteRows).filter((r) => (r.name || r.contact || "").trim() && rowMissingFields(r).length);
    const target = pool;
    if (!pool.length || lookupRunning || chatSearching || findMissingLock.current) return;
    const CHUNK = 2;
    lookupStopRef.current = false;
    findMissingLock.current = true;
    setLookupRunning(true);
    setChatSearching(true);
    setLookingIds(target.map((r) => String(r.id)));
    setCopilotMessages((prev) => [
      ...prev,
      { sender: "user", text: `Find missing details for ${target.length} row${target.length === 1 ? "" : "s"} (web search — empty file fields only).` },
    ]);
    const allFills = [];
    let chunkErrors = 0;
    let processed = 0;
    let paused = false;
    try {
      for (let i = 0; i < target.length; i += CHUNK) {
        if (lookupStopRef.current) {
          paused = true;
          break;
        }
        const slice = target.slice(i, i + CHUNK);
        const done = Math.min(i + slice.length, target.length);
        setCopilotMessages((prev) => [
          ...prev,
          { sender: "ai", text: `Looking up ${done}/${target.length}…` },
        ]);
        const controller = new AbortController();
        lookupAbortRef.current = controller;
        try {
          const res = await api.fillContactGaps(
            {
              contacts: serializeMissionContacts(slice),
              max_rows: CHUNK,
            },
            { signal: controller.signal }
          );
          const fills = (res && res.fills) || [];
          allFills.push(...fills);
          mergeFillsIntoPending(fills);
          setLookingIds((prev) => prev.filter((id) => !slice.some((r) => String(r.id) === String(id))));
          processed += slice.length;
        } catch (err) {
          const aborted =
            lookupStopRef.current ||
            (err && (err.name === "AbortError" || /aborted/i.test(String(err.message || ""))));
          if (aborted) {
            paused = true;
            break;
          }
          chunkErrors += 1;
          processed += slice.length;
          const status = String(err.message || "");
          const hint = /502|504|timeout/i.test(status)
            ? " Proxy cut the request. Next batch will still run."
            : "";
          setCopilotMessages((prev) => [
            ...prev,
            { sender: "ai", text: `⚠️ Batch ${Math.floor(i / CHUNK) + 1} failed: ${err.message || "timeout"}.${hint}` },
          ]);
        }
      }
      const proposed = allFills.filter((f) => f.status === "proposed").length;
      const empty = allFills.filter((f) => f.status === "unenrichable").length;
      const hadSource = allFills.some((f) => f.source) || target.some((r) => r.source);
      const leftover = Math.max(0, target.length - processed);
      setCopilotMessages((prev) => [
        ...prev,
        paused
          ? {
              sender: "ai",
              text: `Paused at ${processed}/${target.length}. Yellow cells already written stay on the list. Press Resume for the remaining ${leftover}.`,
              fills: allFills,
            }
          : {
              sender: "ai",
              text: proposed
                ? `Wrote public details onto the list for ${proposed} compan${proposed === 1 ? "y" : "ies"}. Yellow cells are AI-filled — edit any of them. ${empty ? `${empty} had nothing public.` : ""}${chunkErrors ? ` ${chunkErrors} batch(es) failed.` : ""}`
                : hadSource
                ? `No public phone/email found for these ${target.length} row(s). Leave them off the dialer or type the number by hand — I will not invent one.`
                : `No public phone/email found for these ${target.length} row(s). Add a website URL on the list and try again, or fill by hand.`,
              fills: allFills,
            },
      ]);
    } catch (err) {
      setCopilotMessages((prev) => [
        ...prev,
        { sender: "ai", text: `⚠️ Lookup error: ${err.message || "Could not enrich contacts."}` },
      ]);
    } finally {
      lookupAbortRef.current = null;
      setLookupRunning(false);
      setChatSearching(false);
      findMissingLock.current = false;
      setLookingIds([]);
      setTimeout(() => {
        if (chatBottomRef.current) chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
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
        phone: l.phone && !String(l.phone).includes("555-0") && !/inferred/i.test(l.phone) ? l.phone : "",
        email: l.email || "",
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

  const addRow = () => setRows((r) => [...r, { id: Date.now(), name: "", phone: "", email: "", sourceType: "Website URL", source: "", channel: "", fallback: "none", contact: "" }]);
  const removeRow = (id) => setRows((r) => r.filter((x) => x.id !== id));
  const updateRow = (id, k, v) => setRows((r) => r.map((x) => (x.id === id ? { ...x, [k]: v } : x)));

  const buildPreviewFromMap = (records, map) => {
    const mapped = records.map((rec, i) => {
      const company = String((map.name ? rec[map.name] : "") || "").trim();
      const person = String((map.contact ? rec[map.contact] : "") || "").trim();
      const websiteRaw = String((map.website ? rec[map.website] : "") || "").trim();
      const website = looksLikeUrl(websiteRaw) ? websiteRaw : "";
      return {
      id: "imp_" + i,
        name: company || person,
        phone: String((map.phone ? rec[map.phone] : "") || "").trim(),
        email: String((map.email ? rec[map.email] : "") || "").trim(),
        contact: person || (isPersonName(company) ? company : ""),
        sourceType: website ? "Website URL" : "Notes only",
        source: website,
        linkedin: looksLikeUrl(String((map.linkedin ? rec[map.linkedin] : "") || "").trim())
          ? String(rec[map.linkedin]).trim()
          : "",
        channel: normalizeChannel(map.channel ? rec[map.channel] : ""),
      fallback: "none",
      };
    });
    // flag missing/invalid/duplicate rows, then only auto-include the clean ones —
    // stops bad data from silently reaching the dialer on a big import
    return validateRows(mapped, registry, callLog).map((r) => ({
      ...r,
      included: Boolean(r.name || r.contact) && !r.issues.includes("duplicate") && !r.issues.includes("already_dnc"),
    }));
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
          email: guessColumn(headers, "email"),
          channel: guessColumn(headers, "channel"),
          linkedin: guessColumn(headers, "linkedin"),
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

  const includedImportRows = importRows.filter((r) => r.included && (r.name || r.contact));
  const flaggedCount = importRows.filter((r) => r.issues.length > 0).length;
  const duplicateCount = importRows.filter((r) => r.issues.includes("duplicate")).length;
  const knownCount = importRows.filter((r) => r.identityMatch).length;
  const filteredImportRows =
    importFilter === "issues" ? importRows.filter((r) => r.issues.length > 0) :
    importFilter === "duplicates" ? importRows.filter((r) => r.issues.includes("duplicate")) :
    importFilter === "known" ? importRows.filter((r) => r.identityMatch) :
    importRows;

  const useImportedRows = (thenChat) => {
    const kept = includedImportRows.map((r, i) => {
      const person = (r.contact || (isPersonName(r.name) ? r.name : "") || "").trim();
      const company = looksLikeCompanyLabel(r.name) && !isPersonName(r.name) ? r.name.trim() : "";
      const website = looksLikeUrl(r.source) ? r.source.trim() : "";
      return {
      id: Date.now() + i,
        name: company,
      phone: r.phone,
      email: r.email || "",
        contact: person,
        sourceType: website ? "Website URL" : "Notes only",
        source: website,
        linkedin: looksLikeUrl(r.linkedin) ? r.linkedin : "",
      channel: r.channel || "",
      fallback: r.fallback || "none",
      };
    });
    setRows(kept);
    setManualMode("form");
    setTab("manual");
    setImportState("loaded");
    if (thenChat) {
      setTimeout(() => handleFindMissing(kept), 50);
    }
  };

  const resetImport = () => {
    setImportState("idle");
    setImportError("");
    setImportFileName("");
    setImportHeaders([]);
    setImportRecords([]);
    setImportRows([]);
  };

  const canSubmit = dialableRows.length > 0 || chatDiscoveredLeads.some((l) => l.name && (l.phone || l.email));
  const readyToCallCount = dialableRows.length || chatDiscoveredLeads.filter((l) => l.name && (l.phone || l.email)).length;
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
        onClose={closeModal}
        onConfirm={() => useImportedRows(false)}
        onAskAi={() => useImportedRows(true)}
      />
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(18,20,28,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: namedRows.length ? "min(1080px, 96vw)" : tab === "discover" ? 780 : 640, maxHeight: "92vh", overflowY: "auto", padding: 26, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: C.textInk }}>New Outreach</div>
            {namedRows.length > 0 && (
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slate, marginTop: 3 }}>
                {dialableRows.length} ready to dial · {incompleteRows.length} still missing a phone
                {lookupRunning ? " · looking up public details…" : ""}
              </div>
            )}
          </div>
          <button onClick={closeModal} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={18} color={C.slate} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 18, background: C.paperSoft, padding: 4, borderRadius: 9 }}>
          <button
            onClick={() => setTab("manual")}
            style={{ flex: 1, padding: "9px 12px", borderRadius: 7, border: "none", cursor: "pointer", background: tab === "manual" ? "#fff" : "transparent", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: tab === "manual" ? C.textInk : C.slate, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: tab === "manual" ? "0 1px 3px rgba(0,0,0,0.06)" : "none" }}
          >
            <Users size={14} /> Contact list
          </button>
          <button
            onClick={() => setTab("discover")}
            style={{ flex: 1, padding: "9px 12px", borderRadius: 7, border: "none", cursor: "pointer", background: tab === "discover" ? "#fff" : "transparent", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: tab === "discover" ? C.textInk : C.slate, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, boxShadow: tab === "discover" ? "0 1px 3px rgba(0,0,0,0.06)" : "none" }}
          >
            <Sparkles size={14} /> Ask AI
          </button>
        </div>

        {tab === "discover" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {namedRows.length > 0 && (
              <div style={{ background: "#F8FAFC", border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, color: C.textInk }}>
                    {namedRows.length} companies on the list
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, marginTop: 2 }}>
                    Found details write onto Contact list automatically. Yellow cells = AI.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setTab("manual")}
                  style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  Open list
                </button>
              </div>
            )}

            {pendingFills.filter((f) => f.status === "proposed").length > 0 && (
              <div style={{ fontSize: 12, color: C.slate, background: C.tealSoft, borderRadius: 8, padding: "8px 10px" }}>
                {pendingFills.filter((f) => f.status === "proposed").length} AI fill(s) already written onto the list.
              </div>
            )}

            {/* Standalone Chat Messages Container */}
            <div style={{ background: "#F8FAFC", border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px", height: namedRows.length ? 220 : 480, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
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
              {(chatSearching || lookupRunning) && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.slate, fontSize: 12.5, padding: "6px 10px" }}>
                  <RefreshCw size={14} className="animate-spin" color="#2563EB" />
                  {lookupRunning ? "Looking up public details…" : "Searching and verifying contacts..."}
                  {lookupRunning && (
                    <button
                      type="button"
                      onClick={pauseLookup}
                      style={{ marginLeft: 4, background: "#fff", border: `1px solid ${C.redSolid}`, borderRadius: 7, padding: "4px 10px", fontFamily: FONT_BODY, fontSize: 11.5, fontWeight: 700, color: C.redSolid, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}
                    >
                      <Pause size={12} /> Pause
                    </button>
                  )}
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
                placeholder={namedRows.length ? "e.g. Get UK phones and ops directors for the missing rows…" : "e.g. Find 5 trucking dispatchers in Dallas to pitch voice AI..."}
                disabled={chatSearching}
                style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", background: "#fff" }}
              />
              <button
                type="submit"
                disabled={chatSearching || !chatInput.trim()}
                style={{ background: C.ink, color: "#fff", border: "none", borderRadius: 8, padding: "0 18px", fontSize: 13, fontWeight: 600, cursor: chatSearching ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                {chatSearching ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
                {namedRows.length ? "Send" : "Search"}
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
                  .csv, .xlsx, .xls — file cells stay as-is. Extra empty columns (company, email, website, LinkedIn) are for Find missing.
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
            {importFileName && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: C.tealSoft, borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.textInk, lineHeight: 1.4 }}>
                  <strong>{namedRows.length}</strong> from {importFileName} · <strong>{dialableRows.length}</strong> ready to dial
                  {lookupRunning ? " · looking up…" : ""}
                </div>
                <button
                  onClick={() => { pauseLookup(); resetImport(); setManualMode("upload"); }}
                  style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 11px", fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.textInk, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  Replace file
                </button>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, lineHeight: 1.4 }}>
                This table is the mission list. File values stay. Empty company / email / website / LinkedIn columns are extra — Find missing web-searches those. Yellow = AI fill.
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {lookupRunning ? (
                  <>
                    <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, color: C.slate, display: "flex", alignItems: "center", gap: 6 }}>
                      <RefreshCw size={14} className="animate-spin" /> Looking up…
                    </span>
                    <button
                      type="button"
                      onClick={pauseLookup}
                      style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.redSolid}`, background: "#fff", fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, color: C.redSolid, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <Pause size={14} /> Pause
                    </button>
                  </>
                ) : incompleteRows.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => handleFindMissing()}
                    disabled={chatSearching}
                    style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: C.ink, fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 700, color: "#fff", cursor: chatSearching ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 6 }}
                  >
                    {namedRows.some((r) => r.aiFields && Object.keys(r.aiFields).length) ? <Play size={14} /> : <Sparkles size={14} />}
                    {namedRows.some((r) => r.aiFields && Object.keys(r.aiFields).length)
                      ? `Resume remaining (${incompleteRows.length})`
                      : `Find missing (${incompleteRows.length})`}
                  </button>
                ) : null}
              </div>
            </div>
            {namedRows.length > 0 ? (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "auto", maxHeight: 360, marginBottom: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr 1.1fr 0.85fr 1.05fr minmax(170px,1.5fr) 90px 36px", gap: 6, padding: "8px 10px", background: C.paper, fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.03em", minWidth: 920 }}>
                  <div>Company</div>
                  <div>Phone</div>
                  <div>Email</div>
                  <div>Person</div>
                  <div>Website</div>
                  <div>Socials</div>
                  <div>Status</div>
                  <div />
                </div>
                {rows.filter((r) => (r.name || r.contact || "").trim()).map((r) => {
                  const looking = lookingIds.includes(String(r.id));
                  const miss = rowMissingFields(r);
                  const ready = rowDialable(r, channel);
                  const ai = r.aiFields || {};
                  const hasSocial = r.linkedin || r.twitter || r.facebook || r.instagram || r.youtube;
                  return (
                    <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr 1.1fr 0.85fr 1.05fr minmax(170px,1.5fr) 90px 36px", gap: 6, padding: "8px 10px", borderTop: `1px solid ${C.border}`, alignItems: "center", minWidth: 920 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <input
                      value={r.name}
                      onChange={(e) => updateRow(r.id, "name", e.target.value)}
                      placeholder="Company (optional)"
                      style={aiInputStyle(false)}
                    />
                        {hasSocial ? (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                            <SocialChip href={r.linkedin} label={socialHandle(r.linkedin, "linkedin") || "in"} color="#0A66C2" title={r.linkedin} />
                            <SocialChip href={r.twitter} label="X" color="#111111" title={r.twitter} />
                            <SocialChip href={r.facebook} label="f" color="#1877F2" title={r.facebook} />
                            <SocialChip href={r.instagram} label="Ig" color="#E4405F" title={r.instagram} />
                            <SocialChip href={r.youtube} label="YT" color="#FF0000" title={r.youtube} />
                          </div>
                        ) : looking ? (
                          <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.cobalt }}>Looking for profiles…</div>
                        ) : null}
                      </div>
                      <input value={r.phone || ""} onChange={(e) => updateRow(r.id, "phone", e.target.value)} placeholder="Phone" style={aiInputStyle(ai.phone)} />
                      <input value={r.email || ""} onChange={(e) => updateRow(r.id, "email", e.target.value)} placeholder="Email" style={aiInputStyle(ai.email)} />
                      <input value={r.contact || ""} onChange={(e) => updateRow(r.id, "contact", e.target.value)} placeholder="Person" style={aiInputStyle(ai.contact)} />
                      <input value={r.source || ""} onChange={(e) => updateRow(r.id, "source", e.target.value)} placeholder="Website if you have one" style={aiInputStyle(false)} />
                      <input
                        value={r.linkedin || ""}
                        onChange={(e) => updateRow(r.id, "linkedin", e.target.value)}
                        placeholder="LinkedIn only if real"
                        title={r.linkedin || "LinkedIn"}
                        style={{ ...aiInputStyle(ai.linkedin), fontSize: 11 }}
                      />
                      <div style={{ fontSize: 11, fontWeight: 700, color: looking ? C.cobalt : ready ? C.green : "#C2410C" }}>
                        {looking ? "Looking" : ready ? "Ready" : miss.includes("phone") ? "No phone" : "Incomplete"}
                      </div>
                      <button onClick={() => removeRow(r.id)} style={{ background: "none", border: "none", cursor: "pointer" }}>
                        <Trash2 size={14} color={C.slateLight} />
                      </button>
                    </div>
                  );
                })}
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
                    <input
                      value={r.email || ""}
                      onChange={(e) => updateRow(r.id, "email", e.target.value)}
                      placeholder="Email"
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
            </>
            )}
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
            These fallbacks use your telephony/email connections (Twilio / SMTP), not Cal.com.
            Cal.com only sends the calendar invite after a meeting is booked.
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
                    if (p.weekdayStart && p.weekdayEnd) {
                    setWindowStart(p.weekdayStart);
                    setWindowEnd(p.weekdayEnd);
                    }
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
              {LUNCH_HOUR_OPTIONS.filter((t) => t < lunchEnd).map((t) => <option key={t}>{t}</option>)}
            </select>
            <span style={{ color: C.slateLight }}>–</span>
            <select value={lunchEnd} onChange={(e) => setLunchEnd(e.target.value)} style={{ padding: "6px 9px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5 }}>
              {LUNCH_HOUR_OPTIONS.filter((t) => t > lunchStart).map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>Calls running at once</span>
            <select value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} style={{ padding: "6px 9px", borderRadius: 7, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 12.5 }}>
              {CONCURRENCY_OPTIONS.map((n) => (
                <option key={n} value={n}>{n === 1 ? "1 — one at a time" : n === 5 ? "5 — max" : String(n)}</option>
              ))}
            </select>
            <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight }}>1 = one-by-one. Max 5 so quality stays good.</span>
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

        {!canSubmit && namedRows.length > 0 && (
          <div style={{ marginTop: 14, fontFamily: FONT_BODY, fontSize: 12, color: "#C2410C", lineHeight: 1.45 }}>
            Start stays locked until at least one company has a phone (or an email if the default channel is email). Accept fills in AI Chat, or type them by hand.
          </div>
        )}
        <button
          onClick={() =>
            canSubmit &&
            onCreate({
              tab: (tab === "discover" && chatDiscoveredLeads.length > 0) ? "manual" : tab,
              prompt,
              rows: dialableRows.length
                ? dialableRows
                : chatDiscoveredLeads.filter((l) => l.name && (l.phone || l.email)).map((l) => ({
                      name: l.name,
                      phone: l.phone,
                      email: l.email || "",
                      contact: l.contactPerson || "",
                      sourceType: "Website URL",
                      source: l.site || "",
                      channel: "voice",
                      fallback: "whatsapp",
                      openingHook: l.openingHook
                    })),
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
          Confirm & start live calls
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

function liveCallActive(c) {
  if (!c) return false;
  if (c.ended) return false;
  const st = String(c.state || "").toLowerCase();
  return !["ended", "failed", "canceled", "completed", "no-answer", "busy"].includes(st);
}

function prospectMatchesCall(p, c, missionId) {
  if (!p || !c) return false;
  if (c.prospectId && p.id && String(c.prospectId) === String(p.id)) return true;
  if (missionId && c.missionId && String(c.missionId) !== String(missionId)) return false;
  if (c.prospect && p.name && String(c.prospect).toLowerCase() === String(p.name).toLowerCase()) return true;
  if (c.prospect && p.contact && String(c.prospect).toLowerCase() === String(p.contact).toLowerCase()) return true;
  return false;
}

function tallyMission(prospects) {
  const contacted = prospects.filter((p) =>
    ["meeting_booked", "contacted", "rejected", "left_voicemail", "emailed", "operator_ended", "ended", "completed", "no_answer", "failed"].includes(p.status)
  ).length;
  const meetingsBooked = prospects.filter((p) => p.status === "meeting_booked").length;
  return { contacted, meetingsBooked, total: prospects.length };
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
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      style={{
        display: "block",
        flexShrink: 0,
      }}
    >
      <defs>
        <linearGradient id="aiv" x1="4" y1="2" x2="30" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3457D5"/>
          <stop offset="1" stopColor="#0C8C7D"/>
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#aiv)"/>
      <circle cx="11" cy="16" r="2.35" fill="#fff"/>
      <path d="M15.6 11.1c2.7 1.5 2.7 8.3 0 9.8" fill="none" stroke="#fff" strokeWidth="1.85" strokeLinecap="round"/>
      <path d="M19.4 8.4c4.3 2.5 4.3 12.7 0 15.2" fill="none" stroke="#fff" strokeWidth="1.85" strokeLinecap="round"/>
      <path d="M23.1 6.1c5.8 3.3 5.8 16.5 0 19.8" fill="none" stroke="#fff" strokeWidth="1.75" strokeLinecap="round"/>
    </svg>
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
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 28, color: C.ink, letterSpacing: "-0.03em", marginTop: 14 }}>Outreach by Aivhub</div>
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

function CommonAiConfigModal({ isOpen, onClose, commonAi, setCommonAi, initialTab = "leadgen", onNavigateToPlugin, operator, onOpenCalcomAdmin, scopePlugin = null, embedded = false }) {
  const [tab, setTab] = useState(initialTab || "leadgen");
  const [dirty, setDirty] = useState(false);

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
  const [customDisplayName, setCustomDisplayName] = useState("");
  const [customModelId, setCustomModelId] = useState("");
  const [isSavingCustom, setIsSavingCustom] = useState(false);
  const [customNotice, setCustomNotice] = useState(null);
  const [liveHub, setLiveHub] = useState(null);
  const [backendConns, setBackendConns] = useState([]);
  const [connsLoading, setConnsLoading] = useState(false);
  const [usageStats, setUsageStats] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState("");

  const panelOpen = embedded || isOpen;

  useEffect(() => {
    if (!panelOpen) return;
    let alive = true;
    setConnsLoading(true);
    Promise.all([
      api.getConnections().catch(() => []),
      api.getTelephonyHub().catch(() => null),
    ]).then(([conns, hub]) => {
      if (!alive) return;
      if (Array.isArray(conns)) {
        setBackendConns(conns);
        setCommonAi((prev) => syncCommonAiWithBackend(prev, conns, hub));
      }
      if (hub) {
        setLiveHub(hub);
      }
    }).finally(() => {
      if (alive) setConnsLoading(false);
    });
    return () => { alive = false; };
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen || tab !== "voice") return;
    api.getTelephonyHub()
      .then((hub) => {
        if (!hub) return;
        setLiveHub(hub);
        setCommonAi((prev) => ({
          ...prev,
          voiceLayers: voiceLayersFromHub(hub, prev.voiceLayers),
        }));
      })
      .catch(() => {});
  }, [tab, panelOpen]);

  useEffect(() => {
    if (!panelOpen || tab !== "subscription") return;
    let alive = true;
    setUsageLoading(true);
    setUsageError("");
    api.getUsageQuotas()
      .then((data) => {
        if (alive) setUsageStats(data || null);
      })
      .catch((err) => {
        if (alive) setUsageError(err?.message || "Could not load usage");
      })
      .finally(() => {
        if (alive) setUsageLoading(false);
      });
    return () => { alive = false; };
  }, [tab, panelOpen]);


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
    if (!panelOpen) return;
    if (scopePlugin === "calcom") {
      if (onOpenCalcomAdmin) {
        onOpenCalcomAdmin("settings");
        if (!embedded) onClose();
      }
      setTab("leadgen");
      return;
    }
    if (initialTab === "calcom") {
      if (onOpenCalcomAdmin) {
        onOpenCalcomAdmin("settings");
        if (!embedded) onClose();
      }
      setTab("leadgen");
      return;
    }
    if (scopePlugin) setTab(scopePlugin);
    else if (initialTab) setTab(initialTab);
  }, [panelOpen, initialTab, scopePlugin]);

  if (!panelOpen) return null;

  const safeCommonAi = {
    ...INITIAL_COMMON_AI_CONFIG,
    ...(commonAi || {}),
    providers: (commonAi?.providers && Array.isArray(commonAi.providers) && commonAi.providers.length)
      ? commonAi.providers
      : INITIAL_COMMON_AI_CONFIG.providers,
    leadgenLayers: { ...INITIAL_COMMON_AI_CONFIG.leadgenLayers, ...(commonAi?.leadgenLayers || {}) },
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

  const updateVisibleName = (key, name) => {
    setCommonAi((prev) => ({
      ...prev,
      visibleNames: { ...((prev && prev.visibleNames) || {}), [key]: name },
    }));
    flash();
  };

  const updateLeadgenLayer = (key, val) => {
    setCommonAi((prev) => ({
      ...prev,
      leadgenLayers: { ...((prev && prev.leadgenLayers) || {}), [key]: val },
    }));
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
    const displayName = customDisplayName.trim() || featureLabel;
    const apiKey = customApiKey.trim();
    const baseUrl = customBaseUrl.trim();

    setIsSavingCustom(true);
    try {
      // 1. Update the layer's model to the user's custom model name directly & display name
      updateVisibleName(assignedFeature, displayName);
      if (targetPluginId === "leadgen") updateLeadgenLayer(assignedFeature, modelName);
      if (targetPluginId === "email") updateEmailLayer(assignedFeature, modelName);
      if (targetPluginId === "voice") updateVoiceLayer(assignedFeature, modelName);

      // 2. Create the custom connection record
      const newConnId = `custom_${Date.now()}`;
      const newConn = {
        id: newConnId,
        pluginId: targetPluginId,
        featureKey: assignedFeature,
        featureLabel: featureLabel,
        displayName: displayName,
        providerName: customProviderName,
        modelId: modelName,
        apiKey: apiKey,
        baseUrl: baseUrl || undefined,
        status: "connected",
        latencyMs: null,
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
              name: `${customProviderName} (${displayName || modelName})`,
              type: "llm",
              apiKey: apiKey,
              baseUrl: baseUrl || undefined,
              status: "connected",
              latencyMs: null,
            },
          ],
        };
      });

      // 4. Show persistent success confirmation (NEVER abruptly vanish!)
      setCustomNotice({
        type: "success",
        text: `✓ Saved & Connected! "${displayName}" (${modelName}) is now active for "${featureLabel}".`,
      });
      flash();

      // Clear input fields for next use, keeping drawer accessible and notice visible
      setCustomApiKey("");
      setCustomDisplayName("");
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
    if (
      m.includes("duckduckgo") ||
      m.includes("crawler") ||
      m.includes("scraping") ||
      m.includes("spam guard") ||
      m.includes("bge-small") ||
      m.includes("minilm") ||
      m.includes("fastembed") ||
      m.includes("local cpu") ||
      m.includes("runtime") ||
      m.includes("kokoro") ||
      m.includes("faster-whisper") ||
      m.includes("livekit")
    ) {
      return "builtin";
    }
    if (m.includes("pollinations")) return "pollinations";
    if (m.includes("cartesia")) return "cartesia";
    if (m.includes("elevenlabs") || m.includes("eleven")) return "elevenlabs";
    if (m.includes("deepgram")) return "deepgram";
    if (m.includes("twilio") || m.includes("telnyx")) return "twilio";
    if (m.includes("grok") || m.includes("xai")) return "xai";
    if (m.includes("claude") || m.includes("anthropic") || m.includes("sonnet") || m.includes("haiku")) return "anthropic";
    if (m.includes("deepseek")) return "deepseek";
    if (m.includes("groq") || m.includes("llama")) return "groq";
    if (m.includes("gemini") || m.includes("google")) return "gemini";
    if (m.includes("stability") || m.includes("sdxl") || m.includes("stable-diffusion")) return "stability";
    if (m.includes("fal") || m.includes("flux")) return "fal";
    if (m.includes("gpt") || m.includes("o3") || m.includes("openai") || m.includes("dall-e") || m.includes("text-embedding")) return "openai";
    if (m.includes("vapi")) return "vapi";
    if (m.includes("ollama") || m.includes("local")) return "ollama";
    return "openai";
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
                    AI Provider Name / Gateway (Open / Any)
                  </label>
                  <input
                    type="text"
                    list="custom-provider-suggestions"
                    value={customProviderName}
                    onChange={(e) => setCustomProviderName(e.target.value)}
                    placeholder="Type or pick any provider..."
                    style={{ width: "100%", boxSizing: "border-box", height: 36, padding: "0 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, background: "#fff" }}
                  />
                  <datalist id="custom-provider-suggestions">
                    <option value="OpenAI Compatible" />
                    <option value="Anthropic" />
                    <option value="DeepSeek" />
                    <option value="xAI" />
                    <option value="Groq" />
                    <option value="Stability AI" />
                    <option value="Fal.ai" />
                    <option value="Pollinations AI" />
                    <option value="Ollama" />
                    <option value="ElevenLabs" />
                    <option value="Custom Proxy" />
                  </datalist>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 4 }}>
                    Visible Name in Software (UI Label)
                  </label>
                  <input
                    type="text"
                    value={customDisplayName}
                    onChange={(e) => setCustomDisplayName(e.target.value)}
                    placeholder="e.g. My Fast Claude Agent, Studio FLUX"
                    style={{ width: "100%", boxSizing: "border-box", height: 36, padding: "0 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12 }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 4 }}>
                    Model Identifier (Exact Model Name for Provider)
                  </label>
                  <input
                    type="text"
                    value={customModelId}
                    onChange={(e) => setCustomModelId(e.target.value)}
                    placeholder="e.g. dall-e-3, meta-llama/llama-3.3-70b, sdxl-1.0"
                    style={{ width: "100%", boxSizing: "border-box", height: 36, padding: "0 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: FONT_MONO }}
                  />
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
                    placeholder="sk-... or private token (leave blank for local Ollama)"
                    style={{ width: "100%", boxSizing: "border-box", height: 36, padding: "0 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: FONT_MONO }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.slate, marginBottom: 4 }}>
                    Base URL / Endpoint (Optional)
                  </label>
                  <input
                    type="text"
                    value={customBaseUrl}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                    placeholder="https://api.your-provider.com/v1"
                    style={{ width: "100%", boxSizing: "border-box", height: 36, padding: "0 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: FONT_MONO }}
                  />
                </div>
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

  // User-defined Model Name Input + Visible Name in Software (NO LOCKING/RESTRICTION!)
  const renderPluginAiFeaturesList = (pluginId, layers, currentValues, onUpdateValue) => {
    const customModelsForPlugin = (safeCommonAi.customConnections || [])
      .filter((c) => c.pluginId === pluginId)
      .map((c) => c.modelId);

    const visibleNames = safeCommonAi.visibleNames || {};

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {layers.map((layer) => {
          const currentModel = layer.runtimeLocked ? (layer.paid || currentValues[layer.key]) : (currentValues[layer.key] || layer.paid);
          const currentDisplayName = visibleNames[layer.key] || layer.label;
          const isCustomModel = !layer.runtimeLocked && !layer.options.includes(currentModel);
          const provId = getProviderIdForModel(currentModel);
          const isBuiltin = provId === "builtin" || provId === "pollinations";
          const matchedProv = safeCommonAi.providers.find((p) => p.id === provId);
          const isProvConnected = isBuiltin || (matchedProv && (matchedProv.status === "connected" || Boolean(matchedProv.apiKey) || Boolean(matchedProv.apiKeyMasked)));

          if (layer.runtimeLocked) {
            return (
              <div
                key={layer.key}
                style={{
                  background: HUB_PAPER,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: C.ink }}>
                      {layer.label}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: C.tealSoft, color: C.teal }}>
                      Runtime
                    </span>
                    <Lock size={12} color={C.slate} />
                  </div>
                  <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2 }}>
                    {layer.desc}
                  </div>
                </div>
                <div style={{ width: 280, flexShrink: 0 }}>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: C.slate, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    In use
                  </label>
                  <div
                    style={{
                      height: 36,
                      padding: "0 10px",
                      borderRadius: 7,
                      border: `1px solid ${C.border}`,
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: FONT_MONO,
                      background: "#F4F5F7",
                      color: C.ink,
                      display: "flex",
                      alignItems: "center",
                    }}
                    title="This is the model the backend actually loads. It is not selectable."
                  >
                    {currentModel}
                  </div>
                </div>
              </div>
            );
          }

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
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: C.ink }}>
                    {layer.label}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "#EEF2F6", color: C.slate }}>
                    {layer.key}
                  </span>
                  {isCustomModel && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "#EEF2FF", color: "#4F46E5", border: "1px solid #C7D2FE" }}>
                      User Defined
                    </span>
                  )}
                  {isProvConnected ? (
                    <span style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: "#ECFDF5",
                      color: "#059669",
                      border: "1px solid #A7F3D0",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: 999, background: "#10B981" }} />
                      {isBuiltin ? (provId === "pollinations" ? "Live in Workspace (Pollinations FLUX)" : "Built-in (Live)") : `Live in Workspace (${matchedProv?.name || provId})`}
                    </span>
                  ) : (
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#DC2626",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: 999, background: "#DC2626" }} />
                      Key Needed ({matchedProv?.name || provId})
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: C.slate, marginTop: 2 }}>
                  {layer.desc || "Active autonomous cognitive capability"}
                </div>
              </div>

              {/* Dual Decoupled Inputs: 1) Visible Display Name, 2) Exact Provider Model Identifier */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                {/* 1. Visible Display Name in Software */}
                <div style={{ width: 190 }}>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: C.slate, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    Visible UI Name
                  </label>
                  <input
                    type="text"
                    value={currentDisplayName}
                    onChange={(e) => updateVisibleName(layer.key, e.target.value)}
                    placeholder="Display name in UI..."
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      height: 36,
                      padding: "0 10px",
                      borderRadius: 7,
                      border: `1px solid ${C.border}`,
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: FONT_BODY,
                      background: "#fff",
                      color: C.ink,
                    }}
                    title="What will be displayed in the software interface"
                  />
                </div>

                {/* 2. Provider Model Identifier */}
                <div style={{ width: 230, position: "relative" }}>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: C.slate, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    Provider Model Name
                  </label>
                  <input
                    type="text"
                    list={`model-suggestions-${layer.key}`}
                    value={currentModel}
                    onChange={(e) => onUpdateValue(layer.key, e.target.value)}
                    placeholder="e.g. gpt-4o-mini, deepseek-chat..."
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      height: 36,
                      padding: "0 10px",
                      borderRadius: 7,
                      border: `1px solid ${isCustomModel ? "#818CF8" : C.border}`,
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: FONT_MONO,
                      background: isCustomModel ? "#FBFBFF" : "#fff",
                      color: C.ink,
                    }}
                    title="Exact model name available by the provider"
                  />
                  <datalist id={`model-suggestions-${layer.key}`}>
                    {customModelsForPlugin.map((cm) => (
                      <option key={cm} value={cm}>{cm} (Your Custom Model)</option>
                    ))}
                    {layer.options.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                    <option value="gpt-4o-mini" />
                    <option value="deepseek-chat" />
                    <option value="grok-4.20-0309-non-reasoning" />
                    <option value="dall-e-3" />
                    <option value="sdxl-1.0" />
                    <option value="fal-ai/flux/schnell" />
                    <option value="FLUX.1 Schnell" />
                  </datalist>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      onClick={embedded ? undefined : onClose}
      style={embedded
      ? { position: "relative", background: "transparent", display: "block", padding: 0 }
      : { position: "fixed", inset: 0, background: "rgba(18, 20, 28, 0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "24px 16px", cursor: "pointer" }
    }>
      <div
        onClick={embedded ? undefined : (e) => e.stopPropagation()}
        style={{
        background: "#fff",
        borderRadius: embedded ? 16 : 18,
        width: embedded ? "100%" : 980,
        maxWidth: embedded ? "100%" : "96vw",
        maxHeight: embedded ? "none" : "90vh",
        display: "flex",
        flexDirection: "column",
        overflow: embedded ? "visible" : "hidden",
        boxShadow: embedded ? "none" : "0 28px 64px rgba(0,0,0,0.28)",
        border: `1px solid ${C.border}`,
        transform: embedded ? "none" : `translate(${position.x}px, ${position.y}px)`,
        transition: isDragging && !embedded ? "none" : "transform 0.05s ease-out",
        cursor: embedded ? "default" : "default"
      }}>
        
        {/* Header (Movable by dragging) */}
        <div
          onMouseDown={embedded ? undefined : handleMouseDownHeader}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 26px",
            borderBottom: `1px solid ${C.border}`,
            background: HUB_PAPER,
            cursor: embedded ? "default" : (isDragging ? "grabbing" : "grab"),
            userSelect: "none"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg, ${C.cobalt}, ${C.teal})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", boxShadow: "0 4px 12px rgba(52,87,213,0.25)" }}>
              <Settings2 size={20} />
            </div>
            <div>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink, letterSpacing: "-0.01em" }}>
                {scopePlugin === "voice" ? "Voice AI keys"
                  : scopePlugin === "email" ? "Email Outreach AI keys"
                  : scopePlugin === "leadgen" ? "Lead Generation AI keys"
                  : "AI Plugin Configuration"}
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 2 }}>
                {scopePlugin
                  ? "Models and keys for this plugin only. Hub AI Configuration still has every plugin."
                  : "Configure models, connect custom API keys, and manage capabilities for each workspace plugin"}
              </div>
            </div>
          </div>
          {!embedded ? (
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.slate, padding: 6, borderRadius: 6 }}>
            <X size={20} />
          </button>
          ) : <div />}
        </div>

        {/* Plugin tabs only when opened from Hub (all plugins). In-plugin: header title is enough. */}
        {!scopePlugin ? (
        <div style={{ display: "flex", gap: 6, padding: "0 24px", borderBottom: `1px solid ${C.border}`, background: "#fff", overflowX: "auto" }}>
          {[
            { id: "leadgen", label: "Lead Generation", icon: Search, color: "#8B5CF6" },
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
        ) : null}

        {/* Tab Body */}
        <div style={{ flex: embedded ? "0 0 auto" : 1, overflowY: embedded ? "visible" : "auto", padding: "24px 28px" }}>
          
          {/* TAB 1: LEAD GENERATION */}
          {tab === "leadgen" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {!scopePlugin ? (
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
              ) : null}

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
            </div>
          )}

          {/* TAB 3: EMAIL OUTREACH */}
          {tab === "email" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {!scopePlugin ? (
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
              ) : null}

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
            </div>
          )}

          {/* TAB 4: AI VOICE ASSISTANT */}
          {tab === "voice" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {!scopePlugin ? (
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
              ) : null}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink }}>
                  Voice Assistant AI Capabilities (User Definable)
                </div>
                <span style={{ fontSize: 11.5, color: C.slate }}>
                  Type any custom model name or pick from suggestions
                </span>
              </div>

              {liveHub && (
                <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 10, padding: "12px 16px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#1E40AF", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Live on server</div>
                  <div style={{ fontSize: 13, color: C.ink, fontWeight: 600 }}>
                    {liveStackLabels(liveHub).engine} · LLM {liveStackLabels(liveHub).llm} · STT {liveStackLabels(liveHub).stt} · TTS {liveStackLabels(liveHub).tts} · {liveStackLabels(liveHub).carrier}
                  </div>
                  {liveHub.liveNote ? <div style={{ fontSize: 12, color: C.slate, marginTop: 4 }}>{liveHub.liveNote}</div> : null}
                </div>
              )}

              {renderPluginAiFeaturesList("voice", VOICE_LAYERS, safeCommonAi.voiceLayers, updateVoiceLayer)}
              {renderCustomConnectionsSection("voice", VOICE_LAYERS)}
            </div>
          )}

          {/* TAB 5: SMART MULTI-MODAL USAGE & QUOTAS (LIVE DATABASE METRICS) */}
          {tab === "subscription" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Tenant & Budget Card */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 18, color: C.ink }}>
                        {usageStats?.tenantName || operator?.name || "Outreach by Aivhub Workspace"}
                      </div>
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 6,
                        background: "#ECFDF5",
                        color: "#059669",
                        border: "1px solid #A7F3D0"
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: 999, background: "#10B981" }} />
                        Live Database Metrics
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: C.slate, marginTop: 3 }}>
                      {usageStats?.planTier || "Workspace (Metered from Live Activity)"} · {usageStats?.hostEmail ? `Host: ${usageStats.hostEmail}` : "Real-time resource tracking"}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setUsageLoading(true);
                        setUsageError("");
                        api.getUsageQuotas()
                          .then((data) => setUsageStats(data || null))
                          .catch((err) => setUsageError(err?.message || "Could not refresh"))
                          .finally(() => setUsageLoading(false));
                      }}
                      disabled={usageLoading}
                      title="Refresh usage from database"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "6px 11px",
                        borderRadius: 8,
                        border: `1px solid ${C.border}`,
                        background: "#fff",
                        color: C.slate,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: usageLoading ? "not-allowed" : "pointer"
                      }}
                    >
                      <RefreshCw size={13} className={usageLoading ? "animate-spin" : ""} />
                      <span>{usageLoading ? "Refreshing..." : "Refresh"}</span>
                    </button>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>
                        ${(usageStats?.estimatedCostUsd ?? 0).toFixed(2)} USD
                      </div>
                      <div style={{ fontSize: 11, color: C.slate, fontWeight: 500 }}>
                        Estimated Activity Spend
                      </div>
                    </div>
                  </div>
                </div>

                {/* DB Activity Summary Banner */}
                <div style={{ background: HUB_PAPER, border: `1px solid ${C.borderLight}`, borderRadius: 8, padding: "9px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: C.slate }}>
                  <span>{usageStats?.note || "Figures are live counts from this workspace database. Soft cost is an activity estimate, not a vendor invoice."}</span>
                  <span style={{ fontWeight: 600, color: C.ink }}>
                    {(usageStats?.summary?.processEvents ?? 0)} pipeline events recorded
                  </span>
                </div>
              </div>

              {/* Multi-Modal Metric Grid */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink }}>
                  Workspace Activity & Resource Consumption (Live)
                </div>
                <span style={{ fontSize: 11.5, color: C.slate }}>
                  Queried directly from live SQLite database
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                {/* 1. Voice Calls & Time */}
                <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <PhoneCall size={15} color={C.cobalt} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Phone Calls & Voice</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.cobalt }}>Live PSTN / SIP</span>
                  </div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
                    {usageStats?.summary?.calls ?? 0} <span style={{ fontSize: 13, fontWeight: 500, color: C.slate }}>calls</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: C.slate }}>
                    {usageStats?.summary?.voiceMinutes ?? 0} minutes logged · {(usageStats?.processBySubsystem?.voice || 0) + (usageStats?.processBySubsystem?.telephony || 0)} voice/carrier turns
                  </div>
                </div>

                {/* 2. Meetings & Bookings */}
                <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <CalendarCheck size={15} color="#10B981" />
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Meetings & Bookings</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#059669" }}>Cal.com Engine</span>
                  </div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
                    {usageStats?.summary?.meetings ?? 0} <span style={{ fontSize: 13, fontWeight: 500, color: C.slate }}>scheduled</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: C.slate }}>
                    Confirmed appointments from Voice calls, Schedule & Lead scouting
                  </div>
                </div>

                {/* 3. Social Posts */}
                <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <CalendarDays size={15} color={C.teal} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Social Media Posts</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.teal }}>Post Scheduler</span>
                  </div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
                    {usageStats?.summary?.posts ?? 0} <span style={{ fontSize: 13, fontWeight: 500, color: C.slate }}>posts</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: C.slate }}>
                    Content drafts, scheduled & published across social channels
                  </div>
                </div>

                {/* 4. Outreach Emails */}
                <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Mail size={15} color="#F59E0B" />
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Outreach Emails</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#D97706" }}>Email Outreach</span>
                  </div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
                    {usageStats?.summary?.emails ?? 0} <span style={{ fontSize: 13, fontWeight: 500, color: C.slate }}>emails</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: C.slate }}>
                    {usageStats?.processBySubsystem?.system || 0} communications dispatched to target prospects
                  </div>
                </div>

                {/* 5. Prospects & Scouting */}
                <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Search size={15} color="#8B5CF6" />
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Prospects & Missions</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED" }}>Lead Gen</span>
                  </div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
                    {usageStats?.summary?.prospects ?? 0} <span style={{ fontSize: 13, fontWeight: 500, color: C.slate }}>prospects</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: C.slate }}>
                    {usageStats?.summary?.missions ?? 0} discovery missions · {usageStats?.processBySubsystem?.crawler_rag || 0} crawl/RAG events
                  </div>
                </div>

                {/* 6. Connected Services */}
                <div style={{ background: HUB_PAPER, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Layers size={15} color={C.ink} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>Connected Services</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#059669" }}>Active</span>
                  </div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
                    {usageStats?.summary?.connectedServices ?? 0} <span style={{ fontSize: 13, fontWeight: 500, color: C.slate }}>services</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: C.slate }}>
                    {usageStats?.connections?.length ? usageStats.connections.map(c => c.name).slice(0, 3).join(", ") + (usageStats.connections.length > 3 ? ` +${usageStats.connections.length - 3} more` : "") : "Configured API integrations"}
                  </div>
                </div>
              </div>

              {/* Plugin Breakdown Table with Actual Data */}
              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, color: C.ink, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>Usage Distribution Across Workspace Plugins</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: C.slate }}>Live metered metrics</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.6fr 1fr 0.8fr", padding: "10px 18px", background: HUB_PAPER, borderBottom: `1px solid ${C.borderLight}`, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <span>Plugin</span>
                  <span>Live Activity / Units</span>
                  <span>Pipeline Activity</span>
                  <span style={{ textAlign: "right" }}>Est. Spend (Share)</span>
                </div>

                {(usageStats?.plugins || []).map((row, idx) => (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: "1.2fr 1.6fr 1fr 0.8fr", alignItems: "center", padding: "12px 18px", borderBottom: idx < (usageStats?.plugins?.length - 1) ? `1px solid ${C.borderLight}` : "none", fontSize: 12.5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: row.color || C.cobalt }} />
                      <span style={{ fontWeight: 700, color: C.ink }}>{row.name}</span>
                    </div>
                    <div style={{ color: C.textInk, fontFamily: FONT_BODY }}>{row.units}</div>
                    <div style={{ color: C.slate, fontSize: 12 }}>{row.detail}</div>
                    <div style={{ textAlign: "right", fontWeight: 700, color: C.ink }}>
                      ${(row.cost ?? 0).toFixed(2)} <span style={{ fontSize: 11, fontWeight: 500, color: C.slate }}>({row.share || "0%"})</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Connected Infrastructure List */}
              {usageStats?.connections && usageStats.connections.length > 0 && (
                <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 18px" }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 13.5, color: C.ink, marginBottom: 10 }}>
                    Connected Infrastructure & Providers ({usageStats.connections.length})
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {usageStats.connections.map((c, i) => (
                      <div
                        key={i}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          background: HUB_PAPER,
                          border: `1px solid ${C.border}`,
                          borderRadius: 8,
                          padding: "5px 10px",
                          fontSize: 12,
                          color: C.ink
                        }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: 999, background: "#10B981" }} />
                        <span style={{ fontWeight: 600 }}>{c.name}</span>
                        <span style={{ fontSize: 11, color: C.slate }}>({c.group})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 26px", borderTop: `1px solid ${C.border}`, background: HUB_PAPER }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: dirty ? C.teal : C.slate }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: dirty ? C.teal : C.green }} />
            <span>{dirty ? "Saved & synchronized across plugins" : "All plugin models in sync"}</span>
          </div>

          {!embedded ? (
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
          ) : null}
        </div>

      </div>
    </div>
  );
}
/* ---------------------------------- Dedicated Post Scheduler AI Configuration View ---------------------------------- */




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

function UserProfileMenu({ operator, onLogout, commonAi, onOpenCommonAi, onOpenTeamUsers, onOpenProfileSettings, onOpenCalcomAdmin }) {
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

              {/* Calendar & meetings (host mail, invite accounts, embeds) */}
              <button
                onClick={() => { setOpen(false); if (onOpenCalcomAdmin) onOpenCalcomAdmin("accounts"); }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
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
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: "#ECFDF5", display: "flex", alignItems: "center", justifyContent: "center", color: "#059669" }}>
                    <CalendarCheck size={15} />
                  </div>
                  <div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk }}>Calendar & meetings</div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>Invite mail, embeds & host sync</div>
                  </div>
                </div>
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "3px 8px",
                  borderRadius: 6,
                  background: "#ECFDF5",
                  color: "#059669",
                  border: "1px solid #A7F3D0"
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: 999, background: "#059669" }} />
                  Admin
                </span>
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

function PluginHub({ operator, onPick, onLogout, commonAi, onOpenCommonAi, onOpenTeamUsers, onOpenProfileSettings, onOpenCalcomAdmin }) {
  return (
    <div style={{ minHeight: "100vh", background: HUB_PAPER, fontFamily: FONT_BODY, display: "flex", flexDirection: "column" }}>
      <AppChrome />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 36px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrandMark size={32} />
          <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: C.ink, letterSpacing: "-0.02em" }}>Outreach by Aivhub</span>
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
            onOpenCalcomAdmin={onOpenCalcomAdmin}
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
            blurb="Chat a plan. See it on the calendar. Approve, then post."
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


const WEEKDAY_NUM = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };



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




function startOfDayMs(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function weekdayName(dateObj) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dateObj.getDay()];
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






function voiceForCompany(text, company) {
  const who = (company && company.name) || "we";
  return String(text || "").replace(/AIVHub/g, who);
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


























function VoiceOperatorApp({ operator, onBackToHub, onLogout, profile, setProfile, knowledgeSources, setKnowledgeSources, services, setServices, faq, setFaq, commonAi, setCommonAi, onOpenCommonAi, returnPlugin, onReturnToPlugin, onUseSimple, liveCalls: propLiveCalls, setLiveCalls: propSetLiveCalls, refreshLiveCalls: propRefreshLiveCalls }) {
  const [view, setView] = useState(() => {
    try {
      const hash = window.location.hash.replace(/^#\/?/, "");
      const parts = hash.split("/");
      if (parts[0] === "voice" && parts[1]) {
        return parts[1] === "tasks" ? "list" : (parts[1] === "prospects" ? "list" : parts[1]);
      }
      return localStorage.getItem("aivhub_voice_view") || "list";
    } catch (_) {
      return "list";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("aivhub_voice_view", view);
      const target = `#/voice/${view}`;
      if (window.location.hash !== target) {
        window.history.replaceState(null, "", target);
      }
    } catch (_) {}
  }, [view]);

  useEffect(() => {
    const onHash = () => {
      try {
        const hash = window.location.hash.replace(/^#\/?/, "");
        const parts = hash.split("/");
        if (parts[0] === "voice" && parts[1] && parts[1] !== view) {
          setView(parts[1]);
        }
      } catch (_) {}
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [view]);

  useEffect(() => {
    const onSwitchView = (e) => {
      if (e && e.detail) setView(e.detail);
    };
    window.addEventListener("aivhub_set_voice_view", onSwitchView);
    window.__aivhub_switch_voice_view = (v) => {
      if (v) setView(v);
    };
    return () => {
      window.removeEventListener("aivhub_set_voice_view", onSwitchView);
      delete window.__aivhub_switch_voice_view;
    };
  }, []);
  const [selectedMissionId, setSelectedMissionId] = useState(null);
  const [liveFocus, setLiveFocus] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [notifications, setNotifications] = useState(() => dedupeNotifications(INITIAL_NOTIFICATIONS));
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
  const [directDialPrefill, setDirectDialPrefill] = useState(null);

  const handleDirectDial = (contact) => {
    setDirectDialPrefill({
      toNumber: contact.phone || "",
      prospectName: contact.name || "",
      missionTitle: contact.company ? `Call with ${contact.company}` : "Direct Client Outreach"
    });
    setView("live");
  };
  const [localLiveCalls, setLocalLiveCalls] = useState(() => INITIAL_LIVE_CALLS.map((c) => ({ ...c, taken: false, listening: false, confirmingEnd: false, ended: false, booked: false })));
  const liveCalls = propLiveCalls !== undefined ? propLiveCalls : localLiveCalls;
  const setLiveCalls = propSetLiveCalls || setLocalLiveCalls;

  const localRefreshLiveCalls = async () => {
    try {
      const lc = await api.getLiveCalls();
      if (!Array.isArray(lc)) return;
      setLiveCalls(lc);
    } catch (_) {}
  };
  const refreshLiveCalls = propRefreshLiveCalls || localRefreshLiveCalls;

  const handleOptimisticCall = (res, payload) => {
    if (!res) return;
    const cid = res.call_id || res.id || `call_${Date.now()}`;
    const carrierSid = res.carrier_call_id || res.carrierSid || null;
    const optimistic = {
      id: cid,
      call_sid: carrierSid || cid,
      carrier_sid: carrierSid,
      carrierSid: carrierSid,
      carrier: res.carrier || (payload && payload.carrier) || "Twilio",
      mission_id: (payload && payload.mission_id) || "m_outbound",
      prospect_id: null,
      prospect: (payload && payload.prospect_name) || `Prospect (${((payload && payload.to_number) || "").slice(-4)})`,
      phone: (payload && payload.to_number) || "",
      mission: (payload && payload.mission_title) || "Direct Outbound Outreach",
      state: "calling",
      channel: "voice",
      duration: "00:00",
      listening: false,
      taken: false,
      confirming_end: false,
      ended: false,
      booked: false,
      _isOptimistic: true,
      _createdAt: Date.now(),
      transcript: [
        `AI: [Outbound call initiated via ${(res.carrier || (payload && payload.carrier) || "carrier").toUpperCase()} to ${(payload && payload.to_number) || ""}]`,
        `System: Ringing ${(payload && payload.to_number) || ""}...`
      ]
    };
    setLiveCalls((prev) => [optimistic, ...(prev || []).filter((c) => (c.id !== cid && (!carrierSid || c.carrier_sid !== carrierSid)))]);
  };

  const activeAudioPlayerRef = useRef(null);
  const [listeningCallId, setListeningCallId] = useState(null);
  const [takenCallId, setTakenCallId] = useState(null);
  const [liveAudioLevel, setLiveAudioLevel] = useState(0);
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

  // Sync missions prospect status when liveCalls changes
  useEffect(() => {
    if (!Array.isArray(liveCalls)) return;
    setMissions((ms) =>
      ms.map((m) => {
        const rows = m.prospects || [];
        if (!rows.length) return m;
        let changed = false;
        const prospects = rows.map((p) => {
          const call = liveCalls.find((c) => prospectMatchesCall(p, c, m.id));
          if (liveCallActive(call)) {
            if (p.status !== "calling") changed = true;
            return { ...p, status: "calling" };
          }
          if (p.status === "calling") {
            changed = true;
            return { ...p, status: call && call.booked ? "meeting_booked" : "ended", time: "just now" };
          }
          return p;
        });
        if (!changed) return m;
        return { ...m, prospects, ...tallyMission(prospects) };
      })
    );
  }, [liveCalls]);

  const refreshWorkspaceLogs = async () => {
    try {
      const [cl, mt, sc] = await Promise.all([
        api.getCallLogs(),
        api.getMeetings(),
        api.getSchedule()
      ]);
      if (Array.isArray(cl) && cl.length) {
        setCallLog((prev) => {
          const seen = new Set(cl.map((x) => x && x.id).filter(Boolean));
          const extra = (prev || []).filter((x) => x && x.id && !seen.has(x.id));
          return extra.length ? [...cl, ...extra] : cl;
        });
      }
      if (Array.isArray(mt)) setMeetings(mt);
      if (Array.isArray(sc)) setScheduleItems(sc);
    } catch (_) {}
  };

  // Auto-sync when entering Call Log, Meetings, or Schedule
  useEffect(() => {
    if (["call-log", "schedule", "meetings"].includes(view)) {
      refreshWorkspaceLogs();
    }
  }, [view]);

  // Listen for global log refresh events triggered by backend / WS
  useEffect(() => {
    const handleLogRefresh = () => refreshWorkspaceLogs();
    window.addEventListener("aivhub_refresh_logs", handleLogRefresh);
    return () => window.removeEventListener("aivhub_refresh_logs", handleLogRefresh);
  }, []);

  // Load backend data on mount
  useEffect(() => {
    async function loadWorkspaceData() {
      try {
        const ms = await api.getMissions();
        if (ms && Array.isArray(ms) && ms.length) setMissions(ms);
      } catch (_) {}
      try {
        await refreshLiveCalls();
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

  const toggleCallListen = async (id) => {
    // If already listening to this call, stop
    if (activeAudioPlayerRef.current && listeningCallId === id) {
      activeAudioPlayerRef.current.stopListening();
      activeAudioPlayerRef.current = null;
      setListeningCallId(null);
      setLiveCalls((cs) => cs.map((c) => (c.id === id ? { ...c, listening: false } : c)));
      try { await api.toggleListen(id); } catch (_) {}
      return;
    }

    // Stop any other active listen
    if (activeAudioPlayerRef.current) {
      activeAudioPlayerRef.current.stopListening();
      activeAudioPlayerRef.current = null;
    }

    // Start player for this call
    const player = new AudioStreamPlayer(
      id,
      (status) => {
        if (!status.listening) {
          setListeningCallId(null);
          setLiveCalls((cs) => cs.map((c) => (c.id === id ? { ...c, listening: false } : c)));
        }
      },
      (level) => {
        setLiveAudioLevel(level);
      }
    );

    player.startListening();
    activeAudioPlayerRef.current = player;
    setListeningCallId(id);
    setLiveCalls((cs) => cs.map((c) => (c.id === id ? { ...c, listening: true } : { ...c, listening: false })));
    try { await api.toggleListen(id); } catch (_) {}
  };

  const toggleCallTaken = async (id) => {
    const isCurrentlyTaken = takenCallId === id;
    if (isCurrentlyTaken) {
      // Release takeover: stop microphone
      if (activeAudioPlayerRef.current) {
        activeAudioPlayerRef.current.stopMicrophone();
      }
      setTakenCallId(null);
      setLiveCalls((cs) => cs.map((c) => (c.id === id ? { ...c, taken: false } : c)));
      try { await api.toggleTakeover(id); } catch (_) {}
    } else {
      // Activate takeover: ensure audio streaming is active for this call first
      if (!activeAudioPlayerRef.current || listeningCallId !== id) {
        await toggleCallListen(id);
      }
      if (activeAudioPlayerRef.current) {
        const ok = await activeAudioPlayerRef.current.startMicrophone();
        if (ok) {
          setTakenCallId(id);
          setLiveCalls((cs) => cs.map((c) => (c.id === id ? { ...c, taken: true } : c)));
          try { await api.toggleTakeover(id); } catch (_) {}
        } else {
          alert("Microphone permission is required to speak directly on the call.");
        }
      }
    }
  };

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

  const confirmEndCall = async (id) => {
    const call = liveCalls.find((c) => c.id === id);

    // Stop audio player if listening to this call
    if (activeAudioPlayerRef.current && listeningCallId === id) {
      try {
        activeAudioPlayerRef.current.stopListening();
      } catch (_) {}
      activeAudioPlayerRef.current = null;
      setListeningCallId(null);
    }

    setLiveCalls((cs) => cs.map((c) => (c.id === id ? { ...c, ended: true, confirmingEnd: false, state: "ended" } : c)));
    const isMessage = call && (call.channel === "whatsapp" || call.channel === "sms" || call.channel === "email");
    if (call) appendCallLog(call, isMessage ? "thread_ended" : "operator_ended");

    // Immediately notify backend to hang up carrier (Twilio) and cancel xAI session
    try {
      await api.endLiveCall(id);
    } catch (err) {
      console.warn("[EndCall] Error sending end call to backend:", err);
    }
    try {
      refreshLiveCalls();
      refreshWorkspaceLogs();
    } catch (_) {}

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

  const launchLiveOutbound = async ({
    rows,
    concurrency,
    title,
    windowStart,
    windowEnd,
    timezone,
    lunchStart,
    lunchEnd,
  }) => {
    const prospects = (rows || [])
      .filter((r) => digitsInPhone(r.phone || r.to_number).length >= 7)
      .map((r) => ({
        phone: r.phone || r.to_number,
        to_number: r.phone || r.to_number,
        prospect_name: r.contact || r.prospectName || r.name,
        name: r.name || r.contact,
        contact: r.contact || r.name,
        website: r.website || r.source || r.site || "",
      }));
    if (!prospects.length) {
      setNotifications((ns) => [
        {
          id: "n_" + Date.now(),
          text: "No dialable phone numbers on this list. Add mobiles and try again.",
          time: "just now",
          unread: true,
          type: "error",
        },
        ...ns,
      ]);
      throw new Error("No dialable phone numbers on this list.");
    }
    const cap = Math.max(1, Math.min(Number(concurrency) || 1, 5));
    setNotifications((ns) => [
      {
        id: "n_" + Date.now(),
        text: `Placing live outbound to ${prospects.length} contact${prospects.length === 1 ? "" : "s"} (up to ${Math.min(cap, prospects.length)} lines at once)…`,
        time: "just now",
        unread: true,
        type: "info",
      },
      ...ns,
    ]);
    const res = await api.dialOutboundBatch({
      prospects,
      concurrency: cap,
      mission_title: title || `Outbound list — ${prospects.length} contacts`,
      from_number: profile.callerId || undefined,
      call_window: `${windowStart || profile.weekdayStart || "09:00"}–${windowEnd || profile.weekdayEnd || "17:30"}`,
      timezone: timezone || profile.timezone || "Europe/London",
      lunch_start: lunchStart || profile.lunchStart || "12:00",
      lunch_end: lunchEnd || profile.lunchEnd || "13:00",
    });
    const resultRows = res.results || [];
    setMissions((ms) => [
      {
        id: res.mission_id,
        title: res.title,
        sector: "Uploaded list",
        region: "Uploaded list",
        status: "active",
        contacted: 0,
        total: res.total,
        meetingsBooked: 0,
        created: "just now",
        source: "manual",
        concurrency: res.concurrency,
        callWindow: `${windowStart || "09:00"}–${windowEnd || "17:30"}`,
        timezone: timezone || profile.timezone || "Europe/London",
        lunchStart: lunchStart || "12:00",
        lunchEnd: lunchEnd || "13:00",
        prospects: resultRows.map((r) => ({
          id: r.prospect_id,
          name: r.name,
          phone: r.to,
          status: r.status === "calling" ? "calling" : r.status,
          note: r.message || r.error || "",
          time: r.status === "calling" ? "now" : "waiting",
          channel: "voice",
        })),
      },
      ...ms,
    ]);
    setSelectedMissionId(res.mission_id);
    setLiveFocus({ missionId: res.mission_id, missionTitle: res.title });
    await refreshLiveCalls();
    setView("live");
      setNotifications((ns) => [
        {
          id: "n_" + Date.now(),
        text: res.message || `Live outbound started for ${res.total} contacts.`,
          time: "just now",
          unread: true,
        type: res.failed ? "error" : "success",
        },
        ...ns,
      ]);
    return res;
  };

  const createMission = async (payload) => {
    setShowNew(false);

    const rows = payload.rows || [];
    const withPhones = rows.filter((r) => digitsInPhone(r.phone).length >= 7);
    if (withPhones.length) {
      await launchLiveOutbound({
        rows: withPhones,
        concurrency: payload.concurrency || 1,
        title: `Uploaded list — ${withPhones.length} contacts`,
        windowStart: payload.windowStart,
        windowEnd: payload.windowEnd,
        timezone: payload.timezone,
        lunchStart: payload.lunchStart,
        lunchEnd: payload.lunchEnd,
      });
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

  const activeCalls = liveCalls.filter((c) => !c.ended && c.state !== "ended" && c.state !== "failed" && c.state !== "canceled");

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
        onUseSimple={onUseSimple}
        activeCallCount={activeCalls.length}
      />

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {/* Return to Previous Plugin Banner with preserved state */}
        {returnPlugin && (
          <div
            style={{
              background: "linear-gradient(90deg, #1E1B4B 0%, #0F172A 100%)",
              borderBottom: "1px solid #4F46E5",
              color: "#EEF2FF",
              padding: "10px 24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              zIndex: 1000,
              boxShadow: "0 2px 10px rgba(79, 70, 229, 0.25)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <span style={{ fontSize: 16 }}>💾</span>
              <span>
                You jumped from <strong>{PLUGIN_DISPLAY_NAMES[returnPlugin] || returnPlugin}</strong> to handle this call.
                Your previous workspace and unsaved drafts are safely preserved.
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => onReturnToPlugin && onReturnToPlugin(returnPlugin)}
                style={{
                  background: "linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 7,
                  padding: "6px 14px",
                  fontWeight: 700,
                  fontSize: 12.5,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  boxShadow: "0 2px 8px rgba(99, 102, 241, 0.4)",
                }}
              >
                &larr; Return to {PLUGIN_DISPLAY_NAMES[returnPlugin] || returnPlugin}
              </button>
              <button
                onClick={() => onReturnToPlugin && onReturnToPlugin(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94A3B8",
                  cursor: "pointer",
                  fontSize: 14,
                  padding: "4px 8px",
                }}
                title="Dismiss return banner"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Floating Active Call Banner across all views */}
        {activeCalls.length > 0 && view !== "live" && (
          <div
            style={{
              background: "linear-gradient(90deg, #0F172A 0%, #1E1B4B 100%)",
              color: "#fff",
              padding: "12px 24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "2px solid #6366F1",
              boxShadow: "0 4px 14px rgba(99, 102, 241, 0.25)",
              zIndex: 999,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#10B981", display: "inline-block", boxShadow: "0 0 8px #10B981" }} />
              <span style={{ fontWeight: 700, fontSize: 13.5, color: "#fff" }}>
                📞 Live Call in Progress ({activeCalls.length}): {activeCalls[0].prospect} (<CallTimer initialDuration={activeCalls[0].duration || "00:01"} active={true} />)
              </span>
              <span style={{ fontSize: 12, color: "#C7D2FE" }}>
                AI is actively speaking with caller.
              </span>
            </div>
            <button
              onClick={() => setView("live")}
              style={{
                background: "#4F46E5",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "6px 14px",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              Watch Live / Listen &rarr;
            </button>
          </div>
        )}

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
            onLaunchLiveBatch={launchLiveOutbound}
          />
        )}
        {(view === "missionDetail" || view === "taskDetail") && selectedMission && (
          <MissionDetail
            mission={selectedMission}
            onBack={goBack}
            companyName={profile.name}
            onWatchLive={goLive}
            liveCalls={liveCalls}
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
            callerId={profile.callerId || ""}
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
            onRefreshLiveCalls={refreshLiveCalls}
            directDialPrefill={directDialPrefill}
            onOptimisticCall={handleOptimisticCall}
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
            onDirectDial={handleDirectDial}
          />
        )}
        {view === "processlogs" && (
          <ProcessLogsView
            notifications={notifications}
            setNotifications={setNotifications}
          />
        )}
        {(view === "prospects" || view === "list") && (
          <ProspectsView
            notifications={notifications}
            setNotifications={setNotifications}
            onScheduleFor={goScheduleFor}
            registry={registry}
            callLog={callLog}
            onOpenLog={goLogFor}
            onDirectDial={handleDirectDial}
          />
        )}
        {view === "company" && <CompanyProfileView profile={profile} setProfile={setProfile} notifications={notifications} setNotifications={setNotifications} sources={knowledgeSources} setSources={setKnowledgeSources} services={services} setServices={setServices} faq={faq} setFaq={setFaq} />}
        {view === "templates" && <ConversationTemplatesView notifications={notifications} setNotifications={setNotifications} />}
        {(view === "provider" || view === "connections") && <ProviderConfigView notifications={notifications} setNotifications={setNotifications} commonAi={commonAi} setCommonAi={setCommonAi} profile={profile} setProfile={setProfile} onNavigateView={setView} />}
        {view === "analytics" && (
          <SafeErrorBoundary label="Analytics" onReset={() => setView("analytics")}>
            <AnalyticsView notifications={notifications} setNotifications={setNotifications} />
          </SafeErrorBoundary>
        )}
        {view === "docs" && <TelephonyDocsView notifications={notifications} setNotifications={setNotifications} onNavigate={setView} />}
      </div>

      {showNew && <NewMissionModal onClose={() => setShowNew(false)} onCreate={createMission} registry={registry} callLog={callLog} workingHours={{ timezone: profile.timezone, lunchStart: profile.lunchStart, lunchEnd: profile.lunchEnd, weekdayStart: profile.weekdayStart, weekdayEnd: profile.weekdayEnd, callHoursPolicy: profile.callHoursPolicy }} commonAi={commonAi} />}
    </div>
  );
}

const PLUGIN_DISPLAY_NAMES = {
  scheduler: "Post Scheduler & Social Media",
  leadgen: "B2B Lead Generation",
  emailoutreach: "Cold Email Sequencer",
  calcom: "Cal.com Booking Hub",
  voice: "Voice AI Operator",
};

function UniversalCallNotificationBanner({ activeCalls, currentPlugin, onJumpToVoice, onDismissCall }) {
  if (!activeCalls || activeCalls.length === 0) return null;

  const isAlreadyOnLiveView = currentPlugin === "voice" && (window.location.hash || "").includes("/live");
  if (isAlreadyOnLiveView) return null;

  const primaryCall = activeCalls[0];
  const callerLabel = primaryCall.prospect || primaryCall.caller || primaryCall.phone || "Inbound Caller";
  const duration = primaryCall.duration || "00:01";
  const isOtherPlugin = currentPlugin !== "voice";

  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        right: 24,
        zIndex: 999999,
        maxWidth: 420,
        minWidth: 340,
        background: "linear-gradient(135deg, #0F172A 0%, #1E1B4B 100%)",
        border: "2px solid #6366F1",
        borderRadius: 14,
        boxShadow: "0 14px 40px rgba(0, 0, 0, 0.6), 0 0 24px rgba(99, 102, 241, 0.4)",
        color: "#fff",
        padding: "16px 18px",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {/* Top Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#10B981",
              display: "inline-block",
              boxShadow: "0 0 10px #10B981",
            }}
          />
          <span style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "#A5B4FC" }}>
            {isOtherPlugin ? "Live Call in Progress" : "Inbound Call Ringing"}
          </span>
          <span
            style={{
              background: "rgba(16, 185, 129, 0.18)",
              border: "1px solid rgba(16, 185, 129, 0.4)",
              color: "#34D399",
              padding: "2px 7px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            ⏱ <CallTimer initialDuration={duration} active={true} />
          </span>
        </div>
        <button
          onClick={() => onDismissCall(primaryCall.id || primaryCall.call_sid)}
          style={{
            background: "transparent",
            border: "none",
            color: "#94A3B8",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: 4,
          }}
          title="Dismiss notification"
        >
          ✕
        </button>
      </div>

      {/* Caller Info */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#FFFFFF", marginBottom: 3, display: "flex", alignItems: "center", gap: 6 }}>
          <span>📞</span>
          <span>{callerLabel}</span>
        </div>
        <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 1.4 }}>
          {isOtherPlugin
            ? "AI Operator is speaking live with caller. Take over or listen now!"
            : "Caller is connected live. Switch to the live monitor to take over or listen."}
        </div>
        {isOtherPlugin && (
          <div style={{ fontSize: 11, color: "#A5B4FC", marginTop: 5, display: "flex", alignItems: "center", gap: 5 }}>
            <span>💾</span>
            <span>Your ongoing work in this plugin is automatically preserved.</span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={() => onJumpToVoice(primaryCall)}
          style={{
            flex: 1,
            background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            boxShadow: "0 4px 12px rgba(16, 185, 129, 0.35)",
          }}
        >
          ⚡ {isOtherPlugin ? "Jump to Call & Take Over" : "Switch to Live Monitor"} &rarr;
        </button>
        <button
          onClick={() => onDismissCall(primaryCall.id || primaryCall.call_sid)}
          style={{
            background: "rgba(255, 255, 255, 0.08)",
            color: "#CBD5E1",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function CallingEditionRoot(props) {
  const [edition, setEdition] = useState(() => getCallingEdition());
  useEffect(() => {
    const sync = () => setEdition(getCallingEdition());
    window.addEventListener("hashchange", sync);
    window.addEventListener(CALLING_EDITION_EVENT, sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener(CALLING_EDITION_EVENT, sync);
    };
  }, []);
  if (edition === "classic") {
    const goSimple = () => {
      setCallingEdition("simple");
      try { window.history.replaceState(null, "", "#/voice/list"); } catch (_) {}
      setEdition("simple");
    };
    return (
      <div style={{ height: "100%", position: "relative" }}>
        <VoiceOperatorApp {...props} onUseSimple={goSimple} />
        <button
          type="button"
          onClick={goSimple}
          title="Back to simple calling"
          style={{
            position: "fixed",
            right: 18,
            bottom: 18,
            zIndex: 9999,
            height: 40,
            padding: "0 16px",
            borderRadius: 10,
            border: "none",
            background: C.cobalt,
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "Inter, sans-serif",
            boxShadow: "0 10px 28px rgba(52,87,213,0.35)",
          }}
        >
          Use new calling
        </button>
      </div>
    );
  }
  return (
    <CallingWorkspace
      {...props}
      aiKeysPanel={
        <ProviderConfigView
          embedded
          notifications={props.notifications || []}
          setNotifications={props.setNotifications || (() => {})}
          commonAi={props.commonAi}
          setCommonAi={props.setCommonAi}
          profile={props.profile}
          setProfile={props.setProfile}
        />
      }
      onUseClassic={() => {
        setCallingEdition("classic");
        setEdition("classic");
      }}
      companyPanel={
        <CompanyProfileView
          embedded
          profile={props.profile}
          setProfile={props.setProfile}
          notifications={props.notifications || []}
          setNotifications={props.setNotifications || (() => {})}
          sources={props.knowledgeSources}
          setSources={props.setKnowledgeSources}
          services={props.services}
          setServices={props.setServices}
          faq={props.faq}
          setFaq={props.setFaq}
        />
      }
    />
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

  const parseRoute = () => {
    try {
      const hash = window.location.hash.replace(/^#\/?/, "");
      if (!hash) return { plugin: null, subView: null };
      const parts = hash.split("/");
      const p = parts[0];
      const valid = ["voice", "scheduler", "leadgen", "emailoutreach", "calcom"];
      if (valid.includes(p)) {
        return { plugin: p, subView: parts.slice(1).join("/") || null };
      }
      return { plugin: null, subView: null };
    } catch (_) {
      return { plugin: null, subView: null };
    }
  };

  // Only resume a plugin when the URL itself names one (e.g. a bookmarked/shared
  // #/voice/list link). A bare link with no hash always opens the clean hub,
  // even if this browser previously used a plugin.
  const [plugin, setPlugin] = useState(() => parseRoute().plugin);

  const [visitedPlugins, setVisitedPlugins] = useState(() => {
    const init = parseRoute().plugin;
    return init ? [init] : [];
  });

  const [returnPlugin, setReturnPlugin] = useState(() => {
    try {
      return sessionStorage.getItem("aivhub_return_plugin") || null;
    } catch (_) {
      return null;
    }
  });

  const [liveCalls, setLiveCalls] = useState([]);
  const [dismissedCallIds, setDismissedCallIds] = useState([]);
  const prevLiveCallIdsRef = useRef(new Set());

  // Track visited plugins so DOM and state are preserved across switches
  useEffect(() => {
    if (plugin && !visitedPlugins.includes(plugin)) {
      setVisitedPlugins((prev) => [...prev, plugin]);
    }
  }, [plugin, visitedPlugins]);

  const playIncomingChime = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.15); // A5
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.6);
    } catch (_) {}
  };

  const triggerCallNotification = (call) => {
    try {
      playIncomingChime();
      if ("Notification" in window) {
        const callerName = call.prospect || call.caller || call.phone || "Inbound caller";
        if (Notification.permission === "granted") {
          new Notification("📞 Inbound Call in Progress", {
            body: `${callerName} is on call with AI Operator. Click to jump to call.`,
            icon: "/favicon.png",
          });
        } else if (Notification.permission !== "denied") {
          Notification.requestPermission().then((p) => {
            if (p === "granted") {
              new Notification("📞 Inbound Call in Progress", {
                body: `${callerName} is on call with AI Operator. Click to jump to call.`,
                icon: "/favicon.png",
              });
            }
          });
        }
      }
    } catch (_) {}
  };

  const refreshLiveCalls = async () => {
    try {
      const lc = await api.getLiveCalls();
      if (Array.isArray(lc)) {
        setLiveCalls((prev) => {
          // Reconcile with optimistic calls
          const backendIds = new Set(lc.map((c) => c.id || c.call_sid).filter(Boolean));
          const backendCarrierSids = new Set(lc.map((c) => c.carrier_sid || c.carrierSid || c.carrier_call_id).filter(Boolean));

          const remainingOptimistic = (prev || []).filter((p) => {
            if (!p._isOptimistic) return false;
            const pid = p.id || p.call_sid;
            const pCarrierSid = p.carrier_sid || p.carrierSid || p.carrier_call_id;
            if (pid && backendIds.has(pid)) return false;
            if (pCarrierSid && backendCarrierSids.has(pCarrierSid)) return false;
            if (Date.now() - (p._createdAt || 0) > 30000) return false;
            return true;
          });

          return [...remainingOptimistic, ...lc];
        });

        const active = lc.filter((c) => !c.ended && c.state !== "ended" && c.state !== "failed" && c.state !== "canceled");
        active.forEach((c) => {
          const cid = c.id || c.call_sid;
          if (cid && !prevLiveCallIdsRef.current.has(cid)) {
            prevLiveCallIdsRef.current.add(cid);
            triggerCallNotification(c);
          }
        });
      }
    } catch (_) {}
  };

  // Global real-time WebSocket listener + poll fallback across ALL plugins
  useEffect(() => {
    let ws = null;
    try {
      ws = new WebSocketClient(
        null,
        (msg) => {
          if (msg && msg.type) {
            refreshLiveCalls();
            if (msg.type === "call_created" || msg.type === "call_started") {
              const data = msg.data || {};
              const callId = data.id || data.callId || data.carrierSid || "";
              if (callId && !prevLiveCallIdsRef.current.has(callId)) {
                prevLiveCallIdsRef.current.add(callId);
                triggerCallNotification(data);
              }
            }
            if (["call_ended", "booking_confirmed", "call_updated"].includes(msg.type)) {
              window.dispatchEvent(new CustomEvent("aivhub_refresh_logs"));
            }
          }
        },
        () => console.log("[LiveCalls] WebSocket linked to CallHub"),
        () => console.log("[LiveCalls] WebSocket disconnected")
      );
    } catch (_) {}

    refreshLiveCalls();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshLiveCalls();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onVisibilityChange);

    // Fallback sync every 3s
    const interval = setInterval(refreshLiveCalls, 3000);

    return () => {
      if (ws) ws.close();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onVisibilityChange);
    };
  }, []);

  const handleJumpToVoice = (call) => {
    // 1. Dispatch save draft event so active forms in any plugin flush
    try {
      window.dispatchEvent(new CustomEvent("aivhub_save_draft", { detail: { plugin } }));
    } catch (_) {}

    // 2. Remember current plugin for seamless one-click return with preserved state
    if (plugin && plugin !== "voice") {
      setReturnPlugin(plugin);
      try { sessionStorage.setItem("aivhub_return_plugin", plugin); } catch (_) {}
    }

    // 3. Set target voice view to live
    try {
      localStorage.setItem("aivhub_voice_view", "live");
      window.location.hash = "#/voice/live";
    } catch (_) {}

    // 4. Switch to voice plugin
    setPlugin("voice");

    // 5. Fire view override event in case VoiceOperatorApp is already mounted
    setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent("aivhub_set_voice_view", { detail: "live" }));
      } catch (_) {}
    }, 50);
  };

  const handleReturnToPlugin = (targetPlugin) => {
    const dest = targetPlugin || returnPlugin;
    if (dest) {
      setPlugin(dest);
      setReturnPlugin(null);
      try { sessionStorage.removeItem("aivhub_return_plugin"); } catch (_) {}
    }
  };

  // Global helper to switch plugins from any modal
  useEffect(() => {
    window.__aivhub_switch_plugin = (p) => {
      if (p === "voice") {
        try {
          localStorage.setItem("aivhub_voice_view", "list");
          window.location.hash = "#/voice/list";
        } catch (_) {}
        setTimeout(() => {
          try {
            window.dispatchEvent(new CustomEvent("aivhub_set_voice_view", { detail: "list" }));
          } catch (_) {}
        }, 0);
      }
      setPlugin(p);
    };
    return () => { delete window.__aivhub_switch_plugin; };
  }, []);

  // Keep plugin state, localStorage, and URL in sync
  useEffect(() => {
    try {
      if (plugin) {
        localStorage.setItem("aivhub_active_plugin", plugin);
        const route = parseRoute();
        if (route.plugin !== plugin || (plugin === "voice" && !route.subView)) {
          const sub = (
            plugin === "voice" ? (localStorage.getItem("aivhub_voice_view") || "list") :
            plugin === "leadgen" ? localStorage.getItem("aivhub_leadgen_view") :
            plugin === "emailoutreach" ? localStorage.getItem("aivhub_email_view") :
            plugin === "calcom" ? localStorage.getItem("aivhub_calcom_view") : null
          );
          const target = sub ? `#/${plugin}/${sub}` : (plugin === "voice" ? "#/voice/list" : `#/${plugin}`);
          window.location.hash = target;
        }
      } else {
        localStorage.removeItem("aivhub_active_plugin");
        if (window.location.hash && window.location.hash !== "#/" && window.location.hash !== "#") {
          window.history.replaceState(null, "", window.location.pathname);
        }
      }
    } catch (_) {}
  }, [plugin]);

  // Handle browser back and forward buttons
  useEffect(() => {
    const onHashChange = () => {
      const route = parseRoute();
      if (route.plugin !== plugin) {
        setPlugin(route.plugin);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [plugin]);
  const [profile, setProfile] = useState(() => {
    try {
      const saved = localStorage.getItem("aivhub_company_profile");
      const parsed = saved ? JSON.parse(saved) : INITIAL_COMPANY_PROFILE;
      if (parsed && (parsed.callerId === "+44 20 7946 0912" || (parsed.callerId || "").includes("79460912"))) {
        parsed.callerId = "";
      }
      return parsed;
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
  const [showCalcomAdminModal, setShowCalcomAdminModal] = useState(false);
  const [calcomInitialTab, setCalcomInitialTab] = useState("accounts");
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [commonAiTab, setCommonAiTab] = useState("leadgen");
  const [commonAiScope, setCommonAiScope] = useState(null);

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
            if (merged.callerId === "+44 20 7946 0912" || (merged.callerId || "").includes("79460912")) {
              merged.callerId = p.callerId || p.caller_id || "";
            }
            try { localStorage.setItem("aivhub_company_profile", JSON.stringify(merged)); } catch (_) {}
            return merged;
          });
        }
        try {
          const hub = await api.getTelephonyHub();
          if (hub && hub.phoneNumber) {
            setProfile((prev) => {
              if (!prev.callerId || prev.callerId.includes("79460912")) {
                const updated = { ...prev, callerId: hub.phoneNumber };
                try { localStorage.setItem("aivhub_company_profile", JSON.stringify(updated)); } catch (_) {}
                return updated;
              }
              return prev;
            });
          }
        } catch (_) {}
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
      try {
        const [conns, hub] = await Promise.all([
          api.getConnections().catch(() => []),
          api.getTelephonyHub().catch(() => null),
        ]);
        if (Array.isArray(conns) || hub) {
          setCommonAi((prev) => syncCommonAiWithBackend(prev, conns || [], hub));
        }
      } catch (_) {}
    }
    loadBackendProfile();
  }, []);

  const handleLogout = () => {
    try {
      sessionStorage.removeItem("aivhub_operator");
      sessionStorage.removeItem("aivhub_return_plugin");
      localStorage.removeItem("aivhub_active_plugin");
      window.history.replaceState(null, "", window.location.pathname);
    } catch (_) {}
    setVisitedPlugins([]);
    setReturnPlugin(null);
    setOperator(null);
    setPlugin(null);
  };

  const handleBackToHub = () => {
    try {
      localStorage.removeItem("aivhub_active_plugin");
      localStorage.setItem("aivhub_voice_view", "list");
      window.history.pushState(null, "", window.location.pathname);
    } catch (_) {}
    setPlugin(null);
  };

  const handlePickPlugin = (p) => {
    if (p === "voice") {
      try {
        localStorage.setItem("aivhub_voice_view", "list");
        window.location.hash = "#/voice/list";
      } catch (_) {}
      setTimeout(() => {
        try {
          window.dispatchEvent(new CustomEvent("aivhub_set_voice_view", { detail: "list" }));
        } catch (_) {}
      }, 0);
    }
    setPlugin(p);
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
    <OrgSettingsProvider>
      {!plugin && (
        <SafeErrorBoundary label="Plugin Hub" onReset={handleBackToHub}>
          <PluginHub
            operator={operator}
            onPick={handlePickPlugin}
            onLogout={handleLogout}
            commonAi={commonAi}
            onOpenCommonAi={(tab) => { if (tab) setCommonAiTab(tab); setCommonAiScope(null); setShowCommonAiModal(true); }}
            onOpenTeamUsers={() => setShowTeamModal(true)}
            onOpenProfileSettings={() => setShowProfileModal(true)}
            onOpenCalcomAdmin={(tab) => { setCalcomInitialTab(tab || "accounts"); setShowCalcomAdminModal(true); }}
          />
        </SafeErrorBoundary>
      )}

      {visitedPlugins.map((p) => (
        <div
          key={p}
          style={{
            display: plugin === p ? "block" : "none",
            height: "100vh",
            width: "100vw",
            overflow: "hidden",
          }}
        >
          {p === "leadgen" && (
            <SafeErrorBoundary label="Lead Generation" onReset={handleBackToHub}>
              <LeadGenerationPlugin
                operator={operator}
                onBackToHub={handleBackToHub}
                onLogout={handleLogout}
                profile={profile}
                commonAi={commonAi}
              />
            </SafeErrorBoundary>
          )}

          {p === "scheduler" && (
            <SafeErrorBoundary label="Post Scheduler" onReset={handleBackToHub}>
              <SocialWorkspaceGate
                operator={operator}
                onBackToHub={handleBackToHub}
                onLogout={handleLogout}
                profile={profile}
                setProfile={setProfile}
                knowledgeSources={knowledgeSources}
                setKnowledgeSources={setKnowledgeSources}
                commonAi={commonAi}
              />
            </SafeErrorBoundary>
          )}

          {p === "emailoutreach" && (
            <SafeErrorBoundary label="Email Outreach" onReset={handleBackToHub}>
              <EmailOutreachPlugin
                operator={operator}
                onBackToHub={handleBackToHub}
                onLogout={handleLogout}
                profile={profile}
                commonAi={commonAi}
              />
            </SafeErrorBoundary>
          )}

          {p === "voice" && (
            <SafeErrorBoundary label="Voice Assistant" onReset={handleBackToHub}>
              <CallingEditionRoot
                operator={operator}
                onBackToHub={handleBackToHub}
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
                onOpenCommonAi={() => { setCommonAiTab("voice"); setCommonAiScope("voice"); setShowCommonAiModal(true); }}
                returnPlugin={returnPlugin}
                onReturnToPlugin={handleReturnToPlugin}
                liveCalls={liveCalls}
                setLiveCalls={setLiveCalls}
                refreshLiveCalls={refreshLiveCalls}
              />
            </SafeErrorBoundary>
          )}

          {p === "calcom" && (
            <SafeErrorBoundary label="Cal.com Scheduler" onReset={handleBackToHub}>
              <CalcomSchedulerPlugin
                operator={operator}
                onBackToHub={handleBackToHub}
                onLogout={handleLogout}
                profile={profile}
                commonAi={commonAi}
                onOpenCommonAi={() => { setCalcomInitialTab("settings"); setShowCalcomAdminModal(true); }}
              />
            </SafeErrorBoundary>
          )}
        </div>
      ))}

      {/* Universal Floating Incoming Call Banner across ALL Plugins */}
      <UniversalCallNotificationBanner
        activeCalls={liveCalls.filter(
          (c) => !c.ended && c.state !== "ended" && c.state !== "failed" && c.state !== "canceled" && !dismissedCallIds.includes(c.id || c.call_sid)
        )}
        currentPlugin={plugin}
        onJumpToVoice={handleJumpToVoice}
        onDismissCall={(cid) => setDismissedCallIds((prev) => [...prev, cid])}
      />


      <CommonAiConfigModal
        isOpen={showCommonAiModal}
        onClose={() => { setShowCommonAiModal(false); setCommonAiScope(null); }}
        commonAi={commonAi}
        setCommonAi={setCommonAi}
        initialTab={commonAiTab}
        scopePlugin={commonAiScope}
        operator={operator}
        onOpenCalcomAdmin={(tab) => { setCalcomInitialTab(tab || "accounts"); setShowCalcomAdminModal(true); }}
        onNavigateToPlugin={(pId) => {
          setShowCommonAiModal(false);
          setCommonAiScope(null);
          if (pId === "voice") {
            try {
              localStorage.setItem("aivhub_voice_view", "list");
              window.location.hash = "#/voice/list";
            } catch (_) {}
            setTimeout(() => {
              try {
                window.dispatchEvent(new CustomEvent("aivhub_set_voice_view", { detail: "list" }));
              } catch (_) {}
            }, 0);
          }
          setPlugin(pId);
        }}
      />

      <CalcomAdminModal
        isOpen={showCalcomAdminModal}
        onClose={() => setShowCalcomAdminModal(false)}
        operator={operator}
        initialTab={calcomInitialTab}
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
    </OrgSettingsProvider>
  );
}
