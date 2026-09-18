from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, FileResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db, engine
from app.models.models import SocialPost, SocialEmail, SocialAccount, CompanyProfile
from app.services.post_writer import (
    parse_chat_intent,
    create_topic_image_prompt,
    generate_image_with_provider,
    generate_complete_social_package,
    strip_ai_slop,
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
]


async def _repair_social_posts_schema() -> None:
    async with engine.begin() as conn:
        for col, col_type in _SOCIAL_POST_EXTRA_COLS:
            try:
                await conn.execute(text(f"ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS {col} {col_type}"))
            except Exception:
                try:
                    await conn.execute(text(f"ALTER TABLE social_posts ADD COLUMN {col} {col_type}"))
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
        "createdAt": p.created_at.isoformat() if p.created_at else None,
    }


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
    style = payload.get("style", "modern_saas")
    aspect_ratio = payload.get("aspect_ratio") or payload.get("aspectRatio") or "16:9"

    from app.services.post_writer import resolve_image_credentials
    creds = await resolve_image_credentials(
        db=db,
        provider=payload.get("provider") or payload.get("image_provider") or payload.get("imageEngine") or payload.get("imageProvider"),
        api_key=payload.get("api_key") or payload.get("apiKey") or payload.get("image_api_key") or payload.get("imageApiKey"),
        model=payload.get("model") or payload.get("image_model") or payload.get("imageModel"),
        base_url=payload.get("base_url") or payload.get("baseUrl") or payload.get("image_base_url") or payload.get("imageBaseUrl"),
    )
    provider = creds.get("provider")
    api_key = creds.get("api_key")
    model = creds.get("model")
    base_url = creds.get("base_url")

    w, h = ASPECT_RATIOS.get(aspect_ratio, (1200, 675))
    width = int(payload.get("width", w))
    height = int(payload.get("height", h))

    if not prompt and title:
        prompt = create_topic_image_prompt(title, theme=theme, style=style)
    elif not prompt:
        prompt = f"Modern professional illustration representing {theme}, clean vector style, high quality"

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


