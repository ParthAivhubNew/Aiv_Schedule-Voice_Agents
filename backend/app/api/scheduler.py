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
MAX_POSTS_PER_REQUEST = 90


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


async def _load_ai_settings(db: AsyncSession) -> Dict[str, Any]:
    out = dict(DEFAULT_AI_SETTINGS)
    try:
        row = (await db.execute(select(SchedulerSetting).where(SchedulerSetting.id == "default"))).scalars().first()
        if row and isinstance(row.data, dict):
            out.update({k: v for k, v in row.data.items() if k in DEFAULT_AI_SETTINGS and v is not None})
    except Exception as e:
        logger.warning(f"Could not load scheduler AI settings: {e}")
        await db.rollback()
    return out


async def _saved_ai_keys(db: AsyncSession) -> Dict[str, List[Dict[str, Any]]]:
    """Which providers have a saved key (masked) - for the settings UI. Never returns raw keys."""
    from app.services.key_validator import identify_provider
    from app.services.secret_box import config_get_secret, mask_secret

    text_keys: Dict[str, Dict[str, Any]] = {}
    image_keys: Dict[str, Dict[str, Any]] = {}
    res = await db.execute(select(Connection).where(Connection.group_name.in_(["LLM", "IMAGE"])))
    for c in res.scalars().all():
        cfg = c.config if isinstance(c.config, dict) else {}
        k = config_get_secret(cfg, "api_key", "apiKey", "auth_token")
        burl = (cfg.get("base_url") or cfg.get("baseUrl") or "").strip()
        if not k and not is_self_hosted(burl):
            continue
        prov_slug = str(cfg.get("provider") or c.name or "").strip().lower()
        bucket = text_keys if c.group_name == "LLM" else image_keys
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


