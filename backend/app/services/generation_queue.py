"""Post Scheduler AI work queue.

Rules (organisation-wide, one process):
- At most 2 writing-AI calls at once and at most 2 image calls at once. Interactive work
  (chat replies, one-post rewrites) takes the next free slot before queued background work.
- One writing call drafts at most 5 posts. A big plan is outlined first, its posts are stored
  as "queued", and this worker fills them in 5 at a time, so nothing depends on one huge reply.
- Jobs live in the database: they survive restarts and run with no browser open.
- Credits: a post's price (writing, plus its image) is held when its writing starts, charged
  part by part as each succeeds, and given back for a part that fails or times out. When a
  company cannot afford the next post, it and the rest of the company's queue pause (nothing
  overspends); after a top-up the company continues where it stopped or starts afresh.
"""
from __future__ import annotations

import asyncio
import heapq
import itertools
import logging
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from sqlalchemy import update
from sqlalchemy.future import select

from app.database import AsyncSessionLocal
from app.models.models import CompanyProfile, SocialGenJob, SocialPost
from app.services.post_versions import content_of, record_version

logger = logging.getLogger("generation_queue")

MAX_POSTS_PER_CALL = 5
MAX_ATTEMPTS = 2
PRIORITY_INTERACTIVE = 10
TEXT_TIMEOUT_SECS = 300  # one writing call (up to MAX_POSTS_PER_CALL posts)
IMAGE_TIMEOUT_SECS = 120  # one image
LOCKED_POST_STATUSES = ("published", "publishing")


class PriorityLimiter:
    """Semaphore whose waiters are served highest priority first, then first come."""

    def __init__(self, slots: int):
        self.slots = slots
        self.active = 0
        self._waiters: List[Any] = []
        self._seq = itertools.count()

    async def acquire(self, priority: int = 0) -> None:
        if self.active < self.slots and not self._waiters:
            self.active += 1
            return
        fut = asyncio.get_running_loop().create_future()
        heapq.heappush(self._waiters, (-priority, next(self._seq), fut))
        try:
            await fut
        except asyncio.CancelledError:
            if fut.done() and not fut.cancelled():
                self.release()
            raise

    def release(self) -> None:
        while self._waiters:
            _, _, fut = heapq.heappop(self._waiters)
            if not fut.done():
                fut.set_result(None)
                return
        self.active -= 1

    @asynccontextmanager
    async def slot(self, priority: int = 0):
        await self.acquire(priority)
        try:
            yield
        finally:
            self.release()


TEXT_SLOTS = PriorityLimiter(2)
IMAGE_SLOTS = PriorityLimiter(2)

_wake = asyncio.Event()
_text_tasks: set = set()
_image_tasks: set = set()


def wake() -> None:
    _wake.set()


async def cancel_for_posts(db, post_ids: List[str]) -> None:
    """Drop not-yet-started work for posts that are being removed. The caller commits."""
    ids = set(post_ids)
    if not ids:
        return
    pending = (await db.execute(
        select(SocialGenJob).where(SocialGenJob.state.in_(["queued", "image_queued"]))
    )).scalars().all()
    for job in pending:
        if ids & set(job.post_ids or []):
            job.state = "done"
            job.error = "cancelled"
            await release_job(db, job.id)


def charge_refs(job_id: str) -> Dict[str, str]:
    return {"ai_post": f"gen:{job_id}", "ai_image": f"genimg:{job_id}"}


async def release_job(db, job_id: str) -> None:
    from app.services import credits

    await credits.release(db, list(charge_refs(job_id).values()))


