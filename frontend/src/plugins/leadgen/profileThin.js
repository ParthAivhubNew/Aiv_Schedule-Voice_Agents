// Whether the business profile is too thin for the assistant to be useful, so it asks for a website to read.
// The company name and what it sells are the minimum; beyond them, at least three of the six profile fields must be filled
// (company, website, what it sells, who buys, the offer, the tone). Services saved under About your business count as "what it sells".
const FIELDS = ["company", "website", "sells", "audience", "offer", "tone"];
const filled = (v) => typeof v === "string" && v.trim() !== "";

export function profileIsThin(res) {
  const p = res?.profile || {};
  const edit = res?.edit || {};
  const has = (k) => filled(p[k]) || filled(edit[k]) || (k === "sells" && Number(res?.services) > 0);
  if (!has("company") || !has("sells")) return true;
  return FIELDS.filter(has).length < 3;
}

// What the "Customize your AI" nudge asks for: the core facts the assistant uses to judge which companies fit. The website and tone are
// optional, so they never trigger the nudge. Each entry is the words the nudge uses.
const CORE = [["company", "your company name"], ["sells", "what you sell"], ["audience", "who buys it"], ["offer", "your main offer"]];

export function profileGaps(res) {
  const p = res?.profile || {};
  const edit = res?.edit || {};
  const has = (k) => filled(p[k]) || filled(edit[k]) || (k === "sells" && Number(res?.services) > 0);
  return CORE.filter(([k]) => !has(k)).map(([, label]) => label);
}
