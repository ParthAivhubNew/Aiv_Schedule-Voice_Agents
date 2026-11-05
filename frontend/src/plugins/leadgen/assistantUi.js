// The small rules behind the assistant's cards, kept here so they can be tested without drawing anything.

// 3162 -> "3.2K", 1200000 -> "1.2M". Under a thousand it stays exact.
export function compactCount(n) {
  const v = Number(n) || 0;
  const trim = (x) => x.toFixed(1).replace(/\.0$/, "");
  if (v < 1000) return String(v);
  if (v < 10000) return `${trim(v / 1000)}K`;
  if (v < 1000000) return `${Math.round(v / 1000)}K`;
  return `${trim(v / 1000000)}M`;
}

// What the card shows as its size: "3.2K", or "200 of 3.2K" when the person asked for a number smaller than what matched.
export function viewCountText(view) {
  const total = Number(view?.total) || 0;
  const all = `${compactCount(total)}${view?.capped ? "+" : ""}`;
  const asked = Number(view?.asked) || 0;
  return asked && asked < total ? `${compactCount(asked)} of ${all}` : all;
}

export function filtersText(n) {
  const v = Number(n) || 0;
  return v ? `${v} ${v === 1 ? "filter" : "filters"}` : "";
}

// A search answer from before the server sent a card (or a restored one) still gets a card, built from the search it holds.
export function viewFromFound(found) {
  if (!found || !found.total) return null;
  return { kind: "companies", title: "Companies view", summary: "", filter_count: 0, total: found.total, capped: Boolean(found.capped), asked: found.asked || 0, screen: "find_leads" };
}

// "Customize your AI": one sentence naming what is missing, at most two things so it stays short.
export function customizeText(gaps) {
  const list = (gaps || []).slice(0, 2);
  if (!list.length) return "";
  return `Tell me ${list.join(" and ")} so my answers fit your business.`;
}

// Why an answer was wrong. The ids are the ones the server knows.
export const FEEDBACK_REASONS = [
  { id: "wrong_companies", label: "Wrong companies" },
  { id: "wrong_info", label: "Wrong information" },
  { id: "missed_ask", label: "Missed what I asked" },
  { id: "too_long", label: "Too long or slow" },
  { id: "other", label: "Something else" },
];

// What pressing a "pick one" option does: send its words as the next message, open the card's own screen, or open a named screen.
export function choiceAction(choice) {
  if (!choice) return { type: "none" };
  if (choice.prompt) return { type: "send", text: choice.prompt };
  if (choice.open === "view") return { type: "view" };
  if (choice.open) return { type: "screen", hash: choice.open };
  return { type: "none" };
}

// Only the newest answer's pick-one is live, and only until one option is used.
export function liveChoices(messages, used, busy) {
  if (busy) return null;
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant" || !last.choices?.length) return null;
  if (used?.[`choice:${last.id}`]) return null;
  return last;
}

// The person's question an answer belongs to: the nearest user message before it.
export function questionFor(messages, index) {
  for (let i = index - 1; i >= 0; i -= 1) if (messages[i]?.role === "user") return messages[i].text || "";
  return "";
}

// A card that opens a hash screen ("#/voice/logs") versus the Leads results screen.
export const isHashScreen = (screen) => typeof screen === "string" && screen.startsWith("#/");
