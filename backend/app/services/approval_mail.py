"""Post approval by email.

Every post waits for approval before it can go live. The organisation's approvers (Company
Profile → Post approver emails) get one email per batch of posts ready for review, with a
signed link to a review page where they approve or reject each post. Opening the link never
changes anything (mail scanners open links); only the buttons on the page do.

After each publishing round the approvers get one results email: what went live, what failed
and which posts missed their slot because nobody approved them in time.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import logging
import time
import uuid
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.config import settings
from app.models.models import SocialEmail, SocialPost, SocialSchedule
from app.services.org_settings import load_org

logger = logging.getLogger("approval_mail")

WAITING = "awaiting_approval"
REJECTED = "rejected"
MISSED = "approval_missed"
APPROVED_STATES = ("approved", "scheduled")
WRITING_STATES = ("queued", "writing", "imaging")

# An email goes out once no post in it has changed for this long, so posts that become ready
# close together share one email and a post being edited is not sent after every save.
BATCH_WAIT_S = 120
# ...unless one of them is due soon.
URGENT_MS = 30 * 60 * 1000
# A slot counts as missed once it is this far in the past without approval.
MISSED_GRACE_MS = 10 * 60 * 1000
LINK_TTL_S = 30 * 24 * 3600

CHANNEL_TITLES = {"linkedin": "LinkedIn", "x": "X", "facebook": "Facebook", "instagram": "Instagram", "threads": "Threads"}

# post id -> when it last became ready for review or changed (in memory; after a restart
# posts simply wait one more BATCH_WAIT_S).
_changed_at: Dict[str, float] = {}


def note_change(post_id: str) -> None:
    _changed_at[post_id] = time.time()


# ── Signed links ────────────────────────────────────────────────────────────

def _key() -> bytes:
    return hashlib.sha256(("post-approval-links:" + (settings.SECRET_KEY or "")).encode("utf-8")).digest()


def sign(payload: Dict[str, Any]) -> str:
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")).decode("ascii").rstrip("=")
    mac = hmac.new(_key(), body.encode("ascii"), hashlib.sha256).hexdigest()[:32]
    return f"{body}.{mac}"


def verify(token: str) -> Optional[Dict[str, Any]]:
    try:
        body, mac = str(token or "").strip().rsplit(".", 1)
        want = hmac.new(_key(), body.encode("ascii"), hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(mac, want):
            return None
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if not isinstance(data, dict) or float(data.get("x") or 0) < time.time():
            return None
        return data
    except Exception:
        return None


# ── Helpers ─────────────────────────────────────────────────────────────────

def needs_review(post: SocialPost) -> bool:
    return (
        post.status == WAITING
        and not post.approval_requested_at
        and post.gen_state not in WRITING_STATES
        and bool((post.copy or "").strip())
    )


def _channel(post: SocialPost) -> str:
    ch = (post.channels or ["linkedin"])[0]
    return CHANNEL_TITLES.get(str(ch).lower(), str(ch).title())


def _when(due_ms: float, tz: str, time_format: str) -> str:
    if not due_ms:
        return "No time set"
    import zoneinfo

    local = datetime.fromtimestamp(due_ms / 1000.0, zoneinfo.ZoneInfo(tz))
    clock = local.strftime("%I:%M %p").lstrip("0") if time_format == "12h" else local.strftime("%H:%M")
    return f"{local.strftime('%a %d %b')} · {clock}"


def _excerpt(text: str, n: int = 280) -> str:
    t = " ".join(str(text or "").split())
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def _brand_name(profile_name: Optional[str]) -> str:
    return (profile_name or "").strip() or "Your company"


async def _company_name(db: AsyncSession) -> str:
    from app.models.models import CompanyProfile

    prof = (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()
    return _brand_name(prof.name if prof else "")


async def _send(db: AsyncSession, to: str, subject: str, html_body: str, text_body: str) -> Dict[str, Any]:
    from app.services.calendar_service import calendar_service

    try:
        return await calendar_service.send_outbound_email(db, to, subject, html_body, text_body=text_body)
    except Exception as err:  # never let mail break publishing
        logger.warning(f"[Approval mail] send to {to} failed: {err}")
        return {"ok": False, "error": str(err)[:300]}


def _log_row(req_id: str, kind: str, to: str, subject: str, post_ids: List[str], res: Dict[str, Any], extra: Optional[Dict[str, Any]] = None) -> SocialEmail:
    return SocialEmail(
        id=req_id,
        post_id=post_ids[0] if post_ids else "",
        subject=subject[:250],
        from_addr=str(res.get("from") or ""),
        to_addr=to,
        date=datetime.utcnow().isoformat() + "Z",
        status="sent" if res.get("ok") else "failed",
        post_data={"kind": kind, "postIds": post_ids, "error": None if res.get("ok") else res.get("error"), **(extra or {})},
    )


def _page(title: str, body: str) -> str:
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>
body{{margin:0;background:#F8F7F4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#12141C}}
.wrap{{max-width:680px;margin:0 auto;padding:24px 16px 48px}}
h1{{font-size:20px;margin:0 0 4px}} .sub{{color:#5B6170;font-size:13px;margin-bottom:18px}}
.card{{background:#fff;border:1px solid #E6E3DC;border-radius:14px;padding:14px;margin-bottom:14px}}
.meta{{font-size:12px;color:#5B6170;margin-bottom:6px}} .head{{font-weight:700;font-size:15px;margin-bottom:8px}}
.cap{{white-space:pre-wrap;font-size:14px;line-height:1.5;margin-top:10px}}
img{{max-width:100%;border-radius:10px;display:block;background:#0f1115}}
.row{{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:flex-start}}
button{{height:40px;padding:0 16px;border-radius:10px;border:1px solid #E6E3DC;background:#fff;font-weight:700;font-size:14px;cursor:pointer}}
.ok{{background:#12141C;color:#fff;border-color:#12141C}} .no{{color:#B42318;border-color:#F3D1CD}}
textarea{{width:100%;box-sizing:border-box;border:1px solid #E6E3DC;border-radius:10px;padding:8px;font:inherit;font-size:13px}}
.pill{{display:inline-block;font-size:12px;font-weight:700;border-radius:99px;padding:3px 10px;background:#F1EFEA}}
.good{{color:#0F766E}} .bad{{color:#B42318}}
details summary{{cursor:pointer;color:#B42318;font-weight:700;font-size:14px;margin-top:4px}}
</style></head><body><div class="wrap">{body}</div></body></html>"""


