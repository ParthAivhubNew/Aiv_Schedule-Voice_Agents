from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import AsyncSession
from pathlib import Path
import logging

from app.config import settings
from app.database import engine, Base, get_db
from app.seed_data import seed_database
from app.websockets.call_hub import call_hub

from app.api.auth import router as auth_router
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
from app.api.enrichment import router as enrichment_router
from app.api.calcom import router as calcom_router
from app.websockets.media_stream import router as media_stream_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
        # Safe migration for new columns on existing tables (PostgreSQL & SQLite)
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
            ("prospect_timezone_override", "VARCHAR"),
            ("working_hours_by_day", "JSON"),
            ("slot_step_minutes", "INTEGER DEFAULT 15"),
            ("flex_minutes", "INTEGER DEFAULT 0"),
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
    await seed_database()
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
    yield
    logger.info("Shutting down AIVHub Voice Agent API...")

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

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
app.include_router(missions_router, prefix=settings.API_PREFIX)
app.include_router(prospects_router, prefix=settings.API_PREFIX)
app.include_router(calls_router, prefix=settings.API_PREFIX)
app.include_router(calls_router)  # Direct /calls compatibility
app.include_router(meetings_router, prefix=settings.API_PREFIX)
app.include_router(schedule_router, prefix=settings.API_PREFIX)
app.include_router(profile_router, prefix=settings.API_PREFIX)
app.include_router(connections_router, prefix=settings.API_PREFIX)
app.include_router(analytics_router, prefix=settings.API_PREFIX)
app.include_router(scheduler_router, prefix=settings.API_PREFIX)
app.include_router(logs_router, prefix=settings.API_PREFIX)
app.include_router(sip_webhook_router, prefix=settings.API_PREFIX)
app.include_router(sip_webhook_router)  # Direct /sip-webhook compatibility
app.include_router(enrichment_router, prefix=settings.API_PREFIX)
app.include_router(calcom_router, prefix=settings.API_PREFIX)
app.include_router(media_stream_router)  # /ws/media-stream and /ws/listen/{call_id}

# Universal Direct Fallback Webhooks for Twilio Inbound Voice
@app.api_route("/twilio/inbound", methods=["GET", "POST"])
@app.api_route("/twilio/voice", methods=["GET", "POST"])
@app.api_route("/api/twilio/inbound", methods=["GET", "POST"])
@app.api_route("/api/twilio/voice", methods=["GET", "POST"])
async def direct_twilio_inbound_fallback(request: Request, db: AsyncSession = Depends(get_db)):
    from app.api.calls import twilio_inbound_voice
    return await twilio_inbound_voice(request, db)


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
<html><head><title>AIVHub - Privacy Policy</title><meta charset="utf-8"><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;line-height:1.6;padding:0 20px;color:#222;}</style></head>
<body>
  <h1>Privacy Policy</h1>
  <p>Last updated: September 2026</p>
  <p>AIVHub ("we", "our") respects your privacy. This Privacy Policy explains how our application connects to social media platforms including Facebook, Instagram, LinkedIn, and X.</p>
  <h2>Information We Collect</h2>
  <p>When you authorize AIVHub to connect to your Facebook or Instagram account, we receive authorization tokens that allow scheduled posting on your behalf. We do not sell or share your personal data with any third parties.</p>
  <h2>How We Use Data</h2>
  <p>Your authentication tokens are used exclusively to publish social media posts, stories, and updates that you create and schedule inside the AIVHub platform.</p>
  <h2>Data Retention and Deletion</h2>
  <p>You can disconnect your social accounts at any time from the AIVHub dashboard. Upon disconnection, stored authorization tokens are permanently deleted from our servers. To request manual deletion of any associated data, email support@aivhub.com.</p>
</body></html>""")

@app.get("/terms")
@app.get("/terms-of-service")
async def terms_of_service():
    from fastapi.responses import HTMLResponse
    return HTMLResponse("""<!doctype html>
<html><head><title>AIVHub - Terms of Service</title><meta charset="utf-8"><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;line-height:1.6;padding:0 20px;color:#222;}</style></head>
<body>
  <h1>Terms of Service</h1>
  <p>By using AIVHub social scheduling and AI voice automation features, you agree to comply with applicable platform policies including Meta Platform Terms and Developer Policies.</p>
</body></html>""")

@app.get("/data-deletion")
async def data_deletion():
    from fastapi.responses import HTMLResponse
    return HTMLResponse("""<!doctype html>
<html><head><title>AIVHub - User Data Deletion</title><meta charset="utf-8"><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;line-height:1.6;padding:0 20px;color:#222;}</style></head>
<body>
  <h1>User Data Deletion Instructions</h1>
  <p>If you wish to delete your user data and access tokens associated with AIVHub:</p>
  <ol>
    <li>Navigate to your AIVHub Dashboard &rarr; Post Scheduler &rarr; Social Accounts.</li>
    <li>Click "Disconnect" on any connected Facebook or Instagram account. All access tokens will be immediately purged.</li>
    <li>Alternatively, you can revoke access directly from your Facebook settings under "Business Integrations".</li>
    <li>For complete data removal, contact support@aivhub.com with your account details.</li>
  </ol>
</body></html>""")

@app.get("/api/whatsapp/webhook")
@app.get("/whatsapp/webhook")
async def whatsapp_webhook_verify(request: Request):
    """Meta WhatsApp Webhook Verification handshake."""
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")
    expected_token = os.getenv("WHATSAPP_VERIFY_TOKEN", "aivhub_whatsapp_webhook_secret")
    if mode == "subscribe" and token == expected_token:
        from fastapi.responses import PlainTextResponse
        logger.info("[WhatsApp Webhook] Verification successful!")
        return PlainTextResponse(challenge or "", status_code=200)
    logger.warning("[WhatsApp Webhook] Verification failed for token: %s", token)
    from fastapi.responses import Response
    return Response("Verification failed", status_code=403)


@app.post("/api/whatsapp/webhook")
@app.post("/whatsapp/webhook")
async def whatsapp_webhook_receive(request: Request, db: AsyncSession = Depends(get_db)):
    """Handle incoming WhatsApp messages and delivery statuses from Meta."""
    try:
        body = await request.json()
        logger.info("[WhatsApp Webhook] Incoming event: %s", body)
        entry = (body.get("entry") or [{}])[0]
        changes = (entry.get("changes") or [{}])[0]
        value = changes.get("value") or {}
        messages = value.get("messages") or []
        for msg in messages:
            from_wa = msg.get("from")
            text = (msg.get("text") or {}).get("body", "")
            logger.info("[WhatsApp Message] Received from %s: %s", from_wa, text)
        return {"status": "ok"}
    except Exception as e:
        logger.error("[WhatsApp Webhook] Error processing event: %s", e)
        return {"status": "error", "error": str(e)}


@app.get("/")
async def root():
    return {
        "message": "Welcome to AIVHub Voice AI Agent API",
        "docs": "/docs",
        "health": "/health"
    }
