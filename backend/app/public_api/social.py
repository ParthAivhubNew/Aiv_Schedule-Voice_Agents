"""Social posts in the public API: a prompt becomes a post that waits for approval and goes live only when approved.

The same record is used by the app, the approval emails, the preview page and these routes, so a
decision made in any of them is the decision. Credits are charged by the same queue the app uses.
"""
from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models.models import PublicObject, SocialAccount, SocialGenJob, SocialPost
from app.public_api import links
from app.public_api.core import V1Route, authorize, fail, is_test, page_args, page_of
from app.services import approval_mail

logger = logging.getLogger("public_api.social")
router = APIRouter(prefix="/social", tags=["Social posts"], route_class=V1Route)

CHANNELS = ("linkedin", "x", "facebook", "instagram", "threads")
COPY_COLUMN = {"linkedin": "linkedin_copy", "x": "x_copy", "facebook": "facebook_copy",
               "instagram": "instagram_copy", "threads": "threads_copy"}
WRITING = ("queued", "writing", "imaging")
LOCKED = ("published", "publishing")
CANCELED_PREFIX = "Canceled"
SANDBOX_PREFIX = "v2_test_"
SANDBOX_IMAGE = ("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='800' height='800'>"
                 "<rect width='100%' height='100%' fill='%23e8e6df'/><text x='50%' y='50%' font-family='sans-serif' "
                 "font-size='36' text-anchor='middle' fill='%235b6170'>Test image</text></svg>")


# ── Request bodies ───────────────────────────────────────────────────────────
class ImageSpec(BaseModel):
    mode: Literal["ai", "none", "url"] = Field("ai", description="ai: draw one; none: text only; url: use this picture")
    instruction: Optional[str] = Field(None, max_length=1000, description="What the picture should show (mode ai)")
    url: Optional[str] = Field(None, max_length=2000, description="https:// address of your picture (mode url)")


class CreatePostIn(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=4000, description="What the post should be about")
    channels: List[str] = Field(default_factory=lambda: ["linkedin"], min_length=1, max_length=5,
                                description="linkedin, x, facebook, instagram, threads")
    publish_at: Optional[datetime] = Field(None, description="When it goes live once approved. Leave out to post as soon as it is approved.")
    tone: Optional[str] = Field(None, max_length=60)
    image: ImageSpec = Field(default_factory=ImageSpec)
    caption: Optional[str] = Field(None, max_length=20000, description="Your own text. The AI then writes none and is not charged for text.")
    approvers: Optional[List[str]] = Field(None, max_length=10, description="Emails to ask for approval instead of your usual approvers")


class EditPostIn(BaseModel):
    headline: Optional[str] = Field(None, max_length=300)
    caption: Optional[str] = Field(None, max_length=20000)
    channels: Optional[List[str]] = Field(None, min_length=1, max_length=5)
    publish_at: Optional[datetime] = None
    image: Optional[ImageSpec] = None
    regenerate: Optional[Literal["text", "image", "both"]] = Field(None, description="Have the AI write it again")
    instruction: Optional[str] = Field(None, max_length=2000, description="What to change when regenerating")


class DecisionIn(BaseModel):
    decision: Literal["approve", "reject", "cancel"]
    note: Optional[str] = Field(None, max_length=1000, description="Why (shown to whoever made the post)")
    publish_at: Optional[datetime] = Field(None, description="Approve for this time instead of the one it has")


# ── Small helpers ────────────────────────────────────────────────────────────
def _now_ms() -> float:
    return time.time() * 1000


