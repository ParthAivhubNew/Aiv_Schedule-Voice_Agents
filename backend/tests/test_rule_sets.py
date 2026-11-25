"""Plan 12, step 3 and F1: exclusion rule sets as data, a preview of what the rules hide, and the company's own rules."""
import hashlib
import json

import pytest
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from app.services import exclusion_rules as ER
from app.services import fsb_rules as FR
from app.services import tenant_policy as TP


def _sql(conds):
    return [str(c.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})) for c in conds]


def test_the_old_fsb_flag_and_the_rule_set_are_the_same_thing():
    assert TP.clean_policy({"exclusions": {"fsb": True}})["exclusions"]["sets"] == ["standard_b2b"]
    on = TP.clean_policy({"exclusions": {"sets": ["standard_b2b", "made_up"]}})["exclusions"]
    assert on["sets"] == ["standard_b2b"] and on["fsb"] is True
    assert TP.clean_policy({})["exclusions"]["sets"] == [] and TP.clean_policy({})["exclusions"]["fsb"] is False
    merged = TP.merge_policy(TP.clean_policy({"exclusions": {"fsb": True}}), TP.clean_policy({}))
    assert merged["exclusions"]["sets"] == ["standard_b2b"] and merged["exclusions"]["fsb"] is True


def test_fsb_searches_dont_change():
    pol = TP.Policy("org_x", "brd_fsb", merged=TP.merge_policy(TP.clean_policy({"exclusions": {"fsb": True}}), TP.clean_policy({})))
    assert _sql(pol.exclusion_conditions()) == _sql([FR.status_condition()] + FR.conditions(False))
    # the cache key is worked out exactly as before the rule sets existed
    basis = {"fsb": True, "extra": [], "geo": [], "members": False, "gen": list(pol.gen), "user": []}
    assert pol.hash() == hashlib.sha1(json.dumps(basis, sort_keys=True).encode()).hexdigest()[:12]
    assert ER.catalogue()[0]["id"] == "standard_b2b" and ER.catalogue()[0]["sicCodes"] == 53


async def _companies(db):
    from app.models.models import BusinessRecord as B

    row = dict(status="Active", company_category="Private Limited Company", sic_codes="|43220|", sources=[])
    db.add_all([B(id="r1", identity_hash="r1", name="Acme Plumbing Ltd", registration_number="01234561", postcode="BN1 1AA", **row),
                B(id="r2", identity_hash="r2", name="St Mary Church Ltd", registration_number="01234562", postcode="BN1 2AA", **row),
                B(id="r3", identity_hash="r3", name="Old Co Ltd", registration_number="01234563", postcode="BN1 3AA", **{**row, "status": "Dissolved"}),
                B(id="r4", identity_hash="r4", name="Brighton Builders Ltd", registration_number="01234564", postcode="BN1 4AA", **row),
                B(id="r5", identity_hash="r5", name="Far Away Ltd", registration_number="01234565", postcode="BN2 1AA", **row)])
    await db.commit()


async def test_the_preview_says_how_many_the_draft_rules_hide(db, client):
    await _companies(db)
    draft = {"geo": {"districts": ["BN1"]}, "exclusions": {"sets": ["standard_b2b"], "extra": ["01234564"], "locked": False}}
    got = (await client.post("/api/org/rules/preview", json=draft)).json()
    # BN1 holds four; the church name, the dissolved one and the typed company number are hidden (counted as enforced, even as a starting filter)
    assert got == {"tooBig": False, "total": 4, "kept": 1, "hidden": 3, "inArea": True}
    everywhere = (await client.post("/api/org/rules/preview", json={})).json()
    assert everywhere["total"] == 5 and everywhere["hidden"] == 0 and everywhere["inArea"] is False
    rules = (await client.get("/api/org/rules")).json()
    assert rules["company"]["exclusions"]["sets"] == []  # a preview saves nothing


async def test_only_admins_preview_or_change_the_rules(db):
    import httpx

    from app.main import app
    from tests.conftest import make_user

    _, token = await make_user(db, "worker", "Operator")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"}) as c:
        assert (await c.post("/api/org/rules/preview", json={})).status_code == 403
        assert (await c.put("/api/org/rules", json={})).status_code == 403
        assert (await c.get("/api/org/rule-sets")).json()["sets"][0]["label"] == "Standard B2B exclusions"


async def test_a_company_switches_a_rule_set_on_and_it_is_enforced(db, client):
    await _companies(db)
    saved = await client.put("/api/org/rules", json={"exclusions": {"sets": ["standard_b2b"], "locked": True}})
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["company"]["exclusions"]["sets"] == ["standard_b2b"] and body["summary"]["ruleSets"] == ["standard_b2b"]
    TP.invalidate()
    try:
        pol = await TP.effective(None, "org_default")
        assert _sql(pol.exclusion_conditions()) == _sql([FR.status_condition()] + FR.conditions(False))
    finally:
        await client.put("/api/org/rules", json={})
        TP.invalidate()
