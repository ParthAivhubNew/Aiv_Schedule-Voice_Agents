"""Every contact a company record holds becomes one comparable row, from every place the record keeps one."""
from types import SimpleNamespace as NS

from app.services import contact_points as CP


def _biz(**kw):
    base = dict(id="biz_1", website="", domain="", phone="", email="", confidence_tier="scraped", raw_data=None, shared_research=None)
    base.update(kw)
    return NS(**base)


def _kv(points):
    return {(p["kind"], p["norm"]) for p in points}


def test_the_same_page_written_differently_is_one_contact():
    forms = ["https://www.linkedin.com/company/acme-ltd/", "http://linkedin.com/company/acme-ltd?trk=x", "linkedin.com/company/Acme-Ltd/about"]
    assert len({CP.norm("linkedin", f) for f in forms}) == 1
    assert CP.norm("facebook", "https://www.facebook.com/acmeltd/?ref=bookmarks") == CP.norm("facebook", "facebook.com/acmeltd")
    assert CP.norm("x", "https://twitter.com/acme") == CP.norm("x", "https://x.com/acme")


def test_a_page_of_another_network_or_a_bare_site_is_not_accepted():
    assert CP.norm("linkedin", "https://facebook.com/acme") == ""
    assert CP.norm("linkedin", "https://linkedin.com/") == ""
    assert CP.norm("email", "not an email") == "" and CP.norm("phone", "123") == ""


def test_a_website_is_compared_by_its_domain_and_a_phone_by_its_digits():
    assert CP.norm("website", "https://www.Acme.co.uk/contact") == "acme.co.uk"
    assert CP.norm("phone", "+44 (0)113 496 0101") == CP.norm("phone", "0113 496 0101")


def test_points_are_read_from_every_place_a_record_keeps_them():
    biz = _biz(
        website="https://acme.example", phone="0113 496 0101", email="hello@acme.example", confidence_tier="verified_registry",
        raw_data={
            "contacts_web": {"website": "https://acme.example", "phones": ["0113 496 0102"], "emails": [{"value": "sales@acme.example"}],
                             "team": [{"name": "Priya Shah", "email": "priya@acme.example"}]},
            "linkedin": {"company": {"url": "https://linkedin.com/company/acme"}, "people": {"Priya Shah": {"url": "https://linkedin.com/in/priya-shah", "by": "users"}}},
            "socials": {"facebook": {"url": "https://facebook.com/acme"}, "x": {"url": "https://x.com/acme"}},
            "apollo:apollo_1": {"website_url": "https://acme.example", "linkedin_url": "http://www.linkedin.com/company/acme", "facebook_url": "https://www.facebook.com/acme"},
            "ds_cqc": {"Phone number": "0113 496 0103", "Location URL": "https://www.cqc.org.uk/location/1-1"},
        },
        shared_research={"phones": ["0113 496 0104"], "emails": ["research@acme.example"], "socials": {"instagram": "https://instagram.com/acme"}},
    )
    got = _kv(CP.points_of(biz))
    for expected in [("website", "acme.example"), ("phone", "1134960101"), ("phone", "1134960102"), ("phone", "1134960103"), ("phone", "1134960104"),
                     ("email", "hello@acme.example"), ("email", "sales@acme.example"), ("email", "priya@acme.example"), ("email", "research@acme.example"),
                     ("linkedin", "linkedin/company/acme"), ("linkedin", "linkedin/in/priya-shah"), ("facebook", "facebook/acme"), ("x", "x/acme"),
                     ("instagram", "instagram/acme")]:
        assert expected in got, expected
    assert not any("cqc.org.uk" in n for _, n in got)  # the register's own "Location URL" is not the company's website


def test_one_row_per_contact_and_the_strongest_claim_wins():
    biz = _biz(phone="0113 496 0101", confidence_tier="verified_registry", raw_data={"contacts_web": {"phones": ["+44 113 496 0101"]}})
    phones = [p for p in CP.points_of(biz) if p["kind"] == "phone"]
    assert len(phones) == 1 and phones[0]["confidence"] == "register"


def test_a_picked_contact_is_marked_as_picked():
    biz = _biz(raw_data={"contacts_web": {"by": "pick", "phones": ["0113 496 0105"]}})
    assert [p["confidence"] for p in CP.points_of(biz) if p["kind"] == "phone"] == ["picked"]


def test_an_empty_or_odd_record_gives_nothing_and_never_raises():
    assert CP.points_of(_biz()) == []
    assert CP.points_of(_biz(raw_data={"contacts_web": "x", "linkedin": [], "socials": {"facebook": None}, "weird": 5})) == []


def test_a_bulk_batch_becomes_contact_rows_for_new_and_refreshed_companies_alike():
    values = [
        {"identity_hash": "h1", "website": "https://acme.example", "phone": "0113 496 0101", "email": "", "domain": "acme.example", "confidence_tier": "verified_registry",
         "raw_data": {"ds_x": {"Phone number": "0113 496 0102", "Location URL": "https://regulator.example/1"}}},
        {"identity_hash": "h2", "website": "", "phone": "", "email": "", "domain": "", "confidence_tier": "verified_registry", "raw_data": {"ds_x": {}}},
        {"identity_hash": "h3", "website": "https://beta.example", "phone": "", "email": "", "domain": "beta.example", "confidence_tier": "verified_registry", "raw_data": {}},
    ]
    rows = CP.rows_for_bulk(values, {"h1": "biz_a", "h3": "biz_b"})  # h2 has nothing, and is not in the id map
    got = {(r["business_record_id"], r["kind"], r["norm"]) for r in rows}
    assert ("biz_a", "website", "acme.example") in got and ("biz_a", "phone", "1134960101") in got and ("biz_a", "phone", "1134960102") in got
    assert ("biz_b", "website", "beta.example") in got
    assert not any("regulator" in n for _, _, n in got)
    assert len({r["id"] for r in rows}) == len(rows)
