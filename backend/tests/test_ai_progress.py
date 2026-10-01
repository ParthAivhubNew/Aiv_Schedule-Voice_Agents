"""AI work shows its progress and fails with a code: users see the code and a plain message,
staff get the detail (banner + email) for what only they can fix, and a finished batch leaves a
note in the company's bell."""
import pytest

from tests.conftest import make_staff

pytestmark = pytest.mark.db


def test_provider_errors_get_the_right_code():
    from app.services.ai_errors import classify, code_of, message

    assert classify("openai: 401 invalid api key") == "AI-02"
    assert classify("Error: insufficient_quota") == "AI-02"
    assert classify("The model `gpt-9` does not exist") == "AI-03"
    assert classify("503 Service Unavailable") == "AI-01"
    assert classify("No reply within 5 minutes.") == "AI-04"
    assert classify("Your request was flagged by our content policy") == "USR-03"
    assert classify("maximum context length is 8192 tokens") == "USR-04"
    assert classify("KeyError: 'choices'") == "AI-99"
    assert code_of(message("AI-01")) == "AI-01"
    assert "Reference ERR-1" in message("AI-99", "ERR-1")


async def _profile(db, name="Acme"):
    from app.models.models import CompanyProfile

    db.add(CompanyProfile(id="default", name=name))
    await db.commit()


async def _post(db, pid):
    from app.models.models import SocialPost

    db.add(SocialPost(id=pid, title="T", copy="", status="draft"))
    await db.commit()


async def test_user_mistakes_are_refused_with_their_code(client, db):
    await _post(db, "p1")
    body = {"groups": [{"postIds": ["p1"], "plan": "A post"}]}
    r = await client.post("/api/scheduler/generate", json=body)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "USR-05"  # no company profile yet

    await _profile(db)
    r = await client.post("/api/scheduler/generate", json={"groups": [{"postIds": ["p1"], "plan": "x" * 5000}]})
    assert r.json()["detail"]["code"] == "USR-04"
    r = await client.post("/api/scheduler/generate", json={"groups": [{"postIds": [f"q{i}"], "plan": "p"} for i in range(51)]})
    assert r.json()["detail"]["code"] == "USR-02"

    from app.services import credits as K

    await K.set_org_settings(db, {"enforce": True})
    await db.commit()
    r = await client.post("/api/scheduler/generate", json=body)
    assert r.status_code == 402 and r.json()["detail"].startswith("USR-01")


async def test_failed_writing_shows_a_code_and_tells_staff_about_our_keys(client, db, monkeypatch):
    from sqlalchemy.future import select

    from app.models.models import Notification, SocialPost
    from app.services import ai_errors, credits as K, generation_queue as Q

    sent = []

    async def fake_mail(to, subject, html, text):
        sent.append((to, subject))
        return {"ok": True}

    async def fake_resolve(db, payload=None, slot="main"):
        return {"error": "", "api_key": "k", "provider": "p", "model": "m", "base_url": ""}

    async def broken(items, **kw):
        raise RuntimeError("openai: 401 invalid api key")

    monkeypatch.setenv("STAFF_ADMIN_EMAIL", "owner@example.com")
    monkeypatch.setattr("app.core.mailer.send_system_email", fake_mail)
    monkeypatch.setattr("app.api.scheduler._resolve_text_ai", fake_resolve)
    monkeypatch.setattr("app.services.post_writer.write_post_batch", broken)
    await _profile(db)
    await K.add_credits(db, "scheduler", 10, source="grant")
    await db.commit()
    await _post(db, "p1")
    r = await client.post("/api/scheduler/generate", json={"groups": [{"postIds": ["p1"], "plan": "A post", "skipImage": True}]})
    batch = r.json()["batch"]

    progress = (await client.get("/api/scheduler/generate/progress")).json()
    b = progress["batches"][0]
    assert b["batch"] == batch and b["active"] and b["queuePosition"] == 1 and progress["tips"]

    for _ in range(Q.MAX_ATTEMPTS):
        await Q._run_text(await Q._claim("queued", "writing", Q.MAX_POSTS_PER_CALL, text_batch=True))
    db.expire_all()
    post = (await db.execute(select(SocialPost).where(SocialPost.id == "p1"))).scalars().first()
    assert post.gen_state == "failed" and post.gen_error.startswith("AI-02:")
    assert "invalid api key" not in post.gen_error  # users never see the provider's error
    assert await K.wallet_balance(db, "scheduler") == 10  # nothing charged

    # Staff: one banner alert per failure, but one email per code and company.
    alerts = await ai_errors.alerts(db)
    assert alerts and alerts[0]["code"] == "AI-02" and "invalid api key" in alerts[0]["detail"]
    assert sent == [("owner@example.com", sent[0][1])] and "URGENT" in sent[0][1]

    # The batch is over: a note in the bell, and progress says it is done.
    notes = [n.text for n in (await db.execute(select(Notification))).scalars().all()]
    assert any("0 of 1 post ready, 1 failed (AI-02)" in n for n in notes)
    done = (await client.get("/api/scheduler/generate/progress")).json()["batches"][0]
    assert not done["active"] and done["failed"] == 1 and done["codes"] == ["AI-02"]

    token = await make_staff(db)
    import httpx

    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                 headers={"Authorization": f"Bearer {token}"}) as staff:
        got = (await staff.get("/api/admin-api/alerts")).json()
        assert got["unseen"] >= 1
        assert (await staff.post("/api/admin-api/alerts/all/seen")).json()["dismissed"] == got["unseen"]
        assert (await staff.get("/api/admin-api/alerts")).json()["unseen"] == 0


async def test_a_failed_image_shows_its_code_and_retries_only_the_image(client, db, monkeypatch):
    from sqlalchemy.future import select

    from app.models.models import SocialGenJob, SocialPost
    from app.services import credits as K, generation_queue as Q

    async def fake_resolve(db, payload=None, slot="main"):
        return {"error": "", "api_key": "k", "provider": "p", "model": "m", "base_url": ""}

    async def ok_batch(items, **kw):
        return {i["key"]: {"copy": "Written", "postTitle": "T", "generationSource": "llm"} for i in items}

    async def slow_image(*a, **k):
        raise RuntimeError("fal 503 overloaded")

    monkeypatch.setattr("app.api.scheduler._resolve_text_ai", fake_resolve)
    monkeypatch.setattr("app.services.post_writer.write_post_batch", ok_batch)
    monkeypatch.setattr("app.api.scheduler._image_with_backup", slow_image)
    await _profile(db)
    await K.add_credits(db, "scheduler", 10, source="grant")
    await db.commit()
    await _post(db, "p1")
    await client.post("/api/scheduler/generate", json={"groups": [{"postIds": ["p1"], "plan": "A post"}]})
    await Q._run_text(await Q._claim("queued", "writing", Q.MAX_POSTS_PER_CALL, text_batch=True))
    await Q._run_image((await Q._claim("image_queued", "imaging", 1, text_batch=False))[0])
    db.expire_all()
    post = (await db.execute(select(SocialPost).where(SocialPost.id == "p1"))).scalars().first()
    assert post.gen_state == "failed" and "AI-01" in post.gen_error and post.copy == "Written"
    await client.post("/api/scheduler/generate/retry", json={"postIds": ["p1"]})
    db.expire_all()
    job = (await db.execute(select(SocialGenJob))).scalars().first()
    assert job.state == "image_queued"
