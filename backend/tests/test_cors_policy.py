"""Which web pages may call the API from a browser (core/cors.py): our own pages and trusted partners with credentials, public endpoints
from anywhere without credentials, every other page nothing."""
import httpx
import pytest
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.core import cors as CORS


def _app(dynamic=()):
    async def ok(request):
        return JSONResponse({"ok": True})

    inner = Starlette(routes=[Route("/api/leads/search", ok, methods=["GET", "POST"]), Route("/v1/leads", ok, methods=["GET", "POST"]),
                              Route("/api/f/abc", ok, methods=["POST"])])
    mw = CORS.OriginPolicyCORS(inner)
    mw._dynamic, mw._read_at = set(dynamic), 1e18  # partner and brand addresses as if just read; never read the database here
    return mw


async def call(app, method, path, origin, preflight=False):
    headers = {"Origin": origin} if origin else {}
    if preflight:
        headers.update({"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"})
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://outreach.aivhub.com") as c:
        return await c.request("OPTIONS" if preflight else method, path, headers=headers)


@pytest.fixture(autouse=True)
def own_address(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "PUBLIC_BASE_URL", "https://outreach.aivhub.com")
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://outreach.aivhub.com")
    monkeypatch.setenv("CORS_ORIGINS", "https://new.outreach.aivhub.com")


async def test_our_own_pages_get_credentialed_access():
    app = _app()
    for origin in ("https://outreach.aivhub.com", "https://new.outreach.aivhub.com", "http://localhost:5173"):
        r = await call(app, "GET", "/api/leads/search", origin)
        assert r.headers["access-control-allow-origin"] == origin and r.headers["access-control-allow-credentials"] == "true"
        pre = await call(app, "POST", "/api/leads/search", origin, preflight=True)
        assert pre.status_code == 200 and pre.headers["access-control-allow-origin"] == origin


async def test_another_website_gets_nothing_so_its_page_cannot_read_the_answer():
    app = _app()
    r = await call(app, "GET", "/api/leads/search", "https://evil.example")
    assert "access-control-allow-origin" not in r.headers and "access-control-allow-credentials" not in r.headers
    pre = await call(app, "POST", "/api/leads/search", "https://evil.example", preflight=True)
    assert "access-control-allow-origin" not in pre.headers


async def test_a_look_alike_address_is_not_trusted():
    app = _app()
    for origin in ("https://outreach.aivhub.com.evil.example", "http://outreach.aivhub.com", "https://evil-outreach.aivhub.com"):
        assert "access-control-allow-origin" not in (await call(app, "GET", "/api/leads/search", origin)).headers, origin


async def test_partner_and_brand_addresses_are_trusted():
    app = _app(dynamic={"https://app.partner.example", "https://leads.fsb.org.uk"})
    for origin in ("https://app.partner.example", "https://leads.fsb.org.uk"):
        r = await call(app, "GET", "/api/leads/search", origin)
        assert r.headers["access-control-allow-origin"] == origin and r.headers["access-control-allow-credentials"] == "true"


async def test_public_endpoints_answer_any_page_without_credentials():
    app = _app()
    for path in ("/v1/leads", "/api/f/abc"):
        r = await call(app, "POST", path, "https://customer-site.example")
        assert r.headers["access-control-allow-origin"] == "*" and "access-control-allow-credentials" not in r.headers, path
        pre = await call(app, "POST", path, "https://customer-site.example", preflight=True)
        assert pre.status_code == 200 and pre.headers["access-control-allow-origin"] == "*", path


async def test_our_extension_is_trusted_and_a_stranger_extension_is_not(monkeypatch):
    from app.services import partners

    monkeypatch.setattr(partners, "extension_ids", lambda: ["a" * 32])
    app = _app()
    ours = await call(app, "GET", "/api/leads/search", "chrome-extension://" + "a" * 32)
    assert ours.headers["access-control-allow-origin"] == "chrome-extension://" + "a" * 32
    other = await call(app, "GET", "/api/leads/search", "chrome-extension://" + "b" * 32)
    assert "access-control-allow-origin" not in other.headers


async def test_a_request_without_an_origin_is_untouched():
    r = await call(_app(), "GET", "/api/leads/search", "")
    assert r.status_code == 200 and "access-control-allow-origin" not in r.headers


async def test_a_failed_read_keeps_the_last_known_addresses(monkeypatch):
    app = _app(dynamic={"https://app.partner.example"})
    app._read_at = 0.0

    async def broken():
        raise RuntimeError("database away")

    monkeypatch.setattr(CORS, "_dynamic_origins", broken)
    assert await app.trusted_origin("https://app.partner.example")
    assert not await app.trusted_origin("https://evil.example")


def test_the_api_docs_are_off_unless_asked_for():
    import os

    import app.main as M

    if os.getenv("EXPOSE_API_DOCS") is None:
        assert M.app.docs_url is None and M.app.redoc_url is None and M.app.openapi_url is None
