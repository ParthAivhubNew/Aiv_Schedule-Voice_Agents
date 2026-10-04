from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, FileResponse
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db, engine
from app.services.org_settings import org_instant_ms, org_timezone
from app.services import approval_mail, post_versions, schedule_engine
from app.services.endpoints import is_self_hosted
from app.services import generation_queue as gen_queue
from app.services.generation_queue import IMAGE_SLOTS, PRIORITY_INTERACTIVE, TEXT_SLOTS
from app.services.timezone_service import tzinfo
from app.models.models import SocialPost, SocialGenJob, SocialAccount, SocialSchedule, CompanyProfile, SchedulerSetting, Connection
from app.services.post_writer import (
    create_topic_image_prompt,
    generate_image_with_provider,
    ASPECT_RATIOS,
)
from app.services.social_publisher import (
    account_public_dict,
    test_account,
    publish_post_to_accounts,
    normalize_platform,
)
from app.services.social_oauth import (
    PLATFORMS as OAUTH_PLATFORMS,
    get_oauth_app,
    public_app_dict,
    save_oauth_app,
    start_oauth,
    finish_oauth,
    callback_html,
)
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import asyncio
import uuid
import logging
import time
import random
import re
import json

logger = logging.getLogger("scheduler_api")

router = APIRouter(prefix="/scheduler", tags=["Post Scheduler"])

_SOCIAL_POST_EXTRA_COLS = [
    ("topic_id", "VARCHAR"),
    ("schedule_id", "VARCHAR"),
    ("tone", "VARCHAR"),
    ("image_url", "TEXT"),
    ("image_prompt", "TEXT"),
    ("hook", "TEXT"),
    ("linkedin_copy", "TEXT"),
    ("x_copy", "TEXT"),
    ("facebook_copy", "TEXT"),
    ("instagram_copy", "TEXT"),
    ("threads_copy", "TEXT"),
    ("hashtags", "JSON"),
    ("cta", "TEXT"),
    ("first_comment", "TEXT"),
    ("alt_text", "TEXT"),
    ("adapt_per_channel", "BOOLEAN"),
    ("publish_results", "JSON"),
    ("published_at", "VARCHAR"),
    ("due_at_ms", "FLOAT"),
    ("gen_state", "VARCHAR"),
    ("gen_error", "TEXT"),
    ("edited_by_user", "BOOLEAN"),
    ("approval_requested_at", "TIMESTAMP"),
    ("approved_by", "VARCHAR"),
    ("approved_at", "TIMESTAMP"),
    ("review_note", "TEXT"),
    ("occurrence", "VARCHAR"),
    ("detached", "BOOLEAN"),
    ("asap", "BOOLEAN"),
    ("publish_attempts", "INTEGER"),
    ("retry_at_ms", "FLOAT"),
]

# social_schedules predates the Schedule window (weekday/time/theme/focus/channels only).
_SOCIAL_SCHEDULE_EXTRA_COLS = [
    ("frequency", "VARCHAR"),
    ("pattern", "VARCHAR"),
    ("start_date", "VARCHAR"),
    ("end_date", "VARCHAR"),
    ("month_day", "INTEGER"),
    ("custom_dates", "JSON"),
    ("date_topics", "JSON"),
    ("make_image", "BOOLEAN"),
    ("approver_emails", "JSON"),
    ("result_emails", "JSON"),
    ("retry_count", "INTEGER"),
    ("retry_delay_min", "INTEGER"),
    ("status", "VARCHAR"),
    ("ended_reason", "VARCHAR"),
    ("reminder_sent_at", "TIMESTAMP"),
    ("created_at", "TIMESTAMP"),
    ("updated_at", "TIMESTAMP"),
]

# A post in one of these states must never be edited back to draft/approved by a client
# save: that is how a stale browser tab re-queued already-published posts (double posting).
LOCKED_STATUSES = ("published", "publishing")
MAX_POSTS_PER_REQUEST = 90  # post rows, counting each channel copy
MAX_WRITTEN_PER_REQUEST = 50  # pieces of content written (one per group)
MAX_BRIEF_CHARS = 4000
MAX_NOTE_CHARS = 2000


async def ensure_social_schema() -> None:
    """Called at startup: add new social_posts columns and release posts stuck mid-publish."""
    await _repair_social_posts_schema()
    try:
        async with engine.begin() as conn:
            # A crash mid-publish leaves the outcome unknown. Surface it instead of retrying
            # blindly (which could double-post) or leaving it stuck forever.
            await conn.execute(text(
                "UPDATE social_posts SET status = 'failed' WHERE status = 'publishing'"
            ))
    except Exception as e:
        logger.warning(f"Could not release stuck publishing posts: {e}")
    await _drop_retired_table("social_topics")


async def _drop_retired_table(table: str) -> None:
    """Drop a table no code uses any more, but only while it is empty: rows are user data."""
    try:
        async with engine.begin() as conn:
            count = (await conn.execute(text(f"SELECT COUNT(*) FROM {table}"))).scalar() or 0
            if count:
                logger.warning(f"Retired table {table} still has {count} rows; kept. Remove it by hand once reviewed.")
                return
            await conn.execute(text(f"DROP TABLE {table}"))
            logger.info(f"Dropped retired empty table {table}.")
    except Exception:
        # Table already gone (fresh install) or not readable; nothing to do.
        pass


async def _repair_social_posts_schema() -> None:
    async with engine.begin() as conn:
        for table, cols in (("social_posts", _SOCIAL_POST_EXTRA_COLS), ("social_schedules", _SOCIAL_SCHEDULE_EXTRA_COLS)):
            for col, col_type in cols:
                try:
                    await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {col_type}"))
                except Exception:
                    pass


def _serialize_post(p: SocialPost) -> Dict[str, Any]:
    return {
        "id": p.id,
        "topicId": p.topic_id,
        "scheduleId": p.schedule_id,
        "title": p.title,
        "topicHeadline": p.title,
        "copy": p.copy,
        "hook": p.hook,
        "linkedinCopy": p.linkedin_copy,
        "xCopy": p.x_copy,
        "facebookCopy": p.facebook_copy,
        "instagramCopy": p.instagram_copy,
        "threadsCopy": p.threads_copy,
        "hashtags": p.hashtags or [],
        "cta": p.cta,
        "firstComment": p.first_comment,
        "altText": p.alt_text,
        "channels": p.channels or ["linkedin", "x"],
        "status": p.status,
        "slotDateMs": p.slot_date_ms,
        "dateMs": p.slot_date_ms,
        "time": p.time or "10:00",
        "theme": p.theme or "General",
        "tone": p.tone or "Professional",
        "imageUrl": p.image_url,
        "imagePrompt": p.image_prompt,
        "adaptPerChannel": bool(getattr(p, "adapt_per_channel", False)),
        "publishResults": p.publish_results or [],
        "publishedAt": p.published_at,
        "dueAtMs": getattr(p, "due_at_ms", None),
        "genState": getattr(p, "gen_state", None),
        "genError": getattr(p, "gen_error", None),
        "editedByUser": bool(getattr(p, "edited_by_user", False)),
        "approvalRequestedAt": _iso(getattr(p, "approval_requested_at", None)),
        "approvedBy": getattr(p, "approved_by", None),
        "approvedAt": _iso(getattr(p, "approved_at", None)),
        "reviewNote": getattr(p, "review_note", None),
        "occurrence": getattr(p, "occurrence", None),
        "detached": bool(getattr(p, "detached", False)),
        "asap": bool(getattr(p, "asap", False)),
        "retryAtMs": getattr(p, "retry_at_ms", None),
        "publishAttempts": getattr(p, "publish_attempts", None) or 0,
        "lastError": _last_error(p),
        "createdAt": p.created_at.isoformat() if p.created_at else None,
    }


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() + "Z" if dt else None


def _last_error(p: SocialPost) -> str:
    errs = [
        f"{(r.get('platform') or '').title()}: {r.get('error')}".strip(": ")
        for r in (p.publish_results or [])
        if isinstance(r, dict) and not r.get("ok") and r.get("error")
    ]
    return " · ".join(errs)


def _apply_due(post: SocialPost, payload: Dict[str, Any], tz: str) -> None:
    """Publish instant = date + time in the organisation timezone, computed here (never by
    the browser, whose clock may be in another country). dueAtMs is only a legacy fallback."""
    date_str = str(payload.get("date") or "").strip()
    if date_str:
        due_ms = org_instant_ms(date_str, payload.get("time") or post.time or "09:00", tz)
        if due_ms:
            post.due_at_ms = due_ms
            post.slot_date_ms = due_ms
            return
    due = payload.get("dueAtMs") if payload.get("dueAtMs") is not None else payload.get("due_at_ms")
    if due is None:
        return
    try:
        post.due_at_ms = float(due) if due else None
    except (TypeError, ValueError):
        pass


def _apply_package_fields(post: SocialPost, payload: Dict[str, Any]):
    mapping = [
        ("hook", "hook"),
        ("linkedin_copy", "linkedinCopy"),
        ("x_copy", "xCopy"),
        ("facebook_copy", "facebookCopy"),
        ("instagram_copy", "instagramCopy"),
        ("threads_copy", "threadsCopy"),
        ("cta", "cta"),
        ("first_comment", "firstComment"),
        ("alt_text", "altText"),
    ]
    for col, camel in mapping:
        val = payload.get(col)
        if val is None:
            val = payload.get(camel)
        if val is not None:
            setattr(post, col, val)
    if payload.get("hashtags") is not None:
        post.hashtags = payload.get("hashtags")
    adapt = payload.get("adaptPerChannel")
    if adapt is None:
        adapt = payload.get("adapt_per_channel")
    if adapt is not None and hasattr(post, "adapt_per_channel"):
        post.adapt_per_channel = bool(adapt)


def _host_image(image_url, request=None):
    from app.services.media_store import persist_image_url, public_base_from_request
    return persist_image_url(image_url, public_base_from_request(request))


def _public_base(request=None):
    from app.services.media_store import public_base_from_request
    return public_base_from_request(request)


# ── Scheduler AI settings ────────────────────────────────────────────────────
# The scheduler stores only its *choice* of engine here. API keys are saved once per
# provider in Connection rows (LLM / IMAGE groups, encrypted) and shared by every plugin
# that uses that provider - so the browser never has to hold or send a raw key.

