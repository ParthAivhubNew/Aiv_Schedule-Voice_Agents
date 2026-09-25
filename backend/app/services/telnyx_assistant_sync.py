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
TELNYX_ASSISTANT_SETTINGS_ID = "c_telnyx_assistant_settings"


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


async def _get_assistant_settings_row(db: AsyncSession) -> dict:
    res = await db.execute(select(Connection).where(Connection.id == TELNYX_ASSISTANT_SETTINGS_ID))
    row = res.scalars().first()
    return row.config if (row and isinstance(row.config, dict)) else {}


async def resolve_telnyx_assistant_id(db: AsyncSession) -> Optional[str]:
    """UI-saved value first (Connections -> Telnyx AI Assistant Settings), env var fallback."""
    cfg = await _get_assistant_settings_row(db)
    saved = (cfg.get("assistant_id") or "").strip() if cfg.get("assistant_id") else ""
    return saved or (getattr(settings, "TELNYX_ASSISTANT_ID", None) or "").strip() or None


async def resolve_telnyx_public_key(db: AsyncSession) -> Optional[str]:
    """UI-saved value first (Connections -> Telnyx AI Assistant Settings), env var fallback."""
    cfg = await _get_assistant_settings_row(db)
    saved = (cfg.get("public_key") or "").strip() if cfg.get("public_key") else ""
    return saved or (getattr(settings, "TELNYX_ASSISTANT_PUBLIC_KEY", None) or "").strip() or None


async def sync_active_prompt_to_telnyx(direction: Optional[str] = None) -> dict:
    """
    Pushes a combined, direction-aware system prompt to the configured Telnyx AI
    Assistant's `instructions` field via POST /v2/ai/assistants/{assistant_id}.

    Telnyx assistants have exactly ONE `instructions` field — there is no separate
    slot for inbound vs outbound. So this always renders BOTH our active outbound
    and inbound templates and combines them under a {{call_direction}} branch,
    rather than syncing only whichever direction's template was just saved (which
    would silently overwrite the other direction's behavior on the same assistant).
    The `direction` param is accepted for logging/back-compat but no longer changes
    what gets pushed — both directions are always included.

    call_direction resolves to "outbound" at dial time via Telnyx's
    AIAssistantDynamicVariables (takes priority over our webhook), or "inbound"
    by default from our /api/telnyx-assistant/call-event webhook otherwise.

    Rendered with generic (no specific prospect) context, since Telnyx's
    `instructions` is one static string, not re-rendered per call the way our own
    engine renders it live for each caller. Per-call personalization (caller name,
    company name) still works via {{dynamic_variables}} from that same webhook.

    Opens its own DB session — this is meant to be fired via asyncio.create_task from a
    request handler, so it must not depend on that request's (soon-to-close) session.

    Best-effort: never raises. A missing assistant_id/api_key or a Telnyx API failure is
    logged and returned as {"synced": False, "reason": ...} rather than breaking the
    template save/activate flow that calls this.
    """
    from app.database import AsyncSessionLocal

    try:
        async with AsyncSessionLocal() as db:
            assistant_id = await resolve_telnyx_assistant_id(db)
            if not assistant_id:
                return {"synced": False, "reason": "No Telnyx Assistant ID saved in Connections or .env — sync skipped."}

            api_key = await _resolve_telnyx_api_key(db)
            if not api_key:
                return {"synced": False, "reason": "No Telnyx API key saved in Connections or .env — sync skipped."}

            from app.services.conversation_engine import context_resolver, template_engine

            outbound_ctx = await context_resolver.resolve_outbound(db)
            inbound_ctx = await context_resolver.resolve_inbound(db, "unknown")
            outbound_tpl = await template_engine.get_active_template(db, direction="outbound")
            inbound_tpl = await template_engine.get_active_template(db, direction="inbound")
            outbound_prompt = template_engine.render_system_prompt(outbound_tpl, outbound_ctx)
            inbound_prompt = template_engine.render_system_prompt(inbound_tpl, inbound_ctx)

            instructions = (
                "You handle both outbound and inbound phone calls for this business. "
                "The call_direction for THIS call is: {{call_direction}}\n"
                "If that says \"outbound\", follow ONLY the OUTBOUND section below. "
                "If it says \"inbound\", follow ONLY the INBOUND section below. "
                "Never mention the words \"call_direction\" or these section labels out loud.\n\n"
                "=== OUTBOUND SECTION (you are calling them) ===\n"
                f"{outbound_prompt}\n\n"
                "=== INBOUND SECTION (they are calling you) ===\n"
                f"{inbound_prompt}"
            )
    except Exception as render_err:
        logger.error(f"[TELNYX-SYNC] Could not render active templates: {render_err}")
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
            details={"assistantId": assistant_id},
        )
        return {"synced": False, "reason": str(req_err)}

    if res.status_code in (200, 201):
        logger.info(f"[TELNYX-SYNC] Synced combined inbound+outbound template to Telnyx Assistant {assistant_id}.")
        await log_process_event(
            subsystem="telephony",
            process_name="telnyx_assistant_sync",
            message=f"Synced combined inbound+outbound conversation templates to Telnyx Assistant {assistant_id}.",
            level="SUCCESS",
            details={"assistantId": assistant_id, "instructionsLength": len(instructions)},
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
