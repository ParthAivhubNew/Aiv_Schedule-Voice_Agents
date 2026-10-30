import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUp, BarChart3, Route, BookOpen, Brain, Building2, CalendarClock, Check, ChevronRight, Clock, FileSpreadsheet, Globe, ListPlus, Mail, ArrowRight, Maximize2, Mic, PenLine, Plus, RotateCcw, Search, Send, ShieldCheck, Sparkles, Square, Trash2, Users, X } from "lucide-react";
import { api } from "../../api/apiClient";
import { Spinner } from "../../app/Loader";
import { useSpeech } from "../../hooks/useSpeech";
import { navigateHash } from "../../utils/route";
import { PlanCard } from "../../agent/PlanCard";
import { WorkflowCard } from "../../workflows/WorkflowCard";
import { C, FONT_BODY } from "../../tokens";
import { asAccount } from "./FindLeadsView";
import { domainOf } from "./AccountsViews";
import { addedText } from "./journeyLogic";
import { creditWord, useLeadCredits } from "./CreditsChip";

// The AI assistant: a panel that sits to the right of any Leads page and pushes the page aside, opened from the dark button in the
// header or the menu. The server picks tools and words the answer (see api/lead_assistant.py). Companies always come from the stored
// register. Anything that costs credits or changes a list is shown as a card and only happens when the person presses its button.

const GOALS = [
  { id: "prospects", Icon: Sparkles, title: "Find ideal prospects", note: "Companies that fit your business, and why", prompt: "Find the best companies for my business and explain why they fit." },
  { id: "list", Icon: ListPlus, title: "Build a company list", note: "Say who you want, for example software companies in Leeds", prefill: "Find " },
  { id: "campaign", Icon: Send, title: "Write an email campaign", note: "Pick a list, write the emails, send", go: "outreach" },
  { id: "leads", Icon: BarChart3, title: "How are my leads doing?", note: "Your saved companies by stage", prompt: "How are my leads doing?" },
  { id: "perf", Icon: Users, title: "Analyze campaign performance", note: "Sent, replied and bounced, per campaign", prompt: "How are my campaigns doing?" },
  { id: "due", Icon: CalendarClock, title: "Who should I follow up with?", note: "Callbacks due in the next 7 days", prompt: "Who should I follow up with this week?" },
];
// Typed after "/": the same shortcuts Apollo's assistant has. "run" sends the text; "fill" puts it in the box for the person to finish.
const COMMANDS = [
  { cmd: "/find-leads", note: "Find companies that match what you type", fill: "Find " },
  { cmd: "/find-lookalikes", note: "Find companies like the ones in your best list", run: "Find companies like the ones in my lists, in the same sector and area." },
  { cmd: "/what-can-i-do", note: "See what the assistant can help you with", run: "What can you help me with?" },
  { cmd: "/remember", note: "Save a preference the assistant should always follow", fill: "/remember " },
  { cmd: "/memory", note: "See and delete what I remember", memory: true },
  { cmd: "/import", note: "Bring in your own spreadsheet of companies", importer: true },
];
const WEB_KEY = "leadgen_assistant_web";
const readWeb = () => { try { return localStorage.getItem(WEB_KEY) === "on"; } catch { return false; } };

// The conversation lives here, outside any one screen, so the full page and the docked panel show the same chat: go to another tab and the
// chat moves to the corner with its answer still coming in; expand it and it fills the page again.
// Each plugin (Leads, Voice, Social) has its own store, so a chat in one never shows in another.
const stores = {};
const storeFor = (id) => stores[id] || (stores[id] = {
  s: { messages: [], busy: false, live: { status: "", steps: [] }, acts: {}, suggest: [], filters: {}, chatId: `a_${Date.now()}`, run: 0, turnState: {} },
  subs: new Set(), aborter: null, // aborter stops the answer that is being streamed
});
const setShared = (store, patch) => {
  store.s = { ...store.s, ...(typeof patch === "function" ? patch(store.s) : patch) };
  store.subs.forEach((f) => f());
};
const useShared = (store) => useSyncExternalStore((f) => { store.subs.add(f); return () => store.subs.delete(f); }, () => store.s);
const sharedRef = (store, key) => ({ get current() { return store.s[key]; }, set current(v) { store.s = { ...store.s, [key]: v }; } });
const settable = (store, key) => (v) => setShared(store, (st) => ({ [key]: typeof v === "function" ? v(st[key]) : v }));
export const assistantHasChat = (plugin = "leads") => storeFor(plugin).s.messages.length > 0;

// What differs between the plugins' assistants. The look and the behaviour are the same.
const PLUGINS = {
  leads: {
    id: "leads", short: "Leads", name: "AI Assistant", history: "leadgen_assistant", memory: "leadgen_assistant_memory", leads: true,
    ask: (body, on, signal) => api.assistantStream(body, on, signal), goals: GOALS,
    placeholder: "Ask about leads, or type / for commands",
    starters: ["Find software companies in Leeds","Find accountants in Manchester with an email", "How are my leads doing?", "How are my campaigns doing?", "How many credits do I have left?", "What can you help me with?"],
    foot: "Saving, checking and sending only happen when you press the button on a card.",
    get presets() { return PRESETS; },
  },
  voice: {
    id: "voice", short: "Voice", name: "Voice assistant", history: "voice_assistant", memory: "voice_assistant_memory", leads: false,
    ask: (body, on, signal) => api.pluginAssistantStream("voice", body, on, signal),
    goals: [
      { id: "results", Icon: BarChart3, title: "How did my calls go?", note: "Results by outcome, and the latest calls", prompt: "How did my calls go this week?" },
      { id: "find", Icon: Search, title: "Find a call", note: "By name, company or number, with its summary", prefill: "What happened with " },
      { id: "lists", Icon: ListPlus, title: "My call lists", note: "Who is on them and who was already called", prompt: "What call lists do I have?" },
      { id: "sched", Icon: CalendarClock, title: "What is scheduled?", note: "Calls set to run later or repeatedly", prompt: "Do I have any calls scheduled?" },
      { id: "setup", Icon: ShieldCheck, title: "Is my AI caller ready?", note: "Your numbers and the AI caller's state", prompt: "Is my AI caller set up, and which numbers do I have?" },
      { id: "credits", Icon: Sparkles, title: "How many credits do I have?", note: "Calling minutes left", prompt: "How many credits do I have left?" },
    ],
    placeholder: "Ask about your calls, lists or schedule",
    starters: ["How did my calls go this week?", "Which calls ended in a meeting?", "Do I have any calls scheduled?", "How many credits do I have left?", "Is my AI caller set up?"],
    foot: "I read your own calls and settings. To change something I take you to its screen.",
    presets: [
      { id: "results", label: "Results", Icon: BarChart3, items: [
        { title: "How did my calls go this week?", prompt: "How did my calls go this week?" },
        { title: "Which calls ended in a meeting?", prompt: "Which calls ended with a meeting booked?" },
        { title: "Which calls need a callback?", prompt: "Which calls asked for a callback, and when?" },
        { title: "Find a call", prefill: "What happened with " }] },
      { id: "setup", label: "Setup", Icon: ShieldCheck, items: [
        { title: "Is my AI caller ready?", prompt: "Is my AI caller set up, and which numbers do I have?" },
        { title: "Change what the AI caller says", prompt: "I want to change what the AI caller says on calls." },
        { title: "How many credits do I have?", prompt: "How many credits do I have left?" }] },
      { id: "calling", label: "Calling", Icon: CalendarClock, items: [
        { title: "What call lists do I have?", prompt: "What call lists do I have, and who was already called?" },
        { title: "What is scheduled?", prompt: "Do I have any calls scheduled?" },
        { title: "Help me schedule calls to a list", prompt: "Help me schedule calls to one of my lists." }] },
    ],
  },
  social: {
    id: "social", short: "Social", name: "Social assistant", history: "social_assistant", memory: "social_assistant_memory", leads: false,
    ask: (body, on, signal) => api.pluginAssistantStream("social", body, on, signal),
    goals: [
      { id: "next", Icon: CalendarClock, title: "What is going out?", note: "Posts by status, and the next ones", prompt: "What is scheduled to go out?" },
      { id: "results", Icon: BarChart3, title: "How did my posts do?", note: "Best posts by reach, likes and clicks", prompt: "How did my posts do this month?" },
      { id: "accounts", Icon: ShieldCheck, title: "Are my accounts connected?", note: "Each network and any error", prompt: "Are my social accounts connected?" },
      { id: "plan", Icon: PenLine, title: "Plan some posts", note: "Say the topic and when; the planner opens ready", prefill: "Plan 3 posts for next week about " },
      { id: "credits", Icon: Sparkles, title: "How many credits do I have?", note: "Social credits left", prompt: "How many credits do I have left?" },
    ],
    placeholder: "Ask about your posts, results or accounts",
    starters: ["What is scheduled to go out?", "How did my posts do this month?", "Are my accounts connected?", "Plan 3 posts for next week", "How many credits do I have left?"],
    foot: "I read your own posts and accounts. To plan or change posts I open the planner for you.",
    presets: [
      { id: "posts", label: "Posts", Icon: CalendarClock, items: [
        { title: "What is going out?", prompt: "What is scheduled to go out?" },
        { title: "What needs my approval?", prompt: "Which posts are waiting for my approval?" },
        { title: "Plan some posts", prefill: "Plan 3 posts for next week about " }] },
      { id: "results", label: "Results", Icon: BarChart3, items: [
        { title: "How did my posts do this month?", prompt: "How did my posts do this month?" },
        { title: "Which post did best?", prompt: "Which of my posts did best, and why might that be?" }] },
      { id: "setup", label: "Setup", Icon: ShieldCheck, items: [
        { title: "Are my accounts connected?", prompt: "Are my social accounts connected?" },
        { title: "How many credits do I have?", prompt: "How many credits do I have left?" }] },
    ],
  },
};

