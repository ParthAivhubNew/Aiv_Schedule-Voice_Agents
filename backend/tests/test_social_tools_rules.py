"""Carousels and video rules, Reddit, tracked links, bulk import parsing, reports timing, listening topics,
learned style parsing and test mode (no database)."""
import struct
from datetime import datetime
from types import SimpleNamespace

import pytest

from app.services import brand_voice, media_store, social_import as SI, social_links as LK, social_listening as LS
from app.services import social_publisher as P
from app.services import social_reports as SR


def _post(**kw):
    base = dict(id="p1", title="T", copy="Hello", hook="", hashtags=[], cta="", adapt_per_channel=False,
                linkedin_copy=None, x_copy=None, facebook_copy=None, instagram_copy=None, threads_copy=None,
                channels=["linkedin"], image_url=None, alt_text="", media=[], channel_options={}, theme="General")
    base.update(kw)
    return SimpleNamespace(**base)


def _kinds(*kinds, duration=10):
    return [{"url": f"/api/scheduler/media/{i:016x}.{'mp4' if k == 'video' else 'png'}", "kind": k, "duration": duration if k == "video" else None}
            for i, k in enumerate(kinds)]


def test_post_media_falls_back_to_the_single_picture():
    assert P.post_media(_post()) == []
    old = P.post_media(_post(image_url="https://x/i.png", alt_text="A cat"))
    assert old == [{"url": "https://x/i.png", "kind": "image", "alt": "A cat"}]
    both = P.post_media(_post(image_url="https://x/i.png", media=_kinds("video", "image")))
    assert [m["kind"] for m in both] == ["video", "image"]


def test_media_rules_per_network():
    issues = lambda chans, media: {(i["channel"], i["kind"]) for i in P.channel_issues(_post(channels=chans, media=media))}  # noqa: E731
    assert issues(["x"], _kinds("image", "image", "image", "image")) == set()
    assert ("x", "media") in issues(["x"], _kinds(*["image"] * 5))
    assert ("x", "media") in issues(["x"], _kinds("image", "video"))  # no mixing on X
    assert issues(["instagram"], _kinds("image", "video")) == set()  # an Instagram carousel can mix
    assert ("instagram", "media") in issues(["instagram"], _kinds(*["image"] * 11))
    assert ("instagram", "media") in issues(["instagram"], _kinds("image", "video", duration=90))  # carousel video over 60s
    assert issues(["instagram"], _kinds("video", duration=90)) == set()  # a Reel may be longer
    assert ("facebook", "media") in issues(["facebook"], _kinds("video", "video"))
    assert issues(["threads"], _kinds(*["image"] * 12)) == set()


def test_reddit_needs_a_subreddit_and_a_short_title_and_drops_hashtags():
    p = _post(channels=["reddit"], copy="Real question here #growth #tips")
    assert [i["kind"] for i in P.channel_issues(p)] == ["setup"]
    p.channel_options = {"reddit": {"subreddit": "r/smallbusiness"}}
    assert P.channel_issues(p) == []
    assert P.subreddit_name("r/smallbusiness") == "smallbusiness" and P.subreddit_name("/r/abc/") == "abc"
    assert P.copy_for_platform(p, "reddit") == "Real question here"
    p.title = "t" * 301
    assert any("title" in i["problem"] for i in P.channel_issues(p))
    assert ("reddit", "media") in {(i["channel"], i["kind"]) for i in P.channel_issues(_post(
        channels=["reddit"], media=_kinds("video"), channel_options={"reddit": {"subreddit": "abc"}}))}


async def test_test_mode_posts_nothing_and_can_rehearse_failures():
    acc = SimpleNamespace(platform="x", status="connected", access_token="", is_default=True, id="a", handle="@a")
    ok = await P.publish_post_to_accounts(_post(channels=["x", "linkedin"]), [acc], test={"outcome": "ok"})
    assert ok["allOk"] and all(r["test"] and r["id"].startswith("test_") for r in ok["results"])
    busy = await P.publish_post_to_accounts(_post(channels=["x"]), [], test={"outcome": "busy"})
    assert busy["results"][0]["kind"] == "temporary"
    login = await P.publish_post_to_accounts(_post(channels=["x"]), [], test={"outcome": "login"})
    assert login["results"][0]["kind"] == "login"
    refused = await P.publish_post_to_accounts(_post(channels=["x"]), [], test={"outcome": "refused"})
    assert refused["results"][0]["kind"] == "permanent"


def test_links_get_utm_tags_and_keep_existing_ones():
    url = LK.with_utm("https://acme.com/guide?ref=a", "linkedin", "spring-sale", "v2_1")
    assert "ref=a" in url and "utm_source=linkedin" in url and "utm_medium=social" in url and "utm_content=v2_1" in url
    kept = LK.with_utm("https://acme.com/?utm_source=newsletter", "x", "c", "p")
    assert "utm_source=newsletter" in kept and "utm_source=x" not in kept
    assert LK.find_links("Read https://acme.com/a. Then https://acme.com/a, and https://x.test/api/scheduler/media/ab.png") \
        == ["https://acme.com/a"]
    assert LK.slug("Spring Sale 2026!") == "spring-sale-2026" and LK.slug("") == "social"
    assert LK.BOT_RE.search("facebookexternalhit/1.1") and LK.BOT_RE.search("LinkedInBot/1.0")
    assert not LK.BOT_RE.search("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1")


