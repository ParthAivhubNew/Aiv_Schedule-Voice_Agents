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
        # Active takeover state for calls
        self.active_takeovers: Set[str] = {}

    def register_listener(self, call_id: str, ws: WebSocket):
        if call_id not in self.call_listeners:
            self.call_listeners[call_id] = set()
        self.call_listeners[call_id].add(ws)
        logger.info(f"[AudioHub] Supervisor connected to listen to call {call_id}. Total listeners: {len(self.call_listeners[call_id])}")

    def unregister_listener(self, call_id: str, ws: WebSocket):
        if call_id in self.call_listeners and ws in self.call_listeners[call_id]:
            self.call_listeners[call_id].remove(ws)
            if not self.call_listeners[call_id]:
                del self.call_listeners[call_id]
            logger.info(f"[AudioHub] Supervisor disconnected from call {call_id}.")

    async def broadcast_to_listeners(self, call_id: str, payload_dict: dict):
        listeners = self.call_listeners.get(call_id, set())
        if not listeners:
            return
        msg = json.dumps(payload_dict)
        dead = []
        for ws in list(listeners):
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for d in dead:
            self.unregister_listener(call_id, d)

    async def inject_operator_audio_to_twilio(self, call_id: str, base64_payload: str):
        """Injects supervisor microphone audio into the live Twilio call."""
        twilio_ws = self.twilio_streams.get(call_id)
        if not twilio_ws:
            return
        stream_sid = None
        for s_sid, c_id in self.stream_to_call.items():
            if c_id == call_id:
                stream_sid = s_sid
                break
        if not stream_sid:
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
                media_stream_hub.call_sid_to_call[call_sid] = call_id
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
