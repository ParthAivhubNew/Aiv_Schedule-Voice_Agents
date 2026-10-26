"""Phone numbers through the one endpoint: POST /v1/run {"plugin": "numbers", "action": "...", "id": "...", "data": {...}}.

There is no URL of its own: run.py hands the request here. It runs the same code as the Numbers screen, so verification,
searching, ordering and releasing behave the same in both places. A key needs the voice:calls permission and the Voice plan;
a test key (sk_test_) gets simulated numbers and nothing is bought.
"""
from __future__ import annotations

import base64
import binascii
from typing import Any, Dict

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import telnyx_numbers as N
from app.public_api.core import authorize, fail, is_test

SCOPE = "voice:calls"

# action -> what it does
ACTIONS: Dict[str, str] = {
    "connect": "Open a popup where the user buys a number and verifies the business. data: return_url (one of your registered return URLs). "
               "Returns connect_url; the popup ends at return_url with ?status=connected&number_id=",
    "list": "Your numbers, their orders and the state of your business verification",
    "search": "Numbers you can buy. data: country, number_type, locality?, area_code?, contains?",
    "order": "Buy a number. data: phone_number, country, number_type",
    "release": "Give a number back. id: the number's id",
    "verification.requirements": "What a country asks for before you can buy. data: country, number_type",
    "verification.submit": "Send your business documents. data: country, number_type, entity_type, texts, addresses, documents",
    "verification.status": "Where your business verification stands. data: country?, number_type?",
    "check.estimate": "What checking a list of numbers would cost, before spending anything. data: items [{key, phone, names?}]",
    "check.run": "Check a list of numbers: real? mobile or landline? do-not-call? 1 credit per 5 numbers that got an answer. data: items",
}


def _sandbox(action: str, data: Dict[str, Any], id_: str) -> Dict[str, Any]:
    if action == "list":
        return {"numbers": [], "orders": [], "verification": None, "price": {"monthlyCredits": 0, "setupCredits": 0}, "test": True}
    if action == "search":
        return {"data": [{"phone_number": f"+44203000{n:04d}", "region": "London", "features": ["voice"], "monthly_credits": 0} for n in (1001, 1002, 1003)],
                "test": True}
    if action == "order":
        return {"id": "sandbox_order", "status": "pending", "phone_number": str(data.get("phone_number") or ""), "test": True}
    if action == "release":
        return {"ok": True, "test": True}
    if action == "verification.requirements":
        return {"country": str(data.get("country") or "GB").upper(), "fields": [], "test": True}
    return {"id": "sandbox_verification", "status": "approved", "country": str(data.get("country") or "GB").upper(), "test": True}


def _documents(raw: Any) -> Dict[str, Any]:
    """{field: {filename, content_type, content_base64}} as the (filename, bytes, content type) the numbers code takes."""
    if raw in (None, {}):
        return {}
    if not isinstance(raw, dict):
        fail(422, "invalid_request", "'documents' must be an object of {field: {filename, content_type, content_base64}}.")
    files: Dict[str, Any] = {}
    for field, doc in raw.items():
        if not isinstance(doc, dict):
            fail(422, "invalid_request", f"documents.{field} must be an object.")
        try:
            content = base64.b64decode(str(doc.get("content_base64") or ""), validate=True)
        except (binascii.Error, ValueError):
            fail(422, "invalid_request", f"documents.{field}.content_base64 is not valid base64.")
        files[str(field)] = (str(doc.get("filename") or "document")[:200], content, str(doc.get("content_type") or "").lower())
    return files


