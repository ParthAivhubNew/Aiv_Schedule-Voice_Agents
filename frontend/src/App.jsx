import React, { useState, useEffect } from "react";
import { C, FONT_BODY } from "./tokens";
import { AppChrome } from "./components/AppChrome";
import { Sidebar } from "./components/Sidebar";
import { LoginScreen } from "./hub/LoginScreen";
import { PluginHub } from "./hub/PluginHub";
import { PostSchedulerPlugin } from "./scheduler/PostSchedulerPlugin";

import { MissionsView } from "./views/MissionsView";
import { LiveCallsView } from "./views/LiveCallsView";
import { ScheduleView } from "./views/ScheduleView";
import { MeetingsView } from "./views/MeetingsView";
import { CallLogView } from "./views/CallLogView";
import { ProspectsView } from "./views/ProspectsView";
import { CompanyProfileView } from "./views/CompanyProfileView";
import { ConnectionsView } from "./views/ConnectionsView";
import { ProviderConfigView } from "./views/ProviderConfigView";
import { AnalyticsView } from "./views/AnalyticsView";
import { NewMissionModal } from "./views/NewMissionModal";
import { api } from "./api/apiClient";

const INITIAL_PROFILE = {
  name: "AIVHub Logistics AI",
  pitch: "Autonomous AI Voice SDR for high-converting B2B fleet logistics bookings across the UK.",
  callerName: "Sam (AI SDR)",
  callerId: "+44 20 7946 0912",
  tone: "Professional, warm British tone with polite persistence.",
  icoRef: "ZA774219",
  disclosure: "This call is recorded for quality, compliance, and appointment verification purposes.",
  lunchStart: "12:00",
  lunchEnd: "13:00",
  timezone: "Europe/London",
};

const INITIAL_MISSIONS = [
  {
    id: "m-1",
    name: "Logistics — Manchester Fleet Operators",
    sector: "Logistics & Fleet",
    region: "Greater Manchester",
    status: "active",
    goal: 25,
    booked: 14,
    prospectsCount: 65,
    completedCount: 38,
    failedCount: 2,
    eta: "Today, 16:45",
  },
  {
    id: "m-2",
    name: "Midlands Freight Hubs — Dispatch Lead Gen",
    sector: "Freight & Haulage",
    region: "Birmingham & Midlands",
    status: "active",
    goal: 15,
    booked: 8,
    prospectsCount: 40,
    completedCount: 21,
    failedCount: 1,
    eta: "Tomorrow, 11:30",
  },
  {
    id: "m-3",
    name: "Leeds 3PL Warehousing Discovery",
    sector: "3PL Warehousing",
    region: "West Yorkshire",
    status: "paused",
    goal: 20,
    booked: 9,
    prospectsCount: 48,
    completedCount: 22,
    failedCount: 3,
    eta: "Paused",
  },
];

const INITIAL_LIVE_CALLS = [
  {
    id: "call-101",
    prospect: "Pennine Haulage Ltd",
    contact: "James Vance",
    startedAt: "1 min 42s ago",
    durationSec: 102,
    status: "engaged",
    sentiment: "positive",
    waveform: [35, 60, 85, 40, 75, 90, 45, 65, 80, 50, 70, 95, 40, 60, 75],
    transcript: [
      { who: "ai", text: "Good afternoon! I'm Sam calling from AIVHub on behalf of FleetOps." },
      { who: "user", text: "Hello Sam, what's this regarding?" },
      { who: "ai", text: "We help UK haulage fleets reduce manual dispatch scheduling hours with autonomous booking tools." },
      { who: "user", text: "Interesting. We do spend a lot of time on driver dispatching." },
      { who: "ai", text: "Would you have 15 minutes this Thursday at 10:00 AM for a quick demo?" },
    ],
  },
  {
    id: "call-102",
    prospect: "Mersey Freight Logistics",
    contact: "Sarah Jenkins",
    startedAt: "38s ago",
    durationSec: 38,
    status: "dialing",
    sentiment: "neutral",
    waveform: [20, 30, 25, 35, 20, 40, 25, 30, 20, 25, 30, 20],
    transcript: [
      { who: "ai", text: "Calling Mersey Freight Logistics (+44 151 496 0192)..." },
    ],
  },
];

