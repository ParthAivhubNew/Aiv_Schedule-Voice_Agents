"""Website signals: software named, Making Tax Digital, hiring, team size, read from a company's own pages."""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from app.services import business_records as BR
from app.services import site_signals as SG


def pages(text):
    return [{"url": "https://oak.example/", "text": text}]


def test_software_is_named_whole_word():
    out = SG.extract(pages("We file in Xero and QuickBooks. Our team also uses Sage 50, FreeAgent and Dext."))
    assert out["software"] == ["Xero", "QuickBooks", "Sage", "FreeAgent", "Dext"]
    assert SG.extract(pages("We use xero online"))["software"] == ["Xero"]
    assert SG.extract(pages("Bookkeeping by hand"))["software"] == []


def test_mtd_is_read_from_either_spelling():
    assert SG.extract(pages("Ready for Making Tax Digital?"))["mtd"] is True
    assert SG.extract(pages("MTD for income tax starts soon"))["mtd"] is True
    assert SG.extract(pages("We do tax returns"))["mtd"] is False


def test_hiring_is_read_from_careers_and_vacancies():
    for line in ("Careers", "Current vacancies", "We're hiring a bookkeeper", "We are hiring"):
        assert SG.extract(pages(line))["hiring"] is True, line
    assert SG.extract(pages("About us and contact"))["hiring"] is False


def test_team_size_is_read_from_team_of_n():
    assert SG.extract(pages("We are a team of 12 accountants."))["team_size"] == 12
    assert SG.extract(pages("A team of 8, and a team of 15 across two offices"))["team_size"] == 15
    assert SG.extract(pages("Our team of experts"))["team_size"] is None
    assert SG.extract([])["team_size"] is None
    assert SG.extract(pages("x"), datetime(2026, 11, 11))["read_at"].startswith("2026-11-11")


def test_no_false_sage_in_message():
    out = SG.extract(pages("Send us a message. Our passage of time, usage and a sage old saying. Sage advice is free. Messages sent."))
    assert out["software"] == []


def test_signals_show_in_why_now():
    from app.services import fit_score as FS

    biz = SimpleNamespace(status="Active", accounts_due_on=None, confstmt_due_on=None, incorporated_on=None, officers=None,
                          raw_data={"site_signals": {"mtd": True, "hiring": True, "software": ["Xero"], "team_size": None}})
    keys = [s["key"] for s in FS.signals(biz)]
    assert {"site_mtd", "site_hiring", "site_software"} <= set(keys)
    assert BR.normalize_filters({"site": ["mtd", "nope"]})["site"] == ["mtd"]


@pytest.mark.db
async def test_site_filter_runs_on_postgres(db):
    from app.models.models import BusinessRecord

    def mk(i, signals):
        return BusinessRecord(id=f"s{i}", identity_hash=f"sh{i}", name=f"Firm {i}", status="Active", postcode="LS1 4AP", sic_codes="|69201|",
                              raw_data={"site_signals": signals} if signals is not None else None)

    db.add_all([mk(1, {"mtd": True, "hiring": False, "software": []}), mk(2, {"mtd": False, "hiring": True, "software": ["Xero"]}),
                mk(3, {"mtd": False, "hiring": False, "software": []}), mk(4, None)])
    await db.commit()

    async def ids(site):
        res = await BR.search_filtered(db, {"sic_codes": ["69201"], "site": site}, limit=50, stats=False, broaden=False)
        return {r.id for r in res["rows"]}

    assert await ids(["mtd"]) == {"s1"}
    assert await ids(["hiring"]) == {"s2"}
    assert await ids(["software"]) == {"s2"}
    assert await ids(["mtd", "hiring"]) == {"s1", "s2"}


async def test_company_news_skips_low_fit(monkeypatch):
    from app.services import company_news as CN
    from app.services import enrichment_service as ES

    calls = []

    async def fake_search(query, **kw):
        calls.append((query, kw))
        return [{"title": "Oak Dental opens a new clinic", "snippet": "", "url": "https://www.leedsnews.example/oak"}]

    class Db:
        async def flush(self):
            pass

    monkeypatch.setattr(ES, "search_tavily", fake_search)
    biz = SimpleNamespace(name="Oak Dental Ltd", region="Leeds", raw_data=None)
    assert await CN.news_for(Db(), biz, 69) == {"skipped": "low_fit"}
    assert await CN.news_for(Db(), biz, None) == {"skipped": "low_fit"}
    assert calls == []
    got = await CN.news_for(Db(), biz, 82)
    assert got["headline"].startswith("Oak Dental") and got["source"] == "leedsnews.example" and calls[0][1]["days"] == 30
    again = await CN.news_for(Db(), biz, 82)  # kept for 7 days: no second search
    assert again["cached"] is True and len(calls) == 1
    biz.raw_data["news"]["at"] = (datetime.utcnow() - timedelta(days=8)).isoformat() + "Z"
    await CN.news_for(Db(), biz, 82)
    assert len(calls) == 2
