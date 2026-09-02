from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.database import get_db
from app.models.models import Operator
from app.schemas.schemas import LoginRequest, TokenResponse, OperatorResponse
import uuid

router = APIRouter(prefix="/auth", tags=["Auth"])

@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    u = req.username.strip()
    result = await db.execute(select(Operator).where(Operator.username == u))
    operator = result.scalars().first()
    
    if not operator:
        # Create user automatically for seamless testing
        is_admin = u.lower().startswith("jitendra")
        name = "Jitendra S." if is_admin else u.replace(".", " ").title()
        role = "Admin" if is_admin else "Operator"
        
        operator = Operator(
            id=f"op_{uuid.uuid4().hex[:8]}",
            username=u,
            name=name,
            role=role,
            email=f"{u}@aivhub.io",
            hashed_password="mock_hashed_password"
        )
        db.add(operator)
        await db.commit()
        await db.refresh(operator)
        
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
