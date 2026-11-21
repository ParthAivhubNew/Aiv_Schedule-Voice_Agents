"""scripts/seed_fsb_demo.py: seeds the sample import, report and list in the demo organisation only, safely and repeatably; --reset removes only its own rows."""
import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import text

from app.core.tenancy import org_scope
from app.models.models import BusinessRecord as B
from app.services import fsb_demo as D

pytestmark = pytest.mark.db
SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def load_script():
    import sys

    if str(SCRIPTS) not in sys.path:
        sys.path.append(str(SCRIPTS))
    spec = importlib.util.spec_from_file_location("seed_fsb_demo_under_test", SCRIPTS / "seed_fsb_demo.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


async def account():
    from app.database import engine

    async with engine.begin() as conn:
        await D.ensure_demo_account(conn)
    await D.ensure_demo_data()


async def count(db, table, org, where=""):
    """Rows of one organisation (the session only sees the organisation it is scoped to)."""
    with org_scope(org):
        n = (await db.execute(text(f"SELECT count(*) FROM {table} WHERE org_id = :o {where}"), {"o": org})).scalar()
        await db.rollback()
    return n


async def test_seed_on_a_database_with_bn_companies_makes_every_kind_of_row_and_reset_removes_only_its_own(db, monkeypatch):
    monkeypatch.delenv("FSB_DEMO_PASSWORD", raising=False)
    db.add_all([B(id=f"b{n}", identity_hash=f"h{n}", name=f"Sample Trading {n} Ltd" if n % 2 else f"Harbour Works {n} Limited", registration_number=f"0123{n:04d}",
                  postcode=f"BN{1 + n % 3} {n % 9}AA", address=f"{n} High Street, Brighton", status="Active" if n < 170 else "Dissolved",
                  company_category="Private limited Company", sic_codes="|43220|", sic_text="x", sources=[], rank_score=0, region="Brighton") for n in range(185)])
    await db.execute(text("INSERT INTO organizations (id, name, slug, status) VALUES ('org_other', 'Other', 'other', 'active')"))
    await db.commit()
    with org_scope("org_other"):
        await db.execute(text("INSERT INTO fsb_imports (id, org_id, filename, status, row_count) VALUES ('fsi_other', 'org_other', 'theirs.csv', 'done', 0)"))
        await db.commit()
    S = load_script()
    await account()
    out = await S.seed(D.ORG_ID)
    assert out["status"] == "done" and out["counts"]["auto"] > 0 and out["counts"]["none"] > 0 and sum(out["counts"].values()) > 100
    assert out["counts"]["review"] > 0
    assert out["report"]["period"] and out["list"]["name"] == "FSB prospects" and out["list"]["companies"] >= 1
    assert await count(db, "fsb_imports", D.ORG_ID) == 1 and await count(db, "change_reports", D.ORG_ID) == 1
    assert await count(db, "fsb_imports", "org_default") == 0 and await count(db, "lead_accounts", "org_default") == 0
    again = await S.seed(D.ORG_ID)  # nothing is added a second time
    assert again["import"] == "already there" and await count(db, "fsb_imports", D.ORG_ID) == 1
    rows_before = await count(db, "fsb_import_rows", D.ORG_ID)
    # something the person added themselves in the demo org must survive a reset
    with org_scope(D.ORG_ID):
        from app.database import AsyncSessionLocal
        from app.models.models import LeadAccount

        async with AsyncSessionLocal() as s:
            s.add(LeadAccount(id="la_mine", name="Added by hand", notes="mine"))
            await s.commit()
    gone = await S.reset(D.ORG_ID)
    assert gone["imports"] == 1 and gone["rows"] == rows_before and gone["lists"] == 1 and gone["accounts"] >= 1
    assert await count(db, "fsb_imports", D.ORG_ID) == 0 and await count(db, "fsb_import_rows", D.ORG_ID) == 0
    assert await count(db, "fsb_imports", "org_other") == 1  # another organisation is never touched
    assert await count(db, "lead_accounts", D.ORG_ID, "AND id = 'la_mine'") == 1
    await S.seed(D.ORG_ID)
    assert await count(db, "fsb_imports", D.ORG_ID) == 1


async def test_seed_without_register_data_uses_the_small_made_up_file(db, monkeypatch):
    monkeypatch.delenv("FSB_DEMO_PASSWORD", raising=False)
    S = load_script()
    await account()
    out = await S.seed(D.ORG_ID)
    assert out["status"] == "done" and sum(out["counts"].values()) == len(S.SYNTHETIC) and "synthetic" in out["import"]
    assert out["list"]["companies"] >= 1
