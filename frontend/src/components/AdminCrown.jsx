import React from "react";
import { Crown } from "lucide-react";

// Marks an administrator beside their name. The words are in the title and in hidden text, so it is not colour or shape alone.
export function AdminCrown({ operator, size = 14, style }) {
  if (!operator || !operator.is_admin) return null;
  return (
    <span title="Administrator" style={{ display: "inline-flex", alignItems: "center", verticalAlign: "middle", marginLeft: 4, color: "#B45309", ...style }}>
      <Crown size={size} aria-hidden="true" />
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>Admin</span>
    </span>
  );
}
