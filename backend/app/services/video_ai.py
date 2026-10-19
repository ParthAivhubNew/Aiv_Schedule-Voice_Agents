"""AI video clips for posts: a short clip from a text description, made by the video AI Outreach staff set up.

Staff pick the video AI in the owner portal (Platform AI, Video): a saved key from Fal, OpenAI or Google Gemini,
and the model to use, with an optional backup tried when the main fails. Clips take one to five minutes, so each request is a job that runs in the background; the browser
only polls it. Credits are held when it starts and charged only when a clip comes back. The clip is kept in
the media library and, when the job was made for a post that can still change, added to that post.
Customers never see which company made the clip (see the client UI branding rule).
"""
from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Tuple

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import SocialPost, SocialVideoJob

logger = logging.getLogger("video_ai")

SHAPES = {"9:16": (720, 1280), "16:9": (1280, 720), "1:1": (1024, 1024)}
LENGTHS = (5, 8)
MAX_WAIT_S = 15 * 60
POLL_S = 8
CREDIT_ITEM = "ai_video"
_running: Dict[str, asyncio.Task] = {}


class VideoFailed(Exception):
    """The clip could not be made; the message is for the user."""


def view(j: SocialVideoJob) -> Dict[str, Any]:
    return {"id": j.id, "postId": j.post_id or "", "prompt": j.prompt or "", "shape": j.shape, "seconds": j.seconds,
            "state": j.state, "error": j.error or "", "mediaId": j.media_id or "", "url": j.url or "",
            "createdAt": j.created_at.isoformat() + "Z" if j.created_at else None,
            "updatedAt": j.updated_at.isoformat() + "Z" if j.updated_at else None}


def _kind_of(name: str) -> str:
    """Which video API a saved key belongs to, from its provider name, connection name or address."""
    n = name.lower()
    if "fal" in n:
        return "fal"
    if any(m in n for m in ("gemini", "google", "veo", "generativelanguage")):
        return "gemini"
    if "openai" in n or "api.openai.com" in n:
        return "openai"
    return ""


async def find_key(db: AsyncSession, slot: str = "main") -> Optional[Dict[str, str]]:
    """{provider, key, model} for the video AI the owner portal chose for this slot, or None when it is not
    set up (no key picked, the key is gone, its company has no video API here, or no model is filled in)."""
    from app.core.platform import platform_org_id
    from app.models.models import Connection
    from app.services import platform_ai
    from app.services.secret_box import config_get_secret

    name, model = await platform_ai.choice(db, "video", slot)
    if not name:
        return None
    rows = (await db.execute(select(Connection).where(Connection.org_id == platform_org_id()))).scalars().all()
    row = next((c for c in rows if (c.name or "").strip().lower() == name.strip().lower()), None)
    if not row:
        return None
    cfg = row.config if isinstance(row.config, dict) else {}
    key = config_get_secret(cfg, "api_key", "apiKey")
    kind = _kind_of(f"{cfg.get('provider') or ''} {row.name or ''} {cfg.get('base_url') or cfg.get('baseUrl') or ''}")
    model = (model or "").strip()
    if not key or not kind or not model:
        return None
    return {"provider": kind, "key": key, "model": model}


# ── Providers: each returns the finished clip's bytes ──────────────────────
async def _fal(client: httpx.AsyncClient, key: str, model: str, prompt: str, shape: str, seconds: int) -> bytes:
    headers = {"Authorization": f"Key {key}"}
    res = await client.post(f"https://queue.fal.run/{model}", headers=headers,
                            json={"prompt": prompt, "aspect_ratio": shape, "duration": str(seconds)})
    if res.status_code not in (200, 201, 202):
        raise VideoFailed(_refusal(res))
    body = res.json() or {}
    status_url, response_url = body.get("status_url"), body.get("response_url")
    if not status_url or not response_url:
        raise VideoFailed("The video AI did not accept the request.")
    async for _ in _ticks():
        st = await client.get(status_url, headers=headers)
        state = str((st.json() or {}).get("status") or "").upper() if st.status_code == 200 else ""
        if state == "COMPLETED":
            break
        if state in ("FAILED", "ERROR", "CANCELLED"):
            raise VideoFailed("The video AI could not make this clip. Try a different description.")
    out = await client.get(response_url, headers=headers)
    url = (((out.json() or {}).get("video")) or {}).get("url") if out.status_code == 200 else ""
    if not url:
        raise VideoFailed(_refusal(out))
    return await _download(client, url)


