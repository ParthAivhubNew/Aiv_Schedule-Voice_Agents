// Pure helpers for the corner dock that follows a bulk check and holds the picks waiting for the person.

export const FIELD_WORDS = { phone: "Phone", email: "Email", website: "Website" };

// The one line on the pill. Empty when there is nothing to show. `others` are the jobs running in Social or Voice.
export function dockText(job, pickCount, others = []) {
  const running = job && job.status === "running";
  const need = pickCount > 0 ? `${pickCount} need${pickCount === 1 ? "s" : ""} you` : "";
  const more = others.length ? ` · +${others.length} more` : "";
  if (running) {
    const base = `${job.pause ? "Paused at" : "Checking"} ${job.done} of ${job.total}`;
    return `${base}${need ? ` · ${need}` : ""}${more}`;
  }
  if (need) return `${job && job.status === "done" ? "Done · " : ""}${need}${more}`;
  if (others.length === 1) return `${others[0].title} ${others[0].done} of ${others[0].total}`;
  if (others.length > 1) return `${others.length} jobs running`;
  return "";
}

// Cards not yet skipped come first, so a skipped one never blocks the next.
export function orderCards(cards, skippedNow = []) {
  const skipped = new Set(skippedNow);
  const key = (c) => `${c.account_id}:${c.field}`;
  const rank = (c) => Number(skipped.has(key(c)) || !!c.skipped);
  return [...cards].sort((a, b) => rank(a) - rank(b));
}

// The first option is the search's best guess. The words say so; there is no number.
export const sureWord = (i) => (i === 0 ? "Best guess" : "Also found");
