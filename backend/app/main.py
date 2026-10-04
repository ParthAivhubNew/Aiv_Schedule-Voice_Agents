from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import AsyncSession
from pathlib import Path
import asyncio
import logging
import uuid

from app.config import settings
from app.database import engine, Base, get_db
from app.seed_data import seed_database
from app.websockets.call_hub import call_hub

from app.api.auth import router as auth_router
from app.api.signup import router as signup_router
from app.api.credits import router as credits_router
from app.api.billing import router as billing_router
from app.api.admin_portal import router as admin_portal_router
from app.api.voice_studio import router as voice_studio_router
from app.api.telnyx_numbers import router as telnyx_numbers_router
from app.api.whatsapp_inbox import router as whatsapp_inbox_router
from app.api.missions import router as missions_router
from app.api.prospects import router as prospects_router
from app.api.calls import router as calls_router
from app.api.meetings import router as meetings_router
from app.api.schedule import router as schedule_router
from app.api.profile import router as profile_router
from app.api.connections import router as connections_router
from app.api.analytics import router as analytics_router
from app.api.scheduler import router as scheduler_router
from app.api.logs import router as logs_router
from app.api.sip_webhook import router as sip_webhook_router
from app.api.telnyx_assistant_webhook import router as telnyx_assistant_webhook_router
from app.api.enrichment import router as enrichment_router
from app.api.calcom import router as calcom_router
from app.api.livekit_router import router as livekit_router
from app.api.vapi_router import router as vapi_router
from app.api.retell_router import router as retell_router
from app.api.custom_voice_router import router as custom_voice_router
from app.api.conversation_templates import router as conversation_templates_router
from app.api.diagnostics import router as diagnostics_router
from app.api.voices import router as voices_router
from app.api.numbers import router as numbers_router
from app.api.email_outreach import router as email_outreach_router
from app.websockets.media_stream import router as media_stream_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def _social_publish_due_loop():
    """Auto-publish due social posts on a timer, so scheduling works with no browser open."""
    from app.database import AsyncSessionLocal
    from app.api.scheduler import run_publish_due
    from app.core.tenancy import org_scope
    from app.core.orgs import active_org_ids
    while True:
        try:
            await asyncio.sleep(60)
            for org_id in await active_org_ids():
                with org_scope(org_id):
                    async with AsyncSessionLocal() as db:
                        result = await run_publish_due(db)
                    if result.get("published"):
                        logger.info(f"[Social Auto-Publish] {org_id}: published {len(result['published'])} due post(s).")
        except asyncio.CancelledError:
            raise
        except Exception as loop_err:
            logger.warning(f"[Social Auto-Publish] Cycle failed: {loop_err}")


async def _credits_settle_loop():
    """Charge credits for finished calls and AI posts every few minutes (never during a call)."""
    from app.services.credits import settle_all_orgs
    while True:
        try:
            await asyncio.sleep(300)
            await settle_all_orgs()
            from app.services.telnyx_usage import reconcile_due

            await reconcile_due()
            from app.services.whatsapp_signup import check_all

            await check_all()  # numbers waiting to go live on WhatsApp
        except asyncio.CancelledError:
            raise
        except Exception as loop_err:
            logger.warning(f"[Credits] Settle cycle failed: {loop_err}")


# Monthly phone number rental and release-on-unpaid-rental are handled inside
# app.services.credits.settle() (reuses the existing 5-minute settle loop below instead of a
# second, duplicate billing loop — see its comments for why).


