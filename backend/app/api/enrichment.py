import logging
import asyncio
import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

logger = logging.getLogger(__name__)

from app.database import get_db
from app.models.models import Prospect, ContactRegistry
from app.services.enrichment_service import (
    enrich_prospect_intelligence,
    discover_new_target_accounts,
    fill_contact_gaps,
    _row_missing_fields,
)
from app.services.llm_gateway import call_open_chat_llm

router = APIRouter(prefix="/enrichment", tags=["AI Lead Radar & Enrichment"])

# Explicit gap-fill phrases only. Bare words like "research" / "missing" / "ok"
# must not kick off enrichment during strategy chat.
_FILL_PHRASES = (
    "fill the gap", "fill gaps", "fill missing", "fill in missing",
    "fill contact", "enrich contact", "enrich the list", "enrich these",
    "enrich this list", "enrich the contact", "look up phone", "lookup phone",
    "look up email", "lookup email", "find the phone", "find phone",
    "find email", "find the email", "find their phone", "find their email",
    "get phone", "get the phone", "get email", "get the number",
    "get their number", "missing phone", "missing email", "missing contact",
    "missing number", "no phone", "no email", "don't have a phone",
    "dont have a phone", "don't have phone", "dont have phone",
    "don't have an email", "dont have an email", "number for",
    "who is the contact", "who is the decision", "complete the list",
    "remaining contacts", "remaining rows", "find missing", "get missing",
    "research the contact", "research these companies", "research this list",
    "research the list", "look up these", "lookup these", "find numbers",
    "find contact", "get the missing", "fill the missing",
)
_FILL_CONFIRM = {"yes", "yes please", "do it", "go ahead", "ok", "okay", "please"}
_ASSISTANT_FILL_HINTS = (
    "fill", "enrich", "look up", "lookup", "missing phone", "missing email",
    "want me to", "shall i", "should i find", "accept each", "proposed fill",
    "gap-fill", "gap fill",
)


def _detect_fill_intent(user_text: str) -> bool:
    t = (user_text or "").strip().lower()
    if not t:
        return False
    return any(p in t for p in _FILL_PHRASES)


def _assistant_offered_fill(chat_msgs: List[Dict[str, str]]) -> bool:
    prior = chat_msgs[:-1] if chat_msgs else []
    for m in reversed(prior):
        role = (m.get("role") or "").lower()
        content = (m.get("content") or m.get("text") or "").lower()
        if role in ("assistant", "ai", "bot"):
            return any(
                re.search(r"(?<![a-z])" + re.escape(k) + r"(?![a-z])", content)
                for k in _ASSISTANT_FILL_HINTS
            )
        if role in ("user", "human"):
            return False
    return False


