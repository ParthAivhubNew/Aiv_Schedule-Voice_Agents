"""Calls never run past the minutes paid for: a warning before a call shorter than the company's
average, a call that holds its minutes and is charged what it used when it ends, call lists that
pause at zero and carry on after a top-up, and numbers that stop taking calls at zero."""
import pytest

from app.services import telnyx_client

pytestmark = pytest.mark.db


async def _voice(db, amount, durations=()):
    from app.models.models import CallLog
    from app.services import credits as K

    await K.set_org_settings(db, {"enforce": True})
    if amount:
        await K.add_credits(db, "voice", amount, source="topup")
    for i, d in enumerate(durations):
        db.add(CallLog(id=f"cl_old{i}", canonical_name="X", listed_as="X", channel="voice", started_at="", ended_at="",
                       duration=d, outcome="ended"))
    await db.commit()


async def test_warned_before_a_call_shorter_than_the_average(client, db):
    from app.services import credits as K

    await _voice(db, 3, ["05:00", "04:10"])  # average 5 minutes, 3 left
    assert await K.average_call_minutes(db) == 5
    w = await K.short_call_warning(db)
    assert w["code"] == "LOW_MINUTES" and w["minutesLeft"] == 3 and "end after 3 minutes" in w["message"]

    r = await client.post("/api/telnyx-assistant/dial", json={"to": "+447700900123"})
    assert r.status_code == 409 and r.json()["code"] == "LOW_MINUTES"
    r = await client.post("/api/calls/outbound/batch", json={"prospects": [{"phone": "+447700900123"}, {"phone": "+447700900124"}]})
    assert r.status_code == 409 and "list will pause" in r.json()["detail"]["message"]

    await K.add_credits(db, "voice", 20, source="topup")
    await db.commit()
    assert await K.short_call_warning(db) is None


async def test_a_call_holds_its_minutes_and_is_charged_what_it_used(db):
    from app.services import credits as K
    from app.services.call_log_writer import log_id_for_call

    await _voice(db, 10)
    ok, why, limit = await K.reserve_call(db, "call_a")
    await db.commit()
    assert ok and limit == 600  # all 10 minutes, no grace
    assert await K.minutes_left(db) == 0
    assert (await K.reserve_call(db, "call_b"))[:2] == (False, K.out_of_credits("voice"))

    await K.charge_finished_call(db, "call_a", "02:10", "Ann")  # 3 minutes, rounded up
    assert await K.minutes_left(db) == 7
    entries = [h for h in await K.history(db) if h["kind"] == "usage"]
    assert [(e["item"], e["amount"]) for e in entries] == [("voice_minute", -3)]

    # settle never charges it twice (its call log carries the same reference).
    from app.models.models import CallLog

    db.add(CallLog(id=log_id_for_call("call_a"), canonical_name="Ann", listed_as="Ann", channel="voice",
                   started_at="", ended_at="", duration="02:10", outcome="ended"))
    await db.commit()
    await K.settle(db)
    await K.settle(db)
    assert await K.minutes_left(db) == 7


async def test_settle_gives_back_the_hold_of_a_call_that_ended(db):
    from app.models.models import LiveCall
    from app.services import credits as K

    await _voice(db, 5)
    await K.reserve_call(db, "call_gone")
    db.add(LiveCall(id="call_live", prospect="P", mission="M", state="pitching", ended=False))
    await K.reserve_call(db, "call_live")  # nothing left for it: refused, no hold
    await db.commit()
    await K.settle(db)  # first run only starts tracking
    await K.settle(db)
    assert await K.minutes_left(db) == 5  # call_gone never reached the board: its hold is given back


