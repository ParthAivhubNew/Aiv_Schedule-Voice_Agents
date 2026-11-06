import pytest

from app.services import normalise as N


@pytest.mark.parametrize("raw,out", [
    ("8233371", "08233371"), ("08233371", "08233371"), ("sc123456", "SC123456"), ("SC 12345", "SC012345"),
    ("OC301234", "OC301234"), ("12345678", "12345678"), ("abc", ""), ("", ""), ("123456789", ""),
])
def test_company_number(raw, out):
    assert N.company_number(raw) == out


@pytest.mark.parametrize("raw,out", [
    ("ls11 6jx", "LS11 6JX"), ("LS116JX", "LS11 6JX"), ("  m1  1ae ", "M1 1AE"), ("DN11", "DN11"), ("hello", ""), ("", ""),
])
def test_postcode(raw, out):
    assert N.postcode(raw) == out


def test_outward_only():
    assert N.is_outward_only("dn11") and not N.is_outward_only("DN11 8AA")


@pytest.mark.parametrize("raw,out", [
    ("JAMES BROWN", "James Brown"), ("james brown", "James Brown"), ("Ann McDonald", "Ann McDonald"),
    ("MARY-JANE O'NEIL", "Mary-Jane O'Neil"), ("JOHN MCDONALD", "John McDonald"), ("", ""),
])
def test_person_name(raw, out):
    assert N.person_name(raw) == out


@pytest.mark.parametrize("raw,out", [
    ("+44 113 550 2750", "0113 550 2750"), ("01135502750", "0113 550 2750"), ("020 7123 4567", "020 7123 4567"),
    ("07911123456", "07911 123456"), ("", ""),
])
def test_phone_display(raw, out):
    assert N.phone_display(raw) == out


def test_category_and_corporate():
    assert N.category_label("ltd") == "Private Limited Company"
    assert N.category_label("Private Limited Company") == "Private Limited Company"
    assert N.is_raw_category("ltd") and not N.is_raw_category("Private Limited Company")
    assert N.is_corporate("Private Limited Company") and N.is_corporate("llp") and not N.is_corporate("Sole trader")
    assert N.sic_is_bare("69201") and not N.sic_is_bare("69201 - Accounting")
