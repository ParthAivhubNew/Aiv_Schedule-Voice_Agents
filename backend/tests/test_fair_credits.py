"""Fair credits: AI work is held at the price when it starts, charged only when it succeeds,
given back when it fails, never overspends, pauses at zero and continues after a top-up; a
broken credit check never stops work, and anything it could not charge is charged next run."""
from datetime import datetime, timedelta

import pytest

pytestmark = pytest.mark.db


async def _credits(db, amount):
    from app.services import credits as K

    await K.add_credits(db, "scheduler", amount, source="grant", note="Test")
    await K.set_org_settings(db, {"enforce": True})
    await db.commit()


def _part(ref, item="ai_post"):
    return {"ref": ref, "item": item, "quantity": 1}


async def test_hold_confirm_release_at_the_starting_price(db):
    from app.services import credits as K

    await _credits(db, 5)
    assert (await K.hold(db, [_part("gen:a"), _part("genimg:a", "ai_image")]))[0] is True
    await db.commit()
    assert await K.wallet_balance(db, "scheduler") == 2  # 3 held
    scheduler_wallet = next(w for w in await K.wallets(db) if w["key"] == "scheduler")
    assert scheduler_wallet["held"] == 3

    # 2 left: a post and its image (3) would go below zero by one: refused, nothing held.
    ok, why = await K.hold(db, [_part("gen:b"), _part("genimg:b", "ai_image")])
    assert not ok and "Social" in why
    assert await K.wallet_balance(db, "scheduler") == 2

    # The price is fixed when the work starts.
    await K.set_rates(db, {"ai_post": 9})
    assert await K.confirm(db, "gen:a", "ai_post") == 2
    assert await K.confirm(db, "gen:a", "ai_post") == 0  # charged once
    assert await K.release(db, ["genimg:a"]) == 1  # the image failed: free
    await db.commit()
    assert await K.wallet_balance(db, "scheduler") == 3


async def test_a_broken_check_never_stops_work_and_owed_charges_come_with_the_next_run(db, monkeypatch):
    from app.services import credits as K

    await _credits(db, 10)

    async def broken(*a, **k):
        raise RuntimeError("database hiccup")

    real_lock = K._lock
    monkeypatch.setattr(K, "_lock", broken)
    assert await K.hold(db, [_part("gen:x")]) == (True, "")  # runs anyway
    await K.confirm_safely(db, "gen:x", "ai_post", 1, "AI-written post")  # cannot be written: kept
    assert K._OWED.get("org_default")
    monkeypatch.setattr(K, "_lock", real_lock)

    # The next run charges both: the one owed and its own.
    assert (await K.hold(db, [_part("gen:y")]))[0] is True
    await db.commit()
    assert not K._OWED.get("org_default")
    assert await K.wallet_balance(db, "scheduler") == 10 - 2 - 2  # 2 charged, 2 held


async def test_stale_holds_are_given_back(db):
    from app.services import credits as K

    await _credits(db, 4)
    assert (await K.hold(db, [_part("gen:old")]))[0]
    await db.commit()
    assert await K.drop_stale_holds(db, datetime.utcnow() + K.HOLD_TTL + timedelta(minutes=1)) == 1
    assert await K.wallet_balance(db, "scheduler") == 4


async def _posts_and_jobs(db, n, skip_image=False, prefix="p"):
    from app.models.models import SocialPost
    from app.services import generation_queue as Q

    for i in range(n):
        db.add(SocialPost(id=f"{prefix}{i}", title=f"Post {i}", copy="", status="draft"))
    await db.flush()
    ids = await Q.enqueue(db, [{"post_ids": [f"{prefix}{i}"], "plan": f"Plan {i}", "headline": f"Post {i}", "skip_image": skip_image}
                               for i in range(n)])
    await db.commit()
    return ids


