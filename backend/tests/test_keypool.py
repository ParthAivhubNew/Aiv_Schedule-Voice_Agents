"""The shared key pool (app/providers/keypool.py): main key then backups, a refused or exhausted key set aside and the request sent to
the next one, one log row per request with only the key's last four characters."""
import pytest

from app.providers.keypool import KeyPool, Verdict, retry_after


class Resp:
    def __init__(self, status, text=""):
        self.status_code, self.text, self.headers = status, text, {}


def pool(main="main-key-aaaa", backups=(), cool=None):
    logged = []

    async def main_key():
        return main

    def row(entry, purpose, looked_for, status, outcome, **extra):
        logged.append({"key_id": entry[0], "tail": entry[2][-4:], "purpose": purpose, "status": status, "outcome": outcome, **extra})
        return None

    p = KeyPool(name="t", backups_doc="t_backups", main_key=main_key, main_label="Main", log_row=row, cool=cool if cool is not None else {})

    async def fake_backups():
        return list(backups)

    async def fake_log(entry, purpose, looked_for, status, outcome, **extra):
        row(entry, purpose, looked_for, status, outcome, **extra)

    p.backups, p.log = fake_backups, fake_log
    return p, logged


def judge(entry, r):
    if r.status_code == 402:
        return Verdict("key_exhausted", set_aside=True, seconds=1800)
    if r.status_code == 403:
        return Verdict("refused", set_aside=True, seconds=1800, scope=f"{entry[0]}:people")
    return Verdict("found" if r.status_code == 200 else "error")


async def test_an_exhausted_key_is_set_aside_and_the_backup_answers(monkeypatch):
    from app.services import secret_box

    monkeypatch.setattr(secret_box, "open_secret", lambda v: v)
    p, logged = pool(backups=[{"id": "b1", "label": "Backup", "sealed": "backup-key-bbbb"}])
    answers = {"main-key-aaaa": Resp(402), "backup-key-bbbb": Resp(200)}

    async def send(entry):
        return answers[entry[2]]

    r = await p.run(send, judge, purpose="people")
    assert r.status_code == 200
    assert [(x["key_id"], x["outcome"]) for x in logged] == [("main", "key_exhausted"), ("b1", "found")]
    assert all("key" not in str(x["tail"]) for x in logged) and logged[0]["tail"] == "aaaa"  # only the last four characters are logged
    assert p.cooling_for("main") > 0
    logged.clear()
    await p.run(send, judge, purpose="people")
    assert [x["key_id"] for x in logged] == ["b1"]  # the set-aside key isn't asked again for a while


async def test_a_key_refused_for_one_kind_of_request_still_serves_the_others():
    p, logged = pool()

    async def send(entry):
        return Resp(403)

    assert (await p.run(send, judge, purpose="people", skip_scopes=lambda e: [e[0], f"{e[0]}:people"])).status_code == 403
    assert p.cooling_for("main:people") > 0 and p.cooling_for("main") == 0

    async def ok(entry):
        return Resp(200)

    assert (await p.run(ok, judge, purpose="company", skip_scopes=lambda e: [e[0], f"{e[0]}:company"])).status_code == 200


async def test_no_key_means_no_request_and_a_network_error_is_logged_and_raised():
    p, logged = pool(main="")
    calls = []

    async def send(entry):
        calls.append(entry)
        return Resp(200)

    assert await p.run(send, judge, purpose="x") is None and calls == []
    p2, logged2 = pool()

    async def boom(entry):
        raise ConnectionError("down")

    with pytest.raises(ConnectionError):
        await p2.run(boom, judge, purpose="x")
    assert logged2[0]["outcome"] == "error" and logged2[0]["status"] is None


def test_retry_after_is_kept_within_bounds():
    assert retry_after({"Retry-After": "5"}, 90) == 30 and retry_after({"retry-after": "120"}, 90) == 120
    assert retry_after({}, 90) == 90 and retry_after({"Retry-After": "999999"}, 90) == 86400
