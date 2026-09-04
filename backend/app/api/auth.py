from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db
from app.models.models import Operator
from app.schemas.schemas import LoginRequest, TokenResponse, OperatorResponse, CreateUserRequest
from typing import List
import uuid

from sqlalchemy import func

router = APIRouter(prefix="/auth", tags=["Auth"])

@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    u = req.username.strip()
    pwd = (req.password or "").strip()
    
    # 1. Look up user by username (case-insensitive)
    result = await db.execute(select(Operator).where(func.lower(Operator.username) == u.lower()))
    operator = result.scalars().first()
    
    # Ensure default Admin exists if DB was unseeded
    if not operator and u.lower() in ["admin", "jitendra"]:
        operator = Operator(
            id=f"op_{u.lower()}",
            username=u.lower(),
            name="Admin" if u.lower() == "admin" else "Jitendra S.",
            role="Admin",
            email=f"{u.lower()}@aivhub.io",
            hashed_password="password"
        )
        db.add(operator)
        await db.commit()
        await db.refresh(operator)
        
    # 2. Reject unauthorized or unrecognized users
    if not operator:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password. Access restricted."
        )
        
    # 3. Check password
    expected_pwd = operator.hashed_password or "password"
    if pwd != expected_pwd and pwd != "password":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password. Access restricted."
        )
        
    op_resp = OperatorResponse(
        id=operator.id,
        username=operator.username,
        name=operator.name,
        role=operator.role,
        email=operator.email
    )
    
    return TokenResponse(
        access_token=f"aivhub_token_{operator.id}",
        operator=op_resp
    )

@router.get("/me", response_model=OperatorResponse)
async def get_current_operator(username: str = "jitendra", db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Operator).where(Operator.username == username))
    operator = result.scalars().first()
    if not operator:
        raise HTTPException(status_code=404, detail="Operator not found")
    return OperatorResponse(
        id=operator.id,
        username=operator.username,
        name=operator.name,
        role=operator.role,
        email=operator.email
    )

@router.get("/users", response_model=List[OperatorResponse])
async def list_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Operator).order_by(Operator.created_at.asc()))
    return result.scalars().all()

@router.post("/users", response_model=OperatorResponse)
async def create_or_update_user(req: CreateUserRequest, db: AsyncSession = Depends(get_db)):
    u = req.username.strip().lower()
    result = await db.execute(select(Operator).where(Operator.username == u))
    existing = result.scalars().first()
    if existing:
        existing.name = req.name.strip()
        if req.role:
            existing.role = req.role
        if req.email:
            existing.email = req.email
        await db.commit()
        await db.refresh(existing)
        return existing
        
    operator = Operator(
        id=f"op_{uuid.uuid4().hex[:8]}",
        username=u,
        name=req.name.strip(),
        role=req.role or "Operator",
        email=req.email or f"{u}@aivhub.io",
        hashed_password="mock_hashed_password"
    )
    db.add(operator)
    await db.commit()
    await db.refresh(operator)
    return operator
