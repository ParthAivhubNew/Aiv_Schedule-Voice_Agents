"""Company web lookup: find a company's own website, phone and email from the open web and show only what the guardrail trusts.

1. The recipe (search_recipe) builds the searches: one template, filled from the register.
2. Search APIs (DeepSeek, then Tavily) answer them. The company's own site is then read in full (homepage, and contact pages when the
   homepage has none), which also proves the site is alive.
3. The guardrail (guardrail.py) turns every source into candidates per field, rejects the bad ones, scores the rest, and returns one
   winner per field or nothing.
4. Retries run only while there is no confident website: the name written differently, then one advanced-depth search. The searches
   per lookup are capped (search_recipe.MAX_SEARCHES). Every lookup returns a ledger of what it spent and an audit of what it weighed.

No AI model decides anything here: the rules decide, so the same evidence always gives the same answer.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from app.services import company_contacts as CC
from app.services import enrichment_service as ES
from app.services import guardrail as G
from app.services import search_recipe as R
from app.services import site_check
from app.services.safe_fetch import FetchRefused, fetch_text

logger = logging.getLogger("web_harness")

CONTACT_PATHS = ("/contact", "/contact-us", "/about")
READ_TIMEOUT = 6.0  # a company page that has not answered in this long is not worth waiting for
BUDGET_S = 25.0  # past this, no new search is started: the lookup answers with what it has
PAGE_CHARS = 6000


def _homepage(url: str) -> str:
    p = urlparse(url if "://" in url else "https://" + url)
    return f"{p.scheme or 'https'}://{p.netloc}" if p.netloc else url


_DEAD = ("could not be found", "error 404", "error 410")  # the site is gone; any other refusal (403, 429, a timeout) is a site that keeps bots out


async def _read_page(url: str) -> Optional[Tuple[str, str]]:
    """(title, text) of a page on the company's own site, or None. Our own safe fetch goes first: it is quick, free, and says at once when a
    site does not exist. DeepSeek's page fetch (when it is switched on) is only asked when our reader was refused or failed for another
    reason, such as a site that needs a browser, so a dead address never waits on a slow second reader. Sets _read_page.dead when the failure
    means the site does not exist; a site that merely refuses our reader is not dead and we do not work around the refusal."""
    _read_page.dead = False
    try:
        title, text = await fetch_text(url, max_chars=PAGE_CHARS * 5, timeout=READ_TIMEOUT)
        return (title or ""), text
    except FetchRefused as err:
        if any(m in str(err) for m in _DEAD):
            _read_page.dead = True
            return None
    except Exception as err:
        logger.info("harness: could not read %s: %s", url, err)
    page = await ES.fetch_deepseek(url)
    if page and (page.get("content") or "").strip():
        return page.get("title") or "", page["content"][:PAGE_CHARS * 5]
    return None


_read_page.dead = False


async def _read(url: str) -> Tuple[Optional[Tuple[str, str]], bool]:
    """(page, site is dead). The dead flag is read the moment the page comes back, so pages read at the same time never mix it up."""
    page = await _read_page(url)
    return page, bool(_read_page.dead)


async def confirm_place(name: str, postcode: str, place: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """A Google business lookup is a LEAD, never a fact we keep. Its website is read, and it is kept only when that page is the
    company's own (it names the company, or shows its postcode). Its phone is kept only when the same page prints that number.
    Returns only what the company's own site confirmed, so nothing that only Google said is ever stored."""
    site = str((place or {}).get("website") or "").strip()
    if not site or not site_check.plausible_site(name, site, strict=False):
        return {}
    try:
        title, text = await fetch_text(site, max_chars=30000)
    except FetchRefused:
        return {}  # a dead or unreadable site confirms nothing
    except Exception as err:
        logger.info("confirm_place: could not read %s: %s", site, err)
        return {}
    page = f"{title} {text}"
    own = G.mentions(name, page) or (bool(postcode) and G.squash(postcode) in G.squash(page))
    if not own:
        return {}
    out = {"website": site}
    phone = str((place or {}).get("phone") or "").strip()
    if phone and CC.is_uk_phone(phone) and G.national(phone) in G.numbers_in(page):
        out["phone"] = phone
    return out


def _facts(name: str, place: str, facts: Dict[str, Any]) -> Dict[str, Any]:
    postcode = str(facts.get("postcode") or "").strip()
    company_number = str(facts.get("company_number") or "").strip()
    address = str(facts.get("address") or "").strip()
    return {"name": name, "region": place, "postcode": postcode, "area": R.area_of(place or address, postcode), "industry": facts.get("industry") or "",
            "website": facts.get("website") or "", "domain": facts.get("domain") or "", "phone": facts.get("phone") or "",
            "email": facts.get("email") or "", "trading_as": facts.get("trading_as") or "", "status": facts.get("status") or "", "company_number": company_number, "address": address}


