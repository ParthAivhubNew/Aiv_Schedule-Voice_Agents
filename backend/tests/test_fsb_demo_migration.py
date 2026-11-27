"""The FSB demo account: its own organisation, linked to the FSB brand, an Admin in it, credits in every wallet, and the brand policy
really applied to its searches. The startup step shares one transaction with every other step, so a failure in it must never stop the app."""
import logging

import pytest
from sqlalchemy import text

from app.core import migrations as M
from app.core.tenancy import org_scope
from app.models.models import BusinessRecord as B
from app.services import business_records as BR
from app.services import fsb_demo as D
from app.services import tenant_policy as TP

pytestmark = pytest.mark.db

LOGIN = {"username": D.EMAIL, "password": D.DEFAULT_PASSWORD}


@pytest.fixture(autouse=True)
def default_password(monkeypatch):
    monkeypatch.delenv("FSB_DEMO_PASSWORD", raising=False)
    TP.invalidate()
    yield
    TP.invalidate()


async def run_step():
    from app.database import engine

    async with engine.begin() as conn:
        await M._ensure_fsb_demo_account(conn)
        await conn.execute(text("SELECT 1"))  # the startup transaction is still usable afterwards


async def run_seed():
    from app.database import engine

    async with engine.begin() as conn:
        await M._seed_fsb_rules(conn)


async def snapshot(db):
    out = {}
    for name, sql in {"operators": "SELECT id, org_id, username, email, role, hashed_password, is_active FROM operators ORDER BY id",
                      "orgs": "SELECT id, slug, brand_id FROM organizations ORDER BY id", "brands": "SELECT id, name, policy::text FROM brands ORDER BY id",
                      "roles": "SELECT id, org_id, name FROM roles ORDER BY id", "links": "SELECT operator_id, role_id FROM operator_roles ORDER BY 1, 2"}.items():
        out[name] = [tuple(r) for r in (await db.execute(text(sql))).all()]
    return out


async def test_a_fresh_database_gets_the_org_the_brand_and_the_operator_in_it(db):
    await run_step()
    org = (await db.execute(text("SELECT name, slug, status, brand_id FROM organizations WHERE id = 'org_fsb_demo'"))).first()
    assert org[:3] == ("Federation of Small Businesses (demo)", "fsb-demo", "active") and org[3]
    brand = (await db.execute(text("SELECT name, display_name, powered_by, hide_credits, status FROM brands WHERE id = :b"), {"b": org[3]})).first()
    assert tuple(brand) == ("FSB", "Federation of Small Businesses", True, True, "active")
    op = (await db.execute(text("SELECT org_id, role, is_active, email, must_change_password FROM operators WHERE username = 'fsbadmin'"))).all()
    assert [tuple(r) for r in op] == [("org_fsb_demo", "Admin", True, "fsbadmin@outreach.com", False)]  # one account, not in org_default
    admin = (await db.execute(text("SELECT r.name, r.org_id FROM operator_roles o JOIN roles r ON r.id = o.role_id JOIN operators p ON p.id = o.operator_id "
                                   "WHERE p.username = 'fsbadmin'"))).all()
    assert [tuple(r) for r in admin] == [("Admin", "org_fsb_demo")]
    assert (await db.execute(text("SELECT count(*) FROM operators WHERE org_id = 'org_default'"))).scalar() == 0


async def test_the_brand_carries_the_fsb_policy(db):
    await run_step()
    policy = (await db.execute(text("SELECT policy FROM brands WHERE name = 'FSB'"))).scalar()
    assert policy == TP.clean_policy(D.DEMO_POLICY)
    assert policy["geo"]["districts"] == []  # FSB is national: no postcode lock
    assert "exclusions" not in policy and policy["member_suppression"] is True  # the exclusion list is the organisation's own rows, not the brand
    assert policy["restricted_sources"] == {"google": True, "apollo": True, "search_engines": True}
    assert policy["signin"] == {"password": True, "google": False, "microsoft": True} and policy["screening"] == {"block_unscreened": True}


