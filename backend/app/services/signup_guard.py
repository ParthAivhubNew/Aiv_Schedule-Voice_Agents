"""Sign-up abuse limits and bot checks (plan 11, C.1).

- **Limits** count per visitor address, per e-mail address, per partner and across the platform, in memory.
  The backend runs one process, so every request sees the same counts; a restart starts them again.
- **Bot checks:** the hidden trap field (signup.py), a signed form token from GET /auth/signup-config that has to be at least a
  couple of seconds old, and no throwaway inbox services.

The visitor's address is only real if main.py trusts the proxies in front of the backend (TRUSTED_PROXIES). Otherwise every
visitor looks like the web container, and one limit catches everyone.
"""
from __future__ import annotations

import logging
import os
import time
from collections import defaultdict, deque
from typing import Deque, Dict, List, Optional, Tuple

logger = logging.getLogger("signup")

# kind -> [(how many, in how many seconds)]
LIMITS: Dict[str, List[Tuple[int, int]]] = {
    "signup": [(5, 3600), (20, 86400)],      # new companies from one visitor address
    "signup_partner": [(60, 3600)],          # new companies one partner's server creates through the API
    "resend": [(5, 3600)],                   # verification e-mails asked for from one address
    "resend_to": [(3, 3600)],                # ... sent to one e-mail address, from anywhere
    "forgot": [(5, 3600)],
    "forgot_to": [(3, 3600)],
    "platform": [(10 ** 9, 3600)],           # every sign-up, counted for the hourly alert and cap below
}
HITS: Dict[str, Deque[float]] = defaultdict(deque)

FORM_MIN_S = 2           # nobody fills in four fields and presses the button faster than this
FORM_TTL_S = 24 * 3600   # after a day the page has to be reloaded (the form does it by itself)
FORM_CHECK = True        # tests that post the form directly switch this off (tests/conftest.py)

_alerted_at = 0.0


def _window(key: str, longest: int, now: float) -> Deque[float]:
    q = HITS[key]
    while q and now - q[0] > longest:
        q.popleft()
    return q


def allow(kind: str, who: str) -> bool:
    """True, and the attempt is counted, while `who` is under every limit for `kind`; False once it is over one."""
    rules = LIMITS[kind]
    now = time.time()
    q = _window(f"{kind}|{who}", max(w for _, w in rules), now)
    for n, w in rules:
        if sum(1 for t in q if now - t <= w) >= n:
            return False
    q.append(now)
    return True


def count(kind: str, who: str, within: int) -> int:
    now = time.time()
    return sum(1 for t in HITS.get(f"{kind}|{who}", ()) if now - t <= within)


def _per_hour(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, "") or default))
    except ValueError:
        return default


def max_per_hour() -> int:
    """New companies the whole platform accepts in an hour before sign-up pauses (SIGNUP_MAX_PER_HOUR)."""
    return _per_hour("SIGNUP_MAX_PER_HOUR", 100)


def alert_per_hour() -> int:
    """New companies in an hour that make staff take a look (SIGNUP_ALERT_PER_HOUR)."""
    return _per_hour("SIGNUP_ALERT_PER_HOUR", 30)


async def platform_ok() -> bool:
    """False when the platform has taken its hourly maximum of sign-ups. Staff hear about it (SIGN-01) once an hour, from
    the alert level up."""
    global _alerted_at
    n = count("platform", "all", 3600)
    if n >= alert_per_hour() and time.time() - _alerted_at > 3600:
        _alerted_at = time.time()
        from app.services.ai_errors import alert_staff

        paused = n >= max_per_hour()
        await alert_staff("SIGN-01", f"{n} new companies signed up in the last hour" +
                          (f"; sign-up is paused at {max_per_hour()} an hour." if paused else "."), org_id="platform")
    return n < max_per_hour()


def counted() -> None:
    """One more sign-up across the platform."""
    allow("platform", "all")


# Throwaway inbox services. Work tools for real companies, so an account needs an address its owner keeps.
DISPOSABLE = frozenset("""
10minutemail.com 10minutemail.net 20minutemail.com 33mail.com anonbox.net burnermail.io discard.email dispostable.com
dropmail.me emailondeck.com fakeinbox.com fakemail.net getairmail.com getnada.com guerrillamail.biz guerrillamail.com
guerrillamail.de guerrillamail.info guerrillamail.net guerrillamail.org guerrillamailblock.com grr.la harakirimail.com
inboxkitten.com incognitomail.org mail-temp.com mailcatch.com maildrop.cc mailinator.com mailinator.net mailnesia.com
mailpoof.com mailsac.com mintemail.com mohmal.com moakt.com mytemp.email nada.email sharklasers.com spam4.me spamgourmet.com
spambox.us temp-mail.io temp-mail.org tempail.com tempinbox.com tempmail.dev tempmail.net tempmailo.com tempr.email
throwawaymail.com tmail.ws tmpmail.net tmpmail.org trashmail.com trashmail.de trashmail.net wegwerfmail.de yopmail.com
yopmail.fr yopmail.net
""".split())


def disposable(email: str) -> bool:
    """True for an address at a throwaway inbox service, or a subdomain of one."""
    domain = (email or "").rsplit("@", 1)[-1].strip().lower().rstrip(".")
    parts = domain.split(".")
    return any(".".join(parts[i:]) in DISPOSABLE for i in range(max(0, len(parts) - 1)))


def form_problem(claims: Optional[dict]) -> Optional[str]:
    """Why a sign-up form's token is refused ("form_expired" or "too_fast"), or None when it is fine.
    `claims` is the token's content once its signature and expiry are checked (None if they failed)."""
    if not FORM_CHECK:
        return None
    if not claims:
        return "form_expired"
    if time.time() - float(claims.get("iat") or 0) < FORM_MIN_S:
        return "too_fast"
    return None


FORM_MESSAGES = {
    "form_expired": "This page was open too long, so we've refreshed it. Press Create account again.",
    "too_fast": "That was quicker than we expected. Wait a moment, then press Create account again.",
}
