"""The public API's surface is small, matches the documentation, and every route follows the same rules."""
import re
from pathlib import Path

CATALOGUE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "settings" / "developerCatalog.js"
SUPPLIERS = re.compile(r"\b(telnyx|twilio|vonage|xai|grok|openai|deepgram|cartesia|eleven ?labs|livekit|anthropic|deepseek|groq|vapi|retell)\b", re.I)


def _v1_routes():
    """(method, path) of every public call, as the app publishes them."""
    from app.main import app

    found = set()
    for path, ops in app.openapi()["paths"].items():
        if re.match(r"^/v1(/|$)", path):
            for method in ops:
                found.add((method.upper(), path))
    return found


def _leaf_routes(routes):
    """Every real route under a router (this FastAPI nests included routers lazily)."""
    for route in routes:
        inner = getattr(route, "original_router", None)
        if inner is not None:
            yield from _leaf_routes(inner.routes)
        else:
            yield route


def _documented():
    text = CATALOGUE.read_text(encoding="utf-8")
    pairs = re.findall(r'method: "([A-Z]+)", path: "(/v1[^"?]*)[^"]*"', text)
    return {(m, p) for m, p in pairs}


def test_every_documented_call_exists_and_every_call_is_documented():
    routes = _v1_routes()
    docs = _documented()
    assert docs, "the catalogue could not be read"
    # The docs name the id {id} everywhere; the code names it after what it is.
    normal = lambda p: re.sub(r"\{[a-z_]+\}", "{id}", p)  # noqa: E731
    routes = {(m, normal(p)) for m, p in routes}
    docs = {(m, normal(p)) for m, p in docs}
    assert docs - routes == set(), "documented but not in the API"
    # POST /v1/run (and its read-only link form) is the front door to all of them, described in the docs' opening text.
    assert routes - docs - {("GET", "/v1/run"), ("POST", "/v1/run")} == set(), "in the API but not documented"


def test_the_surface_is_small():
    # The first plan was about two dozen calls. Partners then needed to connect accounts, read results and manage lists, scripts,
    # WhatsApp and company knowledge themselves, so the surface grew on purpose: grow it again only with the same reason.
    assert 25 <= len(_v1_routes()) <= 95


def test_the_public_api_never_names_a_supplier_in_its_own_text():
    from app.main import app

    for path, ops in app.openapi()["paths"].items():
        if path.startswith("/v1"):
            assert not SUPPLIERS.search(str(ops)), path
    root = Path(__file__).resolve().parents[1] / "app" / "public_api"
    for file in root.glob("*.py"):
        for number, line in enumerate(file.read_text(encoding="utf-8").splitlines(), 1):
            if "import" in line or "logger" in line or line.strip().startswith("#"):
                continue
            for q in re.findall(r'"([^"]{12,})"', line):  # words a customer can read
                if " " in q and SUPPLIERS.search(q):
                    raise AssertionError(f"{file.name}:{number} names a supplier in customer-facing text: {q}")


def test_every_route_uses_the_shared_rules():
    from fastapi.routing import APIRoute

    from app.api.v1_public import router
    from app.public_api.core import V1Route

    leaves = [r for r in _leaf_routes(router.routes) if isinstance(r, APIRoute)]
    assert len(leaves) >= 25
    for route in leaves:
        if route.path == "/run":  # the front door only hands each request to a route that does follow the shared rules
            continue
        assert isinstance(route, V1Route), f"{route.path} skips the shared error shape, retries, limits and audit trail"
