"""The company page: what we hold about one company, the reasons to get in touch now, where each contact detail came from, and the people on it."""
import json
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy.future import select

from app.core.tenancy import org_scope
from app.models.models import BusinessRecord, ContactEvent, EmailEnrollment, LeadAccount
from app.services import company_profile as CP
from app.services import journeys as J

TODAY = date(2026, 10, 30)


def _d(days_ago: int) -> str:
    return (TODAY - timedelta(days=days_ago)).strftime("%d/%m/%Y")


def _ch(**over):
    base = {" CompanyNumber": "00445790", "Accounts.AccountCategory": "SMALL", "Accounts.NextDueDate": _d(-30), "Accounts.LastMadeUpDate": _d(335),
            "ConfStmtNextDueDate": _d(100), "ConfStmtLastMadeUpDate": _d(465), "Mortgages.NumMortOutstanding": "0", "Mortgages.NumMortSatisfied": "2",
            "Mortgages.NumMortCharges": "2", "CountryOfOrigin": "United Kingdom", "PreviousName_1.CompanyName": "", " PreviousName_1.CONDATE": ""}
    base.update(over)
    return base


def _biz(**kw):
    ch = kw.pop("ch", _ch())
    return BusinessRecord(id=kw.pop("id", "br_t1"), identity_hash=kw.pop("hash", "ht1"), name=kw.pop("name", "BRIGHT CAFE LIMITED"), registration_number=kw.pop("number", "00445790"),
                          status=kw.pop("status", "Active"), company_category=kw.pop("category", "Private Limited Company"), region=kw.pop("region", "LEEDS"),
                          postcode="LS1 4AP", address="1 High St, Leeds, LS1 4AP", sic_text=kw.pop("sic", "56102 - Unlicensed restaurants and cafes"),
                          incorporated_on=kw.pop("born", date(2020, 3, 1)), size_band=kw.pop("size", "small"), confidence_tier="verified_registry",
                          raw_data={"ds_companies_house": ch}, rank_score=1000, **kw)


# ── no database ─────────────────────────────────────────────────────────────
def test_the_registers_field_names_with_stray_spaces_are_read():
    got = CP.register_fields(_biz())
    assert got["CompanyNumber"] == "00445790" and got["PreviousName_1.CONDATE"] == "" and got["Accounts.AccountCategory"] == "SMALL"
    assert CP.register_fields(BusinessRecord(id="x", identity_hash="y", name="n", raw_data={"other": {"a": "b"}})) == {}


def test_reasons_to_get_in_touch_now_each_come_from_a_stored_field():
    biz = _biz(born=TODAY - timedelta(days=60))
    ch = CP.register_fields(_biz(ch=_ch(**{"Mortgages.NumMortOutstanding": "1", "PreviousName_1.CompanyName": "OLD NAME LTD", "PreviousName_1.CONDATE": _d(100)})))
    officers = [{"first_name": "Ann", "last_name": "Lee", "name": "LEE, Ann", "years_in_role": 0}]
    got = {s["key"]: s for s in CP.signals(biz, ch, officers, [{"name": "X"}], TODAY)}
    assert set(got) == {"new_company", "accounts_due", "confirmation_overdue", "renamed", "director_new", "director_left", "charges"}
    assert got["accounts_due"]["tone"] == "opportunity" and got["confirmation_overdue"]["tone"] == "caution" and "OLD NAME LTD" in got["renamed"]["detail"]
    assert "Ann Lee" in got["director_new"]["detail"] and got["charges"]["label"] == "1 outstanding charge"


def test_overdue_accounts_a_proposal_to_strike_off_and_a_closed_company_are_told_apart():
    ch = CP.register_fields(_biz(ch=_ch(**{"Accounts.NextDueDate": _d(10)})))
    assert [s["key"] for s in CP.signals(_biz(), ch, [], [], TODAY)] == ["accounts_overdue", "confirmation_overdue"]
    strike = CP.signals(_biz(status="Active - Proposal to Strike off"), ch, [], [], TODAY)
    assert strike[0]["key"] == "strike_off" and strike[0]["tone"] == "caution"
    closed = CP.signals(_biz(status="Liquidation"), ch, [{"years_in_role": 0, "first_name": "A", "last_name": "B", "name": "B, A"}], [], TODAY)
    assert [s["key"] for s in closed] == ["closed"]  # nothing else is offered for a company that is closing
    assert CP.status_tone("Liquidation") == "red" and CP.status_tone("Active - Proposal to Strike off") == "amber" and CP.status_tone("Active") == "green"