def _closed(status: str) -> bool:
    s = str(status or "").strip().lower()
    return bool(s) and s not in ("active", "open", "live", "registered")


async def find_company(db: Any, *, name: str, place: str = "", facts: Optional[Dict[str, Any]] = None, scope: str = "leadgen",
                       threshold: int = G.THRESHOLD, margin: int = G.MARGIN, want: str = "all") -> Dict[str, Any]:
    """{website, phones, emails, sources, found, via, confidence, audit, ledger, reason}. Never raises: a failed step finds less."""
    F = _facts(name, place, facts or {})
    meter: Dict[str, Any] = {"searches": 0, "tavily_credits": 0.0, "extract_pages": 0, "timings": []}
    t0 = time.monotonic()

    def took(label: str, started: float) -> None:
        meter["timings"].append({"step": label, "s": round(time.monotonic() - started, 2)})

    def over_budget() -> bool:
        return time.monotonic() - t0 > BUDGET_S
    out: Dict[str, Any] = {"website": "", "phones": [], "emails": [], "sources": [], "found": False, "via": "guardrail", "confidence": {},
                           "audit": [], "reason": "", "ledger": meter}
    if not (name or "").strip():
        return out
    if _closed(F["status"]):
        out["reason"] = f"the register shows this company as {F['status']}"
        meter["outcome"] = "closed"
        return out

    steps = R.plan(F)
    must = list(G.words_of(name))
    raw: List[Dict[str, Any]] = []
    seen_urls: set = set()
    read_domains: Dict[str, bool] = {}  # domain -> was its site readable (alive)

    async def run(query: str, *, include: Optional[List[str]] = None, depth: str = "basic", engine: str = "auto") -> int:
        if meter["searches"] >= R.MAX_SEARCHES:
            return 0
        started = time.monotonic()
        rows = await ES.search_web(query, max_results=R.SETTINGS["max_results"], include_domains=include,
                                   exclude_domains=None if include else R.EXCLUDE_DOMAINS, must_mention=must or None, depth=depth, meter=meter,
                                   engine=engine)
        took(f"search by {rows[0].get('engine') if rows else 'none'}{' (advanced)' if depth == 'advanced' else ''}{' (contact)' if include else ''}", started)
        if rows and not any(r.get("engine") == "deepseek" for r in rows):
            meter["tavily_used"] = True
        added = 0
        for r in rows:
            key = G.registered_domain(r["url"]) + urlparse(r["url"]).path.rstrip("/")
            if key in seen_urls:
                continue
            seen_urls.add(key)
            raw.append({"url": r["url"], "title": r.get("title") or "", "text": r.get("summary") or r.get("snippet") or "", "score": r.get("score") or 0.0})
            added += 1
        return added

    def evaluate() -> Dict[str, Any]:
        src = G.prepare_sources(raw, F)
        wc = G.website_candidates(src, F)
        for c in wc:
            if read_domains.get(c["key"]) is False:
                c["rejected"] = c["rejected"] or "dead site: the page could not be loaded"
        G.score(wc, src, F, [])
        win_w, why_w = G.decide(wc, threshold, margin)
        own = [win_w["key"]] if win_w else [c["key"] for c in wc if not c["rejected"] and G.domain_matches_name(c["key"], name)]
        pc, ec = G.phone_candidates(src), G.email_candidates(src, own)
        G.score(pc, src, F, own)
        G.score(ec, src, F, own)
        win_p, why_p = G.decide(pc, threshold, margin)
        win_e, why_e = G.decide(ec, threshold, margin)
        return {"src": src, "cands": wc + pc + ec, "w": win_w, "p": win_p, "e": win_e, "why": {"website": why_w, "phone": why_p, "email": why_e}}

    def complete(t: str) -> bool:
        return bool(G.numbers_in(t) or "@" in t) and G._place_hit(t, F["postcode"], F["area"])

    async def read_one(c: Dict[str, Any], state: Dict[str, Any]) -> Tuple[Dict[str, Any], str, Any, bool]:
        home = _homepage(state["src"][c["sources"][0]]["url"])
        started = time.monotonic()
        page, dead = await _read(home)
        meter["extract_pages"] += 1
        took(f"read {c['key']}{' (dead)' if dead else ''}", started)
        return c, home, page, dead

    async def read_own_sites(state: Dict[str, Any]) -> bool:
        """Reads the homepage (and contact pages when it has no number or address) of the best look-alike domains, the sites at the same time.
        True if it read anything, live or dead, because either changes the evidence. A page read from a site inherits the best search score
        that site was found with."""
        live = sorted((c for c in state["cands"] if c["field"] == "website" and not c["rejected"]), key=lambda c: -c["score"])[:2]
        todo = [c for c in live if c["key"] not in read_domains]
        results = await asyncio.gather(*(read_one(c, state) for c in todo))
        for c, home, page, dead in results:
            domain = c["key"]
            read_domains[domain] = page is not None or not dead
            if page is None:
                continue
            title, text = page
            found_with = max((r["score"] or 0.0 for r in raw if G.registered_domain(r["url"]) == domain), default=0.0)
            raw.append({"url": home, "title": title, "text": text, "score": found_with, "read": True})
            # the contact pages are read (our own fetch, no search credit) when the homepage shows no contact AND the company's place: a
            # postcode on the company's own contact page is what tells two look-alike sites apart. They are asked for together.
            if not complete(text):
                started = time.monotonic()
                subs = await asyncio.gather(*(_read(home + path) for path in CONTACT_PATHS))
                took(f"read {domain} contact pages", started)
                for path, (sub, _dead) in zip(CONTACT_PATHS, subs):
                    meter["extract_pages"] += 1
                    if sub:
                        raw.append({"url": home + path, "title": sub[0], "text": sub[1], "score": found_with, "read": True})
        return bool(todo)

    # 1. the website search and the phone/email search together
    # only what was asked for: Find website searches for the website, Find phone for the phone, and only "all" does both
    ask_site, ask_contact = want in ("all", "website"), want in ("all", "phone", "email")
    first = [run(steps[0]["query"])] if ask_site else []
    if ask_contact and len(steps) > 1:
        first.append(run(steps[1]["query"]))
    await asyncio.gather(*first)
    state = evaluate()
    if await read_own_sites(state):
        state = evaluate()

    # 2. still no confident website: the name written differently and DeepSeek's second opinion, asked together (they do not depend on each other)
    if ask_site and not state["w"] and not over_budget():
        pending = [run(step["query"]) for step in steps if step["retry"]]
        if meter.get("tavily_used") and meter["searches"] + len(pending) < R.MAX_SEARCHES:
            pending.append(run(steps[0]["query"], engine="deepseek"))  # Tavily answers first, so DeepSeek is only ever the second opinion
        if pending:
            await asyncio.gather(*pending)
            await read_own_sites(evaluate())
            state = evaluate()
    no_candidate = not any(c["field"] == "website" and not c["rejected"] for c in state["cands"])  # advanced costs 2 credits: only when nothing was found at all
    if ask_site and not state["w"] and no_candidate and meter["searches"] < R.MAX_SEARCHES and not over_budget():
        if await run(steps[0]["query"], depth="advanced"):
            await read_own_sites(evaluate())
            state = evaluate()

    # 3. a website but no phone or email: the contact page, restricted to that website's own domain
    if ask_contact and state["w"] and not (state["p"] and state["e"]) and meter["searches"] < R.MAX_SEARCHES:
        if await run(R.build_query("contact", F), include=[state["w"]["key"]]):
            state = evaluate()

    # the answer: one value per field, or nothing
    src, w, p, e = state["src"], state["w"], state["p"], state["e"]
    if w:
        home = _homepage(src[w["sources"][0]]["url"])
        host = urlparse(home).netloc.lower()
        out["website"] = home if host in (w["key"], "www." + w["key"]) else f"https://{w['key']}"  # jobs.x.com, shop.x.com -> x.com
        out["confidence"]["website"] = {"score": w["score"], "label": G.label(w["score"])}
        out["sources"] = list(dict.fromkeys(src[i]["url"] for i in w["sources"]))[:4]
    if p:
        out["phones"] = [p["value"]]
        out["confidence"]["phone"] = {"score": p["score"], "label": G.label(p["score"])}
    if e:
        out["emails"] = [e["value"]]
        out["confidence"]["email"] = {"score": e["score"], "label": G.label(e["score"])}
    out["found"] = bool(out["website"] or out["phones"] or out["emails"])
    out["audit"] = G.audit_of(state["cands"], src)
    out["reason"] = "" if out["found"] else "; ".join(f"{k}: {v}" for k, v in state["why"].items() if v)
    meter["outcome"] = "found" if out["found"] else ("no_web_search" if not raw else "not_found")
    meter["seconds"] = round(time.monotonic() - t0, 2)
    logger.info("lookup_ledger %s", json.dumps({"company": name, **meter, "shown": list(out["confidence"])}, default=str))
    return out