// A button from the assistant that opens somewhere else in the app. Social's pages are inside one screen, so it is told by event.
function goTo(hash, prompt) {
  if (hash.startsWith("#/scheduler/")) {
    window.dispatchEvent(new CustomEvent("aivhub:social-goto", { detail: { page: hash.split("/")[2] || "plan", prompt: prompt || "" } }));
    return;
  }
  navigateHash(hash);
}
// The full page opens on these groups, the way Apollo's does. Every prompt maps to something the assistant can really read or do here.
const PRESETS = [
  { id: "prospecting", label: "Prospecting", Icon: Search, items: [
    { title: "Build my target audience", prompt: "Using my business profile, work out who my ideal customers are and search the register for them." },
    { title: "Size my market", prompt: "How big is my market? Count the companies that could buy what I sell, and how many have a website, email or phone." },
    { title: "Find lookalikes of my best customers", prompt: "Find companies like my best saved companies, in the same sectors and towns." },
    { title: "Score companies for fit", prompt: "Which of the companies you found fit my business best, and why?" }] },
  { id: "research", label: "Research", Icon: Sparkles, items: [
    { title: "Research a company", prefill: "Tell me what the register holds about " },
    { title: "Compare two towns", prefill: "Compare how many companies there are in " },
    { title: "Who should I contact first?", prompt: "From the companies you found, who should I contact first and why?" }] },
  { id: "sequencing", label: "Sequencing", Icon: Send, items: [
    { title: "Write a cold email sequence", prompt: "Write a three-email cold sequence for my business, with a subject line for each and merge fields for the name and company." },
    { title: "Write a re-engagement email", prompt: "Write a short email to re-engage companies that never replied to me." },
    { title: "Write a follow-up after a call", prompt: "Write a short follow-up email to send after a first phone call." }] },
  { id: "analytics", label: "Analytics", Icon: BarChart3, items: [
    { title: "How are my leads doing?", prompt: "How are my leads doing?" },
    { title: "Analyze campaign performance", prompt: "How are my campaigns doing?" },
    { title: "How are replies sorted?", prompt: "How were the replies to my campaigns sorted in the last 30 days?" },
    { title: "Who should I follow up with?", prompt: "Who should I follow up with this week?" }] },
  { id: "deliverability", label: "Deliverability", Icon: Mail, items: [
    { title: "Check my mailbox health", prompt: "Check the health of my sending mailboxes." },
    { title: "Why might my emails land in spam?", prompt: "Look at my mailboxes and tell me what could make my emails land in spam, and what to fix first." }] },
];
const STAGES = ["Understanding your request", "Searching the company register", "Putting the answer together"];

