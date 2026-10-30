"""Plans the assistants made, and their runs.

GET  /agent/runs                       my runs, newest first (the corner widget polls this)
GET  /agent/runs/{id}                  one run
POST /agent/runs/{id}/start            run a planned plan (the person pressed Run)
POST /agent/runs/{id}/pause | resume | cancel
POST /agent/runs/{id}/gate             {action: "done" | "skip"}: the person's answer for a step that waits for them

A run belongs to the person whose chat made it; nobody else, in the company or outside it, can see or change it. Every step is checked
against what that person may use when the plan is made and again when they press Run.
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.auth_middleware import current
from app.database import get_db
from app.models.models import AgentRun
from app.services import agent_runs as AR

router = APIRouter(prefix="/agent", tags=["Assistant"])
LIST_LIMIT = 25


class GateIn(BaseModel):
    action: str


async def _mine(db: AsyncSession, request: Request, run_id: str) -> AgentRun:
    run = await db.get(AgentRun, run_id)
    if not run or run.operator_id != current(request)["operator_id"]:
        raise HTTPException(status_code=404, detail="That plan was not found.")
    return run


@router.get("/runs")
async def list_runs(request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    rows = (await db.execute(select(AgentRun).where(AgentRun.operator_id == current(request)["operator_id"]).order_by(AgentRun.created_at.desc()).limit(LIST_LIMIT))).scalars().all()
    return {"runs": [AR.run_json(r) for r in rows if r.status != "planned"]}


@router.get("/runs/{run_id}")
async def get_run(run_id: str, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    return {"run": AR.run_json(await _mine(db, request, run_id))}


@router.post("/runs/{run_id}/start")
async def start_run(run_id: str, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    run = await _mine(db, request, run_id)
    if run.status != "planned":
        raise HTTPException(status_code=409, detail="That plan has already been started.")
    ctx = current(request)
    steps, why = AR.check_steps(run.steps, ctx["perms"])  # the person's access may have changed since the plan was made
    if why:
        raise HTTPException(status_code=403, detail=why)
    run.actor = {"operator_id": ctx["operator_id"], "perms": ctx["perms"]}
    await AR.start(db, run)
    return {"run": AR.run_json(run)}


@router.post("/runs/{run_id}/pause")
async def pause_run(run_id: str, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    run = await _mine(db, request, run_id)
    await AR.pause(db, run)
    return {"run": AR.run_json(run)}


@router.post("/runs/{run_id}/resume")
async def resume_run(run_id: str, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    run = await _mine(db, request, run_id)
    if run.status not in ("paused", "interrupted", "failed"):
        raise HTTPException(status_code=409, detail="That plan is not paused.")
    await AR.resume(db, run)
    return {"run": AR.run_json(run)}


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    run = await _mine(db, request, run_id)
    await AR.cancel(db, run)
    await db.refresh(run)
    return {"run": AR.run_json(run)}


@router.post("/runs/{run_id}/gate")
async def answer_gate(run_id: str, body: GateIn, request: Request, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    run = await _mine(db, request, run_id)
    if body.action not in ("done", "skip"):
        raise HTTPException(status_code=400, detail="Say done or skip.")
    if run.status != "waiting":
        raise HTTPException(status_code=409, detail="That plan is not waiting for you.")
    await AR.resolve_gate(db, run, body.action)
    return {"run": AR.run_json(run)}
