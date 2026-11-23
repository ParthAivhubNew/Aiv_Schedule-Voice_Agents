"""Automatic TPS/CTPS screening of saved phone numbers: only saved accounts, only UK numbers with no fresh result, 2 credits per 5 answered
numbers through the Leads wallet, a quiet stop with a notice when credits or the key are missing, never charged twice, and an admin switch."""
import pytest
from sqlalchemy import text

from app.core.tenancy import org_scope, system_scope
from app.models.models import AuditLog, LeadAccount
from app.services import audit
from app.services import auto_tps as AT
from app.services import call_permission as CP
from app.services import credits as K
from tests.conftest import make_user

pytestmark = pytest.mark.db


class Fake:
    name = "provero"
    error = ""

    def __init__(self, skip=()):
        self.calls, self.skip = [], set(skip)

    def configured(self):
        return True

    async def screen(self, numbers):
        self.calls.append(list(numbers))
        return {n: {"tps": "listed" if n.endswith("1") else "clear", "ctps": False} for n in numbers if n not in self.skip}


class NoKey:
    name = "none"
    error = ""

    def configured(self):
        return False

    async def screen(self, numbers):
        raise AssertionError("must not be called")


def use(monkeypatch, prov):
    async def provider():
        return prov

    monkeypatch.setattr(CP, "provider", provider)


async def accounts(db, org, rows):
    with org_scope(org):
        for i, (phone, research) in enumerate(rows):
            db.add(LeadAccount(id=f"la_{org}_{i}", name=f"Co {i}", phone=phone, research=research))
        await db.commit()


async def fund(db, org, amount):
    with org_scope(org):
        await K.add_credits(db, "leadgen", amount, source="grant", note="Test")
        await db.commit()


async def used(db, org):
    with system_scope():
        return (await db.execute(text("SELECT coalesce(sum(-amount), 0) FROM credit_ledger WHERE item = 'lead_tps_check' AND org_id = :o"), {"o": org})).scalar()


async def state(db, org):
    with org_scope(org):
        return await AT.load(db, org)


NUMS = [f"+4477009000{i:02d}" for i in range(10, 20)]  # ten UK numbers


async def test_screens_only_unscreened_uk_numbers_and_charges_per_five_answered(db, monkeypatch):
    fake = Fake(skip=[NUMS[9]])  # one number gets no answer
    use(monkeypatch, fake)
    await fund(db, "org_default", 20)
    await CP.save_screening(db, NUMS[0], "clear")  # fresh: free
    await db.commit()
    await accounts(db, "org_default", [(NUMS[0], None), (NUMS[1], {"phones": [NUMS[2]], "team": [{"name": "T", "phone": NUMS[3]}]}),
                                       ("+12125550101", None), ("", None), (NUMS[4], None)] + [(n, None) for n in NUMS[5:10]])
    res = await AT.sweep_org("org_default", chunk_pause=0)
    asked = sorted(n for c in fake.calls for n in c)
    assert asked == sorted(NUMS[1:10])  # not the fresh one, not the US one
    assert res["screened"] == 8 and res["charged"] == 4  # 8 answered = 2 units of 5 rounded up (3.2 units rounded up to 4 credits)
    assert await used(db, "org_default") == 4
    with org_scope("org_default"):
        row = await CP.status(db, NUMS[1])
    assert row["fresh"] and row["tps_status"] == "listed"
    with system_scope():
        note = (await db.execute(text("SELECT note FROM credit_ledger WHERE item = 'lead_tps_check'"))).scalar()
    assert note.startswith("TPS and CTPS check (automatic)")
    assert "provero" not in note.lower()


async def test_second_sweep_charges_nothing_more(db, monkeypatch):
    fake = Fake()
    use(monkeypatch, fake)
    await fund(db, "org_default", 20)
    await accounts(db, "org_default", [(n, None) for n in NUMS[:5]])
    await AT.sweep_org("org_default", chunk_pause=0)
    first = await used(db, "org_default")
    assert first == 2 and len(fake.calls) == 1
    # even with the cursor wound back, every number is fresh now: free and not asked again
    with org_scope("org_default"):
        await AT._save(db, "org_default", cursor={"at": "2000-01-01T00:00:00", "id": ""})
        await db.commit()
    res = await AT.sweep_org("org_default", chunk_pause=0)
    assert res["charged"] == 0 and len(fake.calls) == 1 and await used(db, "org_default") == first


async def test_same_answered_set_has_one_stable_ref():
    from datetime import datetime

    now = datetime(2026, 11, 23, 9, 0)
    assert AT._ref(["+441", "+442"], now) == AT._ref(["+442", "+441"], now)
    assert AT._ref(["+441"], now) != AT._ref(["+442"], now)


async def test_a_charge_with_the_same_ref_is_not_repeated(db):
    await fund(db, "org_default", 10)
    with org_scope("org_default"):
        ref = AT._ref(["+447700900011"], __import__("datetime").datetime.utcnow())
        await K.charge(db, AT.ITEM, 0.2, ref, "x")
        await db.commit()
        assert await K._already_charged(db, ref, AT.ITEM)


