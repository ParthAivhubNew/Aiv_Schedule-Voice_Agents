"""Calls a person makes themselves from the browser, with no AI on the line.

Telnyx supplies the browser phone (WebRTC). Per call: we run every check on our side, hold the credits,
make a login that lasts for that one call, and hand the browser a token. When the call ends the minutes are
charged once through the same path the AI calls use. A call may also be recorded; the recording is turned
into a written transcript and summary, charged separately (call_transcript).
"""
from __future__ import annotations

import asyncio
import logging
import math
import os
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.future import select

from app.core.brand import scrub
from app.models.models import CallLog, HumanCall, LiveCall, OrgPhoneNumber, OrgTelnyx
from app.services.telnyx_client import TelnyxError

logger = logging.getLogger("human_calls")

OPEN = ("started", "ringing", "answered")
EXTRA_SECS = 300  # the login outlives the credit hold by this much
STALE_AFTER = timedelta(minutes=10)  # an open call this long past its cap, with no hang-up, is closed by the sweep
AUDIO_LATE = timedelta(minutes=10)  # a recording may still arrive this long after the call ended
MAX_AUDIO_BYTES = 200 * 1024 * 1024
AUDIO_KEEP_DAYS = 30
RECORDINGS_SUBDIR = "human"

# What the person picks after a call -> the outcome words the call history already uses.
OUTCOMES = {"talked": "contacted", "no_answer": "no_answer", "voicemail": "voicemail", "wrong_number": "wrong_number",
            "callback_requested": "callback_requested", "not_interested": "rejected", "do_not_call": "rejected"}

# Country calling codes we can refuse on our side; anything else is left to the country list on the Telnyx profile.
_PREFIX_COUNTRY = (("+353", "IE"), ("+44", "GB"), ("+49", "DE"), ("+33", "FR"), ("+34", "ES"), ("+39", "IT"), ("+31", "NL"),
                   ("+61", "AU"), ("+64", "NZ"), ("+91", "IN"), ("+1", "US"))


