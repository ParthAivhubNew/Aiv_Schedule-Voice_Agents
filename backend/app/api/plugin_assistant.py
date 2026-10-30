"""The AI assistants beside Voice and Social, built on the same turn loop as the Leads one (services/assistant_engine.py).

POST /assistant/{plugin}/ask          one message, answered in one go
POST /assistant/{plugin}/ask/stream   the same turn as server-sent events, one per step as it happens

plugin is "voice" or "social". Each assistant only reads that plugin's own data for the signed-in organisation and prepares proposals
(open a screen, plan posts) that the person confirms on screen. Chat history stays with the plugin that was asked; nothing is shared.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import date, datetime, timedelta
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.tenancy import current_org
from app.database import get_db
from app.models.models import (CallList, CallLog, CallSchedule, CompanyProfile, ConversationTemplate, LeadAccount, OrgPhoneNumber, SocialAccount, SocialPost,
                               SocialPostMetric, VoiceAssistant)
from app.core.auth_middleware import current
from app.services import agent_runs, brand_voice, credits, llm_gateway
from app.services import workflows as WF
from app.services.assistant_engine import Spec, Turn, clean_reply, events, tool

logger = logging.getLogger("plugin_assistant")
router = APIRouter(prefix="/assistant", tags=["Assistant"])

DAILY_MESSAGES = 200  # per account, per plugin, per day
OUTCOMES = ["meeting_booked", "callback_requested", "rejected", "no_answer", "human_review", "contacted"]
VOICE_SCREENS = {"list": "Call list", "logs": "Conversations", "schedule": "Meetings & callbacks", "analytics": "Call stats", "templates": "AI caller", "company": "Business Setup"}
SOCIAL_SCREENS = {"plan": "Post calendar", "listening": "Mentions", "media": "Library", "accounts": "Accounts", "subscription": "Plan and credits"}


class PluginAskIn(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: List[Dict[str, Any]] = []
    memory: List[str] = []  # things the person asked the assistant to remember
    state: Dict[str, Any] = {}


# ── Shared pieces ───────────────────────────────────────────────────────────
def _usage_key(plugin: str) -> str:
    return f"assistant_usage:{plugin}:{current_org()}:{date.today().isoformat()}"


async def _spent_today(db: AsyncSession, plugin: str) -> int:
    return int((await credits._get_doc(db, _usage_key(plugin))).get("n", 0))


async def _count(db: AsyncSession, plugin: str) -> None:
    await credits._put_doc(db, _usage_key(plugin), {"n": await _spent_today(db, plugin) + 1})
    await db.commit()


def _ago(dt: Any) -> str:
    if not dt:
        return "unknown time"
    days = (datetime.utcnow() - dt).days
    return "today" if days <= 0 else "yesterday" if days == 1 else f"{days} days ago"


async def _show_credits(wallet: str, label: str, t: Turn, _args: Dict[str, Any]) -> None:
    t0 = time.time()
    left = await credits.wallet_balance(t.db, wallet)
    t.step("Read your credits", f"{left:,} left", t0)
    t.notes.append(f"{left:,} {label} credits left.")


def _open_screen(screens: Dict[str, str], plugin_hash: str):
    async def run(t: Turn, args: Dict[str, Any]) -> None:
        t0 = time.time()
        page = str(args.get("screen") or "")
        if page not in screens:
            t.notes.append(f"There is no screen called '{page}'. The screens are: {', '.join(f'{k} ({v})' for k, v in screens.items())}.")
            return
        t.propose("go", f"Open {screens[page]}", "Takes you there. Nothing changes.", {"hash": f"#/{plugin_hash}/{page}"})
        t.step("Found the screen", screens[page], t0)
        t.notes.append(f"A button to open {screens[page]} is on screen for the person to press.")
    return run


async def _company_line(db: AsyncSession) -> str:
    p = (await db.execute(select(CompanyProfile).limit(1))).scalars().first()
    name = (getattr(p, "name", "") or "").strip() if p else ""
    pitch = (getattr(p, "pitch", "") or "").strip() if p else ""
    if not name or name == "Your company":
        return "The business profile is not filled in yet, so you do not know what this business sells."
    return f"The business is {name}." + (f" What it does: {pitch[:400]}" if pitch else "")


# ── Voice ───────────────────────────────────────────────────────────────────
async def _call_results(t: Turn, args: Dict[str, Any]) -> None:
    t0 = time.time()
    days = min(max(int(args.get("days") or 7), 1), 90)
    since = datetime.utcnow() - timedelta(days=days)
    base = [CallLog.created_at >= since]
    by = dict((o or "contacted", n) for o, n in (await t.db.execute(select(CallLog.outcome, func.count()).where(*base).group_by(CallLog.outcome))).all())
    total = sum(by.values())
    if args.get("outcome") in OUTCOMES:
        base.append(CallLog.outcome == args["outcome"])
    rows = (await t.db.execute(select(CallLog).where(*base).order_by(CallLog.created_at.desc()).limit(8))).scalars().all()
    if not total:
        t.notes.append(f"No finished calls in the last {days} days.")
    else:
        t.notes.append(f"Last {days} days: {total} finished calls. By result: " + ", ".join(f"{k.replace('_', ' ')} {v}" for k, v in by.items())
                       + ". Latest: " + "; ".join(f"{r.canonical_name or r.listed_as} ({(r.outcome or 'contacted').replace('_', ' ')}, {_ago(r.created_at)}, {r.duration or '?'})" for r in rows))
    t.step("Read your call results", f"{total} calls in {days} days", t0)


async def _find_call(t: Turn, args: Dict[str, Any]) -> None:
    t0 = time.time()
    q = str(args.get("query") or "").strip()[:80]
    if not q:
        t.notes.append("The search needs a name, company or phone number. Ask the person for it.")
        return
    like = f"%{q}%"
    rows = (await t.db.execute(select(CallLog).where(or_(CallLog.canonical_name.ilike(like), CallLog.listed_as.ilike(like), CallLog.person_canonical.ilike(like),
                                                         CallLog.person_listed_as.ilike(like), CallLog.phone.ilike(like)))
                               .order_by(CallLog.created_at.desc()).limit(4))).scalars().all()
    if not rows:
        t.notes.append(f"No call found for '{q}'.")
    for r in rows:
        t.notes.append(f"Call with {r.canonical_name or r.listed_as} {_ago(r.created_at)}: {(r.outcome or 'contacted').replace('_', ' ')}, {r.duration or '?'}. "
                       f"Summary: {(r.summary or 'no summary yet').strip()[:500]}")
    t.step("Looked for the call", f"{len(rows)} found for “{q}”", t0)


async def _voice_setup(t: Turn, _args: Dict[str, Any]) -> None:
    t0 = time.time()
    nums = (await t.db.execute(select(OrgPhoneNumber).order_by(OrgPhoneNumber.created_at).limit(10))).scalars().all()
    agent = (await t.db.execute(select(VoiceAssistant).limit(3))).scalars().all()
    t.notes.append("Phone numbers: " + ("; ".join(f"{n.e164} ({n.label or 'no label'}, {n.status}{', default' if n.is_default else ''})" for n in nums) if nums else "none yet")
                   + ". AI caller: " + ("; ".join(f"{a.status}" + (f", voice {a.voice}" if a.voice else "") + (f", last error: {a.last_error[:100]}" if a.last_error else "") for a in agent) if agent else "not set up yet") + ".")
    t.step("Checked your numbers and AI caller", f"{len(nums)} numbers", t0)


async def _call_lists(t: Turn, _args: Dict[str, Any]) -> None:
    t0 = time.time()
    rows = (await t.db.execute(select(CallList).order_by(CallList.updated_at.desc()).limit(10))).scalars().all()
    t.notes.append("Call lists: " + "; ".join(f"{r.name} has {r.row_count} people, {r.called_count} already called" for r in rows) if rows else "The person has no call lists yet.")
    t.step("Read your call lists", f"{len(rows)} found", t0)


async def _call_schedules(t: Turn, _args: Dict[str, Any]) -> None:
    t0 = time.time()
    rows = (await t.db.execute(select(CallSchedule).order_by(CallSchedule.created_at.desc()).limit(10))).scalars().all()
    t.notes.append("Scheduled calls: " + "; ".join(f"{r.name} is {r.status}, {r.frequency}, at {', '.join(r.times or [])}" for r in rows) if rows else "No calls are scheduled.")
    t.step("Read your scheduled calls", f"{len(rows)} found", t0)


CALL_HEADERS = ["Company name", "Contact name", "Phone", "Email", "Website", "Lead ID"]


async def _generate(db: AsyncSession, scope: str, system: str, prompt: str, max_tokens: int = 500) -> str:
    """One piece of writing from the model, or "" when it could not be done. Nothing is saved."""
    res = await llm_gateway.call_open_chat_llm(messages=[{"role": "user", "content": prompt}], system_prompt=system, temperature=0.5, max_tokens=max_tokens, db=db, scope=scope)
    return clean_reply(res.get("reply") or "") if res and res.get("success") else ""


async def call_list_rows(db: AsyncSession, leads_list: str) -> Dict[str, Any]:
    """The rows of a call list made from one of the person's Leads lists: the companies that have a phone number. The rest are counted, not dropped silently."""
    from app.api.lead_lists import _load

    want = (leads_list or "").strip().lower()
    lst = next((l for l in await _load(db) if str(l.get("name", "")).strip().lower() == want), None)
    if lst is None:
        return {"found": False, "rows": [], "left_out": 0}
    leads = (await db.execute(select(LeadAccount).where(LeadAccount.id.in_(lst.get("ids", [])[:2000])))).scalars().all()
    rows, left_out = [], 0
    for a in leads:
        if not (a.phone or "").strip():
            left_out += 1
            continue
        rows.append({"Company name": a.name or "", "Contact name": a.contact_name or "", "Phone": a.phone, "Email": a.email or "", "Website": a.website or "", "Lead ID": a.id})
    return {"found": True, "name": lst["name"], "rows": rows, "left_out": left_out}


