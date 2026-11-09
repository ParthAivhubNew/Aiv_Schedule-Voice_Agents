"""Notes on companies and people: kept with who wrote them and when, shared in the organisation, the old single notes field shown as the oldest entry."""
from datetime import datetime

import pytest

from app.models.models import LeadAccount, LeadNote
from app.services import lead_notes as N


# ── no database ─────────────────────────────────────────────────────────────
def test_a_note_is_trimmed_and_an_empty_or_too_long_one_is_refused():
    assert N.clean_text("  Called, spoke to Ann.  \r\n\r\n\r\n\r\n\r\nCall back Friday ") == "Called, spoke to Ann.\n\n\nCall back Friday"
    with pytest.raises(N.NoteError):
        N.clean_text("   \n ")
    with pytest.raises(N.NoteError):
        N.clean_text("x" * (N.MAX_LEN + 1))
    assert len(N.clean_text("x" * N.MAX_LEN)) == N.MAX_LEN


def test_a_person_note_is_keyed_by_company_and_register_name_whatever_the_case():
    assert N.split_person_ref("br_1|SMITH,  John ") == ("br_1", "smith, john")
    assert N.split_person_ref("br_1") == ("br_1", "")


def test_the_old_notes_field_becomes_the_earlier_note_without_the_line_find_leads_wrote():
    lead = LeadAccount(id="la_1", name="Bright", notes="Reg no. 0123 · Active · Cafes · AB1 2CD\nAsk for Ann on Mondays")
    e = N.earlier_view(lead)
    assert e["text"] == "Ask for Ann on Mondays" and e["earlier"] and e["created_at"] is None and e["id"] == "earlier:la_1"
    assert N.earlier_view(LeadAccount(id="la_2", name="X", notes="Reg no. 9 · Active")) is None
    assert N.earlier_view(LeadAccount(id="la_3", name="X", notes="")) is None


def test_notes_are_newest_first_and_the_earlier_note_is_always_last():
    rows = [{"id": "e", "earlier": True, "created_at": None}, {"id": "a", "earlier": False, "created_at": "2026-11-01T10:00:00Z"},
            {"id": "b", "earlier": False, "created_at": "2026-11-05T10:00:00Z"}]
    assert [n["id"] for n in N.newest_first(rows)] == ["b", "a", "e"]
    s = N.summary(rows)
    assert s["count"] == 3 and s["latest"]["created_at"] == "2026-11-05T10:00:00Z"
    assert N.summary([]) == {"count": 0, "latest": None}


def test_only_the_author_or_an_admin_may_delete_a_note():
    row = LeadNote(id="ln_1", target_kind="company", text="Hi", author_user_id="op_1", author_name="Ann", created_at=datetime(2026, 11, 9, 9, 0))
    assert N.view(row, "op_1")["can_delete"] and not N.view(row, "op_2")["can_delete"] and N.view(row, "op_2", admin=True)["can_delete"]
    assert N.view(row)["created_at"] == "2026-11-09T09:00:00Z"


def test_a_new_note_goes_on_the_store_record_when_the_company_has_one():
    c = N.Company(business_ids={"br_1"}, lead_ids={"la_1"})
    assert c.key == {"business_record_id": "br_1", "lead_account_id": None}
    assert N.Company(lead_ids={"la_1"}).key == {"business_record_id": None, "lead_account_id": "la_1"}
    assert c.owns(LeadNote(lead_account_id="la_1")) and c.owns(LeadNote(business_record_id="br_1")) and not c.owns(LeadNote(business_record_id="br_2"))


# ── database ────────────────────────────────────────────────────────────────
@pytest.mark.db
async def test_notes_are_shared_in_the_organisation_and_the_same_from_the_saved_company_and_the_store(db):
    import httpx

    from app.main import app
    from tests.conftest import make_user

    _, ann = await make_user(db, "ln_ann", "Admin", org_id="org_ln")
    _, other = await make_user(db, "ln_other", "Admin", org_id="org_ln_other")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {ann}"}) as c:
        saved = (await c.post("/api/leads/accounts", json={"accounts": [{"name": "Bright Cafe", "business_record_id": "br_ln1", "notes": "Old note"}]})).json()
        lead_id = saved["accounts"][0]["id"]
        assert (await c.post("/api/leads/notes", json={"company_id": "br_ln1", "text": "From Find Leads"})).status_code == 200
        assert (await c.post("/api/leads/notes", json={"company_id": "br_ln1", "person": "SMITH, John", "text": "Prefers email"})).status_code == 200
        on_saved = (await c.get(f"/api/leads/notes?account_id={lead_id}")).json()
        counts = (await c.post("/api/leads/notes/counts", json={"company_ids": [lead_id, "br_ln1"], "person_keys": ["br_ln1|smith, john"]})).json()
    assert [n["text"] for n in on_saved["notes"]] == ["From Find Leads", "Old note"]
    assert on_saved["people"]["smith, john"][0]["text"] == "Prefers email"
    assert counts["companies"][lead_id]["count"] == 2 and counts["companies"]["br_ln1"]["count"] == 2 and counts["people"]["br_ln1|smith, john"]["count"] == 1
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {other}"}) as c:
        theirs = (await c.get("/api/leads/notes?company_id=br_ln1")).json()
    assert theirs["notes"] == []
