"""The brand kit: one name, logo, colour and footer line on every post picture, filled in by hand or from the company's website."""
import io
from types import SimpleNamespace

import pytest
from PIL import Image

from app.services import brand_kit as BK
from app.services import social_publisher as P


def _png(size=(200, 80), colour=(200, 30, 60, 255)) -> bytes:
    out = io.BytesIO()
    Image.new("RGBA", size, colour).save(out, "PNG")
    return out.getvalue()


def _jpg(size=(1000, 1000), colour=(120, 160, 120)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, colour).save(out, "JPEG")
    return out.getvalue()


def _px(raw: bytes, xy):
    with Image.open(io.BytesIO(raw)) as im:
        return im.convert("RGB").getpixel(xy)


def test_the_kit_is_cleaned_and_odd_values_fall_back():
    k = BK.clean({"template": "nonsense", "logoPosition": "up", "logoSize": 999, "primary": "abc", "footerText": "  a   b  ", "enabled": 1})
    assert k["template"] == "footer" and k["logoPosition"] == "bottom_left" and k["logoSize"] == BK.SIZE_MAX
    assert k["primary"] == "#AABBCC" and k["footerText"] == "a b" and k["enabled"] is True
    assert BK.clean({"primary": "red"})["primary"] == BK.DEFAULT_COLOUR


def test_a_footer_bar_is_drawn_in_the_brand_colour_along_the_bottom():
    out = BK.compose(_jpg(), None, {"template": "footer", "primary": "#C81E3C", "footerText": "Brightside Dental · brightside.test"})
    r, g, b = _px(out, (500, 970))
    assert r > 150 and g < 90 and b < 100  # the bar
    assert _px(out, (500, 400))[1] > 140  # the picture above it is untouched
    with Image.open(io.BytesIO(out)) as im:
        assert im.size == (1000, 1000)  # the shape of the picture does not change


def test_a_banner_is_on_top_and_the_frame_has_a_border():
    top = BK.compose(_jpg(), None, {"template": "banner", "primary": "#C81E3C"})
    assert _px(top, (500, 20))[0] > 150 and _px(top, (500, 980))[0] < 130
    framed = BK.compose(_jpg(), None, {"template": "frame", "primary": "#C81E3C"})
    assert _px(framed, (3, 500))[0] > 150 and _px(framed, (500, 500))[0] < 130


@pytest.mark.parametrize("position,expect", [
    ("top_left", (60, 50)), ("top_center", (500, 50)), ("top_right", (940, 50)),
    ("middle_left", (60, 500)), ("middle_center", (500, 500)), ("middle_right", (940, 500)),
    ("bottom_left", (60, 950)), ("bottom_center", (500, 950)), ("bottom_right", (940, 950)),
])
def test_the_logo_goes_where_it_is_asked(position, expect):
    out = BK.compose(_jpg(colour=(240, 240, 240)), _png(colour=(200, 30, 60, 255)), {"template": "logo", "logoUrl": "/x", "logoPosition": position, "logoSize": 20})
    r, g, b = _px(out, expect)
    assert r > 170 and g < 100, (position, (r, g, b))
    far = (940, 950) if position != "bottom_right" else (60, 50)
    assert _px(out, far)[1] > 200  # nothing on the opposite side


def test_a_logo_in_the_bar_sits_inside_it_with_the_text_beside_it():
    out = BK.compose(_jpg(), _png(colour=(255, 255, 255, 255)), {"template": "footer", "primary": "#102040", "logoUrl": "/x", "logoPosition": "bottom_left",
                                                                  "logoBackdrop": True, "footerText": "Brightside Dental · brightside.test"})
    assert _px(out, (500, 800))[1] > 100  # above the bar the picture is unchanged
    assert max(_px(out, (80, 952))) > 200  # the white backing behind the logo is in the bar, at the left
    with Image.open(io.BytesIO(out)) as im:
        bar = im.convert("RGB").crop((300, 905, 960, 995))
        assert any(sum(p) > 600 for p in bar.getdata())  # the text, drawn light on the dark bar, to the right of the logo


def test_text_too_long_for_the_bar_is_shortened_not_run_off_the_edge():
    out = BK.compose(_jpg(size=(400, 400)), None, {"template": "footer", "primary": "#102040", "footerText": "x" * 120})
    with Image.open(io.BytesIO(out)) as im:
        assert im.size == (400, 400)


