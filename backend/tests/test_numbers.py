"""Phone numbers: per organisation, assigned to users, used as caller ID."""
import pytest

from tests.conftest import make_user

pytestmark = pytest.mark.db


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


async def test_admin_manages_numbers_and_assignments(client, anon, db):
    op, tok = await make_user(db, "agent1", "Operator")
    r = await client.post("/api/numbers", json={"e164": "+44 20 7946 0001", "label": "Sales"})
    assert r.status_code == 200, r.text
    nums = r.json()
    assert nums[0]["e164"] == "+442079460001" and nums[0]["isDefault"] is True and nums[0]["shared"] is True
    r = await client.post("/api/numbers", json={"e164": "+442079460002", "label": "Support"})
    second = next(n for n in r.json() if n["label"] == "Support")
    # Operators can see the list but not change it.
    assert (await anon.get("/api/numbers", headers=_h(tok))).status_code == 200
    assert (await anon.post("/api/numbers", json={"e164": "+442079460003"}, headers=_h(tok))).status_code == 403
    # Assign "Support" to someone else: the operator can no longer use it.
    other, _ = await make_user(db, "agent2", "Operator")
    r = await client.put(f"/api/numbers/{second['id']}/assignments", json={"operator_ids": [other.id]})
    assert r.status_code == 200
    mine = (await anon.get("/api/numbers", headers=_h(tok))).json()
    assert next(n for n in mine if n["label"] == "Support")["usableByMe"] is False
    assert next(n for n in mine if n["label"] == "Sales")["usableByMe"] is True
    # Duplicate and bad numbers are refused.
    assert (await client.post("/api/numbers", json={"e164": "+442079460001"})).status_code == 400
    assert (await client.post("/api/numbers", json={"e164": "123"})).status_code == 400


async def test_caller_id_rules(db):
    from app.models.models import OrgPhoneNumber, PhoneNumberAssignment
    from app.services.numbers import pick_caller_id

    # No numbers saved: old behaviour decides.
    assert await pick_caller_id(db, {"operator_id": "x", "is_admin": False}, None) == (None, None)
    db.add(OrgPhoneNumber(id="n1", e164="+442079460001", is_default=True))
    db.add(OrgPhoneNumber(id="n2", e164="+442079460002"))
    await db.commit()
    op, _ = await make_user(db, "sam", "Operator")
    db.add(PhoneNumberAssignment(number_id="n2", operator_id=op.id))
    await db.commit()
    me = {"operator_id": op.id, "is_admin": False}
    other = {"operator_id": "someone_else", "is_admin": False}
    assert await pick_caller_id(db, me, None) == ("+442079460002", None)  # own number first
    assert await pick_caller_id(db, other, None) == ("+442079460001", None)  # else the default
    num, err = await pick_caller_id(db, other, "+44 20 7946 0002")
    assert num is None and "not allowed" in err
    assert (await pick_caller_id(db, {"operator_id": "a", "is_admin": True}, "+442079460002"))[0] == "+442079460002"


async def test_numbers_are_per_organisation(anon, db):
    from app.models.models import Organization

    db.add(Organization(id="org_b", name="B", slug="b"))
    await db.commit()
    _, a = await make_user(db, "admin_a", "Admin")
    _, b = await make_user(db, "admin_b", "Admin", org_id="org_b")
    await anon.post("/api/numbers", json={"e164": "+442079460009", "label": "A line"}, headers=_h(a))
    assert (await anon.get("/api/numbers", headers=_h(b))).json() == []


async def test_carrier_webhook_runs_in_the_numbers_organisation(db):
    from app.core.auth_middleware import AuthMiddleware
    from app.core.tenancy import current_org, org_scope
    from app.database import AsyncSessionLocal
    from app.models.models import OrgPhoneNumber, Organization

    db.add(Organization(id="org_b", name="B", slug="b"))
    await db.commit()
    with org_scope("org_b"):
        async with AsyncSessionLocal() as s:
            s.add(OrgPhoneNumber(id="nb", e164="+442079460077"))
            await s.commit()
    seen = {}

    async def app(scope, receive, send):
        seen["org"] = current_org()
        seen["body"] = (await receive())["body"]

    body = b'{"data":{"payload":{"to":"+442079460077","from":"+447700900123"}}}'
    msgs = [{"type": "http.request", "body": body, "more_body": False}]

    async def receive():
        return msgs.pop(0)

    async def send(_):
        pass

    await AuthMiddleware(app)({"type": "http", "path": "/api/telnyx-assistant/call-event", "method": "POST", "headers": []}, receive, send)
    assert seen["org"] == "org_b" and seen["body"] == body
