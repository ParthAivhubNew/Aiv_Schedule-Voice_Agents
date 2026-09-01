export const C = {
  // Radiant Dark Palette (Deep Obsidian & Slate Space)
  bg: "#090B13",
  bgSubtle: "#0F1221",
  ink: "#FFFFFF",
  textInk: "#F8FAFC",
  slate: "#94A3B8",
  slateLight: "#64748B",
  
  // Surfaces & Glass
  paper: "#090B13",
  paperCard: "#121629",
  paperSoft: "#171C33",
  border: "rgba(255, 255, 255, 0.08)",
  borderLight: "rgba(255, 255, 255, 0.04)",
  borderHover: "rgba(75, 115, 255, 0.35)",
  
  // Signature Radiant Neon Accents
  cobalt: "#4B73FF",
  cobaltSoft: "rgba(75, 115, 255, 0.15)",
  cobaltDeep: "#6B8AFF",
  
  radiantPink: "#FF54E2",
  radiantCoral: "#FF334B",
  radiantOrange: "#FF7B1C",
  radiantPurple: "#9353FF",
  
  teal: "#00E5C3",
  tealSoft: "rgba(0, 229, 195, 0.14)",
  
  amber: "#FFB020",
  amberSoft: "rgba(255, 176, 32, 0.14)",
  
  red: "#FF4D4D",
  redSolid: "#FF2E2E",
  redSoft: "rgba(255, 77, 77, 0.14)",
  
  green: "#10B981",
  greenSoft: "rgba(16, 185, 129, 0.14)",
  
  // Signature Radiant Gradients
  gradientPrimary: "linear-gradient(135deg, #4B73FF 0%, #9353FF 50%, #FF54E2 100%)",
  gradientSunset: "linear-gradient(135deg, #FF54E2 0%, #FF334B 50%, #FF7B1C 100%)",
  gradientTeal: "linear-gradient(135deg, #4B73FF 0%, #00E5C3 100%)",
  gradientDarkCard: "linear-gradient(180deg, rgba(22, 27, 49, 0.8) 0%, rgba(15, 19, 36, 0.8) 100%)",
  
  // Radiant Glows & Shadows
  glowPrimary: "0 0 24px rgba(147, 83, 255, 0.45)",
  glowPink: "0 0 24px rgba(255, 84, 226, 0.45)",
  glowTeal: "0 0 24px rgba(0, 229, 195, 0.35)",
  shadowCard: "0 8px 32px rgba(0, 0, 0, 0.36)",
  shadowHover: "0 16px 48px rgba(75, 115, 255, 0.20)",
};

export const FONT_DISPLAY = "'Space Grotesk', -apple-system, sans-serif";
export const FONT_BODY = "'Inter', -apple-system, sans-serif";
export const FONT_MONO = "'JetBrains Mono', monospace";
export const HUB_PAPER = "#090B13";

export function initialsFromName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const TIMEZONES = [
  { id: "Europe/London", label: "UK — London (GMT/BST)" },
  { id: "Europe/Paris", label: "Europe — Paris (CET)" },
  { id: "Europe/Berlin", label: "Europe — Berlin (CET)" },
  { id: "Asia/Kolkata", label: "India — Kolkata (IST)" },
  { id: "Asia/Dubai", label: "UAE — Dubai (GST)" },
  { id: "America/New_York", label: "US — Eastern (ET)" },
  { id: "America/Chicago", label: "US — Central (CT)" },
  { id: "America/Los_Angeles", label: "US — Pacific (PT)" },
  { id: "Australia/Sydney", label: "Australia — Sydney (AEST)" },
];

export function timezoneLabel(id) {
  return (TIMEZONES.find((z) => z.id === id) || TIMEZONES[0]).label;
}

export const STATUS_MAP = {
  active: { label: "Active", fg: C.green, bg: C.greenSoft },
  completed: { label: "Completed", fg: C.slate, bg: C.paperSoft },
  needs_attention: { label: "Needs attention", fg: C.amber, bg: C.amberSoft },
  calling: { label: "Calling now", fg: C.cobalt, bg: C.cobaltSoft },
  meeting_booked: { label: "Meeting booked", fg: C.teal, bg: C.tealSoft },
  contacted: { label: "Contacted", fg: C.slate, bg: C.paperSoft },
  retry: { label: "Retry scheduled", fg: C.amber, bg: C.amberSoft },
  rejected: { label: "Rejected / DNC", fg: C.red, bg: C.redSoft },
  cold: { label: "Cold", fg: C.slateLight, bg: C.paperSoft },
  do_not_call: { label: "Do not call", fg: C.red, bg: C.redSoft },
  interested: { label: "Interested", fg: C.teal, bg: C.tealSoft },
  human_review: { label: "Human review", fg: C.amber, bg: C.amberSoft },
  researching: { label: "Researching", fg: C.cobalt, bg: C.cobaltSoft },
  queued: { label: "Queued", fg: C.slateLight, bg: C.paperSoft },
  upcoming: { label: "Upcoming", fg: C.cobalt, bg: C.cobaltSoft },
  converted: { label: "Converted", fg: C.teal, bg: C.tealSoft },
  needs_outcome: { label: "Needs outcome", fg: C.amber, bg: C.amberSoft },
  not_fit: { label: "Not a fit", fg: C.slate, bg: C.paperSoft },
};
