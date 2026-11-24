"""A sign-in name points at exactly one account: usernames are unique across every company, a shared e-mail address is never resolved to
"the first account found", and an admin can't give a new user an address another account already uses."""
import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.main import app
from tests.conftest import make_user

pytestmark = pytest.mark.db


def anon():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _op(db, op_id, org, username, email, password="Str0ng-pass!"):
    from app.core.security import hash_password

    await db.execute(text("INSERT INTO organizations (id, name, slug, status) VALUES (:o, :o, :o, 'active') ON CONFLICT DO NOTHING"), {"o": org})
    await db.execute(text("INSERT INTO operators (id, org_id, username, email, name, role, hashed_password, is_active) "
                          "VALUES (:i, :o, :u, :e, 'X', 'Admin', :p, TRUE)"), {"i": op_id, "o": org, "u": username, "e": email, "p": hash_password(password)})
    await db.commit()


async def test_the_same_username_can_never_exist_in_two_companies(db):
    await _op(db, "op_a", "org_a", "sam", None)
    with pytest.raises(IntegrityError):
        await _op(db, "op_b", "org_b", "SAM", None)  # case does not make it different
    await db.rollback()


async def test_a_shared_e_mail_address_is_refused_instead_of_signing_in_to_the_first_account(db):
    from app.api import auth as A

    A._FAILS.clear()
    await _op(db, "op_a", "org_a", "sam-a", "sam@example.com")
    await _op(db, "op_b", "org_b", "sam-b", "Sam@Example.com")
    async with anon() as c:
        r = await c.post("/api/auth/login", json={"username": "sam@example.com", "password": "Str0ng-pass!"})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "ambiguous_login"
        ok = await c.post("/api/auth/login", json={"username": "sam-b", "password": "Str0ng-pass!"})
        assert ok.status_code == 200  # the username still works


async def test_a_unique_username_or_e_mail_signs_in_as_before(db):
    from app.api import auth as A

    A._FAILS.clear()
    await _op(db, "op_a", "org_a", "solo", "solo@example.com")
    async with anon() as c:
        assert (await c.post("/api/auth/login", json={"username": "solo", "password": "Str0ng-pass!"})).status_code == 200
        assert (await c.post("/api/auth/login", json={"username": "SOLO@example.com", "password": "Str0ng-pass!"})).status_code == 200
        assert (await c.post("/api/auth/login", json={"username": "solo", "password": "wrong-pass-1"})).status_code == 401


async def test_an_admin_cannot_give_a_new_user_an_address_another_account_uses(db):
    await _op(db, "op_other", "org_other", "someone-else", "taken@example.com")
    _, token = await make_user(db, "boss", role="Admin", org_id="org_mine")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"}) as c:
        r = await c.post("/api/auth/users", json={"username": "newbie", "name": "New Bie", "email": "Taken@Example.com"})
        assert r.status_code == 400 and "already used" in r.json()["detail"]
        ok = await c.post("/api/auth/users", json={"username": "newbie", "name": "New Bie", "email": "fresh@example.com"})
        assert ok.status_code == 200, ok.text
