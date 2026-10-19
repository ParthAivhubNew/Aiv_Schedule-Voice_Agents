"""Channel checks before publishing, failure kinds, retry policy and results maths (no database)."""
from types import SimpleNamespace

from app.api import scheduler as S
from app.api import scheduler_insights as I
from app.services import social_metrics as SM
from app.services import social_publisher as P


def _post(**kw):
    base = dict(id="p1", title="T", copy="Hello", hook="", hashtags=[], cta="", adapt_per_channel=False,
                linkedin_copy=None, x_copy=None, facebook_copy=None, instagram_copy=None, threads_copy=None,
                channels=["linkedin"], image_url=None, publish_results=[], schedule_id=None, publish_attempts=0,
                retry_at_ms=None, status="failed")
    base.update(kw)
    return SimpleNamespace(**base)


def test_channel_issues_report_length_and_missing_picture():
    assert P.channel_issues(_post()) == []
    long_x = P.channel_issues(_post(channels=["x"], copy="a" * 300))
    assert long_x and long_x[0]["channel"] == "x" and "300 characters" in long_x[0]["problem"]
    assert P.channel_issues(_post(channels=["threads"], copy="b" * 501))[0]["channel"] == "threads"
    ig = P.channel_issues(_post(channels=["instagram"]))
    assert ig == [{"channel": "instagram", "problem": "Instagram needs a picture.", "kind": "missing_media"}]
    assert P.channel_issues(_post(channels=["instagram"], image_url="https://x/i.png")) == []
    # Facebook takes long posts: 5,000 characters is fine (it used to be cut at 2,000).
    assert P.channel_issues(_post(channels=["facebook"], copy="c" * 5000)) == []


def test_failure_kind():
    assert P.failure_kind({"error": "No connected x account. Connect it under Accounts & AI."}) == "login"
    assert P.failure_kind({"error": "401: Unauthorized"}) == "login"
    assert P.failure_kind({"error": "Error validating access token: Session has expired"}) == "login"
    assert P.failure_kind({"error": "429: Too Many Requests"}) == "temporary"
    assert P.failure_kind({"error": "503: Service Unavailable"}) == "temporary"
    assert P.failure_kind({"error": "ReadTimeout: timed out"}) == "temporary"
    assert P.failure_kind({"error": "container 400: Invalid image aspect ratio"}) == "permanent"
    assert P.failure_kind({}) == ""


class FakeDB:
    def __init__(self):
        self.commits = 0

    async def commit(self):
        self.commits += 1

    async def execute(self, *a, **k):
        raise AssertionError("no schedule lookup expected")


async def test_retry_only_for_a_busy_network_with_growing_waits():
    db = FakeDB()
    busy = _post(publish_results=[{"ok": False, "platform": "x", "error": "503: down", "kind": "temporary"}])
    assert await S._schedule_retry(db, busy, 1000.0)
    assert busy.status == "approved" and busy.publish_attempts == 1 and busy.retry_at_ms == 1000.0 + 5 * 60000
    busy.status = "failed"
    assert await S._schedule_retry(db, busy, 1000.0)
    assert busy.retry_at_ms == 1000.0 + 10 * 60000  # twice as long
    busy.status = "failed"
    assert await S._schedule_retry(db, busy, 1000.0)
    busy.status = "failed"
    assert not await S._schedule_retry(db, busy, 1000.0)  # three tries, then it waits for the user

    login = _post(publish_results=[{"ok": False, "platform": "x", "error": "401: Unauthorized"}])
    assert not await S._schedule_retry(db, login, 1000.0) and login.status == "failed"
    refused = _post(publish_results=[{"ok": False, "platform": "instagram", "error": "container 400: bad image"}])
    assert not await S._schedule_retry(db, refused, 1000.0)
    half = _post(publish_results=[{"ok": True, "platform": "x"}, {"ok": False, "platform": "facebook", "error": "503"}])
    assert not await S._schedule_retry(db, half, 1000.0)  # would post twice on X


def test_insight_values_and_totals_never_invent_zeros():
    body = {"data": [{"name": "reach", "values": [{"value": 120}]}, {"name": "views", "total_value": {"value": 300}},
                     {"name": "likes", "values": []}]}
    assert SM._insight_values(body) == {"reach": 120, "views": 300}

    def m(post_id, **kw):
        row = SimpleNamespace(post_id=post_id, error=None, **{f: None for f in SM.FIELDS})
        for k, v in kw.items():
            setattr(row, k, v)
        return row

    rows = [m("a", reach=100, impressions=200, likes=10, comments=2), m("b", likes=4, error="not shared")]
    t = I._totals(rows)
    assert t["reach"] == 100 and t["clicks"] is None and t["engagements"] == 16
    assert t["engagementRate"] == 6.0  # 12 engagements over 200 views, only for posts with views
    assert t["posts"] == 2 and t["measured"] == 1
    assert I._change(150, 100) == 50.0 and I._change(150, None) is None and I._change(None, 100) is None


def test_failed_post_reason_says_what_to_do():
    p = _post(publish_results=[{"ok": False, "platform": "linkedin", "error": "401: expired"}])
    assert I._reason(p) == {"text": "LinkedIn needs you to reconnect the account.", "kind": "login"}
    p = _post(publish_results=[{"ok": False, "platform": "x", "error": "503", "kind": "temporary"}])
    assert I._reason(p)["kind"] == "temporary"
