"""What Telnyx charged us for each organisation, next to what we charged it (pay-as-you-go).

On pay-as-you-go every organisation draws on our one Telnyx balance, and our app decides what
each pays (credits, bought through Stripe). This puts side by side, for a calendar month:
- Telnyx's cost for the organisation's billing group, from Telnyx's usage reports, and the
  minutes Telnyx billed;
- the call minutes we billed the organisation (our ledger) and what it paid us for Voice;
so staff can see that the two agree and what the margin is. Products whose usage Telnyx cannot
break out by billing group (Telnyx could not confirm this for Voice AI) are shown as totals
for the whole account, never guessed per organisation.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func, text
from sqlalchemy.future import select

from app.services.telnyx_client import TelnyxClient, TelnyxError, platform_key

logger = logging.getLogger("telnyx_usage")


def month_range(month: str) -> Tuple[datetime, datetime]:
    """"2026-09" -> 1 Sep 2026 00:00 (inclusive) to 1 Oct 2026 00:00 (exclusive), UTC."""
    year, mon = (int(x) for x in month.split("-"))
    start = datetime(year, mon, 1)
    end = datetime(year + (mon == 12), mon % 12 + 1, 1)
    return start, end


def _num(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


async def telnyx_costs(month: str) -> Dict[str, Any]:
    """Telnyx's cost for the month: per billing group, and per product for what it cannot split."""
    start, end = month_range(month)
    span = (start.strftime("%Y-%m-%dT00:00:00+00:00"), end.strftime("%Y-%m-%dT00:00:00+00:00"))
    client = TelnyxClient(platform_key())
    options = await client.usage_report_options()
    by_group: Dict[str, Dict[str, float]] = {}
    unattributed: List[Dict[str, Any]] = []
    errors: List[str] = []
    gate = asyncio.Semaphore(4)

    async def one(opt: Dict[str, Any]) -> None:
        product = str(opt.get("product") or "")
        dims = set(opt.get("product_dimensions") or [])
        metrics = set(opt.get("product_metrics") or [])
        if not product or "cost" not in metrics:
            return
        wanted = ["cost"] + (["billed_sec"] if "billed_sec" in metrics else [])
        currency = ["currency"] if "currency" in dims else []
        try:
            async with gate:
                if "billing_group_id" in dims:
                    rows = await client.usage_report(product, ["billing_group_id"] + currency, wanted, *span)
                else:
                    rows = await client.usage_report(product, currency, ["cost"], *span)
        except TelnyxError as err:
            errors.append(f"{product}: {err}")
            return
        if "billing_group_id" in dims:
            for r in rows:
                group = str(r.get("billing_group_id") or "")
                slot = by_group.setdefault(group, {"cost": 0.0, "billed_sec": 0.0})
                slot["cost"] += _num(r.get("cost"))
                slot["billed_sec"] += _num(r.get("billed_sec"))
                slot["currency"] = str(r.get("currency") or slot.get("currency") or "usd").lower()
        else:
            cost = sum(_num(r.get("cost")) for r in rows)
            if cost:
                unattributed.append({"product": product, "cost": round(cost, 4),
                                     "currency": str((rows[0] if rows else {}).get("currency") or "usd").lower()})

    await asyncio.gather(*(one(o) for o in options))
    # No billing group ("") is usage on our account outside every customer's billing group.
    loose = by_group.pop("", None)
    if loose and loose["cost"]:
        unattributed.append({"product": "outside every billing group", "cost": round(loose["cost"], 4), "currency": loose.get("currency", "usd")})
    return {"byGroup": by_group, "unattributed": sorted(unattributed, key=lambda u: -u["cost"]), "errors": errors}


def _fx(cost_currency: str, paid_currency: str) -> Optional[float]:
    """Multiplier turning Telnyx's currency into what customers pay in (FX_USD_TO_GBP, e.g. 0.79)."""
    if cost_currency == paid_currency:
        return 1.0
    if (cost_currency, paid_currency) == ("usd", "gbp"):
        try:
            rate = float(os.getenv("FX_USD_TO_GBP", "") or 0)
            return rate or None
        except ValueError:
            return None
    return None


