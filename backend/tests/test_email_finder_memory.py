"""The email finder remembers who it could not find, re-asks about old addresses, and reports how each provider is doing."""
import pytest
from sqlalchemy import text

from app.services import company_check as CC
from app.services import enrichment_waterfall as W
from app.services import vendor_report as V
from tests.test_email_outreach import _charges, _credits, _finder_key

pytestmark = pytest.mark.db
BODY = {"first_name": "Ann", "last_name": "Lee", "domain": "client.com"}


@pytest.fixture
def finders(monkeypatch):
    """Two stand-in providers that count how often they are asked."""
    state = {"calls": [], "answer": ("", ""), "boom": False}

    async def hunter(client_, key, p):
        state["calls"].append("hunter")
        if state["boom"]:
            raise W.ProviderError("down")
        return state["answer"]

    monkeypatch.setattr(W, "ADAPTERS", {**W.ADAPTERS, "hunter": hunter})
    return state


async def _setup(db):
    await _credits(db, 50)
    await _finder_key(db, "Hunter")


async def _age(db, days, status):
    await db.execute(text(f"UPDATE person_cache SET verified_at = now() - interval '{days} days' WHERE verification_status = :s"), {"s": status})
    await db.commit()


async def test_a_miss_is_remembered_for_30_days_then_asked_again(client, db, finders):
    await _setup(db)
    assert (await client.post("/api/email/find", json=BODY)).json()["found"] is False
    assert (await client.post("/api/email/find", json=BODY)).json()["found"] is False
    assert finders["calls"] == ["hunter"]  # the second time nobody was asked
    assert await _charges(db) == 0
    await _age(db, 31, "not_found")
    await client.post("/api/email/find", json=BODY)
    assert finders["calls"] == ["hunter", "hunter"]
    # it is found later (30 days on): the answer is served and charged once
    await _age(db, 31, "not_found")
    finders["answer"] = ("ann.lee@client.com", "verified")
    got = (await client.post("/api/email/find", json=BODY)).json()
    assert got["email"] == "ann.lee@client.com" and await _charges(db) == 1


async def test_a_lookup_where_every_provider_failed_is_not_remembered(client, db, finders):
    await _setup(db)
    finders["boom"] = True
    await client.post("/api/email/find", json=BODY)
    finders["boom"] = False
    await client.post("/api/email/find", json=BODY)
    assert finders["calls"] == ["hunter", "hunter"]


async def test_an_old_verified_address_is_asked_about_again_and_refreshed(client, db, finders):
    await _setup(db)
    finders["answer"] = ("ann.lee@client.com", "verified")
    await client.post("/api/email/find", json=BODY)
    assert (await client.post("/api/email/find", json=BODY)).json()["source"] == "cache"
    assert finders["calls"] == ["hunter"]
    await _age(db, 100, "verified")
    got = (await client.post("/api/email/find", json=BODY)).json()
    assert got["source"] == "hunter" and finders["calls"] == ["hunter", "hunter"]  # asked again, not served from memory
    n, fresh = (await db.execute(text("SELECT count(*), bool_and(verified_at > now() - interval '1 day') FROM person_cache WHERE email <> ''"))).one()
    assert n == 1 and fresh  # refreshed in place


async def test_an_address_that_bounced_is_never_served_from_memory(client, db, finders):
    await _setup(db)
    finders["answer"] = ("ann.lee@client.com", "verified")
    await client.post("/api/email/find", json=BODY)
    await db.execute(text("INSERT INTO email_suppressions (id, email, reason, source) VALUES ('s1', 'ann.lee@client.com', 'hard_bounce', 'inbox_reader')"))
    await db.commit()
    finders["answer"] = ("ann.lee@client.com", "verified")
    assert (await client.post("/api/email/find", json=BODY)).json()["source"] == "hunter"


def test_a_company_address_counts_only_when_it_is_that_persons_own():
    yes = lambda e: CC.email_matches_person(e, "Ann Lee")  # noqa: E731
    assert yes("ann.lee@client.com") and yes("alee@client.com") and yes("ann@client.com") and yes("lee@client.com")
    assert not yes("info@client.com") and not yes("sales@client.com")
    assert not yes("ann.lee@gmail.com")  # personal webmail is not a company address
    assert not CC.email_matches_person("ann@client.com", "Ann")  # a single name is not enough to match


async def test_the_report_counts_calls_and_bounces_and_the_chosen_order_is_used(client, db, finders):
    await _setup(db)
    finders["answer"] = ("ann.lee@client.com", "verified")
    await client.post("/api/email/find", json=BODY)
    await db.execute(text("INSERT INTO email_suppressions (id, email, reason, source) VALUES ('s2', 'ann.lee@client.com', 'hard_bounce', 'inbox_reader')"))
    await db.commit()
    rep = await V.report(db, 7)
    hunter = next(r for r in rep["providers"] if r["provider"] == "hunter")
    assert hunter["lookups"] == 1 and hunter["verified"] == 1 and hunter["bounced"] == 1 and hunter["costPerGoodUsd"] is None
    assert [r["provider"] for r in rep["providers"]] == W.PROVIDERS
    assert (await V.save_order(db, ["bettercontact", "hunter", "hunter", "nonsense"]))[:2] == ["bettercontact", "hunter"]
    await db.commit()
    assert (await W.finder_order())[:2] == ["bettercontact", "hunter"] and set(await W.finder_order()) == set(W.PROVIDERS)
    with pytest.raises(ValueError):
        await V.save_order(db, ["nonsense"])
