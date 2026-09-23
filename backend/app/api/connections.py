import os
import uuid
import time
import httpx
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete
from app.database import get_db
from app.config import settings
from app.models.models import Connection, Mission, CallLog, Meeting, Prospect, CompanyProfile
from app.schemas.schemas import ConnectionSchema
from app.services.key_validator import validate_api_key
from app.services.process_logger import log_process_event
from app.services.secret_box import seal_config, open_config, config_get_secret, public_config, mask_secret, is_masked
from pydantic import BaseModel

router = APIRouter(prefix="/connections", tags=["Connections & Providers"])

class TestKeyRequest(BaseModel):
    layer: Optional[str] = "LLM"
    provider: str
    api_key: Optional[str] = None
    apiKey: Optional[str] = None
    base_url: Optional[str] = None
    baseUrl: Optional[str] = None
    account_sid: Optional[str] = None
    model: Optional[str] = None
    voice_id: Optional[str] = None
    voiceId: Optional[str] = None

    @property
    def resolved_api_key(self) -> str:
        return (self.api_key or self.apiKey or "").strip()

    @property
    def resolved_base_url(self) -> Optional[str]:
        return self.base_url or self.baseUrl

    @property
    def resolved_voice_id(self) -> str:
        return (self.voice_id or self.voiceId or "").strip()

    @property
    def resolved_model(self) -> Optional[str]:
        return (self.model or "").strip() or None

@router.get("", response_model=list[dict])
async def list_connections(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Connection))
    conns = result.scalars().all()
    
    descriptions = {
        "LLM": "Powers the AI's conversation, pitch reasoning, and objection handling.",
        "Speech-to-Text": "Turns the prospect's spoken voice into text the AI can understand.",
        "Text-to-Speech": "Generates the AI's spoken voice on calls.",
        "Voice Orchestration": "Manages the live call itself — audio streaming, interruptions, turn-taking.",
        "Telephony": "Places and receives the actual phone calls.",
        "Messaging": "Sends automated confirmations and follow-ups via WhatsApp and SMS.",
        "Calendar": "Checks availability and books confirmed meetings.",
        "Business Discovery": "Finds and researches prospect businesses on the web.",
        "Embeddings": "Generates 384-dimensional vector embeddings for website crawls and knowledge base semantic retrieval.",
        "Other": "Anything else your team connects — CRM, spreadsheets, custom internal tools."
    }
    
    grouped = {}
    for c in conns:
        if c.group_name not in grouped:
            grouped[c.group_name] = {
                "group": c.group_name,
                "desc": descriptions.get(c.group_name, ""),
                "items": []
            }
        cfg = open_config(c.config if isinstance(c.config, dict) else {})
        masked = c.api_key_masked if c.api_key_masked else ("••••••••" if c.status == "connected" else "")
        grouped[c.group_name]["items"].append({
            "id": c.id,
            "name": c.name,
            "status": c.status,
            "apiKeyMasked": masked,
            "model": cfg.get("model") or "",
            "baseUrl": cfg.get("base_url") or "",
            "voiceId": cfg.get("voice_id") or "",
        })
        
    return list(grouped.values())

@router.post("/test")
async def test_connection_only(req: TestKeyRequest, db: AsyncSession = Depends(get_db)):
    """
    Performs live test against provider API without saving.
    Supports testing existing encrypted credentials in DB if key input is empty or masked.
    """
    key = req.resolved_api_key
    if not key or key in ("dummy_configured", "dummy_key") or is_masked(key):
        result = await db.execute(
            select(Connection).where(Connection.group_name == req.layer, Connection.name == req.provider)
        )
        existing = result.scalars().first()
        if not existing:
            p_norm = req.provider.lower().replace(" ", "").replace("-", "")
            layer_conns = await db.execute(select(Connection).where(Connection.group_name == req.layer))
            for lc in layer_conns.scalars().all():
                lc_norm = lc.name.lower().replace(" ", "").replace("-", "")
                if (p_norm in lc_norm or lc_norm in p_norm) or \
                   ("xai" in p_norm and "xai" in lc_norm) or \
                   ("livekit" in p_norm and "livekit" in lc_norm) or \
                   ("vapi" in p_norm and "vapi" in lc_norm) or \
                   ("retell" in p_norm and "retell" in lc_norm) or \
                   ("cartesia" in p_norm and "cartesia" in lc_norm) or \
                   ("eleven" in p_norm and "eleven" in lc_norm) or \
                   ("deepgram" in p_norm and "deepgram" in lc_norm) or \
                   ("twilio" in p_norm and "twilio" in lc_norm) or \
                   ("cal" in p_norm and "cal" in lc_norm):
                    existing = lc
                    break
        if not existing:
            result = await db.execute(
                select(Connection).where(Connection.name.ilike(f"%{req.provider}%"))
            )
            existing = result.scalars().first()
        if existing:
            saved_key = config_get_secret(existing.config, "api_key", "auth_token")
            if saved_key:
                key = saved_key

    if not key:
        raise HTTPException(
            status_code=400,
            detail="API Key is required to perform validation test."
        )
    validation = await validate_api_key(
        provider=req.provider,
        api_key=key,
        base_url=req.resolved_base_url,
        account_sid=req.account_sid,
        model=req.resolved_model
    )
    if not validation["valid"]:
        raise HTTPException(
            status_code=400,
            detail=validation.get("error", f"Authentication failed for {req.provider}.")
        )
    return {
        "success": True,
        "valid": True,
        "details": validation.get("details", "Verified & Active")
    }

