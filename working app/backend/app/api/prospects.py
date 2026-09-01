from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db
from app.models.models import Prospect, ContactRegistry
from app.schemas.schemas import ProspectSchema, ContactRegistrySchema

router = APIRouter(prefix="/prospects", tags=["Prospects"])

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