def test_colour_is_read_from_a_logo_and_greys_are_ignored():
    mixed = io.BytesIO()
    im = Image.new("RGBA", (60, 60), (255, 255, 255, 255))
    for x in range(10, 50):
        for y in range(10, 50):
            im.putpixel((x, y), (20, 120, 200, 255))
    im.save(mixed, "PNG")
    c = BK.dominant_colour(mixed.getvalue())
    assert c and int(c[5:7], 16) > int(c[1:3], 16)  # a blue
    assert BK.dominant_colour(_png(colour=(128, 128, 128, 255))) == ""


def test_the_name_comes_from_the_page_not_from_a_slogan():
    page = BK._Page()
    page.feed("<html><head><title>Home | Brightside Dental Practice</title><meta property='og:site_name' content='Brightside Dental'></head></html>")
    assert BK.site_name_from(page, "brightside.test") == "Brightside Dental"
    page2 = BK._Page()
    page2.feed("<html><head><title>Welcome - Bright Care - Leeds dentists you can trust</title></head></html>")
    assert BK.site_name_from(page2, "brightcare.test") == "Bright Care"
    assert BK.site_name_from(BK._Page(), "oak-street-cafe.co.uk") == "Oak Street Cafe"


async def test_a_website_fills_the_kit_and_a_private_address_is_refused(monkeypatch):
    from app.services import media_store
    from app.services.safe_fetch import FetchRefused

    html = (b"<html><head><title>Brightside Dental | Leeds</title><meta name='theme-color' content='#0A7F6F'>"
            b"<link rel='apple-touch-icon' href='/touch.png'></head><body><header><img src='/img/logo.png' alt='Brightside logo'></header></body></html>")
    logo = _png(size=(300, 120), colour=(10, 127, 111, 255))
    seen = []

    async def fake(url, limit, want_html=False, timeout=0.0):
        seen.append(url)
        if want_html:
            return html, "https://www.brightside.test/"
        if url.endswith("logo.png"):
            return logo, url
        raise FetchRefused("nope")

    monkeypatch.setattr(BK, "_download", fake)
    stored = {}
    monkeypatch.setattr(media_store, "store_image_bytes", lambda raw, mime="image/jpeg": stored.setdefault("u", "/api/scheduler/media/" + "a" * 16 + ".png"))
    got = await BK.from_website("brightside.test")
    assert got["name"] == "Brightside Dental" and got["primary"] == "#0A7F6F" and got["website"] == "brightside.test"
    assert got["logoUrl"].endswith(".png") and got["footerText"] == "Brightside Dental · brightside.test"
    assert got["found"] == {"name": True, "logo": True, "colour": True, "about": False, "products": False}
    assert got["palette"]["primary"] == "#0A7F6F" and set(got["palette"]) == set(BK.ROLES) and got["logos"] == [got["logoUrl"]]
    assert "https://www.brightside.test/img/logo.png" in seen  # the logo in the page header is among those tried
    with pytest.raises(FetchRefused):
        await BK.from_website("")
    with pytest.raises(FetchRefused):
        await BK.from_website("localhost")


async def test_a_private_address_is_never_fetched():
    from app.services.safe_fetch import FetchRefused

    with pytest.raises(FetchRefused):
        await BK._download("http://127.0.0.1/", 1000)
    with pytest.raises(FetchRefused):
        await BK._download("http://169.254.169.254/latest/meta-data", 1000)


def _post(**kw):
    base = dict(id="p1", title="T", copy="Hello", hook="", hashtags=[], cta="", adapt_per_channel=False, linkedin_copy=None, x_copy=None, facebook_copy=None,
                instagram_copy=None, threads_copy=None, channels=["linkedin"], image_url="https://cdn.test/a.jpg", media=None, alt_text="", first_comment="",
                title_="", channel_options={})
    base.update(kw)
    return SimpleNamespace(**base)