const INITIAL_SCHEDULE = [
  { id: "s-1", prospect: "Cotswold Logistics", mission: "Logistics — Manchester", day: "Today", time: "14:30", window: "09:00–17:30", status: "queued", honored: true, honoredQuote: "Call me back after lunch at 2:30" },
  { id: "s-2", prospect: "Severn Express Haulage", mission: "Midlands Freight Hubs", day: "Tomorrow", time: "10:00", window: "09:00–17:30", status: "queued", honored: false },
  { id: "s-3", prospect: "Tyne & Wear Cargo", mission: "Logistics — Manchester", day: "Tomorrow", time: "11:15", window: "09:00–17:30", status: "queued", honored: true, honoredQuote: "Can you follow up tomorrow morning?" },
];

const INITIAL_MEETINGS = [
  { id: "m-1", prospect: "Manchester Transport Group", attendee: "David Miller (Fleet Director)", date: "Tomorrow", time: "11:00 AM", duration: "25 min", format: "video", platform: "Google Meet", videoLink: "https://meet.google.com/aiv-demo", fit: 94, status: "converted", outcome: "Demo booked — interested in 40 vehicle dispatch" },
  { id: "m-2", prospect: "Avonmouth Freight Services", attendee: "Claire Roberts (Ops Manager)", date: "Thursday", time: "2:30 PM", duration: "30 min", format: "video", platform: "Microsoft Teams", videoLink: "https://teams.microsoft.com/l/meetup", fit: 88, status: "converted", outcome: "Discovery Call — needs multi-depot coordination" },
];

const INITIAL_LOGS = [
  { id: "l-1", canonicalName: "Manchester Transport Group", startedAt: "Today, 10:14 AM", duration: "3m 42s", mission: "Logistics — Manchester", channel: "voice", outcome: "meeting_booked", wordsLocked: true, transcript: [{ who: "ai", text: "Hello, calling from AIVHub." }, { who: "user", text: "Yes, let's schedule a demo." }] },
  { id: "l-2", canonicalName: "Pennine Haulage Ltd", startedAt: "Today, 09:30 AM", duration: "2m 15s", mission: "Logistics — Manchester", channel: "voice", outcome: "callback_requested", wordsLocked: true, requestedFollowUp: { day: "Today", time: "14:30", exactWords: "Call me back after lunch" } },
];

const INITIAL_PROSPECTS = [
  { id: "p-1", name: "Manchester Transport Group", phone: "+44 161 946 0192", sector: "Logistics", region: "Manchester", contact: "David Miller", fit: 94, status: "meeting_booked" },
  { id: "p-2", name: "Pennine Haulage Ltd", phone: "+44 142 284 0110", sector: "Freight", region: "Halifax", contact: "James Vance", fit: 89, status: "callback_requested" },
  { id: "p-3", name: "Avonmouth Freight Services", phone: "+44 117 982 0401", sector: "Haulage", region: "Bristol", contact: "Claire Roberts", fit: 88, status: "meeting_booked" },
  { id: "p-4", name: "Severn Express Haulage", phone: "+44 145 272 0993", sector: "Transport", region: "Gloucester", contact: "Mark Taylor", fit: 82, status: "queued" },
];

