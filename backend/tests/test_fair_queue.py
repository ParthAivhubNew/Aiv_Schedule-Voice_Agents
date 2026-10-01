"""AI writing is shared fairly between companies: each has at most two calls running, the next
free slot goes to the company served least recently, and a company can have at most two
requests waiting or running (USR-06)."""
from datetime import datetime, timedelta

import pytest

pytestmark = pytest.mark.db


async def _jobs(org_id, n, start, batch="b1"):
    from app.core.tenancy import system_scope
    from app.database import AsyncSessionLocal
    from app.models.models import SocialGenJob

    with system_scope():
        async with AsyncSessionLocal() as s:
            for i in range(n):
                s.add(SocialGenJob(id=f"j_{org_id}_{i}", org_id=org_id, post_ids=[f"p_{org_id}_{i}"], plan="x",
                                   solo=True, state="queued", options={"batch": batch},
                                   created_at=start + timedelta(seconds=i)))
            await s.commit()


async def test_companies_take_turns_and_never_exceed_their_share(db, monkeypatch):
    from app.core.tenancy import system_scope
    from app.services import generation_queue as Q

    monkeypatch.setattr(Q, "_served", {})
    monkeypatch.setattr(Q, "_running", {})
    t0 = datetime.utcnow() - timedelta(minutes=5)
    await _jobs("org_big", 4, t0)  # queued first
    await _jobs("org_small", 1, t0 + timedelta(minutes=1))

    async def claim():
        with system_scope():
            jobs = await Q._claim("queued", "writing", Q.MAX_POSTS_PER_CALL, True, skip_orgs=Q._busy_orgs())
        if jobs:
            inner = _noop()
            Q._counted(jobs[0]["org_id"], inner).close()  # count it as running, as _tick does
            inner.close()
        return jobs[0]["org_id"] if jobs else None

    assert await claim() == "org_big"  # nobody served yet: first come
    assert await claim() == "org_small"  # big was just served: small's turn
    assert await claim() == "org_big"
    assert Q._running == {"org_big": 2, "org_small": 1}
    assert await claim() is None  # big has two running and small has nothing queued


async def _noop():
    return None


async def test_a_third_request_waits_but_a_quick_rewrite_does_not(client, db, monkeypatch):
    from app.models.models import CompanyProfile, SocialPost
    from app.services import credits as K

    db.add(CompanyProfile(id="default", name="Acme"))
    for i in range(3):
        db.add(SocialPost(id=f"p{i}", title="T", copy="", status="draft"))
    await K.add_credits(db, "scheduler", 100, source="grant")
    await db.commit()

    def body(pid, **kw):
        return {"groups": [{"postIds": [pid], "plan": "A post", "skipImage": True}], **kw}

    assert (await client.post("/api/scheduler/generate", json=body("p0"))).status_code == 200
    assert (await client.post("/api/scheduler/generate", json=body("p1"))).status_code == 200
    r = await client.post("/api/scheduler/generate", json=body("p2"))
    assert r.status_code == 429 and r.json()["detail"]["code"] == "USR-06"
    assert (await client.post("/api/scheduler/generate", json=body("p2", interactive=True))).status_code == 200
