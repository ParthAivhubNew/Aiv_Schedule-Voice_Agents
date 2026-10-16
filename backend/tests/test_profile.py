"""Your own profile: details, photo, devices."""
import io

import pytest

from tests.conftest import make_user

pytestmark = pytest.mark.db


def _png(size=(400, 300), color=(200, 30, 30)):
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


async def test_details_save_and_name_follows(client):
    r = await client.patch("/api/auth/me", json={
        "phone": "+44 7700 900123",
        "profile": {"first_name": "Priya", "last_name": "Shah", "job_title": "Head of Sales", "timezone": "Europe/London", "time_format": "12h", "website": "priyashah.example"},
    })
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["name"] == "Priya Shah" and me["phone"] == "+44 7700 900123"
    assert me["profile"]["job_title"] == "Head of Sales" and me["profile"]["website"] == "https://priyashah.example"
    again = (await client.get("/api/auth/me")).json()
    assert again["profile"]["timezone"] == "Europe/London" and again["profile"]["department"] == ""


async def test_bad_details_are_refused(client):
    for body in (
        {"profile": {"timezone": "Mars/Base"}},
        {"profile": {"time_format": "25h"}},
        {"profile": {"secondary_email": "nope"}},
        {"profile": {"job_title": "x" * 200}},
        {"profile": {"first_name": "", "last_name": ""}},
        {"phone": "abc"},
    ):
        r = await client.patch("/api/auth/me", json=body)
        assert r.status_code == 400, (body, r.text)


async def test_photo_upload_square_and_removed(client, anon):
    r = await client.post("/api/auth/me/avatar", files={"file": ("me.png", _png(), "image/png")})
    assert r.status_code == 200, r.text
    url = r.json()["avatar_url"]
    assert url.startswith("/media/avatars/")
    got = await anon.get(url)  # the photo shows without a header, so an <img> can load it
    assert got.status_code == 200
    from PIL import Image

    assert Image.open(io.BytesIO(got.content)).size == (256, 256)
    r2 = await client.post("/api/auth/me/avatar", files={"file": ("b.png", _png(color=(0, 0, 255)), "image/png")})
    assert r2.json()["avatar_url"] != url
    assert (await anon.get(url)).status_code == 404  # the old file is gone
    r3 = await client.delete("/api/auth/me/avatar")
    assert r3.json()["avatar_url"] is None
    assert (await anon.get(r2.json()["avatar_url"])).status_code == 404


async def test_photo_rules(client):
    bad = await client.post("/api/auth/me/avatar", files={"file": ("x.png", b"not a picture", "image/png")})
    assert bad.status_code == 400
    gif = io.BytesIO()
    from PIL import Image

    Image.new("RGB", (10, 10)).save(gif, "GIF")
    assert (await client.post("/api/auth/me/avatar", files={"file": ("x.gif", gif.getvalue(), "image/gif")})).status_code == 400
    big = await client.post("/api/auth/me/avatar", files={"file": ("x.png", b"0" * (2 * 1024 * 1024 + 10), "image/png")})
    assert big.status_code == 400 and "2 MB" in big.json()["detail"]


async def test_people_only_change_their_own_profile(client, anon, db):
    other, other_token = await make_user(db, "sam", "Operator")
    h = {"Authorization": f"Bearer {other_token}"}
    await client.patch("/api/auth/me", json={"profile": {"first_name": "Boss", "last_name": "One"}})
    r = await anon.patch("/api/auth/me", json={"profile": {"job_title": "Operator"}}, headers=h)
    assert r.status_code == 200 and r.json()["username"] == "sam"
    me = (await client.get("/api/auth/me")).json()
    assert me["profile"]["job_title"] == "" and me["name"] == "Boss One"


async def test_devices_list_and_sign_out(client, anon, db):
    me = (await client.get("/api/auth/me")).json()
    rows = (await client.get("/api/auth/me/sessions")).json()
    assert any(r["current"] for r in rows)
    other = await anon.post("/api/auth/login", json={"username": me["username"], "password": "Str0ng-pass!"})
    if other.status_code == 200:
        rows = (await client.get("/api/auth/me/sessions")).json()
        assert len(rows) >= 2
        gone = next(r for r in rows if not r["current"])
        assert (await client.delete(f"/api/auth/me/sessions/{gone['id']}")).status_code == 200
        assert (await client.post("/api/auth/me/sessions/sign-out-others")).json()["ok"]
    assert (await client.delete("/api/auth/me/sessions/ses_nope")).status_code == 404
    assert (await client.get("/api/auth/me")).status_code == 200  # this device stays signed in
