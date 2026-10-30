from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import AsyncSession
from pathlib import Path
import os
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
from app.api.meeting_links import router as meeting_links_router
from app.api.profile import router as profile_router
from app.api.connections import router as connections_router
from app.api.analytics import router as analytics_router
from app.api.scheduler import router as scheduler_router
from app.api.scheduler_insights import router as scheduler_insights_router
from app.api.scheduler_tools import public_router as scheduler_public_router, router as scheduler_tools_router
from app.api.logs import router as logs_router
from app.api.sip_webhook import router as sip_webhook_router
from app.api.telnyx_assistant_webhook import router as telnyx_assistant_webhook_router
from app.api.enrichment import router as enrichment_router
from app.api.lead_accounts import router as lead_accounts_router
from app.api.lead_checks import router as lead_checks_router
from app.api.lead_assistant import router as lead_assistant_router
from app.api.plugin_assistant import router as plugin_assistant_router
from app.api.agent import router as agent_router
from app.api.mail_prefs import router as mail_prefs_router
from app.api.lead_lists import router as lead_lists_router
from app.api.connected import router as connected_router
from app.api.connected_home import router as connected_home_router
from app.api.connected_social import router as connected_social_router
from app.api.calcom import router as calcom_router
from app.api.livekit_router import router as livekit_router
from app.api.vapi_router import router as vapi_router
from app.api.retell_router import router as retell_router
from app.api.custom_voice_router import router as custom_voice_router
from app.api.conversation_templates import router as conversation_templates_router
from app.api.call_lists import router as call_lists_router
from app.api.call_schedules import router as call_schedules_router
from app.api.legal import router as legal_router
from app.api.partner_docs import router as partner_docs_router
from app.api.diagnostics import router as diagnostics_router
from app.api.voices import router as voices_router
from app.api.numbers import router as numbers_router
from app.api.number_check import router as number_check_router
from app.api.email_outreach import router as email_outreach_router
from app.api.journeys import router as journeys_router
from app.api.mail_client import router as mail_client_router
from app.api.developer_keys import router as developer_keys_router
from app.api.developer_webhooks import router as developer_webhooks_router
from app.api.partners import router as partners_router
from app.api.embed import router as embed_router
from app.api.embed_connect import router as embed_connect_router
from app.api.v1_public import router as v1_public_router
from app.public_api.preview import router as preview_router
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


async def _call_schedule_loop():
    """Start scheduled call runs at their time, with no browser open."""
    import time as _time
    from app.database import AsyncSessionLocal
    from app.services import call_schedule_engine
    from app.core.tenancy import org_scope
    from app.core.orgs import active_org_ids
    while True:
        try:
            await asyncio.sleep(30)
            for org_id in await active_org_ids():
                with org_scope(org_id):
                    async with AsyncSessionLocal() as db:
                        started = await call_schedule_engine.tick(db, _time.time() * 1000)
                    if started:
                        logger.info(f"[Call schedules] {org_id}: started {started} run(s).")
        except asyncio.CancelledError:
            raise
        except Exception as loop_err:
            logger.warning(f"[Call schedules] Cycle failed: {loop_err}")


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


async def _platform_balance_check_loop():
    """Every 6 hours: poll every platform provider we can get a real balance from, track how
    fast each is actually depleting, and email staff when one goes low or critical (see
    app.services.platform_balances), and separately check for any Data Source batch run that's
    stalled (see app.services.data_sources) -- same cadence, no reason for a second timer."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.services.platform_balances import check_and_alert
    while True:
        try:
            await asyncio.sleep(21600)
            with system_scope():
                async with AsyncSessionLocal() as db:
                    await check_and_alert(db)
                async with AsyncSessionLocal() as db:
                    from app.services.data_sources import check_stuck_runs

                    await check_stuck_runs(db)
        except asyncio.CancelledError:
            raise
        except Exception as loop_err:
            logger.warning(f"[Balances] Check cycle failed: {loop_err}")


async def _telnyx_floor_loop():
    """Every 15 minutes: one cheap Telnyx balance read, emailing staff at the $2 / $1.5 floors
    (see app.services.platform_balances.check_telnyx_floor). Emails repeat at most once a day."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.services.platform_balances import check_telnyx_floor
    await asyncio.sleep(60)
    while True:
        try:
            with system_scope():
                async with AsyncSessionLocal() as db:
                    await check_telnyx_floor(db)
        except asyncio.CancelledError:
            raise
        except Exception as loop_err:
            logger.warning(f"[Balances] Telnyx floor check failed: {loop_err}")
        await asyncio.sleep(900)