async def _openai(client: httpx.AsyncClient, key: str, model: str, prompt: str, shape: str, seconds: int) -> bytes:
    headers = {"Authorization": f"Bearer {key}"}
    w, h = SHAPES[shape] if shape != "1:1" else SHAPES["9:16"]  # Sora has no square size
    res = await client.post("https://api.openai.com/v1/videos", headers=headers,
                            data={"model": model, "prompt": prompt, "seconds": str(8 if seconds > 5 else 4), "size": f"{w}x{h}"})
    if res.status_code not in (200, 201, 202):
        raise VideoFailed(_refusal(res))
    vid = (res.json() or {}).get("id")
    if not vid:
        raise VideoFailed("The video AI did not accept the request.")
    async for _ in _ticks():
        st = await client.get(f"https://api.openai.com/v1/videos/{vid}", headers=headers)
        body = st.json() if st.status_code == 200 else {}
        state = str(body.get("status") or "").lower()
        if state == "completed":
            break
        if state in ("failed", "cancelled"):
            raise VideoFailed(str((body.get("error") or {}).get("message") or "The video AI could not make this clip. Try a different description."))
    out = await client.get(f"https://api.openai.com/v1/videos/{vid}/content", headers=headers)
    if out.status_code != 200 or len(out.content) < 1000:
        raise VideoFailed(_refusal(out))
    return out.content


async def _gemini(client: httpx.AsyncClient, key: str, model: str, prompt: str, shape: str, seconds: int) -> bytes:
    base = "https://generativelanguage.googleapis.com/v1beta"
    headers = {"x-goog-api-key": key}
    res = await client.post(f"{base}/models/{model}:predictLongRunning", headers=headers,
                            json={"instances": [{"prompt": prompt}], "parameters": {"aspectRatio": "16:9" if shape == "16:9" else "9:16"}})
    if res.status_code not in (200, 201):
        raise VideoFailed(_refusal(res))
    name = (res.json() or {}).get("name")
    if not name:
        raise VideoFailed("The video AI did not accept the request.")
    body: Dict[str, Any] = {}
    async for _ in _ticks():
        st = await client.get(f"{base}/{name}", headers=headers)
        body = st.json() if st.status_code == 200 else {}
        if body.get("done"):
            break
    if body.get("error"):
        raise VideoFailed(str(body["error"].get("message") or "The video AI could not make this clip."))
    samples = (((body.get("response") or {}).get("generateVideoResponse") or {}).get("generatedSamples")) or []
    uri = ((samples[0] if samples else {}).get("video") or {}).get("uri")
    if not uri:
        raise VideoFailed("The video AI returned no clip. The description may have been refused; try another.")
    return await _download(client, uri, headers)


async def _ticks():
    waited = 0
    while waited < MAX_WAIT_S:
        await asyncio.sleep(POLL_S)
        waited += POLL_S
        yield waited
    raise VideoFailed(f"No clip within {MAX_WAIT_S // 60} minutes. Nothing was charged; try again later.")


async def _download(client: httpx.AsyncClient, url: str, headers: Optional[Dict[str, str]] = None) -> bytes:
    res = await client.get(url, headers=headers or {}, follow_redirects=True)
    if res.status_code != 200 or len(res.content) < 1000:
        raise VideoFailed("The clip was made but could not be downloaded. Try again.")
    return res.content


