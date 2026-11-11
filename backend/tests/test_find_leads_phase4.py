"""Find Leads phase 4: radius districts, "reasons to get in touch now" filters, and saved searches that top up a list."""
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy.dialects import postgresql

from app.services import business_records as BR
from app.services import saved_searches as SS


def sql(f):
    from sqlalchemy import and_

    conds = BR._filter_conditions(BR.normalize_filters(f))
    return str(and_(*conds).compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": False}))


def test_normalize_near_keeps_valid_districts():
    out = BR.normalize_filters({"near": {"postcode": "ls1 4ap", "miles": 5, "districts": ["LS1", "ls2", "junk", "EC1A", "DROP TABLE;", "LS1"]}})
    assert out["near"]["districts"] == ["LS1", "LS2", "EC1A"]
    assert out["near"]["postcode"] == "LS1 4AP" and out["near"]["miles"] == 5
    many = [f"A{i}" for i in range(10)] + [f"AB{i}" for i in range(10)] + [f"{a}{b}{c}" for a in "ABCDEFGH" for b in "ABCDEFGHIJ" for c in range(10)]
    capped = BR.normalize_filters({"near": {"postcode": "LS1 4AP", "miles": 500, "districts": many}})["near"]
    assert len(capped["districts"]) == BR.MAX_DISTRICTS and capped["miles"] == 50
    assert "near" not in BR.normalize_filters({"near": {"postcode": "LS1 4AP", "miles": 5, "districts": ["nope"]}})
    assert "near" not in BR.normalize_filters({"near": {"districts": ["LS1"]}})  # no miles


def test_signals_filter_sql_builds():
    for key in BR.SIGNAL_KEYS:
        text = sql({"signals": [key]})
        assert "business_records" in text
    assert "accounts_due_on BETWEEN" in sql({"signals": ["accounts_due"]})
    assert "incorporated_on >" in sql({"signals": ["new_company"]})
    director = sql({"signals": ["new_director"]})
    assert "json_array_elements" in director and "appointed_on" in director and "'resigned_on' IS NULL" in director
    both = sql({"signals": ["accounts_due", "new_company"]})
    assert " OR " in both
    assert BR.normalize_filters({"signals": ["new_director", "bogus"]})["signals"] == ["new_director"]
    assert BR.has_narrowing(BR.normalize_filters({"signals": ["new_company"]}))
    assert BR.has_narrowing(BR.normalize_filters({"near": {"postcode": "LS1 4AP", "miles": 5, "districts": ["LS1"]}}))


def test_filed_late_condition_uses_past_due():
    today = date(2026, 11, 11)
    cond = BR._signal_condition("filed_late", today).compile(dialect=postgresql.dialect())
    text = str(cond)
    assert "accounts_due_on <" in text and "confstmt_due_on <" in text and "lower(coalesce(business_records.status" in text
    assert today in cond.params.values()
    from app.services import fit_score as FS

    late = SimpleNamespace(status="Active", accounts_due_on=date(2026, 9, 1), confstmt_due_on=None, incorporated_on=None, officers=None, raw_data=None)
    assert [s["label"] for s in FS.signals(late, today)] == ["Accounts overdue"]
    closed = SimpleNamespace(**{**late.__dict__, "status": "Dissolved"})
    assert FS.signals(closed, today) == []


def test_describe_names_radius_and_signals():
    from app.services import lead_filters

    chips = lead_filters.describe(BR.normalize_filters({"near": {"postcode": "ls1 4ap", "miles": 5, "districts": ["LS1"]}, "signals": ["new_director"]}))
    assert "Within 5 miles of LS1 4AP" in chips and "New director (90 days)" in chips


# ── saved searches, on an in-memory settings store ─────────────────────────
@pytest.fixture
def store(monkeypatch):
    docs = {}

    async def get(db, key):
        return dict(docs.get(key) or {})

    async def put(db, key, data):
        docs[key] = data

    class Db:
        async def commit(self):
            pass

    from app.core.tenancy import org_scope
    from app.services import credits

    monkeypatch.setattr(credits, "_get_doc", get)
    monkeypatch.setattr(credits, "_put_doc", put)
    with org_scope("org_t"):
        yield Db(), docs


def biz(i):
    return SimpleNamespace(id=f"b{i}", name=f"Co {i}", website="", phone="", email="", industry="", region="Leeds", status="Active", sic_text="",
                           registration_number=f"0000000{i}", postcode="LS1 4AP", address="")


def stub_search(monkeypatch, rows, saved):
    seen_args = {}

    async def fake_search(db, filters, **kw):
        seen_args["filters"], seen_args["exclude"] = filters, kw.get("exclude_ids")
        return {"rows": [r for r in rows if r.id not in (kw.get("exclude_ids") or [])], "total": len(rows)}

    async def fake_save(db, body, owner):
        saved.append([a.business_record_id for a in body.accounts])
        return {"added": len(body.accounts)}

    async def fake_list(db, list_id, list_name, ids, owner=""):
        return {"id": "lst_1", "name": list_name, "count": 0}

    from app.api import lead_accounts, lead_lists

    monkeypatch.setattr(BR, "search_filtered", fake_search)
    monkeypatch.setattr(lead_accounts, "save_accounts", fake_save)
    monkeypatch.setattr(lead_lists, "put_in_list", fake_list)
    return seen_args


async def test_saved_search_run_adds_only_new(store, monkeypatch):
    db, docs = store
    rows, saved = [biz(1), biz(2)], []
    args = stub_search(monkeypatch, rows, saved)
    s = await SS.create(db, "Leeds accountants", {"sic_codes": ["69201"]}, "", True, "Ann")
    assert saved == [["b1", "b2"]] and s["last_added"] == 2 and set(s["seen_ids"]) == {"b1", "b2"} and s["list_id"] == "lst_1"
    assert args["filters"]["saved"] == "exclude"  # companies already saved are never added twice
    rows.append(biz(3))
    stored = (await SS.load(db))[0]
    assert await SS.run_one(db, stored) == 1
    assert saved[-1] == ["b3"] and stored["last_added"] == 1 and stored["seen_ids"] == ["b1", "b2", "b3"]
    assert await SS.run_one(db, stored) == 0 and stored["last_added"] == 0
    assert len(saved) == 2  # nothing new: nothing saved


async def test_saved_search_needs_a_narrowing_filter(store, monkeypatch):
    db, _ = store
    stub_search(monkeypatch, [], [])
    with pytest.raises(SS.SavedSearchError):
        await SS.create(db, "Everything", {}, "", False, "Ann")


async def test_weekly_runs_once_per_7_days(store, monkeypatch):
    db, docs = store
    rows, saved = [biz(1)], []
    stub_search(monkeypatch, rows, saved)
    SS._ran_day.clear()
    sent = []

    async def fake_notify(event, subject, lines, button=None, only_user_ids=None):
        sent.append((event, subject, lines))

    from app.core import notify

    monkeypatch.setattr(notify, "notify", fake_notify)
    t0 = datetime(2026, 11, 2, 8, 0)
    s = await SS.create(db, "Weekly one", {"sic_codes": ["69201"]}, "", True, "Ann")
    s["last_run_at"] = (t0 - timedelta(days=8)).isoformat() + "Z"
    await SS._save(db, [s], "org_t")
    rows.append(biz(2))
    assert await SS.weekly(db, "org_t", t0) == 1
    assert sent and sent[0][0] == "weekly_summary" and "new company in Weekly one" in sent[0][2][0]
    assert await SS.weekly(db, "org_t", t0 + timedelta(hours=5)) == 0  # same day: the guard stops a second run
    rows.append(biz(3))
    assert await SS.weekly(db, "org_t", t0 + timedelta(days=3)) == 0  # a new day but not 7 days yet
    assert await SS.weekly(db, "org_t", t0 + timedelta(days=7, minutes=1)) == 1


# ── the real queries, on Postgres ──────────────────────────────────────────
@pytest.mark.db
async def test_signal_and_radius_filters_run_on_postgres(db):
    from app.models.models import BusinessRecord

    today = datetime.utcnow().date()
    recent = (today - timedelta(days=10)).isoformat()
    old = (today - timedelta(days=400)).isoformat()

    def mk(i, **kw):
        base = dict(id=f"r{i}", identity_hash=f"h{i}", name=f"Firm {i}", status="Active", postcode="LS1 4AP", sic_codes="|69201|")
        base.update(kw)
        return BusinessRecord(**base)

    db.add_all([
        mk(1, officers=[{"name": "A", "role": "director", "appointed_on": recent}]),
        mk(2, officers=[{"name": "B", "role": "director", "appointed_on": old}]),
        mk(3, officers=[{"name": "C", "role": "director", "appointed_on": recent, "resigned_on": recent}]),
        mk(4, officers="not a list"),
        mk(5, accounts_due_on=today - timedelta(days=5)),
        mk(6, accounts_due_on=today + timedelta(days=20), postcode="M1 1AA"),
        mk(7, incorporated_on=today - timedelta(days=30), postcode="M1 1AA"),
        mk(8, accounts_due_on=today - timedelta(days=5), status="Dissolved"),
    ])
    await db.commit()

    async def ids(f):
        res = await BR.search_filtered(db, {"sic_codes": ["69201"], **f}, limit=50, stats=False, broaden=False)
        return {r.id for r in res["rows"]}

    assert await ids({"signals": ["new_director"]}) == {"r1"}
    assert await ids({"signals": ["filed_late"]}) == {"r5"}
    assert await ids({"signals": ["accounts_due"]}) == {"r6"}
    assert await ids({"signals": ["accounts_due", "new_company"]}) == {"r6", "r7"}
    assert await ids({"near": {"postcode": "LS1 4AP", "miles": 5, "districts": ["LS1", "LS2"]}}) >= {"r1", "r2", "r5"}
    assert not await ids({"near": {"postcode": "LS1 4AP", "miles": 5, "districts": ["LS1", "LS2"]}, "signals": ["new_company"]})
    assert await ids({"near": {"postcode": "M1 1AA", "miles": 5, "districts": ["M1"]}, "signals": ["new_company"]}) == {"r7"}