async def create_call_list(db: AsyncSession, name: str, rows: List[Dict[str, Any]], who: str = "") -> CallList:
    """Saves a call list (a list with the same name is replaced, as on the Call list screen). The calls themselves still go through the Call list screen's checks."""
    name = " ".join((name or "").split())[:80] or "Call list"
    hit = (await db.execute(select(CallList).where(func.lower(CallList.name) == name.lower()))).scalars().first()
    if hit is None:
        hit = CallList(id=f"cl_{__import__('uuid').uuid4().hex[:12]}", name=name, created_by=who)
        db.add(hit)
    hit.headers, hit.rows, hit.row_count, hit.called_count = list(CALL_HEADERS), list(rows), len(rows), 0
    hit.updated_at = datetime.utcnow()
    await db.commit()
    return hit


async def _call_transcript(t: Turn, args: Dict[str, Any]) -> None:
    t0 = time.time()
    q = str(args.get("query") or "").strip()[:80]
    like = f"%{q}%"
    row = (await t.db.execute(select(CallLog).where(or_(CallLog.canonical_name.ilike(like), CallLog.listed_as.ilike(like), CallLog.phone.ilike(like)))
                              .order_by(CallLog.created_at.desc()).limit(1))).scalars().first() if q else None
    if row is None:
        t.notes.append(f"No call found for '{q}'." if q else "The search needs a name, company or phone number. Ask the person for it.")
        t.step("Looked for the call", "none found", t0)
        return
    lines = [x for x in (row.transcript or []) if isinstance(x, dict)][-40:]
    said = " | ".join(f"{'Caller' if x.get('who') == 'them' else 'AI'}: {str(x.get('text') or '')[:220]}" for x in lines if x.get("text"))
    t.notes.append(f"Transcript of the call with {row.canonical_name or row.listed_as} {_ago(row.created_at)} (last {len(lines)} lines): {said or 'no transcript was kept'}")
    t.step("Read the call transcript", f"{row.canonical_name or row.listed_as}, {len(lines)} lines", t0)


