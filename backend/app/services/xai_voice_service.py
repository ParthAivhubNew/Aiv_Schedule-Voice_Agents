import asyncio
import base64
import hashlib
import hmac
import json
import logging
import time
import uuid
import zoneinfo
from datetime import datetime, timedelta
import re
from typing import Any, Dict, List, Optional

import websockets
from sqlalchemy.future import select

from app.config import settings
from app.database import AsyncSessionLocal
from app.models.models import (
    CallLog,
    CompanyProfile,
    Connection,
    LiveCall,
    Meeting,
    Mission,
    Prospect,
    ScheduleItem,
    Service,
    FAQ,
)
from app.services.call_names import clean_person_label, greeting_first_name, is_generic_label, resolve_call_people, apply_names_to_log
from app.services.process_logger import log_process_event, scrub_text
from app.services.rag_service import search_knowledge
from app.services.timezone_service import display_hhmm, now_in, resolve_prospect_timezone
from app.websockets.call_hub import call_hub

logger = logging.getLogger("xai_voice_service")

# Global registry of live xAI WebSocket sessions for supervisor takeover and handoff
active_xai_sessions: Dict[str, Any] = {}

# SIP-first outbound: xAI is hot while the prospect still rings. Greeting waits for pickup.
_sip_first_calls: Dict[str, Dict[str, Any]] = {}


def mark_sip_first_call(custom_call_id: str) -> None:
    if not custom_call_id:
        return
    _sip_first_calls[str(custom_call_id)] = {
        "session_ready": asyncio.Event(),
        "answered": asyncio.Event(),
        "dispatch": None,
        "aliases": {str(custom_call_id)},
    }


def _sip_first_record(*ids: Optional[str]) -> Optional[Dict[str, Any]]:
    for raw in ids:
        if not raw:
            continue
        key = str(raw)
        if key in _sip_first_calls:
            return _sip_first_calls[key]
        for rec in _sip_first_calls.values():
            if key in (rec.get("aliases") or set()):
                return rec
    return None


def alias_sip_first_call(custom_call_id: str, *extra_ids: Optional[str]) -> None:
    rec = _sip_first_record(custom_call_id)
    if not rec:
        return
    for extra in extra_ids:
        if extra:
            rec["aliases"].add(str(extra))
            _sip_first_calls[str(extra)] = rec


_IVR_HOLD_MARKERS = (
    "please wait",
    "please hold",
    "hold the line",
    "your call is important",
    "press 1",
    "press one",
    "an automated",
    "try again later",
)

_VOICEMAIL_MARKERS = (
    "leave a message",
    "after the tone",
    "record your message",
    "mailbox",
    "voicemail",
    "forwarded to voicemail",
    "the person you called",
    "not available",
    "no one is available",
    "leave your message",
    "at the tone",
)


def _is_voicemail_prompt(text: str) -> bool:
    t = (text or "").lower()
    return any(m in t for m in _VOICEMAIL_MARKERS)


def _is_hold_ivr(text: str) -> bool:
    t = (text or "").lower()
    if _is_voicemail_prompt(t):
        return False
    return any(m in t for m in _IVR_HOLD_MARKERS)


def _is_ivr_or_hold(text: str) -> bool:
    """Legacy helper — hold OR voicemail machine audio."""
    return _is_hold_ivr(text) or _is_voicemail_prompt(text)


def _xai_voice_id(raw: Optional[str], accent: Optional[str] = None) -> str:
    v = (raw or "rex").strip()
    low = v.lower()
    # UI ids with -uk map onto xAI voice ids; accent is handled separately in the prompt.
    aliases = {
        "rex-uk": "rex",
        "rex_uk": "rex",
        "sam-uk": "rex",
        "sam_uk": "rex",
        "ara-uk": "ara",
        "ara_uk": "ara",
        "eve-uk": "eve",
        "eve_uk": "eve",
        "leo-uk": "leo",
        "leo_uk": "leo",
    }
    if low in aliases:
        return aliases[low]
    if low in ("ara", "eve", "rex", "leo", "alloy", "echo", "shimmer", "onyx", "sage"):
        return low
    # Cartesia UUID / ElevenLabs clone ids are not valid xAI voices — keep a builtin for session.
    if re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-", low) or len(v) >= 16:
        return "rex"
    if accent and str(accent).lower() in ("british", "uk", "en-gb"):
        # Keep female voices female when UK accent selected
        if "ara" in low:
            return "ara"
        if "eve" in low:
            return "eve"
    return v or "rex"


def _voice_gender(voice_id: Optional[str]) -> str:
    v = (voice_id or "").lower()
    if any(x in v for x in ("ara", "eve", "shimmer", "nova")):
        return "female"
    return "male"


async def notify_prospect_answered(call_id: str) -> bool:
    """PSTN callee picked up. Dump buffered hello onto the line with no extra wait."""
    rec = _sip_first_record(call_id)
    if rec:
        rec["answered"].set()
        rec["answered_at"] = time.time()
    sess = get_bridged_session(call_id)
    if not sess and rec:
        for alias in rec.get("aliases") or []:
            sess = get_bridged_session(alias)
            if sess:
                break
    if sess and not sess.is_inbound:
        await sess.release_to_caller()
    dispatch = rec.get("dispatch") if rec else None
    if dispatch:
        await dispatch("prospect_answered")
        return True
    logger.info(f"[XAI-WS] Prospect answered {call_id}; greeting buffer released")
    return True