async def test_the_demo_login_works_with_the_default_password_and_lands_in_the_demo_org(db, anon):
    await run_step()
    ok = await anon.post("/api/auth/login", json=LOGIN)
    assert ok.status_code == 200
    from app.core.security import decode_token

    assert decode_token(ok.json()["access_token"], "access").get("org") == "org_fsb_demo"
    by_name = await anon.post("/api/auth/login", json={"username": "fsbadmin", "password": D.DEFAULT_PASSWORD})
    assert by_name.status_code == 200
    assert (await anon.post("/api/auth/login", json={"username": D.EMAIL, "password": "wrong"})).status_code == 401


async def test_the_password_comes_from_the_environment_and_the_default_is_only_a_warned_fallback(db, anon, monkeypatch, caplog):
    with caplog.at_level(logging.WARNING, logger="fsb_demo"):
        await run_step()
    assert "FSB_DEMO_PASSWORD is not set" in caplog.text and D.DEFAULT_PASSWORD not in caplog.text
    monkeypatch.setenv("FSB_DEMO_PASSWORD", "Another-Secret-77")
    caplog.clear()
    with caplog.at_level(logging.WARNING, logger="fsb_demo"):
        await run_step()
    assert "Another-Secret-77" not in caplog.text and "FSB_DEMO_PASSWORD is not set" not in caplog.text
    assert (await anon.post("/api/auth/login", json={"username": D.EMAIL, "password": "Another-Secret-77"})).status_code == 200
    assert (await anon.post("/api/auth/login", json=LOGIN)).status_code == 401


async def test_a_real_user_with_a_similar_name_or_email_is_never_modified(db):
    from app.core.security import hash_password

    pw = hash_password("Real-pass-123")
    for i, (user, email) in enumerate([("fsboutreach", "fsboutreach@fsb.org.uk"), ("fsbdemo2", "fsbdemo@outreach.com.au"), ("someone", "fsbdemo@outreach.co"),
                                       ("op_fsbdemo_like", "other@example.com")]):
        await db.execute(text("INSERT INTO operators (id, org_id, username, name, role, email, hashed_password, is_active) "
                              "VALUES (:i, 'org_default', :u, 'Real', 'Operator', :e, :p, TRUE)"), {"i": f"op_real{i}", "u": user, "e": email, "p": pw})
    await db.commit()
    real = lambda snap: [r for r in snap["operators"] if r[0].startswith("op_real")]  # noqa: E731
    first = real(await snapshot(db))
    await run_step()
    after = await snapshot(db)
    assert real(after) == first and len(first) == 4
    assert [r[1] for r in after["operators"] if r[2] == "fsbadmin"] == ["org_fsb_demo"]


async def test_an_address_held_by_another_user_is_not_taken_over(db, anon):
    from app.core.security import hash_password

    await db.execute(text("INSERT INTO operators (id, org_id, username, name, role, email, hashed_password, is_active) "
                          "VALUES ('op_owner', 'org_default', 'owner', 'Owner', 'Admin', 'fsbadmin@outreach.com', :p, TRUE)"), {"p": hash_password("Owner-pass-123")})
    await db.commit()
    await run_step()
    row = (await db.execute(text("SELECT email, org_id FROM operators WHERE username = 'fsbadmin'"))).first()
    assert tuple(row) == (None, "org_fsb_demo")
    assert (await anon.post("/api/auth/login", json={"username": "fsbadmin", "password": D.DEFAULT_PASSWORD})).status_code == 200
    assert (await anon.post("/api/auth/login", json={"username": D.EMAIL, "password": "Owner-pass-123"})).status_code == 200


async def test_the_older_demo_account_in_org_default_moves_into_the_demo_org(db, anon):
    from app.core.accounts import assign_roles, ensure_system_roles
    from app.core.security import hash_password
    from app.models.models import AppSetting, Operator

    roles = await ensure_system_roles(db, "org_default")
    old = Operator(id="op_fsboutreach", org_id="org_default", username="fsbdemo", name="FSB Demo", role="Admin", email="fsbdemo@outreach.com",
                   hashed_password=hash_password("Old-pass-123"), is_active=True)
    db.add(old)
    db.add(AppSetting(id="leadlists:org_default", data={"lists": [{"id": "lst_1", "name": "Mine", "ids": []}]}))
    await db.flush()
    await assign_roles(db, old, [roles["Admin"].id])
    await db.commit()
    await run_step()
    ops = (await db.execute(text("SELECT id, org_id FROM operators WHERE username = 'fsbadmin'"))).all()
    assert [tuple(r) for r in ops] == [("op_fsboutreach", "org_fsb_demo")]
    assert (await db.execute(text("SELECT r.org_id FROM operator_roles o JOIN roles r ON r.id = o.role_id WHERE o.operator_id = 'op_fsboutreach'"))).scalars().all() == ["org_fsb_demo"]
    assert (await db.execute(text("SELECT data::text FROM app_settings WHERE id = 'leadlists:org_default'"))).scalar()  # org_default keeps its data
    assert (await anon.post("/api/auth/login", json=LOGIN)).status_code == 200