# ── Approval requests ───────────────────────────────────────────────────────

async def _schedules_for(db: AsyncSession, posts: List[SocialPost]) -> Dict[str, SocialSchedule]:
    ids = {p.schedule_id for p in posts if p.schedule_id}
    if not ids:
        return {}
    rows = (await db.execute(select(SocialSchedule).where(SocialSchedule.id.in_(ids)))).scalars().all()
    return {s.id: s for s in rows}


def _by_recipient(posts: List[SocialPost], schedules: Dict[str, SocialSchedule], org_emails: List[str], field: str) -> Dict[str, List[SocialPost]]:
    """email -> posts. A schedule's own list (approvers or results) replaces the organisation's."""
    out: Dict[str, List[SocialPost]] = {}
    for p in posts:
        sched = schedules.get(p.schedule_id or "")
        emails = (getattr(sched, field, None) or []) if sched else []
        for email in emails or org_emails:
            out.setdefault(email, []).append(p)
    return out


async def request_approvals(db: AsyncSession, now_ms: float, due_of: Callable[[SocialPost], float], public_base: str, force: bool = False) -> int:
    """Email the approvers about posts ready for review. Returns how many posts were sent."""
    org = await load_org(db)
    rows = (await db.execute(
        select(SocialPost).where(SocialPost.status == WAITING, SocialPost.approval_requested_at.is_(None))
    )).scalars().all()
    # "Right now" posts are due already; they go out as soon as someone approves them.
    ready = [p for p in rows if needs_review(p) and (p.asap or (due_of(p) or float("inf")) > now_ms)]
    schedules = await _schedules_for(db, ready)
    recipients = _by_recipient(ready, schedules, org["approverEmails"], "approver_emails")
    ready = [p for p in ready if any(p in ps for ps in recipients.values())]
    if not ready:
        return 0
    now = time.time()
    last_change = max(_changed_at.setdefault(p.id, now) for p in ready)
    urgent = any((due_of(p) or float("inf")) - now_ms < URGENT_MS for p in ready)
    if not (force or urgent) and now - last_change < BATCH_WAIT_S:
        return 0
    for p in ready:
        _changed_at.pop(p.id, None)

    stamp = datetime.utcnow().replace(microsecond=0)
    for p in ready:
        p.approval_requested_at = stamp
    company = await _company_name(db)
    for email, posts in recipients.items():
        posts = sorted(posts, key=lambda p: due_of(p) or 0)
        n = len(posts)
        subject = f"{company}: {n} post{'s' if n != 1 else ''} waiting for your approval"
        req_id = f"apr_{uuid.uuid4().hex[:16]}"
        token = sign({"r": req_id, "m": email, "x": int(time.time()) + LINK_TTL_S})
        link = f"{public_base.rstrip('/')}/api/scheduler/review?t={token}"
        html_body, text_body = _approval_email(company, posts, link, org, due_of)
        res = await _send(db, email, subject, html_body, text_body)
        db.add(_log_row(req_id, "approval", email, subject, [p.id for p in posts], res, {"requestedAt": stamp.isoformat()}))
    await db.commit()
    logger.info(f"[Approval mail] Asked {len(recipients)} approver(s) to review {len(ready)} post(s).")
    return len(ready)


