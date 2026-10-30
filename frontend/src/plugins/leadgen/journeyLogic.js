// What the Journeys page shows, worked out from the server's data. No screens here, so it can be tested on its own.

export const STEP_TYPES = [
  { channel: "email", label: "Email", plugin: "Leads", hint: "Sent for you inside the sending hours" },
  { channel: "call", label: "Call", plugin: "Voice", hint: "Your AI caller rings them", needs: "call_step" },
  { channel: "manual_email", label: "Email to write yourself", plugin: "Leads", hint: "Becomes a task with the text ready" },
  { channel: "call_task", label: "Call task", plugin: "Leads", hint: "A task for you to ring them" },
  { channel: "task", label: "Task", plugin: "Leads", hint: "Anything else you do by hand" },
  { channel: "social_task", label: "Social task", plugin: "Social", hint: "Like, comment or message on social" },
  { channel: "linkedin_task", label: "LinkedIn task", plugin: "Leads", hint: "A reminder: LinkedIn is never automated" },
];

export const TASK_CHANNELS = ["manual_email", "call_task", "task", "social_task", "linkedin_task"];
export const STATUS_WORDS = { draft: "Draft", running: "Running", paused: "Paused", completed: "Finished" };
export const STATUS_TONES = { draft: "slate", running: "green", paused: "amber", completed: "blue" };
export const PERSON_WORDS = {
  active: "In progress", replied: "Replied", booked: "Booked", completed: "Finished", finished: "Finished", unresponsive: "No answer",
  bounced: "Bounced", unsubscribed: "Opted out", suppressed: "Opted out", blocked: "Blocked",
};
export const FINISH_WORDS = {
  replied: "replied", not_interested: "not interested", meeting_booked: "booked a meeting", unsubscribed: "opted out", unresponsive: "never answered",
  interested: "interested on a call", do_not_contact: "asked not to be contacted", stage: "no longer a prospect", bounced: "email bounced", finished: "finished all steps",
};
export const CALL_OUTCOMES = [
  ["connected", "Spoke to them"], ["interested", "Interested"], ["callback_requested", "Call me back"], ["no_answer", "No answer"],
  ["left_voicemail", "Left a voicemail"], ["wrong_number", "Wrong number"], ["rejected", "Not interested"], ["do_not_call", "Don't call again"],
];
export const WEEKDAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];
export const STAGES = [["won", "Won"], ["lost", "Lost"], ["do_not_contact", "Do not contact"], ["meeting", "Meeting booked"], ["interested", "Interested"]];

export const typeOf = (channel) => STEP_TYPES.find((t) => t.channel === channel) || STEP_TYPES[0];

// "after 2 days", "first", "after 3 hours"
export function waitText(step, index) {
  if (index === 0) return "First step";
  const d = step.delay_days || 0;
  const h = step.delay_hours || 0;
  if (!d && !h) return "Straight after";
  return `After ${[d ? `${d} day${d === 1 ? "" : "s"}` : "", h ? `${h} hour${h === 1 ? "" : "s"}` : ""].filter(Boolean).join(" ")}`;
}

// One line saying what a step does.
export function stepLine(step) {
  switch (step.channel) {
    case "email": return step.subject || "Follow-up in the same thread";
    case "manual_email": return step.title || step.subject || "Write an email";
    case "call": return step.goal ? `Call: ${step.goal}` : "AI call";
    default: return step.title || typeOf(step.channel).label;
  }
}

// The numbers under a journey's name, in words. Only what is not zero.
export function headline(results, tasksOpen = 0) {
  if (!results) return "";
  const parts = [];
  const by = results.by_status || {};
  if (results.in_progress) parts.push(`${results.in_progress} in progress`);
  if (by.replied) parts.push(`${by.replied} replied`);
  if (by.booked) parts.push(`${by.booked} booked`);
  if (tasksOpen) parts.push(`${tasksOpen} task${tasksOpen === 1 ? "" : "s"} for you`);
  if (!parts.length) return results.people ? `${results.people} people` : "Nobody in it yet";
  return parts.join(" · ");
}

// A blank step of a type, with the fields that type needs.
export function blankStep(channel, index) {
  const base = { channel, delay_days: index === 0 ? 0 : (channel === "email" || channel === "call" ? 2 : 1), delay_hours: 0, subject: "", body: "", title: "", notes: "", goal: "", condition: "always", voicemail: "hang_up", retries: 0, retry_gap_hours: 24, subject_b: "", body_b: "" };
  if (channel === "email") return { ...base, subject: index === 0 ? "" : "", body: "" };
  if (channel === "call") return { ...base, condition: "no_reply" };
  return base;
}

// What the person must still fix before Start: the red lines from the server, in order.
export const blockers = (preflight) => (preflight || []).filter((p) => p.level === "red");

// The steps as the server wants them: only the fields it reads, in order. Existing steps keep their key so nobody loses their place.
export function stepsForSave(steps) {
  return (steps || []).map((s) => ({
    key: s.key || undefined, channel: s.channel, delay_days: Number(s.delay_days) || 0, delay_hours: Number(s.delay_hours) || 0, subject: s.subject || "", body: s.body || "",
    condition: s.condition || "always", title: s.title || "", notes: s.notes || "", goal: s.goal || "", voicemail: s.voicemail || "hang_up", retries: Number(s.retries) || 0,
    retry_gap_hours: Number(s.retry_gap_hours) || 24, subject_b: s.subject_b || "", body_b: s.body_b || "",
  }));
}

// Moves a step up (-1) or down (+1). Returns the same array when it cannot move. The first step has no wait, so the one that takes its place gets one.
export function moveStep(steps, index, by) {
  const to = index + by;
  if (to < 0 || to >= steps.length) return steps;
  const next = steps.map((s) => ({ ...s }));
  [next[index], next[to]] = [next[to], next[index]];
  next[0] = { ...next[0], delay_days: 0, delay_hours: 0 };
  for (let i = 1; i < next.length; i += 1) {
    if (!next[i].delay_days && !next[i].delay_hours && (next[i].channel === "email" || next[i].channel === "call")) next[i] = { ...next[i], delay_days: 2 };
  }
  return next;
}

// What "skipped" and "added" mean to the person when people are added.
export function addedText(out) {
  const s = out.skipped || {};
  const why = [[s.duplicate, "already in"], [s.do_not_email, "on the do-not-email list"], [s.invalid, "without a valid email"], [s.in_another_journey, "already in another journey"], [s.no_contact, "with no contact details"]]
    .filter(([n]) => n).map(([n, w]) => `${n} ${w}`);
  return `${out.dry_run ? "Would add" : "Added"} ${out.added}.${why.length ? ` Skipped: ${why.join(", ")}.` : ""}`;
}

// Tasks overdue or due today come first.
export const sortTasks = (tasks) => [...(tasks || [])].sort((a, b) => String(a.due_at || "").localeCompare(String(b.due_at || "")));
