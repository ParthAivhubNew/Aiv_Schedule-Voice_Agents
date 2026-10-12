import React, { useState, useEffect, useRef } from "react";
import {
  KeyRound,
  Plus,
  Trash2,
  Copy,
  Check,
  ShieldCheck,
  AlertCircle,
  X,
  Code2,
  ExternalLink,
  Power,
  CheckCircle2,
  Terminal,
  Lock,
  Radio,
  Send,
  Eye,
  EyeOff,
  Activity,
  FileText,
  RefreshCw,
  Play,
  Sparkles,
  BookOpen,
  Layers,
  Phone,
  Users,
  Share2,
  Wallet,
  Search,
  ChevronDown,
  Mail,
  Calendar,
} from "lucide-react";
import { C, FONT_DISPLAY, FONT_BODY, FONT_MONO } from "../tokens";
import { api } from "../api/apiClient";
import { navigateHash } from "../utils/route";
import { MultiLangCodeBlock, SUPPORTED_LANGS } from "./DeveloperCodeSnippets";
import { DeveloperDocs } from "./DeveloperDocs";
import { GROUPS, ENDPOINTS, defaultBody, endpointKey } from "./developerCatalog";
import { buildSnippet } from "./developerSnippets";

const PLAYGROUND_CATEGORIES = [
  { id: "all", label: "All APIs", icon: Layers },
  { id: "voice", label: "Phone calls", icon: Phone },
  { id: "leads", label: "Find leads", icon: Users },
  { id: "email", label: "Email campaigns", icon: Mail },
  { id: "social", label: "Social posts", icon: Share2 },
  { id: "meetings", label: "Meetings", icon: Calendar },
  { id: "account", label: "Account", icon: Wallet },
];

const getMethodBadge = (method) => {
  switch (method) {
    case "POST":
      return { bg: "#ECFDF5", color: "#059669", border: "#A7F3D0" };
    case "GET":
      return { bg: "#EFF6FF", color: "#2563EB", border: "#BFDBFE" };
    case "PATCH":
      return { bg: "#FEF3C7", color: "#D97706", border: "#FDE68A" };
    case "DELETE":
      return { bg: "#FFE4E6", color: "#E11D48", border: "#FECDD3" };
    default:
      return { bg: "#F1F5F9", color: "#475569", border: "#CBD5E1" };
  }
};

const formatScopePills = (scopes = []) => {
  if (scopes.includes("full_access")) return ["Full Access"];
  const set = new Set(scopes);
  const pills = [];
  if (set.has("voice:calls") || set.has("calendar:book")) {
    pills.push("Voice & Meetings");
  }
  if (set.has("leads:search") || set.has("email:write") || set.has("email:approve")) {
    pills.push("Leads & Campaigns");
  }
  if (set.has("social:publish") || set.has("social:write") || set.has("social:approve")) {
    pills.push("Social Publishing");
  }
  if (set.has("wallets:read") || set.has("wallets")) {
    pills.push("Wallets & Usage");
  }
  scopes.forEach((s) => {
    if (
      ![
        "voice:calls", "calendar:book",
        "leads:search", "email:write", "email:approve",
        "social:publish", "social:write", "social:approve",
        "wallets:read", "wallets"
      ].includes(s)
    ) {
      pills.push(s);
    }
  });
  return pills.length > 0 ? pills : ["Standard Access"];
};