async def _knowledge_search(t: Turn, args: Dict[str, Any]) -> None:
    from app.services.rag_service import search_knowledge

    t0 = time.time()
    q = str(args.get("question") or "").strip()[:300]
    if not q:
        t.notes.append("The search needs a question. Ask the person for it.")
        return
    hits = await search_knowledge(t.db, query=q, top_k=3)
    if not hits:
        t.notes.append(f"Nothing in the person's uploaded documents matches '{q}'. Say so plainly; do not answer from memory as if it were in their documents.")
    for h in hits:
        t.notes.append(f"From the document “{(h.get('title') or 'untitled')[:80]}”: {str(h.get('content') or '')[:600]}")
    t.step("Searched your documents", f"{len(hits)} passage{'s' if len(hits) != 1 else ''} for “{q[:60]}”", t0)


async def _draft_greeting(t: Turn, args: Dict[str, Any]) -> None:
    t0 = time.time()
    about = str(args.get("about") or "").strip()[:400]
    prof = (await t.db.execute(select(CompanyProfile).limit(1))).scalars().first()
    tpl = (await t.db.execute(select(ConversationTemplate).where(ConversationTemplate.call_direction == "outbound").limit(1))).scalars().first()
    current = (getattr(tpl, "greeting_template", "") or "").strip()[:400]
    company = (getattr(prof, "name", "") or "").strip()
    if not company or company == "Your company":
        t.notes.append("The business profile is not filled in, so a greeting would be generic. Tell the person to fill in Business Setup first.")
        return
    text = await _generate(t.db, "voice", "You write the opening line an AI phone caller says when a call connects, for a UK business. Short, warm, plain, no hype, no invented facts. "
                           "Keep placeholders such as {{prospect.name}} and {{company.name}} exactly as written. Give exactly two options, numbered 1 and 2, each under 35 words.",
                           f"Company: {company}. What it does: {(getattr(prof, 'pitch', '') or '')[:300]}. Caller name: {getattr(prof, 'caller_name', '') or 'Sam'}.\n"
                           f"Current greeting: {current or '(none yet)'}\nWhat the person wants: {about or 'a friendlier, shorter opening'}")
    if text:
        t.verbatim.append(text)
        t.notes.append("Two draft greetings were written and are shown under your answer word for word. Introduce them in one sentence and say nothing was changed: the person edits the real greeting under AI caller. Do not repeat the greetings.")
    else:
        t.notes.append("The greeting could not be written just now. Try again.")
    t.step("Drafted greetings", "two options", t0)


