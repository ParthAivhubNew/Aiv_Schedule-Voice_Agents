from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base
from app.config import settings

# PostgreSQL-only configuration - no SQLite fallback
db_url = settings.DATABASE_URL

# Validate that PostgreSQL is configured
if not db_url or "sqlite" in db_url.lower():
    raise ValueError(
        "PostgreSQL DATABASE_URL is required. SQLite is not supported.\n"
        "Please set DATABASE_URL in your .env file to a PostgreSQL connection string.\n"
        "Example: postgresql+asyncpg://postgres:password@postgres:5432/aivhub"
    )

# Normalize PostgreSQL URL format
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
elif db_url.startswith("postgresql://") and "asyncpg" not in db_url:
    db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)

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
