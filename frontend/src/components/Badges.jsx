import React from "react";
import { C, FONT_BODY, FONT_MONO, STATUS_MAP } from "../tokens";

export function BrandMark({ size = 36 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: C.gradientPrimary,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontWeight: 700,
        fontSize: Math.round(size * 0.44),
        letterSpacing: "-0.04em",
        boxShadow: C.glowPrimary,
        position: "relative",
      }}
    >
      <span style={{ position: "relative", zIndex: 1 }}>A</span>
    </div>
  );
}

export function Badge({ status, small }) {
  const m = STATUS_MAP[status] || { label: status, fg: C.slate, bg: C.paperSoft };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: small ? "2px 8px" : "4px 11px",
        borderRadius: 999,
        background: m.bg,
        color: m.fg,
        fontFamily: FONT_BODY,
        fontSize: small ? 11 : 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
        border: `1px solid ${m.fg}22`,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: m.fg,
          boxShadow: `0 0 6px ${m.fg}66`,
        }}
      />
      {m.label}
    </span>
  );
}

export function LivePulse() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2.5, height: 14 }}>
      {[0, 150, 300, 450].map((delay, i) => (
        <span
          key={i}
          style={{
            width: 2.5,
            background: C.gradientPrimary,
            borderRadius: 2,
            display: "inline-block",
            animation: `pulseBar 0.9s ease-in-out infinite`,
            animationDelay: `${delay}ms`,
            boxShadow: "0 0 4px rgba(75,115,255,0.4)",
          }}
        />
      ))}
    </span>
  );
}

export function FitScore({ value }) {
  const color = value >= 85 ? C.teal : value >= 70 ? C.cobalt : C.amber;
  return (
    <span
      style={{
        fontFamily: FONT_MONO,
        fontSize: 11.5,
        fontWeight: 700,
        color,
        background: `${color}14`,
        padding: "2px 8px",
        borderRadius: 6,
        border: `1px solid ${color}33`,
      }}
    >
      {value}%
    </span>
  );
}
