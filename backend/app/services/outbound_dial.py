"""
Real outbound dialing: one call or a concurrent batch using the configured carrier.

Does not retire other live calls. Starts as many lines as the operator asked for,
capped by live-line count and a CPS stagger so Twilio/Telnyx accept the burst.
Queued prospects auto-dial when a line frees.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.models import CompanyProfile, Connection, LiveCall, Mission, Notification, Prospect
from app.services.process_logger import log_process_event
from app.services.telephony_provider import carrier_registry, normalize_phone_number
from app.websockets.call_hub import call_hub

logger = logging.getLogger("outbound_dial")

MAX_CONCURRENCY = max(1, int(getattr(settings, "OUTBOUND_MAX_CONCURRENCY", 30) or 30))
CPS_GAP_SEC = max(0.15, float(getattr(settings, "OUTBOUND_CPS_GAP_SEC", 0.45) or 0.45))

_drain_lock = asyncio.Lock()


def _cap_concurrency(requested: Optional[int]) -> int:
    try:
        n = int(requested or 5)
    except (TypeError, ValueError):
        n = 5
    return max(1, min(n, MAX_CONCURRENCY))


async def count_active_voice_lines(db: AsyncSession, mission_id: Optional[str] = None) -> int:
    cutoff = datetime.utcnow() - timedelta(minutes=15)
    q = select(LiveCall).where(
        (LiveCall.ended == False)  # noqa: E712
        & (~LiveCall.state.in_(["ended", "failed", "canceled"]))
        & ((LiveCall.created_at == None) | (LiveCall.created_at >= cutoff))  # noqa: E711
    )
    if mission_id:
        q = q.where(LiveCall.mission_id == mission_id)
    res = await db.execute(q)
    return len(list(res.scalars().all()))


async def resolve_from_number(db: AsyncSession, from_number: Optional[str] = None) -> str:
    if from_number and str(from_number).strip():
        return normalize_phone_number(from_number)
    prof = (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()
    if prof and prof.caller_id:
        return normalize_phone_number(prof.caller_id)
    conn_res = await db.execute(select(Connection).where(Connection.group_name == "Telephony"))
    tele_conn = conn_res.scalars().first()
    if tele_conn and isinstance(tele_conn.config, dict) and tele_conn.config.get("phoneNumber"):
        return normalize_phone_number(tele_conn.config.get("phoneNumber"))
    return normalize_phone_number(settings.TWILIO_PHONE_NUMBER or "+447307216767")


async def _resolve_carrier_and_creds(
    db: AsyncSession,
    carrier_choice: Optional[str],
    account_sid: Optional[str] = None,
    api_key: Optional[str] = None,
) -> tuple[str, Dict[str, Any], Optional[Connection]]:
    carrier_choice = (carrier_choice or "").strip().lower()
    conn_res = await db.execute(
        select(Connection).where(
            (Connection.group_name == "Telephony")
            | (Connection.name.ilike("%twilio%"))
            | (Connection.name.ilike("%sipgate%"))
            | (Connection.name.ilike("%telnyx%"))
        )
    )
    tele_conns = conn_res.scalars().all()
    tele_conn = None
    for c in tele_conns:
        if carrier_choice and carrier_choice in (c.name or "").lower():
            tele_conn = c
            break
    if not tele_conn:
        for c in tele_conns:
            if c.status == "connected":
                tele_conn = c
                break
    if not tele_conn and tele_conns:
        tele_conn = tele_conns[0]

    if not carrier_choice:
        if tele_conn:
            name = (tele_conn.name or "").lower()
            if "sipgate" in name:
                carrier_choice = "sipgate"
            elif "telnyx" in name:
                carrier_choice = "telnyx"
            elif "twilio" in name:
                carrier_choice = "twilio"
            else:
                carrier_choice = name
        else:
            carrier_choice = "sipgate" if settings.SIPGATE_SIP_ID else "twilio"

    stored_cfg = tele_conn.config if (tele_conn and isinstance(tele_conn.config, dict)) else {}
    req_sid = (account_sid or "").strip()
    req_token = (api_key or "").strip()

    if req_sid and req_sid.startswith("AC") and len(req_sid) == 34:
        sid = req_sid
    else:
        sid = (stored_cfg.get("account_sid") or "").strip() or None

    if req_token and len(req_token) == 32 and not req_token.startswith("xai-"):
        token = req_token
    else:
        token = (stored_cfg.get("auth_token") or stored_cfg.get("api_key") or "").strip() or None

    if token and token.startswith("xai-"):
        token = None

    if not sid and settings.TWILIO_ACCOUNT_SID:
        sid = settings.TWILIO_ACCOUNT_SID.strip()
    if not token and settings.TWILIO_AUTH_TOKEN:
        token = settings.TWILIO_AUTH_TOKEN.strip()

    if "twilio" in carrier_choice:
        if not sid or not token:
            raise ValueError(
                "Twilio Account SID and Auth Token are required to place real calls. Save them in Connections."
            )
        if not sid.startswith("AC") or len(sid) != 34:
            raise ValueError(
                f"Twilio Account SID is invalid ({len(sid or '')} chars; expected 34 starting with AC)."
            )
        if len(token) != 32:
            raise ValueError(
                f"Twilio Auth Token is invalid ({len(token)} chars; expected 32)."
            )

    credentials = {
        "account_sid": sid,
        "api_key": token,
        "auth_token": token,
        "carrier": carrier_choice,
        "connection_id": stored_cfg.get("connection_id") or stored_cfg.get("telnyx_connection_id"),
    }
    return carrier_choice, credentials, tele_conn


async def place_outbound_call(
    db: AsyncSession,
    *,
    to_number: str,
    from_number: Optional[str] = None,
    prospect_name: Optional[str] = None,
    mission_id: Optional[str] = None,
    mission_title: Optional[str] = None,
    prospect_id: Optional[str] = None,
    carrier: Optional[str] = None,
    account_sid: Optional[str] = None,
    api_key: Optional[str] = None,
    bridge_sip_uri: Optional[str] = None,
) -> Dict[str, Any]:
    """Place one real PSTN call. Leaves other live calls running."""
    to_raw = (to_number or "").strip()
    if not to_raw or len(to_raw) < 7:
        raise ValueError("A valid phone number (at least 7 digits) is required.")

    to_clean = normalize_phone_number(to_raw)
    from_clean = await resolve_from_number(db, from_number)
    carrier_choice, credentials, _tele_conn = await _resolve_carrier_and_creds(
        db, carrier, account_sid, api_key
    )

    from app.services.xai_voice_service import alias_sip_first_call, start_bridged_voice_session

    bridge_sip = bridge_sip_uri or f"sip:{from_clean}@{settings.XAI_SIP_FQDN};transport=tls"
    prospect_label = (prospect_name or "").strip() or f"Prospect ({to_clean[-4:]})"
    mission_label = mission_title or "Direct Outbound Outreach"
    call_id = f"call_{uuid.uuid4().hex[:8]}"

    live_call = LiveCall(
        id=call_id,
        mission_id=mission_id or "m_outbound",
        prospect_id=prospect_id,
        prospect=prospect_label,
        mission=mission_label,
        state="calling",
        channel="voice",
        duration="00:01",
        listening=False,
        taken=False,
        confirming_end=False,
        ended=False,
        booked=False,
        transcript=[
            f"AI: [Outbound call initiated via {carrier_choice.upper()} to {to_clean}]",
            f"System: Ringing {to_clean} from {from_clean}...",
        ],
    )
    try:
        db.add(live_call)
        if prospect_id:
            pres = await db.execute(select(Prospect).where(Prospect.id == prospect_id))
            prow = pres.scalars().first()
            if prow:
                prow.status = "calling"
                prow.time_status = "now"
                prow.note = f"Live outbound via {carrier_choice.upper()} to {to_clean}"
        await db.commit()
    except Exception as live_err:
        try:
            await db.rollback()
        except Exception:
            pass
        logger.warning(f"Could not commit live call record: {live_err}")

    try:
        from app.websockets.media_stream import media_stream_hub
        media_stream_hub.register_alias(call_id, call_id)
    except Exception:
        pass

    await call_hub.broadcast("call_started", {
        "callId": call_id,
        "caller": from_clean,
        "prospect": prospect_label,
        "state": "calling",
        "duration": "00:01",
        "missionId": mission_id,
    })

    try:
        await start_bridged_voice_session(
            call_id=call_id,
            caller_number=from_clean,
            prospect_name=prospect_label,
            is_inbound=False,
        )
    except Exception as bridge_err:
        logger.warning(f"Could not pre-warm voice bridge: {bridge_err}")

    adapter = carrier_registry.get_adapter(carrier_choice)
    try:
        dial_res = await adapter.dial_outbound(
            to_number=to_clean,
            from_number=from_clean,
            bridge_sip_uri=bridge_sip,
            metadata={"call_id": call_id, "prospect": prospect_label},
            credentials=credentials,
        )
        carrier_sid = dial_res.get("call_id")
        if carrier_sid:
            try:
                alias_sip_first_call(call_id, carrier_sid)
                live_call.carrier_sid = carrier_sid
                live_call.transcript = (live_call.transcript or []) + [
                    f"System: Provider Call SID: {carrier_sid}",
                    "System: AI voice pre-warmed. Greeting will start the instant they pick up.",
                ]
                await db.commit()
            except Exception as c_err:
                try:
                    await db.rollback()
                except Exception:
                    pass
                logger.warning(f"Could not persist carrier SID on live_call: {c_err}")
            try:
                from app.websockets.media_stream import media_stream_hub
                media_stream_hub.register_alias(carrier_sid, call_id)
            except Exception:
                pass

        if dial_res.get("simulated") or "sim" in carrier_choice:
            from app.services.xai_voice_service import _run_simulated_xai_session
            asyncio.create_task(_run_simulated_xai_session(call_id, to_clean))

        await log_process_event(
            subsystem="telephony",
            process_name="outbound_place_call",
            message=f"Outbound dispatched to {to_clean} ({prospect_label}) via {adapter.display_name}",
            level="SUCCESS",
            details={"callId": call_id, "to": to_clean, "carrier": carrier_choice, "missionId": mission_id},
        )

        return {
            "success": True,
            "call_id": call_id,
            "carrier_call_id": carrier_sid,
            "carrier": adapter.display_name,
            "status": dial_res.get("status", "ringing"),
            "to": to_clean,
            "from": from_clean,
            "bridge_sip_uri": bridge_sip,
            "prospect": prospect_label,
            "mission_id": mission_id,
            "prospect_id": prospect_id,
            "message": f"Outbound call initiated to {to_clean} via {adapter.display_name}.",
        }
    except Exception as exc:
        err_msg = str(exc)
        logger.error(f"Outbound dial error for {to_clean}: {err_msg}")
        try:
            await db.rollback()
        except Exception:
            pass
        try:
            async with AsyncSessionLocal() as fail_session:
                rec = (await fail_session.execute(select(LiveCall).where(LiveCall.id == call_id))).scalars().first()
                if rec:
                    rec.state = "failed"
                    rec.ended = True
                    rec.transcript = (rec.transcript or []) + [f"System: Dial failed - {err_msg}"]
                if prospect_id:
                    prow = (await fail_session.execute(select(Prospect).where(Prospect.id == prospect_id))).scalars().first()
                    if prow:
                        concurrent_hit = _looks_like_concurrency_limit(err_msg)
                        prow.status = "queued" if concurrent_hit else "retry"
                        prow.time_status = "waiting" if concurrent_hit else "failed"
                        prow.note = f"Dial failed: {err_msg}"
                await fail_session.commit()
        except Exception as update_err:
            logger.warning(f"Could not update failed call state in DB: {update_err}")
        try:
            await call_hub.broadcast("call_ended", {"callId": call_id, "reason": err_msg})
        except Exception:
            pass
        raise RuntimeError(err_msg)


def _looks_like_concurrency_limit(err_msg: str) -> bool:
    t = (err_msg or "").lower()
    return any(
        s in t
        for s in (
            "max concurrent",
            "concurrent calls",
            "too many concurrent",
            "13223",
            "calls per second",
            "cps",
            "rate limit",
            "429",
        )
    )


def _has_dialable_phone(raw: Optional[str]) -> bool:
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    return len(digits) >= 7


def _prospect_display_name(p: Dict[str, Any]) -> str:
    return (
        (p.get("prospect_name") or p.get("contact") or p.get("contact_person") or p.get("name") or "")
        .strip()
        or "Prospect"
    )


async def launch_outbound_mission(
    db: AsyncSession,
    *,
    title: str,
    prospects: List[Dict[str, Any]],
    concurrency: int = 5,
    from_number: Optional[str] = None,
    carrier: Optional[str] = None,
    call_window: str = "09:00–17:30",
    timezone: str = "Europe/London",
    lunch_start: str = "12:00",
    lunch_end: str = "13:00",
    source: str = "manual",
) -> Dict[str, Any]:
    """Persist a mission and immediately dial as many PSTN lines as concurrency allows."""
    concurrency = _cap_concurrency(concurrency)
    mission_id = f"m_{uuid.uuid4().hex[:8]}"
    rows = [p for p in (prospects or []) if _has_dialable_phone(p.get("phone") or p.get("to_number"))]
    if not rows:
        raise ValueError("No dialable phone numbers on this list. Add E.164 mobiles and try again.")

    mission = Mission(
        id=mission_id,
        title=title or f"Outbound list — {len(rows)} contacts",
        sector="Uploaded list",
        region="Uploaded list",
        status="active",
        contacted=0,
        total=len(rows),
        meetings_booked=0,
        created="just now",
        source=source,
        concurrency=concurrency,
        call_window=call_window,
        timezone=timezone,
        lunch_start=lunch_start,
        lunch_end=lunch_end,
        default_channel="voice",
    )
    db.add(mission)

    stored: List[Prospect] = []
    for i, p in enumerate(rows):
        phone = (p.get("phone") or p.get("to_number") or "").strip()
        name = _prospect_display_name(p)
        pid = f"p_{uuid.uuid4().hex[:8]}"
        row = Prospect(
            id=pid,
            mission_id=mission_id,
            name=name,
            contact_person=p.get("contact") or p.get("contact_person") or name,
            phone=normalize_phone_number(phone),
            site=p.get("website") or p.get("site") or "",
            channel="voice",
            status="queued",
            time_status="waiting",
            note="Queued for live outbound",
            sector=p.get("sector") or "General",
            region=p.get("region") or "UK-wide",
        )
        db.add(row)
        stored.append(row)

    notif = Notification(
        id=f"n_{uuid.uuid4().hex[:6]}",
        text=f"Live outbound launched: {len(stored)} contacts, up to {concurrency} simultaneous lines.",
        type="success",
    )
    db.add(notif)
    await db.commit()

    results = await start_mission_dials(
        mission_id,
        from_number=from_number,
        carrier=carrier,
        mission_title=mission.title,
    )

    dialed = sum(1 for r in results if r.get("status") in ("calling", "ringing", "queued_provider"))
    failed = sum(1 for r in results if r.get("status") == "failed")
    queued = sum(1 for r in results if r.get("status") == "queued")

    await call_hub.broadcast("mission_created", {"missionId": mission_id, "title": mission.title})

    return {
        "success": True,
        "mission_id": mission_id,
        "title": mission.title,
        "concurrency": concurrency,
        "total": len(stored),
        "dialed": dialed,
        "queued": queued,
        "failed": failed,
        "cps_gap_sec": CPS_GAP_SEC,
        "results": results,
        "message": (
            f"Placing {dialed} live call{'s' if dialed != 1 else ''} now"
            + (f", {queued} waiting for a free line" if queued else "")
            + (f", {failed} failed to start" if failed else "")
            + f" via the configured telephony provider (max {concurrency} simultaneous)."
        ),
    }


async def start_mission_dials(
    mission_id: str,
    *,
    from_number: Optional[str] = None,
    carrier: Optional[str] = None,
    mission_title: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Dial queued prospects on a mission up to remaining live-line slots."""
    results: List[Dict[str, Any]] = []
    async with AsyncSessionLocal() as db:
        mission = (await db.execute(select(Mission).where(Mission.id == mission_id))).scalars().first()
        if not mission:
            return results
        cap = _cap_concurrency(mission.concurrency)
        live = await count_active_voice_lines(db)
        slots = max(0, cap - live)
        queued = (
            await db.execute(
                select(Prospect)
                .where(Prospect.mission_id == mission_id, Prospect.status == "queued")
                .order_by(Prospect.created_at.asc())
            )
        ).scalars().all()
        to_start = queued[:slots]
        hold = queued[slots:]

        for p in hold:
            results.append({
                "prospect_id": p.id,
                "name": p.name,
                "to": p.phone,
                "status": "queued",
                "message": "Waiting for a free line",
            })

        from_clean = await resolve_from_number(db, from_number)
        title = mission_title or mission.title

        for i, p in enumerate(to_start):
            if i:
                await asyncio.sleep(CPS_GAP_SEC)
            try:
                # Re-open a short session per dial so SQLite does not lock the batch.
                async with AsyncSessionLocal() as dial_db:
                    res = await place_outbound_call(
                        dial_db,
                        to_number=p.phone,
                        from_number=from_clean,
                        prospect_name=p.contact_person or p.name,
                        mission_id=mission_id,
                        mission_title=title,
                        prospect_id=p.id,
                        carrier=carrier,
                    )
                results.append({
                    "prospect_id": p.id,
                    "name": p.name,
                    "to": res.get("to") or p.phone,
                    "status": "calling",
                    "call_id": res.get("call_id"),
                    "carrier": res.get("carrier"),
                    "message": res.get("message"),
                })
            except Exception as exc:
                err = str(exc)
                status = "queued" if _looks_like_concurrency_limit(err) else "failed"
                if status == "queued":
                    async with AsyncSessionLocal() as qdb:
                        prow = (await qdb.execute(select(Prospect).where(Prospect.id == p.id))).scalars().first()
                        if prow:
                            prow.status = "queued"
                            prow.time_status = "waiting"
                            prow.note = f"Provider at capacity — will retry when a line frees. {err}"
                            await qdb.commit()
                results.append({
                    "prospect_id": p.id,
                    "name": p.name,
                    "to": p.phone,
                    "status": status,
                    "error": err,
                    "message": err,
                })
    return results


async def drain_mission_queue(mission_id: Optional[str]) -> None:
    """When a live call ends, start the next queued number on that mission."""
    if not mission_id or mission_id == "m_outbound":
        return
    async with _drain_lock:
        try:
            started = await start_mission_dials(mission_id)
            newly = [r for r in started if r.get("status") == "calling"]
            if newly:
                logger.info(f"Queue drain for {mission_id}: started {len(newly)} next call(s)")
        except Exception as exc:
            logger.warning(f"Queue drain failed for {mission_id}: {exc}")
