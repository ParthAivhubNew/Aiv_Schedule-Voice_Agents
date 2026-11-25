import { ago } from "../utils/notificationTime";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarCheck,
  ChevronLeft,
  History,
  KeyRound,
  PlusCircle,
  Radio,
  X,
} from "lucide-react";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { dedupeNotifications, notificationActionLabel, notificationFingerprint, resolveNotificationTarget } from "../tokens";
import { C, FONT_BODY, FONT_DISPLAY, HUB_PAPER, STATUS_MAP } from "./constants";

export function AppChrome() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
      * { box-sizing: border-box; }
      html, body, #root { height: 100%; margin: 0; }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-thumb { background: #CBD1D9; border-radius: 4px; }
      select:focus, input:focus, textarea:focus { border-color: ${C.cobalt} !important; }

      /* Buttons: a soft shadow on hover and a small press. They no longer jump and grow, which
         made every screen feel restless and moved buttons out from under the pointer. */
      button {
        transition: transform 0.12s ease, box-shadow 0.18s ease, background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease !important;
      }
      button:hover:not(:disabled) {
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.10) !important;
      }
      button:active:not(:disabled) {
        transform: scale(0.98) !important;
        box-shadow: none !important;
      }
      button:focus-visible {
        outline: 2px solid ${C.cobalt};
        outline-offset: 2px;
      }
      @media (prefers-reduced-motion: reduce) {
        * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
      }

      /* Cards, metrics, lists and options: the border takes the accent colour and the shadow deepens. */
      .hover-float {
        transition: box-shadow 0.2s ease, border-color 0.18s ease !important;
      }
      .hover-float:hover {
        box-shadow: 0 10px 26px rgba(18, 20, 28, 0.10), 0 2px 8px rgba(0, 0, 0, 0.04) !important;
        border-color: ${C.cobalt} !important;
      }

      @keyframes pulseBar {
        0%, 100% { height: 4px; opacity: 0.5; }
        50% { height: 14px; opacity: 1; }
      }
      @keyframes typingDot {
        0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
        40% { opacity: 1; transform: translateY(-3px); }
      }
    `}</style>
  );
}

export function Badge({ status, small }) {
  const s = STATUS_MAP[status] || STATUS_MAP.cold;
  return (
    <span
      style={{
        background: s.bg,
        color: s.fg,
        fontFamily: FONT_BODY,
        fontSize: small ? 11 : 12,
        fontWeight: 600,
        padding: small ? "3px 8px" : "4px 10px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        letterSpacing: "0.01em",
      }}
    >
      {s.label}
    </span>
  );
}

export function CallTimer({ initialDuration = "00:00", active = true, style }) {
  const [seconds, setSeconds] = useState(() => {
    if (!initialDuration || typeof initialDuration !== "string" || !initialDuration.includes(":")) return 0;
    const parts = initialDuration.split(":").map((n) => parseInt(n, 10) || 0);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  });

  useEffect(() => {
    if (initialDuration && typeof initialDuration === "string" && initialDuration.includes(":")) {
      const parts = initialDuration.split(":").map((n) => parseInt(n, 10) || 0);
      setSeconds((parts[0] || 0) * 60 + (parts[1] || 0));
    }
  }, [initialDuration]);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [active]);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const formatted = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  return <span style={style}>{formatted}</span>;
}

export function NotificationBell({ notifications, setNotifications, onNavigate }) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState("");
  const items = useMemo(() => dedupeNotifications(notifications), [notifications]);
  const unread = items.filter((n) => n.unread).length;

  useEffect(() => {
    if (!setNotifications || !notifications?.length) return;
    const cleaned = dedupeNotifications(notifications);
    if (cleaned.length !== notifications.length) setNotifications(cleaned);
  }, [notifications?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const markOneRead = (n) => {
    const fp = notificationFingerprint(n.text);
    setNotifications((ns) =>
      dedupeNotifications(ns).map((x) =>
        x.id === n.id || notificationFingerprint(x.text) === fp ? { ...x, unread: false } : x
      )
    );
  };

  const goTo = (n) => {
    markOneRead(n);
    const { targetView, targetExtra } = resolveNotificationTarget(n);
    if (typeof onNavigate === "function") {
      onNavigate(targetView, targetExtra);
    } else if (typeof window !== "undefined" && typeof window.__voiceNavigate === "function") {
      window.__voiceNavigate(targetView, targetExtra);
    }
    // Panel stays open — only X / outside / clear closes it
  };

  const handleNotificationClick = (n) => {
    markOneRead(n);
    setActiveId((id) => (id === n.id ? "" : n.id));
  };

  const clearAll = () => {
    setNotifications([]);
    setActiveId("");
  };

  const getNotificationIcon = (n) => {
    const text = (n.text || "").toLowerCase();
    if (n.type === "alert" || text.includes("input") || text.includes("pricing") || text.includes("stuck")) {
      return <AlertTriangle size={15} color={C.amber} />;
    }
    if (n.type === "success" || text.includes("meeting") || text.includes("booked")) {
      return <CalendarCheck size={15} color={C.green} />;
    }
    if (text.includes("live") || text.includes("calling") || text.includes("lines")) {
      return <Radio size={15} color={C.cobalt} />;
    }
    if (text.includes("provider") || text.includes("key") || text.includes("api")) {
      return <KeyRound size={15} color={C.teal} />;
    }
    if (text.includes("call log") || text.includes("dnc") || text.includes("do-not-call")) {
      return <History size={15} color={C.slate} />;
    }
    return <Bell size={15} color={C.slate} />;
  };

  const hasUnread = unread > 0;

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="ui-icon-btn"
        onClick={() => setOpen((o) => !o)}
        title={hasUnread ? `${unread} unread` : "Notifications"}
        aria-expanded={open}
        style={{ width: 36, height: 36 }}
      >
        <Bell size={17} />
        {hasUnread && (
          <span style={{ position: "absolute", top: 3, right: 2, minWidth: 16, height: 16, borderRadius: 999, background: C.cobalt, color: "#fff", fontSize: 10, fontFamily: FONT_BODY, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px", border: "2px solid #fff", boxSizing: "content-box", fontVariantNumeric: "tabular-nums" }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => { setOpen(false); setActiveId(""); }} style={{ position: "fixed", inset: 0, zIndex: 999 }} />
          <div style={{ position: "absolute", top: 46, right: 0, width: 380, maxWidth: "90vw", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: "0 16px 40px rgba(18,20,28,0.16)", zIndex: 1000, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: `1px solid ${C.border}`, background: HUB_PAPER }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14.5, color: C.ink }}>Notifications</span>
                {unread > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, background: C.cobaltSoft, color: C.cobalt, padding: "2px 7px", borderRadius: 999 }}>
                    {unread} new
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {unread > 0 && (
                  <button
                    onClick={() => setNotifications((ns) => dedupeNotifications(ns).map((n) => ({ ...n, unread: false })))}
                    style={{ background: "none", border: "none", color: C.cobalt, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "2px 6px" }}
                  >
                    Mark all read
                  </button>
                )}
                {items.length > 0 && (
                  <button
                    onClick={clearAll}
                    style={{ background: "none", border: "none", color: C.slate, fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "2px 6px" }}
                  >
                    Clear all
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setOpen(false); setActiveId(""); }}
                  title="Close"
                  style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", color: C.slate, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* List with clean isolated scroll and zero-jitter hover */}
            <div
              style={{
                maxHeight: 340,
                overflowY: "auto",
                overscrollBehavior: "contain",
              }}
            >
              {items.length === 0 ? (
                <div style={{ padding: "36px 20px", textAlign: "center", color: C.slateLight, fontSize: 13 }}>
                  No notifications yet.
                </div>
              ) : (
                items.map((n) => {
                  const expanded = activeId === n.id;
                  return (
                  <div
                    key={n.id}
                    style={{
                      borderBottom: `1px solid ${C.border}`,
                      borderLeft: n.unread ? `3.5px solid ${C.cobalt}` : "3.5px solid transparent",
                      background: n.unread ? "#F8FAFF" : "#fff",
                    }}
                  >
                    <div
                      onClick={() => handleNotificationClick(n)}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        padding: "13px 16px 13px 14px",
                        cursor: "pointer",
                        transition: "background 0.12s ease",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#EFF4FF"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = n.unread ? "#F8FAFF" : "#fff"; }}
                    >
                      <div style={{ marginTop: 2, width: 28, height: 28, borderRadius: 7, background: n.unread ? C.cobaltSoft : C.paperSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {getNotificationIcon(n)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: n.unread ? 600 : 400, color: C.textInk, lineHeight: 1.45 }}>
                          {n.text}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                          <span style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>{ago(n)}</span>
                          <span style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, color: C.cobalt }}>
                            {notificationActionLabel(n)}
                          </span>
                        </div>
                      </div>
                    </div>
                    {expanded && (
                      <div style={{ padding: "0 16px 12px 54px" }}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); goTo(n); }}
                          style={{
                            height: 32,
                            padding: "0 12px",
                            borderRadius: 8,
                            border: "none",
                            background: C.cobalt,
                            color: "#fff",
                            fontFamily: FONT_BODY,
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {notificationActionLabel(n)}
                        </button>
                      </div>
                    )}
                  </div>
                  );
                })
              )}
            </div>

            {/* Footer Hint */}
            <div style={{ padding: "10px 18px", background: HUB_PAPER, borderTop: `1px solid ${C.border}`, fontSize: 11.5, color: C.slateLight, textAlign: "center" }}>
              Tap a notification, then Open to go there. Panel stays open until you close it.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function TopBar({ title, subtitle, onNewMission, notifications, setNotifications, onBack, canGoBack, backLabel, onNavigate }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "22px 32px 20px 32px",
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {canGoBack && onBack && (
          <button
            onClick={onBack}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 12px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: "#fff",
              color: C.textInk,
              fontFamily: FONT_BODY,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <ChevronLeft size={14} /> {backLabel || "Back"}
          </button>
        )}
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: C.textInk, letterSpacing: "-0.01em" }}>{title}</div>
          {subtitle && <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 2 }}>{subtitle}</div>}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <NotificationBell notifications={notifications} setNotifications={setNotifications} onNavigate={onNavigate || ((view, extra) => typeof window !== "undefined" && window.__voiceNavigate && window.__voiceNavigate(view, extra))} />
        {onNewMission && (
          <button
            onClick={onNewMission}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              background: C.ink,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "9px 15px",
              fontFamily: FONT_BODY,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <PlusCircle size={15} />
            New Outreach
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- missions list ---------------------------------- */


/* ---------------------------------- Tasks & Batch Calling Engine (Main Screen) ---------------------------------- */

export function SectionIntro({ icon: Icon, title, desc }) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, background: C.cobaltSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={15} color={C.cobaltDeep} />
      </div>
      <div>
        <div style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 14.5, color: C.textInk }}>{title}</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate, marginTop: 2, lineHeight: 1.5 }}>{desc}</div>
      </div>
    </div>
  );
}

export function Field({ label, value, onChange, placeholder, textarea, hint, maxLength }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: FONT_BODY, fontSize: 12, fontWeight: 600, color: C.slate, marginBottom: 6 }}>{label}</div>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ width: "100%", minHeight: 70, padding: 10, borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, resize: "none", outline: "none", boxSizing: "border-box" }}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: FONT_BODY, fontSize: 13, outline: "none", boxSizing: "border-box" }}
        />
      )}
      {hint && <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function SelfHostedHint() {
  return (
    <div style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: C.slate, marginTop: 6, lineHeight: 1.45 }}>
      Self-hosted model (Ollama, LM Studio, vLLM)? The key is optional. If this app runs in Docker and the model runs on the same machine, use <code>http://host.docker.internal:PORT</code> instead of localhost (the app tries that for you when localhost does not answer).
    </div>
  );
}

export function PluginCard({ icon: Icon, title, blurb, accent, ready, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 340,
        minHeight: 280,
        textAlign: "left",
        background: "#fff",
        border: `1px solid ${hover ? accent : C.border}`,
        borderRadius: 22,
        padding: 28,
        cursor: "pointer",
        boxShadow: hover ? "0 22px 48px rgba(18,20,28,0.10)" : "0 10px 28px rgba(18,20,28,0.04)",
        transform: hover ? "translateY(-3px)" : "none",
        transition: "transform 0.15s, box-shadow 0.15s, border-color 0.15s",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 14,
          background: `${accent}18`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 20,
        }}
      >
        <Icon size={24} color={accent} strokeWidth={2.1} />
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.slateLight, marginBottom: 8 }}>
        Plugin
      </div>
      <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: C.ink, letterSpacing: "-0.03em", lineHeight: 1.2 }}>
        {title}
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: C.slate, marginTop: 10, lineHeight: 1.5, flex: 1 }}>
        {blurb}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 22 }}>
        <span
          style={{
            fontFamily: FONT_BODY,
            fontSize: 11.5,
            fontWeight: 700,
            color: ready ? C.teal : C.amber,
            background: ready ? C.tealSoft : C.amberSoft,
            borderRadius: 999,
            padding: "4px 10px",
          }}
        >
          {ready ? "Open" : "Coming soon"}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: accent }}>
          {ready ? "Enter" : "Preview"} <ArrowRight size={14} />
        </span>
      </div>
    </button>
  );
}


/* ---------------------------------- Common AI Configuration Modal & Views ---------------------------------- */

// ── Shared building blocks (plan 10, Phase 4 item 4): one look for tooltips, empty states and notices across the apps ─────────────
// Clipped off screen but still read aloud, so a closed tooltip stays the button's description.
const SR_ONLY = { position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };

// A small "what is this" card: opens on hover, focus or a tap, closes with Escape or when the pointer leaves. It is fixed to the screen,
// so a table's scroll box never clips it, kept inside the screen at 375px, and opens above the button when there is no room below.
// `trigger` is what the button shows (an icon); `label` is what a screen reader says for it; the children are the card.
export function Tooltip({ trigger, label, children, width = 300, defaultOpen = false, triggerStyle }) {
  const [open, setOpen] = useState(defaultOpen);
  const [pos, setPos] = useState(null);
  const id = useId();
  const btn = useRef(null);
  const show = () => {
    const r = btn.current?.getBoundingClientRect?.();
    if (r && typeof window !== "undefined") {
      const w = Math.min(width, window.innerWidth - 32);
      const left = Math.max(16, Math.min(r.left, window.innerWidth - w - 16));
      const below = r.bottom + 6;
      setPos(below + 220 > window.innerHeight && r.top > 240 ? { left, bottom: window.innerHeight - r.top + 6, width: w } : { left, top: below, width: w });
    }
    setOpen(true);
  };
  return (
    <span style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }} onMouseEnter={show} onMouseLeave={() => setOpen(false)} onClick={(e) => e.stopPropagation()}>
      <button ref={btn} type="button" aria-describedby={id} aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); if (open) setOpen(false); else show(); }}
        onFocus={show} onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); e.stopPropagation(); } }}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, minWidth: 24, minHeight: 24, padding: 0, border: 0, background: "transparent", color: C.slate, cursor: "help", borderRadius: 6, ...triggerStyle }}>
        {trigger}
        {label ? <span style={SR_ONLY}>{label}</span> : null}
      </button>
      <span id={id} role="tooltip"
        style={open ? { position: pos ? "fixed" : "absolute", zIndex: 60, ...(pos || { left: 0, top: "100%", width: Math.min(width, 300) }), boxSizing: "border-box", maxWidth: "calc(100vw - 32px)",
          maxHeight: "60vh", overflowY: "auto", padding: "10px 12px", borderRadius: 10, background: "#fff", color: C.textInk, border: `1px solid ${C.border}`,
          boxShadow: "0 8px 24px rgba(15,23,42,.18)", fontFamily: FONT_BODY, fontSize: 12.5, lineHeight: 1.45, fontWeight: 400, whiteSpace: "normal", textAlign: "left" } : SR_ONLY}>
        {children}
      </span>
    </span>
  );
}

// What a page shows when it has nothing yet: an icon, a title, a line on how to get started, and the buttons that do it.
export function EmptyState({ icon: Icon, title, body, children }) {
  return (
    <div className="ui-card" style={{ padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10, fontFamily: FONT_BODY }}>
      {Icon ? (
        <div aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", background: C.cobaltSoft, color: C.cobalt }}>
          <Icon size={20} />
        </div>
      ) : null}
      <div style={{ fontSize: 15, fontWeight: 600, color: C.ink, marginTop: 4 }}>{title}</div>
      {body ? <div style={{ fontSize: 13, color: C.slate, lineHeight: 1.5, maxWidth: "46ch" }}>{body}</div> : null}
      {children ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 6 }}>{children}</div> : null}
    </div>
  );
}

const BANNER_TONES = {
  info: { bg: C.infoSoft, ink: C.infoInk, line: C.infoSoft },
  warn: { bg: C.warningBg, ink: C.warningInk, line: C.warningSoft },
  bad: { bg: C.dangerBg, ink: C.dangerInk, line: C.dangerBg },
  good: { bg: C.successBg, ink: C.successInk, line: C.successSoft },
  neutral: { bg: C.neutralBg, ink: C.textInk, line: C.border },
};

// A notice across a page or a card: a plan limit, an access rule, a problem, a done. The icon and the words carry the meaning, not only the colour.
export function Banner({ tone = "info", icon: Icon, title, children, action, role }) {
  const t = BANNER_TONES[tone] || BANNER_TONES.info;
  return (
    <div role={role || (tone === "bad" ? "alert" : "status")}
      style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 10, background: t.bg, border: `1px solid ${t.line}`, color: C.textInk, fontFamily: FONT_BODY, fontSize: 13, lineHeight: 1.5 }}>
      {Icon ? <Icon size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: t.ink }} /> : null}
      <div style={{ minWidth: 0, flex: 1 }}>
        {title ? <div style={{ fontWeight: 600, color: t.ink }}>{title}</div> : null}
        {children}
      </div>
      {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
    </div>
  );
}

// A small label: a status, a count, a source. The same look in the apps and the staff portal (the portal re-exports this one).
const PILL_TONES = {
  green: [C.green, C.greenSoft], red: [C.red, C.redSoft], amber: [C.amber, C.amberSoft], blue: [C.cobalt, C.cobaltSoft], slate: [C.slate, C.paperSoft],
};
PILL_TONES.good = PILL_TONES.green; PILL_TONES.bad = PILL_TONES.red; PILL_TONES.warn = PILL_TONES.amber; PILL_TONES.info = PILL_TONES.blue; PILL_TONES.muted = PILL_TONES.slate;
export function Pill({ tone = "slate", children, title }) {
  const [fg, bg] = PILL_TONES[tone] || PILL_TONES.slate;
  return <span title={title} style={{ display: "inline-block", fontSize: 11.5, fontWeight: 600, color: fg, background: bg, padding: "2px 9px", borderRadius: 99 }}>{children}</span>;
}

// The short "done" message at the bottom of the screen after an action. Read aloud politely; nothing to press.
export function Toast({ message }) {
  if (!message) return null;
  return (
    <div role="status" aria-live="polite" className="app-toast"
      style={{ position: "fixed", bottom: 24, right: 24, background: C.ink, color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
        boxShadow: "0 8px 24px rgba(0,0,0,0.2)", zIndex: 9999, maxWidth: "calc(100vw - 48px)", fontFamily: FONT_BODY }}>
      {message}
    </div>
  );
}

// ── Plain building blocks shared with the staff portal (they used to live in adminPortal/ui.jsx) ─────────────────────────────────
export const input = { padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: FONT_BODY, background: "#fff", boxSizing: "border-box" };

export const btn = (primary, disabled) => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: 9, cursor: disabled ? "not-allowed" : "pointer",
  border: primary ? "none" : `1px solid ${C.border}`, background: primary ? C.ink : "#fff", color: primary ? "#fff" : C.textInk,
  fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 600, opacity: disabled ? 0.55 : 1, whiteSpace: "nowrap",
});

export const card = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 };

export const cell = { padding: "8px 12px", borderTop: `1px solid ${C.border}`, fontSize: 12.5, textAlign: "left", verticalAlign: "middle" };

export const th = { padding: "8px 12px", fontSize: 11, color: C.slate, fontWeight: 700, textTransform: "uppercase", textAlign: "left", letterSpacing: "0.03em" };

export const when = (iso) => (iso ? new Date(iso + (/[Z+]/.test(iso.slice(19)) ? "" : "Z")).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

export function Note({ error, children }) {
  if (!children) return null;
  return (
    <div role={error ? "alert" : "status"} style={{ fontSize: 12.5, color: error ? C.red : C.teal, background: error ? C.redSoft : C.tealSoft, padding: "7px 11px", borderRadius: 9, margin: "8px 0" }}>
      {children}
    </div>
  );
}

// Runs an action, then shows what happened. Returns [message, isError, run].
export function useAction(after) {
  const [msg, setMsg] = React.useState({ text: "", error: false });
  const run = React.useCallback(async (fn, ok) => {
    setMsg({ text: "", error: false });
    try {
      const out = await fn();
      setMsg({ text: ok || "", error: false });
      if (after) await after();
      return out;
    } catch (err) {
      setMsg({ text: err.message, error: true });
      return undefined;
    }
  }, [after]);
  return [msg, run];
}

// Loads data once (and again on reload()).
export function useLoad(fn, deps = []) {
  const [state, setState] = React.useState({ data: null, error: "" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = React.useCallback(() => fn().then((data) => setState({ data, error: "" }), (err) => setState((s) => ({ ...s, error: err.message }))), deps);
  React.useEffect(() => { load(); }, [load]);
  return [state.data, state.error, load];
}
