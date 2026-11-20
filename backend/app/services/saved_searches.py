"""Saved searches: a Find Leads search kept as a list that fills itself.

Each search remembers the companies it already showed (`seen_ids`), so a run adds only new ones. Saving a company
from the register is free, so a run never charges credits. Stored as one settings document per organisation, like
the lists, so there is no migration.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from app.core.tenancy import current_org
from app.services import credits as credit

logger = logging.getLogger("saved_searches")

MAX_SEARCHES = 50
MAX_ADDS_PER_RUN = 200
MAX_SEEN = 20_000
WEEKLY_EVERY = timedelta(days=7)
MAX_NAME = 80
_MAX_PAGES = 5
_ran_day: Dict[str, str] = {}
_running: set = set()


class SavedSearchError(ValueError):
    pass


def _key(org_id: Optional[str] = None) -> str:
    return f"savedsearches:{org_id or current_org()}"


async def load(db, org_id: Optional[str] = None) -> List[Dict[str, Any]]:
    return list((await credit._get_doc(db, _key(org_id))).get("searches") or [])


async def _save(db, searches: List[Dict[str, Any]], org_id: Optional[str] = None) -> None:
    await credit._put_doc(db, _key(org_id), {"searches": searches})
    await db.commit()


def public(s: Dict[str, Any]) -> Dict[str, Any]:
    """What the screen needs: never the long list of seen ids."""
    return {k: v for k, v in s.items() if k != "seen_ids"} | {"seen": len(s.get("seen_ids") or [])}


def _account(row: Any) -> Any:
    from app.api.lead_accounts import AccountIn

    notes = " · ".join(x for x in (f"Reg no. {row.registration_number}" if row.registration_number else "", row.status, row.sic_text, row.postcode) if x)
    return AccountIn(name=row.name, website=row.website or "", phone=row.phone or "", email=row.email or "", industry=row.industry or "",
                     region=row.region or "", notes=notes, source="scout", business_record_id=row.id,
                     registration_number=row.registration_number or "", postcode=row.postcode or "", address=row.address or "")


async def run_one(db, s: Dict[str, Any], now: Optional[datetime] = None) -> int:
    """Finds companies the search has not shown before and saves them in its list. Returns how many were added."""
    from app.api import lead_accounts as LA
    from app.services import business_records as BR

    now = now or datetime.utcnow()
    seen = list(s.get("seen_ids") or [])
    known = set(seen)
    fresh: List[Any] = []
    offset = 0
    # Only the newest ids are sent as exclusions (the list can hold 20,000), so older ones can come back: read further pages
    # until something new turns up, otherwise a search whose first page is all old would add nothing for ever.
    for _ in range(_MAX_PAGES):
        found = await BR.search_filtered(db, {**(s.get("filters") or {}), "saved": "exclude"}, limit=MAX_ADDS_PER_RUN, offset=offset,
                                         exclude_ids=seen[-5000:], stats=False)
        page = found["rows"]
        for r in page:
            if r.id not in known and len(fresh) < MAX_ADDS_PER_RUN:
                known.add(r.id)
                fresh.append(r)
        offset += len(page)
        if len(fresh) >= MAX_ADDS_PER_RUN or len(page) < MAX_ADDS_PER_RUN:
            break
    added = 0
    if fresh:
        res = await LA.save_accounts(db, LA.AccountsIn(accounts=[_account(r) for r in fresh], list_id=s.get("list_id") or ""), s.get("created_by") or "")
        added = int(res.get("added") or 0)
    s["seen_ids"] = (seen + [r.id for r in fresh])[-MAX_SEEN:]
    s["last_run_at"] = now.isoformat() + "Z"
    s["last_added"] = added
    return added


async def _store_run(db, s: Dict[str, Any], org_id: Optional[str] = None) -> Dict[str, Any]:
    """Writes only what a run changed onto the freshly loaded document, so a rename, a weekly switch or a delete made while the
    run was reading is not undone. A search deleted meanwhile stays deleted."""
    searches = await load(db, org_id)
    cur = next((x for x in searches if x.get("id") == s.get("id")), None)
    if cur is None:
        return s
    for k in ("seen_ids", "last_run_at", "last_added"):
        cur[k] = s.get(k)
    await _save(db, searches, org_id)
    return cur


async def create(db, name: str, filters: Dict[str, Any], list_name: str, weekly: bool, owner: str) -> Dict[str, Any]:
    from app.services import business_records as BR

    searches = await load(db)
    if len(searches) >= MAX_SEARCHES:
        raise SavedSearchError(f"You can keep up to {MAX_SEARCHES} saved searches. Delete one first.")
    name = " ".join((name or "").split())[:MAX_NAME]
    if not name:
        raise SavedSearchError("Give the search a name.")
    try:
        BR.check_filters(filters)
    except ValueError as err:
        raise SavedSearchError(str(err))
    clean = BR.normalize_filters(filters)
    if not BR.has_narrowing(clean):
        raise SavedSearchError("Pick an industry, a place, or a reason to get in touch before saving a search.")
    from app.api.lead_lists import put_in_list

    made = await put_in_list(db, "", (list_name or name), [], owner=owner)
    s = {"id": f"ss_{uuid.uuid4().hex[:10]}", "name": name, "filters": clean, "list_id": made["id"], "weekly": bool(weekly), "seen_ids": [],
         "last_run_at": None, "last_added": 0, "created_by": owner, "created_at": datetime.utcnow().isoformat() + "Z"}
    await run_one(db, s)
    searches = await load(db)
    searches.insert(0, s)
    await _save(db, searches)
    return s


async def run_by_id(db, search_id: str) -> Dict[str, Any]:
    searches = await load(db)
    s = next((x for x in searches if x["id"] == search_id), None)
    if not s:
        raise SavedSearchError("That saved search doesn't exist any more.")
    await run_one(db, s)
    return await _store_run(db, s)


async def weekly(db, org_id: str, now: Optional[datetime] = None) -> int:
    """Once a day per organisation, runs each weekly search that last ran 7 or more days ago, then tells the admins what was added."""
    now = now or datetime.utcnow()
    day = now.date().isoformat()
    if _ran_day.get(org_id) == day or org_id in _running:
        return 0
    _running.add(org_id)
    try:
        return await _weekly_run(db, org_id, now, day)
    finally:
        _running.discard(org_id)


async def _weekly_run(db, org_id: str, now: datetime, day: str) -> int:
    searches = await load(db, org_id)
    total = 0
    lines: List[str] = []
    failed = False
    for s in searches:
        if not s.get("weekly"):
            continue
        last = s.get("last_run_at")
        if last and now - datetime.fromisoformat(str(last).rstrip("Z")) < WEEKLY_EVERY:
            continue
        try:
            n = await run_one(db, s, now)
        except Exception as err:
            logger.warning("saved search %s failed: %s", s.get("id"), err)
            failed = True
            continue
        await _store_run(db, s, org_id)
        total += n
        if n:
            lines.append(f"<b>{n}</b> new {'company' if n == 1 else 'companies'} in {s['name']}")
    if not failed:
        _ran_day[org_id] = day  # a day with a failed search is tried again on the next visit
    if lines:
        from app.core.notify import notify
        from app.config import settings

        base = (getattr(settings, "PUBLIC_BASE_URL", "") or "").rstrip("/")
        await notify("weekly_summary", f"{total} new {'company' if total == 1 else 'companies'} from your saved searches", lines,
                     {"text": "Open the list", "label": "Open the list", "url": base + "/#/leadgen/lists"} if base else None)
    return total
