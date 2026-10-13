"""Smart email writing: only facts we hold are used, anything else is caught by code, and only lines written are charged."""
from types import SimpleNamespace

import httpx
import pytest

from app.main import app
from app.services import email_writer as W
from tests.conftest import make_user

pytestmark = pytest.mark.db

PROFILE = {"company": "Brightside Accounting", "sells": "Bookkeeping and year-end accounts for small shops", "sender_name": "Priya Shah",
           "sender_title": "Founder", "proof": ["We have looked after 40 local shops since 2015"], "offer": "a free 15-minute review"}


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


def test_the_checker_catches_what_the_facts_do_not_back_up():
    allowed = W.sender_texts(W.clean_profile(PROFILE)) + ["A list of 12 UK businesses. Mostly in: Leeds."]
    good = "Hi {{first_name}},\n\nWe look after 40 local shops, and I'd love to give {{company}} a free 15-minute review.\n\nPriya Shah"
    assert W.violations(good, allowed) == []
    assert any("60%" in v for v in W.violations("We cut costs by 60% for every client.", allowed))
    assert any("Barclays" in v for v in W.violations("Hi,\n\nWe also work with Barclays and others.", allowed))
    assert any("guaranteed" in v for v in W.violations("Results are guaranteed for you.", allowed))
    assert any("{{discount}}" in v for v in W.violations("Hi {{first_name}}, here is {{discount}}.", allowed))
    assert any("too long" in v for v in W.violations("word " * 200, allowed))
    # a capital at the start of a sentence or paragraph is just grammar, not a made-up name
    assert W.violations("Hi {{first_name}},\n\nIf that sounds useful, tell me.\n\nThanks,\nPriya Shah", allowed) == []
    assert any("Barclays" in v for v in W.violations("Hi,\n\nWe help firms like Barclays.", allowed))


def test_facts_are_labelled_with_their_source_and_a_web_claim_is_marked_unverified():
    acct = SimpleNamespace(region="Leeds", industry="Dental", contact_name="Sam Lee", contact_title="Director",
                           research={"overview": "A family dental practice."}, name="Kirkgate Dental")
    facts = W.recipient_facts(acct, None)
    by_text = {f["text"]: f for f in facts}
    assert by_text["It is based in Leeds."]["source"] == "your list" and by_text["It is based in Leeds."]["verified"] is False
    web = next(f for f in facts if f["source"] == "web lookup")
    assert web["verified"] is False and "not verified" in web["text"]


async def test_a_line_that_invents_something_is_dropped_and_a_grounded_one_is_kept(monkeypatch):
    acct = SimpleNamespace(name="Kirkgate Dental", contact_name="Sam Lee")
    facts = [{"id": "f1", "text": "It is based in Leeds.", "source": "your list", "verified": False}]

    async def grounded(db, system, user, **k):
        return {"line": "Running a dental practice in Leeds keeps you busy.", "fact_ids": ["f1"]}

    monkeypatch.setattr(W, "_ask", grounded)
    out = await W.personal_line(None, W.clean_profile(PROFILE), acct, facts, {})
    assert out["line"].startswith("Running a dental practice in Leeds") and out["facts"][0]["source"] == "your list"

    async def invented(db, system, user, **k):
        return {"line": "Congrats on growing 300% last year in Leeds.", "fact_ids": ["f1"]}

    monkeypatch.setattr(W, "_ask", invented)
    out = await W.personal_line(None, W.clean_profile(PROFILE), acct, facts, {})
    assert out["line"] == "" and "do not back up" in out["reason"]

    async def no_fact(db, system, user, **k):
        return {"line": "Nice website.", "fact_ids": []}

    monkeypatch.setattr(W, "_ask", no_fact)
    assert (await W.personal_line(None, W.clean_profile(PROFILE), acct, facts, {}))["line"] == ""
    assert (await W.personal_line(None, W.clean_profile(PROFILE), acct, [], {}))["line"] == ""


