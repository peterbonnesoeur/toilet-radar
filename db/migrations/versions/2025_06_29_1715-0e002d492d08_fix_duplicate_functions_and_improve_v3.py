"""fix_duplicate_functions_and_improve_v3

Revision ID: 0e002d492d08
Revises: edef31fb729f
Create Date: 2025-06-29 17:15:44.993830

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel
import geoalchemy2


# revision identifiers, used by Alembic.
revision = '0e002d492d08'
down_revision = 'edef31fb729f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop all possible variants of the functions to resolve ambiguity
    # Use CASCADE to handle dependencies
    op.execute("DROP FUNCTION IF EXISTS get_toilets_deterministic_v3 CASCADE")
    op.execute("DROP FUNCTION IF EXISTS find_toilets_in_view CASCADE") 
    op.execute("DROP FUNCTION IF EXISTS find_nearest_toilets CASCADE")
    
    # Create the necessary index for country_code if it doesn't exist
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_toilet_location_country_code 
        ON toilet_location (country_code);
    """)
    
    # Recreate find_nearest_toilets function (using toilet_location)
    op.execute("""
        CREATE OR REPLACE FUNCTION find_nearest_toilets(
            user_lat double precision,
            user_lng double precision,
            radius_meters double precision DEFAULT 20000,
            result_limit integer DEFAULT 3
        )
        RETURNS TABLE (
            id uuid, name character varying, lat double precision, lng double precision,
            address character varying, accessible boolean, is_free boolean, type character varying, 
            status character varying, notes character varying, city character varying, open_hours character varying,
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
    
    # Recreate find_toilets_in_view function (using toilet_location)
    op.execute("""
        CREATE OR REPLACE FUNCTION find_toilets_in_view (
          min_lat double precision, min_lng double precision,
          max_lat double precision, max_lng double precision,
          max_results integer DEFAULT 4000
        ) RETURNS TABLE (
          id uuid, name character varying, lat double precision, lng double precision,
          accessible boolean, open_hours character varying, address character varying, created_at timestamp with time zone
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
    
    # Create the improved get_toilets_deterministic_v3 function
    op.execute("""
        CREATE OR REPLACE FUNCTION get_toilets_deterministic_v3 (
          p_center_lat double precision, -- Map center latitude (required)
          p_center_lng double precision, -- Map center longitude (required)
          p_user_lat double precision DEFAULT NULL, -- Optional user location (not used for sorting)
          p_user_lng double precision DEFAULT NULL,
          p_is_zoomed_in boolean DEFAULT true,
          result_limit integer DEFAULT 1000
        ) RETURNS TABLE (
          id uuid, name character varying, lat double precision, lng double precision, 
          accessible boolean, open_hours character varying, address character varying, created_at timestamp with time zone
        ) AS $$
        DECLARE
          center_geom geometry;
          inferred_country_code text := 'CH'; -- Default
          k_for_country_inference integer := 5;
        BEGIN
          -- Validate map center coordinates
          IF p_center_lat IS NULL OR p_center_lng IS NULL OR
             p_center_lat < -90 OR p_center_lat > 90 OR
             p_center_lng < -180 OR p_center_lng > 180
          THEN
             RAISE EXCEPTION 'Invalid map center coordinates provided: %, %', p_center_lat, p_center_lng;
          ELSE
             center_geom := ST_SetSRID(ST_MakePoint(p_center_lng, p_center_lat), 4326);
          END IF;

          -- Infer the country based on K nearest toilets to the MAP CENTER
          WITH nearest_k_toilets AS (
            SELECT t.country_code
            FROM toilet_location t
            WHERE t.geom IS NOT NULL AND t.country_code IS NOT NULL
            ORDER BY t.geom <-> center_geom -- Use map center for inference
            LIMIT k_for_country_inference
          )
          SELECT (mode() WITHIN GROUP (ORDER BY nk.country_code))::text
          INTO inferred_country_code
          FROM nearest_k_toilets nk;

          -- Handle inference failure
          IF inferred_country_code IS NULL THEN
              inferred_country_code := 'CH';
              RAISE LOG 'V3 Fetch: Could not infer country from map center, defaulting to CH.';
          ELSE
              RAISE LOG 'V3 Fetch: Inferred country from map center: %', inferred_country_code;
          END IF;

          -- Fetch based on zoom level within the inferred country
          IF p_is_zoomed_in THEN
            -- ZOOMED IN: KNN relative to MAP CENTER
            RAISE LOG 'V3 Fetch: Zoomed In - KNN within % relative to MAP CENTER', inferred_country_code;

            RETURN QUERY
            SELECT
              t.id, t.name, t.lat, t.lng, t.accessible, t.open_hours, t.address, t.created_at
            FROM toilet_location t
            WHERE t.geom IS NOT NULL AND t.country_code::text = inferred_country_code
            ORDER BY t.geom <-> center_geom -- Always order by distance to map center
            LIMIT result_limit;

          ELSE
            -- ZOOMED OUT: Deterministic sample (ORDER BY id) within the inferred country
            RAISE LOG 'V3 Fetch: Zoomed Out - Deterministic sample (ID order) within %.', inferred_country_code;

            RETURN QUERY
            SELECT
              t.id, t.name, t.lat, t.lng, t.accessible, t.open_hours, t.address, t.created_at
            FROM toilet_location t
            WHERE t.geom IS NOT NULL AND t.country_code::text = inferred_country_code
            ORDER BY t.id -- Deterministic ordering
            LIMIT result_limit;

          END IF;

        END;
        $$ LANGUAGE plpgsql STABLE;
    """)


def downgrade() -> None:
    # Drop functions with proper signature specification to avoid ambiguity
    op.execute("""
        DROP FUNCTION IF EXISTS get_toilets_deterministic_v3(
            double precision, double precision, double precision, double precision, boolean, integer
        ) CASCADE
    """)
    op.execute("""
        DROP FUNCTION IF EXISTS find_toilets_in_view(
            double precision, double precision, double precision, double precision, integer
        ) CASCADE
    """)
    op.execute("""
        DROP FUNCTION IF EXISTS find_nearest_toilets(
            double precision, double precision, double precision, integer
        ) CASCADE
    """)
    
    # Drop the index
    op.execute("DROP INDEX IF EXISTS idx_toilet_location_country_code") 