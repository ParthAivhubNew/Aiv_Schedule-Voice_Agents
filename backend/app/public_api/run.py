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
        "call.summary": ("POST", "/voice/calls/{id}/summary", True),
        "script.get": ("GET", "/voice/scripts/{id}", True),
        "script.create": ("POST", "/voice/scripts", False),
        "script.edit": ("PATCH", "/voice/scripts/{id}", True),
        "script.delete": ("DELETE", "/voice/scripts/{id}", True),
        "voice.list": ("GET", "/voice/voices", False),
        "voice.use": ("POST", "/voice/voices/use", False),
        "scripts.list": ("GET", "/voice/scripts", False),
        "meeting.slots": ("GET", "/meetings/slots", False),
        "meeting.book": ("POST", "/meetings", False),
        "meeting.list": ("GET", "/meetings", False),
        "meeting.get": ("GET", "/meetings/{id}", True),
        "meeting.update": ("PATCH", "/meetings/{id}", True),
        "meeting_provider.list": ("GET", "/meetings/providers", False),
        "meeting_provider.connect": ("POST", "/meetings/providers/connect", False),
        "meeting_provider.disconnect": ("DELETE", "/meetings/providers/{id}", True),
    },
    "leads": {
        "search.create": ("POST", "/leads/searches", False),
        "search.get": ("GET", "/leads/searches/{id}", True),
        "lead.add": ("POST", "/leads", False),
        "lead.list": ("GET", "/leads", False),
        "list.list": ("GET", "/leads/lists", False),
        "list.create": ("POST", "/leads/lists", False),
        "list.edit": ("PATCH", "/leads/lists/{id}", True),
        "list.delete": ("DELETE", "/leads/lists/{id}", True),
        "company.contacts": ("POST", "/leads/companies/{id}/contacts", True),
        "email.find": ("POST", "/leads/email-find", False),
        "campaign.create": ("POST", "/email/campaigns", False),
        "campaign.get": ("GET", "/email/campaigns/{id}", True),
        "campaign.list": ("GET", "/email/campaigns", False),
        "campaign.edit": ("PATCH", "/email/campaigns/{id}", True),
        "campaign.decision": ("POST", "/email/campaigns/{id}/decision", True),
        "campaign.results": ("GET", "/email/campaigns/{id}/results", True),
        "reply.list": ("GET", "/email/replies", False),
        "reply.categorize": ("POST", "/email/replies/{id}/category", True),
        "suppression.list": ("GET", "/email/suppression", False),
        "suppression.add": ("POST", "/email/suppression", False),
        "suppression.remove": ("DELETE", "/email/suppression/{id}", True),
        "mailbox.list": ("GET", "/email/mailboxes", False),
        "mailbox.get": ("GET", "/email/mailboxes/{id}", True),
        "mailbox.connect": ("POST", "/email/mailboxes/connect", False),
        "mailbox.check_dns": ("POST", "/email/mailboxes/{id}/check", True),
        "mailbox.warmup": ("POST", "/email/mailboxes/{id}/warmup", True),
        "mailbox.disconnect": ("DELETE", "/email/mailboxes/{id}", True),
        "email.send": ("POST", "/email/send", False),
        "email.list": ("GET", "/email/messages", False),
        "email.get": ("GET", "/email/messages/{id}", True),
    },
    "social": {
        "post.create": ("POST", "/social/posts", False),
        "post.get": ("GET", "/social/posts/{id}", True),
        "post.list": ("GET", "/social/posts", False),
        "post.edit": ("PATCH", "/social/posts/{id}", True),
        "post.decision": ("POST", "/social/posts/{id}/decision", True),
        "media.upload": ("POST", "/social/media", False),
        "media.import_url": ("POST", "/social/media/import-url", False),
        "media.list": ("GET", "/social/media", False),
        "media.delete": ("DELETE", "/social/media/{id}", True),
        "plan.create": ("POST", "/social/plan", False),
        "plan.apply": ("POST", "/social/plan/apply", False),
        "insights.get": ("GET", "/social/insights", False),
        "post.results": ("GET", "/social/posts/{id}/results", True),
        "post.results_link": ("POST", "/social/posts/{id}/results/link", True),
        "report.list": ("GET", "/social/reports", False),
        "report.create": ("POST", "/social/reports", False),
        "report.link": ("POST", "/social/reports/{id}/link", True),
        "report.send": ("POST", "/social/reports/{id}/send", True),
        "report.delete": ("DELETE", "/social/reports/{id}", True),
        "channel.providers": ("GET", "/social/channels/providers", False),
        "channel.connect": ("POST", "/social/channels/connect", False),
        "channel.list": ("GET", "/social/channels", False),
        "channel.disconnect": ("DELETE", "/social/channels/{id}", True),
    },
    "whatsapp": {
        "numbers": ("GET", "/whatsapp/numbers", False),
        "threads.list": ("GET", "/whatsapp/threads", False),
        "threads.get": ("GET", "/whatsapp/threads/{id}", True),
        "threads.send": ("POST", "/whatsapp/threads/{id}/send", True),
        "threads.start": ("POST", "/whatsapp/threads", False),
    },
    "account": {
        "wallet": ("GET", "/wallets", False),
        "profile.get": ("GET", "/company/profile", False),
        "profile.update": ("PATCH", "/company/profile", False),
        "services.get": ("GET", "/company/services", False),
        "services.set": ("PUT", "/company/services", False),
        "faqs.get": ("GET", "/company/faqs", False),
        "faqs.set": ("PUT", "/company/faqs", False),
    },
}
# Mail, auth and numbers have no URL of their own: their actions are done right here (see _mail, _auth, _numbers), under the
# same rules as the calls above.
PLUGINS = [*ACTIONS, "mail", "auth", "numbers"]

