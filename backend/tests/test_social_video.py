"""AI video clips: a job is held, made in the background, kept in the library, added to its post and charged
only when a clip comes back."""
import asyncio

import pytest

from app.models.models import SocialPost
from app.services import video_ai

pytestmark = pytest.mark.db


async def _wait(client, job_id):
    for _ in range(50):
        job = (await client.get(f"/api/scheduler/videos/{job_id}")).json()["job"]
        if job["state"] in ("done", "failed"):
            return job
        await asyncio.sleep(0.1)
    raise AssertionError("the job never finished")


async def test_video_clip_is_made_kept_and_added_to_its_post(client, db, monkeypatch):
    res = await client.get("/api/scheduler/videos")
    if res.json()["available"]:
        pytest.skip("a real video key is configured on this machine")
    assert (await client.post("/api/scheduler/videos", json={"prompt": "A barista pouring latte art"})).status_code == 503

    async def key(db, slot="main"):
        return {"provider": "fake", "key": "k", "model": "m"}

    async def fake(client, key, model, prompt, shape, seconds):
        assert shape == "9:16" and seconds == 5
        return b"\x00\x00\x00\x18ftypisom" + b"\x00" * 4000

    monkeypatch.setattr(video_ai, "find_key", key)
    monkeypatch.setitem(video_ai.PROVIDERS, "fake", fake)
    monkeypatch.setattr(video_ai, "POLL_S", 0)
    from app.core.tenancy import org_scope
    from app.services import credits

    with org_scope("org_default"):
        await credits.add_credits(db, "scheduler", 100, source="grant", note="Test")
        await db.commit()
    db.add(SocialPost(id="v2_vid", title="Latte", copy="Morning", channels=["instagram"], status="approved"))
    await db.commit()

    assert (await client.post("/api/scheduler/videos", json={"prompt": "short"})).status_code == 400
    res = await client.post("/api/scheduler/videos", json={"prompt": "A barista pouring latte art", "postId": "v2_vid"})
    assert res.status_code == 200, res.text
    job = await _wait(client, res.json()["job"]["id"])
    assert job["state"] == "done" and job["url"].endswith(".mp4")
    post = (await client.get("/api/scheduler/posts")).json()
    p = next(x for x in post if x["id"] == "v2_vid")
    assert p["media"][-1]["kind"] == "video" and p["status"] == "awaiting_approval"  # new content goes back for approval
    lib = (await client.get("/api/scheduler/library?kind=video")).json()["items"]
    assert lib and lib[0]["source"] == "ai"

    async def refuse(*a):
        raise video_ai.VideoFailed("The video AI refused this description. Try wording it differently.")

    monkeypatch.setitem(video_ai.PROVIDERS, "fake", refuse)
    job = await _wait(client, (await client.post("/api/scheduler/videos", json={"prompt": "Something it refuses to draw"})).json()["job"]["id"])
    assert job["state"] == "failed" and "refused" in job["error"]