def test_a_person_gets_a_reason_from_the_register_only():
    assert CP.person_reason({"years_in_role": 0, "role": "Director"}) == "New in role"
    assert CP.person_reason({"years_in_role": 12, "role": "Director"}) == "Long-standing"
    assert CP.person_reason({"years_in_role": 3, "role": "Director"}) == "Director"
    assert CP.person_reason({"years_in_role": 3, "role": "Secretary"}) == "Company secretary"
    assert CP.person_reason({"years_in_role": None, "role": ""}) == ""


def test_the_summary_restates_stored_facts_and_leaves_out_what_is_not_stored():
    text = CP.summary(_biz(), CP.register_fields(_biz()), TODAY)
    assert text.startswith("Bright Cafe Limited is a private limited company in Leeds, registered on 1 Mar 2020.") and "unlicensed restaurants and cafes" in text
    assert "small company accounts" in text and "Register status: active." in text
    bare = CP.summary(BusinessRecord(id="b", identity_hash="b", name="Nobody Ltd", raw_data={}), {}, TODAY)
    assert bare == "Nobody Ltd is a company." and "accounts" not in bare  # nothing invented


def test_each_contact_detail_says_where_it_came_from():
    got = CP._contact({"website": "bright.co.uk", "web_website": "", "phone": "", "web_phone": "0113 496 0123", "email": ""})
    assert (got["website"]["source"], got["phone"]["source"], got["email"]["source"]) == ("register", "web", "missing")
    assert "check" in got["phone"]["label"].lower() and got["email"]["value"] == ""


def test_age_in_words():
    assert CP.age_words(TODAY - timedelta(days=20), TODAY) == "set up in the last two months"
    assert CP.age_words(TODAY - timedelta(days=400), TODAY) == "13 months old"
    assert CP.age_words(TODAY - timedelta(days=365 * 6), TODAY) == "6 years old"
    assert CP.age_words(None, TODAY) == ""


# ── on a real database ───────────────────────────────────────────────────────
@pytest.mark.db
async def test_the_profile_endpoint_returns_the_whole_company(client, db, monkeypatch):
    from app.services import company_contacts as CC

    async def no_registry(*a, **k):
        return False

    monkeypatch.setattr(CC, "refresh_from_registry", no_registry)
    db.add(_biz(officers=[{"name": "LEE, Ann", "role": "director", "appointed_on": f"{datetime.utcnow().year}-01-05", "nationality": "British", "v": 2}]))
    await db.commit()
    r = await client.get("/api/leads/companies/br_t1/profile")
    assert r.status_code == 200, r.text
    c = r.json()["company"]
    assert c["name"] == "BRIGHT CAFE LIMITED" and c["status_tone"] == "green" and c["size"] == "Small" and c["sic"] == [{"code": "56102", "text": "Unlicensed restaurants and cafes"}]
    assert c["accounts"]["category"] == "Small company accounts" and c["charges"] == {"outstanding": 0, "satisfied": 2, "total": 2}
    assert c["missing"] == ["website", "phone", "email"] and c["saved"] is False and c["lists"] == [] and c["journeys"] == []
    assert [o["name"] for o in c["people"]["officers"]] == ["LEE, Ann"] and c["people"]["officers"][0]["reason"] in ("New in role", "Director")
    assert (await client.get("/api/leads/companies/nope/profile")).status_code == 404


@pytest.mark.db
async def test_a_page_opens_with_what_is_stored_even_when_the_registry_cannot_be_reached(client, db, monkeypatch):
    from app.services import company_contacts as CC

    calls = []

    async def down(*a, **k):
        calls.append(1)
        raise RuntimeError("registry unreachable")

    monkeypatch.setattr(CC, "refresh_from_registry", down)
    db.add(_biz(id="br_t2", hash="ht2"))
    db.add(_biz(id="br_t3", hash="ht3", name="A CHARITY", number="CC-123456", category="Registered charity"))
    await db.commit()
    assert (await client.get("/api/leads/companies/br_t2/profile")).status_code == 200 and len(calls) == 1
    assert (await client.get("/api/leads/companies/br_t3/profile")).status_code == 200 and len(calls) == 1  # a charity has no Companies House number: not asked