async def _publish(monkeypatch, post, brand):
    sent = {}

    async def fake_publish(acc, text, media=None, **k):
        sent["media"] = media
        return {"ok": True, "platform": "linkedin"}

    async def fake_copy(url, kit, public_base=None):
        return "https://cdn.test/branded.jpg"

    monkeypatch.setattr(P, "publish_to_account", fake_publish)
    monkeypatch.setattr(BK, "branded_copy", fake_copy)
    monkeypatch.setattr(P, "pick_account_for_channel", lambda accounts, plat: SimpleNamespace(id="a1", handle="h"))
    await P.publish_post_to_accounts(post, [], public_base="https://x.test", brand=brand)
    return sent["media"]


async def test_a_post_goes_out_with_the_kit_on_its_picture_and_its_own_picture_is_untouched(monkeypatch):
    post = _post()
    media = await _publish(monkeypatch, post, {"enabled": True, "template": "footer"})
    assert media[0]["url"] == "https://cdn.test/branded.jpg"
    assert post.image_url == "https://cdn.test/a.jpg"


async def test_the_kit_is_not_used_when_off_or_when_the_post_opts_out(monkeypatch):
    assert (await _publish(monkeypatch, _post(), {"enabled": False}))[0]["url"] == "https://cdn.test/a.jpg"
    assert (await _publish(monkeypatch, _post(), None))[0]["url"] == "https://cdn.test/a.jpg"
    opted_out = _post(channel_options={"_brand": {"off": True}})
    assert (await _publish(monkeypatch, opted_out, {"enabled": True}))[0]["url"] == "https://cdn.test/a.jpg"


async def test_a_video_is_never_branded(monkeypatch):
    post = _post(media=[{"url": "https://cdn.test/v.mp4", "kind": "video"}, {"url": "https://cdn.test/a.jpg", "kind": "image"}])
    media = await _publish(monkeypatch, post, {"enabled": True})
    assert media[0]["url"] == "https://cdn.test/v.mp4" and media[1]["url"] == "https://cdn.test/branded.jpg"


@pytest.mark.db
async def test_the_kit_is_saved_for_the_company_and_previewed_without_fetching_addresses(client, db):
    start = (await client.get("/api/scheduler/brand-kit")).json()
    assert start["kit"]["enabled"] is False and len(start["templates"]) == 4 and len(start["positions"]) == 9
    refused = await client.put("/api/scheduler/brand-kit", json={"logoUrl": "https://elsewhere.test/logo.png"})
    assert refused.status_code == 400 and "Upload your logo" in refused.json()["detail"]
    saved = await client.put("/api/scheduler/brand-kit", json={"enabled": True, "template": "frame", "primary": "#112233", "footerText": "Oak Street Cafe", "logoPosition": "top_right"})
    assert saved.status_code == 200 and saved.json()["kit"]["template"] == "frame"
    again = (await client.get("/api/scheduler/brand-kit")).json()["kit"]
    assert again["enabled"] is True and again["primary"] == "#112233" and again["logoPosition"] == "top_right"
    prev = await client.post("/api/scheduler/brand-kit/preview", json={"kit": again, "imageUrl": "http://127.0.0.1:9/secret.jpg"})
    assert prev.status_code == 200 and prev.json()["image"].startswith("data:image/jpeg;base64,")


@pytest.mark.db
async def test_a_post_can_opt_out_and_nothing_else_is_kept_in_the_options(client, db):
    from app.api import scheduler as S

    assert S._clean_channel_options({"_brand": {"off": True, "junk": 1}}, {}) == {"_brand": {"off": True}}
    assert S._clean_channel_options({"_brand": {"off": False}}, {"_brand": {"off": True}}) == {}


async def test_the_branded_copy_is_a_new_stored_picture_and_the_original_stays(tmp_path, monkeypatch):
    from app.services import media_store as MS

    monkeypatch.setattr(MS, "MEDIA_DIR", tmp_path)
    original = MS.store_image_bytes(_jpg(), "image/jpeg")
    logo = MS.store_image_bytes(_png(), "image/png")
    kit = {"template": "footer", "primary": "#C81E3C", "logoUrl": logo, "logoPosition": "bottom_right", "footerText": "Oak Street Cafe"}
    out = await BK.branded_copy(original, kit, "https://x.test")
    assert out.startswith("https://x.test/api/scheduler/media/") and not out.endswith(original.rsplit("/", 1)[1])
    branded, _ = MS.local_media_bytes(out)
    assert _px(branded, (500, 975))[0] > 150 and _px(branded, (500, 975))[1] < 90
    still, _ = MS.local_media_bytes(original)
    assert _px(still, (500, 975))[1] > 140
    assert await BK.branded_copy("/api/scheduler/media/" + "f" * 16 + ".jpg", kit, "https://x.test") is None  # a picture that is not there is left alone


