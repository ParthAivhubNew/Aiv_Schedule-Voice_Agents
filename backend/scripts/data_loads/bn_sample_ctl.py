"""Pause, resume or stop the 500-company run, change its speed, or see where it is. Takes effect within a few seconds; companies being worked on finish first.
  python /tmp/bn_sample_ctl.py status
  python /tmp/bn_sample_ctl.py pause | resume | stop
  python /tmp/bn_sample_ctl.py workers 5        (companies at a time, 1 to 12)
"""
import asyncio, sys

from app.database import AsyncSessionLocal
from app.models.models import AppSetting

CTL, STATUS = "fsb_bid:sample500:control", "fsb_bid:sample500:status"


async def doc(doc_id):
    async with AsyncSessionLocal() as s:
        row = await s.get(AppSetting, doc_id)
    return dict((row.data or {}) if row else {})


async def put(doc_id, data):
    async with AsyncSessionLocal() as s:
        row = await s.get(AppSetting, doc_id)
        if row:
            row.data = data
        else:
            s.add(AppSetting(id=doc_id, data=data))
        await s.commit()


async def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    ctl = await doc(CTL)
    if cmd in ("pause", "resume", "stop"):
        ctl["state"] = {"pause": "pause", "resume": "run", "stop": "stop"}[cmd]
        await put(CTL, ctl)
    elif cmd == "workers":
        ctl["workers"] = max(1, min(int(sys.argv[2]), 12))
        await put(CTL, ctl)
    st = await doc(STATUS)
    print("control:", ctl)
    print("status :", {k: st.get(k) for k in ("state", "done", "total", "weak", "errors", "last_company", "paused_reason", "updated_at")})


asyncio.run(main())