class BridgedVoiceSession:
    """xAI audio over WebSocket (G.711 μ-law) so the carrier never waits on SIP after the human is on the line."""

    def __init__(self, call_id: str, is_inbound: bool = False):
        self.call_id = str(call_id)
        self.is_inbound = is_inbound
        self.ready = asyncio.Event()
        self.closed = asyncio.Event()
        self._buf: List[str] = []
        self._live = False
        self._released = bool(is_inbound)
        self.ws = None
        self.on_caller_audio = None
        self.engine = "xai"
        self._dg_ws = None
        self._cartesia_ws = None
        self._speaking_task = None

    async def close(self) -> None:
        """Stops the voice session and cancels any background speech or STT connections."""
        self.closed.set()
        self._live = False
        if self._speaking_task and not self._speaking_task.done():
            try:
                self._speaking_task.cancel()
            except Exception:
                pass
        if self._dg_ws:
            try:
                await self._dg_ws.close()
            except Exception:
                pass
            self._dg_ws = None
        if self._cartesia_ws:
            try:
                await self._cartesia_ws.close()
            except Exception:
                pass
            self._cartesia_ws = None
        if self.ws:
            try:
                await self.ws.close()
            except Exception:
                pass
            self.ws = None

    async def attach_stream(self, stream_sid: Optional[str] = None) -> None:
        self._live = True
        await self._flush_if_released()

    async def release_to_caller(self) -> None:
        """Prospect picked up — dump buffered greeting onto the line now."""
        logger.info(f"[XAI-BRIDGE] Releasing buffered greeting to caller for {self.call_id}")
        self._released = True
        await self._flush_if_released()

    async def _flush_if_released(self) -> None:
        if not self._live or not self._released:
            logger.debug(
                f"[XAI-BRIDGE] Hold buffer call={self.call_id} live={self._live} "
                f"released={self._released} pending={len(self._buf)}"
            )
            return
        chunks = self._buf
        self._buf = []
        if chunks:
            logger.info(f"[XAI-BRIDGE] Flushing {len(chunks)} greeting frames onto the live line for {self.call_id}")
        else:
            logger.info(f"[XAI-BRIDGE] No buffered frames to flush for {self.call_id}")
        for chunk in chunks:
            await self._send_to_twilio(chunk)

    async def push_caller_audio(self, b64: str) -> None:
        if not b64:
            return
        try:
            from app.websockets.media_stream import media_stream_hub
            if self.call_id in media_stream_hub.active_takeovers:
                logger.debug(f"[XAI-BRIDGE] Ignoring caller audio during supervisor takeover on {self.call_id}")
                return
            if self.on_caller_audio:
                await self.on_caller_audio(b64)
                return
            if not self.ws:
                if getattr(self, "engine", "") not in ("modular", "livekit"):
                    logger.warning(f"[XAI-BRIDGE] ❌ No WebSocket on session {self.call_id} — caller audio NOT sent to xAI")
                return
            await self.ws.send(json.dumps({"type": "input_audio_buffer.append", "audio": b64}))
            logger.debug(f"[XAI-BRIDGE] Appended caller audio ({len(b64)} bytes) to xAI input buffer for {self.call_id}")
        except Exception as err:
            logger.warning(f"[XAI-BRIDGE] Failed to append caller audio: {err}")

    async def emit_ai_audio(self, b64: str) -> None:
        if not b64:
            return
        if self._live and self._released:
            await self._send_to_twilio(b64)
        else:
            self._buf.append(b64)
            if not self.ready.is_set():
                self.ready.set()

    async def wait_ready(self, timeout: float = 2.5) -> bool:
        try:
            await asyncio.wait_for(self.ready.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            logger.warning(f"[XAI-BRIDGE] Ready wait timed out for {self.call_id} after {timeout}s")
            return False

    async def _send_to_twilio(self, b64: str) -> None:
        try:
            from app.websockets.media_stream import media_stream_hub
            await media_stream_hub.inject_operator_audio_to_twilio(self.call_id, b64)
        except Exception as err:
            logger.warning(f"[XAI-BRIDGE] Twilio inject failed: {err}")


bridged_sessions: Dict[str, BridgedVoiceSession] = {}


async def start_bridged_voice_session(
    call_id: str,
    caller_number: str,
    prospect_name: Optional[str] = None,
    is_inbound: bool = False,
    carrier_sid: Optional[str] = None,
) -> BridgedVoiceSession:
    from app.services.voice_plugin_plan import resolve_voice_plan

    plan = await resolve_voice_plan()
    sess = BridgedVoiceSession(call_id, is_inbound=is_inbound)
    sess.engine = plan.engine
    bridged_sessions[str(call_id)] = sess
    if carrier_sid:
        bridged_sessions[str(carrier_sid)] = sess
    if not is_inbound:
        mark_sip_first_call(call_id)
        if carrier_sid:
            alias_sip_first_call(call_id, carrier_sid)
    mission = "Inbound Customer Call" if is_inbound else "Direct Outbound Outreach"
    prospect_id = None
    try:
        async with AsyncSessionLocal() as db:
            rec = (await db.execute(select(LiveCall).where(LiveCall.id == call_id))).scalars().first()
            if rec:
                prospect_id = rec.prospect_id
                file_name = ""
                if rec.prospect_id:
                    prow = (await db.execute(select(Prospect).where(Prospect.id == rec.prospect_id))).scalars().first()
                    if prow:
                        file_name = clean_person_label(prow.contact_person) or clean_person_label(prow.name)
                if file_name and is_generic_label(prospect_name):
                    prospect_name = file_name
                    rec.prospect = file_name
                    await db.commit()
                elif rec.prospect and is_generic_label(prospect_name):
                    prospect_name = rec.prospect
    except Exception as link_err:
        logger.debug(f"Could not hydrate prospect name for bridge {call_id}: {link_err}")
    logger.info(f"[VOICE-ROUTER] {call_id} engine={plan.engine} external_tts={getattr(plan, 'external_tts', False)} {plan.note}")

    if plan.engine == "openai":
        from app.services.voice_openai import run_openai_realtime
        asyncio.create_task(
            run_openai_realtime(
                sess,
                call_id=call_id,
                caller_number=caller_number,
                prospect_name=prospect_name,
                plan=plan,
                is_inbound=is_inbound,
                carrier_sid=carrier_sid,
            )
        )
    elif plan.engine == "modular" or plan.engine == "livekit":
        from app.services.voice_modular import run_modular_pipeline
        asyncio.create_task(
            run_modular_pipeline(
                sess,
                call_id=call_id,
                caller_number=caller_number,
                prospect_name=prospect_name,
                plan=plan,
                is_inbound=is_inbound,
                carrier_sid=carrier_sid,
            )
        )

    else:
        asyncio.create_task(
            join_xai_call_session(
                call_id=call_id,
                caller_number=caller_number,
                prospect_name=prospect_name,
                prospect_id=prospect_id,
                custom_call_id=call_id,
                carrier_sid=carrier_sid,
                mission_name=mission,
                audio_bridge=sess,
                voice_plan=plan,
            )
        )
    return sess


def get_bridged_session(*ids: Optional[str]) -> Optional[BridgedVoiceSession]:
    for raw in ids:
        if raw and str(raw) in bridged_sessions:
            return bridged_sessions[str(raw)]
    return None

async def notify_xai_takeover_state(call_id: str, taken: bool, recent_transcript: List[str] = None):
    """
    Informs xAI Realtime session when a human supervisor takes over or hands back.
    On hand back, injects the conversation context so the AI resumes seamlessly.
    """
    ws = active_xai_sessions.get(call_id)
    if not ws:
        return
    try:
        if taken:
            try:
                await ws.send(json.dumps({"type": "response.cancel"}))
            except Exception:
                pass
            await ws.send(json.dumps({
                "type": "conversation.item.create",
                "item": {
                    "type": "message",
                    "role": "user",
                    "content": [{
                        "type": "input_text",
                        "text": "[SYSTEM NOTICE: A human supervisor has taken over the call. Do not speak or generate responses until instructed.]"
                    }]
                }
            }))
            logger.info(f"[XAI-WS] Muted xAI voice agent for supervisor takeover on call {call_id}")
        else:
            # Build smart briefing of what happened during human takeover
            summary_lines = [str(l) for l in (recent_transcript or [])[-4:] if not str(l).startswith("System:")]
            summary_text = " // ".join(summary_lines) if summary_lines else "The supervisor spoke with the prospect and answered their initial questions."
            handoff_msg = (
                f"[SYSTEM NOTICE: The human supervisor has just handed the call back to you. "
                f"Points discussed during the takeover: '{summary_text}'. "
                f"Acknowledge the handoff smoothly and continue assisting the client naturally.]"
            )
            await ws.send(json.dumps({
                "type": "conversation.item.create",
                "item": {
                    "type": "message",
                    "role": "user",
                    "content": [{
                        "type": "input_text",
                        "text": handoff_msg
                    }]
                }
            }))
            # Trigger immediate spoken continuation
            await ws.send(json.dumps({"type": "response.create"}))
            logger.info(f"[XAI-WS] Injected supervisor handoff context into xAI session for call {call_id}")
    except Exception as err:
        logger.warning(f"[XAI-WS] Error notifying takeover state for {call_id}: {err}")


# ----------------------------------------------------------------------
# 1. SVIX STANDARD SIGNATURE VERIFICATION
# ----------------------------------------------------------------------
def verify_xai_webhook_signature(
    payload_bytes: bytes,
    headers: Dict[str, str],
    secret: Optional[str] = None
) -> bool:
    """
    Verifies xAI webhook signatures adhering to the Svix specification:
    Signed string = "{webhook_id}.{webhook_timestamp}.{raw_payload}"
    The secret is base64 decoded after stripping the 'whsec_' prefix.
    Rejects requests older than 300 seconds (anti-replay protection).
    """
    signing_secret = secret or settings.XAI_WEBHOOK_SECRET
    
    # If no secret configured in dev/testing, allow verification with warning
    if not signing_secret:
        logger.warning("No XAI_WEBHOOK_SECRET configured. Skipping signature verification in dev/local mode.")
        return True

    # Normalize header keys to lowercase
    normalized_headers = {k.lower(): v for k, v in headers.items()}
    msg_id = normalized_headers.get("webhook-id")
    msg_timestamp = normalized_headers.get("webhook-timestamp")
    msg_signature = normalized_headers.get("webhook-signature")

    if not msg_id or not msg_timestamp or not msg_signature:
        logger.warning("Webhook request missing required Svix headers: webhook-id, webhook-timestamp, or webhook-signature.")
        return False

    # 1. Anti-replay timestamp check (5 minute tolerance)
    try:
        ts = int(msg_timestamp)
        now = int(time.time())
        if abs(now - ts) > 300:
            logger.warning(f"Webhook timestamp expired: delta={abs(now - ts)}s > 300s.")
            return False
    except ValueError:
        logger.warning("Invalid webhook-timestamp header format.")
        return False

    # 2. Extract base64 secret
    try:
        clean_secret = signing_secret.strip()
        if clean_secret.startswith("whsec_"):
            clean_secret = clean_secret[6:]
        key_bytes = base64.b64decode(clean_secret)
    except Exception as err:
        logger.error(f"Failed to base64 decode XAI_WEBHOOK_SECRET: {err}")
        return False

    # 3. Compute expected signature: {id}.{timestamp}.{payload}
    to_sign = f"{msg_id}.{msg_timestamp}.".encode("utf-8") + payload_bytes
    expected_digest = hmac.new(key_bytes, to_sign, hashlib.sha256).digest()
    expected_sig = base64.b64encode(expected_digest).decode("utf-8")

    # 4. Compare with signatures in header (header can contain space-delimited 'v1,<sig>')
    for sig_part in msg_signature.strip().split(" "):
        if sig_part.startswith("v1,"):
            actual_sig = sig_part[3:]
            if hmac.compare_digest(expected_sig, actual_sig):
                return True

    logger.warning("Svix signature mismatch on webhook payload.")
    return False


# ----------------------------------------------------------------------
# 2. DYNAMIC SYSTEM PROMPT & TOOL DEFINITIONS
# ----------------------------------------------------------------------
def _spoken_brand(name: Optional[str], spoken_override: Optional[str] = None) -> str:
    """How the voice should say the company name. Prefer Company Profile spoken_name (UI)."""
    override = (spoken_override or "").strip()
    if override:
        return override
    raw = (name or "").strip()
    if not raw:
        return "the company"
    return raw


def _brand_speech_hint(spoken: str, written: Optional[str] = None) -> str:
    written_bit = f' (written "{written}")' if (written or "").strip() and (written or "").strip() != spoken else ""
    return (
        f'Say the company name exactly as: "{spoken}"{written_bit}. '
        f'CRITICAL VOICE RULE: Whenever you speak or output the company name, ALWAYS write it exactly as "{spoken}" so that the speech engine pronounces each word/letter cleanly without mumbling or slurring acronyms. Never output joined acronyms.'
    )


def _spoken_pitch(raw: Optional[str], company: str) -> str:
    """Keep Company Profile pitch wording. Do not rewrite into a generic dashboard line."""
    text = re.sub(r"\s+", " ", (raw or "").strip())
    if not text:
        return f"I'm calling from {company}"
    return text.rstrip(".,;:")


async def _resolve_call_clocks(
    db,
    call_id: Optional[str] = None,
    prospect_id: Optional[str] = None,
    caller_number: Optional[str] = None,
):
    from app.services.calendar_service import calendar_service

    setting = await calendar_service.get_or_create_settings(db)
    host_tz = setting.timezone or "Europe/London"
    phone = caller_number or ""
    mission_tz = None
    override = setting.prospect_timezone_override
    call_obj = None
    if call_id:
        c_res = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
        call_obj = c_res.scalars().first()
        if call_obj:
            if call_obj.prospect_timezone:
                override = call_obj.prospect_timezone
            if call_obj.prospect_id:
                prospect_id = prospect_id or call_obj.prospect_id
            if call_obj.mission_id:
                m_res = await db.execute(select(Mission).where(Mission.id == call_obj.mission_id))
                mission = m_res.scalars().first()
                if mission:
                    mission_tz = mission.timezone
    if prospect_id:
        p_res = await db.execute(select(Prospect).where(Prospect.id == prospect_id))
        p = p_res.scalars().first()
        if p:
            phone = p.phone or phone
            if p.mission_id and not mission_tz:
                m_res = await db.execute(select(Mission).where(Mission.id == p.mission_id))
                mission = m_res.scalars().first()
                if mission:
                    mission_tz = mission.timezone
    p_tz = resolve_prospect_timezone(phone=phone, mission_tz=mission_tz, override=override, host_tz=host_tz)
    if call_obj and not call_obj.prospect_timezone:
        call_obj.prospect_timezone = p_tz
    return host_tz, p_tz, phone, setting


async def build_xai_system_instructions(
    caller_number: str,
    prospect_name: Optional[str] = None,
    hold_opening: bool = False,
    prospect_id: Optional[str] = None,
    call_id: Optional[str] = None,
) -> str:
    """
    Constructs real-time system prompt customized with Company Profile,
    Service Catalog, caller context, real-world temporal ground truth,
    and charismatic, natural conversational rules.
    """
    try:
        async with AsyncSessionLocal() as clock_db:
            host_tz, prospect_tz, _, _ = await _resolve_call_clocks(
                clock_db, call_id=call_id, prospect_id=prospect_id, caller_number=caller_number
            )
        now = now_in(prospect_tz)
    except Exception:
        host_tz = "Europe/London"
        prospect_tz = "Europe/London"
        now = datetime.utcnow() + timedelta(hours=1)

    current_date_str = now.strftime("%A, %d %B %Y")
    current_time_str = now.strftime("%I:%M %p").lstrip("0")
    day_part = "morning" if now.hour < 12 else "afternoon" if now.hour < 17 else "evening"
    tomorrow_str = (now + timedelta(days=1)).strftime("%A, %d %B %Y")

    global _knowledge_cache
    current_time = asyncio.get_event_loop().time()
    if "_knowledge_cache" not in globals() or (current_time - _knowledge_cache.get("last_fetched", 0) > 60):
        try:
            async with AsyncSessionLocal() as db:
                prof_res = await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))
                services_res = await db.execute(select(Service))
                faqs_res = await db.execute(select(FAQ))
                _knowledge_cache = {
                    "profile": prof_res.scalars().first(),
                    "services": services_res.scalars().all(),
                    "faqs": faqs_res.scalars().all(),
                    "last_fetched": current_time
                }
        except Exception as cache_err:
            logger.warning(f"Error fetching knowledge cache: {cache_err}")
            if "_knowledge_cache" not in globals():
                _knowledge_cache = {"profile": None, "services": [], "faqs": [], "last_fetched": current_time}

    profile = _knowledge_cache.get("profile")
    services = _knowledge_cache.get("services") or []
    faqs = _knowledge_cache.get("faqs") or []

    company_name = (profile.name or "").strip() if profile else ""
    if not company_name:
        company_name = "the company"
    spoken_company = _spoken_brand(
        profile.name if profile else "",
        getattr(profile, "spoken_name", None) if profile else None,
    )
    caller_name = (profile.caller_name or "").strip() if profile else ""
    if not caller_name:
        caller_name = "the caller"
    pitch = (profile.pitch or "").strip() if profile else ""
    tone = (profile.tone or "").strip() if profile else ""
    if not tone:
        tone = "Warm, professional, natural"
    disclosure = (profile.disclosure or "").strip() if profile else ""
    if not disclosure:
        disclosure = "This call may be recorded for quality purposes."
    industry = (profile.industry if profile and profile.industry else "").strip()
    website = (profile.website if profile and profile.website else "").strip()
    social = (profile.social if profile and profile.social else "").strip()
    legal_name = (profile.legal_name if profile and profile.legal_name else company_name).strip()
    caller_id = (profile.caller_id if profile and profile.caller_id else "").strip()
    spoken_pitch = _spoken_pitch(pitch, spoken_company)

    target_name = clean_person_label(prospect_name) or "there"
    target_first_name = greeting_first_name(target_name)

    call_opener = (getattr(profile, "call_opener", None) or "").strip() if profile else ""
    call_hook = (getattr(profile, "call_hook", None) or "").strip() if profile else ""
    closing_ask = (getattr(profile, "closing_ask", None) or "").strip() if profile else ""
    custom_rules = (getattr(profile, "custom_rules", None) or "").strip() if profile else ""

    first_for_template = target_first_name if target_first_name != "there" else "there"
    if call_opener:
        effective_opener = (
            call_opener.replace("{name}", first_for_template)
            .replace("{caller_name}", caller_name)
            .replace("{company}", spoken_company)
        )
    else:
        effective_opener = (
            f"Hi {target_first_name}, this is {caller_name} calling from {spoken_company} — did I catch you in the middle of something?"
            if target_first_name != "there"
            else f"Hi there, this is {caller_name} calling from {spoken_company} — did I catch you in the middle of something?"
        )

    if call_hook:
        effective_hook = (
            call_hook.replace("{name}", first_for_template)
            .replace("{caller_name}", caller_name)
            .replace("{company}", spoken_company)
        )
    else:
        effective_hook = f"The reason for my call is {spoken_pitch}. Just curious—how are you currently tracking this in your operations?"

    effective_close = (
        closing_ask.replace("{name}", first_for_template)
        .replace("{caller_name}", caller_name)
        .replace("{company}", spoken_company)
        if closing_ask
        else "Open to a quick 15-minute walkthrough sometime this week?"
    )

    custom_rules_block = (
        f"""USER PROMPT RULES & OBJECTION HANDLING (MANDATORY — CONFIGURED IN CALL SCRIPT & RULES):\n{custom_rules}\n"""
        if custom_rules
        else ""
    )

    catalog_lines = []
    for s in services[:5]:
        catalog_lines.append(f"- {s.name}: {s.desc} (Ideal for: {s.ideal})")
    catalog_text = "\n".join(catalog_lines) if catalog_lines else "No services saved in Company Profile yet. Do not invent products."

    faq_lines = []
    for f in faqs[:10]:
        faq_lines.append(f"- Q: {f.question}\n  A: {f.answer}")
    faq_text = "\n".join(faq_lines) if faq_lines else "None provided yet."

    calendar_json = "{}"
    booking_rules = ""
    hangup_rules = ""
    try:
        from app.services.calendar_service import calendar_service
        from app.services.booking_policy import (
            normalize_booking_policy,
            voice_booking_instructions,
            voice_hangup_instructions,
        )
        async with AsyncSessionLocal() as cal_db:
            calendar_json = await calendar_service.get_availability_json(cal_db, days=3, prospect_tz=prospect_tz)
            setting = await calendar_service.get_or_create_settings(cal_db)
            policy = normalize_booking_policy(getattr(setting, "booking_policy", None))
            booking_rules = voice_booking_instructions(policy)
            hangup_rules = voice_hangup_instructions(policy)
    except Exception as cal_err:
        logger.warning(f"Could not load live calendar for voice prompt: {cal_err}")
        calendar_json = '{"note": "Live calendar lookup active — propose preferred time to verify."}'
        from app.services.booking_policy import voice_booking_instructions, voice_hangup_instructions
        booking_rules = voice_booking_instructions(None)
        hangup_rules = voice_hangup_instructions(None)

    accent_block = ""
    voice_raw = ""
    try:
        async with AsyncSessionLocal() as acc_db:
            c_res = await acc_db.execute(select(Connection).where(Connection.group_name == "Voice Orchestration"))
            eng = c_res.scalars().first()
            acc = ""
            if eng and isinstance(eng.config, dict):
                acc = str(eng.config.get("accent") or "").lower()
                voice_raw = str(eng.config.get("voice_name") or eng.config.get("voice") or "")
            if acc in ("british", "uk", "en-gb") or "-uk" in voice_raw.lower() or "_uk" in voice_raw.lower():
                is_female = _voice_gender(voice_raw) == "female"
                who = "UK caller (female)" if is_female else "UK caller (male)"
                accent_block = f"""ACCENT & DICTION (British English): Speak clear, measured British English ({who}). Enunciate clearly, natural times ('half past nine', 'two o\\'clock')."""
    except Exception:
        pass

    gender = _voice_gender(voice_raw)
    gender_line = (
        "Warm, confident female voice on a business call — never a rigid telemarketer."
        if gender == "female"
        else "Warm, confident male voice on a business call — never a rigid telemarketer."
    )

    demo_script = (getattr(profile, "demo_script", None) or "").strip() if profile else ""
    if not demo_script:
        demo_script = (
            f'Prospect: "Hello?"\n'
            f'AI: "{effective_opener}"\n'
            f'Prospect: "A little bit, what is this regarding?"\n'
            f'AI: "Totally get it, won\'t keep you! {effective_hook}"\n'
            f'Prospect: "Sounds interesting, how does that work?"\n'
            f'AI: "Makes total sense! {effective_close}"'
        )

    brand_hint = _brand_speech_hint(spoken_company, company_name)
    instructions = f"""You are {caller_name}, calling on behalf of {spoken_company} ("{company_name}").
ROLE & IDENTITY:
- Tone: {tone}. {gender_line}
- Brand pronunciation: {brand_hint}
- Target: {target_name}. Spoken name: {"'" + target_first_name + "'" if target_first_name != "there" else "unknown — say Hi there"}.
- Local Clock: {current_time_str} on {current_date_str} (Tomorrow: {tomorrow_str}).

=== DEMO CONVERSATION BLUEPRINT (IDEAL FLOW & FEELINGS) ===
Mimic the natural cadence, warmth, brevity, and emotional tone of this sample dialogue:
{demo_script}

=== MASTER BUSINESS RULES & OBJECTIONS ===
{custom_rules_block}
{booking_rules}
{hangup_rules}
{accent_block}

=== AVAILABLE MEETING SLOTS (LIVE CALENDAR JSON) ===
Propose 2-3 concrete times directly from this dictionary when scheduling (never invent times):
{calendar_json}

=== COMPANY & CAPABILITIES CONTEXT ===
- Value Pitch: {spoken_pitch}
- Statutory Disclosure: "{disclosure}"
- Key Services:
{catalog_text}
- Verified Knowledge & FAQs:
{faq_text}

=== CORE TELEPHONY & FLOW DIRECTIVES (MANDATORY) ===
1. CONVERSATION SPEED & BREVITY: Speak ONLY 1 to 2 short sentences per turn (under 25 words). Keep the ping-pong dialogue flowing naturally.
2. SPOKEN CONTRACTIONS: ALWAYS use natural spoken contractions ("I'm", "we're", "don't", "that's", "you'd", "won't"). Never use stiff formal phrases.
3. INSTANT AVAILABILITY (NEVER STALL): When proposing slots, state 2-3 concrete times immediately from the calendar JSON above.
4. EMAIL CAPTURE: Understand spoken phrases ('at the rate', 'at direct' mean '@'; 'dot com' means '.com'). Capture whole address. NEVER spell words letter-by-letter with hyphens (e.g. NEVER output 'P-A-R-T-S').
5. BARGE-IN & INTERRUPTIONS: If interrupted, immediately address what the caller said. If they say "Hello?" or "Are you there?", acknowledge warmly ("Yes, I'm right here!") and continue.
6. AUTOMATIC HANGUP: When meeting details are finalized and you say goodbye, or when the caller says goodbye, the call gracefully ends.
"""
    return instructions.strip()


