"""The provider registry (app/providers, plan 11 Part A): one file per provider, found automatically, driving the e-mail waterfall,
key matching, export rules, prices and a real key test."""
import json
import textwrap

import httpx
import pytest

from app.providers import registry
from app.providers.base import EmailFinder, Manifest, Pricing


def test_every_provider_file_is_found_with_a_valid_manifest():
    ids = {p.manifest.id for p in registry.reload().values()}
    assert ids == {"icypeas", "leadmagic", "hunter", "findymail", "bettercontact", "apollo", "tavily", "google_places", "telnyx_lookup",
                   "provero_tps"}
    assert registry.problems() == {}


def test_the_waterfall_keeps_its_order_names_and_searches():
    from app.services import enrichment_waterfall as W

    assert W.PROVIDERS == ["icypeas", "leadmagic", "hunter", "apollo", "findymail", "bettercontact"]  # the same order as before
    assert W.LABELS == {"icypeas": "Icypeas", "leadmagic": "LeadMagic", "hunter": "Hunter", "apollo": "Apollo", "findymail": "Findymail",
                        "bettercontact": "BetterContact"}
    assert set(W.ADAPTERS) == set(W.PROVIDERS) and all(callable(f) for f in W.ADAPTERS.values())


def test_a_saved_key_s_name_finds_its_provider():
    assert registry.match_key_name("Hunter (main)", "Email Finder").manifest.id == "hunter"
    assert registry.match_key_name("better contact backup").manifest.id == "bettercontact"
    assert registry.match_key_name("Apollo company data", "Business Discovery").manifest.id == "apollo"
    assert registry.match_key_name("Apollo", "Email Finder") is None  # Apollo's key lives under Business Discovery
    assert registry.match_key_name("Some other key") is None


def test_the_export_rule_comes_from_the_licences():
    from app.services import data_policy as DP

    assert registry.non_exportable() == {"apollo", "google_places"}
    assert DP.NON_EXPORTABLE == frozenset({"google_places", "apollo"})


def test_a_broken_manifest_is_named_not_loaded():
    class Bad(EmailFinder):
        manifest = Manifest(id="Bad Id", name="", category="nonsense", capabilities=("teleport",), pricing=Pricing(usd=-1, unit="year"),
                            credit_item="not_an_item")

    problems = registry.problems_of(Bad())
    assert len(problems) == 6


# ---- each provider's real test, against the vendor's answers --------------------------------------------------
TESTS = {
    "hunter": ("https://api.hunter.io/v2/account", {"data": {"requests": {"searches": {"available": 412}}}}, 412),
    "findymail": ("https://app.findymail.com/api/credits", {"credits": 950}, 950),
    "leadmagic": ("https://api.leadmagic.io/v1/credits", {"credits": 77}, 77),
    "bettercontact": ("https://app.bettercontact.rocks/api/v2/account", {"credits_left": 12}, 12),
    "icypeas": ("https://app.icypeas.com/api/bulk-single-searchs/read", {"success": False}, None),
    "apollo": ("https://api.apollo.io/v1/auth/health", {"healthy": True, "is_logged_in": True}, None),
    "tavily": ("https://api.tavily.com/usage", {"account": {"plan_limit": 4000, "plan_usage": 1500}}, 2500),
    "google_places": ("https://places.googleapis.com/v1/places:searchText", {"places": [{"id": "x"}]}, None),
    "telnyx_lookup": ("https://api.telnyx.com/v2/balance", {"data": {"balance": "12.50", "available_credit": "12.50", "currency": "USD"}}, 12.5),
    "provero_tps": ("https://api.provero.io/api/validate/phone-tps", {"onTps": False, "onCtps": False}, None),
}


def _vendor(status, body, seen):
    def handler(request):
        seen.append(str(request.url).split("?")[0])
        return httpx.Response(status, json=body)

    return handler


@pytest.fixture
def fake_vendor(monkeypatch):
    real = httpx.AsyncClient
    state = {"status": 200, "body": {}, "seen": []}

    def client(**kw):
        return real(transport=httpx.MockTransport(_vendor(state["status"], state["body"], state["seen"])), **kw)

    monkeypatch.setattr(httpx, "AsyncClient", client)
    return state


@pytest.mark.parametrize("pid", sorted(TESTS))
async def test_a_working_key_passes_and_reports_its_balance(pid, fake_vendor):
    url, body, balance = TESTS[pid]
    fake_vendor["body"] = body
    out = await registry.test_key(pid, "k-123")
    assert out["ok"] is True and fake_vendor["seen"] == [url]
    assert out.get("balance") == balance


@pytest.mark.parametrize("pid", sorted(TESTS))
async def test_a_refused_key_or_an_empty_account_fails(pid, fake_vendor):
    for status, words in ((401, "rejected"), (403, "rejected"), (402, "out of credits")):
        fake_vendor["status"] = status
        out = await registry.test_key(pid, "k-123")
        assert out["ok"] is False, (pid, status)
        if pid == "google_places":  # Google answers the same way for a bad key and a Places API that is switched off
            assert "refused the key" in out["detail"]
        else:
            assert words in out["detail"], (pid, status, out["detail"])


