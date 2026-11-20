"""Inbound web forms: what a public answer may hold, how it is cleaned, and the public routes' guards."""
import pytest

from app.services import inbound_forms as IF


def _fields():
    return IF.clean_fields([
        {"id": "name", "type": "name", "label": "Name", "required": True},
        {"id": "email", "type": "email", "label": "Email"},
        {"id": "phone", "type": "phone", "label": "Phone"},
        {"id": "size", "type": "dropdown", "label": "Team size", "options": ["1-10", "11-50"], "maps_to": "custom:size"},
        {"id": "terms", "type": "checkbox", "label": "Happy to be contacted"},
    ])


SETTINGS = IF.clean_settings({})


def test_a_new_form_starts_with_name_and_email():
    f = IF.default_fields()
    assert [x["type"] for x in f] == ["name", "email"]
    assert IF.clean_fields(f) == f


def test_fields_need_exactly_one_email():
    with pytest.raises(ValueError):
        IF.clean_fields([{"id": "name", "type": "name", "label": "Name"}])
    with pytest.raises(ValueError):
        IF.clean_fields([{"type": "email"}, {"type": "email"}])


def test_unknown_types_and_empty_dropdowns_are_refused():
    with pytest.raises(ValueError):
        IF.clean_fields([{"type": "email"}, {"type": "script"}])
    with pytest.raises(ValueError):
        IF.clean_fields([{"type": "email"}, {"type": "dropdown", "label": "Pick", "options": []}])


def test_field_ids_stay_unique_and_cannot_be_the_honeypot():
    out = IF.clean_fields([{"type": "email", "id": "x"}, {"type": "text", "id": IF.HONEYPOT}, {"type": "text", "id": IF.HONEYPOT}])
    ids = [f["id"] for f in out]
    assert len(set(ids)) == 3 and IF.HONEYPOT not in ids


def test_mapping_targets_are_limited_to_lead_columns_or_custom():
    out = IF.clean_fields([{"type": "email", "maps_to": "id"}, {"type": "text", "id": "a", "maps_to": "stage"}, {"type": "text", "id": "b", "maps_to": "custom:Job Size!"}])
    assert out[0]["maps_to"] == "email"
    assert out[1]["maps_to"] == "custom:a"  # "stage" is not an answer column: kept as the form's own question
    assert out[2]["maps_to"] == "custom:job_size"
    assert IF.clean_fields([{"type": "email"}, {"type": "text", "id": "x", "maps_to": "email"}])[1]["maps_to"] == "custom:x"  # only the Email field sets the email


def test_a_good_answer_passes_and_is_cleaned():
    clean, errs = IF.validate_answer(_fields(), SETTINGS, {
        "name": "  Ann   <b>Lee</b> ", "email": "ANN@Acme.co.uk", "phone": "+44 20 7123 0958", "size": "11-50", "terms": True})
    assert not errs
    assert clean["name"] == "Ann Lee" and clean["email"] == "ann@acme.co.uk" and clean["phone"] == "+44 20 7123 0958"
    assert clean["terms"] == "yes"


def test_bad_answers_are_refused_field_by_field():
    _, errs = IF.validate_answer(_fields(), SETTINGS, {"name": "", "email": "not-an-email", "phone": "abc", "size": "999"})
    assert set(errs) == {"name", "email", "phone", "size"}


def test_unknown_keys_are_an_error():
    _, errs = IF.validate_answer(_fields(), SETTINGS, {"name": "A", "email": "a@acme.co.uk", "role": "admin"})
    assert "role" in errs


def test_free_email_and_allowed_domain_rules():
    s = IF.clean_settings({"block_free_email": True})
    _, errs = IF.validate_answer(_fields(), s, {"name": "A", "email": "a@gmail.com"})
    assert "email" in errs
    s = IF.clean_settings({"allowed_email_domains": ["acme.co.uk"]})
    assert "email" in IF.validate_answer(_fields(), s, {"name": "A", "email": "a@other.com"})[1]
    assert not IF.validate_answer(_fields(), s, {"name": "A", "email": "a@acme.co.uk"})[1]


def test_spreadsheet_formulas_are_neutralised_but_phone_plus_survives():
    assert IF.clean_text("=HYPERLINK(\"http://x\")").startswith("'")
    assert IF.clean_text("@SUM(A1)").startswith("'")
    assert IF.clean_text("-2+3").startswith("'")
    assert IF.clean_text("+44 20 7123 0958", keep_plus=True) == "+44 20 7123 0958"


