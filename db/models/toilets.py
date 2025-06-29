"""SQLModel models for Toilet Radar database."""
from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4

from geoalchemy2 import Geometry
from sqlmodel import Field, SQLModel
from sqlalchemy import Column, Index, text, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID as PostgresUUID
from db.config import settings


class CountryCode(str, Enum):
    """Country code enumeration."""
    CH = "CH"  # Switzerland
    FR = "FR"  # France
    DE = "DE"  # Germany
    IT = "IT"  # Italy
    AT = "AT"  # Austria


class ToiletBase(SQLModel):
    """Base toilet model with common fields."""
    name: Optional[str] = Field(default=None)
    lat: Optional[float] = Field(default=None)
    lng: Optional[float] = Field(default=None)
    accessible: Optional[bool] = Field(default=None)
    open_hours: Optional[str] = Field(default=None)
    address: Optional[str] = Field(default=None)
    rating: Optional[int] = Field(default=None)
    is_free: Optional[bool] = Field(default=None)
    type: Optional[str] = Field(default=None)
    status: Optional[str] = Field(default=None)
    notes: Optional[str] = Field(default=None)
    city: Optional[str] = Field(default=None)
    country_code: Optional[CountryCode] = Field(default=None)


class ToiletLocation(ToiletBase, table=True):
    """New toilet_location table - primary table for toilet data."""
    __tablename__ = "toilet_location"
    __table_args__ = (
        Index("idx_toilet_location_geom", "geom", postgresql_using="gist"),
        Index("idx_toilet_location_country_code", "country_code"),
    )
    
    id: UUID = Field(
        default_factory=uuid4,
        sa_column=Column("id", PostgresUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    )
    created_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column("created_at", TIMESTAMP(timezone=True), server_default=text("now()"))
    )
    geom: Optional[str] = Field(
        default=None,
        sa_column=Column("geom", Geometry("POINT", srid=4326), nullable=True)
    )


class Toilet(ToiletBase, table=True):
    """Legacy toilets table - kept for backward compatibility."""
    __tablename__ = "toilets"
    
    id: UUID = Field(
        default_factory=uuid4,
        sa_column=Column("id", PostgresUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    )
    created_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column("created_at", TIMESTAMP(timezone=True), server_default=text("now()"))
    )
    geom: Optional[str] = Field(
        default=None,
        sa_column=Column("geom", Geometry("POINT", srid=4326), nullable=True)
    )
    
    __table_args__ = (
        Index("toilets_geom_idx", "geom", postgresql_using="gist"),
        Index("idx_toilets_country_code", "country_code"),
    )


class ToiletCreate(ToiletBase):
    """Model for creating new toilets."""
    pass


class ToiletUpdate(ToiletBase):
    """Model for updating existing toilets."""
    pass


class ToiletRead(ToiletBase):
    """Model for reading toilet data."""
    id: UUID
    created_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class ToiletSearchResult(ToiletRead):
    """Model for toilet search results with distance."""
    distance: Optional[float] = Field(default=None, description="Distance in meters")


class NearestToiletsParams(SQLModel):
    """Parameters for finding nearest toilets."""
    user_lat: float = Field(description="User latitude")
    user_lng: float = Field(description="User longitude")
    radius_meters: float = Field(default=20000, description="Search radius in meters")
    result_limit: int = Field(default=3, description="Maximum results to return")


class ToiletsInViewParams(SQLModel):
    """Parameters for finding toilets in view."""
    min_lat: float = Field(description="Minimum latitude")
    min_lng: float = Field(description="Minimum longitude")
    max_lat: float = Field(description="Maximum latitude")
    max_lng: float = Field(description="Maximum longitude")
    max_results: int = Field(default=4000, description="Maximum results to return")


class ToiletsDeterministicParams(SQLModel):
    """Parameters for deterministic toilet fetching."""
    center_lat: float = Field(description="Map center latitude")
    center_lng: float = Field(description="Map center longitude")
    user_lat: Optional[float] = Field(default=None, description="Optional user latitude")
    user_lng: Optional[float] = Field(default=None, description="Optional user longitude")
    is_zoomed_in: bool = Field(default=True, description="Whether map is zoomed in")
    result_limit: int = Field(default=1000, description="Maximum results to return") 