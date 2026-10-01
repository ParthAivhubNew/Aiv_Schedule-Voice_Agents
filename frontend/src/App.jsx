import React, { useEffect, useRef, useState } from "react";
import { api } from "./api/apiClient";
import { AUTH_LOST_EVENT, hasSession, PASSWORD_CHANGE_EVENT } from "./api/authStore";
import { WebSocketClient } from "./api/wsClient";
import { INITIAL_COMMON_AI_CONFIG, INITIAL_COMPANY_PROFILE, INITIAL_FAQ, INITIAL_KNOWLEDGE_SOURCES, INITIAL_SERVICES, syncCommonAiWithBackend } from "./app/constants";
import { AppChrome } from "./app/ui";
import { ChangePasswordScreen } from "./hub/ChangePasswordScreen";
import { LoginScreen } from "./hub/LoginScreen";
import { AppHome } from "./hub/AppHome";
import { UniversalCallNotificationBanner } from "./hub/PluginHub";
import { ProfileSettingsModal } from "./hub/ProfileSettingsModal";
import { OrgSettingsProvider } from "./org/orgSettings";
import { CalcomAdminModal } from "./plugins/calendar/CalcomAdminModal";
import { CalcomSchedulerPlugin } from "./plugins/calendar/CalcomSchedulerPlugin";
import EmailOutreachPlugin from "./plugins/email/EmailOutreachPlugin";
import LeadGenerationPlugin from "./plugins/leadgen/LeadGenerationPlugin";
import { SocialWorkspaceGate } from "./plugins/scheduler/SocialWorkspace";
import { CompanyProfileView } from "./plugins/voice/CompanyProfileView";
import { CallingWorkspace } from "./plugins/voice/calling/CallingWorkspace";
import { CommonAiConfigModal } from "./settings/CommonAiConfigModal";
import { ProviderConfigView } from "./settings/ProviderConfigView";
import { TeamModal } from "./team/TeamModal";
import { navigateHash, onRouteChange, replaceHash, routeHash } from "./utils/route";

