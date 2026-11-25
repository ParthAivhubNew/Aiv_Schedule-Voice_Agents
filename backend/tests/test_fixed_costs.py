"""Plan 11, step 5 (second part): fixed costs per month, break-even per plan, and each client's share of the fixed costs."""
from datetime import date, datetime

import pytest
from sqlalchemy import text

from app.services import fixed_costs as FC

pytestmark = pytest.mark.db


async def _rates(db):
    from app.services.credits import _put_doc

    await _put_doc(db, "fx_rates", {"days": {"2026-01-01": {"EUR": 1.0, "USD": 1.25, "GBP": 1.0}}, "source": "ECB"})  # $1 = 80p
    await db.commit()


def _fc(**kw):
    from app.models.models import FixedCost

    base = {"vendor": "V", "amount_cents": 10000, "currency": "gbp", "period": "month", "starts_on": date(2026, 1, 1), "wallet": ""}
    return FixedCost(**{**base, **kw})


async def test_monthly_yearly_and_one_off_costs_count_per_month(db):
    await _rates(db)
    db.add_all([_fc(id="m", vendor="Hosting", amount_cents=10000),                                       # £100 a month
                _fc(id="y", vendor="TPS licence", amount_cents=240000, period="year", wallet="voice"),   # £2,400 a year: £200 a month
                _fc(id="o", vendor="BN data file", amount_cents=120000, period="once", starts_on=date(2026, 3, 15), wallet="leadgen"),  # £100 a month for 12 months
                _fc(id="u", vendor="Apollo", amount_cents=10000, currency="usd", wallet="leadgen"),       # $100 = £80
                _fc(id="e", vendor="Old tool", amount_cents=5000, ends_on=date(2026, 2, 28))])          # ended in February
    await db.commit()
    feb = await FC.monthly(db, "2026-02")
    assert feb["total"] == pytest.approx(100 + 200 + 80 + 50) and feb["estimated"] is False
    mar = await FC.monthly(db, "2026-03")
    assert mar["total"] == pytest.approx(100 + 200 + 100 + 80)  # the one-off starts; the old tool has ended
    assert mar["byWallet"] == {"platform": 100.0, "voice": 200.0, "leadgen": 180.0}
    assert (await FC.monthly(db, "2027-02"))["total"] == pytest.approx(100 + 200 + 100 + 80)  # the one-off's 12th month
    assert (await FC.monthly(db, "2027-03"))["total"] == pytest.approx(100 + 200 + 80)  # and then it's paid off


def test_a_fixed_cost_is_checked():
    for bad, words in (({"amountCents": 100}, "vendor"), ({"vendor": "X", "amountCents": 0}, "more than 0"),
                       ({"vendor": "X", "amountCents": 1, "currency": "jpy"}, "GBP"), ({"vendor": "X", "amountCents": 1, "period": "week"}, "monthly"),
                       ({"vendor": "X", "amountCents": 1, "startsOn": "2026-05-01", "endsOn": "2026-01-01"}, "before the start")):
        with pytest.raises(ValueError, match=words):
            FC.clean(bad)
    assert FC.clean({"vendor": " TPS ", "amountCents": "220000", "period": "year", "wallet": "voice", "startsOn": "2026-01-01"})["amount_cents"] == 220000


async def _plan_with_subscribers(db, n=3):
    from app.core.tenancy import org_scope

    await db.execute(text("INSERT INTO billing_plans (id, wallet, kind, name, price_usd_cents, currency, credits, active) VALUES "
                          "('pl_g', 'leadgen', 'plan', 'Leads Growth', 9999, 'gbp', 550, TRUE)"))
    for i in range(n):
        org = f"org_s{i}"
        await db.execute(text("INSERT INTO organizations (id, name, slug, status) VALUES (:o, :o, :o, 'active')"), {"o": org})
        await db.commit()
        with org_scope(org):
            await db.execute(text("INSERT INTO billing_subscriptions (org_id, id, status, plans) VALUES (:o, :o, 'active', CAST('{\"leadgen\": \"pl_g\"}' AS JSON))"),
                             {"o": org})
            await db.execute(text("INSERT INTO credit_grants (org_id, id, wallet, source, amount, remaining, paid_cents, paid_currency, created_at) "
                                  "VALUES (:o, :g, 'leadgen', 'stripe', 550, 550, 9999, 'gbp', :w)"), {"o": org, "g": f"g{i}", "w": datetime(2026, 3, 5)})
            await db.commit()


