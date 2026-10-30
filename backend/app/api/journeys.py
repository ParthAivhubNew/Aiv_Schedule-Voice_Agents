"""Journeys: the screen's API. Every route is a thin wrapper over app.services.journeys, the same functions the AI chat uses.

GET    /journeys                      every journey, with its numbers
GET    /journeys/templates            the ready-made journeys
POST   /journeys                      a new draft (name, goal, steps)
POST   /journeys/from-template        a draft from a ready-made journey
POST   /journeys/draft                a draft written by the AI from the business profile and a goal
GET    /journeys/tasks                manual steps waiting for a person (status, journey, due today)
POST   /journeys/tasks/{id}/done|skip
GET    /journeys/{id}                 one journey: steps, settings, the check before starting, tasks, people
PUT    /journeys/{id}/steps           replace the steps (people keep their place)
PATCH  /journeys/{id}/settings        name, goal, sending days and hours, mailboxes, daily cap, exit rules
POST   /journeys/{id}/status          running | paused | stopped
POST   /journeys/{id}/people          add people (a list, or people given); dry_run only counts
GET    /journeys/{id}/suggestions     plain advice from the journey's own numbers
POST   /journeys/{id}/clone, DELETE /journeys/{id}
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.auth_middleware import current
from app.database import get_db
from app.models.models import EmailCampaign, EmailEnrollment, EmailSequenceStep, JourneyTask
from app.services import journeys as J

router = APIRouter(prefix="/journeys", tags=["Journeys"])


async def _journey(db: AsyncSession, journey_id: str) -> EmailCampaign:
    camp = (await db.execute(select(EmailCampaign).where(EmailCampaign.id == journey_id))).scalars().first()
    if not camp:
        raise HTTPException(status_code=404, detail="That journey isn't there any more.")
    return camp


def _fail(err: J.JourneyError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(err))


class JourneyIn(BaseModel):
    name: str
    goal: str = ""
    steps: List[Dict[str, Any]] = []
    mailbox_ids: Optional[List[str]] = None
    settings: Dict[str, Any] = {}


class TemplateIn(BaseModel):
    key: str
    name: str = ""


class DraftIn(BaseModel):
    goal: str
    audience: str = ""
    channels: List[str] = []
    count: int = 3
    name: str = ""


class StepsIn(BaseModel):
    steps: List[Dict[str, Any]]


class StatusIn(BaseModel):
    status: str


class PeopleIn(BaseModel):
    list_id: str = ""
    how_many: int = 200
    people: List[Dict[str, Any]] = []
    dry_run: bool = False


class TaskIn(BaseModel):
    outcome: str = ""


@router.get("")
async def list_all(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    return {"journeys": await J.list_journeys(db, ctx["org_id"])}


@router.get("/templates")
async def ready_made(request: Request):
    current(request)
    return {"templates": J.templates()}


@router.post("")
async def create(body: JourneyIn, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    try:
        camp = await J.create(db, name=body.name, goal=body.goal, steps=body.steps, mailbox_ids=body.mailbox_ids, settings=body.settings, owner_id=ctx.get("operator_id") or "")
    except J.JourneyError as err:
        raise _fail(err)
    await db.commit()
    return {"journey": await J.summary(db, camp, ctx["org_id"])}


@router.post("/from-template")
async def from_template(body: TemplateIn, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    try:
        camp = await J.from_template(db, body.key, name=body.name, owner_id=ctx.get("operator_id") or "")
    except J.JourneyError as err:
        raise _fail(err)
    await db.commit()
    return {"journey": await J.summary(db, camp, ctx["org_id"])}


@router.post("/draft")
async def draft(body: DraftIn, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    try:
        camp = await J.ai_draft(db, ctx, goal=body.goal, audience=body.audience, channels=body.channels, count=body.count, name=body.name,
                                owner_id=ctx.get("operator_id") or "")
    except J.JourneyError as err:
        raise _fail(err)
    except Exception as err:  # the AI being unavailable must not look like a bug: say so and let them use a ready-made journey
        raise HTTPException(status_code=503, detail=f"The writer isn't available just now ({str(err)[:120]}). Pick a ready-made journey instead.")
    await db.commit()
    return {"journey": await J.summary(db, camp, ctx["org_id"])}


@router.get("/tasks")
async def tasks(request: Request, status: str = "open", journey: str = "", today: bool = False, db: AsyncSession = Depends(get_db)):
    current(request)
    due = (datetime.utcnow().replace(hour=23, minute=59, second=59) if today else None)
    return {"tasks": await J.list_tasks(db, status=status, campaign_id=journey, due_before=due)}


@router.post("/tasks/{task_id}/done")
async def task_done(task_id: str, body: TaskIn, request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    try:
        out = await J.complete_task(db, task_id, "done", body.outcome)
    except J.JourneyError as err:
        raise _fail(err)
    await db.commit()
    return {"task": out}


@router.post("/tasks/{task_id}/skip")
async def task_skip(task_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    try:
        out = await J.complete_task(db, task_id, "skipped")
    except J.JourneyError as err:
        raise _fail(err)
    await db.commit()
    return {"task": out}


@router.get("/{journey_id}")
async def one(journey_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    return {"journey": await J.summary(db, await _journey(db, journey_id), ctx["org_id"])}


@router.put("/{journey_id}/steps")
async def put_steps(journey_id: str, body: StepsIn, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    camp = await _journey(db, journey_id)
    try:
        await J.save_steps(db, camp, J.clean_steps(body.steps))
    except J.JourneyError as err:
        raise _fail(err)
    await db.commit()
    return {"journey": await J.summary(db, camp, ctx["org_id"])}


@router.patch("/{journey_id}/settings")
async def patch_settings(journey_id: str, body: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    camp = await _journey(db, journey_id)
    try:
        await J.update_settings(db, camp, body)
    except J.JourneyError as err:
        raise _fail(err)
    await db.commit()
    return {"journey": await J.summary(db, camp, ctx["org_id"])}


@router.post("/{journey_id}/status")
async def status(journey_id: str, body: StatusIn, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    camp = await _journey(db, journey_id)
    try:
        await J.set_status(db, camp, body.status, ctx["org_id"])
    except J.JourneyError as err:
        raise _fail(err)
    await db.commit()
    return {"journey": await J.summary(db, camp, ctx["org_id"])}


@router.post("/{journey_id}/people")
async def add_people(journey_id: str, body: PeopleIn, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    camp = await _journey(db, journey_id)
    try:
        people = body.people or (await J.people_from_list(db, body.list_id, body.how_many) if body.list_id else [])
        if not people:
            raise J.JourneyError("Choose a list, or give the people to add.")
        out = await J.enrol(db, camp, people, ctx["org_id"], dry_run=body.dry_run)
    except J.JourneyError as err:
        raise _fail(err)
    if not body.dry_run:
        await db.commit()
    return {**out, "dry_run": body.dry_run}


@router.delete("/{journey_id}/people/{enrollment_id}")
async def remove_person(journey_id: str, enrollment_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    row = (await db.execute(select(EmailEnrollment).where(EmailEnrollment.id == enrollment_id, EmailEnrollment.campaign_id == journey_id))).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="That person isn't in this journey.")
    await J.cancel_tasks(db, row.id)
    await db.delete(row)
    await db.commit()
    return {"ok": True}


@router.get("/{journey_id}/suggestions")
async def suggestions(journey_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    camp = await _journey(db, journey_id)
    steps = [J.step_out(s) for s in await J.steps_of(db, camp.id)]
    return {"suggestions": J.suggestions_from(await J.results(db, camp), steps)}


@router.post("/{journey_id}/clone")
async def clone(journey_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = current(request)
    copy = await J.clone(db, await _journey(db, journey_id))
    await db.commit()
    return {"journey": await J.summary(db, copy, ctx["org_id"])}


@router.delete("/{journey_id}")
async def delete(journey_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    current(request)
    camp = await _journey(db, journey_id)
    for model in (EmailEnrollment, EmailSequenceStep, JourneyTask):
        for row in (await db.execute(select(model).where(model.campaign_id == camp.id))).scalars().all():
            await db.delete(row)
    await db.delete(camp)
    await db.commit()
    return {"ok": True}


class ChangesIn(BaseModel):
    changes: List[Dict[str, Any]]


@router.post("/{journey_id}/changes")
async def apply_changes(journey_id: str, body: ChangesIn, request: Request, db: AsyncSession = Depends(get_db)):
    """The same changes the chat offers (add, remove or change a step, a wait, a setting), applied when the person confirms them on screen."""
    ctx = current(request)
    camp = await _journey(db, journey_id)
    try:
        await J.apply_changes(db, camp, body.changes)
    except J.JourneyError as err:
        raise _fail(err)
    await db.commit()
    return {"journey": await J.summary(db, camp, ctx["org_id"])}
