"""Media library, carousels, bulk import, tracked links, test mode, reports, listening and learned style,
on a real database."""
import io
import time
from datetime import datetime, timedelta

import pytest
from sqlalchemy.future import select

from app.api import scheduler as S
from app.models.models import SocialLink, SocialLinkClick, SocialMention, SocialPost, SocialPostVersion

pytestmark = pytest.mark.db

PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x02\x00\x00\x00\x02\x08\x02\x00\x00\x00\xfd\xd4\x9as"
       b"\x00\x00\x00\x16IDATx\x9cc\xf8\xcf\xc0\xf0\x9f\x81\x81\x81\xe1?\x03\x03\x03\x00&\x06\x04\xfd\xa5\xc1\xa7\x8b"
       b"\x00\x00\x00\x00IEND\xaeB`\x82") + b"\x00" * 300
BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


async def _upload(client, name="a.png", data=PNG, mime="image/png"):
    res = await client.post("/api/scheduler/library/upload", files=[("files", (name, io.BytesIO(data), mime))], data={"tags": "Team, office"})
    assert res.status_code == 200, res.text
    return res.json()["items"][0]


async def _save(client, pid, **kw):
    body = {"id": pid, "title": "T " + pid, "copy": "Copy " + pid, "channels": ["linkedin"], "status": "awaiting_approval",
            "date": (datetime.utcnow() + timedelta(days=3)).date().isoformat(), "time": "09:00", **kw}
    res = await client.post("/api/scheduler/posts/create", json=body)
    assert res.status_code == 200, res.text
    return res.json()["post"]


async def test_library_carousel_and_in_use_guard(client, db):
    a = await _upload(client, "a.png")
    b = await _upload(client, "b.png")
    assert a["kind"] == "image" and a["width"] == 2 and a["tags"] == ["team", "office"]
    bad = await client.post("/api/scheduler/library/upload", files=[("files", ("x.gif", io.BytesIO(b"GIF89a" + b"0" * 300), "image/gif"))])
    assert bad.status_code == 400 and "PNG" in bad.json()["detail"]

    await _save(client, "v2_car", channels=["instagram"])
    res = await client.patch("/api/scheduler/posts/v2_car", json={"media": [{"id": b["id"], "alt": "Second"}, {"id": a["id"]}]})
    assert res.status_code == 200, res.text
    post = res.json()["post"]
    assert [m["id"] for m in post["media"]] == [b["id"], a["id"]] and post["imageUrl"] == b["url"]
    assert post["altText"] == "Second" and post["issues"] == []
    versions = (await client.get("/api/scheduler/posts/v2_car/versions")).json()["versions"]
    assert versions and versions[0]["source"] == "you" and len(versions[0]["media"]) == 2

    # An AI redraw sets image_url: the carousel's first picture follows it.
    row = await db.get(SocialPost, "v2_car")
    await db.refresh(row)
    row.image_url = "/api/scheduler/media/0123456789abcdef.png"
    await db.commit()
    await db.refresh(row)
    assert row.media[0]["url"] == "/api/scheduler/media/0123456789abcdef.png" and row.media[1]["id"] == a["id"]

    lib = (await client.get("/api/scheduler/library")).json()
    assert {i["id"]: i["usedBy"] for i in lib["items"]}[a["id"]] == 1 and "team" in lib["tags"]
    assert (await client.delete(f"/api/scheduler/library/{a['id']}")).status_code == 409
    assert (await client.delete(f"/api/scheduler/library/{a['id']}?force=true")).status_code == 200
    missing = await client.patch("/api/scheduler/posts/v2_car", json={"media": [{"id": "med_gone"}]})
    assert missing.status_code == 400


async def test_reddit_options_and_media_rules_reach_the_post(client):
    await _save(client, "v2_red", channels=["reddit"])
    post = (await client.patch("/api/scheduler/posts/v2_red", json={"channelOptions": {"reddit": {"subreddit": "bad name!"}}}))
    assert post.status_code == 400
    post = (await client.patch("/api/scheduler/posts/v2_red", json={"channelOptions": {"reddit": {"subreddit": "r/smallbusiness"}}})).json()["post"]
    assert post["channelOptions"]["reddit"]["subreddit"] == "smallbusiness" and post["issues"] == []
    noreddit = (await client.patch("/api/scheduler/posts/v2_red", json={"channelOptions": {"reddit": {"subreddit": ""}}})).json()["post"]
    assert noreddit["issues"][0]["kind"] == "setup"


