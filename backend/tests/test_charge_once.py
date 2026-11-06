"""N14: the same lookup is never charged twice, not by a second click, a double-click or a repeat within 90 days."""
import asyncio

import pytest
from sqlalchemy import func, select

from app.api import enrichment as EN
from app.core.tenancy import org_scope
from app.models.models import CreditEntry
from app.services import credits as K

pytestmark = pytest.mark.db


async def _usage(db, ref):
    return (await db.execute(select(func.count(CreditEntry.id)).where(CreditEntry.kind == "usage", CreditEntry.ref == ref))).scalar() or 0


async def test_the_same_lookup_is_charged_once(db):
    with org_scope("org_once"):
        await K.add_credits(db, "leadgen", 50, source="grant", note="t")
        await db.commit()
        for _ in range(3):
            await EN._charge_leads(db, 1, "Website for Acme", once="biz_1:website:")
        assert await _usage(db, "lead:biz_1:website:") == 1
        await EN._charge_leads(db, 1, "Phone for Acme", once="biz_1:phone:")
        assert await _usage(db, "lead:biz_1:phone:") == 1  # a different lookup is its own charge


async def test_a_double_click_is_charged_once(db):
    with org_scope("org_once2"):
        await K.add_credits(db, "leadgen", 50, source="grant", note="t")
        await db.commit()
        await asyncio.gather(*[EN._charge_leads(db, 1, "Email for Acme", once="biz_2:email:") for _ in range(2)])
        assert await _usage(db, "lead:biz_2:email:") == 1


async def test_a_search_with_new_words_is_a_new_search_and_charges_again(db):
    with org_scope("org_once3"):
        await K.add_credits(db, "leadgen", 50, source="grant", note="t")
        await db.commit()
        await EN._charge_leads(db, 1, "Website for Acme", once="biz_3:website:")
        await EN._charge_leads(db, 1, "Website for Acme", once="biz_3:website:the dental one")
        assert await _usage(db, "lead:biz_3:website:") == 1 and await _usage(db, "lead:biz_3:website:the dental one") == 1
