"""White-label brands and the tenant policy: resolution and cache, the exact SQL an organisation without a brand gets, the FSB rules, the
geography lock, member suppression, locked exclusions, cache keys, the staff and organisation APIs, the public branding route, restricted sources.
Unit tests need no database; the ones marked db run on TEST_DATABASE_URL."""
import asyncio
import re
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response
from sqlalchemy import and_, select
from sqlalchemy.dialects import postgresql

from app.core.tenancy import org_scope
from app.models.models import BusinessRecord as B
from app.services import business_records as BR
from app.services import fsb_rules as FR
from app.services import org_rules as OR
from app.services import tenant_policy as TP


def sql(conds):
    return str(select(B.id).where(and_(*conds)).compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))


FSB = {"member_suppression": True, "geo": {"districts": ["BN1", "bn2"]},
       "restricted_sources": {"google": True, "apollo": True, "search_engines": True}}


@pytest.fixture(autouse=True)
def fresh_policy_cache():
    TP.invalidate()
    yield
    TP.invalidate()


def fake_effective(policy):
    async def eff(db=None, org_id=None):
        return policy

    return eff


# ---- unit: policy shape and the empty policy -------------------------------------------------
def test_clean_policy_fills_defaults_and_drops_unknown_keys():
    p = TP.clean_policy({"exclusions": {"fsb": 1, "extra": ["85200", " 85200 ", "x", "church"], "bogus": 1}, "geo": {"districts": ["bn1", "BN 2", "nope", "BN1"]},
                         "restricted_sources": {"google": True, "yell": True}, "signin": {"google": False}, "evil": {}})
    assert set(p) == {"exclusions", "member_suppression", "geo", "restricted_sources", "signin", "screening", "social"}
    assert p["exclusions"] == {"sets": ["standard_b2b"], "fsb": True, "extra": ["85200", "church"], "locked": True}  # the old flag is the Standard B2B set
    assert p["geo"]["districts"] == ["BN1", "BN2"]
    assert p["restricted_sources"] == {"google": True, "apollo": False, "search_engines": False}
    assert p["signin"] == {"password": True, "google": False, "microsoft": True}
    assert TP.clean_policy("garbage") == TP.default_policy()


def test_org_without_a_brand_gets_an_empty_policy():
    p = TP.Policy("org_x")
    assert p.is_empty and p.conditions("org_x") == [] and p.hash() == "" and p.cache_key() == ""
    assert p.exclusion_conditions() == [] and p.geo_conditions() == [] and p.suppression_condition("org_x") is None
    assert not any(p.restricted(s) for s in TP.SOURCES)


def test_company_numbers_are_normalised():
    assert TP.normalize_company_number("1234567") == "01234567"
    assert TP.normalize_company_number(" sc 123456 ") == "SC123456"
    assert TP.normalize_company_number("not a number") == "" and TP.normalize_company_number("123456789") == ""


async def test_matching_sql_is_identical_for_an_org_without_a_brand(monkeypatch):
    monkeypatch.setattr(TP, "effective", fake_effective(TP.Policy("org_plain")))

    async def big(db, where):
        return 999

    f = BR.normalize_filters({"postcode_prefixes": ["BN"], "fsb_exclusions": True, "exclude_items": ["85200"]})
    extra = [B.id.notin_(["a", "b"])]
    got, _, _ = await BR.matching(None, f, extra, count=big)
    assert sql([got]) == sql([and_(*BR._filter_conditions(f), *extra)])
    again, _, _ = await BR.matching(None, f, extra, count=big, apply_policy=False)
    assert sql([again]) == sql([got])


# What the hard-coded FSB list said before it became rows ("FSB exclusion rules - for developers"): kept here only as the oracle.
LEGACY_NAME_WORDS = (r"\m(charit[a-z]*|church|parish|mosque|synagogue|temple|casino[a-z]*|credit union|nhs|hospital|school|college|"
                     r"university|academy trust|shopping centre|bureau de change|tourist information|weighbridge[a-z]*)\M")
LEGACY_KEEP = "(driving school|dance school)"


def _py(rx):
    return re.compile(rx.replace(r"\m", r"\b").replace(r"\M", r"\b"), re.I)


def _seed_conditions():
    return OR.conditions([{"kind": r["kind"], "value": r["value"], "mode": r["mode"]} for r in FR.seed_rules()])