async def test_import_check_and_commit(client, db):
    future = (datetime.utcnow() + timedelta(days=10)).date().isoformat()
    csv = ("date,time,channels,title,text,subreddit\n"
           f"{future},10:00,\"linkedin, x\",Launch,Our launch is live: https://acme.test/launch,\n"
           f"{future},11:00,reddit,What do you use?,Honest question for founders,smallbusiness\n"
           f"{future},25:00,myspace,,,\n")
    res = await client.post("/api/scheduler/import/check", files={"file": ("posts.csv", io.BytesIO(csv.encode()), "text/csv")})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["summary"] == {"rows": 3, "ready": 2, "problems": 1, "posts": 3, "aiWritten": 0}
    assert any("time" in i for i in body["rows"][2]["issues"])

    res = await client.post("/api/scheduler/import/commit", json={"rows": body["rows"], "approve": True})
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["created"] == 3 and len(out["failed"]) == 1 and out["failed"][0]["row"] == 4
    posts = (await db.execute(select(SocialPost).where(SocialPost.source == "import"))).scalars().all()
    assert len(posts) == 3 and all(p.id.startswith("v2_") and p.status == "approved" for p in posts)
    red = next(p for p in posts if p.channels == ["reddit"])
    assert red.channel_options["reddit"]["subreddit"] == "smallbusiness" and red.title == "What do you use?"
    template = (await client.get("/api/scheduler/import/template")).json()
    assert template["csv"].startswith("date,time,channels")


async def test_test_mode_publishes_nothing_and_tracks_links(client, anon, db, monkeypatch):
    res = await client.put("/api/scheduler/settings/extras", json={"testMode": {"on": True, "outcome": "ok"}})
    assert res.json()["testMode"] == {"on": True, "outcome": "ok"} and res.json()["trackLinks"] is True

    async def never(*a, **k):
        raise AssertionError("test mode must not reach a network")

    monkeypatch.setattr(S, "_draw_missing_image", never)
    await _save(client, "v2_tm", channels=["linkedin", "instagram"], copy="Read the guide: https://acme.test/guide?ref=1.")
    res = await client.post("/api/scheduler/posts/v2_tm/publish", json={})
    assert res.status_code == 200, res.text
    post = res.json()["post"]
    assert post["status"] == "published" and post["test"] is True
    sent = {r["platform"]: r["text"] for r in post["publishResults"]}
    assert "/api/l/" in sent["linkedin"] and "acme.test" not in sent["linkedin"]
    assert "https://acme.test/guide?ref=1" in sent["instagram"]  # not clickable on Instagram: left alone

    link = (await db.execute(select(SocialLink).where(SocialLink.post_id == "v2_tm"))).scalars().first()
    assert "utm_source=linkedin" in link.target_url and "ref=1" in link.target_url
    hop = await anon.get(f"/api/l/{link.id}", headers={"User-Agent": BROWSER})
    assert hop.status_code == 302 and hop.headers["location"] == link.target_url
    await anon.get(f"/api/l/{link.id}", headers={"User-Agent": "LinkedInBot/1.0"})  # a preview robot: not counted
    assert (await anon.get("/api/l/Nope1234", headers={"User-Agent": BROWSER})).status_code == 404
    clicks = (await db.execute(select(SocialLinkClick))).scalars().all()
    assert len(clicks) == 1 and clicks[0].platform == "linkedin"

    results = (await client.get("/api/scheduler/posts/v2_tm/results")).json()
    assert results["test"] is True and results["linkClicks"] == 1 and results["trackedLinks"][0]["clicks"] == 1
    overview = (await client.get("/api/scheduler/overview")).json()
    assert overview["counts"]["publishedThisMonth"] == 0  # test posts are not counted
    insights = (await client.get("/api/scheduler/insights?days=7")).json()
    assert insights["totals"]["linkClicks"] == 1

    await client.put("/api/scheduler/settings/extras", json={"testMode": {"on": True, "outcome": "busy"}})
    await _save(client, "v2_tb", copy="Busy test")
    res = (await client.post("/api/scheduler/posts/v2_tb/publish", json={})).json()["post"]
    assert res["status"] == "failed" and res["failKind"] == "temporary" and "Test mode" in res["lastError"]


