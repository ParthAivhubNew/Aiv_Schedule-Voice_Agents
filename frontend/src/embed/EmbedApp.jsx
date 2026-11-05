import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/apiClient";
import { AUTH_LOST_EVENT, setEmbedAuth } from "../api/authStore";
import { OrgSettingsProvider } from "../org/orgSettings";
import { setVirtualRoute } from "../utils/route";
import { ConnectScreen } from "./ConnectScreen";
import { EmbedProvider } from "./EmbedContext";
import { askForToken, fromParent, inFrame, initFromFragment, toParent } from "./bridge";
import { applyAppearance, cleanAppearance, cleanLogo } from "./theme";

const LeadGenerationPlugin = lazy(() => import("../plugins/leadgen/LeadGenerationPlugin"));
const SocialWorkspaceGate = lazy(() => import("../plugins/scheduler/SocialWorkspace").then((m) => ({ default: m.SocialWorkspaceGate })));
const CallingWorkspace = lazy(() => import("../plugins/voice/calling/CallingWorkspace").then((m) => ({ default: m.CallingWorkspace })));
const AccountScreen = lazy(() => import("./AccountScreen"));
const WorkspaceScreen = lazy(() => import("./WorkspaceScreen"));
const HumanCallHost = lazy(() => import("../hub/HumanCallHost")); // the browser phone: Call buttons and the Phone page open it

// Where each screen opens inside its app (the app keeps its place in memory; see utils/route).
const START = { leads: "/leadgen/find_leads", leadgen: "/leadgen/find_leads", campaigns: "/leadgen/outreach", mail: "/leadgen/mail", voice: "/voice/list", social: "/scheduler/plan", workspace: "/leadgen/find_leads", account: "/account" };
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
  const tabsAsked = useRef(""); // workspace: the tabs the page chose to show
  const savedLook = useRef(undefined); // the partner's saved default, which a page's own appearance is laid over
  const [look, setLook] = useState({ variables: {} });
  const show = useCallback((a) => {
    setLook(a);
    applyAppearance(a);
  }, []);
  const returnUrl = useRef("");
  const stateParam = useRef(null); // read once: the address is cleaned in an effect, and development runs effects twice
  if (stateParam.current === null) stateParam.current = new URLSearchParams(window.location.search).get("state") || "";
  const popup = useRef(false); // opened from a partner's page as our own sign-in window (a state in the address, no frame)

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
      savedLook.current = s.appearance;
      show(lookOf(s.appearance, passed.current));
      setVirtualRoute(START[s.component] || START.leads);
      setSession(s);
      setPhase("ready");
      toParent("ready-ui", { component: s.component });
    } catch (err) {
      setMessage(err.message || "Could not open this screen.");
      setPhase("error");
      toParent("error", { message: err.message || "Could not open this screen." });
    }
  }, [component, show]);

  const begin = useCallback((m) => {
    passed.current = m.appearance;
    if (typeof m.tabs === "string") tabsAsked.current = m.tabs;
    returnUrl.current = m.returnUrl || "";
    show(lookOf(null, m.appearance));
    if (m.connectToken) {
      setConnectToken(m.connectToken);
      setPhase("connect");
    } else if (m.token) {
      start(m.token);
    }
  }, [start, show]);

  useEffect(() => {
    if (stateParam.current && !inFrame()) {
      popup.current = true;
      try {
        window.history.replaceState(null, "", window.location.pathname);
      } catch (_) {}
      begin({ connectToken: stateParam.current });
      return undefined;
    }
    const fromHash = initFromFragment();
    if (fromHash) {
      begin(fromHash);
      return undefined;
    }
    const off = fromParent((m) => {
      if (m.type === "init") begin(m);
      else if (m.type === "appearance") { passed.current = m.appearance; show(lookOf(savedLook.current, m.appearance)); }
      else if (m.type === "find" && typeof m.company === "string") {
        window.__outreachFind = m.company.slice(0, 120); // kept until the Leads app has loaded and picks it up
        window.dispatchEvent(new CustomEvent("outreach-find", { detail: { company: window.__outreachFind } }));
      }
    });
    toParent("ready");
    if (!inFrame()) {
      setMessage("This screen opens inside your software. Start from there.");
      setPhase("error");
    }
    return off;
  }, [begin, show]);

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
        popup={popup.current}
        onConnected={(out) => {
          if (popup.current) {
            // The Chrome extension signs in through Chrome's own window: the code goes back on its redirect address.
            const ext = /^chrome-extension:\/\/([a-p]{32})$/.exec(out.origin || "");
            if (ext) {
              window.location.replace(`https://${ext[1]}.chromiumapp.org/cb#code=${encodeURIComponent(out.code)}`);
              return;
            }
            // The whole window was used for sign-in: go back to the page that sent the person here, with the code in the address fragment.
            if (out.return_url) {
              window.location.replace(`${out.return_url}${out.return_url.includes("#") ? "&" : "#"}outreach_code=${encodeURIComponent(out.code)}`);
              return;
            }
            // Hand a one-time code to the page that opened this window, only at the address it was made for, then close.
            try {
              window.opener.postMessage({ source: "outreach-popup", type: "code", code: out.code }, out.origin);
            } catch (_) {}
            window.close();
            setMessage("You are connected. You can close this window.");
            setPhase("error");
            return;
          }
          toParent("connected", { linkId: out.link_id, externalId: out.external_id, mode: out.mode, code: out.code || "" });
          if (out.code) return; // shown inside the partner's page: it trades the code for a token and sends it back as a new init
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
      <EmbedProvider views={session.views} brand={{ name: look.variables.brandName || "", logoUrl: look.variables.logoUrl || cleanLogo(session.partner && session.partner.logoUrl) }}>
        <div className="embed-root" style={{ height: "100vh", width: "100vw", overflow: "hidden" }}>
          <Suspense fallback={<Centered>Opening…</Centered>}>
            {["leads", "leadgen", "campaigns", "mail"].includes(session.component) && <LeadGenerationPlugin {...props} />}
            {session.component === "voice" && <CallingWorkspace {...props} />}
            {session.component === "social" && <SocialWorkspaceGate {...props} />}
            {session.component === "account" && <AccountScreen operator={op} />}
            {session.component === "workspace" && <WorkspaceScreen props={props} tabs={tabsAsked.current} />}
            {["leadgen", "voice", "workspace"].includes(session.component) && <HumanCallHost />}
          </Suspense>
        </div>
      </EmbedProvider>
    </OrgSettingsProvider>
  );
}
