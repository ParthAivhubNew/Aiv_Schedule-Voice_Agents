import {
  Activity,
  BarChart3,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  Layers,
  Lock,
  Mail,
  Phone,
  PhoneCall,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  User,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/apiClient";
import {
  C,
  EMAIL_LAYERS,
  FONT_BODY,
  FONT_DISPLAY,
  FONT_MONO,
  HUB_PAPER,
  INITIAL_COMMON_AI_CONFIG,
  LEADGEN_LAYERS,
  liveStackLabels,
  syncCommonAiWithBackend,
  VOICE_LAYERS,
  voiceLayersFromHub,
} from "../app/constants";

export function CommonAiConfigModal({ isOpen, onClose, commonAi, setCommonAi, initialTab = "leadgen", onNavigateToPlugin, operator, onOpenCalcomAdmin, scopePlugin = null, embedded = false }) {
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
                  : "AI Configuration"}
              </div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 2 }}>
                {scopePlugin
                  ? "Models and keys for this app only. Home AI Configuration still has every app."
                  : "Configure models, connect custom API keys, and manage capabilities for each app"}
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
                        {usageStats?.tenantName || operator?.name || "OutReach by Aivhub Workspace"}
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
                  <span>Usage Distribution Across Apps</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: C.slate }}>Live metered metrics</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.6fr 1fr 0.8fr", padding: "10px 18px", background: HUB_PAPER, borderBottom: `1px solid ${C.borderLight}`, fontSize: 11.5, fontWeight: 700, color: C.slate, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <span>App</span>
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
            <span>{dirty ? "Saved & synchronized across apps" : "All app models in sync"}</span>
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
