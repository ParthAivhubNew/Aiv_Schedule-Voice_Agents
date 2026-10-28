"""While a company check runs its companies can be edited but not deleted or taken out of a list, and edits never reach the check's
results. Saving never makes a second copy of a company, whichever way its identity is known."""
from datetime import datetime

import httpx
import pytest

from app.core.tenancy import org_scope
from app.main import app
from app.services import company_check_job as job
from app.services import credits as K
from tests.conftest import make_user

pytestmark = pytest.mark.db


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


async def _running_check(db, org, ids, status="running"):
    with org_scope(org):
        await K._put_doc(db, job._key(org, "chk_t"), {"job_id": "chk_t", "status": status, "total": len(ids), "done": 0,
                                                         "updated_at": datetime.utcnow().isoformat()})
        await K._put_doc(db, job._ids_key(org, "chk_t"), {"ids": ids})
        await K._put_doc(db, job._latest_key(org), {"job_id": "chk_t"})
        await db.commit()


async def test_a_company_in_a_running_check_can_be_edited_but_not_deleted_or_removed(db):
    _, token = await make_user(db, "chk1", "Admin", org_id="org_chk1")
    async with _client(token) as c:
        saved = (await c.post("/api/leads/accounts", json={"list_name": "March", "accounts": [{"name": "Kirkgate Dental"}, {"name": "Headrow Lettings"}]})).json()
        a, b = [x["id"] for x in saved["accounts"]]
        lst = saved["list"]["id"]
        await _running_check(db, "org_chk1", [a])

        assert (await c.patch(f"/api/leads/accounts/{a}", json={"phone": "0113 496 0000"})).status_code == 200  # editing stays open
        assert (await c.delete(f"/api/leads/accounts/{a}")).status_code == 409
        assert (await c.patch(f"/api/leads/lists/{lst}", json={"remove": [a]})).status_code == 409
        assert (await c.delete(f"/api/leads/lists/{lst}")).status_code == 409
        assert (await c.delete(f"/api/leads/accounts/{b}")).status_code == 200  # not part of the check
        latest = (await c.get("/api/leads/checks/latest")).json()
        assert latest["locked_ids"] == [a]

        await _running_check(db, "org_chk1", [a], status="done")  # the check ended: everything is open again
        assert (await c.get("/api/leads/checks/latest")).json()["locked_ids"] == []
        assert (await c.patch(f"/api/leads/lists/{lst}", json={"remove": [a]})).status_code == 200
        assert (await c.delete(f"/api/leads/accounts/{a}")).status_code == 200


async def test_an_edit_made_during_a_check_is_kept_and_the_check_does_not_overwrite_it(db):
    _, token = await make_user(db, "chk2", "Admin", org_id="org_chk2")
    async with _client(token) as c:
        acc = (await c.post("/api/leads/accounts", json={"accounts": [{"name": "Kirkgate Dental", "phone": "0113 111 1111"}]})).json()["accounts"][0]
        snap = {acc["id"]: {"id": acc["id"], "name": "Kirkgate Dental", "website": "", "phone": "0113 111 1111", "email": "", "contact_name": ""}}
        await c.patch(f"/api/leads/accounts/{acc['id']}", json={"phone": "0113 222 2222", "email": ""})
        result = {"verdict": "verified", "reasons": [], "fixes": [
            {"field": "phone", "kind": "fill", "from": "0113 111 1111", "to": "0113 999 9999"},
            {"field": "website", "kind": "fill", "from": "", "to": "https://kirkgate.example"}]}
        with org_scope("org_chk2"):
            await job._save_results([(acc["id"], result)], snap)
        got = (await c.get("/api/leads/accounts")).json()["accounts"][0]
        assert got["phone"] == "0113 222 2222"  # what they typed stays
        assert got["website"].startswith("https://kirkgate.example")  # an untouched blank is still filled
        assert got["verification"]["edited_during_check"] == ["phone"]
        assert got["verification"]["verdict"] == "verified"


