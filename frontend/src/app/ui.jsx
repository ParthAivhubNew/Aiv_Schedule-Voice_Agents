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
import { useEffect, useMemo, useState } from "react";
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
                          <span style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>{n.time}</span>
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

export function Field({ label, value, onChange, placeholder, textarea, hint }) {
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
