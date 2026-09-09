import asyncio
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
        for cid in [call_id, canonical]:
            if cid in self.call_listeners and ws in self.call_listeners[cid]:
                self.call_listeners[cid].remove(ws)
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

        # Find matching streamSid
        stream_sid = None
        for s_sid, c_id in self.stream_to_call.items():
            if c_id == canonical or c_id == call_id or self.resolve_canonical(c_id) == canonical:
                stream_sid = s_sid
                break

        if not stream_sid and self.stream_to_call:
            # Fallback to the latest active streamSid
            stream_sid = next(iter(self.stream_to_call.keys()))

        if not stream_sid:
            logger.warning(f"[AudioHub] No streamSid found for Twilio stream on call {call_id}")
            return

        try:
            packet = {
                "event": "media",
                "streamSid": stream_sid,
                "media": {
                    "payload": base64_payload
                }
            }
            await twilio_ws.send_text(json.dumps(packet))
            self._injection_counter += 1
            if self._injection_counter % 50 == 1:
                logger.info(f"[AudioHub] Injected operator mic audio packet #{self._injection_counter} to Twilio (streamSid={stream_sid}, payloadLen={len(base64_payload)})")
        except Exception as e:
            logger.warning(f"[AudioHub] Error injecting operator audio to Twilio: {e}")

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
    logger.info("[TwilioStream] Twilio connected to /ws/media-stream")

    try:
        while True:
            raw_text = await websocket.receive_text()
            data = json.loads(raw_text)
            event_type = data.get("event")

            if event_type == "start":
                start_info = data.get("start", {})
                stream_sid = start_info.get("streamSid")
                call_sid = start_info.get("callSid")
                custom_params = start_info.get("customParameters", {})
                call_id = custom_params.get("internalCallId") or call_sid

                media_stream_hub.stream_to_call[stream_sid] = call_id
                if call_sid:
                    media_stream_hub.call_sid_to_call[call_sid] = call_id
                    media_stream_hub.register_alias(call_sid, call_id)
                media_stream_hub.twilio_streams[call_id] = websocket
                logger.info(f"[TwilioStream] Stream started: streamSid={stream_sid}, callSid={call_sid} -> call_id={call_id}")

            elif event_type == "media":
                media_info = data.get("media", {})
                payload = media_info.get("payload")
                track = media_info.get("track", "inbound")  # "inbound" or "outbound"
                chunk_call_id = call_id or media_stream_hub.stream_to_call.get(stream_sid)

                if chunk_call_id and payload:
                    await media_stream_hub.broadcast_to_listeners(chunk_call_id, {
                        "type": "audio_chunk",
                        "callId": chunk_call_id,
                        "track": track,
                        "payload": payload
                    })

            elif event_type == "stop":
                logger.info(f"[TwilioStream] Stream stopped: streamSid={stream_sid}, call_id={call_id}")
                break

    except WebSocketDisconnect:
        logger.info(f"[TwilioStream] Twilio stream disconnected: {stream_sid}")
    except Exception as exc:
        logger.warning(f"[TwilioStream] Stream error: {exc}")
    finally:
        if call_id and call_id in media_stream_hub.twilio_streams:
            del media_stream_hub.twilio_streams[call_id]
        if stream_sid and stream_sid in media_stream_hub.stream_to_call:
            del media_stream_hub.stream_to_call[stream_sid]


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
