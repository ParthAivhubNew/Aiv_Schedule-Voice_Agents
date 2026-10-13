"""Smart email writing that knows both firms and never invents a fact.

Two firms are involved, and the AI is only allowed to use what each is known to be:
  * the SENDER: what the user typed about their own business (company, what they sell, who for, proof, offer);
  * the RECEIVER: facts we hold about that company, each labelled with where it came from (the company
    register, the user's own list, or a web lookup that is marked unverified).

Every piece of writing is then checked by code, not by the AI: a number, a name, a product claim or a
merge field that is not in those facts is flagged, and a personalised line that fails the check is
dropped rather than sent. A missing sentence is always better than a wrong one.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import re
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

logger = logging.getLogger("email_writer")

MERGE_FIELDS = {"first_name", "last_name", "company", "personal_line"}
MAX_DAILY_AI_CALLS = 300  # per organisation, a guard against a runaway loop
PER_CREDIT = 5  # personalised lines per credit

_PROFILE_LIMITS = {"company": 120, "website": 200, "sells": 700, "audience": 400, "offer": 300,
                   "tone": 60, "sender_name": 80, "sender_title": 80}

_SPAM = ["guaranteed", "100% free", "act now", "click here", "risk-free", "risk free", "limited time", "once in a lifetime",
         "make money", "winner", "congratulations", "urgent", "$$$", "!!!", "buy now", "order now"]

# Words that may start a capitalised phrase without being a made-up name.
_OK_CAPS = {
    "hi", "hello", "dear", "hey", "best", "regards", "thanks", "thank", "kind", "sincerely", "cheers", "warm", "many", "ps", "p.s",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march", "april", "may",
    "june", "july", "august", "september", "october", "november", "december", "uk", "united", "kingdom", "british", "england",
    "scotland", "wales", "ireland", "i", "i'm", "i've", "i'd", "i'll", "ltd", "limited", "plc", "llp", "the", "a", "an", "and",
    "if", "we", "our", "you", "your", "it", "is", "of", "on", "in", "at", "to", "for", "with", "this", "that",
}


class WriterUnavailable(Exception):
    """The writing AI could not answer. Nothing is ever made up in its place."""


# ── The sender: "About your business" ───────────────────────────────────────
def clean_profile(raw: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {k: " ".join(str((raw or {}).get(k) or "").split())[:n] for k, n in _PROFILE_LIMITS.items()}
    proof = (raw or {}).get("proof") or []
    if isinstance(proof, str):
        proof = [p for p in proof.splitlines()]
    out["proof"] = [" ".join(str(p).split())[:240] for p in proof if str(p).strip()][:6]
    return out


def profile_missing(p: Dict[str, Any]) -> List[str]:
    labels = {"company": "your company name", "sells": "what you sell", "sender_name": "the name emails are signed with"}
    return [label for k, label in labels.items() if not (p.get(k) or "").strip()]


def sender_texts(p: Dict[str, Any]) -> List[str]:
    return [p.get(k, "") for k in ("company", "website", "sells", "audience", "offer", "sender_name", "sender_title")] + list(p.get("proof") or [])


def _profile_prompt(p: Dict[str, Any]) -> str:
    lines = [f"Company: {p.get('company', '')}", f"What they sell: {p.get('sells', '')}"]
    for key, label in (("audience", "Who it is for"), ("offer", "What to offer the reader"), ("website", "Website"),
                       ("sender_name", "Sign-off name"), ("sender_title", "Sender's job title"), ("tone", "Tone")):
        if p.get(key):
            lines.append(f"{label}: {p[key]}")
    if p.get("proof"):
        lines.append("Proof points (the ONLY results or numbers you may quote): " + " | ".join(p["proof"]))
    else:
        lines.append("Proof points: none given, so quote no results, numbers, customers or case studies.")
    return "\n".join(lines)


# ── The receiver: facts, each with its source ───────────────────────────────
_SIZE = {"micro": "a micro-sized company by its filed accounts", "small": "a small company by its filed accounts",
         "medium_large": "a medium or large company by its filed accounts"}


def recipient_facts(acct: Any, biz: Any = None, extra: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """What we know about one company, every line labelled. Nothing here is guessed. `extra` are facts the sender
    supplied themselves about this company (an API caller's own lead notes)."""
    facts: List[Dict[str, Any]] = []

    def add(text: str, source: str, verified: bool) -> None:
        text = " ".join(str(text or "").split())
        if text:
            facts.append({"id": f"f{len(facts) + 1}", "text": text[:300], "source": source, "verified": verified})

    region = (getattr(biz, "region", "") or getattr(acct, "region", "") or "").strip()
    if region:
        add(f"It is based in {region}.", "company register" if getattr(biz, "region", "") else "your list", bool(getattr(biz, "region", "")))
    industry = (getattr(acct, "industry", "") or "").strip()
    sic = (getattr(biz, "sic_text", "") or "").replace("|", "; ").strip()
    if sic:
        add(f"Its registered activity is: {sic[:200]}.", "company register", True)
    elif industry:
        add(f"Its industry is {industry}.", "your list", False)
    inc = getattr(biz, "incorporated_on", None)
    status = (getattr(biz, "status", "") or "").lower()
    if inc and status in ("active", ""):
        years = max(0, date.today().year - inc.year)
        add(f"It was registered in {inc.year}" + (f", so it has been trading for about {years} years." if years >= 2 else "."), "company register", True)
    size = _SIZE.get((getattr(biz, "size_band", "") or "").lower())
    if size:
        add(f"It is {size}.", "company register", True)
    contact, title = (getattr(acct, "contact_name", "") or "").strip(), (getattr(acct, "contact_title", "") or "").strip()
    if contact and title:
        add(f"{contact} is its {title}.", "company register" if getattr(biz, "officers", None) else "your list", bool(getattr(biz, "officers", None)))
    overview = ((getattr(acct, "research", None) or {}).get("overview") or "").strip()
    if overview:
        add(f"From their public web pages (not verified): {overview[:300]}", "web lookup", False)
    for note in (extra or [])[:8]:
        add(note, "supplied by the sender", False)
    return facts


_FREE_MAIL = {"gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "msn.com", "yahoo.com", "yahoo.co.uk",
              "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "btinternet.com", "sky.com", "talktalk.net"}


async def register_match(db: Any, number: str = "", website: str = "", email: str = "") -> Any:
    """The company register entry for a lead, only when it is certain: the exact company number, or a website
    domain that belongs to exactly one registered company. A name alone is never enough, so a lookalike can't be matched."""
    from sqlalchemy import select

    from app.models.models import BusinessRecord
    from app.services import business_records

    num = business_records._norm(number)
    if num:
        rows = (await db.execute(select(BusinessRecord).where(BusinessRecord.registration_number.in_([number.strip(), num, num.upper()])).limit(2))).scalars().all()
        if len(rows) == 1:
            return rows[0]
    host = re.sub(r"^https?://", "", (website or "").strip().lower()).split("/")[0].removeprefix("www.")
    if not host and "@" in (email or ""):
        host = email.rsplit("@", 1)[1].strip().lower()
    if host and "." in host and host not in _FREE_MAIL:
        rows = (await db.execute(select(BusinessRecord).where(BusinessRecord.domain == host).limit(2))).scalars().all()
        if len(rows) == 1:
            return rows[0]
    return None


def _names_for(acct: Any) -> List[str]:
    first = (getattr(acct, "contact_name", "") or "").split(" ")[0]
    return [getattr(acct, "name", "") or "", first]


# ── The checker: code, not the AI, decides what may go out ──────────────────
_NUM = re.compile(r"[£$€]?\d[\d,]*(?:\.\d+)?%?")
_UNIT = re.compile(r"\b\d{1,2}[- ]?(?:minutes?|mins?|days?|weeks?|hours?)\b", re.I)
_PROPER = re.compile(r"(?<![\w'’])([A-Z][A-Za-z&'’-]+)")


def _words(texts: List[str]) -> set:
    return {w.lower() for t in texts for w in re.findall(r"[A-Za-z0-9&'’-]+", t or "")}


def _numbers(texts: List[str]) -> set:
    return {n.replace(",", "") for t in texts for n in _NUM.findall(t or "")}


def violations(text: str, allowed: List[str], *, max_words: int = 150) -> List[str]:
    """Everything in `text` that the facts do not back up. Empty means it may be used."""
    out: List[str] = []
    low = (text or "").lower()
    for phrase in _SPAM:
        if phrase in low:
            out.append(f"the spam-trigger phrase '{phrase}'")
    for m in re.finditer(r"\{\{\s*([A-Za-z_]+)\s*\}\}", text or ""):
        if re.sub(r"[^a-z]", "", m.group(1).lower()) not in {f.replace("_", "") for f in MERGE_FIELDS}:
            out.append(f"the unknown merge field {m.group(0)}")
    body = re.sub(r"\{\{[^}]*\}\}", " ", text or "")
    have_numbers = _numbers(allowed)
    for n in _NUM.findall(_UNIT.sub(" ", body)):
        if n.replace(",", "") not in have_numbers:
            out.append(f"the figure {n}, which is not in the facts given")
    have_words = _words(allowed)
    seen: set = set()
    for m in _PROPER.finditer(body):
        word = m.group(1)
        # The first word of a sentence or of a new paragraph is capitalised anyway, so it says nothing about names.
        sentence_start = bool(re.search(r"(?:^|[.!?:\"“(\n])\s*$", body[: m.start()]))
        low_word = word.lower().strip("'’-")
        if sentence_start or low_word in have_words or low_word in _OK_CAPS or (word.isupper() and len(word) <= 4) or low_word in seen:
            continue
        seen.add(low_word)
        out.append(f"the name '{word}', which is not in the facts given")
    count = len(body.split())
    if count > max_words:
        out.append(f"too long ({count} words)")
    return out[:8]


# ── Talking to the AI ───────────────────────────────────────────────────────
def _parse(reply: str) -> Dict[str, Any]:
    text = (reply or "").strip()
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise WriterUnavailable("The AI did not answer in the expected form.")
    try:
        return json.loads(text[start:end + 1])
    except ValueError as err:
        raise WriterUnavailable("The AI did not answer in the expected form.") from err


async def writer_credentials(db: Any) -> Dict[str, Any]:
    """The writing AI's keys, looked up once so many lines can be written at the same time without sharing a session."""
    from app.services.llm_gateway import resolve_llm_credentials

    try:
        return await resolve_llm_credentials(db=db, scope="leadgen")
    except Exception as err:  # noqa: BLE001
        raise WriterUnavailable(str(err)) from err


async def _ask(db: Any, system: str, user: str, *, max_tokens: int = 1400, creds: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    from app.services.llm_gateway import call_open_chat_llm

    try:
        if creds:
            res = await call_open_chat_llm(messages=[{"role": "user", "content": user}], system_prompt=system, temperature=0.3,
                                           max_tokens=max_tokens, api_key=creds.get("api_key"), provider=creds.get("provider"),
                                           model=creds.get("model"), base_url=creds.get("base_url"))
        else:
            res = await call_open_chat_llm(messages=[{"role": "user", "content": user}], system_prompt=system, temperature=0.3,
                                           max_tokens=max_tokens, db=db, scope="leadgen")
    except Exception as err:  # noqa: BLE001 -- any failure means no AI, never a made-up email
        logger.warning(f"[email_writer] AI call failed: {err}")
        raise WriterUnavailable(str(err)) from err
    return _parse(res.get("reply") or "")


async def spend_allowance(db: Any, org: str, calls: int = 1) -> None:
    from app.services import credits as credit

    key, today = f"leadwrite:{org}", date.today().isoformat()
    doc = await credit._get_doc(db, key)
    used = int(doc.get("count", 0)) if doc.get("date") == today else 0
    if used + calls > MAX_DAILY_AI_CALLS:
        raise HTTPException(status_code=429, detail="You've reached today's limit for AI writing. It resets tomorrow.")
    await credit._put_doc(db, key, {"date": today, "count": used + calls})


_RULES = (
    "You write cold emails for a real business. Hard rules:\n"
    "1. Use ONLY the facts supplied. Never invent a statistic, percentage, customer, case study, award, result, deadline or claim.\n"
    "2. Never say you noticed, saw or read something unless it is in the receiver facts.\n"
    "3. Under 120 words per email. Plain, warm, specific. One clear low-pressure ask. No hype, no exclamation marks.\n"
    "4. The only merge fields allowed are {{first_name}}, {{last_name}}, {{company}} and {{personal_line}}. Write them exactly like that.\n"
    "5. Sign off with the sign-off name given. Do not add placeholders like [Your Name].\n"
    "6. Answer with JSON only."
)


def _clean_steps(raw: Any, count: int) -> List[Dict[str, Any]]:
    steps = []
    for i, s in enumerate((raw or [])[:count]):
        if not isinstance(s, dict) or not str(s.get("body") or "").strip():
            continue
        steps.append({"subject": str(s.get("subject") or "").strip()[:120] if i == 0 or s.get("subject") else "",
                      "body": str(s.get("body") or "").strip(), "delay_days": 0 if i == 0 else (3 if i == 1 else 4)})
    return steps


def _check_steps(steps: List[Dict[str, Any]], allowed: List[str]) -> List[List[str]]:
    return [violations(f"{s['subject']}\n{s['body']}", allowed) for s in steps]


async def draft_sequence(db: Any, profile: Dict[str, Any], context: str, *, count: int = 3, personalise: bool = False,
                         instruction: str = "", goal: str = "") -> List[Dict[str, Any]]:
    """A whole sequence in one go. Returns steps, each with `warnings` (empty when everything is backed by the facts)."""
    allowed = sender_texts(profile) + [context, instruction, goal]
    opener = ("Start email 1, right after the greeting, with the single line {{personal_line}} on its own line. "
              "Write the rest so it reads fine even if that line is empty.") if personalise else "Do not use {{personal_line}}."
    user = (
        f"SENDER (the business sending these emails)\n{_profile_prompt(profile)}\n\n"
        f"RECEIVERS (who the emails go to)\n{context or 'A list of UK small businesses.'}\n\n"
        + (f"WHAT THE EMAILS MUST ACHIEVE (from the user)\n{goal}\n\n" if goal else "")
        +
        f"Write {count} emails: email 1 introduces the sender and asks one easy question; email 2 (sent 3 days later, replies in the same thread, "
        "no subject) adds one new useful angle; email 3 (4 days after that, no subject) is a very short polite close. "
        f"{opener} Address the reader as {{{{first_name}}}} and refer to their business as {{{{company}}}}.\n"
        + (f"Extra instruction from the user: {instruction}\n" if instruction else "")
        + 'Answer as JSON: {"steps":[{"subject":"...","body":"..."}]}. Follow-up emails have an empty subject.'
    )
    problems: List[List[str]] = []
    steps: List[Dict[str, Any]] = []
    for attempt in range(2):
        prompt = user if attempt == 0 else user + "\n\nYour last answer broke the rules: " + "; ".join(sorted({v for p in problems for v in p})) + ". Rewrite it without them."
        steps = _clean_steps((await _ask(db, _RULES, prompt)).get("steps"), count)
        if not steps:
            raise WriterUnavailable("The AI returned no emails.")
        problems = _check_steps(steps, allowed)
        if not any(problems):
            break
    return [{**s, "warnings": problems[i] if i < len(problems) else []} for i, s in enumerate(steps)]


async def refine(db: Any, profile: Dict[str, Any], subject: str, body: str, action: str, instruction: str = "") -> Dict[str, Any]:
    wants = {"shorter": "Make it much shorter (under 60 words) and keep the one ask.",
             "softer": "Make the ask softer and lower pressure, such as asking if it is worth a conversation.",
             "formal": "Make the tone more formal and measured.",
             "clearer": "Make it clearer and more specific without adding any new claims."}
    ask = instruction.strip() if action == "custom" else wants.get(action, "")
    if not ask:
        raise HTTPException(status_code=400, detail="Say how to change it: shorter, softer, formal, clearer or your own instruction.")
    allowed = sender_texts(profile) + [subject, body, instruction]
    user = (f"SENDER\n{_profile_prompt(profile)}\n\nRewrite this email. {ask} Keep every merge field ({{{{first_name}}}}, {{{{company}}}}, "
            f"{{{{personal_line}}}}) exactly as written, and add no new facts.\n\nSubject: {subject}\n\n{body}\n\n"
            'Answer as JSON: {"subject":"...","body":"..."}')
    found: List[str] = []
    out: Dict[str, Any] = {}
    for attempt in range(2):
        prompt = user if attempt == 0 else user + "\n\nYour last answer broke the rules: " + "; ".join(found) + ". Rewrite it without them."
        out = await _ask(db, _RULES, prompt)
        found = violations(f"{out.get('subject', '')}\n{out.get('body', '')}", allowed)
        if not found:
            break
    if not str(out.get("body") or "").strip():
        raise WriterUnavailable("The AI returned an empty email.")
    return {"subject": str(out.get("subject") or subject).strip()[:120], "body": str(out["body"]).strip(), "warnings": found}


async def personal_line(db: Any, profile: Dict[str, Any], acct: Any, facts: List[Dict[str, Any]], creds: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """One opening sentence for one company, built only from its facts. Returns line "" (with a reason) when
    there is nothing solid to say, so the email simply opens without it."""
    if not facts:
        return {"line": "", "facts": [], "reason": "We hold no facts about this company to write from."}
    listing = "\n".join(f"{f['id']}: {f['text']} (source: {f['source']})" for f in facts)
    user = (
        f"SENDER\n{_profile_prompt(profile)}\n\nRECEIVER: {getattr(acct, 'name', '')}\nFACTS about the receiver (use only these):\n{listing}\n\n"
        "Write ONE natural opening sentence (at most 28 words) for a cold email to this company that shows we know a little about it, "
        "and connects to what the sender sells ONLY if it genuinely fits. Do not say they need anything. Do not state anything not in the facts. "
        "Treat facts marked 'not verified' softly or leave them out. If no fact gives a natural opening, leave the line empty.\n"
        'Answer as JSON: {"line":"...","fact_ids":["f1"]}'
    )
    try:
        out = await _ask(db, _RULES, user, max_tokens=300, creds=creds)
    except WriterUnavailable:
        return {"line": "", "facts": [], "reason": "The writing AI was not available."}
    line = " ".join(str(out.get("line") or "").split())
    ids = [i for i in (out.get("fact_ids") or []) if isinstance(i, str)]
    used = [f for f in facts if f["id"] in ids]
    if not line:
        return {"line": "", "facts": [], "reason": "Nothing in the facts gave a natural opening."}
    if not used:
        return {"line": "", "facts": [], "reason": "The line did not point to a fact, so it was dropped."}
    bad = violations(line, [f["text"] for f in used] + [n for n in _names_for(acct) if n] + [profile.get("company", "")], max_words=32)
    if bad or "{{" in line:
        return {"line": "", "facts": [], "reason": "The line said something the facts do not back up, so it was dropped."}
    return {"line": line, "facts": [{"text": f["text"], "source": f["source"], "verified": f["verified"]} for f in used], "reason": ""}


async def personalise_many(db: Any, profile: Dict[str, Any], rows: List[Tuple[Any, List[Dict[str, Any]]]]) -> List[Dict[str, Any]]:
    """Lines for many companies at once (a few at a time). Each result is for one company, in order."""
    try:
        creds = await writer_credentials(db)
    except WriterUnavailable:
        return [{"line": "", "facts": [], "reason": "The writing AI was not available."} for _ in rows]
    sem = asyncio.Semaphore(4)

    async def one(acct: Any, facts: List[Dict[str, Any]]) -> Dict[str, Any]:
        async with sem:
            return await personal_line(None, profile, acct, facts, creds)

    return list(await asyncio.gather(*[one(a, f) for a, f in rows]))


def credits_for(lines: int) -> int:
    return int(math.ceil(max(0, lines) / PER_CREDIT))
