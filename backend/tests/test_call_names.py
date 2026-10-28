import pytest

from app.services.call_names import name_from_transcript, name_stated_by_caller, resolve_call_people


def lines(*pairs):
    return [{"who": w, "text": t} for w, t in pairs]


@pytest.mark.parametrize("said,want", [
    ("My name is Priya Shah", "Priya Shah"),
    ("This is Tom from the garage", "Tom"),
    ("Hi, it's Raj", "Raj"),
    ("I'm Dana, calling about the invoice", "Dana"),
    ("Call me Sam", "Sam"),
    ("Yes, you're speaking to Lee", "Lee"),
    ("Mehta speaking", "Mehta"),
    ("This is regarding my order", ""),          # lower-case words are not a name
    ("I'm calling about a quote", ""),
    ("It's Tuesday, I know", ""),                # a day is not a name
    ("It's Sarah's number", "Sarah"),            # "'s" is dropped
    ("Mr Patel here", "Patel"),
])
def test_name_stated_by_caller(said, want):
    assert name_stated_by_caller(lines(("them", said))) == want


def test_only_the_callers_own_lines_count():
    t = lines(("ai", "Hello, this is Sam from Acme. My name is Sam."), ("them", "Who? Sorry, wrong number."))
    assert name_stated_by_caller(t) == ""


def test_string_transcripts_with_prefixes():
    t = ["AI: Hi there, who am I speaking with?", "Prospect: It's Jitendra Rao.", "AI: Thanks Jitendra."]
    assert name_stated_by_caller(t) == "Jitendra Rao"


def test_the_ai_greeting_is_only_a_fallback():
    # nothing stated by the caller: the name the AI greeted with is used
    assert name_from_transcript(lines(("ai", "Hi Howard, it's Sam from Acme."), ("them", "Yes?"))) == "Howard"
    # the caller gave a different name: that wins over what the AI assumed
    t = lines(("ai", "Hi Howard, it's Sam."), ("them", "No, this is Mary."))
    assert name_from_transcript(t) == "Mary"


def test_stated_name_beats_a_stored_guess_and_the_dialled_label():
    t = lines(("them", "Hello, my name is Ayesha Khan"))
    out = resolve_call_people(live_label="Acme Ltd", transcript=t, existing_person="Howard")
    assert out["person"] == "Ayesha Khan"
    assert out["company"] == "Acme Ltd"  # the dialled name stays on as the company


def test_nothing_said_keeps_the_dialled_name():
    out = resolve_call_people(live_label="Jo Bloggs", transcript=lines(("them", "Hello?")))
    assert out["person"] == "Jo Bloggs"
