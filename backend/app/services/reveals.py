"""Click once to open what the registry holds, then it stays open.

Our registry holds some companies' website, phone and email. A search shows that they exist but not what they are: a person opens each one with a
click, which is free, and that organisation sees it from then on. Anything found beyond the registry (a web lookup, a picked answer) is paid for
when it is found, so it is already shown. Search results are shared between organisations, so masking happens on a copy, after the cache."""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Set, Tuple

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import ContactReveal

KINDS = ("website", "phone", "email")


async def opened(db: AsyncSession, ids: Iterable[str]) -> Set[Tuple[str, str]]:
    """The (company id, kind) pairs this organisation has already opened. The session's organisation filter does the rest."""
    ids = list({i for i in ids if i})
    if not ids:
        return set()
    rows = (await db.execute(select(ContactReveal.business_id, ContactReveal.kind).where(ContactReveal.business_id.in_(ids)))).all()
    return {(b, k) for b, k in rows}


def mask_card(card: Dict[str, Any], seen: Set[Tuple[str, str]]) -> Dict[str, Any]:
    """A copy of a company card with each registry-held contact hidden until opened. `held` says which ones exist, so the screen can offer to open them."""
    out = dict(card)
    held: Dict[str, bool] = {}
    closed: Dict[str, bool] = {}
    for kind in KINDS:
        if out.get(kind):
            held[kind] = True
            if (out["id"], kind) not in seen:
                out[kind] = ""
                closed[kind] = True
    out["held"] = held
    out["closed"] = closed
    return out


async def mask(db: AsyncSession, cards: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = await opened(db, (c["id"] for c in cards))
    return [mask_card(c, seen) for c in cards]


async def mask_one(db: AsyncSession, card: Dict[str, Any]) -> Dict[str, Any]:
    return (await mask(db, [card]))[0]


async def open_one(db: AsyncSession, business_id: str, kind: str) -> None:
    """Record that this organisation opened one registry-held contact. Opening it twice is the same as once."""
    if kind not in KINDS:
        raise ValueError("Only a website, phone or email can be opened.")
    have = (await db.execute(select(ContactReveal.id).where(ContactReveal.business_id == business_id, ContactReveal.kind == kind))).first()
    if not have:
        await _insert(db, [(business_id, kind)])
        await db.commit()


async def _insert(db: AsyncSession, pairs: List[Tuple[str, str]]) -> None:
    """Add reveal rows without committing. A row another request added a moment ago (the unique key uq_contact_reveal) counts as already open:
    each insert runs in its own savepoint, so a clash undoes only itself and never the caller's work."""
    try:
        async with db.begin_nested():
            for business_id, kind in pairs:
                db.add(ContactReveal(business_id=business_id, kind=kind))
    except IntegrityError:
        if len(pairs) == 1:
            return
        for business_id, kind in pairs:
            try:
                async with db.begin_nested():
                    db.add(ContactReveal(business_id=business_id, kind=kind))
            except IntegrityError:
                continue


async def open_many(db: AsyncSession, businesses: Iterable[Any], seen: Set[Tuple[str, str]]) -> Set[Tuple[str, str]]:
    """Opens every register-held website, phone and email of these companies for this organisation (free, once each, as a click would).
    Returns the opened set including these."""
    from app.services import lead_filters

    fresh = []
    for biz in businesses:
        card = lead_filters.card(biz)
        for kind in KINDS:
            if card.get(kind) and (biz.id, kind) not in seen:
                fresh.append((biz.id, kind))
    if not fresh:
        return seen
    await _insert(db, fresh)
    await db.commit()
    return seen | set(fresh)


async def open_for_saved(db: AsyncSession, businesses: Iterable[Any], seen: Set[Tuple[str, str]]) -> Set[Tuple[str, str]]:
    """A company this organisation has saved to a list shows what the register holds for it."""
    return await open_many(db, businesses, seen)
