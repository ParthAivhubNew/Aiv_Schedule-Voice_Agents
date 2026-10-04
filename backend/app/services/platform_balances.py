"""Queries live account balances for platform providers (Telnyx, DeepSeek) and manages
the manual spend-alert status for providers without a balance API.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.models import AppSetting
from app.services.telnyx_client import TelnyxClient, TelnyxError, platform_key

logger = logging.getLogger("platform_balances")

CHECKLIST_KEY = "platform_balance_checklist"

NON_POLLABLE_DEFAULTS = [
    {"id": "openai", "name": "OpenAI", "alert_configured": False, "threshold": "$50", "notes": "Set email threshold in platform dashboard"},
    {"id": "anthropic", "name": "Anthropic", "alert_configured": False, "threshold": "$50", "notes": "Set email threshold in console.anthropic.com"},
    {"id": "groq", "name": "Groq", "alert_configured": False, "threshold": "$20", "notes": "Set email threshold in console.groq.com"},
    {"id": "xai", "name": "xAI", "alert_configured": False, "threshold": "$20", "notes": "Set email threshold in console.x.ai"},
    {"id": "elevenlabs", "name": "ElevenLabs", "alert_configured": False, "threshold": "$20", "notes": "Set usage quota email alert in elevenlabs.io"},
    {"id": "deepgram", "name": "Deepgram", "alert_configured": False, "threshold": "$20", "notes": "Set balance alert in console.deepgram.com"},
    {"id": "cartesia", "name": "Cartesia", "alert_configured": False, "threshold": "$20", "notes": "Set credit alert in play.cartesia.ai"},
    {"id": "calcom", "name": "Cal.com", "alert_configured": False, "threshold": "N/A", "notes": "App subscription / billing portal alert"},
    # Leadgen's data providers — see Revenue -> Data provider spend for how much usage is actually
    # drawing on each one this month, to size these thresholds.
    {"id": "icypeas", "name": "Icypeas", "alert_configured": False, "threshold": "$20", "notes": "Set low-balance alert in app.icypeas.com"},
    {"id": "hunter", "name": "Hunter", "alert_configured": False, "threshold": "$20", "notes": "Set usage alert in hunter.io dashboard"},
    {"id": "findymail", "name": "Findymail", "alert_configured": False, "threshold": "$20", "notes": "Set credit alert in app.findymail.com"},
    {"id": "leadmagic", "name": "LeadMagic", "alert_configured": False, "threshold": "$20", "notes": "Set credit alert in leadmagic.io dashboard"},
    {"id": "bettercontact", "name": "BetterContact", "alert_configured": False, "threshold": "$20", "notes": "Set credit alert in app.bettercontact.rocks"},
    {"id": "tavily", "name": "Tavily", "alert_configured": False, "threshold": "$20", "notes": "Set usage alert in app.tavily.com"},
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


async def get_telnyx_live_balance() -> Dict[str, Any]:
    try:
        key = platform_key()
        if not key:
            return {"status": "not_configured", "error": "Telnyx is not connected yet (no API key)."}
        data = await TelnyxClient(key).get_balance()
        return {
            "status": "ok",
            "available_credit": data.get("available_credit", "0.00"),
            "balance": data.get("balance", "0.00"),
            "currency": data.get("currency", "USD"),
        }
    except TelnyxError as err:
        return {"status": "error", "error": f"Telnyx error: {err.detail or err.status}"}
    except Exception as err:
        return {"status": "error", "error": str(err)}


async def _get_deepseek_key() -> str:
    key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    return key


async def get_deepseek_live_balance() -> Dict[str, Any]:
    key = await _get_deepseek_key()
    if not key:
        return {"status": "not_configured", "error": "DEEPSEEK_API_KEY is not set."}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(
                "https://api.deepseek.com/user/balance",
                headers={"Authorization": f"Bearer {key}", "Accept": "application/json"}
            )
            if res.status_code == 200:
                data = res.json()
                # shape: { "is_available": true, "balance_infos": [{"currency": "USD", "total_balance": "..."}, ...] }
                infos = data.get("balance_infos", [])
                usd_info = next((i for i in infos if i.get("currency") == "USD"), None) or (infos[0] if infos else {})
                return {
                    "status": "ok",
                    "is_available": data.get("is_available", True),
                    "total_balance": usd_info.get("total_balance", "0.00"),
                    "currency": usd_info.get("currency", "USD"),
                    "topped_up_balance": usd_info.get("topped_up_balance", "0.00"),
                    "granted_balance": usd_info.get("granted_balance", "0.00"),
                    "balance_infos": infos,
                }
            elif res.status_code == 401:
                return {"status": "error", "error": "Invalid DeepSeek API key (401)."}
            elif res.status_code == 402:
                return {"status": "ok", "total_balance": "0.00", "currency": "USD", "is_available": False, "error": "Insufficient balance (402)"}
            else:
                return {"status": "error", "error": f"DeepSeek returned status {res.status_code}: {res.text[:120]}"}
    except Exception as err:
        return {"status": "error", "error": str(err)}


async def get_platform_balances_overview(db: AsyncSession) -> Dict[str, Any]:
    doc = await _get_doc(db, CHECKLIST_KEY)
    saved = {row.get("id"): row for row in (doc.get("checklist") or []) if row.get("id")}
    # Merge so a provider added to the defaults later (e.g. the Leadgen data vendors) shows up
    # even for an install that already saved a checklist before that provider existed.
    saved_checklist = [saved.get(d["id"], d) for d in NON_POLLABLE_DEFAULTS]

    import asyncio
    telnyx_bal, deepseek_bal = await asyncio.gather(get_telnyx_live_balance(), get_deepseek_live_balance())

    return {
        "pollable": {
            "telnyx": {
                "name": "Telnyx (Telephony & SIP)",
                **telnyx_bal,
            },
            "deepseek": {
                "name": "DeepSeek (LLM Inference)",
                **deepseek_bal,
            }
        },
        "checklist": saved_checklist,
    }


async def save_checklist_state(db: AsyncSession, checklist: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    await _put_doc(db, CHECKLIST_KEY, {"checklist": checklist})
    await db.commit()
    return checklist
