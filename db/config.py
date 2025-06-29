"""Database configuration for Toilet Radar."""
import os
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

# Load environment variables from .env.local
load_dotenv('.env.prd')


class DatabaseSettings(BaseSettings):
    """Database configuration settings."""
    
    # Direct database URL (for local development)
    database_url_override: Optional[str] = Field(default=None, env="DATABASE_URL")
    
    # Supabase connection details
    supabase_url: str = Field(default="", env="NEXT_PUBLIC_SUPABASE_URL")
    supabase_service_key: str = Field(default="", env="SUPABASE_SERVICE_KEY")
    
    # Schema configuration
    db_schema: str = Field(default="public", env="DB_SCHEMA")
    
    # Database connection components (for non-Supabase setups)
    db_host: Optional[str] = Field(default=None, env="DB_HOST")
    db_port: int = Field(default=5432, env="DB_PORT")
    db_name: Optional[str] = Field(default=None, env="DB_NAME")
    db_user: Optional[str] = Field(default=None, env="DB_USER")
    db_password: Optional[str] = Field(default=None, env="DB_PASSWORD")
    
    # Connection pool settings
    pool_size: int = Field(default=10, env="DB_POOL_SIZE")
    max_overflow: int = Field(default=20, env="DB_MAX_OVERFLOW")
    pool_timeout: int = Field(default=30, env="DB_POOL_TIMEOUT")
    pool_recycle: int = Field(default=3600, env="DB_POOL_RECYCLE")

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if not self.database_url_override and not self.supabase_url and not self.db_host:
            print("Warning: No database configuration found. Please check your .env.local file.")

    @property
    def database_url(self) -> str:
        """Get the database URL."""
        # First check for direct DATABASE_URL override (for local development)
        if self.database_url_override:
            return self.database_url_override
            
        # Try individual DB components if they're all set (preferred for Supabase)
        if all([self.db_host, self.db_name, self.db_user, self.db_password]) and self.db_password != "YOUR_DATABASE_PASSWORD_HERE":
            return f"postgresql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"
        
        # Try Supabase configuration with service key as password
        if self.supabase_url and self.supabase_service_key:
            url = self.supabase_url.rstrip('/')
            if ".supabase.co" in url:
                # Extract project ref from URL like: https://project-ref.supabase.co
                hostname = url.split("//")[-1]  # Remove https://
                project_ref = hostname.split(".")[0]  # Get project-ref part
                
                # Use the correct Supabase transaction pooler format with service key as password
                # Format: postgresql://postgres.project-ref:password@aws-0-region.pooler.supabase.com:6543/postgres
                return f"postgresql://postgres.{project_ref}:{self.supabase_service_key}@aws-0-eu-west-3.pooler.supabase.com:6543/postgres"
        
        # Show helpful error message
        raise ValueError(
            "Database connection details not properly configured. "
            "Please ensure your .env copy.local file contains either:\n"
            "  - DATABASE_URL=postgresql://user:password@host:port/database (for local development), or\n"
            "  - DB_HOST, DB_NAME, DB_USER, DB_PASSWORD (get password from Supabase Dashboard > Settings > Database), or\n"
            "  - NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY (for Supabase with service key as password)\n"
            "Make sure to replace 'YOUR_DATABASE_PASSWORD_HERE' with your actual database password."
        )
    
    @property
    def async_database_url(self) -> str:
        """Get the async database URL."""
        return self.database_url.replace("postgresql://", "postgresql+asyncpg://")


# Global settings instance
settings = DatabaseSettings()