async def _find_leads_warm_loop():
    """Keeps the opening Find Leads list ready: read once soon after start-up, then every 15 minutes."""
    await asyncio.sleep(5)
    while True:
        try:
            from app.api.lead_accounts import warm_browse_pages

            await warm_browse_pages()
        except asyncio.CancelledError:
            raise
        except Exception as warm_err:
            logger.warning(f"[FindLeads] Warm-up failed: {warm_err}")
        await asyncio.sleep(900)


async def _billing_upkeep_loop():
    """Every few hours: put each company's plans right with Stripe's view (a lost webhook never leaves anyone without the
    credits they paid for or with a plan that has ended), and send last month's report to the owner from the 1st."""
    await asyncio.sleep(600)
    while True:
        try:
            from app.services import billing as B
            from app.services.billing_events import send_due_report

            await B.reconcile_all()
            await send_due_report()
        except asyncio.CancelledError:
            raise
        except Exception as loop_err:
            logger.warning(f"[Billing] Upkeep cycle failed: {loop_err}")
        await asyncio.sleep(6 * 3600)


async def _social_token_refresh_loop():
    """Once a day: renew social logins that end within a week and email staff (never customers)
    about any that need a reconnect. First pass shortly after start so a restart never skips a day."""
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.services.social_tokens import run_daily_pass
    delay = 300
    while True:
        try:
            await asyncio.sleep(delay)
            delay = 86400
            with system_scope():
                async with AsyncSessionLocal() as db:
                    await run_daily_pass(db)
        except asyncio.CancelledError:
            raise
        except Exception as loop_err:
            logger.warning(f"[Social Tokens] Daily pass failed: {loop_err}")


async def _social_results_loop():
    """Every hour, per organisation: read published posts' results and followers back from the networks
    (each channel only when its own refresh interval has passed: 6 hours, X once a day), run Listening
    searches that are due, send weekly/monthly reports that are due, and refresh the learned brand style
    once a week. Each job runs on its own, so one failing never stops the others."""
    from app.database import AsyncSessionLocal
    from app.core.tenancy import org_scope
    from app.core.orgs import active_org_ids
    from app.services import brand_voice, social_listening, social_reports
    from app.services.social_metrics import sync_org

    jobs = (("results", lambda db, org: sync_org(db)), ("listening", lambda db, org: social_listening.run_due(db)),
            ("reports", social_reports.send_due), ("learned style", lambda db, org: brand_voice.maybe_relearn(db)))
    await asyncio.sleep(900)
    while True:
        try:
            for org_id in await active_org_ids():
                for name, job in jobs:
                    try:
                        with org_scope(org_id):
                            async with AsyncSessionLocal() as db:
                                await job(db, org_id)
                    except asyncio.CancelledError:
                        raise
                    except Exception as job_err:
                        logger.warning(f"[Social] {name} for {org_id} failed: {job_err}")
        except asyncio.CancelledError:
            raise
        except Exception as loop_err:
            logger.warning(f"[Social Results] Sync cycle failed: {loop_err}")
        await asyncio.sleep(3600)


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
    try:
        from app.services.agent_runs import mark_interrupted
        stopped = await mark_interrupted()
        if stopped:
            logger.warning(f"{stopped} assistant run(s) were mid-step when the server stopped; they are marked interrupted and can be resumed.")
    except Exception as run_err:
        logger.warning(f"Could not check interrupted assistant runs: {run_err}")
    try:
        from app.services.data_sources import recover_after_restart
        resumed = await recover_after_restart()
        if resumed:
            logger.warning(f"{resumed} company-people run(s) were running when the server stopped; carrying on from where they left off.")
    except Exception as run_err:
        logger.warning(f"Could not recover data-source runs: {run_err}")
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
        # Built-in provider rows belong to the platform (Outreach), never to a client company.
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
    from app.services.connection_jobs import connections_loop
    connections_task = asyncio.create_task(connections_loop())
    number_health_task = asyncio.create_task(_telnyx_number_health_loop())
    balance_check_task = asyncio.create_task(_platform_balance_check_loop())
    telnyx_floor_task = asyncio.create_task(_telnyx_floor_loop())
    social_token_task = asyncio.create_task(_social_token_refresh_loop())
    social_results_task = asyncio.create_task(_social_results_loop())
    billing_upkeep_task = asyncio.create_task(_billing_upkeep_loop())
    find_leads_warm_task = asyncio.create_task(_find_leads_warm_loop())
    call_schedule_task = asyncio.create_task(_call_schedule_loop())
    from app.services.workflows import workflow_loop
    workflow_task = asyncio.create_task(workflow_loop())

    yield

    workflow_task.cancel()
    call_schedule_task.cancel()
    find_leads_warm_task.cancel()
    social_results_task.cancel()
    billing_upkeep_task.cancel()
    email_task.cancel()
    connections_task.cancel()
    publish_due_task.cancel()
    generation_task.cancel()
    credits_task.cancel()
    number_health_task.cancel()
    balance_check_task.cancel()
    telnyx_floor_task.cancel()
    social_token_task.cancel()
    logger.info("Shutting down Outreach by Aivhub Voice Agent API...")

