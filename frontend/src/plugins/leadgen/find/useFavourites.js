import { useMemo } from "react";
import { domainOf } from "../accounts/accountsLogic";
import { FAVOURITES } from "./findLogic";

// Find Leads favourites (an ordinary list called Favourites) and each company card's saved / favourite status. Moved out of FindLeadsSearch unchanged.
export function useFavourites({ listsStore, store }) {
  const favKeys = useMemo(() => {
    const fav = (listsStore?.lists || []).find((l) => l.name.toLowerCase() === FAVOURITES.toLowerCase());
    const ids = new Set(fav?.ids || []);
    return new Set(store.accounts.filter((a) => ids.has(a.id)).flatMap((a) => [a.business_record_id, a.domain, a.name.toLowerCase()]).filter(Boolean));
  }, [listsStore?.lists, store.accounts]);
  const isFavourite = (c) => {
    const d = domainOf(c.website);
    return favKeys.has(c.id) || (d ? favKeys.has(d) : favKeys.has(String(c.name || "").toLowerCase()));
  };
  return { isFavourite };
}
