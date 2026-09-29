"""Organisation-wide settings: the single place timezone, week start, time format and
approver emails are read from. Stored on the default CompanyProfile row."""
from __future__ import annotations

import logging
import re
import zoneinfo
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import CompanyProfile
from app.services.timezone_service import HOST_TZ_DEFAULT

logger = logging.getLogger("org_settings")

WEEK_STARTS = ("monday", "sunday", "saturday")
TIME_FORMATS = ("24h", "12h")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def valid_timezone(name: Optional[str]) -> Optional[str]:
    tz = (name or "").strip()
    if not tz:
        return None
    try:
        zoneinfo.ZoneInfo(tz)
        return tz
    except Exception:
        return None


def clean_emails(raw: Any) -> List[str]:
    items = raw if isinstance(raw, list) else re.split(r"[,;\s]+", str(raw or ""))
    out: List[str] = []
    for item in items:
        e = str(item or "").strip().lower()
        if e and _EMAIL_RE.match(e) and e not in out:
            out.append(e)
    return out


async def _profile(db: AsyncSession, create: bool = False) -> Optional[CompanyProfile]:
    row = (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()
    if row is None and create:
        row = CompanyProfile(id="default")
        db.add(row)
    return row


def org_dict(profile: Optional[CompanyProfile]) -> Dict[str, Any]:
    tz = valid_timezone(getattr(profile, "timezone", None)) or HOST_TZ_DEFAULT
    week = (getattr(profile, "week_start", None) or "monday").lower()
    fmt = (getattr(profile, "time_format", None) or "24h").lower()
    approvers = clean_emails(getattr(profile, "approver_emails", None) or [])
    return {
        "timezone": tz,
        "weekStart": week if week in WEEK_STARTS else "monday",
        "timeFormat": fmt if fmt in TIME_FORMATS else "24h",
        "approverEmails": approvers,
    }


async def load_org(db: AsyncSession) -> Dict[str, Any]:
    return org_dict(await _profile(db))


async def org_timezone(db: AsyncSession) -> str:
    return (await load_org(db))["timezone"]


async def save_org(db: AsyncSession, patch: Dict[str, Any]) -> Dict[str, Any]:
    """Apply an organisation settings patch (camelCase or snake_case keys). Caller commits."""
    profile = await _profile(db, create=True)
    tz_raw = patch.get("timezone")
    if tz_raw is not None:
        tz = valid_timezone(tz_raw)
        if not tz:
            raise ValueError(f"Unknown timezone '{tz_raw}'. Use an IANA name such as Asia/Kolkata or Europe/London.")
        profile.timezone = tz
    week = patch.get("weekStart", patch.get("week_start"))
    if week is not None:
        w = str(week).strip().lower()
        if w not in WEEK_STARTS:
            raise ValueError("Week start must be monday, sunday or saturday.")
        profile.week_start = w
    fmt = patch.get("timeFormat", patch.get("time_format"))
    if fmt is not None:
        f = str(fmt).strip().lower()
        if f not in TIME_FORMATS:
            raise ValueError("Time format must be 24h or 12h.")
        profile.time_format = f
    if "approverEmails" in patch or "approver_emails" in patch:
        profile.approver_emails = clean_emails(patch.get("approverEmails", patch.get("approver_emails")))
    return org_dict(profile)


def org_instant_ms(date_str: str, time_str: str, tz: str) -> Optional[float]:
    """Epoch ms for a wall-clock date + HH:MM in the organisation timezone (DST-aware)."""
    try:
        d = datetime.strptime(str(date_str).strip()[:10], "%Y-%m-%d")
        hh, mm = (str(time_str or "09:00").strip() or "09:00").split(":")[:2]
        local = d.replace(hour=int(hh), minute=int(mm), tzinfo=zoneinfo.ZoneInfo(tz))
        return local.timestamp() * 1000.0
    except Exception:
        return None


async def migrate_calendar_timezone() -> None:
    """One-time: the Cal.com settings used to keep their own timezone. Fold it into the
    organisation setting, then clear it so it can never override a later change."""
    from app.database import engine

    try:
        async with engine.begin() as conn:
            row = (await conn.execute(text("SELECT timezone FROM calcom_settings WHERE id = 'default'"))).first()
            cal_tz = valid_timezone(row[0]) if row else None
            if not cal_tz:
                return
            prof = (await conn.execute(text("SELECT timezone FROM company_profile WHERE id = 'default'"))).first()
            org_tz = valid_timezone(prof[0]) if prof else None
            # The company value only loses when it is still the untouched default.
            if cal_tz != org_tz and (not org_tz or org_tz == HOST_TZ_DEFAULT):
                if prof:
                    await conn.execute(text("UPDATE company_profile SET timezone = :tz WHERE id = 'default'"), {"tz": cal_tz})
                else:
                    await conn.execute(text("INSERT INTO company_profile (id, timezone) VALUES ('default', :tz)"), {"tz": cal_tz})
                logger.info(f"[Org] Organisation timezone set to {cal_tz} from the calendar settings.")
            elif cal_tz != org_tz:
                logger.warning(f"[Org] Calendar timezone {cal_tz} differs from organisation timezone {org_tz}; kept {org_tz}.")
            await conn.execute(text("UPDATE calcom_settings SET timezone = NULL WHERE id = 'default'"))
    except Exception as err:
        logger.debug(f"[Org] Calendar timezone migration skipped: {err}")
