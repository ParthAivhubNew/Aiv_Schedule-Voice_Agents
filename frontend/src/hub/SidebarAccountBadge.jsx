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

// The FSB mark as a rectangle, drawn as vector shapes and live text on a fixed 100 x 40 grid: it is sharp at any size (no image to stretch or blur).
// Give it a width and height in the same 5:2 shape. Whole-pixel sizes (120 x 48, 50 x 20) keep the edges on the pixel grid.
export const FSB_LOGO_RATIO = 2.5;
export function FsbLogo({ width = 120, height, radius = 8 }) {
  const h = height || Math.round(width / FSB_LOGO_RATIO);
  return (
    <svg
      width={width}
      height={h}
      viewBox="0 0 100 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="FSB Logo"
      shapeRendering="geometricPrecision"
      style={{ flexShrink: 0, borderRadius: radius, display: "block" }}
    >
      <rect width="100" height="40" rx={Math.max(1, Math.round((radius * 100) / width))} fill="#006972" />
      <path d="M10 31C30 22 70 22 90 31C74 26 26 26 10 31Z" fill="#00D2C4" opacity="0.9" />
      <text
        x="50"
        y="24"
        fill="#FFFFFF"
        fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        fontSize="22"
        fontWeight="800"
        letterSpacing="-0.6"
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
        <FsbLogo width={50} height={20} radius={4} />
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
      style={{ display: "inline-flex", alignSelf: "center", margin: "6px 0 4px", textDecoration: "none", borderRadius: 8 }}
    >
      <FsbLogo width={120} height={48} radius={8} />
    </a>
  );
}
