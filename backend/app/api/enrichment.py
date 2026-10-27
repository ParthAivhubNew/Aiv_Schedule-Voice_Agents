import logging
import asyncio
import re
from fastapi import APIRouter, Depends, HTTPException, Request
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


# What sits under the Find Leads chat, so the reply can say what the list is, why it is there and how to use it.
_LEADS_SCREEN_GUIDE = (
    "SCREEN GUIDE (describe it only in these terms):\n"
    "- Under the chat is a results card with one row per company, best matches first, loaded 25 at a time; "
    "'Show more' loads the next page. The count above it is every company that matches, not just the rows loaded.\n"
    "- Every row is the official company registry record: name, sector, town and postcode, status, company type, "
    "registration number, date incorporated, and a size band taken from the filed accounts (not headcount). "
    "A website or phone only shows if we already hold one. A 'Registry' badge means official record.\n"
    "- Per row: 'Contacts' opens the people on the registry and lets the user look for a work email "
    "(1 Leads credit, charged only if one is found) or look for the company's website and phone on the web "
    "(1 credit, only if found). 'Save' puts the company in a list. 'Save & call' needs Voice and a phone number. "
    "The cross removes the row.\n"
    "- Above the rows: List and Map views, 'Favourite all', 'Save all', and the filter chips that show what was searched. "
    "The Filters panel holds the same filters as the chat: industry or name words, town, postcode, size, years trading, "
    "company type, has website, has phone, has email, include closed, and SIC codes through the chat.\n"
    "- Searching is free. Credits are only used for contact lookups.\n\n"
)
_RESULT_REPLY_RULES = (
    "HOW TO ANSWER: plain text, at most 140 words, no headings. Light formatting only: **bold** for a count or a company name, "
    "and '- ' bullets for at most 5 companies.\n"
    "1. First sentence: what was searched (use the real filters) and how many companies match, with the exact count.\n"
    "2. Second: say what is under the chat in one sentence: the first rows of those matches, best match first, from the official "
    "registry. Mention that Contacts, Save and Map work on each row.\n"
    "3. Pick out the rows that fit the request best, naming at most 5 from the list. If the sector words pulled in companies "
    "that clearly are not what was asked for, say which kinds, in a few words. Never list all the rows: they are on screen.\n"
    "4. Finish with ONE concrete next step the product can do, written so the user can just type it back, for example "
    "'use SIC 20110 to 20160 only', 'only ones trading 10+ years', 'only with a website', or 'add Bradford'. "
    "When the count is over 200, make that step a narrowing one. When it is under 10, make it a widening one.\n"
    "Every fact comes from the list above. Never add a phone, email, website, headcount, revenue or any detail not shown, "
    "never name a company that is not in the list, and never claim a company is verified beyond being on the registry. "
    "Do not offer to do things this screen cannot do.\n"
)
_VOICE_SCREEN_GUIDE = (
    "SCREEN GUIDE (describe it only in these terms):\n"
    "- The Voice screen has Today's list: a table of people to call, filled by uploading a spreadsheet, adding contacts by hand, "
    "or by asking this chat to find companies or people, which adds them as rows.\n"
    "- The user ticks who to call. One ticked row is called straight away; 2 or more ticked are called in turn, up to 2 at once; "
    "with none ticked the whole list is worked through one at a time. Calls use call minutes.\n"
    "- Find missing (or asking here to fill gaps) looks up missing phone numbers, emails and websites from public pages and marks the "
    "filled cells. Each suggestion must be accepted before it is dialled. A detail that was not found is left empty, never guessed.\n"
    "- Save list keeps the list; 'new list' starts a blank one.\n\n"
)
_VOICE_REPLY_RULES = (
    "HOW TO ANSWER: plain text, at most 110 words, no headings. **Bold** for a count, '- ' bullets for at most 5 items.\n"
    "1. Say what you did or found, with the real numbers (rows added, gaps filled, rows with nothing public).\n"
    "2. Say where it is on screen (the rows in Today's list, the highlighted cells) and what the user should do with it "
    "(accept the suggestions, tick who to call, press Call).\n"
    "3. Name the rows that still have gaps, at most 5, and why they are not callable yet.\n"
    "4. End with one concrete next step the user can type or click. Never promise a call outcome, and never state a phone or email "
    "that is not in the list or the lookup result.\n"
)
_PLAIN_REPLY_RULES = (
    "HOW TO ANSWER: plain text, at most 90 words, no headings. Answer the question first, then say what the user can do next on this screen.\n"
)


def _registry_fallback(chips: str, registry: Dict[str, Any]) -> str:
    """The reply used when the model is unreachable: short, plain, and from the data only."""
    total = f"{registry['total']:,}{'+' if registry['capped'] else ''}"
    shown = len(registry["leads"])
    return (
        f"{total} companies on the official registry match {chips}. "
        f"The first {shown} are in the list under this chat, best matches first. "
        "Open Contacts on a row to look for people and emails, Save the ones you want, or switch to Map. "
        + ("That is a lot: add a town, a size or years trading to narrow it." if registry["total"] > 200 else "")
    ).strip()


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


# ── Chat history: one private list per signed-in person, per plugin ─────────
_CHATS_KEPT = 30
_CHAT_PLUGINS = ("leadgen", "voice")


def _chats_key(request: Request, plugin: str) -> str:
    from app.core.auth_middleware import current

    if plugin not in _CHAT_PLUGINS:
        raise HTTPException(status_code=404, detail="No chat history for that plugin.")
    ctx = current(request)
    # Find Leads kept its original key, so chats saved before Voice was added stay where they are.
    prefix = "leads_chats" if plugin == "leadgen" else f"chats_{plugin}"
    return f"{prefix}:{ctx['org_id']}:{ctx['operator_id']}"


