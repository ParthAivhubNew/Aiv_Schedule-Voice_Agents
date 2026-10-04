"""Self-serve signup, email verification, Google sign-in and the first-steps checklist."""
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


async def test_signup_on_by_default_and_can_be_switched_off(anon, monkeypatch):
    monkeypatch.delenv("ALLOW_SIGNUP", raising=False)
    assert (await anon.get("/api/auth/signup-config")).json()["allowSignup"] is True
    monkeypatch.setenv("ALLOW_SIGNUP", "false")
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


def _firebase(monkeypatch, project="outreach-test"):
    """A Firebase project with our own signing key standing in for Google's; returns a token maker."""
    import time

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from jose import jwk, jwt

    from app.api import signup

    monkeypatch.setenv("FIREBASE_API_KEY", "web-key")
    monkeypatch.setenv("FIREBASE_PROJECT_ID", project)
    pem = rsa.generate_private_key(public_exponent=65537, key_size=2048).private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    public = {**jwk.construct(pem, "RS256").public_key().to_dict(), "kid": "k1", "alg": "RS256", "use": "sig"}

    async def keys():
        return {"keys": [public]}

    monkeypatch.setattr(signup, "_firebase_keys", keys)

    def token(email, google_id, *, aud=project, provider="google.com", verified=True, name="Gina"):
        now = int(time.time())
        claims = {"iss": f"https://securetoken.google.com/{aud}", "aud": aud, "sub": "fb-" + google_id,
                  "iat": now, "exp": now + 3600, "auth_time": now, "email": email, "email_verified": verified, "name": name,
                  "firebase": {"sign_in_provider": provider, "identities": {"google.com": [google_id], "email": [email]}}}
        return jwt.encode(claims, pem.decode(), algorithm="RS256", headers={"kid": "k1"})

    return token


async def test_google_sign_in_needs_firebase_settings(anon, monkeypatch):
    monkeypatch.delenv("FIREBASE_API_KEY", raising=False)
    monkeypatch.delenv("FIREBASE_PROJECT_ID", raising=False)
    assert (await anon.post("/api/auth/firebase", json={"idToken": "x"})).status_code == 404
    assert (await anon.get("/api/auth/signup-config")).json()["google"] is False
    _firebase(monkeypatch)
    cfg = (await anon.get("/api/auth/signup-config")).json()
    assert cfg["google"] is True and cfg["firebase"] == {"apiKey": "web-key", "authDomain": "outreach-test.firebaseapp.com",
                                                         "projectId": "outreach-test", "appId": ""}


async def test_google_sign_in_links_existing_user_by_verified_email(anon, db, monkeypatch):
    token = _firebase(monkeypatch)
    op, _ = await make_user(db, "gina", "Operator")
    op.email = "gina@corp.test"
    await db.commit()

    # Tokens for another Firebase project, from email/password sign-in, or tampered with are refused.
    for bad in (token("gina@corp.test", "g-123", aud="someone-else"), token("gina@corp.test", "g-123", provider="password"),
                token("gina@corp.test", "g-123")[:-4] + "AAAA", "not-a-token"):
        assert (await anon.post("/api/auth/firebase", json={"idToken": bad})).status_code == 401

    r = await anon.post("/api/auth/firebase", json={"idToken": token("gina@corp.test", "g-123")})
    assert r.status_code == 200, r.text
    assert r.json()["operator"]["username"] == "gina"
    await db.refresh(op)
    assert op.google_sub == "g-123"  # the Google account id, same as before Firebase


async def test_google_unknown_account_without_signup(anon, monkeypatch):
    token = _firebase(monkeypatch)
    monkeypatch.setenv("ALLOW_SIGNUP", "false")
    r = await anon.post("/api/auth/firebase", json={"idToken": token("stranger@x.test", "g-999")})
    assert r.status_code == 403 and "No Outreach account" in r.json()["detail"]


async def test_forgot_and_reset_password(anon, db, monkeypatch):
    monkeypatch.setenv("SYSTEM_MAIL_HOST", "smtp.test")
    monkeypatch.setenv("SYSTEM_MAIL_USER", "u")
    monkeypatch.setenv("SYSTEM_MAIL_PASSWORD", "p")
    sent = {}

    async def fake_send(to, subject, html_body, text_body, reply_to=None):
        sent["to"], sent["html"] = to, html_body
        return {"ok": True}

    monkeypatch.setattr("app.core.mailer.send_system_email", fake_send)
    op, _ = await make_user(db, "rita", "Operator", password="Old-pass-2026")
    op.email = "rita@corp.test"
    await db.commit()

    r = await anon.post("/api/auth/forgot-password", json={"email": "nobody@corp.test"})
    assert r.json() == {"ok": True, "mailboxReady": True} and "to" not in sent
    await anon.post("/api/auth/forgot-password", json={"email": "RITA@corp.test"})
    token = sent["html"].split("reset-password?t=")[1].split('"')[0]

    assert (await anon.post("/api/auth/reset-password", json={"token": token, "password": "short"})).status_code == 400
    r = await anon.post("/api/auth/reset-password", json={"token": token, "password": "New-pass-2026"})
    assert r.status_code == 200, r.text
    # The link works once.
    r = await anon.post("/api/auth/reset-password", json={"token": token, "password": "Other-pass-2026"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "reset_expired"
    assert (await anon.post("/api/auth/login", json={"username": "rita", "password": "New-pass-2026"})).status_code == 200
    r = await anon.post("/api/auth/login", json={"username": "rita", "password": "Old-pass-2026"})
    assert r.status_code == 401 and r.json()["detail"]["code"] == "bad_credentials"
