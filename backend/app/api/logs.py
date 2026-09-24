from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, func, desc
from app.database import get_db
from app.models.models import ProcessLog
from app.services.process_logger import SUBSYSTEM_LOG_FILES, LOGS_DIR
from typing import Optional, List, Dict, Any
import os

router = APIRouter(prefix="/logs", tags=["Process Logs"])

@router.get("", response_model=List[Dict[str, Any]])
async def get_logs(
    subsystem: Optional[str] = None,
    level: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(default=150, le=500),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns filtered process logs from the database.
    Supports filtering by subsystem, severity level, or keyword search.
    """
    stmt = select(ProcessLog).order_by(desc(ProcessLog.created_at))

    if subsystem and subsystem != "all":
        stmt = stmt.where(ProcessLog.subsystem == subsystem)
    if level and level != "ALL":
        stmt = stmt.where(ProcessLog.level == level.upper())
    if search:
        search_pattern = f"%{search}%"
        stmt = stmt.where(
            (ProcessLog.message.ilike(search_pattern)) | 
            (ProcessLog.process_name.ilike(search_pattern))
        )

    stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    records = result.scalars().all()

    return [{
        "id": r.id,
        "subsystem": r.subsystem,
        "level": r.level,
        "processName": r.process_name,
        "message": r.message,
        "details": r.details,
        "durationMs": r.duration_ms,
        "createdAt": r.created_at.isoformat() if r.created_at else None
    } for r in records]

@router.get("/subsystems", response_model=List[Dict[str, Any]])
async def get_subsystems_stats(db: AsyncSession = Depends(get_db)):
    """
    Returns list of all monitored subsystems with file location and event stats.
    """
    subsystems_list = [
        {"id": "all", "name": "All Processes", "icon": "LayoutGrid", "file": str(SUBSYSTEM_LOG_FILES["all"])},
        {"id": "telephony", "name": "Telephony (Telnyx / Twilio)", "icon": "Phone", "file": str(SUBSYSTEM_LOG_FILES["telephony"])},
        {"id": "voice", "name": "Voice & Live Calls", "icon": "Mic", "file": str(SUBSYSTEM_LOG_FILES["voice"])},
        {"id": "crawler_rag", "name": "Knowledge & Crawler (pgvector)", "icon": "Globe", "file": str(SUBSYSTEM_LOG_FILES["crawler_rag"])},
        {"id": "calendar", "name": "Calendar & Bookings", "icon": "Calendar", "file": str(SUBSYSTEM_LOG_FILES["calendar"])},
        {"id": "scheduler", "name": "Scheduler & Missions", "icon": "Clock", "file": str(SUBSYSTEM_LOG_FILES["scheduler"])},
        {"id": "system", "name": "System & Keys", "icon": "ShieldCheck", "file": str(SUBSYSTEM_LOG_FILES["system"])},
        {"id": "auth", "name": "Authentication & Access", "icon": "KeyRound", "file": str(SUBSYSTEM_LOG_FILES["auth"])},
    ]

    # Query counts from DB
    counts_res = await db.execute(
        select(ProcessLog.subsystem, func.count(ProcessLog.id))
        .group_by(ProcessLog.subsystem)
    )
    counts_map = {row[0]: row[1] for row in counts_res.all()}

    results = []
    total_events = sum(counts_map.values())
    for s in subsystems_list:
        count = total_events if s["id"] == "all" else counts_map.get(s["id"], 0)
        results.append({
            **s,
            "eventCount": count,
            "fileExists": os.path.exists(s["file"])
        })

    return results

@router.get("/raw/{subsystem}", response_model=Dict[str, Any])
async def get_raw_file_logs(subsystem: str, lines: int = Query(default=100, le=500)):
    """
    Reads the tail of the physical log file directly from disk.
    """
    file_path = SUBSYSTEM_LOG_FILES.get(subsystem)
    if not file_path or not file_path.exists():
        return {"subsystem": subsystem, "path": str(file_path), "lines": []}

    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            all_lines = f.readlines()
            tail_lines = all_lines[-lines:] if len(all_lines) > lines else all_lines
            return {
                "subsystem": subsystem,
                "path": str(file_path),
                "totalLines": len(all_lines),
                "lines": [line.strip() for line in tail_lines]
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {e}")

@router.delete("", response_model=Dict[str, Any])
async def clear_logs(subsystem: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    """
    Clears logs from database and truncates corresponding log files.
    """
    stmt = delete(ProcessLog)
    if subsystem and subsystem != "all":
        stmt = stmt.where(ProcessLog.subsystem == subsystem)
        file_path = SUBSYSTEM_LOG_FILES.get(subsystem)
        if file_path and file_path.exists():
            open(file_path, "w").close()
    else:
        for f in SUBSYSTEM_LOG_FILES.values():
            if f.exists():
                open(f, "w").close()

    await db.execute(stmt)
    await db.commit()
    return {"status": "ok", "message": f"Cleared logs for {subsystem or 'all subsystems'}"}