def _approval_email(company: str, posts: List[SocialPost], link: str, org: Dict[str, Any], due_of) -> tuple:
    items = []
    lines = []
    for p in posts[:40]:
        when = _when(due_of(p), org["timezone"], org["timeFormat"])
        img = f'<img src="{html.escape(p.image_url)}" width="96" style="width:96px;border-radius:8px;display:block">' if (p.image_url or "").startswith("http") else ""
        img_cell = f'<td style="padding:10px 0;border-top:1px solid #eee;vertical-align:top;width:104px">{img}</td>' if img else ""
        items.append(
            f'<tr>{img_cell}<td colspan="{1 if img else 2}" style="padding:10px 0 10px {8 if img else 0}px;border-top:1px solid #eee;vertical-align:top">'
            f'<div style="font-size:12px;color:#5B6170">{html.escape(_channel(p))} · {html.escape(when)}</div>'
            f'<div style="font-weight:700;font-size:14px;margin:2px 0 4px">{html.escape(p.title or "Post")}</div>'
            f'<div style="font-size:13px;color:#333">{html.escape(_excerpt(p.copy))}</div></td></tr>'
        )
        lines.append(f"- {_channel(p)} · {when}: {p.title or 'Post'}")
    more = len(posts) - 40
    if more > 0:
        items.append(f'<tr><td colspan="2" style="padding:10px 0;color:#5B6170">…and {more} more on the review page.</td></tr>')
        lines.append(f"...and {more} more")
    html_body = f"""<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#12141C;max-width:620px">
<h2 style="font-size:18px;margin:0 0 6px">{len(posts)} post{'s' if len(posts) != 1 else ''} waiting for approval</h2>
<p style="font-size:14px;color:#5B6170;margin:0 0 14px">Nothing goes live until it is approved. Posts not approved by their publish time are skipped.</p>
<p><a href="{html.escape(link)}" style="display:inline-block;background:#12141C;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:10px">Review and approve</a></p>
<table style="width:100%;border-collapse:collapse">{''.join(items)}</table>
<p style="font-size:12px;color:#8A8F9C;margin-top:18px">Sent by the {html.escape(company)} post scheduler. Times in {html.escape(org['timezone'])}.</p></div>"""
    text_body = (
        f"{len(posts)} post(s) waiting for approval at {company}.\n\nReview and approve: {link}\n\n"
        + "\n".join(lines)
        + "\n\nNothing goes live until it is approved. Posts not approved by their publish time are skipped."
    )
    return html_body, text_body


# ── Review page ─────────────────────────────────────────────────────────────

async def _request(db: AsyncSession, token: str):
    data = verify(token)
    if not data:
        return None, None
    row = (await db.execute(select(SocialEmail).where(SocialEmail.id == str(data.get("r") or "")))).scalars().first()
    if not row or (row.post_data or {}).get("kind") != "approval":
        return None, None
    return data, row


def _post_state(post: Optional[SocialPost], requested_at: str) -> str:
    """Why a post in this email can or cannot be acted on from it."""
    if not post:
        return "gone"
    stamp = post.approval_requested_at.isoformat() if post.approval_requested_at else ""
    if post.status == WAITING and stamp == requested_at:
        return "waiting"
    if post.status == WAITING:
        return "changed"
    return post.status or ""