export default function App() {
  const [operator, setOperator] = useState(null); // Default to login screen so user enters credentials
  const [plugin, setPlugin] = useState(null);
  const [view, setView] = useState("missions");
  const [notifications, setNotifications] = useState(3);
  const [showNewMission, setShowNewMission] = useState(false);

  const [profile, setProfile] = useState(INITIAL_PROFILE);
  const [missions, setMissions] = useState(INITIAL_MISSIONS);
  const [liveCalls, setLiveCalls] = useState(INITIAL_LIVE_CALLS);
  const [scheduleItems, setScheduleItems] = useState(INITIAL_SCHEDULE);
  const [meetings, setMeetings] = useState(INITIAL_MEETINGS);
  const [callLogs, setCallLogs] = useState(INITIAL_LOGS);
  const [prospects, setProspects] = useState(INITIAL_PROSPECTS);

  // Fetch backend data if available
  useEffect(() => {
    async function loadData() {
      try {
        const m = await api.getMissions();
        if (m && m.length) setMissions(m);
      } catch (e) {}
      try {
        const p = await api.getProfile();
        if (p && p.name) setProfile(p);
      } catch (e) {}
      try {
        const pr = await api.getProspects();
        if (pr && pr.length) setProspects(pr);
      } catch (e) {}
    }
    loadData();
  }, []);

  if (!operator) {
    return (
      <AppChrome>
        <LoginScreen onLogin={(user) => setOperator(user)} />
      </AppChrome>
    );
  }

  return (
    <AppChrome>
      {/* 1. Hub Screen */}
      {!plugin && (
        <PluginHub
          operator={operator}
          onPick={(p) => setPlugin(p)}
          onLogout={() => { setOperator(null); setPlugin(null); }}
        />
      )}

      {/* 2. Post Scheduler Plugin */}
      {plugin === "scheduler" && (
        <PostSchedulerPlugin
          operator={operator}
          onBackToHub={() => setPlugin(null)}
          onLogout={() => { setOperator(null); setPlugin(null); }}
          profile={profile}
        />
      )}

      {/* 3. Voice Operator SDR App */}
      {plugin === "voice" && (
        <div style={{ display: "flex", width: "100vw", height: "100vh", overflow: "hidden", background: C.paper }}>
          <Sidebar
            view={view}
            setView={setView}
            companyName={profile.name}
            callerName={profile.callerName}
            timezone={profile.timezone}
            operatorName={operator?.name}
            operatorRole={operator?.role}
            onBackToHub={() => setPlugin(null)}
            onLogout={() => { setOperator(null); setPlugin(null); }}
          />

          <main style={{ flex: 1, display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
            {view === "missions" && (
              <MissionsView
                notifications={notifications}
                setNotifications={setNotifications}
                missions={missions}
                onNewMission={() => setShowNewMission(true)}
              />
            )}

            {view === "live" && (
              <LiveCallsView
                notifications={notifications}
                setNotifications={setNotifications}
                calls={liveCalls}
                onTakeOver={(callId) => {
                  setLiveCalls((calls) =>
                    calls.map((c) => (c.id === callId ? { ...c, supervisorTaken: true } : c))
                  );
                }}
                onEndCall={(callId) => {
                  setLiveCalls((calls) => calls.filter((c) => c.id !== callId));
                }}
              />
            )}

            {view === "schedule" && (
              <ScheduleView
                notifications={notifications}
                setNotifications={setNotifications}
                items={scheduleItems}
                onCreateItem={(item) => setScheduleItems((it) => [item, ...it])}
              />
            )}

            {view === "meetings" && (
              <MeetingsView
                notifications={notifications}
                setNotifications={setNotifications}
                companyName={profile.name}
                meetings={meetings}
                onOutcome={(id, status, outcome) => {
                  setMeetings((m) =>
                    m.map((mt) => (mt.id === id ? { ...mt, status, outcome } : mt))
                  );
                }}
              />
            )}

            {view === "calllog" && (
              <CallLogView
                notifications={notifications}
                setNotifications={setNotifications}
                entries={callLogs}
              />
            )}

            {view === "prospects" && (
              <ProspectsView
                notifications={notifications}
                setNotifications={setNotifications}
                prospects={prospects}
              />
            )}

            {view === "company" && (
              <CompanyProfileView
                profile={profile}
                setProfile={setProfile}
                notifications={notifications}
                setNotifications={setNotifications}
              />
            )}

            {view === "connections" && (
              <ConnectionsView
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
                notifications={notifications}
                setNotifications={setNotifications}
              />
            )}
          </main>

          {showNewMission && (
            <NewMissionModal
              onClose={() => setShowNewMission(false)}
              onCreate={(newM) => {
                setMissions((m) => [newM, ...m]);
                setShowNewMission(false);
              }}
            />
          )}
        </div>
      )}
    </AppChrome>
  );
}
