"""Turning a finished call recording into text: who said what, in time order.

Used for calls a person makes from the browser. The recording has two channels (the user on one,
the other person on the other), so each side is transcribed alone and no one has to guess who spoke.
The speech-to-text key is the platform's (Platform Keys > Deepgram); clients never see it.
"""
from __future__ import annotations

import logging
import mimetypes
from typing import Any, Dict, List

import httpx

logger = logging.getLogger("transcribe")

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
TIMEOUT_S = 300.0
YOU, THEM = "you", "them"


class TranscribeError(Exception):
    pass


def lines_from_deepgram(body: Dict[str, Any]) -> List[Dict[str, Any]]:
    """[{who, start, text}] in time order from a Deepgram pre-recorded answer (channel 0 = you, 1 = them)."""
    results = (body or {}).get("results") or {}
    out: List[Dict[str, Any]] = []
    for u in results.get("utterances") or []:
        text = str(u.get("transcript") or "").strip()
        if text:
            out.append({"who": YOU if int(u.get("channel") or 0) == 0 else THEM, "start": float(u.get("start") or 0), "text": text})
    if not out:  # no utterances: the whole text of each channel
        for i, ch in enumerate(results.get("channels") or []):
            alts = ch.get("alternatives") or []
            text = str((alts[0] if alts else {}).get("transcript") or "").strip()
            if text:
                out.append({"who": YOU if i == 0 else THEM, "start": 0.0, "text": text})
    out.sort(key=lambda l: l["start"])
    return out


async def transcribe(path: str) -> List[Dict[str, Any]]:
    """Speech-to-text for one recording file. Raises TranscribeError with a plain reason."""
    from app.services.platform_balances import _platform_key

    key = await _platform_key("deepgram")
    if not key:
        raise TranscribeError("Transcripts are not switched on yet. The Outreach team is setting this up.")
    ctype = mimetypes.guess_type(path)[0] or "audio/webm"
    try:
        with open(path, "rb") as fh:
            audio = fh.read()
    except OSError:
        raise TranscribeError("The recording is no longer there.")
    if not audio:
        raise TranscribeError("The recording is empty.")
    params = {"model": "nova-2", "punctuate": "true", "utterances": "true", "multichannel": "true", "language": "en"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            r = await client.post(DEEPGRAM_URL, params=params, content=audio, headers={"Authorization": f"Token {key}", "Content-Type": ctype})
    except httpx.HTTPError as err:
        logger.warning(f"[transcribe] request failed: {err}")
        raise TranscribeError("The transcript could not be made just now. Try again in a minute.")
    if r.status_code >= 400:
        logger.warning(f"[transcribe] engine answered {r.status_code}: {r.text[:200]}")
        raise TranscribeError("The transcript could not be made just now. Try again in a minute.")
    return lines_from_deepgram(r.json())