def _state_text(post: SocialPost, state: str) -> str:
    if state == "gone":
        return '<span class="pill bad">Deleted</span>'
    if state == "changed":
        return '<span class="pill">Changed since this email. A newer email has it.</span>'
    if state in APPROVED_STATES:
        by = html.escape(post.approved_by or "")
        return f'<span class="pill good">Approved{(" by " + by) if by and by != "app" else ""}</span>'
    if state == REJECTED:
        note = html.escape(post.review_note or "")
        return f'<span class="pill bad">Rejected</span>{("<div class=meta style=margin-top:6px>" + note + "</div>") if note else ""}'
    if state == MISSED:
        return '<span class="pill bad">Publish time passed before approval</span>'
    if state == "published":
        return '<span class="pill good">Posted</span>'
    if state == "publishing":
        return '<span class="pill">Posting now</span>'
    if state == "failed":
        return '<span class="pill bad">Approved, but publishing failed</span>'
    return f'<span class="pill">{html.escape(state)}</span>'


async def review_page(db: AsyncSession, token: str, due_of, notice: str = "") -> str:
    data, row = await _request(db, token)
    if not row:
        return _page("Link not valid", "<h1>This link is no longer valid</h1><div class='sub'>It has expired or was changed. Open the post scheduler to review posts, or use the newest approval email.</div>")
    ids = list((row.post_data or {}).get("postIds") or [])
    requested_at = str((row.post_data or {}).get("requestedAt") or "")
    posts = {p.id: p for p in (await db.execute(select(SocialPost).where(SocialPost.id.in_(ids)))).scalars().all()}
    org = await load_org(db)
    company = await _company_name(db)
    esc_t = html.escape(token)
    cards = []
    waiting = 0
    for pid in ids:
        p = posts.get(pid)
        state = _post_state(p, requested_at)
        if not p:
            continue
        when = _when(due_of(p), org["timezone"], org["timeFormat"])
        img = f'<img src="{html.escape(p.image_url)}" alt="">' if (p.image_url or "").startswith("http") else ""
        if state == "waiting":
            waiting += 1
            actions = f"""<div class="row">
<form method="post" action="review"><input type="hidden" name="t" value="{esc_t}"><input type="hidden" name="post" value="{html.escape(pid)}"><input type="hidden" name="action" value="approve"><button class="ok" type="submit">Approve</button></form>
</div>
<details><summary>Reject…</summary><form method="post" action="review" style="margin-top:8px"><input type="hidden" name="t" value="{esc_t}"><input type="hidden" name="post" value="{html.escape(pid)}"><input type="hidden" name="action" value="reject">
<textarea name="note" rows="2" placeholder="What should change? (optional)"></textarea><div class="row"><button class="no" type="submit">Reject</button></div></form></details>"""
        else:
            actions = f'<div class="row">{_state_text(p, state)}</div>'
        cards.append(
            f'<div class="card"><div class="meta">{html.escape(_channel(p))} · {html.escape(when)}</div>'
            f'<div class="head">{html.escape(p.title or "Post")}</div>{img}'
            f'<div class="cap">{html.escape(p.copy or "")}</div>{actions}</div>'
        )
    approve_all = ""
    if waiting > 1:
        approve_all = f"""<form method="post" action="review" style="margin-bottom:16px"><input type="hidden" name="t" value="{esc_t}"><input type="hidden" name="post" value="all"><input type="hidden" name="action" value="approve"><button class="ok" type="submit">Approve all {waiting} waiting posts</button></form>"""
    banner = f'<div class="card" style="border-color:#0F766E"><strong>{html.escape(notice)}</strong></div>' if notice else ""
    body = (
        f"<h1>Posts for approval</h1><div class='sub'>{html.escape(company)} · reviewing as {html.escape(str(data.get('m') or ''))} · times in {html.escape(org['timezone'])}</div>"
        f"{banner}{approve_all}{''.join(cards) or '<div class=card>Nothing left to review in this email.</div>'}"
    )
    return _page("Posts for approval", body)


