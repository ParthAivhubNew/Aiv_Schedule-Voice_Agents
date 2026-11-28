"""The organisation's own exclusion list: parsing what an admin types, the SQL it becomes, the admin-only API, the fail-closed read.
Unit tests need no database; the ones marked db run on TEST_DATABASE_URL."""
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import and_, select
from sqlalchemy.dialects import postgresql

from app.core.tenancy import org_scope
from app.models.models import BusinessRecord as B
from app.services import fsb_rules as FR
from app.services import org_rules as OR
from app.services import tenant_policy as TP


def sql(conds):
    return str(select(B.id).where(and_(*conds)).compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


@pytest.fixture(autouse=True)
def fresh_policy_cache():
    TP.invalidate()
    yield
    TP.invalidate()


def rule(kind, value="", mode="exclude"):
    return {"kind": kind, "value": value, "mode": mode}


# ---- parsing what an admin types -----------------------------------------------------------------
def test_typed_items_are_sorted_into_kinds():
    rules, bad = OR.parse_items(["85200", "47", "church", "Charity register", "active companies only", "Companies House only", "BN9", "sw1a",
                                 "1234567", "SC123456", "Places of Worship", "keep: driving school", "Private limited company", "charit*"])
    got = {(r["kind"], r["value"], r["mode"]) for r in rules}
    assert bad == []
    assert ("sic", "85200", "exclude") in got and ("sic", "47", "exclude") in got
    assert ("name_word", "church", "exclude") in got and ("name_word", "charit*", "exclude") in got
    assert ("charity_register", "", "exclude") in got and ("status_only", "", "exclude") in got and ("ch_number_only", "", "exclude") in got
    assert ("postcode", "BN9", "exclude") in got and ("postcode", "SW1A", "exclude") in got
    assert ("company_number", "01234567", "exclude") in got and ("company_number", "SC123456", "exclude") in got
    assert ("category", "Places of Worship", "exclude") in got
    assert ("name_word", "driving school", "keep") in got and ("company_type", "private limited company", "exclude") in got


def test_duplicates_collapse_and_bad_items_are_named():
    rules, bad = OR.parse_items(["church", "Church", " church ", "x", "<script>", "keep: 1"])
    assert [(r["value"], r["mode"]) for r in rules] == [("church", "exclude")]
    assert {b["item"] for b in bad} == {"x", "<script>", "keep: 1"} and all(b["reason"] for b in bad)


def test_values_are_validated_and_normalised():
    assert OR.clean_value("sic", " 85200 ") == "85200"
    assert OR.clean_value("company_number", "1234567") == "01234567"
    assert OR.clean_value("postcode", "bn1 4") == "BN1 4"
    assert OR.clean_value("charity_register", "ignored") == ""
    for kind, value in (("sic", "8"), ("sic", "abc"), ("postcode", "ZZZ"), ("company_number", "AB"), ("category", "Not a category"), ("name_word", "!!"),
                        ("name_word", "x" * 81), ("sic", ""), ("nope", "1")):
        with pytest.raises(ValueError):
            OR.clean_value(kind, value)
    with pytest.raises(ValueError):
        OR.clean_value("sic", "85200", "keep")  # only a word in the name can be a keep rule


# ---- the SQL ---------------------------------------------------------------------------------------
def test_no_rules_add_no_conditions():
    assert OR.conditions([]) == []
    assert TP.Policy("org_x").is_empty


def test_each_kind_becomes_its_condition():
    s = sql(OR.conditions([rule("sic", "85200"), rule("sic", "47"), rule("company_type", "registered society"), rule("name_word", "church"),
                           rule("name_word", "charit*"), rule("charity_register"), rule("status_only"), rule("ch_number_only"),
                           rule("postcode", "BN9"), rule("company_number", "01234567"), rule("category", "Places of Worship")]))
    assert "85200|47)[0-9]*" in s and "'registered society'" in s and "church" in s and "charit[a-z]*" in s
    assert "ds_charity_commission" in s and "btrim(business_records.status) = 'Active'" in s and "[A-Z0-9]{8}" in s
    assert "BN9" in s and "'01234567'" in s


def test_keep_rows_rescue_names_only_for_the_organisations_own_words():
    plain = sql(OR.conditions([rule("name_word", "school")]))
    kept = sql(OR.conditions([rule("name_word", "school"), rule("name_word", "driving school", "keep")]))
    assert "driving" not in plain and "driving" in kept
    off_only = OR.conditions([rule("name_word", "x1", "keep")])
    assert off_only == []  # a keep row with nothing to rescue changes nothing


def test_values_are_escaped_in_the_pattern():
    s = sql(OR.conditions([rule("name_word", "a.b")]))
    assert "(a\\.b)" in s.replace("\\\\", "\\")  # the dot is a literal dot, not "any character" (some SQLAlchemy versions double each backslash)


def test_the_hash_follows_the_rules_not_a_counter():
    a = TP.Policy("org_x", rules=[rule("sic", "85200")])
    b = TP.Policy("org_x", rules=[rule("sic", "85200")])
    c = TP.Policy("org_x", rules=[rule("sic", "85200"), rule("name_word", "church")])
    assert a.hash() == b.hash() != c.hash() and OR.signature([rule("sic", "1")]) == OR.signature([rule("sic", "1")])


def test_every_rule_has_a_plain_sentence():
    for kind, value in (("sic", "85200"), ("sic", "47"), ("company_type", "registered society"), ("name_word", "church"), ("name_word", "charit*"),
                        ("category", "Hospitals"), ("postcode", "BN9"), ("company_number", "01234567"), ("charity_register", ""),
                        ("status_only", ""), ("ch_number_only", "")):
        assert OR.meaning(kind, value).strip()
    assert "driving school" in OR.meaning("name_word", "driving school", "keep")


def test_the_seed_list_is_data_and_fits_the_cap():
    assert len(FR.seed_rules()) < OR.MAX_RULES
    assert all(r["enabled"] for r in FR.seed_rules()) and not any(r["enabled"] for r in FR.seed_rules(False))
    assert OR.parse_items([r["value"] for r in FR.seed_rules() if r["kind"] == "sic"])[1] == []


# ---- where a saved company is already in hand (exports, journeys) -------------------------------
class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeDb:
    def __init__(self, rows):
        self.rows, self.sql = rows, []

    async def execute(self, stmt):
        self.sql.append(str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})))
        return _Rows(self.rows)


