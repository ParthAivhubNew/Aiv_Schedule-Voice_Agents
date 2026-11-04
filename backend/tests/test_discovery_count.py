import pytest

from app.services import enrichment_service as E


def _hits(n, prefix="Alpha"):
    return [{"title": f"{prefix}{i} Accountants Ltd | Reading", "snippet": f"{prefix}{i} Accountants Ltd, chartered accountants in Reading",
             "url": f"https://www.{prefix.lower()}{i}accountants.co.uk/"} for i in range(n)]


async def test_returns_exactly_the_number_asked_for(monkeypatch):
    async def fake(query, max_results=5):
        return _hits(12)

    monkeypatch.setattr(E, "search_open_web", fake)
    found = await E.discover_new_target_accounts("accountants in RG2", count=5)
    assert len(found) == 5


async def test_a_short_first_search_tries_other_wording_and_never_pads(monkeypatch):
    asked = []

    async def fake(query, max_results=5):
        asked.append(query)
        return _hits(2, prefix="Beta" if len(asked) == 1 else "Gamma")

    monkeypatch.setattr(E, "search_open_web", fake)
    found = await E.discover_new_target_accounts("accountants in RG2", count=20)
    assert 2 <= len(found) < 20  # all that exists, no filler
    assert asked[0] == "accountants in RG2" and len(asked) > 1
    assert len({f["name"] for f in found}) == len(found)  # no company twice


async def test_without_a_number_it_is_the_old_short_preview(monkeypatch):
    asked = []

    async def fake(query, max_results=5):
        asked.append(query)
        return _hits(1)

    monkeypatch.setattr(E, "search_open_web", fake)
    await E.discover_new_target_accounts("accountants in RG2")
    assert asked == ["accountants in RG2"]


async def test_household_names_and_social_pages_are_left_out(monkeypatch):
    async def fake(query, max_results=5):
        return [
            {"title": "Deloitte UK | Reading", "snippet": "Deloitte accountants in Reading", "url": "https://www.deloitte.com/uk/reading"},
            {"title": "Smith Accountants Reading | Facebook", "snippet": "Smith Accountants", "url": "https://www.facebook.com/smithaccountants"},
            {"title": "Reading Tax Ltd | Accountants", "snippet": "Reading Tax Ltd accountants", "url": "https://www.readingtax.co.uk/"},
        ]

    monkeypatch.setattr(E, "search_open_web", fake)
    found = await E.discover_new_target_accounts("accountants in RG2", count=10)
    assert [f["name"] for f in found] == ["Reading Tax Ltd"]
    with_big = await E.discover_new_target_accounts("accountants in RG2", count=10, include_big=True)
    assert "Deloitte UK" in [f["name"] for f in with_big] or any("eloitte" in f["name"] for f in with_big)


@pytest.mark.parametrize("url, listed, expected", [
    ("https://www.wix.com/", ("x.com",), False),
    ("https://x.com/acme", ("x.com",), True),
    ("https://www.facebook.com/acme", ("facebook.",), True),
    ("https://acmefacebookfans.co.uk/", ("facebook.",), False),
])
def test_site_list_matches_whole_sites_only(url, listed, expected):
    assert E._on_site_list(url, listed) is expected
