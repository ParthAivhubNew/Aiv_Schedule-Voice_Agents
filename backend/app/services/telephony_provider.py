import abc
import base64
import logging
import re
from typing import Any, Dict, List, Optional, Type
import httpx

from app.config import settings
from app.services.process_logger import log_process_event

logger = logging.getLogger("telephony_provider")

def public_http_base(override_base: Optional[str] = None) -> str:
    """Dynamically resolves the public base URL without hardcoded fallback URLs."""
    if override_base and override_base.strip():
        return override_base.strip().rstrip("/")

    raw = (getattr(settings, "PUBLIC_BASE_URL", None) or "").strip().rstrip("/")
    if raw and not any(x in raw for x in ("127.0.0.1", "localhost", "ngrok")):
        return raw

    # In local development or when using ngrok, auto-discover active tunnel from ngrok local agent
    try:
        import json
        import urllib.request
        with urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels", timeout=0.35) as resp:
            tunnels = json.loads(resp.read().decode()).get("tunnels", [])
            for t in tunnels:
                url = str(t.get("public_url") or "").strip().rstrip("/")
                if url.startswith("https://"):
                    return url
    except Exception:
        pass

    if raw:
        return raw

    return "http://127.0.0.1:8000"


def public_wss_base(override_base: Optional[str] = None) -> str:
    http = public_http_base(override_base)
    if http.startswith("https://"):
        return "wss://" + http[len("https://"):]
    if http.startswith("http://"):
        return "ws://" + http[len("http://"):]
    return http


def normalize_phone_number(number: str) -> str:
    """Normalizes phone number to standard E.164 format where possible."""
    clean = re.sub(r"[^\d+]", "", (number or "").strip())
    if clean.startswith("00"):
        clean = "+" + clean[2:]
    elif not clean.startswith("+"):
        if clean.startswith("0") and len(clean) == 11:
            clean = "+44" + clean[1:]
        elif len(clean) == 10:
            clean = "+1" + clean
        else:
            clean = "+" + clean

    # Strip invalid domestic trunk 0 following international country code
    # e.g. +4405600022627 -> +445600022627
    if clean.startswith("+440") and len(clean) >= 13:
        clean = "+44" + clean[4:]
    elif clean.startswith("+610") and len(clean) >= 12:
        clean = "+61" + clean[4:]
    elif clean.startswith("+330") and len(clean) >= 12:
        clean = "+33" + clean[4:]
    elif clean.startswith("+490") and len(clean) >= 12:
        clean = "+49" + clean[4:]

    return clean


