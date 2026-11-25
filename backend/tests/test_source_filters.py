"""Find Leads filters for where a company's contact details came from and whether its phone was screened against TPS/CTPS.
They are real search conditions (counts, pages and summaries agree) and are ANDed with the brand policy and a person's own areas."""
import json

import pytest
from sqlalchemy import and_, select
from sqlalchemy.dialects import postgresql

from app.models.models import BusinessRecord as B, CompanyContactPoint as CP, PhoneScreening as PS
from app.services import business_records as BR
from app.services import contact_points as CPT
from app.services import lead_filters as LF
from app.services import tenant_policy as TP


def sql(f):
    return str(select(B.id).where(and_(*BR._filter_conditions(BR.normalize_filters(f)))).compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


@pytest.fixture(autouse=True)
def fresh_policy():
    TP.invalidate()
    yield
    TP.invalidate()


def test_filters_are_kept_cleaned_and_shown():
    f = BR.normalize_filters({"tps_checked": 1, "tps_status": "LISTED", "has_google_data": True, "data_from": ["Google", "nonsense", "web", "google"]})
    assert f["tps_checked"] is True and f["tps_status"] == "listed" and f["has_google_data"] is True and f["data_from"] == ["google", "web"]
    assert "tps_status" not in BR.normalize_filters({"tps_status": "maybe"}) and "data_from" not in BR.normalize_filters({"data_from": ["x"]})
    chips = LF.describe(f)
    assert "Phone is on TPS or CTPS" in chips and "Includes Google data" in chips and "Data from: Google, Web search" in chips
    assert "Phone checked against TPS/CTPS" in LF.describe(BR.normalize_filters({"tps_checked": True}))
    assert BR.has_narrowing(BR.normalize_filters({"has_google_data": True}))  # the shared opening list must not stand in for them
    assert {"tps_checked", "tps_status", "has_google_data", "data_from"} <= set(BR.FILTER_KEYS)


def test_sql_reads_the_indexed_contact_list_and_the_screening_table():
    s = sql({"tps_checked": True})
    assert "company_contact_points" in s and "phone_screenings" in s and "+44%" in s
    assert "google_places" in sql({"has_google_data": True}) and "apollo" in sql({"data_from": ["enrichment"]})
    assert "company_contact_points" not in sql({"has_phone": True})


def test_the_totals_cache_key_includes_the_new_filters():
    a = json.dumps(BR.normalize_filters({"towns": ["x"], "tps_checked": True}), sort_keys=True)
    b = json.dumps(BR.normalize_filters({"towns": ["x"], "has_google_data": True}), sort_keys=True)
    c = json.dumps(BR.normalize_filters({"towns": ["x"]}), sort_keys=True)
    assert len({a, b, c}) == 3


def _rec(n, name, postcode="BN1 1AA", phone=""):
    return B(id=f"s{n}", identity_hash=f"sh{n}", name=name, registration_number=f"0123456{n}", postcode=postcode, status="Active",
             company_category="Private limited Company", sic_codes="|43220|", sic_text="x", sources=[], rank_score=0, region="Hove",
             industry="Plumbing", phone=phone)


def _point(rec, kind, value, source, confidence="found"):
    return CP(id=f"cp_{rec}_{kind}_{source}", business_record_id=rec, kind=kind, value=value, norm=CPT.norm(kind, value), source=source, confidence=confidence)


async def _world(db):
    db.add_all([_rec(1, "Alpha Plumbing Ltd", phone="0113 496 0101"), _rec(2, "Beta Plumbing Ltd", phone="0113 496 0202"),
                _rec(3, "Gamma Plumbing Ltd", phone="0113 496 0303"), _rec(4, "Delta Plumbing Ltd", postcode="LS1 1AA", phone="0113 496 0404"),
                _rec(5, "Epsilon Plumbing Ltd", postcode="BN2 2AA"), _rec(6, "Zeta Plumbing Ltd", phone="0113 496 0606")])
    await db.commit()
    db.add_all([
        _point("s1", "phone", "0113 496 0101", "register", "register"),
        _point("s2", "phone", "0113 496 0202", "record", "register"),  # the old label for a copied value: not register data (plan 10, Phase 1)
        _point("s2", "email", "info@beta.example", "scrape"),
        _point("s3", "phone", "0113 496 0303", "google_places"),
        _point("s4", "phone", "0113 496 0404", "google_places"),  # outside a BN1 person's areas
        _point("s5", "email", "info@epsilon.example", "apollo"),
        _point("s6", "phone", "0113 496 0606", "web"),
        PS(number="+441134960101", tps_status="clear"), PS(number="+441134960202", tps_status="listed"),
        PS(number="+441134960303", tps_status="clear", ctps=True), PS(number="+441134960404", tps_status="clear"),
        PS(number="+441134960606", tps_status="unknown"),  # a row with no result is not a check
    ])
    await db.commit()


async def _names(db, f):
    out = await BR.search_filtered(db, f, limit=50, stats=False, broaden=False)
    names = sorted(r.name.split()[0] for r in out["rows"])
    assert out["total"] == len(names)
    return names


def _as(policy, monkeypatch):
    async def eff(db=None, org_id=None):
        return policy

    monkeypatch.setattr(TP, "effective", eff)


BASE = {"postcode_prefixes": ["BN", "LS"]}


@pytest.mark.db
async def test_tps_checked_and_status(db):
    await _world(db)
    assert await _names(db, {**BASE, "tps_checked": True}) == ["Alpha", "Beta", "Delta", "Gamma"]  # Zeta's row is "unknown"; Epsilon has no phone
    assert await _names(db, {**BASE, "tps_status": "listed"}) == ["Beta", "Gamma"]  # CTPS counts as listed
    assert await _names(db, {**BASE, "tps_status": "clear"}) == ["Alpha", "Delta"]
    assert await _names(db, {"postcode_prefixes": ["LS"], "tps_checked": True}) == ["Delta"]  # combines with another filter
    assert await _names(db, {"tps_checked": True}) == ["Alpha", "Beta", "Delta", "Gamma"]  # no other filter at all


@pytest.mark.db
async def test_google_data_and_data_from(db):
    await _world(db)
    assert await _names(db, {**BASE, "has_google_data": True}) == ["Delta", "Gamma"]
    assert await _names(db, {**BASE, "data_from": ["google"]}) == ["Delta", "Gamma"]
    assert await _names(db, {**BASE, "data_from": ["enrichment"]}) == ["Epsilon"]
    assert await _names(db, {**BASE, "data_from": ["register", "web"]}) == ["Alpha", "Zeta"]  # any of the picked sources
    assert await _names(db, {**BASE, "data_from": ["data"]}) == ["Beta"]  # a licensed file or a web scrape
    assert await _names(db, {**BASE, "data_from": ["register", "google"], "has_google_data": True}) == ["Delta", "Gamma"]
    assert await _names(db, {**BASE, "has_google_data": True, "tps_status": "listed"}) == ["Gamma"]
    assert await _names(db, {"postcode_prefixes": ["LS"], "has_google_data": True, "has_phone": True}) == ["Delta"]


@pytest.mark.db
async def test_filters_are_anded_with_the_policy_and_a_persons_areas(db, monkeypatch):
    await _world(db)
    assert await _names(db, {"has_google_data": True}) == ["Delta", "Gamma"]
    _as(TP.Policy("org_s").for_user(["BN1"]), monkeypatch)  # a scoped person never gets a row outside their areas
    assert await _names(db, {"has_google_data": True}) == ["Gamma"]
    assert await _names(db, {"tps_checked": True}) == ["Alpha", "Beta", "Gamma"]
    assert await _names(db, {"data_from": ["enrichment"]}) == []  # Epsilon is BN2
    assert (await BR.search_summary(db, {"tps_checked": True}))["total"] == 3  # the summary counts through the same path
    _as(TP.Policy("org_s").for_user(["LS1"]), monkeypatch)
    assert await _names(db, {"tps_checked": True}) == ["Delta"]