async def _build_call_list(t: Turn, args: Dict[str, Any]) -> None:
    t0 = time.time()
    built = await call_list_rows(t.db, str(args.get("leads_list") or ""))
    if not built["found"]:
        t.notes.append(f"No Leads list is called '{args.get('leads_list', '')}'. Ask the person which list, or use use_plugin to ask the Leads assistant for their list names.")
        return
    if not built["rows"]:
        t.notes.append(f"None of the {built['left_out']} companies in “{built['name']}” has a phone number, so there is no one to call. Suggest checking the list in Leads first.")
        return
    name = " ".join(str(args.get("call_list_name") or built["name"]).split())[:80]
    t.propose("call_list", f"Make the call list “{name}”", f"{len(built['rows'])} people with a phone number" + (f"; {built['left_out']} left out (no phone)." if built["left_out"] else "."),
              {"name": name, "headers": CALL_HEADERS, "rows": built["rows"][:500], "left_out": built["left_out"], "hash": "#/voice/list"})
    t.step("Prepared a call list for you to confirm", f"{len(built['rows'])} people", t0)
    t.notes.append(f"A button to make the call list '{name}' ({len(built['rows'])} people) is on screen. Calls only start from the Call list screen, after its checks.")


VOICE = Spec(
    plugin="voice", scope="voice",
    system=("You are the assistant inside the Voice part of Outreach by Aivhub, where an AI caller phones people for a UK business. "
            "You can read the person's own calls, call lists, schedules, numbers and credits through your tools. Never state a call, number, name or figure a tool did not return, "
            "and say plainly when something is not known. You cannot place calls or change the AI caller yourself: when the person wants that, use open_screen to give them "
            "a button to the right screen, and say what to do there. Keep answers short, plain and friendly. Pick ONE tool per need and do not repeat a call that already ran. "
            "If a request is missing something you need, ask ONE short question. If the message is not about their calling, answer it directly without a tool."),
    tools=[
        tool("call_results", "USE for how calls went: totals by result (meeting booked, callback, rejected, no answer) and the latest calls. Free.",
             {"days": {"type": "integer", "description": "1 to 90, default 7"}, "outcome": {"type": "string", "enum": OUTCOMES}}),
        tool("find_call", "USE to find a particular call by the person's or company's name or phone number and read its summary. Free.", {"query": {"type": "string"}}, ["query"]),
        tool("voice_setup", "USE for the person's phone numbers and the state of their AI caller. Free."),
        tool("call_lists", "USE for the person's saved call lists and how many people were already called. Free."),
        tool("call_schedules", "USE for calls scheduled to run later or repeatedly. Free."),
        tool("show_credits", "USE when the person asks how many credits (calling minutes) they have. Free."),
        tool("open_screen", "USE when the person wants to make calls, schedule calls, change the AI caller's script or voice, or see stats: gives them a button to that screen.",
             {"screen": {"type": "string", "enum": list(VOICE_SCREENS)}}, ["screen"]),
        tool("call_transcript", "USE to read what was actually said on one call (by the person's or company's name or phone number). Free.", {"query": {"type": "string"}}, ["query"]),
        tool("knowledge_search", "USE to answer a question from the person's own uploaded documents (what the AI caller knows). Shows the passages it found. Free.", {"question": {"type": "string"}}, ["question"]),
        tool("draft_greeting", "USE when the person wants a better opening line for the AI caller: writes two options for them to read. Changes nothing.", {"about": {"type": "string", "description": "what they want different"}}),
        tool("build_call_list", "USE to turn one of the person's Leads lists into a call list (only people with a phone number). Shows a button; nothing is made until they press it.",
             {"leads_list": {"type": "string"}, "call_list_name": {"type": "string"}}, ["leads_list"]),
    ],
    handlers={"call_transcript": _call_transcript, "knowledge_search": _knowledge_search, "draft_greeting": _draft_greeting, "build_call_list": _build_call_list, "call_results": _call_results, "find_call": _find_call, "voice_setup": _voice_setup, "call_lists": _call_lists, "call_schedules": _call_schedules,
              "show_credits": lambda t, a: _show_credits("voice", "calling", t, a), "open_screen": _open_screen(VOICE_SCREENS, "voice")},
    doing={"call_transcript": "Reading the call", "knowledge_search": "Searching your documents", "draft_greeting": "Writing greetings", "build_call_list": "Building the call list",
           "call_results": "Reading your calls", "find_call": "Looking for the call", "voice_setup": "Checking your numbers", "call_lists": "Reading your call lists",
           "call_schedules": "Reading your schedule", "show_credits": "Checking your credits", "open_screen": "Finding the screen"},
    suggest=lambda t: ["How did my calls go this week?", "Which calls ended in a meeting?", "Do I have any calls scheduled?", "How many credits do I have left?",
                       "Is my AI caller set up?", "Help me schedule calls to a list"],
    fallback="I'm not sure what to do with that. Ask about your calls, call lists or schedule, for example “how did my calls go this week?”.",
    once=frozenset({"draft_greeting"}),
)


