import React from "react";
import { C } from "../tokens";

const DEFAULT_TYPES = [
  { id: "phone", label: "Phone call", hint: "We dial them", enabled: true },
  { id: "video", label: "Video meeting", hint: "Join URL", enabled: true },
  { id: "in_person", label: "In person", hint: "Address", enabled: true },
];

const DEFAULT_NOTIFY = [
  { id: "whatsapp", label: "WhatsApp confirmation", hint: "After booking only", enabled: true, is_meeting_type: false },
];

const RULE_KEYS = [
  ["ask_meeting_type_on_call", "Ask which meeting type first"],
  ["confirm_existing_bookings", "Confirm if they already have a booking"],
  ["offer_notify_after_book", "Offer notify channel after booking"],
  ["ask_before_hangup", "Ask before hanging up (confirm then goodbye)"],
];

/**
 * Call-rules editor (default): hard toggles + free-text for the voice agent.
 * Pass showCatalog to also edit meeting types / notify (Calendar admin only).
 */
export function BookingPolicyEditor({ bookingPolicy, onChange, style, showCatalog = false }) {
  const bp = bookingPolicy || {};
  const types = Array.isArray(bp.meeting_types) && bp.meeting_types.length
    ? bp.meeting_types
    : DEFAULT_TYPES;
  const notify = Array.isArray(bp.notify_channels) && bp.notify_channels.length
    ? bp.notify_channels
    : DEFAULT_NOTIFY;

  const patch = (next) => {
    onChange({ ...bp, meeting_types: types, notify_channels: notify, ...next });
  };

  return (
    <div
      style={{
        marginBottom: 18,
        padding: 14,
        borderRadius: 10,
        background: C.paperSoft || "#F7F8FA",
        border: `1px solid ${C.border}`,
        ...style,
      }}
    >
      {showCatalog ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.ink, marginBottom: 4 }}>
            Meeting types this business offers
          </div>
          <div style={{ fontSize: 11.5, color: C.slate, marginBottom: 8 }}>
            What Schedule and the agent can book. Separate from call rules below.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {types.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() =>
                  patch({
                    meeting_types: types.map((x) =>
                      x.id === t.id ? { ...x, enabled: !x.enabled } : x
                    ),
                  })
                }
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: t.enabled ? "2px solid #10B981" : `1px solid ${C.border}`,
                  background: t.enabled ? "#ECFDF5" : "#fff",
                  color: t.enabled ? "#059669" : C.slate,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                {t.enabled ? "On · " : "Off · "}
                {t.label || t.id}
                <div style={{ fontSize: 10, fontWeight: 500, opacity: 0.8 }}>{t.hint || t.id}</div>
              </button>
            ))}
          </div>

          <div style={{ fontSize: 12, fontWeight: 800, color: C.ink, marginBottom: 8 }}>
            Notify channels (not meeting types)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {notify.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() =>
                  patch({
                    notify_channels: notify.map((x) =>
                      x.id === n.id ? { ...x, enabled: !x.enabled } : x
                    ),
                  })
                }
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: n.enabled ? "2px solid #3457D5" : `1px solid ${C.border}`,
                  background: n.enabled ? "#EAEEFC" : "#fff",
                  color: n.enabled ? "#26409E" : C.slate,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {n.enabled ? "On · " : "Off · "}
                {n.label || n.id}
              </button>
            ))}
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, display: "block", marginBottom: 4 }}>
              Default meeting type
            </label>
            <select
              value={bp.default_meeting_type || types.find((t) => t.enabled)?.id || "video"}
              onChange={(e) => patch({ default_meeting_type: e.target.value })}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              {types
                .filter((t) => t.enabled !== false)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label || t.id}
                  </option>
                ))}
            </select>
          </div>
        </>
      ) : null}

      <div style={{ fontSize: 12, fontWeight: 800, color: C.ink, marginBottom: 4 }}>
        Built-in call rules
      </div>
      <div style={{ fontSize: 11.5, color: C.slate, marginBottom: 8 }}>
        Hard steps the agent must follow when booking on a call.
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {RULE_KEYS.map(([key, label]) => (
          <div
            key={key}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              fontSize: 12.5,
              color: C.ink,
            }}
          >
            <input
              type="checkbox"
              checked={bp[key] !== false}
              onChange={(e) => patch({ [key]: e.target.checked })}
              style={{ marginTop: 2, flexShrink: 0, cursor: "pointer" }}
              aria-label={label}
            />
            <span style={{ lineHeight: 1.35, userSelect: "none" }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.ink }}>Hang-up wording (this business)</div>
        <div style={{ fontSize: 11.5, color: C.slate, marginTop: -4 }}>
          Agent uses these lines before cutting. Each business can phrase differently — no code change needed.
        </div>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, display: "grid", gap: 4 }}>
          Confirm before hang-up
          <input
            type="text"
            value={bp.hangup_confirm_prompt ?? "Anything else before I hang up?"}
            onChange={(e) => patch({ hangup_confirm_prompt: e.target.value })}
            placeholder="Anything else before I hang up?"
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              fontSize: 12.5,
              fontFamily: "inherit",
              background: "#fff",
            }}
          />
        </label>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, display: "grid", gap: 4 }}>
          Goodbye before cut
          <input
            type="text"
            value={bp.hangup_goodbye ?? "Thanks for your time — goodbye!"}
            onChange={(e) => patch({ hangup_goodbye: e.target.value })}
            placeholder="Thanks for your time — goodbye!"
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              fontSize: 12.5,
              fontFamily: "inherit",
              background: "#fff",
            }}
          />
        </label>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.slate, display: "grid", gap: 4, maxWidth: 160 }}>
          Seconds after goodbye before cut
          <input
            type="number"
            min={2}
            max={15}
            value={bp.hangup_delay_seconds ?? 4}
            onChange={(e) => patch({ hangup_delay_seconds: Math.max(2, Math.min(15, parseInt(e.target.value, 10) || 4)) })}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              fontSize: 12.5,
              fontFamily: "inherit",
              background: "#fff",
            }}
          />
        </label>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ fontSize: 12, fontWeight: 800, color: C.ink, display: "block", marginBottom: 4 }}>
          Extra call rules (free text)
        </label>
        <div style={{ fontSize: 11.5, color: C.slate, marginBottom: 6 }}>
          Your own instructions for the voice agent on booking calls. Saved and injected into the prompt.
          Add anything the checkboxes do not cover.
        </div>
        <textarea
          value={bp.extra_agent_rules || ""}
          onChange={(e) => patch({ extra_agent_rules: e.target.value })}
          rows={6}
          placeholder={
            "Examples:\n• Prefer mornings before 11:00 when they say “soon”\n• Never book Fridays after 15:00\n• If they mention procurement, ask for stakeholder email too"
          }
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            borderRadius: 10,
            border: `1px solid ${C.border}`,
            fontSize: 12.5,
            fontFamily: "inherit",
            lineHeight: 1.45,
            resize: "vertical",
            background: "#fff",
            color: C.ink,
          }}
        />
      </div>
    </div>
  );
}