def test_a_theme_has_nine_colours_and_presets_fill_them_in():
    k = BK.clean({})
    assert set(k["colours"]) == set(BK.ROLES) and k["preset"] == "custom" and k["colours"]["primary"] == BK.DEFAULT_COLOUR
    noir = BK.clean({"preset": "noir"})
    assert noir["colours"] == BK.PRESET_COLOURS["noir"] and noir["primary"] == "#111111"
    mine = BK.clean({"preset": "noir", "colours": {"primary": "#0a7f6f", "accent": "nonsense"}})
    assert mine["colours"]["primary"] == "#0A7F6F" and mine["colours"]["accent"] == BK.PRESET_COLOURS["noir"]["accent"] and mine["primary"] == "#0A7F6F"
    assert BK.clean({"primary": "#C81E3C"})["colours"]["primary"] == "#C81E3C"  # a kit saved before themes: its colour stays the main one
    assert len(BK.PRESETS) == 10 and all(set(c) == set(BK.ROLES) for _i, _n, c in BK.PRESETS)


def test_colours_are_read_from_a_pages_style_rules_and_given_roles():
    css = """:root{--brand-primary:#0A7F6F;--accent-colour:rgb(240,120,20);--page-bg:#F7F4EE;--ink:#1A1A1A}
    a{color:#0A7F6F}.btn{background:#0A7F6F;border:1px solid #DDD}.hero{background:#F7F4EE}h1{color:#1A1A1A}.tag{color:#f07814}
    .x{color:#6B7280}.y{color:#6B7280}.z{color:#6B7280}"""
    counts, hints = BK.css_colours(css)
    assert counts["#0A7F6F"] >= 3 and hints["primary"] == "#0A7F6F" and hints["accent"] == "#F07814"
    palette, swatches = BK.palette_from(counts, hints)
    assert palette["primary"] == "#0A7F6F" and palette["accent"] == "#F07814" and palette["background"] == "#F7F4EE" and palette["text"] == "#1A1A1A"
    assert palette["surface"] == "#FFFFFF" and set(palette) == set(BK.ROLES) and swatches[0] == "#0A7F6F"
    bare, _ = BK.palette_from({}, {}, theme_colour="#102040")
    assert bare["primary"] == "#102040" and bare["accent"] != bare["primary"]


def test_colours_get_plain_names_for_the_picture_ai():
    assert BK.colour_name("#0B1B3B") == "dark blue" and BK.colour_name("#FFFFFF") == "white" and BK.colour_name("#111111") == "black"
    assert BK.colour_name("#10B981") == "green" and BK.colour_name("#F97316") == "orange" and BK.colour_name("#808080") == "grey"
    off = BK.palette_phrase({"useInPictures": False})
    on = BK.palette_phrase({"useInPictures": True, "colours": {"primary": "#0B1B3B", "accent": "#F97316", "accent2": "#0B3B6B"}})
    assert off == "" and "dark blue" in on and "orange" in on and on.startswith("Colour palette:")


def test_what_the_business_does_is_taken_from_its_pages_and_never_invented():
    home = BK._Page()
    home.feed("""<html><head><meta name='description' content='Brightside Dental looks after families in Leeds with check-ups, whitening and braces.'></head><body>
      <header><nav><a href='/'>Home</a><a href='/treatments'>Treatments</a><a href='/about'>About us</a><a href='/login'>Log in</a></nav></header>
      <h1>Gentle dentistry for the whole family</h1>
      <h2>Check-ups and hygiene</h2><h2>Teeth whitening</h2><h2>Cookie settings</h2>
      <h2>How it works</h2><ul><li>Book a visit online in two minutes</li><li>We look after your teeth</li><li>Pay after your appointment</li></ul>
      <h2>Contact us</h2></body></html>""")
    b = BK.business_from([home], "brightside.test")
    assert b["summary"].startswith("Brightside Dental looks after families") and b["tagline"] == "Gentle dentistry for the whole family"
    assert b["products"] == ["Check-ups and hygiene", "Teeth whitening"]
    assert b["howItWorks"] == ["Book a visit online in two minutes", "We look after your teeth", "Pay after your appointment"]
    assert b["pages"] == ["Treatments", "About us"]  # the menu, without Home or Log in