export function DeveloperApiKeysModal({ open, onClose }) {
  const [activeTab, setActiveTab] = useState("keys"); // "keys" | "webhooks" | "playground" | "docs"
  const [keys, setKeys] = useState([]);
  const [availableScopes, setAvailableScopes] = useState([]);
  const [entitlements, setEntitlements] = useState({ voice: false, leads: false, social: false });
  const [hasAnySubscription, setHasAnySubscription] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create Key Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState([]);
  const [isLive, setIsLive] = useState(true);
  const [creating, setCreating] = useState(false);

  // Newly Created Secret Modal
  const [newlyCreatedSecret, setNewlyCreatedSecret] = useState(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // --- Webhooks State ---
  const [webhooks, setWebhooks] = useState([]);
  const [supportedEvents, setSupportedEvents] = useState([]);
  const [loadingWebhooks, setLoadingWebhooks] = useState(false);
  const [revealedWebhookSecrets, setRevealedWebhookSecrets] = useState({});
  const [copiedWebhookSecretId, setCopiedWebhookSecretId] = useState("");
  const [copiedWebhookUrlId, setCopiedWebhookUrlId] = useState("");

  // Create Webhook State
  const [showCreateWebhookModal, setShowCreateWebhookModal] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookDesc, setWebhookDesc] = useState("");
  const [webhookEvents, setWebhookEvents] = useState(["call.completed", "call.failed"]);
  const [creatingWebhook, setCreatingWebhook] = useState(false);
  const [newlyCreatedWebhook, setNewlyCreatedWebhook] = useState(null);

  // Webhook Test Ping State
  const [testingEndpointId, setTestingEndpointId] = useState(null);
  const [testResult, setTestResult] = useState(null);

  // Webhook Delivery Logs State
  const [viewingLogsEndpoint, setViewingLogsEndpoint] = useState(null);
  const [endpointLogs, setEndpointLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // --- API Playground State ---
  const [playgroundKey, setPlaygroundKey] = useState("");
  const [playgroundEndpoint, setPlaygroundEndpoint] = useState("POST /v1/voice/calls");
  const [playgroundPathId, setPlaygroundPathId] = useState("");
  const [playgroundRequestBody, setPlaygroundRequestBody] = useState(defaultBody(ENDPOINTS[0]));
  const [playgroundSending, setPlaygroundSending] = useState(false);
  const [playgroundResponse, setPlaygroundResponse] = useState(null);
  const [playgroundSnippetLang, setPlaygroundSnippetLang] = useState("curl");
  const [copiedCodeSnippet, setCopiedCodeSnippet] = useState(false);
  const [copiedResponseJson, setCopiedResponseJson] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [playgroundCategory, setPlaygroundCategory] = useState("all");
  const [endpointSearch, setEndpointSearch] = useState("");
  const [endpointDropdownOpen, setEndpointDropdownOpen] = useState(false);
  const endpointDropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (endpointDropdownRef.current && !endpointDropdownRef.current.contains(event.target)) {
        setEndpointDropdownOpen(false);
      }
    }
    function handleEscape(e) {
      if (e.key === "Escape") setEndpointDropdownOpen(false);
    }
    if (endpointDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleEscape);
      };
    }
  }, [endpointDropdownOpen]);

  useEffect(() => {
    if (open) {
      loadKeys();
      loadWebhooks();
    } else {
      setNewlyCreatedSecret(null);
      setNewlyCreatedWebhook(null);
      setShowCreateModal(false);
      setShowCreateWebhookModal(false);
      setConfirmDialog(null);
    }
  }, [open]);

  const loadKeys = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.getDeveloperKeys();
      const loadedKeys = res.keys || [];
      const loadedScopes = res.available_scopes || [];
      setKeys(loadedKeys);
      setAvailableScopes(loadedScopes);
      const unlocked = loadedScopes.filter((s) => s.unlocked !== false).map((s) => s.id);
      setSelectedScopes(unlocked);
      setEntitlements(res.entitlements || { voice: false, leads: false, social: false });
      setHasAnySubscription(Boolean(res.has_any_subscription));

      if (!playgroundKey && newlyCreatedSecret) {
        setPlaygroundKey(newlyCreatedSecret);
      }
    } catch (err) {
      setError(err.message || "Failed to load API keys.");
    } finally {
      setLoading(false);
    }
  };

  const loadWebhooks = async () => {
    setLoadingWebhooks(true);
    try {
      const res = await api.getDeveloperWebhooks();
      setWebhooks(res.endpoints || []);
      setSupportedEvents(res.supported_events || []);
    } catch (err) {
      console.warn("Failed to load developer webhooks:", err);
    } finally {
      setLoadingWebhooks(false);
    }
  };

  const handleCreateKey = async (e) => {
    e.preventDefault();
    const finalName = keyName.trim() || "Integration Key";
    setCreating(true);
    setError("");
    try {
      const res = await api.createDeveloperKey({
        name: finalName,
        scopes: selectedScopes,
        live: isLive,
      });
      setNewlyCreatedSecret(res.secret);
      setPlaygroundKey(res.secret);
      setShowCreateModal(false);
      setKeyName("");
      const unlocked = availableScopes.filter((s) => s.unlocked !== false).map((s) => s.id);
      setSelectedScopes(unlocked.length > 0 ? unlocked : (availableScopes[0] ? [availableScopes[0].id] : []));
      await loadKeys();
    } catch (err) {
      setError(err.message || "Failed to create API key.");
    } finally {
      setCreating(false);
    }
  };

  const handleToggleKey = async (key) => {
    try {
      await api.updateDeveloperKey(key.id, { is_active: !key.is_active });
      await loadKeys();
    } catch (err) {
      setError(err.message || "Failed to update key.");
    }
  };

  const handleRevokeKey = (keyId, name) => {
    setConfirmDialog({
      title: "Revoke Admin API Key",
      message: `Are you sure you want to permanently revoke "${name}"? External apps or scripts using this key will immediately fail with 401 Unauthorized.`,
      confirmLabel: "Revoke Key",
      isDanger: true,
      action: async () => {
        try {
          await api.revokeDeveloperKey(keyId);
          await loadKeys();
        } catch (err) {
          setError(err.message || "Failed to revoke key.");
        }
      },
    });
  };

  // --- Webhook Handlers ---
  const handleCreateWebhook = async (e) => {
    e.preventDefault();
    if (!webhookUrl.trim()) return;
    setCreatingWebhook(true);
    setError("");
    try {
      const res = await api.createDeveloperWebhook({
        url: webhookUrl.trim(),
        description: webhookDesc.trim(),
        events: webhookEvents,
      });
      setNewlyCreatedWebhook(res.endpoint);
      setShowCreateWebhookModal(false);
      setWebhookUrl("");
      setWebhookDesc("");
      setWebhookEvents(["call.completed", "call.failed"]);
      await loadWebhooks();
    } catch (err) {
      setError(err.message || "Failed to register webhook endpoint.");
    } finally {
      setCreatingWebhook(false);
    }
  };

  const handleTestWebhook = async (ep) => {
    setTestingEndpointId(ep.id);
    setTestResult(null);
    try {
      const res = await api.testDeveloperWebhook(ep.id);
      setTestResult({
        endpointId: ep.id,
        ...res.result,
      });
      await loadWebhooks();
    } catch (err) {
      setTestResult({
        endpointId: ep.id,
        success: false,
        error: err.message || "Test ping failed",
      });
    } finally {
      setTestingEndpointId(null);
    }
  };

  const handleToggleWebhook = async (ep) => {
    try {
      await api.updateDeveloperWebhook(ep.id, { is_active: !ep.is_active });
      await loadWebhooks();
    } catch (err) {
      setError(err.message || "Failed to update webhook.");
    }
  };

  const handleDeleteWebhook = (ep) => {
    setConfirmDialog({
      title: "Delete Webhook Endpoint",
      message: `Are you sure you want to delete the webhook for "${ep.url}"? Events will no longer be delivered to this URL.`,
      confirmLabel: "Delete Webhook",
      isDanger: true,
      action: async () => {
        try {
          await api.deleteDeveloperWebhook(ep.id);
          await loadWebhooks();
        } catch (err) {
          setError(err.message || "Failed to delete webhook.");
        }
      },
    });
  };

  const handleOpenLogs = async (ep) => {
    setViewingLogsEndpoint(ep);
    setLoadingLogs(true);
    try {
      const res = await api.getDeveloperWebhookLogs(ep.id);
      setEndpointLogs(res.logs || []);
    } catch (err) {
      setEndpointLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  };

  // --- API Playground Handlers ---
  const handleEndpointSelect = (key) => {
    const ep = ENDPOINTS.find((e) => endpointKey(e) === key) || ENDPOINTS[0];
    setPlaygroundEndpoint(key);
    setPlaygroundResponse(null);
    setPlaygroundRequestBody(defaultBody(ep));
    setPlaygroundPathId(ep.pathParam ? ep.pathParam.example : "");
  };

  // The request the playground will send: method, full path (with the id filled in) and whether it carries a body.
  const playgroundRequest = () => {
    const ep = ENDPOINTS.find((e) => endpointKey(e) === playgroundEndpoint) || ENDPOINTS[0];
    const path = ep.pathParam ? ep.path.replace(`{${ep.pathParam.name}}`, (playgroundPathId || ep.pathParam.example).trim()) : ep.path;
    return { ep, method: ep.method, path, hasBody: ep.method !== "GET" && ep.method !== "DELETE" };
  };

  const handleSendPlaygroundRequest = async () => {
    if (!playgroundKey.trim() || playgroundKey.includes("...")) {
      setPlaygroundResponse({
        status: 401,
        statusText: "Full Secret Required",
        durationMs: 0,
        data: {
          error: "Please paste your full secret API key (e.g. sk_live_...). Stored keys only show the prefix (sk_live_...) for security, which cannot be used for authentication.",
        },
        ok: false,
      });
      return;
    }
    setPlaygroundSending(true);
    setPlaygroundResponse(null);
    const startTime = performance.now();
    try {
      const { method, path: targetPath, hasBody } = playgroundRequest();

      const headers = {
        "Content-Type": "application/json",
      };
      if (playgroundKey.trim()) {
        headers["Authorization"] = `Bearer ${playgroundKey.trim()}`;
      }

      const fetchOpts = {
        method,
        headers,
      };
      if (hasBody && playgroundRequestBody.trim()) {
        fetchOpts.body = playgroundRequestBody;
      }

      const res = await fetch(targetPath, fetchOpts);
      const durationMs = Math.round(performance.now() - startTime);
      let data;
      try {
        data = await res.json();
      } catch {
        data = await res.text();
      }

      setPlaygroundResponse({
        status: res.status,
        statusText: res.statusText,
        durationMs,
        data,
        ok: res.ok,
      });
    } catch (err) {
      const durationMs = Math.round(performance.now() - startTime);
      setPlaygroundResponse({
        status: 0,
        statusText: "Network Error",
        durationMs,
        data: { error: err.message || "Failed to communicate with API server" },
        ok: false,
      });
    } finally {
      setPlaygroundSending(false);
    }
  };

  // Generate dynamic client code for the current playground request
  const getGeneratedCodeSnippet = () => {
    const { method, path, hasBody } = playgroundRequest();
    return buildSnippet(playgroundSnippetLang, method, path, playgroundKey, hasBody ? playgroundRequestBody : "");
  };

  const copyToClipboard = (text, type = "secret", id = "") => {
    navigator.clipboard.writeText(text);
    if (type === "secret") {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } else if (type === "wh_secret") {
      setCopiedWebhookSecretId(id);
      setTimeout(() => setCopiedWebhookSecretId(""), 2000);
    } else if (type === "wh_url") {
      setCopiedWebhookUrlId(id);
      setTimeout(() => setCopiedWebhookUrlId(""), 2000);
    } else if (type === "code_snippet") {
      setCopiedCodeSnippet(true);
      setTimeout(() => setCopiedCodeSnippet(false), 2000);
    } else if (type === "response_json") {
      setCopiedResponseJson(true);
      setTimeout(() => setCopiedResponseJson(false), 2000);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(18, 20, 28, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20,
        fontFamily: FONT_BODY,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: 20,
          width: "100%",
          maxWidth: 900,
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 60px rgba(18, 20, 28, 0.25)",
          border: `1px solid ${C.border}`,
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: `1px solid ${C.borderLight}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: C.cobaltSoft,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: C.cobalt,
              }}
            >
              <KeyRound size={20} />
            </div>
            <div>
              <h2
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 18,
                  fontWeight: 700,
                  color: C.textInk,
                  margin: 0,
                }}
              >
                Admin APIs & Webhooks
              </h2>
              <p style={{ margin: "2px 0 0", fontSize: 12.5, color: C.slate }}>
                Headless Voice AI, Lead Gen, and Social APIs for external CRMs & tender applications
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: C.slateLight,
              cursor: "pointer",
              padding: 6,
              borderRadius: 8,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab switcher */}
        <div
          style={{
            display: "flex",
            gap: 20,
            padding: "0 24px",
            borderBottom: `1px solid ${C.borderLight}`,
            backgroundColor: "#FAFBFD",
          }}
        >
          <button
            onClick={() => setActiveTab("keys")}
            style={{
              padding: "12px 4px",
              border: "none",
              background: "none",
              borderBottom: activeTab === "keys" ? `2px solid ${C.cobalt}` : "2px solid transparent",
              color: activeTab === "keys" ? C.cobalt : C.slate,
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <KeyRound size={15} /> Active Keys ({keys.length})
          </button>

          <button
            onClick={() => setActiveTab("webhooks")}
            style={{
              padding: "12px 4px",
              border: "none",
              background: "none",
              borderBottom: activeTab === "webhooks" ? `2px solid ${C.cobalt}` : "2px solid transparent",
              color: activeTab === "webhooks" ? C.cobalt : C.slate,
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Radio size={15} /> Webhooks ({webhooks.length})
          </button>

          <button
            onClick={() => setActiveTab("playground")}
            style={{
              padding: "12px 4px",
              border: "none",
              background: "none",
              borderBottom: activeTab === "playground" ? `2px solid ${C.cobalt}` : "2px solid transparent",
              color: activeTab === "playground" ? C.cobalt : C.slate,
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Play size={15} /> API Playground (Test Live)
          </button>

          <button
            onClick={() => setActiveTab("docs")}
            style={{
              padding: "12px 4px",
              border: "none",
              background: "none",
              borderBottom: activeTab === "docs" ? `2px solid ${C.cobalt}` : "2px solid transparent",
              color: activeTab === "docs" ? C.cobalt : C.slate,
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <BookOpen size={15} /> Documentation & SDKs
          </button>
        </div>

        {/* Body Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {error && (
            <div
              style={{
                backgroundColor: C.redSoft,
                border: "1px solid #F0C4B8",
                color: C.red,
                padding: "10px 14px",
                borderRadius: 10,
                fontSize: 13,
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {/* TAB 1: API KEYS */}
          {activeTab === "keys" && (
            <div>
              {/* Subscription Required Banner if organization has 0 active plans */}
              {!loading && !hasAnySubscription && (
                <div
                  style={{
                    backgroundColor: "#FFFBEB",
                    border: "1px solid #FDE68A",
                    borderRadius: 14,
                    padding: "16px 18px",
                    marginBottom: 20,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: "#FEF3C7",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#B45309",
                        flexShrink: 0,
                      }}
                    >
                      <Lock size={16} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, color: "#92400E" }}>
                        Subscription Required to Use Admin APIs
                      </h4>
                      <p style={{ margin: 0, fontSize: 12.5, color: "#B45309", lineHeight: 1.5 }}>
                        OutReach operates on a <strong>Pay-First</strong> model. To generate and use production API keys,
                        you must subscribe to at least one service (Voice AI, Lead Gen, or Social Media Scheduler).
                      </p>
                      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                        <button
                          onClick={() => {
                            onClose();
                            navigateHash("#/voice/subscription");
                          }}
                          style={{
                            background: C.cobalt,
                            color: "#fff",
                            border: "none",
                            borderRadius: 8,
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          Voice Plans <ExternalLink size={12} />
                        </button>
                        <button
                          onClick={() => {
                            onClose();
                            navigateHash("#/leadgen/subscription");
                          }}
                          style={{
                            background: "#fff",
                            color: "#92400E",
                            border: "1px solid #FCD34D",
                            borderRadius: 8,
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          Lead Gen Plans <ExternalLink size={12} />
                        </button>
                        <button
                          onClick={() => {
                            onClose();
                            navigateHash("#/scheduler/subscription");
                          }}
                          style={{
                            background: "#fff",
                            color: "#92400E",
                            border: "1px solid #FCD34D",
                            borderRadius: 8,
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          Social Plans <ExternalLink size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Action bar */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                }}
              >
                <div>
                  <h3
                    style={{
                      fontFamily: FONT_DISPLAY,
                      fontSize: 15,
                      fontWeight: 700,
                      margin: 0,
                      color: C.textInk,
                    }}
                  >
                    Active API Keys
                  </h3>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: C.slate }}>
                    Secret keys for authenticating requests to <code>/v1/</code> endpoints.
                  </p>
                </div>
                <button
                  onClick={() => setShowCreateModal(true)}
                  style={{
                    backgroundColor: C.cobalt,
                    color: "#fff",
                    border: "none",
                    borderRadius: 10,
                    padding: "8px 14px",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    boxShadow: "0 2px 8px rgba(52, 87, 213, 0.25)",
                  }}
                >
                  <Plus size={16} /> Create New Key
                </button>
              </div>

              {/* Keys List */}
              {loading ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: C.slate, fontSize: 13 }}>
                  Loading API keys...
                </div>
              ) : keys.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "48px 24px",
                    backgroundColor: "#FAFBFD",
                    borderRadius: 16,
                    border: `1px dashed ${C.border}`,
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 16,
                      background: "#F1F5F9",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto 12px",
                      color: C.slate,
                    }}
                  >
                    <KeyRound size={24} />
                  </div>
                  <h4 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: C.textInk }}>
                    No Admin API Keys Yet
                  </h4>
                  <p style={{ margin: "0 auto 16px", fontSize: 12.5, color: C.slate, maxWidth: 360 }}>
                    Generate an API key to connect your CRM, tender automation, or custom apps directly into OutReach.
                  </p>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    style={{
                      backgroundColor: C.cobalt,
                      color: "#fff",
                      border: "none",
                      borderRadius: 10,
                      padding: "8px 16px",
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    Generate First API Key
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {keys.map((k) => (
                    <div
                      key={k.id}
                      style={{
                        padding: 16,
                        borderRadius: 14,
                        border: `1px solid ${C.border}`,
                        backgroundColor: k.is_active ? "#fff" : "#F8FAFC",
                        opacity: k.is_active ? 1 : 0.75,
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span
                            style={{
                              display: "inline-block",
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              backgroundColor: k.is_active ? "#10B981" : "#94A3B8",
                            }}
                          />
                          <span style={{ fontWeight: 600, fontSize: 14, color: C.textInk }}>
                            {k.name}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: "2px 8px",
                              borderRadius: 6,
                              backgroundColor: k.live ? "#ECFDF5" : "#FEF3C7",
                              color: k.live ? "#059669" : "#D97706",
                              textTransform: "uppercase",
                            }}
                          >
                            {k.live ? "Live" : "Test"}
                          </span>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div
                            style={{
                              fontFamily: FONT_MONO,
                              fontSize: 12,
                              color: C.slate,
                              backgroundColor: "#F1F5F9",
                              padding: "4px 10px",
                              borderRadius: 6,
                              letterSpacing: "0.02em",
                            }}
                            title="Key identifier (prefix)"
                          >
                            <span>{k.prefix}...</span>
                          </div>

                          <button
                            onClick={() => handleToggleKey(k)}
                            title={k.is_active ? "Disable key" : "Enable key"}
                            style={{
                              background: "none",
                              border: `1px solid ${C.border}`,
                              borderRadius: 8,
                              padding: "6px 10px",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                              color: k.is_active ? C.slate : C.cobalt,
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <Power size={13} />
                            {k.is_active ? "Disable" : "Enable"}
                          </button>
                          <button
                            onClick={() => handleRevokeKey(k.id, k.name)}
                            title="Revoke key"
                            style={{
                              background: "none",
                              border: `1px solid ${C.border}`,
                              borderRadius: 8,
                              padding: "6px 10px",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                              color: C.red,
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <Trash2 size={13} />
                            Revoke
                          </button>
                        </div>
                      </div>

                      {/* Scopes & metadata */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginTop: 12,
                          paddingTop: 10,
                          borderTop: `1px solid ${C.borderLight}`,
                          fontSize: 11.5,
                          color: C.slate,
                        }}
                      >
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {formatScopePills(k.scopes || []).map((s) => (
                            <span
                              key={s}
                              style={{
                                background: "#EEF2FF",
                                color: "#4338CA",
                                padding: "2px 8px",
                                borderRadius: 6,
                                fontWeight: 600,
                                fontSize: 11,
                              }}
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                        <div>
                          {k.last_used_at
                            ? `Last used: ${new Date(k.last_used_at).toLocaleDateString()}`
                            : "Never used"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: WEBHOOKS */}
          {activeTab === "webhooks" && (
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 16,
                }}
              >
                <div>
                  <h3
                    style={{
                      fontFamily: FONT_DISPLAY,
                      fontSize: 15,
                      fontWeight: 700,
                      margin: 0,
                      color: C.textInk,
                    }}
                  >
                    Webhook Endpoints
                  </h3>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: C.slate }}>
                    Receive real-time signed HTTP POST payloads when calls finish, leads are enriched, or posts go live.
                  </p>
                </div>
                <button
                  onClick={() => setShowCreateWebhookModal(true)}
                  style={{
                    backgroundColor: C.cobalt,
                    color: "#fff",
                    border: "none",
                    borderRadius: 10,
                    padding: "8px 14px",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    boxShadow: "0 2px 8px rgba(52, 87, 213, 0.25)",
                  }}
                >
                  <Plus size={16} /> Register Webhook
                </button>
              </div>

              {/* Webhooks List */}
              {loadingWebhooks ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: C.slate, fontSize: 13 }}>
                  Loading webhook endpoints...
                </div>
              ) : webhooks.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "48px 24px",
                    backgroundColor: "#FAFBFD",
                    borderRadius: 16,
                    border: `1px dashed ${C.border}`,
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 16,
                      background: "#F1F5F9",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto 12px",
                      color: C.slate,
                    }}
                  >
                    <Radio size={24} />
                  </div>
                  <h4 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: C.textInk }}>
                    No Webhook Endpoints Configured
                  </h4>
                  <p style={{ margin: "0 auto 16px", fontSize: 12.5, color: C.slate, maxWidth: 420 }}>
                    Register a webhook URL on your server. OutReach will send instant HMAC-signed notifications with call transcripts, duration, and customer sentiment.
                  </p>
                  <button
                    onClick={() => setShowCreateWebhookModal(true)}
                    style={{
                      backgroundColor: C.cobalt,
                      color: "#fff",
                      border: "none",
                      borderRadius: 10,
                      padding: "8px 16px",
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    Register First Webhook
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {webhooks.map((ep) => {
                    const isSecretRevealed = revealedWebhookSecrets[ep.id];
                    const hasTestResult = testResult && testResult.endpointId === ep.id;

                    return (
                      <div
                        key={ep.id}
                        style={{
                          padding: 16,
                          borderRadius: 14,
                          border: `1px solid ${C.border}`,
                          backgroundColor: ep.is_active ? "#fff" : "#F8FAFC",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.03)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: 10,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span
                              style={{
                                display: "inline-block",
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                backgroundColor: ep.is_active ? "#10B981" : "#94A3B8",
                              }}
                            />
                            <span style={{ fontWeight: 700, fontSize: 14, color: C.textInk }}>
                              {ep.description || "Webhook Endpoint"}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "2px 8px",
                                borderRadius: 6,
                                backgroundColor: ep.is_active ? "#ECFDF5" : "#F1F5F9",
                                color: ep.is_active ? "#059669" : "#64748B",
                              }}
                            >
                              {ep.is_active ? "Active" : "Disabled"}
                            </span>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <button
                              onClick={() => handleTestWebhook(ep)}
                              disabled={testingEndpointId === ep.id || !ep.is_active}
                              style={{
                                background: "#EEF2FF",
                                border: "1px solid #C7D2FE",
                                borderRadius: 8,
                                padding: "5px 10px",
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: ep.is_active ? "pointer" : "not-allowed",
                                color: C.cobalt,
                                display: "flex",
                                alignItems: "center",
                                gap: 5,
                                opacity: ep.is_active ? 1 : 0.6,
                              }}
                            >
                              {testingEndpointId === ep.id ? (
                                <>
                                  <RefreshCw size={12} className="animate-spin" /> Pinging...
                                </>
                              ) : (
                                <>
                                  <Send size={12} /> Test Ping
                                </>
                              )}
                            </button>

                            <button
                              onClick={() => handleOpenLogs(ep)}
                              style={{
                                background: "none",
                                border: `1px solid ${C.border}`,
                                borderRadius: 8,
                                padding: "5px 10px",
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                                color: C.slate,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <FileText size={12} /> Logs
                            </button>

                            <button
                              onClick={() => handleToggleWebhook(ep)}
                              style={{
                                background: "none",
                                border: `1px solid ${C.border}`,
                                borderRadius: 8,
                                padding: "5px 10px",
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                                color: ep.is_active ? C.slate : C.cobalt,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <Power size={12} />
                              {ep.is_active ? "Disable" : "Enable"}
                            </button>

                            <button
                              onClick={() => handleDeleteWebhook(ep)}
                              style={{
                                background: "none",
                                border: `1px solid ${C.border}`,
                                borderRadius: 8,
                                padding: "5px 10px",
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                                color: C.red,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        {/* URL Box */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            backgroundColor: "#0F172A",
                            padding: "8px 12px",
                            borderRadius: 8,
                            marginBottom: 10,
                          }}
                        >
                          <code
                            style={{
                              flex: 1,
                              fontFamily: FONT_MONO,
                              fontSize: 12,
                              color: "#38BDF8",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {ep.url}
                          </code>
                          <button
                            onClick={() => copyToClipboard(ep.url, "wh_url", ep.id)}
                            style={{
                              background: "#1E293B",
                              border: "none",
                              color: "#F8FAFC",
                              padding: "4px 8px",
                              borderRadius: 6,
                              fontSize: 11,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            {copiedWebhookUrlId === ep.id ? <Check size={11} color="#34D399" /> : <Copy size={11} />}
                            {copiedWebhookUrlId === ep.id ? "Copied" : "Copy"}
                          </button>
                        </div>

                        {/* Signing Secret Row */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            backgroundColor: "#F8FAFC",
                            border: `1px solid ${C.borderLight}`,
                            padding: "6px 12px",
                            borderRadius: 8,
                            fontSize: 12,
                            marginBottom: 10,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontWeight: 600, color: C.slate, fontSize: 11.5 }}>Signing Secret:</span>
                            <code
                              style={{
                                fontFamily: FONT_MONO,
                                fontSize: 11.5,
                                color: isSecretRevealed ? "#4338CA" : C.slateLight,
                              }}
                            >
                              {isSecretRevealed ? ep.secret : `${ep.secret.slice(0, 10)}••••••••••••••••••••••••`}
                            </code>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <button
                              onClick={() =>
                                setRevealedWebhookSecrets((prev) => ({
                                  ...prev,
                                  [ep.id]: !prev[ep.id],
                                }))
                              }
                              style={{
                                background: "none",
                                border: "none",
                                color: C.slate,
                                cursor: "pointer",
                                padding: "2px 6px",
                                display: "flex",
                                alignItems: "center",
                                gap: 3,
                                fontSize: 11,
                              }}
                            >
                              {isSecretRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                              {isSecretRevealed ? "Hide" : "Reveal"}
                            </button>
                            <button
                              onClick={() => copyToClipboard(ep.secret, "wh_secret", ep.id)}
                              style={{
                                background: "none",
                                border: "none",
                                color: C.cobalt,
                                cursor: "pointer",
                                padding: "2px 6px",
                                display: "flex",
                                alignItems: "center",
                                gap: 3,
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                            >
                              {copiedWebhookSecretId === ep.id ? <Check size={11} color={C.teal} /> : <Copy size={11} />}
                              {copiedWebhookSecretId === ep.id ? "Copied" : "Copy Secret"}
                            </button>
                          </div>
                        </div>

                        {/* Events and Last Delivery status */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            fontSize: 11.5,
                            color: C.slate,
                            flexWrap: "wrap",
                            gap: 8,
                          }}
                        >
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            <span style={{ fontWeight: 600, color: C.slateLight, fontSize: 11 }}>Events:</span>
                            {(ep.events || []).map((ev) => (
                              <span
                                key={ev}
                                style={{
                                  background: "#ECFDF5",
                                  color: "#047857",
                                  padding: "2px 7px",
                                  borderRadius: 5,
                                  fontWeight: 600,
                                  fontSize: 10.5,
                                  fontFamily: FONT_MONO,
                                }}
                              >
                                {ev}
                              </span>
                            ))}
                          </div>

                          <div>
                            {ep.last_delivery_at ? (
                              <span>
                                Last Delivery:{" "}
                                <strong
                                  style={{
                                    color:
                                      ep.last_delivery_status && ep.last_delivery_status < 400
                                        ? "#059669"
                                        : C.red,
                                  }}
                                >
                                  HTTP {ep.last_delivery_status || "N/A"}
                                </strong>{" "}
                                ({new Date(ep.last_delivery_at).toLocaleTimeString()})
                              </span>
                            ) : (
                              <span>No deliveries yet</span>
                            )}
                          </div>
                        </div>

                        {/* Inline Test Result Banner */}
                        {hasTestResult && (
                          <div
                            style={{
                              marginTop: 12,
                              padding: "8px 12px",
                              borderRadius: 8,
                              backgroundColor: testResult.success ? "#ECFDF5" : "#FEF2F2",
                              border: `1px solid ${testResult.success ? "#A7F3D0" : "#FECACA"}`,
                              fontSize: 12,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              {testResult.success ? (
                                <CheckCircle2 size={15} color="#059669" />
                              ) : (
                                <AlertCircle size={15} color="#DC2626" />
                              )}
                              <span>
                                <strong>{testResult.success ? "Test Ping Succeeded" : "Test Ping Failed"}:</strong>{" "}
                                {testResult.status_code ? `HTTP ${testResult.status_code}` : ""}{" "}
                                {testResult.error || testResult.body || "Delivered successfully"}
                              </span>
                            </div>
                            <span style={{ fontSize: 11, color: C.slate, fontFamily: FONT_MONO }}>
                              {testResult.duration_ms ? `${testResult.duration_ms}ms` : ""}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: API PLAYGROUND (TEST LIVE) */}
          {activeTab === "playground" && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 16, margin: "0 0 4px", color: C.textInk, fontWeight: 700 }}>
                      Interactive API Playground
                    </h3>
                    <p style={{ margin: 0, fontSize: 12.5, color: C.slate }}>
                      Execute real live API requests directly against your OutReach environment and inspect real-time responses.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "3px 8px",
                        borderRadius: 6,
                        backgroundColor: "#ECFDF5",
                        color: "#059669",
                        fontWeight: 600,
                      }}
                    >
                      Base: /v1
                    </span>
                  </div>
                </div>
              </div>

              {/* Category Filter Pills */}
              <div role="tablist" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {PLAYGROUND_CATEGORIES.map((cat) => {
                  const isCatActive = playgroundCategory === cat.id;
                  const count = cat.id === "all" ? ENDPOINTS.length : ENDPOINTS.filter((e) => e.group === cat.id).length;
                  const CatIcon = cat.icon;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      role="tab"
                      aria-selected={isCatActive}
                      onClick={() => {
                        setPlaygroundCategory(cat.id);
                        if (cat.id !== "all") {
                          const firstOfGroup = ENDPOINTS.find((e) => e.group === cat.id);
                          if (firstOfGroup) {
                            handleEndpointSelect(endpointKey(firstOfGroup));
                          }
                        }
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "5px 12px",
                        borderRadius: 20,
                        border: `1px solid ${isCatActive ? C.cobalt : C.border}`,
                        background: isCatActive ? C.cobalt : "#fff",
                        color: isCatActive ? "#fff" : C.textInk,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <CatIcon size={12} color={isCatActive ? "#fff" : C.slate} />
                      <span>{cat.label}</span>
                      <span
                        style={{
                          fontSize: 10,
                          padding: "1px 5px",
                          borderRadius: 8,
                          backgroundColor: isCatActive ? "rgba(255,255,255,0.25)" : "#F1F5F9",
                          color: isCatActive ? "#fff" : C.slate,
                          fontWeight: 700,
                        }}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Control Bar: API Key & Endpoint Selector */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 16,
                  padding: 14,
                  borderRadius: 12,
                  backgroundColor: "#F8FAFC",
                  border: `1px solid ${C.borderLight}`,
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: C.textInk }}>
                      Active API Key (Bearer Token)
                    </label>
                    {playgroundKey && playgroundKey.includes("...") && (
                      <span style={{ fontSize: 11, color: "#D97706", fontWeight: 600 }}>
                        ⚠️ Paste full secret
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={playgroundKey}
                    onChange={(e) => setPlaygroundKey(e.target.value)}
                    placeholder="Paste full secret key (sk_live_...)"
                    style={{
                      width: "100%",
                      height: 38,
                      borderRadius: 8,
                      border: `1px solid ${playgroundKey && playgroundKey.includes("...") ? "#F59E0B" : C.border}`,
                      backgroundColor: "#fff",
                      padding: "0 10px",
                      fontSize: 12,
                      fontFamily: FONT_MONO,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                  <div style={{ fontSize: 11, color: C.slateLight, marginTop: 4 }}>
                    Paste your full secret key (<code style={{ color: C.cobalt }}>sk_live_...</code>) to authenticate live calls.
                  </div>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: C.textInk }}>
                      Select Endpoint
                    </label>
                    <span style={{ fontSize: 11, color: C.slate }}>
                      {playgroundCategory === "all" ? "All endpoints" : PLAYGROUND_CATEGORIES.find((c) => c.id === playgroundCategory)?.label}
                    </span>
                  </div>

                    <div ref={endpointDropdownRef} style={{ position: "relative" }}>
                    <button
                      type="button"
                      title={playgroundRequest().ep.title}
                      onClick={() => setEndpointDropdownOpen(!endpointDropdownOpen)}
                      style={{
                        width: "100%",
                        minHeight: 38,
                        borderRadius: 8,
                        border: `1px solid ${endpointDropdownOpen ? C.cobalt : C.border}`,
                        backgroundColor: "#fff",
                        padding: "5px 10px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        cursor: "pointer",
                        textAlign: "left",
                        boxShadow: endpointDropdownOpen ? "0 0 0 2px rgba(52, 87, 213, 0.15)" : "none",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {(() => {
                        const curEp = playgroundRequest().ep;
                        const b = getMethodBadge(curEp.method);
                        return (
                          <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flex: 1, overflow: "hidden" }}>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 800,
                                padding: "2px 6px",
                                borderRadius: 4,
                                backgroundColor: b.bg,
                                color: b.color,
                                border: `1px solid ${b.border}`,
                                letterSpacing: "0.5px",
                                flexShrink: 0,
                              }}
                            >
                              {curEp.method}
                            </span>
                            <span
                              style={{
                                fontFamily: FONT_MONO,
                                fontSize: 12.5,
                                fontWeight: 700,
                                color: C.textInk,
                                whiteSpace: "nowrap",
                                flexShrink: 0,
                              }}
                            >
                              {curEp.path.split("?")[0]}
                            </span>
                            <span
                              title={curEp.title}
                              style={{
                                fontSize: 11.5,
                                color: C.slate,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                flex: 1,
                              }}
                            >
                              ({curEp.title})
                            </span>
                          </div>
                        );
                      })()}
                      <ChevronDown
                        size={15}
                        color={C.slate}
                        style={{
                          transform: endpointDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                          transition: "transform 0.2s ease",
                          flexShrink: 0,
                        }}
                      />
                    </button>

                    {endpointDropdownOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: "calc(100% + 5px)",
                          left: 0,
                          right: 0,
                          zIndex: 60,
                          backgroundColor: "#fff",
                          borderRadius: 10,
                          border: `1px solid ${C.border}`,
                          boxShadow: "0 10px 25px -4px rgba(15, 23, 42, 0.12), 0 4px 10px -2px rgba(15, 23, 42, 0.06)",
                          overflow: "hidden",
                          display: "flex",
                          flexDirection: "column",
                        }}
                      >
                        <div
                          style={{
                            padding: "8px 10px",
                            borderBottom: `1px solid ${C.borderLight}`,
                            backgroundColor: "#F8FAFC",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <Search size={13} color={C.slate} />
                          <input
                            type="text"
                            value={endpointSearch}
                            onChange={(e) => setEndpointSearch(e.target.value)}
                            placeholder="Filter by path, method, or title..."
                            autoFocus
                            style={{
                              border: "none",
                              outline: "none",
                              width: "100%",
                              fontSize: 12,
                              background: "transparent",
                              color: C.textInk,
                            }}
                          />
                          {endpointSearch && (
                            <button
                              type="button"
                              onClick={() => setEndpointSearch("")}
                              style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0 }}
                            >
                              <X size={12} color={C.slate} />
                            </button>
                          )}
                        </div>

                        <div
                          style={{
                            maxHeight: 280,
                            overflowY: "auto",
                            padding: "4px 0",
                            scrollbarWidth: "thin",
                          }}
                        >
                          {(() => {
                            const filtered = ENDPOINTS.filter((e) => {
                              const matchesCat = playgroundCategory === "all" || e.group === playgroundCategory;
                              if (!matchesCat) return false;
                              if (!endpointSearch.trim()) return true;
                              const q = endpointSearch.toLowerCase();
                              return (
                                e.path.toLowerCase().includes(q) ||
                                e.title.toLowerCase().includes(q) ||
                                e.method.toLowerCase().includes(q) ||
                                (e.summary && e.summary.toLowerCase().includes(q))
                              );
                            });

                            if (filtered.length === 0) {
                              return (
                                <div style={{ padding: "16px 12px", textAlign: "center", fontSize: 12, color: C.slate }}>
                                  No endpoints found matching "{endpointSearch}"
                                </div>
                              );
                            }

                            const groupMap = {};
                            filtered.forEach((e) => {
                              if (!groupMap[e.group]) groupMap[e.group] = [];
                              groupMap[e.group].push(e);
                            });

                            return Object.entries(groupMap).map(([grpId, epList]) => {
                              const grpInfo = GROUPS.find((g) => g.id === grpId) || { label: grpId };
                              return (
                                <div key={grpId} style={{ marginBottom: 2 }}>
                                  {playgroundCategory === "all" && (
                                    <div
                                      style={{
                                        padding: "6px 12px 3px",
                                        fontSize: 10,
                                        fontWeight: 700,
                                        color: C.slate,
                                        textTransform: "uppercase",
                                        letterSpacing: "0.5px",
                                        backgroundColor: "#F8FAFC",
                                        borderBottom: `1px solid ${C.borderLight}`,
                                        borderTop: `1px solid ${C.borderLight}`,
                                      }}
                                    >
                                      {grpInfo.label} ({epList.length})
                                    </div>
                                  )}
                                  {epList.map((e) => {
                                    const key = endpointKey(e);
                                    const isSelected = key === playgroundEndpoint;
                                    const b = getMethodBadge(e.method);
                                    return (
                                      <button
                                        key={key}
                                        type="button"
                                        title={e.title}
                                        onClick={() => {
                                          handleEndpointSelect(key);
                                          setEndpointDropdownOpen(false);
                                          setEndpointSearch("");
                                        }}
                                        style={{
                                          width: "100%",
                                          padding: "7px 12px",
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "space-between",
                                          gap: 8,
                                          border: "none",
                                          backgroundColor: isSelected ? "#EEF2FF" : "transparent",
                                          cursor: "pointer",
                                          textAlign: "left",
                                          transition: "background 0.12s ease",
                                        }}
                                        onMouseEnter={(ev) => {
                                          if (!isSelected) ev.currentTarget.style.backgroundColor = "#F8FAFC";
                                        }}
                                        onMouseLeave={(ev) => {
                                          if (!isSelected) ev.currentTarget.style.backgroundColor = "transparent";
                                        }}
                                      >
                                        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flex: 1, overflow: "hidden" }}>
                                          <span
                                            style={{
                                              fontSize: 9.5,
                                              fontWeight: 800,
                                              padding: "1px 5px",
                                              borderRadius: 4,
                                              backgroundColor: b.bg,
                                              color: b.color,
                                              border: `1px solid ${b.border}`,
                                              letterSpacing: "0.5px",
                                              flexShrink: 0,
                                            }}
                                          >
                                            {e.method}
                                          </span>
                                          <span
                                            style={{
                                              fontFamily: FONT_MONO,
                                              fontSize: 12,
                                              fontWeight: isSelected ? 700 : 500,
                                              color: isSelected ? C.cobalt : C.textInk,
                                              whiteSpace: "nowrap",
                                              flexShrink: 0,
                                            }}
                                          >
                                            {e.path.split("?")[0]}
                                          </span>
                                          <span
                                            title={e.title}
                                            style={{
                                              fontSize: 11.5,
                                              color: C.slate,
                                              overflow: "hidden",
                                              textOverflow: "ellipsis",
                                              whiteSpace: "nowrap",
                                              flex: 1,
                                            }}
                                          >
                                            ({e.title})
                                          </span>
                                        </div>
                                        {isSelected && <Check size={13} color={C.cobalt} style={{ flexShrink: 0 }} />}
                                      </button>
                                    );
                                  })}
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Path parameter input when the endpoint has an {id} */}
              {playgroundRequest().ep.pathParam && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.textInk, marginBottom: 4 }}>
                    Path Parameter: <code>{playgroundRequest().ep.pathParam.name}</code>
                  </label>
                  <input
                    type="text"
                    value={playgroundPathId || playgroundRequest().ep.pathParam.example}
                    onChange={(e) => setPlaygroundPathId(e.target.value)}
                    placeholder={playgroundRequest().ep.pathParam.example}
                    style={{
                      width: "100%",
                      height: 36,
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      padding: "0 12px",
                      fontSize: 12.5,
                      fontFamily: FONT_MONO,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              )}

              {/* Request Body & Response Viewer (Side-by-Side or Stacked) */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
                {/* Request Payload Column */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.textInk }}>Request JSON Body</span>
                    {!playgroundRequest().hasBody && (
                      <span style={{ fontSize: 11, color: C.slate }}>GET endpoints do not use a body</span>
                    )}
                  </div>
                  <textarea
                    rows={11}
                    value={playgroundRequestBody}
                    onChange={(e) => setPlaygroundRequestBody(e.target.value)}
                    disabled={!playgroundRequest().hasBody}
                    placeholder={!playgroundRequest().hasBody ? "No body required for GET" : "{ ... }"}
                    style={{
                      width: "100%",
                      borderRadius: 10,
                      border: `1px solid ${C.border}`,
                      backgroundColor: !playgroundRequest().hasBody ? "#F8FAFC" : "#0F172A",
                      color: !playgroundRequest().hasBody ? C.slate : "#38BDF8",
                      fontFamily: FONT_MONO,
                      fontSize: 12,
                      padding: 12,
                      outline: "none",
                      boxSizing: "border-box",
                      lineHeight: 1.5,
                      resize: "vertical",
                    }}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                    <button
                      onClick={handleSendPlaygroundRequest}
                      disabled={playgroundSending}
                      style={{
                        backgroundColor: C.cobalt,
                        color: "#fff",
                        border: "none",
                        borderRadius: 8,
                        padding: "8px 16px",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        boxShadow: "0 2px 6px rgba(52, 87, 213, 0.25)",
                      }}
                    >
                      {playgroundSending ? (
                        <>
                          <RefreshCw size={14} className="animate-spin" /> Sending...
                        </>
                      ) : (
                        <>
                          <Send size={14} /> Send Live Request
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Response Column */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.textInk }}>Server Response</span>
                      {playgroundResponse && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "1px 7px",
                            borderRadius: 5,
                            backgroundColor:
                              playgroundResponse.status >= 200 && playgroundResponse.status < 300
                                ? "#ECFDF5"
                                : playgroundResponse.status === 402
                                ? "#FEF3C7"
                                : "#FEF2F2",
                            color:
                              playgroundResponse.status >= 200 && playgroundResponse.status < 300
                                ? "#059669"
                                : playgroundResponse.status === 402
                                ? "#D97706"
                                : "#DC2626",
                          }}
                        >
                          HTTP {playgroundResponse.status} {playgroundResponse.statusText}
                        </span>
                      )}
                    </div>
                    {playgroundResponse && (
                      <span style={{ fontSize: 11, color: C.slate, fontFamily: FONT_MONO }}>
                        {playgroundResponse.durationMs}ms
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      height: 240,
                      backgroundColor: "#0F172A",
                      borderRadius: 10,
                      border: `1px solid ${C.border}`,
                      padding: 12,
                      overflowY: "auto",
                      fontFamily: FONT_MONO,
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: "#F8FAFC",
                      position: "relative",
                    }}
                  >
                    {playgroundResponse ? (
                      <>
                        <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                          {typeof playgroundResponse.data === "object"
                            ? JSON.stringify(playgroundResponse.data, null, 2)
                            : String(playgroundResponse.data)}
                        </pre>
                        <button
                          onClick={() =>
                            copyToClipboard(
                              typeof playgroundResponse.data === "object"
                                ? JSON.stringify(playgroundResponse.data, null, 2)
                                : String(playgroundResponse.data),
                              "response_json"
                            )
                          }
                          style={{
                            position: "absolute",
                            top: 8,
                            right: 8,
                            background: "#1E293B",
                            border: "none",
                            color: "#94A3B8",
                            padding: "4px 8px",
                            borderRadius: 6,
                            fontSize: 11,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          {copiedResponseJson ? <Check size={12} color="#34D399" /> : <Copy size={12} />}
                          {copiedResponseJson ? "Copied" : "Copy"}
                        </button>
                      </>
                    ) : (
                      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748B" }}>
                        Click "Send Live Request" to view server output
                      </div>
                    )}
                  </div>

                  {playgroundResponse && playgroundResponse.status === 402 && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: "8px 12px",
                        backgroundColor: "#FFFBEB",
                        border: "1px solid #FDE68A",
                        borderRadius: 8,
                        fontSize: 11.5,
                        color: "#92400E",
                      }}
                    >
                      🔒 <strong>402 Payment Required:</strong> Your API key is authenticated, but your organization needs an active subscription or positive credit balance for this service.
                    </div>
                  )}
                </div>
              </div>

              {/* Dynamic SDK Snippet Generator */}
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.borderLight}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Code2 size={16} color={C.cobalt} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.textInk }}>Client Code Generator</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {SUPPORTED_LANGS.map((lang) => (
                      <button
                        key={lang.id}
                        onClick={() => setPlaygroundSnippetLang(lang.id)}
                        style={{
                          background: playgroundSnippetLang === lang.id ? C.cobaltSoft : "none",
                          border: `1px solid ${playgroundSnippetLang === lang.id ? C.cobalt : C.borderLight}`,
                          color: playgroundSnippetLang === lang.id ? C.cobalt : C.slate,
                          borderRadius: 6,
                          padding: "3px 8px",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {lang.label}
                      </button>
                    ))}
                    <button
                      onClick={() => copyToClipboard(getGeneratedCodeSnippet(), "code_snippet")}
                      style={{
                        background: "#fff",
                        border: `1px solid ${C.border}`,
                        borderRadius: 6,
                        padding: "3px 8px",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                        color: C.textInk,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      {copiedCodeSnippet ? <Check size={12} color={C.teal} /> : <Copy size={12} />}
                      {copiedCodeSnippet ? "Copied" : "Copy Snippet"}
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: "#0F172A",
                    borderRadius: 10,
                    padding: 12,
                    fontFamily: FONT_MONO,
                    fontSize: 11.5,
                    color: "#F8FAFC",
                    overflowX: "auto",
                    lineHeight: 1.5,
                  }}
                >
                  <pre style={{ margin: 0 }}>{getGeneratedCodeSnippet()}</pre>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: DOCUMENTATION */}
          {activeTab === "docs" && (
            <DeveloperDocs
              apiKey={playgroundKey && !playgroundKey.includes("...") ? playgroundKey : "sk_test_YOUR_KEY"}
              events={supportedEvents}
              webhookSecret={webhooks && webhooks[0] ? webhooks[0].secret : ""}
            />
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 24px",
            borderTop: `1px solid ${C.borderLight}`,
            backgroundColor: "#FAFBFD",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
            color: C.slate,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ShieldCheck size={16} color={C.teal} />
            <span>API keys are hashed with SHA-256; Webhook payloads are signed with HMAC-SHA256.</span>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: "#fff",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 12.5,
              color: C.textInk,
            }}
          >
            Close
          </button>
        </div>
      </div>

      {/* --- CREATE KEY MODAL --- */}
      {showCreateModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
          }}
          onClick={() => setShowCreateModal(false)}
        >
          <div
            style={{
              backgroundColor: "#fff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 480,
              padding: 24,
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 700, margin: "0 0 12px" }}>
              Generate Admin API Key
            </h3>

            <form onSubmit={handleCreateKey}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: C.textInk, marginBottom: 6 }}>
                  Key Name / Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Tender App Backend, CRM Integration (optional)"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  autoFocus
                  style={{
                    width: "100%",
                    height: 40,
                    borderRadius: 10,
                    border: `1px solid ${C.border}`,
                    padding: "0 12px",
                    fontSize: 13.5,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Scopes */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: C.textInk, marginBottom: 8 }}>
                  Allowed Permissions (Scopes)
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {availableScopes.map((scope) => {
                    const isUnlocked = scope.unlocked !== false;
                    const isSelected = selectedScopes.includes(scope.id);

                    if (!isUnlocked) {
                      return (
                        <div
                          key={scope.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                            padding: "8px 12px",
                            borderRadius: 10,
                            backgroundColor: "#F8FAFC",
                            border: `1px solid ${C.borderLight}`,
                            opacity: 0.7,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <input type="checkbox" disabled checked={false} style={{ cursor: "not-allowed" }} />
                            <div>
                              <div style={{ fontWeight: 600, color: C.slate, fontSize: 13 }}>
                                {scope.label}
                              </div>
                              <div style={{ fontSize: 11.5, color: C.slateLight }}>
                                {scope.desc}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span
                              style={{
                                fontSize: 10.5,
                                fontWeight: 700,
                                color: "#B45309",
                                background: "#FEF3C7",
                                padding: "2px 7px",
                                borderRadius: 6,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <Lock size={10} />
                              Locked
                            </span>
                            {scope.service !== "all" && scope.service !== "any" && (
                              <button
                                type="button"
                                onClick={() => {
                                  setShowCreateModal(false);
                                  onClose();
                                  const route =
                                    scope.service === "voice"
                                      ? "#/voice/subscription"
                                      : scope.service === "leads"
                                      ? "#/leadgen/subscription"
                                      : "#/scheduler/subscription";
                                  navigateHash(route);
                                }}
                                style={{
                                  background: "#EEF2FF",
                                  border: "1px solid #C7D2FE",
                                  color: C.cobalt,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  padding: "3px 8px",
                                  borderRadius: 6,
                                  cursor: "pointer",
                                }}
                              >
                                Subscribe →
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <label
                        key={scope.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          fontSize: 13,
                          cursor: "pointer",
                          padding: "8px 12px",
                          borderRadius: 10,
                          backgroundColor: isSelected ? C.cobaltSoft : "#FAFBFD",
                          border: `1px solid ${isSelected ? C.cobalt : C.borderLight}`,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedScopes([...selectedScopes, scope.id]);
                            } else {
                              setSelectedScopes(selectedScopes.filter((s) => s !== scope.id));
                            }
                          }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontWeight: 600, color: C.textInk }}>{scope.label}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#059669", background: "#ECFDF5", padding: "1px 6px", borderRadius: 4 }}>
                              Active Plan
                            </span>
                          </div>
                          <div style={{ fontSize: 11.5, color: C.slate }}>{scope.desc}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: "#fff",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  style={{
                    padding: "8px 20px",
                    borderRadius: 8,
                    border: "none",
                    background: C.cobalt,
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {creating ? "Generating..." : "Generate Key"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- REGISTER WEBHOOK MODAL --- */}
      {showCreateWebhookModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
          }}
          onClick={() => setShowCreateWebhookModal(false)}
        >
          <div
            style={{
              backgroundColor: "#fff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 520,
              padding: 24,
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 700, margin: "0 0 12px" }}>
              Register Webhook Endpoint
            </h3>

            <form onSubmit={handleCreateWebhook}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: C.textInk, marginBottom: 6 }}>
                  Endpoint URL
                </label>
                <input
                  type="url"
                  placeholder="https://your-crm.com/api/webhooks/outreach"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  required
                  autoFocus
                  style={{
                    width: "100%",
                    height: 40,
                    borderRadius: 10,
                    border: `1px solid ${C.border}`,
                    padding: "0 12px",
                    fontSize: 13.5,
                    fontFamily: FONT_MONO,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <span style={{ fontSize: 11, color: C.slate, marginTop: 4, display: "block" }}>
                  Must begin with <code>https://</code> (or <code>http://localhost</code> for local development).
                </span>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: C.textInk, marginBottom: 6 }}>
                  Description / Partner App
                </label>
                <input
                  type="text"
                  placeholder="e.g. Tender Portal Call Logger"
                  value={webhookDesc}
                  onChange={(e) => setWebhookDesc(e.target.value)}
                  style={{
                    width: "100%",
                    height: 40,
                    borderRadius: 10,
                    border: `1px solid ${C.border}`,
                    padding: "0 12px",
                    fontSize: 13.5,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Events Checklist */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: C.textInk, marginBottom: 8 }}>
                  Subscribed Events
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {supportedEvents.map((ev) => {
                    const isChecked = webhookEvents.includes(ev.id);

                    return (
                      <label
                        key={ev.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          fontSize: 12.5,
                          cursor: "pointer",
                          padding: "8px 12px",
                          borderRadius: 10,
                          backgroundColor: isChecked ? "#ECFDF5" : "#FAFBFD",
                          border: `1px solid ${isChecked ? "#A7F3D0" : C.borderLight}`,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setWebhookEvents([...webhookEvents, ev.id]);
                            } else {
                              setWebhookEvents(webhookEvents.filter((id) => id !== ev.id));
                            }
                          }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontWeight: 600, color: C.textInk }}>{ev.label}</span>
                            <code style={{ fontSize: 10.5, color: C.slate, fontFamily: FONT_MONO }}>{ev.id}</code>
                          </div>
                          <div style={{ fontSize: 11, color: C.slate }}>{ev.desc}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  onClick={() => setShowCreateWebhookModal(false)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: "#fff",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingWebhook || !webhookUrl.trim() || webhookEvents.length === 0}
                  style={{
                    padding: "8px 20px",
                    borderRadius: 8,
                    border: "none",
                    background: C.cobalt,
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {creatingWebhook ? "Registering..." : "Register Webhook"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- NEW WEBHOOK SECRET CREATED MODAL --- */}
      {newlyCreatedWebhook && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1200,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              backgroundColor: "#fff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 520,
              padding: 24,
              boxShadow: "0 25px 60px rgba(0, 0, 0, 0.35)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.teal, marginBottom: 12 }}>
              <CheckCircle2 size={24} />
              <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, margin: 0, color: C.textInk }}>
                Webhook Endpoint Registered
              </h3>
            </div>

            <p style={{ fontSize: 13, color: C.slate, margin: "0 0 16px", lineHeight: 1.5 }}>
              Use the signing secret below in your server to verify the authenticity of incoming
              <code> X-Outreach-Signature</code> headers.
            </p>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                backgroundColor: "#0F172A",
                padding: "10px 14px",
                borderRadius: 10,
                marginBottom: 20,
              }}
            >
              <code
                style={{
                  flex: 1,
                  fontFamily: FONT_MONO,
                  fontSize: 13,
                  color: "#38BDF8",
                  wordBreak: "break-all",
                }}
              >
                {newlyCreatedWebhook.secret}
              </code>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard(newlyCreatedWebhook.secret, "secret");
                }}
                style={{
                  backgroundColor: copiedSecret ? C.teal : "#334155",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                {copiedSecret ? <Check size={14} /> : <Copy size={14} />}
                {copiedSecret ? "Copied!" : "Copy"}
              </button>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setNewlyCreatedWebhook(null);
              }}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: 10,
                border: "none",
                background: C.cobalt,
                color: "#fff",
                fontWeight: 600,
                fontSize: 13.5,
                cursor: "pointer",
              }}
            >
              I have saved the signing secret
            </button>
          </div>
        </div>
      )}

      {/* --- DELIVERY LOGS MODAL --- */}
      {viewingLogsEndpoint && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1200,
            padding: 20,
          }}
          onClick={() => setViewingLogsEndpoint(null)}
        >
          <div
            style={{
              backgroundColor: "#fff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 620,
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 25px 60px rgba(0, 0, 0, 0.35)",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "16px 20px",
                borderBottom: `1px solid ${C.borderLight}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, margin: 0, color: C.textInk }}>
                  Recent Webhook Deliveries
                </h3>
                <p style={{ margin: "2px 0 0", fontSize: 11.5, color: C.slate, fontFamily: FONT_MONO }}>
                  {viewingLogsEndpoint.url}
                </p>
              </div>
              <button
                onClick={() => setViewingLogsEndpoint(null)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: C.slate,
                  padding: 4,
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
              {loadingLogs ? (
                <div style={{ textAlign: "center", padding: "30px 0", color: C.slate, fontSize: 13 }}>
                  Loading delivery logs...
                </div>
              ) : endpointLogs.length === 0 ? (
                <div style={{ textAlign: "center", padding: "30px 0", color: C.slate, fontSize: 13 }}>
                  No webhook events have been delivered to this endpoint yet.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {endpointLogs.map((log) => (
                    <div
                      key={log.id}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 10,
                        backgroundColor: "#F8FAFC",
                        border: `1px solid ${C.borderLight}`,
                        fontSize: 12,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: 4,
                              backgroundColor: log.success ? "#ECFDF5" : "#FEF2F2",
                              color: log.success ? "#059669" : "#DC2626",
                            }}
                          >
                            HTTP {log.status_code || "ERR"}
                          </span>
                          <span style={{ fontWeight: 600, fontFamily: FONT_MONO, color: C.textInk }}>
                            {log.event_type}
                          </span>
                        </div>
                        <span style={{ fontSize: 11, color: C.slate }}>
                          {log.created_at ? new Date(log.created_at).toLocaleTimeString() : ""}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", color: C.slate, fontSize: 11 }}>
                        <span>Latency: {log.duration_ms}ms</span>
                        {log.error_message && <span style={{ color: C.red }}>{log.error_message}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div
              style={{
                padding: "12px 20px",
                borderTop: `1px solid ${C.borderLight}`,
                backgroundColor: "#FAFBFD",
                textAlign: "right",
              }}
            >
              <button
                onClick={() => setViewingLogsEndpoint(null)}
                style={{
                  padding: "6px 16px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  fontWeight: 600,
                  fontSize: 12.5,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- SECRET REVEALED MODAL (ONCE ONLY FOR API KEYS) --- */}
      {newlyCreatedSecret && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1200,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              backgroundColor: "#fff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 520,
              padding: 24,
              boxShadow: "0 25px 60px rgba(0, 0, 0, 0.35)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.teal, marginBottom: 12 }}>
              <CheckCircle2 size={24} />
              <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, margin: 0, color: C.textInk }}>
                API Key Generated Successfully
              </h3>
            </div>

            <p style={{ fontSize: 13, color: C.slate, margin: "0 0 16px", lineHeight: 1.5 }}>
              Please copy your API key and store it securely in your backend environment variables (e.g. <code>.env</code>).
              <strong style={{ display: "block", color: C.red, marginTop: 4 }}>
                ⚠️ For security reasons, you will never be able to see this key again!
              </strong>
            </p>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                backgroundColor: "#0F172A",
                padding: "10px 14px",
                borderRadius: 10,
                marginBottom: 20,
              }}
            >
              <code
                style={{
                  flex: 1,
                  fontFamily: FONT_MONO,
                  fontSize: 13,
                  color: "#38BDF8",
                  wordBreak: "break-all",
                }}
              >
                {newlyCreatedSecret}
              </code>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard(newlyCreatedSecret, "secret");
                }}
                style={{
                  backgroundColor: copiedSecret ? C.teal : "#334155",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                {copiedSecret ? <Check size={14} /> : <Copy size={14} />}
                {copiedSecret ? "Copied!" : "Copy"}
              </button>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setNewlyCreatedSecret(null);
              }}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: 10,
                border: "none",
                background: C.cobalt,
                color: "#fff",
                fontWeight: 600,
                fontSize: 13.5,
                cursor: "pointer",
              }}
            >
              I have saved my key safely
            </button>
          </div>
        </div>
      )}

      {/* --- IN-APP CONFIRMATION MODAL --- */}
      {confirmDialog && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(18, 20, 28, 0.65)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1300,
            padding: 20,
          }}
          onClick={(e) => {
            e.stopPropagation();
            setConfirmDialog(null);
          }}
        >
          <div
            style={{
              backgroundColor: "#fff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 440,
              padding: 24,
              boxShadow: "0 25px 60px rgba(0, 0, 0, 0.35)",
              border: `1px solid ${C.border}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: confirmDialog.isDanger ? "#FEE2E2" : "#EFF6FF",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: confirmDialog.isDanger ? "#DC2626" : C.cobalt,
                  flexShrink: 0,
                }}
              >
                {confirmDialog.isDanger ? <Trash2 size={20} /> : <AlertCircle size={20} />}
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, margin: "0 0 6px", color: C.textInk }}>
                  {confirmDialog.title}
                </h3>
                <p style={{ margin: 0, fontSize: 13, color: C.slate, lineHeight: 1.5 }}>
                  {confirmDialog.message}
                </p>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  color: C.textInk,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const act = confirmDialog.action;
                  setConfirmDialog(null);
                  if (act) await act();
                }}
                style={{
                  padding: "8px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: confirmDialog.isDanger ? "#DC2626" : C.cobalt,
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {confirmDialog.isDanger && <Trash2 size={14} />}
                {confirmDialog.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
