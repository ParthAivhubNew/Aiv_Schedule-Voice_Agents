"""Designed emails: the text is always escaped, only http and https links are made, the footer cannot be removed,
plain campaigns send exactly as before, and a design problem never stops an email."""
import re
from types import SimpleNamespace

import pytest

from app.services import email_design as D
from app.services import email_dispatcher as E

BRAND = {"brand_name": "Acme", "address": "1 High St, Leeds LS1 1AA", "logo_url": "https://acme.example/logo.png", "accent": "#7C3AED"}
MB = SimpleNamespace(email="sales@acme.example", display_name="Acme Sales", aliases=[], signature="Sam\nAcme Ltd")


def _parts(msg):
    return msg.get_body(("plain",)).get_content(), msg.get_body(("html",)).get_content()


def test_the_text_is_escaped_and_only_web_links_are_made():
    page = D.render('Hi <b>x</b> <script>alert(1)</script> [evil](javascript:alert(1)) [ok](https://a.example/c?x=1&y=2)', BRAND)
    assert "<script" not in page.lower() and "<b>" not in page
    assert not re.search(r'href="javascript', page, re.I)
    assert 'href="https://a.example/c?x=1&amp;y=2"' in page


def test_a_line_that_is_only_a_link_becomes_a_button_and_the_plain_part_says_where_it_goes():
    page = D.render("Hello\n\n[Book a call](https://acme.example/book)", BRAND)
    assert "background:#3457D5" in page and "Book a call</a>" in page and 'role="presentation"' in page
    assert D.plain_of("Hello\n\n[Book a call](https://acme.example/book)") == "Hello\n\nBook a call: https://acme.example/book"


def test_a_link_inside_a_sentence_stays_a_link():
    page = D.render("See [our site](https://acme.example) today.", BRAND)
    assert "padding:12px 22px" not in page and ">our site</a>" in page


def test_the_footer_always_has_the_address_and_a_real_unsubscribe_link():
    page = D.render("Hi", BRAND, unsubscribe_link="https://x.example/u/abc", why_link="https://x.example/why", open_marker="https://x.example/o.gif")
    assert "1 High St, Leeds LS1 1AA" in page
    assert re.search(r'<a href="https://x.example/u/abc"[^>]*>Unsubscribe</a>', page)
    assert "Why you got this" in page and "o.gif" in page


def test_a_brand_colour_cannot_change_the_footer_colours():
    page = D.render("Hi", {**BRAND, "text_color": "#FFFFFF", "background": "#FFFFFF"}, unsubscribe_link="#")
    assert 'color:#3B4452;text-decoration:underline">Unsubscribe' in page


def test_the_brand_is_cleaned():
    b = D.clean_brand({"accent": "red", "logo_url": "javascript:alert(1)", "font": "comic", "logo_width": 9999, "address": "x" * 999, "junk": 1})
    assert b["accent"] == D.DEFAULT_BRAND["accent"] and b["logo_url"] == "" and b["font"] == "arial"
    assert b["logo_width"] == 240 and len(b["address"]) == 200 and "junk" not in b


def test_a_brand_needs_an_address_and_weak_contrast_is_warned_about():
    assert D.brand_problems(D.clean_brand({"brand_name": "Acme"}))
    assert not D.brand_problems(D.clean_brand(BRAND))
    assert any("button" in w.lower() for w in D.brand_warnings(D.clean_brand({**BRAND, "button_color": "#FFFF00", "button_text": "#FFFFFF"})))


def test_a_plain_email_is_built_as_before():
    plain, page = _parts(E.build(MB, "to@x.example", "Hi", "Hello\n\nSecond", org_id="org_x"))
    assert "<table" not in page and "<p>Hello</p>" in page
    assert plain.startswith("Hello\n\nSecond\n\nSam\nAcme Ltd") and "Unsubscribe:" in plain


def test_a_designed_email_keeps_the_plain_part_the_headers_and_the_footer():
    msg = E.build(MB, "to@x.example", "Hi", "Hello\n\n[Book](https://acme.example/b)", org_id="org_x", brand=D.clean_brand(BRAND),
                  open_marker="https://x.example/o.gif")
    plain, page = _parts(msg)
    assert "<table" in page and "Book: https://acme.example/b" in plain and "Unsubscribe:" in plain
    assert msg["List-Unsubscribe"] and msg["List-Unsubscribe-Post"]
    assert "Unsubscribe</a>" in page and "o.gif" in page and "Sam" in page


def test_warm_up_mail_is_never_designed():
    plain, page = _parts(E.build(MB, "p@x.example", "Hi", "ping", org_id="org_x", brand=D.clean_brand(BRAND), warmup_id="w1"))
    assert "<table" not in page and "Unsubscribe" not in plain


def test_a_test_send_has_no_real_unsubscribe_token():
    msg = E.build(MB, "sales@acme.example", "Hi", "Hello", org_id="org_x", brand=D.clean_brand(BRAND), unsubscribe_override="#")
    assert msg["List-Unsubscribe"] is None


def test_a_design_that_fails_sends_the_email_plain(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("layout failed")

    monkeypatch.setattr(D, "render", boom)
    plain, page = _parts(E.build(MB, "to@x.example", "Hi", "Hello", org_id="org_x", brand=D.clean_brand(BRAND)))
    assert "<table" not in page and "Unsubscribe:" in plain


@pytest.mark.asyncio
async def test_a_campaign_is_designed_only_when_switched_on_and_the_brand_has_an_address(monkeypatch):
    store = {}

    async def get_doc(db, key):
        return dict(store.get(key, {}))

    async def put_doc(db, key, data):
        store[key] = data

    from app.services import credits

    monkeypatch.setattr(credits, "_get_doc", get_doc)
    monkeypatch.setattr(credits, "_put_doc", put_doc)
    assert await D.brand_for_campaign(None, "org_a", "c1") is None
    await D.save(None, "org_a", brand={"brand_name": "Acme"}, campaigns={"c1": True})
    assert await D.brand_for_campaign(None, "org_a", "c1") is None  # no address yet
    await D.save(None, "org_a", brand=BRAND)
    assert (await D.brand_for_campaign(None, "org_a", "c1"))["brand_name"] == "Acme"
    assert await D.brand_for_campaign(None, "org_a", "c2") is None  # another campaign stays plain
    assert await D.brand_for_campaign(None, "org_b", "c1") is None  # another company has no design