async def test_running_it_twice_changes_nothing(db):
    await run_step()
    first = await snapshot(db)
    await run_step()
    await run_step()
    assert await snapshot(db) == first
    assert len(first["brands"]) == 1


async def test_a_failure_in_the_step_is_skipped_and_does_not_abort_the_startup_transaction(db, monkeypatch):
    from app.database import engine

    async def broken(conn):
        await conn.execute(text("SELECT * FROM table_that_does_not_exist"))

    monkeypatch.setattr(M, "_fsb_demo_account", broken)
    async with engine.begin() as conn:
        await M._ensure_fsb_demo_account(conn)  # logs a warning and carries on
        assert (await conn.execute(text("SELECT 1"))).scalar() == 1
        await conn.execute(text("CREATE TABLE IF NOT EXISTS schema_migrations (id VARCHAR PRIMARY KEY, applied_at TIMESTAMP NOT NULL)"))


async def test_the_old_step_is_a_recorded_no_op_so_it_cannot_put_the_demo_in_org_default(db):
    from app.database import engine

    async with engine.begin() as conn:
        await M._ensure_fsb_demo_operator(conn)
    assert (await db.execute(text("SELECT count(*) FROM operators"))).scalar() == 0
    ids = [i for i, _ in M.STEPS]
    assert "2026_11_29_ensure_fsb_demo_operator" in ids and ids.index("2026_11_30_ensure_fsb_demo_account") > ids.index("2026_11_29_ensure_fsb_demo_operator")


async def test_the_demo_has_no_free_credits_so_every_app_stays_locked_until_it_buys(db, anon):
    await run_step()
    assert await D.ensure_demo_data() is True
    from app.services import credits as K

    with org_scope("org_fsb_demo"):
        from app.database import AsyncSessionLocal

        async with AsyncSessionLocal() as s:
            assert {w: await K.wallet_balance(s, w) for w in K.WALLETS} == {"voice": 0, "leadgen": 0, "scheduler": 0}
    token = (await anon.post("/api/auth/login", json=LOGIN)).json()["access_token"]
    got = await anon.get("/api/billing/access", headers={"Authorization": f"Bearer {token}"})
    assert got.status_code == 200 and got.json()["has_active_plan"] == {"voice": False, "leadgen": False, "scheduler": False}
    assert (await db.execute(text("SELECT hide_credits FROM brands WHERE name = :n"), {"n": D.BRAND_NAME})).scalar() is False


async def test_the_old_free_starter_credits_are_taken_back_and_the_balance_is_shown(db):
    from app.database import engine
    from app.services import credits as K

    await run_step()
    await db.execute(text("UPDATE brands SET hide_credits = TRUE WHERE name = :n"), {"n": D.BRAND_NAME})
    await db.commit()
    with org_scope("org_fsb_demo"):
        from app.database import AsyncSessionLocal

        async with AsyncSessionLocal() as s:
            for w in K.WALLETS:
                await K.add_credits(s, w, 5000, source="grant", note="old", by="Demo setup", ref=D.STARTER_REF)
            await s.commit()
    async with engine.begin() as conn:
        await M._fsb_no_free_credits(conn)
    with org_scope("org_fsb_demo"):
        async with AsyncSessionLocal() as s:
            assert {w: await K.wallet_balance(s, w) for w in K.WALLETS} == {"voice": 0, "leadgen": 0, "scheduler": 0}
    assert (await db.execute(text("SELECT hide_credits FROM brands WHERE name = :n"), {"n": D.BRAND_NAME})).scalar() is False


async def test_the_data_step_does_nothing_when_the_org_does_not_exist(db):
    assert await D.ensure_demo_data() is False


