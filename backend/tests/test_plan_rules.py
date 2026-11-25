"""Plan 11, step 5 (first part): what a plan includes, its fair-use cost cap, and the margin guard on prices."""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import text

from app.services import plan_rules as PR


def test_rules_are_cleaned():
    assert PR.clean_rules(None) == {"providers": None, "cost_cap_pct": None, "limits": {}}
    assert PR.clean_rules({"providers": ["Hunter", "icypeas", "not-a-provider"], "cost_cap_pct": "40"}) == {
        "providers": ["hunter", "icypeas"], "cost_cap_pct": 40, "limits": {}}
    assert PR.clean_rules({"limits": {"users": "5", "exports_month": 0, "emails_day": "x", "assistant_day": 200, "nonsense": 9}})["limits"] == {
        "users": 5, "assistant_day": 200}
    assert PR.clean_rules({"cost_cap_pct": 500})["cost_cap_pct"] == 100 and PR.clean_rules({"cost_cap_pct": 1})["cost_cap_pct"] == 5
    assert PR.clean_rules({"providers": []})["providers"] == []  # an empty list: no provider at all


async def _org_on_plan(db, org="org_p", rules=None, price=4999, period_days_left=20, paid=None):
    from app.core.tenancy import org_scope

    await db.execute(text("INSERT INTO organizations (id, name, slug, status) VALUES (:o, :o, :o, 'active') ON CONFLICT DO NOTHING"), {"o": org})
    await db.execute(text("INSERT INTO billing_plans (id, wallet, kind, name, price_usd_cents, currency, credits, active, rules) "
                          "VALUES ('pl_s', 'leadgen', 'plan', 'Starter', :p, 'gbp', 250, TRUE, CAST(:r AS JSON))"),
                     {"p": price, "r": __import__("json").dumps(rules or {})})
    await db.commit()
    with org_scope(org):
        await db.execute(text("INSERT INTO billing_subscriptions (org_id, id, status, plans, current_period_end) "
                              "VALUES (:o, :o, 'active', CAST('{\"leadgen\": \"pl_s\"}' AS JSON), :e)"),
                         {"o": org, "e": datetime.utcnow() + timedelta(days=period_days_left)})
        if paid:
            await db.execute(text("INSERT INTO credit_grants (org_id, id, wallet, source, amount, remaining, paid_cents, paid_currency, created_at) "
                                  "VALUES (:o, 'g_p', 'leadgen', 'stripe', 250, 250, :c, 'gbp', :w)"), {"o": org, "c": paid, "w": datetime.utcnow()})
        await db.commit()
    PR.invalidate()


async def _cost(db, org, usd):
    from app.database import engine
    from app.models.models import AiUsage
    from app.services import cost_ledger

    async with engine.begin() as conn:
        await cost_ledger.create_view(conn)
    db.add(AiUsage(id=f"au_{usd}", org_id=org, plugin="leadgen", kind="llm", provider="openai", model="m", cost_usd=usd, priced=True))
    await db.commit()
    PR.invalidate()


# ---- providers a plan includes -----------------------------------------------------------------------------
@pytest.mark.db
async def test_a_plan_without_a_provider_never_uses_it_and_no_plan_means_no_limit(db):
    await _org_on_plan(db, rules={"providers": ["icypeas", "hunter"]})
    assert await PR.provider_allowed("hunter", "org_p") and not await PR.provider_allowed("apollo", "org_p")
    assert await PR.provider_allowed("apollo", "org_nobody")  # no live plan: not limited
    from app.core.tenancy import org_scope
    from app.services import apollo_pool, enrichment_service as E

    async def key():
        return "k"

    E.apollo_key, saved = key, E.apollo_key
    try:
        with org_scope("org_p"):
            assert await apollo_pool.keys() == []  # the plan leaves Apollo out: its pool has no key
    finally:
        E.apollo_key = saved