TEXT_PROVIDERS = {
    "auto": "Auto",
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "deepseek": "DeepSeek",
    "groq": "Groq",
    "xai": "xAI",
    "gemini": "Google Gemini",
}
IMAGE_PROVIDERS = {
    "auto": "Auto",
    "pollinations": "Pollinations (free)",
    "openai": "OpenAI",
    "stability": "Stability AI",
    "fal": "Fal.ai",
}
DEFAULT_AI_SETTINGS: Dict[str, Any] = {
    "textProvider": "auto",
    "textModel": "",
    "imageProvider": "auto",
    "imageModel": "",
    "imageStyle": "modern_saas",
    "imageAspectRatio": "4:5",
}


def _auto_none(value: Optional[str]) -> Optional[str]:
    v = (value or "").strip().lower()
    return None if not v or v == "auto" else v


# Per-company choices that are design, not AI: how images look. The AI itself (provider,
# model, keys) is chosen by Outreach staff in the admin portal for every company.
ORG_IMAGE_PREFS = ("imageStyle", "imageAspectRatio")
NO_TEXT_AI = "The writing AI is not available right now. Please try again later or contact Outreach support."
NO_IMAGE_AI = "The image AI is not available right now. Please try again later or contact Outreach support."


async def _load_ai_settings(db: AsyncSession, slot: str = "main") -> Dict[str, Any]:
    """The AI staff chose for every company (main or backup), plus this company's image look."""
    from app.services import platform_ai

    out = dict(DEFAULT_AI_SETTINGS)
    try:
        row = (await db.execute(select(SchedulerSetting).where(SchedulerSetting.id == "default"))).scalars().first()
        if row and isinstance(row.data, dict):
            out.update({k: v for k, v in row.data.items() if k in ORG_IMAGE_PREFS and v})
    except Exception as e:
        logger.warning(f"Could not load scheduler image settings: {e}")
        await db.rollback()
    try:
        for kind in ("text", "image"):
            provider, model = await platform_ai.choice(db, kind, slot)
            out[f"{kind}Provider"] = provider or "auto"
            out[f"{kind}Model"] = model or ""
    except Exception as e:
        logger.warning(f"Could not load the platform AI choice: {e}")
        await db.rollback()
    return out


async def _saved_ai_keys(db: AsyncSession, scope: str = "scheduler") -> Dict[str, List[Dict[str, Any]]]:
    """Which providers have a saved key (masked) - for the admin portal. Never returns raw keys.
    scope: which plugin's own key groups to read (f"LLM:{scope}"/f"IMAGE:{scope}"); the legacy
    bare "LLM"/"IMAGE" groups are included too as a fallback for anything not yet migrated."""
    from app.services.key_validator import identify_provider
    from app.services.secret_box import config_get_secret, mask_secret
    text_keys: Dict[str, Dict[str, Any]] = {}
    image_keys: Dict[str, Dict[str, Any]] = {}
    from app.core.platform import platform_org_id

    # Images are Post Scheduler-only today -- no IMAGE:voice/IMAGE:leadgen groups exist, so other
    # scopes simply don't query for one rather than falling back to Scheduler's image keys.
    text_group = f"LLM:{scope}"
    groups = [text_group, "LLM"] + ([f"IMAGE:{scope}", "IMAGE"] if scope == "scheduler" else [])
    res = await db.execute(select(Connection).where(
        Connection.group_name.in_(groups), Connection.org_id == platform_org_id()))
    for c in res.scalars().all():
        cfg = c.config if isinstance(c.config, dict) else {}
        k = config_get_secret(cfg, "api_key", "apiKey", "auth_token")
        burl = (cfg.get("base_url") or cfg.get("baseUrl") or "").strip()
        if not k and not is_self_hosted(burl):
            continue
        prov_slug = str(cfg.get("provider") or c.name or "").strip().lower()
        bucket = text_keys if c.group_name in (text_group, "LLM") else image_keys
        bucket[c.name] = {
            "id": c.id,
            "provider": prov_slug or c.name,
            "name": c.name,
            "baseUrl": burl,
            "model": cfg.get("model") or "",
            "masked": c.api_key_masked or (mask_secret(k) if k else "No key needed"),
            "status": c.status or "connected",
        }
    return {"text": list(text_keys.values()), "image": list(image_keys.values())}


async def _resolve_text_ai(db: AsyncSession, payload: Optional[Dict[str, Any]] = None, slot: str = "main") -> Dict[str, Any]:
    """The writing AI staff chose (main or backup) with Outreach's key. Whatever the request
    asks for (provider, key, model, endpoint) is ignored: companies never choose the AI."""
    from app.services.llm_gateway import resolve_llm_credentials, _same_provider

    prefs = await _load_ai_settings(db, slot)
    provider = _auto_none(prefs.get("textProvider"))
    model = (prefs.get("textModel") or "").strip() or None
    creds = await resolve_llm_credentials(db=db, provider=provider, model=model, scope="scheduler")
    error = None
    is_local = is_self_hosted(creds.get("base_url"))
    if not creds.get("api_key") and not is_local:
        error = NO_TEXT_AI
    elif provider and not _same_provider(provider, creds.get("provider")):
        error = NO_TEXT_AI
    return {
        "api_key": creds.get("api_key") or None,
        "provider": creds.get("provider") or provider or "openai",
        "model": creds.get("model") or model,
        "base_url": creds.get("base_url") or None,
        "error": error,
        "explicit": False,
    }


async def _resolve_image_prefs(db: AsyncSession, payload: Optional[Dict[str, Any]] = None, slot: str = "main") -> Dict[str, Any]:
    """The image AI staff chose (main or backup). A request may only pick the look (style,
    aspect ratio); provider, key, model and endpoint fields are ignored."""
    payload = payload or {}
    prefs = await _load_ai_settings(db, slot)
    return {
        "provider": _auto_none(prefs.get("imageProvider")),
        "api_key": None,
        "model": prefs.get("imageModel") or None,
        "base_url": None,
        "style": payload.get("style") or payload.get("imageStyle") or prefs.get("imageStyle") or "modern_saas",
        "aspect_ratio": payload.get("aspect_ratio") or payload.get("aspectRatio") or prefs.get("imageAspectRatio") or "4:5",
    }


async def _image_with_backup(db: AsyncSession, payload: Dict[str, Any], prompt: str, **size) -> Dict[str, Any]:
    """Draw with the main image AI; on failure use the backup when staff set one.
    Returns the generator's result for the slot that worked; raises AIUnavailable otherwise."""
    from app.services import platform_ai

    async def attempt(slot: str) -> Dict[str, Any]:
        p = await _resolve_image_prefs(db, payload, slot)
        img = await generate_image_with_provider(
            prompt=prompt, provider=p["provider"], model=p["model"], style=p["style"],
            aspect_ratio=p["aspect_ratio"], db=db, **size,
        )
        if not img.get("imageUrl") or (img.get("status") or "ok") != "ok":
            raise platform_ai.AIUnavailable(img.get("warning") or "The image AI returned no image.")
        return img

    return await platform_ai.run_with_backup(db, "image", attempt)


@router.get("/media/{filename}")
async def serve_generated_media(filename: str):
    from app.services.media_store import safe_media_path
    path = safe_media_path(filename)
    if not path:
        raise HTTPException(status_code=404, detail="Image not found")
    media_type = "image/jpeg"
    if filename.endswith(".png"):
        media_type = "image/png"
    elif filename.endswith(".webp"):
        media_type = "image/webp"
    return FileResponse(path, media_type=media_type)


@router.get("/posts")
async def list_posts(db: AsyncSession = Depends(get_db)):
    async def _load():
        result = await db.execute(select(SocialPost).order_by(SocialPost.created_at.desc()))
        return [_serialize_post(p) for p in result.scalars().all()]

    try:
        return await _load()
    except Exception as e:
        logger.exception("list_posts failed")
        await db.rollback()
        await _repair_social_posts_schema()
        try:
            return await _load()
        except Exception as e2:
            logger.exception("list_posts failed after schema repair")
            raise HTTPException(status_code=500, detail=str(e2) or str(e))


@router.post("/generate-image")
async def generate_image_endpoint(payload: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)):
    prompt = payload.get("prompt", "")
    title = payload.get("title", "")
    theme = payload.get("theme", "Operations")
    look = await _resolve_image_prefs(db, payload)  # only the look comes from the request
    style = look["style"]
    w, h = ASPECT_RATIOS.get(look["aspect_ratio"], (1200, 675))
    width = int(payload.get("width", w))
    height = int(payload.get("height", h))

    from app.services import credits

    # Held at today's price before drawing; charged only if an image comes back.
    ref = f"img:{uuid.uuid4().hex[:16]}"
    ok, why = await credits.hold(db, [{"ref": ref, "item": "ai_image", "quantity": 1, "note": "AI image redraw"}])
    if not ok:
        raise HTTPException(status_code=402, detail=why)
    await db.commit()

    if not prompt and title:
        prompt = create_topic_image_prompt(title, theme=theme, style=style)
    elif not prompt:
        prompt = f"Modern professional illustration representing {theme}, clean vector style, high quality"

    hosted = None
    failed = "The image AI returned no image."
    try:
        async with IMAGE_SLOTS.slot(PRIORITY_INTERACTIVE):
            img = await asyncio.wait_for(_image_with_backup(db, payload, prompt, width=width, height=height),
                                         timeout=gen_queue.IMAGE_TIMEOUT_SECS)
        hosted = _host_image(img.get("imageUrl"), request)
    except asyncio.TimeoutError:
        failed = f"No image within {gen_queue.IMAGE_TIMEOUT_SECS // 60} minutes."
        img = {}
    except Exception as err:
        logger.warning(f"[Scheduler] image failed on every configured engine: {err}")
        failed = str(err) or failed
        img = {}
    if not hosted:
        await credits.release(db, [ref])  # a failed image is free
        await db.commit()
        from app.services import ai_errors

        msg = await ai_errors.failure(failed, "Image redraw")
        return {"status": "error", "imageUrl": None, "imagePrompt": prompt, "prompt": prompt, "warning": msg,
                "code": ai_errors.code_of(msg)}
    await credits.confirm_safely(db, ref, "ai_image", 1, "AI image redraw")
    return {
        "status": "ok",
        "imageUrl": hosted,
        "imagePrompt": img.get("imagePrompt") or prompt,
        "prompt": img.get("imagePrompt") or prompt,
        "width": img.get("width") or width,
        "height": img.get("height") or height,
        "warning": None,
    }


