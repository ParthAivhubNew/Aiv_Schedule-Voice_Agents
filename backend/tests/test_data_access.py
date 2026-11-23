"""FSB admin, user and per-user data access: one person's areas, export and Google switches inside an organisation's own policy.
Isolation between two people in one organisation (searches, counts, cached pages), by-id refusals with a clear message, the admin API, the
startup table, and the demo seeding (rename in place, the normal user, the FSB Operator role)."""
import csv
import io
import logging

import httpx
import pytest
from sqlalchemy import select, text

from app.core import migrations as M
from app.core.tenancy import org_scope
from app.main import app
from app.models.models import AuditLog, BusinessRecord as B, LeadAccount, Operator, OperatorDataScope, OperatorRole, Role
from app.services import data_access as DA
from app.services import fsb_demo as D
from app.services import tenant_policy as TP
from tests.conftest import make_user

pytestmark = pytest.mark.db

ORG = "org_da"
LOCK = {"exclusions": {"fsb": False, "extra": [], "locked": True}, "geo": {"districts": ["BN1", "BN2", "BN3"]}}
OUTSIDE = ("This company is outside the areas you have access to. You don't have the rights to view it. Ask your administrator to give you access.")
NOTICE = ("Some of what you searched for is outside the areas you have access to, so it is not shown. Ask your administrator to give you access.")


@pytest.fixture(autouse=True)
def fresh_caches(monkeypatch):
    from app.api import lead_accounts as LA

    TP.invalidate()
    LA._PAGE_CACHE.clear()
    monkeypatch.delenv("FSB_DEMO_PASSWORD", raising=False)
    monkeypatch.delenv("FSB_DEMO_USER_PASSWORD", raising=False)
    yield
    TP.invalidate()
    LA._PAGE_CACHE.clear()


def client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


def rec(n, name, postcode):
    return B(id=f"b{n}", identity_hash=f"h{n}", name=name, registration_number=f"0123456{n}", postcode=postcode, status="Active", company_category="Private limited Company",
             sic_codes="|43220|", sic_text="x", sources=[], rank_score=0, region="Hove", industry="Plumbing")


async def world(db, lock=True):
    """An organisation with an area lock (BN1-BN3), an admin, two ordinary users, three companies (BN1, BN2, BN3) and one outside the lock (LS1)."""
    from app.models.models import Brand

    db.add(Brand(id="brd_t", name="T", display_name="T", status="active", policy=TP.clean_policy(LOCK if lock else {})))
    await db.execute(text("INSERT INTO organizations (id, name, slug, status, brand_id) VALUES (:i, :i, :i, 'active', :b)"), {"i": ORG, "b": "brd_t"})
    await db.commit()
    _, adm = await make_user(db, "adm", "Admin", org_id=ORG)
    u1, t1 = await make_user(db, "one", "Operator", org_id=ORG)
    u2, t2 = await make_user(db, "two", "Operator", org_id=ORG)
    db.add_all([rec(1, "Alpha Plumbing Ltd", "BN1 1AA"), rec(2, "Beta Plumbing Ltd", "BN2 2AA"), rec(3, "Gamma Plumbing Ltd", "BN3 3AA"), rec(4, "Delta Plumbing Ltd", "LS1 1AA")])
    await db.commit()
    TP.invalidate()
    return {"adm": adm, "t1": t1, "t2": t2, "u1": u1, "u2": u2}


