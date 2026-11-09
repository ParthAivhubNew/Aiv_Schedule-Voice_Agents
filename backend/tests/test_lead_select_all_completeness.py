"""Select all across pages (the cap and the slim rows), and how a saved company is filled from its register record and scored."""
from app.api.lead_accounts import (COMPLETENESS_FIELDS, SELECT_ALL_CAP, AccountIn, completeness, fill_blanks, held_values,
                                   select_all_limit, slim_card)
from app.services import reveals as RV


def test_select_all_never_resolves_more_than_the_cap():
    assert select_all_limit(50) == 50
    assert select_all_limit(10 ** 6) == SELECT_ALL_CAP
    assert select_all_limit(0) == 1
    assert select_all_limit("not a number") == SELECT_ALL_CAP


def test_a_slim_row_keeps_only_what_a_bulk_action_needs():
    row = slim_card({"id": "b1", "name": "Acme Ltd", "phone": "", "officers": [{"name": "A"}], "raw_data": {"x": 1}})
    assert row["id"] == "b1" and row["name"] == "Acme Ltd" and row["phone"] == ""
    assert "officers" not in row and "raw_data" not in row


def _card(**over):
    base = {"id": "b1", "name": "Acme Ltd", "website": "https://acme.co.uk", "phone": "0113 496 0101", "email": "info@acme.co.uk",
            "industry": "Plumbing", "region": "Leeds", "postcode": "LS1 4AP", "address": "1 Main St", "registration_number": "01234567",
            "web_website": "", "web_phone": "", "web_email": "", "confirmed_phone": "", "confirmed_website": ""}
    return {**base, **over}


def test_contacts_the_register_holds_stay_masked_until_opened():
    held = held_values(RV.mask_card(_card(), set()))
    assert "website" not in held and "phone" not in held and "email" not in held
    assert held["industry"] == "Plumbing" and held["address"] == "1 Main St" and held["registration_number"] == "01234567"
    opened = held_values(RV.mask_card(_card(), {("b1", "phone")}))
    assert opened["phone"] == "0113 496 0101" and "email" not in opened


def test_a_paid_find_is_used_when_the_register_has_none():
    held = held_values(RV.mask_card(_card(website="", phone="", web_website="https://acme.example", web_phone="0113 000 0000"), set()))
    assert held["website"] == "https://acme.example" and held["phone"] == "0113 000 0000"


def test_saving_fills_only_blanks_and_what_was_sent_wins():
    item = AccountIn(name="Acme Ltd", industry="Heating", business_record_id="b1")
    filled = fill_blanks(item, {"industry": "Plumbing", "region": "Leeds", "postcode": "LS1 4AP"})
    assert item.industry == "Heating" and item.region == "Leeds" and item.postcode == "LS1 4AP"
    assert sorted(filled) == ["postcode", "region"]


def test_completeness_counts_each_key_field_once_and_names_the_missing():
    empty = completeness({})
    assert empty["pct"] == 0 and len(empty["missing"]) == len(COMPLETENESS_FIELDS)
    some = completeness({"website": "x", "phone": "y", "people": True, "size": False})
    assert some["pct"] == round(100 * 3 / len(COMPLETENESS_FIELDS))
    assert "Size" in some["missing"] and "Website" in some["have"]
    full = completeness({k: True for k, _ in COMPLETENESS_FIELDS})
    assert full["pct"] == 100 and full["missing"] == []
