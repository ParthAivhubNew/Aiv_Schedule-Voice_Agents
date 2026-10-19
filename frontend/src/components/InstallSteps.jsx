import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, MoreVertical, PlusSquare, Share, X } from "lucide-react";
import { C, FONT_BODY } from "../tokens";
import { promptInstall, useInstallState } from "./installState";

const STEPS = {
  iphone: [
    { icon: Share, text: "In Safari, tap the Share button. On newer iPhones it is inside the ··· menu at the bottom." },
    { icon: PlusSquare, text: "Tap Add to Home Screen. If you don't see it, tap View More first." },
    { icon: Download, text: "Tap Add. Outreach now sits on your home screen like any other app." },
  ],
  android: [
    { icon: MoreVertical, text: "In Chrome, tap the three dots at the top right." },
    { icon: Download, text: "Tap Install app (or Add to Home screen)." },
    { icon: PlusSquare, text: "Tap Install. Outreach now sits on your home screen like any other app." },
  ],
};

// A bottom sheet with the install steps for the phone in hand: a one-tap Install button on
// Android when the browser allows it, otherwise numbered steps. The other phone's steps are one tap away.
export function InstallStepsSheet({ open, onClose }) {
  const { ios, canPrompt } = useInstallState();
  const [tab, setTab] = useState(ios ? "iphone" : "android");
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus moves into the sheet when it opens and back to the button that opened it when it closes.
  useEffect(() => {
    if (!open) return undefined;
    const back = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (back && back.focus) back.focus();
    };
  }, [open]);

  if (!open) return null;

  const install = async () => {
    if (await promptInstall()) onClose();
  };
  const tabBtn = (id, label) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      style={{ flex: 1, minHeight: 44, border: "none", borderRadius: 8, fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600, cursor: "pointer", background: tab === id ? "#fff" : "transparent", color: tab === id ? C.ink : C.slate, boxShadow: tab === id ? "0 1px 3px rgba(16,24,40,0.12)" : "none" }}
    >
      {label}
    </button>
  );

  // Drawn at the end of the page, so a header or panel it was opened from cannot clip it or sit over it.
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 500 }}>
      <div onClick={onClose} aria-hidden="true" style={{ position: "absolute", inset: 0, background: "rgba(15,18,28,0.5)" }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Get the app on your phone"
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: C.paperCard, borderRadius: "16px 16px 0 0", padding: "20px 20px calc(20px + env(safe-area-inset-bottom))", fontFamily: FONT_BODY, boxShadow: "0 -12px 32px rgba(16,24,40,0.2)", maxHeight: "92vh", overflowY: "auto", boxSizing: "border-box" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/icon-192.png" alt="" width={44} height={44} style={{ borderRadius: 10 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>Get Outreach on your phone</div>
            <div style={{ fontSize: 14, color: C.slate }}>Opens full screen, one tap from your home screen.</div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, border: "none", background: "transparent", color: C.slate, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <X size={20} />
          </button>
        </div>

        <div role="tablist" style={{ display: "flex", gap: 4, padding: 4, margin: "16px 0", borderRadius: 10, background: C.paperSoft }}>
          {tabBtn("iphone", "iPhone")}
          {tabBtn("android", "Android")}
        </div>

        {tab === "android" && canPrompt ? (
          <button type="button" onClick={install} style={{ width: "100%", minHeight: 48, marginBottom: 14, border: "none", borderRadius: 10, background: C.cobalt, color: "#fff", fontFamily: FONT_BODY, fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
            Install now
          </button>
        ) : null}

        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {STEPS[tab].map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: C.cobaltSoft, color: C.cobalt, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={20} />
                </span>
                <span style={{ fontSize: 15, lineHeight: 1.4, color: C.textInk }}>
                  <strong style={{ marginRight: 6 }}>{i + 1}.</strong>
                  {s.text}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>,
    document.body,
  );
}
