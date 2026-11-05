"""Partner credits: a partner funds its own wallet (the normal top-up of its Outreach account) and shares credits with the
accounts connected to it. Credits move from the partner's wallet to the account's; usage is still paid by whoever uses it,
so no charge path changes.
"""
from __future__ import annotations

import logging
from typing import Any, Dict

from app.core.tenancy import org_scope
from app.database import AsyncSessionLocal
from app.models.models import Partner, PartnerLink
from app.services import credits as K
from app.services import partners as PT

logger = logging.getLogger("partner_credits")

MAX_GIFT = 100000


class GiftError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


async def gift(partner: Partner, link: PartnerLink, wallet: str, amount: int, by: str, welcome: bool = False) -> Dict[str, Any]:
    """Move credits from the partner's own wallet to the connected account's. Raises GiftError with a plain reason."""
    if wallet not in K.WALLETS:
        raise GiftError(422, f"wallet must be one of: {', '.join(K.WALLETS)}.")
    if not isinstance(amount, int) or isinstance(amount, bool) or not 1 <= amount <= MAX_GIFT:
        raise GiftError(422, f"Give between 1 and {MAX_GIFT} credits.")
    if link.status != "active":
        raise GiftError(409, "That account is not connected.")
    if link.org_id == partner.owner_org_id:
        raise GiftError(409, "That is your own account.")
    label = f"{'Welcome credits' if welcome else 'Credits'} from {partner.name}"
    ref = ""
    async with AsyncSessionLocal() as db:  # the partner's wallet first: nothing moves unless it has enough
        with org_scope(partner.owner_org_id):
            have = await K.wallet_balance(db, wallet)
            if have < amount:
                raise GiftError(402, f"Your {K.WALLETS[wallet]} wallet has {max(have, 0)} credits. Top it up first.")
            await K.remove_credits(db, wallet, amount, note=f"{'Welcome credits' if welcome else 'Credits'} given to a connected account", by=by)
            PT.audit(db, partner.id, by, "credits_given", f"{amount} {wallet} to {link.org_id}{' (welcome)' if welcome else ''}")
            await db.commit()
    try:
        async with AsyncSessionLocal() as db:
            with org_scope(link.org_id):
                got = await K.add_credits(db, wallet, amount, source="partner", note=label, by=by)
                await db.commit()
    except Exception as err:  # give it back rather than lose it
        logger.error(f"[partner_credits] could not credit {link.org_id}: {err}")
        async with AsyncSessionLocal() as db:
            with org_scope(partner.owner_org_id):
                await K.add_credits(db, wallet, amount, source="refund", note="Credits could not be given; returned", by=by)
                await db.commit()
        raise GiftError(500, "The credits could not be given and were returned to your wallet.")
    return {"given": amount, "wallet": wallet, "accountBalance": got}


async def welcome(partner: Partner, link: PartnerLink) -> None:
    """The partner's welcome gift for a newly created account, when it has one and can afford it. Never raises."""
    n = int(partner.welcome_credits or 0)
    if n <= 0 or partner.status == "suspended":
        return
    try:
        await gift(partner, link, partner.welcome_wallet or "leadgen", n, by=f"partner:{partner.id}", welcome=True)
    except GiftError as err:
        logger.info(f"[partner_credits] welcome gift skipped for {link.org_id}: {err.message}")
    except Exception as err:
        logger.warning(f"[partner_credits] welcome gift failed for {link.org_id}: {err}")
