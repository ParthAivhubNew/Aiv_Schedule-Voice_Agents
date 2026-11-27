"""A person whose admin gave them a list of postcode areas must stay inside those areas in the AI chat as well as in the Find Leads table:
the chat is told the areas, cannot describe or open a company outside them, cannot run a web search, and a search for another place says so
instead of quietly showing companies from their own areas under the wrong place. No database needed."""
from types import SimpleNamespace

import pytest

from app.api import lead_assistant as LA
from app.services import business_records as BR
from app.services import data_access as DA
from app.services import search_resolve

LIMITED = DA.Scope(districts=("BN1", "BN2"))
OPEN = DA.Scope()


def as_person(monkeypatch, scope):
    async def current(db=None):
        return scope

    monkeypatch.setattr(DA, "current_scope", current)


def turn(web=True):
    return LA._Turn(SimpleNamespace(filters={}, listed=None, web_search=web), [])


# ---- what the assistant is told ---------------------------------------------------------------------
def test_the_assistant_is_told_the_areas_and_not_to_look_elsewhere():
    line = DA.areas_line(LIMITED)
    assert "BN1, BN2" in line and "outside the areas" in line and "Never suggest searching somewhere else" in line
    assert DA.areas_line(OPEN) == ""


# ---- a company by name -------------------------------------------------------------------------------
async def test_a_register_company_outside_the_areas_is_not_described_or_opened(monkeypatch):
    from app.services import company_profile as CP

    as_person(monkeypatch, LIMITED)

    async def find(db, name):
        return SimpleNamespace(id="b1", name="Leeds Cafe Ltd", postcode="LS1 4AP")

    async def build(db, biz):
        raise AssertionError("a company outside the person's areas was read")

    monkeypatch.setattr(CP, "find", find)
    monkeypatch.setattr(CP, "build", build)
    t = turn()
    await LA._tool_company(None, t, "Leeds Cafe")
    assert t.proposals == [] and "outside the areas" in t.notes[0] and "Leeds Cafe" not in " ".join(t.notes)


async def test_a_register_company_inside_the_areas_is_described(monkeypatch):
    from app.services import company_profile as CP

    as_person(monkeypatch, LIMITED)

    async def find(db, name):
        return SimpleNamespace(id="b2", name="Hove Cafe Ltd", postcode="BN1 1AA")

    async def build(db, biz):
        return {"name": biz.name}

    monkeypatch.setattr(CP, "find", find)
    monkeypatch.setattr(CP, "build", build)
    monkeypatch.setattr(CP, "brief_text", lambda p: "A cafe.")
    t = turn()
    await LA._tool_company(None, t, "Hove Cafe")
    assert t.proposals and t.proposals[0]["params"]["company_id"] == "b2" and "Hove Cafe Ltd" in t.notes[0]


# ---- saved companies ---------------------------------------------------------------------------------
async def test_saved_company_questions_carry_the_area_condition(monkeypatch):
    as_person(monkeypatch, LIMITED)
    mine = await LA._mine(None)
    assert len(mine) == 1
    as_person(monkeypatch, OPEN)
    assert await LA._mine(None) == []


# ---- web search --------------------------------------------------------------------------------------
async def test_the_assistant_offers_no_web_search_to_a_limited_person(monkeypatch):
    as_person(monkeypatch, LIMITED)
    t = turn(web=True)
    await LA._run_tool(None, t, "search_web", {"query": "cafes in Leeds"})
    assert t.proposals == [] and DA.WEB_OFF in t.notes[0]


async def test_the_web_search_route_refuses_a_limited_person_before_searching_or_charging(monkeypatch):
    from app.api import enrichment as EN

    as_person(monkeypatch, LIMITED)

    async def allowed(db):
        return None

    async def boom(*a, **k):
        raise AssertionError("a web search was run or charged for a person with an area limit")

    monkeypatch.setattr(EN, "_can_research", allowed)
    monkeypatch.setattr(EN, "discover_new_target_accounts", boom)
    monkeypatch.setattr(EN, "_charge_leads", boom)
    with pytest.raises(DA.AccessDenied) as err:
        await EN.discover_accounts(EN.DiscoverAccountsRequest(query="cafes in Leeds"), None)
    assert err.value.status == 403 and err.value.code == "web_search_off" and err.value.detail == DA.WEB_OFF


async def test_the_web_search_route_is_unchanged_for_everyone_else(monkeypatch):
    from app.api import enrichment as EN

    as_person(monkeypatch, OPEN)
    charged = []

    async def allowed(db):
        return None

    async def found(**kw):
        return [{"id": "disc_1", "name": "Web Co", "tier": "web"}]

    async def charge(db, n, why):
        charged.append(n)

    monkeypatch.setattr(EN, "_can_research", allowed)
    monkeypatch.setattr(EN, "discover_new_target_accounts", found)
    monkeypatch.setattr(EN, "_charge_leads", charge)
    out = await EN.discover_accounts(EN.DiscoverAccountsRequest(query="cafes in Leeds"), None)
    assert out["count"] == 1 and charged == [1]


# ---- a search for another place ----------------------------------------------------------------------
async def _closest(keep_place):
    seen = []

    async def run(f):
        seen.append(dict(f))
        return {"rows": [], "total": 0 if f.get("towns") else 3, "filters": f}

    out, dropped = await BR.closest_match({"keyword": ["cafe"], "towns": ["Leeds"]}, run, keep_place=keep_place)
    return out, dropped, seen