async def margin_report(month: str) -> Dict[str, Any]:
    """One row per organisation on our Telnyx account, for staff."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.models.models import CreditEntry, CreditGrant, OrgTelnyx

    start, end = month_range(month)
    costs = await telnyx_costs(month)
    with system_scope():
        async with AsyncSessionLocal() as db:
            setups = (await db.execute(select(OrgTelnyx).where(OrgTelnyx.billing_group_id != ""))).scalars().all()
            names = dict((await db.execute(text("SELECT id, name FROM organizations"))).all())
            minutes = dict((await db.execute(
                select(CreditEntry.org_id, func.sum(CreditEntry.quantity))
                .where(CreditEntry.kind == "usage", CreditEntry.item == "voice_minute",
                       CreditEntry.created_at >= start, CreditEntry.created_at < end)
                .group_by(CreditEntry.org_id))).all())
            paid_rows = (await db.execute(
                select(CreditGrant.org_id, CreditGrant.paid_currency, func.sum(CreditGrant.paid_cents))
                .where(CreditGrant.wallet == "voice", CreditGrant.paid_cents > 0,
                       CreditGrant.created_at >= start, CreditGrant.created_at < end)
                .group_by(CreditGrant.org_id, CreditGrant.paid_currency))).all()
    paid: Dict[str, Dict[str, int]] = {}
    for org_id, currency, cents in paid_rows:
        paid.setdefault(org_id, {})[currency or "gbp"] = int(cents or 0)

    rows = []
    for s in setups:
        cost = costs["byGroup"].get(s.billing_group_id, {})
        cost_value, cost_currency = round(cost.get("cost", 0.0), 4), cost.get("currency", "usd")
        received = paid.get(s.org_id, {})
        paid_currency = next(iter(received), "gbp")
        paid_value = received.get(paid_currency, 0) / 100
        rate = _fx(cost_currency, paid_currency)
        margin = round(paid_value - cost_value * rate, 2) if rate is not None and len(received) <= 1 else None
        rows.append({
            "orgId": s.org_id, "name": names.get(s.org_id, s.org_id), "billingGroupId": s.billing_group_id,
            "minutesBilled": round(float(minutes.get(s.org_id) or 0)), "telnyxMinutes": round(cost.get("billed_sec", 0.0) / 60),
            "telnyxCost": cost_value, "telnyxCurrency": cost_currency,
            "paid": round(paid_value, 2), "paidCurrency": paid_currency,
            "margin": margin, "marginPct": round(100 * margin / paid_value) if margin is not None and paid_value else None,
        })
    rows.sort(key=lambda r: -r["telnyxCost"])
    return {"month": month, "rows": rows, "unattributed": costs["unattributed"], "errors": costs["errors"],
            "fxUsdToGbp": os.getenv("FX_USD_TO_GBP", "") or None}


# ── Monthly voice reconciliation ───────────────────────────────────────────
# Once a month (from the 2nd, when Telnyx's report has caught up) the minutes Telnyx billed
# each customer's billing group are checked against the minutes we charged in credits. A gap
# above GAP_MINUTES and GAP_SHARE is flagged to staff (owner-portal banner and email). The
# result is kept, one document per month, so it can be looked back on.
RECON_KEY = "voice_reconciliation"
GAP_MINUTES = 5
GAP_SHARE = 0.05
RECON_FROM_DAY = 2


def previous_month(now: Optional[datetime] = None) -> str:
    now = now or datetime.utcnow()
    return f"{now.year - (now.month == 1)}-{(now.month - 2) % 12 + 1:02d}"


def flag(row: Dict[str, Any]) -> bool:
    ours, theirs = row["minutesBilled"], row["telnyxMinutes"]
    gap = abs(theirs - ours)
    return gap > GAP_MINUTES and gap > GAP_SHARE * max(ours, theirs)


async def saved_reconciliation(db, month: str) -> Optional[Dict[str, Any]]:
    from app.services.credits import _get_doc

    return (await _get_doc(db, RECON_KEY)).get(month)


async def reconcile(month: str) -> Dict[str, Any]:
    """Check one month and keep the result. Raises TelnyxError when Telnyx cannot be read."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.services import ai_errors
    from app.services.credits import _get_doc, _put_doc

    report = await margin_report(month)
    rows = []
    for r in report["rows"]:
        gap = r["telnyxMinutes"] - r["minutesBilled"]
        rows.append({**r, "gapMinutes": gap, "flagged": flag(r)})
    result = {"month": month, "at": datetime.utcnow().isoformat(timespec="seconds"), "rows": rows,
              "flagged": sum(1 for r in rows if r["flagged"]), "unattributed": report["unattributed"],
              "errors": report["errors"]}
    with system_scope():
        async with AsyncSessionLocal() as db:
            doc = await _get_doc(db, RECON_KEY)
            doc[month] = result
            # Keep two years.
            for old in sorted(doc)[:-24]:
                doc.pop(old, None)
            await _put_doc(db, RECON_KEY, doc)
            await db.commit()
    for r in rows:
        if r["flagged"]:
            more = "Telnyx billed more than we charged" if r["gapMinutes"] > 0 else "We charged more than Telnyx billed"
            await ai_errors.alert_staff(
                "BILL-01", f"{month}: {r['name']} — {more}: Telnyx {r['telnyxMinutes']} min, credits {r['minutesBilled']} min "
                f"(gap {r['gapMinutes']:+d}). Check the call logs and settle runs for that month.", org_id=r["orgId"])
    return result


async def reconcile_due() -> Optional[str]:
    """Check last month once, from the RECON_FROM_DAY of this month. Returns the month checked."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal

    if not platform_key() or datetime.utcnow().day < RECON_FROM_DAY:
        return None
    month = previous_month()
    with system_scope():
        async with AsyncSessionLocal() as db:
            if await saved_reconciliation(db, month):
                return None
    try:
        await reconcile(month)
    except TelnyxError as err:
        logger.warning(f"[telnyx-usage] reconciliation for {month} postponed: {err}")
        return None
    return month
