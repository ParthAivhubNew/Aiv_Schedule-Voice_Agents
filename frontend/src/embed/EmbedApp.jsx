import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/apiClient";
import { AUTH_LOST_EVENT, setEmbedAuth } from "../api/authStore";
import { OrgSettingsProvider } from "../org/orgSettings";
import { setVirtualRoute } from "../utils/route";
import { ConnectScreen } from "./ConnectScreen";
import { EmbedProvider } from "./EmbedContext";
import { askForToken, fromParent, inFrame, initFromFragment, toParent } from "./bridge";
import { applyAppearance, cleanAppearance } from "./theme";

const LeadGenerationPlugin = lazy(() => import("../plugins/leadgen/LeadGenerationPlugin"));
const SocialWorkspaceGate = lazy(() => import("../plugins/scheduler/SocialWorkspace").then((m) => ({ default: m.SocialWorkspaceGate })));
const CallingWorkspace = lazy(() => import("../plugins/voice/calling/CallingWorkspace").then((m) => ({ default: m.CallingWorkspace })));

// Where each screen opens inside its app (the app keeps its place in memory; see utils/route).
const START = { leads: "/leadgen/find_leads", campaigns: "/leadgen/outreach", mail: "/leadgen/mail", voice: "/voice/list", social: "/scheduler/plan" };
const NOOP = () => {};

function Centered({ children }) {
  return <div role="status" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", color: "var(--ui-muted)", fontSize: 14 }}>{children}</div>;
}

// A saved default look, with what the partner's page passed when it mounted the screen laid on top.
function lookOf(saved, passed) {
  const a = cleanAppearance(saved).variables;
  const b = cleanAppearance(passed).variables;
  return { variables: { ...a, ...b } };
}

export function EmbedApp() {
  const component = (window.location.pathname.split("/")[2] || "").toLowerCase();
  const [phase, setPhase] = useState("wait"); // wait | connect | loading | ready | ended | error
  const [connectToken, setConnectToken] = useState("");
  const [session, setSession] = useState(null);
  const [message, setMessage] = useState("");
  const passed = useRef(undefined);
  const returnUrl = useRef("");

  const start = useCallback(async (token) => {
    setPhase("loading");
    const refresh = async () => {
      const next = await askForToken();
      if (!next) return false;
      setEmbedAuth({ token: next, refresh });
      return true;
    };
    setEmbedAuth({ token, refresh });
    try {
      const s = await api.getEmbedSession();
      if (s.component !== component && component !== "connect") throw new Error("This page is for a different screen.");
      applyAppearance(lookOf(s.appearance, passed.current));
      setVirtualRoute(START[s.component] || START.leads);
      setSession(s);
      setPhase("ready");
      toParent("ready-ui", { component: s.component });
    } catch (err) {
      setMessage(err.message || "Could not open this screen.");
      setPhase("error");
      toParent("error", { message: err.message || "Could not open this screen." });
    }
  }, [component]);

  const begin = useCallback((m) => {
    passed.current = m.appearance;
    returnUrl.current = m.returnUrl || "";
    applyAppearance(lookOf(null, m.appearance));
    if (m.connectToken) {
      setConnectToken(m.connectToken);
      setPhase("connect");
    } else if (m.token) {
      start(m.token);
    }
  }, [start]);

  useEffect(() => {
    const fromHash = initFromFragment();
    if (fromHash) {
      begin(fromHash);
      return undefined;
    }
    const off = fromParent((m) => {
      if (m.type === "init") begin(m);
      else if (m.type === "appearance") applyAppearance(lookOf(null, m.appearance));
    });
    toParent("ready");
    if (!inFrame()) {
      setMessage("This screen opens inside your software. Start from there.");
      setPhase("error");
    }
    return off;
  }, [begin]);

  useEffect(() => {
    const onLost = () => {
      setPhase("ended");
      toParent("session-ended");
    };
    window.addEventListener(AUTH_LOST_EVENT, onLost);
    return () => window.removeEventListener(AUTH_LOST_EVENT, onLost);
  }, []);

  if (phase === "wait") return <Centered>Opening…</Centered>;
  if (phase === "loading") return <Centered>Opening…</Centered>;
  if (phase === "ended") return <Centered>This session has ended. Reload the page to continue.</Centered>;
  if (phase === "error") return <Centered>{message}</Centered>;
  if (phase === "connect") {
    return (
      <ConnectScreen
        connectToken={connectToken}
        onConnected={(out) => {
          toParent("connected", { linkId: out.link_id, externalId: out.external_id, mode: out.mode });
          if (!inFrame() && returnUrl.current) {
            window.location.href = returnUrl.current;
            return;
          }
          start(out.session.token);
        }}
      />
    );
  }

  const op = session.operator;
  const props = { operator: op, accountBar: null, onBackToHub: NOOP, onLogout: NOOP, notifications: [], setNotifications: NOOP, profile: {}, commonAi: {} };
  return (
    <OrgSettingsProvider>
      <EmbedProvider views={session.views}>
        <div className="embed-root" style={{ height: "100vh", width: "100vw", overflow: "hidden" }}>
          <Suspense fallback={<Centered>Opening…</Centered>}>
            {["leads", "campaigns", "mail"].includes(session.component) && <LeadGenerationPlugin {...props} />}
            {session.component === "voice" && <CallingWorkspace {...props} />}
            {session.component === "social" && <SocialWorkspaceGate {...props} />}
          </Suspense>
        </div>
      </EmbedProvider>
    </OrgSettingsProvider>
  );
}
