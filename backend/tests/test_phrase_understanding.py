"""Find Leads understands what is typed: 'dentist' also finds dental practices, the same words always give the same answer."""
from datetime import date

import httpx
import pytest

from app.main import app
from app.models.models import AppSetting, BusinessRecord
from app.services import llm_gateway
from app.services import phrase_understanding as PU
from tests.conftest import make_user


def test_only_plain_short_words_come_through():
    got = PU.clean_terms(["Dental", "dental practice", "dental", "services", "business", "x", "'; DROP TABLE a;--", "a%b",
                          "orthodontic", "z" * 80, 5, None, "dentist"], phrase="dentist")
    assert got == ["dental", "dental practice", "orthodontic"]  # no duplicates, no generic words, nothing that is not a plain word
    assert PU.clean_terms("not a list") == []
    assert len(PU.clean_terms([f"word{i}" for i in range(30)])) == PU.MAX_TERMS


@pytest.fixture
def ai(monkeypatch):
    """A stand-in for the AI: counts questions, answers from a table, can be switched off."""
    state = {"asked": [], "up": True, "answers": {"dentist": ["dental", "dental practice", "orthodontic"], "pub": ["public house", "licensed premises"]}}

    async def extract(*, system_prompt, user_text, schema, **kw):
        phrase = user_text.split("Phrase: ")[1]
        state["asked"].append(phrase)
        if not state["up"]:
            return None
        return {"terms": state["answers"].get(phrase, [])}

    monkeypatch.setattr(llm_gateway, "extract_structured", extract)
    return state


@pytest.mark.db
async def test_a_phrase_is_asked_once_and_remembered(db, ai):
    assert await PU.terms_for(db, "Dentist") == ["dental", "dental practice", "orthodontic"]
    assert await PU.terms_for(db, "  dentist ") == ["dental", "dental practice", "orthodontic"]
    assert ai["asked"] == ["dentist"]  # the second time came from memory: same words, same results, no cost
    assert await PU.terms_for(db, "xx") == []  # too short to mean anything


@pytest.mark.db
async def test_when_the_ai_is_down_nothing_is_remembered_and_the_search_uses_the_typed_words(db, ai):
    ai["up"] = False
    assert await PU.terms_for(db, "dentist") == []
    wide, reading = await PU.apply(db, {"keyword": ["dentist"]})
    assert wide["keyword"] == ["dentist"] and reading == []
    ai["up"] = True
    assert await PU.terms_for(db, "dentist") == ["dental", "dental practice", "orthodontic"]  # tried again, now it works


@pytest.mark.db
async def test_staff_can_correct_a_phrase_and_the_correction_stands(db, ai):
    await PU.terms_for(db, "dentist")
    row = await db.get(AppSetting, PU._phrase_key("dentist"))
    row.data = {**row.data, "terms": ["dental surgery"], "edited": True}
    await db.commit()
    assert await PU.terms_for(db, "dentist") == ["dental surgery"]
    assert ai["asked"] == ["dentist"]


@pytest.mark.db
async def test_words_are_widened_and_a_removed_word_stays_removed(db, ai):
    wide, reading = await PU.apply(db, {"keyword": ["dentist", "pub"], "towns": ["Leeds"]})
    assert wide["keyword"] == ["dentist", "dental", "dental practice", "orthodontic", "pub", "public house", "licensed premises"]
    assert wide["towns"] == ["Leeds"] and [r["phrase"] for r in reading] == ["dentist", "pub"]
    wide, reading = await PU.apply(db, {"keyword": ["dentist"]}, drop_terms=["Orthodontic"])
    assert wide["keyword"] == ["dentist", "dental", "dental practice"]
    assert (await PU.apply(db, {"towns": ["Leeds"]}))[1] == []  # nothing typed, nothing to widen


def _client(token):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"Authorization": f"Bearer {token}"})


async def _seed(db):
    db.add_all([
        BusinessRecord(id="biz_1", identity_hash="h1", name="Smile Co", sic_text="86230 - Dental practice activities", industry="Dental practice activities",
                       status="Active", region="LEEDS", incorporated_on=date(2020, 1, 1), confidence_tier="verified_registry"),
        BusinessRecord(id="biz_2", identity_hash="h2", name="Corner Cafe", sic_text="56102 - Unlicensed restaurants and cafes", industry="Unlicensed restaurants and cafes",
                       status="Active", region="LEEDS", incorporated_on=date(2019, 1, 1), confidence_tier="verified_registry"),
    ])
    await db.commit()