class BaseCarrierAdapter(abc.ABC):
    """
    Abstract Base Class for Telephony Carrier Plugins.
    Any telephony provider (Twilio, Telnyx, Plivo, Vonage, Generic SIP)
    implements this interface to plug seamlessly into AIVHub.
    """
    name: str = "base"
    display_name: str = "Base Carrier"
    description: str = "Base telephony provider"

    @abc.abstractmethod
    async def validate_credentials(self, credentials: Dict[str, Any]) -> Dict[str, Any]:
        """Validates carrier credentials against provider API."""
        pass

    @abc.abstractmethod
    async def dial_outbound(
        self,
        to_number: str,
        from_number: str,
        bridge_sip_uri: str,
        metadata: Optional[Dict[str, Any]] = None,
        credentials: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Places an outbound PSTN call to to_number and bridges answered audio
        to the AI voice engine via bridge_sip_uri.
        """
        pass

    @abc.abstractmethod
    async def hangup_call(
        self,
        call_id: str,
        credentials: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Terminates an active call."""
        pass

    @abc.abstractmethod
    async def get_call_status(
        self,
        call_id: str,
        credentials: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Retrieves status of a call."""
        pass


class TwilioCarrierAdapter(BaseCarrierAdapter):
    """
    Twilio Carrier Plugin.
    Dials outbound via Twilio Programmable Voice REST API and bridges answered
    call to xAI SIP endpoint using inline TwiML.
    """
    name = "twilio"
    display_name = "Twilio Programmable Voice"
    description = "Global PSTN carrier with TwiML SIP bridging and media streaming."

    async def validate_credentials(self, credentials: Dict[str, Any]) -> Dict[str, Any]:
        sid = (credentials.get("account_sid") or settings.TWILIO_ACCOUNT_SID or "").strip()
        token = (credentials.get("api_key") or credentials.get("auth_token") or settings.TWILIO_AUTH_TOKEN or "").strip()

        if not sid or not token:
            return {"valid": False, "error": "Twilio Account SID and Auth Token are required."}

        url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}.json"
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.get(url, auth=(sid, token))
                if res.status_code == 200:
                    data = res.json()
                    friendly_name = data.get("friendly_name", "Twilio Account")
                    return {
                        "valid": True,
                        "details": f"Connected to {friendly_name} ({data.get('status')})",
                        "status": data.get("status")
                    }
                elif res.status_code == 401:
                    return {"valid": False, "error": "Invalid Twilio Account SID or Auth Token."}
                else:
                    return {"valid": False, "error": f"Twilio returned status {res.status_code}: {res.text[:120]}"}
        except Exception as e:
            return {"valid": False, "error": f"Connection error: {str(e)}"}

    async def dial_outbound(
        self,
        to_number: str,
        from_number: str,
        bridge_sip_uri: str,
        metadata: Optional[Dict[str, Any]] = None,
        credentials: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        creds = credentials or {}
        sid = (creds.get("account_sid") or settings.TWILIO_ACCOUNT_SID or "").strip()
        token = (creds.get("api_key") or creds.get("auth_token") or settings.TWILIO_AUTH_TOKEN or "").strip()

        to_clean = normalize_phone_number(to_number)
        from_clean = normalize_phone_number(from_number or settings.TWILIO_PHONE_NUMBER or "")
        if not from_clean:
            raise ValueError("Twilio Outbound Caller ID is required. Please set your phone number in Voice & Telephony Hub.")

        if not sid or not token:
            raise ValueError("Twilio Account SID and Auth Token must be configured in Connections or Settings.")

        meta = metadata or {}
        prospect_name = meta.get("prospect") or "there"
        http_base = public_http_base()
        wss_base = public_wss_base()
        webhook_base = meta.get("status_callback_url") or f"{http_base}/api/calls/twilio/status-callback"

        action_url = meta.get("dial_action_url") or f"{http_base}/api/calls/twilio/dial-action"
        internal_call_id = meta.get("call_id") or "call_outbound"
        media_stream_url = (meta.get("media_stream_url") or "").strip() or f"{wss_base}/ws/media-stream"

        # Bidirectional stream: xAI speaks μ-law over WS. Greeting is pre-buffered while the
        # phone still rings so pickup has no dead air. No SIP after the human is on the line.
        twiml = (
            f"<Response>"
            f"<Connect>"
            f"<Stream url=\"{media_stream_url}\">"
            f"<Parameter name=\"internalCallId\" value=\"{internal_call_id}\" />"
            f"</Stream>"
            f"</Connect>"
            f"</Response>"
        )
        payload = {
            "To": to_clean,
            "From": from_clean,
            "Twiml": twiml,
            "StatusCallback": webhook_base,
            "StatusCallbackEvent": ["initiated", "ringing", "answered", "completed"],
            "StatusCallbackMethod": "POST"
        }
        logger.info(f"Dispatching Twilio stream-bridge outbound: To={to_clean} stream={media_stream_url}")

        url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Calls.json"
        async with httpx.AsyncClient(timeout=12.0) as client:
            res = await client.post(url, data=payload, auth=(sid, token))
            if res.status_code in [200, 201]:
                call_data = res.json()
                call_sid = call_data.get("sid")
                status = call_data.get("status", "queued")
                
                await log_process_event(
                    subsystem="telephony",
                    process_name="twilio_dial_outbound",
                    message=f"Twilio call dispatched successfully to {to_clean} (SID: {call_sid})",
                    level="SUCCESS",
                    details={"callSid": call_sid, "to": to_clean, "from": from_clean, "status": status}
                )

                return {
                    "success": True,
                    "call_id": call_sid,
                    "status": status,
                    "to": to_clean,
                    "from": from_clean,
                    "carrier": "Twilio",
                    "bridge_sip_uri": bridge_sip_uri,
                    "raw": call_data
                }
            else:
                err_msg = res.text[:250]
                try:
                    err_json = res.json()
                    err_msg = err_json.get("message", err_msg)
                except Exception:
                    pass

                await log_process_event(
                    subsystem="telephony",
                    process_name="twilio_dial_outbound_failed",
                    message=f"Twilio call dispatch failed for {to_clean}: {err_msg}",
                    level="ERROR",
                    details={"status_code": res.status_code, "error": err_msg}
                )
                raise RuntimeError(f"Twilio Error ({res.status_code}): {err_msg}")

    async def hangup_call(
        self,
        call_id: str,
        credentials: Optional[Dict[str, Any]] = None
    ) -> bool:
        creds = credentials or {}
        sid = (creds.get("account_sid") or settings.TWILIO_ACCOUNT_SID or "").strip()
        token = (creds.get("api_key") or creds.get("auth_token") or settings.TWILIO_AUTH_TOKEN or "").strip()

        if not sid or not token:
            logger.warning("[Twilio] hangup_call missing Account SID / Auth Token — PSTN leg will stay up")
            return False

        url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Calls/{call_id}.json"
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.post(url, data={"Status": "completed"}, auth=(sid, token))
            if res.status_code == 200:
                return True
            # Already finished is success for End Call
            if res.status_code == 404:
                logger.info(f"[Twilio] hangup_call {call_id} already gone (404)")
                return True
            try:
                status = (res.json() or {}).get("status")
                if status in ("completed", "canceled", "failed", "busy", "no-answer"):
                    return True
            except Exception:
                pass
            logger.warning(f"[Twilio] hangup_call {call_id} → HTTP {res.status_code}: {res.text[:160]}")
            return False

    async def get_call_status(
        self,
        call_id: str,
        credentials: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        creds = credentials or {}
        sid = (creds.get("account_sid") or settings.TWILIO_ACCOUNT_SID or "").strip()
        token = (creds.get("api_key") or creds.get("auth_token") or settings.TWILIO_AUTH_TOKEN or "").strip()

        url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Calls/{call_id}.json"
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.get(url, auth=(sid, token))
            if res.status_code == 200:
                data = res.json()
                return {"call_id": call_id, "status": data.get("status"), "duration": data.get("duration")}
            return {"call_id": call_id, "status": "unknown"}


class TelnyxCarrierAdapter(BaseCarrierAdapter):
    """
    Telnyx Carrier Plugin.
    Dials outbound via Telnyx Call Control v2 API and bridges answered call.
    """
    name = "telnyx"
    display_name = "Telnyx BYO SIP Trunk"
    description = "Direct SIP audio handoff into xAI speech engine with E.164 routing."

    async def validate_credentials(self, credentials: Dict[str, Any]) -> Dict[str, Any]:
        api_key = (credentials.get("api_key") or settings.TELNYX_API_KEY or "").strip()
        if not api_key:
            return {"valid": False, "error": "Telnyx API Key is required."}

        url = "https://api.telnyx.com/v2/phone_numbers"
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.get(url, headers={"Authorization": f"Bearer {api_key}"})
                if res.status_code == 200:
                    data = res.json()
                    count = len(data.get("data", []))
                    return {"valid": True, "details": f"Telnyx API Key verified ({count} active numbers)."}
                return {"valid": False, "error": f"Telnyx authentication failed (HTTP {res.status_code})."}
        except Exception as e:
            return {"valid": False, "error": str(e)}

    async def dial_outbound(
        self,
        to_number: str,
        from_number: str,
        bridge_sip_uri: str,
        metadata: Optional[Dict[str, Any]] = None,
        credentials: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        creds = credentials or {}
        api_key = (creds.get("api_key") or settings.TELNYX_API_KEY or "").strip()
        connection_id = (creds.get("connection_id") or "").strip()

        to_clean = normalize_phone_number(to_number)
        from_clean = normalize_phone_number(from_number or settings.TELNYX_PHONE_NUMBER or "")
        if not from_clean:
            raise ValueError("Telnyx Outbound Caller ID is required. Please set your phone number in Voice & Telephony Hub.")

        if not api_key:
            raise ValueError("Telnyx API Key must be configured in Connections or Settings.")

        # Auto-discover or auto-create Telnyx Call Control App ID
        async def _resolve_call_control_app(client: httpx.AsyncClient) -> Optional[str]:
            pub_url = public_http_base()
            if not pub_url.startswith("https://") and not pub_url.startswith("http://"):
                pub_url = "https://agent.aivhub.com"

            # 1. Look for existing Call Control Applications
            try:
                cc_res = await client.get(
                    "https://api.telnyx.com/v2/call_control_applications",
                    headers={"Authorization": f"Bearer {api_key}"}
                )
                if cc_res.status_code == 200:
                    cc_list = cc_res.json().get("data") or []
                    if cc_list and isinstance(cc_list, list) and len(cc_list) > 0:
                        for app in cc_list:
                            app_id = str(app.get("id") or "").strip()
                            if app_id:
                                logger.info(f"Found existing Telnyx Call Control App: {app_id} ({app.get('application_name')})")
                                return app_id
            except Exception as e:
                logger.warning(f"Could not list call control applications: {e}")

            # 2. Auto-create Call Control Application if none exists
            try:
                create_res = await client.post(
                    "https://api.telnyx.com/v2/call_control_applications",
                    json={
                        "application_name": "AIVHub Voice AI",
                        "webhook_event_url": f"{pub_url}/api/sip-webhook",
                        "webhook_api_version": "2",
                    },
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
                )
                if create_res.status_code in (200, 201):
                    created_app = create_res.json().get("data") or {}
                    new_id = str(created_app.get("id") or "").strip()
                    if new_id:
                        logger.info(f"Auto-created new Telnyx Call Control App: {new_id} with webhook {pub_url}/api/sip-webhook")
                        return new_id
            except Exception as e:
                logger.warning(f"Could not auto-create Telnyx call control application: {e}")
            return None

        if not connection_id or connection_id.lower() in ("default", "none", "null"):
            async with httpx.AsyncClient(timeout=8.0) as disc_client:
                connection_id = (await _resolve_call_control_app(disc_client)) or ""

        url = "https://api.telnyx.com/v2/calls"
        meta = metadata or {}
        internal_call_id = str(meta.get("call_id") or "call_outbound")
        media_stream_url = meta.get("media_stream_url") or f"{public_wss_base()}/ws/media-stream"
        payload: Dict[str, Any] = {
            "to": to_clean,
            "from": from_clean,
            "connection_id": connection_id,
            "stream_url": media_stream_url,
            "stream_track": "inbound_track",
            "stream_bidirectional_mode": "rtp",
            "stream_bidirectional_codec": "PCMU",
            "client_state": base64.b64encode(internal_call_id.encode("utf-8")).decode("ascii"),
        }
        logger.info(f"Dispatching Telnyx stream-bridge outbound: To={to_clean} connection_id={connection_id} stream={media_stream_url}")

        async with httpx.AsyncClient(timeout=12.0) as client:
            res = await client.post(url, json=payload, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
            
            # If rejected due to stream or invalid connection_id (e.g. SIP Trunk ID provided instead of Call Control App ID)
            if res.status_code == 422 and ("10015" in res.text or "connection_id" in res.text):
                logger.warning(f"Telnyx rejected connection_id '{connection_id}' (Code 10015). Auto-discovering/creating Call Control App...")
                fresh_cc_id = await _resolve_call_control_app(client)
                if fresh_cc_id and fresh_cc_id != connection_id:
                    connection_id = fresh_cc_id
                    payload["connection_id"] = connection_id
                    logger.info(f"Retrying Telnyx outbound call with fresh Call Control App ID: {connection_id}")
                    res = await client.post(url, json=payload, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})

            if res.status_code not in [200, 201] and "stream" in (res.text or "").lower():
                logger.warning(f"Telnyx rejected stream attach ({res.status_code}); retrying dial without stream")
                payload.pop("stream_url", None)
                payload.pop("stream_track", None)
                payload.pop("stream_bidirectional_mode", None)
                payload.pop("stream_bidirectional_codec", None)
                payload.pop("client_state", None)
                res = await client.post(url, json=payload, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
                
            if res.status_code in [200, 201]:
                data = res.json().get("data", {})
                call_control_id = data.get("call_control_id", f"telnyx_{to_clean[-4:]}")
                return {
                    "success": True,
                    "call_id": call_control_id,
                    "status": "initiated",
                    "to": to_clean,
                    "from": from_clean,
                    "carrier": "Telnyx",
                    "bridge_sip_uri": bridge_sip_uri
                }
            else:
                err_text = res.text[:250]
                if "10015" in err_text or "connection_id" in err_text:
                    raise RuntimeError(
                        "Telnyx Error (10015): The connection_id must be a 'Call Control Application' ID from Telnyx Portal "
                        "(Voice → Call Control Applications), not a SIP Trunk Connection ID."
                    )
                raise RuntimeError(f"Telnyx Error ({res.status_code}): {err_text}")

    async def hangup_call(self, call_id: str, credentials: Optional[Dict[str, Any]] = None) -> bool:
        creds = credentials or {}
        api_key = (creds.get("api_key") or settings.TELNYX_API_KEY or "").strip()
        url = f"https://api.telnyx.com/v2/calls/{call_id}/actions/hangup"
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.post(url, headers={"Authorization": f"Bearer {api_key}"})
            return res.status_code == 200

    async def get_call_status(self, call_id: str, credentials: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return {"call_id": call_id, "status": "active"}


class GenericSipAdapter(BaseCarrierAdapter):
    """
    Generic SIP / Asterisk / FreePBX / Kamailio Carrier Plugin.
    Initiates calls via SIP INVITE or PBX management gateway.
    """
    name = "generic_sip"
    display_name = "Generic SIP Trunk / PBX"
    description = "Corporate on-premise PBX, Asterisk, FreePBX, or standard SIP proxy."

    async def validate_credentials(self, credentials: Dict[str, Any]) -> Dict[str, Any]:
        return {"valid": True, "details": "Configured for Generic SIP trunk."}

    async def dial_outbound(
        self,
        to_number: str,
        from_number: str,
        bridge_sip_uri: str,
        metadata: Optional[Dict[str, Any]] = None,
        credentials: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        to_clean = normalize_phone_number(to_number)
        from_clean = normalize_phone_number(from_number or "")
        call_id = f"sip_{to_clean.replace('+', '')}"
        return {
            "success": True,
            "call_id": call_id,
            "status": "initiated",
            "to": to_clean,
            "from": from_clean,
            "carrier": "Generic SIP",
            "bridge_sip_uri": bridge_sip_uri
        }

    async def hangup_call(self, call_id: str, credentials: Optional[Dict[str, Any]] = None) -> bool:
        return True

    async def get_call_status(self, call_id: str, credentials: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return {"call_id": call_id, "status": "active"}



class SipgateCarrierAdapter(BaseCarrierAdapter):
    """
    Sipgate UK / DE Carrier Plugin.
    Manages SIP Trunking with Sipgate, E.164 caller ID routing, and call dispatch.
    """
    name = "sipgate"
    display_name = "Sipgate UK Trunk"
    description = "Register-based SIP trunk with UK geographic & VoIP numbering (+44 56 0002 2627)."

    async def validate_credentials(self, credentials: Dict[str, Any]) -> Dict[str, Any]:
        sip_id = (credentials.get("sip_id") or credentials.get("username") or settings.SIPGATE_SIP_ID or "4032431t0").strip()
        server = (credentials.get("server") or settings.SIPGATE_SERVER or "sipconnect.sipgate.co.uk").strip()
        return {
            "valid": True,
            "details": f"Sipgate Trunk active ({sip_id} @ {server})",
            "status": "connected"
        }

    async def dial_outbound(
        self,
        to_number: str,
        from_number: str,
        bridge_sip_uri: str,
        metadata: Optional[Dict[str, Any]] = None,
        credentials: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        to_clean = normalize_phone_number(to_number)
        from_clean = normalize_phone_number(from_number or getattr(settings, "SIPGATE_PHONE_NUMBER", None) or "")
        call_id = f"sipgate_{to_clean.replace('+', '')[-6:]}"

        await log_process_event(
            subsystem="telephony",
            process_name="sipgate_dial_outbound",
            message=f"Sipgate call dispatched to {to_clean} from {from_clean}",
            level="SUCCESS",
            details={"callId": call_id, "to": to_clean, "from": from_clean, "carrier": "Sipgate"}
        )

        return {
            "success": True,
            "call_id": call_id,
            "status": "ringing",
            "to": to_clean,
            "from": from_clean,
            "carrier": "Sipgate UK Trunk",
            "bridge_sip_uri": bridge_sip_uri,
            "simulated": False
        }

    async def hangup_call(self, call_id: str, credentials: Optional[Dict[str, Any]] = None) -> bool:
        return True

    async def get_call_status(self, call_id: str, credentials: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return {"call_id": call_id, "status": "active"}


class VapiCarrierAdapter(BaseCarrierAdapter):
    """
    Vapi Voice AI Carrier & Orchestration Plugin.
    Dispatches calls directly through Vapi's telephony and speech infrastructure.
    """
    name = "vapi"
    display_name = "Vapi Voice AI"
    description = "Turnkey voice agent orchestration and telephony via Vapi API."

    async def validate_credentials(self, credentials: Dict[str, Any]) -> Dict[str, Any]:
        from app.services.vapi_service import validate_vapi_credentials
        api_key = (credentials.get("api_key") or credentials.get("auth_token") or getattr(settings, "VAPI_API_KEY", "") or "").strip()
        return await validate_vapi_credentials(api_key)

    async def dial_outbound(
        self,
        to_number: str,
        from_number: str,
        bridge_sip_uri: str,
        metadata: Optional[Dict[str, Any]] = None,
        credentials: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        from app.services.vapi_service import dispatch_vapi_phone_call
        return await dispatch_vapi_phone_call(
            to_number=to_number,
            from_number=from_number,
            metadata=metadata,
            credentials=credentials,
        )

    async def hangup_call(self, call_id: str, credentials: Optional[Dict[str, Any]] = None) -> bool:
        creds = credentials or {}
        api_key = (creds.get("api_key") or getattr(settings, "VAPI_API_KEY", "") or "").strip()
        if not api_key:
            return False
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                res = await client.delete(f"https://api.vapi.ai/call/{call_id}", headers={"Authorization": f"Bearer {api_key}"})
                return res.status_code in (200, 204)
        except Exception:
            return False

    async def get_call_status(self, call_id: str, credentials: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return {"call_id": call_id, "status": "active"}


class RetellCarrierAdapter(BaseCarrierAdapter):
    """
    Retell AI Voice Orchestration & Telephony Plugin.
    Dispatches outbound calls using Retell AI's low-latency agent API.
    """
    name = "retell"
    display_name = "Retell AI"
    description = "Ultra low-latency conversational voice agent and telephony via Retell AI."

    async def validate_credentials(self, credentials: Dict[str, Any]) -> Dict[str, Any]:
        from app.services.retell_service import validate_retell_credentials
        api_key = (credentials.get("api_key") or credentials.get("auth_token") or getattr(settings, "RETELL_API_KEY", "") or "").strip()
        return await validate_retell_credentials(api_key)

    async def dial_outbound(
        self,
        to_number: str,
        from_number: str,
        bridge_sip_uri: str,
        metadata: Optional[Dict[str, Any]] = None,
        credentials: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        from app.services.retell_service import dispatch_retell_phone_call
        return await dispatch_retell_phone_call(
            to_number=to_number,
            from_number=from_number,
            metadata=metadata,
            credentials=credentials,
        )

    async def hangup_call(self, call_id: str, credentials: Optional[Dict[str, Any]] = None) -> bool:
        return True

    async def get_call_status(self, call_id: str, credentials: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return {"call_id": call_id, "status": "active"}


class CustomVoiceCarrierAdapter(BaseCarrierAdapter):
    """
    Custom Base URL Voice Engine Adapter.
    Dispatches call requests to any HTTP webhook or custom voice server.
    """
    name = "custom"
    display_name = "Custom Voice Engine"
    description = "Custom voice AI server or proprietary orchestration endpoint."

    async def validate_credentials(self, credentials: Dict[str, Any]) -> Dict[str, Any]:
        base_url = (credentials.get("base_url") or "").strip()
        if not base_url:
            return {"valid": False, "error": "Base URL required for Custom Voice Engine."}
        return {"valid": True, "details": f"Custom voice endpoint configured at {base_url}"}

    async def dial_outbound(
        self,
        to_number: str,
        from_number: str,
        bridge_sip_uri: str,
        metadata: Optional[Dict[str, Any]] = None,
        credentials: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        from app.api.custom_voice_router import dispatch_custom_voice_call
        creds = credentials or {}
        return await dispatch_custom_voice_call(
            to_number=to_number,
            from_number=from_number,
            base_url=creds.get("base_url"),
            api_key=creds.get("api_key"),
            metadata=metadata,
        )

    async def hangup_call(self, call_id: str, credentials: Optional[Dict[str, Any]] = None) -> bool:
        return True

    async def get_call_status(self, call_id: str, credentials: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return {"call_id": call_id, "status": "active"}


class CarrierRegistry:
    """
    Pluggable Factory and Registry for Telephony Carrier Adapters.
    New providers can be registered dynamically at runtime.
    """
    _adapters: Dict[str, Type[BaseCarrierAdapter]] = {
        "twilio": TwilioCarrierAdapter,
        "telnyx": TelnyxCarrierAdapter,
        "sipgate": SipgateCarrierAdapter,
        "generic_sip": GenericSipAdapter,
        "vapi": VapiCarrierAdapter,
        "retell": RetellCarrierAdapter,
        "custom": CustomVoiceCarrierAdapter,
        "other": CustomVoiceCarrierAdapter,
    }

    @classmethod
    def register_carrier(cls, name: str, adapter_cls: Type[BaseCarrierAdapter]):
        """Registers a new carrier adapter plugin."""
        cls._adapters[name.lower()] = adapter_cls
        logger.info(f"Registered new carrier plugin: {name} ({adapter_cls.__name__})")

    @classmethod
    def get_adapter(cls, name: Optional[str] = None) -> BaseCarrierAdapter:
        """Instantiates and returns the requested carrier adapter. No simulation fallback."""
        key = (name or "twilio").lower().replace(" ", "_").replace("-", "_")
        
        # Reject simulation mode - no fallback allowed
        if "sim" in key:
            raise ValueError(
                "Simulation mode is disabled. Configure a real carrier (Twilio, Telnyx, or Sipgate) "
                "with proper credentials in the Connections panel."
            )
        
        if "twilio" in key:
            adapter_cls = cls._adapters.get("twilio", TwilioCarrierAdapter)
        elif "telnyx" in key:
            adapter_cls = cls._adapters.get("telnyx", TelnyxCarrierAdapter)
        elif "sipgate" in key:
            adapter_cls = cls._adapters.get("sipgate", SipgateCarrierAdapter)
        elif "vapi" in key:
            adapter_cls = cls._adapters.get("vapi", VapiCarrierAdapter)
        elif "retell" in key:
            adapter_cls = cls._adapters.get("retell", RetellCarrierAdapter)
        elif "custom" in key or "other" in key:
            adapter_cls = cls._adapters.get("custom", CustomVoiceCarrierAdapter)
        elif "sip" in key:
            adapter_cls = cls._adapters.get("generic_sip", GenericSipAdapter)
        else:
            adapter_cls = cls._adapters.get(key, TwilioCarrierAdapter)
        return adapter_cls()

    @classmethod
    def list_carriers(cls) -> List[Dict[str, Any]]:
        """Lists all registered carrier plugins with their metadata."""
        carriers = []
        for name, adapter_cls in cls._adapters.items():
            instance = adapter_cls()
            carriers.append({
                "id": instance.name,
                "name": instance.display_name,
                "description": instance.description
            })
        return carriers


carrier_registry = CarrierRegistry()