def test_the_business_facts_reach_the_text_ai_only_when_the_company_says_so():
    kit = {"name": "Brightside Dental", "useInPosts": True, "business": {"summary": "Family dentist in Leeds.", "products": ["Check-ups", "Whitening"], "howItWorks": ["Book online"]}}
    text = BK.business_block(kit)
    assert "Brightside Dental" in text and "Check-ups; Whitening" in text and "never invent" in text
    assert BK.business_block({**kit, "useInPosts": False}) == "" and BK.business_block({"useInPosts": True}) == ""
    from app.services import brand_voice as BV

    assert BV.prompt_block({"tone": "Warm", "business": text}).startswith("Brand voice:\nTone: Warm") and "About the business" in BV.prompt_block({"tone": "Warm", "business": text})
    assert BV.prompt_block({"business": text}).startswith("About the business")


def test_the_bar_carries_a_thin_line_of_the_accent_colour_and_the_logo_backing_uses_the_surface_colour():
    kit = {"template": "footer", "colours": {"primary": "#102040", "accent": "#F97316", "surface": "#FFF4E5"}}
    plain = BK.compose(_jpg(), None, kit)
    assert _px(plain, (500, 902))[0] < 90  # no accent line unless asked for: the bar's edge is just the bar
    out = BK.compose(_jpg(), None, {**kit, "accentLine": True})
    r, g, b = _px(out, (500, 900 + 1))  # the bar starts at 900 (10% of 1000); its top edge is then the accent line
    assert r > 200 and 90 < g < 140 and b < 60
    backed = BK.compose(_jpg(), _png(colour=(10, 10, 10, 255)), {**kit, "template": "logo", "logoUrl": "/x", "logoPosition": "top_left", "logoBackdrop": True, "logoSize": 12})
    assert _px(backed, (46, 41))[0] > 200 and _px(backed, (46, 41))[2] > 180  # the cream surface colour shows round the logo


@pytest.mark.db
async def test_the_saved_business_facts_reach_the_text_ai_only_when_switched_on(client, db):
    from app.services import brand_voice as BV

    body = {"enabled": True, "name": "Brightside Dental", "useInPosts": False, "business": {"summary": "Family dentist in Leeds.", "products": ["Check-ups", "Whitening"]}}
    assert (await client.put("/api/scheduler/brand-kit", json=body)).status_code == 200
    assert "About the business" not in BV.prompt_block(await BV.load(db))
    assert (await client.put("/api/scheduler/brand-kit", json={**body, "useInPosts": True})).status_code == 200
    text = BV.prompt_block(await BV.load(db))
    assert "About the business" in text and "Family dentist in Leeds." in text and "Check-ups; Whitening" in text
    got = (await client.get("/api/scheduler/brand-kit")).json()
    assert len(got["presets"]) == 10 and got["kit"]["business"]["products"] == ["Check-ups", "Whitening"]


@pytest.mark.db
async def test_the_picture_prompt_gets_the_theme_colours_only_when_switched_on(client, db, monkeypatch):
    from app.api import scheduler as S

    seen = {}

    async def fake_prefs(db_, payload, slot):
        return {"provider": "x", "model": "m", "style": "modern_saas", "aspect_ratio": "1:1", "quality": "standard"}

    async def fake_image(prompt, **k):
        seen["prompt"] = prompt
        return {"imageUrl": "data:image/png;base64,AAAA", "status": "ok"}

    async def run(db_, kind, attempt):
        return await attempt("main")

    from app.services import platform_ai

    monkeypatch.setattr(S, "_resolve_image_prefs", fake_prefs)
    monkeypatch.setattr(S, "generate_image_with_provider", fake_image)
    monkeypatch.setattr(platform_ai, "run_with_backup", run)
    kit = {"colours": {"primary": "#0B1B3B", "accent": "#F97316", "accent2": "#0B3B6B"}, "preset": "custom"}
    await client.put("/api/scheduler/brand-kit", json={**kit, "useInPictures": False})
    await S._image_with_backup(db, {}, "A dentist smiling")
    assert "Colour palette" not in seen["prompt"]
    await client.put("/api/scheduler/brand-kit", json={**kit, "useInPictures": True})
    await S._image_with_backup(db, {}, "A dentist smiling")
    assert seen["prompt"].startswith("A dentist smiling") and "Colour palette: build the picture around dark blue and orange" in seen["prompt"]


