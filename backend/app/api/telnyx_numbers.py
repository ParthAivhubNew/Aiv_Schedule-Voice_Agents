"""Numbers on Telnyx for the signed-in organisation: business verification, searching,
buying and releasing numbers; plus the Telnyx webhooks for orders, verification and messages."""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.auth_middleware import current
from app.database import get_db
from app.services import telnyx_provisioning as TP
from app.services.telnyx_client import TelnyxError

logger = logging.getLogger("telnyx_numbers")
router = APIRouter(prefix="/telnyx", tags=["Numbers"])


def _admin(request: Request) -> Dict[str, Any]:
    ctx = current(request)
    if not ctx["is_admin"]:
        raise HTTPException(status_code=403, detail="Only admins can manage phone numbers and verification.")
    return ctx


def _staff(ctx: Dict[str, Any]) -> bool:
    """Outreach staff see what Telnyx charges us; customers only ever see our own prices."""
    from app.core.auth_middleware import platform_org

    return ctx.get("org_id") == platform_org()


async def _our_price(db: AsyncSession) -> Dict[str, Any]:
    """What a number costs the customer each month, from our rate card (in Voice credits)."""
    from app.services import credits as K

    card = await K.rates(db)
    return {"monthlyCredits": card["phone_number_month"]["credits"], "setupCredits": card["number_setup"]["credits"],
            "creditsPerMinute": card["voice_minute"]["credits"]}


async def _org_name(db: AsyncSession, org_id: str) -> str:
    from sqlalchemy import text

    row = (await db.execute(text("SELECT name FROM organizations WHERE id = :i"), {"i": org_id})).first()
    return row[0] if row else org_id


async def _ready_client(db: AsyncSession, ctx: Dict[str, Any]):
    if not TP.platform_ready():
        raise HTTPException(status_code=503, detail="Phone numbers are not switched on yet. The Outreach team is setting this up.")
    setup = await TP.ensure_setup(db, await _org_name(db, ctx["org_id"]), ctx.get("email") or "")
    await db.commit()
    if setup.status != "ready":
        raise HTTPException(status_code=503, detail=setup.last_error or "Your phone line is still being set up. Try again in a minute.")
    return setup, TP.client_for(setup)


def _sub_json(s) -> Optional[Dict[str, Any]]:
    if not s:
        return None
    return {"id": s.id, "status": s.status, "reason": s.reason, "entityType": s.entity_type, "country": s.country,
            "numberType": s.number_type, "documents": [d.get("filename") for d in s.documents or []],
            "submittedAt": s.created_at.isoformat() if s.created_at else None,
            "updatedAt": s.updated_at.isoformat() if s.updated_at else None}


@router.get("/overview")
async def overview(request: Request, db: AsyncSession = Depends(get_db)):
    from app.models.models import NumberOrder, OrgPhoneNumber

    ctx = _admin(request)
    staff = _staff(ctx)
    from app.services.telnyx_client import refresh_saved_key

    await refresh_saved_key()
    setup = await TP.get_setup(db)
    if setup is not None and setup.status == "ready" and TP.platform_ready():
        try:
            await TP.refresh_pending(db, TP.client_for(setup))
            await db.commit()
        except TelnyxError:
            pass
    orders = (await db.execute(select(NumberOrder).order_by(NumberOrder.created_at.desc()).limit(30))).scalars().all()
    numbers = (await db.execute(select(OrgPhoneNumber).order_by(OrgPhoneNumber.created_at))).scalars().all()
    return {
        "platformReady": TP.platform_ready(),
        "mode": setup.mode if setup else TP.account_mode(),
        "account": {"status": setup.status if setup else "new", "error": setup.last_error if setup else ""},
        "verification": _sub_json(await TP.latest_verification(db)),
        "orders": [{"id": o.id, "phoneNumber": o.phone_number, "status": o.status, "error": o.error,
                    "at": o.created_at.isoformat() if o.created_at else None,
                    **({"telnyxMonthlyCost": o.monthly_cost, "telnyxUpfrontCost": o.upfront_cost, "telnyxCurrency": o.currency} if staff else {})}
                   for o in orders],
        "price": await _our_price(db),
        "allowedCountries": list(setup.allowed_countries or ["GB"]) if setup else ["GB"],
        "numbers": [{"id": n.id, "e164": n.e164, "label": n.label, "status": n.status, "capabilities": n.capabilities or [],
                     "isDefault": bool(n.is_default), "provider": n.provider} for n in numbers],
    }


