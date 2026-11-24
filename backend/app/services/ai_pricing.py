"""Real per-unit provider cost: one table (ProviderPrice) that every AI/vendor cost figure in
the platform reads from, instead of each file hardcoding its own guess.

A provider+model combination never seen before gets a blank placeholder row (price $0,
confirmed=False) the first time it is actually used -- no code change is ever needed to
"support" a new model, only a price typed in once staff notices it waiting on the Model Pricing
screen. cost_usd on each AiUsage row is computed and stored at call time, so editing a price
later never rewrites history.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import AiUsage, ProviderPrice

logger = logging.getLogger("ai_pricing")

KINDS = ("llm", "image", "tts", "stt", "lookup")


async def _price_row(db: AsyncSession, provider: str, model: str, kind: str) -> ProviderPrice:
    provider, model = (provider or "").strip().lower(), (model or "").strip()
    row = (await db.execute(select(ProviderPrice).where(
        ProviderPrice.provider == provider, ProviderPrice.model == model, ProviderPrice.kind == kind
    ))).scalars().first()
    if row:
        return row
    row = ProviderPrice(id=f"pp_{uuid.uuid4().hex[:12]}", provider=provider, model=model, kind=kind,
                        price_in_usd=0.0, price_out_usd=0.0, confirmed=False)
    db.add(row)
    await db.flush()
    logger.info(f"[ai_pricing] New provider/model seen: {provider}/{model or '-'} ({kind}). Waiting for a price.")
    return row


def _cost(price: ProviderPrice, kind: str, input_tokens: int, output_tokens: int, units: float) -> tuple:
    if not price.confirmed and price.price_in_usd == 0 and price.price_out_usd == 0:
        return 0.0, False
    if kind == "llm":
        return (input_tokens / 1000.0) * price.price_in_usd + (output_tokens / 1000.0) * price.price_out_usd, True
    if kind == "tts":
        return (units / 1000.0) * price.price_in_usd, True  # units = characters
    # image, stt (minutes), lookup (calls): one flat per-unit price
    return units * price.price_in_usd, True


async def record_usage(
    db: AsyncSession, *, plugin: str, kind: str, provider: str, model: str = "",
    input_tokens: int = 0, output_tokens: int = 0, units: float = 0.0,
) -> float:
    """Logs one AI call's real usage and returns its cost in USD (0.0 if not yet priced). Never
    raises -- this is telemetry, not something that should ever break the call it's measuring."""
    try:
        price = await _price_row(db, provider, model, kind)
        cost_usd, priced = _cost(price, kind, input_tokens, output_tokens, units)
        db.add(AiUsage(id=f"au_{uuid.uuid4().hex[:12]}", plugin=plugin, kind=kind, provider=(provider or "").strip().lower(),
                       model=(model or "").strip(), input_tokens=input_tokens, output_tokens=output_tokens,
                       units=units, cost_usd=round(cost_usd, 6), priced=priced))
        await db.flush()
        return cost_usd
    except Exception as err:
        logger.warning(f"[ai_pricing] usage not recorded ({provider}/{model}): {err}")
        return 0.0


async def price_per_call(db: AsyncSession, provider: str) -> float:
    """The $ per call for a "lookup" vendor (email finders, Tavily, Telnyx number lookup), for
    callers that keep their own usage ledger already (e.g. EnrichmentAttempt) and just need the
    price, not a second AiUsage row. Returns 0.0 if nobody has priced this provider yet."""
    row = await _price_row(db, provider, "", "lookup")
    return row.price_in_usd if (row.confirmed or row.price_in_usd) else 0.0


async def lookup_cost(db: AsyncSession, provider: str, found: bool) -> float:
    """What one lookup cost us: its price when it found something, and also when it didn't if the vendor bills every search
    (billing "per_search", set per provider on Model Pricing from its contract). 0.0 while unpriced."""
    row = await _price_row(db, provider, "", "lookup")
    if not (row.confirmed or row.price_in_usd):
        return 0.0
    return row.price_in_usd if found or (row.billing or "per_find") == "per_search" else 0.0


async def list_prices(db: AsyncSession):
    waiting = {(x["provider"], x["model"], x["kind"]): x["calls"] for x in await unpriced_in_use(db)}  # also adds Apollo's row once it is used
    rows = (await db.execute(select(ProviderPrice).order_by(ProviderPrice.kind, ProviderPrice.provider, ProviderPrice.model))).scalars().all()
    return [{"id": r.id, "provider": r.provider, "model": r.model, "kind": r.kind,
             "priceIn": r.price_in_usd, "priceOut": r.price_out_usd, "confirmed": bool(r.confirmed),
             "unpricedCalls30d": waiting.get((r.provider, r.model or "", r.kind), 0),  # calls counted as $0 because no price is set
             "billing": (r.billing or "per_find") if r.kind == "lookup" else None,
             "updatedAt": r.updated_at.isoformat() if r.updated_at else None, "updatedBy": r.updated_by} for r in rows]


