"""Picks: several phones or emails found by a check are kept for the person to choose, never guessed."""
from types import SimpleNamespace

import pytest

from app.services import check_picks as P


def acc(**kw):
    base = dict(id="a1", name="Oak Dental", region="Leeds", phone="", email="", website="", domain="", verification={}, research={})
    base.update(kw)
    return SimpleNamespace(**base)


def test_two_phones_become_a_pick_and_the_guess_is_undone():
    a = acc(phone="0113 496 0102", research={"phones": ["0113 496 0102", "0113 496 0188"], "filled": [{"field": "phone", "value": "0113 496 0102"}]})
    result = {}
    assert P.add_picks(a, {"phone": "", "email": ""}, result) == 1
    assert a.phone == ""
    assert a.research["filled"] == []
    pick = result["fixes"][0]
    assert pick["kind"] == "pick" and pick["field"] == "phone" and [o["value"] for o in pick["options"]] == ["0113 496 0102", "0113 496 0188"]


def test_one_candidate_or_a_saved_value_is_left_alone():
    a = acc(phone="0113 496 0102", research={"phones": ["0113 496 0102"]})
    assert P.add_picks(a, {"phone": "", "email": ""}, {}) == 0 and a.phone == "0113 496 0102"
    b = acc(phone="0113 000", research={"phones": ["0113 1", "0113 2"]})
    assert P.add_picks(b, {"phone": "0113 000", "email": ""}, {}) == 0 and b.phone == "0113 000"


def test_the_same_number_written_two_ways_is_one_option():
    assert P.candidates({"phones": ["0113 496 0102", "01134960102", "(0113) 496 0102"]}, "phone") == ["0113 496 0102"]


def test_choosing_saves_the_value_and_closes_the_pick():
    a = acc(email="", research={"emails": ["a@oak.co.uk", "b@oak.co.uk"]})
    r = {}
    P.add_picks(a, {"phone": "", "email": ""}, r)
    a.verification = r
    assert P.choose(a, "email", "b@oak.co.uk") == "b@oak.co.uk"
    assert a.email == "b@oak.co.uk" and P.open_picks(a) == []


def test_only_a_shown_option_may_be_chosen():
    a = acc(research={"emails": ["a@oak.co.uk", "b@oak.co.uk"]})
    r = {}
    P.add_picks(a, {"phone": "", "email": ""}, r)
    a.verification = r
    with pytest.raises(P.PickError):
        P.choose(a, "email", "evil@x.test")
    assert a.email == ""


def test_choosing_twice_says_who_won():
    a = acc(research={"emails": ["a@oak.co.uk", "b@oak.co.uk"]})
    r = {}
    P.add_picks(a, {"phone": "", "email": ""}, r)
    a.verification = r
    P.choose(a, "email", "a@oak.co.uk")
    with pytest.raises(P.PickError, match="a@oak.co.uk"):
        P.choose(a, "email", "b@oak.co.uk")


def test_skipping_keeps_it_open_and_saves_nothing():
    a = acc(research={"phones": ["0113 1", "0113 2"]})
    r = {}
    P.add_picks(a, {"phone": "", "email": ""}, r)
    a.verification = r
    P.skip(a, "phone")
    assert a.phone == "" and len(P.open_picks(a)) == 1 and P.as_cards([a])[0]["skipped"] is True


@pytest.mark.db
async def test_picks_over_http_list_choose_and_conflict(db):
    import httpx
    from fastapi import FastAPI

    from app.api import lead_checks
    from app.models.models import LeadAccount

    a = LeadAccount(id="acc_p1", name="Oak Dental", region="Leeds", verification={"verdict": "looks_ok", "fixes": [
        {"kind": "pick", "field": "email", "options": [{"value": "a@oak.co.uk", "source": "Web search"}, {"value": "b@oak.co.uk", "source": "Web search"}], "applied": False}]})
    db.add(a)
    await db.commit()
    app = FastAPI()
    app.include_router(lead_checks.router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        got = (await c.get("/leads/checks/picks")).json()
        assert got["count"] == 1 and got["picks"][0]["name"] == "Oak Dental"
        assert (await c.post("/leads/checks/picks/acc_p1", json={"field": "email", "value": "evil@x.test"})).status_code == 409
        ok = await c.post("/leads/checks/picks/acc_p1", json={"field": "email", "value": "b@oak.co.uk"})
        assert ok.status_code == 200 and ok.json()["chosen"] == "b@oak.co.uk"
        again = await c.post("/leads/checks/picks/acc_p1", json={"field": "email", "value": "a@oak.co.uk"})
        assert again.status_code == 409 and "b@oak.co.uk" in again.json()["detail"]
        assert (await c.get("/leads/checks/picks")).json()["count"] == 0
    await db.refresh(a)
    assert a.email == "b@oak.co.uk"


@pytest.mark.db
async def test_dock_lists_social_and_voice_jobs_only_for_apps_the_org_has(db):
    from app.api import jobs
    from app.models.models import Mission, SocialGenJob, SocialVideoJob

    db.add_all([SocialGenJob(id="g1", state="queued"), SocialGenJob(id="g2", state="queued"), SocialGenJob(id="g3", state="done"),
                SocialVideoJob(id="v1", state="making"),
                Mission(id="m1", title="Leeds dentists", status="active", total=10, contacted=4),
                Mission(id="m2", title="Finished", status="active", total=5, contacted=5)])
    await db.commit()
    got = {j["id"]: j for j in await jobs.collect(db, {"social": True, "voice": True})}
    assert got["social_posts"]["done"] == 1 and got["social_posts"]["total"] == 3
    assert got["social_videos"]["total"] == 1
    assert got["mission_m1"]["done"] == 4 and got["mission_m1"]["total"] == 10 and "mission_m2" not in got
    assert await jobs.collect(db, {"leads": True}) == []
    assert [j["plugin"] for j in await jobs.collect(db, {"voice": True})] == ["voice"]