const css = `
.as-wrap{flex:0 0 400px;width:400px;height:100vh;overflow:hidden;position:relative;z-index:70;animation:as-grow .28s var(--mo-ease,cubic-bezier(.2,.8,.2,1)) both}
.as-wrap[data-leaving="true"]{animation:as-shrink .22s var(--mo-ease,ease) both}
@keyframes as-grow{from{flex-basis:0;width:0;opacity:.4}to{flex-basis:400px;width:400px;opacity:1}}
@keyframes as-shrink{from{flex-basis:400px;width:400px;opacity:1}to{flex-basis:0;width:0;opacity:0}}
.as-panel{width:400px;height:100vh;box-sizing:border-box;display:flex;flex-direction:column;background:#fff;border-left:1px solid var(--ui-line,#E3E6EF)}
.as-head{display:flex;align-items:center;gap:6px;padding:0 10px 0 16px;height:56px;flex:none;border-bottom:1px solid var(--ui-line,#E3E6EF)}
.as-body{flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px;scroll-behavior:smooth}
.as-goal{all:unset;box-sizing:border-box;width:100%;display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border:1px solid var(--ui-line,#E3E6EF);border-radius:12px;cursor:pointer;background:#fff;animation:mo-rise .34s var(--mo-ease,ease) both;transition:border-color .15s,background-color .15s,transform .15s var(--mo-ease,ease),box-shadow .15s}
.as-goal:nth-of-type(1){animation-delay:.05s}.as-goal:nth-of-type(2){animation-delay:.1s}.as-goal:nth-of-type(3){animation-delay:.15s}
.as-goal:hover{border-color:var(--ui-accent,#3457D5);background:var(--ui-accent-soft,#F5F7FF);transform:translateY(-1px);box-shadow:0 4px 14px rgba(20,24,40,.07)}
.as-goal:active{transform:scale(.99)}
.as-goal:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:2px}
.as-me{align-self:flex-end;max-width:88%;background:var(--ui-sunken,#F1F3F8);border-radius:14px 14px 4px 14px;padding:9px 13px;white-space:pre-wrap;overflow-wrap:anywhere;animation:mo-rise .26s var(--mo-ease,ease) both}
.as-bot{align-self:flex-start;max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;animation:mo-rise .3s var(--mo-ease,ease) both}
.as-card{margin-top:10px;border:1px solid var(--ui-line,#E3E6EF);border-radius:12px;padding:10px 12px;background:#fff;white-space:normal;animation:mo-rise .34s .08s var(--mo-ease,ease) both}
.as-hit{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid var(--ui-line-soft,#EEF0F5)}
.as-steps{display:grid;grid-template-rows:0fr;transition:grid-template-rows .26s var(--mo-ease,ease);white-space:normal}
.as-steps[data-open="true"]{grid-template-rows:1fr}
.as-steps>div{overflow:hidden;min-height:0}
.as-chev{transition:transform .2s var(--mo-ease,ease)}
.as-chev[data-open="true"]{transform:rotate(90deg)}
.as-toggle{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:4px;font:12px Inter,sans-serif;color:var(--ui-muted,#6B7280);margin-bottom:6px;border-radius:6px;padding:1px 4px 1px 0}
.as-toggle:hover,.as-toggle:focus-visible{color:var(--ui-ink,#111827)}
.as-dots{display:inline-flex;gap:3px;margin-left:2px}
.as-dots i{width:5px;height:5px;border-radius:50%;background:var(--ui-muted,#6B7280);animation:mo-dot 1.1s ease-in-out infinite}
.as-dots i:nth-child(2){animation-delay:.15s}.as-dots i:nth-child(3){animation-delay:.3s}
.as-foot{flex:none;padding:10px 14px 12px;border-top:1px solid var(--ui-line,#E3E6EF);background:#fff}
.as-box{display:flex;align-items:flex-end;gap:8px;border:1px solid var(--ui-line,#E3E6EF);border-radius:12px;padding:8px 8px 8px 12px;background:#fff;transition:border-color .15s,box-shadow .15s}
.as-box:focus-within{border-color:var(--ui-accent,#3457D5);box-shadow:0 0 0 3px var(--ui-accent-soft,#EEF2FE)}
.as-box textarea{all:unset;flex:1;min-width:0;font:13.5px/1.45 Inter,sans-serif;max-height:120px;overflow-y:hidden;scrollbar-width:none;color:var(--ui-ink,#111827);white-space:pre-wrap}
.as-box textarea::-webkit-scrollbar{display:none}
.as-send{all:unset;cursor:pointer;width:30px;height:30px;border-radius:8px;background:#111520;color:#fff;display:inline-flex;align-items:center;justify-content:center;flex:none;transition:transform .12s var(--mo-ease,ease),opacity .15s}
.as-send:not([disabled]):hover{transform:translateY(-1px)}.as-send:not([disabled]):active{transform:scale(.94)}
.as-send[disabled]{opacity:.35;cursor:default}
.as-mic{all:unset;cursor:pointer;width:30px;height:30px;border-radius:8px;color:var(--ui-muted,#6B7280);display:inline-flex;align-items:center;justify-content:center;flex:none;transition:background .15s,color .15s}
.as-mic:hover{background:var(--ui-accent-soft,#EEF2FE);color:var(--ui-accent,#3457D5)}
.as-mic[data-on="true"]{background:#DC2626;color:#fff;animation:as-listen 1.2s ease-in-out infinite}
.as-mic:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:2px}
@keyframes as-listen{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.45)}50%{box-shadow:0 0 0 6px rgba(220,38,38,0)}}
.as-live{margin:0;padding:0 0 0 2px;list-style:none;display:grid;gap:5px}
.as-live li{display:flex;gap:8px;font:12.5px/1.4 Inter,sans-serif;color:var(--ui-muted,#6B7280);animation:mo-rise .3s var(--mo-ease,ease) both}
.as-live strong{color:var(--ui-ink,#111827);font-weight:600}
.as-send:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:2px}
.as-icon{all:unset;cursor:pointer;width:30px;height:30px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:var(--ui-muted,#6B7280);transition:background-color .12s,color .12s}
.as-icon:hover,.as-icon:focus-visible{background:var(--ui-hover,#F1F3F8);color:var(--ui-ink,#111827)}
.as-field{display:flex;flex-direction:column;gap:3px;font:12px Inter,sans-serif;color:var(--ui-muted,#6B7280)}
.as-field textarea,.as-field input{font:13px/1.4 Inter,sans-serif}
.as-web{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid var(--ui-line,#E3E6EF);border-radius:999px;font:12.5px Inter,sans-serif;color:var(--ui-muted,#6B7280);background:#fff;transition:border-color .15s,background-color .15s,color .15s}
.as-web:hover,.as-web:focus-visible{border-color:var(--ui-accent,#3457D5);color:var(--ui-ink,#111827)}
.as-web:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:2px}
.as-web[data-on="true"]{border-color:var(--ui-accent,#3457D5);background:var(--ui-accent-soft,#F5F7FF);color:var(--ui-ink,#111827)}
.as-web-state{font-weight:600}
.as-tag{display:inline-block;font:600 10.5px Inter,sans-serif;padding:1px 6px;border-radius:999px;background:#FFF6EA;color:#9A5B0C;vertical-align:1px;margin-left:4px}
.as-orb{animation:mo-pop .5s var(--mo-ease,ease) both}
.as-wrap.as-page{flex:1 1 auto;width:auto;height:100%;animation:none;z-index:auto;min-width:0}
.as-page .as-panel{width:100%;height:100%;flex-direction:row;border-left:0;background:transparent}
.as-col{display:contents}
.as-page .as-col{display:flex;flex-direction:column;flex:1;min-width:0;height:100%}
.as-page .as-body{align-items:stretch;padding:24px max(20px,calc((100% - 720px)/2))}
.as-page .as-foot{border-top:0;background:transparent;padding:10px max(20px,calc((100% - 720px)/2)) 16px}
.as-page .as-box{padding:12px 12px 12px 16px;box-shadow:0 2px 10px rgba(20,24,40,.05)}
.as-side{flex:0 0 232px;box-sizing:border-box;border-right:1px solid var(--ui-line,#E3E6EF);padding:14px 10px;display:flex;flex-direction:column;gap:2px;overflow-y:auto;background:#fff}
.as-nav{all:unset;box-sizing:border-box;width:100%;display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px;cursor:pointer;font:13.5px Inter,sans-serif;color:var(--ui-ink,#111827)}
.as-nav:hover,.as-nav:focus-visible{background:var(--ui-hover,#F1F3F8)}
.as-nav[data-on="true"]{background:var(--ui-accent-soft,#F3EEFF);font-weight:600}
.as-nav:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:-2px}
.as-nav>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.as-cap{font:600 11px Inter,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--ui-muted,#6B7280);padding:14px 10px 4px}
.as-pills{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.as-pill{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:7px 13px;border:1px solid var(--ui-line,#E3E6EF);border-radius:999px;background:#fff;font:13px Inter,sans-serif;color:var(--ui-ink,#111827);transition:border-color .15s,background-color .15s}
.as-pill:hover,.as-pill:focus-visible,.as-pill[data-on="true"]{border-color:var(--ui-accent,#3457D5);background:var(--ui-accent-soft,#F5F7FF)}
.as-pill:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:2px}
.as-row{all:unset;box-sizing:border-box;width:100%;padding:12px 14px;border:1px solid var(--ui-line,#E3E6EF);border-radius:10px;background:#fff;box-shadow:0 1px 2px rgba(20,24,40,.06),0 4px 12px rgba(20,24,40,.07);cursor:pointer;font:13.5px Inter,sans-serif;color:var(--ui-ink,#111827);transition:box-shadow .15s,border-color .15s,transform .15s var(--mo-ease,ease)}
.as-row:hover,.as-row:focus-visible{border-color:var(--ui-accent,#3457D5);box-shadow:0 2px 4px rgba(20,24,40,.08),0 8px 20px rgba(20,24,40,.12);transform:translateY(-1px)}
.as-row:active{transform:none;box-shadow:0 1px 2px rgba(20,24,40,.08)}
.as-row:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.as-row{transition:none}.as-row:hover,.as-row:focus-visible{transform:none}}
@media (max-width:820px){.as-side{display:none}.as-page .as-body,.as-page .as-foot{padding-left:14px;padding-right:14px}}
.as-chips{display:flex;gap:6px;overflow-x:auto;padding:0 0 8px;scrollbar-width:none}
.as-chips::-webkit-scrollbar{display:none}
.as-chip{all:unset;cursor:pointer;flex:none;box-sizing:border-box;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 11px;border:1px solid var(--ui-line,#E3E6EF);border-radius:999px;font:12.5px Inter,sans-serif;color:var(--ui-ink,#111827);background:#fff;transition:border-color .15s,background-color .15s}
.as-chip:hover,.as-chip:focus-visible{border-color:var(--ui-accent,#3457D5);background:var(--ui-accent-soft,#F5F7FF)}
.as-chip:focus-visible{outline:2px solid var(--ui-accent,#3457D5);outline-offset:1px}
.as-menu{border:1px solid var(--ui-line,#E3E6EF);border-radius:12px;background:#fff;margin-bottom:8px;overflow:hidden}
.as-opt{all:unset;box-sizing:border-box;width:100%;display:flex;gap:10px;align-items:baseline;padding:8px 12px;cursor:pointer;font:13px Inter,sans-serif}
.as-opt[aria-selected="true"],.as-opt:hover{background:var(--ui-hover,#F1F3F8)}
@media (max-width:820px){
  .as-wrap{position:fixed;inset:0;width:100%;flex-basis:auto;z-index:90;animation:mo-slide-in .26s var(--mo-ease,ease) both}
  .as-wrap[data-leaving="true"]{animation:mo-slide-out .2s var(--mo-ease,ease) both}
  .as-panel{width:100%}
}
@media (prefers-reduced-motion:reduce){
  .as-wrap,.as-wrap[data-leaving="true"],.as-goal,.as-me,.as-bot,.as-card,.as-orb,.as-live li,.as-mic[data-on="true"]{animation:none}
  .as-steps,.as-chev,.as-goal,.as-send{transition:none}
  .as-dots i{animation:none;opacity:.7}
}
`;

