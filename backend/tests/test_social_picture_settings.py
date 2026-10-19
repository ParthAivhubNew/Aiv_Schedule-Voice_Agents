"""A company's own picture look, shape and quality; the owner portal's model is used as chosen."""
import pytest

from app.services import post_writer as P

pytestmark = pytest.mark.db


async def test_company_picture_settings_reach_the_image_ai(client, db, monkeypatch):
    s = (await client.get("/api/scheduler/image-settings")).json()
    assert s["style"] == "modern_saas" and s["quality"] == "standard" and "custom" in s["styles"]
    assert (await client.put("/api/scheduler/image-settings", json={"style": "custom", "styleCustom": ""})).status_code == 400
    assert (await client.put("/api/scheduler/image-settings", json={"style": "x"})).status_code == 400
    res = await client.put("/api/scheduler/image-settings", json={"style": "custom", "styleCustom": "watercolour, pastel",
                                                                  "aspectRatio": "1:1", "quality": "high"})
    assert res.status_code == 200 and res.json()["quality"] == "high"

    seen = {}

    async def fake(**kw):
        seen.update(kw)
        return {"status": "ok", "imageUrl": "/api/scheduler/media/0123456789abcdef.png", "imagePrompt": kw["prompt"]}

    from app.api import scheduler as S

    monkeypatch.setattr(S, "generate_image_with_provider", fake)
    await S._image_with_backup(db, {}, "a quiet cafe")
    assert seen["quality"] == "high" and seen["aspect_ratio"] == "1:1" and seen["style"] == "custom:watercolour, pastel"
    await S._image_with_backup(db, {"style": "editorial", "quality": "standard"}, "a quiet cafe")
    assert seen["style"] == "editorial" and seen["quality"] == "standard"  # one redraw can differ


def test_custom_look_and_quality_words():
    assert P.style_text("custom:watercolour, pastel") == "Style: watercolour, pastel."
    assert P.style_text("editorial").startswith("Style: natural editorial photograph")
    assert "watercolour" in P.finish_prompt("A cafe", "custom:watercolour")


async def test_video_uses_the_owner_portal_choice(db):
    from app.core.platform import platform_org_id
    from app.core.tenancy import org_scope
    from app.models.models import Connection
    from app.services import platform_ai, video_ai
    from app.services.credits import _put_doc

    with org_scope(platform_org_id()):
        db.add(Connection(id="c_fal", org_id=platform_org_id(), group_name="IMAGE:scheduler", name="Fal",
                          status="connected", config={"provider": "fal", "api_key": "k-123"}))
        await db.commit()
    assert await video_ai.find_key(db) is None  # nothing chosen in the portal
    await _put_doc(db, "platform_ai", {"videoProvider": "Fal", "videoModel": ""})
    await db.commit()
    assert await video_ai.find_key(db) is None  # no model filled in: we never pick one
    await _put_doc(db, "platform_ai", {"videoProvider": "Fal", "videoModel": "fal-ai/some-video-model"})
    await db.commit()
    ai = await video_ai.find_key(db)
    assert ai["provider"] == "fal" and ai["model"] == "fal-ai/some-video-model" and ai["key"]
    assert (await platform_ai.choice(db, "video"))[0] == "Fal"
