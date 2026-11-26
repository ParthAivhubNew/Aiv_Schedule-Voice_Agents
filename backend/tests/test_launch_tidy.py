"""Plan 11 step 7 (launch tidy-up): the production config check, the /records routes and the FSB badge as a brand setting."""
import json

import pytest
from sqlalchemy import text

from app.services import config_check as CFG

GOOD = {"SECRET_KEY": "x" * 40, "STRIPE_SECRET_KEY": "sk_live_abc", "STRIPE_PUBLISHABLE_KEY": "pk_live_abc", "STRIPE_WEBHOOK_SECRET": "whsec_abc",
        "STAFF_ADMIN_EMAIL": "ops@example.test", "FRONTEND_URL": "https://outreach.example.test"}


def _codes(env):
    return {p["code"]: p["level"] for p in CFG.problems(env)}


def test_a_ready_server_has_nothing_to_fix():
    assert CFG.problems(GOOD) == []


def test_each_launch_blocker_is_found_and_no_value_is_shown():
    found = _codes({**GOOD, "SECRET_KEY": "changeme", "STRIPE_SECRET_KEY": "sk_test_1", "CORS_ORIGINS": "https://a.test, *"})
    assert found == {"secret_key": "block", "stripe_test": "block", "stripe_mixed": "block", "cors_open": "block"}
    assert _codes({**GOOD, "STRIPE_WEBHOOK_SECRET": ""}) == {"stripe_webhook": "block"}
    assert _codes({**GOOD, "TEST_COPY": "true", "APP_ENV": "production"}) == {"test_copy": "block"}
    text_ = json.dumps(CFG.problems({**GOOD, "SECRET_KEY": "short", "STRIPE_SECRET_KEY": "sk_test_secretvalue"}))
    assert "sk_test_secretvalue" not in text_ and "short" not in text_.replace("too short", "")


def test_warnings_dont_block():
    assert _codes({**GOOD, "EXPOSE_API_DOCS": "true", "STAFF_ADMIN_EMAIL": "", "FRONTEND_URL": "http://localhost:5173"}) == {
        "api_docs": "warn", "staff_email": "warn", "frontend_url_plain": "warn"}


async def test_only_a_production_server_refuses_to_start(db):
    bad = {**GOOD, "STRIPE_SECRET_KEY": "sk_test_1", "STRIPE_PUBLISHABLE_KEY": "pk_test_1"}
    found = await CFG.at_startup(bad)  # not said to be production: logged and sent to staff, start-up carries on
    assert [p["code"] for p in found] == ["stripe_test"]
    with pytest.raises(CFG.ConfigRefused, match="Stripe is in test mode"):
        await CFG.at_startup({**bad, "APP_ENV": "production"})
    assert await CFG.at_startup({**GOOD, "APP_ENV": "production"}) == []


async def test_staff_see_the_config_check(staff):
    body = (await staff.get("/api/admin-api/config-check")).json()
    assert set(body) == {"production", "problems"} and all(set(p) == {"code", "level", "text"} for p in body["problems"])


async def test_the_record_matching_routes_are_also_at_records(client):
    old = await client.get("/api/fsb/settings")
    new = await client.get("/api/records/settings")
    assert new.status_code == old.status_code == 200 and new.json() == old.json()
    assert (await client.get("/api/records/imports")).status_code == 200


async def test_the_fsb_brand_gets_its_account_link_once(db):
    from app.core.migrations import _fsb_brand_account_link
    from app.database import engine

    async with engine.begin() as conn:
        await _fsb_brand_account_link(conn)  # no FSB brand: nothing to do, no error
    await db.execute(text("INSERT INTO brands (id, name, display_name, theme, status) VALUES ('brd_fsb', 'FSB', 'Federation of Small Businesses', "
                          "CAST('{\"x\": 1}' AS JSON), 'active')"))
    await db.commit()
    async with engine.begin() as conn:
        await _fsb_brand_account_link(conn)
        await conn.execute(text("UPDATE brands SET theme = CAST(:t AS JSON) WHERE id = 'brd_fsb'"),
                           {"t": json.dumps({"x": 1, "accountLink": {"url": "https://changed.example/", "label": "Changed"}})})
        await _fsb_brand_account_link(conn)  # a link staff changed is left alone
    theme = (await db.execute(text("SELECT theme FROM brands WHERE id = 'brd_fsb'"))).scalar()
    assert theme == {"x": 1, "accountLink": {"url": "https://changed.example/", "label": "Changed"}}


async def test_a_new_brand_link_shows_on_the_signed_in_look(db, client):
    from app.core.migrations import _fsb_brand_account_link
    from app.database import engine

    await db.execute(text("INSERT INTO brands (id, name, display_name, theme, status) VALUES ('brd_fsb', 'FSB', 'Federation of Small Businesses', "
                          "CAST('{}' AS JSON), 'active')"))
    await db.execute(text("UPDATE organizations SET brand_id = 'brd_fsb' WHERE id = 'org_default'"))
    await db.commit()
    async with engine.begin() as conn:
        await _fsb_brand_account_link(conn)
    look = (await client.get("/api/me/brand")).json()
    assert look["theme"]["accountLink"] == {"url": "https://account.fsb.org.uk/", "label": "Federation of Small Businesses"}


async def test_first_steps_follow_the_apps_the_company_has(client):
    ob = (await client.get("/api/auth/onboarding")).json()
    keys = [x["key"] for x in ob["steps"]]
    assert keys == ["company", "plan", "team", "search", "mailbox", "hours", "number", "call"]  # Leads and Voice plans
    assert next(x for x in ob["steps"] if x["key"] == "plan")["done"] is True
    assert all(x["go"].startswith(("#/", "team:")) for x in ob["steps"])


@pytest.mark.db
async def test_the_search_step_opens_on_a_sample_or_on_the_company_s_own_ideal_customers(client):
    from app.api.signup import SAMPLE_SEARCH

    step = next(x for x in (await client.get("/api/auth/onboarding")).json()["steps"] if x["key"] == "search")
    assert step["sample"] == {"filters": SAMPLE_SEARCH, "label": "Opens on a sample search: accountants and bookkeepers", "own": False}
    r = await client.put("/api/leads/icp", json={"sic_codes": ["56102"], "postcode_areas": ["BN1"], "size_bands": ["micro"]})
    assert r.status_code == 200, r.text
    step = next(x for x in (await client.get("/api/auth/onboarding")).json()["steps"] if x["key"] == "search")
    assert step["sample"]["own"] is True and step["sample"]["label"] == "Opens on a search for the customers you described"
    assert step["sample"]["filters"]["sic_codes"] == ["56102"] and step["sample"]["filters"]["size_bands"] == ["micro"]
