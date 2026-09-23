"""
Call Audio Recorder Service
Captures dual-track (inbound caller + outbound AI) audio streams in real-time.
Synchronizes and mixes into standard 16-bit PCM WAV audio files saved under backend/recordings/{call_id}.wav.
"""

import os
import time
import base64
import struct
import wave
import asyncio
from typing import Dict, List, Tuple, Optional
from loguru import logger

def _build_mulaw_table():
    table = []
    for i in range(256):
        b = ~i & 0xFF
        sign = -1 if (b & 0x80) else 1
        exp = (b >> 4) & 0x07
        mant = b & 0x0F
        sample = sign * (((mant << 3) + 0x84) << exp) - (sign * 0x84)
        clamped = max(-32768, min(32767, sample))
        table.append(struct.pack("<h", clamped))
    return table

MULAW_DECODE_TABLE = _build_mulaw_table()

def decode_mulaw_to_pcm16(raw_bytes: bytes) -> bytes:
    """Decodes 8kHz 8-bit PCMU (mu-law) bytes into 16-bit linear PCM."""
    return b"".join(MULAW_DECODE_TABLE[b] for b in raw_bytes)

RECORDINGS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "recordings")
os.makedirs(RECORDINGS_DIR, exist_ok=True)


class CallAudioRecorder:
    """Records synchronized dual-track audio for a single active phone call."""

    def __init__(self, call_id: str):
        self.call_id = call_id
        self.start_time: float = time.time()
        self.inbound_timeline: List[Tuple[float, bytes]] = []   # (offset_sec, pcm16_bytes)
        self.outbound_timeline: List[Tuple[float, bytes]] = []  # (offset_sec, pcm16_bytes)
        self.is_finalized = False
        self._lock = asyncio.Lock()

    def add_chunk(self, track: str, base64_payload: str):
        """Buffers an audio chunk with relative timestamp."""
        if self.is_finalized or not base64_payload:
            return
        try:
            raw = base64.b64decode(base64_payload)
            if not raw:
                return
            pcm16 = decode_mulaw_to_pcm16(raw)
            offset = max(0.0, time.time() - self.start_time)
            if track == "inbound":
                self.inbound_timeline.append((offset, pcm16))
            else:
                self.outbound_timeline.append((offset, pcm16))
        except Exception as e:
            logger.debug(f"[Recorder] Error decoding audio chunk for {self.call_id}: {e}")

    def finalize(self) -> Optional[str]:
        """Renders the synchronized timeline into a WAV audio file."""
        if self.is_finalized:
            return self.get_file_path() if os.path.exists(self.get_file_path()) else None
        self.is_finalized = True

        if not self.inbound_timeline and not self.outbound_timeline:
            logger.info(f"[Recorder] No audio frames captured for call {self.call_id}. Skipping file write.")
            return None

        SAMPLE_RATE = 8000
        BYTES_PER_SEC = SAMPLE_RATE * 2

        max_in_end = 0.0
        if self.inbound_timeline:
            last_off, last_pcm = self.inbound_timeline[-1]
            max_in_end = last_off + (len(last_pcm) / BYTES_PER_SEC)

        max_out_end = 0.0
        if self.outbound_timeline:
            last_off, last_pcm = self.outbound_timeline[-1]
            max_out_end = last_off + (len(last_pcm) / BYTES_PER_SEC)

        total_duration = max(max_in_end, max_out_end, 0.5)
        total_samples = int(total_duration * SAMPLE_RATE) + 800

        in_samples = [0] * total_samples
        out_samples = [0] * total_samples

        for off_sec, pcm16 in self.inbound_timeline:
            start_idx = int(off_sec * SAMPLE_RATE)
            count = len(pcm16) // 2
            if count > 0 and start_idx < total_samples:
                fmt = f"<{count}h"
                samples = struct.unpack(fmt, pcm16[:count * 2])
                end_idx = min(total_samples, start_idx + count)
                for i in range(start_idx, end_idx):
                    in_samples[i] = max(-32768, min(32767, in_samples[i] + samples[i - start_idx]))

        for off_sec, pcm16 in self.outbound_timeline:
            start_idx = int(off_sec * SAMPLE_RATE)
            count = len(pcm16) // 2
            if count > 0 and start_idx < total_samples:
                fmt = f"<{count}h"
                samples = struct.unpack(fmt, pcm16[:count * 2])
                end_idx = min(total_samples, start_idx + count)
                for i in range(start_idx, end_idx):
                    out_samples[i] = max(-32768, min(32767, out_samples[i] + samples[i - start_idx]))

        interleaved_bytes = bytearray(total_samples * 4)
        for i in range(total_samples):
            struct.pack_into("<hh", interleaved_bytes, i * 4, in_samples[i], out_samples[i])

        out_path = self.get_file_path()
        try:
            with wave.open(out_path, "wb") as wf:
                wf.setnchannels(2)
                wf.setsampwidth(2)
                wf.setframerate(SAMPLE_RATE)
                wf.writeframes(interleaved_bytes)

            file_size_kb = round(os.path.getsize(out_path) / 1024, 1)
            duration_sec = round(total_duration, 1)
            logger.info(f"[Recorder] Saved dual-track call recording for {self.call_id} -> {out_path} ({duration_sec}s, {file_size_kb} KB)")
            return out_path
        except Exception as err:
            logger.error(f"[Recorder] Failed to write WAV recording for {self.call_id}: {err}")
            return None

    def get_file_path(self) -> str:
        safe_id = "".join(c for c in self.call_id if c.isalnum() or c in ("-", "_"))
        return os.path.join(RECORDINGS_DIR, f"{safe_id}.wav")


