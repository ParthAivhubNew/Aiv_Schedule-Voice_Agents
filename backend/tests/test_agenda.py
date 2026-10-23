"""One day across Leads, Voice and Social: the app being looked at comes first, then the others."""
from datetime import datetime, timezone

import httpx
import pytest

from tests.conftest import make_user

pytestmark = pytest.mark.db

DAY = "2026-11-03"  # a Tuesday; in November London time is UTC


def _ms(hh, mm=0):
    return datetime(2026, 11, 3, hh, mm, tzinfo=timezone.utc).timestamp() * 1000


async def _seed(db):
    from app.models.models import (EmailCampaign, EmailEnrollment, EmailMessage, LeadAccount, Meeting, ScheduleItem, SocialPost)

    db.add(Meeting(id="m1", prospect="Bo Ltd", mission="Demo", date=DAY, time="10:00", status="upcoming", format="video", platform="Google Meet"))
    db.add(Meeting(id="m_other", prospect="Not today", mission="Demo", date="2026-11-04", time="10:00", status="upcoming"))
    db.add(ScheduleItem(id="s1", day=DAY, time="11:00", prospect="Cy Ltd", mission="Intro", kind="phone", status="queued"))
    db.add(ScheduleItem(id="s2", day=DAY, time="10:00", prospect="Bo Ltd", mission="Demo", kind="video", status="queued", meeting_id="m1"))  # the same booking
    db.add(LeadAccount(id="l1", name="Dee Co", stage="interested", next_action="Call back", next_action_at=datetime(2026, 11, 3, 14, 0)))
    db.add(LeadAccount(id="l2", name="Gone Co", stage="do_not_contact", next_action_at=datetime(2026, 11, 3, 15, 0)))
    db.add(SocialPost(id="p1", title="Spring offer", copy="x", channels=["linkedin", "x"], status="approved", due_at_ms=_ms(9), time="09:00"))
    db.add(SocialPost(id="p_test", title="Rehearsal", copy="x", channels=["facebook"], status="published", due_at_ms=_ms(9, 30), time="09:30",
                      publish_results=[{"ok": True, "platform": "facebook", "test": True}]))
    db.add(SocialPost(id="p_next", title="Tomorrow", copy="x", channels=["facebook"], status="approved", due_at_ms=_ms(9) + 86400000, time="09:00"))
    db.add(EmailCampaign(id="c1", name="Spring", status="running"))
    await db.flush()
    for i, when in enumerate((datetime(2026, 11, 3, 8, 30), datetime(2026, 11, 3, 13, 0), datetime(2026, 11, 4, 8, 30))):
        db.add(EmailEnrollment(id=f"e{i}", campaign_id="c1", email=f"p{i}@x.test", status="active", next_action_at=when))
    db.add(EmailEnrollment(id="e_done", campaign_id="c1", email="d@x.test", status="completed", next_action_at=datetime(2026, 11, 3, 9, 0)))
    db.add(EmailMessage(id="em1", campaign_id="c1", recipient_email="a@x.test", status="replied", sent_at=datetime(2026, 11, 3, 9, 0),
                        replied_at=datetime(2026, 11, 3, 12, 0), is_warmup=False))
    db.add(EmailMessage(id="em2", campaign_id="c1", recipient_email="b@x.test", status="sent", sent_at=datetime(2026, 11, 3, 9, 5), is_warmup=False))
    db.add(EmailMessage(id="em_w", recipient_email="w@x.test", status="sent", sent_at=datetime(2026, 11, 3, 9, 6), is_warmup=True))  # warm-up mail is not a task
    await db.commit()


def _plugins(res):
    return [g["plugin"] for g in res["groups"]]


def _group(res, plugin):
    return next(g for g in res["groups"] if g["plugin"] == plugin)["items"]


