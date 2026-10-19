"""Social tools around the posts: media library, bulk import, client reports, listening, tracked links,
test mode and the learned brand style. The public pieces (short-link redirect, shared report page) are in
public_router: they need no sign-in."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models.models import SocialListenTopic, SocialMedia, SocialMention, SocialPost, SocialReport, SocialReportRun
from app.services import social_import as SI
from app.services import social_library as SL
from app.services import social_listening as LS
from app.services import social_reports as SR

logger = logging.getLogger("scheduler_tools")

router = APIRouter(prefix="/scheduler", tags=["Post Scheduler"])
public_router = APIRouter(tags=["Social public links"])


def _by(request: Request) -> str:
    return str((getattr(request.state, "auth", None) or {}).get("operator_id", "") or "")


def _org(request: Request) -> str:
    from app.core.tenancy import current_org

    return current_org()


# ── Media library ───────────────────────────────────────────────────────────
@router.get("/library")
async def library_list(kind: str = "", q: str = "", tag: str = "", db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    stmt = select(SocialMedia).order_by(SocialMedia.created_at.desc()).limit(500)
    if kind in ("image", "video"):
        stmt = stmt.where(SocialMedia.kind == kind)
    rows = (await db.execute(stmt)).scalars().all()
    needle, tag = q.strip().lower(), tag.strip().lower()
    if needle:
        rows = [m for m in rows if needle in (m.name or "").lower() or needle in (m.alt_text or "").lower()
                or any(needle in t for t in m.tags or [])]
    if tag:
        rows = [m for m in rows if tag in (m.tags or [])]
    counts = await SL.usage(db)
    tags = sorted({t for m in rows for t in (m.tags or [])})
    return {"items": [SL.view(m, SL.used_by(m, counts)) for m in rows], "tags": tags,
            "limits": {"imageMb": SL.MS.MAX_IMAGE_BYTES // (1024 * 1024), "videoMb": SL.MS.MAX_VIDEO_BYTES // (1024 * 1024)}}


@router.post("/library/upload")
async def library_upload(request: Request, files: List[UploadFile] = File(...), tags: str = Form(""),
                         db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    if len(files) > 20:
        raise HTTPException(status_code=400, detail="Upload up to 20 files at a time.")
    added, errors = [], []
    for f in files:
        try:
            url, size = await SL.MS.store_upload(f, f.content_type or "")
            row = await SL.add_file(db, url, size=size, name=(f.filename or "")[:200], source="upload", by=_by(request),
                                    tags=SL.clean_tags(tags))
            added.append(SL.view(row))
        except ValueError as err:
            errors.append({"name": f.filename or "file", "error": str(err)})
    await db.commit()
    if not added and errors:
        raise HTTPException(status_code=400, detail=errors[0]["error"])
    return {"items": added, "errors": errors}


@router.post("/library/import-url")
async def library_import_url(payload: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    try:
        row = await SL.import_remote(db, str(payload.get("url") or ""), by=_by(request), source="upload")
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    await db.commit()
    return {"item": SL.view(row)}


@router.patch("/library/{media_id}")
async def library_edit(media_id: str, payload: Dict[str, Any], db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    row = await db.get(SocialMedia, media_id)
    if not row:
        raise HTTPException(status_code=404, detail="That file is no longer in the library.")
    if "name" in payload:
        row.name = str(payload.get("name") or "").strip()[:200]
    if "alt" in payload:
        row.alt_text = str(payload.get("alt") or "").strip()[:1000]
    if "tags" in payload:
        row.tags = SL.clean_tags(payload.get("tags"))
    await db.commit()
    return {"item": SL.view(row, SL.used_by(row, await SL.usage(db)))}


@router.delete("/library/{media_id}")
async def library_delete(media_id: str, force: bool = False, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    row = await db.get(SocialMedia, media_id)
    if not row:
        raise HTTPException(status_code=404, detail="That file is no longer in the library.")
    used = SL.used_by(row, await SL.usage(db))
    if used and not force:
        raise HTTPException(status_code=409, detail=f"{used} post{'s' if used != 1 else ''} not yet published use this file. "
                                                    "Remove it from them first, or delete it anyway.")
    await db.delete(row)
    await db.commit()
    # The file itself stays: published posts and posts that still use it keep working.
    return {"status": "ok"}


# ── Bulk import ─────────────────────────────────────────────────────────────
async def _now_local(db: AsyncSession) -> datetime:
    import zoneinfo

    from app.services.org_settings import org_timezone

    return datetime.now(zoneinfo.ZoneInfo(await org_timezone(db)))


@router.get("/import/template")
async def import_template() -> Dict[str, Any]:
    return {"filename": "social-posts-template.csv", "csv": SI.template_csv(), "columns": SI.TEMPLATE_HEADERS,
            "maxRows": SI.MAX_ROWS}


@router.post("/import/check")
async def import_check(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    raw = await file.read(SI.MAX_FILE_BYTES + 1)
    try:
        rows = SI.read_table(raw, file.filename or "")
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    checked = SI.check_rows(rows, await _now_local(db))
    return {"rows": checked, "summary": _import_summary(checked)}


def _import_summary(rows: List[Dict[str, Any]]) -> Dict[str, int]:
    ok = [r for r in rows if not r["issues"]]
    return {"rows": len(rows), "ready": len(ok), "problems": len(rows) - len(ok),
            "posts": sum(len(r["channels"]) for r in ok), "aiWritten": sum(len(r["channels"]) for r in ok if not r["text"])}


@router.post("/import/commit")
async def import_commit(payload: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Save the rows that pass the checks (checked again here). approve=true schedules them straight away."""
    from app.api.scheduler import _after_status_change, _apply_due
    from app.services import generation_queue as gen_queue
    from app.services.org_settings import org_timezone

    sent = payload.get("rows") or []
    if not isinstance(sent, list) or not sent:
        raise HTTPException(status_code=400, detail="Nothing to import.")
    if len(sent) > SI.MAX_ROWS:
        raise HTTPException(status_code=400, detail=f"Import up to {SI.MAX_ROWS} rows at a time.")
    raw_rows = [{"date": r.get("date"), "time": r.get("time"), "channels": ",".join(r.get("channels") or []),
                 "text": r.get("text"), "title": r.get("title"), "topic": r.get("topic"),
                 "media": ",".join(r.get("media") or []), "first_comment": r.get("firstComment"),
                 "alt_text": r.get("altText"), "subreddit": r.get("subreddit")} for r in sent if isinstance(r, dict)]
    rows = SI.check_rows(raw_rows, await _now_local(db))
    for r, original in zip(rows, sent):
        r["row"] = original.get("row") or r["row"]
    ok = [r for r in rows if not r["issues"]]
    to_write = [r for r in ok if not r["text"]]
    if to_write:
        from app.models.models import CompanyProfile
        from app.services.credits import can_start

        prof = (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()
        if not prof or not (prof.name or "").strip():
            raise HTTPException(status_code=400, detail="Add your company name under Accounts before the AI writes posts.")
        allowed, why = await can_start(db, "ai_post")
        if not allowed:
            raise HTTPException(status_code=402, detail=why)
    approve = bool(payload.get("approve"))
    tz = await org_timezone(db)
    created, failed, groups = [], [], []
    for r in ok:
        try:
            media = []
            for url in r["media"]:
                m = await SL.import_remote(db, url, by=_by(request))
                media.append(SL.item(m, r["altText"] if not media else None))
        except ValueError as err:
            failed.append({"row": r["row"], "error": str(err)})
            continue
        ids = []
        for ch in r["channels"]:
            pid = f"v2_{uuid.uuid4().hex[:8]}_{uuid.uuid4().hex[:6]}"
            post = SocialPost(id=pid, title=(r["title"] or SI.default_title(r))[:300], copy=r["text"], channels=[ch],
                              status="approved" if approve and r["text"] else "awaiting_approval", time=r["time"],
                              theme="Imported", source="import", media=media,
                              first_comment=r["firstComment"] or None, alt_text=r["altText"] or None,
                              channel_options={"reddit": {"subreddit": r["subreddit"], "flair": ""}} if ch == "reddit" else {})
            post.image_url = next((m["url"] for m in media if m["kind"] == "image"), None)
            _apply_due(post, {"date": r["date"], "time": r["time"]}, tz)
            _after_status_change(post, None, content_changed=False)
            db.add(post)
            ids.append(pid)
            created.append(pid)
        if not r["text"] and ids:
            groups.extend({"post_ids": [pid], "plan": r["topic"], "headline": r["title"] or r["topic"], "channel": ch,
                           "date": r["date"], "skip_image": bool(media)} for pid, ch in zip(ids, r["channels"]))
    await db.flush()
    if groups:
        await gen_queue.enqueue(db, groups, options={"batch": f"b_{uuid.uuid4().hex[:10]}", "by": _by(request),
                                                     "started": datetime.utcnow().isoformat()})
    await db.commit()
    skipped = [{"row": r["row"], "error": "; ".join(r["issues"])} for r in rows if r["issues"]]
    return {"status": "ok", "created": len(created), "postIds": created, "aiWriting": len(groups),
            "failed": failed + skipped}


# ── Reports ─────────────────────────────────────────────────────────────────
@router.get("/reports")
async def reports_list(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    rows = (await db.execute(select(SocialReport).order_by(SocialReport.created_at.desc()))).scalars().all()
    from app.core import mailer

    return {"reports": [SR.view(r) for r in rows], "emailReady": mailer.configured()}


@router.get("/reports/history")
async def reports_history(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    rows = (await db.execute(select(SocialReportRun).order_by(SocialReportRun.created_at.desc()).limit(100))).scalars().all()
    return {"runs": [SR.run_view(r) for r in rows]}


@router.post("/reports")
async def reports_create(payload: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    try:
        fields = SR.clean(payload)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    row = SocialReport(id=f"rep_{uuid.uuid4().hex[:10]}", created_by=_by(request), **fields)
    db.add(row)
    await db.commit()
    return {"report": SR.view(row), "link": SR.share_url(row, _org(request))}


@router.put("/reports/{report_id}")
async def reports_update(report_id: str, payload: Dict[str, Any], db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    row = await db.get(SocialReport, report_id)
    if not row:
        raise HTTPException(status_code=404, detail="Report not found.")
    try:
        for k, v in SR.clean(payload, row).items():
            setattr(row, k, v)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    await db.commit()
    return {"report": SR.view(row)}


@router.delete("/reports/{report_id}")
async def reports_delete(report_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    row = await db.get(SocialReport, report_id)
    if row:
        await db.delete(row)
        await db.commit()
    return {"status": "ok"}


@router.get("/reports/{report_id}/preview")
async def reports_preview(report_id: str, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    row = await db.get(SocialReport, report_id)
    if not row:
        raise HTTPException(status_code=404, detail="Report not found.")
    data = await SR.build(db, row)
    return {"html": SR.page(row, data), "link": SR.share_url(row, _org(request)), "period": SR.period_label(data)}


@router.post("/reports/{report_id}/send")
async def reports_send(report_id: str, payload: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from app.services.org_settings import clean_emails

    row = await db.get(SocialReport, report_id)
    if not row:
        raise HTTPException(status_code=404, detail="Report not found.")
    to = clean_emails(payload.get("to")) if payload.get("to") else None
    res = await SR.send(db, row, _org(request), to)
    if not res["sent"]:
        raise HTTPException(status_code=400, detail=res["error"] or "The report could not be sent.")
    return {"status": "ok", **res, "report": SR.view(row)}


@public_router.get("/scheduler/report-view", response_class=HTMLResponse)
async def report_view(t: str = "") -> HTMLResponse:
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.public_api import links
    from app.services.approval_mail import _page

    data = links.read_token(t, "social_report")
    if not data:
        return HTMLResponse(_page("Link not valid", "<h1>This report link is no longer valid</h1>"
                                  "<div class='sub'>Ask the sender for a new link.</div>"), status_code=404)
    with org_scope(data["o"]):
        async with AsyncSessionLocal() as db:
            row = await db.get(SocialReport, data["i"])
            if not row:
                return HTMLResponse(_page("Report removed", "<h1>This report was removed</h1>"), status_code=404)
            return HTMLResponse(SR.page(row, await SR.build(db, row)))


# ── Listening ───────────────────────────────────────────────────────────────
@router.get("/listening")
async def listening_overview(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from app.models.models import SocialAccount
    from app.services.social_oauth import get_oauth_app
    from app.services.social_publisher import pick_account_for_channel

    topics = (await db.execute(select(SocialListenTopic).order_by(SocialListenTopic.created_at))).scalars().all()
    counts = dict((await db.execute(select(SocialMention.topic_id, func.count(SocialMention.id))
                                    .where(SocialMention.status == "new").group_by(SocialMention.topic_id))).all())
    accounts = (await db.execute(select(SocialAccount))).scalars().all()
    reddit_app = (await get_oauth_app(db, "reddit")).get("configured")
    sources = {s: bool(pick_account_for_channel(accounts, s)) for s in LS.SOURCES}
    sources["reddit"] = sources["reddit"] or bool(reddit_app)
    return {"topics": [LS.topic_view(t, counts.get(t.id, 0)) for t in topics], "sources": sources,
            "maxTopics": LS.MAX_TOPICS}


@router.post("/listening/topics")
async def listening_create(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    if (await db.execute(select(func.count(SocialListenTopic.id)))).scalar() >= LS.MAX_TOPICS:
        raise HTTPException(status_code=400, detail=f"Up to {LS.MAX_TOPICS} topics. Remove one first.")
    try:
        fields = LS.clean_topic(payload)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    row = SocialListenTopic(id=f"lt_{uuid.uuid4().hex[:10]}", checked={}, last_error={}, **fields)
    db.add(row)
    await db.commit()
    res = await LS.check_topic(db, row, force=True)
    return {"topic": LS.topic_view(row, res["new"]), "found": res["new"]}


@router.put("/listening/topics/{topic_id}")
async def listening_update(topic_id: str, payload: Dict[str, Any], db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    row = await db.get(SocialListenTopic, topic_id)
    if not row:
        raise HTTPException(status_code=404, detail="Topic not found.")
    try:
        for k, v in LS.clean_topic(payload, row).items():
            setattr(row, k, v)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    await db.commit()
    return {"topic": LS.topic_view(row)}


@router.delete("/listening/topics/{topic_id}")
async def listening_delete(topic_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from sqlalchemy import delete

    row = await db.get(SocialListenTopic, topic_id)
    if row:
        await db.delete(row)
        await db.execute(delete(SocialMention).where(SocialMention.topic_id == topic_id))
        await db.commit()
    return {"status": "ok"}


@router.post("/listening/topics/{topic_id}/check")
async def listening_check(topic_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    row = await db.get(SocialListenTopic, topic_id)
    if not row:
        raise HTTPException(status_code=404, detail="Topic not found.")
    res = await LS.check_topic(db, row, force=True)
    return {"found": res["new"], "errors": res["errors"], "topic": LS.topic_view(row)}


@router.get("/listening/mentions")
async def listening_mentions(topic: str = "", source: str = "", status: str = "", limit: int = 100,
                             db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    q = select(SocialMention).order_by(SocialMention.posted_at.desc().nullslast(), SocialMention.found_at.desc())
    if topic:
        q = q.where(SocialMention.topic_id == topic)
    if source:
        q = q.where(SocialMention.source == source)
    if status in ("new", "seen", "ignored"):
        q = q.where(SocialMention.status == status)
    else:
        q = q.where(SocialMention.status != "ignored")
    rows = (await db.execute(q.limit(max(1, min(limit, 300))))).scalars().all()
    return {"mentions": [LS.view(m) for m in rows]}


@router.post("/listening/mentions/status")
async def listening_mark(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    status = str(payload.get("status") or "")
    if status not in ("new", "seen", "ignored"):
        raise HTTPException(status_code=400, detail="status must be new, seen or ignored.")
    ids = [str(i) for i in payload.get("ids") or []][:300]
    rows = (await db.execute(select(SocialMention).where(SocialMention.id.in_(ids)))).scalars().all() if ids else []
    for m in rows:
        m.status = status
    await db.commit()
    return {"updated": len(rows)}


@router.post("/listening/mentions/leads")
async def listening_leads(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    ids = [str(i) for i in payload.get("ids") or []][:200]
    if not ids:
        raise HTTPException(status_code=400, detail="Pick the mentions to add.")
    return await LS.add_to_leads(db, ids)


# ── AI video clips ──────────────────────────────────────────────────────────
@router.get("/videos")
async def videos_list(postId: str = "", db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from app.models.models import SocialVideoJob
    from app.services import credits, video_ai

    q = select(SocialVideoJob).order_by(SocialVideoJob.created_at.desc()).limit(30)
    if postId:
        q = q.where(SocialVideoJob.post_id == postId)
    rows = (await db.execute(q)).scalars().all()
    changed = False
    for j in rows:
        if video_ai.stale(j):  # its worker is gone (restart, another server): free it
            j.state, j.error = "failed", "The clip was interrupted. Nothing was charged; try again."
            await credits.release(db, [j.id])
            changed = True
    if changed:
        await db.commit()
    rate = (await credits.rates(db)).get(video_ai.CREDIT_ITEM, {})
    return {"available": bool(await video_ai.find_key(db)), "credits": rate.get("credits", 20),
            "lengths": list(video_ai.LENGTHS), "jobs": [video_ai.view(j) for j in rows]}


@router.post("/videos")
async def videos_start(payload: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from app.services import video_ai

    try:
        job = await video_ai.start(db, _org(request), payload, by=_by(request))
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except LookupError as err:
        raise HTTPException(status_code=503, detail=str(err))
    except PermissionError as err:
        raise HTTPException(status_code=402, detail=str(err))
    return {"job": video_ai.view(job)}


@router.get("/videos/{job_id}")
async def videos_get(job_id: str, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from app.models.models import SocialVideoJob
    from app.services import video_ai

    job = await db.get(SocialVideoJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="That clip is not known.")
    return {"job": video_ai.view(job)}


# ── Tracked links, test mode, learned style ─────────────────────────────────
@router.get("/settings/extras")
async def extras_get(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from app.services import social_links, social_test_mode

    return {"trackLinks": await social_links.org_default(db), "testMode": await social_test_mode.get(db),
            "shortLinkBase": social_links.short_base()}


@router.put("/settings/extras")
async def extras_put(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from app.services import social_links, social_test_mode

    if "trackLinks" in payload:
        await social_links.set_org_default(db, bool(payload["trackLinks"]))
        await db.commit()
    tm = payload.get("testMode")
    if isinstance(tm, dict):
        try:
            await social_test_mode.put(db, on=tm.get("on"), outcome=tm.get("outcome"))
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))
    return await extras_get(db)


@router.post("/brand-voice/learn")
async def brand_voice_learn(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from app.services import ai_errors, brand_voice

    try:
        learned = await brand_voice.learn(db)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=503, detail=await ai_errors.failure(str(err), "Learning your style"))
    return {"learned": learned}


@router.put("/brand-voice/learned")
async def brand_voice_learned(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    from app.services import brand_voice

    rules = payload.get("rules")
    cur = await brand_voice.set_learned(db, on=payload.get("on"), rules=rules if isinstance(rules, list) else None)
    if cur is None:
        raise HTTPException(status_code=404, detail="Nothing learned yet. Press Learn my style first.")
    return {"learned": cur}


# ── Public: tracked short links ─────────────────────────────────────────────
@public_router.get("/l/{code}")
async def short_link(code: str, request: Request):
    from app.services import social_links

    target = await social_links.follow(code, request.headers.get("user-agent", ""), request.headers.get("referer", ""))
    if not target:
        raise HTTPException(status_code=404, detail="This link is not valid.")
    return RedirectResponse(target, status_code=302, headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer-when-downgrade"})
