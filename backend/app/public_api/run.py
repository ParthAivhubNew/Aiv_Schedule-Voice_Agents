"""The one front door: POST /v1/run  {"plugin": "voice", "action": "call.start", "id": "...", "data": {...}}.

Each (plugin, action) is one of the public calls. This module only translates the request into that call and hands it
to the same route, so permissions, plans, credits, approvals, safe retries, rate limits, audit and test mode behave
exactly as they do on the separate URLs. Nothing about what a call does lives here."""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, Optional, Tuple

import httpx
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from app.public_api.core import error_body

logger = logging.getLogger("public_api")
router = APIRouter(tags=["One endpoint"])

# plugin -> action -> (method, path under /v1, needs an id)
ACTIONS: Dict[str, Dict[str, Tuple[str, str, bool]]] = {
    "voice": {
        "call.start": ("POST", "/voice/calls", False),
        "call.get": ("GET", "/voice/calls/{id}", True),
        "call.list": ("GET", "/voice/calls", False),
        "call.hangup": ("DELETE", "/voice/calls/{id}", True),
        "call.control": ("POST", "/voice/calls/{id}/control", True),
        "call.recording": ("GET", "/voice/calls/{id}/recording", True),
        "scripts.list": ("GET", "/voice/scripts", False),
        "meeting.slots": ("GET", "/meetings/slots", False),
        "meeting.book": ("POST", "/meetings", False),
        "meeting.list": ("GET", "/meetings", False),
        "meeting.get": ("GET", "/meetings/{id}", True),
        "meeting.update": ("PATCH", "/meetings/{id}", True),
    },
    "leads": {
        "search.create": ("POST", "/leads/searches", False),
        "search.get": ("GET", "/leads/searches/{id}", True),
        "lead.add": ("POST", "/leads", False),
        "lead.list": ("GET", "/leads", False),
        "campaign.create": ("POST", "/email/campaigns", False),
        "campaign.get": ("GET", "/email/campaigns/{id}", True),
        "campaign.list": ("GET", "/email/campaigns", False),
        "campaign.edit": ("PATCH", "/email/campaigns/{id}", True),
        "campaign.decision": ("POST", "/email/campaigns/{id}/decision", True),
    },
    "social": {
        "post.create": ("POST", "/social/posts", False),
        "post.get": ("GET", "/social/posts/{id}", True),
        "post.list": ("GET", "/social/posts", False),
        "post.edit": ("PATCH", "/social/posts/{id}", True),
        "post.decision": ("POST", "/social/posts/{id}/decision", True),
    },
    "account": {
        "wallet": ("GET", "/wallets", False),
    },
}

_ENVELOPE = {"plugin", "action", "id", "data"}
_PASS_HEADERS = ("authorization", "idempotency-key", "x-forwarded-for", "user-agent")
_BACK_HEADERS = ("x-request-id", "idempotent-replay", "retry-after", "accept-ranges", "content-disposition", "content-range")


def _refuse(status: int, code: str, message: str, **details: Any) -> JSONResponse:
    request_id = "req_" + uuid.uuid4().hex[:16]
    return JSONResponse(error_body(request_id, status, code, message, details or None), status_code=status,
                        headers={"X-Request-Id": request_id})


def _choices() -> Dict[str, Any]:
    return {p: sorted(a) for p, a in ACTIONS.items()}


async def _dispatch(request: Request, plugin: Any, action: Any, id_: Any, data: Any, query: bool) -> Response:
    if not isinstance(plugin, str) or plugin not in ACTIONS:
        return _refuse(422, "unknown_plugin", "'plugin' must be one of: " + ", ".join(ACTIONS) + ".", plugins=list(ACTIONS))
    if not isinstance(action, str) or action not in ACTIONS[plugin]:
        return _refuse(422, "unknown_action", f"'{action}' is not an action of '{plugin}'. Use one of: "
                       + ", ".join(sorted(ACTIONS[plugin])) + ".", plugin=plugin, actions=sorted(ACTIONS[plugin]))
    method, path, needs_id = ACTIONS[plugin][action]
    if query and method != "GET":
        return _refuse(405, "read_only", f"'{plugin}.{action}' changes something, so send it as POST /v1/run, not GET.",
                       plugin=plugin, action=action)
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return _refuse(422, "invalid_request", "'data' must be an object.")
    if needs_id:
        if not isinstance(id_, str) or not id_.strip() or "/" in id_ or "?" in id_:
            return _refuse(422, "id_required", f"'{plugin}.{action}' needs the 'id' of the thing you are working on.",
                           plugin=plugin, action=action)
        path = path.replace("{id}", id_.strip())
    elif id_ not in (None, ""):
        return _refuse(422, "id_not_used", f"'{plugin}.{action}' does not take an 'id'.", plugin=plugin, action=action)

    headers = {h: request.headers[h] for h in _PASS_HEADERS if h in request.headers}
    kwargs: Dict[str, Any] = {}
    if method == "GET":
        kwargs["params"] = {k: v for k, v in data.items() if v is not None}
    elif method != "DELETE" and data:
        kwargs["json"] = data
    elif method == "POST":
        kwargs["json"] = {}
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=request.app), base_url="http://internal") as client:
            inner = await client.request(method, "/v1" + path, headers=headers, timeout=120, **kwargs)
    except Exception:
        logger.exception(f"[public-api] /v1/run {plugin}.{action} failed")
        return _refuse(500, "internal_error", "Something went wrong on our side.")
    out = Response(content=inner.content, status_code=inner.status_code, media_type=inner.headers.get("content-type"))
    for h in _BACK_HEADERS:
        if h in inner.headers:
            out.headers[h] = inner.headers[h]
    out.headers["X-Outreach-Action"] = f"{plugin}.{action}"
    logger.info(f"[public-api] run {plugin}.{action} -> {inner.status_code}")
    return out


@router.post("/run", summary="Do anything: pick a plugin and an action")
async def run_post(request: Request) -> Response:
    """Send `{plugin, action, id?, data?}`. `plugin` is voice, leads, social or account; `action` is the step."""
    try:
        body = json.loads((await request.body()) or b"{}")
    except Exception:
        return _refuse(400, "bad_json", "The request body is not valid JSON.")
    if not isinstance(body, dict):
        return _refuse(422, "invalid_request", "The request must be a JSON object with 'plugin' and 'action'.")
    extra = sorted(set(body) - _ENVELOPE)
    if extra:
        return _refuse(422, "unknown_field", "Put the details of the call inside 'data'. Unknown top-level field(s): "
                       + ", ".join(extra) + ".", fields=extra, allowed=sorted(_ENVELOPE))
    return await _dispatch(request, body.get("plugin"), body.get("action"), body.get("id"), body.get("data"), query=False)


@router.get("/run", summary="Read-only actions as a link")
async def run_get(request: Request) -> Response:
    """Same as POST /v1/run for actions that only read: /v1/run?plugin=voice&action=call.get&id=call_123."""
    q = dict(request.query_params.multi_items())
    plugin, action, id_ = q.pop("plugin", None), q.pop("action", None), q.pop("id", None)
    return await _dispatch(request, plugin, action, id_, q, query=True)


def catalogue() -> Dict[str, Any]:
    """Every plugin and action, for the docs and for the guard test."""
    return _choices()
