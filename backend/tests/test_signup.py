"""Self-serve signup, email verification, Google sign-in and the first-steps checklist."""
from urllib.parse import parse_qs, urlparse

import pytest

from tests.conftest import make_user

pytestmark = pytest.mark.db

BODY = {"company": "Acme Ltd", "name": "Ann Owner", "email": "ann@acme.test", "password": "Acme-pass-2026"}


@pytest.fixture(autouse=True)
def _reset_limits():
    from app.api import signup

    signup._HITS.clear()
    signup._USED_JTI.clear()
    yield


async def test_signup_off_by_default(anon, monkeypatch):
    monkeypatch.delenv("ALLOW_SIGNUP", raising=False)
    assert (await anon.get("/api/auth/signup-config")).json() == {"allowSignup": False, "google": False}
    assert (await anon.post("/api/auth/signup", json=BODY)).status_code == 404


async def test_signup_creates_own_org_admin_and_isolates_data(anon, db, monkeypatch):
    from sqlalchemy.future import select

    from app.models.models import Operator, Organization

    monkeypatch.setenv("ALLOW_SIGNUP", "true")
    monkeypatch.delenv("SYSTEM_MAIL_HOST", raising=False)
    r = await anon.post("/api/auth/signup", json=BODY)
    assert r.status_code == 200, r.text
    assert r.json()["verifyEmail"] is False

    op = (await db.execute(select(Operator).where(Operator.username == "ann@acme.test"))).scalars().first()
    org = (await db.execute(select(Organization).where(Organization.id == op.org_id))).scalars().first()
    assert org.id != "org_default" and org.name == "Acme Ltd" and org.status == "active"

    r = await anon.post("/api/auth/login", json={"username": "ann@acme.test", "password": BODY["password"]})
    assert r.status_code == 200, r.text
    me = r.json()["operator"]
    assert me["is_admin"] and me["org_id"] == org.id
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    users = (await anon.get("/api/auth/users", headers=h)).json()
    assert [u["username"] for u in users] == ["ann@acme.test"]
    ob = (await anon.get("/api/auth/onboarding", headers=h)).json()
    assert ob["total"] == 6 and ob["done"] == 0

    # Same email twice is refused; honeypot is refused.
    assert (await anon.post("/api/auth/signup", json=BODY)).status_code == 400
    assert (await anon.post("/api/auth/signup", json={**BODY, "email": "b@acme.test", "website": "x"})).status_code == 400


async def test_signup_with_mailbox_needs_verification(anon, db, monkeypatch):
    from app.api import signup

    monkeypatch.setenv("ALLOW_SIGNUP", "true")
    monkeypatch.setenv("SYSTEM_MAIL_HOST", "smtp.test")
    monkeypatch.setenv("SYSTEM_MAIL_USER", "u")
    monkeypatch.setenv("SYSTEM_MAIL_PASSWORD", "p")
    sent = {}

    async def fake_send(to, subject, html_body, text_body, reply_to=None):
        sent["to"], sent["html"] = to, html_body
        return {"ok": True}

    monkeypatch.setattr("app.core.mailer.send_system_email", fake_send)
    r = await anon.post("/api/auth/signup", json=BODY)
    assert r.status_code == 200 and r.json()["verifyEmail"] and r.json()["emailed"]
    assert sent["to"] == "ann@acme.test"

    login = {"username": "ann@acme.test", "password": BODY["password"]}
    r = await anon.post("/api/auth/login", json=login)
    assert r.status_code == 403 and "Confirm your email" in r.text

    token = sent["html"].split("verify-email?t=")[1].split('"')[0]
    assert (await anon.get(f"/api/auth/verify-email?t=bad")).headers["location"].endswith("verified=expired")
    r = await anon.get(f"/api/auth/verify-email?t={token}")
    assert r.status_code == 303 and r.headers["location"].endswith("?verified=1")
    assert (await anon.post("/api/auth/login", json=login)).status_code == 200
    assert signup  # module imported


async def test_signup_rate_limited(anon, monkeypatch):
    monkeypatch.setenv("ALLOW_SIGNUP", "true")
    monkeypatch.delenv("SYSTEM_MAIL_HOST", raising=False)
    codes = [(await anon.post("/api/auth/signup", json={**BODY, "email": f"x{i}@acme.test"})).status_code for i in range(7)]
    assert codes[:5] == [200] * 5 and codes[5] == 429


async def test_google_start_needs_credentials(anon, monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    assert (await anon.get("/api/auth/google/start")).status_code == 404
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "sec")
    r = await anon.get("/api/auth/google/start")
    assert r.status_code == 302
    q = parse_qs(urlparse(r.headers["location"]).query)
    assert q["code_challenge_method"] == ["S256"] and q["client_id"] == ["cid"] and q["state"][0]
    assert "g_state=" in r.headers["set-cookie"] and "HttpOnly" in r.headers["set-cookie"]


async def test_google_callback_links_existing_user_by_verified_email(anon, db, monkeypatch):
    from app.api import signup

    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "sec")
    op, _ = await make_user(db, "gina", "Operator")
    op.email = "gina@corp.test"
    await db.commit()

    start = await anon.get("/api/auth/google/start")
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    cookie = start.cookies.get("g_state") or start.headers["set-cookie"].split("g_state=")[1].split(";")[0]

    async def fake_identity(code, verifier, nonce):
        return {"sub": "g-123", "email": "gina@corp.test", "email_verified": True, "name": "Gina"}

    monkeypatch.setattr(signup, "_google_identity", fake_identity)
    # Wrong state is refused.
    r = await anon.get(f"/api/auth/google/callback?code=c&state=nope", cookies={"g_state": cookie})
    assert "google_error=expired" in r.headers["location"]

    start = await anon.get("/api/auth/google/start")
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    cookie = start.headers["set-cookie"].split("g_state=")[1].split(";")[0]
    r = await anon.get(f"/api/auth/google/callback?code=c&state={state}", cookies={"g_state": cookie})
    assert r.status_code == 303 and "?google=" in r.headers["location"], r.headers["location"]
    one_time = r.headers["location"].split("?google=")[1]

    r = await anon.post("/api/auth/google/exchange", json={"code": one_time})
    assert r.status_code == 200, r.text
    assert r.json()["operator"]["username"] == "gina"
    # The code works once.
    assert (await anon.post("/api/auth/google/exchange", json={"code": one_time})).status_code == 401
    await db.refresh(op)
    assert op.google_sub == "g-123"


async def test_google_unknown_account_without_signup(anon, monkeypatch):
    from app.api import signup

    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "sec")
    monkeypatch.delenv("ALLOW_SIGNUP", raising=False)

    async def fake_identity(code, verifier, nonce):
        return {"sub": "g-999", "email": "stranger@x.test", "email_verified": True}

    monkeypatch.setattr(signup, "_google_identity", fake_identity)
    start = await anon.get("/api/auth/google/start")
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    cookie = start.headers["set-cookie"].split("g_state=")[1].split(";")[0]
    r = await anon.get(f"/api/auth/google/callback?code=c&state={state}", cookies={"g_state": cookie})
    assert "google_error=no_account" in r.headers["location"]
