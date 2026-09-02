import React, { useState, useEffect } from "react";
import { AppChrome } from "./components/AppChrome";
import { Sidebar } from "./components/Sidebar";
import { LoginScreen } from "./hub/LoginScreen";
import { PluginHub } from "./hub/PluginHub";
import { MissionsView, MissionDetail } from "./views/MissionsView";
import { NewMissionModal } from "./views/NewMissionModal";
import { LiveCallsView } from "./views/LiveCallsView";
import { ScheduleView } from "./views/ScheduleView";
import { MeetingsView } from "./views/MeetingsView";
import { CallLogView } from "./views/CallLogView";
import { ProspectsView } from "./views/ProspectsView";
import { CompanyProfileView } from "./views/CompanyProfileView";
import { ConnectionsView } from "./views/ConnectionsView";
import { ProviderConfigView } from "./views/ProviderConfigView";
import { AnalyticsView } from "./views/AnalyticsView";
import { PostSchedulerPlugin } from "./scheduler/PostSchedulerPlugin";
import { api } from "./api/apiClient";
import { WebSocketClient } from "./api/wsClient";

export default function App() {
  const [operator, setOperator] = useState(null);
  const [plugin, setPlugin] = useState(null); // null, "voice", "scheduler"
  const [view, setView] = useState("missions");
  const [selectedMission, setSelectedMission] = useState(null);
  const [showNewMissionModal, setShowNewMissionModal] = useState(false);

  // Platform state loaded from FastAPI backend
  const [profile, setProfile] = useState({
    name: "AIVHub",
    pitch: "AI-powered business intelligence dashboards for mid-market operations teams",
    callerName: "Sam",
    callerId: "+44 20 7946 0912",
    timezone: "Europe/London",
  });
  const [sources, setSources] = useState([]);
  const [services, setServices] = useState([]);
  const [faq, setFaq] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [missions, setMissions] = useState([]);
  const [liveCalls, setLiveCalls] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [scheduleItems, setScheduleItems] = useState([]);
  const [callLogs, setCallLogs] = useState([]);
  const [prospects, setProspects] = useState([]);
  const [registry, setRegistry] = useState([]);
  const [connections, setConnections] = useState([]);
  const [analytics, setAnalytics] = useState({});

  // Initialize data on mount
  useEffect(() => {
    loadAllData();

    // Connect to live WebSocket stream
    const ws = new WebSocketClient(
      null,
      (msg) => {
        if (msg.type === "call_updated" || msg.type === "booking_confirmed" || msg.type === "mission_created") {
          loadMissions();
          loadLiveCalls();
          loadMeetings();
          loadSchedule();
          loadNotifications();
        }
      },
      () => console.log("[App] Live WebSocket connected"),
      () => console.log("[App] WebSocket disconnected")
    );

    return () => ws.close();
  }, []);

  const loadAllData = async () => {
    await Promise.all([
      loadProfile(),
      loadMissions(),
      loadLiveCalls(),
      loadMeetings(),
      loadSchedule(),
      loadCallLogs(),
      loadProspects(),
      loadConnections(),
      loadAnalytics(),
      loadNotifications(),
    ]);
  };

  const loadProfile = async () => {
    try {
      const p = await api.getProfile();
      setProfile(p);
      const [src, srv, f] = await Promise.all([api.getSources(), api.getServices(), api.getFaqs()]);
      setSources(src);
      setServices(srv);
      setFaq(f);
    } catch (e) {
      console.warn("Using offline profile defaults:", e);
    }
  };

  const loadMissions = async () => {
    try {
      const data = await api.getMissions();
      setMissions(data);
    } catch (e) {
      console.warn("Using offline missions defaults:", e);
    }
  };

  const loadLiveCalls = async () => {
    try {
      const data = await api.getLiveCalls();
      setLiveCalls(data);
    } catch (e) {
      console.warn("Using offline live calls defaults:", e);
    }
  };

  const loadMeetings = async () => {
    try {
      const data = await api.getMeetings();
      setMeetings(data);
    } catch (e) {
      console.warn("Using offline meetings defaults:", e);
    }
  };

  const loadSchedule = async () => {
    try {
      const data = await api.getSchedule();
      setScheduleItems(data);
    } catch (e) {
      console.warn("Using offline schedule defaults:", e);
    }
  };

  const loadCallLogs = async () => {
    try {
      const data = await api.getCallLogs();
      setCallLogs(data);
    } catch (e) {
      console.warn("Using offline logs defaults:", e);
    }
  };

  const loadProspects = async () => {
    try {
      const [p, r] = await Promise.all([api.getProspects(), api.getRegistry()]);
      setProspects(p);
      setRegistry(r);
    } catch (e) {
      console.warn("Using offline prospects defaults:", e);
    }
  };

  const loadConnections = async () => {
    try {
      const data = await api.getConnections();
      setConnections(data);
    } catch (e) {
      console.warn("Using offline connections defaults:", e);
    }
  };

  const loadAnalytics = async () => {
    try {
      const data = await api.getAnalytics();
      setAnalytics(data);
    } catch (e) {
      console.warn("Using offline analytics defaults:", e);
    }
  };

  const loadNotifications = async () => {
    try {
      const data = await api.getNotifications();
      setNotifications(data);
    } catch (e) {
      console.warn("Using offline notifications defaults:", e);
    }
  };

  // Auth flow
  const handleLogin = async (username) => {
    try {
      const res = await api.login(username);
      setOperator(res.operator);
    } catch (e) {
      setOperator({ username, name: username.toLowerCase().startsWith("jitendra") ? "Jitendra S." : username, role: "Operator" });
    }
  };

  // Handlers for Mission
  const handleOpenMission = (m) => {
    setSelectedMission(m);
    setView("missionDetail");
  };

  const handleCreateMission = async (payload) => {
    await api.createMission(payload);
    await loadMissions();
    await loadLiveCalls();
    await loadNotifications();
  };

  // Live call supervisor handlers
  const handleConfirmBooking = async (callId) => {
    try {
      await api.confirmBooking(callId);
      await loadLiveCalls();
      await loadMeetings();
      await loadSchedule();
      await loadCallLogs();
      await loadNotifications();
    } catch (e) {
      alert("Failed to confirm booking: " + e.message);
    }
  };

  const handleListenToggle = async (callId) => {
    try {
      await api.toggleListen(callId);
      await loadLiveCalls();
    } catch (e) {
      console.error(e);
    }
  };

  const handleTakeoverToggle = async (callId) => {
    try {
      await api.toggleTakeover(callId);
      await loadLiveCalls();
    } catch (e) {
      console.error(e);
    }
  };

  // 1. If not logged in -> Show Login
  if (!operator) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // 2. If no plugin picked -> Show Workspace Hub
  if (!plugin) {
    return (
      <PluginHub
        operator={operator}
        onPick={setPlugin}
        onLogout={() => {
          setOperator(null);
          setPlugin(null);
        }}
      />
    );
  }

  // 3. Post Scheduler Plugin
  if (plugin === "scheduler") {
    return (
      <PostSchedulerPlugin
        operator={operator}
        onBackToHub={() => setPlugin(null)}
        onLogout={() => {
          setOperator(null);
          setPlugin(null);
        }}
        profile={profile}
      />
    );
  }

  // 4. AI Voice Appointment SDR App
  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <AppChrome />
      <Sidebar
        view={view}
        setView={setView}
        companyName={profile.name}
        callerName={profile.callerName || profile.caller_name}
        timezone={profile.timezone}
        operatorName={operator.name}
        operatorRole={operator.role}
        onBackToHub={() => setPlugin(null)}
        onLogout={() => {
          setOperator(null);
          setPlugin(null);
        }}
      />

      {view === "missions" && (
        <MissionsView
          missions={missions}
          onOpenMission={handleOpenMission}
          onNewMission={() => setShowNewMissionModal(true)}
          notifications={notifications}
          setNotifications={setNotifications}
        />
      )}

      {view === "missionDetail" && (
        <MissionDetail
          mission={selectedMission}
          companyName={profile.name}
          onBack={() => setView("missions")}
          onWatchLive={() => setView("live")}
        />
      )}

      {view === "live" && (
        <LiveCallsView
          calls={liveCalls}
          companyName={profile.name}
          onConfirmBooking={handleConfirmBooking}
          onListenToggle={handleListenToggle}
          onTakenToggle={handleTakeoverToggle}
          notifications={notifications}
          setNotifications={setNotifications}
        />
      )}

      {view === "schedule" && (
        <ScheduleView
          items={scheduleItems}
          onCreateItem={async (it) => {
            await api.createScheduleItem(it);
            await loadSchedule();
          }}
          notifications={notifications}
          setNotifications={setNotifications}
        />
      )}

      {view === "meetings" && (
        <MeetingsView
          meetings={meetings}
          companyName={profile.name}
          onOutcome={async (id, st, out) => {
            await api.logOutcome(id, { status: st, outcome: out });
            await loadMeetings();
          }}
          onSaveMeetingTranscript={async (id, tr) => {
            await api.saveMeetingTranscript(id, tr);
            await loadMeetings();
          }}
          notifications={notifications}
          setNotifications={setNotifications}
        />
      )}

      {view === "calllog" && (
        <CallLogView
          entries={callLogs}
          notifications={notifications}
          setNotifications={setNotifications}
        />
      )}

      {view === "prospects" && (
        <ProspectsView
          prospects={prospects}
          registry={registry}
          notifications={notifications}
          setNotifications={setNotifications}
        />
      )}

      {view === "company" && (
        <CompanyProfileView
          profile={profile}
          setProfile={setProfile}
          sources={sources}
          services={services}
          faq={faq}
          onSaveProfile={async (p) => {
            await api.updateProfile(p);
            await loadProfile();
          }}
          notifications={notifications}
          setNotifications={setNotifications}
        />
      )}

      {view === "connections" && (
        <ConnectionsView
          connections={connections}
          onAddConnection={async (c) => {
            await api.addConnection(c);
            await loadConnections();
          }}
          notifications={notifications}
          setNotifications={setNotifications}
        />
      )}

      {view === "provider" && (
        <ProviderConfigView
          notifications={notifications}
          setNotifications={setNotifications}
        />
      )}

      {view === "analytics" && (
        <AnalyticsView
          analyticsData={analytics}
          notifications={notifications}
          setNotifications={setNotifications}
        />
      )}

      {showNewMissionModal && (
        <NewMissionModal
          registry={registry}
          onClose={() => setShowNewMissionModal(false)}
          onCreate={handleCreateMission}
        />
      )}
    </div>
  );
}
