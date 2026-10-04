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


async def _create_or_reuse(create, find):
    """Create a Telnyx resource, or reuse the existing one if Telnyx says it's already there.
    This happens for real: the previous attempt's create call can succeed on Telnyx's side while
    our own write of its id never lands (a crash, a dropped connection) — the next attempt then
    tries to create the same deterministically-named resource again, and Telnyx correctly refuses
    it as a duplicate. Without this, that organisation's Telnyx setup is stuck in "error" forever,
    since nothing here ever looks the existing resource up and nothing else can clear it."""
    try:
        return await create()
    except TelnyxError as err:
        if "duplicate" not in str(err).lower():
            raise
        found = await find()
        if not found:
            raise
        return found


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
                app_ = await _create_or_reuse(
                    lambda: own.create_call_control_application("OutReach calls", f"{base}/api/telnyx-assistant/call-control"),
                    lambda: own.find_call_control_application("OutReach calls"))
                setup.connection_id = str(app_.get("id") or "")
            if not setup.messaging_profile_id:
                prof = await _create_or_reuse(
                    lambda: own.create_messaging_profile("OutReach messages", f"{base}/api/telnyx/messaging-webhook"),
                    lambda: own.find_messaging_profile("OutReach messages"))
                setup.messaging_profile_id = str(prof.get("id") or "")
        else:
            from app.services.telephony_provider import public_http_base

            label = f"{org_name or _org()} ({_org()})"
            if not setup.billing_group_id:
                bg = await _create_or_reuse(lambda: manager.create_billing_group(label), lambda: manager.find_billing_group(label))
                setup.billing_group_id = str(bg.get("id") or "")
            if not setup.outbound_voice_profile_id:
                ovp = await _create_or_reuse(
                    lambda: manager.create_outbound_voice_profile(
                        label, list(setup.allowed_countries or ["GB"]), setup.billing_group_id,
                        daily_spend_limit_usd=os.getenv("TELNYX_DAILY_SPEND_LIMIT_USD", "").strip(),
                        max_destination_rate=os.getenv("TELNYX_MAX_DESTINATION_RATE", "").strip()),
                    lambda: manager.find_outbound_voice_profile(label))
                setup.outbound_voice_profile_id = str(ovp.get("id") or "")
                await _prepaid_only(db)
            if not setup.outbound_connection_id:
                # Same webhook as our other Call Control apps: it handles every kind of call we place.
                outbound_name = f"OutReach calls: {label}"
                app_ = await _create_or_reuse(
                    lambda: manager.create_call_control_application(outbound_name, f"{public_http_base()}/api/sip-webhook", setup.outbound_voice_profile_id),
                    lambda: manager.find_call_control_application(outbound_name))
                setup.outbound_connection_id = str(app_.get("id") or "")
            from app.services import voice_assistants as VA
            if VA.enabled_for_org(_org()):
                try:
                    await VA.assistant_for(db, "")  # "" = the organisation's own assistant
                except Exception as va_err:
                    logger.warning(f"[telnyx_provisioning] auto assistant creation skipped: {va_err}")
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
    from app.core.auth_middleware import platform_org
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
    await keep_webhook(db, setup)
    return platform_key(), setup.outbound_connection_id


async def keep_webhook(db, setup) -> None:
    """Point the organisation's call app at today's PUBLIC_BASE_URL (it is set when the app is
    made, so a new ngrok address or domain would otherwise leave calls talking to the old one).
    Never raises: the call goes ahead either way."""
    from app.services import credits as K
    from app.services.telephony_provider import public_http_base

    app_id = setup.outbound_connection_id if setup.mode != "managed_account" else setup.connection_id
    if not app_id:
        return
    path = "/api/telnyx-assistant/call-control" if setup.mode == "managed_account" else "/api/sip-webhook"
    url = f"{public_http_base()}{path}"
    key = f"telnyx_webhook:{_org()}"
    try:
        doc = await K._get_doc(db, key)
        if doc.get(app_id) == url:
            return
        client = client_for(setup)
        # Telnyx wants the name with every update, so send the one the app already has.
        current = await client.get_call_control_application(app_id)
        if current.get("webhook_event_url") != url:
            await client.update_call_control_application(
                app_id, application_name=current.get("application_name") or "OutReach calls", webhook_event_url=url)
        await K._put_doc(db, key, {**doc, app_id: url})
        await db.commit()
    except Exception as err:
        logger.warning(f"call app {app_id} webhook not updated: {err}")


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