export function AssistantButton({ open, onClick, label = "AI Assistant" }) {
  return (
    <button type="button" className="ui-btn ui-btn--sm as-open" aria-pressed={open} title={open ? "Close the AI assistant" : "Open the AI assistant"} onClick={onClick}
      style={{ background: "#111520", color: "#fff", border: "1px solid #111520", display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
      <Sparkles size={14} aria-hidden="true" /> <span className="hide-xs">{label}</span>
    </button>
  );
}

const seconds = (ms) => (ms < 1000 ? "less than a second" : `${Math.round(ms / 1000)} second${Math.round(ms / 1000) === 1 ? "" : "s"}`);

function Steps({ steps, tookMs }) {
  const [on, setOn] = useState(false);
  if (!steps?.length) return null;
  return (
    <div>
      <button type="button" className="as-toggle" aria-expanded={on} onClick={() => setOn((v) => !v)}>
        <ChevronRight size={13} className="as-chev" data-open={on} aria-hidden="true" /> Worked for {seconds(tookMs || 0)}
      </button>
      <div className="as-steps" data-open={on}>
        <div>
          <ol style={{ margin: "0 0 8px", padding: "0 0 0 4px", listStyle: "none", display: "grid", gap: 6 }}>
            {steps.map((s, i) => (
              <li key={i} style={{ display: "flex", gap: 8, fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate }}>
                <Check size={13} color={C.green} aria-hidden="true" style={{ flex: "none", marginTop: 2 }} />
                <span><strong style={{ color: C.ink, fontWeight: 600 }}>{s.label}</strong>{s.detail ? <><br />{s.detail}</> : null}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

// "Tell me about your business": read the website, let the person fix the fields, save them where every tool reads them.
function ProfileSetup({ onSaved, editable = false }) {
  const [url, setUrl] = useState("");
  const [fields, setFields] = useState(null);
  const [base, setBase] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { api.emailGetWritingProfile().then(setBase).catch(() => {}); }, []);
  // In the Context center the saved profile is shown straight away, ready to read and edit.
  useEffect(() => { if (editable && base && !fields) setFields({ ...(base.edit || {}) }); }, [editable, base]); // eslint-disable-line react-hooks/exhaustive-deps
  const canEdit = base ? base.can_edit !== false : true;
  const read = async () => {
    if (!url.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const r = await api.assistantProfileFromSite(url.trim());
      setFields({ ...r.profile, website: r.website });
    } catch (err) { setError(err.message || "I couldn't read that site."); }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true); setError("");
    try {
      await api.emailSaveWritingProfile({ ...(base?.edit || {}), ...fields });
      setBase((b) => ({ ...(b || {}), edit: { ...(b?.edit || {}), ...fields } }));
      setSaved(true);
      onSaved();
    } catch (err) { setError(err.message || "Couldn't save."); }
    setBusy(false);
  };
  const set = (k) => (e) => { setSaved(false); setFields((f) => ({ ...f, [k]: e.target.value })); };
  const small = { fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate };
  return (
    <div className="as-card" style={{ marginTop: 0 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontFamily: FONT_BODY, fontSize: 13.5, fontWeight: 600, color: C.ink }}><Building2 size={16} aria-hidden="true" /> Tell me about your business</div>
      <p style={{ ...small, margin: "4px 0 8px" }}>{editable ? (fields && (fields.company || fields.sells) ? "This is what I know about your business. Every answer, search and email follows it. Change anything and press Save." : "I do not know your business yet. Type it below, or give me your website and I will read it for you to check.") : "Give me your website and I will read it, so my answers fit what you sell."}</p>
      {editable && fields ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <input className="ui-input" aria-label="Your website" placeholder="Fill it in from your website: yourcompany.com" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") read(); }} style={{ flex: 1, minWidth: 0 }} />
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy || !url.trim()} onClick={read}>{busy ? <Spinner size={13} /> : "Read it"}</button>
        </div>
      ) : null}
      {!fields ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {editable && base?.edit?.company ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={() => setFields({ ...base.edit })}>Edit what I know: {base.edit.company}</button> : null}
          <input className="ui-input" aria-label="Your website" placeholder="yourcompany.com" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") read(); }} style={{ flex: 1, minWidth: 0 }} />
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy || !url.trim()} onClick={read}>{busy ? <Spinner size={13} /> : "Read it"}</button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {[["company", "Company name", "input"], ["sells", "What you sell", "textarea"], ["audience", "Who buys it", "textarea"], ["offer", "Your main offer", "textarea"], ["tone", "How you speak", "input"]].map(([k, label, kind]) => (
            <label key={k} className="as-field">{label}
              {kind === "input" ? <input className="ui-input" value={fields[k] || ""} onChange={set(k)} maxLength={200} /> : <textarea className="ui-input" rows={2} value={fields[k] || ""} onChange={set(k)} maxLength={600} style={{ height: "auto", padding: 8, resize: "vertical" }} />}
            </label>
          ))}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy || !canEdit || !fields.company?.trim() || !fields.sells?.trim()} onClick={save}>{busy ? <Spinner size={13} /> : "Save"}</button>
            {!editable ? <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setFields(null)}>Back</button> : null}
            {saved ? <span role="status" style={{ ...small, color: C.green }}>Saved. I will use this from now on.</span> : null}
            {!canEdit ? <span style={small}>Only an admin can save this.</span> : null}
          </div>
        </div>
      )}
      {error ? <div role="alert" style={{ ...small, color: C.red, marginTop: 6 }}>{error}</div> : null}
    </div>
  );
}

