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
- Progress: each request is a batch (options["batch"]); progress() gives its stage, queue
  position and estimated time. When a batch finishes, the company's bell gets a note, and the
  user who started it an email if it took over 5 minutes and they are no longer watching.
- Failures carry an error code (ai_errors): users see the code and a plain message.
"""
from __future__ import annotations

import asyncio
import heapq
import itertools
import logging
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
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
ACTIVE_STATES = ("queued", "writing", "image_queued", "imaging", "paused", "image_paused")
EMAIL_AFTER = timedelta(minutes=5)  # a batch that took longer emails its user if they left
WATCHING_SECS = 90  # progress polled this recently: the user is still watching
MAX_RUNNING_PER_ORG = 2  # AI calls (writing or drawing) one company can have running at once
MAX_BATCHES_PER_ORG = 2  # requests one company can have waiting or running (USR-06 beyond)
RUNNING_STATES = ("queued", "writing", "image_queued", "imaging")

# Fair share between companies: each runs at most MAX_RUNNING_PER_ORG calls at once, and the
# next free slot goes to the company served least recently (then priority, then first come).
_running: Dict[str, int] = {}
_served: Dict[str, float] = {}

# Rolling averages (seconds) of one writing call and one image, for the estimated time.
_avg = {"text": 45.0, "image": 25.0}
_polled: Dict[str, float] = {}  # batch -> last time its progress was asked for
_announced: set = set()


def _note_duration(kind: str, secs: float) -> None:
    _avg[kind] = round(_avg[kind] * 0.8 + secs * 0.2, 1)


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


async def _claim(from_state: str, to_state: str, limit: int, text_batch: bool,
                 skip_orgs: Optional[set] = None) -> List[Dict[str, Any]]:
    async with AsyncSessionLocal() as db:
        base = select(SocialGenJob).where(SocialGenJob.state == from_state).order_by(
            SocialGenJob.priority.desc(), SocialGenJob.created_at
        )
        # Each company's next job; the company served least recently goes first (an urgent
        # job still beats a routine one).
        heads: Dict[str, Any] = {}
        for jid, org, prio, created in (await db.execute(
                select(SocialGenJob.id, SocialGenJob.org_id, SocialGenJob.priority, SocialGenJob.created_at)
                .where(SocialGenJob.state == from_state)
                .order_by(SocialGenJob.priority.desc(), SocialGenJob.created_at).limit(5000))).all():
            if org not in heads and org not in (skip_orgs or ()):
                heads[org] = (-(prio or 0), _served.get(org, 0.0), created or datetime.min, jid)
        if not heads:
            return []
        first_id = min(heads.values())[3]
        first = (await db.execute(select(SocialGenJob).where(SocialGenJob.id == first_id))).scalars().first()
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


async def _finish(job: Dict[str, Any], state: str, error: Optional[str] = None, post_state: Optional[str] = None,
                  solo: Optional[bool] = None, post_error: Optional[str] = None) -> None:
    async with AsyncSessionLocal() as db:
        values: Dict[str, Any] = {"state": state, "error": error}
        if solo is not None:
            values["solo"] = solo
        await db.execute(update(SocialGenJob).where(SocialGenJob.id == job["id"]).values(**values).execution_options(synchronize_session=False))
        await _set_posts(db, job["post_ids"], gen_state=post_state,
                         gen_error=((post_error or error) if post_state == "failed" else None))
        await db.commit()
    if state in ("done", "failed"):
        await _batch_finished(job)
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
    from app.services import ai_errors, platform_ai
    from app.services.post_writer import BatchWriteError, generate_complete_social_package, write_post_batch
    from app.api.scheduler import _resolve_text_ai

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

            started = time.monotonic()
            async with AsyncSessionLocal() as db:
                results = await platform_ai.run_with_backup(db, "text", timed)
            _note_duration("text", time.monotonic() - started)
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
            await _finish(jobs[0], "failed", await ai_errors.failure(f"Unreadable reply: {err}", "Post writing"), "failed")
    except Exception as err:
        logger.warning(f"[GenQueue] Writing failed: {err}")
        msg = None
        for j in jobs:
            if j["attempts"] < MAX_ATTEMPTS:
                await _finish(j, "queued", None, "queued", solo=True)  # keeps its hold for the retry
            else:
                await _release(j, ["ai_post", "ai_image"])  # failed work is free
                msg = msg or await ai_errors.failure(str(err) or err.__class__.__name__, "Post writing")
                await _finish(j, "failed", msg, "failed")
    finally:
        wake()


async def _run_image(job: Dict[str, Any]) -> None:
    from app.api.scheduler import _host_image, _image_with_backup, _resolve_image_prefs
    from app.services import ai_errors
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
                started = time.monotonic()
                try:
                    img = await asyncio.wait_for(_image_with_backup(db, {}, prompt, width=width, height=height),
                                                 timeout=IMAGE_TIMEOUT_SECS)
                except asyncio.TimeoutError:
                    raise RuntimeError(f"No image within {IMAGE_TIMEOUT_SECS // 60} minutes.")
                _note_duration("image", time.monotonic() - started)
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
        msg = await ai_errors.failure(str(err) or err.__class__.__name__, "Post image")
        await _finish(job, "failed", f"Image: {msg}", "failed", post_error=f"Image failed. {msg}")
    finally:
        wake()


# ── Progress and finishing ──────────────────────────────────────────────────
def _batch_of(j: SocialGenJob) -> str:
    return str((j.options or {}).get("batch") or "")


def _written(j: SocialGenJob) -> bool:
    """Its writing is over (written, or failed for good)."""
    return j.state in ("image_queued", "imaging", "image_paused", "done", "failed")


async def _batch_jobs(db, batch: str) -> List[SocialGenJob]:
    since = datetime.utcnow() - timedelta(days=2)
    rows = (await db.execute(select(SocialGenJob).where(SocialGenJob.created_at >= since))).scalars().all()
    return [j for j in rows if _batch_of(j) == batch and j.error not in ("superseded", "cancelled")]


def _summary(jobs: List[SocialGenJob]) -> Dict[str, Any]:
    failed = [j for j in jobs if j.state == "failed"]
    from app.services.ai_errors import code_of

    codes = sorted({code_of((j.error or "").removeprefix("Image: ")) for j in failed} - {""})
    return {"total": len(jobs), "done": sum(1 for j in jobs if j.state == "done"), "failed": len(failed), "codes": codes}


async def _batch_finished(job: Dict[str, Any]) -> None:
    """The last job of a batch just ended: a bell note for the company, and an email to the user
    who started it when it took over EMAIL_AFTER and they are no longer watching. Never raises."""
    batch = str((job.get("options") or {}).get("batch") or "")
    if not batch or batch in _announced:
        return
    try:
        async with AsyncSessionLocal() as db:
            jobs = await _batch_jobs(db, batch)
            if not jobs or any(j.state in ACTIVE_STATES for j in jobs):
                return
            _announced.add(batch)
            sm = _summary(jobs)
            text = f"AI writing finished: {sm['done']} of {sm['total']} post{'s' if sm['total'] != 1 else ''} ready"
            if sm["failed"]:
                text += f", {sm['failed']} failed ({', '.join(sm['codes']) or 'see the posts'})"
            from app.models.models import Notification

            db.add(Notification(id=f"n_{uuid.uuid4().hex[:8]}", text=text + ".", type="alert" if sm["failed"] else "success"))
            await db.commit()
        opts = job.get("options") or {}
        started = datetime.fromisoformat(opts["started"]) if opts.get("started") else None
        watching = time.monotonic() - _polled.get(batch, 0) < WATCHING_SECS
        if opts.get("by") and started and datetime.utcnow() - started > EMAIL_AFTER and not watching:
            from app.core.notify import notify

            await notify("posts_ready", text, [text + ".", "Open the Post scheduler to review and approve them."],
                         only_user_ids=[opts["by"]])
    except Exception as err:
        logger.warning(f"[GenQueue] batch {batch} finish note skipped: {err}")


TIPS = [
    "You can leave this page: writing carries on, and you'll get a note when it's done.",
    "Posts are written 5 at a time; images are drawn as each post is written.",
    "Failed writing or images are never charged.",
    "Edit any post by hand after it's written; your edits are kept.",
    "Ask the Plan AI to rewrite one post if it doesn't sound right.",
]


async def progress(db) -> Dict[str, Any]:
    """This company's AI writing: per batch the counts, a stage message, the place in the queue
    and an estimated time; batches that finished in the last 2 minutes come back once more so
    the page can say they are done."""
    from app.core.tenancy import system_scope

    since = datetime.utcnow() - timedelta(days=2)
    rows = (await db.execute(select(SocialGenJob).where(SocialGenJob.created_at >= since))).scalars().all()
    batches: Dict[str, List[SocialGenJob]] = {}
    for j in rows:
        b = _batch_of(j)
        if b and j.error not in ("superseded", "cancelled"):
            batches.setdefault(b, []).append(j)
    # Everyone's waiting writing, in the order it will be taken.
    with system_scope():
        async with AsyncSessionLocal() as sdb:
            line = (await sdb.execute(select(SocialGenJob.id).where(SocialGenJob.state == "queued").order_by(
                SocialGenJob.priority.desc(), SocialGenJob.created_at))).scalars().all()
    place = {jid: i for i, jid in enumerate(line)}
    recent = datetime.utcnow() - timedelta(minutes=2)
    out = []
    for b, jobs in batches.items():
        active = [j for j in jobs if j.state in ACTIVE_STATES]
        if not active and max((j.updated_at or j.created_at) for j in jobs) < recent:
            continue
        _polled[b] = time.monotonic()
        sm = _summary(jobs)
        written = sum(1 for j in jobs if _written(j))
        writing = [j for j in jobs if j.state == "writing"]
        imaging = [j for j in jobs if j.state == "imaging"]
        queued = [j for j in jobs if j.state == "queued"]
        images_left = sum(1 for j in jobs if not j.skip_image and j.state in ("queued", "writing", "image_queued", "imaging"))
        paused = sum(1 for j in jobs if j.state in ("paused", "image_paused"))
        ahead = min((place[j.id] for j in queued if j.id in place), default=None)
        if paused:
            stage = f"Paused: {paused} post{'s' if paused != 1 else ''} waiting for a top-up."
        elif writing:
            stage = f"Writing post{'s' if len(writing) > 1 else ''} {written + 1}" + (
                f"–{written + len(writing)}" if len(writing) > 1 else "") + f" of {len(jobs)}…"
        elif imaging or any(j.state == "image_queued" for j in jobs):
            drawn = sum(1 for j in jobs if j.state in ("done", "failed") and not j.skip_image)
            total_images = sum(1 for j in jobs if not j.skip_image)
            stage = f"Drawing image {min(drawn + 1, total_images)} of {total_images}…"
        elif queued:
            stage = f"Waiting in line: {ahead} post{'s' if ahead != 1 else ''} ahead." if ahead else "Starting…"
        else:
            stage = "Done."
        calls_left = -(-((ahead or 0) + len(queued) + len(writing)) // MAX_POSTS_PER_CALL)
        eta = 0 if not active or paused else int(calls_left / TEXT_SLOTS.slots * _avg["text"]
                                                  + images_left / IMAGE_SLOTS.slots * _avg["image"])
        out.append({**sm, "batch": b, "active": bool(active), "written": written, "paused": paused,
                    "queuePosition": (ahead + 1) if ahead is not None else None, "etaSeconds": eta, "stage": stage,
                    "postIds": [pid for j in jobs for pid in (j.post_ids or [])]})
    out.sort(key=lambda x: (not x["active"], x["batch"]))
    return {"batches": out, "tips": TIPS}


def _spawn(tasks: set, coro) -> None:
    task = asyncio.create_task(coro)
    tasks.add(task)
    task.add_done_callback(tasks.discard)


async def _tick() -> None:
    # The queue is shared by every organisation: jobs are picked across all of them, fairly (see
    # _claim), and each job then runs inside its own organisation.
    from app.core.tenancy import system_scope

    while len(_text_tasks) < TEXT_SLOTS.slots:
        with system_scope():
            jobs = await _claim("queued", "writing", MAX_POSTS_PER_CALL, text_batch=True, skip_orgs=_busy_orgs())
        if not jobs:
            break
        _spawn(_text_tasks, _counted(jobs[0]["org_id"], _run_text(jobs)))
    while len(_image_tasks) < IMAGE_SLOTS.slots:
        with system_scope():
            jobs = await _claim("image_queued", "imaging", 1, text_batch=False, skip_orgs=_busy_orgs())
        if not jobs:
            break
        _spawn(_image_tasks, _counted(jobs[0]["org_id"], _run_image(jobs[0])))


def _busy_orgs() -> set:
    return {org for org, n in _running.items() if n >= MAX_RUNNING_PER_ORG}


def _counted(org_id: str, coro):
    """One AI call, to run inside its organisation, counted against its fair share from now
    (when it is claimed) until it ends."""
    from app.core.tenancy import in_org

    _running[org_id] = _running.get(org_id, 0) + 1
    _served[org_id] = time.monotonic()

    async def run() -> None:
        try:
            await in_org(org_id, coro)
        finally:
            _running[org_id] = _running.get(org_id, 1) - 1
            if _running[org_id] <= 0:
                _running.pop(org_id, None)
            _wake.set()

    return run()


async def running_batches(db) -> int:
    """Requests of the current company still waiting or running (USR-06 at MAX_BATCHES_PER_ORG)."""
    rows = (await db.execute(select(SocialGenJob.options).where(SocialGenJob.state.in_(RUNNING_STATES)))).scalars().all()
    return len({(o or {}).get("batch") or "" for o in rows})


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