_ENVELOPE = {"plugin", "action", "id", "data"}
_PASS_HEADERS = ("authorization", "idempotency-key", "x-forwarded-for", "user-agent")
_BACK_HEADERS = ("x-request-id", "idempotent-replay", "retry-after", "accept-ranges", "content-disposition", "content-range")


def _refuse(status: int, code: str, message: str, **details: Any) -> JSONResponse:
    request_id = "req_" + uuid.uuid4().hex[:16]
    return JSONResponse(error_body(request_id, status, code, message, details or None), status_code=status,
                        headers={"X-Request-Id": request_id})


def _choices() -> Dict[str, Any]:
    return {p: sorted(a) for p, a in ACTIONS.items()}


async def _mail(request: Request, action: Any, id_: Any, data: Any, query: bool) -> Response:
    """Mail actions are done here, not forwarded: there is no separate mail URL. The same rules apply as for every call."""
    from app.database import AsyncSessionLocal
    from app.public_api import mail as M
    from app.public_api.core import under_shared_rules

    if not isinstance(action, str) or action not in M.ACTIONS:
        return _refuse(422, "unknown_action", f"'{action}' is not an action of 'mail'. Use one of: " + ", ".join(sorted(M.ACTIONS)) + ".",
                       plugin="mail", actions=sorted(M.ACTIONS))
    if query and M.ACTIONS[action]["scope"] != M.READ:
        return _refuse(405, "read_only", f"'mail.{action}' changes something, so send it as POST /v1/run, not GET.", plugin="mail", action=action)
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return _refuse(422, "invalid_request", "'data' must be an object.")
    if id_ is not None and not isinstance(id_, str):
        return _refuse(422, "invalid_request", "'id' must be text.")
    if query:  # a link carries text only
        data = {k: ({"true": True, "false": False}.get(v, v) if isinstance(v, str) else v) for k, v in data.items()}

    async def call() -> Response:
        async with AsyncSessionLocal() as db:
            return JSONResponse(await M.handle(request, db, M.MailIn(action=action, id=(id_ or None), data=data)))

    out = await under_shared_rules(request, call)
    out.headers["X-Outreach-Action"] = f"mail.{action}"
    return out


async def _auth(request: Request, action: Any, data: Any, query: bool) -> Response:
    """Sign-up and login for a partner's own pages (public_api/partner_auth.py). Never a link: it carries passwords."""
    from app.database import AsyncSessionLocal
    from app.public_api import partner_auth as PA
    from app.public_api.core import under_shared_rules

    if not isinstance(action, str) or action not in PA.ACTIONS:
        return _refuse(422, "unknown_action", f"'{action}' is not an action of 'auth'. Use one of: " + ", ".join(PA.ACTIONS) + ".",
                       plugin="auth", actions=list(PA.ACTIONS))
    if query:
        return _refuse(405, "post_only", f"'auth.{action}' must be sent as POST /v1/run.", plugin="auth", action=action)
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return _refuse(422, "invalid_request", "'data' must be an object.")

    async def call() -> Response:
        async with AsyncSessionLocal() as db:
            return JSONResponse(await PA.handle(request, db, action, data), headers={"Cache-Control": "no-store"})

    out = await under_shared_rules(request, call)
    out.headers["X-Outreach-Action"] = f"auth.{action}"
    return out


async def _numbers(request: Request, action: Any, id_: Any, data: Any, query: bool) -> Response:
    """Phone numbers (public_api/numbers.py): the same code as the Numbers screen, under the same rules as every call."""
    from app.database import AsyncSessionLocal
    from app.public_api import numbers as NU
    from app.public_api.core import under_shared_rules

    if not isinstance(action, str) or action not in NU.ACTIONS:
        return _refuse(422, "unknown_action", f"'{action}' is not an action of 'numbers'. Use one of: " + ", ".join(NU.ACTIONS) + ".",
                       plugin="numbers", actions=list(NU.ACTIONS))
    if query and action not in ("list", "search", "verification.requirements", "verification.status"):  # "connect" changes something
        return _refuse(405, "read_only", f"'numbers.{action}' changes something, so send it as POST /v1/run, not GET.", plugin="numbers", action=action)
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return _refuse(422, "invalid_request", "'data' must be an object.")
    if id_ is not None and not isinstance(id_, str):
        return _refuse(422, "invalid_request", "'id' must be text.")

    async def call() -> Response:
        async with AsyncSessionLocal() as db:
            return JSONResponse(await NU.handle(request, db, action, (id_ or "").strip(), data))

    out = await under_shared_rules(request, call)
    out.headers["X-Outreach-Action"] = f"numbers.{action}"
    return out


async def _dispatch(request: Request, plugin: Any, action: Any, id_: Any, data: Any, query: bool) -> Response:
    if not isinstance(plugin, str) or plugin not in PLUGINS:
        return _refuse(422, "unknown_plugin", "'plugin' must be one of: " + ", ".join(PLUGINS) + ".", plugins=list(PLUGINS))
    if plugin == "mail":
        return await _mail(request, action, id_, data, query)
    if plugin == "auth":
        return await _auth(request, action, data, query)
    if plugin == "numbers":
        return await _numbers(request, action, id_, data, query)
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
    """Send `{plugin, action, id?, data?}`. `plugin` is voice, leads, social, mail or account; `action` is the step."""
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
