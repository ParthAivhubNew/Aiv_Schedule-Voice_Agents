"""The test copy: a second copy of the app that holds the live app's users, data and keys (new.outreach.aivhub.com), switched on with
TEST_COPY=true. It must never contact a real person or change anything the live app depends on, whatever a tester clicks.

What the switch does:
- Background jobs that act on the outside world (scheduled calls, e-mail sending, post publishing, token refresh, Telnyx and billing upkeep,
  workflows, mailbox sync, register feeds) don't start (main.py, SAFE_JOBS lists the ones that do).
- Every outbound write over httpx (POST, PUT, PATCH, DELETE) is refused unless it goes to a provider that only costs money and reaches nobody:
  AI models, data and search providers, TPS screening, image and voice generation (COST_ONLY_HOSTS). Reads (GET) are allowed.
  So nothing writes our address into Telnyx, Meta, Vapi or Retell, publishes a post, books a meeting, sends a partner webhook or buys a number.
- Calls and texts (Telnyx, Twilio) go only to numbers in TEST_COPY_ALLOW_NUMBERS; e-mail (SMTP) only to addresses or @domains in
  TEST_COPY_ALLOW_EMAILS. Both are empty by default: nothing goes out.
- Stripe is used only with test keys (sk_test_ / rk_test_).
- IMAP is refused: reading a live mailbox from a second app can move or mark the live app's messages.
- Sign-in tokens are signed with a key of the copy's own (core/security.py), so a live session never works here and the other way round.

A refused request raises BlockedInTestCopy (an httpx.RequestError), which callers already handle as a provider failure, and is logged with
its method, host and path only (never the body or a key).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any, Iterable, Mapping, Optional
from urllib.parse import parse_qs, urlsplit

logger = logging.getLogger("test_copy")

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
SAFE_JOBS = {"credits_settle", "generation", "fx_rates", "connector_stats"}  # internal bookkeeping, AI drafts that are only saved, reading exchange rates, counting records

# Writes here only cost money: nobody is contacted and nothing the live app uses is changed.
COST_ONLY_HOSTS = (
    # AI models
    "api.openai.com", "api.anthropic.com", "api.deepseek.com", "api.groq.com", "api.x.ai", "generativelanguage.googleapis.com",
    "openrouter.ai", "api.together.xyz", "api.perplexity.ai", "api.mistral.ai", "image.pollinations.ai",
    # voices and speech-to-text (used inside a call that was itself allowed)
    "api.elevenlabs.io", "api.cartesia.ai", "api.deepgram.com",
    # images and video
    "fal.run", "queue.fal.run", "api.stability.ai",
    # company data, search, e-mail finders, screening
    "api.tavily.com", "api.apollo.io", "app.icypeas.com", "api.hunter.io", "app.findymail.com", "api.leadmagic.io", "app.bettercontact.rocks",
    "places.googleapis.com", "maps.googleapis.com", "api.postcodes.io", "api.provero.io", "api.company-information.service.gov.uk",
    # Google sign-in (Google refresh tokens are not replaced when used, so the live app keeps working)
    "oauth2.googleapis.com", "securetoken.googleapis.com", "identitytoolkit.googleapis.com",
)


class BlockedInTestCopy(Exception):
    """Base for every refusal; the httpx one below is what network callers see."""


def on() -> bool:
    return os.getenv("TEST_COPY", "").strip().lower() in ("1", "true", "yes", "on")


def _digits(number: Any) -> str:
    d = re.sub(r"\D", "", str(number or ""))
    if d.startswith("00"):
        d = d[2:]
    if d.startswith("0") and len(d) in (10, 11):  # a UK national number
        d = "44" + d[1:]
    return d


def allowed_numbers() -> set:
    return {d for d in (_digits(x) for x in os.getenv("TEST_COPY_ALLOW_NUMBERS", "").split(",")) if d}


def allowed_emails() -> set:
    return {x.strip().lower() for x in os.getenv("TEST_COPY_ALLOW_EMAILS", "").split(",") if x.strip()}


def number_allowed(number: Any) -> bool:
    d = _digits(number)
    return bool(d) and d in allowed_numbers()


def email_allowed(address: Any) -> bool:
    a = str(address or "").strip().lower()
    m = re.search(r"<([^>]+)>", a)
    a = (m.group(1) if m else a).strip()
    if "@" not in a:
        return False
    ok = allowed_emails()
    return a in ok or ("@" + a.split("@", 1)[1]) in ok


def _host_in(host: str, hosts: Iterable[str]) -> bool:
    host = (host or "").lower().rstrip(".")
    return any(host == h or host.endswith("." + h) for h in hosts)


def _json(body: Optional[bytes]) -> Any:
    try:
        return json.loads(body or b"")
    except (ValueError, TypeError):
        return None


def _bearer(headers: Mapping[str, str]) -> str:
    value = ""
    for k, v in (headers or {}).items():
        if str(k).lower() == "authorization":
            value = str(v)
    return value.split(" ", 1)[1].strip() if " " in value else value.strip()


def decide(method: str, url: str, headers: Optional[Mapping[str, str]] = None, body: Optional[bytes] = None) -> Optional[str]:
    """Why this request may not go out from the test copy, or None when it may. Pure: no network, no settings beyond the allow-lists."""
    method = (method or "GET").upper()
    if method not in WRITE_METHODS:
        return None
    parts = urlsplit(url)
    host, path = (parts.hostname or "").lower(), parts.path or "/"
    if host in ("localhost", "127.0.0.1", "backend", "frontend", "redis", "postgres") or host.endswith(".internal"):
        return None  # our own containers
    if _host_in(host, COST_ONLY_HOSTS):
        return None
    if host == "api.telnyx.com":
        if path.startswith("/v2/ai/") and not path.startswith("/v2/ai/assistants"):
            return None  # Telnyx's own AI models: a cost, no change
        if re.fullmatch(r"/v2/telephony_credentials/[^/]+/token", path):
            return None  # a browser-phone token; every call it makes still passes the call gate
        if path in ("/v2/calls", "/v2/messages") or re.fullmatch(r"/v2/calls/[^/]+/actions/[^/]+", path):
            data = _json(body)
            if data is None and body:
                return "Telnyx request with a body the test copy cannot read"
            to = (data or {}).get("to") if isinstance(data, dict) else None
            if path in ("/v2/calls", "/v2/messages") or to:  # a new call or text, or a transfer to a number
                tos = to if isinstance(to, list) else [to]
                bad = [t for t in tos if not number_allowed(t)]
                if bad or not tos or not to:
                    return "a call or text to a number that is not in TEST_COPY_ALLOW_NUMBERS"
            return None
        return "a change to the Telnyx account the live app uses"
    if host == "api.twilio.com":
        if re.search(r"/(Calls|Messages)\.json$", path):
            form = parse_qs((body or b"").decode("utf-8", "replace"))
            to = (form.get("To") or [""])[0]
            return None if number_allowed(to) else "a call or text to a number that is not in TEST_COPY_ALLOW_NUMBERS"
        return "a change to the Twilio account the live app uses"
    if host == "api.stripe.com":
        key = _bearer(headers or {})
        return None if key.startswith(("sk_test_", "rk_test_")) else "Stripe with a live key"
    return f"a write to {host}, which can reach people or change what the live app uses"


# -- installing the guards -------------------------------------------------------------------------------
def _request_body(request: Any) -> Optional[bytes]:
    try:
        return request.content
    except Exception:  # a streamed body: unreadable here, so only cost-only hosts accept it (decide() refuses the rest)
        return None


def _refuse(method: str, url: str, why: str) -> str:
    parts = urlsplit(url)
    msg = f"Blocked in the test copy: {method} {parts.hostname}{parts.path} ({why})"
    logger.warning(msg)
    return msg


_installed = False


def install() -> bool:
    """Puts the guards in place when TEST_COPY is on. Safe to call more than once. True when they are on."""
    global _installed
    if not on():
        return False
    if _installed:
        return True
    import imaplib
    import smtplib

    import httpx

    class _Blocked(httpx.RequestError, BlockedInTestCopy):
        pass

    globals()["HttpxBlocked"] = _Blocked
    async_send, sync_send = httpx.AsyncClient.send, httpx.Client.send

    async def guarded_async_send(self, request, *args, **kwargs):
        why = decide(request.method, str(request.url), request.headers, _request_body(request))
        if why:
            raise _Blocked(_refuse(request.method, str(request.url), why), request=request)
        return await async_send(self, request, *args, **kwargs)

    def guarded_sync_send(self, request, *args, **kwargs):
        why = decide(request.method, str(request.url), request.headers, _request_body(request))
        if why:
            raise _Blocked(_refuse(request.method, str(request.url), why), request=request)
        return sync_send(self, request, *args, **kwargs)

    httpx.AsyncClient.send = guarded_async_send
    httpx.Client.send = guarded_sync_send

    sendmail = smtplib.SMTP.sendmail

    def guarded_sendmail(self, from_addr, to_addrs, msg, *args, **kwargs):
        rcpts = [to_addrs] if isinstance(to_addrs, str) else list(to_addrs or [])
        bad = [r for r in rcpts if not email_allowed(r)]
        if bad or not rcpts:
            logger.warning(f"Blocked in the test copy: e-mail to {len(bad) or 'no'} address(es) not in TEST_COPY_ALLOW_EMAILS")
            raise smtplib.SMTPRecipientsRefused({r: (550, b"Blocked in the test copy") for r in (bad or ["(none)"])})
        return sendmail(self, from_addr, to_addrs, msg, *args, **kwargs)

    smtplib.SMTP.sendmail = guarded_sendmail  # send_message() goes through sendmail(); SMTP_SSL inherits it

    def refused_imap(self, *args, **kwargs):
        logger.warning("Blocked in the test copy: IMAP (a live mailbox is never opened from the copy)")
        raise imaplib.IMAP4.error("Mailboxes are not opened in the test copy")

    imaplib.IMAP4.__init__ = refused_imap
    _installed = True
    logger.warning("TEST COPY: outbound writes, calls, texts and e-mail are blocked except the allow-lists; outward background jobs are off")
    return True


async def idle() -> None:
    """Stands in for a background job that is off in the test copy, so start-up and shutdown code stay the same."""
    await asyncio.Event().wait()
