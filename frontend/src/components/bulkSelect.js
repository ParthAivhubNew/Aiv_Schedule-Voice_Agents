import { useCallback, useEffect, useMemo, useState } from "react";

// Ticking rows in a table that has pages, the way a bookkeeping app does it: the header box ticks the page, then
// "Select all N" ticks every matching row on every page. The selection is a set of ids, so the count shown is
// always the set the bulk actions get. `everything` stays true only while nothing has been unticked since.

export const toggleOne = (ids, id) => {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
};

export const pagePicked = (ids, pageIds) => pageIds.length > 0 && pageIds.every((id) => ids.has(id));

// The header box: unticks the page when the whole page is ticked, otherwise ticks the whole page. Other pages keep their ticks.
export const togglePage = (ids, pageIds) => {
  const next = new Set(ids);
  if (pagePicked(ids, pageIds)) pageIds.forEach((id) => next.delete(id));
  else pageIds.forEach((id) => next.add(id));
  return next;
};

// "10,000+" when the total was counted only up to a cap.
export const countText = (n, capped = false) => `${Number(n || 0).toLocaleString()}${capped ? "+" : ""}`;

const noun = (n, unit) => (n === 1 ? unit[0] : unit[1]);

// What the line above the table says, or null when it has nothing to say.
// reach: how many rows "Select all" would really tick (the total, or the most a bulk action takes).
export function selectionLine({ count, everything, pageIds, ids, total, capped = false, reach, unit = ["company", "companies"] }) {
  const all = reach == null ? total : reach;
  if (!count) return null;
  if (everything && count >= all) {
    const more = total > count || capped;
    return {
      text: more
        ? `The first ${count.toLocaleString()} of ${countText(total, capped)} ${unit[1]} are selected. A bulk action takes up to ${count.toLocaleString()} at a time.`
        : `All ${count.toLocaleString()} ${noun(count, unit)} selected.`,
      offer: null,
    };
  }
  const offer = pagePicked(ids, pageIds) && all > count
    ? (all < total || capped ? `Select the first ${all.toLocaleString()}` : `Select all ${all.toLocaleString()}`)
    : null;
  return { text: `${count.toLocaleString()} selected out of ${countText(total, capped)}.`, offer };
}

// resetKey: anything that changes which rows match (filters, search words, the list open). A change clears the ticks.
export function useBulkSelect(resetKey) {
  const [ids, setIds] = useState(() => new Set());
  const [everything, setEverything] = useState(false);
  useEffect(() => { setIds(new Set()); setEverything(false); }, [resetKey]);
  const clear = useCallback(() => { setIds(new Set()); setEverything(false); }, []);
  return useMemo(() => ({
    ids,
    everything,
    count: ids.size,
    has: (id) => ids.has(id),
    toggle: (id) => { setIds((s) => toggleOne(s, id)); setEverything(false); },
    togglePage: (pageIds) => { setIds((s) => togglePage(s, pageIds)); setEverything(false); },
    selectAll: (allIds) => { setIds(new Set(allIds)); setEverything(true); },
    drop: (gone) => { setIds((s) => { const next = new Set(s); gone.forEach((id) => next.delete(id)); return next; }); },
    clear,
  }), [ids, everything, clear]);
}