@pytest.mark.db
async def test_a_saved_company_shows_its_stage_lists_journeys_and_activity(client, db, monkeypatch):
    from app.api import lead_lists as LL
    from app.services import company_contacts as CC

    monkeypatch.setattr(CC, "refresh_from_registry", lambda *a, **k: _false())
    db.add(_biz())
    await db.commit()
    with org_scope("org_default"):
        db.add(LeadAccount(id="ld_cp", name="Bright Cafe Ltd", email="ann@bright.co.uk", stage="interested", business_record_id="br_t1"))
        await db.commit()
        await LL.put_in_list(db, "", "Leeds cafes", ["ld_cp"])
        camp = await J.create(db, name="Cafes journey", steps=[{"channel": "email", "subject": "Hi", "body": "Hello"}], mailbox_ids=[])
        db.add(EmailEnrollment(id="en_cp", campaign_id=camp.id, lead_id="ld_cp", email="ann@bright.co.uk", status="active", current_step=1))
        db.add(ContactEvent(id="ev_cp", lead_id="ld_cp", kind="call", summary="Spoke to them", at=datetime.utcnow()))
        await db.commit()
    c = (await client.get("/api/leads/companies/br_t1/profile")).json()["company"]
    assert c["saved"] and c["stage"] == "interested" and c["lists"] == ["Leeds cafes"]
    assert [(j["name"], j["person_status"]) for j in c["journeys"]] == [("Cafes journey", "active")] and c["activity"][0]["summary"] == "Spoke to them"


async def _false():
    return False


@pytest.mark.db
async def test_adding_a_company_to_a_journey_saves_it_and_picks_the_person_to_write_to(client, db):
    with org_scope("org_default"):
        camp = await J.create(db, name="Cafes journey", steps=[{"channel": "email", "subject": "Hi {{company}}", "body": "Hello {{first_name}}"}], mailbox_ids=[])
        await db.commit()
        cid = camp.id
    db.add(_biz(email="hello@bright.co.uk", officers=[{"name": "LEE, Ann", "role": "director", "appointed_on": "2020-01-05", "v": 2}]))
    db.add(_biz(id="br_noemail", hash="hne", name="NO EMAIL LTD", number="00000002"))
    await db.commit()
    ok = await client.post("/api/leads/companies/br_t1/add-to-journey", json={"journey_id": cid})
    assert ok.status_code == 200, ok.text
    assert ok.json() == {"added": 1, "journey": "Cafes journey"}
    with org_scope("org_default"):
        lead = (await db.execute(select(LeadAccount).where(LeadAccount.business_record_id == "br_t1"))).scalars().first()
        enr = (await db.execute(select(EmailEnrollment).where(EmailEnrollment.campaign_id == cid))).scalars().first()
        assert lead is not None and enr.lead_id == lead.id and (enr.first_name, enr.last_name) == ("Ann", "Lee") and enr.email == "hello@bright.co.uk"
    again = await client.post("/api/leads/companies/br_t1/add-to-journey", json={"journey_id": cid})
    assert again.status_code == 400 and "already in that journey" in again.json()["detail"]
    nomail = await client.post("/api/leads/companies/br_noemail/add-to-journey", json={"journey_id": cid})
    assert nomail.status_code == 400 and "no email address" in nomail.json()["detail"]
    assert (await client.post("/api/leads/companies/br_t1/add-to-journey", json={"journey_id": "nope"})).status_code == 404


@pytest.mark.db
async def test_the_chat_can_read_one_company_and_offers_to_open_its_page(db, monkeypatch):
    import httpx

    from app.api import lead_assistant as LA
    from app.main import app
    from app.services import business_records, llm_gateway
    from tests.conftest import make_user

    async def plan(**_):
        return state["plan"]

    async def answer(**_):
        return {"success": True, "reply": "Here is what we hold."}

    async def empty(db_, filters, **_):
        return {"total": 0, "total_capped": False, "rows": []}

    state = {"plan": {"success": True, "reply": "", "tool_calls": [{"id": "c1", "function": {"name": "my_data", "arguments": json.dumps({"topic": "company", "company": "bright cafe"})}}]}}
    monkeypatch.setattr(llm_gateway, "call_open_chat_llm_with_tools", plan)
    monkeypatch.setattr(llm_gateway, "call_open_chat_llm", answer)
    monkeypatch.setattr(business_records, "search_filtered", empty)
    db.add(_biz())
    await db.commit()
    _, token = await make_user(db, "cp_chat", "Admin", org_id="org_cp_chat")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"}) as c:
        r = (await c.post("/api/leads/assistant/ask", json={"message": "tell me about Bright Cafe"})).json()
        assert r["proposals"][0]["kind"] == "company_open" and r["proposals"][0]["params"] == {"company_id": "br_t1"} and r["steps"][0]["label"] == "Read a company"
        state["plan"] = {"success": True, "reply": "", "tool_calls": [{"id": "c2", "function": {"name": "my_data", "arguments": json.dumps({"topic": "company", "company": "zzz nothing"})}}]}
        r = (await c.post("/api/leads/assistant/ask", json={"message": "tell me about Zzz"})).json()
        assert r["proposals"] == []
    brief = CP.brief_text(await CP.build(db, await db.get(BusinessRecord, "br_t1")))
    assert "Bright Cafe Limited is a private limited company in Leeds" in brief and "Contact details we hold: none yet" in brief
