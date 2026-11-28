// Pure helpers for Administration > Exclusions: reading what an admin typed, grouping the rules, and the plain lines the confirm dialog shows.
import { formatDate, plural } from "./adminLogic";

export const TITLE = "Exclusions";
export const SUB = "Companies your whole organisation leaves out. Everyone in your organisation sees searches, counts and the public API with these rules applied. Only admins can change them.";
export const EMPTY_LINE = "Nothing is left out yet. Add a rule above and it applies to everyone in your organisation.";
export const NOTHING_TYPED = "Type what to leave out, such as 85200, church or Charity register.";
export const LOAD_FAIL = "Couldn't load the exclusion list. Try again.";
export const SAVE_FAIL = "Couldn't save that. Try again.";
export const INPUT_HELP = "A SIC code (85200, or 47 for every code starting 47), a word in the name (church, charit* for charity and charitable), a category (Places of Worship), a postcode district (BN9), a company number, or a company type. Separate with commas.";
export const KEEP_HELP = "Start with keep: to rescue names that hold a phrase, such as keep: driving school.";

// One tap each. The other register checks are typed ("Companies House only", "Charity register").
export const QUICK_ADDS = [{ label: "Active companies only", text: "Active companies only" }];

// Commas or new lines; a phrase may hold spaces ("driving school").
export const splitItems = (text) => String(text || "").split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean);

const ORDER = ["Register check", "Industry (SIC code)", "Company type", "Word in the name", "Category", "Postcode district", "One company"];
export const KEEP_GROUP = "Always keep";

// [{ title, rules }] in a fixed order; keep rules sit together in their own group at the end.
export function groupRules(rules) {
  const list = Array.isArray(rules) ? rules : [];
  const by = {};
  list.forEach((r) => {
    const key = r.mode === "keep" ? KEEP_GROUP : r.kindLabel || "Other";
    (by[key] ||= []).push(r);
  });
  const known = [...ORDER, KEEP_GROUP];
  const extra = Object.keys(by).filter((k) => !known.includes(k)).sort();
  const order = (a, b) => String(a.value || a.kind).localeCompare(String(b.value || b.kind), "en", { numeric: true, sensitivity: "base" });
  return [...known, ...extra].filter((k) => by[k]).map((k) => ({ title: k, rules: [...by[k]].sort(order) }));
}

export const fmt = (n) => Number(n).toLocaleString("en-GB");

// What a rule is, in a few words, for a button label: "church", "SIC 85200", "Charity register".
export function ruleName(r) {
  if (r.kind === "charity_register") return "Charity register";
  if (r.kind === "status_only") return "Active companies only";
  if (r.kind === "ch_number_only") return "Companies House companies only";
  if (r.kind === "sic") return `SIC ${r.value}`;
  return r.value || r.kindLabel || "rule";
}

export const summaryLine = (data) => {
  const rules = (data && data.rules) || [];
  const on = rules.filter((r) => r.enabled).length;
  const off = rules.length - on;
  if (!rules.length) return "No rules yet";
  return `${plural(on, "rule")} on${off ? `, ${off} switched off` : ""}`;
};

// {all, before, after}: the register with no rules, with the saved rules, and with this change. null when counting took too long.
export function effectLine(p) {
  if (!p || p.all == null || p.before == null || p.after == null) return "";
  const nowOut = p.all - p.before;
  const thenOut = p.all - p.after;
  if (thenOut === nowOut) return "This does not change how many companies are left out.";
  const gap = Math.abs(thenOut - nowOut);
  const more = thenOut > nowOut;
  const share = p.all ? Math.round((thenOut / p.all) * 100) : 0;
  return `${more ? "Leaves out" : "Brings back"} about ${fmt(gap)} ${more ? "more " : ""}companies: ${fmt(thenOut)} of ${fmt(p.all)} (${share}%) would be left out in total.`;
}

// The one short question before a change: what changes, and who it reaches. No counting happens here (see "Check effect").
export const EVERYONE_LINE = "It applies to everyone in your organisation straight away.";

export function addChanges(items) {
  const shown = items.slice(0, 6).map((i) => `Add: ${i}`);
  const rest = items.length - shown.length;
  return [...shown, ...(rest > 0 ? [`and ${plural(rest, "more item")}`] : []), EVERYONE_LINE];
}

export const switchChanges = (rule, turnOn) => [`${turnOn ? "Switch on" : "Switch off"}: ${ruleName(rule)}`, EVERYONE_LINE];

export const removeChanges = (rule) => [`Delete: ${ruleName(rule)}. This cannot be undone`, EVERYONE_LINE];

export const byLine = (r) => {
  const when = r.createdAt ? formatDate(r.createdAt, "") : "";
  const who = r.createdBy === "system" ? "Starting list" : r.createdBy ? `Added by ${r.createdBy}` : "";
  return [who, when].filter(Boolean).join(" · ");
};

const ACTIONS = { "org_exclusion.added": "added", "org_exclusion.changed": "changed", "org_exclusion.removed": "removed", "exclusions.moved_to_rules": "moved the starting list into rules" };

// One sentence for an audit row: "boss@fsb.example added 3 rules (sic:85200, name_word:church) on 02-12-2026".
export function historyLine(e) {
  const verb = ACTIONS[e.action] || "changed the list";
  const who = e.actor_name || "Someone";
  const d = e.detail || {};
  let what = "";
  if (e.action === "org_exclusion.added") what = ` ${plural(Number(d.added) || 0, "rule")}${d.items ? ` (${d.items})` : ""}`;
  else if (e.action === "org_exclusion.changed") what = e.target ? ` ${e.target}${d.to && d.to !== "no change" ? `: ${d.from} to ${d.to}` : ""}` : "";
  else if (e.action === "org_exclusion.removed") what = e.target ? ` ${e.target}` : "";
  const when = e.at ? ` on ${formatDate(e.at, "")}` : "";
  return `${who} ${verb}${what}${when}`.replace(/\s+/g, " ").trim();
}
