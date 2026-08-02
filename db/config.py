"""Database configuration for Toilet Radar.

The environment file is selected with APP_ENV:
  APP_ENV=local (default) -> .env.local
  APP_ENV=dev             -> .env.dev
  APP_ENV=prd             -> .env.prd

Production is never targeted implicitly: you must set APP_ENV=prd on purpose.
"""
import os
import re
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

_ENV_FILES = {
    "local": ".env.local",
    "dev": ".env.dev",
    "prd": ".env.prd",
}

APP_ENV = os.environ.get("APP_ENV", "local").lower()
if APP_ENV not in _ENV_FILES:
    raise ValueError(f"APP_ENV must be one of {sorted(_ENV_FILES)}, got {APP_ENV!r}")

load_dotenv(_ENV_FILES[APP_ENV])
print(f"[db.config] Environment: {APP_ENV} ({_ENV_FILES[APP_ENV]})")

_SCHEMA_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


class DatabaseSettings(BaseSettings):
    """Database configuration settings."""

    # Direct database URL (for local development)
    database_url_override: Optional[str] = Field(default=None, env="DATABASE_URL")

    # Schema configuration
    db_schema: str = Field(default="public", env="DB_SCHEMA")

    # Database connection components
    db_host: Optional[str] = Field(default=None, env="DB_HOST")
    db_port: int = Field(default=5432, env="DB_PORT")
    db_name: Optional[str] = Field(default=None, env="DB_NAME")
    db_user: Optional[str] = Field(default=None, env="DB_USER")
    db_password: Optional[str] = Field(default=None, env="DB_PASSWORD")

    # Connection pool settings
    pool_size: int = Field(default=5, env="DB_POOL_SIZE")
    max_overflow: int = Field(default=5, env="DB_MAX_OVERFLOW")
    pool_timeout: int = Field(default=30, env="DB_POOL_TIMEOUT")
    pool_recycle: int = Field(default=3600, env="DB_POOL_RECYCLE")

    @field_validator("db_schema")
    @classmethod
    def validate_schema(cls, v: str) -> str:
        if not _SCHEMA_RE.match(v):
            raise ValueError(f"DB_SCHEMA must match {_SCHEMA_RE.pattern}, got {v!r}")
        return v

    @property
    def database_url(self) -> str:
        """Get the database URL."""
        if self.database_url_override:
            return self.database_url_override

        if all([self.db_host, self.db_name, self.db_user, self.db_password]):
            return (
                f"postgresql://{self.db_user}:{self.db_password}"
                f"@{self.db_host}:{self.db_port}/{self.db_name}"
            )

        raise ValueError(
            f"Database connection not configured for APP_ENV={APP_ENV}. "
            f"Set DATABASE_URL, or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD, "
            f"in {_ENV_FILES[APP_ENV]}."
        )

    @property
    def async_database_url(self) -> str:
        """Get the async database URL."""
        return self.database_url.replace("postgresql://", "postgresql+asyncpg://")


# Global settings instance
settings = DatabaseSettings()
