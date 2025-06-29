"""Database services for toilet operations."""
from typing import List, Optional
from uuid import UUID

from sqlalchemy import func, text
from sqlmodel import Session, select

from .models import (
    NearestToiletsParams,
    Toilet,
    ToiletCreate,
    ToiletRead,
    ToiletSearchResult,
    ToiletUpdate,
    ToiletsInViewParams,
    ToiletsDeterministicParams,
)


class ToiletService:
    """Service class for toilet operations."""
    
    def __init__(self, session: Session):
        self.session = session
    
    def create_toilet(self, toilet_data: ToiletCreate) -> ToiletRead:
        """Create a new toilet."""
        toilet = Toilet.model_validate(toilet_data)
        
        # Update geom field if lat/lng provided
        if toilet_data.lat is not None and toilet_data.lng is not None:
            # Use raw SQL to set the geometry since we're keeping SQL functions
            self.session.execute(
                text("UPDATE toilets SET geom = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326) WHERE id = :id"),
                {"lng": toilet_data.lng, "lat": toilet_data.lat, "id": toilet.id}
            )
        
        self.session.add(toilet)
        self.session.commit()
        self.session.refresh(toilet)
        return ToiletRead.model_validate(toilet)
    
    def get_toilet(self, toilet_id: UUID) -> Optional[ToiletRead]:
        """Get a toilet by ID."""
        toilet = self.session.get(Toilet, toilet_id)
        return ToiletRead.model_validate(toilet) if toilet else None
    
    def update_toilet(self, toilet_id: UUID, toilet_data: ToiletUpdate) -> Optional[ToiletRead]:
        """Update a toilet."""
        toilet = self.session.get(Toilet, toilet_id)
        if not toilet:
            return None
        
        update_data = toilet_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(toilet, field, value)
        
        # Update geom field if lat/lng changed
        if 'lat' in update_data or 'lng' in update_data:
            if toilet.lat is not None and toilet.lng is not None:
                self.session.execute(
                    text("UPDATE toilets SET geom = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326) WHERE id = :id"),
                    {"lng": toilet.lng, "lat": toilet.lat, "id": toilet.id}
                )
        
        self.session.commit()
        self.session.refresh(toilet)
        return ToiletRead.model_validate(toilet)
    
    def delete_toilet(self, toilet_id: UUID) -> bool:
        """Delete a toilet."""
        toilet = self.session.get(Toilet, toilet_id)
        if not toilet:
            return False
        
        self.session.delete(toilet)
        self.session.commit()
        return True
    
    def find_nearest_toilets(self, params: NearestToiletsParams) -> List[ToiletSearchResult]:
        """Find nearest toilets using the existing SQL function."""
        result = self.session.execute(
            text("""
                SELECT id, name, lat, lng, address, accessible, is_free, type, status, 
                       notes, city, open_hours, distance, created_at
                FROM find_nearest_toilets(:user_lat, :user_lng, :radius_meters, :result_limit)
            """),
            {
                "user_lat": params.user_lat,
                "user_lng": params.user_lng,
                "radius_meters": params.radius_meters,
                "result_limit": params.result_limit,
            }
        )
        
        toilets = []
        for row in result:
            toilet_data = {
                "id": row.id,
                "name": row.name,
                "lat": row.lat,
                "lng": row.lng,
                "address": row.address,
                "accessible": row.accessible,
                "is_free": row.is_free,
                "type": row.type,
                "status": row.status,
                "notes": row.notes,
                "city": row.city,
                "open_hours": row.open_hours,
                "created_at": row.created_at,
                "distance": row.distance,
            }
            toilets.append(ToiletSearchResult(**toilet_data))
        
        return toilets
    
    def find_toilets_in_view(self, params: ToiletsInViewParams) -> List[ToiletRead]:
        """Find toilets in view using the existing SQL function."""
        result = self.session.execute(
            text("""
                SELECT id, name, lat, lng, accessible, open_hours, address, created_at
                FROM find_toilets_in_view(:min_lat, :min_lng, :max_lat, :max_lng, :max_results)
            """),
            {
                "min_lat": params.min_lat,
                "min_lng": params.min_lng,
                "max_lat": params.max_lat,
                "max_lng": params.max_lng,
                "max_results": params.max_results,
            }
        )
        
        toilets = []
        for row in result:
            toilet_data = {
                "id": row.id,
                "name": row.name,
                "lat": row.lat,
                "lng": row.lng,
                "accessible": row.accessible,
                "open_hours": row.open_hours,
                "address": row.address,
                "created_at": row.created_at,
            }
            toilets.append(ToiletRead(**toilet_data))
        
        return toilets
    
    def get_toilets_deterministic(self, params: ToiletsDeterministicParams) -> List[ToiletRead]:
        """Get toilets using deterministic method."""
        result = self.session.execute(
            text("""
                SELECT id, name, lat, lng, accessible, open_hours, address, created_at
                FROM get_toilets_deterministic_v3(
                    :center_lat, :center_lng, :user_lat, :user_lng, 
                    :is_zoomed_in, :result_limit
                )
            """),
            {
                "center_lat": params.center_lat,
                "center_lng": params.center_lng,
                "user_lat": params.user_lat,
                "user_lng": params.user_lng,
                "is_zoomed_in": params.is_zoomed_in,
                "result_limit": params.result_limit,
            }
        )
        
        toilets = []
        for row in result:
            toilet_data = {
                "id": row.id,
                "name": row.name,
                "lat": row.lat,
                "lng": row.lng,
                "accessible": row.accessible,
                "open_hours": row.open_hours,
                "address": row.address,
                "created_at": row.created_at,
            }
            toilets.append(ToiletRead(**toilet_data))
        
        return toilets
    
    def get_all_toilets(self, limit: int = 1000, offset: int = 0) -> List[ToiletRead]:
        """Get all toilets with pagination."""
        statement = select(Toilet).offset(offset).limit(limit)
        toilets = self.session.exec(statement).all()
        return [ToiletRead.model_validate(toilet) for toilet in toilets]
    
    def get_toilets_by_country(self, country_code: str, limit: int = 1000) -> List[ToiletRead]:
        """Get toilets by country code."""
        statement = select(Toilet).where(Toilet.country_code == country_code).limit(limit)
        toilets = self.session.exec(statement).all()
        return [ToiletRead.model_validate(toilet) for toilet in toilets]
    
    def bulk_create_toilets(self, toilets_data: List[ToiletCreate]) -> List[ToiletRead]:
        """Bulk create toilets for data import."""
        toilets = []
        for toilet_data in toilets_data:
            toilet = Toilet.model_validate(toilet_data)
            toilets.append(toilet)
        
        self.session.add_all(toilets)
        self.session.commit()
        
        # Update geometry for all toilets that have lat/lng
        self.session.execute(
            text("""
                UPDATE toilets 
                SET geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326) 
                WHERE lng IS NOT NULL AND lat IS NOT NULL AND geom IS NULL
            """)
        )
        self.session.commit()
        
        return [ToiletRead.model_validate(toilet) for toilet in toilets] 