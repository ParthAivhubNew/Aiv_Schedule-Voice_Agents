"""The test copy (core/test_copy.py): with the live app's keys it still never contacts a real person or changes what the live app uses."""
import json

import httpx
import pytest

from app.core import test_copy as T


@pytest.fixture
def copy_on(monkeypatch):
    monkeypatch.setenv("TEST_COPY", "true")
    monkeypatch.setenv("TEST_COPY_ALLOW_NUMBERS", "+44 7700 900123, 02079460000")
    monkeypatch.setenv("TEST_COPY_ALLOW_EMAILS", "tester@example.com, @aivhub.test")


def body(data):
    return json.dumps(data).encode()


def test_it_is_off_unless_switched_on(monkeypatch):
    monkeypatch.delenv("TEST_COPY", raising=False)
    assert not T.on() and T.install() is False


# ---- what may go out -----------------------------------------------------------------------------------
@pytest.mark.parametrize("url", ["https://api.telnyx.com/v2/call_control_applications/123", "https://api.telnyx.com/v2/ai/assistants/a1",
                                 "https://api.telnyx.com/v2/number_orders", "https://api.telnyx.com/v2/phone_numbers/9"])
def test_nothing_on_the_live_telnyx_account_is_changed(copy_on, url):
    for method in ("POST", "PATCH", "PUT", "DELETE"):
        assert T.decide(method, url, {}, b"{}")


@pytest.mark.parametrize("url", ["https://graph.facebook.com/v21.0/123/feed", "https://api.linkedin.com/rest/posts", "https://api.x.com/2/tweets",
                                 "https://graph.threads.net/v1.0/me/threads_publish", "https://oauth.reddit.com/api/submit", "https://api.x.com/2/oauth2/token",
                                 "https://api.cal.com/v2/bookings", "https://graph.microsoft.com/v1.0/me/sendMail", "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                                 "https://www.googleapis.com/calendar/v3/calendars/primary/events", "https://api.vapi.ai/call", "https://api.retellai.com/v2/create-phone-call",
                                 "https://customer.example.org/webhooks/outreach", "https://login.microsoftonline.com/common/oauth2/v2.0/token"])
def test_posts_messages_bookings_token_refresh_and_webhooks_are_refused(copy_on, url):
    assert T.decide("POST", url, {}, b"{}")


@pytest.mark.parametrize("url", ["https://api.openai.com/v1/chat/completions", "https://api.deepseek.com/chat/completions", "https://api.tavily.com/search",
                                 "https://api.apollo.io/api/v1/mixed_people/search", "https://places.googleapis.com/v1/places:searchText",
                                 "https://queue.fal.run/fal-ai/flux", "https://api.telnyx.com/v2/ai/chat/completions", "https://oauth2.googleapis.com/token"])
def test_providers_that_only_cost_money_work(copy_on, url):
    assert T.decide("POST", url, {}, b"{}") is None


def test_reads_are_allowed_everywhere(copy_on):
    assert T.decide("GET", "https://api.telnyx.com/v2/phone_numbers") is None and T.decide("GET", "https://graph.facebook.com/v21.0/me") is None


def test_a_call_or_text_goes_only_to_an_allowed_number(copy_on):
    calls = "https://api.telnyx.com/v2/calls"
    assert T.decide("POST", calls, {}, body({"to": "+447700900123", "from": "+441234"})) is None
    assert T.decide("POST", calls, {}, body({"to": "07700 900123"})) is None  # the same number written the UK way
    assert T.decide("POST", calls, {}, body({"to": "+447700900999"}))
    assert T.decide("POST", calls, {}, body({"from": "+441234"}))  # no number at all
    assert T.decide("POST", calls, {}, b"not json")
    assert T.decide("POST", "https://api.telnyx.com/v2/messages", {}, body({"to": "+447700900999", "text": "hi"}))
    assert T.decide("POST", "https://api.telnyx.com/v2/messages", {}, body({"to": "+442079460000", "text": "hi"})) is None


def test_actions_on_an_allowed_call_work_but_a_transfer_to_someone_else_does_not(copy_on):
    act = "https://api.telnyx.com/v2/calls/v3:abc/actions/"
    assert T.decide("POST", act + "speak", {}, body({"payload": "hello"})) is None
    assert T.decide("POST", act + "hangup", {}, b"") is None
    assert T.decide("POST", act + "transfer", {}, body({"to": "+447700900999"}))
    assert T.decide("POST", act + "transfer", {}, body({"to": "+447700900123"})) is None


