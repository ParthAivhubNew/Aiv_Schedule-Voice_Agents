"""Connect Google Meet / Microsoft Teams / Zoom so scheduled video meetings get a real room."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services import meeting_rooms as MR

router = APIRouter(prefix="/meeting-links", tags=["Meeting links"])


def _check(provider: str) -> str:
    if provider not in MR.PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown meeting provider.")
    return provider


@router.get("/status")
async def meeting_link_status(db: AsyncSession = Depends(get_db)):
    return await MR.status(db)


@router.get("/{provider}/start")
async def meeting_link_start(provider: str, frontend: Optional[str] = None):
    res = await MR.start(_check(provider), frontend or "")
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error") or "Could not start sign-in.")
    return res


@router.get("/{provider}/callback")
async def meeting_link_callback(
    provider: str,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    error_description: Optional[str] = None,
):
    from app.services.social_oauth import partner_callback_html

    provider = _check(provider)
    back = MR.state_return(state or "")

    def _partner(ok: bool, account: str = "", why: str = "") -> HTMLResponse:
        return HTMLResponse(partner_callback_html(ok, provider, back, channel_id=account, error=why, kind="meeting_provider", id_name="account"))

    if error:
        return _partner(False, why=error_description or error) if back else HTMLResponse(MR.callback_html(False, provider, error=error_description or error))
    if not code or not state:
        return HTMLResponse(MR.callback_html(False, provider, error="Missing sign-in details. Click Connect again."))
    try:
        res = await MR.finish(provider, code, state)
    except Exception as err:
        return _partner(False, why=str(err)) if back else HTMLResponse(MR.callback_html(False, provider, error=str(err)))
    if back:
        if res.get("ok"):
            from app.services.webhook_dispatcher import dispatch_event

            dispatch_event(res.get("org") or "", "meeting.provider.connected", {"provider": provider, "account": res.get("account") or "", "org_id": res.get("org") or ""})
        return _partner(bool(res.get("ok")), res.get("account") or "", res.get("error") or "")
    return HTMLResponse(MR.callback_html(bool(res.get("ok")), provider, account=res.get("account") or "", error=res.get("error") or ""))


@router.delete("/{provider}")
async def meeting_link_disconnect(provider: str, db: AsyncSession = Depends(get_db)):
    return {"ok": await MR.disconnect(db, _check(provider))}