BILLING = ("per_find", "per_search")


async def set_price(db: AsyncSession, price_id: str, price_in: float, price_out: float, by: str, billing: str = "") -> dict:
    row = (await db.execute(select(ProviderPrice).where(ProviderPrice.id == price_id))).scalars().first()
    if not row:
        raise ValueError("That provider/model price was not found.")
    if billing and billing not in BILLING:
        raise ValueError("Billing is per_find or per_search.")
    row.price_in_usd, row.price_out_usd = max(0.0, price_in), max(0.0, price_out)
    if billing:
        row.billing = billing
    row.confirmed, row.updated_by, row.updated_at = True, by, datetime.utcnow()
    await db.flush()
    return {"id": row.id, "priceIn": row.price_in_usd, "priceOut": row.price_out_usd, "billing": row.billing or "per_find", "confirmed": True}


async def monthly_cost(db: AsyncSession, month: str) -> dict:
    """Real $ this org actually cost us this month, by provider/model -- from recorded AiUsage,
    not a guess. Used to compare against what was charged (the rate-card credits)."""
    from app.services.revenue import month_range

    start, end = month_range(month)
    rows = (await db.execute(select(AiUsage).where(AiUsage.created_at >= start, AiUsage.created_at < end))).scalars().all()
    out = {}
    for r in rows:
        key = f"{r.provider}:{r.model or '-'}:{r.kind}"
        d = out.setdefault(key, {"provider": r.provider, "model": r.model, "kind": r.kind, "calls": 0, "costUsd": 0.0, "unpriced": 0})
        d["calls"] += 1
        d["costUsd"] += r.cost_usd
        if not r.priced:
            d["unpriced"] += 1
    for d in out.values():
        d["costUsd"] = round(d["costUsd"], 4)
    return {"month": month, "items": sorted(out.values(), key=lambda d: -d["costUsd"])}


# ── Providers used while no price is set ──────────────────────────────────────
PRICE_ALERT_KEY = "price_alert"
PRICE_ALERT_EVERY_H = 24


async def unpriced_in_use(db: AsyncSession, days: int = 30) -> list:
    """[{provider, model, kind, calls}] for every paid provider used in the last `days` while it has no price, so its cost counts as $0:
    AI calls recorded unpriced (AiUsage.priced is false), and Apollo, whose calls are logged on their own (ApolloCall) and are only
    counted as priced once an "apollo" lookup price is confirmed. Never raises."""
    from datetime import timedelta

    from sqlalchemy import func

    from app.models.models import ApolloCall

    since = datetime.utcnow() - timedelta(days=days)
    out = []
    try:
        rows = (await db.execute(select(AiUsage.provider, AiUsage.model, AiUsage.kind, func.count())
                                 .where(AiUsage.created_at >= since, AiUsage.priced.is_(False))
                                 .group_by(AiUsage.provider, AiUsage.model, AiUsage.kind))).all()
        out += [{"provider": p, "model": m or "", "kind": k, "calls": int(n)} for p, m, k, n in rows if n]
        apollo = int((await db.execute(select(func.count()).select_from(ApolloCall).where(ApolloCall.at >= since))).scalar() or 0)
        if apollo:
            price = await _price_row(db, "apollo", "", "lookup")  # shows Apollo on the Model Pricing screen, waiting for a price
            if not price.confirmed and not price.price_in_usd:
                out.append({"provider": "apollo", "model": "", "kind": "lookup", "calls": apollo})
    except Exception as err:
        logger.warning(f"[ai_pricing] unpriced usage not read: {err}")
    return sorted(out, key=lambda x: -x["calls"])


async def alert_unpriced(db: AsyncSession) -> list:
    """Tells staff (owner portal banner and e-mail, see ai_errors.alert_staff) at most once a day when paid providers are used with no
    price. Returns what it found. Never raises."""
    from app.services import ai_errors
    from app.services.credits import _get_doc, _put_doc

    found = await unpriced_in_use(db)
    if not found:
        return found
    try:
        doc = await _get_doc(db, PRICE_ALERT_KEY)
        last = doc.get("at")
        if last and datetime.fromisoformat(last) > datetime.utcnow() - __import__("datetime").timedelta(hours=PRICE_ALERT_EVERY_H):
            return found
        await _put_doc(db, PRICE_ALERT_KEY, {"at": datetime.utcnow().isoformat()})
        await db.commit()
        names = ", ".join(f"{x['provider']}{'/' + x['model'] if x['model'] else ''} ({x['calls']:,} calls)" for x in found[:8])
        await ai_errors.alert_staff("PRICE-01", f"Used in the last 30 days with no price set: {names}.", org_id="platform")
    except Exception as err:
        logger.warning(f"[ai_pricing] unpriced alert not sent: {err}")
    return found
