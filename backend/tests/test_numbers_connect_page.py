"""The partner popup for buying a number: the finish page, the verification form and the form-to-submission mapping."""
import asyncio
from unittest.mock import AsyncMock, patch

from app.public_api import numbers_page as P


def test_done_page_tells_the_opener_and_returns_with_the_number():
    page = P.done("https://tenderflow.example/calls?x=1", "num_abc")
    assert "outreach.number" in page
    assert "https://tenderflow.example/calls?x=1&status=connected&provider=number&number_id=num_abc" in page
    assert '"https://tenderflow.example"' in page


def test_verification_form_has_a_field_per_requirement_kind():
    html = P._fields_form([
        {"id": "r-doc", "name": "Company certificate", "type": "document", "description": ""},
        {"id": "r-addr", "name": "Business address", "type": "address", "description": ""},
        {"id": "r-txt", "name": "Company number", "type": "textual", "description": "As on the register"},
    ])
    assert "name='doc_r-doc'" in html
    assert "name='addr_r-addr__street_address'" in html
    assert "name='txt_r-txt'" in html
    assert "As on the register" in html


def test_verify_form_is_sent_as_texts_addresses_and_files():
    form = {"action": "verify", "country": "GB", "number_type": "local", "entity_type": "company", "txt_r-txt": "12345678",
            "addr_r-addr__street_address": "1 High St", "addr_r-addr__postal_code": "AB1 2CD"}
    files = {"r-doc": ("cert.pdf", b"%PDF", "application/pdf")}
    with patch("app.api.telnyx_numbers.submit_documents", new=AsyncMock(return_value={"status": "pending"})) as sent:
        out = asyncio.run(P.act(None, {"o": "org_x"}, form, files))
    assert out["notice"].startswith("Sent")
    args = sent.await_args.args
    assert args[1]["org_id"] == "org_x"
    assert args[5] == {"r-txt": "12345678"}
    assert args[6] == {"r-addr": {"street_address": "1 High St", "postal_code": "AB1 2CD"}}
    assert args[7] == files


def test_done_action_finishes_with_the_number_id():
    out = asyncio.run(P.act(None, {"o": "org_x"}, {"action": "done", "number_id": "num_1"}, {}))
    assert out == {"finished": "num_1"}


def test_buying_without_verification_opens_the_documents_form():
    from fastapi import HTTPException

    err = HTTPException(status_code=409, detail={"message": "Numbers in this country need your business verified first.", "code": "verification_required"})
    with patch("app.api.telnyx_numbers.order", new=AsyncMock(side_effect=err)):
        out = asyncio.run(P.act(AsyncMock(), {"o": "org_x"}, {"action": "buy", "phone_number": "+442030001001", "country": "GB", "number_type": "local"}, {}))
    assert out["query"]["verify"] == "1"
    assert "verified first" in out["error"]


def test_who_names_the_person_or_the_key():
    from app.api.telnyx_numbers import _who

    assert _who({"type": "api_key", "name": "TenderFlow"}) == "TenderFlow (API key)"
    assert _who({"name": "Asha", "email": "a@x.com"}) == "Asha (app)"
