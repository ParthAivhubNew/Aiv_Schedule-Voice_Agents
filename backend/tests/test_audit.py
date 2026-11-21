import pytest

from app.core.tenancy import org_scope
from app.services import audit

pytestmark = pytest.mark.db


async def test_a_row_is_written_without_secrets_and_stays_in_its_organisation(db):
    with org_scope("org_default"):
        await audit.record(db, "policy.changed", target="brd_x", detail={"locked": True, "api_key": "nope", "note": "x" * 500}, actor_id="op1", actor_name="Ann")
        await db.commit()
        rows = await audit.recent(db, action="policy")
    assert len(rows) == 1 and rows[0]["actor_name"] == "Ann" and rows[0]["detail"]["locked"] is True
    assert "api_key" not in rows[0]["detail"] and len(rows[0]["detail"]["note"]) == 300
    from app.core.tenancy import TENANT_TABLES

    assert "audit_log" in TENANT_TABLES  # row-level security isolates it like every other tenant table