async def test_reports_preview_send_and_public_link(client, anon, db, monkeypatch):
    from app.core import mailer

    sent = []

    async def fake_send(to, subject, html_body, text_body, reply_to=None):
        sent.append({"to": to, "subject": subject, "html": html_body})
        return {"ok": True}

    monkeypatch.setattr(mailer, "configured", lambda: True)
    monkeypatch.setattr(mailer, "send_system_email", fake_send)
    bad = await client.post("/api/scheduler/reports", json={"name": "Acme", "frequency": "weekly"})
    assert bad.status_code == 400
    res = await client.post("/api/scheduler/reports", json={"name": "Acme monthly", "days": 30, "recipients": ["client@acme.test"],
                                                           "frequency": "monthly", "intro": "Hi team"})
    assert res.status_code == 200, res.text
    rep, link = res.json()["report"], res.json()["link"]
    preview = (await client.get(f"/api/scheduler/reports/{rep['id']}/preview")).json()
    assert "Posts published" in preview["html"] and "Hi team" in preview["html"]
    res = await client.post(f"/api/scheduler/reports/{rep['id']}/send", json={})
    assert res.status_code == 200 and res.json()["sent"] == 1 and sent[0]["to"] == "client@acme.test"
    assert "Open the full report" in sent[0]["html"]
    page = await anon.get(link[link.index("/api/"):])
    assert page.status_code == 200 and "Print or save as PDF" in page.text
    assert (await anon.get("/api/scheduler/report-view?t=forged")).status_code == 404
    assert len((await client.get("/api/scheduler/reports")).json()["reports"]) == 1


async def test_listening_saves_mentions_and_makes_leads(client, db, monkeypatch):
    from app.services import social_listening as LS

    async def fake_reddit(db, keywords, exclude):
        return [{"remote": "t3_a", "author": "u/ann", "author_url": "https://www.reddit.com/user/ann", "title": "Anyone tried Acme?",
                 "text": "Looking for a CRM", "url": "https://www.reddit.com/r/x/comments/a", "where": "r/x", "score": 4,
                 "at": datetime.utcnow()},
                {"remote": "t3_b", "author": "u/bob", "title": "Acme jobs", "text": "hiring", "url": "u", "at": None}]

    monkeypatch.setattr(LS, "search_reddit", fake_reddit)
    res = await client.post("/api/scheduler/listening/topics", json={"keywords": "acme", "exclude": "jobs", "sources": ["reddit", "x"]})
    assert res.status_code == 200, res.text
    topic = res.json()["topic"]
    assert res.json()["found"] == 1 and "X account" in topic["errors"]["x"]
    mentions = (await client.get("/api/scheduler/listening/mentions")).json()["mentions"]
    assert [m["author"] for m in mentions] == ["u/ann"]
    again = await client.post(f"/api/scheduler/listening/topics/{topic['id']}/check")
    assert again.json()["found"] == 0  # the same post is kept once
    leads = (await client.post("/api/scheduler/listening/mentions/leads", json={"ids": [mentions[0]["id"]]})).json()
    assert leads["added"] == 1
    m = await db.get(SocialMention, mentions[0]["id"])
    await db.refresh(m)
    assert m.lead_id and m.status == "seen"
    over = (await client.get("/api/scheduler/listening")).json()
    assert over["topics"][0]["newCount"] == 0 and over["sources"]["x"] is False


async def test_learned_style_from_edits(client, db, monkeypatch):
    from app.services import platform_ai

    no = await client.post("/api/scheduler/brand-voice/learn")
    assert no.status_code == 400 and "Not enough" in no.json()["detail"]
    for i in range(3):
        db.add(SocialPostVersion(id=f"ver_{i}a", post_id=f"p{i}", source="ai", title="t", copy="Unlock synergy today! 🚀"))
        db.add(SocialPostVersion(id=f"ver_{i}b", post_id=f"p{i}", source="you", title="t", copy="We cut close time to one day.",
                                 created_at=datetime.utcnow() + timedelta(seconds=1)))
    await db.commit()

    async def fake_ai(db, kind, attempt, scope="scheduler"):
        return {"reply": '{"rules": ["Lead with a concrete number.", "No emojis."]}'}

    monkeypatch.setattr(platform_ai, "run_with_backup", fake_ai)
    res = await client.post("/api/scheduler/brand-voice/learn")
    assert res.status_code == 200, res.text
    assert res.json()["learned"]["rules"] == ["Lead with a concrete number.", "No emojis."]
    voice = (await client.get("/api/scheduler/brand-voice")).json()
    assert voice["learned"]["on"] is True and voice["learned"]["basedOn"]["edits"] == 3
    off = (await client.put("/api/scheduler/brand-voice/learned", json={"on": False, "rules": ["No emojis."]})).json()["learned"]
    assert off == {**off, "on": False, "rules": ["No emojis."]}
