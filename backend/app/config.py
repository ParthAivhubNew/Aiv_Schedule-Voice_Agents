from pydantic_settings import BaseSettings
from typing import Optional
import os

class Settings(BaseSettings):
    PROJECT_NAME: str = "AIVHub Voice AI Agent"
    VERSION: str = "1.0.0"
    API_PREFIX: str = "/api"
    
    # Database configuration (Defaults to SQLite for instant local dev, PostgreSQL for Docker)
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "sqlite+aiosqlite:///./aivhub.db"
    )
    
    # Redis configuration
    REDIS_URL: Optional[str] = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    
    # Security
    SECRET_KEY: str = os.getenv("SECRET_KEY", "aivhub-secret-key-change-in-production-2026")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    
    # Voice and Telephony API configurations (optional, falls back to simulator if unset)
    TWILIO_ACCOUNT_SID: Optional[str] = None
    TWILIO_AUTH_TOKEN: Optional[str] = None
    TWILIO_PHONE_NUMBER: Optional[str] = None
    TWILIO_WHATSAPP_NUMBER: Optional[str] = os.getenv("TWILIO_WHATSAPP_NUMBER", None)
    # Parallel outbound: operator concurrency is honored up to this cap.
    # CPS gap keeps Twilio/Telnyx from rejecting a burst (default ~1 call/sec).
    OUTBOUND_MAX_CONCURRENCY: int = int(os.getenv("OUTBOUND_MAX_CONCURRENCY", "5"))
    OUTBOUND_CPS_GAP_SEC: float = float(os.getenv("OUTBOUND_CPS_GAP_SEC", "0.45"))
    
    DEEPGRAM_API_KEY: Optional[str] = None
    ELEVENLABS_API_KEY: Optional[str] = None
    CARTESIA_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    ANTHROPIC_API_KEY: Optional[str] = None
    DEEPSEEK_API_KEY: Optional[str] = None
    LIVEKIT_URL: Optional[str] = None
    LIVEKIT_API_KEY: Optional[str] = None
    LIVEKIT_API_SECRET: Optional[str] = None
    
    # Calendar & Cal.com (Self-Hosted or Cloud)
    CALCOM_BASE_URL: str = os.getenv("CALCOM_BASE_URL", "http://calcom:3000/api/v1")
    CALCOM_API_KEY: Optional[str] = os.getenv("CALCOM_API_KEY", None)
    CALCOM_EVENT_TYPE_ID: Optional[str] = os.getenv("CALCOM_EVENT_TYPE_ID", None)
    
    # xAI Realtime Voice Agent Configuration
    XAI_API_KEY: Optional[str] = os.getenv("XAI_API_KEY", None)
    XAI_AGENT_ID: str = os.getenv("XAI_AGENT_ID", "agent_QDoRHfWcKMybf197")
    XAI_WEBHOOK_SECRET: Optional[str] = os.getenv("XAI_WEBHOOK_SECRET", None)
    XAI_VOICE_NAME: str = os.getenv("XAI_VOICE_NAME", "rex")  # rex = male executive (Sam); ara/eve = female
    XAI_VOICE_SPEED: float = float(os.getenv("XAI_VOICE_SPEED", "1.0"))
    XAI_VAD_SILENCE_MS: int = int(os.getenv("XAI_VAD_SILENCE_MS", "300"))
    XAI_VAD_PREFIX_PADDING_MS: int = int(os.getenv("XAI_VAD_PREFIX_PADDING_MS", "160"))
    XAI_TEMPERATURE: float = float(os.getenv("XAI_TEMPERATURE", "0.80"))  # Expressive human warmth & natural inflection
    XAI_REALTIME_WS_URL: str = os.getenv("XAI_REALTIME_WS_URL", "wss://api.x.ai/v1/realtime")
    XAI_SIP_FQDN: str = os.getenv("XAI_SIP_FQDN", "sip.voice.x.ai")
    VOICE_ENGINE_MODE: str = os.getenv("VOICE_ENGINE_MODE", "simulation")

    
    # Telnyx Telephony Configuration
    TELNYX_API_KEY: Optional[str] = os.getenv("TELNYX_API_KEY", None)
    TELNYX_PHONE_NUMBER: Optional[str] = os.getenv("TELNYX_PHONE_NUMBER", "+19096866918")

    # Sipgate Telephony Configuration
    SIPGATE_SIP_ID: Optional[str] = os.getenv("SIPGATE_SIP_ID", "4032431t0")
    SIPGATE_PASSWORD: Optional[str] = os.getenv("SIPGATE_PASSWORD", "qURd1qn99mBV")
    SIPGATE_SERVER: Optional[str] = os.getenv("SIPGATE_SERVER", "sipconnect.sipgate.co.uk")
    SIPGATE_PHONE_NUMBER: Optional[str] = os.getenv("SIPGATE_PHONE_NUMBER", "+445600022627")
    
    # Public URLs for OAuth callbacks (must match the developer-app redirect URI)
    PUBLIC_BASE_URL: str = os.getenv("PUBLIC_BASE_URL", "http://127.0.0.1:8000")
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:5173")

    # Social OAuth apps (optional; can also be saved in Accounts UI)
    X_OAUTH_CLIENT_ID: Optional[str] = os.getenv("X_OAUTH_CLIENT_ID", None)
    X_OAUTH_CLIENT_SECRET: Optional[str] = os.getenv("X_OAUTH_CLIENT_SECRET", None)
    LINKEDIN_OAUTH_CLIENT_ID: Optional[str] = os.getenv("LINKEDIN_OAUTH_CLIENT_ID", None)
    LINKEDIN_OAUTH_CLIENT_SECRET: Optional[str] = os.getenv("LINKEDIN_OAUTH_CLIENT_SECRET", None)
    FACEBOOK_OAUTH_CLIENT_ID: Optional[str] = os.getenv("FACEBOOK_OAUTH_CLIENT_ID", None) or os.getenv("FACEBOOK_APP_ID", None)
    FACEBOOK_OAUTH_CLIENT_SECRET: Optional[str] = os.getenv("FACEBOOK_OAUTH_CLIENT_SECRET", None) or os.getenv("FACEBOOK_APP_SECRET", None)
    FACEBOOK_OAUTH_CONFIG_ID: Optional[str] = os.getenv("FACEBOOK_OAUTH_CONFIG_ID", None)
    INSTAGRAM_OAUTH_CONFIG_ID: Optional[str] = os.getenv("INSTAGRAM_OAUTH_CONFIG_ID", None) or os.getenv("FACEBOOK_OAUTH_CONFIG_ID", None)
    THREADS_OAUTH_CLIENT_ID: Optional[str] = os.getenv("THREADS_OAUTH_CLIENT_ID", None)
    THREADS_OAUTH_CLIENT_SECRET: Optional[str] = os.getenv("THREADS_OAUTH_CLIENT_SECRET", None)

    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()