async def _notify_both(event: str, subject: str, lines: List[str]) -> None:
    """The same message to the affected organisation's own users, and again to Aivhub's platform
    organisation, so staff learn about a problem the same day the customer does, not only when
    they happen to check System logs. Used for anything that was fine and then went bad — a
    brand-new decline/rejection is lower-stakes and stays customer-only, as it always has."""
    from app.core.auth_middleware import platform_org
    from app.core.notify import notify
    from app.core.tenancy import org_scope

    org = _org()
    await notify(event, subject, lines)
    try:
        with org_scope(platform_org()):
            await notify(event, f"[{org}] {subject}", lines)
    except Exception:
        pass


async def refresh_verification(db, sub, client: TelnyxClient) -> Any:
    """Re-read this verification from Telnyx. Only truly terminal statuses are skipped — an
    error means Telnyx rejected the submission outright, nothing to re-check. "approved" is not
    terminal: Telnyx can still revoke it later, and that's exactly the case this needs to catch."""
    if not sub.requirement_group_id or sub.status == "error":
        return sub
    try:
        group = await client.get_requirement_group(sub.requirement_group_id)
    except TelnyxError as err:
        logger.info(f"[telnyx] verification refresh skipped: {err}")
        return sub
    status = str(group.get("status") or sub.status)
    if status != sub.status:
        was_approved = sub.status == "approved"
        sub.status = status
        if status in ("declined", "expired"):
            sub.reason = _group_reason(group) or "Telnyx did not accept the documents."
        await _notify_verification(sub, was_approved)
    return sub


async def _notify_verification(sub, was_approved: bool = False) -> None:
    try:
        from app.core.notify import notify

        if sub.status == "approved":
            await notify("numbers", "Your business is verified for phone numbers",
                         ["Telnyx approved your documents. You can now buy phone numbers in OutReach."])
        elif sub.status in ("declined", "expired"):
            if was_approved:
                await _notify_both("numbers", "Your phone number verification was revoked",
                                   [f"Telnyx withdrew approval of your documents: {sub.reason or 'no reason given'}.",
                                    "Numbers already bought on this business may be affected. Contact the OutReach team."])
            else:
                await notify("numbers", "Your phone number verification needs attention",
                             [f"Telnyx could not approve your documents: {sub.reason or 'no reason given'}.",
                              "Open Numbers in the Voice plugin to upload new documents."])
    except Exception:
        pass


async def refresh_number(db, n, client: TelnyxClient) -> Any:
    """Re-read an already-active number from Telnyx, in case it was later suspended, held or
    disconnected without a webhook reaching us (Telnyx doesn't promise one for every compliance
    action). Cheap, so it's fine to call for every active number on an hourly sweep."""
    from app.core.notify import notify

    if not n.provider_ref or n.status not in ("active", "held"):
        return n
    try:
        pn = await client.get_phone_number(n.provider_ref)
    except TelnyxError as err:
        logger.info(f"[telnyx] number refresh skipped for {n.e164}: {err}")
        return n
    telnyx_status = str(pn.get("status") or "")
    healthy = telnyx_status in ("active", "")
    was_active = n.status == "active"
    if healthy and not was_active:
        n.status = "active"
        await notify("numbers", f"{n.e164} is working again",
                     [f"Telnyx now reports {n.e164} as active again."])
    elif not healthy and was_active:
        n.status = "held"
        await _notify_both("numbers", f"{n.e164} was suspended or held by Telnyx",
                           [f"Telnyx now reports this number's status as '{telnyx_status or 'unknown'}', not active.",
                            "Outbound calls from it may fail until this is resolved. Contact the OutReach team."])
    return n


async def sweep_active_numbers(db, client: TelnyxClient) -> None:
    """Re-check numbers and verifications already marked good against Telnyx, in case it later
    changed its mind without sending a webhook. Meant to run about once an hour per organisation
    (see the number-health loop in main.py), not on every page load."""
    from app.models.models import OrgPhoneNumber, VerificationSubmission

    numbers = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.status.in_(["active", "held"])))).scalars().all()
    for n in numbers:
        await refresh_number(db, n, client)
    subs = (await db.execute(select(VerificationSubmission).where(VerificationSubmission.status == "approved"))).scalars().all()
    for s in subs:
        await refresh_verification(db, s, client)


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

    rent_due = datetime.utcnow() + timedelta(days=30)
    existing = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.e164 == order.phone_number))).scalars().first()
    if existing:
        existing.status = "active"
        if not existing.rent_due_at:
            existing.rent_due_at = rent_due
        return
    number_id = ""
    for pn in telnyx_order.get("phone_numbers") or []:
        if pn.get("phone_number") == order.phone_number:
            number_id = str(pn.get("id") or "")
    has_default = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.is_default.is_(True)))).scalars().first()
    db.add(OrgPhoneNumber(id=f"num_{uuid.uuid4().hex[:10]}", e164=order.phone_number, label="",
                          provider="telnyx", provider_ref=number_id, capabilities=["voice"],
                          status="active", is_default=not has_default, rent_due_at=rent_due))
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
