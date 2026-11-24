"""A company's own rules on top of its brand's (services/tenant_policy.merge_policy) and the admin API that saves them (PUT /org/rules).

The company level can only add restrictions; the brand's area holds for the company's admins too; the rules are never skipped because a read
failed; and FSB's results do not change while it has no company rules of its own."""
import json

import httpx
import pytest
from sqlalchemy import text

from app.services import tenant_policy as TP

C = TP.clean_policy
FSB = {"exclusions": {"fsb": True, "extra": [], "locked": True}, "member_suppression": True, "geo": {"districts": []},
       "restricted_sources": {"google": True, "apollo": True, "search_engines": True}, "signin": {"password": True, "google": False, "microsoft": True},
       "screening": {"block_unscreened": True}}


def merged(brand, company):
    return TP.merge_policy(C(brand), C(company))


def sql(conds):
    from sqlalchemy.dialects import postgresql

    return " AND ".join(str(c.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})) for c in conds)


# ---- merge_policy: the company can only add ---------------------------------------------------------------
def test_a_company_cannot_relax_anything_its_brand_set():
    m = merged(FSB, {"exclusions": {"fsb": False, "locked": False}, "member_suppression": False,
                     "restricted_sources": {"google": False, "apollo": False, "search_engines": False},
                     "signin": {"password": True, "google": True, "microsoft": True}, "screening": {"block_unscreened": False}})
    assert m["exclusions"]["fsb"] and m["exclusions"]["locked"] and m["member_suppression"]
    assert m["restricted_sources"] == {"google": True, "apollo": True, "search_engines": True}
    assert m["signin"] == {"password": True, "google": False, "microsoft": True} and m["screening"]["block_unscreened"]


def test_a_company_adds_its_own_restrictions_to_the_brand_s():
    m = merged({"exclusions": {"extra": ["school"]}, "restricted_sources": {"google": True}},
               {"exclusions": {"extra": ["charity", "school"]}, "restricted_sources": {"apollo": True}, "signin": {"password": False},
                "screening": {"block_unscreened": True}, "member_suppression": True})
    assert m["exclusions"]["extra"] == ["school", "charity"]
    assert m["restricted_sources"] == {"google": True, "apollo": True, "search_engines": False}
    assert m["signin"] == {"password": False, "google": True, "microsoft": True}
    assert m["screening"]["block_unscreened"] and m["member_suppression"]


def test_a_company_without_a_brand_has_its_own_rules():
    pol = TP.Policy("org_c", "", merged=merged({}, {"restricted_sources": {"google": True}, "exclusions": {"extra": ["school"]}}))
    assert pol.restricted("google") and not pol.restricted("apollo") and not pol.is_empty and "school" in sql(pol.conditions()).lower()


def test_a_brand_default_filter_is_not_turned_into_an_enforced_one_by_the_company_s_empty_rules():
    m = merged({"exclusions": {"extra": ["school"], "locked": False}}, {})
    assert m["exclusions"]["locked"] is False and TP.Policy("o", "", merged=m).conditions() == []


def test_an_enforced_brand_list_and_a_company_default_filter_are_both_enforced_stricter_never_looser():
    m = merged({"exclusions": {"fsb": True, "locked": True}}, {"exclusions": {"extra": ["charity"], "locked": False}})
    assert m["exclusions"]["locked"] is True and m["exclusions"]["fsb"] and m["exclusions"]["extra"] == ["charity"]


def test_no_sign_in_method_left_falls_back_to_the_brand_s_methods():
    m = merged({"signin": {"password": False, "google": True, "microsoft": True}}, {"signin": {"google": False, "microsoft": False}})
    assert m["signin"] == {"password": False, "google": True, "microsoft": True}


# ---- territory ---------------------------------------------------------------------------------------------
def test_the_company_area_only_counts_inside_the_brand_area():
    m = merged({"geo": {"districts": ["BN1", "BN2"]}}, {"geo": {"districts": ["BN2", "LS1"]}})
    assert m["geo"] == {"districts": ["BN2"], "locked": ["BN1", "BN2"], "none": False}


