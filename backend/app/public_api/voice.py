"""AI phone calls in the public API.

Every call goes through the company's managed call assistant, so a goal, questions, a saved script,
guidance during the call, taking over and handing back all work the same way as in the app. Credits,
call hours and do-not-call rules are the app's own.
"""
from __future__ import annotations

import logging
import os
import re
import time
import uuid
from datetime import datetime
from types import SimpleNamespace
from typing import Any, Dict, List, Literal, Optional, Union

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models.models import ConversationTemplate, LiveCall, PublicObject
from app.public_api import links
from app.public_api.calls_view import load_call
from app.public_api.core import V1Route, authorize, fail, is_test, page_args, page_of

logger = logging.getLogger("public_api.voice")
router = APIRouter(prefix="/voice", tags=["Phone calls"], route_class=V1Route)

SANDBOX_PREFIX = "call_test_"
SANDBOX_RING_S = 2.0
MAX_NUMBERS = 25


def sandbox_seconds() -> float:
    try:
        return float(os.getenv("PUBLIC_API_SANDBOX_CALL_SECONDS", "8"))
    except ValueError:
        return 8.0


# ── Request bodies ───────────────────────────────────────────────────────────
class QuestionIn(BaseModel):
    ask: str = Field(..., min_length=2, max_length=300, description="What to ask")
    key: Optional[str] = Field(None, max_length=40, description="The name its answer is saved under (default: made from the question)")


class CallIn(BaseModel):
    to: Union[str, List[str]] = Field(..., description="A phone number, or a list of up to 25")
    lead_name: Optional[str] = Field(None, max_length=120, description="Who is being called")
    goal: Optional[str] = Field(None, max_length=2000, description="What this call should achieve, e.g. book a 15 minute demo")
    instructions: Optional[str] = Field(None, max_length=4000, description="Anything else the AI should know or do on this call")
    questions: Optional[List[Union[str, QuestionIn]]] = Field(None, max_length=10, description="Things to find out; the answers come back in 'answers'")
    script_id: Optional[str] = Field(None, description="One of your saved scripts (GET /v1/voice/scripts)")
    variables: Optional[Dict[str, str]] = Field(None, description="Facts about this person or company the AI may use")
    from_number: Optional[str] = Field(None, description="Which of your numbers to call from")
    accept_short_call: bool = Field(False, description="Call even if your credits only cover a short call")


class ControlIn(BaseModel):
    action: Literal["guide", "take_over", "hand_back"]
    message: Optional[str] = Field(None, max_length=1000, description="guide: what the AI should do from now on")
    phone: Optional[str] = Field(None, description="take_over: the number to ring so you can talk to the person")
    note: Optional[str] = Field(None, max_length=500, description="hand_back: what the AI should know when it carries on")


