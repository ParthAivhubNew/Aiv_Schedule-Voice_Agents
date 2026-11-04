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