async def review_action(db: AsyncSession, token: str, action: str, post_id: str, note: str) -> str:
    """Apply an approve/reject from the review page. Returns a short notice."""
    data, row = await _request(db, token)
    if not row:
        return ""
    ids = list((row.post_data or {}).get("postIds") or [])
    requested_at = str((row.post_data or {}).get("requestedAt") or "")
    targets = ids if post_id == "all" else [post_id] if post_id in ids else []
    posts = (await db.execute(select(SocialPost).where(SocialPost.id.in_(targets)))).scalars().all() if targets else []
    who = str(data.get("m") or "email")
    done = 0
    for p in posts:
        if _post_state(p, requested_at) != "waiting":
            continue
        if action == "approve":
            p.status = "approved"
            p.approved_by = who
            p.approved_at = datetime.utcnow()
            p.review_note = None
        elif action == "reject":
            p.status = REJECTED
            p.approved_by = None
            p.approved_at = None
            p.review_note = (f"{who}: " + note.strip()[:1000]) if note.strip() else f"Rejected by {who}"
        else:
            continue
        done += 1
    if not done:
        return "Nothing changed: those posts were already handled or changed since this email."
    row.status = "acted"
    await db.commit()
    verb = "Approved" if action == "approve" else "Rejected"
    return f"{verb} {done} post{'s' if done != 1 else ''}."


# ── Results ─────────────────────────────────────────────────────────────────

async def send_results(db: AsyncSession, published: List[SocialPost], failed: List[SocialPost], missed: List[SocialPost], due_of) -> None:
    """One email per publishing round that did something, to every approver."""
    if not (published or failed or missed):
        return
    org = await load_org(db)
    schedules = await _schedules_for(db, published + failed + missed)
    recipients = _by_recipient(published + failed + missed, schedules, org["approverEmails"], "result_emails")
    company = await _company_name(db)
    for email, posts in recipients.items():
        mine = set(p.id for p in posts)
        await _send_result(
            db, email, company, org, due_of,
            [p for p in published if p.id in mine], [p for p in failed if p.id in mine], [p for p in missed if p.id in mine],
        )
    await db.commit()


async def _send_result(db: AsyncSession, email: str, company: str, org: Dict[str, Any], due_of,
                       published: List[SocialPost], failed: List[SocialPost], missed: List[SocialPost]) -> None:
    parts = []
    if published:
        parts.append(f"{len(published)} posted")
    if failed:
        parts.append(f"{len(failed)} failed")
    if missed:
        parts.append(f"{len(missed)} missed approval")
    subject = f"{company} posts: " + ", ".join(parts)

    def block(title: str, posts: List[SocialPost], colour: str, detail) -> str:
        if not posts:
            return ""
        rows = "".join(
            f'<li style="margin-bottom:6px"><strong>{html.escape(p.title or "Post")}</strong> '
            f'<span style="color:#5B6170">({html.escape(_channel(p))} · {html.escape(_when(due_of(p), org["timezone"], org["timeFormat"]))})</span>'
            f'{detail(p)}</li>'
            for p in posts[:50]
        )
        return f'<h3 style="font-size:15px;color:{colour};margin:16px 0 6px">{title}</h3><ul style="padding-left:18px;margin:0">{rows}</ul>'

    def err(p: SocialPost) -> str:
        errs = [str(r.get("error")) for r in (p.publish_results or []) if isinstance(r, dict) and not r.get("ok") and r.get("error")]
        return f'<div style="color:#B42318;font-size:12px">{html.escape("; ".join(errs)[:300])}</div>' if errs else ""

    def links(p: SocialPost) -> str:
        urls = [str(r.get("url")) for r in (p.publish_results or []) if isinstance(r, dict) and r.get("ok") and r.get("url")]
        return "".join(f' <a href="{html.escape(u)}">View</a>' for u in urls[:3])

    html_body = (
        '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#12141C;max-width:620px">'
        + block("Posted", published, "#0F766E", links)
        + block("Failed", failed, "#B42318", err)
        + block("Missed: not approved before the publish time", missed, "#B45309", lambda p: "")
        + '<p style="font-size:12px;color:#8A8F9C;margin-top:18px">Open the post scheduler to retry, reschedule or approve.</p></div>'
    )
    text_body = "\n".join(
        [f"Posted: {p.title}" for p in published]
        + [f"Failed: {p.title}" for p in failed]
        + [f"Missed approval: {p.title}" for p in missed]
    )
    res = await _send(db, email, subject, html_body, text_body)
    db.add(_log_row(f"res_{uuid.uuid4().hex[:16]}", "result", email, subject, [p.id for p in published + failed + missed], res))


# ── Schedule end reminder ───────────────────────────────────────────────────

EXTEND_MONTHS = 3


