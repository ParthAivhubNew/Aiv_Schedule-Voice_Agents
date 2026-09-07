import os
import json
import uuid
import logging
from datetime import datetime
from typing import Dict, Any, Optional
from pathlib import Path

logger = logging.getLogger("process_logger")

# Ensure logs directory exists
LOGS_DIR = Path(__file__).resolve().parent.parent.parent / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

SUBSYSTEM_LOG_FILES = {
    "telephony": LOGS_DIR / "telephony.log",
    "voice": LOGS_DIR / "voice.log",
    "crawler_rag": LOGS_DIR / "crawler_rag.log",
    "calendar": LOGS_DIR / "calendar.log",
    "scheduler": LOGS_DIR / "scheduler.log",
    "auth": LOGS_DIR / "auth.log",
    "system": LOGS_DIR / "system.log",
    "all": LOGS_DIR / "all_processes.log",
}

def _write_to_file(filepath: Path, line: str):
    """Safely appends a log entry line to a file."""
    try:
        with open(filepath, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception as err:
        logger.error(f"Failed to write log to {filepath}: {err}")

async def log_process_event(
    subsystem: str,
    process_name: str,
    message: str,
    level: str = "INFO",
    details: Optional[Dict[str, Any]] = None,
    duration_ms: Optional[float] = None,
    db = None
) -> Dict[str, Any]:
    """
    Records a dedicated log entry across 3 storage layers:
    1. Dedicated Subsystem Log File (e.g. backend/logs/telephony.log)
    2. Master Process Log File (backend/logs/all_processes.log)
    3. Persistent Database Table (process_logs)
    4. Real-time WebSocket Broadcast to frontend
    """
    timestamp_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    event_id = f"plog_{uuid.uuid4().hex[:10]}"
    details_dict = details or {}
    
    # 1. Format file log string
    duration_tag = f" [{duration_ms:.1f}ms]" if duration_ms is not None else ""
    details_preview = f" | {json.dumps(details_dict, ensure_ascii=False)}" if details_dict else ""
    log_line = f"[{timestamp_str}] [{level.upper()}] [{subsystem.upper()}] [{process_name}]{duration_tag} {message}{details_preview}"
    
    # 2. Write to dedicated subsystem file
    sub_file = SUBSYSTEM_LOG_FILES.get(subsystem, SUBSYSTEM_LOG_FILES["system"])
    _write_to_file(sub_file, log_line)
    _write_to_file(SUBSYSTEM_LOG_FILES["all"], log_line)

    record_data = {
        "id": event_id,
        "subsystem": subsystem,
        "level": level.upper(),
        "processName": process_name,
        "message": message,
        "details": details_dict,
        "durationMs": duration_ms,
        "createdAt": datetime.utcnow().isoformat()
    }

    # 3. Store in Database
    try:
        from app.models.models import ProcessLog
        from app.database import AsyncSessionLocal

        log_obj = ProcessLog(
            id=event_id,
            subsystem=subsystem,
            level=level.upper(),
            process_name=process_name,
            message=message,
            details=details_dict,
            duration_ms=duration_ms,
            created_at=datetime.utcnow()
        )

        if db is not None:
            db.add(log_obj)
            await db.commit()
        else:
            async with AsyncSessionLocal() as session:
                session.add(log_obj)
                await session.commit()
    except Exception as db_err:
        logger.debug(f"Could not persist process log to database: {db_err}")

    # 4. Broadcast via WebSocket if call_hub is active
    try:
        from app.websockets.call_hub import call_hub
        await call_hub.broadcast("process_log", record_data)
    except Exception:
        pass

    return record_data

# Synchronous fire-and-forget helper
def log_sync(subsystem: str, process_name: str, message: str, level: str = "INFO", details: Optional[Dict[str, Any]] = None):
    timestamp_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    details_preview = f" | {json.dumps(details, ensure_ascii=False)}" if details else ""
    log_line = f"[{timestamp_str}] [{level.upper()}] [{subsystem.upper()}] [{process_name}] {message}{details_preview}"
    sub_file = SUBSYSTEM_LOG_FILES.get(subsystem, SUBSYSTEM_LOG_FILES["system"])
    _write_to_file(sub_file, log_line)
    _write_to_file(SUBSYSTEM_LOG_FILES["all"], log_line)
