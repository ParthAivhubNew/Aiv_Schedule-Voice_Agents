import React from "react";
import { FONT_BODY } from "../tokens";

export const FSB_WEBSITE_URL = "https://account.fsb.org.uk/";

// Identifies if the signed-in operator belongs to the dedicated FSB account
export function isFsbAccount(operator) {
  if (!operator) return false;
  const u = String(operator.username || "").toLowerCase().trim();
  const e = String(operator.email || "").toLowerCase().trim();
  return u === "fsboutreach" || e === "fsboutreach@fsb.org.uk" || e === "fsboutreach";
}

// Crisp inline FSB Logo mark
export function FsbLogo({ size = 32 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="FSB Logo"
      style={{ flexShrink: 0, borderRadius: 6 }}
    >
      <rect width="36" height="36" rx="6" fill="#006972" />
      <path
        d="M6 25C13 19 23 20 30 25C26 21 16 20 6 25Z"
        fill="#00D2C4"
        opacity="0.9"
      />
      <text
        x="18"
        y="21"
        fill="#FFFFFF"
        fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        fontSize="14"
        fontWeight="800"
        letterSpacing="-0.5px"
        textAnchor="middle"
      >
        fsb
      </text>
    </svg>
  );
}

// Shows under the credits area in the sidebar only for FSB accounts, linking to their business website
export function SidebarAccountBadge({ operator, collapsed = false }) {
  if (!isFsbAccount(operator)) return null;

  if (collapsed) {
    return (
      <a
        href={FSB_WEBSITE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="sb-fsb-badge sb-fsb-badge--collapsed"
        title="Federation of Small Businesses (opens in new tab)"
        aria-label="Federation of Small Businesses website (opens in new tab)"
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "8px 0",
          textDecoration: "none",
        }}
      >
        <FsbLogo size={28} />
      </a>
    );
  }

  return (
    <a
      href={FSB_WEBSITE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="sb-fsb-badge"
      title="Open Federation of Small Businesses website (opens in new tab)"
      aria-label="Federation of Small Businesses website (opens in new tab)"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        marginTop: 6,
        marginBottom: 4,
        background: "rgba(0, 105, 114, 0.14)",
        border: "1px solid rgba(0, 210, 196, 0.28)",
        borderRadius: 8,
        fontFamily: FONT_BODY,
        textDecoration: "none",
        cursor: "pointer",
        transition: "background 0.15s ease, border-color 0.15s ease",
      }}
    >
      <FsbLogo size={32} />
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden", flex: 1 }}>
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            color: "var(--ui-side-text, #F0F4F8)",
            lineHeight: 1.25,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            letterSpacing: "-0.01em",
          }}
        >
          Federation of Small Businesses
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: "var(--ui-side-muted, #9BA3B4)",
            lineHeight: 1.3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          FSB Account
        </span>
      </div>
    </a>
  );
}
