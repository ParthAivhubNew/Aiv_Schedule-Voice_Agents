"""System mail: one branded design, with the software's own logo attached to each message."""
from app.core import mailer


def test_render_uses_the_logo_and_builds_a_plain_text_copy():
    m = mailer.render("Welcome", ["Hi Sam &#128075;"], {"label": "Go", "url": "https://x.test/a?b=1&c=2"},
                      note="Valid for 3 days.", highlights=[("One", "First thing")])
    assert "cid:brand-logo" in m["html"] and "BY AIVHUB" in m["html"] and "First thing" in m["html"]
    assert "Hi Sam" in m["text"] and "&#" not in m["text"] and "Go: https://x.test/a?b=1&c=2" in m["text"]


async def test_the_logo_travels_inside_the_message(monkeypatch):
    sent = {}
    monkeypatch.setattr(mailer, "configured", lambda: True)
    monkeypatch.setattr(mailer, "_sender", lambda: ("Outreach", "no-reply@example.com"))
    monkeypatch.setattr(mailer, "_send_sync", lambda msg: sent.setdefault("msg", msg))
    m = mailer.render("Hi", ["x"])
    assert (await mailer.send_system_email("a@b.co", "Subject", m["html"], m["text"]))["ok"]
    kinds = [p.get_content_type() for p in sent["msg"].walk()]
    assert kinds == ["multipart/alternative", "text/plain", "multipart/related", "text/html", "image/png"]
    assert sent["msg"].get_body(("html",)) is not None


async def test_a_missing_logo_file_does_not_stop_the_mail(monkeypatch):
    sent = {}
    monkeypatch.setattr(mailer, "configured", lambda: True)
    monkeypatch.setattr(mailer, "_sender", lambda: ("Outreach", "no-reply@example.com"))
    monkeypatch.setattr(mailer, "_send_sync", lambda msg: sent.setdefault("msg", msg))
    monkeypatch.setattr(mailer, "LOGO_FILE", "/nowhere/logo.png")
    m = mailer.render("Hi", ["x"])
    assert (await mailer.send_system_email("a@b.co", "Subject", m["html"], m["text"]))["ok"]
