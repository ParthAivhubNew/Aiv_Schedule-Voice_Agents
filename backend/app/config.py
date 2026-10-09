from pydantic_settings import BaseSettings
from typing import Optional
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from backend directory, then project root as fallback
_backend_env = Path(__file__).resolve().parent.parent / ".env"
if _backend_env.exists():
    load_dotenv(_backend_env)
_root_env = Path(__file__).resolve().parent.parent.parent / ".env"
if _root_env.exists():
    load_dotenv(_root_env, override=False)

class Settings(BaseSettings):
    PROJECT_NAME: str = "Outreach by Aivhub"
    VERSION: str = "1.0.0"
    API_PREFIX: str = "/api"
    
    # Database configuration (PostgreSQL required - no SQLite support)
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "postgresql+asyncpg://postgres:postgres@localhost:5432/aivhub"
    )
    
    # Redis configuration
    REDIS_URL: Optional[str] = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    
    # Security
    SECRET_KEY: str = os.getenv("SECRET_KEY", "outreachAI-secret-key-change-in-production-2026")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    
    # Voice and Telephony API configurations (optional, falls back to simulator if unset)
    TWILIO_ACCOUNT_SID: Optional[str] = None
    TWILIO_AUTH_TOKEN: Optional[str] = None
    TWILIO_PHONE_NUMBER: Optional[str] = None
    # Parallel outbound: operator concurrency is honored up to this cap.
    # CPS gap keeps Twilio/Telnyx from rejecting a burst (default ~1 call/sec).
    OUTBOUND_MAX_CONCURRENCY: int = int(os.getenv("OUTBOUND_MAX_CONCURRENCY", "5"))
    OUTBOUND_CPS_GAP_SEC: float = float(os.getenv("OUTBOUND_CPS_GAP_SEC", "0.45"))
    
    DEEPGRAM_API_KEY: Optional[str] = None
    ELEVENLABS_API_KEY: Optional[str] = None
    CARTESIA_API_KEY: Optional[str] = None
    # Cloned Cartesia voice UUID — used when engine=xai + external TTS hybrid
    CARTESIA_VOICE_ID: Optional[str] = None
    ELEVENLABS_VOICE_ID: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    OPENAI_IMAGE_MODEL: str = os.getenv("OPENAI_IMAGE_MODEL", "dall-e-3")
    OPENAI_BASE_URL: str = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    ANTHROPIC_API_KEY: Optional[str] = None
    ANTHROPIC_MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
    ANTHROPIC_BASE_URL: str = os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1")
    DEEPSEEK_API_KEY: Optional[str] = None
    DEEPSEEK_MODEL: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    DEEPSEEK_BASE_URL: str = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    GROQ_API_KEY: Optional[str] = os.getenv("GROQ_API_KEY", None)
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
    GROQ_BASE_URL: str = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
    LIVEKIT_URL: str = os.getenv("LIVEKIT_URL", "ws://localhost:7880")
    LIVEKIT_API_KEY: str = os.getenv("LIVEKIT_API_KEY", "devkey")
    LIVEKIT_API_SECRET: str = os.getenv("LIVEKIT_API_SECRET", "secret1234567890abcdef1234567890abcdef")
    LIVEKIT_PUBLIC_URL: Optional[str] = os.getenv("LIVEKIT_PUBLIC_URL", None)
    
    # Open Web Search & Enrichment (Tavily: AI-agent search API, platform-wide key)
    TAVILY_API_KEY: Optional[str] = os.getenv("TAVILY_API_KEY", None)
    GOOGLE_PLACES_API_KEY: Optional[str] = os.getenv("GOOGLE_PLACES_API_KEY", None)
    
    # Calendar & Cal.com Cloud API v2 (v1 decommissioned; self-hosted URL can be set per-tenant from the admin UI)
    CALCOM_BASE_URL: str = os.getenv("CALCOM_BASE_URL", "https://api.cal.com/v2")
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
    # Public SIP / carrier webhook (defaults to PUBLIC_BASE_URL + /api/sip-webhook)
    XAI_WEBHOOK_URL: Optional[str] = os.getenv("XAI_WEBHOOK_URL", None)
    VOICE_ENGINE_MODE: str = os.getenv("VOICE_ENGINE_MODE", "live")

    
    # Telnyx Telephony Configuration
    TELNYX_API_KEY: Optional[str] = os.getenv("TELNYX_API_KEY", None)
    TELNYX_PHONE_NUMBER: Optional[str] = os.getenv("TELNYX_PHONE_NUMBER", None)

    # Telnyx AI Assistant (Telnyx-hosted STT/LLM/TTS) webhook integration.
    # Account-level Ed25519 public key from Mission Control -> Account Settings -> Keys & Credentials.
    TELNYX_ASSISTANT_PUBLIC_KEY: Optional[str] = os.getenv("TELNYX_ASSISTANT_PUBLIC_KEY", None)
    # ID of the Telnyx-hosted assistant whose `instructions` get synced from our active
    # conversation template. Leave unset to disable the sync (no assistant to push to).
    TELNYX_ASSISTANT_ID: Optional[str] = os.getenv("TELNYX_ASSISTANT_ID", None)

    # Sipgate Telephony Configuration
    SIPGATE_SIP_ID: Optional[str] = os.getenv("SIPGATE_SIP_ID", None)
    SIPGATE_PASSWORD: Optional[str] = os.getenv("SIPGATE_PASSWORD", None)
    SIPGATE_SERVER: Optional[str] = os.getenv("SIPGATE_SERVER", "sipconnect.sipgate.co.uk")
    SIPGATE_PHONE_NUMBER: Optional[str] = os.getenv("SIPGATE_PHONE_NUMBER", None)
    
    # Public URLs for OAuth callbacks and telephony media streams
    PUBLIC_BASE_URL: str = os.getenv("PUBLIC_BASE_URL", "https://outreach.aivhub.com")
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

    # Staff Admin and Signup Configuration
    ALLOW_SIGNUP: bool = os.getenv("ALLOW_SIGNUP", "true").lower() in ("true", "1", "yes")
    STAFF_ADMIN_EMAIL: Optional[str] = os.getenv("STAFF_ADMIN_EMAIL", None)
    STAFF_ADMIN_PASSWORD: Optional[str] = os.getenv("STAFF_ADMIN_PASSWORD", None)

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"

settings = Settings()
