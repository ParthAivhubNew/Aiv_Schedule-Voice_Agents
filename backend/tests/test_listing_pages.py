"""A listing is only ever the exact page of one business: never a directory's home, a category, a search or another business."""
import asyncio

from app.services import listing_pages as L

NAME, PC, AREA = "Acme Plumbing Ltd", "LS1 4AB", "Leeds"


def test_exact_pages_pass_and_lists_do_not():
    ok = ["https://www.yell.com/biz/acme-plumbing-leeds-123/", "https://www.checkatrade.com/trades/acmeplumbing", "https://uk.trustpilot.com/review/acmeplumbing.co.uk",
          "https://www.facebook.com/AcmePlumbing?ref=x", "https://www.linkedin.com/company/acme-plumbing/about/",
          "https://www.tripadvisor.co.uk/Restaurant_Review-g186337-d123456-Reviews-Acme_Cafe-Leeds.html"]
    for u in ok:
        assert L.exact(u, "Acme Plumbing"), u
    bad = ["https://www.yell.com/", "https://www.yell.com/s/plumbers-leeds.html", "https://www.facebook.com/sharer/sharer.php?u=1", "https://www.linkedin.com/search/results",
           "https://www.checkatrade.com/Search/plumber", "https://www.tripadvisor.co.uk/Restaurants-g186337-Leeds.html", "https://www.bark.com/",
           "https://acmeplumbing.co.uk/", "https://www.facebook.com/groups/123"]
    for u in bad:
        assert L.exact(u, "Acme Plumbing") == "", u


def test_unknown_directory_needs_two_path_parts_and_the_name():
    assert L.exact("https://www.bark.com/en/gb/company/acme-plumbing/abc/", "Acme Plumbing")
    assert L.exact("https://www.bark.com/en/gb/company/other-firm/abc/", "Acme Plumbing") == ""
    assert L.exact("https://www.bark.com/categories/acme-plumbing", "Acme Plumbing") == ""


def test_candidates_drop_other_businesses_and_other_places():
    rows = [{"url": "https://www.yell.com/biz/acme-plumbing-leeds-123/", "title": "Acme Plumbing - Leeds", "snippet": "5 High St, Leeds LS1 4AB", "score": 0.8},
            {"url": "https://www.yell.com/biz/other-plumbing-leeds-9/", "title": "Other Plumbing", "snippet": "LS1", "score": 0.9},
            {"url": "https://www.facebook.com/AcmePlumbingLondon", "title": "Acme Plumbing London", "snippet": "London SW1A 1AA", "score": 0.7}]
    got = L.candidates(rows, NAME, PC, AREA)
    assert [c["url"] for c in got] == ["https://www.yell.com/biz/acme-plumbing-leeds-123"]


def test_blocked_site_is_unconfirmed_and_a_read_page_confirms(monkeypatch):
    rows = [{"url": "https://www.facebook.com/AcmePlumbing", "title": "Acme Plumbing", "snippet": "Plumbers in Wakefield", "score": 0.5}]
    got = asyncio.run(L.find(rows, NAME, PC, AREA))
    assert got["confirmed"] is False and got["site"] == "Facebook"  # names the company, shows no place
    rows = [{"url": "https://www.facebook.com/AcmePlumbing", "title": "Acme Plumbing", "snippet": "Leeds. Call 0113 550 0101", "score": 0.5}]
    got = asyncio.run(L.find(rows, NAME, PC, AREA))
    assert got["confirmed"] is True and "search returned" in got["how"] and got["also_seen"]["phones"] == ["0113 550 0101"]

    async def read(url):
        return "Acme Plumbing", "Acme Plumbing, 5 High St, Leeds LS1 4AB. Call 0113 550 0101 or info@acmeplumbing.co.uk"
    monkeypatch.setattr(L, "_read", read)
    rows = [{"url": "https://www.yell.com/biz/acme-plumbing-leeds-123/", "title": "Acme Plumbing", "snippet": "Leeds", "score": 0.5}]
    got = asyncio.run(L.find(rows, NAME, PC, AREA))
    assert got["confirmed"] is True and got["also_seen"]["emails"] == ["info@acmeplumbing.co.uk"]

    async def other(url):
        return "Other Plumbing", "Other Plumbing, Manchester M1 1AA"
    monkeypatch.setattr(L, "_read", other)
    assert asyncio.run(L.find(rows, NAME, PC, AREA)) == {}


def test_search_leaves_out_the_same_sites():
    from app.services import search_recipe as R
    assert "yell.com" in R.EXCLUDE_DOMAINS and "facebook.com" in R.EXCLUDE_DOMAINS and "gov.uk" in R.EXCLUDE_DOMAINS