async def _connect(db: AsyncSession, ctx: Dict[str, Any], data: Dict[str, Any]) -> Dict[str, Any]:
    """The popup link, as for social channels and mailboxes: the user buys the number and uploads documents on our page."""
    import time
    from datetime import datetime

    from sqlalchemy import select

    from app.models.models import PartnerLink
    from app.public_api import links
    from app.public_api.social import _partner_of
    from app.services import approval_mail
    from app.services import partners as PT

    partner = await _partner_of(db, ctx)
    if not partner:
        fail(403, "partner_only", "Connecting a number from your own page is for keys issued through the partner program.")
    try:
        url = PT.check_return_url(partner, str(data.get("return_url") or ""))
    except PT.PartnerError as err:
        fail(err.status, err.code, err.message)
    if PT._origin(url) not in (partner.allowed_origins or []):
        fail(422, "return_url_origin_not_allowed", "The return_url's web address must also be one of your allowed web addresses.")
    expires = int(time.time()) + 1800
    iso = datetime.utcfromtimestamp(expires).isoformat() + "Z"
    if is_test(ctx):
        sep = "&" if "?" in url else "?"
        return {"connect_url": f"{url}{sep}status=connected&provider=number&number_id=num_test", "expires_at": iso, "simulated": True}
    link = (await db.execute(select(PartnerLink).where(PartnerLink.key_id == str(ctx.get("key_id") or ""), PartnerLink.status == "active"))).scalars().first()
    token = approval_mail.sign({"k": "numbers_connect", "i": partner.id, "o": ctx["org_id"], "r": url,
                                "op": getattr(link, "operator_id", "") or "", "x": expires})
    return {"connect_url": f"{links.public_base()}/api/p/{token}", "expires_at": iso}


async def handle(request: Request, db: AsyncSession, action: str, id_: str, data: Dict[str, Any]) -> Dict[str, Any]:
    if action not in ACTIONS:
        fail(422, "unknown_action", f"'{action}' is not a numbers action. Use one of: " + ", ".join(ACTIONS) + ".", actions=list(ACTIONS))
    ctx = await authorize(request, db, SCOPE, "voice")
    request.state.audit_action = f"#{action}"
    if action == "release" and not id_:
        fail(422, "id_required", "'release' needs the 'id' of the number.")
    if action == "connect":
        return await _connect(db, ctx, data)
    if is_test(ctx) and action.startswith("check."):
        items = data.get("items") if isinstance(data.get("items"), list) else []
        return {"rows": [{"key": str((i or {}).get("key") or n), "phone": str((i or {}).get("phone") or ""), "status": "valid"} for n, i in enumerate(items)],
                "credits": 0, "credits_charged": 0, "test": True}
    if is_test(ctx):
        return _sandbox(action, data, id_)
    if action.startswith("check."):
        from app.api import number_check as NCK
        from app.public_api.core import app_call

        raw = data.get("items")
        if not isinstance(raw, list) or not raw:
            fail(422, "invalid_request", "'items' must be a list of {key, phone}.")
        body = NCK.CheckBody(items=[NCK.Item(key=str(i.get("key") or n), phone=str(i.get("phone") or ""), names=[str(x) for x in (i.get("names") or [])])
                                    for n, i in enumerate(raw) if isinstance(i, dict)])
        return await app_call(NCK.estimate(body, db) if action == "check.estimate" else NCK.run(body, db))

    country = str(data.get("country") or "GB")
    number_type = str(data.get("number_type") or "local")
    if action == "list":
        return await N.overview(request, db)
    if action == "search":
        return {"data": await N.search(request, country=country, number_type=number_type, locality=str(data.get("locality") or ""),
                                       area_code=str(data.get("area_code") or ""), contains=str(data.get("contains") or ""), db=db)}
    if action == "order":
        phone = str(data.get("phone_number") or "").strip()
        if not phone:
            fail(422, "invalid_request", "'phone_number' is required.")
        return await N.order(N.OrderBody(phoneNumber=phone, country=country, numberType=number_type), request, db)
    if action == "release":
        return await N.release(id_, request, db)
    if action == "verification.requirements":
        return await N.requirements(request, country=country, number_type=number_type, db=db)
    if action == "verification.status":
        from app.services import telnyx_provisioning as TP

        N._admin(request)
        return {"verification": N._sub_json(await TP.latest_verification(db, country.upper(), number_type))}
    texts, addresses = data.get("texts") or {}, data.get("addresses") or {}
    if not isinstance(texts, dict) or not isinstance(addresses, dict):
        fail(422, "invalid_request", "'texts' and 'addresses' must be objects.")
    return await N.submit_documents(db, N._admin(request), country, number_type, str(data.get("entity_type") or "company"),
                                    {str(k): str(v) for k, v in texts.items()}, {str(k): dict(v) for k, v in addresses.items()},
                                    _documents(data.get("documents")))
