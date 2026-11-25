"""Plan 12, B8 for Social: who may approve, which networks a post may go to, and whether AI pictures and video may be made."""
import json
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from app.services import social_rules as SR
from app.services import tenant_policy as TP


async def _rules(db, policy):
    await db.execute(text("UPDATE organizations SET policy = CAST(:p AS JSON) WHERE id = 'org_default'"), {"p": json.dumps(policy)})
    await db.commit()
    TP.invalidate()


@pytest.fixture(autouse=True)
def _forget_rules():
    TP.invalidate()
    yield
    TP.invalidate()  # cached rules must not reach the next test


def test_a_company_can_only_tighten_its_brands_social_rules():
    brand = TP.clean_policy({"social": {"networks": ["linkedin", "x"], "ai_video": False}})
    mine = TP.clean_policy({"social": {"approver": "admin", "networks": ["x", "facebook", "made_up"], "ai_images": False}})
    assert mine["social"]["networks"] == ["facebook", "x"]
    out = TP.merge_policy(brand, mine)["social"]
    assert out == {"approver": "admin", "networks": ["x"], "ai_images": False, "ai_video": False}
    apart = TP.merge_policy(TP.clean_policy({"social": {"networks": ["linkedin"]}}), TP.clean_policy({"social": {"networks": ["x"]}}))["social"]
    assert apart["networks"] == [] and apart["networks_none"] is True  # nothing in common: nothing may be posted
    assert TP.Policy("o", merged=TP.merge_policy(TP.clean_policy({"social": {"networks": ["linkedin"]}}), TP.clean_policy({"social": {"networks": ["x"]}}))).network_allowed("x") is False
    assert TP.clean_policy({})["social"] == {"approver": "anyone", "networks": [], "ai_images": True, "ai_video": True}


async def test_a_network_the_rules_leave_out_is_refused_when_saved_and_when_published(db, client):
    from app.core.tenancy import org_scope
    from app.services.social_publisher import publish_post_to_accounts

    await _rules(db, {"social": {"networks": ["linkedin"]}})
    saved = await client.post("/api/scheduler/posts/create", json={"title": "Hello", "copy": "Hi", "channels": ["x"]})
    assert saved.status_code == 400 and saved.json()["detail"]["code"] == "rules_network" and "It allows LinkedIn" in saved.json()["detail"]["message"]
    ok = await client.post("/api/scheduler/posts/create", json={"title": "Hello", "copy": "Hi", "channels": ["linkedin"]})
    assert ok.status_code == 200, ok.text
    post = SimpleNamespace(channels=["x", "linkedin"], copy="Hi", title="Hello", image_url=None, media=None, first_comment=None, alt_text=None,
                           linkedin_copy=None, x_copy=None, options=None)
    with org_scope("org_default"):
        out = await publish_post_to_accounts(post, [], test={"outcome": "ok"})  # a dry run: nothing is posted
    by = {r["platform"]: r for r in out["results"]}
    assert by["x"]["ok"] is False and by["x"]["kind"] == "permanent" and "don't allow posting to X" in by["x"]["error"]
    assert by["linkedin"]["ok"] is True


async def test_only_admins_approve_when_the_rules_say_so(db, client):
    from app.models.models import Operator
    from tests.conftest import make_user

    assert await SR.approval_refusal(False, "org_default") == ""
    await _rules(db, {"social": {"approver": "admin"}})
    assert "only an admin can approve" in await SR.approval_refusal(False, "org_default")
    assert await SR.approval_refusal(True, "org_default") == ""
    assert (await client.post("/api/scheduler/posts/create", json={"title": "A", "copy": "B", "channels": ["linkedin"], "status": "approved"})).status_code == 200
    # the approval e-mail's page: only an approver address that belongs to an admin counts
    await make_user(db, "boss2", "Admin")
    await make_user(db, "pat", "Operator")
    await db.execute(text("UPDATE operators SET email = username || '@acme.test' WHERE id IN ('op_boss2', 'op_pat')"))
    await db.commit()
    assert await SR.email_approver_refusal(db, "BOSS2@acme.test", "org_default") == ""
    assert "only an admin can approve" in await SR.email_approver_refusal(db, "pat@acme.test", "org_default")
    assert "only an admin can approve" in await SR.email_approver_refusal(db, "outsider@elsewhere.test", "org_default")


async def test_ai_pictures_and_video_follow_the_rules_at_the_credit_check(db, funded_house_org):
    from app.core.tenancy import org_scope
    from app.services import credits

    await _rules(db, {"social": {"ai_images": False}})
    with org_scope("org_default"):
        ok, why = await credits.can_start(db, "ai_post", extra=[("ai_image", 1)])
        assert ok is False and why == "Your company's rules don't allow AI images."
        assert await SR.ai_refusal(["ai_video"]) == "" and await SR.ai_images_allowed() is False
    await _rules(db, {"social": {"ai_video": False}})
    with org_scope("org_default"):
        assert await SR.ai_refusal(["ai_video", "ai_post"]) == "Your company's rules don't allow AI video."
