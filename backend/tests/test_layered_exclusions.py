"""The two kinds of exclusion side by side (merge of main's organisation rows into the company rules): the brand's and company's rule sets
and extra items (Brand.policy / Organization.policy) plus each organisation's own rows (org_exclusion_rules). Both apply; neither replaces
the other. Also: a company's old extra items move into its rows once, and an organisation's own provider key is used by the key pool."""
import json

import pytest
from sqlalchemy import and_, select, text
from sqlalchemy.dialects import postgresql

from app.models.models import BusinessRecord as B
from app.services import exclusion_rules as ER
from app.services import fsb_rules as FR
from app.services import tenant_policy as TP


def sql(conds):
    return str(select(B.id).where(and_(*conds)).compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


ROW = {"kind": "sic", "value": "47110", "mode": "exclude"}
SET_ON = {"exclusions": {"sets": [ER.LEGACY], "locked": True}}


def test_rule_sets_and_organisation_rows_both_apply():
    both = TP.Policy("org_x", "brd_x", SET_ON, rules=[ROW])
    s = sql(both.exclusion_conditions())
    assert "47110" in s and "84110" in s and "btrim(business_records.status) = 'Active'" in s
    summary = both.summary()
    assert summary["standingExclusions"] and summary["ruleSets"] == [ER.LEGACY] and summary["exclusionRules"] == 1


def test_a_starting_filter_set_does_not_switch_the_organisation_rows_off():
    loose = TP.Policy("org_x", "brd_x", {"exclusions": {"sets": [ER.LEGACY], "locked": False}}, rules=[ROW])
    s = sql(loose.exclusion_conditions())
    assert "47110" in s and "84110" not in s  # the set is only a starting filter; the rows are always enforced
    assert loose.summary()["ruleSets"] == [] and loose.summary()["exclusionRules"] == 1


def test_the_hash_changes_with_the_rows_and_stays_the_same_without_them():
    plain = TP.Policy("org_x", "brd_x", SET_ON)
    with_row = TP.Policy("org_x", "brd_x", SET_ON, rules=[ROW])
    assert plain.hash() != with_row.hash() and with_row.with_rules([]).hash() == plain.hash()
    assert TP.Policy("org_y", rules=[ROW]).hash() and TP.Policy("org_y").hash() == ""


def test_seed_rows_say_what_the_rule_set_says():
    rows = FR.seed_rules()
    assert {r["value"] for r in rows if r["kind"] == "sic"} == set(FR.SIC)
    assert "charit*" in {r["value"] for r in rows if r["kind"] == "name_word"}  # the preset's regex wildcard, written the admin's way
    assert {r["value"] for r in rows if r["mode"] == "keep"} == {"driving school", "dance school"}


@pytest.mark.db
async def test_company_extra_items_move_into_the_organisation_rows_once(db):
    from app.core import migrations as M
    from app.database import engine

    await db.execute(text("UPDATE organizations SET policy = CAST(:p AS JSON) WHERE id = 'org_default'"),
                     {"p": json.dumps({"exclusions": {"sets": [ER.LEGACY], "extra": ["church", "BN9", "47110"], "locked": True}})})
    await db.commit()
    for _ in range(2):  # the second run changes nothing
        async with engine.begin() as conn:
            await M._company_extra_to_rules(conn)
    async with engine.begin() as conn:
        rows = (await conn.execute(text("SELECT kind, value, enabled FROM org_exclusion_rules WHERE org_id = 'org_default' ORDER BY kind, value"))).all()
        audit = (await conn.execute(text("SELECT detail FROM audit_log WHERE action = 'exclusions.moved_to_rules' AND org_id = 'org_default'"))).all()
    assert [(r[0], r[1]) for r in rows] == [("name_word", "church"), ("postcode", "BN9"), ("sic", "47110")] and all(r[2] for r in rows)
    assert len(audit) == 1 and audit[0][0]["removed_from_company_rules"] == ["church", "BN9", "47110"]
    policy = (await db.execute(text("SELECT policy FROM organizations WHERE id = 'org_default'"))).scalar()
    assert policy["exclusions"]["extra"] == [] and policy["exclusions"]["sets"] == [ER.LEGACY]  # the rule set stays in the company rules
    await db.execute(text("UPDATE organizations SET policy = NULL WHERE id = 'org_default'"))
    await db.commit()
    TP.invalidate()


async def test_saving_company_rules_keeps_no_extra_items(db, client):
    try:
        saved = await client.put("/api/org/rules", json={"exclusions": {"sets": [], "extra": ["church"], "locked": True}})
        assert saved.status_code == 200, saved.text
        assert saved.json()["company"]["exclusions"]["extra"] == []
    finally:
        await client.put("/api/org/rules", json={})
        TP.invalidate()


async def test_an_organisation_key_is_the_only_key_the_pool_uses(monkeypatch):
    from app.providers.keypool import KeyPool
    from app.services import enrichment_service as E

    async def main_key():
        return "platform-key-aaaa"

    async def own(word):
        return "own-key-bbbb" if word == "tavily" else ""

    async def allowed(*a, **k):
        return False  # a plan without the provider: the organisation's own key still works

    monkeypatch.setattr(E, "own_key", own)
    monkeypatch.setattr("app.services.plan_rules.provider_allowed", allowed)
    p = KeyPool(name="t", backups_doc="t", main_key=main_key, main_label="Tavily key", log_row=lambda *a, **k: None, plan_provider="tavily", own="tavily")
    assert await p.keys() == [("own", "Your Tavily key", "own-key-bbbb")]
    assert await p.keys(lead="caller-key") == []  # a caller holding its own key goes through the usual checks (here: not in plan)
    plain = KeyPool(name="t", backups_doc="t", main_key=main_key, main_label="Tavily key", log_row=lambda *a, **k: None, own="apollo")

    async def no_backups():
        return []

    plain.backups = no_backups
    assert await plain.keys() == [("main", "Tavily key", "platform-key-aaaa")]  # no key of its own: the platform's
