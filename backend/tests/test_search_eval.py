"""The company-test script's judging and its threshold sweep (no searching)."""
from scripts import search_eval as E

TEDDY = {"name": "Teddy Bears Pre-School", "case": "normal", "expected_website": "teddybears-preschool.co.uk", "expected_phone": "01462 123456", "expected_email": ""}


def test_right_wrong_missed_and_not_checked_are_told_apart():
    assert E.judge(TEDDY, {"website": "https://www.teddybears-preschool.co.uk", "phone": "+44 1462 123456", "email": ""}) == \
        {"website": "right", "phone": "right", "email": "not_checked"}
    assert E.judge(TEDDY, {"website": "https://other.co.uk", "phone": ""})["website"] == "wrong"
    assert E.judge(TEDDY, {})["website"] == "missed"


def test_a_closed_company_or_one_with_no_website_must_show_nothing():
    closed = {"name": "X", "case": "closed"}
    assert E.judge(closed, {"website": "https://x.co.uk"})["website"] == "false_shown" and E.judge(closed, {})["website"] == "correct_nothing"
    nosite = {"name": "Y", "case": "no_website"}
    assert E.judge(nosite, {"phone": "01462 123456"})["phone"] == "false_shown"


def _row(case, website_score, rival=None):
    audit = [{"field": "website", "value": "https://teddybears-preschool.co.uk", "score": website_score, "rejected": ""}]
    if rival:
        audit.append({"field": "website", "value": "https://other.co.uk", "score": rival, "rejected": ""})
    return {"case": case, "shown": {}, "audit": audit, "ledger": {"outcome": "found", "tavily_credits": 3, "extract_pages": 2}}


def test_the_threshold_and_margin_decide_what_would_have_been_shown():
    row = _row(TEDDY, 74)
    assert E.redecide(row["audit"], 70, 15)["website"].endswith("teddybears-preschool.co.uk")
    assert E.redecide(row["audit"], 80, 15)["website"] == ""                         # under the threshold
    close = _row(TEDDY, 90, rival=80)
    assert E.redecide(close["audit"], 70, 15)["website"] == ""                       # the two are too close
    assert E.redecide(close["audit"], 70, 10)["website"] != ""


def test_the_sweep_puts_no_wrong_answers_first_then_the_best_hit_rate():
    wrong_case = {"name": "Z", "case": "normal", "expected_website": "z.co.uk"}
    rows = [_row(TEDDY, 74), {"case": wrong_case, "shown": {}, "ledger": {"outcome": "found"},
                              "audit": [{"field": "website", "value": "https://notz.co.uk", "score": 72, "rejected": ""}]}]
    best = E.sweep(rows)[0]
    assert best[2] == 0                       # a threshold above 72 shows no wrong answer
    assert best[0] > 72                       # and the lowest such threshold comes first
    at_70 = E.summarise(rows, 70, 15)["website"]
    assert at_70["right"] == 1 and at_70["wrong"] == 1 and E.hit_rate(at_70) == 0.5


def test_the_report_names_wrong_answers_and_gives_the_credit_figures():
    wrong_case = {"name": "Z", "case": "normal", "expected_website": "z.co.uk"}
    rows = [_row(TEDDY, 74), {"case": wrong_case, "shown": {"website": "x"}, "ledger": {"outcome": "found", "tavily_credits": 4, "extract_pages": 0},
                              "audit": [{"field": "website", "value": "https://notz.co.uk", "score": 72, "rejected": ""}]}]
    text = E.report(rows, 70, 15, 0.008, 0.035)
    assert "Z [normal] website" in text and "credits per outcome" in text and "cost per lookup" in text and "sweep" in text