@router.post("/test-and-save")
async def test_and_save_connection(req: TestKeyRequest, db: AsyncSession = Depends(get_db)):
    """
    Performs a live validation test against the provider API before saving.
    Rejects the request if credentials fail authentication.
    If no new raw key is supplied but connection exists in DB, validates the stored key without overwrite.
    """
    key = req.resolved_api_key
    display_name = f"{req.provider}" + (f" ({req.base_url})" if req.provider.lower() == "other" and req.base_url else "")
    
    # Check if this connection already exists in this group or by provider name/alias
    result = await db.execute(
        select(Connection).where(Connection.group_name == req.layer, Connection.name == display_name)
    )
    existing = result.scalars().first()
    if not existing:
        p_norm = req.provider.lower().replace(" ", "").replace("-", "")
        layer_conns = await db.execute(select(Connection).where(Connection.group_name == req.layer))
        for lc in layer_conns.scalars().all():
            lc_norm = lc.name.lower().replace(" ", "").replace("-", "")
            if (p_norm in lc_norm or lc_norm in p_norm) or \
               ("xai" in p_norm and "xai" in lc_norm) or \
               ("livekit" in p_norm and "livekit" in lc_norm) or \
               ("vapi" in p_norm and "vapi" in lc_norm) or \
               ("retell" in p_norm and "retell" in lc_norm) or \
               ("cartesia" in p_norm and "cartesia" in lc_norm) or \
               ("eleven" in p_norm and "eleven" in lc_norm) or \
               ("deepgram" in p_norm and "deepgram" in lc_norm) or \
               ("twilio" in p_norm and "twilio" in lc_norm) or \
               ("cal" in p_norm and "cal" in lc_norm):
                existing = lc
                break
    if not existing:
        result = await db.execute(
            select(Connection).where(Connection.name.ilike(f"%{req.provider}%"))
        )
        existing = result.scalars().first()

    is_retest_existing = False
    if not key or key in ("dummy_configured", "dummy_key") or is_masked(key):
        if existing:
            saved_key = config_get_secret(existing.config, "api_key", "auth_token")
            if saved_key:
                key = saved_key
                is_retest_existing = True

    if not key:
        raise HTTPException(
            status_code=400,
            detail="API Key is required."
        )

    # 1. Live Validation Probe
    validation = await validate_api_key(
        provider=req.provider,
        api_key=key,
        base_url=req.resolved_base_url,
        account_sid=req.account_sid,
        model=req.resolved_model
    )
    
    if not validation["valid"]:
        raise HTTPException(
            status_code=400,
            detail=validation.get("error", f"Authentication failed for {req.provider}.")
        )
    
    # 2. If it's a retest of an existing key in DB, preserve config and just ensure status is connected
    if is_retest_existing and existing:
        existing.status = "connected"
        await db.commit()
        return {
            "success": True,
            "id": existing.id,
            "provider": req.provider,
            "layer": req.layer,
            "status": "connected",
            "maskedKey": existing.api_key_masked or "••••••••",
            "details": validation.get("details", "Verified & Active")
        }

    # 3. Mask the key for safe storage
    clean_key = key
    masked = clean_key[:3] + "••••••••" + clean_key[-4:] if len(clean_key) > 8 else "••••••••"
    
    # 4. Save or update connection in database
    conn_config = seal_config({
        "api_key": clean_key,
        "auth_token": clean_key,
        "account_sid": req.account_sid or (existing.config.get("account_sid") if existing and isinstance(existing.config, dict) else None),
        "base_url": req.resolved_base_url,
        "provider": req.provider,
        "model": req.model or (existing.config.get("model") if existing and isinstance(existing.config, dict) else None),
        "voice_id": req.resolved_voice_id or (
            existing.config.get("voice_id") if existing and isinstance(existing.config, dict) else None
        ),
    })

    if existing:
        existing.status = "connected"
        existing.name = display_name
        existing.api_key_masked = masked
        existing.config = conn_config
        conn_id = existing.id
    else:
        conn_id = f"conn_{uuid.uuid4().hex[:6]}"
        conn = Connection(
            id=conn_id,
            group_name=req.layer,
            name=display_name,
            status="connected",
            api_key_masked=masked,
            config=conn_config
        )
        db.add(conn)

    await db.commit()
    
    if (req.layer or "").lower() == "embeddings" or "embed" in (req.provider or "").lower():
        try:
            from app.services.embedding_service import set_active_embedding_config
            set_active_embedding_config(
                model=req.model,
                provider=req.provider,
                api_key=clean_key,
                base_url=req.resolved_base_url
            )
        except Exception:
            pass

    return {
        "success": True,
        "id": conn_id,
        "provider": req.provider,
        "layer": req.layer,
        "status": "connected",
        "maskedKey": masked,
        "details": validation.get("details", "Verified & Active")
    }

class ClearKeyRequest(BaseModel):
    layer: Optional[str] = None
    provider: Optional[str] = None
    id: Optional[str] = None


@router.post("/clear-key")
async def clear_connection_key(req: ClearKeyRequest, db: AsyncSession = Depends(get_db)):
    """
    Remove stored API key / secrets for a provider. Keeps the row slot
    as not_configured so the Connections UI still lists the provider.
    """
    existing = None
    if req.id:
        result = await db.execute(select(Connection).where(Connection.id == req.id))
        existing = result.scalars().first()

    if not existing and req.layer and req.provider:
        result = await db.execute(
            select(Connection).where(
                Connection.group_name == req.layer,
                Connection.name == req.provider,
            )
        )
        existing = result.scalars().first()

    if not existing and req.provider:
        # Fuzzy: name equals or contains provider (handles slight label drift)
        result = await db.execute(select(Connection))
        needle = (req.provider or "").strip().lower()
        layer = (req.layer or "").strip().lower()
        for c in result.scalars().all():
            name_l = (c.name or "").lower()
            group_ok = (not layer) or ((c.group_name or "").lower() == layer)
            if group_ok and (name_l == needle or needle in name_l or name_l in needle):
                existing = c
                break

    if not existing:
        raise HTTPException(status_code=404, detail="No saved key found for that provider.")

    prev = open_config(existing.config if isinstance(existing.config, dict) else {})
    existing.status = "not_configured"
    existing.api_key_masked = None
    existing.config = seal_config({
        "provider": prev.get("provider"),
        "base_url": prev.get("base_url"),
        "model": prev.get("model"),
    })
    await db.commit()
    return {
        "success": True,
        "id": existing.id,
        "provider": existing.name,
        "layer": existing.group_name,
        "status": "not_configured",
    }


@router.post("/reset-demo-data")
async def reset_demo_data(db: AsyncSession = Depends(get_db)):
    """
    Clears mock demo records (sample missions, mock calls, demo logs)
    so the workspace is fresh and ready for real data.
    """
    try:
        await db.execute(delete(Mission))
        await db.execute(delete(CallLog))
        await db.execute(delete(Meeting))
        await db.execute(delete(Prospect))
        await db.commit()
        return {"success": True, "message": "Demo data cleared successfully. Workspace is fresh."}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to clear demo data: {str(e)}")


# ----------------------------------------------------------------------
# UNIVERSAL VOICE & TELEPHONY HUB (MULTI-PROVIDER ORCHESTRATION)
# ----------------------------------------------------------------------
import time
import logging
import httpx
from app.config import settings

logger = logging.getLogger(__name__)

class TelephonyHubProvisionRequest(BaseModel):
    carrier: str = "telnyx"        # telnyx, twilio, generic_sip
    engine: str = "xai"            # xai, openai, livekit, modular
    phone_number: str
    api_key: Optional[str] = None
    account_sid: Optional[str] = None
    agent_id: Optional[str] = None
    voice_name: Optional[str] = "rex"  # rex = male (Sam)
    silence_duration_ms: Optional[int] = 380  # Snappy human turn-taking
    temperature: Optional[float] = 0.80  # Natural vocal inflection and warmth
    webhook_url: Optional[str] = None
    signing_secret: Optional[str] = None


class SelectVoiceRequest(BaseModel):
    voice_id: str
    label: Optional[str] = None
    provider: Optional[str] = "xai"
    accent: Optional[str] = None


def _split_voice_choice(voice_id: str, accent: Optional[str] = None) -> tuple[str, str]:
    vid = (voice_id or "rex").strip()
    acc = (accent or "").strip().lower()
    low = vid.lower()
    uk_aliases = {
        "rex-uk": "rex", "rex_uk": "rex", "sam-uk": "rex", "sam_uk": "rex",
        "ara-uk": "ara", "ara_uk": "ara",
        "eve-uk": "eve", "eve_uk": "eve",
        "leo-uk": "leo", "leo_uk": "leo",
    }
    if low in uk_aliases:
        return uk_aliases[low], "british"
    if "-uk" in low or "_uk" in low:
        base = low.replace("-uk", "").replace("_uk", "") or vid
        return base, "british"
    if acc in ("british", "uk", "en-gb"):
        return vid, "british"
    if low == "rex":
        return "rex", acc or "neutral"
    return vid, acc or "neutral"

