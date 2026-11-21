"""Phone numbers read from a company's own website: parsing on saved pages, link discovery, page cap. No network."""
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import site_phones as SP

FIX = Path(__file__).parent / "fixtures" / "site_phones"


def page(name):
    return (FIX / name).read_text(encoding="utf-8")


def numbers(name, base="https://example.co.uk/"):
    return [c["number"] for c in SP.extract_from_html(page(name), base)]


def test_tel_link_beats_text_and_script_numbers_are_ignored():
    got = SP.extract_from_html(page("tel_links.html"), "https://example.co.uk/")
    assert [(c["number"], c["via"], c["kind"]) for c in got] == [("+441273733112", "tel", "landline")]
    assert got[0]["display"] == "01273 733112" and got[0]["source_url"] == "https://example.co.uk/"


def test_jsonld_telephone_kept_and_fax_number_dropped():
    got = SP.extract_from_html(page("jsonld.html"), "https://x.co.uk/")
    assert [(c["number"], c["via"]) for c in got] == [("+441273733214", "jsonld")]


def test_microdata():
    assert [(c["number"], c["via"]) for c in SP.extract_from_html(page("microdata.html"))] == [("+441273733316", "microdata")]


def test_footer_only_and_company_number_not_a_phone():
    got = SP.extract_from_html(page("footer_only.html"))
    assert [(c["number"], c["via"]) for c in got] == [("+441273733418", "footer")]


def test_text_only_with_spacing_and_vat_ignored():
    got = SP.extract_from_html(page("text_only.html"))
    assert [(c["number"], c["via"]) for c in got] == [("+441273733520", "text")]


def test_fax_lines_dropped_including_tel_link_marked_fax():
    assert numbers("fax_line.html") == ["+441273733622"]


def test_premium_and_freephone_dropped_landline_kept():
    assert numbers("premium.html") == ["+441179251234"]


def test_several_numbers_deduped_classified_and_ordered():
    got = SP.extract_from_html(page("several.html"))
    assert [(c["number"], c["kind"], c["via"]) for c in got] == [
        ("+447911123456", "mobile", "tel"),
        ("+441179251234", "landline", "footer"),  # also in the body text; the better way wins
        ("+441212345678", "landline", "text"),
    ]


def test_non_uk_numbers_dropped():
    assert numbers("non_uk.html") == []


def test_obfuscated_spacing_and_bracketed_zero():
    assert numbers("obfuscated.html") == ["+441273555012", "+441612345678", "+441179251234", "+447911123789"]


@pytest.mark.parametrize("raw,want", [
    ("01273 733112", "+441273733112"), ("(0)1273 733112", "+441273733112"), ("+44 (0)1273 733112", "+441273733112"),
    ("0044 1273 733112", "+441273733112"), ("07911 123456", "+447911123456"), ("0333 123 4567", "+443331234567"),
])
def test_normalise_accepts(raw, want):
    assert SP.normalise(raw)["number"] == want


@pytest.mark.parametrize("raw", [
    "0906 123 4567", "0800 123 4567", "0845 123 4567", "01273 111111", "01111 111111", "0127 3733", "01273 733 1122 5",
    "020 7946 0123", "07700 900123", "+1 415 555 2671", "070 1234 5678", "", "abc",
])
def test_normalise_rejects(raw):
    assert SP.normalise(raw) is None


def test_contact_link_discovery_same_site_only():
    links = SP.contact_links(page("home_with_contact_link.html"), "https://www.oak.co.uk/")
    assert links == ["https://www.oak.co.uk/pages/get-in-touch"]


class FakeClient:
    def __init__(self, pages):
        self.pages, self.calls = pages, []

    async def get(self, url):
        self.calls.append(url)
        body = self.pages.get(url)
        if body is None:
            return SimpleNamespace(status_code=404, text="", url=url)
        return SimpleNamespace(status_code=200, text=body, url=url)


