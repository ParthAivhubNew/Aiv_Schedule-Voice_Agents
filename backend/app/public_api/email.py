"""Email campaigns in the public API: the AI drafts a sequence, someone approves it, and only then does it send.

A campaign made here stays a draft until it is approved (by link, email, the app's Start button or the API).
It uses the app's own campaign, mailbox, suppression and sending rules, and the same credits per email sent.
"""
from __future__ import annotations

import asyncio
import html
import logging
import re
import time
import uuid
from datetime import datetime
from types import SimpleNamespace
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.tenancy import org_scope
from app.database import AsyncSessionLocal, get_db
from app.models.models import (EmailCampaign, EmailEnrollment, EmailMailbox, EmailMessage, EmailSequenceStep, LeadAccount, PublicObject)
from app.public_api import links
from app.public_api.core import V1Route, authorize, fail, is_test, page_args, page_of

logger = logging.getLogger("public_api.email")
router = APIRouter(prefix="/email", tags=["Email campaigns"], route_class=V1Route)

SANDBOX = "cp_test_"
SENDING = ("warming", "active", "graduated")
MAX_LEADS = 1000
_TASKS: set = set()


# ── Request bodies ───────────────────────────────────────────────────────────
class StepIn(BaseModel):
    subject: str = Field("", max_length=300)
    body: str = Field(..., min_length=1, max_length=10000, description="Use {{firstName}}, {{lastName}} and {{company}} to personalise")
    delay_days: int = Field(0, ge=0, le=60, description="Days to wait after the email before it (ignored for the first email)")


class LeadIn(BaseModel):
    email: str
    first_name: str = ""
    last_name: str = ""
    company: str = ""


class ScheduleIn(BaseModel):
    sending_window_start: str = "09:00"
    sending_window_end: str = "17:00"
    days_of_week: List[int] = Field(default_factory=lambda: [1, 2, 3, 4, 5], description="1 = Monday ... 7 = Sunday")
    min_delay_seconds: int = Field(120, ge=30, le=3600, description="Pause between two emails from the same mailbox")


class CreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    goal: Optional[str] = Field(None, max_length=2000, description="What the emails should achieve; the AI writes them. Leave out if you send your own `steps`.")
    audience: Optional[str] = Field(None, max_length=500, description="Who they go to, e.g. practice managers")
    emails: int = Field(3, ge=1, le=5, description="How many emails in the sequence (AI-written)")
    sender_name: Optional[str] = Field(None, max_length=80)
    steps: Optional[List[StepIn]] = Field(None, max_length=8, description="Your own emails instead of AI-written ones")
    leads: Optional[List[LeadIn]] = Field(None, max_length=MAX_LEADS)
    lead_ids: Optional[List[str]] = Field(None, max_length=MAX_LEADS, description="Saved leads (GET /v1/leads) that have an email")
    mailbox_ids: Optional[List[str]] = Field(None, description="Which mailboxes send. Default: your ready mailboxes")
    schedule: ScheduleIn = Field(default_factory=ScheduleIn)
    approvers: Optional[List[str]] = Field(None, max_length=10, description="Emails to ask for approval instead of your usual approvers")


class RegenerateIn(BaseModel):
    instruction: str = Field(..., min_length=3, max_length=1000, description="What to change, e.g. shorter and less formal")


