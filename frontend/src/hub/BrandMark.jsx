import React, { useId } from "react";

// The Outreach by Aivhub logo.
export function BrandMark({ size = 36 }) {
  // Each logo needs its own gradient id: a shared id breaks when the first copy is hidden.
  const gid = `aiv-${useId().replace(/:/g, "")}`;
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
        <linearGradient id={gid} x1="4" y1="2" x2="30" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3457D5"/>
          <stop offset="1" stopColor="#0C8C7D"/>
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gid})`}/>
      <circle cx="11" cy="16" r="2.35" fill="#fff"/>
      <path d="M15.6 11.1c2.7 1.5 2.7 8.3 0 9.8" fill="none" stroke="#fff" strokeWidth="1.85" strokeLinecap="round"/>
      <path d="M19.4 8.4c4.3 2.5 4.3 12.7 0 15.2" fill="none" stroke="#fff" strokeWidth="1.85" strokeLinecap="round"/>
      <path d="M23.1 6.1c5.8 3.3 5.8 16.5 0 19.8" fill="none" stroke="#fff" strokeWidth="1.75" strokeLinecap="round"/>
    </svg>
  );
}

// The logo with the name stacked beside it: "Outreach", and a small "BY AIVHUB" under it.
// `size` is the logo's; the name scales with it. `dark` is for dark backgrounds.
export function BrandLockup({ size = 34, dark = false }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <BrandMark size={size} />
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, textAlign: "left" }}>
        <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: Math.round(size * 0.53), letterSpacing: "-0.01em", color: dark ? "#FFFFFF" : "#111827" }}>
          Outreach
        </span>
        <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 500, fontSize: 10.5, letterSpacing: "0.12em", color: dark ? "#9BA3B4" : "#6B7280" }}>
          BY AIVHUB
        </span>
      </span>
    </span>
  );
}
