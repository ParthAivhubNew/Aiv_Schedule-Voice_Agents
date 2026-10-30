"""The AI assistant beside the Leads pages.

POST /leads/assistant/ask               one message: the assistant picks tools, runs the free ones, and proposes the rest
POST /leads/assistant/ask/stream        the same turn as server-sent events, one per step as it happens
POST /leads/assistant/profile-from-site read a business's own website into profile fields (nothing is saved here)

The model only chooses what to do and words the answer. Companies come from the stored register, never from the model, and
anything that spends credits or changes a list is returned as a proposal the person confirms on screen; the server never runs it.
"""
from __future__ import annotations

import json
import logging
import time
from collections import Counter
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.auth_middleware import current
from app.core.tenancy import current_org
from app.database import get_db
from app.models.models import CompanyProfile, EmailCampaign, EmailEnrollment, EmailMailbox, EmailMessage, LeadAccount
from app.services.assistant_engine import clean_reply, proposal_reply
from app.services import agent_runs, business_records, credits, lead_filters, llm_gateway, phrase_understanding
from app.services.safe_fetch import FetchRefused, fetch_text

logger = logging.getLogger("lead_assistant")
router = APIRouter(prefix="/leads/assistant", tags=["Leads"])

DAILY_MESSAGES = 200  # per account per day, kept in the database so every server process shares one count
MAX_ROUNDS = 4  # planning rounds per message: each round sees what the tools returned in the one before
TOP = 8
THIN = 3  # a register search with this many results or fewer is "thin": the web is worth offering

_FILTER_PROPS = {k: v for k, v in lead_filters._SCHEMA["properties"].items() if k not in ("action", "remove_names", "keyword")}
_TOPICS = ["pipeline", "campaigns", "replies", "mailboxes", "follow_ups", "customer_profile"]
_OLD_TOPIC = {"my_pipeline": "pipeline", "my_campaigns": "campaigns", "reply_breakdown": "replies", "mailbox_health": "mailboxes",
              "follow_ups_due": "follow_ups", "my_customer_profile": "customer_profile"}


def _tool(name: str, description: str, props: Optional[Dict[str, Any]] = None, required: Optional[List[str]] = None) -> Dict[str, Any]:
    return {"type": "function", "function": {"name": name, "description": description,
                                             "parameters": {"type": "object", "properties": props or {}, "required": required or []}}}


TOOLS = [
    _tool("search_companies", "USE to find, narrow or count companies in the UK company register. Give the FULL set of filters (keep the current ones the person "
                              "did not change). Set count_only for audience-size, TAM or how-many questions: it returns the size and how complete the profiles are "
                              "instead of a list. Free. DO NOT use for the person's own saved companies (use my_data) or for businesses outside the register.",
          {**_FILTER_PROPS, "count_only": {"type": "boolean", "description": "Only size the audience; do not list companies."}}),
    _tool("my_data", "USE for any question about the person's OWN account: pipeline (saved companies by stage), campaigns, replies (how replies were sorted), "
                     "mailboxes (deliverability), follow_ups (due in 7 days) or customer_profile (sectors and towns of their best companies, for lookalikes; "
                     "then call search_companies with what it returns). Free. DO NOT use to find new companies.",
          {"topic": {"type": "string", "enum": _TOPICS}}, ["topic"]),
    _tool("show_credits", "USE when the person asks how many credits they have. Free."),
    _tool("add_to_list", "USE to offer saving the companies from the latest search into one of the person's lists (a new name starts a new list). "
                         "Free. They confirm on screen. Needs a search first.", {"list_name": {"type": "string"}, "how_many": {"type": "integer", "description": "1 to 200, default 25"}}, ["list_name"]),
    _tool("check_list", "USE to offer checking a saved list: fixing its websites, phones and emails and finding contacts. It costs credits, so it is only offered; "
                        "the person sees the price before anything is charged.", {"list_name": {"type": "string"}}, ["list_name"]),
    _tool("start_campaign", "USE to offer starting an email campaign to one of the person's lists.", {"list_name": {"type": "string"}}, ["list_name"]),
    *agent_runs.plan_tools(),
]

