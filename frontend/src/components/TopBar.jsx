import React, { useState, useRef, useEffect } from "react";
import { Bell, PlusCircle, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { C, FONT_BODY, FONT_DISPLAY } from "../tokens";

export function NotificationBell({ notifications = [], setNotifications }) {
  const [open, setOpen] = useState(false);
  const bellRef = useRef(null);

  const unreadCount = notifications.filter((n) => n.unread).length;

  const markAllRead = () => {
    setNotifications((ns) => ns.map((n) => ({ ...n, unread: false })));
  };

  useEffect(() => {
    function handleClickOutside(e) {
      if (bellRef.current && !bellRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={bellRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          border: `1px solid ${C.border}`,
          background: C.paperSoft,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          position: "relative",
          color: C.slate,
        }}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: 7,
              right: 7,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: C.gradientSunset,
              boxShadow: "0 0 8px rgba(255,84,226,0.8)",
            }}
          />
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
            {notifications.length === 0 ? (
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight, textAlign: "center", padding: "16px 0" }}>
                No notifications
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: 10,
                    borderRadius: 10,
                    background: n.unread ? "rgba(75,115,255,0.12)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${n.unread ? "rgba(75,115,255,0.25)" : "transparent"}`,
                  }}
                >
                  <div style={{ marginTop: 2 }}>
                    {n.type === "success" && <CheckCircle2 size={15} color={C.teal} />}
                    {n.type === "alert" && <AlertTriangle size={15} color={C.amber} />}
                    {n.type === "info" && <Info size={15} color={C.cobaltDeep} />}
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