expose_docs = os.getenv("EXPOSE_API_DOCS", "true").lower() in ("1", "true", "yes")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
    docs_url="/docs" if expose_docs else None,
    redoc_url="/redoc" if expose_docs else None,
    openapi_url="/openapi.json" if expose_docs else None,
)

class SecurityHeadersMiddleware:
    """Injects essential security hardening headers on all HTTP responses."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_with_security_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                existing_names = {h[0].lower() for h in headers}

                hardening = [
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"strict-origin-when-cross-origin"),
                    (b"x-xss-protection", b"0"),
                    (b"strict-transport-security", b"max-age=31536000; includeSubDomains"),
                ]
                for name, val in hardening:
                    if name not in existing_names:
                        headers.append((name, val))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_security_headers)

# Response security headers (outermost response wrapper)
app.add_middleware(SecurityHeadersMiddleware)

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
    # In production, set TRUSTED_PROXIES="127.0.0.1,10.0.0.1" (or specific reverse proxy IPs).
    # Defaults to localhost/loopback to prevent remote clients from spoofing IPs via X-Forwarded-For.
    trusted_raw = os.getenv("TRUSTED_PROXIES", "127.0.0.1,::1")
    trusted_hosts = [h.strip() for h in trusted_raw.split(",") if h.strip()]
    app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=trusted_hosts)
except Exception:
    pass

_media_dir = Path(__file__).resolve().parent / "static" / "generated"
_media_dir.mkdir(parents=True, exist_ok=True)
app.mount("/media/generated", StaticFiles(directory=str(_media_dir)), name="generated-media")

from app.core.profile import AVATAR_DIR  # noqa: E402

AVATAR_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media/avatars", StaticFiles(directory=str(AVATAR_DIR)), name="avatars")

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
app.include_router(meeting_links_router, prefix=settings.API_PREFIX)
app.include_router(profile_router, prefix=settings.API_PREFIX)
app.include_router(connections_router, prefix=settings.API_PREFIX)
app.include_router(connections_router)  # Direct /connections compatibility
app.include_router(analytics_router, prefix=settings.API_PREFIX)
app.include_router(scheduler_router, prefix=settings.API_PREFIX)
app.include_router(scheduler_insights_router, prefix=settings.API_PREFIX)
app.include_router(scheduler_tools_router, prefix=settings.API_PREFIX)
app.include_router(scheduler_public_router, prefix=settings.API_PREFIX)  # /api/l/<code>, shared report pages
app.include_router(logs_router, prefix=settings.API_PREFIX)
app.include_router(sip_webhook_router, prefix=settings.API_PREFIX)
app.include_router(sip_webhook_router)  # Direct /sip-webhook compatibility
app.include_router(telnyx_assistant_webhook_router, prefix=settings.API_PREFIX)
app.include_router(telnyx_assistant_webhook_router)  # Direct /telnyx-assistant compatibility
app.include_router(enrichment_router, prefix=settings.API_PREFIX)
app.include_router(lead_accounts_router, prefix=settings.API_PREFIX)
app.include_router(lead_checks_router, prefix=settings.API_PREFIX)
app.include_router(lead_assistant_router, prefix=settings.API_PREFIX)
app.include_router(plugin_assistant_router, prefix=settings.API_PREFIX)
app.include_router(agent_router, prefix=settings.API_PREFIX)
app.include_router(mail_prefs_router, prefix=settings.API_PREFIX)
app.include_router(lead_lists_router, prefix=settings.API_PREFIX)
app.include_router(connected_router, prefix=settings.API_PREFIX)
app.include_router(connected_home_router, prefix=settings.API_PREFIX)
app.include_router(connected_social_router, prefix=settings.API_PREFIX)
app.include_router(calcom_router, prefix=settings.API_PREFIX)
app.include_router(livekit_router, prefix=settings.API_PREFIX)
app.include_router(livekit_router)  # Direct /livekit compatibility
app.include_router(vapi_router, prefix=settings.API_PREFIX)
app.include_router(vapi_router)  # Direct /vapi compatibility
app.include_router(retell_router, prefix=settings.API_PREFIX)
app.include_router(retell_router)  # Direct /retell compatibility
app.include_router(custom_voice_router, prefix=settings.API_PREFIX)
app.include_router(custom_voice_router)  # Direct /custom-voice compatibility
app.include_router(call_lists_router, prefix=settings.API_PREFIX)
app.include_router(call_schedules_router, prefix=settings.API_PREFIX)
app.include_router(legal_router, prefix=settings.API_PREFIX)  # public notice and opt-out for people in the business data
app.include_router(partner_docs_router, prefix=settings.API_PREFIX)  # partner guides, public
app.include_router(conversation_templates_router, prefix=settings.API_PREFIX)
app.include_router(conversation_templates_router)  # Direct /conversation-templates compatibility
app.include_router(diagnostics_router, prefix=settings.API_PREFIX)
app.include_router(voices_router, prefix=settings.API_PREFIX)
app.include_router(numbers_router, prefix=settings.API_PREFIX)
app.include_router(number_check_router, prefix=settings.API_PREFIX)
app.include_router(email_outreach_router, prefix=settings.API_PREFIX)
app.include_router(journeys_router, prefix=settings.API_PREFIX)
app.include_router(mail_client_router, prefix=settings.API_PREFIX)
app.include_router(developer_keys_router, prefix=settings.API_PREFIX)
app.include_router(developer_webhooks_router, prefix=settings.API_PREFIX)
app.include_router(partners_router, prefix=settings.API_PREFIX)
app.include_router(embed_router, prefix=settings.API_PREFIX)
app.include_router(embed_connect_router, prefix=settings.API_PREFIX)
app.include_router(v1_public_router)  # Direct /v1 API compatibility
app.include_router(v1_public_router, prefix=settings.API_PREFIX)  # /api/v1 compatibility
app.include_router(preview_router, prefix=settings.API_PREFIX)  # /api/p/<token>: preview pages, no sign-in
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
<html><head><title>Outreach by Aivhub - Privacy Policy</title><meta charset="utf-8"><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;line-height:1.6;padding:0 20px;color:#222;}</style></head>
<body>
  <h1>Privacy Policy</h1>
  <p>Last updated: September 2026</p>
  <p>Outreach by Aivhub ("we", "our") respects your privacy. This Privacy Policy explains how our application connects to social media platforms including Facebook, Instagram, LinkedIn, and X.</p>
  <h2>Information We Collect</h2>
  <p>When you authorize Outreach by Aivhub to connect to your Facebook or Instagram account, we receive authorization tokens that allow scheduled posting on your behalf. We do not sell or share your personal data with any third parties.</p>
  <h2>How We Use Data</h2>
  <p>Your authentication tokens are used exclusively to publish social media posts, stories, and updates that you create and schedule inside the Outreach by Aivhub platform.</p>
  <h2>Data Retention and Deletion</h2>
  <p>You can disconnect your social accounts at any time from the Outreach by Aivhub dashboard. Upon disconnection, stored authorization tokens are permanently deleted from our servers. To request manual deletion of any associated data, email support@aivhub.com.</p>
</body></html>""")

