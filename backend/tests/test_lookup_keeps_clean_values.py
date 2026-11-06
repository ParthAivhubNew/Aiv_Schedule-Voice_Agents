"""N9: opening a company or looking up its website must not replace clean register values with raw codes."""
import pytest

from app.services import business_records as BR

pytestmark = pytest.mark.db


async def test_a_live_lookup_never_rawifies_a_clean_record(db):
    clean = {"name": "GROWTH ACCOUNTANTS LTD", "registration_number": "01234567", "company_category": "Private Limited Company",
             "industry": "69201 - Accounting and auditing activities", "status": "Active", "postcode": "LS1 4AP"}
    first = await BR.upsert(db, source_id="bulk", source_type="file", confidence_tier="verified_registry", data=clean)
    again = await BR.upsert(db, source_id="live", source_type="api", confidence_tier="verified_registry",
                            data={**clean, "company_category": "ltd", "industry": "69201", "sic_text": "69201", "status": "active"})
    assert again.id == first.id
    assert again.company_category == "Private Limited Company"
    assert again.industry == "69201 - Accounting and auditing activities"
    assert again.sic_text == "69201 - Accounting and auditing activities"
    assert again.status == "Active"


async def test_a_new_record_from_a_code_gets_the_label(db):
    row = await BR.upsert(db, source_id="live", source_type="api", confidence_tier="verified_registry",
                          data={"name": "NEW CO LTD", "registration_number": "07654321", "company_category": "ltd", "status": "active"})
    assert row.company_category == "Private Limited Company" and row.status == "Active"
