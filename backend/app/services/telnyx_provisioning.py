"""Setting an organisation up on Telnyx and buying its numbers.

Two ways to keep clients apart on Telnyx (TELNYX_ACCOUNT_MODE):
- managed_account: each organisation gets its own Telnyx managed account under ours
  (needs Telnyx to approve us as a manager account). Numbers, calls and costs live in it.
- billing_group (default, pay-as-you-go): everything runs on our own account and our one Telnyx
  balance. Each organisation gets
    - a billing group: its numbers (inbound) and its outbound profile are in it, so Telnyx
      reports its usage separately (reports only: a billing group holds no money);
    - its own outbound voice profile in that billing group, limited to its allowed countries
      and optionally a daily spend cap (TELNYX_DAILY_SPEND_LIMIT_USD) and a highest per-minute
      rate (TELNYX_MAX_DESTINATION_RATE) that Telnyx itself enforces;
    - its own Call Control app on that profile, which its outbound calls are dialled through.
  Because every organisation draws on our balance, our app is the source of truth: each one
  pays us in advance (credits), usage is checked before a call and a call is capped at what is
  left, and Telnyx's reports per billing group are compared with what we charged.

Flow: verification (documents + requirement group, reviewed by Telnyx) -> number search ->
number order -> when complete, the number becomes one of the organisation's numbers.
Status changes come from Telnyx webhooks and are also re-checked on demand, and a webhook
only triggers a re-read from Telnyx; its body is never trusted.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.future import select

from app.services.telnyx_client import TelnyxClient, TelnyxError, platform_key

logger = logging.getLogger("telnyx_provisioning")

REFRESH_EVERY = timedelta(seconds=60)


def account_mode() -> str:
    m = (os.getenv("TELNYX_ACCOUNT_MODE") or "billing_group").strip().lower()
    return "managed_account" if m in ("managed", "managed_account", "managed_accounts") else "billing_group"


def platform_ready() -> bool:
    return bool(platform_key())


def _org() -> str:
    from app.core.tenancy import current_org

    return current_org()


async def get_setup(db) -> Optional[Any]:
    from app.models.models import OrgTelnyx

    return (await db.execute(select(OrgTelnyx).where(OrgTelnyx.id == _org()))).scalars().first()


def client_for(setup) -> TelnyxClient:
    """The key to use for this organisation: its managed account's, or ours."""
    from app.services.secret_box import open_secret

    if setup is not None and setup.mode == "managed_account":
        key = open_secret(setup.api_key_sealed or "")
        if not key:
            raise TelnyxError("Your Telnyx account is still being set up. Try again in a minute.")
        return TelnyxClient(key)
    return TelnyxClient(platform_key())


def _complete(setup) -> bool:
    if setup.mode == "managed_account":
        return bool(setup.api_key_sealed and setup.connection_id and setup.messaging_profile_id)
    return bool(setup.billing_group_id and setup.outbound_voice_profile_id and setup.outbound_connection_id)


