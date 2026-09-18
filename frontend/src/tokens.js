export const C = {
  ink: "#12141C",
  inkSoft: "#1B1E29",
  inkLine: "#2A2D3A",
  paper: "#F6F5F2",
  bg: "#F6F5F2",
  paperCard: "#FFFFFF",
  paperSoft: "#EFEDE8",
  border: "#E4E1D9",
  borderLight: "#ECEAE4",
  borderHover: "#3457D5",
  
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
  
  // Gradients & Accents for clean modern polish
  gradientPrimary: "linear-gradient(135deg, #3457D5 0%, #26409E 100%)",
  gradientTeal: "linear-gradient(135deg, #0C8C7D 0%, #15803D 100%)",
  shadowCard: "0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)",
  shadowCardHover: "0 4px 12px rgba(0,0,0,0.08)",
};

export const FONT_DISPLAY = "'Space Grotesk', sans-serif";
export const FONT_BODY = "'Inter', sans-serif";
export const FONT_MONO = "'JetBrains Mono', monospace";
export const HUB_PAPER = "#fcfbf8";

export const STATUS_MAP = {
  active: { label: "Active", fg: "#3457D5", bg: "#EAEEFC" },
  completed: { label: "Completed", fg: "#15803D", bg: "#E7F5EB" },
  paused: { label: "Paused", fg: "#6B7280", bg: "#EFEDE8" },
  needs_attention: { label: "Needs attention", fg: "#B8760A", bg: "#FCEFDA" },
  calling: { label: "Calling", fg: "#3457D5", bg: "#EAEEFC" },
  dialing: { label: "Dialing", fg: "#3457D5", bg: "#EAEEFC" },
  engaged: { label: "Live Call", fg: "#3457D5", bg: "#EAEEFC" },
  queued: { label: "Queued", fg: "#6B7280", bg: "#EFEDE8" },
  retry: { label: "Callback set", fg: "#B8760A", bg: "#FCEFDA" },
  meeting_booked: { label: "Meeting booked", fg: "#0C8C7D", bg: "#E4F5F2" },
  callback_requested: { label: "Callback requested", fg: "#B8760A", bg: "#FCEFDA" },
  human_review: { label: "Needs human review", fg: "#B8760A", bg: "#FCEFDA" },
  rejected: { label: "Do not call", fg: "#C2410C", bg: "#FBEAE8" },
  do_not_call: { label: "Do not call", fg: "#C2410C", bg: "#FBEAE8" },
  contacted: { label: "Contacted", fg: "#6B7280", bg: "#EFEDE8" },
  cold: { label: "Not contacted", fg: "#6B7280", bg: "#EFEDE8" },
  interested: { label: "Interested", fg: "#0C8C7D", bg: "#E4F5F2" },
  converted: { label: "Converted", fg: "#15803D", bg: "#E7F5EB" },
  upcoming: { label: "Upcoming", fg: "#3457D5", bg: "#EAEEFC" },
};

export function initialsFromName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function operatorFromLogin(username) {
  const u = String(username || "").trim();
  if (/^jitendra/i.test(u)) return { username: u, name: "Jitendra S.", role: "Admin" };
  const pretty = u.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { username: u, name: pretty || "Operator", role: "Operator" };
}

export const TIMEZONES = [
  { id: "Europe/London", label: "UK — London (GMT/BST)" },
  { id: "America/New_York", label: "US — Eastern (EST/EDT)" },
  { id: "America/Chicago", label: "US — Central (CST/CDT)" },
  { id: "America/Denver", label: "US — Mountain (MST/MDT)" },
  { id: "America/Los_Angeles", label: "US — Pacific (PST/PDT)" },
  { id: "Europe/Paris", label: "Europe — Central (CET/CEST)" },
  { id: "Asia/Dubai", label: "UAE — Gulf (GST)" },
  { id: "Asia/Kolkata", label: "India — IST" },
  { id: "Asia/Singapore", label: "Singapore / HK (SGT/HKT)" },
  { id: "Australia/Sydney", label: "Australia — Sydney (AEST/AEDT)" },
];

export function timezoneLabel(tzId) {
  const found = TIMEZONES.find((t) => t.id === tzId);
  return found ? found.label : tzId || "UK — London (GMT/BST)";
}

