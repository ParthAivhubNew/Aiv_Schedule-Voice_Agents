"""Seed or reset a clean demo account with rich showcase data for client presentations.

Usage:
    python backend/scripts/seed_demo_account.py
    python backend/scripts/seed_demo_account.py --username demo --password DemoPassword2026!
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import select, text
from app.database import AsyncSessionLocal, engine, Base
from app.core.migrations import run_migrations
from app.models.models import (
    Operator, Organization, CompanyProfile, Role, OperatorRole,
    FsbImport, FsbImportRow, ChangeReport, BusinessRecord
)
from app.core.security import hash_password
from app.core.accounts import ensure_system_roles, assign_roles
from app.services import credits as K

DEMO_USERNAME = "fsbdemo"
DEMO_PASSWORD = "Fsb@2026"
DEMO_EMAIL = "fsbdemo@outreach.com"
DEMO_NAME = "FSB Demo Outreach"
DEFAULT_ORG_ID = "org_default"


async def seed_demo(username: str, password: str, name: str, email: str, org_id: str = DEFAULT_ORG_ID):
    # Ensure all tables and migration columns exist
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        try:
            await run_migrations(conn)
        except Exception as e:
            print(f"[!] Migration notice: {e}")

    async with AsyncSessionLocal() as db:
        # 1. Ensure organisation exists
        org = (await db.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
        if not org:
            org = Organization(
                id=org_id,
                name="Federation of Small Businesses",
                slug="fsb",
                status="active",
            )
            db.add(org)
            await db.flush()
        else:
            org.name = "Federation of Small Businesses"
            await db.flush()

        # 2. Ensure system roles exist
        await ensure_system_roles(db, org_id)

        # 3. Find or create demo operator
        op = (await db.execute(select(Operator).where(Operator.username == username.lower()))).scalars().first()
        if not op:
            op = Operator(
                id=f"op_{username.lower()}",
                org_id=org_id,
                username=username.lower(),
                name=name,
                email=email,
                role="Admin",
                hashed_password=hash_password(password),
                must_change_password=False,
                is_active=True,
            )
            db.add(op)
            print(f"[+] Created demo operator: username='{username.lower()}'")
        else:
            op.name = name
            op.email = email
            op.role = "Admin"
            op.hashed_password = hash_password(password)
            op.must_change_password = False
            op.is_active = True
            print(f"[*] Updated existing operator: username='{username.lower()}'")

        await db.flush()

        # 4. Assign Admin role
        admin_role = (await db.execute(select(Role).where(Role.org_id == org_id, Role.name == "Admin"))).scalars().first()
        if admin_role:
            await assign_roles(db, op, [admin_role.id])

        # 5. Ensure demo credits in wallets
        for wallet in K.WALLETS:
            try:
                bal = await K.balance(db, wallet=wallet, org_id=org_id)
                if bal < 500:
                    await K.grant(db, 500 - bal, note="Demo showcase credits", by="Demo Setup", wallet=wallet, org_id=org_id)
            except Exception:
                pass

        # 6. Ensure Company Profile is populated
        profile = (await db.execute(select(CompanyProfile).where(CompanyProfile.id == "default"))).scalars().first()
        if not profile:
            profile = CompanyProfile(
                id="default",
                name="AIVHub Ltd",
                pitch="AI-powered customer intelligence and automated outreach platform",
                industry="Software & Business Intelligence",
                website="https://aivhub.io",
                caller_name="Sam",
                timezone="Europe/London",
                call_hours_policy="respectful",
                weekday_start="09:00",
                weekday_end="17:30",
            )
            db.add(profile)

        # 7. Seed sample Register Companies in business_records if needed for demo candidate lookup
        biz_samples = [
            ("08991234", "ACME DIGITAL CONSULTING LIMITED", "10 St James Street, Brighton, East Sussex", "BN1 1AB", "active", "62020 - Information technology consultancy activities"),
            ("09112233", "ACME DIGITAL MEDIA LTD", "14 St James Street, Brighton", "BN1 1AB", "active", "73110 - Advertising agencies"),
            ("07788990", "BRIGHTON COFFEE ROASTERS LTD", "22 North Road, Brighton", "BN1 1YA", "active", "10831 - Tea and coffee processing"),
        ]
        for num, bname, addr, pc, st, sic in biz_samples:
            existing_biz = (await db.execute(select(BusinessRecord).where(BusinessRecord.registration_number == num))).scalars().first()
            if not existing_biz:
                import hashlib
                id_hash = hashlib.sha256(f"{num}:{bname}".encode()).hexdigest()
                db.add(BusinessRecord(
                    id=f"biz_{num}",
                    identity_hash=id_hash,
                    registration_number=num,
                    name=bname,
                    address=addr,
                    postcode=pc,
                    status=st,
                    sic_codes=f"|{sic[:5]}|",
                    sic_text=sic,
                ))

        # 8. Seed sample FSB Import and Review Rows for "Import & match" demonstration
        imp = (await db.execute(select(FsbImport).where(FsbImport.id == "imp_demo_showcase"))).scalars().first()
        if not imp:
            imp = FsbImport(
                id="imp_demo_showcase",
                org_id=org_id,
                filename="fsb_salesforce_accounts_october.csv",
                status="done",
                row_count=150,
                stats={
                    "processed": 150,
                    "counts": {"auto": 140, "review": 2, "none": 8, "duplicate": 0},
                    "duplicates": {"exact": 0, "near": 0},
                },
                created_by="Demo Showcase",
                created_at=datetime.utcnow(),
                finished_at=datetime.utcnow(),
            )
            db.add(imp)
            await db.flush()

            # Seed 2 Review Rows
            row1 = FsbImportRow(
                id="fsr_demo_1",
                import_id="imp_demo_showcase",
                org_id=org_id,
                source_record_id="0018d00000abc001AAA",
                name="Acme Digital Consulting",
                company_number_given="",
                address="10 St James Street",
                postcode="BN1 1AB",
                phone="01273 555010",
                website="https://acmedigital.example.co.uk",
                match_status="review",
                score=0.88,
                reason="Name and address match register with high confidence. Suffix differs (Consulting vs Consulting Limited).",
                candidates=[
                    {"company_number": "08991234", "name": "ACME DIGITAL CONSULTING LIMITED", "score": 0.88},
                    {"company_number": "09112233", "name": "ACME DIGITAL MEDIA LTD", "score": 0.72},
                ],
            )
            row2 = FsbImportRow(
                id="fsr_demo_2",
                import_id="imp_demo_showcase",
                org_id=org_id,
                source_record_id="0018d00000abc002AAA",
                name="Brighton Coffee Roastery",
                company_number_given="",
                address="22 North Road",
                postcode="BN1 1YA",
                phone="01273 555020",
                website="https://brightoncoffee.example.co.uk",
                match_status="review",
                score=0.84,
                reason="Close name match and identical postcode district.",
                candidates=[
                    {"company_number": "07788990", "name": "BRIGHTON COFFEE ROASTERS LTD", "score": 0.84},
                ],
            )
            db.add_all([row1, row2])
            print("[+] Seeded demo FSB import with 2 records waiting in the Needs review queue.")

        # 9. Seed sample Monthly Changes report
        rep = (await db.execute(select(ChangeReport).where(ChangeReport.id == "rep_demo_showcase"))).scalars().first()
        if not rep:
            rep = ChangeReport(
                id="rep_demo_showcase",
                org_id=org_id,
                period="2026-10",
                row_count=18,
                summary={
                    "text": "18 changes at 14 followed companies.",
                    "companies": 14,
                    "total": 18,
                    "by_kind": {
                        "status_changed": 4,
                        "officer_appointed": 8,
                        "officer_resigned": 4,
                        "gazette_notice": 2,
                    },
                },
                created_at=datetime.utcnow(),
            )
            db.add(rep)
            print("[+] Seeded demo Monthly Changes report for October 2026.")

        await db.commit()

        print("\n" + "=" * 56)
        print(" DEMO ACCOUNT & SHOWCASE DATA READY")
        print("=" * 56)
        print(f" Username / Login: {username.lower()}")
        print(f" Password:         {password}")
        print(f" Dummy Email:      {email} (no real email required)")
        print(f" Organization:     {org.name} ({org_id})")
        print(f" Role:             Admin (all modules unlocked)")
        print(f" Must Change Pwd:  False (straight into dashboard)")
        print(f" Wallets:          500 credits per app")
        print(f" Sample Data:      Import & match + Needs review queue")
        print("=" * 56)


def main():
    parser = argparse.ArgumentParser(description="Create or reset demo credentials and showcase records.")
    parser.add_argument("--username", default=DEMO_USERNAME, help="Demo username (default: demo)")
    parser.add_argument("--password", default=DEMO_PASSWORD, help="Demo password")
    parser.add_argument("--name", default=DEMO_NAME, help="Display name")
    parser.add_argument("--email", default=DEMO_EMAIL, help="Demo email (dummy)")
    parser.add_argument("--org", default=DEFAULT_ORG_ID, help="Organization ID")
    args = parser.parse_args()

    asyncio.run(seed_demo(args.username, args.password, args.name, args.email, args.org))


if __name__ == "__main__":
    main()
