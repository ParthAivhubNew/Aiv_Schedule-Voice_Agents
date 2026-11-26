"""Sign-up abuse limits and bot checks (plan 11, C.1; services/signup_guard.py)."""
import time

import pytest
from starlette.requests import Request

from app.api import signup as S
from app.services import signup_guard as G

BODY = {"company": "Acme Trading", "name": "Ann Lee", "email": "ann@acme.test", "password": "a-long-Passw0rd!"}


@pytest.fixture
def no_mail(monkeypatch):
    monkeypatch.setenv("ALLOW_SIGNUP", "true")
    monkeypatch.setattr("app.core.mailer.configured", lambda: False)


# ── The visitor's real address ──────────────────────────────────────────────
def test_the_backend_believes_its_own_proxies_and_nobody_else():
    """Behind the host's nginx and the frontend container, request.client is the visitor; a faked X-Forwarded-For is ignored."""
    from uvicorn.middleware.proxy_headers import _TrustedHosts

    from app import main

    mw = next(m for m in main.app.user_middleware if m.cls.__name__ == "ProxyHeadersMiddleware")
    trusted = _TrustedHosts(mw.kwargs["trusted_hosts"])
    assert "172.21.0.5" in trusted and "127.0.0.1" in trusted  # the frontend container and the host
    assert "81.2.3.4" not in trusted
    # The visitor typed "9.9.9.9" themselves; the host's nginx added their real address, the container added the host's.
    assert trusted.get_trusted_client_address("9.9.9.9, 81.2.3.4, 172.21.0.1")[0] == "81.2.3.4"


async def test_limits_count_each_visitor_separately(anon, no_mail):
    """The test client connects from 127.0.0.1, like the host's nginx, so the forwarded address is the visitor."""
    def from_(ip):
        return {"X-Forwarded-For": ip}

    spread = [(await anon.post("/api/auth/signup", json={**BODY, "email": f"a{i}@acme.test"}, headers=from_(f"81.2.3.{i}"))).status_code
              for i in range(6)]
    assert spread == [200] * 6  # six people, one each: before, they all shared the container's address and the sixth was refused
    same = [(await anon.post("/api/auth/signup", json={**BODY, "email": f"b{i}@acme.test"}, headers=from_("90.1.1.1"))).status_code
            for i in range(6)]
    assert same == [200] * 5 + [429]


def test_limit_has_an_hourly_and_a_daily_window(monkeypatch):
    now = [1_000_000.0]
    monkeypatch.setattr(G.time, "time", lambda: now[0])
    for _ in range(5):
        assert G.allow("signup", "81.2.3.4")
    assert not G.allow("signup", "81.2.3.4")
    assert G.allow("signup", "81.2.3.5")  # someone else is not affected
    for _ in range(3):  # three more hours, five a time: 20 a day
        now[0] += 3601
        assert all(G.allow("signup", "81.2.3.4") for _ in range(5))
    now[0] += 3601
    assert not G.allow("signup", "81.2.3.4")  # the day's 20 are used
    now[0] += 86400
    assert G.allow("signup", "81.2.3.4")


# ── Bot checks ──────────────────────────────────────────────────────────────
async def test_the_form_needs_a_token_from_its_own_page(anon, no_mail, monkeypatch):
    monkeypatch.setattr(G, "FORM_CHECK", True)
    r = await anon.post("/api/auth/signup", json=BODY)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "form_expired"
    bad = await anon.post("/api/auth/signup", json={**BODY, "formToken": "made-up"})
    assert bad.json()["detail"]["code"] == "form_expired"

    token = (await anon.get("/api/auth/signup-config")).json()["formToken"]
    fast = await anon.post("/api/auth/signup", json={**BODY, "formToken": token})
    assert fast.status_code == 400 and fast.json()["detail"]["code"] == "too_fast"

    monkeypatch.setattr(G, "FORM_MIN_S", 0)
    ok = await anon.post("/api/auth/signup", json={**BODY, "formToken": token})
    assert ok.status_code == 200, ok.text


