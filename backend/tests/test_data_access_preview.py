"""The "What will they see?" button on Add user: there is no saved person yet, so it counts the areas typed, through POST /org/data-access/preview."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api import data_access as DAPI


def req(admin=True, kind="session"):
    return SimpleNamespace(state=SimpleNamespace(auth={"org_id": "org_f", "is_admin": admin, "type": kind}), headers={})


async def test_it_is_for_admins_only():
    for who in (req(admin=False), req(kind="api_key")):
        with pytest.raises(HTTPException) as err:
            await DAPI.preview_areas(DAPI.DraftAreas(districts=["BN1"]), who, None)
        assert err.value.status_code == 403


async def test_a_bad_area_is_a_400_not_a_count():
    with pytest.raises(HTTPException) as err:
        await DAPI.preview_areas(DAPI.DraftAreas(districts=["not an area"]), req(), None)
    assert err.value.status_code == 400


def test_the_route_is_a_post_so_an_empty_user_id_can_no_longer_reach_a_get_only_path():
    routes = {(m, r.path) for r in DAPI.router.routes for m in r.methods}
    assert ("POST", "/org/data-access/preview") in routes
    assert ("GET", "/org/data-access/{operator_id}/preview") in routes
