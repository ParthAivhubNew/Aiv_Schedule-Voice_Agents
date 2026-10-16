import {
  CalendarCheck,
  ChevronDown,
  KeyRound,
  Link2,
  LogOut,
  Settings2,
  User,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { C, FONT_BODY, FONT_MONO } from "../app/constants";
import { CallTimer } from "../app/ui";
import { routeHash } from "../utils/route";
import { Avatar } from "./Avatar";

export function UserProfileMenu({ operator, onLogout, commonAi, onOpenCommonAi, onOpenTeamUsers, onOpenProfileSettings, onOpenCalcomAdmin, onOpenDeveloperKeys, onOpenConnections, compact }) {
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
          padding: compact ? "3px 8px 3px 3px" : "4px 14px 4px 5px",
          cursor: "pointer",
          boxShadow: open ? "0 4px 14px rgba(52,87,213,0.14)" : "0 2px 8px rgba(18,20,28,0.04)",
          transition: "all 0.15s ease",
        }}
      >
        <Avatar user={operator} size={32} bg={isAdmin ? `linear-gradient(135deg, ${C.cobalt}, #6366F1)` : C.slate} />
        {compact ? null : (
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
        )}
        <ChevronDown size={14} color={C.slate} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s ease", marginLeft: compact ? 0 : 4 }} />
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
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.borderLight}`, marginBottom: 6, display: "flex", gap: 12, alignItems: "center" }}>
            <Avatar user={operator} size={44} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 700, color: C.textInk }}>{operator?.name}</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: C.slateLight, marginTop: 1 }}>{operator?.profile?.job_title || `@${operator?.username}`}</div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.slate, marginTop: 3, overflowWrap: "anywhere" }}>
                {operator?.email || `${operator?.username}@aivhub.io`}
              </div>
            </div>
          </div>

          {/* Everyone: the same row, the same icon tile, the same spacing */}
          <MenuItem icon={User} title="Your profile" sub="Photo, details and security" onClick={() => { setOpen(false); onOpenProfileSettings(); }} />
          {onOpenConnections ? (
            <MenuItem icon={Link2} title="Connections" sub="How Leads, Voice & Social work together" onClick={() => { setOpen(false); onOpenConnections(); }} />
          ) : null}

          {/* Admin Controls */}
          {isAdmin && (
            <>
              <div style={{ height: 1, background: C.borderLight, margin: "6px 8px" }} />
              <div style={{ padding: "4px 10px", fontFamily: FONT_BODY, fontSize: 10, fontWeight: 700, color: C.slateLight, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Admin Controls
              </div>
              {(operator?.is_admin || (operator?.permissions && operator.permissions.team && operator.permissions.team !== "none")) ? (
                <MenuItem icon={Users} title="Users & roles" sub="Add people and choose what they can see" onClick={() => { setOpen(false); onOpenTeamUsers(); }} />
              ) : null}
              <MenuItem icon={CalendarCheck} title="Calendar & meetings" sub="Invite mail, embeds & host sync" badge="Admin"
                onClick={() => { setOpen(false); if (onOpenCalcomAdmin) onOpenCalcomAdmin("accounts"); }} />
              {onOpenDeveloperKeys ? (
                <MenuItem icon={KeyRound} title="Admin APIs & Webhooks" sub="Voice, Leads & Social APIs" badge="API"
                  onClick={() => { setOpen(false); onOpenDeveloperKeys(); }} />
              ) : null}
              {/* AI Configuration (Outreach's own organisation only) */}
              {onOpenCommonAi ? (
                <MenuItem icon={Settings2} title="AI Configuration" sub="App models & API keys"
                  badge={isFullyConnected ? "All active" : isPartiallyConnected ? `${configuredCount} / ${totalProvidersCount} connected` : "Not configured"}
                  onClick={() => { setOpen(false); onOpenCommonAi(); }} />
              ) : null}
            </>
          )}

          <div style={{ height: 1, background: C.borderLight, margin: "6px 8px" }} />
          <MenuItem icon={LogOut} title="Sign out" danger onClick={() => { setOpen(false); onLogout(); }} />
        </div>
      )}
    </div>
  );
}

// One row of the profile menu. Every row looks the same: an icon in a tile, a title, a line under it, and a badge if it has one.
function MenuItem({ icon: Icon, title, sub, badge, danger, onClick }) {
  const tone = danger ? { bg: C.redSoft, fg: C.red } : { bg: C.cobaltSoft, fg: C.cobalt };
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", borderRadius: 10, border: "none", background: "transparent", cursor: "pointer", textAlign: "left", boxSizing: "border-box" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = danger ? C.redSoft : C.paperSoft; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: tone.bg, color: tone.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={17} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: danger ? C.red : C.textInk }}>{title}</span>
        {sub ? <span style={{ display: "block", fontFamily: FONT_BODY, fontSize: 11.5, color: C.slateLight, lineHeight: 1.35 }}>{sub}</span> : null}
      </span>
      {badge ? (
        <span style={{ flexShrink: 0, fontFamily: FONT_BODY, fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: C.paperSoft, color: C.slate, border: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{badge}</span>
      ) : null}
    </button>
  );
}

export function UniversalCallNotificationBanner({ activeCalls, currentPlugin, onJumpToVoice, onDismissCall }) {
  if (!activeCalls || activeCalls.length === 0) return null;

  const isAlreadyOnLiveView = currentPlugin === "voice" && (routeHash() || "").includes("/live");
  if (isAlreadyOnLiveView) return null;

  // A call the assistant needs a person for always comes first.
  const primaryCall = activeCalls.find((c) => c.needsPerson) || activeCalls[0];
  const needsPerson = Boolean(primaryCall.needsPerson);
  const callerLabel = primaryCall.prospect || primaryCall.caller || primaryCall.phone || "Inbound Caller";
  const duration = primaryCall.duration || "00:01";
  const isOtherPlugin = currentPlugin !== "voice";

  return (
    <div
      role={needsPerson ? "alert" : undefined}
      style={{
        position: "fixed",
        top: 20,
        right: 24,
        zIndex: 999999,
        maxWidth: 420,
        minWidth: 340,
        background: needsPerson ? "linear-gradient(135deg, #3B0A0A 0%, #1E1B4B 100%)" : "linear-gradient(135deg, #0F172A 0%, #1E1B4B 100%)",
        border: needsPerson ? "2px solid #F87171" : "2px solid #6366F1",
        borderRadius: 14,
        boxShadow: needsPerson ? "0 14px 40px rgba(0, 0, 0, 0.6), 0 0 24px rgba(248, 113, 113, 0.5)" : "0 14px 40px rgba(0, 0, 0, 0.6), 0 0 24px rgba(99, 102, 241, 0.4)",
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
            {needsPerson ? "A call needs you now" : isOtherPlugin ? "Live Call in Progress" : "Inbound Call Ringing"}
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
          {needsPerson
            ? `The assistant asked for a person${primaryCall.flag ? `: ${primaryCall.flag}` : "."}`
            : isOtherPlugin
              ? "AI Operator is speaking live with caller. Take over or listen now!"
              : "Caller is connected live. Switch to the live monitor to take over or listen."}
        </div>
        {needsPerson && primaryCall.summary ? (
          <div style={{ fontSize: 12, color: "#E2E8F0", lineHeight: 1.5, marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.07)", whiteSpace: "pre-wrap", maxHeight: 150, overflowY: "auto" }}>
            {primaryCall.summary}
          </div>
        ) : null}
        {needsPerson && !primaryCall.summary ? (
          <div style={{ fontSize: 11.5, color: "#FCA5A5", marginTop: 6 }}>Writing a summary of the call for you…</div>
        ) : null}
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
          ⚡ {needsPerson ? "Open the call & take over" : isOtherPlugin ? "Jump to Call & Take Over" : "Switch to Live Monitor"} &rarr;
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
