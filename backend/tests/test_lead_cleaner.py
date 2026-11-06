"""Import checks: bad rows are quarantined with a reason, good rows pass, warnings keep the row."""
import pytest

from app.services import lead_cleaner as LC


def row(**kw):
    base = {"name": "Acme Ltd", "email": "ann@acme.co.uk", "phone": "0113 550 0102", "website": "acme.co.uk", "contact_name": "Ann Lee"}
    base.update(kw)
    return base


def test_a_good_row_is_clean():
    assert LC.check_row(row()) == {"hard": [], "warn": []}


@pytest.mark.parametrize("change,code", [
    ({"name": "test"}, "NAME_INVALID"), ({"name": "!!!"}, "NAME_INVALID"),
    ({"email": "not-an-email"}, "EMAIL_SYNTAX"), ({"email": "a@example.com"}, "EMAIL_FAKE"), ({"email": "x@mailinator.com"}, "EMAIL_DISPOSABLE"),
    ({"website": "https://ratings.food.gov.uk/business/1"}, "WEB_DIRECTORY"), ({"website": "facebook.com/acme"}, "WEB_DIRECTORY"), ({"website": "not a site"}, "WEB_INVALID"),
    ({"phone": "123"}, "PHONE_INVALID"), ({"phone": "07777777777"}, "PHONE_FAKE"), ({"phone": "09061234567"}, "PHONE_PREMIUM"),
    ({"contact_name": "Ann2"}, "PERSON_INVALID"), ({"contact_name": "a@b"}, "PERSON_INVALID"),
    ({"name": "=HYPERLINK(\"http://x\")"}, "FORMULA_INJECTION"), ({"notes": "@SUM(A1)"}, "FORMULA_INJECTION"),
    ({"custom": {"Postcode": "ZZ99"}}, "POSTCODE_INVALID"),
])
def test_bad_values_are_quarantined_with_a_code(change, code):
    assert code in LC.check_row(row(**change))["hard"]


def test_a_name_only_row_is_kept_with_a_warning():
    v = LC.check_row({"name": "Acme Ltd"})
    assert v["hard"] == [] and "NO_IDENTIFIER" in v["warn"]


def test_a_leading_plus_on_a_phone_is_not_a_formula():
    assert "FORMULA_INJECTION" not in LC.check_row(row(phone="+44 113 550 0102"))["hard"]


def test_warnings_keep_the_row():
    v = LC.check_row(row(email="info@acme.co.uk", phone="07911 123456", name="Joe Bloggs Plumbing"))
    assert v["hard"] == [] and {"EMAIL_ROLE", "PHONE_MOBILE", "GDPR_INDIVIDUAL"} <= set(v["warn"])
    assert "EMAIL_PERSONAL" in LC.check_row(row(email="ann@gmail.com"))["warn"]


def test_reasons_are_in_plain_words():
    assert LC.explain(["EMAIL_FAKE", "PHONE_MOBILE"]) == ["The email address is an example or test address.", "A mobile number."]
