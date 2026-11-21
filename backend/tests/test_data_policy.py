"""Which values may leave the app: the policy helpers, provenance, and what the deep search keeps. No database."""
from types import SimpleNamespace

from app.services import contact_points as CP, data_policy as DP


def test_google_and_apollo_are_not_exportable_and_everything_else_is():
    assert DP.NON_EXPORTABLE == frozenset({"google_places", "apollo"})
    for s in ("google_places", "apollo", "apollo:123", "Google_Places"):
        assert DP.is_restricted(s) and not DP.exportable(s)
    for s in ("website", "register", "user", "import", "", None):
        assert DP.exportable(s) and not DP.is_restricted(s)


def test_wording_is_plain_and_names_no_vendor_for_apollo():
    assert DP.tooltip("google_places") == "From Google. You can see and use it in Outreach, but it can't be downloaded."
    assert DP.tooltip("apollo") == "From our enrichment data. You can see and use it in Outreach, but it can't be downloaded."
    assert "apollo" not in DP.tooltip("apollo").lower() and DP.tooltip("website") == ""
    assert DP.EXPORT_POPUP.startswith("Some of this data came from Google's API.")


def test_source_of_value_reads_the_field_or_says_nothing():
    assert DP.source_of_value({"phone": "website"}, "phone") == "website"
    assert DP.source_of_value({"phone": "website"}, "email") == ""
    assert DP.source_of_value(None, "phone") == ""


def _acc(**kw):
    base = dict(phone="", website="", email="", field_sources=None, raw_data=None, business_record_id="")
    return SimpleNamespace(**{**base, **kw})


def test_a_recorded_source_decides_what_is_restricted():
    a = _acc(phone="0113 496 0101", website="https://own.example", field_sources={"phone": "google_places", "website": "website"})
    assert DP.restricted_fields(a) == {"phone"}
    assert DP.restricted_fields(_acc(phone="0113 496 0101", field_sources={"phone": "apollo"})) == {"phone"}


def test_a_value_with_no_source_is_matched_against_what_google_listed():
    rec = _acc(raw_data={"google_places:g1": {"phone": "+44 113 496 0101", "website": "https://g.example/x"}})
    acc = _acc(phone="0113 496 0101", website="https://www.g.example", email="a@b.co")
    assert DP.restricted_fields(acc, rec) == {"phone", "website"}


def test_a_value_the_company_own_site_also_shows_is_not_restricted():
    raw = {"google_places:g1": {"phone": "0113 496 0101"}, "contacts_web": {"phones": ["0113 496 0101"], "source": "web", "guardrail": True}}
    assert DP.restricted_fields(_acc(phone="0113 496 0101"), _acc(raw_data=raw)) == set()
    raw = {"google_places:g1": {"phone": "0113 496 0101"}, "website_confirmed:g1": {"phone": "0113 496 0101"}}
    assert DP.restricted_fields(_acc(phone="0113 496 0101"), _acc(raw_data=raw)) == set()


def test_apollo_contacts_web_is_restricted_and_labelled_apollo_not_web():
    raw = {"contacts_web": {"phones": ["0113 496 0101"], "source": "apollo", "guardrail": True}}
    assert DP.restricted_fields(_acc(phone="0113 496 0101"), _acc(raw_data=raw)) == {"phone"}
    biz = SimpleNamespace(id="x", website="", domain="", phone="", email="", confidence_tier="", raw_data=raw, shared_research=None)
    assert [(p["kind"], p["source"]) for p in CP.points_of(biz)] == [("phone", "apollo")]
    raw["contacts_web"]["source"] = "web"
    assert [p["source"] for p in CP.points_of(biz)] == ["web"]


def test_record_source_names_the_restricted_source_that_lists_the_value():
    rec = _acc(raw_data={"google_places:g1": {"phone": "0113 496 0101"}, "apollo:a1": {"phone": "0113 222 0000"}, "ds_ch": {"phone": "0113 333 0000"}})
    assert DP.record_source(rec, "phone", "0113 496 0101") == "google_places"
    assert DP.record_source(rec, "phone", "0113 222 0000") == "apollo"
    assert DP.record_source(rec, "phone", "0113 333 0000") == "register"
    assert DP.record_source(rec, "phone", "0113 999 0000") == "register"
    assert DP.record_source(rec, "phone", "0113 999 0000", default="") == ""


def test_google_phone_and_website_are_never_turned_into_a_fix():
    from app.services.company_check import build_fixes

    deep = {"found": True, "phone": "0113 550 0412", "website": "https://new.example"}
    assert build_fixes({"phone": "", "website": "", "email": "", "domain": ""}, deep, {}, "") == []


def test_vouched_keeps_apollo_marked_and_never_google():
    from app.api.lead_accounts import _vouched

    place = {"postcode_match": True, "website": "https://hartsprays.co.uk", "phone": "0113 496 0101"}
    assert _vouched(place, {}) == {}
    got = _vouched({**place, "via": "apollo"}, {})
    assert got["sources"] == {"website": "apollo", "phone": "apollo"}
    own = _vouched(place, {"website": "https://own.example"})
    assert own["website"] == "https://own.example" and own["sources"] == {"website": "website"} and "phone" not in own


def test_purge_cuts_google_entries_to_the_place_id():
    import importlib.util, os

    spec = importlib.util.spec_from_file_location("purge", os.path.join(os.path.dirname(__file__), "..", "scripts", "purge_google_values.py"))
    purge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(purge)
    raw = {"google_places:g1": {"phone": "1", "website": "w", "raw": {"a": 1}}, "ds_ch": {"phone": "keep"},
           "lookup_options": {"phone": [{"value": "0113", "label": "Google lists this for the company"}, {"value": "0114", "label": "Found on the web"}]}}
    cleaned, changed = purge.clean_raw(raw)
    assert cleaned["google_places:g1"] == {"place_id": "g1"} and cleaned["ds_ch"] == {"phone": "keep"}
    assert [o["value"] for o in cleaned["lookup_options"]["phone"]] == ["0114"]
    assert purge.clean_raw(cleaned)[1] == {}  # a second pass changes nothing