@router.post("/generate")
async def queue_generation(payload: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)):
    """Queue AI writing for posts. groups: [{postIds, plan, headline, channel, date,
    revisionNote, existingCopy, skipImage}]; posts sharing one group get the same content."""
    groups_in = payload.get("groups") or []
    groups = []
    for g in groups_in if isinstance(groups_in, list) else []:
        ids = [str(x) for x in (g.get("postIds") or g.get("post_ids") or []) if x]
        if not ids:
            continue
        groups.append({
            "post_ids": ids,
            "plan": g.get("plan") or "",
            "headline": g.get("headline") or "",
            "channel": g.get("channel") or "linkedin",
            "date": g.get("date") or "",
            "revision_note": g.get("revisionNote") or g.get("revision_note") or "",
            "existing_copy": g.get("existingCopy") or g.get("existing_copy") or "",
            "skip_image": bool(g.get("skipImage") or g.get("skip_image")),
        })
    total = sum(len(g["post_ids"]) for g in groups)
    if not groups:
        raise HTTPException(status_code=400, detail="Nothing to write.")
    from app.services import ai_errors

    if total > MAX_POSTS_PER_REQUEST or len(groups) > MAX_WRITTEN_PER_REQUEST:
        raise HTTPException(status_code=400, detail={
            "code": "USR-02", "message": ai_errors.message("USR-02") + f" At most {MAX_WRITTEN_PER_REQUEST} posts "
            f"({MAX_POSTS_PER_REQUEST} with channel copies) at once; this asked for {len(groups)} ({total})."})
    if any(len(g["plan"]) > MAX_BRIEF_CHARS or len(g["revision_note"]) > MAX_NOTE_CHARS for g in groups):
        raise HTTPException(status_code=400, detail={
            "code": "USR-04", "message": ai_errors.message("USR-04") + f" Keep each post's brief under {MAX_BRIEF_CHARS} "
            f"characters and a change request under {MAX_NOTE_CHARS}."})
    prof = (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()
    if not prof or not (prof.name or "").strip():
        raise HTTPException(status_code=400, detail={"code": "USR-05", "message": ai_errors.message("USR-05")})
    existing = {row[0] for row in (await db.execute(
        select(SocialPost.id).where(SocialPost.id.in_([pid for g in groups for pid in g["post_ids"]]))
    )).all()}
    missing = [pid for g in groups for pid in g["post_ids"] if pid not in existing]
    if missing:
        raise HTTPException(status_code=409, detail=f"Save these posts before writing them: {missing[:5]}")
    # Fair share: a company has at most MAX_BATCHES_PER_ORG requests waiting or running. A quick
    # interactive rewrite of one post is never blocked behind its own big batches.
    interactive_one = bool(payload.get("interactive")) and len(groups) == 1
    if not interactive_one and await gen_queue.running_batches(db) >= gen_queue.MAX_BATCHES_PER_ORG:
        raise HTTPException(status_code=429, detail={
            "code": "USR-06", "message": ai_errors.message("USR-06") + f" At most {gen_queue.MAX_BATCHES_PER_ORG} "
            "batches can be waiting or running at once for your company."})
    from app.services.credits import can_start

    # The first post must be affordable now; later ones are held one by one as they start, and
    # the queue pauses at the first one the company cannot afford.
    ok, why = await can_start(db, "ai_post", extra=[] if groups[0]["skip_image"] else [("ai_image", 1)])
    if not ok:
        raise HTTPException(status_code=402, detail=why)
    priority = PRIORITY_INTERACTIVE if payload.get("interactive") else 0
    by = (getattr(request.state, "auth", None) or {}).get("operator_id", "")
    batch = f"b_{uuid.uuid4().hex[:10]}"  # one request = one batch, for progress and its finish note
    options = {"linkedinDirective": payload.get("linkedinDirective") or "", "batch": batch, "by": by,
               "started": datetime.utcnow().isoformat()}
    job_ids = await gen_queue.enqueue(db, groups, priority=priority, options=options)
    await db.commit()
    return {"status": "ok", "jobs": job_ids, "posts": total, "batch": batch}


@router.get("/generate/progress")
async def generation_progress(db: AsyncSession = Depends(get_db)):
    """Stage, queue position and estimated time of this company's AI writing."""
    return await gen_queue.progress(db)


@router.get("/generate/paused")
async def paused_generation(db: AsyncSession = Depends(get_db)):
    """Writing paused because the company ran out of Post scheduler credits."""
    rows = (await db.execute(select(SocialGenJob).where(SocialGenJob.state.in_(["paused", "image_paused"])))).scalars().all()
    return {"jobs": len(rows), "posts": len({pid for j in rows for pid in (j.post_ids or [])})}


@router.post("/generate/resume")
async def resume_generation(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    """After a top-up: continue where the queue stopped ("continue") or drop what was waiting
    and start afresh ("new"). Nothing paused was charged."""
    action = str(payload.get("action") or "continue")
    if action not in ("continue", "new"):
        raise HTTPException(status_code=400, detail="action must be continue or new.")
    rows = (await db.execute(select(SocialGenJob).where(SocialGenJob.state.in_(["paused", "image_paused"])))).scalars().all()
    if not rows:
        return {"status": "ok", "resumed": 0, "dropped": 0}
    post_ids = [pid for j in rows for pid in (j.post_ids or [])]
    if action == "new":
        for j in rows:
            j.state, j.error = "done", "cancelled"
            await gen_queue.release_job(db, j.id)
        await db.execute(update(SocialPost).where(SocialPost.id.in_(post_ids))
                         .values(gen_state=None, gen_error=None).execution_options(synchronize_session=False))
        await db.commit()
        return {"status": "ok", "resumed": 0, "dropped": len(rows)}
    from app.services.credits import can_start

    ok, why = await can_start(db, "ai_image" if any(j.state == "image_paused" for j in rows) else "ai_post")
    if not ok:
        raise HTTPException(status_code=402, detail=why)
    for j in rows:
        image = j.state == "image_paused"
        j.state = "image_queued" if image else "queued"
        await db.execute(update(SocialPost).where(SocialPost.id.in_(j.post_ids or []))
                         .values(gen_state="imaging" if image else "queued", gen_error=None).execution_options(synchronize_session=False))
    await db.commit()
    gen_queue.wake()
    return {"status": "ok", "resumed": len(rows), "dropped": 0}


@router.post("/generate/retry")
async def retry_generation(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    """Put failed writing/image jobs for these posts back in the queue."""
    ids = {str(x) for x in (payload.get("postIds") or [])}
    jobs = (await db.execute(select(SocialGenJob).where(SocialGenJob.state == "failed"))).scalars().all()
    retried = 0
    for job in jobs:
        if ids & set(job.post_ids or []):
            image_only = job.error == NO_IMAGE_AI or (job.error or "").startswith("Image:")
            job.state = "image_queued" if image_only else "queued"
            job.error = None
            job.attempts = 0
            job.priority = PRIORITY_INTERACTIVE
            await db.execute(
                update(SocialPost).where(SocialPost.id.in_(job.post_ids or []))
                .values(gen_state="imaging" if image_only else "queued", gen_error=None)
                .execution_options(synchronize_session=False)
            )
            retried += 1
    await db.commit()
    gen_queue.wake()
    return {"status": "ok", "retried": retried}


@router.post("/posts/create")
async def create_post_endpoint(payload: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)):
    post_id = payload.get("id") or f"post_{uuid.uuid4().hex[:8]}"
    title = payload.get("title") or payload.get("hook") or "Untitled Social Post"
    copy = payload.get("copy") or payload.get("linkedin_copy") or payload.get("linkedinCopy") or ""
    channels = payload.get("channels") or ["linkedin", "x"]
    status = payload.get("status", "awaiting_approval")
    slot_date_ms = payload.get("slotDateMs") or (time.time() * 1000 + 86400000)
    time_str = payload.get("time", "10:00")
    theme = payload.get("theme", "Operations")
    image_url = _host_image(payload.get("imageUrl"), request)
    image_prompt = payload.get("imagePrompt")
    tz = await org_timezone(db)

    async def _upsert():
        res = await db.execute(select(SocialPost).where(SocialPost.id == post_id))
        existing_post = res.scalars().first()
        if existing_post and existing_post.status in LOCKED_STATUSES:
            # Already live (or going live). The server copy wins; the client adopts it.
            return existing_post
        if existing_post:
            before = post_versions.content_of(existing_post)
            before_status = existing_post.status
            # While the AI queue is writing this post, the server copy of the text/image is the
            # newest; a browser save made before it refreshed must not blank it.
            writing = existing_post.gen_state in ("queued", "writing", "imaging")
            if not (writing and not str(copy or "").strip()):
                existing_post.title = title
                existing_post.copy = copy
            existing_post.channels = channels
            known = payload.get("knownStatus")
            # The browser's view of the status is stale (approved or rejected by email, or
            # missed meanwhile): the server's status stands and the browser adopts it.
            if not known or known == before_status:
                existing_post.status = status
            existing_post.slot_date_ms = float(slot_date_ms)
            existing_post.time = time_str
            existing_post.theme = theme
            if image_url is not None and not (writing and not image_url):
                existing_post.image_url = image_url
            if image_prompt is not None and not writing:
                existing_post.image_prompt = image_prompt
            _apply_package_fields(existing_post, payload)
            _apply_due(existing_post, payload, tz)
            changed = await post_versions.record_version(db, existing_post, "ai" if payload.get("editSource") == "ai" else "update", before=before)
            _after_status_change(existing_post, before_status, content_changed=bool(changed))
            return existing_post
        new_post = SocialPost(
            id=post_id,
            title=title,
            copy=copy,
            channels=channels,
            status=status,
            slot_date_ms=float(slot_date_ms),
            time=time_str,
            theme=theme,
            image_url=image_url,
            image_prompt=image_prompt,
        )
        _apply_package_fields(new_post, payload)
        _apply_due(new_post, payload, tz)
        _after_status_change(new_post, None, content_changed=False)
        db.add(new_post)
        return new_post

    try:
        new_post = await _upsert()
        await db.commit()
        await db.refresh(new_post)
    except Exception:
        logger.exception("create_post failed")
        await db.rollback()
        await _repair_social_posts_schema()
        try:
            new_post = await _upsert()
            await db.commit()
            await db.refresh(new_post)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return {
        "status": "ok",
        "id": new_post.id,
        "locked": new_post.status in LOCKED_STATUSES,
        "message": f"Post saved with status: {new_post.status}",
        "post": _serialize_post(new_post),
    }


MAX_UPLOAD_BYTES = 8 * 1024 * 1024
_UPLOAD_TYPES = ("image/png", "image/jpeg", "image/jpg", "image/webp")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_WRITING_STATES = ("queued", "writing")


def _checked_upload(data_uri: str) -> str:
    """A picture chosen from the user's computer arrives as a data URI; accept real images only."""
    header, _, b64 = data_uri.partition(",")
    mime = header[5:].split(";")[0].strip().lower()
    if mime not in _UPLOAD_TYPES or ";base64" not in header:
        raise HTTPException(status_code=400, detail="Use a PNG, JPG or WebP picture.")
    if len(b64) * 3 // 4 > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="That picture is over 8 MB. Pick a smaller one.")
    return data_uri


@router.patch("/posts/{post_id}")
async def edit_post(post_id: str, payload: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)):
    """Change a post by hand: headline, caption, image, date, time, channel.
    Text or image edits mark the post "edited by you" and are saved as a version (undo)."""
    post = (await db.execute(select(SocialPost).where(SocialPost.id == post_id))).scalars().first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found. Save it first.")
    if post.status in LOCKED_STATUSES:
        raise HTTPException(status_code=409, detail="This post is live (or going live) and can no longer be edited.")
    content_keys = [k for k in ("title", "copy", "imageUrl", "imagePrompt") if k in payload]
    if content_keys and post.gen_state in _WRITING_STATES:
        raise HTTPException(status_code=409, detail="The AI is still writing this post. Edit it when it finishes.")

    before = post_versions.content_of(post)
    if "title" in payload:
        title = str(payload.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="The headline can't be empty.")
        post.title = title[:300]
    if "copy" in payload:
        post.copy = str(payload.get("copy") or "")[:20000]
    if "imageUrl" in payload:
        raw = str(payload.get("imageUrl") or "").strip()
        if raw.startswith("data:"):
            raw = _checked_upload(raw)
        post.image_url = _host_image(raw, request) if raw else None
    if "imagePrompt" in payload:
        post.image_prompt = str(payload.get("imagePrompt") or "")[:4000] or None
    if "channel" in payload:
        channel = normalize_platform(payload.get("channel"))
        if channel not in PLATFORM_TITLES:
            raise HTTPException(status_code=400, detail=f"Unknown channel: {payload.get('channel')}")
        post.channels = [channel]
    if "date" in payload or "time" in payload:
        time_str = str(payload.get("time") or post.time or "09:00").strip()
        if not _TIME_RE.match(time_str):
            raise HTTPException(status_code=400, detail="Time must look like 09:30.")
        date_str = str(payload.get("date") or "").strip()
        if not date_str:
            raise HTTPException(status_code=400, detail="Pick a date.")
        if not org_instant_ms(date_str, time_str, "UTC"):
            raise HTTPException(status_code=400, detail="Date must look like 2026-10-01.")
        post.time = time_str
        _apply_due(post, {"date": date_str, "time": time_str}, await org_timezone(db))
        if post.status == approval_mail.MISSED and (post.due_at_ms or 0) > time.time() * 1000:
            # Moved to a new slot: it goes back for approval.
            post.status = approval_mail.WAITING
            _after_status_change(post, approval_mail.MISSED, content_changed=False)

    if post.schedule_id and (("date" in payload or "time" in payload) or (content_keys and not _same_content(before, post_versions.content_of(post)))):
        # Changed by hand: the schedule no longer replaces or moves it.
        post.detached = True
    if content_keys and not _same_content(before, post_versions.content_of(post)):
        post.edited_by_user = True
        await post_versions.record_version(db, post, "you", before=before)
        _after_status_change(post, post.status, content_changed=True)
    await db.commit()
    await db.refresh(post)
    return {"status": "ok", "post": _serialize_post(post)}


APPROVED = ("approved", "scheduled")


def _after_status_change(post: SocialPost, before_status: Optional[str], content_changed: bool) -> None:
    """Keep the approval fields true to the status. Approval covers the content that was
    reviewed: a change to the text or image after approval sends the post back for review."""
    if content_changed and (post.status in APPROVED or post.status == approval_mail.REJECTED):
        post.status = approval_mail.WAITING
    if post.status in APPROVED:
        if before_status not in APPROVED:
            post.approved_by = "app"  # approved in the scheduler (the creator may approve)
            post.approved_at = datetime.utcnow()
            post.review_note = None
            post.publish_attempts = 0
            post.retry_at_ms = None
    elif post.status == approval_mail.WAITING and (before_status != approval_mail.WAITING or content_changed):
        # Back in review (new, edited after approval, rejected then changed, rescheduled after
        # a missed slot) or changed while the approvers look at it: they get a fresh email.
        post.approval_requested_at = None
        post.approved_by = None
        post.approved_at = None
        approval_mail.note_change(post.id)


def _same_content(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    return all((a.get(k) or None) == (b.get(k) or None) for k in ("title", "copy", "image_url", "image_prompt"))


@router.get("/posts/{post_id}/versions")
async def post_versions_list(post_id: str, db: AsyncSession = Depends(get_db)):
    rows = await post_versions.list_versions(db, post_id)
    return {"status": "ok", "versions": [post_versions.version_dict(v) for v in rows]}


@router.post("/posts/{post_id}/versions/{version_id}/restore")
async def post_version_restore(post_id: str, version_id: str, db: AsyncSession = Depends(get_db)):
    post = (await db.execute(select(SocialPost).where(SocialPost.id == post_id))).scalars().first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found.")
    if post.status in LOCKED_STATUSES:
        raise HTTPException(status_code=409, detail="This post is live (or going live) and can no longer be changed.")
    if post.gen_state in _WRITING_STATES:
        raise HTTPException(status_code=409, detail="The AI is still writing this post. Try again when it finishes.")
    version = next((v for v in await post_versions.list_versions(db, post_id) if v.id == version_id), None)
    if not version:
        raise HTTPException(status_code=404, detail="That version is no longer kept (only the last 10 are).")
    content = post_versions.content_of_version(version)
    post.title = content["title"] or post.title
    post.copy = content["copy"]
    post.image_url = content["image_url"]
    post.image_prompt = content["image_prompt"]
    post.edited_by_user = version.source == "you"
    await post_versions.record_version(db, post, "restore")
    await db.commit()
    await db.refresh(post)
    return {"status": "ok", "post": _serialize_post(post)}


# ── Schedules (right now / once / recurring) ────────────────────────────────

async def _schedule_view(db: AsyncSession, rows: List[SocialSchedule]) -> List[Dict[str, Any]]:
    tz = await org_timezone(db)
    today = schedule_engine.org_today(tz)
    counts: Dict[str, int] = {}
    for sid, in (await db.execute(select(SocialPost.schedule_id).where(SocialPost.schedule_id.isnot(None)))).all():
        counts[sid] = counts.get(sid, 0) + 1
    now_ms = time.time() * 1000
    return [schedule_engine.schedule_dict(r, schedule_engine.first_open_day(r, today, tz, now_ms), counts) for r in rows]


async def _cleaned_schedule(db: AsyncSession, payload: Dict[str, Any], existing: Optional[SocialSchedule] = None,
                            require_topics: bool = True) -> Dict[str, Any]:
    tz = await org_timezone(db)
    today = schedule_engine.org_today(tz)
    # Today only counts when its slot is still ahead (otherwise no post is made for it).
    due_today = org_instant_ms(today.isoformat(), str(payload.get("time") or "10:00"), tz)
    first_day = today + timedelta(days=1) if due_today and due_today <= time.time() * 1000 else today
    try:
        return schedule_engine.clean(payload, today, existing, first_day=first_day, require_topics=require_topics)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.get("/schedules")
async def list_schedules(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SocialSchedule).order_by(SocialSchedule.created_at.desc()))).scalars().all()
    return {"status": "ok", "schedules": await _schedule_view(db, rows)}