class CountriesBody(BaseModel):
    countries: List[str]


@router.put("/allowed-countries")
async def set_allowed_countries(body: CountriesBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _admin(request)
    setup, client = await _ready_client(db, ctx)
    countries = [c.strip().upper() for c in body.countries if c.strip()] or ["GB"]
    setup.allowed_countries = countries
    if setup.outbound_voice_profile_id:
        try:
            await client.update_outbound_voice_profile(setup.outbound_voice_profile_id, countries)
        except TelnyxError as err:
            raise HTTPException(status_code=502, detail=str(err))
    await db.commit()
    return {"countries": countries}


@router.get("/requirements")
async def requirements(request: Request, country: str = "GB", number_type: str = "local", db: AsyncSession = Depends(get_db)):
    ctx = _admin(request)
    _, client = await _ready_client(db, ctx)
    try:
        return {"country": country, "numberType": number_type,
                "fields": TP.normalise_requirements(await client.requirements(country.upper(), number_type))}
    except TelnyxError as err:
        raise HTTPException(status_code=502, detail=str(err))


@router.post("/verification")
async def submit_verification(
    request: Request,
    country: str = Form("GB"),
    number_type: str = Form("local"),
    entity_type: str = Form("company"),
    texts: str = Form("{}"),
    addresses: str = Form("{}"),
    db: AsyncSession = Depends(get_db),
):
    from app.services import credits as K

    ctx = _admin(request)
    if not await K.can_start(db, "number_setup"):
        raise HTTPException(status_code=402, detail="Not enough Voice credits for number setup (5 credits required).")
    if entity_type not in ("company", "sole_trader"):
        raise HTTPException(status_code=400, detail="Choose company or sole trader.")
    try:
        text_values = {str(k): str(v) for k, v in json.loads(texts or "{}").items()}
        address_values = {str(k): dict(v) for k, v in json.loads(addresses or "{}").items()}
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="The form could not be read. Reload and try again.")
    form = await request.form()
    files: Dict[str, Any] = {}
    for key, value in form.multi_items():
        if not key.startswith("doc_") or not hasattr(value, "read"):
            continue
        content = await value.read()
        ctype = (value.content_type or "").lower()
        if ctype not in TP.ALLOWED_DOC_TYPES:
            raise HTTPException(status_code=400, detail=f"{value.filename}: upload a PDF, JPG or PNG.")
        if len(content) > TP.MAX_DOC_BYTES:
            raise HTTPException(status_code=400, detail=f"{value.filename}: files must be 10 MB or smaller.")
        if not content:
            raise HTTPException(status_code=400, detail=f"{value.filename} is empty.")
        files[key[4:]] = (value.filename or "document", content, ctype)
    _, client = await _ready_client(db, ctx)
    # Charge once per organisation, not once per submission: a client whose documents are
    # rejected and re-uploads (the normal flow per step 4) must not pay the setup fee again for
    # the same number attempt. Charged only once Telnyx has actually accepted the submission —
    # not before — so a first attempt that errors on Telnyx's side (bad doc, a transient API
    # error) is never charged for a setup that never happened.
    prior = await TP.latest_verification(db, country.upper(), number_type)
    sub = await TP.submit_verification(db, client, country=country.upper(), number_type=number_type, entity_type=entity_type,
                                       texts=text_values, addresses=address_values, files=files, by=ctx.get("name", ""))
    if not prior and sub.status != "error":
        await K.charge(db, "number_setup", 1, f"setup:{ctx.get('org_id')}:{country.upper()}:{number_type}", "Phone number setup fee")
    await db.commit()
    if sub.status == "error":
        raise HTTPException(status_code=502, detail=sub.reason or "The submission was not accepted.")
    return _sub_json(sub)


