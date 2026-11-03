"""What is reported back when companies are not added because they are already saved."""
from types import SimpleNamespace as NS

from app.api import lead_accounts as LA


def _item(name, website="", phone="", email="", contact="", region=""):
    return NS(name=name, website=website, phone=phone, email=email, contact_name=contact, region=region)


def test_each_duplicate_is_listed_with_why_and_which_saved_company_it_matched():
    dups = [(_item("Acme Ltd", "acme.example", "0113 1"), "acc_1", "Same website"), (_item("Bolt", region="Leeds"), "acc_2", "Same name and place")]
    out = LA._duplicate_pairs(dups, [])
    assert [d["original_id"] for d in out] == ["acc_1", "acc_2"]
    assert out[0]["duplicate"] == {"name": "Acme Ltd", "website": "acme.example", "phone": "0113 1", "email": "", "contact": "", "place": ""}
    assert out[1]["why"] == "Same name and place"


def test_only_the_first_300_are_listed_but_the_caller_still_has_the_full_count():
    dups = [(_item(f"Co {i}"), f"acc_{i}", "Same website") for i in range(450)]
    assert len(LA._duplicate_pairs(dups, [])) == 300
    assert len(dups) == 450


def test_missing_fields_become_empty_text_not_none():
    card = LA._card(None, None, None, None, None, None)
    assert all(v == "" for v in card.values())


def test_a_phone_number_is_compared_in_one_form():
    same = ["0113 496 0101", "+44 113 496 0101", "+44 (0)113 496 0101", "0044 113 496 0101", "01134960101"]
    assert len({LA.phone_key(n) for n in same}) == 1


def test_a_number_that_is_too_short_to_mean_anything_never_matches():
    assert LA.phone_key("12345") == "" and LA.phone_key("") == "" and LA.phone_key(None) == ""