export function timezoneShort(tzId) {
  const map = {
    "Europe/London": "UK",
    "Europe/Paris": "Paris",
    "Europe/Berlin": "Berlin",
    "Europe/Madrid": "Madrid",
    "Europe/Dublin": "Ireland",
    "Asia/Kolkata": "IST",
    "Asia/Dubai": "GST",
    "Asia/Singapore": "SGT",
    "America/New_York": "ET",
    "America/Chicago": "CT",
    "America/Denver": "MT",
    "America/Los_Angeles": "PT",
    "Australia/Sydney": "AEST",
    UTC: "UTC",
  };
  if (!tzId) return "UK";
  return map[tzId] || String(tzId).split("/").pop().replace(/_/g, " ");
}

const GENERIC_LOG_NAMES = /^(valued prospect|prospect|caller|unknown|unknown caller|there|n\/a|na|none)$/i;

export function nameFromTranscript(transcript) {
  const lines = Array.isArray(transcript) ? transcript : [];
  for (const item of lines) {
    const text = typeof item === "string" ? item : (item && item.text) || "";
    const cleaned = String(text).replace(/^(ai|system):\s*/i, "");
    const m = cleaned.match(/\b(?:Hi|Hello|Hey)[, ]+([A-Z][a-zA-Z'’-]{1,40})(?:\s+([A-Z][a-zA-Z'’-]{1,40}))?/);
    if (!m) continue;
    const first = m[1];
    const last = m[2] || "";
    if (/^(this|there|sam|san|everyone|all|valued)$/i.test(first)) continue;
    return `${first} ${last}`.trim();
  }
  return "";
}

export function isGenericLogName(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "—" || raw === "-") return true;
  const stripped = raw.replace(/\(.*?\)/g, "").trim();
  if (!stripped) return true;
  if (GENERIC_LOG_NAMES.test(stripped)) return true;
  if (/^(caller|prospect)\b/i.test(stripped)) return true;
  return false;
}

export function logDisplayName(entry) {
  if (!entry) return "Unknown caller";
  const person = entry.personListedAs || entry.personCanonical || "";
  const spoken = nameFromTranscript(entry.transcript);
  const listed = entry.listedAs || "";
  const company = entry.canonicalName || "";
  if (!isGenericLogName(person)) return person;
  if (spoken) return spoken;
  if (!isGenericLogName(listed) && listed !== company) return listed;
  if (!isGenericLogName(company)) return company;
  return spoken || "Unknown caller";
}

let _notifSeq = 0;

