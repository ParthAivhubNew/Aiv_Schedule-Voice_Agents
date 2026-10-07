import {
  CalendarCheck,
  ChevronDown,
  KeyRound,
  LogOut,
  Settings2,
  User,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { C, FONT_BODY, FONT_MONO, initialsFromName } from "../app/constants";
import { CallTimer } from "../app/ui";
import { routeHash } from "../utils/route";

export function UserProfileMenu({ operator, onLogout, commonAi, onOpenCommonAi, onOpenTeamUsers, onOpenProfileSettings, onOpenCalcomAdmin, onOpenDeveloperKeys }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const isAdmin = operator?.role === "Admin";
  const configuredProvidersList = (commonAi?.providers || []).filter(
    (p) => (p.status === "connected" && p.latencyMs) || (p.apiKey && p.apiKey.trim().length > 0)
  );
  const totalProvidersCount = (commonAi?.providers || []).length || 11;
  const configuredCount = configuredProvidersList.length;
  const isFullyConnected = configuredCount >= totalProvidersCount && totalProvidersCount > 0;
  const isPartiallyConnected = configuredCount > 0 && !isFullyConnected;
  const activeModelDisplay = commonAi?.baseChatModel
    ? commonAi.baseChatModel.split(" ")[0]
    : (configuredCount > 0 ? `${configuredCount} Active` : "Not configured");

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: open ? "#fff" : "#fff",
          border: `1px solid ${open ? C.cobalt : C.border}`,
          borderRadius: 999,
          padding: "4px 14px 4px 5px",
          cursor: "pointer",
          boxShadow: open ? "0 4px 14px rgba(52,87,213,0.14)" : "0 2px 8px rgba(18,20,28,0.04)",
          transition: "all 0.15s ease",
        }}
      >
        <div style={{
          width: 32,
          height: 32,
          borderRadius: 999,
          background: isAdmin ? `linear-gradient(135deg, ${C.cobalt}, #6366F1)` : C.slate,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FONT_BODY,
          fontSize: 12,
          fontWeight: 700,
          boxShadow: "0 2px 6px rgba(52,87,213,0.2)",
        }}>
          {initialsFromName(operator?.name)}
        </div>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 700, color: C.textInk, lineHeight: 1.2 }}>
            {operator?.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
            <span style={{
              fontSize: 9.5,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              padding: "1px 6px",
              borderRadius: 4,
              background: isAdmin ? "#EEF2FF" : C.paperSoft,
              color: isAdmin ? "#4338CA" : C.slate,
            }}>
              {operator?.role}
            </span>
          </div>
        </div>
        <ChevronDown size={14} color={C.slate} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s ease", marginLeft: 4 }} />
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          right: 0,
          width: 305,
          background: "#fff",
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          boxShadow: "0 18px 50px rgba(18,20,28,0.16)",
          padding: 8,
          zIndex: 150,
        }}>
          {/* Header Card */}
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.borderLight}`, marginBottom: 6 }}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 700, color: C.textInk }}>{operator?.name}</div>
            <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight, marginTop: 1 }}>@{operator?.username}</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.slate, marginTop: 3 }}>
              {operator?.email || `${operator?.username}@aivhub.io`}
            </div>
          </div>

          {/* Admin Controls */}
          {isAdmin && (
            <>
              <div style={{ padding: "4px 10px", fontFamily: FONT_BODY, fontSize: 10, fontWeight: 700, color: C.slateLight, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Admin Controls
              </div>

              {/* AI Configuration (Outreach's own organisation only) */}
              {onOpenCommonAi && <button
                onClick={() => { setOpen(false); onOpenCommonAi(); }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = C.paperSoft}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: C.cobaltSoft, display: "flex", alignItems: "center", justifyContent: "center", color: C.cobalt }}>
                    <Settings2 size={15} />
                  </div>
                  <div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk }}>AI Configuration</div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>App models & API keys</div>
                  </div>
                </div>
                {isFullyConnected ? (
                  <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: "4px 10px",
                    borderRadius: 8,
                    background: "#ECFDF5",
                    color: "#059669",
                    border: "1px solid #A7F3D0",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: "#059669", flexShrink: 0 }} />
                    All Active
                  </span>
                ) : isPartiallyConnected ? (
                  <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: "4px 10px",
                    borderRadius: 8,
                    background: "#F1F5F9",
                    color: "#475569",
                    border: "1px solid #CBD5E1",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: "#94A3B8", flexShrink: 0 }} />
                    {configuredCount} / {totalProvidersCount} Connected
                  </span>
                ) : (
                  <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11.5,
                    fontWeight: 700,
                    padding: "4px 10px",
                    borderRadius: 8,
                    background: "#F8FAFC",
                    color: "#64748B",
                    border: "1px solid #E2E8F0",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: "#94A3B8", flexShrink: 0 }} />
                    Not configured
                  </span>
                )}
              </button>}

              {/* Users & roles (admins and anyone given the Users & roles section) */}
              {(operator?.is_admin || (operator?.permissions && operator.permissions.team && operator.permissions.team !== "none")) && (
              <button
                onClick={() => { setOpen(false); onOpenTeamUsers(); }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 10,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = C.paperSoft}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <Users size={15} color={C.cobalt} />
                <div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk }}>Users & roles</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>Add people and choose what they can see</div>
                </div>
              </button>
              )}

              {/* Calendar & meetings (host mail, invite accounts, embeds) */}
              <button
                onClick={() => { setOpen(false); if (onOpenCalcomAdmin) onOpenCalcomAdmin("accounts"); }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "9px 12px",
                  borderRadius: 10,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = C.paperSoft}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: "#ECFDF5", display: "flex", alignItems: "center", justifyContent: "center", color: "#059669" }}>
                    <CalendarCheck size={15} />
                  </div>
                  <div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk }}>Calendar & meetings</div>
                    <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>Invite mail, embeds & host sync</div>
                  </div>
                </div>
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "3px 8px",
                  borderRadius: 6,
                  background: "#ECFDF5",
                  color: "#059669",
                  border: "1px solid #A7F3D0"
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: 999, background: "#059669" }} />
                  Admin
                </span>
              </button>

              {/* Developer API Keys */}
              {onOpenDeveloperKeys && (
                <button
                  onClick={() => { setOpen(false); onOpenDeveloperKeys(); }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "9px 12px",
                    borderRadius: 10,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = C.paperSoft}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: "#EEF2FF", display: "flex", alignItems: "center", justifyContent: "center", color: C.cobalt }}>
                      <KeyRound size={15} />
                    </div>
                    <div>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk }}>Developer API Keys</div>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>Voice, Leads & Social APIs</div>
                    </div>
                  </div>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 6px",
                    borderRadius: 6,
                    background: "#EEF2FF",
                    color: C.cobalt,
                  }}>
                    API
                  </span>
                </button>
              )}

              <div style={{ height: 1, background: C.borderLight, margin: "6px 8px" }} />
            </>
          )}

          {/* User Settings */}
          <button
            onClick={() => { setOpen(false); onOpenProfileSettings(); }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 12px",
              borderRadius: 10,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = C.paperSoft}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
          >
            <User size={15} color={C.slate} />
            <div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: C.textInk }}>Profile Settings</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 11, color: C.slateLight }}>Name & email details</div>
            </div>
          </button>

          <div style={{ height: 1, background: C.borderLight, margin: "6px 8px" }} />

          {/* Logout */}
          <button
            onClick={() => { setOpen(false); onLogout(); }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 12px",
              borderRadius: 10,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
              color: C.red,
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = C.redSoft}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
          >
            <LogOut size={15} color={C.red} />
            <div style={{ fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600 }}>Sign out</div>
          </button>
        </div>
      )}
    </div>
  );
}

export function UniversalCallNotificationBanner({ activeCalls, currentPlugin, onJumpToVoice, onDismissCall }) {
  if (!activeCalls || activeCalls.length === 0) return null;

  const isAlreadyOnLiveView = currentPlugin === "voice" && (routeHash() || "").includes("/live");
  if (isAlreadyOnLiveView) return null;

  const primaryCall = activeCalls[0];
  const callerLabel = primaryCall.prospect || primaryCall.caller || primaryCall.phone || "Inbound Caller";
  const duration = primaryCall.duration || "00:01";
  const isOtherPlugin = currentPlugin !== "voice";

  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        right: 24,
        zIndex: 999999,
        maxWidth: 420,
        minWidth: 340,
        background: "linear-gradient(135deg, #0F172A 0%, #1E1B4B 100%)",
        border: "2px solid #6366F1",
        borderRadius: 14,
        boxShadow: "0 14px 40px rgba(0, 0, 0, 0.6), 0 0 24px rgba(99, 102, 241, 0.4)",
        color: "#fff",
        padding: "16px 18px",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {/* Top Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#10B981",
              display: "inline-block",
              boxShadow: "0 0 10px #10B981",
            }}
          />
          <span style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "#A5B4FC" }}>
            {isOtherPlugin ? "Live Call in Progress" : "Inbound Call Ringing"}
          </span>
          <span
            style={{
              background: "rgba(16, 185, 129, 0.18)",
              border: "1px solid rgba(16, 185, 129, 0.4)",
              color: "#34D399",
              padding: "2px 7px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            ⏱ <CallTimer initialDuration={duration} active={true} />
          </span>
        </div>
        <button
          onClick={() => onDismissCall(primaryCall.id || primaryCall.call_sid)}
          style={{
            background: "transparent",
            border: "none",
            color: "#94A3B8",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: 4,
          }}
          title="Dismiss notification"
        >
          ✕
        </button>
      </div>

      {/* Caller Info */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#FFFFFF", marginBottom: 3, display: "flex", alignItems: "center", gap: 6 }}>
          <span>📞</span>
          <span>{callerLabel}</span>
        </div>
        <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 1.4 }}>
          {isOtherPlugin
            ? "AI Operator is speaking live with caller. Take over or listen now!"
            : "Caller is connected live. Switch to the live monitor to take over or listen."}
        </div>
        {isOtherPlugin && (
          <div style={{ fontSize: 11, color: "#A5B4FC", marginTop: 5, display: "flex", alignItems: "center", gap: 5 }}>
            <span>💾</span>
            <span>Your ongoing work in this app is automatically preserved.</span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={() => onJumpToVoice(primaryCall)}
          style={{
            flex: 1,
            background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            boxShadow: "0 4px 12px rgba(16, 185, 129, 0.35)",
          }}
        >
          ⚡ {isOtherPlugin ? "Jump to Call & Take Over" : "Switch to Live Monitor"} &rarr;
        </button>
        <button
          onClick={() => onDismissCall(primaryCall.id || primaryCall.call_sid)}
          style={{
            background: "rgba(255, 255, 255, 0.08)",
            color: "#CBD5E1",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
