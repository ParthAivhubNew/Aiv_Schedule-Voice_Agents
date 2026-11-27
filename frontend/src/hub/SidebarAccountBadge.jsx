import React from "react";

export const FSB_WEBSITE_URL = "https://account.fsb.org.uk/";

// Identifies if the signed-in operator belongs to the dedicated FSB account
export function isFsbAccount(operator) {
  if (!operator) return false;
  const u = String(operator.username || "").toLowerCase().trim();
  const e = String(operator.email || "").toLowerCase().trim();
  // fsbadmin and fsbuser are the current demo accounts; fsbdemo and fsboutreach are the older ones.
  return (
    ["fsbadmin", "fsbuser", "fsbdemo", "fsboutreach"].includes(u) ||
    ["fsbadmin@outreach.com", "fsbuser@outreach.com", "fsbdemo@outreach.com", "fsboutreach@fsb.org.uk"].includes(e) ||
    e.startsWith("fsbdemo@")
  );
}

// The brand is the Federation of Small Businesses (by its name), whoever is signed in.
export const isFsbBrandName = (name) => /federation of small business/i.test(String(name || ""));

// Crisp inline FSB Logo mark
export function FsbLogo({ size = 32, radius = 6 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="FSB Logo"
      style={{ flexShrink: 0, borderRadius: radius }}
    >
      <rect width="36" height="36" rx={Math.round((radius * 36) / size)} fill="#006972" />
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
      style={{ display: "inline-flex", alignSelf: "flex-start", margin: "6px 0 4px 4px", textDecoration: "none", borderRadius: 12 }}
    >
      <FsbLogo size={48} radius={12} />
    </a>
  );
}
