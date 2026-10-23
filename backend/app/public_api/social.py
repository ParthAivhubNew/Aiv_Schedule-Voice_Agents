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
             f"Connect {', '.join(missing)} first: call channel.connect (POST /v1/social/channels/connect), or connect it in the app (Social, Accounts). Then try again.",
             channels=missing, connect_action="channel.connect", fix_url=links.fix_url("social_accounts"))


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


# ── Connecting the networks from the partner's own page ─────────────────────────────────────────
CHANNEL_PROVIDERS = (("linkedin", "LinkedIn"), ("facebook", "Facebook"), ("instagram", "Instagram"), ("x", "X"), ("threads", "Threads"))
CHANNEL_STATUS = {"connected": "connected", "ok": "connected", "expired": "needs_reauth"}


class ChannelConnectIn(BaseModel):
    provider: str = Field(..., description="linkedin, facebook, instagram, x or threads")
    return_url: str = Field(..., max_length=2000, description="One of your registered return URLs. The popup ends here.")


async def _partner_of(db: AsyncSession, ctx: Dict[str, Any]):
    from app.models.models import Partner, PartnerLink

    link = (await db.execute(select(PartnerLink).where(PartnerLink.key_id == str(ctx.get("key_id") or ""),
                                                       PartnerLink.status == "active"))).scalars().first()
    return await db.get(Partner, link.partner_id) if link else None


def _channel_view(a: SocialAccount) -> Dict[str, Any]:
    from app.services.social_publisher import normalize_platform

    return {"id": a.id, "provider": normalize_platform(a.platform), "display_name": a.label or a.handle or "",
            "status": CHANNEL_STATUS.get(str(a.status or "").lower(), "error"),
            "connected_at": a.created_at.isoformat() + "Z" if getattr(a, "created_at", None) else None}


@router.get("/channels/providers")
async def channel_providers(request: Request, db: AsyncSession = Depends(get_db)):
    """The networks that can be connected, and whether each is set up on our side right now."""
    from app.services.social_oauth import get_oauth_app

    await authorize(request, db, "social:write", "social")
    out = []
    for key, label in CHANNEL_PROVIDERS:
        out.append({"provider": key, "label": label, "available": bool((await get_oauth_app(db, key)).get("configured"))})
    return {"providers": out}


