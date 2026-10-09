"""Social login renewal: who can renew, when, what a refusal does, and staff-only alerts (no database)."""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from app.services import social_tokens as T


class FakeDB:
    def __init__(self):
        self.commits = 0

    async def refresh(self, obj):
        pass

    async def commit(self):
        self.commits += 1


def _acct(platform="x", expires_in_min=5, refresh="rt-old", status="connected", **kw):
    return SimpleNamespace(
        id=f"acc_{platform}", platform=platform, access_token="at-old", refresh_token=refresh, token_secret="",
        extra={}, status=status, last_error="", handle="@h", org_id="org1",
        expires_at=None if expires_in_min is None else datetime.utcnow() + timedelta(minutes=expires_in_min), **kw)


def _stub_call(monkeypatch, status, body, calls=None):
    async def fake_app(db, plat):
        return {"clientId": "cid", "clientSecret": "sec", "redirectUri": "", "callbackUrl": ""}

    async def fake_call(method, url, **kw):
        if calls is not None:
            calls.append((method, url, kw))
        return status, body

    monkeypatch.setattr(T, "get_oauth_app", fake_app)
    monkeypatch.setattr(T, "_token_call", fake_call)


def test_who_can_renew_and_health():
    assert T.can_refresh(_acct("x")) and not T.can_refresh(_acct("x", refresh=""))
    assert not T.can_refresh(_acct("linkedin", refresh=""))  # LinkedIn without a refresh token: reconnect only
    assert T.can_refresh(_acct("threads", refresh=""))
    assert not T.can_refresh(_acct("facebook")) and not T.can_refresh(_acct("instagram"))
    assert T.health(_acct("x", expires_in_min=None)) == "ok"  # no known expiry (page tokens, pasted tokens)
    assert T.health(_acct("x", expires_in_min=-1)) == "expired"
    assert T.health(_acct("x", expires_in_min=60 * 24 * 3)) == "expiring"
    assert T.health(_acct("x", expires_in_min=60 * 24 * 30)) == "ok"


async def test_fresh_token_is_left_alone(monkeypatch):
    calls = []
    _stub_call(monkeypatch, 200, {}, calls)
    res = await T.ensure_fresh_token(FakeDB(), _acct("x", expires_in_min=120))
    assert res == {"ok": True, "refreshed": False} and calls == []
    # No expiry known (e.g. a Facebook page token): never called.
    assert (await T.ensure_fresh_token(FakeDB(), _acct("facebook", expires_in_min=None)))["refreshed"] is False
    assert calls == []


async def test_x_renewal_stores_the_new_tokens_and_expiry(monkeypatch):
    calls = []
    _stub_call(monkeypatch, 200, {"access_token": "at-new", "refresh_token": "rt-new", "expires_in": 7200}, calls)
    db, acc = FakeDB(), _acct("x", expires_in_min=2, status="expired")
    res = await T.ensure_fresh_token(db, acc)
    assert res["ok"] and res["refreshed"] and db.commits == 1
    assert T.account_access_token(acc) == "at-new" and T._refresh_token(acc) == "rt-new"
    assert acc.status == "connected" and acc.last_error == ""
    assert timedelta(minutes=110) < acc.expires_at - datetime.utcnow() <= timedelta(hours=2)
    method, url, kw = calls[0]
    assert method == "POST" and "oauth2/token" in url and kw["data"]["grant_type"] == "refresh_token"
    assert kw["data"]["refresh_token"] == "rt-old" and kw["headers"]["Authorization"].startswith("Basic ")


async def test_threads_renews_with_its_own_token(monkeypatch):
    calls = []
    _stub_call(monkeypatch, 200, {"access_token": "th-new", "expires_in": 5184000}, calls)
    acc = _acct("threads", refresh="", expires_in_min=60)
    assert (await T.ensure_fresh_token(FakeDB(), acc, within=T.REFRESH_AHEAD))["refreshed"]
    assert calls[0][0] == "GET" and calls[0][2]["params"]["grant_type"] == "th_refresh_token"
    assert T.account_access_token(acc) == "th-new"


async def test_refusal_marks_expired_but_a_network_error_does_not(monkeypatch):
    _stub_call(monkeypatch, 400, {"error": "invalid_grant"})
    db, acc = FakeDB(), _acct("x", expires_in_min=1)
    res = await T.ensure_fresh_token(db, acc)
    assert not res["ok"] and acc.status == "expired" and "Reconnect" in acc.last_error and db.commits == 1

    _stub_call(monkeypatch, 503, {})
    db, acc = FakeDB(), _acct("x", expires_in_min=1)
    res = await T.ensure_fresh_token(db, acc)
    assert not res["ok"] and acc.status == "connected" and db.commits == 0  # try again later

    async def boom(method, url, **kw):
        raise RuntimeError("dns")

    monkeypatch.setattr(T, "_token_call", boom)
    acc = _acct("x", expires_in_min=1)
    assert not (await T.ensure_fresh_token(FakeDB(), acc))["ok"] and acc.status == "connected"


async def test_unrenewable_login_is_ok_until_it_actually_ends():
    still = await T.ensure_fresh_token(FakeDB(), _acct("linkedin", refresh="", expires_in_min=5))
    assert still["ok"] is True
    ended = await T.ensure_fresh_token(FakeDB(), _acct("linkedin", refresh="", expires_in_min=-5))
    assert ended["ok"] is False and "Reconnect" in ended["error"]


async def test_alerts_go_to_staff_once_and_not_to_customers(monkeypatch):
    store, sent = {}, []

    async def get_doc(db, key):
        return dict(store.get(key, {}))

    async def put_doc(db, key, data):
        store[key] = data

    async def staff():
        return ["owner@aivhub.test"]

    async def send(to, subject, html, text):
        sent.append((to, subject, text))

    async def names(db):
        return {"org1": "Acme Ltd"}

    import app.core.mailer as mailer
    import app.services.ai_errors as ai_errors
    import app.services.platform_balances as pb

    monkeypatch.setattr(pb, "_get_doc", get_doc)
    monkeypatch.setattr(pb, "_put_doc", put_doc)
    monkeypatch.setattr(ai_errors, "_staff_emails", staff)
    monkeypatch.setattr(mailer, "send_system_email", send)
    monkeypatch.setattr(T, "_org_names", names)

    problems = [{"account": _acct("linkedin", refresh="", expires_in_min=60 * 24 * 2), "state": "expiring", "error": ""}]
    assert await T.alert_staff(FakeDB(), problems) == 1
    assert [s[0] for s in sent] == ["owner@aivhub.test"] and "Acme Ltd" in sent[0][2]
    assert await T.alert_staff(FakeDB(), problems) == 0  # same state, inside the quiet period
    assert len(sent) == 1
    problems[0]["state"] = "expired"  # got worse: say so
    assert await T.alert_staff(FakeDB(), problems) == 1
