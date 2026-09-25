import logging
from typing import Optional

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.config import settings
from app.models.models import Connection
from app.services.secret_box import open_config, config_get_secret
from app.services.process_logger import log_process_event

logger = logging.getLogger("telnyx_assistant_sync")

TELNYX_ASSISTANTS_URL = "https://api.telnyx.com/v2/ai/assistants"


async def _resolve_telnyx_api_key(db: AsyncSession) -> Optional[str]:
    """Same resolution order as the rest of the app: saved Connection first, then env var."""
    res = await db.execute(select(Connection))
    for c in res.scalars().all():
        if "telnyx" in (c.name or "").lower():
            cfg = open_config(c.config if isinstance(c.config, dict) else {})
            key = config_get_secret(cfg, "api_key", "auth_token")
            if key:
                return key
    return (getattr(settings, "TELNYX_API_KEY", None) or "").strip() or None


async def sync_active_prompt_to_telnyx(direction: str = "outbound") -> dict:
    """
    Pushes our active conversation template's rendered system prompt to the configured
    Telnyx AI Assistant's `instructions` field via POST /v2/ai/assistants/{assistant_id}.

    Rendered with generic (no specific prospect) context, since Telnyx's `instructions`
    is one static string per assistant, not re-rendered per call the way our own engine
    renders it live for each caller. Per-call personalization on the Telnyx side still
    works via its own {{dynamic_variables}}, returned separately by our
    /api/telnyx-assistant/call-event webhook.

    Opens its own DB session — this is meant to be fired via asyncio.create_task from a
    request handler, so it must not depend on that request's (soon-to-close) session.

    Best-effort: never raises. A missing assistant_id/api_key or a Telnyx API failure is
    logged and returned as {"synced": False, "reason": ...} rather than breaking the
    template save/activate flow that calls this.
    """
    assistant_id = (getattr(settings, "TELNYX_ASSISTANT_ID", None) or "").strip()
    if not assistant_id:
        return {"synced": False, "reason": "No TELNYX_ASSISTANT_ID configured — sync skipped."}

    from app.database import AsyncSessionLocal

    try:
        async with AsyncSessionLocal() as db:
            api_key = await _resolve_telnyx_api_key(db)
            if not api_key:
                return {"synced": False, "reason": "No Telnyx API key saved in Connections or .env — sync skipped."}

            from app.services.conversation_engine import context_resolver, template_engine

            generic_ctx = await context_resolver.resolve_outbound(db)
            active_tpl = await template_engine.get_active_template(db, direction=direction)
            instructions = template_engine.render_system_prompt(active_tpl, generic_ctx)
    except Exception as render_err:
        logger.error(f"[TELNYX-SYNC] Could not render active template for direction '{direction}': {render_err}")
        return {"synced": False, "reason": f"Template render failed: {render_err}"}

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            res = await client.post(
                f"{TELNYX_ASSISTANTS_URL}/{assistant_id}",
                json={"instructions": instructions},
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            )
    except Exception as req_err:
        logger.error(f"[TELNYX-SYNC] Request to Telnyx failed: {req_err}")
        await log_process_event(
            subsystem="telephony",
            process_name="telnyx_assistant_sync_failed",
            message=f"Failed to sync prompt to Telnyx Assistant {assistant_id}: {req_err}",
            level="ERROR",
            details={"assistantId": assistant_id, "direction": direction},
        )
        return {"synced": False, "reason": str(req_err)}

    if res.status_code in (200, 201):
        logger.info(f"[TELNYX-SYNC] Synced active '{direction}' template to Telnyx Assistant {assistant_id}.")
        await log_process_event(
            subsystem="telephony",
            process_name="telnyx_assistant_sync",
            message=f"Synced active '{direction}' conversation template to Telnyx Assistant {assistant_id}.",
            level="SUCCESS",
            details={"assistantId": assistant_id, "direction": direction, "instructionsLength": len(instructions)},
        )
        return {"synced": True}

    err_text = res.text[:300]
    logger.warning(f"[TELNYX-SYNC] Telnyx rejected sync ({res.status_code}): {err_text}")
    await log_process_event(
        subsystem="telephony",
        process_name="telnyx_assistant_sync_failed",
        message=f"Telnyx rejected prompt sync for assistant {assistant_id} (HTTP {res.status_code}).",
        level="ERROR",
        details={"assistantId": assistant_id, "statusCode": res.status_code, "error": err_text},
    )
    return {"synced": False, "reason": f"Telnyx HTTP {res.status_code}: {err_text}"}
