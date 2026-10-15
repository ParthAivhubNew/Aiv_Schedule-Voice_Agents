import React, { useEffect, useState } from "react";
import { Share, X } from "lucide-react";
import { C, FONT_BODY } from "../tokens";

const DISMISSED_KEY = "outreach_install_hint_dismissed";

function isInstalled() {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  } catch (_) {
    return false;
  }
}

function isPhone() {
  try {
    return window.matchMedia("(max-width: 820px) and (pointer: coarse)").matches;
  } catch (_) {
    return false;
  }
}

function isIos() {
  const ua = window.navigator.userAgent || "";
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1);
}

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch (_) {
    return false;
  }
}

// On a phone, outside the installed app: an Install button on Android (the browser's own prompt,
// started with one tap) and the Share steps on iPhone, which has no install prompt. Closing it
// keeps it away for good. Desktop and the installed app never see it.
export function InstallPrompt() {
  const [hidden, setHidden] = useState(() => isInstalled() || !isPhone() || wasDismissed());
  const [installEvent, setInstallEvent] = useState(null);
  const ios = isIos();

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch (_) {}
    setHidden(true);
  };

  const install = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try {
      await installEvent.userChoice;
    } catch (_) {}
    setInstallEvent(null);
    setHidden(true);
  };

  // Android shows the card only once the browser says the app can be installed; iPhone always can.
  if (hidden || (!ios && !installEvent)) return null;

  return (
    <div
      role="dialog"
      aria-label="Install Outreach"
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: "calc(16px + env(safe-area-inset-bottom))",
        zIndex: 400,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 12px 12px 14px",
        background: C.paperCard,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        boxShadow: "0 12px 32px rgba(16, 24, 40, 0.18)",
        fontFamily: FONT_BODY,
      }}
    >
      <img src="/icon-192.png" alt="" width={40} height={40} style={{ borderRadius: 10, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>Install Outreach</div>
        {ios ? (
          <div style={{ fontSize: 13, color: C.slate, lineHeight: 1.4 }}>
            Tap <Share size={13} style={{ verticalAlign: "-2px" }} aria-label="Share" />, then Add to Home Screen.
          </div>
        ) : (
          <div style={{ fontSize: 13, color: C.slate, lineHeight: 1.4 }}>Opens full screen from your home screen.</div>
        )}
      </div>
      {!ios && (
        <button
          type="button"
          onClick={install}
          style={{ minHeight: 44, padding: "0 16px", border: "none", borderRadius: 8, background: C.cobalt, color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: FONT_BODY, cursor: "pointer" }}
        >
          Install
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Close"
        style={{ width: 44, height: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: C.slate, cursor: "pointer" }}
      >
        <X size={18} />
      </button>
    </div>
  );
}
