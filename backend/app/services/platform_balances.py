"""Live balances for every platform provider we can actually poll (Telnyx, DeepSeek, Hunter,
Findymail, LeadMagic, BetterContact, Tavily, ElevenLabs, Deepgram), plus the manual spend-alert
checklist for the few that expose no balance API at all (OpenAI, Anthropic, Groq, xAI, Cartesia,
Cal.com, Icypeas).

For each pollable provider we keep a rolling history of its real remaining balance and derive,
from the actual observed decline (never a guess): a burn rate, a runway in days, and -- when the
provider's own unit is USD and maps to one of our wallets -- a reserve/headroom against what we
still owe customers (app.services.credits.platform_liability_usd). Staff are emailed when a
provider goes "low" or "critical"; nothing here is a fixed, hardcoded threshold -- it all comes
from what actually happened recently.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import AppSetting
from app.services.telnyx_client import TelnyxClient, TelnyxError, platform_key

logger = logging.getLogger("platform_balances")

CHECKLIST_KEY = "platform_balance_checklist"
HISTORY_PREFIX = "balance_history:"
ALERT_PREFIX = "balance_alert_sent:"
HISTORY_DAYS = 30
MIN_HISTORY_HOURS = 20  # don't compute a burn rate from two readings taken minutes apart
RUNWAY_LOW_DAYS = 10
RUNWAY_CRITICAL_DAYS = 3
RE_ALERT_AFTER = timedelta(hours=24)

NON_POLLABLE_DEFAULTS = [
    {"id": "openai", "name": "OpenAI", "alert_configured": False, "threshold": "$50", "notes": "Set email threshold in platform dashboard"},
    {"id": "anthropic", "name": "Anthropic", "alert_configured": False, "threshold": "$50", "notes": "Set email threshold in console.anthropic.com"},
    {"id": "groq", "name": "Groq", "alert_configured": False, "threshold": "N/A", "notes": "No prepaid balance on Groq's side to check"},
    {"id": "xai", "name": "xAI", "alert_configured": False, "threshold": "$20", "notes": "Set email threshold in console.x.ai"},
    {"id": "cartesia", "name": "Cartesia", "alert_configured": False, "threshold": "$20", "notes": "Set credit alert in play.cartesia.ai"},
    {"id": "calcom", "name": "Cal.com", "alert_configured": False, "threshold": "N/A", "notes": "Seat subscription, not a credit balance -- watch for failed-payment emails instead"},
    {"id": "icypeas", "name": "Icypeas", "alert_configured": False, "threshold": "$20", "notes": "Set low-balance alert in app.icypeas.com"},
]


async def _get_doc(db: AsyncSession, key: str) -> dict:
    row = (await db.execute(select(AppSetting).where(AppSetting.id == key))).scalars().first()
    return dict(row.data or {}) if row else {}


async def _put_doc(db: AsyncSession, key: str, data: dict) -> None:
    row = (await db.execute(select(AppSetting).where(AppSetting.id == key))).scalars().first()
    if not row:
        row = AppSetting(id=key, data=data)
        db.add(row)
    else:
        row.data = data
    await db.flush()


async def _platform_key(name_substr: str) -> str:
    """Whatever key staff saved anywhere in Platform Keys whose name contains this text --
    looked up by name, not by which group it happens to be filed under."""
    from app.core.platform import platform_org_id
    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.models.models import Connection
    from app.services.secret_box import config_get_secret, open_config

    try:
        with org_scope(platform_org_id()):
            async with AsyncSessionLocal() as s:
                rows = (await s.execute(select(Connection))).scalars().all()
        for c in rows:
            if name_substr in (c.name or "").lower():
                key = config_get_secret(open_config(c.config if isinstance(c.config, dict) else {}), "api_key", "auth_token")
                if key:
                    return key.strip()
    except Exception as err:
        logger.debug(f"[platform_balances] key lookup failed for {name_substr}: {err}")
    return ""


# ── Live pollers: each returns {"status": "ok"/"error"/"not_configured", "remaining": float, "unit": str, ...} ──

async def get_telnyx_live_balance() -> Dict[str, Any]:
    try:
        key = platform_key()
        if not key:
            return {"status": "not_configured", "error": "Telnyx is not connected yet (no API key)."}
        data = await TelnyxClient(key).get_balance()
        return {"status": "ok", "remaining": float(data.get("available_credit") or 0), "unit": "usd",
                "available_credit": data.get("available_credit", "0.00"), "balance": data.get("balance", "0.00"),
                "currency": data.get("currency", "USD")}
    except TelnyxError as err:
        return {"status": "error", "error": f"Telnyx error: {err.detail or err.status}"}
    except Exception as err:
        return {"status": "error", "error": str(err)}


async def get_deepseek_live_balance() -> Dict[str, Any]:
    key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not key:
        return {"status": "not_configured", "error": "DEEPSEEK_API_KEY is not set."}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get("https://api.deepseek.com/user/balance",
                                   headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
            if res.status_code == 200:
                data = res.json()
                infos = data.get("balance_infos", [])
                usd_info = next((i for i in infos if i.get("currency") == "USD"), None) or (infos[0] if infos else {})
                return {"status": "ok", "remaining": float(usd_info.get("total_balance") or 0), "unit": "usd",
                        "is_available": data.get("is_available", True), "total_balance": usd_info.get("total_balance", "0.00"),
                        "currency": usd_info.get("currency", "USD"), "topped_up_balance": usd_info.get("topped_up_balance", "0.00"),
                        "granted_balance": usd_info.get("granted_balance", "0.00"), "balance_infos": infos}
            if res.status_code == 401:
                return {"status": "error", "error": "Invalid DeepSeek API key (401)."}
            if res.status_code == 402:
                return {"status": "ok", "remaining": 0.0, "unit": "usd", "total_balance": "0.00", "currency": "USD",
                        "is_available": False, "error": "Insufficient balance (402)"}
            return {"status": "error", "error": f"DeepSeek returned status {res.status_code}: {res.text[:120]}"}
    except Exception as err:
        return {"status": "error", "error": str(err)}


async def get_hunter_live_balance() -> Dict[str, Any]:
    key = await _platform_key("hunter")
    if not key:
        return {"status": "not_configured", "error": "No Hunter key saved."}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get("https://api.hunter.io/v2/account", params={"api_key": key})
            if res.status_code == 200:
                reqs = ((res.json().get("data") or {}).get("requests") or {})
                remaining = (reqs.get("searches") or {}).get("available")
                if remaining is None:
                    return {"status": "error", "error": "Unrecognised Hunter response shape."}
                return {"status": "ok", "remaining": float(remaining), "unit": "searches"}
            if res.status_code in (401, 403):
                return {"status": "error", "error": f"Hunter key rejected ({res.status_code})."}
            return {"status": "error", "error": f"Hunter returned {res.status_code}."}
    except Exception as err:
        return {"status": "error", "error": str(err)}


async def get_findymail_live_balance() -> Dict[str, Any]:
    key = await _platform_key("findymail")
    if not key:
        return {"status": "not_configured", "error": "No Findymail key saved."}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get("https://app.findymail.com/api/credits",
                                   headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
            if res.status_code == 200:
                data = res.json()
                remaining = data.get("credits", data.get("credits_left", data.get("balance")))
                if remaining is None:
                    return {"status": "error", "error": f"Unrecognised Findymail response: {str(data)[:120]}"}
                return {"status": "ok", "remaining": float(remaining), "unit": "credits"}
            if res.status_code in (401, 403):
                return {"status": "error", "error": f"Findymail key rejected ({res.status_code})."}
            return {"status": "error", "error": f"Findymail returned {res.status_code}."}
    except Exception as err:
        return {"status": "error", "error": str(err)}


async def get_leadmagic_live_balance() -> Dict[str, Any]:
    key = await _platform_key("leadmagic")
    if not key:
        return {"status": "not_configured", "error": "No LeadMagic key saved."}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get("https://api.leadmagic.io/v1/credits", headers={"X-API-Key": key})
            if res.status_code == 200:
                return {"status": "ok", "remaining": float(res.json().get("credits") or 0), "unit": "credits"}
            if res.status_code in (401, 403):
                return {"status": "error", "error": f"LeadMagic key rejected ({res.status_code})."}
            return {"status": "error", "error": f"LeadMagic returned {res.status_code}."}
    except Exception as err:
        return {"status": "error", "error": str(err)}


async def get_bettercontact_live_balance() -> Dict[str, Any]:
    key = await _platform_key("bettercontact")
    if not key:
        return {"status": "not_configured", "error": "No BetterContact key saved."}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get("https://app.bettercontact.rocks/api/v2/account", headers={"X-API-Key": key})
            if res.status_code == 200:
                return {"status": "ok", "remaining": float(res.json().get("credits_left") or 0), "unit": "credits"}
            if res.status_code in (401, 403):
                return {"status": "error", "error": f"BetterContact key rejected ({res.status_code})."}
            return {"status": "error", "error": f"BetterContact returned {res.status_code}."}
    except Exception as err:
        return {"status": "error", "error": str(err)}


async def get_tavily_live_balance() -> Dict[str, Any]:
    from app.services.enrichment_service import tavily_key

    key = await tavily_key()
    if not key:
        return {"status": "not_configured", "error": "No Tavily key saved."}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get("https://api.tavily.com/usage", headers={"Authorization": f"Bearer {key}"})
            if res.status_code == 200:
                acct = res.json().get("account") or {}
                limit, used = acct.get("plan_limit"), acct.get("plan_usage")
                if limit is None or used is None:
                    return {"status": "error", "error": "Unrecognised Tavily response shape."}
                return {"status": "ok", "remaining": float(limit) - float(used), "unit": "credits"}
            if res.status_code in (401, 403):
                return {"status": "error", "error": f"Tavily key rejected ({res.status_code})."}
            return {"status": "error", "error": f"Tavily returned {res.status_code}."}
    except Exception as err:
        return {"status": "error", "error": str(err)}


async def get_elevenlabs_live_balance() -> Dict[str, Any]:
    key = await _platform_key("elevenlabs")
    if not key:
        return {"status": "not_configured", "error": "No ElevenLabs key saved."}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get("https://api.elevenlabs.io/v1/user/subscription", headers={"xi-api-key": key})
            if res.status_code == 200:
                data = res.json()
                remaining = float(data.get("character_limit") or 0) - float(data.get("character_count") or 0)
                return {"status": "ok", "remaining": remaining, "unit": "characters"}
            if res.status_code in (401, 403):
                return {"status": "error", "error": f"ElevenLabs key rejected ({res.status_code})."}
            return {"status": "error", "error": f"ElevenLabs returned {res.status_code}."}
    except Exception as err:
        return {"status": "error", "error": str(err)}


async def get_deepgram_live_balance() -> Dict[str, Any]:
    key = await _platform_key("deepgram")
    if not key:
        return {"status": "not_configured", "error": "No Deepgram key saved."}
    try:
        headers = {"Authorization": f"Token {key}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            projects = await client.get("https://api.deepgram.com/v1/projects", headers=headers)
            if projects.status_code != 200:
                return {"status": "error", "error": f"Deepgram returned {projects.status_code} listing projects."}
            total = 0.0
            for p in projects.json().get("projects") or []:
                pid = p.get("project_id")
                if not pid:
                    continue
                bal = await client.get(f"https://api.deepgram.com/v1/projects/{pid}/balances", headers=headers)
                if bal.status_code == 200:
                    total += sum(float(b.get("amount") or 0) for b in bal.json().get("balances") or [])
            return {"status": "ok", "remaining": total, "unit": "usd"}
    except Exception as err:
        return {"status": "error", "error": str(err)}


# provider id -> (display name, poller, wallet or None -- only USD-unit providers net against a wallet's liability)
POLLERS: Dict[str, tuple] = {
    "telnyx": ("Telnyx (Telephony & SIP)", get_telnyx_live_balance, "voice"),
    "deepseek": ("DeepSeek (LLM Inference)", get_deepseek_live_balance, None),
    "hunter": ("Hunter (Email Finder)", get_hunter_live_balance, "leadgen"),
    "findymail": ("Findymail (Email Finder)", get_findymail_live_balance, "leadgen"),
    "leadmagic": ("LeadMagic (Email Finder)", get_leadmagic_live_balance, "leadgen"),
    "bettercontact": ("BetterContact (Email Finder)", get_bettercontact_live_balance, "leadgen"),
    "tavily": ("Tavily (Business Discovery)", get_tavily_live_balance, "leadgen"),
    "elevenlabs": ("ElevenLabs (Text-to-Speech)", get_elevenlabs_live_balance, "voice"),
    "deepgram": ("Deepgram (Speech-to-Text)", get_deepgram_live_balance, "voice"),
}


# ── History, burn rate, runway, reserve/headroom ─────────────────────────────

async def _history(db: AsyncSession, provider: str) -> List[Dict[str, Any]]:
    return list((await _get_doc(db, f"{HISTORY_PREFIX}{provider}")).get("points") or [])


async def _append_history(db: AsyncSession, provider: str, remaining: float) -> List[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    points = await _history(db, provider)
    points.append({"t": now.isoformat(), "remaining": remaining})
    cutoff = now - timedelta(days=HISTORY_DAYS)
    points = [p for p in points if datetime.fromisoformat(p["t"]) >= cutoff]
    await _put_doc(db, f"{HISTORY_PREFIX}{provider}", {"points": points})
    return points


def _burn_per_day(points: List[Dict[str, Any]]) -> Optional[float]:
    if len(points) < 2:
        return None
    first, last = points[0], points[-1]
    t0, t1 = datetime.fromisoformat(first["t"]), datetime.fromisoformat(last["t"])
    hours = (t1 - t0).total_seconds() / 3600.0
    if hours < MIN_HISTORY_HOURS:
        return None
    declined = float(first["remaining"]) - float(last["remaining"])
    if declined <= 0:
        return 0.0  # topped up or flat since the window started -- no depletion signal yet
    return declined / (hours / 24.0)


async def _assess(db: AsyncSession, provider: str, label: str, live: Dict[str, Any], wallet: Optional[str],
                  liabilities: Dict[str, Optional[float]]) -> Dict[str, Any]:
    out = {"id": provider, "name": label, **live}
    if live.get("status") != "ok":
        return out
    remaining = float(live.get("remaining") or 0)
    points = await _append_history(db, provider, remaining)
    burn = _burn_per_day(points)
    runway = (remaining / burn) if (burn and burn > 0) else None
    headroom = None
    if wallet and live.get("unit") == "usd" and liabilities.get(wallet) is not None:
        headroom = round(remaining - liabilities[wallet], 2)
    recommended_topup = round(burn * 14, 2) if burn else None

    status = "ok"
    if remaining <= 0 or (headroom is not None and headroom <= 0) or (runway is not None and runway < RUNWAY_CRITICAL_DAYS):
        status = "critical"
    elif (headroom is not None and recommended_topup and headroom < recommended_topup) or (runway is not None and runway < RUNWAY_LOW_DAYS):
        status = "low"

    out.update({"burnPerDay": round(burn, 2) if burn else None, "runwayDays": round(runway, 1) if runway else None,
                "headroomUsd": headroom, "recommendedTopupUsd": recommended_topup, "status": status,
                "liabilityUsd": liabilities.get(wallet) if wallet else None, "wallet": wallet})
    return out


async def check_and_alert(db: AsyncSession) -> List[Dict[str, Any]]:
    """The periodic job: polls every live provider, updates its history, and emails staff once
    (deduped) when one goes low/critical. Returns the full assessment for logging."""
    import asyncio

    from app.services.credits import platform_liability_usd

    liabilities = await platform_liability_usd()
    results = await asyncio.gather(*(poller() for _, poller, _ in POLLERS.values()))
    out = []
    for (provider, (label, _, wallet)), live in zip(POLLERS.items(), results):
        assessed = await _assess(db, provider, label, live, wallet, liabilities)
        out.append(assessed)
        if assessed.get("status") in ("low", "critical"):
            await _maybe_alert(db, assessed)
    await db.commit()
    return out


async def _maybe_alert(db: AsyncSession, assessed: Dict[str, Any]) -> None:
    provider = assessed["id"]
    doc = await _get_doc(db, f"{ALERT_PREFIX}{provider}")
    last_at, last_status = doc.get("at"), doc.get("status")
    now = datetime.now(timezone.utc)
    if last_at and last_status == assessed["status"] and datetime.fromisoformat(last_at) > now - RE_ALERT_AFTER:
        return
    await _put_doc(db, f"{ALERT_PREFIX}{provider}", {"at": now.isoformat(), "status": assessed["status"]})
    try:
        from app.core.mailer import render, send_system_email
        from app.services.ai_errors import _staff_emails

        recipients = await _staff_emails()
        if not recipients:
            return
        level = "CRITICAL" if assessed["status"] == "critical" else "Low balance"
        unit = assessed.get("unit", "")
        subject = f"{level}: {assessed['name']} is running low"
        lines = [f"<b>{assessed['name']}</b>: {assessed.get('remaining', 0):,.2f} {unit} remaining."]
        if assessed.get("runwayDays") is not None:
            lines.append(f"At the current pace, that's about <b>{assessed['runwayDays']} day(s)</b> of runway left.")
        if assessed.get("headroomUsd") is not None:
            lines.append(f"Headroom after covering what customers are still owed: <b>${assessed['headroomUsd']:,.2f}</b>.")
        if assessed.get("recommendedTopupUsd"):
            lines.append(f"Recommended top-up: about <b>${assessed['recommendedTopupUsd']:,.2f}</b> (2 weeks at the current pace).")
        lines.append("See the owner portal (Balances) for the full picture.")
        msg = render(subject, lines, None)
        for to in recipients:
            await send_system_email(to, subject, msg["html"], msg["text"])
    except Exception as err:
        logger.warning(f"[platform_balances] alert email failed for {provider}: {err}")


async def get_platform_balances_overview(db: AsyncSession) -> Dict[str, Any]:
    """For the Balances page: the latest assessment of every pollable provider (re-polled live,
    but reusing the stored history rather than re-triggering an alert), plus the manual
    checklist for the handful with no balance API at all."""
    from app.services.credits import platform_liability_usd

    doc = await _get_doc(db, CHECKLIST_KEY)
    saved = {row.get("id"): row for row in (doc.get("checklist") or []) if row.get("id")}
    saved_checklist = [saved.get(d["id"], d) for d in NON_POLLABLE_DEFAULTS]

    import asyncio

    liabilities = await platform_liability_usd()
    results = await asyncio.gather(*(poller() for _, poller, _ in POLLERS.values()))
    pollable = {}
    for (provider, (label, _, wallet)), live in zip(POLLERS.items(), results):
        if live.get("status") != "ok":
            pollable[provider] = {"name": label, **live}
            continue
        points = await _history(db, provider)
        remaining = float(live.get("remaining") or 0)
        burn = _burn_per_day(points + [{"t": datetime.now(timezone.utc).isoformat(), "remaining": remaining}])
        runway = (remaining / burn) if (burn and burn > 0) else None
        headroom = round(remaining - liabilities[wallet], 2) if (wallet and live.get("unit") == "usd" and liabilities.get(wallet) is not None) else None
        recommended_topup = round(burn * 14, 2) if burn else None
        status = "ok"
        if remaining <= 0 or (headroom is not None and headroom <= 0) or (runway is not None and runway < RUNWAY_CRITICAL_DAYS):
            status = "critical"
        elif (headroom is not None and recommended_topup and headroom < recommended_topup) or (runway is not None and runway < RUNWAY_LOW_DAYS):
            status = "low"
        pollable[provider] = {"name": label, **live, "burnPerDay": round(burn, 2) if burn else None,
                              "runwayDays": round(runway, 1) if runway else None, "headroomUsd": headroom,
                              "recommendedTopupUsd": recommended_topup, "status": status,
                              "liabilityUsd": liabilities.get(wallet) if wallet else None, "wallet": wallet}
    return {"pollable": pollable, "checklist": saved_checklist}


async def save_checklist_state(db: AsyncSession, checklist: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    await _put_doc(db, CHECKLIST_KEY, {"checklist": checklist})
    await db.commit()
    return checklist