@router.post("/channels/connect")
async def channel_connect(body: ChannelConnectIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Start connecting a network. Open `auth_url` in a popup; it ends at your return_url with ?status=connected|error&provider=&channel_id=."""
    from app.services import partners as PT
    from app.services.social_oauth import start_oauth
    from app.services.social_publisher import normalize_platform

    ctx = await authorize(request, db, "social:write", "social")
    provider = normalize_platform(body.provider)
    if provider not in CHANNELS:
        fail(422, "unknown_provider", f"Use one of: {', '.join(CHANNELS)}.")
    partner = await _partner_of(db, ctx)
    if not partner:
        fail(403, "partner_only", "Connecting a network from your own page is for keys issued through the partner program.")
    try:
        url = PT.check_return_url(partner, body.return_url)
    except PT.PartnerError as err:
        fail(err.status, err.code, err.message)
    if PT._origin(url) not in (partner.allowed_origins or []):
        fail(422, "return_url_origin_not_allowed", "The return_url's web address must also be one of your allowed web addresses.")
    expires = time.time() + 1800
    if is_test(ctx):
        sep = "&" if "?" in url else "?"
        return {"auth_url": f"{url}{sep}status=connected&provider={provider}&channel_id=sim_{provider}", "state": "simulated",
                "expires_at": _iso_ms(expires * 1000), "simulated": True}
    res = await start_oauth(db, provider, partner_return=url)
    if not res.get("ok"):
        fail(503, "provider_unavailable", f"{provider.title()} cannot be connected right now. We have been told.")
    return {"auth_url": res["authUrl"], "state": res["state"], "expires_at": _iso_ms(expires * 1000)}


@router.get("/channels")
async def channel_list(request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await authorize(request, db, "social:write", "social")
    if is_test(ctx):
        return {"channels": [{"id": f"sim_{k}", "provider": k, "display_name": f"Test {label}", "status": "connected", "connected_at": None}
                             for k, label in CHANNEL_PROVIDERS], "simulated": True}
    rows = (await db.execute(select(SocialAccount).order_by(SocialAccount.created_at.desc()))).scalars().all()
    return {"channels": [_channel_view(a) for a in rows]}


@router.delete("/channels/{channel_id}")
async def channel_disconnect(channel_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    from app.core.tenancy import current_org
    from app.services.social_publisher import normalize_platform
    from app.services.webhook_dispatcher import dispatch_event

    ctx = await authorize(request, db, "social:write", "social")
    if is_test(ctx):
        return {"ok": True, "simulated": True}
    acc = await db.get(SocialAccount, channel_id)
    if not acc:
        fail(404, "channel_not_found", "No connected channel has that id.")
    provider = normalize_platform(acc.platform)
    await db.delete(acc)
    await db.commit()
    dispatch_event(current_org(), "social.channel.disconnected", {"provider": provider, "channel_id": channel_id, "org_id": current_org()})
    return {"ok": True}


# ── Results: Insights, one post's numbers, and shareable reports ────────────────────────────────
def _link_expiry_iso() -> str:
    from app.services import social_reports as SR

    return datetime.utcfromtimestamp(SR.new_link_expiry()).isoformat() + "Z"


class ReportIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120, description="For example the client's name")
    days: Literal[7, 30, 90] = 30
    channels: List[str] = Field(default_factory=list, description="Leave empty for every network")
    account_ids: List[str] = Field(default_factory=list, alias="accountIds")
    recipients: List[str] = Field(default_factory=list, description="Emails that get it when it is sent")
    frequency: Literal["none", "weekly", "monthly"] = "none"
    intro: str = Field("", max_length=2000)

    model_config = {"populate_by_name": True}


class ReportSendIn(BaseModel):
    to: Optional[List[str]] = Field(None, description="Send to these instead of the report's own recipients")


@router.get("/insights")
async def insights_get(request: Request, days: int = 30, channel: str = "", account: str = "", db: AsyncSession = Depends(get_db)):
    """How published posts did: totals and changes, by network, daily series, best posts, best times and followers.
    `channel` and `account` take comma-separated lists. Numbers are as of `lastSyncedAt`; they are re-read from the networks every few hours."""
    from fastapi import HTTPException

    from app.api.scheduler_insights import insights

    ctx = await authorize(request, db, "social:write", "social")
    if is_test(ctx):
        return {"days": days, "totals": {"posts": 0, "reach": None, "impressions": None, "engagements": None}, "byChannel": [], "series": [],
                "top": [], "followers": [], "lastSyncedAt": None, "simulated": True}
    try:
        return await insights(days=days, channel=channel, account=account, db=db)
    except HTTPException as err:
        fail(422, "invalid_days", str(err.detail))


@router.get("/posts/{post_id}/results")
async def post_results_get(post_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """One post's numbers per network, with `asOf` (when they were last read), leads, meetings and tracked link clicks."""
    from fastapi import HTTPException

    from app.api.scheduler_insights import post_results

    ctx = await authorize(request, db, "social:write", "social")
    if is_test(ctx) or post_id.startswith(SANDBOX_PREFIX):
        return {"title": "Test post", "channels": [], "totals": None, "links": [], "linkClicks": 0, "leads": 0, "meetings": 0, "test": True, "asOf": None}
    try:
        return await post_results(post_id, db)
    except HTTPException:
        fail(404, "post_not_found", "No post has that id.")


@router.post("/posts/{post_id}/results/link")
async def post_results_link_make(post_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """A link anyone can open with no sign-in. It always shows the post's latest numbers and works for 120 days."""
    ctx = await authorize(request, db, "social:write", "social")
    if is_test(ctx):
        return {"link": "https://example.test/post-results", "expires_at": _link_expiry_iso(), "simulated": True}
    if not await get_post(db, post_id):
        fail(404, "post_not_found", "No post has that id.")
    from app.services import social_reports as SR

    return {"link": SR.post_share_url(post_id, ctx["org_id"]), "expires_at": _link_expiry_iso()}


@router.get("/reports")
async def reports_list_get(request: Request, db: AsyncSession = Depends(get_db)):
    from app.models.models import SocialReport
    from app.services import social_reports as SR

    ctx = await authorize(request, db, "social:write", "social")
    if is_test(ctx):
        return {"data": [], "simulated": True}
    rows = (await db.execute(select(SocialReport).order_by(SocialReport.created_at.desc()))).scalars().all()
    return {"data": [SR.view(r) for r in rows]}


@router.post("/reports", status_code=201)
async def report_create(body: ReportIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Save a report definition (period, networks, recipients) and get its live link. The page it opens says when its numbers are from."""
    from app.models.models import SocialReport
    from app.services import social_reports as SR

    ctx = await authorize(request, db, "social:write", "social")
    payload = {"name": body.name, "days": body.days, "channels": body.channels, "accountIds": body.account_ids,
               "recipients": body.recipients, "frequency": body.frequency, "intro": body.intro}
    try:
        fields = SR.clean(payload)
    except ValueError as err:
        fail(422, "invalid_report", str(err))
    if is_test(ctx):
        return {"report": {"id": "rep_test", **payload}, "link": "https://example.test/report", "expires_at": _link_expiry_iso(), "simulated": True}
    row = SocialReport(id=f"rep_{uuid.uuid4().hex[:10]}", created_by=_by(ctx), **fields)
    db.add(row)
    await db.commit()
    return {"report": SR.view(row), "link": SR.share_url(row, ctx["org_id"]), "expires_at": _link_expiry_iso()}


async def _report(db: AsyncSession, report_id: str):
    from app.models.models import SocialReport

    row = await db.get(SocialReport, report_id)
    if not row:
        fail(404, "report_not_found", "No report has that id.")
    return row


@router.post("/reports/{report_id}/link")
async def report_link_make(report_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """A fresh link to the report's live page (works for 120 days). Earlier links keep working until they expire."""
    from app.services import social_reports as SR

    ctx = await authorize(request, db, "social:write", "social")
    if is_test(ctx):
        return {"link": "https://example.test/report", "expires_at": _link_expiry_iso(), "simulated": True}
    return {"link": SR.share_url(await _report(db, report_id), ctx["org_id"]), "expires_at": _link_expiry_iso()}


@router.post("/reports/{report_id}/send")
async def report_send(report_id: str, body: ReportSendIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Email the report now. The email states when its numbers are from and links to the live page."""
    from app.services import social_reports as SR
    from app.services.org_settings import clean_emails

    ctx = await authorize(request, db, "social:write", "social")
    if is_test(ctx):
        return {"sent": 0, "failed": 0, "simulated": True}
    row = await _report(db, report_id)
    to = clean_emails(body.to) if body.to else None
    res = await SR.send(db, row, ctx["org_id"], to)
    if not res["sent"]:
        fail(400, "report_not_sent", res["error"] or "The report could not be sent.")
    return {"sent": res["sent"], "failed": res["failed"]}


@router.delete("/reports/{report_id}")
async def report_delete(report_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    ctx = await authorize(request, db, "social:write", "social")
    if is_test(ctx):
        return {"ok": True, "simulated": True}
    row = await _report(db, report_id)
    await db.delete(row)
    await db.commit()
    return {"ok": True}


# ── Media: send a picture or video, then use its address in a post ──────────────────────────────
class _BytesUpload:
    """Lets the app's chunked saver read an upload that arrived as base64."""

    def __init__(self, raw: bytes):
        self._raw, self._at = raw, 0

    async def read(self, n: int = -1) -> bytes:
        chunk = self._raw[self._at:] if n < 0 else self._raw[self._at:self._at + n]
        self._at += len(chunk)
        return chunk


class MediaIn(BaseModel):
    filename: str = Field("file", max_length=200)
    content_type: str = Field(..., description="image/png, image/jpeg, image/webp, video/mp4 or video/quicktime")
    content_base64: str = Field(..., description="The file, base64 encoded")
    alt: str = Field("", max_length=1000, description="Describes the picture, for people who cannot see it")
    tags: List[str] = Field(default_factory=list, max_length=20)


class MediaUrlIn(BaseModel):
    url: str = Field(..., max_length=2000, description="A public https:// address to copy into the library")


def _media_view(m) -> Dict[str, Any]:
    from app.services import social_library as SL

    v = SL.view(m)
    base = links.public_base()
    if v.get("url", "").startswith("/") and base:
        v["url"] = base + v["url"]  # a full address, so it can go straight into a post's image.url
    return v


@router.post("/media", status_code=201)
async def media_upload(body: MediaIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Add a picture or video to the library. Use the returned `url` as `image.url` (mode `url`) when creating a post."""
    import base64
    import binascii

    from app.services import social_library as SL

    ctx = await authorize(request, db, "social:write", "social")
    try:
        raw = base64.b64decode(body.content_base64, validate=True)
    except (binascii.Error, ValueError):
        fail(422, "invalid_file", "content_base64 is not valid base64.")
    if is_test(ctx):
        return {"id": "med_test", "url": "https://example.test/media/test.png", "kind": "image", "simulated": True}
    try:
        url, size = await SL.MS.store_upload(_BytesUpload(raw), body.content_type)
        row = await SL.add_file(db, url, size=size, name=body.filename, source="upload", by=_by(ctx), alt=body.alt, tags=SL.clean_tags(body.tags))
    except ValueError as err:
        fail(422, "invalid_file", str(err))
    await db.commit()
    return _media_view(row)


@router.post("/media/import-url", status_code=201)
async def media_import(body: MediaUrlIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Copy a file from a public address into the library."""
    from app.services import social_library as SL

    ctx = await authorize(request, db, "social:write", "social")
    if is_test(ctx):
        return {"id": "med_test", "url": "https://example.test/media/test.png", "kind": "image", "simulated": True}
    try:
        row = await SL.import_remote(db, body.url, by=_by(ctx), source="upload")
    except ValueError as err:
        fail(422, "invalid_file", str(err))
    await db.commit()
    return _media_view(row)


@router.get("/media")
async def media_list(request: Request, kind: str = "", q: str = "", db: AsyncSession = Depends(get_db)):
    """The library, newest first."""
    from app.models.models import SocialMedia

    ctx = await authorize(request, db, "social:write", "social")
    if is_test(ctx):
        return {"data": [], "simulated": True}
    stmt = select(SocialMedia).order_by(SocialMedia.created_at.desc()).limit(200)
    if kind in ("image", "video"):
        stmt = stmt.where(SocialMedia.kind == kind)
    rows = (await db.execute(stmt)).scalars().all()
    needle = q.strip().lower()
    if needle:
        rows = [m for m in rows if needle in (m.name or "").lower() or needle in (m.alt_text or "").lower()]
    return {"data": [_media_view(m) for m in rows]}


@router.delete("/media/{media_id}")
async def media_delete(media_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Remove a file from the library. Posts that already use it keep working; the file itself stays."""
    from app.models.models import SocialMedia

    ctx = await authorize(request, db, "social:write", "social")
    if is_test(ctx):
        return {"ok": True, "simulated": True}
    row = await db.get(SocialMedia, media_id)
    if not row:
        fail(404, "media_not_found", "No file in the library has that id.")
    await db.delete(row)
    await db.commit()
    return {"ok": True}


# ── Plan AI: plan many posts at once, then create them ──────────────────────────────────────────
class PlanIn(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=2000, description='For example: "plan a month of LinkedIn posts, Mondays and Thursdays, about onboarding"')
    channels: List[str] = Field(default_factory=lambda: ["linkedin"], min_length=1, max_length=5)
    pinned_dates: List[str] = Field(default_factory=list, description="YYYY-MM-DD dates the plan should prefer")


class PlanPostIn(BaseModel):
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$", description="YYYY-MM-DD, in your company's time zone")
    time: str = Field("09:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    channel: str
    headline: str = Field(..., min_length=1, max_length=300)
    angle: str = Field("", max_length=1500, description="What the post says")


class PlanApplyIn(BaseModel):
    posts: List[PlanPostIn] = Field(..., min_length=1, max_length=30)
    tone: Optional[str] = Field(None, max_length=60)
    approvers: Optional[List[str]] = Field(None, max_length=10)


@router.post("/plan")
async def plan_create(body: PlanIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Ask Plan AI for an outline: which posts, on which days and channels, about what. Nothing is created or written yet.
    Show it to your user, then send the posts you want to `plan.apply`."""
    from datetime import timedelta

    ctx = await authorize(request, db, "social:write", "social")
    channels = _clean_channels(body.channels)
    if is_test(ctx):
        day = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%d")
        return {"reply": "Test plan.", "posts": [{"date": day, "time": "09:00", "channel": channels[0], "headline": "Test post", "angle": "What this post says"}],
                "simulated": True}
    from app.api.scheduler import chat_plan

    res = await chat_plan({"text": body.prompt, "selectedChannels": channels, "pinnedDates": body.pinned_dates, "currentPlan": {"posts": []}}, db)
    if res.get("status") == "error" or not res.get("plan"):
        fail(502 if res.get("error") in ("ai_unavailable", "plan_cut_off") else 422, res.get("error") or "no_plan",
             res.get("reply") or "Plan AI did not come back with a plan. Try again, or say more about what you want.")
    posts = [{"date": p.get("date"), "time": p.get("time") or "09:00", "channel": p.get("channel") or channels[0],
              "headline": p.get("headline") or "", "angle": p.get("plan") or p.get("angle") or ""} for p in (res["plan"].get("posts") or []) if not p.get("existing")]
    return {"reply": res.get("reply") or "", "range": res["plan"].get("rangeLabel") or "", "posts": posts}


@router.post("/plan/apply", status_code=202)
async def plan_apply(body: PlanApplyIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Create the posts of a plan (up to 30). Each is written by the AI and waits for approval like any post made through the API."""
    from app.public_api.core import ApiError

    ctx = await authorize(request, db, "social:write", "social")
    created: List[Dict[str, Any]] = []
    failed: List[Dict[str, Any]] = []
    for p in body.posts:
        try:
            when = datetime.fromisoformat(f"{p.date}T{p.time}")
        except ValueError:
            failed.append({"headline": p.headline, "error": {"code": "invalid_publish_at", "message": f"{p.date} {p.time} is not a valid date and time."}})
            continue
        try:
            created.append(await create_post(db, request, ctx, CreatePostIn(
                prompt=f"{p.headline}. {p.angle}".strip(". ")[:4000], channels=[p.channel], publish_at=when, tone=body.tone, approvers=body.approvers)))
        except ApiError as err:
            await db.rollback()
            failed.append({"headline": p.headline, "error": {"code": err.code, "message": err.message}})
    if not created:
        first = failed[0]["error"]
        fail(422, first["code"], first["message"], failed=failed)
    return {"data": created, "failed": failed}
