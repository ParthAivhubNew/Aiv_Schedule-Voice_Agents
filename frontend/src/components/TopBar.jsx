import React, { useState, useRef, useEffect, useMemo } from "react";
import { Bell, PlusCircle, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY, dedupeNotifications, notificationFingerprint } from "../tokens";

export function NotificationBell({ notifications = [], setNotifications, onNavigate }) {
  const [open, setOpen] = useState(false);
  const bellRef = useRef(null);

  const items = useMemo(() => dedupeNotifications(notifications), [notifications]);
  const unreadCount = items.filter((n) => n.unread).length;
  const hasUnread = unreadCount > 0;

  const markAllRead = () => {
    if (!setNotifications) return;
    setNotifications((ns) => dedupeNotifications(ns).map((n) => ({ ...n, unread: false })));
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

  const handleItemClick = (n) => {
    markOneRead(n);
    setOpen(false);
    if (typeof onNavigate === "function") {
      onNavigate(n);
      return;
    }
    if (typeof window !== "undefined" && typeof window.__voiceNavigate === "function" && n.targetView) {
      window.__voiceNavigate(n.targetView, n.targetExtra || {});
    }
  };

  useEffect(() => {
    function handleClickOutside(e) {
      if (bellRef.current && !bellRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // One-time cleanup of stored duplicates when panel opens / list grows
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
            width: 340,
            background: "rgba(18, 22, 41, 0.95)",
            backdropFilter: "blur(20px)",
            borderRadius: 16,
            border: `1px solid ${C.border}`,
            boxShadow: "0 20px 50px rgba(0,0,0,0.6)",
            padding: 18,
            zIndex: 100,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontFamily: FONT_BODY, fontWeight: 700, fontSize: 13, color: "#fff" }}>Notifications</span>
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
                Mark all as read
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
            {items.length === 0 ? (
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight, textAlign: "center", padding: "16px 0" }}>
                No notifications
              </div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleItemClick(n)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleItemClick(n); }}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: 10,
                    borderRadius: 10,
                    background: n.unread ? "rgba(75,115,255,0.12)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${n.unread ? "rgba(75,115,255,0.25)" : "transparent"}`,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ marginTop: 2 }}>
                    {n.type === "success" && <CheckCircle2 size={15} color={C.teal} />}
                    {n.type === "alert" && <AlertTriangle size={15} color={C.amber} />}
                    {(n.type === "info" || !n.type) && <Info size={15} color={C.cobaltDeep} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 12.5, color: "#F8FAFC", lineHeight: 1.4 }}>{n.text}</div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 10.5, color: C.slate, marginTop: 2 }}>{n.time}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TopBar({ title, subtitle, onNewMission, notifications, setNotifications }) {
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
        <NotificationBell notifications={notifications} setNotifications={setNotifications} />
      </div>
    </div>
  );
}