class HumanCallError(Exception):
    def __init__(self, status: int, message: str, code: str = "", extra: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.status, self.message, self.code, self.extra = status, message, code, extra or {}


def _org() -> str:
    from app.core.tenancy import current_org

    return current_org()


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def country_of(e164: str) -> str:
    for prefix, iso in _PREFIX_COUNTRY:
        if e164.startswith(prefix):
            return "CA" if prefix == "+1" and e164[2:5] in CANADA_AREA else iso
    return ""


CANADA_AREA = {"204", "226", "236", "249", "250", "289", "306", "343", "365", "403", "416", "418", "431", "437", "438", "450", "506",
               "514", "519", "579", "581", "587", "604", "613", "639", "647", "672", "705", "709", "778", "780", "782", "807", "819", "825", "867", "873", "902", "905"}


# ── Setup: the credential connection ────────────────────────────────────────────
def _event_url() -> str:
    from app.services.telephony_provider import public_http_base

    return f"{public_http_base()}/api/human-calls/events"


async def _ensure_profile(db, setup: OrgTelnyx, client) -> str:
    """The outbound profile the browser logins dial through: it holds the country list, the spend cap and the billing group."""
    if setup.outbound_voice_profile_id:
        return setup.outbound_voice_profile_id
    limit = os.getenv("TELNYX_DAILY_SPEND_LIMIT_USD", "").strip()
    if not limit:  # a login can dial by itself, so a daily cap on Telnyx's side is not optional
        raise HumanCallError(503, "Calling from the browser is not switched on yet. The Outreach team is setting this up.", "NOT_READY")
    label = f"Browser calls: {_org()}"
    from app.services.telnyx_provisioning import _create_or_reuse

    ovp = await _create_or_reuse(
        lambda: client.create_outbound_voice_profile(label, list(setup.allowed_countries or ["GB"]), setup.billing_group_id or "",
                                                     daily_spend_limit_usd=limit, max_destination_rate=os.getenv("TELNYX_MAX_DESTINATION_RATE", "").strip()),
        lambda: client.find_outbound_voice_profile(label))
    setup.outbound_voice_profile_id = str(ovp.get("id") or "")
    return setup.outbound_voice_profile_id


async def ensure_connection(db) -> tuple:
    """(Telnyx client, credential connection id) for this organisation; made once, then reused.
    The connection must use the organisation's own outbound profile, or its calls would be billed with no limits."""
    from app.services.telnyx_provisioning import _create_or_reuse, client_for

    setup = (await db.execute(select(OrgTelnyx).where(OrgTelnyx.id == _org()).with_for_update())).scalars().first()
    if setup is None or setup.status != "ready":
        raise HumanCallError(409, "Your phone line is not ready yet. Finish setting up your phone numbers first.", "NOT_READY")
    try:
        client = client_for(setup)
        profile = await _ensure_profile(db, setup, client)
        if not profile:
            raise HumanCallError(503, "Calling from the browser is not switched on yet. The Outreach team is setting this up.", "NOT_READY")
        if not setup.credential_connection_id:
            name = f"Browser calls: {_org()}"
            conn = await _create_or_reuse(lambda: client.create_credential_connection(name, profile, _event_url()),
                                          lambda: client.find_credential_connection(name))
            setup.credential_connection_id = str(conn.get("id") or "")
            await db.commit()
            await db.execute(select(OrgTelnyx).where(OrgTelnyx.id == _org()).with_for_update())
        got = await client.get_credential_connection(setup.credential_connection_id)
        used = str(((got or {}).get("outbound") or {}).get("outbound_voice_profile_id") or "")
        if used != profile:
            raise HumanCallError(503, "Calling from the browser is not set up correctly for your account. The Outreach team has been told.", "BAD_SETUP")
        return client, setup.credential_connection_id
    except TelnyxError as err:
        raise HumanCallError(503, scrub(err) or "The phone service did not answer. Try again in a minute.", "PHONE_DOWN")


# A number typed in by hand (or carried over from the old caller ID setting) has no phone-provider number ID, and the browser phone only calls from
# numbers the account provably holds. Looking the number up on the account fills the ID in, so the person does not have to.
_CONFIRM_TRIED: Dict[str, float] = {}
CONFIRM_RETRY_S = 600.0


async def confirm_numbers(db) -> List[str]:
    """Fills in the provider ID of this organisation's saved numbers that the phone account holds. Returns the numbers still not confirmed.
    A number another organisation also holds is never confirmed here, and a failed lookup is not retried for ten minutes."""
    import time

    from app.core.tenancy import current_org, system_scope
    from app.services import telnyx_provisioning as TP

    mine = (await db.execute(select(OrgPhoneNumber).where(OrgPhoneNumber.provider == "telnyx", OrgPhoneNumber.provider_ref == "",
                                                          OrgPhoneNumber.status == "active"))).scalars().all()
    still: List[str] = []
    if not mine:
        return still
    org = current_org()
    client = None
    for n in mine:
        key = f"{org}:{n.e164}"
        if time.monotonic() - _CONFIRM_TRIED.get(key, -CONFIRM_RETRY_S) < CONFIRM_RETRY_S:
            still.append(n.e164)
            continue
        _CONFIRM_TRIED[key] = time.monotonic()
        with system_scope():
            shared = (await db.execute(select(OrgPhoneNumber.id).where(OrgPhoneNumber.e164 == n.e164, OrgPhoneNumber.org_id != org))).first()
        if shared:
            still.append(n.e164)
            continue
        try:
            client = client or TP.client_for(await TP.get_setup(db))
            found = await client.find_phone_number(n.e164)
        except Exception as err:  # the lookup is a convenience: the number simply stays unconfirmed
            logger.info("human calls: could not look up %s on the phone account: %s", n.e164, err)
            still.append(n.e164)
            continue
        if found and found.get("id"):
            n.provider_ref = str(found["id"])
            _CONFIRM_TRIED.pop(key, None)
        else:
            still.append(n.e164)
    await db.commit()
    return still


async def ready_setup(db) -> Any:
    """This organisation's phone setup, finished if it was never started. An account whose number came from the old caller ID setting has no
    setup row, so it is made here the same way the Numbers page makes it (idempotent, nothing is dialled), instead of telling the person
    to go and finish something they cannot find."""
    from app.services import telnyx_provisioning as TP

    setup = await TP.get_setup(db)
    if setup is not None and setup.status == "ready":
        return setup
    if not TP.platform_ready():
        raise HumanCallError(503, "Calling from the browser is not switched on yet. The Outreach team is setting this up.", "NOT_READY")
    from sqlalchemy import text

    from app.models.models import CompanyProfile

    name = ((await db.execute(select(CompanyProfile.name).where(CompanyProfile.id == "default"))).scalar() or "").strip()
    if not name:
        row = (await db.execute(text("SELECT name FROM organizations WHERE id = :i"), {"i": _org()})).first()
        name = row[0] if row else ""
    problem = TP.company_name_problem(name)
    if problem:
        raise HumanCallError(422, problem, "NOT_READY")
    setup = await TP.ensure_setup(db, name)
    await db.commit()
    if setup.status != "ready":
        raise HumanCallError(503, scrub(setup.last_error or "") or "Your phone line is still being set up. Try again in a minute.", "NOT_READY")
    return setup


# ── Starting a call ────────────────────────────────────────────────────────────
async def _owned_caller_id(db, from_number: str) -> Optional[OrgPhoneNumber]:
    from app.services.numbers import normalize

    target = normalize(from_number)
    if not target:
        return None
    return (await db.execute(select(OrgPhoneNumber).where(
        OrgPhoneNumber.e164 == target, OrgPhoneNumber.provider == "telnyx", OrgPhoneNumber.provider_ref != "",
        OrgPhoneNumber.status == "active"))).scalars().first()


async def start(db, *, user_id: str, to: str, from_number: str, lead_id: str = "", record: bool = False, consent_ack: bool = False) -> Dict[str, Any]:
    from app.services import compliance, credits as K
    from app.services.call_log_writer import log_id_for_call
    from app.services.numbers import normalize
    from app.services.telephony_provider import normalize_phone_number
    from app.services.telnyx_provisioning import get_setup

    to_e164 = normalize_phone_number(to)
    if not re.fullmatch(r"\+\d{8,15}", to_e164 or ""):
        raise HumanCallError(400, "That does not look like a phone number. Include the area or country code.", "BAD_NUMBER")
    if record and not consent_ack:
        raise HumanCallError(400, "Confirm that you will tell the person the call is recorded, or turn recording off.", "NO_CONSENT")
    own = await _owned_caller_id(db, from_number)
    if own is None:
        raise HumanCallError(400, "Pick one of your own phone numbers to call from. Get a number first if you have none.", "NO_CALLER_ID")
    setup = await ready_setup(db)
    iso = country_of(to_e164)
    if iso and iso not in (setup.allowed_countries or ["GB"]):
        raise HumanCallError(400, "Calls to that country are not switched on for your account.", "COUNTRY")
    busy = (await db.execute(select(HumanCall.id).where(HumanCall.user_id == user_id, HumanCall.state.in_(OPEN)))).first()
    if busy:
        raise HumanCallError(409, "You already have a call open. Hang up before starting another.", "ALREADY_CALLING")

    ok, why = await K.can_start(db, "voice_minute")
    if not ok:
        raise HumanCallError(402, why, "NO_CREDIT")
    gate = await compliance.check_call_allowed(db, to_e164)
    if not gate.allowed:
        raise HumanCallError(403, " ".join(gate.reasons) or "This call is not allowed.", "BLOCKED", {"reasons": list(gate.reasons)})
    if record:
        ok, why = await K.can_start(db, "voice_minute", 1, extra=[("call_transcript", 1)])
        if not ok:
            raise HumanCallError(402, why, "NO_CREDIT")

    call_id = f"call_{uuid.uuid4().hex[:16]}"
    ok, why, secs = await K.reserve_call(db, call_id)
    if not ok:
        raise HumanCallError(402, why, "NO_CREDIT")
    credential_id = ""
    try:
        if record and secs:  # the minutes must cover the call and its transcript together
            card = await K.rates(db)
            per = card["voice_minute"]["credits"] + card["call_transcript"]["credits"]
            if per > 0:
                secs = max(60, min(secs, int(await K.wallet_balance(db, "voice") // per) * 60))
        client, conn_id = await ensure_connection(db)
        expires = datetime.utcnow() + timedelta(seconds=(secs or K.MAX_CALL_SECS) + EXTRA_SECS)
        cred = await client.create_telephony_credential(conn_id, call_id, _iso(expires))
        credential_id = str(cred.get("id") or "")
        token = await client.telephony_credential_token(credential_id)
        if not credential_id or not token:
            raise TelnyxError("The phone service did not give a login.")
    except (HumanCallError, TelnyxError) as err:
        await K.release(db, [f"{K.CALL_HOLD}{call_id}"])
        if credential_id:
            try:
                await client.delete_telephony_credential(credential_id)
            except Exception:
                pass
        await db.commit()
        if isinstance(err, HumanCallError):
            raise
        raise HumanCallError(503, scrub(err) or "The phone service did not answer. Try again in a minute.", "PHONE_DOWN")

    name = to_e164
    lead_name = ""
    if lead_id:
        from app.models.models import LeadAccount

        acc = await db.get(LeadAccount, lead_id)
        lead_name = (getattr(acc, "name", "") or "") if acc else ""
        name = lead_name or name
    now = datetime.utcnow()
    db.add(HumanCall(id=call_id, user_id=user_id, lead_id=lead_id or None, to_e164=to_e164, from_e164=normalize(from_number),
                     credential_id=credential_id, state="started", started_at=now, max_seconds=secs, warnings=list(gate.warnings),
                     record=bool(record), consent_ack=bool(consent_ack), transcript_state="none"))
    db.add(LiveCall(id=call_id, prospect=name, mission="Human call", state="human", direction="outbound", phone=to_e164,
                    our_number=normalize(from_number), lead_id=lead_id or None, transcript=[]))
    stamp = _iso(now)
    db.add(CallLog(id=log_id_for_call(call_id), canonical_name=name, listed_as=name, channel="voice", mission="human",
                   started_at=stamp, ended_at=stamp, duration="0 min", outcome="contacted", direction="outbound",
                   phone=to_e164, our_number=normalize(from_number), lead_id=lead_id or None, transcript=[]))
    await db.commit()
    return {"call_ref": call_id, "token": token, "login": cred.get("sip_username") or cred.get("user_name") or "", "client_state": call_id,
            "max_seconds": secs, "warnings": list(gate.warnings), "record": bool(record), "to": to_e164, "from": normalize(from_number)}


# ── During and after the call ──────────────────────────────────────────────────
async def _mine(db, call_ref: str, user_id: str) -> HumanCall:
    hc = await db.get(HumanCall, call_ref)
    if hc is None or hc.user_id != user_id:  # someone else's call looks like no call at all
        raise HumanCallError(404, "That call does not exist.", "NOT_FOUND")
    return hc


async def connected(db, call_ref: str, user_id: str, answered: bool) -> Dict[str, Any]:
    hc = await _mine(db, call_ref, user_id)
    if hc.state in OPEN:
        if answered:
            hc.state = "answered"
            hc.answered_at = hc.answered_at or datetime.utcnow()
        elif hc.state == "started":
            hc.state = "ringing"
        await db.commit()
    return {"state": hc.state}


def _duration_text(minutes: int) -> str:
    return f"{minutes} min"


async def _close(db, hc: HumanCall, *, outcome: str = "", note: str = "", now: Optional[datetime] = None) -> None:
    """Close a call once: work out the minutes on our side, charge them, end the live row, delete the login."""
    from app.services import credits as K
    from app.services.call_log_writer import log_id_for_call
    from app.services.telnyx_provisioning import client_for, get_setup

    now = now or datetime.utcnow()
    secs = 0
    if hc.answered_at:
        cap = (hc.max_seconds or K.MAX_CALL_SECS) + 60
        secs = int(max(0, min((now - hc.answered_at).total_seconds(), cap)))
    minutes = math.ceil(secs / 60) if secs > 0 else 0
    hc.state, hc.ended_at, hc.seconds, hc.billed_minutes = "ended", now, secs, minutes
    hc.outcome = outcome or hc.outcome or ""
    hc.note = (note or hc.note or "")[:2000]
    log = await db.get(CallLog, log_id_for_call(hc.id))
    if log is not None:
        log.ended_at = _iso(now)
        log.duration = _duration_text(minutes)
        if hc.outcome in OUTCOMES:
            log.outcome = OUTCOMES[hc.outcome]
        elif not hc.answered_at:
            log.outcome = "no_answer"
        if hc.note:
            log.summary = hc.note
    live = await db.get(LiveCall, hc.id)
    if live is not None:
        live.ended, live.state, live.duration = True, "ended", _duration_text(minutes)
    if hc.outcome == "do_not_call":
        from app.services import compliance

        await compliance.add_do_not_call(db, hc.to_e164, log.canonical_name if log is not None else "")
    if hc.record:
        hc.audio_delete_at = now + timedelta(days=AUDIO_KEEP_DAYS)
        hc.transcript_state = "waiting" if minutes > 0 else "none"
    await db.commit()
    await K.charge_finished_call(db, hc.id, _duration_text(minutes), log.canonical_name if log is not None else "")
    if hc.credential_id:
        try:
            setup = await get_setup(db)
            if setup is not None:
                await client_for(setup).delete_telephony_credential(hc.credential_id)
        except Exception as err:
            logger.warning(f"[human-calls] login for {hc.id} not deleted (it expires on its own): {err}")


async def end(db, call_ref: str, user_id: str, outcome: str = "", note: str = "") -> Dict[str, Any]:
    hc = await _mine(db, call_ref, user_id)
    outcome = outcome if outcome in OUTCOMES else ""
    if hc.state in OPEN:
        await _close(db, hc, outcome=outcome, note=note)
    elif outcome or note:  # the outcome and note may still be saved after a webhook or the sweep closed the call
        hc.outcome, hc.note = outcome or hc.outcome, (note or hc.note or "")[:2000]
        from app.services.call_log_writer import log_id_for_call

        log = await db.get(CallLog, log_id_for_call(hc.id))
        if log is not None:
            if hc.outcome in OUTCOMES:
                log.outcome = OUTCOMES[hc.outcome]
            if hc.note:
                log.summary = hc.note
        await db.commit()
    await maybe_start_transcript(db, hc)
    return public(hc)


def public(hc: HumanCall) -> Dict[str, Any]:
    return {"call_ref": hc.id, "state": hc.state, "seconds": hc.seconds or 0, "minutes": hc.billed_minutes or 0, "outcome": hc.outcome or "",
            "note": hc.note or "", "to": hc.to_e164, "from": hc.from_e164, "lead_id": hc.lead_id, "record": bool(hc.record),
            "transcript": hc.transcript_state or "none", "transcript_error": hc.transcript_error or "",
            "has_audio": bool(hc.recording_path), "started_at": hc.started_at.isoformat() + "Z" if hc.started_at else None}


# ── Telnyx's own call events (the browser can lie or die; Telnyx cannot) ────────
async def on_event(db, event_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Match the event to our call by the client state we gave the browser. Unknown calls are logged and ignored."""
    import base64

    raw = payload.get("client_state") or ""
    try:
        ref = base64.b64decode(raw).decode("utf-8") if raw and not str(raw).startswith("call_") else str(raw)
    except Exception:
        ref = str(raw)
    hc = await db.get(HumanCall, ref) if ref.startswith("call_") else None
    if hc is None:
        logger.info(f"[human-calls] event {event_type} for no known call")
        return {"status": "ignored"}
    sid = str(payload.get("call_session_id") or "")
    if sid and not hc.telnyx_session_id:
        hc.telnyx_session_id = sid
    if event_type == "call.answered" and hc.state in OPEN:
        hc.state, hc.answered_at = "answered", hc.answered_at or datetime.utcnow()
    elif event_type == "call.hangup" and hc.state in OPEN:
        await _close(db, hc)
        await maybe_start_transcript(db, hc)
        return {"status": "closed"}
    elif event_type == "call.recording.saved" and hc.record and not hc.recording_path:
        urls = payload.get("recording_urls") or payload.get("public_recording_urls") or {}
        url = urls.get("mp3") if isinstance(urls, dict) else None
        if url and str(url).startswith("https://"):
            path = await _download(url, hc.id)
            if path:
                hc.recording_path = path
                await db.commit()
                await maybe_start_transcript(db, hc)
                return {"status": "recording_saved"}
    await db.commit()
    return {"status": "ok"}


def recordings_dir() -> str:
    from app.services.call_recorder import RECORDINGS_DIR

    d = os.path.join(RECORDINGS_DIR, RECORDINGS_SUBDIR)
    os.makedirs(d, exist_ok=True)
    return d


async def _download(url: str, ref: str) -> Optional[str]:
    import httpx

    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            r = await client.get(url)
        if r.status_code >= 400 or not r.content:
            return None
        path = os.path.join(recordings_dir(), f"{ref}.mp3")
        with open(path, "wb") as fh:
            fh.write(r.content)
        return path
    except Exception as err:
        logger.warning(f"[human-calls] recording download for {ref} failed: {err}")
        return None


# ── Recording from the browser (used when Telnyx cannot record these calls) ────
async def add_audio(db, call_ref: str, user_id: str, chunk: bytes, ext: str = "webm") -> Dict[str, Any]:
    hc = await _mine(db, call_ref, user_id)
    if not hc.record:
        raise HumanCallError(400, "This call is not being recorded.", "NO_RECORD")
    if hc.state not in OPEN and not (hc.ended_at and datetime.utcnow() - hc.ended_at < AUDIO_LATE):
        raise HumanCallError(409, "That call ended too long ago to add audio.", "TOO_LATE")
    ext = ext if ext in ("webm", "ogg", "mp3", "wav") else "webm"
    path = hc.recording_path or os.path.join(recordings_dir(), f"{hc.id}.{ext}")
    have = os.path.getsize(path) if os.path.exists(path) else 0
    if have + len(chunk) > MAX_AUDIO_BYTES:
        raise HumanCallError(413, "That recording is too large.", "TOO_BIG")
    with open(path, "ab") as fh:
        fh.write(chunk)
    hc.recording_path = path
    await db.commit()
    return {"bytes": have + len(chunk)}


# ── Transcript ─────────────────────────────────────────────────────────────────
_running: set = set()


async def maybe_start_transcript(db, hc: HumanCall) -> None:
    """Start the transcript job once the call has ended and its recording is here."""
    if hc.record and hc.state == "ended" and hc.recording_path and hc.transcript_state in ("waiting", "none") and (hc.billed_minutes or 0) > 0:
        if hc.id in _running:
            return
        hc.transcript_state = "waiting"
        await db.commit()
        _running.add(hc.id)
        org = _org()

        async def job():
            try:
                from app.core.tenancy import org_scope
                from app.database import AsyncSessionLocal

                with org_scope(org):
                    async with AsyncSessionLocal() as s:
                        await run_transcript(s, hc.id)
            finally:
                _running.discard(hc.id)

        try:
            asyncio.get_running_loop().create_task(job())
        except RuntimeError:
            _running.discard(hc.id)


SUMMARY_PROMPT = ("Summarise this phone call between a salesperson (You) and a contact (Them) in two to four plain sentences: what was "
                  "discussed, what was agreed, and the next step if there is one. Use only what is in the call. No headings.")


async def run_transcript(db, call_ref: str) -> Dict[str, Any]:
    """Speech-to-text, save the lines and a summary, then charge once. Nothing is charged when it fails."""
    from app.services import call_summary, credits as K, transcribe as T
    from app.services.call_log_writer import log_id_for_call

    hc = await db.get(HumanCall, call_ref)
    if hc is None or not hc.recording_path or hc.transcript_state == "ready":
        return {"status": "skipped"}
    hc.transcript_state, hc.transcript_error = "working", ""
    await db.commit()
    lines: List[Dict[str, Any]] = []
    error = ""
    for attempt in range(3):
        try:
            lines = await T.transcribe(hc.recording_path)
            error = ""
            break
        except T.TranscribeError as err:
            error = str(err)
        if attempt < 2:
            await asyncio.sleep(TRANSCRIBE_RETRY_S * (attempt + 1))
    if error:
        hc.transcript_state, hc.transcript_error = "failed", error[:300]
        await db.commit()
        return {"status": "failed", "error": error}
    log = await db.get(CallLog, log_id_for_call(hc.id))
    if log is not None:
        log.transcript = [{"who": l["who"], "text": l["text"], "at": round(float(l.get("start") or 0), 1)} for l in lines]
        if len(lines) >= call_summary.MIN_LINES:
            text = "\n".join(f"{'You' if l['who'] == 'you' else 'Them'}: {l['text']}" for l in lines)
            try:
                made = await call_summary._ask(db, SUMMARY_PROMPT, text[:call_summary.PIECE_CHARS], 400)
            except Exception as err:
                logger.warning(f"[human-calls] summary for {hc.id} failed: {err}")
                made = ""
            if made:
                log.summary = (made + (f"\n\nYour note: {hc.note}" if hc.note else ""))[:4000]
    hc.transcript_state = "ready"
    hc.transcript_seconds = hc.seconds or 0
    if lines and not hc.transcript_charged:
        ref = f"transcript:{hc.id}"
        if not await K._already_charged(db, ref, "call_transcript"):
            await K.charge(db, "call_transcript", max(1, hc.billed_minutes or 1), ref, f"Transcript of call with {log.canonical_name if log is not None else hc.to_e164}")
        hc.transcript_charged = True
    await db.commit()
    return {"status": "ready", "lines": len(lines)}


TRANSCRIBE_RETRY_S = 20


async def transcript_of(db, call_ref: str, user_id: str) -> Dict[str, Any]:
    from app.services.call_log_writer import log_id_for_call

    hc = await _mine(db, call_ref, user_id)
    log = await db.get(CallLog, log_id_for_call(hc.id))
    return {**public(hc), "lines": list(log.transcript or []) if log is not None else [], "summary": (log.summary if log is not None else "") or "",
            "name": (log.canonical_name if log is not None else "") or hc.to_e164, "charged": bool(hc.transcript_charged)}


async def retry_transcript(db, call_ref: str, user_id: str) -> Dict[str, Any]:
    hc = await _mine(db, call_ref, user_id)
    if hc.transcript_state != "failed" or not hc.recording_path:
        raise HumanCallError(409, "There is nothing to try again.", "NOTHING_TO_RETRY")
    hc.transcript_state = "waiting"
    await db.commit()
    await maybe_start_transcript(db, hc)
    return public(hc)


# ── The sweep: calls whose tab died, and old audio ─────────────────────────────
async def sweep(db) -> Dict[str, int]:
    """Close open calls long past their cap (charging what was used), start waiting transcripts, delete audio past retention."""
    from app.services import credits as K

    now = datetime.utcnow()
    closed = deleted = 0
    for hc in (await db.execute(select(HumanCall).where(HumanCall.state.in_(OPEN)))).scalars().all():
        limit = (hc.max_seconds or K.MAX_CALL_SECS) + EXTRA_SECS
        if now - hc.started_at > timedelta(seconds=limit) + STALE_AFTER:
            await _close(db, hc, now=now)
            if hc.state == "ended" and not hc.answered_at:
                hc.state = "abandoned"
                await db.commit()
            closed += 1
    for hc in (await db.execute(select(HumanCall).where(HumanCall.transcript_state == "waiting", HumanCall.state == "ended"))).scalars().all():
        await maybe_start_transcript(db, hc)
    for hc in (await db.execute(select(HumanCall).where(HumanCall.recording_path != "", HumanCall.audio_delete_at.isnot(None),
                                                         HumanCall.audio_delete_at < now))).scalars().all():
        try:
            if os.path.exists(hc.recording_path):
                os.remove(hc.recording_path)
        except OSError:
            pass
        hc.recording_path = ""
        deleted += 1
    await db.commit()
    return {"closed": closed, "audio_deleted": deleted}


async def recent(db, user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    from app.services.call_log_writer import log_id_for_call

    rows = (await db.execute(select(HumanCall).where(HumanCall.user_id == user_id).order_by(HumanCall.started_at.desc()).limit(limit))).scalars().all()
    out = []
    for hc in rows:
        log = await db.get(CallLog, log_id_for_call(hc.id))
        out.append({**public(hc), "name": (log.canonical_name if log is not None else "") or hc.to_e164})
    return out
