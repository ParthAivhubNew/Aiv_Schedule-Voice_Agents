"""Sign-in on a white-label host: no open sign-up, Google and password follow the brand's settings; other hosts behave as before."""
import pytest

from app.models.models import Brand, BrandDomain
from app.services import tenant_policy as TP
from tests.conftest import make_user

db_only = pytest.mark.db
HOST = {"host": "outreach.fsb.example"}
SIGNUP = {"company": "Acme Ltd", "name": "Ann", "email": "ann@acme.example", "password": "Str0ng-pass!"}


async def _brand(db, signin):
    db.add(Brand(id="brd_s", name="FSB", status="active", policy=TP.clean_policy({"signin": signin})))
    await db.flush()
    db.add(BrandDomain(host="outreach.fsb.example", brand_id="brd_s", verified=True))
    await db.commit()
    TP.invalidate()


@db_only
async def test_ordinary_host_is_unchanged(anon, monkeypatch):
    monkeypatch.setenv("ALLOW_SIGNUP", "true")
    r = await anon.get("/api/auth/signup-config")
    assert r.json()["allowSignup"] is True
    r = await anon.post("/api/auth/signup", json=SIGNUP)
    assert r.status_code != 404


@db_only
async def test_brand_host_closes_signup_and_google(db, anon, monkeypatch):
    monkeypatch.setenv("ALLOW_SIGNUP", "true")
    await _brand(db, {"password": True, "google": False})
    cfg = (await anon.get("/api/auth/signup-config", headers=HOST)).json()
    assert cfg["allowSignup"] is False and cfg["google"] is False and "firebase" not in cfg
    assert (await anon.post("/api/auth/signup", json=SIGNUP, headers=HOST)).status_code == 404
    assert (await anon.post("/api/auth/firebase", json={"idToken": "x"}, headers=HOST)).status_code == 404
    # the same app on another host still offers sign-up
    assert (await anon.get("/api/auth/signup-config")).json()["allowSignup"] is True


@db_only
async def test_password_login_follows_the_brand(db, anon):
    await make_user(db, "member", "Operator", password="Str0ng-pass!")
    await _brand(db, {"password": False, "google": True})
    body = {"username": "member", "password": "Str0ng-pass!"}
    assert (await anon.post("/api/auth/login", json=body, headers=HOST)).status_code == 403
    assert (await anon.post("/api/auth/login", json=body)).status_code == 200
    await db.execute(__import__("sqlalchemy").text("UPDATE brands SET policy = :p WHERE id = 'brd_s'"),
                     {"p": __import__("json").dumps(TP.clean_policy({"signin": {"password": True}}))})
    await db.commit()
    TP.invalidate()
    assert (await anon.post("/api/auth/login", json=body, headers=HOST)).status_code == 200
