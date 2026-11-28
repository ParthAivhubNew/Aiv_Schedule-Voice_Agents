"""Every role except Admin can be deleted by an admin, and a deleted starter role stays deleted (it used to come back whenever roles were read)."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import auth as AUTH
from app.core import accounts as ACC
from app.core.permissions import SYSTEM_ROLES


class _Res:
    def __init__(self, rows=None, scalar=0):
        self.rows, self._scalar = rows or [], scalar

    def scalars(self):
        return self

    def all(self):
        return self.rows

    def first(self):
        return self.rows[0] if self.rows else None

    def scalar(self):
        return self._scalar


class _Db:
    def __init__(self, *results):
        self.results, self.added, self.deleted, self.committed = list(results), [], [], False

    async def execute(self, stmt):
        return self.results.pop(0)

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass

    async def delete(self, obj):
        self.deleted.append(obj)

    async def commit(self):
        self.committed = True


def role(name, is_admin=False, is_system=True):
    return SimpleNamespace(id=f"role_{name.lower()}", org_id="org_x", name=name, is_admin=is_admin, is_system=is_system, is_active=True)


# ---- the starter roles ------------------------------------------------------------------------------
async def test_a_new_organisation_gets_every_starter_role():
    db = _Db(_Res([]))
    got = await ACC.ensure_system_roles(db, "org_new")
    assert set(got) == set(SYSTEM_ROLES) and len(db.added) == len(SYSTEM_ROLES)


async def test_a_deleted_starter_role_does_not_come_back():
    db = _Db(_Res([role("Admin", True), role("FSB Operator", False, False)]))
    got = await ACC.ensure_system_roles(db, "org_x")
    assert set(got) == {"Admin", "FSB Operator"} and db.added == []  # no Manager, Operator or Viewer made again


async def test_the_admin_role_is_always_kept_in_place():
    db = _Db(_Res([role("Analyst", False, False)]))
    got = await ACC.ensure_system_roles(db, "org_x")
    assert "Admin" in got and [r.name for r in db.added] == ["Admin"]


async def test_a_person_with_no_role_gets_the_role_their_label_names_not_operator():
    custom = role("FSB Operator", False, False)
    db = _Db(_Res([]), _Res([custom, role("Admin", True)]))  # roles_of is empty, then the organisation's roles
    op = SimpleNamespace(id="op1", org_id="org_x", role="fsb operator")
    await ACC.ensure_role_for(db, op)
    assert db.added and db.added[0].role_id == custom.id


async def test_with_no_operator_starter_role_a_person_with_no_role_gets_any_other_non_admin_role():
    custom = role("Analyst", False, False)
    db = _Db(_Res([]), _Res([role("Admin", True), custom]))
    await ACC.ensure_role_for(db, SimpleNamespace(id="op1", org_id="org_x", role="Operator"))
    assert db.added[0].role_id == custom.id


# ---- deleting ---------------------------------------------------------------------------------------
@pytest.fixture
def as_admin(monkeypatch):
    async def need(request):
        return {"org_id": "org_x", "operator_id": "op_boss", "name": "Boss", "is_admin": True}

    monkeypatch.setattr(AUTH, "_require_admin_or_team", need)


async def test_the_admin_role_cannot_be_deleted(as_admin):
    db = _Db(_Res([role("Admin", True)]))
    with pytest.raises(HTTPException) as err:
        await AUTH.delete_role("role_admin", None, db)
    assert err.value.status_code == 400 and "Admin role cannot be deleted" in err.value.detail and db.deleted == []


@pytest.mark.parametrize("name", ["Manager", "Operator", "Viewer"])
async def test_any_other_starter_role_can_be_deleted_when_nobody_has_it(as_admin, name):
    r = role(name)
    db = _Db(_Res([r]), _Res(scalar=0))
    assert (await AUTH.delete_role(r.id, None, db)) == {"ok": True} and db.deleted == [r] and db.committed


async def test_a_role_that_people_still_have_is_not_deleted(as_admin):
    r = role("Operator")
    db = _Db(_Res([r]), _Res(scalar=2))
    with pytest.raises(HTTPException) as err:
        await AUTH.delete_role(r.id, None, db)
    assert err.value.status_code == 400 and "2 user(s)" in err.value.detail and db.deleted == []


async def test_a_custom_role_can_be_deleted(as_admin):
    r = role("FSB Operator", False, False)
    db = _Db(_Res([r]), _Res(scalar=0))
    assert (await AUTH.delete_role(r.id, None, db)) == {"ok": True}
