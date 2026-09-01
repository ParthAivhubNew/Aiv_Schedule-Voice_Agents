from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from app.database import get_db
from app.models.models import Mission, Prospect, LiveCall, Notification, ContactRegistry
from app.schemas.schemas import MissionCreateRequest, MissionResponse
from app.services.compliance import compute_queue_estimate
from app.services.identity import find_identity_match, normalize_phone_digits
from app.services.call_simulator import generate_call_scenario
from app.websockets.call_hub import call_hub
import uuid
import json
import io
import pandas as pd

router = APIRouter(prefix="/missions", tags=["Missions"])

@router.get("", response_model=list[dict])
async def list_missions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Mission).options(selectinload(Mission.prospects)))
    missions = result.scalars().all()
    
    out = []
    for m in missions:
        prospects_list = []
        for p in m.prospects:
            prospects_list.append({
                "id": p.id,
                "name": p.name,
                "status": p.status,
                "note": p.note,
                "time": p.time_status,
                "phone": p.phone,
                "channel": p.channel,
                "site": p.site,
                "contact": p.contact_person
            })
            
        out.append({
            "id": m.id,
            "title": m.title,
            "sector": m.sector,
            "region": m.region,
            "status": m.status,
            "contacted": m.contacted,
            "total": m.total,
            "meetingsBooked": m.meetings_booked,
            "created": m.created,
            "source": m.source,
            "concurrency": m.concurrency,
            "queueEstimate": m.queue_estimate,
            "callWindow": m.call_window,
            "timezone": m.timezone,
            "lunchStart": m.lunch_start,
            "lunchEnd": m.lunch_end,
            "noAnswerFallbacks": m.no_answer_fallbacks or [],
            "defaultChannel": m.default_channel,
            "prospects": prospects_list
        })
    return out

@router.post("", response_model=dict)
async def create_mission(req: MissionCreateRequest, db: AsyncSession = Depends(get_db)):
    mission_id = f"m_{uuid.uuid4().hex[:6]}"
    
    # 1. Fetch registry for deduplication check
    reg_res = await db.execute(select(ContactRegistry))
    reg_list = [r.__dict__ for r in reg_res.scalars().all()]
    
    # 2. Prepare prospects
    prospects_to_add = []
    prospects_raw = req.prospects
    
    if not prospects_raw:
        # If source is discover, generate targeted sample companies based on prompt/sector
        sector = req.sector or "Logistics"
        region = req.region or "Manchester"
        sample_names = [
            f"{region} {sector} Direct Ltd",
            f"Premier {sector} Express",
            f"Nexus {region} Services",
            f"Apex {sector} Group",
            f"Vanguard {sector} UK"
        ]
        for name in sample_names:
            prospects_raw.append({
                "name": name,
                "sector": sector,
                "region": region,
                "phone": "+44 161 496 0" + str(uuid.uuid4().int)[:3],
                "channel": req.default_channel,
            })

    total = len(prospects_raw)
    concurrency = max(1, req.concurrency)
    
    # Compute queue estimate
    queue_est = compute_queue_estimate(
        total_companies=total,
        concurrency=concurrency,
        window_start=req.call_window.split("–")[0].strip() if "–" in req.call_window else "09:00",
        window_end=req.call_window.split("–")[1].strip() if "–" in req.call_window else "17:30",
        lunch_start=req.lunch_start,
        lunch_end=req.lunch_end
    )
    
    mission = Mission(
        id=mission_id,
        title=req.title,
        sector=req.sector or "General",
        region=req.region or "UK-wide",
        status="active",
        contacted=0,
        total=total,
        meetings_booked=0,
        created="Today",
        source=req.source,
        concurrency=concurrency,
        queue_estimate=queue_est,
        call_window=req.call_window,
        timezone=req.timezone,
        lunch_start=req.lunch_start,
        lunch_end=req.lunch_end,
        no_answer_fallbacks=req.no_answer_fallbacks,
        default_channel=req.default_channel,
    )
    db.add(mission)
    
    # 3. Create prospects and activate first N (concurrency) as calling
    for i, p_data in enumerate(prospects_raw):
        p_id = f"p_{uuid.uuid4().hex[:6]}"
        is_calling = i < concurrency
        p_name = p_data.get("name", "Unnamed Prospect")
        
        match = find_identity_match(
            target_name=p_name,
            target_phone=p_data.get("phone", ""),
            registry_list=reg_list
        )
        
        status = "calling" if is_calling else "queued"
        time_status = "now" if is_calling else "waiting"
        note = "Calling now — negotiating with contact" if is_calling else "Not yet contacted — next in queue"
        
        prospect = Prospect(
            id=p_id,
            mission_id=mission_id,
            registry_id=match.get("registryId") if match else None,
            name=p_name,
            sector=p_data.get("sector") or req.sector or "General",
            region=p_data.get("region") or req.region or "UK-wide",
            status=status,
            fit=p_data.get("fit", 85),
            contact_person=p_data.get("contact", "—"),
            phone=p_data.get("phone", ""),
            site=p_data.get("website") or p_data.get("site", ""),
            channel=p_data.get("channel") or req.default_channel,
            fallback_channel=p_data.get("fallback_channel"),
            note=note,
            time_status=time_status
        )
        db.add(prospect)
        
        # If calling now, push into Live Calls
        if is_calling:
            scenario = generate_call_scenario(p_name, prospect.channel)
            live_call = LiveCall(
                id=f"c_{uuid.uuid4().hex[:6]}",
                mission_id=mission_id,
                prospect_id=p_id,
                prospect=p_name,
                mission=req.title,
                state=scenario["state"],
                channel=prospect.channel,
                duration=scenario["duration"],
                flag=scenario.get("flag"),
                transcript=scenario["transcript"]
            )
            db.add(live_call)

    # 4. Add system notification
    notif = Notification(
        id=f"n_{uuid.uuid4().hex[:6]}",
        text=f"Mission \"{req.title}\" launched with {total} prospects ({concurrency} concurrent)",
        type="success"
    )
    db.add(notif)
    
    await db.commit()
    
    # Broadcast to WebSocket listeners
    await call_hub.broadcast("mission_created", {"missionId": mission_id, "title": req.title})
    
    return {"id": mission_id, "status": "created", "total": total}