def test_seeded_rows_say_what_the_hard_coded_fsb_list_said():
    rows = FR.seed_rules()
    assert len([r for r in rows if r["kind"] == "sic"]) == 53 and len([r for r in rows if r["kind"] == "company_type"]) == 5
    assert {r["kind"] for r in rows if r["value"] == ""} == {"status_only", "ch_number_only", "charity_register"}
    words = [r["value"] for r in rows if r["kind"] == "name_word" and r["mode"] == "exclude"]
    keeps = [r["value"] for r in rows if r["mode"] == "keep"]
    new_rx, keep_rx = r"\m(" + "|".join(OR._fragment(w) for w in words) + r")\M", "(" + "|".join(OR._fragment(w) for w in keeps) + ")"
    old, new, old_keep, new_keep = _py(LEGACY_NAME_WORDS), _py(new_rx), _py(LEGACY_KEEP), _py(keep_rx)
    for name in ("Hope Charity Ltd", "Charitable Trust", "St Mary Church", "Sunny Driving School Ltd", "Hove Dance School", "Schools Ltd", "Casinos Royal",
                 "Weighbridges Ltd", "Credit Union Ltd", "Acme Plumbing", "Churchill Ltd", "Hospitality Ltd", "Univ Ltd", "Bureau De Change Ltd",
                 "Shopping Centre Mgmt", "Academy Trust North", "NHS Trust", "Temple Gardens", "Colleges Ltd"):
        assert bool(old.search(name)) == bool(new.search(name)), name
        assert bool(old_keep.search(name)) == bool(new_keep.search(name)), name


def test_seeded_rules_sql_has_every_fsb_rule():
    s = sql(_seed_conditions())
    assert "btrim(business_records.status) = 'Active'" in s and "[A-Z0-9]{8}" in s
    assert "'registered society'" in s and "'other company type'" in s and "ds_charity_commission" in s
    assert "84110" in s and "99000" in s and "charit[a-z]*" in s and "school" in s and "driving" in s
    assert "53200" not in s and "50200" not in s  # couriers and freight are deliberately not excluded


def test_org_rules_are_the_whole_exclusion_policy():
    p = TP.Policy("org_x", rules=[{"kind": "sic", "value": "85200", "mode": "exclude"}])
    assert not p.is_empty and p.hash() and p.cache_key().startswith("org_x:") and p.summary()["standingExclusions"] and p.summary()["exclusionRules"] == 1
    assert "85200" in sql(p.exclusion_conditions())
    other = TP.Policy("org_x", rules=[{"kind": "sic", "value": "85100", "mode": "exclude"}])
    assert other.hash() != p.hash() and p.with_rules([]).is_empty


def test_geo_and_suppression_conditions():
    p = TP.Policy("org_f", "brd_f", FSB)
    g = sql(p.geo_conditions())
    assert "BN1" in g and "BN2" in g
    s = sql([p.suppression_condition("org_f")])
    assert "NOT IN" in s.upper() and "suppressed_companies" in s and "'org_f'" in s


async def test_organisation_rules_are_added_to_every_search_whatever_the_client_sends(monkeypatch):
    rules = [{"kind": r["kind"], "value": r["value"], "mode": r["mode"]} for r in FR.seed_rules()]
    monkeypatch.setattr(TP, "effective", fake_effective(TP.Policy("org_f", "brd_f", FSB, rules=rules)))

    async def big(db, where):
        return 999

    for client in ({"postcode_prefixes": ["BN"], "status": "any", "legal_form": "sole"}, {"postcode_prefixes": ["BN"]}):
        where, _, _ = await BR.matching(None, BR.normalize_filters(client), count=big)
        s = sql([where])
        assert "'registered society'" in s and "btrim(business_records.status) = 'Active'" in s and "BN2" in s and "suppressed_companies" in s


def test_cache_keys_differ_by_policy_and_organisation():
    a, b = TP.Policy("org_a", "brd_f", FSB), TP.Policy("org_b", "brd_f", FSB)
    other = TP.Policy("org_a", "brd_g", {"geo": {"districts": ["LS1"]}})
    assert a.hash() == b.hash() and a.cache_key() != b.cache_key()
    assert a.hash() != other.hash()
    from app.api import lead_accounts as LA

    k = lambda pk: LA._page_key({"towns": ["Hove"]}, "best", 25, 0, [], False, pk)  # noqa: E731
    assert len({k(""), k(a.cache_key()), k(b.cache_key()), k(other.cache_key())}) == 4
    assert k("") == LA._page_key({"towns": ["Hove"]}, "best", 25, 0, [], False)
    TP.invalidate("org_a")
    assert TP.Policy("org_a", "brd_f", FSB).hash() != a.hash()  # an edit or a new member list changes every key at once


