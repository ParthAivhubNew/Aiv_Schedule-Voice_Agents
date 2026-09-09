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
from app.services.llm_gateway import call_open_chat_llm

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
    message: Optional[str] = ""
    messages: Optional[List[Dict[str, str]]] = None
    history: Optional[List[Dict[str, str]]] = []
    target_role: Optional[str] = "VP of Operations, CEO, Decision-Maker"
    plugin: Optional[str] = "leadgen"
    api_key: Optional[str] = None
    apiKey: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None
    baseUrl: Optional[str] = None

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
                    p.note = data["overview"]
                await db.commit()
                
        return {"success": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/discover-accounts")
async def discover_accounts(req: DiscoverAccountsRequest):
    """
    Scours live web and search queries to discover new target accounts.
    """
    try:
        leads = await discover_new_target_accounts(
            query_or_domain=req.query,
            target_role=req.target_role
        )
        return {
            "success": True,
            "query": req.query,
            "count": len(leads),
            "leads": leads
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/copilot-chat")
@router.post("/open-chat")
async def copilot_chat(req: CopilotChatRequest, db: AsyncSession = Depends(get_db)):
    """
    Universal, unrestricted open AI chat copilot:
    Powered by the user's configured LLM (OpenAI, DeepSeek, Anthropic, Groq, xAI, Ollama, etc.).
    Answers ANY question, discusses strategies, provides prompt/lead engineering,
    and returns structured leads when prospecting requests are made.
    """
    try:
        # Build conversational messages list
        chat_msgs: List[Dict[str, str]] = []
        if req.messages and len(req.messages) > 0:
            chat_msgs = req.messages
        else:
            for h in (req.history or []):
                chat_msgs.append({
                    "role": h.get("sender", h.get("role", "user")),
                    "content": h.get("text", h.get("content", ""))
                })
            latest_msg = (req.message or "").strip()
            if latest_msg:
                chat_msgs.append({"role": "user", "content": latest_msg})

        user_text = ""
        for m in reversed(chat_msgs):
            if m.get("role") in ["user", "human"]:
                user_text = m.get("content", "")
                break

        key = req.api_key or req.apiKey
        burl = req.base_url or req.baseUrl
        prov = req.provider
        mod = req.model

        # Check if query requests lead discovery or company prospecting
        lower_t = user_text.lower()
        is_lead_search = any(k in lower_t for k in [
            "find", "search", "discover", "get me", "look up", "locate", "companies", "leads", "prospects"
        ]) and any(k in lower_t for k in [
            "companies", "leads", "fleet", "logistics", "freight", "saas", "agency", "hospital",
            "manufactur", "clinic", "business", "firms", "shops", "stores", "suppliers"
        ])

        discovered_leads = []
        if is_lead_search:
            try:
                discovered_leads = await discover_new_target_accounts(
                    query_or_domain=user_text,
                    target_role=req.target_role or "VP of Operations, CEO, Decision-Maker"
                )
            except Exception as search_err:
                pass

        # Prepare system prompt tailored to plugin context, but fully open
        plugin_type = (req.plugin or "leadgen").lower()
        if plugin_type == "email":
            system_prompt = (
                "You are an elite B2B Email Outreach Strategist & AI Copilot in AIVHub. "
                "You help users craft high-converting cold email sequences, refine subject lines, "
                "handle objections, and analyze inbound email replies. You are also an unrestricted AI "
                "assistant ready to answer any general, technical, or strategic question thoroughly."
            )
        elif plugin_type == "scheduler":
            system_prompt = (
                "You are an elite Social Media & Content Strategist AI Copilot in AIVHub. "
                "You help users ideate viral social posts, plan multi-platform calendars, "
                "develop creative concepts, and write engaging hooks. You are also an unrestricted AI "
                "assistant ready to discuss any topic, concept, or strategy in detail."
            )
        else:
            system_prompt = (
                "You are an elite Autonomous AI Copilot & Lead Engineering Strategist for AIVHub. "
                "You specialize in outbound prospecting, decision-maker discovery, cold call scripting, "
                "account research, and conversational sales intelligence. You are also a completely open, "
                "unrestricted AI assistant ready to discuss any topic, answer questions, provide coding "
                "or architectural advice, and help the user succeed."
            )

        if discovered_leads:
            system_prompt += (
                f"\n\nNote: The user just searched for prospects. We retrieved {len(discovered_leads)} live candidates "
                f"from the web (e.g. {', '.join([l.get('name', '') for l in discovered_leads[:3]])}). "
                f"Acknowledge the findings, provide tactical advice on how to approach these accounts, "
                f"and invite the user to refine criteria or ask any follow-up questions."
            )

        # Call the real LLM gateway with user's credentials
        llm_response = await call_open_chat_llm(
            messages=chat_msgs,
            system_prompt=system_prompt,
            api_key=key,
            provider=prov,
            model=mod,
            base_url=burl,
            temperature=0.7,
            db=db
        )

        reply_text = llm_response.get("reply", "")
        if not reply_text:
            reply_text = "I received your message. How can I further assist your outreach or strategy?"

        return {
            "success": True,
            "reply": reply_text,
            "leads": discovered_leads,
            "model": llm_response.get("model", mod),
            "provider": llm_response.get("provider", prov)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
