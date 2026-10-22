"""Results reports for clients and managers: the same numbers as Insights, as an email and a web page.

A report covers the last 7, 30 or 90 days for some or all channels. It can be sent now, every Monday
or on the 1st of each month (08:00 in the company's time zone), and opened with a link that needs no
sign-in (it shows the latest numbers each time). Only numbers the networks reported are shown; a
figure a network does not share is marked as such, never shown as 0.
"""
from __future__ import annotations

import html
import logging
import time
import uuid
import zoneinfo
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import CompanyProfile, SocialPostMetric, SocialReport, SocialReportRun
from app.services.social_publisher import TITLES, normalize_platform

logger = logging.getLogger("social_reports")

WINDOWS = (7, 30, 90)
FREQUENCIES = ("none", "weekly", "monthly")
SEND_HOUR = 8
LINK_TTL_S = 120 * 24 * 3600
MAX_RECIPIENTS = 20
e = html.escape


def view(r: SocialReport) -> Dict[str, Any]:
    return {"id": r.id, "name": r.name or "", "days": r.days or 30, "channels": r.channels or [], "accountIds": r.account_ids or [],
            "recipients": r.recipients or [], "frequency": r.frequency or "none", "intro": r.intro or "",
            "lastSentAt": r.last_sent_at.isoformat() + "Z" if r.last_sent_at else None,
            "createdAt": r.created_at.isoformat() + "Z" if r.created_at else None}


def clean(payload: Dict[str, Any], row: Optional[SocialReport] = None) -> Dict[str, Any]:
    """Validated fields from the editor. Raises ValueError in plain words."""
    from app.services.org_settings import clean_emails

    out: Dict[str, Any] = {}
    name = str(payload.get("name", row.name if row else "") or "").strip()
    if not name:
        raise ValueError("Give the report a name, for example the client's name.")
    out["name"] = name[:120]
    days = int(payload.get("days", row.days if row else 30) or 30)
    if days not in WINDOWS:
        raise ValueError("Pick 7, 30 or 90 days.")
    out["days"] = days
    chans = [normalize_platform(c) for c in (payload.get("channels", row.channels if row else []) or [])]
    unknown = [c for c in chans if c not in TITLES]
    if unknown:
        raise ValueError(f"Unknown channel: {', '.join(unknown)}.")
    out["channels"] = list(dict.fromkeys(chans))
    out["account_ids"] = [str(a) for a in (payload.get("accountIds", row.account_ids if row else []) or [])][:20]
    raw = payload.get("recipients", row.recipients if row else [])
    emails = clean_emails(raw)
    if isinstance(raw, list) and len({str(x).strip().lower() for x in raw if str(x).strip()}) != len(emails):
        raise ValueError("One of the email addresses is not valid.")
    if len(emails) > MAX_RECIPIENTS:
        raise ValueError(f"Up to {MAX_RECIPIENTS} people can get a report.")
    out["recipients"] = emails
    freq = str(payload.get("frequency", row.frequency if row else "none") or "none")
    if freq not in FREQUENCIES:
        raise ValueError("Send it never, weekly or monthly.")
    if freq != "none" and not emails:
        raise ValueError("Add who should get it before choosing weekly or monthly.")
    out["frequency"] = freq
    out["intro"] = str(payload.get("intro", row.intro if row else "") or "").strip()[:2000]
    return out