def _mentioned_incomplete_rows(text: str, incomplete: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    t = (text or "").lower()
    hits = []
    for row in incomplete:
        name = str(row.get("name") or row.get("company") or "").strip()
        if len(name) < 3:
            continue
        if re.search(r"(?<![a-z0-9])" + re.escape(name.lower()) + r"(?![a-z0-9])", t):
            hits.append(row)
    return hits

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
    contacts: Optional[List[Dict[str, Any]]] = None
    channel: Optional[str] = "voice"


class FillGapsRequest(BaseModel):
    contacts: List[Dict[str, Any]]
    max_rows: Optional[int] = 50

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


@router.post("/fill-gaps")
async def fill_gaps(req: FillGapsRequest):
    """Fill missing phone/email/person on an uploaded contact list. Does not invent numbers."""
    n = min(max(int(req.max_rows or 4), 1), 8)
    try:
        fills = await fill_contact_gaps(req.contacts or [], max_rows=n)
        proposed = [f for f in fills if f.get("status") == "proposed"]
        empty = [f for f in fills if f.get("status") == "unenrichable"]
        return {
            "success": True,
            "fills": fills,
            "proposedCount": len(proposed),
            "unenrichableCount": len(empty),
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
        plugin_type = (req.plugin or "leadgen").lower()
        lower_t = user_text.lower()
        contacts = req.contacts or []

        incomplete = []
        for row in contacts:
            name = str(row.get("name") or row.get("company") or "").strip()
            if name and _row_missing_fields(row):
                incomplete.append(row)

        fill_intent = _detect_fill_intent(user_text) or (
            lower_t.strip() in _FILL_CONFIRM and _assistant_offered_fill(chat_msgs)
        )
        mentioned_rows = _mentioned_incomplete_rows(user_text, incomplete)

        fills: List[Dict[str, Any]] = []
        # Only run gap-fill on explicit intent. A company name in chat is not enough.
        # If the user named companies, enrich those rows only — not the whole list.
        if plugin_type in ("voice", "leadgen") and incomplete and fill_intent:
            targets = mentioned_rows if mentioned_rows else incomplete
            try:
                fills = await fill_contact_gaps(targets, max_rows=min(8, len(targets)))
            except Exception:
                fills = []

        # Check if query requests lead discovery or company prospecting
        is_lead_search = (not fills) and any(k in lower_t for k in [
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
            except Exception:
                pass

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
        elif plugin_type == "voice":
            system_prompt = (
                "You are AIVHub Voice SDR copilot. The operator loaded a contact list that may be incomplete. "
                "Your job is to help fill missing phone numbers, emails, and decision-maker names from public web research. "
                "Never invent a phone number or email. If a field was not found, say so. "
                "After proposing fills, tell the operator to Accept each suggestion before dialing. "
                "WhatsApp/SMS/email in this mission are no-answer fallbacks after voice, not Cal.com. "
                "Cal.com is only used after a meeting is booked."
            )
        else:
            system_prompt = (
                "You are an elite Autonomous AI Copilot & Lead Engineering Strategist for AIVHub. "
                "You specialize in outbound prospecting, decision-maker discovery, cold call scripting, "
                "account research, and conversational sales intelligence. You are also a completely open, "
                "unrestricted AI assistant ready to discuss any topic, answer questions, provide coding "
                "or architectural advice, and help the user succeed."
            )

        if contacts:
            gap_lines = []
            for row in contacts[:20]:
                name = str(row.get("name") or "").strip() or "(unnamed)"
                miss = _row_missing_fields(row)
                gap_lines.append(
                    f"- id={row.get('id')} {name} | phone={row.get('phone') or 'MISSING'} | "
                    f"email={row.get('email') or 'MISSING'} | person={row.get('contact') or 'MISSING'}"
                    + (f" | gaps={','.join(miss)}" if miss else " | complete")
                )
            system_prompt += (
                f"\n\nLoaded contact list ({len(contacts)} rows, {len(incomplete)} incomplete):\n"
                + "\n".join(gap_lines)
            )

        if fills:
            proposed = [f for f in fills if f.get("status") == "proposed"]
            empty = [f for f in fills if f.get("status") == "unenrichable"]
            system_prompt += (
                f"\n\nWeb research just ran. {len(proposed)} rows have proposed fills "
                f"(operator must Accept). {len(empty)} rows had nothing public. "
                "Summarize clearly. Do not dump raw JSON."
            )

        if discovered_leads:
            system_prompt += (
                f"\n\nNote: The user just searched for prospects. We retrieved {len(discovered_leads)} live candidates "
                f"from the web (e.g. {', '.join([l.get('name', '') for l in discovered_leads[:3]])}). "
                f"Acknowledge the findings, provide tactical advice on how to approach these accounts, "
                f"and invite the user to refine criteria or ask any follow-up questions."
            )

        llm_response = {}
        try:
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
        except Exception as llm_err:
            logger.warning(f"Voice copilot LLM unavailable: {llm_err}")

        reply_text = llm_response.get("reply", "") if isinstance(llm_response, dict) else ""
        if not reply_text:
            if fills:
                proposed = [f for f in fills if f.get("status") == "proposed"]
                empty = [f for f in fills if f.get("status") == "unenrichable"]
                bits = []
                if proposed:
                    bits.append(f"Found public details for {len(proposed)} contact(s). Accept each card before they go on the list.")
                if empty:
                    bits.append(f"Could not verify {len(empty)} row(s) from public sources — leave them out of the dialer or add details by hand.")
                reply_text = " ".join(bits) or "Looked up the list. No new public details to apply."
            else:
                reply_text = "I received your message. How can I further assist your outreach or strategy?"

        return {
            "success": True,
            "reply": reply_text,
            "leads": discovered_leads,
            "fills": fills,
            "incompleteCount": len(incomplete),
            "model": llm_response.get("model", mod) if isinstance(llm_response, dict) else mod,
            "provider": llm_response.get("provider", prov) if isinstance(llm_response, dict) else prov
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
