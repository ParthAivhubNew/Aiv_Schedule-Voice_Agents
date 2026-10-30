"""The people on a company: what an officer or owner shows, who left recently, what an owner controls, and when officers are read again."""
from datetime import datetime, timedelta
from types import SimpleNamespace

from app.services import company_contacts as CC


def _day(days_ago: int) -> str:
    return (datetime.utcnow() - timedelta(days=days_ago)).strftime("%Y-%m-%d")


def test_an_officer_keeps_what_the_register_publishes_about_them():
    saved = [{"name": "MURPHY, Ken", "role": "director", "appointed_on": "2019-03-01", "nationality": "Irish", "occupation": "Company Director",
              "country_of_residence": "England", "born_year": "1968", "appointments_link": "/officers/AbC123/appointments", "v": 2}]
    [o] = CC.active_officers(saved)
    assert (o["nationality"], o["occupation"], o["country_of_residence"], o["born_year"]) == ("Irish", "Company Director", "England", "1968")
    assert o["officer_id"] == "AbC123" and o["years_in_role"] == datetime.utcnow().year - 2019
    assert o["first_name"] == "Ken" and o["last_name"] == "Murphy"


def test_an_officer_saved_before_these_fields_still_shows_with_blanks():
    [o] = CC.active_officers([{"name": "SMITH, Ann", "role": "secretary", "appointed_on": ""}])
    assert o["nationality"] == "" and o["years_in_role"] is None and o["officer_id"] == ""


def test_resigned_officers_are_not_listed_but_last_years_leavers_are_reported():
    saved = [{"name": "A, Old", "role": "director", "resigned_on": _day(40)},
             {"name": "B, Older", "role": "director", "resigned_on": _day(900)},
             {"name": "C, Current", "role": "director"},
             {"name": "D, Auditor", "role": "judicial-factor", "resigned_on": _day(10)}]
    assert [o["name"] for o in CC.active_officers(saved)] == ["C, Current"]
    assert [o["name"] for o in CC.recent_leavers(saved)] == ["A, Old"]


def test_what_an_owner_controls_is_put_in_plain_words():
    assert CC._nature_words("ownership-of-shares-25-to-50-percent") == "Owns 25 to 50% of the shares"
    assert CC._nature_words("ownership-of-shares-75-to-100-percent-as-trust") == "Owns 75 to 100% of the shares (through a trust)"
    assert CC._nature_words("voting-rights-more-than-25-percent-as-firm") == "Holds more than 25% of the votes (through a firm)"
    assert CC._nature_words("right-to-appoint-and-remove-directors") == "Right to appoint and remove directors"


def test_only_owners_still_in_control_are_listed():
    psc = [{"name": "Jo Bloggs", "kind": "individual-person-with-significant-control", "nature_of_control": "ownership-of-shares-50-to-75-percent, right-to-appoint-and-remove-directors",
            "notified_on": "2020-01-05", "nationality": "British"},
           {"name": "Gone Ltd", "kind": "corporate-entity-person-with-significant-control", "ceased_on": "2022-02-02"}]
    [c] = CC.controllers(psc)
    assert c["name"] == "Jo Bloggs" and c["controls"] == ["Owns 50 to 75% of the shares", "Right to appoint and remove directors"]
    assert c["since"] == "2020-01-05" and c["nationality"] == "British"


def test_officers_are_read_again_only_when_missing_or_saved_before_the_new_fields():
    assert CC.people_stale(SimpleNamespace(officers=None)) and CC.people_stale(SimpleNamespace(officers=[]))
    assert CC.people_stale(SimpleNamespace(officers=[{"name": "X", "role": "director"}]))
    assert not CC.people_stale(SimpleNamespace(officers=[{"name": "X", "role": "director", "v": CC.PEOPLE_V}]))