def test_areas_that_do_not_meet_show_nothing_rather_than_everything():
    pol = TP.Policy("o", "b", merged=merged({"geo": {"districts": ["BN1"]}}, {"geo": {"districts": ["LS1"]}}))
    assert pol.geo_none and not pol.is_empty and sql(pol.geo_conditions()) == "false"
    assert pol.hash() and pol.cache_key()


def test_an_admin_lift_drops_the_company_area_but_keeps_the_brand_area():
    pol = TP.Policy("o", "b", merged=merged({"geo": {"districts": ["BN1", "BN2"]}}, {"geo": {"districts": ["BN2"]}}))
    assert "BN2" in sql(pol.geo_conditions()) and "BN1" not in sql(pol.geo_conditions())
    admin = pol.for_user([], lift_geo=True)
    assert admin.geo_districts == [] and admin.locked_districts == ["BN1", "BN2"]
    assert "BN1" in sql(admin.geo_conditions()) and "BN2" in sql(admin.geo_conditions())
    person = pol.for_user(["BN1"], lift_geo=True)  # a person's own areas, still inside the brand's area
    assert person.user_conditions() and person.geo_conditions()
    assert pol.data["geo"]["districts"] == ["BN2"]  # the shared copy is never changed


def test_a_company_area_without_a_brand_area_is_lifted_for_its_admins_as_before():
    pol = TP.Policy("o", "", merged=merged({}, {"geo": {"districts": ["LS1"]}}))
    assert pol.geo_conditions() and pol.for_user([], lift_geo=True).geo_conditions() == []


# ---- FSB sees no change ------------------------------------------------------------------------------------
def test_fsb_with_no_company_rules_gets_exactly_its_brand_rules():
    old = TP.Policy("org_fsb_demo", "brd_fsb", FSB)
    new = TP.Policy("org_fsb_demo", "brd_fsb", merged=merged(FSB, None))
    assert {k: v for k, v in new.data.items() if k != "geo"} == {k: v for k, v in old.data.items() if k != "geo"}
    assert new.geo_districts == old.geo_districts == [] and new.locked_districts == [] and not new.geo_none
    assert new.hash() == old.hash() and new.cache_key() == old.cache_key()
    assert sql(new.conditions()) == sql(old.conditions())


def test_an_organisation_with_no_rules_at_all_stays_empty():
    pol = TP.Policy("o", "", merged=merged({}, {}))
    assert pol.is_empty and pol.hash() == "" and pol.conditions() == []


# ---- what a company may save ------------------------------------------------------------------------------------
def test_areas_outside_the_brand_s_are_refused_with_the_districts_named():
    problems = TP.company_policy_problems(C({"geo": {"districts": ["BN1"]}}), C({"geo": {"districts": ["BN1", "LS1", "LS2"]}}))
    assert len(problems) == 1 and "LS1, LS2" in problems[0]
    assert TP.company_policy_problems(C({}), C({"geo": {"districts": ["LS1"]}})) == []  # no brand area: any area


def test_switching_off_every_sign_in_method_is_refused():
    problems = TP.company_policy_problems(C({"signin": {"google": False}}), C({"signin": {"password": False, "microsoft": False}}))
    assert problems == ["Keep at least one sign-in method on, or nobody can sign in."]


# ---- the rules are never skipped because a read failed -------------------------------------------------------------
async def test_a_failed_read_with_nothing_remembered_refuses_instead_of_answering_without_rules(monkeypatch):
    async def broken(db, org_id):
        raise RuntimeError("database away")

    TP.invalidate()
    monkeypatch.setattr(TP, "_load", broken)
    with pytest.raises(TP.PolicyUnavailable):
        await TP.org_effective(object(), "org_x")
    assert await TP.source_allowed("org_x", "google", db=_NoNest()) is False  # a source is never used on a guess


async def test_a_failed_read_uses_the_last_known_rules(monkeypatch):
    TP.invalidate()
    known = TP.Policy("org_y", "b", FSB)
    TP._CACHE["org_y"] = (0.0, known)  # remembered long ago: out of date, but more rules than none

    async def broken(db, org_id):
        raise RuntimeError("database away")

    monkeypatch.setattr(TP, "_load", broken)
    assert await TP.org_effective(_NoNest(), "org_y") is known
    TP.invalidate()


