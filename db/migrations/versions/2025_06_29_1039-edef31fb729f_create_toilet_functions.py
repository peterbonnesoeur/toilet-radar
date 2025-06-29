"""Create toilet functions

Revision ID: edef31fb729f
Revises: 839328d06171
Create Date: 2025-06-29 10:39:22.962862

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel
import geoalchemy2


# revision identifiers, used by Alembic.
revision = 'edef31fb729f'
down_revision = '839328d06171'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop existing functions first to avoid conflicts
    op.execute("DROP FUNCTION IF EXISTS find_nearest_toilets(double precision, double precision, double precision, integer)")
    op.execute("DROP FUNCTION IF EXISTS find_toilets_in_view(double precision, double precision, double precision, double precision, integer)")
    op.execute("DROP FUNCTION IF EXISTS get_toilets_deterministic_v3(double precision, double precision, double precision, double precision, boolean, integer)")
    
    # Create Country Code enum type if it doesn't exist
    op.execute("""
        DO $$ BEGIN 
            CREATE TYPE COUNTRY_CODE AS ENUM ('CH', 'FR', 'DE', 'IT', 'AT'); 
        EXCEPTION WHEN duplicate_object THEN 
            null; 
        END $$;
    """)
    
    # Function 1: Find nearest toilets within a radius
    op.execute("""
        CREATE OR REPLACE FUNCTION find_nearest_toilets(
            user_lat double precision,
            user_lng double precision,
            radius_meters double precision DEFAULT 20000,
            result_limit integer DEFAULT 3
        )
        RETURNS TABLE (
            id uuid, name text, lat double precision, lng double precision,
            address text, accessible boolean, is_free boolean, type text, 
            status text, notes text, city text, open_hours text,
            distance double precision, created_at timestamp with time zone
        )
        AS $$
        BEGIN
            RETURN QUERY
            SELECT t.id, t.name, t.lat, t.lng, t.address, t.accessible, t.is_free, 
                   t.type, t.status, t.notes, t.city, t.open_hours,
                   ST_Distance(t.geom, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography)::double precision,
                   t.created_at
            FROM toilet_location t
            WHERE ST_DWithin(t.geom, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography, radius_meters)
            ORDER BY t.geom <-> ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)
            LIMIT result_limit;
        END;
        $$ LANGUAGE plpgsql STABLE;
    """)
    
    # Function 2: Find toilets within a bounding box (map view)
    op.execute("""
        CREATE OR REPLACE FUNCTION find_toilets_in_view (
          min_lat double precision, min_lng double precision,
          max_lat double precision, max_lng double precision,
          max_results integer DEFAULT 4000
        ) RETURNS TABLE (
          id uuid, name text, lat double precision, lng double precision,
          accessible boolean, open_hours text, address text, created_at timestamp with time zone
        ) AS $$
        BEGIN
          RETURN QUERY
          SELECT t.id, t.name, t.lat, t.lng, t.accessible, t.open_hours, t.address, t.created_at
          FROM toilet_location t
          WHERE t.geom && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
          LIMIT max_results;
        END;
        $$ LANGUAGE plpgsql STABLE;
    """)
    
    # Function 3: Get toilets with deterministic behavior based on zoom level
    op.execute("""
        CREATE OR REPLACE FUNCTION get_toilets_deterministic_v3 (
          p_center_lat double precision, p_center_lng double precision,
          p_user_lat double precision DEFAULT NULL, p_user_lng double precision DEFAULT NULL,
          p_is_zoomed_in boolean DEFAULT true, result_limit integer DEFAULT 1000
        ) RETURNS TABLE (
          id uuid, name text, lat double precision, lng double precision,
          accessible boolean, open_hours text, address text, created_at timestamp with time zone
        ) AS $$
        DECLARE
          center_geom geometry;
          inferred_country_code text := 'CH';
        BEGIN
          center_geom := ST_SetSRID(ST_MakePoint(p_center_lng, p_center_lat), 4326);
          
          -- Infer country from nearest toilets
          WITH nearest_k_toilets AS (
            SELECT t.country_code FROM toilet_location t
            WHERE t.geom IS NOT NULL AND t.country_code IS NOT NULL
            ORDER BY t.geom <-> center_geom LIMIT 5
          )
          SELECT (mode() WITHIN GROUP (ORDER BY nk.country_code))::text
          INTO inferred_country_code FROM nearest_k_toilets nk;
          
          IF inferred_country_code IS NULL THEN inferred_country_code := 'CH'; END IF;
          
          IF p_is_zoomed_in THEN
            RETURN QUERY
            SELECT t.id, t.name, t.lat, t.lng, t.accessible, t.open_hours, t.address, t.created_at
            FROM toilet_location t
            WHERE t.geom IS NOT NULL AND t.country_code::text = inferred_country_code
            ORDER BY t.geom <-> center_geom LIMIT result_limit;
          ELSE
            RETURN QUERY
            SELECT t.id, t.name, t.lat, t.lng, t.accessible, t.open_hours, t.address, t.created_at
            FROM toilet_location t
            WHERE t.geom IS NOT NULL AND t.country_code::text = inferred_country_code
            ORDER BY t.id LIMIT result_limit;
          END IF;
        END;
        $$ LANGUAGE plpgsql STABLE;
    """)


def downgrade() -> None:
    # Drop functions in reverse order
    op.execute("DROP FUNCTION IF EXISTS get_toilets_deterministic_v3")
    op.execute("DROP FUNCTION IF EXISTS find_toilets_in_view")
    op.execute("DROP FUNCTION IF EXISTS find_nearest_toilets")
    
    # Note: We don't drop the COUNTRY_CODE enum type in downgrade since it might be used by other tables 