async def test_a_saved_company_is_judged_by_the_same_rules_as_a_search(monkeypatch):
    pol = TP.Policy("org_x", rules=[rule("name_word", "church")])

    async def eff(db=None, org_id=None):
        return pol

    monkeypatch.setattr(TP, "org_effective", eff)
    db = _FakeDb([("b1",)])
    assert await OR.excluded_record_ids(db, ["b1", "b2", "b1", ""]) == {"b1"}
    assert "coalesce(" in db.sql[0] and "church" in db.sql[0] and "'b2'" in db.sql[0]  # a record a rule cannot judge counts as left out, as in a search


async def test_no_rules_or_no_ids_asks_nothing(monkeypatch):
    async def none(db=None, org_id=None):
        return TP.Policy("org_x")

    monkeypatch.setattr(TP, "org_effective", none)
    db = _FakeDb([("b1",)])
    assert await OR.excluded_record_ids(db, ["b1"]) == set() and await OR.excluded_record_ids(db, []) == set() and db.sql == []


async def test_a_journey_person_with_no_saved_company_or_no_rules_is_never_left_out(monkeypatch):
    from app.services import journeys as J

    async def none(db=None, org_id=None):
        return TP.Policy("org_x")

    monkeypatch.setattr(TP, "org_effective", none)
    assert await J._left_out_by_organisation(None, SimpleNamespace(lead_id="")) is False
    assert await J._left_out_by_organisation(None, SimpleNamespace(lead_id="lead_1")) is False  # no rules: no query is made


