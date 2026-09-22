from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base
from app.config import settings

from pathlib import Path

# Adjust sqlite database URL if needed
db_url = settings.DATABASE_URL
if db_url.startswith("sqlite"):
    backend_dir = Path(__file__).resolve().parent.parent
    db_file = (backend_dir / "aivhub.db").as_posix()
    db_url = f"sqlite+aiosqlite:///{db_file}"
elif db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
elif db_url.startswith("postgresql://") and not db_url.startswith("postgresql+asyncpg://"):
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

# If postgres hostname cannot be resolved (e.g. running locally on Windows outside Docker), fallback to SQLite
if "asyncpg" in db_url or "postgres" in db_url:
    try:
        import socket
        parsed_host = db_url.split("@")[-1].split(":")[0].split("/")[0]
        if parsed_host and parsed_host not in ("localhost", "127.0.0.1"):
            socket.gethostbyname(parsed_host)
    except Exception:
        backend_dir = Path(__file__).resolve().parent.parent
        db_file = (backend_dir / "aivhub.db").as_posix()
        db_url = f"sqlite+aiosqlite:///{db_file}"

engine = create_async_engine(
    db_url,
    echo=False,
    future=True,
    pool_pre_ping=True if not db_url.startswith("sqlite") else False,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

Base = declarative_base()

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            try:
                await session.rollback()
            except Exception:
                pass
            raise
        finally:
            try:
                await session.close()
            except Exception:
                pass