export function notificationFingerprint(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Infer where a notification should open (classic view ids). */
export function resolveNotificationTarget(n) {
  if (n && n.targetView) {
    return {
      targetView: n.targetView,
      targetExtra: n.targetExtra || {},
      targetAction: n.targetAction || null,
    };
  }
  const text = String((n && n.text) || "").toLowerCase();
  let targetView = "tasks";
  let targetExtra = {};
  if (text.includes("meeting") || text.includes("booked") || text.includes("cal.com")) {
    targetView = "meetings";
  } else if (
    text.includes("staff input") || text.includes("live") || text.includes("pricing")
    || text.includes("calling") || text.includes("intervention") || text.includes("human")
    || text.includes("inbound call") || text.includes("outbound to")
  ) {
    targetView = "live";
  } else if (text.includes("schedule") || text.includes("call back") || text.includes("callback") || text.includes("park")) {
    targetView = "schedule";
  } else if (
    text.includes("call log") || text.includes("do-not-call") || text.includes("dnc")
    || text.includes("verbatim") || text.includes("saved to log") || text.includes("saved to logs")
  ) {
    targetView = "calllog";
  } else if (text.includes("provider") || text.includes("api key") || text.includes("integration") || text.includes("ai config") || text.includes("elevenlabs")) {
    targetView = "provider";
  } else if (text.includes("profile") || text.includes("company") || text.includes("voice saved") || text.includes("setup saved")) {
    targetView = "company";
  } else if (text.includes("whatsapp")) {
    targetView = "schedule";
  } else if (text.includes("task") || text.includes("mission") || text.includes("batch") || text.includes("list")) {
    targetView = "tasks";
  }
  return { targetView, targetExtra, targetAction: (n && n.targetAction) || null };
}

export function notificationActionLabel(n) {
  if (n && n.targetAction) return n.targetAction;
  const { targetView } = resolveNotificationTarget(n);
  if (targetView === "meetings") return "Open List view →";
  if (targetView === "live") return "Open Live →";
  if (targetView === "calllog") return "Open Call history →";
  if (targetView === "schedule") return "Open Schedule →";
  if (targetView === "provider") return "Open AI config →";
  if (targetView === "company") return "Open Company →";
  if (targetView === "tasks") return "Open List →";
  return "Go there →";
}

/** Map classic view ids → Calling workspace page ids. */
export function callingPageFromTarget(targetView) {
  const map = {
    live: "live",
    meetings: "schedule",
    booked: "schedule",
    schedule: "schedule",
    calllog: "logs",
    logs: "logs",
    provider: "ai",
    ai: "ai",
    company: "company",
    tasks: "list",
    list: "list",
    plugins: "plugins",
  };
  return map[targetView] || "list";
}

export function makeNotification(text, type = "info", extra = {}) {
  _notifSeq += 1;
  return {
    id: `n_${Date.now()}_${_notifSeq}_${Math.random().toString(36).slice(2, 7)}`,
    text: String(text || "").trim(),
    time: "just now",
    unread: true,
    type: type || "info",
    ...extra,
  };
}

/** Drop duplicate ids + same message text. Keeps newest first. */
export function dedupeNotifications(list) {
  const seenIds = new Set();
  const seenFp = new Set();
  const out = [];
  for (const n of list || []) {
    if (!n || !(n.text || "").trim()) continue;
    const id = n.id || makeNotification(n.text, n.type).id;
    if (seenIds.has(id)) continue;
    const fp = notificationFingerprint(n.text);
    if (fp && seenFp.has(fp)) continue;
    seenIds.add(id);
    if (fp) seenFp.add(fp);
    out.push({ ...n, id });
  }
  return out;
}

/** Prepend one note; skip if same text already near the top. */
export function prependNotification(ns, text, type = "info", extra = {}) {
  const list = Array.isArray(ns) ? ns : [];
  const fp = notificationFingerprint(text);
  if (!fp) return dedupeNotifications(list);
  const already = list.slice(0, 16).some((n) => notificationFingerprint(n.text) === fp);
  if (already) return dedupeNotifications(list);
  return dedupeNotifications([makeNotification(text, type, extra), ...list]).slice(0, 80);
}

export function meetingTimeLabel(m) {
  if (!m) return "";
  const hostTz = m.hostTimezone || m.host_timezone || "Europe/London";
  const pTz = m.prospectTimezone || m.prospect_timezone || hostTz;
  const hostTime = m.time || "";
  const date = m.date || "";
  const host = `${date} · ${hostTime} ${timezoneShort(hostTz)}`.trim();
  const pTime = m.prospectTime || m.prospect_time;
  if (!pTime || pTz === hostTz || pTime === hostTime) return host;
  return `${host} · attendee ${pTime} ${timezoneShort(pTz)}`;
}

/** True if value is a UI mask / ciphertext placeholder — never treat as a real key. */
export function isMaskedSecret(value) {
  const t = String(value || "").trim();
  if (!t) return false;
  return t.includes("•") || t.includes("…") || t.startsWith("enc:v1:");
}

/** Keep provider/model prefs in localStorage; drop raw API keys after they are saved server-side. */
export function scrubSecretsForStorage(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const next = { ...obj };
  for (const k of ["apiKey", "api_key", "imageApiKey", "image_api_key", "authToken", "auth_token", "clientSecret", "signingSecret"]) {
    if (next[k] && !isMaskedSecret(next[k])) {
      next[`has_${k}`] = true;
      next[k] = "";
    }
  }
  if (Array.isArray(next.providers)) {
    next.providers = next.providers.map((p) => {
      if (!p || typeof p !== "object") return p;
      const row = { ...p };
      if (row.apiKey && !isMaskedSecret(row.apiKey)) {
        row.apiKeyMasked = row.apiKeyMasked || (row.apiKey.slice(0, 3) + "••••••••" + row.apiKey.slice(-4));
        row.apiKey = "";
        row.hasKey = true;
      }
      return row;
    });
  }
  return next;
}

export function getActiveAiCredentials(commonAi, pluginType = "leadgen", featureKey = "") {
  // If scheduler, directly read the user's configured scheduler AI settings
  if (pluginType === "scheduler") {
    let schedProv = commonAi?.schedulerAi?.provider;
    let schedKey = commonAi?.schedulerAi?.apiKey;
    let schedModel = commonAi?.schedulerAi?.model || commonAi?.schedulerLayers?.postWriter;
    let schedBaseUrl = commonAi?.schedulerAi?.baseUrl;

    // Also check persisted localStorage for Scheduler AI config
    if (!schedKey || !schedProv) {
      try {
        const s = localStorage.getItem("aivhub_scheduler_ai");
        if (s) {
          const parsed = JSON.parse(s);
          if (!schedKey && parsed.apiKey) schedKey = parsed.apiKey;
          if (!schedProv && parsed.provider) schedProv = parsed.provider;
          if (!schedModel && parsed.model) schedModel = parsed.model;
          if (!schedBaseUrl && parsed.baseUrl) schedBaseUrl = parsed.baseUrl;
        }
      } catch (_) {}
    }

    // If key not entered directly in Scheduler card, look up the key for this chosen provider in commonAi.providers
    if (!schedKey && schedProv && Array.isArray(commonAi?.providers)) {
      const matched = commonAi.providers.find((p) => p.id === schedProv || p.name?.toLowerCase() === schedProv.toLowerCase());
      if (matched && matched.apiKey) {
        schedKey = matched.apiKey;
        schedBaseUrl = schedBaseUrl || matched.baseUrl;
      }
    }

    const openaiProv = (Array.isArray(commonAi?.providers) ? commonAi.providers : []).find(
      (p) => p.id === "openai" || /openai|chatgpt|gpt/i.test(p.name || "")
    );
    const looksClaude = /claude|anthropic|sonnet/i.test(String(schedModel || "") + String(schedProv || ""));
    const hasAnthropic = schedProv === "anthropic" && schedKey;
    if (looksClaude && !hasAnthropic && (openaiProv?.apiKey || (schedProv === "openai" && schedKey))) {
      schedProv = "openai";
      schedKey = schedKey || openaiProv?.apiKey;
      schedModel = "gpt-4o";
      schedBaseUrl = schedBaseUrl || openaiProv?.baseUrl || "https://api.openai.com/v1";
    }

    // Ultimate fallback: check commonAi.providers or localStorage['aivhub_common_ai'] for ANY working key
    if (!schedKey) {
      let provs = Array.isArray(commonAi?.providers) ? commonAi.providers : [];
      if (!provs.length) {
        try {
          const savedCommon = localStorage.getItem("aivhub_common_ai");
          if (savedCommon) {
            const parsed = JSON.parse(savedCommon);
            if (Array.isArray(parsed.providers)) provs = parsed.providers;
          }
        } catch (_) {}
      }
      const anyConnected = provs.find((p) => p.apiKey && p.apiKey.trim().length > 0);
      if (anyConnected) {
        schedKey = anyConnected.apiKey;
        if (!schedProv) schedProv = anyConnected.id;
        if (!schedModel) schedModel = anyConnected.models?.[0] || undefined;
        schedBaseUrl = schedBaseUrl || anyConnected.baseUrl || "";
      }
    }

    return {
      apiKey: isMaskedSecret(schedKey) ? "" : (schedKey || ""),
      provider: schedProv || "openai",
      model: schedModel || "gpt-4o",
      baseUrl: schedBaseUrl || ""
    };
  }

  if (!commonAi) {
    return { apiKey: "", provider: "openai", model: "gpt-4o", baseUrl: "" };
  }

  let modelName = "";
  if (pluginType === "leadgen") modelName = commonAi.leadgenLayers?.[featureKey || "researchLlm"] || "DeepSeek-V3";
  else if (pluginType === "scheduler") modelName = commonAi.schedulerLayers?.[featureKey || "postWriter"] || commonAi.schedulerAi?.model || "gpt-4o";
  else if (pluginType === "email") modelName = commonAi.emailLayers?.[featureKey || "copywriterLlm"] || "Claude 3.5 Sonnet";
  else if (pluginType === "voice") modelName = commonAi.voiceLayers?.[featureKey || "llm"] || "xAI Grok-2";

  // Check custom connections
  const customConn = (commonAi.customConnections || []).find(
    (c) => c.modelId && c.modelId.toLowerCase() === String(modelName).toLowerCase()
  );
  if (customConn && customConn.apiKey) {
    return {
      apiKey: customConn.apiKey,
      provider: customConn.providerName || "custom",
      model: customConn.modelId,
      baseUrl: customConn.baseUrl || ""
    };
  }

  // Check provider in commonAi.providers
  const m = String(modelName || "").toLowerCase();
  let provId = "openai";
  if (m.includes("claude") || m.includes("anthropic") || m.includes("sonnet") || m.includes("haiku")) provId = "anthropic";
  else if (m.includes("gpt") || m.includes("openai") || m.includes("o3")) provId = "openai";
  else if (m.includes("deepseek")) provId = "deepseek";
  else if (m.includes("groq") || m.includes("llama")) provId = "groq";
  else if (m.includes("grok") || m.includes("xai")) provId = "xai";
  else if (m.includes("gemini")) provId = "gemini";
  else if (m.includes("ollama")) provId = "ollama";

  const provObj = (commonAi.providers || []).find((p) => p.id === provId);
  let resolvedKey = provObj?.apiKey || "";

  // Scheduler fallback
  if (!resolvedKey && pluginType === "scheduler") {
    if (commonAi.schedulerAi?.apiKey) {
      resolvedKey = commonAi.schedulerAi.apiKey;
      if (commonAi.schedulerAi.provider) provId = commonAi.schedulerAi.provider;
    } else {
      try {
        const s = localStorage.getItem("aivhub_scheduler_ai");
        if (s) {
          const parsed = JSON.parse(s);
          if (parsed.apiKey) {
            resolvedKey = parsed.apiKey;
            if (parsed.provider) provId = parsed.provider;
          }
        }
      } catch (_) {}
    }
  }

  // Fallback: if resolvedKey is still empty, search ANY connected provider with an API key
  if (!resolvedKey && Array.isArray(commonAi.providers)) {
    const anyConnected = commonAi.providers.find((p) => p.apiKey && p.apiKey.trim().length > 0);
    if (anyConnected) {
      resolvedKey = anyConnected.apiKey;
      provId = anyConnected.id;
      modelName = modelName || anyConnected.models?.[0] || anyConnected.name;
    }
  }

  return {
    apiKey: isMaskedSecret(resolvedKey) ? "" : resolvedKey,
    provider: provId,
    model: modelName || "gpt-4o",
    baseUrl: provObj?.baseUrl || commonAi?.schedulerAi?.baseUrl || ""
  };
}

/** Prefer saved ChatGPT/OpenAI key for images. Never default to Pollinations if that key exists. */
export function resolveImageCredentials(commonAi) {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem("aivhub_scheduler_ai") || "{}") || {};
  } catch (_) {
    saved = {};
  }
  const sched = { ...(commonAi?.schedulerAi || {}), ...saved };
  const providers = Array.isArray(commonAi?.providers) ? commonAi.providers : [];
  const openaiProv = providers.find((p) => p.id === "openai" || /openai|chatgpt|dall/i.test(p.name || ""));
  const openaiKey = [
    sched.imageApiKey,
    sched.imageProvider === "openai" ? sched.apiKey : "",
    openaiProv?.apiKey,
    /openai|gpt|chatgpt/i.test(String(sched.provider || "") + String(sched.model || "")) ? sched.apiKey : "",
  ].map((x) => (x || "").trim()).find((x) => x && !isMaskedSecret(x)) || "";

  const explicitPaid = ["stability", "fal", "custom"].includes(String(sched.imageProvider || "").toLowerCase());
  if (explicitPaid) {
    const rawImg = (sched.imageApiKey || "").trim();
    return {
      imageProvider: sched.imageProvider,
      imageApiKey: isMaskedSecret(rawImg) ? "" : rawImg,
      imageModel: sched.imageModel || "",
      imageBaseUrl: sched.imageBaseUrl || "",
      imageStyle: sched.imageStyle || "modern_saas",
      imageAspectRatio: sched.imageAspectRatio || "16:9",
    };
  }
  if (openaiKey) {
    return {
      imageProvider: "openai",
      imageApiKey: openaiKey,
      imageModel: sched.imageModel && /dall-e|gpt-image/i.test(sched.imageModel) ? sched.imageModel : "dall-e-3",
      imageBaseUrl: sched.imageBaseUrl || openaiProv?.baseUrl || "https://api.openai.com/v1",
      imageStyle: sched.imageStyle || "modern_saas",
      imageAspectRatio: sched.imageAspectRatio || "16:9",
    };
  }
  return {
    imageProvider: sched.imageProvider || "pollinations",
    imageApiKey: (sched.imageApiKey || "").trim(),
    imageModel: sched.imageModel || "",
    imageBaseUrl: sched.imageBaseUrl || "",
    imageStyle: sched.imageStyle || "modern_saas",
    imageAspectRatio: sched.imageAspectRatio || "16:9",
  };
}

