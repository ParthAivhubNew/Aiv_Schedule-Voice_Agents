// A search pressed while another is still running must not be thrown away: the screen would show the old results beside the
// new filters (a town typed and shown, but the results are UK-wide). Only an exact repeat of the running search is ignored.
// `extra` carries what else changes the answer (sort, tab, words taken out): a new sort is not a repeat.
export const searchKey = (filters, offset, area, extra) => JSON.stringify([filters, offset || 0, area ? 1 : 0, extra || null]);
export const skipRepeat = (busy, force, key, runningKey) => Boolean(busy && !force && key === runningKey);

// The ids to leave out right now: the ones the running search was asked to skip plus any the person has hidden since.
export const hiddenNow = (queryIds, hiddenIds) => [...new Set([...(queryIds || []), ...(hiddenIds || [])])];

// An answer that arrives after the screen moved on (another search, other filters) must be dropped.
export const isLate = (started, now) => started.run !== now.run || started.key !== now.key;

// A card from "Select all" carries only who the company is; whether the register holds more is unknown, not missing.
export const detailMissing = (c) => !c.slim && ["website", "phone", "email"].some((k) => !c[k] && !(c.closed || {})[k]);
