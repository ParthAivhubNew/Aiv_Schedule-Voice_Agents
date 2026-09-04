from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete
from app.database import get_db
from app.models.models import Connection, Mission, CallLog, Meeting, Prospect
from app.schemas.schemas import ConnectionSchema
from app.services.key_validator import validate_api_key
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
import uuid

router = APIRouter(prefix="/connections", tags=["Connections & Providers"])

class TestKeyRequest(BaseModel):
    layer: str
    provider: str
    api_key: str
    base_url: Optional[str] = None
    account_sid: Optional[str] = None

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
    validation = await validate_api_key(
        provider=req.provider,
        api_key=req.api_key,
        base_url=req.base_url,
        account_sid=req.account_sid
    )
    if not validation["valid"]:
        raise HTTPException(
            status_code=400,
            detail=validation.get("error", f"Authentication failed for {req.provider}.")
        )
    return {
        "success": True,
        "details": validation.get("details", "Verified & Active")
    }

@router.post("/test-and-save")
async def test_and_save_connection(req: TestKeyRequest, db: AsyncSession = Depends(get_db)):
    """
    Performs a live validation test against the provider API before saving.
    Rejects the request if credentials fail authentication.
    """
    # 1. Live Validation Probe
    validation = await validate_api_key(
        provider=req.provider,
        api_key=req.api_key,
        base_url=req.base_url,
        account_sid=req.account_sid
    )
    
    if not validation["valid"]:
        raise HTTPException(
            status_code=400,
            detail=validation.get("error", f"Authentication failed for {req.provider}.")
        )
    
    # 2. Mask the key for safe storage
    clean_key = req.api_key.strip()
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