@pytest.mark.db
async def test_the_waterfall_asks_only_the_finders_the_plan_includes(db, monkeypatch):
    from app.core.tenancy import org_scope
    from app.services import enrichment_waterfall as W

    await _org_on_plan(db, rules={"providers": ["hunter"]})
    asked = []

    async def keys():
        return {"icypeas": "k1", "hunter": "k2"}

    def finder(name):
        async def f(client, key, p):
            asked.append(name)
            return "", ""
        return f

    monkeypatch.setattr(W, "finder_keys", keys)
    monkeypatch.setattr(W, "ADAPTERS", {**W.ADAPTERS, "icypeas": finder("icypeas"), "hunter": finder("hunter")})
    with org_scope("org_p"):
        await W.lookup_person_waterfall(db, "org_p", "Ann", "Lee", "Acme Ltd", "acme.co.uk", bill=False)  # credits aren't what's tested here
    assert asked == ["hunter"]


# ---- the fair-use cost cap ----------------------------------------------------------------------------------
@pytest.mark.db
async def test_the_cap_warns_then_pauses_paid_lookups_and_a_top_up_lifts_it(db, monkeypatch):
    from app.core.tenancy import org_scope
    from app.services import credits as K
    from app.services import fx

    async def flat(db_, frm, to, on=None):
        return (1.0, "", False) if frm.upper() == to.upper() else ((0.8, "x", False) if frm.upper() == "USD" else (1.25, "x", False))

    monkeypatch.setattr(fx, "rate", flat)
    told = []

    async def tell(org_id, state):
        told.append(state["state"])

    monkeypatch.setattr(PR, "_tell_once", tell)
    # Paid £60 this period, prices include VAT: £50 net; a 40% cap allows £20 of our cost.
    await _org_on_plan(db, rules={"cost_cap_pct": 40}, price=6000, paid=6000)
    assert (await PR.cap_state("org_p"))["capGbp"] == 20.0 and (await PR.cap_state("org_p"))["state"] == "ok"
    await _cost(db, "org_p", 21.0)  # $21 = £16.80: 84% of the cap
    assert (await PR.cap_state("org_p"))["state"] == "warn" and told == ["warn"]
    assert await PR.cap_refusal(["lead_lookup"], "org_p") == ""  # a warning never refuses
    await _cost(db, "org_p", 5.0)  # £20.80 in all: over the cap
    assert (await PR.cap_state("org_p"))["state"] == "paused"
    with org_scope("org_p"):
        ok, why = await K.can_start(db, "lead_lookup")
        assert ok is False and why.startswith("USR-08")
        assert "USR-08" not in (await K.can_start(db, "voice_minute"))[1]  # calls are never paused by the cap
        assert await PR.cap_refusal(["voice_minute", "phone_number_month"], "org_p") == ""
        await db.execute(text("INSERT INTO credit_grants (org_id, id, wallet, source, amount, remaining, paid_cents, paid_currency, created_at) "
                              "VALUES ('org_p', 'g_top', 'leadgen', 'stripe', 60, 60, 1200, 'gbp', :w)"), {"w": datetime.utcnow()})
        await db.commit()
    PR.invalidate()
    assert (await PR.cap_state("org_p"))["state"] != "paused"  # £72 paid: the cap is now £24


@pytest.mark.db
async def test_no_cap_set_means_nothing_is_checked(db):
    await _org_on_plan(db, rules={})
    assert await PR.cap_state("org_p") is None and await PR.cap_refusal(["lead_lookup"], "org_p") == ""


