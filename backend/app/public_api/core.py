"""What every /v1 route shares: one error shape, safe retries, rate limits, an audit trail,
key scopes and free test mode. Routes in the public API use V1Route and never repeat this."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta
from typing import Any, Deque, Dict, Optional, Sequence, Tuple

from fastapi import HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy.exc import IntegrityError

from app.core.auth_middleware import current
from app.database import AsyncSessionLocal
from app.models.models import PublicApiAudit, PublicApiIdempotency

logger = logging.getLogger("public_api")

RATE_PER_MIN = int(os.getenv("PUBLIC_API_RATE_PER_MIN", "120"))
WRITE_PER_MIN = int(os.getenv("PUBLIC_API_WRITE_PER_MIN", "30"))
IDEMPOTENCY_TTL = timedelta(hours=24)
RUNNING_STALE = timedelta(minutes=2)

_DEFAULT_CODES = {
    400: "bad_request", 401: "unauthorized", 402: "payment_required", 403: "forbidden", 404: "not_found",
    405: "method_not_allowed", 409: "conflict", 410: "gone", 413: "too_large", 422: "invalid_request",
    429: "rate_limited", 500: "internal_error", 502: "upstream_error", 503: "unavailable",
}


class ApiError(Exception):
    """Raise this anywhere in a /v1 route; the caller sees the same error shape every time."""

    def __init__(self, status: int, code: str, message: str, details: Optional[Dict[str, Any]] = None,
                 headers: Optional[Dict[str, str]] = None):
        super().__init__(message)
        self.status, self.code, self.message, self.details, self.headers = status, code, message, details, headers or {}


def fail(status: int, code: str, message: str, **details: Any) -> None:
    raise ApiError(status, code, message, details or None)


def error_body(request_id: str, status: int, code: str, message: str, details: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    body: Dict[str, Any] = {"error": {"code": code, "message": message}, "request_id": request_id,
                            "detail": message}  # "detail" keeps older clients of this API working
    if details:
        body["error"]["details"] = details
    return body


# ── Keys, scopes, test mode ──────────────────────────────────────────────────
# A key made before the finer scopes existed keeps what it had.
LEGACY_SCOPES: Dict[str, Tuple[str, ...]] = {"social:publish": ("social:write", "social:approve")}


def has_scope(ctx: Dict[str, Any], needed: str) -> bool:
    scopes = set(ctx.get("scopes") or ["full_access"])
    if "full_access" in scopes or needed in scopes:
        return True
    return any(needed in LEGACY_SCOPES.get(s, ()) for s in scopes)


def is_test(ctx: Dict[str, Any]) -> bool:
    """A test key (sk_test_): everything is simulated, nothing real happens and nothing is charged."""
    return bool(ctx.get("test"))


async def authorize(request: Request, db, scope: str, service: Optional[str] = None) -> Dict[str, Any]:
    """The caller's context, after checking the key allows `scope` and the plan covers `service`."""
    from app.services.entitlement import require_service_entitlement

    ctx = current(request)
    if ctx.get("type") != "api_key" and not ctx.get("is_admin"):
        fail(403, "forbidden", "This API is for API keys.")
    if not has_scope(ctx, scope):
        fail(403, "missing_scope", f"Your API key does not have the '{scope}' permission.", scope=scope)
    if service and not is_test(ctx):
        try:
            await require_service_entitlement(db, ctx["org_id"], service)
        except HTTPException as err:
            d = err.detail if isinstance(err.detail, dict) else {}
            fail(402, "service_not_subscribed", d.get("message") or str(err.detail), service=d.get("service") or service)
    return ctx


# ── Pagination ───────────────────────────────────────────────────────────────
def page_args(limit: int = 20, cursor: str = "") -> Tuple[int, int]:
    """(limit, offset) from the query. The cursor is opaque to callers."""
    limit = max(1, min(int(limit or 20), 100))
    try:
        offset = int(base64.urlsafe_b64decode(cursor.encode()).decode()) if cursor else 0
    except Exception:
        fail(400, "bad_cursor", "That cursor is not valid. Start again without one.")
    return limit, max(0, offset)


def page_of(rows: Sequence[Any], limit: int, offset: int) -> Dict[str, Any]:
    """Wrap rows fetched with limit+1 as a page."""
    more = len(rows) > limit
    nxt = base64.urlsafe_b64encode(str(offset + limit).encode()).decode() if more else None
    return {"data": list(rows[:limit]), "next_cursor": nxt}


# ── Rate limits (per key, per minute; in memory) ─────────────────────────────
_WINDOWS: Dict[str, Deque[float]] = defaultdict(deque)


def check_rate(who: str, write: bool) -> Optional[int]:
    """Seconds to wait if this caller is over its limit, else None (and the request is counted)."""
    now = time.time()
    buckets = [(f"{who}:all", RATE_PER_MIN)] + ([(f"{who}:write", WRITE_PER_MIN)] if write else [])
    for name, limit in buckets:
        q = _WINDOWS[name]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= limit:
            return max(1, int(60 - (now - q[0])) + 1)
    for name, _ in buckets:
        _WINDOWS[name].append(now)
    return None