WEB_TOOL = _tool("search_web", "USE only when the register search found nothing or too few, or the person asks for businesses that are not in the register "
                               "(for example a new or non-UK business). Searches public web pages and directories. Results are unverified and cost credits per "
                               "company found, so it is only offered and the person confirms on screen. Give a short query: a type of business and a place.",
                 {"query": {"type": "string"}}, ["query"])

_SYSTEM = (
    "You are the assistant inside the Leads part of Outreach by Aivhub, helping a UK business find and contact companies. "
    "Companies come only from the stored UK company register (or, when the person has Web search switched on, from a web search they confirm) through your tools: "
    "never name a company, number, email or phone that a tool did not return, and say so plainly when something is not known. "
    "Searching the register is free. Web search, checking a list, finding emails and sending cost credits, so you only offer them and the person confirms on screen. "
    "Keep answers short, plain and friendly. "
    "Pick ONE tool for each need. Questions about the person's own leads, campaigns, replies, mailboxes or follow-ups use my_data with the right topic, and credits use "
    "show_credits: quote their numbers exactly and never estimate. For audience size or a total addressable market call search_companies with count_only. "
    "For lookalikes call my_data with customer_profile and then search_companies with what it returns. "
    "You can call several tools one after another: wait for a tool's result before choosing the next one. Do not repeat a call that already ran. "
    "If a request is missing something you need (what to find, where, or which list), ask ONE short question instead of guessing. "
    "When asked to write emails or a sequence, write them from the business profile with merge fields such as {{first_name}} and {{company}}, never invent facts about a recipient, "
    "and say they can set it up under Outreach. When asked which companies fit best, explain only with the fields a search returned. "
    "If the business profile is not filled in and the request needs it, ask what the business sells and who buys it before guessing. "
    "If the message is not about finding, saving or contacting companies, answer it directly without a tool."
    + agent_runs.AGENT_PROMPT
)