# ---- the margin guard ----------------------------------------------------------------------------------------
@pytest.mark.db
async def test_the_margin_table_and_a_price_below_the_floor_is_refused_unless_overridden(db, staff):
    from app.services import margin_guard as MG

    await db.execute(text("INSERT INTO billing_plans (id, wallet, kind, name, price_usd_cents, currency, credits, active) VALUES "
                          "('pl_v', 'voice', 'plan', 'Voice Growth', 39999, 'gbp', 3000, TRUE), "
                          "('pl_l', 'leadgen', 'plan', 'Leads Growth', 9999, 'gbp', 550, TRUE)"))
    await db.commit()
    tab = await MG.table(db)
    rows = {r["item"]: r for r in tab["items"]}
    # Voice Growth: £399.99 incl. VAT -> £333.33 net - Stripe = £327.13 / 3000 = 10.9p a credit; 15 credits = £1.64 against ~79p for a
    # number: 52%, under the 60% floor once VAT and Stripe are taken off. 19 credits meet it.
    assert rows["phone_number_month"]["status"] == "below" and MG.needed_credits(rows["phone_number_month"], 60) == 19
    assert rows["voice_minute_premium"]["status"] == "unknown" and rows["email_send"]["status"] == "free"
    assert rows["ai_post"]["status"] == "unknown"  # no Social plan on sale here: nothing can be sold below cost
    # Growth: £99.99 incl. VAT -> £83.33 net - Stripe (1.5% + 20p) = £81.63 / 550 = 14.8p a credit.
    assert rows["lead_lookup"]["creditPence"] == pytest.approx(14.84, abs=0.05)

    unrelated = await staff.put("/api/admin-api/rates", json={"rates": {"email_send": 1}})
    assert unrelated.status_code == 200  # a price already under the floor doesn't block an unrelated change
    refused = await staff.put("/api/admin-api/rates", json={"rates": {"phone_number_month": 1}})
    assert refused.status_code == 409 and refused.json()["detail"]["code"] == "margin_floor"
    item = refused.json()["detail"]["items"][0]
    assert item["item"] == "phone_number_month" and item["creditsNeeded"] and item["creditsNeeded"] > 1
    no_reason = await staff.put("/api/admin-api/rates", json={"rates": {"phone_number_month": 1}, "override": True})
    assert no_reason.status_code == 400
    ok = await staff.put("/api/admin-api/rates", json={"rates": {"phone_number_month": 1}, "override": True, "reason": "launch offer for November"})
    assert ok.status_code == 200 and ok.json()["phone_number_month"]["credits"] == 1
    fine = await staff.put("/api/admin-api/rates", json={"rates": {"phone_number_month": 20}})
    assert fine.status_code == 200


@pytest.mark.db
async def test_a_cheap_plan_that_breaks_the_floor_is_refused_and_plan_rules_are_saved(db, staff):
    await db.execute(text("INSERT INTO billing_plans (id, wallet, kind, name, price_usd_cents, currency, credits, active) VALUES "
                          "('pl_l', 'leadgen', 'plan', 'Leads Growth', 9999, 'gbp', 550, TRUE)"))
    await db.commit()
    body = {"wallet": "leadgen", "kind": "topup", "name": "Cheap top-up", "priceUsdCents": 100, "credits": 500}
    assert (await staff.post("/api/admin-api/plans", json=body)).status_code == 409  # $1 for 500 credits sells lookups below cost
    good = await staff.post("/api/admin-api/plans", json={**body, "name": "Leads top-up", "priceUsdCents": 3000, "credits": 100,
                                                         "rules": {"providers": ["icypeas", "tavily"], "cost_cap_pct": 40}})
    assert good.status_code == 200, good.text
    assert good.json()["rules"] == {"providers": ["icypeas", "tavily"], "cost_cap_pct": 40, "limits": {}}
    margins = (await staff.get("/api/admin-api/margins")).json()
    assert margins["settings"]["floor_pct"] == 60 and any(r["item"] == "lead_lookup" for r in margins["items"])
    assert (await staff.put("/api/admin-api/margin-settings", json={"floorPct": 50})).json()["floor_pct"] == 50


