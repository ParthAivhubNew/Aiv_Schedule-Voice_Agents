"""Plan 11, step 2: paid work never slips through unseen. A failed credit check lets only small work run; every vendor call says what
caused it (a request, a background job or a script); providers used with no price are shown and staff are told."""
import pytest

from app.services import credits as K


# ---- a failed credit check never opens the tap -------------------------------------------------------------
@pytest.fixture
def broken_rate_card(monkeypatch):
    async def broken(db):
        raise RuntimeError("database away")

    monkeypatch.setattr(K, "rates", broken)


async def test_small_work_still_runs_when_the_check_fails(broken_rate_card):
    assert await K.can_start(None, "voice_minute") == (True, "")  # a call is never stopped by a blip
    assert await K.can_start(None, "lead_lookup", 2) == (True, "")  # 10 credits
    assert (await K.hold(None, [{"ref": "r1", "item": "lead_lookup", "quantity": 1}]))[0] is True


async def test_bulk_work_is_refused_when_the_check_fails(broken_rate_card):
    ok, why = await K.can_start(None, "check_registry", 200)
    assert ok is False and why.startswith("USR-07")
    ok, why = await K.hold(None, [{"ref": f"r{i}", "item": "lead_lookup", "quantity": 1} for i in range(10)])  # 50 credits
    assert ok is False and why == K.CHECK_FAILED


def test_the_allowance_is_counted_at_standard_prices():
    assert K._estimate([("lead_lookup", 5), ("ai_image", 1)]) == 5 * K.DEFAULT_RATES["lead_lookup"]["credits"] + K.DEFAULT_RATES["ai_image"]["credits"]
    assert K._estimate([("not_an_item", 99)]) == 0
    assert K.CHECK_FAILED.split(":")[0] not in ("USR-0" + str(n) for n in range(1, 7))  # its own code, not one already in use


# ---- every vendor call says what caused it -------------------------------------------------------------------
def test_a_vendor_call_names_its_request_its_job_or_its_script(monkeypatch):
    import sys

    from app.core import tenancy

    with tenancy.route_scope("POST", "/api/leads/companies/x/find-website"):
        assert tenancy.current_route() == "POST /api/leads/companies/x/find-website"
    with tenancy.route_scope("JOB", "find_leads_warm"):
        assert tenancy.current_route() == "JOB find_leads_warm"
    monkeypatch.setattr(sys, "argv", ["/tmp/bn_enrich_all.py"])
    assert tenancy.current_route() == "script bn_enrich_all.py"  # internal bulk work, never taken for a client's
    monkeypatch.setattr(sys, "argv", ["/usr/local/bin/uvicorn", "app.main:app"])
    assert tenancy.current_route() == ""  # the web server itself: a request always sets its own
    monkeypatch.setattr(sys, "argv", ["/usr/local/lib/python3.11/site-packages/pytest/__main__.py"])
    assert tenancy.current_route() == ""  # nor is the test runner a script


def test_the_apollo_screen_names_jobs_and_scripts_in_plain_words():
    from app.services import apollo_pool as AP

    assert AP.route_label("JOB find_leads_warm") == "Background job (find leads warm)"
    assert AP.route_label("script bn_enrich_all.py") == "Script run by hand (bn_enrich_all.py)"
    assert AP.route_label("") == "Background job"


# ---- providers used with no price ---------------------------------------------------------------------------
@pytest.mark.db
async def test_providers_used_with_no_price_are_listed_shown_on_the_pricing_screen_and_staff_told_once_a_day(db):
    import uuid
    from datetime import datetime, timedelta

    from app.models.models import AiUsage, ApolloCall
    from app.services import ai_pricing as P
    from app.services.credits import _get_doc

    for i in range(3):
        db.add(AiUsage(id=f"au{i}", plugin="leadgen", kind="llm", provider="deepseek", model="deepseek-flash", input_tokens=100,
                       output_tokens=10, cost_usd=0, priced=False))
    db.add(AiUsage(id="au_old", plugin="leadgen", kind="llm", provider="deepseek", model="old", priced=False,
                   created_at=datetime.utcnow() - timedelta(days=40)))  # outside the 30 days
    db.add(AiUsage(id="au_paid", plugin="leadgen", kind="llm", provider="openai", model="gpt", cost_usd=0.01, priced=True))
    db.add_all([ApolloCall(id=uuid.uuid4().hex, purpose="company_by_name", for_org="org_default") for _ in range(2)])
    await db.commit()

    found = await P.unpriced_in_use(db)
    assert {(x["provider"], x["model"], x["calls"]) for x in found} == {("deepseek", "deepseek-flash", 3), ("apollo", "", 2)}
    items = {(r["provider"], r["model"]): r for r in await P.list_prices(db)}
    assert items[("apollo", "")]["unpricedCalls30d"] == 2 and items[("apollo", "")]["confirmed"] is False  # Apollo now waits for a price

    first = await P.alert_unpriced(db)
    second = await P.alert_unpriced(db)  # the same day: no second alert
    assert first and second
    alerts = [a for a in (await _get_doc(db, "staff_alerts")).get("items", []) if a["code"] == "PRICE-01"]
    assert len(alerts) == 1 and "deepseek/deepseek-flash (3 calls)" in alerts[0]["detail"] and "apollo (2 calls)" in alerts[0]["detail"]

    apollo = next(r for r in await P.list_prices(db) if r["provider"] == "apollo")
    await P.set_price(db, apollo["id"], 0.02, 0.0, "staff")
    await db.commit()
    assert {x["provider"] for x in await P.unpriced_in_use(db)} == {"deepseek"}  # priced now, so no longer waiting


