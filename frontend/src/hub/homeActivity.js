// What Home says is happening, from GET /together/today (plan 13, 3.3). Only numbers the server sent appear: it leaves out the apps
// the company doesn't have, so nothing here is made up or a placeholder.
const n = (v) => Number(v || 0).toLocaleString();
const say = (v, one, many) => `${Number(v) === 1 ? one : many}`;

const ITEMS = [
  // [key in the reply, app, link key, one, many]
  ["replies_waiting", "leadgen", "replies", "reply waiting", "replies waiting"],
  ["approvals_waiting", "leadgen", "approvals", "email to approve", "emails to approve"],
  ["posts_to_approve", "scheduler", "posts_to_approve", "post to approve", "posts to approve"],
  ["meetings_this_week", "voice", "meetings", "meeting this week", "meetings this week"],
  ["calls_7d", "voice", "calls", "call in the last 7 days", "calls in the last 7 days"],
  ["posts_scheduled", "scheduler", "posts_scheduled", "post lined up", "posts lined up"],
];
const WAITING = new Set(["replies_waiting", "approvals_waiting", "posts_to_approve"]); // these need a person

export function homeActivity(today) {
  const items = [];
  if (today) {
    for (const [key, app, link, one, many] of ITEMS) {
      if (today[key] == null) continue;
      items.push({ key, app, value: n(today[key]), count: Number(today[key]) || 0, label: say(today[key], one, many), href: (today.links || {})[link] || "", waiting: WAITING.has(key) });
    }
    const late = Number(today.tasks_overdue || 0);
    if (today.tasks_overdue != null || today.tasks_today != null) {
      const due = late + Number(today.tasks_today || 0);
      items.push({ key: "tasks", app: "leadgen", value: n(due), count: due, label: late ? `${say(due, "task", "tasks")} due, ${n(late)} late` : say(due, "task due today", "tasks due today"), href: (today.links || {}).tasks || "", waiting: true });
    }
  }
  const byApp = {};
  for (const it of items) (byApp[it.app] = byApp[it.app] || []).push(it);
  // The strip across the top: what needs someone first, then what happened, then the zeros; four at most.
  const rank = (it) => (it.waiting && it.count > 0 ? 2 : it.count > 0 ? 1 : 0);
  const tiles = [...items].sort((a, b) => rank(b) - rank(a)).slice(0, 4);
  const waiting = items.filter((it) => it.waiting).reduce((sum, it) => sum + it.count, 0);
  return { tiles, byApp, waiting };
}

// The line under the greeting.
export function homeSummary(activity, hasApps) {
  if (!activity.tiles.length) return hasApps ? "Open an app to pick up where you left off." : "Pick an app to get started.";
  if (!activity.waiting) return "You're all caught up. Nothing is waiting for you.";
  return `${activity.waiting.toLocaleString()} ${activity.waiting === 1 ? "thing needs" : "things need"} you today.`;
}
