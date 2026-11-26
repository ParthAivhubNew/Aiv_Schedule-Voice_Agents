import { hiddenNow, isLate } from "../searchGuard";
import { api } from "../../../api/apiClient";
import { notice } from "../../../utils/notice";
import { SELECT_ALL_LIMIT, asAccount } from "./findLogic";

// Find Leads ticked companies: what is picked, select-all across pages, and saving the picked ones. Moved out of FindLeadsSearch unchanged; it takes what it uses and returns what the screen uses.
export function useSelectionActions({ cardsById, companies, excludedRef, inArea, lastQuery, runId, sel, selKeyRef, setSelecting, store, total }) {
  const pickedRows = [...sel.ids].map((id) => cardsById.current.get(id)).filter(Boolean);
  // A drawn area holds every company it found on screen; a normal search is resolved on the server, up to the limit.
  const selectReach = inArea ? companies.length : Math.min(total, SELECT_ALL_LIMIT);
  const selectAllMatching = async () => {
    if (inArea || !lastQuery.current) { sel.selectAll(companies.map((c) => c.id)); return; }
    setSelecting(true);
    try {
      const started = { run: runId.current, key: selKeyRef.current };
      const q = lastQuery.current;
      const r = await api.searchSelectAll({ ...q, exclude_ids: hiddenNow(q.exclude_ids, excludedRef.current), limit: SELECT_ALL_LIMIT });
      if (isLate(started, { run: runId.current, key: selKeyRef.current })) return; // the filters changed while this was on its way
      (r.companies || []).forEach((c) => { const had = cardsById.current.get(c.id); cardsById.current.set(c.id, had ? { ...had, ...c } : { ...c, slim: true }); });
      sel.selectAll((r.companies || []).map((c) => c.id));
    } catch (err) {
      notice(err.message || "Couldn't select them all. Try again.");
    } finally {
      setSelecting(false);
    }
  };
  const selectedWord = sel.everything ? `All ${sel.count.toLocaleString()} selected` : `${sel.count.toLocaleString()} selected`;
  const bulkSave = async (listName) => {
    const rows = pickedRows;
    if (!rows.length) return;
    const r = await store.save(rows.map(asAccount), listName);
    if (r) sel.clear();
  };
  return { bulkSave, pickedRows, selectAllMatching, selectReach, selectedWord };
}