def test_an_export_says_when_the_list_left_companies_out():
    from app.services import export_engine as EE

    t = EE.Tally()
    assert "excluded_by_rules" not in t.preview(3)
    t.excluded = 2
    out = t.preview(3)
    assert out["excluded_by_rules"] == 2 and "exclusion list" in out["excluded_notice"]


# ---- the API ---------------------------------------------------------------------------------------
def req(admin=True, org="org_f", kind="session"):
    return SimpleNamespace(state=SimpleNamespace(auth={"org_id": org, "is_admin": admin, "type": kind, "email": "boss@fsb.example", "operator_id": "op1"}),
                           headers={})


async def test_every_handler_needs_an_account_admin():
    from app.api import org_exclusions as OE

    for who in (req(admin=False), req(kind="api_key")):
        for call in (OE.list_rules(who, None), OE.add_rules(OE.AddIn(items=["church"]), who, None), OE.change_rule("x", OE.PatchIn(enabled=False), who, None),
                     OE.delete_rule("x", who, None), OE.preview(OE.PreviewIn(), who, None), OE.history(who, None)):
            with pytest.raises(HTTPException) as err:
                await call
            assert err.value.status_code == 403


async def test_a_bad_item_rejects_the_whole_request_and_names_it():
    from app.api import org_exclusions as OE

    out = await OE.add_rules(OE.AddIn(items=["church", "x", "keep: 1"]), req(), None)
    assert out.status_code == 422
    body = json.loads(out.body)
    assert {r["item"] for r in body["rejected"]} == {"x", "keep: 1"} and "Nothing was added" in body["detail"]


async def test_nothing_typed_is_a_400():
    from app.api import org_exclusions as OE

    with pytest.raises(HTTPException) as err:
        await OE.add_rules(OE.AddIn(items=["  "]), req(), None)
    assert err.value.status_code == 400


def test_the_route_needs_the_team_section():
    from app.core.permissions import _PATH_RULES

    hit = next(sec for rx, sec in _PATH_RULES if rx.match("/org/exclusions"))
    assert hit == "team" and next(sec for rx, sec in _PATH_RULES if rx.match("/org/exclusions/preview")) == "team"


# ---- the policy read fails closed ------------------------------------------------------------------
@pytest.mark.real_policy
async def test_a_failed_rules_read_without_a_remembered_policy_is_a_503_never_an_empty_policy(monkeypatch):
    async def boom(db, org_id):
        raise RuntimeError("database down")

    monkeypatch.setattr(TP, "_read_rules", boom)
    with pytest.raises(TP.PolicyUnavailable):  # answered as 503 rules_unavailable (main.py)
        await TP.org_effective(None, "org_never_seen")


@pytest.mark.real_policy
async def test_a_failed_read_keeps_the_last_known_rules(monkeypatch):
    TP._CACHE["org_known"] = (0.0, TP.Policy("org_known", rules=[rule("sic", "85200")]))  # remembered long ago: stale

    async def boom(db, org_id):
        raise RuntimeError("database down")

    monkeypatch.setattr(TP, "_read_rules", boom)
    pol = await TP.org_effective(None, "org_known")
    assert [r["value"] for r in pol.org_rules] == ["85200"]


# ---- database --------------------------------------------------------------------------------------
db_only = pytest.mark.db


async def _org(db, org_id, brand_id=None):
    from sqlalchemy import text

    await db.execute(text("INSERT INTO organizations (id, name, slug, status, brand_id) VALUES (:i, :n, :s, 'active', :b) ON CONFLICT DO NOTHING"),
                     {"i": org_id, "n": org_id, "s": org_id, "b": brand_id})
    await db.commit()