async def test_the_full_flow_profile_sequence_lines_charge_and_send(db, monkeypatch):
    from app.core.tenancy import org_scope
    from app.services import credits as K
    from app.services.email_worker import render

    _, token = await make_user(db, "wr", "Admin", org_id="org_writer")
    with org_scope("org_writer"):
        await K.add_credits(db, "leadgen", 10, source="grant", note="Test")
        await db.commit()
    calls = {"n": 0}

    async def fake_ask(db_, system, user, **k):
        calls["n"] += 1
        if "FACTS about the receiver" in user:
            return {"line": "Running a dental practice in Leeds keeps you busy.", "fact_ids": ["f1", "f2"]}
        if calls["n"] == 1:  # the first try quotes an invented result; the retry is clean
            return {"steps": [{"subject": "Quick idea", "body": "Hi {{first_name}},\n\n{{personal_line}}\n\nWe cut bills by 80%.\n\nPriya Shah"}]}
        return {"steps": [{"subject": "Quick idea", "body": "Hi {{first_name}},\n\n{{personal_line}}\n\nWe look after 40 local shops.\n\nPriya Shah"},
                          {"subject": "", "body": "Hi {{first_name}}, any thoughts?\n\nPriya Shah"}]}

    async def no_creds(db_):
        return {}

    monkeypatch.setattr(W, "_ask", fake_ask)
    monkeypatch.setattr(W, "writer_credentials", no_creds)
    async with _client(token) as c:
        assert (await c.post("/api/email/ai/sequence", json={"account_ids": []})).status_code == 400  # tell us about your business first
        saved = await c.put("/api/email/ai/profile", json=PROFILE)
        assert saved.status_code == 200 and saved.json()["missing"] == []

        accts = (await c.post("/api/leads/accounts", json={"accounts": [
            {"name": "Kirkgate Dental", "region": "Leeds", "industry": "Dental practice", "contact_name": "Sam Lee", "contact_title": "Director"},
            {"name": "Bare Co"}]})).json()["accounts"]
        ids = [a["id"] for a in accts]

        seq = (await c.post("/api/email/ai/sequence", json={"account_ids": ids, "personalise": True})).json()
        assert calls["n"] == 2 and len(seq["steps"]) == 2  # one retry after the invented 80% was caught
        assert seq["steps"][0]["warnings"] == [] and "{{personal_line}}" in seq["steps"][0]["body"]

        calls["n"] = 0
        before = (await c.get("/api/credits/leads")).json()["balance"]
        res = (await c.post("/api/email/ai/personalise", json={"account_ids": ids})).json()
        by_name = {line["name"]: line for line in res["lines"]}
        assert by_name["Kirkgate Dental"]["line"].startswith("Running a dental practice") and by_name["Kirkgate Dental"]["facts"]
        assert by_name["Bare Co"]["line"] == "" and by_name["Bare Co"]["reason"]  # nothing known, nothing written
        assert res["written"] == 1 and res["charged"] == 1 and calls["n"] == 1  # only the company with facts was asked, and paid for
        assert (await c.get("/api/credits/leads")).json()["balance"] == before - 1

        camp = (await c.post("/api/email/campaigns", json={"name": "Smart", "mailbox_ids": [], "steps": [{"subject": "Quick idea", "body": seq["steps"][0]["body"]}]})).json()["campaign"]
        await c.post(f"/api/email/campaigns/{camp['id']}/leads", json={"leads": [
            {"email": "sam@kirkgate.co.uk", "first_name": "Sam", "company": "Kirkgate Dental", "personal_line": by_name["Kirkgate Dental"]["line"]},
            {"email": "pat@bare.co.uk", "first_name": "Pat", "company": "Bare Co"}]})
    from sqlalchemy import select

    from app.models.models import EmailEnrollment

    with org_scope("org_writer"):
        rows = {e.first_name: e for e in (await db.execute(select(EmailEnrollment))).scalars().all()}
    body = seq["steps"][0]["body"]
    assert "Running a dental practice in Leeds" in render(body, rows["Sam"])
    empty = render(body, rows["Pat"])
    assert "{{" not in empty and "\n\n\n" not in empty  # a person with no line gets a clean email, no gap


async def test_the_writer_reads_the_shared_company_profile_and_ignores_its_starter_text(db):
    from app.core.tenancy import org_scope  # noqa: F401

    _, token = await make_user(db, "wr2", "Admin", org_id="org_writer2")
    async with _client(token) as c:
        # a brand-new account holds starter text that is nobody's real business: it must not be used as fact
        first = (await c.get("/api/email/ai/profile")).json()
        assert first["profile"]["sells"] == "" and first["profile"]["company"] == ""
        assert {"your company name", "what you sell"} <= set(first["missing"])
        # filling in the company profile elsewhere in the app is enough for the writer to know the business
        await c.put("/api/profile", json={"name": "Brightside Accounting", "pitch": "Bookkeeping for small shops", "website": "https://brightside.example"})
        await c.put("/api/profile/services", json={"services": [{"id": "svc_1", "name": "Year-end accounts", "ideal": "Owner-run shops", "desc": "Fixed-fee annual accounts"}]})
        got = (await c.get("/api/email/ai/profile")).json()
        assert got["profile"]["company"] == "Brightside Accounting" and "Year-end accounts" in got["profile"]["sells"]
        assert got["profile"]["audience"] == "Owner-run shops" and got["edit"]["sells"] == "Bookkeeping for small shops"
        # saving the extras from the email side writes the shared profile back, so both stay one thing
        saved = (await c.put("/api/email/ai/profile", json={"company": "Brightside Accounting", "sells": "Bookkeeping and tax for small shops",
                                                            "sender_name": "Priya Shah", "offer": "a free review", "proof": ["40 shops since 2015"]})).json()
        assert saved["missing"] == [] and (await c.get("/api/profile")).json()["pitch"] == "Bookkeeping and tax for small shops"
        assert saved["edit"]["proof"] == ["40 shops since 2015"]


async def test_only_an_admin_can_change_the_shared_company_profile(db):
    _, admin = await make_user(db, "wr3a", "Admin", org_id="org_writer3")
    _, member = await make_user(db, "wr3b", "Operator", org_id="org_writer3")
    async with _client(admin) as a, _client(member) as m:
        assert (await a.put("/api/email/ai/profile", json=PROFILE)).status_code == 200
        got = (await m.get("/api/email/ai/profile")).json()
        assert got["can_edit"] is False and got["profile"]["company"] == "Brightside Accounting"  # everyone can read it
        blocked = await m.put("/api/email/ai/profile", json={**PROFILE, "company": "Hijacked Ltd"})
        assert blocked.status_code == 403
        assert (await a.get("/api/email/ai/profile")).json()["profile"]["company"] == "Brightside Accounting"