async def send_schedule_reminder(db: AsyncSession, s: SocialSchedule, public_base: str, tz: str) -> None:
    """Two weeks before a repeating schedule ends: ask whether to keep it going. If nobody
    answers, it simply ends on its end date."""
    org = await load_org(db)
    to = (s.result_emails or []) or (s.approver_emails or []) or org["approverEmails"]
    if not to:
        return
    company = await _company_name(db)
    subject = f"{company}: schedule \"{s.theme}\" ends on {s.end_date}"
    for email in to:
        token = sign({"s": s.id, "e": s.end_date, "m": email, "x": int(time.time()) + LINK_TTL_S})
        link = f"{public_base.rstrip('/')}/api/scheduler/schedule-extend?t={token}"
        html_body = (
            '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#12141C;max-width:620px">'
            f'<h2 style="font-size:18px;margin:0 0 6px">"{html.escape(s.theme)}" ends on {html.escape(s.end_date or "")}</h2>'
            '<p style="font-size:14px;color:#5B6170">After that no new posts are made for it. Posts already made stay as they are.</p>'
            f'<p><a href="{html.escape(link)}" style="display:inline-block;background:#12141C;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:10px">Keep it going {EXTEND_MONTHS} more months</a></p>'
            '<p style="font-size:12px;color:#8A8F9C">Do nothing to let it end. You can also change the end date in the post scheduler.</p></div>'
        )
        text_body = f'"{s.theme}" ends on {s.end_date}. Keep it going {EXTEND_MONTHS} more months: {link}\nDo nothing to let it end.'
        res = await _send(db, email, subject, html_body, text_body)
        db.add(_log_row(f"rem_{uuid.uuid4().hex[:16]}", "reminder", email, subject, [], res, {"scheduleId": s.id}))


async def _extend_target(db: AsyncSession, token: str):
    data = verify(token)
    if not data or not data.get("s"):
        return None, None
    s = (await db.execute(select(SocialSchedule).where(SocialSchedule.id == str(data["s"])))).scalars().first()
    return data, s


async def extend_page(db: AsyncSession, token: str, notice: str = "") -> str:
    data, s = await _extend_target(db, token)
    if not s:
        return _page("Link not valid", "<h1>This link is no longer valid</h1><div class='sub'>The schedule was deleted or the link expired.</div>")
    banner = f'<div class="card" style="border-color:#0F766E"><strong>{html.escape(notice)}</strong></div>' if notice else ""
    if s.end_date != data.get("e"):
        action = f"<div class='card'>This schedule now ends on {html.escape(s.end_date or '')}. Nothing to do here.</div>"
    else:
        from app.services.schedule_engine import add_months, parse_date

        new_end = add_months(parse_date(s.end_date), EXTEND_MONTHS).isoformat()
        action = (
            f"<div class='card'>Ends on <strong>{html.escape(s.end_date or '')}</strong>. Keep it going until {new_end}?"
            f"<form method='post' action='schedule-extend' class='row'><input type='hidden' name='t' value='{html.escape(token)}'>"
            f"<button class='ok' type='submit'>Keep it going until {new_end}</button></form></div>"
        )
    return _page("Keep the schedule going", f"<h1>{html.escape(s.theme)}</h1><div class='sub'>{html.escape(s.focus or '')[:300]}</div>{banner}{action}")


async def extend_action(db: AsyncSession, token: str) -> str:
    from app.services.schedule_engine import add_months, parse_date

    data, s = await _extend_target(db, token)
    if not s or s.end_date != data.get("e"):
        return ""
    s.end_date = add_months(parse_date(s.end_date), EXTEND_MONTHS).isoformat()
    s.reminder_sent_at = None
    if s.status == "ended":
        s.status = "active"
        s.ended_reason = None
    await db.commit()
    return f"Done. It now runs until {s.end_date}."


async def mail_status(db: AsyncSession) -> Dict[str, Any]:
    """Latest approval email outcome, for the Approvals window."""
    org = await load_org(db)
    rows = (await db.execute(select(SocialEmail).order_by(SocialEmail.created_at.desc()).limit(30))).scalars().all()
    last = next((r for r in rows if (r.post_data or {}).get("kind") == "approval"), None)
    failed = [r for r in rows if (r.post_data or {}).get("kind") == "approval" and r.status == "failed" and last and r.post_data.get("requestedAt") == last.post_data.get("requestedAt")]
    return {
        "approvers": org["approverEmails"],
        "lastSentAt": (last.date if last else None),
        "lastPosts": len((last.post_data or {}).get("postIds") or []) if last else 0,
        "failed": [{"to": r.to_addr, "error": (r.post_data or {}).get("error") or "Not sent"} for r in failed],
    }
