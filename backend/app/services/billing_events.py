"""What happens to plans, kept so people can be told: the cancel flow's reasons, the emails to a company's admins when
a plan is cancelled or ends, and the one month-end report to the software owner (who joined, who left and why).

Nothing here is emailed per event to the owner: they get a single summary on the first days of each month."""
from __future__ import annotations

import calendar
import html
import logging
import uuid
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.future import select

logger = logging.getLogger("billing_events")

# What a person picks when they cancel. The first value is what is stored.
REASONS = [
    ("too_expensive", "It costs too much"),
    ("not_using", "I am not using it enough"),
    ("missing_feature", "It is missing something I need"),
    ("other_tool", "I am switching to another tool"),
    ("pause", "I just need a break"),
    ("other", "Something else"),
]
REASON_LABEL = dict(REASONS)
WALLET_NAME = {"leadgen": "Leads", "voice": "Voice", "scheduler": "Social"}
WALLET_PATH = {"leadgen": "/leadgen/subscription", "voice": "/voice/subscription", "scheduler": "/scheduler/subscription"}
REPORT_KEY = "billing_report_sent"


def _e(text: Any) -> str:
    return html.escape(str(text or ""))


async def record(db, kind: str, wallet: str = "", plan: Any = None, reason: str = "", note: str = "", by: str = "") -> None:
    """Writes one line of plan history for the current company. The caller commits."""
    from sqlalchemy import text

    from app.core.tenancy import current_org
    from app.models.models import BillingEvent

    org = current_org()
    name = ""
    try:
        name = (await db.execute(text("SELECT name FROM organizations WHERE id = :i"), {"i": org})).scalar() or ""
    except Exception:
        pass
    db.add(BillingEvent(id=f"be_{uuid.uuid4().hex[:14]}", org_name=name, wallet=wallet or (getattr(plan, "wallet", "") or ""),
                        plan_id=getattr(plan, "id", "") or "", plan_name=getattr(plan, "name", "") or "", kind=kind,
                        reason=reason[:40], note=(note or "")[:500], by=by[:120], at=datetime.utcnow()))


def day(d: Optional[datetime]) -> str:
    return d.strftime("%d %b %Y").lstrip("0") if d else ""


# ── Emails to the company's admins ──────────────────────────────────────────
async def credits_summary(db, wallet: str) -> Dict[str, int]:
    """Plan credits (they end with the period) and top-up credits (they stay) left in one app's wallet."""
    from app.services import credits as K

    w = next((x for x in await K.wallets(db) if x["key"] == wallet), None) or {"batches": []}
    plan = sum(int(b["remaining"]) for b in w.get("batches", []) if b.get("expiresAt"))
    keep = sum(int(b["remaining"]) for b in w.get("batches", []) if not b.get("expiresAt"))
    return {"plan": plan, "keep": keep}


def _button(wallet: str, label: str) -> Optional[Dict[str, str]]:
    from app.config import settings

    base = (settings.PUBLIC_BASE_URL or "").rstrip("/")
    path = WALLET_PATH.get(wallet)
    return {"label": label, "url": f"{base}{path}"} if base and path else None


async def tell_cancelled(db, wallet: str, plan_name: str, ends: Optional[datetime]) -> None:
    """The company's admins are told their plan is cancelled, what stays usable and until when."""
    from app.core.notify import notify

    app = WALLET_NAME.get(wallet, wallet)
    c = await credits_summary(db, wallet)
    when = day(ends) or "the end of this period"
    lines = [f"<b>{_e(plan_name)}</b> ({app}) is cancelled. It stays active until <b>{_e(when)}</b>.",
             f"You can use the {c['plan']:,} plan credits you have left until then. Any still unused that day expire."
             if c["plan"] else "You have no plan credits left, so there is nothing more to use from the plan.",
             (f"The {c['keep']:,} top-up credits in your wallet never expire and stay with you." if c["keep"] else ""),
             "It will not renew, nothing more is charged, and the current month is not refunded.",
             f"Changed your mind? Open Subscription and press <b>Keep my plan</b> before {_e(when)}."]
    await notify("plan_changes", f"{plan_name} is cancelled", [ln for ln in lines if ln], _button(wallet, "Open Subscription"))


async def tell_ended(db, wallet: str, plan_name: str) -> None:
    from app.core.notify import notify

    app = WALLET_NAME.get(wallet, wallet)
    c = await credits_summary(db, wallet)
    lines = [f"Your <b>{_e(plan_name)}</b> plan ({app}) has ended.",
             (f"The {c['keep']:,} top-up credits in your wallet are still yours to use." if c["keep"]
              else "Plan credits ended with it, so the wallet is empty until you subscribe or top up."),
             "Everything you made is still there. Subscribe again any time to carry on."]
    await notify("plan_changes", f"{plan_name} has ended", lines, _button(wallet, "Choose a plan"))


# ── The month-end report to the software owner ──────────────────────────────
def month_bounds(year: int, month: int):
    start = datetime(year, month, 1)
    end = datetime(year + (month == 12), (month % 12) + 1, 1)
    return start, end