def _refusal(res: httpx.Response) -> str:
    if res.status_code in (401, 403):
        return "The video AI is not available right now. Please contact Outreach support."
    if res.status_code == 429:
        return "The video AI is busy. Try again in a few minutes."
    if res.status_code == 400:
        return "The video AI refused this description. Try wording it differently."
    return f"The video AI did not answer ({res.status_code}). Try again later."


PROVIDERS = {"fal": _fal, "openai": _openai, "gemini": _gemini}


# ── Jobs ────────────────────────────────────────────────────────────────────
_SHAPE_WORDS = (
    ("16:9", r"16\s*:\s*9|\bwide\b|landscape|youtube|linkedin"),
    ("1:1", r"1\s*:\s*1|\bsquare\b"),
    ("9:16", r"9\s*:\s*16|\btall\b|vertical|portrait|\bstor(?:y|ies)\b|\breels?\b|\bshorts?\b|tiktok"),
)


def infer_clip(prompt: str) -> Dict[str, Any]:
    """The shape and length a person asked for in their own words. Only what they said is returned."""
    out: Dict[str, Any] = {}
    for key, pat in _SHAPE_WORDS:
        if re.search(pat, prompt, re.I):
            out["shape"] = key
            break
    m = re.search(r"\b(\d{1,2})\s*(?:s\b|sec(?:ond)?s?\b)", prompt, re.I)
    if m:
        out["seconds"] = 8 if int(m.group(1)) > 5 else 5
    elif re.search(r"\blonger\b|\bextended\b", prompt, re.I):
        out["seconds"] = 8
    return out


def clean(payload: Dict[str, Any]) -> Tuple[str, str, int]:
    prompt = " ".join(str(payload.get("prompt") or "").split())[:1500]
    if len(prompt) < 10:
        raise ValueError("Describe the clip in a sentence or two, for example: a barista pouring latte art, slow motion, warm light.")
    said = infer_clip(prompt)
    shape = str(payload.get("shape") or said.get("shape") or "9:16")
    if shape not in SHAPES:
        raise ValueError("Pick tall, wide or square.")
    seconds = int(payload.get("seconds") or said.get("seconds") or 5)
    if seconds not in LENGTHS:
        raise ValueError("Pick 5 or 8 seconds.")
    return prompt, shape, seconds


async def start(db: AsyncSession, org_id: str, payload: Dict[str, Any], by: str = "") -> SocialVideoJob:
    """Check, hold the credits and queue one clip. Raises ValueError (400) or PermissionError (402)."""
    from app.services import credits

    prompt, shape, seconds = clean(payload)
    post_id = str(payload.get("postId") or "") or None
    if post_id and not await db.get(SocialPost, post_id):
        raise ValueError("Save the post first.")
    if not await find_key(db):
        raise LookupError("Video making is not set up yet. Please contact Outreach support.")
    job = SocialVideoJob(id=f"vid_{uuid.uuid4().hex[:12]}", post_id=post_id, prompt=prompt, shape=shape, seconds=seconds,
                         state="queued", created_by=by)
    ok, why = await credits.hold(db, [{"ref": job.id, "item": CREDIT_ITEM, "quantity": 1, "note": "AI video clip"}])
    if not ok:
        raise PermissionError(why)
    db.add(job)
    await db.commit()
    _running[job.id] = asyncio.create_task(_run(org_id, job.id))
    return job


