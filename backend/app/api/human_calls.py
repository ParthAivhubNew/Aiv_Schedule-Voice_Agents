"""Calls a person makes themselves from the browser.

Signed in (Voice / Calling):  /human-calls/...
Telnyx -> us (signed, no sign-in):  /human-calls/events
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.auth_middleware import current
from app.database import AsyncSessionLocal, get_db
from app.models.models import HumanCall, OrgPhoneNumber
from app.services import human_calls as HC

logger = logging.getLogger("human_calls_api")

router = APIRouter(prefix="/human-calls", tags=["Human calls"])

MAX_CHUNK_BYTES = 8 * 1024 * 1024


class StartIn(BaseModel):
    to: str
    from_number: str
    lead_id: Optional[str] = None
    record: bool = False
    consent_ack: bool = False


class ConnectedIn(BaseModel):
    answered: bool = False


class EndIn(BaseModel):
    outcome: Optional[str] = ""
    note: Optional[str] = ""


def _fail(err: HC.HumanCallError) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.message)


@router.get("/config")
async def config(request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """What the phone panel needs: the numbers it can call from, what a minute costs and how many are left."""
    from app.services import credits as K

    current(request)
    unconfirmed = await HC.confirm_numbers(db)  # a number saved by hand gets its provider ID here when the phone account holds it
    numbers = (await db.execute(select(OrgPhoneNumber).where(
        OrgPhoneNumber.provider == "telnyx", OrgPhoneNumber.provider_ref != "", OrgPhoneNumber.status == "active"))).scalars().all()
    card = await K.rates(db)
    return {"numbers": [{"e164": n.e164, "label": n.label or "", "default": bool(n.is_default)} for n in numbers],
            "rates": {"call": card["voice_minute"]["credits"], "transcript": card["call_transcript"]["credits"]},
            "unconfirmed": unconfirmed, "minutes_left": await K.minutes_left(db), "record_default": False,
            "audio_keep_days": HC.AUDIO_KEEP_DAYS}


@router.post("/start")
async def start(body: StartIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ctx = current(request)
    try:
        return await HC.start(db, user_id=ctx["operator_id"], to=body.to, from_number=body.from_number, lead_id=body.lead_id or "",
                              record=body.record, consent_ack=body.consent_ack)
    except HC.HumanCallError as err:
        raise _fail(err)


@router.post("/{call_ref}/connected")
async def connected(call_ref: str, body: ConnectedIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    try:
        return await HC.connected(db, call_ref, current(request)["operator_id"], body.answered)
    except HC.HumanCallError as err:
        raise _fail(err)


@router.post("/{call_ref}/end")
async def end(call_ref: str, body: EndIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    try:
        return await HC.end(db, call_ref, current(request)["operator_id"], body.outcome or "", body.note or "")
    except HC.HumanCallError as err:
        raise _fail(err)


@router.post("/{call_ref}/audio")
async def add_audio(call_ref: str, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """A piece of the call's recording from the browser (raw bytes)."""
    chunk = await request.body()
    if not chunk:
        raise HTTPException(status_code=400, detail="Nothing was sent.")
    if len(chunk) > MAX_CHUNK_BYTES:
        raise HTTPException(status_code=413, detail="That piece of audio is too large.")
    ext = "ogg" if "ogg" in (request.headers.get("content-type") or "") else "webm"
    try:
        return await HC.add_audio(db, call_ref, current(request)["operator_id"], chunk, ext)
    except HC.HumanCallError as err:
        raise _fail(err)


@router.get("/{call_ref}/audio")
async def get_audio(call_ref: str, request: Request, db: AsyncSession = Depends(get_db)):
    try:
        hc = await HC._mine(db, call_ref, current(request)["operator_id"])
    except HC.HumanCallError as err:
        raise _fail(err)
    if not hc.recording_path or not os.path.exists(hc.recording_path):
        raise HTTPException(status_code=404, detail="The recording is no longer kept.")
    return FileResponse(hc.recording_path)


@router.get("/{call_ref}/transcript")
async def transcript(call_ref: str, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    try:
        return await HC.transcript_of(db, call_ref, current(request)["operator_id"])
    except HC.HumanCallError as err:
        raise _fail(err)


@router.post("/{call_ref}/transcribe")
async def retry(call_ref: str, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    try:
        return await HC.retry_transcript(db, call_ref, current(request)["operator_id"])
    except HC.HumanCallError as err:
        raise _fail(err)


@router.get("/mine")
async def mine(request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    return {"calls": await HC.recent(db, current(request)["operator_id"])}


@router.post("/events")
async def events(request: Request):
    """Telnyx tells us how a browser call went. Signed by Telnyx; the call is found by the client state we gave the browser."""
    from app.core.tenancy import org_scope, system_scope
    from app.services.telnyx_assistant_sync import resolve_telnyx_public_key
    from app.services.telnyx_signature import verify_telnyx_ed25519_signature

    raw = await request.body()
    async with AsyncSessionLocal() as key_db:
        public_key = await resolve_telnyx_public_key(key_db)
    if not verify_telnyx_ed25519_signature(raw, dict(request.headers), public_key=public_key):
        return JSONResponse({"error": "bad signature"}, status_code=401)
    try:
        data = (json.loads(raw.decode("utf-8") or "{}") or {}).get("data") or {}
    except ValueError:
        return JSONResponse({"error": "bad body"}, status_code=400)
    payload = data.get("payload") or {}
    ref = str(payload.get("client_state") or "")
    if ref and not ref.startswith("call_"):
        try:
            import base64

            ref = base64.b64decode(ref).decode("utf-8")
        except Exception:
            ref = ""
    if not ref.startswith("call_"):
        return {"status": "ignored"}
    with system_scope():
        async with AsyncSessionLocal() as s:
            hc = await s.get(HumanCall, ref)
            org = hc.org_id if hc is not None else ""
    if not org:
        return {"status": "ignored"}
    with org_scope(org):
        async with AsyncSessionLocal() as s:
            return await HC.on_event(s, str(data.get("event_type") or ""), payload)
