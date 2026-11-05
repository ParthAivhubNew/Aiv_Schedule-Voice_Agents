"""The workspace screen: Leads, Voice and Social behind one sign-in. It reaches what those three screens reach together, and nothing of
the admin screen, the partner's console or staff routes."""
import pytest

from app.services import embed as EM
from tests.test_embed import _as, _link, _token, partner, quiet_limits, secret  # noqa: F401

pytestmark = pytest.mark.db

_SAMPLES = [("GET", "/leads/accounts"), ("POST", "/leads/lists"), ("POST", "/email/campaigns"), ("GET", "/journeys"), ("GET", "/calls"),
            ("POST", "/missions"), ("GET", "/numbers"), ("POST", "/human-calls/token"), ("POST", "/assistant/voice"), ("GET", "/scheduler/posts"),
            ("POST", "/scheduler/posts"), ("POST", "/assistant/social"), ("GET", "/profile/org"), ("GET", "/credits/wallet"), ("GET", "/connections")]
_NEVER = [("POST", "/auth/users"), ("POST", "/auth/share"), ("POST", "/developer/keys"), ("POST", "/billing/checkout"), ("PUT", "/credits/rates"),
          ("GET", "/partner/links"), ("POST", "/admin-api/partners"), ("POST", "/connections/telephony")]


def test_the_workspace_reaches_everything_its_three_apps_reach():
    ws = {"component": "workspace", "access": "full"}
    for component in ("leadgen", "voice", "social"):
        one = {"component": component, "access": "full"}
        for method, path in _SAMPLES:
            if EM.may_use(one, path, method):
                assert EM.may_use(ws, path, method), f"{component} can {method} {path} but the workspace cannot"


def test_the_workspace_reaches_nothing_an_admin_or_partner_console_holds():
    ws = {"component": "workspace", "access": "full"}
    for method, path in _NEVER:
        assert not EM.may_use(ws, path, method), f"workspace can {method} {path}"


def test_a_view_only_workspace_pass_cannot_change_anything():
    ws = {"component": "workspace", "access": "view"}
    assert EM.may_use(ws, "/leads/accounts", "GET") and not EM.may_use(ws, "/leads/lists", "POST") and not EM.may_use(ws, "/scheduler/posts", "POST")


def test_the_pass_for_the_partners_own_code_covers_the_three_apps_and_no_more():
    prefixes = EM.RUN_SCOPE_PREFIXES["workspace"]
    assert all(any(p.startswith(x) for p in prefixes) for x in ("leads:", "email:", "voice:", "social:"))
    assert not any(p.startswith(("admin", "team", "billing", "keys")) for p in prefixes)


async def test_one_workspace_pass_opens_all_three_apps_for_a_connected_person(anon, partner, secret):
    _, link_id = await _link(anon, partner)
    token = await _token(anon, secret, link_id, "workspace")
    me = await anon.get("/api/embed/session", headers=_as(token))
    assert me.status_code == 200 and me.json()["component"] == "workspace"
    for path in ("/api/leads/lists", "/api/calls", "/api/scheduler/posts"):
        assert (await anon.get(path, headers=_as(token))).status_code not in (401, 403), path
    for path in ("/api/auth/users", "/api/developer/keys", "/api/partner/links"):
        assert (await anon.get(path, headers=_as(token))).status_code in (401, 403), path