async def test_short_credits_stop_quietly_leave_numbers_unscreened_and_note_it(db, monkeypatch):
    fake = Fake()
    use(monkeypatch, fake)
    await fund(db, "org_default", 1)  # a chunk of 5 needs 2
    await accounts(db, "org_default", [(n, None) for n in NUMS[:5]])
    res = await AT.sweep_org("org_default", chunk_pause=0)
    assert res["status"] == "no_credits" and fake.calls == [] and await used(db, "org_default") == 0
    st = await state(db, "org_default")
    assert st["notice"]["text"] == "Some phone numbers were not screened: not enough credits."
    with org_scope("org_default"):
        assert (await CP.status(db, NUMS[0]))["fresh"] is False
    # topping up lets the next sweep finish and clears the notice
    await fund(db, "org_default", 10)
    res = await AT.sweep_org("org_default", chunk_pause=0)
    assert res["status"] == "done" and res["screened"] == 5
    assert (await state(db, "org_default"))["notice"] is None


async def test_missing_key_does_nothing_and_leaves_one_notice(db, monkeypatch):
    use(monkeypatch, NoKey())
    await fund(db, "org_default", 10)
    await accounts(db, "org_default", [(n, None) for n in NUMS[:3]])
    for _ in range(2):
        res = await AT.sweep_org("org_default", chunk_pause=0)
        assert res["status"] == "no_key"
    st = await state(db, "org_default")
    assert st["notice"]["code"] == "no_key" and "provero" not in st["notice"]["text"].lower()
    assert await used(db, "org_default") == 0


async def test_switch_off_means_nothing_happens_and_on_starts_from_now(db, monkeypatch):
    fake = Fake()
    use(monkeypatch, fake)
    await fund(db, "org_default", 10)
    with org_scope("org_default"):
        await AT.set_enabled(db, "org_default", False)
        await db.commit()
    await accounts(db, "org_default", [(n, None) for n in NUMS[:5]])
    assert (await AT.sweep_org("org_default", chunk_pause=0))["status"] == "off" and fake.calls == []
    with org_scope("org_default"):
        await AT.set_enabled(db, "org_default", True)
        await db.commit()
    res = await AT.sweep_org("org_default", chunk_pause=0)
    assert res["screened"] == 0 and fake.calls == []  # what was saved while it was off is not swept up and charged


async def test_organisations_are_kept_apart(db, monkeypatch):
    fake = Fake()
    use(monkeypatch, fake)
    await make_user(db, "other", "Admin", org_id="org_other")
    await fund(db, "org_default", 10)
    await fund(db, "org_other", 10)
    await accounts(db, "org_default", [(NUMS[0], None)])
    await accounts(db, "org_other", [(NUMS[5], None)])
    await AT.sweep_org("org_other", chunk_pause=0)
    assert [n for c in fake.calls for n in c] == [NUMS[5]]
    assert await used(db, "org_other") == 1 and await used(db, "org_default") == 0
    with org_scope("org_default"):
        assert (await CP.status(db, NUMS[0]))["fresh"] is False


async def test_a_big_import_is_taken_in_bounded_ticks(db, monkeypatch):
    fake = Fake()
    use(monkeypatch, fake)
    await fund(db, "org_default", 1000)
    n = AT.TICK_NUMBERS + 50
    await accounts(db, "org_default", [(f"+4477010{i:05d}", None) for i in range(n)])
    first = await AT.sweep_org("org_default", chunk_pause=0)
    assert first["screened"] <= AT.TICK_NUMBERS and all(len(c) <= AT.CHUNK for c in fake.calls)
    again = await AT.sweep_org("org_default", chunk_pause=0)
    assert first["screened"] + again["screened"] <= n and again["screened"] > 0
    for _ in range(5):
        await AT.sweep_org("org_default", chunk_pause=0)
    assert sum(len(c) for c in fake.calls) == n  # every number asked exactly once


async def test_no_screening_at_search_time(client, db, monkeypatch):
    fake = Fake()
    use(monkeypatch, fake)
    await client.post("/api/leads/search", json={"filters": {}, "limit": 5})
    assert fake.calls == []


async def test_saving_an_account_starts_nothing_while_kick_is_off(client, db, monkeypatch):
    fake = Fake()
    use(monkeypatch, fake)
    r = await client.post("/api/leads/accounts", json={"accounts": [{"name": "Kick Ltd", "phone": NUMS[0]}]})
    assert r.status_code == 200 and fake.calls == []


async def test_api_is_admin_only_and_audited(db):
    import httpx

    from app.main import app

    _, admin = await make_user(db, "adm", "Admin")
    _, plain = await make_user(db, "plain", "Operator")

    def c(tok):
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {tok}"})

    async with c(plain) as p:
        assert (await p.get("/api/org/auto-tps")).status_code == 403
        assert (await p.put("/api/org/auto-tps", json={"enabled": False})).status_code == 403
    async with c(admin) as a:
        got = (await a.get("/api/org/auto-tps")).json()
        assert got["enabled"] is True and got["notice"] is None and got["credits_per_five"] == 2
        off = (await a.put("/api/org/auto-tps", json={"enabled": False})).json()
        assert off["enabled"] is False
        await a.put("/api/org/auto-tps", json={"enabled": False})  # no change: no second row
        assert (await a.put("/api/org/auto-tps", json={"enabled": True})).json()["enabled"] is True
    with system_scope():
        rows = (await db.execute(__import__("sqlalchemy").select(AuditLog).where(AuditLog.action == "auto_tps.updated").order_by(AuditLog.id))).scalars().all()
    assert [r.detail["new"] for r in rows] == [False, True] and rows[0].detail["old"] is True
