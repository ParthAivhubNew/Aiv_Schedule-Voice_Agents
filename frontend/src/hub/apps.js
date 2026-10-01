import { CalendarDays, Mail, PhoneCall, Search } from "lucide-react";
import { C } from "../tokens";

// The apps of the OutReach suite, in the order work flows through them: find who to contact,
// reach them by email and by phone, stay visible with posts. Each app is bought on its own.
// `wallet` is the app's credit wallet; `plans` is its Subscription page (none: nothing to buy yet).
export const APPS = [
  { id: "leadgen", wallet: "leadgen", name: "Lead Generation", role: "Find", icon: Search, accent: "#8B5CF6", plans: "#/leadgen/subscription",
    blurb: "Find target companies and the right decision-makers, with verified contact details and a briefing on each." },
  { id: "emailoutreach", wallet: "email", name: "Email Outreach", role: "Reach by email", icon: Mail, accent: "#F59E0B", plans: "#/emailoutreach/subscription",
    blurb: "Write and send outreach sequences, draft replies to clients, and turn your posts into emails." },
  { id: "voice", wallet: "voice", name: "AI Voice Assistant", role: "Reach by phone", icon: PhoneCall, accent: C.cobalt, plans: "#/voice/subscription",
    blurb: "AI agents that call your prospects, hold the conversation and book meetings while you supervise." },
  { id: "scheduler", wallet: "scheduler", name: "Post Scheduler", role: "Stay visible", icon: CalendarDays, accent: C.teal, plans: "#/scheduler/subscription",
    blurb: "Plan posts in a chat, see them on a calendar, then approve and publish across your channels." },
];