async def _telnyx_number_health_loop():
    """Re-check already-active numbers and approved business verifications against Telnyx once
    an hour, in case Telnyx suspended, held or revoked one without sending a webhook (it doesn't
    promise one for every compliance action) — so staff and the affected customer find out the
    same day either way, not only when calls start silently failing."""
    from app.database import AsyncSessionLocal
    from app.core.tenancy import org_scope
    from app.core.orgs import active_org_ids
    from app.services import telnyx_provisioning as TP
    while True:
        try:
            await asyncio.sleep(3600)
            if not TP.platform_ready():
                continue
            for org_id in await active_org_ids():
                with org_scope(org_id):
                    async with AsyncSessionLocal() as db:
                        setup = await TP.get_setup(db)
                        if setup is None or setup.status != "ready":
                            continue
                        await TP.sweep_active_numbers(db, TP.client_for(setup))
                        await db.commit()
        except asyncio.CancelledError:
            raise
        except Exception as loop_err:
            logger.warning(f"[Telnyx] Number health sweep failed: {loop_err}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing database tables...")
    async with engine.begin() as conn:
        # Enable pgvector extension if running on PostgreSQL
        if not str(engine.url).startswith("sqlite"):
            try:
                from sqlalchemy import text
                await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
                logger.info("Verified pgvector extension enabled.")
            except Exception as ext_err:
                logger.warning(f"Could not enable pgvector extension directly: {ext_err}")
        await conn.run_sync(Base.metadata.create_all)
        from app.services.email_schema import ensure_email_schema
        await ensure_email_schema(conn)
        # Safe migration for new columns on existing tables (PostgreSQL & SQLite)
        try:
            from sqlalchemy import text
            await conn.execute(text("ALTER TABLE voice_assistants ADD COLUMN IF NOT EXISTS settings JSON;"))
        except Exception as col_err:
            logger.warning(f"Could not add voice_assistants.settings: {col_err}")
        try:
            from sqlalchemy import text
            await conn.execute(text("ALTER TABLE live_calls ADD COLUMN IF NOT EXISTS carrier_sid VARCHAR;"))
        except Exception:
            try:
                await conn.execute(text("ALTER TABLE live_calls ADD COLUMN carrier_sid VARCHAR;"))
            except Exception:
                pass

        try:
            from sqlalchemy import text
            await conn.execute(text("ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS chunk_count INTEGER DEFAULT 0;"))
        except Exception:
            try:
                await conn.execute(text("ALTER TABLE knowledge_sources ADD COLUMN chunk_count INTEGER DEFAULT 0;"))
            except Exception:
                pass

        try:
            from sqlalchemy import text
            await conn.execute(text("ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS last_error TEXT;"))
        except Exception:
            try:
                await conn.execute(text("ALTER TABLE knowledge_sources ADD COLUMN last_error TEXT;"))
            except Exception:
                pass

        try:
            from sqlalchemy import text
            await conn.execute(text("ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS crawled_at TIMESTAMPTZ;"))
        except Exception:
            try:
                await conn.execute(text("ALTER TABLE knowledge_sources ADD COLUMN crawled_at TIMESTAMP;"))
            except Exception:
                pass

        for col, col_type in [
            ("topic_id", "VARCHAR"),
            ("schedule_id", "VARCHAR"),
            ("tone", "VARCHAR"),
            ("image_url", "TEXT"),
            ("image_prompt", "TEXT"),
            ("hook", "TEXT"),
            ("linkedin_copy", "TEXT"),
            ("x_copy", "TEXT"),
            ("facebook_copy", "TEXT"),
            ("instagram_copy", "TEXT"),
            ("threads_copy", "TEXT"),
            ("hashtags", "JSON"),
            ("cta", "TEXT"),
            ("first_comment", "TEXT"),
            ("alt_text", "TEXT"),
            ("publish_results", "JSON"),
            ("published_at", "VARCHAR"),
        ]:
            try:
                await conn.execute(text(f"ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS {col} {col_type};"))
            except Exception:
                try:
                    await conn.execute(text(f"ALTER TABLE social_posts ADD COLUMN {col} {col_type};"))
                except Exception:
                    pass

        # Safe migration for conversation_templates: business rules + demo script
        # (migrated in from CompanyProfile's old Call Script & Rules fields)
        for col, col_type in [
            ("custom_rules", "TEXT"),
            ("demo_script", "TEXT"),
        ]:
            try:
                await conn.execute(text(f"ALTER TABLE conversation_templates ADD COLUMN IF NOT EXISTS {col} {col_type};"))
            except Exception:
                try:
                    await conn.execute(text(f"ALTER TABLE conversation_templates ADD COLUMN {col} {col_type};"))
                except Exception:
                    pass

        # Safe migration for meetings table Cal.com columns
        for col, col_type in [
            ("host_email", "VARCHAR DEFAULT 'admin@aivhub.io'"),
            ("attendee_email", "VARCHAR"),
            ("calcom_booking_id", "VARCHAR"),
            ("event_type_slug", "VARCHAR DEFAULT '15-min-discovery'"),
            ("cancellation_reason", "TEXT"),
            ("host_timezone", "VARCHAR DEFAULT 'Europe/London'"),
            ("prospect_timezone", "VARCHAR"),
            ("prospect_date", "VARCHAR"),
            ("prospect_time", "VARCHAR"),
            ("starts_at_utc", "TIMESTAMP"),
        ]:
            try:
                await conn.execute(text(f"ALTER TABLE meetings ADD COLUMN IF NOT EXISTS {col} {col_type};"))
            except Exception:
                try:
                    await conn.execute(text(f"ALTER TABLE meetings ADD COLUMN {col} {col_type};"))
                except Exception:
                    pass

        for col, col_type in [
            ("spoken_name", "VARCHAR"),
            ("call_opener", "TEXT"),
            ("call_hook", "TEXT"),
            ("closing_ask", "TEXT"),
            ("custom_rules", "TEXT"),
            ("demo_script", "TEXT"),
            ("calendar_mode", "VARCHAR DEFAULT 'internal'"),
            ("default_outbound_template_id", "VARCHAR"),
            ("default_inbound_template_id", "VARCHAR"),
            ("week_start", "VARCHAR DEFAULT 'monday'"),
            ("time_format", "VARCHAR DEFAULT '24h'"),
            ("approver_emails", "JSON"),
        ]:
            try:
                await conn.execute(text(f"ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS {col} {col_type};"))
            except Exception:
                try:
                    await conn.execute(text(f"ALTER TABLE company_profile ADD COLUMN {col} {col_type};"))
                except Exception:
                    pass

        try:
            from sqlalchemy import text
            await conn.execute(text("ALTER TABLE social_oauth_apps ADD COLUMN IF NOT EXISTS config_id VARCHAR DEFAULT '';"))
        except Exception:
            try:
                await conn.execute(text("ALTER TABLE social_oauth_apps ADD COLUMN config_id VARCHAR DEFAULT '';"))
            except Exception:
                pass

        for col, col_type in [
            ("prospect_timezone_override", "VARCHAR"),
            ("working_hours_by_day", "JSON"),
            ("slot_step_minutes", "INTEGER DEFAULT 15"),
            ("flex_minutes", "INTEGER DEFAULT 0"),
            ("booking_policy", "JSON"),
            ("invite_html_attendee", "TEXT"),
            ("invite_html_host", "TEXT"),
        ]:
            try:
                await conn.execute(text(f"ALTER TABLE calcom_settings ADD COLUMN IF NOT EXISTS {col} {col_type};"))
            except Exception:
                try:
                    await conn.execute(text(f"ALTER TABLE calcom_settings ADD COLUMN {col} {col_type};"))
                except Exception:
                    pass

        for col, col_type in [
            ("prospect_timezone", "VARCHAR"),
            ("carrier", "VARCHAR"),
        ]:
            try:
                await conn.execute(text(f"ALTER TABLE live_calls ADD COLUMN IF NOT EXISTS {col} {col_type};"))
            except Exception:
                try:
                    await conn.execute(text(f"ALTER TABLE live_calls ADD COLUMN {col} {col_type};"))
                except Exception:
                    pass

        for col, col_type in [
            ("kind", "VARCHAR DEFAULT 'phone'"),
            ("phone", "VARCHAR"),
            ("email", "VARCHAR"),
            ("video_link", "VARCHAR"),
            ("platform", "VARCHAR"),
            ("address", "VARCHAR"),
            ("notes", "TEXT"),
            ("whatsapp_to", "VARCHAR"),
            ("notify_whatsapp", "BOOLEAN DEFAULT 0"),
            ("meeting_id", "VARCHAR"),
        ]:
            try:
                await conn.execute(text(f"ALTER TABLE schedule_items ADD COLUMN IF NOT EXISTS {col} {col_type};"))
            except Exception:
                try:
                    await conn.execute(text(f"ALTER TABLE schedule_items ADD COLUMN {col} {col_type};"))
                except Exception:
                    pass

        # Safe migration for multi-tenant org_id
        for tbl in ["operators", "company_profile", "missions", "live_calls", "connections"]:
            try:
                await conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS org_id VARCHAR;"))
            except Exception:
                try:
                    await conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN org_id VARCHAR;"))
                except Exception:
                    pass
        try:
            await conn.execute(text("""
                INSERT INTO organizations (id, name, slug, status)
                VALUES ('org_default', 'Default Organization', 'default', 'active')
                ON CONFLICT (id) DO NOTHING;
            """))
        except Exception:
            try:
                await conn.execute(text("""
                    INSERT OR IGNORE INTO organizations (id, name, slug, status)
                    VALUES ('org_default', 'Default Organization', 'default', 'active');
                """))
            except Exception:
                pass
        for tbl in ["operators", "company_profile", "missions", "live_calls"]:
            try:
                await conn.execute(text(f"UPDATE {tbl} SET org_id = 'org_default' WHERE org_id IS NULL;"))
            except Exception:
                pass

    # Numbered schema/data steps (new columns, hashed passwords, roles) run before anything
    # reads the tables through the models, so an upgrade never queries a missing column.
    from app.core.migrations import run_migrations
    from app.core.security import resolve_signing_key
    async with engine.begin() as conn:
        await run_migrations(conn)
    await seed_database()
    # Organisation isolation: org_id columns, per-org keys, app role and RLS policies.
    from app.core.tenancy import ensure_tenancy
    async with engine.begin() as conn:
        await ensure_tenancy(conn)
    # A brand-new database seeds provider rows into Aivhub; they belong to the platform.
    from app.core.platform import split_platform
    async with engine.begin() as conn:
        await split_platform(conn)
    await resolve_signing_key()
    from app.services.telnyx_client import refresh_saved_key
    await refresh_saved_key()
    from app.services.platform_mailbox import refresh as refresh_platform_mailbox
    await refresh_platform_mailbox()
    from app.core.staff import ensure_bootstrap_staff
    await ensure_bootstrap_staff()
    try:
        from app.core.platform import ensure_aivhub_ready
        await ensure_aivhub_ready()
    except Exception as aivhub_err:
        logger.warning(f"Aivhub demo setup skipped: {aivhub_err}")
    if (settings.LIVEKIT_API_SECRET or "").startswith("secret1234567890") or (settings.LIVEKIT_API_KEY or "") == "devkey":
        logger.warning(
            "LiveKit is using the development key/secret that is published in the repository. "
            "Anyone can create LiveKit room tokens with it. Set LIVEKIT_API_KEY / LIVEKIT_API_SECRET "
            "(and the same pair in livekit.yaml) to new random values."
        )
    try:
        from app.database import AsyncSessionLocal
        from app.models.models import LiveCall
        from sqlalchemy.future import select as sweep_select
        async with AsyncSessionLocal() as sweep_db:
            orphans = (await sweep_db.execute(
                sweep_select(LiveCall).where(LiveCall.ended == False)
            )).scalars().all()
            for orphan in orphans:
                orphan.ended = True
                orphan.state = "ended"
                orphan.transcript = (orphan.transcript or []) + [
                    "System: Call auto-closed on server restart — no live session could have survived the process restart."
                ]
            if orphans:
                await sweep_db.commit()
                logger.warning(f"[Startup Sweep] Closed {len(orphans)} orphaned live call(s) left over from a previous process (crash/restart).")
    except Exception as sweep_err:
        logger.warning(f"[Startup Sweep] Could not sweep orphaned live calls: {sweep_err}")
    try:
        from app.database import AsyncSessionLocal
        from app.models.models import Connection
        from app.services.secret_box import seal_config
        from sqlalchemy.future import select
        from app.core.platform import platform_org_id
        from app.core.tenancy import org_scope
        # Built-in provider rows belong to the platform (OutReach), never to a client company.
        with org_scope(platform_org_id()):
            async with AsyncSessionLocal() as init_db:
                # Auto-configure LiveKit (self-hosted) connection if missing or not configured
                r_lk = await init_db.execute(
                    select(Connection).where(
                        Connection.group_name == "Voice Orchestration",
                        Connection.name.ilike("%livekit%")
                    )
                )
                lk_conn = r_lk.scalars().first()
                # Only ever mark this "connected" when a real LIVEKIT_API_KEY is configured —
                # never from the "devkey"/dev-default fallback, so the UI doesn't show a
                # connection as active/saved when nobody actually configured one.
                has_real_livekit_key = bool(settings.LIVEKIT_API_KEY and settings.LIVEKIT_API_KEY != "devkey")
                if not lk_conn:
                    lk_conn = Connection(
                        id=f"c_vo_livekit_{uuid.uuid4().hex[:6]}",
                        group_name="Voice Orchestration",
                        name="LiveKit (self-hosted)",
                        status="connected" if has_real_livekit_key else "not_configured",
                        config=seal_config({
                            "api_key": settings.LIVEKIT_API_KEY or "",
                            "api_secret": settings.LIVEKIT_API_SECRET or "",
                            "base_url": settings.LIVEKIT_URL or "ws://localhost:7880",
                        }) if has_real_livekit_key else {"base_url": settings.LIVEKIT_URL or "ws://localhost:7880"},
                        api_key_masked=f"{settings.LIVEKIT_API_KEY[:4]}••••" if has_real_livekit_key else None,
                    )
                    init_db.add(lk_conn)
                    await init_db.commit()
                    logger.info("Auto-configured LiveKit (self-hosted) connection row (status=%s).", lk_conn.status)
                elif has_real_livekit_key and lk_conn.status != "connected":
                    lk_conn.status = "connected"
                    if not lk_conn.config or not isinstance(lk_conn.config, dict):
                        lk_conn.config = seal_config({
                            "api_key": settings.LIVEKIT_API_KEY,
                            "api_secret": settings.LIVEKIT_API_SECRET or "",
                            "base_url": settings.LIVEKIT_URL or "ws://localhost:7880",
                        })
                    lk_conn.api_key_masked = lk_conn.api_key_masked or f"{settings.LIVEKIT_API_KEY[:4]}••••"
                    await init_db.commit()

                # Ensure xAI Voice Agent is in Text-to-Speech
                r_xai_tts = await init_db.execute(
                    select(Connection).where(
                        Connection.group_name == "Text-to-Speech",
                        Connection.name.ilike("%xai%")
                    )
                )
                if not r_xai_tts.scalars().first():
                    xai_tts_conn = Connection(
                        id=f"c_tts_xai_{uuid.uuid4().hex[:6]}",
                        group_name="Text-to-Speech",
                        name="xAI Voice Agent",
                        status="connected" if settings.XAI_API_KEY else "not_configured",
                        config=seal_config({
                            "api_key": settings.XAI_API_KEY or "",
                            "model": "xai built-in (rex)",
                        }),
                        api_key_masked=f"{(settings.XAI_API_KEY or '')[:6]}••••" if settings.XAI_API_KEY else None,
                    )
                    init_db.add(xai_tts_conn)
                    await init_db.commit()

                # Ensure xAI Voice Agent is in Voice Orchestration
                r_xai_vo = await init_db.execute(
                    select(Connection).where(
                        Connection.group_name == "Voice Orchestration",
                        Connection.name.ilike("%xai%")
                    )
                )
                if not r_xai_vo.scalars().first():
                    xai_vo_conn = Connection(
                        id=f"c_vo_xai_{uuid.uuid4().hex[:6]}",
                        group_name="Voice Orchestration",
                        name="xAI Voice Agent",
                        status="connected" if settings.XAI_API_KEY else "not_configured",
                        config=seal_config({"api_key": settings.XAI_API_KEY or ""}),
                        api_key_masked=f"{(settings.XAI_API_KEY or '')[:6]}••••" if settings.XAI_API_KEY else None,
                    )
                    init_db.add(xai_vo_conn)
                    await init_db.commit()

                # Ensure standard provider connections exist (Telnyx AI/STT/TTS, Twilio, Deepgram, Cartesia, ElevenLabs, etc.)
                standard_templates = [
                    ("LLM", "Telnyx AI", "meta-llama/Meta-Llama-3.1-70B-Instruct"),
                    ("Speech-to-Text", "Telnyx Whisper", "openai/whisper-large-v3"),
                    ("Text-to-Speech", "Telnyx Natural (TTS)", "telnyx/natural"),
                    ("Telephony", "Telnyx", ""),
                    ("Speech-to-Text", "Deepgram", "nova-2"),
                    ("Text-to-Speech", "Cartesia", "sonic-3"),
                    ("Text-to-Speech", "ElevenLabs", "eleven_turbo_v2_5"),
                    ("LLM", "DeepSeek", "deepseek-chat"),
                    ("LLM", "OpenAI", "gpt-4o-mini"),
                    ("LLM", "Anthropic (Claude)", "claude-3-5-sonnet-20241022"),
                    ("Telephony", "Twilio", ""),
                ]
                for group, name, default_model in standard_templates:
                    conn_id = f"c_{group.lower()[:3]}_{name.lower().replace(' ', '_').replace('(', '').replace(')', '')}"
                    res = await init_db.execute(
                        select(Connection).where(
                            (Connection.id == conn_id)
                            | ((Connection.group_name == group) & (Connection.name == name))
                        )
                    )
                    if not res.scalars().first():
                        init_db.add(Connection(
                            id=conn_id,
                            group_name=group,
                            name=name,
                            status="not_configured",
                            config={"model": default_model, "provider": name} if default_model else {"provider": name}
                        ))
                await init_db.commit()

    except Exception as auto_conn_err:
        logger.warning("Auto-configuration of built-in connections skipped: %s", auto_conn_err)
    try:
        from app.database import AsyncSessionLocal
        from app.services.secret_box import migrate_seal_all_connections, migrate_seal_column_secrets
        async with AsyncSessionLocal() as seal_db:
            n1 = await migrate_seal_all_connections(seal_db)
            n2 = await migrate_seal_column_secrets(seal_db)
            if n1 or n2:
                logger.info("Sealed %s connection row(s) and %s column secret row(s) at startup.", n1, n2)
    except Exception as seal_err:
        logger.warning("Secret seal migration skipped: %s", seal_err)
    try:
        from app.services.process_logger import log_process_event
        await log_process_event(
            subsystem="system",
            process_name="backend_startup",
            message=f"{settings.PROJECT_NAME} v{settings.VERSION} started successfully. All database models and pgvector initialized.",
            level="SUCCESS",
            details={"version": settings.VERSION, "dbUrl": str(engine.url).split("@")[-1] if "@" in str(engine.url) else "sqlite"}
        )
    except Exception:
        pass

    try:
        from app.services.voice_plugin_plan import load_active_stack, resolve_voice_plan
        active_stack = await load_active_stack()
        logger.info(f"[Startup Voice Stack] Loaded active voice stack: {active_stack}")
        try:
            plan = await resolve_voice_plan()
            logger.info(
                f"[Startup Voice Plan] Live voice plan ready:\n"
                f"  - Engine: {plan.engine}\n"
                f"  - Voice Name: {plan.voice_name}\n"
                f"  - Carrier: {plan.carrier}\n"
                f"  - STT: {plan.stt.provider if plan.stt else 'None'} (model={plan.stt.model if plan.stt else 'None'})\n"
                f"  - TTS: {plan.tts.provider if plan.tts else 'None'} (model={plan.tts.model if plan.tts else 'None'}, voice_id={plan.tts.voice_id if plan.tts else 'None'})\n"
                f"  - LLM: {plan.llm.provider if plan.llm else 'None'} (model={plan.llm.model if plan.llm else 'None'})\n"
                f"  - External TTS: {plan.external_tts}\n"
                f"  - Note: {plan.note}"
            )
        except Exception as plan_res_err:
            logger.warning(f"[Startup Voice Plan] Live voice plan not fully configured yet: {plan_res_err}")
    except Exception as stack_log_err:
        logger.warning(f"[Startup Voice Plan] Could not inspect active voice stack at startup: {stack_log_err}")

    try:
        from app.database import AsyncSessionLocal
        from app.services.voice_library import migrate_legacy
        async with AsyncSessionLocal() as voice_db:
            await migrate_legacy(voice_db)
    except Exception as voice_mig_err:
        logger.warning(f"[Voices] Library migration failed: {voice_mig_err}")

    try:
        from app.services.org_settings import migrate_calendar_timezone
        await migrate_calendar_timezone()
    except Exception as org_tz_err:
        logger.warning(f"[Org] Timezone migration failed: {org_tz_err}")

    try:
        from app.api.scheduler import ensure_social_schema
        await ensure_social_schema()
    except Exception as social_schema_err:
        logger.warning(f"[Social] Schema check failed: {social_schema_err}")

    publish_due_task = asyncio.create_task(_social_publish_due_loop())
    credits_task = asyncio.create_task(_credits_settle_loop())
    from app.services.generation_queue import generation_loop
    generation_task = asyncio.create_task(generation_loop())
    from app.services.email_worker import email_loop
    email_task = asyncio.create_task(email_loop())
    number_health_task = asyncio.create_task(_telnyx_number_health_loop())

    yield

    email_task.cancel()
    publish_due_task.cancel()
    generation_task.cancel()
    credits_task.cancel()
    number_health_task.cancel()
    logger.info("Shutting down OutReach by Aivhub Voice Agent API...")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