# ---- unit: restricted sources ----------------------------------------------------------------
async def test_a_restricted_source_reports_nothing_found(monkeypatch):
    from app.services import apollo_pool
    from app.services import enrichment_service as E

    monkeypatch.setattr(TP, "effective", fake_effective(TP.Policy("org_f", "brd_f", FSB)))

    async def boom(*a, **k):
        raise AssertionError("a restricted source was reached")

    monkeypatch.setattr(E, "google_places_key", boom)
    monkeypatch.setattr(E, "apollo_key", boom)
    monkeypatch.setattr(E, "deepseek_search_enabled", lambda: asyncio.sleep(0, True))
    monkeypatch.setattr("app.services.tavily_pool.keys", boom)
    assert await E.search_google_places("Acme Hove", name="Acme", postcode="BN1 1AA") is None
    assert await apollo_pool.keys() == []
    assert await E.search_apollo("Acme", postcode="BN1 1AA") is None
    assert await E.search_tavily("acme") == []
    assert await E.search_deepseek("acme") == []
    assert await E.search_web("acme") == []
    assert await TP.source_allowed("org_f", "google") is False


async def test_an_unrestricted_org_still_reaches_its_sources(monkeypatch):
    from app.services import enrichment_service as E

    monkeypatch.setattr(TP, "effective", fake_effective(TP.Policy("org_plain")))
    called = []

    async def key():
        called.append(1)
        return ""

    monkeypatch.setattr(E, "google_places_key", key)
    assert await E.search_google_places("Acme") is None and called == [1]
    assert await TP.source_allowed("org_plain", "apollo") is True


# ---- unit: permissions -----------------------------------------------------------------------
def staff(role="staff_admin"):
    return SimpleNamespace(state=SimpleNamespace(staff={"role": role, "email": "ops@example.com", "id": "st1"}), scope={}, headers={})


async def test_staff_changes_need_a_staff_admin():
    from app.api import brands as BA

    for call in (BA.create_brand(BA.BrandIn(name="X"), staff("staff_support")), BA.set_policy("brd_x", {}, staff("staff_support")),
                 BA.add_domain("brd_x", BA.DomainIn(host="a.example.com"), staff("staff_support")), BA.link_org("brd_x", "org_x", staff("staff_support")),
                 BA.delete_brand("brd_x", staff("staff_support"))):
        with pytest.raises(HTTPException) as err:
            await call
        assert err.value.status_code == 403


async def test_org_policy_routes_need_the_account_admin():
    from app.api import org_policy as OP

    req = SimpleNamespace(state=SimpleNamespace(auth={"org_id": "org_f", "is_admin": False}), headers={})
    for call in (OP.list_suppression(req, None), OP.add_suppression(req, False, None), OP.clear_suppression(req, None)):
        with pytest.raises(HTTPException) as err:
            await call
        assert err.value.status_code == 403


def test_member_file_parsing():
    from app.api import org_policy as OP

    rows, bad = OP.parse_numbers(b"company number,name\n1234567,Acme\nSC123456,Beta\nnope,Gamma\n\n")
    assert rows == [("01234567", "Acme"), ("SC123456", "Beta")] and bad == 1
    rows, bad = OP.parse_numbers(b'{"numbers": ["1234567", {"number": "ab123456", "label": "L"}, "x"]}')
    assert rows == [("01234567", ""), ("AB123456", "L")] and bad == 1
    assert OP.parse_numbers(b"01234567\nSC123456\n")[0] == [("01234567", ""), ("SC123456", "")]


def test_account_check_and_branding_route_is_public():
    from app.core.auth_middleware import PUBLIC_HTTP

    assert any(p.match("/api/brand") for p in PUBLIC_HTTP) and not any(p.match("/api/me/brand") for p in PUBLIC_HTTP)


# ---- database --------------------------------------------------------------------------------
db_only = pytest.mark.db


