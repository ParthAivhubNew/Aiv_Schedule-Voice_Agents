"""What the AI may say about the business, in the public API: the company profile, its services and its FAQs.

The same record the app's "About your business" screen edits. A key needs permission for any one of Voice, Leads or Social
(`company:write` comes with each of them); a test key reads and writes nothing real.
"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.public_api.core import V1Route, authorize, fail, is_test

router = APIRouter(prefix="/company", tags=["Company"], route_class=V1Route)

SCOPE = "company:write"
MAX_ITEMS = 100
# What a partner may change. The caller ID is left out: it rewires the user's telephony setup.
PROFILE_FIELDS = ("name", "spokenName", "callerName", "pitch", "industry", "website", "social", "tone", "disclosure", "legalName", "icoRef",
                  "dpoContact", "dncNotes", "timezone", "weekStart", "timeFormat", "approverEmails", "lunchStart", "lunchEnd",
                  "callHoursPolicy", "weekdayStart", "weekdayEnd", "callOpener", "callHook", "closingAsk", "customRules", "demoScript")
TEST_PROFILE = {"name": "Test company", "pitch": "", "industry": "", "website": "", "timezone": "Europe/London", "weekStart": "monday", "timeFormat": "24h"}


class ServiceIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    desc: str = Field("", max_length=2000)
    ideal: str = Field("", max_length=1000, description="Who it suits")


class ServicesIn(BaseModel):
    services: List[ServiceIn] = Field(default_factory=list, max_length=MAX_ITEMS)


class FaqIn(BaseModel):
    q: str = Field(..., min_length=1, max_length=500)
    a: str = Field(..., min_length=1, max_length=4000)


class FaqsIn(BaseModel):
    faqs: List[FaqIn] = Field(default_factory=list, max_length=MAX_ITEMS)


@router.get("/profile")
async def profile_get(request: Request, db: AsyncSession = Depends(get_db)):
    """The company profile: name, pitch, tone, time zone, calling hours and what the AI says on calls."""
    from app.api.profile import get_profile

    ctx = await authorize(request, db, SCOPE)
    if is_test(ctx):
        return {**TEST_PROFILE, "simulated": True}
    return await get_profile(db)


@router.patch("/profile")
async def profile_update(body: Dict[str, Any], request: Request, db: AsyncSession = Depends(get_db)):
    """Change some profile fields. Send only the ones to change; unknown fields are refused."""
    from app.api.profile import get_profile, update_profile

    ctx = await authorize(request, db, SCOPE)
    unknown = [k for k in body if k not in PROFILE_FIELDS]
    if unknown:
        fail(422, "unknown_field", f"These fields cannot be changed here: {', '.join(unknown)}.", allowed=list(PROFILE_FIELDS))
    if is_test(ctx):
        return {**TEST_PROFILE, **body, "simulated": True}
    try:
        await update_profile(body, db)
    except HTTPException as err:
        await db.rollback()
        fail(422, "invalid_profile", str(err.detail))
    return await get_profile(db)


@router.get("/services")
async def services_get(request: Request, db: AsyncSession = Depends(get_db)):
    from app.api.profile import list_services

    ctx = await authorize(request, db, SCOPE)
    if is_test(ctx):
        return {"services": [], "simulated": True}
    return {"services": await list_services(db)}


@router.put("/services")
async def services_set(body: ServicesIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Replace the whole list of services the AI can talk about."""
    from app.api.profile import list_services, save_services

    ctx = await authorize(request, db, SCOPE)
    if is_test(ctx):
        return {"services": [s.model_dump() for s in body.services], "simulated": True}
    await save_services({"services": [s.model_dump() for s in body.services]}, db)
    return {"services": await list_services(db)}


@router.get("/faqs")
async def faqs_get(request: Request, db: AsyncSession = Depends(get_db)):
    from app.api.profile import list_faqs

    ctx = await authorize(request, db, SCOPE)
    if is_test(ctx):
        return {"faqs": [], "simulated": True}
    return {"faqs": await list_faqs(db)}


@router.put("/faqs")
async def faqs_set(body: FaqsIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Replace the whole list of questions and answers the AI can use."""
    from app.api.profile import list_faqs, save_faqs

    ctx = await authorize(request, db, SCOPE)
    if is_test(ctx):
        return {"faqs": [f.model_dump() for f in body.faqs], "simulated": True}
    await save_faqs({"faqs": [f.model_dump() for f in body.faqs]}, db)
    return {"faqs": await list_faqs(db)}
