import { CalendarDays, PhoneCall, Search } from "lucide-react";
import { C } from "../tokens";

// The apps of the OutReach suite: Voice, Leadgen (including Email Outreach), Post Scheduler.
// Each app is bought on its own. `wallet` is the app's credit wallet; `plans` is its Subscription page.
export const APPS = [
  {
    id: "voice",
    wallet: "voice",
    name: "AI Voice Assistant",
    role: "Reach by phone",
    icon: PhoneCall,
    accent: C.cobalt,
    plans: "#/voice/subscription",
    blurb: "AI agents that call your prospects, hold the conversation and book meetings while you supervise.",
  },
  {
    id: "leadgen",
    wallet: "leadgen",
    name: "Lead Generation",
    role: "Find & Email",
    icon: Search,
    accent: "#8B5CF6",
    plans: "#/leadgen/subscription",
    blurb: "Find verified target accounts and decision makers, run automated multi-step email sequences, and manage mailboxes.",
  },
  {
    id: "scheduler",
    wallet: "scheduler",
    name: "Post Scheduler",
    role: "Stay visible",
    icon: CalendarDays,
    accent: C.teal,
    plans: "#/scheduler/subscription",
    blurb: "Plan posts in a chat, see them on a calendar, then approve and publish across your channels.",
  },
];
