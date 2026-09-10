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

export function getActiveAiCredentials(commonAi, pluginType = "leadgen", featureKey = "") {
  // If scheduler, check schedulerAi state, localStorage, and commonAi.providers
  if (pluginType === "scheduler") {
    let schedProv = commonAi?.schedulerAi?.provider;
    let schedKey = commonAi?.schedulerAi?.apiKey;
    let schedModel = commonAi?.schedulerAi?.model || commonAi?.schedulerLayers?.postWriter;
    let schedBaseUrl = commonAi?.schedulerAi?.baseUrl;

    if (!schedKey) {
      try {
        const s = localStorage.getItem("aivhub_scheduler_ai");
        if (s) {
          const parsed = JSON.parse(s);
          if (parsed.apiKey) schedKey = parsed.apiKey;
          if (parsed.provider) schedProv = parsed.provider;
          if (parsed.model) schedModel = schedModel || parsed.model;
          if (parsed.baseUrl) schedBaseUrl = schedBaseUrl || parsed.baseUrl;
        }
      } catch (_) {}
    }

    // If key not in schedulerAi, check if key is in commonAi.providers for schedProv
    if (!schedKey && schedProv && Array.isArray(commonAi?.providers)) {
      const matched = commonAi.providers.find((p) => p.id === schedProv || p.name?.toLowerCase() === schedProv.toLowerCase());
      if (matched && matched.apiKey) {
        schedKey = matched.apiKey;
        schedBaseUrl = schedBaseUrl || matched.baseUrl;
      }
    }

    // Check if schedModel matches any provider in commonAi.providers
    if (!schedKey && schedModel && Array.isArray(commonAi?.providers)) {
      const sm = schedModel.toLowerCase();
      let matchedId = sm.includes("claude") || sm.includes("anthropic") ? "anthropic" :
                      sm.includes("gpt") || sm.includes("openai") ? "openai" :
                      sm.includes("deepseek") ? "deepseek" :
                      sm.includes("groq") || sm.includes("llama") ? "groq" :
                      sm.includes("grok") || sm.includes("xai") ? "xai" : "";
      if (matchedId) {
        const matched = commonAi.providers.find((p) => p.id === matchedId);
        if (matched && matched.apiKey) {
          schedKey = matched.apiKey;
          schedProv = matchedId;
          schedBaseUrl = schedBaseUrl || matched.baseUrl;
        }
      }
    }

    // Fallback: search ANY connected provider in commonAi.providers that has an API key
    if (!schedKey && Array.isArray(commonAi?.providers)) {
      const anyConn = commonAi.providers.find((p) => p.apiKey && p.apiKey.trim().length > 0);
      if (anyConn) {
        schedKey = anyConn.apiKey;
        schedProv = anyConn.id;
        schedModel = schedModel || anyConn.models?.[0] || anyConn.name;
        schedBaseUrl = schedBaseUrl || anyConn.baseUrl;
      }
    }

    if (schedKey) {
      return {
        apiKey: schedKey,
        provider: schedProv || "openai",
        model: schedModel || "gpt-4o",
        baseUrl: schedBaseUrl || ""
      };
    }
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
    apiKey: resolvedKey,
    provider: provId,
    model: modelName || "gpt-4o",
    baseUrl: provObj?.baseUrl || commonAi?.schedulerAi?.baseUrl || ""
  };
}