def test_a_post_or_group_names_whoever_posted_not_the_company():
    for u in ["https://www.facebook.com/TheNews/posts/acme-plumbing-wins", "https://www.facebook.com/groups/123/posts/456", "https://x.com/someone/status/99",
              "https://www.instagram.com/p/DLcCR5eod_5"]:
        assert L.exact(u, "Acme Plumbing") == "", u
    # a post under the company's own page name proves that page: the page is kept, not the post
    assert L.exact("https://www.facebook.com/AcmePlumbing/posts/123", "Acme Plumbing") == "https://www.facebook.com/AcmePlumbing"
    assert L.exact("https://www.facebook.com/AcmePlumbing/about", "Acme Plumbing") == "https://www.facebook.com/AcmePlumbing"
    assert L.exact("https://www.facebook.com/p/Acme-Plumbing-100123", "Acme Plumbing") == "https://www.facebook.com/p/Acme-Plumbing-100123"


# Addresses as the live sites really return them (searched 2026-11-04), one business page each, and the lists beside them.
REAL_OK = [
    "https://www.yell.com/biz/greggs-leeds-6294618", "https://www.checkatrade.com/trades/SouthernGasPlumbingSolutions?v=2",
    "https://ie.trustpilot.com/review/www.pizzaexpress.com", "https://www.tripadvisor.co.uk/Restaurant_Review-g186346-d2589072-Reviews-PizzaExpress-York_North_Yorkshire_England.html",
    "https://www.freeindex.co.uk/profile(nj-plumbing)_328293.htm", "https://bristol.cylex-uk.co.uk/company/broadwalk-dental-surgery-15843309.html",
    "https://www.thomsonlocal.com/search/bakers-shops/leeds/greggs/1337167/01135177598", "https://www.hotfrog.co.uk/company/AL_cxoR1c7qj5UqCO4m3YA/s-fearn-plumbing-and-heating/leeds/heating-air",
    "https://www.hotfrog.co.uk/company/AFk1D6Vxcw6b6RjU76HFJw", "https://www.just-eat.co.uk/restaurants-dominos-leeds-central/menu",
    "https://deliveroo.co.uk/menu/york/york-city-centre/pizzaexpress-york-river-house", "https://www.ubereats.com/gb/store/cowboys/oORJzR6FW0OZvZDoZcW8aw",
    "https://uk.linkedin.com/company/greggs-plc", "https://www.facebook.com/GreggsRestaurants", "https://www.facebook.com/p/Greggs-Market-Place-100083324943147",
    "https://www.instagram.com/pimlicoplumbers", "https://x.com/GreggsOfficial", "https://www.tiktok.com/@greggsofficial",
]
REAL_NO = [
    "https://www.yell.com/s/pizzas-kippax.html", "https://www.freeindex.co.uk/leeds-plumbers.htm", "https://www.freeindex.co.uk/categories/property/construction/plumbing_services",
    "https://bristol.cylex-uk.co.uk/nhs%20dentist.html", "https://www.thomsonlocal.com/search/plumbers/otley-west-yorkshire", "https://www.thomsonlocal.com/search/greggs/normanton-west-yorkshire",
    "https://www.thomsonlocal.com/plumbers", "https://www.hotfrog.co.uk/company/ADSKvOJZdNWX2nCQbuYPLA/same-day-plumber/admin/add",
    "https://www.just-eat.co.uk/takeaway/brands/dominos-pizza/leeds", "https://deliveroo.co.uk/cuisines/pizza-takeaway/york-city-centre", "https://deliveroo.co.uk/brands/pizzaexpress",
    "https://www.ubereats.com/brand/nandos", "https://www.tripadvisor.co.uk/RestaurantsNear-g186346-d2589072-PizzaExpress-York_North_Yorkshire_England.html",
    "https://www.tripadvisor.co.uk/ShowTopic-g1526974-i13335-k10956489-Afternoon_Tea_at_Betty_s_York_or_Harrogate-Yorkshire_E",
    "https://uk.linkedin.com/in/roisin-currie-cbe-6a7a2330", "https://www.linkedin.com/posts/pimlico-plumbers_pimlico-activity-6567",
    "https://www.facebook.com/pimlicoplumbersltd/posts/over-half-a-million-jobs", "https://www.facebook.com/pimlicoplumbersltd/videos/built-for-london",
    "https://www.instagram.com/reel/DKzMFngt0z1", "https://www.instagram.com/p/DTaHTXFjO4G",
    "https://www.tiktok.com/@phoebeisginger1/video/7535910697264270614", "https://www.tiktok.com/tag/greggs",
]


def test_real_addresses_from_each_site():
    for u in REAL_OK:
        assert L.exact(u, "Greggs"), u
    for u in REAL_NO:
        assert L.exact(u, "Greggs") == "", u
    assert L.exact("https://x.com/GreggsOfficial/status/1521798356053512193", "Greggs") == "https://x.com/GreggsOfficial"
