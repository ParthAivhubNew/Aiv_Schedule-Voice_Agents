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
from app.services import business_records, lead_filters, phrase_understanding
from app.services.llm_gateway import call_open_chat_llm

router = APIRouter(prefix="/enrichment", tags=["AI Lead Radar & Enrichment"])

# A model sometimes claims it has no live web access even when a search already ran this turn --
# catches that so real results never get buried under a false disclaimer (see copilot_chat).
_NO_LIVE_ACCESS_CLAIM = re.compile(
    r"\bcan'?t (actually )?(browse|access|pull|fetch|hand you) .*(web|internet|live|current|real[- ]?time)|"
    r"\bcannot (browse|access) .*(web|internet)|"
    r"\bdon'?t have (live|real-time|direct) (web )?access|"
    r"\bno (live|real-time) (internet|web) access\b",
    re.I,
)


async def _can_research(db: AsyncSession) -> None:
    """Lead research uses Lead generation credits; refuse when they ran out (stop at zero)."""
    from app.services.credits import can_start

    ok, why = await can_start(db, "lead_lookup")
    if not ok:
        raise HTTPException(status_code=402, detail=why)


async def _can_deep_search(db: AsyncSession) -> None:
    """Deep web search (Google Places) uses its own Leads credit price; refuse when out."""
    from app.services.credits import can_start

    ok, why = await can_start(db, "google_deep_search")
    if not ok:
        raise HTTPException(status_code=402, detail=why)


async def _charge_leads(db: AsyncSession, count: int, what: str) -> None:
    """Charge leads researched, once each. Never fails the request."""
    import uuid

    from app.services.credits import charge

    if count <= 0:
        return
    try:
        await charge(db, "lead_lookup", count, f"lead:{uuid.uuid4().hex[:16]}", what)
        await db.commit()
    except Exception as err:
        logging.getLogger(__name__).warning(f"[credits] lead charge skipped: {err}")
        await db.rollback()


async def _charge_deep_search(db: AsyncSession, what: str) -> None:
    """Charge one Google Places lookup ("Deep web search" -- never named Google to the user).
    Never fails the request."""
    import uuid

    from app.services.credits import charge

    try:
        await charge(db, "google_deep_search", 1, f"deepsearch:{uuid.uuid4().hex[:16]}", what)
        await db.commit()
    except Exception as err:
        logging.getLogger(__name__).warning(f"[credits] deep search charge skipped: {err}")
        await db.rollback()

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
    target_role: Optional[str] = None  # only when the user names who to reach

class CopilotChatRequest(BaseModel):
    message: Optional[str] = ""
    messages: Optional[List[Dict[str, str]]] = None
    history: Optional[List[Dict[str, str]]] = []
    target_role: Optional[str] = None
    plugin: Optional[str] = "leadgen"
    api_key: Optional[str] = None
    apiKey: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None
    baseUrl: Optional[str] = None
    contacts: Optional[List[Dict[str, Any]]] = None
    channel: Optional[str] = "voice"
    filters: Optional[Dict[str, Any]] = None  # Find Leads: the filters currently applied, so chat refines them
    exclude_ids: Optional[List[str]] = None  # Find Leads: companies the user already removed


class FillGapsRequest(BaseModel):
    contacts: List[Dict[str, Any]]
    max_rows: Optional[int] = 50

