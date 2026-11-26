"""A monthly budget per supplier (plan 11, C.2: "vendor budget alerts per provider").

Staff set a budget in US dollars for any supplier on the staff Providers page. What a supplier has cost this calendar month (UTC) comes
from the cost ledger (services/cost_ledger.provider_calls), which holds every paid provider call and every AI call.

- Staff get a BUD-01 alert once a month when a supplier passes 80% of its budget, and again at 100%.
- With "pause at the limit" on, the provider wrapper (providers/gateway.py) stops calling that supplier once it has spent its budget, until
  the month turns or staff raise the budget: the call answers "over_budget", which callers treat like nothing found. It is off by
  default: a budget never cuts clients off unless staff choose that. AI models don't go through the wrapper, so for them it only alerts.
- If the budgets or the spend can't be read, nothing is paused: the alert job tries again later.

Settings: the app setting "provider_budgets" = {"budgets": {provider: {"usd", "pause"}}, "alerted": {provider: {"month", "level"}}}.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text

logger = logging.getLogger("provider_budgets")

SETTING = "provider_budgets"
LEVELS = (80, 100)  # per cent of the budget at which staff hear
STATE_TTL_S = 60

_STATE: Dict[str, Any] = {"at": 0.0, "budgets": {}, "spent": {}}


def month_start(now: Optional[datetime] = None) -> datetime:
    n = now or datetime.utcnow()
    return datetime(n.year, n.month, 1)


def forget() -> None:
    _STATE.update(at=0.0, budgets={}, spent={})


async def _doc(db) -> Dict[str, Any]:
    from app.services.credits import _get_doc

    return await _get_doc(db, SETTING)


def budgets_of(doc: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    out = {}
    for pid, b in (doc.get("budgets") or {}).items():
        try:
            usd = float((b or {}).get("usd") or 0)
        except (TypeError, ValueError):
            continue
        if usd > 0:
            out[str(pid)] = {"usd": round(usd, 2), "pause": bool((b or {}).get("pause"))}
    return out


async def spent_this_month(db, now: Optional[datetime] = None) -> Dict[str, float]:
    """{provider: USD} this calendar month, from the cost ledger, for every organisation. Read under the system scope."""
    from app.core.tenancy import system_scope

    with system_scope():
        rows = (await db.execute(text("SELECT provider, coalesce(sum(cost_usd), 0) FROM provider_calls WHERE at >= :m GROUP BY 1"),
                                 {"m": month_start(now)})).all()
    return {str(p or ""): round(float(c or 0), 4) for p, c in rows if p}


async def save(db, provider: str, usd: Optional[float], pause: bool) -> Dict[str, Any]:
    """Sets one supplier's budget; no amount (or 0) removes it. The caller commits."""
    from app.services.credits import _put_doc

    pid = (provider or "").strip().lower()
    if not pid or len(pid) > 60:
        raise ValueError("Say which supplier.")
    doc = await _doc(db)
    budgets = dict(doc.get("budgets") or {})
    if usd is None or float(usd) == 0:
        budgets.pop(pid, None)
    else:
        if float(usd) < 0 or float(usd) > 1_000_000:
            raise ValueError("A budget is a number of US dollars from 0 to 1,000,000.")
        budgets[pid] = {"usd": round(float(usd), 2), "pause": bool(pause)}
        alerted = dict(doc.get("alerted") or {})
        alerted.pop(pid, None)  # a new budget is judged afresh
        doc["alerted"] = alerted
    doc["budgets"] = budgets
    await _put_doc(db, SETTING, doc)
    forget()
    return budgets.get(pid) or {}


async def overview(db, now: Optional[datetime] = None) -> Dict[str, Any]:
    """For the staff screen: every supplier with a budget or a cost this month, what it has cost, its budget and how far through it is."""
    from app.providers import registry

    budgets = budgets_of(await _doc(db))
    spent = await spent_this_month(db, now)
    names = {p.manifest.id: p.manifest.name for p in registry.all_providers()}
    ids = sorted(set(names) | set(budgets) | {p for p, c in spent.items() if c > 0}, key=lambda p: (-spent.get(p, 0.0), names.get(p, p)))
    rows = []
    for pid in ids:
        b = budgets.get(pid)
        cost = spent.get(pid, 0.0)
        pct = int(round(100 * cost / b["usd"])) if b else None
        state = "" if not b else ("paused" if b["pause"] and cost >= b["usd"] else "over" if cost >= b["usd"] else "near" if pct >= LEVELS[0] else "ok")
        rows.append({"id": pid, "name": names.get(pid, pid), "spentUsd": round(cost, 2), "budgetUsd": b["usd"] if b else None,
                     "pause": bool(b and b["pause"]), "pct": pct, "state": state, "throughWrapper": pid in names})
    return {"month": month_start(now).strftime("%Y-%m"), "providers": rows}


async def _state() -> Tuple[Dict[str, Dict[str, Any]], Dict[str, float]]:
    """(budgets, spend this month), read at most once a minute and shared by every call."""
    if time.monotonic() - _STATE["at"] < STATE_TTL_S:
        return _STATE["budgets"], _STATE["spent"]
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal

    with system_scope():
        async with AsyncSessionLocal() as db:
            budgets = budgets_of(await _doc(db))
            spent = await spent_this_month(db) if any(b["pause"] for b in budgets.values()) else {}
    _STATE.update(at=time.monotonic(), budgets=budgets, spent=spent)
    return budgets, spent


async def paused(provider_id: str) -> bool:
    """True when staff chose to pause this supplier at its budget and this month's cost has reached it. Never raises; False when unsure."""
    try:
        budgets, spent = await _state()
        b = budgets.get(provider_id)
        return bool(b and b["pause"] and spent.get(provider_id, 0.0) >= b["usd"])
    except Exception as err:
        logger.warning(f"[budgets] not checked for {provider_id}: {err}")
        return False


async def check(now: Optional[datetime] = None) -> List[str]:
    """The alert job: a BUD-01 staff alert when a supplier first passes 80% and then 100% of its budget in a month. Returns what was sent."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.services.ai_errors import alert_staff
    from app.services.credits import _put_doc

    sent: List[str] = []
    month = month_start(now).strftime("%Y-%m")
    with system_scope():
        async with AsyncSessionLocal() as db:
            doc = await _doc(db)
            budgets = budgets_of(doc)
            if not budgets:
                return sent
            spent = await spent_this_month(db, now)
            names = {}
            try:
                from app.providers import registry

                names = {p.manifest.id: p.manifest.name for p in registry.all_providers()}
            except Exception:
                pass
            alerted = dict(doc.get("alerted") or {})
            for pid, b in budgets.items():
                cost = spent.get(pid, 0.0)
                pct = 100 * cost / b["usd"]
                level = max((lv for lv in LEVELS if pct >= lv), default=0)
                last = alerted.get(pid) or {}
                already = last.get("level", 0) if last.get("month") == month else 0
                if level and level > already:
                    name = names.get(pid, pid)
                    detail = f"{name} has cost ${cost:,.2f} of its ${b['usd']:,.2f} budget for {month} ({int(pct)}%)."
                    if level >= 100:
                        detail += (" Calls to it are paused until next month or until the budget is raised." if b["pause"]
                                   else " Nothing is paused: switch on \"pause at the limit\" on the Providers page to stop it.")
                    await alert_staff("BUD-01", detail, org_id="platform")
                    alerted[pid] = {"month": month, "level": level}
                    sent.append(f"{pid}:{level}")
            if sent:
                doc["alerted"] = alerted
                await _put_doc(db, SETTING, doc)
                await db.commit()
    return sent