class AskIn(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: List[Dict[str, Any]] = []
    filters: Dict[str, Any] = {}
    lists: List[Dict[str, Any]] = []  # [{id, name, count}]: the person's own lists
    memory: List[str] = []  # things the person asked the assistant to remember (/remember)
    web_search: bool = False  # the Web search toggle in the chat: only then does the model get the search_web tool
    state: Dict[str, Any] = {}  # what the last turn left behind ({last_total, last_names}), sent back so "those" and "the second one" resolve


class SiteIn(BaseModel):
    url: str = Field(..., min_length=3, max_length=300)


def _usage_key() -> str:
    return f"assistant_usage:{current_org()}:{date.today().isoformat()}"


async def _spent_today(db: AsyncSession) -> int:
    return int((await credits._get_doc(db, _usage_key())).get("n", 0))


async def _count_message(db: AsyncSession) -> None:
    await credits._put_doc(db, _usage_key(), {"n": await _spent_today(db) + 1})
    await db.commit()


def _list_named(lists: List[Dict[str, Any]], name: str) -> Optional[Dict[str, Any]]:
    want = (name or "").strip().lower()
    if not want:
        return None
    exact = [x for x in lists if str(x.get("name", "")).strip().lower() == want]
    near = [x for x in lists if want in str(x.get("name", "")).lower()]
    return (exact or near or [None])[0]


async def _business_line(db: AsyncSession, request: Request) -> str:
    """The About your business profile, all of it: the same facts the email writer reads (company, what it sells, who it is for,
    the offer, tone, sign-off and proof points), so what the person typed there is the assistant's memory of their business."""
    from app.api import email_outreach as EO
    from app.services import email_writer as W

    try:
        p = await EO._profile(db, current(request), need=False)
    except Exception as err:  # a profile that cannot be read must not stop the chat
        logger.warning("assistant profile unreadable: %s", err)
        p = {}
    if not (p.get("company") or "").strip() or p["company"] == "Your company" or not (p.get("sells") or "").strip():
        named = f" The business is called {p['company']}." if (p.get("company") or "").strip() and p["company"] != "Your company" else ""
        return "The business profile is not filled in yet, so you do not know what this business sells." + named
    return "About the business the person works for (their own words from About your business; use it to judge which companies fit and to write for them):\n" + W._profile_prompt(p)


async def _run_search(db: AsyncSession, args: Dict[str, Any]) -> Dict[str, Any]:
    filters = business_records.normalize_filters(args)
    try:
        found, _ = await phrase_understanding.widen_if_empty(
            db, filters, None, lambda f: business_records.search_filtered(db, f, limit=TOP, exclude_ids=[], stats=False))
    except ValueError as err:
        return {"needs": str(err), "filters": filters, "total": 0, "top": []}
    return {"filters": business_records.normalize_filters(filters), "total": found["total"], "capped": found["total_capped"],
            "top": [lead_filters.card(r) for r in found["rows"]]}


async def _pipeline(db: AsyncSession) -> Dict[str, Any]:
    stages = dict((s or "new", n) for s, n in (await db.execute(select(LeadAccount.stage, func.count()).group_by(LeadAccount.stage))).all())
    total = sum(stages.values())
    with_email = (await db.execute(select(func.count()).select_from(LeadAccount).where(LeadAccount.email != ""))).scalar() or 0
    with_phone = (await db.execute(select(func.count()).select_from(LeadAccount).where(LeadAccount.phone != ""))).scalar() or 0
    return {"total": total, "stages": stages, "with_email": with_email, "with_phone": with_phone}


async def _campaigns(db: AsyncSession) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for c in (await db.execute(select(EmailCampaign).order_by(EmailCampaign.created_at.desc()).limit(8))).scalars().all():
        enrolled = dict((s, n) for s, n in (await db.execute(
            select(EmailEnrollment.status, func.count()).where(EmailEnrollment.campaign_id == c.id).group_by(EmailEnrollment.status))).all())
        sent = (await db.execute(select(func.count()).select_from(EmailMessage).where(
            EmailMessage.campaign_id == c.id, EmailMessage.is_warmup.is_(False), EmailMessage.sent_at.isnot(None)))).scalar() or 0
        out.append({"name": c.name, "status": c.status, "people": sum(enrolled.values()), "sent": sent,
                    "replied": enrolled.get("replied", 0), "bounced": enrolled.get("bounced", 0), "unsubscribed": enrolled.get("unsubscribed", 0)})
    return out


async def _market(db: AsyncSession, args: Dict[str, Any]) -> Dict[str, Any]:
    filters = business_records.normalize_filters(args)
    out: Dict[str, Any] = {"filters": filters}
    base = await business_records.search_filtered(db, filters, limit=1, exclude_ids=[], stats=True)
    out.update(total=base["total"], capped=base["total_capped"], tiers=base.get("tiers"), saved=base.get("saved_total"))
    for key in ("has_website", "has_email", "has_phone"):
        got = await business_records.search_filtered(db, {**filters, key: True}, limit=1, exclude_ids=[], stats=False)
        out[key] = got["total"]
    return out


async def _customer_profile(db: AsyncSession) -> Dict[str, Any]:
    rows = (await db.execute(select(LeadAccount.industry, LeadAccount.region, LeadAccount.stage))).all()
    best = [r for r in rows if r[2] in ("interested", "meeting", "won")]
    use = best or rows

    def top(i: int) -> List[str]:
        return [f"{k} ({n})" for k, n in Counter(r[i].strip() for r in use if (r[i] or "").strip()).most_common(5)]

    return {"basis": "best" if best else "all", "count": len(use), "industries": top(0), "regions": top(1)}


async def _mailboxes(db: AsyncSession) -> List[Dict[str, Any]]:
    rows = (await db.execute(select(EmailMailbox).order_by(EmailMailbox.created_at).limit(10))).scalars().all()
    out = []
    for m in rows:
        rate = m.bounce_rate_7d or 0
        out.append({"email": m.email, "status": m.status, "bounce": round(rate if rate > 1 else rate * 100, 1), "spf": bool(m.spf_verified),
                    "dkim": bool(m.dkim_verified), "dmarc": bool(m.dmarc_verified), "cap": m.daily_cap, "error": (m.last_error or "")[:120]})
    return out


async def _replies(db: AsyncSession) -> Dict[str, Any]:
    base = [EmailMessage.is_warmup.is_(False), EmailMessage.created_at >= datetime.utcnow() - timedelta(days=30)]
    cats = dict((c or "unsorted", n) for c, n in (await db.execute(
        select(EmailMessage.reply_category, func.count()).where(*base, EmailMessage.status == "replied").group_by(EmailMessage.reply_category))).all())

    async def count(*where) -> int:
        return (await db.execute(select(func.count()).select_from(EmailMessage).where(*base, *where))).scalar() or 0

    return {"sent": await count(EmailMessage.sent_at.isnot(None)), "opened": await count(EmailMessage.open_count > 0),
            "bounced": await count(EmailMessage.status == "bounced"), "replies": cats}


async def _due(db: AsyncSession) -> List[Dict[str, Any]]:
    rows = (await db.execute(select(LeadAccount).where(LeadAccount.next_action_at.isnot(None), LeadAccount.next_action_at <= datetime.utcnow() + timedelta(days=7))
                             .order_by(LeadAccount.next_action_at).limit(10))).scalars().all()
    return [{"name": r.name, "when": r.next_action_at.strftime("%d %b"), "what": r.next_action or "follow up"} for r in rows]


def suggestions(*, found: bool, proposals: bool, lists: List[Dict[str, Any]], has_profile: bool, asked: str = "",
                thin: bool = False, web: bool = False) -> List[str]:
    """Next things worth asking, from the state of the chat. Fixed text, so they never promise what the data does not hold."""
    if found:
        out = ["Only the ones with an email", "Only the ones with a phone number", "Only small companies", "Only companies older than 10 years",
               "Which of these fit my business best?", "Save these to a new list"]
    elif lists:
        out = [f"Check my list “{lists[0]['name']}”", "How are my leads doing?", "Who should I follow up with this week?", "How are my campaigns doing?",
               "How many credits do I have left?", "Find cafes in Leeds"]
    else:
        out = ["Find cafes in Leeds", "Find accountants in Manchester with an email", "Find small construction companies older than 5 years",
               "How many credits do I have left?", "What can you help me with?"]
    if thin:
        out = ["Search the web for these" if web else "Turn on Web search to look beyond the register"] + out
    if proposals:
        out = ["What does that cost?"] + out
    if not has_profile:
        out.append("Help me describe my business")
    seen: List[str] = []
    for s in out:
        if s.lower() != asked.strip().lower() and s not in seen:
            seen.append(s)
    return seen[:6]


async def _credits_line(db: AsyncSession) -> str:
    balance = await credits.wallet_balance(db, "leadgen")
    return f"{balance:,} credits left."


def _ms(t0: float) -> int:
    return int((time.time() - t0) * 1000)


class _Turn:
    """What one message has done so far: shared by the tool handlers, then turned into the reply."""

    def __init__(self, body: AskIn, lists: List[Dict[str, Any]]):
        self.body = body
        self.lists = lists
        self.steps: List[Dict[str, Any]] = []
        self.proposals: List[Dict[str, Any]] = []
        self.notes: List[str] = []
        self.found: Optional[Dict[str, Any]] = None
        self.filters: Dict[str, Any] = body.filters or {}
        self.web_asked = False
        self.actor: Dict[str, Any] = {}


async def _tool_search(db: AsyncSession, t: _Turn, args: Dict[str, Any]) -> None:
    t0 = time.time()
    count_only = bool(args.pop("count_only", False))
    if count_only:
        m = await _market(db, args)
        words = " · ".join(lead_filters.describe(m["filters"])) or "all companies"
        plus = "+" if m["capped"] else ""
        tiers = m["tiers"] or {}
        t.notes.append(f"Market ({words}): {m['total']:,}{plus} companies in the register. Profile detail: full {tiers.get('full', 'unknown')}, partial {tiers.get('partial', 'unknown')}, "
                       f"basic {tiers.get('basic', 'unknown')}. With a website {m['has_website']:,}, with an email {m['has_email']:,}, with a phone {m['has_phone']:,}. "
                       f"Already saved by the person: {m['saved'] if m['saved'] is not None else 'unknown'}.")
        t.steps.append({"label": "Sized the market", "detail": f"{words}: {m['total']:,}{plus}", "ms": _ms(t0)})
        return
    res = await _run_search(db, args)
    if res.get("needs"):
        t.notes.append(f"The search needs more detail: {res['needs']}")
        t.steps.append({"label": "Tried the company register", "detail": res["needs"], "ms": _ms(t0)})
        return
    t.found = res
    t.filters = res["filters"]
    words = " · ".join(lead_filters.describe(res["filters"])) or "your filters"
    t.steps.append({"label": "Searched the company register", "detail": f"{words}: {res['total']:,}{'+' if res.get('capped') else ''} found", "ms": _ms(t0)})
    t.notes.append(f"Search ({words}) matched {res['total']}{'+' if res.get('capped') else ''} companies. Top results: "
                   + ("; ".join(f"{c['name']} ({c['region'] or 'no town'}, {c['industry'] or 'no industry'})" for c in res["top"]) or "none")
                   + (". That is very few: the web search can look beyond the register." if res["total"] <= THIN and t.body.web_search else ""))


async def _tool_my_data(db: AsyncSession, t: _Turn, topic: str) -> None:
    t0 = time.time()
    if topic == "pipeline":
        p = await _pipeline(db)
        t.notes.append("The person has no saved companies yet, so there is no pipeline to report." if not p["total"] else
                       f"Saved companies: {p['total']}. By stage: " + ", ".join(f"{k} {v}" for k, v in p["stages"].items())
                       + f". {p['with_email']} have an email and {p['with_phone']} have a phone number.")
        t.steps.append({"label": "Read your saved companies", "detail": f"{p['total']:,} saved", "ms": _ms(t0)})
    elif topic == "campaigns":
        cs = await _campaigns(db)
        t.notes.append("Campaigns: " + "; ".join(f"{c['name']} is {c['status']}, {c['people']} people, {c['sent']} emails sent, {c['replied']} replied, "
                                                 f"{c['bounced']} bounced, {c['unsubscribed']} unsubscribed" for c in cs) if cs else "The person has no email campaigns yet.")
        t.steps.append({"label": "Read your campaigns", "detail": f"{len(cs)} found", "ms": _ms(t0)})
    elif topic == "replies":
        r = await _replies(db)
        sorted_ = ", ".join(f"{k} {v}" for k, v in r["replies"].items()) or "no replies yet"
        t.notes.append(f"Last 30 days: {r['sent']} sent, {r['opened']} opened, {r['bounced']} bounced. Replies: {sorted_}.")
        t.steps.append({"label": "Read your replies", "detail": f"{r['sent']} sent", "ms": _ms(t0)})
    elif topic == "mailboxes":
        mb = await _mailboxes(db)
        t.notes.append("Mailboxes: " + "; ".join(
            f"{m['email']} is {m['status']}, bounce rate {m['bounce']}% (7 days), SPF {'ok' if m['spf'] else 'not verified'}, DKIM {'ok' if m['dkim'] else 'not verified'}, "
            f"DMARC {'ok' if m['dmarc'] else 'not verified'}, daily limit {m['cap']}" + (f", last error: {m['error']}" if m["error"] else "") for m in mb)
            if mb else "No sending mailbox is connected yet.")
        t.steps.append({"label": "Checked your mailboxes", "detail": f"{len(mb)} connected", "ms": _ms(t0)})
    elif topic == "follow_ups":
        due = await _due(db)
        t.notes.append("Follow-ups due in 7 days: " + "; ".join(f"{d['name']} on {d['when']} ({d['what']})" for d in due) if due else "Nothing is due for follow-up in the next 7 days.")
        t.steps.append({"label": "Checked your follow-ups", "detail": f"{len(due)} due", "ms": _ms(t0)})
    elif topic == "customer_profile":
        cp = await _customer_profile(db)
        if not cp["count"]:
            t.notes.append("The person has no saved companies yet, so there is nothing to base lookalikes on. Ask who their best customers are.")
        else:
            label = "best saved companies (interested, meeting or won)" if cp["basis"] == "best" else "saved companies (none are marked interested or won yet)"
            t.notes.append(f"Based on {cp['count']} {label}. Sectors: {', '.join(cp['industries']) or 'not recorded'}. Towns: {', '.join(cp['regions']) or 'not recorded'}.")
        t.steps.append({"label": "Read your best companies", "detail": f"{cp['count']} saved", "ms": _ms(t0)})
    else:
        t.notes.append(f"my_data has no topic '{topic}'. The topics are: {', '.join(_TOPICS)}.")


async def _run_tool(db: AsyncSession, t: _Turn, name: str, args: Dict[str, Any]) -> None:
    t0 = time.time()
    name_in = name
    if name in _OLD_TOPIC:
        name, args = "my_data", {"topic": _OLD_TOPIC[name]}
    if name == "size_market":
        name, args = "search_companies", {**args, "count_only": True}
    if name == "search_companies":
        await _tool_search(db, t, dict(args))
    elif name == "my_data":
        await _tool_my_data(db, t, str(args.get("topic") or ""))
    elif name == "search_web":
        query = str(args.get("query") or "").strip()[:200]
        if not t.body.web_search:
            t.notes.append("Web search is switched off, so nothing was searched. Tell the person to turn on the Web search switch under the message box if they want it.")
        elif not query:
            t.notes.append("The web search needs a short query: a type of business and a place. Ask the person for it.")
        elif t.web_asked:
            t.notes.append("A web search is already waiting for the person to confirm.")
        else:
            t.web_asked = True
            t.proposals.append({"id": f"p{len(t.proposals)}", "kind": "web_search", "title": f"Search the web for “{query}”",
                                "detail": "Public web pages and directories. Results are unverified. You pay only for companies found, nothing if none.", "params": {"query": query}})
            t.steps.append({"label": "Prepared a web search for you to confirm", "detail": query, "ms": _ms(t0)})
            t.notes.append(f"A web search for '{query}' is on screen, waiting for the person to confirm. It costs credits per company found, nothing if none.")
    elif name == "add_to_list":
        if not t.filters or not business_records.normalize_filters(t.filters):
            t.notes.append("There is no search to save yet. Ask the person who they want to find first.")
            return
        how_many = min(max(int(args.get("how_many") or 25), 1), 200)
        list_name = str(args.get("list_name") or "Assistant list").strip()[:80] or "Assistant list"
        t.proposals.append({"id": f"p{len(t.proposals)}", "kind": "add_to_list", "title": f"Save up to {how_many} companies to “{list_name}”",
                            "detail": "Free. They are saved from the search above.", "params": {"filters": t.filters, "list_name": list_name, "how_many": how_many}})
        t.steps.append({"label": "Prepared a list for you to confirm", "detail": f"{list_name}, up to {how_many}", "ms": _ms(t0)})
        t.notes.append(f"A proposal to save up to {how_many} companies to the list '{list_name}' is on screen, waiting for the person to confirm.")
    elif name in ("check_list", "start_campaign"):
        hit = _list_named(t.lists, str(args.get("list_name") or ""))
        if not hit:
            t.notes.append(f"No list is called '{args.get('list_name', '')}'. The lists are: {', '.join(x['name'] for x in t.lists) or 'none'}.")
            return
        if name == "check_list":
            t.proposals.append({"id": f"p{len(t.proposals)}", "kind": "check_list", "title": f"Check “{hit['name']}”",
                                "detail": "You will see the price before anything is charged.", "params": {"list_id": hit["id"]}})
        else:
            t.proposals.append({"id": f"p{len(t.proposals)}", "kind": "campaign", "title": f"Start an email campaign to “{hit['name']}”",
                                "detail": "You set it up and review it before anything is sent.", "params": {"list_id": hit["id"]}})
        t.steps.append({"label": "Found your list", "detail": hit["name"], "ms": _ms(t0)})
        t.notes.append(f"A proposal for the list '{hit['name']}' is on screen, waiting for the person.")
    elif name == "propose_plan":
        await agent_runs.make_plan(db, t, args, "leads")
    elif name == "use_plugin":
        await agent_runs.make_switch(t, args, "leads")
    elif name == "show_credits":
        line = await _credits_line(db)
        t.steps.append({"label": "Read your credits", "detail": line, "ms": _ms(t0)})
        t.notes.append(line)
    else:
        t.notes.append(f"There is no tool called '{name_in}'. Do not call it again.")


def _prompt_for(context: str, notes: List[str]) -> str:
    if not notes:
        return _SYSTEM + "\n\n" + context
    return (_SYSTEM + "\n\n" + context + "\n\nWhat your tools have returned so far this turn (this is all you know; do not add companies or facts). "
            "Call another tool only if the person's request still needs one; otherwise answer now in two to four short sentences, saying what was found or prepared and what they can do next:\n- "
            + "\n- ".join(notes))


_DOING = {"search_companies": "Searching the company register", "my_data": "Reading your account", "show_credits": "Checking your credits",
          "propose_plan": "Writing the plan", "use_plugin": "Checking the other plugin", "add_to_list": "Preparing the list", "check_list": "Finding your list", "start_campaign": "Finding your list", "search_web": "Preparing a web search"}


async def _guard(db: AsyncSession) -> None:
    if await _spent_today(db) >= DAILY_MESSAGES:
        raise HTTPException(status_code=429, detail=f"You have used today's {DAILY_MESSAGES} assistant messages. They reset tomorrow.")


async def _events(body: AskIn, request: Request, db: AsyncSession):
    """One message, as it happens: status, tool, step and ui events, then one final event holding the whole reply.
    A failure the person must see arrives as an error event with its status code."""
    started = time.time()
    history = [{"role": "assistant" if m.get("role") in ("assistant", "ai", "bot") else "user", "content": str(m.get("content") or "")[:1500]}
               for m in body.history[-8:] if str(m.get("content") or "").strip()]
    lists = [{"id": str(x.get("id", "")), "name": str(x.get("name", ""))[:80], "count": x.get("count")} for x in body.lists[:60]]
    context = (await _business_line(db, request)
               + f"\nFilters in use now: {json.dumps(body.filters or {})}"
               + f"\nThe person's lists: {', '.join(x['name'] for x in lists) or 'none yet'}"
               + f"\nWeb search switch: {'ON, you may offer search_web' if body.web_search else 'OFF, you have no web search; if the register is not enough, say they can switch Web search on'}")
    last = body.state if isinstance(body.state, dict) else {}
    names = [str(n)[:80] for n in (last.get("last_names") or [])[:TOP] if str(n).strip()]
    if names:
        context += f"\nThe last search showed (in this order, so 'the second one' means number 2): {'; '.join(f'{i + 1}. {n}' for i, n in enumerate(names))}"
    remembered = [str(m).strip()[:300] for m in body.memory[:20] if str(m).strip()]
    if remembered:
        context += "\nThings the person asked you to remember (apply them; they are preferences, not facts about companies):\n- " + "\n- ".join(remembered)

    tools = TOOLS + ([WEB_TOOL] if body.web_search else [])
    turn = _Turn(body, lists)
    ctx_auth = current(request)
    turn.actor = {"operator_id": ctx_auth["operator_id"], "perms": ctx_auth["perms"]}
    messages = [*history, {"role": "user", "content": body.message}]
    ran: set = set()
    reply = ""
    answered = False
    for rnd in range(MAX_ROUNDS):
        yield {"type": "status", "text": "Thinking" if rnd == 0 else "Reading what came back"}
        plan = await llm_gateway.call_open_chat_llm_with_tools(
            messages=messages, tools=tools, system_prompt=_prompt_for(context, turn.notes), temperature=0.2, max_tokens=500, db=db, scope="leadgen")
        if not plan.get("success"):
            logger.warning("assistant plan failed: %s", plan.get("error"))
            if rnd == 0:
                yield {"type": "error", "status": 502, "message": "The AI service did not answer. Try again in a moment."}
                return
            break
        if rnd == 0:
            await _count_message(db)
        fresh = []
        for call in plan.get("tool_calls") or []:
            fn = call.get("function") or {}
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except ValueError:
                args = {}
            args = args if isinstance(args, dict) else {}
            sig = (fn.get("name"), json.dumps(args, sort_keys=True, default=str))
            if sig not in ran:
                ran.add(sig)
                fresh.append((fn.get("name") or "", args))
        if not fresh:
            reply = clean_reply(plan.get("reply") or "")
            answered = bool(reply)
            break
        for name, args in fresh[:MAX_ROUNDS]:
            yield {"type": "tool", "name": name, "text": _DOING.get(name, "Working")}
            seen, had_found = len(turn.steps), turn.found
            try:
                await _run_tool(db, turn, name, args)
            except Exception as err:  # one tool failing must not lose the rest of the turn
                logger.warning("assistant tool %s failed: %s", name, err)
                turn.notes.append(f"The {name} tool failed ({type(err).__name__}), so there is nothing from it. Say so plainly and offer to try again.")
                turn.steps.append({"label": f"Could not finish: {name.replace('_', ' ')}", "detail": "Something went wrong. Try again.", "ms": 0, "failed": True})
            for s in turn.steps[seen:]:
                yield {"type": "step", "step": s}
            if turn.found is not had_found and turn.found:
                yield {"type": "ui", "action": "filters", "filters": turn.found["filters"], "total": turn.found["total"]}

    if turn.notes and not answered:
        yield {"type": "status", "text": "Writing the answer"}
        final = await llm_gateway.call_open_chat_llm(
            messages=messages, system_prompt=_prompt_for(context, turn.notes) + "\n\nAnswer now, without calling anything else.",
            temperature=0.3, max_tokens=400, db=db, scope="leadgen")
        reply = clean_reply(final.get("reply") or "") if final.get("success") else ""
        if not reply:
            reply = proposal_reply(turn.proposals) or " ".join(n for n in turn.notes if not n.startswith("A proposal") and not n.startswith("A web search")) or "Done. Check what is on screen."
    if not reply:
        reply = "I'm not sure what to do with that. Tell me who you want to find, for example “cafes in Leeds”."

    found = turn.found
    has_profile = not context.startswith("The business profile is not filled in")
    thin = bool(found is not None and found["total"] <= THIN)
    yield {"type": "final", "result": {
        "reply": reply, "steps": turn.steps, "proposals": turn.proposals, "took_ms": int((time.time() - started) * 1000),
        "suggestions": suggestions(found=bool(found and found["total"]), proposals=bool(turn.proposals), lists=lists, has_profile=has_profile,
                                   asked=body.message, thin=thin, web=body.web_search),
        "found": ({"total": found["total"], "capped": found.get("capped", False), "filters": found["filters"], "top": found["top"]} if found else None),
        "state": {"last_total": found["total"] if found else last.get("last_total"),
                  "last_names": [c["name"] for c in found["top"]] if found else last.get("last_names", [])}}}


@router.post("/ask")
async def ask(body: AskIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    await _guard(db)
    async for ev in _events(body, request, db):
        if ev["type"] == "error":
            raise HTTPException(status_code=ev["status"], detail=ev["message"])
        if ev["type"] == "final":
            return ev["result"]
    raise HTTPException(status_code=502, detail="The AI service did not answer. Try again in a moment.")


def sse(ev: Dict[str, Any]) -> str:
    return f"data: {json.dumps(ev, default=str)}\n\n"


@router.post("/ask/stream")
async def ask_stream(body: AskIn, request: Request, db: AsyncSession = Depends(get_db)):
    """The same turn as /ask, sent as server-sent events so the chat can show each step the moment it is done."""
    await _guard(db)

    async def gen():
        try:
            async for ev in _events(body, request, db):
                yield sse(ev)
                if await request.is_disconnected():
                    return
        except Exception as err:  # the stream is already open, so the failure travels as an event
            logger.warning("assistant stream failed: %s", err)
            yield sse({"type": "error", "status": 500, "message": "Something went wrong. Try again."})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


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
