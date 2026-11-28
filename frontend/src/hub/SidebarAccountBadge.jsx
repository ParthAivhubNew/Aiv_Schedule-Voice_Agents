import React from "react";
import { C, FONT_BODY } from "../tokens";
import { AdminCrown } from "../components/AdminCrown";
import { useBrand } from "../brand/BrandContext";

const isFsbBrand = (brand) => /federation of small business/i.test(String(brand?.name || "")) || /^fsb$/i.test(String(brand?.shortName || ""));

// The FSB mark as a 5:2 vector rectangle on a fixed 100 x 40 grid: sharp at any size.
export const FSB_LOGO_RATIO = 2.5;
export function FsbLogo({ width = 120, height, radius = 8, accent }) {
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
      <rect width="100" height="40" rx={Math.max(1, Math.round((radius * 100) / width))} fill={accent || "#006972"} />
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

// The brand's own mark: its logo when it has one, else its short name on a tile in the brand's colour.
export function BrandMark({ brand, size = 32 }) {
  if (brand.logoUrl) return <img src={brand.logoUrl} alt="" width={size} height={size} style={{ flexShrink: 0, borderRadius: 6, objectFit: "contain" }} />;
  const text = String(brand.shortName || brand.name || "").slice(0, 4).toLowerCase();
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`${brand.name} logo`}
      style={{ flexShrink: 0, borderRadius: 6 }}>
      <rect width="36" height="36" rx="6" fill={brand.accent || "#006972"} />
      <text x="18" y="21" fill={C.onAccent} fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" fontSize={text.length > 3 ? 11 : 14}
        fontWeight="800" letterSpacing="-0.5px" textAnchor="middle">{text}</text>
    </svg>
  );
}

// Under the credits in the sidebar, for an account whose brand has its own account link (a brand setting: theme.accountLink), e.g.
// FSB members' link to their FSB account. Nothing for anyone else. Which accounts see it is the brand's choice, never a list of usernames.
export function SidebarAccountBadge({ operator, collapsed = false, brand: given = null }) {
  const fromContext = useBrand();
  const brand = given || fromContext;
  const link = brand && brand.active ? brand.accountLink : null;
  if (!link) return null;
  const label = link.label || brand.name;
  const fsb = isFsbBrand(brand) && !brand.logoUrl;
  const common = { href: link.url, target: "_blank", rel: "noopener noreferrer", "aria-label": `${label} website (opens in new tab)` };

  if (collapsed) {
    return (
      <a {...common} className="sb-fsb-badge sb-fsb-badge--collapsed" title={`${label} (opens in new tab)`}
        style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "8px 0", textDecoration: "none" }}>
        {fsb ? <FsbLogo width={50} height={20} radius={4} accent={brand.accent} /> : <BrandMark brand={brand} size={28} />}
      </a>
    );
  }
  if (fsb) {
    return (
      <a {...common} className="sb-fsb-badge" title={`Open ${label} (opens in new tab)`}
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "10px 10px", marginTop: 6, marginBottom: 4,
          background: "rgba(0, 105, 114, 0.14)", border: "1px solid rgba(0, 210, 196, 0.28)", borderRadius: 8, fontFamily: FONT_BODY,
          textDecoration: "none", cursor: "pointer", transition: "background 0.15s ease, border-color 0.15s ease" }}>
        <FsbLogo width={120} height={48} radius={8} accent={brand.accent} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0, width: "100%", overflow: "hidden" }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ui-side-text, #F0F4F8)", lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden",
            textOverflow: "ellipsis", maxWidth: "100%", letterSpacing: "-0.01em" }}>{label}</span>
          <span style={{ fontSize: 10, fontWeight: 500, color: "var(--ui-side-muted, #9BA3B4)", lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {brand.shortName ? `${brand.shortName} account` : "Your account"}<AdminCrown operator={operator} size={11} />
          </span>
        </div>
      </a>
    );
  }
  return (
    <a {...common} className="sb-fsb-badge" title={`Open ${label} (opens in new tab)`}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", marginTop: 6, marginBottom: 4, background: "rgba(0, 105, 114, 0.14)",
        border: "1px solid rgba(0, 210, 196, 0.28)", borderRadius: 8, fontFamily: FONT_BODY, textDecoration: "none", cursor: "pointer",
        transition: "background 0.15s ease, border-color 0.15s ease" }}>
      <BrandMark brand={brand} size={32} />
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden", flex: 1 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ui-side-text, #F0F4F8)", lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden",
          textOverflow: "ellipsis", letterSpacing: "-0.01em" }}>{label}</span>
        <span style={{ fontSize: 10, fontWeight: 500, color: "var(--ui-side-muted, #9BA3B4)", lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {brand.shortName ? `${brand.shortName} account` : "Your account"}<AdminCrown operator={operator} size={11} />
        </span>
      </div>
    </a>
  );
}