async def _org(db, org_id, brand_id=None):
    from sqlalchemy import text

    await db.execute(text("INSERT INTO organizations (id, name, slug, status, brand_id) VALUES (:i, :n, :s, 'active', :b) ON CONFLICT DO NOTHING"),
                     {"i": org_id, "n": org_id, "s": org_id, "b": brand_id})
    await db.commit()


async def _brand(db, policy=None, status="active"):
    from app.models.models import Brand

    b = Brand(id="brd_fsb", name="FSB", display_name="FSB Outreach", logo_url="https://x.example/l.png", accent_color="#112233", status=status,
              policy=TP.clean_policy(policy or FSB))
    db.add(b)
    await db.commit()
    TP.invalidate()
    return b


async def _seed(db, org, rows=None):
    from app.models.models import OrgExclusionRule

    from app.database import AsyncSessionLocal

    with org_scope(org):  # row-level security: an organisation's rows are written in its own scope
        async with AsyncSessionLocal() as s:
            for r in rows if rows is not None else FR.seed_rules():
                s.add(OrgExclusionRule(org_id=org, kind=r["kind"], value=r["value"], mode=r["mode"], enabled=r.get("enabled", True)))
            await s.commit()
    TP.invalidate(org)


def _rec(n, name, reg, postcode="BN1 1AA", status="Active", category="Private limited Company", sic="|43220|", sources=None):
    return B(id=f"b{n}", identity_hash=f"h{n}", name=name, registration_number=reg, postcode=postcode, status=status, company_category=category,
             sic_codes=sic, sic_text="x", sources=sources or [], rank_score=0, region="Hove", industry="Plumbing")


async def _records(db):
    rows = [_rec(1, "Acme Plumbing Ltd", "01234567"), _rec(2, "Hope Charity Ltd", "01234568"), _rec(3, "Hove Primary School Ltd", "01234569"),
            _rec(4, "Sunny Driving School Ltd", "01234570"), _rec(5, "Care Co Ltd", "01234571", sic="|43220|85200|"),
            _rec(6, "Gone Ltd", "01234572", status="Dissolved"), _rec(7, "Leeds Plumbing Ltd", "01234573", postcode="LS1 1AA"),
            _rec(8, "Hove Charity Reg Ltd", "01234574", sources=["ds_charity_commission"]), _rec(9, "Society Ltd", "01234575", category="Registered Society"),
            _rec(10, "Solo Trader", "", postcode="BN1 2AA"), _rec(11, "Beta Plumbing Ltd", "01234576", postcode="BN2 3AA")]
    db.add_all(rows)
    await db.commit()


async def _names(db, filters, org="org_f", **kw):
    with org_scope(org):
        out = await BR.search_filtered(db, filters, limit=50, stats=False, broaden=False, **kw)
        names = sorted(r.name for r in out["rows"])
        await db.rollback()
    return names


WIDE = {"postcode_prefixes": ["BN", "LS"], "status": "any"}


@db_only
async def test_an_org_without_a_brand_sees_everything_as_before(db):
    await _records(db)
    await _org(db, "org_plain")
    names = await _names(db, WIDE, "org_plain")
    assert {"Hope Charity Ltd", "Hove Primary School Ltd", "Gone Ltd", "Leeds Plumbing Ltd", "Society Ltd"} <= set(names)
    with org_scope("org_plain"):
        assert (await TP.effective(db, "org_plain")).is_empty


@db_only
async def test_fsb_org_is_held_to_the_rules(db):
    await _records(db)
    await _brand(db, {**FSB, "geo": {"districts": []}, "member_suppression": False})
    await _org(db, "org_f", "brd_fsb")
    await _seed(db, "org_f")
    names = await _names(db, WIDE)
    assert names == ["Acme Plumbing Ltd", "Beta Plumbing Ltd", "Leeds Plumbing Ltd", "Sunny Driving School Ltd"]
    # the client has no switch: asking for sole traders finds none while the Companies House rule is on
    assert await _names(db, {**WIDE, "legal_form": "sole"}) == []
    assert await _names(db, WIDE) == names