async def enqueue(db, groups: List[Dict[str, Any]], *, priority: int = 0, options: Optional[Dict[str, Any]] = None) -> List[str]:
    """Queue content to write. Each group is one piece of content shared by its post_ids:
    {post_ids, plan, headline, channel, date, revision_note, existing_copy, skip_image}.
    The caller commits."""
    job_ids: List[str] = []
    for g in groups:
        post_ids = [str(p) for p in (g.get("post_ids") or []) if p]
        if not post_ids:
            continue
        # A newer request for the same posts replaces any not-yet-started one.
        pending = (await db.execute(
            select(SocialGenJob).where(SocialGenJob.state.in_(["queued", "image_queued", "paused", "image_paused"]))
        )).scalars().all()
        for old in pending:
            if sorted(old.post_ids or []) == sorted(post_ids):
                old.state = "done"
                old.error = "superseded"
                await release_job(db, old.id)
        job = SocialGenJob(
            id=f"gj_{uuid.uuid4().hex[:12]}",
            post_ids=post_ids,
            plan=str(g.get("plan") or "")[:4000],
            headline=str(g.get("headline") or "")[:300],
            channel=str(g.get("channel") or "linkedin"),
            date=str(g.get("date") or ""),
            revision_note=str(g.get("revision_note") or "")[:2000],
            existing_copy=str(g.get("existing_copy") or "")[:6000],
            skip_image=bool(g.get("skip_image")),
            options={**(options or {}), "billing": 2},  # 2: charged through holds
            priority=priority,
            state="queued",
        )
        db.add(job)
        job_ids.append(job.id)
        await db.execute(
            update(SocialPost).where(SocialPost.id.in_(post_ids))
            .values(gen_state="queued", gen_error=None)
            .execution_options(synchronize_session=False)
        )
    wake()
    return job_ids


def _job_dict(j: SocialGenJob) -> Dict[str, Any]:
    return {
        "id": j.id, "post_ids": list(j.post_ids or []), "plan": j.plan or "", "headline": j.headline or "",
        "channel": j.channel or "linkedin", "date": j.date or "", "revision_note": j.revision_note or "",
        "existing_copy": j.existing_copy or "", "skip_image": bool(j.skip_image), "options": j.options or {},
        "priority": j.priority or 0, "attempts": j.attempts or 0,
        "org_id": getattr(j, "org_id", None) or "org_default",
    }


async def _set_posts(db, post_ids: List[str], **values) -> None:
    await db.execute(
        update(SocialPost).where(SocialPost.id.in_(post_ids))
        .values(**values).execution_options(synchronize_session=False)
    )


async def _claim(from_state: str, to_state: str, limit: int, text_batch: bool) -> List[Dict[str, Any]]:
    async with AsyncSessionLocal() as db:
        base = select(SocialGenJob).where(SocialGenJob.state == from_state).order_by(
            SocialGenJob.priority.desc(), SocialGenJob.created_at
        )
        first = (await db.execute(base.limit(1))).scalars().first()
        if not first:
            return []
        rows = [first]
        # Only brand-new posts share a call; rewrites and solo retries go one at a time.
        # A shared call only ever holds one organisation's posts.
        if text_batch and not (first.revision_note or first.existing_copy or first.solo):
            rows = (await db.execute(
                base.where(SocialGenJob.revision_note == "", SocialGenJob.existing_copy == "", SocialGenJob.solo.is_(False),
                           SocialGenJob.org_id == first.org_id)
                .limit(limit)
            )).scalars().all()
        ids = [r.id for r in rows]
        await db.execute(
            update(SocialGenJob).where(SocialGenJob.id.in_(ids), SocialGenJob.state == from_state)
            .values(state=to_state, attempts=SocialGenJob.attempts + (1 if text_batch else 0))
            .execution_options(synchronize_session=False)
        )
        claimed = (await db.execute(select(SocialGenJob).where(SocialGenJob.id.in_(ids), SocialGenJob.state == to_state)
                                    .execution_options(populate_existing=True))).scalars().all()
        post_ids = [pid for j in claimed for pid in (j.post_ids or [])]
        if post_ids:
            await _set_posts(db, post_ids, gen_state="writing" if text_batch else "imaging")
        await db.commit()
        return [_job_dict(j) for j in claimed]


async def _finish(job: Dict[str, Any], state: str, error: Optional[str] = None, post_state: Optional[str] = None, solo: Optional[bool] = None) -> None:
    async with AsyncSessionLocal() as db:
        values: Dict[str, Any] = {"state": state, "error": error}
        if solo is not None:
            values["solo"] = solo
        await db.execute(update(SocialGenJob).where(SocialGenJob.id == job["id"]).values(**values).execution_options(synchronize_session=False))
        await _set_posts(db, job["post_ids"], gen_state=post_state, gen_error=(error if post_state == "failed" else None))
        await db.commit()
    if state == "done":
        from app.services import approval_mail

        # Ready for review now: the approval email waits a little for the rest of the batch.
        for pid in job["post_ids"]:
            approval_mail.note_change(pid)


