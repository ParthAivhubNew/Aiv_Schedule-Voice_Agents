"""A company with no call minutes left: its Telnyx side acts as empty until it tops up.

- managed_account mode: its Telnyx managed account is disabled (no calls in or out) and
  enabled again after a top-up. If Telnyx refuses, its numbers are detached instead.
- billing_group mode (our one account): each of its numbers is detached from its Call Control
  app, so calls to it go nowhere; the app it was on is remembered and put back after a top-up.

Outbound calls are already refused at zero and incoming calls are refused when they arrive
(voice_inbound), so this is the belt to those braces: nothing reaches us, or Telnyx's bill, at
all. Checked after every settle (every few minutes) and straight after a top-up. Never raises.
What was switched off is kept in the organisation's credit document under "voice_off", so a
restart never forgets to switch it back on.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Dict

from sqlalchemy.future import select

logger = logging.getLogger("voice_access")

KEY = "voice_off"


async def _off_state(db) -> Dict[str, Any]:
    from app.services import credits as K

    doc = await K._get_doc(db, K._settings_id())
    st = doc.get(KEY)
    return dict(st) if isinstance(st, dict) else {}


async def _numbers(db):
    from app.models.models import OrgPhoneNumber

    return (await db.execute(select(OrgPhoneNumber).where(
        OrgPhoneNumber.provider == "telnyx", OrgPhoneNumber.provider_ref != "",
        OrgPhoneNumber.status == "active"))).scalars().all()


async def _detach(db, client) -> Dict[str, str]:
    """Detach every number; returns {number row id: Call Control app it was on}."""
    saved: Dict[str, str] = {}
    for n in await _numbers(db):
        try:
            pn = await client.get_phone_number(n.provider_ref)
            conn = str(pn.get("connection_id") or "")
            if conn:
                await client.update_phone_number(n.provider_ref, connection_id=None)
                saved[n.id] = conn
        except Exception as err:
            logger.warning(f"[voice-access] could not detach {n.e164}: {err}")
    return saved


async def _reattach(db, client, saved: Dict[str, str]) -> Dict[str, str]:
    """Put numbers back on their apps; returns those that could not be (tried again next time)."""
    from app.models.models import OrgPhoneNumber

    left: Dict[str, str] = {}
    for num_id, conn in saved.items():
        n = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.id == num_id))).scalars().first()
        if n is None or not n.provider_ref:
            continue
        try:
            await client.update_phone_number(n.provider_ref, connection_id=conn)
        except Exception as err:
            logger.warning(f"[voice-access] could not reattach {n.e164}: {err}")
            left[num_id] = conn
    return left


async def _switch_off(db, setup) -> Dict[str, Any]:
    from app.services.telnyx_client import TelnyxClient, platform_key
    from app.services.telnyx_provisioning import client_for

    state: Dict[str, Any] = {"at": datetime.utcnow().isoformat(), "mode": setup.mode, "account": False, "numbers": {}}
    if setup.mode == "managed_account" and setup.managed_account_id:
        try:
            await TelnyxClient(platform_key()).disable_managed_account(setup.managed_account_id)
            state["account"] = True
            return state
        except Exception as err:
            logger.warning(f"[voice-access] could not disable managed account, detaching numbers: {err}")
    state["numbers"] = await _detach(db, client_for(setup))
    return state


async def _switch_on(db, setup, state: Dict[str, Any]) -> Dict[str, Any]:
    """Returns what is still off (empty: all back on)."""
    from app.services.telnyx_client import TelnyxClient, platform_key
    from app.services.telnyx_provisioning import client_for

    left = dict(state)
    if state.get("account") and setup.managed_account_id:
        try:
            await TelnyxClient(platform_key()).enable_managed_account(setup.managed_account_id)
            left["account"] = False
        except Exception as err:
            logger.warning(f"[voice-access] could not enable managed account: {err}")
    if state.get("numbers"):
        left["numbers"] = await _reattach(db, client_for(setup), state["numbers"])
    return {} if not left.get("account") and not left.get("numbers") else left


async def _tell(title: str, lines) -> None:
    try:
        from app.core.notify import notify

        await notify("low_credits", title, lines)
    except Exception:
        pass


async def sync(db) -> str:
    """Switch the current organisation's Telnyx side off at zero minutes and back on when it
    has minutes again. Returns "off", "on" or "" (nothing changed). Never raises."""
    from app.services import credits as K
    from app.services.telnyx_provisioning import get_setup, platform_ready

    try:
        left = await K.minutes_left(db)
        out = left is not None and left < 1
        state = await _off_state(db)
        if not out:
            from app.services.outbound_dial import resume_paused_missions

            await resume_paused_missions(db)
        if not platform_ready():
            return ""
        setup = await get_setup(db)
        if setup is None or setup.status != "ready":
            return ""
        if out and not state:
            new = await _switch_off(db, setup)
            await K._patch_doc(db, {KEY: new})
            await db.commit()
            await _tell("Calls paused: out of call minutes",
                        ["Your numbers are not taking calls and no calls can be made until you top up Voice credits.",
                         "Top up in Plans &amp; credits; everything comes back on straight away."])
            return "off"
        if not out and state:
            still = await _switch_on(db, setup, state)
            await K._patch_doc(db, {KEY: still or None})
            await db.commit()
            if not still:
                await _tell("Calls are back on", ["Thanks for topping up. Your numbers take calls again."])
                return "on"
        return ""
    except Exception as err:
        logger.warning(f"[voice-access] sync skipped: {err}")
        try:
            await db.rollback()
        except Exception:
            pass
        return ""


def kick(org_id: str) -> None:
    """After a top-up: switch calls back on now, not at the next settle. Never raises."""

    async def run():
        from app.core.tenancy import org_scope
        from app.database import AsyncSessionLocal

        with org_scope(org_id):
            async with AsyncSessionLocal() as db:
                await sync(db)

    try:
        asyncio.get_running_loop().create_task(run())
    except Exception as err:
        logger.warning(f"[voice-access] kick {org_id} skipped: {err}")