async def _resolve_text_ai(db: AsyncSession, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Pick the writing model. Supports any custom provider name and custom base_url."""
    from app.services.llm_gateway import resolve_llm_credentials, _same_provider

    api_key = (payload.get("apiKey") or payload.get("api_key") or "").strip() or None
    req_provider = (payload.get("provider") or "").strip() or None
    explicit = bool(api_key or req_provider)
    if explicit:
        provider = req_provider
        model = payload.get("model") or None
        base_url = payload.get("baseUrl") or payload.get("base_url") or None
    else:
        prefs = await _load_ai_settings(db)
        provider = _auto_none(prefs.get("textProvider"))
        model = (prefs.get("textModel") or "").strip() or None
        base_url = None

    creds = await resolve_llm_credentials(db=db, api_key=api_key, provider=provider, model=model, base_url=base_url)
    error = None
    if not explicit:
        is_local = is_self_hosted(creds.get("base_url"))
        label = provider or "AI"
        if provider and not _same_provider(provider, creds.get("provider")) and not creds.get("api_key") and not is_local:
            error = f"No {label} key saved. Add it under Accounts & AI → Writing AI, or set the provider to Auto."
        elif not creds.get("api_key") and not is_local:
            error = "No AI writing key saved yet. Add one under Accounts & AI → Writing AI."
    return {
        "api_key": creds.get("api_key") or None,
        "provider": creds.get("provider") or provider or "openai",
        "model": creds.get("model") or model,
        "base_url": creds.get("base_url") or base_url,
        "error": error,
        "explicit": explicit,
    }


async def _resolve_image_prefs(db: AsyncSession, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Image engine choice: request fields win, else the saved scheduler choice."""
    prefs = await _load_ai_settings(db)
    provider = (
        payload.get("image_provider") or payload.get("imageProvider") or payload.get("imageEngine")
        or _auto_none(prefs.get("imageProvider"))
    )
    return {
        "provider": provider or None,
        "api_key": payload.get("image_api_key") or payload.get("imageApiKey") or None,
        "model": payload.get("image_model") or payload.get("imageModel") or (prefs.get("imageModel") or None),
        "base_url": payload.get("image_base_url") or payload.get("imageBaseUrl") or None,
        "style": payload.get("style") or payload.get("imageStyle") or prefs.get("imageStyle") or "modern_saas",
        "aspect_ratio": payload.get("aspect_ratio") or payload.get("aspectRatio") or prefs.get("imageAspectRatio") or "4:5",
    }


@router.get("/ai-settings")
async def get_ai_settings(db: AsyncSession = Depends(get_db)):
    keys = await _saved_ai_keys(db)
    # Dynamically build providers from saved connections without hardcoding closed lists
    text_provs = {"auto": "Auto — use any saved key"}
    for k in keys.get("text", []):
        text_provs[k["provider"]] = k["name"]

    img_provs = {
        "auto": "Auto — saved image key, else free",
        "pollinations": "Pollinations (free)",
    }
    for k in keys.get("image", []):
        img_provs[k["provider"]] = k["name"]

    return {
        "settings": await _load_ai_settings(db),
        "keys": keys,
        "textProviders": text_provs,
        "imageProviders": img_provs,
    }


@router.post("/ai-settings")
async def save_ai_settings(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    current = await _load_ai_settings(db)
    for k in DEFAULT_AI_SETTINGS:
        if k in payload and payload[k] is not None:
            current[k] = str(payload[k]).strip()
    if current["imageAspectRatio"] not in ASPECT_RATIOS:
        current["imageAspectRatio"] = "4:5"
    row = (await db.execute(select(SchedulerSetting).where(SchedulerSetting.id == "default"))).scalars().first()
    if row:
        row.data = current
    else:
        db.add(SchedulerSetting(id="default", data=current))
    await db.commit()
    return {"status": "ok", "settings": current}


@router.post("/ai-settings/test")
async def test_ai_settings(db: AsyncSession = Depends(get_db)):
    """Tiny live call with the saved choice, so the user sees exactly which engine is used."""
    from app.services.llm_gateway import call_open_chat_llm
    from app.services.post_writer import resolve_image_credentials

    text_ai = await _resolve_text_ai(db, {})
    text: Dict[str, Any] = {"ok": False, "provider": text_ai.get("provider"), "model": text_ai.get("model")}
    if text_ai["error"]:
        text["error"] = text_ai["error"]
    else:
        res = await call_open_chat_llm(
            messages=[{"role": "user", "content": "Reply with the single word OK."}],
            system_prompt="You are a connectivity check.",
            api_key=text_ai["api_key"],
            provider=text_ai["provider"],
            model=text_ai["model"],
            base_url=text_ai["base_url"],
            max_tokens=5,
            db=db,
        )
        text.update({
            "ok": bool(res.get("success", True)) and not res.get("error"),
            "provider": res.get("provider") or text_ai["provider"],
            "model": res.get("model") or text_ai["model"],
            "error": res.get("error"),
        })

    img_prefs = await _resolve_image_prefs(db, {})
    img_creds = await resolve_image_credentials(db=db, provider=img_prefs["provider"], model=img_prefs["model"])
    image = {
        "provider": img_creds.get("provider"),
        "model": img_creds.get("model") or "",
        "missingKeyFor": img_creds.get("missing_key_for"),
    }
    return {"text": text, "image": image}


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

    # This endpoint historically took provider/api_key/model/base_url unprefixed.
    img_prefs = await _resolve_image_prefs(db, {
        **payload,
        "image_provider": payload.get("provider") or payload.get("image_provider") or payload.get("imageEngine") or payload.get("imageProvider"),
        "image_api_key": payload.get("api_key") or payload.get("apiKey") or payload.get("image_api_key") or payload.get("imageApiKey"),
        "image_model": payload.get("model") or payload.get("image_model") or payload.get("imageModel"),
        "image_base_url": payload.get("base_url") or payload.get("baseUrl") or payload.get("image_base_url") or payload.get("imageBaseUrl"),
    })
    provider = img_prefs["provider"]
    api_key = img_prefs["api_key"]
    model = img_prefs["model"]
    base_url = img_prefs["base_url"]
    style = img_prefs["style"]
    aspect_ratio = img_prefs["aspect_ratio"]

    w, h = ASPECT_RATIOS.get(aspect_ratio, (1200, 675))
    width = int(payload.get("width", w))
    height = int(payload.get("height", h))

    if not prompt and title:
        prompt = create_topic_image_prompt(title, theme=theme, style=style)
    elif not prompt:
        prompt = f"Modern professional illustration representing {theme}, clean vector style, high quality"

    async with IMAGE_SLOTS.slot(PRIORITY_INTERACTIVE):
        img = await generate_image_with_provider(
            prompt=prompt,
            provider=provider,
            api_key=api_key,
            model=model,
            base_url=base_url,
            style=style,
            aspect_ratio=aspect_ratio,
            width=width,
            height=height,
            db=db,
        )
    hosted = _host_image(img.get("imageUrl"), request)
    return {
        "status": img.get("status") or "ok",
        "imageUrl": hosted,
        "imagePrompt": img.get("imagePrompt") or prompt,
        "prompt": img.get("imagePrompt") or prompt,
        "provider": img.get("provider") or provider,
        "model": img.get("model"),
        "width": img.get("width") or width,
        "height": img.get("height") or height,
        "warning": img.get("warning"),
        "fallback": img.get("fallback", False),
    }


@router.post("/generate")
async def queue_generation(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
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
    if total > MAX_POSTS_PER_REQUEST:
        raise HTTPException(status_code=400, detail=f"At most {MAX_POSTS_PER_REQUEST} posts per request ({total} asked). Split the plan.")
    existing = {row[0] for row in (await db.execute(
        select(SocialPost.id).where(SocialPost.id.in_([pid for g in groups for pid in g["post_ids"]]))
    )).all()}
    missing = [pid for g in groups for pid in g["post_ids"] if pid not in existing]
    if missing:
        raise HTTPException(status_code=409, detail=f"Save these posts before writing them: {missing[:5]}")
    priority = PRIORITY_INTERACTIVE if payload.get("interactive") else 0
    options = {"linkedinDirective": payload.get("linkedinDirective") or ""}
    job_ids = await gen_queue.enqueue(db, groups, priority=priority, options=options)
    await db.commit()
    return {"status": "ok", "jobs": job_ids, "posts": total}


@router.post("/generate/retry")
async def retry_generation(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    """Put failed writing/image jobs for these posts back in the queue."""
    ids = {str(x) for x in (payload.get("postIds") or [])}
    jobs = (await db.execute(select(SocialGenJob).where(SocialGenJob.state == "failed"))).scalars().all()
    retried = 0
    for job in jobs:
        if ids & set(job.post_ids or []):
            image_only = (job.error or "").startswith("Image:")
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


async def _cleaned_schedule(db: AsyncSession, payload: Dict[str, Any], existing: Optional[SocialSchedule] = None) -> Dict[str, Any]:
    tz = await org_timezone(db)
    try:
        return schedule_engine.clean(payload, schedule_engine.org_today(tz), existing)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))


@router.get("/schedules")
async def list_schedules(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SocialSchedule).order_by(SocialSchedule.created_at.desc()))).scalars().all()
    return {"status": "ok", "schedules": await _schedule_view(db, rows)}


