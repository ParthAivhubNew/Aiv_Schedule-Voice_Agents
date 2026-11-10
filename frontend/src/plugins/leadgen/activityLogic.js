// Words for a company's Activity tab and its journey control: what each thing does, what it needs, and why it is off.
// Pure, so the tests can read every sentence a person sees.

export const ACTIVITY_INTRO = "Everything that has happened with this company: calls, emails, meetings, posts and notes. Start one from the buttons below.";

// ---------------------------------------------------------------- stage
export const STAGE_INTRO = "Where this company is with you. It moves on by itself after a call, a reply to your email or a booked meeting. You can also set it yourself.";

export const STAGE_TIPS = {
  new: "New: saved, with no call, reply or meeting yet.",
  contacted: "Contacted: you called them, or they replied to an email.",
  interested: "Interested: they asked for a call back or said they want to hear more.",
  meeting: "Meeting: a meeting is booked with them.",
  won: "Won: they became a customer. Only you can set this.",
  lost: "Not interested: they said no on a call, or you set it.",
  do_not_contact: "Do not contact: they asked not to be contacted. Calls to them are held back.",
};

// ---------------------------------------------------------------- worth a call
export function scoreBand(score) {
  const n = Number(score) || 0;
  return n >= 60 ? "high" : n >= 30 ? "medium" : "low";
}

export const SCORE_WHY = "Worked out from what you hold and what has happened: a checked email and phone number, a named contact, "
  + "the stage, the last call's result, email opens and replies, and likes or comments on your posts. Higher means easier to reach and more interested.";

// ---------------------------------------------------------------- the actions
// lead: { stage, can_call, blocked_reason } (from the timeline, else the saved company's connection).
// find: where this screen lets you look for a missing phone or email: { text, tab }.
// Each state: { ok, reason, fix, fixTab, plan } (plan: the fix is adding Voice).
const DNC = { ok: false, reason: "On your do-not-contact list.", fix: "If they agreed to hear from you again, change the stage below." };

export function callState({ lead = {}, phone = "", voice = {} } = {}) {
  const stage = lead.stage || "new";
  if (stage === "do_not_contact" || lead.blocked_reason === "do_not_contact") return DNC;
  if (lead.blocked_reason === "no_phone" || (!phone && lead.can_call !== true)) return { ok: false, reason: "No phone number yet.", fix: "" };
  if (lead.blocked_reason === "failed_check") return { ok: false, reason: "The phone number failed the check.", fix: "Find a working number first." };
  if (voice.loading) return { ok: false, reason: "Checking your plan.", fix: "" };
  if (!voice.available) return { ok: false, reason: "Add Voice to your plan to call.", fix: "", plan: true };
  return { ok: true, reason: "", fix: "" };
}

export function emailState({ lead = {}, email = "" } = {}) {
  if ((lead.stage || "") === "do_not_contact") return DNC;
  if (!String(email || "").trim()) return { ok: false, reason: "No email address yet.", fix: "" };
  return { ok: true, reason: "", fix: "" };
}

export function bookingState({ lead = {}, booking = {} } = {}) {
  if ((lead.stage || "") === "do_not_contact") return DNC;
  if (booking.loading) return { ok: false, reason: "Checking your plan.", fix: "" };
  if (!booking.available) return { ok: false, reason: "Add Voice to your plan to book meetings and share your times.", fix: "", plan: true };
  return { ok: true, reason: "", fix: "" };
}

// A missing phone or email points to where this screen can find one.
export function withFind(state, find) {
  if (state.ok || state.fix || state.plan || !find?.text) return state;
  if (!/^No (phone|email)/.test(state.reason)) return state;
  return { ...state, fix: find.text, fixTab: find.tab || "" };
}

export const ACTION_WORDS = {
  call: { label: "Call", does: "Your AI caller phones them now, using what you know about the company, and can book a meeting in your calendar. Follow it on the Live page in Voice." },
  email: { label: "Write an email", does: "Opens a new message to them in Mail with their address filled in." },
  meeting: { label: "Book a meeting", does: "Pick a date and time. It goes in your calendar, they get an invitation, and it shows on the timeline." },
  link: { label: "Copy booking link", does: "A link they can use to pick a time with you." },
  times: { label: "Copy times to reply with", does: "Your free times, in their time zone, ready to paste into a reply." },
};