@pytest.mark.db
async def test_a_logo_set_up_under_accounts_carries_over_and_stays_on(client, db, tmp_path, monkeypatch):
    from app.services import media_store as MS

    monkeypatch.setattr(MS, "MEDIA_DIR", tmp_path)
    logo = MS.store_image_bytes(_png(), "image/png")
    r = await client.put("/api/scheduler/image-settings", json={"logoOn": True, "logoUrl": logo, "logoCorner": "top_left", "logoSize": 22})
    assert r.status_code == 200, r.text
    kit = (await client.get("/api/scheduler/brand-kit")).json()["kit"]
    assert kit["enabled"] is True and kit["logoUrl"] == logo and kit["logoPosition"] == "top_left" and kit["logoSize"] == 22 and kit["template"] == "logo"
    await client.put("/api/scheduler/image-settings", json={"logoOn": False, "logoUrl": logo})
    assert (await client.get("/api/scheduler/brand-kit")).json()["kit"]["enabled"] is False  # it was off, so it stays off
    # saving the picture look from the Accounts page no longer touches the logo
    kept = await client.put("/api/scheduler/image-settings", json={"style": "cinematic"})
    assert kept.status_code == 200 and kept.json()["logoUrl"] == logo



async def test_a_site_that_blocks_us_still_gives_a_theme_and_a_plain_note(monkeypatch):
    from app.services import media_store
    from app.services.safe_fetch import FetchRefused

    tried = []
    icon = _png(size=(180, 180), colour=(10, 127, 111, 255))

    async def fake(url, limit, want_html=False, timeout=0.0):
        tried.append(url)
        if url.endswith("/apple-touch-icon.png"):
            return icon, url
        raise FetchRefused("The page answered with error 403.")

    monkeypatch.setattr(BK, "_download", fake)
    monkeypatch.setattr(media_store, "store_image_bytes", lambda raw, mime="image/jpeg": "/api/scheduler/media/" + "b" * 16 + ".png")
    got = await BK.from_website("https://www.brightside.test/about", "Brightside Dental\nCheck-ups\nTeeth whitening\nWe look after families in Leeds with gentle, modern dentistry. Book online today.")
    assert got["name"] == "Brightside" and got["website"] == "brightside.test" and "does not let programs read it" in got["note"]
    assert got["logoUrl"].endswith(".png") and int(got["primary"][3:5], 16) > int(got["primary"][1:3], 16)  # a green, taken from the icon
    assert got["business"]["summary"].startswith("We look after families") and got["business"]["products"][:3] == ["Brightside Dental", "Check-ups", "Teeth whitening"]
    assert "https://brightside.test/about" in tried and "https://www.brightside.test/" in tried  # the other forms were tried first


async def test_an_address_we_never_fetch_still_returns_a_result_with_a_note_and_fetches_nothing(monkeypatch):
    from app.services.safe_fetch import FetchRefused

    calls = []

    async def fake(url, limit, want_html=False, timeout=0.0):
        calls.append(url)
        raise FetchRefused("That address is not a public website.")

    monkeypatch.setattr(BK, "_download", fake)
    got = await BK.from_website("intranet.example")
    assert got["name"] == "Intranet" and "could not reach that website" in got["note"] and got["palette"]["primary"] == BK.DEFAULT_COLOUR
    assert calls == ["https://intranet.example"]  # one refused look, then nothing else


def test_pasted_text_gives_a_summary_and_short_lines_as_products():
    b = BK.business_from_text("About us\nWe build boats for people who love the sea. Every hull is made by hand. Visit the yard.\n- Day sailers\n- Racing dinghies\nCall us today.")
    assert b["summary"].startswith("We build boats") and b["products"] == ["About us", "Day sailers", "Racing dinghies"]


