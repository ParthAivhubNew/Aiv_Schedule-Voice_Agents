"""A number already on our Telnyx account (Aivhub's own line) is given to a company by staff, the
old saved caller ID is Aivhub's only, and system logs stay with staff."""
import pytest

from tests.conftest import make_user
from tests.test_telnyx import FakeTelnyx, _as

pytestmark = pytest.mark.db


class NumbersFake(FakeTelnyx):
    async def __call__(self, client, method, path, *, params=None, json=None, files=None, data=None):
        if path == "/phone_numbers":
            self.calls.append((method, path, json))
            want = (params or {}).get("filter[phone_number]")
            return {"data": [{"id": "pn_old", "phone_number": want, "billing_group_id": ""}] if want == "+442071110000" else []}
        if path.startswith("/phone_numbers/") and method == "PATCH":
            self.calls.append((method, path, json))
            return {"data": {"id": "pn_old", **(json or {})}}
        return await super().__call__(client, method, path, params=params, json=json, files=files, data=data)


@pytest.fixture
def fake(monkeypatch):
    from app.services import telnyx_client

    f = NumbersFake()
    monkeypatch.setenv("TELNYX_API_KEY", "KEY_TEST")
    monkeypatch.delenv("TELNYX_ACCOUNT_MODE", raising=False)
    monkeypatch.setattr(telnyx_client.TelnyxClient, "_req", lambda self, *a, **k: f(self, *a, **k))
    return f


async def test_staff_give_a_company_a_number_we_already_own(staff, db, fake):
    from app.core.tenancy import org_scope
    from app.services.numbers import org_for_numbers

    _, tok = await make_user(db, "acme_boss", "Admin", org_id="org_acme")
    await make_user(db, "beta_boss", "Admin", org_id="org_beta")
    url = "/api/admin-api/clients/org_acme/numbers/attach"
    assert (await staff.post(url, json={"e164": "12"})).status_code == 400
    assert (await staff.post(url, json={"e164": "+442079999999"})).status_code == 404  # not on our account
    r = await staff.post(url, json={"e164": "+44 20 7111 0000"})
    assert r.status_code == 200, r.text
    assert ("PATCH", "/phone_numbers/pn_old", {"billing_group_id": "bg_1"}) in fake.calls  # billed to the company
    assert await org_for_numbers("+442071110000") == "org_acme"  # its incoming calls reach the company
    async with _as(tok) as c:
        nums = (await c.get("/api/telnyx/overview")).json()["numbers"]
    assert [(n["e164"], n["status"], n["isDefault"]) for n in nums] == [("+442071110000", "active", True)]
    # Adding it again changes nothing; another company cannot take it.
    assert (await staff.post(url, json={"e164": "+442071110000"})).status_code == 200
    assert (await staff.post("/api/admin-api/clients/org_beta/numbers/attach", json={"e164": "+442071110000"})).status_code == 409
    with org_scope("org_acme"):
        from sqlalchemy import func, select

        from app.models.models import OrgPhoneNumber
        assert (await db.execute(select(func.count()).select_from(OrgPhoneNumber))).scalar() == 1


async def test_the_old_caller_id_is_aivhubs_only(db, monkeypatch):
    from app.config import settings
    from app.core.tenancy import org_scope
    from app.services.telnyx_assistant_dial import _resolve_telnyx_from_number

    monkeypatch.setattr(settings, "TELNYX_PHONE_NUMBER", "+442071110000", raising=False)
    with org_scope("org_default"):
        assert await _resolve_telnyx_from_number(db) == "+442071110000"
    with org_scope("org_acme"):
        assert await _resolve_telnyx_from_number(db) is None


async def test_system_logs_are_for_staff_only(staff, db):
    _, tok = await make_user(db, "acme_admin2", "Admin", org_id="org_acme")
    async with _as(tok) as c:
        for path in ("/api/logs", "/api/logs/subsystems", "/api/logs/raw/calls"):
            r = await c.get(path)
            assert r.status_code == 403
        assert (await c.delete("/api/logs")).status_code == 403
    assert (await staff.get("/api/admin-api/logs")).status_code == 200


async def test_a_telnyx_key_saved_in_the_admin_portal_unlocks_numbers(client, db, monkeypatch):
    from app.core.platform import platform_org_id
    from app.core.tenancy import org_scope
    from app.models.models import Connection
    from app.services import telnyx_client
    from app.services.secret_box import seal_config

    monkeypatch.delenv("TELNYX_API_KEY", raising=False)
    monkeypatch.setattr("app.config.settings.TELNYX_API_KEY", "", raising=False)
    monkeypatch.setattr(telnyx_client, "_saved_key", "")
    assert (await client.get("/api/telnyx/overview")).json()["platformReady"] is False
    with org_scope(platform_org_id()):
        db.add(Connection(id="c_tel_test", group_name="Telephony", name="Telnyx", status="connected",
                          config=seal_config({"api_key": "KEY_SAVED"})))
        await db.commit()
    assert (await client.get("/api/telnyx/overview")).json()["platformReady"] is True
    assert telnyx_client.platform_key() == "KEY_SAVED"