// One sentence for a button's tooltip: what it does, or why it is off and how to fix it.
export function actionTip(key, state) {
  const does = ACTION_WORDS[key]?.does || "";
  if (!state || state.ok) return does;
  return [state.reason, state.fix].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- timeline filters
export const KIND_FILTERS = [
  { kind: "", label: "All", tip: "Everything that has happened with this company, newest first.", empty: "Nothing has happened with this company yet. Start a call, an email or a meeting with the buttons above." },
  { kind: "call", label: "Calls", tip: "Calls made to or from this company, with what came of each. Start one with Call above.", empty: "No calls yet. Start one with Call above.", action: "call" },
  { kind: "email", label: "Emails", tip: "Emails sent to them, when they opened one, and their replies. Write one with Write an email above.", empty: "No emails yet. Write one with Write an email above, or add them to an email journey.", action: "email" },
  { kind: "meeting", label: "Meetings", tip: "Meetings booked with them, by you, by your AI caller, or by them through your booking link. Book one with Book a meeting above.", empty: "No meetings yet. Book one with Book a meeting above, or send them your booking link.", action: "meeting" },
  { kind: "post", label: "Posts", tip: "When they like or comment on your social posts, or social listening finds them. These arrive by themselves.", empty: "Nothing from social posts yet. When they like or comment on one of your posts, it shows here by itself." },
  { kind: "note", label: "Notes", tip: "Notes your team wrote on this company. Add one with the box below or on the Notes tab.", empty: "No notes yet. Add one with the box below or on the Notes tab.", action: "note" },
];

export function kindCount(counts, kind) {
  const c = counts || {};
  if (!kind) return Object.values(c).reduce((sum, n) => sum + (Number(n) || 0), 0);
  return Number(c[kind]) || 0;
}

export function pillText(label, count) {
  return `${label} ${Number(count) || 0}`;
}

export function filterFor(kind) {
  return KIND_FILTERS.find((f) => f.kind === (kind || "")) || KIND_FILTERS[0];
}

// ---------------------------------------------------------------- journeys
export const JOURNEY_WHY = "A journey sends this company a planned series of emails and tasks, and stops by itself when they reply.";
export const JOURNEY_AFTER = "They start at step 1. Emails go from your connected mailbox.";
export const JOURNEY_NONE = "You have no journeys yet. Create one in Journeys.";

const PERSON_WORD = { completed: "finished", replied: "replied", bounced: "email bounced", unsubscribed: "unsubscribed", paused: "paused", stopped: "stopped", booked: "meeting booked" };
const JOURNEY_STATUS = { running: "running", draft: "not started", paused: "paused", completed: "finished", stopped: "stopped" };

export function journeyStatusWord(status) {
  return JOURNEY_STATUS[status] || status || "";
}

// "In journey: Intro · step 2 of 4" / "In journey: Intro · replied" / "Not in a journey yet".
export function journeyLine(j) {
  if (!j) return "Not in a journey yet";
  let state;
  if (j.person_status === "active") {
    if (j.status && j.status !== "running") state = `step ${j.step || 1}, journey ${journeyStatusWord(j.status)}`;
    else state = j.step ? (j.steps_total ? `step ${j.step} of ${j.steps_total}` : `step ${j.step}`) : "running";
  } else {
    state = PERSON_WORD[j.person_status] || j.person_status || journeyStatusWord(j.status);
  }
  return `In journey: ${j.name}${state ? ` · ${state}` : ""}`;
}

export function journeyOption(j) {
  const n = Number(j?.step_count) || 0;
  const steps = n ? `${n} ${n === 1 ? "step" : "steps"}` : "no steps yet";
  return `${steps} · ${journeyStatusWord(j?.status)}`;
}

export function addedMessage(company, result = {}) {
  const who = company || "This company";
  const where = result.journey || "the journey";
  if (result.status === "running") return `Added ${who} to ${where}. Step 1 goes out at the journey's next sending time.`;
  return `Added ${who} to ${where}. Nothing is sent until you start the journey in Journeys.`;
}