@router.post("/schedules/preview")
async def preview_schedule(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    """Which dates a schedule would post on, before saving it. Missing topics are allowed here:
    the window needs the dates to show a topic box for each."""
    values = await _cleaned_schedule(db, payload, require_topics=False)
    draft = SocialSchedule(id="preview", status="active", **values)
    tz = await org_timezone(db)
    today = schedule_engine.org_today(tz)
    first = schedule_engine.first_open_day(draft, today, tz, time.time() * 1000)
    return {"status": "ok", "schedule": schedule_engine.schedule_dict(draft, first)}


@router.post("/schedules")
async def create_schedule(payload: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)):
    values = await _cleaned_schedule(db, payload)
    sched = SocialSchedule(id=f"sch_{uuid.uuid4().hex[:12]}", status="active", **values)
    db.add(sched)
    await db.commit()
    await schedule_engine.tick(db, time.time() * 1000, _public_base(request))
    await db.refresh(sched)
    return {"status": "ok", "schedule": (await _schedule_view(db, [sched]))[0]}


@router.put("/schedules/{schedule_id}")
async def update_schedule(schedule_id: str, payload: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)):
    """Change a schedule. Its upcoming posts that nobody approved or edited by hand are
    replaced to match; approved and hand-edited posts stay as they are."""
    sched = (await db.execute(select(SocialSchedule).where(SocialSchedule.id == schedule_id))).scalars().first()
    if not sched:
        raise HTTPException(status_code=404, detail="Schedule not found.")
    values = await _cleaned_schedule(db, payload, existing=sched)
    if values.get("end_date") != sched.end_date:
        sched.reminder_sent_at = None
    for key, val in values.items():
        setattr(sched, key, val)
    sched.status = "active"
    sched.ended_reason = None
    tz = await org_timezone(db)
    replaced = await schedule_engine.remove_open_posts(db, sched, schedule_engine.org_today(tz))
    await db.commit()
    await schedule_engine.tick(db, time.time() * 1000, _public_base(request))
    await db.refresh(sched)
    return {"status": "ok", "replaced": replaced, "schedule": (await _schedule_view(db, [sched]))[0]}


