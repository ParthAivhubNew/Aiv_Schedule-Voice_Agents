"""TPS/CTPS screening through Provero: one POST per number to /api/validate/phone-tps, answered with whether the number is on each register.

The API key is saved by staff in the admin portal (Platform keys, Leads tab) and kept sealed in an app setting. A result is kept for 28 days in
phone_screenings (see call_permission.py); Provero itself prices a check at about 0.4p, so the platform only asks for numbers with no fresh result.
Client-facing text never names the vendor (brand rule); only the admin screens do.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx

from app.services.secret_box import open_blob, seal_blob

logger = logging.getLogger(__name__)

URL = "https://api.provero.io/api/validate/phone-tps"
SETTING = "provero_tps"
CONCURRENCY = 6
TIMEOUT = 15.0
TEST_NUMBER = "+447700900123"  # a number Ofcom reserves for drama use: never a real person, safe for a test check


class ProveroError(Exception):
    """Base for every way a check can fail."""


class KeyRejected(ProveroError):
    """The saved key was refused (401 or 403)."""


class OutOfBalance(ProveroError):
    """The vendor account has no balance left (402)."""


class BadNumber(ProveroError):
    """Not a number the register covers (a non-UK or malformed number). Nothing is charged for it."""


class Unavailable(ProveroError):
    """A timeout, a rate limit or a server error: try again later."""


async def get_key(db=None) -> str:
    """The saved key, or "" when none is saved. Opens its own session when none is given."""
    from app.services.credits import _get_doc

    if db is not None:
        return open_blob((await _get_doc(db, SETTING)).get("key", ""))
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal

    try:
        with system_scope():
            async with AsyncSessionLocal() as s:
                return open_blob((await _get_doc(s, SETTING)).get("key", ""))
    except Exception as err:
        logger.debug(f"[provero] key not read: {err}")
        return ""


async def save_key(db, key: str) -> None:
    from app.services.credits import _get_doc, _put_doc

    doc = await _get_doc(db, SETTING)
    doc.update({"key": seal_blob((key or "").strip()), "saved_at": datetime.utcnow().isoformat() + "Z", "last_error": ""})
    await _put_doc(db, SETTING, doc)


async def clear_key(db) -> None:
    from app.services.credits import _put_doc

    await _put_doc(db, SETTING, {})


async def note(db, **fields: Any) -> None:
    """Remembers the latest test or failure for the admin screen. Never raises."""
    try:
        from app.services.credits import _get_doc, _put_doc

        doc = await _get_doc(db, SETTING)
        doc.update(fields)
        await _put_doc(db, SETTING, doc)
    except Exception as err:
        logger.debug(f"[provero] status not saved: {err}")


def parse(status: int, body: Any) -> Dict[str, Any]:
    """One response -> {"tps": "listed"|"clear", "ctps": bool, "tps_date", "ctps_date"}, or the matching error."""
    if status in (401, 403):
        raise KeyRejected("The key was refused.")
    if status == 402:
        raise OutOfBalance("The screening account has no balance left.")
    if status == 429 or status >= 500:
        raise Unavailable(f"The screening service answered {status}.")
    if status >= 400 or not isinstance(body, dict) or "onTps" not in body:
        raise BadNumber(str((body or {}).get("message") if isinstance(body, dict) else "") or "That number could not be checked.")
    return {"tps": "listed" if body.get("onTps") else "clear", "ctps": bool(body.get("onCtps")),
            "tps_date": body.get("tpsRegisteredDate") or "", "ctps_date": body.get("ctpsRegisteredDate") or ""}


async def check_one(client: httpx.AsyncClient, key: str, number: str) -> Dict[str, Any]:
    try:
        resp = await client.post(URL, json={"phone": number}, headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
    except httpx.HTTPError as err:
        raise Unavailable(f"Could not reach the screening service: {err}") from err
    try:
        body = resp.json()
    except ValueError:
        body = None
    return parse(resp.status_code, body)


async def _count_call() -> None:
    try:
        from app.services.enrichment_service import _bump_vendor_call

        await _bump_vendor_call("provero_tps")
    except Exception:
        pass


class ProveroProvider:
    """The screening adapter call_permission.provider() hands out (same shape as ScreeningProvider)."""
    name = "provero"

    def __init__(self, key: str):
        self.key = key
        self.error = ""  # why the last screen stopped early: "key" | "balance" | "unavailable" | ""

    def configured(self) -> bool:
        return bool(self.key)

    async def screen(self, numbers: List[str]) -> Dict[str, Dict[str, Any]]:
        """{number: {"tps": "listed"|"clear", "ctps": bool}} for every number that got an answer. A refused key or an empty balance stops the
        run (self.error says which); a number the register does not cover is simply left out."""
        out: Dict[str, Dict[str, Any]] = {}
        self.error = ""
        gate = asyncio.Semaphore(CONCURRENCY)
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            async def one(n: str) -> None:
                if self.error in ("key", "balance"):
                    return
                async with gate:
                    try:
                        res = await check_one(client, self.key, n)
                        await _count_call()
                        out[n] = res
                    except KeyRejected:
                        self.error = "key"
                    except OutOfBalance:
                        self.error = "balance"
                    except Unavailable:
                        self.error = self.error or "unavailable"
                    except BadNumber:
                        pass

            await asyncio.gather(*(one(n) for n in numbers))
        return out


async def provider(db=None) -> Optional[ProveroProvider]:
    key = await get_key(db)
    return ProveroProvider(key) if key else None


async def test_key(key: str) -> Dict[str, Any]:
    """One real check of a number reserved for drama use, to prove the key works. Costs one check."""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        try:
            res = await check_one(client, key, TEST_NUMBER)
            return {"ok": True, "message": "The key works. One check was used.", "result": res}
        except KeyRejected:
            return {"ok": False, "message": "The key was refused. Check it is the right one and still active."}
        except OutOfBalance:
            return {"ok": False, "message": "The key is valid but the screening account has no balance. Top it up."}
        except BadNumber as err:
            return {"ok": False, "message": f"The service did not accept the test number: {err}"}
        except Unavailable as err:
            return {"ok": False, "message": str(err)}