async def test_the_platform_keys_test_button_no_longer_passes_any_key(fake_vendor):
    from app.services import key_validator

    fake_vendor["status"] = 401
    out = await key_validator.validate_api_key("Hunter", "abc")
    assert out["valid"] is False and "rejected" in out["error"]  # before: "Hunter credentials registered." for any 3 characters
    fake_vendor["status"], fake_vendor["body"] = 200, TESTS["hunter"][1]
    ok = await key_validator.validate_api_key("Hunter", "abc", force_generic=True)
    assert ok["valid"] is True and ok["balance"] == 412


async def test_no_key_and_an_unknown_provider_are_answered_plainly():
    assert (await registry.test_key("hunter", " "))["ok"] is False
    assert (await registry.test_key("nobody", "k"))["detail"].startswith("No provider")


# ---- a new provider is one file ----------------------------------------------------------------------------------
def test_a_new_provider_file_joins_the_registry_and_the_waterfall_order(tmp_path, monkeypatch):
    import app.providers as pkg

    extra = tmp_path / "extra"
    extra.mkdir()
    (extra / "__init__.py").write_text("")
    (extra / "acme_finder.py").write_text(textwrap.dedent('''
        from app.providers.base import EmailFinder, Manifest, Pricing, TestResult

        class Acme(EmailFinder):
            manifest = Manifest(id="acme", name="Acme Finder", category="email_finder", capabilities=("email_finder",), provides=("email",),
                                key_group="Email Finder", pricing=Pricing(usd=0.004, unit="find"), credit_item="lead_lookup", default_order=5)

            async def find_email(self, client, key, person):
                return "", ""

            async def test(self, client, key):
                return TestResult(True, "ok")

        PROVIDER = Acme()
    '''))
    monkeypatch.setattr(pkg, "__path__", list(pkg.__path__) + [str(tmp_path)])
    try:
        registry.reload()
        assert registry.email_finders()[0].manifest.id == "acme"  # cheapest, so first in the order
        assert registry.match_key_name("Acme Finder key", "Email Finder").manifest.id == "acme"
    finally:
        monkeypatch.undo()
        registry.reload()
    assert registry.get("acme") is None


# ---- prices and the staff screens (database) ------------------------------------------------------------------------
@pytest.mark.db
async def test_prices_are_seeded_once_and_never_overwrite_what_staff_set(db):
    from sqlalchemy import select

    from app.models.models import ProviderPrice

    db.add(ProviderPrice(id="pp_h", provider="hunter", model="", kind="lookup", price_in_usd=0.07, confirmed=True))
    await db.commit()
    made = await registry.seed_prices(db)
    await db.commit()
    rows = {r.provider: r for r in (await db.execute(select(ProviderPrice).where(ProviderPrice.kind == "lookup"))).scalars().all()}
    assert made == 8 and set(rows) == {"hunter", "icypeas", "leadmagic", "findymail", "bettercontact", "tavily", "google_places", "telnyx_lookup",
                                       "provero_tps"}  # Apollo has no known price
    assert rows["tavily"].billing == "per_search" and rows["icypeas"].billing == "per_find"
    assert rows["hunter"].price_in_usd == 0.07 and rows["icypeas"].price_in_usd == 0.01 and rows["icypeas"].confirmed is False
    assert await registry.seed_prices(db) == 0


@pytest.mark.db
async def test_staff_see_every_provider_and_test_a_saved_key(db, staff, anon):
    got = await staff.get("/api/admin-api/providers")
    assert got.status_code == 200, got.text
    body = got.json()
    assert [p["id"] for p in body["providers"] if p["category"] == "email_finder"] == ["icypeas", "leadmagic", "hunter", "findymail", "bettercontact"]
    assert {p["id"]: p["category"] for p in body["providers"] if p["id"] in ("tavily", "google_places", "telnyx_lookup", "provero_tps")} == {
        "tavily": "web_search", "google_places": "company_data", "telnyx_lookup": "phone_lookup", "provero_tps": "tps_screening"}
    apollo = next(p for p in body["providers"] if p["id"] == "apollo")
    assert apollo["licence"]["exportable"] is False and apollo["keySaved"] is False and body["problems"] == {}
    none = await staff.post("/api/admin-api/providers/hunter/test")
    assert none.status_code == 200 and none.json() == {"ok": False, "detail": "No key is saved for this provider yet."}
    assert (await staff.post("/api/admin-api/providers/nobody/test")).status_code == 404
    assert (await anon.get("/api/admin-api/providers")).status_code in (401, 403)
    json.dumps(body)  # the screen gets plain JSON


async def test_the_platform_keys_test_button_knows_google_places_from_gemini(fake_vendor):
    from app.services import key_validator

    fake_vendor["body"] = {"places": [{"id": "x"}]}
    out = await key_validator.validate_api_key("Google Places", "AIza-test")
    assert out["valid"] is True and out["provider"] == "Google Places" and fake_vendor["seen"] == ["https://places.googleapis.com/v1/places:searchText"]
    assert registry.match_key_name("Google Gemini") is None  # a Gemini key keeps its own check