# Sign-in and permission check for every request (innermost, so CORS headers still apply to 401/403).
from app.core.auth_middleware import AuthMiddleware, install_log_redaction
app.add_middleware(AuthMiddleware)
install_log_redaction()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

try:
    from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
    app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")
except Exception:
    pass

_media_dir = Path(__file__).resolve().parent / "static" / "generated"
_media_dir.mkdir(parents=True, exist_ok=True)
app.mount("/media/generated", StaticFiles(directory=str(_media_dir)), name="generated-media")

try:
    from starlette.formparsers import MultiPartParser
    MultiPartParser.max_part_size = 25 * 1024 * 1024
except Exception:
    pass

# Mount REST API Routers
app.include_router(auth_router, prefix=settings.API_PREFIX)
app.include_router(signup_router, prefix=settings.API_PREFIX)
app.include_router(credits_router, prefix=settings.API_PREFIX)
app.include_router(billing_router, prefix=settings.API_PREFIX)
app.include_router(admin_portal_router, prefix=settings.API_PREFIX)
app.include_router(voice_studio_router, prefix=settings.API_PREFIX)
app.include_router(telnyx_numbers_router, prefix=settings.API_PREFIX)
app.include_router(whatsapp_inbox_router, prefix=settings.API_PREFIX)
app.include_router(missions_router, prefix=settings.API_PREFIX)
app.include_router(prospects_router, prefix=settings.API_PREFIX)
app.include_router(calls_router, prefix=settings.API_PREFIX)
app.include_router(calls_router)  # Direct /calls compatibility
app.include_router(meetings_router, prefix=settings.API_PREFIX)
app.include_router(schedule_router, prefix=settings.API_PREFIX)
app.include_router(profile_router, prefix=settings.API_PREFIX)
app.include_router(connections_router, prefix=settings.API_PREFIX)
app.include_router(connections_router)  # Direct /connections compatibility
app.include_router(analytics_router, prefix=settings.API_PREFIX)
app.include_router(scheduler_router, prefix=settings.API_PREFIX)
app.include_router(logs_router, prefix=settings.API_PREFIX)
app.include_router(sip_webhook_router, prefix=settings.API_PREFIX)
app.include_router(sip_webhook_router)  # Direct /sip-webhook compatibility
app.include_router(telnyx_assistant_webhook_router, prefix=settings.API_PREFIX)
app.include_router(telnyx_assistant_webhook_router)  # Direct /telnyx-assistant compatibility
app.include_router(enrichment_router, prefix=settings.API_PREFIX)
app.include_router(calcom_router, prefix=settings.API_PREFIX)
app.include_router(livekit_router, prefix=settings.API_PREFIX)
app.include_router(livekit_router)  # Direct /livekit compatibility
app.include_router(vapi_router, prefix=settings.API_PREFIX)
app.include_router(vapi_router)  # Direct /vapi compatibility
app.include_router(retell_router, prefix=settings.API_PREFIX)
app.include_router(retell_router)  # Direct /retell compatibility
app.include_router(custom_voice_router, prefix=settings.API_PREFIX)
app.include_router(custom_voice_router)  # Direct /custom-voice compatibility
app.include_router(conversation_templates_router, prefix=settings.API_PREFIX)
app.include_router(conversation_templates_router)  # Direct /conversation-templates compatibility
app.include_router(diagnostics_router, prefix=settings.API_PREFIX)
app.include_router(voices_router, prefix=settings.API_PREFIX)
app.include_router(numbers_router, prefix=settings.API_PREFIX)
app.include_router(email_outreach_router, prefix=settings.API_PREFIX)
app.include_router(diagnostics_router)  # Direct /diagnostics compatibility
app.include_router(media_stream_router)  # /ws/media-stream and /ws/listen/{call_id}