# ---- monthly and daily limits ----------------------------------------------------------------------------------
@pytest.mark.db
async def test_the_highest_limit_of_a_company_s_plans_applies_and_no_plan_means_no_limit(db):
    await _org_on_plan(db, rules={"limits": {"users": 3}})
    await db.execute(text("INSERT INTO billing_plans (id, wallet, kind, name, price_usd_cents, currency, credits, active, rules) "
                          "VALUES ('pl_v', 'voice', 'plan', 'Voice', 100, 'gbp', 10, TRUE, CAST('{\"limits\": {\"users\": 8}}' AS JSON))"))
    await db.commit()
    from app.core.tenancy import org_scope

    with org_scope("org_p"):  # the subscription is the company's own row (row-level security)
        await db.execute(text("UPDATE billing_subscriptions SET plans = CAST('{\"leadgen\": \"pl_s\", \"voice\": \"pl_v\"}' AS JSON) WHERE id = 'org_p'"))
        await db.commit()
    PR.invalidate()
    assert await PR.limit("users", "org_p") == 8 and await PR.limit("exports_month", "org_p") is None
    assert await PR.limit("users", "org_nobody") is None


@pytest.mark.db
async def test_a_user_over_the_plan_s_seats_is_refused(db):
    import httpx

    from app.main import app
    from tests.conftest import make_user

    _op, token = await make_user(db, "boss", role="Admin", org_id="org_p")
    await _org_on_plan(db, rules={"limits": {"users": 2}})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"}) as c:
        first = await c.post("/api/auth/users", json={"username": "second", "name": "Second Person"})
        assert first.status_code == 200, first.text
        over = await c.post("/api/auth/users", json={"username": "third", "name": "Third Person"})
        assert over.status_code == 403 and over.json()["detail"].startswith("USR-09: Your plan allows 2 users")


@pytest.mark.db
async def test_exports_over_the_month_s_limit_are_refused(db):
    import httpx

    from app.core.tenancy import org_scope
    from app.main import app
    from app.services import audit
    from tests.conftest import make_user

    _op, token = await make_user(db, "boss", role="Admin", org_id="org_p")
    await _org_on_plan(db, rules={"limits": {"exports_month": 2}})
    with org_scope("org_p"):
        for _ in range(2):
            await audit.record(db, "export.created", target="ids", detail={"rows": 1})
        await db.commit()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"}) as c:
        r = await c.post("/api/exports", json={"kind": "companies", "scope": {"ids": ["x"]}})
    assert r.status_code == 403 and "2 exports a month" in r.json()["detail"]


@pytest.mark.db
async def test_e_mails_over_the_day_s_limit_are_refused(db):
    from app.core.tenancy import org_scope
    from app.services import credits as K

    await _org_on_plan(db, rules={"limits": {"emails_day": 3}})
    with org_scope("org_p"):
        await K.add_credits(db, "leadgen", 100, source="grant", note="t", by="t")
        await db.execute(text("INSERT INTO credit_ledger (org_id, id, kind, wallet, item, quantity, amount, created_at) VALUES "
                              "('org_p', 'e1', 'usage', 'leadgen', 'email_send', 3, -3, :w)"), {"w": datetime.utcnow()})
        await db.commit()
        ok, why = await K.can_start(db, "email_send")
        assert ok is False and "3 e-mails a day" in why
        assert (await K.can_start(db, "lead_lookup"))[0] is True  # other work is not limited by it


@pytest.mark.db
async def test_the_assistant_stops_at_the_plan_s_daily_messages_and_has_no_cap_without_one(db, monkeypatch):
    from fastapi import HTTPException

    from app.api import lead_assistant as LA
    from app.core.tenancy import org_scope

    await _org_on_plan(db, rules={"limits": {"assistant_day": 5}})

    async def spent(_db):
        return 5

    monkeypatch.setattr(LA, "_spent_today", spent)
    with org_scope("org_p"):
        with pytest.raises(HTTPException) as err:
            await LA._guard(db)
    assert err.value.status_code == 429 and "5 assistant messages a day" in err.value.detail
    with org_scope("org_free"):
        await LA._guard(db)  # no plan limit: the earlier "no daily cap" still holds
