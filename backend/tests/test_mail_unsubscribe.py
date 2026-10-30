"""Every system email carries an unsubscribe link and the List-Unsubscribe header; unsubscribing stops notifications but not the emails a person needs."""
import re

import httpx
import pytest

from app.core import mailer
from app.main import app

pytestmark = pytest.mark.db


@pytest.fixture
def sent(monkeypatch):
    box = []
    monkeypatch.setattr(mailer, "configured", lambda: True)
    monkeypatch.setattr(mailer, "_sender", lambda: ("Outreach", "no-reply@example.com"))
    monkeypatch.setattr(mailer, "_send_sync", lambda msg: box.append(msg))
    return box


def _client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _path(url):
    return "/api/mail/" + url.split("/api/mail/")[1]


async def test_every_email_has_the_unsubscribe_link_in_its_footer_the_text_copy_and_the_mail_app_header(db, sent):
    m = mailer.render("Hello", ["Body"])
    assert (await mailer.send_system_email("Pat@Example.com", "Subject", m["html"], m["text"]))["ok"]
    msg = sent[0]
    url = msg["List-Unsubscribe"].strip("<>")
    assert url.startswith("http") and "/api/mail/u/" in url and msg["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    html = msg.get_body(("html",)).get_content()
    assert f'href="{url}"' in html and ">Unsubscribe</a>" in html
    assert html.index(">Unsubscribe</a>") > html.index("You are getting this because")  # in the footer, under the reason line
    assert f"Unsubscribe: {url}" in msg.get_body(("plain",)).get_content()
    assert mailer.read_unsubscribe_token(url.rsplit("/", 1)[1]) == "pat@example.com"


async def test_an_email_written_without_our_design_still_gets_the_link(db, sent):
    await mailer.send_system_email("a@b.co", "Plain", "<html><body><p>Hi</p></body></html>", "Hi")
    html = sent[0].get_body(("html",)).get_content()
    assert "Unsubscribe</a>" in html and html.index("Unsubscribe</a>") < html.index("</body>")
    await mailer.send_system_email("a@b.co", "Bare", "<p>Hi</p>", "Hi")
    assert "Unsubscribe</a>" in sent[1].get_body(("html",)).get_content()


async def test_the_page_changes_nothing_until_the_button_and_then_notifications_stop_but_account_emails_still_arrive(db, sent):
    await mailer.send_system_email("amy@example.com", "First", "<p>x</p>", "x")
    url = _path(sent[0]["List-Unsubscribe"].strip("<>"))
    async with _client() as c:
        page = await c.get(url)
        assert page.status_code == 200 and "amy@example.com" in page.text and "Unsubscribe</button>" in page.text
        assert (await mailer.send_system_email("amy@example.com", "Second", "<p>x</p>", "x"))["ok"]  # opening the page unsubscribed no one
        one_click = await c.post(url)  # what a mail app's own Unsubscribe button sends
        assert one_click.status_code == 200 and "You are unsubscribed" in one_click.text
    skipped = await mailer.send_system_email("amy@example.com", "Third", "<p>x</p>", "x")
    assert skipped["skipped"] and len(sent) == 2
    assert (await mailer.send_account_email("amy@example.com", "Reset your password", "<p>x</p>", "x"))["ok"] and len(sent) == 3  # asked for: still sent
    assert "List-Unsubscribe" in sent[2]  # and it still carries the link
    assert (await mailer.send_system_email("someone.else@example.com", "Other", "<p>x</p>", "x"))["ok"]  # only that address stopped


async def test_subscribing_again_brings_the_emails_back_and_a_bad_link_does_nothing(db, sent):
    await mailer.send_system_email("bo@example.com", "First", "<p>x</p>", "x")
    token = sent[0]["List-Unsubscribe"].strip("<>").rsplit("/", 1)[1]
    async with _client() as c:
        await c.post(f"/api/mail/u/{token}")
        assert "Subscribe again" in (await c.get(f"/api/mail/u/{token}")).text
        assert (await mailer.send_system_email("bo@example.com", "Hidden", "<p>x</p>", "x")).get("skipped")
        assert "subscribed again" in (await c.post(f"/api/mail/s/{token}")).text
        assert (await mailer.send_system_email("bo@example.com", "Back", "<p>x</p>", "x"))["ok"]
        for bad in (token[:-3] + "abc", "nonsense", "YUBiLmNv.0000"):
            assert (await c.get(f"/api/mail/u/{bad}")).status_code == 404 and (await c.post(f"/api/mail/u/{bad}")).status_code == 404
    forged = mailer.unsubscribe_token("victim@example.com")
    assert not re.search(r"victim", mailer.unsubscribe_url("someone@example.com"))  # a link only ever names its own address
    assert mailer.read_unsubscribe_token(forged.replace(forged[-1], "0" if forged[-1] != "0" else "1")) is None


async def test_the_owner_portal_emails_and_security_notices_follow_the_same_rules(db, sent, monkeypatch):
    owner = mailer.render_owner("Alert", ["x"])
    await mailer.send_system_email("owner@example.com", "Alert", owner["html"], owner["text"])
    assert "Unsubscribe</a>" in sent[0].get_body(("html",)).get_content() and "owner portal." in sent[0].get_body(("html",)).get_content()
    from app.core import notify

    async def who(db_, event, only):
        return ["sec@example.com"]

    monkeypatch.setattr(notify, "recipients", who)
    async with _client() as c:
        await c.post(_path(sent[0]["List-Unsubscribe"].strip("<>")).replace("owner", "owner"))  # owner address opts out
    token_sec = mailer.unsubscribe_token("sec@example.com")
    async with _client() as c:
        await c.post(f"/api/mail/u/{token_sec}")
    await notify._send_all("security", ["sec@example.com"], "Security change", ["Your password changed."], None)
    await notify._send_all("billing", ["sec@example.com"], "A notice", ["Something."], None)
    assert [m["Subject"] for m in sent[1:]] == ["Security change"]  # the security notice arrives, the ordinary notice does not