def test_the_bar_is_a_soft_gradient_and_a_dark_logo_on_a_dark_bar_gets_a_light_backing():
    out = BK.compose(_jpg(), None, {"template": "footer", "primary": "#1A56C8"})
    top, bottom = _px(out, (500, 905)), _px(out, (500, 995))
    assert top != bottom and abs(top[2] - bottom[2]) > 8  # the bar shades from one edge to the other
    dark_logo = _png(colour=(15, 25, 60, 255))
    on_dark = BK.compose(_jpg(), dark_logo, {"template": "footer", "primary": "#102040", "logoUrl": "/x", "logoPosition": "bottom_right", "logoSize": 12})
    assert max(_px(on_dark, (900, 922))) > 200  # a light backing appeared behind the logo without being asked
    light_on_dark = BK.compose(_jpg(), _png(colour=(255, 255, 255, 255)), {"template": "footer", "primary": "#102040", "logoUrl": "/x", "logoPosition": "bottom_right", "logoSize": 12})
    assert max(_px(light_on_dark, (935, 950))) > 200  # a light logo already shows, with no extra backing needed


async def test_a_script_built_site_is_named_from_its_structured_data_and_a_favicon_sized_icon_is_kept(monkeypatch):
    from app.services import media_store

    shell = (b"<html><head><link rel='icon' href='/media/i.png?w=180'>"
             b"<script type='application/ld+json'>{\"@context\":\"https://schema.org\",\"@type\":\"Organization\",\"name\":\"Federation of Small Businesses\"}</script></head><body><div id='app'></div></body></html>")
    icon = _png(size=(32, 32), colour=(0, 206, 206, 255))

    async def fake(url, limit, want_html=False, timeout=0.0):
        if want_html:
            return shell, "https://www.fsb.test/"
        if "/media/i.png" in url:
            return icon, url
        raise __import__("app.services.safe_fetch", fromlist=["FetchRefused"]).FetchRefused("nope")

    monkeypatch.setattr(BK, "_download", fake)
    monkeypatch.setattr(media_store, "store_image_bytes", lambda raw, mime="image/jpeg": "/api/scheduler/media/" + "c" * 16 + ".png")
    got = await BK.from_website("https://www.fsb.test/")
    assert got["name"] == "Federation of Small Businesses" and got["logoUrl"].endswith(".png")
    assert got["business"]["summary"] == "" and "builds its pages with scripts" in got["note"]  # nothing to read, and it says so plainly


async def test_a_script_built_site_gets_its_sections_from_the_sitemap(monkeypatch):

    async def fake(url, limit, want_html=False, timeout=0.0):
        if want_html:
            return b"<html><head></head><body><div id='app'></div></body></html>", "https://www.fsb.test/"
        if url.endswith("/sitemap.xml"):
            locs = "".join(f"<url><loc>https://www.fsb.test/{p}</loc></url>" for p in
                           ["membership", "membership/join", "membership/benefits", "legal-support", "legal-support/tax", "login", "privacy", "news/one", "other.pdf"])
            locs += "<url><loc>https://elsewhere.example/membership</loc></url>"
            return f"<urlset>{locs}</urlset>".encode(), url
        raise __import__("app.services.safe_fetch", fromlist=["FetchRefused"]).FetchRefused("nope")

    async def nothing(query, **kw):
        return []

    monkeypatch.setattr(BK, "_download", fake)
    got = await BK.from_website("https://www.fsb.test/")
    assert got["business"]["products"] == ["Membership", "Legal Support", "News"] and got["business"]["pages"] == ["Membership", "Legal Support", "News"]