def _iso_ms(ms: Optional[float]) -> Optional[str]:
    return datetime.fromtimestamp(ms / 1000.0, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if ms else None


def _clean_channels(raw: List[str]) -> List[str]:
    from app.services.social_publisher import normalize_platform

    out: List[str] = []
    for c in raw:
        ch = normalize_platform(c)
        if ch not in CHANNELS:
            fail(422, "invalid_channel", f"'{c}' is not a channel we post to. Use: {', '.join(CHANNELS)}.", channel=c)
        if ch not in out:
            out.append(ch)
    return out


def _local_parts(when: datetime, tz: str) -> Dict[str, str]:
    """The date and time strings the scheduler stores, in the organisation's timezone."""
    from app.services.timezone_service import tzinfo

    if when.tzinfo is None:  # no zone given: it is the organisation's own time
        local = when
    else:
        local = when.astimezone(tzinfo(tz))
    return {"date": local.strftime("%Y-%m-%d"), "time": local.strftime("%H:%M")}


def _due_ms(when: datetime, tz: str) -> float:
    from app.services.org_settings import org_instant_ms

    p = _local_parts(when, tz)
    ms = org_instant_ms(p["date"], p["time"], tz)
    if not ms:
        fail(422, "invalid_publish_at", "publish_at is not a valid date and time.")
    return float(ms)


def _by(ctx: Dict[str, Any]) -> str:
    return f"api:{(ctx.get('name') or 'key')[:40]}"


def _check_image_url(url: str) -> str:
    from app.services.webhook_dispatcher import url_problem

    u = (url or "").strip()
    if u.startswith("data:image/"):
        return u
    if not u.startswith("https://") or url_problem(u):
        fail(422, "invalid_image_url", "The image must be an https:// address on the public internet (or an uploaded picture).")
    return u


# ── What a customer sees ─────────────────────────────────────────────────────
def status_of(p: SocialPost, paused: bool = False) -> str:
    if p.gen_state in WRITING:
        return "waiting_for_credits" if paused else "writing"
    if p.gen_state == "failed":
        return "failed"
    s = p.status
    if s == approval_mail.WAITING:
        return "needs_approval" if (p.copy or "").strip() else "writing"
    if s in approval_mail.APPROVED_STATES:
        return "approved"
    if s == approval_mail.REJECTED:
        return "canceled" if (p.review_note or "").startswith(CANCELED_PREFIX) else "rejected"
    if s == approval_mail.MISSED:
        return "approval_closed"
    return s if s in ("publishing", "published", "failed") else "needs_approval"


def _results(p: SocialPost) -> List[Dict[str, Any]]:
    out = []
    for r in p.publish_results or []:
        if isinstance(r, dict):
            out.append({"channel": r.get("platform") or r.get("channel"), "ok": bool(r.get("ok")),
                        "url": r.get("url") or None, "error": r.get("error") or None})
    return out


def view(p: SocialPost, org_id: str, status: Optional[str] = None) -> Dict[str, Any]:
    channels = list(p.channels or [])
    st = status or status_of(p)
    error = p.gen_error if p.gen_state == "failed" else ("; ".join(r["error"] for r in _results(p) if r["error"]) or None)
    return {
        "id": p.id,
        "status": st,
        "channels": channels,
        "headline": p.title if (p.copy or "").strip() else None,
        "caption": p.copy or "",
        "per_channel": [{"channel": c, "caption": (getattr(p, COPY_COLUMN.get(c, ""), None) or "").strip() or (p.copy or "")}
                        for c in channels],
        "hashtags": p.hashtags or [],
        "image_url": p.image_url or None,
        "publish_at": None if p.asap and not p.published_at else _iso_ms(p.due_at_ms),
        "publish_when_approved": bool(p.asap),
        "approved_by": p.approved_by,
        "approved_at": (p.approved_at.isoformat() + "Z") if p.approved_at else None,
        "note": p.review_note,
        "results": _results(p),
        "published_at": p.published_at,
        "error": error,
        "preview_url": links.preview_url("post", p.id, org_id),
        "created_at": (p.created_at.isoformat() + "Z") if p.created_at else None,
    }


def sandbox_view(o: PublicObject, org_id: str) -> Dict[str, Any]:
    d = dict(o.data or {})
    # Approved posts "go live" on their own once their time has come.
    if d.get("status") == "approved" and (not d.get("publish_at_ms") or d["publish_at_ms"] <= _now_ms()):
        d["status"] = "published"
        d["published_at"] = _iso_ms(_now_ms())
        d["results"] = [{"channel": c, "ok": True, "url": f"https://example.com/test/{o.id}/{c}", "error": None} for c in d["channels"]]
    return {
        "id": o.id, "status": d["status"], "channels": d["channels"], "headline": d["headline"], "caption": d["caption"],
        "per_channel": [{"channel": c, "caption": d["caption"]} for c in d["channels"]], "hashtags": [],
        "image_url": d.get("image_url"), "publish_at": _iso_ms(d.get("publish_at_ms")),
        "publish_when_approved": not d.get("publish_at_ms"), "approved_by": d.get("approved_by"),
        "approved_at": d.get("approved_at"), "note": d.get("note"), "results": d.get("results", []),
        "published_at": d.get("published_at"), "error": None,
        "preview_url": links.preview_url("post", o.id, org_id), "created_at": d.get("created_at"), "test": True,
    }


async def _paused(db: AsyncSession, post_id: str) -> bool:
    rows = (await db.execute(select(SocialGenJob.post_ids).where(SocialGenJob.state.in_(["paused", "image_paused"])))).scalars().all()
    return any(post_id in (ids or []) for ids in rows)


async def get_post(db: AsyncSession, post_id: str) -> Optional[SocialPost]:
    return (await db.execute(select(SocialPost).where(SocialPost.id == post_id))).scalars().first()


async def full_view(db: AsyncSession, post_id: str, org_id: str) -> Dict[str, Any]:
    """The customer's view of one post (real or test); 404 when this company has no such post."""
    if post_id.startswith(SANDBOX_PREFIX):
        o = await db.get(PublicObject, post_id)
        if not o or o.kind != "sandbox_post":
            fail(404, "not_found", f"Post '{post_id}' not found.")
        return sandbox_view(o, org_id)
    p = await get_post(db, post_id)
    if not p:
        fail(404, "not_found", f"Post '{post_id}' not found.")
    return view(p, org_id, status_of(p, await _paused(db, p.id) if p.gen_state in WRITING else False))


# ── Doing things to a post (shared by the routes and the preview page) ───────
async def _connected(db: AsyncSession, channels: List[str]) -> None:
    rows = (await db.execute(select(SocialAccount.platform, SocialAccount.status, SocialAccount.access_token))).all()
    ok = {str(pl).lower() for pl, st, tok in rows if st == "connected" and (tok or "").strip()}
    missing = [c for c in channels if c not in ok]
    if missing:
        fail(422, "channel_not_connected",
             f"Connect {', '.join(missing)} in the app first (Social, Accounts). Then try again.",
             channels=missing, fix_url=links.fix_url("social_accounts"))


async def _afford(db: AsyncSession, item: str, extra: Optional[list] = None) -> None:
    from app.services.credits import can_start

    ok, why = await can_start(db, item, extra=extra or [])
    if not ok:
        fail(402, "insufficient_credits", why, top_up_url=links.fix_url("billing"))


def _batch(ctx: Dict[str, Any]) -> str:
    # Posts made within the same few minutes share a batch, so a burst does not trip the per-company batch limit.
    return f"api_{ctx.get('key_id') or 'x'}_{int(time.time() // 300)}"


async def _meta(db: AsyncSession, post_id: str) -> PublicObject:
    meta = await db.get(PublicObject, f"pev_{post_id}")
    if not meta:
        meta = PublicObject(id=f"pev_{post_id}", kind="post_meta", data={"sent": []})
        db.add(meta)
    return meta


async def create_post(db: AsyncSession, request: Request, ctx: Dict[str, Any], body: CreatePostIn) -> Dict[str, Any]:
    from app.models.models import CompanyProfile
    from app.services import generation_queue as Q
    from app.services.org_settings import org_timezone

    channels = _clean_channels(body.channels)
    tz = await org_timezone(db)
    due = _due_ms(body.publish_at, tz) if body.publish_at else None
    if due is not None and due < _now_ms() - 60_000:
        fail(422, "publish_at_in_past", "publish_at is in the past. Pick a later time, or leave it out to post as soon as it is approved.")
    if body.image.mode == "url":
        if not body.image.url:
            fail(422, "invalid_request", "image.url is needed when image.mode is 'url'.")
        _check_image_url(body.image.url)
    org = ctx["org_id"]

    if is_test(ctx):
        caption = body.caption or f"[Test post] {body.prompt.strip()[:300]}"
        o = PublicObject(id=f"{SANDBOX_PREFIX}{uuid.uuid4().hex[:10]}", kind="sandbox_post", data={
            "status": "needs_approval", "channels": channels, "headline": body.prompt.strip()[:80], "caption": caption,
            "image_url": None if body.image.mode == "none" else (body.image.url if body.image.mode == "url" else SANDBOX_IMAGE),
            "publish_at_ms": due, "created_at": datetime.utcnow().isoformat() + "Z"})
        db.add(o)
        await db.commit()
        from app.services.webhook_dispatcher import dispatch_event

        out = sandbox_view(o, org)
        dispatch_event(org, "post.ready", {"post": out}, test=True)
        return out

    await _connected(db, channels)
    prof = (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()
    if not prof or not (prof.name or "").strip():
        fail(409, "company_profile_missing", "Add your company name in the app first (Company profile). The AI needs it to write in your voice.",
             fix_url=links.fix_url("company"))
    writes_text = not (body.caption or "").strip()
    draws = body.image.mode == "ai"
    if writes_text:
        await _afford(db, "ai_post", [("ai_image", 1)] if draws else [])
    elif draws:
        await _afford(db, "ai_image")

    now = _now_ms()
    parts = _local_parts(body.publish_at, tz) if body.publish_at else _local_parts(datetime.now(timezone.utc), tz)
    post_id = f"v2_{uuid.uuid4().hex[:12]}"  # the app's Social workspace shows posts with this id shape
    caption = (body.caption or "").strip()
    post = SocialPost(
        id=post_id, title=(caption[:80] if caption else body.prompt.strip()[:80]), copy=caption, channels=channels,
        status=approval_mail.WAITING, slot_date_ms=due or now, due_at_ms=due or now, time=parts["time"],
        theme="General", tone=(body.tone or "Professional"), source="api", asap=due is None,
        image_url=None, image_prompt=(body.image.instruction or None) if draws else None,
        adapt_per_channel=len(channels) > 1, gen_state="queued" if (writes_text or draws) else None,
    )
    if body.image.mode == "url":
        post.image_url = _check_image_url(body.image.url or "")
    db.add(post)
    meta = await _meta(db, post_id)
    meta.data = {"sent": [], "approvers": [e.strip() for e in (body.approvers or []) if "@" in e], "prompt": body.prompt.strip()[:4000]}
    await db.flush()
    if writes_text or draws:
        group = {"post_ids": [post_id], "plan": body.prompt.strip(), "headline": "", "channel": channels[0], "date": parts["date"],
                 "skip_image": not draws}
        job_ids = await Q.enqueue(db, [group], options={"batch": _batch(ctx), "by": "", "started": datetime.utcnow().isoformat(),
                                                         "linkedinDirective": ""})
        if not writes_text:  # your text, our picture: skip the writer
            await db.flush()
            job = await db.get(SocialGenJob, job_ids[0])
            job.state = "image_queued"
            post.gen_state = "imaging"
    else:
        approval_mail.note_change(post_id)
    await db.commit()
    await db.refresh(post)
    return view(post, org)


async def edit_post(db: AsyncSession, request: Request, ctx: Dict[str, Any], post: SocialPost, body: EditPostIn) -> None:
    from app.api import scheduler as S
    from app.services.org_settings import org_timezone

    payload: Dict[str, Any] = {}
    if body.headline is not None:
        payload["title"] = body.headline
    if body.caption is not None:
        payload["copy"] = body.caption
    if body.image is not None and body.image.mode != "ai":
        payload["imageUrl"] = "" if body.image.mode == "none" else _check_image_url(body.image.url or "")
    if body.publish_at is not None:
        tz = await org_timezone(db)
        if _due_ms(body.publish_at, tz) < _now_ms() - 60_000:
            fail(422, "publish_at_in_past", "publish_at is in the past.")
        payload.update(_local_parts(body.publish_at, tz))
        post.asap = False
    if body.channels is not None:
        post.channels = _clean_channels(body.channels)
    if payload:
        await S.edit_post(post.id, payload, request, db)  # the app's own edit: versions, re-approval, locks
    else:
        await db.commit()
    await db.refresh(post)


async def regenerate(db: AsyncSession, ctx: Dict[str, Any], post: SocialPost, what: str, instruction: str) -> None:
    from app.services import generation_queue as Q

    if post.status in LOCKED:
        fail(409, "already_live", "This post is live (or going live) and can no longer be changed.")
    if post.gen_state in WRITING:
        fail(409, "still_writing", "The AI is still working on this post. Try again when it finishes.")
    if what in ("text", "both"):
        await _afford(db, "ai_post", [("ai_image", 1)] if what == "both" else [])
    else:
        await _afford(db, "ai_image")
    channel = (post.channels or ["linkedin"])[0]
    opts = {"batch": _batch(ctx), "by": "", "started": datetime.utcnow().isoformat(), "linkedinDirective": ""}
    if what == "image":
        if instruction:
            post.image_prompt = instruction[:4000]
        ids = await Q.enqueue(db, [{"post_ids": [post.id], "plan": instruction or post.title, "headline": post.title,
                                    "channel": channel, "date": "", "skip_image": False}], priority=Q.PRIORITY_INTERACTIVE, options=opts)
        await db.flush()
        job = await db.get(SocialGenJob, ids[0])
        job.state = "image_queued"
        post.gen_state = "imaging"
    else:
        await Q.enqueue(db, [{"post_ids": [post.id], "plan": post.title, "headline": post.title, "channel": channel, "date": "",
                              "revision_note": instruction, "existing_copy": post.copy or "", "skip_image": what == "text"}],
                        priority=Q.PRIORITY_INTERACTIVE, options=opts)
    await db.commit()
    await db.refresh(post)


async def decide(db: AsyncSession, post: SocialPost, decision: str, by: str, note: str = "",
                 publish_at: Optional[datetime] = None) -> None:
    """Approve, reject or cancel. Used by the API, the preview page and (through the same record) everything else."""
    from app.services import generation_queue as Q
    from app.services.org_settings import org_timezone

    if post.status in LOCKED:
        fail(409, "already_live", "This post is already live (or going live).")
    if decision == "approve":
        if post.status in approval_mail.APPROVED_STATES:
            return  # already approved: asking again changes nothing
        if post.gen_state in WRITING or not (post.copy or "").strip():
            fail(409, "still_writing", "The AI is still writing this post. Approve it once it is ready.")
        if post.status == approval_mail.REJECTED:
            fail(409, "rejected", "This post was rejected. Edit it first; it then goes back for approval.")
        tz = await org_timezone(db)
        if publish_at is not None:
            due = _due_ms(publish_at, tz)
            if due < _now_ms():
                fail(422, "publish_at_in_past", "publish_at is in the past.")
            parts = _local_parts(publish_at, tz)
            post.due_at_ms = post.slot_date_ms = due
            post.time = parts["time"]
            post.asap = False
            if post.status == approval_mail.MISSED:
                post.status = approval_mail.WAITING  # a new time reopens approval
        elif post.status == approval_mail.MISSED or (not post.asap and (post.due_at_ms or 0) < _now_ms()):
            fail(409, "approval_closed", "The publish time has passed, so this post can no longer be approved. "
                 "Send a new publish_at to approve it for a later time.")
        post.status = "approved"
        post.approved_by = by
        post.approved_at = datetime.utcnow()
        post.review_note = None
        post.publish_attempts = 0
        post.retry_at_ms = None
    else:
        if post.status in approval_mail.APPROVED_STATES and decision == "reject":
            fail(409, "already_approved", "This post is already approved. Cancel it instead.")
        post.status = approval_mail.REJECTED
        post.approved_by = None
        post.approved_at = None
        label = CANCELED_PREFIX if decision == "cancel" else "Rejected"
        post.review_note = f"{label} by {by}" + (f": {note.strip()[:1000]}" if note.strip() else "")
        await Q.cancel_for_posts(db, [post.id])
    await db.commit()
    await db.refresh(post)


async def sandbox_decide(db: AsyncSession, o: PublicObject, org: str, decision: str, by: str, note: str,
                         publish_at: Optional[datetime]) -> None:
    from app.services.webhook_dispatcher import dispatch_event

    d = dict(o.data or {})
    if d["status"] == "published":
        fail(409, "already_live", "This post is already live (or going live).")
    if decision == "approve":
        if publish_at is not None:
            d["publish_at_ms"] = publish_at.timestamp() * 1000
        if d.get("publish_at_ms") and d["publish_at_ms"] < _now_ms() - 60_000:
            fail(409, "approval_closed", "The publish time has passed, so this post can no longer be approved.")
        d.update(status="approved", approved_by=by, approved_at=datetime.utcnow().isoformat() + "Z", note=None)
    else:
        d.update(status="canceled" if decision == "cancel" else "rejected", note=note or None)
    o.data = d
    await db.commit()
    out = sandbox_view(o, org)
    dispatch_event(org, {"approve": "post.approved", "reject": "post.rejected", "cancel": "post.rejected"}[decision], {"post": out}, test=True)
    if out["status"] == "published":
        dispatch_event(org, "post.published", {"post": out}, test=True)


# ── Routes ───────────────────────────────────────────────────────────────────
@router.post("/posts", status_code=202)
async def create(body: CreatePostIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Write a post from a prompt. It is ready to preview shortly (watch the post.ready event, or poll the post)."""
    ctx = await authorize(request, db, "social:write", "social")
    return await create_post(db, request, ctx, body)


@router.get("/posts/{post_id}")
async def get_one(post_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await authorize(request, db, "social:write", "social")
    return await full_view(db, post_id, ctx["org_id"])


@router.get("/posts")
async def list_posts(request: Request, status: Optional[str] = None, channel: Optional[str] = None, source: Literal["api", "all"] = "api",
                     limit: int = 20, cursor: str = "", db: AsyncSession = Depends(get_db)):
    ctx = await authorize(request, db, "social:write", "social")
    lim, off = page_args(limit, cursor)
    if is_test(ctx):
        rows = (await db.execute(select(PublicObject).where(PublicObject.kind == "sandbox_post")
                                 .order_by(PublicObject.created_at.desc()).offset(off).limit(lim + 1))).scalars().all()
        items = [sandbox_view(o, ctx["org_id"]) for o in rows]
    else:
        q = select(SocialPost).order_by(SocialPost.created_at.desc())
        if source == "api":
            q = q.where(SocialPost.source == "api")
        rows = (await db.execute(q.offset(off).limit((lim + 1) * 3 if (status or channel) else lim + 1))).scalars().all()
        if channel:
            from app.services.social_publisher import normalize_platform

            want = normalize_platform(channel)
            rows = [p for p in rows if want in (p.channels or [])]
        items = [view(p, ctx["org_id"]) for p in rows]
    if status:
        items = [i for i in items if i["status"] == status]
    return page_of(items, lim, off)


@router.patch("/posts/{post_id}")
async def edit(post_id: str, body: EditPostIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Change the text, picture, channels or time by hand, or ask the AI to write it again."""
    ctx = await authorize(request, db, "social:write", "social")
    if post_id.startswith(SANDBOX_PREFIX):
        o = await db.get(PublicObject, post_id)
        if not o:
            fail(404, "not_found", f"Post '{post_id}' not found.")
        d = dict(o.data or {})
        if d["status"] == "published":
            fail(409, "already_live", "This post is live and can no longer be edited.")
        if body.headline is not None:
            d["headline"] = body.headline
        if body.caption is not None:
            d["caption"] = body.caption
        if body.regenerate in ("text", "both"):
            d["caption"] = f"[Test rewrite] {body.instruction or d['caption']}"[:400]
        if body.channels is not None:
            d["channels"] = _clean_channels(body.channels)
        if body.publish_at is not None:
            d["publish_at_ms"] = body.publish_at.timestamp() * 1000
        if body.image is not None:
            d["image_url"] = None if body.image.mode == "none" else (body.image.url if body.image.mode == "url" else SANDBOX_IMAGE)
        if body.regenerate in ("image", "both"):
            d["image_url"] = SANDBOX_IMAGE
        d["status"] = "needs_approval"  # a change always goes back for approval
        o.data = d
        await db.commit()
        return sandbox_view(o, ctx["org_id"])
    post = await get_post(db, post_id)
    if not post:
        fail(404, "not_found", f"Post '{post_id}' not found.")
    manual = any(v is not None for v in (body.headline, body.caption, body.channels, body.publish_at)) or \
        (body.image is not None and body.image.mode != "ai")
    if manual:
        await edit_post(db, request, ctx, post, body)
    what = body.regenerate or ("image" if (body.image is not None and body.image.mode == "ai") else None)
    if what:
        instruction = (body.instruction or (body.image.instruction if body.image else "") or "").strip()
        await regenerate(db, ctx, post, what, instruction)
    elif not manual:
        fail(422, "nothing_to_change", "Send at least one thing to change (headline, caption, channels, publish_at, image or regenerate).")
    return view(post, ctx["org_id"], status_of(post))


@router.post("/posts/{post_id}/decision")
async def decision(post_id: str, body: DecisionIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Approve, reject or cancel. This is the only way a post goes live."""
    ctx = await authorize(request, db, "social:approve", "social")
    by = _by(ctx)
    if post_id.startswith(SANDBOX_PREFIX):
        o = await db.get(PublicObject, post_id)
        if not o:
            fail(404, "not_found", f"Post '{post_id}' not found.")
        await sandbox_decide(db, o, ctx["org_id"], body.decision, by, body.note or "", body.publish_at)
        return sandbox_view(o, ctx["org_id"])
    post = await get_post(db, post_id)
    if not post:
        fail(404, "not_found", f"Post '{post_id}' not found.")
    await decide(db, post, body.decision, by, body.note or "", body.publish_at)
    return view(post, ctx["org_id"])