# ── Social ──────────────────────────────────────────────────────────────────
async def _post_overview(t: Turn, _args: Dict[str, Any]) -> None:
    t0 = time.time()
    by = dict((s or "draft", n) for s, n in (await t.db.execute(select(SocialPost.status, func.count()).group_by(SocialPost.status))).all())
    now_ms = time.time() * 1000
    nxt = (await t.db.execute(select(SocialPost).where(SocialPost.due_at_ms >= now_ms, SocialPost.status.notin_(["published", "failed", "rejected"]))
                              .order_by(SocialPost.due_at_ms).limit(6))).scalars().all()
    t.notes.append(("Posts by status: " + ", ".join(f"{k.replace('_', ' ')} {v}" for k, v in by.items())) if by else "The person has no posts yet.")
    if nxt:
        t.notes.append("Next to go out: " + "; ".join(f"“{p.title[:60]}” on {', '.join(p.channels or [])} at {datetime.utcfromtimestamp(p.due_at_ms / 1000).strftime('%d %b %H:%M')} UTC ({p.status.replace('_', ' ')})" for p in nxt))
    t.step("Read your posts", f"{sum(by.values())} posts", t0)


async def _post_results(t: Turn, args: Dict[str, Any]) -> None:
    t0 = time.time()
    days = min(max(int(args.get("days") or 30), 1), 180)
    since = datetime.utcnow() - timedelta(days=days)
    rows = (await t.db.execute(select(SocialPostMetric, SocialPost.title).join(SocialPost, SocialPost.id == SocialPostMetric.post_id)
                               .where(SocialPostMetric.published_at >= since).order_by(SocialPostMetric.reach.desc().nullslast()).limit(5))).all()
    if not rows:
        t.notes.append(f"No published posts with numbers from the networks in the last {days} days.")
    else:
        def n(v: Any) -> str:
            return "not reported" if v is None else f"{v:,}"
        t.notes.append(f"Best posts in the last {days} days by reach: " + "; ".join(
            f"“{title[:60]}” on {m.platform}: reach {n(m.reach)}, likes {n(m.likes)}, comments {n(m.comments)}, clicks {n(m.clicks)}" for m, title in rows))
    t.step("Read your post results", f"{len(rows)} posts", t0)