class _NoNest:
    """A stand-in session: begin_nested() works, nothing else is used because _load is replaced."""

    def begin_nested(self):
        class _Ctx:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

        return _Ctx()


# ---- PUT /org/rules (database) --------------------------------------------------------------------------------------
async def audit_rows(db, org):
    from app.core.tenancy import org_scope

    await db.rollback()
    with org_scope(org):
        rows = (await db.execute(text("SELECT action, target, detail FROM audit_log WHERE action = 'policy.changed'"))).all()
        await db.rollback()
    return rows


@pytest.mark.db
async def test_a_company_admin_saves_rules_that_apply_at_once_and_are_audited(db):
    from app.main import app
    from tests.conftest import make_user

    _op, token = await make_user(db, "boss", role="Admin", org_id="org_acme")
    _op2, user_token = await make_user(db, "rep", role="Operator", org_id="org_acme")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"}) as c:
        got = await c.get("/api/org/rules")
        assert got.status_code == 200 and got.json()["brand"] is None and got.json()["summary"]["restrictedSources"] == []
        saved = await c.put("/api/org/rules", json={"restricted_sources": {"google": True}, "member_suppression": True})
        assert saved.status_code == 200, saved.text
        assert saved.json()["company"]["restricted_sources"]["google"] is True and saved.json()["summary"]["memberSuppression"] is True
        assert (await c.get("/api/org/policy")).json()["restrictedSources"] == ["google"]  # seen at once, not after the cache runs out
        assert (await c.get("/api/org/member-suppression")).status_code == 200  # the member list now opens for this company
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {user_token}"}) as c:
        assert (await c.get("/api/org/rules")).status_code == 403
        assert (await c.put("/api/org/rules", json={})).status_code == 403
    rows = await audit_rows(db, "org_acme")
    assert len(rows) == 1 and rows[0][1] == "org:org_acme"
    detail = rows[0][2] if isinstance(rows[0][2], dict) else json.loads(rows[0][2])
    assert detail["level"] == "company" and detail["after"]["restricted_sources"]["google"] is True and detail["before"]["restricted_sources"]["google"] is False


@pytest.mark.db
async def test_a_company_under_a_brand_cannot_unlock_the_brand_s_rules_or_leave_its_area(db):
    from app.main import app
    from tests.conftest import make_user

    await db.execute(text("INSERT INTO brands (id, name, display_name, logo_url, accent_color, theme, powered_by, hide_credits, status, policy, created_at, updated_at) "
                          "VALUES ('brd_x', 'X', 'Brand X', '', '', CAST('{}' AS JSON), TRUE, FALSE, 'active', CAST(:p AS JSON), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"),
                     {"p": json.dumps(C({**FSB, "geo": {"districts": ["BN1", "BN2"]}}))})
    await db.commit()
    _op, token = await make_user(db, "boss2", role="Admin", org_id="org_member")
    await db.execute(text("UPDATE organizations SET brand_id = 'brd_x' WHERE id = 'org_member'"))
    await db.commit()
    TP.invalidate()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"}) as c:
        outside = await c.put("/api/org/rules", json={"geo": {"districts": ["BN1", "LS1"]}})
        assert outside.status_code == 400 and outside.json()["detail"]["code"] == "rules_conflict" and "LS1" in outside.json()["detail"]["message"]
        relax = await c.put("/api/org/rules", json={"restricted_sources": {"google": False}, "exclusions": {"fsb": False}, "geo": {"districts": ["BN2"]}})
        assert relax.status_code == 200, relax.text
        body = relax.json()
        assert body["brandName"] == "Brand X" and body["combined"]["restricted_sources"]["google"] is True and body["combined"]["exclusions"]["fsb"] is True
        assert body["combined"]["geo"] == {"districts": ["BN2"], "locked": ["BN1", "BN2"], "none": False}
    assert len(await audit_rows(db, "org_member")) == 1  # the refused save left no row
