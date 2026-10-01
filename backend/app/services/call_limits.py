"""Calls capped at the minutes a company has paid for.

Outbound calls carry Telnyx's time_limit_secs, so Telnyx itself ends them when the minutes run
out. A minute before that, the caller hears a short wrap-up line: on calls run by a Telnyx AI
Assistant the assistant is told to say it (a plain speak would talk over it), otherwise it is
spoken. Incoming calls are answered without a Telnyx limit, so for them we also hang up at the
limit ourselves.

The timers live in this process: after a restart a call keeps Telnyx's own limit (outbound) and
its credit hold, which is charged by what the call really used.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Dict

import httpx

logger = logging.getLogger("call_limits")

TELNYX_API = "https://api.telnyx.com/v2"
WRAP_UP_LINE = ("Just so you know, we have about one minute left on this call, "
                "so let's wrap up. Thank you for your time.")
# speak needs a provider voice; plain "female"/"male" is only valid with service_level basic (en-US).
WRAP_UP_VOICE = "AWS.Polly.Amy-Neural"

_timers: Dict[str, asyncio.Task] = {}


def _key(api_key: str) -> str:
    if api_key:
        return api_key
    from app.config import settings
    from app.services.telnyx_client import platform_key

    return platform_key() or (settings.TELNYX_API_KEY or "")


async def _action(api_key: str, call_control_id: str, action: str, body: dict) -> bool:
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.post(f"{TELNYX_API}/calls/{call_control_id}/actions/{action}", json=body,
                                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
        if res.status_code not in (200, 201):
            logger.info(f"[call-limits] {action} on {call_control_id}: HTTP {res.status_code} {res.text[:160]}")
        return res.status_code in (200, 201)
    except Exception as err:
        logger.info(f"[call-limits] {action} on {call_control_id} failed: {err}")
        return False


async def _wrap_up(api_key: str, call_control_id: str, assistant: bool) -> None:
    if assistant:
        sent = await _action(api_key, call_control_id, "ai_assistant_add_messages", {
            "messages": [{"role": "system", "content": f'Say this to the caller now, word for word: "{WRAP_UP_LINE}"'}],
            "trigger_response": True})
        if sent:
            return
    await _action(api_key, call_control_id, "speak", {"payload": WRAP_UP_LINE, "voice": WRAP_UP_VOICE})


async def _run(call_control_id: str, limit_secs: int, api_key: str, hang_up: bool, assistant: bool) -> None:
    from app.services.credits import WRAP_UP_SECS

    try:
        wrap_at = max(limit_secs - WRAP_UP_SECS, 0)
        if wrap_at:
            await asyncio.sleep(wrap_at)
            await _wrap_up(api_key, call_control_id, assistant)
        if hang_up:
            await asyncio.sleep(limit_secs - wrap_at)
            await _action(api_key, call_control_id, "hangup", {})
    except asyncio.CancelledError:
        pass
    finally:
        _timers.pop(call_control_id, None)


def watch(call_control_id: str, limit_secs: int, api_key: str = "", *, hang_up: bool = False,
          assistant: bool = False) -> None:
    """Wrap up a minute before limit_secs from now (and hang up at the limit when hang_up: calls
    Telnyx does not end on its own). assistant: the call is run by a Telnyx AI Assistant. Never raises."""
    if not call_control_id or not limit_secs:
        return
    try:
        stop(call_control_id)
        _timers[call_control_id] = asyncio.create_task(_run(call_control_id, int(limit_secs), _key(api_key), hang_up, assistant))
    except Exception as err:
        logger.warning(f"[call-limits] could not watch {call_control_id}: {err}")


def stop(call_control_id: str) -> None:
    """The call ended: drop its timer."""
    task = _timers.pop(call_control_id, None)
    if task and not task.done():
        task.cancel()