async def company(db: AsyncSession) -> str:
    prof = (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()
    return ((prof.name if prof else "") or "Your company").strip()


async def build(db: AsyncSession, rep: SocialReport) -> Dict[str, Any]:
    """The numbers for one report, from the same calculations as the Insights page."""
    from app.api.scheduler_insights import _post_outcomes, insights
    from app.services.org_settings import org_timezone

    chans, accs = list(rep.channels or []), list(rep.account_ids or [])
    data = await insights(days=rep.days or 30, channel=",".join(chans), account=",".join(accs), db=db)
    since = datetime.utcnow() - timedelta(days=rep.days or 30)
    q = select(SocialPostMetric.post_id, SocialPostMetric.platform).where(SocialPostMetric.published_at >= since)
    if chans:
        q = q.where(SocialPostMetric.platform.in_(chans))
    if accs:
        q = q.where(SocialPostMetric.account_id.in_(accs))
    pairs = (await db.execute(q)).all()
    outcomes = await _post_outcomes(db, list({p for p, _ in pairs}))
    per_channel = []
    for ch in chans or sorted({c for _, c in pairs}):
        d = await insights(days=rep.days or 30, channel=ch, account=",".join(accs), db=db)
        per_channel.append({"channel": ch, "totals": d["totals"], "changes": d["changes"]})
    tz = await org_timezone(db)
    end = datetime.now(zoneinfo.ZoneInfo(tz)).date()
    start = end - timedelta(days=(rep.days or 30) - 1)
    return {**data, "perChannel": per_channel, "leads": sum(o["leads"] for o in outcomes.values()),
            "meetings": sum(o["meetings"] for o in outcomes.values()), "start": start.isoformat(), "end": end.isoformat(),
            "company": await company(db)}


def _n(v: Any) -> str:
    if v is None:
        return "—"
    if isinstance(v, float) and not v.is_integer():
        return f"{v:,.2f}"
    return f"{int(v):,}"


def _change(pct: Optional[float], days: int) -> str:
    if pct is None:
        return ""
    sign = "+" if pct > 0 else ""
    color = "#0F766E" if pct > 0 else ("#B42318" if pct < 0 else "#6B7280")
    return f'<div style="font-size:12px;color:{color};margin-top:2px">{sign}{pct:g}% vs previous {days} days</div>'


def period_label(data: Dict[str, Any]) -> str:
    a, b = datetime.fromisoformat(data["start"]), datetime.fromisoformat(data["end"])
    if a.year == b.year:
        return f"{a.day} {a:%b} – {b.day} {b:%b %Y}" if a.month != b.month else f"{a.day}–{b.day} {b:%b %Y}"
    return f"{a.day} {a:%b %Y} – {b.day} {b:%b %Y}"


def stamp(iso: Optional[str], tz: str) -> str:
    """A UTC moment as 'd Mon yyyy, hh:mm' in the company's time zone, with the zone named."""
    if not iso:
        return ""
    try:
        zone = zoneinfo.ZoneInfo(tz or "UTC")
        dt = datetime.fromisoformat(iso.rstrip("Z")).replace(tzinfo=zoneinfo.ZoneInfo("UTC")).astimezone(zone)
        return f"{dt.day} {dt:%b %Y}, {dt:%H:%M} ({tz})"
    except (ValueError, zoneinfo.ZoneInfoNotFoundError):
        return ""


def link_day(ts: Optional[int], tz: str) -> str:
    """The day a link stops working, as 'd Mon yyyy' in the company's time zone."""
    if not ts:
        return ""
    try:
        dt = datetime.fromtimestamp(int(ts), zoneinfo.ZoneInfo(tz or "UTC"))
        return f"{dt.day} {dt:%b %Y}"
    except (ValueError, OSError, zoneinfo.ZoneInfoNotFoundError):
        return ""


def new_link_expiry() -> int:
    return int(time.time()) + LINK_TTL_S


def asof_line(read_at: Optional[str], tz: str, live: bool = False, expires: Optional[int] = None) -> str:
    """What the numbers in a report are as of. They are the networks' own, read at intervals, and they keep changing."""
    made = stamp(datetime.utcnow().isoformat(), tz)
    read = stamp(read_at, tz)
    first = (f"Numbers as of {read}, the last time they were read from the networks."
             if read else "No numbers have been read from the networks yet.")
    tail = "They may have changed since." + (" Opening this link again shows the latest." if live else " The full report link always shows the latest.")
    until = link_day(expires, tz)
    return f"{first} {tail} Made {made}." + (f" This link works until {until}." if until else "")


def sections(rep: SocialReport, data: Dict[str, Any]) -> str:
    """The report body as email-safe HTML (tables and inline styles)."""
    t, ch, days = data["totals"], data["changes"], rep.days or 30
    tiles = [
        ("Posts published", _n(t.get("posts")), ""),
        ("Reach", _n(t.get("reach")), _change(ch.get("reach"), days)),
        ("Views", _n(t.get("impressions")), _change(ch.get("impressions"), days)),
        ("Engagements", _n(t.get("engagements")), _change(ch.get("engagements"), days)),
        ("Engagement rate", (f"{t['engagementRate']:g}%" if t.get("engagementRate") is not None else "—"), ""),
        ("Link clicks", _n(t.get("linkClicks")), _change(ch.get("linkClicks"), days)),
    ]
    if data.get("leads") or data.get("meetings"):
        tiles.append(("Leads", _n(data.get("leads")), ""))
        tiles.append(("Meetings booked", _n(data.get("meetings")), ""))
    rows_html = ""
    for i in range(0, len(tiles), 2):
        cells = ""
        for label, value, change in tiles[i:i + 2]:
            cells += (f'<td width="50%" valign="top" style="padding:12px 14px;background:#F4F6FB;border-radius:12px">'
                      f'<div style="font-size:12px;color:#6B7280">{e(label)}</div>'
                      f'<div style="font-size:22px;font-weight:700;color:#12141C;margin-top:2px">{value}</div>{change}</td>')
        rows_html += f"<tr>{cells}</tr>"
    out = (f'<table role="presentation" width="100%" cellspacing="8" cellpadding="0" border="0" '
           f'style="margin:4px -8px 8px;width:calc(100% + 16px)">{rows_html}</table>')

    th = 'style="text-align:left;font-size:11px;color:#6B7280;font-weight:700;padding:6px 8px;border-bottom:1px solid #E5E7EB"'
    td = 'style="font-size:13px;color:#12141C;padding:8px;border-bottom:1px solid #F0F1F4"'
    num = 'style="font-size:13px;color:#12141C;padding:8px;border-bottom:1px solid #F0F1F4;text-align:right;white-space:nowrap"'
    if data.get("perChannel"):
        body = "".join(
            f'<tr><td {td}>{e(TITLES.get(c["channel"], c["channel"]))}</td><td {num}>{_n(c["totals"].get("posts"))}</td>'
            f'<td {num}>{_n(c["totals"].get("reach") if c["totals"].get("reach") is not None else c["totals"].get("impressions"))}</td>'
            f'<td {num}>{_n(c["totals"].get("engagements"))}</td><td {num}>{_n(c["totals"].get("linkClicks"))}</td></tr>'
            for c in data["perChannel"])
        out += (f'<h2 style="font-size:16px;margin:22px 0 8px;color:#12141C">By channel</h2>'
                f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">'
                f'<tr><th {th}>Channel</th><th {th}>Posts</th><th {th}>Reach or views</th><th {th}>Engagements</th>'
                f'<th {th}>Link clicks</th></tr>{body}</table>')
    top = data.get("top") or []
    if top:
        body = ""
        for p in top[:5]:
            title = e(p.get("title") or "Post")
            link = f'<a href="{e(p["url"], quote=True)}" style="color:#3457D5;text-decoration:none">{title}</a>' if p.get("url") else title
            body += (f'<tr><td {td}>{link}<div style="font-size:11px;color:#6B7280">{e(TITLES.get(p.get("channel"), p.get("channel") or ""))}</div></td>'
                     f'<td {num}>{_n(p.get("reach") if p.get("reach") is not None else p.get("impressions"))}</td>'
                     f'<td {num}>{_n(p.get("engagements"))}</td><td {num}>{_n(p.get("linkClicks"))}</td></tr>')
        out += (f'<h2 style="font-size:16px;margin:22px 0 8px;color:#12141C">Best posts</h2>'
                f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">'
                f'<tr><th {th}>Post</th><th {th}>Reach or views</th><th {th}>Engagements</th><th {th}>Link clicks</th></tr>{body}</table>')
    followers = [f for f in data.get("followers") or [] if f.get("followers") is not None]
    if followers:
        body = "".join(
            f'<tr><td {td}>{e(TITLES.get(f["platform"], f["platform"]))} · {e(f.get("handle") or "")}</td>'
            f'<td {num}>{_n(f["followers"])}</td><td {num}>{("+" if (f.get("change") or 0) > 0 else "") + _n(f.get("change")) if f.get("change") is not None else "—"}</td></tr>'
            for f in followers)
        out += (f'<h2 style="font-size:16px;margin:22px 0 8px;color:#12141C">Followers</h2>'
                f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">'
                f'<tr><th {th}>Account</th><th {th}>Followers</th><th {th}>Change</th></tr>{body}</table>')
    if not top and not data.get("perChannel"):
        out += '<p style="font-size:14px;color:#6B7280">No published posts with results in this period yet.</p>'
    # Connection problems (reconnect this account, a network error) are for the account owner and stay on Insights.
    out += '<p style="font-size:12px;color:#8A8F9C;margin:10px 0 0">— means the network does not share that number.</p>'
    return out


def page(rep: SocialReport, data: Dict[str, Any], expires: Optional[int] = None) -> str:
    """The report as a web page anyone with the link can open and print (or save as PDF)."""
    intro = f'<p class="intro">{e(rep.intro)}</p>' if rep.intro else ""
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(data['company'])} · {e(rep.name or 'Social report')}</title>
<style>
  :root {{ color-scheme: light; }}
  body {{ margin:0; background:#EEF1F8; font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif; color:#12141C; }}
  main {{ max-width:760px; margin:0 auto; padding:28px 16px 48px; }}
  .card {{ background:#fff; border-radius:18px; padding:28px; box-shadow:0 10px 30px rgba(38,64,158,.10); }}
  h1 {{ font-size:24px; margin:0 0 4px; letter-spacing:-.3px; }}
  .sub {{ color:#6B7280; font-size:14px; margin-bottom:18px; }}
  .asof {{ font-size:13px; line-height:1.5; color:#3B4252; background:#F4F6FB; border-radius:10px; padding:10px 12px; margin:0 0 14px; }}
  .intro {{ font-size:15px; line-height:1.6; color:#3B4252; margin:0 0 12px; white-space:pre-wrap; }}
  .bar {{ display:flex; gap:8px; justify-content:flex-end; margin-bottom:12px; }}
  button {{ font:inherit; font-size:13px; font-weight:700; border:1px solid #D0D5DD; background:#fff; border-radius:10px; padding:8px 14px; cursor:pointer; }}
  button:focus-visible {{ outline:3px solid #3457D5; outline-offset:2px; }}
  table {{ border-collapse:separate; }}
  @media (max-width:520px) {{ .card {{ padding:16px; }} h1 {{ font-size:20px; }} }}
  @media print {{ body {{ background:#fff; }} .bar {{ display:none; }} .card {{ box-shadow:none; padding:0; }} main {{ padding:0; }} }}
</style></head><body><main>
<div class="bar"><button type="button" onclick="window.print()">Print or save as PDF</button></div>
<div class="card">
<h1>{e(data['company'])}: {e(rep.name or 'Social report')}</h1>
<div class="sub">Social media results for {e(period_label(data))}.</div>
<p class="asof"><b>Live page.</b> {e(asof_line(data.get('lastSyncedAt'), data.get('timezone') or 'UTC', live=True, expires=expires))}
A copy that was emailed or printed keeps the numbers from the time it was made.</p>
{intro}{sections(rep, data)}
</div></main></body></html>"""


def share_url(rep: SocialReport, org_id: str) -> str:
    from app.public_api import links

    return f"{links.public_base()}/api/scheduler/report-view?t={links.make_token('social_report', rep.id, org_id, LINK_TTL_S)}"


def run_view(r: SocialReportRun) -> Dict[str, Any]:
    return {"id": r.id, "reportId": r.report_id, "reportName": r.report_name or "", "recipients": r.recipients or [],
            "sent": r.sent or 0, "failed": r.failed or 0, "error": r.error or "", "trigger": r.trigger or "manual",
            "at": r.created_at.isoformat() + "Z" if r.created_at else None}


async def send(db: AsyncSession, rep: SocialReport, org_id: str, to: Optional[List[str]] = None, trigger: str = "manual") -> Dict[str, Any]:
    """Email the report and note the attempt in its history. Returns {sent, failed, error}."""
    recipients = to if to is not None else list(rep.recipients or [])
    res = await _deliver(db, rep, org_id, recipients)
    if recipients:
        db.add(SocialReportRun(id=f"run_{uuid.uuid4().hex[:10]}", report_id=rep.id, report_name=rep.name or "", recipients=recipients,
                               sent=res["sent"], failed=res["failed"], error=res["error"], trigger=trigger))
        from app.services import feed

        who = "Scheduled report" if trigger == "schedule" else "Report"
        if res["sent"]:
            feed.add(db, f"{who} “{rep.name}” was emailed to {feed.plural(res['sent'], 'person', 'people')}.", "success")
        else:
            feed.add(db, f"{who} “{rep.name}” could not be sent. {res['error']}", "alert")
        await db.commit()
    return res


async def _deliver(db: AsyncSession, rep: SocialReport, org_id: str, recipients: List[str]) -> Dict[str, Any]:
    from app.core import mailer

    if not recipients:
        return {"sent": 0, "failed": 0, "error": "Add who should get the report first."}
    if not mailer.configured():
        return {"sent": 0, "failed": len(recipients), "error": "Email sending is not set up yet. Ask Outreach support."}
    data = await build(db, rep)
    period = period_label(data)
    intro = e(rep.intro).replace("\n", "<br>") if rep.intro else f"Here is how {e(data['company'])}'s social media did over {e(period)}."
    msg = mailer.render(
        f"{data['company']}: {rep.name or 'social results'}", [intro], extra_html=sections(rep, data),
        button={"label": "Open the full report", "url": share_url(rep, org_id)}, preheader=f"Social results for {period}",
        note=asof_line(data.get("lastSyncedAt"), data.get("timezone") or "UTC", expires=new_link_expiry()),
        reason=f"You are getting this because {e(data['company'])} shares its social media results with you.")
    sent = failed = 0
    for addr in recipients:
        res = await mailer.send_system_email(addr, f"{data['company']} social results: {period}", msg["html"], msg["text"])
        if res.get("ok"):
            sent += 1
        else:
            failed += 1
    if sent:
        rep.last_sent_at = datetime.utcnow()
        await db.commit()
    return {"sent": sent, "failed": failed, "error": "" if sent or not failed else "The email could not be sent. Try again later."}


def last_slot(freq: str, now_local: datetime) -> Optional[datetime]:
    """The most recent time a weekly (Monday) or monthly (1st) report was due, in local time."""
    at = now_local.replace(hour=SEND_HOUR, minute=0, second=0, microsecond=0)
    if freq == "weekly":
        slot = at - timedelta(days=at.weekday())
        return slot if slot <= now_local else slot - timedelta(days=7)
    if freq == "monthly":
        slot = at.replace(day=1)
        if slot <= now_local:
            return slot
        prev = (slot - timedelta(days=1)).replace(day=1)
        return prev
    return None


async def send_due(db: AsyncSession, org_id: str) -> int:
    """Send the weekly and monthly reports whose time has come (run hourly)."""
    from app.services.org_settings import org_timezone

    zone = zoneinfo.ZoneInfo(await org_timezone(db))
    now = datetime.now(zone)
    sent = 0
    for rep in (await db.execute(select(SocialReport).where(SocialReport.frequency.in_(["weekly", "monthly"])))).scalars().all():
        slot = last_slot(rep.frequency, now)
        if not slot or not rep.recipients:
            continue
        slot_utc = slot.astimezone(zoneinfo.ZoneInfo("UTC")).replace(tzinfo=None)
        created = rep.created_at or datetime.min
        if created >= slot_utc or (rep.last_sent_at and rep.last_sent_at >= slot_utc):
            continue
        try:
            res = await send(db, rep, org_id, trigger="schedule")
            sent += 1 if res.get("sent") else 0
        except Exception:
            logger.exception("Sending report %s failed", rep.id)
            await db.rollback()
    return sent


# ── One post's results ──────────────────────────────────────────────────────
POST_FIELDS = (("reach", "Reach"), ("impressions", "Views"), ("likes", "Likes"), ("comments", "Comments"),
               ("shares", "Shares"), ("saves", "Saves"), ("clicks", "Clicks"))


def post_share_url(post_id: str, org_id: str) -> str:
    from app.public_api import links

    return f"{links.public_base()}/api/scheduler/post-results-view?t={links.make_token('social_post_results', post_id, org_id, LINK_TTL_S)}"


def post_sections(res: Dict[str, Any]) -> str:
    """One post's numbers as email-safe HTML: the totals, then each network that carried it."""
    t = res.get("totals") or {}
    tiles = [(label, t.get(k)) for k, label in POST_FIELDS if t.get(k) is not None]
    tiles += [(label, res.get(k)) for k, label in (("linkClicks", "Tracked link clicks"), ("leads", "Leads"), ("meetings", "Meetings booked")) if res.get(k)]
    out = ""
    if tiles:
        rows = ""
        for i in range(0, len(tiles), 2):
            cells = "".join(f'<td width="50%" valign="top" style="padding:12px 14px;background:#F4F6FB;border-radius:12px">'
                            f'<div style="font-size:12px;color:#6B7280">{e(label)}</div>'
                            f'<div style="font-size:22px;font-weight:700;color:#12141C;margin-top:2px">{_n(value)}</div></td>'
                            for label, value in tiles[i:i + 2])
            rows += f"<tr>{cells}</tr>"
        out += (f'<table role="presentation" width="100%" cellspacing="8" cellpadding="0" border="0" '
                f'style="margin:4px -8px 8px;width:calc(100% + 16px)">{rows}</table>')
    else:
        out += '<p style="font-size:14px;color:#6B7280">No numbers have been read for this post yet. They arrive a few hours after it goes live.</p>'
    chans = res.get("channels") or []
    if len(chans) > 1:
        th = 'style="text-align:left;font-size:11px;color:#6B7280;font-weight:700;padding:6px 8px;border-bottom:1px solid #E5E7EB"'
        num = 'style="font-size:13px;color:#12141C;padding:8px;border-bottom:1px solid #F0F1F4;text-align:right;white-space:nowrap"'
        body = "".join(f'<tr><td style="font-size:13px;color:#12141C;padding:8px;border-bottom:1px solid #F0F1F4">{e(TITLES.get(c.get("platform"), c.get("platform") or ""))}</td>'
                       f'<td {num}>{_n(c.get("reach") if c.get("reach") is not None else c.get("impressions"))}</td>'
                       f'<td {num}>{_n(c.get("engagements"))}</td><td {num}>{_n(c.get("clicks"))}</td></tr>' for c in chans)
        out += (f'<h2 style="font-size:16px;margin:22px 0 8px;color:#12141C">By network</h2>'
                f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">'
                f'<tr><th {th}>Network</th><th {th}>Reach or views</th><th {th}>Engagements</th><th {th}>Clicks</th></tr>{body}</table>')
    links_ = [l for l in res.get("links") or [] if l.get("url")]
    if links_:
        out += '<p style="font-size:13px;margin:16px 0 0">' + " · ".join(
            f'<a href="{e(l["url"], quote=True)}" style="color:#3457D5">View on {e(TITLES.get(l.get("platform"), l.get("platform") or "the network"))}</a>' for l in links_) + "</p>"
    out += '<p style="font-size:12px;color:#8A8F9C;margin:10px 0 0">— means the network does not share that number.</p>'
    return out


def post_page(res: Dict[str, Any], company_name: str, tz: str, expires: Optional[int] = None) -> str:
    """A post's results as a web page anyone with the link can open (it shows the latest numbers each time)."""
    note = asof_line(res.get("asOf"), tz, live=True, expires=expires)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(company_name)} · {e(res.get('title') or 'Post results')}</title>
<style>
  body {{ margin:0; background:#EEF1F8; font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif; color:#12141C; }}
  main {{ max-width:680px; margin:0 auto; padding:28px 16px 48px; }}
  .card {{ background:#fff; border-radius:18px; padding:28px; box-shadow:0 10px 30px rgba(38,64,158,.10); }}
  h1 {{ font-size:22px; margin:0 0 4px; }} .sub {{ color:#6B7280; font-size:14px; margin-bottom:14px; }}
  .asof {{ font-size:13px; line-height:1.5; color:#3B4252; background:#F4F6FB; border-radius:10px; padding:10px 12px; margin:0 0 14px; }}
  @media (max-width:520px) {{ .card {{ padding:16px; }} }}
</style></head><body><main><div class="card">
<h1>{e(res.get('title') or 'Post results')}</h1>
<div class="sub">{e(company_name)} · results for one post</div>
<p class="asof"><b>Live page.</b> {e(note)} A copy that was emailed or printed keeps the numbers from the time it was made.</p>
{post_sections(res)}
</div></main></body></html>"""
