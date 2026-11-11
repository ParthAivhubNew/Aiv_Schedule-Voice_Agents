// The five tiles at the top of Home. Pure, so the amber rule and the missing-plugin rule are tested.
export const BOUNCE_WARN = 0.015;

const n = (v) => Number(v || 0).toLocaleString();
const plural = (v, one, many) => (Number(v) === 1 ? one : many);

// Returns only the tiles whose number the server sent (it leaves out plugins the company does not have).
export function todayTiles(t) {
  if (!t) return [];
  const out = [];
  if (t.replies_waiting != null) out.push({ key: "replies", label: plural(t.replies_waiting, "reply waiting", "replies waiting"), value: n(t.replies_waiting), href: t.links?.replies, hot: t.replies_waiting > 0 });
  if (t.approvals_waiting != null) out.push({ key: "approvals", label: plural(t.approvals_waiting, "email to approve", "emails to approve"), value: n(t.approvals_waiting), href: t.links?.approvals, hot: t.approvals_waiting > 0 });
  if (t.meetings_this_week != null) out.push({ key: "meetings", label: plural(t.meetings_this_week, "meeting this week", "meetings this week"), value: n(t.meetings_this_week), href: t.links?.meetings });
  if (t.bounce_rate_7d != null) {
    const warn = t.bounce_rate_7d >= BOUNCE_WARN;
    out.push({ key: "bounces", label: "bounced, last 7 days", value: `${(t.bounce_rate_7d * 100).toFixed(1)}%`, href: t.links?.bounces, warn, note: warn ? "Above 2% we pause sending from that mailbox." : "" });
  }
  if (t.credits_left != null) out.push({ key: "credits", label: `credits left (${n(t.credits_used_7d)} used in 7 days)`, value: n(t.credits_left), href: t.links?.credits });
  return out;
}
