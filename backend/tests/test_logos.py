"""Where a company's logo is taken from: the logo it declares, the big icons, the homepage's own logo image, then the small icons."""
from app.services import logos as L

BASE = "https://www.example.co.uk/"


def test_the_logo_a_site_declares_for_search_engines_is_taken():
    html = '<script type="application/ld+json">{"@type":"Organization","logo":"/img/logo.png"}</script>'
    assert L._declared_logo(html, BASE) == ["https://www.example.co.uk/img/logo.png"]


def test_a_declared_logo_can_be_a_nested_object_and_svg_is_skipped():
    html = ('<script type="application/ld+json">{"@graph":[{"@type":"Organization","logo":{"@type":"ImageObject","url":"https://cdn.x.com/l.png"}},'
            '{"@type":"WebSite","logo":"/l.svg"}]}</script>')
    assert L._declared_logo(html, BASE) == ["https://cdn.x.com/l.png"]


def test_broken_json_is_ignored_not_an_error():
    assert L._declared_logo('<script type="application/ld+json">{oops</script>', BASE) == []


def test_only_images_that_call_themselves_a_logo_are_taken_from_the_page():
    html = ('<img src="/hero-banner.jpg" alt="Our team"><img src="/assets/site-logo.png" alt="Example">'
            '<img class="header-logo" src="/a.png"><img src="data:image/png;base64,xx" class="logo"><img src="/sprite-logo.png">')
    assert L._logo_images(html, BASE) == ["https://www.example.co.uk/assets/site-logo.png", "https://www.example.co.uk/a.png"]


def test_the_big_icon_is_still_ranked_before_the_small_one():
    html = '<link rel="icon" href="/f.ico"><link rel="apple-touch-icon" sizes="180x180" href="/touch.png">'
    assert L._icon_links(html, BASE)[0] == "https://www.example.co.uk/touch.png"