# ── The brief the AI gets ────────────────────────────────────────────────────
def _slug(text: str) -> str:
    return (re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_") or "answer")[:40]


def questions_of(raw: Optional[List[Union[str, QuestionIn, dict]]]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    for i, q in enumerate(raw or [], 1):
        ask = q if isinstance(q, str) else (q.ask if isinstance(q, QuestionIn) else str(q.get("ask") or ""))
        key = None if isinstance(q, str) else (q.key if isinstance(q, QuestionIn) else q.get("key"))
        ask = ask.strip()
        if not ask:
            continue
        k = _slug(key or ask)
        if any(x["key"] == k for x in out):
            k = f"{k}_{i}"
        out.append({"key": k, "ask": ask})
    return out


def compose_instructions(body: CallIn, questions: List[Dict[str, str]]) -> str:
    parts: List[str] = []
    if (body.goal or "").strip():
        parts.append(f"The goal of this call: {body.goal.strip()}")
    if (body.instructions or "").strip():
        parts.append(f"Instructions from the business for this call: {body.instructions.strip()}")
    if body.variables:
        parts.append("Facts you may use: " + "; ".join(f"{k}: {v}" for k, v in list(body.variables.items())[:30]))
    if questions:
        lines = [f'{i}. {q["ask"]}  (save the answer as "{q["key"]}")' for i, q in enumerate(questions, 1)]
        parts.append("Find out the following during the call. Ask naturally, one at a time, and do not skip one unless the person "
                     "refuses:\n" + "\n".join(lines) + "\nBefore the call ends, call save_outcome and put each answer in fields, "
                     "using exactly those names. Leave a name out if you did not get an answer.")
    if not parts:
        return ""
    return "=== SPECIAL INSTRUCTIONS FOR THIS CALL (they come first) ===\n" + "\n\n".join(parts) + "\n=== END OF SPECIAL INSTRUCTIONS ==="


# ── What a customer sees ─────────────────────────────────────────────────────
async def full_view(db: AsyncSession, call_id: str, org: str) -> Dict[str, Any]:
    if call_id.startswith(SANDBOX_PREFIX):
        o = await db.get(PublicObject, call_id)
        if not o or o.kind != "sandbox_call":
            fail(404, "not_found", f"Call '{call_id}' not found.")
        return sandbox_view(o, org)
    call = await load_call(db, call_id)
    if not call:
        fail(404, "not_found", f"Call '{call_id}' not found.")
    call["live_url"] = links.preview_url("call", call["id"], org)
    call["recording_url"] = f"{links.public_base()}/v1/voice/calls/{call['id']}/recording" if call["status"] in ("completed", "no_answer") else None
    return call


def sandbox_view(o: PublicObject, org: str) -> Dict[str, Any]:
    d = dict(o.data or {})
    elapsed = time.time() - d["created_s"]
    done = elapsed >= sandbox_seconds()
    if d.get("ended"):
        status = "canceled"
    elif done:
        status = "completed"
    else:
        status = "ringing" if elapsed < SANDBOX_RING_S else "in_progress"
    answers = {q["key"]: "Test answer" for q in d.get("questions", [])} if done and not d.get("ended") else {}
    booked = done and not d.get("ended") and "meeting" in f'{d.get("goal", "")} {d.get("instructions", "")}'.lower()
    transcript = []
    if status in ("in_progress", "completed"):
        transcript = [{"who": "ai", "text": "Hello, this is a test call."}, {"who": "them", "text": "Hi, go ahead."}]
    if done and not d.get("ended"):
        transcript += [{"who": "ai", "text": q["ask"]} for q in d.get("questions", [])] + [{"who": "them", "text": "Test answer."}]
    live = status in ("ringing", "in_progress")
    return {
        "id": o.id, "status": status, "to": d["to"], "to_name": d.get("name") or "", "started_at": d["created_at"],
        "duration_seconds": 42 if done and not d.get("ended") else 0,
        "outcome": ("meeting_booked" if booked else "interested") if done and not d.get("ended") else None,
        "meeting_booked": booked, "answers": answers, "transcript": transcript,
        "human": {"taken_over": bool(d.get("taken")) and live, "listening": False},
        "capabilities": {"guide": live and not d.get("taken"), "take_over": live and not d.get("taken"),
                         "hand_back": live and bool(d.get("taken")), "end": live},
        "live_url": links.preview_url("call", o.id, org), "recording_url": None, "test": True,
    }


# ── Placing a call ───────────────────────────────────────────────────────────
async def _extra_allowed(db: AsyncSession, org: str, extra: str, script_id: str) -> None:
    """Goals, questions and scripts reach the AI only through its managed assistant."""
    from app.services import voice_assistants as VA

    if (extra or script_id) and not VA.enabled_for_org(org):
        fail(409, "custom_script_unavailable", "Goals, questions and scripts are not switched on for your account yet. "
             "Ask the Outreach team, or place the call without them.")
    if script_id:
        t = (await db.execute(select(ConversationTemplate).where(ConversationTemplate.id == script_id))).scalars().first()
        if t is None or t.call_direction != "outbound":
            fail(422, "invalid_script", "script_id is not one of your outbound scripts. List them with GET /v1/voice/scripts.",
                 script_id=script_id)


async def _place(db: AsyncSession, ctx: Dict[str, Any], number: str, body: CallIn, extra: str) -> Dict[str, Any]:
    from app.services.numbers import pick_caller_id
    from app.services.telephony_provider import normalize_phone_number
    from app.services.telnyx_assistant_dial import dial_via_telnyx_assistant

    try:
        clean = normalize_phone_number(number)
    except Exception:
        fail(422, "invalid_phone_number", f"'{number}' is not a valid phone number. Use the international form, e.g. +447911123456.", to=number)
    if len(re.sub(r"\D", "", clean)) < 7:
        fail(422, "invalid_phone_number", f"'{number}' is not a valid phone number.", to=number)
    # The key belongs to the company, so it may use any of the company's numbers.
    picked, err = await pick_caller_id(db, {"operator_id": ctx.get("operator_id"), "is_admin": True}, body.from_number)
    if err:
        fail(403, "number_not_allowed", err)
    if not body.accept_short_call:
        from app.services.credits import short_call_warning

        warning = await short_call_warning(db)
        if warning:
            fail(409, "short_call", warning.get("message") or "Your credits only cover a short call.", accept_with="accept_short_call")
    result = await dial_via_telnyx_assistant(
        db, clean, from_number_override=picked, prospect_name=body.lead_name, mission_title="API call", operator_id="",
        template_id=body.script_id or "", extra_instructions=extra)
    if not result.get("success"):
        msg = result.get("error") or "The call could not be placed."
        if result.get("code") == "OUT_OF_CREDITS":
            fail(402, "insufficient_credits", msg, top_up_url=links.fix_url("billing"))
        if (result.get("compliance") or {}).get("blocked"):
            fail(422, "call_not_allowed", msg, reasons=result["compliance"].get("reasons", []))
        fail(502, "could_not_dial", msg)
    call_id = result["callId"]
    db.add(PublicObject(id=f"callmeta_{call_id}", kind="call_meta", data={"key_id": ctx.get("key_id"), "to": clean}))
    await db.commit()
    return await full_view(db, call_id, ctx["org_id"])


def _sandbox_call(db: AsyncSession, ctx: Dict[str, Any], number: str, body: CallIn, questions: List[Dict[str, str]]) -> PublicObject:
    from app.services.telephony_provider import normalize_phone_number

    try:
        clean = normalize_phone_number(number)
    except Exception:
        fail(422, "invalid_phone_number", f"'{number}' is not a valid phone number.", to=number)
    o = PublicObject(id=f"{SANDBOX_PREFIX}{uuid.uuid4().hex[:10]}", kind="sandbox_call", data={
        "to": clean, "name": body.lead_name or "", "goal": body.goal or "", "instructions": body.instructions or "",
        "questions": questions, "created_s": time.time(), "created_at": datetime.utcnow().isoformat() + "Z"})
    db.add(o)
    return o


def _announce_sandbox(org: str, call_id: str, view_after) -> None:
    """A test call "finishes" after a few seconds: the customer's webhook hears it, marked as a test."""
    import asyncio

    from app.services.webhook_dispatcher import dispatch_event

    loop = asyncio.get_running_loop()
    loop.call_later(sandbox_seconds(), lambda: dispatch_event(org, "call.completed", view_after(), test=True))


# ── Routes ───────────────────────────────────────────────────────────────────
@router.post("/calls", status_code=202)
async def create(body: CallIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Place one call (or up to 25). The AI follows your goal, instructions and questions; watch call.completed or poll the call."""
    ctx = await authorize(request, db, "voice:calls", "voice")
    numbers = [body.to] if isinstance(body.to, str) else list(body.to)
    if not numbers or len(numbers) > MAX_NUMBERS:
        fail(422, "invalid_request", f"Send between 1 and {MAX_NUMBERS} numbers.")
    questions = questions_of(body.questions)
    extra = compose_instructions(body, questions)
    org = ctx["org_id"]

    if is_test(ctx):
        made = [_sandbox_call(db, ctx, n, body, questions) for n in numbers]
        await db.commit()
        for o in made:
            _announce_sandbox(org, o.id, lambda o=o: sandbox_view(o, org))
        views = [sandbox_view(o, org) for o in made]
        return views[0] if isinstance(body.to, str) else {"data": views, "failed": []}

    await _extra_allowed(db, org, extra, body.script_id or "")
    if isinstance(body.to, str):
        return await _place(db, ctx, numbers[0], body, extra)
    placed: List[Dict[str, Any]] = []
    failed: List[Dict[str, Any]] = []
    from app.public_api.core import ApiError

    for n in numbers:
        try:
            placed.append(await _place(db, ctx, n, body, extra))
        except ApiError as err:  # one bad number does not stop the others
            await db.rollback()
            failed.append({"to": n, "error": {"code": err.code, "message": err.message}})
    if not placed:
        first = failed[0]["error"]
        fail(422 if first["code"] in ("invalid_phone_number", "call_not_allowed") else 502, first["code"], first["message"], failed=failed)
    return {"data": placed, "failed": failed}


@router.get("/calls/{call_id}")
async def get_one(call_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await authorize(request, db, "voice:calls", "voice")
    return await full_view(db, call_id, ctx["org_id"])


@router.get("/calls")
async def list_calls(request: Request, status: Optional[str] = None, limit: int = 20, cursor: str = "", db: AsyncSession = Depends(get_db)):
    """The calls made through the API, newest first."""
    ctx = await authorize(request, db, "voice:calls", "voice")
    lim, off = page_args(limit, cursor)
    kind = "sandbox_call" if is_test(ctx) else "call_meta"
    rows = (await db.execute(select(PublicObject).where(PublicObject.kind == kind).order_by(PublicObject.created_at.desc())
                             .offset(off).limit((lim + 1) * (3 if status else 1)))).scalars().all()
    items: List[Dict[str, Any]] = []
    for o in rows:
        cid = o.id if kind == "sandbox_call" else o.id.removeprefix("callmeta_")
        try:
            items.append(await full_view(db, cid, ctx["org_id"]))
        except Exception:
            continue  # the call itself was cleared from the app
    if status:
        items = [i for i in items if i["status"] == status]
    return page_of(items, lim, off)


async def do_end(db: AsyncSession, org: str, call_id: str) -> Dict[str, Any]:
    if call_id.startswith(SANDBOX_PREFIX):
        o = await db.get(PublicObject, call_id)
        if not o:
            fail(404, "not_found", f"Call '{call_id}' not found.")
        if sandbox_view(o, org)["status"] not in ("ringing", "in_progress"):
            fail(409, "already_ended", "This call has already ended.")
        o.data = {**o.data, "ended": True}
        await db.commit()
        return sandbox_view(o, org)
    from app.api.calls import terminate_live_call

    live = (await db.execute(select(LiveCall).where(LiveCall.id == call_id))).scalars().first()
    if not live:
        if await load_call(db, call_id):
            fail(409, "already_ended", "This call has already ended.")
        fail(404, "not_found", f"Call '{call_id}' not found.")
    if live.ended:
        fail(409, "already_ended", "This call has already ended.")
    result = await terminate_live_call(call_id, db, ended_by="api")
    if not result.get("ok"):
        fail(409, "could_not_end", result.get("error") or "The call could not be ended.")
    return await full_view(db, call_id, org)


@router.delete("/calls/{call_id}")
async def end(call_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Hang up a call that is ringing or in progress."""
    ctx = await authorize(request, db, "voice:calls", "voice")
    return await do_end(db, ctx["org_id"], call_id)


async def do_control(db: AsyncSession, org: str, key_id: str, call_id: str, body: ControlIn) -> Dict[str, Any]:
    if call_id.startswith(SANDBOX_PREFIX):
        o = await db.get(PublicObject, call_id)
        if not o:
            fail(404, "not_found", f"Call '{call_id}' not found.")
        caps = sandbox_view(o, org)["capabilities"]
        if not caps.get(body.action):
            fail(409, "not_possible", f"'{body.action}' is not possible on this call right now.", capabilities=caps)
        if body.action != "guide":
            o.data = {**o.data, "taken": body.action == "take_over"}
            await db.commit()
        return sandbox_view(o, org)

    live = (await db.execute(select(LiveCall).where(LiveCall.id == call_id))).scalars().first()
    if not live:
        fail(404, "not_found", f"Call '{call_id}' not found.")
    view = await load_call(db, call_id)
    if not view["capabilities"].get(body.action):
        fail(409, "not_possible", f"'{body.action}' is not possible on this call right now.", capabilities=view["capabilities"])
    from app.services import voice_takeover as T
    from app.services.telnyx_client import TelnyxError

    try:
        if body.action == "guide":
            await T.guide(db, live, body.message or "")
        elif body.action == "take_over":
            phone = (body.phone or "").strip()
            if not phone:
                fail(422, "invalid_request", "take_over needs 'phone': the number we should ring so you can talk to the person.")
            await T.take_over(db, live, SimpleNamespace(id=f"api:{key_id}", name="Your team", phone=phone))
        else:
            await T.hand_back(db, live, body.note or "")
    except ValueError as err:
        fail(409, "control_failed", str(err))
    except TelnyxError as err:
        fail(502, "control_failed", f"The phone network refused that: {err}")
    return await full_view(db, call_id, org)


@router.post("/calls/{call_id}/control")
async def control(call_id: str, body: ControlIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Steer a live call: tell the AI what to do now, take the call yourself (we ring your phone), or hand it back."""
    ctx = await authorize(request, db, "voice:calls", "voice")
    return await do_control(db, ctx["org_id"], str(ctx.get("key_id")), call_id, body)


@router.get("/calls/{call_id}/recording")
async def recording(call_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """The call's recording (needs your key, like everything else)."""
    ctx = await authorize(request, db, "voice:calls", "voice")
    if call_id.startswith(SANDBOX_PREFIX):
        fail(404, "not_found", "Test calls have no recording.")
    from fastapi import HTTPException

    from app.api.calls import _recording_path

    try:
        path = await _recording_path(db, call_id)
    except HTTPException:
        fail(404, "not_found", "There is no recording for this call.")
    return FileResponse(path, media_type="audio/mpeg" if path.endswith(".mp3") else "audio/wav", headers={"Accept-Ranges": "bytes"})


@router.get("/scripts")
async def scripts(request: Request, db: AsyncSession = Depends(get_db)):
    """Your saved outbound call scripts. Use an id as script_id when placing a call."""
    await authorize(request, db, "voice:calls", "voice")
    rows = (await db.execute(select(ConversationTemplate).where(ConversationTemplate.call_direction == "outbound")
                             .order_by(ConversationTemplate.name))).scalars().all()
    return {"data": [{"id": t.id, "name": t.name, "description": t.description or "", "type": t.mission_type or ""} for t in rows]}