class EditIn(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    steps: Optional[List[StepIn]] = Field(None, max_length=8)
    schedule: Optional[ScheduleIn] = None
    regenerate: Optional[RegenerateIn] = None
    action: Optional[Literal["pause", "resume"]] = None


class DecisionIn(BaseModel):
    decision: Literal["approve", "reject"]
    note: Optional[str] = Field(None, max_length=1000)


# ── Helpers ──────────────────────────────────────────────────────────────────
def _by(ctx: Dict[str, Any]) -> str:
    return f"api:{(ctx.get('name') or 'key')[:40]}"


async def _approval(db: AsyncSession, campaign_id: str) -> Optional[PublicObject]:
    return await db.get(PublicObject, f"emailappr_{campaign_id}")


def public_status(camp: EmailCampaign, appr: Optional[PublicObject]) -> str:
    a = (appr.data or {}).get("status") if appr else None
    if a == "drafting":
        return "drafting"
    if a == "failed":
        return "failed"
    if camp.status == "running":
        return "sending"
    if camp.status == "paused":
        return "paused" if a == "approved" else "needs_approval"
    if camp.status == "completed":
        return "completed"
    return {"needs_approval": "needs_approval", "rejected": "rejected", "approved": "approved"}.get(a or "", "needs_approval")


async def view(db: AsyncSession, camp: EmailCampaign, org: str) -> Dict[str, Any]:
    from app.api.email_outreach import _campaign_out

    appr = await _approval(db, camp.id)
    d = dict(appr.data or {}) if appr else {}
    out = await _campaign_out(db, camp, False)
    boxes = (await db.execute(select(EmailMailbox).where(EmailMailbox.id.in_(camp.mailbox_ids or [])))).scalars().all() if camp.mailbox_ids else []
    active = (out.get("lead_status") or {}).get("active", 0)
    return {
        "id": camp.id, "name": camp.name, "status": public_status(camp, appr),
        "steps": [{"step": s["step"], "subject": s["subject"], "body": s["body"], "delay_days": s["delay_days"]} for s in out["steps"]],
        "leads": out["leads"], "lead_status": out["lead_status"], "skipped": d.get("skipped") or {},
        "mailboxes": [{"email": m.email, "status": m.status} for m in boxes],
        "schedule": {"sending_window_start": camp.sending_window_start, "sending_window_end": camp.sending_window_end,
                     "days_of_week": camp.days_of_week or [], "min_delay_seconds": camp.min_delay_seconds},
        "stats": {"sent": out["sent"], "replied": out["replied"], "bounced": out["bounced"], "reply_rate": out["reply_rate"]},
        "estimated_credits": active * len(out["steps"]),
        "approved_by": d.get("approved_by"), "note": d.get("note"), "error": d.get("error"),
        "preview_url": links.preview_url("campaign", camp.id, org), "created_at": out["created_at"],
    }


async def _campaign(db: AsyncSession, campaign_id: str) -> EmailCampaign:
    camp = (await db.execute(select(EmailCampaign).where(EmailCampaign.id == campaign_id))).scalars().first()
    if not camp:
        fail(404, "not_found", f"Campaign '{campaign_id}' not found.")
    return camp


# ── Writing the emails (the app's own AI drafter) ────────────────────────────
async def draft_steps(db: AsyncSession, ctx: Dict[str, Any], goal: str, audience: str, count: int, sender: str,
                      current: Optional[List[Dict[str, str]]] = None, instruction: str = "") -> List[Dict[str, Any]]:
    """Write (or rewrite) the sequence. Raises ApiError when the writing AI is unavailable: never invented copy."""
    from app.api.email_outreach import AiDraftRequest, generate_or_refine_email_draft

    shim = SimpleNamespace(state=SimpleNamespace(auth=ctx))
    steps: List[Dict[str, Any]] = []
    prev_subject, prev_body = "", ""
    for n in range(1, count + 1):
        have = (current or [])[n - 1] if current and n <= len(current) else None
        if instruction and have:
            req = AiDraftRequest(action_type="custom", custom_prompt=instruction + ". Keep the {{firstName}} and {{company}} placeholders exactly as they are and use no others.",
                                 current_subject=have["subject"], current_body=have["body"], sender_name=sender)
        elif n == 1:
            req = AiDraftRequest(action_type="generate", topic=goal, objective=goal, target_audience=audience, recipient_name="{{firstName}}",
                                 company_name="{{company}}", sender_name=sender)
        else:
            req = AiDraftRequest(action_type="custom", sender_name=sender, current_subject=prev_subject, current_body=prev_body,
                                 custom_prompt=f"Write follow-up email number {n} to the email below. Under 70 words, light reference to the earlier note, one new useful "
                                               "angle, a low-pressure question at the end. Keep the {{firstName}} and {{company}} placeholders as written and use no "
                                               "other placeholders. Sign off with the sender's name.")
        res = await generate_or_refine_email_draft(req, shim, db)
        if not res.get("ok") or not (res.get("body") or "").strip():
            fail(502, "ai_unavailable", "The writing AI is not available right now, so nothing was written. Try again in a minute, or send your own `steps`.")
        prev_subject, prev_body = res["subject"], res["body"]
        steps.append({"subject": res["subject"].strip()[:300] or f"Following up ({n})", "body": res["body"].strip(),
                      "delay_days": 0 if n == 1 else (3 if n == 2 else 4)})
    return steps


async def _store_steps(db: AsyncSession, camp: EmailCampaign, steps: List[Dict[str, Any]]) -> None:
    from app.api.email_outreach import StepBody, _save_steps

    await _save_steps(db, camp, [StepBody(delay_days=s.get("delay_days", 0), delay_hours=0, subject=s["subject"], body=s["body"]) for s in steps])


async def _set_approval(db: AsyncSession, campaign_id: str, **fields: Any) -> PublicObject:
    appr = await _approval(db, campaign_id)
    if appr is None:
        appr = PublicObject(id=f"emailappr_{campaign_id}", kind="email_approval", data={"sent": []})
        db.add(appr)
        await db.flush()
    appr.data = {**(appr.data or {}), **fields}
    return appr


async def _background_draft(org: str, ctx: Dict[str, Any], campaign_id: str, goal: str, audience: str, count: int, sender: str,
                            current: Optional[List[Dict[str, str]]] = None, instruction: str = "") -> None:
    from app.public_api.core import ApiError

    try:
        with org_scope(org):
            async with AsyncSessionLocal() as db:
                camp = await _campaign(db, campaign_id)
                try:
                    steps = await draft_steps(db, ctx, goal, audience, count, sender, current, instruction)
                except ApiError as err:
                    await _set_approval(db, campaign_id, status="failed", error=err.message)
                    await db.commit()
                    return
                await _store_steps(db, camp, steps)
                await _set_approval(db, campaign_id, status="needs_approval", error=None)
                await db.commit()
    except Exception:
        logger.exception(f"[public-api] drafting campaign {campaign_id} failed")
        try:
            with org_scope(org):
                async with AsyncSessionLocal() as db:
                    await _set_approval(db, campaign_id, status="failed", error="The emails could not be written. Try again.")
                    await db.commit()
        except Exception:
            pass


def _spawn(coro) -> None:
    task = asyncio.get_running_loop().create_task(coro)
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)