class RecorderManager:
    """Manages active call recorders across all concurrent calls."""

    def __init__(self):
        self.recorders: Dict[str, CallAudioRecorder] = {}

    def get_or_create(self, call_id: str) -> CallAudioRecorder:
        if call_id not in self.recorders:
            self.recorders[call_id] = CallAudioRecorder(call_id)
        return self.recorders[call_id]

    def record_chunk(self, call_id: str, track: str, base64_payload: str):
        if not call_id:
            return
        rec = self.get_or_create(call_id)
        rec.add_chunk(track, base64_payload)

    def finish_recording(self, call_id: str) -> Optional[str]:
        if not call_id:
            return None
        rec = self.recorders.pop(call_id, None)
        if rec:
            return rec.finalize()
        return None

    def get_recording_path(self, call_id: str) -> Optional[str]:
        if not call_id:
            return None
        safe_id = "".join(c for c in call_id if c.isalnum() or c in ("-", "_"))
        if not safe_id:
            return None

        candidates = [safe_id]
        if safe_id.startswith("cl_"):
            candidates.append("call_" + safe_id[3:])
            candidates.append(safe_id[3:])
        if safe_id.startswith("cl_lk_"):
            candidates.append("call_" + safe_id[6:])
            candidates.append("lk_" + safe_id[6:])
            candidates.append(safe_id[6:])
        if safe_id.startswith("call_"):
            candidates.append("cl_" + safe_id[5:])
            candidates.append(safe_id[5:])

        for c in candidates:
            path = os.path.join(RECORDINGS_DIR, f"{c}.wav")
            if os.path.exists(path):
                return path

        # Core ID substring search in recordings dir
        core_id = safe_id.replace("cl_lk_", "").replace("cl_", "").replace("call_", "")
        if len(core_id) >= 6 and os.path.exists(RECORDINGS_DIR):
            try:
                for f in os.listdir(RECORDINGS_DIR):
                    if f.endswith(".wav") and core_id in f:
                        return os.path.join(RECORDINGS_DIR, f)
            except Exception:
                pass

        return None


recorder_manager = RecorderManager()
