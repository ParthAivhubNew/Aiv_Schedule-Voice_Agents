import os
import uuid
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete
from app.database import get_db
from app.config import settings
from app.models.models import Connection, Mission, CallLog, Meeting, Prospect, CompanyProfile
from app.schemas.schemas import ConnectionSchema
from app.services.key_validator import validate_api_key
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

    @property
    def resolved_api_key(self) -> str:
        return (self.api_key or self.apiKey or "").strip()

    @property
    def resolved_base_url(self) -> Optional[str]:
        return self.base_url or self.baseUrl

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
        "Calendar": "Checks availability and books confirmed meetings.",
        "Business Discovery": "Finds and researches prospect businesses on the web.",
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
        grouped[c.group_name]["items"].append({
            "id": c.id,
            "name": c.name,
            "status": c.status,
            "apiKeyMasked": c.api_key_masked or "••••••••"
        })
        
    return list(grouped.values())

@router.post("/test")
async def test_connection_only(req: TestKeyRequest):
    """
    Performs live test against provider API without saving.
    """
    key = req.resolved_api_key
    if not key:
        raise HTTPException(
            status_code=400,
            detail="API Key is required to perform validation test."
        )
    validation = await validate_api_key(
        provider=req.provider,
        api_key=key,
        base_url=req.resolved_base_url,
        account_sid=req.account_sid
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
    """
    key = req.resolved_api_key
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
        account_sid=req.account_sid
    )
    
    if not validation["valid"]:
        raise HTTPException(
            status_code=400,
            detail=validation.get("error", f"Authentication failed for {req.provider}.")
        )
    
    # 2. Mask the key for safe storage
    clean_key = key
    masked = clean_key[:3] + "••••••••" + clean_key[-4:] if len(clean_key) > 8 else "••••••••"
    
    # 3. Save or update connection in database
    display_name = f"{req.provider}" + (f" ({req.base_url})" if req.provider.lower() == "other" and req.base_url else "")
    
    # Check if this connection already exists in this group
    result = await db.execute(
        select(Connection).where(Connection.group_name == req.layer, Connection.name == display_name)
    )
    existing = result.scalars().first()
    
    if existing:
        existing.status = "connected"
        existing.api_key_masked = masked
        conn_id = existing.id
    else:
        conn_id = f"conn_{uuid.uuid4().hex[:6]}"
        conn = Connection(
            id=conn_id,
            group_name=req.layer,
            name=display_name,
            status="connected",
            api_key_masked=masked
        )
        db.add(conn)

    await db.commit()
    
    return {
        "success": True,
        "id": conn_id,
        "provider": req.provider,
        "layer": req.layer,
        "status": "connected",
        "maskedKey": masked,
        "details": validation.get("details", "Verified & Active")
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
    carrier: str = "telnyx"        # telnyx, twilio, generic_sip, simulation
    engine: str = "xai"            # xai, openai, modular, simulation
    phone_number: str
    api_key: Optional[str] = None
    account_sid: Optional[str] = None
    agent_id: Optional[str] = "agent_QDoRHfWcKMybf197"
    voice_name: Optional[str] = "rex"
    webhook_url: Optional[str] = None
    signing_secret: Optional[str] = None

@router.get("/telephony-hub")
async def get_telephony_hub_status(db: AsyncSession = Depends(get_db)):
    """
    Returns current active carrier, active engine, configured phone numbers,
    webhook routing diagnostics, and signing secret status.
    """
    active_secret = settings.XAI_WEBHOOK_SECRET or os.getenv("XAI_WEBHOOK_SECRET")
    try:
        # 1. Fetch Company Profile for caller ID
        prof_res = await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))
        profile = prof_res.scalars().first()
        active_phone = profile.caller_id if profile and profile.caller_id else settings.TELNYX_PHONE_NUMBER or "+1 (202) 555-0199"

        # 2. Fetch connections for Telephony and Voice Orchestration
        conns_res = await db.execute(select(Connection).where(Connection.group_name.in_(["Telephony", "Voice Orchestration"])))
        conns = conns_res.scalars().all()

        carrier_conn = next((c for c in conns if c.group_name == "Telephony"), None)
        engine_conn = next((c for c in conns if c.group_name == "Voice Orchestration"), None)
        
        stored_key = None
        if engine_conn and engine_conn.config and isinstance(engine_conn.config, dict):
            stored_key = engine_conn.config.get("api_key")
            stored_secret = engine_conn.config.get("signing_secret")
            if stored_secret:
                active_secret = stored_secret
                settings.XAI_WEBHOOK_SECRET = stored_secret

        active_key = settings.XAI_API_KEY or stored_key
        masked_active_key = engine_conn.api_key_masked if (engine_conn and engine_conn.api_key_masked) else ((active_key[:4] + "••••" + active_key[-4:]) if active_key and len(active_key) > 8 else "")

        active_carrier = carrier_conn.name if carrier_conn else ("Telnyx" if settings.TELNYX_API_KEY or settings.TELNYX_PHONE_NUMBER else "Simulation")
        active_engine = engine_conn.name if engine_conn else ("xAI Realtime" if settings.XAI_API_KEY else "Simulation")
        is_connected = bool((carrier_conn and carrier_conn.status == "connected") or settings.XAI_API_KEY or stored_key)
    except Exception as err:
        logger.warning(f"Error reading telephony hub status: {err}")
        active_carrier = "Telnyx" if settings.TELNYX_PHONE_NUMBER else "Simulation"
        active_engine = "xAI Realtime" if settings.XAI_API_KEY else "Simulation"
        active_phone = settings.TELNYX_PHONE_NUMBER or "+1 (202) 555-0199"
        is_connected = bool(settings.XAI_API_KEY)
        active_key = settings.XAI_API_KEY
        masked_active_key = (active_key[:4] + "••••" + active_key[-4:]) if active_key and len(active_key) > 8 else ""

    # 3. Detect public webhook URL
    default_webhook = "https://8000-01m1bx2zfn0zxjnf9833v44pnv.cloudspaces.litng.ai/api/sip-webhook"

    clean_secret = active_secret if (active_secret and not active_secret.startswith("whsec_••••")) else ""
    return {
        "activeCarrier": active_carrier,
        "activeEngine": active_engine,
        "phoneNumber": active_phone,
        "agentId": getattr(settings, "XAI_AGENT_ID", "agent_QDoRHfWcKMybf197"),
        "voiceName": settings.XAI_VOICE_NAME,
        "status": "connected" if is_connected else "configured",
        "webhookUrl": default_webhook,
        "xaiFqdn": settings.XAI_SIP_FQDN,
        "codecs": ["G.711 μ-law (PCMU)", "G.711 A-law (PCMA)", "G.722"],
        "hasApiKey": bool(active_key),
        "apiKeyMasked": masked_active_key,
        "hasSigningSecret": bool(clean_secret),
        "signingSecret": clean_secret,
        "signingSecretMasked": (clean_secret[:8] + "••••••••" + clean_secret[-4:]) if clean_secret and len(clean_secret) > 12 else ("whsec_••••••••" if clean_secret else "Not configured"),
        "isLive": settings.VOICE_ENGINE_MODE == "live" or is_connected
    }


@router.post("/telephony-hub/provision")
async def provision_telephony_hub(req: TelephonyHubProvisionRequest, db: AsyncSession = Depends(get_db)):
    """
    Self-serve multi-provider provisioning:
    1. Validates provider credentials in real-time.
    2. Auto-provisions webhook registration if xAI / Telnyx is selected.
    3. Saves active stack and phone number directly into database without server reboots.
    """
    try:
        carrier = req.carrier.lower()
        engine = req.engine.lower()
        phone_clean = req.phone_number.strip()
        key_clean = (req.api_key or "").strip()

        # If key is left blank, reuse previously stored API key
        if not key_clean:
            if settings.XAI_API_KEY:
                key_clean = settings.XAI_API_KEY
            else:
                c_res = await db.execute(select(Connection).where(Connection.group_name == "Voice Orchestration"))
                prev_c = c_res.scalars().first()
                if prev_c and prev_c.config and isinstance(prev_c.config, dict):
                    key_clean = prev_c.config.get("api_key", "")
        
        signing_secret = None
        auto_registered = False

        # 1. Real-time credential validation
        if key_clean and not key_clean.startswith("mock") and carrier != "simulation" and engine != "simulation":
            # Validate engine key if provided
            if "xai" in engine:
                v_res = await validate_api_key(provider="xAI (Grok)", api_key=key_clean)
                if not v_res["valid"]:
                    raise HTTPException(status_code=400, detail=v_res.get("error", "xAI authentication failed."))

                # Auto-register number with xAI BYO trunk API
                target_webhook = req.webhook_url or "https://8000-01m1bx2zfn0zxjnf9833v44pnv.cloudspaces.litng.ai/api/sip-webhook"
                target_agent_id = req.agent_id or getattr(settings, "XAI_AGENT_ID", "agent_QDoRHfWcKMybf197")
                try:
                    async with httpx.AsyncClient(timeout=12.0) as client:
                        reg_res = await client.post(
                            "https://api.x.ai/v2/phone-numbers",
                            headers={"Authorization": f"Bearer {key_clean}", "Content-Type": "application/json"},
                            json={
                                "origin": "byo_trunk",
                                "name": "AIVHub Voice Agent",
                                "phone_number": phone_clean,
                                "agent_id": target_agent_id,
                                "webhook": {"name": "AIVHub SIP Webhook", "url": target_webhook}
                            }
                        )
                        if reg_res.status_code in [200, 201]:
                            reg_data = reg_res.json()
                            signing_secret = reg_data.get("signing_secret") or reg_data.get("webhook_secret")
                            auto_registered = True
                except Exception as reg_err:
                    logger.warning(f"Could not auto-register with xAI endpoint: {reg_err}")


            elif "openai" in engine:
                v_res = await validate_api_key(provider="OpenAI", api_key=key_clean)
                if not v_res["valid"]:
                    raise HTTPException(status_code=400, detail=v_res.get("error", "OpenAI authentication failed."))

            elif "twilio" in carrier:
                v_res = await validate_api_key(provider="Twilio", api_key=key_clean, account_sid=req.account_sid)
                if not v_res["valid"]:
                    raise HTTPException(status_code=400, detail=v_res.get("error", "Twilio authentication failed."))

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

        carrier_name = "Telnyx" if "telnyx" in carrier else "Twilio" if "twilio" in carrier else "Generic SIP" if "sip" in carrier else "Simulation"
        engine_name = "xAI Realtime" if "xai" in engine else "OpenAI Realtime" if "openai" in engine else "Modular Pipeline" if "modular" in engine else "Simulation"
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

            # Clean and re-insert Telephony and Voice Orchestration connections
            await db.execute(delete(Connection).where(Connection.group_name.in_(["Telephony", "Voice Orchestration"])))
            
            db.add(Connection(
                id=f"conn_{uuid.uuid4().hex[:6]}",
                group_name="Telephony",
                name=carrier_name,
                status="connected",
                api_key_masked=masked_key,
                config={"phoneNumber": phone_clean, "carrier": carrier_name}
            ))
            db.add(Connection(
                id=f"conn_{uuid.uuid4().hex[:6]}",
                group_name="Voice Orchestration",
                name=engine_name,
                status="connected",
                api_key_masked=masked_key,
                config={
                    "api_key": key_clean,
                    "signing_secret": signing_secret,
                    "phoneNumber": phone_clean,
                    "engine": engine_name
                }
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

        return {
            "success": True,
            "carrier": carrier_name,
            "engine": engine_name,
            "phoneNumber": phone_clean,
            "autoRegistered": auto_registered,
            "signingSecret": signing_secret,
            "status": "connected",
            "fqdn": settings.XAI_SIP_FQDN,
            "message": f"{carrier_name} & {engine_name} successfully linked to {phone_clean}."
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
                active_secret = c.config.get("signing_secret")
    except Exception as e:
        db_status = str(e)
        
    return {
        "git_commit": git_commit,
        "python_version": sys.version,
        "db_status": db_status,
        "xai_signing_secret_set": bool(active_secret),
        "xai_signing_secret_preview": (active_secret[:12] + "...") if active_secret else None
    }


@router.post("/telephony-hub/test-ping")
async def test_telephony_hub_ping():
    """
    Sends an instant diagnostic health ping through the internal webhook router
    to measure roundtrip response time and log telemetry.
    """
    from app.api.sip_webhook import webhook_health_check
    start_time = time.time()
    status_code = 200
    details = {}

    try:
        details = await webhook_health_check()
    except Exception as e:
        status_code = 500
        details = {"error": str(e)}

    elapsed_ms = (time.time() - start_time) * 1000

    await log_process_event(
        subsystem="telephony",
        process_name="telephony_hub_diagnostic_ping",
        message=f"Telephony diagnostic ping roundtrip: {elapsed_ms:.1f}ms (HTTP {status_code}).",
        level="SUCCESS" if status_code < 400 else "WARNING",
        duration_ms=elapsed_ms,
        details=details
    )

    return {
        "success": status_code < 400,
        "statusCode": status_code,
        "latencyMs": round(elapsed_ms, 1),
        "details": details
    }

