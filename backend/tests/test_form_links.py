"""Personal form links in emails: the signed token, the merge tag, and what a form answer may add to a company record."""
from app.services import form_links as FL
from app.services import inbound_forms as IF
from app.services import journeys as J


def test_a_token_round_trips():
    tok = FL.read_token(FL.make_token("org_a", "frm_1", "acc_1", "enr_1", "Ann@Acme.co.uk", now=1_000_000), now=1_000_001)
    assert tok == {"org_id": "org_a", "form_id": "frm_1", "lead_id": "acc_1", "enrollment_id": "enr_1", "email": "ann@acme.co.uk"}


def test_a_changed_token_is_refused():
    token = FL.make_token("org_a", "frm_1", "acc_1", "enr_1", "ann@acme.co.uk", now=1_000_000)
    body, mac = token.rsplit(".", 1)
    assert FL.read_token(f"{body}.{'0' * len(mac)}", now=1_000_001) is None
    assert FL.read_token(f"x{body}.{mac}", now=1_000_001) is None
    assert FL.read_token("", now=1_000_001) is None and FL.read_token("not a token") is None


def test_a_token_stops_working_after_30_days():
    token = FL.make_token("org_a", "frm_1", "acc_1", "enr_1", "ann@acme.co.uk", now=1_000_000)
    assert FL.read_token(token, now=1_000_000 + FL.TTL_S - 5) is not None
    assert FL.read_token(token, now=1_000_000 + FL.TTL_S + 5) is None


def test_tags_are_found_once_each():
    text = "Fill this in: {{form_link:frm_ab12}} or here {{ form_link : frm_ab12 }} and {{form_link:frm_cd34}}"
    assert FL.tags_in(text) == ["frm_ab12", "frm_cd34"]
    assert FL.tags_in("Hi {{first_name}}") == []


def test_a_form_link_with_no_form_is_caught_and_the_journey_refuses_it():
    assert FL.has_bare_tag("See {{form_link}}") and not FL.has_bare_tag("See {{form_link:frm_1}}")
    steps = [{"channel": "email", "subject": "Hi", "body": "Please fill this in {{form_link}}"}]
    try:
        J.clean_steps(steps)
    except J.JourneyError as err:
        assert "form" in str(err).lower()
    else:
        raise AssertionError("a form link with no form should not be accepted")


def test_a_chosen_form_is_accepted_in_a_step():
    out = J.clean_steps([{"channel": "email", "subject": "Hi", "body": "Please fill this in {{form_link:frm_1}}"}])
    assert "{{form_link:frm_1}}" in out[0]["body"]


def test_only_marked_phone_and_website_questions_are_shared():
    fields = [
        {"id": "phone", "type": "phone", "label": "Phone", "maps_to": "phone", "share_to_company": True},
        {"id": "site", "type": "text", "label": "Website", "maps_to": "website", "share_to_company": False},
        {"id": "role", "type": "text", "label": "Role", "maps_to": "contact_title", "share_to_company": True},
    ]
    answers = {"phone": "020 7123 0958", "site": "acme.co.uk", "role": "Owner"}
    assert FL.shared_values(fields, answers) == {"phone": "020 7123 0958"}


def test_the_share_choice_is_kept_only_for_phone_and_website():
    fields = IF.clean_fields([
        {"id": "email", "type": "email", "label": "Email"},
        {"id": "phone", "type": "phone", "label": "Phone", "share_to_company": True},
        {"id": "role", "type": "text", "label": "Role", "maps_to": "contact_title", "share_to_company": True},
    ])
    by_id = {f["id"]: f for f in fields}
    assert by_id["phone"]["share_to_company"] is True
    assert by_id["role"]["share_to_company"] is False
    assert by_id["email"]["share_to_company"] is False


def test_the_two_reasons_to_stop_a_journey_include_the_form():
    assert J.DEFAULT_RULES["on_form"] is True
    assert J.EXIT_STATUS["form_returned"] == "form_returned"


def test_a_second_link_answer_never_overwrites_the_shared_company_value():
    import asyncio
    from types import SimpleNamespace

    class Res:
        def scalars(self):
            return self

        def all(self):
            return []

        def first(self):
            return None

    lead = SimpleNamespace(id="acc_1", business_record_id="biz_1", contact_name="", phone="", website="", contact_title="", industry="",
                           region="", notes="", custom=None)
    biz = SimpleNamespace(raw_data={"business_confirmed": {"phone": "020 7000 0001"}})

    class Db:
        async def get(self, model, key):
            return lead if key == "acc_1" else biz

        async def execute(self, *a, **k):
            return Res()

    fields = [{"id": "phone", "type": "phone", "label": "Phone", "maps_to": "phone", "share_to_company": True},
              {"id": "site", "type": "text", "label": "Site", "maps_to": "website", "share_to_company": True}]
    form = SimpleNamespace(published_fields=fields, fields=fields)
    sub = SimpleNamespace(payload={"phone": "020 9999 9999", "site": "acme.co.uk"}, status="", reason="", lead_id="")
    asyncio.run(FL.attach(Db(), sub, form, {"lead_id": "acc_1", "org_id": "o", "form_id": "f", "enrollment_id": "", "email": "a@acme.co.uk"}))
    held = biz.raw_data["business_confirmed"]
    assert held["phone"] == "020 7000 0001" and held["website"] == "acme.co.uk" and held["unverified"] is True
    assert lead.phone == "020 9999 9999"  # the organisation's own lead still gets what was sent