@router.get("/telephony-hub")
async def get_telephony_hub_status(db: AsyncSession = Depends(get_db)):
    """
    Returns current active carrier, active engine, configured phone numbers,
    webhook routing diagnostics, and signing secret status.
    """
    active_secret = settings.XAI_WEBHOOK_SECRET or os.getenv("XAI_WEBHOOK_SECRET")
    engine_conn = None
    try:
        # 1. Fetch connections for Telephony and Voice Orchestration
        conns_res = await db.execute(select(Connection).where(Connection.group_name.in_(["Telephony", "Voice Orchestration"])))
        conns = conns_res.scalars().all()

        carrier_conn = next((c for c in conns if c.group_name == "Telephony"), None)
        engine_conn = next((c for c in conns if c.group_name == "Voice Orchestration"), None)

        carrier_cfg = open_config(carrier_conn.config) if (carrier_conn and carrier_conn.config) else {}
        engine_cfg = open_config(engine_conn.config) if (engine_conn and engine_conn.config) else {}

        # 2. Fetch Company Profile for caller ID
        prof_res = await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))
        profile = prof_res.scalars().first()
        active_phone = (
            (profile.caller_id if profile and profile.caller_id else None)
            or carrier_cfg.get("phoneNumber")
            or engine_cfg.get("phoneNumber")
            or settings.TWILIO_PHONE_NUMBER
            or settings.TELNYX_PHONE_NUMBER
            or None
        )
        
        stored_key = None
        if engine_conn and engine_conn.config and isinstance(engine_conn.config, dict):
            stored_key = config_get_secret(engine_conn.config, "api_key", "auth_token")
            stored_secret = config_get_secret(engine_conn.config, "signing_secret", "webhook_secret")
            if stored_secret:
                active_secret = stored_secret
                settings.XAI_WEBHOOK_SECRET = stored_secret

        active_key = settings.XAI_API_KEY or stored_key
        masked_active_key = engine_conn.api_key_masked if (engine_conn and engine_conn.api_key_masked) else (mask_secret(active_key) if active_key else "")

        active_carrier = carrier_conn.name if carrier_conn else ("Twilio" if settings.TWILIO_ACCOUNT_SID else "Telnyx" if settings.TELNYX_API_KEY or settings.TELNYX_PHONE_NUMBER else "Not configured")
        active_engine = engine_conn.name if engine_conn else ("xAI Realtime" if settings.XAI_API_KEY else "Not configured")
        is_connected = bool((carrier_conn and carrier_conn.status == "connected") or settings.XAI_API_KEY or stored_key)
    except Exception as err:
        logger.warning(f"Error reading telephony hub status: {err}")
        active_carrier = "Twilio" if getattr(settings, "TWILIO_ACCOUNT_SID", None) else ("Telnyx" if settings.TELNYX_PHONE_NUMBER else "Not configured")
        active_engine = "xAI Realtime" if settings.XAI_API_KEY else "Not configured"
        active_phone = settings.TWILIO_PHONE_NUMBER or settings.TELNYX_PHONE_NUMBER or None
        is_connected = bool(settings.XAI_API_KEY)
        active_key = settings.XAI_API_KEY
        masked_active_key = mask_secret(active_key) if active_key else ""

    # 3. Detect public webhook URL
    public = (getattr(settings, "PUBLIC_BASE_URL", None) or "http://127.0.0.1:8000").rstrip("/")
    default_webhook = (
        getattr(settings, "XAI_WEBHOOK_URL", None)
        or f"{public}/api/sip-webhook"
    )

    clean_secret = active_secret if (active_secret and not active_secret.startswith("whsec_••••")) else ""
    configured_voice = settings.XAI_VOICE_NAME
    configured_silence = 380
    configured_temp = 0.80
    configured_accent = "neutral"
    if engine_conn and engine_conn.config and isinstance(engine_conn.config, dict):
        configured_voice = engine_conn.config.get("voice_name") or engine_conn.config.get("voice") or configured_voice
        configured_silence = engine_conn.config.get("silence_duration_ms", 380)
        configured_temp = engine_conn.config.get("temperature", 0.80)
        configured_accent = engine_conn.config.get("accent") or "neutral"
        stored_custom = engine_conn.config.get("custom_voices") or []
    else:
        stored_custom = []
    ui_voice = configured_voice
    _cv = str(configured_voice or "").lower()
    _ca = str(configured_accent or "").lower()
    if _ca in ("british", "uk", "en-gb"):
        if _cv == "rex":
            ui_voice = "rex-uk"
        elif _cv == "ara":
            ui_voice = "ara-uk"
        elif _cv == "eve":
            ui_voice = "eve-uk"
        elif _cv == "leo":
            ui_voice = "leo-uk"

    live_engine = "xai"
    live_note = ""
    stt_provider = None
    tts_provider = None
    llm_provider = None
    stt_name = None
    tts_name = None
    llm_name = None
    stt_model = None
    tts_model = None
    llm_model = None
    external_tts = False
    tts_voice_id = None
    try:
        from app.services.voice_plugin_plan import resolve_voice_plan
        plan = await resolve_voice_plan()
        live_engine = plan.engine
        live_note = plan.note
        stt_provider = plan.stt.provider if plan.stt else None
        tts_provider = plan.tts.provider if plan.tts else None
        llm_provider = plan.llm.provider if plan.llm else None
        stt_name = ((plan.stt.extra or {}).get("display_name") if plan.stt else None) or stt_provider
        tts_name = ((plan.tts.extra or {}).get("display_name") if plan.tts else None) or tts_provider
        llm_name = ((plan.llm.extra or {}).get("display_name") if plan.llm else None) or llm_provider
        stt_model = plan.stt.model if plan.stt else None
        tts_model = plan.tts.model if plan.tts else None
        llm_model = plan.llm.model if plan.llm else None
        external_tts = bool(getattr(plan, "external_tts", False))

        if external_tts and plan.tts:
            tts_voice_id = plan.tts.voice_id or None
        else:
            if not tts_provider or is_xai_builtin_tts if 'is_xai_builtin_tts' in locals() else (not external_tts and live_engine == "xai"):
                tts_provider = "xai"
                tts_name = f"xAI built-in ({plan.voice_name or ui_voice or 'rex'})"
                tts_model = f"xai-{plan.voice_name or ui_voice or 'rex'}"
            tts_voice_id = None
    except Exception as plan_err:
        logger.warning(f"Could not resolve live voice plan: {plan_err}")

    # Align with active stack preferences
    from app.services.voice_plugin_plan import get_active_stack, set_active_stack
    active_stack = get_active_stack()
    target_engine = active_stack.get("engine") or live_engine
    if target_engine == "livekit":
        active_engine = "LiveKit (self-hosted)"
        live_engine = "livekit"
    elif target_engine == "xai":
        active_engine = "xAI Grok (speech-to-speech)"
        live_engine = "xai"
    elif target_engine == "vapi":
        active_engine = "Vapi Voice AI"
        live_engine = "vapi"
    elif target_engine == "retell":
        active_engine = "Retell AI"
        live_engine = "retell"
    elif target_engine == "openai":
        active_engine = "OpenAI Realtime"
        live_engine = "openai"
    elif target_engine == "modular":
        active_engine = "Modular pipeline"
        live_engine = "modular"

    if active_stack.get("tts"):
        sel_tts = active_stack["tts"]
        if "xai built-in" in sel_tts.lower() or sel_tts.lower() in ("rex", "ara", "eve"):
            tts_provider = "xai"
            tts_name = sel_tts
            tts_model = sel_tts
            external_tts = False
        else:
            tts_name = sel_tts
            tts_provider = sel_tts.split()[0].lower()
            external_tts = True

    if active_stack.get("llm"):
        llm_name = active_stack["llm"]
        llm_provider = active_stack["llm"].split()[0].lower()
    if active_stack.get("llm_model"):
        llm_model = active_stack["llm_model"]
    if active_stack.get("stt"):
        stt_name = active_stack["stt"]
        stt_provider = active_stack["stt"].split()[0].lower()
    if active_stack.get("stt_model"):
        stt_model = active_stack["stt_model"]
    if active_stack.get("tts_model"):
        tts_model = active_stack["tts_model"]
    if active_stack.get("carrier"):
        active_carrier = active_stack["carrier"]

    live_labels = {
        "engine": active_engine,
        "llm": llm_name or "DeepSeek",
        "stt": stt_name or "Deepgram",
        "tts": tts_name or f"xAI built-in ({ui_voice})",
        "carrier": active_carrier,
        "voice": ui_voice,
        "note": live_note,
    }

    custom_voices = list(stored_custom) if isinstance(stored_custom, list) else []
    try:
        from app.services.voice_clone import list_xai_custom_voices, upsert_voice_list, xai_api_key as _xai_key
        remote, _err = await list_xai_custom_voices(_xai_key(engine_conn))
        for v in remote:
            custom_voices = upsert_voice_list(custom_voices, v)
    except Exception as v_err:
        logger.warning(f"Could not list xAI custom voices: {v_err}")

    return {
        "activeCarrier": active_carrier,
        "activeEngine": active_engine,
        "liveEngine": live_engine,
        "liveNote": live_note,
        "sttProvider": stt_provider,
        "ttsProvider": tts_provider,
        "llmProvider": llm_provider,
        "sttName": stt_name,
        "ttsName": tts_name,
        "llmName": llm_name,
        "sttModel": stt_model,
        "ttsModel": tts_model,
        "llmModel": llm_model,
        "externalTts": external_tts,
        "ttsVoiceId": tts_voice_id,
        "phoneNumber": active_phone,
        "agentId": getattr(settings, "XAI_AGENT_ID", "agent_QDoRHfWcKMybf197"),
        "voiceName": ui_voice,
        "voiceEngineName": configured_voice,
        "accent": configured_accent,
        "clonedVoiceLabel": (engine_conn.config.get("cloned_voice_label") if engine_conn and isinstance(engine_conn.config, dict) else None),
        "xaiCloneApiBlocked": bool((engine_conn.config or {}).get("xai_clone_api_blocked")) if engine_conn and isinstance(engine_conn.config, dict) else False,
        "customVoices": custom_voices,
        "silenceDurationMs": configured_silence,
        "temperature": configured_temp,
        "status": "connected" if is_connected else "configured",
        "webhookUrl": default_webhook,
        "xaiFqdn": settings.XAI_SIP_FQDN,
        "codecs": ["G.711 μ-law (PCMU)", "G.711 A-law (PCMA)", "G.722"],
        "hasApiKey": bool(active_key),
        "apiKeyMasked": masked_active_key,
        "hasSigningSecret": bool(clean_secret),
        "signingSecret": None,
        "signingSecretMasked": mask_secret(clean_secret) if clean_secret else "Not configured",
        "isLive": is_connected or os.getenv("VOICE_ENGINE_MODE") == "live",
        "liveLabels": live_labels,
    }


