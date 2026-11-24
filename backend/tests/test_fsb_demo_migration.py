"""The FSB organisation: no code makes it or its logins any more; on a database that holds it, it becomes FSB's real company with its users,
data and credits untouched; the FSB brand's rules still apply to it end to end, and the older data steps (postcode lock, starter credits) still work."""
import json

import pytest
from sqlalchemy import text

from app.core import migrations as M
from app.core.tenancy import org_scope
from app.models.models import BusinessRecord as B
from app.services import business_records as BR
from app.services import fsb_demo as D
from app.services import tenant_policy as TP

pytestmark = pytest.mark.db


@pytest.fixture(autouse=True)
def fresh_rules():
    TP.invalidate()
    yield
    TP.invalidate()


async def fsb_org(db, name=D.DEMO_NAME, slug=D.DEMO_SLUG, policy=None):
    """The FSB organisation and brand as an older version left them, with its two users and a company profile."""
    from app.core.security import hash_password

    await db.execute(text("INSERT INTO brands (id, name, display_name, logo_url, accent_color, theme, powered_by, hide_credits, status, policy, created_at, updated_at) "
                          "VALUES ('brd_fsb', 'FSB', 'Federation of Small Businesses', '', '', CAST('{}' AS JSON), TRUE, FALSE, 'active', CAST(:p AS JSON), "
                          "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"), {"p": json.dumps(TP.clean_policy(policy or D.FSB_BRAND_POLICY))})
    await db.execute(text("INSERT INTO organizations (id, name, slug, status, brand_id) VALUES (:i, :n, :s, 'active', 'brd_fsb')"), {"i": D.ORG_ID, "n": name, "s": slug})
    await db.execute(text("INSERT INTO operators (id, org_id, username, email, name, role, hashed_password, is_active) VALUES "
                          "('op_fsboutreach', :o, 'fsbadmin', 'fsbadmin@outreach.com', 'FSB Admin', 'Admin', :p, TRUE), "
                          "('op_fsbuser', :o, 'fsbuser', 'fsbuser@outreach.com', 'FSB User', 'FSB Operator', :p, TRUE)"),
                     {"o": D.ORG_ID, "p": hash_password("Their-own-pass-1")})
    await db.commit()
    with org_scope(D.ORG_ID):
        await db.execute(text("INSERT INTO company_profile (id, org_id, name, website, social, pitch, industry) VALUES ('default', :o, :n, '', '', '', '')"),
                         {"o": D.ORG_ID, "n": name})
        await db.commit()


async def run(step):
    from app.database import engine

    async with engine.begin() as conn:
        await step(conn)
        await conn.execute(text("SELECT 1"))  # the startup transaction is still usable afterwards


async def users(db):
    return [tuple(r) for r in (await db.execute(text("SELECT id, org_id, username, email, role, hashed_password, is_active FROM operators ORDER BY id"))).all()]


async def profile_name(db):
    await db.rollback()  # a new transaction, so the organisation scope applies to it
    with org_scope(D.ORG_ID):
        name = (await db.execute(text("SELECT name FROM company_profile WHERE org_id = :o"), {"o": D.ORG_ID})).scalar()
        await db.rollback()
    return name


# ---- no code makes the organisation or its logins -------------------------------------------------------
async def test_a_fresh_database_gets_no_fsb_organisation_brand_or_login(db):
    await run(M._ensure_fsb_demo_account)
    await run(M._ensure_fsb_demo_operator)
    await run(M._fsb_becomes_real_company)
    assert (await db.execute(text("SELECT count(*) FROM organizations WHERE id <> 'org_default'"))).scalar() == 0
    assert (await db.execute(text("SELECT count(*) FROM brands"))).scalar() == 0
    assert (await db.execute(text("SELECT count(*) FROM operators"))).scalar() == 0


def test_no_password_or_login_making_code_is_left():
    for name in ("DEFAULT_PASSWORD", "DEFAULT_USER_PASSWORD", "ensure_demo_account", "ensure_demo_data", "demo_password", "user_password"):
        assert not hasattr(D, name), name
    ids = [i for i, _ in M.STEPS]
    assert len(ids) == len(set(ids))
    assert ids.index("2026_12_05_fsb_becomes_real_company") > ids.index("2026_12_01_fsb_demo_admin_rename_and_user")


