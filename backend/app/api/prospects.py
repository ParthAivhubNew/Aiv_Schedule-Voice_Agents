import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db
from app.models.models import Mission, Prospect, ContactRegistry
from app.schemas.schemas import ProspectSchema, ContactRegistrySchema

router = APIRouter(prefix="/prospects", tags=["Prospects"])


def _leadgen_mission_id() -> str:
    from app.core.tenancy import current_org

    # One per organisation, not one per search/import: Saved Accounts is a single flat list in
    # the UI, so everything Leadgen saves lands in the same mission. Deterministic id, not a
    # literal, since Mission.id is a primary key shared across every organisation's rows.
    return f"leadgen_{current_org()}"


def _prospect_json(p: Prospect) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "sector": p.sector,
        "region": p.region,
        "status": p.status,
        "fit": p.fit,
        "lastContact": p.last_contact,
        "contact": p.contact_person,
        "phone": p.phone,
        "site": p.site,
        "email": p.email,
        "openingHook": p.opening_hook,
        "channel": p.channel,
        "note": p.note,
    }

@router.get("", response_model=list[dict])
async def list_prospects(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Prospect))
    prospects = result.scalars().all()
    
    return [{
        "id": p.id,
        "name": p.name,
        "sector": p.sector,
        "region": p.region,
        "status": p.status,
        "fit": p.fit,
        "lastContact": p.last_contact,
        "contact": p.contact_person,
        "phone": p.phone,
        "site": p.site,
        "channel": p.channel,
        "note": p.note,
    } for p in prospects]

@router.get("/leadgen", response_model=list[dict])
async def list_leadgen_prospects(db: AsyncSession = Depends(get_db)):
    """Leadgen's Saved Accounts, for real: scoped to Leadgen's own mission so Voice's calling
    prospects (the plain GET /prospects above) never show up mixed in here, or the other way."""
    result = await db.execute(
        select(Prospect).where(Prospect.mission_id == _leadgen_mission_id()).order_by(Prospect.created_at.desc())
    )
    return [_prospect_json(p) for p in result.scalars().all()]


class LeadgenProspectsBody(BaseModel):
    leads: list[dict]


@router.post("/leadgen", response_model=dict)
async def save_leadgen_prospects(body: LeadgenProspectsBody, db: AsyncSession = Depends(get_db)):
    """Save Scout results or a CSV import for real, so they survive a refresh and the whole team
    sees them — previously this only ever lived in one browser tab's React state."""
    if not body.leads:
        raise HTTPException(status_code=400, detail="No leads to save.")
    mission_id = _leadgen_mission_id()
    mission = (await db.execute(select(Mission).where(Mission.id == mission_id))).scalars().first()
    if not mission:
        mission = Mission(id=mission_id, title="Leadgen Saved Accounts", sector="General",
                          region="Global", status="active", source="manual", default_channel="email")
        db.add(mission)
        await db.flush()
    created = []
    for r in body.leads:
        name = str(r.get("companyName") or r.get("name") or "").strip()
        if not name:
            continue
        try:
            fit = int(float(r.get("matchScore") if r.get("matchScore") is not None else r.get("fit") or 80))
        except (TypeError, ValueError):
            fit = 80
        p = Prospect(
            id=f"pr_{uuid.uuid4().hex[:12]}", mission_id=mission.id, name=name,
            sector=str(r.get("industry") or r.get("sector") or "General").strip() or "General",
            region=str(r.get("region") or "Global").strip() or "Global",
            status="queued", fit=max(0, min(100, fit)),
            contact_person=str(r.get("decisionMaker") or r.get("contactPerson") or "").strip() or "—",
            phone=str(r.get("phone") or "").strip(), site=str(r.get("website") or r.get("site") or "").strip(),
            email=str(r.get("email") or "").strip(), opening_hook=str(r.get("openingHook") or "").strip(),
            channel="email",
        )
        db.add(p)
        created.append(p)
    mission.total = (mission.total or 0) + len(created)
    await db.commit()
    return {"saved": len(created), "ids": [p.id for p in created]}


@router.get("/registry", response_model=list[dict])
async def list_registry(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ContactRegistry))
    registry = result.scalars().all()
    
    return [{
        "id": r.id,
        "canonicalName": r.canonical_name,
        "aliases": r.aliases or [],
        "phones": r.phones or [],
        "websites": r.websites or [],
        "region": r.region,
        "sector": r.sector,
        "people": r.people or [],
        "doNotCall": r.do_not_call,
        "lastOutcome": r.last_outcome,
        "lastContactAt": r.last_contact_at,
        "requestedFollowUp": r.requested_follow_up,
    } for r in registry]