class SelectActiveStackRequest(BaseModel):
    engine: Optional[str] = None
    engine_label: Optional[str] = None
    voice: Optional[str] = None
    tts: Optional[str] = None
    llm: Optional[str] = None
    stt: Optional[str] = None
    carrier: Optional[str] = None
    telephony: Optional[str] = None
    llm_model: Optional[str] = None
    stt_model: Optional[str] = None
    tts_model: Optional[str] = None
    model: Optional[str] = None


@router.get("/telephony-hub/select-stack")
async def get_selected_stack():
    from app.services.voice_plugin_plan import get_active_stack
    return get_active_stack()


@router.post("/telephony-hub/select-stack")
async def select_active_stack_endpoint(req: SelectActiveStackRequest, db: AsyncSession = Depends(get_db)):
    """
    Persistently sets the active engine, LLM, STT, and TTS choices made in 'What runs where'
    so the live call stack, live banners, and Connections 'In use' badges update instantly.
    """
    from app.services.voice_plugin_plan import set_active_stack, get_active_stack
    patch = {}
    if req.engine:
        patch["engine"] = req.engine
    elif req.voice:
        v_low = req.voice.lower()
        if "livekit" in v_low:
            patch["engine"] = "livekit"
            patch["engine_label"] = "LiveKit (self-hosted)"
        elif "vapi" in v_low:
            patch["engine"] = "vapi"
            patch["engine_label"] = "Vapi Voice AI"
        elif "retell" in v_low:
            patch["engine"] = "retell"
            patch["engine_label"] = "Retell AI"
        elif "openai" in v_low:
            patch["engine"] = "openai"
            patch["engine_label"] = "OpenAI Realtime"
        elif "modular" in v_low:
            patch["engine"] = "modular"
            patch["engine_label"] = "Modular pipeline"
        elif "xai" in v_low:
            patch["engine"] = "xai"
            patch["engine_label"] = "xAI Grok (speech-to-speech)"

    if req.tts:
        patch["tts"] = req.tts
    if req.llm:
        patch["llm"] = req.llm
        llm_low = req.llm.lower()
        if not req.llm_model and not req.model:
            if "xai" in llm_low or "grok" in llm_low:
                patch["llm_model"] = "grok-beta"
            elif "deepseek" in llm_low:
                patch["llm_model"] = "deepseek-chat"
            elif "groq" in llm_low:
                patch["llm_model"] = "llama-3.3-70b-versatile"
            elif "openai" in llm_low:
                patch["llm_model"] = "gpt-4o"
            elif "anthropic" in llm_low or "claude" in llm_low:
                patch["llm_model"] = "claude-3-5-sonnet-20241022"
    if req.stt:
        patch["stt"] = req.stt
    if req.carrier or req.telephony:
        patch["carrier"] = req.carrier or req.telephony
    if req.llm_model or (req.model and req.llm):
        patch["llm_model"] = req.llm_model or req.model
    if req.stt_model or (req.model and req.stt):
        patch["stt_model"] = req.stt_model or req.model
    if req.tts_model or (req.model and req.tts):
        patch["tts_model"] = req.tts_model or req.model

    updated = set_active_stack(patch)
    return {"status": "ok", "active_stack": updated}


@router.get("/telephony-hub/voices")
async def list_cloned_voices(db: AsyncSession = Depends(get_db)):
    from app.services.voice_clone import (
        _orchestration_conn,
        list_xai_custom_voices,
        stored_custom_voices,
        upsert_voice_list,
        xai_api_key,
    )
    conn = await _orchestration_conn(db)
    voices = stored_custom_voices(conn)
    remote, err = await list_xai_custom_voices(xai_api_key(conn))
    for v in remote:
        voices = upsert_voice_list(voices, v)
    cfg = conn.config if conn and isinstance(conn.config, dict) else {}
    return {
        "success": True,
        "voices": voices,
        "activeVoice": cfg.get("voice_name") or settings.XAI_VOICE_NAME,
        "xaiListError": err,
    }


