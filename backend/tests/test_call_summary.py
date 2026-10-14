import asyncio

from app.services import call_summary as CS


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


LINES = [
    "AI: Hi, this is Sam from Acme.",
    "Prospect: Hello, can you do pricing for 40 seats?",
    "System: The assistant asked for a person: pricing for 40 seats",
    "Them: We also need it by March.",
]


def test_transcript_lines_are_labelled_whatever_their_shape():
    out = CS.spoken(LINES + [{"who": "them", "text": "ok"}, "", 5])
    assert out[0] == "AI: Hi, this is Sam from Acme."
    assert out[1].startswith("Caller: ")
    assert out[2].startswith("Note: ")
    assert out[-1] == "Caller: ok"


def test_a_long_call_is_read_in_pieces_and_nothing_is_dropped():
    lines = [f"Caller: line {i} " + "x" * 200 for i in range(200)]
    pieces = CS._pieces(lines, size=5000)
    assert len(pieces) > 1
    assert sum(p.count("line ") for p in pieces) == 200


def test_long_call_is_condensed_then_summarised(monkeypatch):
    asked = []

    async def fake(db, system, text, max_tokens):
        asked.append(system)
        return "short"

    monkeypatch.setattr(CS, "_ask", fake)
    lines = [f"Prospect: line {i} " + "x" * 400 for i in range(300)]
    out = run(CS.summarize(None, lines))
    assert out == "short"
    assert asked[-1] == CS.LIVE_PROMPT           # the last request is the real summary
    assert CS.PIECE_PROMPT in asked[:-1]          # earlier ones condensed the pieces


def test_final_summary_uses_its_own_prompt(monkeypatch):
    seen = []

    async def fake(db, system, text, max_tokens):
        seen.append(system)
        return "Outcome: booked"

    monkeypatch.setattr(CS, "_ask", fake)
    assert run(CS.summarize(None, LINES, final=True)) == "Outcome: booked"
    assert seen == [CS.FINAL_PROMPT]


def test_without_an_ai_the_person_still_gets_the_last_turns(monkeypatch):
    async def fake(db, system, text, max_tokens):
        return ""

    monkeypatch.setattr(CS, "_ask", fake)
    out = run(CS.summarize(None, LINES))
    assert "unavailable" in out and "40 seats" in out


def test_nothing_is_summarised_when_nobody_spoke():
    assert run(CS.summarize(None, ["System: Call ended."])) == ""
    assert run(CS.summarize(None, ["AI: Hello?"])) == ""


def test_the_assistant_is_told_the_story_when_it_carries_on():
    text = CS.restart_context("Wants 40 seats by March.", LINES)
    assert "Wants 40 seats by March." in text and "do not repeat" in text
    assert "40 seats" in CS.restart_context("", LINES)   # no summary: the last turns instead
    assert CS.restart_context("", []) == ""
