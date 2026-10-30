// What a workflow looks like on screen, in words, and what has to be filled in before it can be saved.

export const PLUGIN_NAME = { voice: "Voice", leads: "Leads", social: "Social" };
export const PLUGIN_COLOR = { voice: "#3457D5", leads: "#8B5CF6", social: "#0C8C7D" };
export const STATUS_LABEL = { running: "Running", waiting: "Waiting", done: "Done", failed: "Stopped: a step failed", stopped: "Stopped", skipped: "Skipped" };

export const blankAction = () => ({ type: "action", action: "add_note", value: "" });
export const blankWorkflow = (event = "call.completed") => ({
  name: "", enabled: true, event, when: {}, conditions: [], do: [blankAction()], limits: { reenroll: "every", days: 7, per_day: 100 },
});

const OPS = { is: "is", is_not: "is not", contains: "contains", not_contains: "does not contain" };
export const opLabel = (op) => OPS[op] || op;

export function conditionText(c, meta) {
  const f = meta.condition_fields[c.field];
  return `${f ? f.label : c.field} ${opLabel(c.op)} ${c.value}`;
}

export function blockText(b, meta) {
  if (b.type === "wait") return `Wait ${b.hours >= 24 && b.hours % 24 === 0 ? `${b.hours / 24} day${b.hours === 24 ? "" : "s"}` : `${b.hours} hour${b.hours === 1 ? "" : "s"}`}`;
  if (b.type === "stop") return "Stop";
  if (b.type === "if") return `If ${conditionText(b.cond, meta).toLowerCase()}`;
  return meta.actions[b.action] || b.action;
}

export function summary(w, meta) {
  const info = meta.event_info[w.event];
  const when = `${info ? info.hint : w.event}${w.when?.outcome ? `: ${w.when.outcome.replace(/_/g, " ")}` : ""}`;
  const flow = (w.do || []).map((b) => blockText(b, meta)).join(", then ");
  return `${when} → ${flow}`;
}

const SENTENCE = /^(?:https?:\/\/)[^\s/]+\.[^\s]+$/i;

// The first thing wrong with a workflow, in words, or "". The server checks again; this is so the person is told which block.
export function problem(w, meta) {
  if (!w.name.trim()) return "Give the workflow a name.";
  const info = meta.event_info[w.event];
  if (!info) return "Choose what starts it.";
  for (const c of w.conditions || []) if (!String(c.value || "").trim()) return "Finish the filter, or remove it.";
  const check = (blocks, where) => {
    for (let i = 0; i < blocks.length; i += 1) {
      const b = blocks[i];
      const at = `${where}step ${i + 1}`;
      if (b.type === "wait") { if (!(Number(b.hours) >= 1 && Number(b.hours) <= 720)) return `${at}: wait between 1 hour and 30 days.`; continue; }
      if (b.type === "stop") continue;
      if (b.type === "if") {
        if (!String(b.cond?.value || "").trim()) return `${at}: finish the if.`;
        if (!b.then.length && !b.else.length) return `${at}: add something to do under the if.`;
        const inner = check(b.then, `${at}, yes: `) || check(b.else, `${at}, no: `);
        if (inner) return inner;
        continue;
      }
      if (b.action === "add_dnc") continue;
      if (!String(b.value || "").trim()) return `${at}: ${b.action === "set_stage" ? "choose a stage" : b.action === "webhook" ? "give the web address" : "fill it in"}.`;
      if (b.action === "webhook" && !SENTENCE.test(b.value.trim())) return `${at}: the web address must start with https://.`;
    }
    return "";
  };
  return check(w.do || [], "");
}

export const when = (iso) => {
  if (!iso) return "never";
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
};