def get_xai_tool_definitions() -> List[Dict[str, Any]]:
    """
    Returns OpenAI/xAI Realtime API function tool definitions.
    """
    return [
        {
            "type": "function",
            "name": "query_knowledge_base",
            "description": "Required before answering pricing, plans, features, integrations, or anything that should come from the company website, FAQs, or uploaded docs. Returns only crawled/verified text. Do not answer those topics from memory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The concise search query or question to retrieve verified context for."
                    }
                },
                "required": ["query"]
            }
        },
        {
            "type": "function",
            "name": "book_calendar_meeting",
            "description": (
                "Books a 15-minute discovery on the REAL company calendar. "
                "STRICT prerequisites — call only at full finalize: (1) meeting format agreed, "
                "(2) day/time agreed from check_calendar_availability (do not book mid-call before they are ready), "
                "(3) prospect gave email (email_confirmed=true once they provided it), "
                "(4) if needs=confirm_existing was returned earlier, prospect chose replace_existing or keep_both. "
                "WhatsApp is NOT a valid format."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "Date of meeting in YYYY-MM-DD format or descriptive day (e.g. tomorrow, Friday, or 2026-09-11)."
                    },
                    "time": {
                        "type": "string",
                        "description": "Time of meeting in 24-hour HH:MM format (e.g. 14:00 or 10:30)."
                    },
                    "email": {
                        "type": "string",
                        "description": "Prospect email they gave for the invite."
                    },
                    "email_confirmed": {
                        "type": "boolean",
                        "description": "True once they have given an email address and you are ready to finalize the booking."
                    },
                    "format": {
                        "type": "string",
                        "description": "Meeting type id from THIS business's enabled booking_policy (never a notify channel like whatsapp).",
                    },
                    "phone": {
                        "type": "string",
                        "description": "Prospect phone (required for format=phone)."
                    },
                    "notes": {
                        "type": "string",
                        "description": "Short topic or meeting note."
                    },
                    "replace_existing": {
                        "type": "boolean",
                        "description": "True if they want to cancel/replace their existing upcoming booking with this new one."
                    },
                    "keep_both": {
                        "type": "boolean",
                        "description": "True if they want to keep the old booking AND add this new one."
                    }
                },
                "required": ["date", "time", "email", "format", "email_confirmed"]
            }
        },
        {
            "type": "function",
            "name": "check_calendar_availability",
            "description": "Looks up REAL open slots on our calendar (host working hours + existing bookings; Cal.com if connected). Host invite mailbox is configured in Schedule settings — not the prospect email. Use for any date the caller mentions. Pass preference=afternoon when they ask for afternoon/PM. Never invent times.",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "Day the caller wants: today, tomorrow, Friday, next Tuesday, next week, or YYYY-MM-DD."
                    },
                    "range": {
                        "type": "string",
                        "description": "day (default) or week if they are flexible / said next week / this week."
                    },
                    "preference": {
                        "type": "string",
                        "description": "afternoon | morning | any. Use afternoon when they said afternoon, after lunch, PM, or a time after 12."
                    }
                },
                "required": ["date"]
            }
        },
        {
            "type": "function",
            "name": "end_call",
            "description": (
                "Ends the phone call after wrap-up. ONLY call this AFTER you followed "
                "this business's WRAP-UP rules (ask-before-hangup + goodbye if required). "
                "If they still have a question, do NOT call this — keep talking. "
                "Schedules hangup after a short delay so the goodbye can finish speaking."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "delay_seconds": {
                        "type": "number",
                        "description": "Seconds to wait before disconnect (uses business Call Rules default if omitted)."
                    },
                    "reason": {
                        "type": "string",
                        "description": "Short reason e.g. conversation_complete, prospect_said_goodbye."
                    }
                },
                "required": []
            }
        }
    ]