function CallingRoot(props) {
  // AI and carrier keys are run by OutReach: only its own organisation sees that page.
  return (
    <CallingWorkspace
      {...props}
      aiKeysPanel={props.operator?.is_platform_org && (
        <ProviderConfigView
          embedded
          notifications={props.notifications || []}
          setNotifications={props.setNotifications || (() => {})}
          commonAi={props.commonAi}
          setCommonAi={props.setCommonAi}
          profile={props.profile}
          setProfile={props.setProfile}
        />
      )}
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

function savedOperator() {
  try {
    const saved = sessionStorage.getItem("aivhub_operator");
    // An operator without sign-in tokens (older app version) must sign in again.
    return saved && hasSession() ? JSON.parse(saved) : null;
  } catch (_) {
    return null;
  }
}

// Sign-in gate: nothing of the app mounts (or calls the API) until the user is signed in and
// has a password of their own.
export default function App() {
  const [session, setSession] = useState(() => {
    const op = savedOperator();
    return op ? { operator: op, key: op.id + ":" + Date.now() } : null;
  });
  const [mustChangePassword, setMustChangePassword] = useState(() => Boolean(session && session.operator.must_change_password));

  useEffect(() => {
    const lost = () => {
      setSession(null);
      setMustChangePassword(false);
    };
    const needChange = () => setMustChangePassword(true);
    window.addEventListener(AUTH_LOST_EVENT, lost);
    window.addEventListener(PASSWORD_CHANGE_EVENT, needChange);
    return () => {
      window.removeEventListener(AUTH_LOST_EVENT, lost);
      window.removeEventListener(PASSWORD_CHANGE_EVENT, needChange);
    };
  }, []);

  const signOut = () => {
    api.logout();
    setSession(null);
    setMustChangePassword(false);
  };

  if (!session) {
    return (
      <>
      <AppChrome />
      <LoginScreen
        onLogin={(op) => {
          try { sessionStorage.setItem("aivhub_operator", JSON.stringify(op)); } catch (_) {}
          setMustChangePassword(Boolean(op && op.must_change_password));
          setSession({ operator: op, key: op.id + ":" + Date.now() });
        }}
      />
      </>
    );
  }
  if (mustChangePassword) {
    return (
      <ChangePasswordScreen
        operator={session.operator}
        onDone={(me) => {
          try { sessionStorage.setItem("aivhub_operator", JSON.stringify(me)); } catch (_) {}
          setMustChangePassword(false);
          setSession({ operator: me, key: me.id + ":" + Date.now() });
        }}
        onLogout={signOut}
      />
    );
  }
  return <MainApp key={session.key} onSignedOut={signOut} />;
}

function MainApp({ onSignedOut }) {
  const [operator, setOperator] = useState(() => savedOperator());

  // Refresh who I am and what I can see (roles may have changed since sign-in).
  const operatorId = operator && operator.id;
  // Only OutReach's own organisation manages AI and carrier keys; clients never see those screens.
  const platformOrg = Boolean(operator && operator.is_platform_org);
  useEffect(() => {
    if (!operatorId) return;
    api.getMe().then((me) => {
      if (!me) return;
      setOperator((prev) => ({ ...(prev || {}), ...me }));
      try { sessionStorage.setItem("aivhub_operator", JSON.stringify(me)); } catch (_) {}
    }).catch(() => {});
  }, [operatorId]);

  const parseRoute = () => {
    try {
      const hash = routeHash().replace(/^#\/?/, "");
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
      navigateHash("#/voice/live");
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
          navigateHash("#/voice/list");
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
          navigateHash(target);
        }
      } else {
        localStorage.removeItem("aivhub_active_plugin");
        if (routeHash() && routeHash() !== "#/" && routeHash() !== "#") {
          replaceHash("");
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
    return onRouteChange(onHashChange);
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
  const [teamInitialTab, setTeamInitialTab] = useState("users");
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
        if (platformOrg) try {
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
        // The organisation's real sources, even none: never the demo list.
        if (Array.isArray(s)) {
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
      if (platformOrg) try {
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
  }, [platformOrg]);

  const handleLogout = () => {
    try {
      sessionStorage.removeItem("aivhub_operator");
      sessionStorage.removeItem("aivhub_return_plugin");
      localStorage.removeItem("aivhub_active_plugin");
      replaceHash("");
    } catch (_) {}
    setVisitedPlugins([]);
    setReturnPlugin(null);
    setOperator(null);
    setPlugin(null);
    onSignedOut();
  };

  const handleBackToHub = () => {
    try {
      localStorage.removeItem("aivhub_active_plugin");
      localStorage.setItem("aivhub_voice_view", "list");
      navigateHash("");
    } catch (_) {}
    setPlugin(null);
  };

  const handlePickPlugin = (p) => {
    if (p === "voice") {
      try {
        localStorage.setItem("aivhub_voice_view", "list");
        navigateHash("#/voice/list");
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

  if (!operator) return null;
  
  return (
    <OrgSettingsProvider>
      {!plugin && (
        <SafeErrorBoundary label="Plugin Hub" onReset={handleBackToHub}>
          <AppHome
            operator={operator}
            onPick={handlePickPlugin}
            onLogout={handleLogout}
            commonAi={commonAi}
            onOpenCommonAi={platformOrg ? (tab) => { if (tab) setCommonAiTab(tab); setCommonAiScope(null); setShowCommonAiModal(true); } : null}
            onOpenTeamUsers={(tab) => { setTeamInitialTab(typeof tab === "string" ? tab : "users"); setShowTeamModal(true); }}
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
              <CallingRoot
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
                onOpenCommonAi={platformOrg ? () => { setCommonAiTab("voice"); setCommonAiScope("voice"); setShowCommonAiModal(true); } : null}
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
        isOpen={platformOrg && showCommonAiModal}
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
              navigateHash("#/voice/list");
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

      <TeamModal
        isOpen={showTeamModal}
        onClose={() => setShowTeamModal(false)}
        currentUser={operator}
        initialTab={teamInitialTab}
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