async def test_a_normal_search_may_give_up_the_town_to_show_the_closest_companies():
    out, dropped, _ = await _closest(False)
    assert out and out["total"] == 3 and "town" in dropped


async def test_a_limited_person_never_has_the_place_given_up():
    out, dropped, seen = await _closest(True)
    assert out is None and dropped == []
    assert all(f.get("towns") == ["Leeds"] for f in seen)  # every attempt still asked for Leeds


async def test_the_shared_search_path_keeps_the_place_for_a_limited_person(monkeypatch):
    as_person(monkeypatch, LIMITED)

    async def widen(db, filters, drop_terms, run):
        return await run(filters), []

    monkeypatch.setattr(search_resolve.phrase_understanding, "widen_if_empty", widen)

    async def run(f):
        return {"rows": [], "total": 0 if f.get("towns") else 3, "filters": f}

    out, understood, relaxed = await search_resolve.resolve(None, {"keyword": ["cafe"], "towns": ["Leeds"]}, None, run)
    assert out["total"] == 0 and relaxed == []
    as_person(monkeypatch, OPEN)
    out, understood, relaxed = await search_resolve.resolve(None, {"keyword": ["cafe"], "towns": ["Leeds"]}, None, run)
    assert out["total"] == 3 and "town" in relaxed


async def test_the_chat_tells_the_person_when_the_place_is_outside_their_areas(monkeypatch):
    as_person(monkeypatch, LIMITED)
    t = turn()
    await LA._area_note(None, t, {"towns": ["Leeds"]}, 0)
    assert t.access_notice == DA.OUTSIDE_NOTICE and "plainly" in t.notes[0]
    t2 = turn()
    await LA._area_note(None, t2, {"keyword": ["cafe"]}, 12)  # no place asked for: nothing to say
    assert t2.access_notice == "" and t2.notes == []


# ---- journey tasks -----------------------------------------------------------------------------------
async def test_journey_tasks_for_companies_outside_the_areas_are_not_read_out(monkeypatch):
    from app.services import journey_assistant as JA
    from app.services import journeys as J

    as_person(monkeypatch, LIMITED)
    tasks = [{"title": "Call", "contact": "A", "company": "Hove Co", "journey": "J", "lead_id": "l1"},
             {"title": "Call", "contact": "B", "company": "Leeds Co", "journey": "J", "lead_id": "l2"},
             {"title": "Post", "contact": "C", "company": "Typed Co", "journey": "J", "lead_id": ""}]

    async def listed(db, **kw):
        return tasks

    async def visible(db, ids):
        return [i for i in ids if i == "l1"], 1

    monkeypatch.setattr(J, "list_tasks", listed)
    monkeypatch.setattr(DA, "visible_account_ids", visible)
    t = turn()
    assert await JA.my_data(None, t, "tasks") is True
    said = t.notes[0]
    assert "(A, J)" in said and "(C, J)" in said and "(B, J)" not in said  # the Hove and the typed-in tasks stay; the Leeds one is dropped


# ---- campaign, reply and journey figures ------------------------------------------------------------------
class _Result:
    def all(self):
        return []

    def scalar(self):
        return 0

    def scalars(self):
        return self


class _Recorder:
    def __init__(self):
        self.sql = []

    async def execute(self, stmt):
        self.sql.append(str(stmt.compile(dialect=__import__("sqlalchemy.dialects.postgresql", fromlist=["dialect"]).dialect(), compile_kwargs={"literal_binds": True})))
        return _Result()


async def test_the_area_subquery_is_only_made_for_a_limited_person(monkeypatch):
    as_person(monkeypatch, OPEN)
    assert await LA._in_area_enrollments(None) is None
    as_person(monkeypatch, LIMITED)
    sub = await LA._in_area_enrollments(None)
    text = str(sub.compile(compile_kwargs={"literal_binds": True}))
    assert "lead_accounts" in text and "BN1" in text and "BN2" in text


async def test_reply_figures_are_counted_over_people_in_the_areas_only(monkeypatch):
    as_person(monkeypatch, LIMITED)
    db = _Recorder()
    await LA._replies(db)
    assert db.sql and all("enrollment_id IN" in s for s in db.sql)
    as_person(monkeypatch, OPEN)
    db = _Recorder()
    await LA._replies(db)
    assert db.sql and not any("enrollment_id IN" in s for s in db.sql)


async def test_journey_answers_use_the_area_figures_for_a_limited_person(monkeypatch):
    from app.services import journey_assistant as JA
    from app.services import journeys as J

    row = {"name": "Spring", "status": "running", "tasks_open": 1, "results": {"people": 4, "in_progress": 2, "sent": 6, "replied": 1}}
    whole = {"name": "Spring", "status": "running", "tasks_open": 9, "results": {"people": 99, "in_progress": 50, "sent": 120, "replied": 30}}

    async def limited(db):
        return [row]

    async def everyone(db, org):
        return [whole]

    async def area(db):
        return object() if scope_now["limited"] else None

    scope_now = {"limited": True}
    monkeypatch.setattr(JA, "_limited_journeys", limited)
    monkeypatch.setattr(JA, "_area_ids", area)
    monkeypatch.setattr(J, "list_journeys", everyone)
    t = turn()
    assert await JA.my_data(None, t, "journeys") is True
    assert "4 people" in t.notes[0] and "99" not in t.notes[0]
    scope_now["limited"] = False
    t2 = turn()
    await JA.my_data(None, t2, "journeys")
    assert "99 people" in t2.notes[0]