@router.post("/generate-package")
async def generate_package_endpoint(payload: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)):
    topic = (
        payload.get("topic")
        or payload.get("custom_angle")
        or payload.get("angle")
        or payload.get("title")
        or payload.get("prompt")
        or ""
    )
    style = payload.get("style") or payload.get("imageStyle") or "modern_saas"
    aspect_ratio = payload.get("aspect_ratio") or payload.get("aspectRatio") or "4:5"

    api_key = payload.get("apiKey") or payload.get("api_key")
    provider = payload.get("provider")
    model = payload.get("model")
    base_url = payload.get("baseUrl") or payload.get("base_url")
    image_api_key = payload.get("image_api_key") or payload.get("imageApiKey") or api_key
    image_provider = payload.get("image_provider") or payload.get("imageProvider") or payload.get("imageEngine")
    image_model = payload.get("image_model") or payload.get("imageModel")
    image_base_url = payload.get("image_base_url") or payload.get("imageBaseUrl")

    company_name = (payload.get("companyName") or payload.get("company_name") or "").strip()
    company_pitch = (payload.get("companyPitch") or payload.get("company_pitch") or "").strip()
    company_context = (payload.get("companyContext") or payload.get("company_context") or "").strip()
    linkedin_directive = (payload.get("linkedinDirective") or payload.get("linkedin_directive") or "").strip()
    existing_copy = (payload.get("existingCopy") or payload.get("existing_copy") or payload.get("caption") or "").strip()
    existing_headline = (payload.get("existingHeadline") or payload.get("existing_headline") or payload.get("headline") or "").strip()
    try:
        prof_res = await db.execute(select(CompanyProfile).limit(1))
        profile = prof_res.scalars().first()
        if profile:
            company_name = profile.name or company_name
            company_pitch = profile.pitch or company_pitch
            bits = [profile.pitch or "", profile.industry or "", profile.website or ""]
            company_context = "\n".join(x for x in bits if x).strip()
    except Exception as e:
        logger.warning(f"Could not load company profile for package: {e}")

    try:
        from app.services.rag_service import search_knowledge
        hits = await search_knowledge(db, topic, top_k=3, min_score=0.38)
        if hits:
            kb_lines = []
            for h in hits:
                title = (h.get("title") or "Note").strip()
                content = (h.get("content") or "").strip().replace("\n", " ")[:420]
                if _usable_kb_text(content):
                    kb_lines.append(f"- {title}: {content}")
            if kb_lines:
                company_context = (company_context + "\n\nKnowledge base:\n" + "\n".join(kb_lines)).strip()
    except Exception as kb_err:
        logger.warning(f"Knowledge lookup for package skipped: {kb_err}")

    package = await generate_complete_social_package(
        topic=topic,
        company_name=company_name,
        company_pitch=company_pitch,
        company_context=company_context,
        linkedin_directive=linkedin_directive,
        existing_copy=existing_copy,
        existing_headline=existing_headline,
        api_key=api_key,
        provider=provider,
        model=model,
        base_url=base_url,
        image_api_key=image_api_key,
        image_provider=image_provider,
        image_model=image_model,
        image_base_url=image_base_url,
        style=style,
        aspect_ratio=aspect_ratio,
        adapt_per_channel=bool(payload.get("adaptPerChannel") or payload.get("adapt_per_channel")),
        skip_image=bool(payload.get("skipImage") or payload.get("skip_image")),
        revision_note=(payload.get("revisionNote") or payload.get("revision_note") or "").strip(),
        db=db,
    )
    if package.get("imageUrl"):
        package["imageUrl"] = _host_image(package.get("imageUrl"), request)
    return {"status": "ok", "package": package}


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

    async def _upsert():
        res = await db.execute(select(SocialPost).where(SocialPost.id == post_id))
        existing_post = res.scalars().first()
        if existing_post:
            existing_post.title = title
            existing_post.copy = copy
            existing_post.channels = channels
            existing_post.status = status
            existing_post.slot_date_ms = float(slot_date_ms)
            existing_post.time = time_str
            existing_post.theme = theme
            if image_url is not None:
                existing_post.image_url = image_url
            if image_prompt is not None:
                existing_post.image_prompt = image_prompt
            _apply_package_fields(existing_post, payload)
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
        "message": f"Post created successfully with status: {new_post.status}",
        "post": _serialize_post(new_post),
    }


@router.post("/posts/{post_id}/status")
async def update_post_status(post_id: str, payload: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(SocialPost).where(SocialPost.id == post_id))
    post = res.scalars().first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    if payload.get("status") is not None:
        post.status = payload.get("status")
    if "copy" in payload and payload["copy"] is not None:
        post.copy = payload["copy"]
    if "imageUrl" in payload:
        post.image_url = _host_image(payload["imageUrl"], request)
    if "imagePrompt" in payload:
        post.image_prompt = payload["imagePrompt"]
    if "slotDateMs" in payload and payload["slotDateMs"] is not None:
        post.slot_date_ms = float(payload["slotDateMs"])
    if "time" in payload:
        post.time = payload["time"]
    if "channels" in payload:
        post.channels = payload["channels"]
    _apply_package_fields(post, payload)

    await db.commit()
    return {"status": "ok", "postId": post_id, "newStatus": post.status, "post": _serialize_post(post)}


@router.delete("/posts/{post_id}")
async def delete_post_endpoint(post_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(SocialPost).where(SocialPost.id == post_id))
    post = res.scalars().first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    await db.delete(post)
    await db.commit()
    return {"status": "ok", "message": f"Post {post_id} deleted."}


@router.get("/emails")
async def list_emails(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SocialEmail).order_by(SocialEmail.created_at.desc()))
    emails = result.scalars().all()
    return [
        {
            "id": e.id,
            "postId": e.post_id,
            "subject": e.subject,
            "from": e.from_addr,
            "to": e.to_addr,
            "date": e.date,
            "sentAt": e.date,
            "status": e.status,
            "preview": (e.post_data or {}).get("preview") or e.subject,
            "body": (e.post_data or {}).get("body") or "",
            "post_data": e.post_data or {},
        }
        for e in emails
    ]