# ---- the demo becomes FSB's real company ----------------------------------------------------------------
async def test_the_demo_organisation_becomes_the_real_company_and_its_users_stay_as_they_are(db):
    await fsb_org(db)
    before = await users(db)
    await run(M._fsb_becomes_real_company)
    org = (await db.execute(text("SELECT name, slug, brand_id, status FROM organizations WHERE id = :i"), {"i": D.ORG_ID})).first()
    assert tuple(org) == (D.REAL_NAME, D.REAL_SLUG, "brd_fsb", "active")
    assert await profile_name(db) == D.REAL_NAME
    assert await users(db) == before  # same ids, organisation, usernames, e-mails, roles, passwords and status


async def test_running_it_again_changes_nothing(db):
    await fsb_org(db)
    from app.database import engine

    async with engine.begin() as conn:
        first = await D.become_real_company(conn)
    async with engine.begin() as conn:
        second = await D.become_real_company(conn)
    assert first == {"name": True, "slug": True, "profile": True} and second == {"name": False, "slug": False, "profile": False}


async def test_a_name_or_slug_someone_chose_is_kept(db):
    await fsb_org(db, name="FSB Brighton", slug="fsb-brighton")
    await db.execute(text("INSERT INTO organizations (id, name, slug, status) VALUES ('org_other', 'Other', 'fsb', 'active')"))
    await db.commit()
    await run(M._fsb_becomes_real_company)
    assert tuple((await db.execute(text("SELECT name, slug FROM organizations WHERE id = :i"), {"i": D.ORG_ID})).first()) == ("FSB Brighton", "fsb-brighton")
    assert await profile_name(db) == "FSB Brighton"


async def test_the_slug_stays_when_another_organisation_holds_fsb(db):
    await fsb_org(db)
    await db.execute(text("INSERT INTO organizations (id, name, slug, status) VALUES ('org_other', 'Other', 'fsb', 'active')"))
    await db.commit()
    await run(M._fsb_becomes_real_company)
    assert tuple((await db.execute(text("SELECT name, slug FROM organizations WHERE id = :i"), {"i": D.ORG_ID})).first()) == (D.REAL_NAME, D.DEMO_SLUG)


async def test_a_failure_in_the_step_is_skipped_and_does_not_abort_the_startup_transaction(db, monkeypatch):
    from app.database import engine

    async def broken(conn):
        await conn.execute(text("SELECT * FROM table_that_does_not_exist"))

    monkeypatch.setattr(D, "become_real_company", broken)
    async with engine.begin() as conn:
        await M._fsb_becomes_real_company(conn)  # logs a warning and carries on
        assert (await conn.execute(text("SELECT 1"))).scalar() == 1


# ---- FSB's people keep signing in, and nobody is exempt from the lockout -------------------------------
async def test_the_fsb_users_still_sign_in_with_their_own_password_after_the_move(db, anon):
    await fsb_org(db)
    await run(M._fsb_becomes_real_company)
    for name in ("fsbadmin", "fsbuser"):
        got = await anon.post("/api/auth/login", json={"username": name, "password": "Their-own-pass-1"})
        assert got.status_code == 200, got.text
        from app.core.security import decode_token

        assert decode_token(got.json()["access_token"], "access").get("org") == D.ORG_ID


async def test_fsbadmin_is_locked_out_after_too_many_wrong_passwords_like_everyone_else(db, anon):
    from app.api import auth as A

    A._FAILS.clear()
    await fsb_org(db)
    codes = [(await anon.post("/api/auth/login", json={"username": "fsbadmin", "password": f"wrong-{i}"})).status_code for i in range(12)]
    assert 429 in codes, codes
    assert (await anon.post("/api/auth/login", json={"username": "fsbadmin", "password": "Their-own-pass-1"})).status_code == 429
    A._FAILS.clear()


# ---- the FSB brand's rules still apply end to end, and to nobody else -----------------------------------
def _rec(n, name, reg, postcode="BN1 1AA", status="Active", category="Private limited Company", sic="|43220|"):
    return B(id=f"b{n}", identity_hash=f"h{n}", name=name, registration_number=reg, postcode=postcode, status=status, company_category=category,
             sic_codes=sic, sic_text="x", sources=[], rank_score=0, region="Hove", industry="Plumbing")


async def _names(db, filters, org):
    with org_scope(org):
        out = await BR.search_filtered(db, filters, limit=50, stats=False, broaden=False)
        names = sorted(r.name for r in out["rows"])
        await db.rollback()
    return names