def test_twilio_calls_follow_the_same_numbers(copy_on):
    url = "https://api.twilio.com/2010-04-01/Accounts/AC1/Calls.json"
    assert T.decide("POST", url, {}, b"To=%2B447700900123&From=%2B441") is None
    assert T.decide("POST", url, {}, b"To=%2B447700900999&From=%2B441")
    assert T.decide("POST", "https://api.twilio.com/2010-04-01/Accounts/AC1/IncomingPhoneNumbers.json", {}, b"")


def test_stripe_only_with_a_test_key(copy_on):
    url = "https://api.stripe.com/v1/subscriptions"
    assert T.decide("POST", url, {"Authorization": "Bearer sk_test_123"}, b"") is None
    assert T.decide("POST", url, {"Authorization": "Bearer sk_live_123"}, b"")
    assert T.decide("POST", url, {}, b"")


def test_e_mail_allow_list_takes_addresses_and_domains(copy_on):
    assert T.email_allowed("tester@example.com") and T.email_allowed("Someone <a.b@aivhub.test>")
    assert not T.email_allowed("customer@example.com") and not T.email_allowed("aivhub.test")


def test_empty_allow_lists_let_nothing_out(monkeypatch):
    monkeypatch.setenv("TEST_COPY", "true")
    monkeypatch.delenv("TEST_COPY_ALLOW_NUMBERS", raising=False)
    monkeypatch.delenv("TEST_COPY_ALLOW_EMAILS", raising=False)
    assert T.decide("POST", "https://api.telnyx.com/v2/calls", {}, body({"to": "+447700900123"}))
    assert not T.email_allowed("tester@example.com")


# ---- the guards really stop the request -------------------------------------------------------------------------
@pytest.fixture
def installed(copy_on, monkeypatch):
    import imaplib
    import smtplib

    saved = (httpx.AsyncClient.send, httpx.Client.send, smtplib.SMTP.sendmail, imaplib.IMAP4.__init__)
    monkeypatch.setattr(T, "_installed", False)
    assert T.install() is True
    yield
    httpx.AsyncClient.send, httpx.Client.send, smtplib.SMTP.sendmail, imaplib.IMAP4.__init__ = saved
    T._installed = False


async def test_a_refused_request_never_reaches_the_network_and_an_allowed_one_does(installed):
    seen = []

    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(200, json={"ok": True})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
        with pytest.raises(httpx.RequestError, match="Blocked in the test copy"):
            await c.post("https://graph.facebook.com/v21.0/123/feed", json={"message": "hi"})
        with pytest.raises(httpx.HTTPError):  # callers that catch httpx errors handle it as a failed provider call
            await c.patch("https://api.telnyx.com/v2/call_control_applications/1", json={"webhook_event_url": "https://new.example"})
        assert (await c.post("https://api.openai.com/v1/chat/completions", json={})).status_code == 200
        assert (await c.post("https://api.telnyx.com/v2/calls", json={"to": "+447700900123"})).status_code == 200
    with httpx.Client(transport=httpx.MockTransport(handler)) as c:
        with pytest.raises(httpx.RequestError):
            c.post("https://api.x.com/2/tweets", json={"text": "hi"})
    assert seen == ["https://api.openai.com/v1/chat/completions", "https://api.telnyx.com/v2/calls"]


def test_smtp_refuses_anyone_not_allowed_and_imap_is_never_opened(installed):
    import imaplib
    import smtplib

    smtp = smtplib.SMTP.__new__(smtplib.SMTP)  # never connected: the guard answers before anything is sent
    with pytest.raises(smtplib.SMTPRecipientsRefused):
        smtp.sendmail("us@aivhub.com", ["customer@example.com", "tester@example.com"], "Subject: x\n\nhi")
    with pytest.raises(imaplib.IMAP4.error):
        imaplib.IMAP4_SSL("imap.example.com", 993)


async def test_the_call_gate_refuses_numbers_that_are_not_allowed(copy_on):
    from app.services import compliance

    gate = await compliance.check_call_allowed(None, "+447700900999")
    assert not gate.allowed and "test copy" in gate.reasons[0]


async def test_the_copy_signs_sign_ins_with_its_own_key_so_live_and_copy_sessions_never_mix(copy_on, monkeypatch):
    from app.core import security

    before = security.signing_key()
    real = "a-real-secret-key-that-is-long-enough-1234567890"
    monkeypatch.setattr(security.settings, "SECRET_KEY", real)
    monkeypatch.setattr(security, "configured_key_is_public", lambda: False)
    try:
        await security.resolve_signing_key()
        copy_key = security.signing_key()
        monkeypatch.delenv("TEST_COPY")
        await security.resolve_signing_key()
        assert security.signing_key() == real and copy_key != real
    finally:
        security.set_signing_key(before)