async def test_call_list_pauses_at_zero_and_carries_on_after_a_top_up(db, monkeypatch):
    from sqlalchemy.future import select

    from app.models.models import Mission, Notification, Prospect
    from app.services import credits as K
    from app.services import outbound_dial as O

    async def nothing(*a, **k):
        return None

    monkeypatch.setattr(O.call_hub, "broadcast", nothing)
    monkeypatch.setattr(O, "drain_mission_queue", nothing)
    await _voice(db, 0)
    db.add(Mission(id="m_list", title="Leeds list", status="active", concurrency=2))
    db.add(Prospect(id="p_1", mission_id="m_list", name="A", phone="+447700900123", status="queued"))
    await db.commit()

    assert await O.start_mission_dials("m_list") == []
    db.expire_all()
    m = (await db.execute(select(Mission).where(Mission.id == "m_list"))).scalars().first()
    assert m.status == O.PAUSED_FOR_CREDITS
    assert (await db.execute(select(Prospect).where(Prospect.id == "p_1"))).scalars().first().status == "queued"
    assert any("paused" in n.text for n in (await db.execute(select(Notification))).scalars().all())

    await K.add_credits(db, "voice", 10, source="topup")
    await db.commit()
    assert await O.resume_paused_missions(db) == 1
    db.expire_all()
    assert (await db.execute(select(Mission).where(Mission.id == "m_list"))).scalars().first().status == "active"


class _Numbers:
    def __init__(self, managed_ok=True):
        self.calls = []
        self.conn = {"pn_1": "cca_in"}
        self.managed_ok = managed_ok

    async def __call__(self, client, method, path, *, params=None, json=None, files=None, data=None):
        self.calls.append((method, path, json))
        if "/managed_accounts/" in path:
            if not self.managed_ok:
                raise telnyx_client.TelnyxError("not a manager account", 403)
            return {"data": {}}
        num = path.rsplit("/", 1)[-1]
        if method == "PATCH":
            self.conn[num] = json["connection_id"]
        return {"data": {"id": num, "connection_id": self.conn.get(num, "")}}


async def _setup(db, monkeypatch, fake, mode="billing_group"):
    from app.models.models import OrgPhoneNumber, OrgTelnyx
    from app.services.secret_box import seal_secret

    monkeypatch.setenv("TELNYX_API_KEY", "KEY_TEST")
    monkeypatch.setattr(telnyx_client.TelnyxClient, "_req", lambda self, *a, **k: fake(self, *a, **k))
    db.add(OrgTelnyx(id="org_default", mode=mode, status="ready", managed_account_id="ma_1",
                     api_key_sealed=seal_secret("KEY_MANAGED")))
    db.add(OrgPhoneNumber(id="num_1", e164="+442071234567", provider="telnyx", provider_ref="pn_1", status="active"))
    await db.commit()


async def test_numbers_stop_taking_calls_at_zero_and_come_back_after_a_top_up(db, monkeypatch):
    from app.services import credits as K
    from app.services import voice_access

    fake = _Numbers()
    await _setup(db, monkeypatch, fake)
    await _voice(db, 0)
    assert await voice_access.sync(db) == "off"
    assert fake.conn["pn_1"] == ""  # detached: calls to it go nowhere
    assert await voice_access.sync(db) == ""  # already off

    await K.add_credits(db, "voice", 10, source="topup")
    await db.commit()
    assert await voice_access.sync(db) == "on"
    assert fake.conn["pn_1"] == "cca_in"  # back on the app it was on
    assert await voice_access._off_state(db) == {}


async def test_managed_account_is_disabled_or_its_numbers_detached(db, monkeypatch):
    from app.services import credits as K
    from app.services import voice_access

    fake = _Numbers()
    await _setup(db, monkeypatch, fake, mode="managed_account")
    await _voice(db, 0)
    assert await voice_access.sync(db) == "off"
    assert ("POST", "/managed_accounts/ma_1/actions/disable", None) in fake.calls
    assert fake.conn["pn_1"] == "cca_in"  # the account is off; numbers left alone
    await K.add_credits(db, "voice", 10, source="topup")
    await db.commit()
    assert await voice_access.sync(db) == "on"
    assert ("POST", "/managed_accounts/ma_1/actions/enable", None) in fake.calls

    # Telnyx refuses to disable the account: the numbers are detached instead.
    fake2 = _Numbers(managed_ok=False)
    monkeypatch.setattr(telnyx_client.TelnyxClient, "_req", lambda self, *a, **k: fake2(self, *a, **k))
    await K.remove_credits(db, "voice", 10)
    await db.commit()
    assert await voice_access.sync(db) == "off"
    assert fake2.conn["pn_1"] == ""