async def test_the_same_company_is_never_saved_twice(db):
    _, token = await make_user(db, "dup1", "Admin", org_id="org_dup1")
    async with _client(token) as c:
        first = (await c.post("/api/leads/accounts", json={"accounts": [{"name": "Kirkgate Dental", "region": "Leeds"}]})).json()["accounts"][0]
        # saved before without a website, now arriving with one: the same firm
        r = (await c.post("/api/leads/accounts", json={"accounts": [{"name": "kirkgate dental", "region": "LEEDS", "website": "kirkgate.example"}]})).json()
        assert r["added"] == 0 and r["matched"] == 1
        # a different company with its own website is simply added
        one = (await c.post("/api/leads/accounts", json={"accounts": [{"name": "Headrow Lettings", "website": "headrow.example"}]})).json()
        assert one["added"] == 1
        # an edit may not turn a company into a copy of another
        other = (await c.post("/api/leads/accounts", json={"accounts": [{"name": "Brand New Ltd"}]})).json()["accounts"][0]
        bad = await c.patch(f"/api/leads/accounts/{other['id']}", json={"website": "https://www.headrow.example/contact"})
        assert bad.status_code == 409 and "Headrow" in bad.json()["detail"]
        again = await c.patch(f"/api/leads/accounts/{other['id']}", json={"name": "Kirkgate Dental", "region": "Leeds"})
        assert again.status_code == 409
        assert (await c.patch(f"/api/leads/accounts/{other['id']}", json={"website": "https://brandnew.example"})).status_code == 200
        assert first["id"]


async def test_an_import_can_fill_blanks_skip_or_overwrite_a_company_already_saved(db):
    _, token = await make_user(db, "imp1", "Admin", org_id="org_imp1")
    async with _client(token) as c:
        await c.post("/api/leads/accounts", json={"accounts": [{"name": "Kirkgate Dental", "website": "kirkgate.example", "phone": "0113 111 1111"}]})
        row = {"name": "Kirkgate Dental", "website": "kirkgate.example", "phone": "0113 999 9999", "email": "hi@kirkgate.example", "source": "import"}

        r = (await c.post("/api/leads/accounts", json={"accounts": [row], "on_existing": "skip", "list_name": "A"})).json()
        assert r["matched"] == 1 and r["updated"] == [] and r["list"]["count"] == 1  # left alone, still put in the list

        r = (await c.post("/api/leads/accounts", json={"accounts": [row], "list_name": "B"})).json()
        got = r["updated"][0]
        assert got["email"] == "hi@kirkgate.example" and got["phone"] == "0113 111 1111"  # default: blanks filled, nothing overwritten

        r = (await c.post("/api/leads/accounts", json={"accounts": [row], "on_existing": "update", "list_name": "C"})).json()
        assert r["updated"][0]["phone"] == "0113 999 9999"  # the file wins
        lists = (await c.get("/api/leads/lists")).json()["lists"]
        assert all(l.get("updated_at") for l in lists if l["name"] in ("A", "B", "C"))


async def test_a_person_with_no_company_can_be_saved_by_their_name(db):
    _, token = await make_user(db, "imp2", "Admin", org_id="org_imp2")
    async with _client(token) as c:
        r = (await c.post("/api/leads/accounts", json={"list_name": "Calls", "accounts": [
            {"name": "Mayur Doshi", "contact_name": "Mayur Doshi", "phone": "+447587200616", "source": "import"},
            {"name": "Hemant Mehta", "contact_name": "Hemant Mehta", "phone": "+447890994407", "email": "careers@aivhub.com", "source": "import"}]})).json()
        assert r["added"] == 2 and r["unnamed"] == 0


async def test_two_people_at_one_company_are_two_records_and_the_same_person_is_not_repeated(db):
    _, token = await make_user(db, "imp3", "Admin", org_id="org_imp3")
    async with _client(token) as c:
        rows = [{"name": "AIVHUB LTD", "contact_name": "Hemant Mehta", "phone": "1", "source": "import"},
                {"name": "AIVHUB LTD", "contact_name": "Jitendra Mehta", "phone": "2", "source": "import"},
                {"name": "AIVHUB LTD", "contact_name": "hemant mehta", "phone": "1", "source": "import"}]
        r = (await c.post("/api/leads/accounts", json={"list_name": "People", "accounts": rows})).json()
        assert r["added"] == 2 and r["repeats"] == 1 and r["list"]["count"] == 2
        again = (await c.post("/api/leads/accounts", json={"list_name": "People", "accounts": rows})).json()
        assert again["added"] == 0 and again["matched"] == 2