@router.post("/enrich-prospect")
async def enrich_prospect(req: EnrichRequest, db: AsyncSession = Depends(get_db)):
    """
    Enriches an existing prospect or candidate with live web search results,
    phone numbers, email patterns, company overview, and personalized AI hook.
    """
    await _can_research(db)
    try:
        data = await enrich_prospect_intelligence(
            name=req.name,
            company=req.company,
            domain=req.domain,
            db=db,
        )
        if data:
            await _charge_leads(db, 1, f"Researched {req.name or req.company or 'a lead'}")
        
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
async def discover_accounts(req: DiscoverAccountsRequest, db: AsyncSession = Depends(get_db)):
    """
    Scours live web and search queries to discover new target accounts.
    """
    await _can_research(db)
    try:
        leads = await discover_new_target_accounts(
            query_or_domain=req.query,
            target_role=req.target_role,
            db=db,
        )
        # Results already in our own store ("tier": "stored") are free -- only newly-found ones are charged.
        new_count = sum(1 for l in (leads or []) if l.get("tier") != "stored")
        await _charge_leads(db, new_count, f"Found {new_count} accounts for \"{(req.query or '')[:60]}\"")
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

        # Find Leads chat: the same structured filters as the filter panel, run against the company
        # store -- so the chat and the panel can never disagree, and every company named in the
        # reply is a stored record, not a model's recollection.
        registry: Optional[Dict[str, Any]] = None
        removed_names: List[str] = []
        if plugin_type == "leadgen" and not fills:
            plan = await lead_filters.interpret(db, user_text, req.filters)
            if plan["action"] == "remove":
                removed_names = plan["remove_names"]
            elif plan["action"] == "search":
                try:
                    # The typed words first; nearby words only when they find nothing (the panel's box works the same way).
                    found, _ = await phrase_understanding.widen_if_empty(
                        db, plan["filters"], None,
                        lambda f: business_records.search_filtered(db, f, limit=25, exclude_ids=req.exclude_ids or []))
                    found["filters"] = business_records.normalize_filters(plan["filters"])  # show what was asked, not the widened words
                    registry = {"filters": found["filters"], "total": found["total"], "capped": found["total_capped"],
                                "leads": [lead_filters.card(r) for r in found["rows"]]}
                except ValueError as err:
                    registry = {"filters": plan["filters"], "total": 0, "capped": False, "leads": [], "needs": str(err)}

        # Check if query requests lead discovery or company prospecting
        is_lead_search = (plugin_type != "leadgen") and (not fills) and any(k in lower_t for k in [
            "find", "search", "discover", "get me", "look up", "locate", "companies", "leads", "prospects"
        ]) and any(k in lower_t for k in [
            "companies", "leads", "fleet", "logistics", "freight", "saas", "agency", "hospital",
            "manufactur", "clinic", "business", "firms", "shops", "stores", "suppliers"
        ])

        discovered_leads = []
        if is_lead_search and plugin_type == "leadgen":
            await _can_research(db)  # Lead generation pays per lead found
        if is_lead_search:
            try:
                discovered_leads = await discover_new_target_accounts(
                    query_or_domain=user_text,
                    target_role=req.target_role,
                    db=db,
                )
            except Exception:
                pass

        if plugin_type == "email":
            system_prompt = (
                "You are an elite B2B Email Outreach Strategist & AI Copilot in Outreach by Aivhub. "
                "You help users craft high-converting cold email sequences, refine subject lines, "
                "handle objections, and analyze inbound email replies. You are also an unrestricted AI "
                "assistant ready to answer any general, technical, or strategic question thoroughly."
            )
        elif plugin_type == "scheduler":
            system_prompt = (
                "You are an elite Social Media & Content Strategist AI Copilot in Outreach by Aivhub. "
                "You help users ideate viral social posts, plan multi-platform calendars, "
                "develop creative concepts, and write engaging hooks. You are also an unrestricted AI "
                "assistant ready to discuss any topic, concept, or strategy in detail."
            )
        elif plugin_type == "voice":
            system_prompt = (
                "You are Outreach by Aivhub Voice SDR copilot. The operator loaded a contact list that may be incomplete. "
                "Your job is to help fill missing phone numbers, emails, and decision-maker names from public web research. "
                "Never invent a phone number or email. If a field was not found, say so. "
                "After proposing fills, tell the operator to Accept each suggestion before dialing. "
                "WhatsApp/SMS/email in this mission are no-answer fallbacks after voice, not Cal.com. "
                "Cal.com is only used after a meeting is booked."
            )
        else:
            system_prompt = (
                "You are an elite Autonomous AI Copilot & Lead Engineering Strategist for Outreach by Aivhub. "
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
            lead_lines = "\n".join(
                f"- {l.get('name') or '?'} ({l.get('website') or l.get('domain') or 'no site listed'})"
                for l in discovered_leads
            )
            system_prompt += (
                f"\n\nLIVE WEB SEARCH JUST RAN and found these {len(discovered_leads)} real companies "
                f"(already fetched, already shown to the user as cards below your reply):\n{lead_lines}\n\n"
                "You DO have live web access and just used it -- never say you can't browse the web or can't "
                "pull live/current results, and never send the user off to search Google Maps, Companies House "
                "or LinkedIn themselves instead of these. Open by naming the companies found, then give tactical "
                "advice on approaching them, and invite the user to refine criteria (size, exact area, sub-sector) "
                "if they want a different set."
            )

        registry_summary = ""
        if registry is not None:
            chips = "; ".join(lead_filters.describe(registry["filters"]))
            if registry.get("needs"):
                registry_summary = f"No search ran: {registry['needs']}"
            elif registry["leads"]:
                lines = "\n".join(
                    f"- {c['name']} ({c['region'] or 'location n/a'}; {c['industry'] or 'sector n/a'}; "
                    f"{c['status'] or 'status n/a'}; {c['tier']})" for c in registry["leads"][:15]
                )
                more = f"{registry['total']:,}{'+' if registry['capped'] else ''}"
                registry_summary = (
                    f"Searched the company registry with filters [{chips}]: {more} matching companies, "
                    f"showing {len(registry['leads'])} in the table below your reply.\n{lines}"
                )
                system_prompt += (
                    f"\n\nA REGISTRY SEARCH JUST RAN with filters [{chips}]. {more} companies match; these are the "
                    f"first {len(registry['leads'])} (already shown to the user as rows below your reply):\n{lines}\n\n"
                    "Talk ONLY about companies in that list and the filters above. Every fact (town, sector, status) "
                    "comes from the official registry record -- never add a phone, email, website, headcount, revenue "
                    "or any detail not shown in the list, and never name a company that is not in it. Note that "
                    "'size' comes from the company's filed accounts category, not headcount. Open with the match count "
                    "and the filters used, then suggest ONE way to narrow or refine if the count is large."
                )
            else:
                registry_summary = f"Searched the company registry with filters [{chips}]: no companies matched."
                system_prompt += (
                    f"\n\nA REGISTRY SEARCH JUST RAN with filters [{chips}] and NOTHING matched. Say so plainly, "
                    "name the filters used, and suggest which one to loosen (a wider area, a broader sector word, "
                    "or including smaller/newer companies). Do not invent or recall any companies."
                )
        elif removed_names:
            system_prompt += (
                f"\n\nThe user asked to drop these from the results: {', '.join(removed_names)}. They have been "
                "removed from the table. Confirm briefly."
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
                db=db,
                scope="leadgen"
            )
        except Exception as llm_err:
            logger.warning(f"Voice copilot LLM unavailable: {llm_err}")

        reply_text = llm_response.get("reply", "") if isinstance(llm_response, dict) else ""

        # Belt-and-braces: a model can ignore the instruction above and claim it has no live web
        # access despite the search having already run -- never let that reach the user when real
        # results are sitting right there. Replace with a plain, data-grounded summary instead.
        if discovered_leads and (not reply_text or _NO_LIVE_ACCESS_CLAIM.search(reply_text)):
            lead_lines = "\n".join(
                f"- {l.get('name') or '?'} ({l.get('website') or l.get('domain') or 'no site listed'})"
                for l in discovered_leads
            )
            reply_text = (
                f"Found {len(discovered_leads)} companies from a live web search:\n\n{lead_lines}\n\n"
                "Save any of these below, or tell me more about your target (size, exact area, sub-sector) "
                "and I'll refine the search."
            )

        if not reply_text and registry_summary:
            reply_text = registry_summary  # the model was unreachable: the plain, data-only answer
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

        if plugin_type == "leadgen" and discovered_leads:
            new_count = sum(1 for l in discovered_leads if l.get("tier") != "stored")
            await _charge_leads(db, new_count, f"Found {new_count} leads")
        return {
            "success": True,
            "reply": reply_text,
            "leads": discovered_leads,
            "fills": fills,
            "registry": ({"companies": registry["leads"], "total": registry["total"], "total_capped": registry["capped"],
                          "filters": registry["filters"], "chips": lead_filters.describe(registry["filters"])}
                         if registry is not None and not registry.get("needs") else None),
            "removed_names": removed_names,
            "incompleteCount": len(incomplete),
            "model": llm_response.get("model", mod) if isinstance(llm_response, dict) else mod,
            "provider": llm_response.get("provider", prov) if isinstance(llm_response, dict) else prov
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
