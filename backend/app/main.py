from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from app.config import settings
from app.database import engine, Base
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

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing database tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await seed_database()
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

# Mount REST API Routers
app.include_router(auth_router, prefix=settings.API_PREFIX)
app.include_router(missions_router, prefix=settings.API_PREFIX)
app.include_router(prospects_router, prefix=settings.API_PREFIX)
app.include_router(calls_router, prefix=settings.API_PREFIX)
app.include_router(meetings_router, prefix=settings.API_PREFIX)
app.include_router(schedule_router, prefix=settings.API_PREFIX)
app.include_router(profile_router, prefix=settings.API_PREFIX)
app.include_router(connections_router, prefix=settings.API_PREFIX)
app.include_router(analytics_router, prefix=settings.API_PREFIX)
app.include_router(scheduler_router, prefix=settings.API_PREFIX)

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

@app.get("/")
async def root():
    return {
        "message": "Welcome to AIVHub Voice AI Agent API",
        "docs": "/docs",
        "health": "/health"
    }