# Universal Direct Fallback Webhooks for Twilio Inbound Voice
@app.api_route("/twilio/inbound", methods=["GET", "POST"])
@app.api_route("/twilio/voice", methods=["GET", "POST"])
@app.api_route("/api/twilio/inbound", methods=["GET", "POST"])
@app.api_route("/api/twilio/voice", methods=["GET", "POST"])
async def direct_twilio_inbound_fallback(request: Request, db: AsyncSession = Depends(get_db)):
    from app.api.calls import twilio_inbound_voice
    return await twilio_inbound_voice(request, db)

@app.api_route("/api/sip/webhook", methods=["GET", "POST"])
@app.api_route("/sip/webhook", methods=["GET", "POST"])
async def direct_sip_webhook_slash_alias(request: Request, background_tasks: BackgroundTasks):
    from app.api.sip_webhook import handle_xai_sip_webhook
    return await handle_xai_sip_webhook(request, background_tasks)


# WebSocket Endpoint
@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await call_hub.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Echo or process client command if needed
            await websocket.send_text(f'{{"type": "ack", "received": "{data}"}}')
    except WebSocketDisconnect:
        call_hub.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        call_hub.disconnect(websocket)

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "mode": settings.VOICE_ENGINE_MODE
    }

@app.get("/privacy")
@app.get("/privacy-policy")
async def privacy_policy():
    from fastapi.responses import HTMLResponse
    return HTMLResponse("""<!doctype html>
<html><head><title>OutReach by Aivhub - Privacy Policy</title><meta charset="utf-8"><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;line-height:1.6;padding:0 20px;color:#222;}</style></head>
<body>
  <h1>Privacy Policy</h1>
  <p>Last updated: September 2026</p>
  <p>OutReach by Aivhub ("we", "our") respects your privacy. This Privacy Policy explains how our application connects to social media platforms including Facebook, Instagram, LinkedIn, and X.</p>
  <h2>Information We Collect</h2>
  <p>When you authorize OutReach by Aivhub to connect to your Facebook or Instagram account, we receive authorization tokens that allow scheduled posting on your behalf. We do not sell or share your personal data with any third parties.</p>
  <h2>How We Use Data</h2>
  <p>Your authentication tokens are used exclusively to publish social media posts, stories, and updates that you create and schedule inside the OutReach by Aivhub platform.</p>
  <h2>Data Retention and Deletion</h2>
  <p>You can disconnect your social accounts at any time from the OutReach by Aivhub dashboard. Upon disconnection, stored authorization tokens are permanently deleted from our servers. To request manual deletion of any associated data, email support@aivhub.com.</p>
</body></html>""")

