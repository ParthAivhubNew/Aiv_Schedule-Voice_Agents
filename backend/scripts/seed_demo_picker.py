"""Four demo companies in Leeds so the Find Leads changes can be checked by hand on an empty local database.

    cd backend
    DATABASE_URL=postgresql+asyncpg://postgres:<password>@127.0.0.1:5432/aivhub venv/Scripts/python.exe scripts/seed_demo_picker.py

Safe to run twice: companies are matched by number. It adds 50 Leads credits to the default organisation, so the lookups can be charged.
The "candidates" a lookup could not decide between are written straight onto the company, so the picker shows even without a web search key."""
import asyncio
import os
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select  # noqa: E402

from app.core.tenancy import org_scope  # noqa: E402
from app.database import AsyncSessionLocal, Base, engine  # noqa: E402
from app.models.models import BusinessRecord  # noqa: E402
from app.services import credits as K  # noqa: E402

CAFE = "56102 - Unlicensed restaurants and cafes"


def officers():
    year = datetime.utcnow().year
    return [
        {"name": "LEE, Ann", "role": "director", "appointed_on": f"{year}-01-05", "nationality": "British", "occupation": "Chef", "v": 2},
        {"name": "RAY, Bo", "role": "director", "appointed_on": "2016-03-01", "nationality": "British", "v": 2},
        {"name": "FOX, Cy", "role": "secretary", "appointed_on": "2018-06-01", "nationality": "British", "v": 2},
    ]


def linkedin(slug, title, note, score, label, kind="company"):
    return {"value": f"https://www.linkedin.com/{kind}/{slug}", "score": score, "label": label, "title": title, "note": note, "sources": []}


def li_store():
    at = datetime.utcnow().isoformat() + "Z"
    return {"company": {"url": "", "at": at, "options": [
        linkedin("demo-open-cafe", "Demo Open Cafe | LinkedIn", "Independent cafe in Leeds. 2-10 employees. Coffee, brunch and catering.", 66, "Likely"),
        linkedin("demo-open-cafe-bradford", "Demo Open Cafe Bradford | LinkedIn", "Cafe in Bradford. 2-10 employees.", 48, "Possible"),
        linkedin("demo-open", "Demo Open Ltd | LinkedIn", "Business services, Manchester.", 36, "Possible")]},
        "people": {"Bo Ray": {"url": "", "at": at, "options": [
            linkedin("bo-ray-leeds", "Bo Ray - Director - Demo Open Cafe | LinkedIn", "Leeds. Director at Demo Open Cafe. Previously head chef.", 85, "Likely", "in"),
            linkedin("bo-ray-1983", "Bo Ray - Chef - Elsewhere | LinkedIn", "London. Chef.", 40, "Possible", "in")]}}}


def socials(**pages):
    """Pages we already hold (a url) and pages with close matches the person has not chosen from yet (a list of options)."""
    at = datetime.utcnow().isoformat() + "Z"
    return {k: ({"url": v, "options": [], "at": at} if isinstance(v, str) else {"url": "", "options": v, "at": at}) for k, v in pages.items()}


def x_option(handle, title, note, score, label):
    return {"value": f"https://x.com/{handle}", "score": score, "label": label, "title": title, "note": note, "sources": []}


def site(domain, title, note, sources):
    return {"value": f"https://{domain}", "score": 0, "label": "Possible", "title": title, "note": note, "sources": sources}


COMPANIES = [
    {"number": "DEMO001", "name": "DEMO OPEN CAFE LIMITED", "contact": {"website": "demoopencafe.co.uk", "phone": "0113 496 0001", "email": "hello@demoopencafe.co.uk"},
     "officers": True, "options": {}, "extra": {"socials": socials(facebook="https://www.facebook.com/demoopencafe", x=[
         x_option("demoopencafe", "Demo Open Cafe (@demoopencafe) / X", "Cafe in Leeds. Coffee, brunch, catering.", 63, "Likely"),
         x_option("demoopen", "Demo Open (@demoopen) / X", "Business services.", 38, "Possible")])}},
    {"number": "DEMO002", "name": "DEMO MANY SITES LIMITED", "contact": {}, "officers": False, "options": {"website": [
        {**site("demomanysites.co.uk", "Demo Many Sites | Leeds cafe", "Cafe in Leeds LS1", ["https://www.facebook.com/demomanysites"]), "score": 62, "label": "Likely"},
        {**site("demomanysites.com", "Demo Many Sites", "A different business with a similar name", ["https://www.yell.com/biz/demo-many-sites"]), "score": 55, "label": "Likely"},
        {**site("demo-many-sites.co.uk", "Demo-Many-Sites Catering", "Catering, Bradford", []), "score": 48, "label": "Possible"},
        {**site("demomany.co.uk", "Demo Many", "Could be a shorter name", []), "score": 41, "label": "Possible"},
        {**site("demomanysites.org", "Demo Many Sites charity", "Charity page", []), "score": 33, "label": "Possible"},
    ]}},
    {"number": "DEMO003", "name": "DEMO ONE SITE LIMITED", "contact": {}, "officers": False, "extra": {
        "socials": socials(facebook="https://www.facebook.com/demoonesite", x="https://x.com/demoonesite"),
        "linkedin": {"company": {"url": "https://www.linkedin.com/company/demo-one-site", "options": [], "at": datetime.utcnow().isoformat() + "Z"}}}, "options": {"website": [
        {**site("demoonesite.co.uk", "Demo One Site | Leeds", "Cafe in Leeds LS1", ["https://www.facebook.com/demoonesite"]), "score": 58, "label": "Likely"}]}},
    {"number": "DEMO004", "name": "DEMO NOTHING LIMITED", "contact": {}, "officers": False, "options": {}},
]


async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSessionLocal() as db:
        for n, c in enumerate(COMPANIES, 1):
            have = (await db.execute(select(BusinessRecord).where(BusinessRecord.registration_number == c["number"]))).scalars().first()
            raw = {"ds_companies_house": {" CompanyNumber": c["number"], "Accounts.AccountCategory": "SMALL"}, "lookup_options": c["options"]}
            if c["officers"]:
                raw["linkedin"] = li_store()
            raw.update(c.get("extra") or {})
            if have:
                have.raw_data = {**(have.raw_data or {}), "lookup_options": c["options"], **({"linkedin": li_store()} if c["officers"] else {}), **(c.get("extra") or {})}
                continue
            db.add(BusinessRecord(
                id=f"br_demo{n}", identity_hash=f"demo_picker_{n}", name=c["name"], registration_number=c["number"], status="Active",
                company_category="Private Limited Company", region="LEEDS", postcode="LS1 4AP", address="1 High St, Leeds, LS1 4AP",
                sic_text=CAFE, industry=CAFE, incorporated_on=date(2015, 1, 1), size_band="small", confidence_tier="verified_registry",
                website=c["contact"].get("website"), phone=c["contact"].get("phone"), email=c["contact"].get("email"),
                officers=officers() if c["officers"] else None, people_checked_at=datetime.utcnow() if c["officers"] else None,
                raw_data=raw, rank_score=2000 - n))
        await db.commit()
        with org_scope("org_default"):
            await K.add_credits(db, "leadgen", 50, source="grant", note="Demo")
            await db.commit()
    print("Seeded 4 demo companies (search Town: Leeds) and added 50 Leads credits.")


asyncio.run(main())
