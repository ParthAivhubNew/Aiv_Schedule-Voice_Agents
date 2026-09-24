import React from "react";
import { C, FONT_BODY, FONT_MONO, STATUS_MAP } from "../tokens";

export function BrandMark({ size = 36 }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      style={{
        display: "block",
        flexShrink: 0,
      }}
    >
      <defs>
        <linearGradient id="aiv" x1="4" y1="2" x2="30" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3457D5"/>
          <stop offset="1" stopColor="#0C8C7D"/>
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#aiv)"/>
      <circle cx="11" cy="16" r="2.35" fill="#fff"/>
      <path d="M15.6 11.1c2.7 1.5 2.7 8.3 0 9.8" fill="none" stroke="#fff" strokeWidth="1.85" strokeLinecap="round"/>
      <path d="M19.4 8.4c4.3 2.5 4.3 12.7 0 15.2" fill="none" stroke="#fff" strokeWidth="1.85" strokeLinecap="round"/>
      <path d="M23.1 6.1c5.8 3.3 5.8 16.5 0 19.8" fill="none" stroke="#fff" strokeWidth="1.75" strokeLinecap="round"/>
    </svg>
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