@app.get("/terms")
@app.get("/terms-of-service")
async def terms_of_service():
    from fastapi.responses import HTMLResponse
    return HTMLResponse("""<!doctype html>
<html><head><title>OutReach by Aivhub - Terms of Service</title><meta charset="utf-8"><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;line-height:1.6;padding:0 20px;color:#222;}</style></head>
<body>
  <h1>Terms of Service</h1>
  <p>By using OutReach by Aivhub social scheduling and AI voice automation features, you agree to comply with applicable platform policies including Meta Platform Terms and Developer Policies.</p>
</body></html>""")

@app.get("/data-deletion")
async def data_deletion():
    from fastapi.responses import HTMLResponse
    return HTMLResponse("""<!doctype html>
<html><head><title>OutReach by Aivhub - User Data Deletion</title><meta charset="utf-8"><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;line-height:1.6;padding:0 20px;color:#222;}</style></head>
<body>
  <h1>User Data Deletion Instructions</h1>
  <p>If you wish to delete your user data and access tokens associated with OutReach by Aivhub:</p>
  <ol>
    <li>Navigate to your OutReach by Aivhub Dashboard &rarr; Post Scheduler &rarr; Social Accounts.</li>
    <li>Click "Disconnect" on any connected Facebook or Instagram account. All access tokens will be immediately purged.</li>
    <li>Alternatively, you can revoke access directly from your Facebook settings under "Business Integrations".</li>
    <li>For complete data removal, contact support@aivhub.com with your account details.</li>
  </ol>
</body></html>""")

@app.get("/")
async def root():
    return {
        "message": "Welcome to OutReach by Aivhub API",
        "docs": "/docs",
        "health": "/health"
    }