# ── Safe retries (Idempotency-Key) ───────────────────────────────────────────
async def _idem_begin(org: str, key: str, fingerprint: str) -> Tuple[str, Optional[Dict[str, Any]]]:
    """('new'|'replay'|'running'|'mismatch', stored answer)."""
    row_id = f"{org}:{key}"
    now = datetime.utcnow()
    async with AsyncSessionLocal() as db:
        row = await db.get(PublicApiIdempotency, row_id)
        if row and (row.created_at < now - IDEMPOTENCY_TTL or (row.state == "running" and row.created_at < now - RUNNING_STALE)):
            await db.delete(row)
            await db.flush()
            row = None
        if row:
            if row.fingerprint != fingerprint:
                return "mismatch", None
            if row.state == "done":
                return "replay", {"status": row.status_code, "body": row.body}
            return "running", None
        db.add(PublicApiIdempotency(id=row_id, key=key, fingerprint=fingerprint, state="running", created_at=now))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            return "running", None
    return "new", None


async def _idem_finish(org: str, key: str, status: int, body: Any, keep: bool) -> None:
    try:
        async with AsyncSessionLocal() as db:
            row = await db.get(PublicApiIdempotency, f"{org}:{key}")
            if not row:
                return
            if keep:
                row.state, row.status_code, row.body = "done", status, body
            else:  # a server failure is not remembered: the retry must really run
                await db.delete(row)
            await db.commit()
    except Exception as err:
        logger.warning(f"[public-api] idempotency save failed: {err}")


# ── Audit trail ──────────────────────────────────────────────────────────────
_TASKS: set = set()


def _later(coro) -> None:
    task = asyncio.get_running_loop().create_task(coro)
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)


async def _audit(org: str, key_id: str, request_id: str, method: str, path: str, status: int, ms: int, ip: str) -> None:
    try:
        async with AsyncSessionLocal() as db:
            db.add(PublicApiAudit(org_id=org, key_id=key_id, request_id=request_id, method=method, path=path[:300],
                                  status=status, ms=ms, ip=ip[:64]))
            await db.commit()
    except Exception as err:
        logger.debug(f"[public-api] audit skipped: {err}")


# ── The route class every /v1 route uses ─────────────────────────────────────
def _json_body(response: Response) -> Any:
    try:
        return json.loads(bytes(response.body))
    except Exception:
        return None


class V1Route(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            request_id = "req_" + uuid.uuid4().hex[:16]
            request.state.request_id = request_id
            started = time.perf_counter()
            ctx = getattr(request.state, "auth", None) or {}
            org = ctx.get("org_id") or ""
            who = ctx.get("key_id") or ctx.get("operator_id") or "anon"
            write = request.method not in ("GET", "HEAD", "OPTIONS")
            idem_key = (request.headers.get("idempotency-key") or "").strip()[:200] if write else ""
            idem = False
            response: Optional[Response] = None
            try:
                wait = check_rate(who, write)
                if wait:
                    raise ApiError(429, "rate_limited", "Too many requests. Slow down and try again shortly.",
                                   {"retry_after_seconds": wait}, {"Retry-After": str(wait)})
                if idem_key and org:
                    fingerprint = hashlib.sha256(
                        f"{request.method} {request.url.path}\n".encode() + await request.body()).hexdigest()
                    state, stored = await _idem_begin(org, idem_key, fingerprint)
                    if state == "mismatch":
                        raise ApiError(422, "idempotency_key_reused", "That Idempotency-Key was already used for a different request.")
                    if state == "running":
                        raise ApiError(409, "request_in_progress", "The first request with this Idempotency-Key is still running.",
                                       None, {"Retry-After": "2"})
                    if state == "replay":
                        response = JSONResponse(stored["body"], status_code=stored["status"], headers={"Idempotent-Replay": "true"})
                    else:
                        idem = True
                if response is None:
                    response = await original(request)
            except ApiError as err:
                response = JSONResponse(error_body(request_id, err.status, err.code, err.message, err.details),
                                        status_code=err.status, headers=err.headers)
            except RequestValidationError as err:
                fields = [{"field": ".".join(str(p) for p in e.get("loc", ()) if p != "body"), "problem": e.get("msg", "")}
                          for e in err.errors()]
                response = JSONResponse(error_body(request_id, 422, "invalid_request", "Some fields are missing or not valid.",
                                                   {"fields": fields}), status_code=422)
            except HTTPException as err:
                d = err.detail
                message = d.get("message") if isinstance(d, dict) and d.get("message") else (d if isinstance(d, str) else json.dumps(d))
                code = (d.get("error") if isinstance(d, dict) else None) or _DEFAULT_CODES.get(err.status_code, "error")
                response = JSONResponse(error_body(request_id, err.status_code, code, message), status_code=err.status_code,
                                        headers=dict(err.headers or {}))
            except Exception:
                logger.exception(f"[public-api] {request_id} {request.method} {request.url.path} failed")
                response = JSONResponse(error_body(request_id, 500, "internal_error",
                                                   "Something went wrong on our side. Quote this request_id if you contact us."),
                                        status_code=500)
            if idem:
                body = _json_body(response)
                await _idem_finish(org, idem_key, response.status_code, body, keep=response.status_code < 500 and body is not None)
            response.headers["X-Request-Id"] = request_id
            if org:
                ms = int((time.perf_counter() - started) * 1000)
                ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "")
                _later(_audit(org, ctx.get("key_id") or "", request_id, request.method, request.url.path, response.status_code, ms, ip))
            return response

        return handler