@router.post("/schedules/preview")
async def preview_schedule(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    """Which dates a schedule would post on, before saving it."""
    values = await _cleaned_schedule(db, payload)
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
        prefs = await _load_ai_settings(db)
        prompt = post.image_prompt or create_topic_image_prompt(post.title or "operations dashboard", theme=post.theme or "Operations")
        try:
            img = await generate_image_with_provider(
                prompt=prompt,
                style=prefs.get("imageStyle") or "modern_saas",
                aspect_ratio=prefs.get("imageAspectRatio") or "4:5",
                model=prefs.get("imageModel") or None,
                provider=_auto_none(prefs.get("imageProvider")),
                db=db,
            )
        except Exception:
            logger.exception("Image generation before publish failed for %s", post.id)
            img = {}
        if img.get("imageUrl"):
            post.image_prompt = img.get("imagePrompt") or prompt
            post.image_url = _host_image(img["imageUrl"], request)
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
    if len(spoken) > 900:
        spoken = spoken[:880].rstrip() + "…"
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


@router.post("/chat-plan")
async def chat_plan(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    prompt = payload.get("text") or payload.get("message") or ""
    messages = payload.get("messages") or []
    text_ai = await _resolve_text_ai(db, payload)
    api_key = text_ai["api_key"]
    provider = text_ai["provider"]
    model = text_ai["model"]
    base_url = text_ai["base_url"]
    if text_ai["error"]:
        return {
            "status": "error",
            "reply": text_ai["error"],
            "plan": None,
            "posts": [],
            "model": model,
            "provider": provider,
            "error": text_ai["error"],
            "needsKey": True,
        }

    logger.info(
        f"[Scheduler Chat] Incoming /chat-plan request: provider={provider}, model={model}, "
        f"has_api_key={bool(api_key)}, key_len={len(api_key) if api_key else 0}, "
        f"msgs_count={len(messages)}, prompt_snippet={prompt[:40]!r}"
    )

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

    chat_msgs = []
    if messages:
        chat_msgs = messages
    elif prompt:
        chat_msgs = [{"role": "user", "content": prompt}]

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

    system_prompt = f"""You are Plan AI, the editorial partner{" for " + company_name if company_name else ""} inside AIVHub Post Scheduler.
You are a direct chat window with scheduler skills: plan dates, write captions, revise a focused post, describe images, answer strategy. You are connected to this company's profile, knowledge search, the current calendar, pinned dates, and selected channels.

{facts or "Use only company facts supplied. Never invent a brand, URL, offering, or statistic."}

If the user asks to generate or change a visual, describe a concrete photo (people, place, light). No fake UI text.
If they pin a date, do not ask for a file, meeting, or system. Use their post plan and the company profile.
If they ask a question (strategy, mix, caption feedback), answer plainly in chat. Do not invent calendar posts unless they asked to plan, draft, generate, schedule, or change posts.
If they want a calendar / plan / captions, write captions that could ship today."""

    kb_note = ""
    try:
        from app.services.rag_service import search_knowledge
        hits = await search_knowledge(db, prompt or company_pitch, top_k=3, min_score=0.38)
        if hits:
            bits = []
            for h in hits:
                content = (h.get("content") or "").strip().replace("\n", " ")[:280]
                if _usable_kb_text(content):
                    bits.append(f"- {(h.get('title') or 'Note')}: {content}")
            if bits:
                kb_note = "Company knowledge (do not invent beyond this):\n" + "\n".join(bits)
    except Exception:
        kb_note = ""

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
- Spoken reply: 1–3 short sentences. Never paste JSON, SQL errors, trace dumps, or DevTools objects. Ignore knowledge that looks like an error log.
{("Pinned calendar day: " + target_date + ". New or edited posts MUST use this date unless they name another.") if target_date else ""}
{("Pinned dates: " + ", ".join(pinned_dates) + ". Prefer these dates.") if pinned_dates else ""}
{("Selected channels: " + ", ".join(selected_channels) + ". Use these platforms unless the user names others.") if selected_channels else ""}
{("Revise post id " + focus_post_id + " in place. Keep its id.") if focus_post_id else ""}
{kb_note}
Current calendar (id | date time | channel | status | headline):
{_calendar_lines(current_plan if isinstance(current_plan, dict) else {}, focus_post_id)}
"""

    try:
        async with TEXT_SLOTS.slot(PRIORITY_INTERACTIVE):
            llm_res = await call_open_chat_llm(
                messages=chat_msgs,
                system_prompt=system_prompt,
                api_key=api_key,
                provider=provider,
                model=model,
                base_url=base_url,
                max_tokens=output_token_limit(provider, 6000),
                db=db,
            )
    except Exception as llm_err:
        logger.error(f"[Scheduler Chat] Exception in call_open_chat_llm: {llm_err}")
        llm_res = {
            "success": False,
            "error": str(llm_err),
            "reply": f"⚠️ LLM Call Error: {llm_err}",
        }

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
            "model": llm_res.get("model", model),
            "provider": llm_res.get("provider", provider),
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
        "model": llm_res.get("model", model),
        "provider": llm_res.get("provider", provider),
        "error": llm_res.get("error"),
    }
