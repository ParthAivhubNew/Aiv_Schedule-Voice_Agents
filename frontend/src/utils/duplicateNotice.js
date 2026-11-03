// Companies that were not added again because they are already saved. Whoever saves or adds companies announces them here, and one
// notice (hub/DuplicatesNotice.jsx) tells the person how many and shows each one next to the company it matched.
export const DUPLICATES_EVENT = "leads-duplicates";

// kind "save": { total, pairs: [{ duplicate, original, why }] }.  kind "list": { total, items: [company] }.
export function announceDuplicates(detail) {
  if (!detail || !(detail.total > 0)) return;
  try { window.dispatchEvent(new CustomEvent(DUPLICATES_EVENT, { detail })); } catch { /* nothing is listening */ }
}

// Joins a new announcement onto the open one, so a file saved in several batches shows as one notice.
export function mergeDuplicates(open, next) {
  if (!open || open.kind !== next.kind) return { ...next };
  const cap = 300;
  return {
    kind: next.kind,
    total: (open.total || 0) + (next.total || 0),
    pairs: [...(open.pairs || []), ...(next.pairs || [])].slice(0, cap),
    items: [...(open.items || []), ...(next.items || [])].slice(0, cap),
  };
}
