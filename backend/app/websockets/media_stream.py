import asyncio
import base64
import json
import logging
from typing import Dict, List, Set, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger("media_stream")

class MediaStreamHub:
    """
    Manages real-time audio streams between Twilio carrier audio forks
    and supervisor web browser listening sessions.
    Supports multi-alias call ID resolution so that internalCallId,
    Twilio CallSid, and xAI SIP session ID all route seamlessly.
    """
    def __init__(self):
        # Maps call_id -> list of supervisor WebSockets listening
        self.call_listeners: Dict[str, Set[WebSocket]] = {}
        # Maps call_id -> Twilio media WebSocket connection
        self.twilio_streams: Dict[str, WebSocket] = {}
        # Maps Twilio streamSid -> call_id
        self.stream_to_call: Dict[str, str] = {}
        # Maps callSid -> call_id
        self.call_sid_to_call: Dict[str, str] = {}
        # Alias map: maps any alternate ID (callSid, xai_id, etc.) -> canonical call_id
        self.alias_map: Dict[str, str] = {}
        # Active takeover state for calls
        self.active_takeovers: Set[str] = set()
        self._injection_counter: int = 0
        self.stream_protocol: Dict[str, str] = {}
        self._mark_events: Dict[str, asyncio.Event] = {}

    def register_alias(self, alias: str, canonical_id: str):
        """Links an alias ID (e.g. xAI SIP call id or Twilio SID) to the canonical call ID."""
        if not alias or not canonical_id:
            return
        self.alias_map[alias] = canonical_id
        self.alias_map[canonical_id] = canonical_id
        logger.info(f"[AudioHub] Registered call ID alias: {alias} -> {canonical_id}")

    def resolve_canonical(self, some_id: str) -> str:
        return self.alias_map.get(some_id, some_id)

    def register_listener(self, call_id: str, ws: WebSocket):
        canonical = self.resolve_canonical(call_id)
        if canonical not in self.call_listeners:
            self.call_listeners[canonical] = set()
        self.call_listeners[canonical].add(ws)
        # Also record under the raw requested call_id if different
        if call_id != canonical:
            if call_id not in self.call_listeners:
                self.call_listeners[call_id] = set()
            self.call_listeners[call_id].add(ws)

        total = len(self.call_listeners.get(canonical, set()))
        logger.info(f"[AudioHub] Supervisor connected to listen to call {call_id} (canonical: {canonical}). Active listeners: {total}")

    def unregister_listener(self, call_id: str, ws: WebSocket):
        canonical = self.resolve_canonical(call_id)
        for cid in list(self.call_listeners.keys()):
            if ws in self.call_listeners[cid]:
                self.call_listeners[cid].discard(ws)
                if not self.call_listeners[cid]:
                    del self.call_listeners[cid]
        logger.info(f"[AudioHub] Supervisor disconnected from call {call_id}.")

    async def broadcast_to_listeners(self, call_id: str, payload_dict: dict):
        """Broadcasts audio chunk to all listeners subscribed to this call or its aliases."""
        target_listeners: Set[WebSocket] = set()
        canonical = self.resolve_canonical(call_id)

        # 1. Direct and canonical listeners
        if call_id in self.call_listeners:
            target_listeners.update(self.call_listeners[call_id])
        if canonical in self.call_listeners:
            target_listeners.update(self.call_listeners[canonical])

        # 2. Check any aliases that point to this canonical ID
        for alias, c_id in self.alias_map.items():
            if c_id == canonical and alias in self.call_listeners:
                target_listeners.update(self.call_listeners[alias])

        # 3. Fail-safe: If exactly 1 call stream is active and 1 listener is waiting anywhere, bridge them!
        if not target_listeners and len(self.twilio_streams) == 1 and len(self.call_listeners) >= 1:
            for registered_cid, ws_set in self.call_listeners.items():
                target_listeners.update(ws_set)
                # Auto-link this listener's ID to this active call!
                self.register_alias(registered_cid, call_id)
                break

        if not target_listeners:
            return

        msg = json.dumps(payload_dict)
        dead = []
        for ws in list(target_listeners):
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for d in dead:
            self.unregister_listener(call_id, d)

    async def inject_operator_audio_to_twilio(self, call_id: str, base64_payload: str):
        """Injects supervisor microphone audio into the live Twilio call."""
        canonical = self.resolve_canonical(call_id)
        twilio_ws = self.twilio_streams.get(canonical) or self.twilio_streams.get(call_id)

        # Fallback: if only one Twilio stream is active, use it
        if not twilio_ws and len(self.twilio_streams) == 1:
            only_cid, twilio_ws = next(iter(self.twilio_streams.items()))
            self.register_alias(call_id, only_cid)
            canonical = only_cid

        if not twilio_ws:
            logger.warning(f"[AudioHub] No active Twilio stream found for call {call_id} (canonical: {canonical}). Active streams: {list(self.twilio_streams.keys())}")
            return

        protocol = self.stream_protocol.get(canonical) or self.stream_protocol.get(call_id) or "twilio"

        # Find matching streamSid
        stream_sid = None
        for s_sid, c_id in self.stream_to_call.items():
            if c_id == canonical or c_id == call_id or self.resolve_canonical(c_id) == canonical:
                stream_sid = s_sid
                break

        if not stream_sid and self.stream_to_call:
            stream_sid = next(iter(self.stream_to_call.keys()))

        if protocol != "telnyx" and not stream_sid:
            logger.warning(f"[AudioHub] No streamSid found for Twilio stream on call {call_id}")
            return
        try:
            if protocol == "telnyx":
                packet = {"event": "media", "media": {"payload": base64_payload}}
            else:
                packet = {
                    "event": "media",
                    "streamSid": stream_sid,
                    "media": {"payload": base64_payload},
                }
            await twilio_ws.send_text(json.dumps(packet))
            self._injection_counter += 1
            if self._injection_counter % 50 == 1:
                logger.info(f"[AudioHub] Injected operator mic audio packet #{self._injection_counter} to Twilio (streamSid={stream_sid}, payloadLen={len(base64_payload)})")
        except Exception as e:
            logger.warning(f"[AudioHub] Error injecting operator audio to Twilio: {e}")

    async def clear_twilio_audio(self, call_id: str) -> bool:
        """Sends Twilio clear event to instantly flush buffered audio on interruption/barge-in."""
        canonical = self.resolve_canonical(call_id)
        twilio_ws = self.twilio_streams.get(canonical) or self.twilio_streams.get(call_id)
        if not twilio_ws and len(self.twilio_streams) == 1:
            _, twilio_ws = next(iter(self.twilio_streams.items()))
        if not twilio_ws:
            return False
        stream_sid = None
        for s_sid, c_id in self.stream_to_call.items():
            if c_id == canonical or c_id == call_id or self.resolve_canonical(c_id) == canonical:
                stream_sid = s_sid
                break
        if not stream_sid and self.stream_to_call:
            stream_sid = next(iter(self.stream_to_call.keys()))
        if not stream_sid:
            return False
        try:
            await twilio_ws.send_text(json.dumps({
                "event": "clear",
                "streamSid": stream_sid
            }))
            logger.info(f"[AudioHub] Sent Twilio clear event for call {call_id} (streamSid={stream_sid})")
            return True
        except Exception as e:
            logger.warning(f"[AudioHub] Error sending Twilio clear event: {e}")
            return False

    async def send_mark(self, call_id: str, mark_name: str) -> bool:
        """Sends Twilio mark event to track exactly when buffered audio finishes playing in caller's ear."""
        canonical = self.resolve_canonical(call_id)
        twilio_ws = self.twilio_streams.get(canonical) or self.twilio_streams.get(call_id)
        if not twilio_ws and len(self.twilio_streams) == 1:
            _, twilio_ws = next(iter(self.twilio_streams.items()))
        if not twilio_ws:
            return False
        stream_sid = None
        for s_sid, c_id in self.stream_to_call.items():
            if c_id == canonical or c_id == call_id or self.resolve_canonical(c_id) == canonical:
                stream_sid = s_sid
                break
        if not stream_sid and self.stream_to_call:
            stream_sid = next(iter(self.stream_to_call.keys()))
        if not stream_sid:
            return False
        event_key = f"{canonical}:{mark_name}"
        ev = asyncio.Event()
        self._mark_events[event_key] = ev
        try:
            await twilio_ws.send_text(json.dumps({
                "event": "mark",
                "streamSid": stream_sid,
                "mark": {"name": mark_name}
            }))
            logger.info(f"[AudioHub] Sent Twilio mark '{mark_name}' for call {call_id} (streamSid={stream_sid})")
            return True
        except Exception as e:
            logger.warning(f"[AudioHub] Error sending Twilio mark event: {e}")
            return False

    def notify_mark(self, stream_sid: str, mark_name: str):
        """Called when Twilio echoes back a mark event after playing all buffered audio."""
        call_id = self.stream_to_call.get(stream_sid, "")
        canonical = self.resolve_canonical(call_id)
        for key in (f"{canonical}:{mark_name}", f"{call_id}:{mark_name}"):
            ev = self._mark_events.get(key)
            if ev:
                ev.set()
                logger.info(f"[AudioHub] Received Twilio mark '{mark_name}' completion for call {canonical}!")

    async def wait_for_mark(self, call_id: str, mark_name: str, timeout: float = 6.0) -> bool:
        """Waits for Twilio to finish playing all buffered audio up to the given mark."""
        canonical = self.resolve_canonical(call_id)
        event_key = f"{canonical}:{mark_name}"
        ev = self._mark_events.get(event_key)
        if not ev:
            return False
        try:
            await asyncio.wait_for(ev.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            logger.info(f"[AudioHub] Mark wait timed out ({timeout}s) for {mark_name} on {canonical}")
            return False
        finally:
            self._mark_events.pop(event_key, None)

media_stream_hub = MediaStreamHub()

router = APIRouter(tags=["Media Streams"])

@router.websocket("/ws/media-stream")
async def twilio_media_stream_endpoint(websocket: WebSocket):
    """
    Twilio Media Stream WebSocket endpoint.
    Receives raw 8kHz mu-law audio packets from Twilio for both tracks:
    - inbound: prospect/client voice
    - outbound: AI voice
    """
    await websocket.accept()
    stream_sid = None
    call_id = None
    call_sid = None
    logger.info("[TwilioStream] ✓✓✓ MEDIA STREAM CONNECTED - WebSocket accepted at /ws/media-stream")

    try:
        while True:
            raw_text = await websocket.receive_text()
            data = json.loads(raw_text)
            event_type = data.get("event")

            if event_type in ("connected", "start", "stream.started"):
                if event_type == "connected":
                    continue
                start_info = data.get("start", {}) or {}
                stream_sid = (
                    start_info.get("streamSid")
                    or data.get("streamSid")
                    or data.get("stream_id")
                    or start_info.get("stream_id")
                )
                call_sid = start_info.get("callSid") or start_info.get("call_control_id")
                custom_params = start_info.get("customParameters") or {}
                if not isinstance(custom_params, dict):
                    custom_params = {}
                client_state = start_info.get("client_state") or data.get("client_state")
                if client_state and not custom_params.get("internalCallId"):
                    try:
                        custom_params["internalCallId"] = base64.b64decode(client_state).decode("utf-8")
                    except Exception:
                        custom_params["internalCallId"] = str(client_state)
                call_id = custom_params.get("internalCallId") or call_sid
                protocol = "telnyx" if (start_info.get("call_control_id") or data.get("stream_id")) and not start_info.get("streamSid") else "twilio"
                if stream_sid:
                    media_stream_hub.stream_to_call[stream_sid] = call_id
                if call_sid:
                    media_stream_hub.call_sid_to_call[call_sid] = call_id
                    media_stream_hub.register_alias(call_sid, call_id)
                if call_id:
                    media_stream_hub.twilio_streams[call_id] = websocket
                    media_stream_hub.stream_protocol[call_id] = protocol
                logger.info(f"[MediaStream] Stream started ({protocol}): streamSid={stream_sid}, callSid={call_sid} -> call_id={call_id}")
                try:
                    from app.services.xai_voice_service import get_bridged_session
                    sess = get_bridged_session(call_id, call_sid)
                    if sess:
                        await sess.attach_stream(stream_sid)
                except Exception as bridge_err:
                    logger.warning(f"[TwilioStream] Bridge attach failed: {bridge_err}")

            elif event_type == "media":
                media_info = data.get("media", {})
                payload = media_info.get("payload")
                track = media_info.get("track", "inbound")  # "inbound" or "outbound"
                chunk_call_id = call_id or media_stream_hub.stream_to_call.get(stream_sid)

                if chunk_call_id and payload:
                    if track != "outbound":
                        try:
                            from app.services.xai_voice_service import get_bridged_session
                            # Try both the direct ID and the canonical resolved ID
                            canonical_id = media_stream_hub.resolve_canonical(chunk_call_id)
                            sess = get_bridged_session(chunk_call_id, canonical_id, call_sid, stream_sid)
                            if sess:
                                await sess.push_caller_audio(payload)
                                logger.debug(f"[MediaStream] Pushed inbound audio ({len(payload)} bytes) to xAI session {sess.call_id}")
                            else:
                                logger.warning(f"[MediaStream] ❌ No xAI session found for call IDs: {chunk_call_id}, canonical: {canonical_id}, callSid: {call_sid} — inbound audio NOT forwarded to xAI")
                        except Exception as push_err:
                            logger.warning(f"[MediaStream] Failed to push caller audio: {push_err}")
                    await media_stream_hub.broadcast_to_listeners(chunk_call_id, {
                        "type": "audio_chunk",
                        "callId": chunk_call_id,
                        "track": track,
                        "payload": payload,
                    })

            elif event_type == "mark":
                mark_info = data.get("mark", {})
                mark_name = mark_info.get("name") if isinstance(mark_info, dict) else str(mark_info or "")
                if mark_name and stream_sid:
                    media_stream_hub.notify_mark(stream_sid, mark_name)

            elif event_type == "stop":
                logger.info(f"[TwilioStream] Stream stopped: streamSid={stream_sid}, call_id={call_id}")
                try:
                    from app.services.xai_voice_service import get_bridged_session
                    sess = get_bridged_session(call_id, call_sid)
                    if sess:
                        await sess.close()
                    await _hangup_if_call_still_live(call_id, call_sid)
                except Exception as hang_err:
                    logger.warning(f"[TwilioStream] stream stop handler error: {hang_err}")
                break

    except WebSocketDisconnect:
        logger.info(f"[TwilioStream] Twilio stream disconnected: {stream_sid}")
        try:
            from app.services.xai_voice_service import get_bridged_session
            sess = get_bridged_session(call_id, call_sid)
            if sess:
                await sess.close()
            await _hangup_if_call_still_live(call_id, call_sid)
        except Exception as disc_err:
            logger.warning(f"[TwilioStream] disconnect cleanup error: {disc_err}")
    except Exception as exc:
        logger.warning(f"[TwilioStream] Stream error: {exc}")
    finally:
        if call_id:
            try:
                from app.services.xai_voice_service import get_bridged_session
                sess = get_bridged_session(call_id, call_sid)
                if sess:
                    await sess.close()
            except Exception:
                pass
        if call_id and call_id in media_stream_hub.twilio_streams:
            del media_stream_hub.twilio_streams[call_id]
        if call_id and call_id in media_stream_hub.stream_protocol:
            del media_stream_hub.stream_protocol[call_id]
        if stream_sid and stream_sid in media_stream_hub.stream_to_call:
            del media_stream_hub.stream_to_call[stream_sid]


async def _hangup_if_call_still_live(call_id: Optional[str], call_sid: Optional[str] = None) -> None:
    """If LiveCall still open when media WS dies, complete the Twilio leg so MicroSIP drops."""
    if not call_id and not call_sid:
        return
    from sqlalchemy.future import select
    from app.database import AsyncSessionLocal
    from app.models.models import LiveCall
    from app.services.outbound_dial import _resolve_carrier_and_creds
    from app.services.telephony_provider import carrier_registry
    import re

    async with AsyncSessionLocal() as db:
        call = None
        for key in (call_id, call_sid):
            if not key:
                continue
            res = await db.execute(select(LiveCall).where(LiveCall.id == key))
            call = res.scalars().first()
            if not call:
                res = await db.execute(select(LiveCall).where(LiveCall.carrier_sid == key))
                call = res.scalars().first()
            if call:
                break
        if not call or call.ended:
            return
        sid = call.carrier_sid or call_sid
        if not sid:
            for line in call.transcript or []:
                m = re.search(r"\b(CA[0-9a-fA-F]{32})\b", str(line))
                if m:
                    sid = m.group(1)
                    break
        if not sid:
            logger.warning(f"[TwilioStream] live call {call.id} has no carrier SID — cannot auto-hangup")
            return
        try:
            carrier_choice, credentials, _ = await _resolve_carrier_and_creds(db, "twilio", None, None)
            adapter = carrier_registry.get_adapter(carrier_choice or "twilio")
            hung = await adapter.hangup_call(sid, credentials=credentials)
            logger.info(f"[TwilioStream] auto-hangup {sid} for {call.id} → hungUp={hung}")
            if hung:
                call.ended = True
                call.state = "ended"
                await db.commit()
        except Exception as err:
            logger.warning(f"[TwilioStream] auto-hangup error: {err}")


@router.websocket("/ws/listen/{call_id}")
async def supervisor_listen_endpoint(websocket: WebSocket, call_id: str):
    """
    Supervisor listening & takeover WebSocket endpoint.
    Sends real-time audio chunks to the browser when the user clicks 'Listen'.
    Receives operator microphone audio from the browser when 'Take Over' is active.
    """
    await websocket.accept()
    media_stream_hub.register_listener(call_id, websocket)

    try:
        # Acknowledge connection
        await websocket.send_text(json.dumps({
            "type": "listen_ready",
            "callId": call_id,
            "sampleRate": 8000,
            "format": "audio/x-mulaw"
        }))

        while True:
            client_msg = await websocket.receive_text()
            data = json.loads(client_msg)
            msg_type = data.get("type")

            # Supervisor speaking during takeover
            if msg_type == "takeover_audio":
                audio_payload = data.get("payload")
                if audio_payload:
                    await media_stream_hub.inject_operator_audio_to_twilio(call_id, audio_payload)

            elif msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

    except WebSocketDisconnect:
        pass
    except Exception as err:
        logger.warning(f"[SupervisorListen] Error: {err}")
    finally:
        media_stream_hub.unregister_listener(call_id, websocket)