@router.post("/schedules/{schedule_id}/status")
async def set_schedule_status(schedule_id: str, payload: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)):
    """Pause (no new posts; upcoming unapproved ones are removed) or resume a schedule."""
    sched = (await db.execute(select(SocialSchedule).where(SocialSchedule.id == schedule_id))).scalars().first()
    if not sched:
        raise HTTPException(status_code=404, detail="Schedule not found.")
    status = str(payload.get("status") or "")
    if status not in ("active", "paused"):
        raise HTTPException(status_code=400, detail="Status must be active or paused.")
    tz = await org_timezone(db)
    today = schedule_engine.org_today(tz)
    removed = 0
    if status == "paused":
        removed = await schedule_engine.remove_open_posts(db, sched, today)
    elif sched.frequency == "recurring" and (schedule_engine.parse_date(sched.end_date) or today) < today:
        raise HTTPException(status_code=400, detail="This schedule's end date has passed. Change the end date to run it again.")
    sched.status = status
    sched.ended_reason = None
    await db.commit()
    if status == "active":
        await schedule_engine.tick(db, time.time() * 1000, _public_base(request))
    await db.refresh(sched)
    return {"status": "ok", "removed": removed, "schedule": (await _schedule_view(db, [sched]))[0]}


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(schedule_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a schedule and its upcoming posts nobody approved or edited. Posted, approved and
    hand-edited posts stay on the calendar."""
    sched = (await db.execute(select(SocialSchedule).where(SocialSchedule.id == schedule_id))).scalars().first()
    if not sched:
        raise HTTPException(status_code=404, detail="Schedule not found.")
    tz = await org_timezone(db)
    removed = await schedule_engine.remove_open_posts(db, sched, schedule_engine.org_today(tz))
    await db.execute(
        update(SocialPost).where(SocialPost.schedule_id == schedule_id)
        .values(detached=True).execution_options(synchronize_session=False)
    )
    await db.delete(sched)
    await db.commit()
    return {"status": "ok", "removed": removed}


@router.get("/schedule-extend", response_class=HTMLResponse)
async def schedule_extend_page(t: str = "", db: AsyncSession = Depends(get_db)):
    """Page behind the link in the "schedule ends soon" email. Viewing never changes anything."""
    return HTMLResponse(await approval_mail.extend_page(db, t))


@router.post("/schedule-extend", response_class=HTMLResponse)
async def schedule_extend_submit(request: Request, db: AsyncSession = Depends(get_db)):
    form = await request.form()
    token = str(form.get("t") or "")
    notice = await approval_mail.extend_action(db, token)
    return HTMLResponse(await approval_mail.extend_page(db, token, notice=notice))


@router.get("/review", response_class=HTMLResponse)
async def review_page(t: str = "", db: AsyncSession = Depends(get_db)):
    """Page behind the link in the approval email. Viewing never changes anything."""
    tz = await org_timezone(db)
    return HTMLResponse(await approval_mail.review_page(db, t, lambda p: _due_ms(p, tz)))


@router.post("/review", response_class=HTMLResponse)
async def review_submit(request: Request, db: AsyncSession = Depends(get_db)):
    form = await request.form()
    token = str(form.get("t") or "")
    notice = await approval_mail.review_action(
        db, token, str(form.get("action") or ""), str(form.get("post") or ""), str(form.get("note") or "")
    )
    tz = await org_timezone(db)
    return HTMLResponse(await approval_mail.review_page(db, token, lambda p: _due_ms(p, tz), notice=notice))


@router.get("/approval/status")
async def approval_status(db: AsyncSession = Depends(get_db)):
    return {"status": "ok", **(await approval_mail.mail_status(db))}


@router.post("/approval/resend")
async def approval_resend(db: AsyncSession = Depends(get_db)):
    """Email the approvers again about every post still waiting (e.g. after fixing the mail account)."""
    res = await db.execute(
        update(SocialPost).where(SocialPost.status == approval_mail.WAITING)
        .values(approval_requested_at=None).execution_options(synchronize_session=False)
    )
    await db.commit()
    tz = await org_timezone(db)
    sent = await approval_mail.request_approvals(db, time.time() * 1000, lambda p: _due_ms(p, tz), _public_base(None), force=True)
    return {"status": "ok", "posts": sent, "reset": res.rowcount or 0}


@router.delete("/posts/{post_id}")
async def delete_post_endpoint(post_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(SocialPost).where(SocialPost.id == post_id))
    post = res.scalars().first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    await db.delete(post)
    await post_versions.delete_versions(db, post_id)
    await db.commit()
    return {"status": "ok", "message": f"Post {post_id} deleted."}


PLATFORM_TITLES = {
    "linkedin": "LinkedIn",
    "x": "X",
    "facebook": "Facebook",
    "instagram": "Instagram",
    "threads": "Threads",
}


def _apply_live_profile(acc: SocialAccount, test: Dict[str, Any]) -> None:
    acc.last_tested_at = datetime.utcnow().isoformat()
    if test.get("ok"):
        acc.status = "connected"
        acc.last_error = ""
        if test.get("handle"):
            acc.handle = test["handle"]
            plat = (acc.platform or "").strip().lower()
            acc.label = f"{PLATFORM_TITLES.get(plat, plat.title())} · {test['handle']}"
        if test.get("accountId") and not acc.account_id:
            acc.account_id = test["accountId"]
    else:
        # Keep the row. Cards show Reconnect — do not pretend the account vanished.
        acc.status = "expired" if (acc.access_token or "").strip() else "error"
        acc.last_error = test.get("error") or ""


@router.get("/accounts")
async def list_accounts(refresh: bool = False, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SocialAccount).order_by(SocialAccount.created_at.desc()))
    accounts = result.scalars().all()
    if refresh:
        changed = False
        for acc in accounts:
            if not (acc.access_token or "").strip():
                continue
            try:
                test = await test_account(acc)
                _apply_live_profile(acc, test)
                changed = True
            except Exception:
                logger.exception("Live name refresh failed for %s", acc.id)
        if changed:
            await db.commit()
    return [account_public_dict(a) for a in accounts]


@router.get("/oauth/apps")
async def list_oauth_apps(db: AsyncSession = Depends(get_db)):
    out = []
    for plat in OAUTH_PLATFORMS:
        app = await get_oauth_app(db, plat)
        out.append(public_app_dict(app))
    return {"apps": out, "platforms": list(OAUTH_PLATFORMS)}


@router.post("/oauth/apps")
async def upsert_oauth_app(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    plat = normalize_platform(payload.get("platform") or "")
    if plat not in OAUTH_PLATFORMS:
        raise HTTPException(status_code=400, detail="Unsupported platform")
    app = await save_oauth_app(
        db,
        plat,
        payload.get("clientId") or payload.get("client_id") or "",
        payload.get("clientSecret") or payload.get("client_secret") or "",
        payload.get("redirectUri") or payload.get("redirect_uri") or "",
        config_id=payload.get("configId") or payload.get("config_id") or "",
    )
    return {"status": "ok", "app": public_app_dict(app)}


@router.get("/oauth/{platform}/start")
async def oauth_start(platform: str, frontend: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    res = await start_oauth(db, platform, frontend_url=frontend or "")
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error") or "OAuth start failed")
    return res


@router.get("/oauth/{platform}/callback")
async def oauth_callback(
    platform: str,
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    error_description: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    plat = normalize_platform(platform)
    if error:
        html = callback_html(False, plat, error=error_description or error)
        return HTMLResponse(html)
    if not code or not state:
        html = callback_html(False, plat, error="Missing code/state from the platform. Click Connect again.")
        return HTMLResponse(html)
    try:
        result = await finish_oauth(db, plat, code, state)
    except Exception as e:
        logger.exception("OAuth callback failed")
        html = callback_html(False, plat, error=str(e))
        return HTMLResponse(html)
    html = callback_html(
        bool(result.get("ok")),
        plat,
        handle=result.get("handle") or "",
        error=result.get("error") or "",
        frontend=result.get("frontend") or "",
    )
    return HTMLResponse(html)


@router.delete("/accounts/{account_id}")
async def delete_account(account_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(SocialAccount).where(SocialAccount.id == account_id))
    acc = res.scalars().first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    await db.delete(acc)
    await db.commit()
    return {"status": "ok"}


async def _claim_for_publish(db: AsyncSession, post_id: str, from_statuses: Optional[List[str]] = None) -> bool:
    """Atomically move a post to 'publishing'. Only one caller (browser click or the
    background loop) can win, so the same post is never sent to a network twice."""
    stmt = update(SocialPost).where(
        SocialPost.id == post_id,
        SocialPost.status.notin_(list(LOCKED_STATUSES)),
    )
    if from_statuses:
        stmt = stmt.where(SocialPost.status.in_(from_statuses))
    res = await db.execute(stmt.values(status="publishing").execution_options(synchronize_session=False))
    await db.commit()
    return (res.rowcount or 0) == 1


async def _publish_claimed(db: AsyncSession, post: SocialPost, request: Optional[Request]) -> Dict[str, Any]:
    """Publish a post already claimed via _claim_for_publish. Always leaves it published or failed."""
    try:
        acc_res = await db.execute(select(SocialAccount))
        accounts = acc_res.scalars().all()
        bundled = await publish_post_to_accounts(post, accounts, _public_base(request))
    except Exception as e:
        logger.exception("Publishing %s crashed", post.id)
        bundled = {"ok": False, "allOk": False, "results": [{"ok": False, "platform": "", "error": str(e)}]}
    post.publish_results = bundled.get("results") or []
    if bundled.get("ok"):
        post.status = "published"
        post.published_at = datetime.utcnow().isoformat()
    else:
        post.status = "failed"
    await db.commit()
    await db.refresh(post)
    return bundled


@router.post("/posts/{post_id}/publish")
async def publish_post_endpoint(post_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    payload: Dict[str, Any] = {}
    try:
        raw = await request.json()
        if isinstance(raw, dict):
            payload = raw
    except Exception:
        payload = {}

    async def _load():
        res = await db.execute(select(SocialPost).where(SocialPost.id == post_id))
        return res.scalars().first()

    try:
        post = await _load()
    except Exception:
        logger.exception("publish load failed")
        await db.rollback()
        await _repair_social_posts_schema()
        try:
            post = await _load()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    if post and post.status == "published":
        return {
            "status": "ok",
            "alreadyPublished": True,
            "allOk": True,
            "results": post.publish_results or [],
            "post": _serialize_post(post),
        }
    if post and post.status == "publishing":
        raise HTTPException(status_code=409, detail="This post is already being published.")

    if not post:
        post = SocialPost(
            id=post_id,
            title=payload.get("title") or payload.get("topicHeadline") or "Untitled Social Post",
            copy=payload.get("copy") or payload.get("linkedinCopy") or payload.get("linkedin_copy") or "",
            channels=payload.get("channels") or ["linkedin"],
            status="approved",
            slot_date_ms=float(payload.get("slotDateMs") or payload.get("dateMs") or (time.time() * 1000)),
            time=payload.get("time") or "10:00",
            theme=payload.get("theme") or "Operations",
            image_url=_host_image(payload.get("imageUrl"), request),
            image_prompt=payload.get("imagePrompt"),
        )
        _apply_package_fields(post, payload)
        _apply_due(post, payload, await org_timezone(db))
        db.add(post)
        try:
            await db.commit()
            await db.refresh(post)
        except Exception:
            await db.rollback()
            await _repair_social_posts_schema()
            db.add(post)
            await db.commit()
            await db.refresh(post)
    elif payload:
        if payload.get("title") or payload.get("topicHeadline"):
            post.title = payload.get("title") or payload.get("topicHeadline") or post.title
        if payload.get("copy") or payload.get("linkedinCopy") or payload.get("linkedin_copy"):
            post.copy = payload.get("copy") or payload.get("linkedinCopy") or payload.get("linkedin_copy")
        if payload.get("channels"):
            post.channels = payload.get("channels")
        if payload.get("imageUrl"):
            post.image_url = _host_image(payload.get("imageUrl"), request)
        if payload.get("imagePrompt"):
            post.image_prompt = payload.get("imagePrompt")
        _apply_package_fields(post, payload)
        await db.commit()
        await db.refresh(post)

    if not await _claim_for_publish(db, post.id):
        raise HTTPException(status_code=409, detail="This post is already being published or was just published.")
    await db.refresh(post)

    try:
        image_url = _host_image((post.image_url or "").strip(), request)
    except Exception:
        logger.exception("Hosting image before publish failed for %s", post.id)
        image_url = None
    if image_url and image_url != post.image_url:
        post.image_url = image_url
        await db.commit()
    if not (post.image_url or "").strip():
        from app.services.post_writer import create_topic_image_prompt
        prompt = post.image_prompt or create_topic_image_prompt(post.title or "operations dashboard", theme=post.theme or "Operations")
        from app.services import credits

        # Drawn and charged like any AI image; with no credits left the post goes out without one.
        ref = f"pubimg:{post.id}:{uuid.uuid4().hex[:8]}"
        ok, _ = await credits.hold(db, [{"ref": ref, "item": "ai_image", "quantity": 1, "note": "AI image before publishing"}])
        await db.commit()
        img = {}
        if ok:
            try:
                img = await asyncio.wait_for(_image_with_backup(db, {}, prompt), timeout=gen_queue.IMAGE_TIMEOUT_SECS)
            except Exception:
                logger.exception("Image generation before publish failed for %s", post.id)
        hosted = _host_image(img["imageUrl"], request) if img.get("imageUrl") else None
        if hosted:
            post.image_prompt = img.get("imagePrompt") or prompt
            post.image_url = hosted
            await db.commit()
            await credits.confirm_safely(db, ref, "ai_image", 1, "AI image before publishing")
        elif ok:
            await credits.release(db, [ref])
            await db.commit()

    bundled = await _publish_claimed(db, post, request)
    return {
        "status": "ok" if bundled.get("ok") else "error",
        "allOk": bundled.get("allOk"),
        "results": bundled.get("results") or [],
        "error": _last_error(post) or None,
        "post": _serialize_post(post),
    }


def _due_ms(post, tz: str) -> float:
    exact = getattr(post, "due_at_ms", None)
    if exact:
        return float(exact)
    # Legacy rows: slot day + "HH:MM" in the organisation timezone.
    base = float(post.slot_date_ms or 0)
    if not base:
        return 0.0
    t = str(getattr(post, "time", None) or "09:00").strip()
    try:
        parts = t.split(":")
        hh = int(parts[0])
        mm = int(parts[1]) if len(parts) > 1 else 0
    except Exception:
        hh, mm = 9, 0
    day = datetime.fromtimestamp(base / 1000.0, tzinfo(tz))
    return day.replace(hour=hh, minute=mm, second=0, microsecond=0).timestamp() * 1000.0


async def run_publish_due(db: AsyncSession, request: Optional[Request] = None) -> Dict[str, Any]:
    """Publish approved posts whose due time has arrived.

    Shared by the /publish-due route and the background auto-publish loop in main.py,
    so posts go out with no browser open. Each post is claimed atomically first. A failure
    is retried as its schedule says (default once, 5 minutes later), and only when no
    channel took it, so a retry can never post twice; after that it stays 'failed'.
    """
    now_ms = time.time() * 1000
    tz = await org_timezone(db)
    due_of = lambda p: _due_ms(p, tz)  # noqa: E731

    try:
        await schedule_engine.tick(db, now_ms, _public_base(request))
    except Exception:
        logger.exception("Schedule tick failed")
        await db.rollback()

    # Nobody approved it before its slot: it does not go out late on its own. A "right now"
    # post has no slot; it waits a day for approval.
    waiting = (await db.execute(select(SocialPost).where(SocialPost.status == approval_mail.WAITING))).scalars().all()
    missed_posts = []
    for post in waiting:
        due_at = due_of(post)
        grace = ASAP_WAIT_MS if post.asap else approval_mail.MISSED_GRACE_MS
        if due_at and due_at < now_ms - grace:
            post.status = approval_mail.MISSED
            missed_posts.append(post)
    if missed_posts:
        await db.commit()

    try:
        await approval_mail.request_approvals(db, now_ms, due_of, _public_base(request))
    except Exception:
        logger.exception("Sending approval emails failed")
        await db.rollback()

    result = await db.execute(select(SocialPost).where(SocialPost.status.in_(["approved", "scheduled"])))
    posts = result.scalars().all()
    published = []
    failed = []
    skipped = []
    done_posts = []
    retrying = []
    for post in posts:
        due_at = max(_due_ms(post, tz), post.retry_at_ms or 0)
        if due_at and due_at > now_ms:
            skipped.append(post.id)
            continue
        if not await _claim_for_publish(db, post.id, from_statuses=["approved", "scheduled"]):
            skipped.append(post.id)
            continue
        await db.refresh(post)
        try:
            hosted = _host_image(post.image_url, request)
        except Exception:
            logger.exception("Hosting image before publish failed for %s", post.id)
            hosted = None
        if hosted:
            post.image_url = hosted
        bundled = await _publish_claimed(db, post, request)
        if not bundled.get("ok") and await _schedule_retry(db, post, now_ms):
            retrying.append(post.id)
            continue
        done_posts.append(post)
        if bundled.get("ok"):
            published.append(_serialize_post(post))
        else:
            failed.append(_serialize_post(post))
    try:
        await approval_mail.send_results(
            db,
            [p for p in done_posts if p.status == "published"],
            [p for p in done_posts if p.status != "published"],
            missed_posts,
            due_of,
        )
    except Exception:
        logger.exception("Sending results email failed")
        await db.rollback()
    return {"status": "ok", "published": published, "failed": failed, "skipped": skipped,
            "missed": [p.id for p in missed_posts], "retrying": retrying}


ASAP_WAIT_MS = 24 * 3600 * 1000


async def _schedule_retry(db: AsyncSession, post: SocialPost, now_ms: float) -> bool:
    """Put a failed post back for another try later, if its retries allow. Never when any
    channel already took it (that would post twice)."""
    if any(isinstance(r, dict) and r.get("ok") for r in post.publish_results or []):
        return False
    sched = None
    if post.schedule_id:
        sched = (await db.execute(select(SocialSchedule).where(SocialSchedule.id == post.schedule_id))).scalars().first()
    count, delay_min = schedule_engine.retry_policy(sched)
    if (post.publish_attempts or 0) >= count:
        return False
    post.publish_attempts = (post.publish_attempts or 0) + 1
    post.retry_at_ms = now_ms + delay_min * 60 * 1000
    post.status = "approved"
    await db.commit()
    logger.info(f"Publishing {post.id} failed; retry {post.publish_attempts}/{count} in {delay_min} min.")
    return True


_PLAN_FENCE_RE = re.compile(r"```(?:plan|json)\s*([\s\S]*?)```", re.I)
_JUNK_KB_RE = re.compile(
    r"SQL_ERROR|fillBuffer|errorType|\"format\"\s*:\s*\"sjson\"|hierarchies|traceid",
    re.I,
)


def _usable_kb_text(text: str) -> bool:
    t = (text or "").strip()
    if len(t) < 24:
        return False
    if _JUNK_KB_RE.search(t):
        return False
    if t.startswith("{") and ("error" in t.lower() or "traceid" in t.lower()):
        return False
    return True


def _spoken_reply(text: str, had_plan: bool) -> str:
    raw = str(text or "")
    spoken = _PLAN_FENCE_RE.sub("", raw).strip()
    spoken = re.sub(r"```[\s\S]*?```", "", spoken).strip()
    if not _usable_kb_text(spoken) or _JUNK_KB_RE.search(spoken):
        if had_plan:
            return "Draft is on the calendar. Change the image or caption, then approve to post."
        return "Give me the business topic and the date to publish. I will draft caption and image for you to edit."
    if re.search(r"real scene for this day|draft onto this date|file, meeting, or system", spoken, re.I):
        if had_plan:
            return "Pinned. Write the post plan, then generate. I will use the company profile."
        return "Pinned. Write what the post should be about, then Generate draft."
    if len(spoken) > 5000:
        spoken = spoken[:4980].rstrip() + "…"
    return spoken or (
        "Draft is on the calendar. Change the image or caption, then approve to post."
        if had_plan
        else "Tell me the topic and when it should go out."
    )


_WEEKDAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _norm_channel(raw: Any) -> str:
    ch = str(raw or "linkedin").strip().lower()
    return "x" if ch in ("twitter", "tweet") else ch


def _expand_rule(rule: Dict[str, Any], themes: List[Any], channels: List[str], today: str) -> List[Dict[str, Any]]:
    """Dates for a repeating pattern are worked out here, not by the model."""
    days = {_WEEKDAYS[d] for d in (str(x).upper()[:2] for x in (rule.get("weekdays") or [])) if d in _WEEKDAYS}
    if not days:
        days = set(range(7))
    start_raw = str(rule.get("start") or today)
    start = datetime.strptime(start_raw if _ISO_DATE_RE.match(start_raw) and start_raw >= today else today, "%Y-%m-%d")
    count = int(rule.get("count") or 0) or None
    weeks = int(rule.get("weeks") or 0) or (None if count else 4)
    end = start + timedelta(days=7 * weeks) if weeks else None
    times = rule.get("times") or [rule.get("time") or "09:00"]
    chans = [_norm_channel(c) for c in (rule.get("channels") or channels or ["linkedin"])]
    out: List[Dict[str, Any]] = []
    day = start
    while len(out) < MAX_POSTS_PER_REQUEST + 1:
        if end and day >= end:
            break
        if day.weekday() in days:
            for t in times:
                for ch in chans:
                    theme = themes[len(out) % len(themes)] if themes else {}
                    theme = theme if isinstance(theme, dict) else {"headline": str(theme)}
                    out.append({
                        "date": day.strftime("%Y-%m-%d"), "time": str(t)[:5], "channel": ch,
                        "headline": str(theme.get("headline") or theme.get("title") or "")[:180],
                        "plan": str(theme.get("angle") or theme.get("plan") or theme.get("headline") or ""),
                    })
            if count and len(out) >= count:
                out = out[:count]
                break
        day += timedelta(days=1)
    return out


def _extract_plan_from_text(text: str, today: str, known_ids: Optional[set] = None) -> Optional[Dict[str, Any]]:
    """Read the plan outline from the chat reply. New posts carry an outline only (the
    writer queue drafts captions); existing posts carry their id and what changes."""
    known_ids = known_ids or set()
    raw = str(text or "")
    blob = None
    m = _PLAN_FENCE_RE.search(raw)
    if m:
        blob = m.group(1).strip()
    else:
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start and ('"posts"' in raw[start:end + 1] or '"rule"' in raw[start:end + 1]):
            blob = raw[start:end + 1]
    if not blob:
        return None
    try:
        data = json.loads(blob)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    channels = [_norm_channel(c) for c in data.get("channels") or [] if c]
    raw_posts: List[Dict[str, Any]] = [p for p in (data.get("posts") or []) if isinstance(p, dict)]
    if isinstance(data.get("rule"), dict):
        themes = data.get("themes") if isinstance(data.get("themes"), list) else []
        raw_posts += _expand_rule(data["rule"], themes, channels, today)
    delete_ids = [str(x) for x in (data.get("delete") or []) if str(x) in known_ids]
    cleaned: List[Dict[str, Any]] = []
    for i, p in enumerate(raw_posts):
        pid = str(p.get("id") or "")
        existing = pid in known_ids
        date = str(p.get("date") or "").strip()
        if date and not _ISO_DATE_RE.match(date):
            date = ""
        if not existing and not date:
            date = (datetime.strptime(today, "%Y-%m-%d") + timedelta(days=i)).strftime("%Y-%m-%d")
        item: Dict[str, Any] = {
            "id": pid if existing else f"v2_{uuid.uuid4().hex[:10]}",
            "existing": existing,
            "channel": _norm_channel(p.get("channel")) if (p.get("channel") or not existing) else None,
            "headline": str(p.get("headline") or p.get("title") or "")[:180] or None,
            "plan": str(p.get("angle") or p.get("plan") or "")[:1200] or None,
            "date": date or None,
            "time": str(p.get("time"))[:5] if p.get("time") else (None if existing else "09:00"),
            "revision": str(p.get("revision") or "")[:600] or None,
        }
        if not existing and not item["headline"]:
            item["headline"] = (item["plan"] or "Draft post")[:180]
        cleaned.append({k: v for k, v in item.items() if v is not None})
    if not cleaned and not delete_ids:
        return None
    too_many = len([c for c in cleaned if not c["existing"]]) > MAX_POSTS_PER_REQUEST
    if too_many:
        kept, new_count = [], 0
        for c in cleaned:
            if not c["existing"]:
                new_count += 1
                if new_count > MAX_POSTS_PER_REQUEST:
                    continue
            kept.append(c)
        cleaned = kept
    if not channels:
        channels = sorted({c["channel"] for c in cleaned if c.get("channel")})
    return {
        "rangeLabel": str(data.get("rangeLabel") or data.get("label") or ""),
        "channels": channels,
        "posts": cleaned,
        "deleteIds": delete_ids,
        "cappedAt": MAX_POSTS_PER_REQUEST if too_many else None,
    }


def _last_user_text(chat_msgs: List[Dict[str, Any]]) -> str:
    for m in reversed(chat_msgs or []):
        if isinstance(m, dict) and m.get("role") == "user":
            return str(m.get("content") or "")
    return ""


async def _protect_hand_edits(db: AsyncSession, plan: Optional[Dict[str, Any]], focus_id: str, user_text: str) -> int:
    """A chat request that rewrites several posts skips posts edited by hand, unless the user
    is working on that post or names its headline. Returns how many were left alone."""
    if not plan:
        return 0
    text_keys = ("revision", "headline", "plan")
    revising = [p for p in plan.get("posts") or [] if p.get("existing") and any(p.get(k) for k in text_keys)]
    if len(revising) < 2:
        return 0
    ids = [p["id"] for p in revising]
    rows = (await db.execute(
        select(SocialPost.id, SocialPost.title).where(SocialPost.id.in_(ids), SocialPost.edited_by_user.is_(True))
    )).all()
    said = (user_text or "").lower()
    kept = 0
    for pid, title in rows:
        named = pid == focus_id or (title and len(title) >= 4 and title.lower()[:40] in said)
        if named:
            continue
        for p in revising:
            if p["id"] == pid:
                for k in text_keys:
                    p.pop(k, None)
                kept += 1
    return kept


def _calendar_lines(current_plan: Dict[str, Any], focus_id: str) -> str:
    """Compact view of the calendar for the model: one short line per post, full text only
    for the post being revised. Never a cut-off JSON dump."""
    posts = [p for p in (current_plan.get("posts") or []) if isinstance(p, dict)]
    lines = []
    for p in posts[:200]:
        lines.append(
            f"{p.get('id')} | {p.get('date')} {p.get('time') or ''} | {p.get('channel')} | "
            f"{p.get('status') or 'draft'} | {str(p.get('headline') or '')[:70]}"
            + (" | edited by hand" if p.get("editedByUser") else "")
        )
    if len(posts) > 200:
        lines.append(f"... and {len(posts) - 200} more posts")
    focus = next((p for p in posts if str(p.get("id")) == focus_id), None)
    if focus:
        lines.append(f"\nFull text of post {focus_id}:\n{str(focus.get('caption') or '')[:3000]}")
    return "\n".join(lines) if lines else "(no posts yet)"


CHAT_TURNS = 30
CHAT_TURN_CHARS = 4000


def _chat_history(messages: Any, prompt: str) -> List[Dict[str, str]]:
    """The conversation for the model: the last CHAT_TURNS turns, each trimmed, roles kept to
    user/assistant, and a user turn sent twice in a row kept once."""
    out: List[Dict[str, str]] = []
    for m in messages if isinstance(messages, list) else []:
        if not isinstance(m, dict):
            continue
        role = "assistant" if m.get("role") == "assistant" else "user"
        content = str(m.get("content") or "").strip()[:CHAT_TURN_CHARS]
        if not content:
            continue
        if out and out[-1]["role"] == role == "user" and (out[-1]["content"] in content or content in out[-1]["content"]):
            if len(content) >= len(out[-1]["content"]):  # the same request, once: the fuller wording wins
                out[-1] = {"role": role, "content": content}
            continue
        out.append({"role": role, "content": content})
    if not out and prompt:
        out = [{"role": "user", "content": str(prompt)[:CHAT_TURN_CHARS]}]
    out = out[-CHAT_TURNS:]
    while out and out[0]["role"] != "user":
        out.pop(0)
    return out


def _recent_openings(current_plan: Dict[str, Any], limit: int = 15) -> str:
    """How recent posts open, so new ones do not repeat them."""
    posts = [p for p in (current_plan.get("posts") or []) if isinstance(p, dict) and str(p.get("caption") or "").strip()]
    posts.sort(key=lambda p: (str(p.get("date") or ""), str(p.get("time") or "")), reverse=True)
    lines = []
    for p in posts[:limit]:
        first = re.sub(r"\s+", " ", str(p.get("caption") or "")).strip()[:160]
        lines.append(f"- {p.get('date')} {p.get('channel')}: {first}")
    return "\n".join(lines)


async def _shared_pages(text: str) -> str:
    """Text of up to two links the user pasted in their latest message."""
    from app.services.safe_fetch import FetchRefused, fetch_text, urls_in

    blocks = []
    for url in urls_in(text, 2):
        try:
            title, body = await fetch_text(url, 6000)
            if body:
                blocks.append(f"Page the user shared: {url}\nTitle: {title}\n{body}")
        except FetchRefused as err:
            blocks.append(f"Link {url} could not be read: {err} Tell the user and ask them to paste the text instead.")
        except Exception as err:
            logger.info(f"[Scheduler Chat] could not read {url}: {err}")
            blocks.append(f"Link {url} could not be read. Tell the user and ask them to paste the text instead.")
    return "\n\n".join(blocks)


@router.post("/chat-plan")
async def chat_plan(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    prompt = payload.get("text") or payload.get("message") or ""
    messages = payload.get("messages") or []
    try:
        prof_res = await db.execute(select(CompanyProfile).limit(1))
        profile = prof_res.scalars().first()
    except Exception as prof_err:
        logger.warning(f"Could not load company profile: {prof_err}")
        profile = None

    company_name = (profile.name if profile and profile.name else "") or (payload.get("companyName") or payload.get("company_name") or "").strip()
    company_pitch = (profile.pitch if profile and profile.pitch else "") or (payload.get("companyPitch") or payload.get("company_pitch") or "").strip()
    company_context = (payload.get("companyContext") or payload.get("company_context") or "").strip()
    if profile:
        bits = [profile.pitch or "", getattr(profile, "industry", None) or "", getattr(profile, "website", None) or ""]
        extra = "\n".join(x for x in bits if x).strip()
        if extra:
            company_context = (extra + ("\n" + company_context if company_context else "")).strip()

    chat_msgs = _chat_history(messages, prompt)

    from app.services.llm_gateway import call_open_chat_llm, output_token_limit

    current_plan = payload.get("currentPlan") or payload.get("current_plan") or {}
    target_date = str(payload.get("targetDate") or payload.get("target_date") or "").strip()
    focus_post_id = str(payload.get("focusPostId") or payload.get("focus_post_id") or "").strip()
    selected_channels = payload.get("selectedChannels") or payload.get("selected_channels") or []
    if not isinstance(selected_channels, list):
        selected_channels = [selected_channels] if selected_channels else []
    selected_channels = [str(c).strip().lower() for c in selected_channels if str(c).strip()]
    pinned_dates = payload.get("pinnedDates") or payload.get("pinned_dates") or []
    if not isinstance(pinned_dates, list):
        pinned_dates = [pinned_dates] if pinned_dates else []
    pinned_dates = [str(d).strip() for d in pinned_dates if str(d).strip()]
    org_tz = await org_timezone(db)
    today = datetime.now(tzinfo(org_tz)).strftime("%Y-%m-%d")

    facts = "\n".join(x for x in (
        ("Company: " + company_name) if company_name else "",
        ("Value: " + company_pitch) if company_pitch else "",
        company_context,
    ) if x)

    system_prompt = f"""You are Plan AI, the editorial partner{" for " + company_name if company_name else ""} inside Outreach by Aivhub Social, its post-planning app.
You are a direct chat window with scheduler skills: plan dates, write captions, revise a focused post, describe images, answer strategy. You are connected to this company's profile, knowledge search, the current calendar, pinned dates, and selected channels.

{facts or "Use only company facts supplied. Never invent a brand, URL, offering, or statistic."}

If the user asks to generate or change a visual, describe a concrete photo (people, place, light). No fake UI text.
If they pin a date, do not ask for a file, meeting, or system. Use their post plan and the company profile.
If they ask a question (strategy, mix, caption feedback, ideas), answer fully and specifically: concrete examples for THIS company, short paragraphs or "- " bullet points, up to about 350 words. Do not invent calendar posts unless they asked to plan, draft, generate, schedule, or change posts.
If they share a link or paste text, use it as the source (summarise, pull angles, or turn it into a series of posts when asked). Never claim facts that are not in the source or the profile.
Know the channels: LinkedIn (insight posts, 120-220 words), X (one sharp line, max 280 characters), Instagram (visual first, caption plus hashtags), Facebook (conversational, local), Threads (short takes). Suggest the right channel for an idea when it helps.
If they want a calendar / plan / captions, write captions that could ship today."""
    try:
        from app.services import brand_voice

        voice_block = brand_voice.prompt_block(await brand_voice.load(db))
    except Exception as voice_err:
        logger.warning(f"[Scheduler Chat] brand voice not loaded: {voice_err}")
        voice_block = ""
    if voice_block:
        system_prompt += "\n\n" + voice_block

    kb_note = ""
    try:
        from app.services.rag_service import search_knowledge
        recent_user = " ".join(m["content"][:500] for m in chat_msgs if m["role"] == "user")[-1500:]
        focus_title = ""
        if focus_post_id and isinstance(current_plan, dict):
            focus = next((p for p in current_plan.get("posts") or [] if isinstance(p, dict) and str(p.get("id")) == focus_post_id), None)
            focus_title = str((focus or {}).get("headline") or "")
        query = " ".join(x for x in (focus_title, recent_user or prompt) if x).strip() or company_pitch
        hits = await search_knowledge(db, query, top_k=6, min_score=0.35)
        if hits:
            bits = []
            for h in hits:
                content = (h.get("content") or "").strip().replace("\n", " ")[:600]
                if _usable_kb_text(content):
                    bits.append(f"- {(h.get('title') or 'Note')}: {content}")
            if bits:
                kb_note = "Company knowledge (do not invent beyond this):\n" + "\n".join(bits)
    except Exception:
        kb_note = ""

    shared_pages = await _shared_pages(_last_user_text(chat_msgs))

    system_prompt += f"""

Today is {today} ({org_tz}). When the user wants posts planned, drafted, scheduled or changed, end your reply with a fenced JSON block tagged plan.
It is an OUTLINE ONLY. Never write captions or hashtags: a writer drafts every caption afterwards, five posts at a time.

For a repeating pattern ("every Monday and Thursday for 4 weeks", "daily this month") give a rule and let the system work out the dates:
```plan
{{"rangeLabel": "October 2026", "channels": ["linkedin"], "rule": {{"weekdays": ["MO", "TH"], "time": "09:00", "start": "{today}", "weeks": 4}}, "themes": [{{"headline": "short title", "angle": "1-2 sentences: what this post says"}}]}}
```
Otherwise list the posts:
```plan
{{"rangeLabel": "October 2026", "channels": ["linkedin"], "posts": [{{"date": "{today}", "time": "09:00", "channel": "linkedin", "headline": "short internal title", "angle": "1-2 sentences: what this post says"}}]}}
```
Rules:
- weekdays use MO TU WE TH FR SA SU; use "count" instead of "weeks" for a fixed number of posts. Give one theme per post when you can (they rotate).
- To change existing posts include ONLY the posts that change, each with its "id" and only the changed fields. To reword a post add "revision": "what to change". To remove posts add "delete": ["id", ...]. Never repeat unchanged posts.
- Posts marked "edited by hand" were written by the user: only reword them when the user asks about that post.
- At most {MAX_POSTS_PER_REQUEST} new posts per request. If asked for more, plan the first {MAX_POSTS_PER_REQUEST} and say so.
- Write about what the user asked, using only company profile facts. 70% educational, 20% thought leadership, 10% product. No fake statistics.
- When you change the calendar, keep the spoken reply to 1-3 short sentences. When the user asked a question, answer it fully (see above). Never paste JSON, SQL errors, trace dumps, or DevTools objects. Ignore knowledge that looks like an error log.
- Do not repeat the openings of recent posts (listed below); find a fresh angle.
{("Pinned calendar day: " + target_date + ". New or edited posts MUST use this date unless they name another.") if target_date else ""}
{("Pinned dates: " + ", ".join(pinned_dates) + ". Prefer these dates.") if pinned_dates else ""}
{("Selected channels: " + ", ".join(selected_channels) + ". Use these platforms unless the user names others.") if selected_channels else ""}
{("Revise post id " + focus_post_id + " in place. Keep its id.") if focus_post_id else ""}
{kb_note}
{("Recent post openings:" + chr(10) + _recent_openings(current_plan)) if isinstance(current_plan, dict) and _recent_openings(current_plan) else ""}
{shared_pages}
Current calendar (id | date time | channel | status | headline):
{_calendar_lines(current_plan if isinstance(current_plan, dict) else {}, focus_post_id)}
"""

    from app.services import platform_ai

    async def attempt(slot: str) -> Dict[str, Any]:
        ai = await _resolve_text_ai(db, None, slot)
        if ai["error"]:
            raise platform_ai.AIUnavailable(ai["error"])
        async with TEXT_SLOTS.slot(PRIORITY_INTERACTIVE):
            res = await call_open_chat_llm(
                messages=chat_msgs,
                system_prompt=system_prompt,
                api_key=ai["api_key"],
                provider=ai["provider"],
                model=ai["model"],
                base_url=ai["base_url"],
                max_tokens=output_token_limit(ai["provider"], 6000),
                db=db,
            )
        if not res.get("success", True) or res.get("error") or not (res.get("reply") or "").strip():
            raise platform_ai.AIUnavailable(res.get("error") or "The writing AI returned an empty reply.")
        return res

    try:
        llm_res = await platform_ai.run_with_backup(db, "text", attempt)
    except Exception as llm_err:
        logger.error(f"[Scheduler Chat] writing AI failed on every configured engine: {llm_err}")
        from app.services import ai_errors

        msg = await ai_errors.failure(str(llm_err), "Plan AI chat")
        return {"status": "error", "reply": msg, "plan": None, "posts": [], "error": "ai_unavailable",
                "code": ai_errors.code_of(msg)}

    reply_raw = llm_res.get("reply", "")
    known_ids = {str(p.get("id")) for p in (current_plan.get("posts") or []) if isinstance(p, dict) and p.get("id")} if isinstance(current_plan, dict) else set()
    structured_plan = _extract_plan_from_text(reply_raw, today, known_ids)
    if llm_res.get("success", True) and not structured_plan and (llm_res.get("truncated") or "```plan" in reply_raw):
        # The outline was cut off or unreadable: say so instead of silently creating nothing.
        return {
            "status": "error",
            "reply": "The plan came back cut off, so nothing was added. Try a shorter range (for example one month) or ask again.",
            "plan": None,
            "posts": [],
            "error": "plan_cut_off",
        }
    kept = await _protect_hand_edits(db, structured_plan, focus_post_id, _last_user_text(chat_msgs))
    reply_text = _spoken_reply(reply_raw, bool(structured_plan and structured_plan.get("posts")))
    if not reply_text:
        reply_text = f"Tell me the topic and the date to post for {company_name}."
    if kept:
        reply_text += (
            (" I left 1 post you edited by hand as it is. Open it and ask there, or name it, to change it too."
             if kept == 1 else
             f" I left {kept} posts you edited by hand as they are. Open one and ask there, or name it, to change it too.")
        )
    return {
        "status": "ok" if llm_res.get("success", True) else "error",
        "reply": reply_text,
        "plan": structured_plan,
        "posts": (structured_plan or {}).get("posts") or [],
        "error": llm_res.get("error"),
    }


# ── Brand voice and saved Plan AI chats ─────────────────────────────────────
@router.get("/brand-voice")
async def get_brand_voice(db: AsyncSession = Depends(get_db)):
    from app.services import brand_voice

    return await brand_voice.load(db)


@router.put("/brand-voice")
async def put_brand_voice(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    from app.services import brand_voice

    return await brand_voice.save(db, payload)


THREAD_MESSAGES = 200
THREAD_MESSAGE_CHARS = 8000


def _thread_json(t) -> Dict[str, Any]:
    return {"id": t.id, "title": t.title, "messages": t.messages or [], "createdBy": t.created_by_name or "",
            "updatedAt": int(t.updated_at.timestamp() * 1000) if t.updated_at else None}


@router.get("/chat-threads")
async def list_chat_threads(db: AsyncSession = Depends(get_db)):
    from app.models.models import PlanChatThread

    rows = (await db.execute(select(PlanChatThread).order_by(PlanChatThread.updated_at.desc()).limit(40))).scalars().all()
    return [_thread_json(t) for t in rows]


@router.put("/chat-threads/{thread_id}")
async def save_chat_thread(thread_id: str, payload: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)):
    from app.core.auth_middleware import current
    from app.models.models import PlanChatThread

    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", thread_id or ""):
        raise HTTPException(status_code=400, detail="Bad conversation id.")
    msgs = []
    for m in (payload.get("messages") or [])[-THREAD_MESSAGES:]:
        if isinstance(m, dict) and isinstance(m.get("text"), str):
            msgs.append({k: (v[:THREAD_MESSAGE_CHARS] if isinstance(v, str) else v) for k, v in m.items()
                         if k in ("id", "who", "kind", "text", "postId") and (isinstance(v, str) or v is None)})
    t = (await db.execute(select(PlanChatThread).where(PlanChatThread.id == thread_id))).scalars().first()
    if not t:
        ctx = current(request)
        t = PlanChatThread(id=thread_id, created_by=str(ctx.get("operator_id") or ""), created_by_name=str(ctx.get("name") or ""))
        db.add(t)
    t.title = str(payload.get("title") or "Chat")[:120]
    t.messages = msgs
    t.updated_at = datetime.utcnow()
    await db.commit()
    return _thread_json(t)


@router.delete("/chat-threads/{thread_id}")
async def delete_chat_thread(thread_id: str, db: AsyncSession = Depends(get_db)):
    from app.models.models import PlanChatThread

    t = (await db.execute(select(PlanChatThread).where(PlanChatThread.id == thread_id))).scalars().first()
    if t:
        await db.delete(t)
        await db.commit()
    return {"ok": True}