# ----------------------------------------------------------------------
# 3. TOOL EXECUTION ENGINE
# ----------------------------------------------------------------------
async def execute_xai_tool(
    name: str,
    args: Dict[str, Any],
    call_id: str,
    prospect_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Executes tool calls invoked by the xAI model mid-call and returns JSON payload.
    """
    start_time = time.time()
    logger.info(f"Executing tool {name} with args {args} for call {call_id}")

    try:
        if name == "query_knowledge_base":
            query = args.get("query", "")
            q_low = query.lower()
            want_price = any(w in q_low for w in ("price", "pricing", "cost", "plan", "fee", "quote", "how much"))
            top_k = 5 if want_price else 3
            min_score = 0.28 if want_price else 0.40
            async with AsyncSessionLocal() as db:
                results = await search_knowledge(db, query=query, top_k=top_k, min_score=min_score)
                faqs_res = await db.execute(select(FAQ))
                all_faqs = faqs_res.scalars().all()
                matching_faqs = []
                q_words = [w.lower() for w in query.split() if len(w) > 2]
                for f in all_faqs:
                    if any(w in f.question.lower() or w in f.answer.lower() for w in q_words):
                        matching_faqs.append(f"FAQ: {f.question}\nAnswer: {f.answer}")
            
            elapsed = (time.time() - start_time) * 1000
            extracted_chunks = matching_faqs + [f"Title: {r.get('title', 'Doc')}\nContent: {r.get('content')}" for r in results]

            await log_process_event(
                subsystem="crawler_rag",
                process_name="xai_rag_tool_lookup",
                message=f"RAG Knowledge search for '{query}' returned {len(extracted_chunks)} items (FAQs + Chunks).",
                level="INFO",
                duration_ms=elapsed,
                details={"callId": call_id, "query": query, "chunkCount": len(extracted_chunks)}
            )

            if not extracted_chunks:
                return {
                    "found": False,
                    "summary": "Nothing in crawled website, FAQs, or docs matched. Do not invent an answer. Say we don't have a published figure on this call and offer the walkthrough or an email from the site."
                }

            return {
                "found": True,
                "context": "\n---\n".join(extracted_chunks)
            }

        elif name == "book_calendar_meeting":
            from app.services.calendar_service import calendar_service, parse_spoken_date, _norm_time
            from app.services.timezone_service import display_hhmm
            from app.services.booking_policy import (
                normalize_booking_policy,
                resolve_meeting_type,
                enabled_meeting_types,
                enabled_notify_channels,
            )

            raw_date = args.get("date", "Tomorrow")
            time_val = _norm_time(args.get("time", "14:00"))
            email_val = (args.get("email") or "").strip()
            phone_val = (args.get("phone") or "").strip()
            notes_val = args.get("notes", "Discovery call booked via voice agent")
            email_confirmed = bool(args.get("email_confirmed"))
            replace_existing = bool(args.get("replace_existing"))
            keep_both = bool(args.get("keep_both"))
            fmt_raw = str(args.get("format") or args.get("format_type") or "").strip()

            async with AsyncSessionLocal() as db:
                setting = await calendar_service.get_or_create_settings(db)
                policy = normalize_booking_policy(getattr(setting, "booking_policy", None))
                enabled = enabled_meeting_types(policy)
                notify = enabled_notify_channels(policy)
                if not enabled:
                    return {
                        "success": False,
                        "needs": "format",
                        "message": "This business has no meeting types enabled. Do not book — offer email follow-up.",
                    }

                resolved = resolve_meeting_type(policy, fmt_raw or policy.get("default_meeting_type"))
                if not resolved:
                    labels = ", ".join(f"{t['label']} ({t['id']})" for t in enabled)
                    notify_names = ", ".join(n["label"] for n in notify) if notify else "none"
                    return {
                        "success": False,
                        "needs": "format",
                        "allowed_formats": [t["id"] for t in enabled],
                        "message": (
                            f"Ask which meeting type they want from: {labels}. "
                            f"Notify channels ({notify_names}) are not meeting types."
                        ),
                    }
                format_type = resolved["id"]
                platform = resolved.get("default_platform") or (
                    "Phone" if format_type == "phone" else "In person" if format_type == "in_person" else "Google Meet"
                )

                if not email_val or "@" not in email_val:
                    return {
                        "success": False,
                        "needs": "email",
                        "message": "Need a real email before booking. Ask for it, then call again with email_confirmed=true.",
                    }
                if policy.get("require_email_confirm", False) and not email_confirmed:
                    return {
                        "success": False,
                        "needs": "email_confirm",
                        "email": email_val,
                        "message": (
                            f"Read back this email once and wait for yes: {email_val}. "
                            "Then call book_calendar_meeting again with the same email and email_confirmed=true."
                        ),
                    }

                host_tz, p_tz, phone, setting = await _resolve_call_clocks(
                    db, call_id=call_id, prospect_id=prospect_id
                )
                phone = phone_val or phone
                call_res = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
                call_record = call_res.scalars().first()
                prospect_name = clean_person_label(call_record.prospect) if call_record else ""
                if call_record and call_record.prospect_id:
                    prow = (await db.execute(select(Prospect).where(Prospect.id == call_record.prospect_id))).scalars().first()
                    if prow:
                        prospect_name = clean_person_label(prow.contact_person) or clean_person_label(prow.name) or prospect_name
                if not prospect_name:
                    prospect_name = "there"
                mission_name = call_record.mission if call_record else "Inbound Voice"
                p_now = now_in(p_tz)
                target = parse_spoken_date(raw_date, p_now)
                date_iso = target.strftime("%Y-%m-%d")
                spoken_label = target.strftime("%A, %d %B %Y")
                hours_label = f"{setting.working_hours_start or '09:00'}–{setting.working_hours_end or '17:30'}"

                # Existing upcoming bookings for same person/email — confirm before overwrite
                existing_hits = []
                if policy.get("confirm_existing_bookings", True):
                    m_res = await db.execute(select(Meeting).where(Meeting.status == "upcoming"))
                    email_l = email_val.lower()
                    name_l = (prospect_name or "").lower()
                    for m in m_res.scalars().all():
                        att = (m.attendee_email or "").strip().lower()
                        pname = (m.prospect or m.attendee or "").strip().lower()
                        match = False
                        if att and att == email_l:
                            match = True
                        elif name_l and name_l not in ("there", "prospect", "caller") and (
                            name_l == pname or name_l in pname or pname in name_l
                        ):
                            match = True
                        if match:
                            existing_hits.append({
                                "id": m.id,
                                "date": m.date,
                                "time": display_hhmm(m.time) if m.time else m.time,
                                "format": m.format or "video",
                                "email": m.attendee_email,
                            })

                if existing_hits and not replace_existing and not keep_both:
                    old = existing_hits[0]
                    return {
                        "success": False,
                        "needs": "confirm_existing",
                        "existing": existing_hits,
                        "message": (
                            f"They already have an upcoming {old.get('format') or 'meeting'} on {old.get('date')} at {old.get('time')}. "
                            "Ask: keep that one, replace it with this new time, or keep both? "
                            "Then call again with replace_existing=true or keep_both=true."
                        ),
                    }

                if replace_existing and existing_hits:
                    for hit in existing_hits:
                        old = (await db.execute(select(Meeting).where(Meeting.id == hit["id"]))).scalars().first()
                        if old:
                            old.status = "cancelled"
                            old.cancellation_reason = "Replaced with new slot on voice call"
                            old.prep = (old.prep or "") + " | Replaced on voice call"

                booked = await calendar_service.create_booking(
                    db,
                    prospect_name=prospect_name,
                    attendee_email=email_val,
                    date_str=date_iso,
                    time_str=time_val,
                    notes=notes_val,
                    mission_name=mission_name,
                    format_type=format_type,
                    platform=platform,
                    prospect_timezone=p_tz,
                    prospect_phone=phone,
                    time_is_prospect_local=True,
                    enforce_hours=True,
                    duration_minutes=int(policy.get("duration_minutes") or setting.default_duration or 15),
                )

                if not booked.get("success"):
                    alts = booked.get("availableSlots") or []
                    alt_spoken = ", ".join(display_hhmm(t) for t in alts) if alts else "nearby weekday windows"
                    return {
                        "success": False,
                        "conflict": True,
                        "date": spoken_label,
                        "requested_time": time_val,
                        "available_slots": [display_hhmm(t) for t in alts],
                        "message": (
                            f"That window just filled or is packed. Offer these instead: {alt_spoken}. "
                            "Call check_calendar_availability again if needed. Do not book the requested time."
                        ),
                    }

                spoken_time = display_hhmm(booked.get("prospectTime") or time_val)
                spoken_date = booked.get("prospectDate") or date_iso

                if call_record:
                    call_record.booked = True
                    log_notes = (
                        f"System: Meeting booked ({format_type}) for {spoken_date} at {spoken_time} "
                        f"(diary {booked.get('date')} {booked.get('time')} {host_tz}) | Email: {email_val}"
                    )
                    call_record.transcript = (call_record.transcript or []) + [log_notes]

                if prospect_id:
                    p_res = await db.execute(select(Prospect).where(Prospect.id == prospect_id))
                    p = p_res.scalars().first()
                    if p:
                        p.status = "meeting_booked"
                        p.note = f"Booked ({format_type}): {spoken_date} at {spoken_time} ({notes_val})"
                        p.email = email_val
                        if phone_val:
                            p.phone = phone_val
                db.add(ScheduleItem(
                    id=f"s_{uuid.uuid4().hex[:6]}",
                    day=spoken_label,
                    time=booked.get("time") or time_val,
                    prospect=prospect_name,
                    mission=mission_name,
                    window=hours_label,
                    status="scheduled",
                    kind=format_type,
                    email=email_val,
                    phone=phone or None,
                    video_link=booked.get("videoLink") if format_type == "video" else None,
                ))
                await db.commit()

            meeting_id = booked.get("bookingId")
            mail = booked.get("emailConfirmationSent") or {}
            await call_hub.broadcast("call_updated", {
                "callId": call_id,
                "booked": True,
                "meetingId": meeting_id,
                "date": booked.get("date"),
                "time": booked.get("time"),
                "format": format_type,
                "hostTimezone": booked.get("hostTimezone"),
                "prospectTime": booked.get("prospectTime"),
                "email": email_val,
            })

            elapsed = (time.time() - start_time) * 1000
            await log_process_event(
                subsystem="calendar",
                process_name="xai_tool_meeting_booked",
                message=f"Meeting booked ({format_type}) for {prospect_name} on {spoken_date} at {spoken_time}. Email sent={mail.get('attendee')}.",
                level="SUCCESS",
                duration_ms=elapsed,
                details={"callId": call_id, "meetingId": meeting_id, "date": booked.get("date"), "time": booked.get("time"), "email": email_val, "format": format_type, "mail": mail},
            )

            fmt_speak = resolved.get("speak_as") or resolved.get("label") or format_type
            notify_hint = ""
            if policy.get("offer_notify_after_book") and notify:
                notify_hint = (
                    " Optionally ask if they also want a confirmation via: "
                    + ", ".join(n["label"] for n in notify)
                    + " — notify-only."
                )
            mail_ok = bool(mail.get("attendee"))
            join = booked.get("videoLink") if format_type == "video" else None
            if mail_ok:
                mail_line = " and they will get the join link / invite by email."
            elif join:
                mail_line = (
                    f". Speak the join link clearly once ({join}) — email invite may not have sent from this environment."
                )
            else:
                mail_line = ". Confirm verbally; email invite may not have sent from this environment."
            return {
                "success": True,
                "meeting_id": meeting_id,
                "date": spoken_label,
                "time": spoken_time,
                "format": format_type,
                "video_link": join,
                "email_sent": mail_ok,
                "message": (
                    f"Confirmed {fmt_speak} on {spoken_label} at {spoken_time}. "
                    "Tell them it is locked"
                    + mail_line
                    + " Do NOT mention email delivery tech. Never mention timezones."
                    + notify_hint
                ),
            }

        elif name == "check_calendar_availability":
            from app.services.calendar_service import calendar_service, parse_spoken_date

            raw_date = args.get("date", "tomorrow")
            pref = str(args.get("preference") or "").lower().strip()
            blob = f"{raw_date} {pref}".lower()
            want_afternoon = pref in ("afternoon", "pm", "after lunch") or any(
                x in blob for x in ("afternoon", "after lunch", "pm", "after 12", "after noon")
            )
            want_morning = pref in ("morning", "am") or ("morning" in blob and not want_afternoon)
            want_week = str(args.get("range") or "").lower() in ("week", "this week", "next week") or "week" in str(raw_date).lower()

            def _slot_hour(s: Dict[str, Any]) -> int:
                raw_t = str(s.get("prospectTime") or s.get("time") or "0")
                try:
                    return int(raw_t.split(":")[0])
                except Exception:
                    return 0

            def _filter_part_of_day(open_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
                if want_afternoon:
                    aft = [s for s in open_list if _slot_hour(s) >= 12]
                    return aft or open_list
                if want_morning:
                    morn = [s for s in open_list if _slot_hour(s) < 12]
                    return morn or open_list
                return open_list

            async with AsyncSessionLocal() as db:
                host_tz, p_tz, _, _ = await _resolve_call_clocks(
                    db, call_id=call_id, prospect_id=prospect_id
                )
                setting = await calendar_service.get_or_create_settings(db)
                host_mail = setting.host_email or ""
                p_now = now_in(p_tz)
                if want_week:
                    start = parse_spoken_date(raw_date, p_now)
                    week = await calendar_service.get_week_availability(db, start, days=5, prospect_tz=p_tz)
                    days_out = []
                    for d in week:
                        opens = _filter_part_of_day(d["open"])
                        days_out.append({
                            "date": d["label"],
                            "iso": d["date"],
                            "slots": [s["display"] for s in opens[:6]],
                            "openCount": len(opens),
                        })
                    part = "afternoon " if want_afternoon else ("morning " if want_morning else "")
                    return {
                        "current_time": p_now.strftime("%I:%M %p").lstrip("0") + " on " + p_now.strftime("%A, %d %B %Y"),
                        "range": "week",
                        "preference": pref or ("afternoon" if want_afternoon else "any"),
                        "host_invite_mailbox": host_mail,
                        "days": days_out,
                        "message": (
                            f"Offer only these spoken {part}times from the real host diary. "
                            "Never mention timezones. If empty for a day, skip it."
                        ),
                    }

                target = parse_spoken_date(raw_date, p_now)
                date_iso = target.strftime("%Y-%m-%d")
                date_label = target.strftime("%A, %d %B %Y")
                slots = await calendar_service.get_available_slots(db, date_iso, prospect_tz=p_tz)
                open_raw = []
                for s in slots:
                    if not s.get("offerable", s.get("available")):
                        continue
                    label = s.get("spoken") or s.get("displayTime") or display_hhmm(s.get("time") or "")
                    raw_t = str(s.get("time") or "")
                    try:
                        hh, mm = map(int, raw_t.split(":")[:2])
                        if not (0 <= hh <= 23 and 0 <= mm <= 59):
                            continue
                    except Exception:
                        pass
                    if label:
                        open_raw.append({**s, "display": label})
                open_raw = _filter_part_of_day(open_raw)
                open_slots = [s["display"] for s in open_raw]
                if not slots:
                    nxt = await calendar_service.get_week_availability(db, target + timedelta(days=1), days=3, prospect_tz=p_tz)
                    nxt_line = "; ".join(
                        f"{d['label']}: {', '.join(s['display'] for s in _filter_part_of_day(d['open'])[:3]) or 'none'}"
                        for d in nxt
                    )
                    return {
                        "available_slots": [],
                        "date": date_label,
                        "host_invite_mailbox": host_mail,
                        "current_time": p_now.strftime("%I:%M %p").lstrip("0"),
                        "message": f"{date_label} is outside working days. Next openings: {nxt_line}. Do not mention timezones.",
                    }
                if not open_slots:
                    nxt = await calendar_service.get_week_availability(db, target + timedelta(days=1), days=3, prospect_tz=p_tz)
                    nxt_line = "; ".join(
                        f"{d['weekday']}: {', '.join(s['display'] for s in _filter_part_of_day(d['open'])[:3]) or 'none'}"
                        for d in nxt
                    )
                    return {
                        "available_slots": [],
                        "date": date_label,
                        "host_invite_mailbox": host_mail,
                        "current_time": p_now.strftime("%I:%M %p").lstrip("0"),
                        "message": (
                            f"No free slots on {date_label} "
                            f"(working hours + past times + lunch + bookings"
                            f"{', Cal.com' if setting.api_key else ''}). "
                            f"Offer nearby: {nxt_line}. Say the window is packed."
                        ),
                    }
                return {
                    "available_slots": open_slots[:8],
                    "date": date_label,
                    "iso": date_iso,
                    "preference": pref or ("afternoon" if want_afternoon else "any"),
                    "host_invite_mailbox": host_mail,
                    "current_time": p_now.strftime("%I:%M %p").lstrip("0"),
                    "message": f"For {date_label} we can do: {', '.join(open_slots[:6])}. Offer two of these. Speak only these times. Never mention timezones.",
                }

        elif name == "end_call":
            from app.services.booking_policy import hangup_delay_seconds, normalize_booking_policy
            policy_delay = 4.0
            try:
                from app.services.calendar_service import calendar_service
                async with AsyncSessionLocal() as pol_db:
                    setting = await calendar_service.get_or_create_settings(pol_db)
                    policy_delay = hangup_delay_seconds(
                        normalize_booking_policy(getattr(setting, "booking_policy", None))
                    )
            except Exception:
                policy_delay = 4.0

            delay = args.get("delay_seconds", policy_delay)
            try:
                delay = float(delay)
            except Exception:
                delay = policy_delay
            delay = max(2.0, min(delay, 15.0))
            reason = str(args.get("reason") or "conversation_complete").strip()[:120]

            async def _delayed_hangup(cid: str, wait: float, why: str):
                try:
                    from app.websockets.media_stream import media_stream_hub
                    # Brief wait for goodbye audio synthesis to begin streaming
                    await asyncio.sleep(1.0)
                    # Send Twilio mark so we know when audio has finished playing in caller's ear
                    await media_stream_hub.send_mark(cid, "goodbye_complete")
                    # Wait for Twilio mark confirmation with fallback timeout
                    mark_reached = await media_stream_hub.wait_for_mark(cid, "goodbye_complete", timeout=max(4.0, wait))
                    # Comfortable 0.8s pause so call doesn't drop abruptly
                    await asyncio.sleep(0.8)
                    async with AsyncSessionLocal() as db:
                        from app.api.calls import terminate_live_call
                        result = await terminate_live_call(cid, db, ended_by="agent")
                        await log_process_event(
                            subsystem="telephony",
                            process_name="agent_end_call",
                            message=f"Agent end_call for {cid} (mark_reached={mark_reached}, reason={why}) → ok={result.get('ok')}",
                            level="INFO",
                            details={"callId": cid, "markReached": mark_reached, "delay": wait, "reason": why, "result": result},
                        )
                except Exception as hang_err:
                    logger.warning(f"[end_call] delayed hangup failed for {cid}: {hang_err}")

            asyncio.create_task(_delayed_hangup(call_id, delay, reason))
            return {
                "ok": True,
                "status": "hangup_scheduled",
            }

        else:
            return {"error": f"Unknown tool: {name}"}

    except Exception as err:
        logger.error(f"Error executing tool {name}: {err}", exc_info=True)
        return {"error": str(err)}


# ----------------------------------------------------------------------
# 4. WEBSOCKET SESSION ORCHESTRATOR (join_call)
# ----------------------------------------------------------------------
async def join_xai_call_session(
    call_id: str,
    caller_number: str = "+12025550199",
    prospect_id: Optional[str] = None,
    prospect_name: Optional[str] = None,
    mission_name: Optional[str] = None,
    carrier_sid: Optional[str] = None,
    custom_call_id: Optional[str] = None,
    audio_bridge: Optional[BridgedVoiceSession] = None,
    voice_plan: Optional[Any] = None,
):
    """
    Connects an outbound WebSocket session to xAI Realtime Voice API.
    SIP mode: wss://...?call_id= (audio on SIP). Bridge mode: μ-law over WS, no SIP wait.
    When voice_plan.external_tts is set, xAI handles STT+Grok; Cartesia/ElevenLabs speaks.
    """
    start_ts = time.time()
    agent_id = getattr(settings, "XAI_AGENT_ID", None) or "agent_QDoRHfWcKMybf197"
    base_ws = (settings.XAI_REALTIME_WS_URL or "wss://api.x.ai/v1/realtime").split("?")[0]
    if audio_bridge:
        ws_url = f"{base_ws}?model=grok-voice-latest"
    else:
        ws_url = f"{base_ws}?call_id={call_id}"
    api_key = settings.XAI_API_KEY
    active_voice = settings.XAI_VOICE_NAME
    active_voice = _xai_voice_id(active_voice)
    silence_ms = getattr(settings, "XAI_VAD_SILENCE_MS", 2000)  # Reduced from 380ms to 2000ms (2 seconds) - interrupts after 2 sec silence
    prefix_ms = getattr(settings, "XAI_VAD_PREFIX_PADDING_MS", 100)  # Reduced from 180ms to 100ms for faster response
    temp_val = getattr(settings, "XAI_TEMPERATURE", 0.80)

    if voice_plan is None and audio_bridge is not None:
        try:
            from app.services.voice_plugin_plan import resolve_voice_plan
            voice_plan = await resolve_voice_plan()
        except Exception as plan_err:
            logger.debug(f"Could not resolve voice plan for hybrid TTS: {plan_err}")

    use_external_tts = bool(
        audio_bridge
        and voice_plan
        and getattr(voice_plan, "external_tts", False)
        and getattr(voice_plan, "tts", None)
        and voice_plan.tts.api_key
        and voice_plan.tts.voice_id
    )
    _ext_tts_cleanup: Dict[str, Any] = {"worker": None, "queue": None}

    try:
        from app.models.models import Connection
        from app.services.secret_box import config_get_secret, open_config
        async with AsyncSessionLocal() as db:
            c_res = await db.execute(select(Connection).where(Connection.group_name == "Voice Orchestration"))
            c = c_res.scalars().first()
            if c and c.config and isinstance(c.config, dict):
                # Decrypt the config to access all fields
                dec_config = open_config(c.config)
                
                stored_key = config_get_secret(c.config, "api_key", "auth_token")
                if stored_key:
                    api_key = stored_key
                    settings.XAI_API_KEY = stored_key
                    settings.VOICE_ENGINE_MODE = "live"
                
                # Use decrypted config to get voice settings
                if dec_config.get("voice_name"):
                    active_voice = _xai_voice_id(dec_config.get("voice_name"), dec_config.get("accent"))
                elif dec_config.get("voice"):
                    active_voice = _xai_voice_id(dec_config.get("voice"), dec_config.get("accent"))
                
                if dec_config.get("silence_duration_ms"):
                    silence_ms = int(dec_config.get("silence_duration_ms"))
                if dec_config.get("prefix_padding_ms"):
                    prefix_ms = int(dec_config.get("prefix_padding_ms"))
                if dec_config.get("temperature"):
                    temp_val = float(dec_config.get("temperature"))
            # Fallback: LLM · xAI key when Voice Orchestration has none
            if not api_key or str(api_key).startswith("mock"):
                llm_res = await db.execute(select(Connection).where(Connection.group_name == "LLM"))
                for lc in llm_res.scalars().all():
                    if "xai" not in (lc.name or "").lower() and "grok" not in (lc.name or "").lower():
                        continue
                    llm_key = config_get_secret(lc.config if isinstance(lc.config, dict) else {}, "api_key", "auth_token")
                    if llm_key and str(llm_key).startswith("xai-"):
                        api_key = llm_key
                        settings.XAI_API_KEY = llm_key
                        settings.VOICE_ENGINE_MODE = "live"
                        break
    except Exception as k_err:
        logger.warning(f"Could not load xAI config from DB: {k_err}")

    # External clone IDs must not be sent to xAI as session.voice
    if use_external_tts:
        active_voice = _xai_voice_id(active_voice) if active_voice in ("ara", "eve", "rex", "leo") else "rex"
        logger.info(
            f"[XAI-WS] External TTS ON for {call_id}: provider={voice_plan.tts.provider} "
            f"voice_id={voice_plan.tts.voice_id[:12]}… (xAI session voice={active_voice})"
        )

    await log_process_event(
        subsystem="telephony",
        process_name="xai_ws_connecting",
        message=f"Connecting WebSocket to xAI Realtime API for sip_call_id={call_id} (Voice: {active_voice}, VAD silence: {silence_ms}ms, Temp: {temp_val})",
        level="INFO",
        details={
            "callId": call_id,
            "carrierSid": carrier_sid,
            "caller": caller_number,
            "customCallId": custom_call_id,
            "isLiveKey": bool(api_key and api_key.startswith("xai-")),
            "wsUrl": ws_url,
            "agentId": agent_id,
            "externalTts": use_external_tts,
            "ttsProvider": (voice_plan.tts.provider if use_external_tts and voice_plan and voice_plan.tts else None),
        }
    )
    logger.info(
        f"[XAI-WS] Attempting WebSocket connection: "
        f"sip_call_id={call_id}, carrier_sid={carrier_sid}, custom_call_id={custom_call_id}, "
        f"key_prefix={api_key[:12] + '...' if api_key else 'NONE'}"
    )

    # 1. Link to existing LiveCall record (outbound) or create new (inbound)
    local_call_id = custom_call_id or call_id
    async with AsyncSessionLocal() as db:
        call_obj = None
        # 1. By custom_call_id
        if custom_call_id:
            c_res = await db.execute(select(LiveCall).where(LiveCall.id == custom_call_id))
            call_obj = c_res.scalars().first()
        # 2. By carrier_sid
        if not call_obj and carrier_sid:
            c_res = await db.execute(select(LiveCall).where(LiveCall.carrier_sid == carrier_sid))
            call_obj = c_res.scalars().first()
        # 3. By call_id
        if not call_obj:
            call_res = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
            call_obj = call_res.scalars().first()
        # 4. By recent pending outbound call (created in last 120s)
        if not call_obj:
            pending_res = await db.execute(
                select(LiveCall)
                .where(LiveCall.ended == False)
                .where(LiveCall.state.in_(["calling", "ringing", "queued"]))
                .order_by(LiveCall.created_at.desc())
            )
            call_obj = pending_res.scalars().first()

        if call_obj:
            local_call_id = call_obj.id
            call_obj.state = "pitching"
            if call_obj.prospect_id:
                prow = (await db.execute(select(Prospect).where(Prospect.id == call_obj.prospect_id))).scalars().first()
                if prow:
                    file_name = clean_person_label(prow.contact_person) or clean_person_label(prow.name)
                    if file_name:
                        prospect_name = file_name
                        if is_generic_label(call_obj.prospect):
                            call_obj.prospect = file_name
            if call_obj.prospect and is_generic_label(prospect_name):
                prospect_name = call_obj.prospect
            if call_obj.mission:
                mission_name = call_obj.mission
            call_obj.transcript = (call_obj.transcript or []) + [
                f"System: xAI Realtime Voice Agent connected (SIP Call: {call_id[:8]}...)"
            ]
            await db.commit()
            logger.info(f"[XAI-WS] Successfully linked xAI session {call_id} to existing LiveCall {local_call_id} (carrier: {carrier_sid}, prospect: {prospect_name})")
        else:
            call_obj = LiveCall(
                id=call_id,
                carrier_sid=carrier_sid,
                mission_id=mission_name or "Inbound Mission",
                prospect_id=prospect_id,
                prospect=prospect_name or f"Caller ({caller_number[-4:] if len(caller_number) >= 4 else caller_number})",
                mission=mission_name or "Direct Inbound",
                state="pitching",
                channel="voice",
                duration="00:01",
                transcript=[f"System: Inbound xAI call connected ({call_id[:8]}...)"]
            )
            db.add(call_obj)
            await db.commit()
        try:
            _, p_tz_join, _, _ = await _resolve_call_clocks(
                db, call_id=local_call_id, prospect_id=prospect_id, caller_number=caller_number
            )
            if call_obj:
                call_obj.prospect_timezone = p_tz_join
                await db.commit()
        except Exception as tz_err:
            logger.debug(f"Could not stamp call timezone: {tz_err}")

    # Link aliases in media_stream_hub so audio stream & takeover always route to this call
    try:
        from app.websockets.media_stream import media_stream_hub
        media_stream_hub.register_alias(call_id, local_call_id)
        if carrier_sid:
            media_stream_hub.register_alias(carrier_sid, local_call_id)
        if custom_call_id:
            media_stream_hub.register_alias(custom_call_id, local_call_id)
    except Exception as alias_err:
        logger.warning(f"Could not register media_stream_hub alias: {alias_err}")

    await call_hub.broadcast("call_started", {
        "callId": local_call_id,
        "caller": caller_number,
        "prospect": prospect_name or caller_number,
        "state": "pitching"
    })

    # Require valid xAI API key for live calls
    if not api_key or api_key.startswith("mock"):
        raise ValueError(
            "xAI API key is required for live calls. "
            "Configure XAI_API_KEY in environment or add xAI connection in Connections panel."
        )

    sip_first_rec = _sip_first_record(custom_call_id, local_call_id, call_id, carrier_sid)
    if not sip_first_rec and audio_bridge and not audio_bridge.is_inbound:
        mark_sip_first_call(custom_call_id or local_call_id or call_id)
        sip_first_rec = _sip_first_record(custom_call_id, local_call_id, call_id)
    sip_first = bool(sip_first_rec)
    if sip_first_rec:
        alias_sip_first_call(custom_call_id or local_call_id, local_call_id, call_id, carrier_sid)

    if audio_bridge:
        is_inbound_call = bool(audio_bridge.is_inbound)
    elif sip_first or custom_call_id:
        is_inbound_call = False
    elif call_obj and call_obj.mission and not ("inbound" in call_obj.mission.lower() or "inbound" in (call_obj.mission_id or "").lower()):
        is_inbound_call = False
    elif mission_name and "inbound" in str(mission_name).lower():
        is_inbound_call = True
    elif not call_obj:
        is_inbound_call = True
    else:
        is_inbound_call = False

    # Real WebSocket Connection to xAI
    headers = {"Authorization": f"Bearer {api_key}"}
    system_instructions = await build_xai_system_instructions(
        caller_number,
        prospect_name,
        hold_opening=not is_inbound_call,
        prospect_id=prospect_id,
        call_id=local_call_id,
    )
    tools_list = get_xai_tool_definitions()

    transcript_history = []
    current_ai_text = ""
    call_active = True

    async def commit_ai_turn():
        nonlocal current_ai_text
        text = current_ai_text.strip()
        if text:
            line = f"AI: {text}"
            if line not in transcript_history:
                transcript_history.append(line)
                await _update_call_transcript(local_call_id, line)
                logger.info(f"[XAI-WS] Saved AI Turn for {local_call_id}: {text[:70]}...")
            current_ai_text = ""

    try:
        async with websockets.connect(
            ws_url,
            additional_headers=headers,
            ping_interval=20,
            ping_timeout=15,
            close_timeout=10
        ) as ws:
            active_xai_sessions[local_call_id] = ws
            active_xai_sessions[call_id] = ws
            if audio_bridge:
                audio_bridge.ws = ws
            logger.info(f"[XAI-WS] ✓ WebSocket CONNECTED for call_id={call_id}")
            await log_process_event(
                subsystem="voice",
                process_name="xai_ws_session_connected",
                message=f"xAI Realtime WebSocket connected successfully for call {call_id}.",
                level="SUCCESS",
                details={"callId": call_id, "voice": active_voice, "silenceMs": silence_ms, "temperature": temp_val}
            )

            # 2. Send session.update to configure voice, VAD, prompt & tools
            # Hybrid: keep audio modality so xAI STT/VAD works; we drop its speaker audio and
            # synthesize via Cartesia/ElevenLabs from transcript/text deltas.
            session_modalities = ["audio", "text"]
            session_body = {
                    "modalities": session_modalities,
                    "voice": active_voice,
                    "instructions": system_instructions,
                    "temperature": temp_val,
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.48,
                        "prefix_padding_ms": prefix_ms,
                        "silence_duration_ms": silence_ms
                    },
                    "tools": tools_list,
                    "tool_choice": "auto",
                    "input_audio_transcription": {}
            }
            if audio_bridge:
                session_body["audio"] = {
                    "input": {"format": {"type": "audio/pcmu"}},
                    "output": {"format": {"type": "audio/pcmu"}},
                }
            session_config = {
                "type": "session.update",
                "session": session_body,
            }
            # 1. Update session with complete AIVHub configuration
            await ws.send(json.dumps(session_config))

            # External cloned-voice TTS: sentence buffer over xAI text/transcript deltas
            ext_tts_buf = ""
            ext_tts_queue: asyncio.Queue = asyncio.Queue()
            ext_tts_worker: Optional[asyncio.Task] = None
            ext_tts_failed = False
            ext_tts_chars_fed = 0  # deltas queued this assistant turn (0 → speak full final text)
            ext_tts_turn_spoken = False
            if use_external_tts and audio_bridge:
                audio_bridge._barge = asyncio.Event()

                async def _ext_tts_worker_loop():
                    nonlocal ext_tts_failed
                    from app.services.voice_modular import _speak
                    while True:
                        phrase = await ext_tts_queue.get()
                        if phrase is None:
                            break
                        phrase = (phrase or "").strip()
                        if not phrase or not voice_plan:
                            continue
                        if getattr(audio_bridge, "_barge", None) and audio_bridge._barge.is_set():
                            audio_bridge._barge = asyncio.Event()
                        try:
                            logger.info(f"[XAI-WS] External TTS speak ({len(phrase)} chars): {phrase[:80]}…")
                            await _speak(audio_bridge, voice_plan, phrase, pace=True)
                        except asyncio.CancelledError:
                            raise
                        except Exception as speak_err:
                            ext_tts_failed = True
                            logger.warning(
                                f"[XAI-WS] External TTS speak failed — falling back to xAI audio: {speak_err}"
                            )

                ext_tts_worker = asyncio.create_task(_ext_tts_worker_loop())
                _ext_tts_cleanup["worker"] = ext_tts_worker
                _ext_tts_cleanup["queue"] = ext_tts_queue

            async def _cancel_ext_tts():
                nonlocal ext_tts_buf, ext_tts_chars_fed, ext_tts_turn_spoken
                ext_tts_buf = ""
                ext_tts_chars_fed = 0
                ext_tts_turn_spoken = False
                if audio_bridge is not None:
                    if getattr(audio_bridge, "_barge", None) is None:
                        audio_bridge._barge = asyncio.Event()
                    audio_bridge._barge.set()
                # Drain pending phrases so barge-in stays quiet
                while not ext_tts_queue.empty():
                    try:
                        ext_tts_queue.get_nowait()
                    except Exception:
                        break
                try:
                    from app.websockets.media_stream import media_stream_hub
                    await media_stream_hub.clear_twilio_audio(local_call_id)
                except Exception:
                    pass

            async def _feed_ext_tts(delta: str, force_flush: bool = False):
                nonlocal ext_tts_buf, ext_tts_chars_fed
                if not use_external_tts:
                    return
                if delta:
                    ext_tts_buf += delta
                    ext_tts_chars_fed += len(delta)
                while True:
                    m = re.search(r"([.!?])(\s+|$)", ext_tts_buf)
                    if not m:
                        break
                    end = m.end()
                    phrase = ext_tts_buf[:end].strip()
                    ext_tts_buf = ext_tts_buf[end:]
                    if phrase:
                        await ext_tts_queue.put(phrase)
                if force_flush and ext_tts_buf.strip():
                    phrase = ext_tts_buf.strip()
                    ext_tts_buf = ""
                    await ext_tts_queue.put(phrase)

            async def _ensure_ext_tts_for_turn(final_text: str):
                """xAI often delivers transcript only on response.done — no deltas. Speak that once."""
                nonlocal ext_tts_chars_fed, ext_tts_buf, ext_tts_turn_spoken
                if not use_external_tts or ext_tts_turn_spoken:
                    return
                await _feed_ext_tts("", force_flush=True)
                text = (final_text or "").strip()
                if text and ext_tts_chars_fed == 0:
                    logger.info(f"[XAI-WS] External TTS from final transcript ({len(text)} chars)")
                    await ext_tts_queue.put(text)
                    ext_tts_chars_fed = len(text)
                if ext_tts_chars_fed > 0 or text:
                    ext_tts_turn_spoken = True
                ext_tts_buf = ""

            # 2. Set up instant first-turn greeting trigger
            target_raw = prospect_name or (call_obj.prospect if call_obj else None) or "there"
            target_first_name = greeting_first_name(target_raw)

            greeting_dispatched = False
            greeting_audio_started = False
            session_ready = False
            last_greeting_at = 0.0
            user_spoke = False
            voicemail_dispatched = False
            human_live = False
            awaiting_human = False

            profile_rep = _knowledge_cache.get("profile") if "_knowledge_cache" in globals() else None
            rep_name = (profile_rep.caller_name or "").strip() if profile_rep and profile_rep.caller_name else "the caller"
            comp_name = (profile_rep.name or "").strip() if profile_rep and profile_rep.name else ""
            spoken_comp = _spoken_brand(comp_name, getattr(profile_rep, "spoken_name", None))
            brand_hint = _brand_speech_hint(spoken_comp, comp_name)
            greeting_line = f"Hi {target_first_name}" if target_first_name != "there" else "Hi there"
            custom_opener = (getattr(profile_rep, "call_opener", None) or "").strip() if profile_rep else ""
            first_for_template = target_first_name if target_first_name != "there" else "there"
            if custom_opener:
                call_opener_txt = (
                    custom_opener.replace("{name}", first_for_template)
                    .replace("{caller_name}", rep_name)
                    .replace("{company}", spoken_comp)
                )
            else:
                call_opener_txt = f"{greeting_line}, this is {rep_name} calling from {spoken_comp} — did I catch you in the middle of something?"

            inbound_greeting_instruction = (
                f"You are {rep_name} at {spoken_comp}, answering an incoming phone call. "
                f"Speak FIRST immediately, warm and human: "
                f"'Hello, thanks for calling {spoken_comp}! This is {rep_name}. How can I help you today?' "
                f"{brand_hint}"
            )
            outbound_greeting_instruction = (
                f"You are calling {target_raw} as {rep_name} from {spoken_comp}. "
                f"Their name is locked as {target_first_name if target_first_name != 'there' else 'unknown'}. "
                f"The person just picked up. Speak FIRST immediately, like a real person already on the line. "
                f"Say this ONCE only, natural and unhurried: "
                f"'{call_opener_txt}' "
                f"{brand_hint} "
                f"If you hear hold/'please wait': stay silent. "
                f"If you hear leave-a-message/voicemail beep: leave a short voicemail with who you are, company, and why you called — then stop. "
                f"If a human barges in mid-message: cut off, greet them live once. "
                f"Never address them as Hi There. Never invent their name from 'hi'/'hello'. "
                f"Do not wait. Do not restart or repeat this greeting. Use only the saved company name and pitch."
            )

            voicemail_instruction = (
                f"You reached {target_raw}'s VOICEMAIL. Leave ONE short message now, then stop speaking. "
                f"Say: 'Hi {target_first_name if target_first_name != 'there' else 'there'}, this is {rep_name} from {spoken_comp}. "
                f"Calling about a quick 15-minute walkthrough of how we can help. I'll try you again shortly — "
                f"or you can ring this number back. Thanks.' "
                f"Do not ask questions. Do not keep talking after that. "
                f"If a human suddenly answers mid-message, stop the voicemail and greet them live instead."
            )

            async def dispatch_opening_greeting(trigger_source: str, force: bool = False):
                nonlocal greeting_dispatched, greeting_audio_started, last_greeting_at
                rec = _sip_first_record(custom_call_id, local_call_id, call_id)
                still_ringing = (
                    sip_first and not is_inbound_call and rec and not rec["answered"].is_set()
                    and trigger_source != "prospect_answered"
                )
                if still_ringing and not audio_bridge:
                    logger.info(f"[XAI-WS] Defer greeting ({trigger_source}) — prospect still ringing")
                    return
                if greeting_dispatched and not force:
                    return
                if force and greeting_audio_started and trigger_source == "audio_watchdog":
                    return
                if force:
                    try:
                        await ws.send(json.dumps({"type": "response.cancel"}))
                    except Exception:
                        pass
                greeting_dispatched = True
                greeting_audio_started = False
                last_greeting_at = time.time()
                warm = bool(still_ringing and audio_bridge)
                logger.info(
                    f"[XAI-WS] Triggering opening greeting for {target_first_name} via {trigger_source} "
                    f"(voice={active_voice}, warm_buffer={warm})..."
                )
                greeting_instruction = inbound_greeting_instruction if is_inbound_call else outbound_greeting_instruction
                greeting_cmd = {
                    "type": "response.create",
                    "response": {
                        "modalities": ["audio", "text"],
                        "instructions": greeting_instruction
                    }
                }
                try:
                    await ws.send(json.dumps(greeting_cmd))
                    logger.info(f"[XAI-WS] Opening greeting dispatched successfully to xAI ({trigger_source}) for {target_first_name} (is_inbound={is_inbound_call})")
                    asyncio.create_task(log_process_event(
                        subsystem="voice",
                        process_name="xai_greeting_dispatched",
                        message=f"Opening greeting response.create sent to xAI for call {call_id} via {trigger_source}",
                        level="INFO",
                        details={"callId": call_id, "triggerSource": trigger_source, "prospect": target_first_name, "warmBuffer": warm}
                    ))
                except Exception as g_err:
                    greeting_dispatched = False
                    logger.warning(f"[XAI-WS] Failed to dispatch opening greeting: {g_err}")

            async def dispatch_voicemail(trigger_source: str = "voicemail_prompt"):
                nonlocal voicemail_dispatched, greeting_dispatched, greeting_audio_started, awaiting_human
                if is_inbound_call or human_live:
                    return
                if voicemail_dispatched:
                    return
                voicemail_dispatched = True
                awaiting_human = False
                greeting_dispatched = True
                greeting_audio_started = False
                try:
                    await ws.send(json.dumps({"type": "response.cancel"}))
                except Exception:
                    pass
                logger.info(f"[XAI-WS] Leaving voicemail for {target_first_name} via {trigger_source}")
                try:
                    await ws.send(json.dumps({
                        "type": "response.create",
                        "response": {
                            "modalities": ["audio", "text"],
                            "instructions": voicemail_instruction,
                        },
                    }))
                    asyncio.create_task(log_process_event(
                        subsystem="voice",
                        process_name="xai_voicemail_dispatched",
                        message=f"Voicemail drop sent for call {call_id}",
                        level="INFO",
                        details={"callId": call_id, "prospect": target_first_name, "triggerSource": trigger_source},
                    ))
                except Exception as vm_err:
                    voicemail_dispatched = False
                    logger.warning(f"[XAI-WS] Voicemail dispatch failed: {vm_err}")

            rec = _sip_first_record(custom_call_id, local_call_id, call_id)
            if rec:
                rec["dispatch"] = dispatch_opening_greeting

            async def fallback_greeting_timer():
                await asyncio.sleep(1.0)
                if not greeting_dispatched and session_ready and (not sip_first or is_inbound_call):
                    await dispatch_opening_greeting("fallback_timer")

            asyncio.create_task(fallback_greeting_timer())

            # 3. Event Processing Loop
            event_count = 0
            async for raw_msg in ws:
                event = json.loads(raw_msg)
                event_type = event.get("type", "")
                event_count += 1

                if event_type == "session.created":
                    session_ready = True
                    rec_ready = _sip_first_record(custom_call_id, local_call_id, call_id)
                    if rec_ready:
                        rec_ready["session_ready"].set()
                    if audio_bridge and not audio_bridge.is_inbound:
                        audio_bridge.ready.set()
                    # Greeting waits for session.updated so we do not speak twice.
                    continue

                if event_type == "session.updated":
                    session_ready = True
                    rec_ready = _sip_first_record(custom_call_id, local_call_id, call_id)
                    if rec_ready:
                        rec_ready["session_ready"].set()
                    if audio_bridge and not audio_bridge.is_inbound:
                        audio_bridge.ready.set()
                    already_answered = is_inbound_call or (rec_ready and rec_ready["answered"].is_set())
                    if already_answered or not sip_first or audio_bridge:
                        await dispatch_opening_greeting(event_type)

                if event_type in (
                    "input_audio_buffer.speech_started",
                    "conversation.item.input_audio_transcription.delta",
                ):
                    user_spoke = True
                    rec_h = _sip_first_record(custom_call_id, local_call_id, call_id)
                    if rec_h:
                        rec_h["answered"].set()
                    if audio_bridge and not audio_bridge.is_inbound:
                        await audio_bridge.release_to_caller()
                    if not greeting_dispatched:
                        await dispatch_opening_greeting("human_speech")

                if event_type == "response.created":
                    ext_tts_chars_fed = 0
                    ext_tts_turn_spoken = False
                    ext_tts_buf = ""

                if event_type in (
                    "response.audio.started",
                    "output_audio_buffer.started",
                    "response.output_audio.delta",
                    "response.audio.delta",
                ):
                    greeting_audio_started = True
                    delta_audio = event.get("delta") or event.get("audio")
                    
                    # If external TTS is configured, skip xAI audio (expect it from external provider)
                    if use_external_tts and not ext_tts_failed:
                        continue
                    
                    # If external TTS was configured but failed, error and notify user
                    if use_external_tts and ext_tts_failed:
                        logger.error(f"[XAI-WS] ❌ External TTS configured but failed for {call_id}")
                        try:
                            async with AsyncSessionLocal() as db:
                                notif = Notification(
                                    id=f"n_{uuid.uuid4().hex[:6]}",
                                    text="❌ TTS Provider Failed: External TTS (Cartesia/ElevenLabs) is configured but failed. Switch to xAI built-in voice in Voice & Telephony settings.",
                                    type="error",
                                )
                                db.add(notif)
                                await db.commit()
                                await call_hub.broadcast("notification", {
                                    "id": notif.id,
                                    "text": notif.text,
                                    "type": "error",
                                })
                        except Exception as notif_err:
                            logger.warning(f"Could not create error notification: {notif_err}")
                        continue
                    
                    # If no audio_bridge, error and notify user
                    if not audio_bridge:
                        logger.error(f"[XAI-WS] ❌ Audio output but NO audio_bridge for {call_id}")
                        try:
                            async with AsyncSessionLocal() as db:
                                notif = Notification(
                                    id=f"n_{uuid.uuid4().hex[:6]}",
                                    text="❌ Audio Bridge Failed: Voice configuration error. Check Voice & Telephony settings and restart the call.",
                                    type="error",
                                )
                                db.add(notif)
                                await db.commit()
                                await call_hub.broadcast("notification", {
                                    "id": notif.id,
                                    "text": notif.text,
                                    "type": "error",
                                })
                        except Exception as notif_err:
                            logger.warning(f"Could not create error notification: {notif_err}")
                        continue
                    
                    # No audio payload to send
                    if not delta_audio:
                        logger.debug(f"[XAI-WS] Audio event but no delta/audio payload: {event_type}")
                        continue
                    
                    # Send xAI audio to caller
                    logger.info(f"[XAI-WS] ✓ Emitting xAI audio ({len(delta_audio)} bytes) to caller for {call_id}")
                    await audio_bridge.emit_ai_audio(delta_audio)

                if event_type == "error":
                    err_detail = event.get("error", {})
                    logger.error(f"[XAI-WS] xAI returned error event for {call_id}: {err_detail}")
                    asyncio.create_task(log_process_event(
                        subsystem="voice",
                        process_name="xai_ws_error_event",
                        message=f"xAI returned error event for call {call_id}: {err_detail}",
                        level="ERROR",
                        details={"callId": call_id, "error": err_detail}
                    ))

                # Log ALL events (not just first 3) for diagnostics — key events always logged
                IMPORTANT_EVENTS = {
                    "session.created", "session.updated", "error",
                    "response.created", "response.done", "response.audio.started",
                    "response.output_item.added", "response.output_item.done",
                    "output_audio_buffer.started", "output_audio_buffer.stopped",
                    "output_audio_buffer.done", "session.ended", "call.ended"
                }
                if event_type in IMPORTANT_EVENTS or event_count <= 5:
                    logger.info(f"[XAI-WS] Event #{event_count} [{event_type}] for {call_id}")
                    if event_count == 1:
                        asyncio.create_task(log_process_event(
                            subsystem="voice",
                            process_name="xai_ws_first_event",
                            message=f"First xAI event received for call {call_id}: {event_type}",
                            level="INFO",
                            details={"callId": call_id, "eventType": event_type}
                        ))

                # Handle Voice Audio Transcripts (Assistant speaking)
                if event_type in ["response.audio_transcript.delta", "response.text.delta"]:
                    delta_text = event.get("delta", "")
                    if delta_text:
                        current_ai_text += delta_text
                        await call_hub.broadcast("call_transcript_delta", {
                            "callId": local_call_id,
                            "who": "ai",
                            "delta": delta_text
                        })
                        if use_external_tts:
                            greeting_audio_started = True
                            await _feed_ext_tts(delta_text)

                elif event_type in ["response.audio_transcript.done", "response.text.done"]:
                    final_text = event.get("transcript") or event.get("text", "")
                    if final_text:
                        current_ai_text = final_text
                    if use_external_tts:
                        await _ensure_ext_tts_for_turn(current_ai_text or final_text)
                    await commit_ai_turn()

                elif event_type == "response.output_item.done":
                    item = event.get("item", {})
                    if item.get("role") == "assistant":
                        for content_part in item.get("content", []):
                            text_part = content_part.get("transcript") or content_part.get("text")
                            if text_part and not current_ai_text:
                                current_ai_text = text_part
                        if use_external_tts and current_ai_text:
                            await _ensure_ext_tts_for_turn(current_ai_text)
                        await commit_ai_turn()

                elif event_type == "response.done":
                    resp_obj = event.get("response", {})
                    for item in resp_obj.get("output", []):
                        if item.get("role") == "assistant":
                            for content_part in item.get("content", []):
                                text_part = content_part.get("transcript") or content_part.get("text")
                                if text_part and not current_ai_text:
                                    current_ai_text = text_part
                    if use_external_tts:
                        await _ensure_ext_tts_for_turn(current_ai_text)
                    await commit_ai_turn()

                # User started speaking - commit any in-flight AI speech & cancel assistant turn
                elif event_type == "input_audio_buffer.speech_started":
                    human_live = True
                    awaiting_human = False
                    if use_external_tts:
                        await _cancel_ext_tts()
                    try:
                        from app.websockets.media_stream import media_stream_hub
                        await media_stream_hub.clear_twilio_audio(local_call_id)
                    except Exception:
                        pass
                    try:
                        await ws.send(json.dumps({"type": "response.cancel"}))
                    except Exception:
                        pass
                    await commit_ai_turn()

                # Handle Caller Transcription (User speaking)
                elif event_type in ["conversation.item.input_audio_transcription.completed", "conversation.item.input_audio_transcription"]:
                    await commit_ai_turn()
                    caller_text = event.get("transcript", "")
                    if caller_text and _is_hold_ivr(caller_text):
                        awaiting_human = True
                        logger.info(f"[XAI-WS] Hold/IVR — stay silent: {caller_text[:120]}")
                        try:
                            await ws.send(json.dumps({"type": "response.cancel"}))
                        except Exception:
                            pass
                        continue
                    if caller_text and _is_voicemail_prompt(caller_text):
                        logger.info(f"[XAI-WS] Voicemail prompt: {caller_text[:120]}")
                        await dispatch_voicemail("transcript")
                        continue
                    if caller_text:
                        # Real human on the line (or barge-in mid-voicemail / mid-hold)
                        if (voicemail_dispatched or awaiting_human) and not human_live and not is_inbound_call:
                            human_live = True
                            awaiting_human = False
                            logger.info(f"[XAI-WS] Human barge-in / pickup mid-machine — live intro for {target_first_name}")
                            try:
                                await ws.send(json.dumps({"type": "response.cancel"}))
                            except Exception:
                                pass
                            await dispatch_opening_greeting("human_barge_in", force=True)
                        human_live = True
                        awaiting_human = False
                        line = f"Prospect: {caller_text}"
                        if line not in transcript_history:
                            transcript_history.append(line)
                            await _update_call_transcript(local_call_id, line)
                            await call_hub.broadcast("call_transcript_delta", {
                                "callId": local_call_id,
                                "who": "them",
                                "delta": caller_text
                            })

                elif event_type == "conversation.item.created":
                    item = event.get("item", {})
                    role = item.get("role", "")
                    for content_part in item.get("content", []):
                        text_part = content_part.get("transcript") or content_part.get("text")
                        if text_part:
                            if role == "assistant":
                                current_ai_text = text_part
                                await commit_ai_turn()
                            else:
                                await commit_ai_turn()
                                line = f"Prospect: {text_part}"
                                if line not in transcript_history:
                                    transcript_history.append(line)
                                    await _update_call_transcript(local_call_id, line)
                                    await call_hub.broadcast("call_transcript_delta", {
                                        "callId": local_call_id,
                                        "who": "them",
                                        "delta": text_part
                                    })

                # Handle Tool/Function Calls
                elif event_type == "response.function_call_arguments.done":
                    call_tool_id = event.get("call_id")
                    tool_name = event.get("name")
                    raw_args = event.get("arguments", "{}")
                    
                    try:
                        parsed_args = json.loads(raw_args)
                    except Exception:
                        parsed_args = {}

                    tool_result = await execute_xai_tool(
                        name=tool_name,
                        args=parsed_args,
                        call_id=local_call_id,
                        prospect_id=prospect_id
                    )

                    await ws.send(json.dumps({
                        "type": "conversation.item.create",
                        "item": {
                            "type": "function_call_output",
                            "call_id": call_tool_id,
                            "output": json.dumps(tool_result)
                        }
                    }))

                    await ws.send(json.dumps({"type": "response.create"}))

                elif event_type in ["session.ended", "call.ended"]:
                    logger.info(f"xAI signaled session ended for {call_id}")
                    call_active = False
                    break

    except websockets.exceptions.ConnectionClosed as cc:
        logger.warning(f"[XAI-WS] Connection closed for call {call_id}: code={cc.code}, reason={cc.reason}")
        await log_process_event(
            subsystem="voice",
            process_name="xai_ws_closed",
            message=f"xAI WebSocket closed for call {call_id}: code={cc.code}, reason={cc.reason}",
            level="WARNING",
            details={"callId": local_call_id, "sipCallId": call_id, "code": cc.code, "reason": cc.reason}
        )
    except Exception as exc:
        logger.error(f"[XAI-WS] CRASH in WebSocket session for call {call_id}: {exc}", exc_info=True)
        await log_process_event(
            subsystem="voice",
            process_name="xai_ws_error",
            message=f"xAI WebSocket session CRASHED for call {call_id}: {str(exc)}",
            level="ERROR",
            details={"callId": local_call_id, "sipCallId": call_id, "error": str(exc)}
        )
    finally:
        q = _ext_tts_cleanup.get("queue")
        w = _ext_tts_cleanup.get("worker")
        if q is not None:
            try:
                await q.put(None)
            except Exception:
                pass
        if w is not None and not w.done():
            w.cancel()
            try:
                await w
            except (asyncio.CancelledError, Exception):
                pass
        active_xai_sessions.pop(local_call_id, None)
        active_xai_sessions.pop(call_id, None)
        for key in list(bridged_sessions.keys()):
            if bridged_sessions[key].call_id == str(local_call_id) or key in (str(call_id), str(local_call_id)):
                bridged_sessions.pop(key, None)
        duration_sec = int(time.time() - start_ts)
        duration_str = f"{duration_sec // 60:02d}:{duration_sec % 60:02d}"
        await _finalize_call(local_call_id, duration_str, transcript_history)


# ----------------------------------------------------------------------
# 5. HELPERS FOR DB SYNC & CALL TERMINATION
# ----------------------------------------------------------------------
async def _update_call_transcript(call_id: str, new_line: str):
    """Appends a new transcript line to LiveCall in database."""
    try:
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
            c = res.scalars().first()
            if c:
                current = list(c.transcript or [])
                current.append(new_line)
                c.transcript = current
                await db.commit()
    except Exception as err:
        logger.error(f"Error updating transcript for {call_id}: {err}")


async def _finalize_call(call_id: str, duration_str: str, transcript: List[str]):
    """Cleans up call state in database and reliably writes formatted permanent CallLog entry."""
    try:
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(LiveCall).where(LiveCall.id == call_id))
            call_obj = res.scalars().first()

            prospect_name = ""
            mission_name = "Outbound Voice"
            is_booked = False
            raw_lines = transcript or []
            prospect_row = None

            if call_obj:
                # Keep carrier-set failure states; don't overwrite failed/canceled with ended
                prior_state = (call_obj.state or "").lower()
                call_obj.ended = True
                if prior_state not in ("failed", "canceled", "cancelled"):
                    call_obj.state = "ended"
                call_obj.duration = duration_str
                prospect_name = call_obj.prospect or prospect_name
                mission_name = call_obj.mission or mission_name
                is_booked = bool(call_obj.booked)
                if call_obj.transcript:
                    raw_lines = list(call_obj.transcript)
                if call_obj.prospect_id:
                    prospect_row = (await db.execute(select(Prospect).where(Prospect.id == call_obj.prospect_id))).scalars().first()
                await db.commit()

            from app.services.call_log_writer import (
                format_transcript_lines,
                infer_outcome_from_transcript,
                upsert_call_log_from_live,
            )

            formatted_transcript = format_transcript_lines(raw_lines)
            outcome = infer_outcome_from_transcript(
                formatted_transcript,
                is_booked=is_booked,
                duration_str=duration_str,
            )

            if call_obj:
                await upsert_call_log_from_live(
                    db,
                    call_obj,
                    outcome=outcome,
                    duration=duration_str,
                    force_outcome=False,
                )
                await db.commit()
            else:
                # No LiveCall row — still try a minimal log via synthetic fields is skipped
                log_id = f"cl_{call_id.replace('call_', '')}"
                existing_log_res = await db.execute(select(CallLog).where(CallLog.id == log_id))
                existing_log = existing_log_res.scalars().first()
                names = resolve_call_people(
                    prospect=prospect_row,
                    live_label=prospect_name,
                    transcript=formatted_transcript,
                    existing_person=existing_log.person_listed_as if existing_log else None,
                    existing_company=existing_log.canonical_name if existing_log else None,
                )
                now_str = datetime.utcnow().strftime("%d %b %Y, %H:%M")
                if not existing_log:
                    db.add(CallLog(
                        id=log_id,
                        canonical_name=names["canonical"] or prospect_name or "Unknown",
                        listed_as=names["listed"] or prospect_name or "Unknown",
                        person_canonical=names["person"] or "",
                        person_listed_as=names["person"] or "",
                        channel="voice",
                        mission=mission_name,
                        started_at=now_str,
                        ended_at=now_str,
                        duration=f"{duration_str} min",
                        outcome=outcome,
                        transcript=formatted_transcript,
                    ))
                else:
                    existing_log.transcript = formatted_transcript
                    existing_log.duration = f"{duration_str} min"
                    if is_booked:
                        existing_log.outcome = "meeting_booked"
                    elif outcome != "contacted" or existing_log.outcome in (None, "", "contacted"):
                        from app.services.call_log_writer import _should_replace_outcome
                        if _should_replace_outcome(existing_log.outcome, outcome):
                            existing_log.outcome = outcome
                    apply_names_to_log(existing_log, names)
                await db.commit()

        await call_hub.broadcast("call_ended", {
            "callId": call_id,
            "duration": duration_str,
            "ended": True
        })

        await log_process_event(
            subsystem="telephony",
            process_name="call_session_finalized",
            message=f"Call {call_id} completed and saved to CallLog. Duration: {duration_str}, transcript lines: {len(formatted_transcript)}.",
            level="SUCCESS",
            details={"callId": call_id, "duration": duration_str, "transcriptLines": len(formatted_transcript), "booked": is_booked, "outcome": outcome}
        )
    except Exception as err:
        logger.error(f"Error finalizing call {call_id}: {err}", exc_info=True)