@router.get("/numbers/search")
async def search(request: Request, country: str = "GB", number_type: str = "local", locality: str = "",
                 area_code: str = "", contains: str = "", db: AsyncSession = Depends(get_db)):
    ctx = _admin(request)
    _, client = await _ready_client(db, ctx)
    try:
        found = await client.search_numbers(country.upper(), number_type, locality.strip(), area_code.strip(), contains.strip(), limit=20)
    except TelnyxError as err:
        raise HTTPException(status_code=502, detail=str(err))
    price, staff = await _our_price(db), _staff(ctx)
    out = []
    for n in found:
        cost = n.get("cost_information") or {}
        region = n.get("region_information") or []
        out.append({
            "phoneNumber": n.get("phone_number"),
            "region": ", ".join(r.get("region_name", "") for r in region if r.get("region_name")),
            "features": [f.get("name") for f in n.get("features") or [] if isinstance(f, dict)],
            "monthlyCredits": price["monthlyCredits"],
            **({"telnyxMonthlyCost": cost.get("monthly_cost"), "telnyxUpfrontCost": cost.get("upfront_cost"),
                "telnyxCurrency": cost.get("currency") or "USD"} if staff else {}),
        })
    return out


class OrderBody(BaseModel):
    phoneNumber: str
    country: str = "GB"
    numberType: str = "local"


@router.post("/numbers/order")
async def order(body: OrderBody, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = _admin(request)
    setup, client = await _ready_client(db, ctx)
    try:
        needs_docs = bool(TP.normalise_requirements(await client.requirements(body.country.upper(), body.numberType)))
    except TelnyxError:
        needs_docs = True  # safest: assume the country needs verification
    group_id = ""
    if needs_docs:
        sub = await TP.latest_verification(db, body.country.upper(), body.numberType)
        if not sub or sub.status != "approved":
            raise HTTPException(status_code=409, detail={
                "message": "Numbers in this country need your business verified first.", "code": "verification_required"})
        group_id = sub.requirement_group_id
    # What Telnyx charges us for it, read from Telnyx (for staff reports; customers never see it).
    cost: Dict[str, Any] = {}
    try:
        digits = body.phoneNumber.lstrip("+")
        same = [n for n in await client.search_numbers(body.country.upper(), body.numberType, contains=digits[-8:], limit=5)
                if n.get("phone_number") == body.phoneNumber]
        cost = (same[0].get("cost_information") or {}) if same else {}
    except TelnyxError:
        pass
    o = await TP.place_order(db, client, setup, phone_number=body.phoneNumber, country=body.country.upper(),
                             number_type=body.numberType, requirement_group_id=group_id, cost=cost,
                             by=ctx.get("name", ""))
    await db.commit()
    if o.status == "failure":
        raise HTTPException(status_code=502, detail=o.error or "The order could not be placed.")
    return {"id": o.id, "status": o.status, "phoneNumber": o.phone_number}


async def _release_number(db: AsyncSession, n: Any) -> None:
    """Release on Telnyx first; only mark released in our DB once Telnyx confirms it. Raises
    TelnyxError on failure so the caller knows the number is still live (and still billable)."""
    if n.provider == "telnyx" and n.provider_ref:
        setup = await TP.get_setup(db)
        client = TP.client_for(setup)
        await client.release_number(n.provider_ref)
    n.status = "released"
    n.is_default = False


@router.post("/numbers/{number_id}/release")
async def release(number_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    from app.models.models import OrgPhoneNumber

    _admin(request)
    n = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.id == number_id))).scalars().first()
    if not n:
        raise HTTPException(status_code=404, detail="Number not found.")
    try:
        await _release_number(db, n)
    except TelnyxError as err:
        raise HTTPException(status_code=502, detail=f"This number could not be released: {err}")
    await db.commit()
    return {"ok": True}


# ── Webhooks from Telnyx (public; each one only makes us re-read Telnyx) ──
async def _verified_body(request: Request) -> Dict[str, Any]:
    from app.services.telnyx_signature import verify_telnyx_ed25519_signature

    raw = await request.body()
    if not verify_telnyx_ed25519_signature(raw, dict(request.headers)):
        raise HTTPException(status_code=401, detail="Bad signature")
    try:
        return json.loads(raw or b"{}")
    except ValueError:
        return {}