async def test_the_fsb_rules_apply_to_the_fsb_company_end_to_end_and_to_nobody_else(db):
    db.add_all([_rec(1, "Acme Plumbing Ltd", "01234567"), _rec(2, "Hope Charity Ltd", "01234568", postcode="BN1 2AB"),
                _rec(3, "Hove Primary School Ltd", "01234569", postcode="BN3 3AA"), _rec(4, "Leeds Plumbing Ltd", "01234573", postcode="LS1 1AA"),
                _rec(5, "Worthing Joinery Ltd", "01234574", postcode="BN11 1AA"), _rec(6, "Lewes Roofing Ltd", "01234575", postcode="BN7 1AA"),
                _rec(7, "Gone Ltd", "01234576", status="Dissolved")])
    await db.execute(text("INSERT INTO organizations (id, name, slug, status) VALUES ('org_plain', 'Plain', 'plain', 'active')"))
    await db.commit()
    await fsb_org(db)
    await run(M._fsb_becomes_real_company)
    TP.invalidate()
    wide = {"postcode_prefixes": ["BN", "LS"], "status": "any"}
    fsb = await _names(db, wide, D.ORG_ID)
    assert fsb == ["Acme Plumbing Ltd", "Leeds Plumbing Ltd", "Lewes Roofing Ltd", "Worthing Joinery Ltd"]  # the charity and the school are out
    assert await _names(db, {**wide, "fsb_exclusions": False}, D.ORG_ID) == fsb  # a client filter cannot switch it off
    plain = await _names(db, wide, "org_plain")
    assert {"Hope Charity Ltd", "Hove Primary School Ltd", "Leeds Plumbing Ltd", "Gone Ltd"} <= set(plain) and len(plain) == 7
    with org_scope(D.ORG_ID):
        pol = await TP.effective(db, D.ORG_ID)
        assert not pol.is_empty and pol.geo_districts == [] and pol.block_unscreened and pol.restricted("google")
        assert (await TP.effective(db, "org_plain")).is_empty


async def test_the_fsb_company_adds_its_own_rule_on_top_of_the_brand_s(db):
    db.add_all([_rec(1, "Acme Plumbing Ltd", "01234567"), _rec(4, "Leeds Plumbing Ltd", "01234573", postcode="LS1 1AA")])
    await db.commit()
    await fsb_org(db)
    await db.execute(text("UPDATE organizations SET policy = CAST(:p AS JSON) WHERE id = :i"), {"p": json.dumps({"geo": {"districts": ["BN1"]}}), "i": D.ORG_ID})
    await db.commit()
    TP.invalidate()
    with org_scope(D.ORG_ID):
        pol = await TP.org_effective(db, D.ORG_ID)
        await db.rollback()
    assert pol.geo_districts == ["BN1"] and pol.restricted("google") and pol.data["exclusions"]["fsb"]


# ---- the older data steps --------------------------------------------------------------------------------
async def test_an_older_bn_only_lock_is_cleared_but_a_lock_staff_chose_is_left_alone(db):
    await fsb_org(db, policy={**D.FSB_BRAND_POLICY, "geo": {"districts": D.BN_DISTRICTS}})
    await run(M._fsb_all_postcodes)
    assert (await db.execute(text("SELECT policy FROM brands WHERE name = 'FSB'"))).scalar()["geo"]["districts"] == []
    mine = json.dumps({**TP.clean_policy(D.FSB_BRAND_POLICY), "geo": {"districts": ["LS1"]}})
    await db.execute(text("UPDATE brands SET policy = CAST(:p AS JSON) WHERE name = 'FSB'"), {"p": mine})
    await db.commit()
    await run(M._fsb_all_postcodes)
    assert (await db.execute(text("SELECT policy FROM brands WHERE name = 'FSB'"))).scalar()["geo"]["districts"] == ["LS1"]


async def test_the_old_free_starter_credits_are_taken_back_and_the_balance_is_shown(db):
    from app.database import AsyncSessionLocal
    from app.services import credits as K

    await fsb_org(db)
    await db.execute(text("UPDATE brands SET hide_credits = TRUE WHERE name = :n"), {"n": D.BRAND_NAME})
    await db.commit()
    with org_scope(D.ORG_ID):
        async with AsyncSessionLocal() as s:
            for w in K.WALLETS:
                await K.add_credits(s, w, 5000, source="grant", note="old", by="Demo setup", ref=D.STARTER_REF)
            await s.commit()
    await run(M._fsb_no_free_credits)
    with org_scope(D.ORG_ID):
        async with AsyncSessionLocal() as s:
            assert {w: await K.wallet_balance(s, w) for w in K.WALLETS} == {"voice": 0, "leadgen": 0, "scheduler": 0}
    assert (await db.execute(text("SELECT hide_credits FROM brands WHERE name = :n"), {"n": D.BRAND_NAME})).scalar() is False