async def _run(org_id: str, job_id: str) -> None:
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.services import credits, media_store as MS, social_library

    with org_scope(org_id):
        try:
            async with AsyncSessionLocal() as db:
                job = await db.get(SocialVideoJob, job_id)
                job.state = "making"
                await db.commit()
                prompt, shape, seconds = job.prompt, job.shape, job.seconds
            from app.services import platform_ai

            used: Dict[str, str] = {}

            async def attempt(slot: str) -> bytes:
                async with AsyncSessionLocal() as db:
                    ai = await find_key(db, slot)
                if not ai:
                    raise VideoFailed("Video making is not set up yet. Please contact Outreach support.")
                used.update(ai)
                async with httpx.AsyncClient(timeout=120.0) as client:
                    return await PROVIDERS[ai["provider"]](client, ai["key"], ai["model"], prompt, shape, seconds)

            async with AsyncSessionLocal() as db:
                raw = await platform_ai.run_with_backup(db, "video", attempt)
            ai = used
            if len(raw) > MS.MAX_VIDEO_BYTES:
                raise VideoFailed("The clip came back too large to keep.")
            fid = uuid.uuid4().hex[:16]
            (MS.MEDIA_DIR / f"{fid}.mp4").write_bytes(raw)
            url = f"{MS.MEDIA_URL_PREFIX}/{fid}.mp4"
            async with AsyncSessionLocal() as db:
                job = await db.get(SocialVideoJob, job_id)
                row = await social_library.add_file(db, url, size=len(raw), name=(prompt[:60] + ".mp4"), source="ai", by=job.created_by or "")
                job.state, job.media_id, job.url = "done", row.id, url
                if job.post_id:
                    await _attach(db, job.post_id, social_library.item(row))
                from app.services import feed

                feed.add(db, "Your AI video is ready" + (" and was added to its post." if job.post_id else ". Find it in the Media library."), "success")
                await db.commit()
                try:
                    from app.services.ai_pricing import record_usage

                    await record_usage(db, plugin="scheduler", kind="video", provider=ai["provider"], model=ai["model"], units=1.0)
                except Exception as err:
                    logger.debug(f"[video] usage not recorded: {err}")
                await credits.confirm_safely(db, job_id, CREDIT_ITEM, 1, "AI video clip")
        except Exception as err:
            msg = str(err) if isinstance(err, VideoFailed) else "The video AI could not be reached. Nothing was charged; try again later."
            if not isinstance(err, VideoFailed):
                logger.exception("Video job %s failed", job_id)
            async with AsyncSessionLocal() as db:
                job = await db.get(SocialVideoJob, job_id)
                if job:
                    job.state, job.error = "failed", msg
                    from app.services import feed

                    feed.add(db, f"An AI video could not be made. {msg}", "alert")
                await credits.release(db, [job_id])  # a failed clip is free
                await db.commit()
        finally:
            _running.pop(job_id, None)


async def _attach(db: AsyncSession, post_id: str, item: Dict[str, Any]) -> None:
    """Add the clip to its post, unless the post went live or the AI is rewriting it meanwhile."""
    from app.services import post_versions

    post = await db.get(SocialPost, post_id)
    if not post or post.status in ("published", "publishing") or post.gen_state in ("queued", "writing"):
        return
    before = post_versions.content_of(post)
    post.media = list(post.media or []) + [item]
    post.edited_by_user = True
    await post_versions.record_version(db, post, "ai", before=before)
    if post.status in ("approved", "scheduled", "rejected"):
        # New content: it goes back for approval, like any other change after approval.
        from app.api.scheduler import _after_status_change

        _after_status_change(post, post.status, content_changed=True)


async def fail_interrupted() -> None:
    """At startup: a clip still marked as being made was cut off by a restart. Its credit hold lapses."""
    from sqlalchemy import update

    from app.database import engine

    try:
        async with engine.begin() as conn:
            await conn.execute(update(SocialVideoJob).where(SocialVideoJob.state.in_(["queued", "making"]))
                               .values(state="failed", error="The server restarted while the clip was being made. Nothing was charged; try again.",
                                       updated_at=datetime.utcnow()))
    except Exception as err:
        logger.warning(f"Could not release interrupted video jobs: {err}")


def stale(job: SocialVideoJob) -> bool:
    return job.state in ("queued", "making") and job.id not in _running and \
        (datetime.utcnow() - (job.created_at or datetime.utcnow())) > timedelta(minutes=2)
