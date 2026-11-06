import pytest

from app.services import uk_phone
from app.services.company_check import phone_shape
from app.services.lead_cleaner import check_row
from app.services import number_check as NC


@pytest.mark.parametrize("raw", [
    "020 7946 0999", "0113 496 0123", "0113 496 0456", "+44 20 7946 0000", "07700 900123",
    "028 9649 6123", "029 2018 0555", "01632 960123", "0191 498 0999", "0161 496 0001",
    "08081 570123", "0909 879 0123", "03069 990123", "00442079460999",
])
def test_drama_ranges_are_fictional(raw):
    assert uk_phone.fictional(raw)


@pytest.mark.parametrize("raw", [
    "020 7946 1000", "020 7123 4567", "0113 496 1000", "0113 550 2750", "07700 901000",
    "0117 973 1163", "+1 212 555 0123", "", "abc",
])
def test_real_numbers_are_not_fictional(raw):
    assert not uk_phone.fictional(raw)


def test_fictional_numbers_fail_every_free_check():
    assert phone_shape("020 7946 0999") == "invalid"
    assert "PHONE_FICTIONAL" in check_row({"name": "A Ltd", "phone": "0113 496 0123"})["hard"]
    row = NC.prepare([{"key": "a", "phone": "+442079460999"}], set())[0]
    assert row["status"] == "fictional"