async def test_break_even_says_how_many_subscribers_pay_the_fixed_costs(db):
    from app.core.tenancy import system_scope

    await _rates(db)
    await _plan_with_subscribers(db, 3)
    db.add(_fc(id="tps", vendor="TPS licence", amount_cents=219600, period="year", wallet="leadgen"))  # £183 a month
    await db.commit()
    with system_scope():
        out = await FC.break_even(db, "2026-03")
    row = out["plans"][0]
    # £99.99 incl. VAT -> £83.33 net - Stripe (1.5% + 20p) = £81.63 a subscriber, no usage cost last month.
    assert row["netPrice"] == pytest.approx(81.63, abs=0.01) and row["subscribers"] == 3 and row["fixedShare"] == pytest.approx(183.0)
    assert row["subscribersNeeded"] == 3 and row["coversFixed"] is True
    assert out["gap"] == pytest.approx(183.0 - 3 * 81.63, abs=0.05)  # negative: the subscribers more than pay the fixed costs


async def test_each_paying_client_carries_a_share_of_the_fixed_costs_by_what_it_paid(db):
    from app.core.tenancy import system_scope
    from app.database import engine
    from app.services import cost_ledger
    from app.services import revenue as R

    async with engine.begin() as conn:
        await cost_ledger.create_view(conn)
    await _rates(db)
    await _plan_with_subscribers(db, 2)
    db.add(_fc(id="h", vendor="Hosting", amount_cents=4000))  # £40 this month
    await db.commit()
    with system_scope():
        out = await R.client_pnl(db, "2026-03")
    rows = {r["orgId"]: r for r in out["clients"]}
    assert rows["org_s0"]["fixedShare"] == 20.0 and rows["org_s1"]["fixedShare"] == 20.0  # paid the same: half each
    assert rows["org_s0"]["marginAfterFixed"] == pytest.approx(rows["org_s0"]["margin"] - 20.0)
    assert out["totals"]["fixed"] == 40.0


async def test_staff_add_change_and_remove_fixed_costs(db, staff):
    got = await staff.post("/api/admin-api/fixed-costs", json={"vendor": "TPS licence", "amountCents": 220000, "period": "year", "wallet": "voice",
                                                               "startsOn": "2026-01-01"})
    assert got.status_code == 200, got.text
    cid = got.json()["id"]
    assert (await staff.post("/api/admin-api/fixed-costs", json={"vendor": "", "amountCents": 1})).status_code == 400
    listed = (await staff.get("/api/admin-api/fixed-costs", params={"month": "2026-03"})).json()
    assert [i["id"] for i in listed["items"]] == [cid] and listed["month"]["byWallet"] == {"voice": pytest.approx(183.33, abs=0.01)}
    changed = await staff.put(f"/api/admin-api/fixed-costs/{cid}", json={"vendor": "TPS licence", "amountCents": 264000, "period": "year",
                                                                        "wallet": "voice", "startsOn": "2026-01-01"})
    assert changed.json()["amountCents"] == 264000
    assert (await staff.get("/api/admin-api/break-even", params={"month": "2026-03"})).status_code == 200
    assert (await staff.delete(f"/api/admin-api/fixed-costs/{cid}")).json() == {"ok": True}
    assert (await staff.get("/api/admin-api/fixed-costs")).json()["items"] == []
