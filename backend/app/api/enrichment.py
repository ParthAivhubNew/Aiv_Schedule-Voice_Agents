from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.models.models import Prospect, ContactRegistry
from app.services.enrichment_service import (
    enrich_prospect_intelligence,
    discover_new_target_accounts
)

router = APIRouter(prefix="/enrichment", tags=["AI Lead Radar & Enrichment"])

class EnrichRequest(BaseModel):
    name: str
    company: Optional[str] = None
    domain: Optional[str] = None
    prospect_id: Optional[str] = None

class DiscoverAccountsRequest(BaseModel):
    query: str
    target_role: Optional[str] = "VP of Operations, CEO, Decision-Maker"

class CopilotChatRequest(BaseModel):
    message: str
    history: Optional[List[Dict[str, str]]] = []
    target_role: Optional[str] = "VP of Operations, CEO, Decision-Maker"

@router.post("/enrich-prospect")
async def enrich_prospect(req: EnrichRequest, db: AsyncSession = Depends(get_db)):
    """
    Enriches an existing prospect or candidate with live web search results,
    phone numbers, email patterns, company overview, and personalized AI hook.
    """
    try:
        data = await enrich_prospect_intelligence(
            name=req.name,
            company=req.company,
            domain=req.domain
        )
        
        if req.prospect_id:
            res = await db.execute(select(Prospect).where(Prospect.id == req.prospect_id))
            p = res.scalars().first()
            if p:
                if data.get("primaryPhone") and not p.phone:
                    p.phone = data["primaryPhone"]
                if data.get("overview") and not p.note:
                    p.note = f"AI Enriched: {data['overview'][:180]}"
                await db.commit()

        return {"success": True, "dossier": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/discover-accounts")
async def discover_accounts(req: DiscoverAccountsRequest):
    """
    Discovers new target accounts and decision-maker candidates from a natural language query.
    """
    try:
        leads = await discover_new_target_accounts(
            query_or_domain=req.query,
            target_role=req.target_role
        )
        return {"success": True, "count": len(leads), "leads": leads}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/copilot-chat")
async def copilot_chat(req: CopilotChatRequest):
    """
    Interactive conversational lead intelligence copilot:
    Interprets natural conversational prompts, clarifies targeting criteria,
    scours live web, and returns structured prospect candidates.
    """
    try:
        msg = req.message.strip()
        # Search web for matching leads
        leads = await discover_new_target_accounts(
            query_or_domain=msg,
            target_role=req.target_role
        )
        
        reply = (
            f"I researched the live web for '{msg}'. "
            f"I found {len(leads)} target organizations with public contact information, "
            f"switchboard lines, and AI opening hooks. You can review them below and launch "
            f"an outreach batch with 1 click, or let me know if you want to refine location, industry, or titles!"
        )
        return {
            "success": True,
            "reply": reply,
            "leads": leads
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