# ---- prices that follow the cost ----------------------------------------------------------------------------------
def test_a_rented_number_costs_more_than_telnyx_charges_us():
    # Telnyx about $1 (79p) a month; the cheapest Voice credit is 13.3p (Growth): 15 credits keep at least a 60% margin.
    assert K.DEFAULT_RATES["phone_number_month"]["credits"] == 15 and 15 * 0.133 * 0.4 >= 0.79


@pytest.mark.parametrize("stack,item", [
    ({"engine": "livekit", "tts": "Cartesia Sonic"}, "voice_minute"),
    ({"engine": "xai", "tts": "Grok"}, "voice_minute"),
    ({"engine": "openai", "tts": "OpenAI Realtime"}, "voice_minute_premium"),
    ({"engine": "vapi"}, "voice_minute_premium"),
    ({"engine": "retell"}, "voice_minute_premium"),
    ({"engine": "livekit", "tts": "ElevenLabs Turbo"}, "voice_minute_premium"),
])
def test_a_premium_engine_or_voice_costs_the_premium_minute(stack, item):
    assert K.voice_minute_item(stack) == item
    assert K.DEFAULT_RATES["voice_minute_premium"]["credits"] == 2 and K.DEFAULT_RATES["voice_minute"]["credits"] == 1


def test_a_person_calling_and_telnyx_s_own_ai_are_always_the_standard_minute():
    premium = {"engine": "vapi", "tts": "ElevenLabs"}
    assert K.voice_minute_item(premium, mission="human") == "voice_minute"
    assert K.voice_minute_item(premium, mission="Telnyx AI Assistant — inbound") == "voice_minute"
    assert K.voice_minute_item(premium, mission="Spring campaign") == "voice_minute_premium"


@pytest.mark.db
async def test_a_call_is_held_and_charged_at_the_price_it_started_on(db, monkeypatch):
    from app.core.tenancy import org_scope
    from app.services import voice_plugin_plan as V

    monkeypatch.setattr(V, "get_active_stack", lambda: {"engine": "openai", "tts": "OpenAI Realtime"})
    with org_scope("org_default"):
        await K.add_credits(db, "voice", 100, source="grant", note="t", by="t")
        await db.commit()
        ok, why, secs = await K.reserve_call(db, "call_p1")
        await db.commit()
        assert ok and secs == 50 * 60  # 100 credits at 2 a minute
        held = K._holds(await K._get_doc(db, K._settings_id()))[f"{K.CALL_HOLD}call_p1"]
        assert held["item"] == "voice_minute_premium"
        monkeypatch.setattr(V, "get_active_stack", lambda: {"engine": "livekit"})  # the stack changed during the call: the price did not
        await K.charge_finished_call(db, "call_p1", "3 min", "Acme")
        assert await K.wallet_balance(db, "voice") == 94
        ok, _why, secs = await K.reserve_call(db, "call_h1", item="voice_minute")  # a person calling: the standard minute
        assert ok and secs == 94 * 60


@pytest.mark.db
async def test_a_search_that_finds_nothing_costs_only_when_the_vendor_bills_every_search(db):
    from app.services import ai_pricing as P

    row = await P._price_row(db, "hunter", "", "lookup")
    await P.set_price(db, row.id, 0.03, 0.0, "staff")
    assert await P.lookup_cost(db, "hunter", found=True) == 0.03 and await P.lookup_cost(db, "hunter", found=False) == 0.0
    out = await P.set_price(db, row.id, 0.03, 0.0, "staff", billing="per_search")
    assert out["billing"] == "per_search" and await P.lookup_cost(db, "hunter", found=False) == 0.03
    with pytest.raises(ValueError):
        await P.set_price(db, row.id, 0.03, 0.0, "staff", billing="sometimes")
    assert await P.lookup_cost(db, "nobody_priced_me", found=True) == 0.0
