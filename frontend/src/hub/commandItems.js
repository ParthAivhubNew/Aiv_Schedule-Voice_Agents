import { settingsGroups } from "./settingsPages";

// What ⌘K can open without asking the server (plan 13, step 7): every page of every app, and every Settings section this person
// may open. Companies, people, calls, meetings and posts come from the server as you type (GET /together/search).
// item: { id, label, group, hint, go } where go is an address ("#/voice/logs") or an action name ("workflows", "support", "help").
const APP_PAGES = [
  ["Leads", [
    ["find_leads", "Find Leads", "Search every company on the register"],
    ["lists", "Lists", "Your saved companies and lists"],
    ["outreach", "Journeys", "Email journeys and follow-up steps"],
    ["mail", "Mail", "Your inbox and replies"],
    ["inbound_forms", "Forms", "Web forms that bring in leads"],
    ["import_match", "Import & match", "Match a spreadsheet to the register"],
    ["connectors", "Data sources", "Leads settings: where company details come from"],
    ["mailboxes", "Email accounts", "Leads settings: the mailboxes you send from"],
    ["business", "Company profile", "Leads settings: what the AI may say about you, and your ideal customer"],
    ["subscription", "Leads plan & credits", "Leads settings: plan, credits and top-ups"],
  ].map(([id, label, hint]) => ({ id: `leadgen:${id}`, label, hint, go: `#/leadgen/${id}` }))],
  ["Voice", [
    ["list", "Call list", "Make calls: one number or a whole list"],
    ["logs", "Conversations", "Past calls and their summaries"],
    ["schedule", "Meetings & callbacks", "Meetings booked and calls to try again"],
    ["analytics", "Call stats", "Calls made, answered and turned into meetings"],
    ["company", "Company profile", "Voice settings: company details and working hours"],
    ["templates", "AI caller", "Voice settings: call scripts and how the caller sounds"],
    ["subscription", "Voice plan & credits", "Voice settings: plan, minutes and top-ups"],
  ].map(([id, label, hint]) => ({ id: `voice:${id}`, label, hint, go: `#/voice/${id}` }))],
  ["Social", [
    ["plan", "Post calendar", "Plan posts with the AI and see what goes out"],
    ["insights", "Post results", "How your posts did"],
    ["audience", "Audience & ideas", "Who you're talking to and what to post"],
    ["listening", "Mentions", "Where your business is mentioned"],
    ["library", "Library", "Posts and templates you keep"],
    ["media", "Pictures & videos", "Your images and videos"],
    ["accounts", "Social accounts", "Social settings: the accounts your posts go to"],
    ["theme", "Brand look", "Social settings: logo, colours and what you do"],
    ["subscription", "Social plan & credits", "Social settings: plan, credits and top-ups"],
  ].map(([id, label, hint]) => ({ id: `scheduler:${id}`, label, hint, go: `#/scheduler/${id}` }))],
];

const EXTRAS = [
  { id: "home", label: "Home", hint: "Your apps and what needs you today", go: "#/" },
  { id: "workflows", label: "Workflows", hint: "Do things automatically across your apps", go: "workflows" },
  { id: "help", label: "Help & guides", hint: "How Outreach works, step by step", go: "help" },
  { id: "support", label: "Contact support", hint: "Report an issue or ask a question", go: "support" },
];

export function commandItems(operator, { installable = false } = {}) {
  const out = EXTRAS.map((it) => ({ ...it, group: "Go to" }));
  for (const [app, pages] of APP_PAGES) out.push(...pages.map((p) => ({ ...p, group: app })));
  for (const g of settingsGroups(operator, { installable })) {
    for (const it of g.items) {
      if (it.open === "calendar") out.push({ id: `settings:${it.id}`, label: it.label, hint: it.title, group: "Settings", go: "calendar" });
      else if (it.open.startsWith("go:")) continue; // the Apps rows: their pages are listed above
      else out.push({ id: `settings:${it.id}`, label: it.label, hint: it.title, group: "Settings", go: `#/settings/${it.id}` });
    }
  }
  return out;
}

// Every word typed must appear in the name, the line under it or the group; a name that starts with what was typed comes first.
export function matchCommands(items, query, limit = 8) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return items.filter((it) => it.group === "Go to" || ["leadgen:find_leads", "leadgen:lists", "voice:list", "scheduler:plan", "settings:profile", "settings:users"].includes(it.id)).slice(0, limit);
  const words = q.split(/\s+/);
  const scored = [];
  for (const it of items) {
    const label = it.label.toLowerCase();
    const hay = `${label} ${String(it.hint || "").toLowerCase()} ${it.group.toLowerCase()}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const score = label.startsWith(q) ? 0 : label.includes(q) ? 1 : label.split(/\s+/).some((w) => w.startsWith(words[0])) ? 2 : 3;
    scored.push([score, it]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, it]) => it);
}
