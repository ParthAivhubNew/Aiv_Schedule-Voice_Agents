"""The rules that connect Lead Gen, Voice and Social: which links a plan allows, how a call moves a lead,
what the other person's words mean. No database needed."""
from datetime import datetime, timedelta
from types import SimpleNamespace

from app.services import connection_handlers as H
from app.services import connections as C
from app.services import lead_calls as LC


def test_links_follow_the_plugins_owned_and_say_what_is_missing():
    leads_only = {"leads": True, "voice": False, "social": False}
    ok, why, missing = C.can_use(leads_only, "call_leads")
    assert not ok and missing == ["voice"] and "Voice" in why
    assert C.can_use({"leads": True, "voice": True, "social": False}, "call_leads")[0]
    # the calendar is part of Voice: booking in emails needs Voice, not a fourth plugin
    assert not C.can_use(leads_only, "booking_in_email")[0]
    ok, _, missing = C.can_use({"leads": False, "voice": False, "social": True}, "comment_to_call")
    assert not ok and missing == ["leads", "voice"]
    assert C.can_use({"social": True}, "pipeline")[0] and not C.can_use({}, "pipeline")[0]
    assert C.can_use({}, "nope")[0] is False


def test_rules_keep_only_known_switches_with_the_right_type():
    out = C.clean_rules({"recontact_days": "30", "stop_on_booking": 0, "interested_template": "Hi", "evil": 1, "no_answer_after": "x"})
    assert out == {"recontact_days": 30, "stop_on_booking": False, "interested_template": "Hi"}
    assert C.clean_rules({"recontact_days": 9999})["recontact_days"] == 365


def test_a_call_moves_the_stage_forward_only():
    assert C.stage_for_outcome("new", "no_answer") == "contacted"
    assert C.stage_for_outcome("interested", "no_answer") == "interested"
    assert C.stage_for_outcome("contacted", "meeting_booked") == "meeting"
    assert C.stage_for_outcome("meeting", "rejected") == "meeting"      # a booked meeting is not undone by one rejection
    assert C.stage_for_outcome("contacted", "rejected") == "lost"
    assert C.stage_for_outcome("won", "no_answer") == "won"
    assert C.stage_for_outcome("new", "failed") == "new"                # the call never connected
    assert C.stage_for_outcome("new", "wrong_number") == "new"
    assert C.stage_for_outcome("interested", "do_not_call") == "do_not_contact"


def _t(*lines):
    return [{"who": "them", "text": t} for t in lines] + [{"who": "ai", "text": "Hello"}]


def test_signals_come_only_from_what_they_said():
    assert C.detect_signals(_t("Sorry, wrong number."))["wrong_number"]
    assert C.detect_signals(_t("Please take me off your list"))["do_not_call"]
    sig = C.detect_signals(_t("Send it to jane.doe@acme.co.uk please", "The best time is Tuesday mornings"))
    assert sig["email"] == "jane.doe@acme.co.uk" and "Tuesday" in sig["best_time"]
    assert not C.detect_signals([{"who": "ai", "text": "Is this the wrong number?"}])["wrong_number"]  # the AI's words do not count
    assert C.detect_signals(_t("Speak to Sarah Jones"))["contact_name"] == "Sarah Jones"
    assert C.detect_signals(_t("noreply@acme.com"))  .get("email") is None


def test_the_clearest_signal_wins_over_the_logged_outcome():
    assert C.effective_outcome("contacted", {"do_not_call": True, "wrong_number": True}) == "do_not_call"
    assert C.effective_outcome("contacted", {"wrong_number": True}) == "wrong_number"
    assert C.effective_outcome("no_answer", {}) == "no_answer"


def test_recently_reached_uses_the_gap_and_can_be_switched_off():
    lead = SimpleNamespace(last_contact_at=datetime.utcnow() - timedelta(days=3), last_called_at=None)
    assert C.recently_reached(lead, 14) and not C.recently_reached(lead, 2) and not C.recently_reached(lead, 0)
    assert not C.recently_reached(SimpleNamespace(last_contact_at=None, last_called_at=None), 14)


def test_callbacks_become_a_real_time():
    when = H.parse_follow_up("Thursday", "3pm")
    assert when and when.weekday() == 3 and when.hour == 15
    assert H.parse_follow_up("tomorrow", "09:30").hour == 9
    assert H.parse_follow_up("whenever", "3pm") is None


def test_templates_fill_names_and_leave_no_gaps():
    lead = SimpleNamespace(contact_name="Maria Lopez", name="Kirkgate Dental", email="m@k.example")
    assert H.fill("Hi {{first_name}}, about {{company}} .", lead) == "Hi Maria, about Kirkgate Dental."
    assert H.fill("Hi {{first_name}}", SimpleNamespace(contact_name="", name="X", email="")) == "Hi "


def test_opening_line_uses_research_and_is_empty_without_it():
    lead = SimpleNamespace(name="Kirkgate Dental", research={"overview": "Family dental practice in Leeds since 1998. Offers implants."})
    assert LC.opening_line(lead).startswith("I read that Kirkgate Dental family dental practice in Leeds")
    assert LC.opening_line(SimpleNamespace(name="X", research=None)) == ""