@router.post("/emails")
async def create_email_endpoint(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    email = SocialEmail(
        id=payload.get("id") or f"em_{uuid.uuid4().hex[:8]}",
        post_id=payload.get("postId") or payload.get("post_id") or "",
        subject=payload.get("subject") or "Approve social post",
        from_addr=payload.get("from") or payload.get("from_addr") or "scheduler@aivhub.io",
        to_addr=payload.get("to") or payload.get("to_addr") or "admin@aivhub.io",
        date=payload.get("date") or payload.get("sentAt") or "just now",
        status=payload.get("status") or "unread",
        post_data=payload.get("post_data") or {
            "body": payload.get("body") or "",
            "preview": payload.get("preview") or "",
        },
    )
    db.add(email)
    await db.commit()
    return {"status": "ok", "id": email.id}


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


def _apply_account_payload(acc: SocialAccount, payload: Dict[str, Any]):
    if payload.get("platform"):
        acc.platform = normalize_platform(payload.get("platform"))
    if payload.get("label") is not None:
        acc.label = payload.get("label") or ""
    if payload.get("handle") is not None:
        acc.handle = payload.get("handle") or ""
    if payload.get("accountId") is not None or payload.get("account_id") is not None:
        acc.account_id = payload.get("accountId") or payload.get("account_id") or ""
    if payload.get("accessToken") is not None or payload.get("access_token") is not None:
        token = payload.get("accessToken") or payload.get("access_token") or ""
        if token and not token.startswith("••"):
            acc.access_token = token
    if payload.get("refreshToken") is not None or payload.get("refresh_token") is not None:
        acc.refresh_token = payload.get("refreshToken") or payload.get("refresh_token") or ""
    if payload.get("tokenSecret") is not None or payload.get("token_secret") is not None:
        acc.token_secret = payload.get("tokenSecret") or payload.get("token_secret") or ""
    extra = acc.extra if isinstance(acc.extra, dict) else {}
    incoming = payload.get("extra") if isinstance(payload.get("extra"), dict) else {}
    for k in ("apiKey", "apiSecret", "pageId", "orgId", "authorType", "consumerKey", "consumerSecret", "accessTokenSecret"):
        if payload.get(k) is not None:
            val = payload.get(k)
            if isinstance(val, str) and val.startswith("••"):
                continue
            extra[k] = val
        if incoming.get(k) is not None:
            val = incoming.get(k)
            if isinstance(val, str) and val.startswith("••"):
                continue
            extra[k] = val
    acc.extra = extra
    try:
        from app.services.social_publisher import seal_account_secrets
        seal_account_secrets(acc)
    except Exception:
        pass
    if payload.get("isDefault") is not None:
        acc.is_default = bool(payload.get("isDefault"))


@router.post("/accounts")
async def upsert_account(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    platform = normalize_platform(payload.get("platform") or "linkedin")
    acc_id = payload.get("id") or f"soc_{platform}_{uuid.uuid4().hex[:8]}"
    res = await db.execute(select(SocialAccount).where(SocialAccount.id == acc_id))
    acc = res.scalars().first()
    created = False
    if not acc:
        acc = SocialAccount(id=acc_id, platform=platform, extra={})
        db.add(acc)
        created = True
    _apply_account_payload(acc, payload)

    if acc.is_default:
        others = await db.execute(
            select(SocialAccount).where(SocialAccount.platform == acc.platform, SocialAccount.id != acc.id)
        )
        for other in others.scalars().all():
            other.is_default = False

    test = await test_account(acc)
    acc.last_tested_at = datetime.utcnow().isoformat()
    if test.get("ok"):
        acc.status = "connected"
        acc.last_error = ""
        if test.get("handle"):
            acc.handle = acc.handle or test["handle"]
        if test.get("accountId") and not acc.account_id:
            acc.account_id = test["accountId"]
    else:
        acc.status = "error" if (acc.access_token or "").strip() else "disconnected"
        acc.last_error = test.get("error") or ""

    await db.commit()
    await db.refresh(acc)
    return {
        "status": "ok" if test.get("ok") else "error",
        "created": created,
        "account": account_public_dict(acc),
        "test": test,
    }


@router.post("/accounts/{account_id}/test")
async def test_account_endpoint(account_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(SocialAccount).where(SocialAccount.id == account_id))
    acc = res.scalars().first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    test = await test_account(acc)
    _apply_live_profile(acc, test)
    await db.commit()
    return {"status": "ok" if test.get("ok") else "error", "test": test, "account": account_public_dict(acc)}


@router.delete("/accounts/{account_id}")
async def delete_account(account_id: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(SocialAccount).where(SocialAccount.id == account_id))
    acc = res.scalars().first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    await db.delete(acc)
    await db.commit()
    return {"status": "ok"}


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

    if not post:
        post = SocialPost(
            id=post_id,
            title=payload.get("title") or payload.get("topicHeadline") or "Untitled Social Post",
            copy=payload.get("copy") or payload.get("linkedinCopy") or payload.get("linkedin_copy") or "",
            channels=payload.get("channels") or ["linkedin"],
            status=payload.get("status") or "approved",
            slot_date_ms=float(payload.get("slotDateMs") or payload.get("dateMs") or (time.time() * 1000)),
            time=payload.get("time") or "10:00",
            theme=payload.get("theme") or "Operations",
            image_url=_host_image(payload.get("imageUrl"), request),
            image_prompt=payload.get("imagePrompt"),
        )
        _apply_package_fields(post, payload)
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

    image_url = _host_image((post.image_url or "").strip(), request)
    if image_url and image_url != post.image_url:
        post.image_url = image_url
        await db.commit()
        await db.refresh(post)
    if not (post.image_url or "").strip():
        from app.services.post_writer import create_topic_image_prompt
        prompt = post.image_prompt or create_topic_image_prompt(post.title or "operations dashboard", theme=post.theme or "Operations")
        img = await generate_image_with_provider(
            prompt=prompt,
            style="modern_saas",
            aspect_ratio="4:5",
            model=payload.get("model") or payload.get("image_model") or payload.get("imageModel"),
            provider=payload.get("image_provider") or payload.get("imageProvider") or payload.get("provider"),
            db=db,
        )
        if img.get("imageUrl"):
            post.image_prompt = img.get("imagePrompt") or prompt
            post.image_url = _host_image(img["imageUrl"], request)
            await db.commit()
            await db.refresh(post)

    acc_res = await db.execute(select(SocialAccount))
    accounts = acc_res.scalars().all()
    bundled = await publish_post_to_accounts(post, accounts, _public_base(request))
    post.publish_results = bundled.get("results") or []
    if bundled.get("allOk") or bundled.get("ok"):
        post.status = "published"
        post.published_at = datetime.utcnow().isoformat()
    await db.commit()
    await db.refresh(post)
    return {
        "status": "ok" if bundled.get("ok") else "error",
        "allOk": bundled.get("allOk"),
        "results": bundled.get("results") or [],
        "post": _serialize_post(post),
    }


@router.post("/publish-due")
async def publish_due_endpoint(request: Request, db: AsyncSession = Depends(get_db)):
    """Publish approved posts whose slot time has arrived, if accounts are connected."""
    now_ms = time.time() * 1000

    def _due_ms(post) -> float:
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
        dt = datetime.fromtimestamp(base / 1000.0)
        # Prefer explicit time field over whatever clock was baked into slot_date_ms
        dt = datetime(dt.year, dt.month, dt.day, hh, mm, 0)
        return dt.timestamp() * 1000.0

    result = await db.execute(select(SocialPost).where(SocialPost.status.in_(["approved", "scheduled"])))
    posts = result.scalars().all()
    acc_res = await db.execute(select(SocialAccount))
    accounts = acc_res.scalars().all()
    published = []
    skipped = []
    for post in posts:
        due_at = _due_ms(post)
        due = (not due_at) or (due_at <= now_ms)
        # Only approved posts auto-publish when due (Simple maps "scheduled" → approved on persist).
        if post.status == "approved" and due:
            hosted = _host_image(post.image_url, request)
            if hosted:
                post.image_url = hosted
            bundled = await publish_post_to_accounts(post, accounts, _public_base(request))
            post.publish_results = bundled.get("results") or []
            if bundled.get("ok"):
                post.status = "published"
                post.published_at = datetime.utcnow().isoformat()
                published.append(_serialize_post(post))
            else:
                skipped.append(post.id)
            continue
        skipped.append(post.id)
    await db.commit()
    return {"status": "ok", "published": published, "skipped": skipped}


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


def _extract_plan_from_text(text: str) -> Optional[Dict[str, Any]]:
    raw = str(text or "")
    blob = None
    m = _PLAN_FENCE_RE.search(raw)
    if m:
        blob = m.group(1).strip()
    else:
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start and '"posts"' in raw[start:end + 1]:
            blob = raw[start:end + 1]
    if not blob:
        return None
    try:
        data = json.loads(blob)
    except Exception:
        return None
    posts = data.get("posts") if isinstance(data, dict) else None
    if not isinstance(posts, list) or not posts:
        return None
    cleaned: List[Dict[str, Any]] = []
    for i, p in enumerate(posts):
        if not isinstance(p, dict):
            continue
        date = str(p.get("date") or "").strip()
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
            date = (datetime.utcnow() + timedelta(days=i)).strftime("%Y-%m-%d")
        channel = str(p.get("channel") or "linkedin").strip().lower()
        if channel in ("twitter", "tweet"):
            channel = "x"
        cleaned.append({
            "id": p.get("id") or f"v2_{uuid.uuid4().hex[:10]}",
            "date": date,
            "time": str(p.get("time") or "09:00")[:5],
            "channel": channel,
            "channels": p.get("channels") or [channel],
            "headline": str(p.get("headline") or p.get("title") or "Draft post")[:180],
            "caption": strip_ai_slop(str(p.get("caption") or p.get("captionDraft") or p.get("copy") or "")),
            "imagePrompt": str(p.get("imagePrompt") or p.get("image_prompt") or p.get("headline") or ""),
        })
    if not cleaned:
        return None
    channels = data.get("channels") if isinstance(data.get("channels"), list) else []
    if not channels:
        channels = list({x["channel"] for x in cleaned})
    return {
        "rangeLabel": str(data.get("rangeLabel") or data.get("label") or ""),
        "channels": channels,
        "posts": cleaned,
    }


@router.post("/chat-plan")
async def chat_plan(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    prompt = payload.get("text") or payload.get("message") or ""
    messages = payload.get("messages") or []
    api_key = (payload.get("apiKey") or payload.get("api_key") or "").strip() or None
    provider = (payload.get("provider") or "openai").strip().lower()
    model = payload.get("model") or ("gpt-4o" if provider == "openai" else None)
    base_url = payload.get("baseUrl") or payload.get("base_url")
    image_style = payload.get("imageStyle", "modern_saas")

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

    from app.services.llm_gateway import call_open_chat_llm

    return_plan = bool(payload.get("returnPlan") or payload.get("return_plan"))
    current_plan = payload.get("currentPlan") or payload.get("current_plan") or {}
    chat_only = bool(payload.get("chatOnly", False))
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
    today = datetime.utcnow().strftime("%Y-%m-%d")

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

    if return_plan:
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

Today is {today}. When the user wants a posting calendar, a month/week plan, or to change dates/captions/channels, you MUST end your reply with a fenced JSON block tagged plan.

```plan
{{"rangeLabel": "September 2026", "channels": ["linkedin"], "posts": [{{"date": "2026-09-21", "time": "09:00", "channel": "linkedin", "headline": "short internal title", "caption": "120-220 word LinkedIn post, hook first, question last, 3-6 hashtags at end", "imagePrompt": "premium 4:5 LinkedIn visual, one idea, no fake UI"}}]}}
```

Caption rules (every post in the JSON):
- Write about what the user asked for, using only company profile facts. Never invent a brand, URL, offering, or statistic.
- 70% educational, 20% thought leadership, 10% product. Mention the company once, naturally, only from the profile.
- 120–220 words. Short mobile paragraphs. Strong 1–2 line hook. The user's problem. How THIS company helps. One practical takeaway. End with a comment question. 3–6 hashtags.
- Do not rotate a stock topic bank. If the user gave a thought, that is the post.
- No fake statistics. No generic corporate language. No exaggerated claims.
- Banned: "delve", "game-changer", "revolutionary", slogan closers.
- Return the FULL updated posts array on revisions (not a delta). Keep posts the user did not mention.
- Real ISO dates (YYYY-MM-DD). One post is enough when they describe one scene.
- Spoken reply: 1–3 short sentences. Never paste JSON, SQL errors, sjson, fillBuffer, trace dumps, or DevTools objects. Ignore knowledge that looks like an error log.
{("Pinned calendar day: " + target_date + ". New or edited posts MUST use this date unless they name another.") if target_date else ""}
{("Pinned dates: " + ", ".join(pinned_dates) + ". Prefer these dates.") if pinned_dates else ""}
{("Selected channels: " + ", ".join(selected_channels) + ". Use these platforms unless the user names others.") if selected_channels else ""}
{("Revise post id " + focus_post_id + " in place. Keep its id.") if focus_post_id else ""}
{kb_note}
Current calendar JSON: {json.dumps(current_plan)[:8000]}
"""

    try:
        llm_res = await call_open_chat_llm(
            messages=chat_msgs,
            system_prompt=system_prompt,
            api_key=api_key,
            provider=provider,
            model=model,
            base_url=base_url,
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
    structured_plan = _extract_plan_from_text(reply_raw) if return_plan else None
    reply_text = _spoken_reply(reply_raw, bool(structured_plan and structured_plan.get("posts")))
    if not reply_text:
        reply_text = f"Tell me the topic and the date to post for {company_name}."
    topics_data = []

    if not chat_only and not return_plan:
        parsed = parse_chat_intent(prompt)
        if parsed["intent"] == "plan_schedule" or "schedule" in prompt.lower() or "post" in prompt.lower():
            try:
                days = parsed["days"]
                channels = parsed["channels"]
                seed = (prompt or company_pitch or company_name or "Company update").strip()
                for i in range(min(3, len(days))):
                    channel = channels[i % len(channels)]
                    title = seed[:120]
                    img_prompt = create_topic_image_prompt(title, seed, "General", image_style)
                    t_id = f"top_{uuid.uuid4().hex[:8]}"
                    topics_data.append({
                        "id": t_id,
                        "theme": "General",
                        "title": title,
                        "headline": title,
                        "angle": seed[:280],
                        "hook": title,
                        "source": "AI Strategist",
                        "freshness": "Today",
                        "query": seed[:80],
                        "saved": True,
                        "imagePrompt": img_prompt,
                        "imageUrl": "",
                        "day": days[i] if i < len(days) else f"Day {i+1}",
                        "channel": channel,
                    })
            except Exception as gen_err:
                logger.error(f"[Scheduler Chat] Error generating topics: {gen_err}")

    return {
        "status": "ok" if llm_res.get("success", True) else "error",
        "reply": reply_text,
        "plan": structured_plan,
        "topics": topics_data,
        "posts": (structured_plan or {}).get("posts") or [],
        "postsCreated": [],
        "model": llm_res.get("model", model),
        "provider": llm_res.get("provider", provider),
        "error": llm_res.get("error"),
    }
