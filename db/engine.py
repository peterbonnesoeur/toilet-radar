"""Database engine and session management."""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel import Session

from .config import settings


# Synchronous engine
connect_args = {
    "sslmode": "require",
    "client_encoding": "utf8",
    "connect_timeout": 60,
}

# Add schema to search_path if not using default 'public' schema
if settings.db_schema and settings.db_schema != 'public':
    connect_args["options"] = f"-c search_path={settings.db_schema}"

engine = create_engine(
    settings.database_url,
    pool_size=settings.pool_size,
    max_overflow=settings.max_overflow,
    pool_timeout=settings.pool_timeout,
    pool_recycle=settings.pool_recycle,
    echo=False,  # Set to True for SQL debugging
    connect_args=connect_args
)

# Session factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    class_=Session,
)


def get_session():
    """Get a database session."""
    with SessionLocal() as session:
        try:
            yield session
        finally:
            session.close() 