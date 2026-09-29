"""Voice library API: the one place every screen reads and changes call voices."""
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services import voice_library
from app.services.voice_library import VoiceError

router = APIRouter(prefix="/voices", tags=["Voices"])


def _fail(err: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail=str(err))


@router.get("/library")
async def get_library(db: AsyncSession = Depends(get_db)):
    return await voice_library.library(db)


@router.post("")
async def add_voice(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    """Save a voice. useForCalls also makes it the call voice."""
    try:
        row = await voice_library.add_voice(
            db, str(payload.get("provider") or ""), payload.get("voiceId"), str(payload.get("label") or ""),
            origin=str(payload.get("origin") or "pasted") if payload.get("origin") in ("pasted", "imported") else "pasted",
            meta=payload.get("meta") if isinstance(payload.get("meta"), dict) else None,
        )
        await db.commit()
        if payload.get("useForCalls"):
            await voice_library.set_active(db, "library", row.id)
    except VoiceError as err:
        await db.rollback()
        raise _fail(err)
    return await voice_library.library(db)


@router.delete("/{voice_ref}")
async def remove_voice(voice_ref: str, db: AsyncSession = Depends(get_db)):
    try:
        await voice_library.remove_voice(db, voice_ref)
        await db.commit()
    except VoiceError as err:
        raise _fail(err)
    return await voice_library.library(db)


@router.post("/active")
async def set_active(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    """payload: {kind: "builtin" | "library", ref: built-in voice id or library voice id}"""
    try:
        await voice_library.set_active(db, str(payload.get("kind") or ""), str(payload.get("ref") or ""))
    except VoiceError as err:
        raise _fail(err)
    return await voice_library.library(db)


@router.get("/catalog/{provider}")
async def provider_catalog(provider: str, db: AsyncSession = Depends(get_db)):
    """Voices available at the provider, to add to the library."""
    try:
        return {"voices": await voice_library.catalog(db, provider)}
    except VoiceError as err:
        raise _fail(err)
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"Could not list {provider} voices: {str(err)[:200]}")
