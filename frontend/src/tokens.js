export const C = {
  ink: "#12141C",
  inkSoft: "#1B1E29",
  inkLine: "#2A2D3A",
  paper: "#F6F5F2",
  bg: "#F6F5F2",
  paperCard: "#FFFFFF",
  paperSoft: "#EFEDE8",
  border: "#E4E1D9",
  borderLight: "#ECEAE4",
  borderHover: "#3457D5",
  
  cobalt: "#3457D5",
  cobaltSoft: "#EAEEFC",
  cobaltDeep: "#26409E",
  
  teal: "#0C8C7D",
  tealSoft: "#E4F5F2",
  
  amber: "#B8760A",
  amberSoft: "#FCEFDA",
  
  red: "#C2410C",
  redSolid: "#DC2626",
  redSoft: "#FBEAE8",
  
  green: "#15803D",
  greenSoft: "#E7F5EB",
  
  slate: "#6B7280",
  slateLight: "#9CA3AF",
  textInk: "#1B1D24",
  
  // Gradients & Accents for clean modern polish
  gradientPrimary: "linear-gradient(135deg, #3457D5 0%, #26409E 100%)",
  gradientTeal: "linear-gradient(135deg, #0C8C7D 0%, #15803D 100%)",
  shadowCard: "0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)",
  shadowCardHover: "0 4px 12px rgba(0,0,0,0.08)",
};

export const FONT_DISPLAY = "'Space Grotesk', sans-serif";
export const FONT_BODY = "'Inter', sans-serif";
export const FONT_MONO = "'JetBrains Mono', monospace";
export const HUB_PAPER = "#fcfbf8";

export const STATUS_MAP = {
  active: { label: "Active", fg: "#3457D5", bg: "#EAEEFC" },
  completed: { label: "Completed", fg: "#15803D", bg: "#E7F5EB" },
  paused: { label: "Paused", fg: "#6B7280", bg: "#EFEDE8" },
  needs_attention: { label: "Needs attention", fg: "#B8760A", bg: "#FCEFDA" },
  calling: { label: "Calling", fg: "#3457D5", bg: "#EAEEFC" },
  dialing: { label: "Dialing", fg: "#3457D5", bg: "#EAEEFC" },
  engaged: { label: "Live Call", fg: "#3457D5", bg: "#EAEEFC" },
  queued: { label: "Queued", fg: "#6B7280", bg: "#EFEDE8" },
  retry: { label: "Callback set", fg: "#B8760A", bg: "#FCEFDA" },
  meeting_booked: { label: "Meeting booked", fg: "#0C8C7D", bg: "#E4F5F2" },
  callback_requested: { label: "Callback requested", fg: "#B8760A", bg: "#FCEFDA" },
  human_review: { label: "Needs human review", fg: "#B8760A", bg: "#FCEFDA" },
  rejected: { label: "Do not call", fg: "#C2410C", bg: "#FBEAE8" },
  do_not_call: { label: "Do not call", fg: "#C2410C", bg: "#FBEAE8" },
  contacted: { label: "Contacted", fg: "#6B7280", bg: "#EFEDE8" },
  cold: { label: "Not contacted", fg: "#6B7280", bg: "#EFEDE8" },
  interested: { label: "Interested", fg: "#0C8C7D", bg: "#E4F5F2" },
  converted: { label: "Converted", fg: "#15803D", bg: "#E7F5EB" },
  upcoming: { label: "Upcoming", fg: "#3457D5", bg: "#EAEEFC" },
};

export function initialsFromName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function operatorFromLogin(username) {
  const u = String(username || "").trim();
  if (/^jitendra/i.test(u)) return { username: u, name: "Jitendra S.", role: "Admin" };
  const pretty = u.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { username: u, name: pretty || "Operator", role: "Operator" };
}

export const TIMEZONES = [
  { id: "Europe/London", label: "UK — London (GMT/BST)" },
  { id: "America/New_York", label: "US — Eastern (EST/EDT)" },
  { id: "America/Chicago", label: "US — Central (CST/CDT)" },
  { id: "America/Denver", label: "US — Mountain (MST/MDT)" },
  { id: "America/Los_Angeles", label: "US — Pacific (PST/PDT)" },
  { id: "Europe/Paris", label: "Europe — Central (CET/CEST)" },
  { id: "Asia/Dubai", label: "UAE — Gulf (GST)" },
  { id: "Asia/Kolkata", label: "India — IST" },
  { id: "Asia/Singapore", label: "Singapore / HK (SGT/HKT)" },
  { id: "Australia/Sydney", label: "Australia — Sydney (AEST/AEDT)" },
];

export function timezoneLabel(tzId) {
  const found = TIMEZONES.find((t) => t.id === tzId);
  return found ? found.label : tzId || "UK — London (GMT/BST)";
}