async def month_stats(db, year: int, month: int) -> Dict[str, Any]:
    """Who joined, which plans started or ended, who cancelled and why, across all companies. Run under system scope."""
    from app.models.models import BillingEvent, BillingSubscription, Organization

    start, end = month_bounds(year, month)
    orgs = (await db.execute(select(Organization).where(Organization.created_at >= start, Organization.created_at < end))).scalars().all()
    rows = (await db.execute(select(BillingEvent).where(BillingEvent.at >= start, BillingEvent.at < end).order_by(BillingEvent.at))).scalars().all()

    def pick(kind):
        return [r for r in rows if r.kind == kind]

    def who(r):
        return f"{r.org_name or r.org_id} ({WALLET_NAME.get(r.wallet, r.wallet)}{': ' + r.plan_name if r.plan_name else ''})"

    cancelled = pick("cancel_requested")
    undone = {(r.org_id, r.wallet) for r in pick("cancel_undone")}
    kept_cancels = [r for r in cancelled if (r.org_id, r.wallet) not in undone]
    live: Counter = Counter()
    for s in (await db.execute(select(BillingSubscription))).scalars().all():
        if s.status in ("active", "trialing", "past_due"):
            for wallet in (s.plans or {}):
                live[wallet] += 1
    return {
        "year": year, "month": month,
        "joined": [o.name or o.id for o in orgs],
        "started": [who(r) for r in pick("started")],
        "renewed": len(pick("renewed")),
        "cancelled": [who(r) for r in kept_cancels],
        "reasons": Counter(r.reason or "other" for r in kept_cancels),
        "reason_notes": [(r.org_name, r.note) for r in kept_cancels if r.note],
        "ended": [who(r) for r in pick("ended")],
        "live": dict(live),
    }


def _list(items: List[str], limit: int = 25) -> str:
    if not items:
        return "none"
    shown = "; ".join(_e(i) for i in items[:limit])
    return shown + (f"; and {len(items) - limit} more" if len(items) > limit else "")


def report_paragraphs(s: Dict[str, Any]) -> List[str]:
    net = len(s["started"]) - len(s["ended"])
    out = [
        f"<b>New companies joined:</b> {len(s['joined'])}. {_list(s['joined'])}",
        f"<b>New plans started:</b> {len(s['started'])}. {_list(s['started'])}",
        f"<b>Renewed:</b> {s['renewed']}",
        f"<b>Cancelled (still running to the end of their month):</b> {len(s['cancelled'])}. {_list(s['cancelled'])}",
    ]
    if s["reasons"]:
        out.append("<b>Why they cancelled:</b> " + ", ".join(f"{_e(REASON_LABEL.get(k, k))} {v}" for k, v in s["reasons"].most_common()))
    for org, note in s["reason_notes"][:10]:
        out.append(f"&ldquo;{_e(note)}&rdquo; &mdash; {_e(org)}")
    out += [f"<b>Plans that ended for good:</b> {len(s['ended'])}. {_list(s['ended'])}",
            f"<b>Net change in plans:</b> {net:+d}",
            "<b>Plans running now:</b> " + (", ".join(f"{WALLET_NAME.get(w, w)} {n}" for w, n in sorted(s["live"].items())) or "none")]
    return out


async def send_month_report(year: int, month: int) -> int:
    """Emails the month's summary to the staff admins. Returns how many were sent."""
    from app.core.mailer import render_owner, send_system_email
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.services.ai_errors import _staff_emails

    with system_scope():
        async with AsyncSessionLocal() as db:
            stats = await month_stats(db, year, month)
    title = f"Outreach: {calendar.month_name[month]} {year} in plans"
    msg = render_owner(title, report_paragraphs(stats), page="clients", button_label="Open the clients page")
    sent = 0
    for to in await _staff_emails():
        res = await send_system_email(to, title, msg["html"], msg["text"])
        sent += 1 if res.get("ok") else 0
    return sent


async def send_due_report(now: Optional[datetime] = None) -> Optional[str]:
    """Once a month, from the 1st: last month's report, never twice. Returns the month sent, if any."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.services.credits import _get_doc, _put_doc

    now = now or datetime.utcnow()
    prev = (now.replace(day=1) - timedelta(days=1))
    key = f"{prev.year}-{prev.month:02d}"
    with system_scope():
        async with AsyncSessionLocal() as db:
            doc = await _get_doc(db, REPORT_KEY)
    if key in (doc.get("months") or []):
        return None
    sent = await send_month_report(prev.year, prev.month)
    with system_scope():
        async with AsyncSessionLocal() as db:
            doc = await _get_doc(db, REPORT_KEY)
            # Remembered even when nobody could be emailed (no staff, no mail setup): a missing mailbox must not repeat it daily.
            doc["months"] = [*(doc.get("months") or []), key][-24:]
            await _put_doc(db, REPORT_KEY, doc)
            await db.commit()
    logger.info(f"[billing-report] {key} sent to {sent} staff admin(s)")
    return key
