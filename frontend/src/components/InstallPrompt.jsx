import React, { useState } from "react";
import { Share, X } from "lucide-react";
import { C, FONT_BODY } from "../tokens";
import { promptInstall, useInstallState } from "./installState";

const DISMISSED_KEY = "outreach_install_hint_dismissed";

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
  const { installed, phone, ios, canPrompt } = useInstallState();
  const [closed, setClosed] = useState(wasDismissed);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch (_) {}
    setClosed(true);
  };

  const install = async () => {
    await promptInstall();
    setClosed(true);
  };

  // Android shows the card only once the browser says the app can be installed; iPhone always can.
  if (installed || !phone || closed || (!ios && !canPrompt)) return null;

  return (
    <div
      role="dialog"
      aria-label="Install Outreach"
      className="install-card"
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
            Tap <Share size={13} style={{ verticalAlign: "-2px" }} aria-label="Share" /> (inside ··· on newer iPhones), then Add to Home Screen.
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
