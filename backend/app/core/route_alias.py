"""Moving routes to a new path without breaking callers (plan 12, B5): the "/fsb/..." record-matching routes are general features now
(Import & match, the Salesforce update file), so they are also served at "/records/...". The old paths stay for one release."""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.routing import APIRoute


def add_aliases(router: APIRouter, old: str = "/fsb/", new: str = "/records/") -> int:
    """Serve every route under `old` at `new` too, with the same endpoint, methods and settings. Returns how many were added."""
    added = 0
    for route in list(router.routes):
        if isinstance(route, APIRoute) and route.path.startswith(old):
            router.add_api_route(new + route.path[len(old):], route.endpoint, methods=sorted(route.methods), name=f"{route.name}_records",
                                 response_model=route.response_model, status_code=route.status_code, summary=route.summary,
                                 description=route.description, dependencies=route.dependencies, response_class=route.response_class)
            added += 1
    return added