@router.post("/telephony-hub/voices/clone")
async def clone_recorded_voice(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    from app.services.voice_clone import (
        _orchestration_conn,
        clone_on_elevenlabs,
        clone_on_xai,
        elevenlabs_api_key,
        save_orchestration_config,
        stored_custom_voices,
        upsert_voice_list,
        xai_api_key,
    )
    try:
        form = await request.form(max_files=2, max_fields=20, max_part_size=25 * 1024 * 1024)
    except TypeError:
        form = await request.form()
    name = str(form.get("name") or "My voice")
    file = form.get("file")
    if file is None or not hasattr(file, "read"):
        raise HTTPException(status_code=400, detail="No audio file. Record your voice, then Save clone.")
    audio = await file.read()
    if not audio or len(audio) < 2000:
        raise HTTPException(status_code=400, detail="Recording too short. Speak 30–90 seconds in a quiet room.")
    if len(audio) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Recording too large (max 25 MB).")

    conn = await _orchestration_conn(db)
    cfg = conn.config if conn and isinstance(conn.config, dict) else {}
    engine = str(form.get("engine") or cfg.get("engine") or (conn.name if conn else "") or "xai").lower()
    filename = getattr(file, "filename", None) or "reference.webm"
    ctype = getattr(file, "content_type", None) or "audio/webm"
    xai_key = xai_api_key(conn)
    el_key = await elevenlabs_api_key(db)

    if "openai" in engine:
        raise HTTPException(
            status_code=400,
            detail="This voice engine cannot clone a recording. Switch to xAI (paste Voice ID from console.x.ai) or Modular (ElevenLabs) to use your own voice.",
        )

    clone = None
    xai_err = None
    if "modular" in engine:
        if not el_key:
            raise HTTPException(status_code=400, detail="No ElevenLabs key in Connections (Text-to-Speech). Save the key, then record again.")
        try:
            clone = await clone_on_elevenlabs(el_key, audio, filename, ctype, name.strip() or "My voice")
        except Exception as err:
            logger.warning(f"ElevenLabs voice clone failed: {err}")
            raise HTTPException(status_code=400, detail=f"Clone failed: {err}")
    elif xai_key and xai_key.startswith("xai-"):
        try:
            clone = await clone_on_xai(xai_key, audio, filename, ctype, name.strip() or "My voice")
        except Exception as err:
            xai_err = str(err)
            logger.warning(f"xAI voice clone failed: {err}")

    if clone is None:
        needs_console = bool(xai_err and ("403" in xai_err or "Enterprise" in xai_err or "not enabled" in xai_err.lower()))
        if needs_console or (xai_key and xai_key.startswith("xai-") and "modular" not in engine):
            try:
                await save_orchestration_config(db, {"xai_clone_api_blocked": True})
            except Exception:
                pass
            try:
                from app.services.process_logger import log_process_event
                await log_process_event(
                    subsystem="voice",
                    process_name="xai_voice_clone",
                    level="WARN",
                    message="Admin: xAI in-app voice clone is Enterprise-only. Operators must create the voice in console.x.ai (Custom Voices) and paste the 8-character Voice ID in Voice & Telephony Trunking Hub. Upgrade the xAI team plan to unlock Record → Save in AIVHub.",
                    details={"action": "console.x.ai Custom Voices → Copy Voice ID → Link pasted ID", "blocked": True},
                    db=db,
                )
            except Exception:
                pass
            raise HTTPException(
                status_code=403,
                detail="xAI clone API is Enterprise-only. Clone in console.x.ai (Custom Voices) then paste the Voice ID below. Admin has been notified.",
            )
        raise HTTPException(status_code=400, detail=xai_err or "No xAI API key saved. Add the key in this hub, then clone, or paste a Voice ID from console.x.ai.")

    voices = upsert_voice_list(stored_custom_voices(conn), clone)
    await save_orchestration_config(db, {
        "custom_voices": voices,
        "voice_name": clone["voice_id"],
        "cloned_voice_id": clone["voice_id"],
        "cloned_voice_label": clone.get("name") or name,
    })
    settings.XAI_VOICE_NAME = clone["voice_id"]
    return {
        "success": True,
        "voice": clone,
        "voices": voices,
        "message": f"Cloned voice saved. Live Grok calls will use {clone.get('name') or clone['voice_id']}.",
    }


@router.post("/telephony-hub/voices/select")
async def select_cloned_voice(req: SelectVoiceRequest, db: AsyncSession = Depends(get_db)):
    from app.services.voice_clone import (
        _orchestration_conn,
        save_orchestration_config,
        stored_custom_voices,
        upsert_voice_list,
    )
    from app.services.secret_box import seal_config
    from app.services.voice_plugin_plan import looks_like_external_voice_id, looks_like_api_key

    vid_raw = (req.voice_id or "").strip()
    if not vid_raw:
        raise HTTPException(status_code=400, detail="voice_id is required.")
    if looks_like_api_key(vid_raw):
        raise HTTPException(
            status_code=400,
            detail="That looks like an API key, not a Voice ID. Save the Cartesia API key under Connections → Text-to-Speech → Cartesia. Here paste only the Voice UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) from Cartesia → Voices.",
        )
    vid, accent = _split_voice_choice(vid_raw, req.accent)
    conn = await _orchestration_conn(db)
    voices = stored_custom_voices(conn)
    label = (req.label or "").strip()
    is_clone = looks_like_external_voice_id(vid)
    provider = (req.provider or "").strip().lower()
    if not provider:
        if is_clone:
            provider = "cartesia" if "-" in vid and len(vid) == 36 else "elevenlabs"
        else:
            provider = "xai"
    if is_clone:
        voices = upsert_voice_list(voices, {
            "voice_id": vid,
            "name": label or vid,
            "provider": provider,
        })
    display_label = label or (
        f"{vid}-uk" if accent == "british" and vid in ("ara", "eve", "rex", "leo") else vid
    )
    await save_orchestration_config(db, {
        "custom_voices": voices,
        "voice_name": vid,
        "accent": accent,
        "cloned_voice_id": vid if is_clone else None,
        "cloned_voice_label": display_label,
    })
    settings.XAI_VOICE_NAME = vid

    # Mirror clone onto the matching Text-to-Speech plugin so live plan is plugin-driven
    if is_clone:
        tts_res = await db.execute(select(Connection).where(Connection.group_name == "Text-to-Speech"))
        tts_conns = list(tts_res.scalars().all())
        target = None
        needle = "cartesia" if provider == "cartesia" or ("-" in vid and len(vid) >= 32) else "eleven"
        for c in tts_conns:
            name = (c.name or "").lower()
            if needle in name or (provider and provider in name):
                target = c
                break
        if target is None and tts_conns:
            target = next((c for c in tts_conns if c.status == "connected"), tts_conns[0])
        if target is not None:
            cfg = dict(target.config) if isinstance(target.config, dict) else {}
            cfg["voice_id"] = vid
            cfg["provider"] = provider if provider in ("cartesia", "elevenlabs") else (
                "cartesia" if "cartesia" in (target.name or "").lower() else cfg.get("provider")
            )
            target.config = seal_config(cfg)
            target.status = "connected"
            await db.commit()

    hybrid_hint = (
        " With engine=xAI + a Text-to-Speech plugin key, live calls use xAI brain and this clone for TTS."
        if is_clone
        else " Builtin xAI voice active — external TTS plugins stay idle until you select a clone Voice ID."
    )
    return {
        "success": True,
        "voice_id": vid,
        "accent": accent,
        "external_tts": is_clone,
        "voices": voices,
        "message": f"Active voice set to {display_label}.{hybrid_hint}",
    }


@router.post("/telephony-hub/provision")
async def provision_telephony_hub(req: TelephonyHubProvisionRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """
    Self-serve multi-provider provisioning:
    1. Validates provider credentials in real-time.
    2. Auto-provisions webhook registration if xAI / Telnyx is selected.
    3. Saves active stack and phone number directly into database without server reboots.
    """
    try:
        carrier = req.carrier.lower()
        engine = req.engine.lower()
        from app.api.calls import normalize_phone_number
        phone_clean = normalize_phone_number(req.phone_number or "")
        if not phone_clean or len(phone_clean) < 7:
            raise HTTPException(status_code=400, detail="Please provide a valid phone number with country code (e.g. +44... or +1...).")
        key_clean = (req.api_key or "").strip()

        # Load existing stored configs to prevent credential loss or undefined variable errors
        prev_voices = []
        prev_label = None
        prev_orch_res = await db.execute(select(Connection).where(Connection.group_name == "Voice Orchestration"))
        prev_c = prev_orch_res.scalars().first()
        if prev_c and isinstance(prev_c.config, dict):
            orch_cfg = open_config(prev_c.config)
            prev_voices = orch_cfg.get("custom_voices") or []
            prev_label = orch_cfg.get("cloned_voice_label")

        prev_sid = None
        prev_auth = None
        prev_tele_masked = None
        prev_tele_res = await db.execute(select(Connection).where(Connection.group_name == "Telephony"))
        prev_tele = prev_tele_res.scalars().first()
        if prev_tele:
            prev_tele_masked = prev_tele.api_key_masked
            tele_cfg = open_config(prev_tele.config if isinstance(prev_tele.config, dict) else {})
            cand_sid = (tele_cfg.get("account_sid") or "").strip()
            if cand_sid.startswith("AC") and len(cand_sid) == 34:
                prev_sid = cand_sid
            for name in ("auth_token", "api_key"):
                v = (tele_cfg.get(name) or "").strip()
                if v and not v.startswith("xai-") and len(v) >= 32:
                    prev_auth = v
                    break

        req_sid = (req.account_sid or "").strip()
        if req_sid.startswith("AC") and len(req_sid) == 34:
            prev_sid = req_sid

        # Fallback to settings if still none
        if not prev_sid and getattr(settings, "TWILIO_ACCOUNT_SID", None):
            prev_sid = settings.TWILIO_ACCOUNT_SID
        if not prev_auth and getattr(settings, "TWILIO_AUTH_TOKEN", None):
            prev_auth = settings.TWILIO_AUTH_TOKEN

        # If key is left blank, reuse previously stored API key
        if not key_clean:
            if settings.XAI_API_KEY:
                key_clean = settings.XAI_API_KEY
            elif prev_c and prev_c.config and isinstance(prev_c.config, dict):
                key_clean = config_get_secret(prev_c.config, "api_key", "auth_token")

        # Only treat key_clean as carrier token when it is NOT an xAI key
        if (
            key_clean
            and not key_clean.startswith("xai-")
            and len(key_clean) >= 32
            and ("twilio" in carrier or "telnyx" in carrier)
        ):
            prev_auth = key_clean
        
        signing_secret = None
        auto_registered = False
        twilio_verified = False
        reg_error = None
        existing_number = None

        # 1. Real-time credential validation
        if key_clean and not key_clean.startswith("mock"):
            # Validate engine key if provided
            if "xai" in engine:
                v_res = await validate_api_key(provider="xAI (Grok)", api_key=key_clean)
                if not v_res["valid"]:
                    raise HTTPException(status_code=400, detail=v_res.get("error", "xAI authentication failed."))

                # Register number with xAI BYO trunk API dynamically
                target_webhook = (req.webhook_url or "").strip()
                if not target_webhook:
                    try:
                        from app.services.telephony_provider import public_http_base
                        base = public_http_base()
                    except Exception:
                        base = str(request.base_url).rstrip("/")
                    target_webhook = f"{base}/api/sip-webhook"

                def extract_xai_secret(data: dict) -> Optional[str]:
                    if not isinstance(data, dict):
                        return None
                    wh = data.get("webhook")
                    if isinstance(wh, dict):
                        for k in ["dispatch_signing_secret", "signing_secret", "secret", "webhook_secret"]:
                            v = wh.get(k)
                            if v and str(v).strip():
                                return str(v).strip()
                    for k in ["dispatch_signing_secret", "signing_secret", "webhook_secret", "secret"]:
                        v = data.get(k)
                        if v and str(v).strip():
                            return str(v).strip()
                    return None

                try:
                    async with httpx.AsyncClient(timeout=15.0) as client:
                        # 1. Query existing registered numbers on xAI
                        try:
                            list_res = await client.get(
                                "https://api.x.ai/v2/phone-numbers",
                                headers={"Authorization": f"Bearer {key_clean}"}
                            )
                            if list_res.status_code == 200:
                                res_json = list_res.json()
                                num_list = res_json.get("phone_numbers") if isinstance(res_json, dict) else (res_json if isinstance(res_json, list) else [])
                                for item in num_list:
                                    if item.get("phone_number") == phone_clean:
                                        existing_number = item
                                        num_id = item.get("phone_number_id") or item.get("id")
                                        signing_secret = extract_xai_secret(item)
                                        auto_registered = True
                                        logger.info(f"Number {phone_clean} already registered with xAI (ID: {num_id}).")
                                        break
                        except Exception as list_err:
                            logger.warning(f"Could not list xAI phone numbers: {list_err}")

                        # If number already exists on xAI but secret was omitted by GET, and user has no secret saved,
                        # delete and recreate to obtain a fresh dispatch_signing_secret!
                        active_secret_now = req.signing_secret or settings.XAI_WEBHOOK_SECRET
                        if existing_number and not active_secret_now:
                            num_id = existing_number.get("phone_number_id") or existing_number.get("id")
                            if num_id:
                                try:
                                    logger.info(f"Re-creating {phone_clean} on xAI to obtain fresh signing secret (deleting {num_id})...")
                                    del_res = await client.delete(
                                        f"https://api.x.ai/v2/phone-numbers/{num_id}",
                                        headers={"Authorization": f"Bearer {key_clean}"}
                                    )
                                    logger.info(f"xAI delete response ({num_id}): HTTP {del_res.status_code} - {del_res.text}")
                                    if del_res.status_code in [200, 204]:
                                        existing_number = None
                                    else:
                                        logger.warning(f"xAI delete returned HTTP {del_res.status_code}: {del_res.text}")
                                except Exception as del_err:
                                    logger.warning(f"Could not delete number to rotate secret: {del_err}")

                        # 2. Create registration on xAI if new or successfully deleted for recreation
                        if not existing_number:
                            # Twilio's known SIP signaling & media CIDR ranges for IP allowlist auth
                            twilio_sip_cidrs = [
                                "168.86.128.0/18",     # Global media (RTP/SRTP)
                                "54.172.60.0/23",      # US East signaling
                                "34.203.250.0/23",     # US East signaling
                                "54.244.51.0/24",      # US West signaling
                                "54.171.127.192/26",   # EU (Ireland) signaling
                                "35.156.191.128/25",   # EU (Frankfurt) signaling
                                "54.65.63.192/26",     # Asia Pacific (Tokyo) signaling
                                "54.169.127.128/26",   # Asia Pacific (Singapore) signaling
                                "54.252.254.64/26",    # Asia Pacific (Sydney) signaling
                                "177.71.206.192/26",   # South America (São Paulo) signaling
                            ]
                            payload = {
                                "origin": "byo_trunk",
                                "name": "AIVHub Voice Agent",
                                "phone_number": phone_clean,
                                "webhook": {
                                    "name": "AIVHub SIP Webhook",
                                    "url": target_webhook
                                },
                                "sip_auth": {
                                    "allowed_addresses": twilio_sip_cidrs
                                }
                            }
                            if req.agent_id and not req.agent_id.startswith("agent_QDoRHfWc"):
                                payload["agent_id"] = req.agent_id

                            reg_res = await client.post(
                                "https://api.x.ai/v2/phone-numbers",
                                headers={"Authorization": f"Bearer {key_clean}", "Content-Type": "application/json"},
                                json=payload
                            )
                            logger.info(f"xAI phone registration response ({phone_clean}): HTTP {reg_res.status_code} - {reg_res.text}")
                            if reg_res.status_code in [200, 201]:
                                reg_data = reg_res.json()
                                signing_secret = extract_xai_secret(reg_data)
                                auto_registered = True
                                logger.info(f"xAI registration succeeded. Signing secret extracted: {bool(signing_secret)}")
                            elif reg_res.status_code == 409:
                                # Number exists on xAI already and delete was not permitted
                                auto_registered = True
                                logger.info(f"xAI returned 409 (already registered on xAI): {phone_clean}")
                            else:
                                reg_error = f"xAI returned HTTP {reg_res.status_code}: {reg_res.text}"
                                logger.error(f"xAI registration failed: {reg_error}")
                                await log_process_event(
                                    subsystem="telephony",
                                    process_name="xai_registration_failed",
                                    message=f"xAI rejected registration for {phone_clean}: {reg_error}",
                                    level="ERROR",
                                    details={"statusCode": reg_res.status_code, "response": reg_res.text, "phone": phone_clean}
                                )
                        else:
                            # Number already registered on xAI
                            auto_registered = True
                            logger.info(f"Number {phone_clean} is confirmed active and connected on xAI Direct SIP.")
                except Exception as reg_err:
                    reg_error = str(reg_err)
                    logger.warning(f"Could not contact xAI endpoint: {reg_err}")

            elif "openai" in engine:
                v_res = await validate_api_key(provider="OpenAI", api_key=key_clean)
                if not v_res["valid"]:
                    raise HTTPException(status_code=400, detail=v_res.get("error", "OpenAI authentication failed."))

            elif "twilio" in carrier:
                tw_sid_to_val = (req.account_sid or "").strip() or prev_sid
                tw_token_to_val = (key_clean if key_clean and not key_clean.startswith("xai-") else None) or prev_auth
                if tw_sid_to_val and tw_token_to_val:
                    v_res = await validate_api_key(provider="Twilio", api_key=tw_token_to_val, account_sid=tw_sid_to_val)
                    if not v_res["valid"]:
                        raise HTTPException(status_code=400, detail=v_res.get("error", "Twilio authentication failed."))

        # Check Twilio account for number verification if Twilio credentials exist
        twilio_note = ""
        if "twilio" in carrier:
            tw_sid = prev_sid or req.account_sid
            tw_token = prev_auth or (key_clean if key_clean and not key_clean.startswith("xai-") else None)
            if tw_sid and tw_token:
                try:
                    async with httpx.AsyncClient(timeout=8.0) as tw_client:
                        tw_url = f"https://api.twilio.com/2010-04-01/Accounts/{tw_sid}/IncomingPhoneNumbers.json"
                        tw_res = await tw_client.get(tw_url, auth=(tw_sid, tw_token))
                        if tw_res.status_code == 200:
                            tw_data = tw_res.json()
                            tw_nums = [
                                normalize_phone_number(n.get("phone_number", ""))
                                for n in tw_data.get("incoming_phone_numbers", [])
                                if n.get("phone_number")
                            ]
                            if tw_nums:
                                if phone_clean in tw_nums:
                                    twilio_verified = True
                                    twilio_note = "Verified on active Twilio account."
                                else:
                                    twilio_note = f"Saved. Notice: {phone_clean} was not found among purchased Twilio numbers ({', '.join(tw_nums)}). Ensure it is verified in Twilio Console before placing live calls."
                except Exception as tw_err:
                    logger.warning(f"Could not verify number against Twilio: {tw_err}")

        # 2. Update Company Profile Caller ID and Connection entries
        signing_secret = req.signing_secret.strip() if req.signing_secret else signing_secret
        if signing_secret:
            settings.XAI_WEBHOOK_SECRET = signing_secret
            import os
            os.environ["XAI_WEBHOOK_SECRET"] = signing_secret

        if "xai" in engine and key_clean and not key_clean.startswith("mock"):
            settings.XAI_API_KEY = key_clean
            settings.VOICE_ENGINE_MODE = "live"
            import os
            os.environ["XAI_API_KEY"] = key_clean
            os.environ["VOICE_ENGINE_MODE"] = "live"
        elif "openai" in engine or "modular" in engine or "livekit" in engine:
            settings.VOICE_ENGINE_MODE = "live"
            import os
            os.environ["VOICE_ENGINE_MODE"] = "live"
            if "openai" in engine and key_clean:
                settings.OPENAI_API_KEY = key_clean
                os.environ["OPENAI_API_KEY"] = key_clean

        carrier_name = "Telnyx" if "telnyx" in carrier else "Twilio" if "twilio" in carrier else "Generic SIP" if "sip" in carrier else "Custom"
        engine_name = "xAI Realtime" if "xai" in engine else "OpenAI Realtime" if "openai" in engine else "LiveKit (self-hosted)" if "livekit" in engine else "Modular Pipeline" if "modular" in engine else "Custom"
        masked_key = (key_clean[:4] + "••••" + key_clean[-4:]) if len(key_clean) > 8 else "••••••••"

        try:
            # Update Company Profile Caller ID
            prof_res = await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))
            profile = prof_res.scalars().first()
            if profile:
                profile.caller_id = phone_clean
            else:
                db.add(CompanyProfile(id="default", caller_id=phone_clean))
            await db.flush()

            voice_choice, voice_accent = _split_voice_choice(req.voice_name or "rex", None)
            from app.services.voice_plugin_plan import looks_like_external_voice_id
            voice_is_clone = looks_like_external_voice_id(voice_choice)

            # Clean and re-insert Telephony and Voice Orchestration connections
            await db.execute(delete(Connection).where(Connection.group_name.in_(["Telephony", "Voice Orchestration"])))

            tele_masked = mask_secret(prev_auth) if prev_auth else (prev_tele_masked or "••••••••")
            db.add(Connection(
                id=f"conn_{uuid.uuid4().hex[:6]}",
                group_name="Telephony",
                name=carrier_name,
                status="connected",
                api_key_masked=tele_masked,
                config=seal_config({
                    "phoneNumber": phone_clean,
                    "carrier": carrier_name,
                    "account_sid": prev_sid,
                    "api_key": prev_auth,
                    "auth_token": prev_auth,
                })
            ))
            db.add(Connection(
                id=f"conn_{uuid.uuid4().hex[:6]}",
                group_name="Voice Orchestration",
                name=engine_name,
                status="connected",
                api_key_masked=masked_key,
                config=seal_config({
                    "api_key": key_clean,
                    "signing_secret": signing_secret,
                    "phoneNumber": phone_clean,
                    "engine": engine,
                    "engine_label": engine_name,
                    "voice_name": voice_choice,
                    "accent": voice_accent,
                    "custom_voices": prev_voices,
                    "cloned_voice_id": voice_choice if voice_is_clone else None,
                    "cloned_voice_label": (prev_label if voice_is_clone else None) or (
                        f"{voice_choice}-uk" if voice_accent == "british" else voice_choice
                    ),
                    "external_tts": voice_is_clone,
                    "silence_duration_ms": req.silence_duration_ms or 380,
                    "temperature": req.temperature or 0.80
                })
            ))
            await db.commit()
        except Exception as db_err:
            logger.warning(f"Database persistence warning in provision_telephony_hub: {db_err}")
            try:
                await db.rollback()
            except Exception:
                pass

        try:
            await log_process_event(
                subsystem="telephony",
                process_name="telephony_hub_provisioned",
                message=f"Telephony & Voice Hub activated: Carrier={carrier_name}, Engine={engine_name}, Phone={phone_clean}.",
                level="SUCCESS",
                details={
                    "carrier": carrier_name,
                    "engine": engine_name,
                    "phone": phone_clean,
                    "autoRegistered": auto_registered,
                    "hasSigningSecret": bool(signing_secret)
                }
            )
        except Exception:
            pass

        has_error = bool(reg_error)
        if "xai" in engine and auto_registered and signing_secret:
            msg = f"Successfully registered {phone_clean} with xAI BYO Trunk. {twilio_note}".strip()
        elif "xai" in engine and auto_registered and not signing_secret:
            num_desc = existing_number.get("phone_number_id") if existing_number else "active"
            msg = f"Phone number {phone_clean} is confirmed connected on xAI Direct SIP (ID: {num_desc}). {twilio_note}".strip()
        elif twilio_verified:
            msg = f"Phone number {phone_clean} verified on Twilio. Active engine: {engine_name}."
        elif twilio_note:
            msg = f"{carrier_name} & {engine_name} linked to {phone_clean}. {twilio_note}"
        elif has_error:
            msg = f"Config saved, but registration warning: {reg_error}"
        else:
            msg = f"{carrier_name} & {engine_name} linked to {phone_clean}."

        return {
            "success": not has_error,
            "carrier": carrier_name,
            "engine": engine_name,
            "phoneNumber": phone_clean,
            "autoRegistered": auto_registered,
            "signingSecret": signing_secret,
            "registrationError": reg_error,
            "status": "connected" if (auto_registered or signing_secret) else ("error" if has_error else "configured"),
            "fqdn": settings.XAI_SIP_FQDN,
            "message": msg
        }
    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        err_tb = traceback.format_exc()
        logger.error(f"Error in provision_telephony_hub: {err_tb}")
        raise HTTPException(status_code=500, detail=f"Provision error: {str(exc)}")