async def _company(db) -> Dict[str, str]:
    prof = (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()
    if not prof:
        return {"name": "", "pitch": "", "context": ""}
    context = "\n".join(x for x in (getattr(prof, "industry", None) or "", getattr(prof, "website", None) or "") if x)
    return {"name": prof.name or "", "pitch": prof.pitch or "", "context": context}


async def _knowledge(db, text: str) -> str:
    """Relevant knowledge-base lines for the plans being written (same rule as chat)."""
    try:
        from app.api.scheduler import _usable_kb_text
        from app.services.rag_service import search_knowledge

        hits = await search_knowledge(db, text[:2000], top_k=4, min_score=0.38)
        lines = []
        for h in hits or []:
            content = (h.get("content") or "").strip().replace("\n", " ")[:420]
            if _usable_kb_text(content):
                lines.append(f"- {(h.get('title') or 'Note').strip()}: {content}")
        return ("Knowledge base:\n" + "\n".join(lines)) if lines else ""
    except Exception as err:
        logger.debug(f"[GenQueue] Knowledge lookup skipped: {err}")
        return ""


async def _apply_text(job: Dict[str, Any], pkg: Dict[str, Any], brand: str) -> None:
    from app.api.scheduler import _after_status_change
    from app.services.post_writer import linkedin_image_prompt

    image_prompt = linkedin_image_prompt(pkg, job["plan"] or job["headline"], brand)
    async with AsyncSessionLocal() as db:
        posts = (await db.execute(select(SocialPost).where(SocialPost.id.in_(job["post_ids"])))).scalars().all()
        for post in posts:
            if post.status in LOCKED_POST_STATUSES:
                continue
            before = content_of(post)
            post.title = (pkg.get("postTitle") or post.title or "")[:300]
            post.copy = pkg.get("copy") or post.copy
            for col in ("hook", "linkedin_copy", "x_copy", "facebook_copy", "instagram_copy", "threads_copy", "cta", "first_comment", "alt_text"):
                if pkg.get(col):
                    setattr(post, col, pkg[col])
            post.hashtags = pkg.get("hashtags") or post.hashtags
            if not job["skip_image"]:
                post.image_prompt = image_prompt
            # The AI rewrote it on request: the hand-written text is gone, so is the protection.
            post.edited_by_user = False
            if await record_version(db, post, "ai", before=before):
                # New text needs a fresh approval, even if the old text was approved.
                _after_status_change(post, post.status, content_changed=True)
        await db.commit()


async def _pause(job_ids: List[str], why: str) -> None:
    """Out of credits: these jobs, and every other job of this company still waiting, pause
    until the company tops up and chooses to continue (or start afresh)."""
    async with AsyncSessionLocal() as db:
        await db.execute(update(SocialGenJob).where(SocialGenJob.id.in_(job_ids), SocialGenJob.state == "writing")
                         .values(state="paused").execution_options(synchronize_session=False))
        await db.execute(update(SocialGenJob).where(SocialGenJob.id.in_(job_ids), SocialGenJob.state == "imaging")
                         .values(state="image_paused").execution_options(synchronize_session=False))
        await db.execute(update(SocialGenJob).where(SocialGenJob.state == "queued")
                         .values(state="paused").execution_options(synchronize_session=False))
        rows = (await db.execute(select(SocialGenJob).where(SocialGenJob.state.in_(["paused", "image_paused"])))).scalars().all()
        await _set_posts(db, [pid for j in rows for pid in (j.post_ids or [])], gen_state="paused", gen_error=why)
        await db.commit()


async def _hold(job: Dict[str, Any], items: List[str]) -> tuple:
    from app.services import credits

    refs = charge_refs(job["id"])
    notes = {"ai_post": f"AI-written post: {job['headline'] or job['plan']}"[:200], "ai_image": "AI image for a post"}
    async with AsyncSessionLocal() as db:
        ok, why = await credits.hold(db, [{"ref": refs[i], "item": i, "quantity": 1, "note": notes[i]} for i in items])
        if ok:
            await db.commit()
        return ok, why


async def _charge(job: Dict[str, Any], item: str) -> None:
    from app.services import credits

    async with AsyncSessionLocal() as db:
        await credits.confirm_safely(db, charge_refs(job["id"])[item], item, 1, "AI-written post" if item == "ai_post" else "AI image")


async def _release(job: Dict[str, Any], items: List[str]) -> None:
    from app.services import credits

    async with AsyncSessionLocal() as db:
        await credits.release(db, [charge_refs(job["id"])[i] for i in items])
        await db.commit()


async def _run_text(jobs: List[Dict[str, Any]]) -> None:
    from app.services import platform_ai
    from app.services.post_writer import BatchWriteError, generate_complete_social_package, write_post_batch
    from app.api.scheduler import NO_TEXT_AI, _resolve_text_ai

    # The whole post (writing, and its image unless skipped) is held at today's price first.
    # A post that would take the company below zero pauses, with everything after it.
    affordable = []
    for i, j in enumerate(jobs):
        ok, why = await _hold(j, ["ai_post"] if j["skip_image"] else ["ai_post", "ai_image"])
        if not ok:
            await _pause([x["id"] for x in jobs[i:]], why)
            break
        affordable.append(j)
    jobs = affordable
    if not jobs:
        wake()
        return
    priority = max(j["priority"] for j in jobs)
    try:
        async with TEXT_SLOTS.slot(priority):
            async with AsyncSessionLocal() as db:
                company = await _company(db)
                kb = await _knowledge(db, " ".join(j["plan"] or j["headline"] for j in jobs))
                if kb:
                    company["context"] = (company["context"] + "\n\n" + kb).strip()
            opts = jobs[0]["options"] or {}
            j0 = jobs[0]

            async def attempt(slot: str) -> Dict[str, Any]:
                async with AsyncSessionLocal() as db:
                    ai = await _resolve_text_ai(db, None, slot)
                    if ai["error"]:
                        raise platform_ai.AIUnavailable(ai["error"])
                    common = dict(
                        company_name=company["name"], company_pitch=company["pitch"], company_context=company["context"],
                        linkedin_directive=opts.get("linkedinDirective") or "",
                        api_key=ai["api_key"], provider=ai["provider"], model=ai["model"], base_url=ai["base_url"],
                    )
                    if len(jobs) == 1 and (j0["revision_note"] or j0["existing_copy"]):
                        pkg = await generate_complete_social_package(
                            topic=j0["plan"] or j0["headline"], existing_copy=j0["existing_copy"],
                            existing_headline=j0["headline"], revision_note=j0["revision_note"],
                            skip_image=True, db=db, **common,
                        )
                        if pkg.get("generationSource") != "llm":
                            raise platform_ai.AIUnavailable("The writing AI did not return a usable rewrite.")
                        return {j0["id"]: pkg}
                    items = [{"key": j["id"], "plan": j["plan"], "headline": j["headline"], "channel": j["channel"], "date": j["date"]} for j in jobs]
                    return await write_post_batch(items, db=db, **common)

            async def timed(slot: str) -> Dict[str, Any]:
                try:
                    return await asyncio.wait_for(attempt(slot), timeout=TEXT_TIMEOUT_SECS)
                except asyncio.TimeoutError:
                    raise platform_ai.AIUnavailable(f"No reply within {TEXT_TIMEOUT_SECS // 60} minutes.")

            async with AsyncSessionLocal() as db:
                results = await platform_ai.run_with_backup(db, "text", timed)
        for j in jobs:
            await _apply_text(j, results[j["id"]], company["name"])
            await _charge(j, "ai_post")
            if j["skip_image"]:
                await _finish(j, "done", None, None)
            else:
                await _finish(j, "image_queued", None, "imaging")
    except BatchWriteError as err:
        if len(jobs) > 1:
            logger.warning(f"[GenQueue] Batch of {len(jobs)} unreadable ({err}); retrying one by one.")
            for j in jobs:
                await _finish(j, "queued", None, "queued", solo=True)
        else:
            await _release(jobs[0], ["ai_post", "ai_image"])
            await _finish(jobs[0], "failed", NO_TEXT_AI, "failed")
    except Exception as err:
        logger.warning(f"[GenQueue] Writing failed: {err}")
        for j in jobs:
            if j["attempts"] < MAX_ATTEMPTS:
                await _finish(j, "queued", None, "queued", solo=True)  # keeps its hold for the retry
            else:
                await _release(j, ["ai_post", "ai_image"])  # failed work is free
                await _finish(j, "failed", NO_TEXT_AI, "failed")
    finally:
        wake()


async def _run_image(job: Dict[str, Any]) -> None:
    from app.api.scheduler import NO_IMAGE_AI, _host_image, _image_with_backup, _resolve_image_prefs
    from app.services.post_writer import ASPECT_RATIOS

    # Normally held with the writing; a retried image (or a hold that expired) is held again here.
    ok, why = await _hold(job, ["ai_image"])
    if not ok:
        await _pause([job["id"]], why)
        wake()
        return
    try:
        async with IMAGE_SLOTS.slot(job["priority"]):
            async with AsyncSessionLocal() as db:
                prefs = await _resolve_image_prefs(db, {})
                post = (await db.execute(select(SocialPost).where(SocialPost.id.in_(job["post_ids"])))).scalars().first()
                prompt = ((post.image_prompt if post else "") or job["plan"] or job["headline"]).strip()
                width, height = ASPECT_RATIOS.get(prefs["aspect_ratio"], (1080, 1350))
                try:
                    img = await asyncio.wait_for(_image_with_backup(db, {}, prompt, width=width, height=height),
                                                 timeout=IMAGE_TIMEOUT_SECS)
                except asyncio.TimeoutError:
                    raise RuntimeError(f"No image within {IMAGE_TIMEOUT_SECS // 60} minutes.")
            url = _host_image(img.get("imageUrl"), None) or img.get("imageUrl")
            if not url:
                raise RuntimeError(img.get("warning") or "The image AI returned no image.")
            async with AsyncSessionLocal() as db:
                await _set_posts(db, job["post_ids"], image_url=url)
                for post in (await db.execute(select(SocialPost).where(SocialPost.id.in_(job["post_ids"])))).scalars().all():
                    await record_version(db, post, "ai", amend_ai=True)
                await db.commit()
        await _charge(job, "ai_image")
        await _finish(job, "done", None, None)
    except Exception as err:
        logger.warning(f"[GenQueue] Image failed: {err}")
        await _release(job, ["ai_image"])  # a failed image is free; the written post stays charged
        await _finish(job, "failed", NO_IMAGE_AI, "failed")
    finally:
        wake()


def _spawn(tasks: set, coro) -> None:
    task = asyncio.create_task(coro)
    tasks.add(task)
    task.add_done_callback(tasks.discard)


async def _tick() -> None:
    # The queue is shared by every organisation: jobs are picked across all of them, and each
    # job then runs inside its own organisation.
    from app.core.tenancy import in_org, system_scope

    while len(_text_tasks) < TEXT_SLOTS.slots:
        with system_scope():
            jobs = await _claim("queued", "writing", MAX_POSTS_PER_CALL, text_batch=True)
        if not jobs:
            break
        _spawn(_text_tasks, in_org(jobs[0]["org_id"], _run_text(jobs)))
    while len(_image_tasks) < IMAGE_SLOTS.slots:
        with system_scope():
            jobs = await _claim("image_queued", "imaging", 1, text_batch=False)
        if not jobs:
            break
        _spawn(_image_tasks, in_org(jobs[0]["org_id"], _run_image(jobs[0])))


async def _recover() -> None:
    """Work that was running when the server stopped goes back in the queue."""
    from app.core.tenancy import system_scope

    with system_scope():
        await _recover_all()


async def _recover_all() -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(update(SocialGenJob).where(SocialGenJob.state == "writing").values(state="queued").execution_options(synchronize_session=False))
        await db.execute(update(SocialGenJob).where(SocialGenJob.state == "imaging").values(state="image_queued").execution_options(synchronize_session=False))
        await db.commit()


async def generation_loop() -> None:
    try:
        await _recover()
    except Exception as err:
        logger.warning(f"[GenQueue] Recovery skipped: {err}")
    while True:
        try:
            await _tick()
        except asyncio.CancelledError:
            raise
        except Exception as err:
            logger.warning(f"[GenQueue] Tick failed: {err}")
        try:
            await asyncio.wait_for(_wake.wait(), timeout=3.0)
        except asyncio.TimeoutError:
            pass
        _wake.clear()
