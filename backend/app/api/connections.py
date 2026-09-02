from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db
from app.models.models import Connection
from app.schemas.schemas import ConnectionSchema
from typing import Dict, Any, List
import uuid

router = APIRouter(prefix="/connections", tags=["Connections & Providers"])

@router.get("", response_model=list[dict])
async def list_connections(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Connection))
    conns = result.scalars().all()
    
    # Group by group_name
    grouped = {}
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
            "apiKeyMasked": c.api_key_masked
        })
        
    return list(grouped.values())

@router.post("", response_model=dict)
async def add_connection(req: ConnectionSchema, db: AsyncSession = Depends(get_db)):
    conn = Connection(
        id=f"conn_{uuid.uuid4().hex[:6]}",
        group_name=req.group_name,
        name=req.name,
        status="connected",
        api_key_masked="••••••••••••" + str(uuid.uuid4().hex[:4])
    )
    db.add(conn)
    await db.commit()
    return {"id": conn.id, "status": "connected"}