@db_only
async def test_geo_lock_and_member_suppression(db):
    from app.api import org_policy as OP

    await _records(db)
    await _brand(db)
    await _org(db, "org_f", "brd_fsb")
    await _seed(db, "org_f")
    assert await _names(db, WIDE) == ["Acme Plumbing Ltd", "Beta Plumbing Ltd", "Sunny Driving School Ltd"]  # BN1 and BN2 only: no Leeds
    req = SimpleNamespace(state=SimpleNamespace(auth={"org_id": "org_f", "is_admin": True, "email": "boss@fsb.example", "operator_id": "op1"}),
                          headers={"content-type": "application/json"})

    async def body():
        return b'{"numbers": ["1234567", "01234576", "bad"]}'

    req.body = body
    with org_scope("org_f"):
        out = await OP.add_suppression(req, False, db)
    assert out["added"] == 2 and out["rejected"] == 1 and out["count"] == 2
    assert await _names(db, WIDE) == ["Sunny Driving School Ltd"]  # 01234567 (Acme) and 01234576 (Beta) are members
    with org_scope("org_f"):
        listing = await OP.list_suppression(req, db)
        assert listing["count"] == 2 and {s["number"] for s in listing["sample"]} == {"01234567", "01234576"}
        cleared = await OP.clear_suppression(req, db)
    assert cleared["removed"] == 2
    assert len(await _names(db, WIDE)) == 3  # the list is gone at once: the cache was invalidated


@db_only
async def test_member_suppression_is_off_unless_the_policy_has_it(db):
    from app.api import org_policy as OP

    await _brand(db, {"geo": {"districts": []}})
    await _org(db, "org_f", "brd_fsb")
    await _org(db, "org_plain")
    for org in ("org_f", "org_plain"):
        req = SimpleNamespace(state=SimpleNamespace(auth={"org_id": org, "is_admin": True}), headers={})
        with org_scope(org):
            with pytest.raises(HTTPException) as err:
                await OP.list_suppression(req, db)
        assert err.value.status_code == 404


@db_only
async def test_two_organisations_never_share_a_cached_total(db):
    from app.models.models import SuppressedCompany

    await _brand(db)
    await _org(db, "org_f", "brd_fsb")
    await _org(db, "org_g", "brd_fsb")
    await _org(db, "org_plain")
    BR._TOTALS.clear()
    where, f = B.id.isnot(None), {"towns": ["Hove"]}
    for org in ("org_f", "org_g", "org_plain"):
        with org_scope(org):
            await BR.exact_total(db, where, f)
            await db.rollback()
    assert len(BR._TOTALS) == 3
    assert sum(1 for k in BR._TOTALS if "org_f:" in k) == 1 and sum(1 for k in BR._TOTALS if "org_g:" in k) == 1
    assert all(not k.endswith(":") for k in BR._TOTALS)
    assert any(k.endswith("|") for k in BR._TOTALS)  # the organisation without a brand keeps the plain key
    BR._TOTALS.clear()


@db_only
async def test_resolution_cache_and_invalidation(db):
    b = await _brand(db)
    await _org(db, "org_f", "brd_fsb")
    p1 = await TP.effective(db, "org_f")
    assert not p1.is_empty and (await TP.effective(db, "org_f")) is p1  # remembered
    b.policy = TP.clean_policy({"geo": {"districts": ["EX1"]}})
    await db.commit()
    assert (await TP.effective(db, "org_f")) is p1  # still the remembered one for up to 60 seconds
    TP.invalidate("org_f")
    p2 = await TP.effective(db, "org_f")
    assert p2 is not p1 and p2.geo_districts == ["EX1"] and p2.hash() != p1.hash()
    assert b.id == "brd_fsb"


