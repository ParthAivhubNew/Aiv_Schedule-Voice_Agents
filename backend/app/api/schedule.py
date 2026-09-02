from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db
from app.models.models import ScheduleItem
from app.schemas.schemas import ScheduleItemSchema
from typing import Dict, Any
import uuid

router = APIRouter(prefix="/schedule", tags=["Schedule"])

@router.get("", response_model=list[dict])
async def list_schedule_items(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ScheduleItem).order_by(ScheduleItem.created_at.desc()))
    items = result.scalars().all()
    
    return [{
        "id": i.id,
        "day": i.day,
        "time": i.time,
        "prospect": i.prospect,
        "mission": i.mission,
        "window": i.window,
        "status": i.status,
        "honored": i.honored,
        "deferred": i.deferred,
        "honoredQuote": i.honored_quote,
    } for i in items]

@router.post("", response_model=dict)
async def create_schedule_item(req: ScheduleItemSchema, db: AsyncSession = Depends(get_db)):
    item = ScheduleItem(
        id=f"s_{uuid.uuid4().hex[:6]}",
        day=req.day,
        time=req.time,
        prospect=req.prospect,
        mission=req.mission,
        window=req.window,
        status=req.status,
        honored=req.honored,
        deferred=req.deferred,
        honored_quote=req.honored_quote,
    )
    db.add(item)
    await db.commit()
    return {"id": item.id, "status": "created"}
