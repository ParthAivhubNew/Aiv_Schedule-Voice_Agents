import React, { useState, useRef, useEffect, useMemo } from "react";
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
  const [activeId, setActiveId] = useState("");
  const bellRef = useRef(null);

  const items = useMemo(() => dedupeNotifications(notifications), [notifications]);
  const unreadCount = items.filter((n) => n.unread).length;
  const hasUnread = unreadCount > 0;

  const markAllRead = () => {
    if (!setNotifications) return;
    setNotifications((ns) => dedupeNotifications(ns).map((n) => ({ ...n, unread: false })));
  };

  const clearAll = () => {
    if (!setNotifications) return;
    setNotifications([]);
    setActiveId("");
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

  const goTo = (n) => {
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

  const handleItemClick = (n) => {
    markOneRead(n);
    setActiveId((id) => (id === n.id ? "" : n.id));
    // Panel stays open — close only via X, Clear all empty, or outside tap
  };

  useEffect(() => {
    function handleClickOutside(e) {
      if (bellRef.current && !bellRef.current.contains(e.target)) {
        setOpen(false);
        setActiveId("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!setNotifications || !notifications.length) return;
    const cleaned = dedupeNotifications(notifications);
    if (cleaned.length !== notifications.length) {
      setNotifications(cleaned);
    }
  }, [notifications.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={bellRef} style={{ position: "relative" }}>
      <style>{`
        @keyframes aivhubBellPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(52,87,213,0.45); transform: scale(1); }
          50% { box-shadow: 0 0 0 8px rgba(52,87,213,0); transform: scale(1.06); }
        }
      `}</style>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
        <div
          style={{
            position: "absolute",
            top: 46,
            right: 0,
            width: 360,
            background: "rgba(18, 22, 41, 0.97)",
            backdropFilter: "blur(20px)",
            borderRadius: 16,
            border: `1px solid ${C.border}`,
            boxShadow: "0 20px 50px rgba(0,0,0,0.6)",
            padding: 0,
            zIndex: 100,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 10px", gap: 8 }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: "#fff" }}>
              Notifications{unreadCount > 0 ? ` · ${unreadCount}` : ""}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  style={{
                    background: "none",
                    border: "none",
                    color: C.cobaltDeep,
                    fontFamily: FONT_BODY,
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: 0,
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
                    color: C.slateLight,
                    fontFamily: FONT_BODY,
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Trash2 size={12} /> Clear all
                </button>
              )}
              <button
                type="button"
                onClick={() => { setOpen(false); setActiveId(""); }}
                title="Close"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  border: "none",
                  background: "rgba(255,255,255,0.08)",
                  color: "#fff",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 360, overflowY: "auto", padding: "0 12px 14px" }}>
            {items.length === 0 ? (
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight, textAlign: "center", padding: "16px 0" }}>
                No notifications
              </div>
            ) : (
              items.map((n) => {
                const expanded = activeId === n.id;
                return (
                  <div
                    key={n.id}
                    style={{
                      borderRadius: 10,
                      background: n.unread ? "rgba(75,115,255,0.12)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${n.unread ? "rgba(75,115,255,0.25)" : "transparent"}`,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleItemClick(n)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleItemClick(n); }}
                      style={{
                        display: "flex",
                        gap: 10,
                        padding: 10,
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ marginTop: 2 }}>
                        {n.type === "success" && <CheckCircle2 size={15} color={C.teal} />}
                        {n.type === "alert" && <AlertTriangle size={15} color={C.amber} />}
                        {(n.type === "info" || !n.type) && <Info size={15} color={C.cobaltDeep} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: "#F8FAFC", lineHeight: 1.4 }}>{n.text}</div>
                        <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.slate, marginTop: 2 }}>{n.time}</div>
                      </div>
                    </div>
                    {expanded && (
                      <div style={{ padding: "0 10px 10px 35px" }}>
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
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <ExternalLink size={12} /> {notificationActionLabel(n)}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
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