# ---- the brand policy is applied to the demo organisation's searches -------------------------
def _rec(n, name, reg, postcode="BN1 1AA", status="Active", category="Private limited Company", sic="|43220|"):
    return B(id=f"b{n}", identity_hash=f"h{n}", name=name, registration_number=reg, postcode=postcode, status=status, company_category=category,
             sic_codes=sic, sic_text="x", sources=[], rank_score=0, region="Hove", industry="Plumbing")


async def _names(db, filters, org):
    with org_scope(org):
        out = await BR.search_filtered(db, filters, limit=50, stats=False, broaden=False)
        names = sorted(r.name for r in out["rows"])
        await db.rollback()
    return names


async def test_the_fsb_policy_applies_to_the_demo_org_end_to_end_and_to_nobody_else(db):
    db.add_all([_rec(1, "Acme Plumbing Ltd", "01234567"), _rec(2, "Hope Charity Ltd", "01234568", postcode="BN1 2AB"),
                _rec(3, "Hove Primary School Ltd", "01234569", postcode="BN3 3AA"), _rec(4, "Leeds Plumbing Ltd", "01234573", postcode="LS1 1AA"),
                _rec(5, "Worthing Joinery Ltd", "01234574", postcode="BN11 1AA"), _rec(6, "Lewes Roofing Ltd", "01234575", postcode="BN7 1AA"),
                _rec(7, "Gone Ltd", "01234576", status="Dissolved")])
    await db.execute(text("INSERT INTO organizations (id, name, slug, status) VALUES ('org_plain', 'Plain', 'plain', 'active')"))
    await db.commit()
    await run_step()
    await run_seed()
    TP.invalidate()
    wide = {"postcode_prefixes": ["BN", "LS"], "status": "any"}
    demo = await _names(db, wide, "org_fsb_demo")
    assert demo == ["Acme Plumbing Ltd", "Leeds Plumbing Ltd", "Lewes Roofing Ltd", "Worthing Joinery Ltd"]  # ordinary companies in every postcode; the charity and school are out
    assert await _names(db, {"postcode_prefixes": ["BN1"], "status": "any"}, "org_fsb_demo") == ["Acme Plumbing Ltd"]  # the BN1 charity is not there
    assert await _names(db, {"postcode_prefixes": ["BN3"], "status": "any"}, "org_fsb_demo") == []  # nor the BN3 school
    assert await _names(db, {**wide, "legal_form": "sole"}, "org_fsb_demo") == []  # no filter lifts the organisation's rules
    plain = await _names(db, wide, "org_plain")
    assert {"Hope Charity Ltd", "Hove Primary School Ltd", "Leeds Plumbing Ltd", "Gone Ltd"} <= set(plain) and len(plain) == 7
    with org_scope("org_fsb_demo"):
        pol = await TP.effective(db, "org_fsb_demo")
        assert not pol.is_empty and pol.geo_districts == [] and pol.block_unscreened and pol.restricted("google")
        assert (await TP.effective(db, "org_plain")).is_empty


async def run_geo_step():
    from app.database import engine

    async with engine.begin() as conn:
        await M._fsb_all_postcodes(conn)


async def test_an_older_bn_only_lock_is_cleared_but_a_lock_staff_chose_is_left_alone(db):
    import json

    await run_step()
    old = json.dumps({**TP.clean_policy(D.DEMO_POLICY), "geo": {"districts": D.BN_DISTRICTS}})
    await db.execute(text("UPDATE brands SET policy = CAST(:p AS JSON) WHERE name = 'FSB'"), {"p": old})
    await db.commit()
    await run_geo_step()
    assert (await db.execute(text("SELECT policy FROM brands WHERE name = 'FSB'"))).scalar()["geo"]["districts"] == []
    mine = json.dumps({**TP.clean_policy(D.DEMO_POLICY), "geo": {"districts": ["LS1"]}})
    await db.execute(text("UPDATE brands SET policy = CAST(:p AS JSON) WHERE name = 'FSB'"), {"p": mine})
    await db.commit()
    await run_geo_step()
    assert (await db.execute(text("SELECT policy FROM brands WHERE name = 'FSB'"))).scalar()["geo"]["districts"] == ["LS1"]