def test_markup_and_control_characters_are_removed():
    assert IF.clean_text("<script>alert(1)</script>Hi\x00 there") == "alert(1)Hi there"


def test_oversized_bodies_are_refused():
    big = {f"k{i}": "x" for i in range(IF.MAX_BODY_KEYS + 1)}
    assert IF.validate_answer(_fields(), SETTINGS, big)[1]


def test_answers_are_laid_out_as_lead_columns_and_custom():
    answers = {"name": "Ann Lee", "email": "ann@acme.co.uk", "phone": "+44 20 7123 0958", "size": "11-50", "terms": "yes"}
    cols = IF.lead_fields(_fields(), answers)
    assert cols["contact_name"] == "Ann Lee" and cols["email"] == "ann@acme.co.uk" and cols["phone"].startswith("+44")
    assert cols["custom"] == {"size": "11-50", "terms": "Happy to be contacted: yes"}


def test_company_name_is_read_from_a_work_email_domain():
    assert IF.company_name_from("acme-widgets.co.uk") == "Acme Widgets"
    assert IF.company_name_from("") == ""


def test_ip_hash_is_stable_within_a_day_and_hides_the_address():
    a = IF.ip_hash("203.0.113.9")
    assert a == IF.ip_hash("203.0.113.9") and a != IF.ip_hash("203.0.113.10") and "203" not in a


def test_frame_rule_names_the_allowed_sites():
    assert IF.frame_ancestors(IF.clean_settings({"allowed_origins": ["https://www.acme.com/contact"]})) == "frame-ancestors https://acme.com http://acme.com"
    assert IF.frame_ancestors(IF.clean_settings({})) == "frame-ancestors *"