async def test_the_day_lists_every_app_with_the_one_in_focus_first(client, db):
    await _seed(db)
    res = (await client.get(f"/api/together/agenda?date={DAY}&focus=voice")).json()
    assert res["date"] == DAY and res["timezone"] == "Europe/London" and _plugins(res) == ["voice", "leads", "social"] and res["focus"] == "voice"

    voice = _group(res, "voice")
    assert [(i["kind"], i["time"]) for i in voice] == [("meeting", "10:00"), ("scheduled_call", "11:00"), ("callback", "14:00")]  # the double booking shows once
    assert voice[0]["title"] == "Video meeting with Bo Ltd" and voice[0]["status"] == "Upcoming" and voice[0]["href"] == "#/voice/schedule"
    assert voice[2]["title"] == "Call back: Dee Co"  # the do-not-contact lead's callback is not offered

    social = _group(res, "social")
    assert [i["title"] for i in social] == ["LinkedIn + X: Spring offer"] and social[0]["time"] == "09:00" and social[0]["status"] == "Approved"

    leads = {i["kind"]: i for i in _group(res, "leads")}
    assert leads["campaign_emails"]["title"] == "2 emails due: Spring" and leads["campaign_emails"]["time"] == "08:30"  # the other day's and the finished one's are not
    assert leads["emails_sent"]["title"] == "2 campaign emails sent" and leads["replies"]["title"] == "1 reply to your campaigns"
    assert res["total"] == 3 + 1 + 3

    for focus, order in (("social", ["social", "leads", "voice"]), ("leads", ["leads", "voice", "social"]), ("", ["leads", "voice", "social"]), ("nonsense", ["leads", "voice", "social"])):
        assert _plugins((await client.get(f"/api/together/agenda?date={DAY}&focus={focus}")).json()) == order
    # timed items come in time order, the ones without a time after them
    assert [i["kind"] for i in _group((await client.get(f"/api/together/agenda?date={DAY}&focus=leads")).json(), "leads")][0] == "campaign_emails"


async def test_an_empty_day_and_a_bad_date(client):
    res = (await client.get("/api/together/agenda?date=2031-01-01")).json()
    assert res["total"] == 0 and all(g["items"] == [] for g in res["groups"])
    today = (await client.get("/api/together/agenda")).json()
    assert len(today["date"]) == 10
    assert (await client.get("/api/together/agenda?date=tomorrow")).status_code == 400
    assert (await client.get("/api/together/agenda?date=2026-02-31")).status_code == 400


async def test_the_day_is_the_companys_own_day_not_utc():
    from app.services.agenda import window

    assert window("2026-11-03", "Europe/London") == (datetime(2026, 11, 3, 0, 0), datetime(2026, 11, 4, 0, 0))
    assert window("2026-07-01", "Europe/London") == (datetime(2026, 6, 30, 23, 0), datetime(2026, 7, 1, 23, 0))  # summer time: the day began an hour earlier in UTC
    assert window("2026-07-01", "Asia/Kolkata")[0] == datetime(2026, 6, 30, 18, 30)


async def test_only_the_apps_the_company_has_are_shown_and_callbacks_move_to_leads(client, db, monkeypatch):
    await _seed(db)

    async def availability(_db, _org):
        return {"plugins": {"voice": False, "leads": True, "social": True}, "links": {}}

    monkeypatch.setattr("app.services.connections.availability", availability)
    res = (await client.get(f"/api/together/agenda?date={DAY}&focus=voice")).json()
    assert _plugins(res) == ["leads", "social"]  # no Voice, so it cannot be the focus
    assert [i["kind"] for i in _group(res, "leads") if i["kind"] == "callback"] == ["callback"]  # the follow-up is still on the day, as a Leads task
    assert not any(i["kind"] in ("meeting", "scheduled_call") for g in res["groups"] for i in g["items"])


async def test_everyone_signed_in_can_read_the_day_but_a_visitor_cannot(db, anon):
    _, op = await make_user(db, "plain_agenda", "Operator")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=__import__("app.main", fromlist=["app"]).app), base_url="http://test",
                                 headers={"Authorization": f"Bearer {op}"}) as c:
        assert (await c.get(f"/api/together/agenda?date={DAY}")).status_code == 200
    assert (await anon.get(f"/api/together/agenda?date={DAY}")).status_code == 401