async def test_find_phones_follows_contact_link_and_records_source_page():
    client = FakeClient({"https://oak.co.uk": page("home_with_contact_link.html"),
                         "https://oak.co.uk/pages/get-in-touch": page("contact_page.html")})
    got = await SP.find_phones("oak.co.uk", client=client)
    assert [(c["number"], c["via"], c["source_url"]) for c in got] == [("+441273733700", "tel", "https://oak.co.uk/pages/get-in-touch")]
    assert got[0]["found_on"] and client.calls[1] == "https://oak.co.uk/pages/get-in-touch"


async def test_find_phones_never_reads_more_than_four_pages():
    home = "<html><body>" + "".join(f'<a href="/contact-{i}">Contact {i}</a>' for i in range(10)) + "</body></html>"
    client = FakeClient({"https://big.co.uk": home})
    assert await SP.find_phones("https://big.co.uk", client=client) == []
    assert len(client.calls) == SP.MAX_PAGES


async def test_find_phones_tries_fixed_contact_paths_and_merges_pages():
    client = FakeClient({"https://a.co.uk": page("footer_only.html"), "https://a.co.uk/contact": page("several.html")})
    got = await SP.find_phones("https://a.co.uk", client=client)
    assert {c["number"] for c in got} == {"+441273733418", "+447911123456", "+441179251234", "+441212345678"}
    assert got[0]["via"] == "tel" and got[0]["source_url"] == "https://a.co.uk/contact"
    assert len(client.calls) <= SP.MAX_PAGES


async def test_find_phones_dead_site_and_empty_url():
    assert await SP.find_phones("", client=FakeClient({})) == []
    assert await SP.find_phones("https://dead.co.uk", client=FakeClient({})) == []


def test_save_on_record_sets_phone_only_when_empty_and_keeps_source():
    found = [{"number": "+441273733112", "display": "01273 733112", "kind": "landline", "source_url": "https://x.co.uk/contact",
              "found_on": "2026-11-21", "via": "tel"}]
    biz = SimpleNamespace(phone="", raw_data={"contacts_web": {"a": 1}})
    assert SP.save_on_record(biz, found) is True
    assert biz.phone == "01273 733112" and biz.raw_data["contacts_web"] == {"a": 1}
    assert biz.raw_data["phone_source"] == {"source": "website", "url": "https://x.co.uk/contact", "found_on": "2026-11-21", "via": "tel"}
    assert biz.raw_data["site_phones"]["source"] == "website"
    has = SimpleNamespace(phone="020 7123 4567", raw_data=None)
    SP.save_on_record(has, found)
    assert has.phone == "020 7123 4567" and "phone_source" not in has.raw_data
    assert SP.save_on_record(SimpleNamespace(phone="", raw_data=None), []) is False


def _script(name):
    import importlib.util

    spec = importlib.util.spec_from_file_location(name, Path(__file__).parent.parent / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_sample_scoring_recall_and_wrong_numbers():
    mod = _script("check_phone_sample")
    rows = [
        {"company": "A", "website": "a.uk", "numbers_found": "01273 733112 | 0117 925 1234", "visible_on_site": "+44 1273 733112 | 0117 925 1234"},
        {"company": "B", "website": "b.uk", "numbers_found": "01273 733214", "visible_on_site": "0161 234 5678"},
        {"company": "C", "website": "c.uk", "numbers_found": "", "visible_on_site": "none"},
        {"company": "D", "website": "d.uk", "numbers_found": "01273 733316", "visible_on_site": ""},  # not reviewed yet
    ]
    res = mod.score(rows)
    assert (res["reviewed"], res["visible"], res["found_of_visible"], res["wrong"]) == (3, 3, 2, 1)
    assert round(res["recall"], 3) == 0.667 and res["wrong_rows"][0][0] == "B"


def test_rerun_script_requires_a_scope_and_defaults_to_dry_run():
    mod = _script("rerun_site_phones")
    with pytest.raises(SystemExit):
        mod.parse_args([])
    a = mod.parse_args(["--district", "bn14, BN15"])
    assert a.districts == ["BN14", "BN15"] and a.apply is False
    assert mod.parse_args(["--all-districts", "--apply"]).apply is True
    assert all(d in mod.FSB_DISTRICTS.split(",") for d in ("BN14", "BN15", "BN16", "BN17", "BN18", "BN20", "BN22", "BN26", "BN27", "BN43"))
