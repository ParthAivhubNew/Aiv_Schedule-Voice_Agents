import { Ban, Bell, CalendarCheck, CalendarDays, Coins, Database, KeyRound, ListChecks, Phone, PhoneCall, Repeat, Rocket, Search, Shield, ShieldCheck, Smartphone, User, UserCog, Users, Workflow } from "lucide-react";

// The one Settings page for the whole company (plan 13, step 4): everything that used to open from the profile menu, the
// Users, roles, numbers & credits window and the Connections window, under one left list. Each app's own setup pages stay in
// that app's Settings menu (step 3); the Apps group here just takes you there.
//
// open: what draws the section. profile:<tab> = your profile, team:<tab> = the Users window's tab, links:<tab> = Connections,
// keys = API keys & webhooks, checklist = the first steps, calendar = the Calendar & meetings window, install = install steps, go:<route> = another page.
export function settingsGroups(operator, { installable = false } = {}) {
  const o = operator || {};
  const perms = o.permissions || {};
  const owner = Boolean(o.is_admin);
  const admin = owner || o.role === "Admin";
  const team = owner || (admin && perms.team && perms.team !== "none");
  const groups = [
    { label: "Your account", items: [
      { id: "profile", label: "Profile", icon: User, title: "Your photo, name and job title", open: "profile:profile" },
      { id: "contact", label: "Contact & preferences", icon: UserCog, title: "Email, phone, time zone, language and signature", open: "profile:contact" },
      { id: "notifications", label: "Notifications", icon: Bell, title: "Which emails you get from Outreach", open: "profile:notifications" },
      { id: "security", label: "Sign-in & security", icon: ShieldCheck, title: "Password, where you're signed in and sign-out times", open: "profile:security" },
      installable ? { id: "install", label: "Install the app", icon: Smartphone, title: "Add Outreach to your home screen", open: "install" } : null,
    ] },
    { label: "People", items: team ? [
      { id: "users", label: "Users", icon: Users, title: "Who can sign in", open: "team:users" },
      { id: "roles", label: "Roles", icon: Shield, title: "What each role can see or change", open: "team:roles" },
    ] : [] },
    { label: "Company", items: [
      owner ? { id: "getting-started", label: "Getting started", icon: Rocket, title: "The first steps for your company, and which are done", open: "checklist" } : null,
      owner ? { id: "rules", label: "Company rules", icon: ListChecks, title: "The rules every app follows for your company", open: "team:rules" } : null,
      team ? { id: "numbers", label: "Phone numbers", icon: Phone, title: "Your company's phone numbers", open: "team:numbers" } : null,
      owner ? { id: "credits", label: "Plans & credits", icon: Coins, title: "Every app's plan, credits and who used them", open: "team:credits" }
        : { id: "usage", label: "Your credit use", icon: Coins, title: "The credits you have used", open: "team:myusage" },
    ] },
    { label: "Working together", items: [
      { id: "follow-ups", label: "Follow-ups", icon: Repeat, title: "What happens by itself after calls, meetings and replies", open: "links:follow" },
      { id: "your-rules", label: "Automations", icon: Workflow, title: "“When this happens, do that”", open: "links:rules" },
      { id: "do-not-contact", label: "Do not contact", icon: Ban, title: "People every app must leave alone", open: "links:block" },
      { id: "data", label: "Data", icon: Database, title: "Duplicates, export and older calls", open: "links:data" },
      admin ? { id: "calendar", label: "Calendar & meetings", icon: CalendarCheck, title: "Invite emails, booking pages and calendar sync", open: "calendar" } : null,
    ] },
    { label: "Developers", items: admin ? [
      { id: "api", label: "API keys & webhooks", icon: KeyRound, title: "Connect your own systems to Outreach", open: "keys" },
    ] : [] },
    { label: "Apps", items: [
      { id: "leads", label: "Leads settings", icon: Search, title: "Data sources, email accounts, your business and workflows", open: "go:#/leadgen/connectors" },
      { id: "voice", label: "Voice settings", icon: PhoneCall, title: "Business setup, working hours, call scripts and the AI caller", open: "go:#/voice/company" },
      { id: "social", label: "Social settings", icon: CalendarDays, title: "Connected accounts and the look of your posts", open: "go:#/scheduler/accounts" },
    ] },
  ];
  return groups.map((g) => ({ ...g, items: g.items.filter(Boolean) })).filter((g) => g.items.length);
}

// The section the address names (/settings/users), or the first one this person can open.
export function settingsSection(groups, hash) {
  const id = String(hash || "").replace(/^#?\/?settings\/?/, "").split("/")[0];
  const all = groups.flatMap((g) => g.items);
  return all.find((it) => it.id === id && !it.open.startsWith("go:") && it.open !== "calendar") || all[0];
}

// Where the old doors now lead: the Users window's tabs and the Connections window's tabs, by their old names.
const TEAM_TAB = { users: "users", roles: "roles", numbers: "numbers", rules: "rules", credits: "credits", myusage: "usage" };
const LINKS_TAB = { follow: "follow-ups", rules: "your-rules", block: "do-not-contact", data: "data" };
export const settingsHashForTeam = (tab) => `#/settings/${TEAM_TAB[tab] || "users"}`;
export const settingsHashForConnections = (tab) => `#/settings/${LINKS_TAB[tab] || "follow-ups"}`;