@router.get("/telephony-hub/debug")
async def get_telephony_hub_debug(db: AsyncSession = Depends(get_db)):
    """Diagnostic endpoint returning server environment, git commit, and test DB query."""
    import subprocess, sys
    
    git_commit = "unknown"
    try:
        git_commit = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception as e:
        git_commit = str(e)
        
    db_status = "ok"
    active_secret = settings.XAI_WEBHOOK_SECRET
    try:
        from sqlalchemy import text
        res = await db.execute(text("SELECT 1;"))
        db_val = res.scalar()
        
        # Check DB connection table for signing secret if not in settings
        if not active_secret:
            c_res = await db.execute(select(Connection).where(Connection.group_name == "Voice Orchestration"))
            c = c_res.scalars().first()
            if c and c.config and isinstance(c.config, dict):
                active_secret = config_get_secret(c.config, "signing_secret", "webhook_secret")
    except Exception as e:
        db_status = str(e)
        
    return {
        "git_commit": git_commit,
        "python_version": sys.version,
        "db_status": db_status,
        "xai_signing_secret_set": bool(active_secret),
        "xai_signing_secret_preview": mask_secret(active_secret) if active_secret else None
    }


@router.post("/telephony-hub/test-ping")
async def test_telephony_hub_ping():
    """
    Sends an instant diagnostic health ping to measure roundtrip response time and log telemetry.
    """
    try:
        start_time = time.time()
        status_code = 200
        public = (getattr(settings, "PUBLIC_BASE_URL", None) or "http://127.0.0.1:8000").rstrip("/")
        webhook = (
            getattr(settings, "XAI_WEBHOOK_URL", None)
            or f"{public}/api/sip-webhook"
        )
        details = {
            "webhook_url": webhook,
            "voice_engine": settings.VOICE_ENGINE_MODE,
            "xai_fqdn": settings.XAI_SIP_FQDN,
            "xai_api_key_set": bool(settings.XAI_API_KEY),
            "xai_webhook_secret_set": bool(settings.XAI_WEBHOOK_SECRET),
        }

        elapsed_ms = (time.time() - start_time) * 1000

        try:
            await log_process_event(
                subsystem="telephony",
                process_name="telephony_hub_diagnostic_ping",
                message=f"Telephony diagnostic ping roundtrip: {elapsed_ms:.1f}ms (HTTP {status_code}).",
                level="SUCCESS" if status_code < 400 else "WARNING",
                duration_ms=elapsed_ms,
                details=details
            )
        except Exception:
            pass

        return {
            "success": True,
            "statusCode": 200,
            "latencyMs": round(elapsed_ms, 1),
            "details": details
        }
    except Exception as exc:
        return {
            "success": False,
            "statusCode": 500,
            "latencyMs": 0,
            "details": {"error": str(exc)}
        }


@router.get("/telephony-hub/xai-numbers")
async def list_xai_registered_numbers(db: AsyncSession = Depends(get_db)):
    """Queries xAI directly to list all numbers currently registered on the xAI account."""
    key = settings.XAI_API_KEY
    if not key:
        c_res = await db.execute(select(Connection).where(Connection.group_name == "Voice Orchestration"))
        c = c_res.scalars().first()
        if c and c.config and isinstance(c.config, dict):
            key = config_get_secret(c.config, "api_key", "auth_token")
    if not key:
        raise HTTPException(status_code=400, detail="No xAI API Key configured.")

    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.get(
            "https://api.x.ai/v2/phone-numbers",
            headers={"Authorization": f"Bearer {key}"}
        )
        return {
            "statusCode": res.status_code,
            "data": res.json() if res.status_code == 200 else res.text
        }