async def test_a_script_built_page_gives_up_what_is_inside_its_own_data_and_its_about_page(monkeypatch):
    shell = (b"<html><head><script type='application/json'>{\"page\":{\"description\":\"We help small firms with legal, tax and money matters, with advice by phone and online.\","
             b"\"cards\":[{\"title\":\"Legal advice\"},{\"title\":\"Tax help\"},{\"title\":\"Cookie settings\"}]}}</script></head><body><div id='app'></div></body></html>")
    about = b"<html><body><h1>About us</h1><h2>Our members</h2><p>Thousands of owners rely on us every day for support.</p></body></html>"
    asked = []

    async def fake(url, limit, want_html=False, timeout=0.0):
        asked.append(url)
        if want_html and url.rstrip("/").endswith("fsb.test"):
            return shell, "https://www.fsb.test/"
        if want_html and url.endswith("/about"):
            return about, url
        raise __import__("app.services.safe_fetch", fromlist=["FetchRefused"]).FetchRefused("nope")

    monkeypatch.setattr(BK, "_download", fake)
    got = await BK.from_website("https://www.fsb.test/")
    assert got["business"]["summary"].startswith("We help small firms with legal, tax and money matters")
    assert got["business"]["products"][:2] == ["Legal advice", "Tax help"] and "Cookie settings" not in got["business"]["products"]
    assert got["note"] == ""  # it found what the business does, so nothing to apologise for


def test_the_scanner_uses_no_outside_search_service():
    import inspect

    src = inspect.getsource(BK)
    assert "search_web" not in src and "tavily" not in src.lower() and "deepseek" not in src.lower()


def test_the_logo_can_be_see_through_and_lose_its_white_block():
    base = {"template": "logo", "logoUrl": "/x", "logoPosition": "middle_center", "logoSize": 30}
    pic = _jpg(colour=(255, 255, 255))
    solid = BK.compose(pic, _png(size=(200, 80), colour=(200, 30, 60, 255)), base)
    faded = BK.compose(pic, _png(size=(200, 80), colour=(200, 30, 60, 255)), {**base, "logoOpacity": 40})
    assert _px(solid, (500, 500))[1] < 60 and 120 < _px(faded, (500, 500))[1] < 190  # the faded logo lets the white picture show through
    assert BK.clean({"logoOpacity": 3})["logoOpacity"] == 10 and BK.clean({"logoOpacity": "x"})["logoOpacity"] == 100
    both = Image.new("RGBA", (200, 80), (255, 255, 255, 255))
    for x in range(60, 140):
        for y in range(20, 60):
            both.putpixel((x, y), (20, 40, 160, 255))
    buf = io.BytesIO(); both.save(buf, "PNG")
    on_photo = _jpg(colour=(200, 120, 40))
    boxed = BK.compose(on_photo, buf.getvalue(), {**base, "logoSize": 40, "logoPosition": "middle_center"})
    clear = BK.compose(on_photo, buf.getvalue(), {**base, "logoSize": 40, "logoPosition": "middle_center", "logoKnockout": True})
    assert _px(boxed, (330, 500))[1] > 230 and _px(clear, (330, 500))[1] < 140  # the white block is gone and the photo shows round the mark
    assert _px(clear, (500, 500))[2] > 120  # the mark itself stays


def test_a_companys_own_files_fill_in_what_its_website_would_not():
    text = (b"Federation Example\nWe represent small firms across the UK and give them legal, tax and money advice by phone and online.\n"
            b"Legal advice\nTax help\nBusiness banking\nCall us on 0808 202 0888 or write to help@example.org.\n")
    got = BK.from_files([("profile.txt", text), ("logo.png", _png(size=(400, 200), colour=(0, 150, 150, 255))), ("notes.exe", b"nope"), ("empty.txt", b"hi")])
    assert got["business"]["summary"].startswith("We represent small firms across the UK") and "Legal advice" in got["business"]["products"]
    assert got["phone"] == "0808 202 0888" and got["email"] == "help@example.org"
    assert len(got["logos"]) == 1 and got["palette"]["primary"].startswith("#") and set(got["read"]) == {"profile.txt", "logo.png"}
    assert {x["name"] for x in got["skipped"]} == {"notes.exe", "empty.txt"} and all(x["reason"] for x in got["skipped"])


@pytest.mark.db
async def test_the_documents_route_reads_files_and_keeps_nothing(client):
    r = await client.post("/api/scheduler/brand-kit/documents", files=[("files", ("about.txt", b"We bake bread for the whole street every morning, fresh and warm.\nSourdough\nRolls\n", "text/plain"))])
    assert r.status_code == 200 and r.json()["business"]["products"] == ["Sourdough", "Rolls"] and r.json()["read"] == ["about.txt"]
    assert (await client.get("/api/scheduler/brand-kit")).json()["kit"]["business"]["products"] == []  # nothing was saved