class ChatIn(BaseModel):
    id: str
    title: str = ""
    at: Optional[float] = None
    chat: List[Dict[str, Any]] = []
    filters: Optional[Dict[str, Any]] = None


async def _list_chats(request: Request, db: AsyncSession, plugin: str) -> Dict[str, Any]:
    from app.services.credits import _get_doc

    return {"chats": (await _get_doc(db, _chats_key(request, plugin))).get("chats", [])}


async def _save_chat(body: ChatIn, request: Request, db: AsyncSession, plugin: str) -> Dict[str, Any]:
    from app.services.credits import _get_doc, _put_doc

    key = _chats_key(request, plugin)
    msgs = []
    for m in body.chat[:80]:
        who = "user" if (m.get("role") or m.get("who")) == "user" else ("ai" if "who" in m else "assistant")
        msg = {"id": str(m.get("id", ""))[:40], "text": str(m.get("text", ""))[:6000]}
        msg["who" if "who" in m else "role"] = who
        if isinstance(m.get("found"), int):
            msg["found"] = m["found"]
        msgs.append(msg)
    if not any((m.get("role") or m.get("who")) == "user" for m in msgs):
        return {"saved": False}
    entry = {"id": body.id[:40], "title": (body.title or msgs[0]["text"])[:70], "at": body.at or 0, "chat": msgs, "filters": body.filters or {}}
    old = (await _get_doc(db, key)).get("chats", [])
    await _put_doc(db, key, {"chats": ([entry] + [c for c in old if c.get("id") != entry["id"]])[:_CHATS_KEPT]})
    await db.commit()
    return {"saved": True}


async def _delete_chat(chat_id: str, request: Request, db: AsyncSession, plugin: str) -> Dict[str, Any]:
    from app.services.credits import _get_doc, _put_doc

    key = _chats_key(request, plugin)
    old = (await _get_doc(db, key)).get("chats", [])
    await _put_doc(db, key, {"chats": [c for c in old if c.get("id") != chat_id]})
    await db.commit()
    return {"deleted": True}


@router.get("/chats/{plugin}")
async def list_chats(plugin: str, request: Request, db: AsyncSession = Depends(get_db)):
    """The signed-in person's earlier chats in a plugin, newest first. Nobody else's are ever returned."""
    return await _list_chats(request, db, plugin)


@router.put("/chats/{plugin}")
async def save_chat(plugin: str, body: ChatIn, request: Request, db: AsyncSession = Depends(get_db)):
    return await _save_chat(body, request, db, plugin)


@router.delete("/chats/{plugin}/{chat_id}")
async def delete_chat(plugin: str, chat_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    return await _delete_chat(chat_id, request, db, plugin)


# The Find Leads screen was built first and calls these.
@router.get("/leads-chats")
async def list_leads_chats(request: Request, db: AsyncSession = Depends(get_db)):
    return await _list_chats(request, db, "leadgen")


@router.put("/leads-chats")
async def save_leads_chat(body: ChatIn, request: Request, db: AsyncSession = Depends(get_db)):
    return await _save_chat(body, request, db, "leadgen")


@router.delete("/leads-chats/{chat_id}")
async def delete_leads_chat(chat_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    return await _delete_chat(chat_id, request, db, "leadgen")


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
                                "leads": [lead_filters.card(r) for r in found["rows"]],
                                "tiers": found.get("tiers"), "saved_total": found.get("saved_total")}
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
                "Cal.com is only used after a meeting is booked.\n\n"
                + _VOICE_SCREEN_GUIDE + _VOICE_REPLY_RULES
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
                registry_summary = _registry_fallback(chips, registry)
                system_prompt += (
                    f"\n\nA REGISTRY SEARCH JUST RAN with filters [{chips}]. {more} companies match; these are the "
                    f"first {len(registry['leads'])} (already shown to the user as rows below your reply):\n{lines}\n\n"
                    + _LEADS_SCREEN_GUIDE + _RESULT_REPLY_RULES
                )
            else:
                registry_summary = f"Searched the company registry with filters [{chips}]: no companies matched."
                system_prompt += (
                    f"\n\nA REGISTRY SEARCH JUST RAN with filters [{chips}] and NOTHING matched. Say so plainly, "
                    "name the filters used, and suggest which one to loosen (a wider area, a broader sector word, "
                    "or including smaller/newer companies). Do not invent or recall any companies. "
                    "Keep it to three short sentences, plain text, no list."
                )
        elif removed_names:
            system_prompt += (
                f"\n\nThe user asked to drop these from the results: {', '.join(removed_names)}. They have been "
                "removed from the table and stay out of later searches in this chat. Confirm in one sentence, "
                "and say they can search again to bring them back."
            )
        elif plugin_type == "leadgen" and not fills and not discovered_leads:
            # A question about the screen or the list, not a new search.
            now = "; ".join(lead_filters.describe(req.filters or {})) if req.filters else ""
            system_prompt += (
                "\n\nNo new search ran for this message. "
                + (f"The filters now applied are [{now}], and the rows under the chat are what they found. " if now
                   else "Nothing has been searched yet, so there are no rows under the chat. ")
                + "If the user asks what a list, row, badge or button is, or how to use it, explain it from the screen guide below, "
                "in plain words. If they are asking for companies, ask for the missing piece (what kind of company, and where) in one sentence.\n\n"
                + _LEADS_SCREEN_GUIDE + _PLAIN_REPLY_RULES
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
                          "filters": registry["filters"], "chips": lead_filters.describe(registry["filters"]),
                          "tiers": registry.get("tiers"), "saved_total": registry.get("saved_total")}
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