@app.get("/terms")
@app.get("/terms-of-service")
async def terms_of_service():
    from fastapi.responses import HTMLResponse
    return HTMLResponse("""<!doctype html>
<html><head><title>Outreach by Aivhub - Terms of Service</title><meta charset="utf-8"><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;line-height:1.6;padding:0 20px;color:#222;}</style></head>
<body>
  <h1>Terms of Service</h1>
  <p>By using Outreach by Aivhub social scheduling and AI voice automation features, you agree to comply with applicable platform policies including Meta Platform Terms and Developer Policies.</p>
</body></html>""")

@app.get("/build-with-outreach")
async def build_with_outreach():
    """The public page for software companies that want to offer Outreach to their own users."""
    from fastapi.responses import HTMLResponse
    return HTMLResponse("""<!doctype html>
<html lang="en"><head><title>Build with Outreach</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:760px;margin:40px auto;line-height:1.6;padding:0 20px;color:#1b1d24}
h1{font-size:30px;margin-bottom:6px}h2{font-size:19px;margin-top:32px}code{background:#eaeefc;padding:1px 5px;border-radius:4px;font-size:.9em}
.lead{color:#555;font-size:17px}a.button{display:inline-block;background:#3457d5;color:#fff;padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:600}
li{margin:4px 0}</style></head>
<body>
  <h1>Build with Outreach</h1>
  <p class="lead">Offer AI calling, lead finding and social posting inside your own software. You build the sign-up and login pages. Your users create an Outreach account or log in to the one they have, and your product uses every feature through one endpoint.</p>
  <p><a class="button" href="/">Create an account and apply</a></p>
  <h2>How it works</h2>
  <ol>
    <li>Create an Outreach account for your company and apply from <b>Developer API &rarr; Partner programme</b>.</li>
    <li>We review the application. When you are approved, accept the partner terms.</li>
    <li>Set your web addresses, return URLs and webhook address, and take your client ID.</li>
    <li>Build your own sign-up and login pages. They call <code>POST /v1/run</code> with the <code>auth</code> plugin.</li>
    <li>Test in the sandbox: simulated calls and numbers, nothing charged.</li>
    <li>Ask to go live. We check the integration and switch it on.</li>
  </ol>
  <h2>What your users get</h2>
  <ul>
    <li>A normal Outreach account that they own, new or existing.</li>
    <li>A clear consent step: your software only reaches what they agreed to share.</li>
    <li>The option to disconnect your software at any time.</li>
  </ul>
  <h2>What you get</h2>
  <ul>
    <li>One endpoint for voice calls, lead search and email, social posts and their results, WhatsApp, mail, phone numbers and balances.</li>
    <li>Connect your users' social networks, mailboxes and video accounts from your own pages, in a popup, without ever handling a password or token.</li>
    <li>A scoped API key for each user, a sandbox with test keys, and signed webhooks for results that arrive later.</li>
    <li>Free while the programme is new. Pricing will be announced before it changes.</li>
  </ul>
  <p style="color:#777;margin-top:32px">Questions? Write to support@aivhub.com.</p>
</body></html>""")

@app.get("/data-deletion")
async def data_deletion():
    from fastapi.responses import HTMLResponse
    return HTMLResponse("""<!doctype html>
<html><head><title>Outreach by Aivhub - User Data Deletion</title><meta charset="utf-8"><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;line-height:1.6;padding:0 20px;color:#222;}</style></head>
<body>
  <h1>User Data Deletion Instructions</h1>
  <p>If you wish to delete your user data and access tokens associated with Outreach by Aivhub:</p>
  <ol>
    <li>Navigate to your Outreach by Aivhub Dashboard &rarr; Social &rarr; Social Accounts.</li>
    <li>Click "Disconnect" on any connected Facebook or Instagram account. All access tokens will be immediately purged.</li>
    <li>Alternatively, you can revoke access directly from your Facebook settings under "Business Integrations".</li>
    <li>For complete data removal, contact support@aivhub.com with your account details.</li>
  </ol>
</body></html>""")

@app.get("/")
async def root():
    return {
        "message": "Welcome to Outreach by Aivhub API",
        "docs": "/docs",
        "health": "/health"
    }
