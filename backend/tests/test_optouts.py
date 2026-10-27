"""Opt-outs from the shared business data: the confirmation link, what an opt-out clears, and that an import cannot put it back."""
import pytest
from sqlalchemy.future import select

from app.models.models import BusinessRecord, EmailSuppression, PlatformOptOut
from app.services import optouts as OO


def test_phone_key_matches_every_way_of_writing_a_number():
    assert OO.phone_key("+44 20 7946 0958") == OO.phone_key("020 7946 0958") == "2079460958"
    assert OO.phone_key("12") == ""


def test_the_confirmation_link_is_signed_and_expires():
    token = OO.make_token("jo@acme.co.uk", "020 7946 0958", now=1000)
    assert OO.read_token(token, now=1000 + 60) == ("jo@acme.co.uk", "020 7946 0958")
    assert OO.read_token(token, now=1000 + OO.TOKEN_TTL_S + 5) is None
    body, mac = token.rsplit(".", 1)
    assert OO.read_token(f"{body}.{'0' * len(mac)}") is None
    assert OO.read_token("nonsense") is None


def test_redact_removes_a_value_from_a_stored_row_in_any_case():
    doc = {"src": {"Email": "Jo@Acme.co.uk", "note": "write to jo@acme.co.uk please", "n": 1}}
    out = OO._redact(doc, "jo@acme.co.uk")
    assert "acme.co.uk" not in str(out) and out["src"]["n"] == 1
    assert OO._redact(doc, "nobody@x.com") is doc


@pytest.mark.db
async def test_the_whole_opt_out_flow(anon, db):
    import app.api.legal as legal

    sent = []

    async def fake_send(to, subject, html_body, text_body, reply_to=None):
        sent.append((to, text_body))
        return {"ok": True}

    legal.send_system_email = fake_send
    db.add(BusinessRecord(id="biz_1", identity_hash="h1", name="Acme Ltd", email="jo@acme.co.uk", phone="020 7946 0958",
                          raw_data={"ds_x": {"Email": "jo@acme.co.uk"}}))
    await db.commit()

    assert (await anon.get("/api/legal/business-data")).status_code == 200
    assert "Opt out" in (await anon.get("/api/legal/opt-out")).text
    # The answer is the same for any address, and a trap field sends nothing
    r = await anon.post("/api/legal/opt-out", content="email=jo%40acme.co.uk&phone=020+7946+0958", headers={"content-type": "application/x-www-form-urlencoded"})
    assert r.status_code == 200 and len(sent) == 1
    await anon.post("/api/legal/opt-out", content="email=x%40y.com&website=spam", headers={"content-type": "application/x-www-form-urlencoded"})
    assert len(sent) == 1
    link = sent[0][1].split("Confirm it here: ")[1].split("\n")[0]
    path = link[link.index("/api/"):]
    # Opening the link changes nothing
    assert (await anon.get(path)).status_code == 200
    assert (await db.execute(select(PlatformOptOut))).scalars().first() is None
    assert (await anon.get("/api/legal/opt-out/confirm/bad.token")).status_code == 404
    # The button records it and clears the details
    assert (await anon.post(path)).status_code == 200
    import asyncio

    for _ in range(50):
        await db.rollback()
        rec = (await db.execute(select(BusinessRecord).where(BusinessRecord.id == "biz_1"))).scalars().first()
        if not rec.email:
            break
        await asyncio.sleep(0.1)
    assert rec.email == "" and rec.phone == "" and "acme.co.uk" not in str(rec.raw_data)
    entry = (await db.execute(select(PlatformOptOut))).scalars().first()
    assert entry.email == "jo@acme.co.uk" and entry.phone_key == "2079460958"
    assert (await db.execute(select(EmailSuppression).where(EmailSuppression.org_id.is_(None), EmailSuppression.email == "jo@acme.co.uk"))).scalars().first()

    # A later import does not put them back
    from app.services import business_records as BR

    rows = [{"name": "Acme Ltd", "registration_number": "01234567", "email": "JO@acme.co.uk", "phone": "+44 20 7946 0958", "raw": {"e": "jo@acme.co.uk"}},
            {"name": "Other Ltd", "registration_number": "07654321", "email": "info@other.co.uk"}]
    await BR.bulk_upsert(db, source_id="ds_x", rows=rows)
    await db.commit()
    got = {r.registration_number: r for r in (await db.execute(select(BusinessRecord))).scalars().all()}
    assert got["01234567"].email == "" and got["01234567"].phone == ""
    assert got["07654321"].email == "info@other.co.uk"
    # The call check refuses the number
    from app.services.compliance import is_opted_out

    assert await is_opted_out(db, "02079460958")