async def ensure_setup(db, org_name: str, email: str = "") -> Any:
    """Create (or finish creating) the organisation's Telnyx side. Idempotent: each part is made
    once, so an organisation set up before a part existed gets it on the next call. Caller commits."""
    from app.models.models import OrgTelnyx
    from app.services.secret_box import seal_secret

    setup = await get_setup(db)
    if setup is None:
        setup = OrgTelnyx(id=_org(), mode=account_mode(), status="new")
        db.add(setup)
        await db.flush()
    if setup.status == "ready" and _complete(setup):
        return setup
    was_ready = setup.status == "ready"
    if not platform_ready():
        if not was_ready:
            setup.status, setup.last_error = "error", "Telnyx is not connected on the platform yet."
        return setup
    manager = TelnyxClient(platform_key())
    try:
        if setup.mode == "managed_account":
            if not setup.managed_account_id:
                acct = await manager.create_managed_account(org_name or _org(), email or None)
                setup.managed_account_id = str(acct.get("id") or "")
            if not setup.api_key_sealed and setup.managed_account_id:
                acct = await manager.get_managed_account(setup.managed_account_id)
                if acct.get("api_key"):
                    setup.api_key_sealed = seal_secret(acct["api_key"])
            if not setup.api_key_sealed:
                setup.status, setup.last_error = "new", "Waiting for Telnyx to finish creating the account."
                return setup
            # The managed account needs its own call app and messaging profile pointing at us.
            from app.services.telephony_provider import public_http_base

            own = client_for(setup)
            base = public_http_base()
            if not setup.connection_id:
                app_ = await own.create_call_control_application("OutReach calls", f"{base}/api/telnyx-assistant/call-control")
                setup.connection_id = str(app_.get("id") or "")
            if not setup.messaging_profile_id:
                prof = await own.create_messaging_profile("OutReach messages", f"{base}/api/telnyx/messaging-webhook")
                setup.messaging_profile_id = str(prof.get("id") or "")
        else:
            from app.services.telephony_provider import public_http_base

            label = f"{org_name or _org()} ({_org()})"
            if not setup.billing_group_id:
                bg = await manager.create_billing_group(label)
                setup.billing_group_id = str(bg.get("id") or "")
            if not setup.outbound_voice_profile_id:
                ovp = await manager.create_outbound_voice_profile(
                    label, list(setup.allowed_countries or ["GB"]), setup.billing_group_id,
                    daily_spend_limit_usd=os.getenv("TELNYX_DAILY_SPEND_LIMIT_USD", "").strip(),
                    max_destination_rate=os.getenv("TELNYX_MAX_DESTINATION_RATE", "").strip())
                setup.outbound_voice_profile_id = str(ovp.get("id") or "")
                await _prepaid_only(db)
            if not setup.outbound_connection_id:
                # Same webhook as our other Call Control apps: it handles every kind of call we place.
                app_ = await manager.create_call_control_application(
                    f"OutReach calls: {label}", f"{public_http_base()}/api/sip-webhook", setup.outbound_voice_profile_id)
                setup.outbound_connection_id = str(app_.get("id") or "")
            setup.connection_id = setup.connection_id or os.getenv("TELNYX_CONNECTION_ID", "").strip()
            setup.messaging_profile_id = setup.messaging_profile_id or os.getenv("TELNYX_MESSAGING_PROFILE_ID", "").strip()
        setup.status, setup.last_error = "ready", ""
    except TelnyxError as err:
        setup.last_error = str(err)[:500]
        if not was_ready:  # what already worked (e.g. buying numbers) keeps working
            setup.status = "error"
    return setup


async def _prepaid_only(db) -> None:
    """An organisation on our Telnyx balance uses only what it has paid for: its credits are
    enforced (the platform's own organisation is not a customer and is left as it is)."""
    from app.api.credits import platform_org
    from app.services import credits as K

    if _org() != platform_org():
        await K.set_org_settings(db, {"enforce": True})


async def outbound_route(db, from_number: str) -> Optional[Tuple[str, str]]:
    """(API key, Call Control app) to dial through so the call is billed to this organisation's
    billing group: our key and its own app, when the caller ID is a number we bought for it.
    None: dial the way the organisation always has (e.g. its own Telnyx account)."""
    from app.models.models import OrgPhoneNumber
    from app.services.numbers import normalize

    if account_mode() != "billing_group" or not platform_ready() or not from_number:
        return None
    setup = await get_setup(db)
    if setup is None or setup.status != "ready":
        return None
    if not setup.outbound_connection_id:
        setup = await ensure_setup(db, "")  # organisations set up before outbound profiles existed
        await db.commit()
        if not setup.outbound_connection_id:
            return None
    ours = (await db.execute(select(OrgPhoneNumber).where(
        OrgPhoneNumber.e164 == normalize(from_number), OrgPhoneNumber.provider == "telnyx",
        OrgPhoneNumber.provider_ref != "", OrgPhoneNumber.status == "active"))).scalars().first()
    if not ours:
        return None
    return platform_key(), setup.outbound_connection_id