def test_an_old_form_token_is_refused(monkeypatch):
    monkeypatch.setattr(G, "FORM_CHECK", True)
    assert G.form_problem({"iat": time.time() - 60}) is None
    assert G.form_problem({"iat": time.time()}) == "too_fast"
    assert G.form_problem(None) == "form_expired"
    expired = S._sign({"typ": "signup_form"}, -10)
    assert S._read(expired, "signup_form") is None
    assert S._read(S._sign({"typ": "pw_reset"}, 60), "signup_form") is None  # another kind of token doesn't pass


async def test_the_config_gives_no_token_when_sign_up_is_off(anon, monkeypatch):
    monkeypatch.setenv("ALLOW_SIGNUP", "false")
    assert "formToken" not in (await anon.get("/api/auth/signup-config")).json()


def test_throwaway_inboxes_are_recognised():
    assert G.disposable("x@mailinator.com") and G.disposable("x@Mail.Yopmail.com.")
    assert not G.disposable("ann@acme.co.uk") and not G.disposable("ann@gmail.com")
    assert not G.disposable("ann@notmailinator.com")


async def test_throwaway_inbox_sign_up_is_refused(anon, no_mail):
    r = await anon.post("/api/auth/signup", json={**BODY, "email": "bot@guerrillamail.com"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "disposable_email"


async def test_the_trap_field_still_stops_bots(anon, no_mail):
    r = await anon.post("/api/auth/signup", json={**BODY, "website": "http://spam.example"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "spam_check"


# ── The platform as a whole ─────────────────────────────────────────────────
async def test_sign_up_pauses_past_the_hourly_maximum_and_staff_hear(anon, no_mail, monkeypatch):
    monkeypatch.setenv("SIGNUP_MAX_PER_HOUR", "3")
    monkeypatch.setenv("SIGNUP_ALERT_PER_HOUR", "2")
    alerts = []

    async def fake_alert(code, detail, **kw):
        alerts.append((code, detail))

    monkeypatch.setattr("app.services.ai_errors.alert_staff", fake_alert)
    monkeypatch.setitem(G.LIMITS, "signup", [(100, 3600)])  # one visitor here stands in for many
    codes = [(await anon.post("/api/auth/signup", json={**BODY, "email": f"p{i}@acme.test"})).status_code for i in range(4)]
    assert codes == [200, 200, 200, 503]
    assert [c for c, _ in alerts] == ["SIGN-01"]  # once an hour, not on every sign-up
    r = await anon.post("/api/auth/signup", json={**BODY, "email": "late@acme.test"})
    assert r.json()["detail"]["code"] == "signup_busy"


# ── E-mails to one address ──────────────────────────────────────────────────
async def test_reset_and_verification_mails_to_one_address_are_capped(anon, monkeypatch):
    for k in ("SYSTEM_MAIL_HOST", "SYSTEM_MAIL_USER", "SYSTEM_MAIL_PASSWORD"):
        monkeypatch.setenv(k, "x")
    looked_up = []
    real = G.allow

    def spy(kind, who):
        ok = real(kind, who)
        if kind.endswith("_to"):
            looked_up.append((kind, ok))
        return ok

    monkeypatch.setattr(G, "allow", spy)
    monkeypatch.setitem(G.LIMITS, "forgot", [(100, 3600)])
    for _ in range(4):
        r = await anon.post("/api/auth/forgot-password", json={"email": "Rita@corp.test"})
        assert r.status_code == 200 and r.json()["ok"] is True  # the same answer every time
    assert [ok for _, ok in looked_up] == [True, True, True, False]


# ── Partners ────────────────────────────────────────────────────────────────
def _request():
    return Request({"type": "http", "method": "POST", "path": "/", "headers": [], "client": ("81.2.3.4", 1), "query_string": b""})


async def test_a_partner_server_has_its_own_limit_not_the_visitor_one(monkeypatch):
    class P:
        id = "ptn_1"

    monkeypatch.setitem(G.LIMITS, "signup_partner", [(2, 3600)])
    for _ in range(2):
        await S._new_company_allowed(_request(), P(), by_partner=True)
    with pytest.raises(Exception) as err:
        await S._new_company_allowed(_request(), P(), by_partner=True)
    assert getattr(err.value, "status_code", None) == 429
    assert G.count("signup", "81.2.3.4", 3600) == 0  # the server's address isn't counted as a visitor
    await S._new_company_allowed(_request(), None)  # a person on the embed is counted as a visitor
    assert G.count("signup", "81.2.3.4", 3600) == 1
