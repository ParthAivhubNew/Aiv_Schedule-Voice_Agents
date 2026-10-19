"""Overview, Insights, post results and the publish loop's new rules, on a real database."""
import time
from datetime import datetime, timedelta

import pytest

from app.api import scheduler as S
from app.models.models import Meeting, SocialAccount, SocialPost
from app.services import social_metrics as SM

pytestmark = pytest.mark.db


def _published(pid, title, channel="facebook", days_ago=1, remote="111_222"):
    at = datetime.utcnow() - timedelta(days=days_ago)
    return SocialPost(id=pid, title=title, copy="Body", channels=[channel], status="published", published_at=at.isoformat(),
                      due_at_ms=at.timestamp() * 1000,
                      publish_results=[{"ok": True, "platform": channel, "id": remote, "url": f"https://example.test/{pid}", "accountId": "acc_fb"}])


async def test_results_sync_overview_and_insights(db, client, monkeypatch):
    db.add(SocialAccount(id="acc_fb", platform="facebook", handle="Acme Page", account_id="999", access_token="tok", status="connected"))
    db.add(SocialAccount(id="acc_li", platform="linkedin", handle="Ann", account_id="sub", access_token="tok", status="expired",
                         last_error="LinkedIn refused to renew the login (400). Reconnect the account."))
    db.add(_published("v2_a", "Spring offer"))
    db.add(_published("v2_b", "Team story", days_ago=2, remote="333_444"))
    db.add(SocialPost(id="v2_f", title="Broken one", copy="x", channels=["x"], status="failed", due_at_ms=time.time() * 1000,
                      publish_results=[{"ok": False, "platform": "x", "error": "401: Unauthorized"}]))
    db.add(SocialPost(id="v2_n", title="Next up", copy="y", channels=["facebook"], status="approved", due_at_ms=time.time() * 1000 + 3600000))
    db.add(Meeting(id="m1", prospect="Bo", mission="Booked from a post", date="2026-10-10", time="10:00", status="confirmed", source_post_id="v2_a"))
    await db.commit()

    async def numbers(account, platform, remote):
        return {"reach": 500, "impressions": 900, "likes": 30, "comments": 5, "shares": 2} if remote == "111_222" \
            else {"reach": 100, "likes": 3}

    async def followers(account):
        return 1200 if account.platform == "facebook" else None

    async def fresh(db, acc, **kw):
        return {"ok": True, "refreshed": False}

    from app.services import social_tokens
    monkeypatch.setattr(SM, "read_post_numbers", numbers)
    monkeypatch.setattr(SM, "read_followers", followers)
    monkeypatch.setattr(social_tokens, "ensure_fresh_token", fresh)

    r = await client.post("/api/scheduler/insights/sync")
    assert r.status_code == 200, r.text
    assert r.json()["channels"] == 2 and r.json()["followers"] == 1
    # Read again straight away: nothing is due yet, so the networks are not asked twice.
    assert (await client.post("/api/scheduler/insights/sync")).json()["channels"] == 0

    ov = (await client.get("/api/scheduler/overview")).json()
    assert ov["counts"]["failed"] == 1 and ov["counts"]["nextSevenDays"] == 1
    assert ov["failed"][0]["kind"] == "login" and "reconnect" in ov["failed"][0]["text"]
    assert [a["platform"] for a in ov["reconnect"]] == ["linkedin"]
    assert ov["upcoming"][0]["id"] == "v2_n"
    assert ov["week"]["totals"]["reach"] == 600 and ov["week"]["meetings"] == 1

    ins = (await client.get("/api/scheduler/insights?days=30")).json()
    assert ins["totals"]["reach"] == 600 and ins["totals"]["engagements"] == 40
    assert ins["totals"]["clicks"] is None  # never reported, so not shown as 0
    assert ins["top"][0]["id"] == "v2_a" and ins["top"][0]["meetings"] == 1
    assert ins["bestTimes"] is None  # fewer than 8 measured posts
    fb = next(f for f in ins["followers"] if f["accountId"] == "acc_fb")
    assert fb["followers"] == 1200
    assert (await client.get("/api/scheduler/insights?days=12")).status_code == 400

    res = (await client.get("/api/scheduler/posts/v2_a/results")).json()
    assert res["totals"]["likes"] == 30 and res["meetings"] == 1 and res["links"][0]["url"].endswith("v2_a")

    accts = {a["id"]: a for a in (await client.get("/api/scheduler/accounts")).json()}
    assert accts["acc_fb"]["followers"] == 1200 and accts["acc_fb"]["resultsSyncedAt"]


async def test_editor_fields_and_issues_round_trip(db, client):
    db.add(SocialPost(id="v2_e", title="Short", copy="z" * 300, channels=["x"], status="approved", due_at_ms=time.time() * 1000 + 86400000,
                      approved_by="app", approved_at=datetime.utcnow()))
    await db.commit()
    r = await client.patch("/api/scheduler/posts/v2_e", json={"altText": "A team at a desk", "firstComment": "Link in here"})
    post = r.json()["post"]
    assert post["altText"] == "A team at a desk" and post["firstComment"] == "Link in here"
    assert post["status"] == "approved"  # extras are not reviewed content: the approval stands
    assert post["issues"] and post["issues"][0]["channel"] == "x"


async def test_publish_loop_refuses_too_long_and_retries_only_busy_networks(db, client, monkeypatch):
    now = time.time() * 1000
    db.add(SocialAccount(id="acc_x", platform="x", handle="@acme", access_token="tok", status="connected", is_default=True))
    db.add(SocialPost(id="v2_long", title="Long", copy="a" * 400, channels=["x"], status="approved", due_at_ms=now - 1000))
    db.add(SocialPost(id="v2_busy", title="Busy", copy="ok", channels=["x"], status="approved", due_at_ms=now - 1000))
    await db.commit()

    sent = []

    async def publish(post, accounts, base=None, **kw):
        sent.append(post.id)
        return {"ok": False, "allOk": False, "results": [{"ok": False, "platform": "x", "error": "503: Service Unavailable", "kind": "temporary"}]}

    async def no_mail(*a, **k):
        return 0

    monkeypatch.setattr(S, "publish_post_to_accounts", publish)
    monkeypatch.setattr(S.approval_mail, "send_results", no_mail)
    monkeypatch.setattr(S.approval_mail, "request_approvals", no_mail)
    await S.run_publish_due(db)

    long_post = await db.get(SocialPost, "v2_long")
    await db.refresh(long_post)
    assert long_post.status == "failed" and "400 characters" in S._last_error(long_post)
    assert "v2_long" not in sent  # never sent to X to be cut off
    busy = await db.get(SocialPost, "v2_busy")
    await db.refresh(busy)
    assert busy.status == "approved" and busy.publish_attempts == 1 and busy.retry_at_ms > now
