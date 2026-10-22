import React, { useEffect, useRef, useState } from "react";
import { api } from "../api/apiClient";
import { authStorage } from "../api/authStore";

// Signs the user out after a stretch of inactivity, and after a maximum time since they signed in,
// so a screen left open (or a borrowed browser) is not open to anyone for days.
// Activity in any tab of this browser counts, and a live call counts as activity.
// The limits are set by staff in the admin portal; these are used until they load (and if they cannot).
const WARN_MS = 60 * 1000;
const DEFAULT_IDLE_MS = 30 * 60 * 1000;
const DEFAULT_MAX_MS = 12 * 60 * 60 * 1000; // the server enforces the same limit on the sign-in itself
const ACTIVE_KEY = "aivhub_last_active";
const SIGNED_IN_KEY = "aivhub_signed_in_at";
export const SIGNOUT_REASON_KEY = "aivhub_signout_reason";

const now = () => Date.now();
const readNum = (store, key) => { try { return Number(store.getItem(key)) || 0; } catch (_) { return 0; } };

export function SessionGuard({ onTimeout, busy = false }) {
  const [left, setLeft] = useState(null); // seconds until sign-out while the warning shows
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const limits = useRef({ idle: DEFAULT_IDLE_MS, max: DEFAULT_MAX_MS });
  const cb = useRef(onTimeout);
  cb.current = onTimeout;

  useEffect(() => {
    const store = authStorage();
    try {
      if (!readNum(store, SIGNED_IN_KEY)) store.setItem(SIGNED_IN_KEY, String(now()));
      localStorage.setItem(ACTIVE_KEY, String(now()));
    } catch (_) {}
    const loadPolicy = () => api.getSessionPolicy().then((p) => {
      if (p?.idle_minutes) limits.current.idle = p.idle_minutes * 60 * 1000;
      if (p?.max_hours) limits.current.max = p.max_hours * 3600 * 1000;
    }).catch(() => {});
    loadPolicy();
    const policyTimer = window.setInterval(loadPolicy, 10 * 60 * 1000); // a change by staff reaches open screens
    let lastWrite = 0;
    const touch = () => {
      const t = now();
      if (t - lastWrite < 5000) return; // a few writes a minute is plenty
      lastWrite = t;
      try { localStorage.setItem(ACTIVE_KEY, String(t)); } catch (_) {}
      setLeft((cur) => (cur == null ? cur : null)); // moving again dismisses the warning
    };
    const end = (reason) => {
      try { sessionStorage.setItem(SIGNOUT_REASON_KEY, reason); store.removeItem(SIGNED_IN_KEY); localStorage.removeItem(ACTIVE_KEY); } catch (_) {}
      cb.current();
    };
    const check = () => {
      const t = now();
      if (t - readNum(store, SIGNED_IN_KEY) > limits.current.max) { end("max"); return; }
      if (busyRef.current) { try { localStorage.setItem(ACTIVE_KEY, String(t)); } catch (_) {} return; }
      const idle = t - readNum(localStorage, ACTIVE_KEY);
      const limit = limits.current.idle;
      if (idle >= limit) end("idle");
      else if (idle >= limit - WARN_MS) setLeft(Math.max(1, Math.ceil((limit - idle) / 1000)));
      else setLeft(null);
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(check, 5000);
    document.addEventListener("visibilitychange", check); // a laptop waking from sleep is checked at once
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
      window.clearInterval(policyTimer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  if (left == null) return null;
  return (
    <div role="alertdialog" aria-modal="true" aria-label="Still there?" style={{ position: "fixed", inset: 0, zIndex: 100000, background: "rgba(17,24,39,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 22, maxWidth: 380, width: "100%", boxShadow: "0 12px 40px rgba(0,0,0,.25)", fontFamily: "inherit" }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Still there?</div>
        <div style={{ fontSize: 13.5, color: "#4B5260", lineHeight: 1.5, marginBottom: 16 }}>
          You haven't done anything for a while. For your security you'll be signed out in {left} second{left === 1 ? "" : "s"}.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => cb.current()}>Sign out now</button>
          <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" autoFocus onClick={() => { try { localStorage.setItem(ACTIVE_KEY, String(now())); } catch (_) {} setLeft(null); }}>Stay signed in</button>
        </div>
      </div>
    </div>
  );
}
