import React from "react";
import { useBrand } from "./BrandContext";

// Small print under a branded sidebar or sign-in page. Nothing at all for the ordinary Outreach look.
export function PoweredBy({ dark = false, align = "left", style }) {
  const { active, poweredBy } = useBrand();
  if (!active || !poweredBy) return null;
  return (
    <div className="powered-by" style={{ fontSize: 11, lineHeight: 1.4, textAlign: align, color: dark ? "var(--ui-side-muted, #9BA3B4)" : "#6B7280", ...style }}>
      Powered by Outreach
    </div>
  );
}