@pytest.mark.db
async def test_the_search_finds_the_nearest_matches_and_shows_what_was_typed(db, ai):
    await _seed(db)
    _, token = await make_user(db, "finder", "Admin")
    async with _client(token) as c:
        r = await c.post("/api/leads/search", json={"filters": {"keyword": ["dentist"]}})
        assert r.status_code == 200, r.text
        body = r.json()
        assert [x["name"] for x in body["companies"]] == ["Smile Co"]  # 'dentist' appears nowhere in the data; 'dental' does
        assert body["filters"]["keyword"] == ["dentist"]  # the box keeps showing what the user typed
        assert body["understood"] == [{"phrase": "dentist", "terms": ["dental", "dental practice", "orthodontic"]}]
        # the user removes the reading: nothing else matches the typed word
        r = await c.post("/api/leads/search", json={"filters": {"keyword": ["dentist"]}, "drop_terms": ["dental", "dental practice", "orthodontic"]})
        assert r.json()["companies"] == [] and r.json()["understood"] == []
        # a word that needs no help still works
        r = await c.post("/api/leads/search", json={"filters": {"keyword": ["cafe"]}})
        assert [x["name"] for x in r.json()["companies"]] == ["Corner Cafe"]


@pytest.mark.db
async def test_the_search_still_works_when_the_ai_is_down(db, ai):
    await _seed(db)
    ai["up"] = False
    _, token = await make_user(db, "finder2", "Admin")
    async with _client(token) as c:
        r = await c.post("/api/leads/search", json={"filters": {"keyword": ["dental"]}})
        assert r.status_code == 200 and [x["name"] for x in r.json()["companies"]] == ["Smile Co"] and r.json()["understood"] == []


@pytest.mark.db
async def test_a_slow_ai_never_holds_the_search_up(db, ai, monkeypatch):
    import asyncio
    import time

    async def slow(**kw):
        await asyncio.sleep(30)
        return {"terms": ["never"]}

    monkeypatch.setattr(llm_gateway, "extract_structured", slow)
    monkeypatch.setattr(PU, "ASK_SECONDS", 1.0)
    started = time.monotonic()
    wide, reading = await PU.apply(db, {"keyword": ["cafe", "restaurant"]})
    assert time.monotonic() - started < 3  # two slow words together waited about a second, not 2 x 45
    assert wide["keyword"] == ["cafe", "restaurant"] and reading == []  # the typed words are searched as they are
    assert await PU._stored(db, "cafe") is None  # nothing is remembered from a non-answer


@pytest.mark.db
async def test_the_ai_is_only_asked_when_the_typed_words_find_nothing(db, ai):
    await _seed(db)
    _, token = await make_user(db, "finder3", "Admin")
    async with _client(token) as c:
        # "cafe" is found as typed: no AI question at all, and nothing is shown as "also looking for"
        r = await c.post("/api/leads/search", json={"filters": {"keyword": ["cafe"]}})
        assert [x["name"] for x in r.json()["companies"]] == ["Corner Cafe"] and r.json()["understood"] == []
        assert ai["asked"] == []
        # "dentist" is not in the data as typed: now the AI is asked, once
        r = await c.post("/api/leads/search", json={"filters": {"keyword": ["dentist"]}})
        assert [x["name"] for x in r.json()["companies"]] == ["Smile Co"] and ai["asked"] == ["dentist"]
        # an area count follows the same rule: the seeded companies have no postcodes, so nothing is counted for
        # "cafe" as typed and only then is the AI asked (it knows no nearby words for it, so nothing is widened)
        area = [[53.78, -1.58], [53.78, -1.52], [53.82, -1.52], [53.82, -1.58]]
        r = await c.post("/api/leads/search/area-count", json={"filters": {"keyword": ["cafe"]}, "area": area})
        assert r.status_code == 200 and r.json()["widened"] is False and ai["asked"] == ["dentist", "cafe"]
