import React, { useState, useRef, useEffect, useMemo, useLayoutEffect } from "react";
import { Bell, PlusCircle, CheckCircle2, AlertTriangle, Info, X, Trash2, ExternalLink } from "lucide-react";
import {
  C,
  FONT_BODY,
  FONT_DISPLAY,
  dedupeNotifications,
  notificationFingerprint,
  resolveNotificationTarget,
  notificationActionLabel,
  callingPageFromTarget,
} from "../tokens";

export function NotificationBell({ notifications = [], setNotifications, onNavigate }) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 56, right: 16 });
  const bellRef = useRef(null);

  const items = useMemo(() => dedupeNotifications(notifications), [notifications]);
  const unreadCount = items.filter((n) => n.unread).length;
  const hasUnread = unreadCount > 0;

  const closePanel = () => setOpen(false);

  const markAllRead = (e) => {
    if (e) e.stopPropagation();
    if (!setNotifications) return;
    setNotifications((ns) => dedupeNotifications(ns).map((n) => ({ ...n, unread: false })));
  };

  const clearAll = (e) => {
    if (e) e.stopPropagation();
    if (!setNotifications) return;
    setNotifications([]);
  };

  const markOneRead = (n) => {
    if (!setNotifications || !n) return;
    const fp = notificationFingerprint(n.text);
    setNotifications((ns) =>
      dedupeNotifications(ns).map((x) =>
        x.id === n.id || notificationFingerprint(x.text) === fp ? { ...x, unread: false } : x
      )
    );
  };

  const goTo = (e, n) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!n) return;
    markOneRead(n);
    const resolved = resolveNotificationTarget(n);
    const targetView = resolved.targetView;
    const targetExtra = resolved.targetExtra || {};
    if (typeof onNavigate === "function") {
      onNavigate(n, {
        targetView,
        targetExtra,
        page: callingPageFromTarget(targetView),
      });
      return;
    }
    if (typeof window !== "undefined" && typeof window.__voiceNavigate === "function") {
      window.__voiceNavigate(targetView, targetExtra);
    }
  };

  // Panel stays open on item click — only mark read
  const handleItemClick = (e, n) => {
    e.preventDefault();
    e.stopPropagation();
    markOneRead(n);
  };

  useLayoutEffect(() => {
    if (!open || !bellRef.current) return;
    const place = () => {
      const r = bellRef.current.getBoundingClientRect();
      setPanelPos({
        top: Math.round(r.bottom + 8),
        right: Math.max(8, Math.round(window.innerWidth - r.right)),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!setNotifications || !notifications.length) return;
    const cleaned = dedupeNotifications(notifications);
    if (cleaned.length !== notifications.length) setNotifications(cleaned);
  }, [notifications.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") closePanel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={bellRef} style={{ position: "relative", flexShrink: 0 }}>
      <style>{`
        @keyframes aivhubBellPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(52,87,213,0.45); transform: scale(1); }
          50% { box-shadow: 0 0 0 8px rgba(52,87,213,0); transform: scale(1.06); }
        }
      `}</style>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title={hasUnread ? `${unreadCount} unread` : "Notifications"}
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          border: hasUnread ? `2px solid ${C.cobalt}` : `1px solid ${C.border}`,
          background: hasUnread ? C.cobalt : C.paperSoft,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          position: "relative",
          color: hasUnread ? "#fff" : C.slate,
          animation: hasUnread ? "aivhubBellPulse 1.6s ease-in-out infinite" : "none",
        }}
      >
        <Bell size={16} />
        {hasUnread && (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              minWidth: 18,
              height: 18,
              padding: "0 5px",
              borderRadius: 99,
              background: C.redSolid,
              color: "#fff",
              fontSize: 10,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid #fff",
            }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop — tap outside closes. Panel clicks stopPropagation. */}
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              closePanel();
            }}
            style={{ position: "fixed", inset: 0, zIndex: 9998, background: "transparent" }}
          />
          <div
            role="dialog"
            aria-label="Notifications"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: panelPos.top,
              right: panelPos.right,
              width: 360,
              maxWidth: "calc(100vw - 16px)",
              maxHeight: "min(70vh, 480px)",
              background: "rgba(18, 22, 41, 0.98)",
              backdropFilter: "blur(20px)",
              borderRadius: 16,
              border: `1px solid rgba(255,255,255,0.12)`,
              boxShadow: "0 20px 50px rgba(0,0,0,0.55)",
              zIndex: 9999,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                gap: 8,
                flexShrink: 0,
              }}
            >
              <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: "#fff" }}>
                Notifications{unreadCount > 0 ? ` · ${unreadCount}` : ""}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllRead}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#93B4FF",
                      fontFamily: FONT_BODY,
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      padding: "4px 2px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Mark all read
                  </button>
                )}
                {items.length > 0 && (
                  <button
                    type="button"
                    onClick={clearAll}
                    title="Clear all"
                    style={{
                      background: "none",
                      border: "none",
                      color: "#A0A6B5",
                      fontFamily: FONT_BODY,
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      padding: "4px 2px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Trash2 size={12} /> Clear all
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); closePanel(); }}
                  title="Close"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    border: "none",
                    background: "rgba(255,255,255,0.1)",
                    color: "#fff",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "10px 10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              {items.length === 0 ? (
                <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: "#9CA3AF", textAlign: "center", padding: "20px 0" }}>
                  No notifications
                </div>
              ) : (
                items.map((n) => (
                  <div
                    key={n.id}
                    onClick={(e) => handleItemClick(e, n)}
                    style={{
                      borderRadius: 10,
                      background: n.unread ? "rgba(75,115,255,0.14)" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${n.unread ? "rgba(75,115,255,0.3)" : "rgba(255,255,255,0.06)"}`,
                      padding: "10px 10px 8px",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", gap: 10 }}>
                      <div style={{ marginTop: 2, flexShrink: 0 }}>
                        {n.type === "success" && <CheckCircle2 size={15} color={C.teal} />}
                        {n.type === "alert" && <AlertTriangle size={15} color={C.amber} />}
                        {(n.type === "info" || !n.type) && <Info size={15} color="#7B9CFF" />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: "#F8FAFC", lineHeight: 1.4 }}>
                          {n.text}
                        </div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: "#9CA3AF", marginTop: 3 }}>
                          {n.time}
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 8, paddingLeft: 25 }}>
                      <button
                        type="button"
                        onClick={(e) => goTo(e, n)}
                        style={{
                          height: 28,
                          padding: "0 10px",
                          borderRadius: 7,
                          border: "none",
                          background: C.cobalt,
                          color: "#fff",
                          fontFamily: FONT_BODY,
                          fontSize: 11.5,
                          fontWeight: 700,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <ExternalLink size={11} /> {notificationActionLabel(n)}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function TopBar({ title, subtitle, onNewMission, notifications, setNotifications, onNavigate }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "20px 32px",
        borderBottom: `1px solid ${C.border}`,
        background: "rgba(9, 11, 19, 0.85)",
        backdropFilter: "blur(16px)",
      }}
    >
      <div>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: "#FFFFFF", margin: 0, letterSpacing: "-0.03em" }}>
          {title}
        </h1>
        {subtitle && (
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: C.slate, marginTop: 3 }}>
            {subtitle}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {onNewMission && (
          <button
            onClick={onNewMission}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 38,
              padding: "0 18px",
              borderRadius: 10,
              border: "none",
              background: C.gradientPrimary,
              color: "#fff",
              fontFamily: FONT_BODY,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: C.glowPrimary,
              transition: "transform 0.15s, box-shadow 0.15s",
            }}
          >
            <PlusCircle size={15} /> New Outreach
          </button>
        )}
        <NotificationBell notifications={notifications} setNotifications={setNotifications} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
