import {
  BookOpen,
  Bot,
  FileText,
  Globe,
  Link2,
  Mail,
  Package,
  PenLine,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";

export const INITIAL_BUILTIN_PROVIDERS = [
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
];

export const VOICE_LAYERS = [
  { key: "llm", label: "Dialogue & Conversational Reasoning LLM", desc: "Real-time conversation turns, context memory, and objection handling", paid: "xAI (Grok)", oss: "DeepSeek", options: [] },
  { key: "tts", label: "Text-to-Speech (Ultra-Low Latency)", desc: "Ultra-realistic speech generation with human inflection and natural breath", paid: "Cartesia", oss: "Kokoro (self-hosted)", options: [] },
  { key: "stt", label: "Speech-to-Text Acoustic Recognition", desc: "Real-time acoustic streaming transcription with noise suppression", paid: "Deepgram", oss: "Faster-Whisper (self-hosted)", options: [] },
  { key: "voice", label: "Voice Orchestration & Interruption Engine", desc: "Manages audio buffers, turn-taking arbitration, and silence detection", paid: "LiveKit (self-hosted)", oss: "LiveKit (self-hosted)", options: ["LiveKit (self-hosted)", "Vapi Voice AI", "Retell AI"] },
  { key: "telephony", label: "Telephony Carrier & SIP Trunk", desc: "PSTN inbound numbers, caller ID preservation, and carrier routing", paid: "Twilio", oss: "Telnyx", options: ["Twilio", "Telnyx"] },
];

export function prettyProvider(raw, fallback) {
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

export function liveStackLabels(hub) {
  if (hub?.liveLabels && typeof hub.liveLabels === "object") {
    return hub.liveLabels;
  }
  const engine = String(hub?.liveEngine || "").toLowerCase();
  const voice = hub?.voiceLabel || "—";
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

export function voiceLayersFromHub(hub, prevLayers) {
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

export function syncCommonAiWithBackend(prevCommonAi, backendConns, liveHub) {
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

export const LEADGEN_LAYERS = [
  { key: "researchLlm", label: "Web Search & Account Discovery LLM", desc: "Discovers target accounts matching ICP criteria across sectors", paid: "gpt-4o-mini", oss: "deepseek-chat", options: ["gpt-4o-mini", "deepseek-chat", "grok-4.20-0309-non-reasoning"] },
  { key: "extractorLlm", label: "Decision-Maker & Contact Extractor", desc: "Extracts verified names, job titles, and contact signals", paid: "gpt-4o-mini", oss: "deepseek-chat", options: ["gpt-4o-mini", "deepseek-chat", "grok-4.20-0309-non-reasoning"] },
  { key: "enrichmentEngine", label: "Live Web & Domain Crawler", desc: "Performs real-time scraping of company websites and news", paid: "DuckDuckGo Live + Crawler", oss: "Direct Domain Scraping", options: ["DuckDuckGo Live + Crawler", "Direct Domain Scraping", "Google Custom Search"] },
  { key: "dossierSynth", label: "Pain-Point & Strategic Hook Synthesizer", desc: "Synthesizes intelligence into conversation openers and cold hooks", paid: "gpt-4o-mini", oss: "deepseek-chat", options: ["gpt-4o-mini", "deepseek-chat", "grok-4.20-0309-non-reasoning"] },
  { key: "intentScoring", label: "Autonomous ICP & Intent Fit Scorer", desc: "Calculates account priority and purchase readiness scores", paid: "gpt-4o-mini", oss: "deepseek-chat", options: ["gpt-4o-mini", "deepseek-chat", "grok-4.20-0309-non-reasoning"] },
];

export const LOCAL_BGE_EMBEDDINGS = "BAAI/bge-small-en-v1.5 (local CPU)";

export const EMAIL_LAYERS = [
  { key: "copywriterLlm", label: "Outreach Copywriter & Sequencer", desc: "Drafts concise, high-converting B2B cold email sequences", paid: "gpt-4o-mini", oss: "deepseek-chat", options: ["gpt-4o-mini", "deepseek-chat", "grok-4.20-0309-non-reasoning"] },
  { key: "replyClassifier", label: "Inbound Reply Classifier & Sentiment", desc: "Categorizes inbound emails into Interested, Objections, or Not Now", paid: "gpt-4o-mini", oss: "deepseek-chat", options: ["gpt-4o-mini", "deepseek-chat", "grok-4.20-0309-non-reasoning"] },
  { key: "replyDrafter", label: "Context-Aware Auto-Response Drafter", desc: "Generates tailored responses to inbound client inquiries", paid: "gpt-4o-mini", oss: "deepseek-chat", options: ["gpt-4o-mini", "deepseek-chat", "grok-4.20-0309-non-reasoning"] },
  { key: "spamAuditor", label: "Deliverability & Spam Auditor", desc: "Scans copy for trigger phrases to ensure high inbox delivery", paid: "AIV Spam Guard v2", oss: "deepseek-chat", options: ["AIV Spam Guard v2", "gpt-4o-mini", "deepseek-chat"] },
  { key: "contentTransformer", label: "Social Post-to-Email Repurposer", desc: "Transforms published social posts into broadcast emails", paid: "gpt-4o-mini", oss: "deepseek-chat", options: ["gpt-4o-mini", "deepseek-chat", "grok-4.20-0309-non-reasoning"] },
];

export const INITIAL_COMMON_AI_CONFIG = {
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

export const C = {
  ink: "#12141C",
  inkSoft: "#1B1E29",
  inkLine: "#2A2D3A",
  paper: "#F5F6F8",
  paperCard: "#FFFFFF",
  paperSoft: "#F0F2F5",
  border: "#E3E6EB",
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

export const FONT_DISPLAY = "'Inter', sans-serif";
export const FONT_BODY = "'Inter', sans-serif";
export const FONT_MONO = "'JetBrains Mono', monospace";
export const HUB_PAPER = "#F8F9FB";



/* ─── Smart Column Auto-Detection: supports any file format and naming convention ─── */
export function initialsFromName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const TIMEZONES = [
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

export const PECR = {
  weekdayStart: "08:00",
  weekdayEnd: "21:00",
  weekendStart: "09:00",
  weekendEnd: "18:00",
};

export const CALL_HOUR_POLICIES = [
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

export function pecrPolicy(id) {
  return CALL_HOUR_POLICIES.find((p) => p.id === id) || CALL_HOUR_POLICIES[0];
}

export function applyCallHourPolicy(id, current = {}) {
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

export const WEEKDAY_HOUR_OPTIONS = Array.from({ length: 27 }, (_, i) => {
  const m = 8 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});
export const LUNCH_HOUR_OPTIONS = Array.from({ length: 9 }, (_, i) => {
  const m = 11 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

export const CONNECTIONS = [
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

export const INITIAL_KNOWLEDGE_SOURCES = [
  { id: "k1", name: "Company website", type: "Website URL", value: "aivhub.io", status: "indexed", synced: "2 hours ago" },
  { id: "k2", name: "Service catalogue & pricing", type: "Document upload", value: "aivhub-services-2026.pdf", status: "indexed", synced: "1 day ago" },
  { id: "k3", name: "Case studies deck", type: "Google Drive link", value: "drive.google.com/aivhub-case-studies", status: "pending", synced: "—" },
  { id: "k4", name: "Objection handling notes", type: "Manual text", value: "Internal notes on common pushback", status: "indexed", synced: "3 days ago" },
];

export const INITIAL_FAQ = [
  { id: "f1", q: "What does your company do?", a: "We build AI-powered business intelligence dashboards that turn raw operational data into clear, real-time decisions for mid-market teams." },
  { id: "f2", q: "How much does it cost?", a: "Pricing depends on team size and data sources — I can have someone send exact numbers, or we can cover it on the call we're booking." },
  { id: "f3", q: "Who else uses this?", a: "We work with logistics, manufacturing, and retail operators across the UK — happy to share relevant examples on the call." },
];

export const INITIAL_SERVICES = [
  { id: "sv1", name: "BI Dashboard Platform", ideal: "Mid-market ops teams, 50-500 staff", desc: "Real-time operational dashboards pulling from existing systems." },
  { id: "sv2", name: "Data Pipeline Consulting", ideal: "Companies with fragmented data sources", desc: "Set up reliable pipelines feeding clean data into reporting." },
];

export const INITIAL_COMPANY_PROFILE = {
  name: "Your company",
  spokenName: "",
  pitch: "AI-powered business intelligence dashboards for mid-market operations teams",
  industry: "Business intelligence / data consulting",
  website: "https://aivhub.io",
  social: "linkedin.com/company/aivhub",
  callerName: "Sam",
  callerId: "",
  tone: "Professional, concise, friendly",
  disclosure: "This call may be recorded for quality and compliance purposes.",
  legalName: "",
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

export const STATUS_MAP = {
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

export const PROFILE_TABS = [
  { id: "identity", label: "Identity", icon: Users },
  { id: "knowledge", label: "Knowledge Sources", icon: BookOpen },
  { id: "services", label: "Services", icon: Package },
  { id: "compliance", label: "Compliance", icon: ShieldCheck },
];

export const SOURCE_TYPES = [
  { id: "Website URL", label: "Website URL", icon: Globe, placeholder: "https://www.aivhub.com/", hint: "Public company website, product documentation, or case study URL." },
  { id: "File upload", label: "Upload file", icon: FileText, placeholder: "", hint: "PDF, Word (.docx), text, Markdown or CSV, up to 10 MB: price lists, service catalogues, FAQs, sales decks." },
  { id: "Google Drive link", label: "Google Drive", icon: Link2, placeholder: "https://drive.google.com/drive/folders/...", hint: "Shared team drive folder or presentation link." },
  { id: "Google Docs link", label: "Google Docs", icon: FileText, placeholder: "https://docs.google.com/document/d/...", hint: "Live internal playbooks, FAQs, and competitor battlecards." },
  { id: "Manual text", label: "Direct Text / Notes", icon: PenLine, placeholder: "Paste raw objection rebuttals, customer Q&As, or pricing rules here...", hint: "Paste custom scripts or internal knowledge directly into the AI's memory." },
];

export const FAMOUS_PROVIDERS_BY_LAYER = {
  "LLM": ["Telnyx AI", "xAI (Grok)", "DeepSeek", "OpenAI", "Anthropic", "Groq", "Mistral", "Together AI", "Other (Custom Base URL)"],
  "Speech-to-Text": ["Deepgram", "Telnyx Whisper", "Faster-Whisper (Self-Hosted)", "OpenAI Whisper", "Gladia", "Speechmatics", "Other (Custom Base URL)"],
  "Text-to-Speech": ["Cartesia", "ElevenLabs", "Telnyx Natural (TTS)", "Deepgram Aura", "PlayHT", "Kokoro-82M (Self-Hosted)", "Other (Custom Base URL)"],
  "Telephony": ["Twilio", "Telnyx", "Plivo", "SIP Trunk (Custom)", "Other (Custom Base URL)"],
  "Calendar": ["Cal.com (Self-Hosted)", "Cal.com (Cloud)", "Google Calendar", "Microsoft Outlook", "Other (Custom Base URL)"],
  "Voice Orchestration": ["LiveKit (Self-Hosted)", "xAI Voice Agent", "Vapi", "Retell AI", "OpenAI Realtime API", "Other (Custom Base URL)"],
  "Business Discovery": ["Apollo.io", "LeadMagic", "Google Places API", "Other (Custom Base URL)"],
  "Other": ["Other (Custom Base URL)"]
};

// Shown under Base URL fields for custom / self-hosted AI.
