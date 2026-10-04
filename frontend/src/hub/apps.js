import { CalendarDays, PhoneCall, Search } from "lucide-react";
import { C } from "../tokens";

// The apps of the Outreach suite, in the order a customer uses them (the tagline "Find, Connect
// & Engage"): Leads (including email outreach), Voice, Social.
// Each app is bought on its own. `wallet` is the app's credit wallet; `plans` is its Subscription page.
export const APPS = [
  {
    id: "leadgen",
    wallet: "leadgen",
    name: "Leads",
    role: "Find & email",
    icon: Search,
    accent: "#8B5CF6",
    plans: "#/leadgen/subscription",
    blurb: "Find verified target accounts and decision makers, run automated multi-step email sequences, and manage mailboxes.",
  },
  {
    id: "voice",
    wallet: "voice",
    name: "Voice",
    role: "AI phone calls",
    icon: PhoneCall,
    accent: C.cobalt,
    plans: "#/voice/subscription",
    blurb: "AI agents that call your prospects, hold the conversation and book meetings while you supervise.",
  },
  {
    id: "scheduler",
    wallet: "scheduler",
    name: "Social",
    role: "Plan & publish posts",
    icon: CalendarDays,
    accent: C.teal,
    plans: "#/scheduler/subscription",
    blurb: "Plan posts in a chat, see them on a calendar, then approve and publish across your channels.",
  },
];