# ── Regulatory requirements ────────────────────────────────────────────────
def normalise_requirements(data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Telnyx lists requirement records, each with its requirement types. We flatten to the
    fields a form needs: id, name, type (textual | address | document | date), help text."""
    out, seen = [], set()
    for rec in data or []:
        types = rec.get("requirements_types") or rec.get("requirement_types") or rec.get("types") or []
        for t in types:
            tid = str(t.get("id") or "")
            if not tid or tid in seen:
                continue
            seen.add(tid)
            out.append({
                "id": tid,
                "name": t.get("name") or "Requirement",
                "type": (t.get("type") or "textual").lower(),
                "description": t.get("description") or "",
                "example": t.get("example") or "",
                "acceptance": t.get("acceptance_criteria") or {},
            })
    return out


ALLOWED_DOC_TYPES = {"application/pdf", "image/jpeg", "image/png"}
MAX_DOC_BYTES = 10 * 1024 * 1024


async def submit_verification(db, client: TelnyxClient, *, country: str, number_type: str, entity_type: str,
                              texts: Dict[str, str], addresses: Dict[str, Dict[str, str]],
                              files: Dict[str, Tuple[str, bytes, str]], by: str) -> Any:
    """Upload documents, create addresses, create and submit the requirement group. Caller commits."""
    from app.models.models import VerificationSubmission

    org = _org()
    sub = VerificationSubmission(id=f"ver_{uuid.uuid4().hex[:12]}", country=country, number_type=number_type,
                                 entity_type=entity_type, fields=dict(texts), documents=[], submitted_by=by)
    db.add(sub)
    values: List[Dict[str, str]] = []
    try:
        for req_id, text in texts.items():
            if str(text or "").strip():
                values.append({"requirement_id": req_id, "field_value": str(text).strip()})
        for req_id, addr in addresses.items():
            created = await client.create_address({**addr, "customer_reference": org})
            values.append({"requirement_id": req_id, "field_value": str(created.get("id") or "")})
        docs = []
        for req_id, (filename, content, ctype) in files.items():
            doc = await client.upload_document(filename, content, ctype, customer_reference=org)
            docs.append({"requirement_id": req_id, "filename": filename, "telnyx_document_id": str(doc.get("id") or "")})
            values.append({"requirement_id": req_id, "field_value": str(doc.get("id") or "")})
        sub.documents = docs
        group = await client.create_requirement_group(country, number_type, values, customer_reference=org)
        sub.requirement_group_id = str(group.get("id") or "")
        submitted = await client.submit_requirement_group(sub.requirement_group_id)
        sub.status = str(submitted.get("status") or group.get("status") or "pending-approval")
    except TelnyxError as err:
        sub.status, sub.reason = "error", str(err)[:500]
    return sub


async def latest_verification(db, country: str = "GB", number_type: str = "local") -> Optional[Any]:
    from app.models.models import VerificationSubmission

    return (await db.execute(
        select(VerificationSubmission)
        .where(VerificationSubmission.country == country, VerificationSubmission.number_type == number_type)
        .order_by(VerificationSubmission.created_at.desc())
    )).scalars().first()


def _group_reason(group: Dict[str, Any]) -> str:
    reasons = []
    for r in group.get("regulatory_requirements") or []:
        why = r.get("status_reason") or r.get("reason") or ""
        if why:
            reasons.append(str(why))
    return "; ".join(reasons)[:500]


async def refresh_verification(db, sub, client: TelnyxClient) -> Any:
    if not sub.requirement_group_id or sub.status in ("approved", "error"):
        return sub
    try:
        group = await client.get_requirement_group(sub.requirement_group_id)
    except TelnyxError as err:
        logger.info(f"[telnyx] verification refresh skipped: {err}")
        return sub
    status = str(group.get("status") or sub.status)
    if status != sub.status:
        sub.status = status
        if status in ("declined", "expired"):
            sub.reason = _group_reason(group) or "Telnyx did not accept the documents."
        await _notify_verification(sub)
    return sub


async def _notify_verification(sub) -> None:
    try:
        from app.core.notify import notify

        if sub.status == "approved":
            await notify("numbers", "Your business is verified for phone numbers",
                         ["Telnyx approved your documents. You can now buy phone numbers in OutReach."])
        elif sub.status in ("declined", "expired"):
            await notify("numbers", "Your phone number verification needs attention",
                         [f"Telnyx could not approve your documents: {sub.reason or 'no reason given'}.",
                          "Open Numbers in the Voice plugin to upload new documents."])
    except Exception:
        pass


# ── Numbers ────────────────────────────────────────────────────────────────
async def place_order(db, client: TelnyxClient, setup, *, phone_number: str, country: str, number_type: str,
                      requirement_group_id: str, cost: Dict[str, Any], by: str) -> Any:
    from app.models.models import NumberOrder

    order = NumberOrder(id=f"no_{uuid.uuid4().hex[:12]}", phone_number=phone_number, country=country,
                        number_type=number_type, requirement_group_id=requirement_group_id,
                        monthly_cost=str(cost.get("monthly_cost") or ""), upfront_cost=str(cost.get("upfront_cost") or ""),
                        currency=str(cost.get("currency") or "USD"), ordered_by=by)
    db.add(order)
    try:
        res = await client.create_number_order(
            [phone_number], requirement_group_id=requirement_group_id,
            connection_id=getattr(setup, "connection_id", "") or "",
            messaging_profile_id=getattr(setup, "messaging_profile_id", "") or "",
            billing_group_id=getattr(setup, "billing_group_id", "") or "",
            customer_reference=_org(),
        )
        order.telnyx_order_id = str(res.get("id") or "")
        order.status = str(res.get("status") or "pending")
        if order.status == "success":
            await _activate(db, order, res)
    except TelnyxError as err:
        order.status, order.error = "failure", str(err)[:500]
    return order


async def _activate(db, order, telnyx_order: Dict[str, Any]) -> None:
    from app.models.models import OrgPhoneNumber

    existing = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.e164 == order.phone_number))).scalars().first()
    if existing:
        existing.status = "active"
        return
    number_id = ""
    for pn in telnyx_order.get("phone_numbers") or []:
        if pn.get("phone_number") == order.phone_number:
            number_id = str(pn.get("id") or "")
    has_default = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.is_default.is_(True)))).scalars().first()
    db.add(OrgPhoneNumber(id=f"num_{uuid.uuid4().hex[:10]}", e164=order.phone_number, label="",
                          provider="telnyx", provider_ref=number_id, capabilities=["voice"],
                          status="active", is_default=not has_default))
    try:
        from app.core.notify import notify

        await notify("numbers", f"Your number {order.phone_number} is ready",
                     [f"<b>{order.phone_number}</b> is now yours and ready for calls in OutReach."])
    except Exception:
        pass


async def refresh_order(db, order, client: TelnyxClient) -> Any:
    if not order.telnyx_order_id or order.status in ("success", "failure"):
        return order
    try:
        res = await client.get_number_order(order.telnyx_order_id)
    except TelnyxError as err:
        logger.info(f"[telnyx] order refresh skipped: {err}")
        return order
    status = str(res.get("status") or order.status)
    if status == "success" and order.status != "success":
        await _activate(db, order, res)
    if status == "failure":
        errs = [str(pn.get("status") or "") for pn in res.get("phone_numbers") or []]
        order.error = order.error or ("Telnyx could not complete the order. " + ", ".join(e for e in errs if e)).strip()
    order.status = status
    return order


async def refresh_pending(db, client: TelnyxClient, force: bool = False) -> None:
    """Re-read anything still waiting on Telnyx (throttled). Caller commits."""
    from app.models.models import NumberOrder, VerificationSubmission

    cutoff = datetime.utcnow() - REFRESH_EVERY
    orders = (await db.execute(select(NumberOrder).where(NumberOrder.status == "pending"))).scalars().all()
    for o in orders:
        if force or (o.updated_at or o.created_at) < cutoff:
            await refresh_order(db, o, client)
            o.updated_at = datetime.utcnow()
    subs = (await db.execute(select(VerificationSubmission).where(
        VerificationSubmission.status.in_(["pending-approval", "unapproved", "draft"])))).scalars().all()
    for s in subs:
        if force or (s.updated_at or s.created_at) < cutoff:
            await refresh_verification(db, s, client)
            s.updated_at = datetime.utcnow()