@db_only
async def test_the_api_round_trip_and_the_policy_sees_every_change_at_once(db):
    from app.api import org_exclusions as OE

    await _org(db, "org_f")
    with org_scope("org_f"):
        out = await OE.add_rules(OE.AddIn(items=["85200", "church", "Charity register"]), req(), db)
        assert out["added"] == 3 and out["skipped"] == 0 and out["enabled"] == 3
        again = await OE.add_rules(OE.AddIn(items=["church"]), req(), db)
        assert again["added"] == 0 and again["skipped"] == 1
        assert not (await TP.effective(db, "org_f")).is_empty and len((await TP.effective(db, "org_f")).org_rules) == 3
        church = next(r for r in out["rules"] if r["value"] == "church")
        with pytest.raises(HTTPException) as stale:
            await OE.change_rule(church["id"], OE.PatchIn(enabled=False, updated_at="2000-01-01T00:00:00Z"), req(), db)
        assert stale.value.status_code == 409
        off = await OE.change_rule(church["id"], OE.PatchIn(enabled=False, updated_at=church["updatedAt"]), req(), db)
        assert off["enabled"] is False and len((await TP.effective(db, "org_f")).org_rules) == 2
        gone = await OE.delete_rule(church["id"], req(), db)
        assert gone["deleted"] is True and (await OE.list_rules(req(), db))["enabled"] == 2
        with pytest.raises(HTTPException) as other:
            await OE.delete_rule(church["id"], req(org="org_other"), db)
        assert other.value.status_code == 404
        trail = [c["action"] for c in (await OE.history(req(), db))["changes"]]
    assert {"org_exclusion.added", "org_exclusion.changed", "org_exclusion.removed"} <= set(trail)


@db_only
async def test_rules_work_for_an_organisation_with_no_brand_and_stay_inside_it(db):
    from app.api import org_exclusions as OE

    await _org(db, "org_a")
    await _org(db, "org_b")
    with org_scope("org_a"):
        await OE.add_rules(OE.AddIn(items=["85200"]), req(org="org_a"), db)
        await db.rollback()
    assert [r["value"] for r in (await TP.org_effective(None, "org_a")).org_rules] == ["85200"]  # read from outside the organisation's own session
    assert (await TP.org_effective(None, "org_b")).is_empty
    with org_scope("org_b"):
        assert (await OE.list_rules(req(org="org_b"), db))["rules"] == []


@db_only
async def test_the_seed_step_moves_the_fsb_list_once(db):
    from sqlalchemy import text

    from app.core import migrations as M
    from app.database import engine
    from app.models.models import Brand

    db.add(Brand(id="brd_s", name="S", display_name="S", status="active", policy={"exclusions": {"fsb": True, "extra": ["church", "BN9"], "locked": True}, "geo": {"districts": []}}))
    await db.commit()
    await _org(db, "org_s", "brd_s")
    for _ in range(2):  # the second run changes nothing
        async with engine.begin() as conn:
            await M._seed_fsb_rules(conn)
    async with engine.begin() as conn:  # the owner's connection: the test session only sees its own organisation's rows
        n = (await conn.execute(text("SELECT count(*) FROM org_exclusion_rules WHERE org_id = 'org_s'"))).scalar()
    assert n == len(FR.seed_rules()) + 1  # the list, plus BN9 ("church" is already in the list)
    policy = (await db.execute(text("SELECT policy FROM brands WHERE id = 'brd_s'"))).scalar()
    assert "exclusions" not in policy
    async with engine.begin() as conn:
        saved = (await conn.execute(text("SELECT detail FROM audit_log WHERE action = 'exclusions.moved_to_rules' AND org_id = 'org_s'"))).scalar()
    assert saved["removed_from_brand"]["fsb"] is True


@db_only
async def test_the_preview_counts_before_and_after_without_saving(db):
    from app.api import org_exclusions as OE

    await _org(db, "org_f")
    with org_scope("org_f"):
        out = await OE.preview(OE.PreviewIn(add_items=["church"]), req(), db)
        assert set(out) == {"all", "before", "after", "leavesOut"}
        assert (await OE.list_rules(req(), db))["rules"] == []