# ── The public routes, without a database ─────────────────────────────────────────────────────
@pytest.fixture
def client(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.api import inbound_forms as API
    from app.public_api import core

    published = {"id": "frm_1", "org_id": "org_x", "name": "Contact us", "fields": _fields(), "settings": IF.clean_settings({"allowed_origins": ["acme.com"]}), "version": 3}

    async def fake_published(key):
        return published if key == "k" * 24 else None

    monkeypatch.setattr(API, "_published", fake_published)
    core._WINDOWS.clear()
    app = FastAPI()
    app.include_router(API.public_router)
    return TestClient(app), API


def test_page_is_served_with_a_frame_rule_and_no_supplier_names(client):
    c, _ = client
    r = c.get("/f/" + "k" * 24 + "/page")
    assert r.status_code == 200
    assert "frame-ancestors https://acme.com http://acme.com" in r.headers["content-security-policy"]
    assert "Contact us" in r.text
    for banned in ("Telnyx", "xAI", "Apollo", "Twilio"):
        assert banned not in r.text


def test_unknown_or_unpublished_forms_are_404(client):
    c, _ = client
    assert c.get("/f/nope/page").status_code == 404
    assert c.get("/f/nope/config").status_code == 404
    assert c.post("/f/nope/submit", json={}).status_code == 404


def test_config_hides_the_lead_mapping(client):
    c, _ = client
    body = c.get("/f/" + "k" * 24 + "/config").json()
    assert all("maps_to" not in f for f in body["fields"])


def test_honeypot_looks_like_success_and_stores_nothing(client, monkeypatch):
    c, API = client

    def boom(*a, **k):
        raise AssertionError("a bot's answer must not reach the database")

    monkeypatch.setattr(API, "AsyncSessionLocal", boom)
    r = c.post("/f/" + "k" * 24 + "/submit", json={IF.HONEYPOT: "http://spam", "name": "x", "email": "x@y.zz"})
    assert r.status_code == 200 and r.json()["ok"] is True


def test_invalid_answers_get_field_errors_before_any_database_work(client, monkeypatch):
    c, API = client
    monkeypatch.setattr(API, "AsyncSessionLocal", lambda *a, **k: (_ for _ in ()).throw(AssertionError("no database for a bad answer")))
    r = c.post("/f/" + "k" * 24 + "/submit", json={"name": "", "email": "bad"})
    assert r.status_code == 422 and {"name", "email"} <= set(r.json()["errors"])


def test_oversized_and_malformed_bodies(client):
    c, _ = client
    assert c.post("/f/" + "k" * 24 + "/submit", content=b"x" * 30000, headers={"content-type": "application/json"}).status_code == 413
    assert c.post("/f/" + "k" * 24 + "/submit", content=b"{not json", headers={"content-type": "application/json"}).status_code == 400


def test_a_burst_from_one_address_is_slowed(client, monkeypatch):
    c, API = client
    monkeypatch.setattr(API, "check_rate", lambda who, write, **kw: 30)
    r = c.post("/f/" + "k" * 24 + "/submit", json={"name": "A", "email": "a@acme.co.uk"})
    assert r.status_code == 429 and r.headers["retry-after"] == "30"


# ── With a database ───────────────────────────────────────────────────────────────────────────
@pytest.mark.db
async def test_a_submission_becomes_a_lead_in_the_forms_list_once_the_email_domain_can_receive_mail(db, monkeypatch):
    from sqlalchemy import select

    from app.api import inbound_forms as API
    from app.core.tenancy import org_scope
    from app.models.models import InboundForm, InboundSubmission, LeadAccount

    async def mail_ok(domain):
        return domain == "acme.co.uk"

    monkeypatch.setattr(IF, "has_mail_server", mail_ok)
    f = InboundForm(id="frm_t", name="Contact", fields=_fields(), published_fields=_fields(), status="published",
                    settings=IF.clean_settings({"list_name": "Web leads"}), public_key="k" * 24, schema_version=1)
    db.add(f)
    await db.commit()

    import httpx
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(API.public_router)
    url = "/f/" + "k" * 24 + "/submit"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        ok = await c.post(url, json={"name": "Ann Lee", "email": "ann@acme.co.uk", "phone": "+44 20 7123 0958"})
        assert ok.status_code == 200
        again = await c.post(url, json={"name": "Ann Lee", "email": "ann@acme.co.uk"})
        assert again.status_code == 200  # the same person, same day: no second row
        bad = await c.post(url, json={"name": "Bob", "email": "bob@nowhere-made-up.test"})
        assert bad.status_code == 200

    import asyncio
    await asyncio.sleep(0.5)  # the background review
    with org_scope("org_default"):
        subs = (await db.execute(select(InboundSubmission).order_by(InboundSubmission.email))).scalars().all()
        assert [(s.email, s.status) for s in subs] == [("ann@acme.co.uk", "approved"), ("bob@nowhere-made-up.test", "blocked")]
        lead = (await db.execute(select(LeadAccount).where(LeadAccount.email == "ann@acme.co.uk"))).scalars().one()
        assert lead.source == "inbound_form" and lead.name == "Acme" and lead.contact_name == "Ann Lee" and lead.domain == "acme.co.uk"
        assert (await db.execute(select(LeadAccount))).scalars().all() == [lead]  # the blocked answer never reached the leads store


@pytest.mark.db
async def test_one_organisations_forms_and_answers_are_invisible_to_another(db):
    from sqlalchemy import select

    from app.core.tenancy import org_scope
    from app.database import AsyncSessionLocal
    from app.models.models import InboundForm, InboundSubmission

    with org_scope("org_a"):
        async with AsyncSessionLocal() as s:
            s.add(InboundForm(id="frm_a", name="A", fields=_fields(), public_key="a" * 24))
            await s.flush()
            s.add(InboundSubmission(id="sub_a", form_id="frm_a", email="x@acme.co.uk", payload={}))
            await s.commit()
    with org_scope("org_b"):
        async with AsyncSessionLocal() as s:
            assert (await s.execute(select(InboundForm))).scalars().all() == []
            assert (await s.execute(select(InboundSubmission))).scalars().all() == []
    with org_scope("org_a"):
        async with AsyncSessionLocal() as s:
            assert len((await s.execute(select(InboundForm))).scalars().all()) == 1


# ── Review fixes ──────────────────────────────────────────────────────────────────────────────
def test_an_email_with_a_plus_is_not_given_a_formula_prefix():
    clean, errs = IF.validate_answer(_fields(), SETTINGS, {"name": "A", "email": "+a@acme.co.uk"})
    assert not errs and clean["email"] == "+a@acme.co.uk"


def test_only_real_tags_are_stripped():
    assert IF.clean_text("a < b and c > d") == "a < b and c > d"
    assert IF.clean_text("x <b>bold</b> <!-- hi --> y") == "x bold y"


def test_a_personal_link_to_a_free_mailbox_passes_a_work_email_form():
    s = IF.clean_settings({"block_free_email": True})
    assert "email" in IF.validate_answer(_fields(), s, {"name": "A", "email": "a@gmail.com"})[1]
    assert not IF.validate_answer(_fields(), s, {"name": "A", "email": "a@gmail.com"}, skip_email_rules=True)[1]


def test_odd_hosts_never_reach_the_frame_header():
    assert IF.clean_settings({"allowed_origins": ["https://evil.com; script-src *", "ok.com"]})["allowed_origins"] == ["ok.com"]
    assert IF.frame_ancestors({"allowed_origins": ["a.com; x", "b.com"]}) == "frame-ancestors https://b.com http://b.com"


def test_a_label_holding_a_placeholder_is_not_substituted_again(client, monkeypatch):
    c, API = client
    fields = IF.clean_fields([{"id": "email", "type": "email", "label": "__PREFILL__ __THANKS__"}])
    published = {"id": "frm_1", "org_id": "org_x", "name": "__KEY__", "fields": fields, "settings": IF.clean_settings({"thanks": "T"}), "version": 1}

    async def fake(key):
        return published

    monkeypatch.setattr(API, "_published", fake)
    r = c.get("/f/" + "k" * 24 + "/page")
    assert "<title>__KEY__</title>" in r.text and "__PREFILL__ __THANKS__" in r.text


def test_the_page_shows_the_consent_line_and_a_default(client):
    c, _ = client
    assert IF.DEFAULT_CONSENT in c.get("/f/" + "k" * 24 + "/page").text


def test_consent_is_recorded_with_the_form_version():
    m = IF.consent_meta(IF.clean_settings({"consent_text": "We may email you."}), 3, "203.0.113.9")
    assert m["consent_text"] == "We may email you." and m["form_version"] == 3 and m["at"].endswith("Z") and "203" not in m["ip_hash"]
    assert IF.consent_meta(IF.clean_settings({}), 1, "")["consent_text"] == IF.DEFAULT_CONSENT


def test_the_forwarded_for_header_is_not_trusted(client):
    from types import SimpleNamespace

    _, API = client
    req = SimpleNamespace(headers={"x-forwarded-for": "1.2.3.4"}, client=SimpleNamespace(host="10.0.0.5"))
    assert API._client_ip(req) == "10.0.0.5"


def test_a_declared_oversized_body_is_refused_before_reading(client):
    c, _ = client
    r = c.post("/f/" + "k" * 24 + "/submit", content=b"{}", headers={"content-type": "application/json", "content-length": "999999"})
    assert r.status_code in (400, 413)  # the client library may refuse the mismatch itself; the route never reads that much


def test_rate_buckets_are_evicted_and_the_shared_bucket_is_looser():
    import time

    from app.public_api import core

    core._WINDOWS.clear()
    core._WINDOWS["old:all"].append(time.time() - 500)
    core._WINDOWS["empty:all"]
    core._last_sweep = 0.0
    assert core.check_rate("new", False) is None
    assert "old:all" not in core._WINDOWS and "empty:all" not in core._WINDOWS
    for _ in range(40):
        assert core.check_rate("shared", True, rate=600, write_rate=600) is None
    core._WINDOWS.clear()


@pytest.mark.asyncio
async def test_a_dns_timeout_means_retry_later_not_blocked(monkeypatch):
    import dns.asyncresolver
    import dns.exception
    import dns.resolver

    class Slow:
        lifetime = 1

        async def resolve(self, d, t):
            raise dns.exception.Timeout()

    class Gone(Slow):
        async def resolve(self, d, t):
            raise dns.resolver.NXDOMAIN()

    monkeypatch.setattr(dns.asyncresolver, "Resolver", Slow)
    assert await IF.has_mail_server("acme.co.uk") is None
    monkeypatch.setattr(dns.asyncresolver, "Resolver", Gone)
    assert await IF.has_mail_server("nowhere.test") is False


def test_background_review_tasks_are_kept_until_done():
    import asyncio

    async def go():
        ran = []

        async def job():
            ran.append(1)

        IF._spawn(job())
        assert len(IF._TASKS) == 1
        await asyncio.sleep(0.05)
        assert ran and not IF._TASKS

    asyncio.run(go())