async def test_rewriter_swaps_links_but_not_on_instagram(monkeypatch):
    made = []

    async def link_for(db, post, platform, url):
        made.append((platform, url))
        return SimpleNamespace(id="Abc1234")

    async def on(db, post):
        return True

    monkeypatch.setattr(LK, "_link_for", link_for)
    monkeypatch.setattr(LK, "tracking_on", on)
    monkeypatch.setattr(LK, "short_base", lambda: "https://out.test/api/l")
    rw = await LK.rewriter(None, _post())
    out = await rw("See https://acme.com/a. More: https://acme.com/a/b", "linkedin")
    assert out == "See https://out.test/api/l/Abc1234. More: https://out.test/api/l/Abc1234"
    assert ("linkedin", "https://acme.com/a") in made and ("linkedin", "https://acme.com/a/b") in made
    assert await rw("https://acme.com/a", "instagram") == "https://acme.com/a"


def test_import_reads_dates_times_and_checks_rows():
    assert SI.parse_date("2026-11-03") == ("2026-11-03", "")
    assert SI.parse_date("25/12/2026") == ("2026-12-25", "")
    day, note = SI.parse_date("03/04/2026")
    assert day == "2026-04-03" and "day first" in note
    assert SI.parse_date("3 Nov 2026")[0] == "2026-11-03" and SI.parse_date("Nov 3, 2026")[0] == "2026-11-03"
    assert SI.parse_date("someday") == (None, "")
    assert SI.parse_time("9:30 pm") == "21:30" and SI.parse_time("12 am") == "00:00" and SI.parse_time(0.5) == "12:00"
    assert SI.parse_time("25:00") is None
    rows = SI.read_table(SI.template_csv().encode(), "posts.csv")
    assert len(rows) == 3 and rows[0]["channels"] == "linkedin, x"
    checked = SI.check_rows(rows, datetime(2026, 10, 1, 9, 0))
    assert [r["issues"] for r in checked] == [[], [], []]
    assert checked[0]["channels"] == ["linkedin", "x"] and checked[1]["media"][1].endswith("photo2.jpg")
    assert any("AI writes" in n for n in checked[1]["notes"])
    bad = SI.check_rows([{"date": "2026-01-01", "channels": "myspace", "text": "x" * 300}], datetime(2026, 10, 1))
    assert any("passed" in i for i in bad[0]["issues"]) and any("Unknown channel" in i for i in bad[0]["issues"])
    long_x = SI.check_rows([{"date": "2026-12-01", "channels": "x", "text": "x" * 300}], datetime(2026, 10, 1))
    assert any(i.startswith("X: Text is 300") for i in long_x[0]["issues"])
    with pytest.raises(ValueError):
        SI.read_table(b"a,b\n1,2\n", "x.csv")
    with pytest.raises(ValueError):
        SI.read_table(b"x", "x.pdf")


def test_weekly_and_monthly_report_slots():
    mon = datetime(2026, 10, 19, 9, 0)  # a Monday after 08:00
    assert SR.last_slot("weekly", mon) == datetime(2026, 10, 19, 8, 0)
    assert SR.last_slot("weekly", datetime(2026, 10, 19, 7, 0)) == datetime(2026, 10, 12, 8, 0)
    assert SR.last_slot("monthly", datetime(2026, 10, 1, 7, 59)) == datetime(2026, 9, 1, 8, 0)
    assert SR.last_slot("monthly", datetime(2026, 10, 15)) == datetime(2026, 10, 1, 8, 0)
    assert SR.last_slot("none", mon) is None
    with pytest.raises(ValueError):
        SR.clean({"name": "Acme", "frequency": "weekly"})  # weekly with nobody to send to
    with pytest.raises(ValueError):
        SR.clean({"name": "Acme", "recipients": ["not-an-email"]})
    ok = SR.clean({"name": "Acme", "days": 7, "channels": ["LinkedIn", "x"], "recipients": ["a@b.co"], "frequency": "monthly"})
    assert ok["channels"] == ["linkedin", "x"] and ok["days"] == 7


def test_listening_topics_are_checked():
    t = LS.clean_topic({"keywords": "acme, Acme, acme crm", "sources": ["reddit", "x", "myspace"]})
    assert t["keywords"] == ["acme", "acme crm"] and t["sources"] == ["reddit", "x"] and t["name"] == "acme"
    with pytest.raises(ValueError):
        LS.clean_topic({"keywords": ""})
    with pytest.raises(ValueError):
        LS.clean_topic({"keywords": "a", "sources": ["linkedin"]})
    assert LS._excluded("We love Acme jobs", ["jobs"]) and not LS._excluded("We love Acme", ["jobs"])


def test_learned_rules_are_parsed_from_json_or_a_list():
    assert brand_voice.parse_rules('Sure! {"rules": ["Open with a number.", "No emojis.", "No emojis."]}') == \
        ["Open with a number.", "No emojis."]
    assert brand_voice.parse_rules("- Short lines\n* End with a question") == ["Short lines", "End with a question"]
    block = brand_voice.prompt_block({"tone": "Calm", "learned": {"on": True, "rules": ["A", "B"]}})
    assert "Learned from" in block and "- A" in block
    assert "Learned" not in brand_voice.prompt_block({"tone": "Calm", "learned": {"on": False, "rules": ["A"]}})


def test_video_length_and_size_are_read_from_the_file(tmp_path):
    def box(kind, body):
        return struct.pack(">I4s", 8 + len(body), kind) + body

    mvhd = box(b"mvhd", b"\x00" + b"\x00" * 3 + b"\x00" * 8 + struct.pack(">II", 1000, 12500) + b"\x00" * 80)
    tkhd = box(b"tkhd", b"\x00" + b"\x00" * 3 + b"\x00" * 72 + struct.pack(">II", 1080 << 16, 1920 << 16))
    path = tmp_path / "abcdef0123456789.mp4"
    path.write_bytes(box(b"ftyp", b"isom") + box(b"moov", mvhd + box(b"trak", tkhd)))
    assert media_store.probe(path) == {"width": 1080, "height": 1920, "duration": 12.5}