async def limit(c, op_id, **body):
    r = await c.put(f"/api/org/data-access/{op_id}", json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def search(c, filters=None, **extra):
    r = await c.post("/api/leads/search", json={"filters": filters or {"postcode_prefixes": ["BN"]}, "limit": 25, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def names(out):
    return sorted(c["name"] for c in out["companies"])


# ---- isolation between two people ------------------------------------------------------------------
async def test_two_people_in_one_org_never_share_counts_or_pages(db):
    w = await world(db)
    async with client(w["adm"]) as a:
        await limit(a, w["u1"].id, districts=["BN1"])
    async with client(w["t1"]) as c1, client(w["t2"]) as c2, client(w["adm"]) as ca:
        for _ in range(2):  # the second round is served from the page cache: it must still be each person's own
            o1, o2, oa = await search(c1), await search(c2), await search(ca)
            assert names(o1) == ["Alpha Plumbing Ltd"] and o1["total"] == 1
            assert names(o2) == ["Alpha Plumbing Ltd", "Beta Plumbing Ltd", "Gamma Plumbing Ltd"] and o2["total"] == 3
            assert names(oa) == names(o2)
        s1 = (await c1.post("/api/leads/search/summary", json={"filters": {"postcode_prefixes": ["BN"]}})).json()
        s2 = (await c2.post("/api/leads/search/summary", json={"filters": {"postcode_prefixes": ["BN"]}})).json()
        assert s1["total"] == 1 and s2["total"] == 3


async def test_the_opening_list_does_not_use_the_shared_complete_companies(db):
    w = await world(db)
    async with client(w["adm"]) as a:
        await limit(a, w["u1"].id, districts=["BN1"])
    async with client(w["t1"]) as c1:
        out = await search(c1, {})
    assert names(out) == ["Alpha Plumbing Ltd"]
    async with client(w["t1"]) as c1:
        pol = None
        with org_scope(ORG):
            from app.core.tenancy import scope_actor

            with scope_actor(w["u1"].id):
                pol = await TP.effective(db)
        assert not pol.is_empty and pol.cache_key() != (await TP.org_effective(db, ORG)).cache_key()
    assert TP._CACHE[ORG][1].user_districts == []  # the organisation's cached policy was never changed


async def test_an_admin_can_give_any_postcode_district_and_the_area_lock_is_lifted_for_admins_and_listed_people(db):
    from app.core.tenancy import scope_actor

    w = await world(db)
    async with client(w["adm"]) as a:
        r = await a.put(f"/api/org/data-access/{w['u1'].id}", json={"districts": ["BN1", "LS1"]})
        assert r.status_code == 200 and r.json()["districts"] == ["BN1", "LS1"]  # LS1 is outside the BN lock and is allowed
        assert (await a.get("/api/org/data-access")).json()["any_district"] is True
    adm_id = (await db.execute(select(Operator.id).where(Operator.username == "adm"))).scalar()
    u1_id = w["u1"].id  # read before the rollback expires the object
    await db.rollback()
    for who, want in ((adm_id, []), (u1_id, ["BN1", "LS1"])):
        with org_scope(ORG):
            with scope_actor(who):
                pol = await TP.effective(db)
        assert pol.geo_districts == [] and pol.user_districts == want  # the BN lock does not apply to an admin or to a person with their own list
    assert (await TP.org_effective(db, ORG)).geo_districts  # the organisation's own lock is still there for everyone else
    async with client(w["adm"]) as a:
        r = await a.put(f"/api/org/data-access/{u1_id}", json={"districts": ["nonsense"]})
        assert r.status_code == 400
        ok = await limit(a, u1_id, districts=["bn1", "BN 2"])
        assert ok["districts"] == ["BN1", "BN2"]


async def test_admins_are_never_narrowed(db):
    w = await world(db)
    adm_id = (await db.execute(select(Operator.id).where(Operator.username == "adm"))).scalar()
    await db.rollback()  # the next transaction starts inside the organisation
    with org_scope(ORG):
        db.add(OperatorDataScope(operator_id=adm_id, org_id=ORG, districts=["BN1"], allow_export=False, allow_google=False))  # forced row: must be ignored
        await db.commit()
    async with client(w["adm"]) as a:
        assert (await search(a))["total"] == 3
        assert (await a.post("/api/exports/preview", json={"kind": "companies", "scope": {"ids": ["x"]}})).status_code != 403
        r = await a.put(f"/api/org/data-access/{adm_id}", json={"districts": ["BN1"]})
        assert r.status_code == 400
        me = (await a.get("/api/auth/me")).json()["data_access"]
        assert me == {"limited": False, "districts": [], "allow_export": True, "allow_google": True}


async def test_a_failed_lookup_denies_and_is_not_remembered(db, monkeypatch):
    w = await world(db)
    real = DA._read

    async def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(DA, "_read", boom)
    async with client(w["t2"]) as c:
        r = await c.post("/api/leads/search", json={"filters": {"postcode_prefixes": ["BN"]}})
        assert r.status_code == 503 and r.json() == {"detail": "Couldn't check your access. Try again.", "code": "access_check_failed"}
        monkeypatch.setattr(DA, "_read", real)
        assert (await search(c))["total"] == 3  # the denial was not cached


async def test_a_missing_row_and_an_empty_list_mean_no_personal_limit(db):
    w = await world(db)
    async with client(w["t1"]) as c1:
        assert (await search(c1))["total"] == 3
        assert (await c1.get("/api/org/policy")).json()["data_access"] == {"limited": False, "districts": [], "allow_export": True, "allow_google": True}
    async with client(w["adm"]) as a:
        await limit(a, w["u1"].id, districts=["BN1"])
        await limit(a, w["u1"].id, districts=[])
    async with client(w["t1"]) as c1:
        assert (await search(c1))["total"] == 3


# ---- by-id reads and notices ------------------------------------------------------------------------
async def test_by_id_read_outside_the_areas_is_a_clear_403(db):
    w = await world(db)
    with org_scope(ORG):
        db.add(LeadAccount(id="la_3", name="Gamma Plumbing Ltd", postcode="BN3 3AA", business_record_id="b3"))
        db.add(LeadAccount(id="la_1", name="Alpha Plumbing Ltd", postcode="BN1 1AA", business_record_id="b1"))
        await db.commit()
    async with client(w["adm"]) as a:
        await limit(a, w["u1"].id, districts=["BN1"])
    async with client(w["t1"]) as c:
        for url in ("/api/leads/companies/b3/contact-points", "/api/leads/accounts/la_3/registry", "/api/leads/companies/b3/profile"):
            r = await c.get(url)
            assert r.status_code == 403 and r.json() == {"detail": OUTSIDE, "code": "outside_access"}, url
        assert (await c.get("/api/leads/companies/b1/contact-points")).status_code != 403
        assert (await c.get("/api/leads/accounts/la_1/registry")).status_code == 200
        saved = (await c.get("/api/leads/accounts")).json()
        assert [x["id"] for x in saved["accounts"]] == ["la_1"] and saved["access_notice"] == NOTICE
    async with client(w["t2"]) as c:
        assert (await c.get("/api/leads/accounts/la_3/registry")).status_code == 200


async def test_a_search_wholly_outside_the_areas_is_empty_with_a_notice(db):
    w = await world(db)
    async with client(w["adm"]) as a:
        await limit(a, w["u1"].id, districts=["BN1"])
    async with client(w["t1"]) as c:
        out = await search(c, {"postcode_prefixes": ["BN3"]})
        assert out["companies"] == [] and out["total"] == 0 and out["access_notice"] == NOTICE
        inside = await search(c, {"postcode_prefixes": ["BN1"]})
        assert names(inside) == ["Alpha Plumbing Ltd"] and "access_notice" not in inside
        partly = await search(c, {"postcode_prefixes": ["BN1", "BN3"]})
        assert names(partly) == ["Alpha Plumbing Ltd"] and partly["access_notice"] == NOTICE
    async with client(w["t2"]) as c:
        assert "access_notice" not in await search(c, {"postcode_prefixes": ["BN3"]})


async def test_a_saved_list_drops_outside_companies_with_a_notice(db):
    w = await world(db)
    with org_scope(ORG):
        db.add_all([LeadAccount(id="la_3", name="Gamma Plumbing Ltd", postcode="BN3 3AA", business_record_id="b3"),
                    LeadAccount(id="la_1", name="Alpha Plumbing Ltd", postcode="BN1 1AA", business_record_id="b1")])
        await db.commit()
    async with client(w["adm"]) as a:
        made = (await a.post("/api/leads/lists", json={"name": "Mine", "ids": ["la_1", "la_3"]})).json()["list"]["id"]
        await limit(a, w["u1"].id, districts=["BN1"])
    async with client(w["t1"]) as c:
        got = (await c.get("/api/leads/lists")).json()
        lst = next(l for l in got["lists"] if l["id"] == made)
        assert lst["ids"] == ["la_1"] and got["access_notice"] == NOTICE
    async with client(w["t2"]) as c:
        got = (await c.get("/api/leads/lists")).json()
        assert next(l for l in got["lists"] if l["id"] == made)["ids"] == ["la_1", "la_3"] and "access_notice" not in got


# ---- export and Google --------------------------------------------------------------------------------
async def test_export_and_google_are_allowed_by_default_and_403_when_switched_off(db):
    w = await world(db)
    with org_scope(ORG):
        db.add(LeadAccount(id="la_1", name="Alpha Plumbing Ltd", postcode="BN1 1AA", business_record_id="b1", phone="01273 111111"))
        await db.commit()
    body = {"kind": "companies", "scope": {"ids": ["la_1"]}}
    async with client(w["t2"]) as c:
        assert (await c.post("/api/exports/preview", json=body)).status_code == 200
        assert (await c.post("/api/exports", json={**body, "format": "wide"})).status_code == 200
    async with client(w["adm"]) as a:
        await limit(a, w["u2"].id, allow_export=False, allow_google=False)
    async with client(w["t2"]) as c:
        for path, payload in (("/api/exports/preview", body), ("/api/exports", {**body, "format": "wide"})):
            r = await c.post(path, json=payload)
            assert r.status_code == 403 and r.json() == {"detail": "Export is switched off for your account. Ask your administrator to turn it on.", "code": "export_off"}
        r = await c.get("/api/leads/companies/b1/google-view")
        assert r.status_code == 403 and r.json()["code"] == "google_off"
        assert (await c.get("/api/auth/me")).json()["data_access"] == {"limited": False, "districts": [], "allow_export": False, "allow_google": False}
    async with client(w["adm"]) as a:  # an admin is unaffected, and the other user keeps the default
        assert (await a.post("/api/exports/preview", json=body)).status_code == 200
    async with client(w["t1"]) as c:
        assert (await c.post("/api/exports/preview", json=body)).status_code == 200


async def test_an_export_keeps_the_starting_persons_areas(db):
    from app.services import export_engine as EE

    w = await world(db)
    with org_scope(ORG):
        db.add_all([LeadAccount(id="la_1", name="Alpha Plumbing Ltd", postcode="BN1 1AA", business_record_id="b1", phone="01273 111111"),
                    LeadAccount(id="la_3", name="Gamma Plumbing Ltd", postcode="BN3 3AA", business_record_id="b3", phone="01273 333333")])
        await db.commit()
    async with client(w["adm"]) as a:
        await limit(a, w["u1"].id, districts=["BN1"])
    body = {"kind": "companies", "scope": {"ids": ["la_1", "la_3"]}, "format": "wide"}
    async with client(w["t1"]) as c:
        p = (await c.post("/api/exports/preview", json=body)).json()
        assert p["rows"] == 1 and p["access_notice"] == NOTICE
        r = await c.post("/api/exports", json=body)
        rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
        assert [x[1] for x in rows[1:]] == ["Alpha Plumbing Ltd"] and r.headers["x-access-notice"] == NOTICE
        only3 = await c.post("/api/exports", json={**body, "scope": {"ids": ["la_3"]}})
        assert only3.status_code == 403 and only3.json()["code"] == "outside_access"
    async with client(w["t2"]) as c:
        assert (await c.post("/api/exports/preview", json=body)).json()["rows"] == 2
    # a file built later, outside any request, takes the operator it was started by; with nobody known and a limit in force it is refused
    with org_scope(ORG):
        recs, tally, _ = await EE.build(db, "companies", {"ids": ["la_1", "la_3"]}, None, operator_id=w["u1"].id)
        assert [r["ids"]["company_id"] for r in recs] == ["la_1"] and tally.outside == 1
        with pytest.raises(DA.AccessDenied):
            await EE.build(db, "companies", {"ids": ["la_1"]}, None)
        recs, _, _ = await EE.build(db, "companies", {"ids": ["la_1", "la_3"]}, None, operator_id=w["u2"].id)
        assert len(recs) == 2


# ---- the admin API -----------------------------------------------------------------------------------
async def test_the_admin_api_is_admin_only_and_stays_in_the_organisation(db):
    w = await world(db)
    other, _ = await make_user(db, "outsider", "Operator", org_id="org_zz")
    async with client(w["t1"]) as c:  # a normal user: refused by the section rule, and by the handler even if the section were shared
        assert (await c.get("/api/org/data-access")).status_code == 403
        assert (await c.put(f"/api/org/data-access/{w['u2'].id}", json={"districts": ["BN1"]})).status_code == 403
        assert (await c.get(f"/api/org/data-access/{w['u2'].id}/preview")).status_code == 403
    from app.api import data_access as API
    from types import SimpleNamespace

    req = SimpleNamespace(state=SimpleNamespace(auth={"org_id": ORG, "is_admin": False, "operator_id": w["u1"].id}))
    with pytest.raises(Exception) as err:
        API._admin(req)
    assert err.value.status_code == 403
    async with client(w["adm"]) as a:
        assert (await a.put(f"/api/org/data-access/{other.id}", json={"districts": ["BN1"]})).status_code == 404
        assert (await a.put("/api/org/data-access/op_nobody", json={"districts": ["BN1"]})).status_code == 404
        assert (await a.get(f"/api/org/data-access/{other.id}/preview")).status_code == 404
        assert (await a.get(f"/api/org/data-access/op_nobody/preview")).status_code == 404
        got = (await a.get("/api/org/data-access")).json()
        assert got["districts_allowed"] == ["BN1", "BN2", "BN3"] and {r["name"] for r in got["roles"]} >= {"Admin", "Operator"}
        ids = [u["id"] for u in got["users"]]
        assert other.id not in ids and w["u1"].id in ids
        one = next(u for u in got["users"] if u["id"] == w["u1"].id)
        assert one == {"id": w["u1"].id, "name": "One", "username": "one", "email": "", "is_admin": False, "active": True,
                       "roles": [{"id": one["roles"][0]["id"], "name": "Operator"}], "districts": [], "allow_export": True, "allow_google": True}
        prev = (await a.get(f"/api/org/data-access/{w['u2'].id}/preview")).json()
        assert prev == {"companies": 3, "districts": []}
        await limit(a, w["u1"].id, districts=["BN1", "BN2"])
        assert (await a.get(f"/api/org/data-access/{w['u1'].id}/preview")).json() == {"companies": 2, "districts": ["BN1", "BN2"]}
        adm_id = next(u["id"] for u in got["users"] if u["is_admin"])
        assert (await a.put(f"/api/org/data-access/{adm_id}", json={"allow_export": False})).status_code == 400
        assert (await a.put(f"/api/org/data-access/{adm_id}", json={"role_id": got["roles"][0]["id"]})).status_code == 400  # an admin's role is not changed here


async def test_role_change_replaces_the_non_admin_roles_and_every_change_is_audited(db):
    w = await world(db)
    async with client(w["adm"]) as a:
        roles = {r["name"]: r["id"] for r in (await a.get("/api/org/data-access")).json()["roles"]}
        done = await limit(a, w["u1"].id, role_id=roles["Viewer"], districts=["BN2"], allow_export=False)
        assert [r["name"] for r in done["roles"]] == ["Viewer"] and done["districts"] == ["BN2"] and done["allow_export"] is False
        assert (await a.put(f"/api/org/data-access/{w['u1'].id}", json={"role_id": roles["Admin"]})).status_code == 400
        assert (await a.put(f"/api/org/data-access/{w['u1'].id}", json={"role_id": "role_nope"})).status_code == 404
    with org_scope(ORG):
        rows = (await db.execute(select(AuditLog).where(AuditLog.action == "data_access.changed"))).scalars().all()
        links = (await db.execute(select(OperatorRole.role_id).where(OperatorRole.operator_id == w["u1"].id))).scalars().all()
    assert links == [roles["Viewer"]]
    assert len(rows) == 1 and rows[0].target == w["u1"].id
    assert rows[0].detail["old"] == {"districts": [], "allow_export": True, "allow_google": True, "roles": ["Operator"]}
    assert rows[0].detail["new"] == {"districts": ["BN2"], "allow_export": False, "allow_google": True, "roles": ["Viewer"]}


# ---- the startup table ---------------------------------------------------------------------------------
async def test_the_scope_table_is_created_once_and_is_isolated_by_row_level_security(db):
    from app.core.tenancy import ensure_tenancy
    from app.database import engine

    async with engine.begin() as conn:
        await M._operator_data_scope(conn)
        await M._operator_data_scope(conn)  # safe to repeat
        await ensure_tenancy(conn)
        assert (await conn.execute(text("SELECT relrowsecurity FROM pg_class WHERE relname = 'operator_data_scope'"))).scalar() is True
    w = await world(db)
    with org_scope(ORG):
        db.add(OperatorDataScope(operator_id=w["u1"].id, org_id=ORG, districts=["BN1"]))
        await db.commit()
    with org_scope("org_default"):
        assert (await db.execute(select(OperatorDataScope))).scalars().all() == []
        await db.rollback()
    with org_scope(ORG):
        row = (await db.execute(select(OperatorDataScope))).scalars().first()
        assert row.districts == ["BN1"] and row.allow_export is True and row.allow_google is True


def test_a_fresh_database_still_starts():
    import app.main  # noqa: F401

    ids = [s[0] for s in M.STEPS]
    assert len(ids) == len(set(ids)) and "2026_12_01_operator_data_scope" in ids


# ---- demo seeding --------------------------------------------------------------------------------------
async def demo_step():
    from app.database import engine

    async with engine.begin() as conn:
        await M._ensure_fsb_demo_account(conn)
        await conn.execute(text("SELECT 1"))


async def ops(db):
    return [tuple(r) for r in (await db.execute(text("SELECT id, org_id, username, email FROM operators ORDER BY id"))).all()]


async def test_the_old_demo_operator_is_renamed_in_place_without_a_duplicate(db):
    from app.core.security import hash_password

    await db.execute(text("INSERT INTO organizations (id, name, slug, status) VALUES ('org_fsb_demo', 'FSB', 'fsb-demo', 'active')"))
    await db.execute(text("INSERT INTO operators (id, org_id, username, email, name, role, hashed_password, is_active) VALUES "
                          "('op_fsboutreach', 'org_fsb_demo', 'fsbdemo', 'fsbdemo@outreach.com', 'Old', 'Admin', :p, TRUE), "
                          "('op_bystander', 'org_default', 'fsbdemo2', 'bystander@example.com', 'By', 'Operator', :p, TRUE)"), {"p": hash_password("x-Old-pass-1")})
    await db.commit()
    await demo_step()
    got = await ops(db)
    assert ("op_fsboutreach", "org_fsb_demo", "fsbadmin", "fsbadmin@outreach.com") in got
    assert sum(1 for r in got if r[1] == "org_fsb_demo" and r[2] != "fsbuser") == 1 and ("op_bystander", "org_default", "fsbdemo2", "bystander@example.com") in got
    before = await ops(db)
    await demo_step()
    assert await ops(db) == before  # nothing new on a second run
    from app.core.security import verify_password

    pw = (await db.execute(text("SELECT hashed_password FROM operators WHERE id = 'op_fsboutreach'"))).scalar()
    assert verify_password(D.DEFAULT_PASSWORD, pw)[0]


async def test_the_normal_user_uses_the_demo_default_password_when_none_is_set(db, caplog):
    from app.core.security import verify_password

    with caplog.at_level(logging.WARNING, logger="fsb_demo"):
        await demo_step()
    assert [r for r in await ops(db) if r[2] == "fsbuser"]
    assert "FSB_DEMO_USER_PASSWORD is not set" in caplog.text and D.DEFAULT_USER_PASSWORD not in caplog.text  # warned, value never logged
    pw = (await db.execute(text("SELECT hashed_password FROM operators WHERE username = 'fsbuser'"))).scalar()
    assert verify_password(D.DEFAULT_USER_PASSWORD, pw)[0]


async def test_the_normal_user_and_the_fsb_operator_role(db, monkeypatch):
    from app.core.security import verify_password

    monkeypatch.setenv("FSB_DEMO_USER_PASSWORD", "User-pass-123")
    await demo_step()
    row = (await db.execute(text("SELECT id, org_id, email, name, role, hashed_password FROM operators WHERE username = 'fsbuser'"))).first()
    assert row[1:5] == ("org_fsb_demo", "fsbuser@outreach.com", "FSB User", "FSB Operator") and verify_password("User-pass-123", row[5])[0]
    role = (await db.execute(text("SELECT id, is_admin, levels::text FROM roles WHERE org_id = 'org_fsb_demo' AND name = 'FSB Operator'"))).first()
    assert role[1] is False
    import json

    levels = json.loads(role[2])
    assert levels == {"leadgen": "full", "calling": "full", "scheduler": "full", "email": "full", "calcom": "view", "company": "view",
                      "connections": "none", "team": "none", "analytics": "none", "process_logs": "none"}
    assert (await db.execute(text("SELECT role_id FROM operator_roles WHERE operator_id = :i"), {"i": row[0]})).scalars().all() == [role[0]]
    # the user can sign in, is not an admin, and never sees the admin screens
    from app.api.auth import check_credentials  # noqa: F401

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as anon:
        login = await anon.post("/api/auth/login", json={"username": "fsbuser", "password": "User-pass-123"})
        assert login.status_code == 200, login.text
        tok = login.json()["access_token"]
    async with client(tok) as c:
        assert (await c.get("/api/auth/me")).json()["is_admin"] is False
        assert (await c.get("/api/org/data-access")).status_code == 403


async def test_seeding_never_overwrites_an_edited_password_scope_or_role(db, monkeypatch):
    from app.core.security import hash_password, verify_password

    monkeypatch.setenv("FSB_DEMO_USER_PASSWORD", "User-pass-123")
    await demo_step()
    uid = (await db.execute(text("SELECT id FROM operators WHERE username = 'fsbuser'"))).scalar()
    await db.execute(text("UPDATE operators SET hashed_password = :p, name = 'Renamed' WHERE id = :i"), {"p": hash_password("Changed-pass-9"), "i": uid})
    await db.execute(text("UPDATE roles SET levels = CAST('{\"leadgen\": \"view\"}' AS JSON) WHERE id = :i"), {"i": D.USER_ROLE_ID})
    await db.commit()
    with org_scope("org_fsb_demo"):
        await db.execute(text("INSERT INTO operator_data_scope (operator_id, org_id, districts, allow_export, allow_google) VALUES (:i, 'org_fsb_demo', CAST('[\"BN1\"]' AS JSON), FALSE, TRUE)"), {"i": uid})
        await db.commit()
    monkeypatch.setenv("FSB_DEMO_USER_PASSWORD", "Another-pass-5")
    await demo_step()
    row = (await db.execute(text("SELECT hashed_password, name FROM operators WHERE id = :i"), {"i": uid})).first()
    assert verify_password("Changed-pass-9", row[0])[0] and row[1] == "Renamed"
    assert (await db.execute(text("SELECT levels::text FROM roles WHERE id = :i"), {"i": D.USER_ROLE_ID})).scalar().replace(" ", "") == '{"leadgen":"view"}'
    await db.rollback()
    with org_scope("org_fsb_demo"):
        scope = (await db.execute(text("SELECT districts::text, allow_export FROM operator_data_scope WHERE operator_id = :i"), {"i": uid})).first()
        await db.rollback()
    assert scope[0].replace(" ", "") == '["BN1"]' and scope[1] is False
    assert len([r for r in await ops(db) if r[2] == "fsbuser"]) == 1


async def test_seeding_leaves_real_users_alone(db, monkeypatch):
    from app.core.security import hash_password

    monkeypatch.setenv("FSB_DEMO_USER_PASSWORD", "User-pass-123")
    await db.execute(text("INSERT INTO operators (id, org_id, username, email, name, role, hashed_password, is_active) VALUES "
                          "('op_real', 'org_default', 'fsbuser', 'real@example.com', 'Real', 'Operator', :p, TRUE)"), {"p": hash_password("Real-pass-12")})
    await db.commit()
    before = (await db.execute(text("SELECT username, email, hashed_password, org_id FROM operators WHERE id = 'op_real'"))).first()
    await demo_step()
    after = (await db.execute(text("SELECT username, email, hashed_password, org_id FROM operators WHERE id = 'op_real'"))).first()
    assert tuple(before) == tuple(after)
    assert not [r for r in await ops(db) if r[1] == "org_fsb_demo" and r[2] == "fsbuser"]  # that username belongs to someone else, so no second one is made