@db_only
async def test_staff_api_writes_audit_rows_and_invalidates(db):
    from app.api import brands as BA
    from app.services import audit

    await _org(db, "org_f")
    made = await BA.create_brand(BA.BrandIn(name="FSB", displayName="FSB Outreach", accent="#112233", policy=FSB), staff())
    bid = made["id"]
    assert bid.startswith("brd_") and made["policy"]["member_suppression"] is True and made["orgCount"] == 0
    with pytest.raises(HTTPException):
        await BA.edit_brand(bid, BA.BrandIn(accent="red"), staff())
    dom = await BA.add_domain(bid, BA.DomainIn(host="HTTPS://Outreach.FSB.example:443/x", verified=True), staff())
    assert dom["host"] == "outreach.fsb.example"
    with pytest.raises(HTTPException) as dup:
        await BA.add_domain(bid, BA.DomainIn(host="outreach.fsb.example"), staff())
    assert dup.value.status_code == 409
    assert (await BA.link_org(bid, "org_f", staff())) == {"orgId": "org_f", "brandId": bid}
    assert not (await TP.effective(None, "org_f")).is_empty
    listing = await BA.organizations_with_brand(staff(), "")
    assert any(o["id"] == "org_f" and o["brandId"] == bid and o["brandName"] == "FSB" for o in listing["organizations"])
    changed = await BA.set_policy(bid, {"geo": {"districts": ["BN9"]}}, staff())
    assert changed["policy"]["geo"]["districts"] == ["BN9"] and (await TP.effective(None, "org_f")).geo_districts == ["BN9"]
    with pytest.raises(HTTPException) as busy:
        await BA.delete_brand(bid, staff())
    assert busy.value.status_code == 409
    with org_scope("org_f"):  # the organisation sees its own trail
        actions = [r["action"] for r in await audit.recent(db, limit=50)]
    assert "brand.linked" in actions and "policy.changed" in actions
    with org_scope("org_default"):
        await db.rollback()
        platform = [r["action"] for r in await audit.recent(db, limit=50)]
    assert {"brand.created", "brand.domain_added", "policy.changed"} <= set(platform)
    await BA.unlink_org(bid, "org_f", staff())
    assert (await TP.effective(None, "org_f")).is_empty
    await BA.remove_domain(bid, dom["id"], staff())
    assert (await BA.delete_brand(bid, staff()))["deleted"] is True


@db_only
async def test_branding_endpoint_returns_the_look_and_never_policy(db):
    from app.api import brands as BA
    from app.models.models import BrandDomain

    await _brand(db)
    db.add(BrandDomain(host="outreach.fsb.example", brand_id="brd_fsb", verified=True))
    await db.commit()
    req = SimpleNamespace(headers={"host": "api.example.com"})
    got = await BA.brand_for_host(req, Response(), host="Outreach.FSB.example:8443")
    assert got == {"name": "FSB", "displayName": "FSB Outreach", "logoUrl": "https://x.example/l.png", "accent": "#112233", "theme": {}, "poweredBy": True,
                   "signin": {"password": True, "google": True, "microsoft": True}}
    assert "policy" not in str(got).lower() and "exclusion" not in str(got).lower()
    assert await BA.brand_for_host(req, Response(), host="unknown.example.com") == {}
    assert await BA.brand_for_host(req, Response(), host="") == {}
    await BA.set_policy("brd_fsb", {**FSB, "signin": {"password": True, "google": False, "microsoft": False}}, staff())
    assert (await BA.brand_for_host(req, Response(), host="outreach.fsb.example"))["signin"] == {"password": True, "google": False, "microsoft": False}
    await _brand_suspend(db)
    assert await BA.brand_for_host(req, Response(), host="outreach.fsb.example") == {}


async def _brand_suspend(db):
    from sqlalchemy import text

    await db.execute(text("UPDATE brands SET status = 'suspended'"))
    await db.commit()


@db_only
async def test_me_brand_reports_flags_without_the_policy(db):
    from app.api import brands as BA

    await _brand(db)
    await _org(db, "org_f", "brd_fsb")
    await _org(db, "org_plain")
    await _seed(db, "org_f")
    mk = lambda org: SimpleNamespace(state=SimpleNamespace(auth={"org_id": org}), headers={})  # noqa: E731
    got = await BA.my_brand(mk("org_f"))
    assert got["hideCredits"] is False and got["standingExclusions"] is True and got["geoDistricts"] == 2
    assert got["restrictedSources"] == ["google", "apollo", "search_engines"] and got["displayName"] == "FSB Outreach"
    assert "policy" not in got and "extra" not in str(got)
    assert await BA.my_brand(mk("org_plain")) == {}
    with org_scope("org_f"):
        from app.api import org_policy as OP

        summary = await OP.my_policy(mk("org_f"), db)
    assert summary["memberSuppression"] is True and summary["geoDistricts"] == 2
    assert "districts" not in str({k: v for k, v in summary.items() if k != "data_access"})  # the person's own limits (data_access) are theirs to see; the org's list is not
    assert summary["data_access"] == {"limited": False, "districts": [], "allow_export": True, "allow_google": True}