async def _my_accounts(t: Turn, _args: Dict[str, Any]) -> None:
    t0 = time.time()
    rows = (await t.db.execute(select(SocialAccount).order_by(SocialAccount.platform))).scalars().all()
    t.notes.append("Connected accounts: " + "; ".join(f"{a.platform} {a.handle or a.label or ''} is {a.status}" + (f" ({a.last_error[:100]})" if a.last_error and a.status != "connected" else "") for a in rows)
                   if rows else "No social account is connected yet.")
    t.step("Checked your accounts", f"{len(rows)} connected", t0)


async def _plan_posts(t: Turn, args: Dict[str, Any]) -> None:
    t0 = time.time()
    ask = str(args.get("request") or "").strip()[:500]
    if not ask:
        t.notes.append("Ask the person what the posts should be about and when.")
        return
    t.propose("plan", "Plan these posts", "Opens the post planner with your request. You review the plan before anything is scheduled.", {"prompt": ask, "hash": "#/scheduler/plan"})
    t.step("Prepared a plan for you to confirm", ask[:80], t0)
    t.notes.append(f"A button to plan posts for '{ask}' is on screen. The planner writes them and the person reviews before anything goes out.")


async def _post_details(t: Turn, args: Dict[str, Any]) -> None:
    t0 = time.time()
    q = str(args.get("query") or "").strip()[:80]
    like = f"%{q}%"
    rows = (await t.db.execute(select(SocialPost).where(or_(SocialPost.title.ilike(like), SocialPost.copy.ilike(like))).order_by(SocialPost.slot_date_ms.desc().nullslast()).limit(3))).scalars().all() if q else []
    if not rows:
        t.notes.append(f"No post matches '{q}'." if q else "The search needs a few words from the post. Ask the person for them.")
        t.step("Looked for the post", "none found", t0)
        return
    for p in rows:
        when = datetime.utcfromtimestamp(p.due_at_ms / 1000).strftime("%d %b %H:%M UTC") if p.due_at_ms else "no date"
        m = (await t.db.execute(select(SocialPostMetric).where(SocialPostMetric.post_id == p.id))).scalars().all()
        nums = "; ".join(f"{x.platform}: reach {'not reported' if x.reach is None else f'{x.reach:,}'}, likes {'not reported' if x.likes is None else x.likes}" for x in m) or "no numbers yet"
        t.notes.append(f"Post “{p.title[:80]}” ({p.status.replace('_', ' ')}, {', '.join(p.channels or [])}, {when}): {(p.copy or '(no text yet)')[:700]} | Results: {nums}")
    t.step("Read the post", f"{len(rows)} found for “{q[:50]}”", t0)