@router.post("/webhook")
async def provisioning_webhook(request: Request):
    """number_order.*, requirement group, and number-resource events. Finds the record by its
    Telnyx id in any organisation, then refreshes it from Telnyx inside that organisation. A
    number already owned is checked too, not just pending orders — Telnyx can report a number
    suspended/held/disconnected long after the order that bought it already completed."""
    from app.core.tenancy import org_scope, system_scope
    from app.database import AsyncSessionLocal
    from app.models.models import NumberOrder, OrgPhoneNumber, VerificationSubmission

    body = await _verified_body(request)
    data = body.get("data") or {}
    payload = data.get("payload") or {}
    ref_id = str(payload.get("id") or "")
    if not ref_id:
        return {"ok": True}
    with system_scope():
        async with AsyncSessionLocal() as db:
            o = (await db.execute(select(NumberOrder).where(NumberOrder.telnyx_order_id == ref_id))).scalars().first()
            s = None if o else (await db.execute(select(VerificationSubmission).where(
                VerificationSubmission.requirement_group_id == ref_id))).scalars().first()
            n = None if (o or s) else (await db.execute(select(OrgPhoneNumber).where(
                OrgPhoneNumber.provider_ref == ref_id))).scalars().first()
            org_id = (o or s or n).org_id if (o or s or n) else None
    if not org_id:
        return {"ok": True}
    with org_scope(org_id):
        async with AsyncSessionLocal() as db:
            setup = await TP.get_setup(db)
            client = TP.client_for(setup)
            if o:
                rec = (await db.execute(select(NumberOrder).where(NumberOrder.id == o.id))).scalars().first()
                await TP.refresh_order(db, rec, client)
            elif s:
                rec = (await db.execute(select(VerificationSubmission).where(VerificationSubmission.id == s.id))).scalars().first()
                await TP.refresh_verification(db, rec, client)
            else:
                rec = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.id == n.id))).scalars().first()
                await TP.refresh_number(db, rec, client)
            await db.commit()
    return {"ok": True}


@router.post("/messaging-webhook")
async def messaging_webhook(request: Request):
    """WhatsApp messages and delivery updates. The auth middleware has already put us in the
    organisation that owns the number in the body."""
    from app.database import AsyncSessionLocal
    from app.services import whatsapp as WA

    body = await _verified_body(request)
    data = body.get("data") or {}
    event = str(data.get("event_type") or "")
    p = data.get("payload") or {}
    async with AsyncSessionLocal() as db:
        if event == "message.received":
            channel = str(p.get("type") or p.get("channel") or "").lower()
            wa = p.get("whatsapp_message") or {}
            if "whatsapp" not in channel and not wa:
                # SMS: only WhatsApp's own verification code is used, while a signup is open.
                from app.services.whatsapp_signup import catch_code

                if await catch_code(db, WA.e164(p.get("to")), str(p.get("text") or "")):
                    await db.commit()
                return {"ok": True}
            our, contact = WA.e164(p.get("to")), WA.e164(p.get("from"))
            text = p.get("text") or ((wa.get("text") or {}).get("body") if isinstance(wa.get("text"), dict) else wa.get("text")) or ""
            name = ((p.get("from") or {}).get("name") if isinstance(p.get("from"), dict) else "") or ""
            numbers = {n.e164 for n in await WA.whatsapp_numbers(db)}
            if our not in numbers or not contact:
                return {"ok": True}
            thread = await WA.record_inbound(db, our, contact, text, str(p.get("id") or ""), name)
            await db.commit()
            if thread is not None:
                WA.tell_admins(thread, text)
        elif event in ("message.sent", "message.delivered", "message.read", "message.failed", "message.finalized"):
            status = event.split(".", 1)[1]
            if status == "finalized":
                to = p.get("to") or [{}]
                status = str((to[0] if isinstance(to, list) and to else {}).get("status") or "delivered").replace("delivery_failed", "failed")
            errs = p.get("errors") or []
            await WA.update_status(db, str(p.get("id") or ""), status, (errs[0].get("detail") if errs else "") or "")
            await db.commit()
    return {"ok": True}