async def test_queue_pauses_at_zero_then_continues_or_starts_new(client, db, monkeypatch):
    from sqlalchemy.future import select

    from app.models.models import SocialGenJob, SocialPost
    from app.services import credits as K
    from app.services import generation_queue as Q

    written = []

    async def fake_batch(items, **kw):
        written.extend(i["key"] for i in items)
        return {i["key"]: {"copy": "Written", "postTitle": "T", "generationSource": "llm"} for i in items}

    async def fake_resolve(db, payload=None, slot="main"):
        return {"error": "", "api_key": "k", "provider": "p", "model": "m", "base_url": ""}

    monkeypatch.setattr("app.services.post_writer.write_post_batch", fake_batch)
    monkeypatch.setattr("app.api.scheduler._resolve_text_ai", fake_resolve)
    await _credits(db, 5)  # one post with image (3); the second (3) would cross zero
    ids = await _posts_and_jobs(db, 3)

    jobs = await Q._claim("queued", "writing", Q.MAX_POSTS_PER_CALL, text_batch=True)
    await Q._run_text(jobs)
    assert written == [ids[0]]
    db.expire_all()
    states = {j.id: j.state for j in (await db.execute(select(SocialGenJob))).scalars().all()}
    assert states == {ids[0]: "image_queued", ids[1]: "paused", ids[2]: "paused"}
    posts = {p.id: p for p in (await db.execute(select(SocialPost))).scalars().all()}
    assert posts["p1"].gen_state == "paused" and "Social" in posts["p1"].gen_error
    assert await K.wallet_balance(db, "scheduler") == 2  # post charged (2), image held (1)
    assert (await client.get("/api/scheduler/generate/paused")).json() == {"jobs": 2, "posts": 2}

    # Still no credits: continuing is refused and nothing changes.
    await K.set_rates(db, {"ai_post": 3})
    await db.commit()
    assert (await client.post("/api/scheduler/generate/resume", json={"action": "continue"})).status_code == 402
    await K.set_rates(db, {"ai_post": 2})
    await db.commit()

    # After a top-up: continue where it stopped.
    await K.add_credits(db, "scheduler", 10, source="topup")
    await db.commit()
    r = (await client.post("/api/scheduler/generate/resume", json={"action": "continue"})).json()
    assert r["resumed"] == 2
    db.expire_all()
    assert {j.state for j in (await db.execute(select(SocialGenJob).where(SocialGenJob.id != ids[0]))).scalars().all()} == {"queued"}

    # Or start new: what was waiting is dropped, uncharged.
    await Q._pause([ids[1], ids[2]], "Out")
    balance = await K.wallet_balance(db, "scheduler")
    r = (await client.post("/api/scheduler/generate/resume", json={"action": "new"})).json()
    assert r["dropped"] == 2
    db.expire_all()
    assert (await db.execute(select(SocialPost).where(SocialPost.id == "p2"))).scalars().first().gen_state is None
    assert await K.wallet_balance(db, "scheduler") == balance


async def test_failed_writing_is_free_and_a_failed_image_keeps_only_the_post_charge(db, monkeypatch):
    from app.services import credits as K
    from app.services import generation_queue as Q

    async def fake_resolve(db, payload=None, slot="main"):
        return {"error": "", "api_key": "k", "provider": "p", "model": "m", "base_url": ""}

    async def broken_batch(items, **kw):
        raise RuntimeError("provider down")

    monkeypatch.setattr("app.api.scheduler._resolve_text_ai", fake_resolve)
    monkeypatch.setattr("app.services.post_writer.write_post_batch", broken_batch)
    await _credits(db, 10)
    await _posts_and_jobs(db, 1)
    for _ in range(Q.MAX_ATTEMPTS):
        jobs = await Q._claim("queued", "writing", Q.MAX_POSTS_PER_CALL, text_batch=True)
        await Q._run_text(jobs)
    db.expire_all()
    assert await K.wallet_balance(db, "scheduler") == 10  # failed after every attempt: free

    async def ok_batch(items, **kw):
        return {i["key"]: {"copy": "Written", "postTitle": "T", "generationSource": "llm"} for i in items}

    async def no_image(*a, **k):
        return {"status": "error", "imageUrl": None}

    monkeypatch.setattr("app.services.post_writer.write_post_batch", ok_batch)
    monkeypatch.setattr("app.api.scheduler._image_with_backup", no_image)
    await _posts_and_jobs(db, 1, prefix="q")
    await Q._run_text(await Q._claim("queued", "writing", Q.MAX_POSTS_PER_CALL, text_batch=True))
    await Q._run_image((await Q._claim("image_queued", "imaging", 1, text_batch=False))[0])
    db.expire_all()
    assert await K.wallet_balance(db, "scheduler") == 8  # the post (2); the failed image is free
    entries = [h for h in await K.history(db) if h["kind"] == "usage"]
    assert [(e["item"], e["amount"]) for e in entries] == [("ai_post", -2)]
