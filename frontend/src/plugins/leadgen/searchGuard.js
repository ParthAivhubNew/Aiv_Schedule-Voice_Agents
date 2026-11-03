// A search pressed while another is still running must not be thrown away: the screen would show the old results beside the
// new filters (a town typed and shown, but the results are UK-wide). Only an exact repeat of the running search is ignored.
export const searchKey = (filters, offset, area) => JSON.stringify([filters, offset || 0, area ? 1 : 0]);
export const skipRepeat = (busy, force, key, runningKey) => Boolean(busy && !force && key === runningKey);