async def _write_caption(t: Turn, args: Dict[str, Any]) -> None:
    t0 = time.time()
    brief = str(args.get("brief") or "").strip()[:600]
    channel = str(args.get("channel") or "linkedin").strip().lower()[:20]
    if not brief:
        t.notes.append("A caption needs a topic. Ask the person what the post is about.")
        return
    prof = (await t.db.execute(select(CompanyProfile).limit(1))).scalars().first()
    company = (getattr(prof, "name", "") or "").strip()
    if not company or company == "Your company":
        t.notes.append("The business profile is not filled in, so a caption would be generic. Tell the person to fill in the company profile first.")
        return
    voice = brand_voice.prompt_block(await brand_voice.load(t.db))
    text = await _generate(t.db, "scheduler", f"You write one social media post for {channel} for a UK business, in its own voice. Plain words, no hype, no invented facts, figures or quotes, "
                           f"no hashtags unless asked. Only the post text, nothing else.\n{voice}",
                           f"Company: {company}. What it does: {(getattr(prof, 'pitch', '') or '')[:300]}.\nWhat the post is about: {brief}", 450)
    if text:
        t.verbatim.append(text)
        t.notes.append(f"A draft {channel} post was written and is shown under your answer word for word. Introduce it in one sentence and say it is not saved: the person can send it to the planner. Do not repeat the post.")
    else:
        t.notes.append("The caption could not be written just now. Try again.")
    t.step("Wrote a draft post", channel, t0)


SOCIAL = Spec(
    plugin="social", scope="scheduler",
    system=("You are the assistant inside the Social part of Outreach by Aivhub, where a UK business plans, writes and publishes social posts. "
            "You can read the person's own posts, results, connected accounts and credits through your tools. Never state a post, figure or account a tool did not return, "
            "and say plainly when something is not known or a network did not report it. You cannot publish or edit posts yourself: when the person wants posts written or planned, "
            "use plan_posts with their request so the planner opens ready for them; for anything else use open_screen. Keep answers short, plain and friendly. "
            "Pick ONE tool per need and do not repeat a call that already ran. If a request is missing something you need, ask ONE short question. "
            "If the message is general advice about social media, answer it directly without a tool."),
    tools=[
        tool("post_overview", "USE for how many posts are drafts, awaiting approval, scheduled or published, and which go out next. Free."),
        tool("post_results", "USE for how published posts performed: best posts by reach, likes, comments and clicks. Free.", {"days": {"type": "integer", "description": "1 to 180, default 30"}}),
        tool("my_accounts", "USE for which social accounts are connected and whether any has an error. Free."),
        tool("show_credits", "USE when the person asks how many credits they have. Free."),
        tool("plan_posts", "USE when the person wants posts planned or written: pass their request in their own words, including topic, channels and dates if given.",
             {"request": {"type": "string"}}, ["request"]),
        tool("open_screen", "USE to take the person to a Social screen.", {"screen": {"type": "string", "enum": list(SOCIAL_SCREENS)}}, ["screen"]),
        tool("post_details", "USE to read one post: its text, status, channels, date and results. Free.", {"query": {"type": "string", "description": "a few words from the post"}}, ["query"]),
        tool("write_caption", "USE to write a draft post in the company's own voice when the person wants to see wording before planning. Nothing is saved or scheduled.",
             {"brief": {"type": "string"}, "channel": {"type": "string", "enum": ["linkedin", "x", "facebook", "instagram", "threads"]}}, ["brief"]),
    ],
    handlers={"post_details": _post_details, "write_caption": _write_caption, "post_overview": _post_overview, "post_results": _post_results, "my_accounts": _my_accounts, "show_credits": lambda t, a: _show_credits("scheduler", "Social", t, a),
              "plan_posts": _plan_posts, "open_screen": _open_screen(SOCIAL_SCREENS, "scheduler")},
    doing={"post_details": "Reading the post", "write_caption": "Writing a draft", "post_overview": "Reading your posts", "post_results": "Reading your results", "my_accounts": "Checking your accounts", "show_credits": "Checking your credits",
           "plan_posts": "Preparing the plan", "open_screen": "Finding the screen"},
    suggest=lambda t: ["What is scheduled to go out?", "How did my posts do this month?", "Are my accounts connected?", "Plan 3 posts for next week",
                       "How many credits do I have left?", "What should I post about?"],
    fallback="I'm not sure what to do with that. Ask about your posts, results or accounts, or tell me what to plan.",
    once=frozenset({"write_caption"}),
)

