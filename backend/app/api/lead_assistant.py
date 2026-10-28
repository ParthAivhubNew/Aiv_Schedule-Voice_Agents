"""The AI assistant beside the Leads pages.

POST /leads/assistant/ask               one message: the assistant picks tools, runs the free ones, and proposes the rest
POST /leads/assistant/profile-from-site read a business's own website into profile fields (nothing is saved here)

The model only chooses what to do and words the answer. Companies come from the stored register, never from the model, and
anything that spends credits or changes a list is returned as a proposal the person confirms on screen; the server never runs it.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.tenancy import current_org
from app.database import get_db
from app.models.models import CompanyProfile
from app.services import business_records, credits, lead_filters, llm_gateway, phrase_understanding
from app.services.safe_fetch import FetchRefused, fetch_text

logger = logging.getLogger("lead_assistant")
router = APIRouter(prefix="/leads/assistant", tags=["Leads"])

DAILY_MESSAGES = 200  # per account per day; counted in this process, so it is a guard against runaway use, not a bill
_used: Dict[str, int] = {}
MAX_TOOL_CALLS = 3
TOP = 8

_FILTER_PROPS = {k: v for k, v in lead_filters._SCHEMA["properties"].items() if k not in ("action", "remove_names", "keyword")}


def _tool(name: str, description: str, props: Optional[Dict[str, Any]] = None, required: Optional[List[str]] = None) -> Dict[str, Any]:
    return {"type": "function", "function": {"name": name, "description": description,
                                             "parameters": {"type": "object", "properties": props or {}, "required": required or []}}}


TOOLS = [
    _tool("search_companies", "Search the UK company register. Give the FULL set of filters (keep the current ones the person did not change). "
                              "Free. Use it whenever they want to find, narrow or change a list of companies.", _FILTER_PROPS),
    _tool("add_to_list", "Offer to save the companies from the latest search into one of the person's lists (a new name starts a new list). "
                         "Free. They confirm on screen.", {"list_name": {"type": "string"}, "how_many": {"type": "integer", "description": "1 to 200, default 25"}}, ["list_name"]),
    _tool("check_list", "Offer to check a saved list: fix its websites, phones and emails and find contacts. It costs credits, so only offer it; "
                        "the person sees the price before anything is charged.", {"list_name": {"type": "string"}}, ["list_name"]),
    _tool("start_campaign", "Offer to start an email campaign to one of the person's lists.", {"list_name": {"type": "string"}}, ["list_name"]),
    _tool("show_credits", "Tell the person how many credits they have left."),
]

_SYSTEM = (
    "You are the assistant inside the Leads part of Outreach by Aivhub, helping a UK business find and contact companies. "
    "Companies come only from the stored UK company register through your tools: never name a company, number, email or phone that a tool "
    "did not return, and say so plainly when something is not known. Searching is free. Checking a list, finding emails and sending cost "
    "credits, so you only offer them and the person confirms on screen. Keep answers short, plain and friendly. "
    "If the message is not about finding, saving or contacting companies, answer it directly without a tool."
)


class AskIn(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: List[Dict[str, Any]] = []
    filters: Dict[str, Any] = {}
    lists: List[Dict[str, Any]] = []  # [{id, name, count}]: the person's own lists


class SiteIn(BaseModel):
    url: str = Field(..., min_length=3, max_length=300)


def _spent_today() -> int:
    key = f"{current_org()}:{date.today().isoformat()}"
    for stale in [k for k in _used if not k.endswith(date.today().isoformat())]:
        _used.pop(stale, None)
    return _used.get(key, 0)


def _count_message() -> None:
    key = f"{current_org()}:{date.today().isoformat()}"
    _used[key] = _used.get(key, 0) + 1


def _list_named(lists: List[Dict[str, Any]], name: str) -> Optional[Dict[str, Any]]:
    want = (name or "").strip().lower()
    if not want:
        return None
    exact = [x for x in lists if str(x.get("name", "")).strip().lower() == want]
    near = [x for x in lists if want in str(x.get("name", "")).lower()]
    return (exact or near or [None])[0]


async def _business_line(db: AsyncSession) -> str:
    cp = (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()
    if not cp or not (cp.name or "").strip() or cp.name == "Your company":
        return "The business profile is not filled in yet, so you do not know what this business sells."
    return f"This business: {cp.name}. What it does: {(cp.pitch or cp.industry or 'not said')[:300]}. Website: {cp.website or 'not said'}."


async def _run_search(db: AsyncSession, args: Dict[str, Any]) -> Dict[str, Any]:
    filters = business_records.normalize_filters(args)
    try:
        found, _ = await phrase_understanding.widen_if_empty(
            db, filters, None, lambda f: business_records.search_filtered(db, f, limit=TOP, exclude_ids=[], stats=False))
    except ValueError as err:
        return {"needs": str(err), "filters": filters, "total": 0, "top": []}
    return {"filters": business_records.normalize_filters(filters), "total": found["total"], "capped": found["total_capped"],
            "top": [lead_filters.card(r) for r in found["rows"]]}


async def _credits_line(db: AsyncSession) -> str:
    balance = await credits.wallet_balance(db, "leadgen")
    return f"{balance:,} credits left."


@router.post("/ask")
async def ask(body: AskIn, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    if _spent_today() >= DAILY_MESSAGES:
        raise HTTPException(status_code=429, detail=f"You have used today's {DAILY_MESSAGES} assistant messages. They reset tomorrow.")
    started = time.time()
    history = [{"role": "assistant" if m.get("role") in ("assistant", "ai", "bot") else "user", "content": str(m.get("content") or "")[:1500]}
               for m in body.history[-8:] if str(m.get("content") or "").strip()]
    lists = [{"id": str(x.get("id", "")), "name": str(x.get("name", ""))[:80], "count": x.get("count")} for x in body.lists[:60]]
    context = (await _business_line(db)
               + f"\nFilters in use now: {json.dumps(body.filters or {})}"
               + f"\nThe person's lists: {', '.join(x['name'] for x in lists) or 'none yet'}")
    plan = await llm_gateway.call_open_chat_llm_with_tools(
        messages=[*history, {"role": "user", "content": body.message}], tools=TOOLS, system_prompt=_SYSTEM + "\n\n" + context,
        temperature=0.2, max_tokens=500, db=db, scope="leadgen")
    if not plan.get("success"):
        logger.warning("assistant plan failed: %s", plan.get("error"))
        raise HTTPException(status_code=502, detail="The AI service did not answer. Try again in a moment.")
    _count_message()

    steps: List[Dict[str, Any]] = []
    proposals: List[Dict[str, Any]] = []
    found: Optional[Dict[str, Any]] = None
    notes: List[str] = []
    latest_filters = body.filters or {}

    for call in (plan.get("tool_calls") or [])[:MAX_TOOL_CALLS]:
        fn = call.get("function") or {}
        name = fn.get("name")
        try:
            args = json.loads(fn.get("arguments") or "{}")
        except ValueError:
            args = {}
        t0 = time.time()
        if name == "search_companies":
            res = await _run_search(db, args)
            if res.get("needs"):
                notes.append(f"The search needs more detail: {res['needs']}")
                steps.append({"label": "Tried the company register", "detail": res["needs"], "ms": int((time.time() - t0) * 1000)})
                continue
            found = res
            latest_filters = res["filters"]
            words = " · ".join(lead_filters.describe(res["filters"])) or "your filters"
            steps.append({"label": "Searched the company register", "detail": f"{words}: {res['total']:,}{'+' if res.get('capped') else ''} found", "ms": int((time.time() - t0) * 1000)})
            notes.append(f"Search ({words}) matched {res['total']}{'+' if res.get('capped') else ''} companies. Top results: "
                         + "; ".join(f"{c['name']} ({c['region'] or 'no town'}, {c['industry'] or 'no industry'})" for c in res["top"]))
        elif name == "add_to_list":
            if not latest_filters or not business_records.normalize_filters(latest_filters):
                notes.append("There is no search to save yet. Ask the person who they want to find first.")
                continue
            how_many = min(max(int(args.get("how_many") or 25), 1), 200)
            list_name = str(args.get("list_name") or "Assistant list").strip()[:80] or "Assistant list"
            proposals.append({"id": f"p{len(proposals)}", "kind": "add_to_list", "title": f"Save up to {how_many} companies to “{list_name}”",
                              "detail": "Free. They are saved from the search above.", "params": {"filters": latest_filters, "list_name": list_name, "how_many": how_many}})
            steps.append({"label": "Prepared a list for you to confirm", "detail": f"{list_name}, up to {how_many}", "ms": int((time.time() - t0) * 1000)})
            notes.append(f"A proposal to save up to {how_many} companies to the list '{list_name}' is on screen, waiting for the person to confirm.")
        elif name in ("check_list", "start_campaign"):
            hit = _list_named(lists, str(args.get("list_name") or ""))
            if not hit:
                notes.append(f"No list is called '{args.get('list_name', '')}'. The lists are: {', '.join(x['name'] for x in lists) or 'none'}.")
                continue
            if name == "check_list":
                proposals.append({"id": f"p{len(proposals)}", "kind": "check_list", "title": f"Check “{hit['name']}”",
                                  "detail": "You will see the price before anything is charged.", "params": {"list_id": hit["id"]}})
            else:
                proposals.append({"id": f"p{len(proposals)}", "kind": "campaign", "title": f"Start an email campaign to “{hit['name']}”",
                                  "detail": "You set it up and review it before anything is sent.", "params": {"list_id": hit["id"]}})
            steps.append({"label": "Found your list", "detail": hit["name"], "ms": int((time.time() - t0) * 1000)})
            notes.append(f"A proposal for the list '{hit['name']}' is on screen, waiting for the person.")
        elif name == "show_credits":
            line = await _credits_line(db)
            steps.append({"label": "Read your credits", "detail": line, "ms": int((time.time() - t0) * 1000)})
            notes.append(line)

    reply = (plan.get("reply") or "").strip()
    if notes:
        final = await llm_gateway.call_open_chat_llm(
            messages=[*history, {"role": "user", "content": body.message}],
            system_prompt=_SYSTEM + "\n\n" + context + "\n\nWhat your tools just did (this is all you know; do not add companies or facts):\n- " + "\n- ".join(notes)
            + "\n\nNow answer the person in two to four short sentences. Say what was found or prepared and what they can do next.",
            temperature=0.3, max_tokens=400, db=db, scope="leadgen")
        reply = (final.get("reply") or "").strip() if final.get("success") else ""
        if not reply:
            reply = " ".join(n for n in notes if not n.startswith("A proposal")) or "Done. Check what is on screen."
    if not reply:
        reply = "I'm not sure what to do with that. Tell me who you want to find, for example “cafes in Leeds”."

    return {"reply": reply, "steps": steps, "proposals": proposals, "took_ms": int((time.time() - started) * 1000),
            "found": ({"total": found["total"], "capped": found.get("capped", False), "filters": found["filters"], "top": found["top"]} if found else None)}


@router.post("/profile-from-site")
async def profile_from_site(body: SiteIn, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """Reads the business's own website and proposes the profile fields. The person reviews and saves them; nothing is stored here."""
    url = body.url.strip()
    if not url.lower().startswith(("http://", "https://")):
        url = "https://" + url
    try:
        title, text = await fetch_text(url, max_chars=7000)
    except FetchRefused as err:
        raise HTTPException(status_code=400, detail=str(err))
    if len(text) < 80:
        raise HTTPException(status_code=400, detail="That page has too little text to read. Try the company's home or About page.")
    schema = {"type": "object", "properties": {
        "company": {"type": "string", "description": "The business's trading name as the site writes it."},
        "sells": {"type": "string", "description": "What it sells or does, in one or two plain sentences."},
        "audience": {"type": "string", "description": "Who its customers are, only if the site says so; else empty."},
        "offer": {"type": "string", "description": "Its main offer or hook, only if the site says so; else empty."},
        "tone": {"type": "string", "description": "How the site speaks, in a few words, for example friendly and plain."}}, "required": ["company", "sells"]}
    got = await llm_gateway.extract_structured(
        system_prompt="Read a company's website text and fill the profile fields using only what the text says. Leave a field empty rather than guess.",
        user_text=f"Page title: {title}\n\n{text}", schema=schema, tool_name="set_profile", db=db, scope="leadgen", max_tokens=500)
    if not got:
        raise HTTPException(status_code=502, detail="The AI service could not read that page. Try again in a moment.")
    return {"website": url, "profile": {k: str(got.get(k) or "").strip()[:600] for k in ("company", "sells", "audience", "offer", "tone")}}