@router.post("/upload-parse")
async def parse_spreadsheet(file: UploadFile = File(...)):
    contents = await file.read()
    filename = file.filename.lower()
    
    try:
        if filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(contents))
        elif filename.endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(contents))
        else:
            raise HTTPException(status_code=400, detail="Only CSV, XLSX, and XLS formats are supported.")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {str(e)}")

    headers = [str(c).strip() for c in df.columns]
    
    def guess_col(possible_names):
        for h in headers:
            for p in possible_names:
                if p.lower() in h.lower():
                    return h
        return None

    col_name = guess_col(["company", "name", "business", "organisation", "organization", "account"])
    col_phone = guess_col(["phone", "telephone", "tel", "mobile", "number", "contact_no"])
    col_site = guess_col(["website", "site", "web", "url", "domain"])
    col_contact = guess_col(["contact", "person", "director", "decision_maker", "manager", "name"])
    col_channel = guess_col(["channel", "preferred_channel", "type"])
    
    rows = []
    seen_phones = set()
    
    for idx, r in df.iterrows():
        name_val = str(r[col_name]).strip() if col_name and pd.notna(r[col_name]) else ""
        phone_val = str(r[col_phone]).strip() if col_phone and pd.notna(r[col_phone]) else ""
        site_val = str(r[col_site]).strip() if col_site and pd.notna(r[col_site]) else ""
        contact_val = str(r[col_contact]).strip() if col_contact and pd.notna(r[col_contact]) else ""
        channel_val = str(r[col_channel]).strip().lower() if col_channel and pd.notna(r[col_channel]) else "voice"
        if channel_val not in ["voice", "whatsapp", "sms"]:
            channel_val = "voice"

        # Validation issues
        issues = []
        if not name_val or name_val.lower() == "nan":
            issues.append("missing_name")
        if not phone_val or phone_val.lower() == "nan" or len(phone_val) < 7:
            issues.append("missing_phone")
            
        norm_phone = normalize_phone_digits(phone_val)
        if norm_phone and norm_phone in seen_phones:
            issues.append("duplicate_phone")
        elif norm_phone:
            seen_phones.add(norm_phone)

        rows.append({
            "id": f"row_{idx + 1}",
            "name": name_val,
            "phone": phone_val,
            "website": site_val,
            "contact": contact_val,
            "channel": channel_val,
            "issues": issues,
            "checked": len(issues) == 0,
        })

    return {
        "filename": file.filename,
        "totalRows": len(rows),
        "columnsDetected": {
            "name": col_name,
            "phone": col_phone,
            "website": col_site,
            "contact": col_contact,
            "channel": col_channel,
        },
        "rows": rows
    }