# ── Actions shared by the routes and the preview page ────────────────────────
async def create_campaign(db: AsyncSession, request: Request, ctx: Dict[str, Any], body: CreateIn) -> Dict[str, Any]:
    from app.api.email_outreach import LeadBody, LeadsBody, add_leads
    from app.models.models import CompanyProfile

    org = ctx["org_id"]
    if not body.steps and not (body.goal or "").strip():
        fail(422, "invalid_request", "Send a `goal` (the AI writes the emails) or your own `steps`.")
    if not body.leads and not body.lead_ids:
        fail(422, "no_leads", "Send `leads` (with emails) or `lead_ids` (saved leads that have an email).")
    schedule = body.schedule
    hm = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
    if not (hm.match(schedule.sending_window_start) and hm.match(schedule.sending_window_end)) or schedule.sending_window_start >= schedule.sending_window_end:
        fail(422, "invalid_schedule", "Sending hours must be like 09:00 to 17:00.")
    if not schedule.days_of_week or any(d not in range(1, 8) for d in schedule.days_of_week):
        fail(422, "invalid_schedule", "Pick at least one sending day (1 = Monday ... 7 = Sunday).")

    if is_test(ctx):
        return await _sandbox_create(db, ctx, body)

    mailboxes = (await db.execute(select(EmailMailbox))).scalars().all()
    ids = [m.id for m in mailboxes if (not body.mailbox_ids and m.status in SENDING) or (body.mailbox_ids and m.id in body.mailbox_ids)]
    if not mailboxes or not ids:
        fail(422, "no_mailbox", "Connect a mailbox first (Email, Mailboxes), and start its warm-up. Then try again.",
             fix_url=links.fix_url("mailboxes"))

    leads: List[Dict[str, str]] = [x.model_dump() for x in (body.leads or [])]
    if body.lead_ids:
        for acc in (await db.execute(select(LeadAccount).where(LeadAccount.id.in_(body.lead_ids)))).scalars().all():
            if (acc.email or "").strip():
                parts = (acc.contact_name or "").split()
                leads.append({"email": acc.email, "first_name": parts[0] if parts else "", "last_name": " ".join(parts[1:]), "company": acc.name or ""})

    camp = EmailCampaign(id=f"cp_{uuid.uuid4().hex[:12]}", name=body.name.strip()[:120], status="draft", mailbox_ids=ids, timezone_policy="org",
                         sending_window_start=schedule.sending_window_start, sending_window_end=schedule.sending_window_end,
                         days_of_week=sorted(set(schedule.days_of_week)), min_delay_seconds=schedule.min_delay_seconds,
                         max_delay_seconds=schedule.min_delay_seconds)
    db.add(camp)
    await db.flush()
    added = await add_leads(camp.id, LeadsBody(leads=[LeadBody(**x) for x in leads]), SimpleNamespace(state=SimpleNamespace(auth=ctx)), db)
    if not added["added"]:
        await db.delete(camp)  # nothing to send to: do not leave an empty draft behind
        await db.commit()
        fail(422, "no_leads", "None of those leads could be added (bad addresses, duplicates or people on your do-not-email list).",
             skipped=added["skipped"])
    approvers = [e.strip() for e in (body.approvers or []) if "@" in e]
    prof = (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()
    sender = (body.sender_name or (prof.name if prof and prof.name else "") or ctx.get("name") or "The team").strip()
    base = {"sent": [], "approvers": approvers, "skipped": added["skipped"], "goal": body.goal or "", "audience": body.audience or "", "sender": sender,
            "count": body.emails}
    if body.steps:
        await _store_steps(db, camp, [s.model_dump() for s in body.steps])
        await _set_approval(db, camp.id, status="needs_approval", **base)
    else:
        await _set_approval(db, camp.id, status="drafting", **base)
    await db.commit()
    if not body.steps:
        _spawn(_background_draft(org, ctx, camp.id, body.goal or "", body.audience or "", body.emails, sender))
    return await view(db, camp, org)


async def edit_campaign(db: AsyncSession, ctx: Dict[str, Any], camp: EmailCampaign, body: EditIn) -> None:
    appr = await _approval(db, camp.id)
    d = dict((appr.data or {}) if appr else {})
    if d.get("status") == "drafting":
        fail(409, "still_writing", "The AI is still writing this campaign. Edit it when it finishes.")
    if body.action:
        if body.action == "pause":
            if camp.status == "running":
                camp.status = "paused"
        else:
            if d.get("status") != "approved":
                fail(409, "not_approved", "This campaign has not been approved, so it cannot start.")
            await _ready_to_send(db, camp)
            camp.status = "running"
    changed = False
    if body.name:
        camp.name = body.name.strip()[:120]
    if body.schedule:
        s = body.schedule
        camp.sending_window_start, camp.sending_window_end = s.sending_window_start, s.sending_window_end
        camp.days_of_week, camp.min_delay_seconds, camp.max_delay_seconds = sorted(set(s.days_of_week)), s.min_delay_seconds, s.min_delay_seconds
        changed = True
    if body.steps:
        await _store_steps(db, camp, [x.model_dump() for x in body.steps])
        changed = True
    if body.regenerate:
        from app.api.email_outreach import _campaign_out

        current = [{"subject": s["subject"], "body": s["body"]} for s in (await _campaign_out(db, camp))["steps"]]
        await _set_approval(db, camp.id, status="drafting", error=None)
        camp.status = "draft" if camp.status != "running" else "paused"
        await db.commit()
        _spawn(_background_draft(ctx["org_id"], ctx, camp.id, d.get("goal", ""), d.get("audience", ""), max(1, len(current)), d.get("sender", "The team"),
                                 current, body.regenerate.instruction))
        return
    if changed:  # approval covers what was reviewed: a change sends it back, and sending stops until it is approved again
        if camp.status == "running":
            camp.status = "paused"
        await _set_approval(db, camp.id, status="needs_approval", approved_by=None, note=None)
    await db.commit()


async def _ready_to_send(db: AsyncSession, camp: EmailCampaign) -> None:
    from app.services import credits as K

    boxes = (await db.execute(select(EmailMailbox).where(EmailMailbox.id.in_(camp.mailbox_ids or [])))).scalars().all()
    if not any(b.status in SENDING for b in boxes):
        fail(409, "mailbox_not_ready", "None of this campaign's mailboxes is ready to send. Start its warm-up in the app first.",
             fix_url=links.fix_url("mailboxes"))
    active = (await db.execute(select(EmailEnrollment.id).where(EmailEnrollment.campaign_id == camp.id, EmailEnrollment.status == "active"))).scalars().all()
    if not active:
        fail(409, "no_leads", "There are no leads left to email.")
    ok, why = await K.can_start(db, "email_send", len(active))
    if not ok:
        fail(402, "insufficient_credits", why, needed=len(active), top_up_url=links.fix_url("billing"))


async def decide(db: AsyncSession, camp: EmailCampaign, decision: str, by: str, note: str = "") -> None:
    appr = await _approval(db, camp.id)
    d = (appr.data or {}) if appr else {}
    status = d.get("status")
    if status == "drafting":
        fail(409, "still_writing", "The AI is still writing this campaign. Approve it once it is ready.")
    if status == "failed":
        fail(409, "failed", "The emails could not be written. Ask for them again first.")
    if decision == "approve":
        if status == "approved" and camp.status in ("running", "completed"):
            return
        if status == "rejected":
            fail(409, "rejected", "This campaign was rejected. Edit it first; it then goes back for approval.")
        await _ready_to_send(db, camp)
        camp.status = "running"
        await _set_approval(db, camp.id, status="approved", approved_by=by, note=None)
    else:
        if camp.status == "running":
            fail(409, "already_sending", "This campaign is already sending. Pause it instead.")
        await _set_approval(db, camp.id, status="rejected", approved_by=None, note=(note or "").strip()[:1000] or f"Rejected by {by}")
    await db.commit()


def note_started_in_app(campaign_id: str) -> None:
    """Called when someone presses Start in the app: that is an approval too, so the API sees it."""
    async def mark() -> None:
        try:
            async with AsyncSessionLocal() as db:
                appr = await _approval(db, campaign_id)
                if appr is not None and (appr.data or {}).get("status") != "approved":
                    appr.data = {**appr.data, "status": "approved", "approved_by": "app", "note": None}
                    await db.commit()
        except Exception as err:
            logger.debug(f"[public-api] app start not recorded: {err}")
    try:
        asyncio.get_running_loop().create_task(mark())
    except RuntimeError:
        pass


# ── Test mode ────────────────────────────────────────────────────────────────
def _sandbox_view(o: PublicObject, org: str) -> Dict[str, Any]:
    d = dict(o.data or {})
    sending = d["status"] == "sending"
    done = sending and time.time() - d.get("approved_s", 0) >= _sandbox_seconds()
    n_steps, n_leads = len(d["steps"]), d["leads"]
    status = "completed" if done else d["status"]
    sent = n_steps * n_leads if done else (n_leads if sending else 0)
    return {"id": o.id, "name": d["name"], "status": status, "steps": d["steps"], "leads": n_leads, "lead_status": {"active": 0 if done else n_leads},
            "skipped": {}, "mailboxes": [{"email": "sender@example.test", "status": "active"}], "schedule": d["schedule"],
            "stats": {"sent": sent, "replied": 1 if done else 0, "bounced": 0, "reply_rate": round(100 / sent, 1) if done and sent else 0.0},
            "estimated_credits": n_leads * n_steps, "approved_by": d.get("approved_by"), "note": d.get("note"), "error": None,
            "preview_url": links.preview_url("campaign", o.id, org), "created_at": d["created_at"], "test": True}


def _sandbox_seconds() -> float:
    import os

    try:
        return float(os.getenv("PUBLIC_API_SANDBOX_CALL_SECONDS", "8"))
    except ValueError:
        return 8.0


async def _sandbox_create(db: AsyncSession, ctx: Dict[str, Any], body: CreateIn) -> Dict[str, Any]:
    org = ctx["org_id"]
    n_leads = len(body.leads or []) + len(body.lead_ids or [])
    steps = [{"step": i, "subject": s.subject or f"Test subject {i}", "body": s.body, "delay_days": 0 if i == 1 else s.delay_days}
             for i, s in enumerate(body.steps or [], 1)] or \
            [{"step": i, "subject": f"[Test] {body.name} ({i})", "body": f"Hi {{{{firstName}}}},\n\n[Test email {i}] {body.goal or ''}\n\n{body.sender_name or 'The team'}",
              "delay_days": 0 if i == 1 else 3} for i in range(1, body.emails + 1)]
    o = PublicObject(id=f"{SANDBOX}{uuid.uuid4().hex[:10]}", kind="sandbox_campaign", data={
        "name": body.name, "status": "needs_approval", "steps": steps, "leads": n_leads, "created_at": datetime.utcnow().isoformat() + "Z",
        "schedule": body.schedule.model_dump()})
    db.add(o)
    await db.commit()
    from app.services.webhook_dispatcher import dispatch_event

    out = _sandbox_view(o, org)
    dispatch_event(org, "campaign.ready", {"campaign": out}, test=True)
    return out


async def _sandbox_decide(db: AsyncSession, o: PublicObject, org: str, decision: str, by: str, note: str) -> Dict[str, Any]:
    from app.services.webhook_dispatcher import dispatch_event

    d = dict(o.data or {})
    if d["status"] == "sending":
        fail(409, "already_sending", "This campaign is already sending.")
    if decision == "approve":
        d.update(status="sending", approved_by=by, approved_s=time.time(), note=None)
    else:
        d.update(status="rejected", note=note or None)
    o.data = d
    await db.commit()
    out = _sandbox_view(o, org)
    if decision == "approve":
        dispatch_event(org, "campaign.approved", {"campaign": out}, test=True)
        asyncio.get_running_loop().call_later(_sandbox_seconds(), lambda: dispatch_event(org, "campaign.completed", {"campaign": _sandbox_view(o, org)}, test=True))
    return out


# ── Routes ───────────────────────────────────────────────────────────────────
@router.post("/campaigns", status_code=202)
async def create(body: CreateIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Draft an email campaign. The AI writes the sequence (or you send your own); it sends only after it is approved."""
    ctx = await authorize(request, db, "email:write", "leads")
    return await create_campaign(db, request, ctx, body)


@router.get("/campaigns/{campaign_id}")
async def get_one(campaign_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await authorize(request, db, "email:write", "leads")
    if campaign_id.startswith(SANDBOX):
        o = await db.get(PublicObject, campaign_id)
        if not o:
            fail(404, "not_found", f"Campaign '{campaign_id}' not found.")
        return _sandbox_view(o, ctx["org_id"])
    out = await view(db, await _campaign(db, campaign_id), ctx["org_id"])
    from app.api.email_outreach import list_replies

    replies = (await list_replies(SimpleNamespace(state=SimpleNamespace(auth=ctx)), "", db))["replies"]
    camp_name = out["name"]
    out["replies"] = [{"email": r["email"], "name": r["name"], "company": r["company"], "category": r["category"], "text": r["text"],
                       "replied_at": r["replied_at"]} for r in replies if r["campaign"] == camp_name][:50]
    return out


@router.get("/campaigns")
async def list_campaigns(request: Request, status: Optional[str] = None, limit: int = 20, cursor: str = "", db: AsyncSession = Depends(get_db)):
    """Campaigns made through the API, newest first."""
    ctx = await authorize(request, db, "email:write", "leads")
    lim, off = page_args(limit, cursor)
    if is_test(ctx):
        rows = (await db.execute(select(PublicObject).where(PublicObject.kind == "sandbox_campaign").order_by(PublicObject.created_at.desc())
                                 .offset(off).limit(lim + 1))).scalars().all()
        items = [_sandbox_view(o, ctx["org_id"]) for o in rows]
    else:
        ids = [o.id.removeprefix("emailappr_") for o in (await db.execute(
            select(PublicObject).where(PublicObject.kind == "email_approval").order_by(PublicObject.created_at.desc())
            .offset(off).limit((lim + 1) * (3 if status else 1)))).scalars().all()]
        camps = {c.id: c for c in (await db.execute(select(EmailCampaign).where(EmailCampaign.id.in_(ids)))).scalars().all()} if ids else {}
        items = [await view(db, camps[i], ctx["org_id"]) for i in ids if i in camps]
    if status:
        items = [i for i in items if i["status"] == status]
    return page_of(items, lim, off)


@router.patch("/campaigns/{campaign_id}")
async def edit(campaign_id: str, body: EditIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Change the emails or schedule, have the AI rewrite them, or pause / resume. A change sends it back for approval."""
    ctx = await authorize(request, db, "email:write", "leads")
    org = ctx["org_id"]
    if not any([body.name, body.steps, body.schedule, body.regenerate, body.action]):
        fail(422, "nothing_to_change", "Send at least one thing to change (name, steps, schedule, regenerate or action).")
    if campaign_id.startswith(SANDBOX):
        o = await db.get(PublicObject, campaign_id)
        if not o:
            fail(404, "not_found", f"Campaign '{campaign_id}' not found.")
        d = dict(o.data or {})
        if body.name:
            d["name"] = body.name
        if body.steps:
            d["steps"] = [{"step": i, "subject": s.subject, "body": s.body, "delay_days": 0 if i == 1 else s.delay_days} for i, s in enumerate(body.steps, 1)]
        if body.schedule:
            d["schedule"] = body.schedule.model_dump()
        if body.regenerate:
            d["steps"] = [{**s, "body": f"[Test rewrite] {body.regenerate.instruction}"} for s in d["steps"]]
        if body.action == "pause" and d["status"] == "sending":
            d["status"] = "paused"
        if body.action == "resume" and d["status"] == "paused":
            d["status"] = "sending"
        elif body.steps or body.schedule or body.regenerate:
            d["status"] = "needs_approval"
        o.data = d
        await db.commit()
        return _sandbox_view(o, org)
    camp = await _campaign(db, campaign_id)
    await edit_campaign(db, ctx, camp, body)
    await db.refresh(camp)
    return await view(db, camp, org)


@router.post("/campaigns/{campaign_id}/decision")
async def decision(campaign_id: str, body: DecisionIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Approve to launch, or reject. This is the only way a campaign starts sending."""
    ctx = await authorize(request, db, "email:approve", "leads")
    org = ctx["org_id"]
    if campaign_id.startswith(SANDBOX):
        o = await db.get(PublicObject, campaign_id)
        if not o:
            fail(404, "not_found", f"Campaign '{campaign_id}' not found.")
        return await _sandbox_decide(db, o, org, body.decision, _by(ctx), body.note or "")
    camp = await _campaign(db, campaign_id)
    await decide(db, camp, body.decision, _by(ctx), body.note or "")
    await db.refresh(camp)
    return await view(db, camp, org)