export function AssistantPanel({ open, onClose, store, lists, onShowResults, onGo, onCampaign, onOpenList, onOpenJourney, onOpenCompany, seed, onExpand, onImport, page = false, plugin = "leads" }) {
  const cfg = PLUGINS[plugin] || PLUGINS.leads;
  const sh = storeFor(cfg.id);
  const [render, setRender] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const [input, setInput] = useState("");
  const { messages, busy, live, acts, suggest } = useShared(sh);
  const setMessages = settable(sh, "messages");
  const setBusy = settable(sh, "busy");
  const setLive = settable(sh, "live");
  const setActs = settable(sh, "acts");
  const setSuggest = settable(sh, "suggest");
  const [stage, setStage] = useState(0);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [view, setView] = useState("chat"); // chat | history | context | memory
  const [history, setHistory] = useState([]);
  const [memory, setMemory] = useState([]); // [{ id, text }]: what the person asked me to remember
  const [slashIx, setSlashIx] = useState(0);
  const [preset, setPreset] = useState(""); // which preset group is open on the start screen
  const [newMemory, setNewMemory] = useState(""); // highlighted slash command
  const [web, setWebOn] = useState(readWeb); // the Web search switch: only when it is on does the assistant get its web search
  const webRate = useLeadCredits()?.rates?.lead_lookup?.credits;
  const setWeb = (v) => { setWebOn(v); try { localStorage.setItem(WEB_KEY, v ? "on" : "off"); } catch { /* the choice just is not remembered */ } };
  const filters = sharedRef(sh, "filters");
  const chatId = sharedRef(sh, "chatId");
  const run = sharedRef(sh, "run");
  const turn = sharedRef(sh, "turnState");
  const HISTORY_KEY = cfg.history;
  const MEMORY_KEY = cfg.memory;
  const endRef = useRef(null);
  const boxRef = useRef(null);
  const spoken = useRef({ base: "" }); // what was already in the box when the mic was turned on
  const mic = useSpeech((said) => setInput(`${spoken.current.base}${spoken.current.base && said ? " " : ""}${said}`));
  const toggleMic = () => {
    if (mic.listening) { mic.stop(); return; }
    spoken.current.base = input.trim();
    mic.start();
    boxRef.current?.focus();
  };

  const loadProfile = useCallback(() => {
    api.emailGetWritingProfile().then((r) => setNeedsProfile(!r?.edit?.company || !r?.edit?.sells)).catch(() => {});
  }, []);
  useEffect(() => { if (cfg.leads) loadProfile(); }, [loadProfile, cfg.leads]);
  const loadHistory = useCallback(() => { api.chatHistory(HISTORY_KEY).then((r) => setHistory(r?.chats || [])).catch(() => {}); }, [HISTORY_KEY]);
  useEffect(() => { if (page) loadHistory(); }, [page, loadHistory]);
  useEffect(() => { api.chatHistory(MEMORY_KEY).then((r) => setMemory((r?.chats || []).map((c) => ({ id: c.id, text: c.title })))).catch(() => {}); }, [MEMORY_KEY]);
  useEffect(() => {
    if (open) { setRender(true); setLeaving(false); return undefined; }
    if (!render) return undefined;
    setLeaving(true);
    const t = setTimeout(() => { setRender(false); setLeaving(false); }, 220);
    return () => clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!busy) return undefined;
    setStage(0);
    const t = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 3200);
    return () => clearInterval(t);
  }, [busy]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [messages, busy, acts]);
  useEffect(() => { if (open && view === "chat") setTimeout(() => boxRef.current?.focus(), 80); }, [open, view]);
  // The box is one line until the text needs more, then grows to about six lines; past that it scrolls, with no scrollbar showing.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    el.style.overflowY = el.scrollHeight > 120 ? "auto" : "hidden";
  }, [input, view, render]);

  // A page can hand the assistant a message ("Ask AI" on a company): it is sent once, when the panel is open.
  // Kept above the early return so the hook count never changes between renders.
  const lastSeed = useRef(0);
  useEffect(() => {
    if (seed && seed.id !== lastSeed.current && open && !busy) { lastSeed.current = seed.id; send(seed.text); }
  });

  if (!render && !page) return null;

  const remember = (list) => {
    const first = list.find((m) => m.role === "user");
    if (!first) return;
    api.saveChatHistory(HISTORY_KEY, {
      id: chatId.current, title: first.text.slice(0, 70), at: Date.now(), filters: filters.current,
      chat: list.map((m) => ({ id: m.id, role: m.role, text: m.text, ...(m.found ? { found: m.found.total } : {}) })),
    }).then(() => { if (page) loadHistory(); }).catch(() => {});
  };

  const send = async (override) => {
    const text = String(override ?? input).trim();
    if (!text || busy) return;
    setInput("");
    if (/^\/remember(\s|$)/i.test(text)) { await remember_(text.replace(/^\/remember\s*/i, "")); return; }
    if (/^\/memory(\s|$)/i.test(text)) { showMemory(); return; }
    const prior = messages.map((m) => ({ role: m.role, content: m.text }));
    const asked = [...messages, { id: `u${Date.now()}`, role: "user", text }];
    setMessages(asked);
    setBusy(true);
    const mine = ++run.current;
    let res = null;
    let failure = null;
    setLive({ status: "Thinking", steps: [] });
    sh.aborter = new AbortController();
    try {
      const body = cfg.leads
        ? { message: text, history: prior, filters: filters.current, lists: (lists || []).map((l) => ({ id: l.id, name: l.name, count: l.count })), memory: memory.map((m) => m.text), web_search: web, state: turn.current }
        : { message: text, history: prior, memory: memory.map((m) => m.text), state: turn.current };
      await cfg.ask(body, (ev) => {
        if (mine !== run.current) return;
        if (ev.type === "status" || ev.type === "tool") setLive((l) => ({ ...l, status: ev.text }));
        else if (ev.type === "step") setLive((l) => ({ ...l, steps: [...l.steps, ev.step] }));
        else if (ev.type === "ui" && ev.action === "filters") filters.current = ev.filters;
        else if (ev.type === "final") res = ev.result;
        else if (ev.type === "error") failure = new Error(ev.message);
      }, sh.aborter.signal);
      if (!res && !failure) failure = new Error("The answer stopped part way. Try again.");
    } catch (err) {
      if (err?.name === "AbortError") return;
      failure = err;
    }
    if (mine !== run.current) return;
    setBusy(false);
    setLive({ status: "", steps: [] });
    let next;
    if (failure) {
      next = [...asked, { id: `a${Date.now()}`, role: "assistant", error: true, retry: text, text: failure.message || "I couldn't reach the AI. Try again in a moment." }];
    } else {
      if (res.found?.filters) filters.current = res.found.filters;
      if (res.state) turn.current = res.state;
      setSuggest(res.suggestions || []);
      next = [...asked, { id: `a${Date.now()}`, role: "assistant", text: res.reply, steps: res.steps, tookMs: res.took_ms, found: res.found, proposals: res.proposals }];
    }
    setMessages(next);
    if (!failure) remember(next);
  };

  const say = (list) => setMessages((m) => [...m, ...list.map((t, i) => ({ id: `a${Date.now()}${i}`, role: "assistant", text: t }))]);
  const remember_ = async (what, quiet = false) => {
    const t = what.trim().slice(0, 300);
    if (!t) { if (quiet) return; say(["Tell me what to remember, for example: /remember I only sell to companies with a website."]); return; }
    const id = `m_${Date.now()}`;
    try {
      await api.saveChatHistory(MEMORY_KEY, { id, title: t, at: Date.now(), chat: [{ id: "1", role: "user", text: t }], filters: {} });
      setMemory((m) => [{ id, text: t }, ...m]);
      if (!quiet) say([`Saved. I will keep this in mind from now on: “${t}”. Type /memory to see or remove what I remember.`]);
    } catch { if (!quiet) say(["I couldn't save that. Try again in a moment."]); }
  };
  const showMemory = () => say([memory.length ? "Here is what I remember. Use the Earlier chats clock, then Remembered, to remove any." : "I haven't been asked to remember anything yet. Use /remember followed by what to remember."]);
  const stop = () => { run.current += 1; sh.aborter?.abort(); setBusy(false); setLive({ status: "", steps: [] }); };
  const fresh = () => { run.current += 1; sh.aborter?.abort(); setBusy(false); setSuggest([]); setMessages([]); setInput(""); setActs({}); filters.current = {}; turn.current = {}; chatId.current = `a_${Date.now()}`; setPreset(""); setView("chat"); };
  const showHistory = () => {
    setView("history");
    api.chatHistory(HISTORY_KEY).then((r) => setHistory(r?.chats || [])).catch(() => setHistory([]));
  };
  const openChat = (h) => {
    run.current += 1; setBusy(false); setActs({});
    chatId.current = h.id; filters.current = h.filters || {}; turn.current = {};
    setMessages((h.chat || []).map((m) => ({ id: m.id, role: m.role === "user" ? "user" : "assistant", text: m.text })));
    setView("chat");
  };
  const forget = (id) => { setHistory((h) => h.filter((x) => x.id !== id)); api.deleteChatHistory(HISTORY_KEY, id).catch(() => {}); };

  const pick = (g) => {
    if (g.go) { onGo?.(g.go); return; }
    if (g.prompt) { send(g.prompt); return; }
    setInput(g.prefill || "");
    boxRef.current?.focus();
  };

  // A card's button: the only place the assistant's suggestions turn into action.
  // "This needs Leads. Switch and ask?": the other plugin's own assistant answers the one question, and the answer comes back into this chat. The chats stay separate.
  const doSwitch = async (p) => {
    const target = PLUGINS[p.params.plugin];
    if (!target) return;
    setActs((a) => ({ ...a, [p.id]: { state: "running" } }));
    let res = null;
    let failure = null;
    const body = target.leads ? { message: p.params.task, history: [], filters: {}, lists: [], memory: [], web_search: false, state: {} } : { message: p.params.task, history: [], memory: [], state: {} };
    try {
      await target.ask(body, (ev) => { if (ev.type === "final") res = ev.result; else if (ev.type === "error") failure = new Error(ev.message); });
    } catch (err) { failure = err; }
    if (failure || !res) {
      setActs((a) => ({ ...a, [p.id]: { state: "error", text: failure?.message || `The ${target.short} assistant did not answer. Try again.` } }));
      return;
    }
    setActs((a) => ({ ...a, [p.id]: { state: "done", text: `Asked the ${target.short} assistant. Its answer is below.` } }));
    setMessages((m) => [...m, { id: `a${Date.now()}`, role: "assistant", from: target.short, text: res.reply, steps: res.steps, tookMs: res.took_ms }]);
  };

  const confirm = async (p) => {
    if (p.kind === "switch") { doSwitch(p); return; }
    if (p.kind === "call_list") {
      setActs((a) => ({ ...a, [p.id]: { state: "running" } }));
      try {
        const r = await api.saveCallList({ name: p.params.name, headers: p.params.headers, rows: p.params.rows });
        setActs((a) => ({ ...a, [p.id]: { state: "done", text: `Made the call list “${r?.list?.name || p.params.name}” with ${p.params.rows.length} people. Open the Call list screen to check it and call.` } }));
      } catch (err) {
        setActs((a) => ({ ...a, [p.id]: { state: "error", text: err.message || "Couldn't make the list." } }));
      }
      return;
    }
    if (p.kind === "go" || p.kind === "plan") { goTo(p.params.hash || "", p.params.prompt); if (!page) onClose?.(); return; }
    if (p.kind === "check_list") { onOpenList?.(p.params.list_id); return; }
    if (p.kind === "campaign") { onCampaign?.(p.params.list_id); return; }
    if (p.kind === "company_open") { onOpenCompany?.(p.params.company_id); if (!page) onClose?.(); return; }
    if (p.kind === "journey_open") { onOpenJourney?.(p.params.journey_id); if (!page) onClose?.(); return; }
    if (p.kind.startsWith("journey_")) {
      // Everything the chat offers about a journey happens here, when the person presses the button: the same calls the Journeys page makes.
      setActs((a) => ({ ...a, [p.id]: { state: "running" } }));
      try {
        const id = p.params.journey_id;
        let said = "";
        if (p.kind === "journey_edit") { await api.journeyChanges(id, p.params.changes); said = "Changed. People part-way through keep their place."; }
        else if (p.kind === "journey_people") { const out = await api.journeyPeople(id, { list_id: p.params.list_id, how_many: p.params.how_many }); said = `${addedText(out)} Nothing is sent until the journey is running.`; }
        else if (p.kind === "journey_control") {
          const status = { start: "running", pause: "paused", stop: "stopped" }[p.params.action];
          await api.journeyStatus(id, status);
          said = { start: "Started. The first step goes out in the next sending window.", pause: "Paused. Nobody loses their place.", stop: "Stopped." }[p.params.action];
        } else if (p.kind === "journey_tasks") {
          for (const tid of p.params.task_ids) { await (p.params.action === "skip" ? api.journeyTaskSkip(tid) : api.journeyTaskDone(tid)); }
          said = `Marked ${p.params.task_ids.length} as ${p.params.action === "skip" ? "skipped" : "done"}.`;
        }
        setActs((a) => ({ ...a, [p.id]: { state: "done", text: said } }));
        if (p.kind !== "journey_tasks") onOpenJourney?.(id);
      } catch (err) {
        setActs((a) => ({ ...a, [p.id]: { state: "error", text: err.message || "That didn't work. Nothing was changed." } }));
      }
      return;
    }
    if (p.kind === "web_search") {
      setActs((a) => ({ ...a, [p.id]: { state: "running" } }));
      try {
        const r = await api.discoverAccounts({ query: p.params.query });
        const results = r.leads || [];
        setActs((a) => ({ ...a, [p.id]: { state: "done", results, text: results.length ? `Found ${results.length} on the web. They are unverified: check them before you rely on them.` : `Nothing found on the web for “${p.params.query}”. Nothing was charged.` } }));
      } catch (err) {
        setActs((a) => ({ ...a, [p.id]: { state: "error", text: err.message || "The web search didn't finish. Nothing was charged." } }));
      }
      return;
    }
    setActs((a) => ({ ...a, [p.id]: { state: "running" } }));
    try {
      const r = await api.searchCompanies({ filters: p.params.filters, limit: p.params.how_many, offset: 0, exclude_ids: [], sort: "best" });
      const accounts = (r.companies || []).map(asAccount);
      if (!accounts.length) throw new Error("That search has no companies to save.");
      await store.save(accounts, p.params.list_name);
      setActs((a) => ({ ...a, [p.id]: { state: "done", text: `Saved ${accounts.length} to “${p.params.list_name}”.` } }));
    } catch (err) {
      setActs((a) => ({ ...a, [p.id]: { state: "error", text: err.message || "Couldn't save them." } }));
    }
  };

  const onKey = (e) => {
    if (slash.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setSlashIx((i) => (i + (e.key === "ArrowDown" ? 1 : slash.length - 1)) % slash.length); return; }
    if (slash.length && (e.key === "Tab" || e.key === "Enter")) { e.preventDefault(); runCommand(slash[slashIx % slash.length]); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === "Escape") onClose();
  };

  const slash = input.startsWith("/") && !/\s/.test(input) ? (cfg.leads ? COMMANDS : COMMANDS.filter((c) => c.memory || c.cmd === "/remember")).filter((c) => c.cmd.startsWith(input.toLowerCase())) : [];
  const starters = messages.length ? [] : cfg.starters;
  const typed = input.trim().toLowerCase();
  const pool = suggest.length ? suggest : starters;
  const chips = (typed && !slash.length ? pool.filter((c) => c.toLowerCase().includes(typed.split(/\s+/)[0])) : pool).slice(0, 6);
  const saveWeb = async (p, r, i) => {
    const acct = { name: r.name, website: r.site || r.website || "", phone: r.phone || "", notes: r.snippet || "", source: "scout", source_url: r.sourceUrl || r.source_url || "" };
    try { await store.save([acct]); setActs((a) => ({ ...a, [p.id]: { ...a[p.id], saved: { ...(a[p.id]?.saved || {}), [i]: true } } })); } catch { /* the store shows its own error */ }
  };
  const runCommand = (c) => {
    if (c.importer) { setInput(""); onImport?.(); return; }
    if (c.run) { setInput(""); send(c.run); return; }
    if (c.memory) { setInput(""); setView("history"); showHistory(); return; }
    setInput(c.fill || ""); boxRef.current?.focus();
  };
  const forgetMemory = (id) => { setMemory((m) => m.filter((x) => x.id !== id)); api.deleteChatHistory(MEMORY_KEY, id).catch(() => {}); };

  const text = { fontFamily: FONT_BODY, fontSize: 13.5, color: C.ink };
  const muted = { fontFamily: FONT_BODY, fontSize: 12.5, color: C.slate };

  return (
    <div className={page ? "as-wrap as-page" : "as-wrap"} data-leaving={leaving}>
      <aside className="as-panel" aria-label={cfg.name}>
        <style>{css}</style>
        {page ? (
          <nav className="as-side" aria-label="Assistant menu">
            <button type="button" className="as-nav" onClick={fresh}><Plus size={16} aria-hidden="true" /><span>Start new chat</span></button>
            {cfg.leads ? <button type="button" className="as-nav" data-on={view === "context"} onClick={() => setView("context")}><BookOpen size={16} aria-hidden="true" /><span>Context center</span></button> : null}
            <button type="button" className="as-nav" data-on={view === "memory"} onClick={() => setView("memory")}><Brain size={16} aria-hidden="true" /><span>Memory</span></button>
            <div className="as-cap">Chats</div>
            {history.length ? history.map((h) => (
              <button key={h.id} type="button" className="as-nav" title={h.title} data-on={view === "chat" && h.id === chatId.current} onClick={() => openChat(h)}><span>{h.title || "Chat"}</span></button>
            )) : <div style={{ ...muted, padding: "4px 10px" }}>No chats yet.</div>}
          </nav>
        ) : null}
        <div className="as-col">
        {!page ? <div className="as-head">
          <Sparkles size={16} aria-hidden="true" />
          <strong style={{ ...text, fontSize: 14, flex: 1 }}>{view === "history" ? "Earlier chats" : cfg.name}</strong>
          <button type="button" className="as-icon" title="Earlier chats" aria-label="Earlier chats" onClick={() => (view === "history" ? setView("chat") : showHistory())}><Clock size={16} /></button>
          <button type="button" className="as-icon" title="Start a new chat" aria-label="Start a new chat" onClick={fresh}><Plus size={16} /></button>
          {onExpand ? <button type="button" className="as-icon" title="Open full screen" aria-label="Open the assistant full screen" onClick={onExpand}><Maximize2 size={15} /></button> : null}
          <button type="button" className="as-icon" title="Close" aria-label="Close the assistant" onClick={onClose}><X size={16} /></button>
        </div> : null}

        <div className="as-body">
          {view === "context" ? (
            <div style={{ display: "grid", gap: 10 }}>
              <h2 style={{ ...text, fontSize: 18, fontWeight: 600, margin: 0 }}>Context center</h2>
              <p style={{ ...muted, margin: 0 }}>What I know about your business. Every answer, email and search follows it. Give me your website and I will draft it; you check it before it is saved.</p>
              <ProfileSetup editable onSaved={() => { setNeedsProfile(false); loadProfile(); }} />
            </div>
          ) : null}
          {view === "memory" ? (
            <div style={{ display: "grid", gap: 10 }}>
              <h2 style={{ ...text, fontSize: 18, fontWeight: 600, margin: 0 }}>Memory</h2>
              <p style={{ ...muted, margin: 0 }}>Things I should always do for you. I use these in every chat. You can also type /remember in any chat.</p>
              <div style={{ display: "flex", gap: 6 }}>
                <input className="ui-input" aria-label="Something to remember" placeholder="For example: only suggest companies with a website" value={newMemory} maxLength={300}
                  onChange={(e) => setNewMemory(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newMemory.trim()) { remember_(newMemory, true); setNewMemory(""); } }} style={{ flex: 1, minWidth: 0 }} />
                <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!newMemory.trim()} onClick={() => { remember_(newMemory, true); setNewMemory(""); }}>Add</button>
              </div>
              {memory.length ? memory.map((m) => (
                <div key={m.id} className="as-hit" style={{ alignItems: "center" }}>
                  <span style={{ ...text, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{m.text}</span>
                  <button type="button" className="as-icon" title="Forget this" aria-label={`Forget: ${m.text}`} onClick={() => forgetMemory(m.id)}><Trash2 size={14} /></button>
                </div>
              )) : <div style={muted}>Nothing yet. Add something above.</div>}
            </div>
          ) : null}
          {view === "history" ? (
            history.length ? history.map((h) => (
              <div key={h.id} className="as-hit" style={{ alignItems: "center" }}>
                <button type="button" className="ui-link" style={{ ...text, textAlign: "left", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => openChat(h)}>{h.title || "Chat"}</button>
                <span style={muted}>{h.at ? new Date(h.at).toLocaleDateString([], { day: "numeric", month: "short" }) : ""}</span>
                <button type="button" className="as-icon" title="Delete this chat" aria-label={`Delete ${h.title}`} onClick={() => forget(h.id)}><Trash2 size={14} /></button>
              </div>
            )) : <div style={muted}>No earlier chats yet.</div>
          ) : null}
          {view === "history" ? (
            <div>
              <div style={{ ...text, fontWeight: 600, margin: "6px 0 2px" }}>Remembered</div>
              <div style={{ ...muted, marginBottom: 4 }}>Add with /remember. I follow these in every chat.</div>
              {memory.length ? memory.map((m) => (
                <div key={m.id} className="as-hit" style={{ alignItems: "center" }}>
                  <span style={{ ...text, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{m.text}</span>
                  <button type="button" className="as-icon" title="Forget this" aria-label={`Forget: ${m.text}`} onClick={() => forgetMemory(m.id)}><Trash2 size={14} /></button>
                </div>
              )) : <div style={muted}>Nothing yet.</div>}
            </div>
          ) : view === "chat" ? (
            <>
              {!messages.length && page ? (
                <>
                  <div style={{ textAlign: "center", padding: "28px 0 6px" }}>
                    <span className="ld-orb as-orb" aria-hidden="true" style={{ width: 54, height: 54, margin: "0 auto 12px" }}><Sparkles size={24} color="var(--ui-accent, #3457D5)" /></span>
                    <h2 style={{ ...text, fontSize: 22, fontWeight: 600, margin: 0 }}>What can I do for you today?</h2>
                    <p style={{ ...muted, margin: "6px 0 0" }}>Ask in your own words, type / for commands, or start from a preset.</p>
                  </div>
                  <div className="as-pills" role="group" aria-label="Presets">
                    {cfg.presets.map((g) => <button key={g.id} type="button" className="as-pill" data-on={preset === g.id} aria-pressed={preset === g.id} onClick={() => setPreset(preset === g.id ? "" : g.id)}><g.Icon size={14} aria-hidden="true" /> {g.label}</button>)}
                  </div>
                  {(cfg.presets.find((g) => g.id === preset)?.items || []).map((it) => (
                    <button key={it.title} type="button" className="as-row" onClick={() => (it.prompt ? send(it.prompt) : (setInput(it.prefill || ""), boxRef.current?.focus()))}>{it.title}</button>
                  ))}
                  {needsProfile ? <ProfileSetup onSaved={() => { setNeedsProfile(false); loadProfile(); }} /> : null}
                </>
              ) : null}
              {!messages.length && !page ? (
                <>
                  <div style={{ textAlign: "center", padding: "18px 0 4px" }}>
                    <span className="ld-orb as-orb" aria-hidden="true" style={{ width: 54, height: 54, margin: "0 auto 12px" }}><Sparkles size={24} color="var(--ui-accent, #3457D5)" /></span>
                    <h2 style={{ ...text, fontSize: 18, fontWeight: 600, margin: 0 }}>What can I do for you today?</h2>
                    <p style={{ ...muted, margin: "6px 0 0" }}>Ask in your own words, or start with one of these.</p>
                  </div>
                  {cfg.goals.map((g) => (
                    <button key={g.id} type="button" className="as-goal" onClick={() => pick(g)}>
                      <g.Icon size={18} color="var(--ui-accent, #3457D5)" aria-hidden="true" style={{ marginTop: 2, flex: "none" }} />
                      <span><span style={{ ...text, fontWeight: 600, display: "block" }}>{g.title}</span><span style={muted}>{g.note}</span></span>
                    </button>
                  ))}
                  {needsProfile ? <ProfileSetup onSaved={() => { setNeedsProfile(false); loadProfile(); }} /> : null}
                </>
              ) : null}

              {messages.map((m) => (m.role === "user" ? (
                <div key={m.id} className="as-me" style={text}>{m.text}</div>
              ) : (
                <div key={m.id} className="as-bot" style={{ ...text, color: m.error ? C.red : C.ink }}>
                  {m.from ? <div style={{ ...muted, fontSize: 11.5, fontWeight: 600, marginBottom: 2 }}>From the {m.from} assistant</div> : null}
                  <Steps steps={m.steps} tookMs={m.tookMs} />
                  {m.text}
                  {m.error && m.retry ? <div><button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ marginTop: 8 }} disabled={busy} onClick={() => { setMessages((l) => l.filter((x) => x.id !== m.id)); send(m.retry); }}><RotateCcw size={13} aria-hidden="true" /> Try again</button></div> : null}
                  {m.found ? (
                    <div className="as-card">
                      <div style={{ ...text, fontWeight: 600 }}>{m.found.total.toLocaleString()}{m.found.capped ? "+" : ""} {m.found.total === 1 ? "company" : "companies"} found</div>
                      {(m.found.top || []).slice(0, 5).map((c) => (
                        <div key={c.id} className="as-hit">
                          <span style={{ ...text, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                          <span style={{ ...muted, flex: "none" }}>{c.region || ""}</span>
                        </div>
                      ))}
                      {m.found.total > 0 ? <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ marginTop: 8 }} onClick={() => onShowResults?.(m.found.filters)}>Show all in Find Leads</button> : null}
                    </div>
                  ) : null}
                  {(m.proposals || []).map((p) => {
                    if (p.kind === "plan_run") return <PlanCard key={p.id} plan={p.params.run} />;
                    if (p.kind === "workflow") return <WorkflowCard key={p.id} rule={p.params.rule} />;
                    const a = acts[p.id] || {};
                    return (
                      <div key={p.id} className="as-card">
                        <div style={{ ...text, fontWeight: 600, display: "flex", gap: 6, alignItems: "center" }}>
                          {p.kind === "go" || p.kind === "switch" ? <ArrowRight size={15} aria-hidden="true" /> : p.kind === "plan" ? <CalendarClock size={15} aria-hidden="true" /> : p.kind === "web_search" ? <Globe size={15} aria-hidden="true" /> : p.kind === "check_list" ? <ShieldCheck size={15} aria-hidden="true" /> : p.kind === "campaign" ? <Send size={15} aria-hidden="true" /> : p.kind.startsWith("journey_") ? <Route size={15} aria-hidden="true" /> : <ListPlus size={15} aria-hidden="true" />} {p.title}
                        </div>
                        <div style={{ ...muted, margin: "2px 0 8px" }}>{a.text || (p.kind === "web_search" ? `${p.detail} ${webRate == null ? "" : `${creditWord(webRate)} per company found.`}` : p.detail)}</div>
                        {a.state === "done" ? <span style={{ ...muted, color: C.green, display: "inline-flex", gap: 4, alignItems: "center" }}><Check size={14} aria-hidden="true" /> Done</span> : (
                          <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={a.state === "running"} onClick={() => confirm(p)}>
                            {a.state === "running" ? <><Spinner size={13} /> {p.kind === "web_search" ? "Searching the web" : p.kind === "switch" ? "Asking" : p.kind === "call_list" ? "Making the list" : p.kind.startsWith("journey_") ? "Working" : "Saving"}</> : p.kind === "switch" ? (a.state === "error" ? "Try again" : "Switch and ask") : p.kind === "call_list" ? (a.state === "error" ? "Try again" : "Make the list") : p.kind === "go" ? "Open it" : p.kind === "plan" ? "Open the planner" : p.kind === "web_search" ? (a.state === "error" ? "Try again" : "Search the web") : p.kind === "add_to_list" ? (a.state === "error" ? "Try again" : "Save them") : p.kind === "check_list" ? "Open the check" : p.kind === "journey_open" || p.kind === "company_open" ? "Open it" : p.kind === "journey_edit" ? (a.state === "error" ? "Try again" : "Make the change") : p.kind === "journey_people" ? (a.state === "error" ? "Try again" : "Add them") : p.kind === "journey_control" ? (a.state === "error" ? "Try again" : { start: "Start it", pause: "Pause it", stop: "Stop it" }[p.params.action]) : p.kind === "journey_tasks" ? (a.state === "error" ? "Try again" : "Mark them") : "Set up the campaign"}
                          </button>
                        )}
                        {(a.results || []).map((r, i) => {
                          const d = domainOf(r.site || r.website || r.domain || "");
                          return (
                            <div key={i} className="as-hit" style={{ alignItems: "center" }}>
                              <span style={{ minWidth: 0, flex: 1 }}>
                                <span style={{ ...text, fontWeight: 500, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name} <span className="as-tag" title="Found on public web pages. Not checked against the register">web · unverified</span></span>
                                <span style={muted}>{d || "No website found"}{r.phone ? ` · ${r.phone}` : ""}</span>
                              </span>
                              {a.saved?.[i] ? <span style={{ ...muted, color: C.green, display: "inline-flex", gap: 4, alignItems: "center" }}><Check size={14} aria-hidden="true" /> Saved</span>
                                : <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" title="Save this company to your Unsorted list" onClick={() => saveWeb(p, r, i)}><Plus size={14} /> Save</button>}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )))}

              {busy ? (
                <div role="status" aria-live="polite" style={{ ...muted, display: "flex", alignItems: "center", gap: 8 }}>
                  <Spinner size={14} /> <span>{live.status || STAGES[stage]}<span className="as-dots" aria-hidden="true"><i /><i /><i /></span></span>
                  <button type="button" className="ui-link" style={{ marginLeft: "auto" }} onClick={stop}>Stop</button>
                </div>
              ) : null}
              {busy && live.steps.length ? (
                <ol className="as-live" aria-label="What I have done so far">
                  {live.steps.map((s, i) => (
                    <li key={i}><Check size={13} color={C.green} aria-hidden="true" style={{ flex: "none", marginTop: 2 }} /><span><strong>{s.label}</strong>{s.detail ? <> · {s.detail}</> : null}</span></li>
                  ))}
                </ol>
              ) : null}
              <div ref={endRef} />
            </>
          ) : null}
        </div>

        {view === "chat" ? (
          <div className="as-foot">
            {slash.length ? (
              <div className="as-menu" role="listbox" aria-label="Commands">
                {slash.map((c, i) => (
                  <button key={c.cmd} type="button" role="option" aria-selected={i === slashIx % slash.length} className="as-opt" onMouseEnter={() => setSlashIx(i)} onClick={() => runCommand(c)}>
                    <strong style={{ color: C.ink, fontWeight: 600 }}>{c.cmd}</strong><span style={muted}>{c.note}</span>
                  </button>
                ))}
              </div>
            ) : chips.length ? (
              <div className="as-chips" role="group" aria-label="Suggestions" onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY; }}>
                {chips.map((c) => <button key={c} type="button" className="as-chip" title={c} disabled={busy} onClick={() => send(c)}>{c}</button>)}
              </div>
            ) : null}
            <div className="as-box">
              <textarea ref={boxRef} rows={1} value={input} placeholder={cfg.placeholder} aria-label="Message the assistant"
                onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} />
              {mic.supported ? <button type="button" className="as-mic" data-on={mic.listening} aria-pressed={mic.listening} aria-label={mic.listening ? "Stop listening" : "Speak your message"} title={mic.listening ? "Stop listening" : "Speak your message"} onClick={toggleMic}><Mic size={15} /></button> : null}
              {busy ? <button type="button" className="as-send" aria-label="Stop" title="Stop" onClick={stop}><Square size={13} fill="currentColor" /></button>
                : <button type="button" className="as-send" aria-label="Send" disabled={!input.trim()} onClick={() => send()}><ArrowUp size={16} /></button>}
            </div>
            {mic.error ? <div role="alert" style={{ ...muted, color: C.red, marginTop: 6 }}>{mic.error}</div> : mic.listening ? <div role="status" style={{ ...muted, marginTop: 6 }}>Listening… speak, then press the mic again or Send.</div> : null}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {cfg.leads ? <button type="button" role="switch" aria-checked={web} className="as-web" data-on={web} onClick={() => setWeb(!web)}
                title={web ? "Web search is on: the assistant can offer to search public web pages. Results are unverified and cost credits per company found, nothing if none" : `Turn on to let the assistant search public web pages for businesses that are not in the register. ${webRate == null ? "" : `${creditWord(webRate)} per company found, nothing if none.`}`}>
                <Globe size={13} aria-hidden="true" /> Web search <span className="as-web-state">{web ? "On" : "Off"}</span>
              </button> : null}
              {cfg.leads && onImport ? <button type="button" className="as-web" onClick={onImport} title="Bring in your own spreadsheet of companies"><FileSpreadsheet size={13} aria-hidden="true" /> Import</button> : null}
            </div>
            <div style={{ ...muted, fontSize: 11.5, marginTop: 6 }}>{cfg.leads ? (web ? "Register answers are verified. Web results are labelled unverified, and you confirm before they cost anything." : "Answers come from the company register and your own account.") + " " : ""}{cfg.foot}</div>
          </div>
        ) : null}
        </div>
      </aside>
    </div>
  );
}