def _planning(spec: Spec, origin: str) -> None:
    """Every assistant can plan a job with the person and ask to switch to another plugin's assistant."""
    spec.system += agent_runs.AGENT_PROMPT
    spec.tools += agent_runs.plan_tools() + [WF.workflow_tool()]

    async def plan(t: Turn, args: Dict[str, Any]) -> None:
        await agent_runs.make_plan(t.db, t, args, origin)

    async def switch(t: Turn, args: Dict[str, Any]) -> None:
        await agent_runs.make_switch(t, args, origin)

    async def workflow(t: Turn, args: Dict[str, Any]) -> None:
        await WF.make_workflow_card(t, args)

    spec.handlers.update({"propose_plan": plan, "use_plugin": switch, "create_workflow": workflow})
    spec.doing.update({"propose_plan": "Writing the plan", "use_plugin": "Checking the other plugin", "create_workflow": "Writing the workflow"})


_planning(VOICE, "voice")
_planning(SOCIAL, "social")
SPECS = {"voice": VOICE, "social": SOCIAL}


def _spec(plugin: str) -> Spec:
    if plugin not in SPECS:
        raise HTTPException(status_code=404, detail="There is no assistant for that.")
    return SPECS[plugin]


async def _stream(plugin: str, body: PluginAskIn, db: AsyncSession, actor: Dict[str, Any]):
    spec = _spec(plugin)
    context = await _company_line(db)
    remembered = [str(m).strip()[:300] for m in body.memory[:20] if str(m).strip()]
    if remembered:
        context += "\nThings the person asked you to remember (apply them; they are preferences, not facts):\n- " + "\n- ".join(remembered)

    async def count() -> None:
        await _count(db, plugin)

    async for ev in events(spec, db, body.message, body.history, context, count, actor):
        yield ev


def _actor(request: Request) -> Dict[str, Any]:
    ctx = current(request)
    return {"operator_id": ctx["operator_id"], "perms": ctx["perms"]}


async def _guard(db: AsyncSession, plugin: str) -> None:
    _spec(plugin)
    if await _spent_today(db, plugin) >= DAILY_MESSAGES:
        raise HTTPException(status_code=429, detail=f"You have used today's {DAILY_MESSAGES} assistant messages. They reset tomorrow.")


@router.post("/{plugin}/ask")
async def ask(plugin: str, body: PluginAskIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    await _guard(db, plugin)
    async for ev in _stream(plugin, body, db, _actor(request)):
        if ev["type"] == "error":
            raise HTTPException(status_code=ev["status"], detail=ev["message"])
        if ev["type"] == "final":
            return ev["result"]
    raise HTTPException(status_code=502, detail="The AI service did not answer. Try again in a moment.")


@router.post("/{plugin}/ask/stream")
async def ask_stream(plugin: str, body: PluginAskIn, request: Request, db: AsyncSession = Depends(get_db)):
    await _guard(db, plugin)
    actor = _actor(request)

    async def gen():
        try:
            async for ev in _stream(plugin, body, db, actor):
                yield f"data: {json.dumps(ev, default=str)}\n\n"
                if await request.is_disconnected():
                    return
        except Exception as err:  # the stream is already open, so the failure travels as an event
            logger.warning("%s assistant stream failed: %s", plugin, err)
            yield f"data: {json.dumps({'type': 'error', 'status': 500, 'message': 'Something went wrong. Try again.'})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
