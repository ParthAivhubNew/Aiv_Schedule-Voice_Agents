import { C } from "../../tokens";
// The Connectors screen's pure helpers. Every connector, status and count comes from the server (GET /leadgen/connectors); nothing here
// decides that something is connected.

export const STATUS_TONE = {
  connected: "good",
  paused: "warn",
  stale: "warn",
  error: "bad",
  no_credit: "bad",
  off: "muted",
  not_in_plan: "muted",
  not_connected: "muted",
  coming_soon: "soon",
};

export const TONE_COLOURS = {
  good: { bg: C.successSoft, ink: C.successInk, border: C.pillGoodLine },
  warn: { bg: C.warningSoft, ink: C.warningInk, border: C.pillWarnLine },
  bad: { bg: C.pillBadBg, ink: C.pillBadInk, border: C.pillBadLine },
  muted: { bg: C.neutralSoft, ink: C.neutralInk, border: C.border },
  soon: { bg: C.pillSoonBg, ink: C.pillSoonInk, border: C.pillSoonLine },
};

export const toneOf = (status) => STATUS_TONE[status] || "muted";

const num = (n) => Number(n).toLocaleString("en-GB");

// "71,797 records · 12 of your companies · 40 look-ups in 30 days", from the counts the server sent. Only counts it knows.
export function countLine(c) {
  const parts = [];
  if (typeof c.records === "number") parts.push(`${num(c.records)} record${c.records === 1 ? "" : "s"}`);
  if (typeof c.leads === "number" && c.leads > 0) parts.push(`${num(c.leads)} of your compan${c.leads === 1 ? "y" : "ies"}`);
  if (typeof c.uses30d === "number" && c.uses30d > 0) parts.push(`${num(c.uses30d)} look-up${c.uses30d === 1 ? "" : "s"} in 30 days`);
  return parts.join(" · ");
}

export function kindLabels(c, kinds) {
  const names = Object.fromEntries((kinds || []).map((k) => [k.id, k.label]));
  return (c.provides || []).map((k) => names[k] || k);
}

// The connectors a filter leaves: a group ("all" for every group), a kind of data ("all" for any) and words in the name or description.
export function filterConnectors(list, { group = "all", kind = "all", query = "" } = {}) {
  const q = String(query || "").trim().toLowerCase();
  return (list || []).filter((c) =>
    (group === "all" || c.group === group) &&
    (kind === "all" || (c.provides || []).includes(kind)) &&
    (!q || `${c.name} ${c.desc || ""}`.toLowerCase().includes(q)));
}

// The connectors under each group, in the server's group order, leaving out empty groups.
export function byGroup(list, groups) {
  return (groups || []).map((g) => ({ ...g, items: (list || []).filter((c) => c.group === g.id) })).filter((g) => g.items.length);
}

// The figures over the header: what works, what needs a look, what isn't built yet.
export function summary(list) {
  const out = { connected: 0, attention: 0, soon: 0, other: 0 };
  (list || []).forEach((c) => {
    if (c.status === "connected") out.connected += 1;
    else if (["paused", "stale", "error", "no_credit"].includes(c.status)) out.attention += 1;
    else if (c.status === "coming_soon") out.soon += 1;
    else out.other += 1;
  });
  return out;
}

// "Updated 3 Nov 2026" from an ISO date the server sent; "" when there is none.
export function shortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
