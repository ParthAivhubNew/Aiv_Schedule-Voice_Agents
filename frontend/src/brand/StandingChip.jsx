import React from "react";
import { ShieldCheck } from "lucide-react";
import { C } from "../tokens";
import { useBrand } from "./BrandContext";

export const STANDING_TIP = "Your account leaves out some companies from every search. An administrator set this, and it cannot be switched off here.";

// A quiet reminder in Find Leads that standing exclusions are on. Display only.
export function StandingChip() {
  const { standingExclusions } = useBrand();
  if (!standingExclusions) return null;
  return (
    <span className="standing-chip" title={STANDING_TIP} aria-label={`Standing exclusions on. ${STANDING_TIP}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", borderRadius: 999, border: `1px solid ${C.border}`, background: "#F3F4F6", color: C.slate, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>
      <ShieldCheck size={13} aria-hidden="true" /> Standing exclusions on
    </span>
  );
}
